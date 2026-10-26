'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { buildNotHiddenCustomerFieldsWhere, mergeWhere } = require('./customerVisibilityLocal')
const { isCashReceipt } = require('./receiptSourceLocal')
const F = require('./operatingBriefFinance')
const A = require('./operatingBriefAnalysis')
const CORE = ['business', 'settlement', 'cash', 'destinations', 'evidence', 'operations']
const ALL = [...CORE, 'analysis_sales', 'analysis_business', 'analysis_cash']
const OP_FIELDS = ['sale_weight_kg', 'sale_bottle_count', 'customer_count', 'fill_bottle_weight_kg', 'fill_bottle_count',
  'local_weight_kg', 'local_count', 'vehicle_weight_kg', 'vehicle_count', 'recorded_outflow_kg']
const BATCH = 80
const BATCH_CONCURRENCY = 3
const DOCUMENT_CONCURRENCY = 8
function batches(values) {
  const ids = [...new Set(values.map(F.text).filter(Boolean))], result = []
  for (let i = 0; i < ids.length; i += BATCH) result.push(ids.slice(i, i + BATCH))
  return result
}
function mergeRows(...groups) { return [...new Map(groups.flat().map(row => [F.text(row._id), row])).values()] }
function documentFromResult(result, id, name) {
  if (!result || !Object.prototype.hasOwnProperty.call(result, 'data')) throw new FinancialReadError('invalid_document_response', { source: name })
  const value = result.data
  const row = Array.isArray(value) ? value.length === 0 ? null : value.length === 1 ? value[0] : undefined : value
  if (row === null) return null
  if (!row || typeof row !== 'object' || Array.isArray(row) || F.text(row._id) !== id)
    throw new FinancialReadError('invalid_document_response', { source: name })
  return row
}
const fingerprint = value => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child)

async function readBriefFinance(db, data, helpers, range, { version, summarizeOperations, primaryOnly = false }) {
  const analysisPlan = A.analysisPlan(data.period || 'yesterday', range)
  const sourceRange = primaryOnly ? range : analysisPlan.read_range
  const expandedRange = sourceRange.start < range.start || sourceRange.end > range.end
  let expandedReadFailed = false
  const started = Date.now(), command = db.command, reads = [], documentReads = [], sourceCache = new Map(), allowed = new Map(), errors = Object.fromEntries(ALL.map(key => [key, []]))
  let sourceReadComplete = true
  let activeDocuments = 0
  const documentWaiters = []
  async function documentGet(name, id) {
    if (activeDocuments < DOCUMENT_CONCURRENCY) activeDocuments++
    else await new Promise(resolve => documentWaiters.push(resolve))
    try { return await db.collection(name).doc(id).get() }
    finally {
      const next = documentWaiters.shift()
      if (next) next()
      else activeDocuments--
    }
  }
  function remember(name, id, row, record) {
    if (!sourceCache.has(name)) sourceCache.set(name, new Map())
    sourceCache.get(name).set(id, { row, record })
  }
  function failed(tags, error, name) {
    const details = error?.details || {}
    const safe = F.issue({ code: error?.code, details: { ...details, source_type: details.source_type || name } }, allowed)
    for (const tag of tags) errors[tag].push(safe)
  }
  async function read(name, where, tags, field, { expanded = false } = {}) {
    try {
      const rows = await readComplete(db.collection(name), where, { command, field, source: name })
      if (!allowed.has(name)) allowed.set(name, new Set())
      for (const row of rows) if (row.is_hidden !== true) allowed.get(name).add(F.text(row._id))
      const record = { name, where, tags, count: rows.length, expanded }
      reads.push(record)
      if (!field) for (const row of rows) remember(name, F.text(row._id), row, record)
      return rows
    } catch (error) {
      if (expanded) expandedReadFailed = true
      if (tags.some(tag => CORE.includes(tag))) sourceReadComplete = false
      failed(tags, error, name); return []
    }
  }
  const customers = await read(F.TABLES.customers, {}, ALL, { is_hidden: true, settlement_customer_id: true, default_price_unit: true, name: true, qr_code: true })
  const visibilityKnown = !errors.business.length
  const hidden = customers.filter(row => row.is_hidden === true).map(row => row._id)
  const hiddenIds = new Set(hidden.map(F.text))
  const customerWhere = buildNotHiddenCustomerFieldsWhere(command, hidden, ['customer_id'])
  const saleVisibility = buildNotHiddenCustomerFieldsWhere(command, hidden, ['customer_id', 'delivery_customer_id'])
  const dateWhere = (key, selectedRange = range) => command.and([{ [key]: command.gte(selectedRange.start) }, { [key]: command.lte(selectedRange.end) }])
  const dated = (key, visible, posted = false, selectedRange = range) => mergeWhere(command, command.and([dateWhere(key, selectedRange), ...(posted ? [{ status: 'posted' }] : [])]), visible)
  const safeRead = (name, where, tags, options) => visibilityKnown ? read(name, where, tags, undefined, options) : Promise.resolve([])
  async function missingDocument(name, id, tags) {
    if (!visibilityKnown) return null
    try {
      const row = documentFromResult(await documentGet(name, id), id, name)
      // A write after this request began may precede the first fallback read;
      // two equal fingerprints alone would miss that cross-source change.
      if (row && ['created_at', 'updated_at'].some(field => Number.isFinite(Number(row[field])) && Number(row[field]) >= started))
        throw new FinancialReadError('records_changed_during_brief', { source: name })
      const record = { name, id, tags, fingerprint: fingerprint(row) }
      documentReads.push(record)
      // A document lookup bypasses the query's visibility predicate. Apply the
      // exact same source/customer exclusion before adding it to any domain.
      if (!row || hiddenIds.has(F.text(row.customer_id)) || name === F.TABLES.sales && hiddenIds.has(F.text(row.delivery_customer_id))) {
        remember(name, id, null, record)
        return null
      }
      if (!allowed.has(name)) allowed.set(name, new Set())
      allowed.get(name).add(id)
      remember(name, id, row, record)
      return row
    } catch (error) { if (tags.some(tag => CORE.includes(tag))) sourceReadComplete = false; failed(tags, error, name); return null }
  }
  async function byIds(name, ids, tags, { fields = ['_id'], visible = customerWhere, extra = null } = {}) {
    const rows = [], chunks = batches(ids)
    for (let index = 0; index < chunks.length; index += BATCH_CONCURRENCY) await Promise.all(chunks.slice(index, index + BATCH_CONCURRENCY).map(async batch => {
      const documentIds = fields.length === 1 && fields[0] === '_id' && !extra
      const requested = documentIds ? batch.filter(id => {
        const cached = sourceCache.get(name)?.get(id)
        if (!cached) return true
        // Reuse already read period sources and attach the new domain to their
        // original end-of-read verification, rather than querying them again.
        cached.record.tags = [...new Set([...cached.record.tags, ...tags])]
        if (cached.row) rows.push(cached.row)
        return false
      }) : batch
      if (!requested.length) return
      const idsWhere = fields.length === 1 ? { [fields[0]]: command.in(requested) } : command.or(fields.map(key => ({ [key]: command.in(requested) })))
      const where = mergeWhere(command, extra ? command.and([idsWhere, extra]) : idsWhere, visible)
      const found = await safeRead(name, where, tags)
      rows.push(...found)
      // Alipay automatically generated IDs can be omitted by `_id in`, even
      // when both count() and get() consistently return zero. Settlement's
      // getDocsByIds uses this same document fallback; count alone is no proof
      // that a referenced document is absent.
      if (documentIds) {
        const foundIds = new Set(found.map(row => F.text(row._id))), missing = requested.filter(id => !foundIds.has(id))
        for (let offset = 0; offset < missing.length; offset += DOCUMENT_CONCURRENCY) {
          const recovered = await Promise.all(missing.slice(offset, offset + DOCUMENT_CONCURRENCY).map(id => missingDocument(name, id, tags)))
          rows.push(...recovered.filter(Boolean))
        }
      }
    }))
    return mergeRows(rows)
  }
  // One full source read serves the displayed period, comparison windows and
  // seven completed days. Validation is applied after slicing each domain, so
  // a bad historical row cannot invalidate today's otherwise independent value.
  const [analysisSales, analysisFlows, analysisReceipts, fillings] = await Promise.all([
    safeRead(F.TABLES.sales, dated('date', saleVisibility, false, sourceRange), ['business', 'settlement', 'evidence', 'operations', 'analysis_sales', 'analysis_business'], { expanded: expandedRange }),
    safeRead(F.TABLES.flows, dated('biz_date', customerWhere, true, sourceRange), ['business', 'settlement', 'evidence', 'analysis_business'], { expanded: expandedRange }),
    safeRead(F.TABLES.receipts, dated('biz_date', customerWhere, true, sourceRange), ['cash', 'destinations', 'analysis_cash'], { expanded: expandedRange }),
    read('crm_fillings', dateWhere('date'), ['operations'])
  ])
  const sales = analysisSales.filter(row => A.contains(range, row.date))
  const flows = analysisFlows.filter(row => A.contains(range, row.biz_date))
  const periodReceipts = analysisReceipts.filter(row => A.contains(range, row.biz_date))
  // Historical comparison rows are not substitutes for the existing verified
  // document fallback used by current allocation/refund references. In
  // particular, legacy referenced rows without updated_at still need their
  // second complete-content read even if the analysis scan happened to see them.
  for (const [name, rows] of [[F.TABLES.sales, sales], [F.TABLES.flows, flows], [F.TABLES.receipts, periodReceipts]]) {
    const selectedIds = new Set(rows.map(row => F.text(row._id)))
    for (const id of sourceCache.get(name)?.keys() || []) if (!selectedIds.has(id)) sourceCache.get(name).delete(id)
  }
  const cashReceipts = periodReceipts.filter(row => isCashReceipt(row) && Number(row.amount) > 0)
  const cohort = new Set([...sales.map(row => `sale:${row._id}`), ...flows.map(row => `flow_settlement:${row._id}`)])
  const cashReceiptIds = new Set(cashReceipts.map(row => F.text(row._id)))
  const intakeRead = () => byIds(F.TABLES.intakes, periodReceipts.filter(row => row.source_type === 'cashier_intake').map(row => row.intake_id || row.source_id), ['cash', 'destinations'])
  let cohortAllocations, cashAllocations, intakes
  if (cohort.size + cashReceiptIds.size > BATCH) {
    // On Alipay, many target/receipt OR-in predicates scan the allocation table
    // repeatedly and can time out. For a large cohort, read the visible table
    // once with complete keyset pagination, then select the same references.
    // readComplete's row limit and the final scope recheck still apply; a failed
    // full read invalidates both uses rather than returning a partial subtotal.
    const [allAllocations, intakeRows] = await Promise.all([
      safeRead(F.TABLES.allocations, customerWhere || {}, ['evidence', 'destinations']), intakeRead()
    ])
    const cohortIds = new Set([...sales, ...flows].map(row => F.text(row._id)))
    const flowIds = new Set(flows.map(row => F.text(row._id)))
    cohortAllocations = allAllocations.filter(row => ['target_id', 'sale_id'].some(key => cohortIds.has(F.text(row[key]))) || flowIds.has(F.text(row.flow_settlement_id)))
    cashAllocations = allAllocations.filter(row => cashReceiptIds.has(F.text(row.receipt_id)))
    intakes = intakeRows
  } else {
    const [saleRows, flowRows, cashRows, intakeRows] = await Promise.all([
      byIds(F.TABLES.allocations, sales.map(row => row._id), ['evidence'], { fields: ['target_id', 'sale_id'] }),
      byIds(F.TABLES.allocations, flows.map(row => row._id), ['evidence'], { fields: ['target_id', 'sale_id', 'flow_settlement_id'] }),
      byIds(F.TABLES.allocations, [...cashReceiptIds], ['destinations'], { fields: ['receipt_id'] }), intakeRead()
    ])
    cohortAllocations = mergeRows(saleRows, flowRows); cashAllocations = cashRows; intakes = intakeRows
  }
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
  const analysisIntakes = await byIds(F.TABLES.intakes,
    analysisReceipts.filter(row => row.source_type === 'cashier_intake').map(row => row.intake_id || row.source_id), ['analysis_cash'])

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
    } catch (error) {
      if (query.expanded) expandedReadFailed = true
      if (query.tags.some(tag => CORE.includes(tag))) sourceReadComplete = false
      failed(query.tags, error, query.name)
    }
  }))
  // Fallback documents are outside a reliable `_id in` query scope. Re-read
  // every one (including verified absences), comparing complete content so
  // deletion/replacement and legacy writes without updated_at are detected.
  for (let index = 0; index < documentReads.length; index += DOCUMENT_CONCURRENCY) await Promise.all(documentReads.slice(index, index + DOCUMENT_CONCURRENCY).map(async record => {
    try {
      const row = documentFromResult(await documentGet(record.name, record.id), record.id, record.name)
      if (fingerprint(row) !== record.fingerprint) throw new FinancialReadError('records_changed_during_brief', { source: record.name })
    } catch (error) { if (record.tags.some(tag => CORE.includes(tag))) sourceReadComplete = false; failed(record.tags, error, record.name) }
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
  const analysisMetadata = { read_started_at: started, read_completed_at: Date.now(),
    issues: { sales: errors.analysis_sales, business: errors.analysis_business, cash: errors.analysis_cash } }
  let analysisBundle
  try { analysisBundle = A.buildAnalysis({ customers, sales: analysisSales, flows: analysisFlows, receipts: analysisReceipts, intakes: analysisIntakes }, helpers, analysisPlan, analysisMetadata) }
  catch (error) {
    // An analysis-only overflow or unexpected source shape cannot erase the
    // independently computed current brief. A failed comparison is not zero.
    const issues = [F.issue(error, allowed)]
    analysisBundle = A.buildAnalysis({ customers: [], sales: [], flows: [], receipts: [], intakes: [] }, helpers, analysisPlan,
      { ...analysisMetadata, issues: { sales: issues, business: issues, cash: issues } })
  }
  if (data.section === 'brief_sources') return A.sourcePage(analysisBundle, data)
  if (expandedReadFailed && !primaryOnly) {
    // An optional history window can exceed a limit, fail, or change even when
    // the requested period is fully readable. Re-read that period and ALL of
    // its finance dependencies once, with the original completeness checks.
    // Keep the failed historical analysis explicit; never publish the empty
    // historical buckets produced by the smaller fallback read as real zeros.
    const currentResult = await readBriefFinance(db, data, helpers, range, { version, summarizeOperations, primaryOnly: true })
    if (currentResult.code === 0 && currentResult.data) currentResult.data.analysis = analysisBundle.analysis
    return currentResult
  }
  return { code: 0, data: { section: 'brief', version, finance_version: F.VERSION, period: data.period || 'yesterday', range, money_scale: 3,
    business, cash, operations, complete, read_complete: sourceReadComplete, analysis: analysisBundle.analysis,
    accounting: { complete, status: complete ? 'resolved' : 'unresolved' }, updated_at: Date.now(),
    read_started_at: started, read_completed_at: Date.now(), consistency: 'live_read_non_atomic', snapshot_consistent: false } }
}

module.exports = { readBriefFinance, BATCH }
