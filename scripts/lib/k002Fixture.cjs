'use strict'
const { TABLES, snapshotHash, digest, SPEC, CUSTOMER_ID } = require('../../uniCloud-alipay/cloudfunctions/crm-k002-reconciliation/plan')
function fixture() {
  const customer = { _id: CUSTOMER_ID, name: '保定灰鲸酒店', is_active: false, default_price_unit: 'kg',
    should_receive_total: 9670, amount_received_total: 9670, receivable_balance: 0, prepay_balance: 0,
    receipt_unallocated_balance: 0, offset_credit_balance: 0, net_balance: 0, updated_at: 8 }
  const base = { customer_id: CUSTOMER_ID, customer_name: customer.name }
  const sales = SPEC.sales.map(([id, date, amount], index) => ({ ...base, _id: id, date, price_unit: 'kg', unit_price: 10,
    settlement_mode: 'sale', amount_received: amount > 0 ? amount : 0, payment_status: 'paid', updated_at: index + 1,
    out_items: amount > 0 ? [{ net: amount / 10, tare: 100, gross: 100 + amount / 10 }] : [],
    back_items: amount < 0 ? [{ net: Math.abs(amount / 10), tare: 100, gross: 100 + Math.abs(amount / 10) }] : [],
    remark: index === 2 ? '2月2日退液款1260元扣瓶租270元后退款990元' : '' }))
  const receipts = [{ ...base, _id: 'offset-1260', source_id: sales[2]._id, biz_date: '2026-01-31', amount: 1260, status: 'posted', entry_kind: 'offset_credit', source_type: 'sale_offset_credit', allocated_amount: 1260, unallocated_amount: 0, rounding_allocated_amount: 0, offset_cash_refunded_amount: 0, updated_at: 1 }]
  const oldFee = { ...base, _id: 'old-other-fee', biz_date: '2026-02-02', debt_date: '2026-02-02', entry_type: 'other_fee',
    source_type: 'customer_other_fee_manual', amount: 1260, should_receive: 1260, amount_received: 1260, status: 'posted', updated_at: 3 }
  const allocations = [
    ['old-c', receipts[0], 'other_fee', oldFee, 1260]
  ].map(([id, receipt, type, target, amount]) => ({ ...base, _id: id, receipt_id: receipt._id, target_type: type,
    target_id: target._id, sale_id: type === 'sale' ? target._id : '', opening_debt_id: type === 'other_fee' ? target._id : '',
    allocate_kind: 'receipt', allocate_amount: amount, biz_date: receipt.biz_date, status: 'posted' }))
  return { crm_users: [{ _id: 'sa', token: 'test', role: 'superadmin', username: 'sa' }], crm_operation_logs: [],
    crm_customers: [customer], crm_sale_records: sales, crm_customer_receipts: receipts, crm_customer_allocations: allocations,
    crm_customer_flow_settlements: [], crm_customer_opening_debts: [oldFee], crm_customer_receipt_adjustments: [],
    crm_collection_tasks: [], crm_collection_followups: [] }
}
function snapshot(tables) {
  const scoped = Object.fromEntries(TABLES.map(name => [name, structuredClone(tables[name] || [])]))
  return { customer_id: CUSTOMER_ID, tables: scoped, complete: true, atomic_snapshot: false, absent_collections: [], snapshot_hash: snapshotHash(scoped) }
}
function evidence(tables) { const s = snapshot(tables); return { confirmed_by_user: true, customer_id: CUSTOMER_ID,
  source_snapshot_hash: s.snapshot_hash, approval_sha256: digest('user-approved-k002-controls'), source_commit: 'd5e1100000000000000000000000000000000000' } }
module.exports = { fixture, snapshot, evidence }
