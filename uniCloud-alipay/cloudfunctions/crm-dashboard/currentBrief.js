'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { computeSaleSnapshot, computeFlowSettlementSnapshot, computeOpeningDebtSnapshot,
  resolveCustomerMoneyScale, resolveOpeningDebtMoneyScale } = require('./customerBalanceLocal').createCustomerBalance(require('./saleAccountingLocal'))
const { isOffsetCreditReceipt, isDepositTransferReceipt, isSettlementFeeReceipt } = require('./receiptSourceLocal')
const { validateSale } = require('./saleSourceValidation')
const VERSION = 'operating-brief/2026-10-23.1'
const TABLES = { customers: 'crm_customers', sales: 'crm_sale_records', flows: 'crm_customer_flow_settlements',
  debts: 'crm_customer_opening_debts', receipts: 'crm_customer_receipts', intakes: 'crm_cashier_intakes' }
const text = value => String(value ?? '').trim()
function unresolved(reason, row, details = {}) {
  const error = new FinancialReadError(reason, { source: 'operating_brief_current', source_id: text(row?._id), ...details })
  error.message = '当前账务来源待核，未返回确定的欠款或可用款合计'
  throw error
}
function numeric(value, row, field, { optional = false, signed = false } = {}) {
  if (optional && value == null) return 0
  if (!['string', 'number'].includes(typeof value) || text(value) === '' || !Number.isFinite(Number(value)) ||
      !signed && Number(value) < 0) unresolved('invalid_source_amount', row, { field })
  return Number(value)
}
function units(value, row, field, options = {}) {
  const number = numeric(value, row, field, options), scaled = Math.round(number * 1000)
  if (!Number.isSafeInteger(scaled) || Math.abs(number * 1000 - scaled) > 0.00001)
    unresolved('invalid_source_precision', row, { field })
  return scaled
}
function add(left, right) {
  const total = left + right
  if (!Number.isSafeInteger(total)) unresolved('amount_overflow')
  return total
}
function active(row, kind) {
  if (row.status === 'void') return false
  if (row.status === 'posted' || kind === 'sales' && !row.status) return true
  unresolved('source_status_missing', row, { source_type: kind })
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
    if (!id || !byId.has(id)) unresolved('source_customer_missing', row)
    const root = resolve(id)
    // Historical money left on a delivery location cannot be silently reassigned.
    if (root !== id) unresolved('source_on_delivery_customer', row)
    if (sale && text(row.delivery_customer_id) && resolve(text(row.delivery_customer_id)) !== root)
      unresolved('delivery_customer_mismatch', row)
    return byId.get(root)
  }
  return { owner, count: new Set(roots.values()).size }
}
function sourceGroup(row) {
  if (['opening_prepay', 'deposit_transfer', 'settlement_fee'].includes(row.source_type)) return row.source_type
  return row.source_type === 'customer_prepay_manual' ? 'manual_prepay' : 'receipt_unallocated'
}
function summarize(inputs) {
  const scope = customerScope(inputs.customers), byCustomer = new Map(), receiptById = new Map(), intakeById = new Map()
  const groups = { manual_prepay: 0, receipt_unallocated: 0, opening_prepay: 0, deposit_transfer: 0, settlement_fee: 0 }
  for (const kind of ['sales', 'flows', 'debts']) for (const row of inputs[kind]) {
    if (!active(row, kind)) continue
    const customer = scope.owner(row, kind === 'sales')
    units(row.amount_received, row, 'amount_received', { signed: true })
    units(row.receipt_rounding_amount, row, 'receipt_rounding_amount', { optional: true })
    units(row.rounding_amount, row, 'rounding_amount', { optional: true })
    let snapshot
    if (kind === 'sales') { snapshot = computeSaleSnapshot(row); validateSale(row) }
    else if (kind === 'flows') {
      units(row.should_receive, row, 'should_receive', { signed: true }); snapshot = computeFlowSettlementSnapshot(row)
    } else {
      units(row.amount, row, 'amount', { signed: true })
      snapshot = computeOpeningDebtSnapshot(row, resolveOpeningDebtMoneyScale(row, resolveCustomerMoneyScale(customer)))
    }
    const value = units(snapshot.outstanding, row, 'outstanding')
    byCustomer.set(customer._id, add(byCustomer.get(customer._id) || 0, value))
  }
  for (const row of inputs.intakes) if (active(row, 'intakes')) { scope.owner(row); intakeById.set(row._id, row) }
  let offsetAvailable = 0
  const cashierSources = new Set()
  for (const row of inputs.receipts) {
    if (!active(row, 'receipts')) continue
    scope.owner(row)
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
    receiptById.set(row._id, row)
  }
  // Refunds are already reflected in source availability. Check their links once,
  // without subtracting the cash event again from that availability.
  const refunds = new Map()
  for (const row of receiptById.values()) {
    let links = []
    if (row.source_type === 'customer_cash_refund') {
      if (row.refund_source_status !== 'linked' || !Array.isArray(row.refund_sources) || !row.refund_sources.length)
        unresolved('refund_sources_missing', row)
      links = row.refund_sources
    } else if (row.source_type === 'offset_credit_cash_refund') links = [{ id: row.offset_source_receipt_id, amount: -Number(row.amount) }]
    if (!links.length) continue
    const seen = new Set(); let total = 0
    for (const link of links) {
      const source = receiptById.get(link.id), amount = units(link.amount, row, 'refund_sources.amount')
      if (!source || source.customer_id !== row.customer_id || !(Number(source.amount) > 0) || !amount || seen.has(link.id) ||
          isDepositTransferReceipt(source) || isSettlementFeeReceipt(source)) unresolved('refund_source_mismatch', row)
      if (row.source_type === 'offset_credit_cash_refund' && !isOffsetCreditReceipt(source)) unresolved('refund_source_mismatch', row)
      seen.add(link.id); total = add(total, amount); refunds.set(link.id, add(refunds.get(link.id) || 0, amount))
    }
    if (total !== -units(row.amount, row, 'amount', { signed: true })) unresolved('refund_amount_mismatch', row)
  }
  let prepay = 0, pendingAmount = 0, pendingCount = 0
  const linkedReceipts = new Set()
  for (const row of receiptById.values()) {
    const refunded = units(row[isOffsetCreditReceipt(row) ? 'offset_cash_refunded_amount' : 'cash_refunded_amount'], row, 'refunded_amount', { optional: true })
    if (refunded !== (refunds.get(row._id) || 0)) unresolved('refund_backing_mismatch', row)
    if (text(row.intake_id)) {
      const head = intakeById.get(row.intake_id)
      if (!head || head.receipt_id !== row._id) unresolved('receipt_intake_missing', row)
    }
  }
  for (const head of intakeById.values()) {
    const gas = units(head.gas_amount, head, 'gas_amount'), deposit = units(head.deposit_amount, head, 'deposit_amount')
    if (units(head.amount, head, 'amount') !== add(gas, deposit) || deposit % 10) unresolved('intake_split_mismatch', head)
    if (!['prepay', 'settlement', 'unspecified'].includes(head.purpose)) unresolved('intake_purpose_missing', head)
    if (gas === 0) {
      if (head.receipt_id) unresolved('intake_unexpected_receipt', head)
      continue
    }
    const row = receiptById.get(head.receipt_id)
    if (!row || row.intake_id !== head._id || row.customer_id !== head.customer_id || row.source_type !== 'cashier_intake' ||
        row.purpose !== head.purpose || units(row.amount, row, 'amount') !== gas || row.biz_date !== head.biz_date ||
        row.payment_method !== head.payment_method || linkedReceipts.has(row._id)) unresolved('intake_receipt_mismatch', head)
    linkedReceipts.add(row._id)
    const available = units(row.unallocated_amount, row, 'unallocated_amount')
    if (head.purpose === 'settlement' && available > 0) { pendingCount++; pendingAmount = add(pendingAmount, available) }
  }
  for (const amount of Object.values(groups)) prepay = add(prepay, amount)
  let receivable = 0
  for (const amount of byCustomer.values()) receivable = add(receivable, amount)
  return { current: { receivable: receivable / 1000, prepay: prepay / 1000, complete: true, customer_count: scope.count,
    prepay_label: '可用款（不含退气抵款）', prepay_sources: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value / 1000])),
    offset_credit: offsetAvailable / 1000 }, pending: { count: pendingCount, amount: pendingAmount / 1000, complete: true } }
}
async function readCurrentBrief(db, { now = Date.now() } = {}) {
  const started = Date.now(), command = db.command, inputs = {}, reads = []
  async function read(kind, where = {}, field) {
    const collection = db.collection(TABLES[kind])
    const rows = await readComplete(collection, where, { command, field, source: `operating_brief_current.${kind}` })
    inputs[kind] = rows; reads.push({ kind, collection, where, count: rows.length })
  }
  await read('customers', {}, { _id: true, name: true, default_price_unit: true, settlement_customer_id: true, is_hidden: true })
  const hidden = inputs.customers.filter(row => row.is_hidden === true).map(row => row._id)
  const where = hidden.length ? { customer_id: command.nin(hidden) } : {}
  const saleWhere = hidden.length ? command.and([where, { delivery_customer_id: command.nin(hidden) }]) : where
  const kinds = ['sales', 'flows', 'debts', 'receipts', 'intakes']
  for (let i = 0; i < kinds.length; i += 3) await Promise.all(kinds.slice(i, i + 3).map(kind => read(kind, kind === 'sales' ? saleWhere : where)))
  const result = summarize(inputs)
  // readComplete verifies each collection. Recheck every scope over the entire
  // request as well: a source may change while later collections are loading.
  for (const { kind, collection, where, count } of reads) {
    const [after, changed] = await Promise.all([collection.where(where).count(), collection.where(command.and([where,
      command.or([{ updated_at: command.gte(started) }, { created_at: command.gte(started) }])])).limit(1).get()])
    if (!['number', 'string'].includes(typeof after.total) || text(after.total) === '' || !Number.isSafeInteger(Number(after.total)) || Number(after.total) !== count ||
        !Array.isArray(changed.data) || changed.data.length) throw new FinancialReadError('current_window_changed', { source: kind, expected_rows: count })
  }
  return { section: 'current', version: VERSION, money_scale: 3, ...result, updated_at: now, complete: true,
    scope: 'visible_settlement_customers_including_inactive', consistency: 'live_read_non_atomic', snapshot_consistent: false,
    read_started_at: started, read_completed_at: Date.now(), source_counts: Object.fromEntries(reads.map(row =>
      [row.kind, row.kind === 'customers' ? inputs.customers.filter(customer => customer.is_hidden !== true).length : row.count])) }
}

module.exports = { readCurrentBrief }
