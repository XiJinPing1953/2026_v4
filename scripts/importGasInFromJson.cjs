#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_INPUT = 'docs/gas_in.json'
const DEFAULT_REPORT = 'docs/gas_in.import.report.json'
const DEFAULT_CONCURRENCY = 3

function parseArgs(argv) {
	const args = {
		input: DEFAULT_INPUT,
		report: DEFAULT_REPORT,
		execute: false,
		allowUpdateExisting: false,
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
		} else if (cur === '--dry-run') {
			args.execute = false
		} else if (cur === '--allow-update-existing') {
			args.allowUpdateExisting = true
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
  node scripts/importGasInFromJson.cjs [options]

Options:
  --input <path>          导入源文件（默认 ${DEFAULT_INPUT}）
  --report <path>         报告输出路径（默认 ${DEFAULT_REPORT}）
  --execute               执行云端写入（默认仅 dry-run）
  --dry-run               强制仅预检
  --allow-update-existing 允许命中同日同车旧记录时执行 update（默认跳过，保护新系统手工修正）
  --concurrency <n>       执行并发 1-10（默认 ${DEFAULT_CONCURRENCY}）

Cloud Options:
  --space-id <id>         uniCloud space id（或 UNI_SPACE_ID）
  --client-secret <sec>   uniCloud client secret（或 UNI_CLIENT_SECRET）
  --endpoint <url>        uniCloud endpoint（可选）
  --access-key <key>      支付宝空间 accessKey（可选）
  --secret-key <key>      支付宝空间 secretKey（可选）
  --space-app-id <id>     支付宝空间 spaceAppId（可选）
  --crm-token <token>     CRM token（可选）
  --crm-username <name>   CRM 用户名（默认 superadmin）
  --crm-password <pass>   CRM 密码（默认回退值）

Examples:
  node scripts/importGasInFromJson.cjs --input docs/gas_in.json
  node scripts/importGasInFromJson.cjs --execute --space-id env-xxxx --input docs/gas_in.json
  node scripts/importGasInFromJson.cjs --execute --allow-update-existing --space-id env-xxxx --input docs/gas_in.json
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

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeDate(value) {
	const text = normalizeString(value)
	if (!text) return ''
	const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
	if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
	const m = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
	if (m) {
		const mm = String(Number(m[2])).padStart(2, '0')
		const dd = String(Number(m[3])).padStart(2, '0')
		return `${m[1]}-${mm}-${dd}`
	}
	const ts = Date.parse(text)
	if (Number.isFinite(ts) && ts > 0) {
		const d = new Date(ts)
		const y = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, '0')
		const dd = String(d.getDate()).padStart(2, '0')
		return `${y}-${mm}-${dd}`
	}
	return ''
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

function toTonSmart(value) {
	const num = toNumber(value, null)
	if (num == null) return null
	if (Math.abs(num) > 500) return roundTo(num / 1000, 3)
	return roundTo(num, 3)
}

function toPricePerTonSmart(value) {
	const num = toNumber(value, null)
	if (num == null) return null
	if (Math.abs(num) > 200) return roundTo(num, 2)
	return roundTo(num * 1000, 2)
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

	const lines = body.split(/\r?\n/)
	const rows = []
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

function normalizeSourceId(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		return normalizeString(value.$oid || value.oid || value.id)
	}
	return normalizeString(value)
}

function normalizeGasInRow(row = {}) {
	const date = normalizeDate(row.date)
	const plateNo = normalizePlateNo(row.plate_no)
	const tankerNo = normalizePlateNo(row.tanker_no)

	const loadT = row.load_weight_t != null ? roundTo(toNumber(row.load_weight_t, 0), 3) : toTonSmart(row.load_weight)
	const grossT = row.gross_weight_t != null ? roundTo(toNumber(row.gross_weight_t, 0), 3) : toTonSmart(row.gross_weight)
	const tareT = row.tare_weight_t != null ? roundTo(toNumber(row.tare_weight_t, 0), 3) : toTonSmart(row.tare_weight)
	let netT = row.net_weight_t != null ? roundTo(toNumber(row.net_weight_t, 0), 3) : toTonSmart(row.net_weight)
	if (netT == null && grossT != null && tareT != null) netT = roundTo(grossT - tareT, 3)

	let lossT = row.loss_amount_t != null ? roundTo(toNumber(row.loss_amount_t, 0), 3) : toTonSmart(row.loss_amount)
	const computedLoss = loadT != null && netT != null ? roundTo(loadT - netT, 3) : null
	if (computedLoss != null) {
		if (lossT == null) lossT = computedLoss
		else if (Math.abs(lossT - computedLoss) > 5) lossT = computedLoss
	}

	const unitPricePerTon =
		row.unit_price_per_ton != null
			? roundTo(toNumber(row.unit_price_per_ton, 0), 2)
			: toPricePerTonSmart(row.unit_price)

	let amount = toNumber(row.amount, null)
	if (amount == null && netT != null && unitPricePerTon != null) amount = roundTo(netT * unitPricePerTon, 2)
	if (amount != null) amount = roundTo(amount, 2)

	return {
		source_id: normalizeSourceId(row._id),
		date,
		product_name: normalizeString(row.product_name) || 'LNG',
		plate_no: plateNo,
		tanker_no: tankerNo,
		load_weight_t: loadT,
		gross_weight_t: grossT,
		tare_weight_t: tareT,
		net_weight_t: netT,
		loss_amount_t: lossT,
		unit_price_per_ton: unitPricePerTon,
		amount,
		sender: normalizeString(row.sender),
		factory: normalizeString(row.factory),
		remark: normalizeString(row.remark)
	}
}

function validateNormalizedRow(row) {
	if (!row.date) return 'date_invalid'
	if (!row.plate_no) return 'plate_no_missing'
	const required = [
		'load_weight_t',
		'gross_weight_t',
		'tare_weight_t',
		'net_weight_t',
		'loss_amount_t',
		'unit_price_per_ton',
		'amount'
	]
	for (const key of required) {
		if (!(typeof row[key] === 'number' && Number.isFinite(row[key]))) return `${key}_invalid`
	}
	if (row.load_weight_t < 0 || row.gross_weight_t < 0 || row.tare_weight_t < 0 || row.net_weight_t < 0) {
		return 'weight_negative'
	}
	if (row.unit_price_per_ton < 0 || row.amount < 0) return 'amount_negative'
	return ''
}

function hashRow(row) {
	return [
		row.date,
		row.plate_no,
		row.tanker_no,
		row.product_name,
		row.load_weight_t,
		row.gross_weight_t,
		row.tare_weight_t,
		row.net_weight_t,
		row.loss_amount_t,
		row.unit_price_per_ton,
		row.amount,
		row.sender,
		row.factory,
		row.remark
	].join('|')
}

function buildNormalizedRows(sourceRows = []) {
	const invalid = []
	const dedupSet = new Set()
	const rows = []
	for (let i = 0; i < sourceRows.length; i += 1) {
		const normalized = normalizeGasInRow(sourceRows[i] || {})
		const error = validateNormalizedRow(normalized)
		if (error) {
			invalid.push({ index: i + 1, error, row: normalized })
			continue
		}
		const hash = hashRow(normalized)
		if (dedupSet.has(hash)) continue
		dedupSet.add(hash)
		rows.push(normalized)
	}
	return { rows, invalid }
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
		const finalHeaders = {
			...headers,
			Authorization: authorization,
			'content-type': 'application/json'
		}
		const endpoint = this.endpoint.replace(/\/+$/, '')
		return {
			url: `${endpoint}${pathname}${query ? `?${query}` : ''}`,
			headers: finalHeaders,
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

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	return fs
		.readdirSync(base)
		.map((dir) => path.join(base, dir, 'setting.json'))
		.filter((filePath) => fs.existsSync(filePath))
}

function deepFindAlipaySpaceSecrets(node, targetSpaceId) {
	if (!node || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i += 1) {
			const found = deepFindAlipaySpaceSecrets(node[i], targetSpaceId)
			if (found) return found
		}
		return null
	}

	const candidate = {
		spaceId: normalizeString(node.spaceId || node.space_id || node.spaceid || node.id),
		accessKey: normalizeString(node.accessKey || node.access_key),
		secretKey: normalizeString(node.secretKey || node.secret_key),
		spaceAppId: normalizeString(node.spaceAppId || node.space_app_id)
	}
	if (
		candidate.spaceId === targetSpaceId &&
		candidate.accessKey &&
		candidate.secretKey &&
		candidate.spaceAppId
	) {
		return candidate
	}

	const values = Object.values(node)
	for (let i = 0; i < values.length; i += 1) {
		const found = deepFindAlipaySpaceSecrets(values[i], targetSpaceId)
		if (found) return found
	}
	return null
}

function collectAlipaySpaceSecrets(spaceId) {
	if (!spaceId) return null
	const settings = listProjectSettingFiles()
	let fallback = null
	for (let i = 0; i < settings.length; i += 1) {
		try {
			const json = JSON.parse(fs.readFileSync(settings[i], 'utf8'))
			const deepFound = deepFindAlipaySpaceSecrets(json, spaceId)
			if (deepFound) return deepFound
			const providers = json?.cloudfunctionRoot || json?.unicloud?.spaces || json?.spaces || []
			const list = Array.isArray(providers) ? providers : Object.values(providers || {})
			for (const item of list) {
				const candidate = {
					spaceId: normalizeString(item.spaceId || item.space_id || item.spaceid || item.id),
					accessKey: normalizeString(item.accessKey || item.access_key),
					secretKey: normalizeString(item.secretKey || item.secret_key),
					spaceAppId: normalizeString(item.spaceAppId || item.space_app_id)
				}
				if (candidate.spaceId !== spaceId) continue
				if (candidate.accessKey && candidate.secretKey && candidate.spaceAppId) return candidate
				if (!fallback) fallback = candidate
			}
		} catch (_) {
			// ignore
		}
	}
	return fallback
}

function createClient(options) {
	if (options.accessKey && options.secretKey && options.spaceAppId) {
		return new AlipayFunctionClient({
			spaceId: options.spaceId,
			accessKey: options.accessKey,
			secretKey: options.secretKey,
			spaceAppId: options.spaceAppId,
			endpoint: options.endpoint
		})
	}
	const found = collectAlipaySpaceSecrets(options.spaceId)
	if (found && found.accessKey && found.secretKey && found.spaceAppId) {
		return new AlipayFunctionClient({
			spaceId: options.spaceId,
			accessKey: found.accessKey,
			secretKey: found.secretKey,
			spaceAppId: found.spaceAppId,
			endpoint: options.endpoint
		})
	}
	return new UniCloudHttpClient({
		spaceId: options.spaceId,
		clientSecret: options.clientSecret,
		endpoint: options.endpoint
	})
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

async function importGasInRow(client, token, row, options = {}) {
	const listRes = await client.callFunction('crm-gas-in', {
		action: 'listV1',
		token,
		data: {
			plate_no: row.plate_no,
			dateStart: row.date,
			dateEnd: row.date,
			page: 1,
			pageSize: 50
		},
		request_id: generateRequestId()
	})
	if (!listRes || listRes.code !== 0) {
		throw new Error(listRes?.msg || '查询同日同车牌失败')
	}
	const rows = Array.isArray(listRes.data) ? listRes.data : []
	const existed = rows.find((item) => normalizeDate(item.date) === row.date && normalizePlateNo(item.plate_no) === row.plate_no)
	if (existed && existed._id) {
		if (!options.allowUpdateExisting) {
			return { mode: 'skip_existing', id: existed._id, warning: 'matched_existing_same_day_plate' }
		}
		const updateRes = await client.callFunction('crm-gas-in', {
			action: 'updateV1',
			token,
			data: {
				_id: existed._id,
				...row
			},
			request_id: generateRequestId()
		})
		if (!updateRes || updateRes.code !== 0) {
			throw new Error(updateRes?.msg || '更新失败')
		}
		return { mode: 'update', id: existed._id, warning: normalizeString(updateRes?.data?.warning) }
	}

	const createRes = await client.callFunction('crm-gas-in', {
		action: 'createV1',
		token,
		data: row,
		request_id: generateRequestId()
	})
	if (!createRes || createRes.code !== 0) {
		throw new Error(createRes?.msg || '创建失败')
	}
	return { mode: 'create', id: normalizeString(createRes?.data?._id), warning: normalizeString(createRes?.data?.warning) }
}

async function parallelRun(items, concurrency, worker) {
	const list = Array.isArray(items) ? items : []
	const results = new Array(list.length)
	let cursor = 0
	async function runOne() {
		while (true) {
			const current = cursor
			cursor += 1
			if (current >= list.length) return
			results[current] = await worker(list[current], current)
		}
	}
	const tasks = []
	const size = Math.max(1, Math.min(Number(concurrency) || 1, 10))
	for (let i = 0; i < size; i += 1) tasks.push(runOne())
	await Promise.all(tasks)
	return results
}

async function main() {
	const args = parseArgs(process.argv)
	const inputPath = path.resolve(process.cwd(), args.input)
	const reportPath = path.resolve(process.cwd(), args.report)
	ensureDir(reportPath)

	if (!fs.existsSync(inputPath)) throw new Error(`输入文件不存在: ${inputPath}`)

	const rawText = fs.readFileSync(inputPath, 'utf8')
	const parsed = parseJsonLikeRows(rawText)
	const sourceRows = Array.isArray(parsed.rows) ? parsed.rows : []
	const normalizedRes = buildNormalizedRows(sourceRows)
	const readyRows = normalizedRes.rows
	const invalidRows = normalizedRes.invalid

	const report = {
		generated_at: new Date().toISOString(),
		mode: args.execute ? 'execute' : 'dry-run',
		input: path.relative(process.cwd(), inputPath),
		report: path.relative(process.cwd(), reportPath),
		parse_mode: parsed.parseMode,
		source_total: sourceRows.length,
		valid_total: readyRows.length,
		invalid_total: invalidRows.length,
		invalid_sample: invalidRows.slice(0, 20),
		summary: {
			net_weight_t_total: roundTo(readyRows.reduce((sum, row) => sum + (toNumber(row.net_weight_t, 0) || 0), 0), 3),
			amount_total: roundTo(readyRows.reduce((sum, row) => sum + (toNumber(row.amount, 0) || 0), 0), 2)
		},
		execute: {
			attempted: 0,
			success: 0,
			created: 0,
			updated: 0,
			skipped_existing: 0,
			failed: 0,
			warnings: 0,
			failed_items: []
		}
	}

	if (!args.execute) {
		fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
		console.log(`[DRY-RUN] source=${report.source_total}, valid=${report.valid_total}, invalid=${report.invalid_total}`)
		console.log(`report: ${reportPath}`)
		return
	}

	if (!args.spaceId) throw new Error('执行模式缺少 --space-id / UNI_SPACE_ID')
	if (!args.clientSecret && !(args.accessKey && args.secretKey && args.spaceAppId)) {
		const discovered = collectAlipaySpaceSecrets(args.spaceId)
		if (!(discovered && discovered.accessKey && discovered.secretKey && discovered.spaceAppId)) {
			throw new Error('缺少云端认证参数：请提供 UNI_CLIENT_SECRET 或 支付宝 accessKey/secretKey/spaceAppId')
		}
	}

	const client = createClient(args)
	const crmToken = await ensureCrmToken(client, args)

	report.execute.attempted = readyRows.length
	const results = await parallelRun(readyRows, args.concurrency, async (row, index) => {
		try {
			const result = await importGasInRow(client, crmToken, row, {
				allowUpdateExisting: Boolean(args.allowUpdateExisting)
			})
			return { ok: true, index: index + 1, result }
		} catch (err) {
			return {
				ok: false,
				index: index + 1,
				error: normalizeString(err && err.message) || 'unknown error',
				row
			}
		}
	})

	for (let i = 0; i < results.length; i += 1) {
		const item = results[i]
		if (!item) continue
		if (!item.ok) {
			report.execute.failed += 1
			report.execute.failed_items.push({ index: item.index, error: item.error, row: item.row })
			continue
		}
		report.execute.success += 1
		if (item.result.mode === 'create') report.execute.created += 1
		if (item.result.mode === 'update') report.execute.updated += 1
		if (item.result.mode === 'skip_existing') report.execute.skipped_existing += 1
		if (item.result.warning) report.execute.warnings += 1
	}
	report.execute.failed_items = report.execute.failed_items.slice(0, 200)

	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
	console.log(`[EXECUTE] attempted=${report.execute.attempted}, success=${report.execute.success}, failed=${report.execute.failed}`)
	console.log(`created=${report.execute.created}, updated=${report.execute.updated}, skipped_existing=${report.execute.skipped_existing}, warnings=${report.execute.warnings}`)
	console.log(`report: ${reportPath}`)
}

main().catch((err) => {
	console.error('[importGasInFromJson] failed:', err && err.message ? err.message : err)
	process.exitCode = 1
})
