#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

function parseArgs(argv) {
	const args = {
		spaceId: process.env.UNI_SPACE_ID || '',
		username: process.env.CRM_USERNAME || 'superadmin',
		password: process.env.CRM_PASSWORD || 'y7ez5CGAbivZkeP',
		scanLimit: 12000,
		maxUpdates: 300,
		maxRounds: 30,
		sampleLimit: 10,
		output: 'docs/filling.normalize_dates.loop.execute.json'
	}
	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if ((cur === '--space-id' || cur === '-s') && next) {
			args.spaceId = next
			i += 1
		} else if (cur === '--username' && next) {
			args.username = next
			i += 1
		} else if (cur === '--password' && next) {
			args.password = next
			i += 1
		} else if (cur === '--scan-limit' && next) {
			const n = Number(next)
			if (Number.isFinite(n) && n > 0) args.scanLimit = Math.floor(n)
			i += 1
		} else if (cur === '--max-updates' && next) {
			const n = Number(next)
			if (Number.isFinite(n) && n > 0) args.maxUpdates = Math.floor(n)
			i += 1
		} else if (cur === '--max-rounds' && next) {
			const n = Number(next)
			if (Number.isFinite(n) && n > 0) args.maxRounds = Math.floor(n)
			i += 1
		} else if (cur === '--sample-limit' && next) {
			const n = Number(next)
			if (Number.isFinite(n) && n > 0) args.sampleLimit = Math.floor(n)
			i += 1
		} else if ((cur === '--output' || cur === '-o') && next) {
			args.output = next
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
  node scripts/runFillingNormalizeDatesLoop.cjs --space-id env-xxx [options]

Options:
  --space-id, -s <id>      space id (required if UNI_SPACE_ID not set)
  --username <name>        CRM login username (default superadmin)
  --password <pass>        CRM login password
  --scan-limit <n>         normalizeDatesV1 scan_limit (default 12000)
  --max-updates <n>        normalizeDatesV1 max_updates per round (default 300)
  --max-rounds <n>         max loop rounds (default 30)
  --sample-limit <n>       normalizeDatesV1 sample_limit (default 10)
  --output, -o <path>      output report path (default docs/filling.normalize_dates.loop.execute.json)
`)
}

function normalizeText(v) {
	return v == null ? '' : String(v).trim()
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	return fs
		.readdirSync(base)
		.map((dir) => path.join(base, dir, 'setting.json'))
		.filter((file) => fs.existsSync(file))
}

function deepFindAlipaySpace(node, spaceId) {
	if (!node || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i += 1) {
			const found = deepFindAlipaySpace(node[i], spaceId)
			if (found) return found
		}
		return null
	}
	if (normalizeText(node.spaceid) === spaceId && node.accessKey && node.secretKey && node.spaceAppId) {
		return {
			spaceid: normalizeText(node.spaceid),
			accessKey: normalizeText(node.accessKey),
			secretKey: normalizeText(node.secretKey),
			spaceAppId: normalizeText(node.spaceAppId),
			apiEndpoint: normalizeText(node.apiEndpoint)
		}
	}
	const values = Object.values(node)
	for (let i = 0; i < values.length; i += 1) {
		const found = deepFindAlipaySpace(values[i], spaceId)
		if (found) return found
	}
	return null
}

function loadAlipaySpaceConfig(spaceId) {
	const files = listProjectSettingFiles()
	for (let i = 0; i < files.length; i += 1) {
		try {
			const raw = JSON.parse(fs.readFileSync(files[i], 'utf8'))
			const found = deepFindAlipaySpace(raw, spaceId)
			if (found) return { ...found, from: files[i] }
		} catch (_) {
			// ignore bad JSON
		}
	}
	return null
}

function sha256Hex(text) {
	return crypto.createHash('sha256').update(String(text)).digest('hex')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', key).update(String(text)).digest('hex')
}

function uuidV4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

function splitPathQuery(urlPath) {
	const idx = String(urlPath).indexOf('?')
	if (idx < 0) return [String(urlPath), '']
	return [urlPath.slice(0, idx), urlPath.slice(idx + 1)]
}

function signRequest(pathWithQuery, { data = {}, method = 'POST', functionName = '', headers = {}, signHeaderKeys = [], config }) {
	const timestamp = String(Date.now())
	const requestId = uuidV4()
	const mergedHeaders = {
		...headers,
		'x-from-app-id': config.spaceAppId,
		'x-from-env-id': config.spaceid,
		'x-to-env-id': config.spaceid,
		'x-from-instance-id': timestamp,
		'x-from-function-name': functionName,
		'x-client-timestamp': timestamp,
		'x-alipay-source': 'client',
		'x-request-id': requestId,
		'x-alipay-callid': requestId,
		'x-trace-id': requestId
	}

	const signedHeaders = [
		'x-from-app-id',
		'x-from-env-id',
		'x-to-env-id',
		'x-from-instance-id',
		'x-from-function-name',
		'x-client-timestamp',
		...signHeaderKeys
	].sort()

	const [pathname, query] = splitPathQuery(pathWithQuery)
	const canonicalHeaderLines = signedHeaders
		.map((k) => `${k.toLowerCase()}:${mergedHeaders[k] || ''}\n`)
		.join('')

	const bodyText = JSON.stringify(data || {})
	const bodyHash = sha256Hex(bodyText)
	const canonicalRequest = `${String(method).toUpperCase()}\n${pathname}\n${query}\n${canonicalHeaderLines}\n${signedHeaders.join(';')}\n${bodyHash}\n`
	const canonicalHash = sha256Hex(canonicalRequest)
	const stringToSign = `HMAC-SHA256\n${timestamp}\n${canonicalHash}\n`
	const signature = hmacSha256Hex(stringToSign, config.secretKey)
	const authorization = `HMAC-SHA256 Credential=${config.accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
	const finalHeaders = {
		...mergedHeaders,
		Authorization: authorization,
		'content-type': 'application/json'
	}
	const endpoint = (config.apiEndpoint || `https://${config.spaceid}.api-hz.cloudbasefunction.cn`).replace(/\/+$/, '')
	return {
		url: `${endpoint}${pathname}${query ? `?${query}` : ''}`,
		headers: finalHeaders,
		bodyText
	}
}

async function invokeFunction(config, functionName, payload) {
	const signed = signRequest('/functions/invokeFunction', {
		data: payload,
		method: 'POST',
		functionName,
		headers: { 'x-to-function-name': functionName },
		signHeaderKeys: ['x-to-function-name'],
		config
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
		throw new Error(`响应非JSON status=${res.status}: ${text.slice(0, 200)}`)
	}
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`)
	}
	return json
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function run() {
	const options = parseArgs(process.argv)
	if (!options.spaceId) throw new Error('缺少 --space-id')
	const config = loadAlipaySpaceConfig(options.spaceId)
	if (!config) throw new Error(`未找到 space=${options.spaceId} 的支付宝空间配置`)

	const loginRes = await invokeFunction(config, 'crm-auth', {
		action: 'login',
		data: {
			username: options.username,
			password: options.password
		},
		request_id: generateRequestId()
	})
	if (!loginRes || loginRes.code !== 0) {
		throw new Error(`登录失败: ${JSON.stringify(loginRes)}`)
	}
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error('登录成功但无 token')

	const rounds = []
	for (let round = 1; round <= options.maxRounds; round += 1) {
		const previewRes = await invokeFunction(config, 'crm-filling', {
			action: 'normalizeDatesV1',
			token,
			data: {
				preview: true,
				scan_limit: options.scanLimit,
				max_updates: options.maxUpdates,
				sample_limit: options.sampleLimit
			},
			request_id: generateRequestId()
		})
		if (!previewRes || previewRes.code !== 0) {
			throw new Error(`第 ${round} 轮预览失败: ${JSON.stringify(previewRes)}`)
		}
		const candidateTotal = Number(previewRes?.data?.candidate_total || 0)
		rounds.push({
			round,
			phase: 'preview',
			scanned_total: Number(previewRes?.data?.scanned_total || 0),
			candidate_total: candidateTotal,
			to_execute: Number(previewRes?.data?.to_execute || 0),
			pending_total: Number(previewRes?.data?.pending_total || 0)
		})
		console.log(`[round ${round}] preview candidate=${candidateTotal}`)
		if (candidateTotal <= 0) break

		const executeRes = await invokeFunction(config, 'crm-filling', {
			action: 'normalizeDatesV1',
			token,
			data: {
				preview: false,
				scan_limit: options.scanLimit,
				max_updates: options.maxUpdates,
				sample_limit: options.sampleLimit
			},
			request_id: generateRequestId()
		})
		if (!executeRes || executeRes.code !== 0) {
			throw new Error(`第 ${round} 轮执行失败: ${JSON.stringify(executeRes)}`)
		}
		rounds.push({
			round,
			phase: 'execute',
			success: Number(executeRes?.data?.success || 0),
			failed: Number(executeRes?.data?.failed || 0),
			execute_total: Number(executeRes?.data?.execute_total || 0),
			pending_total: Number(executeRes?.data?.pending_total || 0),
			has_more: Boolean(executeRes?.data?.has_more)
		})
		console.log(
			`[round ${round}] execute success=${Number(executeRes?.data?.success || 0)} failed=${Number(executeRes?.data?.failed || 0)} pending=${Number(executeRes?.data?.pending_total || 0)}`
		)
	}

	const finalPreview = await invokeFunction(config, 'crm-filling', {
		action: 'normalizeDatesV1',
		token,
		data: {
			preview: true,
			scan_limit: options.scanLimit,
			max_updates: options.maxUpdates,
			sample_limit: options.sampleLimit
		},
		request_id: generateRequestId()
	})

	const report = {
		space_id: options.spaceId,
		scan_limit: options.scanLimit,
		max_updates: options.maxUpdates,
		max_rounds: options.maxRounds,
		rounds,
		final_preview: finalPreview,
		finished_at: new Date().toISOString()
	}
	const outputPath = path.resolve(process.cwd(), options.output)
	ensureDir(outputPath)
	fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
	console.log(
		JSON.stringify(
			{
				final_candidate_total: Number(finalPreview?.data?.candidate_total || 0),
				output: outputPath
			},
			null,
			2
		)
	)
}

run().catch((err) => {
	console.error(err && err.message ? err.message : String(err))
	process.exit(1)
})
