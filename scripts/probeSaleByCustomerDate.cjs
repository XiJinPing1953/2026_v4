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

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function parseArgs(argv) {
	const out = {
		spaceId: normalizeString(process.env.SPACE_ID) || 'env-00jxuffegf2n',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		customerName: '',
		date: '',
		outFile: path.resolve(process.cwd(), 'docs/sale_probe_by_customer_date.latest.json')
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		const m = String(arg || '').match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'space-id') out.spaceId = normalizeString(value) || out.spaceId
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'customer-name') out.customerName = normalizeString(value)
		if (key === 'date') out.date = normalizeString(value)
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
	}
	if (!out.customerName) throw new Error('缺少 --customer-name')
	if (!out.date) throw new Error('缺少 --date')
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
	if (node.spaceid === spaceId && node.accessKey && node.secretKey && node.spaceAppId) return node
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
			const cfg = {
				spaceId,
				accessKey: normalizeString(space.accessKey),
				secretKey: normalizeString(space.secretKey),
				spaceAppId: normalizeString(space.spaceAppId),
				endpoint: normalizeString(space.apiEndpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`
			}
			if (cfg.accessKey && cfg.secretKey && cfg.spaceAppId) return cfg
		} catch (_) {}
	}
	throw new Error(`未找到空间 ${spaceId} 的支付宝配置`)
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
		const signed = this.signRequest('/functions/invokeFunction', { data: functionArgs, functionName: name })
		const res = await fetch(signed.url, { method: 'POST', headers: signed.headers, body: signed.bodyText })
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
	if (!res || res.code !== 0) throw new Error(`登录失败: ${JSON.stringify(res)}`)
	return res.token || (res.user && res.user.token) || (res.data && (res.data.token || (res.data.user && res.data.user.token))) || ''
}

async function callCrm(client, token, name, action, data) {
	const res = await client.callFunction(name, {
		action,
		token,
		data,
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) throw new Error(`${name}.${action} 失败: ${JSON.stringify(res)}`)
	return res
}

function pickBottleNos(rows = []) {
	return Array.from(
		new Set((rows || []).map((row) => normalizeBottleNo(row && row.bottle_no)).filter(Boolean))
	).sort()
}

async function main() {
	const args = parseArgs(process.argv)
	const client = new AlipayFunctionClient(loadAlipayConfig(args.spaceId))
	const token = await login(client, args.username, args.password)
	const listRes = await callCrm(client, token, 'crm-sale', 'listV2', {
		keyword: args.customerName,
		dateStart: args.date,
		dateEnd: args.date,
		page: 1,
		pageSize: 200
	})
	const list = Array.isArray(listRes.data) ? listRes.data : []
	const matched = list.filter((row) => normalizeString(row && row.customer_name).includes(args.customerName) && normalizeString(row && row.date) === args.date)
	const details = []
	for (const row of matched) {
		const id = normalizeString(row && row._id)
		if (!id) continue
		const getRes = await callCrm(client, token, 'crm-sale', 'getV2', { _id: id })
		const doc = getRes.data || {}
		details.push({
			_id: id,
			date: normalizeString(doc.date),
			customer_name: normalizeString(doc.customer_name),
			biz_mode: normalizeString(doc.biz_mode),
			out_bottle_nos: pickBottleNos(doc.out_items),
			back_bottle_nos: pickBottleNos(doc.back_items),
			deposit_bottle_nos: pickBottleNos(doc.deposit_rows),
			out_items: doc.out_items || [],
			back_items: doc.back_items || [],
			deposit_rows: doc.deposit_rows || []
		})
	}
	let depositPreview = null
	if (details.length > 0) {
		const customerId = normalizeString(details[0] && details[0]._id ? matched[0].customer_id : '')
		if (customerId) {
			const depositRes = await callCrm(client, token, 'crm-sale', 'getCustomerDepositV1', {
				customerId,
				date: args.date
			})
			depositPreview = depositRes.data || null
		}
	}
	const report = {
		space_id: args.spaceId,
		customer_name: args.customerName,
		date: args.date,
		total_candidates: list.length,
		matched_total: matched.length,
		details,
		deposit_preview: depositPreview
	}
	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
	process.stdout.write(`${JSON.stringify({ ok: true, out_file: args.outFile, matched_total: matched.length }, null, 2)}\n`)
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : err)
	process.exit(1)
})

