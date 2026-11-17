'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
const { loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const { priceSnapshot, buildPricePlan } = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/priceCorrection')
const cid = 'a'.repeat(24)
function fixture() {
  const sale = { _id: 'positive', customer_id: cid, date: '2026-11-07', price_unit: 'kg', unit_price: 8.5, settlement_mode: 'sale', biz_mode: 'bottle', out_items: [{ net: 60 }], back_items: [{ net: -4 }], amount_received: 544, payment_method: 'on_account', payment_status: 'paid', rounding_amount: 0 }
  const negative = { ...sale, _id: 'negative', date: '2026-11-10', out_items: [], back_items: [{ net: 80 }], amount_received: 0, payment_method: 'cash', offset_enabled: true }
  const tables = { crm_users: [{ _id: 'actor', token: 'test', role: 'superadmin' }], crm_operation_logs: [], crm_customers: [{ _id: cid, name: 'Synthetic', is_active: true, default_price_unit: 'kg', default_unit_price: 8.5, should_receive_total: -136, receivable_balance: 0, prepay_balance: 680, offset_credit_balance: 680, net_balance: -680 }], crm_sale_records: [sale, negative],
    crm_customer_receipts: [{ _id: 'receipt', customer_id: cid, status: 'posted', entry_kind: 'prepay', source_type: 'cashier_intake', amount: 544, allocated_amount: 544, unallocated_amount: 0 }, { _id: 'credit', customer_id: cid, status: 'posted', entry_kind: 'offset_credit', source_type: 'sale_offset_credit', source_id: 'negative', biz_date: negative.date, amount: 680, allocated_amount: 0, unallocated_amount: 680 }],
    crm_customer_allocations: [{ _id: 'allocation', customer_id: cid, receipt_id: 'receipt', target_type: 'sale', target_id: 'positive', allocate_kind: 'receipt', allocate_amount: 544 }],
    crm_customer_flow_settlements: [], crm_customer_opening_debts: [], crm_customer_receipt_adjustments: [], crm_customer_deposit_accounts: [], crm_customer_deposit_entries: [], crm_collection_tasks: [], crm_collection_followups: [], crm_cashier_intakes: [], crm_web_sale_operations: [], crm_mobile_sale_operations: [], crm_periods: [], crm_vouchers: [], crm_voucher_entries: [] }
  for (const s of tables.crm_sale_records) {
    const amount = s._id === 'positive' ? 544 : 680, positive = s._id === 'positive', v = 'voucher-' + s._id
    tables.crm_vouchers.push({ _id: v, source: 'sale:' + s._id, status: 'draft', date: s.date, period: '2026-11', total_debit: amount, total_credit: amount })
    for (const code of ['1122', '6001']) tables.crm_voucher_entries.push({ _id: v + code, voucher_id: v, account_code: code, direction: (code === '1122') === positive ? 'debit' : 'credit', amount, aux: { customer_id: cid, source_id: s._id } })
  }
  return { tables, request: { customer_id: cid, operation_id: 'test-price-20261117', expected_default_unit_price: 8.5, unit_price: 9, sales: tables.crm_sale_records.map(s => ({ sale_id: s._id, date: s.date, expected_unit_price: 8.5 })), evidence: { confirmed_by_user: true, approval_sha256: '1'.repeat(64), source_sha256: '2'.repeat(64) } } }
}
test('正负销售原现金、抹零与分配保留；权限、原值冲突、事务回滚和重复提交', async () => {
  const { tables, request } = fixture(), db = mutableDb(tables), handler = loadHandler('crm-accounting-correction', db)
  assert.equal((await handler({ action: 'inspectPriceV1', data: request })).code, 403)
  let r = await invoke(handler, 'inspectPriceV1', request); assert.equal(r.code, 0, r.msg); request.expected_snapshot_hash = r.data.snapshot_hash
  r = await invoke(handler, 'preparePriceV1', request); assert.equal(r.code, 0, r.msg); assert.equal(r.data.summary.net_receivable_delta, -8)
  const args = { customer_id: cid, operation_id: request.operation_id, plan_hash: r.data.plan_hash }
  assert.equal((await invoke(handler, 'executePriceV1', args)).code, 409)
  tables.crm_sale_records[0].unit_price = 8.6; assert.equal((await invoke(handler, 'rehearsePriceV1', args)).code, 409); tables.crm_sale_records[0].unit_price = 8.5
  r = await invoke(handler, 'rehearsePriceV1', { ...args, fail_after_writes: 3 }); assert.equal(r.data.status, 'interruption_rolled_back')
  r = await invoke(handler, 'rehearsePriceV1', args); assert.equal(r.code, 0, r.msg); assert.equal(r.data.snapshot_unchanged, true)
  r = await invoke(handler, 'executePriceV1', args); assert.equal(r.code, 0, r.msg); assert.equal(r.data.status, 'committed')
  assert.equal(tables.crm_sale_records[0].payment_status, 'partial'); assert.equal(tables.crm_sale_records[0].amount_received, 544)
  assert.equal(tables.crm_customer_allocations[0].allocate_amount, 544); assert.equal(tables.crm_customer_receipts[1].unallocated_amount, 720)
  assert.equal(tables.crm_customers[0].net_balance, -688); assert.equal(tables.crm_customers[0].default_unit_price, 9)
  const after = await priceSnapshot(db, cid); assert.equal(after.snapshot_hash, r.data.after_snapshot_hash)
  assert.equal((await invoke(handler, 'executePriceV1', args)).data.idempotent, true)
  assert.equal((await invoke(handler, 'preparePriceV1', { ...request, unit_price: 10 })).code, 409)
})
test('关联、凭证、期间与原值反例拒绝修改', async () => {
  const mutations = [t => t.crm_customer_receipts[1].allocated_amount = 1, t => t.crm_customer_receipts[1].cash_refunded_amount = 1,
    t => t.crm_customer_allocations[0].allocate_amount = 543, t => t.crm_vouchers[0].status = 'posted', t => t.crm_voucher_entries[0].amount = 543,
    t => t.crm_sale_records[0].offset_sync_revision = 'unfinished', t => t.crm_sale_records[0].web_save_operation_key = 'missing',
    t => t.crm_periods.push({ _id: 'closed', period: '2026-11', status: 'closed' }), t => t.crm_sale_records[0].date = '2026-07-31',
    t => t.crm_customer_receipts.push({ _id: 'refund', customer_id: cid, status: 'posted', source_type: 'customer_cash_refund', refund_sources: [{ id: 'credit' }] })]
  for (const mutate of mutations) {
    const { tables, request } = fixture(); mutate(tables); const before = await priceSnapshot(mutableDb(tables), cid); request.expected_snapshot_hash = before.snapshot_hash
    assert.throws(() => buildPricePlan(before, request, { _id: 'actor' }, Date.now()))
  }
})
test('不同客户反向分配及退款不被遗漏', async () => {
  for (const kind of ['allocation', 'refund']) {
    const { tables } = fixture()
    if (kind === 'allocation') tables.crm_customer_allocations.push({ _id: 'foreign', customer_id: 'b'.repeat(24), target_id: 'positive' })
    else tables.crm_customer_receipts.push({ _id: 'foreign', customer_id: 'b'.repeat(24), source_type: 'customer_cash_refund', refund_sources: [{ id: 'credit' }] })
    await assert.rejects(priceSnapshot(mutableDb(tables), cid), /反向关联|跨户退款/)
  }
})
test('仅平台确认不存在的旧账期集合可缺省，其他读取错误必须停止', async () => {
  for (const message of ['not found collection', 'network timeout']) {
    const { tables } = fixture(), db = mutableDb(tables), collection = db.collection
    db.collection = name => { if (name === 'crm_periods') throw Error(message); return collection(name) }
    if (message === 'not found collection') assert.ok((await priceSnapshot(db, cid)).absent_collections.includes('crm_periods'))
    else await assert.rejects(priceSnapshot(db, cid), /network timeout/)
  }
})
