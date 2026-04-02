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

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function round3(value) {
	const num = Number(value || 0)
	if (!Number.isFinite(num)) return 0
	return Math.round(num * 1000) / 1000
}

function parseArgs(argv) {
	const out = {
		spaceId: '',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		outFile: path.resolve(process.cwd(), 'docs/anomaly_cycle_typical_report.json')
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		const m = String(arg || '').match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'space-id') out.spaceId = normalizeString(value)
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
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

async function fetchAllAnomalies(client, token) {
	const pageSize = 50
	let page = 1
	let rows = []
	let total = 0
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-anomaly', 'listV1', {
			status: '',
			page,
			pageSize,
			summary_ignore_status: true
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows = rows.concat(list)
		total = Number(res?.paging?.total || res?.total || total || 0)
		if (!res?.paging?.hasMore || list.length === 0) break
		page += 1
		if (page > 400) break
	}
	return { rows, total }
}

async function fetchAllMovements(client, token) {
	const pageSize = 200
	let page = 1
	let rows = []
	let total = 0
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-movement', 'listV1', {
			page,
			pageSize
		})
		const list = Array.isArray(res.data) ? res.data : []
		rows = rows.concat(list)
		total = Number(res?.total || total || 0)
		if (list.length < pageSize || rows.length >= total) break
		page += 1
		if (page > 1000) break
	}
	return { rows, total }
}

function eventTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function sortEventAsc(a, b) {
	const aAt = Number(a?.event_at || a?.created_at || 0)
	const bAt = Number(b?.event_at || b?.created_at || 0)
	if (aAt !== bAt) return aAt - bAt
	const aOrder = Number(a?.type_order || eventTypeOrder(a?.type))
	const bOrder = Number(b?.type_order || eventTypeOrder(b?.type))
	if (aOrder !== bOrder) return aOrder - bOrder
	return Number(a?.created_at || 0) - Number(b?.created_at || 0)
}

function buildCycleRows(events) {
	const list = []
	const incomplete = []
	const activeByBottle = new Map()

	for (const row of events) {
		const bottleNo = normalizeBottleNo(row?.bottle_no)
		if (!bottleNo) continue
		const type = normalizeString(row?.type)
		if (!['back', 'fill', 'out'].includes(type)) continue

		let active = activeByBottle.get(bottleNo) || null
		if (type === 'back') {
			if (active && active.back) {
				incomplete.push({
					reason: 'back_without_out',
					bottle_no: bottleNo,
					event_day: normalizeString(active.back?.event_day || active.back?.date),
					detail: '回瓶后未找到对应出瓶（遇到新的回瓶）'
				})
			}
			activeByBottle.set(bottleNo, {
				back: row,
				fillSum: 0,
				fillCount: 0
			})
			continue
		}

		if (type === 'fill') {
			if (!active || !active.back) continue
			active.fillSum += toNumber(row?.net_weight, 0) || 0
			active.fillCount += 1
			activeByBottle.set(bottleNo, active)
			continue
		}

		if (!active || !active.back) {
			incomplete.push({
				reason: 'out_without_back',
				bottle_no: bottleNo,
				event_day: normalizeString(row?.event_day || row?.date),
				detail: '出瓶前未找到可配对回瓶'
			})
			continue
		}

		const backNet = toNumber(active.back?.net_weight, 0) || 0
		const fillSum = round3(active.fillSum)
		const outNet = toNumber(row?.net_weight, 0) || 0
		const theoretical = round3(backNet + fillSum)
		const delta = round3(theoretical - outNet)
		list.push({
			bottle_no: bottleNo,
			back_date: normalizeString(active.back?.date),
			out_date: normalizeString(row?.date),
			back_net_kg: round3(backNet),
			fill_sum_kg: round3(fillSum),
			out_net_kg: round3(outNet),
			theoretical_out_kg: round3(theoretical),
			delta_kg: round3(delta),
			result_type: delta > 0 ? 'loss' : delta < 0 ? 'swell' : 'exact'
		})
		activeByBottle.delete(bottleNo)
	}

	for (const [bottleNo, active] of activeByBottle.entries()) {
		if (active && active.back) {
			incomplete.push({
				reason: 'back_without_out',
				bottle_no: bottleNo,
				event_day: normalizeString(active.back?.event_day || active.back?.date),
				detail: '回瓶后直到查询结束仍未找到对应出瓶'
			})
		}
	}

	return { list, incomplete }
}

function pickFirst(arr, fn) {
	for (const item of arr) {
		if (fn(item)) return item
	}
	return null
}

function buildMissingFillCase(anomaly) {
	if (!anomaly) return null
	const ctx = anomaly.context && typeof anomaly.context === 'object' ? anomaly.context : {}
	const lastBack = ctx.last_back && typeof ctx.last_back === 'object' ? ctx.last_back : {}
	const nextOut = ctx.next_out && typeof ctx.next_out === 'object' ? ctx.next_out : {}
	const backNet = toNumber(lastBack.net, null)
	const outNet = toNumber(nextOut.net, null)
	const diff = backNet == null || outNet == null ? null : round3(outNet - backNet)
	return {
		anomaly_id: anomaly._id || '',
		status: normalizeString(anomaly.status) || 'open',
		bottle_no: normalizeBottleNo(anomaly.bottle_no),
		anomaly_date: normalizeString(anomaly.date),
		last_back_date: normalizeString(lastBack.date),
		last_back_net: backNet,
		next_out_date: normalizeString(nextOut.date),
		next_out_net: outNet,
		diff,
		note: normalizeString(anomaly.note),
		resolution_mode: normalizeString(ctx.resolution && ctx.resolution.mode)
	}
}

function mainSummary(anomalies, movements, cycles, incomplete, adjustRows) {
	const typeCount = {}
	for (const a of anomalies) {
		const t = normalizeString(a?.anomaly_type) || 'unknown'
		typeCount[t] = (typeCount[t] || 0) + 1
	}
	const cycleCount = { loss: 0, swell: 0, exact: 0 }
	let lossTotal = 0
	let swellTotal = 0
	for (const c of cycles) {
		if (c.result_type === 'loss') {
			cycleCount.loss += 1
			lossTotal += Number(c.delta_kg || 0)
		} else if (c.result_type === 'swell') {
			cycleCount.swell += 1
			swellTotal += Math.abs(Number(c.delta_kg || 0))
		} else {
			cycleCount.exact += 1
		}
	}
	return {
		anomaly_total: anomalies.length,
		movement_total: movements.length,
		anomaly_by_type: typeCount,
		cycle_total: cycles.length,
		cycle_result_count: cycleCount,
		cycle_loss_total_kg: round3(lossTotal),
		cycle_swell_total_kg: round3(swellTotal),
		incomplete_total: incomplete.length,
		manual_fix_adjust_total: adjustRows.length
	}
}

async function run() {
	const args = parseArgs(process.argv)
	const cfg = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(cfg)
	const token = await login(client, args.username, args.password)

	const anomalyData = await fetchAllAnomalies(client, token)
	const movementData = await fetchAllMovements(client, token)

	const anomalies = anomalyData.rows
	const movements = movementData.rows

	const missingFillRows = anomalies.filter((row) => normalizeString(row?.anomaly_type) === 'missing_fill')
	const missingFillCases = missingFillRows.map(buildMissingFillCase).filter(Boolean)

	const caseDiffLt0Le10 = pickFirst(missingFillCases, (x) => x.diff != null && x.diff < 0 && Math.abs(x.diff) <= 10)
	const caseDiffGt0 = pickFirst(missingFillCases, (x) => x.diff != null && x.diff > 0)
	const caseDiffAbsGt10 = pickFirst(missingFillCases, (x) => x.diff != null && Math.abs(x.diff) > 10)
	const caseDiffEq0 = pickFirst(missingFillCases, (x) => x.diff != null && x.diff === 0)

	const adjustRows = movements
		.filter((row) => normalizeString(row?.type) === 'adjust' && normalizeString(row?.source_type) === 'manual_fix')
		.filter((row) => {
			const reason = normalizeString(row?.adjust_reason).toLowerCase()
			const note = normalizeString(row?.note)
			if (reason === 'missing_fill_loss' || reason === 'missing_fill_loss_accept') return true
			return /缺灌装.*损耗|损耗.*缺灌装/.test(note)
		})
		.sort((a, b) => Number(b?.event_at || b?.created_at || 0) - Number(a?.event_at || a?.created_at || 0))

	const hasManualFixFill = movements.some(
		(row) => normalizeString(row?.type) === 'fill' && normalizeString(row?.source_type) === 'manual_fix'
	)

	const cycleEvents = movements
		.filter((row) => ['back', 'fill', 'out'].includes(normalizeString(row?.type)))
		.sort(sortEventAsc)
	const cycleRes = buildCycleRows(cycleEvents)
	const cycles = cycleRes.list
	const incomplete = cycleRes.incomplete

	const sampleLoss = pickFirst(cycles, (x) => x.result_type === 'loss')
	const sampleSwell = pickFirst(cycles, (x) => x.result_type === 'swell')
	const sampleExact = pickFirst(cycles, (x) => x.result_type === 'exact')
	const sampleIncompleteOut = pickFirst(incomplete, (x) => x.reason === 'out_without_back')
	const sampleIncompleteBack = pickFirst(incomplete, (x) => x.reason === 'back_without_out')

	const report = {
		generated_at: new Date().toISOString(),
		space_id: args.spaceId,
		config_from: cfg.from,
		summary: mainSummary(anomalies, movements, cycles, incomplete, adjustRows),
		conclusion_checks: {
			missing_fill_resolve_writes_adjust_not_fill: {
				has_manual_fix_adjust_rows: adjustRows.length > 0,
				has_manual_fix_fill_rows: hasManualFixFill,
				sample_adjust_rows: adjustRows.slice(0, 5).map((row) => ({
					_id: row._id,
					bottle_no: row.bottle_no,
					date: row.date,
					type: row.type,
					source_type: row.source_type,
					adjust_reason: row.adjust_reason,
					loss_weight: row.loss_weight,
					note: row.note
				}))
			},
			missing_fill_diff_typicals: {
				diff_lt0_le10: caseDiffLt0Le10,
				diff_gt0: caseDiffGt0,
				diff_abs_gt10: caseDiffAbsGt10,
				diff_eq0: caseDiffEq0
			},
			cycle_formula_typicals: {
				loss_case: sampleLoss,
				swell_case: sampleSwell,
				exact_case: sampleExact,
				incomplete_out_without_back: sampleIncompleteOut,
				incomplete_back_without_out: sampleIncompleteBack
			}
		}
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, JSON.stringify(report, null, 2))

	const print = {
		report_file: args.outFile,
		summary: report.summary,
		key_checks: {
			has_manual_fix_adjust_rows: report.conclusion_checks.missing_fill_resolve_writes_adjust_not_fill.has_manual_fix_adjust_rows,
			has_manual_fix_fill_rows: report.conclusion_checks.missing_fill_resolve_writes_adjust_not_fill.has_manual_fix_fill_rows,
			diff_lt0_le10_bottle: report.conclusion_checks.missing_fill_diff_typicals.diff_lt0_le10?.bottle_no || null,
			diff_gt0_bottle: report.conclusion_checks.missing_fill_diff_typicals.diff_gt0?.bottle_no || null,
			diff_abs_gt10_bottle: report.conclusion_checks.missing_fill_diff_typicals.diff_abs_gt10?.bottle_no || null,
			loss_case_bottle: report.conclusion_checks.cycle_formula_typicals.loss_case?.bottle_no || null,
			swell_case_bottle: report.conclusion_checks.cycle_formula_typicals.swell_case?.bottle_no || null,
			exact_case_bottle: report.conclusion_checks.cycle_formula_typicals.exact_case?.bottle_no || null
		}
	}
	console.log(JSON.stringify(print, null, 2))
}

run().catch((err) => {
	console.error('[probeAnomalyCycleExamples] FAIL', err && err.message ? err.message : err)
	process.exit(1)
})
