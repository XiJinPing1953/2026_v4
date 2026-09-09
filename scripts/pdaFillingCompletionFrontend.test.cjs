'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { makeApp } = require('./lib/pdaCompletionHarness.cjs')

function loadFrontend(callCloud, withView = false) {
	const notices = [], redirects = []
	const context = vm.createContext({ callCloud,
		normalizeText: (value) => String(value ?? '').trim(), normalizeBottleNo: (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ''),
		ref: (value) => ({ value }), computed: (fn) => ({ get value() { return fn() } }),
		defineProps: () => ({ taskId: 'task-1' }), defineExpose() {}, watch() {},
		uni: { showToast: ({ title }) => notices.push(title), redirectTo: (args) => redirects.push(args) }
	})
	const stripImports = (source) => source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\n/gm, '').replace(/^export /gm, '')
	vm.runInContext(stripImports(fs.readFileSync('src/services/pda/fillingTask.js', 'utf8')), context)
	if (withView) {
		const source = fs.readFileSync('src/components/domain/pda/PdaFillingCompleteView.vue', 'utf8').split('<script setup>')[1].split('</script>')[0]
		vm.runInContext(stripImports(source) + '\nglobalThis.ui = { loadTask, onComplete, onMarkAbnormal, task, scale, remark, completion, endWeight, actualNetWeight, processingText, saveMessage, requestError, canSubmit };', context)
	}
	return { context, notices, redirects }
}

test('new frontend rejects an old backend before creating a task or sending either completion action', async () => {
	const calls = []
	const app = loadFrontend(async (_, request) => { calls.push(request.action); return { code: 400, msg: 'unknown action' } })
	for (const method of ['createPdaFillingTaskV1', 'completePdaFillingTaskV1', 'markPdaFillingTaskAbnormalV1']) await assert.rejects(app.context[method]({ task_id: 'task-1' }))
	assert.deepEqual(calls, ['capabilitiesV1', 'capabilitiesV1', 'capabilitiesV1'])
})

test('service sends only task identity, version and remark: clients cannot replace server-frozen facts', async () => {
	const calls = []
	const app = loadFrontend(async (_, request) => {
		calls.push(request)
		return { code: 0, data: { completion_protocol: 'pda-completion-2026-09-08-v1', filling_protocol: 'filling-consistency-2026-09-08-v2', durable_completion: true } }
	})
	await app.context.completePdaFillingTaskV1({ task_id: 'task-1', remark: 'note', operation_id: 'arbitrary', weight_end: 70, operator_id: 'another' })
	await app.context.markPdaFillingTaskAbnormalV1({ taskId: 'task-1', remark: 'alarm' })
	for (const call of calls.filter((item) => item.action !== 'capabilitiesV1')) {
		assert.deepEqual(Object.keys(call.data).sort(), ['completion_protocol', 'remark', 'task_id'])
		assert.equal(call.data.completion_protocol, 'pda-completion-2026-09-08-v1')
	}
})

test('source id and complete flag alone never normalize to saved or complete', () => {
	const { context } = loadFrontend(async () => ({}))
	for (const data of [{ filling_record_id: 'id', complete: true }, { source_saved: true, complete: true }, {}]) {
		const state = context.normalizePdaCompletion(data)
		assert.equal(state.sourceSaved, false)
		assert.equal(state.complete, false)
		assert.equal(context.getPdaCompletionMessage(state), '源单尚未确认保存')
	}
})

test('actual completion view stays open on acceptance with no source and uses frozen weight for recovery', async () => {
	const backend = makeApp({ fillingCall: async ({ request }) => request.action === 'createV1' ? { code: 0, data: { _id: 'unproven' } } : undefined })
	const frontend = loadFrontend((_, request) => backend.invoke(request.action, request.data), true)
	const ui = frontend.context.ui
	await ui.loadTask(); await ui.onComplete()
	assert.equal(ui.completion.value.sourceSaved, false)
	assert.equal(ui.completion.value.physicalComplete, true)
	assert.equal(ui.canSubmit.value, true)
	assert.equal(ui.saveMessage.value, '完成事实已冻结，源单尚未确认保存')
	assert.equal(frontend.notices.some((notice) => notice.includes('已保存')), false)
	assert.equal(frontend.redirects.length, 0)
	ui.scale.value = { weightKg: 99, isOnline: true, isStable: true }
	assert.equal(ui.endWeight.value, 30)
	assert.equal(ui.actualNetWeight.value, 10)
})

test('actual completion view distinguishes saved/pending from complete and disables a finished retry', async () => {
	let ready = false
	const backend = makeApp({ scan: async () => ready
		? { code: 0, data: { done: true, read_complete: true, rule_version: 'bottle-flow-2026-09-05-v1' } }
		: { code: 0, data: { done: false, cursor: { page: 1 }, waiting_for_lock: true } } })
	const frontend = loadFrontend((_, request) => backend.invoke(request.action, request.data), true)
	const ui = frontend.context.ui
	await ui.loadTask(); await ui.onMarkAbnormal()
	assert.equal(ui.completion.value.sourceSaved, true)
	assert.equal(ui.completion.value.complete, false)
	assert.equal(ui.saveMessage.value, '源单已保存，后续处理待完成')
	assert.match(ui.processingText.value, /剩余 1/)
	assert.equal(ui.canSubmit.value, true)
	ready = true
	await ui.onComplete()
	assert.equal(ui.saveMessage.value, '源单已保存，后续处理已完成')
	assert.equal(ui.canSubmit.value, false)
	assert.equal(frontend.redirects.length, 0)
})

test('browser acknowledgement loss is recovered on refresh without a saved toast based on the lost response', async () => {
	const backend = makeApp()
	let lost = true
	const frontend = loadFrontend(async (_, request) => {
		const result = await backend.invoke(request.action, request.data)
		if (lost && request.action === 'completeTaskV1') { lost = false; throw Error('confirmation lost') }
		return result
	}, true)
	await frontend.context.ui.loadTask(); await frontend.context.ui.onComplete()
	assert.equal(frontend.context.ui.completion.value.sourceSaved, true)
	assert.equal(frontend.context.ui.completion.value.complete, true)
	assert.equal(frontend.context.ui.requestError.value, '')
	assert.equal(frontend.redirects.length, 0)
	assert.equal(backend.db.data('crm_fillings').size, 1)
})

test('double click in the actual view dispatches one completion and keeps abnormal retry classification frozen', async () => {
	const backend = makeApp()
	const frontend = loadFrontend((_, request) => backend.invoke(request.action, request.data), true)
	await frontend.context.ui.loadTask()
	await Promise.all([frontend.context.ui.onMarkAbnormal(), frontend.context.ui.onComplete()])
	assert.equal(backend.calls.filter((call) => call.action === 'createV1').length, 1)
	assert.equal(backend.task().completion_intent.payload.alarm_state, true)
})

test('schema copies match root, indexes derive from root, and no credential fields are added', () => {
	const { buildIndexFile } = require('./syncDomainContracts.cjs')
	const read = (name) => JSON.parse(fs.readFileSync('uniCloud-alipay/database/' + name, 'utf8'))
	const root = read('crm_pda_filling_tasks.schema.json')
	assert.deepEqual(read('schema/crm_pda_filling_tasks.schema.json'), root)
	assert.deepEqual(read('crm_pda_filling_tasks.index.json'), buildIndexFile(root))
	assert.deepEqual(root.permission, { read: false, create: false, update: false, delete: false })
	assert.ok(root.properties.status.enum.includes('completion_pending'))
	assert.deepEqual(Object.keys(root.properties.completion_intent.properties).sort(), ['payload', 'protocol'])
})
