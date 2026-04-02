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

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		return normalizeString(value.$oid || value.oid || value.id || value._id)
	}
	return normalizeString(value)
}

function toBool(value, fallback = false) {
	if (value === true || value === 'true' || value === '1' || value === 1) return true
	if (value === false || value === 'false' || value === '0' || value === 0) return false
	return fallback
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function parseArgs(argv) {
	const now = new Date()
	const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
	const out = {
		spaceId: normalizeString(process.env.SPACE_ID) || 'env-00jxuffegf2n',
		username: 'superadmin',
		password: 'y7ez5CGAbivZkeP',
		fromBottleNo: 'J71',
		toBottleNo: 'J76',
		execute: false,
		outFile: path.resolve(process.cwd(), `docs/bottle_alias_sync_${ts}.json`),
		maxSalesScan: 3000
	}
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i]
		if (!arg) continue
		if (arg === '--execute') {
			out.execute = true
			continue
		}
		const m = String(arg).match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'space-id') out.spaceId = normalizeString(value) || out.spaceId
		if (key === 'username') out.username = normalizeString(value) || out.username
		if (key === 'password') out.password = normalizeString(value) || out.password
		if (key === 'from') out.fromBottleNo = normalizeBottleNo(value) || out.fromBottleNo
		if (key === 'to') out.toBottleNo = normalizeBottleNo(value) || out.toBottleNo
		if (key === 'out') out.outFile = path.resolve(process.cwd(), value || out.outFile)
		if (key === 'max-sales-scan') out.maxSalesScan = Math.max(100, Number(value) || out.maxSalesScan)
	}
	if (!out.spaceId) throw new Error('缺少 --space-id')
	if (!out.fromBottleNo) throw new Error('缺少 --from')
	if (!out.toBottleNo) throw new Error('缺少 --to')
	if (out.fromBottleNo === out.toBottleNo) throw new Error('--from 和 --to 不能相同')
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
	return fs.readdirSync(base).map((dir) => path.join(base, dir, 'setting.json')).filter((file) => fs.existsSync(file))
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
	throw new Error(`未找到空间 ${spaceId} 的支付宝配置`)
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

async function callCrm(client, token, functionName, action, data) {
	const res = await client.callFunction(functionName, {
		action,
		token,
		data,
		request_id: generateRequestId()
	})
	if (!res || res.code !== 0) throw new Error(`${functionName}.${action} 失败: ${JSON.stringify(res)}`)
	return res
}

function chooseCanonicalBottle(rows = []) {
	if (!rows.length) return null
	const sorted = [...rows].sort((a, b) => {
		const activeDiff = Number(toBool(b && b.is_active, false)) - Number(toBool(a && a.is_active, false))
		if (activeDiff !== 0) return activeDiff
		const updatedDiff = toNumber(b && b.updated_at, 0) - toNumber(a && a.updated_at, 0)
		if (updatedDiff !== 0) return updatedDiff
		return normalizeId(a && a._id).localeCompare(normalizeId(b && b._id))
	})
	return sorted[0] || null
}

function splitDelivery(value) {
	const text = normalizeString(value)
	if (!text) return { delivery1: '', delivery2: '' }
	const parts = text.split(/[\/,，;；]/).map((item) => normalizeString(item)).filter(Boolean)
	if (parts.length >= 2) return { delivery1: parts[0], delivery2: parts[1] }
	return { delivery1: text, delivery2: '' }
}

function cloneRows(rows) {
	return Array.isArray(rows) ? rows.map((row) => ({ ...(row || {}) })) : []
}

function rewriteBottleRows(rows, fromNo, toNo, canonicalBottleId, aliasBottleIds) {
	let changed = false
	const out = cloneRows(rows).map((row) => {
		const next = { ...(row || {}) }
		const bottleNo = normalizeBottleNo(next.bottle_no || next.bottleNo)
		const bottleId = normalizeId(next.bottle_id || next.bottleId)
		let rowChanged = false
		if (bottleNo === fromNo) {
			next.bottle_no = toNo
			rowChanged = true
		}
		const shouldBindCanonicalId =
			Boolean(canonicalBottleId) &&
			(
				(bottleNo === fromNo || bottleNo === toNo) ||
				(bottleId && aliasBottleIds.has(bottleId))
			)
		if (shouldBindCanonicalId && normalizeId(next.bottle_id) !== canonicalBottleId) {
			next.bottle_id = canonicalBottleId
			rowChanged = true
		}
		if (rowChanged) changed = true
		return next
	})
	return { rows: out, changed }
}

function hasAnyRefToBottleNos(doc, bottleNos = []) {
	const set = new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean))
	if (!set.size) return false
	const fields = ['out_items', 'back_items', 'deposit_rows', 'deposit_items', 'agent_sale_items']
	for (const field of fields) {
		const list = Array.isArray(doc && doc[field]) ? doc[field] : []
		for (const item of list) {
			const no = normalizeBottleNo(item && item.bottle_no)
			if (set.has(no)) return true
		}
	}
	return false
}

function buildSaleUpdatePayload(doc, patchedRows) {
	const delivery = splitDelivery(doc.delivery_man)
	return {
		base: {
			date: normalizeString(doc.date),
			customerId: normalizeId(doc.customer_id),
			delivery1: delivery.delivery1,
			delivery2: delivery.delivery2,
			vehicleId: normalizeId(doc.vehicle_id),
			carNo: normalizeString(doc.car_no),
			bizMode: normalizeString(doc.biz_mode),
			settlementMode: normalizeString(doc.settlement_mode),
			priceUnit: normalizeString(doc.price_unit),
			unitPrice: toNumber(doc.unit_price, 0),
			paymentStatus: normalizeString(doc.payment_status),
			amountReceived: toNumber(doc.amount_received, 0),
			roundingAmount: toNumber(doc.rounding_amount, 0),
			paymentNote: normalizeString(doc.payment_note),
			remark: normalizeString(doc.remark),
			ticketImage: normalizeString(doc.ticket_image),
			truckNo: normalizeString(doc.truck_no),
			truckOutGross: toNumber(doc.truck_out_gross, 0),
			truckBackGross: toNumber(doc.truck_back_gross, 0),
			truckGrossDiff: toNumber(doc.truck_gross_diff, 0),
			truckSaleNet: toNumber(doc.truck_sale_net, 0),
			flowIndexPrev: doc.flow_index_prev == null ? null : toNumber(doc.flow_index_prev, null),
			flowIndexCurr: doc.flow_index_curr == null ? null : toNumber(doc.flow_index_curr, null),
			flowVolumeM3: doc.flow_volume_m3 == null ? null : toNumber(doc.flow_volume_m3, null),
			flowTheoryRatio: doc.flow_theory_ratio == null ? null : toNumber(doc.flow_theory_ratio, null)
		},
		outRows: patchedRows.outRows,
		backRows: patchedRows.backRows,
		depositRows: patchedRows.depositRows,
		agentSaleRows: patchedRows.agentRows
	}
}

async function fetchExactBottles(client, token, bottleNo) {
	const target = normalizeBottleNo(bottleNo)
	const res = await callCrm(client, token, 'crm-bottle', 'listV1', {
		keyword: target,
		page: 1,
		pageSize: 50,
		bottle_no_mode: 'all',
		is_active: undefined
	})
	const rows = Array.isArray(res.data) ? res.data : []
	return rows.filter((row) => normalizeBottleNo(row && row.bottle_no) === target)
}

async function fetchAllFillingsByBottleNo(client, token, bottleNo) {
	const target = normalizeBottleNo(bottleNo)
	const out = []
	let page = 1
	const pageSize = 50
	while (true) {
		const res = await callCrm(client, token, 'crm-filling', 'listV1', {
			bottle_no: target,
			page,
			pageSize
		})
		const rows = Array.isArray(res.data) ? res.data : []
		out.push(...rows)
		if (!res.paging || !res.paging.hasMore || rows.length === 0) break
		page += 1
		if (page > 500) break
	}
	return out
}

async function fetchAllMovementRowsByBottleNo(client, token, bottleNo) {
	const target = normalizeBottleNo(bottleNo)
	const out = []
	let page = 1
	const pageSize = 200
	while (true) {
		const res = await callCrm(client, token, 'crm-bottle-movement', 'listV1', {
			bottle_no: target,
			page,
			pageSize
		})
		const rows = Array.isArray(res.data) ? res.data : []
		out.push(...rows)
		if (!res.paging || !res.paging.hasMore || rows.length === 0) break
		page += 1
		if (page > 300) break
	}
	return out
}

async function fetchAllSaleIds(client, token, maxTotal = 3000) {
	const ids = []
	let page = 1
	const pageSize = 100
	while (true) {
		const res = await callCrm(client, token, 'crm-sale', 'listV2', {
			page,
			pageSize
		})
		const rows = Array.isArray(res.data) ? res.data : []
		rows.forEach((row) => {
			const id = normalizeId(row && row._id)
			if (id) ids.push(id)
		})
		if (!res.paging || !res.paging.hasMore || rows.length === 0) break
		page += 1
		if (ids.length >= maxTotal || page > 1000) break
	}
	return Array.from(new Set(ids))
}

async function getSaleDoc(client, token, id) {
	const res = await callCrm(client, token, 'crm-sale', 'getV2', { _id: id })
	return res.data || null
}

function patchSaleDocBottleRefs(doc, fromNo, toNo, canonicalBottleId, aliasBottleIds) {
	const outPatched = rewriteBottleRows(doc.out_items, fromNo, toNo, canonicalBottleId, aliasBottleIds)
	const backPatched = rewriteBottleRows(doc.back_items, fromNo, toNo, canonicalBottleId, aliasBottleIds)
	const depositPatched = rewriteBottleRows(doc.deposit_rows, fromNo, toNo, canonicalBottleId, aliasBottleIds)
	const agentPatched = rewriteBottleRows(doc.agent_sale_items, fromNo, toNo, canonicalBottleId, aliasBottleIds)
	return {
		changed: outPatched.changed || backPatched.changed || depositPatched.changed || agentPatched.changed,
		outRows: outPatched.rows,
		backRows: backPatched.rows,
		depositRows: depositPatched.rows,
		agentRows: agentPatched.rows
	}
}

async function runAnomalyScanForBottle(client, token, bottleNo) {
	return callCrm(client, token, 'crm-bottle-anomaly', 'scanV2', {
		bottle_no: bottleNo
	})
}

async function runStatusRebuild(client, token, bottleNos = []) {
	return callCrm(client, token, 'crm-bottle', 'rebuildCurrentStatusV1', {
		preview: false,
		only_active: false,
		include_special_status: true,
		bottle_nos: bottleNos
	})
}

async function main() {
	const args = parseArgs(process.argv)
	const config = loadAlipayConfig(args.spaceId)
	const client = new AlipayFunctionClient(config)
	const token = await login(client, args.username, args.password)

	const fromNo = normalizeBottleNo(args.fromBottleNo)
	const toNo = normalizeBottleNo(args.toBottleNo)

	const fromBottleRows = await fetchExactBottles(client, token, fromNo)
	const toBottleRows = await fetchExactBottles(client, token, toNo)
	const canonicalToBottle = chooseCanonicalBottle(toBottleRows)
	const canonicalToBottleId = normalizeId(canonicalToBottle && canonicalToBottle._id)
	const aliasBottleIds = new Set(
		[...fromBottleRows, ...toBottleRows]
			.map((row) => normalizeId(row && row._id))
			.filter(Boolean)
	)

	const fillingRowsFrom = await fetchAllFillingsByBottleNo(client, token, fromNo)
	const movementRowsFromBefore = await fetchAllMovementRowsByBottleNo(client, token, fromNo)
	const movementRowsToBefore = await fetchAllMovementRowsByBottleNo(client, token, toNo)

	const saleIds = await fetchAllSaleIds(client, token, args.maxSalesScan)
	const saleCandidates = []
	const salePatchPlans = []

	for (let i = 0; i < saleIds.length; i += 1) {
		const id = saleIds[i]
		const doc = await getSaleDoc(client, token, id)
		if (!doc) continue
		if (!hasAnyRefToBottleNos(doc, [fromNo, toNo]) && !aliasBottleIds.size) continue
		const patched = patchSaleDocBottleRefs(doc, fromNo, toNo, canonicalToBottleId, aliasBottleIds)
		if (!patched.changed) continue
		saleCandidates.push({
			_id: normalizeId(doc._id),
			date: normalizeString(doc.date),
			customer_name: normalizeString(doc.customer_name),
			biz_mode: normalizeString(doc.biz_mode)
		})
		salePatchPlans.push({
			_id: normalizeId(doc._id),
			payload: buildSaleUpdatePayload(doc, patched)
		})
	}

	const report = {
		generated_at: new Date().toISOString(),
		space_id: args.spaceId,
		config_from: config.from,
		execute: args.execute,
		from_bottle_no: fromNo,
		to_bottle_no: toNo,
		bottle_mapping: {
			from_rows: fromBottleRows.map((row) => ({
				_id: normalizeId(row && row._id),
				bottle_no: normalizeBottleNo(row && row.bottle_no),
				is_active: toBool(row && row.is_active, false)
			})),
			to_rows: toBottleRows.map((row) => ({
				_id: normalizeId(row && row._id),
				bottle_no: normalizeBottleNo(row && row.bottle_no),
				is_active: toBool(row && row.is_active, false)
			})),
			canonical_to_bottle_id: canonicalToBottleId
		},
		before: {
			fillings_from_total: fillingRowsFrom.length,
			movements_from_total: movementRowsFromBefore.length,
			movements_to_total: movementRowsToBefore.length
		},
		plan: {
			update_fillings_total: fillingRowsFrom.length,
			update_sales_total: salePatchPlans.length,
			sales_sample: saleCandidates.slice(0, 30)
		},
		execute_result: null,
		after: null
	}

	if (args.execute) {
		const fillingUpdateResults = []
		for (const row of fillingRowsFrom) {
			try {
				const res = await callCrm(client, token, 'crm-filling', 'updateV1', {
					_id: normalizeId(row && row._id),
					bottle_no: toNo,
					ignore_bottle_flow_warning: true
				})
				fillingUpdateResults.push({ _id: normalizeId(row && row._id), ok: true, msg: normalizeString(res.msg) || 'ok' })
			} catch (err) {
				fillingUpdateResults.push({ _id: normalizeId(row && row._id), ok: false, msg: normalizeString(err && err.message) })
			}
		}

		const saleUpdateResults = []
		for (const plan of salePatchPlans) {
			try {
				await callCrm(client, token, 'crm-sale', 'updateV2', {
					recordId: plan._id,
					payload: plan.payload,
					ignore_bottle_flow_warning: true
				})
				saleUpdateResults.push({ _id: plan._id, ok: true })
			} catch (err) {
				saleUpdateResults.push({ _id: plan._id, ok: false, msg: normalizeString(err && err.message) })
			}
		}

		const scanResults = []
		for (const bottleNo of Array.from(new Set([fromNo, toNo]))) {
			try {
				const res = await runAnomalyScanForBottle(client, token, bottleNo)
				scanResults.push({
					bottle_no: bottleNo,
					ok: true,
					new_count: toNumber(res && res.new_count, 0),
					auto_resolved_count: toNumber(res && res.auto_resolved_count, 0),
					open_total: toNumber(res && res.open_total, 0)
				})
			} catch (err) {
				scanResults.push({ bottle_no: bottleNo, ok: false, msg: normalizeString(err && err.message) })
			}
		}

		let rebuildResult = null
		try {
			const res = await runStatusRebuild(client, token, [fromNo, toNo])
			rebuildResult = res.data || null
		} catch (err) {
			rebuildResult = { ok: false, msg: normalizeString(err && err.message) }
		}

		const fillingRowsFromAfter = await fetchAllFillingsByBottleNo(client, token, fromNo)
		const fillingRowsToAfter = await fetchAllFillingsByBottleNo(client, token, toNo)
		const movementRowsFromAfter = await fetchAllMovementRowsByBottleNo(client, token, fromNo)
		const movementRowsToAfter = await fetchAllMovementRowsByBottleNo(client, token, toNo)

		report.execute_result = {
			filling_updates: fillingUpdateResults,
			sale_updates: saleUpdateResults,
			scans: scanResults,
			status_rebuild: rebuildResult
		}
		report.after = {
			fillings_from_total: fillingRowsFromAfter.length,
			fillings_to_total: fillingRowsToAfter.length,
			movements_from_total: movementRowsFromAfter.length,
			movements_to_total: movementRowsToAfter.length
		}
	}

	fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
	fs.writeFileSync(args.outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
	process.stdout.write(
		`${JSON.stringify(
			{
				ok: true,
				execute: args.execute,
				out_file: args.outFile,
				plan: report.plan,
				after: report.after
			},
			null,
			2
		)}\n`
	)
}

main().catch((err) => {
	console.error('[syncBottleAliasRefs] FAIL', err && err.stack ? err.stack : err)
	process.exit(1)
})

