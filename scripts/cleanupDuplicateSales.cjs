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

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function roundTo(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	const base = 10 ** Number(digits || 0)
	return Math.round(num * base) / base
}

function kgToTon(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return roundTo(num / 1000, 3)
}

function sumNetKgFromSaleItems(rows = [], key = 'net') {
	return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
		return sum + (toNumber(row && row[key], 0) || 0)
	}, 0)
}

function resolveTruckSaleNetValue(truckGrossDiff, legacyTruckSaleNet, truckOutGross, truckBackGross) {
	const explicit = toNumber(truckGrossDiff, null)
	if (explicit != null && explicit > 0) return explicit
	const outGross = toNumber(truckOutGross, null)
	const backGross = toNumber(truckBackGross, null)
	if (outGross != null && backGross != null) {
		return Math.max(outGross - backGross, 0)
	}
	const legacy = toNumber(legacyTruckSaleNet, null)
	return legacy != null && legacy > 0 ? legacy : 0
}

function buildSaleDuplicateSignature(row = {}) {
	const bizMode = normalizeString(row.biz_mode).toLowerCase() || 'bottle'
	if (bizMode === 'truck') {
		return [
			bizMode,
			normalizeString(row.date),
			normalizeString(row.customer_id),
			normalizePlateNo(row.truck_no),
			resolveTruckSaleNetValue(row.truck_gross_diff, row.truck_sale_net, row.truck_out_gross, row.truck_back_gross),
			toNumber(row.truck_out_gross, ''),
			toNumber(row.truck_back_gross, '')
		].join('|')
	}
	if (bizMode === 'agent_sale') {
		return [
			bizMode,
			normalizeString(row.date),
			normalizeString(row.customer_id),
			sumNetKgFromSaleItems(row.agent_sale_items, 'fill_weight')
		].join('|')
	}
	return [
		bizMode,
		normalizeString(row.date),
		normalizeString(row.customer_id),
		sumNetKgFromSaleItems(row.out_items, 'net'),
		sumNetKgFromSaleItems(row.back_items, 'net'),
		toNumber(row.total_net_weight, '')
	].join('|')
}

function buildDuplicateGroups(rows = []) {
	const groups = new Map()
	for (const row of rows) {
		const key = buildSaleDuplicateSignature(row)
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(row)
	}
	return Array.from(groups.entries())
		.filter(([, list]) => list.length > 1)
		.map(([signature, list]) => {
			const sorted = [...list].sort((a, b) => {
				const aCreated = toNumber(a && a.created_at, 0) || 0
				const bCreated = toNumber(b && b.created_at, 0) || 0
				if (aCreated !== bCreated) return aCreated - bCreated
				const aUpdated = toNumber(a && a.updated_at, 0) || 0
				const bUpdated = toNumber(b && b.updated_at, 0) || 0
				if (aUpdated !== bUpdated) return aUpdated - bUpdated
				const aId = normalizeString(a && a._id)
				const bId = normalizeString(b && b._id)
				return aId < bId ? -1 : aId > bId ? 1 : 0
			})
			return {
				signature,
				biz_mode: normalizeString(sorted[0] && sorted[0].biz_mode),
				date: normalizeString(sorted[0] && sorted[0].date),
				customer_name: normalizeString(sorted[0] && sorted[0].customer_name),
				truck_no: normalizePlateNo(sorted[0] && sorted[0].truck_no),
				keep_row: summarizeRow(sorted[0]),
				remove_rows: sorted.slice(1).map(summarizeRow),
				total: sorted.length
			}
		})
		.sort((a, b) => b.total - a.total || a.date.localeCompare(b.date))
}

function buildDuplicateGroupsFromDiagnosis(groups = []) {
	return (Array.isArray(groups) ? groups : [])
		.map((group) => {
			const rawRows = Array.isArray(group && group.rows) ? group.rows : []
			const sorted = [...rawRows].sort((a, b) => {
				const aId = normalizeString(a && a._id)
				const bId = normalizeString(b && b._id)
				return aId < bId ? -1 : aId > bId ? 1 : 0
			})
			if (sorted.length <= 1) return null
			return {
				signature: normalizeString(group && group.signature),
				biz_mode: normalizeString(group && group.biz_mode),
				date: normalizeString(group && group.date),
				customer_name: normalizeString(group && group.customer_name),
				truck_no: normalizePlateNo(group && group.truck_no),
				keep_row: summarizeRow(sorted[0]),
				remove_rows: sorted.slice(1).map(summarizeRow),
				total: sorted.length
			}
		})
		.filter(Boolean)
		.sort((a, b) => b.total - a.total || a.date.localeCompare(b.date))
}

function summarizeRow(row = {}) {
	return {
		_id: normalizeString(row && row._id),
		date: normalizeString(row && row.date),
		customer_name: normalizeString(row && row.customer_name),
		biz_mode: normalizeString(row && row.biz_mode),
		truck_no: normalizePlateNo(row && row.truck_no),
		total_net_weight_kg: toNumber(row && row.total_net_weight, null),
		truck_gross_diff_kg: resolveTruckSaleNetValue(
			row && row.truck_gross_diff,
			row && row.truck_sale_net,
			row && row.truck_out_gross,
			row && row.truck_back_gross
		),
		remark: normalizeString(row && row.remark),
		created_at: toNumber(row && row.created_at, null),
		updated_at: toNumber(row && row.updated_at, null)
	}
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

async function fetchAllPages(fetchPage) {
	const rows = []
	let page = 1
	while (true) {
		const res = await fetchPage(page)
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		const total = Number(res.total || res.paging?.total || 0)
		const pageSize = Number(res.pageSize || res.paging?.pageSize || 0)
		const hasMore = Boolean(res.hasMore || res.paging?.hasMore || (pageSize > 0 && page * pageSize < total))
		if (!hasMore || !list.length) break
		page += 1
		if (page > 2000) throw new Error('分页保护触发')
	}
	return rows
}

async function fetchAllSaleRows(client, token) {
	return fetchAllPages(async (page) => callCrm(client, token, 'crm-sale', 'listV2', { page, pageSize: 50 }))
}

function parseArgs(argv) {
	const out = {
		spaceId: normalizeString(process.env.SPACE_ID) || 'env-00jxuffegf2n',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		execute: false,
		outFile: path.resolve(process.cwd(), 'docs/sale_duplicate_cleanup.latest.json'),
		fromDiagnosis: path.resolve(process.cwd(), 'docs/gas_inventory_diagnosis.latest.json')
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		if (arg === '--execute') {
			out.execute = true
			continue
		}
		const match = String(arg || '').match(/^--([^=]+)=(.*)$/)
		if (!match) continue
		const key = match[1]
		const value = match[2]
		if (key === 'space-id') out.spaceId = normalizeString(value) || out.spaceId
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
		if (key === 'from') out.fromDiagnosis = path.resolve(process.cwd(), value || out.fromDiagnosis)
	}
	return out
}

async function main() {
	const args = parseArgs(process.argv)
	const client = new AlipayFunctionClient(loadAlipayConfig(args.spaceId))
	const token = await login(client, args.username, args.password)
	let saleRows = []
	let groups = []
	if (fs.existsSync(args.fromDiagnosis)) {
		const diagnosis = JSON.parse(fs.readFileSync(args.fromDiagnosis, 'utf8'))
		groups = buildDuplicateGroupsFromDiagnosis(diagnosis && diagnosis.suspected_duplicate_sales)
	} else {
		saleRows = await fetchAllSaleRows(client, token)
		groups = buildDuplicateGroups(saleRows)
	}
	const report = {
		space_id: args.spaceId,
		generated_at: new Date().toISOString(),
		execute: args.execute,
		from_diagnosis: fs.existsSync(args.fromDiagnosis) ? args.fromDiagnosis : '',
		source_sale_total: saleRows.length,
		duplicate_group_total: groups.length,
		duplicate_extra_row_total: groups.reduce((sum, group) => sum + Number(group.remove_rows.length || 0), 0),
		groups
	}

	if (args.execute) {
		report.removed = []
		report.failed = []
		for (const group of groups) {
			for (const row of group.remove_rows) {
				try {
					const res = await callCrm(client, token, 'crm-sale', 'removeV2', { recordId: row._id })
					report.removed.push({
						_id: row._id,
						signature: group.signature,
						date: row.date,
						customer_name: row.customer_name,
						msg: normalizeString(res.msg)
					})
				} catch (err) {
					report.failed.push({
						_id: row._id,
						signature: group.signature,
						date: row.date,
						customer_name: row.customer_name,
						msg: normalizeString(err && err.message)
					})
				}
			}
		}
		report.removed_total = report.removed.length
		report.failed_total = report.failed.length
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

	process.stdout.write(
		`${JSON.stringify(
			{
				duplicate_group_total: report.duplicate_group_total,
				duplicate_extra_row_total: report.duplicate_extra_row_total,
				removed_total: report.removed_total || 0,
				failed_total: report.failed_total || 0
			},
			null,
			2
		)}\n`
	)
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : err)
	process.exit(1)
})
