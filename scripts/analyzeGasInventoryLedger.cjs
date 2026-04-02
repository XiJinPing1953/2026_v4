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

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function looksLikeTruckNo(value) {
	const text = normalizeBottleNo(value)
	return /^TRUCK[-_A-Z0-9]/.test(text)
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function roundTo(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	const base = 10 ** Number(digits || 0)
	return Math.round(num * base) / base
}

function roundTon(value) {
	return roundTo(value, 3)
}

function roundMoney(value) {
	return roundTo(value, 2)
}

function kgToTon(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return roundTon(num / 1000)
}

function movementKey(sourceType, sourceId, movementKind) {
	return `${normalizeString(sourceType)}|${normalizeString(sourceId)}|${normalizeString(movementKind)}`
}

function toMovementDelta(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return roundTon(num)
}

function normalizeGasDate(value, fallbackTs = null) {
	const text = normalizeString(value)
	if (!text) {
		if (fallbackTs == null) return ''
		return formatDayByTs(Number(fallbackTs) || Date.now())
	}
	const compactYmd = text.match(/^(\d{4})(\d{2})(\d{2})$/)
	if (compactYmd) return `${compactYmd[1]}-${compactYmd[2]}-${compactYmd[3]}`
	const ymdMatch = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
	if (ymdMatch) {
		return `${ymdMatch[1]}-${String(Number(ymdMatch[2])).padStart(2, '0')}-${String(Number(ymdMatch[3])).padStart(2, '0')}`
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return formatDayByTs(parsed)
	return ''
}

function formatDayByTs(ts) {
	const d = new Date(ts)
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function normalizeEventDay(dateText, fallbackTs) {
	return normalizeGasDate(dateText, fallbackTs) || formatDayByTs(Number(fallbackTs) || Date.now())
}

function parseEventAt(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return Number(fallbackTs) || Date.now()
}

function normalizeFlowType(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'back' || text === 'fill' || text === 'out') return text
	return ''
}

function isDayInRange(day, start, end) {
	const value = normalizeString(day)
	if (!value) return false
	if (start && value < start) return false
	if (end && value > end) return false
	return true
}

function sumNetKgFromSaleItems(rows = [], key = 'net') {
	return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (toNumber(row && row[key], 0) || 0), 0)
}

function resolveTruckSaleNetValue(rawTruckGrossDiff, rawTruckSaleNet, rawTruckOutGross, rawTruckBackGross) {
	const outGross = rawTruckOutGross === '' || rawTruckOutGross == null ? null : toNumber(rawTruckOutGross, null)
	const backGross = rawTruckBackGross === '' || rawTruckBackGross == null ? null : toNumber(rawTruckBackGross, null)
	if (outGross != null && backGross != null) return Math.max(outGross - backGross, 0)
	const grossDiff = rawTruckGrossDiff === '' || rawTruckGrossDiff == null ? null : toNumber(rawTruckGrossDiff, null)
	if (grossDiff != null) return Math.max(grossDiff, 0)
	const legacySaleNet = rawTruckSaleNet === '' || rawTruckSaleNet == null ? null : toNumber(rawTruckSaleNet, null)
	if (legacySaleNet != null) return Math.max(legacySaleNet, 0)
	return 0
}

function buildMovementDoc({
	eventDay,
	eventAt,
	sourceType,
	sourceId,
	movementKind,
	assetDeltaT,
	stationDeltaT,
	inBottleDeltaT,
	note,
	meta,
	createdAt
}) {
	return {
		event_day: normalizeString(eventDay),
		event_at: Number(eventAt) || Number(createdAt) || Date.now(),
		source_type: normalizeString(sourceType),
		source_id: normalizeString(sourceId),
		movement_kind: normalizeString(movementKind),
		asset_delta_t: toMovementDelta(assetDeltaT),
		station_delta_t: toMovementDelta(stationDeltaT),
		in_bottle_delta_t: toMovementDelta(inBottleDeltaT),
		note: normalizeString(note),
		meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {},
		created_at: Number(createdAt) || Date.now()
	}
}

function buildFillingGasMovementCandidate(row = {}) {
	const sourceId = normalizeString(row._id)
	if (!sourceId) return null
	const recordType = normalizeString(row.record_type).toLowerCase() || 'normal_fill'
	const bottleNo = normalizeBottleNo(row.bottle_no)
	const isTruckFill = recordType === 'normal_fill' && looksLikeTruckNo(bottleNo)
	const fillWeightKg = toNumber(row.fill_weight, 0) || 0
	const qT = kgToTon(fillWeightKg)
	if (!(typeof qT === 'number' && Number.isFinite(qT) && qT !== 0)) return null

	let deltas = null
	let movementKind = ''
	if (recordType === 'normal_fill') {
		deltas = isTruckFill ? { asset: 0, station: -qT, inBottle: 0 } : { asset: 0, station: -qT, inBottle: qT }
		movementKind = isTruckFill ? 'filling_truck_fill' : 'filling_normal_fill'
	} else if (recordType === 'truck_out_agent_sale') {
		deltas = { asset: 0, station: -qT, inBottle: qT }
		movementKind = 'filling_truck_out_agent_sale'
	} else if (recordType === 'truck_out_no_sale') {
		deltas = { asset: -qT, station: -qT, inBottle: 0 }
		movementKind = 'filling_truck_out_no_sale'
	}
	if (!deltas || !movementKind) return null

	const createdAt = Number(row.created_at) || Date.now()
	return buildMovementDoc({
		eventDay: normalizeEventDay(row.date, createdAt),
		eventAt: parseEventAt(row.date, createdAt),
		sourceType: 'filling',
		sourceId,
		movementKind,
		assetDeltaT: deltas.asset,
		stationDeltaT: deltas.station,
		inBottleDeltaT: deltas.inBottle,
		note: normalizeString(row.remark),
		meta: {
			record_type: recordType,
			bottle_no: bottleNo,
			inventory_scope: isTruckFill ? 'truck' : 'bottle'
		},
		createdAt
	})
}

function buildSaleGasMovementCandidate(row = {}) {
	const sourceId = normalizeString(row._id)
	if (!sourceId) return null
	const bizMode = normalizeString(row.biz_mode).toLowerCase() || 'bottle'

	const outNetKg = sumNetKgFromSaleItems(row.out_items, 'net')
	const backNetKg = sumNetKgFromSaleItems(row.back_items, 'net')
	const agentNetKg = sumNetKgFromSaleItems(row.agent_sale_items, 'fill_weight')
	let saleNetKg = 0
	let movementKind = ''

	if (bizMode === 'agent_sale') {
		saleNetKg = agentNetKg
		movementKind = 'sale_agent_sale'
	} else if (bizMode === 'truck') {
		saleNetKg = resolveTruckSaleNetValue(row.truck_gross_diff, row.truck_sale_net, row.truck_out_gross, row.truck_back_gross)
		if (!(saleNetKg > 0)) saleNetKg = outNetKg
		movementKind = 'sale_truck'
	} else {
		saleNetKg = outNetKg - backNetKg
		movementKind = 'sale_bottle'
	}

	const qT = kgToTon(saleNetKg)
	if (!(typeof qT === 'number' && Number.isFinite(qT) && qT !== 0)) return null

	const createdAt = Number(row.created_at) || Date.now()
	const truckDiffKg =
		bizMode === 'truck'
			? roundTon((toNumber(row.truck_out_gross, 0) || 0) - (toNumber(row.truck_back_gross, 0) || 0) - saleNetKg)
			: 0

	return buildMovementDoc({
		eventDay: normalizeEventDay(row.date, createdAt),
		eventAt: parseEventAt(row.date, createdAt),
		sourceType: 'sale',
		sourceId,
		movementKind,
		assetDeltaT: -qT,
		stationDeltaT: 0,
		inBottleDeltaT: bizMode === 'truck' ? 0 : -qT,
		note: normalizeString(row.remark),
		meta: {
			biz_mode: bizMode,
			q_kg: roundTon(saleNetKg),
			truck_diff_kg: bizMode === 'truck' ? truckDiffKg : 0,
			inventory_scope: bizMode === 'truck' ? 'truck' : 'bottle'
		},
		createdAt
	})
}

function computeCycleAdjustCandidatesFromEvents(rows = [], { dateStart = '', dateEnd = '' } = {}) {
	const candidates = []
	const sorted = [...rows].sort((a, b) => {
		const noA = normalizePlateNo(a && a.bottle_no)
		const noB = normalizePlateNo(b && b.bottle_no)
		if (noA !== noB) return noA < noB ? -1 : 1
		const eventAtA = Number(a && a.event_at) || 0
		const eventAtB = Number(b && b.event_at) || 0
		if (eventAtA !== eventAtB) return eventAtA - eventAtB
		const orderA = Number(a && a.type_order) || 99
		const orderB = Number(b && b.type_order) || 99
		if (orderA !== orderB) return orderA - orderB
		const createdAtA = Number(a && a.created_at) || 0
		const createdAtB = Number(b && b.created_at) || 0
		return createdAtA - createdAtB
	})

	let currentBottle = ''
	let activeCycle = null

	for (let i = 0; i < sorted.length; i += 1) {
		const row = sorted[i] || {}
		const bottleNo = normalizePlateNo(row.bottle_no)
		if (!bottleNo) continue
		if (bottleNo !== currentBottle) {
			currentBottle = bottleNo
			activeCycle = null
		}
		const type = normalizeFlowType(row.type)
		if (!type) continue

		if (type === 'back') {
			activeCycle = {
				backNetKg: toNumber(row.net_weight, 0) || 0,
				backDate: normalizeString(row.date),
				fillSumKg: 0
			}
			continue
		}
		if (type === 'fill') {
			if (!activeCycle) continue
			activeCycle.fillSumKg += toNumber(row.net_weight, 0) || 0
			continue
		}
		if (type === 'out') {
			if (!activeCycle) continue
			const outDay = normalizeString(row.event_day) || normalizeString(row.date)
			if (!isDayInRange(outDay, dateStart, dateEnd)) {
				activeCycle = null
				continue
			}
			const outNetKg = toNumber(row.net_weight, 0) || 0
			const deltaKg = roundTon(activeCycle.backNetKg + activeCycle.fillSumKg - outNetKg)
			if (deltaKg !== 0) {
				const sourceOutId = normalizeString(row.source_id)
				const sourceOutEventId = normalizeString(row._id)
				const sourceKeyBase = sourceOutId || sourceOutEventId
				if (sourceKeyBase) {
					const qT = kgToTon(Math.abs(deltaKg)) || 0
					if (qT > 0) {
						candidates.push({
							source_id: `${sourceKeyBase}::${bottleNo}`,
							source_out_id: sourceOutId || sourceOutEventId,
							bottle_no: bottleNo,
							event_day: outDay,
							event_at: Number(row.event_at) || parseEventAt(outDay, Date.now()),
							delta_kg: deltaKg,
							q_t: qT,
							back_date: activeCycle.backDate,
							out_date: normalizeString(row.date)
						})
					}
				}
			}
			activeCycle = null
		}
	}

	return candidates
}

function buildCycleAdjustMovementDoc(candidate = {}) {
	const deltaKg = toNumber(candidate.delta_kg, 0) || 0
	const qT = kgToTon(Math.abs(deltaKg)) || 0
	if (!(qT > 0)) return null
	const isLoss = deltaKg > 0
	const sign = isLoss ? -1 : 1
	return buildMovementDoc({
		eventDay: normalizeString(candidate.event_day),
		eventAt: Number(candidate.event_at) || Date.now(),
		sourceType: 'cycle_adjust',
		sourceId: normalizeString(candidate.source_id),
		movementKind: 'cycle_adjust',
		assetDeltaT: roundTon(sign * qT),
		stationDeltaT: 0,
		inBottleDeltaT: roundTon(sign * qT),
		note: `闭环差值${isLoss ? '损耗' : '回冲'} ${Math.abs(deltaKg).toFixed(3)}kg`,
		meta: {
			source_out_id: normalizeString(candidate.source_out_id),
			bottle_no: normalizeString(candidate.bottle_no),
			back_date: normalizeString(candidate.back_date),
			out_date: normalizeString(candidate.out_date),
			delta_kg: deltaKg
		},
		createdAt: Date.now()
	})
}

function resolveInventoryContribution(row = {}) {
	const asset = toNumber(row.asset_delta_t, 0) || 0
	const station = toNumber(row.station_delta_t, 0) || 0
	const inBottleRaw = toNumber(row.in_bottle_delta_t, 0) || 0
	const movementKind = normalizeString(row.movement_kind)
	const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {}
	const bottleNo = normalizeBottleNo(meta.bottle_no)
	const inventoryScope = normalizeString(meta.inventory_scope).toLowerCase()

	let inBottle = inBottleRaw
	let vehicle = 0

	if (movementKind === 'filling_truck_fill') {
		vehicle = roundTon(-station)
	} else if (movementKind === 'sale_truck') {
		vehicle = roundTon(asset)
	} else if (movementKind === 'filling_normal_fill' && (inventoryScope === 'truck' || looksLikeTruckNo(bottleNo))) {
		inBottle = 0
		vehicle = roundTon(-station)
	}

	return {
		asset: roundTon(asset),
		station: roundTon(station),
		inBottle: roundTon(inBottle),
		vehicle: roundTon(vehicle)
	}
}

function dedupeMovementDocs(rows = []) {
	const map = new Map()
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		const key = movementKey(row.source_type, row.source_id, row.movement_kind)
		if (!key || key === '||') continue
		map.set(key, row)
	}
	return Array.from(map.values()).sort((a, b) => {
		const atA = Number(a.event_at) || 0
		const atB = Number(b.event_at) || 0
		if (atA !== atB) return atA - atB
		const createdA = Number(a.created_at) || 0
		const createdB = Number(b.created_at) || 0
		if (createdA !== createdB) return createdA - createdB
		const keyA = movementKey(a.source_type, a.source_id, a.movement_kind)
		const keyB = movementKey(b.source_type, b.source_id, b.movement_kind)
		return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
	})
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
		if (node.accessKey && node.secretKey && node.spaceAppId) return node
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
				endpoint: normalizeString(space.apiEndpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`
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
		const signed = this.signRequest('/functions/invokeFunction', { data: functionArgs, functionName: name })
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
	return res.token || (res.user && res.user.token) || (res.data && (res.data.token || (res.data.user && res.data.user.token))) || ''
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

async function fetchAllPages(fetchPage) {
	const rows = []
	let page = 1
	while (true) {
		const res = await fetchPage(page)
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		const total = Number(res.total || res.paging?.total || 0)
		const pageSize = Number(res.pageSize || res.paging?.pageSize || 0)
		const hasMore = Boolean(res.hasMore || res.paging?.hasMore || (pageSize > 0 && page * pageSize < total))
		if (!hasMore || !list.length) break
		page += 1
		if (page > 2000) throw new Error('分页保护触发')
	}
	return rows
}

async function fetchAllGasInRows(client, token) {
	let summary = null
	const rows = await fetchAllPages(async (page) => {
		const res = await callCrm(client, token, 'crm-gas-in', 'listV1', { page, pageSize: 200 })
		if (!summary) summary = res.summary || null
		return res
	})
	return { rows, summary }
}

async function fetchAllFillingRows(client, token) {
	const rows = await fetchAllPages(async (page) => callCrm(client, token, 'crm-filling', 'listV1', { page, pageSize: 200 }))
	return rows
}

async function fetchAllSaleRows(client, token) {
	const rows = await fetchAllPages(async (page) => callCrm(client, token, 'crm-sale', 'listV2', { page, pageSize: 50 }))
	return rows
}

async function fetchAllBottleMovementRows(client, token) {
	const rows = await fetchAllPages(async (page) => callCrm(client, token, 'crm-bottle-movement', 'listV1', { page, pageSize: 200 }))
	return rows
}

function summarizeMovementDocs(rows = []) {
	const summary = {
		total: 0,
		asset_total_t: 0,
		station_total_t: 0,
		in_bottle_total_t: 0,
		vehicle_total_t: 0,
		balance_diff_t: 0,
		by_kind: {}
	}
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		summary.total += 1
		const contribution = resolveInventoryContribution(row)
		summary.asset_total_t += contribution.asset
		summary.station_total_t += contribution.station
		summary.in_bottle_total_t += contribution.inBottle
		summary.vehicle_total_t += contribution.vehicle
		const kind = normalizeString(row.movement_kind) || 'unknown'
		if (!summary.by_kind[kind]) {
			summary.by_kind[kind] = { total: 0, asset_total_t: 0, station_total_t: 0, in_bottle_total_t: 0, vehicle_total_t: 0 }
		}
		summary.by_kind[kind].total += 1
		summary.by_kind[kind].asset_total_t = roundTon(summary.by_kind[kind].asset_total_t + contribution.asset)
		summary.by_kind[kind].station_total_t = roundTon(summary.by_kind[kind].station_total_t + contribution.station)
		summary.by_kind[kind].in_bottle_total_t = roundTon(summary.by_kind[kind].in_bottle_total_t + contribution.inBottle)
		summary.by_kind[kind].vehicle_total_t = roundTon(summary.by_kind[kind].vehicle_total_t + contribution.vehicle)
	}
	summary.asset_total_t = roundTon(summary.asset_total_t)
	summary.station_total_t = roundTon(summary.station_total_t)
	summary.in_bottle_total_t = roundTon(summary.in_bottle_total_t)
	summary.vehicle_total_t = roundTon(summary.vehicle_total_t)
	summary.balance_diff_t = roundTon(summary.asset_total_t - summary.station_total_t - summary.in_bottle_total_t - summary.vehicle_total_t)
	return summary
}

function buildSourceMaps({ gasInRows, fillingRows, saleRows }) {
	return {
		gas_in: new Map((gasInRows || []).map((row) => [normalizeString(row._id), row])),
		filling: new Map((fillingRows || []).map((row) => [normalizeString(row._id), row])),
		sale: new Map((saleRows || []).map((row) => [normalizeString(row._id), row]))
	}
}

function buildSaleDuplicateSignature(row = {}) {
	const bizMode = normalizeString(row.biz_mode).toLowerCase() || 'bottle'
	if (bizMode === 'truck') {
		return [
			bizMode,
			normalizeString(row.date),
			normalizeString(row.customer_id),
			normalizePlateNo(row.truck_no),
			resolveTruckSaleNetValue(row.truck_gross_diff, row.truck_sale_net, row.truck_out_gross, row.truck_back_gross),
			toNumber(row.truck_out_gross, ''),
			toNumber(row.truck_back_gross, '')
		].join('|')
	}
	if (bizMode === 'agent_sale') {
		return [
			bizMode,
			normalizeString(row.date),
			normalizeString(row.customer_id),
			sumNetKgFromSaleItems(row.agent_sale_items, 'fill_weight')
		].join('|')
	}
	return [
		bizMode,
		normalizeString(row.date),
		normalizeString(row.customer_id),
		sumNetKgFromSaleItems(row.out_items, 'net'),
		sumNetKgFromSaleItems(row.back_items, 'net'),
		toNumber(row.total_net_weight, '')
	].join('|')
}

function findSuspectedDuplicateSales(rows = []) {
	const groups = new Map()
	for (const row of rows) {
		const key = buildSaleDuplicateSignature(row)
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(row)
	}
	return Array.from(groups.entries())
		.filter(([, list]) => list.length > 1)
		.map(([key, list]) => ({
			signature: key,
			total: list.length,
			biz_mode: normalizeString(list[0] && list[0].biz_mode),
			date: normalizeString(list[0] && list[0].date),
			customer_name: normalizeString(list[0] && list[0].customer_name),
			truck_no: normalizePlateNo(list[0] && list[0].truck_no),
			total_net_weight_kg: toNumber(list[0] && list[0].total_net_weight, null),
			rows: list.map((row) => ({
				_id: normalizeString(row && row._id),
				date: normalizeString(row && row.date),
				customer_name: normalizeString(row && row.customer_name),
				biz_mode: normalizeString(row && row.biz_mode),
				total_net_weight_kg: toNumber(row && row.total_net_weight, null),
				truck_gross_diff_kg: toNumber(row && row.truck_gross_diff, toNumber(row && row.truck_sale_net, null)),
				remark: normalizeString(row && row.remark)
			}))
		}))
		.sort((a, b) => b.total - a.total || a.date.localeCompare(b.date))
}

function summarizeDuplicateSaleImpact(groups = []) {
	const summary = {
		group_total: 0,
		extra_row_total: 0,
		asset_total_t: 0,
		in_bottle_total_t: 0,
		vehicle_total_t: 0
	}
	for (const group of groups) {
		const rows = Array.isArray(group.rows) ? group.rows : []
		if (rows.length <= 1) continue
		summary.group_total += 1
		for (let i = 1; i < rows.length; i += 1) {
			const row = rows[i]
			summary.extra_row_total += 1
			const bizMode = normalizeString(row && row.biz_mode).toLowerCase() || 'bottle'
			const totalNetWeightKg = toNumber(row && row.total_net_weight_kg, 0) || 0
			const qT = kgToTon(totalNetWeightKg) || 0
			if (bizMode === 'truck') {
				summary.asset_total_t = roundTon(summary.asset_total_t - qT)
				summary.vehicle_total_t = roundTon(summary.vehicle_total_t - qT)
			} else {
				summary.asset_total_t = roundTon(summary.asset_total_t - qT)
				summary.in_bottle_total_t = roundTon(summary.in_bottle_total_t - qT)
			}
		}
	}
	return summary
}

function describeMovementRow(row, sourceMaps) {
	const type = normalizeString(row.source_type)
	const sourceId = normalizeString(row.source_id)
	const meta = row.meta && typeof row.meta === 'object' ? row.meta : {}
	if (type === 'gas_in') {
		const src = sourceMaps.gas_in.get(sourceId) || {}
		return {
			label: normalizePlateNo(src.plate_no),
			date: normalizeString(src.date),
			remark: normalizeString(src.remark),
			product_name: normalizeString(src.product_name),
			net_weight_t: toNumber(src.net_weight_t, null)
		}
	}
	if (type === 'filling') {
		const src = sourceMaps.filling.get(sourceId) || {}
		return {
			label: normalizeBottleNo(src.bottle_no),
			date: normalizeString(src.date),
			record_type: normalizeString(src.record_type),
			fill_weight_kg: toNumber(src.fill_weight, null),
			remark: normalizeString(src.remark)
		}
	}
	if (type === 'sale') {
		const src = sourceMaps.sale.get(sourceId) || {}
		return {
			label: normalizeString(src.customer_name) || normalizePlateNo(src.truck_no),
			date: normalizeString(src.date),
			biz_mode: normalizeString(src.biz_mode),
			customer_name: normalizeString(src.customer_name),
			total_net_weight_kg: toNumber(src.total_net_weight, null),
			truck_gross_diff_kg: toNumber(src.truck_gross_diff, toNumber(src.truck_sale_net, null)),
			out_net_total_kg: toNumber(src.out_net_total, null),
			back_net_total_kg: toNumber(src.back_net_total, null),
			remark: normalizeString(src.remark)
		}
	}
	if (type === 'cycle_adjust') {
		return {
			label: normalizeBottleNo(meta.bottle_no),
			date: normalizeString(row.event_day),
			back_date: normalizeString(meta.back_date),
			out_date: normalizeString(meta.out_date),
			delta_kg: toNumber(meta.delta_kg, null),
			remark: normalizeString(row.note)
		}
	}
	return {}
}

function buildTopContributors(rows, sourceMaps, bucketKey, { top = 20, direction = 'negative' } = {}) {
	const list = []
	for (const row of rows) {
		const contribution = resolveInventoryContribution(row)
		const value = bucketKey === 'asset' ? contribution.asset : bucketKey === 'station' ? contribution.station : bucketKey === 'vehicle' ? contribution.vehicle : contribution.inBottle
		if (direction === 'negative' && !(value < 0)) continue
		if (direction === 'positive' && !(value > 0)) continue
		list.push({
			event_day: normalizeString(row.event_day),
			movement_kind: normalizeString(row.movement_kind),
			source_type: normalizeString(row.source_type),
			source_id: normalizeString(row.source_id),
			value_t: roundTon(value),
			note: normalizeString(row.note),
			context: describeMovementRow(row, sourceMaps)
		})
	}
	list.sort((a, b) => (direction === 'negative' ? a.value_t - b.value_t : b.value_t - a.value_t))
	return list.slice(0, top)
}

function buildDailyCumulative(rows) {
	const sorted = [...rows].sort((a, b) => {
		const dayDiff = normalizeString(a.event_day).localeCompare(normalizeString(b.event_day))
		if (dayDiff !== 0) return dayDiff
		const atDiff = (Number(a.event_at) || 0) - (Number(b.event_at) || 0)
		if (atDiff !== 0) return atDiff
		return (Number(a.created_at) || 0) - (Number(b.created_at) || 0)
	})
	let asset = 0
	let station = 0
	let inBottle = 0
	let vehicle = 0
	const days = new Map()
	const firstNegative = { asset: null, station: null, inBottle: null, vehicle: null }
	const minState = {
		asset: { value_t: 0, row: null },
		station: { value_t: 0, row: null },
		inBottle: { value_t: 0, row: null },
		vehicle: { value_t: 0, row: null }
	}

	for (const row of sorted) {
		const contribution = resolveInventoryContribution(row)
		asset = roundTon(asset + contribution.asset)
		station = roundTon(station + contribution.station)
		inBottle = roundTon(inBottle + contribution.inBottle)
		vehicle = roundTon(vehicle + contribution.vehicle)
		const day = normalizeString(row.event_day)
		days.set(day, {
			day,
			asset_total_t: asset,
			station_total_t: station,
			in_bottle_total_t: inBottle,
			vehicle_total_t: vehicle
		})
		for (const bucket of [
			['asset', asset],
			['station', station],
			['inBottle', inBottle],
			['vehicle', vehicle]
		]) {
			const [key, value] = bucket
			if (value < 0 && !firstNegative[key]) {
				firstNegative[key] = {
					day,
					value_t: value,
					movement_kind: normalizeString(row.movement_kind),
					source_type: normalizeString(row.source_type),
					source_id: normalizeString(row.source_id)
				}
			}
			if (value < minState[key].value_t) {
				minState[key] = {
					value_t: value,
					row: {
						day,
						movement_kind: normalizeString(row.movement_kind),
						source_type: normalizeString(row.source_type),
						source_id: normalizeString(row.source_id)
					}
				}
			}
		}
	}

	return {
		days: Array.from(days.values()),
		first_negative: firstNegative,
		min_state: {
			asset: { value_t: minState.asset.value_t, row: minState.asset.row },
			station: { value_t: minState.station.value_t, row: minState.station.row },
			in_bottle: { value_t: minState.inBottle.value_t, row: minState.inBottle.row },
			vehicle: { value_t: minState.vehicle.value_t, row: minState.vehicle.row }
		},
		required_opening_t: {
			asset: roundTon(Math.max(-minState.asset.value_t, 0)),
			station: roundTon(Math.max(-minState.station.value_t, 0)),
			in_bottle: roundTon(Math.max(-minState.inBottle.value_t, 0)),
			vehicle: roundTon(Math.max(-minState.vehicle.value_t, 0))
		}
	}
}

function groupByDayAndKind(rows) {
	const map = new Map()
	for (const row of rows) {
		const day = normalizeString(row.event_day)
		const kind = normalizeString(row.movement_kind)
		const key = `${day}|${kind}`
		if (!map.has(key)) {
			map.set(key, { day, movement_kind: kind, total: 0, asset_total_t: 0, station_total_t: 0, in_bottle_total_t: 0, vehicle_total_t: 0 })
		}
		const item = map.get(key)
		const contribution = resolveInventoryContribution(row)
		item.total += 1
		item.asset_total_t = roundTon(item.asset_total_t + contribution.asset)
		item.station_total_t = roundTon(item.station_total_t + contribution.station)
		item.in_bottle_total_t = roundTon(item.in_bottle_total_t + contribution.inBottle)
		item.vehicle_total_t = roundTon(item.vehicle_total_t + contribution.vehicle)
	}
	return Array.from(map.values()).sort((a, b) => {
		if (a.day !== b.day) return a.day < b.day ? -1 : 1
		return a.movement_kind < b.movement_kind ? -1 : 1
	})
}

function findInterestingDays(dayKindRows) {
	const daily = new Map()
	for (const row of dayKindRows) {
		if (!daily.has(row.day)) {
			daily.set(row.day, { day: row.day, asset_total_t: 0, station_total_t: 0, in_bottle_total_t: 0, vehicle_total_t: 0, kinds: [] })
		}
		const item = daily.get(row.day)
		item.asset_total_t = roundTon(item.asset_total_t + row.asset_total_t)
		item.station_total_t = roundTon(item.station_total_t + row.station_total_t)
		item.in_bottle_total_t = roundTon(item.in_bottle_total_t + row.in_bottle_total_t)
		item.vehicle_total_t = roundTon(item.vehicle_total_t + row.vehicle_total_t)
		item.kinds.push(row)
	}
	return Array.from(daily.values())
		.sort((a, b) => Math.abs(b.in_bottle_total_t) - Math.abs(a.in_bottle_total_t))
		.slice(0, 15)
}

function parseArgs(argv) {
	const out = {
		spaceId: normalizeString(process.env.SPACE_ID) || 'env-00jxuffegf2n',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		outFile: path.resolve(process.cwd(), 'docs/gas_inventory_diagnosis.latest.json')
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		const match = String(arg || '').match(/^--([^=]+)=(.*)$/)
		if (!match) continue
		const key = match[1]
		const value = match[2]
		if (key === 'space-id') out.spaceId = normalizeString(value) || out.spaceId
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
	}
	if (!out.spaceId) throw new Error('缺少 --space-id=...')
	return out
}

async function main() {
	const args = parseArgs(process.argv)
	const client = new AlipayFunctionClient(loadAlipayConfig(args.spaceId))
	const token = await login(client, args.username, args.password)

	const [gasInBundle, fillingRows, saleRows, movementRows] = await Promise.all([
		fetchAllGasInRows(client, token),
		fetchAllFillingRows(client, token),
		fetchAllSaleRows(client, token),
		fetchAllBottleMovementRows(client, token)
	])

	const gasInRows = gasInBundle.rows || []
	const remoteSummary = gasInBundle.summary || {}
	const sourceMaps = buildSourceMaps({ gasInRows, fillingRows, saleRows })

	const docs = []
	for (const row of gasInRows) {
		const sourceId = normalizeString(row._id)
		const net = toNumber(row.net_weight_t, 0) || 0
		if (!sourceId || net === 0) continue
		const createdAt = Number(row.created_at) || Date.now()
		docs.push(
			buildMovementDoc({
				eventDay: normalizeEventDay(row.date, createdAt),
				eventAt: parseEventAt(row.date, createdAt),
				sourceType: 'gas_in',
				sourceId,
				movementKind: 'gas_in',
				assetDeltaT: net,
				stationDeltaT: net,
				inBottleDeltaT: 0,
				note: normalizeString(row.remark) || '天然气入库',
				meta: {},
				createdAt
			})
		)
	}
	for (const row of fillingRows) {
		const doc = buildFillingGasMovementCandidate(row)
		if (doc) docs.push(doc)
	}
	for (const row of saleRows) {
		const doc = buildSaleGasMovementCandidate(row)
		if (doc) docs.push(doc)
	}
	const flowEvents = (movementRows || []).filter((row) => {
		const type = normalizeFlowType(row && row.type)
		return type === 'back' || type === 'fill' || type === 'out'
	})
	const cycleCandidates = computeCycleAdjustCandidatesFromEvents(flowEvents)
	for (const candidate of cycleCandidates) {
		const doc = buildCycleAdjustMovementDoc(candidate)
		if (doc) docs.push(doc)
	}

	const deduped = dedupeMovementDocs(docs)
	const localSummary = summarizeMovementDocs(deduped)
	const dailyCumulative = buildDailyCumulative(deduped)
	const dayKindRows = groupByDayAndKind(deduped)
	const suspectedDuplicateSales = findSuspectedDuplicateSales(saleRows).slice(0, 30)

	const result = {
		space_id: args.spaceId,
		generated_at: new Date().toISOString(),
		source_counts: {
			gas_in: gasInRows.length,
			filling: fillingRows.length,
			sale: saleRows.length,
			bottle_movement: movementRows.length,
			cycle_candidates: cycleCandidates.length,
			movement_docs: deduped.length
		},
		remote_summary: remoteSummary,
		local_summary: localSummary,
		diff: {
			asset_total_t: roundTon((remoteSummary.inventory?.asset_total_t || 0) - localSummary.asset_total_t),
			station_total_t: roundTon((remoteSummary.inventory?.station_total_t || 0) - localSummary.station_total_t),
			in_bottle_total_t: roundTon((remoteSummary.inventory?.in_bottle_total_t || 0) - localSummary.in_bottle_total_t),
			vehicle_total_t: roundTon((remoteSummary.inventory?.vehicle_total_t || 0) - localSummary.vehicle_total_t),
			balance_diff_t: roundTon((remoteSummary.inventory?.balance_diff_t || 0) - localSummary.balance_diff_t)
		},
		required_opening_t: dailyCumulative.required_opening_t,
		first_negative: dailyCumulative.first_negative,
		min_state: dailyCumulative.min_state,
		top_in_bottle_negative_sources: buildTopContributors(deduped, sourceMaps, 'inBottle', { top: 30, direction: 'negative' }),
		top_station_negative_sources: buildTopContributors(deduped, sourceMaps, 'station', { top: 20, direction: 'negative' }),
		top_vehicle_negative_sources: buildTopContributors(deduped, sourceMaps, 'vehicle', { top: 20, direction: 'negative' }),
		top_asset_negative_sources: buildTopContributors(deduped, sourceMaps, 'asset', { top: 20, direction: 'negative' }),
		top_in_bottle_positive_sources: buildTopContributors(deduped, sourceMaps, 'inBottle', { top: 20, direction: 'positive' }),
		suspected_duplicate_sales: suspectedDuplicateSales,
		suspected_duplicate_sale_impact: summarizeDuplicateSaleImpact(suspectedDuplicateSales),
		interesting_days: findInterestingDays(dayKindRows),
		by_day_and_kind: dayKindRows
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

	const quick = {
		remote_inventory: remoteSummary.inventory || {},
		local_inventory: {
			asset_total_t: localSummary.asset_total_t,
			station_total_t: localSummary.station_total_t,
			in_bottle_total_t: localSummary.in_bottle_total_t,
			vehicle_total_t: localSummary.vehicle_total_t,
			balance_diff_t: localSummary.balance_diff_t
		},
		required_opening_t: result.required_opening_t,
		first_negative: result.first_negative,
		top_in_bottle_negative_sources: result.top_in_bottle_negative_sources.slice(0, 5)
	}
	process.stdout.write(`${JSON.stringify(quick, null, 2)}\n`)
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : err)
	process.exit(1)
})
