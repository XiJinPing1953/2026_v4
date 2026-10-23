const BRIEF_VERSION = 'operating-brief/2026-10-23.1'

function requireComplete(data, section) {
	if (!data || data.section !== section || data.version !== BRIEF_VERSION || data.complete !== true) {
		throw new Error('完整数据暂不可用，请稍后刷新')
	}
}

function isNumber(value) {
	return typeof value === 'number' && Number.isFinite(value)
}

function requireNumbers(block, names) {
	if (!block || block.complete !== true || names.some(name => !isNumber(block[name]))) {
		throw new Error('汇总数据读取未完成，请稍后刷新')
	}
}

function isDay(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const date = new Date(`${value}T00:00:00Z`)
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function requirePeriod(data, period) {
	if (data.period !== period || !isDay(data.range?.start) || !isDay(data.range?.end) || data.range.start > data.range.end) throw new Error('统计期间无法确认，请重新读取')
	if (data.range.today != null) {
		if (!isDay(data.range.today)) throw new Error('统计日期无法确认，请重新读取')
		const end = period === 'yesterday' ? new Date(Date.parse(`${data.range.today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : data.range.today
		const start = period === 'month' ? `${data.range.today.slice(0, 7)}-01` : end
		if (data.range.start !== start || data.range.end !== end) throw new Error('统计期间与日期范围不一致，请重新读取')
	}
}

export function mapOperatingBrief(data, period) {
	requireComplete(data, 'brief')
	requirePeriod(data, period)
	requireNumbers(data.business, ['sales', 'flow', 'total'])
	requireNumbers(data.cash, ['received', 'refund', 'net'])
	requireNumbers(data.operations, ['sale_weight_kg', 'sale_bottle_count', 'customer_count', 'recorded_outflow_kg', 'fill_bottle_weight_kg', 'fill_bottle_count', 'local_weight_kg', 'local_count', 'vehicle_weight_kg', 'vehicle_count'])
	return data
}

export function mapOperatingCurrent(data) {
	requireComplete(data, 'current')
	requireNumbers(data.current, ['receivable', 'prepay', 'customer_count'])
	requireNumbers(data.pending, ['count', 'amount'])
	return data
}

export function mapOperatingTankLoss(data, period) {
	requireComplete(data, 'tank_loss')
	requirePeriod(data, period)
	if (!['available', 'insufficient_data'].includes(data.status) || !Array.isArray(data.issues)) throw new Error('估算损耗数据读取未完成')
	const available = data.status === 'available'
	for (const field of ['opening', 'closing']) {
		const row = data[field]
		if (row == null && !available) continue
		if (!row || !isNumber(row.weight_kg) || !isNumber(row.level_kpa) || row.observed_at == null) throw new Error('储罐估算依据读取未完成')
	}
	for (const field of ['inbound_kg', 'recorded_outflow_kg', 'estimated_loss_kg']) {
		if (data[field] == null && !available) continue
		if (!isNumber(data[field])) throw new Error('估算损耗数据读取未完成')
	}
	if (!available && data.estimated_loss_kg != null) throw new Error('估算损耗状态与数据不一致')
	return data
}

// Display sign only; all weights and the signed difference come from the server.
export function tankLossPresentation(data) {
	if (!data || data.status !== 'available' || !isNumber(data.estimated_loss_kg)) return { label: '估算损耗', amount: null }
	return { label: data.estimated_loss_kg < 0 ? '估算盈余' : '估算损耗', amount: Math.abs(data.estimated_loss_kg) }
}

const DAILY_FIELDS = {
	fillBottleCount: 'fill_bottle_count',
	fillBottleWeightKg: 'fill_bottle_weight',
	localCount: 'local_count',
	localWeightKg: 'local_weight',
	vehicleCount: 'vehicle_count',
	vehicleWeightKg: 'vehicle_weight',
	saleCustomerCount: 'sale_customer_count',
	saleBottleCount: 'sale_bottle_count',
	saleWeightKg: 'sale_weight'
}

export function mapDashboardDailyReport(data, range) {
	requireComplete(data, 'daily_report')
	if (!isDay(range?.start) || !isDay(range?.end) || data.range?.start !== range.start || data.range?.end !== range.end) throw new Error('日报日期范围不完整，请重新读取')
	const rawRows = data.daily_report?.rows
	if (!Array.isArray(rawRows)) throw new Error('日报读取未完成')
	const count = (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000 + 1
	if (count < 1 || count > 31 || rawRows.length !== count) throw new Error('日报未覆盖完整日期，暂不能导出')
	const seen = new Set()
	const rows = rawRows.map(row => {
		if (!isDay(row?.date) || row.date < range.start || row.date > range.end || seen.has(row.date)) throw new Error('日报日期不完整或重复，请重新读取')
		seen.add(row.date)
		const result = { date: row.date }
		for (const [name, legacy] of Object.entries(DAILY_FIELDS)) {
			const value = row[name] ?? row[legacy]
			if (!isNumber(value)) throw new Error('日报业务量读取未完成')
			result[name] = value
		}
		return result
	}).sort((a, b) => b.date.localeCompare(a.date))
	return { rows, range: { ...range }, complete: true, updated_at: data.updated_at }
}
