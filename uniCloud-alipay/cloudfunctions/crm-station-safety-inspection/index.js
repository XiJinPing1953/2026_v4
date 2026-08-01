'use strict'

let aclHelpers = null
try {
	aclHelpers = require('../common/pageAcl')
} catch (error) {
	console.warn('[crm-station-safety-inspection] fallback to local pageAcl helpers', error?.message)
	aclHelpers = require('./pageAclLocal')
}

const { ensureActionAcl, isSuperAdmin } = aclHelpers
const {
	STATION,
	TEMPLATE,
	getTemplate,
	normalizeString,
	isValidDateText,
	normalizeEditablePayload,
	normalizeClientSubmissionId
} = require('./inspectionPolicy')
const {
	normalizeRectificationPayload,
	normalizeVerificationPayload,
	buildHazardSnapshot,
	isHazardOverdue,
	resolveHazardSyncTransition
} = require('./hazardPolicy')
const { allocateInspectionNumber } = require('./inspectionNumber')

const db = uniCloud.database()
const dbCmd = db.command
const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const inspections = db.collection('crm_station_safety_inspections')
const hazards = db.collection('crm_station_safety_hazards')
const counters = db.collection('crm_station_safety_no_counters')

const HOME_PATH = '/pages/station-safety-inspection/home'
const FORM_PATH = '/pages/station-safety-inspection/form'
const HISTORY_PATH = '/pages/station-safety-inspection/history'
const DETAIL_PATH = '/pages/station-safety-inspection/detail'
const HAZARDS_PATH = '/pages/station-safety-inspection/hazards'

const PAGE_ACTION_RULES = {
	getTemplateV1: [{ pagePath: FORM_PATH, action: 'view' }, { pagePath: HOME_PATH, action: 'view' }],
	listV1: [{ pagePath: HISTORY_PATH, action: 'view' }],
	getV1: [{ pagePath: DETAIL_PATH, action: 'view' }],
	submitV1: [{ pagePath: FORM_PATH, action: 'create' }],
	updateV1: [{ pagePath: FORM_PATH, action: 'update' }],
	listHazardsV1: [{ pagePath: HAZARDS_PATH, action: 'view' }],
	getHazardV1: [{ pagePath: HAZARDS_PATH, action: 'view' }],
	submitRectificationV1: [{ pagePath: HAZARDS_PATH, action: 'update' }],
	verifyHazardV1: [{ pagePath: HAZARDS_PATH, action: 'update' }],
	updateHazardOutcomeV1: [{ pagePath: HAZARDS_PATH, action: 'update' }]
}

const SUPERADMIN_ONLY_ACTIONS = ['updateV1', 'verifyHazardV1', 'updateHazardOutcomeV1']

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function shanghaiDate(timestamp = Date.now()) {
	const value = Number(timestamp)
	const date = new Date((Number.isFinite(value) ? value : Date.now()) + 8 * 60 * 60 * 1000)
	return date.toISOString().slice(0, 10)
}

function dateRangeTimestamp(dateText, endExclusive = false) {
	if (!isValidDateText(dateText)) return null
	const value = Date.parse(`${dateText}T00:00:00+08:00`)
	return endExclusive ? value + 24 * 60 * 60 * 1000 : value
}

function pageParams(data = {}, maxPageSize = 50) {
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.page_size || 20) || 20, 1), maxPageSize)
	return { page, pageSize }
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isDuplicateKeyError(error) {
	const message = normalizeString(error?.message).toLowerCase()
	return message.includes('duplicate key') || message.includes('e11000')
}

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data || [])[0] || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (error) {
		console.error('[crm-station-safety-inspection] recordLog failed', action, error)
	}
}

function inspectionSummary(row = {}) {
	return {
		_id: row._id,
		inspection_no: row.inspection_no || '',
		station_id: row.station_id || STATION.id,
		station_name_snapshot: row.station_name_snapshot || STATION.name,
		inspection_at: Number(row.inspection_at || 0),
		inspection_date: row.inspection_date || '',
		inspector_name: row.inspector_name || '',
		overall_result: row.overall_result || '',
		abnormal_count: Number(row.abnormal_count || 0),
		photo_count: Number(row.photo_count || 0),
		remark: row.remark || '',
		updated_at: Number(row.updated_at || 0)
	}
}

function hazardSummary(row = {}) {
	return {
		_id: row._id,
		hazard_no: row.hazard_no || '',
		inspection_id: row.inspection_id || '',
		inspection_no: row.inspection_no || '',
		inspection_date: row.inspection_date || '',
		area_label_snapshot: row.area_label_snapshot || '',
		item_label_snapshot: row.item_label_snapshot || '',
		hazard_category: row.hazard_category || '',
		issue_note: row.issue_note || '',
		hazard_level: row.hazard_level || 'general',
		responsible_name: row.responsible_name || '',
		planned_complete_date: row.planned_complete_date || '',
		status: row.status || 'pending_rectification',
		is_overdue: isHazardOverdue(row, shanghaiDate()),
		rectified_at: Number(row.rectified_at || 0),
		verified_at: Number(row.verified_at || 0),
		updated_at: Number(row.updated_at || 0)
	}
}

function comparableSubmission(source = {}) {
	return {
		template_code: source.template_code || '',
		template_version: Number(source.template_version || 0),
		items: Array.isArray(source.items) ? source.items : [],
		overall_result: source.overall_result || '',
		inspector_name: source.inspector_name || '',
		remark: source.remark || ''
	}
}

async function getTemplateV1(data = {}) {
	const requestedCode = normalizeString(data.template_code ?? data.templateCode)
	const rawVersion = data.template_version ?? data.templateVersion
	const hasVersion = rawVersion !== undefined && rawVersion !== null && rawVersion !== ''
	if (Boolean(requestedCode) !== hasVersion) {
		return { code: 400, msg: '查询历史模板时必须同时提供模板代码和版本号' }
	}
	const template = requestedCode ? getTemplate(requestedCode, Number(rawVersion)) : TEMPLATE
	if (!template) return { code: 404, msg: '巡检模板不存在或已停止支持' }
	return {
		code: 0,
		data: {
			template_code: template.code,
			template_version: template.version,
			title: template.title,
			station: template.station,
			areas: template.areas,
			item_count: template.areas.reduce((sum, area) => sum + area.items.length, 0),
			is_current: template === TEMPLATE,
			server_now: Date.now()
		}
	}
}

function inspectionWhere(data = {}) {
	const conditions = []
	const result = normalizeString(data.result || data.overall_result)
	if (['normal', 'abnormal'].includes(result)) conditions.push({ overall_result: result })
	const startAt = dateRangeTimestamp(normalizeString(data.start_date ?? data.startDate))
	const endAt = dateRangeTimestamp(normalizeString(data.end_date ?? data.endDate), true)
	if (startAt != null) conditions.push({ inspection_at: dbCmd.gte(startAt) })
	if (endAt != null) conditions.push({ inspection_at: dbCmd.lt(endAt) })
	return conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)
}

async function listV1(user, data = {}) {
	void user
	const { page, pageSize } = pageParams(data)
	const where = inspectionWhere(data)
	const [rowsRes, totalRes] = await Promise.all([
		inspections
			.where(where)
			.field({ items: false })
			.orderBy('inspection_at', 'desc')
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get(),
		inspections.where(where).count()
	])
	const total = Number(totalRes.total || 0)
	return {
		code: 0,
		data: (rowsRes.data || []).map(inspectionSummary),
		paging: { page, pageSize, total, hasMore: page * pageSize < total }
	}
}

async function getInspection(id) {
	const inspectionId = normalizeString(id)
	if (!inspectionId) return null
	const res = await inspections.doc(inspectionId).get()
	return (res.data || [])[0] || null
}

async function getV1(user, data = {}) {
	const inspection = await getInspection(data._id || data.id)
	if (!inspection) return { code: 404, msg: '厂站巡检单不存在' }
	return {
		code: 0,
		data: {
			...inspection,
			can_update: isSuperAdmin(user)
		}
	}
}

async function syncHazardsForInspection(inspection, user, now = Date.now()) {
	const existingRes = await hazards.where({ inspection_id: inspection._id }).limit(100).get()
	const existingByCode = new Map((existingRes.data || []).map((row) => [row.item_code, row]))
	const activeCodes = new Set()
	const items = Array.isArray(inspection.items) ? inspection.items : []
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index]
		if (!item.is_abnormal) continue
		activeCodes.add(item.item_code)
		const snapshot = buildHazardSnapshot(inspection, item)
		const existing = existingByCode.get(item.item_code)
		if (existing) {
			const transition = resolveHazardSyncTransition(existing.status, true)
			const reopening = transition.action === 'reopen'
			await hazards.doc(existing._id).update({
				...snapshot,
				status: transition.status,
				...(reopening
					? {
							status: 'pending_rectification',
							rectification_note: '',
							rectification_photo_file_ids: [],
							rectified_at: null,
							rectified_by: '',
							rectified_by_name: '',
							verification_result: '',
							verification_note: '',
							verification_photo_file_ids: [],
							verified_at: null,
							verified_by: '',
							verified_by_name: '',
							cancelled_at: null,
							cancelled_by: '',
							cancelled_by_name: ''
						}
					: {}),
				updated_at: now
			})
			continue
		}
		const hazardDoc = {
			...snapshot,
			hazard_no: `${inspection.inspection_no}-${String(index + 1).padStart(2, '0')}`,
			status: 'pending_rectification',
			rectification_note: '',
			rectification_photo_file_ids: [],
			rectified_at: null,
			rectified_by: '',
			rectified_by_name: '',
			verification_result: '',
			verification_note: '',
			verification_photo_file_ids: [],
			verified_at: null,
			verified_by: '',
			verified_by_name: '',
			cancelled_at: null,
			cancelled_by: '',
			cancelled_by_name: '',
			created_at: now,
			created_by: normalizeString(user?._id),
			created_by_name: normalizeString(user?.username),
			updated_at: now
		}
		try {
			await hazards.add(hazardDoc)
		} catch (error) {
			if (!isDuplicateKeyError(error)) throw error
			const retryRes = await hazards
				.where({ inspection_id: inspection._id, item_code: item.item_code })
				.limit(1)
				.get()
			const retry = (retryRes.data || [])[0]
			if (!retry) throw error
			await hazards.doc(retry._id).update({ ...snapshot, status: 'pending_rectification', updated_at: now })
		}
	}

	for (const existing of existingByCode.values()) {
		if (activeCodes.has(existing.item_code)) continue
		const transition = resolveHazardSyncTransition(existing.status, false)
		if (transition.action === 'none') continue
		await hazards.doc(existing._id).update({
			status: transition.status,
			cancelled_at: now,
			cancelled_by: normalizeString(user?._id),
			cancelled_by_name: normalizeString(user?.nickname || user?.username),
			updated_at: now
		})
	}
}

async function submitV1(user, data = {}, requestId = '') {
	const clientSubmissionId = normalizeClientSubmissionId(data.client_submission_id ?? data.clientSubmissionId)
	if (!clientSubmissionId) return { code: 400, msg: '提交标识无效，请刷新页面后重试' }
	const inspectorName = normalizeString(user?.nickname || user?.username)
	const normalized = normalizeEditablePayload(data, {
		template: TEMPLATE,
		defaultInspectorName: inspectorName
	})
	if (!normalized.ok) return { code: 400, msg: normalized.msg }

	const existingRes = await inspections.where({ client_submission_id: clientSubmissionId }).limit(1).get()
	const existing = (existingRes.data || [])[0]
	if (existing) {
		if (JSON.stringify(comparableSubmission(existing)) !== JSON.stringify(comparableSubmission(normalized.data))) {
			return { code: 409, msg: '该提交标识已生成其他巡检单，请打开原单核对', data: { existing_id: existing._id } }
		}
		return { code: 0, msg: '巡检单已提交', data: { _id: existing._id, inspection_no: existing.inspection_no, duplicate: true } }
	}

	const now = Date.now()
	const inspectionDate = shanghaiDate(now)
	const numberFields = await allocateInspectionNumber({ counters, dbCmd, dateKey: inspectionDate, now })
	const abnormalCount = normalized.data.items.filter((entry) => entry.is_abnormal).length
	const photoCount = normalized.data.items.reduce((sum, entry) => sum + entry.photo_file_ids.length, 0)
	const doc = {
		client_submission_id: clientSubmissionId,
		...normalized.data,
		inspection_at: now,
		inspection_date: inspectionDate,
		...numberFields,
		inspector_name: inspectorName,
		inspector_user_id: normalizeString(user?._id),
		inspector_username_snapshot: normalizeString(user?.username),
		abnormal_count: abnormalCount,
		photo_count: photoCount,
		status: 'submitted',
		source: 'h5',
		created_at: now,
		created_by: normalizeString(user?._id),
		created_by_name: normalizeString(user?.username),
		updated_at: now,
		last_edited_at: null,
		last_edited_by: '',
		last_edited_by_name: ''
	}
	let inspectionId = ''
	try {
		const addRes = await inspections.add(doc)
		inspectionId = addRes.id
		const saved = { _id: inspectionId, ...doc }
		await syncHazardsForInspection(saved, user, now)
		await recordLog(user, 'station_safety_inspection_submit_v1', {
			id: inspectionId,
			inspection_no: doc.inspection_no,
			overall_result: doc.overall_result,
			abnormal_count: abnormalCount,
			photo_count: photoCount
		}, requestId)
		return { code: 0, msg: '厂站巡检单提交成功', data: { _id: inspectionId, inspection_no: doc.inspection_no, duplicate: false } }
	} catch (error) {
		if (inspectionId) {
			try {
				await hazards.where({ inspection_id: inspectionId }).remove()
				await inspections.doc(inspectionId).remove()
			} catch (_) {
				// Best-effort compensation; unique submission id keeps retries safe.
			}
		}
		if (isDuplicateKeyError(error)) {
			const retryRes = await inspections.where({ client_submission_id: clientSubmissionId }).limit(1).get()
			const retry = (retryRes.data || [])[0]
			if (retry) return { code: 0, msg: '巡检单已提交', data: { _id: retry._id, inspection_no: retry.inspection_no, duplicate: true } }
		}
		console.error('[crm-station-safety-inspection] submitV1 failed', error)
		return { code: 500, msg: '厂站巡检单提交失败' }
	}
}

async function updateV1(user, data = {}, requestId = '') {
	const inspectionId = normalizeString(data._id || data.id)
	if (!inspectionId) return { code: 400, msg: '缺少巡检单 ID' }
	const current = await getInspection(inspectionId)
	if (!current) return { code: 404, msg: '厂站巡检单不存在' }
	const template = getTemplate(current.template_code, current.template_version)
	if (!template) return { code: 409, msg: '巡检模板无法识别，该记录仅支持查看' }
	const normalized = normalizeEditablePayload(data, {
		template,
		defaultInspectorName: current.inspector_name || user?.nickname || user?.username
	})
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	const requestedAt = Number(data.inspection_at ?? data.inspectionAt)
	const inspectionAt = Number.isFinite(requestedAt) && requestedAt > 0 ? requestedAt : current.inspection_at
	const now = Date.now()
	const abnormalCount = normalized.data.items.filter((entry) => entry.is_abnormal).length
	const photoCount = normalized.data.items.reduce((sum, entry) => sum + entry.photo_file_ids.length, 0)
	const patch = {
		...normalized.data,
		inspection_at: inspectionAt,
		inspection_date: shanghaiDate(inspectionAt),
		abnormal_count: abnormalCount,
		photo_count: photoCount,
		last_edited_at: now,
		last_edited_by: normalizeString(user?._id),
		last_edited_by_name: normalizeString(user?.nickname || user?.username),
		updated_at: now
	}
	await inspections.doc(inspectionId).update(patch)
	await syncHazardsForInspection({ ...current, ...patch }, user, now)
	await recordLog(user, 'station_safety_inspection_update_v1', {
		id: inspectionId,
		inspection_no: current.inspection_no,
		overall_result: patch.overall_result,
		abnormal_count: abnormalCount
	}, requestId)
	return { code: 0, msg: '巡检单已修改', data: { _id: inspectionId } }
}

function hazardWhere(data = {}) {
	const conditions = []
	const status = normalizeString(data.status)
	if (!status || status === 'open') conditions.push({ status: dbCmd.in(['pending_rectification', 'pending_verification']) })
	else if (status !== 'all') conditions.push({ status })
	const level = normalizeString(data.hazard_level ?? data.hazardLevel)
	if (['general', 'major'].includes(level)) conditions.push({ hazard_level: level })
	const keyword = normalizeString(data.keyword)
	if (keyword) {
		const regexp = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([
			{ inspection_no: regexp },
			{ hazard_no: regexp },
			{ issue_note: regexp },
			{ area_label_snapshot: regexp },
			{ item_label_snapshot: regexp },
			{ responsible_name: regexp }
		]))
	}
	return conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)
}

async function listHazardsV1(user, data = {}) {
	void user
	const { page, pageSize } = pageParams(data)
	const where = hazardWhere(data)
	const [rowsRes, totalRes] = await Promise.all([
		hazards.where(where).orderBy('updated_at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
		hazards.where(where).count()
	])
	const total = Number(totalRes.total || 0)
	return {
		code: 0,
		data: (rowsRes.data || []).map(hazardSummary),
		paging: { page, pageSize, total, hasMore: page * pageSize < total }
	}
}

async function getHazard(id) {
	const hazardId = normalizeString(id)
	if (!hazardId) return null
	const res = await hazards.doc(hazardId).get()
	return (res.data || [])[0] || null
}

async function getHazardV1(user, data = {}) {
	const hazard = await getHazard(data._id || data.id)
	if (!hazard) return { code: 404, msg: '隐患不存在' }
	return {
		code: 0,
		data: {
			...hazard,
			is_overdue: isHazardOverdue(hazard, shanghaiDate()),
			can_verify: isSuperAdmin(user),
			can_admin_edit: isSuperAdmin(user)
		}
	}
}

function hazardMediaSet(hazard = {}, excludedField = '') {
	const values = []
	for (const field of [
		'inspection_photo_file_ids',
		'rectification_photo_file_ids',
		'verification_photo_file_ids'
	]) {
		if (field === excludedField) continue
		values.push(...(Array.isArray(hazard[field]) ? hazard[field] : []))
	}
	values.push(hazard.responsible_signature_file_id)
	return new Set(values.map(normalizeString).filter((fileId) => fileId.startsWith('cloud://')))
}

function containsExistingMedia(fileIds, hazard, excludedField = '') {
	const existing = hazardMediaSet(hazard, excludedField)
	return (Array.isArray(fileIds) ? fileIds : []).some((fileId) => existing.has(normalizeString(fileId)))
}

async function submitRectificationV1(user, data = {}, requestId = '') {
	const hazardId = normalizeString(data._id || data.id || data.hazard_id || data.hazardId)
	const hazard = await getHazard(hazardId)
	if (!hazard) return { code: 404, msg: '隐患不存在' }
	if (hazard.status !== 'pending_rectification') return { code: 409, msg: '当前隐患不在待整改状态' }
	const normalized = normalizeRectificationPayload(data)
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	if (containsExistingMedia(normalized.data.rectification_photo_file_ids, hazard, 'rectification_photo_file_ids')) {
		return { code: 400, msg: '整改照片不能重复使用巡检、签名或验证阶段的媒体文件' }
	}
	const now = Date.now()
	await hazards.doc(hazardId).update({
		...normalized.data,
		status: 'pending_verification',
		rectified_at: now,
		rectified_by: normalizeString(user?._id),
		rectified_by_name: normalizeString(user?.nickname || user?.username),
		verification_result: '',
		verification_note: '',
		verification_photo_file_ids: [],
		verified_at: null,
		verified_by: '',
		verified_by_name: '',
		updated_at: now
	})
	await recordLog(user, 'station_safety_hazard_rectify_v1', { id: hazardId, hazard_no: hazard.hazard_no }, requestId)
	return { code: 0, msg: '整改结果已提交，等待验证' }
}

async function verifyHazardV1(user, data = {}, requestId = '') {
	const hazardId = normalizeString(data._id || data.id || data.hazard_id || data.hazardId)
	const hazard = await getHazard(hazardId)
	if (!hazard) return { code: 404, msg: '隐患不存在' }
	if (hazard.status !== 'pending_verification') return { code: 409, msg: '当前隐患不在待验证状态' }
	const normalized = normalizeVerificationPayload(data)
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	if (containsExistingMedia(normalized.data.verification_photo_file_ids, hazard, 'verification_photo_file_ids')) {
		return { code: 400, msg: '验证照片不能重复使用巡检、签名或整改阶段的媒体文件' }
	}
	const now = Date.now()
	await hazards.doc(hazardId).update({
		...normalized.data,
		verified_at: now,
		verified_by: normalizeString(user?._id),
		verified_by_name: normalizeString(user?.nickname || user?.username),
		updated_at: now
	})
	await recordLog(user, 'station_safety_hazard_verify_v1', {
		id: hazardId,
		hazard_no: hazard.hazard_no,
		result: normalized.data.verification_result
	}, requestId)
	return { code: 0, msg: normalized.data.status === 'closed' ? '隐患已验证关闭' : '验证未通过，已退回整改' }
}

async function updateHazardOutcomeV1(user, data = {}, requestId = '') {
	const hazardId = normalizeString(data._id || data.id || data.hazard_id || data.hazardId)
	const hazard = await getHazard(hazardId)
	if (!hazard) return { code: 404, msg: '隐患不存在' }
	if (hazard.status === 'cancelled') return { code: 409, msg: '已取消隐患请先通过原巡检单重新标记为异常' }
	if (!Number(hazard.rectified_at || 0)) return { code: 409, msg: '该隐患尚未提交整改结果，暂无可修订的闭环内容' }

	const rectification = normalizeRectificationPayload(data)
	if (!rectification.ok) return { code: 400, msg: rectification.msg }
	if (containsExistingMedia(rectification.data.rectification_photo_file_ids, hazard, 'rectification_photo_file_ids')) {
		return { code: 400, msg: '整改照片不能重复使用巡检、签名或验证阶段的媒体文件' }
	}
	const patch = { ...rectification.data, status: 'pending_verification', updated_at: Date.now() }
	if (Number(hazard.verified_at || 0)) {
		const verification = normalizeVerificationPayload(data)
		if (!verification.ok) return { code: 400, msg: verification.msg }
		if (containsExistingMedia(verification.data.verification_photo_file_ids, { ...hazard, ...rectification.data }, 'verification_photo_file_ids')) {
			return { code: 400, msg: '验证照片不能重复使用巡检、签名或整改阶段的媒体文件' }
		}
		Object.assign(patch, verification.data)
	}
	await hazards.doc(hazardId).update(patch)
	await recordLog(user, 'station_safety_hazard_admin_update_v1', {
		id: hazardId,
		hazard_no: hazard.hazard_no,
		status: patch.status,
		rectified_at: hazard.rectified_at,
		verified_at: hazard.verified_at
	}, requestId)
	return { code: 0, msg: '隐患闭环内容已修改' }
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event || {}
	const requestId = normalizeString(event?.request_id || event?.requestId || context?.requestId || context?.request_id) || generateRequestId()
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
		recordLog,
		requestId,
		cloudFunction: 'crm-station-safety-inspection'
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }

	try {
		if (action === 'getTemplateV1') return getTemplateV1(data)
		if (action === 'listV1') return listV1(user, data)
		if (action === 'getV1') return getV1(user, data)
		if (action === 'submitV1') return submitV1(user, data, requestId)
		if (action === 'updateV1') return updateV1(user, data, requestId)
		if (action === 'listHazardsV1') return listHazardsV1(user, data)
		if (action === 'getHazardV1') return getHazardV1(user, data)
		if (action === 'submitRectificationV1') return submitRectificationV1(user, data, requestId)
		if (action === 'verifyHazardV1') return verifyHazardV1(user, data, requestId)
		if (action === 'updateHazardOutcomeV1') return updateHazardOutcomeV1(user, data, requestId)
		return { code: 400, msg: '未知 action' }
	} catch (error) {
		console.error('[crm-station-safety-inspection] main failed', action, error)
		return { code: 500, msg: error?.message || '厂站安全巡检服务异常' }
	}
}
