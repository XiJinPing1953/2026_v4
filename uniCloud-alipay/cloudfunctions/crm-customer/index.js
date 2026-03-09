'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const customers = db.collection('crm_customers')

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

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function buildUniqKey(name, phone) {
	const n = normalizeString(name)
	const p = normalizePhone(phone)
	return p ? `${n}|${p}` : n
}

async function listV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
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

	const buildWhere = ({ ignoreActive = false } = {}) => {
		const parts = []
		if (!ignoreActive && activeWhere) parts.push(activeWhere)
		if (keywordWhere) parts.push(keywordWhere)
		if (!parts.length) return {}
		if (parts.length === 1) return parts[0]
		return dbCmd.and(parts)
	}
	const mergeWhere = (base, extra, hasBaseFilter) => (hasBaseFilter ? dbCmd.and([base, extra]) : extra)
	const hasListFilter = Boolean(activeWhere || keywordWhere)

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
	const hasSummaryFilter = summaryIgnoreActive ? Boolean(keywordWhere) : hasListFilter
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
		data: res.data || [],
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
	return { code: 0, data: doc }
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

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'updateV1') return updateV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
