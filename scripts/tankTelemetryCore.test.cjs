'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
	DEFAULT_TANK_CONFIG,
	normalizeGatewayConfig,
	repairKnownGatewayConfig,
	validateGatewayConfig,
	buildTankTelemetryFromValues
} = require('./tankTelemetryCore.cjs')
const cloudTankTelemetry = require('../uniCloud-alipay/cloudfunctions/crm-tank-gateway/tankTelemetry.js')

test('uses the repaired PLC defaults and translated VD addresses', () => {
	const config = normalizeGatewayConfig({ gatewayId: 'test-gateway' })
	assert.equal(config.host, '192.168.2.1')
	assert.equal(config.levelAddress, 'DB1,REAL100')
	assert.equal(config.pressureAddress, 'DB1,REAL104')
	assert.equal(config.weightAddress, 'DB1,REAL140')
	assert.equal(config.levelReferenceKpa, 35.6)
	assert.equal(config.levelReferencePercent, 72)
})

test('converts 35.60 kPa to 72 percent and keeps all readings at two decimals', () => {
	const telemetry = buildTankTelemetryFromValues(
		{ ...DEFAULT_TANK_CONFIG, gatewayId: 'test-gateway' },
		{ level: 35.6, pressure: 0.864, weight: 18.404 }
	)
	assert.equal(telemetry.level_kpa, 35.6)
	assert.equal(telemetry.level_percent, 72)
	assert.equal(telemetry.pressure_mpa, 0.86)
	assert.equal(telemetry.lng_weight_t, 18.4)
})

test('clamps converted liquid level percentage to 100 percent', () => {
	const telemetry = buildTankTelemetryFromValues(
		{ ...DEFAULT_TANK_CONFIG, gatewayId: 'test-gateway' },
		{ level: 60, pressure: 0.5, weight: 25 }
	)
	assert.equal(telemetry.level_percent, 100)
})

test('repairs the known persisted configuration that maps level and weight to VD140', () => {
	const repaired = repairKnownGatewayConfig({
		levelAddress: 'DB1,REAL140',
		pressureAddress: 'DB1,REAL104',
		weightAddress: 'DB1,REAL140'
	})
	assert.equal(repaired.levelAddress, 'DB1,REAL100')
	assert.equal(repaired.weightAddress, 'DB1,REAL140')
})

test('rejects duplicate PLC addresses before reading or uploading', () => {
	assert.throws(
		() =>
			validateGatewayConfig({
				levelAddress: 'db1, real140',
				pressureAddress: 'DB1,REAL104',
				weightAddress: 'DB1,REAL140'
			}),
		/储罐液位地址不能与LNG重量地址相同/
	)
})

test('cloud payload keeps kPa, MPa, ton and calibrated percentage fields', () => {
	const result = cloudTankTelemetry.buildTankTelemetryDoc(
		{
			status: 'online',
			level_kpa: 35.6,
			pressure_mpa: 0.864,
			lng_weight_t: 18.404,
			level_reference_kpa: 35.6,
			level_reference_percent: 72
		},
		1000
	)
	assert.equal(result.ok, true)
	assert.equal(result.doc.level_kpa, 35.6)
	assert.equal(result.doc.level_percent, 72)
	assert.equal(result.doc.pressure_mpa, 0.86)
	assert.equal(result.doc.lng_weight_t, 18.4)
})

test('cloud rejects telemetry when level and weight use the same S7 address', () => {
	const result = cloudTankTelemetry.buildTankTelemetryDoc({
		status: 'online',
		level_kpa: 14.82,
		pressure_mpa: 0.57,
		lng_weight_t: 14.82,
		raw: {
			protocol: 's7',
			level_address: 'DB1,REAL140',
			pressure_address: 'DB1,REAL104',
			weight_address: 'DB1,REAL140'
		}
	})
	assert.equal(result.ok, false)
	assert.match(result.msg, /储罐液位地址不能与LNG重量地址相同/)
})
