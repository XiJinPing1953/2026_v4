'use strict'

const crypto = require('crypto')
const DAY = 86400000
const inspectionPolicy = require('./inspectionPolicyLocal')
const W = require('./workflow')
const STATION = inspectionPolicy.STATION
const CLASSIFICATION_VERSION = inspectionPolicy.CLASSIFICATION_VERSION
const CATEGORIES = inspectionPolicy.CATEGORIES.map(({ code, label }) => ({ id: String(code), name: label }))
const CATEGORY_NAMES = CATEGORIES.map(row => row.name)
const ITEM_CATEGORY = inspectionPolicy.ITEM_CATEGORIES
const CATEGORY_ITEMS = Object.fromEntries(CATEGORIES.map(row => [row.id, Object.keys(ITEM_CATEGORY).filter(code => ITEM_CATEGORY[code] === row.id)]))
const RELATED = { filling_housekeeping: ['5'], public_cylinder_zoning: ['6'], tank_safety_valve: ['6'], pump_safety_valve: ['6'], public_lightning_static_report: ['6'], public_entry_management: ['4'], public_cylinder_transport: ['2'], filling_explosion_emergency_light: ['2'] }
const SUPPLEMENT_DEFINITIONS = [
  ['S01', '1', '特殊作业', '当天是否开展动火、有限空间、高处、吊装、临时用电等作业；开展时核对地点、审批、监护和措施', ['not_conducted']],
  ['S02', '2', '设备运行及支撑', '容器、泵、管道的异常振动、异响、摩擦以及支座、基础、支吊架；引用已有外观和螺栓检查', []],
  ['S03', '2', '安全附件与仪表有效状态', '核对适用附件及仪表检验校验有效状态和规定标识，引用证书或报告', ['not_applicable']],
  ['S04', '3', '岗位资格和班前交底', '核对在岗作业、检查人员资格、岗位安排及班前教育、交底，引用人员记录', ['not_conducted']],
  ['S05', '3', '劳保及作业纪律', '核对劳动防护用品正确佩戴使用及违章指挥、违章操作、违反劳动纪律', []],
  ['S06', '3', '充装过程和追溯', '充装前中后检查、适用计量复检、不合格或超量处置、许可范围及追溯；引用实际充装记录', ['not_conducted']],
  ['S07', '4', '作业环境补充', '核对普通照明、通风、物料堆放和适用环境条件；不设通用温湿度限值', []],
  ['S08', '5', '消防栓及配套器材', '核对现场状态、取用条件、缺损等明显异常；不要求每日放水或动作试验', ['not_applicable']],
  ['S09', '6', '气瓶及变化标志', '核对充装合格标签、气瓶警示标签和新增或变化标志，引用充装收发资料', ['not_conducted']],
  ['S10', '7', '应急物资状态', '核对外观、配套和有效状态；引用原全厂公共项照片，定期记录保留相应周期', []],
  ['S11', '7', '内部报告和投诉', '确认当日内部报告、投诉举报等安全问题，存在时登记或关联已有隐患', []],
  ['S12', '7', '未关闭隐患临时管控', '核对未关闭隐患的临时管控是否落实以及恶化或变化，引用原隐患编号', ['not_applicable']],
  ['S13a', '2', '装卸软管和连接', '有装卸作业时核对软管及连接状态，引用实际装卸记录', ['not_conducted']],
  ['S13b', '3', '装卸人员与过程', '有装卸作业时核对人员、作业前后检查及过程控制', ['not_conducted']],
  ['S13c', '4', '装卸天气与工况', '有装卸作业时核对天气和异常工况', ['not_conducted']],
  ['S14', '2', '专用设施适用检查', '仅核对实际存在且已明确适用的膨胀补偿、爆破片、阻火器、非金属衬里等设施', ['not_applicable']]
].map(([code, category_code, label, standard, conditional]) => ({ code, category_code, label, standard, allowed_results: ['normal', 'abnormal', ...conditional] }))
const DEFINITION_MAP = Object.fromEntries(SUPPLEMENT_DEFINITIONS.map(item => [item.code, item]))
const OPEN_STATUSES = ['pending_rectification', 'pending_verification']

function fail(message, code = 400) { const error = new Error(message); error.code = code; throw error }
function text(value, max = 4000) { if (value == null) return ''; if (typeof value !== 'string' && typeof value !== 'number') fail('文本字段格式不正确'); const result = String(value).trim(); if (result.length > max) fail(`文本最多 ${max} 字`); return result }
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value }
function requireDate(value) { if (!validDate(value)) fail('日期格式或日期值不正确'); return value }
function shanghaiDate(at = Date.now()) { return new Date(Number(at) + 8 * 3600000).toISOString().slice(0, 10) }
function atDate(date) { return Date.parse(`${requireDate(date)}T00:00:00+08:00`) }
function daysBetween(start, end) { const from = atDate(start); const to = atDate(end); if (to < from || to - from > 366 * DAY) fail('统计日期范围不正确'); const result = []; for (let at = from; at <= to; at += DAY) result.push(shanghaiDate(at)); return result }
function periodForWeek(date) { const at = atDate(date); const weekday = new Date(at + 8 * 3600000).getUTCDay(); const start = at - ((weekday + 6) % 7) * DAY; return { start_date: shanghaiDate(start), end_date: shanghaiDate(start + 6 * DAY) } }
function periodForMonth(month) { if (!/^\d{4}-\d{2}$/.test(month || '')) fail('月份格式不正确'); const start = requireDate(`${month}-01`); const [year, mon] = month.split('-').map(Number); const end = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10); return { start_date: start, end_date: end } }
function previousMonth(month) { const [year, mon] = month.split('-').map(Number); return new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7) }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])); return value }
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex') }
function identity(kind, station, date) { return `${kind}_${fingerprint([station, date]).slice(0, 32)}` }
function listStrings(value, max = 100) { if (value == null) return []; if (!Array.isArray(value) || value.length > max) fail('列表格式不正确或过长'); return [...new Set(value.map(item => text(item, 200)).filter(Boolean))] }
function references(value) { if (value == null) return []; if (!Array.isArray(value) || value.length > 50) fail('证据最多关联 50 项'); return value.map(entry => { if (!entry || !['record', 'url', 'file'].includes(entry.type)) fail('证据类型不正确'); const ref = text(entry.value, 2000); if (!ref || entry.type === 'url' && !/^https?:\/\//i.test(ref) || entry.type === 'file' && !ref.startsWith('cloud://')) fail('证据编号、链接或附件无效'); return { type: entry.type, value: ref, label: text(entry.label, 200) } }) }
function fileReferences(evidence = []) { return evidence.filter(ref => ref.type === 'file').map(ref => ref.value) }
function rolePermissions(user, config, superAdmin = false) { const userId = text(user?._id); const roles = config?.roles || {}; const has = role => Boolean(userId) && (roles[role] || []).includes(userId); return { configure: Boolean(superAdmin), daily: has('safety_officer'), weekly: has('safety_director'), monthly: has('principal'), view: true, export: true } }
function normalizeConfig(value, station = STATION.id) { if (station !== STATION.id) fail('当前仅支持已配置的新拓厂站'); const roles = {}; for (const key of ['safety_officer', 'safety_director', 'principal']) roles[key] = listStrings(value.roles?.[key], 50); return { station_id: station, station_name: STATION.name, enabled_from: requireDate(value.enabled_from), roles, special_equipment: listStrings(value.special_equipment, 50) } }
function normalizeSupplementItem(input) { const code = text(input?.code, 20); const definition = DEFINITION_MAP[code]; if (!definition) fail(`未知补充检查项目：${code}`); const result = text(input.result_code, 30); if (result && !definition.allowed_results.includes(result)) fail(`${code} 不支持该检查结果`); const details = {}; for (const key of ['types', 'location', 'approval', 'monitor', 'measures']) details[key] = text(input.details?.[key], 2000); return { code, category_code: definition.category_code, label: definition.label, standard: definition.standard, result_code: result, note: text(input.note), reason: text(input.reason, 1000), evidence: references(input.evidence), hazard_ids: listStrings(input.hazard_ids), details } }
function mergeSupplement(previous, input) { if (!Array.isArray(input) || input.length > SUPPLEMENT_DEFINITIONS.length) fail('补充检查项目格式不正确'); const seen = new Set(); const merged = new Map((previous || []).map(row => [row.code, row])); for (const row of input) { const item = normalizeSupplementItem(row); if (seen.has(item.code)) fail(`补充检查项目重复：${item.code}`); seen.add(item.code); merged.set(item.code, item) } return SUPPLEMENT_DEFINITIONS.filter(def => merged.has(def.code)).map(def => merged.get(def.code)) }
function hasAbnormalEvidence(item, hazard, context = {}) {
  const date = context.date
  if (!date || !hazard) return false
  if ((hazard.observations || []).some(obs => obs.source_type === 'supplement' && obs.item_code === item.code && observationDate(obs) === date && obs.result_code !== 'normal' && !obs.correction_reason)) return true
  for (const inspection of context.inspections || []) {
    const versions = [inspection, ...(inspection.source_revisions || []).map(revision => ({ ...revision.snapshot, _id: inspection._id }))]
    for (const version of versions) {
      if (version.inspection_date !== date) continue
      for (const check of version.items || []) {
        if (!check.is_abnormal && check.result_code !== 'abnormal') continue
        if (![categoryFor(check), ...(RELATED[check.item_code] || [])].includes(item.category_code)) continue
        if (check.linked_hazard_id === hazard._id || hazard.inspection_id === inspection._id && hazard.item_code === check.item_code || (hazard.observations || []).some(obs => obs.source_type === 'station_inspection' && obs.source_id === inspection._id && obs.item_code === check.item_code && observationDate(obs) === date)) return true
      }
    }
  }
  return false
}
function validateSupplement(items, hazards, config, context = {}) { const missing = []; const byCode = new Map((items || []).map(row => [row.code, row])); const ids = new Set(hazards.map(row => row._id)); const open = hazards.filter(row => OPEN_STATUSES.includes(row.status)); for (const def of SUPPLEMENT_DEFINITIONS) { const item = byCode.get(def.code); if (!item?.result_code) { missing.push(`${def.code} ${def.label}待检查`); continue } if (item.result_code.startsWith('not_') && !item.reason) missing.push(`${def.code} 请说明未开展或不适用原因`); if (item.result_code === 'abnormal' && (!item.note || !item.hazard_ids.length)) missing.push(`${def.code} 异常须描述并关联已登记隐患`); if (item.result_code === 'abnormal' && item.hazard_ids.some(id => !hasAbnormalEvidence(item, hazards.find(hazard => hazard._id === id), context))) missing.push(`${def.code} 异常引用缺少当日该项观察或同类巡检异常依据；已关闭问题复发需新建隐患`); if (item.hazard_ids.some(id => !ids.has(id))) missing.push(`${def.code} 关联隐患不存在或不属于本厂站`); if (def.code === 'S01' && ['normal', 'abnormal'].includes(item.result_code)) { for (const field of ['types', 'location', 'approval', 'monitor', 'measures']) if (!item.details?.[field]) missing.push(`S01 特殊作业的${({ types: '类型', location: '地点', approval: '审批', monitor: '监护', measures: '措施' })[field]}待核对`) } if (def.code === 'S12' && open.length && item.result_code === 'not_applicable') missing.push('存在未关闭隐患，S12 不能选择不适用'); if (def.code === 'S14' && config?.special_equipment?.length && item.result_code === 'not_applicable') missing.push('已配置专用设施，S14 需要实际检查') }
  const unloading = ['S13a', 'S13b', 'S13c'].map(code => byCode.get(code)?.result_code).filter(Boolean); if (unloading.includes('not_conducted') && unloading.some(result => result !== 'not_conducted')) missing.push('装卸作业是否开展的三个检查项需一致'); return missing }
function categoryFor(item) { const value = String(item.category_code || ITEM_CATEGORY[item.item_code] || (['filling_explosion_light', 'filling_emergency_light'].includes(item.item_code) ? '5' : '7')); return /^[1-7]$/.test(value) ? value : '7' }
function issueDate(hazard) { return hazard.first_discovered_date || hazard.inspection_date || (hazard.first_discovered_at ? shanghaiDate(hazard.first_discovered_at) : '') }
function observationDate(obs) { return obs.observed_date || (obs.observed_at ? shanghaiDate(obs.observed_at) : '') }
function hazardAsOf(hazard, date) {
  const cutoff = atDate(date) + DAY
  const verified = Number(hazard.verified_at || 0)
  const cancelled = Number(hazard.cancelled_at || 0)
  const closed = hazard.status === 'closed' && hazard.verification_result === 'passed' && verified > 0 && verified < cutoff
  const cancellationProven = hazard.status === 'cancelled' && cancelled > 0 && cancelled < cutoff
  const rectified = Number(hazard.rectified_at || 0)
  const rejected = hazard.verification_result === 'rejected' && verified > 0 && verified < cutoff
  const status = closed ? 'closed' : cancellationProven ? 'cancelled' : rectified > 0 && rectified < cutoff && !rejected ? 'pending_verification' : 'pending_rectification'
  return { ...hazard, current_status: hazard.status, status, as_of_date: date, closure_time_unverified: ['closed', 'cancelled'].includes(hazard.status) && !(hazard.status === 'closed' ? verified > 0 && hazard.verification_result === 'passed' : cancelled > 0) }
}
function hasProgressInPeriod(hazard, start, end) { return [hazard.rectified_at, hazard.verified_at, hazard.report?.reported_at, hazard.on_site_rectification?.completed_at, hazard.on_site_rectification?.rechecked_at].some(at => Number(at) > 0 && shanghaiDate(at) >= start && shanghaiDate(at) <= end) }

function isObservedOn(hazard, date, inspectionIds, supplementIds) { return issueDate(hazard) === date || inspectionIds.has(hazard.inspection_id) || supplementIds.has(hazard._id) || [hazard.rectified_at, hazard.verified_at, hazard.report?.reported_at, hazard.on_site_rectification?.completed_at, hazard.on_site_rectification?.rechecked_at].some(at => Number(at) > 0 && shanghaiDate(at) === date) || (hazard.observations || []).some(obs => observationDate(obs) === date) }
function buildDailySnapshot({ station_id = STATION.id, date, inspections = [], hazards = [], supplement = null, supplement_history = [], config = null }) {
  requireDate(date)
  const sortedInspections = [...inspections].sort((a, b) => Number(a.ended_at || a.inspection_at) - Number(b.ended_at || b.inspection_at) || String(a._id).localeCompare(String(b._id)))
  const allHazards = [...hazards].sort((a, b) => String(a._id).localeCompare(String(b._id)))
  const workflowObservations = supplement?.workflow_observations || []
  const useWorkflow = workflowObservations.length > 0 || (!(supplement?.items || []).length && sortedInspections.some(row => Number(row.template_version) >= 4))
  const workflowResults = useWorkflow ? sortedInspections.map((inspection, index) => W.deriveWorkflow({ inspection, observation: workflowObservations.find(row => row.inspection_id === inspection._id), hazards: allHazards, config: config || {}, require_current_hazards: index === sortedInspections.length - 1, reference_observations: workflowObservations })) : []
  const items = useWorkflow ? workflowResults.flatMap(result => result.items) : supplement?.items || []
  const inspectionIds = new Set(sortedInspections.map(row => row._id)); const linkedIds = new Set([...items, ...supplement_history.flatMap(revision => revision.snapshot?.items || [])].flatMap(row => row.hazard_ids || []))
  const issues = allHazards.filter(row => isObservedOn(row, date, inspectionIds, linkedIds))
  const hazardsAsOf = allHazards.filter(row => issueDate(row) <= date).map(row => hazardAsOf(row, date))
  const historical_pending = hazardsAsOf.filter(row => OPEN_STATUSES.includes(row.status) && issueDate(row) < date)
  const categories = CATEGORIES.map(row => ({ ...row, checks: [] }))
  const missing = []
  if (!sortedInspections.length) missing.push('尚无当日厂站巡检')
  for (const inspection of sortedInspections) {
    if (!inspection.started_at || !inspection.ended_at || !text(inspection.weather)) missing.push(`${inspection.inspection_no || inspection._id} 缺少实际起止时间或天气，请更正来源记录`)
    const template = inspectionPolicy.getTemplate(inspection.template_code, inspection.template_version)
    const expected = template ? inspectionPolicy.templateItems(template).map(entry => entry.item.code) : []
    const actual = (inspection.items || []).map(item => item.item_code)
    if (!expected.length || actual.length !== expected.length || new Set(actual).size !== expected.length || expected.some(code => !actual.includes(code))) missing.push(`${inspection.inspection_no || inspection._id} 模板无法识别或检查明细有缺项、重复、未知项目`)
    if (inspection.started_at && inspection.ended_at && (inspection.started_at > inspection.ended_at || shanghaiDate(inspection.ended_at) !== date)) missing.push(`${inspection.inspection_no || inspection._id} 实际检查时段与业务日期不一致`)
    for (const item of inspection.items || []) {
      const category = categoryFor(item); const hazardIds = issues.filter(hazard => hazard._id === item.linked_hazard_id || hazard.inspection_id === inspection._id && hazard.item_code === item.item_code || (hazard.observations || []).some(obs => obs.source_id === inspection._id && obs.item_code === item.item_code)).map(hazard => hazard._id)
      const abnormal = item.is_abnormal || item.result_code === 'abnormal'
      if (abnormal && !hazardIds.length) missing.push(`${inspection.inspection_no || inspection._id} ${item.item_label_snapshot || item.item_code} 异常尚未关联隐患`)
      if (!['normal', 'abnormal', 'not_running'].includes(item.result_code)) missing.push(`${item.item_label_snapshot || item.item_code} 待检查`)
      if (item.result_code === 'not_running' && !item.not_running_reason) missing.push('管道压力未运行需保留原因')
      categories[Number(category) - 1].checks.push({ source_type: 'station_inspection', source_id: inspection._id, source_revision: inspection.revision || 1, item_code: item.item_code, area: item.area_label_snapshot || '', label: item.item_label_snapshot || item.item_code, standard: item.item_label_snapshot || item.item_code, result_code: item.result_code, note: item.issue_note || item.not_running_reason || '', evidence: (item.photo_file_ids || []).map(value => ({ type: 'file', value })), related_categories: RELATED[item.item_code] || [], hazard_ids: hazardIds })
    }
  }
  if (useWorkflow) {
    for (const item of items) categories[Number(item.category_code) - 1].checks.push({ ...item, related_categories: [] })
    missing.push(...workflowResults.flatMap(result => result.missing))
  } else {
    const legacyMissing = validateSupplement(items, hazardsAsOf, config, { date, inspections: sortedInspections })
    for (const def of SUPPLEMENT_DEFINITIONS) { const item = items.find(row => row.code === def.code); categories[Number(def.category_code) - 1].checks.push({ source_type: 'supplement', source_id: supplement?._id || '', source_revision: supplement?.revision || 0, item_code: def.code, label: def.label, standard: def.standard, result_code: item?.result_code || '', note: item?.note || '', reason: item?.reason || '', evidence: item?.evidence || [], details: item?.details || {}, related_categories: [], hazard_ids: item?.hazard_ids || [], missing: legacyMissing.filter(message => message.startsWith(def.code + ' ')) }) }
    missing.push(...legacyMissing)
  }
  for (const category of categories) {
    const original = category.checks.filter(check => check.source_type === 'station_inspection')
    const extras = category.checks.filter(check => check.source_type !== 'station_inspection')
    const result_counts = { normal: 0, abnormal: 0, not_running: 0, not_conducted: 0, not_applicable: 0, pending: 0 }
    for (const check of category.checks.filter(check => !check.covered_by_inspection)) { const result = check.missing?.length ? 'pending' : check.result_code || 'pending'; result_counts[result] = (result_counts[result] || 0) + 1 }
    category.coverage = { inspection_item_count: new Set(original.map(check => check.item_code)).size, inspection_record_count: original.length, covered_group_count: new Set(extras.filter(check => check.covered_by_inspection).map(check => check.item_code)).size, supplement_group_count: new Set(extras.map(check => check.item_code)).size, result_counts, pending: category.checks.filter(check => !check.result_code || check.missing?.length).map(check => ({ item_code: check.item_code, label: check.label, messages: check.missing?.length ? check.missing : [`${check.label}待检查`], inspection_id: ['inspection_workflow', 'inspection_coverage', 'station_inspection'].includes(check.source_type) ? check.source_id : '' })) }
  }
  for (const revision of supplement_history) for (const item of revision.snapshot?.items || []) if (item.result_code === 'abnormal' && !(item.hazard_ids || []).some(id => allHazards.some(hazard => hazard._id === id)) && !(items.find(latest => latest.code === item.code)?.hazard_ids || []).length) missing.push(`${item.code} 历史补充检查发现异常尚未登记或关联隐患`)
  for (const category of categories) category.issues = issues.filter(hazard => { const source = categories.flatMap(row => row.checks.map(check => ({ ...check, category: row.id }))).find(check => check.hazard_ids.includes(hazard._id)); return String(hazard.category_code || ITEM_CATEGORY[hazard.item_code] || source?.category || '7') === category.id })
  const observations = issues.flatMap(hazard => (hazard.observations || []).filter(obs => observationDate(obs) === date).map(obs => ({ ...obs, hazard_id: hazard._id, hazard_no: hazard.hazard_no })))
  const source_fingerprint = fingerprint({ classification_version: CLASSIFICATION_VERSION, date, inspections: sortedInspections, supplement, supplement_history, issues, historical_pending, special_equipment: config?.special_equipment || [], config_revision: config?.revision || 0 })
  const abnormalChecks = categories.flatMap(row => row.checks).filter(row => !row.covered_by_inspection && row.result_code === 'abnormal').length
  return { station_id, station_name: config?.station_name || STATION.name, date, classification_version: CLASSIFICATION_VERSION, categories, inspections: sortedInspections, workflow_observations: workflowObservations, supplement_history, issues, historical_pending, observations, missing: [...new Set(missing)], complete: missing.length === 0, source_fingerprint, summary: { inspection_count: sortedInspections.length, issue_count: issues.length, abnormal_check_count: abnormalChecks, historical_pending_count: historical_pending.length, zero_report_allowed: missing.length === 0 && !issues.length && !historical_pending.length && !abnormalChecks } }
}
function checkDailyConfirmation(snapshot, zeroReport) { if (!snapshot.complete) fail(`日表尚未完成：${snapshot.missing.join('；')}`); if (zeroReport && !snapshot.summary.zero_report_allowed) fail('发现问题、复见未关闭问题或检查不完整时不能确认零报告'); return true }
function recordStatus(snapshot, record, enabled) { if (!enabled) return 'not_enabled'; if (!snapshot.inspections.length) return 'no_inspection'; if (record && record.source_fingerprint !== snapshot.source_fingerprint) return 'recheck_required'; if (!record || !snapshot.complete) return 'incomplete'; return 'pending_signature' }
function aggregateStatistics({ period, config, daily, hazards, now = Date.now() }) {
  const today = shanghaiDate(now); const end = period.end_date < today ? period.end_date : today
  const periodDates = period.start_date > end ? [] : daysBetween(period.start_date, end)
  const dueDates = periodDates.filter(date => config?.enabled_from && date >= config.enabled_from)
  const dailyByDate = new Map(daily.map(row => [row.date, row]))
  const asOfDate = period.end_date < today ? period.end_date : today
  const asOfHazards = hazards.filter(row => issueDate(row) <= asOfDate).map(row => hazardAsOf(row, asOfDate))
  const first = asOfHazards.filter(row => issueDate(row) >= period.start_date && issueDate(row) <= period.end_date)
  const closed = first.filter(row => row.status === 'closed' && Number(row.verified_at) > 0 && row.verification_result === 'passed')
  const reobservations = hazards.flatMap(row => {
    const observations = (row.observations || []).filter(obs => !obs.correction_reason && !(obs.source_type === 'station_inspection' && Number(obs.source_revision) > 1))
    const firstAt = Number(row.first_discovered_at || row.inspection_at || 0)
    const firstSource = row.source_id || row.inspection_id
    const firstItem = row.source_item_code || row.item_code
    const firstIndex = observations.findIndex(obs => obs.source_id === firstSource && obs.item_code === firstItem && Number(obs.observed_at) === firstAt)
    return observations.filter((obs, index) => index !== firstIndex && observationDate(obs) >= period.start_date && observationDate(obs) <= period.end_date && (Number(obs.observed_at) > firstAt || firstIndex >= 0)).map(obs => ({ ...obs, hazard_id: row._id, hazard_no: row.hazard_no }))
  })
  const backlog = asOfHazards.filter(row => issueDate(row) < period.start_date && OPEN_STATUSES.includes(row.status))
  const historical_progress = asOfHazards.filter(row => issueDate(row) < period.start_date && hasProgressInPeriod(row, period.start_date, asOfDate))
  const recurrence = first.filter(row => row.recurrence_of)
  return { period, as_of_date: asOfDate, expected_days: dueDates.length, inspected_days: periodDates.filter(date => dailyByDate.get(date)?.inspection_count > 0).length, checked_days: periodDates.filter(date => dailyByDate.get(date)?.content_checked ?? dailyByDate.get(date)?.status === 'pending_signature').length, missing_days: dueDates.filter(date => !dailyByDate.get(date)?.inspection_count), incomplete_days: dueDates.filter(date => dailyByDate.get(date)?.status !== 'pending_signature'), daily, new_hazard_count: first.length, verified_closed_count: closed.length, rectification_rate: first.length ? closed.length / first.length : null, rectification_rate_label: first.length ? `${Math.round(closed.length / first.length * 10000) / 100}%` : '无此类隐患', new_hazards: first, reobservations, reobserved_hazards: hazards.filter(row => reobservations.some(obs => obs.hazard_id === row._id)), recurrence, historical_pending: backlog, historical_progress }
}
const WEEKLY_FIELDS = ['actual_date', 'organizer', 'participants', 'started_at', 'ended_at', 'scope', 'site_findings', 'execution_evaluation', 'repeated_problem_analysis', 'system_gaps', 'next_plan']
const MONTHLY_FIELDS = ['actual_date', 'started_at', 'ended_at', 'title', 'location', 'host', 'recorder', 'participants', 'absences', 'previous_decisions', 'accidents_and_near_misses', 'safety_situation', 'major_risks', 'special_work', 'training', 'expenditure', 'emergency_management', 'contractors', 'causes', 'principal_summary']
function timestamp(value) { if (typeof value === 'number' || /^\d{13}$/.test(String(value))) return Number(value); const str = String(value); return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str.replace(' ', 'T')}+08:00`) }
function normalizeReport(kind, input = {}) { const fields = kind === 'weekly' ? WEEKLY_FIELDS : MONTHLY_FIELDS; const content = {}; for (const key of fields) content[key] = text(input[key], 10000); if (content.actual_date) requireDate(content.actual_date); content.hazard_ids = listStrings(input.hazard_ids); if (kind === 'weekly') { if (input.management_issues != null && (!Array.isArray(input.management_issues) || input.management_issues.length > 100)) fail('管理问题列表格式不正确'); content.management_issues = (input.management_issues || []).map(row => { const risk = text(row.risk_level); if (!['general', 'elevated', 'major'].includes(risk)) fail('问题风险等级须为一般、较大或重大'); const issue = { type: text(row.type, 100), description: text(row.description), risk_level: risk, responsible_name: text(row.responsible_name, 100), measure: text(row.measure), due_date: requireDate(row.due_date) }; if (!issue.type || !issue.description || !issue.responsible_name || !issue.measure) fail('管理问题需填写类型、问题、责任人、措施和期限'); return issue }) } else { if (input.decisions != null && (!Array.isArray(input.decisions) || input.decisions.length > 100)) fail('会议决议列表格式不正确'); content.decisions = (input.decisions || []).map(row => { const decision = { subject: text(row.subject), department: text(row.department, 100), responsible_name: text(row.responsible_name, 100), due_date: requireDate(row.due_date), status: text(row.status || 'pending', 100), implementation: text(row.implementation) }; if (!decision.subject || !decision.department || !decision.responsible_name) fail('决议需填写事项、责任部门、责任人和期限'); return decision }) }
  const required = fields.filter(field => !['absences', 'started_at', 'ended_at'].includes(field)); const missing = required.filter(key => !content[key]); if (!content.started_at || !content.ended_at) missing.push('started_at', 'ended_at');
  if (content.started_at && content.ended_at) { const start = timestamp(content.started_at); const end = timestamp(content.ended_at); if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > Date.now()) fail('实际起止时间不正确'); if (content.actual_date && shanghaiDate(end) !== content.actual_date) fail('实际结束时间须属于实际排查或会议日期') }; if (kind === 'monthly' && !content.decisions.length) missing.push('decisions'); return { content, missing: [...new Set(missing)], content_status: missing.length ? 'draft' : 'complete' } }
function normalizeReportFacts(value) { if (!value) return null; const reported_at = Number(value.reported_at); const reported_to = text(value.reported_to || value.recipient, 200); const method = text(value.method, 200); if (!reported_at || !reported_to || !method) fail('实际已上报需填写时间、对象和方式'); if (reported_at > Date.now()) fail('实际上报时间不能晚于当前时间'); return { reported_at, reported_to, method, requirements: text(value.requirements), temporary_measure: text(value.temporary_measure || value.temporary_controls) } }
function normalizeOnsite(value) { if (!value) return null; const completed_at = Number(value.completed_at || value.rectified_at); const note = text(value.note || value.measures); const rechecked_at = Number(value.rechecked_at); const recheck_note = text(value.recheck_note); if (!completed_at || !note || !rechecked_at || !recheck_note) fail('当场整改须填写实际措施、时间和复查情况'); if (rechecked_at < completed_at || rechecked_at > Date.now()) fail('当场整改复查时间不正确'); return { completed_at, note, rechecked_at, recheck_note, photo_file_ids: listStrings(value.photo_file_ids, 20) } }
function normalizeIssue(data, now = Date.now()) { const date = requireDate(data.date); const discovered_at = data.discovered_at ? Number(data.discovered_at) : now; if (!Number.isFinite(discovered_at) || discovered_at > now || shanghaiDate(discovered_at) !== date) fail('发现时间须为实际时间并属于所选日期'); const source_type = text(data.source_type); if (!['supplement', 'weekly'].includes(source_type)) fail('隐患来源不正确'); const client_submission_id = text(data.client_submission_id, 100); if (!/^[A-Za-z0-9_-]{8,100}$/.test(client_submission_id)) fail('请提供稳定且有效的提交标识'); const category_code = text(data.category_code || data.management_category); if (!CATEGORY_NAMES[Number(category_code) - 1]) fail('请选择1～7类主分类'); const issue_note = text(data.issue_note); if (!issue_note) fail('请描述发现的问题'); const hazard_level = text(data.hazard_level || 'general'); if (!['general', 'major'].includes(hazard_level)) fail('隐患等级只可选择一般或重大'); const result = { date, discovered_at, source_type, source_id: text(data.source_id), source_period_start: data.source_period_start ? requireDate(data.source_period_start) : '', source_item_code: text(data.source_item_code, 100), client_submission_id, category_code, issue_note, hazard_level, responsible_name: text(data.responsible_name, 100), planned_measure: text(data.planned_measure), planned_complete_date: text(data.planned_complete_date), evidence: references(data.evidence), existing_hazard_id: text(data.existing_hazard_id), recurrence_of: text(data.recurrence_of), report: normalizeReportFacts(data.report), on_site_rectification: normalizeOnsite(data.on_site_rectification || data.onsite_rectification), temporary_controls: text(data.temporary_controls) }; if (result.existing_hazard_id && result.recurrence_of) fail('关联未关闭隐患与复发新建不能同时选择'); if (!result.existing_hazard_id && (!result.responsible_name || !result.planned_measure || !validDate(result.planned_complete_date))) fail('新隐患需填写责任人、整改要求和期限'); if (!result.source_item_code) fail('请指定发现问题的检查项目'); if (source_type === 'supplement' && !DEFINITION_MAP[result.source_item_code]) fail('补充检查项目不存在'); if (source_type === 'supplement' && DEFINITION_MAP[result.source_item_code].category_code !== category_code) fail('补充检查主分类须与检查项目一致'); return result }

module.exports = { DAY, STATION, CLASSIFICATION_VERSION, CATEGORIES, CATEGORY_ITEMS, ITEM_CATEGORY, RELATED, SUPPLEMENT_DEFINITIONS, OPEN_STATUSES, fail, text, validDate, requireDate, shanghaiDate, atDate, daysBetween, periodForWeek, periodForMonth, previousMonth, fingerprint, identity, references, fileReferences, rolePermissions, normalizeConfig, mergeSupplement, validateSupplement, hasAbnormalEvidence, buildDailySnapshot, checkDailyConfirmation, recordStatus, aggregateStatistics, normalizeReport, normalizeIssue, issueDate, observationDate, hazardAsOf, hasProgressInPeriod }
