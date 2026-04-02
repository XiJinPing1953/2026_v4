#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_REPORT = 'docs/filling.orphan_fill_cleanup.report.json'

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function parseArgs(argv) {
	const out = {
		execute: false,
		skipBackup: false,
		spaceId: '',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		scanLimit: 20000,
		runId: '',
		report: DEFAULT_REPORT
	}
	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--execute') {
			out.execute = true
			continue
		}
		if (cur === '--skip-backup') {
			out.skipBackup = true
			continue
		}
		if (cur === '--space-id' && next) {
			out.spaceId = normalizeString(next)
			i += 1
			continue
		}
		if (cur === '--username' && next) {
			out.username = normalizeString(next) || out.username
			i += 1
			continue
		}
		if (cur === '--password' && next) {
			out.password = normalizeString(next) || out.password
			i += 1
			continue
		}
		if (cur === '--scan-limit' && next) {
			const n = Number(next)
			if (Number.isFinite(n) && n > 0) out.scanLimit = Math.floor(n)
			i += 1
			continue
		}
		if (cur === '--run-id' && next) {
			out.runId = normalizeString(next)
			i += 1
			continue
		}
		if (cur === '--report' && next) {
			out.report = next
			i += 1
			continue
		}
		if (cur === '--help' || cur === '-h') {
			printHelp()
			process.exit(0)
		}
	}
	if (!out.spaceId) out.spaceId = normalizeString(process.env.SPACE_ID)
	if (!out.spaceId) throw new Error('缺少 --space-id')
	return out
}

function printHelp() {
	console.log(`
Usage:
  node scripts/runCleanupOrphanFillMovements.cjs --space-id env-xxx [--execute]

Options:
  --execute             真正执行（默认仅预览）
  --skip-backup         执行时跳过备份（高风险，不可回滚）
  --space-id <id>       空间 ID（必填）
  --username <name>     登录用户名（默认 superadmin）
  --password <pass>     登录密码
  --scan-limit <n>      扫描上限（默认 20000）
  --run-id <id>         指定 run_id（可选）
  --report <path>       报告输出路径（默认 ${DEFAULT_REPORT}）
`)
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
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
	return res.token || (res.user && res.user.token) || ''
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

async function run() {
	const args = parseArgs(process.argv)
	const conf = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(conf)
	const token = await login(client, args.username, args.password)
	const startedAt = new Date().toISOString()

	const previewRes = await callCrm(client, token, 'crm-filling', 'cleanupOrphanFillMovementsV1', {
		preview: true,
		scan_limit: args.scanLimit,
		skip_backup: args.skipBackup,
		run_id: args.runId || undefined
	})
	const previewData = previewRes.data || {}
	console.log(
		`预览：orphan=${Number(previewData.orphan_total || 0)}，可删=${Number(previewData.orphan_with_legacy_pair_total || 0)}，跳过=${Number(previewData.orphan_without_legacy_pair_total || 0)}，影响瓶数=${Number(previewData.touched_bottle_total || 0)}`
	)

	let executeRes = null
	if (args.execute) {
		executeRes = await callCrm(client, token, 'crm-filling', 'cleanupOrphanFillMovementsV1', {
			preview: false,
			scan_limit: args.scanLimit,
			skip_backup: args.skipBackup,
			run_id: normalizeString(previewData.run_id) || args.runId || undefined
		})
		const d = executeRes.data || {}
		console.log(
			`执行完成：removed=${Number(d.removed || 0)}，backup=${Number(d.backed_up || 0)}，touch_warning=${normalizeString(d.touch_warning) || '-'}`
		)
	}

	const report = {
		started_at: startedAt,
		finished_at: new Date().toISOString(),
		space_id: args.spaceId,
		config_from: conf.from,
		mode: args.execute ? 'execute' : 'dry-run',
		skip_backup: args.skipBackup,
		preview: previewData,
		execute: executeRes ? executeRes.data || {} : null
	}
	const reportPath = path.resolve(process.cwd(), args.report || DEFAULT_REPORT)
	ensureDir(reportPath)
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
	console.log(`报告已写入: ${reportPath}`)
}

run().catch((err) => {
	console.error('[runCleanupOrphanFillMovements] FAIL', err && err.message ? err.message : err)
	process.exitCode = 1
})
