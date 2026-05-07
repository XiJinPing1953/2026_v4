#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

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

function parseBool(value, fallback = false) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	return text === '1' || text === 'true' || text === 'yes' || text === 'y' || text === 'on'
}

function safeJsonParse(text, fallback = null) {
	if (!text || typeof text !== 'string') return fallback
	try {
		return JSON.parse(text)
	} catch (_) {
		return fallback
	}
}

function parseArgs(argv) {
	const out = {
		host: normalizeString(process.env.PLC_HOST) || '192.168.2.1',
		port: toInt(process.env.PLC_PORT, 502),
		unitId: toInt(process.env.PLC_UNIT_ID, 1),
		levelRegister: toInt(process.env.TANK_LEVEL_REGISTER, 2000),
		pressureRegister: toInt(process.env.TANK_PRESSURE_REGISTER, 2040),
		wordOrder: normalizeString(process.env.TANK_WORD_ORDER) || 'abcd',
		fullLevelM: toNumber(process.env.TANK_FULL_LEVEL_M, 10),
		intervalMs: toInt(process.env.TANK_POLL_MS, 5000),
		timeoutMs: toInt(process.env.TANK_MODBUS_TIMEOUT_MS, 3000),
		tankId: normalizeString(process.env.TANK_ID) || 'main',
		gatewayId: normalizeString(process.env.TANK_GATEWAY_ID) || os.hostname() || 'tank-gateway',
		spaceId: normalizeString(process.env.SPACE_ID),
		username: normalizeString(process.env.CRM_USERNAME) || 'superadmin',
		password: normalizeString(process.env.CRM_PASSWORD),
		token: normalizeString(process.env.CRM_TOKEN),
		dryRun: parseBool(process.env.TANK_DRY_RUN, false),
		once: false
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = normalizeString(argv[i])
		if (arg === '--probe') {
			out.dryRun = true
			out.once = true
			continue
		}
		if (arg === '--dry-run') {
			out.dryRun = true
			continue
		}
		if (arg === '--once') {
			out.once = true
			continue
		}
		const match = arg.match(/^--([^=]+)=(.*)$/)
		if (!match) continue
		const key = match[1]
		const value = match[2]
		if (key === 'host') out.host = normalizeString(value) || out.host
		if (key === 'port') out.port = toInt(value, out.port)
		if (key === 'unit-id') out.unitId = toInt(value, out.unitId)
		if (key === 'level-register') out.levelRegister = toInt(value, out.levelRegister)
		if (key === 'pressure-register') out.pressureRegister = toInt(value, out.pressureRegister)
		if (key === 'word-order') out.wordOrder = normalizeString(value) || out.wordOrder
		if (key === 'full-level-m') out.fullLevelM = toNumber(value, out.fullLevelM)
		if (key === 'interval-ms') out.intervalMs = toInt(value, out.intervalMs)
		if (key === 'timeout-ms') out.timeoutMs = toInt(value, out.timeoutMs)
		if (key === 'tank-id') out.tankId = normalizeString(value) || out.tankId
		if (key === 'gateway-id') out.gatewayId = normalizeString(value) || out.gatewayId
		if (key === 'space-id') out.spaceId = normalizeString(value) || out.spaceId
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value)
		if (key === 'token') out.token = normalizeString(value)
	}
	if (!out.fullLevelM || out.fullLevelM <= 0) out.fullLevelM = 10
	if (out.intervalMs < 1000) out.intervalMs = 1000
	if (out.timeoutMs < 500) out.timeoutMs = 500
	return out
}

function uuidV4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

function sha256Hex(text) {
	return crypto.createHash('sha256').update(String(text)).digest('hex')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', String(key)).update(String(text)).digest('hex')
}

function splitPathQuery(urlPath) {
	const idx = String(urlPath).indexOf('?')
	if (idx < 0) return [String(urlPath), '']
	return [urlPath.slice(0, idx), urlPath.slice(idx + 1)]
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	return fs
		.readdirSync(base)
		.map((dir) => path.join(base, dir, 'setting.json'))
		.filter((file) => fs.existsSync(file))
}

function deepFindSpace(node, spaceId) {
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = deepFindSpace(item, spaceId)
			if (found) return found
		}
		return null
	}
	if (!node || typeof node !== 'object') return null
	if (node.spaceid === spaceId && node.accessKey && node.secretKey && node.spaceAppId) return node
	for (const value of Object.values(node)) {
		const found = deepFindSpace(value, spaceId)
		if (found) return found
	}
	return null
}

function loadAlipayConfig(spaceId) {
	if (!spaceId) throw new Error('缺少 SPACE_ID 或 --space-id')
	for (const file of listProjectSettingFiles()) {
		try {
			const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
			const space = deepFindSpace(raw, spaceId)
			if (!space) continue
			const config = {
				spaceId,
				accessKey: normalizeString(space.accessKey),
				secretKey: normalizeString(space.secretKey),
				spaceAppId: normalizeString(space.spaceAppId),
				endpoint: normalizeString(space.apiEndpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`
			}
			if (config.accessKey && config.secretKey && config.spaceAppId) return config
		} catch (_) {}
	}
	throw new Error(`未找到空间 ${spaceId} 的支付宝密钥配置`)
}

class AlipayFunctionClient {
	constructor(config) {
		this.spaceId = config.spaceId
		this.accessKey = config.accessKey
		this.secretKey = config.secretKey
		this.spaceAppId = config.spaceAppId
		this.endpoint = config.endpoint
	}

	signRequest(pathWithQuery, { data, functionName }) {
		const timestamp = String(Date.now())
		const requestId = uuidV4()
		const headers = {
			'x-from-app-id': this.spaceAppId,
			'x-from-env-id': this.spaceId,
			'x-to-env-id': this.spaceId,
			'x-from-instance-id': timestamp,
			'x-from-function-name': functionName,
			'x-to-function-name': functionName,
			'x-client-timestamp': timestamp,
			'x-alipay-source': 'client',
			'x-request-id': requestId,
			'x-alipay-callid': requestId,
			'x-trace-id': requestId
		}
		const signedHeaders = [
			'x-client-timestamp',
			'x-from-app-id',
			'x-from-env-id',
			'x-from-function-name',
			'x-from-instance-id',
			'x-to-function-name',
			'x-to-env-id'
		].sort()
		const [pathname, query] = splitPathQuery(pathWithQuery)
		const canonicalHeaderLines = signedHeaders.map((key) => `${key}:${headers[key] || ''}\n`).join('')
		const bodyText = JSON.stringify(data || {})
		const bodyHash = sha256Hex(bodyText)
		const canonicalRequest = `POST\n${pathname}\n${query}\n${canonicalHeaderLines}\n${signedHeaders.join(';')}\n${bodyHash}\n`
		const canonicalHash = sha256Hex(canonicalRequest)
		const stringToSign = `HMAC-SHA256\n${timestamp}\n${canonicalHash}\n`
		const signature = hmacSha256Hex(stringToSign, this.secretKey)
		const authorization = `HMAC-SHA256 Credential=${this.accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
		return {
			url: `${this.endpoint.replace(/\/+$/, '')}${pathname}${query ? `?${query}` : ''}`,
			headers: { ...headers, Authorization: authorization, 'content-type': 'application/json' },
			bodyText
		}
	}

	async callFunction(name, functionArgs) {
		if (typeof fetch !== 'function') throw new Error('当前 Node 版本缺少 fetch，请使用 Node 18 或更新版本')
		const signed = this.signRequest('/functions/invokeFunction', { data: functionArgs, functionName: name })
		const res = await fetch(signed.url, { method: 'POST', headers: signed.headers, body: signed.bodyText })
		const text = await res.text()
		const json = text ? safeJsonParse(text, {}) : {}
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
		return json
	}
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function login(client, username, password) {
	if (!password) throw new Error('缺少 CRM_PASSWORD 或 --password')
	const res = await client.callFunction('crm-auth', {
		action: 'login',
		data: { username, password },
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) throw new Error(`登录失败: ${JSON.stringify(res)}`)
	return res.token || (res.user && res.user.token) || (res.data && (res.data.token || (res.data.user && res.data.user.token))) || ''
}

let transactionId = 1

function nextTransactionId() {
	transactionId = (transactionId % 0xffff) + 1
	return transactionId
}

function readHoldingRegisters({ host, port, unitId, timeoutMs }, startAddress, quantity) {
	return new Promise((resolve, reject) => {
		const tx = nextTransactionId()
		const request = Buffer.alloc(12)
		request.writeUInt16BE(tx, 0)
		request.writeUInt16BE(0, 2)
		request.writeUInt16BE(6, 4)
		request.writeUInt8(unitId, 6)
		request.writeUInt8(3, 7)
		request.writeUInt16BE(startAddress, 8)
		request.writeUInt16BE(quantity, 10)

		let buffer = Buffer.alloc(0)
		let settled = false
		const socket = net.createConnection({ host, port })

		function finish(err, value) {
			if (settled) return
			settled = true
			socket.destroy()
			if (err) reject(err)
			else resolve(value)
		}

		socket.setTimeout(timeoutMs)
		socket.on('connect', () => socket.write(request))
		socket.on('timeout', () => finish(new Error(`Modbus timeout ${host}:${port}`)))
		socket.on('error', (err) => finish(err))
		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk])
			if (buffer.length < 9) return
			const length = buffer.readUInt16BE(4)
			const frameLength = 6 + length
			if (buffer.length < frameLength) return
			const frame = buffer.slice(0, frameLength)
			const responseTx = frame.readUInt16BE(0)
			const functionCode = frame.readUInt8(7)
			if (responseTx !== tx) return finish(new Error(`Modbus transaction mismatch: ${responseTx} != ${tx}`))
			if (functionCode & 0x80) {
				return finish(new Error(`Modbus exception code ${frame.readUInt8(8)}`))
			}
			if (functionCode !== 3) return finish(new Error(`Unexpected Modbus function ${functionCode}`))
			const byteCount = frame.readUInt8(8)
			if (byteCount < quantity * 2) return finish(new Error(`Unexpected Modbus byte count ${byteCount}`))
			const data = frame.slice(9, 9 + byteCount)
			const registers = []
			for (let i = 0; i < quantity; i += 1) {
				registers.push(data.readUInt16BE(i * 2))
			}
			return finish(null, { registers, data })
		})
	})
}

function reorderFloatBytes(bytes, wordOrder) {
	const order = normalizeString(wordOrder).toLowerCase().replace(/[-_\s]/g, '')
	const source = Buffer.from(bytes)
	if (order === 'badc' || order === 'byteswap') return Buffer.from([source[1], source[0], source[3], source[2]])
	if (order === 'cdab' || order === 'wordswap') return Buffer.from([source[2], source[3], source[0], source[1]])
	if (order === 'dcba' || order === 'little' || order === 'le') return Buffer.from([source[3], source[2], source[1], source[0]])
	return source
}

function parseFloatFromRegisters(registers, wordOrder) {
	if (!Array.isArray(registers) || registers.length < 2) throw new Error('读取 32-bit float 至少需要 2 个寄存器')
	const bytes = Buffer.alloc(4)
	bytes.writeUInt16BE(registers[0], 0)
	bytes.writeUInt16BE(registers[1], 2)
	const ordered = reorderFloatBytes(bytes, wordOrder)
	return {
		value: ordered.readFloatBE(0),
		bytes: bytes.toString('hex'),
		orderedBytes: ordered.toString('hex')
	}
}

async function readTankTelemetry(config) {
	const firstAddress = Math.min(config.levelRegister, config.pressureRegister)
	const lastAddress = Math.max(config.levelRegister, config.pressureRegister) + 1
	const quantity = lastAddress - firstAddress + 1
	if (quantity > 120) throw new Error(`寄存器跨度过大: ${quantity}`)
	const block = await readHoldingRegisters(config, firstAddress, quantity)
	const sliceRegisters = (address) => {
		const offset = address - firstAddress
		return block.registers.slice(offset, offset + 2)
	}
	const levelRegisters = sliceRegisters(config.levelRegister)
	const pressureRegisters = sliceRegisters(config.pressureRegister)
	const level = parseFloatFromRegisters(levelRegisters, config.wordOrder)
	const pressure = parseFloatFromRegisters(pressureRegisters, config.wordOrder)
	const levelPercent = Math.min(Math.max((level.value / config.fullLevelM) * 100, 0), 100)
	return {
		tank_id: config.tankId,
		gateway_id: config.gatewayId,
		plc_host: config.host,
		status: 'online',
		level_m: Math.round(level.value * 1000) / 1000,
		level_percent: Math.round(levelPercent * 100) / 100,
		pressure_mpa: Math.round(pressure.value * 1000) / 1000,
		full_level_m: config.fullLevelM,
		sampled_at: Date.now(),
		raw: {
			level_register: config.levelRegister,
			pressure_register: config.pressureRegister,
			level_registers: levelRegisters,
			pressure_registers: pressureRegisters,
			word_order: config.wordOrder,
			level_bytes: level.bytes,
			pressure_bytes: pressure.bytes,
			level_ordered_bytes: level.orderedBytes,
			pressure_ordered_bytes: pressure.orderedBytes
		}
	}
}

async function uploadTelemetry(client, token, telemetry) {
	const res = await client.callFunction('crm-dashboard', {
		action: 'ingestTankTelemetry',
		token,
		data: telemetry,
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) throw new Error(`上报失败: ${JSON.stringify(res)}`)
	return res
}

function printTelemetry(telemetry, mode) {
	const sampled = new Date(telemetry.sampled_at).toISOString()
	const prefix = mode === 'dry' ? '[dry-run]' : '[upload]'
	console.log(
		`${prefix} ${sampled} level=${telemetry.level_m.toFixed(3)}m ` +
			`percent=${telemetry.level_percent.toFixed(2)}% pressure=${telemetry.pressure_mpa.toFixed(3)}MPa`
	)
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
	const config = parseArgs(process.argv)
	let client = null
	let token = config.token
	if (!config.dryRun) {
		client = new AlipayFunctionClient(loadAlipayConfig(config.spaceId))
		if (!token) token = await login(client, config.username, config.password)
		if (!token) throw new Error('未获取到 CRM token')
	}

	while (true) {
		try {
			const telemetry = await readTankTelemetry(config)
			if (config.dryRun) {
				printTelemetry(telemetry, 'dry')
			} else {
				await uploadTelemetry(client, token, telemetry)
				printTelemetry(telemetry, 'upload')
			}
			if (config.once) return
		} catch (err) {
			console.error(`[tank-gateway] ${new Date().toISOString()} ${err && err.message ? err.message : String(err)}`)
			if (config.once) {
				process.exitCode = 1
				return
			}
		}
		await sleep(config.intervalMs)
	}
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err))
	process.exit(1)
})
