'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const mapperSource = fs.readFileSync('src/services/mappers/customerDeposit.js', 'utf8')
const mapperPromise = import(`data:text/javascript;base64,${Buffer.from(mapperSource).toString('base64')}`)
const panelSource = fs.readFileSync('src/components/domain/customer/statement/CustomerDepositPanel.vue', 'utf8')
const panelScript = panelSource.split('<script setup>')[1].split('</script>')[0].replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '')

function depositStatement(params = {}, overrides = {}) {
	return { rule_version: 'customer-deposit/2026-09-12.1', read_complete: true, money_scale: 2,
		customer_id: params.customerId || 'c1', date_from: params.dateFrom || '2026-09-01', date_to: params.dateTo || '2026-09-12',
		version: 2, current_balance: 100, opening_balance: 100, received_total: 0, refunded_total: 0,
		transferred_total: 0, opening_transferred_total: 0, closing_balance: 100, entries: [], account_initialized: true, history_status: 'not_confirmed', ...overrides }
}

function savedOperation(params, extra = {}) {
	return { customer_id: params.customer_id, operation_id: params.operation_id,
		entry: { _id: 'd1', kind: params.kind || 'void', amount: params.amount || 10, biz_date: params.biz_date || '2026-09-12',
			status: 'posted', payment_method: params.payment_method || 'unknown' }, version: 3, balance: 110, ...extra }
}

function deferred() {
	let resolve, reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}

async function settle() { await new Promise(resolve => setImmediate(resolve)) }

async function panelHarness(overrides = {}) {
	const mapper = await mapperPromise
	const props = { customerId: 'c1', dateFrom: '2026-09-01', dateTo: '2026-09-12' }
	const watchers = []
	const storage = overrides.storage || new Map()
	const events = []
	const previews = [], writes = [], queries = []
	const context = vm.createContext({
		...mapper, console, Date, Math, Promise,
		defineProps: () => props, defineEmits: () => name => events.push(name),
		ref: value => ({ value }), reactive: value => value, computed: getter => ({ get value() { return getter() } }),
		watch: (getter, callback, options) => watchers.push({ getter, callback, options }), onBeforeUnmount: () => {},
		getRoleTemplate: () => overrides.role || 'finance', getUser: () => ({ _id: 'u1' }),
		canPageAction: () => overrides.permission !== false,
		uni: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
			showModal: options => options.success({ confirm: true }) },
		getDepositStatementV1: overrides.getStatement || (async params => ({ code: 0, data: depositStatement(params) })),
		previewDepositEntryV1: async params => { previews.push({ ...params }); return overrides.preview ? overrides.preview(params) : { code: 0, data: { before_balance: 100, after_balance: 100 + (params.amount || -10), current_version: params.expected_version, submission: { ...params } } } },
		createDepositEntryV1: async params => { writes.push({ ...params }); return overrides.create ? overrides.create(params) : { code: 0, data: savedOperation(params) } },
		voidDepositEntryV1: async params => { writes.push({ ...params }); return overrides.void ? overrides.void(params) : { code: 0, data: savedOperation(params) } },
		getDepositOperationV1: async params => { queries.push({ ...params }); return overrides.query ? overrides.query(params) : { code: 0, data: { customer_id: params.customer_id, operation_id: params.operation_id, found: false } } }
	})
	vm.runInContext(`${panelScript}\nglobalThis.panel = { form, statement, operation, preview, voidTarget, voidReason, loading, actionIssue, loadIssue, canPreview, canConfirm, fieldsLocked, unresolved, kindOptions, previewEntry, confirmEntry, beginVoid, previewVoid, confirmVoid, resetDraft, querySavedOperation, loadDepositStatement };`, context)
	watchers[0].callback()
	await settle()
	return { panel: context.panel, props, previews, writes, queries, events, storage, changeScope: () => watchers[0].callback(), changeForm: () => watchers[1].callback() }
}

function fillForm(panel, overrides = {}) {
	Object.assign(panel.form, { kind: 'receive', amount: '10.00', bizDate: '2026-09-12', paymentMethod: 'bank', voucherRef: '收据1', note: '', ...overrides })
}

test('deposit mapping refuses incomplete money, account, period, and duplicated source facts', async () => {
	const mapper = await mapperPromise
	const expected = { customerId: 'c1', dateFrom: '2026-09-01', dateTo: '2026-09-12' }
	const valid = depositStatement()
	assert.ok(mapper.normalizeCustomerDepositStatement(valid, expected))
	for (const field of ['current_balance', 'opening_balance', 'received_total', 'refunded_total', 'transferred_total', 'opening_transferred_total', 'closing_balance', 'money_scale', 'entries', 'account_initialized', 'history_status']) {
		const missing = { ...valid }; delete missing[field]
		assert.equal(mapper.normalizeCustomerDepositStatement(missing, expected), null, field)
	}
	for (const patch of [{ read_complete: false }, { customer_id: 'c2' }, { date_from: '2026-08-01' }, { current_balance: '0' }, { closing_balance: 99 }, { version: 0.5 }]) {
		assert.equal(mapper.normalizeCustomerDepositStatement({ ...valid, ...patch }, expected), null)
	}
	const original = { _id: 'd1', customer_id: 'c1', kind: 'receive', amount: 10, biz_date: '2026-09-03', status: 'void', payment_method: 'bank' }
	const voidFact = { ...original, _id: 'd2', kind: 'void', status: 'posted', payment_method: 'unknown', original_entry_id: 'd1', reason: '核对后撤回' }
	assert.ok(mapper.normalizeCustomerDepositStatement({ ...valid, entries: [original, voidFact] }, expected))
	assert.equal(mapper.normalizeCustomerDepositStatement({ ...valid, entries: [original, original] }, expected), null)
	assert.equal(mapper.depositMoneyText(undefined), '未完成')
})

test('deposit inputs preserve exact cents, real dates, and internal transfer origin', async () => {
	const mapper = await mapperPromise
	assert.equal(mapper.parseDepositAmount('20000.01'), 20000.01)
	for (const value of ['', '0', '-1', '1e3', '2.001', 'NaN', '1,000']) assert.equal(mapper.parseDepositAmount(value), null)
	assert.equal(mapper.isDepositDate('2026-02-30'), false)
	const base = { kind: 'receive', amount: '10.25', bizDate: '2026-09-12', paymentMethod: 'unknown', voucherRef: '  凭据1  ' }
	assert.equal(mapper.buildDepositEntryInput(base, 'c1').payment_method, 'unknown')
	for (const kind of ['opening', 'transfer']) assert.equal(mapper.buildDepositEntryInput({ ...base, kind, paymentMethod: 'cash' }, 'c1').payment_method, 'unknown')
	const input = mapper.buildDepositEntryInput(base, 'c1')
	assert.equal(mapper.depositOperationFingerprint({ ...input, expected_version: 2 }), mapper.depositOperationFingerprint({ ...input, expected_version: 3 }))
})

test('same deposit content keeps its operation across previews and account version changes; edits require another identity', async () => {
	const h = await panelHarness()
	fillForm(h.panel)
	await h.panel.previewEntry()
	const id = h.panel.operation.value.operation_id
	h.panel.statement.value.version = 3
	await h.panel.previewEntry()
	assert.equal(h.panel.operation.value.operation_id, id)
	assert.equal(h.previews[1].expected_version, 3)
	assert.equal(h.writes.length, 0)
	h.panel.form.amount = '11.00'; h.changeForm()
	assert.equal(h.panel.canConfirm.value, false)
	await h.panel.previewEntry()
	assert.notEqual(h.panel.operation.value.operation_id, id)
	assert.equal(h.previews[2].amount, 11)
})

test('ambiguous save queries its original identity, locks content, and retries using the same payload', async () => {
	let attempts = 0
	const h = await panelHarness({ create: async params => {
		if (++attempts === 1) throw new Error('timeout')
		return { code: 0, data: savedOperation(params) }
	} })
	fillForm(h.panel)
	await h.panel.previewEntry()
	const id = h.panel.operation.value.operation_id
	await h.panel.confirmEntry()
	assert.equal(h.queries.length, 1)
	assert.equal(h.queries[0].operation_id, id)
	assert.equal(h.panel.operation.value.status, 'retryable')
	assert.equal(h.panel.fieldsLocked.value, true)
	h.panel.resetDraft()
	assert.equal(h.panel.operation.value.operation_id, id)
	await h.panel.confirmEntry()
	assert.equal(h.writes.length, 2)
	assert.deepEqual(h.writes[0], h.writes[1])
	assert.equal(h.panel.operation.value.status, 'saved')
	assert.equal(h.events.length, 1)
	await h.panel.confirmEntry()
	assert.equal(h.writes.length, 2)
})

test('a save that timed out after committing is recovered by read without another write', async () => {
	let written
	const h = await panelHarness({ create: async params => { written = params; throw new Error('lost response') },
		query: async () => ({ code: 0, data: savedOperation(written, { found: true }) }) })
	fillForm(h.panel)
	await h.panel.previewEntry()
	await h.panel.confirmEntry()
	assert.equal(h.writes.length, 1)
	assert.equal(h.panel.operation.value.status, 'saved')
	assert.equal(h.panel.canConfirm.value, false)
})

test('transaction status unknown returned as conflict remains locked and recovers using the original operation', async () => {
	const h = await panelHarness({ create: async () => ({ code: 409, msg: '提交回执未完成', data: { commit_status_unknown: true } }) })
	fillForm(h.panel)
	await h.panel.previewEntry()
	const id = h.panel.operation.value.operation_id
	await h.panel.confirmEntry()
	assert.equal(h.panel.operation.value.operation_id, id)
	assert.equal(h.panel.operation.value.status, 'retryable')
	assert.equal(h.panel.fieldsLocked.value, true)
	assert.equal(h.panel.preview.value !== null, true)
	assert.equal(h.queries[0].operation_id, id)
	h.panel.resetDraft()
	assert.equal(h.panel.operation.value.operation_id, id)
	await h.panel.confirmEntry()
	assert.deepEqual(h.writes[0], h.writes[1])
})

test('restoring an interrupted save keeps the identity and requires query before editing', async () => {
	const pending = deferred()
	const original = await panelHarness({ create: () => pending.promise })
	fillForm(original.panel)
	await original.panel.previewEntry()
	const id = original.panel.operation.value.operation_id
	const write = original.panel.confirmEntry()
	await settle()
	const restored = await panelHarness({ storage: original.storage })
	assert.equal(restored.panel.operation.value.operation_id, id)
	assert.equal(restored.panel.operation.value.status, 'unknown')
	assert.equal(restored.panel.fieldsLocked.value, true)
	assert.equal(restored.writes.length, 0)
	await restored.panel.querySavedOperation()
	assert.equal(restored.queries[0].operation_id, id)
	pending.resolve({ code: 0, data: savedOperation(original.writes[0]) })
	await write
})

test('late read cannot replace a newer customer or period; late write cannot populate its form', async () => {
	const oldRead = deferred(), freshRead = deferred()
	const h = await panelHarness({ getStatement: params => params.customerId === 'c1' ? oldRead.promise : freshRead.promise })
	h.props.customerId = 'c2'; h.props.dateFrom = '2026-08-01'; h.changeScope()
	freshRead.resolve({ code: 0, data: depositStatement({ customerId: 'c2', dateFrom: '2026-08-01', dateTo: '2026-09-12' }, { current_balance: 80, opening_balance: 80, closing_balance: 80 }) })
	await settle()
	oldRead.resolve({ code: 0, data: depositStatement() })
	await settle()
	assert.equal(h.panel.statement.value.customer_id, 'c2')
	assert.equal(h.panel.statement.value.opening_balance, 80)
	const lateSave = deferred()
	const writer = await panelHarness({ create: () => lateSave.promise })
	fillForm(writer.panel); await writer.panel.previewEntry()
	const inFlight = writer.panel.confirmEntry()
	await settle()
	writer.props.customerId = 'c2'; writer.changeScope(); await settle()
	lateSave.resolve({ code: 0, data: savedOperation(writer.writes[0]) })
	await inFlight
	assert.equal(writer.panel.statement.value.customer_id, 'c2')
	assert.equal(writer.panel.operation.value, null)
	assert.equal(writer.panel.form.amount, '')
	assert.equal(writer.events.length, 0)
})

test('incomplete statements and unsupported account permission do not permit a preview or write', async () => {
	for (const overrides of [{ getStatement: async params => ({ code: 0, data: depositStatement(params, { received_total: undefined }) }) }, { permission: false }]) {
		const h = await panelHarness(overrides)
		fillForm(h.panel); await h.panel.previewEntry(); await h.panel.confirmEntry()
		assert.equal(h.previews.length, 0)
		assert.equal(h.writes.length, 0)
	}
	const restricted = await panelHarness({ role: 'user' })
	assert.equal(restricted.panel.kindOptions.value.some(item => item.value === 'opening'), false)
	fillForm(restricted.panel, { kind: 'opening' }); await restricted.panel.previewEntry()
	assert.equal(restricted.previews.length, 0)
})

test('void records require a reason, retain source amount/date, and call only the dedicated action', async () => {
	const h = await panelHarness()
	const source = { entry_id: 'd1', kind: 'receive', amount: 10, biz_date: '2026-09-03', status: 'posted', payment_method: 'bank' }
	h.panel.beginVoid(source)
	await h.panel.confirmVoid()
	assert.equal(h.writes.length, 0)
	h.panel.voidReason.value = ' 收据重复，核准撤回 '
	await h.panel.confirmVoid()
	assert.equal(h.writes.length, 0)
	await h.panel.previewVoid()
	await h.panel.confirmVoid()
	assert.equal(h.writes.length, 1)
	assert.equal(h.writes[0].entry_id, 'd1')
	assert.equal(h.writes[0].reason, '收据重复，核准撤回')
	assert.equal('amount' in h.writes[0], false)
	assert.equal(h.panel.voidTarget.value.amount, source.amount)
	assert.equal(h.panel.voidTarget.value.biz_date, source.biz_date)
})

test('deposit and opening sources expose allocation without ordinary source editing or deletion', () => {
	const source = fs.readFileSync('src/components/domain/customer/statement/CustomerStatementModule.vue', 'utf8')
	const helpers = source.slice(source.indexOf('function isCashierReceiptSourceType('), source.indexOf('\nfunction receiptAllocationText('))
	const context = vm.createContext({ normalizeString: value => String(value || '').trim(), fix2: value => value, toNumber: (value, fallback) => Number(value ?? fallback) })
	vm.runInContext(helpers, context)
	for (const sourceType of ['deposit_transfer', 'opening_prepay']) {
		const row = { source_type: sourceType, allocated_amount: 10, unallocated_amount: 20 }
		assert.equal(context.canEditReceiptAllocation(row), false)
		assert.equal(context.canContinuePrepayReceipt(row), true)
		assert.equal(context.isManualPrepayReceiptRow(row), true)
		assert.equal(context.receiptAmountLabel(row), '转入')
		for (const name of ['onEditReceipt', 'onRemoveReceipt', 'onBeginOffsetAdjustment', 'onRemoveOffsetAllocation']) {
			const start = source.indexOf(`async function ${name}(`)
			const next = source.indexOf('\nasync function ', start + 1)
			const action = source.slice(start, next === -1 ? source.length : next)
			assert.match(action, /if \(isOpeningPrepayReceipt\(row\) \|\| isDepositTransferReceipt\(row\)\)/, name)
		}
	}
})
