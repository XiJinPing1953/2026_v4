'use strict'
const ExcelJS = require('exceljs')
const LABELS = { normal: '已检查正常', abnormal: '发现问题', not_conducted: '截至核查时未开展', pending: '待核实', not_running: '未运行', not_applicable: '不适用', pending_rectification: '待整改', pending_verification: '待复查', closed: '已复查销号', cancelled: '已撤销（保留记录）', general: '一般', elevated: '较大', major: '重大' }
const CONTENT_LABELS = { actual_date: '实际日期', started_at: '实际开始时间', ended_at: '实际结束时间', organizer: '组织人', participants: '参与人员', scope: '排查范围', site_findings: '现场排查结果', execution_evaluation: '执行质量评价', repeated_problem_analysis: '反复问题分析', system_gaps: '制度漏洞', next_plan: '下周计划', title: '会议名称', location: '地点', host: '主持人', recorder: '记录人', absences: '缺席人员及原因', previous_decisions: '上月决议落实', accidents_and_near_misses: '事故及涉险情况', safety_situation: '安全形势', major_risks: '重大风险和隐患', special_work: '专项工作', training: '培训', expenditure: '费用及投入', emergency_management: '应急管理', contractors: '外协管理', causes: '问题原因', principal_summary: '主要负责人总结' }
function text(value) { if (value == null) return ''; return typeof value === 'object' ? JSON.stringify(value) : String(value) }
function time(value) { if (!value) return ''; if (!/^\d{13}$/.test(String(value))) return text(value); return new Date(Number(value) + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19) }
function categoryProgress(category) {
  const checks = category.checks || [], originals = checks.filter(check => check.source_type === 'station_inspection'), coverage = category.coverage
  const items = coverage?.inspection_item_count ?? new Set(originals.map(check => check.item_code)).size
  const records = coverage?.inspection_record_count ?? originals.length
  const groups = coverage?.supplement_group_count ?? new Set(checks.filter(check => check.source_type !== 'station_inspection').map(check => check.item_code)).size
  const counts = coverage?.result_counts || checks.reduce((result, check) => { if (!check.covered_by_inspection) { const code = check.result_code || 'pending'; result[code] = (result[code] || 0) + 1 } return result }, {})
  const pending = coverage?.pending || checks.filter(check => !check.result_code || check.result_code === 'pending').map(check => ({ label: check.label }))
  return `原巡检 ${items} 项（${records} 条记录）；补充范围 ${groups} 组，其中 ${coverage?.covered_group_count || 0} 组已引用原巡检。\n结果按记录条次列示：${Object.entries(counts).filter(([, count]) => count > 0).map(([code, count]) => `${LABELS[code] || '待核实'} ${count} 条`).join('；')}。\n待核对 ${pending.length} 项${pending.length ? '：' + pending.flatMap(item => item.messages?.length ? item.messages : [item.label]).join('；') : ''}`
}
function sheet(workbook, name, headers, widths) { const value = workbook.addWorksheet(name, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } }); value.columns = headers.map((header, index) => ({ header, width: widths?.[index] || 24 })); value.views = [{ state: 'frozen', ySplit: 1 }]; value.pageSetup.printTitlesRow = '1:1'; value.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF245E54' } } }); return value }
function splitForCell(value, width, maxLines = 16) {
  const source = text(value); const capacity = Math.max(4, Math.floor(Number(width || 24) - 3)); const chunks = []; let content = ''; let lineWidth = 0; let lines = 1
  for (const character of source) {
    const charWidth = character === '\n' ? 0 : /[^\x00-\xff]/.test(character) ? 2 : 1
    const wraps = character === '\n' || lineWidth + charWidth > capacity
    if (wraps && lines === maxLines) { chunks.push({ text: content, lines }); content = ''; lines = 1; lineWidth = 0 }
    else if (wraps) { lines++; lineWidth = 0 }
    content += character
    if (character !== '\n') lineWidth += charWidth
  }
  chunks.push({ text: content, lines }); return chunks
}
function row(sheet, values) {
  const chunks = values.map((value, index) => splitForCell(value, sheet.columns[index]?.width))
  const count = Math.max(...chunks.map(parts => parts.length)); const rows = []
  for (let index = 0; index < count; index++) {
    const cells = chunks.map(parts => parts[index]?.text || '')
    if (index > 0 && !cells[0]) cells[0] = `${text(values[0]).slice(0, 80)}（续）`
    const added = sheet.addRow(cells); rows.push(added)
    added.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; cell.border = { bottom: { style: 'hair', color: { argb: 'FFD8E2DF' } } } })
    const lines = Math.max(...chunks.map(parts => parts[index]?.lines || 1)); added.height = Math.max(28, lines * 16 + 14)
  }
  return rows
}
function collectEvidence(document) { const map = new Map(); function walk(value, path) { if (typeof value === 'string' && value.startsWith('cloud://')) { if (!map.has(value)) map.set(value, []); map.get(value).push(path) } else if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${path}[${index + 1}]`)); else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) { if (key === 'responsible_signature_file_id') continue; walk(entry, `${path}.${key}`) } } walk(document, '台账'); return [...map].map(([file_id, sources]) => ({ file_id, sources })) }
async function createWorkbook(payload, { cloud } = {}) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = '新拓能源安全管理'; workbook.created = new Date(payload.generated_at)
  const main = sheet(workbook, '主表', ['栏目', '内容'], [30, 100]); row(main, ['台账类型', ({ daily: '每日安全生产检查记录表', weekly: '每周安全生产排查报告', monthly: '每月安全生产调度会议纪要' })[payload.kind]]); row(main, ['状态', payload.status]); row(main, ['签认说明', '待签认：内容核对不代表巡查人、安全总监或主要负责人签字或审阅']); row(main, ['导出时间（北京时间）', time(payload.generated_at)])
  const doc = payload.document; const hazards = new Map()
  if (payload.kind === 'daily') {
    const snapshot = doc.snapshot
    row(main, ['厂站', snapshot.station_name]); row(main, ['日期', snapshot.date]); row(main, ['日表修订', doc.record?.revision || '尚未核对']); row(main, ['零报告', doc.record?.zero_report && !doc.stale ? '已确认零报告（待签认）' : '未确认零报告']); row(main, ['待完成内容', snapshot.missing.join('；')]);
    for (const inspection of snapshot.inspections) row(main, ['巡查人员、天气、实际时段', `${inspection.inspector_name}；${inspection.weather || '未填写'}；${time(inspection.started_at)} ～ ${time(inspection.ended_at)}；原单 ${inspection.inspection_no}`])
    for (const category of snapshot.categories) { const issues = category.issues || []; row(main, [`${category.id}．${category.name}`, `${categoryProgress(category)}\n当天登记问题 ${issues.length} 项。${issues.map(item => `${item.hazard_no}：${item.issue_note}（${LABELS[item.status] || item.status}）`).join('；') || '本类未记录问题，实际完成情况见逐项明细。'} 同日整改或后次正常不删除早前问题。`]) }
    const checks = sheet(workbook, '逐项检查', ['类别', '区域', '内容及标准', '结果', '问题或原因', '来源', '版本', '关联隐患', '证据编号或链接', '作业核对详情'], [18, 20, 60, 18, 60, 32, 12, 36, 65, 65])
    for (const category of snapshot.categories) for (const item of category.checks) row(checks, [`${category.id}．${category.name}`, item.area, item.standard || item.label, item.missing?.length ? '待完成（已填情况见明细）' : item.covered_by_inspection ? `已引用原巡检：${LABELS[item.result_code] || '待核实'}` : LABELS[item.result_code] || '待检查', [item.note, item.reason, ...(item.missing || [])].filter(Boolean).join('；'), `${item.source_type}:${item.source_id}:${item.item_code}`, item.source_revision, (item.hazard_ids || []).join('\n'), (item.evidence || []).map(ref => `${ref.label || ''} ${ref.value}`).join('\n'), [item.observed_at ? `核查截至：${time(item.observed_at)}` : '', item.detail_text || Object.entries(item.details || {}).filter(([, value]) => value).map(([key, value]) => `${({ types: '作业类型', location: '地点', approval: '审批', monitor: '监护', measures: '安全措施' })[key] || key}：${value}`).join('\n')].filter(Boolean).join('\n')])
    const visits = sheet(workbook, '实际巡查时段', ['巡检编号', '人员', '天气', '实际开始', '实际结束', '系统提交', '来源修订', '原始记录编号'], [30, 18, 18, 26, 26, 26, 15, 50]); for (const inspection of snapshot.inspections) row(visits, [inspection.inspection_no, inspection.inspector_name, inspection.weather || '未记录', time(inspection.started_at), time(inspection.ended_at), time(inspection.submitted_at || inspection.created_at), inspection.revision || 1, inspection._id])
    for (const hazard of [...snapshot.issues, ...snapshot.historical_pending]) hazards.set(hazard._id, hazard)
  } else {
    const record = doc.record
    row(main, ['统计周期', `${doc.period.start_date} ～ ${doc.period.end_date}`]); row(main, ['台账修订', record?.revision || '尚未保存']);
    for (const [key, label] of Object.entries(CONTENT_LABELS)) if (Object.hasOwn(record?.content || {}, key)) row(main, [label, key.endsWith('_at') ? time(record.content[key]) : record.content[key]])
    const stats = doc.statistics; row(main, ['统计截至日期', stats.as_of_date || doc.period.end_date]); row(main, ['应巡检/实际巡检/日表已核对天数', `${stats.expected_days} / ${stats.inspected_days} / ${stats.checked_days}`]); row(main, ['本期新隐患/已复查销号', `${stats.new_hazard_count} / ${stats.verified_closed_count}`]); row(main, ['整改完成率', stats.rectification_rate_label]); row(main, ['复见/复发/历史待办', `${stats.reobservations.length} / ${stats.recurrence.length} / ${stats.historical_pending.length}`])
    const daily = sheet(workbook, '每日来源', ['日期', '状态', '巡检次数', '问题数', '日表版本', '原日表编号'], [18, 28, 15, 15, 15, 50]); for (const day of stats.daily) row(daily, [day.date, day.status, day.inspection_count, day.issue_count, day.revision, day.record_id])
    for (const hazard of [...stats.new_hazards, ...stats.historical_pending, ...stats.recurrence, ...(stats.reobserved_hazards || []), ...(stats.historical_progress || [])]) hazards.set(hazard._id, hazard)
    if (payload.kind === 'weekly') { const issues = sheet(workbook, '管理问题', ['类型', '问题', '问题风险等级', '责任人', '措施', '期限'], [18, 60, 20, 18, 60, 18]); for (const item of record?.content?.management_issues || []) row(issues, [item.type, item.description, LABELS[item.risk_level], item.responsible_name, item.measure, item.due_date]) }
    else { const weeks = sheet(workbook, '周报告来源', ['统计周期', '实际排查日', '组织人', '修订', '内容状态', '报告编号'], [34, 20, 24, 14, 24, 55]); for (const week of stats.weekly_reports || []) row(weeks, [`${week.period.start_date} ～ ${week.period.end_date}`, week.content?.actual_date || '', week.content?.organizer || '', week.revision, week.content_status, week._id]); const decisions = sheet(workbook, '会议决议', ['事项', '责任部门', '责任人', '期限', '状态', '落实情况'], [60, 20, 18, 18, 18, 60]); for (const item of record?.content?.decisions || []) row(decisions, [item.subject, item.department, item.responsible_name, item.due_date, item.status, item.implementation]); const previous = sheet(workbook, '上月决议来源', ['事项', '责任部门', '责任人', '期限', '状态', '落实情况'], [60, 20, 18, 18, 18, 60]); for (const item of doc.previous?.content?.decisions || []) row(previous, [item.subject, item.department, item.responsible_name, item.due_date, item.status, item.implementation]) }
  }
  const issueSheet = sheet(workbook, '隐患与整改', ['编号', '首次发现日', '问题', '隐患等级', '责任人', '整改要求', '期限', '状态', '上报时间/对象/方式', '当场整改事实', '后续整改', '复查销号', '复发关联'], [28, 18, 60, 14, 18, 60, 18, 18, 55, 65, 65, 65, 30])
  for (const hazard of hazards.values()) row(issueSheet, [hazard.hazard_no, hazard.first_discovered_date || hazard.inspection_date, hazard.issue_note, LABELS[hazard.hazard_level], hazard.responsible_name, hazard.planned_measure, hazard.planned_complete_date, LABELS[hazard.status] || hazard.status, hazard.report ? `${time(hazard.report.reported_at)}；${hazard.report.reported_to}；${hazard.report.method}；${hazard.report.requirements || ''}` : '未记录实际上报', hazard.on_site_rectification ? `${hazard.on_site_rectification.note}；${time(hazard.on_site_rectification.completed_at)}；复查 ${time(hazard.on_site_rectification.rechecked_at)} ${hazard.on_site_rectification.recheck_note || ''}` : '未记录当场整改', `${hazard.rectification_note || ''} ${time(hazard.rectified_at)}`, `${hazard.verification_note || ''} ${time(hazard.verified_at)}`, hazard.recurrence_of || ''])
  const observations = sheet(workbook, '观察记录', ['隐患编号', '观察时间', '来源', '问题', '主分类', '临时措施', '证据', '本次实际上报', '本次当场整改和复查'], [28, 24, 50, 60, 16, 60, 65, 65, 65])
  for (const hazard of hazards.values()) for (const obs of hazard.observations || []) row(observations, [hazard.hazard_no, time(obs.observed_at), `${obs.source_type}:${obs.source_id}:${obs.item_code}:${Number(obs.source_revision) > 0 ? `v${obs.source_revision}` : '未绑定来源版本'}`, obs.issue_note, obs.category_code, obs.temporary_controls || '', [...(obs.photo_file_ids || []), ...(obs.evidence || []).map(ref => `${ref.label || ''} ${ref.value}`)].join('\n'), obs.report ? `${time(obs.report.reported_at)}；对象 ${obs.report.reported_to}；方式 ${obs.report.method}；要求 ${obs.report.requirements || ''}；临时措施 ${obs.report.temporary_measure || ''}` : '未记录实际上报', obs.on_site_rectification ? `${obs.on_site_rectification.note}；完成 ${time(obs.on_site_rectification.completed_at)}；复查 ${time(obs.on_site_rectification.rechecked_at)} ${obs.on_site_rectification.recheck_note || ''}；证据 ${(obs.on_site_rectification.photo_file_ids || []).join('；')}` : '未记录当场整改'])

  const evidence = sheet(workbook, '照片及附件证据', ['证据编号', '来源位置', '照片或附件状态'], [75, 75, 35]); const references = collectEvidence(doc)
  for (const ref of references) {
    const added = row(evidence, [ref.file_id, ref.sources.join('\n'), cloud ? '读取中' : '保留原始文件引用'])[0]
    if (!cloud) continue
    const downloaded = await cloud.downloadFile({ fileID: ref.file_id }); const buffer = downloaded.fileContent
    if (!buffer) throw new Error(`证据读取失败，未生成缺失证据的导出：${ref.file_id}`)
    const bytes = Buffer.from(buffer); const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); const jpeg = bytes[0] === 255 && bytes[1] === 216
    if (png || jpeg) { const sharp = require('sharp'); const reduced = await sharp(bytes).rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); const metadata = await sharp(reduced).metadata(); const scale = Math.min(220 / metadata.width, 170 / metadata.height); const imageId = workbook.addImage({ buffer: reduced, extension: 'jpeg' }); evidence.addImage(imageId, { tl: { col: 2, row: added.number - 1 }, ext: { width: metadata.width * scale, height: metadata.height * scale } }); added.height = Math.max(added.height || 0, 135); added.getCell(3).value = '' }
    else { added.getCell(3).value = '附件：保留原始文件编号，请通过系统打开'; added.height = 60 }
  }
  for (const value of workbook.worksheets) { value.headerFooter.oddFooter = '待签认 | &P / &N'; value.eachRow(r => r.eachCell(cell => { cell.font = { ...(cell.font || {}), name: 'Microsoft YaHei', size: 10 }; cell.alignment = { vertical: 'top', wrapText: true } })) }
  return workbook
}
module.exports = { createWorkbook, collectEvidence, splitForCell }
