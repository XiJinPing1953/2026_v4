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

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	return Math.round(toNumber(value, 0) * 100) / 100
}

function parseArgs(argv) {
	const today = new Date()
	const y = today.getFullYear()
	const m = String(today.getMonth() + 1).padStart(2, '0')
	const d = String(today.getDate()).padStart(2, '0')
	const monthStart = `${y}-${m}-01`
	const lastDay = new Date(y, today.getMonth() + 1, 0).getDate()
	const monthEnd = `${y}-${m}-${String(lastDay).padStart(2, '0')}`
	const out = {
		spaceId: '',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		dateStart: monthStart,
		dateEnd: monthEnd,
		outFile: path.resolve(process.cwd(), `docs/dashboard_sales_probe_${monthStart}_${monthEnd}.json`)
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		const mArg = String(arg || '').match(/^--([^=]+)=(.*)$/)
		if (!mArg) continue
		const key = mArg[1]
		const value = mArg[2]
		if (key === 'space-id') out.spaceId = normalizeString(value)
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'date-start') out.dateStart = normalizeString(value) || out.dateStart
		if (key === 'date-end') out.dateEnd = normalizeString(value) || out.dateEnd
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

async function fetchAllSales(client, token, dateStart, dateEnd) {
	const rows = []
	let page = 1
	const pageSize = 200
	let summary = null
	while (true) {
		const res = await callCrm(client, token, 'crm-sale', 'listV2', {
			page,
			pageSize,
			dateStart,
			dateEnd
		})
		if (!summary && res.summary) summary = res.summary
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!res?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 300) break
	}
	return { rows, summary: summary || {} }
}

async function fetchAllCustomers(client, token) {
	const rows = []
	let page = 1
	const pageSize = 50
	while (true) {
		const res = await callCrm(client, token, 'crm-customer', 'listV1', {
			page,
			pageSize,
			summaryIgnoreActive: true
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!res?.paging?.hasMore && !res?.hasMore) break
		if (list.length < pageSize) break
		page += 1
		if (page > 300) break
	}
	return rows
}

async function fetchAllCustomerStatementRows(client, token, customerId, dateStart, dateEnd) {
	const rows = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-customer-settlement', 'listCustomerStatementRowsV1', {
			customer_id: customerId,
			date_from: dateStart,
			date_to: dateEnd,
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

function addAmount(map, key, amount) {
	const name = normalizeString(key) || '(未命名)'
	map[name] = fix2((map[name] || 0) + toNumber(amount, 0))
}

function topEntries(map, limit = 12) {
	return Object.entries(map)
		.map(([name, amount]) => ({ name, amount: fix2(amount) }))
		.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'zh-Hans-CN'))
		.slice(0, limit)
}

async function main() {
	const args = parseArgs(process.argv)
	const client = new AlipayFunctionClient(loadAlipayConfig(args.spaceId))
	const token = await login(client, args.username, args.password)

	const dashboardRes = await callCrm(client, token, 'crm-dashboard', 'summaryV1', { days: 7 })
	const salesRes = await fetchAllSales(client, token, args.dateStart, args.dateEnd)
	const allCustomers = await fetchAllCustomers(client, token)
	const m3Customers = allCustomers.filter((row) => normalizeString(row.default_price_unit) === 'm3')

	const saleByCustomer = {}
	for (const row of salesRes.rows) {
		addAmount(saleByCustomer, row.customer_name, row.should_receive)
	}

	let flowSettlementTotal = 0
	let flowSettlementCount = 0
	const flowByCustomer = {}
	for (const customer of m3Customers) {
		const customerId = normalizeString(customer._id)
		if (!customerId) continue
		const rows = await fetchAllCustomerStatementRows(client, token, customerId, args.dateStart, args.dateEnd)
		const flowRows = rows.filter((row) => normalizeString(row.row_type) === 'flow_settlement')
		if (!flowRows.length) continue
		const customerTotal = fix2(flowRows.reduce((sum, row) => sum + toNumber(row.amount, 0), 0))
		flowSettlementTotal = fix2(flowSettlementTotal + customerTotal)
		flowSettlementCount += flowRows.length
		addAmount(flowByCustomer, customer.name, customerTotal)
	}

	const salesSummaryShould = fix2(salesRes.summary.should_receive_total || 0)
	const recomputedSaleTotal = fix2(salesRes.rows.reduce((sum, row) => sum + toNumber(row.should_receive, 0), 0))
	const expectedDashboardMonth = fix2(salesSummaryShould + flowSettlementTotal)
	const dashboardMonth = fix2(dashboardRes?.data?.kpi?.sales_month || 0)

	const report = {
		space_id: args.spaceId,
		date_start: args.dateStart,
		date_end: args.dateEnd,
		dashboard_sales_month: dashboardMonth,
		sales_summary_should_receive_total: salesSummaryShould,
		sales_rows_should_receive_total: recomputedSaleTotal,
		flow_settlement_total: flowSettlementTotal,
		expected_dashboard_sales_month: expectedDashboardMonth,
		dashboard_minus_expected: fix2(dashboardMonth - expectedDashboardMonth),
		sales_count: Number(salesRes.summary.total || salesRes.rows.length || 0),
		flow_settlement_count: flowSettlementCount,
		m3_customer_count: m3Customers.length,
		top_sale_customers: topEntries(saleByCustomer, 12),
		top_flow_customers: topEntries(flowByCustomer, 12)
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, JSON.stringify(report, null, 2))
	console.log(JSON.stringify(report, null, 2))
	console.log(`\n已写入 ${args.outFile}`)
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : String(err))
	process.exit(1)
})
