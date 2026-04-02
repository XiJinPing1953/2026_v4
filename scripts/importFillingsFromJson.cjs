#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_INPUT = 'docs/2026.json'
const DEFAULT_REPORT = 'docs/filling.import.report.json'
const DEFAULT_CONCURRENCY = 3
const DEFAULT_RECORD_TYPE = 'normal_fill'
const ALLOWED_RECORD_TYPES = new Set([
	'normal_fill',
	'truck_out_agent_sale',
	'truck_out_no_sale'
])

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
			if (Number.isFinite(n) && n > 0) args.concurrency = Math.max(1, Math.min(Math.floor(n), 10))
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
  node scripts/importFillingsFromJson.cjs [options]

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
  --concurrency <n>       并发数 1-10（默认 ${DEFAULT_CONCURRENCY}）
  --execute               真正写入（默认仅预检）
  --respect-flow-warning  遇到灌装流转软预警时不自动放行（默认历史导入自动忽略）

Examples:
  node scripts/importFillingsFromJson.cjs --space-id env-xxx
  node scripts/importFillingsFromJson.cjs --execute --space-id env-xxx
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

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeRecordType(value, fallback = DEFAULT_RECORD_TYPE) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (ALLOWED_RECORD_TYPES.has(text)) return text
	return ''
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function toYmdByParts(yearValue, monthValue, dayValue) {
	const year = Number(yearValue)
	const month = Number(monthValue)
	const day = Number(dayValue)
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return ''
	if (year < 1970 || year > 2200) return ''
	if (month < 1 || month > 12) return ''
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	if (day < 1 || day > maxDay) return ''
	return `${year}-${pad2(month)}-${pad2(day)}`
}

function normalizeFillingDate(value) {
	const text = normalizeString(value)
	if (!text) return ''

	const compactYmd = text.match(/^(\d{4})(\d{2})(\d{2})$/)
	if (compactYmd) {
		const normalized = toYmdByParts(compactYmd[1], compactYmd[2], compactYmd[3])
		if (normalized) return normalized
	}

	const ymdMatch = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
	if (ymdMatch) {
		const normalized = toYmdByParts(ymdMatch[1], ymdMatch[2], ymdMatch[3])
		if (normalized) return normalized
	}

	if (/^\d{10,13}$/.test(text)) {
		const asNum = Number(text)
		if (Number.isFinite(asNum) && asNum > 0) {
			const ts = text.length === 10 ? asNum * 1000 : asNum
			const d = new Date(ts)
			return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
		}
	}

	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) {
		const d = new Date(parsed)
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
	}
	return ''
}

function toPositiveNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	if (num <= 0) return null
	return num
}

function formatWeightKey(value) {
	const num = toPositiveNumber(value)
	if (!(typeof num === 'number' && num > 0)) return ''
	return String(num)
}

function toSignature(row) {
	return [
		normalizeRecordType(row.record_type, DEFAULT_RECORD_TYPE),
		normalizeFillingDate(row.date),
		normalizeBottleNo(row.bottle_no),
		formatWeightKey(row.fill_weight),
		normalizeString(row.operator),
		normalizeString(row.remark)
	].join('|')
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

	const ndjsonRows = []
	const lines = body.split(/\r?\n/)
	let ndjsonBadLineCount = 0
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim()
		if (!line) continue
		try {
			ndjsonRows.push(JSON.parse(line))
		} catch (_) {
			ndjsonBadLineCount += 1
		}
	}
	if (ndjsonRows.length > 0 && ndjsonBadLineCount === 0) {
		return { rows: ndjsonRows, parseMode: 'ndjson' }
	}

	try {
		const wrapped = `[${body}]`
		const parsed = JSON.parse(wrapped)
		if (Array.isArray(parsed)) return { rows: parsed, parseMode: 'json-stream-array-wrap' }
	} catch (_) {
		// continue
	}

	throw new Error('无法解析输入文件，请提供 JSON 数组/NDJSON/对象流格式')
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
	const values = Object.values(node)
	for (let i = 0; i < values.length; i += 1) {
		const found = deepFindSpace(values[i], spaceId)
		if (found) return found
	}
	return null
}

function tryLoadSpaceConfig(spaceId) {
	if (!spaceId) return null
	const files = listProjectSettingFiles()
	let fallback = null
	for (let i = 0; i < files.length; i += 1) {
		try {
			const raw = JSON.parse(fs.readFileSync(files[i], 'utf8'))
			const found = deepFindSpace(raw, spaceId)
			if (found) {
				const candidate = {
					clientSecret: normalizeString(found.clientSecret),
					accessKey: normalizeString(found.accessKey),
					secretKey: normalizeString(found.secretKey),
					spaceAppId: normalizeString(found.spaceAppId),
					endpoint: normalizeString(found.apiEndpoint),
					from: files[i]
				}
				if (candidate.accessKey && candidate.secretKey && candidate.spaceAppId) return candidate
				if (!fallback) fallback = candidate
			}
		} catch (_) {
			// ignore broken setting files
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

function buildSignInput(payload) {
	return Object.keys(payload)
		.sort()
		.filter((key) => payload[key])
		.map((key) => `${key}=${payload[key]}`)
		.join('&')
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

class UniCloudHttpClient {
	constructor({ spaceId, clientSecret, endpoint }) {
		if (!spaceId) throw new Error('缺少 spaceId')
		if (!clientSecret) throw new Error('缺少 clientSecret')
		if (typeof fetch !== 'function') throw new Error('当前 Node 版本不支持 fetch，请升级到 Node 18+')
		this.spaceId = spaceId
		this.clientSecret = clientSecret
		this.endpoint =
			endpoint || (spaceId.startsWith('mp-') ? 'https://api.next.bspapp.com' : 'https://api.bspapp.com')
		this.requestUrl = `${this.endpoint.replace(/\/+$/, '')}/client`
		this.accessToken = ''
	}

	unwrapResult(response) {
		if (response && response.data != null) return response.data
		if (response && response.result != null) return response.result
		return response
	}

	async postServerless(payload, withAuthToken) {
		const body = {
			...payload,
			spaceId: this.spaceId,
			timestamp: Date.now()
		}
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
		if (json && json.error) {
			throw new Error(`uniCloud error: ${json.error.code || ''} ${json.error.message || ''}`.trim())
		}
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
				params: JSON.stringify({
					functionTarget: name,
					functionArgs
				})
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

function splitPathQuery(urlPath) {
	const idx = String(urlPath).indexOf('?')
	if (idx < 0) return [String(urlPath), '']
	return [urlPath.slice(0, idx), urlPath.slice(idx + 1)]
}

function uuidV4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
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
		const canonicalHeaderLines = signedHeaders
			.map((k) => `${k}:${headers[k] || ''}\n`)
			.join('')
		const bodyText = JSON.stringify(data || {})
		const bodyHash = sha256Hex(bodyText)
		const canonicalRequest = `POST\n${pathname}\n${query}\n${canonicalHeaderLines}\n${signedHeaders.join(';')}\n${bodyHash}\n`
		const canonicalHash = sha256Hex(canonicalRequest)
		const stringToSign = `HMAC-SHA256\n${timestamp}\n${canonicalHash}\n`
		const signature = hmacSha256Hex(stringToSign, this.secretKey)
		const authorization = `HMAC-SHA256 Credential=${this.accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
		const finalHeaders = {
			...headers,
			Authorization: authorization,
			'content-type': 'application/json'
		}
		const endpoint = this.endpoint.replace(/\/+$/, '')
		return {
			url: `${endpoint}${pathname}${query ? `?${query}` : ''}`,
			headers: finalHeaders,
			bodyText,
			requestId
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
		if (!res.ok) {
			throw new Error(`支付宝云函数 HTTP ${res.status}: ${JSON.stringify(json)}`)
		}
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
	if (!loginRes || loginRes.code !== 0) {
		throw new Error(`CRM 登录失败: ${JSON.stringify(loginRes)}`)
	}
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error(`CRM 登录成功但没有 token: ${JSON.stringify(loginRes)}`)
	return token
}

async function fetchExistingSignatureSet(client, crmToken) {
	const signatureSet = new Set()
	const countsByType = {
		normal_fill: 0,
		truck_out_agent_sale: 0,
		truck_out_no_sale: 0
	}
	const types = ['normal_fill', 'truck_out_agent_sale', 'truck_out_no_sale']
	for (let i = 0; i < types.length; i += 1) {
		const recordType = types[i]
		let page = 1
		const pageSize = 200
		while (true) {
			const res = await client.callFunction('crm-filling', {
				action: 'listV1',
				token: crmToken,
				data: {
					record_type: recordType,
					page,
					pageSize
				},
				request_id: generateRequestId()
			})
			if (!res || res.code !== 0) {
				throw new Error(`加载现网灌装数据失败(${recordType},page=${page}): ${JSON.stringify(res)}`)
			}
			const rows = Array.isArray(res.data) ? res.data : []
			for (let j = 0; j < rows.length; j += 1) {
				const row = rows[j] || {}
				const signature = toSignature({
					record_type: normalizeRecordType(row.record_type, DEFAULT_RECORD_TYPE),
					date: normalizeString(row.date),
					bottle_no: normalizeBottleNo(row.bottle_no),
					fill_weight: toPositiveNumber(row.fill_weight),
					operator: normalizeString(row.operator || row.created_by_name),
					remark: normalizeString(row.remark)
				})
				if (signature) signatureSet.add(signature)
			}
			countsByType[recordType] += rows.length
			const hasMore = Boolean(res.paging && res.paging.hasMore)
			if (!hasMore) break
			page += 1
		}
	}
	return {
		signatureSet,
		countsByType
	}
}

function normalizeInputRows(rawRows) {
	const normalizedRows = []
	const invalidRows = []
	const duplicateInputRows = []
	const signatureSeen = new Set()
	const byType = {
		normal_fill: 0,
		truck_out_agent_sale: 0,
		truck_out_no_sale: 0
	}
	let noSaleBottleFilledFromVehicle = 0

	for (let i = 0; i < rawRows.length; i += 1) {
		const row = rawRows[i] && typeof rawRows[i] === 'object' ? rawRows[i] : {}
		const lineNo = i + 1
		const date = normalizeFillingDate(row.date)
		const recordType = normalizeRecordType(row.record_type, DEFAULT_RECORD_TYPE)
		let bottleNo = normalizeBottleNo(row.bottle_no)
		if (recordType === 'truck_out_no_sale' && !bottleNo) {
			const plateNo = normalizePlateNo(row.vehicle_no || row.car_no || row.truck_no)
			if (plateNo) {
				bottleNo = plateNo
				noSaleBottleFilledFromVehicle += 1
			}
		}
		const fillWeight = toPositiveNumber(
			row.fill_weight != null ? row.fill_weight : (row.net_fill != null ? row.net_fill : row.out_net)
		)
		const operator = normalizeString(row.operator || row.created_by_name || '陈铁栓')
		const operatorId = normalizeString(row.operator_id || row.created_by || '')
		const remark = normalizeString(row.remark)

		if (!date) {
			invalidRows.push({ line_no: lineNo, reason: 'date_empty' })
			continue
		}
		if (!recordType) {
			invalidRows.push({ line_no: lineNo, reason: 'record_type_invalid', record_type: row.record_type })
			continue
		}
		if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
			invalidRows.push({ line_no: lineNo, reason: 'fill_weight_invalid', fill_weight: row.fill_weight })
			continue
		}
		if (recordType !== 'truck_out_no_sale' && !bottleNo) {
			invalidRows.push({ line_no: lineNo, reason: 'bottle_no_required', record_type: recordType })
			continue
		}

		const doc = {
			line_no: lineNo,
			source_id: normalizeString(row._id || row.id),
			date,
			bottle_no: bottleNo,
			record_type: recordType,
			operator,
			operator_id: operatorId,
			fill_weight: fillWeight,
			remark
		}
		const signature = toSignature(doc)
		doc.signature = signature
		byType[recordType] += 1

		if (signatureSeen.has(signature)) {
			duplicateInputRows.push({
				line_no: lineNo,
				source_id: doc.source_id,
				record_type: doc.record_type,
				date: doc.date,
				bottle_no: doc.bottle_no
			})
			continue
		}
		signatureSeen.add(signature)
		normalizedRows.push(doc)
	}

	return {
		rows: normalizedRows,
		invalidRows,
		duplicateInputRows,
		byType,
		noSaleBottleFilledFromVehicle
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
	if (!fs.existsSync(inputPath)) {
		throw new Error(`输入文件不存在: ${inputPath}`)
	}

	const sourceText = fs.readFileSync(inputPath, 'utf8')
	const parsedInput = parseJsonLikeRows(sourceText)
	const normalizedInput = normalizeInputRows(parsedInput.rows)

	if (!options.spaceId) throw new Error('缺少 spaceId，请用 --space-id 提供')
	const loadedSpace = tryLoadSpaceConfig(options.spaceId)
	if (!options.clientSecret && loadedSpace) options.clientSecret = loadedSpace.clientSecret
	if (!options.endpoint && loadedSpace) options.endpoint = loadedSpace.endpoint
	if (!options.accessKey && loadedSpace) options.accessKey = loadedSpace.accessKey
	if (!options.secretKey && loadedSpace) options.secretKey = loadedSpace.secretKey
	if (!options.spaceAppId && loadedSpace) options.spaceAppId = loadedSpace.spaceAppId
	if (!(options.clientSecret || (options.accessKey && options.secretKey && options.spaceAppId))) {
		throw new Error('缺少空间鉴权参数（clientSecret 或 accessKey/secretKey/spaceAppId）')
	}

	console.log(`输入文件: ${inputPath}`)
	console.log(`解析模式: ${parsedInput.parseMode}`)
	console.log(`原始行数: ${parsedInput.rows.length}`)
	console.log(`规范化后: ${normalizedInput.rows.length}`)
	console.log(`输入内重复跳过: ${normalizedInput.duplicateInputRows.length}`)
	console.log(`输入无效跳过: ${normalizedInput.invalidRows.length}`)
	console.log(`空间: ${options.spaceId}`)
	if (loadedSpace && loadedSpace.from) {
		console.log(`已自动加载空间配置: ${loadedSpace.from}`)
	}
	console.log(`模式: ${options.execute ? 'EXECUTE（写入）' : 'DRY-RUN（仅预检）'}`)

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
	const existing = await fetchExistingSignatureSet(client, crmToken)

	const alreadyExists = []
	const toCreate = []
	for (let i = 0; i < normalizedInput.rows.length; i += 1) {
		const row = normalizedInput.rows[i]
		if (existing.signatureSet.has(row.signature)) {
			alreadyExists.push(row)
		} else {
			toCreate.push(row)
		}
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
		input_by_type: normalizedInput.byType,
		input_no_sale_bottle_filled_from_vehicle_total: normalizedInput.noSaleBottleFilledFromVehicle || 0,
		existing_loaded_by_type: existing.countsByType,
		already_exists_total: alreadyExists.length,
		target_total: toCreate.length,
		success_total: 0,
		conflict_total: 0,
		failed_total: 0,
		conflicts_preview: [],
		failed_preview: [],
		warnings_preview: [],
		input_invalid_preview: normalizedInput.invalidRows.slice(0, 50),
		input_duplicate_preview: normalizedInput.duplicateInputRows.slice(0, 50)
	}

	if (!options.execute) {
		report.finished_at = new Date().toISOString()
		const reportPath = path.resolve(process.cwd(), options.report)
		writeReport(reportPath, report)
		console.log('预检完成：')
		console.log(`- 已存在(精确匹配): ${report.already_exists_total}`)
		console.log(`- 待新增:           ${report.target_total}`)
		console.log(`- report:           ${reportPath}`)
		return
	}

	const progress = createProgressPrinter(toCreate.length || 1)
	let cursor = 0
	const conflicts = []
	const failures = []
	const warnings = []

	async function worker(workerId) {
		void workerId
		while (true) {
			const index = cursor
			cursor += 1
			if (index >= toCreate.length) return
			const row = toCreate[index]

			let response
			try {
				response = await client.callFunction('crm-filling', {
					action: 'createV1',
					token: crmToken,
					data: {
						date: row.date,
						bottle_no: row.bottle_no,
						record_type: row.record_type,
						operator: row.operator,
						operator_id: row.operator_id || undefined,
						fill_weight: row.fill_weight,
						remark: row.remark,
						source_type: 'legacy_import',
						...(options.respectFlowWarning ? {} : { ignore_bottle_flow_warning: true })
					},
					request_id: generateRequestId()
				})
			} catch (err) {
				failures.push({
					line_no: row.line_no,
					source_id: row.source_id,
					record_type: row.record_type,
					date: row.date,
					bottle_no: row.bottle_no,
					error: normalizeString(err && err.message) || '网络/调用异常'
				})
				report.failed_total += 1
				progress.step(`failed=${report.failed_total}`)
				continue
			}

			if (response && response.code === 0) {
				report.success_total += 1
				existing.signatureSet.add(row.signature)
				const warning = normalizeString(response?.data?.warning || response?.warning || '')
				if (warning) {
					warnings.push({
						line_no: row.line_no,
						bottle_no: row.bottle_no,
						warning
					})
				}
				progress.step(`success=${report.success_total}`)
				continue
			}

			if (response && response.code === 409) {
				report.conflict_total += 1
				conflicts.push({
					line_no: row.line_no,
					source_id: row.source_id,
					record_type: row.record_type,
					date: row.date,
					bottle_no: row.bottle_no,
					msg: normalizeString(response.msg) || '同日期同瓶号冲突'
				})
				progress.step(`conflict=${report.conflict_total}`)
				continue
			}

			report.failed_total += 1
			failures.push({
				line_no: row.line_no,
				source_id: row.source_id,
				record_type: row.record_type,
				date: row.date,
				bottle_no: row.bottle_no,
				msg: normalizeString(response && response.msg) || '未知错误',
				raw: response || null
			})
			progress.step(`failed=${report.failed_total}`)
		}
	}

	const workers = []
	const concurrency = Math.max(1, Math.min(options.concurrency, 10))
	for (let i = 0; i < concurrency; i += 1) {
		workers.push(worker(i + 1))
	}
	await Promise.all(workers)

	report.conflicts_preview = conflicts.slice(0, 100)
	report.failed_preview = failures.slice(0, 100)
	report.warnings_preview = warnings.slice(0, 100)
	report.finished_at = new Date().toISOString()

	const reportPath = path.resolve(process.cwd(), options.report)
	writeReport(reportPath, report)

	console.log('导入完成：')
	console.log(`- 已存在(精确匹配): ${report.already_exists_total}`)
	console.log(`- 目标新增:          ${report.target_total}`)
	console.log(`- 成功新增:          ${report.success_total}`)
	console.log(`- 冲突(409):         ${report.conflict_total}`)
	console.log(`- 失败:              ${report.failed_total}`)
	console.log(`- warning:           ${warnings.length}`)
	console.log(`- report:            ${reportPath}`)
}

run().catch((err) => {
	console.error(`执行失败: ${normalizeString(err && err.message) || err}`)
	process.exit(1)
})
