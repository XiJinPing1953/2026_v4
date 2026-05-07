'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const fillings = db.collection('crm_fillings')
const movements = db.collection('crm_bottle_movements')
const bottles = db.collection('crm_bottles')
const sales = db.collection('crm_sale_records')
const gasInventoryMovements = db.collection('crm_gas_inventory_movements')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-filling] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
const BATCH_UPDATE_LIMIT = 2000
const BATCH_PREVIEW_DETAIL_LIMIT = 50
const DEFAULT_RECORD_TYPE = 'normal_fill'
const FILLING_RECORD_TYPES = [
	'normal_fill',
	'truck_out_agent_sale',
	'truck_out_no_sale'
]
const FILLING_SALE_STATE_FILTERS = ['filled_unsold']
const FILLING_INPUT_MODES = ['net', 'after_fill_total']
const INVENTORY_LINKED_RECORD_TYPES = ['normal_fill', 'truck_out_agent_sale']
const CLEANUP_BACKUP_COLLECTION = 'crm_filling_no_sale_movement_backups'
const CLEANUP_SCAN_LIMIT = 5000
const CLEANUP_SAMPLE_LIMIT = 20
const CLEANUP_ALLOWED_ROLES = new Set(['superadmin', 'admin'])
const ORPHAN_CLEANUP_BACKUP_COLLECTION = 'crm_filling_orphan_fill_movement_backups'
const ORPHAN_CLEANUP_SCAN_LIMIT = 20000
const DATE_NORMALIZE_SCAN_LIMIT = 12000
const FILLED_UNSOLD_SCAN_LIMIT = 12000
const BOTTLE_FLOW_WARNING_KIND = 'bottle_flow_mismatch'
const PAGE_ACTION_RULES = {
	listV1: [
		{ pagePath: '/pages/filling/list', action: 'view' },
		{ pagePath: '/pages/pda/filling-create', action: 'view' }
	],
	getV1: [
		{ pagePath: '/pages/filling/list', action: 'view' },
		{ pagePath: '/pages/filling/edit', action: 'view' },
		{ pagePath: '/pages/pda/filling-create', action: 'view' }
	],
	resolveFillWeightV1: [
		{ pagePath: '/pages/filling/list', action: 'view' },
		{ pagePath: '/pages/pda/filling-create', action: 'view' }
	],
	createV1: [
		{ pagePath: '/pages/filling/list', action: 'create' },
		{ pagePath: '/pages/pda/filling-create', action: 'create' }
	],
	updateV1: [{ pagePath: '/pages/filling/edit', action: 'update' }],
	removeV1: [{ pagePath: '/pages/filling/list', action: 'delete' }],
	batchCreateV1: [{ pagePath: '/pages/filling/list', action: 'create' }],
	batchUpdateDateV1: [{ pagePath: '/pages/filling/list', action: 'update' }]
}
const SUPERADMIN_ONLY_ACTIONS = [
	'cleanupOrphanFillMovementsV1',
	'cleanupNoSaleMovementsV1',
	'normalizeDatesV1'
]

function roundTo(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	const base = 10 ** Number(digits || 0)
	return Math.round(num * base) / base
}

function roundTon(value) {
	return roundTo(value, 3)
}

function kgToTon(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return roundTon(num / 1000)
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
		console.error('[crm-filling] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function escapeRegExp(value) {
	return normalizeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeIdString(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		const oid = normalizeString(value.$oid || value.oid || value.id)
		if (oid) return oid
	}
	return normalizeString(value)
}

function normalizeRecordType(value, fallback = DEFAULT_RECORD_TYPE) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (FILLING_RECORD_TYPES.includes(text)) return text
	return ''
}

function normalizeSaleStateFilter(value, fallback = '') {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (FILLING_SALE_STATE_FILTERS.includes(text)) return text
	return ''
}

function normalizeInputMode(value, fallback = 'net') {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (FILLING_INPUT_MODES.includes(text)) return text
	return ''
}

function resolveInputModeByRecordType(recordType, inputMode, fallback = 'net') {
	const normalizedRecordType = normalizeRecordType(recordType, DEFAULT_RECORD_TYPE)
	const normalizedInputMode = normalizeInputMode(inputMode, fallback)
	if (!normalizedInputMode) return ''
	if (normalizedRecordType === 'truck_out_no_sale') return 'net'
	return normalizedInputMode
}

function isInventoryLinkedRecordType(value) {
	const recordType = normalizeRecordType(value, '')
	return INVENTORY_LINKED_RECORD_TYPES.includes(recordType)
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function normalizeOperatorName(value, fallback = '') {
	const text = normalizeString(value)
	if (text) return text
	return normalizeString(fallback)
}

function normalizeFillingRow(row = {}) {
	const doc = row && typeof row === 'object' ? { ...row } : {}
	const recordType = normalizeRecordType(doc.record_type, DEFAULT_RECORD_TYPE)
	const operatorName = normalizeOperatorName(doc.operator, doc.created_by_name)
	return {
		...doc,
		record_type: recordType,
		operator: operatorName,
		operator_id: normalizeIdString(doc.operator_id || doc.created_by) || null
	}
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

function toYmdByParts(yearValue, monthValue, dayValue) {
	const year = Number(yearValue)
	const month = Number(monthValue)
	const day = Number(dayValue)
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return ''
	if (year < 1970 || year > 2200) return ''
	if (month < 1 || month > 12) return ''
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	if (day < 1 || day > maxDay) return ''
	return `${year}-${pad2(month)}-${pad2(day)}`
}

function formatDayByTs(ts) {
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = pad2(d.getMonth() + 1)
	const day = pad2(d.getDate())
	return `${y}-${m}-${day}`
}

function normalizeFillingDate(value, fallbackTs = null) {
	const text = normalizeString(value)
	if (!text) {
		if (fallbackTs == null) return ''
		return formatDayByTs(toTimestamp(fallbackTs, Date.now()))
	}

	const compactYmd = text.match(/^(\d{4})(\d{2})(\d{2})$/)
	if (compactYmd) {
		const normalized = toYmdByParts(compactYmd[1], compactYmd[2], compactYmd[3])
		if (normalized) return normalized
	}

	const ymdMatch = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
	if (ymdMatch) {
		const normalized = toYmdByParts(ymdMatch[1], ymdMatch[2], ymdMatch[3])
		if (normalized) return normalized
	}

	if (/^\d{10,13}$/.test(text)) {
		const asNum = Number(text)
		if (Number.isFinite(asNum) && asNum > 0) {
			const ts = text.length === 10 ? asNum * 1000 : asNum
			return formatDayByTs(ts)
		}
	}

	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return formatDayByTs(parsed)
	return ''
}

function normalizeEventDay(dateText, fallbackTs) {
	const normalized = normalizeFillingDate(dateText, fallbackTs)
	if (normalized) return normalized
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

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeTruckNoByRule(value, fallback = '') {
	const raw = normalizeBottleNo(value || fallback)
	if (!raw) return ''
	const prefixed = raw.match(/^TRUCK[-_]?([A-Z0-9]+)$/)
	if (prefixed && prefixed[1]) return `TRUCK-${prefixed[1]}`
	const compact = raw.replace(/[^A-Z0-9\u4E00-\u9FA5]/g, '')
	if (!compact) return ''
	const plateMatch = compact.match(/^[\u4E00-\u9FA5][A-Z]([A-Z0-9]+)$/)
	const core = plateMatch && plateMatch[1] ? plateMatch[1] : compact
	return core ? `TRUCK-${core}` : ''
}

function buildTruckNoCandidates(value, fallback = '') {
	const set = new Set()
	const raw = normalizeBottleNo(value || fallback)
	const normalized = normalizeTruckNoByRule(value, fallback)
	if (raw) set.add(raw)
	if (normalized) set.add(normalized)
	return Array.from(set)
}

function looksLikeTruckNo(value) {
	const text = normalizeBottleNo(value)
	return /^TRUCK[-_A-Z0-9]/.test(text)
}

function shouldTouchTruckAnomalyForFilling(recordType, bottleNo) {
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	if (!normalizedBottleNo) return false
	const normalizedRecordType = normalizeRecordType(recordType, DEFAULT_RECORD_TYPE)
	if (normalizedRecordType === 'truck_out_agent_sale') return false
	if (normalizedRecordType === 'truck_out_no_sale') return true
	return looksLikeTruckNo(normalizedBottleNo) && normalizedRecordType === 'normal_fill'
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function toBoolean(value, fallback = false) {
	if (value === '' || value == null) return fallback
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true
	if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false
	return fallback
}

function normalizeFillingStatus(value, fallback = 'completed') {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	const allowed = ['pending', 'filling', 'completed', 'overweight', 'underweight', 'aborted', 'error']
	return allowed.includes(text) ? text : fallback
}

function normalizeRawScalePayload(value) {
	if (!value || typeof value !== 'object') return null
	try {
		return JSON.parse(JSON.stringify(value))
	} catch (err) {
		return null
	}
}

function isValidDateString(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [year, month, day] = text.split('-')
	return Boolean(toYmdByParts(year, month, day))
}

function normalizeUniqueIds(rawIds) {
	if (!Array.isArray(rawIds)) return []
	const set = new Set()
	const result = []
	for (let i = 0; i < rawIds.length; i += 1) {
		const id = normalizeString(rawIds[i])
		if (!id || set.has(id)) continue
		set.add(id)
		result.push(id)
	}
	return result
}

function mergeWhere(base, extra) {
	if (!base || (typeof base === 'object' && Object.keys(base).length === 0)) return extra
	return dbCmd.and([base, extra])
}

function createRecordTypeSummary() {
	return {
		normal_fill_count: 0,
		truck_out_agent_sale_count: 0,
		truck_out_no_sale_count: 0,
		normal_fill_weight: 0,
		truck_out_agent_sale_weight: 0,
		truck_out_no_sale_weight: 0
	}
}

function addRecordTypeStat(summary, recordType, fillWeight) {
	if (recordType === 'truck_out_agent_sale') {
		summary.truck_out_agent_sale_count += 1
		summary.truck_out_agent_sale_weight += fillWeight
		return
	}
	if (recordType === 'truck_out_no_sale') {
		summary.truck_out_no_sale_count += 1
		summary.truck_out_no_sale_weight += fillWeight
		return
	}
	summary.normal_fill_count += 1
	summary.normal_fill_weight += fillWeight
}

function buildRecordTypeSummaryByRows(rows = []) {
	const summary = createRecordTypeSummary()
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i]
		const recordType = normalizeRecordType(row && row.record_type, DEFAULT_RECORD_TYPE) || DEFAULT_RECORD_TYPE
		const fillWeight = toNumber(row && row.fill_weight, 0) || 0
		addRecordTypeStat(summary, recordType, fillWeight)
	}
	return summary
}

function countRowsWithRemark(rows = []) {
	let total = 0
	for (let i = 0; i < rows.length; i += 1) {
		if (normalizeString(rows[i] && rows[i].remark)) total += 1
	}
	return total
}

function compareFillRowDesc(left = {}, right = {}) {
	const leftDate = normalizeString(left && left.date)
	const rightDate = normalizeString(right && right.date)
	if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
	const leftCreatedAt = toTimestamp(left && left.created_at, 0)
	const rightCreatedAt = toTimestamp(right && right.created_at, 0)
	if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt
	const leftId = normalizeString(left && left._id)
	const rightId = normalizeString(right && right._id)
	if (leftId !== rightId) return rightId.localeCompare(leftId)
	return 0
}

function resolveFillingGasMovementKind(recordType, bottleNo = '') {
	const normalized = normalizeRecordType(recordType, DEFAULT_RECORD_TYPE)
	if (normalized === 'truck_out_agent_sale') return 'filling_truck_out_agent_sale'
	if (normalized === 'truck_out_no_sale') return 'filling_truck_out_no_sale'
	if (normalized === 'normal_fill' && looksLikeTruckNo(bottleNo)) return 'filling_truck_fill'
	return 'filling_normal_fill'
}

function buildFillingGasMovementPayload({ sourceId, date, bottleNo = '', recordType, fillWeight, remark = '', now = Date.now(), user = null }) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return null
	const normalizedRecordType = normalizeRecordType(recordType, DEFAULT_RECORD_TYPE)
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	const isTruckFill = normalizedRecordType === 'normal_fill' && looksLikeTruckNo(normalizedBottleNo)
	const qT = kgToTon(fillWeight)
	if (!(typeof qT === 'number' && Number.isFinite(qT) && qT !== 0)) return null

	let assetDelta = 0
	let stationDelta = 0
	let inBottleDelta = 0
	if (normalizedRecordType === 'truck_out_no_sale') {
		assetDelta = -qT
		stationDelta = -qT
		inBottleDelta = 0
	} else {
		assetDelta = 0
		stationDelta = -qT
		inBottleDelta = isTruckFill ? 0 : qT
	}

	return {
		event_day: normalizeEventDay(date, now),
		event_at: parseEventAt(date, now),
		source_type: 'filling',
		source_id: normalizedSourceId,
		movement_kind: resolveFillingGasMovementKind(normalizedRecordType, normalizedBottleNo),
		asset_delta_t: roundTon(assetDelta),
		station_delta_t: roundTon(stationDelta),
		in_bottle_delta_t: roundTon(inBottleDelta),
		note: normalizeString(remark),
		meta: {
			record_type: normalizedRecordType,
			bottle_no: normalizedBottleNo,
			fill_weight_kg: Number(fillWeight) || 0,
			inventory_scope: isTruckFill ? 'truck' : 'bottle'
		},
		created_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}
}

async function replaceGasInventoryMovementForFilling({ sourceId, date, bottleNo = '', recordType, fillWeight, remark = '', now = Date.now(), user = null }) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return
	await gasInventoryMovements.where({ source_type: 'filling', source_id: normalizedSourceId }).remove()
	const payload = buildFillingGasMovementPayload({
		sourceId: normalizedSourceId,
		date,
		bottleNo,
		recordType,
		fillWeight,
		remark,
		now,
		user
	})
	if (!payload) return
	await gasInventoryMovements.add(payload)
}

async function updateGasInventoryMovementDateForFilling({ sourceId, date, now = Date.now() }) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return
	await gasInventoryMovements
		.where({ source_type: 'filling', source_id: normalizedSourceId })
		.update({
			event_day: normalizeEventDay(date, now),
			event_at: parseEventAt(date, now)
		})
}

async function removeGasInventoryMovementForFilling(sourceId) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return
	await gasInventoryMovements.where({ source_type: 'filling', source_id: normalizedSourceId }).remove()
}

async function buildRecordTypeSummaryByWhere(where) {
	const summary = createRecordTypeSummary()
	const pageSize = 200
	let skip = 0
	while (true) {
		const res = await fillings
			.where(where)
			.field({ record_type: true, fill_weight: true })
			.skip(skip)
			.limit(pageSize)
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let i = 0; i < rows.length; i += 1) {
			const row = rows[i]
			const recordType = normalizeRecordType(row && row.record_type, DEFAULT_RECORD_TYPE) || DEFAULT_RECORD_TYPE
			const fillWeight = toNumber(row && row.fill_weight, 0) || 0
			addRecordTypeStat(summary, recordType, fillWeight)
		}
		if (rows.length < pageSize) break
		skip += rows.length
	}
	return summary
}

function buildListWhereByFilter(data = {}) {
	const bottleNo = normalizeString(data.bottle_no)
	const operator = normalizeOperatorName(data.operator)
	const recordType = normalizeRecordType(data.record_type || data.recordType, '')
	const saleStateRaw = normalizeString(
		data.sale_state
		|| data.saleState
		|| data.sale_status
		|| data.saleStatus
	)
	const saleState = normalizeSaleStateFilter(saleStateRaw, '')
	const dateStartRaw = normalizeString(data.dateStart)
	const dateEndRaw = normalizeString(data.dateEnd)
	const dateStart = dateStartRaw ? normalizeFillingDate(dateStartRaw) : ''
	const dateEnd = dateEndRaw ? normalizeFillingDate(dateEndRaw) : ''
	if (normalizeString(data.record_type || data.recordType) && !recordType) {
		return { ok: false, msg: '作业类型筛选无效' }
	}
	if (saleStateRaw && !saleState) return { ok: false, msg: '销售状态筛选无效' }
	if (dateStartRaw && !dateStart) return { ok: false, msg: '开始日期格式无效' }
	if (dateEndRaw && !dateEnd) return { ok: false, msg: '结束日期格式无效' }
	const conditions = []
	if (bottleNo) conditions.push({ bottle_no: normalizeBottleNo(bottleNo) })
	if (operator) {
		const operatorRx = db.RegExp({ regexp: escapeRegExp(operator), options: 'i' })
		conditions.push(
			dbCmd.or([
				{ operator: operatorRx },
				{ created_by_name: operatorRx }
			])
		)
	}
	if (recordType) conditions.push({ record_type: recordType })
	if (saleState === 'filled_unsold') {
		conditions.push({ record_type: dbCmd.in(INVENTORY_LINKED_RECORD_TYPES) })
	}
	if (dateStart && dateEnd) {
		conditions.push({ date: dbCmd.and([dbCmd.gte(dateStart), dbCmd.lte(dateEnd)]) })
	} else if (dateStart) {
		conditions.push({ date: dbCmd.gte(dateStart) })
	} else if (dateEnd) {
		conditions.push({ date: dbCmd.lte(dateEnd) })
	}
	let where = {}
	if (conditions.length === 1) where = conditions[0]
	if (conditions.length > 1) where = dbCmd.and(conditions)
	return {
		ok: true,
		where,
		filters: {
			bottle_no: bottleNo ? normalizeBottleNo(bottleNo) : '',
			operator,
			record_type: recordType,
			sale_state: saleState,
			dateStart,
			dateEnd
		}
	}
}

async function fetchFillingsRowsByWhere(where, { limit = FILLED_UNSOLD_SCAN_LIMIT } = {}) {
	const rowsOut = []
	const pageSize = 300
	let cursor = null
	let guard = 0
	const buildCursorWhere = (cursorPayload) => {
		if (!cursorPayload || !cursorPayload.date || !Number.isFinite(cursorPayload.created_at) || !cursorPayload._id) return null
		return dbCmd.or([
			{ date: dbCmd.lt(cursorPayload.date) },
			dbCmd.and([
				{ date: cursorPayload.date },
				{ created_at: dbCmd.lt(cursorPayload.created_at) }
			]),
			dbCmd.and([
				{ date: cursorPayload.date },
				{ created_at: cursorPayload.created_at },
				{ _id: dbCmd.lt(cursorPayload._id) }
			])
		])
	}
	while (true) {
		guard += 1
		if (guard > 120) {
			return { ok: false, msg: '已灌未售筛选范围过大，请缩小日期或瓶号范围后重试' }
		}
		const cursorWhere = buildCursorWhere(cursor)
		const queryWhere = cursorWhere ? mergeWhere(where, cursorWhere) : where
		const res = await fillings
			.where(queryWhere)
			.orderBy('date', 'desc')
			.orderBy('created_at', 'desc')
			.orderBy('_id', 'desc')
			.limit(pageSize)
			.field({
				_id: true,
				bottle_no: true,
				date: true,
				record_type: true,
				fill_weight: true,
				operator: true,
				operator_id: true,
				created_by_name: true,
				remark: true,
				created_at: true,
				updated_at: true
			})
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		rowsOut.push(...rows)
		if (rowsOut.length > limit) {
			return { ok: false, msg: `已灌未售筛选命中超过 ${limit} 条，请缩小日期或瓶号范围后重试` }
		}
		if (rows.length < pageSize) break
		const lastRow = rows[rows.length - 1] || null
		const nextCursor = {
			date: normalizeFillingDate(lastRow && lastRow.date, toTimestamp(lastRow && lastRow.created_at, Date.now())),
			created_at: toTimestamp(lastRow && lastRow.created_at, 0),
			_id: normalizeString(lastRow && lastRow._id)
		}
		if (!nextCursor.date || !Number.isFinite(nextCursor.created_at) || !nextCursor._id) break
		if (
			cursor &&
			nextCursor.date === cursor.date &&
			nextCursor.created_at === cursor.created_at &&
			nextCursor._id === cursor._id
		) {
			break
		}
		cursor = nextCursor
	}
	return { ok: true, data: rowsOut }
}

function buildLatestFillingRowByBottle(rows = []) {
	const latestByBottle = new Map()
	const sourceRows = Array.isArray(rows) ? rows : []
	for (let i = 0; i < sourceRows.length; i += 1) {
		const row = sourceRows[i]
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		if (!bottleNo) continue
		const recordType = normalizeRecordType(row && row.record_type, DEFAULT_RECORD_TYPE)
		if (!isInventoryLinkedRecordType(recordType)) continue
		const prev = latestByBottle.get(bottleNo)
		if (!prev || compareFillRowDesc(row, prev) < 0) latestByBottle.set(bottleNo, row)
	}
	return latestByBottle
}

function resolveMovementEventDay(row, fallbackTs = Date.now()) {
	return normalizeEventDay(
		(row && (row.event_day || row.date)) || '',
		toTimestamp(row && row.event_at, toTimestamp(row && row.created_at, fallbackTs))
	)
}

function buildMovementSortKey(row = {}, fallbackType = '') {
	const eventAt = toTimestamp(
		row && row.event_at,
		parseEventAt((row && (row.date || row.event_day)) || '', toTimestamp(row && row.created_at, Date.now()))
	)
	const type = normalizeMovementEventType(row && row.type) || normalizeMovementEventType(fallbackType)
	const typeOrderRaw = Number(row && row.type_order)
	const typeOrder = Number.isFinite(typeOrderRaw) ? typeOrderRaw : movementTypeOrder(type || fallbackType)
	const createdAt = toTimestamp(row && row.created_at, eventAt)
	return {
		event_at: eventAt,
		type_order: typeOrder,
		created_at: createdAt
	}
}

function isSortKeyLater(left = null, right = null) {
	if (!left || !right) return false
	if (left.event_at !== right.event_at) return left.event_at > right.event_at
	if (left.type_order !== right.type_order) return left.type_order > right.type_order
	return left.created_at > right.created_at
}

function isMovementRowWithinCutoff(row, cutoffDay = '') {
	if (!cutoffDay) return true
	const rowDay = resolveMovementEventDay(row, Date.now())
	if (!rowDay) return true
	return rowDay <= cutoffDay
}

function buildFallbackFillSortKey(fillRow = null) {
	const createdAt = toTimestamp(fillRow && fillRow.created_at, Date.now())
	const fallbackDay = normalizeFillingDate(fillRow && fillRow.date, createdAt)
	return buildMovementSortKey(
		{
			type: 'fill',
			event_day: fallbackDay,
			date: fallbackDay,
			event_at: parseEventAt(fallbackDay, createdAt),
			type_order: movementTypeOrder('fill'),
			created_at: createdAt
		},
		'fill'
	)
}

async function fetchLatestMovementSnapshotByBottleNos(bottleNos = [], { cutoffDay = '', startDay = '' } = {}) {
	const latestByBottle = new Map()
	const stats = {
		scan_chunk_total: 0,
		event_day_hit_total: 0,
		date_fallback_hit_total: 0,
		unresolved_total: 0,
		scan_query_total: 0,
		scan_row_total: 0,
		scan_guard_break_total: 0
	}
	const targetBottleNos = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!targetBottleNos.length) return { latestByBottle, stats }

	const chunkSize = 500
	const pageSize = 500
	const snapshotTypes = ['fill', 'out', 'back']
	const startEventAt = startDay ? parseEventAt(`${startDay} 00:00:00`, 0) : null
	const cutoffEventAt = cutoffDay ? parseEventAt(`${cutoffDay} 23:59:59`, Date.now()) : null

	const scanChunk = async ({ chunk = [], unresolved = new Set(), where = null, hitKey = 'event_day_hit_total' } = {}) => {
		if (!Array.isArray(chunk) || !chunk.length || !where || typeof where !== 'object') return
		let skip = 0
		let guard = 0
		while (unresolved.size > 0) {
			guard += 1
			if (guard > 120) {
				stats.scan_guard_break_total += 1
				break
			}
			stats.scan_query_total += 1
			const res = await movements
				.where(where)
				.field({
					bottle_no: true,
					type: true,
					date: true,
					event_day: true,
					event_at: true,
					type_order: true,
					source_type: true,
					source_id: true,
					created_at: true
				})
				.orderBy('event_at', 'desc')
				.orderBy('type_order', 'desc')
				.orderBy('created_at', 'desc')
				.skip(skip)
				.limit(pageSize)
				.get()
			const rows = Array.isArray(res.data) ? res.data : []
			stats.scan_row_total += rows.length
			if (!rows.length) break
			for (let j = 0; j < rows.length; j += 1) {
				const row = rows[j]
				const bottleNo = normalizeBottleNo(row && row.bottle_no)
				if (!bottleNo || !unresolved.has(bottleNo)) continue
				if (!isMovementRowWithinCutoff(row, cutoffDay)) continue
				latestByBottle.set(bottleNo, row)
				unresolved.delete(bottleNo)
				stats[hitKey] += 1
			}
			if (rows.length < pageSize) break
			skip += rows.length
		}
	}

	for (let i = 0; i < targetBottleNos.length; i += chunkSize) {
		const chunk = targetBottleNos.slice(i, i + chunkSize)
		if (!chunk.length) continue
		stats.scan_chunk_total += 1
		const unresolved = new Set(chunk)
		const primaryWhere = {
			bottle_no: dbCmd.in(chunk),
			type: dbCmd.in(snapshotTypes)
		}
		if (Number.isFinite(startEventAt) && startEventAt > 0) {
			primaryWhere.event_at = dbCmd.gte(startEventAt)
		}
		if (Number.isFinite(cutoffEventAt) && cutoffEventAt > 0) {
			primaryWhere.event_at = Number.isFinite(startEventAt) && startEventAt > 0
				? dbCmd.and([dbCmd.gte(startEventAt), dbCmd.lte(cutoffEventAt)])
				: dbCmd.lte(cutoffEventAt)
		}
		await scanChunk({
			chunk,
			unresolved,
			where: primaryWhere,
			hitKey: 'event_day_hit_total'
		})
		if (cutoffDay && unresolved.size > 0) {
			const fallbackChunk = Array.from(unresolved)
			await scanChunk({
				chunk: fallbackChunk,
				unresolved,
				where: {
					bottle_no: dbCmd.in(fallbackChunk),
					type: dbCmd.in(snapshotTypes),
					date: startDay
						? dbCmd.and([dbCmd.gte(startDay), dbCmd.lte(cutoffDay)])
						: dbCmd.lte(cutoffDay)
				},
				hitKey: 'date_fallback_hit_total'
			})
		}
		stats.unresolved_total += unresolved.size
	}

	return { latestByBottle, stats }
}

async function filterFilledUnsoldRows(rows = [], { cutoffDay = '' } = {}) {
	const sourceRows = Array.isArray(rows) ? rows : []
	const baseDebug = {
		cutoff_day: cutoffDay || '',
		candidate_fill_total: sourceRows.length,
		candidate_bottle_total: 0,
		hit_total: 0,
		fallback_no_event_total: 0,
		fallback_source_mismatch_total: 0,
		fallback_fill_after_latest_event_total: 0,
		excluded_latest_out_total: 0,
		excluded_latest_back_total: 0,
		excluded_other_total: 0,
		snapshot_scan_chunk_total: 0,
		snapshot_event_day_hit_total: 0,
		snapshot_date_fallback_hit_total: 0,
		snapshot_unresolved_total: 0,
		snapshot_scan_query_total: 0,
		snapshot_scan_row_total: 0,
		snapshot_scan_guard_break_total: 0
	}
	if (!sourceRows.length) return { rows: [], debug: baseDebug }

	const latestFillByBottle = buildLatestFillingRowByBottle(sourceRows)
	baseDebug.candidate_bottle_total = Number(latestFillByBottle.size || 0)
	if (!latestFillByBottle.size) return { rows: [], debug: baseDebug }
	const minFillDay = Array.from(latestFillByBottle.values())
		.map((row) => normalizeFillingDate(row && row.date, toTimestamp(row && row.created_at, Date.now())))
		.filter(Boolean)
		.sort()[0] || ''

	const snapshot = await fetchLatestMovementSnapshotByBottleNos(Array.from(latestFillByBottle.keys()), {
		cutoffDay,
		startDay: minFillDay
	})
	baseDebug.snapshot_scan_chunk_total = Number(snapshot.stats.scan_chunk_total || 0)
	baseDebug.snapshot_event_day_hit_total = Number(snapshot.stats.event_day_hit_total || 0)
	baseDebug.snapshot_date_fallback_hit_total = Number(snapshot.stats.date_fallback_hit_total || 0)
	baseDebug.snapshot_unresolved_total = Number(snapshot.stats.unresolved_total || 0)
	baseDebug.snapshot_scan_query_total = Number(snapshot.stats.scan_query_total || 0)
	baseDebug.snapshot_scan_row_total = Number(snapshot.stats.scan_row_total || 0)
	baseDebug.snapshot_scan_guard_break_total = Number(snapshot.stats.scan_guard_break_total || 0)
	const pickedRows = []
	for (const [bottleNo, fillRow] of latestFillByBottle.entries()) {
		const latestEvent = snapshot.latestByBottle.get(bottleNo)
		const fillSortKey = buildFallbackFillSortKey(fillRow)
		if (!latestEvent) {
			baseDebug.fallback_no_event_total += 1
			if (fillRow) pickedRows.push(fillRow)
			continue
		}
		const latestType = normalizeMovementEventType(latestEvent && latestEvent.type)
		const latestSortKey = buildMovementSortKey(latestEvent, latestType)
		if (fillSortKey && latestSortKey && isSortKeyLater(fillSortKey, latestSortKey)) {
			baseDebug.fallback_fill_after_latest_event_total += 1
			if (fillRow) pickedRows.push(fillRow)
			continue
		}
		if (latestType === 'fill') {
			const movementSourceType = normalizeString(latestEvent && latestEvent.source_type)
			const movementSourceId = normalizeString(latestEvent && latestEvent.source_id)
			const fillId = normalizeString(fillRow && fillRow._id)
			if (movementSourceType === 'filling' && movementSourceId && fillId && movementSourceId !== fillId) {
				baseDebug.fallback_source_mismatch_total += 1
			}
			if (fillRow) pickedRows.push(fillRow)
			continue
		}
		if (latestType === 'out') {
			baseDebug.excluded_latest_out_total += 1
			continue
		}
		if (latestType === 'back') {
			baseDebug.excluded_latest_back_total += 1
			continue
		}
		baseDebug.excluded_other_total += 1
	}
	baseDebug.hit_total = pickedRows.length
	return { rows: pickedRows, debug: baseDebug }
}

async function fetchFillingsByWhere(where, limit = BATCH_UPDATE_LIMIT) {
	const docs = []
	const pageSize = 200
	let skip = 0
	while (true) {
		const res = await fillings
			.where(where)
			.orderBy('date', 'desc')
			.orderBy('created_at', 'desc')
			.skip(skip)
			.limit(pageSize)
			.field({ _id: true, bottle_no: true, date: true, record_type: true, created_at: true, updated_at: true })
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		docs.push(...rows)
		if (docs.length > limit) {
			return { ok: false, msg: `单次最多更新 ${limit} 条，请缩小筛选范围` }
		}
		if (rows.length < pageSize) break
		skip += rows.length
	}
	return { ok: true, data: docs }
}

async function triggerAnomalyTouchV2(user, token, bottleNosOrPayload, requestId) {
	const payload =
		Array.isArray(bottleNosOrPayload) || bottleNosOrPayload == null
			? { bottleNos: bottleNosOrPayload || [], truckNos: [] }
			: bottleNosOrPayload
	const normalizedBottleNos = Array.from(
		new Set(
			(payload.bottleNos || [])
				.map((item) => normalizeBottleNo(item))
				.filter(Boolean)
		)
	)
	const normalizedTruckNos = Array.from(
		new Set(
			(payload.truckNos || [])
				.map((item) => normalizeBottleNo(item))
				.filter(Boolean)
		)
	)
	if (!normalizedBottleNos.length && !normalizedTruckNos.length) return { ok: true, warning: '' }

	try {
		const res = await uniCloud.callFunction({
			name: 'crm-bottle-anomaly',
			data: {
				action: 'touchV2',
				token,
				request_id: requestId,
				data: {
					bottle_nos: normalizedBottleNos,
					truck_nos: normalizedTruckNos,
					batch_size: 120,
					max_events_per_round: 800,
					max_ms_per_round: 2200,
					max_writes_per_round: 120
				}
			}
		})
		const result = res && res.result ? res.result : {}
		if (result.code === 0) {
			if (result.data && result.data.done === false) {
				return { ok: true, warning: '异常增量扫描未完成，请在异常页继续扫描' }
			}
			return { ok: true, warning: '' }
		}
		const warning = normalizeString(result.msg) || '异常增量扫描触发失败'
		await recordLog(
			user,
			'filling_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedBottleNos, truck_nos: normalizedTruckNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	} catch (err) {
		const warning = normalizeString(err && err.message) || '异常增量扫描触发失败'
		await recordLog(
			user,
			'filling_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedBottleNos, truck_nos: normalizedTruckNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	}
}

async function listV1(user, data) {
	void user
	const filterResult = buildListWhereByFilter(data)
	if (!filterResult.ok) return { code: 400, msg: filterResult.msg || '筛选参数无效' }
	const saleState = normalizeSaleStateFilter(filterResult.filters.sale_state, '')
	const exportMode = toBoolean(data.for_export ?? data.forExport ?? data.exporting, false)
	const pageSizeCap = saleState === 'filled_unsold' && exportMode ? FILLED_UNSOLD_SCAN_LIMIT : 200
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 50) || 50, 1),
		pageSizeCap
	)
	const where = filterResult.where

	if (saleState === 'filled_unsold') {
		const cutoffDay = normalizeFillingDate(filterResult.filters.dateEnd, Date.now())
		const candidateWhere = filterResult.filters.dateEnd ? where : mergeWhere(where, { date: dbCmd.lte(cutoffDay) })
		const allRowsRes = await fetchFillingsRowsByWhere(candidateWhere, { limit: FILLED_UNSOLD_SCAN_LIMIT })
		if (!allRowsRes.ok) return { code: 400, msg: allRowsRes.msg || '筛选范围过大' }
		const filtered = await filterFilledUnsoldRows(allRowsRes.data || [], { cutoffDay })
		const filledUnsoldRows = filtered.rows || []
		filledUnsoldRows.sort(compareFillRowDesc)
		const total = filledUnsoldRows.length
		const start = Math.max((page - 1) * pageSize, 0)
		const pageRowsRaw = exportMode ? filledUnsoldRows : filledUnsoldRows.slice(start, start + pageSize)
		const pageRows = pageRowsRaw.map((row) => normalizeFillingRow(row))
		const withRemark = countRowsWithRemark(filledUnsoldRows)
		const recordTypeSummary = buildRecordTypeSummaryByRows(filledUnsoldRows)
		return {
			code: 0,
			data: pageRows,
			total,
			paging: {
				page,
				pageSize: exportMode ? pageRows.length : pageSize,
				total,
				hasMore: exportMode ? false : page * pageSize < total
			},
			summary: {
				total,
				with_remark: withRemark,
				without_remark: Math.max(total - withRemark, 0),
				normal_fill_count: Number(recordTypeSummary.normal_fill_count || 0),
				truck_out_agent_sale_count: Number(recordTypeSummary.truck_out_agent_sale_count || 0),
				truck_out_no_sale_count: Number(recordTypeSummary.truck_out_no_sale_count || 0),
				normal_fill_weight: Number(recordTypeSummary.normal_fill_weight || 0),
				truck_out_agent_sale_weight: Number(recordTypeSummary.truck_out_agent_sale_weight || 0),
				truck_out_no_sale_weight: Number(recordTypeSummary.truck_out_no_sale_weight || 0),
				filled_unsold_debug: filtered.debug || {}
			}
		}
	}

	const res = await fillings
		.where(where)
		.orderBy('date', 'desc')
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await fillings.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total

	const withRemarkRes = await fillings.where(mergeWhere(where, { remark: dbCmd.neq('') })).count()
	const withRemark = Number(withRemarkRes.total || 0)
	const rows = Array.isArray(res.data) ? res.data.map((row) => normalizeFillingRow(row)) : []
	const recordTypeSummary = buildRecordTypeSummaryByRows(rows)

	return {
		code: 0,
		data: rows,
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		},
		summary: {
			total,
			with_remark: withRemark,
			without_remark: Math.max(total - withRemark, 0),
			normal_fill_count: Number(recordTypeSummary.normal_fill_count || 0),
			truck_out_agent_sale_count: Number(recordTypeSummary.truck_out_agent_sale_count || 0),
			truck_out_no_sale_count: Number(recordTypeSummary.truck_out_no_sale_count || 0),
			normal_fill_weight: Number(recordTypeSummary.normal_fill_weight || 0),
			truck_out_agent_sale_weight: Number(recordTypeSummary.truck_out_agent_sale_weight || 0),
			truck_out_no_sale_weight: Number(recordTypeSummary.truck_out_no_sale_weight || 0),
			record_type_summary_scope: 'page'
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const res = await fillings.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	return { code: 0, data: normalizeFillingRow(doc) }
}

async function resolveFillWeightV1(user, data) {
	void user
	const recordType = normalizeRecordType(data.record_type || data.recordType, DEFAULT_RECORD_TYPE)
	if (!recordType) return { code: 400, msg: '作业类型无效' }
	if (recordType === 'truck_out_no_sale') {
		return { code: 400, msg: '车辆燃气补给不支持按灌后总重推导，请改为直接录净重' }
	}
	const inventoryLinked = isInventoryLinkedRecordType(recordType)
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo || data.identifier)
	if (!bottleNo) return { code: 400, msg: buildDerivedIdentifierRequiredMessage(recordType) }
	if (inventoryLinked) {
		const archiveState = await getBottleArchiveStateByBottleNo(bottleNo)
		const archiveError = getBottleArchiveErrorMessage(archiveState)
		if (archiveError) return { code: 400, msg: archiveError }
	}
	const resolved = await resolveDerivedFillWeight({
		date: data.date,
		record_type: recordType,
		bottle_no: bottleNo,
		after_fill_total_weight: data.after_fill_total_weight ?? data.afterFillTotalWeight
	})
	if (!resolved.ok) return { code: 400, msg: resolved.msg || '推导失败' }
	return { code: 0, msg: 'ok', data: resolved.data }
}

async function hasDuplicateFillingByDateBottle(date, bottleNo, excludeId = '') {
	const normalizedDate = normalizeString(date)
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	const normalizedExcludeId = normalizeString(excludeId)
	if (!normalizedDate || !normalizedBottleNo) return false
	const res = await fillings
		.where({ date: normalizedDate, bottle_no: normalizedBottleNo })
		.field({ _id: true })
		.limit(5)
		.get()
	const rows = Array.isArray(res.data) ? res.data : []
	if (!normalizedExcludeId) return rows.length > 0
	return rows.some((row) => normalizeString(row && row._id) !== normalizedExcludeId)
}

function getBottleArchiveErrorMessage(state) {
	if (!state || !state.exists) return '钢瓶档案不存在，请先建档'
	if (!state.is_active) return '钢瓶档案未启用，不能灌装'
	return ''
}

function buildBottleRequiredMessage(recordType) {
	if (recordType === 'truck_out_agent_sale') return '代理销售必须填写瓶号'
	return '常规灌装必须填写瓶号'
}

function normalizeMovementEventType(value) {
	const text = normalizeString(value)
	if (text === 'back' || text === 'fill' || text === 'out' || text === 'adjust') return text
	return ''
}

function compareMovementEventAsc(a, b) {
	const aAt = toTimestamp(a && a.event_at, toTimestamp(a && a.created_at, 0))
	const bAt = toTimestamp(b && b.event_at, toTimestamp(b && b.created_at, 0))
	if (aAt !== bAt) return aAt - bAt
	const aOrderRaw = Number(a && a.type_order)
	const bOrderRaw = Number(b && b.type_order)
	const aOrder = Number.isFinite(aOrderRaw) ? aOrderRaw : movementTypeOrder(normalizeMovementEventType(a && a.type))
	const bOrder = Number.isFinite(bOrderRaw) ? bOrderRaw : movementTypeOrder(normalizeMovementEventType(b && b.type))
	if (aOrder !== bOrder) return aOrder - bOrder
	return toTimestamp(a && a.created_at, 0) - toTimestamp(b && b.created_at, 0)
}

function listEffectiveMovementEvents(events) {
	return (events || []).filter((row) => {
		const type = normalizeMovementEventType(row && row.type)
		return type === 'back' || type === 'fill' || type === 'out'
	})
}

function hasSameDayBackOutWithoutFill(events) {
	const effectiveEvents = listEffectiveMovementEvents(events)
	if (!effectiveEvents.length) return false
	const hasBack = effectiveEvents.some((row) => normalizeMovementEventType(row && row.type) === 'back')
	const hasFill = effectiveEvents.some((row) => normalizeMovementEventType(row && row.type) === 'fill')
	const hasOut = effectiveEvents.some((row) => normalizeMovementEventType(row && row.type) === 'out')
	return hasBack && hasOut && !hasFill
}

function sortMovementDayEventsByTypePriority(events, priorities) {
	return [...events].sort((a, b) => {
		const aType = normalizeMovementEventType(a && a.type)
		const bType = normalizeMovementEventType(b && b.type)
		const aPriority = Object.prototype.hasOwnProperty.call(priorities, aType) ? priorities[aType] : 99
		const bPriority = Object.prototype.hasOwnProperty.call(priorities, bType) ? priorities[bType] : 99
		if (aPriority !== bPriority) return aPriority - bPriority
		return compareMovementEventAsc(a, b)
	})
}

function shouldQueueSameDayBackOut(events, state) {
	if (!hasSameDayBackOutWithoutFill(events)) return false
	if (Array.isArray(state && state.pendingSameDayBackOut) && state.pendingSameDayBackOut.length > 0) return true
	if (state && state.activeBackEvent) return false
	if (normalizeMovementEventType(state && state.lastEffectiveType) === 'out') return false
	return true
}

function buildMovementDayBusinessOrder(events, state) {
	const sorted = [...events].sort(compareMovementEventAsc)
	if (!hasSameDayBackOutWithoutFill(sorted)) return sorted
	if (shouldQueueSameDayBackOut(sorted, state)) return sorted
	if (state && state.activeBackEvent) {
		return sortMovementDayEventsByTypePriority(sorted, { out: 10, back: 20, adjust: 30 })
	}
	return sorted
}

function buildPendingSameDayBackOutEntry(events) {
	const sorted = [...listEffectiveMovementEvents(events)].sort(compareMovementEventAsc)
	const backEvents = sorted.filter((row) => normalizeMovementEventType(row && row.type) === 'back')
	const outEvents = sorted.filter((row) => normalizeMovementEventType(row && row.type) === 'out')
	const back = backEvents[backEvents.length - 1] || null
	const out = outEvents[outEvents.length - 1] || null
	if (!back || !out) return null
	return {
		event_day: normalizeEventDay(
			(out && out.event_day) || (back && back.event_day) || '',
			Math.max(toTimestamp(out && out.event_at, 0), toTimestamp(back && back.event_at, 0), Date.now())
		),
		back,
		out
	}
}

function resolvePendingSameDayBackOut(state, nextType) {
	const queue = Array.isArray(state && state.pendingSameDayBackOut) ? state.pendingSameDayBackOut : []
	if (!queue.length) return
	const type = normalizeMovementEventType(nextType)
	if (!type || type === 'adjust') return
	const latest = queue[queue.length - 1] || null
	state.pendingSameDayBackOut = []
	if (!latest || !latest.back || !latest.out) return
	if (type === 'fill') {
		state.activeBackEvent = latest.back
		state.lastEffectiveType = 'back'
		state.lastEffectiveEvent = latest.back
		return
	}
	state.activeBackEvent = null
	state.lastEffectiveType = 'out'
	state.lastEffectiveEvent = latest.out
}

function buildBottleFlowStateFromMovementRows(rows = []) {
	const state = {
		activeBackEvent: null,
		pendingSameDayBackOut: [],
		lastEffectiveType: '',
		lastEffectiveEvent: null
	}
	const sortedRows = [...(rows || [])].sort(compareMovementEventAsc)
	let dayBuffer = []

	const flushDayBuffer = () => {
		if (!dayBuffer.length) return
		const sorted = buildMovementDayBusinessOrder(dayBuffer, state)
		dayBuffer = []
		if (shouldQueueSameDayBackOut(sorted, state)) {
			const pendingEntry = buildPendingSameDayBackOutEntry(sorted)
			if (pendingEntry) state.pendingSameDayBackOut = [...state.pendingSameDayBackOut, pendingEntry]
			return
		}
		const effectiveEvents = listEffectiveMovementEvents(sorted)
		if (effectiveEvents.length) {
			resolvePendingSameDayBackOut(state, effectiveEvents[0].type)
		}
		for (const row of sorted) {
			const type = normalizeMovementEventType(row && row.type)
			if (type === 'back') {
				state.activeBackEvent = row
				state.lastEffectiveType = 'back'
				state.lastEffectiveEvent = row
				continue
			}
			if (type === 'fill') {
				state.lastEffectiveType = 'fill'
				state.lastEffectiveEvent = row
				continue
			}
			if (type === 'out') {
				state.lastEffectiveType = 'out'
				state.lastEffectiveEvent = row
				if (state.activeBackEvent) state.activeBackEvent = null
			}
		}
	}

	for (const row of sortedRows) {
		const eventDay = normalizeEventDay(
			(row && (row.event_day || row.date)) || '',
			toTimestamp(row && row.event_at, toTimestamp(row && row.created_at, Date.now()))
		)
		if (!dayBuffer.length) {
			dayBuffer.push(row)
			continue
		}
		const currentDay = normalizeEventDay(
			(dayBuffer[0] && (dayBuffer[0].event_day || dayBuffer[0].date)) || '',
			toTimestamp(dayBuffer[0] && dayBuffer[0].event_at, toTimestamp(dayBuffer[0] && dayBuffer[0].created_at, Date.now()))
		)
		if (eventDay === currentDay) {
			dayBuffer.push(row)
			continue
		}
		flushDayBuffer()
		dayBuffer.push(row)
	}

	flushDayBuffer()

	const pendingQueue = Array.isArray(state.pendingSameDayBackOut) ? state.pendingSameDayBackOut : []
	const pendingLatest = pendingQueue.length ? pendingQueue[pendingQueue.length - 1] : null
	return {
		last_effective_type: normalizeMovementEventType(state.lastEffectiveType),
		last_effective_event: state.lastEffectiveEvent || null,
		active_back_event: state.activeBackEvent || null,
		has_pending_same_day_back_out: pendingQueue.length > 0,
		pending_same_day_back_out_latest: pendingLatest || null
	}
}

async function fetchBottleMovementRowsByBottleNos(bottleNos = [], { dateEnd = '', excludeFillingId = '' } = {}) {
	const normalized = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalized.length) return []
	const result = []
	const excludedId = normalizeString(excludeFillingId)
	const chunkSize = 200
	for (let i = 0; i < normalized.length; i += chunkSize) {
		const chunk = normalized.slice(i, i + chunkSize)
		const where = { bottle_no: dbCmd.in(chunk) }
		if (dateEnd) where.date = dbCmd.lte(dateEnd)
		const res = await movements
			.where(where)
			.field({
				bottle_no: true,
				type: true,
				date: true,
				event_day: true,
				event_at: true,
				type_order: true,
				source_type: true,
				source_id: true,
				customer_id: true,
				customer_name: true,
				created_at: true
			})
			.orderBy('event_at', 'asc')
			.orderBy('type_order', 'asc')
			.orderBy('created_at', 'asc')
			.limit(5000)
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let j = 0; j < rows.length; j += 1) {
			const row = rows[j]
			if (
				excludedId
				&& normalizeString(row && row.source_type) === 'filling'
				&& normalizeString(row && row.source_id) === excludedId
			) {
				continue
			}
			result.push(row)
		}
	}
	return result
}

function buildBottleFlowStateMap(rows = [], bottleNos = []) {
	const grouped = new Map()
	;(bottleNos || []).forEach((item) => {
		const bottleNo = normalizeBottleNo(item)
		if (bottleNo && !grouped.has(bottleNo)) grouped.set(bottleNo, [])
	})
	;(rows || []).forEach((row) => {
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		if (!bottleNo) return
		if (!grouped.has(bottleNo)) grouped.set(bottleNo, [])
		grouped.get(bottleNo).push(row)
	})
	const map = new Map()
	for (const [bottleNo, bottleRows] of grouped.entries()) {
		map.set(bottleNo, buildBottleFlowStateFromMovementRows(bottleRows))
	}
	return map
}

function normalizeBottleCurrentStatus(value) {
	const text = normalizeString(value).toLowerCase()
	if (['unknown', 'in_station', 'at_customer', 'lost', 'scrapped'].includes(text)) return text
	return ''
}

function shouldSyncBottleCurrentStatus(value) {
	const bottleNo = normalizeBottleNo(value)
	return Boolean(bottleNo && bottleNo !== '000' && !/^TRUCK-/.test(bottleNo))
}

async function fetchBottleDocsByBottleNos(bottleNos = []) {
	const normalized = Array.from(
		new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter((item) => shouldSyncBottleCurrentStatus(item)))
	)
	if (!normalized.length) return []
	const out = []
	for (let i = 0; i < normalized.length; i += 200) {
		const chunk = normalized.slice(i, i + 200)
		const res = await bottles
			.where({ bottle_no: dbCmd.in(chunk) })
			.field({
				_id: true,
				bottle_no: true,
				status: true,
				current_customer_id: true,
				current_customer_name: true
			})
			.limit(chunk.length)
			.get()
		out.push(...(res.data || []))
	}
	return out
}

function buildExpectedBottleCurrentState(state = null) {
	if (!state) {
		return {
			status: 'unknown',
			current_customer_id: null,
			current_customer_name: ''
		}
	}
	if (state.has_pending_same_day_back_out) {
		return { skip_reason: 'pending_same_day_back_out' }
	}
	const lastType = normalizeMovementEventType(state.last_effective_type)
	const lastEvent = state.last_effective_event || null
	if (lastType === 'out') {
		return {
			status: 'at_customer',
			current_customer_id: normalizeString(lastEvent && lastEvent.customer_id) || null,
			current_customer_name: normalizeString(lastEvent && lastEvent.customer_name)
		}
	}
	if (lastType === 'back' || lastType === 'fill') {
		return {
			status: 'in_station',
			current_customer_id: null,
			current_customer_name: ''
		}
	}
	return {
		status: 'unknown',
		current_customer_id: null,
		current_customer_name: ''
	}
}

async function syncBottleCurrentStatusByBottleNos(bottleNos = []) {
	const targetDocs = await fetchBottleDocsByBottleNos(bottleNos)
	if (!targetDocs.length) {
		return { target_total: 0, updated_total: 0, skipped_pending_total: 0 }
	}
	const targetBottleNos = targetDocs.map((item) => normalizeBottleNo(item && item.bottle_no)).filter(Boolean)
	const movementRows = await fetchBottleMovementRowsByBottleNos(targetBottleNos)
	const stateMap = buildBottleFlowStateMap(movementRows, targetBottleNos)
	let updatedTotal = 0
	let skippedPendingTotal = 0
	for (let i = 0; i < targetDocs.length; i += 1) {
		const doc = targetDocs[i]
		const bottleNo = normalizeBottleNo(doc && doc.bottle_no)
		if (!bottleNo) continue
		const expected = buildExpectedBottleCurrentState(stateMap.get(bottleNo) || null)
		if (expected.skip_reason === 'pending_same_day_back_out') {
			skippedPendingTotal += 1
			continue
		}
		const nextStatus = normalizeBottleCurrentStatus(expected && expected.status) || 'unknown'
		const nextCustomerId = normalizeString(expected && expected.current_customer_id) || null
		const nextCustomerName = normalizeString(expected && expected.current_customer_name)
		const currentStatus = normalizeBottleCurrentStatus(doc && doc.status) || 'unknown'
		const currentCustomerId = normalizeString(doc && doc.current_customer_id) || null
		const currentCustomerName = normalizeString(doc && doc.current_customer_name)
		if (
			currentStatus === nextStatus &&
			currentCustomerId === nextCustomerId &&
			currentCustomerName === nextCustomerName
		) {
			continue
		}
		await bottles.doc(doc._id).update({
			status: nextStatus,
			current_customer_id: nextCustomerId,
			current_customer_name: nextCustomerName,
			updated_at: Date.now()
		})
		updatedTotal += 1
	}
	return {
		target_total: targetDocs.length,
		updated_total: updatedTotal,
		skipped_pending_total: skippedPendingTotal
	}
}

function getBottleFlowWarningOutEvent(state) {
	if (!state || typeof state !== 'object') return null
	if (state.has_pending_same_day_back_out) {
		return state.pending_same_day_back_out_latest && state.pending_same_day_back_out_latest.out
			? state.pending_same_day_back_out_latest.out
			: null
	}
	if (normalizeMovementEventType(state.last_effective_type) !== 'out') return null
	return state.last_effective_event || null
}

function buildFillingBottleFlowWarningReason(state) {
	const outEvent = getBottleFlowWarningOutEvent(state)
	const lastOutDate = normalizeFillingDate((outEvent && (outEvent.date || outEvent.event_day)) || '')
	const lastOutCustomerName = normalizeString(outEvent && outEvent.customer_name)
	if (state && state.has_pending_same_day_back_out) {
		if (lastOutDate && lastOutCustomerName) return `${lastOutDate}出瓶至"${lastOutCustomerName}"后，同日存在回瓶/出瓶待确认，请检查`
		if (lastOutDate) return `${lastOutDate}同日存在回瓶/出瓶待确认，请检查`
		return '同日存在回瓶/出瓶待确认，请检查'
	}
	if (lastOutDate && lastOutCustomerName) return `${lastOutDate}出瓶至"${lastOutCustomerName}"，未回瓶，请检查`
	if (lastOutDate) return `${lastOutDate}已出瓶且未回瓶，请检查`
	if (lastOutCustomerName) return `最近出瓶至"${lastOutCustomerName}"后未回瓶，请检查`
	return '最近状态仍为出瓶，未回瓶，请检查'
}

function buildFillingBottleFlowWarningItem(bottleNo, state) {
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	if (!normalizedBottleNo || !state) return null
	const outEvent = getBottleFlowWarningOutEvent(state)
	return {
		bottle_no: normalizedBottleNo,
		last_out_date: normalizeFillingDate((outEvent && (outEvent.date || outEvent.event_day)) || ''),
		last_out_customer_name: normalizeString(outEvent && outEvent.customer_name),
		status_code: state.has_pending_same_day_back_out ? 'waiting_next_action' : 'out',
		reason: buildFillingBottleFlowWarningReason(state)
	}
}

function buildFillingBottleFlowWarningSummaryText(warningItems = []) {
	const total = Array.isArray(warningItems) ? warningItems.length : 0
	if (!total) return ''
	const pendingCount = warningItems.filter((item) => normalizeString(item && item.status_code) === 'waiting_next_action').length
	const outCount = total - pendingCount
	if (pendingCount > 0) {
		return `发现 ${total} 条灌装流转预警：未回瓶 ${outCount} 条，待确认 ${pendingCount} 条。`
	}
	return `发现 ${total} 条灌装流转预警，请核对瓶号。`
}

function buildFillingBottleFlowWarningResponse(warningItems = []) {
	const summaryText = buildFillingBottleFlowWarningSummaryText(warningItems)
	return {
		code: 409,
		msg: summaryText || '请核对瓶号后再提交',
		data: {
			confirmable: true,
			warning_kind: BOTTLE_FLOW_WARNING_KIND,
			warning_items: warningItems,
			summary_text: summaryText
		}
	}
}

async function collectFillingBottleFlowWarnings({ date, bottleNos = [], excludeFillingId = '' } = {}) {
	const normalizedDate = normalizeFillingDate(date)
	const normalizedBottleNos = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalizedDate || !normalizedBottleNos.length) return []
	const movementRows = await fetchBottleMovementRowsByBottleNos(normalizedBottleNos, {
		dateEnd: normalizedDate,
		excludeFillingId
	})
	const stateMap = buildBottleFlowStateMap(movementRows, normalizedBottleNos)
	const warningItems = []
	for (let i = 0; i < normalizedBottleNos.length; i += 1) {
		const bottleNo = normalizedBottleNos[i]
		const state = stateMap.get(bottleNo) || null
		if (!state) continue
		if (state.has_pending_same_day_back_out) {
			const item = buildFillingBottleFlowWarningItem(bottleNo, state)
			if (item) warningItems.push(item)
			continue
		}
		if (normalizeMovementEventType(state.last_effective_type) !== 'out') continue
		const item = buildFillingBottleFlowWarningItem(bottleNo, state)
		if (item) warningItems.push(item)
	}
	return warningItems
}

async function getBottleArchiveMapByBottleNos(bottleNos = []) {
	const normalized = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	const map = new Map()
	for (let i = 0; i < normalized.length; i += 1) {
		map.set(normalized[i], { exists: false, is_active: false })
	}
	if (!normalized.length) return map

	const chunkSize = 200
	for (let i = 0; i < normalized.length; i += chunkSize) {
		const chunk = normalized.slice(i, i + chunkSize)
		const res = await bottles
			.where({ bottle_no: dbCmd.in(chunk) })
			.field({ bottle_no: true, is_active: true })
			.limit(chunk.length)
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let j = 0; j < rows.length; j += 1) {
			const row = rows[j]
			const bottleNo = normalizeBottleNo(row && row.bottle_no)
			if (!bottleNo) continue
			map.set(bottleNo, { exists: true, is_active: Boolean(row && row.is_active) })
		}
	}
	return map
}

async function getBottleArchiveStateByBottleNo(bottleNo) {
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	if (!normalizedBottleNo) return { exists: false, is_active: false }
	const map = await getBottleArchiveMapByBottleNos([normalizedBottleNo])
	return map.get(normalizedBottleNo) || { exists: false, is_active: false }
}

function formatDerivedNumber(value) {
	const num = toNumber(value, null)
	if (!(typeof num === 'number' && Number.isFinite(num))) return ''
	const rounded = roundTo(num, 3)
	if (Number.isInteger(rounded)) return String(rounded)
	return String(rounded).replace(/\.?0+$/, '')
}

function buildDerivedIdentifierRequiredMessage(recordType) {
	if (recordType === 'truck_out_no_sale') return '车辆燃气补给必须填写车牌号'
	if (recordType === 'truck_out_agent_sale') return '代理销售必须填写瓶号'
	return '常规灌装必须填写瓶号'
}

function buildDerivedBasisMissingMessage(recordType, identifier) {
	if (recordType === 'truck_out_no_sale') {
		return `未找到车牌 ${identifier || '-'} 的最近回站总重`
	}
	return `未找到瓶号 ${identifier || '-'} 的最近回瓶总重`
}

function buildDerivedBasisSourceLabel(source) {
	if (source === 'truck_back_gross') return 'truck_back_gross'
	if (source === 'back_tare_plus_net') return 'back_tare_plus_net'
	return 'back_gross'
}

function buildDerivedFillRemark(remark, payload = {}) {
	const suffix = [
		'[derived-fill]',
		'mode=after_fill_total',
		`raw_total=${formatDerivedNumber(payload.after_fill_total_weight) || '-'}`,
		`basis=${buildDerivedBasisSourceLabel(payload.basis_source)}`,
		`basis_value=${formatDerivedNumber(payload.basis_value) || '-'}`,
		`basis_ref=${normalizeString(payload.basis_ref) || '-'}`,
		`basis_date=${normalizeString(payload.basis_date) || '-'}`,
		`derived=${formatDerivedNumber(payload.derived_fill_weight) || '-'}`
	].join(' ')
	const baseRemark = normalizeString(remark)
	return baseRemark ? `${baseRemark} ${suffix}` : suffix
}

function resolveBackItemBasis(row = {}) {
	const gross = toNumber(row && row.gross, null)
	if (typeof gross === 'number' && Number.isFinite(gross) && gross > 0) {
		return { value: roundTo(gross, 3), source: 'back_gross' }
	}
	const tare = toNumber(row && row.tare, null)
	const net = toNumber(row && row.net, null)
	if (
		typeof tare === 'number'
		&& Number.isFinite(tare)
		&& tare >= 0
		&& typeof net === 'number'
		&& Number.isFinite(net)
		&& net >= 0
	) {
		const total = roundTo(tare + net, 3)
		if (total > 0) return { value: total, source: 'back_tare_plus_net' }
	}
	return null
}

async function findLatestBackBasisByBottleNo(bottleNo, date) {
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	const normalizedDate = normalizeFillingDate(date)
	if (!normalizedBottleNo || !normalizedDate) return null
	const basisByMovement = await findLatestBackBasisByBottleNoFromMovements(normalizedBottleNo, normalizedDate)
	if (basisByMovement) return basisByMovement
	const basisBySales = await findLatestBackBasisByBottleNoFromSales(normalizedBottleNo, normalizedDate)
	if (basisBySales) return basisBySales
	return findLatestBackBasisByBottleNoByRecentScan(normalizedBottleNo, normalizedDate)
}

function buildBackBottleWhereCandidates(normalizedBottleNo) {
	const candidates = [{ 'back_items.bottle_no': normalizedBottleNo }]
	if (/^\d+$/.test(normalizedBottleNo)) {
		const asNumber = Number(normalizedBottleNo)
		if (Number.isFinite(asNumber)) candidates.push({ 'back_items.bottle_no': asNumber })
	}
	return candidates
}

async function fetchSaleDocsByIds(saleIds = []) {
	const normalizedIds = []
	const seen = new Set()
	for (let i = 0; i < saleIds.length; i += 1) {
		const id = normalizeString(saleIds[i])
		if (!id || seen.has(id)) continue
		seen.add(id)
		normalizedIds.push(id)
	}
	if (!normalizedIds.length) return new Map()
	const map = new Map()
	const chunkSize = 100
	for (let i = 0; i < normalizedIds.length; i += chunkSize) {
		const chunk = normalizedIds.slice(i, i + chunkSize)
		const res = await sales
			.where({ _id: dbCmd.in(chunk) })
			.field({ _id: true, date: true, updated_at: true, created_at: true, back_items: true })
			.limit(chunk.length)
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let j = 0; j < rows.length; j += 1) {
			const row = rows[j] || {}
			const id = normalizeString(row._id)
			if (!id) continue
			map.set(id, row)
		}
	}
	return map
}

function pickBasisFromSaleDocByBottleNo(saleDoc = {}, normalizedBottleNo = '') {
	const backItems = Array.isArray(saleDoc.back_items) ? saleDoc.back_items : []
	for (let i = 0; i < backItems.length; i += 1) {
		const item = backItems[i] || {}
		if (normalizeBottleNo(item.bottle_no) !== normalizedBottleNo) continue
		const basis = resolveBackItemBasis(item)
		if (!basis) continue
		return {
			value: basis.value,
			source: basis.source,
			ref: normalizeString(saleDoc._id),
			date: normalizeString(saleDoc.date)
		}
	}
	return null
}

async function findLatestBackBasisByBottleNoFromMovements(normalizedBottleNo, normalizedDate) {
	const res = await movements
		.where({
			type: 'back',
			source_type: 'sale',
			bottle_no: normalizedBottleNo,
			date: dbCmd.lte(normalizedDate)
		})
		.field({ source_id: true, date: true, updated_at: true, created_at: true })
		.orderBy('date', 'desc')
		.orderBy('updated_at', 'desc')
		.orderBy('created_at', 'desc')
		.limit(200)
		.get()
	const movementRows = Array.isArray(res.data) ? res.data : []
	if (!movementRows.length) return null
	const sourceIds = []
	const seen = new Set()
	for (let i = 0; i < movementRows.length; i += 1) {
		const sourceId = normalizeString((movementRows[i] || {}).source_id)
		if (!sourceId || seen.has(sourceId)) continue
		seen.add(sourceId)
		sourceIds.push(sourceId)
	}
	if (!sourceIds.length) return null
	const saleMap = await fetchSaleDocsByIds(sourceIds)
	for (let i = 0; i < sourceIds.length; i += 1) {
		const saleDoc = saleMap.get(sourceIds[i])
		if (!saleDoc) continue
		const basis = pickBasisFromSaleDocByBottleNo(saleDoc, normalizedBottleNo)
		if (basis) return basis
	}
	return null
}

async function findLatestBackBasisByBottleNoFromSales(normalizedBottleNo, normalizedDate) {
	const whereCandidates = buildBackBottleWhereCandidates(normalizedBottleNo)
	const where = whereCandidates.length > 1
		? dbCmd.and([{ date: dbCmd.lte(normalizedDate) }, dbCmd.or(whereCandidates)])
		: { date: dbCmd.lte(normalizedDate), ...whereCandidates[0] }
	const res = await sales
		.where(where)
		.field({ _id: true, date: true, updated_at: true, created_at: true, back_items: true })
		.orderBy('date', 'desc')
		.orderBy('updated_at', 'desc')
		.orderBy('created_at', 'desc')
		.limit(120)
		.get()
	const rows = Array.isArray(res.data) ? res.data : []
	for (let i = 0; i < rows.length; i += 1) {
		const basis = pickBasisFromSaleDocByBottleNo(rows[i] || {}, normalizedBottleNo)
		if (basis) return basis
	}
	return null
}

async function findLatestBackBasisByBottleNoByRecentScan(normalizedBottleNo, normalizedDate) {
	const res = await sales
		.where({
			date: dbCmd.lte(normalizedDate),
			back_items: dbCmd.neq([])
		})
		.field({ _id: true, date: true, updated_at: true, created_at: true, back_items: true })
		.orderBy('date', 'desc')
		.orderBy('updated_at', 'desc')
		.orderBy('created_at', 'desc')
		.limit(240)
		.get()
	const rows = Array.isArray(res.data) ? res.data : []
	for (let i = 0; i < rows.length; i += 1) {
		const basis = pickBasisFromSaleDocByBottleNo(rows[i] || {}, normalizedBottleNo)
		if (basis) return basis
	}
	return null
}

async function findLatestTruckBackBasisByTruckNo(truckNo, date) {
	const truckNoCandidates = buildTruckNoCandidates(truckNo)
	const normalizedDate = normalizeFillingDate(date)
	if (!truckNoCandidates.length || !normalizedDate) return null
	const truckNoWhere = truckNoCandidates.length === 1 ? truckNoCandidates[0] : dbCmd.in(truckNoCandidates)
	const res = await sales
		.where({
			biz_mode: 'truck',
			truck_no: truckNoWhere,
			date: dbCmd.lte(normalizedDate)
		})
		.field({ _id: true, date: true, updated_at: true, created_at: true, truck_back_gross: true })
		.orderBy('date', 'desc')
		.orderBy('updated_at', 'desc')
		.orderBy('created_at', 'desc')
		.limit(100)
		.get()
	const rows = Array.isArray(res.data) ? res.data : []
	for (let i = 0; i < rows.length; i += 1) {
		const saleDoc = rows[i] || {}
		const gross = toNumber(saleDoc.truck_back_gross, null)
		if (!(typeof gross === 'number' && Number.isFinite(gross) && gross > 0)) continue
		return {
			value: roundTo(gross, 3),
			source: 'truck_back_gross',
			ref: normalizeString(saleDoc._id),
			date: normalizeString(saleDoc.date)
		}
	}
	return null
}

async function resolveDerivedFillWeight(data = {}) {
	const date = normalizeFillingDate(data.date)
	if (!date) return { ok: false, msg: '灌装日期格式无效' }
	const recordType = normalizeRecordType(data.record_type || data.recordType, DEFAULT_RECORD_TYPE)
	if (!recordType) return { ok: false, msg: '作业类型无效' }
	const identifier = normalizeBottleNo(data.bottle_no || data.bottleNo || data.identifier)
	if (!identifier) {
		return { ok: false, msg: buildDerivedIdentifierRequiredMessage(recordType) }
	}
	const afterFillTotalWeight = toNumber(data.after_fill_total_weight ?? data.afterFillTotalWeight, null)
	if (!(typeof afterFillTotalWeight === 'number' && Number.isFinite(afterFillTotalWeight) && afterFillTotalWeight > 0)) {
		return { ok: false, msg: '灌后总重必填且大于 0' }
	}

	let basis = null
	if (recordType === 'truck_out_no_sale') {
		basis = await findLatestTruckBackBasisByTruckNo(identifier, date)
	} else {
		basis = await findLatestBackBasisByBottleNo(identifier, date)
	}
	if (!basis) {
		return { ok: false, msg: buildDerivedBasisMissingMessage(recordType, identifier) }
	}

	const derivedFillWeight = roundTo(afterFillTotalWeight - basis.value, 3)
	if (!(derivedFillWeight > 0)) {
		return { ok: false, msg: '根据灌后总重和命中依据推导出的净重必须大于 0' }
	}

	return {
		ok: true,
		data: {
			date,
			record_type: recordType,
			bottle_no: identifier,
			after_fill_total_weight: roundTo(afterFillTotalWeight, 3),
			basis_value: basis.value,
			basis_source: basis.source,
			basis_ref: basis.ref,
			basis_date: basis.date,
			derived_fill_weight: derivedFillWeight
		}
	}
}

function normalizeUniqueBottleNos(rawBottleNos = []) {
	const set = new Set()
	const out = []
	for (let i = 0; i < rawBottleNos.length; i += 1) {
		const bottleNo = normalizeBottleNo(rawBottleNos[i])
		if (!bottleNo || set.has(bottleNo)) continue
		set.add(bottleNo)
		out.push(bottleNo)
	}
	return out
}

function isMissingCollectionError(err) {
	const msg = normalizeString(err && err.message).toLowerCase()
	if (!msg) return false
	return msg.includes('not found collection') || msg.includes('collection not found') || msg.includes('找不到集合')
}

async function fetchFillMovementsBySourceIds(sourceIds = [], limit = CLEANUP_SCAN_LIMIT) {
	const ids = normalizeUniqueIds(sourceIds)
	if (!ids.length) return { ok: true, data: [] }
	const chunkSize = 150
	const rows = []
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize)
		const res = await movements
			.where({ type: 'fill', source_id: dbCmd.in(chunk) })
			.limit(500)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (rows.length > limit) {
			return { ok: false, msg: `待清洗 movement 超过 ${limit} 条，请先分批处理` }
		}
	}
	return { ok: true, data: rows }
}

async function triggerAnomalyTouchV2InChunks(user, token, bottleNos, requestId, chunkSize = 120) {
	const normalized = normalizeUniqueBottleNos(bottleNos || [])
	if (!normalized.length) return { ok: true, warning: '' }
	let warning = ''
	let allOk = true
	for (let i = 0; i < normalized.length; i += chunkSize) {
		const chunk = normalized.slice(i, i + chunkSize)
		const res = await triggerAnomalyTouchV2(user, token, chunk, requestId)
		if (!res.ok) allOk = false
		if (!warning && normalizeString(res.warning)) warning = normalizeString(res.warning)
	}
	return { ok: allOk, warning }
}

function buildCleanupSampleItems(movementRows = [], fillingMap = new Map()) {
	return movementRows.slice(0, CLEANUP_SAMPLE_LIMIT).map((movement) => {
		const movementId = normalizeString(movement && movement._id)
		const sourceId = normalizeString(movement && movement.source_id)
		const fillingDoc = fillingMap.get(sourceId) || null
		return {
			movement_id: movementId,
			source_id: sourceId,
			bottle_no: normalizeBottleNo(movement && movement.bottle_no) || normalizeBottleNo(fillingDoc && fillingDoc.bottle_no),
			date: normalizeString(movement && movement.date) || normalizeString(fillingDoc && fillingDoc.date)
		}
	})
}

function normalizeMovementEventDay(row = {}) {
	const byEventDay = normalizeFillingDate(row && row.event_day)
	if (byEventDay) return byEventDay
	return normalizeFillingDate(row && row.date)
}

function normalizeMovementWeightKey(value) {
	const num = toNumber(value, null)
	if (!(typeof num === 'number' && Number.isFinite(num))) return ''
	return String(Math.round(num * 1000) / 1000)
}

function buildFillMovementLegacyKey(row = {}) {
	const bottleNo = normalizeBottleNo(row && row.bottle_no)
	const eventDay = normalizeMovementEventDay(row)
	const weightKey = normalizeMovementWeightKey(row && row.net_weight)
	return `${bottleNo}|${eventDay}|${weightKey}`
}

async function fetchFillingsForOrphanCleanup(limit = ORPHAN_CLEANUP_SCAN_LIMIT) {
	const rows = []
	const pageSize = 400
	let skip = 0
	while (true) {
		const res = await fillings
			.field({ _id: true, bottle_no: true, date: true, fill_weight: true })
			.skip(skip)
			.limit(pageSize)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (rows.length > limit) {
			return { ok: false, msg: `灌装台账超过 ${limit} 条，请调大 scan_limit 或分批处理` }
		}
		if (list.length < pageSize) break
		skip += list.length
	}
	return { ok: true, data: rows }
}

async function fetchFillMovementsForOrphanCleanup(limit = ORPHAN_CLEANUP_SCAN_LIMIT) {
	const rows = []
	const pageSize = 400
	let skip = 0
	while (true) {
		const res = await movements
			.where({ type: 'fill' })
			.field({
				_id: true,
				bottle_no: true,
				type: true,
				date: true,
				event_day: true,
				source_type: true,
				source_id: true,
				net_weight: true
			})
			.skip(skip)
			.limit(pageSize)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (rows.length > limit) {
			return { ok: false, msg: `灌装流转超过 ${limit} 条，请调大 scan_limit 或分批处理` }
		}
		if (list.length < pageSize) break
		skip += list.length
	}
	return { ok: true, data: rows }
}

function buildOrphanCleanupSampleItems(candidateRows = [], limit = CLEANUP_SAMPLE_LIMIT) {
	return (candidateRows || []).slice(0, limit).map((item) => ({
		movement_id: normalizeString(item && item.movement_id),
		date: normalizeString(item && item.date),
		event_day: normalizeString(item && item.event_day),
		bottle_no: normalizeBottleNo(item && item.bottle_no),
		net_weight: toNumber(item && item.net_weight, null),
		source_type: normalizeString(item && item.source_type),
		source_id: normalizeString(item && item.source_id),
		legacy_match_count: Number(item && item.legacy_match_count ? item.legacy_match_count : 0),
		legacy_match_samples: Array.isArray(item && item.legacy_match_samples) ? item.legacy_match_samples : []
	}))
}

async function cleanupOrphanFillMovementsV1(user, data, requestId, token) {
	if (!CLEANUP_ALLOWED_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅管理员可操作' }
	}
	const preview = data && data.preview !== false
	const runId = normalizeString(data && (data.run_id || data.runId)) || `cleanup_orphan_fill_${Date.now()}`
	const skipBackup = Boolean(
		data &&
			(data.skip_backup === true || data.skipBackup === true || data.no_backup === true || data.noBackup === true)
	)
	const scanLimitRaw = toNumber(data && (data.scan_limit || data.scanLimit), ORPHAN_CLEANUP_SCAN_LIMIT)
	const scanLimit = Math.min(
		ORPHAN_CLEANUP_SCAN_LIMIT,
		Math.max(Number.isFinite(scanLimitRaw) ? Math.floor(scanLimitRaw) : ORPHAN_CLEANUP_SCAN_LIMIT, 2000)
	)

	const fillingsRes = await fetchFillingsForOrphanCleanup(scanLimit)
	if (!fillingsRes.ok) return { code: 400, msg: fillingsRes.msg || '清洗扫描失败' }
	const fillingRows = Array.isArray(fillingsRes.data) ? fillingsRes.data : []
	const fillingIdSet = new Set(
		fillingRows
			.map((row) => normalizeString(row && row._id))
			.filter(Boolean)
	)

	const movementRes = await fetchFillMovementsForOrphanCleanup(scanLimit)
	if (!movementRes.ok) return { code: 400, msg: movementRes.msg || '清洗扫描失败' }
	const fillMovementRows = Array.isArray(movementRes.data) ? movementRes.data : []

	const legacyByKey = new Map()
	for (let i = 0; i < fillMovementRows.length; i += 1) {
		const row = fillMovementRows[i]
		if (normalizeString(row && row.source_type) !== 'legacy_import') continue
		const key = buildFillMovementLegacyKey(row)
		if (!legacyByKey.has(key)) legacyByKey.set(key, [])
		legacyByKey.get(key).push(row)
	}

	const orphanCandidates = []
	const orphanWithoutLegacy = []
	for (let i = 0; i < fillMovementRows.length; i += 1) {
		const row = fillMovementRows[i]
		if (normalizeString(row && row.source_type) !== 'filling') continue
		const sourceId = normalizeString(row && row.source_id)
		if (sourceId && fillingIdSet.has(sourceId)) continue

		const key = buildFillMovementLegacyKey(row)
		const legacyMatches = legacyByKey.get(key) || []
		const item = {
			movement_id: normalizeString(row && row._id),
			date: normalizeString(row && row.date),
			event_day: normalizeMovementEventDay(row),
			bottle_no: normalizeBottleNo(row && row.bottle_no),
			net_weight: toNumber(row && row.net_weight, null),
			source_type: normalizeString(row && row.source_type),
			source_id: sourceId,
			legacy_match_count: legacyMatches.length,
			legacy_match_samples: legacyMatches.slice(0, 2).map((legacyRow) => ({
				movement_id: normalizeString(legacyRow && legacyRow._id),
				source_type: normalizeString(legacyRow && legacyRow.source_type),
				source_id: normalizeString(legacyRow && legacyRow.source_id),
				date: normalizeString(legacyRow && legacyRow.date),
				net_weight: toNumber(legacyRow && legacyRow.net_weight, null)
			}))
		}
		if (legacyMatches.length > 0) orphanCandidates.push(item)
		else orphanWithoutLegacy.push(item)
	}

	const movementIds = orphanCandidates
		.map((row) => normalizeString(row && row.movement_id))
		.filter(Boolean)
	const touchedBottleNos = normalizeUniqueBottleNos(orphanCandidates.map((row) => row && row.bottle_no))
	const baseData = {
		preview,
		run_id: runId,
		scan_limit: scanLimit,
		fillings_total: fillingRows.length,
		fill_movements_total: fillMovementRows.length,
		orphan_total: orphanCandidates.length + orphanWithoutLegacy.length,
		orphan_with_legacy_pair_total: orphanCandidates.length,
		orphan_without_legacy_pair_total: orphanWithoutLegacy.length,
		touched_bottle_total: touchedBottleNos.length,
		skip_backup_requested: skipBackup,
		backup_collection_primary: ORPHAN_CLEANUP_BACKUP_COLLECTION,
		backup_collection_fallback: CLEANUP_BACKUP_COLLECTION,
		can_execute: movementIds.length > 0,
		candidate_sample_items: buildOrphanCleanupSampleItems(orphanCandidates, CLEANUP_SAMPLE_LIMIT),
		skipped_sample_items: buildOrphanCleanupSampleItems(orphanWithoutLegacy, CLEANUP_SAMPLE_LIMIT)
	}

	if (preview) {
		return {
			code: 0,
			msg: 'ok',
			data: baseData
		}
	}

	let backupCollection = '(skipped)'
	if (!skipBackup) {
		backupCollection = ORPHAN_CLEANUP_BACKUP_COLLECTION
		let backups = db.collection(backupCollection)
		for (let i = 0; i < orphanCandidates.length; i += 1) {
			const item = orphanCandidates[i]
			try {
				const movementDoc = fillMovementRows.find((row) => normalizeString(row && row._id) === normalizeString(item && item.movement_id)) || null
				const backupDoc = {
					run_id: runId,
					request_id: requestId,
					source_collection: 'crm_bottle_movements',
					source_id: normalizeString(item && item.movement_id),
					bottle_no: normalizeBottleNo(item && item.bottle_no),
					event_day: normalizeString(item && item.event_day),
					source_type: normalizeString(item && item.source_type),
					source_filling_id: normalizeString(item && item.source_id),
					legacy_match_count: Number(item && item.legacy_match_count ? item.legacy_match_count : 0),
					legacy_match_samples: Array.isArray(item && item.legacy_match_samples) ? item.legacy_match_samples : [],
					backup_doc: movementDoc,
					backed_up_at: Date.now(),
					backed_up_by: user?._id || null,
					backed_up_by_name: user?.username || ''
				}
				try {
					await backups.add(backupDoc)
				} catch (addErr) {
					if (isMissingCollectionError(addErr) && backupCollection !== CLEANUP_BACKUP_COLLECTION) {
						backupCollection = CLEANUP_BACKUP_COLLECTION
						backups = db.collection(backupCollection)
						await backups.add(backupDoc)
					} else {
						throw addErr
					}
				}
			} catch (err) {
				return {
					code: 500,
					msg: `备份失败，已停止执行：${normalizeString(err && err.message) || '未知错误'}`,
					data: {
						...baseData,
						backup_collection_used: backupCollection,
						failed_backup_movement_id: normalizeString(item && item.movement_id)
					}
				}
			}
		}
	}

	let removed = 0
	const chunkSize = 150
	for (let i = 0; i < movementIds.length; i += chunkSize) {
		const chunk = movementIds.slice(i, i + chunkSize)
		if (!chunk.length) continue
		await movements.where({ _id: dbCmd.in(chunk) }).remove()
		removed += chunk.length
	}

	const touchRes = await triggerAnomalyTouchV2InChunks(user, token, touchedBottleNos, requestId)
	await recordLog(
		user,
		'filling_cleanup_orphan_fill_movements_v1',
		{
			run_id: runId,
			fillings_total: fillingRows.length,
			fill_movements_total: fillMovementRows.length,
			orphan_with_legacy_pair_total: orphanCandidates.length,
			orphan_without_legacy_pair_total: orphanWithoutLegacy.length,
			removed,
			touched_bottle_total: touchedBottleNos.length,
			touch_warning: touchRes.warning || '',
			skip_backup: skipBackup
		},
		requestId
	)

	return {
		code: 0,
		msg: touchRes.warning ? `清洗完成（${touchRes.warning}）` : '清洗完成',
		data: {
			...baseData,
			preview: false,
			removed,
			backed_up: skipBackup ? 0 : orphanCandidates.length,
			backup_collection_used: backupCollection,
			touch_warning: touchRes.warning || ''
		}
	}
}

async function cleanupNoSaleMovementsV1(user, data, requestId, token) {
	if (!CLEANUP_ALLOWED_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅管理员可操作' }
	}
	const preview = data && data.preview !== false
	const runId = normalizeString(data && (data.run_id || data.runId)) || `cleanup_no_sale_${Date.now()}`
	const scanLimitRaw = toNumber(data && (data.scan_limit || data.scanLimit), CLEANUP_SCAN_LIMIT)
	const scanLimit = Math.min(
		CLEANUP_SCAN_LIMIT,
		Math.max(Number.isFinite(scanLimitRaw) ? Math.floor(scanLimitRaw) : CLEANUP_SCAN_LIMIT, 1)
	)

	const noSaleWhere = { record_type: 'truck_out_no_sale' }
	const noSaleRowsRes = await fetchFillingsByWhere(noSaleWhere, scanLimit)
	if (!noSaleRowsRes.ok) return { code: 400, msg: noSaleRowsRes.msg || '清洗扫描失败' }
	const noSaleRows = Array.isArray(noSaleRowsRes.data) ? noSaleRowsRes.data : []
	const sourceIds = noSaleRows.map((row) => normalizeString(row && row._id)).filter(Boolean)
	const fillingMap = new Map()
	for (let i = 0; i < noSaleRows.length; i += 1) {
		const row = noSaleRows[i]
		const id = normalizeString(row && row._id)
		if (!id) continue
		fillingMap.set(id, row)
	}

	const movementRowsRes = await fetchFillMovementsBySourceIds(sourceIds, scanLimit)
	if (!movementRowsRes.ok) return { code: 400, msg: movementRowsRes.msg || '清洗扫描失败' }
	const candidateMovements = Array.isArray(movementRowsRes.data)
		? movementRowsRes.data.filter((row) => fillingMap.has(normalizeString(row && row.source_id)))
		: []
	const movementIds = candidateMovements
		.map((row) => normalizeString(row && row._id))
		.filter(Boolean)
	const touchedBottleNos = normalizeUniqueBottleNos(
		candidateMovements
			.map((row) => normalizeBottleNo(row && row.bottle_no) || normalizeBottleNo((fillingMap.get(normalizeString(row && row.source_id)) || {}).bottle_no))
			.filter(Boolean)
	)
	const sampleItems = buildCleanupSampleItems(candidateMovements, fillingMap)
	const baseData = {
		preview,
		run_id: runId,
		scan_limit: scanLimit,
		filling_total: noSaleRows.length,
		movement_total: candidateMovements.length,
		skipped_without_movement: Math.max(noSaleRows.length - candidateMovements.length, 0),
		touched_bottle_total: touchedBottleNos.length,
		sample_items: sampleItems,
		backup_collection: CLEANUP_BACKUP_COLLECTION
	}

	if (preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				...baseData,
				can_execute: candidateMovements.length > 0
			}
		}
	}

	const backups = db.collection(CLEANUP_BACKUP_COLLECTION)
	for (let i = 0; i < candidateMovements.length; i += 1) {
		const movementDoc = candidateMovements[i]
		const sourceId = normalizeString(movementDoc && movementDoc.source_id)
		const fillingDoc = fillingMap.get(sourceId) || null
		try {
			await backups.add({
				run_id: runId,
				request_id: requestId,
				source_collection: 'crm_bottle_movements',
				source_id: normalizeString(movementDoc && movementDoc._id),
				source_filling_id: sourceId,
				record_type: 'truck_out_no_sale',
				bottle_no:
					normalizeBottleNo(movementDoc && movementDoc.bottle_no) || normalizeBottleNo(fillingDoc && fillingDoc.bottle_no),
				backup_doc: movementDoc,
				filling_doc: fillingDoc,
				backed_up_at: Date.now(),
				backed_up_by: user?._id || null,
				backed_up_by_name: user?.username || ''
			})
		} catch (err) {
			return {
				code: 500,
				msg: `备份失败，已停止执行：${normalizeString(err && err.message) || '未知错误'}`,
				data: {
					...baseData,
					failed_backup_movement_id: normalizeString(movementDoc && movementDoc._id)
				}
			}
		}
	}

	const chunkSize = 150
	let removed = 0
	for (let i = 0; i < movementIds.length; i += chunkSize) {
		const chunk = movementIds.slice(i, i + chunkSize)
		if (!chunk.length) continue
		await movements.where({ _id: dbCmd.in(chunk) }).remove()
		removed += chunk.length
	}

	const touchRes = await triggerAnomalyTouchV2InChunks(user, token, touchedBottleNos, requestId)
	await recordLog(
		user,
		'filling_cleanup_no_sale_movements_v1',
		{
			run_id: runId,
			filling_total: noSaleRows.length,
			movement_total: candidateMovements.length,
			removed,
			touched_bottle_total: touchedBottleNos.length,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `清洗完成（${touchRes.warning}）` : '清洗完成',
		data: {
			...baseData,
			preview: false,
			removed,
			backed_up: candidateMovements.length,
			touch_warning: touchRes.warning || ''
		}
	}
}

async function createV1(user, data, requestId, token) {
	const date = normalizeFillingDate(data.date)
	if (!date) return { code: 400, msg: '日期必填' }
	const recordType = normalizeRecordType(data.record_type || data.recordType, DEFAULT_RECORD_TYPE)
	if (!recordType) return { code: 400, msg: '作业类型无效' }
	const requestedInputMode = normalizeInputMode(data.input_mode || data.inputMode, 'net')
	if (!requestedInputMode) return { code: 400, msg: '录入模式无效' }
	const inputMode = resolveInputModeByRecordType(recordType, requestedInputMode, 'net')
	if (!inputMode) return { code: 400, msg: '录入模式无效' }
	const ignoreBottleFlowWarning = toBoolean(data.ignore_bottle_flow_warning ?? data.ignoreBottleFlowWarning, false)
	const inventoryLinked = isInventoryLinkedRecordType(recordType)
	const bottleNo = normalizeBottleNo(data.bottle_no)
	if (inventoryLinked && !bottleNo) return { code: 400, msg: buildBottleRequiredMessage(recordType) }
	if (inputMode === 'after_fill_total' && !bottleNo) {
		return { code: 400, msg: buildDerivedIdentifierRequiredMessage(recordType) }
	}
	if (inventoryLinked && bottleNo) {
		const archiveState = await getBottleArchiveStateByBottleNo(bottleNo)
		const archiveError = getBottleArchiveErrorMessage(archiveState)
		if (archiveError) return { code: 400, msg: archiveError }
	}
	const operatorName = normalizeOperatorName(data.operator, user?.username)
	const operatorId = normalizeIdString(data.operator_id || data.operatorId || user?._id) || null
	let fillWeight = toNumber(data.fill_weight, null)
	const weightStart = toNumber(data.weight_start ?? data.weightStart, null)
	const targetNetWeight = toNumber(data.target_net_weight ?? data.targetNetWeight, null)
	const targetGrossWeight = toNumber(data.target_gross_weight ?? data.targetGrossWeight, null)
	const weightEnd = toNumber(data.weight_end ?? data.weightEnd, null)
	const actualNetWeight = toNumber(data.actual_net_weight ?? data.actualNetWeight, null)
	const deviation = toNumber(data.deviation, null)
	const scaleSource = normalizeString(data.scale_source ?? data.scaleSource) || ''
	const scaleReadMode = normalizeString(data.scale_read_mode ?? data.scaleReadMode) || ''
	const startedAt = toTimestamp(data.started_at ?? data.startedAt, 0) || null
	const endedAt = toTimestamp(data.ended_at ?? data.endedAt, 0) || null
	const status = normalizeFillingStatus(data.status, 'completed')
	const alarmState = toBoolean(data.alarm_state ?? data.alarmState, false)
	const rawScalePayload = normalizeRawScalePayload(data.raw_scale_payload ?? data.rawScalePayload)
	if (actualNetWeight > 0) fillWeight = actualNetWeight
	if (recordType === 'truck_out_no_sale' && requestedInputMode === 'after_fill_total') {
		if (!(typeof fillWeight === 'number' && Number.isFinite(fillWeight) && fillWeight > 0)) {
			fillWeight = toNumber(data.after_fill_total_weight ?? data.afterFillTotalWeight, null)
		}
	}
	let derivedResult = null
	if (inputMode === 'after_fill_total') {
		const resolved = await resolveDerivedFillWeight({
			date,
			record_type: recordType,
			bottle_no: bottleNo,
			after_fill_total_weight: data.after_fill_total_weight ?? data.afterFillTotalWeight
		})
		if (!resolved.ok) return { code: 400, msg: resolved.msg || '推导失败' }
		derivedResult = resolved.data
		fillWeight = toNumber(derivedResult.derived_fill_weight, null)
	}
	if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
		return { code: 400, msg: inputMode === 'after_fill_total' ? '推导净重无效' : '灌装重量必填且大于 0' }
	}
	if (inventoryLinked && bottleNo) {
		const hasDuplicate = await hasDuplicateFillingByDateBottle(date, bottleNo)
		if (hasDuplicate) {
			return { code: 409, msg: '同日期同瓶号记录已存在，请勿重复录入' }
		}
	}
	const bottleFlowWarnings = inventoryLinked && bottleNo
		? await collectFillingBottleFlowWarnings({
			date,
			bottleNos: [bottleNo]
		})
		: []
	if (!ignoreBottleFlowWarning && bottleFlowWarnings.length > 0) {
		return buildFillingBottleFlowWarningResponse(bottleFlowWarnings)
	}
	const remark = inputMode === 'after_fill_total'
		? buildDerivedFillRemark(normalizeString(data.remark), derivedResult || {})
		: normalizeString(data.remark)

	const doc = {
		date,
		bottle_no: bottleNo,
		record_type: recordType,
		operator: operatorName,
		operator_id: operatorId,
		fill_weight: fillWeight,
		weight_start: weightStart,
		target_net_weight: targetNetWeight,
		target_gross_weight: targetGrossWeight,
		weight_end: weightEnd,
		actual_net_weight: actualNetWeight || fillWeight,
		deviation,
		scale_source: scaleSource,
		scale_read_mode: scaleReadMode,
		started_at: startedAt,
		ended_at: endedAt,
		status,
		alarm_state: alarmState,
		raw_scale_payload: rawScalePayload,
		remark,
		created_at: Date.now(),
		updated_at: Date.now(),
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}
	const movementEventDay = normalizeEventDay(date, doc.created_at)
	const movementEventAt = parseEventAt(date, doc.created_at)

	const res = await fillings.add(doc)
	await recordLog(
		user,
		'filling_create_v1',
		{
			id: res.id,
			bottle_no: bottleNo,
			record_type: recordType,
			operator: operatorName,
			input_mode: inputMode,
			requested_input_mode: requestedInputMode,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length,
			bottle_flow_warning_bottle_nos: bottleFlowWarnings.map((item) => normalizeBottleNo(item && item.bottle_no)).filter(Boolean)
		},
		requestId
	)

	if (inventoryLinked && bottleNo) {
		await movements.add({
			bottle_no: bottleNo,
			type: 'fill',
			date,
			event_day: movementEventDay,
			event_at: movementEventAt,
			type_order: 20,
			source_type: normalizeString(data.source_type) || 'filling',
			source_id: res.id,
			customer_id: null,
			customer_name: '',
			net_weight: fillWeight,
			loss_weight: null,
			note: normalizeString(data.note || remark),
			created_at: Date.now(),
			created_by: user?._id || null,
			created_by_name: user?.username || ''
		})
	}
	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(inventoryLinked && bottleNo ? [bottleNo] : [])
	await replaceGasInventoryMovementForFilling({
		sourceId: res.id,
		date,
		bottleNo,
		recordType,
		fillWeight,
		remark: normalizeString(data.note || remark),
		now: Date.now(),
		user
	})

	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: inventoryLinked && bottleNo ? [bottleNo] : [],
			truckNos: shouldTouchTruckAnomalyForFilling(recordType, bottleNo) ? [bottleNo] : []
		},
		requestId
	)
	const warningText = touchRes.warning || ''
	return {
		code: 0,
		msg: warningText ? `创建成功（${warningText}）` : '创建成功',
		data: {
			_id: res.id,
			warning: warningText,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length
		}
	}
}

async function updateV1(user, data, requestId, token) {
	const id = normalizeString(data._id || data.id || data.recordId)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const ignoreBottleFlowWarning = toBoolean(data.ignore_bottle_flow_warning ?? data.ignoreBottleFlowWarning, false)
	const oldRes = await fillings.doc(id).get()
	const oldDoc = (oldRes.data && oldRes.data[0]) || null
	if (!oldDoc) return { code: 404, msg: '记录不存在' }

	const date = normalizeFillingDate(data.date != null ? data.date : oldDoc.date, oldDoc.created_at)
	if (!date) return { code: 400, msg: '日期必填' }
	const recordType = normalizeRecordType(
		data.record_type != null ? data.record_type : oldDoc.record_type,
		DEFAULT_RECORD_TYPE
	)
	if (!recordType) return { code: 400, msg: '作业类型无效' }
	const inventoryLinked = isInventoryLinkedRecordType(recordType)
	const oldRecordType = normalizeRecordType(oldDoc.record_type, DEFAULT_RECORD_TYPE)
	const oldInventoryLinked = isInventoryLinkedRecordType(oldRecordType)
	const bottleNo = normalizeBottleNo(data.bottle_no != null ? data.bottle_no : oldDoc.bottle_no)
	if (inventoryLinked && !bottleNo) return { code: 400, msg: buildBottleRequiredMessage(recordType) }
	const oldBottleNo = normalizeBottleNo(oldDoc.bottle_no)
	if (inventoryLinked && bottleNo && (bottleNo !== oldBottleNo || !oldInventoryLinked)) {
		const archiveState = await getBottleArchiveStateByBottleNo(bottleNo)
		const archiveError = getBottleArchiveErrorMessage(archiveState)
		if (archiveError) return { code: 400, msg: archiveError }
	}
	const operatorName = normalizeOperatorName(
		data.operator != null ? data.operator : oldDoc.operator,
		oldDoc.created_by_name || user?.username
	)
	const operatorId = normalizeIdString(
		data.operator_id != null ? data.operator_id : (oldDoc.operator_id || oldDoc.created_by || user?._id)
	) || null
	const fillWeight = toNumber(data.fill_weight != null ? data.fill_weight : oldDoc.fill_weight, null)
	if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
		return { code: 400, msg: '灌装重量必填且大于 0' }
	}
	if (inventoryLinked && bottleNo) {
		const hasDuplicate = await hasDuplicateFillingByDateBottle(date, bottleNo, id)
		if (hasDuplicate) {
			return { code: 409, msg: '同日期同瓶号记录已存在，请修改日期或瓶号' }
		}
	}
	const bottleFlowWarnings = inventoryLinked && bottleNo
		? await collectFillingBottleFlowWarnings({
			date,
			bottleNos: [bottleNo],
			excludeFillingId: id
		})
		: []
	if (!ignoreBottleFlowWarning && bottleFlowWarnings.length > 0) {
		return buildFillingBottleFlowWarningResponse(bottleFlowWarnings)
	}

	const now = Date.now()
	const updateDoc = {
		date,
		bottle_no: bottleNo,
		record_type: recordType,
		operator: operatorName,
		operator_id: operatorId,
		fill_weight: fillWeight,
		remark: normalizeString(data.remark != null ? data.remark : oldDoc.remark),
		updated_at: now
	}
	await fillings.doc(id).update(updateDoc)

	const movementEventDay = normalizeEventDay(date, now)
	const movementEventAt = parseEventAt(date, now)
	await movements.where({ source_id: id, type: 'fill' }).remove()
	if (inventoryLinked && bottleNo) {
		await movements.add({
			bottle_no: bottleNo,
			type: 'fill',
			date,
			event_day: movementEventDay,
			event_at: movementEventAt,
			type_order: 20,
			source_type: 'filling',
			source_id: id,
			customer_id: null,
			customer_name: '',
			net_weight: fillWeight,
			loss_weight: null,
			note: normalizeString(data.note || updateDoc.remark),
			created_at: now,
			created_by: user?._id || null,
			created_by_name: user?.username || ''
		})
	}
	await replaceGasInventoryMovementForFilling({
		sourceId: id,
		date,
		bottleNo,
		recordType,
		fillWeight,
		remark: normalizeString(data.note || updateDoc.remark),
		now,
		user
	})

	const touchBottleNos = []
	if (oldInventoryLinked && oldBottleNo) touchBottleNos.push(oldBottleNo)
	if (inventoryLinked && bottleNo) touchBottleNos.push(bottleNo)
	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(touchBottleNos)
	const touchTruckNos = []
	if (shouldTouchTruckAnomalyForFilling(oldRecordType, oldBottleNo)) touchTruckNos.push(oldBottleNo)
	if (shouldTouchTruckAnomalyForFilling(recordType, bottleNo)) touchTruckNos.push(bottleNo)
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: touchBottleNos,
			truckNos: touchTruckNos
		},
		requestId
	)
	await recordLog(
		user,
		'filling_update_v1',
		{
			id,
			bottle_no: bottleNo,
			record_type: recordType,
			operator: operatorName,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			touch_warning: touchRes.warning || '',
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length,
			bottle_flow_warning_bottle_nos: bottleFlowWarnings.map((item) => normalizeBottleNo(item && item.bottle_no)).filter(Boolean)
		},
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `更新成功（${touchRes.warning}）` : '更新成功',
		data: {
			warning: touchRes.warning || '',
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length
		}
	}
}

async function removeV1(user, data, requestId, token) {
	const id = normalizeString(data._id || data.id || data.recordId)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const oldRes = await fillings.doc(id).get()
	const oldDoc = (oldRes.data && oldRes.data[0]) || null
	if (!oldDoc) return { code: 404, msg: '记录不存在' }
	const oldBottleNo = normalizeBottleNo(oldDoc.bottle_no)
	const oldRecordType = normalizeRecordType(oldDoc.record_type, DEFAULT_RECORD_TYPE)

	await removeGasInventoryMovementForFilling(id)
	await movements.where({ source_id: id, type: 'fill' }).remove()
	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(
		isInventoryLinkedRecordType(oldRecordType) && oldBottleNo ? [oldBottleNo] : []
	)
	await fillings.doc(id).remove()
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: isInventoryLinkedRecordType(oldRecordType) && oldBottleNo ? [oldBottleNo] : [],
			truckNos: shouldTouchTruckAnomalyForFilling(oldRecordType, oldBottleNo) ? [oldBottleNo] : []
		},
		requestId
	)
	await recordLog(
		user,
		'filling_remove_v1',
		{
			id,
			bottle_no: oldBottleNo,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `删除成功（${touchRes.warning}）` : '删除成功',
		data: {
			warning: touchRes.warning || '',
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total
		}
	}
}

function parseBatchCreateRows(batchText, defaultWeight, inputMode = 'net') {
	const lines = String(batchText || '').split(/\r?\n/)
	const seenBottleNos = new Set()
	const validRows = []
	const invalidItems = []
	let nonEmptyTotal = 0
	let duplicateTotal = 0

	for (let i = 0; i < lines.length; i += 1) {
		const raw = normalizeString(lines[i])
		if (!raw) continue
		nonEmptyTotal += 1
		const tokens = raw
			.split(/[\s,，;；]+/)
			.map((item) => normalizeString(item))
			.filter(Boolean)
		const bottleNo = normalizeBottleNo(tokens[0])
		if (!bottleNo) {
			invalidItems.push({ line_no: i + 1, bottle_no: '', error: '瓶号为空' })
			continue
		}
		let fillWeight = defaultWeight
		let afterFillTotalWeight = null
		if (inputMode === 'after_fill_total') {
			if (!tokens[1]) {
				invalidItems.push({
					line_no: i + 1,
					bottle_no: bottleNo,
					error: '灌后总重必填'
				})
				continue
			}
			afterFillTotalWeight = toNumber(tokens[1], null)
			if (!(typeof afterFillTotalWeight === 'number' && afterFillTotalWeight > 0)) {
				invalidItems.push({
					line_no: i + 1,
					bottle_no: bottleNo,
					error: '灌后总重无效（需大于 0）'
				})
				continue
			}
		} else {
			if (tokens[1]) {
				fillWeight = toNumber(tokens[1], null)
			}
			if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
				invalidItems.push({
					line_no: i + 1,
					bottle_no: bottleNo,
					error: '灌装净重无效（需大于 0）'
				})
				continue
			}
		}
		if (seenBottleNos.has(bottleNo)) {
			duplicateTotal += 1
			invalidItems.push({
				line_no: i + 1,
				bottle_no: bottleNo,
				error: '批量内容内瓶号重复'
			})
			continue
		}
		seenBottleNos.add(bottleNo)
		const row = {
			line_no: i + 1,
			bottle_no: bottleNo
		}
		if (inputMode === 'after_fill_total') row.after_fill_total_weight = afterFillTotalWeight
		else row.fill_weight = fillWeight
		validRows.push(row)
	}

	return {
		non_empty_total: nonEmptyTotal,
		valid_rows: validRows,
		invalid_items: invalidItems,
		duplicate_total: duplicateTotal
	}
}

async function findExistingBottleNosByDate(date, bottleNos = []) {
	const normalized = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalized.length) return new Set()
	const existed = new Set()
	const chunkSize = 200
	for (let i = 0; i < normalized.length; i += chunkSize) {
		const chunk = normalized.slice(i, i + chunkSize)
		const res = await fillings
			.where({ date, bottle_no: dbCmd.in(chunk) })
			.field({ bottle_no: true })
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let j = 0; j < rows.length; j += 1) {
			const bottleNo = normalizeBottleNo(rows[j] && rows[j].bottle_no)
			if (bottleNo) existed.add(bottleNo)
		}
	}
	return existed
}

function parseBatchCreatePayload(data = {}) {
	const preview = Boolean(data.preview)
	const date = normalizeFillingDate(data.date)
	const batchText = normalizeString(data.batch_text || data.batchText)
	const remark = normalizeString(data.remark)
	const recordType = normalizeRecordType(data.record_type || data.recordType, DEFAULT_RECORD_TYPE)
	const requestedInputMode = normalizeInputMode(data.input_mode || data.inputMode, 'net')
	const inputMode = resolveInputModeByRecordType(recordType, requestedInputMode, 'net')
	const defaultWeightRaw = normalizeString(data.default_fill_weight || data.defaultFillWeight)
	if (!isValidDateString(date)) return { ok: false, msg: '灌装日期格式无效' }
	if (normalizeString(data.record_type || data.recordType) && !recordType) {
		return { ok: false, msg: '作业类型无效' }
	}
	if (!inputMode) return { ok: false, msg: '录入模式无效' }
	if (!batchText) return { ok: false, msg: '批量内容为空' }
	let defaultWeight = null
	if (inputMode === 'net' && defaultWeightRaw) {
		defaultWeight = toNumber(defaultWeightRaw, null)
		if (!(typeof defaultWeight === 'number' && defaultWeight > 0)) {
			return { ok: false, msg: '默认净重无效（需大于 0）' }
		}
	}
	const parsedRows = parseBatchCreateRows(batchText, defaultWeight, inputMode)
	if (parsedRows.valid_rows.length > BATCH_UPDATE_LIMIT) {
		return { ok: false, msg: `单次最多新增 ${BATCH_UPDATE_LIMIT} 条，请拆批执行` }
	}
	return {
		ok: true,
		data: {
			preview,
			date,
			record_type: recordType,
			input_mode: inputMode,
			requested_input_mode: requestedInputMode,
			remark,
			default_fill_weight: defaultWeight,
			parsed_rows: parsedRows
		}
	}
}

async function batchCreateV1(user, data, requestId, token) {
	const parsed = parseBatchCreatePayload(data)
	if (!parsed.ok) return { code: 400, msg: parsed.msg }
	const payload = parsed.data
	const ignoreBottleFlowWarning = toBoolean(data.ignore_bottle_flow_warning ?? data.ignoreBottleFlowWarning, false)
	const inventoryLinked = isInventoryLinkedRecordType(payload.record_type)
	const operatorName = normalizeOperatorName(data.operator, user?.username)
	const operatorId = normalizeIdString(data.operator_id || data.operatorId || user?._id) || null
	const parsedRows = payload.parsed_rows
	const validRows = parsedRows.valid_rows

	const existedBottleNoSet = inventoryLinked
		? await findExistingBottleNosByDate(
			payload.date,
			validRows.map((row) => row.bottle_no)
		)
		: new Set()
	const bottleArchiveMap = inventoryLinked
		? await getBottleArchiveMapByBottleNos(validRows.map((row) => row.bottle_no))
		: new Map()
	const toCreateRows = []
	const existingItems = []
	const invalidItems = [...parsedRows.invalid_items]
	for (let i = 0; i < validRows.length; i += 1) {
		const row = validRows[i]
		if (inventoryLinked) {
			const archiveState = bottleArchiveMap.get(row.bottle_no)
			const archiveError = getBottleArchiveErrorMessage(archiveState)
			if (archiveError) {
				invalidItems.push({
					line_no: row.line_no,
					bottle_no: row.bottle_no,
					error: archiveError
				})
				continue
			}
			if (existedBottleNoSet.has(row.bottle_no)) {
				existingItems.push({
					line_no: row.line_no,
					bottle_no: row.bottle_no,
					error: '同日期同瓶号记录已存在'
				})
				continue
			}
		}
		if (payload.input_mode === 'after_fill_total') {
			const resolved = await resolveDerivedFillWeight({
				date: payload.date,
				record_type: payload.record_type,
				bottle_no: row.bottle_no,
				after_fill_total_weight: row.after_fill_total_weight
			})
			if (!resolved.ok) {
				invalidItems.push({
					line_no: row.line_no,
					bottle_no: row.bottle_no,
					error: resolved.msg || '推导失败'
				})
				continue
			}
			toCreateRows.push({
				...row,
				fill_weight: resolved.data.derived_fill_weight,
				basis_value: resolved.data.basis_value,
				basis_source: resolved.data.basis_source,
				basis_ref: resolved.data.basis_ref,
				basis_date: resolved.data.basis_date
			})
			continue
		}
		toCreateRows.push(row)
	}

	const bottleFlowWarnings = inventoryLinked
		? await collectFillingBottleFlowWarnings({
			date: payload.date,
			bottleNos: toCreateRows.map((row) => row.bottle_no)
		})
		: []
	const bottleFlowWarningMap = new Map()
	for (let i = 0; i < bottleFlowWarnings.length; i += 1) {
		const item = bottleFlowWarnings[i]
		const bottleNo = normalizeBottleNo(item && item.bottle_no)
		if (!bottleNo || bottleFlowWarningMap.has(bottleNo)) continue
		bottleFlowWarningMap.set(bottleNo, item)
	}

	if (payload.preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				date: payload.date,
				target_total: toCreateRows.length,
				invalid_total: invalidItems.length,
				duplicate_total: parsedRows.duplicate_total,
				existing_total: existingItems.length,
				warning_total: bottleFlowWarnings.length,
				summary_text: buildFillingBottleFlowWarningSummaryText(bottleFlowWarnings),
				sample_bottle_nos: toSampleBottleNos(toCreateRows),
				create_items: toCreateRows.slice(0, BATCH_PREVIEW_DETAIL_LIMIT).map((row) => ({
					line_no: row.line_no,
					bottle_no: row.bottle_no,
					fill_weight: row.fill_weight,
					after_fill_total_weight: row.after_fill_total_weight,
					basis_value: row.basis_value,
					basis_source: row.basis_source,
					basis_ref: row.basis_ref,
					basis_date: row.basis_date,
					warning_reason: bottleFlowWarningMap.get(row.bottle_no)?.reason || '',
					warning_status_code: bottleFlowWarningMap.get(row.bottle_no)?.status_code || '',
					warning_last_out_date: bottleFlowWarningMap.get(row.bottle_no)?.last_out_date || '',
					warning_last_out_customer_name: bottleFlowWarningMap.get(row.bottle_no)?.last_out_customer_name || ''
				})),
				warning_items: bottleFlowWarnings.slice(0, BATCH_PREVIEW_DETAIL_LIMIT),
				existing_items: existingItems.slice(0, BATCH_PREVIEW_DETAIL_LIMIT),
				invalid_items: invalidItems.slice(0, BATCH_PREVIEW_DETAIL_LIMIT),
				limit: BATCH_UPDATE_LIMIT
			}
		}
	}

	if (!ignoreBottleFlowWarning && bottleFlowWarnings.length > 0) {
		return buildFillingBottleFlowWarningResponse(bottleFlowWarnings)
	}

	const failedItems = []
	const touchedBottleNos = []
	const touchedTruckNos = []
	let success = 0
	for (let i = 0; i < invalidItems.length; i += 1) {
		const row = invalidItems[i]
		failedItems.push({
			line_no: row.line_no,
			bottle_no: normalizeBottleNo(row.bottle_no),
			error: normalizeString(row.error) || '无效数据'
		})
	}
	for (let i = 0; i < existingItems.length; i += 1) {
		const row = existingItems[i]
		failedItems.push({
			line_no: row.line_no,
			bottle_no: normalizeBottleNo(row.bottle_no),
			error: normalizeString(row.error) || '同日期同瓶号记录已存在'
		})
	}

	for (let i = 0; i < toCreateRows.length; i += 1) {
		const row = toCreateRows[i]
		try {
			const now = Date.now()
			const remark = payload.input_mode === 'after_fill_total'
				? buildDerivedFillRemark(payload.remark, {
					after_fill_total_weight: row.after_fill_total_weight,
					basis_value: row.basis_value,
					basis_source: row.basis_source,
					basis_ref: row.basis_ref,
					basis_date: row.basis_date,
					derived_fill_weight: row.fill_weight
				})
				: payload.remark
			const doc = {
				date: payload.date,
				bottle_no: row.bottle_no,
				record_type: payload.record_type,
				operator: operatorName,
				operator_id: operatorId,
				fill_weight: row.fill_weight,
				remark,
				created_at: now,
				updated_at: now,
				created_by: user?._id || null,
				created_by_name: user?.username || ''
			}
			const addRes = await fillings.add(doc)
			if (inventoryLinked && row.bottle_no) {
				await movements.add({
					bottle_no: row.bottle_no,
					type: 'fill',
					date: payload.date,
					event_day: normalizeEventDay(payload.date, now),
					event_at: parseEventAt(payload.date, now),
					type_order: 20,
					source_type: 'filling',
					source_id: addRes.id,
					customer_id: null,
					customer_name: '',
					net_weight: row.fill_weight,
					loss_weight: null,
					note: remark,
					created_at: now,
					created_by: user?._id || null,
					created_by_name: user?.username || ''
				})
			}
			await replaceGasInventoryMovementForFilling({
				sourceId: addRes.id,
				date: payload.date,
				bottleNo: row.bottle_no,
				recordType: payload.record_type,
				fillWeight: row.fill_weight,
				remark,
				now,
				user
			})
			success += 1
			if (inventoryLinked && row.bottle_no) touchedBottleNos.push(row.bottle_no)
			if (shouldTouchTruckAnomalyForFilling(payload.record_type, row.bottle_no)) touchedTruckNos.push(row.bottle_no)
		} catch (err) {
			failedItems.push({
				line_no: row.line_no,
				bottle_no: row.bottle_no,
					error: normalizeString(err && err.message) || '新增失败'
			})
		}
	}

	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(touchedBottleNos)
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: touchedBottleNos,
			truckNos: touchedTruckNos
		},
		requestId
	)
	await recordLog(
		user,
		'filling_batch_create_v1',
		{
			date: payload.date,
			record_type: payload.record_type,
			input_mode: payload.input_mode,
			requested_input_mode: payload.requested_input_mode,
			operator: operatorName,
			total: parsedRows.non_empty_total,
			target_total: toCreateRows.length,
			existing_total: existingItems.length,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length,
			bottle_flow_warning_bottle_nos: bottleFlowWarnings.map((item) => normalizeBottleNo(item && item.bottle_no)).filter(Boolean),
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			success,
			failed: failedItems.length,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)

	return {
		code: 0,
		msg: touchRes.warning ? `批量新增完成（${touchRes.warning}）` : '批量新增完成',
		data: {
			date: payload.date,
			total: parsedRows.non_empty_total,
			success,
			failed: failedItems.length,
			failed_items: failedItems.slice(0, 200),
			warning: touchRes.warning || '',
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length
		}
	}
}

function parseBatchUpdateDatePayload(data = {}) {
	const preview = Boolean(data.preview)
	const scopeMode = normalizeString(data.scope_mode || data.scopeMode).toLowerCase()
	const newDate = normalizeFillingDate(data.new_date || data.newDate)
	if (!['ids', 'filter'].includes(scopeMode)) {
		return { ok: false, msg: '批量范围无效' }
	}
	if (!isValidDateString(newDate)) {
		return { ok: false, msg: '新灌装日期格式无效' }
	}

	const selector = data.selector && typeof data.selector === 'object' ? data.selector : {}
	if (scopeMode === 'ids') {
		const ids = normalizeUniqueIds(selector.ids)
		if (!ids.length) return { ok: false, msg: '勾选子集为空，请先勾选记录' }
		if (ids.length > BATCH_UPDATE_LIMIT) {
			return { ok: false, msg: `单次最多更新 ${BATCH_UPDATE_LIMIT} 条，请缩小范围` }
		}
		return {
			ok: true,
			data: {
				preview,
				scope_mode: 'ids',
				selector: { ids },
				new_date: newDate
			}
		}
	}

	const filterResult = buildListWhereByFilter(selector)
	if (!filterResult.ok) {
		return { ok: false, msg: filterResult.msg || '筛选参数无效' }
	}
	const hasFilter = Boolean(
		filterResult.filters.bottle_no ||
		filterResult.filters.operator ||
		filterResult.filters.record_type ||
		filterResult.filters.sale_state ||
		filterResult.filters.dateStart ||
		filterResult.filters.dateEnd
	)
	if (!hasFilter) {
		return { ok: false, msg: '按筛选全量模式至少填写一个筛选条件' }
	}
	return {
		ok: true,
		data: {
			preview,
			scope_mode: 'filter',
			where: filterResult.where,
			selector: filterResult.filters,
			new_date: newDate
		}
	}
}

function toSampleBottleNos(rows = []) {
	return rows
		.map((row) => normalizeBottleNo(row && row.bottle_no))
		.filter(Boolean)
		.slice(0, 20)
}

async function batchUpdateDateV1(user, data, requestId, token) {
	const parsed = parseBatchUpdateDatePayload(data)
	if (!parsed.ok) return { code: 400, msg: parsed.msg }
	const payload = parsed.data

	let targetRows = []
	let missingIds = []
	if (payload.scope_mode === 'ids') {
		const ids = payload.selector.ids
		const res = await fillings
			.where({ _id: dbCmd.in(ids) })
			.field({ _id: true, bottle_no: true, date: true, record_type: true })
			.get()
		targetRows = Array.isArray(res.data) ? res.data : []
		const foundIds = new Set(targetRows.map((row) => normalizeString(row && row._id)).filter(Boolean))
		missingIds = ids.filter((id) => !foundIds.has(id))
	} else {
		const rowsRes = await fetchFillingsByWhere(payload.where, BATCH_UPDATE_LIMIT)
		if (!rowsRes.ok) return { code: 400, msg: rowsRes.msg }
		targetRows = rowsRes.data || []
	}

	const sampleBottleNos = toSampleBottleNos(targetRows)
	if (payload.preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				scope_mode: payload.scope_mode,
				new_date: payload.new_date,
				target_total: targetRows.length,
				missing_total: missingIds.length,
				missing_ids: missingIds.slice(0, 50),
				sample_bottle_nos: sampleBottleNos,
				limit: BATCH_UPDATE_LIMIT
			}
		}
	}

	const failedItems = missingIds.map((id) => ({
		_id: id,
		bottle_no: '',
		error: '记录不存在'
	}))
	let success = 0
	const touchedBottleNos = []
	const touchedTruckNos = []
	const now = Date.now()
	const eventDay = normalizeEventDay(payload.new_date, now)
	const eventAt = parseEventAt(payload.new_date, now)

	for (let i = 0; i < targetRows.length; i += 1) {
		const row = targetRows[i]
		const rowId = normalizeString(row && row._id)
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		const rowRecordType = normalizeRecordType(row && row.record_type, DEFAULT_RECORD_TYPE)
		const inventoryLinked = isInventoryLinkedRecordType(rowRecordType)
		if (!rowId) {
			failedItems.push({
				_id: rowId || '',
				bottle_no: bottleNo || '',
				error: '记录数据不完整'
			})
			continue
		}
		if (inventoryLinked && !bottleNo) {
			failedItems.push({
				_id: rowId,
				bottle_no: '',
				error: buildBottleRequiredMessage(rowRecordType)
			})
			continue
		}
		try {
			if (inventoryLinked && bottleNo) {
				const hasDuplicate = await hasDuplicateFillingByDateBottle(payload.new_date, bottleNo, rowId)
				if (hasDuplicate) {
					failedItems.push({
						_id: rowId,
						bottle_no: bottleNo,
						error: '目标日期已存在同瓶号记录'
					})
					continue
				}
			}
			await fillings.doc(rowId).update({
				date: payload.new_date,
				updated_at: Date.now()
			})
			if (inventoryLinked) {
				await movements.where({ source_id: rowId, type: 'fill' }).update({
					date: payload.new_date,
					event_day: eventDay,
					event_at: eventAt
				})
			} else {
				await movements.where({ source_id: rowId, type: 'fill' }).remove()
			}
			await updateGasInventoryMovementDateForFilling({
				sourceId: rowId,
				date: payload.new_date,
				now
			})
			success += 1
			if (inventoryLinked && bottleNo) touchedBottleNos.push(bottleNo)
			if (shouldTouchTruckAnomalyForFilling(rowRecordType, bottleNo)) touchedTruckNos.push(bottleNo)
		} catch (err) {
			failedItems.push({
				_id: rowId,
				bottle_no: bottleNo,
				error: normalizeString(err && err.message) || '更新失败'
			})
		}
	}

	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(touchedBottleNos)
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: touchedBottleNos,
			truckNos: touchedTruckNos
		},
		requestId
	)
	await recordLog(
		user,
		'filling_batch_update_date_v1',
		{
			scope_mode: payload.scope_mode,
			selector:
				payload.scope_mode === 'ids'
					? { ids_count: payload.selector.ids.length }
					: (payload.selector || {}),
			new_date: payload.new_date,
			total: targetRows.length + missingIds.length,
			success,
			failed: failedItems.length,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)

	return {
		code: 0,
		msg: touchRes.warning ? `批量更新完成（${touchRes.warning}）` : '批量更新完成',
		data: {
			scope_mode: payload.scope_mode,
			new_date: payload.new_date,
			total: targetRows.length + missingIds.length,
			success,
			failed: failedItems.length,
			failed_items: failedItems.slice(0, 200),
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			warning: touchRes.warning || ''
		}
	}
}

async function normalizeDatesV1(user, data, requestId, token) {
	if (!CLEANUP_ALLOWED_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅管理员可操作' }
	}
	const preview = data && data.preview !== false
	const scanLimitRaw = toNumber(data && (data.scan_limit || data.scanLimit), DATE_NORMALIZE_SCAN_LIMIT)
	const scanLimit = Math.min(
		DATE_NORMALIZE_SCAN_LIMIT,
		Math.max(Number.isFinite(scanLimitRaw) ? Math.floor(scanLimitRaw) : DATE_NORMALIZE_SCAN_LIMIT, 1)
	)
	const sampleLimitRaw = toNumber(data && (data.sample_limit || data.sampleLimit), 50)
	const sampleLimit = Math.min(200, Math.max(Number.isFinite(sampleLimitRaw) ? Math.floor(sampleLimitRaw) : 50, 1))
	const maxUpdatesRaw = toNumber(data && (data.max_updates || data.maxUpdates), 200)
	const maxUpdates = Math.min(1000, Math.max(Number.isFinite(maxUpdatesRaw) ? Math.floor(maxUpdatesRaw) : 200, 1))

	const rowsRes = await fetchFillingsByWhere({}, scanLimit)
	if (!rowsRes.ok) return { code: 400, msg: rowsRes.msg || '扫描失败' }
	const rows = Array.isArray(rowsRes.data) ? rowsRes.data : []
	const normalizeCandidates = []
	const invalidRows = []
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		const rowId = normalizeString(row._id)
		const oldDate = normalizeString(row.date)
		const newDate = normalizeFillingDate(oldDate, row.created_at)
		if (!rowId || !oldDate || !newDate) {
			invalidRows.push({
				_id: rowId || '',
				bottle_no: normalizeBottleNo(row.bottle_no) || '',
				record_type: normalizeRecordType(row.record_type, DEFAULT_RECORD_TYPE),
				old_date: oldDate,
				error: '日期无法归一化'
			})
			continue
		}
		if (oldDate === newDate) continue
		normalizeCandidates.push({
			_id: rowId,
			bottle_no: normalizeBottleNo(row.bottle_no) || '',
			record_type: normalizeRecordType(row.record_type, DEFAULT_RECORD_TYPE),
			old_date: oldDate,
			new_date: newDate
		})
	}

	if (preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				preview: true,
				scan_limit: scanLimit,
				max_updates: maxUpdates,
				scanned_total: rows.length,
				candidate_total: normalizeCandidates.length,
				to_execute: Math.min(normalizeCandidates.length, maxUpdates),
				pending_total: Math.max(normalizeCandidates.length - maxUpdates, 0),
				invalid_total: invalidRows.length,
				candidates_sample: normalizeCandidates.slice(0, sampleLimit),
				invalid_sample: invalidRows.slice(0, sampleLimit)
			}
		}
	}

	const executeCandidates = normalizeCandidates.slice(0, maxUpdates)
	const pendingTotal = Math.max(normalizeCandidates.length - executeCandidates.length, 0)
	let success = 0
	const failedItems = []
	const touchedBottleNos = []
	for (let i = 0; i < invalidRows.length; i += 1) {
		const row = invalidRows[i]
		failedItems.push({
			_id: row._id,
			bottle_no: row.bottle_no,
			error: row.error || '日期无法归一化'
		})
	}

	for (let i = 0; i < executeCandidates.length; i += 1) {
		const row = executeCandidates[i]
		const inventoryLinked = isInventoryLinkedRecordType(row.record_type)
		if (inventoryLinked && row.bottle_no) {
			const hasDuplicate = await hasDuplicateFillingByDateBottle(row.new_date, row.bottle_no, row._id)
			if (hasDuplicate) {
				failedItems.push({
					_id: row._id,
					bottle_no: row.bottle_no,
					error: `归一化后冲突：${row.new_date} 已存在同瓶号记录`
				})
				continue
			}
		}
		try {
			const now = Date.now()
			await fillings.doc(row._id).update({
				date: row.new_date,
				updated_at: now
			})
			await movements.where({ source_id: row._id, type: 'fill' }).update({
				date: row.new_date,
				event_day: normalizeEventDay(row.new_date, now),
				event_at: parseEventAt(row.new_date, now)
			})
			await updateGasInventoryMovementDateForFilling({
				sourceId: row._id,
				date: row.new_date,
				now
			})
			success += 1
			if (inventoryLinked && row.bottle_no) touchedBottleNos.push(row.bottle_no)
		} catch (err) {
			failedItems.push({
				_id: row._id,
				bottle_no: row.bottle_no,
				error: normalizeString(err && err.message) || '更新失败'
			})
		}
	}

	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(touchedBottleNos)
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: touchedBottleNos,
			truckNos: executeCandidates
				.filter((row) => shouldTouchTruckAnomalyForFilling(row && row.record_type, row && row.bottle_no))
				.map((row) => normalizeBottleNo(row && row.bottle_no))
				.filter(Boolean)
		},
		requestId
	)
	await recordLog(
		user,
		'filling_normalize_dates_v1',
		{
			scan_limit: scanLimit,
			max_updates: maxUpdates,
			scanned_total: rows.length,
			candidate_total: normalizeCandidates.length,
			execute_total: executeCandidates.length,
			pending_total: pendingTotal,
			success,
			failed: failedItems.length,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)

	return {
		code: 0,
		msg: touchRes.warning ? `清洗完成（${touchRes.warning}）` : '清洗完成',
		data: {
			preview: false,
			scan_limit: scanLimit,
			max_updates: maxUpdates,
			scanned_total: rows.length,
			candidate_total: normalizeCandidates.length,
			execute_total: executeCandidates.length,
			pending_total: pendingTotal,
			has_more: pendingTotal > 0,
			success,
			failed: failedItems.length,
			failed_items: failedItems.slice(0, 200),
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			touch_warning: touchRes.warning || ''
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
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
		recordLog,
		requestId,
		cloudFunction: 'crm-filling'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'resolveFillWeightV1') return resolveFillWeightV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId, token)
	if (action === 'updateV1') return updateV1(user, data, requestId, token)
	if (action === 'removeV1') return removeV1(user, data, requestId, token)
	if (action === 'batchCreateV1') return batchCreateV1(user, data, requestId, token)
	if (action === 'batchUpdateDateV1') return batchUpdateDateV1(user, data, requestId, token)
	if (action === 'cleanupOrphanFillMovementsV1') return cleanupOrphanFillMovementsV1(user, data, requestId, token)
	if (action === 'cleanupNoSaleMovementsV1') return cleanupNoSaleMovementsV1(user, data, requestId, token)
	if (action === 'normalizeDatesV1') return normalizeDatesV1(user, data, requestId, token)

	return { code: 400, msg: '未知 action' }
}
