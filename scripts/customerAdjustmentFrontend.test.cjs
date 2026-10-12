'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const code = fs.readFileSync('src/composables/useCustomerAdjustment.js', 'utf8').replace(/^import .*$/m, '').replaceAll('export ', '')
const context = vm.createContext({ ...vue, onBeforeUnmount: () => {} })
vm.runInContext(code, context)
const settle = () => new Promise(resolve => setImmediate(resolve))
const copy = value => JSON.parse(JSON.stringify(value))
const source = (patch = {}) => ({ source_key: 'sale-rounding:s1', version: 'v1', type: 'sale', id: 's1', date: '2026-08-18', label: '销售抹零', amount: 37.5, processed: 0, available: 37.5, ...patch })
const statement = (patch = {}) => ({ complete: true, money_scale: 2, sources: [source()], adjustments: [], ...patch })
const success = value => ({ code: 0, data: value })
const saved = input => success({ status: input.void_id ? 'voided' : 'saved', operation_id: input.operation_id, adjustment_id: 'adj-1', kind: input.kind })
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function harness(overrides = {}) {
	const scope = vue.effectScope(), storage = overrides.storage || new Map(), writes = [], previews = [], queries = [], events = []
	const customerId = vue.ref('c1'), kind = vue.ref(overrides.kind || 'rounding_reversal'), canWrite = vue.ref(overrides.canWrite !== false)
	const storageApi = overrides.storageApi || {
		setStorageSync: (key, value) => { if (overrides.storageFailure) throw Error('storage full'); storage.set(key, copy(value)) },
		getStorageSync: key => storage.get(key)
	}
	const api = {
		sources: overrides.sources || (async () => success(statement())),
		preview: async input => { previews.push(copy(input)); return overrides.preview ? overrides.preview(input) : success({ value: input, plan_hash: 'server-plan', effects: { receivable_delta: 37.5, available_delta: 0, income_delta: 0, cash_delta: 0 }, source: source() }) },
		post: async input => { writes.push(copy(input)); return overrides.post ? overrides.post(input, storage) : saved(input) },
		void: async input => { writes.push(copy(input)); return overrides.void ? overrides.void(input) : saved(input) },
		query: async input => { queries.push(copy(input)); return overrides.query ? overrides.query(input) : success({ status: 'not_found' }) }
	}
	const panel = scope.run(() => context.useCustomerAdjustment({ customerId, kind, canWrite, api, storage: storageApi, actorId: 'u1', onChanged: result => events.push(result) }))
	await settle()
	return { panel, customerId, kind, canWrite, storage, writes, previews, queries, events, stop: () => scope.stop() }
}
function fill(panel, patch = {}) { Object.assign(panel.form, { source_key: 'sale-rounding:s1', amount: '10.25', biz_date: '2026-10-12', note: '核实原抹零记错', evidence: '客户核准记录1', ...patch }) }

test('adjustment source completeness, exact precision and actual dates are required', () => {
	assert.ok(context.normalizeAdjustmentSources(statement()))
	for (const patch of [{ complete: false }, { sources: [source(), source()] }, { sources: [source({ available: undefined })] }, { sources: [source({ amount: '37.5' })] }, { adjustments: undefined }]) assert.equal(context.normalizeAdjustmentSources(statement(patch)), null)
	assert.equal(context.adjustmentAmount('20000.01'), 20000.01)
	assert.equal(context.adjustmentAmount('0.001', 3), 0.001)
	for (const value of ['', '-1', '0', '1e3', '2.001', '1,000', 'Infinity']) assert.equal(context.adjustmentAmount(value), null)
	assert.equal(context.adjustmentDate('2026-02-30'), false)
	assert.equal(context.adjustmentDate('2026-10-12'), true)
	assert.equal(context.adjustmentMoney(undefined), '待核')
})

test('optional before/after balances preserve all server numbers without reconstructing from deltas', () => {
	const preview = { effects: { receivable_delta: 99 }, balances: { before: { receivable_balance: 90, prepay_balance: 100, net_balance: -10 }, after: { receivable_balance: 222, prepay_balance: 88, net_balance: 134 } } }
	const rows = context.adjustmentPreviewBalances(preview)
	assert.equal(rows.length, 3)
	assert.equal(rows[0].before, 90)
	assert.equal(rows[0].after, 222)
	assert.equal(rows[2].after, 134)
	assert.equal(context.adjustmentPreviewBalances({ effects: preview.effects }).length, 0)
	assert.equal(context.adjustmentPreviewBalances({ balances: { ...preview.balances, after: { receivable_balance: 222, prepay_balance: 88, net_balance: undefined } } }).length, 0)
})

test('production uni compiler injects explicit storage APIs and compiled adapter loads sources without a global uni object', async () => {
	const path = require('node:path'), acorn = require('acorn'), { parse, compileScript } = require('@vue/compiler-sfc')
	const previous = { UNI_INPUT_DIR: process.env.UNI_INPUT_DIR, UNI_PLATFORM: process.env.UNI_PLATFORM }
	try {
		process.env.UNI_INPUT_DIR = path.resolve('src'); process.env.UNI_PLATFORM = 'h5'
		const { uniInjectPlugin } = require('@dcloudio/uni-h5-vite/dist/plugins/inject')
		const plugin = uniInjectPlugin()
		plugin.configResolved({ root: process.cwd(), build: { cssCodeSplit: true } })
		const file = path.resolve('src/components/domain/customer/statement/CustomerAdjustmentPanel.vue')
		const compiled = compileScript(parse(fs.readFileSync(file, 'utf8'), { filename: file }).descriptor, { id: 'adjustment-storage-regression' }).content
		const parseJs = code => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
		const transformed = plugin.transform.call({ parse: parseJs }, compiled, file + '?vue&type=script&setup=true&lang.js').code
		const ast = parseJs(transformed)
		const imports = ast.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === '@dcloudio/uni-h5').flatMap(node => node.specifiers)
		for (const api of ['getStorageSync', 'setStorageSync']) assert.ok(imports.some(specifier => specifier.imported?.name === api), `${api} must be imported by the actual H5 compiler`)
		let storageNode
		function visit(node) {
			if (!node || typeof node !== 'object') return
			if (node.type === 'Property' && node.key?.name === 'storage') storageNode = node.value
			for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
		}
		visit(ast)
		assert.equal(storageNode?.type, 'ObjectExpression')
		const stored = new Map(), calls = []
		const runtime = vm.createContext({}) // Deliberately no global `uni`.
		for (const specifier of imports) {
			if (specifier.imported.name === 'getStorageSync') runtime[specifier.local.name] = key => { calls.push(['get', key]); return stored.get(key) }
			if (specifier.imported.name === 'setStorageSync') runtime[specifier.local.name] = (key, value) => { calls.push(['set', key]); stored.set(key, copy(value)) }
		}
		vm.runInContext(`globalThis.adapter = (${transformed.slice(storageNode.start, storageNode.end)})`, runtime)
		let sourceReads = 0
		const h = await harness({ storageApi: runtime.adapter, sources: async () => { sourceReads += 1; return success(statement()) } })
		assert.equal(sourceReads, 1)
		assert.equal(h.panel.ready.value, true)
		assert.equal(h.panel.loadIssue.value, '')
		fill(h.panel); await h.panel.prepare(); await h.panel.submit()
		assert.equal(h.writes.length, 1)
		assert.equal(h.events.length, 1)
		assert.ok(calls.some(([action]) => action === 'get'))
		assert.ok(calls.some(([action]) => action === 'set'))
		h.stop()
	} finally {
		for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value
	}
})

test('rounding reversal evidence is optional; reason remains required and writeoff evidence remains required', async () => {
	const rounding = await harness()
	fill(rounding.panel, { evidence: '' })
	await rounding.panel.prepare()
	assert.equal(rounding.panel.canConfirm.value, true)
	assert.equal(rounding.previews[0].evidence, '')
	rounding.panel.form.note = ''
	await rounding.panel.prepare()
	assert.equal(rounding.panel.canConfirm.value, false)
	assert.match(rounding.panel.issue.value, /调整原因/)
	rounding.stop()
	const writeoff = await harness({ kind: 'prepay_writeoff' })
	fill(writeoff.panel, { evidence: '', confirm_no_refund_or_offset: true })
	await writeoff.panel.prepare()
	assert.equal(writeoff.previews.length, 0)
	assert.match(writeoff.panel.issue.value, /确认依据/)
	writeoff.stop()
})

test('preview uses server effects unchanged and any amount/date/source/version edit invalidates confirmation', async () => {
	const h = await harness({ preview: async input => success({ value: input, plan_hash: 'p', effects: { receivable_delta: 11.11, available_delta: -7.77, income_delta: 2.22, cash_delta: 0 } }) })
	fill(h.panel)
	for (const edit of [() => { h.panel.form.amount = '11.25' }, () => { h.panel.form.biz_date = '2026-10-11' }, () => { h.panel.form.evidence = '新依据' }, () => { h.panel.statement.value.sources[0].version = 'v2' }, () => { h.panel.form.source_key = '' }]) {
		await h.panel.prepare()
		assert.equal(h.panel.canConfirm.value, true)
		assert.equal(h.panel.preview.value.effects.receivable_delta, 11.11)
		assert.equal(h.panel.preview.value.effects.income_delta, 2.22)
		edit()
		assert.equal(h.panel.preview.value, null)
		assert.equal(h.panel.canConfirm.value, false)
	}
	h.stop()
})

test('write persists a fixed operation before sending and emits changed only after confirmed save', async () => {
	let storedBeforeSend
	const h = await harness({ post: async (input, storage) => { storedBeforeSend = copy([...storage.values()][0]); return saved(input) } })
	fill(h.panel); await h.panel.prepare(); const id = h.panel.operation.value.operation_id
	await h.panel.submit()
	assert.equal(h.writes.length, 1)
	assert.equal(storedBeforeSend.operation_id, id)
	assert.equal(storedBeforeSend.status, 'submitting')
	assert.equal(h.events.length, 1)
	assert.equal(h.panel.operation.value, null)
	assert.equal([...h.storage.values()][0].status, 'saved')
	h.stop()
})

test('unknown writes stay locked across remount; not_found allows only identical operation retry', async () => {
	const h = await harness({ post: async () => { throw Error('timeout') } })
	fill(h.panel); await h.panel.prepare(); await h.panel.submit()
	const original = copy(h.writes[0])
	assert.equal(h.panel.operation.value.status, 'unknown')
	assert.equal(h.panel.locked.value, true)
	h.panel.reset(); await h.panel.prepare(); await h.panel.submit()
	assert.equal(h.writes.length, 1)
	assert.equal(h.previews.length, 1)
	h.stop()
	const restored = await harness({ storage: h.storage })
	assert.equal(restored.panel.operation.value.operation_id, original.operation_id)
	assert.equal(restored.panel.operation.value.status, 'unknown')
	await restored.panel.retry()
	assert.equal(restored.writes.length, 0)
	await restored.panel.queryOperation()
	assert.equal(restored.panel.operation.value.status, 'retryable')
	await restored.panel.retry()
	assert.deepEqual(restored.writes[0], original)
	assert.equal(restored.events.length, 1)
	restored.stop()
})

test('successful result query resolves unknown write without a second submission', async () => {
	const h = await harness({ post: async () => success({ status: 'pending' }), query: async input => saved(input) })
	fill(h.panel); await h.panel.prepare(); await h.panel.submit(); await h.panel.queryOperation()
	assert.equal(h.writes.length, 1)
	assert.equal(h.events.length, 1)
	assert.equal(h.panel.operation.value, null)
	h.stop()
})

test('generic errors do not unlock unknown writes; explicit not_written rejection permits re-preview', async () => {
	for (const explicit of [false, true]) {
		const h = await harness({ post: async () => ({ code: 409, msg: '来源已变化', ...(explicit ? { details: { write_status: 'not_written' } } : {}) }) })
		fill(h.panel); await h.panel.prepare(); const id = h.panel.operation.value.operation_id; await h.panel.submit()
		assert.equal(h.panel.unresolved.value, !explicit)
		if (explicit) { await h.panel.prepare(); assert.equal(h.panel.operation.value.operation_id, id) }
		h.stop()
	}
})

test('storage errors, lack of write permission and incomplete sources never send a write', async () => {
	for (const options of [{ storageFailure: true }, { canWrite: false }, { sources: async () => success(statement({ complete: false })) }]) {
		const h = await harness(options); fill(h.panel); await h.panel.prepare(); await h.panel.submit()
		assert.equal(h.writes.length, 0); h.stop()
	}
})

test('writeoff requires explicit no-refund/no-offset confirmation and changes invalidate preview', async () => {
	const h = await harness({ kind: 'prepay_writeoff' }); fill(h.panel)
	await h.panel.prepare(); assert.equal(h.previews.length, 0)
	h.panel.form.confirm_no_refund_or_offset = true
	await h.panel.prepare(); assert.equal(h.panel.canConfirm.value, true)
	assert.equal(h.previews[0].confirm_no_refund_or_offset, true)
	h.panel.form.confirm_no_refund_or_offset = false
	assert.equal(h.panel.preview.value, null); h.stop()
})

test('void preview identifies original version, has no new business date and submits only to void', async () => {
	const h = await harness()
	h.panel.beginVoid({ id: 'adj-old', version: 'version-2', kind: 'rounding_reversal', status: 'posted', amount: 10, date: '2026-09-20' })
	h.panel.form.note = '原调整登记错误'
	await h.panel.prepare()
	assert.equal(h.previews[0].void_id, 'adj-old')
	assert.equal(h.previews[0].source_version, 'version-2')
	assert.equal(h.previews[0].biz_date, undefined)
	assert.equal(h.panel.operation.value.action, 'void')
	await h.panel.submit(); assert.equal(h.writes.length, 1); assert.equal(h.events.length, 1); h.stop()
})

test('late source/preview/write results do not overwrite another customer scope', async () => {
	const waiting = deferred()
	const h = await harness({ post: () => waiting.promise })
	fill(h.panel); await h.panel.prepare(); const pending = h.panel.submit()
	h.customerId.value = 'c2'; await settle()
	assert.equal(h.panel.operation.value, null)
	waiting.resolve(saved(h.writes[0])); await pending
	assert.equal(h.panel.operation.value, null)
	assert.equal(h.panel.form.source_key, '')
	assert.equal(h.events.length, 0)
	assert.equal(h.storage.get('crm_customer_adjustment_pending:u1:c1:rounding_reversal').status, 'saved')
	h.stop()
	const previewWait = deferred(), late = await harness({ preview: () => previewWait.promise })
	fill(late.panel); const preparing = late.panel.prepare()
	late.panel.form.biz_date = '2026-10-11'
	previewWait.resolve(success({ value: late.previews[0], plan_hash: 'p', effects: { receivable_delta: 10, available_delta: 0, income_delta: 0, cash_delta: 0 } }))
	await preparing; assert.equal(late.panel.preview.value, null); late.stop()
})

test('new period figures are server-authoritative and old versions retain original rounding display', async () => {
	const mapperCode = fs.readFileSync('src/services/mappers/customerPeriodSummary.js', 'utf8')
	const mapper = await import(`data:text/javascript;base64,${Buffer.from(mapperCode).toString('base64')}`)
	const old = { read_complete: true, rule_version: 'customer-period-summary/2026-09-23.4', money_scale: 2, business_revenue: 100, historical_receivable: 0, receivable_total: 100, cash_received: 90, historical_debt_collected: 0, refund_total: 0, net_cash_received: 90, rounding_total: 10, prepay_writeoff_total: 0 }
	assert.equal(mapper.customerNetRounding(old), 10)
	const current = { ...old, rule_version: 'customer-period-summary/2026-10-12.1', rounding_reversal_total: 5, rounding_net_total: 4.99, settlement_writeoff_income: 960 }
	assert.equal(mapper.customerNetRounding(current), 4.99)
	assert.equal(mapper.customerPeriodSummaryRows(current).find(row => row.key === 'settlement_writeoff_income').value, 960)
	assert.equal(mapper.customerNetRounding({ ...current, rounding_net_total: null }), null)
	assert.equal(mapper.normalizeCustomerPeriodSummary({ ...current, settlement_writeoff_income: undefined }), null)
})

test('ledger filters reach server before paging and period subtotal is independent from the visible page', async () => {
	const module = fs.readFileSync('src/components/domain/customer/statement/CustomerStatementModule.vue', 'utf8')
	const requests = [], toasts = []
	const c = vm.createContext({ ...vue, rowFilters: vue.reactive({ dateFrom: '2026-01-01', dateTo: '2026-10-12', rowType: 'prepay_writeoff' }), recordId: vue.ref('c1'), rowsLoading: vue.ref(false), statementRows: vue.ref([]), rowsPager: vue.reactive({ page: 2, pageSize: 10, total: 0, hasMore: false }), periodReport: vue.ref({ rule_version: 'customer-period-summary/2026-10-12.1', settlement_writeoff_income: 960, rounding_reversal_total: 37.5 }), customerNetRounding: () => 0, formatMoney: n => n.toFixed(2), nextRowsSearchRequestSeq: () => 1, isLatestRowsSearchRequest: () => true, uni: { showToast: x => toasts.push(x) }, showCloudRequestError: () => {}, listCustomerStatementRowsV1: async input => { requests.push(input); return { code: 0, data: [{ row_id: 'page-2', row_type: 'prepay_writeoff', amount: 10 }], paging: { page: 2, pageSize: 10, total: 11, hasMore: false } } } })
	const start = module.indexOf('const revenueDetailOpen = ref(false)')
	vm.runInContext(module.slice(start, module.indexOf("const rowsDatePreset = ref('custom')", start)) + '\nglobalThis.subtotal = ledgerPeriodSubtotal;', c)
	const loader = module.indexOf('async function loadRows(')
	vm.runInContext(module.slice(loader, module.indexOf('\nasync function loadOffsetCreditPool(', loader)), c)
	await c.loadRows()
	assert.equal(requests[0].rowType, 'prepay_writeoff')
	assert.equal(requests[0].page, 2)
	assert.equal(c.rowsPager.total, 11)
	assert.equal(c.subtotal.value, 960)
	c.statementRows.value = []
	assert.equal(c.subtotal.value, 960)
	c.listCustomerStatementRowsV1 = async () => ({ code: 0, data: [{ row_type: 'sale', amount: 10 }], paging: { total: 20 } })
	await c.loadRows()
	assert.equal(c.statementRows.value.length, 0)
	assert.equal(c.rowsPager.total, 0)
	assert.match(toasts.at(-1).title, /筛选尚未完成/)
})

test('modal traps Tab, closes with Escape and restores actual uni page scroll and prior focus', async () => {
	const file = fs.readFileSync('src/components/base/AppModal.vue', 'utf8')
	const script = file.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
	const watchers = [], events = [], listeners = new Map(), focusOptions = []
	const wrapper = { scrollTop: 77, scrollLeft: 3, parentElement: null }
	const doc = { activeElement: null, scrollingElement: wrapper, querySelectorAll: () => [wrapper], addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
	const trigger = { parentElement: wrapper, scrollTop: 0, scrollLeft: 0, isConnected: true, focus: options => { focusOptions.push(options); doc.activeElement = trigger; wrapper.scrollTop = 999 } }
	doc.activeElement = trigger
	const props = { modelValue: true, title: '营收明细' }
	const c = vm.createContext({ ref: x => ({ value: x }), nextTick: async () => {}, watch: (getter, callback) => watchers.push(callback), onBeforeUnmount: () => {}, defineProps: () => props, defineEmits: () => (...args) => events.push(args), document: doc })
	vm.runInContext(script + '\nglobalThis.modalRef = dialog;', c)
	const item = () => { const node = { getAttribute: () => null, getClientRects: () => [{}], focus: options => { focusOptions.push(options); doc.activeElement = node } }; return node }
	const first = item(), last = item()
	c.modalRef.value = { focus: options => { focusOptions.push(options); doc.activeElement = c.modalRef.value; wrapper.scrollTop = 999 }, querySelectorAll: () => [first, last], contains: node => [first, last, c.modalRef.value].includes(node) }
	await watchers[0](true)
	assert.equal(wrapper.scrollTop, 77)
	doc.activeElement = last
	listeners.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault() {} })
	assert.equal(doc.activeElement, first)
	listeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {} })
	assert.equal(doc.activeElement, last)
	listeners.get('keydown')({ key: 'Escape', preventDefault() {} })
	assert.deepEqual(events[0], ['update:modelValue', false])
	props.modelValue = false; await watchers[0](false)
	assert.equal(doc.activeElement, trigger)
	assert.equal(wrapper.scrollTop, 77)
	assert.equal(wrapper.scrollLeft, 3)
	assert.equal(listeners.size, 0)
	assert.ok(focusOptions.every(options => options.preventScroll === true))
})

test('adjustment history stays in its own kind and wrong-kind void is unavailable', async () => {
	const h = await harness({ sources: async () => success(statement({ adjustments: [{ id: 'r1', kind: 'rounding_reversal', status: 'posted' }, { id: 'w1', kind: 'prepay_writeoff', status: 'posted' }] })) })
	assert.equal(h.panel.adjustments.value.length, 1)
	assert.equal(h.panel.adjustments.value[0].id, 'r1')
	h.panel.beginVoid({ id: 'w1', kind: 'prepay_writeoff', status: 'posted' })
	assert.equal(h.panel.voidTarget.value, null)
	h.stop()
})

test('void with dependent allocations requires explicit opt-in and complete server disclosure', async () => {
	let complete = false
	const h = await harness({ preview: async input => success({ value: input, plan_hash: 'release-plan', effects: { receivable_delta: -5, available_delta: 10, income_delta: 0, cash_delta: 0 }, ...(complete ? { affected_allocations: [{ allocation_id: 'a1', receipt_id: 'r1', date: '2026-10-11', allocate_kind: 'receipt', amount: 10 }], receipt_effects: [{ receipt_id: 'r1', available_delta: 10, rounding_delta: 0 }] } : {}) }) })
	h.panel.beginVoid({ id: 'adj1', kind: 'rounding_reversal', status: 'posted', version: 'v1' })
	h.panel.form.note = '撤销错误冲回'
	h.panel.form.release_dependent_allocations = true
	await h.panel.prepare()
	assert.equal(h.panel.canConfirm.value, false)
	assert.match(h.panel.issue.value, /后续分配与来源变化未完整/)
	complete = true
	await h.panel.prepare()
	assert.equal(h.panel.preview.value.affected_allocations[0].amount, 10)
	assert.equal(h.panel.preview.value.receipt_effects[0].available_delta, 10)
	assert.equal(h.panel.canConfirm.value, true)
	h.panel.form.release_dependent_allocations = false
	assert.equal(h.panel.canConfirm.value, false)
	await h.panel.submit(); assert.equal(h.writes.length, 0)
	h.panel.form.release_dependent_allocations = true
	await h.panel.prepare(); await h.panel.submit()
	assert.equal(h.writes[0].release_dependent_allocations, true)
	assert.equal(h.writes[0].void_id, 'adj1')
	h.stop()
})

test('frontend payloads complete preview/post/void against the real adjustment service contract', async () => {
	const { makeDb } = require('./lib/accountingTestHarness.cjs')
	const { readComplete } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/financialReadLocal')
	const { createAdjustmentService } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/customerAdjustment')
	const state = { crm_customers: [{ _id: 'c1', name: '合成客户', default_price_unit: 'kg', receivable_balance: 0, prepay_balance: 0 }], crm_sale_records: [{ _id: 's1', customer_id: 'c1', date: '2026-09-01', amount_received: 90, rounding_amount: 10 }], crm_customer_receipts: [], crm_customer_allocations: [], crm_customer_opening_debts: [], crm_customer_flow_settlements: [], crm_operation_logs: [] }
	const db = makeDb(state, { mutate: true, transaction: true, txDocumentObject: true })
	const debtSnapshot = row => ({ should_receive_effective: row.amount, rounding_amount: 0, receipt_rounding_amount: 0, outstanding: row.amount - row.amount_received })
	const service = createAdjustmentService({ db, command: db.command, readComplete, moneyScale: () => 2, saleSnapshot: () => ({ should_receive: 100, should_receive_effective: 90, rounding_amount: 10, receipt_rounding_amount: 0, outstanding: 0 }), flowSnapshot: debtSnapshot, debtSnapshot, balancePatch: scope => ({ receivable_balance: scope.debts.filter(row => row.status === 'posted').reduce((n, row) => n + row.amount - row.amount_received, 0), prepay_balance: 0 }) })
	const invoke = action => async input => { try { return success(await service.run(action, input, { _id: 'finance1', role: 'finance' })) } catch (e) { return { code: e.code || 500, msg: e.message, details: e.details } } }
	const h = await harness({ sources: invoke('getCustomerAdjustmentSourcesV1'), preview: invoke('previewCustomerAdjustmentV1'), post: invoke('postCustomerAdjustmentV1'), void: invoke('voidCustomerAdjustmentV1'), query: invoke('getCustomerAdjustmentOperationV1') })
	fill(h.panel, { source_key: h.panel.sources.value[0].source_key, amount: '4.25' })
	await h.panel.prepare(); assert.equal(h.panel.canConfirm.value, true, h.panel.issue.value)
	await h.panel.submit(); assert.equal(h.events.length, 1, h.panel.issue.value)
	assert.equal(state.crm_customers[0].receivable_balance, 4.25)
	const row = h.panel.adjustments.value[0]
	h.panel.beginVoid(row); h.panel.form.note = '合成作废核验'
	await h.panel.prepare(); assert.equal(h.panel.canConfirm.value, true, h.panel.issue.value)
	await h.panel.submit(); assert.equal(h.events.length, 2, h.panel.issue.value)
	assert.equal(h.events[1].status, 'voided')
	assert.equal(h.panel.operation.value, null)
	assert.equal(state.crm_customers[0].receivable_balance, 0)
	assert.equal(h.panel.adjustments.value[0].status, 'void')
	h.stop()
})
