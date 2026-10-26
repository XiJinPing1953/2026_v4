'use strict'
// Independent Python replay: raw fixtures and literal expectations, never the
// production amount helper. Integration with the real handler is a separate test.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const script = path.resolve(__dirname, 'verifyOperatingBriefEvidence.py')
const names = ['crm_customers', 'crm_sale_records', 'crm_customer_flow_settlements', 'crm_customer_receipts',
  'crm_customer_allocations', 'crm_cashier_intakes', 'crm_customer_opening_debts', 'crm_fillings']
const dated = { customer_id: 'c1', status: 'posted', biz_date: '2026-10-25' }
function sourceFixture() {
  const sale = (id, net, date = '2026-10-25', extra = {}) => ({ _id: id, customer_id: 'c1', status: 'posted', date,
    biz_mode: 'bottle', settlement_mode: 'sale', price_unit: 'kg', unit_price: 1,
    out_items: [{ net: Math.max(0, net) }], back_items: [{ net: Math.max(0, -net) }], amount_received: 0, ...extra })
  const collections = Object.fromEntries(names.map(name => [name, []]))
  collections.crm_customers = [{ _id: 'c1', name: 'Source customer', default_price_unit: 'kg' }, { _id: 'hidden', is_hidden: true }]
  collections.crm_sale_records = [sale('sold', 100, '2026-10-25', { amount_received: 40, receipt_rounding_amount: 5, rounding_amount: 2 }),
    sale('offset-paid', 10, '2026-10-25', { amount_received: 10 }), sale('return', -20), sale('previous', 80, '2026-10-24'),
    sale('void', 999, '2026-10-25', { status: 'void' }), sale('hidden-sale', 999, '2026-10-25', { customer_id: 'hidden' })]
  collections.crm_customer_flow_settlements = [{ ...dated, _id: 'flow', flow_index_prev: 100, flow_index_curr: 112.345,
    flow_volume_m3: 12.345, unit_price: 1, should_receive: 12.345, amount_received: 0 }]
  collections.crm_customer_receipts = [
    { ...dated, _id: 'cash', amount: 60, allocated_amount: 40, rounding_allocated_amount: 5, unallocated_amount: 15,
      cash_refunded_amount: 5, source_type: 'cashier_intake', source_id: 'intake', intake_id: 'intake', purpose: 'settlement', payment_method: 'bank' },
    { ...dated, _id: 'refund', amount: -5, source_type: 'customer_cash_refund', refund_source_status: 'linked', refund_sources: [{ id: 'cash', amount: 5 }] },
    { ...dated, _id: 'offset', amount: 10, allocated_amount: 10, unallocated_amount: 0, source_type: 'sale_offset_credit' }
  ]
  collections.crm_customer_allocations = [
    { ...dated, _id: 'cash-allocation', receipt_id: 'cash', target_id: 'sold', target_type: 'sale', allocate_amount: 40 },
    { ...dated, _id: 'rounding-allocation', receipt_id: 'cash', target_id: 'sold', target_type: 'sale', allocate_kind: 'rounding', allocate_amount: 5 },
    { ...dated, _id: 'offset-allocation', receipt_id: 'offset', target_id: 'offset-paid', target_type: 'sale', allocate_amount: 10 }
  ]
  collections.crm_cashier_intakes = [{ ...dated, _id: 'intake', amount: 65, gas_amount: 60, deposit_amount: 5,
    receipt_id: 'cash', purpose: 'settlement', payment_method: 'bank' }]
  collections.crm_fillings = [
    { _id: 'f1', date: '2026-10-25', bottle_no: 'A001', fill_weight: 12.345 },
    { _id: 'f2', date: '2026-10-25', bottle_no: '000', fill_weight: 20 },
    { _id: 'f3', date: '2026-10-25', bottle_no: 'TRUCK', record_type: 'truck_out_no_sale', fill_weight: 30 },
    { _id: 'f4', date: '2026-10-25', bottle_no: 'TRUCK-2', fill_weight: 40 }
  ]
  return { schema: 'operating-brief-evidence/1', rule_version: 'sale-accounting/2026-09-08.1', period: 'yesterday',
    range: { start: '2026-10-25', end: '2026-10-25', today: '2026-10-26' }, read_started_at: 1000, read_completed_at: 1100,
    collections, collection_metadata: Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, { read_complete: true, expected_count: rows.length }])),
    expected: {
      business: { net: 102.345, sales: 90, flow: 12.345, positive: 122.345, negative: 20,
        positive_settlement: { principal: 122.345, allocated: 50, sale_rounding: 2, receipt_rounding: 5, rounding: 7, outstanding: 65.345 } },
      operations: { sale_weight_kg: 90, sale_bottle_count: 3, customer_count: 1 }, cash: { received: 60, refund: 5, net: 55,
        destinations: { same_period: 40, prior_period: 0, future_period: 0, other: 0, refunded_after_or_current: 5,
          remaining_prepay: 0, remaining_settlement: 15, remaining_unknown: 0, total: 60 } },
      analysis: { comparison: { current_range: { start: '2026-10-25', end: '2026-10-25' }, baseline_range: { start: '2026-10-24', end: '2026-10-24' },
        metrics: { sale_weight_kg: { current: 90, baseline: 80, delta: 10, rate: 0.125 }, business_net: { current: 102.345, baseline: 80, delta: 22.345, rate: 0.2793125 } } },
        drivers: { items: [{ customer_id: 'c1', current: 102.345, baseline: 80, delta: 22.345 }], total_delta: 22.345, other_delta: 0 } },
      outflow: { weight_kg: 102.345, channels: [{ key: 'bottle', weight_kg: 12.345, count: 1 }, { key: 'local', weight_kg: 20, count: 1 },
        { key: 'vehicle', weight_kg: 30, count: 1 }, { key: 'other', weight_kg: 40, count: 1 }] }
    } }
}
function call(bundle, seal = false) {
  const result = spawnSync('python3', [script, ...(seal ? ['--seal'] : []), '-'], { input: JSON.stringify(bundle), encoding: 'utf8' })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null, result.stderr)
  assert.ok(result.stdout, result.stderr)
  return { status: result.status, report: JSON.parse(result.stdout) }
}
function verify(bundle) { return call(call(bundle, true).report) }

test('Decimal replay closes raw money, signed quantities, allocations, cashier and four gas channels', () => {
  const { status, report } = verify(sourceFixture())
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.complete, true)
  assert.equal(report.coverage.checks.flow_pricing, 2)
  assert.equal(report.coverage.checks.allocation_relations, 3)
  assert.equal(report.coverage.excluded['sales.void'], 1)
  assert.equal(report.coverage.excluded['sales.hidden'], 1)
  assert.equal(report.computed.analysis.trend.points.length, 7)
  assert.equal(report.computed.analysis.trend.points[0].value, '0')
  assert.equal(report.computed.analysis.trend.points[6].value, '90.00')
})

test('a changed displayed total cannot become the verifier input', () => {
  const bundle = sourceFixture()
  bundle.expected.business.net = 100000
  const { status, report } = verify(bundle)
  assert.equal(status, 1)
  assert.equal(report.complete, false)
  assert.equal(report.computed.business.net, '102.345')
  assert.ok(report.differences.some(row => row.path === 'business.net'))
})

test('tampered source bytes, missing query counts and duplicate IDs cannot pass', () => {
  const bundle = call(sourceFixture(), true).report
  bundle.collections.crm_sale_records[0].unit_price = 3
  let report = call(bundle).report
  assert.ok(report.differences.some(row => row.path === 'manifest.crm_sale_records.sha256'))
  const missing = sourceFixture()
  delete missing.collection_metadata.crm_sale_records
  report = verify(missing).report
  assert.equal(report.complete, false)
  assert.ok(report.unsupported.some(row => row.code === 'collection_read_not_proven'))
  const duplicate = sourceFixture()
  duplicate.collections.crm_fillings.push({ ...duplicate.collections.crm_fillings[0] })
  report = verify(duplicate).report
  assert.ok(report.unsupported.some(row => row.code === 'duplicate_or_missing_source_id'))
})

test('unrecognized source, missing unit price and legacy embedded money stay unverified', () => {
  for (const edit of [
    bundle => { bundle.collections.crm_customer_receipts[0].source_type = 'new_unreviewed_kind' },
    bundle => { delete bundle.collections.crm_sale_records[0].unit_price },
    bundle => { bundle.collections.crm_sale_records[3].amount_received = 1 },
    bundle => { delete bundle.collections.crm_customer_flow_settlements[0].flow_index_prev }
  ]) {
    const bundle = sourceFixture()
    edit(bundle)
    const { status, report } = verify(bundle)
    assert.equal(status, 1)
    assert.equal(report.complete, false)
    assert.ok(report.unsupported.length > 0)
  }
})

test('allocation cross-customer and altered cashier split fail independently', () => {
  const bundle = sourceFixture()
  bundle.collections.crm_customers.push({ _id: 'c2' })
  bundle.collection_metadata.crm_customers.expected_count++
  bundle.collections.crm_customer_allocations[0].customer_id = 'c2'
  bundle.collections.crm_cashier_intakes[0].deposit_amount = 6
  const { report } = verify(bundle)
  assert.equal(report.complete, false)
  assert.ok(report.unsupported.some(row => row.code === 'cross_customer_allocation'))
  assert.ok(report.differences.some(row => row.path === 'intake.intake.amount'))
})

test('malformed gas times and contradictory receipt references remain explicit unsupported evidence', () => {
  for (const [edit, code] of [
    [bundle => { bundle.collections.crm_fillings[0].filling_time = '2026-10-25-25' }, 'invalid_gas_business_time'],
    [bundle => { bundle.collections.crm_customer_allocations[0].receipt_source_type = 'sale' }, 'allocation_receipt_source_conflict'],
    [bundle => { bundle.collections.crm_customer_receipts[0].offset_cash_refunded_amount = 1 }, 'receipt_refund_kind_mismatch'],
    [bundle => { bundle.collections.crm_customer_flow_settlements[0].rounding_amount = 1 }, 'flow_has_unsupported_source_rounding']
  ]) {
    const bundle = sourceFixture()
    edit(bundle)
    const { report } = verify(bundle)
    assert.equal(report.complete, false)
    assert.ok(report.unsupported.some(row => row.code === code), JSON.stringify(report))
  }
})

test('zero or negative baseline produces no percentage, today has no full-day comparison', () => {
  for (const net of [0, -80]) {
    const bundle = sourceFixture()
    bundle.collections.crm_sale_records[3].out_items = [{ net: Math.max(0, net) }]
    bundle.collections.crm_sale_records[3].back_items = [{ net: Math.max(0, -net) }]
    bundle.expected = { analysis: { comparison: { metrics: { sale_weight_kg: { baseline: net, delta: 90 - net, rate: null } } } } }
    assert.equal(verify(bundle).report.complete, true)
  }
  const bundle = sourceFixture()
  bundle.period = 'today'
  bundle.expected = { analysis: { comparison: { current_range: null, baseline_range: null, metrics: {} } } }
  assert.equal(verify(bundle).report.complete, true)
})

test('month uses common completed days across February and handles first day', () => {
  for (const [today, currentEnd, baselineEnd] of [['2026-03-31', '2026-03-28', '2026-02-28'], ['2028-03-31', '2028-03-29', '2028-02-29']]) {
    const bundle = sourceFixture()
    bundle.period = 'month'
    bundle.range = { start: today.slice(0, 7) + '-01', end: today, today }
    bundle.expected = { analysis: { comparison: { current_range: { start: today.slice(0, 7) + '-01', end: currentEnd },
      baseline_range: { start: baselineEnd.slice(0, 7) + '-01', end: baselineEnd } } } }
    assert.equal(verify(bundle).report.complete, true)
  }
  const bundle = sourceFixture()
  bundle.period = 'month'
  bundle.range = { start: '2026-11-01', end: '2026-11-01', today: '2026-11-01' }
  bundle.expected = { analysis: { comparison: { current_range: null, baseline_range: null } } }
  assert.equal(verify(bundle).report.complete, true)
})

test('unknown result sections and empty expected claims never receive a blanket pass', () => {
  const bundle = sourceFixture()
  bundle.expected = { current: { receivable: 0 } }
  assert.equal(verify(bundle).report.complete, false)
  bundle.expected = { analysis: { version: 'anything' } }
  assert.equal(verify(bundle).report.complete, false)
})

test('independent Decimal replay agrees with the real reader and its deployed helpers on raw analysis fixture', async () => {
  const { evidencePackage } = require('./fixtures/operatingBriefAnalysis.runner.cjs')
  const bundle = await evidencePackage()
  const { status, report } = verify(bundle)
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.complete, true)
  assert.equal(report.computed.analysis.drivers.total_delta, '0.00')
  assert.deepEqual(report.computed.analysis.drivers.items.map(row => row.delta), ['-110.00', '80.00', '60.00'])
  assert.ok(report.coverage.expected_paths.includes('cash.destinations.total'))
  assert.ok(report.coverage.expected_paths.includes('analysis.trend.points[6].value'))
})

module.exports = { sourceFixture, call, verify }
