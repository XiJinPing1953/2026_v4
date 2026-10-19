'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApp } = require('./lib/fillingHarness.cjs')
const { writeSaleSource } = require('../uniCloud-alipay/cloudfunctions/crm-sale/saleSourceWrite')

const rows = (app, name) => [...app.db.data(name).values()]
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function setup() {
	const app = makeApp({ serializeTransactions: false })
	app.db.data('crm_bottles').get('b1').tare_weight = 100
	await app.invoke('startReturnReweighRoundV1', { round_id: 'review_round_001', expected_round_id: '' })
	await saveReturn(app)
	const payload = await request(app, 'create_review_001')
	assert.equal((await app.invoke('createReweighV1', payload)).data.complete, true)
	return app
}
async function saveReturn(app) {
	const query = { bottle_no: 'B1', round_id: 'review_round_001', gross_weight: 120 }
	const p = await app.invoke('previewReturnReweighV1', query)
	return app.invoke('saveReturnReweighV1', { ...query, context_hash: p.data.context_hash, operation_id: 'return_review_001', capture_method: 'ble',
		capture: { sampled_at: app.now(), stable: true, stable_seq: 1, measurement_id: 'return_measurement' } })
}
async function request(app, id, correct = false) {
	const old = rows(app, 'crm_fillings')[0]
	const q = { bottle_no: 'B1', gross_weight: correct ? 180 : 170, ...(correct ? { filling_id: old._id } : {}) }
	const p = await app.invoke('previewReweighV1', q)
	assert.equal(p.code, 0, p.msg)
	return { ...q, date: p.data.date, context_hash: p.data.context_hash, operation_id: id,
		expected_source_version: old?.source_version, reason: '本地并发测试', capture_method: 'ble',
		capture: { sampled_at: app.now(), stable: true, stable_seq: 1, measurement_id: id } }
}
const departure = () => ({ _id: 'review_sale_out', date: '2026-09-06', out_items: [{ bottle_no: 'B1', gross: 170, tare: 100, net: 70 }] })
const writeDeparture = (app, before = null) => writeSaleSource(app.db, before, departure(), tx => before
	? tx.collection('crm_sale_records').doc(before._id).update(departure()) : tx.collection('crm_sale_records').add(departure()))

for (const edit of [false, true]) test(`a ${edit ? 'sale edit' : 'new departure'} committed after correction validation forces correction rollback`, async () => {
	const app = await setup()
	const before = edit ? { _id: 'review_sale_out', date: '2026-09-06', out_items: [] } : null
	if (before) app.db.data('crm_sale_records').set(before._id, before)
	const payload = await request(app, 'correct_review_001', true)
	const entered = deferred(), release = deferred(); let paused = false
	app.db.setFault(async (name, action) => {
		if (!paused && name === 'crm_fillings' && action === 'update') { paused = true; entered.resolve(); await release.promise }
	})
	const correction = app.invoke('correctReweighV1', payload)
	await entered.promise
	try { await writeDeparture(app, before) } finally { release.resolve() }
	const result = await correction
	assert.notEqual(result.data?.complete, true)
	assert.equal(rows(app, 'crm_fillings')[0].reweigh.gross_weight, 170)
	assert.equal(rows(app, 'crm_gas_inventory_movements')[0].station_delta_t, -0.05)
	assert.equal(rows(app, 'crm_sale_records').length, 1)
	// Old immutable work may not overwrite the now-departed bottle on retry.
	assert.notEqual((await app.invoke('retryOperationV1', { operation_id: payload.operation_id })).data?.complete, true)
	assert.equal(rows(app, 'crm_fillings')[0].reweigh.gross_weight, 170)
})

test('the opposite commit order rejects the stale sale transaction and allows a fresh source retry', async () => {
	const app = await setup(), payload = await request(app, 'correct_review_002', true)
	const entered = deferred(), release = deferred(); let paused = false
	app.db.setFault(async (name, action) => {
		if (!paused && name === 'crm_sale_records' && action === 'add') { paused = true; entered.resolve(); await release.promise }
	})
	const sale = writeDeparture(app)
	const rejected = assert.rejects(sale, /conflict/)
	await entered.promise
	try { assert.equal((await app.invoke('correctReweighV1', payload)).data.complete, true) } finally { release.resolve() }
	await rejected
	assert.equal(rows(app, 'crm_sale_records').length, 0)
	assert.equal(rows(app, 'crm_fillings')[0].reweigh.gross_weight, 180)
	await writeDeparture(app)
	assert.equal(rows(app, 'crm_sale_records').length, 1)
})

test('a new departure also conflicts with the first return measurement before its commit', async () => {
	const app = makeApp({ serializeTransactions: false })
	app.db.data('crm_bottles').get('b1').tare_weight = 100
	await app.invoke('startReturnReweighRoundV1', { round_id: 'review_round_001', expected_round_id: '' })
	const entered = deferred(), release = deferred(); let paused = false
	app.db.setFault(async (name, action) => {
		if (!paused && name === 'crm_return_reweighs' && action === 'add') { paused = true; entered.resolve(); await release.promise }
	})
	const measurement = saveReturn(app)
	await entered.promise
	try { await writeDeparture(app) } finally { release.resolve() }
	assert.equal((await measurement).code, 503)
	assert.equal(rows(app, 'crm_return_reweighs').length, 0)
	assert.equal((await app.invoke('getReturnReweighRoundV1')).data.round.bottle_count, 0)
})
