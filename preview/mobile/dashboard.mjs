// Local display-only fixtures for the real homepage; no production requests.
const version = 'operating-brief/2026-10-23.1'
const day = 86400000
const date = value => new Date(value).toISOString().slice(0, 10)
export function dashboardFixture(data = {}) {
	const now = Date.now(), today = date(now + 8 * 3600000)
	const period = data.period || 'yesterday'
	const selected = period === 'yesterday' ? date(Date.parse(today) - day) : today
	const range = { start: period === 'month' ? today.slice(0, 7) + '-01' : selected, end: selected, today }
	const fixture = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('fixture')
	if (fixture === 'brief-incomplete') return { code: 409, msg: '本地示例：账务来源待核，本次未返回完整合计' }
	const empty = fixture === 'empty'
	const multiplier = empty ? 0 : period === 'month' ? 19 : period === 'today' ? 0.5 : 1
	const value = amount => Number((amount * multiplier).toFixed(3))
	const sales = value(20800), flow = value(3800), received = value(19800), refund = value(500)
	const operations = { sale_weight_kg: value(2180.125), sale_bottle_count: Math.round(value(24)), customer_count: empty ? 0 : period === 'month' ? 86 : period === 'today' ? 9 : 18,
		fill_bottle_weight_kg: value(2440.315), fill_bottle_count: Math.round(value(28)),
		local_weight_kg: value(850.125), local_count: Math.round(value(4)), vehicle_weight_kg: value(180.532), vehicle_count: Math.round(value(6)),
		recorded_outflow_kg: value(3470.972), complete: true }
	let payload
	if (data.section === 'brief') payload = { section: 'brief', version, period, range, money_scale: 3,
		business: { sales, flow, total: value(24600), complete: true }, cash: { received, refund, net: value(19300), scope: 'posted_receipts', complete: true }, operations, complete: true, updated_at: now }
	if (data.section === 'tank_loss') {
		if (fixture === 'tank-error') return { code: 409, msg: '本地示例：储罐边界日志读取失败' }
		const from = Date.parse(`${range.start}T00:00:00+08:00`)
		const to = period === 'yesterday' ? Date.parse(`${range.end}T00:00:00+08:00`) + day : now
		const missing = fixture === 'tank-missing'
		const loss = empty ? 0 : fixture === 'tank-gain' ? -15.125 : value(29.028)
		const inbound = !empty && period === 'month' ? 60000 : 0
		payload = { section: 'tank_loss', version, period, range, complete: true,
			status: missing ? 'insufficient_data' : 'available',
			opening: missing ? null : { weight_kg: 12000, observed_at: from - 5000, level_kpa: 23.3 },
			closing: { weight_kg: Number((12000 + inbound - operations.recorded_outflow_kg - loss).toFixed(3)), observed_at: to - 5000, level_kpa: 16.8 },
			inbound_kg: inbound, recorded_outflow_kg: operations.recorded_outflow_kg,
			estimated_loss_kg: missing ? null : loss,
			issues: missing ? [{ code: 'opening_missing', message: '缺少期初附近的储罐液位日志' }] : [],
			estimate_version: 'main-continuous-2026-10-14-v1', updated_at: now,
			read_started_at: now, read_completed_at: now, snapshot_consistent: false }
	}
	if (data.section === 'current') payload = { section: 'current', version, money_scale: 3,
		current: { receivable: empty ? 0 : 203600.123, prepay: empty ? 0 : 12000.018, prepay_label: '可用款（不含退气抵款）', customer_count: empty ? 0 : 86, complete: true },
		pending: { count: empty ? 0 : 2, amount: empty ? 0 : 3200.128, complete: true }, complete: true, updated_at: now }
	if (data.section === 'daily_report') {
		const rows = []
		for (let ts = Date.parse(data.date_start); ts <= Date.parse(data.date_end); ts += day) rows.unshift({ date: date(ts),
			fill_bottle_count: operations.fill_bottle_count, fill_bottle_weight: operations.fill_bottle_weight_kg,
			local_count: operations.local_count, local_weight: operations.local_weight_kg,
			vehicle_count: operations.vehicle_count, vehicle_weight: operations.vehicle_weight_kg,
			fill_total_weight: value(3470.972), sale_customer_count: operations.customer_count,
			sale_bottle_count: operations.sale_bottle_count, sale_weight: operations.sale_weight_kg })
		payload = { section: 'daily_report', version, range: { start: data.date_start, end: data.date_end }, daily_report: { rows }, complete: true, updated_at: now }
	}
	if (!payload) return null
	return { code: 0, msg: '本地经营简报示例', data: payload, financial_evidence: { complete: true, read_complete: true, snapshot_consistent: false } }
}
