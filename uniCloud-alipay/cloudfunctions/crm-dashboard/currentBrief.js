'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { computeSaleSnapshot, computeFlowSettlementSnapshot, computeOpeningDebtSnapshot,
  resolveCustomerMoneyScale, resolveOpeningDebtMoneyScale } = require('./customerBalanceLocal').createCustomerBalance(require('./saleAccountingLocal'))
const { isOffsetCreditReceipt, isDepositTransferReceipt, isSettlementFeeReceipt } = require('./receiptSourceLocal')
const { validateSale } = require('./saleSourceValidation')
const VERSION = 'operating-brief/2026-10-23.1'
const CURRENT_VERSION = 'operating-brief-current/2026-10-24.1'
const TABLES = { customers: 'crm_customers', sales: 'crm_sale_records', flows: 'crm_customer_flow_settlements',
  debts: 'crm_customer_opening_debts', receipts: 'crm_customer_receipts', intakes: 'crm_cashier_intakes' }
const text = value => String(value ?? '').trim()
const sourceForRow = new WeakMap()
const DEBT_KINDS = ['customers', 'sales', 'flows', 'debts']
const FUNDS_KINDS = ['customers', 'receipts', 'intakes']
function unresolved(reason, row, details = {}) {
  const error = new FinancialReadError(reason, { source: row && sourceForRow.get(row) || 'operating_brief_current', source_id: text(row?._id), customer_id: text(row?.customer_id), ...details })
  error.message = ({
    source_allocation_exceeds_principal: '原单应收与已收口径需核对，请检查货款、其他费用及收款归属',
    receipt_operation_pending: '收款调整尚未完成，请进入客户对账继续处理',
    refund_backing_mismatch: '退款记录与原收款的已退金额对不上，请核对退款来源',
    invalid_source_precision: '原单金额精度与结算规则不一致，请核对来源',
    fund_source_scope_unresolved: '收款关联来源或客户归属待核，暂不能划分已核实范围'
  })[reason] || '部分账务记录需核对，暂不能汇总'
  throw error
}
function numeric(value, row, field, { optional = false, signed = false } = {}) {
  if (optional && value == null) return 0
  if (!['string', 'number'].includes(typeof value) || text(value) === '' || !Number.isFinite(Number(value)) ||
      !signed && Number(value) < 0) unresolved('invalid_source_amount', row, { field })
  return Number(value)
}
function units(value, row, field, options = {}) {
  const number = numeric(value, row, field, options), factor = 10 ** (options.scale ?? 3), scaled = Math.round(number * factor)
  if (!Number.isSafeInteger(scaled) || Math.abs(number * factor - scaled) > 0.00001 || !Number.isSafeInteger(Math.round(number * 1000)))
    unresolved('invalid_source_precision', row, { field })
  return Math.round(number * 1000)
}
function add(left, right) {
  const total = left + right
  if (!Number.isSafeInteger(total)) unresolved('amount_overflow')
  return total
}
function active(row, kind) {
  if (row.status === 'void') return false
  if (row.status === 'posted' || kind === 'sales' && !row.status) return true
  unresolved('source_status_missing', row, { source_type: kind, field: 'status' })
}
function customerScope(customers) {
  const byId = new Map(customers.map(row => [text(row._id), row])), roots = new Map()
  function resolve(id) {
    if (roots.has(id)) return roots.get(id)
    const visited = new Set(), original = byId.get(id)
    let row = original
    for (let depth = 0; depth < 10; depth++) {
      if (!row || row.is_hidden === true) unresolved('settlement_customer_unavailable', original)
      const current = text(row._id), parent = text(row.settlement_customer_id)
      if (!parent || parent === current) { roots.set(id, current); return current }
      if (visited.has(current) || visited.has(parent)) unresolved('settlement_customer_cycle', original)
      visited.add(current); row = byId.get(parent)
    }
    unresolved('settlement_customer_depth', original)
  }
  for (const row of customers) if (row.is_hidden !== true) resolve(text(row._id))
  function owner(row, sale = false) {
    const id = text(row.customer_id)
    if (!id || !byId.has(id)) unresolved('source_customer_missing', row, { field: 'customer_id' })
    const root = resolve(id)
    // Historical money left on a delivery location cannot be silently reassigned.
    if (root !== id) unresolved('source_on_delivery_customer', row, { field: 'customer_id' })
    if (sale && text(row.delivery_customer_id) && resolve(text(row.delivery_customer_id)) !== root)
      unresolved('delivery_customer_mismatch', row, { field: 'delivery_customer_id' })
    return byId.get(root)
  }
  return { owner, byId, ids: [...new Set(roots.values())], count: new Set(roots.values()).size }
}
function sourceGroup(row) {
  if (['opening_prepay', 'deposit_transfer', 'settlement_fee'].includes(row.source_type)) return row.source_type
  return row.source_type === 'customer_prepay_manual' ? 'manual_prepay' : 'receipt_unallocated'
}
function validateDebtSnapshot(row, kind, snapshot) {
  const received = units(row.amount_received, row, 'amount_received', { signed: true })
  const sourceRounding = units(row.rounding_amount, row, 'rounding_amount', { optional: true })
  const receiptRounding = units(row.receipt_rounding_amount, row, 'receipt_rounding_amount', { optional: true })
  const principal = units(kind === 'debts' ? snapshot.amount : snapshot.should_receive, row, 'principal', { signed: true })
  const effective = units(kind === 'flows' ? snapshot.should_receive : snapshot.should_receive_effective,
    row, 'effective_should_receive', { signed: true })
  // Shared snapshots clamp outstanding balances. Validate the original inputs
  // before accepting that clamp as evidence that the customer owes nothing.
  if (sourceRounding > Math.abs(principal)) unresolved('source_rounding_exceeds_principal', row, { field: 'rounding_amount' })
  if (kind === 'flows' && sourceRounding) unresolved('unapplied_source_rounding', row, { field: 'rounding_amount' })
  if (principal >= 0) {
    if (received < 0) unresolved('negative_source_allocation', row, { field: 'amount_received' })
    if (received > effective) unresolved('source_allocation_exceeds_principal', row, { field: 'amount_received' })
    if (add(received, receiptRounding) > effective)
      unresolved('receipt_rounding_exceeds_remaining', row, { field: 'receipt_rounding_amount' })
  } else {
    // A negative charge may already have a partial or full refund. Its signed
    // settlement must stay between the effective refund due and zero; it does
    // not offset another positive source's outstanding debt.
    if (received > 0) unresolved('positive_allocation_on_negative_source', row, { field: 'amount_received' })
    if (received < effective) unresolved('source_refund_exceeds_principal', row, { field: 'amount_received' })
    if (receiptRounding) unresolved('receipt_rounding_on_negative_source', row, { field: 'receipt_rounding_amount' })
  }
}
// With a collector, inspect every source even after one source fails. The caller
// quarantines the customer's entire result; these provisional sums never escape.
function inspect(rows, calculate, collect) {
  for (const row of rows) {
    try { calculate(row) }
    catch (error) { if (!collect) throw error; collect(error, row) }
  }
}
function summarizeDebt(inputs, scope, collect) {
  const byCustomer = new Map()
  for (const kind of ['sales', 'flows', 'debts']) inspect(inputs[kind], row => {
    if (!active(row, kind)) return
    const customer = scope.owner(row, kind === 'sales')
    const scale = kind === 'sales' ? 2 : kind === 'flows' ? 3 : resolveOpeningDebtMoneyScale(row, resolveCustomerMoneyScale(customer))
    // Validate raw monetary inputs at the authoritative source's scale before
    // its snapshot rounds/truncates. A discarded fraction is not verified zero.
    units(row.amount_received, row, 'amount_received', { signed: true, scale })
    units(row.receipt_rounding_amount, row, 'receipt_rounding_amount', { optional: true, scale })
    units(row.rounding_amount, row, 'rounding_amount', { optional: true, scale })
    let snapshot
    try {
      if (kind === 'sales') { snapshot = computeSaleSnapshot(row); validateSale(row) }
      else if (kind === 'flows') {
        units(row.should_receive, row, 'should_receive', { signed: true }); snapshot = computeFlowSettlementSnapshot(row)
      } else {
        units(row.amount, row, 'amount', { signed: true, scale })
        snapshot = computeOpeningDebtSnapshot(row, scale)
      }
    } catch (error) {
      if (error.code === 'FINANCIAL_CLASSIFICATION_REQUIRED') error.details = { ...error.details,
        source: TABLES[kind], source_id: text(row._id), customer_id: text(row.customer_id), field: 'settlement_mode' }
      throw error
    }
    validateDebtSnapshot(row, kind, snapshot)
    const value = units(snapshot.outstanding, row, 'outstanding')
    byCustomer.set(customer._id, add(byCustomer.get(customer._id) || 0, value))
  }, collect)
  let receivable = 0
  for (const amount of byCustomer.values()) receivable = add(receivable, amount)
  const rows = [...byCustomer].filter(([, amount]) => amount > 0).map(([id, amount]) => {
    const customer = scope.byId.get(id)
    return { customer_id: id, name: text(customer.name), code: text(customer.qr_code), amount: amount / 1000,
      share_of_total: Math.round(amount / receivable * 1000000) / 1000000, units: amount }
  })
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
  rows.sort((a, b) => b.units - a.units || compare(a.code, b.code) || compare(a.customer_id, b.customer_id))
  return { receivable: receivable / 1000, ranking: { total_receivable: receivable / 1000,
    positive_customer_count: rows.length, items: rows.slice(0, 3).map(({ units, ...row }) => row) } }
}
function summarizeFunds(inputs, scope, collect) {
  const receiptById = new Map(), intakeById = new Map()
  const groups = { manual_prepay: 0, receipt_unallocated: 0, opening_prepay: 0, deposit_transfer: 0, settlement_fee: 0 }
  inspect(inputs.intakes, row => { if (active(row, 'intakes')) { scope.owner(row); intakeById.set(row._id, row) } }, collect)
  let offsetAvailable = 0
  const cashierSources = new Set()
  inspect(inputs.receipts, row => {
    if (!active(row, 'receipts')) return
    scope.owner(row)
    // Keep the original row available to relation checks even when its own
    // validation fails; otherwise one bad receipt invents missing-link issues.
    receiptById.set(row._id, row)
    if (row.receipt_adjustment_status === 'pending' || row.refund_source_status === 'pending') unresolved('receipt_operation_pending', row)
    const amount = units(row.amount, row, 'amount', { signed: true })
    if (row.source_type === 'cashier_intake') {
      const source = text(row.intake_id) || text(row.source_id)
      if (source && cashierSources.has(source)) unresolved('duplicate_cashier_receipt_source', row)
      if (source) cashierSources.add(source)
      if (text(row.intake_id) && text(row.source_id) && row.intake_id !== row.source_id ||
          !text(row.intake_id) && intakeById.has(text(row.source_id))) unresolved('cashier_receipt_source_mismatch', row)
    }
    const allocated = units(row.allocated_amount, row, 'allocated_amount')
    const available = units(row.unallocated_amount, row, 'unallocated_amount')
    const refunded = units(row.cash_refunded_amount, row, 'cash_refunded_amount', { optional: true })
    const offsetRefunded = units(row.offset_cash_refunded_amount, row, 'offset_cash_refunded_amount', { optional: true })
    const rounding = units(row.rounding_allocated_amount, row, 'rounding_allocated_amount', { optional: true })
    units(row.rounding_amount, row, 'rounding_amount', { optional: true })
    if (amount < 0) {
      if (allocated || available || rounding || refunded || offsetRefunded) unresolved('refund_has_available_balance', row)
    } else if (isOffsetCreditReceipt(row)) {
      if (refunded || amount !== add(add(allocated, available), add(rounding, offsetRefunded))) unresolved('offset_balance_not_conserved', row)
      offsetAvailable = add(offsetAvailable, available)
    } else {
      if (offsetRefunded || amount !== add(add(allocated, available), refunded)) unresolved('receipt_balance_not_conserved', row)
      const group = sourceGroup(row); groups[group] = add(groups[group], available)
    }
  }, collect)
  // Refunds are already reflected in source availability. Check their links once,
  // without subtracting the cash event again from that availability.
  const refunds = new Map()
  inspect(receiptById.values(), row => {
    let links = []
    if (row.source_type === 'customer_cash_refund') {
      if (row.refund_source_status !== 'linked' || !Array.isArray(row.refund_sources) || !row.refund_sources.length)
        unresolved('refund_sources_missing', row)
      links = row.refund_sources
    } else if (row.source_type === 'offset_credit_cash_refund') links = [{ id: row.offset_source_receipt_id, amount: -Number(row.amount) }]
    if (!links.length) return
    const seen = new Set(); let total = 0
    for (const link of links) {
      const source = receiptById.get(link.id), amount = units(link.amount, row, 'refund_sources.amount')
      if (!source || source.customer_id !== row.customer_id || !(Number(source.amount) > 0) || !amount || seen.has(link.id) ||
          isDepositTransferReceipt(source) || isSettlementFeeReceipt(source)) unresolved('refund_source_mismatch', row)
      if (row.source_type === 'offset_credit_cash_refund' && !isOffsetCreditReceipt(source)) unresolved('refund_source_mismatch', row)
      seen.add(link.id); total = add(total, amount); refunds.set(link.id, add(refunds.get(link.id) || 0, amount))
    }
    if (total !== -units(row.amount, row, 'amount', { signed: true })) unresolved('refund_amount_mismatch', row)
  }, collect)
  let prepay = 0, pendingAmount = 0, pendingCount = 0
  const linkedReceipts = new Set()
  inspect(receiptById.values(), row => {
    const refunded = units(row[isOffsetCreditReceipt(row) ? 'offset_cash_refunded_amount' : 'cash_refunded_amount'], row, 'refunded_amount', { optional: true })
    if (refunded !== (refunds.get(row._id) || 0)) unresolved('refund_backing_mismatch', row)
    if (text(row.intake_id)) {
      const head = intakeById.get(row.intake_id)
      if (!head || head.receipt_id !== row._id) unresolved('receipt_intake_missing', row)
    }
  }, collect)
  inspect(intakeById.values(), head => {
    const gas = units(head.gas_amount, head, 'gas_amount'), deposit = units(head.deposit_amount, head, 'deposit_amount')
    if (units(head.amount, head, 'amount') !== add(gas, deposit) || deposit % 10) unresolved('intake_split_mismatch', head)
    if (!['prepay', 'settlement', 'unspecified'].includes(head.purpose)) unresolved('intake_purpose_missing', head)
    if (gas === 0) {
      if (head.receipt_id) unresolved('intake_unexpected_receipt', head)
      return
    }
    const row = receiptById.get(head.receipt_id)
    if (!row || row.intake_id !== head._id || row.customer_id !== head.customer_id || row.source_type !== 'cashier_intake' ||
        row.purpose !== head.purpose || units(row.amount, row, 'amount') !== gas || row.biz_date !== head.biz_date ||
        row.payment_method !== head.payment_method || linkedReceipts.has(row._id)) unresolved('intake_receipt_mismatch', head)
    linkedReceipts.add(row._id)
    const available = units(row.unallocated_amount, row, 'unallocated_amount')
    if (head.purpose === 'settlement' && available > 0) { pendingCount++; pendingAmount = add(pendingAmount, available) }
  }, collect)
  for (const amount of Object.values(groups)) prepay = add(prepay, amount)
  return { prepay: prepay / 1000,
    prepay_sources: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value / 1000])),
    offset_credit: offsetAvailable / 1000, pending: { count: pendingCount, amount: pendingAmount / 1000 } }
}
// A damaged unrelated prepayment must not hide otherwise complete settlement
// reminders. Follow every connected source/refund/head of settlement receipts,
// while retaining the same conservation and ownership checks as available funds.
function pendingInputs(inputs) {
  const heads = new Map(), receipts = new Map(), headsByReceipt = new Map(), receiptsByHead = new Map(), refundsBySource = new Map()
  const link = (map, key, value) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(value) }
  const queue = [], selectedHeads = new Set(), selectedReceipts = new Set()
  function enqueue(kind, id) {
    if (!id) return
    const selected = kind === 'head' ? selectedHeads : selectedReceipts
    if (selected.has(id)) return
    selected.add(id); queue.push([kind, id])
  }
  for (const row of inputs.intakes) {
    if (!active(row, 'intakes')) continue
    if (!['prepay', 'settlement', 'unspecified'].includes(row.purpose)) unresolved('intake_purpose_missing', row, { field: 'purpose' })
    heads.set(row._id, row); link(headsByReceipt, text(row.receipt_id), row._id)
    if (row.purpose === 'settlement') enqueue('head', row._id)
  }
  for (const row of inputs.receipts) {
    if (row.status === 'void') continue
    receipts.set(row._id, row)
    link(receiptsByHead, text(row.intake_id), row._id)
    if (row.source_type === 'cashier_intake') link(receiptsByHead, text(row.source_id), row._id)
    if (Array.isArray(row.refund_sources)) for (const source of row.refund_sources) link(refundsBySource, text(source?.id), row._id)
    link(refundsBySource, text(row.offset_source_receipt_id), row._id)
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [kind, id] = queue[cursor]
    if (kind === 'head') {
      const row = heads.get(id)
      if (row) enqueue('receipt', text(row.receipt_id))
      for (const receiptId of receiptsByHead.get(id) || []) enqueue('receipt', receiptId)
    } else {
      const row = receipts.get(id)
      if (row) {
        enqueue('head', text(row.intake_id))
        if (row.source_type === 'cashier_intake' && heads.has(text(row.source_id))) enqueue('head', text(row.source_id))
        if (Array.isArray(row.refund_sources)) for (const source of row.refund_sources) enqueue('receipt', text(source?.id))
        enqueue('receipt', text(row.offset_source_receipt_id))
      }
      for (const headId of headsByReceipt.get(id) || []) enqueue('head', headId)
      for (const refundId of refundsBySource.get(id) || []) enqueue('receipt', refundId)
    }
  }
  return { ...inputs, intakes: [...selectedHeads].map(id => heads.get(id)).filter(Boolean),
    receipts: [...selectedReceipts].map(id => receipts.get(id)).filter(Boolean) }
}
function issue(error, fallbackSource) {
  const details = error.details || {}
  return { code: error.code || 'SOURCE_READ_FAILED', reason: details.reason || 'source_read_failed',
    source: details.source || fallbackSource || 'operating_brief_current', source_id: details.source_id || null,
    customer_id: details.customer_id || null, field: details.field || null,
    message: ['FINANCIAL_READ_INCOMPLETE', 'FINANCIAL_CLASSIFICATION_REQUIRED'].includes(error.code)
      ? error.message : '该项来源读取未完成，请重试' }
}
const available = () => ({ status: 'available', complete: true, issues: [] })
const unavailable = issues => ({ status: 'unavailable', complete: false, issues })

function reviewIssue(error, row, scope) {
  return enrichIssue(issue(error, row && sourceForRow.get(row)), row, scope)
}
function enrichIssue(original, row, scope) {
  const value = { ...original }
  const customerId = text(value.customer_id) || text(row?.customer_id) ||
    (value.source === TABLES.customers ? text(value.source_id) : '')
  const customer = scope?.byId.get(customerId)
  const visible = customer && customer.is_hidden !== true
  // An unscoped or hidden identity must not leak through a diagnostic link.
  if (!visible) { value.customer_id = null; value.source_id = null }
  else {
    value.customer_id = customerId
    if (!value.source_id && row) value.source_id = text(row._id) || null
  }
  return { ...value, customer_name: visible ? text(customer.name) : null,
    customer_code: visible ? text(customer.qr_code) : null,
    source_date: visible && row ? text(row.biz_date || row.date) || null : null,
    action: value.reason === 'receipt_operation_pending' ? 'resume_receipt_adjustment' :
      value.source_id ? 'review_source' : value.customer_id ? 'review_customer' : 'retry' }
}
function blockedCustomerDomain(issues) {
  return { state: { ...unavailable(issues), verified_subtotal: null, issue_count: issues.length, issues_complete: false,
    coverage: { complete: false, total_customers: null, verified_customers: null, pending_customers: null } }, value: null }
}
function partitionCustomers(inputs, scope, kinds) {
  const groups = new Map(scope.ids.map(id => [id, Object.fromEntries(kinds.filter(kind => kind !== 'customers').map(kind => [kind, []]))]))
  // Establish ownership for the complete population before accepting any
  // customer's subtotal. Unknown ownership must not disappear into a bucket.
  for (const kind of kinds) if (kind !== 'customers') for (const row of inputs[kind]) {
    if (row.status === 'void') continue
    const owner = scope.owner(row, kind === 'sales')
    groups.get(owner._id)[kind].push(row)
  }
  return groups
}
function validateFundsScope(inputs) {
  const heads = new Map(inputs.intakes.filter(row => row.status !== 'void').map(row => [text(row._id), row]))
  const receipts = new Map(inputs.receipts.filter(row => row.status !== 'void').map(row => [text(row._id), row]))
  const claims = new Map()
  function reference(row, id, records, field) {
    if (!text(id)) return
    const target = records.get(text(id))
    if (!target || text(target.customer_id) !== text(row.customer_id))
      unresolved('fund_source_scope_unresolved', row, { field })
  }
  for (const row of receipts.values()) {
    reference(row, row.intake_id, heads, 'intake_id')
    if (row.source_type === 'cashier_intake' && text(row.source_id)) {
      const existing = claims.get(text(row.source_id))
      if (existing && text(existing.customer_id) !== text(row.customer_id))
        unresolved('fund_source_scope_unresolved', row, { field: 'source_id' })
      claims.set(text(row.source_id), row)
      // Legacy cashier receipts may have no intake row. A present row, however,
      // cannot belong to another customer or vanish during partitioning.
      if (heads.has(text(row.source_id))) reference(row, row.source_id, heads, 'source_id')
    }
    if (Array.isArray(row.refund_sources)) for (const link of row.refund_sources)
      reference(row, link?.id, receipts, 'refund_sources.id')
    reference(row, row.offset_source_receipt_id, receipts, 'offset_source_receipt_id')
  }
  for (const row of heads.values()) reference(row, row.receipt_id, receipts, 'receipt_id')
}
function customerDomain(inputs, scope, kinds, kind) {
  const groups = partitionCustomers(inputs, scope, kinds)
  if (kind === 'funds') validateFundsScope(inputs)
  const issues = [], verified = new Map()
  for (const [customerId, group] of groups) {
    const customerIssues = new Map()
    const collect = (error, row) => {
      // Unexpected implementation/runtime failures are not a bad customer.
      if (!['FINANCIAL_READ_INCOMPLETE', 'FINANCIAL_CLASSIFICATION_REQUIRED'].includes(error.code)) throw error
      const evidence = reviewIssue(error, row, scope)
      evidence.customer_id = customerId
      const customer = scope.byId.get(customerId)
      evidence.customer_name = text(customer.name); evidence.customer_code = text(customer.qr_code)
      const key = `${evidence.source}:${evidence.source_id || evidence.reason}`
      if (!customerIssues.has(key)) customerIssues.set(key, evidence)
    }
    const value = kind === 'debt' ? summarizeDebt(group, scope, collect) : summarizeFunds(group, scope, collect)
    if (customerIssues.size) issues.push(...customerIssues.values())
    else verified.set(customerId, value)
  }
  let total = 0, offset = 0
  const prepaySources = { manual_prepay: 0, receipt_unallocated: 0, opening_prepay: 0, deposit_transfer: 0, settlement_fee: 0 }, rankingRows = []
  for (const [customerId, value] of verified) {
    total = add(total, Math.round((kind === 'debt' ? value.receivable : value.prepay) * 1000))
    if (kind === 'debt') {
      if (value.receivable > 0) rankingRows.push({ customer_id: customerId, name: text(scope.byId.get(customerId).name),
        code: text(scope.byId.get(customerId).qr_code), amount: value.receivable })
    } else {
      offset = add(offset, Math.round(value.offset_credit * 1000))
      for (const [name, amount] of Object.entries(value.prepay_sources)) prepaySources[name] = add(prepaySources[name] || 0, Math.round(amount * 1000))
    }
  }
  const complete = verified.size === scope.count
  issues.sort((a, b) => [a.customer_code, a.customer_id, a.source, a.source_id, a.reason].join('\0')
    .localeCompare([b.customer_code, b.customer_id, b.source, b.source_id, b.reason].join('\0'), 'en'))
  const state = { status: complete ? 'available' : verified.size ? 'partial' : 'unavailable', complete,
    issues, issue_count: issues.length, issues_complete: true, verified_subtotal: verified.size || complete ? total / 1000 : null,
    coverage: { complete: true, total_customers: scope.count, verified_customers: verified.size, pending_customers: scope.count - verified.size } }
  if (!complete) return { state, value: null }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
  rankingRows.sort((a, b) => b.amount - a.amount || compare(a.code, b.code) || compare(a.customer_id, b.customer_id))
  return { state, value: kind === 'debt' ? { receivable: total / 1000, ranking: { total_receivable: total / 1000,
    positive_customer_count: rankingRows.length, items: rankingRows.slice(0, 3).map(row => ({ ...row,
      share_of_total: Math.round(row.amount * 1000 / total * 1000000) / 1000000 })) } } :
    { prepay: total / 1000, offset_credit: offset / 1000,
      prepay_sources: Object.fromEntries(Object.entries(prepaySources).map(([name, amount]) => [name, amount / 1000])) } }
}

async function readCurrentBrief(db, { now = Date.now() } = {}) {
  const started = Date.now(), command = db.command, inputs = {}, reads = [], failures = new Map()
  async function read(kind, where = {}, field) {
    const collection = db.collection(TABLES[kind])
    try {
      const rows = await readComplete(collection, where, { command, field, source: TABLES[kind] })
      for (const row of rows) sourceForRow.set(row, TABLES[kind])
      inputs[kind] = rows; reads.push({ kind, collection, where, count: rows.length })
    } catch (error) { failures.set(kind, issue(error, TABLES[kind])) }
  }
  await read('customers', {}, { _id: true, name: true, qr_code: true, default_price_unit: true, settlement_customer_id: true, is_hidden: true })
  if (!failures.has('customers')) {
    const hidden = inputs.customers.filter(row => row.is_hidden === true).map(row => row._id)
    const where = hidden.length ? { customer_id: command.nin(hidden) } : {}
    const saleWhere = hidden.length ? command.and([where, { delivery_customer_id: command.nin(hidden) }]) : where
    const kinds = ['sales', 'flows', 'debts', 'receipts', 'intakes']
    for (let i = 0; i < kinds.length; i += 3) await Promise.all(kinds.slice(i, i + 3).map(kind => read(kind, kind === 'sales' ? saleWhere : where)))
  }
  // Count and mutation checks span the entire request, independently per source.
  // One failed collection only invalidates domains that depend on that source.
  const visibleCustomerIds = new Set((inputs.customers || []).filter(row => row.is_hidden !== true).map(row => text(row._id)))
  function changedSourceId(kind, row) {
    // The customer inventory includes hidden identities for scope protection.
    // A new/unknown source has not yet passed that protection either.
    if (kind === 'customers' || !row) return null
    const original = inputs[kind]?.find(source => source._id === row._id)
    const visible = source => source && visibleCustomerIds.has(text(source.customer_id)) &&
      (kind !== 'sales' || !text(source.delivery_customer_id) || visibleCustomerIds.has(text(source.delivery_customer_id)))
    return visible(original) && visible(row) ? text(row._id) : null
  }
  for (const { kind, collection, where, count } of reads) {
    try {
      const [after, changed] = await Promise.all([collection.where(where).count(), collection.where(command.and([where,
        command.or([{ updated_at: command.gte(started) }, { created_at: command.gte(started) }])])).limit(1).get()])
      if (!['number', 'string'].includes(typeof after.total) || text(after.total) === '' || !Number.isSafeInteger(Number(after.total)) || Number(after.total) !== count ||
          !Array.isArray(changed.data) || changed.data.length) throw new FinancialReadError('current_window_changed', {
            source: TABLES[kind], source_id: changedSourceId(kind, changed.data?.[0]), expected_rows: count })
    } catch (error) { failures.set(kind, issue(error, TABLES[kind])) }
  }
  const readCompleteState = failures.size === 0
  let scope
  if (!failures.has('customers')) {
    try { scope = customerScope(inputs.customers) } catch (error) { failures.set('customers', issue(error, TABLES.customers)) }
  }
  function domain(kinds, calculate) {
    const issues = kinds.filter(kind => failures.has(kind)).map(kind => failures.get(kind))
    if (issues.length) return { state: unavailable(issues), value: null }
    try { return { state: available(), value: calculate() } }
    catch (error) { return { state: unavailable([issue(error)]), value: null } }
  }
  const diagnosticScope = { byId: new Map((inputs.customers || []).map(row => [text(row._id), row])) }
  function diagnostic(value) {
    const kind = Object.keys(TABLES).find(key => TABLES[key] === value.source)
    const row = inputs[kind]?.find(row => row._id === value.source_id)
    return enrichIssue(value, row, diagnosticScope)
  }
  function scopedDomain(kinds, kind) {
    const issues = kinds.filter(source => failures.has(source)).map(source => diagnostic(failures.get(source)))
    if (issues.length) return blockedCustomerDomain(issues)
    try { return customerDomain(inputs, scope, kinds, kind) }
    catch (error) { return blockedCustomerDomain([diagnostic(issue(error))]) }
  }
  const debt = scopedDomain(DEBT_KINDS, 'debt')
  const funds = scopedDomain(FUNDS_KINDS, 'funds')
  const pending = domain(FUNDS_KINDS, () => summarizeFunds(pendingInputs(inputs), scope).pending)
  const complete = debt.state.complete && funds.state.complete && pending.state.complete
  return { section: 'current', version: VERSION, current_version: CURRENT_VERSION, money_scale: 3,
    current: { receivable: debt.value?.receivable ?? null, prepay: funds.value?.prepay ?? null,
      offset_credit: funds.value?.offset_credit ?? null, prepay_sources: funds.value?.prepay_sources ?? null,
      prepay_label: '可用款（不含退气抵款）', customer_count: scope?.count ?? null,
      complete: debt.state.complete && funds.state.complete, debt: debt.state, available_funds: funds.state,
      debt_ranking: { ...(debt.state.complete ? available() : unavailable(debt.state.issues)),
        ...(debt.value?.ranking || { total_receivable: null, positive_customer_count: null, items: [] }) } },
    pending: { ...pending.state, count: pending.value?.count ?? null, amount: pending.value?.amount ?? null },
    updated_at: now, complete, read_complete: readCompleteState, scope: 'visible_settlement_customers_including_inactive',
    consistency: 'live_read_non_atomic', snapshot_consistent: false, read_started_at: started, read_completed_at: Date.now(),
    source_counts: Object.fromEntries(Object.keys(TABLES).map(kind => [kind, failures.has(kind) || !inputs[kind] ? null :
      kind === 'customers' ? inputs.customers.filter(customer => customer.is_hidden !== true).length : inputs[kind].length])) }
}

module.exports = { readCurrentBrief }
