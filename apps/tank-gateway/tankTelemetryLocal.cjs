'use strict'

const TANK_ESTIMATE_VERSION = 'main-continuous-2026-10-14-v1'
const TANK_LEVEL_OFFSET_KPA = 0.27
const TANK_LEVEL_SCALE = 101.14122757539592
const TANK_REFERENCE_DENSITY = 0.4459
// Manufacturer volume coordinates; the disputed 300 mm row is deliberately omitted.
// These are empirical model coordinates, not a certified mm/kPa conversion.
const TANK_VOLUME_TABLE = Object.freeze([
	[0, 0], [100, 0.1234], [307.67, 2.5131], [500, 4.802], [700, 7.1821],
	[900, 9.5623], [1100, 11.9425], [1300, 14.3227], [1500, 16.7028],
	[1700, 19.083], [1900, 21.4632], [2100, 23.8542], [2300, 26.2356],
	[2500, 28.6097], [2700, 30.9839], [2900, 33.364], [3100, 35.744],
	[3300, 38.1244], [3500, 40.504], [3700, 42.8847], [3900, 45.2649],
	[4100, 47.6451], [4300, 50.0253], [4500, 52.4054], [4633.97, 54],
	[4700, 54.7856], [4900, 57.1658]
].map(row => Object.freeze(row)))

function deriveTankEstimate(telemetry = {}) {
	telemetry = telemetry && typeof telemetry === 'object' ? telemetry : {}
	const result = { corrected_level_kpa: null, estimated_weight_t: null,
		estimate_version: TANK_ESTIMATE_VERSION, estimate_status: 'missing_level' }
	if (normalizeTankId(telemetry.tank_id ?? telemetry.tankId) !== 'main') {
		return { ...result, estimate_status: 'unsupported_tank' }
	}
	const raw = telemetry.level_kpa ?? telemetry.levelKpa
	if (raw == null || raw === '') return result
	const level = typeof raw === 'boolean' ? NaN : Number(raw)
	if (!Number.isFinite(level) || level < 0) return { ...result, estimate_status: 'invalid_level' }
	const corrected = level + TANK_LEVEL_OFFSET_KPA
	const height = TANK_LEVEL_SCALE * corrected
	if (height > TANK_VOLUME_TABLE.at(-1)[0]) return { ...result, estimate_status: 'out_of_range' }
	for (let index = 1; index < TANK_VOLUME_TABLE.length; index += 1) {
		const [leftHeight, leftVolume] = TANK_VOLUME_TABLE[index - 1]
		const [rightHeight, rightVolume] = TANK_VOLUME_TABLE[index]
		if (height > rightHeight) continue
		const volume = leftVolume + (height - leftHeight) * (rightVolume - leftVolume) / (rightHeight - leftHeight)
		return { ...result, corrected_level_kpa: corrected,
			estimated_weight_t: TANK_REFERENCE_DENSITY * volume, estimate_status: 'valid' }
	}
	return { ...result, estimate_status: 'out_of_range' }
}

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

function normalizeS7Address(value) {
	return normalizeString(value).replace(/\s+/g, '').toUpperCase()
}

function validateRawS7Addresses(raw) {
	if (normalizeString(raw && raw.protocol).toLowerCase() !== 's7') return ''
	const addresses = [
		['储罐液位', normalizeS7Address(raw.level_address || raw.levelAddress)],
		['储罐压力', normalizeS7Address(raw.pressure_address || raw.pressureAddress)],
		['LNG重量', normalizeS7Address(raw.weight_address || raw.weightAddress)]
	].filter((item) => item[1])
	for (let i = 0; i < addresses.length; i += 1) {
		for (let j = i + 1; j < addresses.length; j += 1) {
			if (addresses[i][1] === addresses[j][1]) {
				return `${addresses[i][0]}地址不能与${addresses[j][0]}地址相同：${addresses[i][1]}`
			}
		}
	}
	return ''
}

function buildTankSummary(row, now = Date.now()) {
	if (!row) {
		return {
			...deriveTankEstimate(),
			level_kpa: null,
			level_m: null,
			level_percent: null,
			pressure_mpa: null,
			lng_weight_t: null,
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
		...deriveTankEstimate(row),
		tank_id: normalizeTankId(row.tank_id),
		level_kpa: nullableNumber(row.level_kpa),
		level_m: nullableNumber(row.level_m),
		level_percent: nullableNumber(row.level_percent),
		pressure_mpa: nullableNumber(row.pressure_mpa),
		lng_weight_t: nullableNumber(row.lng_weight_t),
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
	const raw = normalizeRawTelemetry(data.raw)
	const addressError = validateRawS7Addresses(raw)
	if (status !== 'error' && addressError) return { ok: false, code: 400, msg: addressError }
	const levelKpa = nullableNumber(data.level_kpa ?? data.levelKpa)
	const levelM = nullableNumber(data.level_m ?? data.levelM)
	const pressureMpa = nullableNumber(data.pressure_mpa ?? data.pressureMpa)
	const lngWeightT = nullableNumber(data.lng_weight_t ?? data.lngWeightT)
	const rawLevelReferenceKpa = nullableNumber(data.level_reference_kpa ?? data.levelReferenceKpa)
	const rawLevelReferencePercent = nullableNumber(data.level_reference_percent ?? data.levelReferencePercent)
	const levelReferenceKpa =
		rawLevelReferenceKpa != null && rawLevelReferenceKpa > 0 ? rawLevelReferenceKpa : levelKpa != null ? 35.6 : null
	const levelReferencePercent =
		rawLevelReferencePercent != null && rawLevelReferencePercent > 0
			? rawLevelReferencePercent
			: levelKpa != null
				? 72
				: null
	const rawFullLevelM = nullableNumber(data.full_level_m ?? data.fullLevelM)
	const fullLevelM = rawFullLevelM != null && rawFullLevelM > 0 ? rawFullLevelM : levelM != null ? 10 : null
	const explicitPercent = nullableNumber(data.level_percent ?? data.levelPercent)
	const computedPercent =
		levelKpa != null && levelReferenceKpa > 0 && levelReferencePercent > 0
			? (levelKpa / levelReferenceKpa) * levelReferencePercent
			: levelM != null && fullLevelM > 0
				? (levelM / fullLevelM) * 100
				: null
	const levelPercent = explicitPercent != null ? explicitPercent : computedPercent
	const sampledAt = normalizeTimestamp(data.sampled_at ?? data.sampledAt, now)

	if (status !== 'error' && ((levelKpa == null && levelM == null) || pressureMpa == null)) {
		return { ok: false, code: 400, msg: '缺少有效液位或压力读数' }
	}

	return {
		ok: true,
		doc: {
			tank_id: tankId,
			gateway_id: gatewayId,
			plc_host: normalizeString(data.plc_host || data.plcHost),
			status,
			level_kpa: levelKpa == null ? null : fix2(levelKpa),
			level_m: levelM == null ? null : fix2(levelM),
			level_percent: levelPercent == null ? null : fix2(clampNumber(levelPercent, 0, 100)),
			pressure_mpa: pressureMpa == null ? null : fix2(pressureMpa),
			lng_weight_t: lngWeightT == null ? null : fix2(lngWeightT),
			level_reference_kpa: levelReferenceKpa,
			level_reference_percent: levelReferencePercent,
			full_level_m: fullLevelM,
			raw,
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
			...deriveTankEstimate(),
			level_kpa: null,
			level_m: null,
			level_percent: null,
			pressure_mpa: null,
			lng_weight_t: null,
			status: 'error',
			sampled_at: null,
			updated_at: null,
			message: '储罐读数加载失败'
		}
	}
}

module.exports = {
	TANK_ESTIMATE_VERSION,
	TANK_LEVEL_OFFSET_KPA,
	TANK_LEVEL_SCALE,
	TANK_VOLUME_TABLE,
	deriveTankEstimate,
	normalizeString,
	fix2,
	clampNumber,
	normalizeTimestamp,
	normalizeTankId,
	normalizeTankStatus,
	nullableNumber,
	normalizeRawTelemetry,
	normalizeS7Address,
	validateRawS7Addresses,
	buildTankSummary,
	buildTankTelemetryDoc,
	upsertTankTelemetry,
	getTankTelemetrySummary
}
