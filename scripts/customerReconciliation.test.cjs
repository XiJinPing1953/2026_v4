'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { buildPlan, digest } = require('../uniCloud-alipay/cloudfunctions/crm-ledger-reconciliation/plan')
function fixture() {
  const sale = { _id: 'sale', customer_id: 'c', date: '2026-01-02', price_unit: 'm3', unit_price: 1,
    flow_index_prev: 9, flow_index_curr: 2, flow_volume_m3: 1, amount_received: 1,
    out_items: [{ bottle_no: 'KEEP', net: 100 }], back_items: [{ bottle_no: 'RETURN', net: 20 }] }
  const snapshot = { complete: true, tables: {
    crm_customers: [{ _id: 'c', name: 'Fixture', is_active: false }], crm_sale_records: [sale],
    crm_customer_receipts: [{ _id: 'old', amount: 1 }], crm_customer_allocations: [{ _id: 'old-a', receipt_id: 'old', allocate_amount: 1 }],
    crm_customer_flow_settlements: [], crm_customer_opening_debts: [], crm_vouchers: [] } }
  const evidence = { customer_id: 'c', confirmed_by_user: true, proof_sha256: ['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)],
    expected_sale_count: 1, expected_legacy_count: 1, unit_price: 1, superseded_receipt_id: 'old', full_meter_amount: '2',
    meter_corrections: [{ sale_id: 'sale', expected_source_hash: digest(sale), flow_index_prev: 1 }],
    opening: { start_date: '2025-12-01', end_date: '2025-12-31', reading_start: 0, reading_end: 1, exact_amount: '1' },
    intervals: [{ start_date: '2025-12-31', end_date: '2026-01-02', reading_start: 1, reading_end: 2 }],
    receipts: [{ date: '2026-01-03', amount: 1, method: 'bank', voucher: 'test-1', allocations: [{ target: 'opening', amount: 1 }] },
      { date: '2026-02-03', amount: .5, method: 'unknown', voucher: 'test-2', allocations: [{ target: 'flow-0', amount: .5 }] },
      { date: '2026-03-03', amount: .52, method: 'bank', voucher: 'test-3', allocations: [{ target: 'flow-0', amount: .5 }, { target: 'tail', amount: .02 }] }] }
  return { snapshot, evidence }
}
const build = ({ snapshot, evidence }) => buildPlan(snapshot, evidence, { _id: 'admin', username: 'Fixture' }, 1)
test('reconciliation keeps delivery facts and cancels duplicate money with recoverable before-images', () => {
  const input = fixture(); const original = structuredClone(input)
  const plan = build(input)
  assert.deepEqual(input, original)
  assert.equal(plan.summary.receipts_total, 2.02)
  assert.equal(plan.summary.tail_adjustment, .02)
  assert.equal(plan.summary.ending_balance, 0)
  const sale = plan.writes.find(w => w.table === 'crm_sale_records')
  assert.equal(sale.after.settlement_mode, 'customer_flow')
  assert.equal(sale.after.amount_received, 0)
  assert.deepEqual(sale.after.out_items, sale.before.out_items)
  assert.deepEqual(sale.after.back_items, sale.before.back_items)
  assert.equal(sale.after.date, sale.before.date)
  assert.equal(plan.writes.find(w => w.id === 'old').after.status, 'void')
  assert.equal(plan.writes.find(w => w.id === 'old-a').after.allocate_amount, 0)
  assert.equal(build(input).plan_hash, plan.plan_hash)
})
test('changed sources, overlapping bills, unallocated cash and excessive adjustments fail before writes', () => {
  for (const mutate of [
    x => { x.snapshot.complete = false },
    x => { x.evidence.meter_corrections[0].expected_source_hash = 'changed' },
    x => { x.snapshot.tables.crm_customer_flow_settlements.push({ _id: 'covered' }) },
    x => { x.evidence.receipts[2].allocations[1].amount = .01 },
    x => { x.evidence.receipts[2].amount = .7 },
    x => { x.evidence.intervals[0].reading_end = 3 }
  ]) { const input = fixture(); mutate(input); assert.throws(() => build(input)) }
})
