'use strict'

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeVisibility(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'hidden' || text === 'all') return text
	return 'visible'
}

function isSuperAdminUser(user) {
	const role = normalizeString(user && user.role).toLowerCase()
	const roleTemplate = normalizeString(user && user.role_template).toLowerCase()
	return role === 'superadmin' || roleTemplate === 'superadmin'
}

function visibleCustomerWhere(dbCmd) {
	return { is_hidden: dbCmd.neq(true) }
}

function hiddenCustomerWhere() {
	return { is_hidden: true }
}

function customerVisibilityWhere(dbCmd, visibility = 'visible') {
	const normalized = normalizeVisibility(visibility)
	if (normalized === 'hidden') return hiddenCustomerWhere()
	if (normalized === 'all') return {}
	return visibleCustomerWhere(dbCmd)
}

function isEmptyWhere(where) {
	return !where || (typeof where === 'object' && !Array.isArray(where) && Object.keys(where).length === 0)
}

function mergeWhere(dbCmd, baseWhere, extraWhere) {
	if (isEmptyWhere(baseWhere)) return extraWhere || {}
	if (isEmptyWhere(extraWhere)) return baseWhere || {}
	return dbCmd.and([baseWhere, extraWhere])
}

function buildNotInCommand(dbCmd, ids = []) {
	if (typeof dbCmd.nin === 'function') return dbCmd.nin(ids)
	if (ids.length === 1) return dbCmd.neq(ids[0])
	return dbCmd.and(ids.map((id) => dbCmd.neq(id)))
}

function buildNotHiddenCustomerFieldsWhere(dbCmd, hiddenCustomerIds = [], fields = []) {
	const ids = Array.from(new Set((hiddenCustomerIds || []).map(normalizeString).filter(Boolean)))
	if (!ids.length) return null
	const conditions = (fields || []).map((field) => normalizeString(field)).filter(Boolean).map((field) => ({
		[field]: buildNotInCommand(dbCmd, ids)
	}))
	if (!conditions.length) return null
	if (conditions.length === 1) return conditions[0]
	return dbCmd.and(conditions)
}

async function fetchAllByWhere(collection, where, field = null, { pageSize = 200, maxRows = 10000 } = {}) {
	const rows = []
	let page = 1
	let guard = 0
	while (guard < 500 && rows.length < maxRows) {
		let query = collection.where(where)
		if (field && typeof field === 'object') query = query.field(field)
		const res = await query
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get()
		const list = Array.isArray(res && res.data) ? res.data : []
		if (!list.length) break
		rows.push(...list)
		if (list.length < pageSize || rows.length >= maxRows) break
		page += 1
		guard += 1
	}
	return rows.slice(0, maxRows)
}

async function fetchHiddenCustomerRows(customers, { maxRows = 10000, includeNames = false } = {}) {
	const field = includeNames
		? { _id: true, name: true, short_name: true, phone: true }
		: { _id: true }
	return fetchAllByWhere(customers, hiddenCustomerWhere(), field, { maxRows })
}

async function fetchHiddenCustomerIds(customers, options = {}) {
	const rows = await fetchHiddenCustomerRows(customers, options)
	return rows.map((row) => normalizeString(row && row._id)).filter(Boolean)
}

async function collectCustomerAndDescendantIds(customers, dbCmd, rootId, { maxRows = 10000 } = {}) {
	const root = normalizeString(rootId)
	if (!root) return []
	const result = []
	const seen = new Set()
	let frontier = [root]
	let guard = 0
	while (frontier.length && guard < 50 && result.length < maxRows) {
		const batch = Array.from(new Set(frontier.map(normalizeString).filter(Boolean))).filter((id) => !seen.has(id))
		frontier = []
		if (!batch.length) break
		batch.forEach((id) => {
			seen.add(id)
			result.push(id)
		})
		const children = await fetchAllByWhere(
			customers,
			{ settlement_customer_id: dbCmd.in(batch) },
			{ _id: true },
			{ pageSize: 200, maxRows: Math.max(maxRows - result.length, 1) }
		)
		frontier = children.map((row) => normalizeString(row && row._id)).filter(Boolean)
		guard += 1
	}
	return result.slice(0, maxRows)
}

function docIsHiddenCustomer(doc) {
	return Boolean(doc && doc.is_hidden === true)
}

function logMentionsHiddenCustomer(doc, hiddenRows = []) {
	if (!doc || !hiddenRows.length) return false
	const text = JSON.stringify({
		action: doc.action,
		detail: doc.detail,
		request_id: doc.request_id
	})
	return hiddenRows.some((row) => {
		const id = normalizeString(row && row._id)
		const name = normalizeString(row && row.name)
		return Boolean((id && text.includes(id)) || (name && text.includes(name)))
	})
}

module.exports = {
	normalizeString,
	normalizeVisibility,
	isSuperAdminUser,
	visibleCustomerWhere,
	hiddenCustomerWhere,
	customerVisibilityWhere,
	mergeWhere,
	buildNotHiddenCustomerFieldsWhere,
	fetchHiddenCustomerRows,
	fetchHiddenCustomerIds,
	collectCustomerAndDescendantIds,
	docIsHiddenCustomer,
	logMentionsHiddenCustomer
}
