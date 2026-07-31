'use strict'

let aclHelpers = null
try {
	aclHelpers = require('../common/pageAcl')
} catch (err) {
	console.warn('[crm-home-safety-inspection] fallback to local pageAcl helpers', err && err.message)
	aclHelpers = require('./pageAclLocal')
}

const { ensureActionAcl, isSuperAdmin } = aclHelpers
const {
	TEMPLATE,
	getTemplate,
	normalizeString,
	normalizeEditablePayload,
	normalizeClientSubmissionId
} = require('./inspectionPolicy')

const db = uniCloud.database()
const dbCmd = db.command
const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const customers = db.collection('crm_customers')
const inspections = db.collection('crm_home_safety_inspections')
const revisions = db.collection('crm_home_safety_revisions')

const HOME_PATH = '/pages/home-safety-inspection/home'
const FORM_PATH = '/pages/home-safety-inspection/form'
const HISTORY_PATH = '/pages/home-safety-inspection/history'
const DETAIL_PATH = '/pages/home-safety-inspection/detail'

const PAGE_ACTION_RULES = {
	getTemplateV1: [{ pagePath: FORM_PATH, action: 'view' }, { pagePath: HOME_PATH, action: 'view' }],
	listCustomersV1: [{ pagePath: HOME_PATH, action: 'view' }],
	listV1: [{ pagePath: HISTORY_PATH, action: 'view' }],
	getV1: [{ pagePath: DETAIL_PATH, action: 'view' }],
	submitV1: [{ pagePath: FORM_PATH, action: 'create' }],
	updateV1: [{ pagePath: FORM_PATH, action: 'update' }],
	listRevisionsV1: [{ pagePath: DETAIL_PATH, action: 'update' }]
}
const SUPERADMIN_ONLY_ACTIONS = ['updateV1', 'listRevisionsV1']

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function shanghaiDate(timestamp) {
	const value = Number(timestamp)
	const date = new Date((Number.isFinite(value) ? value : Date.now()) + 8 * 60 * 60 * 1000)
	return date.toISOString().slice(0, 10)
}

function normalizeTimestamp(value, fallback = Date.now()) {
	const number = Number(value)
	return Number.isFinite(number) && number > 0 ? number : fallback
}

function isDuplicateKeyError(err) {
	const message = normalizeString(err && err.message).toLowerCase()
	return message.includes('duplicate key') || message.includes('e11000')
}

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
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
	} catch (err) {
		console.error('[crm-home-safety-inspection] recordLog failed', action, err)
	}
}

function visibleCustomerWhere(extra = null) {
	const visibility = { is_hidden: dbCmd.neq(true) }
	return extra ? dbCmd.and([visibility, extra]) : visibility
}

async function getVisibleCustomer(customerId) {
	const id = normalizeString(customerId)
	if (!id) return null
	const res = await customers
		.where(visibleCustomerWhere({ _id: id }))
		.field({ _id: true, name: true, address: true, is_active: true })
		.limit(1)
		.get()
	return (res.data && res.data[0]) || null
}

async function listVisibleCustomerIds(ids = []) {
	const uniqueIds = Array.from(new Set((ids || []).map(normalizeString).filter(Boolean)))
	if (!uniqueIds.length) return new Set()
	const res = await customers
		.where(visibleCustomerWhere({ _id: dbCmd.in(uniqueIds) }))
		.field({ _id: true })
		.limit(Math.min(uniqueIds.length, 100))
		.get()
	return new Set((res.data || []).map((item) => normalizeString(item && item._id)).filter(Boolean))
}

function inspectionSummary(doc) {
	if (!doc) return null
	return {
		_id: doc._id,
		customer_id: doc.customer_id,
		inspection_at: Number(doc.inspection_at || 0),
		inspection_date: doc.inspection_date || '',
		overall_result: doc.overall_result || '',
		revision_no: Number(doc.revision_no || 0),
		last_edited_at: Number(doc.last_edited_at || 0)
	}
}

function comparableLocationCapture(value) {
	const source = value && typeof value === 'object' ? value : {}
	return {
		status: source.status || '',
		coordinate_type: source.coordinate_type || '',
		source: source.source || '',
		latitude: source.latitude ?? null,
		longitude: source.longitude ?? null,
		accuracy: source.accuracy ?? null,
		error_code: source.error_code || '',
		error_message: source.error_message || ''
	}
}

function submissionBusinessSnapshot(source, customerId, inspectorName) {
	const data = source && typeof source === 'object' ? source : {}
	return {
		customer_id: normalizeString(customerId ?? data.customer_id),
		location_text: data.location_text || '',
		location_capture: comparableLocationCapture(data.location_capture),
		template_code: data.template_code || '',
		template_version: Number(data.template_version || 0),
		template_title_snapshot: data.template_title_snapshot || '',
		items: Array.isArray(data.items) ? data.items : [],
		overall_result: data.overall_result || '',
		customer_signer_name: data.customer_signer_name || '',
		customer_signature_file_id: data.customer_signature_file_id || '',
		inspector_name: normalizeString(inspectorName ?? data.inspector_name),
		inspector_signature_file_id: data.inspector_signature_file_id || ''
	}
}

function submissionMatchesExisting(existing, customerId, normalizedData, inspectorName) {
	const stored = submissionBusinessSnapshot(existing, existing && existing.customer_id, existing && existing.inspector_name)
	const incoming = submissionBusinessSnapshot(normalizedData, customerId, inspectorName)
	return JSON.stringify(stored) === JSON.stringify(incoming)
}

async function getTemplateV1(data = {}) {
	const requestedCode = normalizeString(data.template_code ?? data.templateCode)
	const rawVersion = data.template_version ?? data.templateVersion
	const hasVersion = rawVersion !== undefined && rawVersion !== null && rawVersion !== ''
	if (Boolean(requestedCode) !== hasVersion) {
		return { code: 400, msg: '查询历史模板时必须同时提供模板代码和版本号' }
	}
	const requestedTemplate = requestedCode ? getTemplate(requestedCode, Number(rawVersion)) : TEMPLATE
	if (!requestedTemplate) return { code: 404, msg: '巡检模板不存在或已停止支持' }
	return {
		code: 0,
		data: {
			template_code: requestedTemplate.code,
			template_version: requestedTemplate.version,
			title: requestedTemplate.title,
			items: requestedTemplate.items,
			is_current:
				requestedTemplate.code === TEMPLATE.code && requestedTemplate.version === TEMPLATE.version,
			server_now: Date.now()
		}
	}
}

async function listCustomersV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
	const customerId = normalizeString(data.customer_id ?? data.customerId)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize ?? data.page_size ?? 20) || 20, 1), 50)
	const conditions = []
	if (customerId) conditions.push({ _id: customerId })
	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ name: rx }, { short_name: rx }, { address: rx }]))
	}
	const extraWhere = conditions.length ? (conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)) : null
	const where = visibleCustomerWhere(extraWhere)
	const [rowsRes, totalRes] = await Promise.all([
		customers
			.where(where)
			.field({ _id: true, name: true, address: true })
			.orderBy('updated_at', 'desc')
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get(),
		customers.where(where).count()
	])
	const rows = Array.isArray(rowsRes.data) ? rowsRes.data : []
	const enriched = await Promise.all(rows.map(async (customer) => {
		const latestRes = await inspections
			.where({ customer_id: customer._id })
			.field({
				_id: true,
				customer_id: true,
				inspection_at: true,
				inspection_date: true,
				overall_result: true,
				revision_no: true,
				last_edited_at: true
			})
			.orderBy('inspection_at', 'desc')
			.limit(1)
			.get()
		return {
			_id: customer._id,
			name: customer.name || '',
			address: customer.address || '',
			latest_inspection: inspectionSummary((latestRes.data || [])[0])
		}
	}))
	const total = Number(totalRes.total || 0)
	return {
		code: 0,
		data: enriched,
		total,
		paging: { page, pageSize, total, hasMore: page * pageSize < total }
	}
}

async function listV1(user, data) {
	void user
	const customerId = normalizeString(data.customer_id ?? data.customerId)
	if (!customerId) return { code: 400, msg: '缺少客户 ID' }
	const customer = await getVisibleCustomer(customerId)
	if (!customer) return { code: 404, msg: '客户不存在或已隐藏' }
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize ?? data.page_size ?? 20) || 20, 1), 50)
	const where = { customer_id: customerId }
	const [rowsRes, totalRes] = await Promise.all([
		inspections
			.where(where)
			.field({
				items: false,
				location_capture: false,
				customer_signature_file_id: false,
				inspector_signature_file_id: false
			})
			.orderBy('inspection_at', 'desc')
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get(),
		inspections.where(where).count()
	])
	const total = Number(totalRes.total || 0)
	return {
		code: 0,
		data: rowsRes.data || [],
		customer: { _id: customer._id, name: customer.name || '', address: customer.address || '' },
		total,
		paging: { page, pageSize, total, hasMore: page * pageSize < total }
	}
}

async function getInspectionIfVisible(inspectionId) {
	const id = normalizeString(inspectionId)
	if (!id) return { inspection: null, customer: null }
	const res = await inspections.doc(id).get()
	const inspection = (res.data && res.data[0]) || null
	if (!inspection) return { inspection: null, customer: null }
	const customer = await getVisibleCustomer(inspection.customer_id)
	if (!customer) return { inspection: null, customer: null }
	return { inspection, customer }
}

async function getV1(user, data) {
	const { inspection } = await getInspectionIfVisible(data._id || data.id)
	if (!inspection) return { code: 404, msg: '巡检单不存在或客户已隐藏' }
	const recordTemplate = getTemplate(inspection.template_code, inspection.template_version)
	const superAdmin = isSuperAdmin(user)
	return {
		code: 0,
		data: {
			...inspection,
			can_update: Boolean(recordTemplate) && superAdmin,
			can_view_revisions: superAdmin,
			edit_block_reason:
				superAdmin && !recordTemplate ? '巡检模板无法识别，仅支持查看' : ''
		}
	}
}

async function submitV1(user, data, requestId) {
	const clientSubmissionId = normalizeClientSubmissionId(data.client_submission_id ?? data.clientSubmissionId)
	if (!clientSubmissionId) return { code: 400, msg: '提交标识无效，请刷新页面后重试' }
	const customerId = normalizeString(data.customer_id ?? data.customerId)
	const customer = await getVisibleCustomer(customerId)
	if (!customer) return { code: 404, msg: '客户不存在或已隐藏，无法提交巡检单' }

	const inspectorName = normalizeString(user?.nickname || user?.username)
	const normalized = normalizeEditablePayload(data, {
		template: TEMPLATE,
		defaultInspectorName: inspectorName,
		now: Date.now()
	})
	if (!normalized.ok) return { code: 400, msg: normalized.msg }

	const existingRes = await inspections.where({ client_submission_id: clientSubmissionId }).limit(1).get()
	const existing = (existingRes.data || [])[0]
	if (existing) {
		if (normalizeString(existing.customer_id) !== customerId) {
			return { code: 409, msg: '提交标识已被其他巡检单使用，请刷新页面后重试' }
		}
		if (!submissionMatchesExisting(existing, customerId, normalized.data, inspectorName)) {
			return {
				code: 409,
				msg: '该提交标识已生成巡检单，但当前内容与已提交内容不一致，请打开原单核对',
				data: { existing_id: existing._id }
			}
		}
		return { code: 0, msg: '巡检单已提交', data: { _id: existing._id, duplicate: true } }
	}

	const confirmedCustomer = await getVisibleCustomer(customer._id)
	if (!confirmedCustomer) return { code: 404, msg: '客户已隐藏，无法提交巡检单' }
	const now = Date.now()
	const doc = {
		client_submission_id: clientSubmissionId,
		customer_id: confirmedCustomer._id,
		customer_name_snapshot: confirmedCustomer.name || '',
		customer_address_snapshot: confirmedCustomer.address || '',
		...normalized.data,
		inspection_at: now,
		inspection_date: shanghaiDate(now),
		inspector_name: inspectorName,
		customer_signed_at: now,
		inspector_signed_at: now,
		inspector_user_id: normalizeString(user?._id),
		inspector_username_snapshot: normalizeString(user?.username),
		status: 'submitted',
		source: 'h5',
		revision_no: 0,
		last_edited_at: null,
		last_edited_by: null,
		last_edited_by_name: '',
		last_edit_reason: '',
		created_at: now,
		created_by: normalizeString(user?._id),
		created_by_name: normalizeString(user?.username),
		updated_at: now
	}
	try {
		const addRes = await inspections.add(doc)
		await recordLog(
			user,
			'home_safety_inspection_submit_v1',
			{
				id: addRes.id,
				customer_id: customer._id,
				overall_result: doc.overall_result,
				photo_count: doc.items.reduce((sum, item) => sum + item.photo_file_ids.length, 0)
			},
			requestId
		)
		return { code: 0, msg: '巡检单提交成功', data: { _id: addRes.id, duplicate: false } }
	} catch (err) {
		if (isDuplicateKeyError(err)) {
			const retryRes = await inspections.where({ client_submission_id: clientSubmissionId }).limit(1).get()
			const retry = (retryRes.data || [])[0]
			if (retry && normalizeString(retry.customer_id) === customerId) {
				if (!submissionMatchesExisting(retry, customerId, normalized.data, inspectorName)) {
					return {
						code: 409,
						msg: '巡检单已由另一请求提交，但内容不一致，请打开原单核对',
						data: { existing_id: retry._id }
					}
				}
				return { code: 0, msg: '巡检单已提交', data: { _id: retry._id, duplicate: true } }
			}
			return { code: 409, msg: '巡检单已重复提交' }
		}
		console.error('[crm-home-safety-inspection] submitV1 failed', err)
		return { code: 500, msg: '巡检单提交失败' }
	}
}

function buildRevisionSnapshot(inspection) {
	const snapshot = { ...(inspection || {}) }
	delete snapshot._id
	return snapshot
}

async function updateV1(user, data, requestId) {
	const inspectionId = normalizeString(data._id || data.id)
	const editReason = normalizeString(data.edit_reason ?? data.editReason)
	if (!inspectionId) return { code: 400, msg: '缺少巡检单 ID' }
	if (!editReason) return { code: 400, msg: '管理员修改原因必填' }
	if (editReason.length > 500) return { code: 400, msg: '管理员修改原因最多 500 字' }

	const currentResult = await getInspectionIfVisible(inspectionId)
	const current = currentResult.inspection
	if (!current) return { code: 404, msg: '巡检单不存在或客户已隐藏' }
	const recordTemplate = getTemplate(current.template_code, current.template_version)
	if (!recordTemplate) return { code: 409, msg: '巡检模板无法识别，该记录仅支持查看' }
	const payloadTemplateCode = normalizeString(data.template_code ?? data.templateCode)
	const payloadTemplateVersion = Number(data.template_version ?? data.templateVersion)
	if (
		payloadTemplateCode !== recordTemplate.code ||
		payloadTemplateVersion !== recordTemplate.version
	) {
		return { code: 400, msg: '修改时必须沿用原巡检模板，不能升级或更换模板' }
	}
	const customerId = normalizeString(data.customer_id ?? data.customerId ?? current.customer_id)
	const customer = await getVisibleCustomer(customerId)
	if (!customer) return { code: 404, msg: '目标客户不存在或已隐藏' }

	const normalized = normalizeEditablePayload(data, {
		template: recordTemplate,
		defaultInspectorName: current.inspector_name || user?.nickname || user?.username,
		now: Date.now()
	})
	if (!normalized.ok) return { code: 400, msg: normalized.msg }
	const customerStillVisible = await getVisibleCustomer(customer._id)
	if (!customerStillVisible) return { code: 404, msg: '目标客户已隐藏，无法保存修改' }

	const now = Date.now()
	const inspectionAt = normalizeTimestamp(data.inspection_at ?? data.inspectionAt, current.inspection_at || now)
	const nextRevisionNo = Number(current.revision_no || 0) + 1
	let revisionId = ''
	try {
		const revisionRes = await revisions.add({
			inspection_id: inspectionId,
			version_no: Number(current.revision_no || 0),
			customer_id_snapshot: normalizeString(current.customer_id),
			snapshot: buildRevisionSnapshot(current),
			edit_reason: editReason,
			created_at: now,
			created_by: normalizeString(user?._id),
			created_by_name: normalizeString(user?.username)
		})
		revisionId = revisionRes.id
		const customerSignatureChanged =
			normalized.data.customer_signature_file_id !== current.customer_signature_file_id
		const inspectorSignatureChanged =
			normalized.data.inspector_signature_file_id !== current.inspector_signature_file_id
		await inspections.doc(inspectionId).update({
			customer_id: customer._id,
			customer_name_snapshot: customer.name || '',
			customer_address_snapshot: customer.address || '',
			...normalized.data,
			inspection_at: inspectionAt,
			inspection_date: shanghaiDate(inspectionAt),
			customer_signed_at: customerSignatureChanged ? now : normalizeTimestamp(current.customer_signed_at, now),
			inspector_signed_at: inspectorSignatureChanged ? now : normalizeTimestamp(current.inspector_signed_at, now),
			revision_no: nextRevisionNo,
			last_edited_at: now,
			last_edited_by: normalizeString(user?._id),
			last_edited_by_name: normalizeString(user?.username),
			last_edit_reason: editReason,
			updated_at: now
		})
		await recordLog(
			user,
			'home_safety_inspection_update_v1',
			{
				id: inspectionId,
				customer_id: customer._id,
				revision_no: nextRevisionNo,
				overall_result: normalized.data.overall_result,
				edit_reason: editReason
			},
			requestId
		)
		return { code: 0, msg: '巡检单已修改', data: { _id: inspectionId, revision_no: nextRevisionNo } }
	} catch (err) {
		if (revisionId) {
			try {
				await revisions.doc(revisionId).remove()
			} catch (_) {
				// compensation best effort
			}
		}
		console.error('[crm-home-safety-inspection] updateV1 failed', err)
		return { code: 500, msg: '巡检单修改失败' }
	}
}

async function listRevisionsV1(user, data) {
	void user
	const inspectionId = normalizeString(data._id || data.id || data.inspection_id || data.inspectionId)
	if (!inspectionId) return { code: 400, msg: '缺少巡检单 ID' }
	const current = await getInspectionIfVisible(inspectionId)
	if (!current.inspection) return { code: 404, msg: '巡检单不存在或客户已隐藏' }
	const res = await revisions
		.where({ inspection_id: inspectionId })
		.orderBy('version_no', 'desc')
		.limit(50)
		.get()
	const rows = Array.isArray(res.data) ? res.data : []
	const visibleIds = await listVisibleCustomerIds(rows.map((item) => item.customer_id_snapshot))
	const visibleRows = rows.filter((item) => visibleIds.has(normalizeString(item.customer_id_snapshot)))
	return {
		code: 0,
		data: visibleRows,
		total: visibleRows.length,
		truncated: rows.length >= 50
	}
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event || {}
	const requestId =
		normalizeString(event?.request_id || event?.requestId || context?.requestId || context?.request_id) ||
		generateRequestId()
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
		recordLog,
		requestId,
		cloudFunction: 'crm-home-safety-inspection'
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }

	try {
		if (action === 'getTemplateV1') return getTemplateV1(data)
		if (action === 'listCustomersV1') return listCustomersV1(user, data)
		if (action === 'listV1') return listV1(user, data)
		if (action === 'getV1') return getV1(user, data)
		if (action === 'submitV1') return submitV1(user, data, requestId)
		if (action === 'updateV1') return updateV1(user, data, requestId)
		if (action === 'listRevisionsV1') return listRevisionsV1(user, data)
		return { code: 400, msg: '未知 action' }
	} catch (err) {
		console.error('[crm-home-safety-inspection] main failed', action, err)
		return { code: 500, msg: err?.message || '入户随瓶安全巡检服务异常' }
	}
}
