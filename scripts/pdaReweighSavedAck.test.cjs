'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApp } = require('./lib/fillingHarness.cjs')
const { bottleKey } = require('../uniCloud-alipay/cloudfunctions/crm-filling/returnReweighRules')
const rows = (app, name) => [...app.db.data(name).values()]
const source = app => rows(app, 'crm_fillings')[0]
const copy = value => JSON.parse(JSON.stringify(value))
const timer = app => app.invoke(undefined, {}, '', { SOURCE: 'timing' })
const successRegulatory = { code: 0, data: {
 total_event_payload: 1, enqueued_total: 1, duplicate_total: 0, missing_bottle_total: 0,
 snapshot: { found_total: 1, enqueued_total: 1, duplicate_total: 0, missing_total: 0 }
} }

function fixture(options = {}) {
 const calls = { regulatory: 0, anomaly: 0 }
 let app
 app = makeApp({ ...options,
  regulatory: async () => { calls.regulatory++; app.advance(options.regulatoryMs || 0); return successRegulatory },
  scan: async () => { calls.anomaly++; app.advance(options.anomalyMs || 0); return { code: 0, data: { done: true } } }
 })
 Object.assign(app.db.data('crm_bottles').get('b1'), { tare_weight: 100 })
 app.db.data('crm_sale_records').set('return1', { _id: 'return1', date: '2026-09-05', biz_mode: 'bottle',
  back_items: [{ bottle_no: 'B1', gross: 120, tare: 100, net: 20 }], out_items: [], updated_at: 1 })
 app.db.data('crm_return_reweighs').set('measured_return1', { _id: 'measured_return1', bottle_id: 'b1', bottle_no: 'B1',
  round_id: 'return_round_001', date: '2026-09-05 08:00:00', created_at: app.now() - 86400000,
  gross_weight: 120, tare_weight: 100, net_weight: 20, outgoing_facts: [], manual_facts: [], baseline_filling_ids: [] })
 app.db.data('crm_return_reweigh_state').set(bottleKey('B1'), { _id: bottleKey('B1'), kind: 'bottle', bottle_no: 'B1',
  record_id: 'measured_return1', consumed_filling_id: '' })
 return Object.assign(app, { calls })
}

async function request(app, operation_id, extra = {}) {
 const query = { bottle_no: 'B1', date: '2026-09-06-08', gross_weight: 170, ...extra }
 const preview = await app.invoke('previewReweighV1', query)
 assert.equal(preview.code, 0, preview.msg)
 return { ...query, operation_id, context_hash: preview.data.context_hash, capture_method: 'ble', return_after_save: true,
  capture: { sampled_at: app.now(), device_id: 'NVK1', stable_seq: 1, measurement_id: `${operation_id}_m1`, stable: true, raw: 'ST,NT,+170.0kg' }, ...extra }
}
function assertOneContribution(app, weight = 50) {
 assert.equal(rows(app, 'crm_fillings').length, 1)
 const fill = rows(app, 'crm_bottle_movements').filter(row => row.type === 'fill')
 const gas = rows(app, 'crm_gas_inventory_movements').filter(row => row.source_type === 'filling')
 assert.equal(fill.length, 1); assert.equal(gas.length, 1)
 assert.equal(source(app).fill_weight, weight)
 assert.equal(fill[0].net_weight, weight)
 assert.equal(gas[0].station_delta_t, -weight / 1000)
 assert.equal(gas[0].in_bottle_delta_t, weight / 1000)
}

// These dispatch the production handler. Only the database and cloud transport are fixtures.
test('PDA fast acknowledgement follows atomic source commit and durable saved checkpoint; timer resumes with no PDA request', async () => {
 const app = fixture(), payload = await request(app, 'pda_saved_ack_create_001')
 let checkedCheckpoint = false, projectionCalls = 0
 app.db.setFault(async (name, action, patch) => {
  if (name === 'crm_bottle_scan_locks') projectionCalls++
  if (name === 'crm_filling_operations' && action === 'update' && patch.saved_cursor === 1) {
   assertOneContribution(app)
   checkedCheckpoint = true
  }
 })
 const response = await app.invoke('createReweighV1', payload)
 assert.equal(response.code, 0, response.msg)
 assert.equal(response.data.saved_total, 1)
 assert.equal(response.data.pending_save_total, 0)
 assert.equal(response.data.complete, false)
 assert.equal(checkedCheckpoint, true)
 assert.deepEqual(app.calls, { regulatory: 0, anomaly: 0 })
 assert.equal(projectionCalls, 0)
 const op = app.operation(payload.operation_id)
 assert.equal(op.status, 'pending'); assert.equal(op.saved_cursor, 1); assert.equal(op.row_cursor, 0)
 assert.equal(op.lease_id, ''); assert.equal(op.lease_until, 0)
 assert.equal(source(app).consistency_status, 'pending')
 const processed = await timer(app)
 assert.equal(processed.code, 0)
 assert.equal(app.operation(payload.operation_id).status, 'complete')
 assert.deepEqual(app.calls, { regulatory: 1, anomaly: 1 })
 assert.equal(source(app).consistency_status, 'complete')
 assertOneContribution(app)
})

test('legacy reweigh clients and ordinary filling operations retain synchronous processing', async () => {
 const app = fixture(), payload = await request(app, 'pda_saved_ack_legacy_001')
 delete payload.return_after_save
 assert.equal((await app.invoke('createReweighV1', payload)).data.complete, true)
 assert.deepEqual(app.calls, { regulatory: 1, anomaly: 1 })
 const batch = fixture()
 const result = await batch.invoke('batchCreateV1', { operation_id: 'pda_saved_ack_batch_001', return_after_save: true,
  date: '2026-09-06', record_type: 'normal_fill', input_mode: 'net', operator: 'tester', batch_text: 'B2 10' })
 assert.equal(result.data.complete, true, result.data.last_error)
 assert.equal(batch.calls.anomaly, 1)
})

test('fast acknowledgement cannot report saved after source transaction rollback; timer recovers exact original intent', async () => {
 const app = fixture(), payload = await request(app, 'pda_saved_ack_rollback_001')
 let fail = true
 app.db.setFault(async (name, action) => {
  if (name === 'crm_fillings' && action === 'add' && fail) { fail = false; throw new Error('source unavailable') }
 })
 const first = await app.invoke('createReweighV1', payload)
 assert.equal(first.data.saved_total, 0)
 assert.equal(first.data.complete, false)
 for (const name of ['crm_fillings', 'crm_bottle_movements', 'crm_gas_inventory_movements']) assert.equal(rows(app, name).length, 0, name)
 assert.equal(app.db.data('crm_return_reweigh_state').get(bottleKey('B1')).consumed_filling_id, '')
 app.advance(61000)
 await timer(app)
 assert.equal(app.operation(payload.operation_id).status, 'complete')
 assertOneContribution(app)
})

for (const location of ['commit', 'saved_checkpoint']) test(`lost ${location} acknowledgement recovers by original operation ID without duplicate source or quantities`, async () => {
 let injected = false
 const app = fixture({ configureDatabase(db) {
  if (location !== 'commit') return
  const start = db.startTransaction.bind(db)
  db.startTransaction = async () => {
   const tx = await start(), commit = tx.commit.bind(tx)
   tx.commit = async () => { await commit(); if (!injected) { injected = true; throw new Error('commit acknowledgement lost') } }
   return tx
  }
 } })
 const payload = await request(app, `pda_saved_ack_lost_${location}`)
 if (location === 'saved_checkpoint') app.db.setFault(async (name, action, patch) => {
  if (name === 'crm_filling_operations' && action === 'update' && patch.saved_cursor === 1 && !injected) {
   injected = true; throw new Error('saved checkpoint acknowledgement lost')
  }
 })
 const first = await app.invoke('createReweighV1', payload)
 assert.equal(injected, true)
 assert.equal(first.data.complete, false)
 assert.equal(first.data.saved_total, 0)
 assertOneContribution(app)
 const status = await app.invoke('getOperationV1', { operation_id: payload.operation_id })
 assert.equal(status.data.source_records[0].saved, true)
 assert.equal(status.data.source_records[0].version_matches, true)
 assert.equal((await app.invoke('createReweighV1', copy(payload))).code, 0)
 assertOneContribution(app)
 app.advance(61000)
 await timer(app)
 assert.equal(app.operation(payload.operation_id).status, 'complete')
 assertOneContribution(app)
})

test('lost response and parallel retry keep the frozen acknowledgement flag and cannot create a second contribution', async () => {
 const app = fixture(), payload = await request(app, 'pda_saved_ack_duplicate_001')
 await app.invoke('createReweighV1', payload) // Simulate a successful response not received by the PDA.
 const results = await Promise.all([app.invoke('createReweighV1', copy(payload)), app.invoke('createReweighV1', copy(payload))])
 assert.ok(results.every(result => result.code === 0 && result.data.saved_total === 1))
 assertOneContribution(app)
 const changed = copy(payload); delete changed.return_after_save
 assert.equal((await app.invoke('createReweighV1', changed)).code, 409, 'frozen payload is not silently upgraded or downgraded')
 assert.deepEqual(app.calls, { regulatory: 0, anomaly: 0 })
 await timer(app)
 assertOneContribution(app)
})

test('changed return basis before fast submission is rejected without durable source or operation', async () => {
 const app = fixture(), payload = await request(app, 'pda_saved_ack_basis_conflict')
 app.db.data('crm_return_reweighs').get('measured_return1').gross_weight = 121
 assert.equal((await app.invoke('createReweighV1', payload)).code, 409)
 for (const name of ['crm_fillings', 'crm_bottle_movements', 'crm_gas_inventory_movements', 'crm_filling_operations']) assert.equal(rows(app, name).length, 0, name)
})

for (const change of ['new_version', 'deleted']) test(`saved operation timer preserves a ${change} source instead of replaying old facts`, async () => {
 const app = fixture(), payload = await request(app, `pda_saved_ack_conflict_${change}`)
 assert.equal((await app.invoke('createReweighV1', payload)).data.saved_total, 1)
 const original = copy(source(app))
 if (change === 'deleted') app.db.data('crm_fillings').delete(original._id)
 else Object.assign(source(app), { source_version: 2, updated_at: original.updated_at + 1, fill_weight: 99 })
 await timer(app)
 assert.equal(app.operation(payload.operation_id).status, 'failed')
 assert.match(app.operation(payload.operation_id).last_error, /变更|删除|版本/)
 assert.deepEqual(app.calls, { regulatory: 0, anomaly: 0 })
 if (change === 'deleted') assert.equal(rows(app, 'crm_fillings').length, 0)
 else assert.equal(source(app).fill_weight, 99)
 assert.equal(rows(app, 'crm_bottle_movements').filter(row => row.type === 'fill')[0].net_weight, 50)
 assert.equal(rows(app, 'crm_gas_inventory_movements').filter(row => row.source_type === 'filling')[0].in_bottle_delta_t, 0.05)
})

test('correction remains protected until source processing completes, then commits one replacement and preserves original filling time', async () => {
 const app = fixture(), first = await request(app, 'pda_saved_ack_before_correction')
 await app.invoke('createReweighV1', first)
 const pending = await app.invoke('previewReweighV1', { bottle_no: 'B1', gross_weight: 175, date: '2026-09-06-08' })
 assert.equal(pending.code, 409)
 await timer(app)
 const original = copy(source(app))
 const correction = await request(app, 'pda_saved_ack_correct_001', { filling_id: original._id,
  expected_source_version: original.source_version, gross_weight: 175, reason: '重新挂瓶确认重量' })
 const competing = { ...copy(correction), operation_id: 'pda_saved_ack_correct_002' }
 const result = await app.invoke('correctReweighV1', correction)
 assert.equal(result.data.saved_total, 1); assert.equal(result.data.complete, false)
 assertOneContribution(app, 55)
 assert.equal(source(app).filling_time, original.filling_time)
 assert.equal(source(app).source_version, 2)
 assert.equal((await app.invoke('correctReweighV1', competing)).code, 409)
 assert.equal((await app.invoke('retryOperationV1', { operation_id: first.operation_id })).data.complete, true)
 assertOneContribution(app, 55)
 await timer(app)
 assert.equal(app.operation(correction.operation_id).status, 'complete')
 assertOneContribution(app, 55)
})

test('deterministic downstream service delay leaves PDA save response path and runs in timer instead', async () => {
 const timings = []
 for (const fast of [false, true]) {
  const app = fixture({ regulatoryMs: 1500, anomalyMs: 800 })
  const payload = await request(app, `pda_saved_ack_timing_${fast ? 'fast' : 'legacy'}`)
  if (!fast) delete payload.return_after_save
  const started = app.now()
  const result = await app.invoke('createReweighV1', payload)
  assert.equal(result.data.saved_total, 1)
  timings.push({ simulated_downstream_wait_ms: app.now() - started, downstream_calls: app.calls.regulatory + app.calls.anomaly })
  await timer(app)
  assert.equal(app.operation(payload.operation_id).status, 'complete')
  assert.equal(app.calls.regulatory + app.calls.anomaly, 2)
 }
 assert.deepEqual(timings, [
  { simulated_downstream_wait_ms: 2300, downstream_calls: 2 },
  { simulated_downstream_wait_ms: 0, downstream_calls: 0 }
 ])
 // Synthetic clock proves path separation only, not network/database/device latency.
})
