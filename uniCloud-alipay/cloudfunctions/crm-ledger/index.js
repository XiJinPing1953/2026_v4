'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const accounts = db.collection('crm_accounts')
const entries = db.collection('crm_voucher_entries')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-ledger] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
const PAGE_ACTION_RULES = {
	trialBalanceV1: [{ pagePath: '/pages/accounting/trial-balance', action: 'view' }],
	generalLedgerV1: [{ pagePath: '/pages/accounting/ledger-general', action: 'view' }],
	subLedgerV1: [{ pagePath: '/pages/accounting/ledger-sub', action: 'view' }],
	receivableDetailV1: [{ pagePath: '/pages/accounting/receivable-detail', action: 'view' }]
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
		console.error('[crm-ledger] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	const num = Number(value)
	return Number.isFinite(num) ? Number(num.toFixed(2)) : 0
}

async function sumEntriesByDirection(where) {
	const batchSize = 500
	let skip = 0
	let debit = 0
	let credit = 0

	while (true) {
		const res = await entries
			.where(where)
			.field({ direction: true, amount: true })
			.skip(skip)
			.limit(batchSize)
			.get()
		const rows = res.data || []
		if (!rows.length) break
		for (const row of rows) {
			if (row.direction === 'debit') debit += toNumber(row.amount, 0)
			else if (row.direction === 'credit') credit += toNumber(row.amount, 0)
		}
		if (rows.length < batchSize) break
		skip += rows.length
	}

	return {
		debit: fix2(debit),
		credit: fix2(credit)
	}
}

async function trialBalanceV1(user, data, requestId) {
	void user
	const period = normalizeString(data.period)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const limit = Math.min(Math.max(Number(data.limit || 2000) || 2000, 1), 5000)

	const where = {}
	if (period) where.period = period
	if (dateStart && dateEnd) {
		where.date = dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd))
	} else if (dateStart) {
		where.date = dbCmd.gte(dateStart)
	} else if (dateEnd) {
		where.date = dbCmd.lte(dateEnd)
	}

	const [entryRes, accountRes] = await Promise.all([
		entries.where(where).limit(limit).get(),
		accounts.where({}).get()
	])

	const accountMap = new Map()
	accountRes.data.forEach((acc) => {
		accountMap.set(acc.code, acc)
	})

	const sums = new Map()
	entryRes.data.forEach((row) => {
		const key = row.account_code
		if (!sums.has(key)) {
			sums.set(key, { debit: 0, credit: 0, account_name: row.account_name || '' })
		}
		const item = sums.get(key)
		if (row.direction === 'debit') item.debit += row.amount
		else item.credit += row.amount
		if (!item.account_name) item.account_name = row.account_name || ''
	})

	const rows = Array.from(sums.entries()).map(([code, item]) => {
		const acc = accountMap.get(code)
		const direction = acc?.direction || 'debit'
		const balance = direction === 'debit' ? item.debit - item.credit : item.credit - item.debit
		return {
			account_code: code,
			account_name: item.account_name || acc?.name || '',
			account_type: acc?.type || '',
			direction,
			debit: item.debit,
			credit: item.credit,
			balance
		}
	})

	rows.sort((a, b) => a.account_code.localeCompare(b.account_code))
	await recordLog(user, 'ledger_trial_balance_v1', { period, dateStart, dateEnd }, requestId)
	return { code: 0, data: rows }
}

async function generalLedgerV1(user, data, requestId, logAction = 'ledger_general_v1') {
	void user
	const accountCode = normalizeString(data.account_code || data.accountCode)
	if (!accountCode) return { code: 400, msg: '缺少科目编码' }
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize ?? data.limit ?? 50) || 50, 1), 200)

	const where = { account_code: accountCode }
	if (dateStart && dateEnd) where.date = dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd))
	else if (dateStart) where.date = dbCmd.gte(dateStart)
	else if (dateEnd) where.date = dbCmd.lte(dateEnd)

	const res = await entries
		.where(where)
		.orderBy('date', 'asc')
		.orderBy('created_at', 'asc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await entries.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const sums = await sumEntriesByDirection(where)

	await recordLog(user, logAction, { account_code: accountCode, dateStart, dateEnd, page, pageSize }, requestId)
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
			debit: sums.debit,
			credit: sums.credit
		}
	}
}

async function subLedgerV1(user, data, requestId) {
	return generalLedgerV1(user, data, requestId, 'ledger_sub_v1')
}

async function receivableDetailV1(user, data, requestId) {
	void user
	const keyword = normalizeString(data.keyword)
	const customerId = normalizeString(data.customer_id || data.customerId)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || 50) || 50, 1), 200)

	const conditions = [{ account_code: '1122' }]
	if (customerId) conditions.push({ 'aux.customer_id': customerId })
	if (dateStart && dateEnd) conditions.push({ date: dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd)) })
	else if (dateStart) conditions.push({ date: dbCmd.gte(dateStart) })
	else if (dateEnd) conditions.push({ date: dbCmd.lte(dateEnd) })

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ 'aux.customer_name': rx }, { voucher_no: rx }, { summary: rx }]))
	}

	const where = conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await entries
		.where(where)
		.orderBy('date', 'desc')
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await entries.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const sums = await sumEntriesByDirection(where)

	await recordLog(user, 'ledger_receivable_detail_v1', { keyword, customer_id: customerId }, requestId)
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
			debit: sums.debit,
			credit: sums.credit
		}
	}
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, [], {
		recordLog,
		requestId,
		cloudFunction: 'crm-ledger'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'trialBalanceV1') return trialBalanceV1(user, data, requestId)
	if (action === 'generalLedgerV1') return generalLedgerV1(user, data, requestId)
	if (action === 'subLedgerV1') return subLedgerV1(user, data, requestId)
	if (action === 'receivableDetailV1') return receivableDetailV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
