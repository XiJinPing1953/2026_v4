'use strict'

let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-dashboard] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const sales = db.collection('crm_sale_records')
const fillings = db.collection('crm_fillings')
const flowSettlements = db.collection('crm_customer_flow_settlements')
const receipts = db.collection('crm_customer_receipts')
const bottles = db.collection('crm_bottles')
const anomalies = db.collection('crm_bottle_anomalies')
const tankTelemetry = db.collection('crm_tank_telemetry')
const PAGE_ACTION_RULES = {
	summaryV1: [{ pagePath: '/pages/index/index', action: 'view' }]
}
const SUPERADMIN_ONLY_ACTIONS = ['ingestTankTelemetry']

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-dashboard] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	const num = Number(value || 0)
	return Math.round(num * 100) / 100
}

function clampNumber(value, min, max) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return Math.min(Math.max(num, min), max)
}

function normalizeSettlementMode(value, fallback = 'sale') {
	const text = normalizeString(value)
	if (text === 'customer_flow' || text === 'sale') return text
	return fallback
}

function normalizeBizModeValue(value) {
	const text = normalizeString(value)
	if (text === 'truck' || text === 'agent_sale' || text === 'bottle') return text
	return 'bottle'
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/[\s\r\n\t\u3000]+/g, '')
}

function normalizeFillingRecordType(value) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return 'normal_fill'
	if (text === 'normal_fill' || text === 'truck_out_agent_sale' || text === 'truck_out_no_sale') return text
	return 'normal_fill'
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function getCNDate(ts = Date.now()) {
	return new Date(ts + 8 * 60 * 60 * 1000)
}

function formatDateCN(date) {
	const y = date.getUTCFullYear()
	const m = date.getUTCMonth() + 1
	const d = date.getUTCDate()
	return `${y}-${pad2(m)}-${pad2(d)}`
}

function getRecentDates(days) {
	const total = Math.min(Math.max(Number(days || 7), 3), 31)
	const now = getCNDate()
	const dates = []
	for (let i = total - 1; i >= 0; i -= 1) {
		const d = new Date(now)
		d.setUTCDate(d.getUTCDate() - i)
		dates.push(formatDateCN(d))
	}
	return dates
}

function addDaysDateCN(dateText, days) {
	const text = normalizeString(dateText)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
	const [year, month, day] = text.split('-').map((item) => Number(item))
	const date = new Date(Date.UTC(year, month - 1, day))
	date.setUTCDate(date.getUTCDate() + Number(days || 0))
	return formatDateCN(date)
}

function normalizeTimestamp(value, fallback = Date.now()) {
	if (value == null || value === '') return fallback
	const num = Number(value)
	if (Number.isFinite(num) && num > 0) return num < 1000000000000 ? num * 1000 : num
	const parsed = Date.parse(String(value))
	return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeTankId(value) {
	return normalizeString(value) || 'main'
}

function normalizeTankStatus(value, fallback = 'online') {
	const text = normalizeString(value).toLowerCase()
	if (text === 'online' || text === 'stale' || text === 'error' || text === 'empty') return text
	return fallback
}

function nullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function buildTankSummary(row, now = Date.now()) {
	if (!row) {
		return {
			level_m: null,
			level_percent: null,
			pressure_mpa: null,
			status: 'empty',
			sampled_at: null,
			updated_at: null,
			message: '等待现场网关上报'
		}
	}
	const sampledAt = nullableNumber(row.sampled_at)
	const updatedAt = nullableNumber(row.updated_at)
	const ageBase = sampledAt || updatedAt || 0
	const baseStatus = normalizeTankStatus(row.status)
	const isStale = baseStatus !== 'error' && ageBase > 0 && now - ageBase > 60 * 1000
	const status = isStale ? 'stale' : baseStatus
	const fallbackMessage =
		status === 'stale'
			? '超过60秒未收到新数据'
			: status === 'error'
				? '采集异常'
				: status === 'empty'
					? '等待现场网关上报'
					: ''
	return {
		level_m: nullableNumber(row.level_m),
		level_percent: nullableNumber(row.level_percent),
		pressure_mpa: nullableNumber(row.pressure_mpa),
		status,
		sampled_at: sampledAt,
		updated_at: updatedAt,
		message: normalizeString(row.message) || fallbackMessage
	}
}

async function getTankTelemetrySummary(tankId = 'main') {
	try {
		const res = await tankTelemetry.where({ tank_id: normalizeTankId(tankId) }).orderBy('updated_at', 'desc').limit(1).get()
		return buildTankSummary((res.data && res.data[0]) || null)
	} catch (err) {
		console.error('[crm-dashboard] getTankTelemetrySummary failed', err)
		return {
			level_m: null,
			level_percent: null,
			pressure_mpa: null,
			status: 'error',
			sampled_at: null,
			updated_at: null,
			message: '储罐读数加载失败'
		}
	}
}

function normalizeRawTelemetry(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
	return raw
}

function getMonthRange(date) {
	const y = date.getUTCFullYear()
	const m = date.getUTCMonth() + 1
	const start = `${y}-${pad2(m)}-01`
	const endDate = new Date(Date.UTC(y, m, 0))
	const end = formatDateCN(endDate)
	return { start, end }
}

function getPrevMonthRange(date) {
	const y = date.getUTCFullYear()
	const m = date.getUTCMonth()
	const startDate = new Date(Date.UTC(y, m - 1, 1))
	const start = formatDateCN(startDate)
	const endDate = new Date(Date.UTC(y, m, 0))
	const end = formatDateCN(endDate)
	return { start, end }
}

async function fetchAll(collection, where, field) {
	const pageSize = 200
	let page = 0
	let list = []
	while (true) {
		let query = collection.where(where)
		if (field) query = query.field(field)
		const res = await query.skip(page * pageSize).limit(pageSize).get()
		const rows = res.data || []
		list = list.concat(rows)
		if (rows.length < pageSize) break
		page += 1
	}
	return list
}

async function countInspectionDueByField(field, today, dueEnd) {
	const validDateRx = db.RegExp({ regexp: '^\\d{4}-\\d{2}-\\d{2}$', options: '' })
	const overdueWhere = dbCmd.and([{ [field]: validDateRx }, { [field]: dbCmd.lt(today) }])
	const dueWhere = dbCmd.and([{ [field]: validDateRx }, { [field]: dbCmd.gte(today) }, { [field]: dbCmd.lte(dueEnd) }])
	const overdueRes = await bottles.where(overdueWhere).count()
	const dueRes = await bottles.where(dueWhere).count()
	const overdue = Number(overdueRes.total || 0)
	const due60 = Number(dueRes.total || 0)
	return {
		overdue,
		due_60d: due60,
		total: overdue + due60
	}
}

function resolveTruckReferenceNetValue(rawTruckGrossDiff, rawTruckOutGross, rawTruckBackGross) {
	const outGross = rawTruckOutGross === '' || rawTruckOutGross == null ? null : toNumber(rawTruckOutGross, null)
	const backGross = rawTruckBackGross === '' || rawTruckBackGross == null ? null : toNumber(rawTruckBackGross, null)
	if (outGross != null && backGross != null) return Math.max(outGross - backGross, 0)
	const grossDiff = rawTruckGrossDiff === '' || rawTruckGrossDiff == null ? null : toNumber(rawTruckGrossDiff, null)
	if (grossDiff != null && Number.isFinite(grossDiff) && grossDiff > 0) return grossDiff
	return 0
}

function resolveTruckSettlementNetValue(rawTruckSaleNet, rawTruckSettleTare, rawTruckSettleGross) {
	const settleTare = rawTruckSettleTare === '' || rawTruckSettleTare == null ? null : toNumber(rawTruckSettleTare, null)
	const settleGross = rawTruckSettleGross === '' || rawTruckSettleGross == null ? null : toNumber(rawTruckSettleGross, null)
	if (settleTare != null && settleGross != null) return Math.max(settleGross - settleTare, 0)
	const explicit = rawTruckSaleNet === '' || rawTruckSaleNet == null ? null : toNumber(rawTruckSaleNet, null)
	if (explicit != null && Number.isFinite(explicit) && explicit > 0) return explicit
	return 0
}

function resolveTruckBillableNetValue({
	priceUnit = 'kg',
	rawTruckGrossDiff = null,
	rawTruckSaleNet = null,
	rawTruckOutGross = null,
	rawTruckBackGross = null,
	rawTruckSettleTare = null,
	rawTruckSettleGross = null
} = {}) {
	const referenceNet = resolveTruckReferenceNetValue(rawTruckGrossDiff, rawTruckOutGross, rawTruckBackGross)
	if (normalizeString(priceUnit) === 'kg') {
		const settlementNet = resolveTruckSettlementNetValue(rawTruckSaleNet, rawTruckSettleTare, rawTruckSettleGross)
		if (settlementNet > 0) return settlementNet
	}
	return referenceNet
}

function computeAmounts({
	settlementMode = 'sale',
	bizMode,
	priceUnit,
	unitPrice,
	outItems,
	backItems,
	agentRows,
	truckSaleNet,
	truckOutGross,
	truckBackGross,
	truckSettleTare,
	truckSettleGross,
	flow
}) {
	let outNetTotal = outItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	let backNetTotal = backItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	const agentTotalWeight = (Array.isArray(agentRows) ? agentRows : []).reduce((sum, row) => sum + toNumber(row.fill_weight, 0), 0)

	let totalNetWeight = outNetTotal - backNetTotal
	if (bizMode === 'truck') {
		totalNetWeight = resolveTruckBillableNetValue({
			priceUnit,
			rawTruckGrossDiff: null,
			rawTruckSaleNet: truckSaleNet,
			rawTruckOutGross: truckOutGross,
			rawTruckBackGross: truckBackGross,
			rawTruckSettleTare: truckSettleTare,
			rawTruckSettleGross: truckSettleGross
		})
	} else if (bizMode === 'agent_sale') {
		outNetTotal = agentTotalWeight
		backNetTotal = 0
		totalNetWeight = agentTotalWeight
	}

	if (normalizeSettlementMode(settlementMode) === 'customer_flow') {
		return {
			out_net_total: outNetTotal,
			back_net_total: backNetTotal,
			total_net_weight: totalNetWeight,
			out_amount: 0,
			back_amount: 0,
			should_receive: 0
		}
	}

	let outAmount = 0
	let backAmount = 0
	let shouldReceive = 0

	if (bizMode === 'agent_sale') {
		outAmount = agentTotalWeight * unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'kg') {
		outAmount = outNetTotal * unitPrice
		backAmount = backNetTotal * unitPrice
		shouldReceive = totalNetWeight * unitPrice
	} else if (priceUnit === 'bottle') {
		outAmount = outItems.length * unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'm3') {
		const flowVolume = toNumber(flow?.flow_volume_m3, 0)
		outAmount = flowVolume * unitPrice
		shouldReceive = outAmount
	}

	return {
		out_net_total: outNetTotal,
		back_net_total: backNetTotal,
		total_net_weight: totalNetWeight,
		out_amount: fix2(outAmount),
		back_amount: fix2(backAmount),
		should_receive: fix2(shouldReceive)
	}
}

function computeSaleAmount(doc) {
	const bizMode = normalizeBizModeValue(doc && doc.biz_mode)
	const priceUnit = normalizeString(doc && doc.price_unit) || 'kg'
	const settlementMode = priceUnit === 'm3' ? 'customer_flow' : normalizeSettlementMode(doc.settlement_mode, 'sale')
	if (settlementMode === 'customer_flow') return 0
	const unitPrice = toNumber(doc.unit_price, 0)
	const outItems = Array.isArray(doc.out_items) ? doc.out_items : []
	const backItems = Array.isArray(doc.back_items) ? doc.back_items : []
	const agentRows = Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : []
	const flow = { flow_volume_m3: toNumber(doc.flow_volume_m3, 0) }
	const amounts = computeAmounts({
		settlementMode,
		bizMode,
		priceUnit,
		unitPrice,
		outItems,
		backItems,
		agentRows,
		truckSaleNet: resolveTruckBillableNetValue({
			priceUnit,
			rawTruckGrossDiff: doc.truck_gross_diff,
			rawTruckSaleNet: doc.truck_sale_net,
			rawTruckOutGross: doc.truck_out_gross,
			rawTruckBackGross: doc.truck_back_gross,
			rawTruckSettleTare: doc.truck_settle_tare,
			rawTruckSettleGross: doc.truck_settle_gross
		}),
		truckOutGross: doc.truck_out_gross,
		truckBackGross: doc.truck_back_gross,
		truckSettleTare: doc.truck_settle_tare,
		truckSettleGross: doc.truck_settle_gross,
		flow
	})
	return toNumber(amounts.should_receive, 0)
}

function computeBottleShipmentWeight(doc) {
	const outItems = Array.isArray(doc && doc.out_items) ? doc.out_items : []
	const backItems = Array.isArray(doc && doc.back_items) ? doc.back_items : []
	const outNet = outItems.reduce((sum, item) => sum + toNumber(item && item.net, 0), 0)
	const backNet = backItems.reduce((sum, item) => sum + toNumber(item && item.net, 0), 0)
	return fix2(outNet - backNet)
}

function computeAgentShipmentWeight(doc) {
	const rows = Array.isArray(doc && doc.agent_sale_items) ? doc.agent_sale_items : []
	return fix2(rows.reduce((sum, row) => sum + toNumber(row && row.fill_weight, 0), 0))
}

function computeTruckShipmentWeight(doc) {
	const priceUnit = normalizeString(doc && doc.price_unit) || 'kg'
	return fix2(
		resolveTruckBillableNetValue({
			priceUnit,
			rawTruckGrossDiff: doc && doc.truck_gross_diff,
			rawTruckSaleNet: doc && doc.truck_sale_net,
			rawTruckOutGross: doc && doc.truck_out_gross,
			rawTruckBackGross: doc && doc.truck_back_gross,
			rawTruckSettleTare: doc && doc.truck_settle_tare,
			rawTruckSettleGross: doc && doc.truck_settle_gross
		})
	)
}

function detectShipmentMode(doc) {
	const bizMode = normalizeString(doc && doc.biz_mode)
	if (bizMode === 'truck') return 'truck'
	if (bizMode === 'agent_sale') return 'agent'
	return 'bottle'
}

function computeShipmentWeight(doc) {
	const mode = detectShipmentMode(doc)
	if (mode === 'truck') return computeTruckShipmentWeight(doc)
	if (mode === 'agent') return computeAgentShipmentWeight(doc)
	return computeBottleShipmentWeight(doc)
}

function detectGasFlowMode(doc) {
	const recordType = normalizeFillingRecordType(doc && doc.record_type)
	if (recordType === 'truck_out_no_sale') return 'vehicle'
	if (normalizeBottleNo(doc && doc.bottle_no) === '000') return 'local'
	return 'bottle'
}

function buildCustomerKey(doc) {
	const customerId = normalizeString(doc && doc.customer_id)
	if (customerId) return `id:${customerId}`
	const customerName = normalizeString(doc && doc.customer_name)
	if (customerName) return `name:${customerName}`
	return ''
}

function computeSaleBottleCount(doc) {
	const bizMode = normalizeString(doc && doc.biz_mode)
	if (bizMode === 'agent_sale') return Array.isArray(doc && doc.agent_sale_items) ? doc.agent_sale_items.length : 0
	if (bizMode === 'bottle') return Array.isArray(doc && doc.out_items) ? doc.out_items.length : 0
	return 0
}

function computeSaleWeight(doc) {
	const bizMode = normalizeString(doc && doc.biz_mode)
	if (bizMode === 'truck') return computeTruckShipmentWeight(doc)
	if (bizMode === 'agent_sale') return computeAgentShipmentWeight(doc)
	return computeBottleShipmentWeight(doc)
}

function classifyAnomalyGroup(type) {
	const normalized = normalizeString(type)
	if (!normalized) return 'other'
	if (normalized === 'missing_truck_fill' || normalized === 'truck_return_diff_excess' || normalized === 'missing_truck_back_gross') {
		return 'truck'
	}
	if (normalized.startsWith('continuous_')) return 'continuous'
	if (normalized.startsWith('missing_')) return 'missing'
	return 'other'
}

async function ingestTankTelemetry(user, data, requestId) {
	const tankId = normalizeTankId(data.tank_id || data.tankId)
	const gatewayId = normalizeString(data.gateway_id || data.gatewayId) || 'tank-gateway'
	const status = normalizeTankStatus(data.status, 'online')
	const levelM = nullableNumber(data.level_m ?? data.levelM)
	const pressureMpa = nullableNumber(data.pressure_mpa ?? data.pressureMpa)
	const rawFullLevelM = nullableNumber(data.full_level_m ?? data.fullLevelM)
	const fullLevelM = rawFullLevelM != null && rawFullLevelM > 0 ? rawFullLevelM : 10
	const explicitPercent = nullableNumber(data.level_percent ?? data.levelPercent)
	const computedPercent = levelM != null && fullLevelM > 0 ? (levelM / fullLevelM) * 100 : null
	const levelPercent = explicitPercent != null ? explicitPercent : computedPercent
	const sampledAt = normalizeTimestamp(data.sampled_at ?? data.sampledAt, Date.now())
	const now = Date.now()

	if (status !== 'error' && (levelM == null || pressureMpa == null)) {
		return { code: 400, msg: '缺少有效液位或压力读数' }
	}

	const doc = {
		tank_id: tankId,
		gateway_id: gatewayId,
		plc_host: normalizeString(data.plc_host || data.plcHost),
		status,
		level_m: levelM == null ? null : fix2(levelM),
		level_percent: levelPercent == null ? null : fix2(clampNumber(levelPercent, 0, 100)),
		pressure_mpa: pressureMpa == null ? null : fix2(pressureMpa),
		full_level_m: fullLevelM,
		raw: normalizeRawTelemetry(data.raw),
		message: normalizeString(data.message),
		sampled_at: sampledAt,
		updated_at: now
	}

	const existingRes = await tankTelemetry.where({ tank_id: tankId }).field({ _id: true }).limit(1).get()
	const existing = existingRes.data && existingRes.data[0]
	if (existing && existing._id) {
		await tankTelemetry.doc(existing._id).update(doc)
	} else {
		await tankTelemetry.add({ ...doc, created_at: now })
	}

	return { code: 0, data: buildTankSummary(doc, now) }
}

async function summaryV1(user, data, requestId) {
	const days = Math.min(Math.max(Number(data.days || 7), 3), 31)
	const today = getCNDate()
	const recentDates = getRecentDates(days)
	const weekStart = recentDates[0]
	const weekEnd = recentDates[recentDates.length - 1]

	const anomalyCountRes = await anomalies.where({ status: 'open' }).count()
	const anomalyOpen = anomalyCountRes.total || 0

	const atCustomerRes = await bottles.where({ status: 'at_customer' }).count()
	const inStationRes = await bottles.where({ status: 'in_station' }).count()

	const weekWhere = dbCmd.and([{ date: dbCmd.gte(weekStart) }, { date: dbCmd.lte(weekEnd) }])
	const weekSales = await fetchAll(sales, weekWhere, {
		date: true,
		biz_mode: true,
		customer_id: true,
		customer_name: true,
		price_unit: true,
		settlement_mode: true,
		unit_price: true,
		out_items: true,
		back_items: true,
		agent_sale_items: true,
		truck_gross_diff: true,
		truck_sale_net: true,
		truck_out_gross: true,
		truck_back_gross: true,
		truck_settle_tare: true,
		truck_settle_gross: true,
		flow_volume_m3: true
	})
	const trendMap = {}
	const amountTrendMap = {}
	const dailyReportMap = {}
	const dailyCustomerMap = {}
	const receivableMap = {}
	const receiptMap = {}
	recentDates.forEach((date) => {
		trendMap[date] = 0
		amountTrendMap[date] = 0
		receivableMap[date] = 0
		receiptMap[date] = 0
		dailyCustomerMap[date] = new Set()
		dailyReportMap[date] = {
			fill_bottle_count: 0,
			fill_bottle_weight: 0,
			local_count: 0,
			local_weight: 0,
			vehicle_count: 0,
			vehicle_weight: 0,
			sale_customer_count: 0,
			sale_bottle_count: 0,
			sale_weight: 0
		}
	})
	weekSales.forEach((row) => {
		const key = normalizeString(row.date)
		if (key && trendMap[key] != null) {
			trendMap[key] += 1
			const saleAmount = computeSaleAmount(row)
			amountTrendMap[key] = fix2(amountTrendMap[key] + saleAmount)
			receivableMap[key] = fix2(receivableMap[key] + saleAmount)
			const customerKey = buildCustomerKey(row)
			if (customerKey) dailyCustomerMap[key].add(customerKey)
			dailyReportMap[key].sale_bottle_count += computeSaleBottleCount(row)
			dailyReportMap[key].sale_weight = fix2(dailyReportMap[key].sale_weight + computeSaleWeight(row))
		}
	})
	const weekFillings = await fetchAll(fillings, weekWhere, {
		date: true,
		bottle_no: true,
		record_type: true,
		fill_weight: true
	})
	weekFillings.forEach((row) => {
		const key = normalizeString(row.date)
		if (key && dailyReportMap[key] != null) {
			const fillWeight = fix2(toNumber(row.fill_weight, 0))
			if (fillWeight <= 0) return
			const gasFlowMode = detectGasFlowMode(row)
			if (gasFlowMode === 'vehicle') {
				dailyReportMap[key].vehicle_count += 1
				dailyReportMap[key].vehicle_weight = fix2(dailyReportMap[key].vehicle_weight + fillWeight)
				return
			}
			if (gasFlowMode === 'local') {
				dailyReportMap[key].local_count += 1
				dailyReportMap[key].local_weight = fix2(dailyReportMap[key].local_weight + fillWeight)
				return
			}
			dailyReportMap[key].fill_bottle_count += 1
			dailyReportMap[key].fill_bottle_weight = fix2(dailyReportMap[key].fill_bottle_weight + fillWeight)
		}
	})
	const weekFlowSettlements = await fetchAll(
		flowSettlements,
		dbCmd.and([{ status: 'posted' }, { biz_date: dbCmd.gte(weekStart) }, { biz_date: dbCmd.lte(weekEnd) }]),
		{ biz_date: true, should_receive: true }
	)
	weekFlowSettlements.forEach((row) => {
		const key = normalizeString(row.biz_date)
		if (key && amountTrendMap[key] != null) {
			const amount = toNumber(row.should_receive, 0)
			amountTrendMap[key] = fix2(amountTrendMap[key] + amount)
			receivableMap[key] = fix2(receivableMap[key] + amount)
		}
	})
	const weekReceipts = await fetchAll(
		receipts,
		dbCmd.and([{ status: 'posted' }, { biz_date: dbCmd.gte(weekStart) }, { biz_date: dbCmd.lte(weekEnd) }]),
		{ biz_date: true, amount: true }
	)
	weekReceipts.forEach((row) => {
		const key = normalizeString(row.biz_date)
		if (key && receiptMap[key] != null) receiptMap[key] = fix2(receiptMap[key] + toNumber(row.amount, 0))
	})
	const trendWeek = recentDates.map((date) => trendMap[date] || 0)
	const overviewDates = recentDates.slice(-6)
	const overviewBars = overviewDates.map((date) => fix2(amountTrendMap[date] || 0))
	const overviewTotal = fix2(overviewBars.reduce((sum, value) => sum + toNumber(value, 0), 0))
	let overviewPeakDate = ''
	let overviewPeakAmount = 0
	overviewDates.forEach((date, index) => {
		const value = toNumber(overviewBars[index], 0)
		if (value > overviewPeakAmount) {
			overviewPeakAmount = value
			overviewPeakDate = date
		}
	})
	const overviewAvgAmount = overviewDates.length ? fix2(overviewTotal / overviewDates.length) : 0
	const dailyReportRows = [...recentDates].reverse().map((date) => {
		const row = dailyReportMap[date] || {}
		const saleCustomerCount = dailyCustomerMap[date] ? dailyCustomerMap[date].size : 0
		const fillTotalWeight = fix2(
			toNumber(row.fill_bottle_weight, 0) + toNumber(row.local_weight, 0) + toNumber(row.vehicle_weight, 0)
		)
		return {
			date,
			fill_bottle_count: Number(row.fill_bottle_count || 0),
			fill_bottle_weight: fix2(row.fill_bottle_weight || 0),
			local_count: Number(row.local_count || 0),
			local_weight: fix2(row.local_weight || 0),
			vehicle_count: Number(row.vehicle_count || 0),
			vehicle_weight: fix2(row.vehicle_weight || 0),
			fill_total_weight: fillTotalWeight,
			sale_customer_count: saleCustomerCount,
			sale_bottle_count: Number(row.sale_bottle_count || 0),
			sale_weight: fix2(row.sale_weight || 0)
		}
	})
	const dailyReportSummary = {
		fill_total_weight_kg: 0,
		sale_total_weight_kg: 0,
		customer_count: 0,
		dominant_channel: '钢瓶灌装',
		channel_totals: {
			bottle: 0,
			local: 0,
			vehicle: 0
		}
	}
	const weeklyCustomerSet = new Set()
	dailyReportRows.forEach((row) => {
		dailyReportSummary.fill_total_weight_kg = fix2(dailyReportSummary.fill_total_weight_kg + toNumber(row.fill_total_weight, 0))
		dailyReportSummary.sale_total_weight_kg = fix2(dailyReportSummary.sale_total_weight_kg + toNumber(row.sale_weight, 0))
		dailyReportSummary.channel_totals.bottle = fix2(
			dailyReportSummary.channel_totals.bottle + toNumber(row.fill_bottle_weight, 0)
		)
		dailyReportSummary.channel_totals.local = fix2(
			dailyReportSummary.channel_totals.local + toNumber(row.local_weight, 0)
		)
		dailyReportSummary.channel_totals.vehicle = fix2(
			dailyReportSummary.channel_totals.vehicle + toNumber(row.vehicle_weight, 0)
		)
	})
	recentDates.forEach((date) => {
		const set = dailyCustomerMap[date]
		if (!set) return
		set.forEach((item) => weeklyCustomerSet.add(item))
	})
	dailyReportSummary.customer_count = weeklyCustomerSet.size
	let dominantChannel = '钢瓶灌装'
	let dominantValue = dailyReportSummary.channel_totals.bottle
	if (dailyReportSummary.channel_totals.local > dominantValue) {
		dominantChannel = '地方车'
		dominantValue = dailyReportSummary.channel_totals.local
	}
	if (dailyReportSummary.channel_totals.vehicle > dominantValue) {
		dominantChannel = '车辆补给'
		dominantValue = dailyReportSummary.channel_totals.vehicle
	}
	dailyReportSummary.dominant_channel = dominantChannel
	const receivableRows = recentDates.map((date) => ({
		date,
		receivable: fix2(receivableMap[date] || 0),
		received: fix2(receiptMap[date] || 0)
	}))
	const receivableTotal = fix2(receivableRows.reduce((sum, row) => sum + toNumber(row.receivable, 0), 0))
	const receivedTotal = fix2(receivableRows.reduce((sum, row) => sum + toNumber(row.received, 0), 0))
	const receivableGap = fix2(receivableTotal - receivedTotal)
	const collectionRate = receivableTotal > 0 ? fix2((receivedTotal / receivableTotal) * 100) : null

	const monthRange = getMonthRange(today)
	const monthWhere = dbCmd.and([{ date: dbCmd.gte(monthRange.start) }, { date: dbCmd.lte(monthRange.end) }])
	const monthDocs = await fetchAll(sales, monthWhere, {
			date: true,
			biz_mode: true,
			price_unit: true,
			settlement_mode: true,
			unit_price: true,
			out_items: true,
			back_items: true,
			agent_sale_items: true,
			truck_gross_diff: true,
			truck_sale_net: true,
			truck_out_gross: true,
			truck_back_gross: true,
			truck_settle_tare: true,
			truck_settle_gross: true,
			flow_volume_m3: true
		})
	let monthTotal = 0
	monthDocs.forEach((doc) => {
		monthTotal += computeSaleAmount(doc)
	})
	const monthFlowDocs = await fetchAll(
		flowSettlements,
		dbCmd.and([{ status: 'posted' }, { biz_date: dbCmd.gte(monthRange.start) }, { biz_date: dbCmd.lte(monthRange.end) }]),
		{ should_receive: true }
	)
	monthFlowDocs.forEach((doc) => {
		monthTotal += toNumber(doc.should_receive, 0)
	})
	monthTotal = fix2(monthTotal)

	const prevRange = getPrevMonthRange(today)
	const prevWhere = dbCmd.and([{ date: dbCmd.gte(prevRange.start) }, { date: dbCmd.lte(prevRange.end) }])
	const prevDocs = await fetchAll(sales, prevWhere, {
			date: true,
			biz_mode: true,
			price_unit: true,
			settlement_mode: true,
			unit_price: true,
			out_items: true,
			back_items: true,
			agent_sale_items: true,
			truck_gross_diff: true,
			truck_sale_net: true,
			truck_out_gross: true,
			truck_back_gross: true,
			truck_settle_tare: true,
			truck_settle_gross: true,
			flow_volume_m3: true
		})
	let prevTotal = 0
	prevDocs.forEach((doc) => {
		prevTotal += computeSaleAmount(doc)
	})
	const prevFlowDocs = await fetchAll(
		flowSettlements,
		dbCmd.and([{ status: 'posted' }, { biz_date: dbCmd.gte(prevRange.start) }, { biz_date: dbCmd.lte(prevRange.end) }]),
		{ should_receive: true }
	)
	prevFlowDocs.forEach((doc) => {
		prevTotal += toNumber(doc.should_receive, 0)
	})
	prevTotal = fix2(prevTotal)

	let salesDelta = ''
	let salesTrend = ''
	if (prevTotal > 0) {
		const diff = ((monthTotal - prevTotal) / prevTotal) * 100
		salesDelta = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`
		salesTrend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
	} else if (monthTotal > 0) {
		salesDelta = '+100%'
		salesTrend = 'up'
	}

	const anomalyDocs = await fetchAll(anomalies, { status: 'open' }, { anomaly_type: true })
	const distMap = { missing: 0, continuous: 0, truck: 0, other: 0 }
	anomalyDocs.forEach((row) => {
		const group = classifyAnomalyGroup(row.anomaly_type)
		distMap[group] = Number(distMap[group] || 0) + 1
	})
	const distributionValues = [distMap.missing, distMap.continuous, distMap.truck, distMap.other]

	const todayDate = formatDateCN(getCNDate())
	const dueEndDate = addDaysDateCN(todayDate, 60)
	const bottleDue = await countInspectionDueByField('bottle_next_check_date', todayDate, dueEndDate)
	const gaugeDue = await countInspectionDueByField('pressure_gauge_next_check_date', todayDate, dueEndDate)
	const valveDue = await countInspectionDueByField('safety_valve_next_check_date', todayDate, dueEndDate)
	const dueOverdueTotal = Number(bottleDue.overdue || 0) + Number(gaugeDue.overdue || 0) + Number(valveDue.overdue || 0)
	const due60Total = Number(bottleDue.due_60d || 0) + Number(gaugeDue.due_60d || 0) + Number(valveDue.due_60d || 0)
	const tankSummary = await getTankTelemetrySummary()

	const result = {
		kpi: {
			anomaly_open: anomalyOpen,
			sales_month: monthTotal,
			at_customer: atCustomerRes.total || 0,
			in_station: inStationRes.total || 0,
			delta: {
				sales: salesDelta,
				salesTrend
			}
		},
			trend: {
				week: trendWeek,
				labels: recentDates
			},
			overview: {
				bars: overviewBars,
				labels: overviewDates,
				total_amount: overviewTotal,
				peak_date: overviewPeakDate,
				peak_amount: fix2(overviewPeakAmount),
				avg_amount: overviewAvgAmount
			},
			daily_report: {
				rows: dailyReportRows,
				fill_total_weight_kg: dailyReportSummary.fill_total_weight_kg,
				sale_total_weight_kg: dailyReportSummary.sale_total_weight_kg,
				customer_count: dailyReportSummary.customer_count,
				dominant_channel: dailyReportSummary.dominant_channel,
				channel_totals: dailyReportSummary.channel_totals
			},
			receivable: {
				rows: receivableRows,
				total_receivable: receivableTotal,
				total_received: receivedTotal,
				gap_amount: receivableGap,
				collection_rate: collectionRate
			},
			distribution: {
				labels: ['缺失类', '连续类', '整车类', '其他'],
				values: distributionValues
			},
			inspection_due: {
				total: {
					overdue: dueOverdueTotal,
					due_60d: due60Total,
					total: dueOverdueTotal + due60Total
				},
				bottle: bottleDue,
				gauge: gaugeDue,
				valve: valveDue,
				today: todayDate,
				due_end: dueEndDate
			},
			tank: tankSummary,
			updated_at: Date.now()
		}

	await recordLog(user, 'dashboard_summary_v1', { days }, requestId)
	return { code: 0, data: result }
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId = normalizeString(event.request_id || event.requestId || context?.requestId || '') || ''
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
		recordLog,
		requestId,
		cloudFunction: 'crm-dashboard'
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }

	if (action === 'summaryV1') return summaryV1(user, data, requestId)
	if (action === 'ingestTankTelemetry') return ingestTankTelemetry(user, data, requestId)
	return { code: 400, msg: '未知 action' }
}
