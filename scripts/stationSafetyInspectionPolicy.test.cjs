'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	STATION,
	TEMPLATE,
	CATEGORIES,
	ITEM_CATEGORIES,
	getTemplate,
	templateItems,
	normalizeInspectionItems,
	normalizeEditablePayload,
	normalizeIncidentFacts
} = require('../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/inspectionPolicy')
const {
	normalizeRectificationPayload,
	normalizeVerificationPayload,
	buildHazardSnapshot,
	buildHazardObservation,
	buildSourceRevision,
	validateHazardLink,
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
	assert.equal(TEMPLATE.version, 4)
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
	assert.equal(templateItems(getTemplate(TEMPLATE.code, 2)).length, 36)
	assert.equal(getTemplate(TEMPLATE.code, 2).classification_version, undefined)
	assert.equal(getTemplate(TEMPLATE.code, 3).version, 3)
	assert.equal(templateItems(getTemplate(TEMPLATE.code, 3)).find(({ item }) => item.code === 'tank_bolts').item.label, '紧固螺栓是否松动、缺失')
	assert.equal(templateItems(getTemplate(TEMPLATE.code, 3)).some(({ item }) => item.supplement_coverage?.length), false)
	assert.deepEqual(templateItems(TEMPLATE).filter(({ item }) => item.supplement_coverage.includes('S02')).map(({ item }) => item.code), ['tank_bolts', 'tank_insulation_leak', 'pump_bolts', 'pump_appearance_leak'])
	assert.deepEqual(CATEGORIES.map((category) => Object.values(ITEM_CATEGORIES).filter((value) => value === category.code).length), [1, 23, 2, 3, 3, 3, 1])
	assert.equal(ITEM_CATEGORIES.filling_hanging_scale, '1')
	assert.equal(templateItems(TEMPLATE).find(({ item }) => item.code === 'tank_valves').item.hazard_category, '厂站设施')
	assert.equal(templateItems(TEMPLATE).find(({ item }) => item.code === 'public_entry_management').item.hazard_category, '安全管理')
})

test('完整正常巡检保存区域和项目快照', () => {
	const result = normalizeEditablePayload({
		template_code: TEMPLATE.code,
		template_version: TEMPLATE.version,
		items: completeItems(),
		inspector_name: '巡检员甲',
		started_at: Date.now() - 120000, ended_at: Date.now() - 60000, weather: '晴'
	})
	assert.equal(result.ok, true)
	assert.equal(result.data.items.length, 36)
	assert.equal(result.data.overall_result, 'normal')
	assert.equal(result.data.items[0].area_label_snapshot, '储罐区')
	assert.equal(result.data.items[35].area_label_snapshot, '全厂公共项')
	assert.equal(result.data.classification_version, 1)
	assert.equal(result.data.items[0].category_label_snapshot, '设备设施')
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
		inspector_name: '巡检员甲',
		started_at: Date.now() - 120000, ended_at: Date.now() - 60000, weather: '晴'
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
	assert.deepEqual(resolveHazardSyncTransition('closed', false), { action: 'preserve', status: 'closed', reset_closure: false })
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

test('未运行只适用于v3泵运行压力，必须保留原因和现场照片', () => {
	const items = completeItems()
	const pump = items.find((item) => item.item_code === 'pump_pipeline_pressure')
	pump.result_code = 'not_running'
	assert.equal(normalizeInspectionItems(items).ok, false)
	pump.not_running_reason = '当日泵未启动，未进行运行压力检查'
	const result = normalizeInspectionItems(items)
	assert.equal(result.ok, true)
	assert.equal(result.data.find((item) => item.item_code === pump.item_code).result_label_snapshot, '未运行')
	assert.equal(normalizeInspectionItems(items, getTemplate(TEMPLATE.code, 2)).ok, false)
	items[0].result_code = 'not_running'; items[0].not_running_reason = '未使用'
	assert.equal(normalizeInspectionItems(items).ok, false)
	items[0].result_code = 'normal'; pump.photo_file_ids = []
	assert.equal(normalizeInspectionItems(items).ok, false)
})

test('实际时间和天气必填，历史v2不补造时间天气', () => {
	const now = Date.now()
	const payload = { template_code: TEMPLATE.code, template_version: TEMPLATE.version, inspector_name: '甲', items: completeItems(), started_at: now - 2000, ended_at: now - 1000, weather: '多云' }
	assert.equal(normalizeEditablePayload(payload, { now }).ok, true)
	for (const patch of [{ started_at: undefined }, { ended_at: now - 3000 }, { ended_at: now + 120000 }, { weather: '' }]) assert.equal(normalizeEditablePayload({ ...payload, ...patch }, { now }).ok, false)
	const legacy = normalizeEditablePayload({ template_code: TEMPLATE.code, template_version: 2, inspector_name: '甲', items: completeItems() }, { template: getTemplate(TEMPLATE.code, 2) })
	assert.equal(legacy.ok, true)
	assert.equal(legacy.data.started_at, undefined)
	assert.equal(legacy.data.items[0].category_code, undefined)
})

test('实际上报和当场整改没有默认完成事实，整改必须记录复查', () => {
	assert.deepEqual(normalizeIncidentFacts({}).data, { report: null, on_site_rectification: null })
	assert.equal(normalizeIncidentFacts({ report: { reported_at: Date.now(), reported_to: '总监' } }).ok, false)
	assert.equal(normalizeIncidentFacts({ report: { reported_at: Date.now(), reported_to: '总监', method: '书面报告' } }).ok, true)
	const onsite = { completed_at: Date.now() - 10000, note: '清理通道', photo_file_ids: [photo('onsite')] }
	assert.equal(normalizeIncidentFacts({ on_site_rectification: onsite }).ok, false)
	assert.equal(normalizeIncidentFacts({ on_site_rectification: { ...onsite, rechecked_at: Date.now() - 20000, recheck_note: '通道畅通' } }).ok, false)
	assert.equal(normalizeIncidentFacts({ on_site_rectification: { ...onsite, rechecked_at: Date.now(), recheck_note: '通道畅通' } }).ok, true)
})

test('复见和复发只能显式关联正确状态、同一厂站，修订快照不递归复制历史', () => {
	const inspection = { _id: 's1', station_id: STATION.id, revision: 2, inspection_at: Date.now(), revision_reason: '补正位置' }
	assert.equal(validateHazardLink({ station_id: STATION.id, status: 'pending_rectification' }, inspection).ok, true)
	assert.equal(validateHazardLink({ station_id: STATION.id, status: 'closed' }, inspection).ok, false)
	assert.equal(validateHazardLink({ station_id: STATION.id, status: 'closed' }, inspection, true).ok, true)
	assert.equal(validateHazardLink({ station_id: 'other', status: 'closed' }, inspection, true).ok, false)
	const observation = buildHazardObservation(inspection, { item_code: 'tank_valves', result_code: 'normal' }, { _id: 'u1' }, 100)
	assert.equal(observation.observation_key, 'station_inspection:s1:tank_valves:2')
	assert.equal(observation.correction_reason, '补正位置')
	const prior = buildSourceRevision({ ...inspection, source_revisions: [{ revision: 1 }] }, '更正', { _id: 'u1' }, 100)
	assert.equal(prior.revision, 2)
	assert.equal(prior.snapshot.source_revisions, undefined)
	assert.equal(prior.reason, '更正')
})

function stationHarness() {
	const fs = require('node:fs')
	const vm = require('node:vm')
	const path = require('node:path')
	const state = { tables: { crm_users: [{ _id: 'u1', token: 'test', nickname: '巡检员甲', username: 'user', role: 'superadmin' }] }, failHazardAdd: false }
	let sequence = 0
	const command = Object.fromEntries(['in', 'and', 'or', 'push', 'exists', 'gte', 'lt'].map((op) => [op, (value) => ({ op, value })]))
	function matches(row, query) {
		if (query?.op === 'and') return query.value.every((value) => matches(row, value))
		if (query?.op === 'or') return query.value.some((value) => matches(row, value))
		return Object.entries(query || {}).every(([key, value]) => {
			if (value?.op === 'in') return value.value.includes(row[key])
			if (value?.op === 'exists') return value.value ? row[key] !== undefined : row[key] === undefined
			return row[key] === value
		})
	}
	function collection(name, getTables, transactional = false) {
		function query(where = {}, id = null) {
			let offset = 0, size = Infinity
			const allRows = () => (getTables()[name] || []).filter((row) => id ? row._id === id : matches(row, where))
			const rows = () => allRows().slice(offset, offset + size)
			const api = {
				where: (value) => { if (transactional) throw new Error('Alipay transactions do not support where queries'); return query(value) },
				doc: (value) => query({}, value), limit: (value) => { size = value; return api }, field: () => api, orderBy: () => api, skip: (value) => { offset = value; return api },
				get: async () => {
					if (transactional && state.transactionReadError) throw new Error(state.transactionReadError)
					if (transactional && !id) throw new Error('Alipay transaction reads require a document ID')
					return { data: structuredClone(id && transactional && !state.transactionArrayData ? rows()[0] || null : rows()) }
				},
				count: async () => ({ total: allRows().length }),
				add: async (document) => {
					if (name === 'crm_station_safety_hazards' && state.failHazardAdd) throw new Error('injected hazard failure')
					const all = getTables()[name] ||= []
					if (name === 'crm_station_safety_inspections' && all.some((row) => row.client_submission_id === document.client_submission_id)) throw new Error('duplicate key')
					const next = structuredClone({ ...document, _id: document._id || `id${++sequence}` }); all.push(next); return { id: next._id }
				},
				update: async (patch) => {
					const selected = rows()
					for (const row of selected) for (const [key, value] of Object.entries(patch)) row[key] = value?.op === 'push' ? [...(row[key] || []), ...structuredClone(value.value)] : structuredClone(value)
					return { updated: selected.length }
				}
			}
			return api
		}
		return query()
	}
	const db = { command, collection: (name) => collection(name, () => state.tables), RegExp: () => '', startTransaction: async () => {
		const tables = structuredClone(state.tables)
		return { collection: (name) => collection(name, () => tables, true), commit: async () => { state.tables = tables }, rollback: async () => {} }
	} }
	const source = fs.readFileSync(path.join(__dirname, '../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/index.js'), 'utf8')
	const context = { exports: {}, uniCloud: { database: () => db }, console, Date, require: (name) => {
		if (name.includes('pageAcl')) return { ensureActionAcl: async () => ({ ok: true }), isSuperAdmin: () => true }
		if (name === './inspectionNumber') return { allocateInspectionNumber: async ({ dateKey }) => ({ inspection_no: `CZ${dateKey.replaceAll('-', '')}-${++sequence}` }) }
		return require(path.join(__dirname, '../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection', name))
	} }
	vm.runInNewContext(source, context)
	return { state, call: (action, data) => context.exports.main({ action, data, token: 'test' }, {}) }
}

function submission(id, abnormal = false) {
	const items = completeItems()
	if (abnormal) Object.assign(items[0], { result_code: 'abnormal', issue_note: '接地线松脱', hazard_level: 'general', responsible_name: '负责人', planned_measure: '重新固定', planned_complete_date: '2026-12-01', responsible_signature_file_id: photo(`sign-${id}`) })
	return { client_submission_id: id, template_code: TEMPLATE.code, template_version: TEMPLATE.version, items, started_at: Date.now() - 120000, ended_at: Date.now() - 60000, weather: '晴' }
}

test('真实保存入口事务防重、完成日归属及失败回滚', async () => {
	const harness = stationHarness()
	const data = submission('submission-01', true)
	const first = await harness.call('submitV1', data)
	assert.equal(first.code, 0, first.msg)
	const row = harness.state.tables.crm_station_safety_inspections[0]
	assert.equal(row.inspection_at, data.ended_at)
	assert.equal(row.inspection_date, new Date(data.ended_at + 8 * 3600000).toISOString().slice(0, 10))
	assert.ok(row.submitted_at >= data.ended_at)
	assert.equal((await harness.call('submitV1', data)).data.duplicate, true)
	assert.equal(harness.state.tables.crm_station_safety_hazards[0].observations.length, 1)
	harness.state.failHazardAdd = true
	assert.equal((await harness.call('submitV1', submission('submission-02', true))).code, 500)
	assert.equal(harness.state.tables.crm_station_safety_inspections.length, 1)
	assert.equal(harness.state.tables.crm_station_safety_hazards.length, 1)
})

test('明确复见追加原隐患，已关闭复发新建，正常修订保留原问题', async () => {
	const harness = stationHarness()
	const initial = submission('submission-11', true)
	const first = await harness.call('submitV1', initial)
	assert.equal(first.code, 0, first.msg)
	const originalHazard = harness.state.tables.crm_station_safety_hazards[0]
	const repeated = submission('submission-12', true)
	repeated.items[0].linked_hazard_id = originalHazard._id
	assert.equal((await harness.call('submitV1', repeated)).code, 0)
	assert.equal(harness.state.tables.crm_station_safety_hazards.length, 1)
	assert.equal(harness.state.tables.crm_station_safety_hazards[0].observations.length, 2)
	const saved = harness.state.tables.crm_station_safety_inspections[0]
	const edited = { ...saved, items: completeItems(), expected_revision: 1, revision_reason: '校正本次录入；原隐患仍待复查' }
	const result = await harness.call('updateV1', edited)
	assert.equal(result.code, 0, result.msg)
	assert.equal(harness.state.tables.crm_station_safety_hazards[0].status, 'pending_rectification')
	assert.equal(harness.state.tables.crm_station_safety_inspections[0].source_revisions[0].snapshot.items[0].is_abnormal, true)
	assert.equal((await harness.call('updateV1', edited)).code, 409)
	harness.state.tables.crm_station_safety_hazards[0].status = 'closed'
	const wrongLink = submission('submission-13', true); wrongLink.items[0].linked_hazard_id = originalHazard._id
	assert.equal((await harness.call('submitV1', wrongLink)).code, 409)
	const recurrence = submission('submission-14', true); recurrence.items[0].recurrence_of = originalHazard._id
	assert.equal((await harness.call('submitV1', recurrence)).code, 0)
	assert.equal(harness.state.tables.crm_station_safety_hazards.length, 2)
	assert.equal(harness.state.tables.crm_station_safety_hazards[1].recurrence_of, originalHazard._id)
	assert.equal(harness.state.tables.crm_station_safety_hazards[0].status, 'closed')
})

test('实际处置入口保留上报和当场整改事实，重复提交不增加版本，验证仍独立', async () => {
	const harness = stationHarness()
	assert.equal((await harness.call('submitV1', submission('submission-21', true))).code, 0)
	let hazard = harness.state.tables.crm_station_safety_hazards[0]
	assert.equal(hazard.report, null)
	const report = { reported_at: Date.now() - 1000, reported_to: '安全总监', method: '书面报告', temporary_measure: '隔离受影响区域', requirements: '检查并固定接地线' }
	const reportRequest = { _id: hazard._id, expected_revision: 1, report }
	assert.equal((await harness.call('recordHazardFactsV1', reportRequest)).code, 0)
	assert.equal((await harness.call('recordHazardFactsV1', reportRequest)).data.duplicate, true)
	hazard = harness.state.tables.crm_station_safety_hazards[0]
	assert.equal(hazard.revision, 2)
	assert.equal(hazard.source_revisions[0].snapshot.report, null)
	const onsite = { completed_at: Date.now() - 1000, note: '已固定并测试', photo_file_ids: [photo('actual-onsite')], rechecked_at: Date.now(), recheck_note: '复查连接牢固' }
	assert.equal((await harness.call('recordHazardFactsV1', { _id: hazard._id, expected_revision: 2, on_site_rectification: onsite })).code, 0)
	hazard = harness.state.tables.crm_station_safety_hazards[0]
	assert.equal(hazard.status, 'pending_verification')
	assert.equal(hazard.rectified_at, onsite.completed_at)
	assert.equal(hazard.verified_at, null)
	assert.equal((await harness.call('verifyHazardV1', { _id: hazard._id, expected_revision: 3, verification_result: 'passed', verification_note: '验证确认通过', verification_photo_file_ids: [] })).code, 0)
	hazard = harness.state.tables.crm_station_safety_hazards[0]
	assert.equal(hazard.status, 'closed')
	assert.equal(hazard.revision, 4)
	assert.equal(hazard.source_revisions.length, 3)
	assert.equal(hazard.report.reported_to, '安全总监')
})

test('历史v1/v2按原模板修改保留旧数据，不追加伪造时间和分类', async () => {
	for (const version of [1, 2]) {
		const harness = stationHarness()
		const template = getTemplate(TEMPLATE.code, version)
		const items = templateItems(template).map(({ item }) => ({ item_code: item.code, result_code: 'normal', photo_file_ids: [photo(`legacy-${version}-${item.code}`)] }))
		const normalized = normalizeEditablePayload({ template_code: template.code, template_version: version, inspector_name: '历史巡检员', items }, { template })
		const record = { _id: `legacy-${version}`, ...normalized.data, inspection_no: `LEGACY-${version}`, inspection_at: Date.now() - 3600000, inspection_date: '2026-08-01', updated_at: 1 }
		harness.state.tables.crm_station_safety_inspections = [record]
		const result = await harness.call('updateV1', { ...record, expected_revision: 1, revision_reason: '补正备注', remark: '保留实际历史' })
		assert.equal(result.code, 0, result.msg)
		const current = harness.state.tables.crm_station_safety_inspections[0]
		assert.equal(current.template_version, version)
		assert.equal(current.items.length, version === 1 ? 37 : 36)
		assert.equal(current.classification_version, undefined)
		assert.equal(current.started_at, undefined)
		assert.equal(current.submitted_at, undefined)
		assert.equal(current.source_revisions[0].snapshot.inspection_no, record.inspection_no)
	}
})

test('支付宝事务仅按已确认ID读取，兼容对象和单数组，读取错误不会作为缺失继续保存', async () => {
	const harness = stationHarness()
	const initial = await harness.call('submitV1', submission('transaction-scope-01', true))
	assert.equal(initial.code, 0, initial.msg)
	const hazardId = harness.state.tables.crm_station_safety_hazards[0]._id
	const repeated = submission('transaction-scope-02', true)
	repeated.items[0].linked_hazard_id = hazardId
	harness.state.transactionArrayData = true
	assert.equal((await harness.call('submitV1', repeated)).code, 0)
	const missing = submission('transaction-scope-03', true)
	missing.items[0].linked_hazard_id = 'missing-document'
	assert.equal((await harness.call('submitV1', missing)).code, 409)
	for (const [index, message] of ['not found document', 'database connection interrupted'].entries()) {
		harness.state.transactionReadError = message
		const next = submission(`transaction-scope-error-${index}`, true)
		next.items[0].linked_hazard_id = hazardId
		assert.equal((await harness.call('submitV1', next)).code, 500)
		assert.equal(harness.state.tables.crm_station_safety_inspections.length, 2)
		assert.equal(harness.state.tables.crm_station_safety_hazards[0].observations.length, 2)
	}
})

test('复见原单多次修订不能遗失历史关联，已关闭隐患仅追加修订证据', async () => {
	const harness = stationHarness()
	assert.equal((await harness.call('submitV1', submission('history-link-01', true))).code, 0)
	const hazardId = harness.state.tables.crm_station_safety_hazards[0]._id
	const repeated = submission('history-link-02', true)
	repeated.items[0].linked_hazard_id = hazardId
	assert.equal((await harness.call('submitV1', repeated)).code, 0)
	let source = harness.state.tables.crm_station_safety_inspections[1]
	assert.equal((await harness.call('updateV1', { ...source, items: completeItems(), expected_revision: 1, revision_reason: '补正本次检查结果，原隐患继续保留' })).code, 0)
	source = harness.state.tables.crm_station_safety_inspections[1]
	const detached = submission('history-link-unrelated', true)
	assert.equal((await harness.call('updateV1', { ...source, items: detached.items, expected_revision: 2, revision_reason: '尝试改作新问题' })).code, 409)
	harness.state.tables.crm_station_safety_hazards[0].status = 'closed'
	assert.equal((await harness.call('updateV1', { ...source, items: repeated.items, expected_revision: 2, revision_reason: '核实原检查有异常并保留原关联' })).code, 0)
	assert.equal(harness.state.tables.crm_station_safety_hazards.length, 1)
	assert.equal(harness.state.tables.crm_station_safety_hazards[0].status, 'closed')
	assert.equal(harness.state.tables.crm_station_safety_hazards[0].observations.length, 4)
	assert.equal(harness.state.tables.crm_station_safety_inspections[1].source_revisions.length, 2)
})

test('复见更新顶层处置事实先归档，较早补记仅保留观察而不覆盖较新事实', async () => {
	const harness = stationHarness()
	assert.equal((await harness.call('submitV1', submission('fact-archive-01', true))).code, 0)
	let hazard = harness.state.tables.crm_station_safety_hazards[0]
	const now = Date.now()
	const reportA = { reported_at: now - 60000, reported_to: '上报A', method: '电话', temporary_measure: '隔离', requirements: '检修' }
	const onsiteA = { completed_at: now - 60000, note: '当场整改A', photo_file_ids: [photo('onsite-archive-A')], rechecked_at: now - 59000, recheck_note: '复查A' }
	assert.equal((await harness.call('recordHazardFactsV1', { _id: hazard._id, expected_revision: 1, report: reportA, on_site_rectification: onsiteA })).code, 0)
	const newer = submission('fact-archive-02', true)
	Object.assign(newer.items[0], { linked_hazard_id: hazard._id, report: { ...reportA, reported_at: now - 30000, reported_to: '上报B' }, on_site_rectification: { ...onsiteA, completed_at: now - 30000, rechecked_at: now - 29000, note: '当场整改B', photo_file_ids: [photo('onsite-archive-B')] } })
	assert.equal((await harness.call('submitV1', newer)).code, 0)
	hazard = harness.state.tables.crm_station_safety_hazards[0]
	assert.equal(hazard.revision, 3)
	assert.equal(hazard.source_revisions[1].snapshot.report.reported_to, '上报A')
	assert.equal(hazard.source_revisions[1].snapshot.on_site_rectification.note, '当场整改A')
	assert.equal(hazard.report.reported_to, '上报B')
	assert.equal(hazard.on_site_rectification.note, '当场整改B')
	const earlier = submission('fact-archive-03', true)
	Object.assign(earlier.items[0], { linked_hazard_id: hazard._id, report: reportA, on_site_rectification: onsiteA })
	assert.equal((await harness.call('submitV1', earlier)).code, 0)
	hazard = harness.state.tables.crm_station_safety_hazards[0]
	assert.equal(hazard.revision, 3)
	assert.equal(hazard.observations.length, 3)
	assert.equal(hazard.observations[2].report.reported_to, '上报A')
	assert.equal(hazard.report.reported_to, '上报B')
	assert.equal(hazard.on_site_rectification.note, '当场整改B')
	assert.equal(hazard.status, 'pending_verification')
})

test('历史v1/v2可凭据补录完整实际时段天气，保留原模板及版本且禁止移日', async () => {
	for (const version of [1, 2]) {
		const harness = stationHarness()
		const template = getTemplate(TEMPLATE.code, version)
		const items = templateItems(template).map(({ item }) => ({ item_code: item.code, result_code: 'normal', photo_file_ids: [photo(`supplement-legacy-${version}-${item.code}`)] }))
		const normalized = normalizeEditablePayload({ template_code: template.code, template_version: version, inspector_name: '历史巡检员', items }, { template })
		const endedAt = Date.parse('2026-08-01T10:00:00+08:00')
		const record = { _id: `legacy-supplement-${version}`, ...normalized.data, inspection_no: `LEGACY-${version}`, inspection_at: endedAt, inspection_date: '2026-08-01', updated_at: 1 }
		harness.state.tables.crm_station_safety_inspections = [record]
		const request = { ...record, expected_revision: 1, revision_reason: '依据当班纸质记录补录实际时段和天气', started_at: endedAt - 3600000, ended_at: endedAt, weather: '晴' }
		assert.equal((await harness.call('updateV1', { ...request, weather: '' })).code, 409)
		assert.equal((await harness.call('updateV1', { ...request, ended_at: endedAt + 86400000 })).code, 409)
		const result = await harness.call('updateV1', request)
		assert.equal(result.code, 0, result.msg)
		const saved = harness.state.tables.crm_station_safety_inspections[0]
		assert.equal(saved.template_version, version)
		assert.equal(saved.classification_version, undefined)
		assert.equal(saved.items[0].category_code, undefined)
		assert.equal(saved.submitted_at, undefined)
		assert.equal(saved.ended_at, endedAt)
		assert.equal(saved.inspection_date, '2026-08-01')
		assert.equal(saved.source_revisions[0].snapshot.started_at, undefined)
		assert.equal(saved.source_revisions[0].reason, request.revision_reason)
	}
})
