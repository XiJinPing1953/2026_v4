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
const bad = reason => error => error.code === 'FINANCIAL_READ_INCOMPLETE' && (!reason || error.details.reason === reason)

test('empty sources return verified zero and never persist customer caches', async () => {
  const db = makeDb(fixture()), result = await readCurrentBrief(db, { now: 123 })
  assert.equal(result.current.receivable, 0); assert.equal(result.current.prepay, 0)
  assert.equal(result.current.customer_count, 1); assert.deepEqual(result.pending, { count: 0, amount: 0, complete: true })
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
  assert.deepEqual(result.pending, { count: 1, amount: 30, complete: true }); assert.equal(result.current.prepay, 280)
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
    mutate(tables); await assert.rejects(readCurrentBrief(makeDb(tables)), bad())
  }
})
test('posted refund is counted once through source availability, with linked backing verified', async () => {
  const source = receipt({ amount: 100, allocated_amount: 30, unallocated_amount: 50, cash_refunded_amount: 20 })
  const refund = receipt({ _id: 'refund', source_type: 'customer_cash_refund', amount: -20, allocated_amount: 0, unallocated_amount: 0,
    refund_source_status: 'linked', refund_sources: [{ id: source._id, amount: 20 }] })
  const tables = fixture({ crm_customer_receipts: [source, refund] })
  assert.equal((await readCurrentBrief(makeDb(tables))).current.prepay, 50)
  refund.refund_sources[0].amount = 19
  await assert.rejects(readCurrentBrief(makeDb(tables)), bad('refund_amount_mismatch'))
})
test('unfinished receipt/refund, broken conservation and missing backing refuse a usable balance', async () => {
  for (const patch of [{ receipt_adjustment_status: 'pending' }, { refund_source_status: 'pending' },
    { unallocated_amount: 81 }, { amount: 100, unallocated_amount: 80, cash_refunded_amount: 20 },
    { allocated_amount: null }, { unallocated_amount: true }, { amount: '' }, { unallocated_amount: 0.0001 }])
    await assert.rejects(readCurrentBrief(makeDb(fixture({ crm_customer_receipts: [receipt(patch)] }))), bad())
})
test('unresolved historical m3 and missing principal/quantity do not turn into zero', async () => {
  await assert.rejects(readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale({ price_unit: 'm3', settlement_mode: undefined })] }))),
    error => error.code === 'FINANCIAL_CLASSIFICATION_REQUIRED')
  for (const patch of [{ unit_price: null }, { out_items: null, back_items: null }, { amount_received: undefined }, { rounding_amount: true }])
    await assert.rejects(readCurrentBrief(makeDb(fixture({ crm_sale_records: [sale(patch)] }))), bad())
  await assert.rejects(readCurrentBrief(makeDb(fixture({ crm_customer_opening_debts: [debt({ amount: null })] }))), bad())
})
test('ambiguous settlement scope and source ownership are rejected, without moving facts', async () => {
  for (const tables of [
    fixture({ crm_customers: [customer('a', { settlement_customer_id: 'missing' })] }),
    fixture({ crm_customers: [customer('a', { settlement_customer_id: 'b' }), customer('b', { settlement_customer_id: 'a' })] }),
    fixture({ crm_customers: [customer(), customer('d', { settlement_customer_id: 'a' })], crm_sale_records: [sale({ customer_id: 'd' })] }),
    fixture({ crm_sale_records: [sale({ customer_id: 'missing' })] }),
    fixture({ crm_customers: [customer(), customer('b')], crm_sale_records: [sale({ delivery_customer_id: 'b' })] })
  ]) {
    const db = makeDb(tables); await assert.rejects(readCurrentBrief(db), bad()); assert.deepEqual(db.writes, [])
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
  await assert.rejects(readCurrentBrief(makeDb(tables, { get: (name, rows) => ({ data: structuredClone(name === 'crm_sale_records' ? rows.slice(0, 20) : rows) }) })), bad())
  for (const total of [null, false, '', -1, 1.5]) await assert.rejects(readCurrentBrief(makeDb(tables, {
    count: (name, value) => ({ total: name === 'crm_sale_records' ? total : value })
  })), bad())
})
test('outer request detects a collection changing after its individual read completed', async () => {
  const tables = fixture({ crm_sale_records: [sale()] }); let changed = false
  const db = makeDb(tables, { get: (name, rows) => {
    if (!changed && name === 'crm_customer_receipts') { changed = true; tables.crm_sale_records[0].updated_at = Date.now() + 10 }
    return { data: structuredClone(rows) }
  } })
  await assert.rejects(readCurrentBrief(db), bad('current_window_changed'))
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
