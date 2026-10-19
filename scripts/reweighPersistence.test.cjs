'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApp } = require('./lib/fillingHarness.cjs')
const { bottleKey } = require('../uniCloud-alipay/cloudfunctions/crm-filling/returnReweighRules')
const rows = (app, name) => [...app.db.data(name).values()]
const source = app => rows(app, 'crm_fillings')[0]
const plain = value => JSON.parse(JSON.stringify(value))

function fixture(options) {
	const app = makeApp(options)
	Object.assign(app.db.data('crm_bottles').get('b1'), { tare_weight: 100 })
	app.db.data('crm_sale_records').set('return1', { _id: 'return1', date: '2026-09-05', biz_mode: 'bottle',
		back_items: [{ bottle_no: 'B1', gross: 120, tare: 100, net: 20 }], out_items: [], updated_at: 1 })
	app.db.data('crm_return_reweighs').set('measured_return1', { _id: 'measured_return1', bottle_id: 'b1', bottle_no: 'B1',
		round_id: 'return_round_001', date: '2026-09-05 08:00:00', created_at: app.now() - 86400000,
		gross_weight: 120, tare_weight: 100, net_weight: 20, outgoing_facts: [], manual_facts: [], baseline_filling_ids: [] })
	app.db.data('crm_return_reweigh_state').set(bottleKey('B1'), { _id: bottleKey('B1'), kind: 'bottle', bottle_no: 'B1',
		record_id: 'measured_return1', consumed_filling_id: '' })
	return app
}

async function request(app, operation_id, extra = {}) {
	const query = { bottle_no: 'B1', date: '2026-09-06-08', gross_weight: 170, ...extra }
	const preview = await app.invoke('previewReweighV1', query)
	assert.equal(preview.code, 0, preview.msg)
	return { ...query, operation_id, context_hash: preview.data.context_hash, capture_method: 'ble',
		capture: { sampled_at: app.now(), device_id: 'NVK1', stable_seq: 1, measurement_id: `${operation_id}_m1`, stable: true, raw: { frame: 'ST,GS,+170.0kg' } }, ...extra }
}

async function create(app, operation_id = 'reweigh_create_001') {
	const payload = await request(app, operation_id)
	const result = await app.invoke('createReweighV1', payload)
	assert.equal(result.code, 0, result.msg)
	return { payload, result }
}

async function correction(app, operation_id = 'reweigh_correct_001', extra = {}) {
	const old = source(app)
	return request(app, operation_id, { filling_id: old._id, expected_source_version: old.source_version,
		gross_weight: 175, reason: '重新挂瓶确认重量', ...extra })
}

function assertOneContribution(app, expected) {
	assert.equal(rows(app, 'crm_fillings').length, 1)
	const fill = rows(app, 'crm_bottle_movements').filter(row => row.type === 'fill')
	const gas = rows(app, 'crm_gas_inventory_movements').filter(row => row.source_type === 'filling')
	assert.equal(fill.length, 1)
	assert.equal(gas.length, 1)
	assert.equal(source(app).fill_weight, expected)
	assert.equal(fill[0].net_weight, expected)
	assert.equal(gas[0].station_delta_t, -expected / 1000)
	assert.equal(gas[0].in_bottle_delta_t, expected / 1000)
}

test('real handler creates 50 kg filling, 70 kg label net, and freezes an idempotent source', async () => {
	const app = fixture(), { payload, result } = await create(app)
	assert.equal(result.data.complete, true, result.data.last_error)
	assertOneContribution(app, 50)
	const row = source(app)
	assert.equal(row.entry_source, 'pda_reweigh')
	assert.equal(row.weight_start, null)
	assert.equal(row.weight_end, 170)
	assert.equal(row.reweigh.net_weight, 70)
	assert.deepEqual(Object.keys(row.reweigh.label).sort(), ['bottle_no', 'company', 'gross_weight', 'net_weight', 'tare_weight'])
	assert.equal(row.reweigh.label.company, '新拓能源')
	assert.equal(row.reweigh.basis.source_type, 'pda_return_reweigh')
	assert.equal(row.reweigh.basis.return_reweigh_id, 'measured_return1')
	assert.equal(row._reweigh_before, undefined)
	assert.equal(row._reweigh_guard, undefined)
	const repeat = await app.invoke('createReweighV1', payload)
	assert.equal(repeat.code, 0, repeat.msg)
	assertOneContribution(app, 50)
	assert.equal((await app.invoke('createReweighV1', { ...payload, gross_weight: 175 })).code, 409)
	const status = await app.invoke('getOperationV1', { operation_id: payload.operation_id })
	assert.equal(status.data.source_records[0].saved, true)
	assert.equal(status.data.source_records[0].version_matches, true)
})

test('BLE correction replaces one contribution, keeps original business identity and original BLE proof', async () => {
	const app = fixture(); await create(app)
	const old = plain(source(app))
	app.advance(86400000)
	const payload = await correction(app)
	const result = await app.invoke('correctReweighV1', payload)
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.complete, true, result.data.last_error)
	assertOneContribution(app, 55)
	const row = source(app)
	assert.equal(row._id, old._id)
	assert.equal(row.source_version, 2)
	assert.equal(row.date, old.date)
	assert.equal(row.filling_time, old.filling_time)
	assert.equal(row.operator_id, old.operator_id)
	assert.equal(row.reweigh.net_weight, 75)
	assert.deepEqual(row.reweigh.original_ble_capture, old.reweigh.capture)
	assert.equal(row.reweigh.capture.measurement_id, payload.capture.measurement_id)
	assert.equal((await app.invoke('correctReweighV1', payload)).code, 0)
	assertOneContribution(app, 55)
})

test('manual corrections require reason and web-edit permission while preserving original BLE', async () => {
	const app = fixture(); await create(app)
	const originalCapture = plain(source(app).reweigh.capture)
	const payload = await correction(app, 'reweigh_manual_001', { capture_method: 'manual', gross_weight: 175.1, capture: null })
	assert.equal((await app.invoke('correctReweighV1', { ...payload, reason: '' })).code, 400)
	app.db.data('crm_users').set('pda', { _id: 'pda', username: 'pda', role: 'user', token: 'pda', page_permissions: {
		'/pages/pda/reweigh': { view: true, create: true, update: true }, '/pages/filling/edit': { view: false, update: false }
	} })
	assert.equal((await app.invoke('correctReweighV1', payload, 'pda')).code, 403)
	const result = await app.invoke('correctReweighV1', payload)
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.complete, true, result.data.last_error)
	assertOneContribution(app, 55.1)
	assert.equal(source(app).reweigh.capture, null)
	assert.equal(source(app).reweigh.reason, payload.reason)
	assert.deepEqual(source(app).reweigh.original_ble_capture, originalCapture)
})

test('creation source transaction rollback leaves no movement or inventory and original operation recovers', async () => {
	const app = fixture(), payload = await request(app, 'reweigh_tx_create_001')
	let fault = true
	app.db.setFault(async (name, action) => { if (name === 'crm_fillings' && action === 'add' && fault) { fault = false; throw new Error('source write failed') } })
	const first = await app.invoke('createReweighV1', payload)
	assert.equal(first.data.saved_total, 0)
	for (const name of ['crm_fillings', 'crm_bottle_movements', 'crm_gas_inventory_movements']) assert.equal(rows(app, name).length, 0, name)
	const retry = await app.invoke('retryOperationV1', { operation_id: payload.operation_id })
	assert.equal(retry.data.complete, true, retry.data.last_error)
	assertOneContribution(app, 50)
})

test('correction transaction rollback preserves source and both contributions before a safe retry', async () => {
	const app = fixture(); await create(app)
	const before = plain(source(app)), payload = await correction(app, 'reweigh_tx_correct_001')
	let fault = true
	app.db.setFault(async (name, action) => { if (name === 'crm_gas_inventory_movements' && action === 'update' && fault) { fault = false; throw new Error('inventory write failed') } })
	const first = await app.invoke('correctReweighV1', payload)
	assert.equal(first.data.saved_total, 0)
	assert.deepEqual(source(app), before)
	assertOneContribution(app, 50)
	const retry = await app.invoke('retryOperationV1', { operation_id: payload.operation_id })
	assert.equal(retry.data.complete, true, retry.data.last_error)
	assertOneContribution(app, 55)
})

test('source commit followed by scan failure stays saved and recovers without replaying quantities', async () => {
	let scanFails = false
	const app = fixture({ scan: async () => scanFails ? { code: 503, msg: 'scan unavailable' } : { code: 0, data: { done: true } } })
	await create(app)
	scanFails = true
	const payload = await correction(app, 'reweigh_pending_001')
	const first = await app.invoke('correctReweighV1', payload)
	assert.equal(first.data.complete, false)
	assert.equal(first.data.saved_total, 1)
	assertOneContribution(app, 55)
	const status = await app.invoke('getOperationV1', { operation_id: payload.operation_id })
	assert.equal(status.data.source_records[0].saved, true)
	assert.equal(status.data.source_records[0].version_matches, true)
	scanFails = false
	const retry = await app.invoke('retryOperationV1', { operation_id: payload.operation_id })
	assert.equal(retry.data.complete, true, retry.data.last_error)
	assertOneContribution(app, 55)
})

test('lost saved-cursor acknowledgement finds committed reweigh source and retries the same operation safely', async () => {
	const app = fixture(), payload = await request(app, 'reweigh_lost_ack_001')
	let fault = true
	app.db.setFault(async (name, action, patch) => {
		if (name === 'crm_filling_operations' && action === 'update' && patch.saved_cursor === 1 && fault) { fault = false; throw new Error('lost checkpoint acknowledgement') }
	})
	const result = await app.invoke('createReweighV1', payload)
	assert.equal(result.data.complete, false)
	const status = await app.invoke('getOperationV1', { operation_id: payload.operation_id })
	assert.equal(status.data.source_records[0].saved, true)
	assert.equal(status.data.source_records[0].version_matches, true)
	assertOneContribution(app, 50)
	const retry = await app.invoke('retryOperationV1', { operation_id: payload.operation_id })
	assert.equal(retry.data.complete, true, retry.data.last_error)
	assertOneContribution(app, 50)
})

test('concurrent corrections from the same source version permit only one new version', async () => {
	const app = fixture(); await create(app)
	const first = await correction(app, 'reweigh_race_001')
	const second = await correction(app, 'reweigh_race_002', { gross_weight: 180 })
	const results = await Promise.all([app.invoke('correctReweighV1', first), app.invoke('correctReweighV1', second)])
	assert.equal(results.filter(result => result.code === 0 && result.data?.saved_total === 1).length, 1, JSON.stringify(results))
	assert.equal(source(app).source_version, 2)
	assertOneContribution(app, source(app).fill_weight)
	assert.ok([55, 60].includes(source(app).fill_weight))
})

test('changed return or bottle tare after preview rejects creation before any source write', async () => {
	for (const change of [app => { app.db.data('crm_return_reweighs').get('measured_return1').gross_weight = 121 }, app => { app.db.data('crm_bottles').get('b1').tare_weight = 101 }]) {
		const app = fixture(), payload = await request(app, 'reweigh_stale_001')
		change(app)
		assert.equal((await app.invoke('createReweighV1', payload)).code, 409)
		assert.equal(rows(app, 'crm_fillings').length, 0)
		assert.equal(rows(app, 'crm_filling_operations').length, 0)
	}
})

test('outbound, legacy source and multiple fillings block correction through the real reader', async () => {
	for (const change of [app => { app.db.data('crm_sale_records').set('out1', { _id: 'out1', date: '2026-09-06', out_items: [{ bottle_no: 'B1' }] }) },
		app => { app.db.data('crm_sale_records').set('agent1', { _id: 'agent1', date: '2026-09-06', agent_sale_items: [{ bottle_no: 'B1' }] }) },
		app => { source(app).entry_source = 'legacy'; source(app).scale_source = 'C606+' },
		app => { app.db.data('crm_fillings').set('extra', { ...plain(source(app)), _id: 'extra' }) }]) {
		const app = fixture(); await create(app)
		const payload = await correction(app, 'reweigh_blocked_001')
		change(app)
		assert.equal((await app.invoke('correctReweighV1', payload)).code, 409)
		assert.equal(source(app).source_version, 1)
	}
})

test('ordinary update cannot bypass protected reweigh weights or evidence', async () => {
	const app = fixture(); await create(app)
	for (const patch of [{ fill_weight: 999 }, { weight_end: 999, expected_source_version: 1 }, { reweigh: {} }]) {
		const result = await app.invoke('updateV1', { _id: source(app)._id, ...patch })
		assert.equal(result.code, 409, result.msg)
	}
	assertOneContribution(app, 50)
})

test('batch date and operator changes cannot bypass original reweigh business identity', async () => {
	const app = fixture(); await create(app)
	const before = plain(source(app))
	const changedDate = await app.invoke('batchUpdateDateV1', { scope_mode: 'ids', selector: { ids: [before._id] }, new_date: '2026-09-07-09' })
	assert.ok(changedDate.code !== 0 || changedDate.data.success === 0, JSON.stringify(changedDate))
	assert.match(JSON.stringify(changedDate), /复秤/)
	assert.deepEqual(source(app), before)
	const changedOperator = await app.invoke('batchUpdateOperatorV1', { ids: [before._id], expected_date: before.date,
		expected_operator: before.operator, operator: 'another operator', operator_id: 'another', confirm_text: 'UPDATE_FILLING_OPERATOR' })
	assert.notEqual(changedOperator.code, 0, JSON.stringify(changedOperator))
	assert.match(JSON.stringify(changedOperator), /复秤/)
	assert.deepEqual(source(app), before)
	assertOneContribution(app, 50)
})

test('PDA create-only owner can recover own creation but cannot recover a correction without update permission', async () => {
	let unavailable = true
	const app = fixture({ regulatory: async () => unavailable ? { code: 503, msg: 'temporary regulator outage' } : { code: 0, data: {
		total_event_payload: 1, enqueued_total: 1, duplicate_total: 0, missing_bottle_total: 0,
		snapshot: { found_total: 1, enqueued_total: 1, duplicate_total: 0, missing_total: 0 }
	} } })
	const user = { _id: 'creator', username: 'creator', role: 'user', token: 'creator', page_permissions: {
		'/pages/pda/reweigh': { view: true, create: true, update: false },
		'/pages/filling/list': { view: false, create: false }, '/pages/filling/edit': { view: false, update: false },
		'/pages/pda/filling-create': { view: false, create: false }
	} }
	app.db.data('crm_users').set(user._id, user)
	const payload = await request(app, 'reweigh_creator_recover')
	const created = await app.invoke('createReweighV1', payload, user.token)
	assert.equal(created.code, 0, created.msg)
	assert.equal(created.data.complete, false)
	assert.equal(created.data.saved_total, 1)
	unavailable = false
	const retry = await app.invoke('retryOperationV1', { operation_id: payload.operation_id }, user.token)
	assert.equal(retry.code, 0, retry.msg)
	assert.equal(retry.data.complete, true, retry.data.last_error)
	assertOneContribution(app, 50)
	const unrelated = { ...plain(user), _id: 'unrelated', token: 'unrelated' }
	app.db.data('crm_users').set(unrelated._id, unrelated)
	assert.equal((await app.invoke('retryOperationV1', { operation_id: payload.operation_id }, unrelated.token)).code, 403)
	user.page_permissions['/pages/pda/reweigh'].update = true
	unavailable = true
	const correctedPayload = await correction(app, 'reweigh_update_recover')
	const corrected = await app.invoke('correctReweighV1', correctedPayload, user.token)
	assert.equal(corrected.code, 0, corrected.msg)
	assert.equal(corrected.data.complete, false)
	user.page_permissions['/pages/pda/reweigh'].update = false
	unavailable = false
	assert.equal((await app.invoke('retryOperationV1', { operation_id: correctedPayload.operation_id }, user.token)).code, 403)
	assertOneContribution(app, 55)
})

test('unrelated sale payment and remark changes do not strand committed reweigh work during recovery', async () => {
	let unavailable = true
	const app = fixture({ regulatory: async () => unavailable ? { code: 503, msg: 'temporary regulator outage' } : { code: 0, data: {
		total_event_payload: 1, enqueued_total: 1, duplicate_total: 0, missing_bottle_total: 0,
		snapshot: { found_total: 1, enqueued_total: 1, duplicate_total: 0, missing_total: 0 }
	} } })
	const { payload, result } = await create(app, 'reweigh_nonphysical_update')
	assert.equal(result.data.saved_total, 1)
	assert.equal(result.data.complete, false)
	assert.equal(app.operation(payload.operation_id).row_cursor, 0)
	Object.assign(app.db.data('crm_sale_records').get('return1'), { payment_status: 'paid', paid_amount: 100,
		remark: '收款回单已核对', updated_at: app.now() + 1 })
	unavailable = false
	const retry = await app.invoke('retryOperationV1', { operation_id: payload.operation_id })
	assert.equal(retry.code, 0, retry.msg)
	assert.equal(retry.data.complete, true, retry.data.last_error)
	assertOneContribution(app, 50)
	assert.equal(source(app).reweigh.basis.gross_weight, 120)
})
