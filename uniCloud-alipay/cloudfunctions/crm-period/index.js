'use strict'

const db = uniCloud.database()

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const periods = db.collection('crm_periods')

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
		console.error('[crm-period] recordLog failed', action, err)
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

async function listV1(user) {
	void user
	const res = await periods.orderBy('period', 'desc').get()
	return { code: 0, data: res.data || [] }
}

async function createV1(user, data, requestId) {
	const period = normalizeString(data.period)
	if (!period) return { code: 400, msg: '账期必填' }
	const now = Date.now()
	const doc = {
		period,
		status: 'open',
		closed_at: null,
		closed_by: null,
		closed_by_name: '',
		created_at: now,
		updated_at: now
	}
	const res = await periods.add(doc)
	await recordLog(user, 'period_create_v1', { id: res.id, period }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function closeV1(user, data, requestId) {
	const period = normalizeString(data.period)
	if (!period) return { code: 400, msg: '账期必填' }

	await periods.where({ period }).update({
		status: 'closed',
		closed_at: Date.now(),
		closed_by: user?._id || null,
		closed_by_name: user?.username || '',
		updated_at: Date.now()
	})
	await recordLog(user, 'period_close_v1', { period }, requestId)
	return { code: 0, msg: '已结账' }
}

async function reopenV1(user, data, requestId) {
	const period = normalizeString(data.period)
	if (!period) return { code: 400, msg: '账期必填' }

	await periods.where({ period }).update({
		status: 'open',
		closed_at: null,
		closed_by: null,
		closed_by_name: '',
		updated_at: Date.now()
	})
	await recordLog(user, 'period_reopen_v1', { period }, requestId)
	return { code: 0, msg: '已反结账' }
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
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'closeV1') return closeV1(user, data, requestId)
	if (action === 'reopenV1') return reopenV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
