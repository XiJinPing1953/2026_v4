'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildFillingClosure } = require('../uniCloud-alipay/cloudfunctions/crm-bottle-movement/fillingClosure')

function fixture() {
	const fillings = []
	const events = []
	const sale = (type, id, date, net, no = '1', context = {}) => {
		events.push({ _id: `${type}:${id}:${no}`, type, source_type: 'sale', source_id: id, bottle_no: no,
			date, event_day: date.slice(0, 10), net_weight: net, context: { tare: 100, gross: net == null ? null : net + 100, ...context } })
	}
	const fill = (id, date, start, end, no = '1', extra = {}) => {
		const row = { _id: id, bottle_no: no, date: date.slice(0, 10), filling_time: date.length > 10 ? date : '',
			record_type: 'normal_fill', weight_start: start, weight_end: end,
			fill_weight: start == null || end == null ? null : end - start, ...extra }
		fillings.push(row)
		events.push({ _id: `fill:${id}`, type: 'fill', source_type: 'filling', source_id: id, bottle_no: no,
			date, event_day: date.slice(0, 10), net_weight: row.fill_weight, context: {} })
	}
	const run = options => buildFillingClosure({ events, fillings, dateStart: '2026-09-01', dateEnd: '2026-09-02', cutoffDay: '2026-09-10', ...options })
	return { events, fillings, sale, fill, run }
}

test('a fill cycle retains returned gas and closes against one source sale', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 118, 218)
	f.sale('out', 'sale', '2026-09-03', 115)
	const result = f.run()
	const row = result.cycles[0]
	assert.equal(row.status, 'closed')
	assert.equal(row.pre_fill_net_kg, 18)
	assert.equal(row.start_loss_kg, 2)
	assert.equal(row.total_fill_kg, 100)
	assert.equal(row.out_net_kg, 115)
	assert.equal(row.post_fill_difference_kg, 3)
	assert.equal(result.summary.out_net_kg, 115)
	assert.equal(row.evidence.length, 3)
})

test('later top-up stays in the first filling cohort without duplicating sold weight', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.fill('f2', '2026-09-04', 218, 228)
	f.sale('out', 'sale', '2026-09-05', 127)
	const result = f.run()
	assert.equal(result.cycles.length, 1)
	const row = result.cycles[0]
	assert.equal(row.selected_fill_kg, 100)
	assert.equal(row.later_fill_kg, 10)
	assert.equal(row.total_fill_kg, 110)
	assert.equal(row.start_loss_kg, 2)
	assert.equal(row.post_fill_difference_kg, 1)
	assert.deepEqual(row.source_fill_ids, ['f1', 'f2'])
	assert.equal(result.summary.out_net_kg, 127)
	const laterOnly = f.run({ dateStart: '2026-09-04', dateEnd: '2026-09-04', selectedFillingIds: ['f2'] })
	assert.equal(laterOnly.cycles.length, 0)
	assert.equal(laterOnly.scope.excluded_prior_cycle_count, 1)
})

test('observation cutoff reports unsold then follows the same cycle into a later sale', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.sale('out', 'sale', '2026-09-06', 117)
	const before = f.run({ cutoffDay: '2026-09-05' })
	assert.equal(before.cycles[0].status, 'unsold')
	assert.equal(before.cycles[0].out_net_kg, null)
	assert.equal(before.summary.unsold_net_kg, 120)
	assert.equal(before.summary.out_net_kg, 0)
	const after = f.run()
	assert.equal(after.cycles[0].id, before.cycles[0].id)
	assert.equal(after.cycles[0].status, 'closed')
})

test('a changed source is used on recalculation and a stale event is visibly pending', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.sale('out', 'sale', '2026-09-03', 117)
	f.fillings[0].weight_end = 225
	f.fillings[0].fill_weight = 105
	let row = f.run().cycles[0]
	assert.equal(row.total_fill_kg, 105)
	assert.equal(row.status, 'pending')
	assert.ok(row.issues.includes('filling_source_mismatch'))
	f.events.find(event => event.type === 'fill').net_weight = 105
	row = f.run().cycles[0]
	assert.equal(row.status, 'closed')
	assert.equal(row.post_fill_difference_kg, 8)
})

test('missing weights remain null and missing return does not vanish or become unsold', () => {
	const f = fixture()
	f.fill('f1', '2026-09-01', null, 220)
	const result = f.run()
	assert.equal(result.cycles.length, 1)
	assert.equal(result.cycles[0].status, 'pending')
	assert.equal(result.cycles[0].total_fill_kg, null)
	assert.equal(result.cycles[0].pre_fill_net_kg, null)
	assert.equal(result.summary.total_fill_kg, null)
	assert.equal(result.summary.unknown_weight_counts.total_fill_kg, 1)
	assert.equal(result.summary.known_totals.total_fill_kg, 0)
	assert.equal(result.summary.pending_fill_kg, null)
	assert.ok(result.cycles[0].issues.includes('missing_back'))
})

test('duplicate source events are counted once and prevent a confirmed conclusion', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.sale('out', 'sale', '2026-09-03', 117)
	f.events.push({ ...f.events[1], _id: 'duplicate-fill' }, { ...f.events[2], _id: 'duplicate-out' })
	const result = f.run()
	assert.equal(result.cycles.length, 1)
	assert.equal(result.cycles[0].total_fill_kg, 100)
	assert.equal(result.cycles[0].status, 'pending')
	assert.equal(result.summary.out_net_kg, 0)
	assert.ok(result.cycles[0].issues.includes('duplicate_source_event'))
})

test('same bottle sold, returned, filled again creates separate cycles', () => {
	const f = fixture()
	f.sale('back', 'return1', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.sale('out', 'sale1', '2026-09-03', 117)
	f.sale('back', 'return2', '2026-09-04', 10)
	f.fill('f2', '2026-09-05', 110, 210)
	f.sale('out', 'sale2', '2026-09-07', 107)
	f.sale('out', 'unmatched', '2026-09-08', 107)
	const result = f.run({ dateEnd: '2026-09-06' })
	assert.equal(result.cycles.length, 2)
	assert.equal(result.summary.out_net_kg, 224)
	assert.equal(result.scope.unmatched_out_count, 1)
	assert.deepEqual(result.cycles.map(row => row.source_out_id), ['sale1', 'sale2'])
})

test('shared same-day back/out waiting rule uses next fill to establish return context', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.sale('out', 'previous-sale', '2026-08-31', 120)
	f.fill('f1', '2026-09-01', 120, 220)
	f.sale('out', 'sale', '2026-09-03', 118)
	const row = f.run().cycles[0]
	assert.equal(row.status, 'closed')
	assert.equal(row.evidence[0].source_id, 'return')
	assert.equal(row.source_out_id, 'sale')
})

test('an unresolved return after filling and multiple same-day turns remain pending', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.sale('back', 'return2', '2026-09-03', 10)
	assert.ok(f.run().cycles[0].issues.includes('back_before_out'))
	const g = fixture()
	g.sale('back', 'return', '2026-09-01', 20)
	g.fill('f1', '2026-09-01', 120, 220)
	g.sale('out', 'sale1', '2026-09-01', 118)
	g.sale('out', 'sale2', '2026-09-01', 117)
	assert.ok(g.run().cycles[0].issues.includes('same_day_order_uncertain'))
})

test('known hours that conflict with type-first business order are flagged, not silently reordered', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01-15', 120, 220)
	f.sale('out', 'sale', '2026-09-01-09', 118)
	assert.equal(f.run().cycles[0].status, 'pending')
	assert.ok(f.run().cycles[0].issues.includes('same_day_order_uncertain'))
})

test('restricted or proxy boundaries cannot connect filling to a later sale', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.events.push({ type: 'boundary', bottle_no: '1', date: '2026-09-02', context: { source_issues: ['受限流转待核'] } })
	f.sale('out', 'sale', '2026-09-03', 118)
	const row = f.run().cycles[0]
	assert.equal(row.status, 'pending')
	assert.equal(row.source_out_id, null)
	assert.ok(row.issue_labels.includes('受限流转待核'))
	const boundaryEvidence = row.evidence.find(event => event.type === 'boundary')
	assert.equal(boundaryEvidence.source_id, null)
	assert.equal(boundaryEvidence.net_weight, null)
	f.events.find(event => event.type === 'boundary').date = '2026-09-03'
	assert.equal(f.run().cycles[0].source_out_id, null)
})

test('adjustments do not double-count weighing differences and no input is mutated', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 118, 218)
	f.events.push({ type: 'adjust', bottle_no: '1', date: '2026-09-01', loss_weight: 2 })
	f.sale('out', 'sale', '2026-09-03', 116)
	const before = JSON.stringify({ events: f.events, fillings: f.fillings })
	const result = f.run()
	assert.equal(result.cycles[0].start_loss_kg, 2)
	assert.equal(result.cycles[0].post_fill_difference_kg, 2)
	assert.equal(JSON.stringify({ events: f.events, fillings: f.fillings }), before)
})

test('an unlinked filling source remains visible as pending', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('f1', '2026-09-01', 120, 220)
	f.events.splice(1, 1)
	const row = f.run().cycles[0]
	assert.equal(row.status, 'pending')
	assert.ok(row.issues.includes('missing_filling_movement'))
	assert.equal(row.total_fill_kg, 100)
})

test('one unknown same-day time cannot hide a proven out-before-fill conflict', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-09-01', 20)
	f.fill('f1', '2026-09-01-12', 120, 220)
	f.sale('out', 'sale', '2026-09-01-10', 120)
	const row = f.run().cycles[0]
	assert.equal(row.status, 'pending')
	assert.ok(row.issues.includes('same_day_order_uncertain'))
})

test('manual fill followed by a selected normal fill stays visible as a pending cycle', () => {
	const f = fixture()
	f.sale('back', 'return', '2026-08-31', 20)
	f.events.push({ _id: 'm', type: 'fill', source_type: 'manual', source_id: 'm', bottle_no: '1',
		date: '2026-09-01', event_day: '2026-09-01', net_weight: 100,
		context: { source_issues: ['存在人工流转依据，请核对源记录'] } })
	f.fill('f1', '2026-09-02', 220, 230)
	f.sale('out', 'sale', '2026-09-03', 130)
	const result = f.run({ selectedFillingIds: ['f1'] })
	assert.equal(result.cycles.length, 1)
	assert.equal(result.cycles[0].status, 'pending')
	assert.equal(result.cycles[0].first_fill_day, '2026-09-01')
	assert.deepEqual(result.cycles[0].source_fill_ids, ['m', 'f1'])
	assert.equal(result.summary.pending_count, 1)
})

test('prior-cycle disclosure counts only selected-date top-ups, not unrelated bottle history', () => {
	const f = fixture()
	f.sale('back', 'old-return', '2026-08-01', 20)
	f.fill('old', '2026-08-02', 120, 200)
	f.sale('out', 'old-sale', '2026-08-03', 99)
	f.sale('back', 'return', '2026-08-31', 20)
	f.fill('first', '2026-09-01', 120, 220)
	f.fill('top-up', '2026-09-04', 220, 230)
	f.sale('out', 'sale', '2026-09-05', 129)
	for (const selectedFillingIds of [['top-up'], null]) {
		const result = f.run({ dateStart: '2026-09-04', dateEnd: '2026-09-04', selectedFillingIds })
		assert.equal(result.cycles.length, 0)
		assert.equal(result.scope.excluded_prior_cycle_count, 1)
		assert.equal(result.scope.selected_prior_fill_count, 1)
		assert.equal(result.scope.selected_prior_fill_kg, 10)
		assert.equal(result.scope.selected_prior_unknown_weight_count, 0)
	}
	assert.equal(f.run({ dateStart: '2026-09-06', dateEnd: '2026-09-06' }).scope.excluded_prior_cycle_count, 0)
})
