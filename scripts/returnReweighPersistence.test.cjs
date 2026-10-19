'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApp } = require('./lib/fillingHarness.cjs')
const { bottleKey } = require('../uniCloud-alipay/cloudfunctions/crm-filling/returnReweighRules')
const rows = (app, name) => [...app.db.data(name).values()]
const plain = value => JSON.parse(JSON.stringify(value))
const roundId = 'return_round_001'
function fixture() {
	const app = makeApp()
	for (const id of ['b1', 'b2']) Object.assign(app.db.data('crm_bottles').get(id), { tare_weight: 100 })
	return app
}
async function start(app, id = roundId, expected = '', token = 'good') {
	const result = await app.invoke('startReturnReweighRoundV1', { round_id: id, expected_round_id: expected }, token)
	assert.equal(result.code, 0, result.msg)
	return result.data.round
}
async function request(app, operation_id, options = {}, token = 'good') {
	const query = { round_id: roundId, bottle_no: 'B1', gross_weight: 120, ...options }
	const preview = await app.invoke('previewReturnReweighV1', query, token)
	assert.equal(preview.code, 0, preview.msg)
	return { ...query, operation_id, context_hash: preview.data.context_hash, capture_method: 'ble',
		capture: { stable: true, sampled_at: app.now(), stable_seq: 1, measurement_id: operation_id + '_reading', device_id: 'NVK1', raw: 'ST,GS,+120.0kg' } }
}
async function save(app, id = 'return_operation_001', options = {}, token = 'good') {
	const payload = await request(app, id, options, token)
	const result = await app.invoke('saveReturnReweighV1', payload, token)
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.complete, true)
	return { payload, result }
}
async function fill(app, id = 'return_fill_operation_001') {
	const query = { bottle_no: 'B1', gross_weight: 170 }
	const preview = await app.invoke('previewReweighV1', query)
	assert.equal(preview.code, 0, preview.msg)
	const result = await app.invoke('createReweighV1', { ...query, date: preview.data.date, operation_id: id,
		context_hash: preview.data.context_hash, capture_method: 'ble', capture: { stable: true, sampled_at: app.now(),
			stable_seq: 1, measurement_id: id + '_reading', device_id: 'NVK1' } })
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.complete, true, result.data.last_error)
	return rows(app, 'crm_fillings').find(row => row.operation_id === id)
}

test('round creation retries and restores current round while new round resets only its statistics', async () => {
	const app = fixture()
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round, null)
	const first = await start(app)
	assert.equal(first.bottle_count, 0)
	await save(app)
	assert.equal((await start(app)).bottle_count, 1)
	const restored = await app.invoke('getReturnReweighRoundV1')
	assert.equal(restored.data.round._id, roundId)
	assert.equal(restored.data.round.bottle_count, 1)
	assert.equal((await app.invoke('startReturnReweighRoundV1', { round_id: 'return_round_002', expected_round_id: '' })).code, 409)
	const next = await start(app, 'return_round_002', roundId)
	assert.equal(next.bottle_count, 0)
	assert.equal(rows(app, 'crm_return_reweighs').length, 1)
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round._id, next._id)
	// Replaying an old creation receipt must not reactivate that old round.
	await start(app)
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round._id, next._id)
})

test('return saves without any sale-return prerequisite; repeat weighs count distinct bottles once', async () => {
	const app = fixture(); await start(app)
	assert.equal(rows(app, 'crm_sale_records').length, 0)
	const first = await save(app)
	assert.equal(first.result.data.round.bottle_count, 1)
	assert.equal(first.result.data.net_weight, 20)
	const second = await save(app, 'return_operation_002', { gross_weight: 121 })
	assert.equal(second.result.data.round.bottle_count, 1)
	await save(app, 'return_operation_003', { bottle_no: 'B2', gross_weight: 110 })
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round.bottle_count, 2)
	assert.equal(rows(app, 'crm_return_reweighs').length, 3)
	const head = app.db.data('crm_return_reweigh_state').get(bottleKey('B1'))
	assert.equal(head.record_id, second.result.data._id)
	assert.equal(app.db.data('crm_return_reweighs').get(head.record_id).previous_record_id, first.result.data._id)
	for (const name of ['crm_fillings', 'crm_bottle_movements', 'crm_gas_inventory_movements', 'crm_sale_records']) assert.equal(rows(app, name).length, 0, name)
})

test('same immutable operation recovers saved result and rejects changed payload without double counting', async () => {
	const app = fixture(); await start(app)
	const { payload, result } = await save(app)
	assert.equal((await app.invoke('saveReturnReweighV1', payload)).data._id, result.data._id)
	assert.equal((await app.invoke('getReturnReweighV1', { operation_id: payload.operation_id })).data._id, result.data._id)
	assert.equal((await app.invoke('saveReturnReweighV1', { ...payload, gross_weight: 130 })).code, 409)
	assert.equal((await app.invoke('getReturnReweighV1', { operation_id: 'unknown_operation_001' })).code, 404)
	assert.equal(rows(app, 'crm_return_reweighs').length, 1)
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round.bottle_count, 1)
})

test('zero and negative signed return net are preserved, and filling uses actual return gross', async () => {
	for (const gross of [100, 99.5]) {
		const app = fixture(); await start(app)
		const saved = await save(app, 'return_signed_operation', { gross_weight: gross })
		assert.equal(saved.result.data.net_weight, gross - 100)
		const filling = await fill(app)
		assert.equal(filling.fill_weight, 170 - gross)
		assert.equal(filling.reweigh.net_weight, 70)
		assert.equal(filling.reweigh.basis.return_reweigh_id, saved.result.data._id)
	}
})

test('consumed baseline cannot be replaced, even with a new count round or a preview from before filling', async () => {
	const app = fixture(); await start(app); await save(app)
	const stale = await request(app, 'return_stale_after_fill')
	const filling = await fill(app)
	assert.equal(app.db.data('crm_return_reweigh_state').get(bottleKey('B1')).consumed_filling_id, filling._id)
	const blocked = await app.invoke('saveReturnReweighV1', stale)
	assert.equal(blocked.code, 409)
	assert.match(blocked.msg, /已用于灌装/)
	await start(app, 'return_round_002', roundId)
	assert.equal((await app.invoke('previewReturnReweighV1', { round_id: 'return_round_002', bottle_no: 'B1', gross_weight: 120 })).code, 409)
	assert.equal(rows(app, 'crm_return_reweighs').length, 1)
})

test('new departure allows return but preserves same-day filling limit; next-day fill uses new baseline', async () => {
	const app = fixture(); await start(app); await save(app); await fill(app)
	app.db.data('crm_sale_records').set('out_after_fill', { _id: 'out_after_fill', date: '2026-09-06', out_items: [{ bottle_no: 'B1', gross: 170, tare: 100, net: 70 }] })
	const next = await save(app, 'return_next_cycle_operation', { gross_weight: 110 })
	const query = { bottle_no: 'B1', gross_weight: 170 }
	const preview = await app.invoke('previewReweighV1', query)
	assert.equal(preview.code, 0)
	const sameDay = await app.invoke('createReweighV1', { ...query, date: preview.data.date, operation_id: 'return_same_day_fill',
		context_hash: preview.data.context_hash, capture_method: 'ble', capture: { stable: true, sampled_at: app.now(), stable_seq: 1, measurement_id: 'same_day_reading' } })
	assert.notEqual(sameDay.data?.complete, true)
	assert.match(JSON.stringify(sameDay), /同日期同瓶号/)
	assert.equal(rows(app, 'crm_fillings').length, 1)
	app.advance(86400000)
	const filling = await fill(app, 'return_fill_operation_002')
	assert.equal(filling.fill_weight, 60)
	assert.equal(filling.reweigh.basis.return_reweigh_id, next.result.data._id)
	assert.equal(rows(app, 'crm_fillings').length, 2)
	assert.equal(next.result.data.round.bottle_count, 1)
})

test('editing an old departure is insufficient evidence to reopen a consumed cycle', async () => {
	const app = fixture()
	app.db.data('crm_sale_records').set('old_out', { _id: 'old_out', date: '2026-09-05', out_items: [{ bottle_no: 'B1', gross: 160 }] })
	await start(app); await save(app); await fill(app)
	app.db.data('crm_sale_records').get('old_out').out_items[0].gross = 180
	const result = await app.invoke('previewReturnReweighV1', { round_id: roundId, bottle_no: 'B1', gross_weight: 120 })
	assert.equal(result.code, 409)
	assert.match(result.msg, /已用于灌装/)
})

test('shifting or reordering historical departure rows cannot reopen a consumed cycle, including legacy snapshots', async () => {
	for (const legacy of [false, true]) {
		const app = fixture()
		const sale = { _id: 'old_same_day', date: '2026-09-06', out_items: [{ bottle_no: 'B2', gross: 140 }, { bottle_no: 'B1', gross: 170 }] }
		app.db.data('crm_sale_records').set(sale._id, sale)
		await start(app); const saved = await save(app)
		if (legacy) app.db.data('crm_return_reweighs').get(saved.result.data._id).outgoing_facts[0].key = 'old_same_day:out_items:1'
		await fill(app)
		sale.out_items.shift()
		const blocked = await app.invoke('previewReturnReweighV1', { round_id: roundId, bottle_no: 'B1', gross_weight: 110 })
		assert.equal(blocked.code, 409)
		assert.match(blocked.msg, /已用于灌装/)
		// The retained bottle is still the same physical departure, so unrelated
		// row movement also must not invalidate its legitimate correction preview.
		assert.equal((await app.invoke('previewReweighV1', { bottle_no: 'B1', gross_weight: 175 })).code, 0)
		assert.equal(rows(app, 'crm_return_reweighs').length, 1)
		assert.equal(rows(app, 'crm_fillings').length, 1)
	}
})

test('stale bottle, return head and round previews reject without changing measurement or count', async () => {
	for (const variant of ['tare', 'head', 'round']) {
		const app = fixture(); await start(app)
		const payload = await request(app, 'return_stale_operation')
		if (variant === 'tare') app.db.data('crm_bottles').get('b1').tare_weight = 101
		if (variant === 'head') await save(app, 'return_other_operation')
		if (variant === 'round') await start(app, 'return_round_002', roundId)
		const before = plain(rows(app, 'crm_return_reweighs'))
		assert.equal((await app.invoke('saveReturnReweighV1', payload)).code, 409)
		assert.deepEqual(rows(app, 'crm_return_reweighs'), before)
	}
})

test('transaction failure after record and head writes rolls back statistics and safely retries original payload', async () => {
	const app = fixture(); await start(app)
	const payload = await request(app, 'return_rollback_operation')
	let fail = true
	app.db.setFault(async (name, action) => { if (name === 'crm_return_reweigh_rounds' && action === 'update' && fail) { fail = false; throw Error('round update failed') } })
	assert.equal((await app.invoke('saveReturnReweighV1', payload)).code, 503)
	assert.equal(rows(app, 'crm_return_reweighs').length, 0)
	assert.equal(app.db.data('crm_return_reweigh_state').get(bottleKey('B1')), undefined)
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round.bottle_count, 0)
	const retried = await app.invoke('saveReturnReweighV1', payload)
	assert.equal(retried.code, 0, retried.msg)
	assert.equal(retried.data.round.bottle_count, 1)
})

test('lost commit acknowledgement recovers the existing return without duplicate record or count', async () => {
	const app = fixture(); await start(app)
	const payload = await request(app, 'return_lost_ack_operation')
	const startTransaction = app.db.startTransaction.bind(app.db)
	let lost = true
	app.db.startTransaction = async () => {
		const tx = await startTransaction(), commit = tx.commit.bind(tx)
		tx.commit = async () => { await commit(); if (lost) { lost = false; throw Error('commit acknowledgement lost') } }
		return tx
	}
	assert.equal((await app.invoke('saveReturnReweighV1', payload)).code, 503)
	assert.equal((await app.invoke('getReturnReweighV1', { operation_id: payload.operation_id })).data.complete, true)
	assert.equal((await app.invoke('saveReturnReweighV1', payload)).data.round.bottle_count, 1)
	assert.equal(rows(app, 'crm_return_reweighs').length, 1)
})

test('return page ACL and round/operation ownership prevent cross-account writes and reads', async () => {
	const app = fixture(); await start(app)
	const { payload } = await save(app)
	const other = { _id: 'other', username: 'other', token: 'other', role: 'user', page_permissions: {
		'/pages/pda/return-reweigh': { view: true, create: true }
	} }
	app.db.data('crm_users').set(other._id, other)
	assert.equal((await app.invoke('startReturnReweighRoundV1', { round_id: roundId }, 'other')).code, 403)
	assert.equal((await app.invoke('getReturnReweighV1', { operation_id: payload.operation_id }, 'other')).code, 403)
	assert.equal((await app.invoke('saveReturnReweighV1', payload, 'other')).code, 403)
	assert.equal((await app.invoke('previewReturnReweighV1', { round_id: roundId, bottle_no: 'B1' }, 'other')).code, 409)
	await start(app, 'return_other_round', '', 'other')
	const otherPayload = await request(app, 'return_other_op_001', { round_id: 'return_other_round' }, 'other')
	other.page_permissions['/pages/pda/return-reweigh'].create = false
	assert.equal((await app.invoke('saveReturnReweighV1', otherPayload, 'other')).code, 403)
	other.page_permissions['/pages/pda/return-reweigh'].view = false
	assert.equal((await app.invoke('getReturnReweighRoundV1', {}, 'other')).code, 403)
})

test('invalid scale weights and unstable evidence never create measurements', async () => {
	const app = fixture(); await start(app)
	for (const gross of [0, -1, 100.1, '', 'NaN', true]) {
		const result = await app.invoke('previewReturnReweighV1', { round_id: roundId, bottle_no: 'B1', gross_weight: gross })
		if (gross === '') assert.equal(result.data.gross_weight, null)
		else assert.notEqual(result.code, 0)
	}
	const payload = await request(app, 'return_bad_evidence')
	for (const patch of [{ capture_method: 'manual' }, { capture: null }, { capture: { ...payload.capture, stable: false } }, { capture: { ...payload.capture, sampled_at: app.now() + 120000 } }]) {
		assert.equal((await app.invoke('saveReturnReweighV1', { ...payload, ...patch })).code, 400)
	}
	assert.equal(rows(app, 'crm_return_reweighs').length, 0)
})


test('concurrent distinct bottles retain both count entries; concurrent same-bottle previews cannot overwrite', async () => {
	const app = fixture(); await start(app)
	const first = await request(app, 'return_parallel_001')
	const second = await request(app, 'return_parallel_002', { bottle_no: 'B2', gross_weight: 110 })
	const results = await Promise.all([app.invoke('saveReturnReweighV1', first), app.invoke('saveReturnReweighV1', second)])
	assert.ok(results.every(result => result.code === 0), JSON.stringify(results))
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round.bottle_count, 2)
	const a = await request(app, 'return_parallel_003', { gross_weight: 121 })
	const b = await request(app, 'return_parallel_004', { gross_weight: 122 })
	const updates = await Promise.all([app.invoke('saveReturnReweighV1', a), app.invoke('saveReturnReweighV1', b)])
	assert.equal(updates.filter(result => result.code === 0).length, 1, JSON.stringify(updates))
	assert.equal(updates.filter(result => result.code === 409).length, 1, JSON.stringify(updates))
	assert.equal(rows(app, 'crm_return_reweighs').length, 3)
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round.bottle_count, 2)
})
