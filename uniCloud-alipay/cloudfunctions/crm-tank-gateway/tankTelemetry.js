'use strict'

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function fix2(value) {
	const num = Number(value || 0)
	return Math.round(num * 100) / 100
}

function clampNumber(value, min, max) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return Math.min(Math.max(num, min), max)
}

function normalizeTimestamp(value, fallback = Date.now()) {
	if (value == null || value === '') return fallback
	const num = Number(value)
	if (Number.isFinite(num) && num > 0) return num < 1000000000000 ? num * 1000 : num
	const parsed = Date.parse(String(value))
	return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeTankId(value) {
	return normalizeString(value) || 'main'
}

function normalizeTankStatus(value, fallback = 'online') {
	const text = normalizeString(value).toLowerCase()
	if (text === 'online' || text === 'stale' || text === 'error' || text === 'empty') return text
	return fallback
}

function nullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function normalizeRawTelemetry(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	return raw
}

function buildTankSummary(row, now = Date.now()) {
	if (!row) {
		return {
			level_m: null,
			level_percent: null,
			pressure_mpa: null,
			status: 'empty',
			sampled_at: null,
			updated_at: null,
			message: '等待现场网关上报'
		}
	}
	const sampledAt = nullableNumber(row.sampled_at)
	const updatedAt = nullableNumber(row.updated_at)
	const ageBase = sampledAt || updatedAt || 0
	const baseStatus = normalizeTankStatus(row.status)
	const isStale = baseStatus !== 'error' && ageBase > 0 && now - ageBase > 60 * 1000
	const status = isStale ? 'stale' : baseStatus
	const fallbackMessage =
		status === 'stale'
			? '超过60秒未收到新数据'
			: status === 'error'
				? '采集异常'
				: status === 'empty'
					? '等待现场网关上报'
					: ''
	return {
		level_m: nullableNumber(row.level_m),
		level_percent: nullableNumber(row.level_percent),
		pressure_mpa: nullableNumber(row.pressure_mpa),
		status,
		sampled_at: sampledAt,
		updated_at: updatedAt,
		message: status === 'stale' ? fallbackMessage : normalizeString(row.message) || fallbackMessage
	}
}

function buildTankTelemetryDoc(data = {}, now = Date.now()) {
	const tankId = normalizeTankId(data.tank_id || data.tankId)
	const gatewayId = normalizeString(data.gateway_id || data.gatewayId) || 'tank-gateway'
	const status = normalizeTankStatus(data.status, 'online')
	const levelM = nullableNumber(data.level_m ?? data.levelM)
	const pressureMpa = nullableNumber(data.pressure_mpa ?? data.pressureMpa)
	const rawFullLevelM = nullableNumber(data.full_level_m ?? data.fullLevelM)
	const fullLevelM = rawFullLevelM != null && rawFullLevelM > 0 ? rawFullLevelM : 10
	const explicitPercent = nullableNumber(data.level_percent ?? data.levelPercent)
	const computedPercent = levelM != null && fullLevelM > 0 ? (levelM / fullLevelM) * 100 : null
	const levelPercent = explicitPercent != null ? explicitPercent : computedPercent
	const sampledAt = normalizeTimestamp(data.sampled_at ?? data.sampledAt, now)

	if (status !== 'error' && (levelM == null || pressureMpa == null)) {
		return { ok: false, code: 400, msg: '缺少有效液位或压力读数' }
	}

	return {
		ok: true,
		doc: {
			tank_id: tankId,
			gateway_id: gatewayId,
			plc_host: normalizeString(data.plc_host || data.plcHost),
			status,
			level_m: levelM == null ? null : fix2(levelM),
			level_percent: levelPercent == null ? null : fix2(clampNumber(levelPercent, 0, 100)),
			pressure_mpa: pressureMpa == null ? null : fix2(pressureMpa),
			full_level_m: fullLevelM,
			raw: normalizeRawTelemetry(data.raw),
			message: normalizeString(data.message),
			sampled_at: sampledAt,
			updated_at: now
		}
	}
}

async function upsertTankTelemetry(tankTelemetryCollection, data = {}, now = Date.now()) {
	const built = buildTankTelemetryDoc(data, now)
	if (!built.ok) return { code: built.code || 400, msg: built.msg || '储罐读数无效' }

	const doc = built.doc
	const existingRes = await tankTelemetryCollection.where({ tank_id: doc.tank_id }).field({ _id: true }).limit(1).get()
	const existing = existingRes.data && existingRes.data[0]
	if (existing && existing._id) {
		await tankTelemetryCollection.doc(existing._id).update(doc)
	} else {
		await tankTelemetryCollection.add({ ...doc, created_at: now })
	}

	return { code: 0, data: buildTankSummary(doc, now), doc }
}

async function getTankTelemetrySummary(tankTelemetryCollection, tankId = 'main') {
	try {
		const res = await tankTelemetryCollection
			.where({ tank_id: normalizeTankId(tankId) })
			.orderBy('updated_at', 'desc')
			.limit(1)
			.get()
		return buildTankSummary((res.data && res.data[0]) || null)
	} catch (err) {
		console.error('[tank-telemetry] getTankTelemetrySummary failed', err)
		return {
			level_m: null,
			level_percent: null,
			pressure_mpa: null,
			status: 'error',
			sampled_at: null,
			updated_at: null,
			message: '储罐读数加载失败'
		}
	}
}

module.exports = {
	normalizeString,
	fix2,
	clampNumber,
	normalizeTimestamp,
	normalizeTankId,
	normalizeTankStatus,
	nullableNumber,
	normalizeRawTelemetry,
	buildTankSummary,
	buildTankTelemetryDoc,
	upsertTankTelemetry,
	getTankTelemetrySummary
}
