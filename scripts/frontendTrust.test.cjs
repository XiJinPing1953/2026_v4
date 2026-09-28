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
const version = 'filling-consistency-2026-09-08-v2'

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

test('filling refresh reconciles locally remembered submissions beyond server recent list and frees completed entries', async () => {
	const { context, storage } = service(async (_, request) => {
		if (request.action === 'listOperationsV1') return { code: 0, data: [] }
		return { code: 0, data: { operation_id: request.data.operation_id, complete: true, rule_version: version } }
	})
	context.rememberBatchFillingOperation({ batch_text: 'B1 10' })
	const result = await context.listFillingOperationsV1()
	assert.equal(result.data.length, 1)
	assert.equal([...storage.values()][0].length, 0)
})

test('filling refresh keeps an unconfirmed operation visible and retains its original id', async () => {
	const { context, storage } = service(async (_, request) => request.action === 'listOperationsV1' ? { code: 0, data: [] } : { code: 404 })
	const id = context.rememberBatchFillingOperation({ batch_text: 'B1 10' })
	const result = await context.listFillingOperationsV1()
	assert.equal(result.data[0].status, 'confirmation_required')
	assert.equal([...storage.values()][0][0].operation_id, id)
})
