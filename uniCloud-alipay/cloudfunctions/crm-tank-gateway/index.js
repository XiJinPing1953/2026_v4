'use strict'

const crypto = require('crypto')
const tankTelemetryCore = require('./tankTelemetry')

const db = uniCloud.database()
const tankTelemetry = db.collection('crm_tank_telemetry')
const logs = db.collection('crm_operation_logs')

const PASSWORD_HASH = tankTelemetryCore.normalizeString(process.env.TANK_GATEWAY_PASSWORD_HASH)
const TOKEN_SECRET = tankTelemetryCore.normalizeString(process.env.TANK_GATEWAY_TOKEN_SECRET)
const TOKEN_TTL_MS = Math.min(
	Math.max(Number(process.env.TANK_GATEWAY_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000), 60 * 1000),
	365 * 24 * 60 * 60 * 1000
)

function safeJsonParse(text, fallback = null) {
	if (!text || typeof text !== 'string') return fallback
	try {
		return JSON.parse(text)
	} catch (_) {
		return fallback
	}
}

function normalizeString(value) {
	return tankTelemetryCore.normalizeString(value)
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
		if (normalizeString(candidateKey).toLowerCase() === key) {
			return normalizeString(source[candidateKey])
		}
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
	if (!TOKEN_SECRET) throw new Error('缺少 TANK_GATEWAY_TOKEN_SECRET')
	const now = Date.now()
	const payload = {
		typ: 'tank-gateway',
		gateway_id: normalizeString(gatewayId) || 'tank-gateway',
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
	if (!payload || payload.typ !== 'tank-gateway') return { ok: false, code: 401, msg: '网关 token 类型无效' }
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
			username: 'tank-gateway',
			role: 'service',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-tank-gateway] record log failed', err && err.message ? err.message : err)
	}
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
	if (!PASSWORD_HASH) return { code: 500, msg: '缺少 TANK_GATEWAY_PASSWORD_HASH' }
	if (!TOKEN_SECRET) return { code: 500, msg: '缺少 TANK_GATEWAY_TOKEN_SECRET' }
	const password = normalizeString(data.password)
	if (!password) return { code: 400, msg: 'password 必填' }
	if (!verifyPassword(password, PASSWORD_HASH)) {
		await recordGatewayLog('tank_gateway_login_failed', { gateway_id: normalizeString(data.gateway_id || data.gatewayId) }, requestId)
		return { code: 401, msg: '网关密码错误' }
	}
	const gatewayId = normalizeString(data.gateway_id || data.gatewayId) || 'tank-gateway'
	const token = createGatewayToken({ gatewayId, requestId })
	await recordGatewayLog('tank_gateway_login', { gateway_id: gatewayId }, requestId)
	return {
		code: 0,
		data: {
			token,
			expires_in_ms: TOKEN_TTL_MS,
			gateway_id: gatewayId
		}
	}
}

async function ingestV1(event = {}, data = {}, requestId = '') {
	const token = resolveBearerToken(event, data)
	const tokenRes = verifyGatewayToken(token)
	if (!tokenRes.ok) return { code: tokenRes.code, msg: tokenRes.msg }
	const source = data.telemetry && typeof data.telemetry === 'object' ? data.telemetry : data
	const { token: _token, gateway_token: _gatewayToken, gatewayToken: _gatewayTokenCamel, telemetry: _telemetry, ...payload } = source
	void _token
	void _gatewayToken
	void _gatewayTokenCamel
	void _telemetry
	if (!payload.gateway_id && !payload.gatewayId) payload.gateway_id = normalizeString(tokenRes.payload.gateway_id) || 'tank-gateway'
	const res = await tankTelemetryCore.upsertTankTelemetry(tankTelemetry, payload)
	if (res && res.code === 0) {
		await recordGatewayLog(
			'tank_gateway_ingest',
			{
				gateway_id: payload.gateway_id || payload.gatewayId || '',
				tank_id: payload.tank_id || payload.tankId || 'main',
				level_kpa: payload.level_kpa ?? payload.levelKpa ?? null,
				level_percent: payload.level_percent ?? payload.levelPercent ?? null,
				pressure_mpa: payload.pressure_mpa ?? payload.pressureMpa ?? null,
				lng_weight_t: payload.lng_weight_t ?? payload.lngWeightT ?? null
			},
			requestId
		)
	}
	if (res && res.doc) delete res.doc
	return res
}

exports.main = async (event, context) => {
	const { action, data } = extractEnvelope(event || {})
	const requestId =
		normalizeString(event && (event.request_id || event.requestId || context?.requestId || context?.request_id || '')) ||
		generateRequestId()

	if (action === 'healthV1') return healthV1()
	if (action === 'loginV1') return loginV1(data || {}, requestId)
	if (action === 'ingestV1') return ingestV1(event || {}, data || {}, requestId)
	return { code: 400, msg: '未知 action' }
}
