#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
	ensureCrmToken,
	generateRequestId,
	prepareClientOptions
} = require('../lib/qrImportCommon.cjs')
const {
	DEFAULT_SCALE_CODE,
	C606_TARGET_QUANT1_ADDRESS,
	decodeC606ConfigRegisters,
	decodeC606GrossFloatRegisters,
	decodeC606GrossIntRegisters,
	decodeFloat32HighFirst,
	encodeFloat32HighFirstRegisters,
	getMockFrame
} = require('./protocol.cjs')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toPositiveInt(value, fallback) {
	const num = Number(value)
	return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback
}

function toOptionalPositiveInt(value) {
	const num = Number(value)
	return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null
}

function toByte(value) {
	const num = Number(value)
	return Math.max(0, Math.min(0xff, Math.trunc(Number.isFinite(num) ? num : 0)))
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
  SCALE_CODE / SCALE_POLL_MS / SCALE_HEARTBEAT_MS / SCALE_TARGET_WRITE_POLL_MS / SCALE_CONFIG_REFRESH_MS
  CRM_SPACE_ID + CRM_CLIENT_SECRET 或 CRM_ACCESS_KEY / CRM_SECRET_KEY / CRM_SPACE_APP_ID
  GATEWAY_USERNAME / GATEWAY_PASSWORD
  SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD
`.trim())
}

function loadConfig(args) {
	const scriptDir = __dirname
	loadEnvFile(path.join(scriptDir, '.env'))
	const parity = normalizeString(process.env.SCALE_PARITY) || 'none'
	const explicitStopBits = toOptionalPositiveInt(process.env.SCALE_STOP_BITS)
	return {
		mock: args.mock === true,
		dryRun: args.dryRun === true,
		once: args.once === true,
		scaleCode: normalizeString(process.env.SCALE_CODE) || DEFAULT_SCALE_CODE,
		serialPort: normalizeString(process.env.SCALE_SERIAL_PORT),
		baudRate: toPositiveInt(process.env.SCALE_BAUD_RATE, 9600),
		dataBits: toPositiveInt(process.env.SCALE_DATA_BITS, 8),
		stopBits: explicitStopBits || (parity === 'none' ? 2 : 1),
		parity,
		slaveId: toPositiveInt(process.env.SCALE_SLAVE_ID, 1),
		pollMs: toPositiveInt(process.env.SCALE_POLL_MS, 200),
		timeoutMs: toPositiveInt(process.env.SCALE_TIMEOUT_MS, 1500),
		requestGapMs: toPositiveInt(process.env.SCALE_REQUEST_GAP_MS, 100),
		requestRetries: Math.max(0, Math.min(toPositiveInt(process.env.SCALE_REQUEST_RETRIES, 1), 5)),
		heartbeatMs: toPositiveInt(process.env.SCALE_HEARTBEAT_MS, 2000),
		targetWritePollMs: toPositiveInt(process.env.SCALE_TARGET_WRITE_POLL_MS, 1000),
		configRefreshMs: toPositiveInt(process.env.SCALE_CONFIG_REFRESH_MS, 60000),
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
		scale_read_mode: decoded.scale_read_mode || null,
		raw_scale_payload: decoded.raw_scale_payload || null,
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
		scale_read_mode: null,
		raw_scale_payload: null,
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
	if (normalizeString(nextSnapshot.scale_read_mode) !== normalizeString(lastSnapshot.scale_read_mode)) return true
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
			},
			async callFunction(name, payload = {}) {
				console.log('[scale-gateway][dry-run-function]', name, JSON.stringify(payload))
				return { code: 0, msg: '', data: { task: null, dry_run: true } }
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
		},
		async callFunction(name, payload = {}) {
			return client.callFunction(name, {
				...payload,
				token: payload.token || crmToken,
				request_id: payload.request_id || generateRequestId()
			})
		}
	}
}

function crc16Modbus(buffer) {
	let crc = 0xffff
	for (const byte of buffer) {
		crc ^= byte
		for (let index = 0; index < 8; index += 1) {
			crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1
		}
	}
	return crc
}

function appendCrc(buffer) {
	const body = Buffer.from(buffer)
	const crc = crc16Modbus(body)
	return Buffer.concat([body, Buffer.from([crc & 0xff, (crc >> 8) & 0xff])])
}

function hasValidCrc(frame) {
	if (!Buffer.isBuffer(frame) || frame.length < 5) return false
	const body = frame.subarray(0, frame.length - 2)
	const expected = crc16Modbus(body)
	return frame[frame.length - 2] === (expected & 0xff) && frame[frame.length - 1] === ((expected >> 8) & 0xff)
}

function findValidRtuFrame(buffer, expectedSlaveId, expectedFunctionCode) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 5) return null
	const slaveId = toByte(expectedSlaveId)
	const functionCode = toByte(expectedFunctionCode)
	for (let offset = 0; offset <= buffer.length - 5; offset += 1) {
		if (buffer[offset] !== slaveId) continue
		const responseFunction = buffer[offset + 1]
		if (responseFunction !== functionCode && responseFunction !== (functionCode | 0x80)) continue
		if (responseFunction === (functionCode | 0x80)) {
			const exceptionFrame = buffer.subarray(offset, offset + 5)
			if (exceptionFrame.length === 5 && hasValidCrc(exceptionFrame)) return exceptionFrame
			continue
		}
		if (functionCode === 0x10) {
			const writeFrame = buffer.subarray(offset, offset + 8)
			if (writeFrame.length === 8 && hasValidCrc(writeFrame)) return writeFrame
			continue
		}
		const byteCount = buffer[offset + 2]
		const standardLength = 3 + byteCount + 2
		const paddedLength = standardLength + 1
		const standardFrame = buffer.subarray(offset, offset + standardLength)
		if (standardFrame.length === standardLength && hasValidCrc(standardFrame)) return standardFrame
		const paddedFrame = buffer.subarray(offset, offset + paddedLength)
		if (paddedFrame.length === paddedLength && hasValidCrc(paddedFrame)) return paddedFrame
	}
	return null
}

function parseRtuResponse(frame, expectedFunctionCode, requestedQuantity) {
	if (!frame || frame.length < 5) throw new Error('C606+ Modbus 回包为空或长度不足')
	const functionCode = frame[1]
	if (functionCode === (toByte(expectedFunctionCode) | 0x80)) {
		const err = new Error(`C606+ Modbus 异常码 ${frame[2]}`)
		err.code = `modbus_exception_${frame[2]}`
		throw err
	}
	const byteCount = frame[2]
	const payload = frame.subarray(3, 3 + byteCount)
	if (functionCode === 0x03 || functionCode === 0x04) {
		const expectedBytes = requestedQuantity * 2
		if (byteCount !== expectedBytes) {
			throw new Error(`C606+ 寄存器回包字节数不匹配: ${byteCount}/${expectedBytes}`)
		}
		const data = []
		for (let index = 0; index < payload.length; index += 2) {
			data.push(payload.readUInt16BE(index))
		}
		return data
	}
	if (functionCode === 0x10) {
		if (frame.length !== 8) throw new Error(`C606+ 写多个寄存器回包长度不匹配: ${frame.length}/8`)
		return {
			address: frame.readUInt16BE(2),
			quantity: frame.readUInt16BE(4)
		}
	}
	if (functionCode === 0x02) {
		const data = []
		for (let index = 0; index < requestedQuantity; index += 1) {
			const byte = payload[Math.floor(index / 8)] || 0
			data.push(Boolean(byte & (1 << (index % 8))))
		}
		return data
	}
	throw new Error(`未支持的 C606+ Modbus 功能码: ${functionCode}`)
}

async function openRawRtuPort(config) {
	const { SerialPort } = require('serialport')
	const port = new SerialPort({
		path: config.serialPort,
		baudRate: config.baudRate,
		dataBits: config.dataBits,
		stopBits: config.stopBits,
		parity: config.parity,
		autoOpen: false
	})
	await new Promise((resolve, reject) => {
		port.open((error) => {
			if (error) reject(error)
			else resolve()
		})
	})
	await sleep(toPositiveInt(process.env.SCALE_OPEN_SETTLE_MS, 800))
	return port
}

async function closeRawRtuPort(port) {
	if (!port || port.isOpen !== true) return
	await new Promise((resolve) => port.close(() => resolve()))
}

function createRawRtuClient(port, config) {
	let queue = Promise.resolve()
	let lastRequestAt = 0

	async function request(functionCode, address, quantity, payloadBytes = []) {
		const runRequest = async () => {
			const gapMs = Math.max(Number(config.requestGapMs) || 0, 0)
			const waitMs = Math.max(gapMs - (Date.now() - lastRequestAt), 0)
			if (waitMs > 0) await sleep(waitMs)
			const timeoutMs = Math.max(config.timeoutMs, 1500)
			const requestBody = [
				toByte(config.slaveId),
				toByte(functionCode),
				(address >> 8) & 0xff,
				address & 0xff,
				(quantity >> 8) & 0xff,
				quantity & 0xff
			]
			if (functionCode === 0x10) {
				const payload = Array.isArray(payloadBytes) ? payloadBytes.map(toByte) : []
				requestBody.push(payload.length, ...payload)
			}
			const requestFrame = appendCrc(requestBody)
			const debugRtu = normalizeString(process.env.SCALE_DEBUG_RTU) === '1'
			let buffer = Buffer.alloc(0)
			let timer = null
			const responseFrame = await new Promise((resolve, reject) => {
				const cleanup = () => {
					if (timer) clearTimeout(timer)
					port.off('data', onData)
				}
				const onData = (chunk) => {
					buffer = Buffer.concat([buffer, chunk])
					const frame = findValidRtuFrame(buffer, config.slaveId, functionCode)
					if (frame) {
						if (debugRtu) {
							console.log('[scale-gateway][rtu-rx]', frame.toString('hex').toUpperCase())
						}
						cleanup()
						resolve(frame)
					}
				}
				timer = setTimeout(() => {
					cleanup()
					const receivedHex = buffer.length > 0 ? `, rx=${buffer.toString('hex').toUpperCase()}` : ''
					const error = new Error(`Timed out${receivedHex}`)
					error.code = 'TransactionTimedOutError'
					reject(error)
				}, timeoutMs)
				port.on('data', onData)
				if (debugRtu) {
					console.log('[scale-gateway][rtu-tx]', requestFrame.toString('hex').toUpperCase())
				}
				port.write(requestFrame, (writeError) => {
					if (writeError) {
						cleanup()
						reject(writeError)
						return
					}
					port.drain(() => {})
				})
			})
			lastRequestAt = Date.now()
			return parseRtuResponse(responseFrame, functionCode, quantity)
		}
		const runWithRetries = async () => {
			let lastError = null
			const attempts = Math.max(Number(config.requestRetries) || 0, 0) + 1
			for (let attempt = 0; attempt < attempts; attempt += 1) {
				try {
					return await runRequest()
				} catch (error) {
					lastError = error
					if (attempt < attempts - 1) await sleep(Math.max(Number(config.requestGapMs) || 0, 100))
				}
			}
			throw lastError
		}
		const pending = queue.then(runWithRetries, runWithRetries)
		queue = pending.catch(() => {})
		return pending
	}

	return {
		readHoldingRegisters(address, quantity) {
			return request(0x03, address, quantity)
		},
		readInputRegisters(address, quantity) {
			return request(0x04, address, quantity)
		},
		writeMultipleRegisters(address, registers = []) {
			const source = Array.isArray(registers) ? registers : []
			const payloadBytes = []
			source.forEach((word) => {
				const value = Math.max(0, Math.min(0xffff, Math.trunc(Number(word) || 0)))
				payloadBytes.push((value >> 8) & 0xff, value & 0xff)
			})
			return request(0x10, address, source.length, payloadBytes)
		},
		readDiscreteInputs(address, quantity) {
			// C606+实测 FC02 回包会在 CRC 前多 1 个填充字节，parseRtuResponse 会忽略该填充。
			return request(0x02, address, quantity)
		}
	}
}

async function createReader(config) {
	if (config.mock) {
		let mockIndex = 0
		let mockTargetNetWeight = null
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
			async writeTargetNetWeight(targetNetWeight) {
				const registers = encodeFloat32HighFirstRegisters(targetNetWeight)
				mockTargetNetWeight = Number(targetNetWeight)
				return {
					targetNetWeight: mockTargetNetWeight,
					address: C606_TARGET_QUANT1_ADDRESS,
					registers,
					readback: mockTargetNetWeight,
					mock: true
				}
			},
			async close() {}
		}
	}

	const port = await openRawRtuPort(config)
	const client = createRawRtuClient(port, config)
	let configCache = null
	let configLoadedAt = 0
	async function readInstrumentConfig() {
		const now = Date.now()
		if (configCache && now - configLoadedAt < config.configRefreshMs) return configCache
		const configRegisters = await client.readInputRegisters(0x001c, 11)
		configCache = decodeC606ConfigRegisters(configRegisters)
		configLoadedAt = now
		return configCache
	}
	async function readGrossWeightFloat(dynamicInputs, instrumentConfig) {
		const grossFloatRegisters = await client.readInputRegisters(0x0008, 2)
		return decodeC606GrossFloatRegisters(grossFloatRegisters, dynamicInputs, instrumentConfig)
	}
	async function readGrossWeightInt(dynamicInputs, instrumentConfig, fallbackError = null) {
		const grossWeightRegisters = await client.readInputRegisters(0x0002, 2)
		const decoded = decodeC606GrossIntRegisters(grossWeightRegisters, dynamicInputs, instrumentConfig)
		if (fallbackError) {
			decoded.raw_scale_payload = {
				...(decoded.raw_scale_payload || {}),
				gross_float_error: normalizeString(fallbackError && fallbackError.message) || 'gross_float_failed'
			}
		}
		return decoded
	}
	async function writeTargetNetWeight(targetNetWeight) {
		const registers = encodeFloat32HighFirstRegisters(targetNetWeight)
		const writeAck = await client.writeMultipleRegisters(C606_TARGET_QUANT1_ADDRESS, registers)
		const readbackRegisters = await client.readHoldingRegisters(C606_TARGET_QUANT1_ADDRESS, 2)
		const readback = decodeFloat32HighFirst(readbackRegisters)
		return {
			targetNetWeight: Number(targetNetWeight),
			address: C606_TARGET_QUANT1_ADDRESS,
			registers,
			writeAck,
			readbackRegisters,
			readback
		}
	}
	return {
		async read() {
			const sampledAt = Date.now()
			const instrumentConfig = await readInstrumentConfig()
			const dynamicInputs = await client.readDiscreteInputs(0x0002, 1)
			let decoded = null
			try {
				decoded = await readGrossWeightFloat(dynamicInputs, instrumentConfig)
			} catch (error) {
				decoded = await readGrossWeightInt(dynamicInputs, instrumentConfig, error)
			}
			return {
				sampledAt,
				decoded,
				label: 'c606_modbus'
			}
		},
		writeTargetNetWeight,
		async close() {
			await closeRawRtuPort(port)
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
			scale_read_mode: snapshot.scale_read_mode,
			is_stable: snapshot.is_stable,
			is_online: snapshot.is_online,
			error_code: snapshot.error_code,
			error_message: snapshot.error_message
		})
	)
}

function normalizeCloudResult(res) {
	return res && res.result ? res.result : res || {}
}

async function processTargetWrite({ uploader, reader, config }) {
	const claimRes = normalizeCloudResult(
		await uploader.callFunction('crm-pda-filling', {
			action: 'claimTargetWriteV1',
			data: {
				scale_code: config.scaleCode
			}
		})
	)
	if (claimRes.code !== 0) {
		throw new Error(`claimTargetWriteV1 失败: ${JSON.stringify(claimRes)}`)
	}
	const task = claimRes.data && claimRes.data.task ? claimRes.data.task : null
	if (!task || !task._id) return false

	let finishPayload = null
	try {
		const writeResult = await reader.writeTargetNetWeight(task.target_net_weight)
		finishPayload = {
			action: 'finishTargetWriteV1',
			data: {
				task_id: task._id,
				success: true,
				readback: writeResult.readback,
				payload: {
					target_register: '0x00CA',
					target_register_decimal: C606_TARGET_QUANT1_ADDRESS,
					target_value_kind: 'target_net_weight',
					target_net_weight: Number(task.target_net_weight),
					registers: writeResult.registers,
					write_ack: writeResult.writeAck || null,
					readback_registers: writeResult.readbackRegisters || null,
					mock: writeResult.mock === true
				}
			}
		}
	} catch (error) {
		finishPayload = {
			action: 'finishTargetWriteV1',
			data: {
				task_id: task._id,
				success: false,
				error: normalizeString(error && error.message) || 'C606+目标写入失败',
				payload: {
					target_register: '0x00CA',
					target_register_decimal: C606_TARGET_QUANT1_ADDRESS,
					target_value_kind: 'target_net_weight',
					target_net_weight: Number(task.target_net_weight)
				}
			}
		}
	}
	const finishRes = normalizeCloudResult(await uploader.callFunction('crm-pda-filling', finishPayload))
	if (finishRes.code !== 0) {
		throw new Error(`finishTargetWriteV1 失败: ${JSON.stringify(finishRes)}`)
	}
	console.log(
		'[scale-gateway] target-write',
		JSON.stringify({
			task_id: task._id,
			scale_code: task.scale_code,
			bottle_no: task.bottle_no,
			target_net_weight: task.target_net_weight,
			success: finishPayload.data.success,
			error: finishPayload.data.error || ''
		})
	)
	return true
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
	let lastTargetWritePollAt = 0

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
					scale_read_mode: nextSnapshot.scale_read_mode,
					is_stable: nextSnapshot.is_stable,
					is_online: nextSnapshot.is_online,
					error_code: nextSnapshot.error_code,
					error_message: nextSnapshot.error_message
				}
				lastUploadedAt = Date.now()
				logUpload(nextSnapshot, label)
			}
			if (Date.now() - lastTargetWritePollAt >= config.targetWritePollMs) {
				lastTargetWritePollAt = Date.now()
				try {
					await processTargetWrite({ uploader, reader, config })
				} catch (error) {
					console.error('[scale-gateway] target-write failed:', normalizeString(error && error.message) || error)
				}
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
