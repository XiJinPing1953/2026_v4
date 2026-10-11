'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { buildTruckQuantityClosure: build } = require('../uniCloud-alipay/cloudfunctions/crm-bottle-movement/truckQuantityClosure')
const gas = (id, date, overrides = {}) => ({ _id: id, date, truck_no: id, gross_weight_t: 45, tare_weight_t: 24, net_weight_t: 21, station_weight_t: 21, direct_sale_weight_t: 0, ...overrides })
const fill = (id, date, weight, overrides = {}) => ({ _id: id, date: date.slice(0, 10), filling_time: date, bottle_no: '108', record_type: 'normal_fill', fill_weight: weight, ...overrides })
const cycle = (id, fills, weight, overrides = {}) => ({ id, source_fill_ids: fills, source_out_id: `out:${id}`, bottle_no: '108', status: 'closed', first_fill_day: '2026-09-02', out_day: '2026-09-06', out_net_kg: weight, last_net_kg: weight, ...overrides })
const fact = (row, overrides = {}) => ({ source_id: row._id, expected: Object.fromEntries(['date', 'gross_weight_t', 'tare_weight_t', 'net_weight_t', 'station_weight_t', 'direct_sale_weight_t'].map(key => [key, row[key]])), ...overrides })
const standard = (overrides = {}) => build({ gasIns: [gas('a', '2026-09-01-15-23'), gas('b', '2026-09-05-08-10')], cutoffDay: '2026-09-10', ...overrides })

test('recorded nonzero time is not an unloading time; full-day source windows remain ambiguous', () => {
	const result = standard({ fillings: [fill('before', '2026-08-31', 12), fill('a', '2026-09-02', 63), fill('boundary', '2026-09-05-18', 70), fill('b', '2026-09-06', 60)] })
	assert.equal(result.batches[0].filling.total.kg, 63)
	assert.equal(result.batches[1].filling.total.kg, 60)
	const boundary = result.unassigned_fillings.find(row => row.id === 'boundary')
	assert.deepEqual(boundary.candidate_batch_ids, ['a', 'b'])
	assert.ok(boundary.issues.includes('transfer_overlap'))
	const before = result.unassigned_fillings.find(row => row.id === 'before')
	assert.equal(before.period_before_first, true)
	assert.deepEqual(before.candidate_batch_ids, [])
	assert.equal(result.batches[0].weight.confirmed_weigh_in_kg, null)
	assert.equal(result.batches[0].weight.registered_gross_diff_kg, 21000)
})

test('same-day multiple trucks never acquire an arbitrary order from entry times', () => {
	const result = build({ gasIns: [gas('a', '2026-09-01'), gas('b', '2026-09-05-08-10'), gas('c', '2026-09-05-16-50')], fillings: [fill('x', '2026-09-06-10', 60)], cutoffDay: '2026-09-10' })
	assert.equal(result.summary.filling.total.kg, 0)
	assert.deepEqual(result.unassigned_fillings[0].candidate_batch_ids, ['b', 'c'])
	assert.equal(result.unassigned_fillings[0].fill_kg, 60)
})

test('known boundary handles hour windows and confirmed versus assumed no-out evidence', () => {
	const old = gas('old', '2026-09-28')
	const incoming = gas('incoming', '2026-10-04-08-52', { gross_weight_t: 45.70, tare_weight_t: 24.61, net_weight_t: 21.09, station_weight_t: 21.09 })
	const facts = [fact(incoming, { transfer_start: '2026-10-04 08:05', transfer_end: '2026-10-04 13:05', gross_weight_t: 45.70, tare_weight_t: 24.62, station_weight_t: 21.08, no_out_start: '2026-10-04 08:05', no_out_end: '2026-10-04 13:05', no_out_basis: 'assumed' })]
	const result = build({ gasIns: [old, incoming], facts, fillings: [fill('hour', '2026-10-04-13', 65)], cycles: [cycle('c', ['hour'], 68, { first_fill_day: '2026-10-04', out_day: '2026-10-05' })], cutoffDay: '2026-10-06' })
	const batch = result.batches[1]
	assert.equal(batch.weight.confirmed_weigh_in_kg, 21080)
	assert.equal(batch.weight.adopted_station_in_kg, 21080)
	assert.equal(batch.weight.recorded_station_in_kg, 21090)
	assert.ok(batch.issues.includes('field_station_differs'))
	assert.equal(batch.filling.total.kg, 65)
	assert.equal(batch.filling.assumed_count, 1)
	assert.equal(batch.sales.closed.kg, 0)
	assert.equal(batch.sales.pending.known_kg, 68)
	const noAssumption = build({ gasIns: [old, incoming], facts: [fact(incoming, { transfer_start: '2026-10-04 08:05', transfer_end: '2026-10-04 13:05' })], fillings: [fill('hour', '2026-10-04-13', 65)], cutoffDay: '2026-10-06' })
	assert.equal(noAssumption.unassigned_fillings.length, 1)
})

test('overnight field evidence uses effective day and trims confirmed no-out while preserving mixed-tank status', () => {
	const incoming = gas('b', '2026-10-10-17-30', { gross_weight_t: 45.15, tare_weight_t: 24.08, net_weight_t: 21.07, station_weight_t: 21.07 })
	const result = build({ gasIns: [gas('a', '2026-10-04'), incoming], facts: [fact(incoming, { effective_day: '2026-10-09', transfer_start: '2026-10-09 17:30', transfer_end: '2026-10-10 07:25', no_out_start: '2026-10-09 17:30', no_out_end: '2026-10-10 07:25', no_out_basis: 'confirmed', clear_before: 'not_cleared' })], fillings: [fill('before', '2026-10-09-17', 8, { record_type: 'truck_out_no_sale' }), fill('after', '2026-10-10-16', 65)], dateStart: '2026-10-09', dateEnd: '2026-10-09', cutoffDay: '2026-10-10' })
	assert.equal(result.batches.length, 1)
	assert.equal(result.batches[0].day, '2026-10-09')
	assert.equal(result.batches[0].filling.total.kg, 65)
	assert.equal(result.batches[0].mixed_tank, true)
	assert.equal(result.summary.unassigned_fillings.count, 0)
	assert.equal(result.scope.read_batch_count, 2)
})

test('no-out contradictions retain every filling and split windows cannot force assignment', () => {
	const incoming = gas('b', '2026-09-05')
	const result = standard({ gasIns: [gas('a', '2026-09-01'), incoming], facts: [fact(incoming, { transfer_start: '2026-09-05 08:00', transfer_end: '2026-09-05 13:00', no_out_start: '2026-09-05 08:00', no_out_end: '2026-09-05 13:00', no_out_basis: 'confirmed' })], fillings: [fill('blocked', '2026-09-05-10', 63), fill('both', '2026-09-05', 61)] })
	assert.equal(result.unassigned_fillings.length, 2)
	assert.ok(result.unassigned_fillings.find(row => row.id === 'blocked').issues.includes('no_out_fact_conflict'))
	assert.deepEqual(result.unassigned_fillings.find(row => row.id === 'both').candidate_batch_ids, ['a', 'b'])
	assert.equal(result.summary.unassigned_fillings.kg, 124)
})

test('stale confirmation cannot silently override changed source data or dates', () => {
	const incoming = gas('b', '2026-09-05', { station_weight_t: 20 })
	const staleFact = fact(incoming, { effective_day: '2026-09-04', station_weight_t: 19, gross_weight_t: 44, tare_weight_t: 25, transfer_start: '2026-09-04 08:00', transfer_end: '2026-09-04 13:00' })
	incoming.station_weight_t = 21
	const result = standard({ gasIns: [gas('a', '2026-09-01'), incoming], facts: [staleFact] })
	const b = result.batches[1]
	assert.ok(b.issues.includes('fact_conflict'))
	assert.equal(b.day, '2026-09-05')
	assert.equal(b.weight.adopted_station_in_kg, 21000)
	assert.equal(b.weight.confirmed_weigh_in_kg, null)
})

test('whole cycle sales belong to one working period; cross-truck topups remain one shared sale', () => {
	const result = standard({ fillings: [fill('a1', '2026-09-02', 60), fill('a2', '2026-09-03', 5), fill('b1', '2026-09-06', 10), fill('own', '2026-09-06', 63)], cycles: [cycle('shared', ['a1', 'a2', 'b1'], 74), cycle('own', ['own'], 67)] })
	assert.equal(result.batches[0].filling.normal_fill.kg, 65)
	assert.equal(result.batches[1].filling.normal_fill.kg, 73)
	assert.equal(result.summary.sales.closed.kg, 67)
	assert.equal(result.shared_cycles.length, 1)
	assert.equal(result.summary.shared_out.kg, 74)
	assert.deepEqual(result.shared_cycles[0].candidate_batch_ids, ['a', 'b'])
	assert.equal(result.batches[0].sales.closed.kg, 0)
	assert.equal(result.batches[1].sales.closed.kg, 67)
})

test('pending and unsold keep their filling amounts, other tank output and direct truck sales stay separate', () => {
	const result = standard({ gasIns: [gas('a', '2026-09-01', { net_weight_t: 21, station_weight_t: 13.93, direct_sale_weight_t: 7.07 })], fillings: [fill('pending', '2026-09-02', 60), fill('unsold', '2026-09-03', 65), fill('truck', '2026-09-03', 6090, { bottle_no: 'TRUCK-9335Z' }), fill('agent', '2026-09-03', 50, { record_type: 'truck_out_agent_sale' }), fill('self', '2026-09-03', 8, { record_type: 'truck_out_no_sale' }), fill('unknown', '2026-09-03', 7, { record_type: 'legacy' })], cycles: [cycle('pending', ['pending'], 61, { status: 'pending', issues: ['missing_back'], issue_labels: ['缺少回瓶记录'] }), cycle('unsold', ['unsold'], null, { status: 'unsold', source_out_id: null, out_day: null, last_net_kg: 68 })] })
	const b = result.batches[0]
	assert.equal(b.filling.normal_fill.kg, 125)
	assert.equal(b.filling.truck_refill.kg, 6090)
	assert.equal(b.filling.agent_out.kg, 50)
	assert.equal(b.filling.self_use.kg, 8)
	assert.equal(b.filling.other.kg, 7)
	assert.equal(b.filling.total.kg, 6280)
	assert.equal(b.weight.direct_sale_kg, 7070)
	assert.equal(b.arithmetic_balance_kg, 7650)
	assert.equal(b.sales.pending.kg, 61)
	assert.ok(b.cycles.find(row => row.id === 'pending').issue_labels.includes('缺少回瓶记录'))
	assert.equal(b.sales.unsold.kg, 68)
	assert.equal(b.sales.closed.kg, 0)
})

test('missing and negative source weights are unknown, gram arithmetic preserves fractions, duplicate source counts once', () => {
	const result = standard({ fillings: [fill('one', '2026-09-02', 0.1), fill('two', '2026-09-02', 0.2), fill('missing', '2026-09-02', null), fill('negative', '2026-09-02', -5), fill('duplicate', '2026-09-02', 60), fill('duplicate', '2026-09-02', 60)] })
	assert.equal(result.batches[0].filling.total.kg, null)
	assert.equal(result.batches[0].filling.total.known_kg, 0.3)
	assert.equal(result.batches[0].filling.total.unknown_count, 2)
	assert.equal(result.batches[0].arithmetic_balance_kg, null)
	assert.equal(result.unassigned_fillings.length, 1)
	assert.equal(result.unassigned_fillings[0].fill_kg, 60)
})

test('one out source is never counted twice even if duplicate cycle associations reach the calculator', () => {
	const result = standard({ fillings: [fill('one', '2026-09-02', 60), fill('two', '2026-09-06', 5)], cycles: [cycle('first', ['one'], 66, { source_out_id: 'sale-one' }), cycle('second', ['two'], 66, { source_out_id: 'sale-one' })] })
	assert.equal(result.summary.sales.closed.kg, 0)
	assert.equal(result.shared_cycles.length, 1)
	assert.equal(result.summary.shared_out.kg, 66)
	assert.deepEqual(result.shared_cycles[0].source_fill_ids, ['one', 'two'])
})

test('display filters do not steal out-of-range ownership; cutoff excludes future trucks and recalculation uses new source rows', () => {
	const args = { gasIns: [gas('a', '2026-09-01'), gas('b', '2026-09-05'), gas('future', '2026-09-11')], fillings: [fill('old', '2026-09-03', 60), fill('edge', '2026-09-05', 65), fill('new', '2026-09-06', 70)], dateStart: '2026-09-05', dateEnd: '2026-09-05', cutoffDay: '2026-09-10' }
	const first = build(args)
	assert.equal(first.batches.length, 1)
	assert.equal(first.scope.read_batch_count, 2)
	assert.equal(first.summary.filling.total.kg, 70)
	assert.equal(first.unassigned_fillings.length, 1)
	assert.deepEqual(first.unassigned_fillings[0].candidate_batch_ids, ['a', 'b'])
	assert.equal(first.batches[0].open_period, true)
	const next = build({ ...args, fillings: args.fillings.map(row => row._id === 'new' ? { ...row, fill_weight: 72 } : row), cycles: [cycle('sold', ['new'], 74)] })
	assert.equal(next.summary.filling.total.kg, 72)
	assert.equal(next.summary.sales.closed.kg, 74)
	assert.equal(first.summary.filling.total.kg, 70)
})

test('a future second weighing is not prematurely included at an overnight observation cutoff', () => {
	const incoming = gas('b', '2026-10-10-17-30', { gross_weight_t: 45.15, tare_weight_t: 24.08, net_weight_t: 21.07, station_weight_t: 21.07 })
	const args = { gasIns: [gas('a', '2026-10-04'), incoming], facts: [fact(incoming, { effective_day: '2026-10-09', transfer_start: '2026-10-09 17:30', transfer_end: '2026-10-10 07:25', gross_weight_t: 45.15, tare_weight_t: 24.08, station_weight_t: 21.07 })], dateStart: '2026-10-09', dateEnd: '2026-10-09' }
	const midway = build({ ...args, cutoffDay: '2026-10-09' })
	assert.equal(midway.batches[0].weight.confirmed_weigh_in_kg, null)
	assert.equal(midway.batches[0].weight.adopted_station_in_kg, null)
	assert.equal(midway.batches[0].transfer_in_progress, true)
	assert.equal(midway.summary.adopted_station_in.kg, null)
	assert.equal(build({ ...args, cutoffDay: '2026-10-10' }).batches[0].weight.confirmed_weigh_in_kg, 21070)
})

test('different bottles in the same sale are distinct outbound lines, not duplicate sales', () => {
	const result = standard({ fillings: [fill('one', '2026-09-02', 60, { bottle_no: '108' }), fill('two', '2026-09-03', 65, { bottle_no: '109' })], cycles: [cycle('first', ['one'], 63, { source_out_id: 'same-sale', bottle_no: '108' }), cycle('second', ['two'], 68, { source_out_id: 'same-sale', bottle_no: '109' })] })
	assert.equal(result.summary.sales.closed.kg, 131)
	assert.equal(result.batches[0].sales.closed.cycle_count, 2)
	assert.equal(result.shared_cycles.length, 0)
})
