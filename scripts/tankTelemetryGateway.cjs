#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const nodes7 = require('nodes7')
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

function fix2(value) {
	const num = Number(value || 0)
	return Math.round(num * 100) / 100
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
		host: normalizeString(process.env.PLC_HOST) || '192.168.0.1',
		port: toInt(process.env.PLC_PORT, 102),
		rack: toInt(process.env.PLC_RACK, 0),
		slot: toInt(process.env.PLC_SLOT, 1),
		levelAddress: normalizeString(process.env.TANK_LEVEL_ADDRESS) || 'DB1,REAL2000',
		pressureAddress: normalizeString(process.env.TANK_PRESSURE_ADDRESS) || 'DB1,REAL2040',
		fullLevelM: toNumber(process.env.TANK_FULL_LEVEL_M, 10),
		intervalMs: toInt(process.env.TANK_POLL_MS, 5000),
		timeoutMs: toInt(process.env.TANK_S7_TIMEOUT_MS, 5000),
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
		if (key === 'rack') out.rack = toInt(value, out.rack)
		if (key === 'slot') out.slot = toInt(value, out.slot)
		if (key === 'level-address') out.levelAddress = normalizeString(value) || out.levelAddress
		if (key === 'pressure-address') out.pressureAddress = normalizeString(value) || out.pressureAddress
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

function readS7Items(config) {
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
			else resolve(values)
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

async function readTankTelemetry(config) {
	const values = await readS7Items(config)
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
		`${prefix} ${sampled} level=${telemetry.level_m.toFixed(2)}m ` +
			`percent=${telemetry.level_percent.toFixed(2)}% pressure=${telemetry.pressure_mpa.toFixed(2)}MPa`
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
