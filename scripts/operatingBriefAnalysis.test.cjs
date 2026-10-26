'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, readAt } = require('./fixtures/operatingBriefAnalysis.runner.cjs')
const { analysisPlan, VERSION } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBriefAnalysis')
const { resolveRange } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBrief')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const collections = () => structuredClone(fixture.collections)
const planAt = (period, now) => analysisPlan(period, resolveRange({ period }, Date.parse(now)))

test('calendar comparison uses UTC+8 completed days, leap month and equal common day count', () => {
  const yesterday = planAt('yesterday', '2028-02-29T16:00:00Z')
  assert.deepEqual(yesterday.current, { start: '2028-02-29', end: '2028-02-29' })
  assert.deepEqual(yesterday.baseline, { start: '2028-02-28', end: '2028-02-28' })
  assert.deepEqual(yesterday.trend, { start: '2028-02-23', end: '2028-02-29' })
  assert.equal(planAt('today', fixture.now).current, null)
  assert.equal(planAt('month', '2026-11-01T04:00:00Z').baseline, null)
  const shortMonth = planAt('month', '2026-03-31T04:00:00Z')
  assert.deepEqual(shortMonth.current, { start: '2026-03-01', end: '2026-03-28' })
  assert.deepEqual(shortMonth.baseline, { start: '2026-02-01', end: '2026-02-28' })
  const year = planAt('month', '2027-01-04T04:00:00Z')
  assert.deepEqual(year.baseline, { start: '2026-12-01', end: '2026-12-03' })
})

test('production reader calculates seven net-weight days and contributions across new, lost and returning customers', async () => {
  const { result, db } = await readAt(collections())
  const a = result.data.analysis
  assert.equal(a.version, VERSION)
  assert.deepEqual(a.trend.points.map(row => row.value), [0, 3, 0, 0, 5, 45, 43])
  assert.equal(a.trend.points.length, 7)
  assert.deepEqual(a.comparison.metrics.sale_weight_kg, { status: 'available', current: 43, baseline: 45, delta: -2, rate: -2 / 45, issues: [] })
  assert.deepEqual(a.comparison.metrics.business_net, { status: 'available', current: 260, baseline: 260, delta: 0, rate: 0, issues: [] })
  assert.equal(a.comparison.metrics.cash_net.current, 180)
  assert.equal(a.comparison.metrics.cash_net.baseline, 140)
  assert.equal(a.comparison.metrics.customer_count.current, 4)
  assert.deepEqual(a.drivers.items.map(row => [row.customer_id, row.delta]), [['b', -110], ['e', 80], ['a', 60]])
  assert.equal(a.drivers.other_delta, -30)
  assert.equal(a.drivers.items.reduce((n, row) => n + row.delta, a.drivers.other_delta), a.drivers.total_delta)
  assert.equal(a.evidence.external_verified, false)
  assert.equal(a.evidence.snapshot_consistent, false)
  assert.equal(a.evidence.read_complete, true)
  assert.equal(a.evidence.token.length, 64)
  assert.equal(db.writes.length, 0)
})

test('bad baseline money does not erase current amounts or independent physical trend', async () => {
  const tables = collections(); tables.crm_sale_records.find(row => row._id === 'a24').unit_price = null
  const { result } = await readAt(tables)
  assert.equal(result.data.business.net, 260)
  assert.equal(result.data.business.complete, true)
  const a = result.data.analysis
  assert.equal(a.comparison.metrics.business_net.current, 260)
  assert.equal(a.comparison.metrics.business_net.baseline, null)
  assert.equal(a.comparison.metrics.business_net.delta, null)
  assert.equal(a.drivers.status, 'unavailable')
  assert.equal(a.comparison.metrics.cash_net.status, 'available')
  assert.equal(a.trend.status, 'available')
})

test('bad historical physical row creates one dated gap; void and hidden rows never become activity', async () => {
  const tables = collections(); tables.crm_sale_records.find(row => row._id === 's20').out_items[0].net = null
  const { result } = await readAt(tables)
  const a = result.data.analysis
  assert.equal(a.trend.status, 'partial')
  assert.equal(a.trend.points[1].status, 'unavailable')
  assert.equal(a.trend.points[1].value, null)
  assert.equal(a.trend.points[2].value, 0)
  assert.equal(a.trend.points[3].value, 0)
  assert.equal(a.comparison.metrics.business_net.status, 'available')
  assert.equal(result.data.business.net, 260)
  assert.doesNotMatch(JSON.stringify(a), /hidden22|hidden-delivery25|不可见示例/)
})

test('fillings failure cannot invalidate the independent sales trend and today is never compared to a full day', async () => {
  const { result } = await readAt(collections(), { period: 'today' }, { get(name, rows) {
    if (name === 'crm_fillings') throw new Error('offline')
    return { data: structuredClone(rows) }
  } })
  assert.equal(result.data.operations.complete, false)
  assert.equal(result.data.analysis.trend.status, 'available')
  assert.equal(result.data.analysis.comparison.status, 'not_comparable')
  assert.ok(Object.values(result.data.analysis.comparison.metrics).every(row => row.rate === null && row.delta === null && row.current === null))
})

test('zero and negative baselines keep absolute change but no invented percentage', async () => {
  for (const baseline of [0, -2]) {
    const tables = collections(); tables.crm_sale_records = tables.crm_sale_records.filter(row => row.date !== '2026-10-24')
    if (baseline < 0) tables.crm_sale_records.push({ ...tables.crm_sale_records.find(row => row._id === 'b25-return'), _id: 'negative-baseline', date: '2026-10-24' })
    const { result } = await readAt(tables)
    const metric = result.data.analysis.comparison.metrics.sale_weight_kg
    assert.equal(metric.baseline, baseline); assert.equal(metric.delta, 43 - baseline); assert.equal(metric.rate, null)
  }
})

test('month comparison excludes today and unmatched prior-month days while main period keeps its own current total', async () => {
  const tables = collections(), source = tables.crm_sale_records.find(row => row._id === 'a25')
  tables.crm_sale_records.push({ ...source, _id: 'sep24', date: '2026-09-24', unit_price: 20 },
    { ...source, _id: 'sep26-outside', date: '2026-09-26', unit_price: 100 },
    { ...source, _id: 'oct26-progress', date: '2026-10-26', unit_price: 100 })
  const { result } = await readAt(tables, { period: 'month' })
  const c = result.data.analysis.comparison
  assert.deepEqual(c.current_range, { start: '2026-10-01', end: '2026-10-25' })
  assert.deepEqual(c.baseline_range, { start: '2026-09-01', end: '2026-09-25' })
  assert.equal(c.metrics.business_net.current, 550)
  assert.equal(c.metrics.business_net.baseline, 300)
  assert.equal(c.metrics.business_net.delta, 250)
  assert.equal(result.data.business.net, 2050)
  assert.equal(result.data.analysis.trend.points.at(-1).value, 43)
})

test('period and comparison reuse one union date scan for each raw financial collection', async () => {
  const scans = {}
  await readAt(collections(), {}, { get(name, rows, options) {
    if (options.order && [ 'crm_sale_records', 'crm_customer_flow_settlements', 'crm_customer_receipts' ].includes(name)
      && /"(?:date|biz_date)"/.test(JSON.stringify(options.where)) && JSON.stringify(options.where).includes('$gte')) scans[name] = (scans[name] || 0) + 1
    return { data: structuredClone(rows) }
  } })
  assert.deepEqual(scans, { crm_sale_records: 1, crm_customer_flow_settlements: 1, crm_customer_receipts: 1 })
})

test('source pagination is computed over the full verified scope and never returns hidden records or unauthorized route strings', async () => {
  const tables = collections(), source = tables.crm_sale_records.find(row => row._id === 'a25')
  for (let i = 0; i < 60; i++) tables.crm_sale_records.push({ ...source, _id: `extra-${String(i).padStart(3, '0')}` })
  const { result: brief } = await readAt(tables), token = brief.data.analysis.evidence.token
  const first = (await readAt(tables, { section: 'brief_sources', metric: 'sale_weight_kg', evidence_token: token })).result
  assert.equal(first.code, 0); assert.equal(first.data.items.length, 50); assert.equal(first.data.total, 64)
  assert.equal(first.data.value, 943); assert.equal(first.data.next_cursor, '50')
  const second = (await readAt(tables, { section: 'brief_sources', metric: 'sale_weight_kg', evidence_token: token, cursor: '50' })).result
  assert.equal(second.data.items.length, 14); assert.equal(second.data.next_cursor, null)
  const ids = [...first.data.items, ...second.data.items].map(row => row.source_id)
  assert.equal(new Set(ids).size, 64)
  assert.doesNotMatch(JSON.stringify(first.data), /hidden-delivery25|不可见示例|"route"/)
  const trend = (await readAt(tables, { section: 'brief_sources', metric: 'sale_weight_kg', scope: 'trend', date: '2026-10-20', evidence_token: token })).result
  assert.equal(trend.data.value, 3); assert.equal(trend.data.total, 1)
})

test('source token binds complete raw content, customer visibility and comparison range across pages', async () => {
  const tables = collections(), token = (await readAt(tables)).result.data.analysis.evidence.token
  for (const mutate of [t => { t.crm_sale_records.find(row => row._id === 'a25').unit_price = 11 },
    t => { t.crm_customers.find(row => row._id === 'e').is_hidden = true },
    t => { t.crm_sale_records.push({ ...t.crm_sale_records[0], _id: 'backfill', date: '2026-10-24' }) }]) {
    const changed = collections(); mutate(changed)
    const { result } = await readAt(changed, { section: 'brief_sources', metric: 'business_net', evidence_token: token })
    assert.equal(result.code, 409); assert.equal(result.data?.items, undefined)
  }
  const switched = (await readAt(tables, { section: 'brief_sources', period: 'month', metric: 'business_net', evidence_token: token })).result
  assert.equal(switched.code, 409)
})

test('source parameters are allowlisted and incomplete reads cannot masquerade as an empty source page', async () => {
  const token = (await readAt(collections())).result.data.analysis.evidence.token
  for (const patch of [{ metric: 'crm_users' }, { scope: 'all' }, { cursor: '-1' }, { cursor: 10 }, { date: '2026-10-20' }, { evidence_token: '' }]) {
    const { result } = await readAt(collections(), { section: 'brief_sources', metric: 'business_net', evidence_token: token, ...patch })
    assert.equal(result.code, 400)
  }
  const hooks = { get(name, rows) { if (name === 'crm_sale_records') throw new Error('unavailable'); return { data: structuredClone(rows) } } }
  const bad = (await readAt(collections(), {}, hooks)).result.data.analysis
  assert.equal(bad.evidence.read_complete, false)
  const { result } = await readAt(collections(), { section: 'brief_sources', metric: 'sale_weight_kg', evidence_token: bad.evidence.token }, hooks)
  assert.equal(result.code, 503); assert.equal(result.data?.items, undefined)
})

test('source endpoint requires home plus every contributing source permission before reading data', async () => {
  for (const [sale, flow, expected] of [[true, false, 403], [false, true, 403], [false, false, 403]]) {
    const reads = [], db = makeDb({ crm_users: [{ _id: 'user', token: 'test', role: 'user', role_template: 'user',
      page_permissions: { '/pages/index/index': { view: true }, '/pages/sale/list': { view: sale }, '/pages/customer/statement': { view: flow } } }] },
    { get(name, rows) { if (name !== 'crm_users') reads.push(name); return { data: structuredClone(rows) } } })
    const result = await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'brief_sources', period: 'yesterday', metric: 'business_net', evidence_token: '0'.repeat(64) })
    assert.equal(result.code, expected); assert.deepEqual(reads, [])
    assert.ok(db.writes.every(row => row.name === 'crm_operation_logs'))
  }
})

test('home-only viewer receives aggregate comparisons but no customer driver names or ids', async () => {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
  const tables = collections()
  tables.crm_sale_records = [ { ...tables.crm_sale_records.find(row => row._id === 'a25'), date: yesterday } ]
  tables.crm_users = [{ _id: 'user', token: 'test', role: 'user', role_template: 'user',
    page_permissions: { '/pages/index/index': { view: true }, '/pages/customer/list': { view: false } } }]
  const result = await invoke(loadHandler('crm-dashboard', makeDb(tables)), 'summaryV1', { section: 'brief', period: 'yesterday' })
  assert.equal(result.code, 0)
  assert.equal(result.data.analysis.comparison.metrics.sale_weight_kg.status, 'available')
  assert.equal(result.data.analysis.drivers.status, 'unavailable')
  assert.deepEqual(result.data.analysis.drivers.items, [])
  assert.doesNotMatch(JSON.stringify(result.data.analysis.drivers), /示例客户|DEMO-|"customer_id"/)
})

test('sales customer count agrees with parent-customer deliveries and never silently consolidates a mis-owned child sale', async () => {
  const tables = collections(), original = tables.crm_sale_records.find(row => row._id === 'a25')
  tables.crm_customers.push({ _id: 'site-one', name: '配送点一', settlement_customer_id: 'a' },
    { _id: 'site-two', name: '配送点二', settlement_customer_id: 'a' })
  tables.crm_sale_records = [{ ...original, _id: 'parent-one', delivery_customer_id: 'site-one' },
    { ...original, _id: 'parent-two', delivery_customer_id: 'site-two' }]
  let result = (await readAt(tables)).result
  assert.equal(result.data.operations.customer_count, 1)
  assert.equal(result.data.analysis.comparison.metrics.customer_count.current, 1)
  assert.deepEqual(result.data.analysis.drivers.items.map(row => row.customer_id), ['a'])
  const sources = (await readAt(tables, { section: 'brief_sources', metric: 'customer_count', evidence_token: result.data.analysis.evidence.token })).result.data
  assert.equal(sources.value, 1); assert.equal(sources.total, 2); assert.match(sources.note, /原始销售客户去重/)
  tables.crm_sale_records[0].customer_id = 'site-one'
  result = (await readAt(tables)).result
  assert.equal(result.data.operations.complete, false)
  assert.equal(result.data.analysis.comparison.metrics.customer_count.current, null)
  assert.ok(result.data.analysis.comparison.metrics.customer_count.issues.some(row => row.code === 'source_on_delivery_customer'))
})

function currentCalendarFixture() {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const offset = Date.parse(today) - Date.parse('2026-10-26')
  const tables = collections()
  for (const rows of Object.values(tables)) for (const row of rows) for (const key of ['date', 'biz_date', 'period_start_date', 'period_end_date']) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(row[key] || '')) row[key] = new Date(Date.parse(row[key]) + offset).toISOString().slice(0, 10)
  }
  tables.crm_users = [{ _id: 'user', token: 'test', role: 'superadmin' }]
  return { tables, expandedStart: new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10),
    primaryStart: new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10) }
}

for (const [source, mode] of [
  ['crm_sale_records', 'read_failure'], ['crm_sale_records', 'row_limit'], ['crm_sale_records', 'final_change'],
  ['crm_customer_flow_settlements', 'read_failure'], ['crm_customer_receipts', 'read_failure']
]) test(`real handler isolates ${source} expanded-window ${mode} and revalidates the requested period once`, async () => {
  const { tables, expandedStart, primaryStart } = currentCalendarFixture()
  const dateKey = source === 'crm_sale_records' ? 'date' : 'biz_date'
  const hasStart = (options, start) => JSON.stringify(options.where).includes(JSON.stringify({ [dateKey]: { $gte: start } }).slice(1, -1))
  let primaryScans = 0, historicalFaults = 0
  const db = makeDb(tables, {
    count(name, total, options) {
      if (name === source && mode === 'row_limit' && hasStart(options, expandedStart)) { historicalFaults++; return { total: 100001 } }
      return { total }
    },
    get(name, rows, options) {
      if (name === source && options.order && hasStart(options, primaryStart)) primaryScans++
      if (name === source && hasStart(options, expandedStart)) {
        if (mode === 'read_failure') { historicalFaults++; throw new Error('Historical scan unavailable') }
        if (mode === 'final_change' && JSON.stringify(options.where).includes('"updated_at":{"$gte":')) {
          historicalFaults++; return { data: [{ _id: 'historical-change' }] }
        }
      }
      return { data: structuredClone(rows) }
    }
  })
  const result = await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'brief', period: 'yesterday' })
  assert.equal(result.code, 0)
  assert.equal(result.data.business.net, 260)
  assert.equal(result.data.cash.net, 180)
  assert.equal(result.data.operations.sale_weight_kg, 43)
  assert.equal(result.data.complete, true)
  assert.equal(result.data.read_complete, true)
  assert.equal(result.financial_evidence.complete, true)
  assert.equal(result.data.analysis.evidence.read_complete, false)
  const metric = source === 'crm_customer_receipts' ? 'cash_net' : 'business_net'
  assert.equal(result.data.analysis.comparison.metrics[metric].status, 'unavailable')
  assert.equal(result.data.analysis.comparison.metrics[metric].delta, null)
  if (source === 'crm_sale_records') assert.ok(result.data.analysis.trend.points.every(point => point.value === null && point.status === 'unavailable'))
  assert.equal(primaryScans, 1, 'exactly one bounded primary-period fallback scan')
  assert.ok(historicalFaults > 0)
  assert.equal(db.writes.length, 0)
})

test('real handler retains unavailable primary values when both expanded and primary scans fail without retrying forever', async () => {
  const { tables, primaryStart } = currentCalendarFixture()
  let primaryScans = 0
  const db = makeDb(tables, { get(name, rows, options) {
    if (name === 'crm_sale_records') {
      if (options.order && JSON.stringify(options.where).includes(`"$gte":"${primaryStart}"`)) primaryScans++
      throw new Error('The requested period is also unavailable')
    }
    return { data: structuredClone(rows) }
  } })
  const result = await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'brief', period: 'yesterday' })
  assert.equal(result.code, 0)
  assert.equal(result.data.business.net, null)
  assert.equal(result.data.business.complete, false)
  assert.equal(result.data.cash.net, 180, 'independent dated receipts stay available')
  assert.equal(result.data.read_complete, false)
  assert.equal(result.data.analysis.evidence.read_complete, false)
  assert.equal(primaryScans, 1)
  assert.equal(db.writes.length, 0)
})
