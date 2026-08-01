'use strict'

const STATION = Object.freeze({
	id: 'XTNY-001',
	name: '无极县新拓能源开发有限公司'
})

const RESULT_OPTIONS = Object.freeze([
	{ code: 'normal', label: '正常', is_abnormal: false },
	{ code: 'abnormal', label: '异常', is_abnormal: true }
])

function item(code, label, hazardCategory = '厂站设施') {
	return Object.freeze({
		code,
		label,
		hazard_category: hazardCategory,
		options: RESULT_OPTIONS,
		min_photos: 1,
		max_photos: 3
	})
}

function area(code, label, items) {
	return Object.freeze({ code, label, items: Object.freeze(items) })
}

const TEMPLATE_V1 = Object.freeze({
	code: 'station_safety_standard',
	version: 1,
	title: '厂站内安全巡检',
	station: STATION,
	areas: Object.freeze([
		area('tank_area', '储罐区', [
			item('tank_static_eliminator', '人体除静电装置是否完好、规范接地'),
			item('tank_valves', '阀门位置、操作及泄漏情况是否正常'),
			item('tank_safety_valve', '安全阀是否在有效状态，铅封和标识是否完好'),
			item('tank_bolts', '紧固螺栓是否松动、缺失'),
			item('tank_alarm', '可燃气体报警器是否通电且工作正常'),
			item('tank_signage', '安全标志与设备标牌是否齐全、清晰、正常'),
			item('tank_instruments', '液位计、压力表及最高压力红线是否正常'),
			item('tank_grounding', '设备接地、管道静电跨接是否完好'),
			item('tank_housekeeping', '区域是否无杂物，通道是否畅通'),
			item('tank_insulation_leak', '储罐和管道保温、外观及泄漏情况是否正常')
		]),
		area('pump_area', '柱塞泵/潜液泵区', [
			item('pump_static_eliminator', '除静电装置是否完好、规范接地'),
			item('pump_bolts', '泵体及附属设备螺栓是否松动、缺失'),
			item('pump_explosion_conduit', '防爆管是否完整，有无破裂'),
			item('pump_grounding', '设备接地与静电跨接是否完好'),
			item('pump_valves', '阀门开关状态及泄漏情况是否正常'),
			item('pump_safety_valve', '安全阀是否在有效状态，标识是否完好'),
			item('pump_signage', '安全标志与设备标牌是否齐全、正常'),
			item('pump_pipeline_pressure', '运行时管道压力是否处于规定范围且无异常波动'),
			item('pump_appearance_leak', '泵体和管道保温、外观及泄漏情况是否正常')
		]),
		area('filling_area', '充装区', [
			item('filling_static_eliminator', '除静电装置是否完好、规范接地'),
			item('filling_explosion_light', '防爆灯是否完好、工作正常'),
			item('filling_emergency_light', '应急灯是否完好、工作正常'),
			item('filling_hanging_scale', '吊秤及防脱钩是否完好、无变形'),
			item('filling_tools', '现场工具是否齐全且符合防爆要求，无非防爆工具柜'),
			item('filling_explosion_protection', '防爆管是否破裂，防爆设备螺栓是否松动'),
			item('filling_scale_shell', '充装秤防爆壳螺丝是否松动、缺失'),
			item('filling_alarm', '可燃气体报警器是否通电且工作正常'),
			item('filling_signage', '安全标志与设备标牌是否齐全、正常'),
			item('filling_housekeeping', '区域是否无杂物，充装及消防通道是否畅通'),
			item('filling_extinguisher', '灭火器是否在有效状态，压力、铅封及巡检标签是否正常')
		]),
		area('public_area', '全厂公共项', [
			item('public_emergency_supplies', '应急物资及清单是否齐全，正压式空气呼吸器、手持可燃气体探测器等是否在位'),
			item('public_control_room_electrical', '控制室配电箱、绝缘胶垫和出线口封堵是否正常'),
			item('public_cylinder_zoning', '气瓶是否分区存放，空瓶、满瓶标签是否清晰'),
			item('public_entry_management', '车辆、人员入厂登记、区域边界和规定着装是否符合要求', '安全管理'),
			item('public_cylinder_transport', '是否禁止叉车运瓶，专用推车防倾倒、防碰撞措施是否完好'),
			item('public_fire_records', '灭火器、消防栓等消防设施年检、巡检标签和台账频次是否符合要求'),
			item('public_lightning_static_report', '防雷防静电检测报告、接地标识和检测频次是否符合要求')
		])
	])
})

const TEMPLATE = Object.freeze({
	...TEMPLATE_V1,
	version: 2,
	areas: Object.freeze(
		TEMPLATE_V1.areas.map((areaEntry) => {
			if (areaEntry.code === 'tank_area') {
				return area(
					areaEntry.code,
					areaEntry.label,
					areaEntry.items.map((itemEntry) =>
						itemEntry.code === 'tank_instruments'
							? item(itemEntry.code, '液位计、压力表是否正常', itemEntry.hazard_category)
							: itemEntry
					)
				)
			}
			if (areaEntry.code === 'filling_area') {
				return area(
					areaEntry.code,
					areaEntry.label,
					areaEntry.items.flatMap((itemEntry) => {
						if (itemEntry.code === 'filling_explosion_light') {
							return [item('filling_explosion_emergency_light', '防爆应急灯', itemEntry.hazard_category)]
						}
						if (itemEntry.code === 'filling_emergency_light') return []
						return [itemEntry]
					})
				)
			}
			return areaEntry
		})
	)
})

const TEMPLATES = Object.freeze([TEMPLATE, TEMPLATE_V1])

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function normalizeCloudFileId(value) {
	const text = normalizeString(value)
	return text.startsWith('cloud://') ? text : ''
}

function normalizePhotoIds(value, maxPhotos = 3) {
	const source = Array.isArray(value) ? value : []
	const result = []
	for (const item of source) {
		const fileId = normalizeCloudFileId(item)
		if (!fileId || result.includes(fileId)) continue
		result.push(fileId)
		if (result.length >= maxPhotos) break
	}
	return result
}

function isValidDateText(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const timestamp = Date.parse(`${text}T00:00:00+08:00`)
	if (!Number.isFinite(timestamp)) return false
	return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) === text
}

function templateItems(template = TEMPLATE) {
	return (template.areas || []).flatMap((areaEntry) =>
		(areaEntry.items || []).map((itemEntry) => ({ area: areaEntry, item: itemEntry }))
	)
}

function getTemplate(code, version) {
	const normalizedCode = normalizeString(code)
	const normalizedVersion = Number(version)
	return TEMPLATES.find((template) => template.code === normalizedCode && template.version === normalizedVersion) || null
}

function normalizeInspectionItems(value, template = TEMPLATE) {
	const definitions = templateItems(template)
	if (!Array.isArray(value) || value.length !== definitions.length) {
		return { ok: false, msg: `巡检项目必须完整填写 ${definitions.length} 项` }
	}
	const rawByCode = new Map()
	for (const rawItem of value) {
		const code = normalizeString(rawItem?.item_code ?? rawItem?.code)
		if (!code || rawByCode.has(code)) return { ok: false, msg: '巡检项目存在缺失或重复' }
		rawByCode.set(code, rawItem)
	}
	const knownCodes = new Set(definitions.map(({ item }) => item.code))
	if (Array.from(rawByCode.keys()).some((code) => !knownCodes.has(code))) {
		return { ok: false, msg: '巡检项目版本不匹配' }
	}

	const normalized = []
	const usedMediaFileIds = new Set()
	for (const { area: areaEntry, item: templateItem } of definitions) {
		const rawItem = rawByCode.get(templateItem.code)
		if (!rawItem) return { ok: false, msg: `缺少“${templateItem.label}”检查结果` }
		const resultCode = normalizeString(rawItem.result_code ?? rawItem.resultCode)
		const option = RESULT_OPTIONS.find((entry) => entry.code === resultCode)
		if (!option) return { ok: false, msg: `请选择“${templateItem.label}”的正常或异常结果` }

		const rawPhotos = rawItem.photo_file_ids ?? rawItem.photos
		const rawPhotoCount = Array.isArray(rawPhotos) ? rawPhotos.length : 0
		if (rawPhotoCount > templateItem.max_photos) {
			return { ok: false, msg: `“${templateItem.label}”最多上传 ${templateItem.max_photos} 张照片` }
		}
		const photoFileIds = normalizePhotoIds(rawPhotos, templateItem.max_photos)
		if (photoFileIds.length !== rawPhotoCount) {
			return { ok: false, msg: `“${templateItem.label}”的照片文件无效或重复` }
		}
		if (photoFileIds.length < templateItem.min_photos) {
			return { ok: false, msg: `“${templateItem.label}”至少上传 ${templateItem.min_photos} 张照片` }
		}
		if (photoFileIds.some((fileId) => usedMediaFileIds.has(fileId))) {
			return { ok: false, msg: '同一媒体文件不能在多个检查项中重复使用' }
		}

		const abnormal = option.is_abnormal
		const issueNote = normalizeString(rawItem.issue_note ?? rawItem.issueNote)
		const hazardLevel = normalizeString(rawItem.hazard_level ?? rawItem.hazardLevel)
		const responsibleName = normalizeString(rawItem.responsible_name ?? rawItem.responsibleName)
		const plannedMeasure = normalizeString(rawItem.planned_measure ?? rawItem.plannedMeasure)
		const plannedCompleteDate = normalizeString(rawItem.planned_complete_date ?? rawItem.plannedCompleteDate)
		const responsibleSignatureFileId = normalizeCloudFileId(
			rawItem.responsible_signature_file_id ?? rawItem.responsibleSignatureFileId
		)
		if (abnormal) {
			if (!issueNote) return { ok: false, msg: `请填写“${templateItem.label}”的隐患描述` }
			if (issueNote.length > 500) return { ok: false, msg: '隐患描述最多 500 字' }
			if (!['general', 'major'].includes(hazardLevel)) return { ok: false, msg: `请选择“${templateItem.label}”的隐患等级` }
			if (!responsibleName) return { ok: false, msg: `请填写“${templateItem.label}”的整改责任人` }
			if (responsibleName.length > 50) return { ok: false, msg: '整改责任人最多 50 字' }
			if (!plannedMeasure) return { ok: false, msg: `请填写“${templateItem.label}”的计划整改措施` }
			if (plannedMeasure.length > 1000) return { ok: false, msg: '计划整改措施最多 1000 字' }
			if (!isValidDateText(plannedCompleteDate)) return { ok: false, msg: `请选择“${templateItem.label}”的有效计划完成日期` }
			if (!responsibleSignatureFileId) return { ok: false, msg: `请完成“${templateItem.label}”责任人手写签名` }
			if (usedMediaFileIds.has(responsibleSignatureFileId) || photoFileIds.includes(responsibleSignatureFileId)) {
				return { ok: false, msg: '现场照片和责任人签名不能重复使用同一媒体文件' }
			}
		}
		photoFileIds.forEach((fileId) => usedMediaFileIds.add(fileId))
		if (abnormal) usedMediaFileIds.add(responsibleSignatureFileId)

		normalized.push({
			area_code: areaEntry.code,
			area_label_snapshot: areaEntry.label,
			item_code: templateItem.code,
			item_label_snapshot: templateItem.label,
			hazard_category_snapshot: templateItem.hazard_category,
			result_code: option.code,
			result_label_snapshot: option.label,
			is_abnormal: abnormal,
			issue_note: abnormal ? issueNote : '',
			hazard_level: abnormal ? hazardLevel : '',
			responsible_name: abnormal ? responsibleName : '',
			planned_measure: abnormal ? plannedMeasure : '',
			planned_complete_date: abnormal ? plannedCompleteDate : '',
			responsible_signature_file_id: abnormal ? responsibleSignatureFileId : '',
			photo_file_ids: photoFileIds
		})
	}
	return { ok: true, data: normalized }
}

function normalizeEditablePayload(data = {}, options = {}) {
	const template = options.template || TEMPLATE
	const templateCode = normalizeString(data.template_code ?? data.templateCode)
	const templateVersion = Number(data.template_version ?? data.templateVersion)
	if (templateCode !== template.code || templateVersion !== template.version) {
		return { ok: false, msg: '巡检模板版本不匹配，请刷新后重试' }
	}
	const itemsResult = normalizeInspectionItems(data.items, template)
	if (!itemsResult.ok) return itemsResult
	const inspectorName = normalizeString(data.inspector_name ?? data.inspectorName ?? options.defaultInspectorName)
	if (!inspectorName) return { ok: false, msg: '巡检员姓名不能为空' }
	if (inspectorName.length > 50) return { ok: false, msg: '巡检员姓名最多 50 字' }
	const remark = normalizeString(data.remark)
	if (remark.length > 1000) return { ok: false, msg: '巡检备注最多 1000 字' }
	return {
		ok: true,
		data: {
			station_id: STATION.id,
			station_name_snapshot: STATION.name,
			template_code: template.code,
			template_version: template.version,
			template_title_snapshot: template.title,
			items: itemsResult.data,
			overall_result: itemsResult.data.some((entry) => entry.is_abnormal) ? 'abnormal' : 'normal',
			inspector_name: inspectorName,
			remark
		}
	}
}

function normalizeClientSubmissionId(value) {
	const text = normalizeString(value)
	return /^[a-zA-Z0-9_-]{8,100}$/.test(text) ? text : ''
}

module.exports = {
	STATION,
	TEMPLATE,
	RESULT_OPTIONS,
	getTemplate,
	templateItems,
	normalizeString,
	normalizeCloudFileId,
	normalizePhotoIds,
	isValidDateText,
	normalizeInspectionItems,
	normalizeEditablePayload,
	normalizeClientSubmissionId
}
