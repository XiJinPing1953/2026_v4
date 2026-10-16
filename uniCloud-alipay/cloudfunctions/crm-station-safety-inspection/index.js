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
	normalizeIncidentFacts,
	normalizeClientSubmissionId
} = require('./inspectionPolicy')
const {
	normalizeRectificationPayload,
	normalizeVerificationPayload,
	buildHazardSnapshot,
	buildHazardObservation,
	buildSourceRevision,
	validateHazardLink,
	isHazardOverdue
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
	updateHazardOutcomeV1: [{ pagePath: HAZARDS_PATH, action: 'update' }],
	recordHazardFactsV1: [{ pagePath: HAZARDS_PATH, action: 'update' }]
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
		started_at: Number(row.started_at || 0), ended_at: Number(row.ended_at || 0),
		weather: row.weather || '', revision: Number(row.revision || 1),
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
		category_code: row.category_code || '', recurrence_of: row.recurrence_of || '',
		observation_count: (row.observations || []).length,
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
		remark: source.remark || '',
		...(Number(source.template_version) >= 3 ? { started_at: source.started_at, ended_at: source.ended_at, weather: source.weather } : {})
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
			classification_version: template.classification_version || 0,
			categories: template.categories || [],
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
	const references = [inspection, ...(inspection.source_revisions || []).map((entry) => entry.snapshot || {})]
	const linkedIds = Array.from(new Set(references.flatMap((entry) => (entry.items || []).map((item) => item.linked_hazard_id).filter(Boolean))))
	const related = await hazards.where(linkedIds.length ? dbCmd.or([{ inspection_id: inspection._id }, { _id: dbCmd.in(linkedIds) }]) : { inspection_id: inspection._id }).limit(100).get()
	return {
		code: 0,
		data: {
			...inspection,
			related_hazards: (related.data || []).map(hazardSummary),
			can_update: isSuperAdmin(user)
		}
	}
}

async function transactionDoc(collection, id) {
	const result = await collection.doc(id).get()
	const data = result?.data
	const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data
	return row && typeof row === 'object' && row._id === id ? row : null
}

function conflict(message) { return Object.assign(new Error(message), { code: 409 }) }

async function ordinaryDoc(collection, id) {
	if (!id) return null
	// Alipay may throw for a missing doc. A normal fixed-ID query proves absence
	// without treating an unrelated database error as an empty result.
	const result = await collection.where({ _id: id }).limit(1).get()
	return Array.isArray(result.data) ? result.data[0] || null : null
}

async function prepareHazardScope(inspectionId, items, previousItems = []) {
	const ownedIds = []
	if (inspectionId) {
		const query = hazards.where({ inspection_id: inspectionId })
		const before = Number((await query.count()).total)
		if (!Number.isSafeInteger(before) || before < 0) throw new Error('原隐患范围读取不完整')
		for (let offset = 0; offset < before; offset += 100) {
			const result = await hazards.where({ inspection_id: inspectionId }).orderBy('_id', 'asc').skip(offset).limit(100).get()
			if (!Array.isArray(result.data)) throw new Error('原隐患范围读取不完整')
			ownedIds.push(...result.data.map((row) => row._id))
		}
		const after = Number((await hazards.where({ inspection_id: inspectionId }).count()).total)
		if (before !== after || ownedIds.length !== before || new Set(ownedIds).size !== before || ownedIds.some((id) => !id)) throw conflict('原隐患范围已变化，请重试')
	}
	const referenceIds = [...new Set([...items, ...previousItems].flatMap((item) => [item.linked_hazard_id, item.recurrence_of]).filter(Boolean))]
	for (let offset = 0; offset < referenceIds.length; offset += 100) {
		const ids = referenceIds.slice(offset, offset + 100)
		const result = await hazards.where({ _id: dbCmd.in(ids) }).limit(100).get()
		if (!Array.isArray(result.data) || ids.some((id) => !result.data.some((row) => row._id === id))) throw conflict('关联隐患不存在或已变化，请重新选择')
	}
	return { ownedIds, referenceIds }
}

async function appendObservation(collection, hazard, observation, user, now) {
	if ((hazard.observations || []).some((entry) => entry.observation_key === observation.observation_key)) return
	const patch = { observations: dbCmd.push([observation]), updated_at: now }
	const isNewObservation = Number(observation.source_revision || 1) === 1
	if (isNewObservation && observation.report && Number(observation.report.reported_at) >= Number(hazard.report?.reported_at || 0) && JSON.stringify(observation.report) !== JSON.stringify(hazard.report)) patch.report = observation.report
	const onsite = observation.on_site_rectification
	if (isNewObservation && onsite && hazard.status !== 'closed' && Number(onsite.completed_at) >= Math.max(Number(hazard.on_site_rectification?.completed_at || 0), Number(hazard.rectified_at || 0)) && JSON.stringify(onsite) !== JSON.stringify(hazard.on_site_rectification)) {
		Object.assign(patch, {
			on_site_rectification: onsite, status: 'pending_verification', rectification_note: onsite.note,
			rectification_photo_file_ids: onsite.photo_file_ids, rectified_at: onsite.completed_at,
			rectified_by: normalizeString(user?._id), rectified_by_name: normalizeString(user?.nickname || user?.username)
		})
	}
	// Standalone fact registration may exist only on the current hazard. Preserve
	// that complete version before a later observation updates its displayed facts.
	const revisionEntry = patch.report || patch.on_site_rectification ? buildSourceRevision(hazard, '新观察补充实际上报或当场整改事实', user, now) : null
	if (revisionEntry) {
		patch.revision = Number(hazard.revision || 1) + 1
		patch.source_revisions = dbCmd.push([revisionEntry])
	}
	await collection.doc(hazard._id).update(patch)
	Object.assign(hazard, { ...patch, observations: [...(hazard.observations || []), observation], ...(revisionEntry ? { source_revisions: [...(hazard.source_revisions || []), revisionEntry] } : {}) })
}

function historicalItems(record) {
	return [record, ...(record?.source_revisions || []).slice().reverse().map((entry) => entry.snapshot)].flatMap((entry) => entry?.items || [])
}

async function syncHazardsForInspection(inspection, user, now, transaction, scope, previous = null) {
	const collection = transaction.collection('crm_station_safety_hazards')
	const documents = new Map()
	for (const id of new Set([...scope.ownedIds, ...scope.referenceIds])) {
		const row = await transactionDoc(collection, id)
		if (!row) throw conflict('关联隐患已变化，请重新加载')
		documents.set(id, row)
	}
	const existingByCode = new Map()
	for (const id of scope.ownedIds) {
		const row = documents.get(id)
		if (row.inspection_id !== inspection._id || existingByCode.has(row.item_code)) throw conflict('原隐患归属不一致，请先核对')
		existingByCode.set(row.item_code, row)
	}
	for (let index = 0; index < inspection.items.length; index += 1) {
		const item = inspection.items[index]
		const existing = existingByCode.get(item.item_code)
		const observation = buildHazardObservation(inspection, item, user, now)
		const previousItem = historicalItems(previous).find((entry) => entry.item_code === item.item_code && entry.linked_hazard_id)
		if (previousItem?.linked_hazard_id && !item.is_abnormal) {
			const linked = documents.get(previousItem.linked_hazard_id)
			if (!linked || linked.station_id !== inspection.station_id) throw conflict('原关联隐患归属已变化，请先核对')
			await appendObservation(collection, linked, observation, user, now)
			continue
		}
		if (previousItem?.linked_hazard_id && previousItem.linked_hazard_id !== item.linked_hazard_id) throw conflict('已关联隐患不能通过原单修改改挂其他隐患；请保留原关联并说明更正')
		if (item.is_abnormal && item.linked_hazard_id) {
			if (existing && existing._id !== item.linked_hazard_id) throw conflict('此项目已有独立隐患，不能通过修订改挂另一隐患；原问题须保留')
			const linked = documents.get(item.linked_hazard_id)
			const valid = previousItem?.linked_hazard_id === item.linked_hazard_id
				? { ok: Boolean(linked && linked.station_id === inspection.station_id), msg: '原关联隐患归属已变化，请先核对' }
				: validateHazardLink(linked, inspection)
			if (!valid.ok) throw conflict(valid.msg)
			await appendObservation(collection, linked, observation, user, now)
			continue
		}
		if (existing) {
			if (item.is_abnormal && normalizeString(item.recurrence_of) !== normalizeString(existing.recurrence_of)) throw conflict('已登记隐患的复发来源不能通过原巡检修订更换')
			// A correction is evidence, not rectification or cancellation of the original hazard.
			await appendObservation(collection, existing, observation, user, now)
			if (item.is_abnormal && existing.status === 'cancelled') await collection.doc(existing._id).update({ status: 'pending_rectification', updated_at: now })
			continue
		}
		if (!item.is_abnormal) continue
		if (item.recurrence_of) {
			const previous = documents.get(item.recurrence_of)
			const valid = validateHazardLink(previous, inspection, true)
			if (!valid.ok) throw conflict(valid.msg)
		}
		const onsite = item.on_site_rectification
		await collection.add({
			...buildHazardSnapshot(inspection, item),
			hazard_no: `${inspection.inspection_no}-${String(index + 1).padStart(2, '0')}`,
			source_type: 'station_inspection', source_id: inspection._id, source_item_code: item.item_code,
			first_discovered_at: inspection.ended_at || inspection.inspection_at, first_discovered_date: inspection.inspection_date,
			recurrence_of: item.recurrence_of || '', observations: [observation], report: item.report || null,
			on_site_rectification: onsite || null,
			status: onsite ? 'pending_verification' : 'pending_rectification',
			rectification_note: onsite?.note || '', rectification_photo_file_ids: onsite?.photo_file_ids || [],
			rectified_at: onsite?.completed_at || null,
			rectified_by: onsite ? normalizeString(user?._id) : '',
			rectified_by_name: onsite ? normalizeString(user?.nickname || user?.username) : '',
			verification_result: '', verification_note: '', verification_photo_file_ids: [],
			verified_at: null, verified_by: '', verified_by_name: '',
			cancelled_at: null, cancelled_by: '', cancelled_by_name: '',
			revision: 1, source_revisions: [],
			created_at: now, created_by: normalizeString(user?._id), created_by_name: normalizeString(user?.username), updated_at: now
		})
	}
}

function savedResponse(row, duplicate = false) {
	return { code: 0, msg: '厂站巡检单已保存', data: { _id: row._id, inspection_no: row.inspection_no, inspection_date: row.inspection_date, revision: Number(row.revision || 1), duplicate } }
}

async function submitV1(user, data = {}, requestId = '') {
	const clientSubmissionId = normalizeClientSubmissionId(data.client_submission_id ?? data.clientSubmissionId)
	if (!clientSubmissionId) return { code: 400, msg: '提交标识无效，请刷新页面后重试' }
	const inspectorName = normalizeString(user?.nickname || user?.username)
	const now = Date.now()
	const normalized = normalizeEditablePayload({ ...data, inspector_name: inspectorName }, { template: TEMPLATE, defaultInspectorName: inspectorName, now })
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	const existingRes = await inspections.where({ client_submission_id: clientSubmissionId }).limit(1).get()
	const existing = (existingRes.data || [])[0]
	if (existing) {
		if (JSON.stringify(comparableSubmission(existing)) !== JSON.stringify(comparableSubmission(normalized.data))) return { code: 409, msg: '该提交标识已生成其他巡检单，请打开原单核对', data: { existing_id: existing._id } }
		return savedResponse(existing, true)
	}
	const hazardScope = await prepareHazardScope('', normalized.data.items)
	const inspectionDate = shanghaiDate(normalized.data.ended_at)
	const numberFields = await allocateInspectionNumber({ counters, dbCmd, dateKey: inspectionDate, now })
	const doc = {
		client_submission_id: clientSubmissionId, ...normalized.data, ...numberFields,
		inspection_at: normalized.data.ended_at, inspection_date: inspectionDate, submitted_at: now,
		inspector_name: inspectorName, inspector_user_id: normalizeString(user?._id), inspector_username_snapshot: normalizeString(user?.username),
		abnormal_count: normalized.data.items.filter((entry) => entry.is_abnormal).length,
		photo_count: normalized.data.items.reduce((sum, entry) => sum + entry.photo_file_ids.length, 0),
		revision: 1, source_revisions: [], revision_reason: '', status: 'submitted', source: 'h5',
		created_at: now, created_by: normalizeString(user?._id), created_by_name: normalizeString(user?.username), updated_at: now,
		last_edited_at: null, last_edited_by: '', last_edited_by_name: ''
	}
	const transaction = await db.startTransaction()
	let saved
	try {
		const txInspections = transaction.collection('crm_station_safety_inspections')
		const result = await txInspections.add(doc)
		saved = { _id: result.id, ...doc }
		await syncHazardsForInspection(saved, user, now, transaction, hazardScope)
		await transaction.commit()
	} catch (error) {
		try { await transaction.rollback() } catch (_) {}
		if (isDuplicateKeyError(error)) {
			const result = await inspections.where({ client_submission_id: clientSubmissionId }).limit(1).get()
			const row = (result.data || [])[0]
			if (row && JSON.stringify(comparableSubmission(row)) === JSON.stringify(comparableSubmission(normalized.data))) return savedResponse(row, true)
		}
		return { code: error.code === 409 ? 409 : 500, msg: error.code === 409 ? error.message : '巡检保存未完成，请重试；原提交标识会防止重复' }
	}
	await recordLog(user, 'station_safety_inspection_submit_v1', { id: saved._id, inspection_no: saved.inspection_no, abnormal_count: saved.abnormal_count }, requestId)
	return savedResponse(saved)
}

async function updateV1(user, data = {}, requestId = '') {
	const inspectionId = normalizeString(data._id || data.id)
	const reason = normalizeString(data.revision_reason)
	if (!inspectionId) return { code: 400, msg: '缺少巡检单 ID' }
	if (!reason || reason.length > 1000) return { code: 400, msg: '修改须填写原因（最多1000字），原记录会保留' }
	const initial = await ordinaryDoc(inspections, inspectionId)
	if (!initial) return { code: 404, msg: '厂站巡检单不存在' }
	const hazardScope = await prepareHazardScope(inspectionId, Array.isArray(data.items) ? data.items : [], historicalItems(initial))
	const transaction = await db.startTransaction()
	let saved
	try {
		const collection = transaction.collection('crm_station_safety_inspections')
		const current = await transactionDoc(collection, inspectionId)
		if (!current) throw conflict('厂站巡检单不存在')
		if (Number(data.expected_revision) !== Number(current.revision || 1)) throw conflict('记录已变化，请重新加载后修改')
		const template = getTemplate(current.template_code, current.template_version)
		if (!template) throw conflict('历史模板无法识别，仅支持查看')
		const normalized = normalizeEditablePayload(data, { template, defaultInspectorName: current.inspector_name })
		if (!normalized.ok) throw conflict(normalized.msg)
		const now = Date.now()
		if (!template.classification_version && normalized.data.ended_at && shanghaiDate(normalized.data.ended_at) !== current.inspection_date) throw conflict('历史巡检补录结束时间须属于原业务日期，不能通过补证移日')
		const inspectionAt = normalized.data.ended_at || Number(data.inspection_at || current.inspection_at)
		if (!Number.isFinite(inspectionAt) || inspectionAt <= 0 || inspectionAt > now + 60000) throw conflict('巡检时间无效')
		const patch = {
			...normalized.data, inspection_at: inspectionAt, inspection_date: shanghaiDate(inspectionAt),
			abnormal_count: normalized.data.items.filter((item) => item.is_abnormal).length,
			photo_count: normalized.data.items.reduce((sum, item) => sum + item.photo_file_ids.length, 0),
			revision: Number(current.revision || 1) + 1, revision_reason: reason,
			source_revisions: [...(current.source_revisions || []), buildSourceRevision(current, reason, user, now)],
			last_edited_at: now, last_edited_by: normalizeString(user?._id), last_edited_by_name: normalizeString(user?.nickname || user?.username), updated_at: now
		}
		await collection.doc(inspectionId).update(patch)
		saved = { ...current, ...patch }
		await syncHazardsForInspection(saved, user, now, transaction, hazardScope, current)
		await transaction.commit()
	} catch (error) {
		try { await transaction.rollback() } catch (_) {}
		return { code: error.code === 409 ? 409 : 500, msg: error.message || '修改失败，请重试' }
	}
	await recordLog(user, 'station_safety_inspection_update_v1', { id: inspectionId, revision: saved.revision, reason }, requestId)
	return savedResponse(saved)
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
			can_admin_edit: isSuperAdmin(user),
			revision: Number(hazard.revision || 1)
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

async function saveHazardRevision(hazard, patch, reason, user) {
	const revisionWhere = hazard.revision == null ? { revision: dbCmd.exists(false) } : { revision: hazard.revision }
	const result = await hazards.where({ _id: hazard._id, ...revisionWhere, updated_at: hazard.updated_at }).update({
		...patch, revision: Number(hazard.revision || 1) + 1,
		source_revisions: dbCmd.push([buildSourceRevision(hazard, reason, user)])
	})
	return Number(result.updated || 0) === 1
}

async function submitRectificationV1(user, data = {}, requestId = '') {
	const hazardId = normalizeString(data._id || data.id || data.hazard_id || data.hazardId)
	const hazard = await getHazard(hazardId)
	if (!hazard) return { code: 404, msg: '隐患不存在' }
	if (hazard.status !== 'pending_rectification') return { code: 409, msg: '当前隐患不在待整改状态' }
	if (data.expected_revision != null && Number(data.expected_revision) !== Number(hazard.revision || 1)) return { code: 409, msg: '隐患记录已变化，请重新加载' }
	const normalized = normalizeRectificationPayload(data)
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	if (containsExistingMedia(normalized.data.rectification_photo_file_ids, hazard, 'rectification_photo_file_ids')) {
		return { code: 400, msg: '整改照片不能重复使用巡检、签名或验证阶段的媒体文件' }
	}
	const now = Date.now()
	const saved = await saveHazardRevision(hazard, {
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
	}, '提交整改结果', user)
	if (!saved) return { code: 409, msg: '隐患记录已变化，请重新加载' }
	await recordLog(user, 'station_safety_hazard_rectify_v1', { id: hazardId, hazard_no: hazard.hazard_no }, requestId)
	return { code: 0, msg: '整改结果已提交，等待验证' }
}

async function verifyHazardV1(user, data = {}, requestId = '') {
	const hazardId = normalizeString(data._id || data.id || data.hazard_id || data.hazardId)
	const hazard = await getHazard(hazardId)
	if (!hazard) return { code: 404, msg: '隐患不存在' }
	if (hazard.status !== 'pending_verification') return { code: 409, msg: '当前隐患不在待验证状态' }
	if (data.expected_revision != null && Number(data.expected_revision) !== Number(hazard.revision || 1)) return { code: 409, msg: '隐患记录已变化，请重新加载' }
	const normalized = normalizeVerificationPayload(data)
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	if (containsExistingMedia(normalized.data.verification_photo_file_ids, hazard, 'verification_photo_file_ids')) {
		return { code: 400, msg: '验证照片不能重复使用巡检、签名或整改阶段的媒体文件' }
	}
	const now = Date.now()
	const saved = await saveHazardRevision(hazard, {
		...normalized.data,
		verified_at: now,
		verified_by: normalizeString(user?._id),
		verified_by_name: normalizeString(user?.nickname || user?.username),
		updated_at: now
	}, normalized.data.status === 'closed' ? '验证通过销号' : '验证退回整改', user)
	if (!saved) return { code: 409, msg: '隐患记录已变化，请重新加载' }
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
	const reason = normalizeString(data.revision_reason)
	if (!reason || reason.length > 1000) return { code: 400, msg: '修订闭环内容须填写原因（最多1000字）' }
	if (Number(data.expected_revision) !== Number(hazard.revision || 1)) return { code: 409, msg: '隐患记录已变化，请重新加载' }
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
	patch.revision = Number(hazard.revision || 1) + 1
	patch.source_revisions = dbCmd.push([buildSourceRevision(hazard, reason, user)])
	const revisionWhere = hazard.revision == null ? { revision: dbCmd.exists(false) } : { revision: hazard.revision }
	const changed = await hazards.where({ _id: hazardId, ...revisionWhere, updated_at: hazard.updated_at }).update(patch)
	if (!Number(changed.updated)) return { code: 409, msg: '隐患记录已变化，请重新加载' }
	await recordLog(user, 'station_safety_hazard_admin_update_v1', {
		id: hazardId,
		hazard_no: hazard.hazard_no,
		status: patch.status,
		rectified_at: hazard.rectified_at,
		verified_at: hazard.verified_at
	}, requestId)
	return { code: 0, msg: '隐患闭环内容已修改' }
}

async function recordHazardFactsV1(user, data = {}, requestId = '') {
	const id = normalizeString(data._id)
	const normalized = normalizeIncidentFacts(data)
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	if (!normalized.data.report && !normalized.data.on_site_rectification) return { code: 400, msg: '请填写实际上报或当场整改记录' }
	if (!await ordinaryDoc(hazards, id)) return { code: 404, msg: '隐患不存在' }
	const transaction = await db.startTransaction()
	try {
		const collection = transaction.collection('crm_station_safety_hazards')
		const current = await transactionDoc(collection, id)
		if (!current) throw conflict('隐患不存在')
		if (Number(current.revision || 1) !== Number(data.expected_revision)) {
			const sameReport = !normalized.data.report || JSON.stringify(current.report) === JSON.stringify(normalized.data.report)
			const sameOnsite = !normalized.data.on_site_rectification || JSON.stringify(current.on_site_rectification) === JSON.stringify(normalized.data.on_site_rectification)
			if (sameReport && sameOnsite) { await transaction.rollback(); return { code: 0, msg: '实际处置记录已保存', data: { duplicate: true } } }
			throw conflict('隐患记录已变化，请重新加载')
		}
		const now = Date.now()
		const patch = { revision: Number(current.revision || 1) + 1, source_revisions: dbCmd.push([buildSourceRevision(current, '补充实际上报或当场整改记录', user, now)]), updated_at: now }
		if (normalized.data.report) patch.report = normalized.data.report
		if (normalized.data.on_site_rectification) {
			if (current.status !== 'pending_rectification') throw conflict('当场整改仅能补充到待整改隐患；现有整改与复查记录请按修订流程处理')
			const onsite = normalized.data.on_site_rectification
			if (containsExistingMedia(onsite.photo_file_ids, current)) throw conflict('当场整改照片不能复用原巡检、签名或验证照片')
			Object.assign(patch, { on_site_rectification: onsite, status: 'pending_verification', rectification_note: onsite.note, rectification_photo_file_ids: onsite.photo_file_ids, rectified_at: onsite.completed_at, rectified_by: normalizeString(user?._id), rectified_by_name: normalizeString(user?.nickname || user?.username) })
		}
		await collection.doc(id).update(patch)
		await transaction.commit()
		await recordLog(user, 'station_safety_hazard_facts_v1', { id, revision: patch.revision }, requestId)
		return { code: 0, msg: '实际处置记录已保存' }
	} catch (error) {
		try { await transaction.rollback() } catch (_) {}
		return { code: error.code === 409 ? 409 : 500, msg: error.message || '处置记录保存失败' }
	}
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
		if (action === 'submitV1') return await submitV1(user, data, requestId)
		if (action === 'updateV1') return await updateV1(user, data, requestId)
		if (action === 'listHazardsV1') return listHazardsV1(user, data)
		if (action === 'getHazardV1') return getHazardV1(user, data)
		if (action === 'submitRectificationV1') return submitRectificationV1(user, data, requestId)
		if (action === 'verifyHazardV1') return verifyHazardV1(user, data, requestId)
		if (action === 'updateHazardOutcomeV1') return updateHazardOutcomeV1(user, data, requestId)
		if (action === 'recordHazardFactsV1') return await recordHazardFactsV1(user, data, requestId)
		return { code: 400, msg: '未知 action' }
	} catch (error) {
		console.error('[crm-station-safety-inspection] main failed', action, error)
		return { code: error?.code === 409 ? 409 : 500, msg: error?.message || '厂站安全巡检服务异常' }
	}
}
