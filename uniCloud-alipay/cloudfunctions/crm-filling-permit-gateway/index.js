'use strict'

const crypto = require('crypto')
const policy = require('./permitPolicy')

const db = uniCloud.database()
const bottles = db.collection('crm_bottles')
const audits = db.collection('crm_filling_permit_audits')
const logs = db.collection('crm_operation_logs')

const PASSWORD_HASH = policy.normalizeString(process.env.FILLING_PERMIT_GATEWAY_PASSWORD_HASH)
const TOKEN_SECRET = policy.normalizeString(process.env.FILLING_PERMIT_GATEWAY_TOKEN_SECRET)
const TOKEN_TTL_MS = Math.min(
	Math.max(Number(process.env.FILLING_PERMIT_GATEWAY_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000), 60 * 1000),
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

function generateRequestId() {
	return `permit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function getHeaderValue(headers = {}, name = '') {
	const target = policy.normalizeString(name).toLowerCase()
	for (const key of Object.keys(headers || {})) {
		if (policy.normalizeString(key).toLowerCase() === target) return policy.normalizeString(headers[key])
	}
	return ''
}

function extractEnvelope(event = {}) {
	let action = policy.normalizeString(event.action)
	let data = event.data && typeof event.data === 'object' ? event.data : null
	if (!data && typeof event.data === 'string') data = safeJsonParse(event.data, null)
	if (event.body != null) {
		const body = typeof event.body === 'string' ? safeJsonParse(event.body, null) : event.body
		if (body && typeof body === 'object') {
			if (!action) action = policy.normalizeString(body.action)
			if (!data) data = body.data && typeof body.data === 'object' ? body.data : body
		}
	}
	return { action, data: data && typeof data === 'object' ? data : {} }
}

function base64UrlEncode(value) {
	return Buffer.from(String(value)).toString('base64url')
}

function base64UrlDecode(value) {
	return Buffer.from(String(value), 'base64url').toString('utf8')
}

function hmacHex(value) {
	return crypto.createHmac('sha256', TOKEN_SECRET).update(String(value)).digest('hex')
}

function constantTimeHexEqual(left, right) {
	const a = policy.normalizeString(left).toLowerCase()
	const b = policy.normalizeString(right).toLowerCase()
	if (!a || !b || a.length !== b.length) return false
	return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function parsePasswordHash(value) {
	const parts = policy.normalizeString(value).split('$')
	if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return null
	const iterations = Number(parts[1])
	if (!Number.isFinite(iterations) || iterations < 10000 || !parts[2] || !parts[3]) return null
	return { iterations, salt: parts[2], hash: parts[3] }
}

function verifyPassword(password) {
	const parsed = parsePasswordHash(PASSWORD_HASH)
	if (!parsed) return false
	const actual = crypto.pbkdf2Sync(String(password || ''), parsed.salt, parsed.iterations, 32, 'sha256').toString('hex')
	return constantTimeHexEqual(actual, parsed.hash)
}

function createToken(gatewayId, requestId) {
	if (!TOKEN_SECRET) throw new Error('缺少 FILLING_PERMIT_GATEWAY_TOKEN_SECRET')
	const now = Date.now()
	const encoded = base64UrlEncode(
		JSON.stringify({
			typ: 'filling-permit-gateway',
			gateway_id: gatewayId,
			iat: now,
			exp: now + TOKEN_TTL_MS,
			request_id: requestId
		})
	)
	return `${encoded}.${hmacHex(encoded)}`
}

function resolveBearerToken(event = {}, data = {}) {
	const headers = event.headers || event.header || {}
	const authorization = getHeaderValue(headers, 'authorization')
	const match = authorization.match(/^Bearer\s+(.+)$/i)
	if (match) return policy.normalizeString(match[1])
	return policy.normalizeString(event.token || data.token || data.gateway_token)
}

function verifyToken(token) {
	if (!TOKEN_SECRET) return { ok: false, code: 500, msg: '网关令牌密钥未配置' }
	const parts = policy.normalizeString(token).split('.')
	if (parts.length !== 2 || !constantTimeHexEqual(hmacHex(parts[0]), parts[1])) {
		return { ok: false, code: 401, msg: '网关令牌无效' }
	}
	const payload = safeJsonParse(base64UrlDecode(parts[0]), null)
	if (!payload || payload.typ !== 'filling-permit-gateway') return { ok: false, code: 401, msg: '网关令牌类型无效' }
	if (Number(payload.exp || 0) <= Date.now()) return { ok: false, code: 401, msg: '网关令牌已过期' }
	return { ok: true, payload }
}

async function recordLog(action, detail, requestId) {
	try {
		await logs.add({
			user_id: null,
			username: 'filling-permit-gateway',
			role: 'service',
			action,
			detail: detail || {},
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-filling-permit-gateway] operation log failed', err && err.message ? err.message : err)
	}
}

async function findAudit(requestId) {
	const response = await audits.where({ request_id: requestId }).limit(1).get()
	return response && Array.isArray(response.data) ? response.data[0] || null : null
}

function resultFromAudit(audit) {
	if (audit && audit.response && typeof audit.response === 'object') return audit.response
	return {
		allowed: audit.allowed === true,
		outcome: audit.outcome,
		reason_code: audit.reason_code,
		reason_key: audit.reason_key,
		reason_text: audit.reason_text,
		detail_mask: Number(audit.detail_mask) >>> 0,
		detail_mask_low: Number(audit.detail_mask) & 0xffff,
		detail_mask_high: (Number(audit.detail_mask) >>> 16) & 0xffff,
		failure_keys: audit.failure_keys || [],
		checks: audit.checks || {},
		bottle_snapshot: audit.bottle_snapshot || null,
		evaluated_at: audit.evaluated_at
	}
}

function buildAudit(data, tokenPayload, result, source) {
	const now = Date.now()
	return {
		request_id: policy.normalizeString(data.request_id),
		gateway_id: policy.normalizeString(tokenPayload.gateway_id),
		hmi_boot_id: Math.min(Math.max(Math.trunc(Number(data.hmi_boot_id) || 0), 0), 65535),
		hmi_request_seq: Math.min(Math.max(Math.trunc(Number(data.hmi_request_seq) || 0), 0), 65535),
		bottle_no_input: policy.normalizeString(data.bottle_no || data.bottle_no_input),
		normalized_bottle_no: policy.normalizeBottleNo(data.bottle_no || data.normalized_bottle_no),
		bottle_snapshot: result.bottle_snapshot || data.bottle_snapshot || null,
		allowed: result.allowed === true,
		outcome: result.outcome,
		reason_code: Number(result.reason_code) || 0,
		reason_key: policy.normalizeString(result.reason_key),
		reason_text: policy.normalizeString(result.reason_text),
		detail_mask: Number(result.detail_mask) >>> 0,
		failure_keys: Array.isArray(result.failure_keys) ? result.failure_keys : [],
		checks: result.checks && typeof result.checks === 'object' ? result.checks : {},
		latency_ms: Math.min(Math.max(Number(data.latency_ms) || now - Number(data.requested_at || now), 0), 65535),
		source,
		requested_at: Number(data.requested_at) || now,
		evaluated_at: Number(result.evaluated_at) || now,
		created_at: now,
		response: result
	}
}

function isDuplicateError(err) {
	const message = policy.normalizeString(err && (err.message || err.errMsg || err.code))
	return /duplicate|E11000|重复|unique/i.test(message)
}

async function addAuditIdempotent(audit) {
	const existing = await findAudit(audit.request_id)
	if (existing) return { audit: existing, created: false }
	try {
		const response = await audits.add(audit)
		return { audit: { ...audit, _id: response && response.id }, created: true }
	} catch (err) {
		if (!isDuplicateError(err)) throw err
		const concurrent = await findAudit(audit.request_id)
		if (!concurrent) throw err
		return { audit: concurrent, created: false }
	}
}

function validateRequestIdentity(data, tokenPayload) {
	const requestId = policy.normalizeString(data.request_id)
	if (!/^[A-Za-z0-9_-]{8,160}$/.test(requestId)) return 'request_id 无效'
	if (policy.normalizeString(data.gateway_id) !== policy.normalizeString(tokenPayload.gateway_id)) return 'gateway_id 与令牌不一致'
	if (!Number.isInteger(Number(data.hmi_boot_id)) || Number(data.hmi_boot_id) < 1 || Number(data.hmi_boot_id) > 65535) return 'hmi_boot_id 无效'
	if (!Number.isInteger(Number(data.hmi_request_seq)) || Number(data.hmi_request_seq) < 1 || Number(data.hmi_request_seq) > 65535) return 'hmi_request_seq 无效'
	return ''
}

async function healthV1() {
	return {
		code: 0,
		data: {
			status: 'ok',
			protocol_version: 1,
			password_configured: Boolean(PASSWORD_HASH),
			token_secret_configured: Boolean(TOKEN_SECRET),
			server_time: Date.now()
		}
	}
}

async function loginV1(data, requestId) {
	if (!PASSWORD_HASH) return { code: 500, msg: '缺少 FILLING_PERMIT_GATEWAY_PASSWORD_HASH' }
	if (!TOKEN_SECRET) return { code: 500, msg: '缺少 FILLING_PERMIT_GATEWAY_TOKEN_SECRET' }
	const gatewayId = policy.normalizeString(data.gateway_id)
	if (!gatewayId) return { code: 400, msg: 'gateway_id 必填' }
	if (!verifyPassword(data.password)) {
		await recordLog('filling_permit_gateway_login_failed', { gateway_id: gatewayId }, requestId)
		return { code: 401, msg: '网关密码错误' }
	}
	const token = createToken(gatewayId, requestId)
	await recordLog('filling_permit_gateway_login', { gateway_id: gatewayId }, requestId)
	return { code: 0, data: { token, gateway_id: gatewayId, expires_in_ms: TOKEN_TTL_MS } }
}

async function checkPermitV1(event, data, requestId) {
	const tokenResult = verifyToken(resolveBearerToken(event, data))
	if (!tokenResult.ok) return { code: tokenResult.code, msg: tokenResult.msg }
	const identityError = validateRequestIdentity(data, tokenResult.payload)
	if (identityError) return { code: 400, msg: identityError }

	let existing
	try {
		existing = await findAudit(data.request_id)
	} catch (_) {
		return { code: 503, msg: '数据库读取失败', data: { failure_kind: 'database' } }
	}
	if (existing) return { code: 0, data: { result: resultFromAudit(existing), audited: true, idempotent: true } }

	let result
	try {
		const normalized = policy.normalizeBottleNo(data.bottle_no)
		let matches = []
		if (policy.isValidBottleNo(normalized)) {
			const response = await bottles.where({ bottle_no: normalized }).limit(2).get()
			matches = response && Array.isArray(response.data) ? response.data : []
		}
		result = policy.evaluatePermit({ bottleNo: normalized, bottles: matches, now: Date.now() })
	} catch (_) {
		result = policy.systemDenied('system_database', { now: Date.now() })
	}

	const audit = buildAudit(data, tokenResult.payload, result, 'cloud_check')
	try {
		const saved = await addAuditIdempotent(audit)
		const finalResult = resultFromAudit(saved.audit)
		await recordLog(
			'filling_permit_checked',
			{ gateway_id: audit.gateway_id, bottle_no: audit.normalized_bottle_no, allowed: finalResult.allowed, reason_code: finalResult.reason_code },
			requestId
		)
		return { code: 0, data: { result: finalResult, audited: true, idempotent: !saved.created } }
	} catch (_) {
		return { code: 503, msg: '云端审计写入失败', data: { failure_kind: 'cloud_audit' } }
	}
}

function normalizeSyncedRecord(record, tokenPayload) {
	if (!record || typeof record !== 'object') throw new Error('补传记录无效')
	if (record.allowed === true || record.outcome !== 'system_denied') throw new Error('补传接口只接受系统禁止记录')
	const identityError = validateRequestIdentity(record, tokenPayload)
	if (identityError) throw new Error(identityError)
	const reasonKey = policy.REASONS[record.reason_key] ? record.reason_key : 'system_internal'
	const result = policy.systemDenied(reasonKey, { now: Number(record.evaluated_at) || Date.now(), checks: record.checks || {} })
	return buildAudit(record, tokenPayload, { ...result, bottle_snapshot: record.bottle_snapshot || null }, 'local_sync')
}

async function syncAuditV1(event, data, requestId) {
	const tokenResult = verifyToken(resolveBearerToken(event, data))
	if (!tokenResult.ok) return { code: tokenResult.code, msg: tokenResult.msg }
	const records = Array.isArray(data.records) ? data.records.slice(0, 100) : []
	if (!records.length) return { code: 400, msg: 'records 必填' }
	const syncedIds = []
	for (const record of records) {
		try {
			const audit = normalizeSyncedRecord(record, tokenResult.payload)
			await addAuditIdempotent(audit)
			syncedIds.push(audit.request_id)
		} catch (err) {
			return {
				code: 503,
				msg: err && err.message ? err.message : '补传审计失败',
				data: { failure_kind: /数据库|duplicate|E11000/i.test(policy.normalizeString(err && err.message)) ? 'database' : 'cloud_audit', synced_request_ids: syncedIds }
			}
		}
	}
	await recordLog('filling_permit_audits_synced', { count: syncedIds.length }, requestId)
	return { code: 0, data: { synced_request_ids: syncedIds, count: syncedIds.length } }
}

exports.main = async (event, context) => {
	const envelope = extractEnvelope(event || {})
	const requestId =
		policy.normalizeString(event && (event.request_id || event.requestId || context?.requestId || context?.request_id)) || generateRequestId()
	try {
		if (envelope.action === 'healthV1') return healthV1()
		if (envelope.action === 'loginV1') return loginV1(envelope.data, requestId)
		if (envelope.action === 'checkPermitV1') return checkPermitV1(event || {}, envelope.data, requestId)
		if (envelope.action === 'syncAuditV1') return syncAuditV1(event || {}, envelope.data, requestId)
		return { code: 400, msg: '未知 action' }
	} catch (err) {
		console.error('[crm-filling-permit-gateway] unhandled error', err)
		return { code: 500, msg: '内部异常', data: { failure_kind: 'internal' } }
	}
}
