#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
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
		if (node.accessKey && node.secretKey && node.spaceAppId) return node
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
		const signed = this.signRequest('/functions/invokeFunction', { data: functionArgs, functionName: name })
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

function parseArgs(argv) {
	const out = {
		spaceId: normalizeString(process.env.SPACE_ID) || 'env-00jxuffegf2n',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		execute: false,
		onlyActive: true,
		includeSpecialStatus: false,
		chunkSize: 200,
		bottleNos: [],
		outFile: path.resolve(process.cwd(), 'docs/bottle_current_status_rebuild.latest.json')
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		if (arg === '--execute') {
			out.execute = true
			continue
		}
		if (arg === '--all-status') {
			out.includeSpecialStatus = true
			continue
		}
		if (arg === '--all-bottles') {
			out.onlyActive = false
			continue
		}
		const match = String(arg || '').match(/^--([^=]+)=(.*)$/)
		if (!match) continue
		const key = match[1]
		const value = match[2]
		if (key === 'space-id') out.spaceId = normalizeString(value) || out.spaceId
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'chunk-size') out.chunkSize = Math.max(Number(value) || out.chunkSize, 1)
		if (key === 'bottle-no') out.bottleNos.push(...String(value).split(',').map(normalizeBottleNo).filter(Boolean))
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
	}
	out.bottleNos = Array.from(new Set(out.bottleNos))
	return out
}

async function fetchAllBottleNos(client, token, onlyActive) {
	const out = []
	let page = 1
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle', 'listV1', {
			page,
			pageSize: 50,
			is_active: onlyActive ? true : undefined
		})
		const rows = Array.isArray(res.data) ? res.data : []
		rows.forEach((row) => {
			const no = normalizeBottleNo(row && row.bottle_no)
			if (no) out.push(no)
		})
		if (!res.paging || !res.paging.hasMore) break
		page += 1
	}
	return Array.from(new Set(out))
}

function mergeSummary(target, source = {}) {
	const keys = [
		'target_total',
		'updated_total',
		'changed_total',
		'unchanged_total',
		'no_movement_total',
		'pending_same_day_total',
		'skipped_special_status_total',
		'skipped_inactive_total',
		'skipped_pseudo_total'
	]
	for (const key of keys) {
		target[key] = Number(target[key] || 0) + Number(source[key] || 0)
	}
	return target
}

async function main() {
	const args = parseArgs(process.argv)
	const client = new AlipayFunctionClient(loadAlipayConfig(args.spaceId))
	const token = await login(client, args.username, args.password)
	const targetBottleNos = args.bottleNos.length ? args.bottleNos : await fetchAllBottleNos(client, token, args.onlyActive)
	const chunks = []
	for (let i = 0; i < targetBottleNos.length; i += args.chunkSize) {
		chunks.push(targetBottleNos.slice(i, i + args.chunkSize))
	}

	const report = {
		space_id: args.spaceId,
		generated_at: new Date().toISOString(),
		execute: args.execute,
		only_active: args.onlyActive,
		include_special_status: args.includeSpecialStatus,
		target_bottle_total: targetBottleNos.length,
		chunk_size: args.chunkSize,
		chunks: [],
		summary: {
			target_total: 0,
			updated_total: 0,
			changed_total: 0,
			unchanged_total: 0,
			no_movement_total: 0,
			pending_same_day_total: 0,
			skipped_special_status_total: 0,
			skipped_inactive_total: 0,
			skipped_pseudo_total: 0
		},
		sample_changes: []
	}

	for (let i = 0; i < chunks.length; i += 1) {
		const bottleNos = chunks[i]
		const res = await callCrm(client, token, 'crm-bottle', 'rebuildCurrentStatusV1', {
			preview: !args.execute,
			bottle_nos: bottleNos,
			only_active: args.onlyActive,
			include_special_status: args.includeSpecialStatus
		})
		const data = res.data || {}
		report.chunks.push({
			index: i + 1,
			size: bottleNos.length,
			summary: data.summary || {},
			sample_changes: Array.isArray(data.sample_changes) ? data.sample_changes : []
		})
		mergeSummary(report.summary, data.summary || {})
		if (Array.isArray(data.sample_changes)) {
			for (const row of data.sample_changes) {
				if (report.sample_changes.length >= 50) break
				report.sample_changes.push(row)
			}
		}
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
	process.stdout.write(`${JSON.stringify({ ok: true, out_file: args.outFile, summary: report.summary }, null, 2)}\n`)
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : err)
	process.exit(1)
})
