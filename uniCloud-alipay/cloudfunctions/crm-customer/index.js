'use strict'

let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-customer] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const customers = db.collection('crm_customers')
const bottles = db.collection('crm_bottles')
const receipts = db.collection('crm_customer_receipts')
const PAGE_ACTION_RULES = {
	listV1: [
		{ pagePath: '/pages/customer/list', action: 'view' },
		{ pagePath: '/pages/pda/customer-query', action: 'view' },
		{ pagePath: '/pages/pda/sale-create', action: 'view' }
	],
	getV1: [
		{ pagePath: '/pages/customer/list', action: 'view' },
		{ pagePath: '/pages/customer/edit', action: 'view' },
		{ pagePath: '/pages/pda/customer-query', action: 'view' },
		{ pagePath: '/pages/pda/sale-create', action: 'view' }
	],
	createV1: [{ pagePath: '/pages/customer/edit', action: 'create' }],
	updateV1: [{ pagePath: '/pages/customer/edit', action: 'update' }]
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
		console.error('[crm-customer] recordLog failed', action, err)
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

function normalizePhone(value) {
	return normalizeString(value).replace(/\s+/g, '')
}

function normalizePriceUnit(value) {
	const unit = normalizeString(value) || 'kg'
	if (unit === 'kg' || unit === 'bottle' || unit === 'm3') return unit
	return null
}

function normalizeBalanceType(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'receivable' || text === 'prepay' || text === 'settled') return text
	return ''
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

function normalizeBizDate(value) {
	const text = normalizeString(value)
	if (!text) return ''
	return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeBoolean(value) {
	return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'
}

function chunkStrings(values = [], size = 180) {
	const source = Array.isArray(values) ? values : []
	const chunkSize = Math.max(Number(size) || 180, 1)
	const result = []
	for (let index = 0; index < source.length; index += chunkSize) {
		result.push(source.slice(index, index + chunkSize))
	}
	return result
}

function buildIdFilterOr(field, ids = []) {
	const chunks = chunkStrings(
		(Array.isArray(ids) ? ids : []).map((item) => normalizeString(item)).filter(Boolean),
		180
	)
	if (!chunks.length) return null
	if (chunks.length === 1) return { [field]: dbCmd.in(chunks[0]) }
	return dbCmd.or(chunks.map((chunk) => ({ [field]: dbCmd.in(chunk) })))
}

async function listCashierUnallocatedCustomerIds({ dateStart = '', dateEnd = '' } = {}) {
	const whereParts = [
		{ status: 'posted' },
		{ source_type: 'cashier_intake' },
		{ unallocated_amount: dbCmd.gt(0.0001) }
	]
	if (dateStart) whereParts.push({ biz_date: dbCmd.gte(dateStart) })
	if (dateEnd) whereParts.push({ biz_date: dbCmd.lte(dateEnd) })
	const where = whereParts.length === 1 ? whereParts[0] : dbCmd.and(whereParts)
	const customerIdSet = new Set()
	let page = 1
	const pageSize = 200
	let hasMore = true
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 300) break
		const res = await receipts
			.where(where)
			.field({ customer_id: true })
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		rows.forEach((row) => {
			const customerId = normalizeString(row && row.customer_id)
			if (customerId) customerIdSet.add(customerId)
		})
		hasMore = rows.length === pageSize
		page += 1
	}
	return Array.from(customerIdSet)
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function toBalanceNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Number(num.toFixed(2))
}

function withBalanceFields(doc = {}) {
	return {
		...doc,
		receivable_balance: toBalanceNumber(doc.receivable_balance),
		prepay_balance: toBalanceNumber(doc.prepay_balance),
		net_balance: toBalanceNumber(doc.net_balance),
		should_receive_total: toBalanceNumber(doc.should_receive_total),
		amount_received_total: toBalanceNumber(doc.amount_received_total),
		last_receipt_at: doc.last_receipt_at == null ? null : Number(doc.last_receipt_at) || null
	}
}

async function attachDepositCounts(items = []) {
	const rows = Array.isArray(items) ? items : []
	const ids = [...new Set(rows.map((item) => normalizeString(item && item._id)).filter(Boolean))]
	if (!ids.length) {
		return rows.map((item) => ({
			...withBalanceFields(item),
			deposit_count: 0,
			deposit_bottle_nos: []
		}))
	}
	const pairs = await Promise.all(
		ids.map(async (id) => {
			const res = await bottles
				.where({ current_customer_id: id })
				.field({ bottle_no: true })
				.orderBy('bottle_no', 'asc')
				.limit(500)
				.get()
			const bottleNos = (res.data || [])
				.map((item) => normalizeString(item && item.bottle_no))
				.filter(Boolean)
			return [id, { count: bottleNos.length, bottleNos }]
		})
	)
	const countMap = Object.fromEntries(pairs)
	return rows.map((item) => ({
		...withBalanceFields(item),
		deposit_count: Number(countMap[normalizeString(item && item._id)]?.count || 0),
		deposit_bottle_nos: countMap[normalizeString(item && item._id)]?.bottleNos || []
	}))
}

function buildUniqKey(name, phone) {
	const n = normalizeString(name)
	const p = normalizePhone(phone)
	return p ? `${n}|${p}` : n
}

async function listV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
	const balanceType = normalizeBalanceType(data.balance_type ?? data.balanceType)
	const updatedDateStart = parseDateStart(data.updated_date_start ?? data.updatedDateStart ?? data.date_start ?? data.dateStart)
	const updatedDateEnd = parseDateEnd(data.updated_date_end ?? data.updatedDateEnd ?? data.date_end ?? data.dateEnd)
	const cashierUnallocatedOnly = normalizeBoolean(data.cashier_unallocated_only ?? data.cashierUnallocatedOnly)
	const cashierDateStart = normalizeBizDate(
		data.cashier_unallocated_date_start ?? data.cashierUnallocatedDateStart ?? data.biz_date_start ?? data.bizDateStart
	)
	const cashierDateEnd = normalizeBizDate(
		data.cashier_unallocated_date_end ?? data.cashierUnallocatedDateEnd ?? data.biz_date_end ?? data.bizDateEnd
	)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 20) || 20, 1),
		50
	)
	const rawSummaryIgnoreActive = data.summary_ignore_active ?? data.summaryIgnoreActive
	const summaryIgnoreActive =
		rawSummaryIgnoreActive === true ||
		rawSummaryIgnoreActive === 1 ||
		rawSummaryIgnoreActive === '1' ||
		rawSummaryIgnoreActive === 'true'
	if (updatedDateStart && updatedDateEnd && updatedDateStart > updatedDateEnd) {
		return { code: 400, msg: '更新时间范围不合法' }
	}
	if (cashierDateStart && cashierDateEnd && cashierDateStart > cashierDateEnd) {
		return { code: 400, msg: '出纳业务日期范围不合法' }
	}

	let activeWhere = null
	if (data.is_active != null) {
		const raw = data.is_active
		if (raw === true || raw === 'true' || raw === 1 || raw === '1') activeWhere = { is_active: true }
		else if (raw === false || raw === 'false' || raw === 0 || raw === '0') activeWhere = { is_active: false }
	}

	let keywordWhere = null
	if (keyword) {
		const escaped = escapeRegExp(keyword)
		const rx = db.RegExp({ regexp: escaped, options: 'i' })
		keywordWhere = dbCmd.or([{ name: rx }, { short_name: rx }, { contact: rx }, { phone: rx }])
	}

	let balanceWhere = null
	if (balanceType === 'receivable') balanceWhere = { net_balance: dbCmd.gt(0) }
	else if (balanceType === 'prepay') balanceWhere = { net_balance: dbCmd.lt(0) }
	else if (balanceType === 'settled') balanceWhere = { net_balance: dbCmd.and(dbCmd.gte(-0.009), dbCmd.lte(0.009)) }

	let updatedWhere = null
	if (updatedDateStart && updatedDateEnd) {
		updatedWhere = { updated_at: dbCmd.and(dbCmd.gte(updatedDateStart), dbCmd.lte(updatedDateEnd)) }
	} else if (updatedDateStart) {
		updatedWhere = { updated_at: dbCmd.gte(updatedDateStart) }
	} else if (updatedDateEnd) {
		updatedWhere = { updated_at: dbCmd.lte(updatedDateEnd) }
	}

	let cashierUnallocatedWhere = null
	if (cashierUnallocatedOnly) {
		const customerIds = await listCashierUnallocatedCustomerIds({
			dateStart: cashierDateStart,
			dateEnd: cashierDateEnd
		})
		if (!customerIds.length) {
			return {
				code: 0,
				data: [],
				total: 0,
				paging: { page, pageSize, total: 0, hasMore: false },
				summary: { total: 0, active: 0, inactive: 0, priced: 0 }
			}
		}
		cashierUnallocatedWhere = buildIdFilterOr('_id', customerIds)
	}

	const buildWhere = ({ ignoreActive = false } = {}) => {
		const parts = []
		if (!ignoreActive && activeWhere) parts.push(activeWhere)
		if (keywordWhere) parts.push(keywordWhere)
		if (balanceWhere) parts.push(balanceWhere)
		if (updatedWhere) parts.push(updatedWhere)
		if (cashierUnallocatedWhere) parts.push(cashierUnallocatedWhere)
		if (!parts.length) return {}
		if (parts.length === 1) return parts[0]
		return dbCmd.and(parts)
	}
	const mergeWhere = (base, extra, hasBaseFilter) => (hasBaseFilter ? dbCmd.and([base, extra]) : extra)
	const hasListFilter = Boolean(activeWhere || keywordWhere || balanceWhere || updatedWhere || cashierUnallocatedWhere)

	const where = buildWhere()

	const res = await customers
		.where(where)
		.field({ uniq_key: false })
		.orderBy('updated_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await customers.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total

	const summaryWhere = buildWhere({ ignoreActive: summaryIgnoreActive })
	const hasSummaryFilter = summaryIgnoreActive
		? Boolean(keywordWhere || balanceWhere || updatedWhere || cashierUnallocatedWhere)
		: hasListFilter
	const summaryTotalRes = await customers.where(summaryWhere).count()
	const summaryTotal = Number(summaryTotalRes.total || 0)

	let activeCount = 0
	let inactiveCount = 0
	if (summaryIgnoreActive || !activeWhere) {
		const activeRes = await customers
			.where(mergeWhere(summaryWhere, { is_active: true }, hasSummaryFilter))
			.count()
		const inactiveRes = await customers
			.where(mergeWhere(summaryWhere, { is_active: false }, hasSummaryFilter))
			.count()
		activeCount = Number(activeRes.total || 0)
		inactiveCount = Number(inactiveRes.total || 0)
	} else if (activeWhere.is_active === true) {
		activeCount = summaryTotal
	} else if (activeWhere.is_active === false) {
		inactiveCount = summaryTotal
	}

	const pricedRes = await customers
		.where(mergeWhere(summaryWhere, { default_unit_price: dbCmd.gt(0) }, hasSummaryFilter))
		.count()

	return {
		code: 0,
		data: await attachDepositCounts(res.data || []),
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		},
		summary: {
			total: summaryTotal,
			active: activeCount,
			inactive: inactiveCount,
			priced: Number(pricedRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少客户 ID' }
	const res = await customers.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '客户不存在' }
	const items = await attachDepositCounts([doc])
	return { code: 0, data: items[0] || withBalanceFields(doc) }
}

async function createV1(user, data, requestId) {
	const name = normalizeString(data.name)
	if (!name) return { code: 400, msg: '客户名称必填' }

	const phone = normalizePhone(data.phone)
	const uniqKey = buildUniqKey(name, phone)
	if (!uniqKey) return { code: 400, msg: '客户唯一键无效' }

	const defaultPriceUnit = normalizePriceUnit(data.default_price_unit)
	if (!defaultPriceUnit) return { code: 400, msg: '计价单位仅支持 kg/bottle/m3' }

	const now = Date.now()
	const doc = {
		uniq_key: uniqKey,
		name,
		short_name: normalizeString(data.short_name),
		contact: normalizeString(data.contact),
		phone,
		address: normalizeString(data.address),
		remark: normalizeString(data.remark),
		is_active: true,
		default_unit_price: toNumber(data.default_unit_price, null),
		default_price_unit: defaultPriceUnit,
		receivable_balance: 0,
		prepay_balance: 0,
		net_balance: 0,
		should_receive_total: 0,
		amount_received_total: 0,
		last_receipt_at: null,
		created_at: now,
		updated_at: now
	}

	const res = await customers.add(doc)
	await recordLog(user, 'customer_create_v1', { id: res.id }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少客户 ID' }

	const current = await customers
		.doc(id)
		.field({ name: true, phone: true, short_name: true, contact: true })
		.get()
	const existing = (current.data && current.data[0]) || null
	if (!existing) return { code: 404, msg: '客户不存在' }

	const patch = {}
	if (data.name != null) patch.name = normalizeString(data.name)
	if (data.short_name != null) patch.short_name = normalizeString(data.short_name)
	if (data.contact != null) patch.contact = normalizeString(data.contact)
	if (data.phone != null) patch.phone = normalizePhone(data.phone)
	if (data.address != null) patch.address = normalizeString(data.address)
	if (data.remark != null) patch.remark = normalizeString(data.remark)
	if (data.is_active != null) patch.is_active = Boolean(data.is_active)
	if (data.default_unit_price != null) patch.default_unit_price = toNumber(data.default_unit_price, null)
	if (data.default_price_unit != null) {
		const unit = normalizePriceUnit(data.default_price_unit)
		if (!unit) return { code: 400, msg: '计价单位仅支持 kg/bottle/m3' }
		patch.default_price_unit = unit
	}

	if (patch.short_name == null) patch.short_name = normalizeString(existing.short_name)
	if (patch.contact == null) patch.contact = normalizeString(existing.contact)

	if (patch.name != null || patch.phone != null) {
		const nextName = patch.name != null ? patch.name : existing.name
		const nextPhone = patch.phone != null ? patch.phone : existing.phone
		patch.uniq_key = buildUniqKey(nextName, nextPhone)
	}

	patch.updated_at = Date.now()

	await customers.doc(id).update(patch)
	await recordLog(user, 'customer_update_v1', { id }, requestId)
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
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, [], {
		recordLog,
		requestId,
		cloudFunction: 'crm-customer'
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'updateV1') return updateV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
