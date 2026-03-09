'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')

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
		console.error('[crm-user] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripSensitive(user) {
	if (!user) return null
	const { password_hash, token, ...rest } = user
	return rest
}

async function listV1(user, data, requestId) {
	void user
	const keyword = normalizeString(data.keyword)
	const limit = Math.min(Math.max(Number(data.limit || 20), 1), 50)
	const conditions = []

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ username: rx }, { name: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await users.where(where).limit(limit).get()
	const list = (res.data || []).map(stripSensitive)
	await recordLog(user, 'user_list_v1', { keyword, limit }, requestId)
	return { code: 0, data: list }
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event
	const requestId = normalizeString(event.request_id || event.requestId || context?.requestId || '') || ''

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'listV1') return listV1(user, data, requestId)
	return { code: 400, msg: '未知 action' }
}
