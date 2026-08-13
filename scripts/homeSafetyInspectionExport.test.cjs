'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const cloudRoot = path.join(
	repoRoot,
	'uniCloud-alipay/cloudfunctions/crm-home-safety-export'
)
const policy = require(path.join(cloudRoot, 'exportPolicy'))
const workbookBuilder = require(path.join(cloudRoot, 'workbookBuilder'))
const numberPolicy = require('../uniCloud-alipay/cloudfunctions/crm-home-safety-inspection/inspectionNumber')
const registry = require('../uniCloud-alipay/cloudfunctions/common/pageAclRegistry')
const acl = require('../uniCloud-alipay/cloudfunctions/common/pageAcl')

const EXPORT_PATH = '/pages/home-safety-inspection/export'

test('日期范围使用上海自然日并支持全部历史', () => {
	const range = policy.resolveDateRange({
		scope: 'range',
		start_date: '2026-07-01',
		end_date: '2026-07-31'
	})
	assert.equal(range.ok, true)
	assert.equal(range.data.start_at, Date.parse('2026-07-01T00:00:00+08:00'))
	assert.equal(range.data.end_at_exclusive, Date.parse('2026-08-01T00:00:00+08:00'))
	assert.equal(policy.resolveDateRange({ scope: 'range', start_date: '2026-02-30', end_date: '2026-03-01' }).ok, false)
	assert.equal(policy.resolveDateRange({ scope: 'range', start_date: '2026-08-01', end_date: '2026-07-31' }).ok, false)
	const all = policy.resolveDateRange({ scope: 'all' })
	assert.equal(all.ok, true)
	assert.equal(all.data.start_at, null)
})

test('文件名安全、单据编号按日期和当日序号生成', () => {
	assert.equal(numberPolicy.formatInspectionNumber('2026-07-31', 1), 'XJ20260731-001')
	assert.equal(numberPolicy.formatInspectionNumber('20260731', 1000), 'XJ20260731-1000')
	assert.deepEqual(numberPolicy.parseInspectionNumber('XJ20260731-042'), {
		dateKey: '20260731',
		sequence: 42
	})
	assert.equal(numberPolicy.parseInspectionNumber('bad'), null)
	assert.equal(
		policy.buildInspectionXlsxFileName({
			inspection_no: 'XJ20260731-001',
			customer_name_snapshot: '客户/A:*?',
			inspection_date: '2026-07-31'
		}),
		'XJ20260731-001_客户_A____2026-07-31.xlsx'
	)
	assert.equal(
		policy.buildExportZipFileName({ scope: 'range', start_date: '2026-07-01', end_date: '2026-07-31' }, 70),
		'入户随瓶安全巡检_2026-07-01至2026-07-31_70单.zip'
	)
})

test('导出限制按巡检单与现场照片分别计算', () => {
	assert.equal(policy.exportLimitMessage(200, 2400), '')
	assert.match(policy.exportLimitMessage(201, 10), /200 单/)
	assert.match(policy.exportLimitMessage(10, 2401), /2400 张/)
	const record = {
		items: [
			{ photo_file_ids: ['cloud://a', 'cloud://b'] },
			{ photo_file_ids: ['cloud://c'] }
		],
		customer_signature_file_id: 'cloud://customer-signature',
		inspector_signature_file_id: 'cloud://inspector-signature'
	}
	assert.equal(policy.collectInspectionPhotoFileIds(record).length, 3)
	assert.equal(policy.collectInspectionMediaFileIds(record).length, 3)
})

test('巡检员只能额外获得独立导出权限', () => {
	const base = registry.buildRoleTemplatePermissions('safety_inspector')
	assert.equal(base[EXPORT_PATH].view, false)
	const resolved = acl.normalizePagePermissions(
		{
			[EXPORT_PATH]: { view: true },
			'/pages/sale/list': { view: true, create: true, update: true, delete: true },
			'/pages/home-safety-inspection/form': { view: false, create: false, update: true }
		},
		'safety_inspector'
	)
	assert.equal(resolved[EXPORT_PATH].view, true)
	assert.equal(resolved['/pages/sale/list'].view, false)
	assert.equal(resolved['/pages/home-safety-inspection/form'].view, true)
	assert.equal(resolved['/pages/home-safety-inspection/form'].create, true)
	assert.equal(resolved['/pages/home-safety-inspection/form'].update, false)
})

test('巡检 Excel 包含检查项旁照片和异常标色，但不包含双方签名', async () => {
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64'
	)
	const items = Array.from({ length: 8 }, (_, index) => ({
		item_code: `item_${index + 1}`,
		item_label_snapshot: `检查项目 ${index + 1}`,
		answers: [{
			check_code: 'check',
			check_label_snapshot: '检查内容',
			option_code: index === 1 ? 'abnormal' : 'normal',
			option_label_snapshot: index === 1 ? '异常' : '正常',
			is_abnormal: index === 1
		}],
		is_abnormal: index === 1,
		issue_note: index === 1 ? '现场发现异常' : '',
		photo_file_ids: [`cloud://photo-${index + 1}`]
	}))
	const inspection = {
		inspection_no: 'XJ20260731-001',
		inspection_at: Date.parse('2026-07-31T08:30:00+08:00'),
		inspection_date: '2026-07-31',
		customer_name_snapshot: '测试客户',
		customer_address_snapshot: '无极县测试地址',
		location_text: '无极县测试村测试街道',
		location_capture: { status: 'ok', latitude: 38.125794, longitude: 114.908076, accuracy: 12 },
		overall_result: 'abnormal',
		items,
		customer_signer_name: '客户代表',
		customer_signature_file_id: 'cloud://customer-signature',
		customer_signed_at: Date.now(),
		inspector_name: '巡检员甲',
		inspector_username_snapshot: 'inspector_a',
		inspector_signature_file_id: 'cloud://inspector-signature',
		inspector_signed_at: Date.now(),
		template_code: 'home_safety_standard',
		template_version: 1,
		revision_no: 1,
		last_edited_at: Date.now(),
		last_edited_by_name: 'superadmin',
		last_edit_reason: '修正现场说明'
	}
	const mediaByFileId = {}
	for (const fileId of policy.collectInspectionMediaFileIds(inspection)) {
		mediaByFileId[fileId] = { buffer: png, extension: 'png' }
	}
	const result = await workbookBuilder.buildInspectionWorkbookBuffer({ inspection, mediaByFileId })
	assert.equal(result.buffer.subarray(0, 2).toString(), 'PK')
	assert.equal(result.missingFileCount, 0)
	const ExcelJS = require(path.join(cloudRoot, 'node_modules/exceljs'))
	const workbook = new ExcelJS.Workbook()
	await workbook.xlsx.load(result.buffer)
	const worksheet = workbook.getWorksheet('安全检查表')
	assert.equal(worksheet.getCell('A1').value, '无极县新拓能源开发有限公司')
	assert.match(String(worksheet.getCell('A3').value), /XJ20260731-001/)
	assert.equal(worksheet.getImages().length, 8)
	assert.equal(worksheet.getCell(10, 4).value, '不合格')
	assert.equal(worksheet.getCell(10, 4).fill.fgColor.argb, 'FFFFD9D9')
	const exportedText = []
	worksheet.eachRow((row) => row.eachCell((cell) => exportedText.push(String(cell.value || ''))))
	assert.doesNotMatch(exportedText.join('\n'), /签名|签署时间/)
})

test('导出集合禁止客户端直连并具备幂等与任务索引', () => {
	for (const filename of [
		'crm_home_safety_export_jobs.schema.json',
		'crm_home_safety_export_items.schema.json',
		'crm_home_safety_no_counters.schema.json'
	]) {
		const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'uniCloud-alipay/database', filename), 'utf8'))
		assert.deepEqual(schema.permission, { read: false, create: false, update: false, delete: false })
	}
	const jobsSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'uniCloud-alipay/database/crm_home_safety_export_jobs.schema.json'), 'utf8'))
	assert.ok(jobsSchema.indexes.some((index) => index.unique && index.key?.created_by === 1 && index.key?.client_request_id === 1))
	const inspectionsSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'uniCloud-alipay/database/crm_home_safety_inspections.schema.json'), 'utf8'))
	assert.ok(inspectionsSchema.indexes.some((index) => index.unique && index.key?.inspection_no === 1))
})
