'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	STATION,
	TEMPLATE,
	getTemplate,
	templateItems,
	normalizeInspectionItems,
	normalizeEditablePayload
} = require('../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/inspectionPolicy')
const {
	normalizeRectificationPayload,
	normalizeVerificationPayload,
	buildHazardSnapshot,
	isHazardOverdue,
	resolveHazardSyncTransition
} = require('../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/hazardPolicy')
const { formatInspectionNumber } = require('../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/inspectionNumber')

function photo(name) {
	return `cloud://test-space/station-safety/${name}.jpg`
}

function completeItems() {
	return templateItems(TEMPLATE).map(({ item }) => ({
		item_code: item.code,
		result_code: 'normal',
		photo_file_ids: [photo(item.code)]
	}))
}

test('厂站巡检当前模板固定为四组 36 项并保留历史版本', () => {
	assert.equal(STATION.id, 'XTNY-001')
	assert.equal(STATION.name, '无极县新拓能源开发有限公司')
	assert.equal(TEMPLATE.version, 2)
	assert.deepEqual(TEMPLATE.areas.map((area) => area.items.length), [10, 9, 10, 7])
	assert.deepEqual(TEMPLATE.areas.map((area) => area.code), ['tank_area', 'pump_area', 'filling_area', 'public_area'])
	assert.deepEqual(TEMPLATE.areas.map((area) => area.items.map((entry) => entry.code)), [
		['tank_static_eliminator', 'tank_valves', 'tank_safety_valve', 'tank_bolts', 'tank_alarm', 'tank_signage', 'tank_instruments', 'tank_grounding', 'tank_housekeeping', 'tank_insulation_leak'],
		['pump_static_eliminator', 'pump_bolts', 'pump_explosion_conduit', 'pump_grounding', 'pump_valves', 'pump_safety_valve', 'pump_signage', 'pump_pipeline_pressure', 'pump_appearance_leak'],
		['filling_static_eliminator', 'filling_explosion_emergency_light', 'filling_hanging_scale', 'filling_tools', 'filling_explosion_protection', 'filling_scale_shell', 'filling_alarm', 'filling_signage', 'filling_housekeeping', 'filling_extinguisher'],
		['public_emergency_supplies', 'public_control_room_electrical', 'public_cylinder_zoning', 'public_entry_management', 'public_cylinder_transport', 'public_fire_records', 'public_lightning_static_report']
	])
	assert.equal(templateItems(TEMPLATE).length, 36)
	assert.equal(new Set(templateItems(TEMPLATE).map(({ item }) => item.code)).size, 36)
	assert.equal(templateItems(TEMPLATE).find(({ item }) => item.code === 'tank_instruments').item.label, '液位计、压力表是否正常')
	assert.equal(templateItems(TEMPLATE).find(({ item }) => item.code === 'filling_explosion_emergency_light').item.label, '防爆应急灯')
	assert.equal(templateItems(getTemplate(TEMPLATE.code, 1)).length, 37)
	assert.equal(templateItems(TEMPLATE).find(({ item }) => item.code === 'tank_valves').item.hazard_category, '厂站设施')
	assert.equal(templateItems(TEMPLATE).find(({ item }) => item.code === 'public_entry_management').item.hazard_category, '安全管理')
})

test('完整正常巡检保存区域和项目快照', () => {
	const result = normalizeEditablePayload({
		template_code: TEMPLATE.code,
		template_version: TEMPLATE.version,
		items: completeItems(),
		inspector_name: '巡检员甲'
	})
	assert.equal(result.ok, true)
	assert.equal(result.data.items.length, 36)
	assert.equal(result.data.overall_result, 'normal')
	assert.equal(result.data.items[0].area_label_snapshot, '储罐区')
	assert.equal(result.data.items[35].area_label_snapshot, '全厂公共项')
})

test('每个检查项都必须选结果并上传 1–3 张照片', () => {
	const missingResult = completeItems()
	missingResult[0].result_code = ''
	assert.match(normalizeInspectionItems(missingResult).msg, /正常或异常/)

	const missingPhoto = completeItems()
	missingPhoto[0].photo_file_ids = []
	assert.match(normalizeInspectionItems(missingPhoto).msg, /至少上传 1 张/)

	const tooMany = completeItems()
	tooMany[0].photo_file_ids = [photo('1'), photo('2'), photo('3'), photo('4')]
	assert.match(normalizeInspectionItems(tooMany).msg, /最多上传 3 张/)

	const duplicateAcrossItems = completeItems()
	duplicateAcrossItems[1].photo_file_ids = duplicateAcrossItems[0].photo_file_ids.slice()
	assert.match(normalizeInspectionItems(duplicateAcrossItems).msg, /不能在多个检查项中重复/)
})

test('异常项强制隐患等级、责任人、措施、日期和签名', () => {
	const requiredCases = [
		['issue_note', '', /隐患描述/],
		['hazard_level', '', /隐患等级/],
		['responsible_name', '', /整改责任人/],
		['planned_measure', '', /计划整改措施/],
		['planned_complete_date', '', /计划完成日期/],
		['responsible_signature_file_id', '', /手写签名/]
	]
	for (const [field, value, pattern] of requiredCases) {
		const items = completeItems()
		items[0] = {
			...items[0],
			result_code: 'abnormal',
			issue_note: '阀门有轻微泄漏',
			hazard_level: 'general',
			responsible_name: '责任人甲',
			planned_measure: '更换密封件',
			planned_complete_date: '2026-08-05',
			responsible_signature_file_id: photo('signature'),
			[field]: value
		}
		const result = normalizeInspectionItems(items)
		assert.equal(result.ok, false)
		assert.match(result.msg, pattern)
	}
})

test('任一异常项会把整单判为异常', () => {
	const items = completeItems()
	items[5] = {
		...items[5],
		result_code: 'abnormal',
		issue_note: '标牌缺失',
		hazard_level: 'general',
		responsible_name: '责任人乙',
		planned_measure: '补齐标牌',
		planned_complete_date: '2026-08-05',
		responsible_signature_file_id: photo('signature-2')
	}
	const result = normalizeEditablePayload({
		template_code: TEMPLATE.code,
		template_version: TEMPLATE.version,
		items,
		inspector_name: '巡检员甲'
	})
	assert.equal(result.ok, true)
	assert.equal(result.data.overall_result, 'abnormal')
	assert.equal(result.data.items.filter((item) => item.is_abnormal).length, 1)
})

test('整改与验证阶段按照照片和状态规则校验', () => {
	assert.equal(normalizeRectificationPayload({ rectification_note: '已更换' }).ok, false)
	const rectification = normalizeRectificationPayload({
		rectification_note: '已更换密封件并复测',
		rectification_photo_file_ids: [photo('fixed')]
	})
	assert.equal(rectification.ok, true)
	assert.equal(normalizeVerificationPayload({ verification_result: 'passed', verification_note: '' }).ok, false)
	assert.equal(normalizeVerificationPayload({ verification_result: 'passed', verification_note: '现场复查通过' }).data.status, 'closed')
	assert.equal(normalizeVerificationPayload({ verification_result: 'rejected', verification_note: '仍有泄漏' }).data.status, 'pending_rectification')
	assert.deepEqual(resolveHazardSyncTransition('closed', false), { action: 'cancel', status: 'cancelled', reset_closure: false })
	assert.deepEqual(resolveHazardSyncTransition('cancelled', true), { action: 'reopen', status: 'pending_rectification', reset_closure: true })
})

test('隐患快照、逾期判定和编号格式稳定', () => {
	const inspection = {
		_id: 'inspection-1',
		inspection_no: 'CZ20260801-001',
		station_id: STATION.id,
		station_name_snapshot: STATION.name,
		inspection_at: Date.now(),
		inspection_date: '2026-08-01',
		inspector_name: '巡检员甲'
	}
	const item = {
		...normalizeInspectionItems(completeItems()).data[0],
		is_abnormal: true,
		issue_note: '测试隐患',
		hazard_level: 'general',
		responsible_name: '甲',
		planned_measure: '整改',
		planned_complete_date: '2026-08-01',
		responsible_signature_file_id: photo('sign')
	}
	assert.equal(buildHazardSnapshot(inspection, item).inspection_no, inspection.inspection_no)
	assert.equal(isHazardOverdue({ status: 'pending_rectification', planned_complete_date: '2026-08-01' }, '2026-08-02'), true)
	assert.equal(isHazardOverdue({ status: 'pending_verification', planned_complete_date: '2026-08-01' }, '2026-08-02'), true)
	assert.equal(isHazardOverdue({ status: 'closed', planned_complete_date: '2026-08-01' }, '2026-08-02'), false)
	assert.equal(formatInspectionNumber('2026-08-01', 7), 'CZ20260801-007')
})
