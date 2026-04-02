'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-log] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}

const READ_ROLES = ['superadmin', 'admin', 'finance']
const AUTH_ACTIONS = [
	'register_admin',
	'login',
	'refresh_token',
	'list_users',
	'create_user',
	'remove_user',
	'update_role',
	'user_list_v1'
]
const PAGE_ACTION_RULES = {
	listOperationLogsV1: [{ pagePath: '/pages/log/list', action: 'view' }]
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function normalizeCategory(value) {
	return normalizeString(value).toLowerCase()
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseDateStart(value) {
	const text = normalizeString(value)
	if (!text) return 0
	const date = new Date(`${text}T00:00:00`)
	const timestamp = date.getTime()
	return Number.isFinite(timestamp) ? timestamp : 0
}

function parseDateEnd(value) {
	const text = normalizeString(value)
	if (!text) return 0
	const date = new Date(`${text}T23:59:59.999`)
	const timestamp = date.getTime()
	return Number.isFinite(timestamp) ? timestamp : 0
}

async function getUserByToken(token) {
	const safeToken = normalizeString(token)
	if (!safeToken) return null
	const res = await users.where({ token: safeToken }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordForbidden(user, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action: 'operation_log_forbidden',
			detail: {},
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-log] recordForbidden failed', err)
	}
}

function hasReadPermission(user) {
	return READ_ROLES.includes(normalizeRole(user?.role))
}

function buildActionCategoryCondition(category) {
	const normalized = normalizeCategory(category)
	if (!normalized) return { condition: null }

	if (normalized === 'auth') {
		return {
			condition: {
				action: db.RegExp({
					regexp: `^(${AUTH_ACTIONS.join('|')})$`,
					options: 'i'
				})
			}
		}
	}
	if (normalized === 'customer') {
		return { condition: { action: db.RegExp({ regexp: '^customer_', options: 'i' }) } }
	}
	if (normalized === 'sale') {
		return { condition: { action: db.RegExp({ regexp: '^sale_', options: 'i' }) } }
	}
	if (normalized === 'bottle') {
		return { condition: { action: db.RegExp({ regexp: '^bottle(_anomaly|_movement)?_', options: 'i' }) } }
	}
	if (normalized === 'filling') {
		return { condition: { action: db.RegExp({ regexp: '^filling_', options: 'i' }) } }
	}
	if (normalized === 'vehicle') {
		return { condition: { action: db.RegExp({ regexp: '^vehicle_', options: 'i' }) } }
	}
	if (normalized === 'delivery') {
		return { condition: { action: db.RegExp({ regexp: '^delivery_', options: 'i' }) } }
	}
	if (normalized === 'accounting') {
		return {
			condition: {
				action: db.RegExp({
					regexp: '^(account_|voucher_|ledger_|period_|report_)',
					options: 'i'
				})
			}
		}
	}
	if (normalized === 'collection') {
		return { condition: { action: db.RegExp({ regexp: '^collection_', options: 'i' }) } }
	}
	if (normalized === 'dashboard') {
		return { condition: { action: db.RegExp({ regexp: '^dashboard_', options: 'i' }) } }
	}
	if (normalized === 'security') {
		return { condition: { action: db.RegExp({ regexp: 'forbidden', options: 'i' }) } }
	}
	if (normalized === 'other') {
		return {
			condition: {
				action: db.RegExp({
					regexp:
						`^(?!(${AUTH_ACTIONS.join('|')})$|customer_|sale_|bottle(_anomaly|_movement)?_|filling_|vehicle_|delivery_|(account_|voucher_|ledger_|period_|report_)|collection_|dashboard_|.*forbidden).+`,
					options: 'i'
				})
			}
		}
	}
	return { error: '动作分类不合法' }
}

function buildWhere(data) {
	const conditions = []
	const keyword = normalizeString(data.keyword)
	const role = normalizeRole(data.role)
	const action = normalizeString(data.action)
	const actionCategory = normalizeCategory(data.actionCategory || data.action_category || data.category)
	const dateStart = parseDateStart(data.dateStart || data.date_from || data.dateFrom)
	const dateEnd = parseDateEnd(data.dateEnd || data.date_to || data.dateTo)

	if (dateStart && dateEnd && dateStart > dateEnd) {
		return { error: '日期范围不合法' }
	}

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ username: rx }, { action: rx }, { request_id: rx }]))
	}

	if (role) conditions.push({ role })
	if (action) conditions.push({ action })
	const { condition: categoryCondition, error: categoryError } = buildActionCategoryCondition(actionCategory)
	if (categoryError) return { error: categoryError }
	if (categoryCondition) conditions.push(categoryCondition)

	if (dateStart && dateEnd) {
		conditions.push({ created_at: dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd)) })
	} else if (dateStart) {
		conditions.push({ created_at: dbCmd.gte(dateStart) })
	} else if (dateEnd) {
		conditions.push({ created_at: dbCmd.lte(dateEnd) })
	}

	if (!conditions.length) return { where: {} }
	if (conditions.length === 1) return { where: conditions[0] }
	return { where: dbCmd.and(conditions) }
}

function sanitizeLog(doc) {
	if (!doc) return null
	return {
		_id: normalizeString(doc._id),
		user_id: normalizeString(doc.user_id),
		username: normalizeString(doc.username),
		role: normalizeRole(doc.role),
		action: normalizeString(doc.action),
		detail: doc.detail && typeof doc.detail === 'object' ? doc.detail : {},
		request_id: normalizeString(doc.request_id),
		created_at: Number(doc.created_at) || 0
	}
}

async function listOperationLogsV1(user, data, requestId) {
	if (!hasReadPermission(user)) {
		await recordForbidden(user, requestId)
		return { code: 403, msg: '无权限查看操作日志' }
	}

	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || 50) || 50, 1), 200)
	const { where, error } = buildWhere(data || {})
	if (error) return { code: 400, msg: error }

	const [countRes, listRes] = await Promise.all([
		logs.where(where).count(),
		logs
			.where(where)
			.orderBy('created_at', 'desc')
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get()
	])

	const total = Number(countRes?.total || 0)
	const rows = (listRes?.data || []).map(sanitizeLog).filter(Boolean)

	return {
		code: 0,
		data: rows,
		paging: {
			page,
			pageSize,
			total,
			hasMore: page * pageSize < total
		}
	}
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event
	const requestId = normalizeString(event.request_id || event.requestId || context?.requestId || '')
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, [], {
		recordLog: recordForbidden,
		requestId,
		cloudFunction: 'crm-log'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'listOperationLogsV1') return listOperationLogsV1(user, data, requestId)
	return { code: 400, msg: '未知 action' }
}
