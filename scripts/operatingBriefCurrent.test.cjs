'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { makeDb, loadHandler } = require('./lib/accountingTestHarness.cjs')
const { readCurrentBrief } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/currentBrief')
const snapshots = require('../uniCloud-alipay/cloudfunctions/common/customerBalance').createCustomerBalance(require('../uniCloud-alipay/cloudfunctions/common/saleAccounting'))
const customer = (id = 'a', extra = {}) => ({ _id: id, name: `合成${id}`, default_price_unit: 'kg', ...extra })
const sale = (extra = {}) => ({ _id: 'sale-a', customer_id: 'a', date: '2026-10-23', settlement_mode: 'sale',
  biz_mode: 'bottle', price_unit: 'kg', unit_price: 10, out_items: [{ net: 10 }], back_items: [],
  amount_received: 0, created_at: 1, updated_at: 1, ...extra })
const receipt = (extra = {}) => ({ _id: 'receipt-a', customer_id: 'a', source_type: 'customer_prepay_manual',
  amount: 80, allocated_amount: 0, unallocated_amount: 80, status: 'posted', created_at: 1, updated_at: 1, ...extra })
const debt = (extra = {}) => ({ _id: 'debt-a', customer_id: 'a', amount: 10, amount_received: 0,
  status: 'posted', biz_date: '2026-01-01', created_at: 1, updated_at: 1, ...extra })
const fixture = (extra = {}) => ({ crm_users: [{ _id: 'admin', role: 'superadmin', token: 'test' }],
  crm_customers: [customer()], crm_sale_records: [], crm_customer_flow_settlements: [], crm_customer_opening_debts: [],
  crm_customer_receipts: [], crm_cashier_intakes: [], ...extra })
function arrival(id, purpose, amount, available = amount, extra = {}) {
  const common = { customer_id: 'a', biz_date: '2026-10-23', payment_method: 'bank', status: 'posted', purpose, created_at: 1, updated_at: 1 }
  return {
    head: { ...common, _id: id, receipt_id: `r-${id}`, kind: 'gas', amount, gas_amount: amount, deposit_amount: 0, ...extra },
    receipt: receipt({ ...common, _id: `r-${id}`, intake_id: id, source_id: id, source_type: 'cashier_intake', amount,
      allocated_amount: amount - available, unallocated_amount: available })
  }
}
function unavailable(result, domain = 'debt', reason) {
  const value = domain === 'pending' ? result.pending : result.current[domain]
  assert.equal(value.status, 'unavailable'); assert.equal(value.complete, false)
  assert.ok(value.issues.length > 0); if (reason) assert.ok(value.issues.some(issue => issue.reason === reason), `missing ${reason}`)
  if (domain === 'debt') {
    assert.equal(result.current.receivable, null); assert.equal(result.current.debt_ranking.complete, false)
    assert.equal(result.current.debt_ranking.total_receivable, null); assert.deepEqual(result.current.debt_ranking.items, [])
  } else if (domain === 'available_funds') { assert.equal(result.current.prepay, null); assert.equal(result.current.offset_credit, null) }
  else { assert.equal(result.pending.count, null); assert.equal(result.pending.amount, null) }
  return (reason && value.issues.find(issue => issue.reason === reason)) || value.issues[0]
}

test('empty sources return verified zero and never persist customer caches', async () => {
  const db = makeDb(fixture()), result = await readCurrentBrief(db, { now: 123 })
  assert.equal(result.current.receivable, 0); assert.equal(result.current.prepay, 0)
  assert.equal(result.current.customer_count, 1); assert.deepEqual(result.pending, { count: 0, amount: 0, complete: true, status: 'available', issues: [] })
  assert.equal(result.updated_at, 123); assert.equal(result.complete, true); assert.deepEqual(db.writes, [])
  assert.equal(result.snapshot_consistent, false)
})
test('real source balances ignore wrong customer caches and never offset one customer against another', async () => {
  const db = makeDb(fixture({ crm_customers: [customer('a', { receivable_balance: 999, prepay_balance: 999, net_balance: 0 }),
    customer('b', { is_active: false }), customer('delivery', { settlement_customer_id: 'a' }), customer('hidden', { is_hidden: true })],
    crm_sale_records: [sale({ delivery_customer_id: 'delivery' }), sale({ _id: 'hidden-sale', customer_id: 'hidden', unit_price: null }),
      sale({ _id: 'hidden-delivery', delivery_customer_id: 'hidden', unit_price: null })],
    crm_customer_receipts: [receipt({ customer_id: 'b' }), receipt({ _id: 'hidden-receipt', customer_id: 'hidden', amount: null })] }))
  const result = await readCurrentBrief(db)
  assert.equal(result.current.receivable, 100); assert.equal(result.current.prepay, 80)
  assert.equal(result.current.customer_count, 2); assert.equal(result.source_counts.sales, 1)
  assert.deepEqual(db.writes, [])
})
test('flow projections are not charged twice; 3-digit flows and debt scales retain tiny outstanding amounts', async () => {
  const db = makeDb(fixture({ crm_sale_records: [sale({ settlement_mode: 'customer_flow', price_unit: 'm3', unit_price: 999, amount_received: 0 })],
    crm_customer_flow_settlements: [{ _id: 'f1', customer_id: 'a', should_receive: 0.028, amount_received: 0.018,
      receipt_rounding_amount: 0.002, status: 'posted' }],
    crm_customer_opening_debts: [debt({ amount: 0.028, amount_received: 0.018, receipt_rounding_amount: 0.002, money_scale: 3 })] }))
  assert.equal((await readCurrentBrief(db)).current.receivable, 0.016)
})
test('signed bottle return net retains canonical 2424 receivable and never rewrites the source', async () => {
  const source = sale({ unit_price: 8, out_items: [{ net: 141 }, { net: 148 }], back_items: [{ net: -12 }, { net: -2 }] })
  const tables = fixture({ crm_sale_records: [source] }), before = structuredClone(tables)
  const canonical = snapshots.computeSaleSnapshot(source)
  assert.equal(canonical.should_receive, 2424)
  const db = makeDb(tables), result = await readCurrentBrief(db)
  assert.equal(result.current.debt.complete, true)
  assert.equal(result.current.receivable, canonical.outstanding)
  assert.equal(result.current.debt_ranking.total_receivable, 2424)
  assert.deepEqual(result.current.debt_ranking.items.map(row => ({ amount: row.amount, share: row.share_of_total })), [{ amount: 2424, share: 1 }])
  assert.deepEqual(tables, before); assert.deepEqual(db.writes, [])
})
test('both rounding kinds and adjustment targets use the settlement snapshots', async () => {
  const db = makeDb(fixture({ crm_sale_records: [sale({ rounding_amount: 1, amount_received: 20, receipt_rounding_amount: 2, should_receive: 999 })],
    crm_customer_opening_debts: [debt({ _id: 'opening', amount: 20, rounding_amount: 3, amount_received: 7, receipt_rounding_amount: 1 }),
      debt({ _id: 'fee', source_type: 'other_fee_manual', amount: 4 }),
      debt({ _id: 'reverse', source_type: 'balance_adjustment', adjustment_kind: 'rounding_reversal', amount: 3 }),
      debt({ _id: 'writeoff', source_type: 'balance_adjustment', adjustment_kind: 'prepay_writeoff', amount: 5, amount_received: 5 })] }))
  assert.equal((await readCurrentBrief(db)).current.receivable, 93)
})
test('offset allocation already in target paid amount is not subtracted twice; offset availability is separate', async () => {
  const result = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale({ amount_received: 20 })],
    crm_customer_receipts: [receipt({ source_type: 'sale_offset_credit', entry_kind: 'offset_credit', amount: 35,
      allocated_amount: 20, rounding_allocated_amount: 5, unallocated_amount: 10 }), receipt({ _id: 'prepay', amount: 9, unallocated_amount: 9 })] })))
  assert.equal(result.current.receivable, 80); assert.equal(result.current.prepay, 9); assert.equal(result.current.offset_credit, 10)
})
test('prepay source groups include opening, transfer and fee without classifying them as pending settlement', async () => {
  const receipts = ['opening_prepay', 'deposit_transfer', 'settlement_fee', 'customer_prepay_manual'].map((source_type, i) =>
    receipt({ _id: `r${i}`, source_type, amount: 0.001 + i, unallocated_amount: 0.001 + i }))
  const result = await readCurrentBrief(makeDb(fixture({ crm_customer_receipts: receipts })))
  assert.equal(result.current.prepay, 6.004); assert.equal(result.current.prepay_sources.settlement_fee, 2.001)
  assert.equal(result.current.prepay_label, '可用款（不含退气抵款）'); assert.equal(result.pending.count, 0)
})
test('only positive unallocated settlement arrivals become pending; mixed deposits are not counted', async () => {
  const arrivals = [arrival('settlement', 'settlement', 100, 30, { kind: 'mixed', amount: 120, deposit_amount: 20 }),
    arrival('prepay', 'prepay', 80), arrival('unknown', 'unspecified', 90), arrival('allocated', 'settlement', 40, 0)]
  const tables = fixture({ crm_cashier_intakes: arrivals.map(x => x.head), crm_customer_receipts: arrivals.map(x => x.receipt) })
  tables.crm_customer_receipts.push(receipt({ _id: 'legacy', source_type: 'cashier_intake', purpose: 'unspecified' }))
  const result = await readCurrentBrief(makeDb(tables))
  assert.deepEqual(result.pending, { count: 1, amount: 30, complete: true, status: 'available', issues: [] }); assert.equal(result.current.prepay, 280)
})
test('broken, repeated and cross-customer intake links cannot supply a total', async () => {
  for (const mutate of [
    t => { t.crm_cashier_intakes[0].gas_amount = 99 },
    t => { t.crm_customer_receipts[0].intake_id = 'missing' },
    t => { t.crm_customer_receipts[0].customer_id = 'b'; t.crm_customers.push(customer('b')) },
    t => { t.crm_customer_receipts[0].purpose = 'prepay' },
    t => { t.crm_customer_receipts.push({ ...t.crm_customer_receipts[0], _id: 'duplicate', intake_id: undefined }) },
    t => { t.crm_cashier_intakes.push({ ...t.crm_cashier_intakes[0], _id: 'duplicate' }) }
  ]) {
    const value = arrival('i', 'settlement', 100), tables = fixture({ crm_cashier_intakes: [value.head], crm_customer_receipts: [value.receipt] })
    mutate(tables); const result = await readCurrentBrief(makeDb(tables)); unavailable(result, 'available_funds'); unavailable(result, 'pending'); assert.equal(result.current.debt.complete, true)
  }
})
test('posted refund is counted once through source availability, with linked backing verified', async () => {
  const source = receipt({ amount: 100, allocated_amount: 30, unallocated_amount: 50, cash_refunded_amount: 20 })
  const refund = receipt({ _id: 'refund', source_type: 'customer_cash_refund', amount: -20, allocated_amount: 0, unallocated_amount: 0,
    refund_source_status: 'linked', refund_sources: [{ id: source._id, amount: 20 }] })
  const tables = fixture({ crm_customer_receipts: [source, refund] })
  assert.equal((await readCurrentBrief(makeDb(tables))).current.prepay, 50)
  refund.refund_sources[0].amount = 19
  unavailable(await readCurrentBrief(makeDb(tables)), 'available_funds', 'refund_amount_mismatch')
})
test('unfinished receipt/refund, broken conservation and missing backing refuse a usable balance', async () => {
  for (const patch of [{ receipt_adjustment_status: 'pending' }, { refund_source_status: 'pending' },
    { unallocated_amount: 81 }, { amount: 100, unallocated_amount: 80, cash_refunded_amount: 20 },
    { allocated_amount: null }, { unallocated_amount: true }, { amount: '' }, { unallocated_amount: 0.0001 }])
    unavailable(await readCurrentBrief(makeDb(fixture({ crm_customer_receipts: [receipt(patch)] }))), 'available_funds')
})
test('unresolved historical m3 and missing principal/quantity do not turn into zero', async () => {
  const unresolved = unavailable(await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale({ price_unit: 'm3', settlement_mode: undefined })] }))))
  assert.equal(unresolved.code, 'FINANCIAL_CLASSIFICATION_REQUIRED'); assert.equal(unresolved.source_id, 'sale-a'); assert.equal(unresolved.field, 'settlement_mode')
  for (const patch of [{ unit_price: null }, { out_items: null, back_items: null }, { amount_received: undefined }, { rounding_amount: true }])
    unavailable(await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale(patch)] }))))
  unavailable(await readCurrentBrief(makeDb(fixture({ crm_customer_opening_debts: [debt({ amount: null })] }))))
})
test('ambiguous settlement scope and source ownership are rejected, without moving facts', async () => {
  for (const tables of [
    fixture({ crm_customers: [customer('a', { settlement_customer_id: 'missing' })] }),
    fixture({ crm_customers: [customer('a', { settlement_customer_id: 'b' }), customer('b', { settlement_customer_id: 'a' })] }),
    fixture({ crm_customers: [customer(), customer('d', { settlement_customer_id: 'a' })], crm_sale_records: [sale({ customer_id: 'd' })] }),
    fixture({ crm_sale_records: [sale({ customer_id: 'missing' })] }),
    fixture({ crm_customers: [customer(), customer('b')], crm_sale_records: [sale({ delivery_customer_id: 'b' })] })
  ]) {
    const db = makeDb(tables); unavailable(await readCurrentBrief(db)); assert.deepEqual(db.writes, [])
  }
})
test('void sources do not affect current debt, availability or reminders', async () => {
  const value = arrival('i', 'settlement', 100)
  value.head.status = 'void'; value.receipt.status = 'void'
  const result = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale({ status: 'void' })],
    crm_customer_opening_debts: [debt({ status: 'void' })], crm_customer_receipts: [value.receipt], crm_cashier_intakes: [value.head] })))
  assert.equal(result.current.receivable, 0); assert.equal(result.current.prepay, 0); assert.equal(result.pending.count, 0)
})
test('complete keyset reads aggregate beyond a display page and refuse truncated/invalid counts', async () => {
  const tables = fixture({ crm_sale_records: Array.from({ length: 401 }, (_, i) => sale({ _id: `s${String(i).padStart(4, '0')}` })) })
  assert.equal((await readCurrentBrief(makeDb(tables))).current.receivable, 40100)
  unavailable(await readCurrentBrief(makeDb(tables, { get: (name, rows) => ({ data: structuredClone(name === 'crm_sale_records' ? rows.slice(0, 20) : rows) }) })))
  for (const total of [null, false, '', -1, 1.5]) unavailable(await readCurrentBrief(makeDb(tables, {
    count: (name, value) => ({ total: name === 'crm_sale_records' ? total : value })
  })))
})
test('outer request detects a collection changing after its individual read completed', async () => {
  const tables = fixture({ crm_sale_records: [sale()] }); let changed = false
  const db = makeDb(tables, { get: (name, rows) => {
    if (!changed && name === 'crm_customer_receipts') { changed = true; tables.crm_sale_records[0].updated_at = Date.now() + 10 }
    return { data: structuredClone(rows) }
  } })
  unavailable(await readCurrentBrief(db), 'debt', 'current_window_changed')
})
test('current sources are read by collection, not once per customer', async () => {
  const tables = fixture({ crm_customers: Array.from({ length: 80 }, (_, i) => customer(`c${i}`)),
    crm_sale_records: Array.from({ length: 80 }, (_, i) => sale({ _id: `s${i}`, customer_id: `c${i}` })) })
  let queries = 0
  await readCurrentBrief(makeDb(tables, { get: (name, rows) => { queries++; return { data: structuredClone(rows) } } }))
  assert.ok(queries <= 20, `expected bounded collection reads, got ${queries}`)
})
test('shared extraction retains two-decimal rounding, three-decimal truncation and exact settlement imports', async () => {
  assert.equal(snapshots.fix2(1.239), 1.24); assert.equal(snapshots.fix3(1.2399), 1.239)
  assert.equal(snapshots.computeSaleSnapshot(sale({ amount_received: -20 })).outstanding, 120)
  assert.equal(snapshots.computeOpeningDebtSnapshot({ amount: 10, rounding_amount: 99, amount_received: 0 }).outstanding, 0)
  assert.equal(snapshots.computeFlowSettlementSnapshot({ should_receive: 0.028, amount_received: 0.018, receipt_rounding_amount: 0.002 }).outstanding, 0.008)
  const canonical = fs.readFileSync(require.resolve('../uniCloud-alipay/cloudfunctions/common/customerBalance'), 'utf8')
  for (const name of ['crm-dashboard', 'crm-customer-settlement']) assert.equal(fs.readFileSync(require.resolve(`../uniCloud-alipay/cloudfunctions/${name}/customerBalanceLocal`), 'utf8'), canonical)
  // Executing the real settlement report exercises its extracted imports and
  // request-local read context, including historical fallback behavior.
  const db = makeDb(fixture({ crm_sale_records: [sale({ rounding_amount: 1, amount_received: 20, receipt_rounding_amount: 2 })] }))
  const result = await loadHandler('crm-customer-settlement', db)({ token: 'test', action: 'getCustomerStatementV1', data: { customer_id: 'a', summary_only: true } })
  assert.equal(result.code, 0, result.msg); assert.equal(result.data.summary.receivable_balance, 77)
  assert.deepEqual(db.writes, [])
})

test('top debtors use all current sources, retain inactive customers, and exclude hidden/delivery identities', async () => {
  const tables = fixture({ crm_customers: [customer('a', { qr_code: 'K003' }), customer('b', { qr_code: 'K001' }),
    customer('c', { qr_code: 'K002', is_active: false }), customer('d'), customer('zero'),
    customer('delivery', { settlement_customer_id: 'a' }), customer('hidden', { is_hidden: true })],
    crm_sale_records: [sale({ delivery_customer_id: 'delivery', date: '2025-01-01' }),
      sale({ _id: 'b-sale', customer_id: 'b', date: '2026-10-23' }),
      sale({ _id: 'd-sale', customer_id: 'd', amount_received: 20 }),
      sale({ _id: 'zero-sale', customer_id: 'zero', amount_received: 100 }),
      sale({ _id: 'hidden-sale', customer_id: 'hidden', unit_price: 99999 }),
      sale({ _id: 'hidden-delivery-sale', delivery_customer_id: 'hidden', unit_price: null })],
    crm_customer_flow_settlements: [{ _id: 'c-flow', customer_id: 'c', should_receive: 20, amount_received: 0, status: 'posted' }],
    crm_customer_opening_debts: [debt({ _id: 'c-opening', customer_id: 'c', amount: 70 })] })
  const db = makeDb(tables), result = await readCurrentBrief(db, { now: 123 })
  const ranking = result.current.debt_ranking
  assert.equal(ranking.complete, true); assert.equal(ranking.total_receivable, 370)
  assert.equal(ranking.positive_customer_count, 4); assert.equal(result.current.customer_count, 5)
  assert.deepEqual(ranking.items.map(row => [row.customer_id, row.name, row.code, row.amount]), [
    ['b', '合成b', 'K001', 100], ['a', '合成a', 'K003', 100], ['c', '合成c', 'K002', 90]])
  assert.equal(ranking.items[0].share_of_total, 0.27027)
  assert.ok(ranking.items.every(row => !Object.hasOwn(row, 'overdue') && !Object.hasOwn(row, 'oldest_unpaid_date')))
  assert.equal(result.updated_at, 123); assert.deepEqual(db.writes, [])
})
test('top-three sorting is deterministic across tied codes; no debt returns an empty complete ranking', async () => {
  const tables = fixture({ crm_customers: ['z', 'a', 'b', 'c'].map(id => customer(id, { qr_code: 'SAME' })),
    crm_sale_records: ['z', 'a', 'b', 'c'].map(id => sale({ _id: `s-${id}`, customer_id: id })) })
  for (const list of [tables.crm_sale_records, [...tables.crm_sale_records].reverse()]) {
    const result = await readCurrentBrief(makeDb({ ...tables, crm_sale_records: list }))
    assert.deepEqual(result.current.debt_ranking.items.map(row => row.customer_id), ['a', 'b', 'c'])
    assert.equal(result.current.debt_ranking.items[0].share_of_total, 0.25)
  }
  const empty = await readCurrentBrief(makeDb(fixture()))
  assert.deepEqual(empty.current.debt_ranking, { status: 'available', complete: true, issues: [],
    total_receivable: 0, positive_customer_count: 0, items: [] })
  const one = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale()] })))
  assert.equal(one.current.debt_ranking.items.length, 1); assert.equal(one.current.debt_ranking.items[0].share_of_total, 1)
})
test('a top debtor outside the first two source pages is ranked from the complete population', async () => {
  const tables = fixture({ crm_customers: Array.from({ length: 405 }, (_, i) => customer(`c${String(i).padStart(3, '0')}`)),
    crm_sale_records: Array.from({ length: 405 }, (_, i) => sale({ _id: `s${String(i).padStart(3, '0')}`, customer_id: `c${String(i).padStart(3, '0')}`,
      unit_price: i === 404 ? 999 : 1 })) })
  const result = await readCurrentBrief(makeDb(tables))
  assert.equal(result.current.debt_ranking.items[0].customer_id, 'c404')
  assert.equal(result.current.debt_ranking.total_receivable, 14030)
  assert.equal(result.current.debt_ranking.positive_customer_count, 405)
})
test('bad debt inputs suppress the whole ranking but preserve separately verified funds and pending work', async () => {
  const value = arrival('i', 'settlement', 100, 30)
  const db = makeDb(fixture({ crm_sale_records: [sale({ unit_price: null })], crm_cashier_intakes: [value.head], crm_customer_receipts: [value.receipt] }))
  const result = await readCurrentBrief(db)
  const evidence = unavailable(result)
  assert.equal(evidence.source, 'crm_sale_records'); assert.equal(evidence.source_id, 'sale-a'); assert.equal(evidence.field, 'unit_price')
  assert.equal(result.current.available_funds.complete, true); assert.equal(result.current.prepay, 30)
  assert.equal(result.pending.complete, true); assert.equal(result.pending.amount, 30)
  assert.equal(result.complete, false); assert.equal(result.current.complete, false); assert.deepEqual(db.writes, [])
})
test('an invalid unrelated prepayment does not hide a complete debt ranking or settlement pending amount', async () => {
  const value = arrival('i', 'settlement', 100, 30)
  const result = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale()], crm_cashier_intakes: [value.head],
    crm_customer_receipts: [value.receipt, receipt({ unallocated_amount: 81 })] })))
  unavailable(result, 'available_funds', 'receipt_balance_not_conserved')
  assert.equal(result.current.debt_ranking.complete, true); assert.equal(result.current.debt_ranking.items[0].amount, 100)
  assert.equal(result.pending.complete, true); assert.equal(result.pending.count, 1); assert.equal(result.pending.amount, 30)
})
test('pending settlement validation follows refund links to every contributing source', async () => {
  const value = arrival('i', 'settlement', 100, 60)
  value.receipt.allocated_amount = 20; value.receipt.cash_refunded_amount = 20
  const prepay = receipt({ amount: 100, unallocated_amount: 90, cash_refunded_amount: 10 })
  const refund = receipt({ _id: 'refund', source_type: 'customer_cash_refund', amount: -30, allocated_amount: 0, unallocated_amount: 0,
    refund_source_status: 'linked', refund_sources: [{ id: value.receipt._id, amount: 20 }, { id: prepay._id, amount: 10 }] })
  const tables = fixture({ crm_cashier_intakes: [value.head], crm_customer_receipts: [value.receipt, prepay, refund] })
  assert.equal((await readCurrentBrief(makeDb(tables))).pending.amount, 60)
  prepay.unallocated_amount = 91
  unavailable(await readCurrentBrief(makeDb(tables)), 'pending', 'receipt_balance_not_conserved')
})
test('source read errors invalidate only dependent domains and never become zero', async () => {
  const tables = fixture({ crm_sale_records: [sale()], crm_customer_receipts: [receipt()] })
  const brokenFunds = await readCurrentBrief(makeDb(tables, { get: (name, rows) => {
    if (name === 'crm_customer_receipts') throw Error('storage failure')
    return { data: structuredClone(rows) }
  } }))
  unavailable(brokenFunds, 'available_funds'); unavailable(brokenFunds, 'pending')
  assert.equal(brokenFunds.current.debt_ranking.complete, true); assert.equal(brokenFunds.current.receivable, 100)
  assert.equal(brokenFunds.source_counts.receipts, null)
  const brokenDebt = await readCurrentBrief(makeDb(tables, { count: (name, total) => ({ total: name === 'crm_customer_opening_debts' ? null : total }) }))
  unavailable(brokenDebt); assert.equal(brokenDebt.current.prepay, 80); assert.equal(brokenDebt.pending.count, 0)
  const brokenScope = await readCurrentBrief(makeDb(tables, { count: (name, total) => ({ total: name === 'crm_customers' ? null : total }) }))
  unavailable(brokenScope); unavailable(brokenScope, 'available_funds'); unavailable(brokenScope, 'pending')
  assert.equal(brokenScope.current.customer_count, null)
})
test('a changed receipt source leaves the complete debt domain usable but cannot supply funds or reminders', async () => {
  const tables = fixture({ crm_sale_records: [sale()], crm_customer_receipts: [receipt()] }); let changed = false
  const result = await readCurrentBrief(makeDb(tables, { get: (name, rows) => {
    if (!changed && name === 'crm_cashier_intakes') { changed = true; tables.crm_customer_receipts[0].updated_at = Date.now() + 20 }
    return { data: structuredClone(rows) }
  } }))
  assert.equal(result.current.debt.complete, true); assert.equal(result.current.receivable, 100)
  unavailable(result, 'available_funds'); unavailable(result, 'pending')
})
test('negative or excess allocations and excessive rounding cannot be hidden by snapshot clamping', async () => {
  for (const [patch, reason, field] of [
    [{ amount_received: -1 }, 'negative_source_allocation', 'amount_received'],
    [{ amount_received: 101 }, 'source_allocation_exceeds_principal', 'amount_received'],
    [{ amount_received: 99, receipt_rounding_amount: 2 }, 'receipt_rounding_exceeds_remaining', 'receipt_rounding_amount'],
    [{ rounding_amount: 101 }, 'source_rounding_exceeds_principal', 'rounding_amount']
  ]) {
    const result = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale(patch)] })))
    assert.equal(unavailable(result, 'debt', reason).field, field); assert.equal(result.current.prepay, 0)
  }
  unavailable(await readCurrentBrief(makeDb(fixture({ crm_customer_opening_debts: [debt({ rounding_amount: 99 })] }))), 'debt', 'source_rounding_exceeds_principal')
  unavailable(await readCurrentBrief(makeDb(fixture({ crm_customer_flow_settlements: [{ _id: 'f', customer_id: 'a', should_receive: 1,
    amount_received: 1.001, status: 'posted' }] }))), 'debt', 'source_allocation_exceeds_principal')
  const valid = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale(), sale({ _id: 'return', out_items: [], back_items: [{ net: 10 }] })] })))
  assert.equal(valid.current.receivable, 100); assert.equal(valid.current.debt_ranking.items[0].amount, 100)
})
test('real current handler accepts a legal partial negative-source refund without reducing positive debt', async () => {
  for (const kind of ['sales', 'flows']) {
    const returned = sale({ _id: 'returned', out_items: [], back_items: [{ net: 2 }], amount_received: -10 })
    const tables = fixture({ crm_sale_records: [sale()] })
    if (kind === 'sales') tables.crm_sale_records.push(returned)
    else tables.crm_customer_flow_settlements.push({ _id: 'negative-flow', customer_id: 'a',
      should_receive: -20, amount_received: -10, status: 'posted' })
    const before = structuredClone(tables), db = makeDb(tables)
    const result = await loadHandler('crm-dashboard', db)({ token: 'test', action: 'summaryV1', data: { section: 'current' } })
    assert.equal(result.code, 0); assert.equal(result.data.current.debt.complete, true, kind)
    assert.equal(result.data.current.receivable, 100); assert.equal(result.data.current.debt_ranking.items[0].amount, 100)
    assert.equal(result.data.current.debt_ranking.items[0].share_of_total, 1)
    assert.equal(result.data.read_complete, true); assert.equal(result.financial_evidence.read_complete, true)
    assert.deepEqual(tables, before); assert.ok(db.writes.every(write => write.name === 'crm_operation_logs'))
  }
})
test('negative-source refund bounds and rounding stay protected', async () => {
  const returned = patch => sale({ _id: 'returned', out_items: [], back_items: [{ net: 2 }], amount_received: -10, ...patch })
  for (const [patch, reason, field] of [
    [{ amount_received: -20.01 }, 'source_refund_exceeds_principal', 'amount_received'],
    [{ amount_received: 0.01 }, 'positive_allocation_on_negative_source', 'amount_received'],
    [{ receipt_rounding_amount: 0.01 }, 'receipt_rounding_on_negative_source', 'receipt_rounding_amount'],
    [{ rounding_amount: 20.01 }, 'source_rounding_exceeds_principal', 'rounding_amount'],
    [{ rounding_amount: 5, amount_received: -15.01 }, 'source_refund_exceeds_principal', 'amount_received']
  ]) {
    const result = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale(), returned(patch)] })))
    assert.equal(unavailable(result, 'debt', reason).field, field)
    assert.equal(result.current.available_funds.complete, true)
  }
  for (const patch of [{ amount_received: 0 }, { amount_received: -20 }, { rounding_amount: 5, amount_received: -15 }]) {
    const result = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale(), returned(patch)] })))
    assert.equal(result.current.debt.complete, true); assert.equal(result.current.receivable, 100)
  }
  for (const amount_received of [-0.01, 0.01]) unavailable(await readCurrentBrief(makeDb(fixture({
    crm_sale_records: [sale({ unit_price: 0, amount_received })]
  }))))
  // Opening-debt snapshots have no signed refund effective amount. Keep their
  // incompatible negative paid records unresolved instead of inventing refunds.
  unavailable(await readCurrentBrief(makeDb(fixture({ crm_customer_opening_debts: [
    debt({ amount: -20, amount_received: -10 })
  ] }))), 'debt', 'source_refund_exceeds_principal')
})
test('real handler reports changed hidden or unscoped records without leaking their identifiers', async () => {
  for (const scenario of ['hidden_customer', 'unknown_owner', 'visible_sale']) {
    const hiddenId = 'hidden-customer-private-id', unknownId = 'unresolved-customer-id', privateSaleId = 'unknown-owner-private-source'
    const tables = fixture({ crm_customers: [customer(), customer(hiddenId, { is_hidden: true, created_at: 1, updated_at: 1 })],
      crm_sale_records: [sale(), ...(scenario === 'unknown_owner' ? [sale({ _id: privateSaleId, customer_id: unknownId })] : [])] })
    let changed = false
    const db = makeDb(tables, { get: (name, rows) => {
      if (!changed && name === 'crm_customer_receipts') {
        changed = true
        const target = scenario === 'hidden_customer' ? tables.crm_customers[1] : tables.crm_sale_records[scenario === 'unknown_owner' ? 1 : 0]
        target.updated_at = Date.now() + 100
      }
      return { data: structuredClone(rows) }
    } })
    const response = await loadHandler('crm-dashboard', db)({ token: 'test', action: 'summaryV1', data: { section: 'current' } })
    assert.equal(response.code, 0); const issue = unavailable(response.data, 'debt', 'current_window_changed')
    assert.equal(issue.source_id, scenario === 'visible_sale' ? 'sale-a' : null)
    const serialized = JSON.stringify(response)
    for (const privateId of [hiddenId, unknownId, privateSaleId]) assert.equal(serialized.includes(privateId), false, scenario)
    assert.equal(response.data.read_complete, false); assert.equal(response.financial_evidence.read_complete, false)
    assert.ok(db.writes.every(write => write.name === 'crm_operation_logs'))
  }
})
test('top debtor access still requires both home and customer visibility permissions', async () => {
  for (const [home, customerView, expected] of [[true, false, 403], [false, true, 403], [true, true, 0]]) {
    const tables = fixture({ crm_sale_records: [sale()] })
    tables.crm_users = [{ _id: 'user', token: 'test', role: 'user', role_template: 'user', page_permissions: {
      '/pages/index/index': { view: home }, '/pages/customer/list': { view: customerView } } }]
    const reads = [], db = makeDb(tables, { get: (name, rows) => { if (name !== 'crm_users') reads.push(name); return { data: structuredClone(rows) } } })
    const result = await loadHandler('crm-dashboard', db)({ token: 'test', action: 'summaryV1', data: { section: 'current' } })
    assert.equal(result.code, expected)
    if (expected) { assert.deepEqual(reads, []); assert.equal(result.data?.current, undefined) }
    else assert.equal(result.data.current.debt_ranking.items[0].customer_id, 'a')
    assert.ok(db.writes.every(write => write.name === 'crm_operation_logs'))
  }
})

test('real handler isolates an entire bad debtor, reports every affected source, and never ranks a partial population', async () => {
  const tables = fixture({ crm_customers: [customer('a', { qr_code: 'K001' }), customer('b'), customer('idle', { is_active: false }),
    customer('delivery', { settlement_customer_id: 'b' }), customer('hidden', { is_hidden: true })],
    crm_sale_records: [sale({ _id: 'bad-price', unit_price: null }), sale({ _id: 'bad-allocation', amount_received: 101 }),
      sale({ _id: 'good-same-customer', unit_price: 999 }), sale({ _id: 'good-b', customer_id: 'b', delivery_customer_id: 'delivery' }),
      sale({ _id: 'hidden-source', customer_id: 'hidden', amount_received: null })] })
  const before = structuredClone(tables), db = makeDb(tables)
  const response = await loadHandler('crm-dashboard', db)({ token: 'test', action: 'summaryV1', data: { section: 'current' } })
  assert.equal(response.code, 0)
  const result = response.data, domain = result.current.debt
  assert.equal(result.current_version, 'operating-brief-current/2026-10-24.1')
  assert.equal(domain.status, 'partial'); assert.equal(domain.complete, false)
  assert.equal(domain.verified_subtotal, 100)
  assert.deepEqual(domain.coverage, { complete: true, total_customers: 3, verified_customers: 2, pending_customers: 1 })
  assert.equal(domain.issues_complete, true); assert.equal(domain.issue_count, 2)
  assert.deepEqual(domain.issues.map(row => row.source_id), ['bad-allocation', 'bad-price'])
  for (const issue of domain.issues) {
    assert.equal(issue.customer_id, 'a'); assert.equal(issue.customer_name, '合成a'); assert.equal(issue.customer_code, 'K001')
    assert.equal(issue.source_date, '2026-10-23'); assert.equal(issue.action, 'review_source')
  }
  assert.equal(result.current.receivable, null); assert.equal(result.current.debt_ranking.total_receivable, null)
  assert.equal(result.current.debt_ranking.complete, false); assert.deepEqual(result.current.debt_ranking.items, [])
  assert.equal(result.read_complete, true); assert.equal(response.financial_evidence.read_complete, true)
  assert.equal(result.current.available_funds.complete, true); assert.equal(result.pending.complete, true)
  assert.equal(JSON.stringify(domain).includes('hidden'), false)
  assert.deepEqual(tables, before); assert.ok(db.writes.every(write => write.name === 'crm_operation_logs'))
})

test('debt and available funds quarantine different customers and retain independent verified subtotals', async () => {
  const tables = fixture({ crm_customers: ['a', 'b', 'c'].map(id => customer(id)),
    crm_sale_records: [sale({ unit_price: null }), sale({ _id: 'b-sale', customer_id: 'b' }), sale({ _id: 'c-sale', customer_id: 'c', unit_price: 5 })],
    crm_customer_receipts: [receipt(), receipt({ _id: 'b-pending', customer_id: 'b', receipt_adjustment_status: 'pending' }),
      receipt({ _id: 'b-other-invalid', customer_id: 'b', unallocated_amount: 81 }),
      receipt({ _id: 'b-valid-but-excluded', customer_id: 'b' }), receipt({ _id: 'c-good', customer_id: 'c', amount: 10, unallocated_amount: 10 })] })
  const result = await readCurrentBrief(makeDb(tables))
  assert.equal(result.current.debt.verified_subtotal, 150)
  const funds = result.current.available_funds
  assert.equal(funds.verified_subtotal, 90); assert.equal(funds.status, 'partial')
  assert.deepEqual(funds.coverage, { complete: true, total_customers: 3, verified_customers: 2, pending_customers: 1 })
  assert.equal(funds.issue_count, 2); assert.equal(funds.issues_complete, true)
  assert.equal(funds.issues.find(row => row.source_id === 'b-pending').action, 'resume_receipt_adjustment')
  assert.equal(result.current.prepay, null); assert.equal(result.current.prepay_sources, null); assert.equal(result.current.offset_credit, null)
  assert.equal(result.pending.complete, true); assert.equal(result.pending.count, 0)
})

test('no verified customer is unknown, while an explicitly verified zero subtotal stays zero', async () => {
  const allBad = await readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale({ unit_price: null })] })))
  assert.equal(allBad.current.debt.status, 'unavailable'); assert.equal(allBad.current.debt.verified_subtotal, null)
  assert.deepEqual(allBad.current.debt.coverage, { complete: true, total_customers: 1, verified_customers: 0, pending_customers: 1 })
  const verifiedZero = await readCurrentBrief(makeDb(fixture({ crm_customers: [customer(), customer('zero')],
    crm_sale_records: [sale({ unit_price: null })] })))
  assert.equal(verifiedZero.current.debt.status, 'partial'); assert.equal(verifiedZero.current.debt.verified_subtotal, 0)
  assert.equal(verifiedZero.current.debt.coverage.verified_customers, 1)
  const none = await readCurrentBrief(makeDb(fixture({ crm_customers: [] })))
  assert.equal(none.current.debt.status, 'available'); assert.equal(none.current.debt.verified_subtotal, 0)
  assert.deepEqual(none.current.debt.coverage, { complete: true, total_customers: 0, verified_customers: 0, pending_customers: 0 })
  assert.deepEqual(none.current.prepay_sources, { manual_prepay: 0, receipt_unallocated: 0, opening_prepay: 0, deposit_transfer: 0, settlement_fee: 0 })
})

test('source read failure, ownership ambiguity, and read-window changes forbid even a partial debt claim', async () => {
  for (const scenario of ['read', 'unknown', 'delivery', 'changed']) {
    const tables = fixture({ crm_customers: [customer(), customer('b')], crm_sale_records: [sale(), sale({ _id: 'b-sale', customer_id: 'b' })] })
    if (scenario === 'unknown') tables.crm_sale_records.push(sale({ _id: 'unscoped-private-source', customer_id: 'unknown-private-id' }))
    if (scenario === 'delivery') tables.crm_sale_records[0].delivery_customer_id = 'b'
    let changed = false
    const result = await readCurrentBrief(makeDb(tables, { get: (name, rows) => {
      if (scenario === 'read' && name === 'crm_sale_records') throw Error('storage unavailable')
      if (scenario === 'changed' && !changed && name === 'crm_customer_receipts') {
        changed = true; tables.crm_sale_records[0].updated_at = Date.now() + 10
      }
      return { data: structuredClone(rows) }
    } }))
    const domain = result.current.debt
    assert.equal(domain.status, 'unavailable', scenario); assert.equal(domain.verified_subtotal, null)
    assert.deepEqual(domain.coverage, { complete: false, total_customers: null, verified_customers: null, pending_customers: null })
    assert.equal(domain.issues_complete, false); assert.equal(result.current.available_funds.complete, true)
    assert.deepEqual(result.current.debt_ranking.items, [])
    if (scenario === 'unknown') assert.equal(JSON.stringify(result).includes('private'), false)
  }
})

test('cross-customer or unowned funding links block the funding population before customer partitioning', async () => {
  for (const scenario of ['refund', 'intake', 'shared_legacy_source', 'missing_source']) {
    const tables = fixture({ crm_customers: [customer(), customer('b'), customer('good')],
      crm_sale_records: [sale()], crm_customer_receipts: [receipt(), receipt({ _id: 'good', customer_id: 'good' })] })
    if (scenario === 'refund' || scenario === 'missing_source') tables.crm_customer_receipts.push(receipt({ _id: 'refund-b', customer_id: 'b',
      source_type: 'customer_cash_refund', amount: -20, allocated_amount: 0, unallocated_amount: 0,
      refund_source_status: 'linked', refund_sources: [{ id: scenario === 'refund' ? 'receipt-a' : 'missing-private-source', amount: 20 }] }))
    if (scenario === 'intake') {
      const value = arrival('i', 'settlement', 100); value.receipt.customer_id = 'b'
      tables.crm_cashier_intakes.push(value.head); tables.crm_customer_receipts.push(value.receipt)
    }
    if (scenario === 'shared_legacy_source') tables.crm_customer_receipts.push(...['a', 'b'].map(id => receipt({ _id: `legacy-${id}`, customer_id: id,
      source_type: 'cashier_intake', source_id: 'same-legacy-source' })))
    const result = await readCurrentBrief(makeDb(tables)), funds = result.current.available_funds
    assert.equal(funds.status, 'unavailable', scenario); assert.equal(funds.coverage.complete, false, scenario)
    assert.equal(funds.verified_subtotal, null); assert.equal(funds.issues_complete, false)
    assert.equal(funds.issues[0].reason, 'fund_source_scope_unresolved')
    assert.equal(result.current.debt.complete, true); assert.equal(result.current.receivable, 100)
    assert.equal(JSON.stringify(result).includes('missing-private-source'), false)
  }
})

test('a malformed refund within one known customer excludes that whole customer, not independent customers', async () => {
  const source = receipt({ amount: 100, allocated_amount: 30, unallocated_amount: 50, cash_refunded_amount: 20 })
  const refund = receipt({ _id: 'refund', source_type: 'customer_cash_refund', amount: -20, allocated_amount: 0, unallocated_amount: 0,
    refund_source_status: 'linked', refund_sources: [{ id: source._id, amount: 19 }] })
  const result = await readCurrentBrief(makeDb(fixture({ crm_customers: [customer(), customer('b')],
    crm_customer_receipts: [source, refund, receipt({ _id: 'good-a' }), receipt({ _id: 'good-b', customer_id: 'b' })] })))
  assert.equal(result.current.available_funds.status, 'partial'); assert.equal(result.current.available_funds.verified_subtotal, 80)
  assert.equal(result.current.available_funds.coverage.pending_customers, 1)
  assert.equal(result.current.available_funds.issues_complete, true)
  assert.deepEqual(result.current.available_funds.issues.map(row => row.source_id), ['receipt-a', 'refund'])
})

test('mixed legacy gas and remarked fees remain unresolved without capping money or inferring rounding', async () => {
  const source = sale({ unit_price: 5.3, biz_mode: 'agent_sale', agent_sale_items: [{ fill_weight: 1279 }],
    amount_received: 33278, rounding_amount: 0, remark: '检测费25000元，遇冷费1500元' })
  const tables = fixture({ crm_customers: [customer(), customer('b')], crm_sale_records: [source, sale({ _id: 'b-sale', customer_id: 'b' })] })
  const before = structuredClone(tables), db = makeDb(tables), result = await readCurrentBrief(db)
  assert.equal(snapshots.computeSaleSnapshot(source).should_receive, 6778.7)
  assert.equal(result.current.debt.status, 'partial'); assert.equal(result.current.debt.verified_subtotal, 100)
  assert.equal(result.current.debt.issues[0].reason, 'source_allocation_exceeds_principal')
  assert.match(result.current.debt.issues[0].message, /应收与已收口径/)
  assert.deepEqual(tables, before); assert.deepEqual(db.writes, [])
})

test('raw sales and opening debt precision must survive the canonical scale before a customer is verified', async () => {
  for (const kind of ['sale', 'debt']) for (const field of ['amount_received', 'rounding_amount', 'receipt_rounding_amount', ...(kind === 'debt' ? ['amount'] : [])]) {
    const tables = fixture({ crm_customers: [customer(), customer('b')], crm_sale_records: [sale({ _id: 'good-b', customer_id: 'b' })] })
    if (kind === 'sale') tables.crm_sale_records.push(sale({ [field]: 0.001 }))
    else tables.crm_customer_opening_debts.push(debt({ [field]: 0.001 }))
    const before = structuredClone(tables), result = await readCurrentBrief(makeDb(tables))
    assert.equal(result.current.debt.status, 'partial', `${kind}.${field}`)
    assert.equal(result.current.debt.verified_subtotal, 100)
    assert.equal(result.current.debt.coverage.pending_customers, 1)
    assert.equal(result.current.debt.issues[0].reason, 'invalid_source_precision')
    assert.equal(result.current.debt.issues[0].field, field)
    assert.equal(result.current.receivable, null); assert.deepEqual(result.current.debt_ranking.items, [])
    assert.deepEqual(tables, before)
  }
  for (const custom of [{ money_scale: 3 }, { customer: { default_price_unit: 'm3' } }]) {
    const { customer: customerPatch, ...sourcePatch } = custom
    const result = await readCurrentBrief(makeDb(fixture({ crm_customers: [customer('a', customerPatch)],
      crm_customer_opening_debts: [debt({ amount: 0.028, amount_received: 0.018, receipt_rounding_amount: 0.002, ...sourcePatch })] })))
    assert.equal(result.current.debt.complete, true); assert.equal(result.current.debt.verified_subtotal, 0.008)
  }
})
