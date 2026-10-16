'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const P = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/policy')
const { readAll, readOne } = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/store')
const { createHarness, createDatabase, makeUser, inspection, supplementItems } = require('./safetyManagementTestHarness.cjs')

async function saveCompleteSupplement(h, overrides = {}) {
  const items = supplementItems().map(item => ({ ...item, ...(overrides[item.code] || {}) }))
  const response = await h.call('saveSupplementV1', { date: h.date, expected_revision: 0, items })
  assert.equal(response.code, 0, response.msg); return response.data
}
function issueInput(h, id = 'issue_test_0001', changes = {}) { return { date: h.date, discovered_at: h.now() - 1000, client_submission_id: id, source_type: 'supplement', source_item_code: 'S02', category_code: '2', issue_note: '泵基础有异常', hazard_level: 'general', responsible_name: '维修责任人', planned_measure: '隔离后检修', planned_complete_date: h.date, ...changes } }

test('classification uses single canonical 36-item source and pressure shutdown never suppresses static checks', () => {
  assert.deepEqual(Object.values(P.CATEGORY_ITEMS).map(rows => rows.length), [1, 23, 2, 3, 3, 3, 1]); assert.equal(P.ITEM_CATEGORY.filling_hanging_scale, '1')
  const record = inspection('2026-10-15'); record.items.find(row => row.item_code === 'pump_pipeline_pressure').result_code = 'not_running'
  const supplements = P.mergeSupplement([], supplementItems())
  const snapshot = P.buildDailySnapshot({ date: '2026-10-15', inspections: [record], supplement: { items: supplements }, hazards: [], config: { special_equipment: [] } })
  assert.equal(snapshot.complete, false); assert.ok(snapshot.missing.some(message => message.includes('未运行需保留原因')))
  record.items.find(row => row.item_code === 'pump_pipeline_pressure').not_running_reason = '当日停泵'
  const complete = P.buildDailySnapshot({ date: '2026-10-15', inspections: [record], supplement: { items: supplements }, hazards: [], config: {} })
  assert.equal(complete.complete, true); assert.equal(complete.categories.flatMap(row => row.checks).filter(row => row.source_type === 'station_inspection').length, 36)
})

test('invalid dates, missing actual metadata, incomplete/duplicate source items and conditional checks cannot become normal', () => {
  for (const invalid of ['2026-99-01', '2026-02-30', 'x']) assert.equal(P.validDate(invalid), false)
  const row = inspection('2026-10-15'); row.items.pop(); row.weather = ''
  const snapshot = P.buildDailySnapshot({ date: '2026-10-15', inspections: [row], supplement: { items: [] } })
  assert.equal(snapshot.complete, false); assert.ok(snapshot.missing.some(message => message.includes('缺项'))); assert.ok(snapshot.missing.some(message => message.includes('天气')))
  const items = P.mergeSupplement([], supplementItems().map(item => item.code === 'S01' ? { ...item, result_code: 'normal' } : item))
  assert.ok(P.validateSupplement(items, [], {}).some(message => message.includes('审批')))
  assert.throws(() => P.mergeSupplement([], [{ code: 'S02', result_code: 'not_running' }]), /不支持/)
})

test('server pagination retrieves all 237 rows and Alipay transaction object envelopes are supported', async () => {
  const database = createDatabase({ sample: Array.from({ length: 237 }, (_, index) => ({ _id: `row_${String(index).padStart(3, '0')}`, value: index })) })
  assert.equal((await readAll(database, 'sample')).length, 237); assert.deepEqual(database.reads.map(row => row.offset), [0, 100, 200])
  const transaction = await database.startTransaction(); assert.equal((await readOne(transaction, 'sample', 'row_002', true)).value, 2); await transaction.rollback()
})

test('daily aggregation includes every visit beyond one source page and an afternoon normal never erases a morning abnormal', async () => {
  const h = createHarness({ seed: { crm_station_safety_inspections: Array.from({ length: 105 }, (_, index) => inspection('2026-10-15', `visit_${String(index).padStart(3, '0')}`)) } })
  const registered = await h.call('registerIssueV1', issueInput(h)); assert.equal(registered.code, 0, registered.msg)
  const records = h.database.rows('crm_station_safety_inspections'); records[0].items[0].result_code = 'abnormal'; records[0].items[0].is_abnormal = true; records[0].items[0].linked_hazard_id = registered.data.hazard_id; h.database.replace('crm_station_safety_inspections', records)
  await saveCompleteSupplement(h, { S12: { result_code: 'normal', hazard_ids: [registered.data.hazard_id] } })
  const response = await h.call('getDailyV1', { date: h.date }); assert.equal(response.code, 0, response.msg)
  assert.equal(response.data.snapshot.inspections.length, 105); assert.equal(response.data.snapshot.summary.issue_count, 1); assert.equal(response.data.snapshot.summary.abnormal_check_count, 1); assert.equal(response.data.snapshot.complete, true)
  assert.ok(h.database.reads.some(read => read.name === 'crm_station_safety_inspections' && read.offset === 100))
  const rejected = await h.call('confirmDailyV1', { date: h.date, expected_revision: 0, source_fingerprint: response.data.snapshot.source_fingerprint, zero_report: true }); assert.equal(rejected.code, 400)
})

test('content check is unsigned, retries are idempotent, changed sources mark stale and old revisions stay immutable', async () => {
  const h = createHarness(); await saveCompleteSupplement(h)
  let daily = (await h.call('getDailyV1', { date: h.date })).data
  const request = { date: h.date, expected_revision: 0, source_fingerprint: daily.snapshot.source_fingerprint, zero_report: true }
  const first = await h.call('confirmDailyV1', request); assert.equal(first.code, 0, first.msg); assert.equal(first.data.signature_status, 'pending_signature'); assert.equal(first.data.revision, 1)
  h.tick(1000); const retry = await h.call('confirmDailyV1', request); assert.equal(retry.code, 0, retry.msg); assert.equal(retry.data.revision, 1); assert.equal(retry.data.duplicate, true)
  h.database.replace('crm_station_safety_inspections', [...h.database.rows('crm_station_safety_inspections'), inspection(h.date, 'second')])
  daily = (await h.call('getDailyV1', { date: h.date })).data; assert.equal(daily.stale, true); assert.equal(daily.record.snapshot.inspections.length, 1); assert.equal(daily.snapshot.inspections.length, 2)
  const second = await h.call('confirmDailyV1', { ...request, expected_revision: 1, source_fingerprint: daily.snapshot.source_fingerprint, revision_reason: '下午增加巡检，重新核对' }); assert.equal(second.code, 0, second.msg); assert.equal(second.data.revision, 2)
  const history = await h.call('listRevisionsV1', { kind: 'daily', record_id: second.data._id }); assert.equal(history.code, 0, history.msg); assert.equal(history.data.revisions[0].snapshot.snapshot.inspections.length, 1)
  const calendar = await h.call('listDailyV1', { start_date: h.date, end_date: h.date }); assert.equal(calendar.data.days[0].status, 'pending_signature')
})

test('draft supplement resumes, no empty result defaults to normal, historical abnormal cannot be silently cleared', async () => {
  const h = createHarness()
  const first = await h.call('saveSupplementV1', { date: h.date, expected_revision: 0, items: [{ code: 'S02', result_code: 'abnormal', note: '待登记的异常' }] }); assert.equal(first.code, 0, first.msg)
  assert.equal((await h.call('getDailyV1', { date: h.date })).data.snapshot.complete, false)
  const second = await h.call('saveSupplementV1', { date: h.date, expected_revision: 1, revision_reason: '接续填报', items: supplementItems() }); assert.equal(second.code, 0, second.msg)
  const daily = (await h.call('getDailyV1', { date: h.date })).data; assert.ok(daily.snapshot.missing.some(message => message.includes('历史补充检查发现异常'))); assert.equal(daily.snapshot.summary.zero_report_allowed, false)
})

test('explicit same open hazard links one event, retries cannot duplicate, closed recurrence is a new event', async () => {
  const h = createHarness(); const input = issueInput(h)
  const first = await h.call('registerIssueV1', input); assert.equal(first.code, 0, first.msg)
  const duplicate = await h.call('registerIssueV1', input); assert.equal(duplicate.code, 0); assert.equal(duplicate.data.duplicate, true); assert.equal(h.database.rows('crm_station_safety_hazards').length, 1)
  const mismatch = await h.call('registerIssueV1', { ...input, issue_note: '不同问题' }); assert.equal(mismatch.code, 409)
  const linked = await h.call('registerIssueV1', issueInput(h, 'issue_test_0002', { existing_hazard_id: first.data.hazard_id, source_item_code: 'S03' })); assert.equal(linked.code, 0, linked.msg); assert.equal(h.database.rows('crm_station_safety_hazards').length, 1); assert.equal(h.database.rows('crm_station_safety_hazards')[0].observations.length, 2)
  const hazard = h.database.rows('crm_station_safety_hazards')[0]; h.database.replace('crm_station_safety_hazards', [{ ...hazard, status: 'closed', verification_result: 'passed', verified_at: h.now() }])
  const closedLink = await h.call('registerIssueV1', issueInput(h, 'issue_test_0003', { existing_hazard_id: hazard._id })); assert.equal(closedLink.code, 400)
  const recurrence = await h.call('registerIssueV1', issueInput(h, 'issue_test_0004', { recurrence_of: hazard._id })); assert.equal(recurrence.code, 0, recurrence.msg); assert.equal(h.database.rows('crm_station_safety_hazards').length, 2)
  const daily = (await h.call('getDailyV1', { date: h.date })).data; assert.equal(daily.snapshot.summary.issue_count, 2); assert.equal(daily.snapshot.categories[1].issues.length, 2)
})

test('reporting and onsite correction are actual facts, never inferred as formally closed', async () => {
  const h = createHarness(); const missing = await h.call('registerIssueV1', issueInput(h, 'invalid_onsite', { on_site_rectification: { note: '更换', completed_at: h.now() - 3000 } })); assert.equal(missing.code, 400)
  const result = await h.call('registerIssueV1', issueInput(h, 'reported_onsite', { report: { reported_at: h.now() - 1000, reported_to: '安全总监', method: '电话', requirements: '停止使用' }, on_site_rectification: { note: '消除异常', completed_at: h.now() - 3000, rechecked_at: h.now() - 2000, recheck_note: '现场复查状态正常' } })); assert.equal(result.code, 0, result.msg)
  const hazard = h.database.rows('crm_station_safety_hazards')[0]; assert.equal(hazard.status, 'pending_rectification'); assert.equal(hazard.report.reported_to, '安全总监'); assert.equal(hazard.on_site_rectification.recheck_note, '现场复查状态正常'); assert.equal(hazard.verified_at, null)
})

test('business roles are required independently of administrator and page ACL; unknown action and cross-kind export/history are denied', async () => {
  const h = createHarness()
  assert.equal((await h.call('saveSupplementV1', { date: h.date, expected_revision: 0, items: [] }, 'admin')).code, 403)
  assert.equal((await h.call('saveSupplementV1', { date: h.date, expected_revision: 0, items: [] }, 'outsider')).code, 403)
  assert.equal((await h.call('unknownV1')).code, 400)
  const users = h.database.rows('crm_users').map(user => user._id === 'officer' ? makeUser('officer', ['/pages/safety-management/print', '/pages/safety-management/daily']) : user); h.database.replace('crm_users', users)
  assert.equal((await h.call('exportV1', { kind: 'monthly', month: '2026-10', format: 'snapshot' })).code, 403)
  assert.equal((await h.call('listRevisionsV1', { kind: 'monthly', record_id: 'does_not_matter' })).code, 403)
})

test('week/month use natural periods, calendar holidays count and zero denominator is not 100%', async () => {
  const h = createHarness()
  const week = await h.call('getWeeklyV1', { date: h.date }, 'director'); assert.equal(week.code, 0, week.msg); assert.deepEqual(week.data.period, { start_date: '2026-10-12', end_date: '2026-10-18' }); assert.equal(week.data.statistics.rectification_rate, null); assert.equal(week.data.statistics.rectification_rate_label, '无此类隐患')
  const month = await h.call('getMonthlyV1', { month: '2026-10' }, 'principal'); assert.equal(month.data.statistics.expected_days, 15); assert.equal(month.data.statistics.inspected_days, 1); assert.equal(month.data.statistics.checked_days, 0)
  const calendar = await h.call('listDailyV1', { start_date: '2026-09-30', end_date: '2026-10-04' }); assert.equal(calendar.data.days[0].status, 'not_enabled'); assert.equal(calendar.data.days[4].status, 'no_inspection')
  const old = await h.call('saveSupplementV1', { date: '2026-09-30', expected_revision: 0, items: [] }); assert.equal(old.code, 400)
})

test('weekly/monthly narratives stay draft without actual activity and monthly previous decisions remain traceable', async () => {
  const h = createHarness()
  const weeklySource = (await h.call('getWeeklyV1', { date: h.date }, 'director')).data.source_fingerprint
  const draft = await h.call('saveWeeklyV1', { date: h.date, expected_revision: 0, source_fingerprint: weeklySource, content: {} }, 'director'); assert.equal(draft.code, 0, draft.msg); assert.equal(draft.data.content_status, 'draft'); assert.equal(draft.data.signature_status, 'pending_signature')
  const noPermissions = await h.call('saveMonthlyV1', { month: '2026-10', expected_revision: 0, content: {} }); assert.equal(noPermissions.code, 403)
  const monthlySource = (await h.call('getMonthlyV1', { month: '2026-10' }, 'principal')).data.source_fingerprint
  const monthly = await h.call('saveMonthlyV1', { month: '2026-10', expected_revision: 0, source_fingerprint: monthlySource, content: { actual_date: h.date, started_at: `${h.date}T08:00`, ended_at: `${h.date}T09:00`, title: '安全生产会议', decisions: [{ subject: '维修设备', department: '生产部', responsible_name: '张三', due_date: '2026-10-20', status: 'pending', implementation: '' }] } }, 'principal'); assert.equal(monthly.code, 0, monthly.msg); assert.equal(monthly.data.content_status, 'draft'); assert.equal(monthly.data.content.decisions.length, 1)
  const next = await h.call('getMonthlyV1', { month: '2026-11' }, 'principal'); assert.equal(next.code, 0, next.msg); assert.equal(next.data.previous.content.decisions[0].subject, '维修设备')
  assert.throws(() => P.normalizeReport('monthly', { actual_date: '2026-10-15', started_at: '2026-10-15T10:00', ended_at: '2026-10-15T09:00' }), /起止时间/)
  assert.throws(() => P.normalizeReport('weekly', { management_issues: [{ risk_level: 'minor' }] }), /风险等级/)
})

test('corrected source observations do not inflate repeat findings, verified closed rate uses unique first discoveries', () => {
  const hazards = [{ _id: 'h1', inspection_date: '2026-10-10', status: 'closed', verification_result: 'passed', verified_at: 1, observations: [{ source_type: 'station_inspection', source_revision: 2, observed_at: P.atDate('2026-10-15'), correction_reason: '更正文案' }] }, { _id: 'h2', inspection_date: '2026-10-15', status: 'closed', verified_at: 1, verification_result: 'passed', recurrence_of: 'h1', observations: [] }]
  const stats = P.aggregateStatistics({ period: P.periodForWeek('2026-10-15'), config: { enabled_from: '2026-10-01' }, daily: [], hazards }); assert.equal(stats.new_hazard_count, 1); assert.equal(stats.verified_closed_count, 1); assert.equal(stats.reobservations.length, 0); assert.equal(stats.recurrence.length, 1)
})

test('simultaneous retry cannot create duplicate hazards or leave orphan events', async () => {
  const h = createHarness(); const request = issueInput(h, 'simultaneous_issue')
  const results = await Promise.all([h.call('registerIssueV1', request), h.call('registerIssueV1', request)])
  assert.ok(results.some(result => result.code === 0)); assert.ok(results.every(result => result.code === 0 || result.code === 409))
  assert.equal(h.database.rows('crm_station_safety_hazards').length, 1); assert.equal(h.database.rows('crm_safety_issue_events').length, 1)
  const retry = await h.call('registerIssueV1', request); assert.equal(retry.code, 0); assert.equal(retry.data.duplicate, true)
})

test('failure after archival rolls back both historical and current revisions, no stale caller overwrites', async () => {
  const h = createHarness(); await saveCompleteSupplement(h)
  const begin = h.database.startTransaction.bind(h.database)
  h.database.startTransaction = async () => {
    const transaction = await begin(); const collection = transaction.collection.bind(transaction)
    transaction.collection = name => {
      const original = collection(name); if (name !== 'crm_safety_supplements') return original
      const doc = original.doc.bind(original); original.doc = id => { const reference = doc(id); reference.update = async () => { const error = new Error('模拟事务写入失败'); error.code = 503; throw error }; return reference }; return original
    }; return transaction
  }
  const failed = await h.call('saveSupplementV1', { date: h.date, expected_revision: 1, revision_reason: '复核说明', items: [{ code: 'S02', result_code: 'normal', note: '增加说明' }] })
  assert.equal(failed.code, 503); assert.equal(h.database.rows('crm_safety_supplements')[0].revision, 1); assert.equal(h.database.rows('crm_safety_revisions').length, 0)
  h.database.startTransaction = begin
  const saved = await h.call('saveSupplementV1', { date: h.date, expected_revision: 1, revision_reason: '复核说明', items: [{ code: 'S02', result_code: 'normal', note: '增加说明' }] }); assert.equal(saved.code, 0, saved.msg)
  const conflict = await h.call('saveSupplementV1', { date: h.date, expected_revision: 0, revision_reason: '过期覆盖', items: [{ code: 'S02', result_code: 'normal', note: '覆盖说明' }] }); assert.equal(conflict.code, 409)
  assert.equal(h.database.rows('crm_safety_supplements')[0].items.find(row => row.code === 'S02').note, '增加说明')
})

test('malformed or changing source pagination fails closed instead of presenting an empty complete ledger', async () => {
  const query = { where() { return this }, orderBy() { return this }, skip() { return this }, limit() { return this }, async count() { return { total: 1 } }, async get() { return {} } }
  await assert.rejects(readAll({ collection: () => query }, 'broken'), /未取得有效响应/)
  query.get = async () => ({ data: [] }); await assert.rejects(readAll({ collection: () => query }, 'broken'), /分页不完整/)
  await assert.rejects(readOne({ collection: () => ({ ...query, get: async () => ({}) }) }, 'broken', 'id'), /未将读取失败当作空记录/)
})


test('weekly save rejects changed sources and same-day linked observations count as repeats rather than new hazards', async () => {
  const h = createHarness()
  const weekly = await h.call('getWeeklyV1', { date: h.date }, 'director')
  const first = await h.call('registerIssueV1', issueInput(h, 'same_day_first')); assert.equal(first.code, 0, first.msg)
  const stale = await h.call('saveWeeklyV1', { date: h.date, expected_revision: 0, source_fingerprint: weekly.data.source_fingerprint, content: {} }, 'director'); assert.equal(stale.code, 409)
  h.tick(5000)
  const again = await h.call('registerIssueV1', issueInput(h, 'same_day_repeat', { existing_hazard_id: first.data.hazard_id })); assert.equal(again.code, 0, again.msg)
  const result = await h.call('getWeeklyV1', { date: h.date }, 'director'); assert.equal(result.data.statistics.new_hazard_count, 1); assert.equal(result.data.statistics.reobservations.length, 1)
})

test('delayed weekly discoveries keep selected reporting period while counting actual first discovery date, saved or unsaved', async () => {
  const h = createHarness(); const source = (await h.call('getWeeklyV1', { date: '2026-10-08' }, 'director')).data
  const saved = await h.call('saveWeeklyV1', { date: '2026-10-08', expected_revision: 0, source_fingerprint: source.source_fingerprint, content: { actual_date: h.date } }, 'director'); assert.equal(saved.code, 0, saved.msg)
  const reported = await h.call('registerIssueV1', issueInput(h, 'delayed_weekly_saved', { source_type: 'weekly', source_id: saved.data._id, source_item_code: 'weekly_site' }), 'director'); assert.equal(reported.code, 0, reported.msg)
  const hazard = h.database.rows('crm_station_safety_hazards')[0]; assert.equal(hazard.source_id, saved.data._id); assert.equal(hazard.first_discovered_date, h.date); assert.equal(hazard.observations[0].source_revision, 1)
  assert.equal((await h.call('getWeeklyV1', { date: '2026-10-08' }, 'director')).data.statistics.new_hazard_count, 0)
  assert.equal((await h.call('getWeeklyV1', { date: h.date }, 'director')).data.statistics.new_hazard_count, 1)
  const fresh = createHarness(); const draft = await fresh.call('registerIssueV1', issueInput(fresh, 'delayed_weekly_unsaved', { source_type: 'weekly', source_period_start: '2026-10-05', source_item_code: 'weekly_site' }), 'director'); assert.equal(draft.code, 0, draft.msg)
  const draftHazard = fresh.database.rows('crm_station_safety_hazards')[0]; assert.equal(draftHazard.source_id, P.identity('weekly', P.STATION.id, '2026-10-05')); assert.equal(draftHazard.observations[0].source_revision, 0)
})

test('daily zero report and S12 use historical cutoff: later closure cannot erase a prior unresolved problem', async () => {
  const h = createHarness(); const registered = await h.call('registerIssueV1', issueInput(h, 'historical_later_closed', { date: '2026-10-13', discovered_at: P.atDate('2026-10-13') + 3600000 })); assert.equal(registered.code, 0, registered.msg)
  const hazard = h.database.rows('crm_station_safety_hazards')[0]; h.database.replace('crm_station_safety_hazards', [{ ...hazard, status: 'closed', verification_result: 'passed', verified_at: P.atDate('2026-10-16') + 3600000 }])
  await saveCompleteSupplement(h)
  const first = (await h.call('getDailyV1', { date: h.date })).data.snapshot; assert.equal(first.historical_pending.length, 1); assert.equal(first.historical_pending[0].current_status, 'closed'); assert.equal(first.historical_pending[0].status, 'pending_rectification'); assert.ok(first.missing.some(message => message.includes('S12'))); assert.equal(first.summary.zero_report_allowed, false)
  const saved = await h.call('saveSupplementV1', { date: h.date, expected_revision: 1, revision_reason: '补核截至当日未结事项', items: [{ code: 'S12', result_code: 'normal', hazard_ids: [hazard._id], note: '当日临时措施已落实' }] }); assert.equal(saved.code, 0, saved.msg)
  const current = (await h.call('getDailyV1', { date: h.date })).data.snapshot; assert.equal(current.complete, true); assert.equal(current.summary.zero_report_allowed, false)
  h.database.replace('crm_station_safety_hazards', [{ ...hazard, observations: [], status: 'closed', verification_result: 'passed', verified_at: P.atDate(h.date) + 3600000 }])
  const closedToday = (await h.call('getDailyV1', { date: h.date })).data.snapshot; assert.equal(closedToday.issues.length, 1); assert.equal(closedToday.historical_pending.length, 0); assert.equal(closedToday.summary.zero_report_allowed, false)
  h.database.replace('crm_station_safety_hazards', [{ ...hazard, status: 'closed', verification_result: 'passed', verified_at: null }])
  const unknown = (await h.call('getDailyV1', { date: h.date })).data.snapshot; assert.equal(unknown.historical_pending.length, 1); assert.equal(unknown.historical_pending[0].closure_time_unverified, true)
})

test('period backlog and closed numerator use proven closure time by cutoff, historical progress remains traceable', () => {
  const period = P.periodForWeek('2026-10-08')
  const base = { status: 'closed', verification_result: 'passed', verified_at: P.atDate('2026-10-12'), observations: [] }
  const hazards = [{ ...base, _id: 'old_pending', inspection_date: '2026-10-01' }, { ...base, _id: 'new_pending', inspection_date: '2026-10-07' }, { ...base, _id: 'old_closed_in_week', inspection_date: '2026-10-01', verified_at: P.atDate('2026-10-09') }]
  const stats = P.aggregateStatistics({ period, config: { enabled_from: '2026-10-01' }, daily: [], hazards }); assert.equal(stats.historical_pending.length, 1); assert.equal(stats.new_hazard_count, 1); assert.equal(stats.verified_closed_count, 0); assert.equal(stats.rectification_rate, 0); assert.equal(stats.historical_progress.length, 1)
})

test('repeat observation archives earlier top-level report facts, and backfilled older facts never overwrite newer facts', async () => {
  const h = createHarness(); const time = h.now(); const reportA = { reported_at: time - 7000, reported_to: '对象A', method: '电话' }
  const onsiteA = { completed_at: time - 6000, note: '措施A', rechecked_at: time - 5500, recheck_note: '复查A' }
  const first = await h.call('registerIssueV1', issueInput(h, 'facts_original', { discovered_at: time - 10000, report: reportA, on_site_rectification: onsiteA })); assert.equal(first.code, 0, first.msg)
  const original = h.database.rows('crm_station_safety_hazards')[0]; original.observations[0].report = null; original.observations[0].on_site_rectification = null; h.database.replace('crm_station_safety_hazards', [original])
  const reportB = { reported_at: time - 2000, reported_to: '对象B', method: '电话' }; const onsiteB = { completed_at: time - 4000, note: '措施B', rechecked_at: time - 3000, recheck_note: '复查B' }
  const next = await h.call('registerIssueV1', issueInput(h, 'facts_newer', { existing_hazard_id: first.data.hazard_id, report: reportB, on_site_rectification: onsiteB })); assert.equal(next.code, 0, next.msg)
  let saved = h.database.rows('crm_station_safety_hazards')[0]; assert.equal(saved.report.reported_to, '对象B'); assert.equal(saved.revision, 2); assert.equal(saved.source_revisions[0].snapshot.report.reported_to, '对象A'); assert.equal(saved.source_revisions[0].snapshot.on_site_rectification.note, '措施A')
  const earlier = await h.call('registerIssueV1', issueInput(h, 'facts_backfilled', { existing_hazard_id: first.data.hazard_id, report: { ...reportA, reported_to: '较早补记C' }, on_site_rectification: { ...onsiteA, note: '较早措施C' } })); assert.equal(earlier.code, 0, earlier.msg)
  saved = h.database.rows('crm_station_safety_hazards')[0]; assert.equal(saved.report.reported_to, '对象B'); assert.equal(saved.on_site_rectification.note, '措施B'); assert.equal(saved.observations.at(-1).report.reported_to, '较早补记C')
})

test('abnormal supplement cannot reuse a closed historical ID as fresh evidence; a real same-day observation is required', async () => {
  const h = createHarness(); const old = await h.call('registerIssueV1', issueInput(h, 'old_closed_bypass', { date: '2026-10-13', discovered_at: P.atDate('2026-10-13') + 3600000 })); assert.equal(old.code, 0, old.msg)
  const hazard = h.database.rows('crm_station_safety_hazards')[0]; h.database.replace('crm_station_safety_hazards', [{ ...hazard, status: 'closed', verification_result: 'passed', verified_at: P.atDate('2026-10-14') }])
  await saveCompleteSupplement(h, { S02: { result_code: 'abnormal', note: '今天再次异常', hazard_ids: [hazard._id] } })
  let daily = (await h.call('getDailyV1', { date: h.date })).data.snapshot; assert.equal(daily.complete, false); assert.ok(daily.missing.some(message => message.includes('缺少当日该项观察')))
  const invalid = await h.call('confirmDailyV1', { date: h.date, expected_revision: 0, source_fingerprint: daily.source_fingerprint, zero_report: false }); assert.equal(invalid.code, 400)
  const recurrence = await h.call('registerIssueV1', issueInput(h, 'real_recurrence_event', { recurrence_of: hazard._id })); assert.equal(recurrence.code, 0, recurrence.msg)
  const saved = await h.call('saveSupplementV1', { date: h.date, expected_revision: 1, revision_reason: '将复发问题明确登记为新隐患', items: [{ code: 'S02', result_code: 'abnormal', note: '今天再次异常', hazard_ids: [recurrence.data.hazard_id] }, { code: 'S12', result_code: 'normal', hazard_ids: [recurrence.data.hazard_id] }] }); assert.equal(saved.code, 0, saved.msg)
  daily = (await h.call('getDailyV1', { date: h.date })).data.snapshot; assert.equal(daily.complete, true)
})
