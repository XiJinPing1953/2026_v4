'use strict'

const db = uniCloud.database()

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const movements = db.collection('crm_bottle_movements')
const anomalies = db.collection('crm_bottle_anomalies')
const customerLossDailySummaries = db.collection('crm_customer_loss_daily')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-bottle-movement] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}

const CYCLE_SCAN_MAX_ROWS = 30000
const ANOMALY_RANK_TOP_LIMIT = 5
const ANOMALY_RANK_MAX_LIMIT = 30
const ANOMALY_RANK_PAGE_SIZE_DEFAULT = 20
const ANOMALY_RANK_PAGE_SIZE_MAX = 200
const PAGE_ACTION_RULES = {
	listV1: [
		{ pagePath: '/pages/bottle/movement', action: 'view' },
		{ pagePath: '/pages/pda/movement-query', action: 'view' }
	],
	getV1: [
		{ pagePath: '/pages/bottle/movement', action: 'view' },
		{ pagePath: '/pages/pda/movement-query', action: 'view' }
	],
	timelineV1: [
		{ pagePath: '/pages/bottle/timeline', action: 'view' },
		{ pagePath: '/pages/pda/movement-query', action: 'view' }
	],
	lossStatsV1: [{ pagePath: '/pages/bottle/loss', action: 'view' }],
	cycleLossV1: [{ pagePath: '/pages/bottle/loss', action: 'view' }],
	lossAnomalyRankV1: [{ pagePath: '/pages/bottle/loss', action: 'view' }],
	customerLossSummaryV1: [{ pagePath: '/pages/customer/statement', action: 'view' }],
	customerLossBreakdownV1: [{ pagePath: '/pages/customer/statement', action: 'view' }]
}
const SUPERADMIN_ONLY_ACTIONS = ['createV1']

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
		console.error('[crm-bottle-movement] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function escapeRegExp(value) {
	return normalizeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toTimestamp(value, fallback = Date.now()) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
	if (typeof value === 'string' && value.trim()) {
		const asNum = Number(value)
		if (Number.isFinite(asNum) && asNum > 0) return asNum
		const asDate = Date.parse(value)
		if (Number.isFinite(asDate) && asDate > 0) return asDate
	}
	return fallback
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function formatDayByTs(ts) {
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = pad2(d.getMonth() + 1)
	const day = pad2(d.getDate())
	return `${y}-${m}-${day}`
}

function normalizeEventDay(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	if (m) return m[1]
	return formatDayByTs(toTimestamp(fallbackTs, Date.now()))
}

function parseEventAt(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
	if (m) {
		const y = m[1]
		const mon = m[2]
		const d = m[3]
		const hh = pad2(m[4] || '00')
		const mm = pad2(m[5] || '00')
		const ss = pad2(m[6] || '00')
		const ts = Date.parse(`${y}-${mon}-${d}T${hh}:${mm}:${ss}+08:00`)
		if (Number.isFinite(ts) && ts > 0) return ts
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return toTimestamp(fallbackTs, Date.now())
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function buildCustomerNameMatcher(value) {
	const keyword = normalizeString(value)
	if (!keyword) {
		return {
			keyword: '',
			regex: null,
			matches(name) {
				void name
				return true
			}
		}
	}
	const regex = new RegExp(escapeRegExp(keyword), 'i')
	return {
		keyword,
		regex,
		matches(name) {
			return regex.test(normalizeString(name))
		}
	}
}

function normalizeType(value) {
	const t = normalizeString(value)
	if (t === 'back' || t === 'fill' || t === 'out' || t === 'adjust') return t
	return ''
}

function normalizeLossResultType(value) {
	const t = normalizeString(value).toLowerCase()
	if (t === 'loss' || t === 'swell' || t === 'exact') return t
	return ''
}

function normalizeAnomalyRankMode(value) {
	const mode = normalizeString(value).toLowerCase()
	return mode === 'bottle' ? 'bottle' : 'single'
}

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function normalizeSourceType(value) {
	const s = normalizeString(value)
	if (s === 'sale' || s === 'filling' || s === 'manual_fix' || s === 'manual') return s
	return ''
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function resolveTruckSaleNetValue(rawTruckSaleNet, rawTruckOutGross, rawTruckBackGross) {
	const outGross = toNumber(rawTruckOutGross, null)
	const backGross = toNumber(rawTruckBackGross, null)
	if (outGross != null && backGross != null) {
		const diff = outGross - backGross
		return diff > 0 ? diff : 0
	}
	const explicit = toNumber(rawTruckSaleNet, null)
	return explicit != null && explicit > 0 ? explicit : null
}

function buildMovementWhere(data, options = {}) {
	const bottleNo = normalizeString(data && data.bottle_no)
	const type = normalizeType(data && data.type)
	const sourceType = normalizeSourceType(data && data.source_type)
	const dateStart = normalizeString(data && data.dateStart)
	const dateEnd = normalizeString(data && data.dateEnd)
	const where = {}
	if (bottleNo) where.bottle_no = normalizeBottleNo(bottleNo)
	if (!options.ignoreType && type) where.type = type
	if (sourceType) where.source_type = sourceType
	if (dateStart && dateEnd) {
		where.event_day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.event_day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.event_day = db.command.lte(dateEnd)
	}
	return where
}

function normalizeDay(value) {
	const text = normalizeString(value)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	return m ? m[1] : ''
}

function normalizeAnomalyStatus(value) {
	const status = normalizeString(value).toLowerCase()
	return status === 'resolved' ? 'resolved' : 'open'
}

function anomalyStatusPriority(status) {
	return normalizeAnomalyStatus(status) === 'open' ? 2 : 1
}

function anomalySelectionPriority(row) {
	const status = normalizeAnomalyStatus(row && row.status)
	const resolvedByName = normalizeString(row && row.resolved_by_name).toLowerCase()
	const resolvedBy = normalizeString(row && row.resolved_by)
	if (status === 'resolved') {
		if ((resolvedBy || (resolvedByName && resolvedByName !== 'system-reconcile')) && resolvedByName !== 'system-reconcile') {
			return 4
		}
		if (resolvedByName === 'system-reconcile') return 1
		return 2
	}
	if (status === 'open') return 3
	return 0
}

function normalizeAnomalyType(value) {
	const text = normalizeString(value).toLowerCase()
	if (
		text === 'missing_back' ||
		text === 'missing_fill' ||
		text === 'missing_out' ||
		text === 'continuous_fill' ||
		text === 'continuous_out' ||
		text === 'continuous_back' ||
		text === 'missing_truck_fill' ||
		text === 'truck_return_diff_excess' ||
		text === 'missing_truck_back_gross'
	) {
		return text
	}
	return ''
}

function buildComparableAnomalyFingerprint(row) {
	const bottleNo = normalizeBottleNo(row && row.bottle_no)
	const anomalyType = normalizeAnomalyType(row && row.anomaly_type)
	const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
	const date = normalizeString((row && row.date) || ctx.legacy_date)
	const detail = normalizeString(row && (row.note || row.detail))
	const key = (value) => normalizeString(value).toLowerCase()
	const numKey = (value) => {
		const num = toNumber(value, null)
		return num == null ? '' : String(num)
	}
	const eventSig = (event, includeCustomer = true) => {
		const current = event && typeof event === 'object' && !Array.isArray(event) ? event : {}
		const parts = [
			key(current.date),
			key(current.source_type),
			key(current.source_id)
		]
		if (includeCustomer) parts.push(key(current.customer))
		parts.push(numKey(current.net))
		return parts
	}
	if (!anomalyType) return normalizeString(row && row.fingerprint)
	let sig = [key(bottleNo), key(anomalyType), key(date)]
	if (anomalyType === 'missing_fill') {
		sig = sig.concat(eventSig(ctx.last_back), eventSig(ctx.next_out))
	} else if (anomalyType === 'missing_back') {
		sig = sig.concat(eventSig(ctx.last_out), eventSig(ctx.next_fill, false))
	} else if (anomalyType === 'missing_out') {
		sig = sig.concat(eventSig(ctx.last_back), eventSig(ctx.next_fill, false), eventSig(ctx.next_back))
	} else if (anomalyType === 'continuous_out') {
		sig = sig.concat(eventSig(ctx.last_out), eventSig(ctx.next_out))
	} else if (anomalyType === 'continuous_back') {
		sig = sig.concat(eventSig(ctx.last_back), eventSig(ctx.next_back), key(ctx.has_fill_since_last_back ? '1' : '0'))
	} else if (anomalyType === 'continuous_fill') {
		sig = sig.concat(eventSig(ctx.last_back), eventSig(ctx.last_fill, false), eventSig(ctx.next_fill, false))
	} else if (anomalyType === 'missing_truck_fill') {
		sig = sig.concat(
			eventSig(ctx.last_truck_sale),
			eventSig({
				...(ctx.next_truck_sale || {}),
				customer: ctx.next_truck_sale?.customer,
				net: ctx.next_truck_sale?.truck_out_gross
			})
		)
	} else if (anomalyType === 'truck_return_diff_excess' || anomalyType === 'missing_truck_back_gross') {
		const truckSale = ctx.truck_sale || {}
		sig = sig.concat(
			eventSig({
				...truckSale,
				customer: truckSale?.customer,
				net: resolveTruckSaleNetValue(
					truckSale?.truck_gross_diff ?? truckSale?.truck_sale_net,
					truckSale?.truck_out_gross,
					truckSale?.truck_back_gross
				)
			})
		)
	}
	const hasStructuredIdentity = sig.slice(3).some(Boolean)
	if (!hasStructuredIdentity && detail) sig.push(key(detail))
	return sig.join('|')
}

function anomalyIdentity(row) {
	const fingerprint = buildComparableAnomalyFingerprint(row)
	if (fingerprint) return `fp:${fingerprint}`
	const id = normalizeString(row && row._id)
	if (id) return `id:${id}`
	const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
	const type = normalizeAnomalyType(row && row.anomaly_type) || normalizeString(row && row.anomaly_type)
	const day = normalizeDay(
		ctx.legacy_date ||
			ctx.next_out?.date ||
			ctx.next_back?.date ||
			ctx.last_back?.date ||
			ctx.last_fill?.date ||
			ctx.last_out?.date ||
			ctx.next_fill?.date ||
			row?.date
	)
	const note = normalizeString(row && row.note)
	return `fallback:${type}|${day}|${note}`
}

function selectPreferredAnomaly(a, b) {
	const aPriority = anomalySelectionPriority(a)
	const bPriority = anomalySelectionPriority(b)
	if (aPriority !== bPriority) return bPriority > aPriority ? b : a

	const aUpdated = toTimestamp(a && a.updated_at, toTimestamp(a && a.created_at, 0))
	const bUpdated = toTimestamp(b && b.updated_at, toTimestamp(b && b.created_at, 0))
	if (aUpdated !== bUpdated) return bUpdated > aUpdated ? b : a

	const aCreated = toTimestamp(a && a.created_at, 0)
	const bCreated = toTimestamp(b && b.created_at, 0)
	return bCreated >= aCreated ? b : a
}

function dedupeTimelineAnomalies(rows) {
	const uniq = new Map()
	for (const row of rows || []) {
		const key = anomalyIdentity(row)
		if (!uniq.has(key)) {
			uniq.set(key, row)
			continue
		}
		uniq.set(key, selectPreferredAnomaly(uniq.get(key), row))
	}
	return Array.from(uniq.values()).sort((a, b) => {
		const aPriority = anomalyStatusPriority(a && a.status)
		const bPriority = anomalyStatusPriority(b && b.status)
		if (aPriority !== bPriority) return bPriority - aPriority
		const aUpdated = toTimestamp(a && a.updated_at, toTimestamp(a && a.created_at, 0))
		const bUpdated = toTimestamp(b && b.updated_at, toTimestamp(b && b.created_at, 0))
		if (aUpdated !== bUpdated) return bUpdated - aUpdated
		return toTimestamp(b && b.created_at, 0) - toTimestamp(a && a.created_at, 0)
	})
}

function round2(value) {
	const num = Number(value || 0)
	return Math.round(num * 100) / 100
}

function isMissingFillLossRow(row) {
	if (normalizeType(row && row.type) !== 'adjust') return false
	if (normalizeSourceType(row && row.source_type) !== 'manual_fix') return false
	const adjustReason = normalizeString(row && row.adjust_reason).toLowerCase()
	if (
		adjustReason === 'missing_fill_loss' ||
		adjustReason === 'missing_fill_loss_accept' ||
		adjustReason === 'missing_fill_swell_accept'
	) {
		const loss = toNumber(row && row.loss_weight, null)
		return loss != null && loss !== 0
	}
	const note = normalizeString(row && row.note)
	return /缺灌装.*(损耗|胀重)|(损耗|胀重).*缺灌装/.test(note)
}

function round3(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Math.round(num * 1000) / 1000
}

function buildMissingFillManualFixIdentity(row) {
	if (!isMissingFillLossRow(row)) return ''
	const sourceId = normalizeString(row && row.source_id)
	if (sourceId) return `source:${sourceId}`
	const bottleNo = normalizeBottleNo(row && row.bottle_no)
	const eventDay = normalizeDay(row && row.event_day) || normalizeDay(row && row.date)
	const adjustReason = normalizeString(row && row.adjust_reason).toLowerCase()
	const note = normalizeString(row && row.note)
	const lossWeight = toNumber(row && row.loss_weight, null)
	const lossKey = lossWeight == null ? '' : String(round3(lossWeight))
	return `legacy:${bottleNo}|${eventDay}|${adjustReason}|${lossKey}|${note}`
}

function selectPreferredMissingFillManualFixRow(a, b) {
	const aSource = normalizeString(a && a.source_id)
	const bSource = normalizeString(b && b.source_id)
	if (Boolean(aSource) !== Boolean(bSource)) return bSource ? b : a
	const aCreated = toTimestamp(a && a.created_at, 0)
	const bCreated = toTimestamp(b && b.created_at, 0)
	if (aCreated !== bCreated) return bCreated > aCreated ? b : a
	return b || a
}

function dedupeMissingFillManualFixRows(rows) {
	const ordered = []
	const indexMap = new Map()
	for (const row of rows || []) {
		const key = buildMissingFillManualFixIdentity(row)
		if (!key) {
			ordered.push(row)
			continue
		}
		if (!indexMap.has(key)) {
			indexMap.set(key, ordered.length)
			ordered.push(row)
			continue
		}
		const idx = indexMap.get(key)
		ordered[idx] = selectPreferredMissingFillManualFixRow(ordered[idx], row)
	}
	return ordered
}

function getMissingFillAdjustResultType(row) {
	if (!isMissingFillLossRow(row)) return ''
	const loss = toNumber(row && row.loss_weight, null)
	if (loss == null || loss === 0) return ''
	return loss > 0 ? 'loss' : 'swell'
}

function buildLossWhere(data) {
	const where = {
		type: 'adjust',
		source_type: 'manual_fix'
	}
	const bottleNo = normalizeBottleNo(data && (data.bottle_no || data.bottleNo))
	const dateStart = normalizeString(data && data.dateStart)
	const dateEnd = normalizeString(data && data.dateEnd)
	if (bottleNo) where.bottle_no = bottleNo
	if (dateStart && dateEnd) {
		where.event_day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.event_day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.event_day = db.command.lte(dateEnd)
	}
	return where
}

async function fetchAllLossRows(where) {
	const pageSize = 200
	let page = 0
	let rows = []
	while (true) {
		const res = await movements
			.where(where)
			.orderBy('event_day', 'desc')
			.orderBy('event_at', 'desc')
			.orderBy('created_at', 'desc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const current = res.data || []
		rows = rows.concat(current)
		if (current.length < pageSize) break
		page += 1
		if (page > 200) break
	}
	return rows
}

async function fetchCustomerOutRowsByName(customerName = '', dateStart = '', dateEnd = '') {
	const keyword = normalizeString(customerName)
	if (!keyword) return []
	const rows = []
	let page = 0
	const pageSize = 300
	const where = {
		type: 'out',
		source_type: 'sale',
		customer_name: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
	}
	if (dateStart && dateEnd) {
		where.event_day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.event_day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.event_day = db.command.lte(dateEnd)
	}
	while (true) {
		const res = await movements
			.where(where)
			.field({ bottle_no: true, customer_id: true, customer_name: true, event_day: true })
			.orderBy('event_day', 'asc')
			.orderBy('created_at', 'asc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const current = Array.isArray(res.data) ? res.data : []
		rows.push(...current)
		if (current.length < pageSize) break
		page += 1
		if (page > 500) break
	}
	return rows
}

async function fetchAllBottleMovementRows(bottleNo) {
	const pageSize = 300
	let page = 0
	let rows = []
	while (true) {
		const res = await movements
			.where({ bottle_no: bottleNo })
			.orderBy('event_at', 'asc')
			.orderBy('type_order', 'asc')
			.orderBy('created_at', 'asc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const current = res.data || []
		rows = rows.concat(current)
		if (current.length < pageSize) break
		page += 1
		if (page > 400) break
	}
	return rows
}

async function fetchAllBottleMovementRowsByBottleNos(bottleNos = [], { maxEventDay = '' } = {}) {
	const normalized = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalized.length) return []
	const rows = []
	for (const chunk of chunkArray(normalized, 80)) {
		let page = 0
		while (true) {
			const where = { bottle_no: db.command.in(chunk) }
			if (maxEventDay) {
				where.event_day = db.command.lte(maxEventDay)
			}
			const res = await movements
				.where(where)
				.orderBy('event_at', 'asc')
				.orderBy('type_order', 'asc')
				.orderBy('created_at', 'asc')
				.skip(page * 300)
				.limit(300)
				.get()
			const current = Array.isArray(res.data) ? res.data : []
			rows.push(...current)
			if (current.length < 300) break
			page += 1
			if (page > 400) break
		}
	}
	return rows
}

async function fetchAllAnomalyRowsByBottleNos(bottleNos = [], baseWhere = {}, limit = 500) {
	const normalized = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalized.length) return []
	const rows = []
	for (const chunk of chunkArray(normalized, 80)) {
		let page = 0
		while (true) {
			const where = { ...baseWhere, bottle_no: db.command.in(chunk) }
			const res = await anomalies
				.where(where)
				.orderBy('created_at', 'desc')
				.skip(page * limit)
				.limit(limit)
				.get()
			const current = Array.isArray(res.data) ? res.data : []
			rows.push(...current)
			if (current.length < limit) break
			page += 1
			if (page > 400) break
		}
	}
	return rows
}

async function fetchCustomerOutRows(customerId, dateStart = '', dateEnd = '') {
	const rows = []
	let page = 0
	const pageSize = 300
	const where = {
		type: 'out',
		source_type: 'sale',
		customer_id: customerId
	}
	if (dateStart && dateEnd) {
		where.event_day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.event_day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.event_day = db.command.lte(dateEnd)
	}
	while (true) {
		const res = await movements
			.where(where)
			.field({ bottle_no: true, customer_name: true, event_day: true })
			.orderBy('event_day', 'asc')
			.orderBy('created_at', 'asc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const current = Array.isArray(res.data) ? res.data : []
		rows.push(...current)
		if (current.length < pageSize) break
		page += 1
		if (page > 500) break
	}
	return rows
}

async function fetchCustomerLossDailySummaryRows(customerId, dateStart = '', dateEnd = '') {
	const rows = []
	let page = 0
	const pageSize = 300
	const where = {
		customer_id: customerId
	}
	if (dateStart && dateEnd) {
		where.day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.day = db.command.lte(dateEnd)
	}
	while (true) {
		const res = await customerLossDailySummaries
			.where(where)
			.orderBy('day', 'asc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const current = Array.isArray(res.data) ? res.data : []
		rows.push(...current)
		if (current.length < pageSize) break
		page += 1
		if (page > 500) break
	}
	return rows
}

function chunkArray(list = [], size = 100) {
	const source = Array.isArray(list) ? list : []
	const out = []
	const chunkSize = Math.max(Number(size) || 0, 1)
	for (let index = 0; index < source.length; index += chunkSize) {
		out.push(source.slice(index, index + chunkSize))
	}
	return out
}

async function fetchAllCycleEventRowsGlobal({ maxRows = CYCLE_SCAN_MAX_ROWS, dateStart = '', dateEnd = '', customerName = '' } = {}) {
	const customerMatcher = buildCustomerNameMatcher(customerName)
	if (customerMatcher.keyword) {
		const outRows = await fetchCustomerOutRowsByName(customerMatcher.keyword, dateStart, dateEnd)
		const bottleNos = Array.from(new Set(outRows.map((row) => normalizeBottleNo(row && row.bottle_no)).filter(Boolean)))
		if (!bottleNos.length) return { rows: [], overflow: false }
		const rows = await fetchAllBottleMovementRowsByBottleNos(bottleNos, { maxEventDay: dateEnd })
		return {
			rows,
			overflow: rows.length >= maxRows
		}
	}
	const pageSize = 300
	let page = 0
	let rows = []
	const where = { type: db.command.in(['back', 'fill', 'out']) }
	if (dateStart && dateEnd) {
		where.event_day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.event_day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.event_day = db.command.lte(dateEnd)
	}
	while (true) {
		const remaining = maxRows - rows.length
		if (remaining <= 0) {
			return { rows, overflow: true }
		}
		const limit = Math.min(pageSize, remaining)
		const res = await movements
			.where(where)
			.orderBy('type', 'asc')
			.orderBy('event_at', 'asc')
			.skip(page * pageSize)
			.limit(limit)
			.get()
		const current = res.data || []
		rows = rows.concat(current)
		if (current.length < limit) break
		page += 1
		if (page > 300) return { rows, overflow: true }
	}
	return { rows, overflow: false }
}

function compareCycleEventAsc(a, b) {
	const aAt = toTimestamp(a && a.event_at, toTimestamp(a && a.created_at, 0))
	const bAt = toTimestamp(b && b.event_at, toTimestamp(b && b.created_at, 0))
	if (aAt !== bAt) return aAt - bAt
	const aOrder = Number(a && a.type_order) || movementTypeOrder(normalizeType(a && a.type))
	const bOrder = Number(b && b.type_order) || movementTypeOrder(normalizeType(b && b.type))
	if (aOrder !== bOrder) return aOrder - bOrder
	const aCreated = toTimestamp(a && a.created_at, 0)
	const bCreated = toTimestamp(b && b.created_at, 0)
	return aCreated - bCreated
}

function eventDayOfRow(row) {
	return normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || ''
}

function createActiveCycleFromBack(backRow) {
	return {
		back: backRow,
		fillSum: 0,
		fillCount: 0,
		fillSourceIds: []
	}
}

function listEffectiveCycleEvents(events) {
	if (!Array.isArray(events)) return []
	return events.filter((row) => {
		const type = normalizeType(row && row.type)
		return type === 'back' || type === 'fill' || type === 'out'
	})
}

function hasSameDayBackOutWithoutFill(events) {
	const effectiveEvents = listEffectiveCycleEvents(events)
	if (!effectiveEvents.length) return false
	const hasBack = effectiveEvents.some((row) => normalizeType(row && row.type) === 'back')
	const hasFill = effectiveEvents.some((row) => normalizeType(row && row.type) === 'fill')
	const hasOut = effectiveEvents.some((row) => normalizeType(row && row.type) === 'out')
	return hasBack && hasOut && !hasFill
}

function sortCycleDayEventsByTypePriority(events, priorities) {
	return [...events].sort((a, b) => {
		const aType = normalizeType(a && a.type)
		const bType = normalizeType(b && b.type)
		const aPriority = Object.prototype.hasOwnProperty.call(priorities, aType) ? priorities[aType] : 99
		const bPriority = Object.prototype.hasOwnProperty.call(priorities, bType) ? priorities[bType] : 99
		if (aPriority !== bPriority) return aPriority - bPriority
		return compareCycleEventAsc(a, b)
	})
}

function interleaveSameDayBackOutEvents(events, startType) {
	const sorted = [...events].sort(compareCycleEventAsc)
	const backs = sorted.filter((row) => normalizeType(row && row.type) === 'back')
	const outs = sorted.filter((row) => normalizeType(row && row.type) === 'out')
	const others = sorted.filter((row) => {
		const type = normalizeType(row && row.type)
		return type !== 'back' && type !== 'out'
	})
	const result = []
	let expect = startType === 'out' ? 'out' : 'back'
	while (backs.length || outs.length) {
		if (expect === 'back') {
			if (backs.length) result.push(backs.shift())
			else if (outs.length) result.push(outs.shift())
			expect = 'out'
			continue
		}
		if (outs.length) result.push(outs.shift())
		else if (backs.length) result.push(backs.shift())
		expect = 'back'
	}
	return [...result, ...others]
}

function shouldQueueSameDayBackOut(events, state) {
	if (!hasSameDayBackOutWithoutFill(events)) return false
	if (Array.isArray(state && state.pendingSameDayBackOut) && state.pendingSameDayBackOut.length > 0) return true
	if (state && state.activeCycle && state.activeCycle.back) return false
	if (normalizeType(state && state.lastEffectiveType) === 'out') return false
	return true
}

function buildCycleDayBusinessOrder(events, state) {
	const sorted = [...events].sort(compareCycleEventAsc)
	if (!hasSameDayBackOutWithoutFill(sorted)) return sorted
	if (shouldQueueSameDayBackOut(sorted, state)) return sorted
	if (state && state.activeCycle && state.activeCycle.back) {
		return interleaveSameDayBackOutEvents(sorted, 'out')
	}
	if (normalizeType(state && state.lastEffectiveType) === 'out') {
		return interleaveSameDayBackOutEvents(sorted, 'back')
	}
	return sorted
}

function buildPendingSameDayBackOutEntry(events) {
	const sorted = [...listEffectiveCycleEvents(events)].sort(compareCycleEventAsc)
	const backEvents = sorted.filter((row) => normalizeType(row && row.type) === 'back')
	const outEvents = sorted.filter((row) => normalizeType(row && row.type) === 'out')
	const back = backEvents[backEvents.length - 1] || null
	const out = outEvents[outEvents.length - 1] || null
	if (!back || !out) return null
	return {
		event_day: eventDayOfRow(out) || eventDayOfRow(back),
		back,
		out
	}
}

function buildCycleRowFromActiveCycle(bottleNo, activeCycle, outRow) {
	const backRow = activeCycle && activeCycle.back ? activeCycle.back : null
	if (!backRow) return null
	const backNet = toNumber(backRow && backRow.net_weight, 0) || 0
	const fillSum = round2(activeCycle.fillSum)
	const outNet = toNumber(outRow && outRow.net_weight, 0) || 0
	const theoreticalOut = round2(backNet + fillSum)
	const delta = round2(theoreticalOut - outNet)
	return {
		bottle_no: bottleNo,
		back_date: normalizeString(backRow && backRow.date),
		back_day: eventDayOfRow(backRow),
		back_net_kg: round2(backNet),
		fill_count: activeCycle.fillCount,
		fill_sum_kg: fillSum,
		out_date: normalizeString(outRow && outRow.date),
		out_day: eventDayOfRow(outRow),
		out_net_kg: round2(outNet),
		theoretical_out_kg: theoreticalOut,
		delta_kg: delta,
		result_type: delta > 0 ? 'loss' : delta < 0 ? 'swell' : 'exact',
		source_back_id: normalizeString(backRow && backRow.source_id) || null,
		source_fill_ids: Array.from(new Set(activeCycle.fillSourceIds)),
		source_out_id: normalizeString(outRow && outRow.source_id) || null,
		out_customer_id: normalizeString(outRow && outRow.customer_id) || null,
		out_customer_name: normalizeString(outRow && outRow.customer_name),
		out_event_at: toTimestamp(outRow && outRow.event_at, toTimestamp(outRow && outRow.created_at, 0)),
		out_created_at: toTimestamp(outRow && outRow.created_at, 0)
	}
}

function pushBackWithoutOut(incompleteRows, activeCycle) {
	if (!activeCycle || !activeCycle.back) return
	incompleteRows.push(buildIncompletePreviewRow('back_without_out', activeCycle.back, '回瓶后未找到对应出瓶（遇到新的回瓶）'))
}

function resolvePendingSameDayBackOut(state, nextType, cycleRows) {
	const queue = Array.isArray(state.pendingSameDayBackOut) ? state.pendingSameDayBackOut : []
	if (!queue.length) return
	const type = normalizeType(nextType)
	if (!type || type === 'adjust') return
	const latest = queue[queue.length - 1] || null
	state.pendingSameDayBackOut = []
	if (!latest || !latest.back || !latest.out) return
	if (type === 'fill') {
		state.activeCycle = createActiveCycleFromBack(latest.back)
		state.lastEffectiveType = 'back'
		return
	}
	const syntheticCycle = buildCycleRowFromActiveCycle(state.bottleNo, createActiveCycleFromBack(latest.back), latest.out)
	if (syntheticCycle) cycleRows.push(syntheticCycle)
	state.activeCycle = null
	state.lastEffectiveType = 'out'
}

function processCycleDay(state, dayEvents, cycleRows, incompleteRows) {
	const sorted = buildCycleDayBusinessOrder(dayEvents, state)
	if (shouldQueueSameDayBackOut(sorted, state)) {
		const pendingEntry = buildPendingSameDayBackOutEntry(sorted)
		if (pendingEntry) {
			state.pendingSameDayBackOut = [...state.pendingSameDayBackOut, pendingEntry]
		}
		return
	}

	const effectiveEvents = listEffectiveCycleEvents(sorted)
	if (effectiveEvents.length) {
		resolvePendingSameDayBackOut(state, effectiveEvents[0].type, cycleRows)
	}

	for (const row of sorted) {
		const type = normalizeType(row && row.type)
		if (type === 'back') {
			if (state.activeCycle && state.activeCycle.back) {
				pushBackWithoutOut(incompleteRows, state.activeCycle)
			}
			state.activeCycle = createActiveCycleFromBack(row)
			state.lastEffectiveType = 'back'
			continue
		}

		if (type === 'fill') {
			state.lastEffectiveType = 'fill'
			if (!state.activeCycle || !state.activeCycle.back) continue
			const fillWeight = toNumber(row && row.net_weight, 0) || 0
			state.activeCycle.fillSum += fillWeight
			state.activeCycle.fillCount += 1
			const fillSourceId = normalizeString(row && row.source_id)
			if (fillSourceId) state.activeCycle.fillSourceIds.push(fillSourceId)
			continue
		}

		if (type === 'out') {
			state.lastEffectiveType = 'out'
			if (!state.activeCycle || !state.activeCycle.back) {
				incompleteRows.push(buildIncompletePreviewRow('out_without_back', row, '出瓶前未找到可配对回瓶'))
				continue
			}
			const cycleRow = buildCycleRowFromActiveCycle(state.bottleNo, state.activeCycle, row)
			if (cycleRow) cycleRows.push(cycleRow)
			state.activeCycle = null
			continue
		}

		if (type === 'adjust') {
			state.lastEffectiveType = 'adjust'
		}
	}
}

function isDayInRange(day, dateStart, dateEnd) {
	const normalizedDay = normalizeDay(day)
	if (!normalizedDay) return !dateStart && !dateEnd
	if (dateStart && normalizedDay < dateStart) return false
	if (dateEnd && normalizedDay > dateEnd) return false
	return true
}

function buildIncompletePreviewRow(reason, row, detail) {
	return {
		reason: normalizeString(reason),
		bottle_no: normalizeBottleNo(row && row.bottle_no),
		customer_name: normalizeString(row && row.customer_name),
		event_day: normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || '',
		event_date: normalizeString(row && row.date),
		source_id: normalizeString(row && row.source_id) || null,
		detail: normalizeString(detail)
	}
}

function createEmptyCustomerLossDailySummary(customerId, customerName, day) {
	return {
		customer_id: customerId,
		customer_name: normalizeString(customerName),
		day,
		cycle_loss_weight: 0,
		cycle_loss_count: 0,
		manual_loss_weight: 0,
		manual_loss_count: 0,
		loss_total_weight: 0,
		bottle_count: 0,
		bottle_nos: new Set()
	}
}

function finalizeCustomerLossDailySummaryRow(summary, requestId, nowTs) {
	const bottleNos = Array.from(summary.bottle_nos || []).filter(Boolean).sort()
	const cycleLossWeight = round2(summary.cycle_loss_weight)
	const manualLossWeight = round2(summary.manual_loss_weight)
	return {
		customer_id: summary.customer_id,
		customer_name: normalizeString(summary.customer_name),
		day: normalizeDay(summary.day),
		cycle_loss_weight: cycleLossWeight,
		cycle_loss_count: Number(summary.cycle_loss_count || 0),
		manual_loss_weight: manualLossWeight,
		manual_loss_count: Number(summary.manual_loss_count || 0),
		loss_total_weight: round2(cycleLossWeight + manualLossWeight),
		bottle_count: bottleNos.length,
		bottle_nos: bottleNos,
		request_id: requestId,
		updated_at: nowTs
	}
}

async function rebuildCustomerLossDailySummaries(customerId, { dateStart = '', dateEnd = '', requestId = '' } = {}) {
	const normalizedCustomerId = normalizeString(customerId)
	if (!normalizedCustomerId) {
		return {
			rows: [],
			bottleNos: [],
			cycleLossCount: 0,
			manualLossCount: 0
		}
	}

	const outRows = await fetchCustomerOutRows(normalizedCustomerId, dateStart, dateEnd)
	let effectiveDateStart = dateStart
	let effectiveDateEnd = dateEnd
	if (!effectiveDateStart && outRows.length) effectiveDateStart = normalizeDay(outRows[0] && outRows[0].event_day)
	if (!effectiveDateEnd && outRows.length) effectiveDateEnd = normalizeDay(outRows[outRows.length - 1] && outRows[outRows.length - 1].event_day)

	const bottleNos = Array.from(new Set(outRows.map((row) => normalizeBottleNo(row && row.bottle_no)).filter(Boolean)))
	const customerNameFallback = normalizeString((outRows.find((row) => normalizeString(row && row.customer_name)) || {}).customer_name)
	const dayMap = new Map()
	const ensureDay = (day, customerName = '') => {
		const normalizedDay = normalizeDay(day)
		if (!normalizedDay) return null
		if (!dayMap.has(normalizedDay)) {
			dayMap.set(normalizedDay, createEmptyCustomerLossDailySummary(normalizedCustomerId, customerName || customerNameFallback, normalizedDay))
		}
		const target = dayMap.get(normalizedDay)
		if (!target.customer_name && customerName) target.customer_name = normalizeString(customerName)
		return target
	}

	let cycleLossCount = 0
	let manualLossCount = 0
	let cycleLossRows = []
	let manualLossRows = []

	if (bottleNos.length) {
		const [eventRows, anomalyRowsRaw] = await Promise.all([
			fetchAllBottleMovementRowsByBottleNos(bottleNos, { maxEventDay: effectiveDateEnd }),
			fetchAllAnomalyRowsByBottleNos(
				bottleNos,
				(() => {
					const where = {
						anomaly_type: 'missing_fill',
						status: 'resolved'
					}
					if (effectiveDateStart && effectiveDateEnd) {
						where.date = db.command.and(db.command.gte(effectiveDateStart), db.command.lte(effectiveDateEnd))
					} else if (effectiveDateStart) {
						where.date = db.command.gte(effectiveDateStart)
					} else if (effectiveDateEnd) {
						where.date = db.command.lte(effectiveDateEnd)
					}
					return where
				})()
			)
		])

		const cycleEvents = (eventRows || []).filter((row) => {
			const type = normalizeType(row && row.type)
			return type === 'back' || type === 'fill' || type === 'out'
		})
		const { cycleRows } = buildCycleRowsFromEvents(cycleEvents)
		cycleLossRows = cycleRows.filter((row) => {
			if (normalizeLossResultType(row && row.result_type) !== 'loss') return false
			if (normalizeString(row && row.out_customer_id) !== normalizedCustomerId) return false
			return isDayInRange(row.out_day, effectiveDateStart, effectiveDateEnd)
		})
		cycleLossCount = cycleLossRows.length
		for (const row of cycleLossRows) {
			const target = ensureDay(row.out_day, row.out_customer_name)
			if (!target) continue
			const delta = Math.max(toNumber(row && row.delta_kg, 0), 0)
			target.cycle_loss_weight += delta
			target.cycle_loss_count += 1
			const bottleNo = normalizeBottleNo(row && row.bottle_no)
			if (bottleNo) target.bottle_nos.add(bottleNo)
		}

		const anomalyRows = dedupeTimelineAnomalies(anomalyRowsRaw || [])
		manualLossRows = anomalyRows.filter((row) => {
			const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
			const resolution = ctx && typeof ctx.resolution === 'object' && !Array.isArray(ctx.resolution) ? ctx.resolution : {}
			if (normalizeString(resolution.mode).toLowerCase() !== 'loss_accept') return false
			if (normalizeString(ctx?.next_out?.customer_id) !== normalizedCustomerId) return false
			return isDayInRange(ctx?.next_out?.date, effectiveDateStart, effectiveDateEnd)
		})
		manualLossCount = manualLossRows.length
		for (const row of manualLossRows) {
			const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
			const resolution = ctx && typeof ctx.resolution === 'object' && !Array.isArray(ctx.resolution) ? ctx.resolution : {}
			const target = ensureDay(ctx?.next_out?.date, ctx?.next_out?.customer_name)
			if (!target) continue
			const lossWeight = Math.max(toNumber(resolution.loss_kg, 0), 0)
			target.manual_loss_weight += lossWeight
			target.manual_loss_count += 1
			const bottleNo = normalizeBottleNo(row && row.bottle_no)
			if (bottleNo) target.bottle_nos.add(bottleNo)
		}
	}

	const existingRows = await fetchCustomerLossDailySummaryRows(normalizedCustomerId, effectiveDateStart, effectiveDateEnd)
	const existingMap = new Map(existingRows.map((row) => [normalizeDay(row && row.day), row]))
	const nowTs = Date.now()
	const finalizedRows = Array.from(dayMap.values())
		.map((item) => finalizeCustomerLossDailySummaryRow(item, requestId, nowTs))
		.filter((item) => item.day && item.loss_total_weight > 0)
		.sort((a, b) => a.day.localeCompare(b.day))

	for (const row of finalizedRows) {
		const existing = existingMap.get(row.day)
		if (existing && normalizeString(existing._id)) {
			await customerLossDailySummaries.doc(existing._id).update({
				customer_name: row.customer_name,
				cycle_loss_weight: row.cycle_loss_weight,
				cycle_loss_count: row.cycle_loss_count,
				manual_loss_weight: row.manual_loss_weight,
				manual_loss_count: row.manual_loss_count,
				loss_total_weight: row.loss_total_weight,
				bottle_count: row.bottle_count,
				bottle_nos: row.bottle_nos,
				request_id: row.request_id,
				updated_at: row.updated_at
			})
			existingMap.delete(row.day)
			continue
		}
		await customerLossDailySummaries.add({
			...row,
			created_at: nowTs
		})
	}

	for (const staleRow of existingMap.values()) {
		const staleId = normalizeString(staleRow && staleRow._id)
		if (!staleId) continue
		await customerLossDailySummaries.doc(staleId).remove()
	}

	return {
		rows: finalizedRows,
		bottleNos,
		cycleLossCount,
		manualLossCount,
		cycleLossRows,
		manualLossRows,
		dateStart: effectiveDateStart,
		dateEnd: effectiveDateEnd
	}
}

function buildCycleRowsFromEvents(events) {
	const cycleRows = []
	const incompleteRows = []
	const semanticStateByBottle = new Map()
	const rowsByBottle = new Map()

	for (const row of events || []) {
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		if (!bottleNo) continue
		if (!rowsByBottle.has(bottleNo)) rowsByBottle.set(bottleNo, [])
		rowsByBottle.get(bottleNo).push(row)
	}

	for (const [bottleNo, bottleRows] of rowsByBottle.entries()) {
		const sortedRows = [...bottleRows].sort(compareCycleEventAsc)
		const state = {
			bottleNo,
			activeCycle: null,
			pendingSameDayBackOut: [],
			lastEffectiveType: ''
		}
		let dayBuffer = []

		const flushDayBuffer = () => {
			if (!dayBuffer.length) return
			processCycleDay(state, dayBuffer, cycleRows, incompleteRows)
			dayBuffer = []
		}

		for (const row of sortedRows) {
			const eventDay = eventDayOfRow(row)
			if (!dayBuffer.length) {
				dayBuffer.push(row)
				continue
			}
			if (eventDay === eventDayOfRow(dayBuffer[0])) {
				dayBuffer.push(row)
				continue
			}
			flushDayBuffer()
			dayBuffer.push(row)
		}

		flushDayBuffer()

		if (state.activeCycle && state.activeCycle.back) {
			incompleteRows.push(buildIncompletePreviewRow('back_without_out', state.activeCycle.back, '回瓶后直到查询结束仍未找到对应出瓶'))
		}

		semanticStateByBottle.set(bottleNo, {
			has_pending_same_day_back_out: state.pendingSameDayBackOut.length > 0,
			active_cycle: state.activeCycle
				? {
					fill_count: state.activeCycle.fillCount,
					back_day: eventDayOfRow(state.activeCycle.back),
					back_date: normalizeString(state.activeCycle.back && state.activeCycle.back.date)
				}
				: null,
			last_effective_type: normalizeType(state.lastEffectiveType) || normalizeString(state.lastEffectiveType)
		})
	}

	return { cycleRows, incompleteRows, semanticStateByBottle }
}

function buildCycleAnomalyRows(cycleRows = [], customerMatcher) {
	const matcher = customerMatcher && customerMatcher.keyword ? customerMatcher : buildCustomerNameMatcher('')
	return (Array.isArray(cycleRows) ? cycleRows : [])
		.filter((row) => {
			const resultType = normalizeLossResultType(row && row.result_type)
			if (resultType !== 'loss' && resultType !== 'swell') return false
			const customerName = normalizeString(row && row.out_customer_name)
			if (matcher.keyword && !matcher.matches(customerName)) return false
			return true
		})
		.map((row) => {
			const delta = round2(toNumber(row && row.delta_kg, 0) || 0)
			const absDelta = round2(Math.abs(delta))
			return {
				entry_type: 'cycle',
				result_type: delta > 0 ? 'loss' : 'swell',
				event_day: normalizeDay(row && row.out_day) || normalizeDay(row && row.out_date),
				event_at: toTimestamp(row && row.out_event_at, toTimestamp(row && row.out_created_at, 0)),
				bottle_no: normalizeBottleNo(row && row.bottle_no),
				customer_name: normalizeString(row && row.out_customer_name),
				delta_kg: delta,
				abs_delta_kg: absDelta,
				detail: `回瓶${round2(toNumber(row && row.back_net_kg, 0) || 0)} + 灌装${round2(toNumber(row && row.fill_sum_kg, 0) || 0)} = 理论${round2(
					toNumber(row && row.theoretical_out_kg, 0) || 0
				)}，实际${round2(toNumber(row && row.out_net_kg, 0) || 0)}`,
				source_id: normalizeString(row && row.source_out_id)
			}
		})
		.filter((row) => row.abs_delta_kg > 0)
}

function buildManualAnomalyRows(manualRows = [], customerMatcher) {
	const matcher = customerMatcher && customerMatcher.keyword ? customerMatcher : buildCustomerNameMatcher('')
	return (Array.isArray(manualRows) ? manualRows : [])
		.filter((row) => {
			if (!isMissingFillLossRow(row)) return false
			const resultType = getMissingFillAdjustResultType(row)
			if (resultType !== 'loss' && resultType !== 'swell') return false
			const context = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
			const customerName = normalizeString((context.next_out || {}).customer_name || row?.customer_name)
			if (matcher.keyword && !matcher.matches(customerName)) return false
			return true
		})
		.map((row) => {
			const context = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
			const nextOut = context.next_out && typeof context.next_out === 'object' ? context.next_out : {}
			const lossWeight = toNumber(row && row.loss_weight, 0) || 0
			const delta = round2(lossWeight)
			const absDelta = round2(Math.abs(delta))
			return {
				entry_type: 'manual',
				result_type: delta > 0 ? 'loss' : 'swell',
				event_day: normalizeDay(row && row.event_day) || normalizeDay(nextOut.date) || normalizeDay(row && row.date),
				event_at: toTimestamp(row && row.event_at, toTimestamp(row && row.created_at, 0)),
				bottle_no: normalizeBottleNo(row && row.bottle_no),
				customer_name: normalizeString(nextOut.customer_name || row?.customer_name),
				delta_kg: delta,
				abs_delta_kg: absDelta,
				detail: normalizeString(row && row.note) || normalizeString(row && row.adjust_reason) || '缺灌装修复差值',
				source_id: normalizeString(row && row._id)
			}
		})
		.filter((row) => row.abs_delta_kg > 0)
}

function sortAnomalySingleRows(rows = []) {
	return [...rows].sort((a, b) => {
		const deltaDiff = round2(toNumber(b && b.abs_delta_kg, 0) || 0) - round2(toNumber(a && a.abs_delta_kg, 0) || 0)
		if (deltaDiff !== 0) return deltaDiff
		const dayA = normalizeDay(a && a.event_day)
		const dayB = normalizeDay(b && b.event_day)
		if (dayA !== dayB) return dayB.localeCompare(dayA)
		const atDiff = toTimestamp(b && b.event_at, 0) - toTimestamp(a && a.event_at, 0)
		if (atDiff !== 0) return atDiff
		return normalizeBottleNo(a && a.bottle_no).localeCompare(normalizeBottleNo(b && b.bottle_no))
	})
}

function buildAnomalyBottleRows(singleRows = []) {
	const bottleMap = new Map()
	for (const row of singleRows || []) {
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		if (!bottleNo) continue
		if (!bottleMap.has(bottleNo)) {
			bottleMap.set(bottleNo, {
				bottle_no: bottleNo,
				total_abs_delta_kg: 0,
				loss_abs_delta_kg: 0,
				swell_abs_delta_kg: 0,
				cycle_count: 0,
				manual_count: 0,
				event_count: 0,
				latest_day: '',
				latest_event_at: 0,
				customer_names: new Set()
			})
		}
		const target = bottleMap.get(bottleNo)
		const absDelta = round2(toNumber(row && row.abs_delta_kg, 0) || 0)
		const resultType = normalizeLossResultType(row && row.result_type)
		target.total_abs_delta_kg += absDelta
		if (resultType === 'loss') target.loss_abs_delta_kg += absDelta
		if (resultType === 'swell') target.swell_abs_delta_kg += absDelta
		target.event_count += 1
		if (normalizeString(row && row.entry_type) === 'manual') target.manual_count += 1
		else target.cycle_count += 1
		const customerName = normalizeString(row && row.customer_name)
		if (customerName) target.customer_names.add(customerName)
		const currentAt = toTimestamp(row && row.event_at, 0)
		const currentDay = normalizeDay(row && row.event_day)
		if (currentAt >= target.latest_event_at) {
			target.latest_event_at = currentAt
			target.latest_day = currentDay
		}
	}
	return Array.from(bottleMap.values())
		.map((item) => ({
			bottle_no: item.bottle_no,
			total_abs_delta_kg: round2(item.total_abs_delta_kg),
			loss_abs_delta_kg: round2(item.loss_abs_delta_kg),
			swell_abs_delta_kg: round2(item.swell_abs_delta_kg),
			cycle_count: item.cycle_count,
			manual_count: item.manual_count,
			event_count: item.event_count,
			latest_day: item.latest_day,
			customer_name_preview: Array.from(item.customer_names).slice(0, 3).join(' / ')
		}))
		.filter((item) => item.total_abs_delta_kg > 0)
		.sort((a, b) => {
			if (b.total_abs_delta_kg !== a.total_abs_delta_kg) return b.total_abs_delta_kg - a.total_abs_delta_kg
			if (b.event_count !== a.event_count) return b.event_count - a.event_count
			return a.bottle_no.localeCompare(b.bottle_no)
		})
}

function paginateRows(rows = [], page = 1, pageSize = 20) {
	const currentPage = Math.max(Number(page) || 1, 1)
	const size = Math.max(Number(pageSize) || 20, 1)
	const total = Array.isArray(rows) ? rows.length : 0
	const start = (currentPage - 1) * size
	const list = Array.isArray(rows) ? rows.slice(start, start + size) : []
	return {
		list,
		paging: {
			page: currentPage,
			pageSize: size,
			total,
			hasMore: currentPage * size < total
		}
	}
}

function buildTimelineMarkers(anomalyRows) {
	const markers = []
	const push = (eventDay, type, anomaly) => {
		const day = normalizeDay(eventDay)
		if (!day) return
		markers.push({
			anomaly_id: normalizeString(anomaly && anomaly._id),
			event_day: day,
			type: normalizeType(type),
			anomaly_type: normalizeString(anomaly && anomaly.anomaly_type),
			status: normalizeAnomalyStatus(anomaly && anomaly.status),
			note: normalizeString(anomaly && anomaly.note)
		})
	}
	for (const row of anomalyRows) {
		if (normalizeAnomalyStatus(row && row.status) !== 'open') continue
		const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
		let markerCount = 0
		if (ctx.last_out && typeof ctx.last_out === 'object') {
			push(ctx.last_out.date, 'out', row)
			markerCount += 1
		}
		if (ctx.next_fill && typeof ctx.next_fill === 'object') {
			push(ctx.next_fill.date, 'fill', row)
			markerCount += 1
		}
		if (ctx.last_fill && typeof ctx.last_fill === 'object') {
			push(ctx.last_fill.date, 'fill', row)
			markerCount += 1
		}
		if (ctx.last_back && typeof ctx.last_back === 'object') {
			push(ctx.last_back.date, 'back', row)
			markerCount += 1
		}
		if (ctx.next_back && typeof ctx.next_back === 'object') {
			push(ctx.next_back.date, 'back', row)
			markerCount += 1
		}
		if (ctx.next_out && typeof ctx.next_out === 'object') {
			push(ctx.next_out.date, 'out', row)
			markerCount += 1
		}
		const legacyDate = normalizeDay(ctx.legacy_date)
		if (!markerCount && legacyDate) {
			push(legacyDate, '', row)
			markerCount += 1
		}
		if (!markerCount) {
			const hits = normalizeString(row && row.note).match(/\d{4}-\d{2}-\d{2}/g) || []
			if (hits.length > 0) {
				push(hits[0], '', row)
				if (hits[1]) push(hits[1], '', row)
			}
		}
	}
	const uniq = new Map()
	for (const marker of markers) {
		const key = `${marker.anomaly_id}|${marker.event_day}|${marker.type}`
		if (!uniq.has(key)) uniq.set(key, marker)
	}
	return Array.from(uniq.values())
}

function buildTimelineState(events, anomalyRows, semanticState = null) {
	const openAnomalies = anomalyRows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'open').length
	if (openAnomalies > 0) {
		return { code: 'anomaly_open', label: '异常待处理', kind: 'danger' }
	}
	if (!events.length) {
		return { code: 'empty', label: '暂无流转', kind: 'soft' }
	}
	if (semanticState && semanticState.has_pending_same_day_back_out) {
		return { code: 'waiting_next_action', label: '待后续动作', kind: 'warning' }
	}
	if (semanticState && semanticState.active_cycle) {
		if (Number(semanticState.active_cycle.fill_count || 0) > 0) {
			return { code: 'ready_out', label: '可出瓶', kind: 'success' }
		}
		return { code: 'waiting_fill', label: '待灌装', kind: 'warning' }
	}
	const last = events[events.length - 1] || {}
	const semanticType = normalizeType(semanticState && semanticState.last_effective_type) || normalizeType(last.type)
	if (semanticType === 'out') return { code: 'waiting_back', label: '待回瓶', kind: 'warning' }
	if (semanticType === 'back') return { code: 'waiting_fill', label: '待灌装', kind: 'warning' }
	if (semanticType === 'fill') return { code: 'ready_out', label: '可出瓶', kind: 'success' }
	if (semanticType === 'adjust') return { code: 'adjusted', label: '调整后待确认', kind: 'info' }
	return { code: 'unknown', label: '状态待确认', kind: 'info' }
}

function buildTimelineStats(events, anomalyRows) {
	const stats = {
		total: events.length,
		out: 0,
		back: 0,
		fill: 0,
		adjust: 0,
		open_anomalies: 0,
		resolved_anomalies: 0,
		cycle_estimated: 0
	}
	for (const row of events) {
		const type = normalizeType(row && row.type)
		if (type === 'out') stats.out += 1
		if (type === 'back') stats.back += 1
		if (type === 'fill') stats.fill += 1
		if (type === 'adjust') stats.adjust += 1
	}
	for (const row of anomalyRows) {
		if (normalizeAnomalyStatus(row && row.status) === 'resolved') stats.resolved_anomalies += 1
		else stats.open_anomalies += 1
	}
	stats.cycle_estimated = Math.min(stats.out, stats.back, stats.fill)
	return stats
}

async function listV1(user, data, requestId) {
	void user
	const bottleNo = normalizeString(data.bottle_no)
	const type = normalizeType(data.type)
	const sourceType = normalizeSourceType(data.source_type)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.limit || 50) || 50, 1), 200)

	const where = buildMovementWhere(data)
	const summaryWhere = buildMovementWhere(data, { ignoreType: true })

	const res = await movements
		.where(where)
		.orderBy('event_at', 'asc')
		.orderBy('type_order', 'asc')
		.orderBy('created_at', 'asc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()
	const [totalRes, outRes, backRes, fillRes, adjustRes] = await Promise.all([
		movements.where(where).count(),
		movements.where({ ...summaryWhere, type: 'out' }).count(),
		movements.where({ ...summaryWhere, type: 'back' }).count(),
		movements.where({ ...summaryWhere, type: 'fill' }).count(),
		movements.where({ ...summaryWhere, type: 'adjust' }).count()
	])

	await recordLog(
		user,
		'bottle_movement_list_v1',
		{ bottle_no: bottleNo, type: type || '', source_type: sourceType || '', date_start: dateStart, date_end: dateEnd },
		requestId
	)
	return {
		code: 0,
		data: res.data || [],
		total: totalRes.total || 0,
		page,
		pageSize,
		summary: {
			total: (outRes.total || 0) + (backRes.total || 0) + (fillRes.total || 0) + (adjustRes.total || 0),
			out: outRes.total || 0,
			back: backRes.total || 0,
			fill: fillRes.total || 0,
			adjust: adjustRes.total || 0
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const res = await movements.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	return { code: 0, data: doc }
}

async function timelineV1(user, data, requestId) {
	void user
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo)
	if (!bottleNo) return { code: 400, msg: '瓶号必填' }
	const limit = Math.min(Math.max(Number(data.limit || 1000) || 1000, 1), 3000)

	const [eventRes, anomalyRes] = await Promise.all([
		movements
			.where({ bottle_no: bottleNo })
			.orderBy('event_at', 'asc')
			.orderBy('type_order', 'asc')
			.orderBy('created_at', 'asc')
			.limit(limit)
			.get(),
		anomalies
			.where({ bottle_no: bottleNo })
			.orderBy('created_at', 'desc')
			.limit(200)
			.get()
	])

	const events = dedupeMissingFillManualFixRows(eventRes.data || [])
	const anomalyRows = dedupeTimelineAnomalies(anomalyRes.data || [])
	const semanticResult = buildCycleRowsFromEvents(events)
	const semanticState = semanticResult.semanticStateByBottle.get(bottleNo) || null
	const markers = buildTimelineMarkers(anomalyRows)
	const state = buildTimelineState(events, anomalyRows, semanticState)
	const stats = buildTimelineStats(events, anomalyRows)

	await recordLog(user, 'bottle_movement_timeline_v1', { bottle_no: bottleNo, event_count: events.length }, requestId)
	return {
		code: 0,
		data: {
			bottle_no: bottleNo,
			events,
			anomalies: anomalyRows,
			markers,
			state,
			stats
		}
	}
}

async function lossStatsV1(user, data, requestId) {
	void user
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.limit || 50) || 50, 1), 200)
	const resultType = normalizeLossResultType(data.result_type || data.resultType)
	const customerMatcher = buildCustomerNameMatcher(data.customer_name || data.customerName)
	const where = buildLossWhere(data)
	const allRows = await fetchAllLossRows(where)
	const manualRows = dedupeMissingFillManualFixRows(allRows).filter((row) => {
		if (!isMissingFillLossRow(row)) return false
		if (!customerMatcher.keyword) return true
		const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
		return customerMatcher.matches(ctx?.next_out?.customer_name || row?.customer_name)
	})

	manualRows.sort((a, b) => {
		const aAt = toTimestamp(a && a.event_at, toTimestamp(a && a.created_at, 0))
		const bAt = toTimestamp(b && b.event_at, toTimestamp(b && b.created_at, 0))
		if (aAt !== bAt) return bAt - aAt
		return toTimestamp(b && b.created_at, 0) - toTimestamp(a && a.created_at, 0)
	})

	const dailyMap = new Map()
	const bottleSet = new Set()
	let totalLoss = 0
	let totalSwell = 0
	let lossCount = 0
	let swellCount = 0
	for (const row of manualRows) {
		const day = normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || '-'
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		if (bottleNo) bottleSet.add(bottleNo)
		const loss = toNumber(row && row.loss_weight, 0) || 0
		const resultType = getMissingFillAdjustResultType(row)
		const amount = Math.abs(loss)
		if (resultType === 'loss') {
			totalLoss += amount
			lossCount += 1
		} else if (resultType === 'swell') {
			totalSwell += amount
			swellCount += 1
		}
		if (!dailyMap.has(day)) {
			dailyMap.set(day, { event_day: day, loss_kg: 0, swell_kg: 0, count: 0 })
		}
		const target = dailyMap.get(day)
		if (resultType === 'loss') target.loss_kg += amount
		if (resultType === 'swell') target.swell_kg += amount
		target.count += 1
	}

	const filteredRows = resultType ? manualRows.filter((row) => getMissingFillAdjustResultType(row) === resultType) : manualRows

	const daily = Array.from(dailyMap.values())
			.map((item) => ({
				event_day: item.event_day,
				loss_kg: round2(item.loss_kg),
				swell_kg: round2(item.swell_kg),
				count: item.count
			}))
		.sort((a, b) => b.event_day.localeCompare(a.event_day))

	const total = filteredRows.length
	const summaryRecordCount = manualRows.length
	const start = (page - 1) * pageSize
		const list = filteredRows.slice(start, start + pageSize).map((row) => ({
			_id: normalizeString(row && row._id),
			bottle_no: normalizeBottleNo(row && row.bottle_no),
			customer_name: normalizeString(
				((row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {})?.next_out || {}).customer_name || row?.customer_name
			),
			event_day: normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || '',
			loss_weight: toNumber(row && row.loss_weight, null),
			result_type: getMissingFillAdjustResultType(row),
			note: normalizeString(row && row.note),
			adjust_reason: normalizeString(row && row.adjust_reason),
			created_at: toTimestamp(row && row.created_at, 0),
			event_at: toTimestamp(row && row.event_at, 0)
		}))

	await recordLog(
		user,
		'bottle_movement_loss_stats_v1',
		{
			bottle_no: normalizeBottleNo(data && (data.bottle_no || data.bottleNo)),
			customer_name: customerMatcher.keyword,
			date_start: normalizeString(data && data.dateStart),
			date_end: normalizeString(data && data.dateEnd),
			result_type: resultType,
			total
		},
		requestId
	)

	return {
		code: 0,
			data: {
				summary: {
					total_loss_kg: round2(totalLoss),
					total_swell_kg: round2(totalSwell),
					loss_record_count: lossCount,
					swell_record_count: swellCount,
					record_count: summaryRecordCount,
					bottle_count: bottleSet.size,
					daily
				},
			list,
			page,
			pageSize,
			total
		}
	}
}

async function cycleLossV1(user, data, requestId) {
	void user
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo)
	const customerMatcher = buildCustomerNameMatcher(data.customer_name || data.customerName)
	const dateStart = normalizeDay(data.dateStart)
	const dateEnd = normalizeDay(data.dateEnd)
	const resultType = normalizeLossResultType(data.result_type || data.resultType)
	const includeIncompleteList = Boolean(data.include_incomplete_list || data.includeIncompleteList)
	if (dateStart && dateEnd && dateStart > dateEnd) return { code: 400, msg: '开始日期不能晚于结束日期' }
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.limit || 50) || 50, 1), 200)
	const scanLimit = Math.min(Math.max(Number(data.scan_limit || data.scanLimit || CYCLE_SCAN_MAX_ROWS) || CYCLE_SCAN_MAX_ROWS, 2000), 80000)

	let events = []
	if (bottleNo) {
		const allRows = await fetchAllBottleMovementRows(bottleNo)
		events = allRows.filter((row) => {
			const type = normalizeType(row && row.type)
			return type === 'back' || type === 'fill' || type === 'out'
		})
	} else {
		const globalRes = await fetchAllCycleEventRowsGlobal({
			maxRows: scanLimit,
			dateStart,
			dateEnd,
			customerName: customerMatcher.keyword
		})
		if (globalRes.overflow) {
			return { code: 400, msg: '查询范围过大，请输入瓶号或缩小日期范围后重试' }
		}
		events = globalRes.rows || []
	}

	events.sort(compareCycleEventAsc)

	const { cycleRows, incompleteRows } = buildCycleRowsFromEvents(events)

	const filteredCycles = cycleRows
		.filter((row) => isDayInRange(row.out_day, dateStart, dateEnd))
		.filter((row) => (customerMatcher.keyword ? customerMatcher.matches(row.out_customer_name) : true))
		.sort((a, b) => {
			if (a.out_event_at !== b.out_event_at) return b.out_event_at - a.out_event_at
			return b.out_created_at - a.out_created_at
		})

	const filteredIncomplete = incompleteRows
		.filter((row) => isDayInRange(row.event_day, dateStart, dateEnd))
		.filter((row) => (customerMatcher.keyword ? customerMatcher.matches(row.customer_name) : true))

	let lossCount = 0
	let swellCount = 0
	let exactCount = 0
	let lossTotal = 0
	let swellTotal = 0
	const bottleSet = new Set()

	for (const row of filteredCycles) {
		const rowBottleNo = normalizeBottleNo(row && row.bottle_no)
		if (rowBottleNo) bottleSet.add(rowBottleNo)
		const delta = toNumber(row.delta_kg, 0) || 0
		if (delta > 0) {
			lossCount += 1
			lossTotal += delta
		} else if (delta < 0) {
			swellCount += 1
			swellTotal += Math.abs(delta)
		} else {
			exactCount += 1
		}
	}

	const filteredCycleRows = resultType ? filteredCycles.filter((row) => normalizeLossResultType(row.result_type) === resultType) : filteredCycles
	const total = filteredCycleRows.length
	const summaryCycleCount = filteredCycles.length
	const start = (page - 1) * pageSize
	const list = filteredCycleRows.slice(start, start + pageSize).map((row) => ({
		bottle_no: row.bottle_no,
		back_date: row.back_date,
		back_net_kg: row.back_net_kg,
		fill_count: row.fill_count,
		fill_sum_kg: row.fill_sum_kg,
		out_date: row.out_date,
		out_net_kg: row.out_net_kg,
		theoretical_out_kg: row.theoretical_out_kg,
		delta_kg: row.delta_kg,
		result_type: row.result_type,
		out_customer_name: row.out_customer_name,
		source_back_id: row.source_back_id,
		source_fill_ids: row.source_fill_ids,
		source_out_id: row.source_out_id
	}))

	await recordLog(
		user,
		'bottle_movement_cycle_loss_v1',
		{
			bottle_no: bottleNo || '',
			scope_mode: bottleNo ? 'single' : 'global',
			customer_name: customerMatcher.keyword,
			date_start: dateStart || '',
			date_end: dateEnd || '',
			result_type: resultType,
			scanned_event_count: events.length,
			total,
			incomplete_count: filteredIncomplete.length
		},
		requestId
	)

	return {
		code: 0,
		data: {
			summary: {
				cycle_count: summaryCycleCount,
				loss_count: lossCount,
				loss_total_kg: round2(lossTotal),
				swell_count: swellCount,
				swell_total_kg: round2(swellTotal),
				exact_count: exactCount,
				bottle_count: bottleSet.size,
				scanned_event_count: events.length,
				scope_mode: bottleNo ? 'single' : 'global',
				incomplete_count: filteredIncomplete.length
			},
			list,
			paging: {
				page,
				pageSize,
				total,
				hasMore: page * pageSize < total
			},
			incomplete_preview: filteredIncomplete.slice(0, 20),
			incomplete_total: filteredIncomplete.length,
			incomplete_list: includeIncompleteList ? filteredIncomplete : []
		}
	}
}

async function lossAnomalyRankV1(user, data, requestId) {
	void user
	const bottleNo = normalizeBottleNo(data && (data.bottle_no || data.bottleNo))
	const customerMatcher = buildCustomerNameMatcher(data && (data.customer_name || data.customerName))
	const dateStart = normalizeDay(data && data.dateStart)
	const dateEnd = normalizeDay(data && data.dateEnd)
	if (dateStart && dateEnd && dateStart > dateEnd) return { code: 400, msg: '开始日期不能晚于结束日期' }

	const mode = normalizeAnomalyRankMode(data && data.mode)
	const page = Math.max(Number(data && data.page) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data && (data.pageSize || data.limitSize || data.size) || ANOMALY_RANK_PAGE_SIZE_DEFAULT) || ANOMALY_RANK_PAGE_SIZE_DEFAULT, 1),
		ANOMALY_RANK_PAGE_SIZE_MAX
	)
	const topLimit = Math.min(Math.max(Number(data && data.limit) || ANOMALY_RANK_TOP_LIMIT, 1), ANOMALY_RANK_MAX_LIMIT)
	const scanLimit = Math.min(Math.max(Number(data && (data.scan_limit || data.scanLimit) || CYCLE_SCAN_MAX_ROWS) || CYCLE_SCAN_MAX_ROWS, 2000), 80000)

	let cycleRows = []
	let scannedEventCount = 0
	if (bottleNo) {
		const allRows = await fetchAllBottleMovementRows(bottleNo)
		const events = allRows.filter((row) => {
			const type = normalizeType(row && row.type)
			return type === 'back' || type === 'fill' || type === 'out'
		})
		events.sort(compareCycleEventAsc)
		const cycleResult = buildCycleRowsFromEvents(events)
		cycleRows = Array.isArray(cycleResult.cycleRows) ? cycleResult.cycleRows : []
		scannedEventCount = events.length
	} else {
		const globalRes = await fetchAllCycleEventRowsGlobal({
			maxRows: scanLimit,
			dateStart,
			dateEnd,
			customerName: customerMatcher.keyword
		})
		if (globalRes.overflow) {
			return { code: 400, msg: '查询范围过大，请输入瓶号或缩小日期范围后重试' }
		}
		const events = Array.isArray(globalRes.rows) ? globalRes.rows : []
		events.sort(compareCycleEventAsc)
		const cycleResult = buildCycleRowsFromEvents(events)
		cycleRows = Array.isArray(cycleResult.cycleRows) ? cycleResult.cycleRows : []
		scannedEventCount = events.length
	}

	const filteredCycleRows = cycleRows.filter((row) => {
		if (bottleNo && normalizeBottleNo(row && row.bottle_no) !== bottleNo) return false
		if (!isDayInRange(row && row.out_day, dateStart, dateEnd)) return false
		if (customerMatcher.keyword && !customerMatcher.matches(row && row.out_customer_name)) return false
		return true
	})

	const manualWhere = buildLossWhere({
		bottle_no: bottleNo,
		dateStart,
		dateEnd
	})
	const manualRowsRaw = await fetchAllLossRows(manualWhere)
	const manualRows = dedupeMissingFillManualFixRows(manualRowsRaw).filter((row) => {
		if (!isMissingFillLossRow(row)) return false
		if (bottleNo && normalizeBottleNo(row && row.bottle_no) !== bottleNo) return false
		const day = normalizeDay(row && row.event_day) || normalizeDay(row && row.date)
		if (!isDayInRange(day, dateStart, dateEnd)) return false
		if (!customerMatcher.keyword) return true
		const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
		const customerName = normalizeString((ctx.next_out || {}).customer_name || row?.customer_name)
		return customerMatcher.matches(customerName)
	})

	const singleRows = sortAnomalySingleRows([
		...buildCycleAnomalyRows(filteredCycleRows, customerMatcher),
		...buildManualAnomalyRows(manualRows, customerMatcher)
	])
	const bottleRows = buildAnomalyBottleRows(singleRows)
	const paged = mode === 'bottle' ? paginateRows(bottleRows, page, pageSize) : paginateRows(singleRows, page, pageSize)

	await recordLog(
		user,
		'bottle_movement_loss_anomaly_rank_v1',
		{
			bottle_no: bottleNo || '',
			customer_name: customerMatcher.keyword,
			date_start: dateStart || '',
			date_end: dateEnd || '',
			mode,
			page,
			page_size: pageSize,
			top_limit: topLimit,
			single_total: singleRows.length,
			bottle_total: bottleRows.length,
			scanned_event_count: scannedEventCount
		},
		requestId
	)

	return {
		code: 0,
		data: {
			top_single: singleRows.slice(0, topLimit),
			top_bottle: bottleRows.slice(0, topLimit),
			single_list: mode === 'single' ? paged.list : [],
			bottle_list: mode === 'bottle' ? paged.list : [],
			paging: {
				...paged.paging,
				mode
			},
			summary: {
				single_total: singleRows.length,
				bottle_total: bottleRows.length
			}
		}
	}
}

async function customerLossSummaryV1(user, data, requestId) {
	void user
	const customerId = normalizeString(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const dateStart = normalizeDay(data.dateStart)
	const dateEnd = normalizeDay(data.dateEnd)
	if (dateStart && dateEnd && dateStart > dateEnd) return { code: 400, msg: '开始日期不能晚于结束日期' }

	const rebuildResult = await rebuildCustomerLossDailySummaries(customerId, {
		dateStart,
		dateEnd,
		requestId
	})
	const summaryRows = await fetchCustomerLossDailySummaryRows(customerId, rebuildResult.dateStart, rebuildResult.dateEnd)
	const lossTotal = round2(summaryRows.reduce((sum, row) => sum + Math.max(toNumber(row && row.loss_total_weight, 0), 0), 0))
	const summaryBottleCount = new Set(
		summaryRows.flatMap((row) => (Array.isArray(row && row.bottle_nos) ? row.bottle_nos : []).map((item) => normalizeBottleNo(item)).filter(Boolean))
	).size

	await recordLog(
		user,
		'bottle_movement_customer_loss_summary_v1',
		{
			customer_id: customerId,
			date_start: rebuildResult.dateStart || '',
			date_end: rebuildResult.dateEnd || '',
			bottle_count: rebuildResult.bottleNos.length,
			loss_bottle_count: summaryBottleCount,
			cycle_loss_count: rebuildResult.cycleLossCount,
			manual_loss_count: rebuildResult.manualLossCount,
			summary_day_count: summaryRows.length
		},
		requestId
	)

	return {
		code: 0,
		data: {
			customer_id: customerId,
			date_start: rebuildResult.dateStart || '',
			date_end: rebuildResult.dateEnd || '',
			loss_total_kg: lossTotal,
			cycle_loss_count: rebuildResult.cycleLossCount,
			manual_loss_count: rebuildResult.manualLossCount,
			bottle_count: rebuildResult.bottleNos.length,
			loss_bottle_count: summaryBottleCount,
			day_count: summaryRows.length
		}
	}
}

async function customerLossBreakdownV1(user, data, requestId) {
	void user
	const customerId = normalizeString(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const dateStart = normalizeDay(data.dateStart)
	const dateEnd = normalizeDay(data.dateEnd)
	if (dateStart && dateEnd && dateStart > dateEnd) return { code: 400, msg: '开始日期不能晚于结束日期' }
	const topDays = Math.min(Math.max(toNumber(data.top_days || data.topDays, 10) || 10, 1), 100)
	const topBottles = Math.min(Math.max(toNumber(data.top_bottles || data.topBottles, 20) || 20, 1), 200)

	const rebuildResult = await rebuildCustomerLossDailySummaries(customerId, {
		dateStart,
		dateEnd,
		requestId
	})
	const summaryRows = await fetchCustomerLossDailySummaryRows(customerId, rebuildResult.dateStart, rebuildResult.dateEnd)
	const normalizedSummaryRows = summaryRows
		.map((row) => ({
			day: normalizeDay(row && row.day),
			customer_id: normalizeString(row && row.customer_id),
			customer_name: normalizeString(row && row.customer_name),
			cycle_loss_weight: round2(Math.max(toNumber(row && row.cycle_loss_weight, 0), 0)),
			cycle_loss_count: Number(row && row.cycle_loss_count) || 0,
			manual_loss_weight: round2(Math.max(toNumber(row && row.manual_loss_weight, 0), 0)),
			manual_loss_count: Number(row && row.manual_loss_count) || 0,
			loss_total_weight: round2(Math.max(toNumber(row && row.loss_total_weight, 0), 0)),
			bottle_count: Number(row && row.bottle_count) || 0,
			bottle_nos: Array.isArray(row && row.bottle_nos) ? row.bottle_nos.map((item) => normalizeBottleNo(item)).filter(Boolean) : []
		}))
		.filter((row) => row.day && row.loss_total_weight > 0)
	const topDayRows = [...normalizedSummaryRows]
		.sort((a, b) => {
			if (b.loss_total_weight !== a.loss_total_weight) return b.loss_total_weight - a.loss_total_weight
			return a.day.localeCompare(b.day)
		})
		.slice(0, topDays)

	const bottleStatsMap = new Map()
	const ensureBottle = (bottleNo) => {
		const normalizedBottleNo = normalizeBottleNo(bottleNo)
		if (!normalizedBottleNo) return null
		if (!bottleStatsMap.has(normalizedBottleNo)) {
			bottleStatsMap.set(normalizedBottleNo, {
				bottle_no: normalizedBottleNo,
				cycle_loss_weight: 0,
				cycle_loss_count: 0,
				manual_loss_weight: 0,
				manual_loss_count: 0,
				loss_total_weight: 0,
				days: new Set()
			})
		}
		return bottleStatsMap.get(normalizedBottleNo)
	}

	for (const row of Array.isArray(rebuildResult.cycleLossRows) ? rebuildResult.cycleLossRows : []) {
		const bottle = ensureBottle(row && row.bottle_no)
		if (!bottle) continue
		const delta = round2(Math.max(toNumber(row && row.delta_kg, 0), 0))
		bottle.cycle_loss_weight += delta
		bottle.cycle_loss_count += 1
		if (row && row.out_day) bottle.days.add(normalizeDay(row.out_day))
	}
	for (const row of Array.isArray(rebuildResult.manualLossRows) ? rebuildResult.manualLossRows : []) {
		const bottle = ensureBottle(row && row.bottle_no)
		if (!bottle) continue
		const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
		const resolution = ctx && typeof ctx.resolution === 'object' && !Array.isArray(ctx.resolution) ? ctx.resolution : {}
		const lossWeight = round2(Math.max(toNumber(resolution.loss_kg, 0), 0))
		bottle.manual_loss_weight += lossWeight
		bottle.manual_loss_count += 1
		if (ctx?.next_out?.date) bottle.days.add(normalizeDay(ctx.next_out.date))
	}

	const topBottleRows = Array.from(bottleStatsMap.values())
		.map((row) => ({
			bottle_no: row.bottle_no,
			cycle_loss_weight: round2(row.cycle_loss_weight),
			cycle_loss_count: row.cycle_loss_count,
			manual_loss_weight: round2(row.manual_loss_weight),
			manual_loss_count: row.manual_loss_count,
			loss_total_weight: round2(row.cycle_loss_weight + row.manual_loss_weight),
			day_count: row.days.size,
			days: Array.from(row.days).filter(Boolean).sort()
		}))
		.filter((row) => row.loss_total_weight > 0)
		.sort((a, b) => {
			if (b.loss_total_weight !== a.loss_total_weight) return b.loss_total_weight - a.loss_total_weight
			return a.bottle_no.localeCompare(b.bottle_no)
		})
		.slice(0, topBottles)

	const lossTotal = round2(normalizedSummaryRows.reduce((sum, row) => sum + row.loss_total_weight, 0))
	const summaryBottleCount = new Set(
		normalizedSummaryRows.flatMap((row) => row.bottle_nos.map((item) => normalizeBottleNo(item)).filter(Boolean))
	).size

	await recordLog(
		user,
		'bottle_movement_customer_loss_breakdown_v1',
		{
			customer_id: customerId,
			date_start: rebuildResult.dateStart || '',
			date_end: rebuildResult.dateEnd || '',
			bottle_count: rebuildResult.bottleNos.length,
			loss_bottle_count: summaryBottleCount,
			day_count: normalizedSummaryRows.length,
			top_days: topDayRows.length,
			top_bottles: topBottleRows.length
		},
		requestId
	)

	return {
		code: 0,
		data: {
			customer_id: customerId,
			date_start: rebuildResult.dateStart || '',
			date_end: rebuildResult.dateEnd || '',
			loss_total_kg: lossTotal,
			cycle_loss_count: rebuildResult.cycleLossCount,
			manual_loss_count: rebuildResult.manualLossCount,
			bottle_count: rebuildResult.bottleNos.length,
			loss_bottle_count: summaryBottleCount,
			day_count: normalizedSummaryRows.length,
			days: normalizedSummaryRows.sort((a, b) => a.day.localeCompare(b.day)),
			top_days: topDayRows,
			top_bottles: topBottleRows
		}
	}
}

async function createV1(user, data, requestId) {
	const bottleNo = normalizeBottleNo(data.bottle_no)
	if (!bottleNo) return { code: 400, msg: '瓶号必填' }
	const type = normalizeType(data.type)
	if (!type) return { code: 400, msg: '事件类型无效' }
	const date = normalizeString(data.date)
	if (!date) return { code: 400, msg: '日期必填' }
	const sourceType = normalizeSourceType(data.source_type)
	if (!sourceType) return { code: 400, msg: '来源类型无效' }
	const now = Date.now()
	const eventDay = normalizeEventDay(date, now)
	const eventAt = parseEventAt(date, now)

	const doc = {
		bottle_no: bottleNo,
		type,
		date,
		event_day: eventDay,
		event_at: eventAt,
		type_order: movementTypeOrder(type),
		source_type: sourceType,
		source_id: normalizeString(data.source_id) || null,
		customer_id: normalizeString(data.customer_id) || null,
		customer_name: normalizeString(data.customer_name),
		net_weight: toNumber(data.net_weight, null),
		loss_weight: toNumber(data.loss_weight, null),
		note: normalizeString(data.note),
		created_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}

	const res = await movements.add(doc)
	await recordLog(user, 'bottle_movement_create_v1', { id: res.id, type, bottle_no: bottleNo }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
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
		cloudFunction: 'crm-bottle-movement'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'listV1') return listV1(user, data, requestId)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'timelineV1') return timelineV1(user, data, requestId)
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'lossStatsV1') return lossStatsV1(user, data, requestId)
	if (action === 'cycleLossV1') return cycleLossV1(user, data, requestId)
	if (action === 'lossAnomalyRankV1') return lossAnomalyRankV1(user, data, requestId)
	if (action === 'customerLossSummaryV1') return customerLossSummaryV1(user, data, requestId)
	if (action === 'customerLossBreakdownV1') return customerLossBreakdownV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
