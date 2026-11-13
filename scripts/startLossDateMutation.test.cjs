'use strict'

// Exercise the public date mutation actions with real start-loss derivation.
// All cloud/database boundaries are local fakes; no production access.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb } = require('./fakeCloudDb.cjs')
const { loadCrmFilling } = require('./loadCrmFillingInternals.cjs')

const user = { _id: 'date-test-user', token: 'date-test-token', role: 'superadmin', username: 'offline-test' }
const reason = 'filling_start_weight_loss'

function setup(date) {
	const fake = createFakeDb()
	fake.table('crm_users').push({ ...user })
	const filling = { _id: 'f1', bottle_no: '25', date, record_type: 'normal_fill', weight_start: 120,
		weight_end: 170, fill_weight: 50, created_at: 1000, updated_at: 1000 }
	fake.table('crm_fillings').push(filling)
	for (const [id, day, gross, stamp] of [['s1', '2026-11-11', 125, 1], ['s2', '2026-11-12', 130, 2]]) {
		fake.table('crm_sale_records').push({ _id: id, date: day, created_at: stamp, updated_at: stamp,
			back_items: [{ bottle_no: '25', gross }] })
		fake.table('crm_bottle_movements').push({ _id: `m_${id}`, type: 'back', source_type: 'sale', source_id: id,
			bottle_no: '25', date: day, created_at: stamp, updated_at: stamp })
	}
	const fn = loadCrmFilling(fake.db)
	const adjustment = () => fake.table('crm_bottle_movements').filter((row) => row.adjust_reason === reason && row.source_id === filling._id)
	const call = (action, data) => fn.main({ action, token: user.token, request_id: 'offline-date-test', data }, {})
	return { fake, fn, filling, adjustment, call }
}

test('批量改灌装日期：新源单版本用于补算，原上秤差 10 正常回退到 5', async () => {
	const h = setup('2026-11-12')
	await h.fn.replaceFillingStartLossAdjustmentForDoc(h.filling, user)
	assert.equal(h.adjustment()[0].loss_weight, 10)
	const result = await h.call('batchUpdateDateV1', { preview: false, scope_mode: 'ids', selector: { ids: ['f1'] }, new_date: '2026-11-11' })
	assert.equal(result.code, 0, JSON.stringify(result))
	assert.equal(result.data.failed, 0, JSON.stringify(result))
	assert.equal(result.data.success, 1)
	const current = h.fake.table('crm_fillings')[0]
	assert.equal(current.date, '2026-11-11')
	assert.ok(current.updated_at > 1000)
	assert.equal(h.adjustment().length, 1)
	assert.equal(h.adjustment()[0].loss_weight, 5)
	assert.equal(h.adjustment()[0].context.basis_ref, 's1')
	assert.equal(h.adjustment()[0].context.filling_generation, current.updated_at)
})

test('日期归一化：保留完整重量事实并传新版本，正确重建既有错值流水', async () => {
	const h = setup('2026/11/12')
	await h.fn.replaceFillingStartLossAdjustmentForDoc(h.filling, user)
	assert.equal(h.adjustment()[0].loss_weight, 10)
	// Force a real replacement, so an early unchanged result cannot mask a stale guard.
	h.adjustment()[0].loss_weight = 99
	const result = await h.call('normalizeDatesV1', { preview: false, scan_limit: 10, max_updates: 10 })
	assert.equal(result.code, 0, JSON.stringify(result))
	assert.equal(result.data.failed, 0, JSON.stringify(result))
	assert.equal(result.data.success, 1)
	const current = h.fake.table('crm_fillings')[0]
	assert.equal(current.date, '2026-11-12')
	assert.ok(current.updated_at > 1000)
	assert.equal(h.adjustment().length, 1, 'normalization must not delete the derived adjustment for missing weight facts')
	assert.equal(h.adjustment()[0].loss_weight, 10)
	assert.equal(h.adjustment()[0].context.weight_start, 120)
	assert.equal(h.adjustment()[0].context.filling_generation, current.updated_at)
})
