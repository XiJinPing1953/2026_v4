'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const vehicles = db.collection('crm_vehicles')

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
		console.error('[crm-vehicle] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildUniqKey(plateNo) {
	return normalizePlateNo(plateNo)
}

async function listV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 20) || 20, 1),
		50
	)

	const conditions = []
	if (data.is_active != null) {
		const raw = data.is_active
		if (raw === true || raw === 'true' || raw === 1 || raw === '1') conditions.push({ is_active: true })
		else if (raw === false || raw === 'false' || raw === 0 || raw === '0') conditions.push({ is_active: false })
	}

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ plate_no: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await vehicles
		.where(where)
		.field({ uniq_key: false })
		.orderBy('updated_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await vehicles.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const hasBaseFilter = conditions.length > 0
	const mergeWhere = (extra) => (hasBaseFilter ? dbCmd.and([where, extra]) : extra)

	const activeRes = await vehicles.where(mergeWhere({ is_active: true })).count()
	const inactiveRes = await vehicles.where(mergeWhere({ is_active: false })).count()
	const withRemarkRes = await vehicles.where(mergeWhere({ remark: dbCmd.neq('') })).count()

	return {
		code: 0,
		data: res.data || [],
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		},
		summary: {
			total,
			active: Number(activeRes.total || 0),
			inactive: Number(inactiveRes.total || 0),
			with_remark: Number(withRemarkRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少车辆 ID' }
	const res = await vehicles.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '车辆不存在' }
	return { code: 0, data: doc }
}

async function createV1(user, data, requestId) {
	const plateNo = normalizePlateNo(data.plate_no)
	if (!plateNo) return { code: 400, msg: '车牌必填' }

	const uniqKey = buildUniqKey(plateNo)
	if (!uniqKey) return { code: 400, msg: '车辆唯一键无效' }

	const now = Date.now()
	const doc = {
		uniq_key: uniqKey,
		plate_no: plateNo,
		remark: normalizeString(data.remark),
		is_active: true,
		created_at: now,
		updated_at: now
	}

	const res = await vehicles.add(doc)
	await recordLog(user, 'vehicle_create_v1', { id: res.id }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少车辆 ID' }

	const current = await vehicles.doc(id).field({ plate_no: true }).get()
	const existing = (current.data && current.data[0]) || null
	if (!existing) return { code: 404, msg: '车辆不存在' }

	const patch = {}
	if (data.plate_no != null) patch.plate_no = normalizePlateNo(data.plate_no)
	if (data.remark != null) patch.remark = normalizeString(data.remark)
	if (data.is_active != null) patch.is_active = Boolean(data.is_active)

	if (patch.plate_no != null) {
		const uniqKey = buildUniqKey(patch.plate_no)
		if (!uniqKey) return { code: 400, msg: '车辆唯一键无效' }
		patch.uniq_key = uniqKey
	}

	patch.updated_at = Date.now()

	await vehicles.doc(id).update(patch)
	await recordLog(user, 'vehicle_update_v1', { id }, requestId)
	return { code: 0, msg: '更新成功' }
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'updateV1') return updateV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
