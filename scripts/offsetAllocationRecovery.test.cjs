'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const load = file => import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(file)).toString('base64')}`)
const modulePromise = load('src/services/models/offsetAllocationRecovery.js')
const warningPromise = load('src/services/models/saleSaveWarning.js')
const copy = value => JSON.parse(JSON.stringify(value))
async function fixture(count = 1, amount = 24) {
	const api = await modulePromise
	let seq = 0, stored
	const batch = api.createOffsetAllocationBatch({ customerId: 'customer', sources: Array.from({ length: count }, (_, i) => ({ _id: `source-${i}`, source_version: `version-${i}`, unallocated_amount: 24 })),
		amount, allocation: { allocationMode: 'checked', allocationTargets: [{ target_type: 'sale', target_id: 'debt' }] }, makeId: () => `operation-${++seq}` })
	const persist = value => { stored = copy(value) }
	return { ...api, batch, persist, stored: () => stored }
}
const saved = payload => ({ code: 0, data: { operation_id: payload.operationId, customer_id: payload.customerId, receipt_id: payload.receiptId, allocated_total: payload.amount } })
const notFound = async () => ({ code: 0, data: { status: 'not_found' } })

test('lost response queries the committed operation and never consumes its source twice', async () => {
	const h = await fixture()
	let writes = 0, committed
	const result = await h.resumeOffsetAllocationBatch(h.batch, { persist: h.persist,
		allocate: async payload => { writes++; committed = saved(payload).data; throw Error('network lost') },
		query: async () => ({ code: 0, data: { status: 'saved', result: committed } }) })
	assert.equal(result.status, 'complete')
	assert.equal(result.allocated_total, 24)
	assert.equal(writes, 1)
	const reopened = h.readOffsetAllocationBatch(h.stored(), 'customer')
	await h.resumeOffsetAllocationBatch(reopened, { persist: h.persist, allocate: async () => { writes++ }, query: notFound })
	assert.equal(writes, 1)
})

test('unknown response persists the exact request; reload queries then replays only that same operation', async () => {
	const h = await fixture()
	const sent = []
	const first = await h.resumeOffsetAllocationBatch(h.batch, { persist: h.persist, query: notFound,
		allocate: async payload => { sent.push(copy(payload)); throw Error('timeout') } })
	assert.equal(first.status, 'pending')
	assert.equal(sent.length, 1)
	h.batch.allocation.allocationTargets[0].target_id = 'changed-in-form'
	const reopened = h.readOffsetAllocationBatch(h.stored(), 'customer')
	const second = await h.resumeOffsetAllocationBatch(reopened, { persist: h.persist, query: notFound,
		allocate: async payload => { sent.push(copy(payload)); return saved(payload) } })
	assert.equal(second.status, 'complete')
	assert.deepEqual(sent[0], sent[1])
	assert.equal(sent[1].allocationTargets[0].target_id, 'debt')
})

test('a partially successful batch resumes its remaining source without rerunning completed sources', async () => {
	const h = await fixture(2, 40)
	const sent = []
	const first = await h.resumeOffsetAllocationBatch(h.batch, { persist: h.persist, query: notFound,
		allocate: async payload => { sent.push(copy(payload)); if (payload.receiptId === 'source-1') throw Error('timeout'); return saved(payload) } })
	assert.equal(first.status, 'pending')
	assert.equal(first.allocated_total, 24)
	const second = await h.resumeOffsetAllocationBatch(h.readOffsetAllocationBatch(h.stored(), 'customer'), { persist: h.persist, query: notFound,
		allocate: async payload => { sent.push(copy(payload)); return saved(payload) } })
	assert.equal(second.allocated_total, 40)
	assert.equal(sent.filter(p => p.receiptId === 'source-0').length, 1)
	assert.deepEqual(sent[1], sent[2])
	assert.equal(sent[2].amount, 16)
})

test('source-version rejection stops later sources and keeps the known successful amount', async () => {
	const h = await fixture(3, 60)
	const sent = []
	const result = await h.resumeOffsetAllocationBatch(h.batch, { persist: h.persist, query: notFound,
		allocate: async payload => { sent.push(payload.receiptId); return payload.receiptId === 'source-0' ? saved(payload) : { code: 409, msg: '来源余额已变化' } } })
	assert.equal(result.status, 'rejected')
	assert.equal(result.allocated_total, 24)
	assert.deepEqual(sent, ['source-0', 'source-1'])
	assert.match(result.message, /已变化/)
})

test('a retryable transaction conflict remains recoverable, and a query outage sends no new mutation', async () => {
	const h = await fixture()
	let writes = 0
	const first = await h.resumeOffsetAllocationBatch(h.batch, { persist: h.persist, query: notFound,
		allocate: async () => { writes++; return { code: 409, data: { retryable: true } } } })
	assert.equal(first.status, 'pending')
	const second = await h.resumeOffsetAllocationBatch(h.stored(), { persist: h.persist,
		query: async () => { throw Error('query offline') }, allocate: async () => { writes++ } })
	assert.equal(second.status, 'pending')
	assert.equal(writes, 1)
})

test('unavailable local persistence or malformed server result cannot silently start a fresh request', async () => {
	const h = await fixture()
	let writes = 0
	await assert.rejects(h.resumeOffsetAllocationBatch(h.batch, { persist: () => { throw Error('storage full') }, query: notFound, allocate: async () => { writes++ } }), /storage/)
	assert.equal(writes, 0)
	const result = await h.resumeOffsetAllocationBatch(h.batch, { persist: h.persist, query: notFound, allocate: async () => ({ code: 0, data: {} }) })
	assert.equal(result.status, 'pending')
	assert.equal(h.stored().rows[0].attempted, true)
	assert.throws(() => h.readOffsetAllocationBatch(h.stored(), 'other-customer'), /不完整/)
})

test('a source without deployed version information is rejected before submission', async () => {
	const h = await fixture()
	assert.throws(() => h.createOffsetAllocationBatch({ customerId: 'customer', sources: [{ _id: 'old', unallocated_amount: 24 }], amount: 24, allocation: {}, makeId: () => 'op' }), /校验信息/)
})

test('post-commit refresh warning retains success and three-decimal allocations are not truncated', async () => {
	const h = await fixture()
	h.batch.scale = 3; h.batch.amount = 0.001
	const result = await h.resumeOffsetAllocationBatch(h.batch, { persist: h.persist, query: notFound, allocate: async payload => ({ ...saved(payload), data: { ...saved(payload).data, balance_refresh_pending: true } }) })
	assert.equal(result.status, 'complete')
	assert.equal(result.allocated_total, 0.001)
	assert.match(result.message, /刷新待完成/)
})

test('sales save warning is shown instead of the plain success toast or promise of entering the pool', async () => {
	const { saleSaveWarning } = await warningPromise
	const vue = fs.readFileSync('src/components/domain/sale/SaleEditView.vue', 'utf8')
	const warningHandler = vue.slice(vue.indexOf('async function showSaleSaveWarning('), vue.indexOf('\nfunction buildOverCollectionReminder('))
	for (const name of ['onSubmitBusiness', 'onSubmitSettlement']) {
		const from = vue.indexOf(`async function ${name}()`), to = vue.indexOf('\nfunction ', from)
		const source = name === 'onSubmitBusiness' ? vue.slice(from, vue.indexOf('\nasync function onSubmitSettlement()', from)) : vue.slice(from, to)
		const modal = [], toasts = []
		const context = vm.createContext({ saleSaveWarning, webSaveReview: { value: null }, savedThisPage: { value: false }, pendingWebSave: { value: false }, refreshPendingWebSave() {}, acknowledgeWebSave() {}, loadDetail: async () => {}, submitting: { value: false }, submittingMode: { value: '' }, canSaveBusiness: { value: true }, canSaveSettlement: { value: true }, recordId: { value: 'sale' },
			form: { value: { date: '2026-10-30', customerId: 'customer' } }, showSettlementBlocks: { value: true }, syncSettlementStatusForSubmit() {}, validateSettlement: () => ({ ok: true }),
			submitSale: async () => ({ code: 0, data: { warning: '冲抵款同步失败' } }), submitSaleSettlement: async () => ({ code: 0, data: { warning: '冲抵款同步失败' } }),
			isBottleFlowWarningResult: () => false, SALE_LIST_REFRESH_KEY: 'refresh', navigateAfterSave() {}, buildOverCollectionReminder: () => { throw Error('must not promise credit on failed sync') },
			uni: { setStorageSync() {}, showToast: value => toasts.push(value), showModal: async value => modal.push(value) } })
		vm.runInContext(warningHandler, context)
		vm.runInContext(source, context)
		await context[name]()
		assert.equal(modal.length, 1)
		assert.match(modal[0].content, /同步失败/)
		assert.equal(toasts.length, 0)
	}
	assert.equal(saleSaveWarning({ code: 0, msg: '结算更新成功' }), '')
	assert.match(saleSaveWarning({ code: 0, msg: '创建成功（冲抵款未同步）' }), /未同步/)
})

test('retry credit requires an explicit click and calls only the saved-source retry endpoint once', async () => {
	const { saleSaveWarning } = await warningPromise
	const vue = fs.readFileSync('src/components/domain/sale/SaleEditView.vue', 'utf8')
	const handler = vue.slice(vue.indexOf('async function showSaleSaveWarning('), vue.indexOf('\nfunction buildOverCollectionReminder('))
	const calls = [], modals = [], context = vm.createContext({ saleSaveWarning, recordId: { value: 'another-sale' },
		retrySaleOffsetSyncV1: async id => { calls.push(id); return { code: 409, msg: '来源需核对' } },
		uni: { showModal: async options => { modals.push(options); return { confirm: false } }, showLoading() {}, hideLoading() {} } })
	vm.runInContext(handler, context)
	const pending = { code: 0, data: { warning: '冲抵同步失败', offset_sync: { status: 'pending', sale_id: 'saved-sale' } } }
	await context.showSaleSaveWarning(pending, '单据已保存')
	assert.equal(calls.length, 0)
	context.uni.showModal = async options => { modals.push(options); return { confirm: true } }
	await context.showSaleSaveWarning(pending, '单据已保存')
	assert.deepEqual(calls, ['saved-sale'])
	assert.equal(modals.at(-1).title, '单据已保存，入池仍待核对')
	await context.showSaleSaveWarning({ code: 0, data: { warning: '汇总待刷新', offset_sync: { status: 'completed', sale_id: 'saved-sale' } } }, '已保存')
	assert.equal(calls.length, 1)
})

test('legacy adjustment rejection closes only the local editor and cannot report accounting cancellation', async () => {
	const vue = fs.readFileSync('src/components/domain/customer/statement/CustomerStatementModule.vue', 'utf8')
	const source = vue.slice(vue.indexOf('async function cancelOffsetAdjustment('), vue.indexOf('\nasync function onSaveOffsetAdjustment('))
	const modals = []; let closed = 0
	const context = vm.createContext({ offsetAdjustingReceiptId: { value: 'legacy-credit' }, recordId: { value: 'customer' }, normalizeString: String,
		cancelReceiptAdjustmentV1: async () => ({ code: 409, msg: '历史冲抵调整须先核对原分配和快照' }), clearOffsetAdjustmentState: () => { closed++ },
		resetOffsetAllocateForm() {}, refreshAfterSave: async () => {}, uni: { showModal: async options => modals.push(options), showToast: () => { throw Error('must not report cancel success') } } })
	vm.runInContext(source, context)
	assert.equal(await context.cancelOffsetAdjustment({ silent: true }), true)
	assert.equal(closed, 1); assert.match(modals[0].content, /没有恢复或改写原分配/)
})

test('service forwards durable identity and source version to the cloud action', () => {
	const source = fs.readFileSync('src/services/customerSettlement.js', 'utf8')
	const slice = source.slice(source.indexOf('export async function allocateOffsetCreditV1'), source.indexOf('export async function removeOffsetCreditAllocationV1')).replaceAll('export ', '')
	const calls = [], context = vm.createContext({ callCloud: (name, params) => calls.push({ name, params }) })
	vm.runInContext(slice, context)
	context.allocateOffsetCreditV1({ customerId: 'customer', receiptId: 'source', operationId: 'stable', expectedSourceVersion: 'v1', amount: 24 })
	context.getOffsetCreditOperationV1({ customerId: 'customer', operationId: 'stable' })
	assert.equal(calls[0].params.data.operation_id, 'stable')
	assert.equal(calls[0].params.data.expected_source_version, 'v1')
	assert.equal(calls[1].params.action, 'getOffsetCreditOperationV1')
})

test('statement re-entry restores the unfinished batch before consulting the changed form', async () => {
	const h = await fixture()
	const vue = fs.readFileSync('src/components/domain/customer/statement/CustomerStatementModule.vue', 'utf8')
	const source = vue.slice(vue.indexOf('async function onAllocateOffsetCredit()'), vue.indexOf('\nasync function onBeginOffsetAdjustment('))
	const calls = [], pending = { value: null }
	const context = vm.createContext({ recordId: { value: 'customer' }, offsetAllocating: { value: false }, offsetPendingBatch: pending, offsetPendingRelease: { value: null }, offsetRecoveryError: { value: '' },
		offsetRecoveryKey: id => id, restoreOffsetAllocation: () => { pending.value = h.batch }, offsetAllocationProgress: h.offsetAllocationProgress,
		formatMoney: String, showConfirmModal: async () => true, runPendingOffsetAllocation: async batch => calls.push(batch),
		dedupeOffsetSourceRows: () => { throw Error('must not create from changed selection') }, uni: { showModal: async () => { throw Error('unexpected error') } } })
	vm.runInContext(source, context)
	await context.onAllocateOffsetCredit()
	assert.equal(calls.length, 1)
	assert.equal(calls[0].rows[0].operation_id, 'operation-1')
	context.showConfirmModal = async () => { context.recordId.value = 'other-customer'; return true }
	await context.onAllocateOffsetCredit()
	assert.equal(calls.length, 1)
})

test('failed cleanup after a completed allocation never reports that the money operation failed', async () => {
	const h = await fixture()
	const vue = fs.readFileSync('src/components/domain/customer/statement/CustomerStatementModule.vue', 'utf8')
	const source = vue.slice(vue.indexOf('async function runPendingOffsetAllocation('), vue.indexOf('\nasync function onAllocateOffsetCredit()'))
	const modals = [], context = vm.createContext({ recordId: { value: 'customer' }, offsetPendingBatch: { value: h.batch }, offsetCheckedTargetKeys: { value: [] },
		resumeOffsetAllocationBatch: async () => ({ status: 'complete', batch: { ...h.batch, status: 'complete' }, allocated_total: 24, applied_source_count: 1, message: '' }),
		allocateOffsetCreditV1() {}, getOffsetCreditOperationV1() {}, saveOffsetAllocation() {}, resetOffsetAllocateForm() {}, refreshAfterSave: async () => {}, formatMoney: String,
		uni: { removeStorageSync: () => { throw Error('storage unavailable') }, showModal: async options => modals.push(options) } })
	vm.runInContext(source, context)
	await context.runPendingOffsetAllocation(h.batch, 'key')
	assert.equal(modals[0].title, '冲抵已保存')
	assert.match(modals[0].content, /已确认冲抵.*24/)
	assert.equal(context.offsetPendingBatch.value.status, 'complete')
})
