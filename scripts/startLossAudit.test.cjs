'use strict'

// The independent start-loss audit must agree with the real crm-filling result on
// clean data and classify every kind of pre-existing damage precisely.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb } = require('./fakeCloudDb.cjs')
const { loadCrmFilling } = require('./loadCrmFillingInternals.cjs')
const { auditBottle, parseDay } = require('./lib/startLossAudit.cjs')

function world() {
	const fake = createFakeDb()
	fake.table('crm_users').push({ _id: 'u1', token: 'tok', role: 'superadmin', username: 't' })
	let i = 0
	for (let t = Date.parse('2026-08-01T00:00:00Z'); t <= Date.parse('2026-11-12T00:00:00Z'); t += 2 * 86400000) {
		const day = new Date(t).toISOString().slice(0, 10)
		i += 1
		const back = 120 + (i % 4)
		const item = i % 6 === 0 ? { bottle_no: '25', tare: 117, net: back - 117 } : { bottle_no: '25', gross: back }
		fake.table('crm_sale_records').push({ _id: `s${i}`, date: day, updated_at: i, created_at: i, back_items: [item] })
		fake.table('crm_bottle_movements').push({ _id: `m${i}`, type: 'back', source_type: 'sale', source_id: `s${i}`, bottle_no: '25', date: day, updated_at: i, created_at: i })
		fake.table('crm_fillings').push({ _id: `f${String(i).padStart(4, '0')}`, bottle_no: '25', date: day, record_type: i % 9 === 0 ? 'truck_out_no_sale' : 'normal_fill',
			weight_start: i % 5 === 0 ? back : back - 1, weight_end: back + 48, fill_weight: 48, created_at: 1e6 + i })
	}
	// first-ever filling before any return
	fake.table('crm_fillings').push({ _id: 'f0000', bottle_no: '25', date: '2026-07-01', record_type: 'normal_fill', weight_start: 121, weight_end: 170, fill_weight: 49, created_at: 1 })
	return { fake, fn: loadCrmFilling(fake.db) }
}
const audit = (fake) => auditBottle({ bottleNo: '25', fillings: fake.table('crm_fillings'), movements: fake.table('crm_bottle_movements'),
	salesById: new Map(fake.table('crm_sale_records').map((s) => [s._id, s])) })

test('干净数据：独立重算与生产补算逐条一致，零差/无依据/非库存类分别归类', async () => {
	const { fake, fn } = world()
	await fn.main({ action: 'syncStartLossAdjustmentsV1', token: 'tok', data: { bottle_nos: ['25'] }, request_id: 'r' }, {})
	const result = audit(fake)
	const classes = new Set(Object.keys(result.counts))
	assert.deepEqual([...classes].sort(), ['no_basis', 'not_candidate', 'ok', 'zero_ok'])
	assert.equal(result.counts.no_basis, 1)
	assert.ok(result.counts.zero_ok > 0 && result.counts.not_candidate > 0)
	assert.equal(result.counts.ok, result.adjustments, 'adjustment count is explained, not compared to the filling count')
	assert.deepEqual(result.orphans, [])
})

test('既有异常：缺失、重复、数值错误、多余零差、多余无依据、孤立流水分别识别', async () => {
	const { fake, fn } = world()
	await fn.main({ action: 'syncStartLossAdjustmentsV1', token: 'tok', data: { bottle_nos: ['25'] }, request_id: 'r' }, {})
	const mv = fake.table('crm_bottle_movements')
	const adj = mv.filter((m) => m.adjust_reason === 'filling_start_weight_loss')
	const missing = adj[0].source_id
	mv.splice(mv.indexOf(adj[0]), 1)
	mv.push({ ...adj[1], _id: 'dup' })
	adj[2].loss_weight += 5
	const zero = fake.table('crm_fillings').find((f) => f._id === 'f0005')
	mv.push({ ...adj[3], _id: 'stale-zero', source_id: zero._id })
	mv.push({ ...adj[3], _id: 'stale-nobasis', source_id: 'f0000', context: { ...adj[3].context, basis_ref: 's3' } })
	mv.push({ ...adj[3], _id: 'orphan', source_id: 'deleted-filling' })
	const result = audit(fake)
	const byId = new Map(result.rows.map((r) => [r.filling_id, r.class]))
	assert.equal(byId.get(missing), 'missing')
	assert.equal(byId.get(adj[1].source_id), 'duplicate')
	assert.equal(byId.get(adj[2].source_id), 'value_mismatch')
	assert.equal(byId.get('f0005'), 'stale_zero')
	assert.equal(byId.get('f0000'), 'stale_no_basis')
	assert.deepEqual(result.orphans.map((o) => o._id), ['orphan'])

	// Re-sync repairs every surviving filling, including a future-dated basis.
	// An orphan has no filling to visit and remains for separate review.
	await fn.main({ action: 'syncStartLossAdjustmentsV1', token: 'tok', data: { bottle_nos: ['25'] }, request_id: 'r2' }, {})
	const after = audit(fake)
	assert.deepEqual(Object.keys(after.counts).sort(), ['no_basis', 'not_candidate', 'ok', 'zero_ok'])
	assert.equal(after.counts.no_basis, 1)
	assert.equal(after.counts.stale_no_basis, undefined, 'ineligible basis must not protect an invalid adjustment')
	assert.deepEqual(after.orphans.map((o) => o._id), ['orphan'])
})

test('同日多次回瓶且重量不同时标记歧义，不直接判错', () => {
	const sales = new Map([['a', { _id: 'a', date: '2026-11-10', back_items: [{ bottle_no: '25', gross: 121 }] }],
		['b', { _id: 'b', date: '2026-11-10', back_items: [{ bottle_no: '25', gross: 123 }] }]])
	const movements = [
		{ _id: 'ma', type: 'back', source_type: 'sale', source_id: 'a', bottle_no: '25', date: '2026-11-10', updated_at: 2, created_at: 2 },
		{ _id: 'mb', type: 'back', source_type: 'sale', source_id: 'b', bottle_no: '25', date: '2026-11-10', updated_at: 1, created_at: 1 },
		{ _id: 'adj', type: 'adjust', source_type: 'manual_fix', source_id: 'f1', adjust_reason: 'filling_start_weight_loss', loss_weight: 3, context: { basis_ref: 'b' } }]
	const fillings = [{ _id: 'f1', bottle_no: '25', date: '2026-11-10', record_type: 'normal_fill', weight_start: 120 }]
	const r = auditBottle({ bottleNo: '25', fillings, movements, salesById: sales })
	assert.equal(r.rows[0].class, 'ambiguous_same_day')
	assert.equal(r.rows[0].expected_loss, 1)
})

test('日期解析与生产口径一致', () => {
	assert.equal(parseDay('2026-11-1'), '2026-11-01')
	assert.equal(parseDay(' 2026/11/10 '), '2026-11-10')
	assert.equal(parseDay('20261110'), '2026-11-10')
	assert.equal(parseDay('2026-13-01'), '')
	assert.equal(parseDay('', Date.parse('2026-11-10T20:00:00Z')), '2026-11-11', 'UTC+8 business day')
})
