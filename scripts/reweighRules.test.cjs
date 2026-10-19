'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveReweighContext, calculateReweighWeights } = require('../uniCloud-alipay/cloudfunctions/crm-filling/reweighRules')
const at = Date.parse('2026-10-19T12:30:00+08:00')
const bottle = { _id: 'b1', bottle_no: 'B1', tare_weight: 100, is_active: true }
const back = (id = 's1', date = '2026-10-18', item = {}) => ({ _id: id, date, biz_mode: 'bottle', updated_at: 1,
	back_items: [{ bottle_no: 'B1', gross: 120, tare: 100, net: 20, ...item }], out_items: [] })
const context = (extra = {}) => ({ bottle: { ...bottle }, sales: [back()], fillings: [], at, ...extra })
const run = (extra = {}) => resolveReweighContext(context(extra))
const original = (extra = {}) => ({ _id: 'f1', bottle_no: 'B1', date: '2026-10-19', filling_time: '2026-10-19-10',
	record_type: 'normal_fill', entry_source: 'pda_reweigh', consistency_status: 'complete', source_version: 1,
	fill_weight: 80, reweigh: { basis: run().data.basis }, ...extra })
const blocked = (extra, pattern) => { const result = run(extra); assert.equal(result.ok, false); assert.match(result.msg, pattern) }

test('first weighing uses the current source return and separates contained net from new filling', () => {
	const result = run()
	assert.equal(result.data.mode, 'create')
	assert.equal(result.data.basis.sale_id, 's1')
	assert.equal(result.data.basis.item_index, 0)
	assert.equal(result.data.filling, null)
	const weights = calculateReweighWeights({ gross_weight: 200, tare_weight: 100, basis: result.data.basis, bottle_no: 'B1' })
	assert.deepEqual(weights.data, { gross_weight: 200, tare_weight: 100, net_weight: 100, fill_weight: 80,
		label: { company: '新拓能源', bottle_no: 'B1', tare_weight: 100, gross_weight: 200, net_weight: 100 } })
})

test('return fallback accepts signed and zero net while gross takes precedence', () => {
	for (const net of [-2.5, 0]) assert.equal(run({ sales: [back('s1', '2026-10-18', { gross: null, net })] }).data.basis.gross_weight, 100 + net)
	assert.equal(run({ sales: [back('s1', '2026-10-18', { gross: 125, tare: null, net: null })] }).data.basis.gross_weight, 125)
})

test('latest missing return weight never falls back and duplicate return rows are rejected', () => {
	blocked({ sales: [back('old', '2026-10-01'), back('new', '2026-10-18', { gross: null, tare: null, net: null })] }, /最近一次回瓶缺少/)
	const duplicate = back(); duplicate.back_items.push({ ...duplicate.back_items[0] })
	blocked({ sales: [duplicate] }, /重复/)
	blocked({ sales: [back(), back('other')] }, /重复/)
})

test('business dates determine the cycle, updates never reorder it, and future records are ignored', () => {
	const older = back('older', '2026-10-01'); older.updated_at = at
	const departure = { _id: 'departure', date: '2026-10-02', out_items: [{ bottle_no: 'B1' }] }
	const future = back('future', '2026-10-19-15', { gross: 150 })
	const sales = [future, back(), departure, older]
	assert.equal(run({ sales }).data.basis.sale_id, 's1')
	assert.equal(run({ sales }).data.context_hash, run({ sales: sales.slice().reverse() }).data.context_hash)
	assert.equal(run({ sales: [back(), future] }).data.context_hash, run().data.context_hash)
})

test('same-day back/out ambiguity and later outbound close the current cycle', () => {
	blocked({ sales: [back(), { _id: 'out', date: '2026-10-18', out_items: [{ bottle_no: 'B1' }] }] }, /先后不明/)
	blocked({ sales: [back(), { _id: 'out', date: '2026-10-19', out_items: [{ bottle_no: 'B1' }] }] }, /已经出瓶/)
	assert.equal(run({ sales: [back(), { _id: 'out', date: '2026-10-19-15', out_items: [{ bottle_no: 'B1' }] }] }).ok, true)
	blocked({ sales: [back('a', '2026-10-16'), back()] }, /连续回瓶/)
})

test('a new cycle excludes earlier completed fillings and requires explicit requested filling to match', () => {
	const old = original({ _id: 'old', date: '2026-10-10', filling_time: '2026-10-10-10' })
	assert.equal(run({ fillings: [old] }).data.mode, 'create')
	blocked({ fillings: [old], fillingId: 'old' }, /指定灌装单/)
	blocked({ fillingId: 'missing' }, /指定灌装单/)
})

test('only one complete module-owned filling on the same unchanged basis can be corrected', () => {
	const filling = original(), result = run({ fillings: [filling], fillingId: 'f1' })
	assert.equal(result.data.mode, 'correct')
	assert.equal(result.data.filling, filling)
	blocked({ fillings: [original({ entry_source: undefined })] }, /不是本模块/)
	blocked({ fillings: [original({ scale_source: 'C606+' })] }, /不是本模块/)
	blocked({ fillings: [original({ raw_scale_payload: { task: { task_id: 'pda' } } })] }, /不是本模块/)
	blocked({ fillings: [original({ consistency_status: 'pending' })] }, /尚未完成/)
	blocked({ fillings: [filling, original({ _id: 'f2' })] }, /多次灌装/)
	blocked({ fillings: [original({ reweigh: { basis: { ...run().data.basis, sale_id: 'wrong' } } })] }, /依据已变化/)
	blocked({ fillings: [filling], sales: [back('s1', '2026-10-18', { gross: 125 })] }, /依据已变化/)
})

test('same-day filling needs an explicit module return reference', () => {
	const sales = [back('s1', '2026-10-19')]
	const basis = run({ sales }).data.basis
	assert.equal(run({ sales, fillings: [original({ reweigh: { basis } })] }).data.mode, 'correct')
	blocked({ sales, fillings: [original({ entry_source: undefined })] }, /先后不明/)
})

test('manual flow/loss, nonordinary sales and invalid source times block inference', () => {
	blocked({ manual: [{ bottle_no: 'B1', date: '2026-10-19', type: 'adjust', source_type: 'manual_fix' }] }, /人工/)
	assert.equal(run({ manual: [{ bottle_no: 'B1', date: '2026-10-01', type: 'adjust' }] }).ok, true)
	blocked({ sales: [back(), { _id: 'agent', date: '2026-10-19', agent_sale_items: [{ bottle_no: 'B1' }] }] }, /代理/)
	blocked({ sales: [back('s1', '2026-02-30')] }, /业务时间/)
	blocked({ sales: [back('s1', '2026-10-18-25')] }, /业务时间/)
})

test('context digest binds bottle tare and relevant current facts without unrelated bottles or projections', () => {
	const first = run().data.context_hash
	assert.equal(run({ at: at + 60000 }).data.context_hash, first)
	assert.notEqual(run({ bottle: { ...bottle, tare_weight: 101 } }).data.context_hash, first)
	assert.notEqual(run({ sales: [{ ...back(), updated_at: 2 }] }).data.context_hash, first)
	assert.notEqual(run({ sales: [back('s1', '2026-10-18', { gross: 121 })] }).data.context_hash, first)
	assert.equal(run({ sales: [back(), { _id: 'unrelated', date: 'bad', back_items: [{ bottle_no: 'B2' }] }], movements: [{ type: 'back' }] }).data.context_hash, first)
	assert.notEqual(run({ fillings: [original()] }).data.context_hash, run({ fillings: [original({ source_version: 2 })] }).data.context_hash)
})

test('inactive or invalid-tare bottles and absent source arrays never coerce missing weights to zero', () => {
	for (const tare_weight of [null, '', false, 0, -1, 'bad']) blocked({ bottle: { ...bottle, tare_weight } }, /皮重/)
	blocked({ bottle: { ...bottle, is_active: false } }, /未启用/)
	blocked({ bottle: { ...bottle, status: 'scrapped' } }, /报废/)
	blocked({ sales: [] }, /未找到本轮回瓶/)
	blocked({ sales: undefined }, /完整源数据/)
})

test('weight validation accepts one decimal, keeps label lean, and rejects nonpositive net/fill', () => {
	const data = { gross_weight: 200.1, tare_weight: 100, basis: { gross_weight: 120 }, bottle_no: 'B1' }
	assert.equal(calculateReweighWeights(data).data.fill_weight, 80.1)
	for (const gross_weight of [null, '', false, -1, 0, 100, 119.9, 120, 200.12]) assert.equal(calculateReweighWeights({ ...data, gross_weight }).ok, false)
	assert.equal(calculateReweighWeights({ ...data, tare_weight: null }).ok, false)
	assert.equal(calculateReweighWeights({ ...data, basis: null }).ok, false)
	const precise = calculateReweighWeights({ gross_weight: 200, tare_weight: 100.05, basis: { gross_weight: 120.05 } })
	assert.equal(precise.data.net_weight, 100)
	assert.equal(precise.data.fill_weight, 80)
})
