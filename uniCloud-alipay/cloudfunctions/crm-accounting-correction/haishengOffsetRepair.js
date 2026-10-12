'use strict'
// One confirmed incident; this is not an arbitrary balance/receipt editing API.
module.exports = ({ t, request, allocations, patch, add, fen, assert, computeSaleAmountsForDoc }) => {
  const ids = {
    customer: '69d73d2087d884262d90eb9f', august: '6a80078e5d732f70fc7fe4dc',
    september: '6aaf79b05ece8f08a45a9e5b', returned: '6aaf7a03cc54bda3f68090e4',
    augustCash: '369453ce1997b698c2a66e2e', septemberCash: 'c6069717d1100a111550ee91',
    offset: '6aaf7a0ff2fa6c299e05fe1e', augustAllocation: '6ac739512550b2f5660a60a2'
  }
  assert(request.customer_id === ids.customer && request.operation_id === 'haisheng-offset-375-20261012-v1', '仅限已确认海圣固定批次')
  assert(request.corrections.length === 1 && Object.keys(request.corrections[0]).length === 1, '固定修复不接受金额或任意字段补丁')
  assert(!t.crm_customer_receipts.some(r => r.receipt_adjustment_status === 'pending'), '存在未完成的收款调整')
  const one = (table, id) => {
    const rows = t[table].filter(r => r._id === id)
    assert(rows.length === 1 && rows[0].customer_id === ids.customer, '修复原单缺失或客户不符')
    return rows[0]
  }
  const sale = id => one('crm_sale_records', id), receipt = id => one('crm_customer_receipts', id)
  const august = sale(ids.august), september = sale(ids.september), returned = sale(ids.returned)
  const cash = receipt(ids.augustCash), septemberCash = receipt(ids.septemberCash), offset = receipt(ids.offset)
  const target = a => a.target_id || a.sale_id
  const kind = a => a.allocate_kind || 'receipt'
  const money = (row, values) => Object.entries(values).forEach(([k, v]) => assert(fen(row[k]) === fen(v), '原金额已变化：' + k))
  for (const row of [august, september, returned]) assert(row.price_unit === 'kg' && row.settlement_mode === 'sale', '源单计价或归属已变化')
  assert(august.date === '2026-08-15' && september.date === '2026-09-20' && returned.date === '2026-09-20', '销售日期已变化')
  money(august, { amount_received: 2707.5, receipt_rounding_amount: 0, rounding_amount: 0 })
  money(september, { amount_received: 2107.5, receipt_rounding_amount: 4.5, rounding_amount: 0 })
  money(returned, { amount_received: 0, receipt_rounding_amount: 0, rounding_amount: 0 })
  for (const [row, amount] of [[august, 2707.5], [september, 2112], [returned, -37.5]])
    assert(fen(computeSaleAmountsForDoc(row).amounts.should_receive) === fen(amount), '销售应收依据变化')
  assert(returned.offset_enabled === true && returned.back_items.some(x => x.bottle_no === '217' && Number(x.net) === 5) && Number(returned.unit_price) === 7.5, '退气原始依据不符')
  for (const row of [cash, septemberCash, offset]) {
    assert(row.status === 'posted', '收款状态已变化')
    assert(!row.cash_refunded_amount && !row.offset_cash_refunded_amount && !row.refund_sources?.length, '来源存在退款关联')
  }
  assert(!t.crm_customer_receipts.some(r => r.status === 'posted' && r.refund_sources?.some(x => [ids.offset, ids.augustCash].includes(x.id || x.receipt_id))), '存在关联退款')
  assert(cash.source_type === 'cashier_intake' && cash.entry_kind === 'prepay' && cash.biz_date === '2026-08-15', '原现金来源不符')
  money(cash, { amount: 2700, allocated_amount: 2670, unallocated_amount: 30, rounding_amount: 0, rounding_allocated_amount: 0 })
  assert(septemberCash.source_type === 'cashier_intake' && septemberCash.biz_date === '2026-09-20', '九月现金来源不符')
  money(septemberCash, { amount: 2070, allocated_amount: 2070, unallocated_amount: 0, rounding_amount: 4.5, rounding_allocated_amount: 4.5 })
  assert(offset.source_type === 'manual' && offset.entry_kind === 'prepay' && !offset.biz_date && !offset.source_id, '被清空的退气来源已变化')
  money(offset, { amount: 0, allocated_amount: 0, unallocated_amount: 0, rounding_amount: 0, rounding_allocated_amount: 0 })
  assert(!t.crm_customer_receipts.some(r => r._id !== ids.offset && r.status === 'posted' && r.source_id === ids.returned), '退气已有另一来源，禁止重复恢复')
  assert(!allocations.some(a => a.receipt_id === ids.offset), '退气已有分配，禁止重复背书')
  const augustRows = allocations.filter(a => target(a) === ids.august || a.receipt_id === ids.augustCash)
  assert(augustRows.length === 1 && augustRows[0]._id === ids.augustAllocation && augustRows[0].receipt_id === ids.augustCash && target(augustRows[0]) === ids.august && kind(augustRows[0]) === 'receipt', '八月分配范围变化')
  money(augustRows[0], { allocate_amount: 2670 })
  const septemberRows = allocations.filter(a => target(a) === ids.september || a.receipt_id === ids.septemberCash)
  assert(septemberRows.length === 2 && septemberRows.every(a => a.receipt_id === ids.septemberCash && target(a) === ids.september), '九月分配范围变化')
  for (const [k, n] of [['receipt', 2070], ['rounding', 4.5]]) {
    const rows = septemberRows.filter(a => kind(a) === k)
    assert(rows.length === 1 && fen(rows[0].allocate_amount) === fen(n), '九月现金或抹零分配变化')
  }
  const common = (r, s, receiptSource, entryKind) => ({ receipt_id: r._id, target_type: 'sale', target_id: s._id,
    sale_id: s._id, sale_date: s.date, target_title: '销售单 ' + s.date, biz_date: s.date, receipt_biz_date: s.date,
    source_type: receiptSource === 'sale_offset_credit' ? 'sale_offset_credit_manual' : 'receipt_unallocated_allocate', source_id: r._id,
    receipt_source_type: receiptSource, receipt_entry_kind: entryKind, allocation_mode: 'checked',
    allocation_targets: [{ target_type: 'sale', target_id: s._id }], note: '按已确认原始依据恢复分配，不新增实际到账' })
  patch('crm_sale_records', august, { amount_received: 2700, receipt_rounding_amount: 7.5, payment_status: 'paid' })
  patch('crm_customer_receipts', cash, { allocated_amount: 2700, unallocated_amount: 0, rounding_amount: 7.5, rounding_allocated_amount: 7.5 })
  patch('crm_customer_allocations', augustRows[0], { allocate_amount: 2700 })
  add('haisheng-august-rounding', { ...common(cash, august, 'cashier_intake', 'prepay'), allocate_kind: 'rounding', allocate_amount: 7.5 })
  patch('crm_customer_receipts', offset, { amount: 37.5, allocated_amount: 37.5, unallocated_amount: 0,
    biz_date: '2026-09-20', source_type: 'sale_offset_credit', source_id: ids.returned, entry_kind: 'offset_credit',
    allocation_mode: 'checked', allocation_start_date: '', allocation_end_date: '',
    allocation_targets: [{ target_type: 'sale', target_id: ids.september }], note: '销售单2026-09-20退气37.50元冲抵（恢复原来源）' })
  add('haisheng-september-offset', { ...common(offset, september, 'sale_offset_credit', 'offset_credit'), allocate_kind: 'receipt', allocate_amount: 37.5 })
  const customer = t.crm_customers[0]
  // Both affected targets remain settled. Only the false available cash balance (30)
  // and the two unsupported direct-received residuals (75) leave the cached totals.
  patch('crm_customers', customer, {
    prepay_balance: (fen(customer.prepay_balance) - 3000) / 100,
    receipt_unallocated_balance: (fen(customer.receipt_unallocated_balance) - 3000) / 100,
    net_balance: (fen(customer.net_balance) + 3000) / 100,
    amount_received_total: (fen(customer.amount_received_total) - 7500) / 100
  })
  return { restored_offset: 37.5, removed_unbacked_received: 75, rounding_added: 7.5, cash_amount_changed: 0, new_receipts: 0 }
}
