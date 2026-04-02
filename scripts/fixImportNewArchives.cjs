#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_REPORT = 'docs/import_new/archive.fix.report.json'
const TARGET_BOTTLE_NO = 'X46'
const TARGET_PLATES = ['冀A77K99', '冀A300AN']

function parseArgs(argv) {
	const args = {
		report: DEFAULT_REPORT,
		execute: false,
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
		if (cur === '--report' && next) {
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
	console.log(`
Usage:
  node scripts/fixImportNewArchives.cjs [options]

Options:
  --report <path>         修复报告输出路径（默认 ${DEFAULT_REPORT}）
  --space-id <id>         uniCloud space id（或 UNI_SPACE_ID）
  --client-secret <sec>   uniCloud client secret（或 UNI_CLIENT_SECRET）
  --endpoint <url>        uniCloud endpoint（可选）
  --access-key <key>      支付宝空间 accessKey（可选，优先自动读取）
  --secret-key <key>      支付宝空间 secretKey（可选，优先自动读取）
  --space-app-id <id>     支付宝空间 spaceAppId（可选，优先自动读取）
  --crm-token <token>     CRM token（可选）
  --crm-username <name>   CRM 用户名（默认 superadmin）
  --crm-password <pass>   CRM 密码（默认读取脚本内回退）
  --execute               真正写入（默认仅预检）
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

async function listBottleByNo(client, token, bottleNo) {
	const res = await client.callFunction('crm-bottle', {
		action: 'listV1',
		token,
		data: {
			keyword: bottleNo,
			page: 1,
			pageSize: 20
		},
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) throw new Error(`查询钢瓶失败: ${JSON.stringify(res)}`)
	const rows = Array.isArray(res.data) ? res.data : []
	return rows.find((row) => normalizeBottleNo(row && row.bottle_no) === bottleNo) || null
}

async function listVehicleByPlate(client, token, plateNo) {
	const res = await client.callFunction('crm-vehicle', {
		action: 'listV1',
		token,
		data: {
			keyword: plateNo,
			page: 1,
			pageSize: 20
		},
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) throw new Error(`查询车辆失败: ${JSON.stringify(res)}`)
	const rows = Array.isArray(res.data) ? res.data : []
	return rows.find((row) => normalizePlateNo(row && row.plate_no) === plateNo) || null
}

async function activateBottle(client, token, bottleNo, execute) {
	const current = await listBottleByNo(client, token, bottleNo)
	if (!current) {
		return {
			target: bottleNo,
			type: 'bottle',
			status: 'missing',
			msg: '钢瓶档案不存在，未自动创建'
		}
	}
	if (current.is_active !== false) {
		return {
			target: bottleNo,
			type: 'bottle',
			status: 'noop',
			id: current._id,
			msg: '钢瓶档案已启用'
		}
	}
	if (!execute) {
		return {
			target: bottleNo,
			type: 'bottle',
			status: 'would_activate',
			id: current._id,
			msg: '预检命中禁用钢瓶档案，将启用'
		}
	}
	const res = await client.callFunction('crm-bottle', {
		action: 'updateV1',
		token,
		data: {
			_id: current._id,
			is_active: true
		},
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) {
		return {
			target: bottleNo,
			type: 'bottle',
			status: 'failed',
			id: current._id,
			msg: `启用失败: ${JSON.stringify(res)}`
		}
	}
	return {
		target: bottleNo,
		type: 'bottle',
		status: 'activated',
		id: current._id,
		msg: '钢瓶档案已启用'
	}
}

async function ensureVehicleActive(client, token, plateNo, execute) {
	const current = await listVehicleByPlate(client, token, plateNo)
	if (!current) {
		if (!execute) {
			return {
				target: plateNo,
				type: 'vehicle',
				status: 'would_create',
				msg: '预检命中缺失车辆档案，将创建并启用'
			}
		}
		const createRes = await client.callFunction('crm-vehicle', {
			action: 'createV1',
			token,
			data: {
				plate_no: plateNo,
				remark: 'import_new gas-in auto-created 2026-03-29'
			},
			request_id: generateRequestId()
		})
		if (!createRes || createRes.code !== 0) {
			return {
				target: plateNo,
				type: 'vehicle',
				status: 'failed',
				msg: `创建失败: ${JSON.stringify(createRes)}`
			}
		}
		return {
			target: plateNo,
			type: 'vehicle',
			status: 'created',
			id: createRes.data && createRes.data._id,
			msg: '车辆档案已创建并启用'
		}
	}
	if (current.is_active !== false) {
		return {
			target: plateNo,
			type: 'vehicle',
			status: 'noop',
			id: current._id,
			msg: '车辆档案已启用'
		}
	}
	if (!execute) {
		return {
			target: plateNo,
			type: 'vehicle',
			status: 'would_activate',
			id: current._id,
			msg: '预检命中禁用车辆档案，将启用'
		}
	}
	const updateRes = await client.callFunction('crm-vehicle', {
		action: 'updateV1',
		token,
		data: {
			_id: current._id,
			is_active: true
		},
		request_id: generateRequestId()
	})
	if (!updateRes || updateRes.code !== 0) {
		return {
			target: plateNo,
			type: 'vehicle',
			status: 'failed',
			id: current._id,
			msg: `启用失败: ${JSON.stringify(updateRes)}`
		}
	}
	return {
		target: plateNo,
		type: 'vehicle',
		status: 'activated',
		id: current._id,
		msg: '车辆档案已启用'
	}
}

function writeReport(reportPath, payload) {
	ensureDir(reportPath)
	fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function run() {
	const options = parseArgs(process.argv)
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
	const actions = []
	actions.push(await activateBottle(client, crmToken, TARGET_BOTTLE_NO, options.execute))
	for (let i = 0; i < TARGET_PLATES.length; i += 1) {
		actions.push(await ensureVehicleActive(client, crmToken, TARGET_PLATES[i], options.execute))
	}

	const summary = actions.reduce(
		(acc, item) => {
			acc.total += 1
			acc[item.status] = Number(acc[item.status] || 0) + 1
			return acc
		},
		{ total: 0 }
	)
	const report = {
		executed_at: new Date().toISOString(),
		space_id: options.spaceId,
		mode: options.execute ? 'execute' : 'dry-run',
		summary,
		actions
	}
	const reportPath = path.resolve(process.cwd(), options.report)
	writeReport(reportPath, report)
	console.log(`报告已写入: ${reportPath}`)
	console.log(JSON.stringify(summary, null, 2))
}

run().catch((err) => {
	console.error('[fixImportNewArchives] failed:', err && err.stack ? err.stack : err)
	process.exit(1)
})
