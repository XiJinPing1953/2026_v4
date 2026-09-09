'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApp } = require('./lib/pdaCompletionHarness.cjs')
const { operationIdForTask } = require('../uniCloud-alipay/cloudfunctions/crm-pda-filling/completionProtocol')
const clone = (value) => JSON.parse(JSON.stringify(value))
const view = (result) => result.data.completion || result.data.task.completion
const sources = (app) => [...app.db.data('crm_fillings').values()]
const mutations = (app) => app.calls.filter((call) => ['createV1', 'retryOperationV1'].includes(call.action))

test('real PDA completion saves one source/movement/inventory and confirms source through getOperation', async () => {
	const app = makeApp()
	const result = await app.invoke()
	assert.equal(result.code, 0)
	assert.equal(view(result).source_saved, true)
	assert.equal(view(result).complete, true)
	assert.equal(view(result).task_linked, true)
	assert.equal(view(result).operation_id, operationIdForTask('task-1'))
	assert.equal(app.task().status, 'completed')
	assert.equal(app.task().completion_pending, false)
	for (const name of ['crm_fillings', 'crm_bottle_movements', 'crm_gas_inventory_movements']) assert.equal(app.db.data(name).size, 1, name)
	assert.equal(sources(app)[0].raw_scale_payload.task.task_id, 'task-1')
	assert.equal(app.calls.at(-1).action, 'getOperationV1')
	assert.equal((await app.invoke('listCompletionTasksV1')).data.items.length, 0)
})

test('double click with different remarks and scale observations freezes exactly one payload', async () => {
	const app = makeApp()
	let reads = 0
	app.db.setFault(async (name, action) => {
		if (name === 'crm_pda_scale_latest' && action === 'get') app.scale(++reads === 1 ? 30 : 31)
	})
	const results = await Promise.all([app.invoke('completeTaskV1', { remark: 'first' }), app.invoke('completeTaskV1', { remark: 'second' })])
	assert.ok(results.every((res) => res.code === 0), JSON.stringify(results))
	const payload = clone(app.task().completion_intent.payload)
	assert.equal(sources(app).length, 1)
	assert.equal(sources(app)[0].fill_weight, payload.fill_weight)
	assert.equal(sources(app)[0].remark, payload.remark)
	assert.ok(mutations(app).filter((call) => call.action === 'createV1').every((call) => JSON.stringify(call.data) === JSON.stringify(payload)))
	app.advance(90000); app.scale(42)
	await app.invoke('markAbnormalV1', { remark: 'cannot replace frozen completion' })
	assert.deepEqual(clone(app.task().completion_intent.payload), payload)
	assert.equal(sources(app).length, 1)
})

test('freeze acknowledgement loss re-reads the winning fact before calling the downstream handler', async () => {
	const app = makeApp()
	let lost = false
	app.db.setFault(async (name, action, patch) => {
		if (!lost && name === 'crm_pda_filling_tasks' && action === 'updated' && patch.completion_intent) { lost = true; throw Error('ack lost') }
	})
	const result = await app.invoke()
	assert.equal(view(result).complete, true)
	assert.equal(mutations(app).length, 1)
	assert.equal(app.task().completion_intent.payload.weight_end, 30)
})

test('freeze write failure makes no downstream mutation and remains available for first completion', async () => {
	const app = makeApp()
	app.db.setFault(async (name, action, patch) => {
		if (name === 'crm_pda_filling_tasks' && action === 'update' && patch.completion_intent) throw Error('before write')
	})
	const result = await app.invoke()
	assert.equal(result.code, 409)
	assert.equal(app.task().completion_intent, undefined)
	assert.equal(app.task().status, 'ready')
	assert.equal(mutations(app).length, 0)
})

test('submission transport loss before acceptance retries the identical weight/time/operator/remark without reading the scale', async () => {
	let fail = true
	const app = makeApp({ fillingCall: async ({ request }) => {
		if (request.action === 'createV1' && fail) { fail = false; throw Error('request lost with token good') }
	} })
	const first = await app.invoke('completeTaskV1', { remark: 'frozen note' })
	assert.equal(first.code, 503)
	assert.equal(view(first).source_saved, false)
	assert.equal(app.task().status, 'completion_pending')
	const frozen = clone(app.task().completion_intent)
	app.advance(900000); app.scale(100)
	app.db.setFault(async (name, action) => { if (name === 'crm_pda_scale_latest' && action === 'get') throw Error('no more scale reads allowed') })
	app.user.nickname = 'changed profile'
	const retry = await app.invoke('completeTaskV1', { remark: 'new note ignored', weight_end: 300, operator_id: 'other' })
	assert.equal(view(retry).complete, true)
	assert.deepEqual(clone(app.task().completion_intent), frozen)
	assert.equal(sources(app)[0].weight_end, 30)
	assert.equal(sources(app)[0].operator, '原操作者')
	assert.equal(sources(app)[0].remark, 'frozen note')
	assert.equal((await app.invoke('getTaskV1')).data.scale, null)
})

test('downstream commits then loses its response: source query recovers the original link without another source', async () => {
	const app = makeApp({ fillingCall: async ({ request, real }) => {
		if (request.action === 'createV1') { await real(); throw Error('lost response') }
	} })
	const result = await app.invoke()
	assert.equal(result.code, 0)
	assert.equal(view(result).source_saved, true)
	assert.equal(view(result).complete, true)
	assert.equal(sources(app).length, 1)
	await app.invoke()
	assert.equal(mutations(app).length, 1)
})

test('source saved but task link update fails: refresh recovers link and keeps truthful source status', async () => {
	const app = makeApp()
	let blocked = true
	app.db.setFault(async (name, action, patch) => {
		if (blocked && name === 'crm_pda_filling_tasks' && action === 'update' && patch.filling_record_id) throw Error('task update failed')
	})
	const first = await app.invoke()
	assert.equal(view(first).source_saved, true)
	assert.equal(view(first).task_linked, false)
	assert.equal(view(first).can_retry, true)
	assert.equal(app.task().status, 'completion_pending')
	assert.equal(app.task().filling_record_id, null)
	blocked = false
	const recovered = await app.invoke('getTaskV1')
	assert.equal(view(recovered).task_linked, true)
	assert.equal(app.task().status, 'completed')
	assert.equal(app.task().completion_pending, false)
	assert.equal(mutations(app).length, 1)
})

test('code zero and a fabricated source id without an operation cannot mark a task saved', async () => {
	const app = makeApp({ fillingCall: async ({ request }) => request.action === 'createV1'
		? { code: 0, data: { _id: 'not-a-source', complete: true } } : undefined })
	const result = await app.invoke()
	assert.equal(result.code, 0)
	assert.equal(view(result).source_saved, false)
	assert.equal(view(result).complete, false)
	assert.equal(result.data.filling_record_id, null)
	assert.equal(app.task().status, 'completion_pending')
	assert.equal(app.task().completed_at, null)
	assert.equal((await app.invoke('listCompletionTasksV1')).data.items.length, 1)
	assert.equal((await app.invoke('getStationV1', { station_code: 'station_1' })).data.status, 'completion_pending')
})

test('accepted operation with no source remains pending; retry resumes the original source transaction', async () => {
	const app = makeApp()
	let blocked = true
	app.db.setFault(async (name, action) => { if (blocked && name === 'crm_fillings' && action === 'add') throw Error('source write failed') })
	const first = await app.invoke()
	assert.equal(first.code, 0)
	assert.equal(view(first).processing_status, 'pending')
	assert.equal(view(first).source_saved, false)
	assert.equal(app.task().status, 'completion_pending')
	blocked = false; app.scale(40)
	const retry = await app.invoke()
	assert.equal(view(retry).complete, true)
	assert.equal(sources(app)[0].fill_weight, 10)
	assert.equal(mutations(app).filter((call) => call.action === 'createV1').length, 1)
	assert.equal(mutations(app).filter((call) => call.action === 'retryOperationV1').length, 1)
})

test('source commit checkpoint loss is confirmed by getOperation source_records despite saved_total zero', async () => {
	const app = makeApp()
	let lost = false
	app.db.setFault(async (name, action, patch) => {
		if (!lost && name === 'crm_filling_operations' && action === 'update' && patch.saved_cursor === 1) { lost = true; throw Error('checkpoint lost') }
	})
	const result = await app.invoke()
	assert.equal(app.operation().saved_cursor, 0)
	assert.equal(view(result).source_saved, true)
	assert.equal(view(result).complete, false)
	assert.equal(app.task().status, 'completed')
	assert.equal(app.task().completion_pending, true)
	const retry = await app.invoke()
	assert.equal(view(retry).complete, true)
	assert.equal(sources(app).length, 1)
})

test('incomplete scan and failed operation keep source saved with remaining work; recovered operation leaves the queue', async () => {
	let scanComplete = false
	const app = makeApp({ scan: async () => scanComplete ? { code: 0, data: { done: true, read_complete: true, rule_version: 'bottle-flow-2026-09-05-v1' } }
		: { code: 0, data: { done: false, cursor: { page: 1 }, waiting_for_lock: true } } })
	const first = await app.invoke()
	assert.equal(view(first).source_saved, true)
	assert.equal(view(first).remaining_total, 1)
	assert.equal(view(first).complete, false)
	assert.equal(app.task().status, 'completed')
	assert.equal(app.task().completion_pending, true)
	assert.equal((await app.invoke('listCompletionTasksV1')).data.items.length, 1)
	Object.assign(app.operation(), { status: 'failed', last_error: 'temporary scan failure' })
	const failed = await app.invoke('getTaskV1')
	assert.equal(view(failed).processing_status, 'failed')
	assert.equal(view(failed).can_retry, true)
	assert.equal(view(failed).source_saved, true)
	scanComplete = true
	const resumed = await app.invoke()
	assert.equal(view(resumed).complete, true)
	assert.equal(app.task().completion_pending, false)
	assert.equal((await app.invoke('listCompletionTasksV1')).data.items.length, 0)
})

test('processing lease is preserved; retry never samples another weight or creates another operation', async () => {
	const app = makeApp({ regulatory: async () => ({ code: 500, msg: 'retry later' }) })
	await app.invoke()
	Object.assign(app.operation(), { status: 'processing', lease_until: Date.now() + 3600000 })
	const result = await app.invoke()
	assert.equal(view(result).processing_status, 'processing')
	assert.equal(view(result).complete, false)
	assert.equal(sources(app).length, 1)
	assert.equal(app.db.data('crm_filling_operations').size, 1)
})

test('normal and abnormal completion share a single frozen operation; abnormal classification survives retries', async () => {
	const app = makeApp({ regulatory: async () => ({ code: 500, msg: 'retry later' }) })
	const first = await app.invoke('markAbnormalV1', { remark: '异常事实' })
	assert.equal(view(first).physical_status, 'error')
	assert.equal(app.task().status, 'abnormal')
	assert.equal(sources(app)[0].alarm_state, true)
	const original = clone(app.task().completion_intent)
	await app.invoke('completeTaskV1', { remark: 'normal retry cannot clear alarm' })
	assert.deepEqual(clone(app.task().completion_intent), original)
	assert.equal(sources(app).length, 1)
})

test('concurrent different operators only allow the frozen owner to create the downstream operation', async () => {
	const app = makeApp()
	const responses = await Promise.all([app.invoke(), app.invoke('markAbnormalV1', {}, 'other')])
	assert.equal(responses.filter((res) => res.code === 403).length, 1)
	const actor = app.task().completion_intent.payload.operator_id
	assert.equal(app.operation().created_by, actor)
	assert.equal(sources(app)[0].operator_id, actor)
	assert.equal(app.db.data('crm_filling_operations').size, 1)
})

test('another ordinary user cannot query/replay frozen completion; admin can resume an existing operation', async () => {
	const app = makeApp({ regulatory: async () => ({ code: 500, msg: 'retry later' }) })
	await app.invoke()
	const before = mutations(app).length
	assert.equal((await app.invoke('completeTaskV1', {}, 'other')).code, 403)
	const otherView = view(await app.invoke('getTaskV1', {}, 'other'))
	assert.equal(otherView.can_retry, false)
	assert.equal(otherView.source_saved, false)
	assert.equal(mutations(app).length, before)
	assert.equal((await app.invoke('listCompletionTasksV1', {}, 'other')).data.items.length, 0)
	await app.invoke('completeTaskV1', {}, 'admin')
	assert.equal(mutations(app).at(-1).action, 'retryOperationV1')
	assert.equal(mutations(app).at(-1).token, 'admin')
	assert.equal(app.operation().created_by, 'owner')
	assert.equal(sources(app)[0].operator_id, 'owner')
})

test('admin cannot create a missing operation under a different owner after initial freeze', async () => {
	const app = makeApp({ fillingCall: async ({ request }) => request.action === 'createV1' ? { code: 503, msg: 'not accepted' } : undefined })
	await app.invoke()
	const before = mutations(app).length
	const admin = await app.invoke('completeTaskV1', {}, 'admin')
	assert.equal(view(admin).can_retry, false)
	assert.equal(mutations(app).length, before)
	assert.equal(app.db.data('crm_filling_operations').size, 0)
})

test('login, PDA page permissions and downstream permissions are enforced before a freeze', async () => {
	const app = makeApp()
	app.user.page_permissions['/pages/filling/list'] = { view: false, create: false }
	assert.equal((await app.invoke('completeTaskV1', {}, 'invalid')).code, 401)
	app.user.page_permissions['/pages/pda/filling-complete'].update = false
	assert.equal((await app.invoke()).code, 403)
	assert.equal(app.task().completion_intent, undefined)
	app.user.page_permissions['/pages/pda/filling-complete'].update = true
	app.user.page_permissions['/pages/pda/filling-create'].create = false
	assert.equal((await app.invoke()).code, 403)
	assert.equal(app.task().completion_intent, undefined)
	app.user.page_permissions['/pages/pda/filling-create'].create = true
	app.user.page_permissions['/pages/pda/filling-create'].view = false
	assert.equal((await app.invoke()).code, 403)
	assert.equal(app.task().completion_intent, undefined)
	assert.equal(mutations(app).length, 0)
})

test('renewed owner token works; credentials and private downstream payload are not stored in the task or public view', async () => {
	let offline = true
	const app = makeApp({ regulatory: async () => offline ? { code: 500, msg: 'temporary failure' } : { code: 0, data: {
		total_event_payload: 1, enqueued_total: 1, duplicate_total: 0, missing_bottle_total: 0,
		snapshot: { found_total: 1, enqueued_total: 1, duplicate_total: 0, missing_total: 0 }
	} } })
	await app.invoke('completeTaskV1', { token: 'must-not-store', operation_id: 'client-must-not-pick', operator_id: 'other' })
	app.user.token = 'renewed-owner-secret'; offline = false
	const result = await app.invoke('completeTaskV1', {}, 'renewed-owner-secret')
	assert.equal(view(result).complete, true)
	assert.equal(mutations(app).at(-1).token, 'renewed-owner-secret')
	assert.equal(app.operation().created_by, 'owner')
	for (const object of [app.task(), result, app.operation()]) {
		const serialized = JSON.stringify(object)
		assert.equal(serialized.includes('renewed-owner-secret'), false)
		assert.equal(serialized.includes('must-not-store'), false)
	}
	assert.equal(JSON.stringify(result).includes('completion_intent'), false)
	assert.equal(JSON.stringify(result).includes('worker_secret'), false)
})

test('old frontend and old downstream protocol are rejected before new physical tasks or completion mutations', async () => {
	const app = makeApp()
	for (const action of ['createTaskV1', 'completeTaskV1', 'markAbnormalV1']) assert.equal((await app.invoke(action, { completion_protocol: undefined })).code, 426)
	assert.equal(app.task().completion_intent, undefined)
	const old = makeApp({ fillingCall: async ({ request }) => request.action === 'capabilitiesV1'
		? { code: 0, data: { durable_operations: true, source_status_query: true, rule_version: 'old' } } : undefined })
	assert.equal((await old.invoke()).code, 503)
	assert.equal(old.task().completion_intent, undefined)
	assert.equal(mutations(old).length, 0)
})

test('old active task is lazily adopted; old completed task without source is quarantined without resampling', async () => {
	const active = makeApp()
	assert.equal((await active.invoke()).code, 0)
	const legacy = makeApp()
	legacy.task().status = 'completed'
	legacy.db.setFault(async (name, action) => { if (name === 'crm_pda_scale_latest' && action === 'get') throw Error('must not resample legacy completion') })
	const result = await legacy.invoke()
	assert.equal(result.code, 409)
	assert.equal(view(result).legacy, true)
	assert.equal(view(result).source_saved, false)
	assert.equal(view(result).can_retry, false)
	assert.equal(mutations(legacy).length, 0)
})

test('legacy link is only called saved after the source is queried and tied back to this task', async () => {
	const app = makeApp()
	await app.invoke()
	delete app.task().completion_intent
	const confirmed = view(await app.invoke('getTaskV1'))
	assert.equal(confirmed.source_saved, true)
	assert.equal(confirmed.complete, false)
	assert.equal(confirmed.legacy, true)
	assert.equal(confirmed.can_retry, false)
	sources(app)[0].raw_scale_payload.task.task_id = 'another-task'
	assert.equal(view(await app.invoke('getTaskV1')).source_saved, false)
	app.db.data('crm_fillings').clear()
	assert.equal(view(await app.invoke('getTaskV1')).source_saved, false)
})

test('source version changed after save never becomes complete or replays an old payload over the new source', async () => {
	const app = makeApp({ regulatory: async () => ({ code: 500, msg: 'temporary failure' }) })
	await app.invoke()
	const row = sources(app)[0]
	row.source_version = 2; row.updated_at += 1; row.fill_weight = 99
	const before = mutations(app).length
	const result = await app.invoke()
	assert.equal(view(result).source_saved, true)
	assert.equal(view(result).processing_status, 'conflict')
	assert.equal(view(result).complete, false)
	assert.equal(view(result).can_retry, false)
	assert.equal(mutations(app).length, before)
	assert.equal(row.fill_weight, 99)
})

test('missing query evidence cannot trust even a downstream complete flag and source id', async () => {
	let truncate = false
	const app = makeApp({ fillingCall: async ({ request, real }) => {
		if (truncate && request.action === 'getOperationV1') { const result = await real(); if (result.code === 0) delete result.data.source_records; return result }
	} })
	await app.invoke()
	truncate = true
	const result = await app.invoke('getTaskV1')
	assert.equal(view(result).source_saved, false)
	assert.equal(view(result).complete, false)
	assert.equal(view(result).can_retry, false)
})

test('late target write acknowledgement never reopens a frozen task or changes its frozen payload', async () => {
	const app = makeApp()
	await app.invoke()
	const frozen = clone(app.task().completion_intent)
	const result = await app.invoke('finishTargetWriteV1', { success: false, error: 'late failure', readback: 50 })
	assert.equal(result.code, 0)
	assert.equal(app.task().status, 'completed')
	assert.equal(app.task().target_write_status, 'failed')
	assert.deepEqual(clone(app.task().completion_intent), frozen)
	assert.equal((await app.invoke('claimTargetWriteV1', { scale_code: 'filling_scale_main' })).data.task, null)
})

test('recovery queue paginates without hiding older tasks and scopes ordinary users to frozen ownership', async () => {
	const app = makeApp({ fillingCall: async ({ request }) => request.action === 'createV1' ? { code: 503, msg: 'not accepted' } : undefined })
	await app.invoke()
	const original = clone(app.task())
	for (let i = 0; i < 44; i++) {
		const task = { ...clone(original), _id: `copy-${String(i).padStart(3, '0')}` }
		if (i % 3 === 0) task.completion_intent.payload.operator_id = 'other'
		app.db.data('crm_pda_filling_tasks').set(task._id, task)
	}
	let before = '', ids = [], more
	do {
		const result = await app.invoke('listCompletionTasksV1', { before_id: before })
		ids.push(...result.data.items.map((row) => row._id))
		before = result.data.next_before_id; more = result.data.has_more
	} while (more)
	assert.equal(ids.length, 30)
	assert.equal(new Set(ids).size, ids.length)
	assert.equal((await app.invoke('listCompletionTasksV1', {}, 'admin')).data.has_more, true)
})

test('create/claim/finish keep the existing net target, register and gateway payload semantics', async () => {
	const app = makeApp()
	app.db.data('crm_pda_filling_tasks').clear()
	const created = await app.invoke('createTaskV1', { station_code: 'station_1', bottle_no: 'B1', target_net_weight: 12 })
	assert.equal(created.code, 0)
	assert.equal(created.data.status, 'write_pending')
	assert.equal(created.data.target_gross_weight, 42)
	const claimed = await app.invoke('claimTargetWriteV1', { scale_code: 'filling_scale_main' })
	assert.equal(claimed.data.task.target_net_weight, 12)
	assert.equal(claimed.data.task.target_register, '0x00CA')
	assert.equal(claimed.data.task.target_register_decimal, 202)
	assert.equal(claimed.data.task.target_value_kind, 'target_net_weight')
	const finished = await app.invoke('finishTargetWriteV1', { task_id: created.data._id, success: true, readback: 12, payload: { register: 202, value: 12 } })
	assert.equal(finished.data.status, 'ready')
	const task = app.db.data('crm_pda_filling_tasks').get(created.data._id)
	assert.equal(task.completion_intent, undefined)
	assert.equal(task.target_write_readback, 12)
	assert.equal(task.target_write_payload.value, 12)
})

test('claim that races a winning completion returns no hardware target and cannot reopen the task', async () => {
	const app = makeApp()
	app.task().status = 'write_pending'; app.task().target_write_status = 'pending'
	let raced = false
	app.db.setFault(async (name, action, patch) => {
		if (!raced && name === 'crm_pda_filling_tasks' && action === 'update' && patch.status === 'write_claimed') {
			raced = true
			const result = await app.invoke()
			assert.equal(view(result).complete, true)
		}
	})
	const claim = await app.invoke('claimTargetWriteV1', { scale_code: 'filling_scale_main' })
	assert.equal(claim.data.task, null)
	assert.equal(app.task().status, 'completed')
	assert.equal(app.task().target_write_status, 'pending')
})

test('downstream source payload proof is required before creating or freezing a task', async () => {
	const app = makeApp({ fillingCall: async ({ request }) => request.action === 'capabilitiesV1'
		? { code: 0, data: { durable_operations: true, source_status_query: true, rule_version: 'filling-consistency-2026-09-08-v2' } } : undefined })
	for (const action of ['createTaskV1', 'completeTaskV1', 'markAbnormalV1']) assert.equal((await app.invoke(action)).code, 503)
	assert.equal(app.task().completion_intent, undefined)
	assert.equal(app.db.data('crm_pda_filling_tasks').size, 1)
	assert.equal(mutations(app).length, 0)
})

test('same operation ID and bottle with different source facts cannot replace a frozen completion', async () => {
	for (const processingComplete of [true, false]) {
		let blocked = true
		const app = makeApp({ fillingCall: async ({ request }) => blocked && request.action === 'createV1' ? { code: 503, msg: 'not accepted' } : undefined,
			regulatory: processingComplete ? undefined : async () => ({ code: 500, msg: 'processing pending' }) })
		await app.invoke()
		const frozen = clone(app.task().completion_intent)
		blocked = false
		// Use the real public filling entry after the PDA transport failed before acceptance.
		const replacement = await app.filling('createV1', {
			operation_id: frozen.payload.operation_id, date: frozen.payload.date, bottle_no: frozen.payload.bottle_no,
			fill_weight: 99, operator_id: 'other', operator: 'different operator', status: 'error', alarm_state: true, remark: 'different facts'
		})
		assert.equal(replacement.code, 0)
		assert.equal(sources(app)[0].fill_weight, 99)
		assert.equal(frozen.payload.fill_weight, 10)
		const before = mutations(app).length
		for (const action of ['getTaskV1', 'completeTaskV1']) {
			const result = view(await app.invoke(action))
			assert.equal(result.source_saved, false)
			assert.equal(result.complete, false)
			assert.equal(result.can_retry, false)
			assert.equal(result.processing_status, 'conflict')
		}
		assert.equal(mutations(app).length, before)
		assert.equal(app.task().status, 'completion_pending')
		assert.equal(app.task().filling_record_id, null)
		assert.equal(app.task().completion_pending, true)
		assert.deepEqual(clone(app.task().completion_intent), frozen)
		assert.equal((await app.invoke('listCompletionTasksV1')).data.items.length, 1)
	}
})

test('identical frozen input created by another account cannot be adopted through admin access', async () => {
	const app = makeApp({ fillingCall: async ({ request }) => request.action === 'createV1' ? { code: 503, msg: 'not accepted' } : undefined })
	await app.invoke()
	const frozen = clone(app.task().completion_intent)
	const direct = await app.filling('createV1', clone(frozen.payload), 'admin')
	assert.equal(direct.code, 0)
	assert.equal(app.operation().created_by, 'admin')
	assert.equal(sources(app)[0].operator_id, 'owner')
	const before = mutations(app).length
	for (const action of ['getTaskV1', 'completeTaskV1']) {
		const result = view(await app.invoke(action, {}, 'admin'))
		assert.equal(result.source_saved, false)
		assert.equal(result.complete, false)
		assert.equal(result.can_retry, false)
		assert.equal(result.processing_status, 'conflict')
	}
	assert.equal(mutations(app).length, before)
	assert.equal(app.task().filling_record_id, null)
	assert.equal(app.task().completion_pending, true)
	assert.deepEqual(clone(app.task().completion_intent), frozen)
})

test('late target receipts preserve terminal or already linked legacy tasks and never allow resampling', async () => {
	for (const [status, sourceId] of [['completed', null], ['abnormal', null], ['completed', 'legacy-source'], ['abnormal', 'legacy-source'], ['ready', 'legacy-source']]) {
		const app = makeApp()
		Object.assign(app.task(), { status, filling_record_id: sourceId })
		assert.equal(view(await app.invoke('getTaskV1')).legacy, true)
		for (const success of [true, false]) {
			assert.equal((await app.invoke('finishTargetWriteV1', { success, readback: 10 })).code, 0)
			assert.equal(app.task().status, status)
			assert.equal(app.task().filling_record_id, sourceId)
		}
		app.scale(80)
		app.db.setFault(async (name, action) => { if (name === 'crm_pda_scale_latest' && action === 'get') throw Error('legacy completion must not resample') })
		const again = await app.invoke()
		assert.equal(again.code, 409)
		assert.equal(view(again).legacy, true)
		assert.equal(app.task().completion_intent, undefined)
		assert.equal(sources(app).length, 0)
	}
})

test('target receipt loses its conditional update if legacy status or source link changes after its read', async () => {
	for (const changed of [{ status: 'completed' }, { filling_record_id: 'legacy-source' }]) {
		const app = makeApp()
		let raced = false
		app.db.setFault(async (name, action, patch) => {
			if (!raced && name === 'crm_pda_filling_tasks' && action === 'update' && patch.target_write_status === 'failed') {
				raced = true
				Object.assign(app.task(), changed)
			}
		})
		const receipt = await app.invoke('finishTargetWriteV1', { success: false, error: 'late receipt' })
		assert.equal(receipt.code, 409)
		for (const [key, value] of Object.entries(changed)) assert.equal(app.task()[key], value)
		assert.equal(view(await app.invoke('getTaskV1')).legacy, true)
		assert.equal(app.task().target_write_status, 'success')
	}
})

test('target receipt racing a real completion cannot reopen the task or replace frozen target facts', async () => {
	const app = makeApp()
	let raced = false
	let frozen
	app.db.setFault(async (name, action, patch) => {
		if (!raced && name === 'crm_pda_filling_tasks' && action === 'update' && patch.target_write_status === 'failed') {
			raced = true
			assert.equal(view(await app.invoke()).complete, true)
			frozen = clone(app.task().completion_intent)
		}
	})
	const receipt = await app.invoke('finishTargetWriteV1', { success: false, error: 'late receipt', readback: 99 })
	assert.equal(receipt.code, 409)
	assert.equal(app.task().status, 'completed')
	assert.deepEqual(clone(app.task().completion_intent), frozen)
	assert.equal(sources(app).length, 1)
	assert.equal(sources(app)[0].fill_weight, 10)
})
