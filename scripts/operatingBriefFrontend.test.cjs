'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const version = 'operating-brief/2026-10-23.1'
const strip = path => fs.readFileSync(path, 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const settle = () => new Promise(resolve => setImmediate(resolve))

function deferred() {
	let resolve, reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}
function brief(period = 'yesterday', value = 10) {
	return { code: 0, data: {
		section: 'brief', version, period, complete: true, updated_at: 1792717200000,
		range: { start: period === 'month' ? '2026-10-01' : period === 'today' ? '2026-10-23' : '2026-10-22', end: period === 'yesterday' ? '2026-10-22' : '2026-10-23', today: '2026-10-23' }, money_scale: 3,
		business: { sales: value, flow: 2, total: value + 2, complete: true },
		cash: { received: 8, refund: 1, net: 7, complete: true, scope: 'posted_receipts' },
		operations: { sale_weight_kg: 120, sale_bottle_count: 5, customer_count: 3, recorded_outflow_kg: 144.468, fill_bottle_weight_kg: 100, fill_bottle_count: 4, local_weight_kg: 32.123, local_count: 1, vehicle_weight_kg: 12.345, vehicle_count: 2, complete: true }
	} }
}
function current() {
	return { code: 0, data: { section: 'current', version, complete: true, updated_at: 1792717200000, money_scale: 3,
		current: { receivable: 20.123, prepay: 5.123, customer_count: 4, complete: true }, pending: { count: 2, amount: 4.005, complete: true }
	} }
}
function tankLoss(period = 'yesterday', amount = 20) {
	return { code: 0, data: {
		section: 'tank_loss', version, period, range: brief(period).data.range, complete: true,
		status: 'available', opening: { weight_kg: 1200, observed_at: 1792598400000, level_kpa: 12.5 },
		closing: { weight_kg: 1120 - amount, observed_at: 1792684800000, level_kpa: 11.8 },
		inbound_kg: 0, recorded_outflow_kg: 80, estimated_loss_kg: amount, issues: [],
		updated_at: 1792717200000, estimate_version: 'test-liquid-estimate', snapshot_consistent: false
	} }
}
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
	const c = current().data; c.current.complete = false
	assert.throws(() => h.mapOperatingCurrent(c), /未完成/)
	const range = { start: '2026-10-01', end: '2026-10-23' }
	const r = report(range).data
	assert.equal(h.mapDashboardDailyReport(r, range).rows.length, 23)
	r.daily_report.rows.pop()
	assert.throws(() => h.mapDashboardDailyReport(r, range), /完整日期/)
	const duplicate = report(range).data; duplicate.daily_report.rows[0] = duplicate.daily_report.rows[1]
	assert.throws(() => h.mapDashboardDailyReport(duplicate, range), /重复/)
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
	missing.status = 'insufficient_data'; missing.opening = null; missing.estimated_loss_kg = null
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
	missing.status = 'insufficient_data'; missing.closing = null; missing.estimated_loss_kg = null
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
