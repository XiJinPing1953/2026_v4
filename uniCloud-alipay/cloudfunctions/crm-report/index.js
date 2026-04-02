'use strict'

const db = uniCloud.database()
const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const accounts = db.collection('crm_accounts')
const entries = db.collection('crm_voucher_entries')
const reports = db.collection('crm_reports')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-report] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
const PAGE_ACTION_RULES = {
	summaryV1: [{ pagePath: '/pages/accounting/report-summary', action: 'view' }]
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
		console.error('[crm-report] recordLog failed', action, err)
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

function computeBalance(direction, debit, credit) {
	return direction === 'debit' ? debit - credit : credit - debit
}

async function buildTrialBalance(period) {
	const where = period ? { period } : {}
	const [entryRes, accountRes] = await Promise.all([
		entries.where(where).limit(5000).get(),
		accounts.where({}).get()
	])

	const accountMap = new Map()
	accountRes.data.forEach((acc) => {
		accountMap.set(acc.code, acc)
	})

	const sums = new Map()
	entryRes.data.forEach((row) => {
		const key = row.account_code
		if (!sums.has(key)) sums.set(key, { debit: 0, credit: 0, account_name: row.account_name || '' })
		const item = sums.get(key)
		if (row.direction === 'debit') item.debit += row.amount
		else item.credit += row.amount
		if (!item.account_name) item.account_name = row.account_name || ''
	})

	return Array.from(sums.entries()).map(([code, item]) => {
		const acc = accountMap.get(code)
		const direction = acc?.direction || 'debit'
		return {
			account_code: code,
			account_name: item.account_name || acc?.name || '',
			account_type: acc?.type || 'other',
			direction,
			debit: item.debit,
			credit: item.credit,
			balance: computeBalance(direction, item.debit, item.credit)
		}
	})
}

async function summaryV1(user, data, requestId) {
	void user
	const period = normalizeString(data.period)
	if (!period) return { code: 400, msg: '账期必填' }

	const rows = await buildTrialBalance(period)
	const totals = {
		asset: 0,
		liability: 0,
		equity: 0,
		revenue: 0,
		expense: 0,
		cost: 0,
		other: 0
	}

	rows.forEach((row) => {
		const type = totals[row.account_type] != null ? row.account_type : 'other'
		totals[type] += row.balance
	})

	const payload = {
		period,
		trial_balance: rows,
		totals
	}

	const now = Date.now()
	const exists = await reports.where({ period, type: 'trial_balance' }).limit(1).get()
	if (exists.data && exists.data.length) {
		await reports.doc(exists.data[0]._id).update({ payload, created_at: now })
	} else {
		await reports.add({ period, type: 'trial_balance', payload, created_at: now })
	}

	await recordLog(user, 'report_summary_v1', { period }, requestId)
	return { code: 0, data: payload }
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
		cloudFunction: 'crm-report'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'summaryV1') return summaryV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
