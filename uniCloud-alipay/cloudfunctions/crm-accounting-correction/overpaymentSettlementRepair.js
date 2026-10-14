'use strict'

// Reclassify one confirmed excess payment that was recorded as a fee. The
// compiler accepts business identifiers and amounts, never arbitrary patches.
const { digest } = require('./snapshot')
module.exports = ({ t, request, allocations, patch, add, fen, assert, computeSaleAmountsForDoc, actor, now }) => {
  const active = row => row && (!row.status || row.status === 'posted')
  const target = row => row.target_id || row.sale_id
  const kind = row => row.allocate_kind || 'receipt'
  const cid = request.customer_id
  assert(actor?._id && Number.isSafeInteger(now) && now > 0, '执行人及修正时间缺失')
  const change = request.corrections[0]
  const allowed = new Set(['type', 'receipt_id', 'fee_id', 'discount_sale_id', 'settlement_date',
    'settlement_amount', 'rounding_amount', 'expected_pending_adjustment_id'])
  assert(request.corrections.length === 1 && change.type === 'reclassify_overpayment_settlement' &&
    Object.keys(change).every(key => allowed.has(key)), '本次仅支持一笔已确认多收款重分类')
  const money = (value, label) => {
    assert(['number', 'string'].includes(typeof value) && String(value).trim() !== '', label + '缺少明确原值')
    const result = fen(value)
    assert(result >= 0, label + '不能为负')
    return result
  }
  const date = (value, label) => {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value, label + '无效')
    return value
  }
  const one = (table, id) => {
    const rows = t[table].filter(row => row._id === id)
    assert(rows.length === 1 && rows[0].customer_id === cid && active(rows[0]), '原单不存在、客户或状态不符')
    return rows[0]
  }
  const receipt = one('crm_customer_receipts', change.receipt_id)
  const fee = one('crm_customer_opening_debts', change.fee_id)
  const sale = one('crm_sale_records', change.discount_sale_id)
  const settlement = money(change.settlement_amount, '结清金额'), rounding = money(change.rounding_amount, '优惠金额')
  assert(settlement > 0 && rounding > 0 && rounding < settlement, '结清及优惠须为正数且优惠小于结清金额')
  assert(receipt.status === 'posted' && ['cashier_intake', 'customer_statement', 'manual', 'legacy_received_confirmation'].includes(receipt.source_type) &&
    receipt.entry_kind === 'prepay' && money(receipt.amount, '收款金额') > settlement, '仅支持明确的普通现金收款来源')
  const receiptDate = date(receipt.biz_date, '原到账日期'), settlementDate = date(change.settlement_date, '结清日期')
  assert(settlementDate >= receiptDate, '结清日期不能早于原到账日期')
  const intakes = (t.crm_cashier_intakes || []).filter(row => row.receipt_id === receipt._id || row._id === receipt.intake_id)
  if (receipt.intake_id || intakes.length) {
    assert(intakes.length === 1, '出纳到账主记录缺失或重复')
    const intake = intakes[0]
    assert(intake.customer_id === cid && intake.status === 'posted' && intake.receipt_id === receipt._id &&
      (!receipt.intake_id || intake._id === receipt.intake_id) && money(intake.gas_amount, '到账气款') === money(receipt.amount, '原收款') &&
      money(intake.amount, '到账合计') === money(intake.gas_amount, '到账气款') + money(intake.deposit_amount, '到账押金') &&
      intake.biz_date === receiptDate && intake.payment_method === receipt.payment_method, '出纳到账主记录与原收款金额、日期或渠道不一致')
  }
  assert(fee.status === 'posted' && String(fee.source_type).includes('other_fee') &&
    money(fee.amount, '旧费用金额') === settlement && money(fee.rounding_amount ?? 0, '旧费用自身优惠') === 0 &&
    money(fee.outstanding, '旧费用余额') === 0, '旧费用须恰好为已结清的确认多收金额')
  assert(date(fee.biz_date, '旧费用日期') <= receiptDate, '旧费用晚于原到账，不能自动重分类')
  assert(!t.crm_customer_receipt_adjustments.some(row => row.status === 'pending'), '存在未完成的旧收款调整')
  assert(!t.crm_customer_receipts.some(row => row._id !== receipt._id && row.receipt_adjustment_status === 'pending'), '客户另有未完成的收款调整')
  const pendingId = String(change.expected_pending_adjustment_id || '')
  if (receipt.receipt_adjustment_status === 'pending') {
    assert(pendingId && receipt.receipt_adjustment_id === pendingId && receipt.receipt_adjustment_snapshot === null &&
      receipt.receipt_adjustment_rollback_strategy === 'deferred' && Number(receipt.receipt_adjustment_started_at) > 0,
    '仅允许明确原编号、未物理释放且快照缺失的待调整状态随本次方案完成')
  } else assert(!pendingId && !receipt.receipt_adjustment_status, '原调整状态或预期编号已变化')
  const affected = new Set([receipt._id, fee._id, sale._id])
  assert(!(t.crm_vouchers || []).some(row => !['void', 'cancelled'].includes(row.status) &&
    [row.source, row.source_key, row.source_id, row.receipt_id, row.sale_id].some(value => typeof value === 'string' &&
      [...affected].some(id => value === id || value.endsWith(':' + id)))), '相关原单已有有效CRM凭证，须另行处理凭证联动')
  for (const row of t.crm_customer_receipts.filter(active)) {
    const references = (row.refund_sources || []).map(link => link.id || link.receipt_id || link.source_id)
    assert(!(row._id === receipt._id && (money(row.cash_refunded_amount ?? 0, '来源已退款') ||
      money(row.offset_cash_refunded_amount ?? 0, '来源抵款退款') || references.length || row.refund_source_status === 'pending')) &&
      !references.some(id => affected.has(id)) &&
      !(affected.has(row.source_id) && (row.source_type === 'customer_cash_refund' || row.entry_kind === 'refund')),
    '原来源存在退款关联，不能重分类')
  }
  const own = allocations.filter(row => row.receipt_id === receipt._id)
  assert(own.length && own.every(row => row.customer_id === cid && ['receipt', 'rounding'].includes(kind(row)) &&
    money(row.allocate_amount, '原分配金额') > 0), '本笔存在未知或无效分配')
  const sum = (rows, which) => rows.filter(row => kind(row) === which).reduce((total, row) => total + money(row.allocate_amount, '分配金额'), 0)
  const receiptCash = money(receipt.amount, '收款金额')
  assert(sum(own, 'receipt') === money(receipt.allocated_amount, '收款已分配') &&
    sum(own, 'rounding') === money(receipt.rounding_allocated_amount, '收款已分优惠') &&
    money(receipt.rounding_amount, '收款优惠') === rounding && sum(own, 'rounding') === rounding &&
    money(receipt.unallocated_amount, '可用余额') === 0 && receiptCash === sum(own, 'receipt'), '本笔现金或优惠与分配不守恒')
  const feeRows = allocations.filter(row => target(row) === fee._id)
  const feeCash = feeRows.find(row => kind(row) === 'receipt'), feeRounding = feeRows.find(row => kind(row) === 'rounding')
  assert(feeRows.length === 2 && feeCash && feeRounding && feeRows.every(row => row.receipt_id === receipt._id && row.target_type === 'other_fee' && row.biz_date === receiptDate) &&
    money(feeCash.allocate_amount, '费用现金分配') === settlement - rounding &&
    money(feeRounding.allocate_amount, '费用优惠分配') === rounding &&
    money(fee.amount_received, '费用已收') === settlement - rounding && money(fee.receipt_rounding_amount, '费用优惠') === rounding,
  '旧费用必须由本笔现金及优惠独占结清')
  const saleRows = own.filter(row => row.target_type === 'sale' && target(row) === sale._id && kind(row) === 'receipt')
  assert(saleRows.length === 1 && money(saleRows[0].allocate_amount, '选定销售现金') > rounding, '选定销售没有足够且唯一的本笔现金分配')
  const saleCash = saleRows[0]
  const originalBalances = new Map()
  for (const row of own) {
    assert((row.target_type === 'other_fee' && target(row) === fee._id) || row.target_type === 'sale', '本版只支持原普通销售与指定费用分配')
    affected.add(row._id)
    if (row.target_type !== 'sale' || originalBalances.has(target(row))) continue
    const original = one('crm_sale_records', target(row))
    assert(original.price_unit !== 'm3' && original.settlement_mode !== 'customer_flow', '不支持流量或归属不明销售')
    assert(date(original.date, '销售日期') <= receiptDate, '原分配销售晚于到账日期')
    const amounts = computeSaleAmountsForDoc(original).amounts
    const gross = money(amounts.should_receive, '销售原价'), effective = money(amounts.effective_should_receive, '销售应收')
    assert(gross > 0, '本版不调整退气或零额销售')
    const related = allocations.filter(item => target(item) === original._id)
    assert(related.every(item => item.target_type === 'sale' && ['receipt', 'rounding'].includes(kind(item)) &&
      t.crm_customer_receipts.some(source => source._id === item.receipt_id && source.status === 'posted')), '目标存在不明分配来源')
    const paid = money(original.amount_received, '销售已收'), discounted = money(original.receipt_rounding_amount ?? 0, '销售收款优惠')
    assert(paid === sum(related, 'receipt') && discounted === sum(related, 'rounding') && paid + discounted <= effective, '销售目标已收、优惠或余额与全部来源不守恒')
    originalBalances.set(original._id, effective - paid - discounted)
  }
  for (const row of t.crm_customer_opening_debts.filter(active)) {
    const source = row.adjustment_source || {}
    assert(row.source_type !== 'balance_adjustment' || !(affected.has(source.receipt_id) || affected.has(source.target_id) || affected.has(source.id)),
      '相关来源已被结清或冲回占用，不能重分类')
  }
  const salePaid = money(sale.amount_received, '销售已收'), saleRounding = money(sale.receipt_rounding_amount ?? 0, '销售优惠')
  assert(salePaid >= rounding && originalBalances.has(sale._id), '销售优惠调整超额')
  const operationId = request.operation_id, runId = digest({ customerId: cid, operationId }).slice(0, 24)
  const debtKey = 'overpayment-settlement:' + fee._id, allocationKey = debtKey + ':allocation'
  const adjustmentId = digest(runId + ':' + debtKey).slice(0, 24), allocationId = digest(runId + ':' + allocationKey).slice(0, 24)
  const reason = '按已确认双方不退不抵约定，将原其他费用重分类为多收款结清；不新增到账'
  patch('crm_customer_opening_debts', fee, { status: 'void', amount_received: 0, receipt_rounding_amount: 0,
    outstanding: fee.amount, payment_status: 'unpaid', void_reason: reason, void_at: now,
    void_by: actor._id, void_by_name: actor.username || '', replacement_adjustment_id: adjustmentId })
  for (const row of feeRows) patch('crm_customer_allocations', row, { status: 'void', void_reason: reason,
    void_at: now, void_by: actor._id, void_by_name: actor.username || '', replacement_adjustment_id: adjustmentId })
  patch('crm_customer_allocations', saleCash, { allocate_amount: (money(saleCash.allocate_amount, '销售现金') - rounding) / 100 })
  patch('crm_sale_records', sale, { amount_received: (salePaid - rounding) / 100,
    receipt_rounding_amount: (saleRounding + rounding) / 100 })
  add(debtKey + ':rounding', { receipt_id: receipt._id, target_type: 'sale', target_id: sale._id, sale_id: sale._id,
    sale_date: sale.date, receipt_biz_date: receiptDate, biz_date: receiptDate, target_title: '销售单 ' + sale.date,
    allocate_kind: 'rounding', allocate_amount: rounding / 100, source_type: receipt.source_type, source_id: receipt.source_id || null,
    receipt_source_type: receipt.source_type, receipt_entry_kind: receipt.entry_kind, allocation_mode: 'checked', note: reason })
  add(debtKey, { source_type: 'balance_adjustment', adjustment_kind: 'prepay_writeoff',
    adjustment_source: { source_key: 'receipt_credit:' + receipt._id, type: 'receipt_credit', id: receipt._id,
      receipt_id: receipt._id, date: receiptDate, label: '收款可用余款' }, adjustment_operation_id: operationId,
    adjustment_evidence: '双方已确认多付款不退、不抵以后货款；原费用编号：' + fee._id,
    reclassification_evidence: { confirmed_no_refund_or_offset: true, approval_sha256: request.evidence.approval_sha256,
      original_fee_id: fee._id }, adjustment_rule_version: 'customer-adjustment/2026-10-12.1',
    adjustment_allocation_id: allocationId, money_scale: 2, biz_date: settlementDate, amount: settlement / 100,
    rounding_amount: 0, receipt_rounding_amount: 0, amount_received: settlement / 100, outstanding: 0,
    payment_status: 'paid', note: reason }, 'crm_customer_opening_debts')
  add(allocationKey, { receipt_id: receipt._id, target_type: 'balance_adjustment', target_id: adjustmentId,
    sale_id: adjustmentId, sale_date: settlementDate, target_title: '多收款结清', allocate_kind: 'receipt',
    allocate_amount: settlement / 100, source_type: 'prepay_writeoff', source_id: adjustmentId,
    biz_date: settlementDate, allocation_mode: 'checked', note: reason,
    seq: 1 + own.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0) })
  const targets = [...new Map(own.filter(row => row.target_type === 'sale').map(row => [target(row),
    { target_type: 'sale', target_id: target(row) }])).values(), { target_type: 'balance_adjustment', target_id: adjustmentId }]
  patch('crm_customer_receipts', receipt, { allocation_mode: 'checked', allocation_start_date: '', allocation_end_date: '',
    allocation_targets: targets, receipt_adjustment_status: '', receipt_adjustment_id: '', receipt_adjustment_rollback_strategy: '',
    receipt_adjustment_snapshot: null, receipt_adjustment_finished_at: now,
    receipt_adjustment_completed_by_correction: { operation_id: operationId, completed_at: now, completed_by: actor._id,
      previous_adjustment_id: pendingId || null, snapshot_was_missing: Boolean(pendingId) } })
  return { settlement_income: settlement / 100, fee_receivable_voided: settlement / 100, rounding_moved: rounding / 100,
    sales_cash_before: (receiptCash - settlement + rounding) / 100, sales_cash_after: (receiptCash - settlement) / 100,
    cash_amount_changed: 0, rounding_total_changed: 0, receivable_balance_changed: 0, prepay_balance_changed: 0,
    new_receipts: 0, pending_adjustment_completed: pendingId || null, adjustment_id: adjustmentId,
    customer_should_receive_total_delta: -settlement / 100 }
}
