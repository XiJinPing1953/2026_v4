'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const bottles = db.collection('crm_bottles')

const STATUS = ['unknown', 'in_station', 'at_customer', 'scrapped', 'lost']

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
		console.error('[crm-bottle] recordLog failed', action, err)
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

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeStatus(value) {
	const s = normalizeString(value) || 'unknown'
	return STATUS.includes(s) ? s : null
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
	const status = normalizeString(data.status)
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

	if (status) {
		const s = normalizeStatus(status)
		if (!s) return { code: 400, msg: '状态无效' }
		conditions.push({ status: s })
	}

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ bottle_no: rx }, { current_customer_name: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await bottles
		.where(where)
		.orderBy('updated_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await bottles.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const hasBaseFilter = conditions.length > 0
	const mergeWhere = (extra) => (hasBaseFilter ? dbCmd.and([where, extra]) : extra)

	const inStationRes = await bottles.where(mergeWhere({ status: 'in_station' })).count()
	const atCustomerRes = await bottles.where(mergeWhere({ status: 'at_customer' })).count()
	const abnormalRes = await bottles
		.where(mergeWhere(dbCmd.or([{ status: 'scrapped' }, { status: 'lost' }])))
		.count()

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
			in_station: Number(inStationRes.total || 0),
			at_customer: Number(atCustomerRes.total || 0),
			abnormal: Number(abnormalRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少钢瓶 ID' }
	const res = await bottles.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '钢瓶不存在' }
	return { code: 0, data: doc }
}

async function createV1(user, data, requestId) {
	const bottleNo = normalizeBottleNo(data.bottle_no)
	if (!bottleNo) return { code: 400, msg: '钢瓶号必填' }

	const status = normalizeStatus(data.status)
	if (!status) return { code: 400, msg: '状态无效' }

	const now = Date.now()
	const doc = {
		bottle_no: bottleNo,
		tare_weight: data.tare_weight == null ? null : Number(data.tare_weight),
		status,
		current_customer_id: data.current_customer_id == null ? null : normalizeString(data.current_customer_id),
		current_customer_name: normalizeString(data.current_customer_name),
		remark: normalizeString(data.remark),
		is_active: true,
		created_at: now,
		updated_at: now
	}

	const res = await bottles.add(doc)
	await recordLog(user, 'bottle_create_v1', { id: res.id }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少钢瓶 ID' }

	const current = await bottles.doc(id).field({ bottle_no: true }).get()
	const existing = (current.data && current.data[0]) || null
	if (!existing) return { code: 404, msg: '钢瓶不存在' }

	const patch = {}
	if (data.bottle_no != null) patch.bottle_no = normalizeBottleNo(data.bottle_no)
	if (data.tare_weight != null) patch.tare_weight = Number(data.tare_weight)
	if (data.status != null) {
		const s = normalizeStatus(data.status)
		if (!s) return { code: 400, msg: '状态无效' }
		patch.status = s
	}
	if (data.current_customer_id != null) {
		patch.current_customer_id = data.current_customer_id ? normalizeString(data.current_customer_id) : null
	}
	if (data.current_customer_name != null) patch.current_customer_name = normalizeString(data.current_customer_name)
	if (data.remark != null) patch.remark = normalizeString(data.remark)
	if (data.is_active != null) patch.is_active = Boolean(data.is_active)

	patch.updated_at = Date.now()

	await bottles.doc(id).update(patch)
	await recordLog(user, 'bottle_update_v1', { id }, requestId)
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
