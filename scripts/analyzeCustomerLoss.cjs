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

function toSafeFileName(value) {
	return normalizeString(value).replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'customer'
}

function parseArgs(argv) {
	const out = {
		spaceId: '',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		customerKeyword: '新乐馒头',
		dateStart: '2026-01-01',
		dateEnd: '',
		topDays: 20,
		topBottles: 30,
		outFile: ''
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
		if (key === 'customer' || key === 'keyword') out.customerKeyword = normalizeString(value) || out.customerKeyword
		if (key === 'date-start') out.dateStart = normalizeString(value) || out.dateStart
		if (key === 'date-end') out.dateEnd = normalizeString(value)
		if (key === 'top-days') out.topDays = Math.max(Number(value) || out.topDays, 1)
		if (key === 'top-bottles') out.topBottles = Math.max(Number(value) || out.topBottles, 1)
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || '')
	}
	if (!out.spaceId) out.spaceId = normalizeString(process.env.SPACE_ID)
	if (!out.spaceId) throw new Error('缺少 --space-id=...')
	if (!out.dateEnd) {
		const now = new Date()
		const y = now.getFullYear()
		const m = String(now.getMonth() + 1).padStart(2, '0')
		const d = String(now.getDate()).padStart(2, '0')
		out.dateEnd = `${y}-${m}-${d}`
	}
	if (!out.outFile) {
		out.outFile = path.resolve(
			process.cwd(),
			`docs/customer_loss_${toSafeFileName(out.customerKeyword)}_${out.dateStart}_${out.dateEnd}.json`
		)
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

async function findCustomer(client, token, keyword) {
	const res = await callCrm(client, token, 'crm-customer', 'listV1', {
		keyword,
		page: 1,
		pageSize: 20,
		summaryIgnoreActive: true
	})
	const rows = Array.isArray(res.data) ? res.data : []
	const exact = rows.find((row) => normalizeString(row && row.name) === keyword)
	return exact || rows[0] || null
}

async function fetchAllSales(client, token, keyword, dateStart, dateEnd) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-sale', 'listV2', {
			keyword,
			dateStart,
			dateEnd,
			page,
			pageSize
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!res?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 200) break
	}
	return rows
}

async function fetchAllCycleLossRows(client, token, bottleNo, dateStart, dateEnd) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-movement', 'cycleLossV1', {
			bottle_no: bottleNo,
			dateStart,
			dateEnd,
			result_type: 'loss',
			page,
			pageSize
		})
		const list = Array.isArray(res?.data?.list) ? res.data.list : []
		rows.push(...list)
		if (!res?.data?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 200) break
	}
	return rows
}

async function fetchAllResolvedMissingFillRows(client, token, bottleNo) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-anomaly', 'listV1', {
			bottle_no: bottleNo,
			anomaly_type: 'missing_fill',
			status: 'resolved',
			page,
			pageSize
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!res?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 200) break
	}
	return rows
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function round2(value) {
	return Math.round(toNumber(value, 0) * 100) / 100
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeDay(value) {
	const text = normalizeString(value)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	return m ? m[1] : ''
}

function buildBreakdown({ customer, salesRows, cycleLossRows, manualLossRows, dateStart, dateEnd }) {
	const dayMap = new Map()
	const bottleMap = new Map()
	const ensureDay = (day) => {
		const normalizedDay = normalizeDay(day)
		if (!normalizedDay) return null
		if (!dayMap.has(normalizedDay)) {
			dayMap.set(normalizedDay, {
				day: normalizedDay,
				cycle_loss_weight: 0,
				cycle_loss_count: 0,
				manual_loss_weight: 0,
				manual_loss_count: 0,
				loss_total_weight: 0,
				bottle_nos: new Set()
			})
		}
		return dayMap.get(normalizedDay)
	}
	const ensureBottle = (bottleNo) => {
		const normalizedBottleNo = normalizeBottleNo(bottleNo)
		if (!normalizedBottleNo) return null
		if (!bottleMap.has(normalizedBottleNo)) {
			bottleMap.set(normalizedBottleNo, {
				bottle_no: normalizedBottleNo,
				cycle_loss_weight: 0,
				cycle_loss_count: 0,
				manual_loss_weight: 0,
				manual_loss_count: 0,
				loss_total_weight: 0,
				days: new Set(),
				sale_ids: new Set()
			})
		}
		return bottleMap.get(normalizedBottleNo)
	}

	for (const row of cycleLossRows) {
		const delta = round2(toNumber(row.delta_kg, 0))
		if (delta <= 0) continue
		const day = ensureDay(row.out_date)
		const bottle = ensureBottle(row.bottle_no)
		if (day) {
			day.cycle_loss_weight += delta
			day.cycle_loss_count += 1
			if (bottle?.bottle_no) day.bottle_nos.add(bottle.bottle_no)
		}
		if (bottle) {
			bottle.cycle_loss_weight += delta
			bottle.cycle_loss_count += 1
			if (day?.day) bottle.days.add(day.day)
			if (row.source_out_id) bottle.sale_ids.add(normalizeString(row.source_out_id))
		}
	}
	for (const row of manualLossRows) {
		const delta = round2(toNumber(row.loss_kg, 0))
		if (delta <= 0) continue
		const day = ensureDay(row.out_date)
		const bottle = ensureBottle(row.bottle_no)
		if (day) {
			day.manual_loss_weight += delta
			day.manual_loss_count += 1
			if (bottle?.bottle_no) day.bottle_nos.add(bottle.bottle_no)
		}
		if (bottle) {
			bottle.manual_loss_weight += delta
			bottle.manual_loss_count += 1
			if (day?.day) bottle.days.add(day.day)
			if (row.source_out_id) bottle.sale_ids.add(normalizeString(row.source_out_id))
		}
	}

	const days = Array.from(dayMap.values())
		.map((row) => ({
			day: row.day,
			cycle_loss_weight: round2(row.cycle_loss_weight),
			cycle_loss_count: row.cycle_loss_count,
			manual_loss_weight: round2(row.manual_loss_weight),
			manual_loss_count: row.manual_loss_count,
			loss_total_weight: round2(row.cycle_loss_weight + row.manual_loss_weight),
			bottle_count: row.bottle_nos.size,
			bottle_nos: Array.from(row.bottle_nos).sort()
		}))
		.sort((a, b) => a.day.localeCompare(b.day))

	const topDays = [...days]
		.sort((a, b) => {
			if (b.loss_total_weight !== a.loss_total_weight) return b.loss_total_weight - a.loss_total_weight
			return a.day.localeCompare(b.day)
		})

	const topBottles = Array.from(bottleMap.values())
		.map((row) => ({
			bottle_no: row.bottle_no,
			cycle_loss_weight: round2(row.cycle_loss_weight),
			cycle_loss_count: row.cycle_loss_count,
			manual_loss_weight: round2(row.manual_loss_weight),
			manual_loss_count: row.manual_loss_count,
			loss_total_weight: round2(row.cycle_loss_weight + row.manual_loss_weight),
			day_count: row.days.size,
			days: Array.from(row.days).sort(),
			sale_ids: Array.from(row.sale_ids)
		}))
		.filter((row) => row.loss_total_weight > 0)
		.sort((a, b) => {
			if (b.loss_total_weight !== a.loss_total_weight) return b.loss_total_weight - a.loss_total_weight
			return a.bottle_no.localeCompare(b.bottle_no)
		})

	const saleIdSet = new Set(salesRows.map((row) => normalizeString(row && row._id)).filter(Boolean))
	return {
		customer: {
			_id: customer._id,
			name: customer.name
		},
		date_start: dateStart,
		date_end: dateEnd,
		loss_total_kg: round2(days.reduce((sum, row) => sum + row.loss_total_weight, 0)),
		cycle_loss_count: cycleLossRows.length,
		manual_loss_count: manualLossRows.length,
		bottle_count: bottleMap.size,
		day_count: days.length,
		sale_count: saleIdSet.size,
		days,
		top_days: topDays,
		top_bottles: topBottles
	}
}

async function main() {
	const args = parseArgs(process.argv)
	const config = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(config)
	const token = await login(client, args.username, args.password)
	const customer = await findCustomer(client, token, args.customerKeyword)
	if (!customer) throw new Error(`未找到客户: ${args.customerKeyword}`)

	const salesRowsRaw = await fetchAllSales(client, token, customer.name, args.dateStart, args.dateEnd)
	const salesRows = salesRowsRaw.filter(
		(row) => normalizeString(row && row.customer_name) === normalizeString(customer.name)
	)
	const saleIdSet = new Set(salesRows.map((row) => normalizeString(row && row._id)).filter(Boolean))
	const bottleNos = Array.from(
		new Set(
			salesRows.flatMap((row) =>
				(Array.isArray(row && row.out_items) ? row.out_items : [])
					.map((item) => normalizeBottleNo(item && item.bottle_no))
					.filter(Boolean)
			)
		)
	).sort()

	const cycleLossRows = []
	const manualLossRows = []
	for (const bottleNo of bottleNos) {
		const [cycleRows, anomalyRows] = await Promise.all([
			fetchAllCycleLossRows(client, token, bottleNo, args.dateStart, args.dateEnd),
			fetchAllResolvedMissingFillRows(client, token, bottleNo)
		])
		for (const row of cycleRows) {
			const sourceOutId = normalizeString(row && row.source_out_id)
			if (!saleIdSet.has(sourceOutId)) continue
			cycleLossRows.push({
				bottle_no: bottleNo,
				back_date: normalizeString(row && row.back_date),
				out_date: normalizeString(row && row.out_date),
				delta_kg: round2(toNumber(row && row.delta_kg, 0)),
				fill_count: Number(row && row.fill_count) || 0,
				fill_sum_kg: round2(toNumber(row && row.fill_sum_kg, 0)),
				out_net_kg: round2(toNumber(row && row.out_net_kg, 0)),
				theoretical_out_kg: round2(toNumber(row && row.theoretical_out_kg, 0)),
				source_out_id: sourceOutId
			})
		}
		for (const row of anomalyRows) {
			const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
			const resolution = ctx && typeof ctx.resolution === 'object' && !Array.isArray(ctx.resolution) ? ctx.resolution : {}
			if (normalizeString(resolution.mode).toLowerCase() !== 'loss_accept') continue
			const sourceOutId = normalizeString(ctx?.next_out?.source_id)
			if (!saleIdSet.has(sourceOutId)) continue
			manualLossRows.push({
				bottle_no: bottleNo,
				out_date: normalizeString(ctx?.next_out?.date),
				loss_kg: round2(toNumber(resolution.loss_kg, 0)),
				source_out_id: sourceOutId,
				anomaly_id: normalizeString(row && row._id)
			})
		}
	}

	const breakdown = buildBreakdown({
		customer,
		salesRows,
		cycleLossRows,
		manualLossRows,
		dateStart: args.dateStart,
		dateEnd: args.dateEnd
	})

	let statementAnalysis = null
	let statementAnalysisError = ''
	try {
		const statementRes = await callCrm(client, token, 'crm-customer-settlement', 'getCustomerStatementAnalysisV1', {
			customer_id: customer._id,
			date_from: args.dateStart,
			date_to: args.dateEnd
		})
		statementAnalysis = statementRes.data || {}
	} catch (err) {
		statementAnalysisError = normalizeString(err && err.message)
	}

	const out = {
		request: {
			space_id: args.spaceId,
			customer_keyword: args.customerKeyword,
			date_start: args.dateStart,
			date_end: args.dateEnd,
			top_days: args.topDays,
			top_bottles: args.topBottles
		},
		customer: {
			_id: customer._id,
			name: customer.name,
			short_name: customer.short_name || '',
			default_price_unit: customer.default_price_unit || '',
			default_unit_price: customer.default_unit_price || null
		},
		sales_scope: {
			sale_count: salesRows.length,
			bottle_count: bottleNos.length
		},
		statement_analysis: statementAnalysis,
		statement_analysis_error: statementAnalysisError,
		loss_breakdown: breakdown,
		raw_cycle_loss_rows: cycleLossRows,
		raw_manual_loss_rows: manualLossRows
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, JSON.stringify(out, null, 2))
	console.log(JSON.stringify({ ok: true, out_file: args.outFile, customer_id: customer._id, customer_name: customer.name }, null, 2))
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : String(err))
	process.exitCode = 1
})
