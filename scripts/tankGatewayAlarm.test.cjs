'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	normalizeAlarmConfig,
	buildAlarmCandidates,
	stabilizeAlarmCandidates,
	buildAlarmRuntime
} = require('../apps/tank-gateway/alarm.cjs')

test('normalizes the instrument-style range and correction settings', () => {
	const config = normalizeAlarmConfig({})
	assert.equal(config.levelRangeUpperKpa, 80)
	assert.equal(config.pressureRangeUpperMpa, 2.5)
	assert.equal(config.levelCorrectionKpa, 0)
	assert.equal(config.pressureCorrectionMpa, 0)
})

test('uses liquid level kPa and supports low-low/low/high/high-high thresholds', () => {
	const alarms = buildAlarmCandidates({
		telemetry: { level_percent: 1, level_kpa: 4, pressure_mpa: 0.2 },
		config: { levelLowLowKpa: 5, levelLowKpa: 10, levelHighKpa: 50, levelHighHighKpa: 60 }
	})
	assert.deepEqual(alarms.map((item) => item.code), ['level_low_low'])
	assert.equal(alarms[0].level, 'critical')

	const highAlarms = buildAlarmCandidates({
		telemetry: { level_percent: 1, level_kpa: 65, pressure_mpa: 0.2 },
		config: { levelLowLowKpa: 5, levelLowKpa: 10, levelHighKpa: 50, levelHighHighKpa: 60 }
	})
	assert.deepEqual(highAlarms.map((item) => item.code), ['level_high_high'])
	assert.equal(highAlarms[0].level, 'critical')

	const normalBoundaryAlarms = buildAlarmCandidates({
		telemetry: { level_percent: 99, level_kpa: 55, pressure_mpa: 0.2 },
		config: { levelLowLowKpa: 5, levelLowKpa: 10, levelHighKpa: 50, levelHighHighKpa: 60 }
	})
	assert.deepEqual(normalBoundaryAlarms.map((item) => item.code), ['level_high'])
})

test('supports four pressure thresholds independently', () => {
	const alarms = buildAlarmCandidates({
		telemetry: { level_kpa: 30, pressure_mpa: 0.02 },
		config: { pressureLowLowMpa: 0.05, pressureLowMpa: 0.1, pressureHighMpa: 1.2, pressureHighHighMpa: 1.5 }
	})
	assert.deepEqual(alarms.map((item) => item.code), ['pressure_low_low'])

	const highAlarms = buildAlarmCandidates({
		telemetry: { level_kpa: 30, pressure_mpa: 1.8 },
		config: { pressureLowLowMpa: 0.05, pressureLowMpa: 0.1, pressureHighMpa: 1.2, pressureHighHighMpa: 1.5 }
	})
	assert.deepEqual(highAlarms.map((item) => item.code), ['pressure_high_high'])
})

test('applies correction only to the alarm comparison value', () => {
	const alarms = buildAlarmCandidates({
		telemetry: { level_kpa: 35.6, pressure_mpa: 0.76 },
		config: {
			levelCorrectionKpa: 1,
			levelHighKpa: 36,
			pressureAlarmEnabled: false
		}
	})
	assert.equal(alarms[0].code, 'level_high')
	assert.match(alarms[0].message, /36\.60 kPa/)
})

test('communication alarm is generated for PLC read failure', () => {
	const alarms = buildAlarmCandidates({
		readError: 'S7 timeout',
		config: { communicationAlarmEnabled: true }
	})
	assert.equal(alarms[0].code, 'communication')
})

test('alarm activates after configured delay', () => {
	const candidates = [{ code: 'level_low', label: '液位过低', delayMs: 5000 }]
	const first = stabilizeAlarmCandidates(candidates, {}, 1000)
	assert.equal(first.length, 0)
	const runtime = buildAlarmRuntime(candidates, { level_low: { first_detected_at: 1000 } }, 6000)
	const second = Object.values(runtime).filter((item) => item.active)
	assert.equal(second.length, 1)
})
