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

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function round3(value) {
	const num = Number(value || 0)
	if (!Number.isFinite(num)) return 0
	return Math.round(num * 1000) / 1000
}

function parseArgs(argv) {
	const out = {
		spaceId: '',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		bottleNo: '172',
		outFile: path.resolve(process.cwd(), 'docs/bottle_cycle_probe_172.json')
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
		if (key === 'bottle-no') out.bottleNo = normalizeBottleNo(value) || out.bottleNo
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
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
	return (
		res.token ||
		(res.user && res.user.token) ||
		(res.data && (res.data.token || (res.data.user && res.data.user.token))) ||
		''
	)
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

async function fetchAllFillings(client, token, bottleNo) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-filling', 'listV1', {
			page,
			pageSize,
			bottle_no: bottleNo
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!res?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 200) break
	}
	return rows
}

async function fetchAllBottleMovements(client, token, bottleNo) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-movement', 'listV1', {
			page,
			pageSize,
			bottle_no: bottleNo
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		const total = Number(res.total || 0)
		if (list.length < pageSize || rows.length >= total) break
		page += 1
		if (page > 300) break
	}
	return rows
}

async function fetchAllCycles(client, token, bottleNo) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-movement', 'cycleLossV1', {
			page,
			pageSize,
			bottle_no: bottleNo
		})
		const list = Array.isArray(res?.data?.list) ? res.data.list : []
		rows.push(...list)
		if (!res?.data?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 200) break
	}
	return rows
}

function pickRowsByDates(cycleRows, outDates) {
	const map = new Map()
	for (const row of cycleRows) {
		const day = normalizeString(row && row.out_date)
		if (!day) continue
		if (!map.has(day)) map.set(day, row)
	}
	return outDates
		.map((day) => map.get(day))
		.filter(Boolean)
}

function buildCrossCheck(rows, movementRows, fillingRows) {
	const movementById = new Map(
		(movementRows || [])
			.map((row) => [normalizeString(row && row._id), row])
			.filter((item) => item[0])
	)
	const fillMovementsBySourceId = new Map(
		(movementRows || [])
			.filter((row) => normalizeString(row && row.type) === 'fill')
			.map((row) => [normalizeString(row && row.source_id), row])
			.filter((item) => item[0])
	)
	const fillingById = new Map(
		(fillingRows || [])
			.map((row) => [normalizeString(row && row._id), row])
			.filter((item) => item[0])
	)
	return rows.map((row) => {
		const fillIds = Array.isArray(row.source_fill_ids) ? row.source_fill_ids.map((id) => normalizeString(id)).filter(Boolean) : []
		const fillMovements = fillIds
			.map((id) => fillMovementsBySourceId.get(id) || movementById.get(id))
			.filter(Boolean)
		const fillMovementWeight = round3(
			fillMovements.reduce((sum, m) => sum + (toNumber(m && m.net_weight, 0) || 0), 0)
		)
		const fillSourceIds = fillMovements
			.map((m) => normalizeString(m && m.source_id))
			.filter(Boolean)
		const fillDocs = fillSourceIds.map((id) => fillingById.get(id)).filter(Boolean)
		const fillDocWeight = round3(fillDocs.reduce((sum, d) => sum + (toNumber(d && d.fill_weight, 0) || 0), 0))
		return {
			out_date: row.out_date,
			bottle_no: row.bottle_no,
			back_net_kg: toNumber(row.back_net_kg, 0),
			fill_count_cycle: Number(row.fill_count || 0),
			fill_sum_cycle_kg: toNumber(row.fill_sum_kg, 0),
			out_net_kg: toNumber(row.out_net_kg, 0),
			theoretical_out_kg: toNumber(row.theoretical_out_kg, 0),
			delta_kg: toNumber(row.delta_kg, 0),
			result_type: normalizeString(row.result_type),
			source_back_id: normalizeString(row.source_back_id),
			source_fill_ids: fillIds,
			source_out_id: normalizeString(row.source_out_id),
			check_fill_movement_count: fillMovements.length,
			check_fill_movement_weight_kg: fillMovementWeight,
			check_fill_doc_count: fillDocs.length,
			check_fill_doc_weight_kg: fillDocWeight,
			check_fill_count_match: fillMovements.length === Number(row.fill_count || 0),
			check_fill_weight_match: Math.abs(fillMovementWeight - (toNumber(row.fill_sum_kg, 0) || 0)) < 0.001
		}
	})
}

function sortByDateAsc(rows, field = 'date') {
	return [...(rows || [])].sort((a, b) => normalizeString(a && a[field]).localeCompare(normalizeString(b && b[field])))
}

async function main() {
	const args = parseArgs(process.argv)
	const conf = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(conf)
	const token = await login(client, args.username, args.password)

	const [fillingRows, movementRows, cycleRows] = await Promise.all([
		fetchAllFillings(client, token, args.bottleNo),
		fetchAllBottleMovements(client, token, args.bottleNo),
		fetchAllCycles(client, token, args.bottleNo)
	])

	const focusDates = ['2026-03-05', '2026-01-31', '2026-01-19', '2026-01-15', '2026-01-02']
	const focusedCycles = pickRowsByDates(cycleRows, focusDates)
	const focusedChecks = buildCrossCheck(focusedCycles, movementRows, fillingRows)

	const report = {
		generated_at: new Date().toISOString(),
		space_id: args.spaceId,
		bottle_no: args.bottleNo,
		config_from: conf.from,
		summary: {
			filling_total: fillingRows.length,
			movement_total: movementRows.length,
			cycle_total: cycleRows.length,
			focus_cycle_count: focusedChecks.length
		},
		focus_dates: focusDates,
		focus_checks: focusedChecks,
		filling_rows: sortByDateAsc(
			fillingRows.map((row) => ({
				_id: normalizeString(row && row._id),
				date: normalizeString(row && row.date),
				bottle_no: normalizeBottleNo(row && row.bottle_no),
				fill_weight: toNumber(row && row.fill_weight, null),
				record_type: normalizeString(row && row.record_type),
				operator: normalizeString(row && row.operator)
			}))
		),
		movement_rows: sortByDateAsc(
			movementRows.map((row) => ({
				_id: normalizeString(row && row._id),
				date: normalizeString(row && row.date),
				type: normalizeString(row && row.type),
				source_type: normalizeString(row && row.source_type),
				source_id: normalizeString(row && row.source_id),
				net_weight: toNumber(row && row.net_weight, null),
				loss_weight: toNumber(row && row.loss_weight, null),
				note: normalizeString(row && row.note)
			}))
		)
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, JSON.stringify(report, null, 2), 'utf8')
	console.log(
		JSON.stringify(
			{
				report_file: args.outFile,
				summary: report.summary,
				focus_checks: report.focus_checks
			},
			null,
			2
		)
	)
}

main().catch((err) => {
	console.error('[probeBottleCycleByNo] FAIL', err && err.message ? err.message : err)
	process.exitCode = 1
})
