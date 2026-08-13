'use strict'

const assert = require('node:assert/strict')
const {
	DEFAULT_PERIOD,
	buildCurrentInventory,
	buildFilledUnsoldSnapshot,
	buildLedgerTankT,
	parseShanghaiDayStart,
	resolveTankReading
} = require('../uniCloud-alipay/cloudfunctions/crm-gas-in/currentInventory')

function testPeriodCutoff() {
	assert.equal(parseShanghaiDayStart('2026-08-12'), 1786464000000)
	assert.equal(DEFAULT_PERIOD.opening_tank_t, 0)
}

function testFilledUnsoldState() {
	const fillings = [
		{ _id: 'f1', bottle_no: 'A001', record_type: 'normal_fill', fill_weight: 100, date: '2026-08-12 08:00:00', created_at: 1 },
		{ _id: 'f2', bottle_no: 'B001', record_type: 'normal_fill', fill_weight: 80, date: '2026-08-12 08:10:00', created_at: 2 },
		{ _id: 'f3', bottle_no: 'C001', record_type: 'normal_fill', fill_weight: 60, date: '2026-08-12 08:20:00', created_at: 3 },
		{ _id: 'f4-old', bottle_no: 'D001', record_type: 'normal_fill', fill_weight: 40, date: '2026-08-12 08:30:00', created_at: 4 },
		{ _id: 'f4-new', bottle_no: 'D001', record_type: 'normal_fill', fill_weight: 50, date: '2026-08-12 10:30:00', created_at: 5 },
		{ _id: 'truck', bottle_no: 'TRUCK-001', record_type: 'normal_fill', fill_weight: 1000, date: '2026-08-12 08:40:00', created_at: 6 }
	]
	const movements = [
		{ bottle_no: 'A001', type: 'fill', event_at: Date.parse('2026-08-12T08:00:00+08:00'), source_type: 'filling', source_id: 'f1' },
		{ bottle_no: 'B001', type: 'out', event_at: Date.parse('2026-08-12T09:00:00+08:00'), source_type: 'sale', source_id: 's1' },
		{ bottle_no: 'D001', type: 'fill', event_at: Date.parse('2026-08-12T08:30:00+08:00'), source_type: 'filling', source_id: 'f4-old' }
	]
	const snapshot = buildFilledUnsoldSnapshot({ fillings, movements })
	assert.equal(snapshot.filled_unsold_t, 0.1)
	assert.equal(snapshot.filled_unsold_count, 1)
	assert.equal(snapshot.unresolved_bottle_count, 2)
	assert.deepEqual(snapshot.unresolved.map((item) => item.bottle_no).sort(), ['C001', 'D001'])
}

function testPreCutoffBottleFlowIsArchived() {
	const cutoffAt = parseShanghaiDayStart('2026-08-12')
	const snapshot = buildFilledUnsoldSnapshot({
		cutoffAt,
		fillings: [
			{ _id: 'old-fill', bottle_no: 'OLD001', record_type: 'normal_fill', fill_weight: 100, date: '2026-08-11 23:59:59' },
			{ _id: 'new-fill', bottle_no: 'NEW001', record_type: 'normal_fill', fill_weight: 80, date: '2026-08-12 00:00:00' }
		],
		movements: [
			{ bottle_no: 'OLD001', type: 'fill', event_at: cutoffAt - 1000, source_type: 'filling', source_id: 'old-fill' },
			{ bottle_no: 'NEW001', type: 'fill', event_at: cutoffAt, source_type: 'filling', source_id: 'new-fill' }
		]
	})
	assert.equal(snapshot.filled_unsold_t, 0.08)
	assert.equal(snapshot.filled_unsold_count, 1)
	assert.equal(snapshot.candidate_bottle_count, 1)
}

function testPlcWeightPriority() {
	const tank = { status: 'online', lng_weight_t: 18.4, level_percent: 72, sampled_at: 100000 }
	const first = resolveTankReading({ tank, tankConfig: { full_tank_weight_t: 10 }, now: 105000 })
	const second = resolveTankReading({ tank, tankConfig: { full_tank_weight_t: 60 }, now: 105000 })
	assert.equal(first.tank_t, 18.4)
	assert.equal(second.tank_t, 18.4)
	assert.equal(first.weight_source, 'plc_weight')
	assert.equal(first.is_fallback, false)
}

function testLedgerCutoff() {
	const tankT = buildLedgerTankT({
		period: DEFAULT_PERIOD,
		movements: [
			{ event_at: Date.parse('2026-08-11T23:59:59+08:00'), station_delta_t: 99 },
			{ event_at: Date.parse('2026-08-12T08:00:00+08:00'), station_delta_t: 21.01 },
			{ event_at: Date.parse('2026-08-12T09:00:00+08:00'), station_delta_t: -1.47 }
		]
	})
	assert.equal(tankT, 19.54)
}

function testFallbackAndStale() {
	const fallback = resolveTankReading({
		tank: { status: 'online', level_percent: 50, sampled_at: 100000 },
		tankConfig: { full_tank_weight_t: 30 },
		now: 105000
	})
	assert.equal(fallback.tank_t, 15)
	assert.equal(fallback.weight_source, 'level_estimate')
	assert.equal(fallback.is_fallback, true)
	const invalidDirect = resolveTankReading({
		tank: { status: 'online', lng_weight_t: -1, level_percent: 50, sampled_at: 100000 },
		tankConfig: { full_tank_weight_t: 30 },
		now: 105000
	})
	assert.equal(invalidDirect.tank_t, null)
	assert.equal(invalidDirect.weight_source, 'invalid_plc_weight')
	assert.equal(invalidDirect.is_fallback, false)

	const current = buildCurrentInventory({
		tank: { status: 'online', lng_weight_t: 18.4, sampled_at: 100000 },
		filledUnsold: { filled_unsold_t: 0.5, filled_unsold_count: 5 },
		ledgerTankT: 18.2,
		now: 161001
	})
	assert.equal(current.physical.status, 'stale')
	assert.equal(current.physical.tank_t, 18.4)
	assert.equal(current.physical.total_t, null)
	assert.equal(current.physical.available, false)
	assert.equal(current.ledger.diff_t, null)
}

function testFillConservationAndSaleReduction() {
	const before = buildCurrentInventory({
		tank: { status: 'online', lng_weight_t: 10, sampled_at: 100000 },
		filledUnsold: { filled_unsold_t: 0, filled_unsold_count: 0 },
		now: 105000
	})
	const afterFill = buildCurrentInventory({
		tank: { status: 'online', lng_weight_t: 9.9, sampled_at: 100000 },
		filledUnsold: { filled_unsold_t: 0.1, filled_unsold_count: 1 },
		now: 105000
	})
	const afterSale = buildCurrentInventory({
		tank: { status: 'online', lng_weight_t: 9.9, sampled_at: 100000 },
		filledUnsold: { filled_unsold_t: 0, filled_unsold_count: 0 },
		now: 105000
	})
	assert.equal(before.physical.total_t, 10)
	assert.equal(afterFill.physical.total_t, 10)
	assert.equal(afterSale.physical.total_t, 9.9)
}

testPeriodCutoff()
testFilledUnsoldState()
testPreCutoffBottleFlowIsArchived()
testPlcWeightPriority()
testLedgerCutoff()
testFallbackAndStale()
testFillConservationAndSaleReduction()

console.log('gas inventory current tests passed')
