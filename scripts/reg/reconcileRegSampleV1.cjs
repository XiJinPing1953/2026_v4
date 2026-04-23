#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function safeJsonParse(text, fallback = null) {
	if (!text || typeof text !== 'string') return fallback
	try {
		return JSON.parse(text)
	} catch (_) {
		return fallback
	}
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function normalizeNumberString(value) {
	const num = toNumber(value, null)
	return num == null ? '' : String(num)
}

function parseDateToTsShanghai(dateText) {
	const text = normalizeString(dateText)
	if (!text) return null
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
	if (!m) return null
	const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}+08:00`)
	return Number.isFinite(ts) ? ts : null
}

function parseArgs(argv) {
	const out = {
		spaceId: normalizeString(process.env.SPACE_ID),
		username: normalizeString(process.env.CRM_USERNAME) || 'superadmin',
		password: normalizeString(process.env.CRM_PASSWORD) || '',
		stationId: '',
		sampleSize: 100,
		seed: '20260423',
		outFile: path.resolve(process.cwd(), 'docs/regulatory/reg_reconcile_100.report.json')
	}
	for (let i = 2; i < argv.length; i += 1) {
		const m = String(argv[i] || '').match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'space-id') out.spaceId = normalizeString(value) || out.spaceId
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value)
		if (key === 'station-id') out.stationId = normalizeString(value)
		if (key === 'sample-size') out.sampleSize = Math.min(Math.max(Number(value) || 100, 1), 500)
		if (key === 'seed') out.seed = normalizeString(value) || out.seed
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || '')
	}
	if (!out.spaceId) throw new Error('missing --space-id')
	if (!out.password) throw new Error('missing --password')
	if (!out.stationId) throw new Error('missing --station-id')
	return out
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
	if (node.spaceid === spaceId && node.accessKey && node.secretKey && node.spaceAppId) return node
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
			return {
				spaceId,
				accessKey: normalizeString(space.accessKey),
				secretKey: normalizeString(space.secretKey),
				spaceAppId: normalizeString(space.spaceAppId),
				endpoint: normalizeString(space.apiEndpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`
			}
		} catch (_) {}
	}
	throw new Error(`no space key found for ${spaceId}`)
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
		const signed = this.signRequest('/functions/invokeFunction', { data: functionArgs, functionName: name })
		const res = await fetch(signed.url, { method: 'POST', headers: signed.headers, body: signed.bodyText })
		const text = await res.text()
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
		return text ? JSON.parse(text) : {}
	}
}

function requestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function login(client, username, password) {
	const res = await client.callFunction('crm-auth', {
		action: 'login',
		data: { username, password },
		request_id: requestId()
	})
	if (!res || res.code !== 0) throw new Error(`login failed: ${JSON.stringify(res)}`)
	const token =
		res.token ||
		(res.user && res.user.token) ||
		(res.data && (res.data.token || (res.data.user && res.data.user.token))) ||
		''
	if (!token) throw new Error('login token is empty')
	return token
}

async function invokeAuthed(client, token, functionName, action, data) {
	return client.callFunction(functionName, {
		action,
		token,
		data: data || {},
		request_id: requestId()
	})
}

function createSeededRandom(seedText) {
	const seedHex = sha256Hex(seedText || 'seed').slice(0, 16)
	let state = Number.parseInt(seedHex, 16) || 1
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x100000000
	}
}

function pickSample(items, sampleSize, seedText) {
	if (items.length <= sampleSize) return items.slice()
	const rng = createSeededRandom(seedText)
	const scored = items.map((item) => ({ item, score: rng() }))
	scored.sort((a, b) => a.score - b.score)
	return scored.slice(0, sampleSize).map((row) => row.item)
}

function getLatestFillFromRows(rows) {
	const candidates = Array.isArray(rows) ? rows : []
	for (let i = 0; i < candidates.length; i += 1) {
		const row = candidates[i] || {}
		const type = normalizeString(row.record_type)
		if (type === 'normal_fill' || type === 'truck_out_agent_sale') return row
	}
	return null
}

function normalizeLocationCode(status) {
	const text = normalizeString(status)
	return text || 'unknown'
}

function compareField(diffList, key, stationValue, regValue) {
	const left = normalizeString(stationValue)
	const right = normalizeString(regValue)
	if (left === right) return
	diffList.push({
		field: key,
		station: left,
		reg: right
	})
}

async function fetchAllActiveBottles(client, token) {
	const out = []
	let page = 1
	const pageSize = 50
	while (true) {
		const res = await invokeAuthed(client, token, 'crm-bottle', 'listV1', {
			page,
			pageSize,
			is_active: true
		})
		if (!res || res.code !== 0) {
			throw new Error(`crm-bottle.listV1 failed: ${JSON.stringify(res)}`)
		}
		const rows = Array.isArray(res.data) ? res.data : []
		out.push(...rows)
		const hasMore = Boolean(res.paging && res.paging.hasMore)
		if (!hasMore || !rows.length) break
		page += 1
	}
	return out
}

async function fetchRegCurrentByNos(client, token, stationId, bottleNos) {
	const out = []
	const chunkSize = 200
	for (let i = 0; i < bottleNos.length; i += chunkSize) {
		const chunk = bottleNos.slice(i, i + chunkSize)
		const res = await invokeAuthed(client, token, 'crm-reg-ingest', 'listBottleCurrentByNosV1', {
			station_id: stationId,
			bottle_nos: chunk
		})
		if (!res || res.code !== 0) {
			throw new Error(`crm-reg-ingest.listBottleCurrentByNosV1 failed: ${JSON.stringify(res)}`)
		}
		out.push(...(Array.isArray(res.data) ? res.data : []))
	}
	return out
}

async function fetchLatestFillForBottle(client, token, bottleNo) {
	const res = await invokeAuthed(client, token, 'crm-filling', 'listV1', {
		page: 1,
		pageSize: 20,
		bottle_no: bottleNo
	})
	if (!res || res.code !== 0) return null
	return getLatestFillFromRows(Array.isArray(res.data) ? res.data : [])
}

async function main() {
	const args = parseArgs(process.argv)
	const client = new AlipayFunctionClient(loadAlipayConfig(args.spaceId))
	const token = await login(client, args.username, args.password)

	const activeBottles = await fetchAllActiveBottles(client, token)
	if (!activeBottles.length) throw new Error('active bottle list is empty')

	const sampled = pickSample(activeBottles, args.sampleSize, `${args.seed}:${args.stationId}`)
	const sampledNos = sampled.map((row) => normalizeBottleNo(row && row.bottle_no)).filter(Boolean)
	const regRows = await fetchRegCurrentByNos(client, token, args.stationId, sampledNos)
	const regMap = new Map(regRows.map((row) => [normalizeBottleNo(row && row.bottle_no), row]))

	const fieldMismatchCount = {}
	const mismatches = []
	let missingInRegTotal = 0
	let comparedTotal = 0

	for (let i = 0; i < sampled.length; i += 1) {
		const station = sampled[i] || {}
		const bottleNo = normalizeBottleNo(station.bottle_no)
		const regRow = regMap.get(bottleNo)
		if (!regRow) {
			missingInRegTotal += 1
			mismatches.push({
				bottle_no: bottleNo,
				reason: 'missing_in_reg'
			})
			continue
		}
		comparedTotal += 1
		const snapshot = regRow.snapshot && typeof regRow.snapshot === 'object' ? regRow.snapshot : {}
		const bottle = snapshot.bottle && typeof snapshot.bottle === 'object' ? snapshot.bottle : {}
		const trace = snapshot.trace && typeof snapshot.trace === 'object' ? snapshot.trace : {}

		const diffs = []
		compareField(diffs, 'id_no', station.product_no, bottle.id_no)
		compareField(diffs, 'inner_no', bottleNo, bottle.inner_no)
		compareField(diffs, 'gas_medium_code', station.gas_medium_code, bottle.gas_medium_code)
		compareField(diffs, 'manufacturer', station.manufacturer, bottle.manufacturer)
		compareField(diffs, 'manufacture_date', station.manufacture_date, bottle.manufacture_date)
		compareField(diffs, 'bottle_type', station.equipment_type, bottle.bottle_type)
		compareField(diffs, 'volume_l', normalizeNumberString(station.volume_l), normalizeNumberString(bottle.volume_l))
		compareField(diffs, 'property_owner_unit', station.filling_company, bottle.property_owner_unit)
		compareField(diffs, 'check_date', station.bottle_check_date, bottle.check_date)
		compareField(diffs, 'next_check_date', station.bottle_next_check_date, bottle.next_check_date)
		compareField(diffs, 'location_code', normalizeLocationCode(station.status), normalizeLocationCode(trace.location_code))
		compareField(diffs, 'location_customer_name', station.current_customer_name, trace.location_customer_name)

		const latestFill = await fetchLatestFillForBottle(client, token, bottleNo)
		const expectedFillTs = latestFill ? parseDateToTsShanghai(latestFill.date) : null
		const actualFillTs = toNumber(trace.last_fill_time, null)
		compareField(diffs, 'last_fill_time', normalizeNumberString(expectedFillTs), normalizeNumberString(actualFillTs))
		compareField(diffs, 'last_fill_weight', normalizeNumberString(latestFill ? latestFill.fill_weight : null), normalizeNumberString(trace.last_fill_weight))
		compareField(diffs, 'last_fill_operator', latestFill ? latestFill.operator : '', trace.last_fill_operator)

		if (diffs.length) {
			for (let j = 0; j < diffs.length; j += 1) {
				const field = diffs[j].field
				fieldMismatchCount[field] = (fieldMismatchCount[field] || 0) + 1
			}
			mismatches.push({
				bottle_no: bottleNo,
				reason: 'field_mismatch',
				diffs
			})
		}
	}

	const mismatchTotal = mismatches.length
	const matchedTotal = sampled.length - mismatchTotal
	const consistencyRate = sampled.length ? Number(((matchedTotal / sampled.length) * 100).toFixed(2)) : 0
	const report = {
		ts: Date.now(),
		space_id: args.spaceId,
		station_id: args.stationId,
		sample_size: args.sampleSize,
		active_bottle_total: activeBottles.length,
		sampled_total: sampled.length,
		compared_total: comparedTotal,
		matched_total: matchedTotal,
		mismatch_total: mismatchTotal,
		missing_in_reg_total: missingInRegTotal,
		consistency_rate_pct: consistencyRate,
		field_mismatch_count: fieldMismatchCount,
		sampled_bottle_nos: sampledNos,
		mismatches
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, JSON.stringify(report, null, 2) + '\n', 'utf8')
	console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
	console.error(err && err.message ? err.message : String(err))
	process.exit(1)
})
