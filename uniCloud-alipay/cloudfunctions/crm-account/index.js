'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const accounts = db.collection('crm_accounts')

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense', 'cost', 'other']
const ACCOUNT_DIRECTIONS = ['debit', 'credit']

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
		console.error('[crm-account] recordLog failed', action, err)
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

function normalizeCode(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeType(value) {
	const type = normalizeString(value)
	return ACCOUNT_TYPES.includes(type) ? type : ''
}

function normalizeDirection(value) {
	const dir = normalizeString(value)
	return ACCOUNT_DIRECTIONS.includes(dir) ? dir : ''
}

function inferLevel(code) {
	if (!code) return 1
	const digits = code.replace(/\D/g, '')
	if (!digits) return 1
	return Math.max(1, Math.floor(digits.length / 2))
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 50) || 50, 1),
		200
	)

	const conditions = []
	if (data.is_active != null) {
		const raw = data.is_active
		if (raw === true || raw === 'true' || raw === 1 || raw === '1') conditions.push({ is_active: true })
		else if (raw === false || raw === 'false' || raw === 0 || raw === '0') conditions.push({ is_active: false })
	}

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ code: rx }, { name: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await accounts
		.where(where)
		.orderBy('code', 'asc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()
	const totalRes = await accounts.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const hasBaseFilter = conditions.length > 0
	const mergeWhere = (extra) => (hasBaseFilter ? dbCmd.and([where, extra]) : extra)

	const activeRes = await accounts.where(mergeWhere({ is_active: true })).count()
	const inactiveRes = await accounts.where(mergeWhere({ is_active: false })).count()
	const withParentRes = await accounts.where(mergeWhere({ parent_code: dbCmd.neq('') })).count()

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
			with_parent: Number(withParentRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少科目 ID' }
	const res = await accounts.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '科目不存在' }
	return { code: 0, data: doc }
}

async function createV1(user, data, requestId) {
	const code = normalizeCode(data.code)
	if (!code) return { code: 400, msg: '科目编码必填' }
	const name = normalizeString(data.name)
	if (!name) return { code: 400, msg: '科目名称必填' }
	const type = normalizeType(data.type)
	if (!type) return { code: 400, msg: '科目类型无效' }
	const direction = normalizeDirection(data.direction)
	if (!direction) return { code: 400, msg: '余额方向无效' }

	const now = Date.now()
	const level = Number.isFinite(Number(data.level)) ? Number(data.level) : inferLevel(code)
	const doc = {
		code,
		name,
		type,
		direction,
		level,
		parent_code: data.parent_code ? normalizeCode(data.parent_code) : null,
		is_active: data.is_active == null ? true : Boolean(data.is_active),
		remark: normalizeString(data.remark),
		created_at: now,
		updated_at: now
	}

	const res = await accounts.add(doc)
	await recordLog(user, 'account_create_v1', { id: res.id, code }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少科目 ID' }

	const patch = {}
	if (data.code != null) patch.code = normalizeCode(data.code)
	if (data.name != null) patch.name = normalizeString(data.name)
	if (data.type != null) {
		const type = normalizeType(data.type)
		if (!type) return { code: 400, msg: '科目类型无效' }
		patch.type = type
	}
	if (data.direction != null) {
		const direction = normalizeDirection(data.direction)
		if (!direction) return { code: 400, msg: '余额方向无效' }
		patch.direction = direction
	}
	if (data.level != null) patch.level = Number(data.level) || 1
	if (data.parent_code != null) patch.parent_code = data.parent_code ? normalizeCode(data.parent_code) : null
	if (data.is_active != null) patch.is_active = Boolean(data.is_active)
	if (data.remark != null) patch.remark = normalizeString(data.remark)
	patch.updated_at = Date.now()

	await accounts.doc(id).update(patch)
	await recordLog(user, 'account_update_v1', { id }, requestId)
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
