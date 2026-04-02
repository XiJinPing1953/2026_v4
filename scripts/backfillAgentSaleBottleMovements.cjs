#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function parseArgs(argv) {
	const out = {
		spaceId: '',
		execute: false,
		dateStart: '',
		dateEnd: '',
		saleId: '',
		maxRows: 5000,
		touchAnomalies: true,
		touchBatchSize: 120,
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP'
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		if (!arg) continue
		if (arg === '--execute') {
			out.execute = true
			continue
		}
		if (arg === '--dry-run') {
			out.execute = false
			continue
		}
		if (arg === '--no-touch') {
			out.touchAnomalies = false
			continue
		}
		const m = arg.match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'space-id') out.spaceId = normalizeString(value)
		if (key === 'date-start') out.dateStart = normalizeString(value)
		if (key === 'date-end') out.dateEnd = normalizeString(value)
		if (key === 'sale-id') out.saleId = normalizeString(value)
		if (key === 'max-rows') out.maxRows = Math.min(Math.max(Number(value) || out.maxRows, 1), 20000)
		if (key === 'touch-batch-size') out.touchBatchSize = Math.min(Math.max(Number(value) || out.touchBatchSize, 20), 200)
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
	}
	if (!out.spaceId) out.spaceId = normalizeString(process.env.SPACE_ID)
	if (!out.spaceId) throw new Error('缺少 --space-id=...')
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
	return crypto.createHmac('sha256', key).update(String(text)).digest('hex')
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
	if (node.spaceid === spaceId) {
		const hasAlipay = node.accessKey && node.secretKey && node.spaceAppId
		if (hasAlipay) return node
	}
	for (const value of Object.values(node)) {
		const found = deepFindSpace(value, spaceId)
		if (found) return found
	}
	return null
}

function loadAlipayConfig(spaceId) {
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
				endpoint: normalizeString(space.apiEndpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`,
				from: file
			}
			if (config.accessKey && config.secretKey && config.spaceAppId) return config
		} catch (_) {
			// ignore
		}
	}
	throw new Error(`未在 HBuilderX setting.json 中找到空间 ${spaceId} 的支付宝密钥配置`)
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
			headers: {
				...headers,
				Authorization: authorization,
				'content-type': 'application/json'
			},
			bodyText
		}
	}

	async callFunction(name, functionArgs) {
		const signed = this.signRequest('/functions/invokeFunction', {
			data: functionArgs,
			functionName: name
		})
		const res = await fetch(signed.url, {
			method: 'POST',
			headers: signed.headers,
			body: signed.bodyText
		})
		const text = await res.text()
		const json = text ? JSON.parse(text) : {}
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
		return json
	}
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function login(client, username, password) {
	const res = await client.callFunction('crm-auth', {
		action: 'login',
		data: { username, password },
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) {
		throw new Error(`登录失败: ${JSON.stringify(res)}`)
	}
	return res.token || (res.user && res.user.token) || ''
}

async function callCrmFunction(client, token, functionName, action, data) {
	const res = await client.callFunction(functionName, {
		action,
		token,
		data,
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) {
		throw new Error(`${functionName}.${action} 失败: ${JSON.stringify(res)}`)
	}
	return res
}

async function main() {
	const args = parseArgs(process.argv)
	const config = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(config)
	const token = await login(client, args.username, args.password)

	const payload = {
		execute: false,
		max_rows: args.maxRows,
		touch_anomalies: args.touchAnomalies,
		touch_batch_size: args.touchBatchSize
	}
	if (args.saleId) payload.sale_id = args.saleId
	if (args.dateStart) payload.date_start = args.dateStart
	if (args.dateEnd) payload.date_end = args.dateEnd

	const preview = await callCrmFunction(client, token, 'crm-sale', 'backfillAgentSaleBottleMovementsV1', payload)

	const out = {
		space_id: args.spaceId,
		config_from: config.from,
		execute: args.execute,
		preview: preview.data || null,
		execute_result: null
	}

	if (args.execute) {
		const executeRes = await callCrmFunction(client, token, 'crm-sale', 'backfillAgentSaleBottleMovementsV1', {
			...payload,
			execute: true,
			confirm_text: 'BACKFILL_AGENT_SALE_BOTTLE_MOVEMENTS'
		})
		out.execute_result = executeRes.data || null
	}

	console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => {
	console.error('[backfillAgentSaleBottleMovements] FAIL', err && err.message ? err.message : err)
	process.exit(1)
})
