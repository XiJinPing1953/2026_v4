'use strict'
const P = require('./policy')
const { readOne, readAll, inTransaction, saveRevision } = require('./store')
const COLLECTIONS = Object.freeze({ config: 'crm_safety_management_config', supplement: 'crm_safety_supplements', daily: 'crm_safety_daily_records', weekly: 'crm_safety_weekly_reports', monthly: 'crm_safety_monthly_minutes' })
const INSPECTIONS = 'crm_station_safety_inspections'
const HAZARDS = 'crm_station_safety_hazards'
const EVENT_COLLECTION = 'crm_safety_issue_events'
const PATH = '/pages/safety-management/'
const actionRule = (page, action) => ({ pagePath: `${PATH}${page}`, action })
const PAGE_ACTION_RULES = {
  getConfigV1: ['home', 'daily', 'weekly', 'monthly', 'settings'].map(page => actionRule(page, 'view')),
  listAssignableUsersV1: [actionRule('settings', 'view')],
  saveConfigV1: [actionRule('settings', 'update')],
  getDailyV1: [actionRule('daily', 'view')],
  saveSupplementV1: [actionRule('daily', 'update')],
  confirmDailyV1: [actionRule('daily', 'update')],
  listDailyV1: [actionRule('home', 'view')],
  getWeeklyV1: [actionRule('weekly', 'view')], saveWeeklyV1: [actionRule('weekly', 'update')],
  getMonthlyV1: [actionRule('monthly', 'view')], saveMonthlyV1: [actionRule('monthly', 'update')],
  registerIssueV1: [actionRule('daily', 'update'), actionRule('weekly', 'update')],
  exportV1: [actionRule('print', 'view')],
  listRevisionsV1: ['daily', 'weekly', 'monthly', 'settings'].map(page => actionRule(page, 'view'))
}

function createService({ database, acl, cloud = null, clock = () => Date.now() }) {
  const stationOf = data => { const station = P.text(data.station_id || P.STATION.id); if (station !== P.STATION.id) P.fail('厂站不存在', 404); return station }
  const getConfig = async station => await readOne(database, COLLECTIONS.config, P.identity('config', station, '')) || { station_id: station, station_name: P.STATION.name, enabled_from: '', roles: { safety_officer: [], safety_director: [], principal: [] }, special_equipment: [], revision: 0 }
  const permissions = (user, config) => P.rolePermissions(user, config, acl.isSuperAdmin(user))
  function requireRole(user, config, capability) { if (!permissions(user, config)[capability]) P.fail('账号未配置为本项安全管理业务岗位，请联系管理员配置；管理员身份不能代替业务岗位', 403) }
  function requireEnabled(config, date) { if (!config.enabled_from) P.fail('请先配置安全管理启用日期和三类人员'); if (date < config.enabled_from) P.fail('所选日期早于启用日期，不能自动补建台账'); if (date > P.shanghaiDate(clock())) P.fail('不能预填未来日期的检查或会议事实') }
  const usersList = async () => (await readAll(database, 'crm_users')).map(row => ({ _id: row._id, name: row.nickname || row.name || row.username || '', username: row.username || '', role: row.role || '' }))
  async function sourceBundle(station, date, config) {
    const [inspections, hazards, supplement, record, supplement_history] = await Promise.all([
      readAll(database, INSPECTIONS, { station_id: station, inspection_date: date }), readAll(database, HAZARDS, { station_id: station }),
      readOne(database, COLLECTIONS.supplement, P.identity('supplement', station, date)), readOne(database, COLLECTIONS.daily, P.identity('daily', station, date)), readAll(database, 'crm_safety_revisions', { kind: 'supplement', record_id: P.identity('supplement', station, date) })
    ])
    const snapshot = P.buildDailySnapshot({ station_id: station, date, inspections, hazards, supplement, supplement_history, config })
    return { record, supplement, snapshot, stale: Boolean(record && record.source_fingerprint !== snapshot.source_fingerprint) }
  }
  async function dailyRows(station, start, end, config) {
    const dates = P.daysBetween(start, end)
    const [allInspections, hazards, supplements, records, supplementRevisions] = await Promise.all([
      readAll(database, INSPECTIONS, { station_id: station }), readAll(database, HAZARDS, { station_id: station }),
      readAll(database, COLLECTIONS.supplement, { station_id: station }), readAll(database, COLLECTIONS.daily, { station_id: station }), readAll(database, 'crm_safety_revisions', { station_id: station, kind: 'supplement' })
    ])
    const grouped = new Map(); for (const row of allInspections) { const values = grouped.get(row.inspection_date) || []; values.push(row); grouped.set(row.inspection_date, values) }
    const supplementByDate = new Map(supplements.map(row => [row.date, row])); const recordByDate = new Map(records.map(row => [row.date, row]))
    const today = P.shanghaiDate(clock())
    const days = dates.map(date => {
      const record = recordByDate.get(date) || null
      const snapshot = P.buildDailySnapshot({ station_id: station, date, inspections: grouped.get(date) || [], hazards, supplement: supplementByDate.get(date) || null, supplement_history: supplementRevisions.filter(row => row.snapshot?.date === date), config })
      const enabled = Boolean(config.enabled_from && date >= config.enabled_from && date <= today)
      return { date, status: P.recordStatus(snapshot, record, enabled), inspection_count: snapshot.summary.inspection_count, issue_count: snapshot.summary.issue_count, signature_status: 'pending_signature', revision: record?.revision || 0, record_id: record?._id || '', source_fingerprint: snapshot.source_fingerprint }
    })
    return { days, hazards }
  }
  async function periodBundle(station, kind, input, config) {
    const period = kind === 'weekly' ? P.periodForWeek(P.requireDate(input.date)) : P.periodForMonth(input.month)
    const key = kind === 'weekly' ? period.start_date : input.month
    const { days, hazards } = await dailyRows(station, period.start_date, period.end_date, config)
    const statistics = P.aggregateStatistics({ period, config, daily: days, hazards })
    let weekly_reports = []
    if (kind === 'monthly') weekly_reports = (await readAll(database, COLLECTIONS.weekly, { station_id: station })).filter(row => row.period.end_date >= period.start_date && row.period.start_date <= period.end_date)
    if (kind === 'monthly') statistics.weekly_reports = weekly_reports
    const record = await readOne(database, COLLECTIONS[kind], P.identity(kind, station, key))
    const previousKey = kind === 'weekly' ? P.shanghaiDate(P.atDate(period.start_date) - 7 * P.DAY) : P.previousMonth(input.month)
    const previous = await readOne(database, COLLECTIONS[kind], P.identity(kind, station, previousKey))
    const source_fingerprint = P.fingerprint({ statistics, previous_revision: previous?.revision || 0, config_revision: config.revision })
    return { record, period, statistics, previous, source_fingerprint, stale: Boolean(record && record.source_fingerprint !== source_fingerprint) }
  }
  async function validateLinkedHazards(station, ids) {
    for (const id of [...new Set(ids)]) { const hazard = await readOne(database, HAZARDS, id); if (!hazard || hazard.station_id !== station) P.fail('引用的隐患不存在或不属于当前厂站') }
  }
  async function savePeriod(user, data, kind, config) {
    requireRole(user, config, kind === 'weekly' ? 'weekly' : 'monthly')
    const station = stationOf(data); const result = P.normalizeReport(kind, data.content)
    const requestedDate = kind === 'weekly' ? data.date : `${data.month}-01`
    const bundle = await periodBundle(station, kind, data, config)
    if (!data.source_fingerprint || data.source_fingerprint !== bundle.source_fingerprint) P.fail('统计来源已变化，请刷新周月材料后重新核对再保存', 409)
    if (bundle.period.start_date > P.shanghaiDate(clock()) || bundle.period.end_date < config.enabled_from || !config.enabled_from) P.fail('统计周期尚未启用或属于未来')
    if (result.content.actual_date) requireEnabled(config, result.content.actual_date)
    await validateLinkedHazards(station, result.content.hazard_ids)
    return saveRevision(database, { collection: COLLECTIONS[kind], kind, id: P.identity(kind, station, kind === 'weekly' ? bundle.period.start_date : data.month), expected_revision: data.expected_revision, revision_reason: P.text(data.revision_reason, 2000), actor: user, now: clock(), payload: { station_id: station, station_name: config.station_name, period: bundle.period, period_key: kind === 'weekly' ? bundle.period.start_date : data.month, ...result, statistics: bundle.statistics, source_fingerprint: bundle.source_fingerprint, previous_record_id: bundle.previous?._id || '', previous_revision: bundle.previous?.revision || 0, previous_decisions: kind === 'monthly' ? bundle.previous?.content?.decisions || [] : [], source_refs: bundle.statistics.daily.filter(row => row.record_id).map(row => ({ date: row.date, record_id: row.record_id, revision: row.revision })) } })
  }
  async function registerIssue(user, data, config) {
    const station = stationOf(data); const now = clock(); const input = P.normalizeIssue(data, now)
    requireRole(user, config, input.source_type === 'weekly' ? 'weekly' : 'daily'); requireEnabled(config, input.date)
    // An OR page rule is insufficient for this mixed-source action: check the selected write surface too.
    const sourceAcl = await acl.ensureActionAcl(user, 'writeIssue', { writeIssue: [actionRule(input.source_type === 'weekly' ? 'weekly' : 'daily', 'update')] }, [], { cloudFunction: 'crm-safety-management' })
    if (!sourceAcl.ok) P.fail(sourceAcl.msg || '无权登记该来源的隐患', 403)
    const eventId = P.identity('issue', station, input.client_submission_id)
    const requestFingerprint = P.fingerprint({ ...input, discovered_at: data.discovered_at ? input.discovered_at : 'server_time', actor_id: user._id })
    const prior = await readOne(database, EVENT_COLLECTION, eventId)
    if (prior) { if (prior.request_fingerprint !== requestFingerprint) P.fail('同一提交标识对应不同内容，请刷新核对', 409); return { hazard_id: prior.hazard_id, observation_id: eventId, duplicate: true } }
    const sourcePeriod = input.source_type === 'weekly' ? input.source_period_start || P.periodForWeek(input.date).start_date : input.date
    if (input.source_type === 'weekly' && (P.periodForWeek(sourcePeriod).start_date !== sourcePeriod || P.periodForWeek(sourcePeriod).end_date < config.enabled_from || sourcePeriod > P.shanghaiDate(clock()))) P.fail('周排查来源周期须为已启用的真实统计周')
    let sourceId = P.identity(input.source_type, station, sourcePeriod)
    if (input.source_id && input.source_id !== sourceId) {
      const sourceReport = input.source_type === 'weekly' ? await readOne(database, COLLECTIONS.weekly, input.source_id) : null
      if (!sourceReport || sourceReport.station_id !== station || input.source_period_start) P.fail('隐患来源编号与本厂站日期或已保存周报告不匹配')
      // Actual finding time belongs to the event; a delayed weekly inspection may
      // legitimately document a previously selected reporting period.
      sourceId = sourceReport._id
    }
    const sourceRecord = await readOne(database, input.source_type === 'weekly' ? COLLECTIONS.weekly : COLLECTIONS.supplement, sourceId)
    if (input.existing_hazard_id && !await readOne(database, HAZARDS, input.existing_hazard_id)) P.fail('关联隐患不存在')
    if (input.recurrence_of && !await readOne(database, HAZARDS, input.recurrence_of)) P.fail('复发原隐患不存在')
    return inTransaction(database, async transaction => {
      // prior was checked outside the transaction. The unique event ID provides replay/race protection.
      let current = input.existing_hazard_id ? await readOne(transaction, HAZARDS, input.existing_hazard_id, true) : null
      if (input.existing_hazard_id && (!current || current.station_id !== station || !P.OPEN_STATUSES.includes(current.status))) P.fail('只能明确关联本厂站尚未关闭的隐患；已关闭问题再次发生请登记复发新隐患')
      if (input.recurrence_of) { const previous = await readOne(transaction, HAZARDS, input.recurrence_of, true); if (!previous || previous.station_id !== station || previous.status !== 'closed') P.fail('复发关联须为本厂站已关闭隐患') }
      const observation = { observation_key: eventId, source_type: input.source_type, source_id: sourceId, source_revision: sourceRecord?.revision || 0, item_code: input.source_item_code, observed_at: input.discovered_at, observed_date: input.date, issue_note: input.issue_note, photo_file_ids: P.fileReferences(input.evidence), evidence: input.evidence, category_code: input.category_code, report: input.report, on_site_rectification: input.on_site_rectification, temporary_controls: input.temporary_controls, observed_by: user._id, observed_by_name: user.nickname || user.username || '' }
      const hazardId = current?._id || P.identity('sm_hazard', station, input.client_submission_id)
      if (current) {
        const patch = { observations: database.command.push([observation]), updated_at: now }
        // Keep original discovery facts intact; repeat observations do not silently change responsibility or severity.
        if (input.report && Number(input.report.reported_at) >= Number(current.report?.reported_at || 0)) patch.report = input.report
        if (input.on_site_rectification && Number(input.on_site_rectification.completed_at) >= Number(current.on_site_rectification?.completed_at || 0)) patch.on_site_rectification = input.on_site_rectification
        if (patch.report && P.fingerprint(patch.report) !== P.fingerprint(current.report || null) || patch.on_site_rectification && P.fingerprint(patch.on_site_rectification) !== P.fingerprint(current.on_site_rectification || null)) {
          const snapshot = { ...current }; delete snapshot.source_revisions
          patch.revision = Number(current.revision || 1) + 1
          patch.source_revisions = database.command.push([{ revision: Number(current.revision || 1), reason: '复见时补充实际处置事实', revised_at: now, revised_by: user._id, revised_by_name: user.nickname || user.username || '', snapshot }])
        }
        await transaction.collection(HAZARDS).doc(hazardId).update(patch)
      } else {
        current = {
          _id: hazardId, hazard_no: `AQ-${input.date.replace(/-/g, '')}-${P.fingerprint(input.client_submission_id).slice(0, 10).toUpperCase()}`,
          station_id: station, station_name_snapshot: config.station_name,
          inspection_id: sourceId, inspection_no: `${input.source_type === 'weekly' ? '周排查' : '补充检查'}-${input.date}`,
          inspection_at: input.discovered_at, inspection_date: input.date, inspector_name_snapshot: user.nickname || user.username || '',
          area_code: 'safety_management', area_label_snapshot: input.source_type === 'weekly' ? '周排查' : '日管控补充',
          item_code: `${input.source_item_code}_${input.client_submission_id}`, item_label_snapshot: input.source_item_code,
          hazard_category: ['1', '3', '7'].includes(input.category_code) ? '安全管理' : '厂站设施',
          issue_note: input.issue_note, hazard_level: input.hazard_level, responsible_name: input.responsible_name,
          responsible_signature_file_id: '', planned_measure: input.planned_measure, planned_complete_date: input.planned_complete_date,
          inspection_photo_file_ids: P.fileReferences(input.evidence), status: 'pending_rectification',
          rectification_note: '', rectification_photo_file_ids: [], rectified_at: null, rectified_by: '', rectified_by_name: '',
          verification_result: '', verification_note: '', verification_photo_file_ids: [], verified_at: null, verified_by: '', verified_by_name: '',
          source_type: input.source_type, source_id: sourceId, source_item_code: input.source_item_code,
          first_discovered_at: input.discovered_at, first_discovered_date: input.date,
          category_code: input.category_code, category_label_snapshot: P.CATEGORIES[Number(input.category_code) - 1].name,
          classification_version: P.CLASSIFICATION_VERSION, recurrence_of: input.recurrence_of,
          observations: [observation], report: input.report, on_site_rectification: input.on_site_rectification, revision: 1, source_revisions: [],
          created_at: now, created_by: user._id, created_by_name: user.nickname || user.username || '', updated_at: now
        }
        await transaction.collection(HAZARDS).add(current)
      }
      await transaction.collection(EVENT_COLLECTION).add({ _id: eventId, station_id: station, date: input.date, client_submission_id: input.client_submission_id, source_type: input.source_type, source_id: sourceId, hazard_id: hazardId, request_fingerprint: requestFingerprint, observation, created_at: now, created_by: user._id })
      return { hazard_id: hazardId, observation_id: eventId, duplicate: false }
    })
  }
  async function exportDocument(user, data, config) {
    const station = stationOf(data); const kind = P.text(data.kind); if (!['daily', 'weekly', 'monthly'].includes(kind)) P.fail('导出类型不正确')
    const access = await acl.ensureActionAcl(user, 'readExport', { readExport: [actionRule(kind, 'view')] }, [], { cloudFunction: 'crm-safety-management' }); if (!access.ok) P.fail(access.msg || '无权导出该类台账', 403)
    const document = kind === 'daily' ? await sourceBundle(station, P.requireDate(data.date), config) : await periodBundle(station, kind, data, config)
    const incomplete = kind === 'daily' ? !document.snapshot.complete || !document.record || document.stale : !document.record || document.record.content_status !== 'complete' || document.stale
    const status = incomplete ? '内容未完成或待重新核对 · 待签认' : '内容已核对 · 待签认'
    const result = { kind, document, status, generated_at: clock() }
    if (data.format === 'xlsx') { if (!cloud) P.fail('导出服务不可用', 503); const { createWorkbook } = require('./workbook'); const workbook = await createWorkbook(result, { cloud }); const buffer = await workbook.xlsx.writeBuffer(); const file_name = `安全管理-${kind}-${kind === 'monthly' ? data.month : data.date}-待签认.xlsx`; const uploaded = await cloud.uploadFile({ cloudPath: `safety-management/${user._id}/${clock()}-${P.fingerprint(buffer.toString('base64')).slice(0, 8)}.xlsx`, fileContent: buffer }); result.file_id = uploaded.fileID || uploaded.fileId; result.file_name = file_name; const urls = await cloud.getTempFileURL({ fileList: [result.file_id] }); result.url = urls.fileList?.[0]?.tempFileURL || '' }
    else if (data.format && data.format !== 'snapshot') P.fail('导出格式不正确')
    if (cloud) {
      // Hydration occurs after fingerprinting: expiring URLs never invalidate a source revision.
      const files = new Set(); function collect(value) { if (typeof value === 'string' && value.startsWith('cloud://')) files.add(value); else if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') Object.values(value).forEach(collect) } collect(document)
      result.media_urls = {}; const fileList = [...files]; for (let offset = 0; offset < fileList.length; offset += 50) { const urls = await cloud.getTempFileURL({ fileList: fileList.slice(offset, offset + 50) }); for (const row of urls.fileList || []) if (row.tempFileURL) result.media_urls[row.fileID] = row.tempFileURL }
    }
    return result
  }
  const handlers = {
    async getConfigV1(user, data, config) { return { config, categories: P.CATEGORIES, supplement_definitions: P.SUPPLEMENT_DEFINITIONS, permissions: permissions(user, config), users: acl.isSuperAdmin(user) ? await usersList() : [] } },
    async listAssignableUsersV1(user) { if (!acl.isSuperAdmin(user)) P.fail('仅管理员可查看岗位配置账号', 403); return usersList() },
    async saveConfigV1(user, data) {
      if (!acl.isSuperAdmin(user)) P.fail('仅管理员可配置安全管理岗位', 403)
      const station = stationOf(data); const payload = P.normalizeConfig(data.config || {}, station)
      const allUsers = await readAll(database, 'crm_users'); const userIds = new Set(allUsers.map(row => row._id)); const warnings = []
      for (const [role, ids] of Object.entries(payload.roles)) for (const id of ids) {
        if (!userIds.has(id)) P.fail('配置的岗位账号不存在')
        const candidate = allUsers.find(row => row._id === id); const page = ({ safety_officer: 'daily', safety_director: 'weekly', principal: 'monthly' })[role]
        const access = await acl.ensureActionAcl(candidate, 'roleAccess', { roleAccess: [actionRule(page, 'update')] }, [], { cloudFunction: 'crm-safety-management' })
        if (!access.ok) warnings.push(`${candidate.nickname || candidate.username} 尚未获${page}页面权限，请同时在用户管理授权`)
      }
      const saved = await saveRevision(database, { collection: COLLECTIONS.config, kind: 'config', id: P.identity('config', station, ''), expected_revision: data.expected_revision, revision_reason: P.text(data.revision_reason, 2000), actor: user, payload, now: clock() })
      return { ...saved, warnings }
    },
    async getDailyV1(user, data, config) { return { ...await sourceBundle(stationOf(data), P.requireDate(data.date), config), permissions: permissions(user, config) } },
    async saveSupplementV1(user, data, config) {
      requireRole(user, config, 'daily'); const date = P.requireDate(data.date); requireEnabled(config, date); const station = stationOf(data); const id = P.identity('supplement', station, date)
      const current = await readOne(database, COLLECTIONS.supplement, id); const items = P.mergeSupplement(current?.items, data.items)
      await validateLinkedHazards(station, items.flatMap(item => item.hazard_ids))
      return saveRevision(database, { collection: COLLECTIONS.supplement, kind: 'supplement', id, expected_revision: data.expected_revision, revision_reason: P.text(data.revision_reason, 2000), actor: user, now: clock(), payload: { station_id: station, date, classification_version: P.CLASSIFICATION_VERSION, items, content_status: 'draft' } })
    },
    async confirmDailyV1(user, data, config) {
      requireRole(user, config, 'daily'); const station = stationOf(data); const date = P.requireDate(data.date); requireEnabled(config, date)
      const bundle = await sourceBundle(station, date, config)
      if (!data.source_fingerprint || data.source_fingerprint !== bundle.snapshot.source_fingerprint) P.fail('来源已变化，请刷新日表后重新核对', 409)
      if (typeof data.zero_report !== 'boolean') P.fail('请明确确认是否零报告')
      P.checkDailyConfirmation(bundle.snapshot, data.zero_report)
      return saveRevision(database, { collection: COLLECTIONS.daily, kind: 'daily', id: P.identity('daily', station, date), expected_revision: data.expected_revision, revision_reason: P.text(data.revision_reason, 2000), actor: user, now: clock(), payload: { station_id: station, station_name: config.station_name, date, snapshot: bundle.snapshot, source_fingerprint: bundle.snapshot.source_fingerprint, zero_report: data.zero_report, content_status: 'checked', checked_at: clock(), checked_by: user._id, checked_by_name: user.nickname || user.username || '', source_refs: bundle.snapshot.inspections.map(row => ({ type: 'station_inspection', id: row._id, revision: row.revision || 1 })).concat(bundle.supplement ? [{ type: 'supplement', id: bundle.supplement._id, revision: bundle.supplement.revision }] : []) } })
    },
    async listDailyV1(user, data, config) { const start = P.requireDate(data.start_date); const end = P.requireDate(data.end_date); if (P.daysBetween(start, end).length > 93) P.fail('日历一次最多查询 93 天'); const bundle = await dailyRows(stationOf(data), start, end, config); return { days: bundle.days, enabled_from: config.enabled_from } },
    async getWeeklyV1(user, data, config) { return { ...await periodBundle(stationOf(data), 'weekly', data, config), permissions: permissions(user, config) } },
    async getMonthlyV1(user, data, config) { return { ...await periodBundle(stationOf(data), 'monthly', data, config), permissions: permissions(user, config) } },
    async saveWeeklyV1(user, data, config) { return savePeriod(user, data, 'weekly', config) },
    async saveMonthlyV1(user, data, config) { return savePeriod(user, data, 'monthly', config) },
    registerIssueV1: registerIssue,
    exportV1: exportDocument,
    async listRevisionsV1(user, data) { const kind = P.text(data.kind); if (!['config', 'supplement', 'daily', 'weekly', 'monthly'].includes(kind)) P.fail('版本类型不正确'); const access = await acl.ensureActionAcl(user, 'readHistory', { readHistory: [actionRule(kind === 'config' ? 'settings' : kind === 'supplement' ? 'daily' : kind, 'view')] }, [], { cloudFunction: 'crm-safety-management' }); if (!access.ok) P.fail(access.msg || '无权查看该类台账版本', 403); const record = await readOne(database, COLLECTIONS[kind], P.text(data.record_id)); if (!record || record.station_id !== stationOf(data)) P.fail('记录不存在', 404); const revisions = await readAll(database, 'crm_safety_revisions', { record_id: record._id, kind }); return { current: record, revisions: revisions.sort((a, b) => b.revision - a.revision) } }
  }
  async function main(event = {}, context = {}) {
    const action = P.text(event.action); const data = event.data || {}
    if (!Object.hasOwn(handlers, action)) return { code: 400, msg: '未知 action' }
    try {
      if (!P.text(event.token)) return { code: 401, msg: '未登录或登录已过期' }
      const userRows = await database.collection('crm_users').where({ token: event.token }).limit(1).get(); const user = userRows.data?.[0]
      if (!user) return { code: 401, msg: '未登录或登录已过期' }
      const access = await acl.ensureActionAcl(user, action, PAGE_ACTION_RULES, ['saveConfigV1', 'listAssignableUsersV1'], { cloudFunction: 'crm-safety-management', requestId: context.requestId || '' })
      if (!access.ok) return { code: access.code || 403, msg: access.msg || '无权操作' }
      const config = await getConfig(stationOf(data))
      const result = await handlers[action](user, data, config)
      if (/^(save|confirm|register)/.test(action)) { try { await database.collection('crm_operation_logs').add({ user_id: user._id, username: user.username || '', role: user.role || '', action: `safety_management_${action}`, detail: { record_id: result?._id || result?.hazard_id || '', revision: result?.revision || 0, station_id: stationOf(data) }, request_id: context.requestId || '', created_at: clock() }) } catch (error) { console.error('[crm-safety-management] audit log failed', error.message) } }
      return { code: 0, data: result }
    } catch (error) { if (!error.code) console.error('[crm-safety-management]', action, error); return { code: Number(error.code) || 500, msg: error.message || '安全管理服务异常' } }
  }
  return { main, sourceBundle, dailyRows, periodBundle, handlers }
}
module.exports = { createService, PAGE_ACTION_RULES, COLLECTIONS }
