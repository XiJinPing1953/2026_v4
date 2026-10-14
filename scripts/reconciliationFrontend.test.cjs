'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), vue = require('vue')
function moduleContext(file) {
	const context = vm.createContext({ ...vue, onBeforeUnmount: () => {} })
	vm.runInContext(fs.readFileSync(file, 'utf8').replace(/^import .*$/gm, '').replaceAll('export ', ''), context)
	return context
}
const centerModule = moduleContext('src/composables/useReconciliationCenter.js')
const repairModule = moduleContext('src/composables/useReconciliationRepair.js')
const success = data => ({ code: 0, data }), copy = value => JSON.parse(JSON.stringify(value))
const wait = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const customers = [{ _id: 'a', name: '甲', is_hidden: true }, { _id: 'b', name: '乙', is_active: false }, { _id: 'alias', name: '别名', settlement_customer_id: 'a' }]
const result = (id, patch = {}) => ({ customer_id: id, customer_name: id, result_hash: `result-${id}`, source_hash: `source-${id}`, issues: [], summary_match: true, detail_match: false, ...patch })
const batch = (id = 'batch') => ({ batch: { _id: id, company: '账套甲', cutoff: '2026-09-30' }, customers, accounts: [], mappings: { version: 3, items: [] }, results: [], detail_sources: [] })
async function center(overrides = {}, options = {}) {
	const calls = [], scope = vue.effectScope()
	const api = { context: async () => success({ customers, batches: [batch().batch] }), getBatch: async ({ batch_id }) => success(batch(batch_id)), checkCustomer: async data => { calls.push(copy(data)); return success(result(data.customer_id)) }, ...overrides }
	const state = scope.run(() => centerModule.useReconciliationCenter({ api, ...options }))
	await state.openBatch('batch')
	return { state, calls, stop: () => scope.stop() }
}
test('all settlement customers are checked sequentially including hidden/inactive; aliases do not double count', async () => {
	const first = deferred(), calls = []
	const h = await center({ checkCustomer: async data => { calls.push(data.customer_id); if (data.customer_id === 'a') return first.promise; return success(result('b')) } })
	const running = h.state.runChecks()
	await wait(); assert.deepEqual(calls, ['a']); assert.equal(h.state.running.value, true)
	first.resolve(success(result('a'))); await running
	assert.deepEqual(calls, ['a', 'b']); assert.equal(h.state.pending.value.length, 0); assert.equal(h.state.checkedThisRun.value, 2)
	h.stop()
})
test('pause finishes current customer, resumes remaining work, and does not rerun completed results', async () => {
	const first = deferred(), calls = []
	const h = await center({ checkCustomer: async data => { calls.push(data.customer_id); return data.customer_id === 'a' ? first.promise : success(result('b')) } })
	const running = h.state.runChecks(); await wait(); h.state.pause(); first.resolve(success(result('a'))); await running
	assert.deepEqual(calls, ['a']); assert.equal(h.state.running.value, false); assert.equal(h.state.pending.value.length, 1)
	await h.state.runChecks(); assert.deepEqual(calls, ['a', 'b']); h.stop()
})
test('one failed or incomplete customer remains pending while other customers finish', async () => {
	let fail = true
	const h = await center({ checkCustomer: async data => data.customer_id === 'a' && fail ? success({ customer_id: 'a', issues: [] }) : success(result(data.customer_id)) })
	await h.state.runChecks(); assert.equal(h.state.resultByCustomer.value.a, undefined); assert.match(h.state.failures.value.a, /不完整/); assert.equal(h.state.resultByCustomer.value.b.customer_id, 'b')
	fail = false; await h.state.runChecks(); assert.equal(Object.keys(h.state.failures.value).length, 0); assert.equal(h.state.pending.value.length, 0); h.stop()
})
test('a persisted read failure stays retryable while a complete read with business issues is not rerun', async () => {
	let failed = true; const calls = []
	const h = await center({ checkCustomer: async data => {
		calls.push(data.customer_id)
		return success(result(data.customer_id, failed && data.customer_id === 'a'
			? { check_status: 'read_failed', read_complete: false, retryable: true, stale: true, issues: [{ code: 'read_incomplete', type: 'evidence' }] }
			: { check_status: 'completed', read_complete: true, internal: { complete: false, read_complete: true }, summary_match: false, issues: [{ type: 'evidence', code: 'missing_backing' }] }))
	} })
	await h.state.runChecks()
	assert.deepEqual(copy(h.state.pending.value).map(row => row._id), ['a']); assert.equal(h.state.retryableFailureCount.value, 1)
	assert.equal(h.state.resultByCustomer.value.b.internal.complete, false)
	assert.equal(centerModule.reconciliationLevel(h.state.resultByCustomer.value.a), '读取失败 · 可继续重试')
	failed = false; await h.state.runChecks(); assert.deepEqual(calls, ['a', 'b', 'a'])
	assert.equal(h.state.pending.value.length, 0); assert.equal(h.state.retryableFailureCount.value, 0); h.stop()
})
test('historical read failures require explicit incomplete-read evidence, never business completeness or missing evidence alone', async () => {
	const legacy = result('a', { source_hash: undefined, internal: { issues: [{ code: 'read_incomplete' }] } })
	assert.equal(centerModule.reconciliationReadFailed(legacy), true)
	assert.equal(centerModule.reconciliationReadFailed(result('a', { internal: { read_complete: false } })), true)
	assert.equal(centerModule.reconciliationReadFailed(result('a', { source_hash: undefined, issues: [{ type: 'read_incomplete' }] })), true)
	assert.equal(centerModule.reconciliationReadFailed(result('a', { source_hash: undefined, internal: { complete: false }, issues: [{ type: 'evidence', code: 'missing_backing' }] })), false)
	assert.equal(centerModule.reconciliationReadFailed(result('a', { issues: [{ code: 'read_incomplete' }] })), false)
	const h = await center({ getBatch: async () => success({ ...batch(), results: [legacy, result('b')] }) })
	assert.deepEqual(copy(h.state.pending.value).map(row => row._id), ['a']); await h.state.runChecks()
	assert.deepEqual(h.calls.map(row => row.customer_id), ['a']); h.stop()
})
test('nonretryable read failures stay visible but only explicit recheck retries them', async () => {
	const denied = result('a', { check_status: 'read_failed', read_complete: false, retryable: false, stale: true, read_failure: { stage: 'ledger', message: '无读取权限' } })
	const h = await center({ getBatch: async () => success({ ...batch(), results: [denied, result('b')] }) })
	assert.equal(h.state.pending.value.length, 0); assert.equal(h.state.blockedReadCount.value, 1)
	assert.equal(centerModule.reconciliationLevel(denied), '读取失败 · 需处理后重查')
	await h.state.runChecks(); assert.equal(h.calls.length, 0)
	await h.state.runChecks({ ids: ['a'] }); assert.deepEqual(h.calls.map(row => row.customer_id), ['a']); assert.equal(h.state.blockedReadCount.value, 0); h.stop()
})
test('a transport failure after a prior successful result remains in the continue queue', async () => {
	let failed = true
	const h = await center({ getBatch: async () => success({ ...batch(), results: [result('a'), result('b')] }), checkCustomer: async data => { if (failed) throw Error('timeout'); return success(result(data.customer_id)) } })
	await h.state.runChecks({ ids: ['a'] }); assert.deepEqual(copy(h.state.pending.value).map(row => row._id), ['a']); assert.equal(h.state.retryableFailureCount.value, 1)
	failed = false; await h.state.runChecks(); assert.equal(h.state.pending.value.length, 0); h.stop()
})
test('first import opens its batch without starting checks, so mapping can be confirmed first', async () => {
	const h = await center({ importBatch: async () => success({ batch: { _id: 'imported' } }) })
	assert.equal(await h.state.importBatch({ company: '账套甲' }), true)
	assert.equal(h.state.batch.value._id, 'imported'); assert.equal(h.calls.length, 0); assert.equal(h.state.pending.value.length, 2); assert.equal(h.state.running.value, false)
	await h.state.runChecks(); assert.deepEqual(h.calls.map(row => row.customer_id), ['a', 'b']); h.stop()
})
test('checks only read by default and pass an explicit boolean when cache refresh is enabled', async () => {
	const h = await center()
	assert.equal(h.state.autoRefresh.value, false)
	await h.state.runChecks({ ids: ['a'] }); assert.equal(h.calls[0].auto_refresh, false)
	h.state.autoRefresh.value = true; await h.state.runChecks({ ids: ['b'] }); assert.equal(h.calls[1].auto_refresh, true)
	h.state.autoRefresh.value = false; await h.state.runChecks({ ids: ['a'] }); assert.equal(h.calls[2].auto_refresh, false); h.stop()
})
test('view-only permission permits reads but blocks import, mapping, check, detail and review dispatch', async () => {
	let writes = 0
	const deniedWrite = async () => { writes += 1; throw Error('should not dispatch') }
	const h = await center({ importBatch: deniedWrite, saveMapping: deniedWrite, checkCustomer: deniedWrite, importDetail: deniedWrite, reviewCustomer: deniedWrite }, { canWrite: () => false })
	await h.state.loadContext(); assert.equal(h.state.context.value.customers.length, 3); assert.equal(h.state.batch.value._id, 'batch')
	await h.state.importBatch({}); await h.state.saveMapping({}); await h.state.importDetail({}); await h.state.reviewCustomer({}); await h.state.checkOne('a'); await h.state.runChecks()
	assert.equal(writes, 0); assert.equal(h.state.running.value, false); assert.match(h.state.issue.value, /修改权限/); h.stop()
})
test('the rendered view-only page disables check/import/cache controls and leaves batch reads enabled', async () => {
	const h = await center({}, { canWrite: () => false }); await h.state.loadContext(); h.state.context.value.batches = []
	const { parse, compileScript } = require('@vue/compiler-sfc')
	const file = 'src/components/domain/accounting/reconciliation/ReconciliationCenterView.vue'
	const source = compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: 'readonly-check', inlineTemplate: true }).content
		.replace(/^import \{([^}]+)\} from ["']vue["']/gm, (_, names) => `const {${names.replace(/\bas\b/g, ':')}} = Vue`)
		.replace(/^import .*$/gm, '').replace('export default', 'globalThis.Component =')
	const components = Object.fromEntries(['AppPage', 'AppSection', 'AppButton', 'AppInput', 'AppTag', 'AppModal', 'CustomerAdjustmentPanel', 'ReconciliationRepairPanel'].map(name => [name, {
		inheritAttrs: false, setup(_, { attrs, slots }) { return () => vue.h(name === 'AppButton' ? 'button' : 'section', attrs, Object.values(slots).flatMap(slot => slot())) }
	}]))
	const context = vm.createContext({ Vue: { ...vue, onMounted: () => {} }, ...components,
		getRoleTemplate: () => 'finance', canPageAction: (_, action) => action === 'view', reconciliationApi: {},
		useReconciliationCenter: () => h.state, reconciliationMoney: centerModule.reconciliationMoney,
		money: centerModule.reconciliationMoney, level: centerModule.reconciliationLevel, readFailed: centerModule.reconciliationReadFailed,
		RECONCILIATION_ISSUE_TYPES: vm.runInContext('RECONCILIATION_ISSUE_TYPES', centerModule),
		pickReconciliationWorkbook: () => {}, downloadReconciliationSource: () => {}
	})
	vm.runInContext(source, context)
	const app = vue.createSSRApp(context.Component)
	for (const name of ['picker', 'checkbox', 'checkbox-group']) app.component(name, { inheritAttrs: false, setup(_, { attrs, slots }) { return () => vue.h(name, attrs, slots.default?.()) } })
	const html = await require('@vue/server-renderer').renderToString(app)
	for (const label of ['导入好会计报表', '选择 .xls / .xlsx', '导入报表', '继续未完成核查', '重新核查本批全部客户']) {
		const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(([, , text]) => text.includes(label))
		assert.ok(button, label); assert.match(button[1], /\bdisabled\b/, label)
	}
	assert.match(html, /<checkbox\b[^>]*value="auto_refresh"[^>]*disabled/)
	const refresh = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(([, , text]) => text.includes('刷新批次'))
	assert.ok(refresh); assert.doesNotMatch(refresh[1], /\bdisabled\b/); h.stop()
})
test('late responses cannot contaminate another batch or continue its old queue', async () => {
	const first = deferred(), calls = []
	const h = await center({ checkCustomer: async data => { calls.push(data); return first.promise } })
	const running = h.state.runChecks(); await wait(); await h.state.openBatch('different'); first.resolve(success(result('a'))); await running
	assert.equal(h.state.batch.value._id, 'different'); assert.equal(Object.keys(h.state.resultByCustomer.value).length, 0); assert.equal(calls.length, 1); assert.equal(h.state.running.value, false); h.stop()
})
test('mapping saves the expected version and verifies its affected customer before presenting results', async () => {
	let submitted
	const h = await center({ saveMapping: async data => { submitted = copy(data); return success({ version: 4, items: [] }) } })
	await h.state.saveMapping({ customer_id: 'b', accountant_codes: ['112201'], expected_version: 3, basis: '确认客户科目' })
	assert.equal(submitted.expected_version, 3); assert.equal(submitted.company, '账套甲'); assert.deepEqual(h.calls.map(row => row.customer_id), ['b']); h.stop()
})
test('unlinking a confirmed mapping sends an explicit empty account set with evidence and expected version', async () => {
	let submitted
	const h = await center({ saveMapping: async data => { submitted = copy(data); return success({ version: 4, items: [] }) } })
	await h.state.saveMapping({ customer_id: 'a', accountant_codes: [], expected_version: 3, basis: '原科目对应有误，解除后重新确认' })
	assert.deepEqual(submitted.accountant_codes, []); assert.equal(submitted.expected_version, 3); assert.ok(submitted.basis); assert.deepEqual(h.calls.map(row => row.customer_id), ['a']); h.stop()
})
test('display never invents missing control amounts or promotes stale/blocked results to approval', () => {
	assert.equal(centerModule.reconciliationMoney(undefined), '待核')
	assert.equal(centerModule.reconciliationMoney(23900000), '23900.00')
	assert.equal(centerModule.reconciliationMoney(2501), '2.501')
	assert.match(centerModule.reconciliationLevel(result('a', { stale: true, review: { kind: 'manual_approval', valid: true } })), /待复核/)
	assert.match(centerModule.reconciliationLevel(result('a', { issues: [{ type: 'amount', blocking: true }] })), /仍有待核/)
	assert.equal(centerModule.reconciliationLevel(result('a', { issues: [{ type: 'cache_stale', blocking: false }], review: { kind: 'manual_approval', valid: true } })), '人工核准')
})

async function repair(overrides = {}) {
	const scope = vue.effectScope(), storage = overrides.storage || new Map(), calls = [], events = []
	const refs = { customerId: vue.ref('a'), batchId: vue.ref('batch'), resultHash: vue.ref('result-a') }
	const preview = { status: 'prepared', plan_hash: 'plan-1', writes: [{ table: 'crm_customer_receipts', id: 'receipt', before: { biz_date: '2026-08-18' }, after: { biz_date: '2026-08-19' } }], summary: {} }
	const api = {
		repairSources: async () => success({ snapshot_hash: 'snapshot', receipts: [{ _id: 'receipt', biz_date: '2026-08-18', amount: 100 }], sales: [] }),
		prepareRepair: async data => { calls.push(['prepare', copy(data)]); return success({ ...preview, operation_id: data.operation_id }) },
		executeRepair: async data => { calls.push(['execute', copy(data), copy([...storage.values()][0])]); return success({ operation_id: data.operation_id, status: 'committed', verification: { complete: true } }) },
		repairStatus: async data => { calls.push(['status', copy(data)]); return success({ operation_id: data.operation_id, status: 'committed', verification: { complete: true } }) }, ...overrides.api
	}
	const state = scope.run(() => repairModule.useReconciliationRepair({ ...refs, api, actorId: 'user', storage: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { if (overrides.storageFailure) throw Error('storage full'); storage.set(key, copy(value)) } }, onChanged: () => { events.push('saved') } }))
	await wait()
	return { state, storage, calls, events, refs, stop: () => scope.stop() }
}
function fillRepair(state) { Object.assign(state.form, { receipt_id: 'receipt', biz_date: '2026-08-19', basis: '原到账凭据已核对' }) }
test('financial repair persists exact fixed operation before dispatch and verifies it before emitting saved', async () => {
	const h = await repair(); fillRepair(h.state); await h.state.prepare()
	const id = h.state.operation.value.operation_id; assert.equal(h.state.canConfirm.value, true); await h.state.submit()
	const dispatched = h.calls.find(([action]) => action === 'execute')
	assert.equal(dispatched[1].operation_id, id); assert.equal(dispatched[2].status, 'executing'); assert.equal(dispatched[2].operation_id, id); assert.equal(h.events.length, 1); h.stop()
})
test('editing evidence invalidates the displayed financial plan; storage failure blocks writes', async () => {
	const h = await repair(); fillRepair(h.state); await h.state.prepare(); h.state.form.basis = '另一份确认'
	assert.equal(h.state.canConfirm.value, false); assert.equal(h.state.operation.value, null); await h.state.submit(); assert.equal(h.calls.filter(([action]) => action === 'execute').length, 0); h.stop()
	const blocked = await repair({ storageFailure: true }); fillRepair(blocked.state); await blocked.state.prepare(); assert.equal(blocked.calls.length, 0); assert.match(blocked.state.issue.value, /无法保存操作号/); blocked.stop()
})
test('unknown write result locks new attempts, queries original operation, and recovers after reopening', async () => {
	let executeId
	const h = await repair({ api: { executeRepair: async data => { executeId = data.operation_id; throw Error('network timeout') } } }); fillRepair(h.state); await h.state.prepare(); await h.state.submit()
	assert.equal(h.state.unresolved.value, true); assert.equal(h.events.length, 0); await h.state.prepare(); assert.equal(h.calls.filter(([action]) => action === 'prepare').length, 1)
	const storage = h.storage; h.stop()
	const reopened = await repair({ storage }); await wait()
	assert.equal(reopened.calls.find(([action]) => action === 'status')[1].operation_id, executeId); assert.equal(reopened.events.length, 1); assert.equal(reopened.state.operation.value, null); reopened.stop()
})
test('same-operation preview can be recovered after a prepare timeout without generating a second plan', async () => {
	let prepared
	const h = await repair({ api: {
		prepareRepair: async data => { prepared = copy(data); throw Error('timeout') },
		repairStatus: async data => success({ status: 'prepared', operation_id: data.operation_id, plan_hash: 'same-plan', writes: [{ table: 'receipt', id: 'r', before: {}, after: { biz_date: '2026-08-19' } }] })
	} }); fillRepair(h.state); await h.state.prepare(); assert.equal(h.state.unresolved.value, true); await h.state.query()
	assert.equal(h.state.operation.value.operation_id, prepared.operation_id); assert.equal(h.state.operation.value.preview.plan_hash, 'same-plan'); assert.equal(h.state.canConfirm.value, true); h.stop()
})
test('new page preserves homepage and registered Vue templates compile', () => {
	const pages = require('json5').parse(fs.readFileSync('src/pages.json', 'utf8')); assert.equal(pages.pages[0].path, 'pages/index/index')
	assert.equal(pages.pages.filter(page => page.path === 'pages/accounting/reconciliation-center').length, 1)
	const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
	for (const file of ['src/components/domain/accounting/reconciliation/ReconciliationCenterView.vue', 'src/components/domain/accounting/reconciliation/ReconciliationRepairPanel.vue']) {
		const parsed = parse(fs.readFileSync(file, 'utf8'), { filename: file }); assert.deepEqual(parsed.errors, []); compileScript(parsed.descriptor, { id: file }); assert.deepEqual(compileTemplate({ source: parsed.descriptor.template.content, filename: file, id: file }).errors, [])
	}
})
test('teleported H5 picker layer survives scoped CSS compilation and is limited to an open customer modal', () => {
	const { parse, compileStyle } = require('@vue/compiler-sfc'), postcss = require('postcss')
	const file = 'src/components/domain/accounting/reconciliation/ReconciliationCenterView.vue'
	const parsed = parse(fs.readFileSync(file, 'utf8'), { filename: file }).descriptor
	const rules = []
	for (const style of parsed.styles) {
		const compiled = compileStyle({ source: style.content, filename: file, id: 'data-v-layer-test', scoped: !!style.scoped })
		assert.deepEqual(compiled.errors, [])
		postcss.parse(compiled.code).walkRules(rule => { if (rule.selector.includes('.uni-picker-container')) rules.push(rule) })
	}
	assert.equal(rules.length, 1)
	assert.equal(rules[0].selector, 'uni-app:has(.customer-modal.app-modal-backdrop) > .uni-picker-container')
	const pickerLayer = Number(rules[0].nodes.find(node => node.prop === 'z-index')?.value)
	const modalLayer = Number(fs.readFileSync('src/components/base/AppModal.vue', 'utf8').match(/\.app-modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/)[1])
	assert.ok(pickerLayer > modalLayer, 'the root picker must receive clicks above the modal backdrop')
})
test('committed financial repair stays locked until writeback verification completes, and resumes with same identity', async () => {
	let verified = false; const ids = []
	const h = await repair({ api: { executeRepair: async data => { ids.push(data.operation_id); return success({ operation_id: data.operation_id, status: 'committed', verification: verified ? { complete: true } : null }) } } })
	fillRepair(h.state); await h.state.prepare(); await h.state.submit()
	assert.equal(h.state.operation.value.status, 'committed_pending'); assert.equal(h.state.unresolved.value, true); assert.equal(h.events.length, 0)
	verified = true; await h.state.resumeVerification(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.equal(h.events.length, 1); h.stop()
})
test('not_prepared remains unresolved and only retries the original immutable request', async () => {
	const inputs = []
	const h = await repair({ api: { prepareRepair: async data => { inputs.push(copy(data)); throw Error('timeout') }, repairStatus: async data => success({ operation_id: data.operation_id, status: 'not_prepared' }) } })
	fillRepair(h.state); await h.state.prepare(); await h.state.query()
	assert.equal(h.state.locked.value, true); assert.equal(h.state.unresolved.value, true)
	h.state.form.basis = '不能进入新提交的变更'; await h.state.prepare(); assert.equal(inputs.length, 1)
	await h.state.retryPreparation(); assert.equal(inputs.length, 2); assert.deepEqual(inputs[0], inputs[1]); h.stop()
})
test('explicit rejected result clears pending identity and lets corrected inputs prepare a new operation', async () => {
	const inputs = []
	const h = await repair({ api: { prepareRepair: async data => { inputs.push(copy(data)); throw Error('原收款不存在') }, repairStatus: async data => success({ operation_id: data.operation_id, status: 'rejected', rejection_reason: '原收款不存在' }) } })
	fillRepair(h.state); await h.state.prepare(); const previous = h.state.operation.value.operation_id; await h.state.query()
	assert.equal(h.state.operation.value, null); assert.equal(h.state.locked.value, false); assert.equal([...h.storage.values()][0], null); assert.match(h.state.issue.value, /原收款不存在/)
	h.state.form.basis = '重新确认的凭据'; await h.state.prepare(); assert.notEqual(h.state.operation.value.operation_id, previous); assert.equal(inputs[1].basis, '重新确认的凭据'); h.stop()
})
test('a rejected receipt for another operation cannot unlock an unknown write', async () => {
	const h = await repair({ api: { prepareRepair: async () => { throw Error('timeout') }, repairStatus: async () => success({ operation_id: 'other', status: 'rejected' }) } })
	fillRepair(h.state); await h.state.prepare(); const previous = h.state.operation.value.operation_id; await h.state.query()
	assert.equal(h.state.operation.value.operation_id, previous); assert.equal(h.state.unresolved.value, true); assert.match(h.state.issue.value, /不一致/); h.stop()
})
