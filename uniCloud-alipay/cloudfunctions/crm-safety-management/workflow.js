'use strict'
// Structured observations belong to one saved inspection and never imply a signature.
const I = require('./inspectionPolicyLocal')
const SPECIAL_WORK_TYPES = [['hot_work', '动火作业'], ['confined_space', '有限空间作业'], ['height', '高处作业'], ['lifting', '吊装作业'], ['temporary_power', '临时用电作业'], ['other', '其他特殊作业']].map(([code, label]) => ({ code, label }))
const FACILITY_TYPES = [['expansion', '膨胀补偿'], ['rupture_disc', '爆破片'], ['flame_arrester', '阻火器'], ['nonmetal_lining', '非金属衬里'], ['other', '其他专用设施']].map(([code, label]) => ({ code, label }))
const DETAIL_FIELDS = { S02: ['scope'], S05: ['scope'], S07: ['scope'], S08: ['scope'], S10: ['scope'], S04: ['personnel', 'qualification', 'briefing'], S06: ['before', 'during', 'after', 'measurement', 'exceptions', 'exception_handling', 'scope_trace'], S09: ['labels'], S11: ['source', 'received_at', 'content'], S13a: ['hose', 'connections'], S13b: ['personnel', 'before_after', 'process'], S13c: ['weather', 'conditions'] }
const FIELD_LABELS = { scope: '实际补查范围', personnel: '当班人员', qualification: '岗位资格', briefing: '班前教育和交底', before: '充装前检查', during: '充装中检查', after: '充装后检查', measurement: '适用计量与复检', exceptions: '不合格瓶或超量情况', exception_handling: '异常处置', scope_trace: '充装范围和追溯', labels: '产品合格及气瓶警示标签', source: '报告来源', received_at: '报告时间', content: '报告内容', hose: '软管状态', connections: '连接状态', before_after: '作业前后检查', process: '过程控制', weather: '实际天气', conditions: '天气与异常工况' }
function policy() { return require('./policy') }
function timeText(at) { return at ? new Date(Number(at) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + '（北京时间）' : '待填写' }
function resultText(code) { return ({ normal: '正常', abnormal: '发现问题', not_conducted: '未开展', not_applicable: '不适用' })[code] || '待核查' }
function definitions() { return { special_work_types: SPECIAL_WORK_TYPES, facility_types: FACILITY_TYPES, supplement_definitions: policy().SUPPLEMENT_DEFINITIONS, coverage: I.SUPPLEMENT_COVERAGE || {} } }
function array(value, max = 100) { if (value == null) return []; if (!Array.isArray(value) || value.length > max) policy().fail('工作流明细列表格式不正确或过长'); return value }
function choice(value, options) { const result = policy().text(value, 100); if (result && !options.includes(result)) policy().fail('工作流选择值不正确'); return result }
function plainCheck(row = {}) { const P = policy(); return { result_code: choice(row.result_code, ['normal', 'abnormal']), note: P.text(row.note), evidence: P.references(row.evidence), hazard_ids: [...new Set(array(row.hazard_ids).map(value => P.text(value, 200)).filter(Boolean))] } }
function unique(rows, field, label) { const values = rows.map(row => row[field]); if (new Set(values).size !== values.length) policy().fail(`${label}不能重复`); return rows }
function normalizeWorkflow(input = {}, inspection, now) {
  const P = policy(); const observed_at = Number(input.observed_at || 0)
  if (!Number.isFinite(observed_at) || !observed_at || observed_at > now || P.shanghaiDate(observed_at) !== inspection.inspection_date || observed_at < Number(inspection.ended_at || inspection.inspection_at || 0)) P.fail('情况确认时刻须为实际时间，不早于本次巡检结束，并属于本次业务日期')
  const special_work = unique(array(input.special_work, 6).map(row => ({ type: choice(row.type, SPECIAL_WORK_TYPES.map(item => item.code)), conducted: choice(row.conducted, ['yes', 'no']), events: unique(array(row.events, 30).map((event, index) => ({ ...plainCheck(event), id: P.text(event.id || `${row.type}_${index}`, 100), name: P.text(event.name, 200), location: P.text(event.location, 500), started_at: Number(event.started_at || 0), ended_at: Number(event.ended_at || 0), approval: P.text(event.approval, 2000), monitor: P.text(event.monitor, 500), measures: P.text(event.measures, 4000) })), 'id', '特殊作业事件编号') })), 'type', '特殊作业类型')
  const activities = {}; for (const key of ['filling', 'unloading', 'receiving', 'reports']) activities[key] = choice(input.activities?.[key], ['yes', 'no'])
  const checks = unique(array(input.checks, 16).map(row => { const code = P.text(row.code, 20); if (!Object.hasOwn(DETAIL_FIELDS, code)) P.fail('未知工作流检查项目'); const details = {}; for (const key of DETAIL_FIELDS[code] || []) details[key] = P.text(row.details?.[key], 4000); return { code, ...plainCheck(row), details } }), 'code', '工作流检查项目')
  const certificate_checks = unique(array(input.certificate_checks, 100).map((row, index) => ({ ...plainCheck(row), id: P.text(row.id || `certificate_${index}`, 100), equipment: P.text(row.equipment, 200), reference_no: P.text(row.reference_no, 200), valid_until: P.text(row.valid_until, 10), verification: choice(row.verification, ['unchanged', 'changed', 'missing']) })), 'id', '证书项目编号')
  const controls = unique(array(input.controls, 500).map(row => ({ hazard_id: P.text(row.hazard_id, 200), implemented: choice(row.implemented, ['yes', 'no']), changed: choice(row.changed, ['yes', 'no']), note: P.text(row.note), evidence: P.references(row.evidence) })), 'hazard_id', '临时措施核查')
  const facilities = unique(array(input.facilities, 5).map(row => ({ ...plainCheck(row), code: choice(row.code, FACILITY_TYPES.map(item => item.code)), name: P.text(row.name, 200), present: choice(row.present, ['yes', 'no', 'unknown']) })), 'code', '专用设施类型')
  const reference_sources = array(input.reference_sources, 30).map(row => ({ inspection_id: P.text(row.inspection_id, 200), source_revision: Number(row.source_revision), observed_at: Number(row.observed_at), workflow_fingerprint: P.text(row.workflow_fingerprint, 100) }))
  return { version: 1, observed_at, special_work, activities, checks, reference_sources, certificate_scope_confirmed: input.certificate_scope_confirmed === true, certificate_checks, controls, facilities }
}
function emptyWorkflow(inspection) { return { version: 1, observed_at: Number(inspection.ended_at || inspection.inspection_at || 0), special_work: SPECIAL_WORK_TYPES.map(row => ({ type: row.code, conducted: '', events: [] })), activities: { filling: '', unloading: '', receiving: '', reports: '' }, checks: [], certificate_scope_confirmed: false, certificate_checks: [], controls: [], facilities: FACILITY_TYPES.map(row => ({ code: row.code, present: '', result_code: '', note: '', evidence: [], hazard_ids: [] })) } }
function allHazardIds(workflow) { return [...new Set([...(workflow.checks || []), ...(workflow.special_work || []).flatMap(row => row.events || []), ...(workflow.certificate_checks || []), ...(workflow.facilities || [])].flatMap(row => row.hazard_ids || []).concat((workflow.controls || []).map(row => row.hazard_id)))] }
function pendingHazards(hazards, observedAt) {
  return hazards.filter(row => Number(row.first_discovered_at || row.inspection_at || policy().atDate(policy().issueDate(row))) <= observedAt && !(row.status === 'closed' && row.verification_result === 'passed' && Number(row.verified_at) > 0 && Number(row.verified_at) <= observedAt) && !(row.status === 'cancelled' && Number(row.cancelled_at) > 0 && Number(row.cancelled_at) <= observedAt))
}
function derivedCoverage(inspection, hazards) {
  const P = policy(); const template = I.getTemplate(inspection.template_code, inspection.template_version)
  const templateRows = template ? I.templateItems(template) : []
  return Object.entries(I.SUPPLEMENT_COVERAGE || {}).map(([code, expected]) => {
    const missing = []; const source_refs = []
    for (const itemCode of expected) {
      const templateItem = templateRows.find(row => row.item.code === itemCode)?.item
      const check = (inspection.items || []).find(row => row.item_code === itemCode)
      if (Number(inspection.template_version) < 4 || !templateItem?.supplement_coverage?.includes(code) || !check || !['normal', 'abnormal'].includes(check.result_code)) { missing.push(`${itemCode} 尚无新版对应范围的检查结果`); continue }
      source_refs.push({ source_id: inspection._id, source_revision: Number(inspection.revision || 1), item_code: itemCode, label: check.item_label_snapshot || templateItem.label, result_code: check.result_code, note: check.issue_note || '', evidence: (check.photo_file_ids || []).map(value => ({ type: 'file', value })), hazard_ids: hazards.filter(h => h._id === check.linked_hazard_id || h.inspection_id === inspection._id && h.item_code === itemCode || (h.observations || []).some(obs => obs.source_id === inspection._id && obs.item_code === itemCode && P.observationDate(obs) === inspection.inspection_date)).map(h => h._id) })
    }
    return { code, label: P.SUPPLEMENT_DEFINITIONS.find(row => row.code === code).label, status: missing.length ? 'pending' : 'covered', source_refs, result_code: missing.length ? '' : source_refs.some(row => row.result_code === 'abnormal') ? 'abnormal' : 'normal', missing }
  })
}
function deriveWorkflow({ inspection, observation = null, hazards = [], config = {}, require_current_hazards = true, reference_observations = [] }) {
  const P = policy(); const workflow = observation?.workflow || emptyWorkflow(inspection)
  const source_revision = Number(inspection.revision || 1); const sourceChanged = observation && observation.source_revision !== source_revision
  const coverage = derivedCoverage(inspection, hazards); const open_hazards = pendingHazards(hazards, workflow.observed_at)
  const dayEnd = P.atDate(inspection.inspection_date) + P.DAY - 1
  const laterHazards = require_current_hazards ? hazards.filter(row => [row.first_discovered_at, row.updated_at].some(at => Number(at) > workflow.observed_at && Number(at) <= dayEnd)) : []
  const items = P.SUPPLEMENT_DEFINITIONS.map(def => ({ ...def, item_code: def.code, source_type: 'inspection_workflow', source_id: inspection._id, source_revision, observed_at: workflow.observed_at, observed_by: observation?.observed_by || '', observed_by_name: observation?.observed_by_name || '', result_code: '', note: '', reason: '', evidence: [], hazard_ids: [], details: {}, detail_text: '', missing: [], covered_by_inspection: false }))
  const byCode = Object.fromEntries(items.map(item => [item.code, item])); const add = (code, msg) => byCode[code].missing.push(`${code} ${msg}`)
  function hasReferencedCheck(code, check) {
    return (workflow.reference_sources || []).some(ref => {
      const source = reference_observations.find(row => row.inspection_id === ref.inspection_id && row.source_revision === ref.source_revision && row.workflow.observed_at === ref.observed_at && P.fingerprint(row.workflow) === ref.workflow_fingerprint)
      if (!source) return false
      const candidates = code === 'S01' ? source.workflow.special_work.flatMap(row => row.events || []) : code === 'S03' ? source.workflow.certificate_checks : code === 'S14' ? source.workflow.facilities : source.workflow.checks.filter(row => row.code === code)
      return candidates.some(row => P.fingerprint(row) === P.fingerprint(check))
    })
  }
  function apply(code, check, label = byCode[code].label) {
    const item = byCode[code]
    if (!check?.result_code) { add(code, `${label}待核查`); return }
    item.result_code = check.result_code; item.note = check.note || ''; item.evidence = check.evidence || []; item.hazard_ids = check.hazard_ids || []; item.details = check.details || {}
    if (check.result_code === 'abnormal') {
      if (!check.note || !check.hazard_ids?.length) add(code, `${label}发现问题须描述并登记或关联隐患`)
      for (const id of check.hazard_ids || []) { const h = hazards.find(row => row._id === id); const sameObservation = (h?.observations || []).some(obs => obs.source_type === 'supplement' && obs.item_code === code && obs.inspection_id === inspection._id && P.observationDate(obs) === inspection.inspection_date); if (!sameObservation && !hasReferencedCheck(code, check) && !P.hasAbnormalEvidence({ ...item, category_code: item.category_code }, h ? { ...h, observations: (h.observations || []).filter(obs => obs.source_type !== 'supplement') } : null, { date: inspection.inspection_date, inspections: [inspection] })) add(code, `${label}异常引用缺少本次实际观察依据`) }
    }
  }
  function mergeChecks(code, checks) {
    const valid = checks.filter(row => row.result_code)
    byCode[code].result_code = valid.some(row => row.result_code === 'abnormal') ? 'abnormal' : checks.length && valid.length === checks.length ? 'normal' : ''
    byCode[code].note = checks.map(row => row.note).filter(Boolean).join('；'); byCode[code].evidence = checks.flatMap(row => row.evidence || []); byCode[code].hazard_ids = [...new Set(checks.flatMap(row => row.hazard_ids || []))]
  }
  function skipped(code, reason) { Object.assign(byCode[code], { result_code: 'not_conducted', reason, note: reason }) }
  for (const row of coverage) {
    const target = byCode[row.code]
    if (row.status === 'covered') Object.assign(target, { source_type: 'inspection_coverage', covered_by_inspection: true, result_code: row.result_code, evidence: row.source_refs.flatMap(ref => ref.evidence), hazard_ids: [...new Set(row.source_refs.flatMap(ref => ref.hazard_ids))], note: row.source_refs.map(ref => ref.note).filter(Boolean).join('；'), details: { source_refs: row.source_refs }, detail_text: row.source_refs.map(ref => `已引用：${ref.label}（${ref.result_code === 'abnormal' ? '发现问题' : '正常'}）`).join('\n') })
    else { const manual = workflow.checks.find(check => check.code === row.code); apply(row.code, manual); if (manual?.result_code && !manual.details?.scope) add(row.code, '旧模板补查须填写实际补查范围'); target.detail_text = [manual?.details?.scope, manual?.note].filter(Boolean).join('；') || '旧模板或原检查尚未覆盖此范围，需实际补查' }
  }
  const specialEvents = []
  for (const type of SPECIAL_WORK_TYPES) {
    const row = workflow.special_work.find(check => check.type === type.code)
    if (!row?.conducted) add('S01', `待确认是否开展${type.label}`)
    if (row?.conducted === 'yes') {
      if (!row.events?.length) add('S01', `${type.label}待填写具体作业`)
      for (const event of row.events || []) {
        specialEvents.push(event); apply('S01', event, type.label)
        for (const key of ['location', 'approval', 'monitor', 'measures']) if (!event[key]) add('S01', `${type.label}${({ location: '地点', approval: '审批依据', monitor: '监护人', measures: '安全措施' })[key]}待填写`)
        if (type.code === 'other' && !event.name) add('S01', '其他特殊作业名称待填写')
        if (!Number.isFinite(event.started_at) || !event.started_at || event.started_at > workflow.observed_at || event.started_at > dayEnd || event.ended_at && (event.ended_at < P.atDate(inspection.inspection_date) || event.ended_at < event.started_at || event.ended_at > workflow.observed_at)) add('S01', `${type.label}实际作业时段待核对（正在进行可不填结束）`)
      }
    }
    if (row?.conducted === 'no' && row.events?.length) add('S01', `${type.label}已有事件，不能同时记未开展`)
  }
  if (specialEvents.length) mergeChecks('S01', specialEvents)
  else if (SPECIAL_WORK_TYPES.every(type => workflow.special_work.find(row => row.type === type.code)?.conducted === 'no')) skipped('S01', '截至本次巡检，逐项确认未开展特殊作业')
  byCode.S01.details = { special_work: workflow.special_work }; byCode.S01.detail_text = workflow.special_work.map(row => `${SPECIAL_WORK_TYPES.find(type => type.code === row.type)?.label || row.type}：${row.conducted === 'no' ? '未开展' : row.conducted === 'yes' ? '已开展' : '待确认'}${(row.events || []).map(event => `；${event.name || ''} ${event.location}，开始 ${timeText(event.started_at)}，结束 ${event.ended_at ? timeText(event.ended_at) : '进行中'}，审批 ${event.approval}，监护 ${event.monitor}，措施 ${event.measures}，结论 ${resultText(event.result_code)}，${event.note || '无补充说明'}`).join('')}`).join('\n')
  const certs = workflow.certificate_checks
  if (!workflow.certificate_scope_confirmed) add('S03', '尚未确认资料清单完整覆盖本厂站适用设备、安全附件和仪表')
  if (!certs.length) add('S03', '请核对实际设备的证书、报告清单，尚无已核验依据')
  for (const row of certs) {
    apply('S03', row, row.equipment || '证书项目')
    if (!row.equipment || !row.verification) add('S03', '设备名称和资料核验情况待填写')
    if (row.result_code === 'normal' && (row.verification === 'missing' || !row.reference_no || !P.validDate(row.valid_until) || row.valid_until < inspection.inspection_date || !row.evidence.length)) add('S03', `${row.equipment}资料缺失、到期或未经核验，不能记正常`)
    if (row.verification === 'changed' && (!row.note || !row.evidence.length)) add('S03', `${row.equipment}资料变更需更新说明和证据`)
  }
  mergeChecks('S03', certs); byCode.S03.details = { certificate_checks: certs }; byCode.S03.detail_text = certs.map(row => `${row.equipment}：${row.reference_no || '编号待填'}；有效至 ${row.valid_until || '待核实'}；${({ unchanged: '已核对无变化', changed: '资料已变更', missing: '资料缺失' })[row.verification] || '待核验'}；结论 ${resultText(row.result_code)}；${row.note}`).join('\n')
  function manual(code) {
    const check = workflow.checks.find(row => row.code === code); apply(code, check)
    if (check?.result_code) for (const key of DETAIL_FIELDS[code] || []) {
      if (code === 'S06' && key === 'exception_handling' && check.details?.exceptions === 'no') continue
      if (!check.details?.[key]) add(code, `${FIELD_LABELS[key]}待核对`)
      if (check.result_code === 'normal' && /发现问题|待核实|不符合/.test(check.details?.[key] || '')) add(code, `${FIELD_LABELS[key]}存在问题或待核实，不能记正常`)
    }
    if (code === 'S06' && check?.result_code && !['yes', 'no'].includes(check.details?.exceptions)) add(code, '请点选有无不合格瓶或超量情况')
    byCode[code].detail_text = Object.entries(check?.details || {}).filter(([, value]) => value).map(([key, value]) => `${FIELD_LABELS[key] || key}：${value === 'yes' ? '有' : value === 'no' ? '无' : value}`).join('\n')
  }
  manual('S04')
  for (const [activity, codes, label] of [['filling', ['S06'], '充装'], ['unloading', ['S13a', 'S13b', 'S13c'], '装卸']]) {
    for (const code of codes) if (workflow.activities[activity] === 'no') skipped(code, `截至本次巡检未开展${label}`); else if (workflow.activities[activity] === 'yes') manual(code); else add(code, `待确认是否开展${label}`)
  }
  if (!workflow.activities.receiving) add('S09', '待确认是否有气瓶收发')
  if (!workflow.activities.filling) add('S09', '待确认是否有充装')
  if (workflow.activities.receiving === 'yes' || workflow.activities.filling === 'yes') manual('S09')
  else if (workflow.activities.receiving === 'no' && workflow.activities.filling === 'no') skipped('S09', '截至本次巡检未开展充装或气瓶收发；现场安全标志引用原巡检')
  if (workflow.activities.reports === 'no') Object.assign(byCode.S11, { result_code: 'normal', note: '截至本次巡检确认无新增安全问题报告或投诉' })
  else if (workflow.activities.reports === 'yes') { manual('S11'); if (byCode.S11.result_code !== 'abnormal') add('S11', '已收到安全问题报告须登记或关联问题') }
  else add('S11', '待确认有无新增安全问题报告或投诉')
  if (!open_hazards.length) Object.assign(byCode.S12, { result_code: 'not_applicable', reason: '截至确认时刻完整查询无未关闭隐患', note: '无此类待核事项' })
  else {
    for (const hazard of open_hazards) { const row = workflow.controls.find(check => check.hazard_id === hazard._id); if (!row?.implemented || !row?.changed) add('S12', `${hazard.hazard_no || hazard._id}临时措施落实及变化情况待确认`); if (row && (row.implemented === 'no' || row.changed === 'yes') && !row.note) add('S12', `${hazard.hazard_no || hazard._id}措施未落实或发生变化须说明`) }
    byCode.S12.result_code = byCode.S12.missing.length ? '' : workflow.controls.some(row => open_hazards.some(h => h._id === row.hazard_id) && (row.implemented === 'no' || row.changed === 'yes')) ? 'abnormal' : 'normal'
    byCode.S12.hazard_ids = open_hazards.map(row => row._id); byCode.S12.evidence = workflow.controls.flatMap(row => row.evidence); byCode.S12.note = workflow.controls.map(row => row.note).filter(Boolean).join('；')
  }
  if (laterHazards.length) add('S12', '确认时刻之后隐患有新增或状态变化，请重新核对截至新时刻的临时措施')
  byCode.S12.details = { controls: workflow.controls }; byCode.S12.detail_text = workflow.controls.map(row => `${hazards.find(h => h._id === row.hazard_id)?.hazard_no || row.hazard_id}：措施${row.implemented === 'yes' ? '已落实' : row.implemented === 'no' ? '未落实' : '待核'}；${row.changed === 'yes' ? '有变化' : row.changed === 'no' ? '无变化' : '变化待核'}；${row.note}`).join('\n')
  const present = []
  for (const type of FACILITY_TYPES) {
    const row = workflow.facilities.find(check => check.code === type.code)
    if (type.code === 'other' && !row?.present) continue
    if (!row?.present || row.present === 'unknown') add('S14', `${type.label}适用性待核定`)
    if (row?.present === 'yes') { present.push(row); apply('S14', row, type.label); if (type.code === 'other' && !row.name) add('S14', '其他专用设施名称待填写') }
  }
  if (present.length) mergeChecks('S14', present)
  else if (!byCode.S14.missing.length) Object.assign(byCode.S14, { result_code: 'not_applicable', reason: '实际适用清单已逐项核定，无此类设施', note: '实际适用清单已逐项核定，无此类设施' })
  for (const configured of config.special_equipment || []) if (!present.some(row => row.code === configured || row.name === configured || FACILITY_TYPES.find(type => type.code === row.code)?.label === configured)) add('S14', `已配置专用设施${configured}尚未对应到实际存在的检查项`)
  byCode.S14.details = { facilities: workflow.facilities }; byCode.S14.detail_text = workflow.facilities.filter(row => row.present).map(row => `${FACILITY_TYPES.find(type => type.code === row.code)?.label} ${row.name || ''}：${({ yes: '有', no: '无（已核定）', unknown: '待核实' })[row.present]}；${row.present === 'yes' ? '结论 ' + resultText(row.result_code) + '；' : ''}${row.note}`).join('\n')
  for (const item of items) {
    if (sourceChanged && !item.covered_by_inspection) add(item.code, '原巡检已更正，请按新版本重新核对本次情况')
    if (!observation && !item.covered_by_inspection && item.code !== 'S12') add(item.code, '本次情况尚未保存确认')
    item.missing = [...new Set(item.missing)]
    // A partially filled check must not be displayed as a completed normal result.
    if (item.missing.length && item.result_code !== 'abnormal') item.result_code = ''
  }
  return { workflow, source_revision, items, coverage, open_hazards, missing: [...new Set(items.flatMap(item => item.missing))], complete: items.every(item => !item.missing.length) }
}
function preventErasure(previous, next, earlier = []) {
  const P = policy()
  for (const old of [previous, ...earlier].filter(Boolean)) {
    if (old.observed_at > next.observed_at && old !== previous) continue
    for (const type of SPECIAL_WORK_TYPES) if (old.special_work?.find(row => row.type === type.code)?.conducted === 'yes' && next.special_work?.find(row => row.type === type.code)?.conducted === 'no') P.fail(`当天已记录${type.label}，后续不能记截至本次未开展；需保留已开展事实`, 409)
    for (const key of ['filling', 'unloading', 'receiving', 'reports']) if (old.activities?.[key] === 'yes' && next.activities?.[key] === 'no') P.fail('当天已记录相关作业或报告，不能在后续巡检中改为截至本次未发生', 409)
  }
  if (!previous) return
  // Same-observation edits are revisions, but events and findings cannot disappear silently.
  for (const row of previous.special_work || []) for (const event of row.events || []) if (!(next.special_work.find(item => item.type === row.type)?.events || []).some(item => item.id === event.id)) P.fail('已保存的特殊作业事件应保留，补充更正说明而非删除', 409)
  for (const [oldRows, newRows, key] of [[previous.certificate_checks || [], next.certificate_checks, 'id'], [previous.facilities || [], next.facilities, 'code'], [(previous.special_work || []).flatMap(row => row.events || []), next.special_work.flatMap(row => row.events || []), 'id']]) for (const row of oldRows) if (row.result_code === 'abnormal' && newRows.find(item => item[key] === row[key])?.result_code !== 'abnormal') P.fail('已发现的资料、设施或作业问题应保留并关联整改，不能删除或改为正常', 409)
  for (const row of previous.checks || []) if (row.result_code === 'abnormal' && next.checks.find(item => item.code === row.code)?.result_code !== 'abnormal') P.fail('已发现的问题应保留并关联整改记录，不能改成正常', 409)
}
module.exports = { SPECIAL_WORK_TYPES, FACILITY_TYPES, DETAIL_FIELDS, FIELD_LABELS, definitions, normalizeWorkflow, emptyWorkflow, allHazardIds, pendingHazards, derivedCoverage, deriveWorkflow, preventErasure }
