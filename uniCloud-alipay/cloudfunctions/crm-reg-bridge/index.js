'use strict'

const crypto = require('crypto')

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const bottles = db.collection('crm_bottles')
const fillings = db.collection('crm_fillings')
const movements = db.collection('crm_bottle_movements')
const outbox = db.collection('crm_reg_outbox')
const pushLogs = db.collection('crm_reg_push_logs')
const deadLetters = db.collection('crm_reg_dead_letters')

const MEDIUM_CODE_LABEL_MAP = {
	LNG: '天然气',
	LPG: '液化石油气',
	O2: '氧气',
	N2: '氮气',
	Ar: '氩气',
	OTHER: '其他'
}

const LOCATION_LABEL_MAP = {
	unknown: '状态待确认',
	in_station: '站内',
	at_customer: '客户处',
	scrapped: '已报废',
	lost: '已丢失'
}

const RETRY_DELAYS_MS = [
	60 * 1000,
	5 * 60 * 1000,
	15 * 60 * 1000,
	60 * 60 * 1000,
	6 * 60 * 60 * 1000,
	24 * 60 * 60 * 1000,
	24 * 60 * 60 * 1000
]

const SUPERADMIN_ONLY_ACTIONS = new Set([
	'dispatchOutboxV1',
	'bootstrapSnapshotV1',
	'replayDeadV1',
	'getSyncStatsV1'
])
const SIGN_VERSION = 'v1'
const SIGN_ALGORITHM = 'HMAC-SHA256'

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
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

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function safeJsonParse(text, fallback = null) {
	if (!text) return fallback
	try {
		return JSON.parse(text)
	} catch (err) {
		return fallback
	}
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function createNonce() {
	return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function sha256Hex(text) {
	return crypto.createHash('sha256').update(String(text || '')).digest('hex')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', String(key || '')).update(String(text || '')).digest('hex')
}

function normalizeGasMediumCode(value, fallback = 'LNG') {
	const code = normalizeString(value).toUpperCase()
	if (Object.prototype.hasOwnProperty.call(MEDIUM_CODE_LABEL_MAP, code)) return code
	const fb = normalizeString(fallback).toUpperCase()
	if (Object.prototype.hasOwnProperty.call(MEDIUM_CODE_LABEL_MAP, fb)) return fb
	return 'LNG'
}

function resolveLocationLabel(status) {
	const key = normalizeString(status)
	return LOCATION_LABEL_MAP[key] || LOCATION_LABEL_MAP.unknown
}

function normalizeEventType(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'fill' || text === 'out' || text === 'back' || text === 'profile_update') return text
	return ''
}

function normalizeMovementType(value) {
	const text = normalizeString(value)
	if (text === 'fill' || text === 'out' || text === 'back') return text
	return ''
}

function parseEventAtByDate(dateText, fallbackTs = Date.now()) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
	if (m) {
		const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}+08:00`)
		if (Number.isFinite(ts) && ts > 0) return ts
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return toNumber(fallbackTs, Date.now())
}

function normalizeUniqueBottleNos(input) {
	const raw = Array.isArray(input)
		? input
		: normalizeString(input)
			? [input]
			: []
	const set = new Set()
	const out = []
	for (let i = 0; i < raw.length; i += 1) {
		const bottleNo = normalizeBottleNo(raw[i])
		if (!bottleNo || set.has(bottleNo)) continue
		set.add(bottleNo)
		out.push(bottleNo)
	}
	return out
}

function normalizeSourceType(value, fallback = 'manual') {
	const text = normalizeString(value)
	if (!text) return fallback
	return text
}

function buildIdempotencyKey({ stationId, payloadType, sourceType, sourceId, bottleNo, eventAt, index = 0 }) {
	const parts = [
		normalizeString(stationId),
		normalizeString(payloadType),
		normalizeString(sourceType),
		normalizeString(sourceId),
		normalizeBottleNo(bottleNo),
		String(toNumber(eventAt, 0)),
		String(toNumber(index, 0))
	]
	return sha256Hex(parts.join('|'))
}

function resolveRetryDelayMs(retryCount) {
	const normalized = Math.max(toNumber(retryCount, 1), 1)
	const idx = Math.min(normalized - 1, RETRY_DELAYS_MS.length - 1)
	return RETRY_DELAYS_MS[idx]
}

function buildRegConfig(overrides = {}) {
	const endpointOverride = normalizeString(overrides.endpoint || overrides.reg_endpoint || overrides.regEndpoint)
	const keyIdOverride = normalizeString(overrides.key_id || overrides.keyId || overrides.reg_key_id || overrides.regKeyId)
	const secretOverride = normalizeString(overrides.secret || overrides.reg_secret || overrides.regSecret)
	const stationIdOverride = normalizeString(overrides.station_id || overrides.stationId || overrides.reg_station_id || overrides.regStationId)
	const stationNameOverride = normalizeString(overrides.station_name || overrides.stationName || overrides.reg_station_name || overrides.regStationName)
	const mediumOverride = normalizeString(overrides.default_medium_code || overrides.defaultMediumCode || overrides.reg_default_medium_code || overrides.regDefaultMediumCode)
	const timeoutOverride = toNumber(overrides.timeout_ms || overrides.timeoutMs || overrides.reg_timeout_ms || overrides.regTimeoutMs, null)
	const maxRetriesOverride = toNumber(overrides.max_retries || overrides.maxRetries || overrides.reg_max_retries || overrides.regMaxRetries, null)
	const timeoutMs = Math.min(Math.max(toNumber(process.env.REG_TIMEOUT_MS, 8000), 1000), 30000)
	const maxRetries = Math.min(Math.max(toNumber(process.env.REG_MAX_RETRIES, 7), 1), 20)
	return {
		endpoint: endpointOverride || normalizeString(process.env.REG_ENDPOINT),
		keyId: keyIdOverride || normalizeString(process.env.REG_KEY_ID),
		secret: secretOverride || normalizeString(process.env.REG_SECRET),
		defaultStationId: stationIdOverride || normalizeString(process.env.REG_STATION_ID),
		defaultStationName: stationNameOverride || normalizeString(process.env.REG_STATION_NAME) || '未命名站点',
		defaultMediumCode: normalizeGasMediumCode(mediumOverride || process.env.REG_DEFAULT_MEDIUM_CODE || 'LNG', 'LNG'),
		timeoutMs: timeoutOverride != null ? Math.min(Math.max(timeoutOverride, 1000), 30000) : timeoutMs,
		maxRetries: maxRetriesOverride != null ? Math.min(Math.max(maxRetriesOverride, 1), 20) : maxRetries
	}
}

function isSuperAdmin(user) {
	if (!user) return false
	const role = normalizeRole(user.role)
	const roleTemplate = normalizeRole(user.role_template)
	return role === 'superadmin' || roleTemplate === 'superadmin'
}

function isSafetyInspector(user) {
	if (!user) return false
	return (
		normalizeRole(user.role) === 'safety_inspector' ||
		normalizeRole(user.role_template) === 'safety_inspector'
	)
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
		console.error('[crm-reg-bridge] recordLog failed', action, err)
	}
}

async function fetchBottleDocsByNos(bottleNos = []) {
	const out = []
	const chunkSize = 80
	for (let i = 0; i < bottleNos.length; i += chunkSize) {
		const chunk = bottleNos.slice(i, i + chunkSize)
		const res = await bottles
			.where({ bottle_no: dbCmd.in(chunk) })
			.field({
				_id: true,
				bottle_no: true,
				product_no: true,
				gas_medium_code: true,
				manufacturer: true,
				manufacture_date: true,
				equipment_type: true,
				volume_l: true,
				filling_company: true,
				bottle_check_date: true,
				bottle_next_check_date: true,
				status: true,
				current_customer_name: true,
				station_id: true,
				is_active: true,
				updated_at: true
			})
			.limit(chunk.length)
			.get()
		out.push(...((res && res.data) || []))
	}
	return out
}

function compareFillingDesc(left = {}, right = {}) {
	const leftDate = normalizeString(left && left.date)
	const rightDate = normalizeString(right && right.date)
	if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
	const leftCreated = toNumber(left && left.created_at, 0)
	const rightCreated = toNumber(right && right.created_at, 0)
	if (leftCreated !== rightCreated) return rightCreated - leftCreated
	return normalizeString(right && right._id).localeCompare(normalizeString(left && left._id))
}

async function fetchLatestFillMapByBottleNos(bottleNos = []) {
	const map = new Map()
	if (!bottleNos.length) return map
	const chunkSize = 80
	for (let i = 0; i < bottleNos.length; i += chunkSize) {
		const chunk = bottleNos.slice(i, i + chunkSize)
		let page = 0
		const pageSize = 200
		while (true) {
			const res = await fillings
				.where({
					bottle_no: dbCmd.in(chunk),
					record_type: dbCmd.in(['normal_fill', 'truck_out_agent_sale'])
				})
				.field({
					_id: true,
					bottle_no: true,
					date: true,
					fill_weight: true,
					operator: true,
					record_type: true,
					created_at: true,
					updated_at: true
				})
				.orderBy('date', 'desc')
				.orderBy('created_at', 'desc')
				.skip(page * pageSize)
				.limit(pageSize)
				.get()
			const rows = (res && res.data) || []
			if (!rows.length) break
			for (let j = 0; j < rows.length; j += 1) {
				const row = rows[j]
				const bottleNo = normalizeBottleNo(row && row.bottle_no)
				if (!bottleNo) continue
				const prev = map.get(bottleNo)
				if (!prev || compareFillingDesc(row, prev) < 0) map.set(bottleNo, row)
			}
			if (rows.length < pageSize) break
			page += 1
		}
	}
	return map
}

async function fetchMovementRowsBySource({ sourceType, sourceId, bottleNos = [], eventType = '' }) {
	const normalizedSourceType = normalizeSourceType(sourceType, '')
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceType || !normalizedSourceId) return []
	const whereParts = [
		{ source_type: normalizedSourceType },
		{ source_id: normalizedSourceId },
		{ type: dbCmd.in(['fill', 'out', 'back']) }
	]
	const movementType = normalizeEventType(eventType)
	if (movementType && movementType !== 'profile_update') {
		whereParts.push({ type: movementType })
	}
	if (Array.isArray(bottleNos) && bottleNos.length) {
		whereParts.push({ bottle_no: dbCmd.in(bottleNos) })
	}
	const where = whereParts.length > 1 ? dbCmd.and(whereParts) : whereParts[0]
	const out = []
	let page = 0
	const pageSize = 200
	while (true) {
		const res = await movements
			.where(where)
			.field({
				_id: true,
				bottle_no: true,
				type: true,
				date: true,
				event_day: true,
				event_at: true,
				source_type: true,
				source_id: true,
				customer_id: true,
				customer_name: true,
				net_weight: true,
				note: true,
				created_at: true,
				updated_at: true
			})
			.orderBy('event_at', 'asc')
			.orderBy('created_at', 'asc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const rows = (res && res.data) || []
		if (!rows.length) break
		out.push(...rows)
		if (rows.length < pageSize) break
		page += 1
	}
	return out
}

function buildSnapshotPayload({ bottleDoc, latestFill, sourceType, sourceId, eventAt, config }) {
	const bottleNo = normalizeBottleNo(bottleDoc && bottleDoc.bottle_no)
	const stationId = normalizeString((bottleDoc && bottleDoc.station_id) || config.defaultStationId)
	const stationName = normalizeString(config.defaultStationName)
	const mediumCode = normalizeGasMediumCode(bottleDoc && bottleDoc.gas_medium_code, config.defaultMediumCode)
	const effectiveEventAt = toNumber(eventAt, toNumber(bottleDoc && bottleDoc.updated_at, Date.now()))
	const lastFillAt = latestFill
		? parseEventAtByDate(latestFill.date, toNumber(latestFill.updated_at || latestFill.created_at, effectiveEventAt))
		: null
	return {
		schema_version: 'v1',
		payload_type: 'snapshot',
		station_id: stationId,
		station_name: stationName,
		event_at: effectiveEventAt,
		source_type: normalizeSourceType(sourceType, 'manual'),
		source_id: normalizeString(sourceId) || null,
		bottle_no: bottleNo,
		bottle: {
			id_no: normalizeString(bottleDoc && bottleDoc.product_no),
			inner_no: bottleNo,
			gas_medium_code: mediumCode,
			gas_medium_name: MEDIUM_CODE_LABEL_MAP[mediumCode] || MEDIUM_CODE_LABEL_MAP.OTHER,
			manufacturer: normalizeString(bottleDoc && bottleDoc.manufacturer),
			manufacture_date: normalizeString(bottleDoc && bottleDoc.manufacture_date),
			bottle_type: normalizeString(bottleDoc && bottleDoc.equipment_type),
			volume_l: toNumber(bottleDoc && bottleDoc.volume_l, null),
			property_owner_unit: normalizeString(bottleDoc && bottleDoc.filling_company),
			check_date: normalizeString(bottleDoc && bottleDoc.bottle_check_date),
			next_check_date: normalizeString(bottleDoc && bottleDoc.bottle_next_check_date)
		},
		trace: {
			last_fill_time: lastFillAt,
			last_fill_weight: latestFill ? toNumber(latestFill.fill_weight, null) : null,
			last_fill_operator: latestFill ? normalizeString(latestFill.operator) : '',
			fill_station: stationName,
			location_code: normalizeString(bottleDoc && bottleDoc.status) || 'unknown',
			location_label: resolveLocationLabel(bottleDoc && bottleDoc.status),
			location_customer_name: normalizeString(bottleDoc && bottleDoc.current_customer_name)
		}
	}
}

function buildEventPayloadFromMovement({ movementRow, bottleDoc, config }) {
	const bottleNo = normalizeBottleNo(movementRow && movementRow.bottle_no)
	const stationId = normalizeString((bottleDoc && bottleDoc.station_id) || config.defaultStationId)
	const stationName = normalizeString(config.defaultStationName)
	const mediumCode = normalizeGasMediumCode(bottleDoc && bottleDoc.gas_medium_code, config.defaultMediumCode)
	const eventType = normalizeMovementType(movementRow && movementRow.type)
	const eventAt = toNumber(movementRow && movementRow.event_at, parseEventAtByDate(movementRow && movementRow.date, Date.now()))
	return {
		schema_version: 'v1',
		payload_type: 'event',
		station_id: stationId,
		station_name: stationName,
		event_type: eventType,
		event_at: eventAt,
		source_type: normalizeSourceType(movementRow && movementRow.source_type, 'manual'),
		source_id: normalizeString(movementRow && movementRow.source_id) || null,
		bottle_no: bottleNo,
		gas_medium_code: mediumCode,
		gas_medium_name: MEDIUM_CODE_LABEL_MAP[mediumCode] || MEDIUM_CODE_LABEL_MAP.OTHER,
		event_data: {
			date: normalizeString(movementRow && movementRow.date),
			customer_id: normalizeString(movementRow && movementRow.customer_id) || null,
			customer_name: normalizeString(movementRow && movementRow.customer_name),
			net_weight: toNumber(movementRow && movementRow.net_weight, null),
			note: normalizeString(movementRow && movementRow.note)
		}
	}
}

function buildProfileUpdateEventPayload({ bottleDoc, sourceType, sourceId, eventAt, config }) {
	const bottleNo = normalizeBottleNo(bottleDoc && bottleDoc.bottle_no)
	const stationId = normalizeString((bottleDoc && bottleDoc.station_id) || config.defaultStationId)
	const stationName = normalizeString(config.defaultStationName)
	const mediumCode = normalizeGasMediumCode(bottleDoc && bottleDoc.gas_medium_code, config.defaultMediumCode)
	const effectiveEventAt = toNumber(eventAt, toNumber(bottleDoc && bottleDoc.updated_at, Date.now()))
	return {
		schema_version: 'v1',
		payload_type: 'event',
		station_id: stationId,
		station_name: stationName,
		event_type: 'profile_update',
		event_at: effectiveEventAt,
		source_type: normalizeSourceType(sourceType, 'manual'),
		source_id: normalizeString(sourceId) || null,
		bottle_no: bottleNo,
		gas_medium_code: mediumCode,
		gas_medium_name: MEDIUM_CODE_LABEL_MAP[mediumCode] || MEDIUM_CODE_LABEL_MAP.OTHER,
		event_data: {
			manufacturer: normalizeString(bottleDoc && bottleDoc.manufacturer),
			manufacture_date: normalizeString(bottleDoc && bottleDoc.manufacture_date),
			bottle_type: normalizeString(bottleDoc && bottleDoc.equipment_type),
			volume_l: toNumber(bottleDoc && bottleDoc.volume_l, null),
			property_owner_unit: normalizeString(bottleDoc && bottleDoc.filling_company),
			check_date: normalizeString(bottleDoc && bottleDoc.bottle_check_date),
			next_check_date: normalizeString(bottleDoc && bottleDoc.bottle_next_check_date),
			location_code: normalizeString(bottleDoc && bottleDoc.status) || 'unknown',
			location_customer_name: normalizeString(bottleDoc && bottleDoc.current_customer_name)
		}
	}
}

async function enqueueOutboxPayload({ payloadType, payload, idempotencyKey, sourceType, sourceId, bottleNo, eventAt, config, now }) {
	const stationId = normalizeString(payload && payload.station_id) || config.defaultStationId
	if (!stationId) {
		throw new Error('station_id 缺失，请先回填 crm_bottles.station_id 或配置 REG_STATION_ID')
	}
	payload.station_id = stationId
	const existingRes = await outbox
		.where({
			station_id: stationId,
			idempotency_key: idempotencyKey,
			status: dbCmd.in(['pending', 'retrying', 'sent'])
		})
		.field({ _id: true, status: true })
		.limit(1)
		.get()
	const existing = (existingRes && existingRes.data && existingRes.data[0]) || null
	if (existing) {
		return { enqueued: false, duplicated: true, outbox_id: normalizeString(existing._id), status: normalizeString(existing.status) }
	}

	const doc = {
		payload_type: normalizeString(payloadType),
		station_id: stationId,
		idempotency_key: normalizeString(idempotencyKey),
		schema_version: normalizeString(payload && payload.schema_version) || 'v1',
		payload,
		source_type: normalizeSourceType(sourceType, normalizeString(payload && payload.source_type) || 'manual'),
		source_id: normalizeString(sourceId || (payload && payload.source_id)) || null,
		bottle_no: normalizeBottleNo(bottleNo || (payload && payload.bottle_no)),
		event_at: toNumber(eventAt, toNumber(payload && payload.event_at, now)),
		status: 'pending',
		retry_count: 0,
		max_retries: config.maxRetries,
		next_retry_at: now,
		last_error_code: '',
		last_error_msg: '',
		last_response_status: null,
		last_response_code: null,
		last_response_msg: '',
		sent_at: null,
		created_at: now,
		updated_at: now
	}

	try {
		const res = await outbox.add(doc)
		return { enqueued: true, duplicated: false, outbox_id: normalizeString(res && res.id) }
	} catch (err) {
		const message = normalizeString(err && (err.message || err.errMsg || err.toString()))
		if (/duplicate|E11000/i.test(message)) {
			return { enqueued: false, duplicated: true, outbox_id: '', status: 'duplicate_key' }
		}
		throw err
	}
}

async function enqueueSnapshotsInternal({ bottleNos = [], sourceType = 'manual', sourceId = '', eventAt = Date.now(), preview = false, config }) {
	const normalizedNos = normalizeUniqueBottleNos(bottleNos)
	if (!normalizedNos.length) {
		return {
			total_input: 0,
			found_total: 0,
			missing_total: 0,
			enqueued_total: 0,
			duplicate_total: 0,
			preview_payloads: []
		}
	}
	const docs = await fetchBottleDocsByNos(normalizedNos)
	const docMap = new Map(docs.map((row) => [normalizeBottleNo(row && row.bottle_no), row]))
	const latestFillMap = await fetchLatestFillMapByBottleNos(normalizedNos)
	const now = Date.now()
	const summary = {
		total_input: normalizedNos.length,
		found_total: docs.length,
		missing_total: 0,
		enqueued_total: 0,
		duplicate_total: 0,
		preview_payloads: []
	}

	for (let i = 0; i < normalizedNos.length; i += 1) {
		const bottleNo = normalizedNos[i]
		const doc = docMap.get(bottleNo)
		if (!doc) {
			summary.missing_total += 1
			continue
		}
		const payload = buildSnapshotPayload({
			bottleDoc: doc,
			latestFill: latestFillMap.get(bottleNo) || null,
			sourceType,
			sourceId,
			eventAt,
			config
		})
		const idempotencyKey = buildIdempotencyKey({
			stationId: payload.station_id,
			payloadType: 'snapshot',
			sourceType: payload.source_type,
			sourceId: payload.source_id,
			bottleNo,
			eventAt: payload.event_at,
			index: 0
		})
		payload.idempotency_key = idempotencyKey
		if (preview) {
			if (summary.preview_payloads.length < 20) summary.preview_payloads.push(payload)
			continue
		}
		const enqueueRes = await enqueueOutboxPayload({
			payloadType: 'snapshot',
			payload,
			idempotencyKey,
			sourceType,
			sourceId,
			bottleNo,
			eventAt: payload.event_at,
			config,
			now
		})
		if (enqueueRes.enqueued) summary.enqueued_total += 1
		else if (enqueueRes.duplicated) summary.duplicate_total += 1
	}

	return summary
}

async function enqueueEventsInternal({
	sourceType = '',
	sourceId = '',
	eventType = '',
	bottleNos = [],
	eventAt = Date.now(),
	preview = false,
	enqueueSnapshot = true,
	config
}) {
	const normalizedEventType = normalizeEventType(eventType)
	const normalizedBottleNos = normalizeUniqueBottleNos(bottleNos)
	let movementRows = []
	if (normalizedEventType !== 'profile_update') {
		movementRows = await fetchMovementRowsBySource({
			sourceType,
			sourceId,
			bottleNos: normalizedBottleNos,
			eventType: normalizedEventType
		})
	}

	const movementBottleNos = movementRows.map((row) => normalizeBottleNo(row && row.bottle_no)).filter(Boolean)
	const targetBottleNos = Array.from(new Set([...normalizedBottleNos, ...movementBottleNos]))
	const bottleDocs = targetBottleNos.length ? await fetchBottleDocsByNos(targetBottleNos) : []
	const bottleMap = new Map(bottleDocs.map((row) => [normalizeBottleNo(row && row.bottle_no), row]))
	const now = Date.now()

	const eventPayloads = []
	if (normalizedEventType === 'profile_update') {
		for (let i = 0; i < targetBottleNos.length; i += 1) {
			const bottleNo = targetBottleNos[i]
			const bottleDoc = bottleMap.get(bottleNo)
			if (!bottleDoc) continue
			eventPayloads.push(
				buildProfileUpdateEventPayload({
					bottleDoc,
					sourceType,
					sourceId,
					eventAt,
					config
				})
			)
		}
	} else {
		for (let i = 0; i < movementRows.length; i += 1) {
			const row = movementRows[i]
			const bottleNo = normalizeBottleNo(row && row.bottle_no)
			const bottleDoc = bottleMap.get(bottleNo)
			if (!bottleNo) continue
			eventPayloads.push(
				buildEventPayloadFromMovement({
					movementRow: row,
					bottleDoc,
					config
				})
			)
		}
	}

	const summary = {
		total_event_payload: eventPayloads.length,
		enqueued_total: 0,
		duplicate_total: 0,
		missing_bottle_total: Math.max(targetBottleNos.length - bottleDocs.length, 0),
		preview_payloads: []
	}

	for (let i = 0; i < eventPayloads.length; i += 1) {
		const payload = eventPayloads[i]
		const bottleNo = normalizeBottleNo(payload && payload.bottle_no)
		const idempotencyKey = buildIdempotencyKey({
			stationId: payload.station_id,
			payloadType: 'event',
			sourceType: payload.source_type,
			sourceId: payload.source_id,
			bottleNo,
			eventAt: payload.event_at,
			index: i
		})
		payload.idempotency_key = idempotencyKey
		if (preview) {
			if (summary.preview_payloads.length < 20) summary.preview_payloads.push(payload)
			continue
		}
		const enqueueRes = await enqueueOutboxPayload({
			payloadType: 'event',
			payload,
			idempotencyKey,
			sourceType: payload.source_type,
			sourceId: payload.source_id,
			bottleNo,
			eventAt: payload.event_at,
			config,
			now
		})
		if (enqueueRes.enqueued) summary.enqueued_total += 1
		else if (enqueueRes.duplicated) summary.duplicate_total += 1
	}

	if (enqueueSnapshot && targetBottleNos.length) {
		summary.snapshot = await enqueueSnapshotsInternal({
			bottleNos: targetBottleNos,
			sourceType: normalizeSourceType(sourceType, 'manual'),
			sourceId,
			eventAt,
			preview,
			config
		})
	}

	return summary
}

async function postPayloadToRegulator({ payloadType, payload, config }) {
	if (!config.endpoint || !config.keyId || !config.secret) {
		return {
			ok: false,
			status: 0,
			responseCode: 500,
			responseMsg: '监管推送配置缺失',
			requestBodySha256: '',
			body: null,
			errorCode: 'missing_reg_config'
		}
	}

	const action = payloadType === 'snapshot' ? 'ingestSnapshotV1' : 'ingestEventV1'
	const body = { action, data: payload }
	const bodyText = JSON.stringify(body)
	const bodyHash = sha256Hex(bodyText)
	const timestamp = String(Date.now())
	const nonce = createNonce()
	const signInput = `${timestamp}\n${nonce}\n${bodyHash}\n`
	const signature = hmacSha256Hex(signInput, config.secret)
	const headers = {
		'content-type': 'application/json',
		'x-reg-station-id': normalizeString(payload && payload.station_id),
		'x-reg-key-id': config.keyId,
		'x-reg-timestamp': timestamp,
		'x-reg-nonce': nonce,
		'x-reg-signature': signature,
		'x-reg-sign-version': SIGN_VERSION,
		'x-reg-sign-alg': SIGN_ALGORITHM,
		'x-reg-body-sha256': bodyHash
	}
	const endpointText = normalizeString(config.endpoint)

	try {
		if (/^local:\/\//i.test(endpointText)) {
			const functionName = normalizeString(endpointText.replace(/^local:\/\//i, '')) || 'crm-reg-ingest'
			const invokeRes = await uniCloud.callFunction({
				name: functionName,
				data: {
					action,
					data: payload,
					headers,
					body: bodyText
				}
			})
			const bodyData = invokeRes && Object.prototype.hasOwnProperty.call(invokeRes, 'result')
				? invokeRes.result
				: invokeRes
			const responseCode = toNumber(bodyData && bodyData.code, null)
			const responseMsg = normalizeString(bodyData && bodyData.msg)
			const responseStatus = normalizeString(bodyData && bodyData.data && bodyData.data.status).toLowerCase()
			const ok = responseCode === 0 && (responseStatus === 'accepted' || responseStatus === 'repeated')
			return {
				ok,
				status: ok ? 200 : 500,
				responseCode,
				responseMsg,
				requestBodySha256: bodyHash,
				body: bodyData,
				errorCode: ok ? '' : (responseStatus === 'rejected' ? 'remote_rejected' : 'remote_failed')
			}
		}
		let status = 0
		let bodyData = null
		if (uniCloud.httpclient && typeof uniCloud.httpclient.request === 'function') {
			const res = await uniCloud.httpclient.request(config.endpoint, {
				method: 'POST',
				contentType: 'json',
				dataType: 'json',
				timeout: config.timeoutMs,
				headers,
				data: body
			})
			status = toNumber(res && (res.status || res.statusCode), 0)
			bodyData = res && res.data != null ? res.data : null
		} else if (typeof fetch === 'function') {
			const res = await fetch(config.endpoint, {
				method: 'POST',
				headers,
				body: bodyText
			})
			status = toNumber(res && res.status, 0)
			const text = await res.text()
			bodyData = safeJsonParse(text, { code: -1, msg: text })
		} else {
			return {
				ok: false,
				status: 0,
				responseCode: 500,
				responseMsg: '当前运行环境不支持 HTTP 请求',
				requestBodySha256: bodyHash,
				body: null,
				errorCode: 'http_not_supported'
			}
		}

		const responseCode = toNumber(bodyData && bodyData.code, null)
		const responseMsg = normalizeString(bodyData && bodyData.msg)
		const responseStatus = normalizeString(bodyData && bodyData.data && bodyData.data.status).toLowerCase()
		const ok = status >= 200 && status < 300 && responseCode === 0 && (responseStatus === 'accepted' || responseStatus === 'repeated')
		return {
			ok,
			status,
			responseCode,
			responseMsg,
			requestBodySha256: bodyHash,
			body: bodyData,
			errorCode: ok ? '' : (responseStatus === 'rejected' ? 'remote_rejected' : 'remote_failed')
		}
	} catch (err) {
		return {
			ok: false,
			status: 0,
			responseCode: 500,
			responseMsg: normalizeString(err && err.message) || '监管推送异常',
			requestBodySha256: bodyHash,
			body: null,
			errorCode: 'network_error'
		}
	}
}

async function writePushLog({ item, attemptNo, endpoint, requestBodySha256, pushResult }) {
	await pushLogs.add({
		outbox_id: normalizeString(item && item._id),
		station_id: normalizeString(item && item.station_id),
		payload_type: normalizeString(item && item.payload_type),
		idempotency_key: normalizeString(item && item.idempotency_key),
		attempt_no: toNumber(attemptNo, 1),
		endpoint: normalizeString(endpoint),
		request_body_sha256: normalizeString(requestBodySha256),
		response_status: pushResult && pushResult.status != null ? toNumber(pushResult.status, null) : null,
		response_code: pushResult && pushResult.responseCode != null ? toNumber(pushResult.responseCode, null) : null,
		response_msg: normalizeString(pushResult && pushResult.responseMsg),
		success: Boolean(pushResult && pushResult.ok),
		error_code: normalizeString(pushResult && pushResult.errorCode),
		error_msg: normalizeString(pushResult && pushResult.responseMsg),
		created_at: Date.now()
	})
}

async function moveToDeadLetter({ item, reasonCode, reasonMsg, retryCount, pushResult }) {
	const now = Date.now()
	await deadLetters.add({
		from_outbox_id: normalizeString(item && item._id) || null,
		station_id: normalizeString(item && item.station_id),
		payload_type: normalizeString(item && item.payload_type),
		idempotency_key: normalizeString(item && item.idempotency_key),
		payload: item && typeof item.payload === 'object' ? item.payload : {},
		reason_code: normalizeString(reasonCode) || 'dead_letter',
		reason_msg: normalizeString(reasonMsg),
		retry_count: toNumber(retryCount, 0),
		last_response_status: pushResult && pushResult.status != null ? toNumber(pushResult.status, null) : null,
		last_response_code: pushResult && pushResult.responseCode != null ? toNumber(pushResult.responseCode, null) : null,
		last_response_msg: normalizeString(pushResult && pushResult.responseMsg),
		resolved: false,
		replay_count: 0,
		last_replay_at: null,
		created_at: now,
		updated_at: now
	})
}

async function enqueueSnapshotV1(user, data, requestId) {
	void user
	const config = buildRegConfig(data)
	const bottleNos = normalizeUniqueBottleNos(data.bottle_nos || data.bottleNos || data.bottle_no || data.bottleNo)
	const preview = toBoolean(data.preview, false)
	if (!bottleNos.length) return { code: 400, msg: 'bottle_nos 必填' }
	const summary = await enqueueSnapshotsInternal({
		bottleNos,
		sourceType: normalizeSourceType(data.source_type || data.sourceType, 'manual'),
		sourceId: normalizeString(data.source_id || data.sourceId || requestId),
		eventAt: toNumber(data.event_at || data.eventAt, Date.now()),
		preview,
		config
	})
	await recordLog(user, 'reg_bridge_enqueue_snapshot_v1', {
		bottle_total: summary.total_input,
		found_total: summary.found_total,
		enqueued_total: summary.enqueued_total,
		duplicate_total: summary.duplicate_total,
		missing_total: summary.missing_total,
		preview
	}, requestId)
	return { code: 0, msg: preview ? '预览完成' : '入队完成', data: summary }
}

async function enqueueEventV1(user, data, requestId) {
	void user
	const config = buildRegConfig(data)
	const preview = toBoolean(data.preview, false)
	const summary = await enqueueEventsInternal({
		sourceType: normalizeSourceType(data.source_type || data.sourceType, 'manual'),
		sourceId: normalizeString(data.source_id || data.sourceId || requestId),
		eventType: normalizeString(data.event_type || data.eventType),
		bottleNos: data.bottle_nos || data.bottleNos || data.bottle_no || data.bottleNo,
		eventAt: toNumber(data.event_at || data.eventAt, Date.now()),
		preview,
		enqueueSnapshot: toBoolean(data.enqueue_snapshot ?? data.enqueueSnapshot, true),
		config
	})
	await recordLog(user, 'reg_bridge_enqueue_event_v1', {
		event_payload_total: summary.total_event_payload,
		enqueued_total: summary.enqueued_total,
		duplicate_total: summary.duplicate_total,
		missing_bottle_total: summary.missing_bottle_total,
		snapshot_enqueued_total: toNumber(summary.snapshot && summary.snapshot.enqueued_total, 0),
		preview
	}, requestId)
	return { code: 0, msg: preview ? '预览完成' : '入队完成', data: summary }
}

async function dispatchOutboxV1(user, data, requestId) {
	void user
	const config = buildRegConfig(data)
	const batchSize = Math.min(Math.max(toNumber(data.batch_size || data.batchSize, 30), 1), 200)
	const now = Date.now()
	const res = await outbox
		.where(dbCmd.and([
			{ status: dbCmd.in(['pending', 'retrying']) },
			{ next_retry_at: dbCmd.lte(now) }
		]))
		.orderBy('next_retry_at', 'asc')
		.orderBy('created_at', 'asc')
		.limit(batchSize)
		.get()
	const items = (res && res.data) || []
	const summary = {
		batch_size: batchSize,
		picked_total: items.length,
		sent_total: 0,
		retrying_total: 0,
		dead_total: 0,
		failed_total: 0,
		missing_config_total: 0
	}

	for (let i = 0; i < items.length; i += 1) {
		const item = items[i]
		const retryCount = toNumber(item && item.retry_count, 0)
		const maxRetries = Math.max(toNumber(item && item.max_retries, config.maxRetries), 1)
		const attemptNo = retryCount + 1
		const pushResult = await postPayloadToRegulator({
			payloadType: normalizeString(item && item.payload_type),
			payload: item && item.payload,
			config
		})
		await writePushLog({
			item,
			attemptNo,
			endpoint: config.endpoint,
			requestBodySha256: normalizeString(pushResult && pushResult.requestBodySha256),
			pushResult
		})
		if (pushResult.ok) {
			await outbox.doc(item._id).update({
				status: 'sent',
				retry_count: retryCount,
				sent_at: Date.now(),
				last_error_code: '',
				last_error_msg: '',
				last_response_status: toNumber(pushResult.status, null),
				last_response_code: toNumber(pushResult.responseCode, null),
				last_response_msg: normalizeString(pushResult.responseMsg),
				updated_at: Date.now()
			})
			summary.sent_total += 1
			continue
		}

		const nextRetryCount = retryCount + 1
		const canRetry = nextRetryCount < maxRetries
		if (!config.endpoint || !config.keyId || !config.secret) {
			summary.missing_config_total += 1
		}
		if (canRetry) {
			const nextRetryAt = Date.now() + resolveRetryDelayMs(nextRetryCount)
			await outbox.doc(item._id).update({
				status: 'retrying',
				retry_count: nextRetryCount,
				next_retry_at: nextRetryAt,
				last_error_code: normalizeString(pushResult.errorCode),
				last_error_msg: normalizeString(pushResult.responseMsg),
				last_response_status: toNumber(pushResult.status, null),
				last_response_code: toNumber(pushResult.responseCode, null),
				last_response_msg: normalizeString(pushResult.responseMsg),
				updated_at: Date.now()
			})
			summary.retrying_total += 1
		} else {
			await outbox.doc(item._id).update({
				status: 'dead',
				retry_count: nextRetryCount,
				last_error_code: normalizeString(pushResult.errorCode),
				last_error_msg: normalizeString(pushResult.responseMsg),
				last_response_status: toNumber(pushResult.status, null),
				last_response_code: toNumber(pushResult.responseCode, null),
				last_response_msg: normalizeString(pushResult.responseMsg),
				updated_at: Date.now()
			})
			await moveToDeadLetter({
				item,
				reasonCode: normalizeString(pushResult.errorCode) || 'max_retry_exceeded',
				reasonMsg: normalizeString(pushResult.responseMsg),
				retryCount: nextRetryCount,
				pushResult
			})
			summary.dead_total += 1
		}
		summary.failed_total += 1
	}

	await recordLog(user, 'reg_bridge_dispatch_outbox_v1', summary, requestId)
	return { code: 0, msg: '派发完成', data: summary }
}

async function bootstrapSnapshotV1(user, data, requestId) {
	void user
	const preview = toBoolean(data.preview, true)
	const onlyActive = toBoolean(data.only_active, true)
	const limit = Math.min(Math.max(toNumber(data.limit, 2000), 1), 10000)
	const config = buildRegConfig(data)

	const where = onlyActive ? { is_active: true } : {}
	const docs = []
	let page = 0
	const pageSize = 200
	while (docs.length < limit) {
		const rest = limit - docs.length
		const curLimit = Math.min(rest, pageSize)
		const res = await bottles
			.where(where)
			.field({
				_id: true,
				bottle_no: true,
				product_no: true,
				gas_medium_code: true,
				station_id: true,
				filling_company: true,
				manufacturer: true,
				manufacture_date: true,
				equipment_type: true,
				volume_l: true,
				bottle_check_date: true,
				bottle_next_check_date: true,
				status: true,
				current_customer_name: true,
				is_active: true,
				updated_at: true
			})
			.orderBy('updated_at', 'desc')
			.skip(page * pageSize)
			.limit(curLimit)
			.get()
		const rows = (res && res.data) || []
		if (!rows.length) break
		docs.push(...rows)
		if (rows.length < curLimit) break
		page += 1
	}

	const missingStationTotal = docs.filter((row) => !normalizeString(row && row.station_id)).length
	const missingMediumTotal = docs.filter((row) => !normalizeString(row && row.gas_medium_code)).length
	const bottleNos = docs.map((row) => normalizeBottleNo(row && row.bottle_no)).filter(Boolean)

	const enqueueSummary = await enqueueSnapshotsInternal({
		bottleNos,
		sourceType: 'bootstrap',
		sourceId: normalizeString(data.batch_id || data.batchId || requestId),
		eventAt: Date.now(),
		preview,
		config
	})

	const summary = {
		preview,
		only_active: onlyActive,
		scanned_total: docs.length,
		missing_station_total: missingStationTotal,
		missing_medium_total: missingMediumTotal,
		enqueue: enqueueSummary
	}

	await recordLog(user, preview ? 'reg_bridge_bootstrap_snapshot_preview_v1' : 'reg_bridge_bootstrap_snapshot_execute_v1', summary, requestId)
	return { code: 0, msg: preview ? '基线预览完成' : '基线入队完成', data: summary }
}

async function replayDeadV1(user, data, requestId) {
	void user
	const config = buildRegConfig(data)
	const stationId = normalizeString(data.station_id || data.stationId)
	const limit = Math.min(Math.max(toNumber(data.limit, 100), 1), 1000)
	const ids = Array.isArray(data.ids) ? data.ids.map((item) => normalizeString(item)).filter(Boolean) : []

	const conditions = [{ resolved: false }]
	if (stationId) conditions.push({ station_id: stationId })
	if (ids.length) conditions.push({ _id: dbCmd.in(ids) })
	const where = conditions.length > 1 ? dbCmd.and(conditions) : conditions[0]

	const res = await deadLetters.where(where).orderBy('created_at', 'asc').limit(limit).get()
	const rows = (res && res.data) || []
	let replayed = 0
	let duplicate = 0
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i]
		const payload = row && typeof row.payload === 'object' ? row.payload : {}
		const enqueueRes = await enqueueOutboxPayload({
			payloadType: normalizeString(row && row.payload_type),
			payload,
			idempotencyKey: normalizeString(row && row.idempotency_key),
			sourceType: normalizeSourceType(payload && payload.source_type, normalizeString(row && row.payload_type) || 'manual'),
			sourceId: normalizeString(payload && payload.source_id),
			bottleNo: normalizeBottleNo(payload && payload.bottle_no),
			eventAt: toNumber(payload && payload.event_at, Date.now()),
			config,
			now: Date.now()
		})
		if (enqueueRes.enqueued) replayed += 1
		else if (enqueueRes.duplicated) duplicate += 1
		await deadLetters.doc(row._id).update({
			resolved: true,
			replay_count: toNumber(row && row.replay_count, 0) + 1,
			last_replay_at: Date.now(),
			updated_at: Date.now()
		})
	}
	const summary = {
		selected_total: rows.length,
		replayed_total: replayed,
		duplicate_total: duplicate
	}
	await recordLog(user, 'reg_bridge_replay_dead_v1', summary, requestId)
	return { code: 0, msg: '重放完成', data: summary }
}

async function getSyncStatsV1(user, data, requestId) {
	void user
	void data
	const [pendingRes, retryingRes, sentRes, deadRes, deadLetterRes] = await Promise.all([
		outbox.where({ status: 'pending' }).count(),
		outbox.where({ status: 'retrying' }).count(),
		outbox.where({ status: 'sent' }).count(),
		outbox.where({ status: 'dead' }).count(),
		deadLetters.where({ resolved: false }).count()
	])
	const summary = {
		pending_total: toNumber(pendingRes && pendingRes.total, 0),
		retrying_total: toNumber(retryingRes && retryingRes.total, 0),
		sent_total: toNumber(sentRes && sentRes.total, 0),
		dead_total: toNumber(deadRes && deadRes.total, 0),
		dead_letter_open_total: toNumber(deadLetterRes && deadLetterRes.total, 0)
	}
	await recordLog(user, 'reg_bridge_get_sync_stats_v1', summary, requestId)
	return { code: 0, data: summary }
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event || {}
	const requestId =
		normalizeString(event && (event.request_id || event.requestId || context?.requestId || context?.request_id || '')) ||
		generateRequestId()
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	if (isSafetyInspector(user)) {
		return { code: 403, msg: '巡检员账号无权访问监管数据桥接服务' }
	}
	if (SUPERADMIN_ONLY_ACTIONS.has(action) && !isSuperAdmin(user)) {
		return { code: 403, msg: '仅超级管理员可执行该操作' }
	}

	if (action === 'enqueueSnapshotV1') return enqueueSnapshotV1(user, data, requestId)
	if (action === 'enqueueEventV1') return enqueueEventV1(user, data, requestId)
	if (action === 'dispatchOutboxV1') return dispatchOutboxV1(user, data, requestId)
	if (action === 'bootstrapSnapshotV1') return bootstrapSnapshotV1(user, data, requestId)
	if (action === 'replayDeadV1') return replayDeadV1(user, data, requestId)
	if (action === 'getSyncStatsV1') return getSyncStatsV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
