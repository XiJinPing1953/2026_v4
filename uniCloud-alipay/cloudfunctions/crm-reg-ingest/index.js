'use strict'

const crypto = require('crypto')

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const stationRegistry = db.collection('crm_reg_station_registry')
const bottleCurrent = db.collection('crm_reg_bottle_current')
const bottleEvents = db.collection('crm_reg_bottle_events')
const ingestDedup = db.collection('crm_reg_ingest_dedup')
const ingestLogs = db.collection('crm_reg_ingest_logs')
const deadLetters = db.collection('crm_reg_dead_letters')

const SCHEMA_VERSION = 'v1'
const SIGN_VERSION = 'v1'
const SIGN_ALGORITHM = 'HMAC-SHA256'
const DEFAULT_ALLOW_SKEW_MS = Math.min(Math.max(Number(process.env.REG_ALLOW_SKEW_MS || 5 * 60 * 1000), 30 * 1000), 30 * 60 * 1000)
const VALID_EVENT_TYPES = new Set(['fill', 'out', 'back', 'profile_update'])

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeSourceType(value, fallback = 'manual') {
	const text = normalizeString(value)
	return text || fallback
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function safeJsonParse(text, fallback = null) {
	if (!text || typeof text !== 'string') return fallback
	try {
		return JSON.parse(text)
	} catch (err) {
		return fallback
	}
}

function sha256Hex(text) {
	return crypto.createHash('sha256').update(String(text || '')).digest('hex')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', String(key || '')).update(String(text || '')).digest('hex')
}

function constantTimeHexEqual(left, right) {
	const leftText = normalizeString(left).toLowerCase()
	const rightText = normalizeString(right).toLowerCase()
	if (!leftText || !rightText) return false
	if (leftText.length !== rightText.length) return false
	const leftBuf = Buffer.from(leftText)
	const rightBuf = Buffer.from(rightText)
	return crypto.timingSafeEqual(leftBuf, rightBuf)
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function getHeaderValue(headers = {}, name = '') {
	const key = normalizeString(name).toLowerCase()
	if (!key) return ''
	const source = headers && typeof headers === 'object' ? headers : {}
	if (Object.prototype.hasOwnProperty.call(source, key)) return normalizeString(source[key])
	const direct = source[name]
	if (direct != null) return normalizeString(direct)
	for (const candidateKey of Object.keys(source)) {
		if (normalizeString(candidateKey).toLowerCase() === key) {
			return normalizeString(source[candidateKey])
		}
	}
	return ''
}

function resolveEventHeaders(event = {}) {
	const fromHeaders = event.headers && typeof event.headers === 'object' ? event.headers : null
	const fromHeader = event.header && typeof event.header === 'object' ? event.header : null
	if (fromHeaders) return fromHeaders
	if (fromHeader) return fromHeader
	return {}
}

function extractEnvelope(event = {}) {
	let action = normalizeString(event && event.action)
	let data = event && typeof event.data === 'object' ? event.data : null
	let rawBodyText = ''

	if (!data && typeof event?.data === 'string') {
		data = safeJsonParse(event.data, null)
	}

	if (event && event.body != null) {
		if (typeof event.body === 'string') {
			rawBodyText = event.body
			const parsed = safeJsonParse(event.body, null)
			if (parsed && typeof parsed === 'object') {
				if (!action) action = normalizeString(parsed.action)
				if (!data && parsed.data && typeof parsed.data === 'object') data = parsed.data
			}
		} else if (typeof event.body === 'object') {
			const parsedBody = event.body
			rawBodyText = JSON.stringify(parsedBody)
			if (!action) action = normalizeString(parsedBody && parsedBody.action)
			if (!data && parsedBody && parsedBody.data && typeof parsedBody.data === 'object') data = parsedBody.data
		}
	}

	if (!action && data && typeof data === 'object' && normalizeString(data.action)) {
		action = normalizeString(data.action)
		data = data.data && typeof data.data === 'object' ? data.data : data
	}
	if (!data || typeof data !== 'object') data = {}

	if (!rawBodyText) rawBodyText = JSON.stringify({ action, data })
	return { action, data, rawBodyText }
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

function resolveDedupKey(payload = {}, payloadType = '') {
	const explicit = normalizeString(payload && payload.idempotency_key)
	if (explicit) return explicit
	return buildIdempotencyKey({
		stationId: normalizeString(payload && payload.station_id),
		payloadType: normalizeString(payloadType || payload && payload.payload_type),
		sourceType: normalizeSourceType(payload && payload.source_type, 'manual'),
		sourceId: normalizeString(payload && payload.source_id),
		bottleNo: normalizeBottleNo(payload && payload.bottle_no),
		eventAt: toNumber(payload && payload.event_at, 0),
		index: toNumber(payload?.event_data?.index ?? payload?.event_data?.event_index, 0)
	})
}

function normalizePayloadTypeByAction(action = '') {
	const normalizedAction = normalizeString(action)
	if (normalizedAction === 'ingestSnapshotV1') return 'snapshot'
	if (normalizedAction === 'ingestEventV1') return 'event'
	return ''
}

async function getUserByToken(token) {
	const normalizedToken = normalizeString(token)
	if (!normalizedToken) return null
	const res = await users
		.where({ token: normalizedToken })
		.field({ _id: true, username: true, role: true, role_template: true })
		.limit(1)
		.get()
	return Array.isArray(res && res.data) ? res.data[0] || null : null
}

function isSuperAdmin(user) {
	if (!user) return false
	const role = normalizeRole(user.role)
	const roleTemplate = normalizeRole(user.role_template)
	return role === 'superadmin' || roleTemplate === 'superadmin'
}

function validateSnapshotPayload(payload = {}) {
	if (normalizeString(payload.schema_version) !== SCHEMA_VERSION) return { ok: false, reasonCode: 'invalid_schema_version', reasonMsg: 'schema_version 必须为 v1' }
	if (normalizeString(payload.payload_type) !== 'snapshot') return { ok: false, reasonCode: 'invalid_payload_type', reasonMsg: 'payload_type 必须为 snapshot' }
	if (!normalizeString(payload.station_id)) return { ok: false, reasonCode: 'missing_station_id', reasonMsg: 'station_id 必填' }
	if (!normalizeBottleNo(payload.bottle_no)) return { ok: false, reasonCode: 'missing_bottle_no', reasonMsg: 'bottle_no 必填' }
	if (!payload.bottle || typeof payload.bottle !== 'object') return { ok: false, reasonCode: 'missing_bottle', reasonMsg: 'bottle 对象必填' }
	if (!payload.trace || typeof payload.trace !== 'object') return { ok: false, reasonCode: 'missing_trace', reasonMsg: 'trace 对象必填' }
	return { ok: true }
}

function validateEventPayload(payload = {}) {
	if (normalizeString(payload.schema_version) !== SCHEMA_VERSION) return { ok: false, reasonCode: 'invalid_schema_version', reasonMsg: 'schema_version 必须为 v1' }
	if (normalizeString(payload.payload_type) !== 'event') return { ok: false, reasonCode: 'invalid_payload_type', reasonMsg: 'payload_type 必须为 event' }
	if (!normalizeString(payload.station_id)) return { ok: false, reasonCode: 'missing_station_id', reasonMsg: 'station_id 必填' }
	if (!normalizeBottleNo(payload.bottle_no)) return { ok: false, reasonCode: 'missing_bottle_no', reasonMsg: 'bottle_no 必填' }
	const eventType = normalizeString(payload.event_type)
	if (!VALID_EVENT_TYPES.has(eventType)) return { ok: false, reasonCode: 'invalid_event_type', reasonMsg: 'event_type 无效' }
	return { ok: true }
}

async function resolveStationKeys(stationId, keyId) {
	const normalizedStationId = normalizeString(stationId)
	const normalizedKeyId = normalizeString(keyId)
	if (!normalizedStationId) return { ok: false, reasonCode: 'missing_station_id', reasonMsg: '请求头缺少 x-reg-station-id' }
	if (!normalizedKeyId) return { ok: false, reasonCode: 'missing_key_id', reasonMsg: '请求头缺少 x-reg-key-id' }
	const res = await stationRegistry
		.where({
			station_id: normalizedStationId,
			is_active: true
		})
		.field({
			_id: true,
			station_id: true,
			station_name: true,
			key_id: true,
			secret: true,
			allow_skew_ms: true
		})
		.limit(20)
		.get()
	const rows = Array.isArray(res && res.data) ? res.data : []
	if (!rows.length) {
		return { ok: false, reasonCode: 'station_not_registered', reasonMsg: '站点未注册或未启用' }
	}
	const matched = rows.filter((row) => normalizeString(row && row.key_id) === normalizedKeyId)
	if (!matched.length) {
		return { ok: false, reasonCode: 'key_not_active', reasonMsg: 'key_id 未启用或不匹配' }
	}
	const skewCandidates = matched
		.map((row) => toNumber(row && row.allow_skew_ms, 0))
		.filter((num) => num > 0)
	const allowSkewMs = skewCandidates.length ? Math.max(...skewCandidates) : DEFAULT_ALLOW_SKEW_MS
	return {
		ok: true,
		keys: matched,
		allowSkewMs,
		stationId: normalizedStationId
	}
}

async function verifySignedRequest({ action, payload, rawBodyText, headers }) {
	const stationId = getHeaderValue(headers, 'x-reg-station-id') || normalizeString(payload && payload.station_id)
	const keyId = getHeaderValue(headers, 'x-reg-key-id')
	const timestampText = getHeaderValue(headers, 'x-reg-timestamp')
	const nonce = getHeaderValue(headers, 'x-reg-nonce')
	const signature = getHeaderValue(headers, 'x-reg-signature')
	const signVersion = getHeaderValue(headers, 'x-reg-sign-version')
	const signAlg = getHeaderValue(headers, 'x-reg-sign-alg')
	const bodySha256 = getHeaderValue(headers, 'x-reg-body-sha256')
	const verifyKeyRes = await resolveStationKeys(stationId, keyId)
	if (!verifyKeyRes.ok) return verifyKeyRes
	if (!timestampText) return { ok: false, reasonCode: 'missing_timestamp', reasonMsg: '请求头缺少 x-reg-timestamp' }
	if (!nonce) return { ok: false, reasonCode: 'missing_nonce', reasonMsg: '请求头缺少 x-reg-nonce' }
	if (!signature) return { ok: false, reasonCode: 'missing_signature', reasonMsg: '请求头缺少 x-reg-signature' }
	if (normalizeString(signVersion) !== SIGN_VERSION) {
		return { ok: false, reasonCode: 'invalid_sign_version', reasonMsg: `x-reg-sign-version 必须为 ${SIGN_VERSION}` }
	}
	if (normalizeString(signAlg).toUpperCase() !== SIGN_ALGORITHM) {
		return { ok: false, reasonCode: 'invalid_sign_algorithm', reasonMsg: `x-reg-sign-alg 必须为 ${SIGN_ALGORITHM}` }
	}

	const requestTs = toNumber(timestampText, 0)
	if (!(requestTs > 0)) return { ok: false, reasonCode: 'invalid_timestamp', reasonMsg: 'x-reg-timestamp 非法' }
	const now = Date.now()
	if (Math.abs(now - requestTs) > verifyKeyRes.allowSkewMs) {
		return { ok: false, reasonCode: 'timestamp_out_of_window', reasonMsg: '请求时间超出允许窗口' }
	}

	const effectiveBodyText = normalizeString(rawBodyText) || JSON.stringify({ action, data: payload })
	const computedBodyHash = sha256Hex(effectiveBodyText)
	if (bodySha256 && !constantTimeHexEqual(bodySha256, computedBodyHash)) {
		return { ok: false, reasonCode: 'body_hash_mismatch', reasonMsg: '请求体摘要校验失败' }
	}
	const signInput = `${requestTs}\n${nonce}\n${computedBodyHash}\n`
	let pass = false
	for (let i = 0; i < verifyKeyRes.keys.length; i += 1) {
		const row = verifyKeyRes.keys[i]
		const expect = hmacSha256Hex(signInput, normalizeString(row && row.secret))
		if (constantTimeHexEqual(expect, signature)) {
			pass = true
			break
		}
	}
	if (!pass) return { ok: false, reasonCode: 'signature_mismatch', reasonMsg: '签名校验失败' }

	return {
		ok: true,
		stationId: verifyKeyRes.stationId,
		requestBodySha256: computedBodyHash
	}
}

async function reserveDedup({ stationId, payloadType, dedupKey, requestId }) {
	const now = Date.now()
	try {
		const res = await ingestDedup.add({
			station_id: normalizeString(stationId),
			payload_type: normalizeString(payloadType),
			dedup_key: normalizeString(dedupKey),
			status: 'processing',
			request_id: normalizeString(requestId),
			created_at: now,
			updated_at: now
		})
		return { accepted: true, repeated: false, dedupId: normalizeString(res && res.id) }
	} catch (err) {
		const msg = normalizeString(err && (err.message || err.errMsg || err.toString()))
		if (!/duplicate|E11000/i.test(msg)) throw err
		const existedRes = await ingestDedup
			.where({ dedup_key: normalizeString(dedupKey) })
			.field({ _id: true, status: true })
			.limit(1)
			.get()
		const existed = Array.isArray(existedRes && existedRes.data) ? existedRes.data[0] : null
		return {
			accepted: false,
			repeated: true,
			dedupId: normalizeString(existed && existed._id),
			existingStatus: normalizeString(existed && existed.status) || 'accepted'
		}
	}
}

async function markDedupAccepted(dedupId) {
	const id = normalizeString(dedupId)
	if (!id) return
	await ingestDedup.doc(id).update({
		status: 'accepted',
		updated_at: Date.now()
	})
}

async function writeIngestLog({
	stationId,
	payloadType,
	dedupKey,
	status,
	reasonCode,
	reasonMsg,
	requestId,
	requestBodySha256,
	payload
}) {
	await ingestLogs.add({
		station_id: normalizeString(stationId),
		payload_type: normalizeString(payloadType),
		dedup_key: normalizeString(dedupKey),
		status: normalizeString(status),
		reason_code: normalizeString(reasonCode),
		reason_msg: normalizeString(reasonMsg),
		request_id: normalizeString(requestId),
		request_body_sha256: normalizeString(requestBodySha256),
		source_type: normalizeSourceType(payload && payload.source_type, ''),
		source_id: normalizeString(payload && payload.source_id) || null,
		bottle_no: normalizeBottleNo(payload && payload.bottle_no),
		event_at: payload && payload.event_at != null ? toNumber(payload.event_at, null) : null,
		created_at: Date.now()
	})
}

async function writeRejectDeadLetter({
	stationId,
	payloadType,
	dedupKey,
	payload,
	reasonCode,
	reasonMsg
}) {
	const now = Date.now()
	await deadLetters.add({
		from_outbox_id: null,
		station_id: normalizeString(stationId),
		payload_type: normalizeString(payloadType),
		idempotency_key: normalizeString(dedupKey),
		payload: payload && typeof payload === 'object' ? payload : {},
		reason_code: normalizeString(reasonCode),
		reason_msg: normalizeString(reasonMsg),
		retry_count: 0,
		last_response_status: null,
		last_response_code: 0,
		last_response_msg: normalizeString(reasonMsg),
		resolved: false,
		replay_count: 0,
		last_replay_at: null,
		created_at: now,
		updated_at: now
	})
}

function buildEventTracePatch(payload = {}) {
	const eventType = normalizeString(payload && payload.event_type)
	const eventData = payload && payload.event_data && typeof payload.event_data === 'object' ? payload.event_data : {}
	const tracePatch = {
		fill_station: normalizeString(payload && payload.station_name)
	}
	if (eventType === 'fill') {
		tracePatch.last_fill_time = toNumber(payload.event_at, Date.now())
		tracePatch.last_fill_weight = toNumber(eventData.net_weight, null)
		tracePatch.last_fill_operator = normalizeString(eventData.operator)
		tracePatch.location_code = 'in_station'
		tracePatch.location_label = '站内'
		tracePatch.location_customer_name = ''
	}
	if (eventType === 'out') {
		tracePatch.location_code = 'at_customer'
		tracePatch.location_label = '客户处'
		tracePatch.location_customer_name = normalizeString(eventData.customer_name)
	}
	if (eventType === 'back') {
		tracePatch.location_code = 'in_station'
		tracePatch.location_label = '站内'
		tracePatch.location_customer_name = ''
	}
	if (eventType === 'profile_update') {
		tracePatch.location_code = normalizeString(eventData.location_code) || 'unknown'
		tracePatch.location_label = tracePatch.location_code === 'at_customer' ? '客户处' : '站内'
		tracePatch.location_customer_name = normalizeString(eventData.location_customer_name)
	}
	return tracePatch
}

function buildDefaultSnapshotFromEvent(payload = {}) {
	const eventData = payload && payload.event_data && typeof payload.event_data === 'object' ? payload.event_data : {}
	return {
		schema_version: SCHEMA_VERSION,
		payload_type: 'snapshot',
		station_id: normalizeString(payload && payload.station_id),
		station_name: normalizeString(payload && payload.station_name),
		event_at: toNumber(payload && payload.event_at, Date.now()),
		source_type: normalizeSourceType(payload && payload.source_type, 'manual'),
		source_id: normalizeString(payload && payload.source_id) || null,
		bottle_no: normalizeBottleNo(payload && payload.bottle_no),
		bottle: {
			id_no: '',
			inner_no: normalizeBottleNo(payload && payload.bottle_no),
			gas_medium_code: normalizeString(payload && payload.gas_medium_code),
			gas_medium_name: normalizeString(payload && payload.gas_medium_name),
			manufacturer: normalizeString(eventData.manufacturer),
			manufacture_date: normalizeString(eventData.manufacture_date),
			bottle_type: normalizeString(eventData.bottle_type),
			volume_l: toNumber(eventData.volume_l, null),
			property_owner_unit: normalizeString(eventData.property_owner_unit),
			check_date: normalizeString(eventData.check_date),
			next_check_date: normalizeString(eventData.next_check_date)
		},
		trace: {
			last_fill_time: null,
			last_fill_weight: null,
			last_fill_operator: '',
			fill_station: normalizeString(payload && payload.station_name),
			location_code: 'unknown',
			location_label: '状态待确认',
			location_customer_name: ''
		}
	}
}

async function upsertSnapshotPayload(payload = {}, payloadHash = '') {
	const stationId = normalizeString(payload && payload.station_id)
	const bottleNo = normalizeBottleNo(payload && payload.bottle_no)
	const now = Date.now()
	const existingRes = await bottleCurrent
		.where({ station_id: stationId, bottle_no: bottleNo })
		.field({ _id: true, created_at: true })
		.limit(1)
		.get()
	const existing = Array.isArray(existingRes && existingRes.data) ? existingRes.data[0] : null
	const patch = {
		station_id: stationId,
		bottle_no: bottleNo,
		schema_version: SCHEMA_VERSION,
		snapshot: payload,
		payload_hash: normalizeString(payloadHash),
		last_event_at: toNumber(payload && payload.event_at, null),
		last_event_type: 'snapshot',
		updated_at: now
	}
	if (existing && existing._id) {
		await bottleCurrent.doc(existing._id).update(patch)
		return
	}
	await bottleCurrent.add({
		...patch,
		created_at: now
	})
}

async function appendEventPayload(payload = {}, payloadHash = '', dedupKey = '') {
	const now = Date.now()
	await bottleEvents.add({
		station_id: normalizeString(payload && payload.station_id),
		bottle_no: normalizeBottleNo(payload && payload.bottle_no),
		event_type: normalizeString(payload && payload.event_type),
		event_at: toNumber(payload && payload.event_at, now),
		source_type: normalizeSourceType(payload && payload.source_type, 'manual'),
		source_id: normalizeString(payload && payload.source_id) || null,
		idempotency_key: normalizeString(dedupKey),
		schema_version: SCHEMA_VERSION,
		payload,
		payload_hash: normalizeString(payloadHash),
		created_at: now
	})
}

async function upsertBottleCurrentByEvent(payload = {}, payloadHash = '') {
	const stationId = normalizeString(payload && payload.station_id)
	const bottleNo = normalizeBottleNo(payload && payload.bottle_no)
	const now = Date.now()
	const existingRes = await bottleCurrent
		.where({ station_id: stationId, bottle_no: bottleNo })
		.field({ _id: true, snapshot: true })
		.limit(1)
		.get()
	const existing = Array.isArray(existingRes && existingRes.data) ? existingRes.data[0] : null
	const nextSnapshot = existing && existing.snapshot && typeof existing.snapshot === 'object'
		? { ...existing.snapshot }
		: buildDefaultSnapshotFromEvent(payload)

	nextSnapshot.schema_version = SCHEMA_VERSION
	nextSnapshot.payload_type = 'snapshot'
	nextSnapshot.station_id = stationId
	nextSnapshot.station_name = normalizeString(payload && payload.station_name) || normalizeString(nextSnapshot.station_name)
	nextSnapshot.event_at = toNumber(payload && payload.event_at, now)
	nextSnapshot.source_type = normalizeSourceType(payload && payload.source_type, normalizeString(nextSnapshot.source_type) || 'manual')
	nextSnapshot.source_id = normalizeString(payload && payload.source_id) || null
	nextSnapshot.bottle_no = bottleNo

	const nextBottle = nextSnapshot.bottle && typeof nextSnapshot.bottle === 'object' ? { ...nextSnapshot.bottle } : {}
	nextBottle.inner_no = bottleNo
	if (normalizeString(payload && payload.gas_medium_code)) nextBottle.gas_medium_code = normalizeString(payload.gas_medium_code)
	if (normalizeString(payload && payload.gas_medium_name)) nextBottle.gas_medium_name = normalizeString(payload.gas_medium_name)
	const eventData = payload && payload.event_data && typeof payload.event_data === 'object' ? payload.event_data : {}
	if (normalizeString(payload && payload.event_type) === 'profile_update') {
		if (normalizeString(eventData.manufacturer)) nextBottle.manufacturer = normalizeString(eventData.manufacturer)
		if (normalizeString(eventData.manufacture_date)) nextBottle.manufacture_date = normalizeString(eventData.manufacture_date)
		if (normalizeString(eventData.bottle_type)) nextBottle.bottle_type = normalizeString(eventData.bottle_type)
		if (eventData.volume_l != null) nextBottle.volume_l = toNumber(eventData.volume_l, null)
		if (normalizeString(eventData.property_owner_unit)) nextBottle.property_owner_unit = normalizeString(eventData.property_owner_unit)
		if (normalizeString(eventData.check_date)) nextBottle.check_date = normalizeString(eventData.check_date)
		if (normalizeString(eventData.next_check_date)) nextBottle.next_check_date = normalizeString(eventData.next_check_date)
	}
	nextSnapshot.bottle = nextBottle

	const nextTrace = nextSnapshot.trace && typeof nextSnapshot.trace === 'object' ? { ...nextSnapshot.trace } : {}
	Object.assign(nextTrace, buildEventTracePatch(payload))
	nextSnapshot.trace = nextTrace

	const patch = {
		station_id: stationId,
		bottle_no: bottleNo,
		schema_version: SCHEMA_VERSION,
		snapshot: nextSnapshot,
		payload_hash: normalizeString(payloadHash),
		last_event_at: toNumber(payload && payload.event_at, null),
		last_event_type: normalizeString(payload && payload.event_type),
		updated_at: now
	}
	if (existing && existing._id) {
		await bottleCurrent.doc(existing._id).update(patch)
		return
	}
	await bottleCurrent.add({
		...patch,
		created_at: now
	})
}

function buildIngestResult(status, reasonCode, reasonMsg, extras = {}) {
	return {
		code: 0,
		msg: 'ok',
		data: {
			status: normalizeString(status),
			reason_code: normalizeString(reasonCode),
			reason_msg: normalizeString(reasonMsg),
			...extras
		}
	}
}

async function handleIngestAction({
	action,
	payload,
	rawBodyText,
	headers,
	requestId
}) {
	const payloadType = normalizePayloadTypeByAction(action)
	if (!payloadType) return { code: 400, msg: '未知 action' }

	const validation = payloadType === 'snapshot' ? validateSnapshotPayload(payload) : validateEventPayload(payload)
	const signatureRes = await verifySignedRequest({ action, payload, rawBodyText, headers })
	const stationId = normalizeString(payload && payload.station_id) || normalizeString(signatureRes && signatureRes.stationId)
	const dedupKey = resolveDedupKey(payload, payloadType)
	const payloadHash = sha256Hex(JSON.stringify(payload || {}))

	if (!validation.ok) {
		await writeIngestLog({
			stationId,
			payloadType,
			dedupKey,
			status: 'rejected',
			reasonCode: validation.reasonCode,
			reasonMsg: validation.reasonMsg,
			requestId,
			requestBodySha256: normalizeString(signatureRes && signatureRes.requestBodySha256),
			payload
		})
		await writeRejectDeadLetter({
			stationId,
			payloadType,
			dedupKey,
			payload,
			reasonCode: validation.reasonCode,
			reasonMsg: validation.reasonMsg
		})
		return buildIngestResult('rejected', validation.reasonCode, validation.reasonMsg, {
			dedup_key: dedupKey,
			station_id: stationId,
			request_id: requestId
		})
	}

	if (!signatureRes.ok) {
		await writeIngestLog({
			stationId,
			payloadType,
			dedupKey,
			status: 'rejected',
			reasonCode: signatureRes.reasonCode,
			reasonMsg: signatureRes.reasonMsg,
			requestId,
			requestBodySha256: '',
			payload
		})
		await writeRejectDeadLetter({
			stationId,
			payloadType,
			dedupKey,
			payload,
			reasonCode: signatureRes.reasonCode,
			reasonMsg: signatureRes.reasonMsg
		})
		return buildIngestResult('rejected', signatureRes.reasonCode, signatureRes.reasonMsg, {
			dedup_key: dedupKey,
			station_id: stationId,
			request_id: requestId
		})
	}

	const reserveRes = await reserveDedup({
		stationId: signatureRes.stationId,
		payloadType,
		dedupKey,
		requestId
	})
	if (reserveRes.repeated) {
		await writeIngestLog({
			stationId: signatureRes.stationId,
			payloadType,
			dedupKey,
			status: 'repeated',
			reasonCode: 'duplicate_dedup_key',
			reasonMsg: '重复投递，已按幂等处理',
			requestId,
			requestBodySha256: signatureRes.requestBodySha256,
			payload
		})
		return buildIngestResult('repeated', 'duplicate_dedup_key', '重复投递，已按幂等处理', {
			dedup_key: dedupKey,
			station_id: signatureRes.stationId,
			request_id: requestId
		})
	}

	if (payloadType === 'snapshot') {
		await upsertSnapshotPayload(payload, payloadHash)
	} else {
		await appendEventPayload(payload, payloadHash, dedupKey)
		await upsertBottleCurrentByEvent(payload, payloadHash)
	}
	await markDedupAccepted(reserveRes.dedupId)
	await writeIngestLog({
		stationId: signatureRes.stationId,
		payloadType,
		dedupKey,
		status: 'accepted',
		reasonCode: '',
		reasonMsg: '',
		requestId,
		requestBodySha256: signatureRes.requestBodySha256,
		payload
	})
	return buildIngestResult('accepted', '', '', {
		dedup_key: dedupKey,
		station_id: signatureRes.stationId,
		request_id: requestId
	})
}

async function healthV1() {
	return {
		code: 0,
		data: {
			status: 'ok',
			schema_version: SCHEMA_VERSION,
			sign_version: SIGN_VERSION,
			sign_algorithm: SIGN_ALGORITHM,
			server_time: Date.now()
		}
	}
}

async function verifyStatsV1(data = {}) {
	const stationId = normalizeString(data.station_id || data.stationId)
	const createdStart = toNumber(data.created_start || data.createdStart, 0)
	const createdEnd = toNumber(data.created_end || data.createdEnd, 0)
	const buildLogWhere = (status) => {
		const conditions = [{ status: normalizeString(status) }]
		if (stationId) conditions.push({ station_id: stationId })
		if (createdStart > 0) conditions.push({ created_at: dbCmd.gte(createdStart) })
		if (createdEnd > 0) conditions.push({ created_at: dbCmd.lte(createdEnd) })
		return conditions.length > 1 ? dbCmd.and(conditions) : conditions[0]
	}

	const [stationRes, currentRes, eventRes, dedupAcceptedRes, logAcceptedRes, logRepeatedRes, logRejectedRes, deadOpenRes] = await Promise.all([
		stationId ? stationRegistry.where({ station_id: stationId, is_active: true }).count() : stationRegistry.where({ is_active: true }).count(),
		bottleCurrent.where(stationId ? { station_id: stationId } : {}).count(),
		bottleEvents.where(stationId ? { station_id: stationId } : {}).count(),
		ingestDedup.where(stationId ? { station_id: stationId, status: 'accepted' } : { status: 'accepted' }).count(),
		ingestLogs.where(buildLogWhere('accepted')).count(),
		ingestLogs.where(buildLogWhere('repeated')).count(),
		ingestLogs.where(buildLogWhere('rejected')).count(),
		deadLetters.where(stationId ? { station_id: stationId, resolved: false } : { resolved: false }).count()
	])

	return {
		code: 0,
		data: {
			station_id: stationId || '',
			active_station_key_total: toNumber(stationRes && stationRes.total, 0),
			bottle_current_total: toNumber(currentRes && currentRes.total, 0),
			bottle_event_total: toNumber(eventRes && eventRes.total, 0),
			dedup_accepted_total: toNumber(dedupAcceptedRes && dedupAcceptedRes.total, 0),
			log_accepted_total: toNumber(logAcceptedRes && logAcceptedRes.total, 0),
			log_repeated_total: toNumber(logRepeatedRes && logRepeatedRes.total, 0),
			log_rejected_total: toNumber(logRejectedRes && logRejectedRes.total, 0),
			dead_letter_open_total: toNumber(deadOpenRes && deadOpenRes.total, 0)
		}
	}
}

async function upsertStationRegistryV1(user, data = {}) {
	if (!isSuperAdmin(user)) return { code: 403, msg: '仅超级管理员可执行该操作' }
	const sourceItems = Array.isArray(data.items) ? data.items : []
	if (!sourceItems.length) return { code: 400, msg: 'items 不能为空' }
	const now = Date.now()
	let upserted = 0
	let inserted = 0
	const invalidItems = []
	for (let i = 0; i < sourceItems.length; i += 1) {
		const row = sourceItems[i] || {}
		const stationId = normalizeString(row.station_id || row.stationId)
		const stationName = normalizeString(row.station_name || row.stationName || stationId || '未命名站点')
		const keyId = normalizeString(row.key_id || row.keyId)
		const secret = normalizeString(row.secret)
		if (!stationId || !keyId || !secret) {
			invalidItems.push({
				index: i,
				reason: 'station_id/key_id/secret 必填'
			})
			continue
		}
		const allowSkewMs = Math.min(Math.max(toNumber(row.allow_skew_ms || row.allowSkewMs, DEFAULT_ALLOW_SKEW_MS), 30 * 1000), 30 * 60 * 1000)
		const isActive = row.is_active == null ? true : Boolean(row.is_active)
		const where = { station_id: stationId, key_id: keyId }
		const res = await stationRegistry.where(where).field({ _id: true }).limit(1).get()
		const existing = Array.isArray(res && res.data) ? res.data[0] || null : null
		const patch = {
			station_id: stationId,
			station_name: stationName,
			key_id: keyId,
			secret,
			is_active: isActive,
			allow_skew_ms: allowSkewMs,
			updated_at: now
		}
		if (existing && existing._id) {
			await stationRegistry.doc(existing._id).update(patch)
			upserted += 1
		} else {
			await stationRegistry.add({
				...patch,
				created_at: now
			})
			upserted += 1
			inserted += 1
		}
	}
	return {
		code: 0,
		data: {
			input_total: sourceItems.length,
			upserted_total: upserted,
			inserted_total: inserted,
			invalid_total: invalidItems.length,
			invalid_items: invalidItems
		}
	}
}

async function listBottleCurrentByNosV1(user, data = {}) {
	if (!isSuperAdmin(user)) return { code: 403, msg: '仅超级管理员可执行该操作' }
	const stationId = normalizeString(data.station_id || data.stationId)
	const bottleNos = Array.isArray(data.bottle_nos)
		? data.bottle_nos.map((item) => normalizeBottleNo(item)).filter(Boolean)
		: []
	if (!stationId) return { code: 400, msg: 'station_id 必填' }
	if (!bottleNos.length) return { code: 400, msg: 'bottle_nos 必填' }
	const where = dbCmd.and([{ station_id: stationId }, { bottle_no: dbCmd.in(bottleNos) }])
	const res = await bottleCurrent
		.where(where)
		.field({
			station_id: true,
			bottle_no: true,
			last_event_at: true,
			last_event_type: true,
			snapshot: true,
			updated_at: true
		})
		.limit(Math.min(bottleNos.length, 500))
		.get()
	const rows = Array.isArray(res && res.data) ? res.data : []
	return { code: 0, data: rows }
}

exports.main = async (event, context) => {
	void context
	const { action, data, rawBodyText } = extractEnvelope(event || {})
	const requestId =
		normalizeString(event && (event.request_id || event.requestId || context?.requestId || context?.request_id || '')) ||
		generateRequestId()
	const headers = resolveEventHeaders(event || {})
	const token = normalizeString(event && event.token)

	if (action === 'healthV1') return healthV1()
	if (action === 'verifyStatsV1') return verifyStatsV1(data || {})
	if (action === 'upsertStationRegistryV1') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		return upsertStationRegistryV1(user, data || {})
	}
	if (action === 'listBottleCurrentByNosV1') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		return listBottleCurrentByNosV1(user, data || {})
	}
	if (action === 'ingestSnapshotV1' || action === 'ingestEventV1') {
		return handleIngestAction({
			action,
			payload: data || {},
			rawBodyText,
			headers,
			requestId
		})
	}
	return { code: 400, msg: '未知 action' }
}
