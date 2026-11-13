'use strict'

// Signed calls to the production Alipay uniCloud space for read-only probes run on
// the operator's Mac (keys come from the local HBuilderX setting.json).
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const text = (v) => (v == null ? '' : String(v).trim())

function defaultCredentials() {
	try {
		const src = fs.readFileSync(path.join(__dirname, '..', 'missingFillBackfill20261111.cjs'), 'utf8')
		return { username: (src.match(/username:\s*'([^']+)'/) || [])[1] || '', password: (src.match(/password:\s*'([^']+)'/) || [])[1] || '' }
	} catch (_) {
		return { username: '', password: '' }
	}
}

function loadAlipayConfig(spaceId) {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	const files = fs.existsSync(base) ? fs.readdirSync(base).map((d) => path.join(base, d, 'setting.json')).filter((f) => fs.existsSync(f)) : []
	const find = (node) => {
		if (Array.isArray(node)) { for (const n of node) { const f = find(n); if (f) return f } return null }
		if (!node || typeof node !== 'object') return null
		if (node.spaceid === spaceId && node.accessKey && node.secretKey && node.spaceAppId) return node
		for (const v of Object.values(node)) { const f = find(v); if (f) return f }
		return null
	}
	for (const file of files) {
		try {
			const space = find(JSON.parse(fs.readFileSync(file, 'utf8')))
			if (space) return { spaceId, accessKey: text(space.accessKey), secretKey: text(space.secretKey), spaceAppId: text(space.spaceAppId),
				endpoint: text(space.apiEndpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn` }
		} catch (_) {}
	}
	throw new Error(`未找到空间 ${spaceId} 的支付宝密钥配置`)
}

const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const hmacHex = (s, k) => crypto.createHmac('sha256', k).update(String(s)).digest('hex')
const uuid = () => crypto.randomUUID()

async function invoke(cfg, functionName, body) {
	const timestamp = String(Date.now())
	const requestId = uuid()
	const headers = {
		'x-from-app-id': cfg.spaceAppId, 'x-from-env-id': cfg.spaceId, 'x-to-env-id': cfg.spaceId, 'x-from-instance-id': timestamp,
		'x-from-function-name': functionName, 'x-to-function-name': functionName, 'x-client-timestamp': timestamp,
		'x-alipay-source': 'client', 'x-request-id': requestId, 'x-alipay-callid': requestId, 'x-trace-id': requestId
	}
	const signed = ['x-client-timestamp', 'x-from-app-id', 'x-from-env-id', 'x-from-function-name', 'x-from-instance-id', 'x-to-function-name', 'x-to-env-id'].sort()
	const bodyText = JSON.stringify(body || {})
	const canonical = `POST\n/functions/invokeFunction\n\n${signed.map((k) => `${k}:${headers[k] || ''}\n`).join('')}\n${signed.join(';')}\n${sha256Hex(bodyText)}\n`
	const signature = hmacHex(`HMAC-SHA256\n${timestamp}\n${sha256Hex(canonical)}\n`, cfg.secretKey)
	const res = await fetch(`${cfg.endpoint.replace(/\/+$/, '')}/functions/invokeFunction`, {
		method: 'POST',
		headers: { ...headers, Authorization: `HMAC-SHA256 Credential=${cfg.accessKey}, SignedHeaders=${signed.join(';')}, Signature=${signature}`, 'content-type': 'application/json' },
		body: bodyText
	})
	const raw = await res.text()
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`)
	return raw ? JSON.parse(raw) : {}
}

async function connect({ spaceId = 'env-00jxuffegf2n', username, password } = {}) {
	const fallback = defaultCredentials()
	const user = text(username) || text(process.env.CRM_USERNAME) || fallback.username
	const pass = text(password) || text(process.env.CRM_PASSWORD) || fallback.password
	if (!user || !pass) throw new Error('缺少登录账号，请用 --username/--password 或 CRM_USERNAME/CRM_PASSWORD 提供')
	const cfg = loadAlipayConfig(spaceId)
	const reqId = () => `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
	const login = await invoke(cfg, 'crm-auth', { action: 'login', data: { username: user, password: pass }, request_id: reqId() })
	if (!login || login.code !== 0) throw new Error(`登录失败: ${JSON.stringify(login).slice(0, 300)}`)
	const token = login.token || login.user?.token || login.data?.token || login.data?.user?.token || ''
	async function call(name, action, data, { allowFail = false } = {}) {
		const res = await invoke(cfg, name, { action, token, data, request_id: reqId() })
		if (!res || res.code !== 0) {
			if (allowFail) return res
			throw new Error(`${name}.${action} 失败: ${JSON.stringify(res).slice(0, 300)}`)
		}
		return res
	}
	// Complete pagination of crm-log; `complete` is false if any page-shift gap was detected.
	// Uses a reconciliation sweep: after reaching the end we re-read page 1 to catch rows
	// that were inserted while we were paging (they shift earlier rows down into already-read pages).
	async function logs(action, since, until, maxPages = 400) {
		const byId = new Map()
		let total = null
		let reachedEnd = false
		for (let page = 1; page <= maxPages; page += 1) {
			const res = await call('crm-log', 'listOperationLogsV1', { action, dateStart: since, dateEnd: until, page, pageSize: 200 })
			if (res.paging?.total != null) total = Number(res.paging.total)
			const rows = Array.isArray(res.data) ? res.data : []
			for (const row of rows) byId.set(row._id, row)
			if (!res.paging?.hasMore || !rows.length) { reachedEnd = true; break }
		}
		if (reachedEnd) {
			// Reconciliation sweep: re-read the first page to catch any rows inserted
			// during paging that shifted earlier rows off the pages we already read.
			const sweep = await call('crm-log', 'listOperationLogsV1', { action, dateStart: since, dateEnd: until, page: 1, pageSize: 200 })
			const sweepRows = Array.isArray(sweep.data) ? sweep.data : []
			for (const row of sweepRows) byId.set(row._id, row)
			if (sweep.paging?.total != null) total = Number(sweep.paging.total)
		}
		const knownTotal = total ?? byId.size
		return { rows: [...byId.values()], total: knownTotal, complete: reachedEnd && byId.size >= knownTotal }
	}
	async function all(name, action, data, maxPages = 100) {
		const rows = []
		let total = null
		for (let page = 1; page <= maxPages; page += 1) {
			const res = await call(name, action, { ...data, page, pageSize: 200 })
			const list = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.list) ? res.data.list : []
			rows.push(...list)
			total = Number(res.paging?.total ?? res.total ?? total ?? 0)
			const more = res.paging ? res.paging.hasMore : rows.length < total
			if (!more || !list.length) return { rows, total, complete: total == null || rows.length >= total }
		}
		return { rows, total, complete: false }
	}
	return { call, logs, all, spaceId }
}

module.exports = { connect, text }
