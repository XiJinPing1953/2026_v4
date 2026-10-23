'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { buildNotHiddenCustomerFieldsWhere, mergeWhere } = require('./customerVisibilityLocal')
const { isCashReceipt } = require('./receiptSourceLocal')
const F = require('./operatingBriefFinance')
const ALL = ['business', 'settlement', 'cash', 'destinations', 'evidence', 'operations']
const OP_FIELDS = ['sale_weight_kg', 'sale_bottle_count', 'customer_count', 'fill_bottle_weight_kg', 'fill_bottle_count',
  'local_weight_kg', 'local_count', 'vehicle_weight_kg', 'vehicle_count', 'recorded_outflow_kg']
const BATCH = 80
function batches(values) {
  const ids = [...new Set(values.map(F.text).filter(Boolean))], result = []
  for (let i = 0; i < ids.length; i += BATCH) result.push(ids.slice(i, i + BATCH))
  return result
}
function mergeRows(...groups) { return [...new Map(groups.flat().map(row => [F.text(row._id), row])).values()] }

async function readBriefFinance(db, data, helpers, range, { version, summarizeOperations }) {
  const started = Date.now(), command = db.command, reads = [], allowed = new Map(), errors = Object.fromEntries(ALL.map(key => [key, []]))
  let sourceReadComplete = true
  function failed(tags, error, name) {
    const details = error?.details || {}
    const safe = F.issue({ code: error?.code, details: { ...details, source_type: details.source_type || name } }, allowed)
    for (const tag of tags) errors[tag].push(safe)
  }
  async function read(name, where, tags, field) {
    try {
      const rows = await readComplete(db.collection(name), where, { command, field, source: name })
      if (!allowed.has(name)) allowed.set(name, new Set())
      for (const row of rows) if (row.is_hidden !== true) allowed.get(name).add(F.text(row._id))
      reads.push({ name, where, tags, count: rows.length })
      return rows
    } catch (error) { sourceReadComplete = false; failed(tags, error, name); return [] }
  }
  const customers = await read(F.TABLES.customers, {}, ALL, { is_hidden: true, settlement_customer_id: true, default_price_unit: true })
  const visibilityKnown = !errors.business.length
  const hidden = customers.filter(row => row.is_hidden === true).map(row => row._id)
  const customerWhere = buildNotHiddenCustomerFieldsWhere(command, hidden, ['customer_id'])
  const saleVisibility = buildNotHiddenCustomerFieldsWhere(command, hidden, ['customer_id', 'delivery_customer_id'])
  const dateWhere = key => command.and([{ [key]: command.gte(range.start) }, { [key]: command.lte(range.end) }])
  const dated = (key, visible, posted = false) => mergeWhere(command, command.and([dateWhere(key), ...(posted ? [{ status: 'posted' }] : [])]), visible)
  const safeRead = (name, where, tags) => visibilityKnown ? read(name, where, tags) : Promise.resolve([])
  async function byIds(name, ids, tags, { fields = ['_id'], visible = customerWhere, extra = null } = {}) {
    const rows = []
    for (const batch of batches(ids)) {
      const idsWhere = fields.length === 1 ? { [fields[0]]: command.in(batch) } : command.or(fields.map(key => ({ [key]: command.in(batch) })))
      const where = mergeWhere(command, extra ? command.and([idsWhere, extra]) : idsWhere, visible)
      rows.push(...await safeRead(name, where, tags))
    }
    return mergeRows(rows)
  }
  const [sales, flows, periodReceipts, fillings] = await Promise.all([
    safeRead(F.TABLES.sales, dated('date', saleVisibility), ['business', 'settlement', 'evidence', 'operations']),
    safeRead(F.TABLES.flows, dated('biz_date', customerWhere, true), ['business', 'settlement', 'evidence']),
    safeRead(F.TABLES.receipts, dated('biz_date', customerWhere, true), ['cash', 'destinations']),
    read('crm_fillings', dateWhere('date'), ['operations'])
  ])
  const cashReceipts = periodReceipts.filter(row => isCashReceipt(row) && Number(row.amount) > 0)
  const cohort = new Set([...sales.map(row => `sale:${row._id}`), ...flows.map(row => `flow_settlement:${row._id}`)])
  const [saleAllocations, flowAllocations, cashAllocations, intakes] = await Promise.all([
    byIds(F.TABLES.allocations, sales.map(row => row._id), ['evidence'], { fields: ['target_id', 'sale_id'] }),
    byIds(F.TABLES.allocations, flows.map(row => row._id), ['evidence'], { fields: ['target_id', 'sale_id', 'flow_settlement_id'] }),
    byIds(F.TABLES.allocations, cashReceipts.map(row => row._id), ['destinations'], { fields: ['receipt_id'] }),
    byIds(F.TABLES.intakes, periodReceipts.filter(row => row.source_type === 'cashier_intake').map(row => row.intake_id || row.source_id), ['cash', 'destinations'])
  ])
  const cohortAllocations = mergeRows(saleAllocations, flowAllocations)
  const targetIds = { sales: [], flows: [], debts: [] }
  for (const row of cashAllocations) try {
    if (!F.active(row, 'allocations')) continue
    const ref = F.targetRef(row); targetIds[ref.kind].push(ref.id)
  } catch (error) { failed(['destinations'], error, F.TABLES.allocations) }
  const [evidenceReceipts, destinationSales, destinationFlows, destinationDebts, refunds] = await Promise.all([
    byIds(F.TABLES.receipts, cohortAllocations.filter(row => !row.status || row.status === 'posted').map(row => row.receipt_id), ['evidence']),
    byIds(F.TABLES.sales, targetIds.sales, ['destinations'], { visible: saleVisibility }),
    byIds(F.TABLES.flows, targetIds.flows, ['destinations']),
    byIds(F.TABLES.debts, targetIds.debts, ['destinations']),
    byIds(F.TABLES.receipts, cashReceipts.map(row => row.customer_id), ['destinations'], { fields: ['customer_id'],
      extra: command.and([{ status: 'posted' }, { amount: command.lt(0) }]) })
  ])
  // Refund links can include several sources. Read every linked source of a
  // relevant refund, including outside the selected period, to verify ownership.
  const cashIds = new Set(cashReceipts.map(row => row._id)), refundSourceIds = []
  for (const row of refunds) if (Array.isArray(row.refund_sources) && row.refund_sources.some(link => cashIds.has(F.text(link.id))))
    for (const link of row.refund_sources) refundSourceIds.push(link.id)
  const refundSources = await byIds(F.TABLES.receipts, refundSourceIds, ['destinations'])

  // Recheck every scope after all dependencies were read. Counts and timestamps
  // detect supported changes, but are not an atomic historical snapshot.
  for (let index = 0; index < reads.length; index += 4) await Promise.all(reads.slice(index, index + 4).map(async query => {
    try {
      const collection = db.collection(query.name)
      const [after, changed] = await Promise.all([collection.where(query.where).count(), collection.where(command.and([query.where, command.or([
        { updated_at: command.gte(started) }, { created_at: command.gte(started) }
      ])])).limit(1).get()])
      if (!['number', 'string'].includes(typeof after.total) || F.text(after.total) === '' || !Number.isSafeInteger(Number(after.total)) || Number(after.total) !== query.count)
        throw new FinancialReadError('membership_changed_during_brief', { source: query.name })
      if (!Array.isArray(changed.data) || changed.data.length) throw new FinancialReadError('records_changed_during_brief', { source: query.name })
    } catch (error) { sourceReadComplete = false; failed(query.tags, error, query.name) }
  }))
  const business = F.businessSummary({ sales, flows, customers }, errors.business, errors.settlement)
  const cash = F.cashSummary({ receipts: periodReceipts, intakes, customers }, errors.cash)
  cash.evidence = F.sourceEvidence({ customers, cohort, cohortSales: sales, cohortFlows: flows, sales, flows, debts: [],
    receipts: evidenceReceipts, allocations: cohortAllocations }, errors.evidence)
  cash.destinations = F.cashDestinations({ customers, periodReceipts, receipts: mergeRows(periodReceipts, refundSources),
    allocations: cashAllocations, sales: destinationSales, flows: destinationFlows, debts: destinationDebts, refunds }, range,
  [...errors.destinations, ...(!cash.complete ? cash.issues : [])])
  let operations
  try {
    if (errors.operations.length) operations = F.unavailable(OP_FIELDS, errors.operations)
    else {
      const scope = F.scopeFor(customers)
      for (const row of sales) scope.owner(row, 'sales')
      operations = { ...summarizeOperations(sales.filter(row => F.active(row, 'sales')), fillings, helpers), ...F.state() }
    }
  } catch (error) { operations = F.unavailable(OP_FIELDS, [F.issue(error, allowed)]) }
  // Sanitize IDs once more before crossing the endpoint boundary. Missing or
  // hidden references are described using the visible referring source only.
  for (const domain of [business, business.positive_settlement, cash, cash.evidence, cash.destinations, operations])
    domain.issues = domain.issues.map(row => row.source_id && !allowed.get(row.source_type)?.has(row.source_id)
      ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'source_id')) : row)
  const complete = [business, business.positive_settlement, cash, cash.evidence, cash.destinations, operations].every(row => row.complete)
  return { code: 0, data: { section: 'brief', version, finance_version: F.VERSION, period: data.period || 'yesterday', range, money_scale: 3,
    business, cash, operations, complete, read_complete: sourceReadComplete,
    accounting: { complete, status: complete ? 'resolved' : 'unresolved' }, updated_at: Date.now(),
    read_started_at: started, read_completed_at: Date.now(), consistency: 'live_read_non_atomic', snapshot_consistent: false } }
}

module.exports = { readBriefFinance, BATCH }
