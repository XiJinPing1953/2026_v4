'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module')
const { optimisticDb } = require('./lib/optimisticAccountingDb.cjs')

function fixture() {
	const state = { crm_users: [{ _id: 'actor', token: 'test', role: 'superadmin', username: '合成用户' }],
		crm_customers: [{ _id: 'customer', name: '合成客户', price_unit: 'kg', default_price_unit: 'kg', default_unit_price: 8, updated_at: 1 }],
		crm_sale_records: [{ _id: 'sale', customer_id: 'customer', date: '2026-10-30', biz_mode: 'bottle', settlement_mode: 'sale', price_unit: 'kg', unit_price: 8,
			out_items: [{ net: 11 }], back_items: [], amount_received: 0, rounding_amount: 0, payment_status: 'unpaid', payment_method: 'on_account', offset_enabled: false, apply_offset_credit: false, updated_at: 1 }],
		crm_customer_receipts: [{ _id: 'credit', customer_id: 'customer', amount: 88, allocated_amount: 0, unallocated_amount: 88, rounding_amount: 0, rounding_allocated_amount: 0,
			status: 'posted', source_type: 'sale_offset_credit', source_id: 'prior-sale', entry_kind: 'offset_credit', biz_date: '2026-10-29', created_at: 1, updated_at: 1 }],
		crm_customer_allocations: [], crm_operation_logs: [], crm_bottles: [], crm_customer_opening_debts: [] }
	state.crm_sale_records.push({ ...state.crm_sale_records[0], _id: 'prior-sale', date: '2026-10-29', out_items: [], back_items: [{ net: 11 }], payment_status: 'paid', offset_enabled: true })
	const db = optimisticDb(state), handlers = {}, calls = []
	let failUse = false, failQuery = false, loseUseResponse = false
	function load(name) {
		const filename = path.resolve('uniCloud-alipay/cloudfunctions', name, 'index.js')
		const context = { exports: {}, require: createRequire(filename), uniCloud: { database: () => db, callFunction: async args => {
			calls.push(args)
			if (args.name !== 'crm-customer-settlement') return { result: { code: 0, data: {} } }
			if (failUse && args.data.action === 'autoApplyPrepayToSaleV1') return { result: failUse === 'malformed' ? { code: 0, data: {} } : { code: 500, msg: '合成使用冲抵中断' } }
			if (failQuery && args.data.action === 'getSaleOffsetUseOperationV1') return { result: { code: 500, msg: '合成查询中断' } }
			const result = await handlers[args.name](args.data, { requestId: 'child' })
			if (loseUseResponse && args.data.action === 'autoApplyPrepayToSaleV1' && result.code === 0) throw Error('合成提交后响应丢失')
			return { result }
		} }, Date, Math, Set, Map, Buffer, process, setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} } }
		vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename }); return context.exports.main
	}
	handlers['crm-customer-settlement'] = load('crm-customer-settlement'); handlers['crm-sale'] = load('crm-sale')
	return { state, calls, setFailUse: value => { failUse = value }, setFailQuery: value => { failQuery = value }, setLoseResponse: value => { loseUseResponse = value },
		invoke: (action, data) => handlers['crm-sale']({ action, token: 'test', data }, { requestId: 'parent' }) }
}
const begin = h => h.invoke('updateSettlementV1', { recordId: 'sale', settlement: { applyOffsetCredit: true } })
const accounting = h => JSON.stringify([h.state.crm_sale_records, h.state.crm_customer_receipts, h.state.crm_customer_allocations])

test('failed use is saved as its own operation; note save cannot replay it, and explicit retry consumes exactly once', async () => {
	const h = fixture(); h.setFailUse(true)
	const first = await begin(h)
	assert.equal(first.code, 0, first.msg); assert.equal(first.data.offset_use.status, 'pending'); assert.match(first.data.warning, /合成使用冲抵中断/)
	const sale = h.state.crm_sale_records.find(row => row._id === 'sale'), operationId = sale.offset_use_revision
	assert.ok(operationId); assert.equal(sale.offset_sync_revision, undefined); assert.equal(sale.amount_received, 0)
	assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 88)
	h.calls.length = 0; h.setFailUse(false)
	const note = await h.invoke('updateSettlementV1', { recordId: 'sale', settlement: { paymentNote: '只更新备注', applyOffsetCredit: false } })
	assert.equal(note.code, 0, note.msg); assert.equal(note.data.offset_use.operation_id, operationId)
	assert.equal(h.calls.some(call => call.data.action === 'autoApplyPrepayToSaleV1'), false)
	assert.equal(h.state.crm_sale_records.find(row => row._id === 'sale').offset_use_revision, operationId)
	const retry = await h.invoke('retryOffsetUseV1', { sale_id: 'sale', operation_id: operationId })
	assert.equal(retry.code, 0, retry.msg); assert.equal(retry.data.offset_use.status, 'completed'); assert.equal(retry.data.offset_use.applied_amount, 88)
	assert.equal(h.state.crm_sale_records.find(row => row._id === 'sale').offset_use_status, 'completed'); assert.equal(h.state.crm_sale_records.find(row => row._id === 'sale').apply_offset_credit, false)
	assert.equal(h.state.crm_sale_records.find(row => row._id === 'sale').amount_received, 88); assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 0)
	const before = accounting(h); h.calls.length = 0
	const again = await h.invoke('retryOffsetUseV1', { sale_id: 'sale', operation_id: operationId })
	assert.equal(again.code, 0, again.msg); assert.equal(accounting(h), before)
	assert.equal(h.calls.some(call => call.data.action === 'autoApplyPrepayToSaleV1'), false)
})

test('lost committed use response is recovered by query without another source mutation', async () => {
	const h = fixture(); h.setLoseResponse(true)
	const first = await begin(h)
	assert.equal(first.code, 0, first.msg); assert.equal(first.data.offset_use.status, 'pending')
	assert.equal(h.state.crm_sale_records.find(row => row._id === 'sale').amount_received, 88)
	const before = accounting(h); h.calls.length = 0; h.setLoseResponse(false)
	const retry = await h.invoke('retryOffsetUseV1', { sale_id: 'sale', operation_id: first.data.offset_use.operation_id })
	assert.equal(retry.code, 0, retry.msg); assert.equal(accounting(h), before)
	assert.equal(h.calls.some(call => call.data.action === 'autoApplyPrepayToSaleV1'), false)
})

test('a success-shaped response without the original operation confirmation stays pending', async () => {
	const h = fixture(); h.setFailUse('malformed')
	const result = await begin(h)
	assert.equal(result.code, 0, result.msg); assert.equal(result.data.offset_use.status, 'pending')
	assert.match(result.data.warning, /缺少原操作确认/)
	assert.equal(h.state.crm_sale_records.find(row => row._id === 'sale').offset_use_status, 'pending')
	assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 88)
})

test('query failure sends no use mutation and a pending use cannot be replaced by a financial save', async () => {
	const h = fixture(); h.setFailUse(true); const first = await begin(h)
	const before = accounting(h); h.setFailQuery(true); h.calls.length = 0
	const retry = await h.invoke('retryOffsetUseV1', { sale_id: 'sale', operation_id: first.data.offset_use.operation_id })
	assert.equal(retry.code, 500); assert.equal(accounting(h), before)
	assert.equal(h.calls.some(call => call.data.action === 'autoApplyPrepayToSaleV1'), false)
	const changed = await h.invoke('updateSettlementV1', { recordId: 'sale', settlement: { amountReceived: 8, paymentStatus: 'partial', paymentMethod: 'cash', applyOffsetCredit: true } })
	assert.equal(changed.code, 409, changed.msg); assert.equal(accounting(h), before)
	const removed = await h.invoke('removeV2', { id: 'sale', recordId: 'sale' })
	assert.equal(removed.code, 409, removed.msg); assert.equal(accounting(h), before)
})

test('retry requires use permission and cannot fabricate an operation for a historical sale', async () => {
	const h = fixture(), before = accounting(h)
	assert.equal((await h.invoke('retryOffsetUseV1', { sale_id: 'sale' })).code, 409)
	h.state.crm_users[0] = { _id: 'actor', token: 'test', role: 'finance', page_permissions: { '/pages/sale/settlement': { update: true }, '/pages/sale/apply-offset-credit': {} } }
	assert.equal((await h.invoke('retryOffsetUseV1', { sale_id: 'sale' })).code, 403)
	assert.equal(accounting(h), before)
})

test('use waits for its pending source sync, and a later summary retry keeps the original sync request version', async () => {
	const h = fixture(), sale = h.state.crm_sale_records.find(row => row._id === 'sale')
	Object.assign(sale, { offset_sync_revision: 'pending-pool-op', offset_sync_status: 'pending' })
	const first = await begin(h)
	assert.equal(first.code, 0, first.msg); assert.equal(first.data.offset_use.status, 'pending'); assert.equal(first.data.offset_sync.status, 'pending')
	assert.equal(h.calls.some(call => call.data.action === 'autoApplyPrepayToSaleV1'), false)
	assert.equal((await h.invoke('retryOffsetUseV1', { sale_id: 'sale', operation_id: first.data.offset_use.operation_id })).code, 409)
	assert.equal(h.state.crm_sale_records.find(row => row._id === 'sale').amount_received, 0)
	const synced = await h.invoke('retryOffsetSyncV1', { sale_id: 'sale', operation_id: 'pending-pool-op' })
	assert.equal(synced.code, 0, synced.msg)
	const used = await h.invoke('retryOffsetUseV1', { sale_id: 'sale', operation_id: first.data.offset_use.operation_id })
	assert.equal(used.code, 0, used.msg)
	const log = h.state.crm_operation_logs.find(row => row.action === 'sale_offset_credit_sync_v1')
	log.detail.balance_refresh_pending = true
	const before = accounting(h)
	const refreshed = await h.invoke('retryOffsetSyncV1', { sale_id: 'sale', operation_id: 'pending-pool-op' })
	assert.equal(refreshed.code, 0, refreshed.msg); assert.equal(refreshed.data.balance_refresh_pending, false)
	assert.equal(accounting(h), before)
})

const warningModule = import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync('src/services/models/saleSaveWarning.js')).toString('base64')}`)
test('frontend gives each pending action its own explicit retry and refreshes the original sale without saving it', async () => {
	const { saleSaveWarning, pendingSaleOffsetActions } = await warningModule
	const vue = fs.readFileSync('src/components/domain/sale/SaleEditView.vue', 'utf8')
	const handler = vue.slice(vue.indexOf('async function showSaleSaveWarning('), vue.indexOf('\nfunction buildOverCollectionReminder('))
	const calls = [], prompts = [], refreshed = []
	const context = vm.createContext({ saleSaveWarning, recordId: { value: 'sale' },
		retrySaleOffsetSyncV1: async id => { calls.push(['sync', id]); return { code: 0, data: { status: 'completed' } } },
		retrySaleOffsetUseV1: async (id, op) => { calls.push(['use', id, op]); return { code: 0, data: { offset_use: { status: 'completed', applied_amount: 88 } } } },
		loadDetail: async (id, options) => refreshed.push({ id, ...options }),
		uni: { showModal: async options => { prompts.push(options); return { confirm: options.confirmText === '查询并继续冲抵' } }, showToast() {}, showLoading() {}, hideLoading() {} } })
	vm.runInContext(handler, context)
	const pending = pendingSaleOffsetActions({ _id: 'sale', offset_sync_revision: 'pool-op', offset_sync_status: 'pending', offset_use_revision: 'use-op', offset_use_status: 'pending' })
	await context.showSaleSaveWarning(pending, '待核对')
	assert.deepEqual(calls, [['use', 'sale', 'use-op']]); assert.equal(prompts.length, 2)
	assert.equal(prompts[0].confirmText, '重试入池'); assert.equal(prompts[1].confirmText, '查询并继续冲抵')
	assert.deepEqual(refreshed, [{ id: 'sale', force: true, showRecovery: false }])
	context.uni.showModal = async () => ({ confirm: false }); calls.length = 0
	await context.showSaleSaveWarning(pending, '待核对'); assert.equal(calls.length, 0)
	assert.match(saleSaveWarning({ code: 0, data: { offset_use: { status: 'pending' } } }), /使用冲抵/)
})

test('frontend use retry forwards the original operation id', async () => {
	const source = fs.readFileSync('src/services/sale.js', 'utf8')
	const code = source.slice(source.indexOf('export async function retrySaleOffsetUseV1'), source.indexOf('\nconst SALE_SAVE_TIMEOUT_MS')).replace('export ', '')
	const calls = [], context = vm.createContext({ callCloud: (name, options) => calls.push({ name, options }) })
	vm.runInContext(code, context); await context.retrySaleOffsetUseV1('sale', 'original-use')
	assert.equal(calls[0].options.action, 'retryOffsetUseV1'); assert.equal(calls[0].options.data.operation_id, 'original-use')
})
