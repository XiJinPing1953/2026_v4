#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
	ensureCrmToken,
	generateRequestId,
	prepareClientOptions
} = require('../lib/qrImportCommon.cjs')
const { DEFAULT_SCALE_CODE, decodeScaleRegisters, getMockFrame } = require('./protocol.cjs')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toPositiveInt(value, fallback) {
	const num = Number(value)
	return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(Number(ms) || 0, 0)))
}

function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return
	const raw = fs.readFileSync(filePath, 'utf8')
	raw.split(/\r?\n/).forEach((line) => {
		const text = normalizeString(line)
		if (!text || text.startsWith('#')) return
		const separator = text.indexOf('=')
		if (separator <= 0) return
		const key = text.slice(0, separator).trim()
		const value = text.slice(separator + 1).trim()
		if (!key || process.env[key] != null) return
		process.env[key] = value.replace(/^['"]|['"]$/g, '')
	})
}

function parseArgs(argv) {
	const args = {
		mock: false,
		dryRun: false,
		once: false,
		help: false
	}
	for (let index = 2; index < argv.length; index += 1) {
		const current = argv[index]
		if (current === '--mock') args.mock = true
		else if (current === '--dry-run') args.dryRun = true
		else if (current === '--once') args.once = true
		else if (current === '--help' || current === '-h') args.help = true
	}
	return args
}

function printHelp() {
	console.log(`
用法:
  node index.cjs
  node index.cjs --mock
  node index.cjs --mock --dry-run
  node index.cjs --once

环境变量:
  SCALE_SERIAL_PORT / SCALE_BAUD_RATE / SCALE_DATA_BITS / SCALE_STOP_BITS / SCALE_PARITY / SCALE_SLAVE_ID
  SCALE_CODE / SCALE_POLL_MS / SCALE_HEARTBEAT_MS
  CRM_SPACE_ID + CRM_CLIENT_SECRET 或 CRM_ACCESS_KEY / CRM_SECRET_KEY / CRM_SPACE_APP_ID
  GATEWAY_USERNAME / GATEWAY_PASSWORD
  SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD
`.trim())
}

function loadConfig(args) {
	const scriptDir = __dirname
	loadEnvFile(path.join(scriptDir, '.env'))
	return {
		mock: args.mock === true,
		dryRun: args.dryRun === true,
		once: args.once === true,
		scaleCode: normalizeString(process.env.SCALE_CODE) || DEFAULT_SCALE_CODE,
		serialPort: normalizeString(process.env.SCALE_SERIAL_PORT),
		baudRate: toPositiveInt(process.env.SCALE_BAUD_RATE, 115200),
		dataBits: toPositiveInt(process.env.SCALE_DATA_BITS, 8),
		stopBits: toPositiveInt(process.env.SCALE_STOP_BITS, 1),
		parity: normalizeString(process.env.SCALE_PARITY) || 'none',
		slaveId: toPositiveInt(process.env.SCALE_SLAVE_ID, 1),
		pollMs: toPositiveInt(process.env.SCALE_POLL_MS, 200),
		heartbeatMs: toPositiveInt(process.env.SCALE_HEARTBEAT_MS, 2000),
		crmSpaceId: normalizeString(process.env.CRM_SPACE_ID || process.env.UNI_SPACE_ID),
		clientSecret: normalizeString(process.env.CRM_CLIENT_SECRET || process.env.UNI_CLIENT_SECRET),
		endpoint: normalizeString(process.env.CRM_ENDPOINT || process.env.UNI_ENDPOINT),
		accessKey: normalizeString(process.env.CRM_ACCESS_KEY || process.env.UNI_ACCESS_KEY),
		secretKey: normalizeString(process.env.CRM_SECRET_KEY || process.env.UNI_SECRET_KEY),
		spaceAppId: normalizeString(process.env.CRM_SPACE_APP_ID || process.env.UNI_SPACE_APP_ID),
		crmUsername:
			normalizeString(process.env.GATEWAY_USERNAME) ||
			normalizeString(process.env.SUPERADMIN_USERNAME) ||
			normalizeString(process.env.CRM_USERNAME) ||
			'superadmin',
		crmPassword:
			normalizeString(process.env.GATEWAY_PASSWORD) ||
			normalizeString(process.env.SUPERADMIN_PASSWORD) ||
			normalizeString(process.env.CRM_PASSWORD)
	}
}

function assertConfig(config) {
	if (!config.mock && !config.serialPort) {
		throw new Error('缺少 SCALE_SERIAL_PORT，真机模式必须指定串口')
	}
	if (!config.dryRun && !config.crmSpaceId) {
		throw new Error('缺少 CRM_SPACE_ID，无法上报云端最新秤值')
	}
	if (!config.dryRun) {
		const hasClientSecret = Boolean(config.clientSecret)
		const hasOpenApiKeys = Boolean(config.accessKey && config.secretKey && config.spaceAppId)
		if (!hasClientSecret && !hasOpenApiKeys) {
			throw new Error('缺少云空间鉴权参数，请提供 CRM_CLIENT_SECRET 或 CRM_ACCESS_KEY / CRM_SECRET_KEY / CRM_SPACE_APP_ID')
		}
		if (!config.crmPassword) {
			throw new Error('缺少网关登录密码，请提供 GATEWAY_PASSWORD 或 SUPERADMIN_PASSWORD')
		}
	}
}

function buildOnlineSnapshot(scaleCode, decoded, sampledAt) {
	return {
		scale_code: scaleCode,
		weight_raw: decoded.weight_raw,
		weight_kg: decoded.weight_kg,
		unit_code: decoded.unit_code,
		decimal_places: decoded.decimal_places,
		stable_metric: decoded.stable_metric,
		stable_threshold: decoded.stable_threshold,
		is_stable: decoded.is_stable === true,
		is_online: true,
		sampled_at: sampledAt,
		gateway_at: Date.now(),
		error_code: null,
		error_message: null
	}
}

function buildOfflineSnapshot(scaleCode, error, sampledAt, consecutiveFailures) {
	const errorCode = normalizeString(error && (error.code || error.name)) || 'comm_error'
	const errorMessage =
		normalizeString(error && error.message) ||
		`串口通讯失败${consecutiveFailures > 1 ? `（连续 ${consecutiveFailures} 次）` : ''}`
	return {
		scale_code: scaleCode,
		weight_raw: null,
		weight_kg: null,
		unit_code: null,
		decimal_places: null,
		stable_metric: null,
		stable_threshold: null,
		is_stable: false,
		is_online: false,
		sampled_at: sampledAt,
		gateway_at: Date.now(),
		error_code: errorCode.slice(0, 60),
		error_message: errorMessage.slice(0, 180)
	}
}

function shouldUpload(nextSnapshot, lastSnapshot, lastUploadAt, heartbeatMs) {
	if (!lastSnapshot) return true
	if (nextSnapshot.weight_raw !== lastSnapshot.weight_raw) return true
	if (nextSnapshot.is_stable !== lastSnapshot.is_stable) return true
	if (nextSnapshot.is_online !== lastSnapshot.is_online) return true
	if (normalizeString(nextSnapshot.error_code) !== normalizeString(lastSnapshot.error_code)) return true
	if (normalizeString(nextSnapshot.error_message) !== normalizeString(lastSnapshot.error_message)) return true
	return Date.now() - Number(lastUploadAt || 0) >= heartbeatMs
}

async function createUploader(config) {
	if (config.dryRun) {
		return {
			description: 'dry-run',
			async upload(snapshot) {
				console.log('[scale-gateway][dry-run]', JSON.stringify(snapshot))
				return { code: 0, msg: '', data: { dry_run: true } }
			}
		}
	}
	const clientOptions = {
		spaceId: config.crmSpaceId,
		clientSecret: config.clientSecret,
		endpoint: config.endpoint,
		accessKey: config.accessKey,
		secretKey: config.secretKey,
		spaceAppId: config.spaceAppId,
		crmUsername: config.crmUsername,
		crmPassword: config.crmPassword
	}
	const { loadedSpace, client } = await prepareClientOptions(clientOptions)
	const crmToken = await ensureCrmToken(client, clientOptions)
	return {
		description: loadedSpace?.from ? `space:${config.crmSpaceId} (${loadedSpace.from})` : `space:${config.crmSpaceId}`,
		async upload(snapshot) {
			return client.callFunction('crm-pda-scale', {
				action: 'upsertLatestV1',
				token: crmToken,
				data: snapshot,
				request_id: generateRequestId()
			})
		}
	}
}

async function createReader(config) {
	if (config.mock) {
		let mockIndex = 0
		return {
			async read() {
				mockIndex += 1
				if (mockIndex % 12 === 0) {
					const err = new Error('MOCK_SERIAL_TIMEOUT')
					err.code = 'mock_timeout'
					throw err
				}
				const frame = getMockFrame(mockIndex - 1)
				return {
					sampledAt: Date.now(),
					decoded: frame.decoded,
					label: frame.name
				}
			},
			async close() {}
		}
	}

	const ModbusRTU = require('modbus-serial')
	const client = new ModbusRTU()
	await client.connectRTUBuffered(config.serialPort, {
		baudRate: config.baudRate,
		dataBits: config.dataBits,
		stopBits: config.stopBits,
		parity: config.parity
	})
	client.setID(config.slaveId)
	client.setTimeout(Math.max(config.pollMs, 800))
	return {
		async read() {
			const sampledAt = Date.now()
			const realtimeRes = await client.readHoldingRegisters(0x0000, 5)
			const stableThresholdRes = await client.readHoldingRegisters(0x0009, 1)
			const configRes = await client.readHoldingRegisters(0x0013, 3)
			return {
				sampledAt,
				decoded: decodeScaleRegisters(realtimeRes.data, {
					stableThreshold: configRes?.data ? stableThresholdRes.data[0] : null,
					unitCode: configRes.data[0],
					divisionValue: configRes.data[1],
					decimalPlaces: configRes.data[2]
				}),
				label: 'modbus'
			}
		},
		async close() {
			if (typeof client.close === 'function') {
				await new Promise((resolve) => client.close(resolve))
			}
		}
	}
}

function printConfig(config, uploaderDescription) {
	console.log('[scale-gateway] mode:', config.mock ? 'mock' : 'modbus')
	console.log('[scale-gateway] upload:', uploaderDescription)
	console.log('[scale-gateway] scale:', config.scaleCode)
	console.log('[scale-gateway] poll/heartbeat:', `${config.pollMs}ms / ${config.heartbeatMs}ms`)
	if (!config.mock) {
		console.log(
			'[scale-gateway] serial:',
			`${config.serialPort} @ ${config.baudRate}-${config.dataBits}-${config.stopBits}-${config.parity}, slave=${config.slaveId}`
		)
	}
}

function logUpload(snapshot, label) {
	console.log(
		'[scale-gateway] upsert',
		JSON.stringify({
			label,
			scale_code: snapshot.scale_code,
			weight_kg: snapshot.weight_kg,
			is_stable: snapshot.is_stable,
			is_online: snapshot.is_online,
			error_code: snapshot.error_code,
			error_message: snapshot.error_message
		})
	)
}

async function run() {
	const args = parseArgs(process.argv)
	if (args.help) {
		printHelp()
		return
	}
	const config = loadConfig(args)
	assertConfig(config)

	const uploader = await createUploader(config)
	const reader = await createReader(config)
	printConfig(config, uploader.description)

	let lastUploadedAt = 0
	let lastUploadedSnapshot = null
	let consecutiveFailures = 0

	try {
		while (true) {
			const loopStartAt = Date.now()
			let nextSnapshot = null
			let label = 'scale'
			try {
				const reading = await reader.read()
				consecutiveFailures = 0
				label = reading.label || label
				nextSnapshot = buildOnlineSnapshot(config.scaleCode, reading.decoded, reading.sampledAt || Date.now())
			} catch (error) {
				consecutiveFailures += 1
				label = 'comm_error'
				nextSnapshot = buildOfflineSnapshot(config.scaleCode, error, Date.now(), consecutiveFailures)
			}

			if (shouldUpload(nextSnapshot, lastUploadedSnapshot, lastUploadedAt, config.heartbeatMs)) {
				const uploadRes = await uploader.upload(nextSnapshot)
				if (!uploadRes || uploadRes.code !== 0) {
					throw new Error(`upsertLatestV1 失败: ${JSON.stringify(uploadRes)}`)
				}
				lastUploadedSnapshot = {
					weight_raw: nextSnapshot.weight_raw,
					is_stable: nextSnapshot.is_stable,
					is_online: nextSnapshot.is_online,
					error_code: nextSnapshot.error_code,
					error_message: nextSnapshot.error_message
				}
				lastUploadedAt = Date.now()
				logUpload(nextSnapshot, label)
			}

			if (config.once) break
			const elapsed = Date.now() - loopStartAt
			await sleep(Math.max(config.pollMs - elapsed, 0))
		}
	} finally {
		await reader.close()
	}
}

run().catch((error) => {
	console.error('[scale-gateway] fatal:', normalizeString(error && error.message) || error)
	process.exitCode = 1
})
