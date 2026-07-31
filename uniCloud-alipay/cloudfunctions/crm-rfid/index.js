'use strict'

let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-rfid] fallback to inline ACL helpers', err && err.message)
	ensureActionAcl = fallbackEnsureActionAcl
}

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const sessions = db.collection('crm_rfid_gate_sessions')
const bindings = db.collection('crm_rfid_bindings')
const vehicles = db.collection('crm_vehicles')
const bottles = db.collection('crm_bottles')

const PAGE_ACTION_RULES = {
	listSessionsV1: [{ pagePath: '/pages/rfid/sessions', action: 'view' }],
	getSessionV1: [{ pagePath: '/pages/rfid/sessions', action: 'view' }],
	bindEpcV1: [{ pagePath: '/pages/rfid/sessions', action: 'view' }],
	unbindEpcV1: [{ pagePath: '/pages/rfid/sessions', action: 'view' }]
}

function normalizeRoleTemplate(value) {
	const role = normalizeString(value).toLowerCase()
	return ['superadmin', 'admin', 'finance', 'user', 'pda_operator', 'safety_inspector'].includes(role) ? role : 'user'
}

function canViewRfidSessions(user = {}) {
	const role = normalizeRoleTemplate(user.role_template || user.role)
	if (role === 'superadmin') return true
	if (role === 'safety_inspector') return false
	const explicit = user.page_permissions && user.page_permissions['/pages/rfid/sessions']
	if (explicit && typeof explicit === 'object' && explicit.view != null) return explicit.view === true
	return role === 'admin' || role === 'finance' || role === 'user'
}

async function fallbackEnsureActionAcl(user, action, rules, superadminOnlyActions = [], options = {}) {
	void rules
	if (Array.isArray(superadminOnlyActions) && superadminOnlyActions.includes(action) && normalizeRoleTemplate(user?.role_template || user?.role) !== 'superadmin') {
		if (typeof options.recordLog === 'function') {
			await options.recordLog(user, 'rfid_forbidden', { action, reason: 'superadmin_only' }, options.requestId || '')
		}
		return { ok: false, code: 403, msg: '无权限执行该操作' }
	}
	if (action === 'listSessionsV1' || action === 'getSessionV1' || action === 'bindEpcV1' || action === 'unbindEpcV1') {
		if (canViewRfidSessions(user)) return { ok: true }
		if (typeof options.recordLog === 'function') {
			await options.recordLog(user, 'rfid_forbidden', { action, page_path: '/pages/rfid/sessions' }, options.requestId || '')
		}
		return { ok: false, code: 403, msg: '无权限访问 RFID 门口盘点' }
	}
	return { ok: true }
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
		console.error('[crm-rfid] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeEpc(value) {
	return normalizeString(value).replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

function toBool(value, fallback = false) {
	if (value === true || value === 'true' || value === 1 || value === '1') return true
	if (value === false || value === 'false' || value === 0 || value === '0') return false
	return fallback
}

function canManageRfidBindings(user = {}) {
	const role = normalizeRoleTemplate(user.role_template || user.role)
	return role === 'superadmin' || role === 'admin'
}

function toTimestamp(value, fallback = 0) {
	if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value)
	const text = normalizeString(value)
	if (!text) return fallback
	const parsed = Date.parse(text)
	return Number.isFinite(parsed) ? parsed : fallback
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildWhere(data = {}) {
	const conditions = []
	const keyword = normalizeString(data.keyword)
	const status = normalizeString(data.status)
	const gatewayId = normalizeString(data.gateway_id || data.gatewayId)
	const readerDeviceCode = normalizeString(data.reader_device_code || data.readerDeviceCode)
	const startAt = toTimestamp(data.started_at_start || data.startedAtStart || data.date_start || data.dateStart, 0)
	const endAt = toTimestamp(data.started_at_end || data.startedAtEnd || data.date_end || data.dateEnd, 0)

	if (status && status !== 'all') conditions.push({ status })
	if (gatewayId) conditions.push({ gateway_id: gatewayId })
	if (readerDeviceCode) conditions.push({ reader_device_code: readerDeviceCode })
	if (startAt) conditions.push({ started_at: dbCmd.gte(startAt) })
	if (endAt) conditions.push({ started_at: dbCmd.lte(endAt) })
	if (startAt && endAt) {
		conditions.pop()
		conditions.pop()
		conditions.push({ started_at: dbCmd.and(dbCmd.gte(startAt), dbCmd.lte(endAt)) })
	}
	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([
			{ session_id: rx },
			{ gateway_id: rx },
			{ reader_device_code: rx },
			{ vehicle_no: rx },
			{ vehicle_epc: rx }
		]))
	}

	if (conditions.length === 0) return {}
	if (conditions.length === 1) return conditions[0]
	return dbCmd.and(conditions)
}

async function countBy(where, extra) {
	const merged = Object.keys(where || {}).length ? dbCmd.and([where, extra]) : extra
	const res = await sessions.where(merged).count()
	return Number(res.total || 0)
}

async function listSessionsV1(user, data = {}) {
	void user
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize ?? data.limit ?? 20) || 20, 1), 50)
	const where = buildWhere(data)

	const res = await sessions
		.where(where)
		.field({
			raw: false,
			bottles: false,
			unknown_tags: false
		})
		.orderBy('started_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await sessions.where(where).count()
	const total = Number(totalRes.total || 0)
	return {
		code: 0,
		data: Array.isArray(res.data) ? res.data : [],
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore: page * pageSize < total
		},
		summary: {
			total,
			complete: await countBy(where, { status: 'complete' }),
			conflict: await countBy(where, { status: 'conflict' }),
			no_vehicle: await countBy(where, { status: 'no_vehicle' })
		}
	}
}

async function getSessionV1(user, data = {}) {
	void user
	const id = normalizeString(data._id || data.id)
	const sessionId = normalizeString(data.session_id || data.sessionId)
	if (!id && !sessionId) return { code: 400, msg: '缺少会话 ID' }
	const res = id ? await sessions.doc(id).get() : await sessions.where({ session_id: sessionId }).limit(1).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: 'RFID 会话不存在' }
	return { code: 0, data: doc }
}

async function resolveEntity(entityType, entityId) {
	const type = normalizeString(entityType)
	const id = normalizeString(entityId)
	if (!id) return { code: 400, msg: type === 'vehicle' ? '请选择车辆' : '请选择瓶子' }
	const collection = type === 'vehicle' ? vehicles : type === 'bottle' ? bottles : null
	if (!collection) return { code: 400, msg: 'entity_type 必须为 vehicle 或 bottle' }
	const field = type === 'vehicle'
		? { plate_no: true, is_active: true }
		: { bottle_no: true, is_active: true }
	const res = await collection.doc(id).field(field).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: type === 'vehicle' ? '车辆不存在' : '瓶子不存在' }
	if (doc.is_active === false) return { code: 400, msg: type === 'vehicle' ? '车辆已停用，不能绑定' : '瓶子已停用，不能绑定' }
	const entityNo = type === 'vehicle' ? normalizeString(doc.plate_no) : normalizeString(doc.bottle_no)
	if (!entityNo) return { code: 400, msg: type === 'vehicle' ? '车辆缺少车牌号' : '瓶子缺少瓶号' }
	return {
		code: 0,
		data: {
			entity_id: id,
			entity_no: entityNo
		}
	}
}

async function getBindingByEpc(epc) {
	const res = await bindings.where({ epc }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function getActiveEntityBindings(entityType, entityId) {
	const res = await bindings.where({ entity_type: entityType, entity_id: entityId, status: 'active' }).limit(20).get()
	return Array.isArray(res.data) ? res.data : []
}

function buildBindingDoc({ epc, entityType, entity, serial, user, now }) {
	return {
		epc,
		entity_type: entityType,
		entity_id: entity.entity_id,
		entity_no: entity.entity_no,
		serial,
		status: 'active',
		remark: '',
		inactive_at: 0,
		inactive_reason: '',
		updated_by: normalizeString(user?._id),
		updated_by_name: normalizeString(user?.nickname || user?.username),
		updated_at: now
	}
}

function summarizeBindingConflict(kind, row = {}) {
	return {
		kind,
		epc: normalizeEpc(row.epc),
		entity_type: normalizeString(row.entity_type),
		entity_id: normalizeString(row.entity_id),
		entity_no: normalizeString(row.entity_no)
	}
}

async function deactivateBinding(id, reason, user, now) {
	if (!id) return
	await bindings.doc(id).update({
		status: 'inactive',
		inactive_at: now,
		inactive_reason: normalizeString(reason),
		updated_by: normalizeString(user?._id),
		updated_by_name: normalizeString(user?.nickname || user?.username),
		updated_at: now
	})
}

function applySessionBinding(doc, { epc, entityType, binding }) {
	let changed = false
	const normalizedEpc = normalizeEpc(epc)
	const bound = binding && binding.status === 'active'
	const bindingStatus = bound ? 'bound' : 'unbound'
	const entityId = bound ? normalizeString(binding.entity_id) : ''
	const entityNo = bound ? normalizeString(binding.entity_no) : ''

	if (entityType === 'vehicle' && normalizeEpc(doc.vehicle_epc) === normalizedEpc) {
		if (doc.vehicle_binding_status !== bindingStatus || doc.vehicle_entity_id !== entityId || doc.vehicle_no !== entityNo) {
			doc.vehicle_binding_status = bindingStatus
			doc.vehicle_entity_id = entityId
			doc.vehicle_no = entityNo
			changed = true
		}
	}

	if (entityType === 'bottle' && Array.isArray(doc.bottles)) {
		doc.bottles = doc.bottles.map((item) => {
			if (normalizeEpc(item && item.epc) !== normalizedEpc) return item
			const next = {
				...item,
				binding_status: bindingStatus,
				entity_id: entityId,
				entity_no: entityNo
			}
			if (
				item.binding_status !== next.binding_status ||
				item.entity_id !== next.entity_id ||
				item.entity_no !== next.entity_no
			) {
				changed = true
			}
			return next
		})
		const bottlesRows = Array.isArray(doc.bottles) ? doc.bottles : []
		const boundTotal = bottlesRows.filter((item) => item && item.binding_status === 'bound').length
		const unboundTotal = bottlesRows.filter((item) => !item || item.binding_status !== 'bound').length
		if (Number(doc.bound_bottle_total || 0) !== boundTotal || Number(doc.unbound_bottle_total || 0) !== unboundTotal) {
			doc.bound_bottle_total = boundTotal
			doc.unbound_bottle_total = unboundTotal
			changed = true
		}
	}

	return changed
}

async function syncSessionBinding(sessionId, { epc, entityType, binding }) {
	const id = normalizeString(sessionId)
	if (!id) return false
	const res = await sessions.where({ session_id: id }).limit(1).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc || !doc._id) return false
	const changed = applySessionBinding(doc, { epc, entityType, binding })
	if (!changed) return false
	const patch = { updated_at: Date.now() }
	if (entityType === 'vehicle') {
		patch.vehicle_binding_status = doc.vehicle_binding_status
		patch.vehicle_entity_id = doc.vehicle_entity_id
		patch.vehicle_no = doc.vehicle_no
	}
	if (entityType === 'bottle') {
		patch.bottles = Array.isArray(doc.bottles) ? doc.bottles : []
		patch.bound_bottle_total = Number(doc.bound_bottle_total || 0)
		patch.unbound_bottle_total = Number(doc.unbound_bottle_total || 0)
	}
	await sessions.doc(doc._id).update(patch)
	return true
}

async function bindEpcV1(user, data = {}, requestId = '') {
	if (!canManageRfidBindings(user)) {
		await recordLog(user, 'rfid_forbidden', { action: 'bindEpcV1', reason: 'admin_only' }, requestId)
		return { code: 403, msg: '仅管理员可绑定 RFID 标签' }
	}

	const epc = normalizeEpc(data.epc)
	const entityType = normalizeString(data.entity_type || data.entityType)
	const entityId = normalizeString(data.entity_id || data.entityId)
	const sessionId = normalizeString(data.session_id || data.sessionId)
	const confirmRebind = toBool(data.confirm_rebind ?? data.confirmRebind, false)
	if (epc.length !== 24) return { code: 400, msg: 'EPC 必须为 24 位 HEX' }
	if (entityType !== 'vehicle' && entityType !== 'bottle') return { code: 400, msg: 'entity_type 必须为 vehicle 或 bottle' }

	const entityRes = await resolveEntity(entityType, entityId)
	if (entityRes.code !== 0) return entityRes
	const entity = entityRes.data
	const now = Date.now()
	const serial = normalizeString(data.serial)
	const existingByEpc = await getBindingByEpc(epc)
	const activeEntityBindings = await getActiveEntityBindings(entityType, entity.entity_id)
	const conflicts = []

	if (
		existingByEpc &&
		existingByEpc.status === 'active' &&
		(existingByEpc.entity_type !== entityType || existingByEpc.entity_id !== entity.entity_id)
	) {
		conflicts.push(summarizeBindingConflict('epc_active_binding', existingByEpc))
	}
	for (const row of activeEntityBindings) {
		if (normalizeEpc(row.epc) !== epc) conflicts.push(summarizeBindingConflict('entity_active_binding', row))
	}

	if (conflicts.length && !confirmRebind) {
		return { code: 409, msg: 'RFID 绑定存在冲突，确认后可改绑', data: { conflicts } }
	}

	const bindingDoc = buildBindingDoc({ epc, entityType, entity, serial, user, now })
	let binding = null
	for (const row of activeEntityBindings) {
		if (!existingByEpc || row._id !== existingByEpc._id) {
			await deactivateBinding(row._id, 'rebind_entity', user, now)
		}
	}
	if (existingByEpc && existingByEpc._id) {
		await bindings.doc(existingByEpc._id).update(bindingDoc)
		binding = {
			...existingByEpc,
			...bindingDoc,
			_id: existingByEpc._id
		}
	} else {
		const addRes = await bindings.add({
			...bindingDoc,
			created_at: now
		})
		binding = {
			...bindingDoc,
			_id: addRes.id || addRes._id || '',
			created_at: now
		}
	}

	const changedSession = await syncSessionBinding(sessionId, { epc, entityType, binding })
	await recordLog(user, 'rfid_bind_epc', {
		epc,
		entity_type: entityType,
		entity_id: entity.entity_id,
		entity_no: entity.entity_no,
		session_id: sessionId,
		confirm_rebind: confirmRebind,
		conflict_total: conflicts.length
	}, requestId)
	return { code: 0, data: { binding, changed_session: changedSession } }
}

async function unbindEpcV1(user, data = {}, requestId = '') {
	if (!canManageRfidBindings(user)) {
		await recordLog(user, 'rfid_forbidden', { action: 'unbindEpcV1', reason: 'admin_only' }, requestId)
		return { code: 403, msg: '仅管理员可解绑 RFID 标签' }
	}
	const epc = normalizeEpc(data.epc)
	const entityType = normalizeString(data.entity_type || data.entityType)
	const sessionId = normalizeString(data.session_id || data.sessionId)
	if (epc.length !== 24) return { code: 400, msg: 'EPC 必须为 24 位 HEX' }
	if (entityType && entityType !== 'vehicle' && entityType !== 'bottle') return { code: 400, msg: 'entity_type 必须为 vehicle 或 bottle' }

	const where = entityType ? { epc, entity_type: entityType, status: 'active' } : { epc, status: 'active' }
	const res = await bindings.where(where).limit(1).get()
	const row = (res.data && res.data[0]) || null
	let inactive = false
	let changedSession = false
	if (row && row._id) {
		const now = Date.now()
		await deactivateBinding(row._id, 'manual_unbind', user, now)
		inactive = true
		changedSession = await syncSessionBinding(sessionId, {
			epc,
			entityType: normalizeString(row.entity_type),
			binding: null
		})
		await recordLog(user, 'rfid_unbind_epc', {
			epc,
			entity_type: normalizeString(row.entity_type),
			entity_id: normalizeString(row.entity_id),
			entity_no: normalizeString(row.entity_no),
			session_id: sessionId
		}, requestId)
	} else if (entityType) {
		changedSession = await syncSessionBinding(sessionId, { epc, entityType, binding: null })
	}
	return { code: 0, data: { inactive, changed_session: changedSession } }
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event || {}
	const requestId =
		normalizeString(event && (event.request_id || event.requestId || context?.requestId || context?.request_id || '')) ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, [], {
		recordLog,
		requestId,
		cloudFunction: 'crm-rfid'
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }

	if (action === 'listSessionsV1') return listSessionsV1(user, data)
	if (action === 'getSessionV1') return getSessionV1(user, data)
	if (action === 'bindEpcV1') return bindEpcV1(user, data, requestId)
	if (action === 'unbindEpcV1') return unbindEpcV1(user, data, requestId)
	return { code: 400, msg: '未知 action' }
}
