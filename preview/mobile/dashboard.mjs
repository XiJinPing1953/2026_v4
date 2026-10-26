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
	if (data.section === 'brief_sources') {
		const cursor = Number(data.cursor || 0), scope = data.scope || 'period'
		if (fixture === 'sources-changed') return { code: 409, msg: '本地示例：原始来源已变化，请刷新简报' }
		const a = analysisFixture(today, period, fixture), sourceRange = data.expected_range || range
		const point = scope === 'trend' && a.trend.points.find(row => row.date === data.date)
		const periodValue = { sale_weight_kg: operations.sale_weight_kg, customer_count: operations.customer_count, business_net: sales + flow, cash_net: received - refund }[data.metric]
		const totalValue = point ? point.value : scope === 'current' || scope === 'baseline' ? a.comparison.metrics[data.metric][scope] : periodValue
		const state = totalValue == null ? unavailable('该日期净重来源待核') : available()
		const count = fixture === 'sources-many' ? 51 : data.metric === 'customer_count' ? totalValue : point ? point.source_count ?? 1 : totalValue === 0 ? 0 : 1
		const part = totalValue == null ? null : Math.trunc(totalValue * 1000 / Math.max(count, 1)) / 1000
		const items = Array.from({ length: count }, (_, i) => ({ source_type: data.metric === 'cash_net' ? 'crm_customer_receipts' : 'crm_sale_records', source_id: `fixture-source-${i}`, date: sourceRange.start, customer_id: `fixture-customer-${data.metric === 'customer_count' ? i : '001'}`, customer_name: '本地示例客户', label: '本地合成原单', value: totalValue == null ? null : data.metric === 'customer_count' ? 1 : i === count - 1 ? Number((totalValue - part * (count - 1)).toFixed(3)) : part, unit: data.metric === 'sale_weight_kg' ? 'kg' : data.metric === 'customer_count' ? '条销售记录' : '元', status: state.status, issues: state.issues })).slice(cursor, cursor + 50)
		return { code: 0, data: { section: 'brief_sources', version: 'operating-analysis/2026-10-26.1', metric: data.metric, scope, range: sourceRange, items, total: count, next_cursor: cursor + 50 < count ? String(cursor + 50) : null, evidence_token: data.evidence_token, ...state, read_complete: true, value: totalValue, note: data.metric === 'customer_count' ? '按原始销售客户去重；逐条记录数不能相加作为客户数' : '合成原单仅用于界面验收' } }
	}
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
		payload = { section: 'brief', preview: true, version, finance_version: financeVersion, period, range, money_scale: 3,
			business, cash, operations, analysis: analysisFixture(today, period, fixture, { business, cash, operations }), complete, accounting: { status: complete ? 'resolved' : 'unresolved' },
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
			opening: missing ? null : { weight_kg: 12000, observed_at: from - 5000, level_kpa: 23.3, gateway_id: 'preview-main' },
			closing: { weight_kg: Number((12000 + inbound - consumption).toFixed(3)), observed_at: to - 5000, level_kpa: 16.8, gateway_id: 'preview-main' },
			level_change_kpa: missing ? null : -6.5,
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
		for (const row of rows) { row.other_count = 0; row.other_weight = 0 }
		payload = { section: 'daily_report', version, daily_version: 'operating-daily/2026-10-26.1', source_token: 'local-fixture-report', sale_ids: [], sale_weights: [], export_evidence: { complete: false, issues: [{ code: 'preview_only', message: '合成展示样例不提供真实销售原单导出' }], issue_count: 1 }, range: { start: data.date_start, end: data.date_end }, daily_report: { rows }, complete: true, updated_at: now }
	}
	if (!payload) return null
	return { code: 0, msg: '本地经营简报示例', data: payload, financial_evidence: { complete: payload.complete, read_complete: true, snapshot_consistent: false } }
}


// Deliberately synthetic presentation cases, never used as production evidence.
export function analysisFixture(today, period, fixture = '', domains = {}) {
	const shift = n => date(Date.parse(today) + n * day), empty = fixture === 'empty'
	let currentRange = null, baselineRange = null
	if (period === 'yesterday') { currentRange = { start: shift(-1), end: shift(-1) }; baselineRange = { start: shift(-2), end: shift(-2) } }
	if (period === 'month') {
		const last = date(Date.parse(today.slice(0, 7) + '-01') - day), n = Math.min(Number(today.slice(8)) - 1, Number(last.slice(8)))
		if (n > 0) { currentRange = { start: today.slice(0, 7) + '-01', end: today.slice(0, 7) + '-' + String(n).padStart(2, '0') }; baselineRange = { start: last.slice(0, 7) + '-01', end: last.slice(0, 7) + '-' + String(n).padStart(2, '0') } }
	}
	const metric = (current, baseline, failed = false) => !currentRange || failed ? { status: failed ? 'unavailable' : 'not_comparable', current: null, baseline: null, delta: null, rate: null, issues: failed ? [{ code: 'fixture_unresolved', message: '本地示例：来源待核' }] : [] } : { status: 'available', current: empty ? 0 : current, baseline: empty ? 0 : baseline, delta: empty ? 0 : Number((current - baseline).toFixed(3)), rate: empty || baseline <= 0 ? null : Number((current - baseline).toFixed(3)) / baseline, issues: [] }
	const scale = period === 'month' ? 18 : 1
	const metrics = {
		sale_weight_kg: metric(2180.125 * scale, 1970 * scale, domains.operations?.complete === false),
		business_net: metric(24600 * scale, 22400 * scale, domains.business?.complete === false),
		cash_net: metric(19300 * scale, 21000 * scale, domains.cash?.complete === false),
		customer_count: metric(period === 'month' ? 80 : 18, period === 'month' ? 73 : 16, domains.operations?.complete === false)
	}
	const values = empty ? [0, 0, 0, 0, 0, 0, 0] : [1460, 2050, -120, 0, 2330, 1970, 2180.125]
	const points = values.map((value, i) => ({ date: shift(i - 7), value, status: 'available', source_count: value === 0 ? 0 : 5, issues: [] }))
	if (fixture === 'trend-gap') Object.assign(points[3], { value: null, status: 'unavailable', source_count: null, issues: [{ code: 'fixture_gap', message: '本地示例：净重来源缺失' }] })
	const ready = metrics.business_net.status === 'available'
	return { version: 'operating-analysis/2026-10-26.1',
		trend: { range: { start: shift(-7), end: shift(-1) }, points, status: fixture === 'trend-gap' ? 'partial' : 'available', issues: [] },
		comparison: { current_range: currentRange, baseline_range: baselineRange, status: !currentRange ? 'not_comparable' : Object.values(metrics).every(m => m.status === 'available') ? 'available' : 'partial', reason: !currentRange ? '尚无可比较完整日' : '', metrics },
		drivers: { status: ready ? 'available' : 'unavailable', items: ready && !empty ? [
			{ customer_id: 'fixture-customer-001', name: '示例客户甲', code: 'KH001', current: 9000 * scale, baseline: 6000 * scale, delta: 3000 * scale },
			{ customer_id: 'fixture-customer-002', name: '示例客户乙', code: 'KH002', current: 2500 * scale, baseline: 4000 * scale, delta: -1500 * scale },
			{ customer_id: 'fixture-customer-003', name: '示例客户丙', code: 'KH003', current: 1200 * scale, baseline: 0, delta: 1200 * scale }
		] : [], other_delta: ready ? empty ? 0 : -500 * scale : null, total_delta: ready ? empty ? 0 : 2200 * scale : null, issues: [] },
		evidence: { token: `local-fixture-${today}-${period}-${fixture}`, source_count: 15, snapshot_consistent: false, external_verified: false, time_basis: 'current_registered_records', read_started_at: Date.now(), read_completed_at: Date.now() }
	}
}
