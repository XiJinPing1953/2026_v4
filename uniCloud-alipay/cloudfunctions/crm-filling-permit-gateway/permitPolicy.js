'use strict'

const VALID_STATUSES = Object.freeze(['unknown', 'in_station', 'at_customer', 'scrapped', 'lost'])

const DETAIL_BITS = Object.freeze({
	request_invalid: 0,
	bottle_not_found: 1,
	bottle_not_unique: 2,
	status_invalid: 3,
	bottle_inactive: 4,
	bottle_scrapped: 5,
	bottle_lost: 6,
	bottle_date_invalid: 7,
	bottle_date_blocked: 8,
	pressure_gauge_date_invalid: 9,
	pressure_gauge_date_blocked: 10,
	safety_valve_date_invalid: 11,
	safety_valve_date_blocked: 12,
	system_timeout_or_network: 13,
	system_database: 14,
	system_auth: 15,
	system_cloud_audit: 16,
	system_internal: 17,
	system_local_audit: 18,
	system_protocol: 19,
	system_busy: 20,
	system_not_ready: 21
})

const REASONS = Object.freeze({
	allowed: { code: 0, text: '允许充装' },
	request_invalid: { code: 10, text: '瓶号输入无效' },
	bottle_not_found: { code: 11, text: '未找到气瓶' },
	bottle_inactive: { code: 12, text: '气瓶已停用' },
	bottle_scrapped: { code: 13, text: '气瓶已报废' },
	bottle_lost: { code: 14, text: '气瓶已丢失' },
	status_invalid: { code: 15, text: '气瓶状态异常' },
	bottle_not_unique: { code: 16, text: '瓶号主档不唯一' },
	bottle_date_invalid: { code: 20, text: '钢瓶检验日期缺失或无效' },
	bottle_date_blocked: { code: 21, text: '钢瓶检验已到提前禁用期' },
	pressure_gauge_date_invalid: { code: 30, text: '压力表检验日期缺失或无效' },
	pressure_gauge_date_blocked: { code: 31, text: '压力表检验已到提前禁用期' },
	safety_valve_date_invalid: { code: 40, text: '安全阀检验日期缺失或无效' },
	safety_valve_date_blocked: { code: 41, text: '安全阀检验已到提前禁用期' },
	system_timeout_or_network: { code: 90, text: '云端超时或网络故障' },
	system_database: { code: 92, text: '数据库故障' },
	system_auth: { code: 93, text: '网关鉴权失败' },
	system_cloud_audit: { code: 94, text: '云端审计写入失败' },
	system_internal: { code: 95, text: '网关内部异常' },
	system_local_audit: { code: 96, text: '本地审计写入失败' },
	system_protocol: { code: 97, text: '协议或启动标识异常' },
	system_not_ready: { code: 98, text: '网关尚未就绪' },
	system_busy: { code: 99, text: '网关忙或请求并发' }
})

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).replace(/\s+/g, '').toUpperCase()
}

function isValidBottleNo(value) {
	return /^[A-Z0-9_-]{1,16}$/.test(normalizeBottleNo(value))
}

function chinaDayNumber(value = Date.now()) {
	const timestamp = value instanceof Date ? value.getTime() : Number(value)
	const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now()
	return Math.floor((safeTimestamp + 8 * 60 * 60 * 1000) / 86400000)
}

function chinaDayText(value = Date.now()) {
	const day = chinaDayNumber(value)
	return new Date(day * 86400000).toISOString().slice(0, 10)
}

function parseDateDay(value) {
	const text = normalizeString(value)
	const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!match) return null
	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const timestamp = Date.UTC(year, month - 1, day)
	const date = new Date(timestamp)
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
	return Math.floor(timestamp / 86400000)
}

function dateCheck(value, now = Date.now()) {
	const dueDay = parseDateDay(value)
	const today = chinaDayNumber(now)
	if (dueDay == null) return { valid: false, blocked: true, due_date: normalizeString(value), days_remaining: null }
	const daysRemaining = dueDay - today
	return {
		valid: true,
		blocked: daysRemaining <= 1,
		due_date: normalizeString(value),
		days_remaining: daysRemaining
	}
}

function maskFromFailures(failureKeys = []) {
	let mask = 0
	for (const key of failureKeys) {
		const bit = DETAIL_BITS[key]
		if (Number.isInteger(bit) && bit >= 0 && bit < 32) mask = (mask | (1 << bit)) >>> 0
	}
	return mask >>> 0
}

function maskParts(mask) {
	const value = Number(mask) >>> 0
	return { detail_mask: value, detail_mask_low: value & 0xffff, detail_mask_high: (value >>> 16) & 0xffff }
}

function publicBottleSnapshot(bottle) {
	if (!bottle || typeof bottle !== 'object') return null
	return {
		_id: normalizeString(bottle._id),
		bottle_no: normalizeBottleNo(bottle.bottle_no),
		is_active: bottle.is_active === true,
		status: normalizeString(bottle.status),
		bottle_next_check_date: normalizeString(bottle.bottle_next_check_date),
		pressure_gauge_next_check_date: normalizeString(bottle.pressure_gauge_next_check_date),
		safety_valve_next_check_date: normalizeString(bottle.safety_valve_next_check_date),
		updated_at: Number(bottle.updated_at || 0) || null
	}
}

function buildResult(failureKeys, options = {}) {
	const failures = Array.from(new Set(failureKeys || []))
	const allowed = failures.length === 0
	const reasonKey = allowed ? 'allowed' : failures[0]
	const reason = REASONS[reasonKey] || REASONS.system_internal
	const detail = maskParts(maskFromFailures(failures))
	return {
		allowed,
		outcome: allowed ? 'allowed' : options.outcome || 'business_denied',
		reason_code: reason.code,
		reason_key: reasonKey,
		reason_text: reason.text,
		failure_keys: failures,
		...detail,
		checks: options.checks || {},
		bottle_snapshot: options.bottleSnapshot || null,
		evaluated_day: chinaDayText(options.now),
		evaluated_at: Number(options.now instanceof Date ? options.now.getTime() : options.now) || Date.now()
	}
}

function systemDenied(reasonKey, options = {}) {
	const key = REASONS[reasonKey] ? reasonKey : 'system_internal'
	return buildResult([key], { ...options, outcome: 'system_denied' })
}

function evaluatePermit({ bottleNo, bottles, now = Date.now() } = {}) {
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	if (!isValidBottleNo(normalizedBottleNo)) {
		return { ...buildResult(['request_invalid'], { now }), normalized_bottle_no: normalizedBottleNo }
	}
	const matches = Array.isArray(bottles) ? bottles : []
	if (matches.length === 0) {
		return { ...buildResult(['bottle_not_found'], { now }), normalized_bottle_no: normalizedBottleNo }
	}
	if (matches.length !== 1) {
		return { ...buildResult(['bottle_not_unique'], { now }), normalized_bottle_no: normalizedBottleNo }
	}

	const bottle = matches[0]
	const failures = []
	const status = normalizeString(bottle.status)
	if (!VALID_STATUSES.includes(status)) failures.push('status_invalid')
	if (bottle.is_active !== true) failures.push('bottle_inactive')
	if (status === 'scrapped') failures.push('bottle_scrapped')
	if (status === 'lost') failures.push('bottle_lost')

	const checks = {
		bottle: dateCheck(bottle.bottle_next_check_date, now),
		pressure_gauge: dateCheck(bottle.pressure_gauge_next_check_date, now),
		safety_valve: dateCheck(bottle.safety_valve_next_check_date, now)
	}
	if (!checks.bottle.valid) failures.push('bottle_date_invalid')
	else if (checks.bottle.blocked) failures.push('bottle_date_blocked')
	if (!checks.pressure_gauge.valid) failures.push('pressure_gauge_date_invalid')
	else if (checks.pressure_gauge.blocked) failures.push('pressure_gauge_date_blocked')
	if (!checks.safety_valve.valid) failures.push('safety_valve_date_invalid')
	else if (checks.safety_valve.blocked) failures.push('safety_valve_date_blocked')

	return {
		...buildResult(failures, { now, checks, bottleSnapshot: publicBottleSnapshot(bottle) }),
		normalized_bottle_no: normalizedBottleNo
	}
}

module.exports = {
	VALID_STATUSES,
	DETAIL_BITS,
	REASONS,
	normalizeString,
	normalizeBottleNo,
	isValidBottleNo,
	chinaDayNumber,
	chinaDayText,
	parseDateDay,
	dateCheck,
	maskFromFailures,
	maskParts,
	publicBottleSnapshot,
	buildResult,
	systemDenied,
	evaluatePermit
}
