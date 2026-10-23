// Local display-only fixtures for the real homepage; no production requests.
// Amounts below are synthetic and deliberately exercise independent source states.
const version = 'operating-brief/2026-10-23.1'
const financeVersion = 'operating-brief-finance/2026-10-23.1'
const currentVersion = 'operating-brief-current/2026-10-24.1'
const day = 86400000
const date = value => new Date(value).toISOString().slice(0, 10)
const available = () => ({ status: 'available', complete: true, issues: [], issue_count: 0 })
const unavailable = (message, extra = {}) => ({ status: 'unavailable', complete: false,
	issues: [{ code: 'LOCAL_FIXTURE_SOURCE_UNAVAILABLE', message: `本地示例：${message}`, ...extra }], issue_count: 1 })
const businessFields = ['sales', 'flow', 'total', 'net', 'positive', 'negative']
const settlementFields = ['principal', 'allocated', 'sale_rounding', 'receipt_rounding', 'rounding', 'outstanding']
const destinationFields = ['same_period', 'prior_period', 'future_period', 'other', 'refunded_after_or_current',
	'remaining_prepay', 'remaining_settlement', 'remaining_unknown', 'total']
const clear = (target, fields, state) => Object.assign(target, Object.fromEntries(fields.map(key => [key, null])), state)

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
		recorded_outflow_kg: value(3470.972), ...available() }
	let payload
	if (data.section === 'brief') {
		const positiveSettlement = { principal: value(25000), allocated: value(18000), sale_rounding: value(70), receipt_rounding: value(30),
			rounding: value(100), outstanding: value(6900), as_of: 'current', scope_label: '所选业务正向货款，按当前有效核销', ...available() }
		const business = { sales, flow, total: value(24600), net: value(24600), positive: value(25000), negative: value(400),
			positive_settlement: positiveSettlement, ...available() }
		const destinations = { same_period: value(12000), prior_period: value(3000), future_period: value(500), other: value(300),
			refunded_after_or_current: value(200), remaining_prepay: value(2600), remaining_settlement: value(1000), remaining_unknown: value(200),
			total: received, basis: 'current_allocation', scope_label: '所选期间正向收款的当前去向', ...available() }
		const cash = { received, refund, net: value(19300), scope: 'posted_receipts', scope_label: '正式收退款凭据的已登记到账', ...available(),
			evidence: { scope: 'selected_business_cohort', scope_label: '仅核查所选业务是否缺少正式收款凭据', ...available() }, destinations }
		if (['finance-partial', 'business-unavailable'].includes(fixture)) {
			const state = unavailable('销售单计价来源待核', { source: 'crm_sale_records', source_id: 'fixture-sale-001', field: 'unit_price' })
			clear(business, businessFields, state); clear(positiveSettlement, settlementFields, state)
		}
		if (fixture === 'settlement-unavailable') clear(positiveSettlement, settlementFields,
			unavailable('所选货款核销金额超出可核对应收', { source: 'crm_sale_records', source_id: 'fixture-sale-001', field: 'amount_received' }))
		if (['cash-partial', 'cash-destinations-unavailable'].includes(fixture)) clear(destinations, destinationFields,
			unavailable('正式收款已读取，但分配目标待核', { source: 'crm_customer_allocations', source_id: 'fixture-allocation-001', field: 'target_id' }))
		if (fixture === 'cash-evidence-unavailable') Object.assign(cash.evidence,
			unavailable('所选业务旧单缺少正式收款凭据', { source: 'crm_sale_records', source_id: 'fixture-sale-002', field: 'amount_received' }))
		if (fixture === 'cash-unavailable') {
			const state = unavailable('正式收款来源读取失败', { source: 'crm_customer_receipts' })
			clear(cash, ['received', 'refund', 'net'], state); clear(destinations, destinationFields, state)
		}
		if (fixture === 'operations-unavailable') clear(operations, Object.keys(operations).filter(key => typeof operations[key] === 'number' && key !== 'issue_count'),
			unavailable('销售净重来源待核', { source: 'crm_sale_records', source_id: 'fixture-sale-003', field: 'out_items.net' }))
		const complete = [business, positiveSettlement, cash, cash.evidence, destinations, operations].every(block => block.complete)
		payload = { section: 'brief', version, finance_version: financeVersion, period, range, money_scale: 3,
			business, cash, operations, complete, accounting: { status: complete ? 'resolved' : 'unresolved' },
			updated_at: now, read_started_at: now, read_completed_at: now, snapshot_consistent: false }
	}
	if (data.section === 'tank_loss') {
		if (fixture === 'tank-error') return { code: 409, msg: '本地示例：储罐边界日志读取失败' }
		const from = Date.parse(`${range.start}T00:00:00+08:00`)
		const to = period === 'yesterday' ? Date.parse(`${range.end}T00:00:00+08:00`) + day : now
		const missing = fixture === 'tank-missing', unknownOutflow = fixture === 'tank-outflow-unavailable'
		const missingInbound = ['tank-inbound-missing', 'brief-review'].includes(fixture)
		const loss = empty ? 0 : missingInbound ? -20539.195 : fixture === 'tank-gain' ? value(-15.125) : value(29.028)
		const inbound = !empty && period === 'month' ? 60000 : 0
		const channels = [
			{ key: 'bottle', label: '钢瓶充装', weight_kg: operations.fill_bottle_weight_kg, count: operations.fill_bottle_count, count_unit: '瓶次', complete: true },
			{ key: 'local', label: '地方车', weight_kg: operations.local_weight_kg, count: operations.local_count, count_unit: '次', complete: true },
			{ key: 'vehicle', label: '车辆燃气加注', weight_kg: operations.vehicle_weight_kg, count: operations.vehicle_count, count_unit: '次', complete: true },
			{ key: 'other', label: '整车补气及其他', weight_kg: value(120), count: empty ? 0 : Math.max(1, Math.round(value(1))), count_unit: '次', complete: true }
		]
		const registered = Number(channels.reduce((sum, row) => sum + row.weight_kg, 0).toFixed(3))
		const consumption = Number((registered + loss).toFixed(3))
		if (unknownOutflow) Object.assign(channels[3], { weight_kg: null, count: null, complete: false })
		const issues = missing ? [{ code: 'opening_missing', message: '缺少期初附近的储罐液位日志' }] : unknownOutflow
			? [{ code: 'outflow_time_missing', message: '整车补气登记时刻待核，暂不计算完整出罐和损耗' }]
			: missingInbound ? [{ code: 'tank_stock_increase_without_inbound', message: '罐存增加但未登记入库，请核对入库记录' }]
			: loss < 0 ? [{ code: 'negative_estimated_loss', message: '出罐量大于估算耗气量，请核对液位和登记记录' }] : []
		payload = { section: 'tank_loss', version, period, range, complete: true,
			status: missing || unknownOutflow ? 'insufficient_data' : loss < 0 ? 'needs_review' : 'available',
			opening: missing ? null : { weight_kg: 12000, observed_at: from - 5000, level_kpa: 23.3 },
			closing: { weight_kg: Number((12000 + inbound - consumption).toFixed(3)), observed_at: to - 5000, level_kpa: 16.8 },
			inbound_kg: inbound, recorded_outflow_kg: unknownOutflow ? null : registered,
			estimated_consumption_kg: missing ? null : consumption, estimated_loss_kg: missing || unknownOutflow ? null : loss,
			outflow: { complete: !unknownOutflow, weight_kg: unknownOutflow ? null : registered, channels, issues: unknownOutflow ? issues : [] },
			issues, estimate_version: 'main-continuous-2026-10-14-v1', updated_at: now,
			read_started_at: now, read_completed_at: now, snapshot_consistent: false }
	}
	if (data.section === 'current') {
		const debt = available(), funds = available(), total = empty ? 0 : 203600.123
		const checkedCustomers = empty ? 0 : 86
		const checked = amount => ({ verified_subtotal: amount, coverage: { complete: true, total_customers: checkedCustomers,
			verified_customers: checkedCustomers, pending_customers: 0 }, issues_complete: true })
		Object.assign(debt, checked(total)); Object.assign(funds, checked(empty ? 0 : 12000.018))
		const items = empty ? [] : [
			{ customer_id: 'fixture-customer-001', name: '示例甲客户', code: 'KH001', amount: 90000 },
			{ customer_id: 'fixture-customer-002', name: '示例乙客户（停用）', code: 'KH002', amount: 60000 },
			{ customer_id: 'fixture-customer-003', name: '示例丙客户', code: 'KH003', amount: 30000 }
		].map(row => ({ ...row, share_of_total: Math.round(row.amount / total * 1000000) / 1000000 }))
		const current = { receivable: total, prepay: empty ? 0 : 12000.018, offset_credit: empty ? 0 : 800.006,
			prepay_sources: { manual_prepay: empty ? 0 : 7000.006, receipt_unallocated: empty ? 0 : 3200.012,
				opening_prepay: empty ? 0 : 1000, deposit_transfer: empty ? 0 : 500, settlement_fee: empty ? 0 : 300 },
			prepay_label: '可用款（不含退气抵款）', customer_count: empty ? 0 : 86, complete: true, debt, available_funds: funds,
			debt_ranking: { ...available(), total_receivable: total, positive_customer_count: empty ? 0 : 20, items } }
		const pending = { count: empty ? 0 : 2, amount: empty ? 0 : 3200.012, ...available() }
		if (['current-partial', 'current-debt-unavailable', 'brief-review', 'current-all-unavailable'].includes(fixture)) {
			const state = unavailable('原单应收与已抵金额需核对', { source: 'crm_sale_records', source_id: 'fixture-sale-004', field: 'amount_received',
				customer_id: 'fixture-customer-004', customer_name: '示例待核客户', customer_code: 'KH004', source_date: '2026-01-03', action: 'review_source' })
			Object.assign(debt, state); current.receivable = null
			Object.assign(current.debt_ranking, state, { total_receivable: null, positive_customer_count: null, items: [] })
			Object.assign(debt, { status: 'partial', verified_subtotal: 186200.123,
				coverage: { complete: true, total_customers: 86, verified_customers: 85, pending_customers: 1 } })
		}
		if (['current-funds-unavailable', 'brief-review', 'current-all-unavailable'].includes(fixture)) {
			Object.assign(funds, unavailable('有收款调整尚未完成', { code: 'receipt_operation_pending', source: 'crm_customer_receipts',
				source_id: 'fixture-receipt-001', field: 'unallocated_amount', customer_id: 'fixture-customer-005', customer_name: '示例收款待核客户',
				customer_code: 'KH005', source_date: '2026-10-20', action: 'resume_receipt_adjustment' }), { status: 'partial', verified_subtotal: 10000.018,
				coverage: { complete: true, total_customers: 86, verified_customers: 85, pending_customers: 1 } })
			current.prepay = null; current.offset_credit = null; current.prepay_sources = null
		}
		if (fixture === 'current-all-unavailable') for (const block of [debt, funds]) Object.assign(block,
			{ status: 'unavailable', verified_subtotal: null, coverage: { complete: false, total_customers: null, verified_customers: null, pending_customers: null }, issues_complete: false })
		if (fixture === 'current-pending-unavailable') {
			clear(pending, ['count', 'amount'], unavailable('结账收款关联凭据待核', { source: 'crm_cashier_intakes', source_id: 'fixture-intake-001' }))
		}
		if (fixture === 'top3-one') {
			current.receivable = 90000; Object.assign(current.debt_ranking, { total_receivable: 90000, positive_customer_count: 1,
				items: [{ ...items[0], share_of_total: 1 }] })
			debt.verified_subtotal = 90000
		}
		current.complete = debt.complete && funds.complete
		const complete = current.complete && pending.complete
		payload = { section: 'current', version, current_version: currentVersion, money_scale: 3, current, pending, complete, updated_at: now,
			accounting: { status: complete ? 'resolved' : 'unresolved' }, scope: 'visible_settlement_customers_including_inactive',
			read_started_at: now, read_completed_at: now, snapshot_consistent: false }
	}
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
	return { code: 0, msg: '本地经营简报示例', data: payload, financial_evidence: { complete: payload.complete, read_complete: true, snapshot_consistent: false } }
}
