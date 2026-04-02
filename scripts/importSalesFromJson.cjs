#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_INPUT = 'docs/sale_20260318225227_preclean.fixed.v2.pass.array.json'
const DEFAULT_REPORT = 'docs/sale.import.report.json'
const DEFAULT_CONCURRENCY = 2

function parseArgs(argv) {
	const args = {
		input: DEFAULT_INPUT,
		report: DEFAULT_REPORT,
		execute: false,
		respectFlowWarning: false,
		concurrency: DEFAULT_CONCURRENCY,
		spaceId: process.env.UNI_SPACE_ID || '',
		clientSecret: process.env.UNI_CLIENT_SECRET || '',
		endpoint: process.env.UNI_ENDPOINT || '',
		accessKey: process.env.UNI_ACCESS_KEY || '',
		secretKey: process.env.UNI_SECRET_KEY || '',
		spaceAppId: process.env.UNI_SPACE_APP_ID || '',
		crmToken: process.env.CRM_TOKEN || '',
		crmUsername: process.env.CRM_USERNAME || 'superadmin',
		crmPassword: process.env.CRM_PASSWORD || 'y7ez5CGAbivZkeP'
	}

	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--input' && next) {
			args.input = next
			i += 1
		} else if (cur === '--report' && next) {
			args.report = next
			i += 1
		} else if (cur === '--space-id' && next) {
			args.spaceId = next
			i += 1
		} else if (cur === '--client-secret' && next) {
			args.clientSecret = next
			i += 1
		} else if (cur === '--endpoint' && next) {
			args.endpoint = next
			i += 1
		} else if (cur === '--access-key' && next) {
			args.accessKey = next
			i += 1
		} else if (cur === '--secret-key' && next) {
			args.secretKey = next
			i += 1
		} else if (cur === '--space-app-id' && next) {
			args.spaceAppId = next
			i += 1
		} else if (cur === '--crm-token' && next) {
			args.crmToken = next
			i += 1
		} else if (cur === '--crm-username' && next) {
			args.crmUsername = next
			i += 1
		} else if (cur === '--crm-password' && next) {
			args.crmPassword = next
			i += 1
		} else if (cur === '--concurrency' && next) {
			const n = Number(next)
			if (Number.isFinite(n) && n > 0) args.concurrency = Math.max(1, Math.min(Math.floor(n), 8))
			i += 1
		} else if (cur === '--execute') {
			args.execute = true
		} else if (cur === '--respect-flow-warning') {
			args.respectFlowWarning = true
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
  node scripts/importSalesFromJson.cjs [options]

Options:
  --input <path>          导入源文件（默认 ${DEFAULT_INPUT}）
  --report <path>         报告输出路径（默认 ${DEFAULT_REPORT}）
  --space-id <id>         uniCloud space id（或 UNI_SPACE_ID）
  --client-secret <sec>   uniCloud client secret（或 UNI_CLIENT_SECRET）
  --endpoint <url>        uniCloud endpoint（可选）
  --access-key <key>      支付宝空间 accessKey（可选，优先自动读取）
  --secret-key <key>      支付宝空间 secretKey（可选，优先自动读取）
  --space-app-id <id>     支付宝空间 spaceAppId（可选，优先自动读取）
  --crm-token <token>     CRM token（可选）
  --crm-username <name>   CRM 用户名（默认 superadmin）
  --crm-password <pass>   CRM 密码（默认读取脚本内回退）
  --concurrency <n>       并发数 1-8（默认 ${DEFAULT_CONCURRENCY}）
  --execute               真正写入（默认仅预检）
  --respect-flow-warning  遇到瓶流转软预警时不自动放行（默认历史导入自动忽略）
`)
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function unwrapId(value) {
	if (value == null) return ''
	if (typeof value === 'string') return value.trim()
	if (typeof value === 'number') return String(value)
	if (typeof value === 'object') {
		if (typeof value.$oid === 'string') return value.$oid.trim()
		if (typeof value._id === 'string') return value._id.trim()
	}
	return ''
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function normalizeDateYmd(value, fallbackTs = Date.now()) {
	const text = normalizeString(value)
	if (text) {
		const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
		if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
		const ymd = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
		if (ymd) return `${ymd[1]}-${pad2(ymd[2])}-${pad2(ymd[3])}`
		const parsed = Date.parse(text)
		if (Number.isFinite(parsed) && parsed > 0) {
			const d = new Date(parsed)
			return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
		}
	}
	const d = new Date(fallbackTs)
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fix3(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Number(num.toFixed(3))
}

function fix2(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Number(num.toFixed(2))
}

function nearlyEqual(a, b, eps = 0.01) {
	return Math.abs(Number(a || 0) - Number(b || 0)) < eps
}

function normalizeCustomerKey(value) {
	return normalizeString(value)
		.toUpperCase()
		.replace(/[\s\u3000\-_—()（）【】\[\]<>《》,，.。·•/]/g, '')
}

function normalizeBizMode(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'agent_sale' || text === 'agent') return 'agent_sale'
	if (text === 'truck') return 'truck'
	return 'bottle'
}

function normalizePriceUnit(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'bottle' || text === '瓶' || text === '瓶装') return 'bottle'
	if (text === 'm3' || text === 'm³' || text === '方' || text === '立方') return 'm3'
	return 'kg'
}

function normalizePaymentStatus(value, amountReceived, amountShould) {
	const text = normalizeString(value).toLowerCase()
	if (['paid', '已付', '已收清', '已结清'].includes(text)) return 'paid'
	if (['partial', '部分付', '部分已付', '部分收款', '部分结清'].includes(text)) return 'partial'
	if (['unpaid', '未付', '未付款', '挂账', '待收'].includes(text)) return 'unpaid'
	if (text === '冲减') return 'paid'
	if (Number(amountShould) <= 0) return 'paid'
	return Number(amountReceived) > 0 ? 'partial' : 'unpaid'
}

function normalizePaymentMethod(value, paymentStatus) {
	const text = normalizeString(value).toLowerCase()
	if (['on_account', '挂账'].includes(text)) return 'on_account'
	if (['cash', '现金'].includes(text)) return 'cash'
	if (['bank', '银行', '银行转账', '转账'].includes(text)) return 'bank'
	if (['wechat', '微信'].includes(text)) return 'wechat'
	if (['alipay', '支付宝'].includes(text)) return 'alipay'
	return paymentStatus === 'unpaid' ? 'on_account' : ''
}

function computeFlowVolumeM3(payload) {
	const base = (payload && payload.base) || {}
	const explicit = toNumber(base.flowVolumeM3, null)
	if (explicit != null) return explicit
	const prev = toNumber(base.flowIndexPrev, null)
	const curr = toNumber(base.flowIndexCurr, null)
	if (prev == null || curr == null) return 0
	const diff = curr - prev
	return diff >= 0 ? diff : 0
}

function computeShouldReceiveByPayload(payload) {
	const base = (payload && payload.base) || {}
	const bizMode = normalizeBizMode(base.bizMode)
	const priceUnit = normalizePriceUnit(base.priceUnit)
	const unitPrice = toNumber(base.unitPrice, 0) || 0
	const outRows = Array.isArray(payload && payload.outRows) ? payload.outRows : []
	const backRows = Array.isArray(payload && payload.backRows) ? payload.backRows : []
	const agentRows = Array.isArray(payload && payload.agentSaleRows) ? payload.agentSaleRows : []
	const truckSaleNet = toNumber(base.truckGrossDiff, toNumber(base.truckSaleNet, 0)) || 0
	const rounding = Math.max(toNumber(base.roundingAmount, 0) || 0, 0)

	const outNet = outRows.reduce((sum, item) => sum + (toNumber(item && item.net, 0) || 0), 0)
	const backNet = backRows.reduce((sum, item) => sum + (toNumber(item && item.net, 0) || 0), 0)

	let shouldReceive = 0
	if (bizMode === 'agent_sale') {
		const totalWeight = agentRows.reduce((sum, row) => sum + (toNumber(row && row.fill_weight, 0) || 0), 0)
		shouldReceive = totalWeight * unitPrice
	} else if (bizMode === 'truck') {
		shouldReceive = truckSaleNet * unitPrice
	} else if (priceUnit === 'kg') {
		shouldReceive = (outNet - backNet) * unitPrice
	} else if (priceUnit === 'bottle') {
		shouldReceive = outRows.length * unitPrice
	} else if (priceUnit === 'm3') {
		shouldReceive = computeFlowVolumeM3(payload) * unitPrice
	}

	let finalShould = shouldReceive
	if (shouldReceive > 0) finalShould = shouldReceive - rounding
	else if (shouldReceive < 0) finalShould = shouldReceive + rounding
	return fix2(finalShould)
}

function autofixSettlement(payload) {
	const base = (payload && payload.base) || {}
	const shouldReceive = computeShouldReceiveByPayload(payload)
	let amountReceived = fix2(toNumber(base.amountReceived, 0) || 0)

	let paymentStatus = 'unpaid'
	if (nearlyEqual(shouldReceive, 0)) {
		amountReceived = 0
		paymentStatus = 'unpaid'
	} else if (shouldReceive > 0) {
		if (amountReceived <= 0 || nearlyEqual(amountReceived, 0)) {
			amountReceived = 0
			paymentStatus = 'unpaid'
		} else if (amountReceived < shouldReceive && !nearlyEqual(amountReceived, shouldReceive)) {
			paymentStatus = 'partial'
		} else {
			paymentStatus = 'paid'
		}
	} else {
		if (amountReceived >= 0 || nearlyEqual(amountReceived, 0)) {
			amountReceived = 0
			paymentStatus = 'unpaid'
		} else if (amountReceived > shouldReceive && !nearlyEqual(amountReceived, shouldReceive)) {
			paymentStatus = 'partial'
		} else {
			paymentStatus = 'paid'
		}
	}

	base.amountReceived = amountReceived
	base.paymentStatus = paymentStatus
	if (paymentStatus === 'unpaid') base.paymentMethod = 'on_account'
	payload.base = base
	return payload
}

function parseJsonLikeRows(text) {
	const body = String(text || '').trim()
	if (!body) return { rows: [], parseMode: 'empty' }

	try {
		const parsed = JSON.parse(body)
		if (Array.isArray(parsed)) return { rows: parsed, parseMode: 'json-array' }
		if (parsed && Array.isArray(parsed.data)) return { rows: parsed.data, parseMode: 'json-object-data' }
		if (parsed && Array.isArray(parsed.list)) return { rows: parsed.list, parseMode: 'json-object-list' }
		if (parsed && typeof parsed === 'object') return { rows: [parsed], parseMode: 'json-object' }
	} catch (_) {
		// continue
	}

	const rows = []
	const lines = body.split(/\r?\n/)
	let bad = 0
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim()
		if (!line) continue
		try {
			rows.push(JSON.parse(line))
		} catch (_) {
			bad += 1
		}
	}
	if (rows.length > 0 && bad === 0) return { rows, parseMode: 'ndjson' }

	throw new Error('无法解析输入文件，请提供 JSON 数组或 NDJSON')
}

function normalizeBottleRows(rows) {
	const source = Array.isArray(rows) ? rows : []
	const result = []
	const seen = new Set()
	for (const row of source) {
		const bottleNo = normalizeBottleNo(row && (row.bottle_no || row.bottleNo))
		if (!bottleNo || seen.has(bottleNo)) continue
		seen.add(bottleNo)
		result.push({
			bottle_no: bottleNo,
			bottle_id: unwrapId(row && (row.bottle_id || row.bottleId)) || null,
			gross: toNumber(row && row.gross, null),
			tare: toNumber(row && row.tare, null),
			net: toNumber(row && row.net, null)
		})
	}
	return result
}

function normalizeDepositRows(rows, fallbackRaw = '') {
	const source = Array.isArray(rows) ? rows : []
	const result = []
	const seen = new Set()
	const feed = (item) => {
		const bottleNo = normalizeBottleNo(item && (item.bottle_no || item.bottleNo || item))
		if (!bottleNo || seen.has(bottleNo)) return
		seen.add(bottleNo)
		result.push({
			bottle_no: bottleNo,
			bottle_id: unwrapId(item && (item.bottle_id || item.bottleId)) || null
		})
	}
	source.forEach(feed)
	const rawText = normalizeString(fallbackRaw)
	if (rawText) {
		rawText
			.split(/[\/,，、\s]+/)
			.map((item) => normalizeBottleNo(item))
			.filter(Boolean)
			.forEach(feed)
	}
	return result
}

function normalizeAgentRows(rows) {
	const source = Array.isArray(rows) ? rows : []
	const result = []
	const seen = new Set()
	for (const row of source) {
		const bottleNo = normalizeBottleNo(row && (row.bottle_no || row.bottleNo))
		const fillWeight = toNumber(row && (row.fill_weight != null ? row.fill_weight : row.fillWeight), null)
		if (!bottleNo || seen.has(bottleNo) || !(fillWeight > 0)) continue
		seen.add(bottleNo)
		result.push({
			bottle_no: bottleNo,
			bottle_id: unwrapId(row && (row.bottle_id || row.bottleId)) || null,
			fill_weight: fillWeight,
			address: normalizeString(row && row.address),
			filling_record_id: unwrapId(row && (row.filling_record_id || row.fillingRecordId)) || null
		})
	}
	return result
}

function splitDelivery(value) {
	const text = normalizeString(value)
	if (!text) return { delivery1: '', delivery2: '' }
	const parts = text
		.split(/[\/｜|]/)
		.map((item) => normalizeString(item))
		.filter(Boolean)
	if (parts.length === 0) return { delivery1: '', delivery2: '' }
	if (parts.length === 1) return { delivery1: parts[0], delivery2: '' }
	return { delivery1: parts[0], delivery2: parts[1] }
}

function canonicalRows(rows, field, amountKey = 'net') {
	const source = Array.isArray(rows) ? rows : []
	return source
		.map((row) => {
			const bottleNo = normalizeBottleNo(row && row[field])
			const amount = toNumber(row && row[amountKey], 0)
			return `${bottleNo}:${fix3(amount)}`
		})
		filter((item) => item && !item.startsWith(':'))
		sort()
}

function buildSaleSignature(input) {
	const date = normalizeDateYmd(input.date, input.created_at || Date.now())
	const customerId = normalizeString(input.customer_id)
	const bizMode = normalizeBizMode(input.biz_mode)
	const priceUnit = normalizePriceUnit(input.price_unit)
	const unitPrice = fix3(toNumber(input.unit_price, 0))
	const outRows = canonicalRows(input.out_items, 'bottle_no', 'net')
	const backRows = canonicalRows(input.back_items, 'bottle_no', 'net')
	const agentRows = canonicalRows(input.agent_sale_items, 'bottle_no', 'fill_weight')
	const depositRows = canonicalRows(input.deposit_rows, 'bottle_no', 'bottle_no')
	const truckNo = normalizeString(input.truck_no).toUpperCase()
	const truckSaleNet = fix3(toNumber(input.truck_gross_diff, toNumber(input.truck_sale_net, 0)))
	const flowPrev = fix3(toNumber(input.flow_index_prev, 0))
	const flowCurr = fix3(toNumber(input.flow_index_curr, 0))
	const flowVolume = fix3(toNumber(input.flow_volume_m3, 0))
	return [
		date,
		customerId,
		bizMode,
		priceUnit,
		unitPrice,
		truckNo,
		truckSaleNet,
		flowPrev,
		flowCurr,
		flowVolume,
		outRows.join(','),
		backRows.join(','),
		agentRows.join(','),
		depositRows.join(',')
	].join('|')
}

function toCreatePayload(row) {
	const createdAt = toNumber(row.created_at, Date.now()) || Date.now()
	const date = normalizeDateYmd(row.date, createdAt)
	const customerId = normalizeString(row.customer_id)
	const customerName = normalizeString(row.customer_name)
	const bizMode = normalizeBizMode(row.biz_mode)
	const priceUnit = normalizePriceUnit(row.price_unit)
	const unitPrice = toNumber(row.unit_price, 0)
	const amountReceived = toNumber(row.amount_received, 0) || 0
	const amountShould = toNumber(row.amount, toNumber(row.should_receive, 0))
	const paymentStatus = normalizePaymentStatus(row.payment_status, amountReceived, amountShould)
	const paymentMethod = normalizePaymentMethod(row.payment_method, paymentStatus)
	const roundingAmount = Math.max(toNumber(row.rounding_amount, 0) || 0, 0)
	const outItems = normalizeBottleRows(row.out_items)
	const backItems = normalizeBottleRows(row.back_items)
	const depositRows = normalizeDepositRows(row.deposit_rows, row.deposit_bottles_raw)
	const agentSaleRows = normalizeAgentRows(row.agent_sale_items)
	const delivery = splitDelivery(row.delivery_man)

	let truckNo = normalizeString(row.truck_no || row.car_no).toUpperCase()
	let truckOutGross = toNumber(row.truck_out_gross, 0) || 0
	let truckBackGross = toNumber(row.truck_back_gross, 0) || 0
	let truckSaleNet = toNumber(row.truck_gross_diff, toNumber(row.truck_sale_net, 0)) || 0
	if (bizMode !== 'truck') {
		truckNo = ''
		truckOutGross = 0
		truckBackGross = 0
		truckSaleNet = 0
	}

	return {
		base: {
			date,
			customerId,
			customerName,
			delivery1: delivery.delivery1,
			delivery2: delivery.delivery2,
			vehicleId: unwrapId(row.vehicle_id) || '',
			carNo: normalizeString(row.car_no).toUpperCase(),
			priceUnit,
			unitPrice,
			bizMode,
			truckNo,
			truckOutGross,
			truckBackGross,
			truckGrossDiff: truckSaleNet,
			truckSaleNet: null,
			flowIndexPrev: priceUnit === 'm3' ? toNumber(row.flow_index_prev, null) : null,
			flowIndexCurr: priceUnit === 'm3' ? toNumber(row.flow_index_curr, null) : null,
			flowVolumeM3: priceUnit === 'm3' ? toNumber(row.flow_volume_m3, null) : null,
			flowTheoryRatio: priceUnit === 'm3' ? toNumber(row.flow_theory_ratio, null) : null,
			paymentStatus,
			paymentMethod,
			amountReceived,
			roundingAmount,
			paymentNote: normalizeString(row.payment_note),
			remark: normalizeString(row.remark)
		},
		outRows: bizMode === 'agent_sale' || bizMode === 'truck' ? [] : outItems,
		backRows: bizMode === 'agent_sale' || bizMode === 'truck' ? [] : backItems,
		depositRows: bizMode === 'bottle' ? depositRows : [],
		agentSaleRows: bizMode === 'agent_sale' ? agentSaleRows : [],
		source: 'legacy-sale-import-v1'
	}
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	const dirs = fs.readdirSync(base)
	return dirs
		.map((dir) => path.join(base, dir, 'setting.json'))
		.filter((p) => fs.existsSync(p))
}

function deepFindSpace(node, spaceId) {
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i += 1) {
			const found = deepFindSpace(node[i], spaceId)
			if (found) return found
		}
		return null
	}
	if (!node || typeof node !== 'object') return null
	if (node.spaceid === spaceId) {
		const hasAlipayKeys = node.accessKey && node.secretKey && node.spaceAppId
		const hasClientSecret = node.clientSecret
		if (hasAlipayKeys || hasClientSecret) return node
	}
	for (const value of Object.values(node)) {
		const found = deepFindSpace(value, spaceId)
		if (found) return found
	}
	return null
}

function tryLoadSpaceConfig(spaceId) {
	if (!spaceId) return null
	const files = listProjectSettingFiles()
	let fallback = null
	for (const file of files) {
		try {
			const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
			const found = deepFindSpace(raw, spaceId)
			if (!found) continue
			const candidate = {
				clientSecret: normalizeString(found.clientSecret),
				accessKey: normalizeString(found.accessKey),
				secretKey: normalizeString(found.secretKey),
				spaceAppId: normalizeString(found.spaceAppId),
				endpoint: normalizeString(found.apiEndpoint),
				from: file
			}
			if (candidate.accessKey && candidate.secretKey && candidate.spaceAppId) return candidate
			if (!fallback) fallback = candidate
		} catch (_) {
			// ignore
		}
	}
	return fallback
}

function hmacMd5(text, key) {
	return crypto.createHmac('md5', key).update(text).digest('hex')
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

function buildSignInput(payload) {
	return Object.keys(payload)
		.sort()
		.filter((key) => payload[key])
		.map((key) => `${key}=${payload[key]}`)
		.join('&')
}

function uuidV4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

class UniCloudHttpClient {
	constructor({ spaceId, clientSecret, endpoint }) {
		if (!spaceId) throw new Error('缺少 spaceId')
		if (!clientSecret) throw new Error('缺少 clientSecret')
		if (typeof fetch !== 'function') throw new Error('当前 Node 不支持 fetch（需 Node 18+）')
		this.spaceId = spaceId
		this.clientSecret = clientSecret
		this.endpoint = endpoint || (spaceId.startsWith('mp-') ? 'https://api.next.bspapp.com' : 'https://api.bspapp.com')
		this.requestUrl = `${this.endpoint.replace(/\/+$/, '')}/client`
		this.accessToken = ''
	}

	unwrapResult(response) {
		if (response && response.data != null) return response.data
		if (response && response.result != null) return response.result
		return response
	}

	async postServerless(payload, withAuthToken) {
		const body = { ...payload, spaceId: this.spaceId, timestamp: Date.now() }
		if (withAuthToken) body.token = this.accessToken
		const headers = { 'content-type': 'application/json' }
		if (withAuthToken) headers['x-basement-token'] = this.accessToken
		headers['x-serverless-sign'] = hmacMd5(buildSignInput(body), this.clientSecret)
		const res = await fetch(this.requestUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		})
		const text = await res.text()
		let json = {}
		try {
			json = text ? JSON.parse(text) : {}
		} catch (_) {
			throw new Error(`uniCloud 响应不是 JSON: ${text.slice(0, 200)}`)
		}
		if (!res.ok) throw new Error(`uniCloud HTTP ${res.status}: ${JSON.stringify(json)}`)
		if (json && json.error) throw new Error(`uniCloud error: ${json.error.code || ''} ${json.error.message || ''}`.trim())
		return json
	}

	async ensureAnonymousToken() {
		if (this.accessToken) return this.accessToken
		const authRes = await this.postServerless(
			{
				method: 'serverless.auth.user.anonymousAuthorize',
				params: '{}'
			},
			false
		)
		const data = this.unwrapResult(authRes) || {}
		const token = data.accessToken || data.access_token || data.token || ''
		if (!token) throw new Error(`未拿到 uniCloud accessToken: ${JSON.stringify(authRes)}`)
		this.accessToken = token
		return token
	}

	async callFunction(name, functionArgs) {
		await this.ensureAnonymousToken()
		const invokeRes = await this.postServerless(
			{
				method: 'serverless.function.runtime.invoke',
				params: JSON.stringify({ functionTarget: name, functionArgs })
			},
			true
		)
		const data = this.unwrapResult(invokeRes)
		let result = data
		if (data && data.result != null) result = data.result
		if (typeof result === 'string') {
			try {
				return JSON.parse(result)
			} catch (_) {
				return { raw: result }
			}
		}
		return result
	}
}

class AlipayFunctionClient {
	constructor({ spaceId, accessKey, secretKey, spaceAppId, endpoint }) {
		if (!spaceId) throw new Error('缺少 spaceId')
		if (!accessKey || !secretKey || !spaceAppId) throw new Error('缺少支付宝空间签名参数')
		this.spaceId = spaceId
		this.accessKey = accessKey
		this.secretKey = secretKey
		this.spaceAppId = spaceAppId
		this.endpoint = normalizeString(endpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`
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
			'x-client-timestamp': timestamp,
			'x-alipay-source': 'client',
			'x-request-id': requestId,
			'x-alipay-callid': requestId,
			'x-trace-id': requestId,
			'x-to-function-name': functionName
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
		const canonicalHeaderLines = signedHeaders.map((k) => `${k}:${headers[k] || ''}\n`).join('')
		const bodyText = JSON.stringify(data || {})
		const bodyHash = sha256Hex(bodyText)
		const canonicalRequest = `POST\n${pathname}\n${query}\n${canonicalHeaderLines}\n${signedHeaders.join(';')}\n${bodyHash}\n`
		const canonicalHash = sha256Hex(canonicalRequest)
		const stringToSign = `HMAC-SHA256\n${timestamp}\n${canonicalHash}\n`
		const signature = hmacSha256Hex(stringToSign, this.secretKey)
		const authorization = `HMAC-SHA256 Credential=${this.accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
		return {
			url: `${this.endpoint.replace(/\/+$/, '')}${pathname}${query ? `?${query}` : ''}`,
			headers: {
				...headers,
				Authorization: authorization,
				'content-type': 'application/json'
			},
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
		let json = {}
		try {
			json = text ? JSON.parse(text) : {}
		} catch (_) {
			throw new Error(`支付宝云函数响应非JSON status=${res.status}: ${text.slice(0, 200)}`)
		}
		if (!res.ok) throw new Error(`支付宝云函数 HTTP ${res.status}: ${JSON.stringify(json)}`)
		return json
	}
}

async function ensureCrmToken(client, options) {
	if (options.crmToken) return options.crmToken
	const loginRes = await client.callFunction('crm-auth', {
		action: 'login',
		data: {
			username: options.crmUsername,
			password: options.crmPassword
		},
		request_id: generateRequestId()
	})
	if (!loginRes || loginRes.code !== 0) throw new Error(`CRM 登录失败: ${JSON.stringify(loginRes)}`)
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error(`CRM 登录成功但没有 token: ${JSON.stringify(loginRes)}`)
	return token
}

async function fetchAllCustomers(client, crmToken) {
	const idByName = new Map()
	const idSet = new Set()
	let page = 1
	const pageSize = 200
	let guard = 0
	while (guard < 120) {
		const res = await client.callFunction('crm-customer', {
			action: 'listV1',
			token: crmToken,
			data: { page, pageSize },
			request_id: generateRequestId()
		})
		if (!res || res.code !== 0) throw new Error(`加载客户失败(page=${page}): ${JSON.stringify(res)}`)
		const rows = Array.isArray(res.data) ? res.data : []
		for (const row of rows) {
			const id = normalizeString(row && row._id)
			const name = normalizeString(row && row.name)
			const shortName = normalizeString(row && row.short_name)
			if (id) idSet.add(id)
			if (id && name && !idByName.has(name)) idByName.set(name, id)
			const nameKey = normalizeCustomerKey(name)
			if (id && nameKey && !idByName.has(nameKey)) idByName.set(nameKey, id)
			if (id && shortName && !idByName.has(shortName)) idByName.set(shortName, id)
			const shortKey = normalizeCustomerKey(shortName)
			if (id && shortKey && !idByName.has(shortKey)) idByName.set(shortKey, id)
		}
		if (!(res.paging && res.paging.hasMore)) break
		page += 1
		guard += 1
	}
	return { idByName, idSet }
}

async function fetchAllSales(client, crmToken) {
	const rows = []
	let page = 1
	const pageSize = 50
	let guard = 0
	while (guard < 1000) {
		const res = await client.callFunction('crm-sale', {
			action: 'listV2',
			token: crmToken,
			data: { page, pageSize },
			request_id: generateRequestId()
		})
		if (!res || res.code !== 0) throw new Error(`加载现网销售失败(page=${page}): ${JSON.stringify(res)}`)
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!(res.paging && res.paging.hasMore)) break
		page += 1
		guard += 1
	}
	return rows
}

function upsertCustomerRef(customerRef, name, id) {
	const normalizedId = normalizeString(id)
	if (!normalizedId) return
	customerRef.idSet.add(normalizedId)
	const raw = normalizeString(name)
	if (raw && !customerRef.idByName.has(raw)) customerRef.idByName.set(raw, normalizedId)
	const key = normalizeCustomerKey(raw)
	if (key && !customerRef.idByName.has(key)) customerRef.idByName.set(key, normalizedId)
}

async function ensureCustomerByName(client, crmToken, customerRef, customerName) {
	const name = normalizeString(customerName)
	if (!name) return ''
	const existing = findCustomerIdByName(customerRef, name)
	if (existing) return existing

	const createRes = await client.callFunction('crm-customer', {
		action: 'createV1',
		token: crmToken,
		data: {
			name,
			short_name: '',
			contact: '',
			phone: '',
			address: '',
			remark: 'legacy sale import auto-created',
			default_price_unit: 'kg',
			default_unit_price: null
		},
		request_id: generateRequestId()
	})
	if (createRes && createRes.code === 0) {
		const id = normalizeString(createRes.data && (createRes.data._id || createRes.data.id))
		if (id) {
			upsertCustomerRef(customerRef, name, id)
			return id
		}
	}

	// if create reports duplicate/exists, refresh once then retry match by name
	if (createRes && createRes.code !== 0) {
		const msg = normalizeString(createRes.msg)
		if (msg.includes('已存在') || msg.includes('重复') || msg.includes('唯一')) {
			const latestRef = await fetchAllCustomers(client, crmToken)
			customerRef.idByName = latestRef.idByName
			customerRef.idSet = latestRef.idSet
			return findCustomerIdByName(customerRef, name)
		}
	}
	return ''
}

function findCustomerIdByName(customerRef, customerName) {
	const map = customerRef && customerRef.idByName ? customerRef.idByName : new Map()
	const raw = normalizeString(customerName)
	if (raw && map.has(raw)) return map.get(raw)
	const key = normalizeCustomerKey(raw)
	if (key && map.has(key)) return map.get(key)
	return ''
}

function normalizeInputRows(rawRows, customerRef) {
	const normalizedRows = []
	const invalidRows = []
	const duplicateInputRows = []
	const seen = new Set()
	const idSet = customerRef && customerRef.idSet ? customerRef.idSet : new Set()

	for (let i = 0; i < rawRows.length; i += 1) {
		const row = rawRows[i] && typeof rawRows[i] === 'object' ? rawRows[i] : {}
		const lineNo = i + 1
		const payload = toCreatePayload({
			...row,
			_id: unwrapId(row._id),
			customer_id: unwrapId(row.customer_id),
			vehicle_id: unwrapId(row.vehicle_id),
			created_by: unwrapId(row.created_by)
		})

		if (!payload.base.date) {
			invalidRows.push({ line_no: lineNo, reason: 'date_empty' })
			continue
		}

		let customerId = payload.base.customerId
		if (customerId && idSet.size > 0 && !idSet.has(customerId)) {
			customerId = ''
		}
		if (!customerId) {
			customerId = findCustomerIdByName(customerRef, payload.base.customerName)
		}
		if (!customerId) {
			const fallbackName = normalizeString(payload.base.customerName)
			if (!fallbackName) {
				invalidRows.push({
					line_no: lineNo,
					reason: 'customer_id_missing',
					customer_name: payload.base.customerName
				})
				continue
			}
		}
		payload.base.customerId = customerId

		const legacyId = unwrapId(row._id)
		const signature = buildSaleSignature({
			date: payload.base.date,
			customer_id: customerId,
			biz_mode: payload.base.bizMode,
			price_unit: payload.base.priceUnit,
			unit_price: payload.base.unitPrice,
			out_items: payload.outRows,
			back_items: payload.backRows,
			agent_sale_items: payload.agentSaleRows,
			deposit_rows: payload.depositRows,
			truck_no: payload.base.truckNo,
			truck_gross_diff: payload.base.truckGrossDiff,
			truck_sale_net: null,
			flow_index_prev: payload.base.flowIndexPrev,
			flow_index_curr: payload.base.flowIndexCurr,
			flow_volume_m3: payload.base.flowVolumeM3
		})

		if (seen.has(signature)) {
			duplicateInputRows.push({
				line_no: lineNo,
				legacy_id: legacyId || '',
				signature_preview: signature.slice(0, 180)
			})
			continue
		}
		seen.add(signature)

		normalizedRows.push({
			line_no: lineNo,
			legacy_id: legacyId || '',
			source_customer_name: payload.base.customerName,
			payload,
			signature
		})
	}

	return {
		rows: normalizedRows,
		invalidRows,
		duplicateInputRows
	}
}

function writeReport(reportPath, payload) {
	ensureDir(reportPath)
	fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function createProgressPrinter(total) {
	let done = 0
	return {
		step(label) {
			done += 1
			if (done % 20 === 0 || done === total) {
				console.log(`Progress ${done}/${total} | ${label}`)
			}
		}
	}
}

async function run() {
	const options = parseArgs(process.argv)
	const inputPath = path.resolve(process.cwd(), options.input)
	if (!fs.existsSync(inputPath)) throw new Error(`输入文件不存在: ${inputPath}`)
	if (!options.spaceId) throw new Error('缺少 spaceId，请用 --space-id 提供')

	const sourceText = fs.readFileSync(inputPath, 'utf8')
	const parsedInput = parseJsonLikeRows(sourceText)

	const loadedSpace = tryLoadSpaceConfig(options.spaceId)
	if (!options.clientSecret && loadedSpace) options.clientSecret = loadedSpace.clientSecret
	if (!options.endpoint && loadedSpace) options.endpoint = loadedSpace.endpoint
	if (!options.accessKey && loadedSpace) options.accessKey = loadedSpace.accessKey
	if (!options.secretKey && loadedSpace) options.secretKey = loadedSpace.secretKey
	if (!options.spaceAppId && loadedSpace) options.spaceAppId = loadedSpace.spaceAppId
	if (!(options.clientSecret || (options.accessKey && options.secretKey && options.spaceAppId))) {
		throw new Error('缺少空间鉴权参数（clientSecret 或 accessKey/secretKey/spaceAppId）')
	}

	const client =
		options.accessKey && options.secretKey && options.spaceAppId
			? new AlipayFunctionClient({
				spaceId: options.spaceId,
				accessKey: options.accessKey,
				secretKey: options.secretKey,
				spaceAppId: options.spaceAppId,
				endpoint: options.endpoint
			})
			: new UniCloudHttpClient({
				spaceId: options.spaceId,
				clientSecret: options.clientSecret,
				endpoint: options.endpoint
			})
	const crmToken = await ensureCrmToken(client, options)
	const customerRef = await fetchAllCustomers(client, crmToken)
	const normalizedInput = normalizeInputRows(parsedInput.rows, customerRef)
	const existingSales = await fetchAllSales(client, crmToken)

	const existingById = new Map()
	const existingBySignature = new Map()
	for (const row of existingSales) {
		const id = normalizeString(row && row._id)
		const signature = buildSaleSignature({
			date: row && row.date,
			customer_id: row && row.customer_id,
			biz_mode: row && row.biz_mode,
			price_unit: row && row.price_unit,
			unit_price: row && row.unit_price,
			out_items: row && row.out_items,
			back_items: row && row.back_items,
			agent_sale_items: row && row.agent_sale_items,
			deposit_rows: row && row.deposit_rows,
			truck_no: row && row.truck_no,
			truck_gross_diff: row && (row.truck_gross_diff ?? row.truck_sale_net),
			truck_sale_net: row && row.truck_sale_net,
			flow_index_prev: row && row.flow_index_prev,
			flow_index_curr: row && row.flow_index_curr,
			flow_volume_m3: row && row.flow_volume_m3
		})
		if (id) existingById.set(id, row)
		if (signature && !existingBySignature.has(signature)) existingBySignature.set(signature, row)
	}

	const alreadyById = []
	const alreadyBySignature = []
	const toCreate = []
	for (const row of normalizedInput.rows) {
		if (row.legacy_id && existingById.has(row.legacy_id)) {
			alreadyById.push(row)
			continue
		}
		if (existingBySignature.has(row.signature)) {
			alreadyBySignature.push(row)
			continue
		}
		toCreate.push(row)
	}

	const report = {
		started_at: new Date().toISOString(),
		finished_at: '',
		mode: options.execute ? 'execute' : 'dry-run',
		input_path: inputPath,
		parse_mode: parsedInput.parseMode,
		space_id: options.spaceId,
		input_total: parsedInput.rows.length,
		input_normalized_total: normalizedInput.rows.length,
		input_invalid_total: normalizedInput.invalidRows.length,
		input_duplicate_total: normalizedInput.duplicateInputRows.length,
		existing_total: existingSales.length,
		already_exists_by_id_total: alreadyById.length,
		already_exists_by_signature_total: alreadyBySignature.length,
		target_create_total: toCreate.length,
		success_total: 0,
		failed_total: 0,
		failed_preview: [],
		input_invalid_preview: normalizedInput.invalidRows.slice(0, 100),
		input_duplicate_preview: normalizedInput.duplicateInputRows.slice(0, 100),
		already_exists_by_signature_preview: alreadyBySignature.slice(0, 100).map((row) => ({
			line_no: row.line_no,
			legacy_id: row.legacy_id,
			customer_name: row.source_customer_name
		}))
	}

	console.log(`输入文件: ${inputPath}`)
	console.log(`解析模式: ${parsedInput.parseMode}`)
	console.log(`原始行数: ${parsedInput.rows.length}`)
	console.log(`规范化后: ${normalizedInput.rows.length}`)
	console.log(`无效行:   ${normalizedInput.invalidRows.length}`)
	console.log(`输入重复: ${normalizedInput.duplicateInputRows.length}`)
	console.log(`现网销售: ${existingSales.length}`)
	console.log(`按ID已存在: ${alreadyById.length}`)
	console.log(`按签名已存在: ${alreadyBySignature.length}`)
	console.log(`待新增: ${toCreate.length}`)
	console.log(`空间: ${options.spaceId}`)
	if (loadedSpace && loadedSpace.from) console.log(`已自动加载空间配置: ${loadedSpace.from}`)
	console.log(`模式: ${options.execute ? 'EXECUTE（写入）' : 'DRY-RUN（仅预检）'}`)

	if (!options.execute) {
		report.finished_at = new Date().toISOString()
		const reportPath = path.resolve(process.cwd(), options.report)
		writeReport(reportPath, report)
		console.log(`预检完成，报告: ${reportPath}`)
		return
	}

	const progress = createProgressPrinter(toCreate.length || 1)
	let cursor = 0
	const failures = []

	async function callCreateSale(payload) {
		return client.callFunction('crm-sale', {
			action: 'createV2',
			token: crmToken,
			data: {
				...payload,
				...(options.respectFlowWarning ? {} : { ignore_bottle_flow_warning: true })
			},
			request_id: generateRequestId()
		})
	}

	async function createWithRecovery(row) {
		let payload = JSON.parse(JSON.stringify(row.payload || {}))
		if (!normalizeString(payload.base && payload.base.customerId)) {
			const customerName = normalizeString(payload.base && payload.base.customerName)
			const customerId = await ensureCustomerByName(client, crmToken, customerRef, customerName)
			if (!customerId) {
				return {
					ok: false,
					response: { code: 400, msg: '客户不存在（自动补建失败）' },
					payload
				}
			}
			payload.base.customerId = customerId
		}
		let response = await callCreateSale(payload)
		if (response && response.code === 0) return { ok: true, response }

		const msg1 = normalizeString(response && response.msg)
		if (msg1.includes('客户不存在')) {
			const customerName = normalizeString(payload.base && payload.base.customerName)
			const customerId = await ensureCustomerByName(client, crmToken, customerRef, customerName)
			if (customerId) {
				payload.base.customerId = customerId
				response = await callCreateSale(payload)
				if (response && response.code === 0) return { ok: true, response }
			}
		}

		const msg2 = normalizeString(response && response.msg)
		if (msg2.includes('结算金额与付款状态不一致')) {
			payload = autofixSettlement(payload)
			response = await callCreateSale(payload)
			if (response && response.code === 0) return { ok: true, response }
		}

		return { ok: false, response, payload }
	}

	async function worker() {
		while (true) {
			const index = cursor
			cursor += 1
			if (index >= toCreate.length) return
			const row = toCreate[index]
			let outcome
			try {
				outcome = await createWithRecovery(row)
			} catch (err) {
				report.failed_total += 1
				failures.push({
					line_no: row.line_no,
					legacy_id: row.legacy_id,
					customer_name: row.source_customer_name,
					error: normalizeString(err && err.message) || '网络/调用异常'
				})
				progress.step(`failed=${report.failed_total}`)
				continue
			}

			if (outcome && outcome.ok) {
				report.success_total += 1
				progress.step(`success=${report.success_total}`)
				continue
			}

			const response = outcome && outcome.response ? outcome.response : null
			report.failed_total += 1
			failures.push({
				line_no: row.line_no,
				legacy_id: row.legacy_id,
				customer_name: row.source_customer_name,
				msg: normalizeString(response && response.msg) || '未知错误',
				raw: response || null
			})
			progress.step(`failed=${report.failed_total}`)
		}
	}

	const workers = []
	const concurrency = Math.max(1, Math.min(options.concurrency, 8))
	for (let i = 0; i < concurrency; i += 1) workers.push(worker())
	await Promise.all(workers)

	report.failed_preview = failures.slice(0, 120)
	report.finished_at = new Date().toISOString()
	const reportPath = path.resolve(process.cwd(), options.report)
	writeReport(reportPath, report)

	console.log('导入完成：')
	console.log(`- 待新增: ${report.target_create_total}`)
	console.log(`- 成功新增: ${report.success_total}`)
	console.log(`- 失败: ${report.failed_total}`)
	console.log(`- report: ${reportPath}`)
}

run().catch((err) => {
	console.error(`执行失败: ${normalizeString(err && err.message) || err}`)
	process.exit(1)
})
