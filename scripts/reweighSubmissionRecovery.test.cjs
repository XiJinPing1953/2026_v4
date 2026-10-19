'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const version = 'filling-consistency-2026-09-08-v2'
const capabilities = { code: 0, data: { durable_operations: true, reweigh_durable: true, rule_version: version } }
const receipt = (operation_id, complete = true) => ({ code: 0, data: { operation_id, complete, rule_version: version } })
const key = (owner) => `crm:filling:submissions:${owner}`
function deferred() {
	let resolve; let reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}
function service(call) {
	const storage = new Map()
	let owner = 'A'
	const calls = []
	const context = vm.createContext({ getUser: () => ({ _id: owner }), callCloud: async (name, request) => {
		calls.push({ ...request, owner })
		return call(name, request)
	}, uni: { getStorageSync: (name) => storage.get(name), setStorageSync: (name, value) => storage.set(name, value) } })
	for (const path of ['src/services/fillingOperations.js', 'src/services/api/reweigh.js']) {
		const code = fs.readFileSync(path, 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')
		vm.runInContext(code, context)
	}
	const api = vm.runInContext('({ createReweighV1, correctReweighV1, getReweighOperationV1, retryReweighOperationV1 })', context)
	return { api, context, storage, calls, switchOwner: (value) => { owner = value } }
}

test('reweigh capabilities awaiting account switch cannot dispatch or remember under the new user', async () => {
	for (const action of ['createReweighV1', 'correctReweighV1']) {
		const pending = deferred()
		const env = service(() => pending.promise)
		const submission = env.api[action]({ bottle_no: '282', gross_weight: 100 })
		env.switchOwner('B')
		pending.resolve(capabilities)
		await assert.rejects(submission, /登录账号已变更/)
		assert.deepEqual(env.calls.map((row) => row.action), ['capabilitiesV1'])
		assert.equal(env.storage.size, 0)
	}
})

test('reweigh acknowledgement after account switch preserves both users drafts and sends no recovery as the new user', async () => {
	for (const outcome of ['success', 'rejection', 'network-error']) {
		const pending = deferred(); const dispatched = deferred()
		const env = service((_, request) => {
			if (request.action === 'capabilitiesV1') return capabilities
			dispatched.resolve(request.data.operation_id)
			return pending.promise
		})
		const submission = env.api.createReweighV1({ bottle_no: '282', gross_weight: 100 })
		const id = await dispatched.promise
		env.switchOwner('B')
		env.context.rememberBatchFillingOperation({ operation_id: id, bottle_no: '282', gross_weight: 100, submission_action: 'createReweighV1' })
		const before = JSON.stringify([...env.storage])
		if (outcome === 'network-error') pending.reject(new Error('lost acknowledgement'))
		else pending.resolve(outcome === 'success' ? receipt(id) : { code: 409, data: { rejected: true } })
		await assert.rejects(submission, /登录账号已变更/)
		assert.equal(JSON.stringify([...env.storage]), before)
		assert.deepEqual(env.calls.map((row) => row.owner), ['A', 'A'])
	}
})

test('100 pending reweigh submissions recovered through get or retry free capacity for the next submission', async () => {
	let complete = false
	const env = service((_, request) => request.action === 'capabilitiesV1' ? capabilities : receipt(request.data.operation_id, complete))
	const ids = []
	for (let i = 0; i < 100; i++) {
		const result = await env.api.createReweighV1({ bottle_no: String(i), gross_weight: 100 })
		ids.push(result.data.operation_id)
	}
	assert.equal(env.storage.get(key('A')).length, 100)
	complete = true
	for (let i = 0; i < ids.length; i++) await env.api[i % 2 ? 'retryReweighOperationV1' : 'getReweighOperationV1'](ids[i])
	assert.equal(env.storage.get(key('A')).length, 0)
	await env.api.createReweighV1({ bottle_no: '101', gross_weight: 100 })
	assert.equal(env.storage.get(key('A')).length, 0)
})

test('timeout recovery awaiting account switch preserves both caches', async () => {
	const pending = deferred(); const recovering = deferred()
	const env = service((_, request) => {
		if (request.action === 'capabilitiesV1') return capabilities
		if (request.action === 'createReweighV1') throw new Error('lost acknowledgement')
		recovering.resolve(request.data.operation_id)
		return pending.promise
	})
	const submission = env.api.createReweighV1({ bottle_no: '282', gross_weight: 100 })
	const id = await recovering.promise
	env.switchOwner('B')
	env.context.rememberBatchFillingOperation({ operation_id: id, bottle_no: '282', gross_weight: 100, submission_action: 'createReweighV1' })
	const before = JSON.stringify([...env.storage])
	pending.resolve(receipt(id))
	await assert.rejects(submission, /登录账号已变更/)
	assert.equal(JSON.stringify([...env.storage]), before)
	assert.deepEqual(env.calls.map((row) => row.owner), ['A', 'A', 'A'])
})

test('recovery retains original operation on incomplete, failed or mismatched receipts and network errors', async () => {
	for (const method of ['getReweighOperationV1', 'retryReweighOperationV1']) {
		let reply
		const env = service(() => { if (reply instanceof Error) throw reply; return reply })
		const id = env.context.rememberBatchFillingOperation({ bottle_no: '282', gross_weight: 100 })
		for (reply of [receipt(id, false), { ...receipt(id), code: 500 }, receipt('wrong-id'),
			{ code: 0, data: { operation_id: id, complete: true, rule_version: 'old' } }, new Error('offline')]) {
			if (reply instanceof Error) await assert.rejects(env.api[method](id), /offline/)
			else await env.api[method](id)
			assert.equal(env.storage.get(key('A'))[0].operation_id, id)
		}
	}
})

test('get and retry late completion cannot clear another users cache with the same operation id', async () => {
	for (const method of ['getReweighOperationV1', 'retryReweighOperationV1']) {
		const pending = deferred(); const env = service(() => pending.promise)
		const id = env.context.rememberBatchFillingOperation({ bottle_no: '282' })
		const request = env.api[method](id)
		env.switchOwner('B')
		env.context.rememberBatchFillingOperation({ operation_id: id, bottle_no: '282' })
		const before = JSON.stringify([...env.storage])
		pending.resolve(receipt(id))
		await assert.rejects(request, /登录账号已变更/)
		assert.equal(JSON.stringify([...env.storage]), before)
	}
})

test('list acknowledgement after account switch does not read or clear the new account drafts', async () => {
	const pending = deferred(); const env = service(() => pending.promise)
	const request = env.context.listFillingOperationsV1()
	const id = env.context.rememberBatchFillingOperation({ bottle_no: '282' })
	const completed = receipt(id).data
	env.switchOwner('B')
	env.context.rememberBatchFillingOperation({ operation_id: id, bottle_no: '282' })
	const before = JSON.stringify([...env.storage])
	pending.resolve({ code: 0, data: [completed] })
	await assert.rejects(request, /登录账号已变更/)
	assert.equal(JSON.stringify([...env.storage]), before)
	assert.equal(env.calls.length, 1)
})
