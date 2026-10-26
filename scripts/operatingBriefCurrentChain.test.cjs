'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb } = require('./lib/accountingTestHarness.cjs')
const { readCurrentBrief } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/currentBrief')
const customer = id => ({ _id: id, name: id, default_price_unit: 'kg' })
const sale = (extra = {}) => ({ _id: 's-a', customer_id: 'a', date: '2026-10-23', settlement_mode: 'sale',
  biz_mode: 'bottle', price_unit: 'kg', unit_price: 10, out_items: [{ net: 10 }], back_items: [],
  amount_received: 20, receipt_rounding_amount: 2, created_at: 1, updated_at: 1, ...extra })
const receipt = (extra = {}) => ({ _id: 'r-a', customer_id: 'a', source_type: 'customer_prepay_manual',
  amount: 80, allocated_amount: 20, unallocated_amount: 60, rounding_allocated_amount: 2,
  status: 'posted', created_at: 1, updated_at: 1, ...extra })
const allocation = (extra = {}) => ({ _id: 'a-a', customer_id: 'a', receipt_id: 'r-a', target_type: 'sale',
  target_id: 's-a', sale_id: 's-a', allocate_kind: 'receipt', allocate_amount: 20, created_at: 1, updated_at: 1, ...extra })
const fixture = (extra = {}) => ({ crm_customers: [customer('a'), customer('b')],
  crm_sale_records: [sale(), sale({ _id: 's-b', customer_id: 'b', amount_received: 0, receipt_rounding_amount: 0 })],
  crm_customer_flow_settlements: [], crm_customer_opening_debts: [], crm_cashier_intakes: [],
  crm_customer_receipts: [receipt(), receipt({ _id: 'r-b', customer_id: 'b', amount: 5, allocated_amount: 0, unallocated_amount: 5, rounding_allocated_amount: 0 })],
  crm_customer_allocations: [allocation(), allocation({ _id: 'a-round', allocate_kind: 'rounding', allocate_amount: 2 })], ...extra })

test('missing allocation source and cross-customer references preserve a precise reason through pending without claiming read failure', async () => {
  for (const [mutate, field, message] of [
    [t => { t.crm_sale_records = t.crm_sale_records.filter(row => row._id !== 's-a') }, 'target_id', /引用的账单未在核算范围内找到/],
    [t => { t.crm_customer_receipts = t.crm_customer_receipts.filter(row => row._id !== 'r-a') }, 'receipt_id', /引用的收款未在核算范围内找到/],
    [t => { t.crm_customer_allocations[0].customer_id = 'b' }, 'customer_id', /客户归属不一致/]
  ]) {
    const tables = fixture(); mutate(tables)
    const db = makeDb(tables), result = await readCurrentBrief(db)
    assert.equal(result.read_complete, true)
    const cause = result.current.debt.issues[0]
    assert.equal(cause.field, field); assert.match(cause.message, message)
    assert.equal(result.pending.issues[0].message, cause.message)
    assert.doesNotMatch(result.pending.issues[0].message, /读取未完成|期间发生变化|本次未返回/)
    assert.equal(result.current.receivable, null); assert.deepEqual(db.writes, [])
  }
})
const reason = (domain, name) => assert.ok(domain.issues.some(row => row.reason === name), `missing ${name}`)
function isolated(result, expectedReason) {
  for (const name of ['debt', 'available_funds']) {
    const domain = result.current[name]
    assert.equal(domain.status, 'partial'); assert.equal(domain.coverage.verified_customers, 1)
    reason(domain, expectedReason)
  }
  assert.equal(result.current.debt.verified_subtotal, 100)
  assert.equal(result.current.available_funds.verified_subtotal, 5)
  assert.equal(result.current.debt_ranking.complete, false)
}

test('current chain joins complete cash and rounding allocations without writing or changing balance semantics', async () => {
  const tables = fixture(), before = structuredClone(tables), db = makeDb(tables)
  const result = await readCurrentBrief(db)
  assert.equal(result.current.receivable, 178); assert.equal(result.current.prepay, 65)
  assert.equal(result.current.chain_evidence.status, 'available')
  assert.deepEqual(result.current.chain_evidence.coverage, { complete: true, total_customers: 2, verified_customers: 2, pending_customers: 0 })
  assert.equal(result.current.chain_evidence.allocation_count, 2)
  assert.equal(result.current.chain_evidence.external_verified, false)
  assert.equal(result.source_counts.allocations, 2)
  assert.deepEqual(tables, before); assert.deepEqual(db.writes, [])
})
test('missing historical backing is separate from a valid legacy balance, including an embedded residual beside modern allocations', async () => {
  for (const tables of [fixture({ crm_customer_allocations: [] }), fixture({ crm_sale_records: [sale({ amount_received: 25 }), sale({ _id: 's-b', customer_id: 'b', amount_received: 0, receipt_rounding_amount: 0 })] })]) {
    const result = await readCurrentBrief(makeDb(tables))
    assert.equal(result.current.debt.complete, true); assert.equal(result.current.available_funds.complete, true)
    assert.equal(result.current.chain_evidence.status, 'partial')
    assert.equal(result.current.chain_evidence.coverage.pending_customers, 1)
    assert.ok(result.current.chain_evidence.legacy_source_count > 0)
    reason(result.current.chain_evidence, 'allocation_chain_legacy_backing')
    assert.equal(result.current.prepay, 65)
  }
})
test('receipt ledger mismatch and target over-allocation quarantine only the known customer', async () => {
  const receiptMismatch = fixture()
  receiptMismatch.crm_customer_receipts[0].allocated_amount = 25
  receiptMismatch.crm_customer_receipts[0].unallocated_amount = 55
  isolated(await readCurrentBrief(makeDb(receiptMismatch)), 'allocation_chain_receipt_mismatch')
  const targetMismatch = fixture()
  targetMismatch.crm_sale_records[0].amount_received = 19
  isolated(await readCurrentBrief(makeDb(targetMismatch)), 'allocation_chain_exceeds_target')
})
test('allocation kind, precision, source identity and rounding excess cannot become verified balances', async () => {
  for (const [mutate, expected] of [
    [t => { t.crm_customer_allocations[0].allocate_kind = 'unknown' }, 'allocation_chain_invalid'],
    [t => { t.crm_customer_allocations[0].allocate_amount = 20.0001 }, 'invalid_source_precision'],
    [t => { t.crm_customer_allocations[0].receipt_source_type = 'sale_offset_credit' }, 'allocation_chain_invalid'],
    [t => { t.crm_sale_records[0].receipt_rounding_amount = 1 }, 'allocation_chain_exceeds_target'],
    [t => { t.crm_customer_allocations[0].sale_id = 'different' }, 'allocation_chain_invalid']
  ]) {
    const tables = fixture(); mutate(tables)
    isolated(await readCurrentBrief(makeDb(tables)), expected)
  }
})
test('cross-customer, unknown and missing references block population partitioning, with hidden references redacted', async () => {
  for (const mutate of [
    t => { t.crm_customer_allocations[0].customer_id = 'b' },
    t => { t.crm_customer_allocations[0].customer_id = 'unknown' },
    t => { t.crm_customer_allocations[0].receipt_id = 'missing' },
    t => { t.crm_customers.push({ ...customer('hidden'), is_hidden: true }); t.crm_customer_receipts[0].customer_id = 'hidden' }
  ]) {
    const tables = fixture(); mutate(tables)
    const result = await readCurrentBrief(makeDb(tables))
    for (const key of ['debt', 'available_funds']) {
      assert.equal(result.current[key].status, 'unavailable')
      assert.equal(result.current[key].coverage.complete, false)
      assert.equal(result.current[key].verified_subtotal, null)
    }
    assert.equal(result.current.chain_evidence.coverage.complete, false)
    assert.ok(!JSON.stringify(result.current.chain_evidence).includes('"hidden"'))
    assert.ok(!JSON.stringify(result.current.chain_evidence).includes('"unknown"'))
  }
})
test('void allocation rows are excluded; active references to a void target or receipt remain conflicts', async () => {
  const historical = fixture({ crm_customer_allocations: [allocation({ status: 'void', receipt_id: 'missing' })] })
  const legacy = await readCurrentBrief(makeDb(historical))
  assert.equal(legacy.current.debt.complete, true)
  assert.equal(legacy.current.chain_evidence.allocation_count, 0)
  for (const [kind, expected] of [['crm_sale_records', 'allocation_chain_target_invalid'], ['crm_customer_receipts', 'allocation_chain_receipt_invalid']]) {
    const tables = fixture(); tables[kind][0].status = 'void'
    isolated(await readCurrentBrief(makeDb(tables)), expected)
  }
})
test('offset rounding, linked refund and three-decimal flow/debt targets conserve their distinct budgets', async () => {
  const tables = fixture({ crm_sale_records: [sale({ amount_received: 20, receipt_rounding_amount: 5 })],
    crm_customer_receipts: [receipt({ source_type: 'sale_offset_credit', entry_kind: 'offset_credit', amount: 40,
      allocated_amount: 20, rounding_allocated_amount: 5, unallocated_amount: 10, offset_cash_refunded_amount: 5 }),
      receipt({ _id: 'refund', source_type: 'offset_credit_cash_refund', amount: -5, allocated_amount: 0,
        rounding_allocated_amount: 0, unallocated_amount: 0, offset_source_receipt_id: 'r-a' }),
      receipt({ _id: 'tiny', amount: 0.028, allocated_amount: 0.018, rounding_allocated_amount: 0.002, unallocated_amount: 0.01 })],
    crm_customer_flow_settlements: [{ _id: 'flow', customer_id: 'a', status: 'posted', should_receive: 0.028,
      amount_received: 0.018, receipt_rounding_amount: 0.002 }],
    crm_customer_allocations: [allocation(), allocation({ _id: 'round', allocate_kind: 'rounding', allocate_amount: 5 }),
      allocation({ _id: 'tiny-alloc', receipt_id: 'tiny', target_type: 'flow_settlement', target_id: 'flow', sale_id: '', flow_settlement_id: 'flow', allocate_amount: 0.018 }),
      allocation({ _id: 'tiny-round', receipt_id: 'tiny', target_type: 'flow_settlement', target_id: 'flow', sale_id: '', flow_settlement_id: 'flow', allocate_kind: 'rounding', allocate_amount: 0.002 })] })
  const result = await readCurrentBrief(makeDb(tables))
  assert.equal(result.current.receivable, 75.008); assert.equal(result.current.prepay, 0.01)
  assert.equal(result.current.offset_credit, 10); assert.equal(result.current.chain_evidence.complete, true)
})
test('allocation pagination, truncation and concurrent changes are checked across the entire source window', async () => {
  const tables = fixture({ crm_sale_records: [sale({ amount_received: 4.01, receipt_rounding_amount: 0 })],
    crm_customer_receipts: [receipt({ allocated_amount: 4.01, unallocated_amount: 75.99, rounding_allocated_amount: 0 })],
    crm_customer_allocations: Array.from({ length: 401 }, (_, i) => allocation({ _id: `a${String(i).padStart(4, '0')}`, allocate_amount: 0.01 })) })
  const result = await readCurrentBrief(makeDb(tables))
  assert.equal(result.current.chain_evidence.complete, true); assert.equal(result.source_counts.allocations, 401)
  const truncated = await readCurrentBrief(makeDb(tables, { get: (name, rows) => ({ data: structuredClone(name === 'crm_customer_allocations' ? rows.slice(0, 20) : rows) }) }))
  assert.equal(truncated.current.debt.coverage.complete, false); assert.equal(truncated.current.available_funds.coverage.complete, false)
  assert.equal(truncated.read_complete, false)
  let reads = 0
  const changing = await readCurrentBrief(makeDb(tables, { get: (name, rows) => {
    if (name === 'crm_customer_allocations' && ++reads === 3) tables.crm_customer_allocations[0].updated_at = Date.now() + 100
    return { data: structuredClone(rows) }
  } }))
  assert.equal(changing.current.chain_evidence.complete, false)
  assert.equal(changing.current.debt.coverage.complete, false)
})
test('linked refund evidence affects the allocated customer while unrelated damaged prepayments keep debt usable', async () => {
  const tables = fixture()
  tables.crm_customer_receipts[0].unallocated_amount = 55
  tables.crm_customer_receipts[0].cash_refunded_amount = 5
  tables.crm_customer_receipts.push(receipt({ _id: 'refund', source_type: 'customer_cash_refund', amount: -5,
    allocated_amount: 0, unallocated_amount: 0, rounding_allocated_amount: 0, refund_source_status: 'linked',
    refund_sources: [{ id: 'r-a', amount: 4 }] }))
  isolated(await readCurrentBrief(makeDb(tables)), 'refund_amount_mismatch')
  const unrelated = fixture()
  unrelated.crm_customer_receipts.push(receipt({ _id: 'unrelated', amount: 10, allocated_amount: 0, unallocated_amount: 11, rounding_allocated_amount: 0 }))
  const result = await readCurrentBrief(makeDb(unrelated))
  assert.equal(result.current.debt.complete, true)
  assert.equal(result.current.receivable, 178)
  assert.equal(result.current.available_funds.status, 'partial')
  assert.equal(result.current.chain_evidence.complete, false)
})
test('historical backing evidence reports full counts with a bounded source preview', async () => {
  const tables = fixture({ crm_sale_records: Array.from({ length: 25 }, (_, i) => sale({ _id: `old-${i}` })),
    crm_customer_receipts: [], crm_customer_allocations: [] })
  const result = await readCurrentBrief(makeDb(tables))
  assert.equal(result.current.debt.complete, true)
  assert.equal(result.current.chain_evidence.legacy_source_count, 25)
  assert.equal(result.current.chain_evidence.issue_count, 25)
  assert.equal(result.current.chain_evidence.issues.length, 20)
  assert.equal(result.current.chain_evidence.issues_complete, false)
})
