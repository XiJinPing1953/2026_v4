'use strict'

function nullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function readNumber(source, camelKey, snakeKey, fallback = null) {
	const value = source[camelKey] ?? source[snakeKey]
	return value == null ? fallback : nullableNumber(value)
}

function readBoolean(source, camelKey, snakeKey, fallback) {
	if (source[camelKey] == null && source[snakeKey] == null) return fallback
	return source[camelKey] !== false && source[snakeKey] !== false
}

function normalizeAlarmConfig(input = {}) {
	const source = input && typeof input === 'object' ? input : {}
	const legacyAlarmEnabled = readBoolean(source, 'alarmEnabled', 'alarm_enabled', true)
	const levelAlarmEnabled = readBoolean(source, 'levelAlarmEnabled', 'level_alarm_enabled', legacyAlarmEnabled)
	const pressureAlarmEnabled = readBoolean(source, 'pressureAlarmEnabled', 'pressure_alarm_enabled', legacyAlarmEnabled)
	const levelLowLowKpa = readNumber(source, 'levelLowLowKpa', 'level_low_low_kpa')
	const levelLowKpa = readNumber(source, 'levelLowKpa', 'level_low_kpa')
	const levelHighKpa = readNumber(source, 'levelHighKpa', 'level_high_kpa')
	const levelHighHighKpa = readNumber(source, 'levelHighHighKpa', 'level_high_high_kpa')
	const pressureLowLowMpa = readNumber(source, 'pressureLowLowMpa', 'pressure_low_low_mpa')
	const pressureLowMpa = readNumber(source, 'pressureLowMpa', 'pressure_low_mpa')
	const pressureHighMpa = readNumber(source, 'pressureHighMpa', 'pressure_high_mpa')
	const pressureHighHighMpa = readNumber(source, 'pressureHighHighMpa', 'pressure_high_high_mpa')
	const nonNegative = (value) => (value == null ? null : Math.max(value, 0))
	return {
		alarmEnabled: levelAlarmEnabled || pressureAlarmEnabled,
		levelAlarmEnabled,
		pressureAlarmEnabled,
		communicationAlarmEnabled: source.communicationAlarmEnabled !== false && source.communication_alarm_enabled !== false,
		levelRangeUpperKpa: nonNegative(readNumber(source, 'levelRangeUpperKpa', 'level_range_upper_kpa', 80)),
		levelRangeLowerKpa: nonNegative(readNumber(source, 'levelRangeLowerKpa', 'level_range_lower_kpa', 0)),
		levelCorrectionKpa: nullableNumber(source.levelCorrectionKpa ?? source.level_correction_kpa) ?? 0,
		pressureRangeUpperMpa: nonNegative(readNumber(source, 'pressureRangeUpperMpa', 'pressure_range_upper_mpa', 2.5)),
		pressureRangeLowerMpa: nonNegative(readNumber(source, 'pressureRangeLowerMpa', 'pressure_range_lower_mpa', 0)),
		pressureCorrectionMpa: nullableNumber(source.pressureCorrectionMpa ?? source.pressure_correction_mpa) ?? 0,
		levelLowLowKpa: nonNegative(levelLowLowKpa),
		levelLowKpa: nonNegative(levelLowKpa),
		levelHighKpa: nonNegative(levelHighKpa),
		levelHighHighKpa: nonNegative(levelHighHighKpa),
		pressureLowLowMpa: nonNegative(pressureLowLowMpa),
		pressureLowMpa: nonNegative(pressureLowMpa),
		pressureHighMpa: nonNegative(pressureHighMpa),
		pressureHighHighMpa: nonNegative(pressureHighHighMpa),
		alarmDelayMs: Math.min(Math.max(Math.trunc(nullableNumber(source.alarmDelayMs ?? source.alarm_delay_ms) ?? 5000), 0), 600000),
		communicationDelayMs: Math.min(
			Math.max(Math.trunc(nullableNumber(source.communicationDelayMs ?? source.communication_delay_ms) ?? 5000), 0),
			600000
		)
	}
}

function buildAlarmCandidates({ telemetry = null, readError = '', config = {} } = {}) {
	const policy = normalizeAlarmConfig(config)
	const candidates = []
	const errorMessage = String(readError || '').trim()

	if (errorMessage && policy.communicationAlarmEnabled) {
		candidates.push({
			code: 'communication',
			level: 'critical',
			label: 'PLC通信异常',
			message: errorMessage,
			delayMs: policy.communicationDelayMs
		})
		return candidates
	}

	if (!telemetry) return candidates

	const rawLevelKpa = nullableNumber(telemetry.level_kpa)
	const levelKpa = rawLevelKpa == null ? null : rawLevelKpa + policy.levelCorrectionKpa
	if (policy.levelAlarmEnabled && levelKpa != null) {
		if (policy.levelLowLowKpa != null && levelKpa < policy.levelLowLowKpa) {
			candidates.push({
				code: 'level_low_low',
				level: 'critical',
				label: '液位低低限',
				message: `当前 ${levelKpa.toFixed(2)} kPa，低于低低限 ${policy.levelLowLowKpa.toFixed(2)} kPa`,
				value: levelKpa,
				threshold: policy.levelLowLowKpa,
				delayMs: policy.alarmDelayMs
			})
		} else if (policy.levelLowKpa != null && levelKpa < policy.levelLowKpa) {
			candidates.push({
				code: 'level_low',
				level: 'warning',
				label: '液位低限',
				message: `当前 ${levelKpa.toFixed(2)} kPa，低于低限 ${policy.levelLowKpa.toFixed(2)} kPa`,
				value: levelKpa,
				threshold: policy.levelLowKpa,
				delayMs: policy.alarmDelayMs
			})
		}
		if (policy.levelHighHighKpa != null && levelKpa > policy.levelHighHighKpa) {
			candidates.push({
				code: 'level_high_high',
				level: 'critical',
				label: '液位高高限',
				message: `当前 ${levelKpa.toFixed(2)} kPa，高于高高限 ${policy.levelHighHighKpa.toFixed(2)} kPa`,
				value: levelKpa,
				threshold: policy.levelHighHighKpa,
				delayMs: policy.alarmDelayMs
			})
		} else if (policy.levelHighKpa != null && levelKpa > policy.levelHighKpa) {
			candidates.push({
				code: 'level_high',
				level: 'warning',
				label: '液位高限',
				message: `当前 ${levelKpa.toFixed(2)} kPa，高于高限 ${policy.levelHighKpa.toFixed(2)} kPa`,
				value: levelKpa,
				threshold: policy.levelHighKpa,
				delayMs: policy.alarmDelayMs
			})
		}
	}

	const rawPressureMpa = nullableNumber(telemetry.pressure_mpa)
	const pressureMpa = rawPressureMpa == null ? null : rawPressureMpa + policy.pressureCorrectionMpa
	if (policy.pressureAlarmEnabled && pressureMpa != null) {
		if (policy.pressureLowLowMpa != null && pressureMpa < policy.pressureLowLowMpa) {
			candidates.push({
				code: 'pressure_low_low',
				level: 'critical',
				label: '压力低低限',
				message: `当前 ${pressureMpa.toFixed(2)} MPa，低于低低限 ${policy.pressureLowLowMpa.toFixed(2)} MPa`,
				value: pressureMpa,
				threshold: policy.pressureLowLowMpa,
				delayMs: policy.alarmDelayMs
			})
		} else if (policy.pressureLowMpa != null && pressureMpa < policy.pressureLowMpa) {
			candidates.push({
				code: 'pressure_low',
				level: 'warning',
				label: '压力低限',
				message: `当前 ${pressureMpa.toFixed(2)} MPa，低于低限 ${policy.pressureLowMpa.toFixed(2)} MPa`,
				value: pressureMpa,
				threshold: policy.pressureLowMpa,
				delayMs: policy.alarmDelayMs
			})
		}
		if (policy.pressureHighHighMpa != null && pressureMpa > policy.pressureHighHighMpa) {
			candidates.push({
				code: 'pressure_high_high',
				level: 'critical',
				label: '压力高高限',
				message: `当前 ${pressureMpa.toFixed(2)} MPa，高于高高限 ${policy.pressureHighHighMpa.toFixed(2)} MPa`,
				value: pressureMpa,
				threshold: policy.pressureHighHighMpa,
				delayMs: policy.alarmDelayMs
			})
		} else if (policy.pressureHighMpa != null && pressureMpa > policy.pressureHighMpa) {
			candidates.push({
				code: 'pressure_high',
				level: 'warning',
				label: '压力高限',
				message: `当前 ${pressureMpa.toFixed(2)} MPa，高于高限 ${policy.pressureHighMpa.toFixed(2)} MPa`,
				value: pressureMpa,
				threshold: policy.pressureHighMpa,
				delayMs: policy.alarmDelayMs
			})
		}
	}

	return candidates
}

function stabilizeAlarmCandidates(candidates = [], previous = {}, now = Date.now()) {
	const next = {}
	const list = Array.isArray(candidates) ? candidates : []
	for (let i = 0; i < list.length; i += 1) {
		const candidate = list[i]
		if (!candidate || !candidate.code) continue
		const prior = previous[candidate.code]
		const firstDetectedAt = prior?.first_detected_at || now
		const active = Boolean(prior?.active) || now - firstDetectedAt >= Math.max(Number(candidate.delayMs) || 0, 0)
		next[candidate.code] = {
			...candidate,
			first_detected_at: firstDetectedAt,
			active_at: active ? prior?.active_at || now : null,
			active
		}
	}
	return Object.values(next).filter((item) => item.active)
}

function buildAlarmRuntime(candidates = [], previous = {}, now = Date.now()) {
	const next = {}
	const list = Array.isArray(candidates) ? candidates : []
	for (let i = 0; i < list.length; i += 1) {
		const candidate = list[i]
		if (!candidate || !candidate.code) continue
		const prior = previous[candidate.code]
		const firstDetectedAt = prior?.first_detected_at || now
		const active = Boolean(prior?.active) || now - firstDetectedAt >= Math.max(Number(candidate.delayMs) || 0, 0)
		next[candidate.code] = {
			...candidate,
			first_detected_at: firstDetectedAt,
			active_at: active ? prior?.active_at || now : null,
			active
		}
	}
	return next
}

module.exports = {
	normalizeAlarmConfig,
	buildAlarmCandidates,
	stabilizeAlarmCandidates,
	buildAlarmRuntime
}
