'use strict'

// Period finance reads reuse the canonical money rules; allocations explain
// current use, never manufacture a receipt date or a historical closing state.
const accounting = require('./saleAccountingLocal')
const balance = require('./customerBalanceLocal').createCustomerBalance(accounting)
const { isCashReceipt, isOffsetCreditReceipt } = require('./receiptSourceLocal')
const { validateSale } = require('./saleSourceValidation')
const VERSION = 'operating-brief-finance/2026-10-23.1'
const TABLES = { customers: 'crm_customers', sales: 'crm_sale_records', flows: 'crm_customer_flow_settlements',
  debts: 'crm_customer_opening_debts', receipts: 'crm_customer_receipts', allocations: 'crm_customer_allocations', intakes: 'crm_cashier_intakes' }
const text = value => String(value ?? '').trim()
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const messages = {
  invalid_source_amount: '来源金额缺失或无效', invalid_source_precision: '来源金额精度待核', amount_overflow: '合计超出安全计算范围',
  settlement_customer_unavailable: '结算客户归属待核', settlement_customer_cycle: '结算客户归属循环', source_on_delivery_customer: '款项仍记在配送客户，归属待核',
  delivery_customer_mismatch: '配送客户与结算客户不一致', source_status_invalid: '来源状态待核', source_date_invalid: '来源业务日期待核',
  source_rounding_exceeds_amount: '抹零超过原货款', target_settlement_not_conserved: '货款核销、抹零与尚欠不守恒',
  target_overallocated: '核销超过当前有效货款', target_negative_settlement: '正向货款存在负核销', zero_target_has_settlement: '零货款仍有核销或抹零',
  allocation_target_unavailable: '分配目标缺失、已作废或不可访问', allocation_target_type_mismatch: '分配目标类型不一致',
  allocation_owner_mismatch: '分配与来源的结算客户不一致', allocation_receipt_unavailable: '分配缺少有效来源凭据',
  allocation_kind_invalid: '分配类型待核', allocation_reference_conflict: '分配引用字段不一致', allocation_exceeds_target: '分配明细超过目标账面核销',
  receipt_allocation_mismatch: '收款分配明细与账面分配额不一致', receipt_balance_not_conserved: '收款原额与当前去向不守恒',
  receipt_operation_pending: '收款调整尚未完成', receipt_purpose_invalid: '剩余款用途待核',
  cashier_source_invalid: '正式到账单与出纳登记来源不一致', duplicate_cashier_source: '同一出纳来源存在重复有效收款',
  refund_sources_missing: '退款尚缺有效来源分配', refund_source_mismatch: '退款来源、日期或客户不一致', refund_amount_mismatch: '退款来源分配与退款额不一致',
  refund_backing_mismatch: '原收款已退款额与退款凭据不一致',
  embedded_receipt_date_missing: '本期业务单有旧内嵌实收，缺少正式到账凭据及日期',
  embedded_refund_date_missing: '本期业务单有旧内嵌退款，缺少正式退款凭据及日期',
  source_read_failed: '该项来源读取失败，请重试', count_unavailable: '无法确认来源读取完整性',
  records_changed_during_read: '读取期间来源发生变化，请刷新', membership_changed: '读取期间来源范围发生变化，请刷新',
  membership_changed_during_brief: '读取期间来源范围发生变化，请刷新', records_changed_during_brief: '读取期间来源发生变化，请刷新',
  FINANCIAL_CLASSIFICATION_REQUIRED: '销售单结算归属待核，不能计算确定货款'
}
function fail(code, kind, row, field) {
  const error = new Error(messages[code] || '账务来源待核')
  error.code = code
  error.details = { source_type: TABLES[kind] || kind, source_id: text(row?._id), ...(field ? { field } : {}) }
  throw error
}
function issue(error, allowed = null) {
  const details = error?.details || {}, code = details.reason || error?.code || 'source_read_failed'
  const source = details.source_type || details.source
  const source_type = Object.values(TABLES).includes(source) || source === 'crm_fillings' ? source : undefined
  const id = text(details.source_id)
  return { code, message: messages[code] || (code === 'FINANCIAL_READ_INCOMPLETE' ? '来源读取未完成' : '账务来源待核'),
    ...(source_type ? { source_type } : {}),
    ...(id && source_type && (!allowed || allowed.get(source_type)?.has(id)) ? { source_id: id } : {}),
    ...(details.field ? { field: text(details.field) } : {}) }
}
function state(issues = []) {
  const unique = [...new Map(issues.map(row => [JSON.stringify(row), row])).values()]
  return { complete: unique.length === 0, status: unique.length ? 'unavailable' : 'available', issues: unique.slice(0, 20), issue_count: unique.length }
}
function unavailable(fields, issues) { return { ...Object.fromEntries(fields.map(key => [key, null])), ...state(issues) } }
function units(value, kind, row, field, { optional = false, signed = false, scale = 3 } = {}) {
  if (optional && value == null) return 0
  if (!['number', 'string'].includes(typeof value) || text(value) === '' || !Number.isFinite(Number(value)) || !signed && Number(value) < 0)
    fail('invalid_source_amount', kind, row, field)
  const n = Number(value), scaled = Math.round(n * 1000), quantum = scale === 2 ? 10 : 1
  if (!Number.isSafeInteger(scaled) || Math.abs(n * 1000 - scaled) > 0.00001 || scaled % quantum)
    fail('invalid_source_precision', kind, row, field)
  return scaled
}
function add(a, b) { const total = a + b; if (!Number.isSafeInteger(total)) fail('amount_overflow'); return total }
const sum = values => values.reduce(add, 0)
const money = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, value / 1000]))
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
function active(row, kind) {
  if (row.status === 'void') return false
  if (row.status === 'posted' || ['sales', 'allocations'].includes(kind) && !row.status) return true
  fail('source_status_invalid', kind, row)
}
function scopeFor(customers) {
  const map = new Map(customers.map(row => [text(row._id), row])), roots = new Map()
  function root(id, kind, source) {
    if (roots.has(id)) return roots.get(id)
    const seen = new Set(); let current = id
    for (let depth = 0; depth < 10; depth++) {
      const customer = map.get(current)
      if (!customer || customer.is_hidden === true) fail('settlement_customer_unavailable', kind, source)
      if (seen.has(current)) fail('settlement_customer_cycle', kind, source)
      seen.add(current)
      const parent = text(customer.settlement_customer_id)
      if (!parent || parent === current) { roots.set(id, current); return current }
      current = parent
    }
    fail('settlement_customer_cycle', kind, source)
  }
  function owner(row, kind) {
    const id = text(row.customer_id), resolved = root(id, kind, row)
    if (resolved !== id) fail('source_on_delivery_customer', kind, row)
    if (kind === 'sales' && text(row.delivery_customer_id) && root(text(row.delivery_customer_id), kind, row) !== id)
      fail('delivery_customer_mismatch', kind, row)
    return id
  }
  return { owner, customer: id => map.get(id) }
}
function targetRef(row) {
  const type = text(row.target_type) || (text(row.flow_settlement_id) ? 'flow_settlement' : 'sale')
  const id = text(row.target_id || (type === 'flow_settlement' ? row.flow_settlement_id : '') || row.sale_id)
  if (!['sale', 'flow_settlement', 'opening_debt', 'other_fee', 'balance_adjustment'].includes(type) || !id)
    fail('allocation_target_type_mismatch', 'allocations', row)
  if (text(row.target_id) && text(row.sale_id) && text(row.target_id) !== text(row.sale_id) ||
      type === 'flow_settlement' && text(row.flow_settlement_id) && text(row.flow_settlement_id) !== id)
    fail('allocation_reference_conflict', 'allocations', row)
  return { type, id, kind: type === 'sale' ? 'sales' : type === 'flow_settlement' ? 'flows' : 'debts', key: `${type}:${id}` }
}
// The settlement endpoint stores these target kinds in one debt collection.
function debtType(row) {
  const source = text(row.source_type)
  return source === 'balance_adjustment' ? 'balance_adjustment' : source.toLowerCase().includes('other_fee') ? 'other_fee' : 'opening_debt'
}
function snapshot(row, kind, scope) {
  scope.owner(row, kind)
  if (!active(row, kind)) fail('allocation_target_unavailable', kind, row)
  let result, scale = kind === 'sales' ? 2 : 3
  if (kind === 'sales') { result = balance.computeSaleSnapshot(row); validateSale(row) }
  else if (kind === 'flows') {
    units(row.should_receive, kind, row, 'should_receive', { signed: true })
    result = balance.computeFlowSettlementSnapshot(row)
  } else {
    scale = balance.resolveOpeningDebtMoneyScale(row, balance.resolveCustomerMoneyScale(scope.customer(row.customer_id)))
    units(row.amount, kind, row, 'amount', { signed: true, scale })
    result = balance.computeOpeningDebtSnapshot(row, scale)
  }
  const principal = units(kind === 'debts' ? result.amount : result.should_receive, kind, row, 'should_receive', { signed: true, scale })
  const ownRounding = units(row.rounding_amount, kind, row, 'rounding_amount', { optional: true, scale })
  const received = units(row.amount_received, kind, row, 'amount_received', { signed: true, scale })
  const rounding = units(row.receipt_rounding_amount, kind, row, 'receipt_rounding_amount', { optional: true, scale })
  if (kind === 'flows' && ownRounding) fail('target_settlement_not_conserved', kind, row, 'rounding_amount')
  if (ownRounding > Math.abs(principal)) fail('source_rounding_exceeds_amount', kind, row, 'rounding_amount')
  const effective = units(result.should_receive_effective ?? result.should_receive, kind, row, 'effective_should_receive', { signed: true, scale })
  const outstanding = units(result.outstanding, kind, row, 'outstanding', { scale })
  if (principal > 0) {
    if (received < 0) fail('target_negative_settlement', kind, row)
    if (add(received, rounding) > effective) fail('target_overallocated', kind, row)
    if (principal !== sum([received, ownRounding, rounding, outstanding])) fail('target_settlement_not_conserved', kind, row)
  } else if (principal === 0 && (received || ownRounding || rounding)) fail('zero_target_has_settlement', kind, row)
  else if (principal < 0 && (rounding || received > 0 || received < effective)) fail('target_settlement_not_conserved', kind, row)
  return { principal, ownRounding, received, rounding, effective, outstanding }
}
function businessSummary({ sales = [], flows = [], customers = [] }, readIssues = [], settlementReadIssues = []) {
  const scope = scopeFor(customers), issues = [...readIssues], settlementIssues = [...settlementReadIssues]
  const totals = { sales: 0, flow: 0, positive: 0, negative: 0 }
  const settled = { principal: 0, allocated: 0, sale_rounding: 0, receipt_rounding: 0, rounding: 0, outstanding: 0 }
  for (const [kind, rows] of [['sales', sales], ['flows', flows]]) for (const row of rows) {
    try {
      if (!active(row, kind)) continue
      scope.owner(row, kind)
      const date = kind === 'sales' ? row.date : row.biz_date
      if (!validDate(date)) fail('source_date_invalid', kind, row)
      let value
      if (kind === 'sales') { value = accounting.computeSaleAmountsForDoc(row).amounts.should_receive; validateSale(row) }
      else value = row.should_receive
      const principal = units(value, kind, row, 'should_receive', { signed: true, scale: kind === 'sales' ? 2 : 3 })
      totals[kind === 'sales' ? 'sales' : 'flow'] = add(totals[kind === 'sales' ? 'sales' : 'flow'], principal)
      totals[principal >= 0 ? 'positive' : 'negative'] = add(totals[principal >= 0 ? 'positive' : 'negative'], Math.abs(principal))
      try {
        const target = snapshot(row, kind, scope)
        if (target.principal > 0) {
          settled.principal = add(settled.principal, target.principal)
          settled.allocated = add(settled.allocated, target.received)
          settled.sale_rounding = add(settled.sale_rounding, target.ownRounding)
          settled.receipt_rounding = add(settled.receipt_rounding, target.rounding)
          settled.outstanding = add(settled.outstanding, target.outstanding)
        }
      } catch (error) { settlementIssues.push(issue(error)) }
    } catch (error) { issues.push(issue(error)) }
  }
  let net = 0
  try {
    net = add(totals.positive, -totals.negative)
    if (net !== add(totals.sales, totals.flow)) fail('target_settlement_not_conserved')
  } catch (error) { issues.push(issue(error)) }
  try { settled.rounding = add(settled.sale_rounding, settled.receipt_rounding) } catch (error) { settlementIssues.push(issue(error)) }
  const settlement = { ...(issues.length || settlementIssues.length ? unavailable(Object.keys(settled), [...issues, ...settlementIssues]) : { ...money(settled), ...state() }),
    as_of: 'current', scope_label: '本期正数货款的当前账面核销，含现金和非现金；不代表本期到账' }
  return { ...(issues.length ? unavailable(['sales', 'flow', 'total', 'net', 'positive', 'negative'], issues) : { ...money(totals), net: net / 1000, total: net / 1000, ...state() }),
    scope: 'period_sales_and_flow_before_rounding', positive_settlement: settlement }
}
function verifyCashierReceipts(receipts, intakes, scope) {
  const byId = new Map(intakes.map(row => [text(row._id), row])), seen = new Set()
  for (const row of receipts) {
    if (!active(row, 'receipts') || row.source_type !== 'cashier_intake') continue
    if (!isCashReceipt(row)) fail('cashier_source_invalid', 'receipts', row)
    const id = text(row.intake_id || row.source_id), head = byId.get(id)
    if (!id || !head || !active(head, 'intakes') || scope.owner(head, 'intakes') !== row.customer_id ||
        head.receipt_id !== row._id || head.biz_date !== row.biz_date || row.intake_id !== id || text(row.source_id) !== id ||
        head.purpose !== row.purpose || head.payment_method !== row.payment_method) fail('cashier_source_invalid', 'receipts', row)
    if (seen.has(id)) fail('duplicate_cashier_source', 'receipts', row)
    seen.add(id)
    const gas = units(head.gas_amount, 'intakes', head, 'gas_amount'), deposit = units(head.deposit_amount, 'intakes', head, 'deposit_amount')
    if (units(head.amount, 'intakes', head, 'amount') !== add(gas, deposit) || units(row.amount, 'receipts', row, 'amount', { signed: true }) !== gas)
      fail('cashier_source_invalid', 'receipts', row)
  }
}
function cashSummary({ receipts = [], intakes = [], customers = [] }, readIssues = []) {
  const issues = [...readIssues], scope = scopeFor(customers); let received = 0, refund = 0
  for (const row of receipts) try {
    if (!active(row, 'receipts') || !isCashReceipt(row)) continue
    scope.owner(row, 'receipts')
    if (!validDate(row.biz_date)) fail('source_date_invalid', 'receipts', row)
    if (row.receipt_adjustment_status === 'pending') fail('receipt_operation_pending', 'receipts', row)
    const amount = units(row.amount, 'receipts', row, 'amount', { signed: true })
    if (amount >= 0) received = add(received, amount); else refund = add(refund, -amount)
  } catch (error) { issues.push(issue(error)) }
  try { verifyCashierReceipts(receipts, intakes, scope) } catch (error) { issues.push(issue(error)) }
  return { ...(issues.length ? unavailable(['received', 'refund', 'net'], issues) : { ...money({ received, refund, net: add(received, -refund) }), ...state() }),
    scope: 'posted_receipts', scope_label: '已登记正式到账凭据；按到账日期，含回款和预收，不含押金、抹零及非现金' }
}
function targetMaps(input) {
  return Object.fromEntries(['sales', 'flows', 'debts'].map(kind => [kind, new Map((input[kind] || []).map(row => [text(row._id), row]))]))
}
function allocationTarget(row, maps, scope, receipt) {
  const ref = targetRef(row), target = maps[ref.kind].get(ref.id)
  if (!target || !active(target, ref.kind)) fail('allocation_target_unavailable', 'allocations', row)
  if (ref.kind === 'debts' && debtType(target) !== ref.type) fail('allocation_target_type_mismatch', 'allocations', row)
  if (scope.owner(row, 'allocations') !== scope.owner(target, ref.kind) || receipt && target.customer_id !== receipt.customer_id)
    fail('allocation_owner_mismatch', 'allocations', row)
  const date = ref.kind === 'sales' ? target.date : target.biz_date
  if (!validDate(date)) fail('source_date_invalid', ref.kind, target)
  return { ref, row: target, date }
}
function allocationKind(row) {
  const kind = text(row.allocate_kind) || 'receipt'
  if (!['receipt', 'rounding'].includes(kind)) fail('allocation_kind_invalid', 'allocations', row)
  return kind
}
function allocationSource(row, receipt) {
  if (text(row.receipt_source_type) && text(receipt.source_type) && row.receipt_source_type !== receipt.source_type)
    fail('allocation_reference_conflict', 'allocations', row)
  if ((text(row.receipt_source_type) || text(row.receipt_entry_kind)) &&
      isOffsetCreditReceipt({ source_type: row.receipt_source_type, entry_kind: row.receipt_entry_kind }) !== isOffsetCreditReceipt(receipt))
    fail('allocation_reference_conflict', 'allocations', row)
}
function receiptBudget(row) {
  const amount = units(row.amount, 'receipts', row, 'amount'), allocated = units(row.allocated_amount, 'receipts', row, 'allocated_amount')
  const remaining = units(row.unallocated_amount, 'receipts', row, 'unallocated_amount')
  const cashRefunded = units(row.cash_refunded_amount, 'receipts', row, 'cash_refunded_amount', { optional: true })
  const offsetRefunded = units(row.offset_cash_refunded_amount, 'receipts', row, 'offset_cash_refunded_amount', { optional: true })
  const rounding = units(row.rounding_allocated_amount, 'receipts', row, 'rounding_allocated_amount', { optional: true })
  const offset = isOffsetCreditReceipt(row)
  if (offset ? cashRefunded || amount !== sum([allocated, remaining, rounding, offsetRefunded])
    : offsetRefunded || amount !== sum([allocated, remaining, cashRefunded])) fail('receipt_balance_not_conserved', 'receipts', row)
  return { amount, allocated, remaining, cashRefunded, rounding }
}
function sourceEvidence(input, readIssues = []) {
  const issues = [...readIssues], scope = scopeFor(input.customers || []), maps = targetMaps(input)
  const receipts = new Map((input.receipts || []).map(row => [text(row._id), row])), backed = new Map(), byReceipt = new Map()
  for (const row of input.allocations || []) try {
    if (!active(row, 'allocations')) continue
    const ref = targetRef(row)
    if (!input.cohort.has(ref.key)) continue
    const receipt = receipts.get(text(row.receipt_id)), target = allocationTarget(row, maps, scope, receipt)
    const amount = units(row.allocate_amount, 'allocations', row, 'allocate_amount')
    if (!amount) fail('invalid_source_amount', 'allocations', row, 'allocate_amount')
    if (!receipt || !active(receipt, 'receipts') || units(receipt.amount, 'receipts', receipt, 'amount', { signed: true }) < 0)
      fail('allocation_receipt_unavailable', 'allocations', row)
    if (scope.owner(receipt, 'receipts') !== target.row.customer_id) fail('allocation_owner_mismatch', 'allocations', row)
    if (receipt.receipt_adjustment_status === 'pending' || receipt.refund_source_status === 'pending')
      fail('receipt_operation_pending', 'receipts', receipt)
    allocationSource(row, receipt)
    if (isCashReceipt(receipt) && !validDate(receipt.biz_date)) fail('source_date_invalid', 'receipts', receipt)
    const kind = allocationKind(row), budget = receiptBudget(receipt), receiptKey = `${receipt._id}:${kind}`
    byReceipt.set(receiptKey, add(byReceipt.get(receiptKey) || 0, amount))
    if (byReceipt.get(receiptKey) > (kind === 'receipt' ? budget.allocated : budget.rounding)) fail('receipt_allocation_mismatch', 'receipts', receipt)
    const key = `${ref.key}:${kind}`
    backed.set(key, add(backed.get(key) || 0, amount))
  } catch (error) { issues.push(issue(error)) }
  for (const [kind, rows] of [['sales', input.cohortSales || []], ['flows', input.cohortFlows || []]]) for (const row of rows) try {
    if (!active(row, kind)) continue
    const target = snapshot(row, kind, scope), key = `${kind === 'sales' ? 'sale' : 'flow_settlement'}:${row._id}`
    const known = backed.get(`${key}:receipt`) || 0, rounding = backed.get(`${key}:rounding`) || 0
    if (target.received < 0) fail('embedded_refund_date_missing', kind, row)
    if (known > target.received || rounding > target.rounding) fail('allocation_exceeds_target', kind, row)
    if (target.received > known) fail('embedded_receipt_date_missing', kind, row)
  } catch (error) { issues.push(issue(error)) }
  return { ...state(issues), scope: 'selected_business_cohort',
    scope_label: '仅核对本期业务单的内嵌收退与来源凭据，未核查全部历史到账；凭据待核不补成零或套用销售日期' }
}
const DESTINATIONS = ['same_period', 'prior_period', 'future_period', 'other', 'refunded_after_or_current',
  'remaining_prepay', 'remaining_settlement', 'remaining_unknown', 'total']
function cashDestinations(input, range, readIssues = []) {
  const issues = [...readIssues], scope = scopeFor(input.customers || []), maps = targetMaps(input)
  const receipts = new Map((input.receipts || []).map(row => [text(row._id), row]))
  const totals = Object.fromEntries(DESTINATIONS.map(key => [key, 0])), refunded = new Map(), allocationTotals = new Map(), targetTotals = new Map()
  const selected = new Set((input.periodReceipts || []).filter(row => row.status === 'posted' && isCashReceipt(row) && Number(row.amount) > 0).map(row => row._id))
  const owners = new Set([...selected].map(id => receipts.get(id)?.customer_id))
  for (const row of input.refunds || []) try {
    if (!active(row, 'receipts') || !isCashReceipt(row)) continue
    scope.owner(row, 'receipts')
    if (row.source_type === 'offset_credit_cash_refund' && !selected.has(text(row.offset_source_receipt_id))) continue
    const links = row.refund_sources
    if (!Array.isArray(links) || !links.length || row.refund_source_status !== 'linked') {
      if (owners.has(row.customer_id)) fail('refund_sources_missing', 'receipts', row)
      continue
    }
    if (!links.some(link => selected.has(text(link.id)))) continue
    const seen = new Set(); let total = 0
    for (const link of links) {
      const id = text(link.id), source = receipts.get(id), amount = units(link.amount, 'receipts', row, 'refund_sources.amount')
      if (!source || !active(source, 'receipts') || !amount || seen.has(id) || scope.owner(source, 'receipts') !== row.customer_id ||
          Number(source.amount) <= 0 || !validDate(row.biz_date) || !validDate(source.biz_date) || row.biz_date < source.biz_date ||
          ['deposit_transfer', 'settlement_fee'].includes(source.source_type)) fail('refund_source_mismatch', 'receipts', row)
      seen.add(id); total = add(total, amount)
      if (selected.has(id)) refunded.set(id, add(refunded.get(id) || 0, amount))
    }
    if (total !== -units(row.amount, 'receipts', row, 'amount', { signed: true })) fail('refund_amount_mismatch', 'receipts', row)
  } catch (error) { issues.push(issue(error)) }
  for (const row of input.allocations || []) try {
    if (!active(row, 'allocations') || !selected.has(text(row.receipt_id))) continue
    const receipt = receipts.get(text(row.receipt_id)), amount = units(row.allocate_amount, 'allocations', row, 'allocate_amount')
    if (!amount) fail('invalid_source_amount', 'allocations', row, 'allocate_amount')
    allocationSource(row, receipt)
    const target = allocationTarget(row, maps, scope, receipt), kind = allocationKind(row)
    const current = snapshot(target.row, target.ref.kind, scope)
    if (!(current.principal > 0)) fail('allocation_target_unavailable', 'allocations', row)
    const key = `${row.receipt_id}:${kind}`, targetKey = `${target.ref.key}:${kind}`
    allocationTotals.set(key, add(allocationTotals.get(key) || 0, amount))
    targetTotals.set(targetKey, add(targetTotals.get(targetKey) || 0, amount))
    if (targetTotals.get(targetKey) > (kind === 'receipt' ? current.received : current.rounding)) fail('allocation_exceeds_target', 'allocations', row)
    if (kind === 'rounding') continue // Noncash rounding never consumes the positive cash principal.
    let bucket = 'other'
    if (target.ref.type === 'opening_debt') bucket = 'prior_period'
    else if (['sale', 'flow_settlement'].includes(target.ref.type)) bucket = target.date < range.start ? 'prior_period' : target.date > range.end ? 'future_period' : 'same_period'
    totals[bucket] = add(totals[bucket], amount)
  } catch (error) { issues.push(issue(error)) }
  for (const id of selected) try {
    const row = receipts.get(id)
    scope.owner(row, 'receipts')
    if (row.receipt_adjustment_status === 'pending') fail('receipt_operation_pending', 'receipts', row)
    const { amount, allocated, remaining, cashRefunded, rounding } = receiptBudget(row)
    if (allocated !== (allocationTotals.get(`${id}:receipt`) || 0) || rounding !== (allocationTotals.get(`${id}:rounding`) || 0))
      fail('receipt_allocation_mismatch', 'receipts', row)
    if (cashRefunded !== (refunded.get(id) || 0)) fail('refund_backing_mismatch', 'receipts', row)
    const purpose = text(row.purpose) || (row.source_type === 'customer_prepay_manual' ? 'prepay' : 'unspecified')
    if (!['prepay', 'settlement', 'unspecified'].includes(purpose)) fail('receipt_purpose_invalid', 'receipts', row)
    const bucket = purpose === 'prepay' ? 'remaining_prepay' : purpose === 'settlement' ? 'remaining_settlement' : 'remaining_unknown'
    totals[bucket] = add(totals[bucket], remaining)
    totals.refunded_after_or_current = add(totals.refunded_after_or_current, cashRefunded)
    totals.total = add(totals.total, amount)
  } catch (error) { issues.push(issue(error)) }
  if (!issues.length && sum(DESTINATIONS.filter(key => key !== 'total').map(key => totals[key])) !== totals.total)
    issues.push(issue(Object.assign(new Error(), { code: 'receipt_balance_not_conserved' })))
  return { ...(issues.length ? unavailable(DESTINATIONS, issues) : { ...money(totals), ...state() }), basis: 'current_allocation',
    scope_label: '本期正现金收款截至当前的分配去向；以前货款含期初欠款；已退款含本期及之后，不是本期退款额' }
}

module.exports = { VERSION, TABLES, text, own, issue, state, unavailable, units, add, validDate, active, scopeFor, targetRef,
  businessSummary, cashSummary, sourceEvidence, cashDestinations, DESTINATIONS }
