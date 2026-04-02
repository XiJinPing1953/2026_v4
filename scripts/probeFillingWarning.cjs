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
		bottleNo: '',
		date: '2026-03-31',
		operator: '陈铁栓',
		outFile: path.resolve(process.cwd(), 'docs/filling_warning_probe.latest.json')
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
		if (key === 'bottle-no') out.bottleNo = normalizeBottleNo(value)
		if (key === 'date') out.date = normalizeString(value) || out.date
		if (key === 'operator') out.operator = normalizeString(value) || out.operator
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
	}
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
	throw new Error(`No alipay config for ${spaceId}`)
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
	if (!res || res.code !== 0) throw new Error(`login failed: ${JSON.stringify(res)}`)
	return res.token || (res.user && res.user.token) || (res.data && (res.data.token || (res.data.user && res.data.user.token))) || ''
}

async function callCrmLoose(client, token, name, action, data) {
	const res = await client.callFunction(name, {
		action,
		token,
		data,
		request_id: generateRequestId()
	})
	return res || {}
}

async function pickOutStatusBottle(client, token, date) {
	let page = 1
	const pageSize = 100
	while (page <= 10) {
		const anomalyRes = await callCrmLoose(client, token, 'crm-bottle-anomaly', 'listV1', {
			page,
			pageSize,
			status: 'open',
			type: 'missing_back'
		})
		const list = Array.isArray(anomalyRes.data) ? anomalyRes.data : []
		for (let i = 0; i < list.length; i += 1) {
			const row = list[i] || {}
			const bottleNo = normalizeBottleNo(row.bottle_no)
			if (!bottleNo || bottleNo === '000' || /^TRUCK-/.test(bottleNo)) continue
			return bottleNo
		}
		const hasMore = Boolean(anomalyRes?.paging?.hasMore)
		if (!hasMore) break
		page += 1
	}
	return ''
}

async function main() {
	const args = parseArgs(process.argv)
	const client = new AlipayFunctionClient(loadAlipayConfig(args.spaceId))
	const token = await login(client, args.username, args.password)

	const bottleNo = args.bottleNo || await pickOutStatusBottle(client, token, args.date)
	if (!bottleNo) throw new Error('No bottle found for warning probe. pass --bottle-no explicitly.')

	const createProbe = await callCrmLoose(client, token, 'crm-filling', 'createV1', {
		date: args.date,
		record_type: 'normal_fill',
		input_mode: 'net',
		bottle_no: bottleNo,
		operator: args.operator,
		fill_weight: 66
	})

	const batchPreviewProbe = await callCrmLoose(client, token, 'crm-filling', 'batchCreateV1', {
		preview: true,
		date: args.date,
		record_type: 'normal_fill',
		input_mode: 'net',
		operator: args.operator,
		batch_text: `${bottleNo},66`
	})

	const batchExecuteProbe = await callCrmLoose(client, token, 'crm-filling', 'batchCreateV1', {
		preview: false,
		date: args.date,
		record_type: 'normal_fill',
		input_mode: 'net',
		operator: args.operator,
		batch_text: `${bottleNo},66`
	})

	const report = {
		space_id: args.spaceId,
		date: args.date,
		bottle_no: bottleNo,
		create_probe: createProbe,
		batch_preview_probe: batchPreviewProbe,
		batch_execute_probe: batchExecuteProbe
	}
	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
	process.stdout.write(`${JSON.stringify({ ok: true, bottle_no: bottleNo, out_file: args.outFile }, null, 2)}\n`)
}

main().catch((err) => {
	process.stderr.write(`${err && err.stack ? err.stack : err}\n`)
	process.exit(1)
})
