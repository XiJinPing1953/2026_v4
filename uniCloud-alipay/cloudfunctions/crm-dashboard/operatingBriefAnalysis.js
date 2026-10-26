'use strict'

// Analytical views use the same source eligibility and money rules as the brief.
// Their independent verifier deliberately lives outside this deployment module.
const crypto = require('crypto')
const F = require('./operatingBriefFinance')
const { validateSaleOperations } = require('./saleSourceValidation')
const { isCashReceipt } = require('./receiptSourceLocal')

const VERSION = 'operating-analysis/2026-10-26.1'
const DAY = 86400000
const METRICS = ['sale_weight_kg', 'business_net', 'cash_net', 'customer_count']
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
const dates = range => {
  const result = []
  if (range) for (let date = range.start; date <= range.end; date = shift(date, 1)) result.push(date)
  return result
}

function analysisPlan(period, range) {
  const trend = { start: shift(range.today, -7), end: shift(range.today, -1) }
  let current = null, baseline = null, reason = ''
  if (period === 'yesterday') {
    current = { start: range.start, end: range.end }
    baseline = { start: shift(range.start, -1), end: shift(range.end, -1) }
  } else if (period === 'month') {
    const monthStart = `${range.today.slice(0, 7)}-01`, previousEnd = shift(monthStart, -1)
    const n = Math.min(Number(range.today.slice(8)) - 1, Number(previousEnd.slice(8)))
    if (n > 0) {
      const day = String(n).padStart(2, '0')
      current = { start: monthStart, end: `${range.today.slice(0, 7)}-${day}` }
      baseline = { start: `${previousEnd.slice(0, 7)}-01`, end: `${previousEnd.slice(0, 7)}-${day}` }
    } else reason = '本月尚无完整自然日，暂不比较'
  } else reason = '今天尚未结束，缺少完整且可对齐的业务时刻，暂不比较'
  const starts = [range.start, trend.start, current?.start, baseline?.start].filter(Boolean)
  return { period, period_range: { start: range.start, end: range.end }, trend, current, baseline, reason,
    read_range: { start: starts.sort()[0], end: range.end }, today: range.today }
}

function contains(range, value) {
  if (!range || typeof value !== 'string') return false
  // A malformed date with a recognizable day still invalidates that day instead
  // of vanishing from the analytical subset. It never becomes a valid date.
  const day = value.slice(0, 10)
  return day >= range.start && day <= range.end
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
function evidenceToken(input, plan, issues) {
  const collections = {}
  for (const kind of ['customers', 'sales', 'flows', 'receipts', 'intakes']) collections[kind] = [...(input[kind] || [])]
    .filter(row => kind !== 'customers' || row.is_hidden !== true).sort((a, b) => F.text(a._id).localeCompare(F.text(b._id), 'en'))
  return crypto.createHash('sha256').update(JSON.stringify(canonical({ version: VERSION, plan, collections, issues }))).digest('hex')
}
function quantity(value) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 1000))) {
    const error = new Error('数量无效'); error.code = 'quantity_overflow'; throw error
  }
  return Math.round(value * 1000)
}
function dateError(row, kind) {
  if (!F.validDate(kind === 'sales' ? row.date : row.biz_date)) {
    const error = new Error('日期无效'); error.code = 'source_date_invalid'
    error.details = { source_type: F.TABLES[kind], source_id: row._id }; throw error
  }
}
function sum(values) { return values.reduce((total, value) => F.add(total, value), 0) }
function uniqueIssues(issues) { return F.state(issues).issues }

function buildAnalysis(input, helpers, plan, metadata = {}) {
  const scope = F.scopeFor(input.customers || [])
  const allowed = new Map(Object.entries(F.TABLES).map(([kind, name]) => [name,
    new Set((input[kind] || []).filter(row => row.is_hidden !== true).map(row => F.text(row._id)))]))
  const safeIssue = error => F.issue(error, allowed)
  const readIssues = metadata.issues || {}
  const customer = id => scope.customer(id) || {}
  const records = { sales: [], business: [], cash: [] }
  const safeRow = (row, kind, owner, value, unit, issues = []) => ({ source_type: F.TABLES[kind], source_id: F.text(row._id),
    date: F.text(kind === 'sales' ? row.date : row.biz_date), customer_id: owner || null,
    customer_name: owner ? F.text(customer(owner).name) : '',
    label: kind === 'sales' ? '销售单' : kind === 'flows' ? '流量结算单' : '正式收退款单',
    value, unit, status: issues.length ? 'unavailable' : 'available', issues: uniqueIssues(issues) })

  for (const [kind, rows] of [['sales', input.sales || []], ['flows', input.flows || []]]) for (const row of rows) {
    let owner = null, eligibility = []
    try {
      if (!F.active(row, kind)) continue
      owner = scope.owner(row, kind); dateError(row, kind)
    } catch (error) { eligibility.push(safeIssue(error)) }
    const result = F.businessSummary({ sales: kind === 'sales' ? [row] : [], flows: kind === 'flows' ? [row] : [], customers: input.customers })
    const businessIssues = uniqueIssues([...eligibility, ...result.issues])
    records.business.push(safeRow(row, kind, owner, businessIssues.length ? null : result.net, '元', businessIssues))
    if (kind === 'sales') {
      let value = null, physicalIssues = [...eligibility]
      try {
        if (!physicalIssues.length) { validateSaleOperations(row); value = quantity(helpers.computeSaleWeight(row)) / 1000 }
      } catch (error) { physicalIssues.push(safeIssue(error)) }
      const entry = safeRow(row, kind, owner, value, 'kg', physicalIssues)
      // Customer count needs eligibility and ownership, not a guessed weight.
      entry.customer_issues = eligibility
      entry.customer_key = eligibility.length ? null : helpers.buildCustomerKey(row)
      records.sales.push(entry)
    }
  }
  for (const row of input.receipts || []) {
    let owner = null, eligibility = []
    try { if (!F.active(row, 'receipts') || !isCashReceipt(row)) continue; owner = scope.owner(row, 'receipts'); dateError(row, 'receipts') }
    catch (error) { eligibility.push(safeIssue(error)) }
    const result = F.cashSummary({ receipts: [row], intakes: input.intakes, customers: input.customers })
    const issues = uniqueIssues([...eligibility, ...result.issues])
    records.cash.push(safeRow(row, 'receipts', owner, issues.length ? null : result.net, '元', issues))
  }

  function metricRows(metric, range) {
    const list = metric === 'business_net' ? records.business : metric === 'cash_net' ? records.cash : records.sales
    return list.filter(row => contains(range, row.date))
  }
  function summary(metric, range) {
    const rows = metricRows(metric, range)
    const key = metric === 'business_net' ? 'business' : metric === 'cash_net' ? 'cash' : 'sales'
    const issues = [...(readIssues[key] || []), ...rows.flatMap(row => metric === 'customer_count' ? row.customer_issues : row.issues)]
    // Cross-receipt duplicates are only meaningful inside the selected range.
    if (metric === 'cash_net') {
      const cash = F.cashSummary({ customers: input.customers, intakes: input.intakes,
        receipts: (input.receipts || []).filter(row => contains(range, row.biz_date)) }, readIssues.cash || [])
      issues.push(...cash.issues)
    }
    let value = null
    if (!issues.length) try {
      value = metric === 'customer_count' ? new Set(rows.map(row => row.customer_key).filter(Boolean)).size
        : sum(rows.map(row => quantity(row.value))) / 1000
    } catch (error) { issues.push(safeIssue(error)) }
    return { status: issues.length ? 'unavailable' : 'available', value: issues.length ? null : value,
      source_count: rows.length, issues: uniqueIssues(issues) }
  }
  const points = dates(plan.trend).map(date => ({ date, ...summary('sale_weight_kg', { start: date, end: date }) }))
  const trendIssues = uniqueIssues(points.flatMap(row => row.issues))
  const trend = { range: plan.trend, points, status: points.every(row => row.status === 'available') ? 'available'
    : points.some(row => row.status === 'available') ? 'partial' : 'unavailable', issues: trendIssues,
    metric: 'sale_weight_kg', label: '销售净气量', unit: 'kg', time_basis: 'completed_business_days' }
  const metrics = {}
  for (const key of METRICS) {
    if (!plan.current || !plan.baseline) metrics[key] = { status: 'not_comparable', current: null, baseline: null, delta: null, rate: null, issues: [] }
    else {
      const current = summary(key, plan.current), baseline = summary(key, plan.baseline)
      let complete = current.status === 'available' && baseline.status === 'available', delta = null
      const issues = [...current.issues, ...baseline.issues]
      if (complete) try { delta = F.add(quantity(current.value), -quantity(baseline.value)) / 1000 }
      catch (error) { complete = false; issues.push(safeIssue(error)) }
      metrics[key] = { status: complete ? 'available' : 'unavailable', current: current.value, baseline: baseline.value,
        delta, rate: complete && baseline.value > 0 ? delta / baseline.value : null,
        issues: uniqueIssues(issues) }
    }
  }
  const statuses = Object.values(metrics).map(row => row.status)
  const comparison = { current_range: plan.current, baseline_range: plan.baseline,
    status: !plan.current ? 'not_comparable' : statuses.every(value => value === 'available') ? 'available'
      : statuses.some(value => value === 'available') ? 'partial' : 'unavailable', reason: plan.reason, metrics,
    time_basis: 'completed_business_days', common_days: plan.current ? dates(plan.current).length : 0 }
  let drivers = { status: !plan.current ? 'not_comparable' : 'unavailable', items: [], other_delta: null, total_delta: null, issues: metrics.business_net.issues }
  if (helpers.canReadCustomerAnalysis === false) {
    drivers = { ...drivers, status: 'unavailable', reason: '没有客户明细查看权限',
      issues: [{ code: 'customer_analysis_forbidden', message: '没有客户明细查看权限' }] }
  } else if (metrics.business_net.status === 'available') {
    const groups = new Map()
    for (const [key, range] of [['current', plan.current], ['baseline', plan.baseline]]) for (const row of metricRows('business_net', range)) {
      if (!groups.has(row.customer_id)) groups.set(row.customer_id, { customer_id: row.customer_id,
        name: F.text(customer(row.customer_id).name), code: F.text(customer(row.customer_id).qr_code), current: 0, baseline: 0 })
      const item = groups.get(row.customer_id); item[key] = F.add(item[key], quantity(row.value))
    }
    const all = [...groups.values()].map(row => ({ ...row, delta: F.add(row.current, -row.baseline) }))
      .filter(row => row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.customer_id.localeCompare(b.customer_id, 'en'))
    const total = Math.round(metrics.business_net.delta * 1000), chosen = all.slice(0, 3)
    drivers = { status: 'available', items: chosen.map(row => ({ ...row, current: row.current / 1000, baseline: row.baseline / 1000, delta: row.delta / 1000 })),
      other_delta: (total - sum(chosen.map(row => row.delta))) / 1000, total_delta: total / 1000, issues: [],
      basis: 'customer_contribution_not_causation', customer_count: groups.size }
  }
  const evidence = { token: evidenceToken(input, plan, readIssues), source_count: ['sales', 'flows', 'receipts'].reduce((n, key) => n + (input[key] || []).length, 0),
    read_started_at: metadata.read_started_at || null, read_completed_at: metadata.read_completed_at || null,
    read_complete: !Object.values(readIssues).some(issues => issues.length),
    snapshot_consistent: false, time_basis: 'current_registered_records', external_verified: false }
  return { analysis: { version: VERSION, trend, comparison, drivers, evidence }, plan, metricRows, summary }
}

function sourcePage(bundle, data) {
  const metric = data.metric, selectedScope = data.scope || 'period'
  if (!METRICS.includes(metric) || !['period', 'current', 'baseline', 'trend'].includes(selectedScope)) return { code: 400, msg: '不支持的指标或来源范围' }
  let range = selectedScope === 'period' ? bundle.plan.period_range : bundle.plan[selectedScope]
  if (!range) return { code: 400, msg: '该期间没有可比较的完整日期范围' }
  if (data.date != null) {
    if (selectedScope !== 'trend' || !F.validDate(data.date) || !contains(range, data.date)) return { code: 400, msg: '来源日期超出趋势范围' }
    range = { start: data.date, end: data.date }
  }
  const token = bundle.analysis.evidence.token
  if (typeof data.evidence_token !== 'string' || !/^[a-f0-9]{64}$/.test(data.evidence_token)) return { code: 400, msg: '请先刷新经营简报，再查看原始依据' }
  if (data.evidence_token !== token) return { code: 409, msg: '来源记录已变化，请刷新经营简报后重新查看', data: { reason: 'evidence_changed' } }
  if (!bundle.analysis.evidence.read_complete) return { code: 503, msg: '来源尚未完整读到，暂不能确认原单范围，请刷新重试' }
  const cursor = data.cursor == null || data.cursor === '' ? '0' : data.cursor
  if (typeof cursor !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(cursor)) return { code: 400, msg: '来源分页位置无效' }
  const offset = Number(cursor), rows = bundle.metricRows(metric, range).sort((a, b) => a.date.localeCompare(b.date, 'en') || a.source_type.localeCompare(b.source_type, 'en') || a.source_id.localeCompare(b.source_id, 'en'))
  if (offset > rows.length) return { code: 400, msg: '来源分页位置超出范围' }
  const summary = bundle.summary(metric, range)
  const items = rows.slice(offset, offset + 50).map(({ customer_issues, customer_key, ...row }) => metric === 'customer_count'
    ? { ...row, value: customer_issues.length ? null : 1, unit: '条销售记录', status: customer_issues.length ? 'unavailable' : 'available', issues: uniqueIssues(customer_issues) } : row)
  return { code: 0, data: { section: 'brief_sources', version: VERSION, metric, scope: selectedScope, range, items, total: rows.length,
    next_cursor: offset + 50 < rows.length ? String(offset + 50) : null, evidence_token: token,
    status: summary.status, complete: summary.status === 'available', read_complete: true,
    accounting: { status: summary.status === 'available' ? 'resolved' : 'unresolved' }, value: summary.value, issues: summary.issues,
    note: metric === 'customer_count' ? '按原始销售客户去重，与业务概况一致；逐条记录数不能相加作为客户数' : '合计按完整来源计算，当前仅分页展示原单' } }
}

module.exports = { VERSION, METRICS, analysisPlan, buildAnalysis, sourcePage, contains }
