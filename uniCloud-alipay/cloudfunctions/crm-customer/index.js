'use strict'

let ensureActionAcl = null
let isSuperAdmin = null
try {
	;({ ensureActionAcl, isSuperAdmin } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-customer] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl, isSuperAdmin } = require('./pageAclLocal'))
}
const db = uniCloud.database()
const dbCmd = db.command
const {
	normalizeVisibility,
	isSuperAdminUser,
	visibleCustomerWhere,
	customerVisibilityWhere,
	collectCustomerAndDescendantIds,
	docIsHiddenCustomer
} = require('./customerVisibilityLocal')

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
	resolveQrCodeV1: [{ pagePath: '/pages/pda/sale-create', action: 'view' }],
	createV1: [{ pagePath: '/pages/customer/edit', action: 'create' }],
	updateV1: [{ pagePath: '/pages/customer/edit', action: 'update' }],
	hideCustomerV1: [{ pagePath: '/pages/customer/edit', action: 'update' }],
	unhideCustomerV1: [{ pagePath: '/pages/customer/edit', action: 'update' }]
}
const SUPERADMIN_ONLY_ACTIONS = ['hideCustomerV1', 'unhideCustomerV1']

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

function currentIsSuperAdmin(user) {
	return typeof isSuperAdmin === 'function' ? isSuperAdmin(user) : isSuperAdminUser(user)
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizePhone(value) {
	return normalizeString(value).replace(/\s+/g, '')
}

function normalizeQrCode(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
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
	const selfId = normalizeString(doc._id)
	const settlementCustomerId = normalizeString(doc.settlement_customer_id)
	const isSettlementChild = Boolean(settlementCustomerId && settlementCustomerId !== selfId)
	const settlementCustomerName = isSettlementChild ? normalizeString(doc.settlement_customer_name) : ''
	return {
		...doc,
		settlement_customer_id: isSettlementChild ? settlementCustomerId : '',
		settlement_customer_name: settlementCustomerName,
		effective_settlement_customer_id: isSettlementChild ? settlementCustomerId : selfId,
		effective_settlement_customer_name: isSettlementChild ? settlementCustomerName : normalizeString(doc.name),
		is_settlement_child: isSettlementChild,
		receivable_balance: toBalanceNumber(doc.receivable_balance),
		prepay_balance: toBalanceNumber(doc.prepay_balance),
		prepay_manual_balance: toBalanceNumber(doc.prepay_manual_balance),
		receipt_unallocated_balance: toBalanceNumber(doc.receipt_unallocated_balance),
		offset_credit_balance: toBalanceNumber(doc.offset_credit_balance),
		net_balance: toBalanceNumber(doc.net_balance),
		should_receive_total: toBalanceNumber(doc.should_receive_total),
		amount_received_total: toBalanceNumber(doc.amount_received_total),
		last_receipt_at: doc.last_receipt_at == null ? null : Number(doc.last_receipt_at) || null
	}
}

function resolveCustomerDefaultPricing(doc = {}) {
	const priceUnit = normalizePriceUnit(doc.default_price_unit)
	const unitPrice = toNumber(doc.default_unit_price, null)
	if (!priceUnit || !(unitPrice > 0)) return null
	return {
		unit_price: unitPrice,
		price_unit: priceUnit
	}
}

async function getCustomerById(customerId) {
	const id = normalizeString(customerId)
	if (!id) return null
	const res = await customers.doc(id).get()
	return (res.data && res.data[0]) || null
}

async function resolveSettlementCustomerRef(rawSettlementCustomerId, currentCustomerId = '') {
	const currentId = normalizeString(currentCustomerId)
	const firstId = normalizeString(rawSettlementCustomerId)
	if (!firstId || firstId === currentId) {
		return { ok: true, id: '', name: '', customer: null }
	}

	const visited = new Set(currentId ? [currentId] : [])
	let cursorId = firstId
	let cursor = null
	for (let depth = 0; depth < 10; depth += 1) {
		if (visited.has(cursorId)) {
			return { ok: false, code: 400, msg: '结算客户不能循环绑定' }
		}
		visited.add(cursorId)
		cursor = await getCustomerById(cursorId)
		if (!cursor) return { ok: false, code: 400, msg: '结算客户不存在' }
		if (docIsHiddenCustomer(cursor)) return { ok: false, code: 400, msg: '结算客户已隐藏' }
		const parentId = normalizeString(cursor.settlement_customer_id)
		if (!parentId || parentId === cursorId) {
			return {
				ok: true,
				id: normalizeString(cursor._id),
				name: normalizeString(cursor.name),
				customer: cursor
			}
		}
		cursorId = parentId
	}
	return { ok: false, code: 400, msg: '结算客户绑定层级过深' }
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
		rows.map(async (item) => {
			const id = normalizeString(item && item._id)
			const isChild = Boolean(normalizeString(item && item.settlement_customer_id))
			let locationDocs = [{ _id: id, name: normalizeString(item && item.name) }]
			if (!isChild) {
				const childRes = await customers
					.where(dbCmd.and([{ settlement_customer_id: id }, visibleCustomerWhere(dbCmd)]))
					.field({ _id: true, name: true })
					.orderBy('updated_at', 'desc')
					.limit(200)
					.get()
				const childDocs = (childRes.data || [])
					.map((child) => ({
						_id: normalizeString(child && child._id),
						name: normalizeString(child && child.name)
					}))
					.filter((child) => child._id && child._id !== id)
				locationDocs = [...locationDocs, ...childDocs]
			}
			const locationIds = locationDocs.map((location) => location._id).filter(Boolean)
			const res = await bottles
				.where({ current_customer_id: dbCmd.in(locationIds) })
				.field({ bottle_no: true, current_customer_id: true, current_customer_name: true })
				.orderBy('bottle_no', 'asc')
				.limit(500)
				.get()
			const locationMap = new Map(
				locationDocs.map((location) => [
					location._id,
					{ customer_id: location._id, customer_name: location.name, count: 0, bottle_nos: [] }
				])
			)
			const bottleNos = []
			;(res.data || []).forEach((row) => {
				const bottleNo = normalizeString(row && row.bottle_no)
				const customerId = normalizeString(row && row.current_customer_id)
				if (!bottleNo || !customerId) return
				bottleNos.push(bottleNo)
				if (!locationMap.has(customerId)) {
					locationMap.set(customerId, {
						customer_id: customerId,
						customer_name: normalizeString(row && row.current_customer_name),
						count: 0,
						bottle_nos: []
					})
				}
				const location = locationMap.get(customerId)
				location.count += 1
				location.bottle_nos.push(bottleNo)
			})
			const depositLocations = Array.from(locationMap.values())
				.filter((location) => location.count > 0 || location.customer_id === id)
				.map((location) => ({
					...location,
					bottle_nos: location.bottle_nos.slice(0, 50)
				}))
			return [id, { count: bottleNos.length, bottleNos, depositLocations }]
		})
	)
	const countMap = Object.fromEntries(pairs)
	const settlementIds = [
		...new Set(
			rows
				.map((item) => normalizeString(item && item.settlement_customer_id))
				.filter(Boolean)
		)
	]
	const settlementMap = new Map()
	for (const chunk of chunkStrings(settlementIds, 100)) {
		const res = await customers
			.where({ _id: dbCmd.in(chunk) })
			.field({
				_id: true,
				name: true,
				default_unit_price: true,
				default_price_unit: true
			})
			.get()
		;(res.data || []).forEach((row) => {
			const id = normalizeString(row && row._id)
			if (id) settlementMap.set(id, row)
		})
	}
	return rows.map((item) => ({
		...(() => {
			const base = withBalanceFields(item)
			const settlementCustomer = settlementMap.get(normalizeString(base.settlement_customer_id)) || null
			const deliveryPricing = resolveCustomerDefaultPricing(item)
			const settlementPricing = settlementCustomer ? resolveCustomerDefaultPricing(settlementCustomer) : null
			const effectivePricing = deliveryPricing || settlementPricing || {
				unit_price: null,
				price_unit: normalizePriceUnit(item && item.default_price_unit) || 'kg'
			}
			return {
				...base,
				effective_settlement_customer_name: settlementCustomer
					? normalizeString(settlementCustomer.name)
					: base.effective_settlement_customer_name,
				effective_default_unit_price: effectivePricing.unit_price,
				effective_default_price_unit: effectivePricing.price_unit,
				effective_price_source: deliveryPricing ? 'delivery' : (settlementPricing ? 'settlement' : ''),
				settlement_default_unit_price: settlementPricing ? settlementPricing.unit_price : null,
				settlement_default_price_unit: settlementPricing ? settlementPricing.price_unit : '',
				deposit_count: Number(countMap[normalizeString(item && item._id)]?.count || 0),
				deposit_bottle_nos: countMap[normalizeString(item && item._id)]?.bottleNos || [],
				deposit_locations: countMap[normalizeString(item && item._id)]?.depositLocations || []
			}
		})()
	}))
}

function buildUniqKey(name, phone) {
	const n = normalizeString(name)
	const p = normalizePhone(phone)
	return p ? `${n}|${p}` : n
}

function isDuplicateKeyError(err) {
	const msg = normalizeString(err && err.message).toLowerCase()
	return msg.includes('duplicate key') || msg.includes('e11000')
}

async function findDuplicateByField(field, value, excludeId = '') {
	if (!value) return null
	const conditions = [{ [field]: value }]
	if (excludeId) conditions.push({ _id: dbCmd.neq(excludeId) })
	const where = conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)
	const res = await customers.where(where).field({ _id: true }).limit(1).get()
	return Array.isArray(res.data) ? res.data[0] || null : null
}

async function ensureCustomerIdentityUnique({ uniq_key: uniqKey = '', qr_code: qrCode = '' } = {}, excludeId = '') {
	const uniqDuplicate = await findDuplicateByField('uniq_key', uniqKey, excludeId)
	if (uniqDuplicate) return '客户已存在'
	if (qrCode) {
		const qrDuplicate = await findDuplicateByField('qr_code', qrCode, excludeId)
		if (qrDuplicate) return '客户二维码已存在'
	}
	return ''
}

async function resolveUniqueCustomerByQrCode(rawQrCode) {
	const qrCode = normalizeQrCode(rawQrCode)
	if (!qrCode) return { code: 400, msg: '客户二维码必填' }
	const res = await customers
		.where(dbCmd.and([{ qr_code: qrCode }, visibleCustomerWhere(dbCmd)]))
		.field({
			_id: true,
			name: true,
			contact: true,
			phone: true,
			is_active: true,
			default_price_unit: true,
			default_unit_price: true,
			settlement_customer_id: true,
			settlement_customer_name: true,
			receivable_balance: true,
			prepay_balance: true,
			net_balance: true
		})
		.limit(2)
		.get()
	const list = Array.isArray(res.data) ? res.data : []
	if (!list.length) return { code: 404, msg: '未找到匹配客户' }
	if (list.length > 1) {
		return {
			code: 409,
			msg: '客户二维码存在重复档案，请先清洗主数据',
			data: { matched: false, match_type: 'multiple', conflict_count: list.length }
		}
	}
	const withDeposit = await attachDepositCounts([list[0]])
	const customer = withDeposit[0] || null
	return {
		code: 0,
		data: {
			matched: true,
			match_type: 'qr_code',
			customer: customer
				? {
						_id: customer._id,
						name: customer.name,
						contact: customer.contact,
						phone: customer.phone,
						is_active: customer.is_active !== false,
						default_price_unit: customer.default_price_unit || 'kg',
						default_unit_price: customer.default_unit_price == null ? null : Number(customer.default_unit_price),
						effective_default_price_unit: customer.effective_default_price_unit || customer.default_price_unit || 'kg',
						effective_default_unit_price: customer.effective_default_unit_price == null ? null : Number(customer.effective_default_unit_price),
						effective_price_source: customer.effective_price_source || '',
						settlement_default_price_unit: customer.settlement_default_price_unit || '',
						settlement_default_unit_price: customer.settlement_default_unit_price == null ? null : Number(customer.settlement_default_unit_price),
						settlement_customer_id: customer.settlement_customer_id || '',
						settlement_customer_name: customer.settlement_customer_name || '',
						effective_settlement_customer_id: customer.effective_settlement_customer_id || customer._id,
						effective_settlement_customer_name: customer.effective_settlement_customer_name || customer.name,
						is_settlement_child: Boolean(customer.is_settlement_child),
						receivable_balance: toBalanceNumber(customer.receivable_balance),
						prepay_balance: toBalanceNumber(customer.prepay_balance),
						net_balance: toBalanceNumber(customer.net_balance),
						deposit_count: Number(customer.deposit_count || 0)
					}
				: null
		}
	}
}

async function listV1(user, data) {
	const keyword = normalizeString(data.keyword)
	const visibility = normalizeVisibility(data.visibility)
	if ((visibility === 'hidden' || visibility === 'all') && !currentIsSuperAdmin(user)) {
		return { code: 403, msg: '仅超级管理员可查看隐藏客户' }
	}
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
	const settlementOnly = normalizeBoolean(data.settlement_only ?? data.settlementOnly)
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
	const matchedDeliverySitesBySettlement = new Map()
	if (keyword) {
		const escaped = escapeRegExp(keyword)
		const rx = db.RegExp({ regexp: escaped, options: 'i' })
		keywordWhere = dbCmd.or([{ name: rx }, { short_name: rx }, { contact: rx }, { phone: rx }, { qr_code: rx }])
		if (settlementOnly) {
			const matchedVisibilityWhere = customerVisibilityWhere(dbCmd, visibility)
			const matchedWhere = Object.keys(matchedVisibilityWhere).length
				? dbCmd.and([keywordWhere, matchedVisibilityWhere])
				: keywordWhere
			const matchedRes = await customers
				.where(matchedWhere)
				.field({ _id: true, name: true, settlement_customer_id: true })
				.limit(500)
				.get()
			const parentIds = [
				...new Set(
					(matchedRes.data || [])
						.map((item) => normalizeString(item && item.settlement_customer_id))
						.filter(Boolean)
				)
			]
			;(matchedRes.data || []).forEach((item) => {
				const parentId = normalizeString(item && item.settlement_customer_id)
				const childId = normalizeString(item && item._id)
				const childName = normalizeString(item && item.name)
				if (!parentId || !childId || !childName) return
				const list = matchedDeliverySitesBySettlement.get(parentId) || []
				if (!list.some((row) => row._id === childId)) {
					list.push({ _id: childId, name: childName })
					matchedDeliverySitesBySettlement.set(parentId, list)
				}
			})
			const parentWhere = buildIdFilterOr('_id', parentIds)
			if (parentWhere) keywordWhere = dbCmd.or([keywordWhere, parentWhere])
		}
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
		const visibilityWhere = customerVisibilityWhere(dbCmd, visibility)
		if (Object.keys(visibilityWhere).length) parts.push(visibilityWhere)
		if (!ignoreActive && activeWhere) parts.push(activeWhere)
		if (keywordWhere) parts.push(keywordWhere)
		if (balanceWhere) parts.push(balanceWhere)
		if (updatedWhere) parts.push(updatedWhere)
		if (cashierUnallocatedWhere) parts.push(cashierUnallocatedWhere)
		if (settlementOnly) parts.push({ settlement_customer_id: dbCmd.in([null, '']) })
		if (!parts.length) return {}
		if (parts.length === 1) return parts[0]
		return dbCmd.and(parts)
	}
	const mergeWhere = (base, extra, hasBaseFilter) => (hasBaseFilter ? dbCmd.and([base, extra]) : extra)
	const hasVisibilityFilter = visibility !== 'all'
	const hasListFilter = Boolean(hasVisibilityFilter || activeWhere || keywordWhere || balanceWhere || updatedWhere || cashierUnallocatedWhere || settlementOnly)

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
		? Boolean(hasVisibilityFilter || keywordWhere || balanceWhere || updatedWhere || cashierUnallocatedWhere || settlementOnly)
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
	const hiddenRes = currentIsSuperAdmin(user)
		? await customers.where(mergeWhere(summaryWhere, { is_hidden: true }, hasSummaryFilter)).count()
		: { total: 0 }

	const rows = await attachDepositCounts(res.data || [])
	const dataRows = rows.map((item) => ({
		...item,
		matched_delivery_sites: matchedDeliverySitesBySettlement.get(normalizeString(item && item._id)) || []
	}))

	return {
		code: 0,
		data: dataRows,
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
			priced: Number(pricedRes.total || 0),
			hidden: Number(hiddenRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少客户 ID' }
	const res = await customers.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '客户不存在' }
	if (docIsHiddenCustomer(doc) && !currentIsSuperAdmin(user)) return { code: 404, msg: '客户不存在' }
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

	const settlementRef = await resolveSettlementCustomerRef(
		data.settlement_customer_id ?? data.settlementCustomerId,
		''
	)
	if (!settlementRef.ok) return { code: settlementRef.code || 400, msg: settlementRef.msg }

	const now = Date.now()
	const doc = {
		uniq_key: uniqKey,
		name,
		short_name: normalizeString(data.short_name),
		contact: normalizeString(data.contact),
		phone,
		qr_code: normalizeQrCode(data.qr_code ?? data.qrCode),
		address: normalizeString(data.address),
		remark: normalizeString(data.remark),
		settlement_customer_id: settlementRef.id || '',
		settlement_customer_name: settlementRef.name || '',
		is_active: true,
		is_hidden: false,
		hidden_at: null,
		hidden_by: null,
		hidden_by_name: '',
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

	const uniqueMsg = await ensureCustomerIdentityUnique(doc)
	if (uniqueMsg) return { code: 409, msg: uniqueMsg }

	try {
		const res = await customers.add(doc)
		await recordLog(user, 'customer_create_v1', { id: res.id }, requestId)
		return { code: 0, msg: '创建成功', data: { _id: res.id } }
	} catch (err) {
		if (isDuplicateKeyError(err)) return { code: 409, msg: '客户已存在' }
		console.error('[crm-customer] createV1 failed', err)
		return { code: 500, msg: '创建失败' }
	}
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少客户 ID' }

	const current = await customers
		.doc(id)
		.field({
			name: true,
			phone: true,
			short_name: true,
			contact: true,
			qr_code: true,
			is_hidden: true,
			settlement_customer_id: true,
			settlement_customer_name: true
		})
		.get()
	const existing = (current.data && current.data[0]) || null
	if (!existing) return { code: 404, msg: '客户不存在' }
	if (docIsHiddenCustomer(existing) && !currentIsSuperAdmin(user)) return { code: 404, msg: '客户不存在' }

	const patch = {}
	if (data.name != null) patch.name = normalizeString(data.name)
	if (data.short_name != null) patch.short_name = normalizeString(data.short_name)
	if (data.contact != null) patch.contact = normalizeString(data.contact)
	if (data.phone != null) patch.phone = normalizePhone(data.phone)
	if (data.qr_code != null || data.qrCode != null) patch.qr_code = normalizeQrCode(data.qr_code ?? data.qrCode)
	if (data.address != null) patch.address = normalizeString(data.address)
	if (data.remark != null) patch.remark = normalizeString(data.remark)
	if (data.is_active != null) patch.is_active = Boolean(data.is_active)
	if (data.default_unit_price != null) patch.default_unit_price = toNumber(data.default_unit_price, null)
	if (data.default_price_unit != null) {
		const unit = normalizePriceUnit(data.default_price_unit)
		if (!unit) return { code: 400, msg: '计价单位仅支持 kg/bottle/m3' }
		patch.default_price_unit = unit
	}
	if (data.settlement_customer_id !== undefined || data.settlementCustomerId !== undefined) {
		const settlementRef = await resolveSettlementCustomerRef(
			data.settlement_customer_id ?? data.settlementCustomerId,
			id
		)
		if (!settlementRef.ok) return { code: settlementRef.code || 400, msg: settlementRef.msg }
		patch.settlement_customer_id = settlementRef.id || ''
		patch.settlement_customer_name = settlementRef.name || ''
	}

	if (patch.short_name == null) patch.short_name = normalizeString(existing.short_name)
	if (patch.contact == null) patch.contact = normalizeString(existing.contact)

	if (patch.name != null || patch.phone != null) {
		const nextName = patch.name != null ? patch.name : existing.name
		const nextPhone = patch.phone != null ? patch.phone : existing.phone
		patch.uniq_key = buildUniqKey(nextName, nextPhone)
	}

	patch.updated_at = Date.now()
	const uniqueMsg = await ensureCustomerIdentityUnique(
		{
			uniq_key: patch.uniq_key != null ? patch.uniq_key : buildUniqKey(existing.name, existing.phone),
			qr_code: patch.qr_code != null ? patch.qr_code : normalizeQrCode(existing.qr_code)
		},
		id
	)
	if (uniqueMsg) return { code: 409, msg: uniqueMsg }

	try {
		await customers.doc(id).update(patch)
		if (patch.name != null) {
			await customers
				.where({ settlement_customer_id: id })
				.update({ settlement_customer_name: patch.name, updated_at: Date.now() })
		}
		await recordLog(user, 'customer_update_v1', { id }, requestId)
		return { code: 0, msg: '更新成功' }
	} catch (err) {
		if (isDuplicateKeyError(err)) return { code: 409, msg: '客户已存在' }
		console.error('[crm-customer] updateV1 failed', err)
		return { code: 500, msg: '更新失败' }
	}
}

async function updateCustomersByIds(ids = [], patch = {}) {
	const normalizedIds = Array.from(new Set((ids || []).map((item) => normalizeString(item)).filter(Boolean)))
	if (!normalizedIds.length) return 0
	let updated = 0
	for (const chunk of chunkStrings(normalizedIds, 180)) {
		await customers.where({ _id: dbCmd.in(chunk) }).update(patch)
		updated += chunk.length
	}
	return updated
}

async function hideCustomerV1(user, data, requestId) {
	const id = normalizeString(data.customer_id || data.customerId || data._id || data.id)
	if (!id) return { code: 400, msg: '缺少客户 ID' }
	const current = await getCustomerById(id)
	if (!current) return { code: 404, msg: '客户不存在' }
	const ids = await collectCustomerAndDescendantIds(customers, dbCmd, id)
	const now = Date.now()
	const patch = {
		is_hidden: true,
		hidden_at: now,
		hidden_by: normalizeString(user && user._id) || null,
		hidden_by_name: normalizeString(user && user.username),
		updated_at: now
	}
	const updated = await updateCustomersByIds(ids, patch)
	await recordLog(
		user,
		'customer_hide_v1',
		{
			customer_id: id,
			customer_name: normalizeString(current.name),
			affected_customer_ids: ids,
			affected_count: updated
		},
		requestId
	)
	return { code: 0, msg: '隐藏成功', data: { customer_id: id, affected_customer_ids: ids, affected_count: updated } }
}

async function unhideCustomerV1(user, data, requestId) {
	const id = normalizeString(data.customer_id || data.customerId || data._id || data.id)
	if (!id) return { code: 400, msg: '缺少客户 ID' }
	const current = await getCustomerById(id)
	if (!current) return { code: 404, msg: '客户不存在' }
	const now = Date.now()
	await customers.doc(id).update({
		is_hidden: false,
		hidden_at: null,
		hidden_by: null,
		hidden_by_name: '',
		updated_at: now
	})
	await recordLog(
		user,
		'customer_unhide_v1',
		{
			customer_id: id,
			customer_name: normalizeString(current.name)
		},
		requestId
	)
	return { code: 0, msg: '恢复成功', data: { customer_id: id, affected_customer_ids: [id], affected_count: 1 } }
}

async function resolveQrCodeV1(user, data) {
	void user
	return resolveUniqueCustomerByQrCode(data.qr_code ?? data.qrCode ?? data.token)
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
		recordLog,
		requestId,
		cloudFunction: 'crm-customer'
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'resolveQrCodeV1') return resolveQrCodeV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'updateV1') return updateV1(user, data, requestId)
	if (action === 'hideCustomerV1') return hideCustomerV1(user, data, requestId)
	if (action === 'unhideCustomerV1') return unhideCustomerV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
