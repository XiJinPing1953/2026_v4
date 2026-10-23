'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const version = 'operating-brief/2026-10-23.1'
const financeVersion = 'operating-brief-finance/2026-10-23.1'
const available = () => ({ complete: true, status: 'available', issues: [] })
const unavailable = () => ({ complete: false, status: 'unavailable', issues: [{ code: 'SOURCE_UNRESOLVED', message: '来源待核' }] })
const strip = path => fs.readFileSync(path, 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const settle = () => new Promise(resolve => setImmediate(resolve))

function deferred() {
	let resolve, reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}
function brief(period = 'yesterday', value = 10) {
	return { code: 0, data: {
		section: 'brief', version, finance_version: financeVersion, period, complete: true, updated_at: 1792717200000,
		range: { start: period === 'month' ? '2026-10-01' : period === 'today' ? '2026-10-23' : '2026-10-22', end: period === 'yesterday' ? '2026-10-22' : '2026-10-23', today: '2026-10-23' }, money_scale: 3,
		business: { sales: value, flow: 2, total: value + 2, net: value + 2, positive: value + 2, negative: 0, ...available(),
			positive_settlement: { principal: value + 2, allocated: 1, sale_rounding: 0.1, receipt_rounding: 0.1, rounding: 0.2,
				outstanding: value + 0.8, as_of: 'current', ...available() } },
		cash: { received: 8, refund: 1, net: 7, ...available(), scope: 'posted_receipts', evidence: available(),
			destinations: { same_period: 1, prior_period: 1, future_period: 0, other: 0, refunded_after_or_current: 1,
				remaining_prepay: 3, remaining_settlement: 1, remaining_unknown: 1, total: 8, basis: 'current_allocation', ...available() } },
		operations: { sale_weight_kg: 120, sale_bottle_count: 5, customer_count: 3, recorded_outflow_kg: 144.468, fill_bottle_weight_kg: 100, fill_bottle_count: 4, local_weight_kg: 32.123, local_count: 1, vehicle_weight_kg: 12.345, vehicle_count: 2, ...available() }
	} }
}
function current() {
	return { code: 0, data: { section: 'current', version, complete: true, updated_at: 1792717200000, money_scale: 3,
		current: { receivable: 20.123, prepay: 5.123, offset_credit: 0, customer_count: 4, complete: true,
			prepay_label: '可用款（不含退气抵款）', prepay_sources: { manual_prepay: 5.123, receipt_unallocated: 0, opening_prepay: 0, deposit_transfer: 0, settlement_fee: 0 },
			debt: available(), available_funds: available(), debt_ranking: { ...available(), total_receivable: 20.123, positive_customer_count: 3,
				items: [{ customer_id: 'c1', name: '客户一', code: '001', amount: 10, share_of_total: 0.496944 },
					{ customer_id: 'c2', name: '客户二', code: '002', amount: 6, share_of_total: 0.298167 },
					{ customer_id: 'c3', name: '客户三', code: '003', amount: 4.123, share_of_total: 0.20489 }] } },
		pending: { count: 2, amount: 4.005, ...available() }
	} }
}
function tankLoss(period = 'yesterday', amount = 20) {
	return { code: 0, data: {
		section: 'tank_loss', version, period, range: brief(period).data.range, complete: true,
		status: 'available', opening: { weight_kg: 1200, observed_at: 1792598400000, level_kpa: 12.5 },
		closing: { weight_kg: 1120 - amount, observed_at: 1792684800000, level_kpa: 11.8 },
		inbound_kg: 0, recorded_outflow_kg: 80, estimated_consumption_kg: 80 + amount, estimated_loss_kg: amount, issues: [],
		outflow: { weight_kg: 80, complete: true, issues: [], channels: [
			{ key: 'bottle', label: '钢瓶充装', weight_kg: 50, count: 2, count_unit: '瓶次', complete: true },
			{ key: 'local', label: '地方车', weight_kg: 10, count: 1, count_unit: '次', complete: true },
			{ key: 'vehicle', label: '车辆燃气加注', weight_kg: 10, count: 1, count_unit: '次', complete: true },
			{ key: 'other', label: '整车补气及其他', weight_kg: 10, count: 1, count_unit: '次', complete: true }
		] },
		updated_at: 1792717200000, estimate_version: 'test-liquid-estimate', snapshot_consistent: false
	} }
}
function failDomain(block, fields = []) {
	Object.assign(block, unavailable())
	for (const field of fields) block[field] = null
	return block
}
const BUSINESS_FIELDS = ['sales', 'flow', 'total', 'net', 'positive', 'negative']
const SETTLEMENT_FIELDS = ['principal', 'allocated', 'sale_rounding', 'receipt_rounding', 'rounding', 'outstanding']
const DESTINATION_FIELDS = ['same_period', 'prior_period', 'future_period', 'other', 'refunded_after_or_current', 'remaining_prepay', 'remaining_settlement', 'remaining_unknown', 'total']
function report(range) {
	const rows = []
	for (let time = Date.parse(`${range.start}T00:00:00Z`); time <= Date.parse(`${range.end}T00:00:00Z`); time += 86400000) {
		rows.push({ date: new Date(time).toISOString().slice(0, 10), fill_bottle_count: 1, fill_bottle_weight: 3.123,
			local_count: 0, local_weight: 0, vehicle_count: 2, vehicle_weight: 22.123,
			sale_customer_count: 1, sale_bottle_count: 1, sale_weight: 3.123 })
	}
	return { code: 0, data: { section: 'daily_report', version, range: { ...range }, complete: true, daily_report: { rows }, updated_at: 1792717200000 } }
}
function harness(options = {}) {
	const calls = [], currents = [], tankLosses = [], reports = [], sales = [], timers = new Map()
	const enqueue = list => query => { const request = { query, ...deferred() }; list.push(request); return request.promise }
	const ctx = {
		ref: vue.ref, computed: vue.computed, onBeforeUnmount() {},
		getOperatingBriefV1: enqueue(calls), getOperatingCurrentV1: enqueue(currents), getOperatingTankLossV1: enqueue(tankLosses), getDashboardDailyReportV1: enqueue(reports), listSalesV2: enqueue(sales),
		Date, Number, Object, Array, Boolean, Set, Error,
		setInterval: fn => { const id = Symbol(); timers.set(id, fn); return id }, clearInterval: id => timers.delete(id)
	}
	vm.runInNewContext(strip('src/services/mappers/operatingBrief.js') + '\n' + strip('src/composables/dashboard/useOperatingBrief.js') + '\nthis.api = { useOperatingBrief, operatingBriefDateRange, mapOperatingBrief, mapOperatingCurrent, mapOperatingTankLoss, tankLossPresentation, mapDashboardDailyReport };', ctx)
	return { ...ctx.api, state: ctx.api.useOperatingBrief(options), calls, currents, tankLosses, reports, sales, timers }
}

test('business dates use UTC+8 and this month stops at today', () => {
	const h = harness()
	const now = Date.parse('2026-10-22T16:00:00Z')
	assert.equal(h.operatingBriefDateRange('today', now).start, '2026-10-23')
	assert.equal(h.operatingBriefDateRange('yesterday', now).start, '2026-10-22')
	assert.equal(h.operatingBriefDateRange('month', now).end, '2026-10-23')
	assert.equal(h.operatingBriefDateRange('lastMonth', now).end, '2026-09-30')
})

test('old backend, missing numbers and partial date coverage never become zero or complete reports', () => {
	const h = harness()
	assert.throws(() => h.mapOperatingBrief({ kpi: {}, daily_report: {} }, 'yesterday'), /完整数据/)
	const mismatch = brief('today').data; mismatch.range.start = '2026-10-22'
	assert.throws(() => h.mapOperatingBrief(mismatch, 'today'), /不一致/)
	const b = brief().data; b.cash.net = null
	assert.throws(() => h.mapOperatingBrief(b, 'yesterday'), /未完成/)
	const missingOutflow = brief().data; delete missingOutflow.operations.recorded_outflow_kg
	assert.throws(() => h.mapOperatingBrief(missingOutflow, 'yesterday'), /未完成/)
	const authoritativeOutflow = brief().data; authoritativeOutflow.operations.recorded_outflow_kg = 123.456
	assert.equal(h.mapOperatingBrief(authoritativeOutflow, 'yesterday').operations.recorded_outflow_kg, 123.456, 'display preserves the server total rather than summing channels')
	const c = current().data; c.current.debt.complete = false
	assert.throws(() => h.mapOperatingCurrent(c), /未完成/)
	const range = { start: '2026-10-01', end: '2026-10-23' }
	const r = report(range).data
	assert.equal(h.mapDashboardDailyReport(r, range).rows.length, 23)
	r.daily_report.rows.pop()
	assert.throws(() => h.mapDashboardDailyReport(r, range), /完整日期/)
	const duplicate = report(range).data; duplicate.daily_report.rows[0] = duplicate.daily_report.rows[1]
	assert.throws(() => h.mapDashboardDailyReport(duplicate, range), /重复/)
})

test('financial domains preserve independent available amounts while unavailable amounts stay null', async () => {
	const h = harness(); h.state.setVisible(true)
	const response = brief()
	response.data.complete = false
	failDomain(response.data.business, BUSINESS_FIELDS)
	failDomain(response.data.business.positive_settlement, SETTLEMENT_FIELDS)
	h.calls[0].resolve(response); await settle()
	assert.equal(h.state.error.value, '')
	assert.equal(h.state.result.value.business.total, null)
	assert.equal(h.state.result.value.cash.net, 7)
	assert.equal(h.state.result.value.operations.customer_count, 3)
	const settlementOnly = brief().data; settlementOnly.complete = false
	failDomain(settlementOnly.business.positive_settlement, SETTLEMENT_FIELDS)
	assert.equal(h.mapOperatingBrief(settlementOnly, 'yesterday').business.total, 12)
	const cashOnly = brief().data; cashOnly.complete = false
	failDomain(cashOnly.cash, ['received', 'refund', 'net'])
	failDomain(cashOnly.cash.destinations, DESTINATION_FIELDS)
	assert.equal(h.mapOperatingBrief(cashOnly, 'yesterday').business.positive, 12)
	assert.equal(cashOnly.cash.received, null)
	h.state.dispose()
})

test('receipt evidence and allocation destinations can fail without suppressing verified cash receipt totals', () => {
	const h = harness()
	for (const target of ['evidence', 'destinations']) {
		const data = brief().data; data.complete = false
		failDomain(data.cash[target], target === 'destinations' ? DESTINATION_FIELDS : [])
		const mapped = h.mapOperatingBrief(data, 'yesterday')
		assert.equal(mapped.cash.received, 8)
		assert.equal(mapped.cash.refund, 1)
		assert.equal(mapped.cash.net, 7)
		assert.equal(mapped.cash[target].status, 'unavailable')
	}
})

test('financial mapper rejects missing new contracts, contradictory available states and malformed amounts', () => {
	const h = harness()
	for (const mutate of [
		data => { delete data.finance_version },
		data => { delete data.business.positive_settlement },
		data => { delete data.business.net },
		data => { data.business.negative = -1 },
		data => { data.business.positive_settlement.rounding = null },
		data => { data.business.positive_settlement.allocated = -1 },
		data => { data.business.positive_settlement.as_of = 'period_end' },
		data => { delete data.cash.evidence },
		data => { delete data.cash.destinations },
		data => { data.cash.destinations.total = '8' },
		data => { data.cash.destinations.basis = 'receipt_day' },
		data => { data.cash.complete = false },
		data => { data.cash.received = Infinity },
		data => { data.cash.refund = -1 },
		data => { data.operations.customer_count = 1.5 },
		data => { data.complete = false; Object.assign(data.business, unavailable()) },
		data => { data.complete = false; failDomain(data.business, BUSINESS_FIELDS) },
		data => { failDomain(data.cash.evidence) }
	]) {
		const data = brief().data; mutate(data)
		assert.throws(() => h.mapOperatingBrief(data, 'yesterday'), /未完成|不一致/, mutate.toString())
	}
	const signed = brief().data
	Object.assign(signed.business, { sales: -2, flow: 0, total: -2, net: -2, positive: 0, negative: 2 })
	for (const key of SETTLEMENT_FIELDS) signed.business.positive_settlement[key] = 0
	Object.assign(signed.cash, { received: 0, refund: 3, net: -3 })
	for (const key of DESTINATION_FIELDS) signed.cash.destinations[key] = 0
	assert.equal(h.mapOperatingBrief(signed, 'yesterday').business.net, -2)
})

test('current debt, available funds and pending receipts retain independent unavailable states', async () => {
	const h = harness(); h.state.setVisible(true)
	const response = current(), data = response.data
	data.complete = false; data.current.complete = false
	failDomain(data.current.debt)
	data.current.receivable = null
	failDomain(data.current.debt_ranking, ['total_receivable', 'positive_customer_count'])
	data.current.debt_ranking.items = []
	h.currents[0].resolve(response); await settle()
	assert.equal(h.state.currentError.value, '')
	assert.equal(h.state.current.value.current.receivable, null)
	assert.equal(h.state.current.value.current.prepay, 5.123)
	assert.equal(h.state.current.value.pending.amount, 4.005)
	const funds = current().data; funds.complete = false; funds.current.complete = false
	failDomain(funds.current.available_funds)
	Object.assign(funds.current, { prepay: null, offset_credit: null, prepay_sources: null })
	assert.equal(h.mapOperatingCurrent(funds).current.receivable, 20.123)
	const pending = current().data; pending.complete = false
	failDomain(pending.pending, ['count', 'amount'])
	assert.equal(h.mapOperatingCurrent(pending).current.prepay, 5.123)
	h.state.dispose()
})

test('current mapper accepts a real zero empty ranking and rejects corrupted or missing ranking contracts', () => {
	const h = harness(), empty = current().data
	empty.current.receivable = 0
	Object.assign(empty.current.debt_ranking, { total_receivable: 0, positive_customer_count: 0, items: [] })
	assert.equal(h.mapOperatingCurrent(empty).current.debt_ranking.items.length, 0)
	for (const mutate of [
		data => { delete data.current.debt },
		data => { delete data.current.available_funds },
		data => { delete data.current.debt_ranking },
		data => { delete data.current.prepay_sources },
		data => { data.current.debt_ranking.items[0].share_of_total = 1.01 },
		data => { data.current.debt_ranking.items[0].share_of_total = NaN },
		data => { data.current.debt_ranking.items[0].amount = 0 },
		data => { data.current.debt_ranking.items[0].amount = 30 },
		data => { data.current.debt_ranking.items[0].customer_id = '' },
		data => { data.current.debt_ranking.items[1].customer_id = 'c1' },
		data => { data.current.debt_ranking.items[0].code = 123 },
		data => { data.current.debt_ranking.total_receivable = 99 },
		data => { data.current.debt_ranking.positive_customer_count = 1 },
		data => { data.current.debt_ranking.positive_customer_count = 5 },
		data => { data.current.debt_ranking.complete = false },
		data => { data.current.prepay = null },
		data => { data.pending.amount = null },
		data => { data.pending.count = 2.5 }
	]) {
		const data = current().data; mutate(data)
		assert.throws(() => h.mapOperatingCurrent(data), /未完成|不一致/, mutate.toString())
	}
})

test('gas mapper preserves independently known channels and consumption when loss or a channel cannot be confirmed', () => {
	const h = harness(), data = tankLoss().data
	data.status = 'insufficient_data'; data.estimated_loss_kg = null; data.recorded_outflow_kg = null
	data.issues = [{ code: 'filling_time_unknown', message: '钢瓶记录缺业务时刻' }]
	Object.assign(data.outflow, { complete: false, weight_kg: null, issues: data.issues })
	Object.assign(data.outflow.channels[0], { complete: false, weight_kg: null, count: null })
	const mapped = h.mapOperatingTankLoss(data, 'yesterday')
	assert.equal(mapped.estimated_consumption_kg, 100)
	assert.equal(mapped.outflow.channels[0].weight_kg, null)
	assert.equal(mapped.outflow.channels[1].weight_kg, 10)
	assert.equal(h.tankLossPresentation(mapped).amount, null)
	const missingBoundary = tankLoss().data
	Object.assign(missingBoundary, { status: 'insufficient_data', opening: null, estimated_consumption_kg: null,
		estimated_loss_kg: null, issues: [{ code: 'opening_missing_sample', message: '缺期初采样' }] })
	assert.equal(h.mapOperatingTankLoss(missingBoundary, 'yesterday').outflow.weight_kg, 80)
})

test('gas mapper rejects legacy or contradictory outflow, counts, consumption and subtotal contracts', () => {
	const h = harness()
	for (const mutate of [
		data => { delete data.outflow },
		data => { delete data.estimated_consumption_kg },
		data => { data.estimated_consumption_kg = '100' },
		data => { data.status = 'insufficient_data'; data.opening = null; data.estimated_loss_kg = null;
			data.issues = [{ code: 'missing_opening', message: '缺期初' }] },
		data => { data.outflow.weight_kg = null },
		data => { data.outflow.weight_kg = 81 },
		data => { data.outflow.channels.pop() },
		data => { data.outflow.channels[3].key = 'bottle' },
		data => { data.outflow.channels[0].weight_kg = -1 },
		data => { data.outflow.channels[0].count = 1.5 },
		data => { data.outflow.channels[3].count_unit = '瓶次' },
		data => { data.outflow.channels[0].complete = false },
		data => { data.closing.observed_at = 'yesterday' }
	]) {
		const data = tankLoss().data; mutate(data)
		assert.throws(() => h.mapOperatingTankLoss(data, 'yesterday'), /未完成|不一致/, mutate.toString())
	}
})

test('mappers accept actual backend empty and independently failed domain response shapes', async () => {
	const { makeDb } = require('./lib/accountingTestHarness.cjs')
	const { readCurrentBrief } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/currentBrief')
	const { readTankLoss } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/tankLoss')
	const { readBriefFinance } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBriefFinanceRead')
	const { resolveRange, summarizeOperations } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBrief')
	const h = harness(), now = Date.now(), range = resolveRange({ period: 'today' }, now)
	for (const failedSales of [false, true]) {
		const db = makeDb({}, { count(name, total) { return failedSales && name === 'crm_sale_records' ? {} : { total } } })
		const finance = await readBriefFinance(db, { period: 'today' }, {}, range, { version, summarizeOperations })
		const mapped = h.mapOperatingBrief(finance.data, 'today')
		assert.equal(mapped.business.complete, !failedSales)
		assert.equal(mapped.cash.received, 0)
		const funds = h.mapOperatingCurrent(await readCurrentBrief(db, { now }))
		assert.equal(funds.current.debt.complete, !failedSales)
		assert.equal(funds.current.prepay, 0)
	}
	const gas = await readTankLoss(makeDb({}), { period: 'today' }, now)
	assert.equal(h.mapOperatingTankLoss(gas.data, 'today').outflow.weight_kg, 0)
	assert.equal(gas.data.estimated_consumption_kg, null)
})

test('period switching ignores older responses; periodic reads do not re-read current funds', async () => {
	const h = harness(); h.state.setVisible(true)
	assert.equal(h.calls.length, 1); assert.equal(h.currents.length, 1)
	h.state.setVisible(true)
	assert.equal(h.calls.length, 1, 'mount and onShow do not double-load')
	h.state.selectPeriod('today')
	h.calls[1].resolve(brief('today', 120)); await settle()
	h.calls[0].resolve(brief('yesterday', 10)); await settle()
	assert.equal(h.state.result.value.business.sales, 120)
	assert.equal(h.state.loading.value, false)
	assert.equal(h.currents.length, 1, 'date changes do not query all-history balances')
	h.currents[0].resolve(current()); await settle()
	const poll = [...h.timers.values()][0]; poll(); poll()
	assert.equal(h.calls.length, 3, 'polling skips an in-flight request')
	assert.equal(h.currents.length, 1)
	h.calls[2].resolve(brief('today', 140)); await settle()
	h.state.refreshAll()
	assert.equal(h.currents.length, 2, 'manual refresh also updates current funds')
	h.state.dispose()
})

test('independent failures retain explicitly stale evidence; period switch clears prior amounts', async () => {
	const h = harness(); h.state.setVisible(true)
	h.calls[0].resolve(brief()); h.currents[0].reject(new Error('资金读取未完成')); await settle()
	assert.equal(h.state.result.value.business.total, 12)
	assert.equal(h.state.current.value, null)
	assert.match(h.state.currentError.value, /资金读取/)
	h.state.refresh(); h.calls[1].reject(new Error('连接中断')); await settle()
	assert.equal(h.state.stale.value, true)
	assert.equal(h.state.result.value.business.total, 12)
	h.state.selectPeriod('month')
	assert.equal(h.state.result.value, null)
	h.calls[2].resolve({ code: 0, data: { section: 'full' } }); await settle()
	assert.equal(h.state.result.value, null)
	assert.match(h.state.error.value, /完整数据/)
	h.state.dispose()
})

test('home-only permission loads business data but never requests restricted current funds', async () => {
	let allowed = false
	const h = harness({ canReadCurrent: () => allowed })
	h.state.setVisible(true)
	assert.equal(h.currents.length, 0)
	h.calls[0].resolve(brief()); await settle()
	assert.equal(h.state.result.value.business.total, 12)
	h.state.refreshAll(); h.state.refreshCurrent()
	assert.equal(h.currents.length, 0, 'manual refresh also respects customer-list permission')
	assert.equal(h.state.currentLoading.value, false)
	assert.equal(h.state.currentError.value, '')
	allowed = true
	h.state.refreshCurrent()
	assert.equal(h.currents.length, 1)
	allowed = false
	h.currents[0].resolve(current()); await settle()
	assert.equal(h.state.current.value, null, 'an answer arriving after permission revocation is ignored')
	assert.equal(h.state.currentLoading.value, false)
	h.state.dispose()
})

test('tank loss preserves positive, negative and real zero server values; missing evidence never displays zero', () => {
	const h = harness()
	for (const [signed, label, displayed] of [[20.125, '估算损耗', 20.125], [-8.5, '估算盈余', 8.5], [0, '估算损耗', 0]]) {
		const response = h.mapOperatingTankLoss(tankLoss('yesterday', signed).data, 'yesterday')
		assert.equal(response.estimated_loss_kg, signed)
		assert.equal(h.tankLossPresentation(response).label, label)
		assert.equal(h.tankLossPresentation(response).amount, displayed)
	}
	const missing = tankLoss().data
	missing.status = 'insufficient_data'; missing.opening = null; missing.estimated_consumption_kg = null; missing.estimated_loss_kg = null
	missing.issues = [{ code: 'missing_opening', message: '缺少期初液位采样' }]
	const mapped = h.mapOperatingTankLoss(missing, 'yesterday')
	assert.equal(mapped.issues[0].message, '缺少期初液位采样')
	assert.equal(h.tankLossPresentation(mapped).amount, null)
	const wrong = tankLoss().data; wrong.estimated_loss_kg = null
	assert.throws(() => h.mapOperatingTankLoss(wrong, 'yesterday'), /未完成/)
	const wrongPeriod = tankLoss('today').data; wrongPeriod.range.end = '2026-10-22'
	assert.throws(() => h.mapOperatingTankLoss(wrongPeriod, 'today'), /期间/)
})

test('tank loss requests are independently injectable and old-period replies cannot replace the selected period', async () => {
	const injected = []
	const h = harness({ fetchTankLoss: period => { const request = { period, ...deferred() }; injected.push(request); return request.promise } })
	h.state.setVisible(true)
	assert.equal(h.tankLosses.length, 0, 'injected fetch prevents default API use')
	assert.equal(injected[0].period, 'yesterday')
	h.state.selectPeriod('today')
	assert.equal(injected[1].period, 'today')
	injected[1].resolve(tankLoss('today', -2.125)); await settle()
	injected[0].resolve(tankLoss('yesterday', 99)); await settle()
	assert.equal(h.state.tankLoss.value.period, 'today')
	assert.equal(h.state.tankLoss.value.estimated_loss_kg, -2.125)
	assert.equal(h.state.tankLossLoading.value, false)
	assert.equal(h.state.tankLossError.value, '')
	h.state.dispose()
})

test('tank loss unavailable or failed reads do not erase business data and refresh failures label retained evidence stale', async () => {
	const h = harness(); h.state.setVisible(true)
	h.calls[0].resolve(brief())
	const missing = tankLoss().data
	missing.status = 'insufficient_data'; missing.closing = null; missing.estimated_consumption_kg = null; missing.estimated_loss_kg = null
	missing.issues = [{ code: 'missing_closing', message: '缺少期末液位采样' }]
	h.tankLosses[0].resolve({ code: 0, data: missing }); await settle()
	assert.equal(h.state.result.value.business.total, 12)
	assert.equal(h.state.tankLoss.value.status, 'insufficient_data')
	assert.equal(h.state.tankLossError.value, '')
	h.state.refreshTankLoss(); h.tankLosses[1].resolve(tankLoss()); await settle()
	h.state.refreshTankLoss(); h.tankLosses[2].resolve({ code: 409, msg: '读取期间记录发生变化' }); await settle()
	assert.equal(h.state.tankLoss.value.estimated_loss_kg, 20)
	assert.equal(h.state.tankLossStale.value, true)
	assert.match(h.state.tankLossError.value, /记录发生变化/)
	assert.equal(h.state.result.value.business.total, 12)
	assert.equal(h.state.error.value, '')
	h.state.dispose()
})

test('tank loss polling skips pending reads and ignores hidden/unmounted responses', async () => {
	const h = harness(); h.state.setVisible(true)
	const poll = [...h.timers.values()][0]
	poll(); poll(); assert.equal(h.tankLosses.length, 1)
	h.tankLosses[0].resolve(tankLoss()); await settle()
	poll(); assert.equal(h.tankLosses.length, 2)
	h.state.setVisible(false)
	h.tankLosses[1].resolve(tankLoss('yesterday', 90)); await settle()
	assert.equal(h.state.tankLoss.value.estimated_loss_kg, 20)
	assert.equal(h.state.tankLossStale.value, true)
	assert.equal(h.timers.size, 0)
	h.state.setVisible(true); assert.equal(h.tankLosses.length, 3)
	h.tankLosses[2].resolve(tankLoss('yesterday', 10)); await settle()
	assert.equal(h.state.tankLoss.value.estimated_loss_kg, 10)
	h.state.refreshAll(); assert.equal(h.tankLosses.length, 4)
	h.state.dispose()
	h.tankLosses[3].resolve(tankLoss('yesterday', 100)); await settle()
	assert.equal(h.state.tankLoss.value.estimated_loss_kg, 10)
	assert.equal(h.state.tankLossLoading.value, false)
	assert.equal(h.timers.size, 0)
})

test('hidden and disposed callbacks cannot update state or restart timers', async () => {
	const h = harness(); h.state.setVisible(true); h.state.setVisible(false)
	assert.equal(h.timers.size, 0)
	h.calls[0].resolve(brief()); h.currents[0].resolve(current()); await settle()
	assert.equal(h.state.result.value, null); assert.equal(h.state.current.value, null)
	h.state.setVisible(true)
	assert.equal(h.calls.length, 2); assert.equal(h.currents.length, 2)
	h.state.dispose()
	h.calls[1].resolve(brief()); h.currents[1].resolve(current()); await settle()
	assert.equal(h.state.result.value, null); assert.equal(h.timers.size, 0)
	h.state.setVisible(true); assert.equal(h.calls.length, 2)
})

test('report range changes discard prior responses and failed refresh disables export', async () => {
	const h = harness(); h.state.setVisible(true); h.state.toggleReport()
	h.state.selectReportPreset('month')
	h.reports[1].resolve(report(h.reports[1].query)); await settle()
	const count = h.state.report.value.rows.length
	h.reports[0].resolve(report(h.reports[0].query)); await settle()
	assert.equal(h.state.report.value.rows.length, count)
	assert.equal(h.state.reportCanExport.value, true)
	h.state.refreshReport(); h.reports[2].reject(new Error('查询超时')); await settle()
	assert.equal(h.state.reportStale.value, true)
	assert.equal(h.state.reportCanExport.value, false)
	assert.equal(await h.state.prepareExport(), null)
	h.state.dispose()
})

test('export re-reads exact range and rejects truncated sales or a missing last month day', async () => {
	const h = harness(); h.state.setVisible(true); h.state.toggleReport()
	h.state.selectReportPreset('lastMonth')
	h.reports[1].resolve(report(h.reports[1].query)); await settle()
	const output = h.state.prepareExport()
	assert.equal(h.reports[2].query.start, h.reports[1].query.start)
	const incomplete = report(h.reports[2].query); incomplete.data.daily_report.rows.pop()
	h.reports[2].resolve(incomplete); await settle()
	assert.equal(await output, null); assert.equal(h.sales.length, 0)
	const second = h.state.prepareExport()
	h.reports[3].resolve(report(h.reports[3].query)); await settle()
	h.sales[0].resolve({ code: 0, data: [{ _id: 'sale-1', date: h.sales[0].query.dateStart, accounting: { complete: true, status: 'resolved' } }], paging: { page: 1, total: 2, hasMore: false } }); await settle()
	assert.equal(await second, null)
	assert.match(h.state.exportError.value, /读取未完成/)
	h.state.dispose()
})

test('successful export preserves server weights and changing range cancels older export', async () => {
	const h = harness(); h.state.setVisible(true); h.state.toggleReport()
	h.reports[0].resolve(report(h.reports[0].query)); await settle()
	const output = h.state.prepareExport()
	h.reports[1].resolve(report(h.reports[1].query)); await settle()
	h.sales[0].resolve({ code: 0, data: [{ _id: 'sale-1', date: h.sales[0].query.dateStart, accounting: { complete: true, status: 'resolved' } }], paging: { page: 1, total: 1, hasMore: false } }); await settle()
	const data = await output
	assert.equal(data.summaryRows[0].vehicleWeightKg, 22.123)
	assert.equal(data.salesRows.length, 1)
	assert.equal(data.isCurrent(), true)
	const old = h.state.prepareExport()
	h.state.selectReportPreset('yesterday')
	h.reports[2].resolve(report(h.reports[2].query)); await settle()
	assert.equal(await old, null)
	assert.equal(data.isCurrent(), false)
	assert.equal(h.state.exportError.value, '')
	h.state.dispose()
})

test('export refuses out-of-range and unresolved accounting rows even when pagination is complete', async () => {
	for (const invalid of [{ date: '1999-01-01' }, { accounting: { status: 'unresolved' } }, { accounting: { complete: false } }]) {
		const h = harness(); h.state.setVisible(true); h.state.toggleReport()
		h.reports[0].resolve(report(h.reports[0].query)); await settle()
		const output = h.state.prepareExport()
		h.reports[1].resolve(report(h.reports[1].query)); await settle()
		h.sales[0].resolve({ code: 0, data: [{ _id: 'sale-1', date: h.sales[0].query.dateStart, ...invalid }], paging: { page: 1, total: 1, hasMore: false } }); await settle()
		assert.equal(await output, null)
		assert.match(h.state.exportError.value, /日期范围|待核账务/)
		h.state.dispose()
	}
})

test('uni-button keyboard activation handles Enter and Space, skips disabled/repeated keys', () => {
	const source = fs.readFileSync('src/components/domain/dashboard/OperatingBrief.vue', 'utf8')
	const helper = source.match(/function activateOnKey\([^]*?\n\}/)[0]
	const activate = vm.runInNewContext(`${helper}; activateOnKey`)
	const calls = []
	let prevented = 0
	for (const key of ['Enter', ' ', 'Escape']) activate({ key, preventDefault: () => prevented++ }, value => calls.push(value), false, key)
	activate({ key: 'Enter', preventDefault: () => prevented++ }, () => calls.push('disabled'), true)
	activate({ key: 'Enter', repeat: true, preventDefault: () => prevented++ }, () => calls.push('repeat'))
	assert.deepEqual(calls, ['Enter', ' '])
	assert.equal(prevented, 3)
	for (const tag of source.match(/<button\b(?:[^">]|"[^"]*")*>/g)) {
		assert.match(tag, /role="button"/)
		assert.match(tag, /:?tabindex=/)
		assert.match(tag, /@keydown="activateOnKey/)
	}
})
