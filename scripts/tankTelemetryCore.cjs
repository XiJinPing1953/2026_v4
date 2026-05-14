#!/usr/bin/env node
'use strict'

const nodes7 = require('nodes7')
const os = require('os')

const DEFAULT_TANK_CONFIG = Object.freeze({
	host: '192.168.0.1',
	port: 102,
	rack: 0,
	slot: 1,
	levelAddress: 'DB1,REAL2000',
	pressureAddress: 'DB1,REAL2040',
	fullLevelM: 10,
	intervalMs: 5000,
	timeoutMs: 5000,
	tankId: 'main'
})

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function toInt(value, fallback) {
	const num = Math.trunc(toNumber(value, fallback))
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	const num = Number(value || 0)
	return Math.round(num * 100) / 100
}

function parseBool(value, fallback = false) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	return text === '1' || text === 'true' || text === 'yes' || text === 'y' || text === 'on'
}

function normalizeGatewayConfig(input = {}) {
	const config = {
		host: normalizeString(input.host) || DEFAULT_TANK_CONFIG.host,
		port: toInt(input.port, DEFAULT_TANK_CONFIG.port),
		rack: toInt(input.rack, DEFAULT_TANK_CONFIG.rack),
		slot: toInt(input.slot, DEFAULT_TANK_CONFIG.slot),
		levelAddress: normalizeString(input.levelAddress || input.level_address) || DEFAULT_TANK_CONFIG.levelAddress,
		pressureAddress: normalizeString(input.pressureAddress || input.pressure_address) || DEFAULT_TANK_CONFIG.pressureAddress,
		fullLevelM: toNumber(input.fullLevelM ?? input.full_level_m, DEFAULT_TANK_CONFIG.fullLevelM),
		intervalMs: toInt(input.intervalMs ?? input.pollMs ?? input.poll_ms, DEFAULT_TANK_CONFIG.intervalMs),
		timeoutMs: toInt(input.timeoutMs ?? input.timeout_ms, DEFAULT_TANK_CONFIG.timeoutMs),
		tankId: normalizeString(input.tankId || input.tank_id) || DEFAULT_TANK_CONFIG.tankId,
		gatewayId: normalizeString(input.gatewayId || input.gateway_id) || os.hostname() || 'tank-gateway'
	}
	if (!config.fullLevelM || config.fullLevelM <= 0) config.fullLevelM = DEFAULT_TANK_CONFIG.fullLevelM
	if (config.intervalMs < 1000) config.intervalMs = 1000
	if (config.timeoutMs < 500) config.timeoutMs = 500
	return config
}

function readS7Items(configInput = {}) {
	const config = normalizeGatewayConfig(configInput)
	return new Promise((resolve, reject) => {
		let settled = false
		const conn = new nodes7()
		const timer = setTimeout(() => finish(new Error(`S7 timeout ${config.host}:${config.port}`)), config.timeoutMs)
		const vars = {
			level: config.levelAddress,
			pressure: config.pressureAddress
		}

		function finish(err, values) {
			if (settled) return
			settled = true
			clearTimeout(timer)
			try {
				conn.dropConnection()
			} catch (_) {}
			if (err) reject(err)
			else resolve(values || {})
		}

		conn.initiateConnection(
			{
				host: config.host,
				port: config.port,
				rack: config.rack,
				slot: config.slot
			},
			(err) => {
				if (err) return finish(err)
				try {
					conn.setTranslationCB((tag) => vars[tag])
					conn.addItems(['level', 'pressure'])
					conn.readAllItems((readErr, values) => finish(readErr, values || {}))
				} catch (readErr) {
					finish(readErr)
				}
			}
		)
	})
}

function buildTankTelemetryFromValues(configInput = {}, values = {}) {
	const config = normalizeGatewayConfig(configInput)
	const levelM = toNumber(values.level, null)
	const pressureMpa = toNumber(values.pressure, null)
	if (levelM == null || pressureMpa == null) {
		throw new Error(`S7读取结果无效: ${JSON.stringify(values)}`)
	}
	const levelPercent = Math.min(Math.max((levelM / config.fullLevelM) * 100, 0), 100)
	return {
		tank_id: config.tankId,
		gateway_id: config.gatewayId,
		plc_host: config.host,
		status: 'online',
		level_m: fix2(levelM),
		level_percent: fix2(levelPercent),
		pressure_mpa: fix2(pressureMpa),
		full_level_m: config.fullLevelM,
		sampled_at: Date.now(),
		raw: {
			protocol: 's7',
			port: config.port,
			rack: config.rack,
			slot: config.slot,
			level_address: config.levelAddress,
			pressure_address: config.pressureAddress
		}
	}
}

async function readTankTelemetry(configInput = {}) {
	const config = normalizeGatewayConfig(configInput)
	const values = await readS7Items(config)
	return buildTankTelemetryFromValues(config, values)
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
	DEFAULT_TANK_CONFIG,
	normalizeString,
	toNumber,
	toInt,
	fix2,
	parseBool,
	normalizeGatewayConfig,
	readS7Items,
	buildTankTelemetryFromValues,
	readTankTelemetry,
	sleep
}
