'use strict'

const DEFAULT_SCALE_CODE = 'filling_scale_main'

function toWord(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Math.max(0, Math.min(0xffff, Math.trunc(num)))
}

function toSignedInt32(lowWord, highWord) {
	const low = toWord(lowWord)
	const high = toWord(highWord)
	const unsigned = high * 0x10000 + low
	return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned
}

function toNullableNumber(value) {
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function roundNumber(value, digits = 6) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return Number(num.toFixed(digits))
}

function convertUnitToKg(scaledValue, unitCode) {
	const value = Number(scaledValue)
	if (!Number.isFinite(value)) return null
	const unit = Number(unitCode)
	if (unit === 0) return value / 1000
	if (unit === 1) return value
	if (unit === 2) return value * 1000
	if (unit === 3) return value / 1000000
	return null
}

function decodeScaleRegisters(realtimeRegisters = [], config = {}) {
	const realtime = Array.isArray(realtimeRegisters) ? realtimeRegisters : []
	if (realtime.length < 5) throw new Error('实时寄存器数量不足，至少需要 5 个')
	const rawWeight = toSignedInt32(realtime[0], realtime[1])
	const stableMetric = toNullableNumber(realtime[4])
	const stableThreshold = toNullableNumber(config.stableThreshold)
	const unitCode = toNullableNumber(config.unitCode)
	const divisionValue = toNullableNumber(config.divisionValue)
	const decimalPlaces = Math.max(0, Math.trunc(toNullableNumber(config.decimalPlaces) || 0))
	const scaledValue = rawWeight / 10 ** decimalPlaces
	const weightKg = convertUnitToKg(scaledValue, unitCode)
	return {
		weight_raw: rawWeight,
		weight_kg: roundNumber(weightKg, 6),
		unit_code: unitCode,
		decimal_places: decimalPlaces,
		stable_metric: stableMetric,
		stable_threshold: stableThreshold,
		is_stable:
			stableMetric != null && stableThreshold != null ? Number(stableMetric) <= Number(stableThreshold) : false,
		overload_supported: false,
		overload: null,
		protocol_meta: {
			division_value: divisionValue
		}
	}
}

const MOCK_FRAMES = [
	{
		name: 'stable_kg',
		realtime: [1234, 0, 0, 0, 2],
		config: { stableThreshold: 3, unitCode: 1, divisionValue: 1, decimalPlaces: 1 }
	},
	{
		name: 'moving_kg',
		realtime: [1248, 0, 0, 0, 8],
		config: { stableThreshold: 3, unitCode: 1, divisionValue: 1, decimalPlaces: 1 }
	},
	{
		name: 'stable_g',
		realtime: [25340, 0, 0, 0, 1],
		config: { stableThreshold: 2, unitCode: 0, divisionValue: 1, decimalPlaces: 0 }
	}
]

function getMockFrame(index = 0) {
	const frame = MOCK_FRAMES[Math.abs(Number(index) || 0) % MOCK_FRAMES.length]
	return {
		name: frame.name,
		decoded: decodeScaleRegisters(frame.realtime, frame.config)
	}
}

module.exports = {
	DEFAULT_SCALE_CODE,
	toSignedInt32,
	convertUnitToKg,
	decodeScaleRegisters,
	getMockFrame
}
