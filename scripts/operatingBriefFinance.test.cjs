'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')
const F = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBriefFinance')
const { BATCH } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBriefFinanceRead')
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const day = offset => new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10)
const period = day(-1), range = { start: period, end: period, today }
const customer = { _id: 'customer-1', default_price_unit: 'kg' }
const dated = { customer_id: customer._id, status: 'posted', biz_date: period, created_at: 1, updated_at: 1 }
const sale = (id = 'sale', amount = 100, extra = {}) => saleDoc({ _id: id, price_unit: 'kg', settlement_mode: 'sale', date: period,
  unit_price: 1, out_items: [{ net: Math.max(amount, 0) }], back_items: [{ net: Math.max(-amount, 0) }], amount_received: 0, ...extra })
const receipt = (id = 'receipt', amount = 100, extra = {}) => ({ ...dated, _id: id, amount, allocated_amount: 0,
  unallocated_amount: Math.max(amount, 0), rounding_amount: 0, rounding_allocated_amount: 0, ...extra })
const allocation = (id, receiptId, target, amount, extra = {}) => ({ ...dated, _id: id, receipt_id: receiptId, target_type: 'sale',
  target_id: target, sale_id: target, allocate_kind: 'receipt', allocate_amount: amount, ...extra })
function base(sales = [], extra = {}) {
  return { ...tablesFor(sale()), crm_customers: [customer], crm_sale_records: sales, ...extra }
}
const run = db => invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'brief', period: 'yesterday' })
const has = (domain, code) => domain.issues.some(row => row.code === code)

test('positive principal closes without double deducting return credits or either rounding; net keeps negative bills', () => {
  const result = F.businessSummary({ customers: [customer], sales: [sale('positive', 100, { amount_received: 40,
    rounding_amount: 5, receipt_rounding_amount: 2 }), sale('negative', -20, { rounding_amount: 2 })],
  flows: [{ ...dated, _id: 'flow', should_receive: 12.345, amount_received: 2.345 }] })
  assert.equal(result.complete, true)
  assert.deepEqual([result.positive, result.negative, result.net, result.sales, result.flow], [112.345, 20, 92.345, 80, 12.345])
  const s = result.positive_settlement
  assert.deepEqual([s.principal, s.allocated, s.sale_rounding, s.receipt_rounding, s.rounding, s.outstanding], [112.345, 42.345, 5, 2, 7, 63])
  assert.equal(s.complete, true)
})

test('signed bottle return net follows authoritative billing instead of treating negative scale difference as corrupt money', async () => {
  const tables = base([sale('signed-return', 0, { unit_price: 8, out_items: [{ net: 141 }, { net: 148 }],
    back_items: [{ net: -12, gross: 348, tare: 360 }, { net: -2, gross: 358, tare: 360 }] })])
  const { data } = await run(makeDb(tables))
  assert.equal(data.business.complete, true, JSON.stringify(data.business.issues))
  assert.equal(data.business.net, 2424)
  assert.equal(data.business.positive_settlement.outstanding, 2424)
  assert.equal(data.operations.sale_weight_kg, 303)
})

test('overpayment, negative settlement, over-rounding and illegal precision invalidate only the settlement partition', () => {
  for (const [patch, code] of [
    [{ amount_received: 120 }, 'target_overallocated'], [{ amount_received: -1 }, 'target_negative_settlement'],
    [{ rounding_amount: 101 }, 'source_rounding_exceeds_amount'], [{ receipt_rounding_amount: -2 }, 'invalid_source_amount'],
    [{ amount_received: 1.001 }, 'invalid_source_precision'], [{ amount_received: null }, 'invalid_source_amount']
  ]) {
    const result = F.businessSummary({ customers: [customer], sales: [sale('s', 100, patch)] })
    assert.equal(result.net, 100)
    assert.equal(result.positive_settlement.complete, false)
    assert.equal(result.positive_settlement.allocated, null)
    assert.equal(has(result.positive_settlement, code), true, code)
  }
  const zero = F.businessSummary({ customers: [customer], sales: [sale('zero', 0, { amount_received: 1 })] })
  assert.equal(has(zero.positive_settlement, 'zero_target_has_settlement'), true)
  const negative = F.businessSummary({ customers: [customer], sales: [sale('negative', -20, { amount_received: -21 })] })
  assert.equal(negative.net, -20)
  assert.equal(has(negative.positive_settlement, 'target_settlement_not_conserved'), true)
})

function destinationsFixture() {
  return base([sale('same', 100, { amount_received: 30 }), sale('prior', 80, { date: day(-2), amount_received: 20 }),
    sale('future', 100, { date: today, amount_received: 10 })], {
    crm_customer_receipts: [receipt('r', 100, { allocated_amount: 65, unallocated_amount: 25, cash_refunded_amount: 10, purpose: 'prepay' }),
      receipt('refund-later', -10, { biz_date: today, source_type: 'customer_cash_refund', refund_source_status: 'linked', refund_sources: [{ id: 'r', amount: 10 }] }),
      receipt('older', 20, { biz_date: day(-3), unallocated_amount: 15, cash_refunded_amount: 5 }),
      receipt('refund-period', -5, { source_type: 'customer_cash_refund', refund_source_status: 'linked', refund_sources: [{ id: 'older', amount: 5 }] })],
    crm_customer_opening_debts: [{ ...dated, _id: 'fee', source_type: 'other_fee_manual', amount: 10, amount_received: 5 }],
    crm_customer_allocations: [allocation('a', 'r', 'same', 30), allocation('b', 'r', 'prior', 20), allocation('c', 'r', 'future', 10),
      allocation('d', 'r', 'fee', 5, { target_type: 'other_fee' })]
  })
}

test('real handler separates dated cash from current allocation destinations and later refunds', async () => {
  const db = makeDb(destinationsFixture()), response = await run(db)
  assert.equal(response.code, 0)
  const { cash, business } = response.data
  assert.deepEqual([cash.received, cash.refund, cash.net], [100, 5, 95])
  assert.equal(cash.evidence.complete, true, JSON.stringify(cash.evidence))
  const d = cash.destinations
  assert.equal(d.complete, true, JSON.stringify(d))
  assert.deepEqual([d.same_period, d.prior_period, d.future_period, d.other, d.refunded_after_or_current, d.remaining_prepay, d.total], [30, 20, 10, 5, 10, 25, 100])
  assert.equal(business.positive_settlement.outstanding, 70)
  assert.equal(response.data.complete, true)
  assert.equal(db.writes.length, 0)
})

test('prepay purpose does not classify already allocated money; noncash rounding is not a cash destination', async () => {
  const tables = base([sale('s', 100, { amount_received: 60, receipt_rounding_amount: 5 })], {
    crm_customer_receipts: [receipt('r', 100, { purpose: 'prepay', allocated_amount: 60, unallocated_amount: 40, rounding_allocated_amount: 5 })],
    crm_customer_allocations: [allocation('cash', 'r', 's', 60), allocation('rounding', 'r', 's', 5, { allocate_kind: 'rounding' })]
  })
  const { data } = await run(makeDb(tables))
  assert.equal(data.cash.destinations.same_period, 60)
  assert.equal(data.cash.destinations.remaining_prepay, 40)
  assert.equal(data.cash.destinations.total, 100)
  assert.equal(data.business.positive_settlement.receipt_rounding, 5)
})

test('remaining cash is split by declared purpose, with absent legacy purpose staying unknown', async () => {
  const tables = base([], { crm_customer_receipts: [receipt('prepay', 10, { purpose: 'prepay' }), receipt('settlement', 20, { purpose: 'settlement' }),
    receipt('unknown', 30, { entry_kind: 'prepay' }), receipt('manual', 5, { source_type: 'customer_prepay_manual' })] })
  const { data } = await run(makeDb(tables))
  assert.deepEqual([data.cash.destinations.remaining_prepay, data.cash.destinations.remaining_settlement, data.cash.destinations.remaining_unknown], [15, 20, 30])
  assert.equal(data.complete, true)
})

test('opening credit, deposit transfer, settlement fee and offset can settle bills but never become new cash', async () => {
  const sources = ['opening_prepay', 'deposit_transfer', 'settlement_fee', 'sale_offset_credit']
  const tables = base([sale('s', 100, { amount_received: 40 })], {
    crm_customer_receipts: sources.map((source_type, i) => receipt(`noncash-${i}`, 10, { source_type, allocated_amount: 10, unallocated_amount: 0 })),
    crm_customer_allocations: sources.map((_, i) => allocation(`a${i}`, `noncash-${i}`, 's', 10))
  })
  const { data } = await run(makeDb(tables))
  assert.equal(data.cash.received, 0)
  assert.equal(data.cash.destinations.total, 0)
  assert.equal(data.business.positive_settlement.allocated, 40)
  assert.equal(data.cash.evidence.complete, true)
})

test('old embedded paid or refunded amounts flag limited evidence without inventing a receipt date or hiding gross', async () => {
  for (const target of [sale('legacy-paid', 100, { amount_received: 30 }), sale('legacy-refund', -20, { amount_received: -20 })]) {
    const { data } = await run(makeDb(base([target], { crm_customer_receipts: [receipt('known-cash', 10)] })))
    assert.equal(data.cash.received, 10)
    assert.equal(data.cash.complete, true)
    assert.equal(data.cash.evidence.complete, false)
    assert.equal(data.cash.evidence.scope, 'selected_business_cohort')
    assert.equal(has(data.cash.evidence, target.amount_received < 0 ? 'embedded_refund_date_missing' : 'embedded_receipt_date_missing'), true)
    assert.equal(data.complete, false)
    assert.equal(data.business.positive_settlement.complete, true)
  }
})

test('pending operations on an out-of-period backing receipt keep evidence unresolved without hiding current cash', async () => {
  for (const field of ['receipt_adjustment_status', 'refund_source_status']) {
    const tables = base([sale('s', 100, { amount_received: 50 })], {
      crm_customer_receipts: [receipt('older-source', 100, { biz_date: day(-3), allocated_amount: 50, unallocated_amount: 50, [field]: 'pending' }),
        receipt('period-cash', 10)],
      crm_customer_allocations: [allocation('a', 'older-source', 's', 50)]
    })
    const { data } = await run(makeDb(tables))
    assert.equal(data.cash.evidence.complete, false, field)
    assert.equal(has(data.cash.evidence, 'receipt_operation_pending'), true)
    assert.equal(data.cash.evidence.issues.some(row => row.source_type === 'crm_customer_receipts' && row.source_id === 'older-source'), true)
    assert.equal(data.complete, false)
    assert.equal(data.read_complete, true)
    assert.equal(data.cash.complete, true)
    assert.equal(data.cash.net, 10)
    assert.equal(data.cash.destinations.complete, true)
    assert.equal(data.business.positive_settlement.allocated, 50)
  }
})

test('business pricing failure preserves good dated cash and physical quantities', async () => {
  const { data, financial_evidence } = await run(makeDb(base([sale('bad', 100, { unit_price: null })], { crm_customer_receipts: [receipt('r', 10)] })))
  assert.equal(data.business.complete, false)
  assert.equal(data.business.total, null)
  assert.equal(data.cash.net, 10)
  assert.equal(data.cash.destinations.total, 10)
  assert.equal(data.operations.sale_weight_kg, 100)
  assert.equal(financial_evidence.complete, false)
})

test('aggregate monetary overflow cannot turn an unrelated valid cash domain into a failed endpoint', async () => {
  const tables = base([sale('large', 9e12)], { crm_customer_flow_settlements: [{ ...dated, _id: 'large-flow', should_receive: 9e12, amount_received: 0 }],
    crm_customer_receipts: [receipt('known-cash', 10)] })
  const result = await run(makeDb(tables))
  assert.equal(result.code, 0)
  assert.equal(result.data.business.complete, false)
  assert.equal(has(result.data.business, 'amount_overflow'), true)
  assert.equal(result.data.cash.net, 10)
})

test('backing receipts must conserve funds and offset metadata cannot reclassify a cash allocation', async () => {
  const tables = base([sale('s', 100, { amount_received: 60 })], {
    crm_customer_receipts: [receipt('old-source', 40, { biz_date: day(-3), allocated_amount: 60, unallocated_amount: 0 })],
    crm_customer_allocations: [allocation('a', 'old-source', 's', 60)]
  })
  const first = (await run(makeDb(tables))).data
  assert.equal(first.cash.net, 0)
  assert.equal(first.cash.evidence.complete, false)
  assert.equal(has(first.cash.evidence, 'receipt_balance_not_conserved'), true)
  const cash = destinationsFixture()
  cash.crm_customer_allocations[0].receipt_entry_kind = 'offset_credit'
  const second = (await run(makeDb(cash))).data
  assert.equal(second.cash.net, 95)
  assert.equal(second.cash.destinations.complete, false)
  assert.equal(has(second.cash.destinations, 'allocation_reference_conflict'), true)
})

test('bad allocation, missing target, wrong owner, void target and target overpayment fail destinations without hiding cash', async () => {
  const variants = [
    tables => { tables.crm_customer_allocations[0].allocate_amount = 31 },
    tables => { tables.crm_sale_records = tables.crm_sale_records.filter(row => row._id !== 'same') },
    tables => { tables.crm_customers.push({ _id: 'other' }); tables.crm_sale_records[0].customer_id = 'other' },
    tables => { tables.crm_sale_records[0].status = 'void' },
    tables => { tables.crm_sale_records[0].amount_received = 101 },
    tables => { tables.crm_customer_allocations[0].target_type = 'unknown' },
    tables => { tables.crm_customer_allocations[0].sale_id = 'wrong' },
    tables => { tables.crm_customer_receipts[0].unallocated_amount = 26 }
  ]
  for (const mutate of variants) {
    const tables = destinationsFixture(); mutate(tables)
    const { data } = await run(makeDb(tables))
    assert.equal(data.cash.complete, true)
    assert.equal(data.cash.net, 95)
    assert.equal(data.cash.destinations.complete, false)
    assert.equal(data.cash.destinations.same_period, null)
  }
})

test('bad refund links and unexplained source refund counters never masquerade as available cash', async () => {
  for (const mutate of [
    t => { t.crm_customer_receipts[1].refund_source_status = 'pending'; t.crm_customer_receipts[1].refund_sources = [] },
    t => { t.crm_customer_receipts[1].refund_sources[0].amount = 9 },
    t => { t.crm_customer_receipts[1].biz_date = day(-3) },
    t => { t.crm_customer_receipts[0].cash_refunded_amount = 9; t.crm_customer_receipts[0].unallocated_amount = 26 },
    t => { t.crm_customer_receipts[1].refund_sources = [{ id: 'r', amount: 5 }, { id: 'r', amount: 5 }] }
  ]) {
    const tables = destinationsFixture(); mutate(tables)
    const { data } = await run(makeDb(tables))
    assert.equal(data.cash.received, 100)
    assert.equal(data.cash.destinations.complete, false)
  }
})

test('opening debt is prior debt while fees and balance adjustments are other destinations', async () => {
  const tables = base([], {
    crm_customer_receipts: [receipt('r', 30, { allocated_amount: 30, unallocated_amount: 0 })],
    crm_customer_opening_debts: ['opening_debt', 'other_fee', 'balance_adjustment'].map(type => ({ ...dated, _id: type, source_type: type, amount: 10, amount_received: 10 })),
    crm_customer_allocations: ['opening_debt', 'other_fee', 'balance_adjustment'].map(type => allocation(type, 'r', type, 10, { target_type: type }))
  })
  const { data } = await run(makeDb(tables))
  assert.equal(data.cash.destinations.complete, true, JSON.stringify(data.cash.destinations))
  assert.equal(data.cash.destinations.prior_period, 10)
  assert.equal(data.cash.destinations.other, 20)
})

test('cashier source head must match gas/deposit split and official posted receipt', async () => {
  const intake = { ...dated, _id: 'intake', amount: 30, gas_amount: 20, deposit_amount: 10, purpose: 'settlement', receipt_id: 'r', payment_method: 'cash' }
  const tables = base([], { crm_cashier_intakes: [intake], crm_customer_receipts: [receipt('r', 20, {
    source_type: 'cashier_intake', source_id: 'intake', intake_id: 'intake', purpose: 'settlement', payment_method: 'cash' })] })
  assert.equal((await run(makeDb(tables))).data.cash.destinations.remaining_settlement, 20)
  tables.crm_cashier_intakes[0].gas_amount = 21
  const { data } = await run(makeDb(tables))
  assert.equal(data.cash.complete, false)
  assert.equal(data.cash.net, null)
  assert.equal(data.business.complete, true)
})

test('hidden references are not returned in issues; visible referring allocation remains actionable', async () => {
  const tables = destinationsFixture()
  tables.crm_customers.push({ _id: 'hidden-owner', is_hidden: true })
  tables.crm_sale_records[0]._id = 'hidden-target'
  tables.crm_sale_records[0].customer_id = 'hidden-owner'
  tables.crm_customer_allocations[0].target_id = 'hidden-target'
  tables.crm_customer_allocations[0].sale_id = 'hidden-target'
  const result = await run(makeDb(tables))
  const d = result.data.cash.destinations
  assert.equal(d.complete, false)
  assert.equal(d.issues.some(row => row.source_id === 'a' && row.source_type === 'crm_customer_allocations'), true)
  assert.equal(JSON.stringify(result).includes('hidden-target'), false)
  assert.equal(JSON.stringify(result).includes('hidden-owner'), false)
})

test('referenced targets use bounded ID batches with complete pagination instead of scanning all historical sales', async () => {
  const count = 205, ids = Array.from({ length: count }, (_, i) => `prior-${String(i).padStart(3, '0')}`)
  const tables = base(ids.map(id => sale(id, 1, { date: day(-2), amount_received: 1 })), {
    crm_customer_receipts: [receipt('r', count, { allocated_amount: count, unallocated_amount: 0 })],
    crm_customer_allocations: ids.map(id => allocation(`alloc-${id}`, 'r', id, 1))
  })
  const whereClauses = []
  const db = makeDb(tables, { get: (name, rows, options) => { if (name === 'crm_sale_records') whereClauses.push(options.where); return { data: structuredClone(rows) } } })
  const { data } = await run(db)
  assert.equal(data.cash.destinations.prior_period, count)
  function walk(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) { if (key === '$in') assert.ok(child.length <= BATCH); walk(child) }
  }
  whereClauses.forEach(where => { walk(where); assert.match(JSON.stringify(where), /"date"|"_id"/) })
  assert.equal(db.writes.length, 0)
})

const usesIdIn = options => JSON.stringify(options.where || {}).includes('"_id":{"$in":')
function alipayIdOmission(tables, onDocument) {
  return makeDb(tables, {
    count: (name, total, options) => ({ total: usesIdIn(options) ? 0 : total }),
    get: (name, rows, options) => {
      if (usesIdIn(options)) return { data: [] }
      const id = typeof options.where?._id === 'string' ? options.where._id : null
      if (id) {
        const doc = structuredClone(rows[0] || null)
        onDocument?.(name, id)
        return { data: doc } // The SDK supports document objects as well as arrays.
      }
      return { data: structuredClone(rows) }
    }
  })
}

test('Alipay automatic-ID omissions in both count and get are recovered by verified document reads', async () => {
  const db = alipayIdOmission(destinationsFixture())
  const { data } = await run(db)
  assert.equal(data.read_complete, true)
  assert.equal(data.complete, true, JSON.stringify(data.cash))
  assert.equal(data.cash.evidence.complete, true)
  assert.equal(data.cash.destinations.same_period, 30)
  assert.equal(data.cash.destinations.prior_period, 20)
  assert.equal(data.cash.destinations.future_period, 10)
  assert.equal(data.cash.destinations.refunded_after_or_current, 10)
  assert.equal(db.writes.length, 0)
})

test('Alipay document fallback retains customer visibility and does not expose hidden referenced IDs', async () => {
  const tables = destinationsFixture()
  tables.crm_customers.push({ _id: 'hidden-owner', is_hidden: true })
  tables.crm_sale_records[1].customer_id = 'hidden-owner'
  tables.crm_sale_records[1]._id = 'hidden-target'
  tables.crm_customer_allocations[1].target_id = 'hidden-target'
  tables.crm_customer_allocations[1].sale_id = 'hidden-target'
  const result = await run(alipayIdOmission(tables))
  assert.equal(result.data.cash.net, 95)
  assert.equal(result.data.cash.destinations.complete, false)
  assert.equal(JSON.stringify(result).includes('hidden-target'), false)
  assert.equal(JSON.stringify(result).includes('hidden-owner'), false)
})

test('fallback documents are fingerprinted again so legacy changes without timestamps invalidate dependent domains', async () => {
  const tables = destinationsFixture(); let changed = false
  const result = await run(alipayIdOmission(tables, (name, id) => {
    if (name === 'crm_sale_records' && id === 'prior' && !changed) {
      changed = true
      tables.crm_sale_records.find(row => row._id === id).amount_received = 21
    }
  }))
  assert.equal(result.data.read_complete, false)
  assert.equal(result.data.cash.net, 95)
  assert.equal(result.data.cash.destinations.complete, false)
  assert.equal(has(result.data.cash.destinations, 'records_changed_during_brief'), true)
})

test('reference read failure or concurrent allocation change invalidates only dependent domains', async () => {
  const countFailure = makeDb(destinationsFixture(), { count: (name, total) => ({ total: name === 'crm_customer_allocations' ? null : total }) })
  const first = (await run(countFailure)).data
  assert.equal(first.cash.net, 95)
  assert.equal(first.cash.destinations.complete, false)
  assert.equal(first.business.total, 100)
  const tables = destinationsFixture(); let changed = false
  const db = makeDb(tables, { get: (name, rows, options) => {
    if (name === 'crm_customer_opening_debts' && !changed) { tables.crm_customer_allocations[0].updated_at = Date.now() + 100; changed = true }
    return { data: structuredClone(rows) }
  } })
  const second = (await run(db)).data
  assert.equal(second.cash.net, 95)
  assert.equal(second.cash.destinations.complete, false)
  assert.equal(second.business.total, 100)
  assert.equal(has(second.cash.destinations, 'records_changed_during_brief'), true)
})

test('real handler distinguishes incomplete source reads from fully read but unresolved business evidence', async () => {
  const failed = await run(makeDb(destinationsFixture(), { count: (name, total) => ({ total: name === 'crm_customer_allocations' ? null : total }) }))
  assert.equal(failed.data.read_complete, false)
  assert.equal(failed.data.cash.net, 95)
  assert.equal(failed.data.cash.destinations.complete, false)
  const unresolved = await run(makeDb(base([sale('bad-price', 100, { unit_price: null })], { crm_customer_receipts: [receipt('r', 10)] })))
  assert.equal(unresolved.data.read_complete, true)
  assert.equal(unresolved.data.complete, false)
  assert.equal(unresolved.data.business.complete, false)
  assert.equal(unresolved.data.cash.net, 10)
})

test('empty complete inputs are real zeros and malformed allocation values cannot be coerced to zero', async () => {
  const empty = (await run(makeDb(base()))).data
  assert.equal(empty.complete, true)
  assert.equal(empty.business.positive_settlement.principal, 0)
  assert.equal(empty.cash.destinations.total, 0)
  for (const value of [null, '', false, 'not-money', -1, 1.0001]) {
    const tables = destinationsFixture(); tables.crm_customer_allocations[0].allocate_amount = value
    const { data } = await run(makeDb(tables))
    assert.equal(data.cash.destinations.complete, false, String(value))
    assert.equal(data.cash.net, 95)
  }
})
