'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const vouchers = db.collection('crm_vouchers')
const entries = db.collection('crm_voucher_entries')

const DIRECTIONS = ['debit', 'credit']

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
		console.error('[crm-voucher] recordLog failed', action, err)
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

function normalizeDate(value) {
	return normalizeString(value)
}

function normalizePeriod(date) {
	if (!date) return ''
	const parts = String(date).split('-')
	if (parts.length < 2) return ''
	return `${parts[0]}-${parts[1]}`
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function normalizeDirection(value) {
	const dir = normalizeString(value)
	return DIRECTIONS.includes(dir) ? dir : ''
}

function generateVoucherNo(date) {
	const day = String(date || '').replace(/-/g, '')
	const suffix = String(Date.now() % 100000).padStart(5, '0')
	return `V-${day || '00000000'}-${suffix}`
}

function normalizeEntries(input = []) {
	if (!Array.isArray(input)) return []
	return input
		.map((row) => {
			const accountCode = normalizeString(row.account_code || row.accountCode)
			const accountName = normalizeString(row.account_name || row.accountName)
			const direction = normalizeDirection(row.direction)
			const amount = toNumber(row.amount, null)
			const summary = normalizeString(row.summary)
			if (!accountCode || !accountName || !direction || !(typeof amount === 'number' && amount > 0)) return null
			return {
				account_code: accountCode,
				account_name: accountName,
				direction,
				amount,
				summary,
				aux: row.aux && typeof row.aux === 'object' ? row.aux : {}
			}
		})
		.filter(Boolean)
}

function calcTotals(rows) {
	return rows.reduce(
		(acc, row) => {
			if (row.direction === 'debit') acc.debit += row.amount
			else acc.credit += row.amount
			return acc
		},
		{ debit: 0, credit: 0 }
	)
}

async function listV1(user, data) {
	void user
	const status = normalizeString(data.status)
	const keyword = normalizeString(data.keyword)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || 20) || 20, 1), 50)

	const conditions = []
	if (status) conditions.push({ status })
	if (dateStart && dateEnd) {
		conditions.push({ date: dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd)) })
	} else if (dateStart) {
		conditions.push({ date: dbCmd.gte(dateStart) })
	} else if (dateEnd) {
		conditions.push({ date: dbCmd.lte(dateEnd) })
	}
	if (keyword) {
		const rx = db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
		conditions.push(dbCmd.or([{ voucher_no: rx }, { summary: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await vouchers
		.where(where)
		.orderBy('date', 'desc')
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()
	const totalRes = await vouchers.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const hasBaseFilter = conditions.length > 0
	const mergeWhere = (extra) => (hasBaseFilter ? dbCmd.and([where, extra]) : extra)

	const postedRes = await vouchers.where(mergeWhere({ status: 'posted' })).count()
	const draftRes = await vouchers.where(mergeWhere({ status: 'draft' })).count()
	const withSummaryRes = await vouchers.where(mergeWhere({ summary: dbCmd.neq('') })).count()

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
			posted: Number(postedRes.total || 0),
			draft: Number(draftRes.total || 0),
			with_summary: Number(withSummaryRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少凭证 ID' }
	const res = await vouchers.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '凭证不存在' }
	const entryRes = await entries.where({ voucher_id: id }).orderBy('created_at', 'asc').get()
	return { code: 0, data: { ...doc, entries: entryRes.data || [] } }
}

async function createV1(user, data, requestId) {
	const date = normalizeDate(data.date)
	if (!date) return { code: 400, msg: '日期必填' }
	const period = normalizePeriod(date)
	if (!period) return { code: 400, msg: '账期无效' }
	const summary = normalizeString(data.summary)
	if (!summary) return { code: 400, msg: '摘要必填' }

	const rows = normalizeEntries(data.entries)
	if (rows.length < 2) return { code: 400, msg: '至少两条分录' }

	const totals = calcTotals(rows)
	if (Math.abs(totals.debit - totals.credit) > 0.0001) return { code: 400, msg: '借贷不平衡' }

	const now = Date.now()
	const voucherNo = normalizeString(data.voucher_no) || generateVoucherNo(date)
	const doc = {
		date,
		period,
		voucher_no: voucherNo,
		summary,
		status: 'draft',
		total_debit: totals.debit,
		total_credit: totals.credit,
		created_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || '',
		updated_at: now,
		posted_at: null,
		posted_by: null,
		posted_by_name: '',
		source: normalizeString(data.source) || 'manual'
	}

	const res = await vouchers.add(doc)
	const voucherId = res.id
	const entryDocs = rows.map((row) => ({
		voucher_id: voucherId,
		voucher_no: voucherNo,
		date,
		period,
		account_code: row.account_code,
		account_name: row.account_name,
		direction: row.direction,
		amount: row.amount,
		summary: row.summary,
		aux: row.aux || {},
		created_at: now
	}))

	if (entryDocs.length) await entries.add(entryDocs)
	await recordLog(user, 'voucher_create_v1', { id: voucherId, voucher_no: voucherNo }, requestId)

	return { code: 0, msg: '创建成功', data: { _id: voucherId, voucher_no: voucherNo } }
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少凭证 ID' }

	const res = await vouchers.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '凭证不存在' }
	if (doc.status === 'posted') return { code: 400, msg: '已过账凭证不可修改' }

	const patch = {}
	if (data.date != null) {
		const date = normalizeDate(data.date)
		if (!date) return { code: 400, msg: '日期无效' }
		patch.date = date
		patch.period = normalizePeriod(date)
	}
	if (data.summary != null) patch.summary = normalizeString(data.summary)
	patch.updated_at = Date.now()

	const rows = data.entries ? normalizeEntries(data.entries) : null
	if (rows) {
		if (rows.length < 2) return { code: 400, msg: '至少两条分录' }
		const totals = calcTotals(rows)
		if (Math.abs(totals.debit - totals.credit) > 0.0001) return { code: 400, msg: '借贷不平衡' }
		patch.total_debit = totals.debit
		patch.total_credit = totals.credit

		await entries.where({ voucher_id: id }).remove()
		const entryDocs = rows.map((row) => ({
			voucher_id: id,
			voucher_no: doc.voucher_no,
			date: patch.date || doc.date,
			period: patch.period || doc.period,
			account_code: row.account_code,
			account_name: row.account_name,
			direction: row.direction,
			amount: row.amount,
			summary: row.summary,
			aux: row.aux || {},
			created_at: Date.now()
		}))
		if (entryDocs.length) await entries.add(entryDocs)
	}

	await vouchers.doc(id).update(patch)
	await recordLog(user, 'voucher_update_v1', { id }, requestId)
	return { code: 0, msg: '更新成功' }
}

async function postV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少凭证 ID' }
	const res = await vouchers.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '凭证不存在' }
	if (doc.status === 'posted') return { code: 400, msg: '凭证已过账' }

	await vouchers.doc(id).update({
		status: 'posted',
		posted_at: Date.now(),
		posted_by: user?._id || null,
		posted_by_name: user?.username || '',
		updated_at: Date.now()
	})

	await recordLog(user, 'voucher_post_v1', { id }, requestId)
	return { code: 0, msg: '已过账' }
}

async function unpostV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少凭证 ID' }
	const res = await vouchers.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '凭证不存在' }
	if (doc.status !== 'posted') return { code: 400, msg: '凭证未过账' }

	await vouchers.doc(id).update({
		status: 'draft',
		posted_at: null,
		posted_by: null,
		posted_by_name: '',
		updated_at: Date.now()
	})

	await recordLog(user, 'voucher_unpost_v1', { id }, requestId)
	return { code: 0, msg: '已反过账' }
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
	if (action === 'postV1') return postV1(user, data, requestId)
	if (action === 'unpostV1') return unpostV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
