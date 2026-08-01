'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const exportRoot = path.join(repoRoot, 'uniCloud-alipay/cloudfunctions/crm-station-safety-export')
const policy = require(path.join(exportRoot, 'exportPolicy'))
const builder = require(path.join(exportRoot, 'workbookBuilder'))
const registry = require('../uniCloud-alipay/cloudfunctions/common/pageAclRegistry')
const acl = require('../uniCloud-alipay/cloudfunctions/common/pageAcl')

test('日期、巡检结果和隐患状态筛选规范化', () => {
	const resolved = policy.resolveFilters({
		scope: 'range',
		start_date: '2026-07-01',
		end_date: '2026-07-31',
		inspection_result: 'abnormal',
		hazard_status: 'pending_verification'
	})
	assert.equal(resolved.ok, true)
	assert.equal(resolved.data.start_at, Date.parse('2026-07-01T00:00:00+08:00'))
	assert.equal(resolved.data.end_at_exclusive, Date.parse('2026-08-01T00:00:00+08:00'))
	assert.equal(policy.resolveFilters({ scope: 'range', start_date: '2026-02-30', end_date: '2026-03-01' }).ok, false)
	assert.equal(policy.resolveFilters({ scope: 'all', hazard_status: 'bad' }).ok, false)
})

test('厂站导出限制为50单和2000个媒体文件', () => {
	assert.equal(policy.exportLimitMessage(50, 2000), '')
	assert.match(policy.exportLimitMessage(51, 1), /50 张巡检单/)
	assert.match(policy.exportLimitMessage(1, 2001), /2000 个媒体文件/)
	const inspection = { items: [{ photo_file_ids: ['cloud://a', 'cloud://a', 'bad'], responsible_signature_file_id: 'cloud://sign' }] }
	const hazard = { inspection_photo_file_ids: ['cloud://a'], rectification_photo_file_ids: ['cloud://b'], verification_photo_file_ids: ['cloud://c'] }
	assert.deepEqual(policy.collectInspectionMediaFileIds(inspection).sort(), ['cloud://a', 'cloud://sign'])
	assert.deepEqual(policy.collectHazardMediaFileIds(hazard).sort(), ['cloud://a', 'cloud://b', 'cloud://c'])
	assert.match(policy.buildExportFileName({ scope: 'range', start_date: '2026-07-01', end_date: '2026-07-31' }, 2), /\.xlsx$/)
})

test('厂站导出权限可独立授予安全巡检员', () => {
	const exportPath = '/pages/station-safety-inspection/export'
	const base = registry.buildRoleTemplatePermissions('safety_inspector')
	assert.equal(base[exportPath].view, false)
	const resolved = acl.normalizePagePermissions({ [exportPath]: { view: true }, '/pages/sale/list': { view: true } }, 'safety_inspector')
	assert.equal(resolved[exportPath].view, true)
	assert.equal(resolved['/pages/sale/list'].view, false)
})

test('工作簿包含巡检明细和沿用前12列的隐患整改台账', async () => {
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
	const inspection = {
		station_name_snapshot: '无极县新拓能源开发有限公司',
		inspection_no: 'CZ20260801-001',
		inspection_at: Date.parse('2026-08-01T08:30:00+08:00'),
		inspector_name: '巡检员甲',
		items: [{ area_label_snapshot: '储罐区', item_label_snapshot: '阀门位置、操作及泄漏', result_code: 'abnormal', is_abnormal: true, issue_note: '阀门渗漏', hazard_level: 'general', responsible_name: '责任人甲', planned_complete_date: '2026-08-03', photo_file_ids: ['cloud://现场1'] }]
	}
	const hazard = {
		inspection_no: inspection.inspection_no,
		area_label_snapshot: '储罐区',
		item_label_snapshot: '阀门位置、操作及泄漏',
		hazard_category: '厂站设施',
		issue_note: '阀门渗漏',
		hazard_level: 'general',
		inspection_date: '2026-08-01',
		responsible_name: '责任人甲',
		planned_measure: '更换密封件',
		planned_complete_date: '2026-08-03',
		status: 'closed',
		rectification_note: '已更换密封件',
		rectified_at: Date.parse('2026-08-02T09:00:00+08:00'),
		verified_by_name: '超级管理员',
		verification_note: '复查通过',
		inspection_photo_file_ids: ['cloud://现场1'],
		rectification_photo_file_ids: ['cloud://整改1'],
		verification_photo_file_ids: ['cloud://验证1']
	}
	const mediaByFileId = Object.fromEntries(['cloud://现场1', 'cloud://整改1', 'cloud://验证1'].map((id) => [id, { buffer: png, extension: 'png' }]))
	const result = await builder.buildStationSafetyWorkbookBuffer({ inspections: [inspection], hazards: [hazard], mediaByFileId })
	const ExcelJS = require(path.join(exportRoot, 'node_modules/exceljs'))
	const workbook = new ExcelJS.Workbook()
	await workbook.xlsx.load(result.buffer)
	assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['巡检明细', '隐患整改台账'])
	const expectedFirst12 = ['序号', '隐患类别', '隐患具体描述', '隐患等级', '排查发现日期', '整改责任人', '整改措施', '计划完成时间', '整改状态', '整改完成时间', '验证人', '备注']
	assert.deepEqual(workbook.getWorksheet('隐患整改台账').getRow(1).values.slice(1, 13), expectedFirst12)
	assert.equal(workbook.getWorksheet('巡检明细').getCell('G2').value, '异常')
	assert.ok(workbook.media.length >= 4)
})

test('厂站集合均禁用客户端直连且导出任务有24小时失效字段', () => {
	for (const name of ['crm_station_safety_inspections', 'crm_station_safety_hazards', 'crm_station_safety_no_counters', 'crm_station_safety_export_jobs']) {
		const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, `uniCloud-alipay/database/${name}.schema.json`), 'utf8'))
		assert.deepEqual(schema.permission, { read: false, create: false, update: false, delete: false })
	}
	assert.equal(policy.EXPORT_RETENTION_MS, 24 * 60 * 60 * 1000)
})
