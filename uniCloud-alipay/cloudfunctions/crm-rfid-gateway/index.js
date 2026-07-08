'use strict'

const crypto = require('crypto')

const db = uniCloud.database()
const dbCmd = db.command

const bindings = db.collection('crm_rfid_bindings')
const sessions = db.collection('crm_rfid_gate_sessions')
const logs = db.collection('crm_operation_logs')

const PASSWORD_HASH = normalizeString(process.env.RFID_GATEWAY_PASSWORD_HASH)
const TOKEN_SECRET = normalizeString(process.env.RFID_GATEWAY_TOKEN_SECRET)
const TOKEN_TTL_MS = Math.min(
	Math.max(Number(process.env.RFID_GATEWAY_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000), 60 * 1000),
	365 * 24 * 60 * 60 * 1000
)

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeEpc(value) {
	return normalizeString(value).replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

function toBool(value, fallback = false) {
	if (value === true || value === 'true' || value === 1 || value === '1') return true
	if (value === false || value === 'false' || value === 0 || value === '0') return false
	return fallback
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function toTimestamp(value, fallback = 0) {
	if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value)
	const text = normalizeString(value)
	if (!text) return fallback
	const parsed = Date.parse(text)
	return Number.isFinite(parsed) ? parsed : fallback
}

function safeJsonParse(text, fallback = null) {
	if (!text || typeof text !== 'string') return fallback
	try {
		return JSON.parse(text)
	} catch (_) {
		return fallback
	}
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getHeaderValue(headers = {}, name = '') {
	const key = normalizeString(name).toLowerCase()
	if (!key) return ''
	const source = headers && typeof headers === 'object' ? headers : {}
	if (Object.prototype.hasOwnProperty.call(source, key)) return normalizeString(source[key])
	const direct = source[name]
	if (direct != null) return normalizeString(direct)
	for (const candidateKey of Object.keys(source)) {
		if (normalizeString(candidateKey).toLowerCase() === key) return normalizeString(source[candidateKey])
	}
	return ''
}

function resolveEventHeaders(event = {}) {
	if (event.headers && typeof event.headers === 'object') return event.headers
	if (event.header && typeof event.header === 'object') return event.header
	return {}
}

function extractEnvelope(event = {}) {
	let action = normalizeString(event && event.action)
	let data = event && typeof event.data === 'object' ? event.data : null

	if (!data && typeof event?.data === 'string') data = safeJsonParse(event.data, null)

	if (event && event.body != null) {
		const parsedBody = typeof event.body === 'string' ? safeJsonParse(event.body, null) : event.body
		if (parsedBody && typeof parsedBody === 'object') {
			if (!action) action = normalizeString(parsedBody.action)
			if (!data) data = parsedBody.data && typeof parsedBody.data === 'object' ? parsedBody.data : parsedBody
		}
	}

	if (!action && data && typeof data === 'object' && normalizeString(data.action)) {
		action = normalizeString(data.action)
		data = data.data && typeof data.data === 'object' ? data.data : data
	}
	if (!data || typeof data !== 'object') data = {}
	return { action, data }
}

function base64UrlEncode(text) {
	return Buffer.from(String(text)).toString('base64url')
}

function base64UrlDecode(text) {
	return Buffer.from(String(text), 'base64url').toString('utf8')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', String(key || '')).update(String(text || '')).digest('hex')
}

function constantTimeHexEqual(left, right) {
	const leftText = normalizeString(left).toLowerCase()
	const rightText = normalizeString(right).toLowerCase()
	if (!leftText || !rightText || leftText.length !== rightText.length) return false
	return crypto.timingSafeEqual(Buffer.from(leftText), Buffer.from(rightText))
}

function parsePasswordHash(text) {
	const parts = normalizeString(text).split('$')
	if (parts.length !== 4) return null
	if (parts[0] !== 'pbkdf2-sha256') return null
	const iterations = Number(parts[1])
	const salt = normalizeString(parts[2])
	const hash = normalizeString(parts[3]).toLowerCase()
	if (!Number.isFinite(iterations) || iterations < 10000 || !salt || !hash) return null
	return { iterations, salt, hash }
}

function verifyPassword(password, storedHash) {
	const parsed = parsePasswordHash(storedHash)
	if (!parsed) return false
	const computed = crypto.pbkdf2Sync(String(password || ''), parsed.salt, parsed.iterations, 32, 'sha256').toString('hex')
	return constantTimeHexEqual(computed, parsed.hash)
}

function createGatewayToken({ gatewayId, requestId }) {
	if (!TOKEN_SECRET) throw new Error('缺少 RFID_GATEWAY_TOKEN_SECRET')
	const now = Date.now()
	const payload = {
		typ: 'rfid-gateway',
		gateway_id: normalizeString(gatewayId) || 'rfid-gateway',
		iat: now,
		exp: now + TOKEN_TTL_MS,
		request_id: normalizeString(requestId)
	}
	const encoded = base64UrlEncode(JSON.stringify(payload))
	const signature = hmacSha256Hex(encoded, TOKEN_SECRET)
	return `${encoded}.${signature}`
}

function verifyGatewayToken(token) {
	if (!TOKEN_SECRET) return { ok: false, code: 500, msg: '网关 token 密钥未配置' }
	const text = normalizeString(token)
	const parts = text.split('.')
	if (parts.length !== 2) return { ok: false, code: 401, msg: '网关 token 无效' }
	const [encoded, signature] = parts
	const expected = hmacSha256Hex(encoded, TOKEN_SECRET)
	if (!constantTimeHexEqual(expected, signature)) return { ok: false, code: 401, msg: '网关 token 校验失败' }
	const payload = safeJsonParse(base64UrlDecode(encoded), null)
	if (!payload || payload.typ !== 'rfid-gateway') return { ok: false, code: 401, msg: '网关 token 类型无效' }
	if (Number(payload.exp || 0) <= Date.now()) return { ok: false, code: 401, msg: '网关 token 已过期' }
	return { ok: true, payload }
}

function resolveBearerToken(event = {}, data = {}) {
	const headers = resolveEventHeaders(event)
	const auth = getHeaderValue(headers, 'authorization')
	const bearer = auth.match(/^Bearer\s+(.+)$/i)
	if (bearer) return normalizeString(bearer[1])
	return normalizeString(event.token || data.token || data.gateway_token || data.gatewayToken)
}

async function recordGatewayLog(action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: null,
			username: 'rfid-gateway',
			role: 'service',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-rfid-gateway] record log failed', err && err.message ? err.message : err)
	}
}

function normalizeTagRecord(raw = {}) {
	const epc = normalizeEpc(raw.epc)
	return {
		epc,
		epc_kind: normalizeString(raw.epc_kind || raw.epcKind || ''),
		entity_type: normalizeString(raw.entity_type || raw.entityType || ''),
		serial: normalizeString(raw.serial),
		is_xt: toBool(raw.is_xt ?? raw.isXt, false),
		crc_ok: toBool(raw.crc_ok ?? raw.crcOk, false),
		read_count: Math.max(Math.trunc(toNumber(raw.read_count ?? raw.readCount, 1)), 1),
		first_seen_at: toTimestamp(raw.first_seen_at ?? raw.firstSeenAt, 0),
		last_seen_at: toTimestamp(raw.last_seen_at ?? raw.lastSeenAt, 0)
	}
}

function collectSessionEpcs(summary = {}) {
	const set = new Set()
	const add = (value) => {
		const epc = normalizeEpc(value)
		if (epc) set.add(epc)
	}
	add(summary.vehicle_epc || summary.vehicleEpc)
	const vehicleEpcs = Array.isArray(summary.vehicle_epcs || summary.vehicleEpcs) ? summary.vehicle_epcs || summary.vehicleEpcs : []
	vehicleEpcs.forEach(add)
	const bottleRows = Array.isArray(summary.bottles) ? summary.bottles : []
	bottleRows.forEach((item) => add(item && item.epc))
	const unknownRows = Array.isArray(summary.unknown_tags || summary.unknownTags) ? summary.unknown_tags || summary.unknownTags : []
	unknownRows.forEach((item) => add(item && item.epc))
	return Array.from(set)
}

async function fetchBindingMap(epcs = []) {
	const clean = Array.from(new Set((epcs || []).map(normalizeEpc).filter(Boolean)))
	if (!clean.length) return new Map()
	const res = await bindings.where({ epc: dbCmd.in(clean), status: 'active' }).limit(500).get()
	const map = new Map()
	for (const item of Array.isArray(res.data) ? res.data : []) {
		const epc = normalizeEpc(item.epc)
		if (epc && !map.has(epc)) map.set(epc, item)
	}
	return map
}

function resolveBinding(epc, expectedType, bindingMap) {
	const normalized = normalizeEpc(epc)
	const binding = normalized ? bindingMap.get(normalized) : null
	if (!binding) {
		return {
			binding_status: 'unbound',
			entity_id: '',
			entity_no: ''
		}
	}
	const entityType = normalizeString(binding.entity_type)
	const matchedType = !expectedType || entityType === expectedType
	return {
		binding_status: matchedType ? 'bound' : 'type_mismatch',
		entity_id: matchedType ? normalizeString(binding.entity_id) : '',
		entity_no: matchedType ? normalizeString(binding.entity_no) : ''
	}
}

function enrichTag(raw, expectedType, bindingMap) {
	const tag = normalizeTagRecord(raw)
	const binding = resolveBinding(tag.epc, expectedType, bindingMap)
	return {
		...tag,
		binding_status: binding.binding_status,
		entity_id: binding.entity_id,
		entity_no: binding.entity_no
	}
}

function buildSessionDoc(summary = {}, tokenPayload = {}) {
	const now = Date.now()
	const startedAt = toTimestamp(summary.started_at || summary.startedAt, now)
	const endedAt = toTimestamp(summary.ended_at || summary.endedAt, startedAt)
	const vehicleEpc = normalizeEpc(summary.vehicle_epc || summary.vehicleEpc)
	const vehicleConflict = toBool(summary.vehicle_conflict ?? summary.vehicleConflict, false)
	const status = vehicleConflict ? 'conflict' : vehicleEpc ? 'complete' : 'no_vehicle'
	const bottles = Array.isArray(summary.bottles) ? summary.bottles : []
	const unknownTags = Array.isArray(summary.unknown_tags || summary.unknownTags) ? summary.unknown_tags || summary.unknownTags : []

	return {
		session_id: normalizeString(summary.session_id || summary.sessionId),
		gateway_id: normalizeString(summary.gateway_id || summary.gatewayId || tokenPayload.gateway_id) || 'rfid-gateway',
		reader_device_code: normalizeString(summary.reader_device_code || summary.readerDeviceCode),
		status,
		reason: normalizeString(summary.reason),
		started_at: startedAt,
		ended_at: endedAt,
		duration_ms: Math.max(Math.trunc(toNumber(summary.duration_ms ?? summary.durationMs, endedAt - startedAt)), 0),
		vehicle_epc: vehicleEpc,
		vehicle_serial: '',
		vehicle_entity_id: '',
		vehicle_no: '',
		vehicle_binding_status: vehicleEpc ? 'unbound' : 'unbound',
		vehicle_conflict: vehicleConflict,
		vehicle_epcs: (Array.isArray(summary.vehicle_epcs || summary.vehicleEpcs) ? summary.vehicle_epcs || summary.vehicleEpcs : []).map(normalizeEpc).filter(Boolean),
		vehicle_serials: (Array.isArray(summary.vehicle_serials || summary.vehicleSerials) ? summary.vehicle_serials || summary.vehicleSerials : []).map(normalizeString).filter(Boolean),
		bottle_total: Math.max(Math.trunc(toNumber(summary.bottle_total ?? summary.bottleTotal, bottles.length)), 0),
		bound_bottle_total: 0,
		unbound_bottle_total: 0,
		unknown_total: Math.max(Math.trunc(toNumber(summary.unknown_total ?? summary.unknownTotal, unknownTags.length)), 0),
		bottles: [],
		unknown_tags: [],
		raw: summary,
		uploaded_at: toTimestamp(summary.uploaded_at || summary.uploadedAt, now),
		received_at: now,
		updated_at: now
	}
}

async function normalizeSessionForStorage(summary = {}, tokenPayload = {}) {
	const doc = buildSessionDoc(summary, tokenPayload)
	if (!doc.session_id) return { code: 400, msg: 'session_id 必填' }
	if (!doc.reader_device_code) return { code: 400, msg: 'reader_device_code 必填' }

	const bindingMap = await fetchBindingMap(collectSessionEpcs(summary))
	const vehicleBinding = resolveBinding(doc.vehicle_epc, 'vehicle', bindingMap)
	doc.vehicle_binding_status = vehicleBinding.binding_status
	doc.vehicle_entity_id = vehicleBinding.entity_id
	doc.vehicle_no = vehicleBinding.entity_no
	if (doc.vehicle_serials.length) doc.vehicle_serial = doc.vehicle_serials[0]

	const rawBottles = Array.isArray(summary.bottles) ? summary.bottles : []
	doc.bottles = rawBottles
		.map((item) => enrichTag(item, 'bottle', bindingMap))
		.filter((item) => item.epc)
	doc.bottle_total = doc.bottles.length
	doc.bound_bottle_total = doc.bottles.filter((item) => item.binding_status === 'bound').length
	doc.unbound_bottle_total = doc.bottles.filter((item) => item.binding_status !== 'bound').length

	const rawUnknownTags = Array.isArray(summary.unknown_tags || summary.unknownTags) ? summary.unknown_tags || summary.unknownTags : []
	doc.unknown_tags = rawUnknownTags
		.map((item) => enrichTag(item, '', bindingMap))
		.filter((item) => item.epc)
	doc.unknown_total = doc.unknown_tags.length

	return { code: 0, doc }
}

async function upsertSession(doc) {
	const existingRes = await sessions.where({ session_id: doc.session_id }).limit(1).get()
	const existing = Array.isArray(existingRes.data) ? existingRes.data[0] : null
	if (existing && existing._id) {
		await sessions.doc(existing._id).update(doc)
		return { inserted: false, _id: existing._id }
	}
	const addDoc = {
		...doc,
		created_at: doc.received_at || Date.now()
	}
	const addRes = await sessions.add(addDoc)
	return { inserted: true, _id: addRes.id || addRes._id || '' }
}

async function healthV1() {
	return {
		code: 0,
		data: {
			status: 'ok',
			password_configured: Boolean(PASSWORD_HASH),
			token_secret_configured: Boolean(TOKEN_SECRET),
			server_time: Date.now()
		}
	}
}

async function loginV1(data = {}, requestId = '') {
	if (!PASSWORD_HASH) return { code: 500, msg: '缺少 RFID_GATEWAY_PASSWORD_HASH' }
	if (!TOKEN_SECRET) return { code: 500, msg: '缺少 RFID_GATEWAY_TOKEN_SECRET' }
	const password = normalizeString(data.password)
	if (!password) return { code: 400, msg: 'password 必填' }
	if (!verifyPassword(password, PASSWORD_HASH)) {
		await recordGatewayLog('rfid_gateway_login_failed', { gateway_id: normalizeString(data.gateway_id || data.gatewayId) }, requestId)
		return { code: 401, msg: '网关密码错误' }
	}
	const gatewayId = normalizeString(data.gateway_id || data.gatewayId) || 'rfid-gateway'
	const token = createGatewayToken({ gatewayId, requestId })
	await recordGatewayLog('rfid_gateway_login', { gateway_id: gatewayId }, requestId)
	return {
		code: 0,
		data: {
			token,
			expires_in_ms: TOKEN_TTL_MS,
			gateway_id: gatewayId
		}
	}
}

async function ingestSessionV1(event = {}, data = {}, requestId = '') {
	const token = resolveBearerToken(event, data)
	const tokenRes = verifyGatewayToken(token)
	if (!tokenRes.ok) return { code: tokenRes.code, msg: tokenRes.msg }
	const summary = data.session && typeof data.session === 'object' ? data.session : data
	const normalized = await normalizeSessionForStorage(summary, tokenRes.payload)
	if (normalized.code !== 0) return normalized
	const upsertRes = await upsertSession(normalized.doc)
	await recordGatewayLog(
		'rfid_gateway_ingest_session',
		{
			gateway_id: normalized.doc.gateway_id,
			session_id: normalized.doc.session_id,
			inserted: upsertRes.inserted,
			vehicle_epc: normalized.doc.vehicle_epc,
			bottle_total: normalized.doc.bottle_total,
			unknown_total: normalized.doc.unknown_total,
			vehicle_conflict: normalized.doc.vehicle_conflict
		},
		requestId
	)
	return {
		code: 0,
		data: {
			_id: upsertRes._id,
			inserted: upsertRes.inserted,
			session_id: normalized.doc.session_id,
			status: normalized.doc.status,
			vehicle_binding_status: normalized.doc.vehicle_binding_status,
			bottle_total: normalized.doc.bottle_total,
			bound_bottle_total: normalized.doc.bound_bottle_total,
			unbound_bottle_total: normalized.doc.unbound_bottle_total,
			unknown_total: normalized.doc.unknown_total
		}
	}
}

exports.main = async (event, context) => {
	const { action, data } = extractEnvelope(event || {})
	const requestId =
		normalizeString(event && (event.request_id || event.requestId || context?.requestId || context?.request_id || '')) ||
		generateRequestId()

	if (action === 'healthV1') return healthV1()
	if (action === 'loginV1') return loginV1(data || {}, requestId)
	if (action === 'ingestSessionV1') return ingestSessionV1(event || {}, data || {}, requestId)
	return { code: 400, msg: '未知 action' }
}
