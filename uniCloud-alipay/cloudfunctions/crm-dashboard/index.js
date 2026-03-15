'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const sales = db.collection('crm_sale_records')
const bottles = db.collection('crm_bottles')
const anomalies = db.collection('crm_bottle_anomalies')

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

function computeAmounts({ bizMode, priceUnit, unitPrice, outItems, backItems, agentRows, truckSaleNet, flow }) {
	const outNetTotal = outItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	const backNetTotal = backItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)

	let totalNetWeight = outNetTotal - backNetTotal
	if (bizMode === 'truck') {
		totalNetWeight = toNumber(truckSaleNet, 0)
	}

	let outAmount = 0
	let backAmount = 0
	let shouldReceive = 0

	if (bizMode === 'agent_sale') {
		const totalWeight = agentRows.reduce((sum, row) => sum + toNumber(row.fill_weight, 0), 0)
		outAmount = totalWeight * unitPrice
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
		out_amount: fix2(outAmount),
		back_amount: fix2(backAmount),
		should_receive: fix2(shouldReceive)
	}
}

function computeSaleAmount(doc) {
	const bizMode = normalizeString(doc.biz_mode)
	const priceUnit = normalizeString(doc.price_unit)
	const unitPrice = toNumber(doc.unit_price, 0)
	const outItems = Array.isArray(doc.out_items) ? doc.out_items : []
	const backItems = Array.isArray(doc.back_items) ? doc.back_items : []
	const agentRows = Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : []
	const flow = { flow_volume_m3: toNumber(doc.flow_volume_m3, 0) }
	const amounts = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems,
		backItems,
		agentRows,
		truckSaleNet: doc.truck_sale_net,
		flow
	})
	return toNumber(amounts.should_receive, 0)
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
	const weekSales = await fetchAll(sales, weekWhere, { date: true })
	const trendMap = {}
	recentDates.forEach((date) => {
		trendMap[date] = 0
	})
	weekSales.forEach((row) => {
		const key = normalizeString(row.date)
		if (key && trendMap[key] != null) trendMap[key] += 1
	})
	const trendWeek = recentDates.map((date) => trendMap[date] || 0)

	const monthRange = getMonthRange(today)
	const monthWhere = dbCmd.and([{ date: dbCmd.gte(monthRange.start) }, { date: dbCmd.lte(monthRange.end) }])
	const monthDocs = await fetchAll(sales, monthWhere, {
		date: true,
		biz_mode: true,
		price_unit: true,
		unit_price: true,
		out_items: true,
		back_items: true,
		agent_sale_items: true,
		truck_sale_net: true,
		flow_volume_m3: true
	})
	let monthTotal = 0
	monthDocs.forEach((doc) => {
		monthTotal += computeSaleAmount(doc)
	})
	monthTotal = fix2(monthTotal)

	const prevRange = getPrevMonthRange(today)
	const prevWhere = dbCmd.and([{ date: dbCmd.gte(prevRange.start) }, { date: dbCmd.lte(prevRange.end) }])
	const prevDocs = await fetchAll(sales, prevWhere, {
		date: true,
		biz_mode: true,
		price_unit: true,
		unit_price: true,
		out_items: true,
		back_items: true,
		agent_sale_items: true,
		truck_sale_net: true,
		flow_volume_m3: true
	})
	let prevTotal = 0
	prevDocs.forEach((doc) => {
		prevTotal += computeSaleAmount(doc)
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
	const distMap = { missing_back: 0, missing_fill: 0, continuous_out: 0 }
	anomalyDocs.forEach((row) => {
		const type = normalizeString(row.anomaly_type)
		if (distMap[type] != null) distMap[type] += 1
	})
	const distributionValues = [distMap.missing_back, distMap.missing_fill, distMap.continuous_out]

	const todayDate = formatDateCN(getCNDate())
	const dueEndDate = addDaysDateCN(todayDate, 60)
	const bottleDue = await countInspectionDueByField('bottle_next_check_date', todayDate, dueEndDate)
	const gaugeDue = await countInspectionDueByField('pressure_gauge_next_check_date', todayDate, dueEndDate)
	const valveDue = await countInspectionDueByField('safety_valve_next_check_date', todayDate, dueEndDate)
	const dueOverdueTotal = Number(bottleDue.overdue || 0) + Number(gaugeDue.overdue || 0) + Number(valveDue.overdue || 0)
	const due60Total = Number(bottleDue.due_60d || 0) + Number(gaugeDue.due_60d || 0) + Number(valveDue.due_60d || 0)

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
			bars: trendWeek.slice(-6)
		},
			distribution: {
				labels: ['缺回瓶', '缺灌装', '连续出瓶'],
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

	if (action === 'summaryV1') return summaryV1(user, data, requestId)
	return { code: 400, msg: '未知 action' }
}
