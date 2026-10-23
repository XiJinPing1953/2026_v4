'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const { deriveTankEstimate, TANK_ESTIMATE_VERSION } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/tankTelemetry')
const NOW = Date.parse('2026-10-23T04:30:00Z') // 12:30 in UTC+8
const START = Date.parse('2026-10-22T16:00:00Z')
const DAY = 86400000
const round = n => Math.round(n * 1000) / 1000
const kg = level => round(deriveTankEstimate({ tank_id: 'main', level_kpa: level }).estimated_weight_t * 1000)
const log = (id, at, level, detail = {}) => ({ _id: id, action: 'tank_gateway_ingest', created_at: at,
	detail: { tank_id: 'main', gateway_id: 'gateway-1', level_kpa: level, ...detail } })
const filling = (id, weight, extra = {}) => ({ _id: id, date: '2026-10-23', filling_time: '2026-10-23-10',
	fill_weight: weight, created_at: 1, updated_at: 1, ...extra })
const inbound = (id, extra = {}) => ({ _id: id, date: '2026-10-23-09-15', net_weight_t: 2,
	station_weight_t: 1.5, direct_sale_weight_t: 0.5, created_at: 1, updated_at: 1, ...extra })
function setup(extra = {}, openLevel = 30, closeLevel = 29) {
	return { crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }],
		crm_operation_logs: [log('opening', START - 5000, openLevel), log('closing', NOW - 5000, closeLevel)],
		crm_gas_in: [], crm_fillings: [], ...extra }
}
async function run(db, data = {}, now = NOW) {
	const realNow = Date.now
	Date.now = () => now
	try { return await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'tank_loss', period: 'today', ...data }) }
	finally { Date.now = realNow }
}
const insufficient = result => {
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.complete, true)
	assert.equal(result.data.status, 'insufficient_data')
	assert.equal(result.data.estimated_loss_kg, null)
	assert.ok(result.data.issues.length > 0)
}
const channelMap = result => Object.fromEntries(result.data.outflow.channels.map(row => [row.key, row]))

test('real handler computes signed estimated loss from model endpoints, station-only gas and all recorded outflows, with no writes', async () => {
	const tables = setup({ crm_gas_in: [inbound('gas')], crm_fillings: [
		filling('bottle', 100.123, { bottle_no: '123' }), filling('local', 40, { bottle_no: '000' }),
		filling('vehicle', 20, { record_type: 'truck_out_no_sale' }), filling('truck-topup', 50.001, { bottle_no: 'TRUCK' }),
		filling('partial-abort', 10, { status: 'aborted' }), filling('zero', 0)
	] })
	const db = makeDb(tables), result = await run(db)
	assert.equal(result.code, 0, result.msg)
	const d = result.data
	assert.equal(d.status, 'available')
	assert.equal(d.opening.weight_kg, kg(30))
	assert.equal(d.closing.weight_kg, kg(29))
	assert.equal(d.inbound_kg, 1500)
	assert.equal(d.recorded_outflow_kg, 220.124)
	assert.equal(d.outflow.weight_kg, d.recorded_outflow_kg)
	assert.equal(d.outflow.complete, true)
	assert.deepEqual(d.outflow.channels.map(({ key, weight_kg, count, count_unit, complete }) =>
		({ key, weight_kg, count, count_unit, complete })), [
		{ key: 'bottle', weight_kg: 100.123, count: 1, count_unit: '瓶次', complete: true },
		{ key: 'local', weight_kg: 40, count: 1, count_unit: '次', complete: true },
		{ key: 'vehicle', weight_kg: 20, count: 1, count_unit: '次', complete: true },
		{ key: 'other', weight_kg: 60.001, count: 2, count_unit: '次', complete: true }
	])
	assert.equal(d.estimated_loss_kg, round(kg(30) + 1500 - kg(29) - 220.124))
	assert.equal(d.estimated_consumption_kg, round(kg(30) + 1500 - kg(29)))
	assert.equal(d.estimate_version, TANK_ESTIMATE_VERSION)
	assert.equal(d.observation_time_basis, 'server_received_at')
	assert.equal(d.opening.observed_at, START - 5000)
	assert.equal(d.snapshot_consistent, false)
	assert.equal(d.period_started_at, START)
	assert.equal(d.period_ended_at, NOW)
	assert.equal(db.writes.length, 0)
})

test('zero records with valid endpoints give exact zero; negative result remains a surplus', async () => {
	for (const [openLevel, closeLevel] of [[30, 30], [29, 30]]) {
		const result = await run(makeDb(setup({}, openLevel, closeLevel)))
		assert.equal(result.data.status, 'available')
		assert.equal(result.data.inbound_kg, 0)
		assert.equal(result.data.recorded_outflow_kg, 0)
		assert.equal(result.data.outflow.complete, true)
		assert.ok(result.data.outflow.channels.every(row => row.complete && row.weight_kg === 0 && row.count === 0))
		assert.equal(result.data.estimated_loss_kg, round(kg(openLevel) - kg(closeLevel)))
	}
})

test('legacy net/direct split is compatible and direct-only gas never becomes station inventory', async () => {
	const cases = [
		[{ net_weight_t: 2, station_weight_t: undefined, direct_sale_weight_t: undefined }, 2000],
		[{ net_weight_t: 2, station_weight_t: undefined, direct_sale_weight_t: 0.3 }, 1700],
		[{ net_weight_t: 2, station_weight_t: 1.3, direct_sale_weight_t: undefined }, 1300],
		[{ net_weight_t: 2, station_weight_t: 0, direct_sale_weight_t: 2 }, 0],
		[{ net_weight_t: undefined, gross_weight_t: 12, tare_weight_t: 10, station_weight_t: undefined, direct_sale_weight_t: 0.3 }, 1700]
	]
	for (const [fields, expected] of cases) {
		const result = await run(makeDb(setup({ crm_gas_in: [inbound('legacy', fields)] })))
		assert.equal(result.data.status, 'available', JSON.stringify(fields))
		assert.equal(result.data.inbound_kg, expected)
	}
})

test('invalid or inconsistent inbound cannot manufacture a known zero or total', async () => {
	for (const fields of [
		{ net_weight_t: 'bad' }, { station_weight_t: -1 }, { station_weight_t: true },
		{ net_weight_t: 2, station_weight_t: 1.5, direct_sale_weight_t: 1 },
		{ net_weight_t: null, station_weight_t: null, direct_sale_weight_t: null },
		{ net_weight_t: '', station_weight_t: '', direct_sale_weight_t: '' },
		{ net_weight_t: undefined, gross_weight_t: 1, tare_weight_t: 2 }
	]) {
		const result = await run(makeDb(setup({ crm_gas_in: [inbound('bad-gas', fields)] })))
		insufficient(result)
		assert.equal(result.data.inbound_kg, null)
	}
})

test('missing, negative, empty, boolean and nonnumeric outflow weights stay insufficient', async () => {
	for (const weight of [undefined, null, '', ' ', -1, true, 'unknown', Infinity]) {
		const result = await run(makeDb(setup({ crm_fillings: [filling('bad-fill', weight)] })))
		insufficient(result)
		assert.equal(result.data.recorded_outflow_kg, null)
	}
})

test('UTC+8 yesterday uses the next midnight, and completed historical date-only rows are included', async () => {
	const tables = setup({ crm_operation_logs: [log('start', START - DAY - 1000, 30), log('end', START - 1000, 30)],
		crm_gas_in: [inbound('old', { date: '2026-10-22', net_weight_t: 1, station_weight_t: 1, direct_sale_weight_t: 0 }), inbound('today')],
		crm_fillings: [filling('historical', 25, { date: '2026-10-22', filling_time: '' }), filling('today', 999)] })
	const result = await run(makeDb(tables), { period: 'yesterday' })
	assert.equal(result.data.status, 'available')
	assert.equal(result.data.range.start, '2026-10-22')
	assert.equal(result.data.period_started_at, START - DAY)
	assert.equal(result.data.period_ended_at, START)
	assert.equal(result.data.estimated_loss_kg, 975)
})

test('month reads month endpoints only and includes historical rows while excluding future hours today', async () => {
	const first = Date.parse('2026-09-30T16:00:00Z'), requests = []
	const tables = setup({ crm_operation_logs: [log('first', first - 1000, 30), log('end', NOW - 1000, 30),
		log('unneeded-middle', first + DAY, 4)],
		crm_gas_in: [inbound('older', { date: '2026-10-05' }), inbound('future', { date: '2026-10-23-13-00', station_weight_t: 'bad' })],
		crm_fillings: [filling('old', 20, { date: '2026-10-02', filling_time: '' }),
			filling('future', -100, { filling_time: '2026-10-23-13' })] })
	const result = await run(makeDb(tables, { get(name, rows, opts) { if (name === 'crm_operation_logs') requests.push(opts); return { data: structuredClone(rows) } } }), { period: 'month' })
	assert.equal(result.data.status, 'available')
	assert.equal(result.data.inbound_kg, 1500)
	assert.equal(result.data.recorded_outflow_kg, 20)
	assert.equal(result.data.period_started_at, first)
	for (const request of requests.filter(r => r.order)) {
		assert.deepEqual(request.order, [['created_at', 'desc']])
		const clauses = request.where.$and
		const lower = clauses.find(c => c.created_at?.$gte)?.created_at.$gte
		const upper = clauses.find(c => c.created_at?.$lte)?.created_at.$lte
		assert.equal(upper - lower, 90000)
		assert.ok([first, NOW].includes(upper))
	}
})

test('today needs business time, can use recorded ended_at, and never substitutes created_at or ready started_at', async () => {
	for (const period of ['today', 'month']) {
		const tables = setup({ crm_fillings: [filling('date-only', 10, { filling_time: '', started_at: NOW - 20000, created_at: NOW - 10000 })] })
		if (period === 'month') tables.crm_operation_logs[0].created_at = Date.parse('2026-09-30T16:00:00Z') - 1000
		insufficient(await run(makeDb(tables), { period }))
	}
	const good = await run(makeDb(setup({ crm_fillings: [filling('ended', 10, { filling_time: '', ended_at: NOW - 10000 })] })))
	assert.equal(good.data.status, 'available')
	assert.equal(good.data.recorded_outflow_kg, 10)
	const noGasTime = await run(makeDb(setup({ crm_gas_in: [inbound('date-only', { date: '2026-10-23' })] })))
	insufficient(noGasTime)
})

test('business time priority, invalid times and day mismatches do not use record creation time', async () => {
	const future = await run(makeDb(setup({ crm_fillings: [filling('future', 10, { filling_time: '2026-10-23-14', ended_at: NOW - 10000 })] })))
	assert.equal(future.data.recorded_outflow_kg, 0)
	for (const extra of [{ filling_time: '2026-10-23-24' }, { filling_time: '2026-10-22-10' },
		{ filling_time: '', ended_at: START - DAY }, { filling_time: '', ended_at: 'bad' }]) {
		insufficient(await run(makeDb(setup({ crm_fillings: [filling('bad-time', 10, extra)] }))))
	}
})

test('malformed business dates and out-of-Date-range ended_at return insufficient data without throwing', async () => {
	for (const date of ['2026-99-01', '2026-02-30', '2026-10-23-xx']) {
		const db = makeDb(setup({ crm_fillings: [filling('bad-date', 10)] }), { get(name, rows, opts) {
			if (name === 'crm_fillings' && opts.order) rows = rows.map(row => ({ ...row, date, filling_time: '' }))
			return { data: rows }
		} })
		insufficient(await run(db))
	}
	for (const ended_at of [8640000000000001, Number.MAX_SAFE_INTEGER, 'Infinity']) {
		insufficient(await run(makeDb(setup({ crm_fillings: [filling('bad-ended', 10, { filling_time: '', ended_at })] }))))
	}
})

test('current-hour and current-minute records use the start of their explicitly registered time bucket', async () => {
	const result = await run(makeDb(setup({ crm_fillings: [filling('hour', 10, { filling_time: '2026-10-23-12' }),
		filling('minute', 20, { filling_time: '2026-10-23-12-30' }), filling('later', 99, { filling_time: '2026-10-23-12-31' })] })))
	assert.equal(result.data.status, 'available')
	assert.equal(result.data.recorded_outflow_kg, 30)
	assert.match(result.data.business_time_note, /时段起点/)
})

test('missing or older-than-90-second endpoints produce insufficient data, never stale fallback', async () => {
	for (const rows of [[], [log('old', START - 90001, 30), log('close', NOW - 1000, 30)],
		[log('open', START - 1000, 30), log('future', NOW + 1, 30)]]) {
		insufficient(await run(makeDb(setup({ crm_operation_logs: rows }))))
	}
	const inclusive = await run(makeDb(setup({ crm_operation_logs: [log('open', START - 90000, 30), log('close', NOW - 90000, 30)] })))
	assert.equal(inclusive.data.status, 'available')
})

test('latest invalid level blocks an older valid sample, including null, whitespace and out-of-model readings', async () => {
	for (const value of [null, '', ' ', undefined, true, 'bad', -1, 1000]) {
		const tables = setup()
		tables.crm_operation_logs.push(log('latest-invalid', NOW - 1000, value))
		const result = await run(makeDb(tables))
		insufficient(result)
		assert.equal(result.data.closing, null)
		assert.ok(result.data.issues.some(i => i.code === 'closing_invalid_sample'))
	}
})

test('other tanks do not block main; multiple main gateways or changed boundary gateways do', async () => {
	const other = setup()
	other.crm_operation_logs.push(log('other', NOW - 1000, null, { tank_id: 'secondary', gateway_id: 'other-gateway' }))
	assert.equal((await run(makeDb(other))).data.status, 'available')
	for (const mode of ['same-boundary', 'changed-boundary', 'missing-id']) {
		const tables = setup()
		if (mode === 'same-boundary') tables.crm_operation_logs.push(log('other-gateway', NOW - 1000, 30, { gateway_id: 'gateway-2' }))
		else tables.crm_operation_logs[1].detail.gateway_id = mode === 'missing-id' ? '' : 'gateway-2'
		insufficient(await run(makeDb(tables)))
	}
})

test('conflicting latest same-time levels or missing tank identity do not select an arbitrary source', async () => {
	for (const extra of [log('conflict', NOW - 5000, 31), log('missing-tank', NOW - 1000, 31, { tank_id: '' })]) {
		const tables = setup(); tables.crm_operation_logs.push(extra)
		insufficient(await run(makeDb(tables)))
	}
})

test('boundary logs paginate completely using created_at, including more than one page with tied timestamps', async () => {
	const tables = setup()
	for (let i = 0; i < 250; i++) tables.crm_operation_logs.push(log(`same-${i}`, NOW - 5000, 29))
	const result = await run(makeDb(tables))
	assert.equal(result.data.status, 'available')
})

test('truncated logs, duplicate pages, failed counts and failed reads return incomplete, not a fabricated loss', async () => {
	const cases = [
		{ get(name, rows, opts) { return { data: name === 'crm_operation_logs' && opts.order ? [] : rows } } },
		{ count(name, total) { return name === 'crm_operation_logs' ? {} : { total } } },
		{ get(name, rows) { if (name === 'crm_operation_logs') throw new Error('offline'); return { data: rows } } }
	]
	for (const hooks of cases) {
		const db = makeDb(setup(), hooks), result = await run(db)
		assert.equal(result.code, 409)
		assert.equal(result.error_code, 'FINANCIAL_READ_INCOMPLETE')
		assert.equal(result.data.estimated_loss_kg, undefined)
		assert.equal(db.writes.length, 0)
	}
	const tables = setup()
	for (let i = 0; i < 250; i++) tables.crm_operation_logs.push(log(`row-${i}`, NOW - 5000, 29))
	const duplicate = await run(makeDb(tables, { get(name, rows, opts) {
		if (name === 'crm_operation_logs' && opts.skip === 200) rows[0] = tables.crm_operation_logs[1]
		return { data: rows }
	} }))
	assert.equal(duplicate.code, 409)
})

test('whole-read-window business mutations and count changes reject a confident loss', async () => {
	let gasCounts = 0
	const changedCount = await run(makeDb(setup(), { count(name, total) {
		if (name === 'crm_gas_in' && ++gasCounts >= 3) return { total: total + 1 }
		return { total }
	} }))
	assert.equal(changedCount.code, 409)
	let changesChecked = 0
	const updated = await run(makeDb(setup(), { get(name, rows, opts) {
		if (name === 'crm_gas_in' && !opts.order && ++changesChecked >= 2) return { data: [{ _id: 'changed', updated_at: NOW + 1 }] }
		return { data: rows }
	} }))
	assert.equal(updated.code, 409)
	assert.equal(updated.data.financial_evidence.reason, 'records_changed_during_tank_loss')
})

test('tank-source failure is isolated from a successful financial brief request', async () => {
	const db = makeDb(setup(), { get(name, rows) { if (name === 'crm_operation_logs') throw new Error('log unavailable'); return { data: rows } } })
	assert.equal((await run(db)).code, 409)
	const brief = await run(db, { section: 'brief' })
	assert.equal(brief.code, 0)
	assert.equal(brief.data.business.total, 0)
	assert.equal(brief.data.cash.net, 0)
	assert.equal(db.writes.length, 0)
})

test('invalid period returns 400 without business reads and home ACL still gates tank loss', async () => {
	const invalid = await run(makeDb(setup()), { period: 'future' })
	assert.equal(invalid.code, 400)
	const tables = setup({ crm_users: [{ _id: 'viewer', token: 'test', role: 'user', page_permissions: { '/pages/index/index': { view: false } } }] })
	const result = await run(makeDb(tables))
	assert.equal(result.code, 403)
})

test('tank outflow distinguishes real cylinders, 000, explicit vehicle fuel and TRUCK or unknown records without double counting', async () => {
	const records = [
		filling('normal', 1, { bottle_no: 'X001', record_type: 'normal_fill' }),
		filling('legacy', 2, { bottle_no: 'X001' }),
		filling('agent-cylinder', 3, { bottle_no: '123', record_type: 'truck_out_agent_sale' }),
		filling('local', 4, { bottle_no: ' 000 ', record_type: 'normal_fill' }),
		filling('vehicle000', 5, { bottle_no: '000', record_type: 'truck_out_no_sale' }),
		filling('vehicletruck', 6, { bottle_no: 'TRUCK-123', record_type: 'truck_out_no_sale' }),
		filling('topup', 7, { bottle_no: 'TRUCK-9335Z', record_type: 'normal_fill' }),
		filling('short-topup', 8, { bottle_no: 'truck' }),
		filling('compact-topup', 9, { bottle_no: 'TRUCK_9335Z' }),
		filling('unknown-type', 10, { bottle_no: '123', record_type: 'unknown' }),
		filling('bad-type', 11, { bottle_no: '123', record_type: true }),
		filling('no-identity', 12), filling('zero', 0, { bottle_no: 'X001' })
	]
	const db = makeDb(setup({ crm_fillings: records }, 30, 30)), result = await run(db)
	assert.equal(result.data.status, 'available')
	const c = channelMap(result)
	assert.deepEqual([c.bottle.weight_kg, c.bottle.count, c.bottle.count_unit], [6, 3, '瓶次'])
	assert.deepEqual([c.local.weight_kg, c.local.count], [4, 1])
	assert.deepEqual([c.vehicle.weight_kg, c.vehicle.count], [11, 2])
	assert.deepEqual([c.other.weight_kg, c.other.count, c.other.count_unit], [57, 6, '次'])
	assert.equal(result.data.outflow.weight_kg, 78)
	assert.equal(result.data.recorded_outflow_kg, 78)
	assert.equal(result.data.estimated_loss_kg, -78, 'vehicle fuel and TRUCK supplement are deducted exactly once')
	assert.equal(db.writes.length, 0)
})

test('outflow channel totals use the same cutoff and three-decimal sums as tank loss', async () => {
	const rows = []
	for (const [key, fields] of Object.entries({ bottle: { bottle_no: '123' }, local: { bottle_no: '000' },
		vehicle: { record_type: 'truck_out_no_sale' }, other: { bottle_no: 'TRUCK-1' } })) {
		rows.push(filling(`${key}-past`, 0.001, fields), filling(`${key}-future`, 900, { ...fields, filling_time: '2026-10-23-13' }))
	}
	const result = await run(makeDb(setup({ crm_fillings: rows }, 30, 30)))
	assert.equal(result.data.status, 'available')
	assert.equal(result.data.outflow.weight_kg, 0.004)
	assert.equal(result.data.estimated_loss_kg, -0.004)
	assert.ok(result.data.outflow.channels.every(row => row.weight_kg === 0.001 && row.count === 1 && row.complete))
})

test('missing telemetry boundaries preserve independently complete inbound, outflow and all channels', async () => {
	const result = await run(makeDb(setup({ crm_operation_logs: [], crm_gas_in: [inbound('gas')],
		crm_fillings: [filling('bottle', 12, { bottle_no: '123' }), filling('truck', 8, { bottle_no: 'TRUCK-1' })] })))
	insufficient(result)
	assert.equal(result.data.opening, null)
	assert.equal(result.data.closing, null)
	assert.equal(result.data.estimated_consumption_kg, null)
	assert.equal(result.data.inbound_kg, 1500)
	assert.equal(result.data.outflow.complete, true)
	assert.equal(result.data.outflow.weight_kg, 20)
	assert.equal(channelMap(result).bottle.weight_kg, 12)
	assert.equal(channelMap(result).other.weight_kg, 8)
	assert.deepEqual(result.data.outflow.issues, [])
})

test('a current-day missing business time invalidates only its affected channel and the total', async () => {
	const result = await run(makeDb(setup({ crm_fillings: [
		filling('unknown-bottle-time', 10, { bottle_no: '123', filling_time: '' }),
		filling('local', 5, { bottle_no: '000' }), filling('vehicle', 6, { record_type: 'truck_out_no_sale' })
	] })))
	insufficient(result)
	const c = channelMap(result)
	assert.equal(result.data.outflow.complete, false)
	assert.equal(result.data.outflow.weight_kg, null)
	assert.equal(result.data.recorded_outflow_kg, null)
	assert.equal(result.data.estimated_consumption_kg, round(kg(30) - kg(29)), 'known tank consumption survives missing outflow business time')
	assert.deepEqual([c.bottle.complete, c.bottle.weight_kg, c.bottle.count], [false, null, null])
	assert.deepEqual([c.local.complete, c.local.weight_kg, c.local.count], [true, 5, 1])
	assert.deepEqual([c.vehicle.complete, c.vehicle.weight_kg, c.vehicle.count], [true, 6, 1])
	assert.deepEqual([c.other.complete, c.other.weight_kg, c.other.count], [true, 0, 0])
	assert.equal(result.data.outflow.issues[0].channel_key, 'bottle')
	assert.equal(result.data.outflow.issues[0].code, 'filling_time_unknown')
})

test('bad outflow weight does not erase unrelated known channels; bad inbound does not erase outflow', async () => {
	const badOutflow = await run(makeDb(setup({ crm_fillings: [filling('bad-truck', -1, { bottle_no: 'TRUCK-1' }),
		filling('bottle', 10, { bottle_no: '123' })] })))
	insufficient(badOutflow)
	assert.equal(channelMap(badOutflow).other.complete, false)
	assert.equal(channelMap(badOutflow).other.weight_kg, null)
	assert.equal(channelMap(badOutflow).bottle.weight_kg, 10)
	assert.equal(badOutflow.data.inbound_kg, 0)
	const badInbound = await run(makeDb(setup({ crm_gas_in: [inbound('bad-gas', { station_weight_t: 'bad' })],
		crm_fillings: [filling('bottle', 10, { bottle_no: '123' })] })))
	insufficient(badInbound)
	assert.equal(badInbound.data.inbound_kg, null)
	assert.equal(badInbound.data.estimated_consumption_kg, null)
	assert.equal(badInbound.data.outflow.complete, true)
	assert.equal(badInbound.data.outflow.weight_kg, 10)
	assert.equal(channelMap(badInbound).bottle.count, 1)
})

test('outflow source read failure cannot be turned into zero-valued channels', async () => {
	const db = makeDb(setup(), { get(name, rows) {
		if (name === 'crm_fillings') throw new Error('filling source unavailable')
		return { data: rows }
	} })
	const result = await run(db)
	assert.equal(result.code, 409)
	assert.equal(result.error_code, 'FINANCIAL_READ_INCOMPLETE')
	assert.equal(result.data.outflow, undefined)
	assert.equal(db.writes.length, 0)
})

test('outflow categories include all pages and count repeated cylinder filling events, not distinct cylinders', async () => {
	const rows = Array.from({ length: 251 }, (_, index) => filling(`bottle-${String(index).padStart(3, '0')}`, 0.001, { bottle_no: '123' }))
	rows.push(filling('zero-local', 0, { bottle_no: '000' }), filling('zero-truck', 0, { bottle_no: 'TRUCK-1' }))
	const result = await run(makeDb(setup({ crm_fillings: rows })))
	assert.equal(result.data.outflow.complete, true)
	assert.equal(result.data.outflow.weight_kg, 0.251)
	assert.deepEqual([channelMap(result).bottle.weight_kg, channelMap(result).bottle.count], [0.251, 251])
	assert.equal(channelMap(result).local.count, 0)
	assert.equal(channelMap(result).other.count, 0)
})
