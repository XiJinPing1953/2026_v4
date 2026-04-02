#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

function parseArgs(argv) {
	const args = {
		spaceId: process.env.UNI_SPACE_ID || '',
		username: process.env.CRM_USERNAME || 'superadmin',
		password: process.env.CRM_PASSWORD || 'y7ez5CGAbivZkeP',
		execute: false,
		output: 'docs/customer.opening_balances.report.json'
	}
	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if ((cur === '--space-id' || cur === '-s') && next) {
			args.spaceId = next
			i += 1
		} else if (cur === '--username' && next) {
			args.username = next
			i += 1
		} else if (cur === '--password' && next) {
			args.password = next
			i += 1
		} else if ((cur === '--output' || cur === '-o') && next) {
			args.output = next
			i += 1
		} else if (cur === '--execute') {
			args.execute = true
		} else if (cur === '--help' || cur === '-h') {
			printHelp()
			process.exit(0)
		}
	}
	return args
}

function printHelp() {
	console.log(`\nUsage:\n  node scripts/initCustomerOpeningBalances.cjs --space-id env-xxxx [options]\n\nOptions:\n  --space-id, -s <id>   云空间 ID（必填）\n  --username <name>     CRM 用户名（默认 superadmin）\n  --password <pass>     CRM 密码\n  --output, -o <path>   报告文件路径（默认 docs/customer.opening_balances.report.json）\n  --execute             真执行（默认预览）\n`)
}

function normalizeText(v) {
	return v == null ? '' : String(v).trim()
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	return fs
		.readdirSync(base)
		.map((dir) => path.join(base, dir, 'setting.json'))
		.filter((file) => fs.existsSync(file))
}

function deepFindAlipaySpace(node, spaceId) {
	if (!node || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i += 1) {
			const found = deepFindAlipaySpace(node[i], spaceId)
			if (found) return found
		}
		return null
	}
	if (normalizeText(node.spaceid) === spaceId && node.accessKey && node.secretKey && node.spaceAppId) {
		return {
			spaceid: normalizeText(node.spaceid),
			accessKey: normalizeText(node.accessKey),
			secretKey: normalizeText(node.secretKey),
			spaceAppId: normalizeText(node.spaceAppId),
			apiEndpoint: normalizeText(node.apiEndpoint)
		}
	}
	for (const value of Object.values(node)) {
		const found = deepFindAlipaySpace(value, spaceId)
		if (found) return found
	}
	return null
}

function loadAlipaySpaceConfig(spaceId) {
	const files = listProjectSettingFiles()
	for (const file of files) {
		try {
			const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
			const found = deepFindAlipaySpace(raw, spaceId)
			if (found) return { ...found, from: file }
		} catch (_) {
			// ignore
		}
	}
	return null
}

function sha256Hex(text) {
	return crypto.createHash('sha256').update(String(text)).digest('hex')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', key).update(String(text)).digest('hex')
}

function uuidV4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

function splitPathQuery(urlPath) {
	const idx = String(urlPath).indexOf('?')
	if (idx < 0) return [String(urlPath), '']
	return [urlPath.slice(0, idx), urlPath.slice(idx + 1)]
}

function signRequest(pathWithQuery, { data = {}, method = 'POST', functionName = '', headers = {}, signHeaderKeys = [], config }) {
	const timestamp = String(Date.now())
	const requestId = uuidV4()
	const mergedHeaders = {
		...headers,
		'x-from-app-id': config.spaceAppId,
		'x-from-env-id': config.spaceid,
		'x-to-env-id': config.spaceid,
		'x-from-instance-id': timestamp,
		'x-from-function-name': functionName,
		'x-client-timestamp': timestamp,
		'x-alipay-source': 'client',
		'x-request-id': requestId,
		'x-alipay-callid': requestId,
		'x-trace-id': requestId
	}
	const signedHeaders = [
		'x-from-app-id',
		'x-from-env-id',
		'x-to-env-id',
		'x-from-instance-id',
		'x-from-function-name',
		'x-client-timestamp',
		...signHeaderKeys
	].sort()

	const [pathname, query] = splitPathQuery(pathWithQuery)
	const canonicalHeaderLines = signedHeaders
		.map((k) => `${k.toLowerCase()}:${mergedHeaders[k] || ''}\n`)
		.join('')

	const bodyText = JSON.stringify(data || {})
	const bodyHash = sha256Hex(bodyText)
	const canonicalRequest = `${String(method).toUpperCase()}\n${pathname}\n${query}\n${canonicalHeaderLines}\n${signedHeaders.join(';')}\n${bodyHash}\n`
	const canonicalHash = sha256Hex(canonicalRequest)
	const stringToSign = `HMAC-SHA256\n${timestamp}\n${canonicalHash}\n`
	const signature = hmacSha256Hex(stringToSign, config.secretKey)
	const authorization = `HMAC-SHA256 Credential=${config.accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
	const finalHeaders = {
		...mergedHeaders,
		Authorization: authorization,
		'content-type': 'application/json'
	}
	const endpoint = (config.apiEndpoint || `https://${config.spaceid}.api-hz.cloudbasefunction.cn`).replace(/\/+$/, '')
	return {
		url: `${endpoint}${pathname}${query ? `?${query}` : ''}`,
		headers: finalHeaders,
		bodyText
	}
}

async function invokeFunction(config, functionName, payload) {
	const signed = signRequest('/functions/invokeFunction', {
		data: payload,
		method: 'POST',
		functionName,
		headers: { 'x-to-function-name': functionName },
		signHeaderKeys: ['x-to-function-name'],
		config
	})
	const res = await fetch(signed.url, {
		method: 'POST',
		headers: signed.headers,
		body: signed.bodyText
	})
	const text = await res.text()
	let json = {}
	try {
		json = text ? JSON.parse(text) : {}
	} catch (_) {
		throw new Error(`响应非JSON status=${res.status}: ${text.slice(0, 200)}`)
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`)
	return json
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function run() {
	const options = parseArgs(process.argv)
	if (!options.spaceId) throw new Error('缺少 --space-id')
	const config = loadAlipaySpaceConfig(options.spaceId)
	if (!config) throw new Error(`未找到 space=${options.spaceId} 的支付宝空间配置`)

	const loginRes = await invokeFunction(config, 'crm-auth', {
		action: 'login',
		data: {
			username: options.username,
			password: options.password
		},
		request_id: generateRequestId()
	})
	if (!loginRes || loginRes.code !== 0) throw new Error(`登录失败: ${JSON.stringify(loginRes)}`)
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error('登录成功但未拿到 token')

	const result = await invokeFunction(config, 'crm-customer-settlement', {
		action: 'rebuildOpeningBalancesV1',
		token,
		request_id: generateRequestId(),
		data: {
			execute: Boolean(options.execute)
		}
	})

	const report = {
		started_at: new Date().toISOString(),
		space_id: options.spaceId,
		execute: Boolean(options.execute),
		result
	}

	ensureDir(options.output)
	fs.writeFileSync(options.output, JSON.stringify(report, null, 2), 'utf8')
	console.log(JSON.stringify(report, null, 2))

	if (!result || result.code !== 0) {
		throw new Error(`执行失败: ${JSON.stringify(result)}`)
	}
}

run().catch((err) => {
	console.error('[customer-opening] failed:', err.message)
	process.exit(1)
})
