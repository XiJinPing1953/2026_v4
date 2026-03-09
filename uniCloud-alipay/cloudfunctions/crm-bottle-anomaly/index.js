'use strict'

const db = uniCloud.database()

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const anomalies = db.collection('crm_bottle_anomalies')
const movements = db.collection('crm_bottle_movements')
const fillings = db.collection('crm_fillings')
const bottles = db.collection('crm_bottles')

const ANOMALY_TYPES = {
	missing_back: { code: 'missing_back', name: '缺回瓶', desc: '未回瓶却发生灌装或出瓶' },
	missing_fill: { code: 'missing_fill', name: '缺灌装', desc: '回瓶后未灌装就出瓶' },
	continuous_out: { code: 'continuous_out', name: '连续出瓶', desc: '不经过回瓶/灌装连续出瓶' }
}
const RECONCILE_TYPE_LIST = ['missing_back', 'missing_fill', 'continuous_out']
const RECONCILE_TYPE_SET = new Set(RECONCILE_TYPE_LIST)
const REBUILD_SCAN_ROLES = new Set(['superadmin'])
const MISSING_FILL_THRESHOLD_KG = 10
const MISSING_FILL_RESOLUTION_MODE = 'loss_accept'

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
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
		console.error('[crm-bottle-anomaly] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
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

function normalizeBottleNoList(value, maxLen = 200) {
	let list = value
	if (typeof list === 'string') {
		list = list
			.split(',')
			.map((item) => normalizeBottleNo(item))
			.filter(Boolean)
	}
	if (!Array.isArray(list)) return []
	const uniq = []
	const seen = new Set()
	for (const item of list) {
		const no = normalizeBottleNo(item)
		if (!no || seen.has(no)) continue
		seen.add(no)
		uniq.push(no)
		if (uniq.length >= maxLen) break
	}
	return uniq
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function clampNumber(value, min, max, fallback) {
	const num = Number(value)
	if (!Number.isFinite(num)) return fallback
	if (num < min) return min
	if (num > max) return max
	return num
}

function toBoolean(value, fallback = false) {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (text === 'true' || text === '1' || text === 'yes' || text === 'y') return true
	if (text === 'false' || text === '0' || text === 'no' || text === 'n') return false
	return fallback
}

function normalizeReconcileTypes(value) {
	let list = value
	if (typeof list === 'string') {
		list = list
			.split(',')
			.map((item) => normalizeString(item))
			.filter(Boolean)
	}
	if (!Array.isArray(list)) return []
	const unique = []
	const seen = new Set()
	for (const item of list) {
		const type = normalizeString(item)
		if (!RECONCILE_TYPE_SET.has(type)) continue
		if (seen.has(type)) continue
		seen.add(type)
		unique.push(type)
	}
	return unique
}

function buildEmptyDetectedFpsByType() {
	return {
		missing_back: [],
		missing_fill: [],
		continuous_out: []
	}
}

function toDetectedFpsSetMap(input) {
	const map = new Map()
	for (const type of RECONCILE_TYPE_LIST) {
		const list = Array.isArray(input && input[type]) ? input[type] : []
		map.set(
			type,
			new Set(
				list
					.map((item) => normalizeString(item))
					.filter(Boolean)
			)
		)
	}
	return map
}

function fromDetectedFpsSetMap(map) {
	const out = buildEmptyDetectedFpsByType()
	for (const type of RECONCILE_TYPE_LIST) {
		const set = map.get(type)
		out[type] = set ? Array.from(set).filter(Boolean) : []
	}
	return out
}

function normalizeType(value) {
	const text = normalizeString(value)
	if (text === 'back' || text === 'fill' || text === 'out' || text === 'adjust') return text
	return ''
}

function buildMissingFill(event, lastBack) {
	const prevCustomer = lastBack.customer_name || '未知客户'
	const curCustomer = event.customer_name || '未知客户'
	const prevNet = toNumber(lastBack.net_weight, null)
	const outNet = toNumber(event.net_weight, null)
	const prevNetText = prevNet != null ? `（净重 ${prevNet} kg）` : ''
	const outNetText = outNet != null ? `（净重 ${outNet} kg）` : ''
	return {
		type: 'missing_fill',
		bottle_no: event.bottle_no,
		date: event.date,
		detail: `${lastBack.date}从"${prevCustomer}"处回瓶${prevNetText}后未灌装，${event.date}直接出瓶至"${curCustomer}"${outNetText}`,
		context: {
			last_back: {
				date: lastBack.date,
				customer: prevCustomer,
				net: prevNet,
				source_type: normalizeString(lastBack.source_type),
				source_id: normalizeString(lastBack.source_id) || null
			},
			next_out: {
				date: event.date,
				customer: curCustomer,
				net: outNet,
				source_type: normalizeString(event.source_type),
				source_id: normalizeString(event.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildMissingBack(fillEvent, lastOut) {
	const outCustomer = lastOut.customer_name || '未知客户'
	const outNet = toNumber(lastOut.net_weight, null)
	const fillNet = toNumber(fillEvent.net_weight, null)
	return {
		type: 'missing_back',
		bottle_no: fillEvent.bottle_no,
		date: fillEvent.date,
		detail: `${lastOut.date}出瓶至"${outCustomer}"后未回瓶，${fillEvent.date}直接灌装`,
		context: {
			last_out: {
				date: lastOut.date,
				customer: outCustomer,
				net: outNet,
				source_type: normalizeString(lastOut.source_type),
				source_id: normalizeString(lastOut.source_id) || null
			},
			next_fill: {
				date: fillEvent.date,
				net: fillNet,
				source_type: normalizeString(fillEvent.source_type),
				source_id: normalizeString(fillEvent.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildContinuousOut(event, lastOut) {
	return {
		type: 'continuous_out',
		bottle_no: event.bottle_no,
		date: event.date,
		detail: `${lastOut.date}出瓶后未回瓶/灌装，${event.date}再次出瓶`,
		context: {
			last_out: {
				date: lastOut.date,
				customer: normalizeString(lastOut.customer_name),
				net: toNumber(lastOut.net_weight, null),
				source_type: normalizeString(lastOut.source_type),
				source_id: normalizeString(lastOut.source_id) || null
			},
			next_out: {
				date: event.date,
				customer: normalizeString(event.customer_name),
				net: toNumber(event.net_weight, null),
				source_type: normalizeString(event.source_type),
				source_id: normalizeString(event.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function normalizeContext(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value
}

function hasMissingFillLossResolution(row) {
	const ctx = normalizeContext(row && row.context)
	const resolution = normalizeContext(ctx.resolution)
	const mode = normalizeString(resolution.mode).toLowerCase()
	return mode === MISSING_FILL_RESOLUTION_MODE
}

function buildMissingFillResolutionContext(diffKg, lossKg, now) {
	return {
		mode: MISSING_FILL_RESOLUTION_MODE,
		threshold_kg: MISSING_FILL_THRESHOLD_KG,
		diff_kg: diffKg,
		loss_kg: lossKg,
		resolved_at: now
	}
}

function buildAnomalyFingerprint(input) {
	const bottleNo = normalizeBottleNo(input?.bottle_no)
	const anomalyType = normalizeString(input?.anomaly_type || input?.type).toLowerCase()
	const context = normalizeContext(input?.context)
	const date = normalizeString(input?.date || context.legacy_date)
	const detail = normalizeString(input?.note || input?.detail)
	const lastBack = normalizeContext(context.last_back)
	const nextOut = normalizeContext(context.next_out)
	const lastOut = normalizeContext(context.last_out)
	const nextFill = normalizeContext(context.next_fill)
	const key = (value) => normalizeString(value).toLowerCase()
	const numKey = (value) => {
		const num = toNumber(value, null)
		return num == null ? '' : String(num)
	}
	const sig = [
		key(bottleNo),
		key(anomalyType),
		key(date),

		key(lastBack.date),
		key(lastBack.source_type),
		key(lastBack.source_id),
		key(lastBack.customer),
		numKey(lastBack.net),

		key(nextOut.date),
		key(nextOut.source_type),
		key(nextOut.source_id),
		key(nextOut.customer),
		numKey(nextOut.net),

		key(lastOut.date),
		key(lastOut.source_type),
		key(lastOut.source_id),
		key(lastOut.customer),
		numKey(lastOut.net),

		key(nextFill.date),
		key(nextFill.source_type),
		key(nextFill.source_id),
		numKey(nextFill.net)
	]
	const hasStructuredIdentity = sig.slice(3).some(Boolean)
	if (!hasStructuredIdentity && detail) {
		sig.push(key(detail))
	}
	return sig.join('|')
}

function compareBusinessOrder(a, b) {
	const aDay = normalizeEventDay(a.event_day || a.date, a.event_at || a.created_at || Date.now())
	const bDay = normalizeEventDay(b.event_day || b.date, b.event_at || b.created_at || Date.now())
	if (aDay !== bDay) return aDay.localeCompare(bDay)
	const aOrder = toNumber(a.type_order, movementTypeOrder(a.type))
	const bOrder = toNumber(b.type_order, movementTypeOrder(b.type))
	if (aOrder !== bOrder) return aOrder - bOrder
	const aAt = toTimestamp(a.event_at, parseEventAt(a.date, a.created_at || Date.now()))
	const bAt = toTimestamp(b.event_at, parseEventAt(b.date, b.created_at || Date.now()))
	if (aAt !== bAt) return aAt - bAt
	return toTimestamp(a.created_at, 0) - toTimestamp(b.created_at, 0)
}

function normalizeStateEvent(input, bottleNoFallback = '') {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const type = normalizeType(input.type)
	if (!type) return null
	const createdAt = toTimestamp(input.created_at, Date.now())
	const eventAt = toTimestamp(input.event_at, parseEventAt(input.date, createdAt))
	const bottleNo = normalizeBottleNo(input.bottle_no || bottleNoFallback)
	if (!bottleNo) return null
	return {
		bottle_no: bottleNo,
		date: normalizeString(input.date) || normalizeEventDay(input.event_day, eventAt),
		event_day: normalizeEventDay(input.event_day || input.date, eventAt),
		type,
		type_order: toNumber(input.type_order, movementTypeOrder(type)),
		customer_name: normalizeString(input.customer_name),
		net_weight: toNumber(input.net_weight, null),
		event_at: eventAt,
		created_at: createdAt,
		source_type: normalizeString(input.source_type),
		source_id: normalizeString(input.source_id) || null
	}
}

function buildMovementEvent(row, bottleNo) {
	const fallbackTs = toTimestamp(row.created_at, Date.now())
	const type = normalizeType(row.type)
	const eventAt = toTimestamp(row.event_at, parseEventAt(row.date, fallbackTs))
	const createdAt = toTimestamp(row.created_at, eventAt)
	const eventDay = normalizeEventDay(row.event_day || row.date, eventAt)
	return {
		_id: normalizeString(row._id),
		bottle_no: bottleNo,
		date: normalizeString(row.date) || eventDay,
		event_day: eventDay,
		type,
		type_order: toNumber(row.type_order, movementTypeOrder(type)),
		customer_name: normalizeString(row.customer_name),
		net_weight: toNumber(row.net_weight, null),
		event_at: eventAt,
		created_at: createdAt,
		source_type: normalizeString(row.source_type),
		source_id: normalizeString(row.source_id) || null
	}
}

function normalizeAnalyzerState(input, bottleNo) {
	const state = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
	const legacyLastEvent = normalizeStateEvent(state.last_event, bottleNo)
	const lastEffective = normalizeStateEvent(state.last_effective_event, bottleNo) || legacyLastEvent
	const lastOut = normalizeStateEvent(state.last_out_event, bottleNo)
	const lastBack = normalizeStateEvent(state.last_back_event, bottleNo) || normalizeStateEvent(state.last_back, bottleNo)
	const normalizedLastOut = lastOut || (lastEffective && lastEffective.type === 'out' ? lastEffective : null)
	const normalized = {
		last_effective_event: lastEffective && lastEffective.type !== 'adjust' ? lastEffective : null,
		last_out_event: normalizedLastOut,
		last_back_event: lastBack,
		has_fill_since_last_back: Boolean(state.has_fill_since_last_back)
	}
	if (!normalized.last_back_event) {
		normalized.has_fill_since_last_back = false
	}
	return normalized
}

function detectAnomaliesForEvent(event, inputState) {
	const state = {
		last_effective_event: inputState.last_effective_event,
		last_out_event: inputState.last_out_event,
		last_back_event: inputState.last_back_event,
		has_fill_since_last_back: Boolean(inputState.has_fill_since_last_back)
	}
	const detected = []

	if (event.type === 'back') {
		state.last_back_event = event
		state.last_out_event = null
		state.has_fill_since_last_back = false
		state.last_effective_event = event
		return { anomalies: detected, nextState: state }
	}

	if (event.type === 'fill') {
		if (state.last_out_event && state.last_out_event.type === 'out') {
			detected.push(buildMissingBack(event, state.last_out_event))
		}
		if (state.last_back_event) state.has_fill_since_last_back = true
		state.last_out_event = null
		state.last_effective_event = event
		return { anomalies: detected, nextState: state }
	}

	if (event.type === 'out') {
		if (state.last_effective_event && state.last_effective_event.type === 'out') {
			detected.push(buildContinuousOut(event, state.last_effective_event))
		}
		if (state.last_back_event && !state.has_fill_since_last_back) {
			detected.push(buildMissingFill(event, state.last_back_event))
		}
		state.last_out_event = event
		state.last_effective_event = event
		return { anomalies: detected, nextState: state }
	}

	// adjust is a neutral event in anomaly scan state machine.
	return { anomalies: detected, nextState: state }
}

function normalizePendingAnomalyQueue(value, bottleNo) {
	if (!Array.isArray(value)) return []
	const list = []
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue
		const type = normalizeString(item.type)
		if (!type) continue
		list.push({
			type,
			bottle_no: normalizeBottleNo(item.bottle_no || bottleNo),
			date: normalizeString(item.date),
			detail: normalizeString(item.detail),
			context: normalizeContext(item.context),
			resolved: false,
			ignored: false,
			created_at: toTimestamp(item.created_at, Date.now())
		})
	}
	return list
}

function ensureTypeSet(map, type) {
	if (!map.has(type)) map.set(type, new Set())
	return map.get(type)
}

function buildOpenFingerprintMap(rows) {
	const map = new Map()
	for (const row of rows) {
		const type = normalizeString(row.anomaly_type)
		if (!type) continue
		const fp = normalizeString(row.fingerprint) || buildAnomalyFingerprint(row)
		if (!fp) continue
		ensureTypeSet(map, type).add(fp)
	}
	return map
}

function buildResolvedMissingFillFingerprintSet(rows) {
	const set = new Set()
	for (const row of rows || []) {
		if (!hasMissingFillLossResolution(row)) continue
		const fp = normalizeString(row.fingerprint) || buildAnomalyFingerprint(row)
		if (!fp) continue
		set.add(fp)
	}
	return set
}

function parseScanCursor(raw, bottleNo) {
	let cursor = raw
	if (typeof cursor === 'string') {
		try {
			cursor = JSON.parse(cursor)
		} catch (err) {
			cursor = null
		}
	}
	if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
		return {
			dbCursor: null,
			analyzerState: normalizeAnalyzerState(null, bottleNo),
			dayBuffer: [],
			pendingAnomalies: [],
			scanDone: false,
			scanStartedAt: 0,
			detectedFpsByType: buildEmptyDetectedFpsByType()
		}
	}

	const dbCursor = cursor.db_cursor && typeof cursor.db_cursor === 'object'
		? {
			event_at: toTimestamp(cursor.db_cursor.event_at, 0),
			type_order: toNumber(cursor.db_cursor.type_order, 0) || 0,
			created_at: toTimestamp(cursor.db_cursor.created_at, 0)
		}
		: null

	const dayBuffer = Array.isArray(cursor.day_buffer)
		? cursor.day_buffer
			.map((item) => normalizeStateEvent(item, bottleNo))
			.filter(Boolean)
		: []

	const detectedFpsByType = buildEmptyDetectedFpsByType()
	const cursorDetected = cursor.detected_fps_by_type
	if (cursorDetected && typeof cursorDetected === 'object' && !Array.isArray(cursorDetected)) {
		for (const type of RECONCILE_TYPE_LIST) {
			const list = Array.isArray(cursorDetected[type]) ? cursorDetected[type] : []
			detectedFpsByType[type] = list.map((item) => normalizeString(item)).filter(Boolean)
		}
	}
	if (!detectedFpsByType.missing_back.length && Array.isArray(cursor.detected_missing_back_fps)) {
		detectedFpsByType.missing_back = cursor.detected_missing_back_fps.map((item) => normalizeString(item)).filter(Boolean)
	}

	return {
		dbCursor,
		analyzerState: normalizeAnalyzerState(cursor.analyzer_state, bottleNo),
		dayBuffer,
		pendingAnomalies: normalizePendingAnomalyQueue(cursor.pending_anomalies, bottleNo),
		scanDone: toBoolean(cursor.scan_done, false),
		scanStartedAt: toTimestamp(cursor.scan_started_at, 0),
		detectedFpsByType
	}
}

function buildNextCursor(payload) {
	if (payload.done) return null
	return {
		db_cursor: payload.dbCursor,
		analyzer_state: {
			last_effective_event: payload.analyzerState.last_effective_event,
			last_out_event: payload.analyzerState.last_out_event,
			last_back_event: payload.analyzerState.last_back_event,
			has_fill_since_last_back: Boolean(payload.analyzerState.has_fill_since_last_back)
		},
		day_buffer: payload.dayBuffer,
		pending_anomalies: payload.pendingAnomalies,
		scan_done: Boolean(payload.scanDone),
		scan_started_at: payload.scanStartedAt,
		detected_fps_by_type: payload.detectedFpsByType,
		detected_missing_back_fps: payload.detectedFpsByType.missing_back || []
	}
}

function buildMovementWhereAfterCursor(bottleNo, dbCursor) {
	if (!dbCursor || !Number.isFinite(dbCursor.event_at) || dbCursor.event_at <= 0) {
		return { bottle_no: bottleNo }
	}
	return db.command.and(
		{ bottle_no: bottleNo },
		db.command.or([
			{ event_at: db.command.gt(dbCursor.event_at) },
			{ event_at: dbCursor.event_at, type_order: db.command.gt(dbCursor.type_order || 0) },
			{ event_at: dbCursor.event_at, type_order: dbCursor.type_order || 0, created_at: db.command.gt(dbCursor.created_at || 0) }
		])
		)
}

function parseRebuildCursor(raw) {
	let cursor = raw
	if (typeof cursor === 'string') {
		try {
			cursor = JSON.parse(cursor)
		} catch (err) {
			cursor = null
		}
	}
	if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
		return {
			bottleAfter: '',
			currentBottleNo: '',
			currentScanCursor: null
		}
	}
	return {
		bottleAfter: normalizeBottleNo(cursor.bottle_after || cursor.bottleAfter),
		currentBottleNo: normalizeBottleNo(cursor.current_bottle_no || cursor.currentBottleNo),
		currentScanCursor: cursor.current_scan_cursor || cursor.currentScanCursor || null
	}
}

function buildRebuildCursor(payload) {
	if (payload.done) return null
	return {
		bottle_after: normalizeBottleNo(payload.bottleAfter),
		current_bottle_no: normalizeBottleNo(payload.currentBottleNo),
		current_scan_cursor: payload.currentScanCursor || null
	}
}

async function fetchNextBottleNo(afterBottleNo) {
	const where = afterBottleNo ? { bottle_no: db.command.gt(afterBottleNo) } : {}
	const res = await bottles
		.where(where)
		.field({ bottle_no: true })
		.orderBy('bottle_no', 'asc')
		.limit(1)
		.get()
	const first = (res.data && res.data[0]) || null
	return normalizeBottleNo(first && first.bottle_no)
}

async function listV1(user, data) {
	void user
	const bottleNo = normalizeString(data.bottle_no)
	const page = Math.max(Number(data.page || 1), 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || 20), 1), 50)
	const status = normalizeString(data.status)
	const summaryIgnoreStatus = toBoolean(data.summary_ignore_status ?? data.summaryIgnoreStatus, false)
	const where = {}
	if (bottleNo) where.bottle_no = normalizeBottleNo(bottleNo)
	if (status === 'resolved') where.status = 'resolved'
	if (status === 'open') where.status = 'open'

	const res = await anomalies
		.where(where)
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await anomalies.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total

	const summaryScopeWhere = {}
	if (bottleNo) summaryScopeWhere.bottle_no = normalizeBottleNo(bottleNo)
	if (!summaryIgnoreStatus && (status === 'resolved' || status === 'open')) {
		summaryScopeWhere.status = status
	}

	const summaryTotalRes = await anomalies.where(summaryScopeWhere).count()
	const summaryTotal = Number(summaryTotalRes.total || 0)

	let openTotal = 0
	let resolvedTotal = 0
	if (summaryIgnoreStatus || !status) {
		const openTotalRes = await anomalies.where({ ...summaryScopeWhere, status: 'open' }).count()
		const resolvedTotalRes = await anomalies.where({ ...summaryScopeWhere, status: 'resolved' }).count()
		openTotal = Number(openTotalRes.total || 0)
		resolvedTotal = Number(resolvedTotalRes.total || 0)
	} else if (status === 'open') {
		openTotal = summaryTotal
	} else if (status === 'resolved') {
		resolvedTotal = summaryTotal
	}

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
			open: openTotal,
			resolved: resolvedTotal
		}
	}
}

async function typesV1() {
	return { code: 0, data: Object.values(ANOMALY_TYPES) }
}

async function scanV2(user, data, requestId) {
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo)
	if (!bottleNo) return { code: 400, msg: 'bottle_no 必填' }

	const batchSize = clampNumber(data.batch_size, 20, 500, 200)
	const maxEventsPerRound = clampNumber(data.max_events_per_round, 50, 4000, 900)
	const maxMsPerRound = clampNumber(data.max_ms_per_round, 400, 8000, 3200)
	const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 800, 160)
	const legacyReconcileMissingBack = toBoolean(data.reconcile_missing_back, false)
	const explicitReconcileTypes = normalizeReconcileTypes(data.reconcile_types)
	const hasExplicitReconcileAnomalies =
		data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'reconcile_anomalies')
	const reconcileAnomalies = hasExplicitReconcileAnomalies
		? toBoolean(data.reconcile_anomalies, false)
		: explicitReconcileTypes.length > 0 || legacyReconcileMissingBack
	let reconcileTypes = []
	if (explicitReconcileTypes.length > 0) {
		reconcileTypes = explicitReconcileTypes
	} else if (legacyReconcileMissingBack && !hasExplicitReconcileAnomalies) {
		reconcileTypes = ['missing_back']
	} else if (reconcileAnomalies) {
		reconcileTypes = [...RECONCILE_TYPE_LIST]
	}
	const reconcileTypeSet = new Set(reconcileTypes)
	const shouldReconcile = reconcileAnomalies && reconcileTypes.length > 0

	const cursorState = parseScanCursor(data.cursor, bottleNo)
	let dbCursor = cursorState.dbCursor
	let analyzerState = cursorState.analyzerState
	let dayBuffer = cursorState.dayBuffer
	let pendingAnomalies = cursorState.pendingAnomalies
	let scanDone = cursorState.scanDone
	let scanStartedAt = cursorState.scanStartedAt
	if (shouldReconcile && !scanStartedAt) scanStartedAt = Date.now()
	if (!shouldReconcile) scanStartedAt = 0
	const detectedFpsByTypeSet = toDetectedFpsSetMap(shouldReconcile ? cursorState.detectedFpsByType : buildEmptyDetectedFpsByType())

	let roundCreated = 0
	let roundResolvedStale = 0
	let roundScannedEvents = 0
	let writeCount = 0
	let stopByWriteLimit = false
	const startedAt = Date.now()

	const isTimeExceeded = () => Date.now() - startedAt >= maxMsPerRound
	const isEventExceeded = () => roundScannedEvents >= maxEventsPerRound
	const isWriteExceeded = () => writeCount >= maxWritesPerRound

	const openRes = await anomalies.where({ bottle_no: bottleNo, status: 'open' }).limit(5000).get()
	const openFingerprintMap = buildOpenFingerprintMap(openRes.data || [])
	const resolvedMissingFillRes = await anomalies
		.where({ bottle_no: bottleNo, anomaly_type: 'missing_fill', status: 'resolved' })
		.limit(5000)
		.get()
	const resolvedMissingFillFingerprintSet = buildResolvedMissingFillFingerprintSet(resolvedMissingFillRes.data || [])

	const persistAnomaly = async (anomaly) => {
		const type = normalizeString(anomaly.type)
		if (!type) return { limited: false }
		const fingerprint = buildAnomalyFingerprint(anomaly)
		if (!fingerprint) return { limited: false }
		if (shouldReconcile && reconcileTypeSet.has(type)) {
			ensureTypeSet(detectedFpsByTypeSet, type).add(fingerprint)
		}
		if (type === 'missing_fill' && resolvedMissingFillFingerprintSet.has(fingerprint)) {
			return { limited: false }
		}
		const typeSet = ensureTypeSet(openFingerprintMap, type)
		if (typeSet.has(fingerprint)) return { limited: false }
		if (isWriteExceeded()) return { limited: true }

		const now = Date.now()
		await anomalies.add({
			bottle_no: bottleNo,
			anomaly_type: type,
			fingerprint,
			status: 'open',
			note: normalizeString(anomaly.detail),
			context: normalizeContext(anomaly.context),
			resolved_by: null,
			resolved_by_name: '',
			created_at: now,
			updated_at: now
		})
		writeCount += 1
		roundCreated += 1
		typeSet.add(fingerprint)
		return { limited: false }
	}

	const flushDayBuffer = async () => {
		if (!dayBuffer.length) return
		const sorted = [...dayBuffer].sort(compareBusinessOrder)
		dayBuffer = []
		for (let i = 0; i < sorted.length; i += 1) {
			if (isTimeExceeded()) {
				dayBuffer = sorted.slice(i)
				return
			}
			const event = sorted[i]
			const { anomalies: detected, nextState } = detectAnomaliesForEvent(event, analyzerState)
			analyzerState = nextState
			for (let j = 0; j < detected.length; j += 1) {
				const anomaly = detected[j]
				const saveResult = await persistAnomaly(anomaly)
				if (saveResult.limited) {
					pendingAnomalies.push(anomaly)
					pendingAnomalies.push(...detected.slice(j + 1))
					dayBuffer = sorted.slice(i + 1)
					stopByWriteLimit = true
					return
				}
			}
		}
	}

	while (pendingAnomalies.length > 0 && !stopByWriteLimit && !isTimeExceeded()) {
		const anomaly = pendingAnomalies[0]
		const saveResult = await persistAnomaly(anomaly)
		if (saveResult.limited) {
			stopByWriteLimit = true
			break
		}
		pendingAnomalies.shift()
	}

	if (!scanDone && !stopByWriteLimit && !isTimeExceeded()) {
		while (!scanDone && !stopByWriteLimit && !isTimeExceeded() && !isEventExceeded()) {
			const queryLimit = Math.min(batchSize, Math.max(maxEventsPerRound - roundScannedEvents, 1))
			const where = buildMovementWhereAfterCursor(bottleNo, dbCursor)
			const res = await movements
				.where(where)
				.orderBy('event_at', 'asc')
				.orderBy('type_order', 'asc')
				.orderBy('created_at', 'asc')
				.limit(queryLimit)
				.get()
			const rows = res.data || []
			if (!rows.length) {
				scanDone = true
				break
			}

			for (const row of rows) {
				if (isTimeExceeded() || isEventExceeded() || stopByWriteLimit) break
				const event = buildMovementEvent(row, bottleNo)
				roundScannedEvents += 1

				if (!dayBuffer.length) {
					dayBuffer.push(event)
				} else {
					const currentDay = dayBuffer[0].event_day
					if (event.event_day === currentDay) {
						dayBuffer.push(event)
					} else {
						await flushDayBuffer()
						if (stopByWriteLimit || isTimeExceeded()) {
							roundScannedEvents -= 1
							break
						}
						dayBuffer.push(event)
					}
				}

				dbCursor = {
					event_at: toTimestamp(row.event_at, event.event_at),
					type_order: toNumber(row.type_order, movementTypeOrder(event.type)) || 0,
					created_at: toTimestamp(row.created_at, event.created_at)
				}
			}

			if (!stopByWriteLimit && !isTimeExceeded() && rows.length < queryLimit) {
				scanDone = true
				break
			}
		}
	}

	if (scanDone && !stopByWriteLimit && !isTimeExceeded()) {
		await flushDayBuffer()
	}

	if (scanDone && !stopByWriteLimit && !isTimeExceeded() && pendingAnomalies.length === 0 && dayBuffer.length === 0) {
		if (shouldReconcile) {
			for (const anomalyType of reconcileTypes) {
				if (isTimeExceeded() || isWriteExceeded()) {
					scanDone = false
					break
				}
				const detectedSet = ensureTypeSet(detectedFpsByTypeSet, anomalyType)
				const openResByType = await anomalies
					.where({ bottle_no: bottleNo, anomaly_type: anomalyType, status: 'open' })
					.orderBy('created_at', 'asc')
					.limit(5000)
					.get()
				const openRowsByType = openResByType.data || []
				for (const row of openRowsByType) {
					if (isTimeExceeded() || isWriteExceeded()) {
						scanDone = false
						break
					}
					const fp = normalizeString(row.fingerprint) || buildAnomalyFingerprint(row)
					if (!fp || detectedSet.has(fp)) continue
					const id = normalizeString(row._id)
					if (!id) continue
					await anomalies.doc(id).update({
						status: 'resolved',
						updated_at: Date.now(),
						resolved_by: null,
						resolved_by_name: 'system-reconcile'
					})
					writeCount += 1
					roundResolvedStale += 1
				}
				if (openRowsByType.length >= 5000) {
					scanDone = false
				}
				if (!isTimeExceeded() && !isWriteExceeded()) {
					const verifyRes = await anomalies
						.where({ bottle_no: bottleNo, anomaly_type: anomalyType, status: 'open' })
						.limit(5000)
						.get()
					const verifyRows = verifyRes.data || []
					const staleRemaining = verifyRows.some((row) => {
						const fp = normalizeString(row.fingerprint) || buildAnomalyFingerprint(row)
						if (!fp) return false
						return !detectedSet.has(fp)
					})
					if (staleRemaining) scanDone = false
					if (verifyRows.length >= 5000) scanDone = false
				} else {
					scanDone = false
				}
			}
		}
	}

	if (isTimeExceeded()) scanDone = false
	if (stopByWriteLimit) scanDone = false
	if (pendingAnomalies.length > 0 || dayBuffer.length > 0) scanDone = false

	const done = Boolean(scanDone)
	const cursor = buildNextCursor({
		done,
		dbCursor,
		analyzerState,
		dayBuffer,
		pendingAnomalies,
		scanDone,
		scanStartedAt,
		detectedFpsByType: fromDetectedFpsSetMap(detectedFpsByTypeSet)
	})

	await recordLog(
		user,
		'bottle_anomaly_scan_v2',
		{
			bottle_no: bottleNo,
			done,
			has_cursor: Boolean(cursor),
			reconcile_anomalies: shouldReconcile,
			reconcile_types: reconcileTypes,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale
		},
		requestId
	)

	return {
		code: 0,
		data: {
			done,
			cursor,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			round_scanned_events: roundScannedEvents
		}
	}
}

async function rebuildV2(user, data, requestId) {
	if (!REBUILD_SCAN_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅超级管理员可操作' }
	}

	const batchBottlesPerRound = clampNumber(data.batch_bottles_per_round, 1, 200, 20)
	const maxMsPerRound = clampNumber(data.max_ms_per_round, 400, 8000, 3200)
	const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 1200, 300)
	const maxEventsPerRound = clampNumber(data.max_events_per_round, 50, 4000, 900)
	const batchSize = clampNumber(data.batch_size, 20, 500, 200)
	const rebuildCursor = parseRebuildCursor(data.cursor)

	let bottleAfter = rebuildCursor.bottleAfter
	let currentBottleNo = rebuildCursor.currentBottleNo
	let currentScanCursor = rebuildCursor.currentScanCursor
	let roundBottles = 0
	let roundScannedEvents = 0
	let roundCreated = 0
	let roundResolvedStale = 0
	let done = false

	const startedAt = Date.now()
	const isTimeExceeded = () => Date.now() - startedAt >= maxMsPerRound

	while (!isTimeExceeded() && roundBottles < batchBottlesPerRound) {
		if (!currentBottleNo) {
			const nextBottleNo = await fetchNextBottleNo(bottleAfter)
			if (!nextBottleNo) {
				done = true
				break
			}
			currentBottleNo = nextBottleNo
			currentScanCursor = null
		}

		const remainingMs = Math.max(maxMsPerRound - (Date.now() - startedAt), 400)
		const roundRes = await scanV2(
			user,
			{
				bottle_no: currentBottleNo,
				cursor: currentScanCursor,
				reconcile_anomalies: true,
				reconcile_types: RECONCILE_TYPE_LIST,
				batch_size: batchSize,
				max_events_per_round: maxEventsPerRound,
				max_ms_per_round: remainingMs,
				max_writes_per_round: maxWritesPerRound
			},
			requestId
		)
		if (roundRes?.code !== 0) return roundRes

		const payload = roundRes.data || {}
		roundScannedEvents += Number(payload.round_scanned_events || 0)
		roundCreated += Number(payload.round_created || 0)
		roundResolvedStale += Number(payload.round_resolved_stale || 0)
		roundBottles += 1

		if (payload.done) {
			bottleAfter = currentBottleNo
			currentBottleNo = ''
			currentScanCursor = null
			if (roundCreated + roundResolvedStale >= maxWritesPerRound) break
			continue
		}

		currentScanCursor = payload.cursor || null
		break
	}

	if (currentBottleNo) done = false
	if (isTimeExceeded()) done = false

	const cursor = buildRebuildCursor({
		done,
		bottleAfter,
		currentBottleNo,
		currentScanCursor
	})
	const elapsedMs = Date.now() - startedAt

	await recordLog(
		user,
		'bottle_anomaly_rebuild_v2',
		{
			done,
			has_cursor: Boolean(cursor),
			round_bottles: roundBottles,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			elapsed_ms: elapsedMs
		},
		requestId
	)

	return {
		code: 0,
		data: {
			done,
			cursor,
			round_bottles: roundBottles,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			elapsed_ms: elapsedMs
		}
	}
}

async function touchV2(user, data, requestId) {
	const bottleNos = normalizeBottleNoList(data.bottle_nos || data.bottleNos, 200)
	if (!bottleNos.length) return { code: 400, msg: 'bottle_nos 必填' }

	const batchSize = clampNumber(data.batch_size, 20, 500, 120)
	const maxEventsPerRound = clampNumber(data.max_events_per_round, 50, 4000, 800)
	const maxMsPerRound = clampNumber(data.max_ms_per_round, 400, 8000, 2200)
	const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 800, 120)

	const startedAt = Date.now()
	const isTimeExceeded = () => Date.now() - startedAt >= maxMsPerRound

	let scannedBottles = 0
	let roundScannedEvents = 0
	let roundCreated = 0
	let roundResolvedStale = 0
	let done = true

	for (const bottleNo of bottleNos) {
		if (isTimeExceeded()) {
			done = false
			break
		}
		const remainingMs = Math.max(maxMsPerRound - (Date.now() - startedAt), 400)
		const res = await scanV2(
			user,
			{
				bottle_no: bottleNo,
				reconcile_anomalies: true,
				reconcile_types: RECONCILE_TYPE_LIST,
				batch_size: batchSize,
				max_events_per_round: maxEventsPerRound,
				max_ms_per_round: remainingMs,
				max_writes_per_round: maxWritesPerRound
			},
			requestId
		)
		if (res?.code !== 0) return res
		const payload = res.data || {}
		scannedBottles += 1
		roundScannedEvents += Number(payload.round_scanned_events || 0)
		roundCreated += Number(payload.round_created || 0)
		roundResolvedStale += Number(payload.round_resolved_stale || 0)
		if (!payload.done) done = false
	}

	if (scannedBottles < bottleNos.length) done = false

	await recordLog(
		user,
		'bottle_anomaly_touch_v2',
		{
			done,
			input_bottles: bottleNos.length,
			scanned_bottles: scannedBottles,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale
		},
		requestId
	)

	return {
		code: 0,
		data: {
			scanned_bottles: scannedBottles,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			done
		}
	}
}

async function resolveMissingFill(user, anomaly) {
	const ctx = anomaly.context || {}
	const lastBack = ctx.last_back || {}
	const nextOut = ctx.next_out || {}
	const lastBackNet = toNumber(lastBack.net, null)
	const nextOutNet = toNumber(nextOut.net, null)
	if (lastBackNet == null || nextOutNet == null) {
		return { code: 400, msg: '缺少净重，无法修复' }
	}
	const diff = nextOutNet - lastBackNet
	const abs = Math.abs(diff)
	if (abs > MISSING_FILL_THRESHOLD_KG) {
		return { code: 400, msg: `净重差值为 ${abs.toFixed(1)} kg，超过${MISSING_FILL_THRESHOLD_KG}kg，请先人工处理` }
	}
	if (diff > 0) {
		return { code: 400, msg: `净重差值为 +${diff.toFixed(1)} kg（增重），需补灌装后再修复` }
	}

	const now = Date.now()
	const date = normalizeString(anomaly.date || nextOut.date || lastBack.date)
	const diffRounded = Math.round(diff * 1000) / 1000
	let lossKg = 0
	if (diff < 0) {
		const loss = Math.abs(diff)
		lossKg = Math.round(loss * 1000) / 1000
		const eventDay = normalizeEventDay(date, now)
		const eventAt = parseEventAt(date, now)
		await movements.add({
			bottle_no: normalizeBottleNo(anomaly.bottle_no),
			type: 'adjust',
			date,
			event_day: eventDay,
			event_at: eventAt,
			type_order: movementTypeOrder('adjust'),
			source_type: 'manual_fix',
			source_id: null,
			customer_id: null,
			customer_name: '',
			net_weight: null,
			loss_weight: loss,
			adjust_reason: 'missing_fill_loss_accept',
			note: `缺灌装差值损耗 ${loss.toFixed(1)}kg`,
			created_at: now,
			created_by: user?._id || null,
			created_by_name: user?.username || ''
		})
	}

	return {
		code: 0,
		msg: '缺灌装已修复',
		resolution: buildMissingFillResolutionContext(diffRounded, lossKg, now)
	}
}

async function resolveV1(user, data, requestId) {
	const id = normalizeString(data.id)
	if (!id) return { code: 400, msg: 'id 必填' }

	const res = await anomalies.doc(id).get()
	const anomaly = (res.data && res.data[0]) || null
	if (!anomaly) return { code: 404, msg: '异常不存在' }

	if (anomaly.status === 'resolved') return { code: 0, msg: '已修复' }

	let nextContext = normalizeContext(anomaly.context)
	if (anomaly.anomaly_type === 'missing_fill') {
		const fix = await resolveMissingFill(user, anomaly)
		if (fix.code !== 0) return fix
		nextContext = {
			...nextContext,
			resolution: normalizeContext(fix.resolution)
		}
	}

	await anomalies.doc(id).update({
		status: 'resolved',
		updated_at: Date.now(),
		resolved_by: user?._id || null,
		resolved_by_name: user?.username || '',
		context: nextContext
	})

	await recordLog(user, 'bottle_anomaly_resolve_v1', { id }, requestId)
	return { code: 0, msg: '已标记为修复' }
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
	if (action === 'typesV1') return typesV1(user, data)
	if (action === 'scanV2') return scanV2(user, data, requestId)
	if (action === 'rebuildV2') return rebuildV2(user, data, requestId)
	if (action === 'touchV2') return touchV2(user, data, requestId)
	if (action === 'resolveV1') return resolveV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
