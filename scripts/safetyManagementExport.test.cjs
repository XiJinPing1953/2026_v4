'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const cloudRequire = createRequire(path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions/crm-safety-management/package.json'))
const ExcelJS = cloudRequire('exceljs')
const sharp = cloudRequire('sharp')
const P = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/policy')
const { createWorkbook, collectEvidence, splitForCell } = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/workbook')
const { inspection, supplementItems } = require('./safetyManagementTestHarness.cjs')
function payload() {
  const source = inspection('2026-10-15')
  source.items[0].photo_file_ids = ['cloud://proof/1.png', 'cloud://proof/2.png', 'cloud://proof/3.png']
  source.items[1].photo_file_ids = ['cloud://proof/4.png', 'cloud://proof/5.png']
  const longNote = Array.from({ length: 220 }, (_, index) => `第${index + 1}处现场异常需要完整保存。\n`).join('')
  const hazard = { _id: 'hazard', hazard_no: 'AQ-长内容', inspection_id: source._id, item_code: source.items[0].item_code, category_code: '2', inspection_date: '2026-10-15', issue_note: longNote, hazard_level: 'general', responsible_name: '责任人', planned_measure: '排除异常', planned_complete_date: '2026-10-15', status: 'closed', verification_result: 'passed', verified_at: source.ended_at, inspection_photo_file_ids: source.items[0].photo_file_ids, observations: [] }
  const snapshot = P.buildDailySnapshot({ date: '2026-10-15', inspections: [source], hazards: [hazard], supplement: { items: P.mergeSupplement([], supplementItems()) }, config: {} })
  return { kind: 'daily', document: { snapshot, record: null }, generated_at: Date.now(), status: '内容未完成 · 待签认', longNote }
}

test('Excel long Chinese and explicit line breaks split by actual column width without truncation', async () => {
  const value = '第一行中文\n'.repeat(2000)
  for (const width of [12, 30, 60, 100]) { const chunks = splitForCell(value, width); assert.equal(chunks.map(chunk => chunk.text).join(''), value); assert.ok(chunks.every(chunk => chunk.lines <= 16)) }
  const input = payload(); const workbook = await createWorkbook(input)
  const issueSheet = workbook.getWorksheet('隐患与整改'); const saved = issueSheet.getColumn(3).values.slice(2).filter(Boolean).join(''); assert.equal(saved, input.longNote)
  workbook.eachSheet(sheet => sheet.eachRow(row => assert.ok(!row.height || row.height <= 400, `row ${row.number} clipped`)))
  const bytes = await workbook.xlsx.writeBuffer(); const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(bytes)
  assert.equal(loaded.getWorksheet('隐患与整改').getColumn(3).values.slice(2).filter(Boolean).join(''), input.longNote)
  const main = loaded.getWorksheet('主表').getColumn(2).values.join(''); assert.ok(main.includes('当天登记问题 1 项')); assert.ok(main.includes('已复查销号')); assert.ok(main.includes('待签认'))
})

test('every unique photo is retained and embedded without distortion; signatures are not substituted', async () => {
  const input = payload(); input.document.snapshot.inspections[0].items[0].responsible_signature_file_id = 'cloud://existing/responsible-signature.png'
  const refs = collectEvidence(input.document); assert.equal(refs.length, 5); assert.ok(refs.every(ref => !ref.file_id.includes('signature')))
  const photo = await sharp({ create: { width: 640, height: 320, channels: 3, background: '#368575' } }).png().toBuffer()
  const requested = []; const workbook = await createWorkbook(input, { cloud: { downloadFile: async ({ fileID }) => { requested.push(fileID); return { fileContent: photo } } } })
  assert.equal(new Set(requested).size, 5); const images = workbook.getWorksheet('照片及附件证据').getImages(); assert.equal(images.length, 5)
  for (const image of images) assert.equal(image.range.ext.width / image.range.ext.height, 2)
  const bytes = await workbook.xlsx.writeBuffer(); const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(bytes); assert.equal(loaded.getWorksheet('照片及附件证据').getImages().length, 5)
})

test('missing photo aborts export rather than silently producing incomplete evidence', async () => {
  await assert.rejects(createWorkbook(payload(), { cloud: { downloadFile: async () => ({}) } }), /证据读取失败/)
})

test('Excel retains special-work details and every repeat observation report, onsite fact and external reference', async () => {
  const daily = payload(); const special = daily.document.snapshot.categories[0].checks.find(item => item.item_code === 'S01'); special.details = { types: '动火', location: '检修区', approval: '动火票-001', monitor: '现场监护员', measures: '隔离并持续监测' }
  const book = await createWorkbook(daily); const details = book.getWorksheet('逐项检查').getColumn(10).values.join(''); for (const value of Object.values(special.details)) assert.ok(details.includes(value))
  const firstAt = P.atDate('2026-10-10') + 3600000
  const oldClosed = { _id: 'old_closed', hazard_no: 'AQ-上期首次', inspection_id: 'old_source', item_code: 'old_item', inspection_date: '2026-10-10', inspection_at: firstAt, issue_note: '上期隐患本期复见后销号', status: 'closed', verification_result: 'passed', verified_at: Date.now(), observations: [{ source_type: 'station_inspection', source_id: 'old_source', source_revision: 1, item_code: 'old_item', observed_at: firstAt }, ...[1, 2].map(index => ({ source_type: 'supplement', source_id: `new_source_${index}`, item_code: 'S02', observed_at: P.atDate('2026-10-15') + index * 3600000, issue_note: `第${index}次复见`, evidence: [{ type: 'record', value: `工单-${index}` }, { type: 'url', value: `https://example.test/report/${index}` }], report: { reported_at: P.atDate('2026-10-15'), reported_to: `上报对象-${index}`, method: '电话', requirements: `要求-${index}` }, on_site_rectification: { completed_at: P.atDate('2026-10-15'), note: `实际措施-${index}`, rechecked_at: P.atDate('2026-10-15'), recheck_note: `复查-${index}` } }))] }
  const period = P.periodForWeek('2026-10-15'); const statistics = P.aggregateStatistics({ period, config: { enabled_from: '2026-10-01' }, daily: [], hazards: [oldClosed] })
  assert.equal(statistics.new_hazards.length, 0); assert.equal(statistics.historical_pending.length, 0); assert.equal(statistics.reobserved_hazards.length, 1)
  const weekly = await createWorkbook({ kind: 'weekly', document: { period, record: { content: {} }, statistics }, generated_at: Date.now(), status: '待签认' })
  const observations = weekly.getWorksheet('观察记录'); const evidence = observations.getColumn(7).values.join(''); const reports = observations.getColumn(8).values.join(''); const onsite = observations.getColumn(9).values.join('')
  for (const index of [1, 2]) { assert.ok(reports.includes(`上报对象-${index}`)); assert.ok(onsite.includes(`实际措施-${index}`)); assert.ok(evidence.includes(`工单-${index}`)); assert.ok(evidence.includes(`https://example.test/report/${index}`)) }
})
