#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizePhone(value) {
	return normalizeString(value).replace(/\s+/g, '')
}

function normalizeName(value) {
	return normalizeString(value).replace(/\s+/g, ' ')
}

function normalizeCode(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizePlateNo(value) {
	return normalizeCode(value)
}

function normalizeBottleNo(value) {
	return normalizeCode(value)
}

function buildCustomerUniqKey(name, phone) {
	const normalizedName = normalizeString(name)
	const normalizedPhone = normalizePhone(phone)
	return normalizedPhone ? `${normalizedName}|${normalizedPhone}` : normalizedName
}

function buildDeliveryUniqKey(name, phone) {
	const normalizedName = normalizeName(name)
	const normalizedPhone = normalizePhone(phone)
	if (!normalizedName) return ''
	return normalizedPhone ? `${normalizedName}|${normalizedPhone}` : `${normalizedName}|-`
}

function buildVehicleUniqKey(plateNo) {
	return normalizePlateNo(plateNo)
}

function parseCustomerUniqKey(value) {
	const text = normalizeString(value)
	if (!text) return { name: '', phone: '' }
	const idx = text.indexOf('|')
	if (idx < 0) return { name: text, phone: '' }
	return {
		name: normalizeString(text.slice(0, idx)),
		phone: normalizePhone(text.slice(idx + 1))
	}
}

function parseDeliveryUniqKey(value) {
	const text = normalizeString(value)
	if (!text) return { name: '', phone: '' }
	const idx = text.indexOf('|')
	if (idx < 0) return { name: normalizeName(text), phone: '' }
	const phone = normalizePhone(text.slice(idx + 1))
	return {
		name: normalizeName(text.slice(0, idx)),
		phone: phone === '-' ? '' : phone
	}
}

function parseCsvLine(line) {
	const out = []
	let cur = ''
	let inQuote = false
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i]
		if (ch === '"') {
			if (inQuote && line[i + 1] === '"') {
				cur += '"'
				i += 1
			} else {
				inQuote = !inQuote
			}
		} else if (ch === ',' && !inQuote) {
			out.push(cur)
			cur = ''
		} else {
			cur += ch
		}
	}
	out.push(cur)
	return out
}

function parseCsv(content) {
	const source = String(content || '').replace(/^\uFEFF/, '')
	const lines = source.split(/\r?\n/).filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
	if (lines.length < 2) throw new Error('CSV 至少需要表头和 1 行数据')
	const headers = parseCsvLine(lines[0]).map((item) => normalizeString(item))
	const rows = []
	for (let i = 1; i < lines.length; i += 1) {
		const cols = parseCsvLine(lines[i])
		const row = {}
		for (let j = 0; j < headers.length; j += 1) {
			row[headers[j]] = normalizeString(cols[j] || '')
		}
		rows.push({ row, lineNo: i + 1 })
	}
	return { headers, rows }
}

function loadTableRows(inputPath) {
	const absPath = path.resolve(process.cwd(), inputPath)
	if (!fs.existsSync(absPath)) throw new Error(`输入文件不存在: ${absPath}`)
	const ext = path.extname(absPath).toLowerCase()
	if (ext === '.csv') {
		const parsed = parseCsv(fs.readFileSync(absPath, 'utf8'))
		return { path: absPath, type: 'csv', headers: parsed.headers, rows: parsed.rows }
	}
	const raw = fs.readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '')
	const json = JSON.parse(raw)
	const list = Array.isArray(json) ? json : Array.isArray(json?.rows) ? json.rows : null
	if (!Array.isArray(list)) throw new Error('JSON 输入必须是数组，或对象中包含 rows 数组')
	return {
		path: absPath,
		type: 'json',
		headers: [],
		rows: list.map((row, index) => ({
			row: row && typeof row === 'object' ? row : {},
			lineNo: index + 2
		}))
	}
}

function formatTs(ts = Date.now()) {
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	const hh = String(d.getHours()).padStart(2, '0')
	const mm = String(d.getMinutes()).padStart(2, '0')
	const ss = String(d.getSeconds()).padStart(2, '0')
	return `${y}${m}${day}-${hh}${mm}${ss}`
}

function hmacMd5(text, key) {
	return crypto.createHmac('md5', key).update(text).digest('hex')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', key).update(text).digest('hex')
}

function sha256Hex(text) {
	return crypto.createHash('sha256').update(text).digest('hex')
}

function uuidV4() {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
	return [4, 2, 2, 2, 6]
		.map((len) => crypto.randomBytes(len).toString('hex'))
		.join('-')
}

function splitPathQuery(value) {
	const text = normalizeString(value)
	const idx = text.indexOf('?')
	if (idx < 0) return [text || '/', '']
	return [text.slice(0, idx) || '/', text.slice(idx + 1)]
}

function buildSignInput(payload) {
	return Object.keys(payload)
		.sort()
		.filter((key) => payload[key] !== '' && payload[key] != null)
		.map((key) => `${key}=${payload[key]}`)
		.join('&')
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	return fs
		.readdirSync(base)
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
	if (
		node.spaceid === spaceId &&
		(node.clientSecret || (node.accessKey && node.secretKey && node.spaceAppId))
	) {
		return node
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
				const config = {
					clientSecret: normalizeString(found.clientSecret),
					accessKey: normalizeString(found.accessKey),
					secretKey: normalizeString(found.secretKey),
					spaceAppId: normalizeString(found.spaceAppId),
					endpoint: normalizeString(found.apiEndpoint),
					from: files[i]
				}
				if (config.accessKey && config.secretKey && config.spaceAppId) return config
				if (!fallback && config.clientSecret) fallback = config
			}
		} catch (err) {
		}
	}
	return fallback
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

	async postServerless(payload, withAuthToken) {
		const body = {
			...payload,
			spaceId: this.spaceId,
			timestamp: Date.now()
		}
		if (withAuthToken) body.token = this.accessToken

		const headers = {
			'content-type': 'application/json'
		}
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
		} catch (err) {
			throw new Error(`uniCloud 响应不是 JSON: ${text.slice(0, 200)}`)
		}
		if (!res.ok) throw new Error(`uniCloud HTTP ${res.status}: ${JSON.stringify(json)}`)
		if (json && json.error) {
			throw new Error(`uniCloud error: ${json.error.code || ''} ${json.error.message || ''}`.trim())
		}
		return json
	}

	unwrapResult(response) {
		if (response && response.data != null) return response.data
		if (response && response.result != null) return response.result
		return response
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
			} catch (err) {
				return { raw: result }
			}
		}
		return result
	}
}

class AlipayFunctionClient {
	constructor({ spaceId, accessKey, secretKey, spaceAppId, endpoint }) {
		if (!spaceId) throw new Error('缺少 spaceId')
		if (!accessKey || !secretKey || !spaceAppId) throw new Error('缺少支付宝空间 accessKey/secretKey/spaceAppId')
		if (typeof fetch !== 'function') throw new Error('当前 Node 版本不支持 fetch，请升级到 Node 18+')
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
		let json = {}
		try {
			json = text ? JSON.parse(text) : {}
		} catch (err) {
			throw new Error(`支付宝空间响应不是 JSON: ${text.slice(0, 200)}`)
		}
		if (!res.ok) throw new Error(`支付宝空间 HTTP ${res.status}: ${text}`)
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

function parseStandardArgs(argv, defaults = {}) {
	const args = {
		input: defaults.input || '',
		report: defaults.report || '',
		backup: defaults.backup || '',
		execute: false,
		spaceId: process.env.UNI_SPACE_ID || '',
		clientSecret: process.env.UNI_CLIENT_SECRET || '',
		endpoint: process.env.UNI_ENDPOINT || '',
		crmToken: process.env.CRM_TOKEN || '',
		crmUsername: process.env.CRM_USERNAME || 'superadmin',
		crmPassword: process.env.CRM_PASSWORD || 'y7ez5CGAbivZkeP',
		accessKey: process.env.UNI_ACCESS_KEY || '',
		secretKey: process.env.UNI_SECRET_KEY || '',
		spaceAppId: process.env.UNI_SPACE_APP_ID || '',
		sampleLimit: Number(defaults.sampleLimit || 20) || 20,
		help: false
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
		} else if (cur === '--backup' && next) {
			args.backup = next
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
		} else if (cur === '--crm-token' && next) {
			args.crmToken = next
			i += 1
		} else if (cur === '--crm-username' && next) {
			args.crmUsername = next
			i += 1
		} else if (cur === '--crm-password' && next) {
			args.crmPassword = next
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
		} else if (cur === '--sample-limit' && next) {
			args.sampleLimit = Math.max(1, Number(next) || args.sampleLimit)
			i += 1
		} else if (cur === '--execute') {
			args.execute = true
		} else if (cur === '--help' || cur === '-h') {
			args.help = true
		}
	}

	return args
}

async function prepareClientOptions(options) {
	const loadedSpace = tryLoadSpaceConfig(options.spaceId)
	if (!options.clientSecret && loadedSpace) options.clientSecret = loadedSpace.clientSecret
	if (!options.accessKey && loadedSpace) options.accessKey = loadedSpace.accessKey
	if (!options.secretKey && loadedSpace) options.secretKey = loadedSpace.secretKey
	if (!options.spaceAppId && loadedSpace) options.spaceAppId = loadedSpace.spaceAppId
	if (!options.endpoint && loadedSpace) options.endpoint = loadedSpace.endpoint
	if (!options.spaceId) throw new Error('缺少 spaceId，请用 --space-id 或 UNI_SPACE_ID 提供')
	const hasClientSecret = Boolean(options.clientSecret)
	const hasAlipayKeys = Boolean(options.accessKey && options.secretKey && options.spaceAppId)
	if (!hasClientSecret && !hasAlipayKeys) {
		throw new Error('缺少空间鉴权参数，请提供 clientSecret 或 accessKey/secretKey/spaceAppId')
	}
	return {
		loadedSpace,
		client: hasClientSecret
			? new UniCloudHttpClient({
					spaceId: options.spaceId,
					clientSecret: options.clientSecret,
					endpoint: options.endpoint
				})
			: new AlipayFunctionClient({
					spaceId: options.spaceId,
					accessKey: options.accessKey,
					secretKey: options.secretKey,
					spaceAppId: options.spaceAppId,
					endpoint: options.endpoint
				})
	}
}

async function callListAll(client, crmToken, functionName, data = {}, { pageSize = 50, maxPages = 1000 } = {}) {
	const rows = []
	let page = 1
	while (page <= maxPages) {
		const res = await client.callFunction(functionName, {
			action: 'listV1',
			token: crmToken,
			data: {
				...data,
				page,
				pageSize
			},
			request_id: generateRequestId()
		})
		if (!res || res.code !== 0) {
			throw new Error(`${functionName}.listV1 失败: ${JSON.stringify(res)}`)
		}
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		const hasMore = Boolean(res?.paging?.hasMore || (page * pageSize < Number(res?.total || 0)))
		if (!hasMore || list.length === 0) break
		page += 1
	}
	return rows
}

function collectDuplicateSamples(rows = [], { valueSelector, idSelector, labelSelector, sampleLimit = 20 } = {}) {
	const map = new Map()
	rows.forEach((row) => {
		const value = normalizeString(typeof valueSelector === 'function' ? valueSelector(row) : row?.[valueSelector])
		if (!value) return
		if (!map.has(value)) map.set(value, [])
		map.get(value).push(row)
	})
	const out = []
	for (const [value, group] of map.entries()) {
		if (group.length <= 1) continue
		out.push({
			value,
			count: group.length,
			ids: group.slice(0, 10).map((row) => (typeof idSelector === 'function' ? idSelector(row) : row?.[idSelector])).filter(Boolean),
			labels:
				typeof labelSelector === 'function'
					? group
							.slice(0, 10)
							.map((row) => labelSelector(row))
							.filter(Boolean)
					: []
		})
		if (out.length >= sampleLimit) break
	}
	return out
}

function createImportReport(entity, mode, total) {
	return {
		entity,
		started_at: new Date().toISOString(),
		finished_at: '',
		mode,
		total,
		matched: 0,
		updated: 0,
		unchanged: 0,
		not_found: [],
		duplicated: [],
		input_invalid: [],
		input_duplicate_keys: [],
		input_duplicate_codes: [],
		conflicts: [],
		failed: []
	}
}

function finalizeImportReport(report) {
	report.finished_at = new Date().toISOString()
	report.not_found = report.not_found.slice(0, 100)
	report.duplicated = report.duplicated.slice(0, 100)
	report.input_invalid = report.input_invalid.slice(0, 100)
	report.input_duplicate_keys = report.input_duplicate_keys.slice(0, 100)
	report.input_duplicate_codes = report.input_duplicate_codes.slice(0, 100)
	report.conflicts = report.conflicts.slice(0, 100)
	report.failed = report.failed.slice(0, 100)
	return report
}

function writeJsonFile(filePath, payload) {
	const abs = path.resolve(process.cwd(), filePath)
	ensureDir(abs)
	fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
	return abs
}

async function runQrImport(config) {
	const options = parseStandardArgs(process.argv, {
		input: config.defaultInput,
		report: config.defaultReport
	})
	if (options.help) {
		config.printHelp()
		return
	}
	const loadedInput = loadTableRows(options.input)
	const { loadedSpace, client } = await prepareClientOptions(options)
	const crmToken = await ensureCrmToken(client, options)

	console.log(`待处理记录: ${loadedInput.rows.length}`)
	console.log(`模式: ${options.execute ? 'EXECUTE（写入）' : 'DRY-RUN（不写入）'}`)
	console.log(`空间: ${options.spaceId}`)
	if (loadedSpace?.from) console.log(`已自动加载空间配置: ${loadedSpace.from}`)

	const report = createImportReport(config.entity, options.execute ? 'execute' : 'dry-run', loadedInput.rows.length)
	const backup = []
	const seenKeys = new Set()
	const seenCodes = new Set()

	for (let i = 0; i < loadedInput.rows.length; i += 1) {
		const source = loadedInput.rows[i]
		const normalized = config.normalizeInput(source.row, source.lineNo)
		const key = normalizeString(normalized?.lookupKey)
		const code = normalizeString(normalized?.nextCode)

		if (!key || !code || (Array.isArray(normalized?.errors) && normalized.errors.length)) {
			report.input_invalid.push({
				line: source.lineNo,
				...config.describeInput(normalized),
				errors: normalized?.errors || ['缺少必要字段']
			})
			continue
		}
		if (seenKeys.has(key)) {
			report.input_duplicate_keys.push({
				line: source.lineNo,
				key,
				...config.describeInput(normalized)
			})
			continue
		}
		if (seenCodes.has(code)) {
			report.input_duplicate_codes.push({
				line: source.lineNo,
				code,
				...config.describeInput(normalized)
			})
			continue
		}
		seenKeys.add(key)
		seenCodes.add(code)

		let matches = []
		try {
			matches = await config.findMatches({ client, crmToken, row: normalized })
		} catch (error) {
			report.failed.push({
				line: source.lineNo,
				...config.describeInput(normalized),
				error: normalizeString(error?.message) || '查询失败'
			})
			continue
		}

		if (!Array.isArray(matches) || matches.length === 0) {
			report.not_found.push({
				line: source.lineNo,
				...config.describeInput(normalized)
			})
			continue
		}
		if (matches.length > 1) {
			report.duplicated.push({
				line: source.lineNo,
				...config.describeInput(normalized),
				ids: matches.map((item) => item._id).filter(Boolean).slice(0, 10)
			})
			continue
		}

		const existing = matches[0]
		report.matched += 1
		const currentCode = normalizeString(config.readExistingCode(existing))
		if (currentCode === code) {
			report.unchanged += 1
			continue
		}

		if (!options.execute) continue
		backup.push(existing)
		try {
			const updateRes = await client.callFunction(config.functionName, {
				action: 'updateV1',
				token: crmToken,
				data: config.buildPatch(existing, normalized),
				request_id: generateRequestId()
			})
			if (updateRes?.code === 0) {
				report.updated += 1
			} else if (updateRes?.code === 409) {
				report.conflicts.push({
					line: source.lineNo,
					...config.describeInput(normalized),
					id: existing._id,
					msg: updateRes.msg || '冲突'
				})
			} else {
				report.failed.push({
					line: source.lineNo,
					...config.describeInput(normalized),
					id: existing._id,
					msg: updateRes?.msg || '未知错误',
					raw: updateRes || null
				})
			}
		} catch (error) {
			report.failed.push({
				line: source.lineNo,
				...config.describeInput(normalized),
				id: existing._id,
				error: normalizeString(error?.message) || '写入失败'
			})
		}

		if ((i + 1) % 20 === 0 || i + 1 === loadedInput.rows.length) {
			console.log(
				`Progress ${i + 1}/${loadedInput.rows.length} | matched=${report.matched} updated=${report.updated} unchanged=${report.unchanged} not_found=${report.not_found.length} dup=${report.duplicated.length} invalid=${report.input_invalid.length} conflict=${report.conflicts.length} failed=${report.failed.length}`
			)
		}
	}

	finalizeImportReport(report)
	const reportPath = writeJsonFile(options.report, report)
	let backupPath = ''
	if (options.execute) {
		backupPath = writeJsonFile(
			options.backup || path.join('docs', `${config.backupPrefix}.${formatTs()}.backup.json`),
			backup
		)
	}

	console.log('执行完成：')
	console.log(`- matched:    ${report.matched}`)
	console.log(`- updated:    ${report.updated}`)
	console.log(`- unchanged:  ${report.unchanged}`)
	console.log(`- not_found:  ${report.not_found.length}`)
	console.log(`- duplicated: ${report.duplicated.length}`)
	console.log(`- invalid:    ${report.input_invalid.length}`)
	console.log(`- conflict:   ${report.conflicts.length}`)
	console.log(`- failed:     ${report.failed.length}`)
	console.log(`- report:     ${reportPath}`)
	if (backupPath) console.log(`- backup:     ${backupPath}`)
}

module.exports = {
	UniCloudHttpClient,
	buildCustomerUniqKey,
	buildDeliveryUniqKey,
	buildVehicleUniqKey,
	callListAll,
	collectDuplicateSamples,
	ensureCrmToken,
	formatTs,
	generateRequestId,
	loadTableRows,
	normalizeBottleNo,
	normalizeCode,
	normalizeName,
	normalizePhone,
	normalizePlateNo,
	normalizeString,
	parseCustomerUniqKey,
	parseDeliveryUniqKey,
	parseStandardArgs,
	prepareClientOptions,
	runQrImport,
	tryLoadSpaceConfig,
	writeJsonFile
}
