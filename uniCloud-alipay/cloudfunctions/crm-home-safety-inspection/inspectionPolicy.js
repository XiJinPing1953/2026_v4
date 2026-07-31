'use strict'

const LEGACY_TEMPLATE = Object.freeze({
	code: 'home_safety_demo',
	version: 1,
	title: '入户随瓶安全巡检（Demo）',
	items: [
		{
			code: 'vaporizer_regulator',
			label: '气化器/调压装置',
			options: [
				{ code: 'normal', label: '正常', is_abnormal: false },
				{ code: 'abnormal', label: '异常', is_abnormal: true }
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'cylinder_valve_pipeline_leak',
			label: '钢瓶、阀门及连接管路',
			options: [
				{ code: 'no_leak', label: '无泄漏', is_abnormal: false },
				{ code: 'leak', label: '有泄漏', is_abnormal: true }
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'storage_ventilation_fire_access',
			label: '存放环境、通风及消防通道',
			options: [
				{ code: 'compliant', label: '合格', is_abnormal: false },
				{ code: 'non_compliant', label: '不合格', is_abnormal: true }
			],
			min_photos: 1,
			max_photos: 3
		}
	]
})

const CURRENT_TEMPLATE = Object.freeze({
	code: 'home_safety_standard',
	version: 1,
	title: '入户随瓶安全巡检',
	items: [
		{
			code: 'storage_environment_leak',
			label: '气瓶存放环境内是否存在燃气泄漏',
			checks: [
				{
					code: 'leakage',
					label: '泄漏情况',
					options: [
						{ code: 'no_leak', label: '无泄漏', is_abnormal: false },
						{ code: 'leak', label: '有泄漏', is_abnormal: true }
					]
				}
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'cylinder_appearance',
			label: '气瓶外观是否正常',
			checks: [
				{
					code: 'appearance',
					label: '外观情况',
					options: [
						{ code: 'normal', label: '正常', is_abnormal: false },
						{ code: 'abnormal', label: '异常', is_abnormal: true }
					]
				}
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'multiple_gas_sources',
			label: '是否存在不同气源同时存放或使用',
			description: '“多气源”是指同一场所同时存在两种及以上燃气种类或供气系统；多只同类液化气瓶不属于多气源。',
			checks: [
				{
					code: 'multiple_sources',
					label: '多气源情况',
					options: [
						{ code: 'none', label: '无', is_abnormal: false },
						{ code: 'present', label: '有', is_abnormal: true }
					]
				}
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'appliance_connection_hose',
			label: '燃气器具连接管',
			checks: [
				{
					code: 'appearance_connection',
					label: '连接及外观',
					options: [
						{ code: 'normal', label: '正常', is_abnormal: false },
						{ code: 'abnormal', label: '异常', is_abnormal: true }
					]
				},
				{
					code: 'leakage',
					label: '泄漏情况',
					options: [
						{ code: 'no_leak', label: '无泄漏', is_abnormal: false },
						{ code: 'leak', label: '有泄漏', is_abnormal: true }
					]
				}
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'valve_appearance_leak',
			label: '阀门',
			checks: [
				{
					code: 'appearance',
					label: '外观情况',
					options: [
						{ code: 'normal', label: '正常', is_abnormal: false },
						{ code: 'abnormal', label: '异常', is_abnormal: true }
					]
				},
				{
					code: 'leakage',
					label: '泄漏情况',
					options: [
						{ code: 'no_leak', label: '无泄漏', is_abnormal: false },
						{ code: 'leak', label: '有泄漏', is_abnormal: true }
					]
				}
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'regulator_appearance_leak',
			label: '调压阀',
			checks: [
				{
					code: 'appearance',
					label: '外观情况',
					options: [
						{ code: 'normal', label: '正常', is_abnormal: false },
						{ code: 'abnormal', label: '异常', is_abnormal: true }
					]
				},
				{
					code: 'leakage',
					label: '泄漏情况',
					options: [
						{ code: 'no_leak', label: '无泄漏', is_abnormal: false },
						{ code: 'leak', label: '有泄漏', is_abnormal: true }
					]
				}
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'gas_leak_alarm_power',
			label: '燃气泄漏报警器',
			checks: [
				{
					code: 'installed',
					label: '是否安装',
					options: [
						{ code: 'yes', label: '是', is_abnormal: false },
						{ code: 'no', label: '否', is_abnormal: true }
					]
				},
				{
					code: 'powered',
					label: '是否通电',
					options: [
						{ code: 'yes', label: '是', is_abnormal: false },
						{ code: 'no', label: '否', is_abnormal: true }
					],
					visible_when: { check_code: 'installed', option_code: 'yes' }
				}
			],
			min_photos: 1,
			max_photos: 3
		},
		{
			code: 'vaporizer_appearance',
			label: '气化器外观',
			checks: [
				{
					code: 'appearance',
					label: '外观情况',
					options: [
						{ code: 'normal', label: '正常', is_abnormal: false },
						{ code: 'abnormal', label: '异常', is_abnormal: true },
						{
							code: 'not_applicable',
							label: '现场未使用气化器（不适用）',
							is_abnormal: false
						}
					]
				}
			],
			min_photos: 1,
			max_photos: 3
		}
	]
})

const TEMPLATES = Object.freeze([LEGACY_TEMPLATE, CURRENT_TEMPLATE])
// Keep TEMPLATE as the public current-template alias used by the H5 and policy tests.
const TEMPLATE = CURRENT_TEMPLATE

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
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

function toFiniteNumber(value, fallback = null) {
	if (value == null || typeof value === 'boolean') return fallback
	if (typeof value === 'string' && !value.trim()) return fallback
	const number = Number(value)
	return Number.isFinite(number) ? number : fallback
}

function normalizeLocationCapture(value, now = Date.now()) {
	const source = value && typeof value === 'object' ? value : {}
	const rawStatus = normalizeString(source.status).toLowerCase()
	const rawCoordinateType = normalizeString(
		source.coordinate_type ?? source.coordinateType
	).toLowerCase()
	const capturedAt = toFiniteNumber(source.captured_at ?? source.capturedAt, now)
	const base = {
		status: rawStatus || 'not_requested',
		coordinate_type: 'wgs84',
		captured_at: capturedAt > 0 ? capturedAt : now,
		source: normalizeString(source.source) || 'home_safety_inspection_h5'
	}
	const latitude = toFiniteNumber(source.latitude, null)
	const longitude = toFiniteNumber(source.longitude, null)
	const coordinatesValid =
		rawCoordinateType === 'wgs84' &&
		latitude != null &&
		longitude != null &&
		latitude >= -90 &&
		latitude <= 90 &&
		longitude >= -180 &&
		longitude <= 180
	if (rawStatus === 'ok' && coordinatesValid) {
		return {
			...base,
			status: 'ok',
			latitude,
			longitude,
			accuracy: toFiniteNumber(source.accuracy, null),
			error_code: '',
			error_message: ''
		}
	}
	return {
		...base,
		status: rawStatus === 'failed' || rawStatus === 'ok' ? 'failed' : 'not_requested',
		latitude: null,
		longitude: null,
		accuracy: null,
		error_code:
			normalizeString(source.error_code ?? source.errorCode) ||
			(rawStatus === 'ok' && !coordinatesValid ? 'invalid_coordinates' : ''),
		error_message:
			normalizeString(source.error_message ?? source.errorMessage) ||
			(rawStatus === 'ok' && !coordinatesValid ? '定位坐标无效' : '')
	}
}

function getTemplate(templateCode, templateVersion) {
	const code = normalizeString(templateCode)
	const version = Number(templateVersion)
	if (!code || !Number.isInteger(version)) return null
	return TEMPLATES.find((template) => template.code === code && template.version === version) || null
}

function findTemplateItem(template, code) {
	return template.items.find((item) => item.code === code) || null
}

function isCheckVisible(check, selectedOptions) {
	const condition = check && check.visible_when
	if (!condition) return true
	return selectedOptions.get(condition.check_code) === condition.option_code
}

function normalizeLegacyItem(rawItem, templateItem) {
	const optionCode = normalizeString(rawItem.option_code ?? rawItem.selected_option_code)
	const option = templateItem.options.find((item) => item.code === optionCode)
	if (!option) return { ok: false, msg: `请选择“${templateItem.label}”的巡检结果` }
	return {
		ok: true,
		data: {
			option_code: option.code,
			option_label_snapshot: option.label,
			is_abnormal: Boolean(option.is_abnormal)
		}
	}
}

function normalizeStandardItem(rawItem, templateItem) {
	const rawAnswers = Array.isArray(rawItem.answers) ? rawItem.answers : []
	const supplied = new Map()
	for (const rawAnswer of rawAnswers) {
		const checkCode = normalizeString(rawAnswer && (rawAnswer.check_code ?? rawAnswer.code))
		if (!checkCode || supplied.has(checkCode)) {
			return { ok: false, msg: `“${templateItem.label}”的检查结果存在缺失或重复` }
		}
		supplied.set(checkCode, rawAnswer)
	}

	const selectedOptions = new Map()
	const answers = []
	for (const check of templateItem.checks) {
		const visible = isCheckVisible(check, selectedOptions)
		const rawAnswer = supplied.get(check.code)
		if (!visible) {
			if (rawAnswer) return { ok: false, msg: `“${templateItem.label}－${check.label}”当前无需填写` }
			continue
		}
		if (!rawAnswer) return { ok: false, msg: `请选择“${templateItem.label}－${check.label}”的检查结果` }
		const optionCode = normalizeString(rawAnswer.option_code ?? rawAnswer.selected_option_code)
		const option = check.options.find((item) => item.code === optionCode)
		if (!option) return { ok: false, msg: `请选择“${templateItem.label}－${check.label}”的检查结果` }
		selectedOptions.set(check.code, option.code)
		answers.push({
			check_code: check.code,
			check_label_snapshot: check.label,
			option_code: option.code,
			option_label_snapshot: option.label,
			is_abnormal: Boolean(option.is_abnormal)
		})
	}

	const knownCheckCodes = new Set(templateItem.checks.map((check) => check.code))
	for (const checkCode of supplied.keys()) {
		if (!knownCheckCodes.has(checkCode)) return { ok: false, msg: `“${templateItem.label}”的检查项目版本不匹配` }
	}
	const isAbnormal = answers.some((answer) => answer.is_abnormal)
	const isNotApplicable =
		!isAbnormal && answers.some((answer) => answer.option_code === 'not_applicable')
	return {
		ok: true,
		data: {
			answers,
			result_code: isAbnormal ? 'abnormal' : isNotApplicable ? 'not_applicable' : 'normal',
			result_label_snapshot: isAbnormal ? '异常' : isNotApplicable ? '不适用' : '正常',
			is_abnormal: isAbnormal,
			is_not_applicable: isNotApplicable
		}
	}
}

function normalizeInspectionItems(value, template = TEMPLATE) {
	if (!template || !Array.isArray(template.items)) return { ok: false, msg: '巡检模板无法识别' }
	if (!Array.isArray(value)) return { ok: false, msg: '巡检项目不完整' }
	if (value.length !== template.items.length) return { ok: false, msg: '巡检项目数量不正确' }

	const seen = new Set()
	const normalized = []
	for (const rawItem of value) {
		const itemCode = normalizeString(rawItem && (rawItem.item_code ?? rawItem.code))
		if (!itemCode || seen.has(itemCode)) return { ok: false, msg: '巡检项目存在缺失或重复' }
		seen.add(itemCode)
		const templateItem = findTemplateItem(template, itemCode)
		if (!templateItem) return { ok: false, msg: '巡检项目版本不匹配' }

		const itemResult = Array.isArray(templateItem.checks)
			? normalizeStandardItem(rawItem, templateItem)
			: normalizeLegacyItem(rawItem, templateItem)
		if (!itemResult.ok) return itemResult

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

		const issueNote = normalizeString(rawItem.issue_note ?? rawItem.note)
		if (itemResult.data.is_abnormal && !issueNote) {
			return { ok: false, msg: `请填写“${templateItem.label}”的问题说明` }
		}
		if (issueNote.length > 500) return { ok: false, msg: '问题说明最多 500 字' }

		normalized.push({
			item_code: templateItem.code,
			item_label_snapshot: templateItem.label,
			...itemResult.data,
			issue_note: issueNote,
			photo_file_ids: photoFileIds
		})
	}

	const expectedOrder = template.items.map((item) => item.code)
	normalized.sort((a, b) => expectedOrder.indexOf(a.item_code) - expectedOrder.indexOf(b.item_code))
	return { ok: true, data: normalized }
}

function normalizeEditablePayload(value, options = {}) {
	const data = value && typeof value === 'object' ? value : {}
	const locationText = normalizeString(data.location_text ?? data.locationText)
	if (!locationText) return { ok: false, msg: '巡检地点必填' }
	if (locationText.length > 200) return { ok: false, msg: '巡检地点最多 200 字' }

	const expectedTemplate = options.template || TEMPLATE
	const templateCode = normalizeString(data.template_code ?? data.templateCode) || expectedTemplate.code
	const templateVersion = Number(data.template_version ?? data.templateVersion ?? expectedTemplate.version)
	if (templateCode !== expectedTemplate.code || templateVersion !== expectedTemplate.version) {
		return { ok: false, msg: '巡检模板不匹配，请刷新页面后重新填写' }
	}

	const itemsResult = normalizeInspectionItems(data.items, expectedTemplate)
	if (!itemsResult.ok) return itemsResult

	const customerSignerName = normalizeString(data.customer_signer_name ?? data.customerSignerName)
	const customerSignatureFileId = normalizeCloudFileId(
		data.customer_signature_file_id ?? data.customerSignatureFileId
	)
	const inspectorName = normalizeString(data.inspector_name ?? data.inspectorName ?? options.defaultInspectorName)
	const inspectorSignatureFileId = normalizeCloudFileId(
		data.inspector_signature_file_id ?? data.inspectorSignatureFileId
	)
	if (!customerSignerName) return { ok: false, msg: '客户现场签名人姓名必填' }
	if (customerSignerName.length > 50) return { ok: false, msg: '客户现场签名人姓名最多 50 字' }
	if (!customerSignatureFileId) return { ok: false, msg: '请完成客户现场人员签名' }
	if (!inspectorName) return { ok: false, msg: '巡检员姓名必填' }
	if (inspectorName.length > 50) return { ok: false, msg: '巡检员姓名最多 50 字' }
	if (!inspectorSignatureFileId) return { ok: false, msg: '请完成巡检员签名' }

	const overallResult = itemsResult.data.some((item) => item.is_abnormal) ? 'abnormal' : 'normal'
	return {
		ok: true,
		data: {
			location_text: locationText,
			location_capture: normalizeLocationCapture(data.location_capture ?? data.locationCapture, options.now),
			template_code: expectedTemplate.code,
			template_version: expectedTemplate.version,
			template_title_snapshot: expectedTemplate.title,
			items: itemsResult.data,
			overall_result: overallResult,
			customer_signer_name: customerSignerName,
			customer_signature_file_id: customerSignatureFileId,
			inspector_name: inspectorName,
			inspector_signature_file_id: inspectorSignatureFileId
		}
	}
}

function normalizeClientSubmissionId(value) {
	const text = normalizeString(value)
	if (!/^[a-zA-Z0-9_-]{8,100}$/.test(text)) return ''
	return text
}

module.exports = {
	TEMPLATE,
	CURRENT_TEMPLATE,
	LEGACY_TEMPLATE,
	TEMPLATES,
	getTemplate,
	normalizeString,
	normalizeCloudFileId,
	normalizePhotoIds,
	normalizeLocationCapture,
	normalizeInspectionItems,
	normalizeEditablePayload,
	normalizeClientSubmissionId
}
