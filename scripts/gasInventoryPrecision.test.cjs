'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const { inventoryTon, kgToTon } = require('../uniCloud-alipay/cloudfunctions/common/gasInventoryPrecision')

function internals(name, symbols) {
	const file = path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions', name, 'index.js')
	const ctx = { require: createRequire(file), exports: {}, uniCloud: { database: () => makeDb() }, console, process, Buffer }
	return vm.runInNewContext(fs.readFileSync(file, 'utf8') + `\n;({${symbols}})`, ctx)
}
const gas = internals('crm-gas-in', 'buildFillingGasMovementCandidate,buildSaleGasMovementCandidate,summarizeMovementDocs')
test('half kilograms and grams survive storage, signed deltas and batch accumulation', () => {
	assert.equal(kgToTon(65.5), 0.0655)
	assert.equal(kgToTon(0.001), 0.000001)
	assert.equal(kgToTon(-0.5), -0.0005)
	const fill = internals('crm-filling', 'buildFillingGasMovementPayload').buildFillingGasMovementPayload
	const sale = internals('crm-sale', 'buildSaleGasMovementPayload').buildSaleGasMovementPayload
	assert.equal(sale({ sourceId: 's', saleDoc: { date: '2026-09-29', out_items: [{ net: 65.5 }] }, bizMode: 'bottle' }).asset_delta_t, -0.0655)
	const docs = []
	for (let i = 0; i < 2000; i++) {
		const row = { _id: String(i), date: '2026-09-29', bottle_no: 'A', record_type: 'normal_fill', fill_weight: 65.5 }
		const written = fill({ sourceId: row._id, date: row.date, bottleNo: 'A', recordType: 'normal_fill', fillWeight: 65.5 })
		const rebuilt = gas.buildFillingGasMovementCandidate(row)
		assert.equal(written.station_delta_t, -0.0655)
		assert.equal(rebuilt.station_delta_t, written.station_delta_t)
		docs.push(rebuilt)
	}
	assert.equal(inventoryTon(docs.reduce((sum, row) => sum + row.station_delta_t, 0)), -131)
	assert.equal(gas.summarizeMovementDocs(docs).by_kind.filling_normal_fill.station_total_t, -131)
	assert.equal(gas.buildSaleGasMovementCandidate({ _id: 's', date: '2026-09-29', out_items: [{ net: 65.5 }] }).asset_delta_t, -0.0655)
})
function fixture(hooks = {}) {
	const source = { _id: 'f', date: '2026-09-28', record_type: 'normal_fill', bottle_no: 'A', fill_weight: 65.5, updated_at: 1 }
	const before = structuredClone({ ...gas.buildFillingGasMovementCandidate(source, true), _id: 'm' })
	const tables = { crm_users: [{ _id: 'u', token: 'test', role: 'superadmin' }], crm_fillings: [source], crm_gas_inventory_movements: [before] }
	const db = makeDb(tables, { mutate: true, transaction: true, ...hooks })
	const main = loadHandler('crm-gas-in', db)
	const call = data => invoke(main, 'repairInventoryPrecisionV1', { source_type: 'filling', ids: ['f'], ...data })
	return { tables, db, call }
}
test('preview, real rollback, commit and duplicate submission preserve original sources', async () => {
	const { tables, call, db } = fixture()
	const original = structuredClone(tables)
	const preview = await call({})
	assert.equal(preview.code, 0); assert.equal(preview.data.changed, 1); assert.equal(db.writes.length, 0)
	const request = { execute: true, confirm: 'REPAIR_INVENTORY_PRECISION', expected_preview_hash: preview.data.preview_hash }
	assert.equal((await call({ ...request, rollback_test: true })).data.rolled_back, true)
	assert.deepEqual(tables, original)
	assert.equal((await call(request)).data.applied, true)
	assert.equal(tables.crm_gas_inventory_movements[0].station_delta_t, -0.0655)
	assert.equal(tables.crm_operation_logs[0].detail.changes[0].before.station_delta_t, -0.066)
	assert.deepEqual(tables.crm_fillings, original.crm_fillings)
	assert.equal((await call(request)).data.already_applied, true)
	assert.equal(tables.crm_operation_logs.length, 1)
})
test('source edits invalidate previews; unrelated discrepancies and duplicate projections are rejected', async () => {
	const { tables, call } = fixture()
	const p = await call({}); tables.crm_fillings[0].updated_at++
	assert.equal((await call({ execute: true, confirm: 'REPAIR_INVENTORY_PRECISION', expected_preview_hash: p.data.preview_hash })).code, 500)
	tables.crm_gas_inventory_movements[0].station_delta_t = -0.07
	assert.equal((await call({})).code, 500)
	tables.crm_gas_inventory_movements.push({ ...tables.crm_gas_inventory_movements[0], _id: 'duplicate' })
	assert.equal((await call({})).code, 500)
	assert.equal(tables.crm_operation_logs, undefined)
})
test('transaction failure cannot partially repair inventory', async () => {
	const { tables, call } = fixture({ txWrite(op, name) { if (name === 'crm_operation_logs') throw Error('audit failure') } })
	const original = structuredClone(tables)
	const p = await call({})
	assert.equal((await call({ execute: true, confirm: 'REPAIR_INVENTORY_PRECISION', expected_preview_hash: p.data.preview_hash })).code, 500)
	assert.deepEqual(tables, original)
})
