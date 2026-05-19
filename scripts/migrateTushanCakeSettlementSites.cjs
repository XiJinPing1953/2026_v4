#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

function normalizeText(value) {
	return value == null ? '' : String(value).trim()
}

function parseArgs(argv) {
	const args = {
		spaceId: process.env.UNI_SPACE_ID || '',
		username: process.env.CRM_USERNAME || 'superadmin',
		password: process.env.CRM_PASSWORD || '',
		settlementName: '土山蛋糕',
		deliverySiteName: '土山蛋糕西厂',
		execute: false,
		output: 'docs/tushan_cake_settlement_sites.migration.report.json'
	}
	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if ((cur === '--space-id' || cur === '-s') && next) {
			args.spaceId = normalizeText(next)
			i += 1
		} else if (cur === '--username' && next) {
			args.username = normalizeText(next) || args.username
			i += 1
		} else if (cur === '--password' && next) {
			args.password = normalizeText(next) || args.password
			i += 1
		} else if (cur === '--settlement-name' && next) {
			args.settlementName = normalizeText(next) || args.settlementName
			i += 1
		} else if (cur === '--delivery-site-name' && next) {
			args.deliverySiteName = normalizeText(next) || args.deliverySiteName
			i += 1
		} else if ((cur === '--output' || cur === '-o') && next) {
			args.output = normalizeText(next) || args.output
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
	console.log(`
Usage:
  node scripts/migrateTushanCakeSettlementSites.cjs --space-id env-xxxx [options]

Options:
  --space-id, -s <id>            uniCloud space id, or env UNI_SPACE_ID
  --username <name>              CRM username, default superadmin
  --password <pass>              CRM password
  --settlement-name <name>       Billing customer, default 土山蛋糕
  --delivery-site-name <name>    Delivery site, default 土山蛋糕西厂
  --output, -o <path>            Report path
  --execute                      Actually migrate data. Default is dry-run.
`)
}

function ensureDir(filePath) {
	const dir = path.dirname(path.resolve(filePath))
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
		for (const item of node) {
			const found = deepFindAlipaySpace(item, spaceId)
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
	for (const file of listProjectSettingFiles()) {
		try {
			const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
			const found = deepFindAlipaySpace(raw, spaceId)
			if (found) return { ...found, from: file }
		} catch (_) {}
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
	const canonicalHeaderLines = signedHeaders.map((key) => `${key.toLowerCase()}:${mergedHeaders[key] || ''}\n`).join('')
	const bodyText = JSON.stringify(data || {})
	const canonicalRequest = `${String(method).toUpperCase()}\n${pathname}\n${query}\n${canonicalHeaderLines}\n${signedHeaders.join(';')}\n${sha256Hex(bodyText)}\n`
	const stringToSign = `HMAC-SHA256\n${timestamp}\n${sha256Hex(canonicalRequest)}\n`
	const authorization = `HMAC-SHA256 Credential=${config.accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${hmacSha256Hex(stringToSign, config.secretKey)}`
	const endpoint = (config.apiEndpoint || `https://${config.spaceid}.api-hz.cloudbasefunction.cn`).replace(/\/+$/, '')
	return {
		url: `${endpoint}${pathname}${query ? `?${query}` : ''}`,
		headers: { ...mergedHeaders, Authorization: authorization, 'content-type': 'application/json' },
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
	const res = await fetch(signed.url, { method: 'POST', headers: signed.headers, body: signed.bodyText })
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

function requestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function run() {
	const args = parseArgs(process.argv)
	if (!args.spaceId) throw new Error('缺少 --space-id 或 UNI_SPACE_ID')
	if (!args.password) throw new Error('缺少 --password 或 CRM_PASSWORD')
	const config = loadAlipaySpaceConfig(args.spaceId)
	if (!config) throw new Error(`未找到 space=${args.spaceId} 的支付宝空间配置`)

	const loginRes = await invokeFunction(config, 'crm-auth', {
		action: 'login',
		data: { username: args.username, password: args.password },
		request_id: requestId()
	})
	if (!loginRes || loginRes.code !== 0) throw new Error(`登录失败: ${JSON.stringify(loginRes)}`)
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error('登录成功但未拿到 token')

	const result = await invokeFunction(config, 'crm-customer-settlement', {
		action: 'migrateTushanCakeSettlementSitesV1',
		token,
		request_id: requestId(),
		data: {
			execute: args.execute,
			settlement_name: args.settlementName,
			delivery_site_name: args.deliverySiteName
		}
	})
	const report = {
		started_at: new Date().toISOString(),
		space_id: args.spaceId,
		execute: args.execute,
		settlement_name: args.settlementName,
		delivery_site_name: args.deliverySiteName,
		result
	}
	ensureDir(args.output)
	fs.writeFileSync(args.output, JSON.stringify(report, null, 2), 'utf8')
	console.log(JSON.stringify(report, null, 2))
	if (!result || result.code !== 0) throw new Error(`迁移失败: ${JSON.stringify(result)}`)
}

run().catch((err) => {
	console.error('[tushan-cake-migration] failed:', err.message)
	process.exit(1)
})
