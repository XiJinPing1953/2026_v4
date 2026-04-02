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

function parseArgs(argv) {
	const out = {
		spaceId: '',
		execute: false,
		rebuild: true,
		cleanupDuplicates: false,
		cleanupMaxRows: 20000,
		checkBottle: '',
		maxRounds: 60,
		batchBottlesPerRound: 25,
		maxMsPerRound: 2800,
		maxEventsPerRound: 900,
		maxWritesPerRound: 220,
		batchSize: 180,
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP'
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		if (!arg) continue
		if (arg === '--execute') {
			out.execute = true
			continue
		}
		if (arg === '--dry-run') {
			out.execute = false
			continue
		}
		if (arg === '--no-rebuild') {
			out.rebuild = false
			continue
		}
		if (arg === '--cleanup-duplicates') {
			out.cleanupDuplicates = true
			continue
		}
		const m = arg.match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'space-id') out.spaceId = normalizeString(value)
		if (key === 'cleanup-max-rows') out.cleanupMaxRows = Math.max(1000, Number(value) || out.cleanupMaxRows)
		if (key === 'check-bottle') out.checkBottle = normalizeString(value)
		if (key === 'max-rounds') out.maxRounds = Math.max(1, Number(value) || out.maxRounds)
		if (key === 'batch-bottles-per-round') out.batchBottlesPerRound = Math.max(1, Number(value) || out.batchBottlesPerRound)
		if (key === 'max-ms-per-round') out.maxMsPerRound = Math.max(400, Number(value) || out.maxMsPerRound)
		if (key === 'max-events-per-round') out.maxEventsPerRound = Math.max(50, Number(value) || out.maxEventsPerRound)
		if (key === 'max-writes-per-round') out.maxWritesPerRound = Math.max(10, Number(value) || out.maxWritesPerRound)
		if (key === 'batch-size') out.batchSize = Math.max(20, Number(value) || out.batchSize)
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
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
				endpoint: normalizeString(space.apiEndpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`,
				from: file
			}
			if (config.accessKey && config.secretKey && config.spaceAppId) return config
		} catch (_) {
			// ignore
		}
	}
	throw new Error(`未在 HBuilderX setting.json 中找到空间 ${spaceId} 的支付宝密钥配置`)
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
		const json = text ? JSON.parse(text) : {}
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: ${text}`)
		}
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
	if (!res || res.code !== 0) {
		throw new Error(`登录失败: ${JSON.stringify(res)}`)
	}
	return res.token || (res.user && res.user.token) || ''
}

async function callCrmFunction(client, token, functionName, action, data) {
	const res = await client.callFunction(functionName, {
		action,
		token,
		data,
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) {
		throw new Error(`${functionName}.${action} 失败: ${JSON.stringify(res)}`)
	}
	return res
}

async function fetchAnomalySummary(client, token) {
	const res = await callCrmFunction(client, token, 'crm-bottle-anomaly', 'listV1', {
		status: '',
		page: 1,
		pageSize: 1,
		summary_ignore_status: true
	})
	const summary = res.summary || {}
	return {
		total: Number(summary.total || 0),
		open: Number(summary.open || 0),
		resolved: Number(summary.resolved || 0)
	}
}

async function runRebuild(client, token, args) {
	let rounds = 0
	let done = false
	let cursor = null
	const total = {
		rounds: 0,
		bottles: 0,
		scanned_events: 0,
		created: 0,
		resolved_stale: 0,
		elapsed_ms: 0,
		done: false
	}

	while (!done && rounds < args.maxRounds) {
		const res = await callCrmFunction(client, token, 'crm-bottle-anomaly', 'rebuildV2', {
			cursor,
			batch_bottles_per_round: args.batchBottlesPerRound,
			max_ms_per_round: args.maxMsPerRound,
			max_events_per_round: args.maxEventsPerRound,
			max_writes_per_round: args.maxWritesPerRound,
			batch_size: args.batchSize
		})
		const payload = res.data || {}
		rounds += 1
		total.rounds = rounds
		total.bottles += Number(payload.round_bottles || 0)
		total.scanned_events += Number(payload.round_scanned_events || 0)
		total.created += Number(payload.round_created || 0)
		total.resolved_stale += Number(payload.round_resolved_stale || 0)
		total.elapsed_ms += Number(payload.elapsed_ms || 0)
		done = Boolean(payload.done)
		cursor = payload.cursor || null
		if (!done && !cursor) break
	}

	total.done = done
	total.cursor = cursor
	return total
}

async function runCleanupDuplicates(client, token, args) {
	const preview = await callCrmFunction(client, token, 'crm-bottle-anomaly', 'cleanupDuplicatesV1', {
		execute: false,
		max_rows: args.cleanupMaxRows
	})
	const out = {
		preview: preview.data || null,
		execute: null
	}
	if (!args.execute) return out
	const executeRes = await callCrmFunction(client, token, 'crm-bottle-anomaly', 'cleanupDuplicatesV1', {
		execute: true,
		max_rows: args.cleanupMaxRows,
		confirm_text: 'DELETE_DUPLICATE_BOTTLE_ANOMALIES'
	})
	out.execute = executeRes.data || null
	return out
}

async function main() {
	const args = parseArgs(process.argv)
	const config = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(config)
	const token = await login(client, args.username, args.password)

	const before = await fetchAnomalySummary(client, token)
	const purgePreview = await callCrmFunction(client, token, 'crm-bottle-anomaly', 'purgeV1', {
		execute: false
	})

	const out = {
		space_id: args.spaceId,
		config_from: config.from,
		execute: args.execute,
		before,
		cleanup_duplicates: null,
		purge_preview: purgePreview.data || null,
		purge_execute: null,
		rebuild: null,
		after: null,
		check_bottle: null
	}

	if (args.cleanupDuplicates) {
		out.cleanup_duplicates = await runCleanupDuplicates(client, token, args)
		out.after = await fetchAnomalySummary(client, token)
	} else if (args.execute) {
		const purgeExecute = await callCrmFunction(client, token, 'crm-bottle-anomaly', 'purgeV1', {
			execute: true,
			confirm_text: 'CLEAR_ALL_BOTTLE_ANOMALIES'
		})
		out.purge_execute = purgeExecute.data || null

		if (args.rebuild) {
			out.rebuild = await runRebuild(client, token, args)
		}
		out.after = await fetchAnomalySummary(client, token)
	}

	if (args.checkBottle) {
		const checkRes = await callCrmFunction(client, token, 'crm-bottle-anomaly', 'listV1', {
			bottle_no: args.checkBottle,
			status: '',
			page: 1,
			pageSize: 20,
			summary_ignore_status: true
		})
		out.check_bottle = {
			bottle_no: args.checkBottle,
			total: Number(checkRes?.summary?.total || 0),
			open: Number(checkRes?.summary?.open || 0),
			resolved: Number(checkRes?.summary?.resolved || 0),
			items: Array.isArray(checkRes?.data) ? checkRes.data : []
		}
	}

	console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => {
	console.error('[resetBottleAnomalies] FAIL', err && err.message ? err.message : err)
	process.exit(1)
})
