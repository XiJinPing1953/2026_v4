'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module')
// Reuse the transaction/fault fixture used by the mobile protocol, without executing its tests.
const fixturePath = path.join(__dirname, 'mobileSaleCreate.test.cjs')
const fixture = { require: createRequire(fixturePath), exports: {}, __dirname, process, structuredClone, console, Buffer, setTimeout, clearTimeout }
let fixtureCode = fs.readFileSync(fixturePath, 'utf8').split("test('server capability")[0]
fixtureCode = fixtureCode.replace("input:(operation='mobile-test-0001')", "drain:()=>context.exports.main({},{SOURCE:'timing'}), input:(operation='mobile-test-0001')")
vm.runInNewContext(fixtureCode + '\nexports.harness=harness;', fixture, { filename: fixturePath })
const make = hooks => fixture.exports.harness(hooks)
const input = (h, id = 'web-save-test-0001') => ({ operation_id: id, save_action: 'createV2', payload: { ...h.input().payload, ignore_bottle_flow_warning: true } })
const submit = (h, data = input(h)) => h.invoke('saveWebV1', data, 'admin')
const ops = h => h.tables.crm_web_sale_operations || []
const retryReady = h => { for (const row of ops(h)) { row.next_retry_at = 0; row.lease_until = 0 } }

test('real web handler atomically saves source/receipt, completes effects and repeats without any second write', async () => {
  const h = make(), r = await submit(h)
  assert.equal(r.code, 0, JSON.stringify(r)); assert.equal(r.data.source_saved, true)
  assert.equal(r.data.processing_state, 'complete', JSON.stringify(ops(h)))
  assert.equal(h.tables.crm_sale_records.length, 1); assert.equal(ops(h).length, 1)
  assert.equal(h.tables.crm_vouchers.length, 1); assert.equal(h.tables.crm_voucher_entries.length, 2)
  const snapshot = JSON.stringify(h.tables), writes = h.writes.length
  assert.equal((await submit(h)).data.sale_id, r.data.sale_id)
  assert.equal(JSON.stringify(h.tables), snapshot); assert.equal(h.writes.length, writes)
})
test('concurrent same-operation requests have one source, one durable receipt and one pipeline', async () => {
  const h = make(), results = await Promise.all([submit(h), submit(h)])
  assert.equal(h.tables.crm_sale_records.length, 1); assert.equal(ops(h).length, 1)
  assert.ok(results.every(r => r.code === 0 || r.data?.source_saved === null))
  assert.equal(h.calls.filter(r => r.data.action === 'enqueueEventV1').length, 1)
})
test('lost source commit acknowledgement is recovered by original operation, never source resubmission', async () => {
  let lost = false
  const h = make({ afterCommit: journal => { if (!lost && journal.some(x => x.name === 'crm_web_sale_operations')) { lost = true; throw Error('lost commit reply') } } })
  const r = await submit(h)
  assert.equal(r.code, 0); assert.equal(h.tables.crm_sale_records.length, 1)
  const calls = h.calls.length
  await submit(h); assert.equal(h.calls.length, calls)
  await h.drain(); assert.equal(ops(h)[0].status, 'complete'); assert.equal(h.tables.crm_sale_records.length, 1)
})
test('failure before commit rolls back both rows, same id safely retries', async () => {
  let fail = true
  const h = make({ txWrite: name => { if (name === 'crm_web_sale_operations' && fail) throw Error('write failed') } })
  const r = await submit(h); assert.equal(r.data.source_saved, null)
  assert.equal(h.tables.crm_sale_records.length, 0); assert.equal(ops(h).length, 0)
  fail = false; assert.equal((await submit(h)).code, 0); assert.equal(h.tables.crm_sale_records.length, 1)
})
test('voucher outage after source commit reports saved, resumes only unfinished steps, and retains historical rows', async () => {
  let fail = true
  const h = make({ read: name => { if (name === 'crm_vouchers' && fail) throw Error('not found collection') } })
  h.tables.crm_sale_records.push({ _id: 'historical', date: '2026-07-01', customer_id: 'unrelated', amount_received: 7 })
  const original = JSON.stringify(h.tables.crm_sale_records[0]), r = await submit(h)
  assert.equal(r.code, 0); assert.equal(r.data.source_saved, true); assert.match(r.data.warning, /凭证同步/)
  const movements = JSON.stringify(h.tables.crm_bottle_movements), calls = h.calls.length
  await submit(h); assert.equal(h.calls.length, calls)
  fail = false; retryReady(h); await h.drain()
  assert.equal(ops(h)[0].status, 'complete'); assert.equal(JSON.stringify(h.tables.crm_bottle_movements), movements)
  assert.equal(JSON.stringify(h.tables.crm_sale_records.find(x => x._id === 'historical')), original)
  assert.equal(h.tables.crm_vouchers.length, 1)
})
test('lost derived checkpoint repeats atomic replacement with stable IDs and balanced entries', async () => {
  let failed = false
  const h = make({ write: (name, patch) => { if (!failed && name === 'crm_web_sale_operations' && patch.completed_steps?.includes('voucher')) { failed = true; throw Error('checkpoint lost') } } })
  await submit(h)
  assert.equal(h.tables.crm_vouchers.length, 1)
  const ids = h.tables.crm_voucher_entries.map(x => x._id).sort()
  retryReady(h); await h.drain()
  assert.equal(ops(h)[0].status, 'complete'); assert.equal(h.tables.crm_vouchers.length, 1)
  assert.equal(JSON.stringify(h.tables.crm_voucher_entries.map(x => x._id).sort()), JSON.stringify(ids))
})
test('different payload under same ID, other actor and insufficient permissions cannot overwrite receipt', async () => {
  const h = make(), data = input(h); await submit(h, data)
  const before = JSON.stringify(h.tables)
  data.payload.base.unitPrice = 9
  assert.equal((await submit(h, data)).code, 409)
  assert.equal((await h.invoke('getWebSaveResultV1', { operation_id: data.operation_id }, 'operator')).code, 403)
  assert.equal((await h.invoke('saveWebV1', data, 'operator')).code, 403)
  // Denial audit records may be added; source and durable receipt remain unchanged.
  assert.equal(h.tables.crm_sale_records[0].unit_price, 5); assert.equal(ops(h).length, 1)
})
test('stale worker cannot apply effects after source version changes; missing/deleted source never recreates', async () => {
  let fail = true
  const h = make({ read: name => { if (name === 'crm_vouchers' && fail) throw Error('database timeout') } })
  await submit(h); fail = false
  h.tables.crm_sale_records[0].web_save_operation_key = 'newer-operation'
  const vouchers = JSON.stringify(h.tables.crm_vouchers || []); retryReady(h); await h.drain()
  assert.equal(ops(h)[0].status, 'pending'); assert.equal(JSON.stringify(h.tables.crm_vouchers || []), vouchers)
  h.tables.crm_sale_records = []; await submit(h)
  assert.equal(h.tables.crm_sale_records.length, 0)
})
test('new edit waits for pending original effects and source update gets its own atomic receipt', async () => {
  const h = make(); const r = await submit(h)
  const edit = input(h, 'web-save-update-0002'); edit.save_action = 'updateV2'; edit.payload = { recordId: r.data.sale_id, payload: edit.payload, ignore_bottle_flow_warning: true }
  edit.payload.payload.base.remark = 'explicit edit'
  ops(h)[0].status = 'pending'
  assert.equal((await submit(h, edit)).code, 409)
  ops(h)[0].status = 'complete'
  assert.equal((await submit(h, edit)).code, 0)
  assert.equal(h.tables.crm_sale_records.length, 1); assert.equal(ops(h).length, 2)
  const before = JSON.stringify(h.tables); await submit(h, edit); assert.equal(JSON.stringify(h.tables), before)
})
test('settlement repeat has one source revision and one receipt, without replaying collection or credit calls', async () => {
  const h = make(), created = await submit(h)
  const data = { operation_id: 'web-settlement-0001', save_action: 'updateSettlementV1', payload: {
    recordId: created.data.sale_id, settlement: { paymentStatus: 'partial', paymentMethod: 'cash', amountReceived: 10, roundingAmount: 0, applyOffsetCredit: false, offsetEnabled: false }
  } }
  const result = await submit(h, data)
  assert.equal(result.code, 0, JSON.stringify(result)); assert.equal(result.data.processing_state, 'complete')
  assert.equal(h.tables.crm_sale_records[0].amount_received, 10)
  const snapshot = JSON.stringify(h.tables), calls = h.calls.length
  await submit(h, data)
  assert.equal(JSON.stringify(h.tables), snapshot); assert.equal(h.calls.length, calls)
  assert.equal(h.tables.crm_vouchers.length, 1)
  const logs = h.tables.crm_operation_logs.filter(x => x.action === 'sale_update_settlement_v1')
  assert.equal(logs.length, 1)
})
test('slow successful regulatory enqueue is awaited, not classified as a 1200ms failure', async () => {
  const h = make({ cloud: async request => {
    if (request.data.action === 'enqueueEventV1') await new Promise(resolve => setTimeout(resolve, 1300))
    return { result: { code: 0, data: { job_id: 'test', done: true, status: 'completed', applied_amount: 0, unresolved_count: 0 } } }
  } })
  const result = await submit(h)
  assert.equal(result.code, 0); assert.equal(result.data.processing_state, 'complete'); assert.equal(result.data.warning, '')
  assert.equal(h.calls.filter(x => x.data.action === 'enqueueEventV1').length, 1)
})
test('empty recovery queue does not scan or change historical source or accounting tables', async () => {
  const reads = [], h = make({ read: name => reads.push(name) })
  h.tables.crm_sale_records.push({ _id: 'historical', amount_received: 17 })
  h.tables.crm_vouchers = [{ _id: 'historical-voucher', status: 'posted' }]
  const snapshot = JSON.stringify(h.tables)
  await h.drain()
  assert.equal(JSON.stringify(h.tables), snapshot); assert.equal(h.writes.length, 0)
  assert.deepEqual([...new Set(reads)], ['crm_web_sale_operations'])
})
