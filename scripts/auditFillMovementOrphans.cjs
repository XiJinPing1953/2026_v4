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

function normalizeDay(value) {
	const text = normalizeString(value)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	return m ? m[1] : ''
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function parseArgs(argv) {
	const out = {
		spaceId: '',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		outFile: path.resolve(process.cwd(), 'docs/fill_movement_orphan_audit.json'),
		sampleLimit: 80,
		includeAll: true
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		const m = String(arg || '').match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'space-id') out.spaceId = normalizeString(value)
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
		if (key === 'sample-limit') out.sampleLimit = Math.max(10, Math.min(500, Number(value) || 80))
		if (key === 'include-all') out.includeAll = String(value).toLowerCase() !== 'false'
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
	if (!res || res.code !== 0) throw new Error(`登录失败: ${JSON.stringify(res)}`)
	return res.token || (res.user && res.user.token) || ''
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

async function fetchAllFillings(client, token) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-filling', 'listV1', { page, pageSize })
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!res?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 1000) break
	}
	return rows
}

async function fetchAllFillMovements(client, token) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-movement', 'listV1', {
			page,
			pageSize,
			type: 'fill'
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		const total = Number(res.total || 0)
		if (list.length < pageSize || rows.length >= total) break
		page += 1
		if (page > 2000) break
	}
	return rows
}

function safeWeightKey(value) {
	const num = toNumber(value, null)
	if (num == null) return ''
	return String(Math.round(num * 1000) / 1000)
}

function makeLegacyKey(row) {
	const bottleNo = normalizeBottleNo(row && row.bottle_no)
	const day = normalizeDay((row && row.event_day) || (row && row.date))
	const weight = safeWeightKey(row && row.net_weight)
	return `${bottleNo}|${day}|${weight}`
}

function topBottleStats(rows, topN = 30) {
	const map = new Map()
	for (const row of rows || []) {
		const bottleNo = normalizeBottleNo(row && row.bottle_no) || '(empty)'
		map.set(bottleNo, (map.get(bottleNo) || 0) + 1)
	}
	return Array.from(map.entries())
		.map(([bottle_no, count]) => ({ bottle_no, count }))
		.sort((a, b) => b.count - a.count || a.bottle_no.localeCompare(b.bottle_no, 'zh-Hans-CN', { numeric: true }))
		.slice(0, topN)
}

async function main() {
	const args = parseArgs(process.argv)
	const conf = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(conf)
	const token = await login(client, args.username, args.password)

	const [fillings, fillMovements] = await Promise.all([
		fetchAllFillings(client, token),
		fetchAllFillMovements(client, token)
	])

	const fillingIdSet = new Set(fillings.map((row) => normalizeString(row && row._id)).filter(Boolean))
	const legacyByKey = new Map()
	for (const row of fillMovements) {
		if (normalizeString(row && row.source_type) !== 'legacy_import') continue
		const key = makeLegacyKey(row)
		if (!legacyByKey.has(key)) legacyByKey.set(key, [])
		legacyByKey.get(key).push(row)
	}

	const orphans = []
	for (const row of fillMovements) {
		if (normalizeString(row && row.source_type) !== 'filling') continue
		const sourceId = normalizeString(row && row.source_id)
		if (sourceId && fillingIdSet.has(sourceId)) continue

		const key = makeLegacyKey(row)
		const legacyMatches = legacyByKey.get(key) || []
		orphans.push({
			movement_id: normalizeString(row && row._id),
			date: normalizeString(row && row.date),
			event_day: normalizeDay((row && row.event_day) || (row && row.date)),
			bottle_no: normalizeBottleNo(row && row.bottle_no),
			net_weight: toNumber(row && row.net_weight, null),
			source_type: normalizeString(row && row.source_type),
			source_id: sourceId,
			legacy_match_count: legacyMatches.length,
			legacy_match_samples: legacyMatches.slice(0, 2).map((m) => ({
				movement_id: normalizeString(m && m._id),
				source_id: normalizeString(m && m.source_id),
				date: normalizeString(m && m.date),
				net_weight: toNumber(m && m.net_weight, null)
			}))
		})
	}

	const orphansWithLegacyPair = orphans.filter((row) => Number(row.legacy_match_count || 0) > 0)
	const orphansWithoutLegacyPair = orphans.filter((row) => Number(row.legacy_match_count || 0) <= 0)
	const removeCandidateIds = orphansWithLegacyPair.map((row) => normalizeString(row.movement_id)).filter(Boolean)
	const affectedBottleNos = Array.from(
		new Set(orphansWithLegacyPair.map((row) => normalizeBottleNo(row.bottle_no)).filter(Boolean))
	).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))

	const report = {
		generated_at: new Date().toISOString(),
		space_id: args.spaceId,
		config_from: conf.from,
		summary: {
			fillings_total: fillings.length,
			fill_movements_total: fillMovements.length,
			orphan_filling_movements_total: orphans.length,
			orphan_with_legacy_pair_total: orphansWithLegacyPair.length,
			orphan_without_legacy_pair_total: orphansWithoutLegacyPair.length,
			affected_bottle_total: new Set(orphans.map((r) => normalizeBottleNo(r.bottle_no)).filter(Boolean)).size
		},
		dry_run_plan: {
			remove_candidate_total: removeCandidateIds.length,
			remove_candidate_ids: removeCandidateIds,
			affected_bottle_total: affectedBottleNos.length,
			affected_bottles: affectedBottleNos
		},
		top_bottles: topBottleStats(orphans, 40),
		orphans_sample: orphans.slice(0, args.sampleLimit),
		orphans_with_legacy_pair_sample: orphansWithLegacyPair.slice(0, args.sampleLimit),
		orphans_without_legacy_pair_sample: orphansWithoutLegacyPair.slice(0, args.sampleLimit)
	}
	if (args.includeAll) {
		report.orphans_all = orphans
		report.orphans_with_legacy_pair_all = orphansWithLegacyPair
		report.orphans_without_legacy_pair_all = orphansWithoutLegacyPair
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, JSON.stringify(report, null, 2), 'utf8')

	console.log(
		JSON.stringify(
			{
				report_file: args.outFile,
				summary: report.summary,
				top_bottles: report.top_bottles.slice(0, 12)
			},
			null,
			2
		)
	)
}

main().catch((err) => {
	console.error('[auditFillMovementOrphans] FAIL', err && err.message ? err.message : err)
	process.exitCode = 1
})
