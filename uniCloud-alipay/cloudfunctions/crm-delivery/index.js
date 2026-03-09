'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const deliveries = db.collection('crm_delivery_men')

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user ? user._id || null : null,
			username: user ? user.username || '' : '',
			role: user ? user.role || '' : '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-delivery] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeName(value) {
	return normalizeString(value).replace(/\s+/g, ' ')
}

function normalizePhone(value) {
	return normalizeString(value).replace(/\s+/g, '')
}

function normalizeBool(value, fallback = true) {
	if (typeof value === 'boolean') return value
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (['true', '1', 'yes', 'y', '在岗', '在职', '启用', 'active'].includes(text)) return true
	if (['false', '0', 'no', 'n', '离岗', '离职', '停用', 'inactive'].includes(text)) return false
	return fallback
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildUniqKey(name, phone) {
	const n = normalizeName(name)
	const p = normalizePhone(phone)
	if (!n) return ''
	return p ? `${n}|${p}` : `${n}|-`
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function isDuplicateKeyError(err) {
	const msg = normalizeString(err && err.message).toLowerCase()
	return msg.includes('duplicate key') || msg.includes('e11000')
}

async function listV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize ?? data.limit ?? 20) || 20, 1), 50)

	const conditions = []
	if (data.is_active != null) {
		conditions.push({ is_active: normalizeBool(data.is_active, true) })
	}

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ name: rx }, { phone: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await deliveries
		.where(where)
		.field({ uniq_key: false })
		.orderBy('updated_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await deliveries.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const hasBaseFilter = conditions.length > 0
	const mergeWhere = (extra) => (hasBaseFilter ? dbCmd.and([where, extra]) : extra)

	const activeRes = await deliveries.where(mergeWhere({ is_active: true })).count()
	const inactiveRes = await deliveries.where(mergeWhere({ is_active: false })).count()
	const withPhoneRes = await deliveries.where(mergeWhere({ phone: dbCmd.neq('') })).count()

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
			with_phone: Number(withPhoneRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少配送员 ID' }
	const res = await deliveries.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '配送员不存在' }
	return { code: 0, data: doc }
}

async function createV1(user, data, requestId) {
	const name = normalizeName(data.name)
	const phone = normalizePhone(data.phone)
	if (!name) return { code: 400, msg: '配送员姓名必填' }

	const uniqKey = buildUniqKey(name, phone)
	if (!uniqKey) return { code: 400, msg: '配送员唯一键无效' }

	const now = Date.now()
	const doc = {
		uniq_key: uniqKey,
		name,
		phone,
		remark: normalizeString(data.remark),
		is_active: normalizeBool(data.is_active, true),
		created_at: now,
		updated_at: now
	}

	try {
		const res = await deliveries.add(doc)
		await recordLog(user, 'delivery_create_v1', { id: res.id }, requestId)
		return { code: 0, msg: '创建成功', data: { _id: res.id } }
	} catch (err) {
		if (isDuplicateKeyError(err)) return { code: 409, msg: '配送员已存在' }
		console.error('[crm-delivery] createV1 failed', err)
		return { code: 500, msg: '创建失败' }
	}
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少配送员 ID' }

	const current = await deliveries.doc(id).field({ name: true, phone: true }).get()
	const existing = (current.data && current.data[0]) || null
	if (!existing) return { code: 404, msg: '配送员不存在' }

	const patch = {}
	if (data.name != null) {
		const nextName = normalizeName(data.name)
		if (!nextName) return { code: 400, msg: '配送员姓名不能为空' }
		patch.name = nextName
	}
	if (data.phone != null) patch.phone = normalizePhone(data.phone)
	if (data.remark != null) patch.remark = normalizeString(data.remark)
	if (data.is_active != null) patch.is_active = normalizeBool(data.is_active, true)

	const nextName = patch.name != null ? patch.name : normalizeName(existing.name)
	const nextPhone = patch.phone != null ? patch.phone : normalizePhone(existing.phone)
	patch.uniq_key = buildUniqKey(nextName, nextPhone)
	if (!patch.uniq_key) return { code: 400, msg: '配送员唯一键无效' }
	patch.updated_at = Date.now()

	try {
		await deliveries.doc(id).update(patch)
		await recordLog(user, 'delivery_update_v1', { id }, requestId)
		return { code: 0, msg: '更新成功' }
	} catch (err) {
		if (isDuplicateKeyError(err)) return { code: 409, msg: '配送员已存在' }
		console.error('[crm-delivery] updateV1 failed', err)
		return { code: 500, msg: '更新失败' }
	}
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context && (context.requestId || context.request_id) || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'updateV1') return updateV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
