#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_REPORT = 'docs/filling.no_sale_cleanup.report.json'

function normalizeText(value) {
	if (value == null) return ''
	return String(value).trim()
}

function parseArgs(argv) {
	const args = {
		execute: false,
		report: DEFAULT_REPORT,
		spaceId: process.env.UNI_SPACE_ID || '',
		clientSecret: process.env.UNI_CLIENT_SECRET || '',
		endpoint: process.env.UNI_ENDPOINT || '',
		crmToken: process.env.CRM_TOKEN || '',
		crmUsername: process.env.CRM_USERNAME || 'superadmin',
		crmPassword: process.env.CRM_PASSWORD || 'y7ez5CGAbivZkeP',
		scanLimit: 5000,
		runId: ''
	}

	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--execute') {
			args.execute = true
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
		} else if (cur === '--scan-limit' && next) {
			const limit = Number(next)
			if (Number.isFinite(limit) && limit > 0) args.scanLimit = Math.floor(limit)
			i += 1
		} else if (cur === '--run-id' && next) {
			args.runId = normalizeText(next)
			i += 1
		} else if (cur === '--report' && next) {
			args.report = next
			i += 1
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
  node scripts/cleanupNoSaleMovements.cjs [options]

Options:
  --execute               真正执行（默认仅预览）
  --space-id <id>         uniCloud space id（或 UNI_SPACE_ID）
  --client-secret <sec>   uniCloud client secret（或 UNI_CLIENT_SECRET）
  --endpoint <url>        uniCloud endpoint（可选）
  --crm-token <token>     CRM token（可选）
  --crm-username <name>   CRM 用户名（默认 superadmin）
  --crm-password <pass>   CRM 密码（默认读取脚本内回退）
  --scan-limit <n>        预览扫描上限（默认 5000）
  --run-id <id>           指定 run_id（可选）
  --report <path>         报告输出路径（默认 ${DEFAULT_REPORT}）

Examples:
  node scripts/cleanupNoSaleMovements.cjs
  node scripts/cleanupNoSaleMovements.cjs --execute --space-id env-xxx --client-secret xxx
`)
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
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
	if (node.spaceid === spaceId && node.clientSecret) return node
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
	for (let i = 0; i < files.length; i += 1) {
		try {
			const raw = JSON.parse(fs.readFileSync(files[i], 'utf8'))
			const found = deepFindSpace(raw, spaceId)
			if (found) {
				return {
					clientSecret: normalizeText(found.clientSecret),
					endpoint: normalizeText(found.apiEndpoint),
					from: files[i]
				}
			}
		} catch (err) {
			// ignore broken setting files
		}
	}
	return null
}

function hmacMd5(text, key) {
	return crypto.createHmac('md5', key).update(text).digest('hex')
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
		} catch (err) {
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
			} catch (err) {
				return { raw: result }
			}
		}
		return result
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

async function run() {
	const options = parseArgs(process.argv)
	const loadedSpace = tryLoadSpaceConfig(options.spaceId)
	if (!options.clientSecret && loadedSpace) options.clientSecret = loadedSpace.clientSecret
	if (!options.endpoint && loadedSpace) options.endpoint = loadedSpace.endpoint
	if (!options.spaceId) throw new Error('缺少 spaceId，请用 --space-id 提供')
	if (!options.clientSecret) throw new Error('缺少 clientSecret，请用 --client-secret 提供')

	console.log(`模式: ${options.execute ? 'EXECUTE（写入）' : 'DRY-RUN（预览）'}`)
	console.log(`空间: ${options.spaceId}`)
	if (loadedSpace && loadedSpace.from) console.log(`已自动加载空间配置: ${loadedSpace.from}`)

	const client = new UniCloudHttpClient({
		spaceId: options.spaceId,
		clientSecret: options.clientSecret,
		endpoint: options.endpoint
	})
	const crmToken = await ensureCrmToken(client, options)
	const startedAt = new Date().toISOString()

	const previewRes = await client.callFunction('crm-filling', {
		action: 'cleanupNoSaleMovementsV1',
		token: crmToken,
		request_id: generateRequestId(),
		data: {
			preview: true,
			scan_limit: options.scanLimit,
			run_id: options.runId || undefined
		}
	})
	if (!previewRes || previewRes.code !== 0) {
		throw new Error(`预览失败: ${JSON.stringify(previewRes)}`)
	}

	const report = {
		started_at: startedAt,
		finished_at: '',
		mode: options.execute ? 'execute' : 'dry-run',
		preview: previewRes.data || {},
		execute: null
	}

	console.log(
		`预览：no_sale=${Number(previewRes?.data?.filling_total || 0)}，movement=${Number(previewRes?.data?.movement_total || 0)}，待触发重算瓶数=${Number(previewRes?.data?.touched_bottle_total || 0)}`
	)

	if (options.execute) {
		const runId = normalizeText(previewRes?.data?.run_id)
		const executeRes = await client.callFunction('crm-filling', {
			action: 'cleanupNoSaleMovementsV1',
			token: crmToken,
			request_id: generateRequestId(),
			data: {
				preview: false,
				scan_limit: options.scanLimit,
				run_id: runId || undefined
			}
		})
		if (!executeRes || executeRes.code !== 0) {
			throw new Error(`执行失败: ${JSON.stringify(executeRes)}`)
		}
		report.execute = executeRes.data || {}
		console.log(
			`执行完成：removed=${Number(executeRes?.data?.removed || 0)}，backup=${Number(executeRes?.data?.backed_up || 0)}，run_id=${normalizeText(executeRes?.data?.run_id)}`
		)
		console.log(`备份集合：${normalizeText(executeRes?.data?.backup_collection)}`)
	}

	report.finished_at = new Date().toISOString()
	const reportPath = path.resolve(process.cwd(), options.report)
	ensureDir(reportPath)
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
	console.log(`报告已输出：${reportPath}`)
}

run().catch((err) => {
	console.error(`执行失败: ${err.message}`)
	process.exit(1)
})
