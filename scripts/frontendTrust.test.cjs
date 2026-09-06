'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function service(call) {
	const storage = new Map()
	const code = fs.readFileSync('src/services/fillingOperations.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')
	const context = vm.createContext({ callCloud: call, getUser: () => ({ _id: 'operator' }), uni: {
		getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value)
	} })
	vm.runInContext(code, context)
	return { context, storage }
}
const version = 'filling-consistency-2026-09-05-v1'

test('frontend timeout reuses operation id, keeps no raw content and frees a completed draft for a new submission', async () => {
	const dispatched = []
	let complete = false
	let lost = true
	const { context, storage } = service(async (_, request) => {
		if (request.action === 'capabilitiesV1') return { code: 0, data: { durable_operations: true, rule_version: version } }
		if (request.action === 'batchCreateV1') {
			dispatched.push(request.data.operation_id)
			if (lost) { lost = false; throw new Error('lost acknowledgement') }
		}
		return { code: 0, data: { operation_id: request.data.operation_id, rule_version: version, complete } }
	})
	const payload = { batch_text: 'PRIVATE_BOTTLE_IDENTIFIER 10', remark: 'PRIVATE_NOTE' }
	await context.submitBatchFillingOperation(payload)
	await context.submitBatchFillingOperation(payload)
	assert.equal(dispatched[0], dispatched[1])
	assert.equal(JSON.stringify([...storage.values()]).includes('PRIVATE'), false)
	complete = true
	await context.submitBatchFillingOperation(payload)
	await context.submitBatchFillingOperation(payload)
	assert.notEqual(dispatched[2], dispatched[3])
})

test('frontend refuses old backend before sending any mutating request', async () => {
	const calls = []
	const { context } = service(async (_, request) => { calls.push(request.action); return { code: 400, msg: 'unknown action' } })
	await assert.rejects(context.submitBatchFillingOperation({ batch_text: 'B1 10' }), /后台尚未完成升级/)
	assert.deepEqual(calls, ['capabilitiesV1'])
})

test('sales list cached payload restores its own completeness warning when filters change', () => {
	const source = fs.readFileSync('src/components/domain/sale/SaleListView.vue', 'utf8')
	const code = source.slice(source.indexOf('function applyResult(payload)'), source.indexOf('\nasync function onSearch(', source.indexOf('function applyResult(payload)')))
	const context = vm.createContext({ list: { value: [] }, pager: {}, financialIssue: { value: '' }, summary: { value: {} },
		toNumber: (value, fallback) => value == null ? fallback : Number(value) })
	vm.runInContext(code, context)
	const incomplete = { items: [], summary: { accounting_complete: false, unresolved_count: 38 } }
	context.applyResult(incomplete)
	assert.match(context.financialIssue.value, /38/)
	context.applyResult({ items: [], summary: { accounting_complete: true } })
	assert.equal(context.financialIssue.value, '')
	context.applyResult(incomplete)
	assert.match(context.financialIssue.value, /38/)
})

test('sales export rejects a missing, duplicated or changing page instead of exporting a partial ledger', async () => {
	const source = fs.readFileSync('src/components/domain/sale/SaleListView.vue', 'utf8')
	const code = source.slice(source.indexOf('async function fetchAllRowsForExport()'), source.indexOf('\nfunction compareSaleRows('))
	const page = (id, total, hasMore) => ({ code: 0, data: id ? [{ _id: id }] : [], paging: { total, hasMore } })
	async function run(pages) {
		const context = vm.createContext({ listSalesV2: async () => pages.shift(), buildListParams: () => ({}) })
		vm.runInContext(code, context)
		return context.fetchAllRowsForExport()
	}
	assert.equal((await run([page('s1', 2, true), page('s2', 2, false)])).length, 2)
	await assert.rejects(run([page('s1', 2, true), page(null, 2, false)]), /未完成/)
	await assert.rejects(run([page('s1', 2, true), page('s1', 2, false)]), /重复/)
	await assert.rejects(run([page('s1', 2, true), page('s2', 3, false)]), /发生变化/)
})
