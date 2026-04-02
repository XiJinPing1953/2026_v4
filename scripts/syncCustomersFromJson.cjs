#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_INPUT = 'docs/客户.json'
const DEFAULT_REPORT = 'docs/customer.sync.report.json'

function parseArgs(argv) {
	const args = {
		spaceId: process.env.UNI_SPACE_ID || '',
		input: DEFAULT_INPUT,
		report: DEFAULT_REPORT,
		execute: false,
		concurrency: 3
	}
	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--space-id' && next) {
			args.spaceId = next
			i += 1
		} else if (cur === '--input' && next) {
			args.input = next
			i += 1
		} else if (cur === '--report' && next) {
			args.report = next
			i += 1
		} else if (cur === '--concurrency' && next) {
			const n = Number(next)
			if (Number.isFinite(n) && n > 0) args.concurrency = Math.max(1, Math.min(Math.floor(n), 8))
			i += 1
		} else if (cur === '--execute') {
			args.execute = true
		} else if (cur === '--help' || cur === '-h') {
			printHelp()
			process.exit(0)
		}
	}
	return args
}

function printHelp() {
	console.log(`\nUsage:\n  node scripts/syncCustomersFromJson.cjs [options]\n\nOptions:\n  --space-id <id>      云空间ID（必填）\n  --input <path>       输入文件（默认 ${DEFAULT_INPUT}）\n  --report <path>      报告文件（默认 ${DEFAULT_REPORT}）\n  --concurrency <n>    并发（1-8，默认 3）\n  --execute            真执行（默认仅预检）\n`)
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizePhone(value) {
	return normalizeString(value).replace(/\s+/g, '')
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

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function normalizePriceUnit(value) {
	const unit = normalizeString(value) || 'kg'
	if (unit === 'kg' || unit === 'bottle' || unit === 'm3') return unit
	return 'kg'
}

function normalizeKey(name, phone) {
	return `${normalizeString(name)}|${normalizePhone(phone)}`
}

function normalizeNameKey(value) {
	return normalizeString(value)
		.toUpperCase()
		.replace(/[\s\u3000\-_—()（）【】\[\]<>《》,，.。·•/]/g, '')
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
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim()
		if (!line) continue
		rows.push(JSON.parse(line))
	}
	return { rows, parseMode: 'ndjson' }
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	const dirs = fs.readdirSync(base)
	return dirs.map((dir) => path.join(base, dir, 'setting.json')).filter((p) => fs.existsSync(p))
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

async function ensureCrmToken(client) {
	const loginRes = await client.callFunction('crm-auth', {
		action: 'login',
		data: {
			username: 'superadmin',
			password: 'y7ez5CGAbivZkeP'
		},
		request_id: generateRequestId()
	})
	if (!loginRes || loginRes.code !== 0) throw new Error(`CRM 登录失败: ${JSON.stringify(loginRes)}`)
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error(`CRM 登录成功但没有 token: ${JSON.stringify(loginRes)}`)
	return token
}

async function fetchAllCustomers(client, token) {
	const rows = []
	let page = 1
	const pageSize = 200
	let guard = 0
	while (guard < 300) {
		const res = await client.callFunction('crm-customer', {
			action: 'listV1',
			token,
			data: { page, pageSize },
			request_id: generateRequestId()
		})
		if (!res || res.code !== 0) throw new Error(`加载客户失败(page=${page}): ${JSON.stringify(res)}`)
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!(res.paging && res.paging.hasMore)) break
		page += 1
		guard += 1
	}
	return rows
}

function normalizeInputRows(rawRows) {
	const out = []
	const seen = new Set()
	for (let i = 0; i < rawRows.length; i += 1) {
		const row = rawRows[i] && typeof rawRows[i] === 'object' ? rawRows[i] : {}
		const name = normalizeString(row.name)
		if (!name) continue
		const phone = normalizePhone(row.phone)
		const key = normalizeKey(name, phone)
		if (seen.has(key)) continue
		seen.add(key)
		out.push({
			line_no: i + 1,
			source_id: unwrapId(row._id),
			name,
			phone,
			short_name: normalizeString(row.short_name),
			contact: normalizeString(row.contact),
			address: normalizeString(row.address),
			remark: normalizeString(row.remark),
			is_active: row.is_active === false ? false : true,
			default_unit_price: toNumber(row.default_unit_price, null),
			default_price_unit: normalizePriceUnit(row.default_price_unit),
			key,
			name_key: normalizeNameKey(name)
		})
	}
	return out
}

function buildCloudIndex(cloudRows) {
	const byId = new Map()
	const byKey = new Map()
	const byNameKey = new Map()
	for (const row of cloudRows) {
		const id = normalizeString(row && row._id)
		const name = normalizeString(row && row.name)
		const phone = normalizePhone(row && row.phone)
		const key = normalizeKey(name, phone)
		const nameKey = normalizeNameKey(name)
		if (id) byId.set(id, row)
		if (key && !byKey.has(key)) byKey.set(key, row)
		if (nameKey) {
			if (!byNameKey.has(nameKey)) byNameKey.set(nameKey, [])
			byNameKey.get(nameKey).push(row)
		}
	}
	return { byId, byKey, byNameKey }
}

function chooseTargetId(input, index, usedCloudIds) {
	if (input.source_id && index.byId.has(input.source_id) && !usedCloudIds.has(input.source_id)) {
		return input.source_id
	}
	const exact = index.byKey.get(input.key)
	if (exact && !usedCloudIds.has(exact._id)) return exact._id
	const sameNames = index.byNameKey.get(input.name_key) || []
	const available = sameNames.filter((r) => !usedCloudIds.has(r._id))
	if (available.length === 1) return available[0]._id
	const emptyPhone = available.find((r) => !normalizePhone(r.phone))
	if (emptyPhone) return emptyPhone._id
	return ''
}

function buildPatch(input, cloudRow) {
	const patch = { _id: cloudRow._id }
	let changed = false
	const set = (field, next, cur) => {
		const a = next == null ? '' : String(next)
		const b = cur == null ? '' : String(cur)
		if (a !== b) {
			patch[field] = next
			changed = true
		}
	}
	set('name', input.name, normalizeString(cloudRow.name))
	set('short_name', input.short_name, normalizeString(cloudRow.short_name))
	set('contact', input.contact, normalizeString(cloudRow.contact))
	set('phone', input.phone, normalizePhone(cloudRow.phone))
	set('address', input.address, normalizeString(cloudRow.address))
	set('remark', input.remark, normalizeString(cloudRow.remark))
	set('default_price_unit', input.default_price_unit, normalizePriceUnit(cloudRow.default_price_unit))
	const curPrice = toNumber(cloudRow.default_unit_price, null)
	const nextPrice = toNumber(input.default_unit_price, null)
	if ((curPrice == null ? '' : String(curPrice)) !== (nextPrice == null ? '' : String(nextPrice))) {
		patch.default_unit_price = nextPrice
		changed = true
	}
	const curActive = cloudRow.is_active === false ? false : true
	if (curActive !== input.is_active) {
		patch.is_active = input.is_active
		changed = true
	}
	return { patch, changed }
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
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
	const args = parseArgs(process.argv)
	if (!args.spaceId) throw new Error('缺少 --space-id')

	const inputPath = path.resolve(process.cwd(), args.input)
	const reportPath = path.resolve(process.cwd(), args.report)
	const parsedInput = parseJsonLikeRows(fs.readFileSync(inputPath, 'utf8'))
	const inputRows = normalizeInputRows(parsedInput.rows)

	const loadedSpace = tryLoadSpaceConfig(args.spaceId)
	if (!loadedSpace) throw new Error(`未找到空间配置: ${args.spaceId}`)

	const client = loadedSpace.accessKey && loadedSpace.secretKey && loadedSpace.spaceAppId
		? new AlipayFunctionClient({
			spaceId: args.spaceId,
			accessKey: loadedSpace.accessKey,
			secretKey: loadedSpace.secretKey,
			spaceAppId: loadedSpace.spaceAppId,
			endpoint: loadedSpace.endpoint
		})
		: new UniCloudHttpClient({
			spaceId: args.spaceId,
			clientSecret: loadedSpace.clientSecret,
			endpoint: loadedSpace.endpoint
		})

	const token = await ensureCrmToken(client)
	const cloudRows = await fetchAllCustomers(client, token)
	const cloudIndex = buildCloudIndex(cloudRows)
	const usedCloudIds = new Set()

	const plans = []
	const unresolved = []
	for (const row of inputRows) {
		const targetId = chooseTargetId(row, cloudIndex, usedCloudIds)
		if (!targetId) {
			unresolved.push({ line_no: row.line_no, name: row.name, phone: row.phone, source_id: row.source_id })
			continue
		}
		usedCloudIds.add(targetId)
		const cloudRow = cloudIndex.byId.get(targetId)
		if (!cloudRow) {
			unresolved.push({ line_no: row.line_no, name: row.name, phone: row.phone, source_id: row.source_id, reason: 'target_not_found' })
			continue
		}
		const { patch, changed } = buildPatch(row, cloudRow)
		if (changed) plans.push({ line_no: row.line_no, target_id: targetId, name: row.name, phone: row.phone, patch })
	}

	const unmatchedCloud = cloudRows
		.filter((r) => !usedCloudIds.has(r._id))
		.map((r) => ({ _id: r._id, name: normalizeString(r.name), phone: normalizePhone(r.phone) }))

	const report = {
		started_at: new Date().toISOString(),
		finished_at: '',
		mode: args.execute ? 'execute' : 'dry-run',
		space_id: args.spaceId,
		input_path: inputPath,
		parse_mode: parsedInput.parseMode,
		input_total_raw: parsedInput.rows.length,
		input_total_normalized: inputRows.length,
		cloud_total: cloudRows.length,
		plan_update_total: plans.length,
		unresolved_total: unresolved.length,
		unmatched_cloud_total: unmatchedCloud.length,
		updated_total: 0,
		failed_total: 0,
		updated_preview: plans.slice(0, 120).map((p) => ({ line_no: p.line_no, target_id: p.target_id, name: p.name, phone: p.phone, fields: Object.keys(p.patch).filter((k) => k !== '_id') })),
		unresolved_preview: unresolved.slice(0, 120),
		unmatched_cloud_preview: unmatchedCloud.slice(0, 120),
		failed_preview: []
	}

	console.log(`输入文件: ${inputPath}`)
	console.log(`解析模式: ${parsedInput.parseMode}`)
	console.log(`输入(raw/normalized): ${parsedInput.rows.length}/${inputRows.length}`)
	console.log(`云端客户总数: ${cloudRows.length}`)
	console.log(`待更新: ${plans.length}`)
	console.log(`未匹配输入: ${unresolved.length}`)
	console.log(`未匹配云端: ${unmatchedCloud.length}`)
	console.log(`空间: ${args.spaceId}`)
	console.log(`模式: ${args.execute ? 'EXECUTE' : 'DRY-RUN'}`)

	if (!args.execute) {
		report.finished_at = new Date().toISOString()
		writeReport(reportPath, report)
		console.log(`预检完成，报告: ${reportPath}`)
		return
	}

	const progress = createProgressPrinter(plans.length || 1)
	let cursor = 0
	const failures = []
	async function worker() {
		while (true) {
			const index = cursor
			cursor += 1
			if (index >= plans.length) return
			const plan = plans[index]
			let res
			try {
				res = await client.callFunction('crm-customer', {
					action: 'updateV1',
					token,
					data: plan.patch,
					request_id: generateRequestId()
				})
			} catch (err) {
				report.failed_total += 1
				failures.push({
					line_no: plan.line_no,
					target_id: plan.target_id,
					name: plan.name,
					error: normalizeString(err && err.message) || '网络/调用异常'
				})
				progress.step(`failed=${report.failed_total}`)
				continue
			}
			if (res && res.code === 0) {
				report.updated_total += 1
				progress.step(`updated=${report.updated_total}`)
				continue
			}
			report.failed_total += 1
			failures.push({
				line_no: plan.line_no,
				target_id: plan.target_id,
				name: plan.name,
				msg: normalizeString(res && res.msg) || '未知错误',
				raw: res || null
			})
			progress.step(`failed=${report.failed_total}`)
		}
	}

	const workers = []
	const concurrency = Math.max(1, Math.min(args.concurrency, 8))
	for (let i = 0; i < concurrency; i += 1) workers.push(worker())
	await Promise.all(workers)

	report.failed_preview = failures.slice(0, 120)
	report.finished_at = new Date().toISOString()
	writeReport(reportPath, report)
	console.log(`执行完成: updated=${report.updated_total}, failed=${report.failed_total}, report=${reportPath}`)
}

run().catch((err) => {
	console.error(`执行失败: ${normalizeString(err && err.message) || err}`)
	process.exit(1)
})
