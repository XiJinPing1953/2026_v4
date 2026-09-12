'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { buildPlan, digest, expectedAfter, CUSTOMER_ID } = require('../uniCloud-alipay/cloudfunctions/crm-k002-reconciliation/plan')
const { fixture, snapshot, evidence } = require('./lib/k002Fixture.cjs')
const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
const { loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const build = t => buildPlan(snapshot(t), evidence(t), { _id: 'sa', username: 'sa' }, 20)
function apply(t, plan) { const copy = structuredClone(t); for (const write of plan.writes) { const rows = copy[write.table]; const i = rows.findIndex(row => row._id === write.id); if (i < 0) rows.push(structuredClone(write.after)); else rows[i] = structuredClone(write.after) } return copy }
test('K002 fixed plan preserves three sales and produces the approved economic result', () => {
  const before = fixture(), plan = build(before), after = apply(before, plan)
  assert.equal(plan.run_id, build(before).run_id); assert.equal(plan.plan_hash, build(before).plan_hash)
  assert.equal(plan.summary.business_revenue, 9580); assert.equal(plan.summary.cash_received, 10570)
  assert.equal(plan.summary.refund_total, 990); assert.equal(plan.summary.net_cash_received, 9580)
  for (const sale of before.crm_sale_records) assert.deepEqual(after.crm_sale_records.find(row => row._id === sale._id), sale)
  assert.deepEqual(after.crm_customer_opening_debts.filter(row => row.status === 'posted').map(row => row.amount).sort((a,b)=>a-b), [270,900])
  assert.equal(after.crm_customer_receipts.find(row => row._id === 'offset-1260').allocated_amount, 270)
  assert.equal(after.crm_customer_receipts.find(row => row.source_type === 'offset_credit_cash_refund').amount, -990)
  assert.equal(after.crm_customer_allocations.filter(row => row.status === 'posted').reduce((sum,row)=>sum+row.allocate_amount,0), 10840)
  assert.equal(snapshot(after).snapshot_hash, expectedAfter(snapshot(before), plan))
})
test('customer, source version, duplicate refund and unexpected scope changes are rejected', () => {
  for (const mutate of [
    t => { t.crm_customers[0]._id = 'other' }, t => { t.crm_sale_records[0].unit_price = 9 },
    t => { t.crm_sale_records.push({ ...t.crm_sale_records[0], _id: 'new' }) },
    t => { t.crm_customer_receipts.push({ ...t.crm_customer_receipts[0], _id: 'refund', amount: -990, source_type: 'offset_credit_cash_refund' }) },
    t => { t.crm_customer_receipt_adjustments.push({ _id: 'pending', customer_id: CUSTOMER_ID, status: 'pending' }) }
  ]) { const t = fixture(); mutate(t); assert.throws(() => build(t)) }
})
test('protected handler requires rehearsal, rolls back interruption, detects drift and is idempotent', async () => {
  const t = fixture(), db = mutableDb(t), handler = loadHandler('crm-k002-reconciliation', db)
  const inspect = await invoke(handler, 'inspectV1', { customer_id: CUSTOMER_ID }); assert.equal(inspect.code, 0)
  const e = evidence(t), prepared = await invoke(handler, 'prepareV1', { customer_id: CUSTOMER_ID, expected_snapshot_hash: inspect.data.snapshot_hash, evidence: e })
  assert.equal(prepared.code, 0, prepared.msg); const args = { customer_id: CUSTOMER_ID, run_id: prepared.data.run_id, plan_hash: prepared.data.plan_hash }
  assert.equal((await invoke(handler, 'executeV1', args)).code, 409)
  const before = snapshot(t).snapshot_hash, rehearsal = await invoke(handler, 'rehearseV1', { ...args, fail_after_writes: 5 })
  assert.equal(rehearsal.code, 0, rehearsal.msg); assert.equal(rehearsal.data.snapshot_unchanged, true); assert.equal(snapshot(t).snapshot_hash, before)
  assert.equal((await invoke(handler, 'executeV1', args)).code, 409)
  assert.equal((await invoke(handler, 'rehearseV1', args)).code, 0)
  t.crm_sale_records[0].updated_at = 99; assert.equal((await invoke(handler, 'executeV1', args)).code, 409); t.crm_sale_records[0].updated_at = 1
  const done = await invoke(handler, 'executeV1', args); assert.equal(done.code, 0, done.msg); assert.equal(done.data.status, 'committed')
  const committed = digest(t), repeat = await invoke(handler, 'executeV1', args); assert.equal(repeat.data.idempotent, true); assert.equal(digest(t), committed)
  assert.equal((await invoke(handler, 'inspectV1', { customer_id: 'other' })).code, 400)
})
test('database failure and transaction-start conflict retain the full original snapshot', async () => {
  for (const mode of ['failure','conflict']) {
    const t = fixture(); let count = 0, armed = false
    const db = mutableDb(t, { txWrite: () => { if (mode === 'failure' && ++count === 4) throw Error('injected') },
      start: tables => { if (mode === 'conflict' && armed) tables.crm_customer_receipts[0].updated_at = 91 } })
    const handler = loadHandler('crm-k002-reconciliation', db), inspect = await invoke(handler, 'inspectV1', { customer_id: CUSTOMER_ID })
    const prepared = await invoke(handler, 'prepareV1', { customer_id: CUSTOMER_ID, expected_snapshot_hash: inspect.data.snapshot_hash, evidence: evidence(t) })
    armed = true; const result = await invoke(handler, 'rehearseV1', { customer_id: CUSTOMER_ID, run_id: prepared.data.run_id, plan_hash: prepared.data.plan_hash })
    assert.equal(result.code, 409); if (mode === 'conflict') t.crm_customer_receipts[0].updated_at = 1
    assert.equal(snapshot(t).snapshot_hash, inspect.data.snapshot_hash)
  }
})
test('real statement and both export handlers agree after conversion of embedded cash', async () => {
  const before = fixture(), after = apply(before, build(before));
  const handler = loadHandler('crm-customer-settlement', mutableDb(after));
  for (const action of ['getCustomerStatementV1', 'exportCustomerStatementV1', 'exportCustomerAccountingLedgerV1']) {
    const result = await invoke(handler, action, {customer_id:CUSTOMER_ID,date_from:'2026-01-01',date_to:'2026-09-12'});
    assert.equal(result.code,0,result.msg);
    const p=result.data.period_summary;
    assert.equal(p.complete,true,JSON.stringify(p.unresolved_sources));
    assert.equal(p.business_revenue,9580);assert.equal(p.cash_received,10570);assert.equal(p.refund_total,990);assert.equal(p.net_cash_received,9580);
    if(action==='getCustomerStatementV1') {assert.equal(result.data.summary.receivable_balance,0);assert.equal(result.data.summary.prepay_balance,0)}
    if(action==='exportCustomerStatementV1') assert.equal(result.data.closing_balance,0);
    if(action==='exportCustomerAccountingLedgerV1') assert.equal(result.data.closing.balance,0);
  }
});
