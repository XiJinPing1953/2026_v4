'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApp } = require('./lib/fillingHarness.cjs')
const day = '2026-10-21'
const instant = Date.parse(`${day}T00:00:00+08:00`)
const actions = { return: 'listReturnReweighRecordsV1', filling: 'listFillingReweighRecordsV1' }
const tables = { return: 'crm_return_reweighs', filling: 'crm_fillings' }

function fixture() {
	const app = makeApp(), collection = app.db.collection.bind(app.db), reads = []
	app.db.collection = name => {
		const wrap = query => new Proxy(query, { get(target, key) {
			if (key === 'field') return fields => {
				// Existing harness projects top-level keys only. Include each nested
				// parent, deliberately retaining private fields to test the public mapper.
				const roots = Object.fromEntries(Object.keys(fields).map(field => [field.split('.')[0], true]))
				return wrap(target.field(roots))
			}
			if (['where', 'orderBy', 'limit', 'skip', 'doc'].includes(key)) return (...args) => {
				if (key === 'limit' && Object.values(tables).includes(name)) reads.push(args[0])
				return wrap(target[key](...args))
			}
			return target[key]
		} })
		return wrap(collection(name))
	}
	return { ...app, reads }
}

function seed(app, mode, id, extra = {}) {
	const weights = { gross_weight: 120, tare_weight: 124, net_weight: -4 }
	const row = { _id: id, bottle_no: '282', date: mode === 'return' ? `${day} 00:00:01` : day,
		created_at: instant + 1000, created_by: 'owner', secret: 'private',
		...(mode === 'return' ? { ...weights, capture: { sampled_at: instant, raw: 'private' } }
			: { entry_source: 'pda_reweigh', fill_weight: 8.5, consistency_status: 'complete',
				reweigh: { ...weights, capture_method: 'ble', measured_at: instant, capture: { sampled_at: instant, raw: 'private' }, basis: { secret: 'private' } } }), ...extra }
	app.db.data(tables[mode]).set(id, row)
	return row
}

test('both query types page beyond ten without gaps at equal timestamps and only read bounded database pages', async () => {
	for (const mode of ['return', 'filling']) {
		const app = fixture()
		for (let i = 0; i < 127; i++) seed(app, mode, `r${String(i).padStart(3, '0')}`, { created_at: instant + Math.floor(i / 70) })
		seed(app, mode, 'other-owner', { created_by: 'other' })
		seed(app, mode, 'previous-day', { date: mode === 'return' ? '2026-10-20 23:59:59' : '2026-10-20' })
		if (mode === 'filling') seed(app, mode, 'ordinary', { entry_source: 'manual' })
		const before = JSON.stringify([...app.db.data(tables[mode])])
		let cursor = '', ids = [], pages = 0
		do {
			const response = await app.invoke(actions[mode], { date: day, page_size: 30, cursor })
			assert.equal(response.code, 0, response.msg)
			assert.equal(response.data.has_more, Boolean(response.data.next_cursor))
			ids.push(...response.data.rows.map(row => row.id)); cursor = response.data.next_cursor
			assert.ok(++pages < 10)
		} while (cursor)
		assert.equal(ids.length, 127); assert.equal(new Set(ids).size, 127)
		assert.deepEqual(ids, [...app.db.data(tables[mode]).values()].filter(row => /^r\d+$/.test(row._id))
			.sort((a, b) => b.created_at - a.created_at || b._id.localeCompare(a._id)).map(row => row._id))
		assert.equal(pages, 5); assert.deepEqual(app.reads, [31, 31, 31, 31, 31])
		assert.equal(JSON.stringify([...app.db.data(tables[mode])]), before)
	}
})

test('exact normalized bottle filter, business date, current creator and current corrected filling values are preserved', async () => {
	const app = fixture()
	seed(app, 'return', 'return1', { bottle_no: 'X282' })
	seed(app, 'return', 'return2', { bottle_no: 'X2820' })
	const result = await app.invoke(actions.return, { date: day, bottle_no: ' x 282 ' })
	assert.deepEqual(result.data.rows.map(row => row.id), ['return1'])
	const corrected = seed(app, 'filling', 'filling1')
	corrected.reweigh = { gross_weight: 130, tare_weight: 124, net_weight: 6, capture_method: 'manual',
		measured_at: instant + 86400000, original_ble_capture: { sampled_at: instant }, corrected_by: 'someone_else' }
	const row = (await app.invoke(actions.filling, { date: day })).data.rows[0]
	assert.equal(row.gross_weight, 130); assert.equal(row.fill_weight, 8.5)
	assert.equal(row.weighed_at, '2026-10-22 00:00:00'); assert.equal(row.time_label, '人工更正时间')
	assert.equal(row.date, day)
	assert.equal((await app.invoke(actions.filling, { date: '2026-10-22' })).data.rows.length, 0)
	app.db.data('crm_users').set('someone_else', { _id: 'someone_else', token: 'else', role: 'superadmin' })
	assert.equal((await app.invoke(actions.filling, { date: day }, 'else')).data.rows.length, 0)
})

test('public rows distinguish actual UTC+8 weighing, saved-time fallback and pending consistency without leaking payloads', async () => {
	const app = fixture()
	seed(app, 'return', 'r1')
	const result = await app.invoke(actions.return, { date: day })
	assert.deepEqual(result.data.rows[0], { id: 'r1', bottle_no: '282', date: day, weighed_at: '2026-10-21 00:00:00',
		time_source: 'measured', time_label: '称重时间', gross_weight: 120, tare_weight: 124, net_weight: -4, status: 'complete' })
	seed(app, 'return', 'r2', { capture: {} })
	const fallback = (await app.invoke(actions.return, { date: day })).data.rows.find(row => row.id === 'r2')
	assert.equal(fallback.time_source, 'saved'); assert.equal(fallback.time_label, '保存时间')
	assert.equal(fallback.weighed_at, '2026-10-21 00:00:01')
	seed(app, 'filling', 'f1', { consistency_status: 'anomaly_pending' })
	assert.equal((await app.invoke(actions.filling, { date: day })).data.rows[0].status, 'pending')
	assert.ok(!JSON.stringify(result).includes('private'))
})

test('cursor is bound to owner, date, bottle and mode; malformed requests never become broad scans', async () => {
	const app = fixture(); seed(app, 'return', 'r1'); seed(app, 'return', 'r2')
	const first = await app.invoke(actions.return, { date: day, page_size: 1 })
	const cursor = first.data.next_cursor
	assert.ok(cursor)
	for (const data of [{ date: '2026-02-30' }, {}, { date: day, bottle_no: { $ne: null } }, { date: day, page_size: 51 },
		{ date: day, cursor: 'invalid' }, { date: '2026-10-20', cursor }, { date: day, bottle_no: '282', cursor }]) {
		assert.equal((await app.invoke(actions.return, data)).code, 400)
	}
	assert.equal((await app.invoke(actions.filling, { date: day, cursor })).code, 400)
	app.db.data('crm_users').set('other', { _id: 'other', token: 'other', role: 'superadmin' })
	assert.equal((await app.invoke(actions.return, { date: day, cursor }, 'other')).code, 400)
	assert.deepEqual(app.reads, [2])
})

test('dispatch requires existing module view permission separately for each type and never grants cross-account access', async () => {
	const app = fixture(); seed(app, 'return', 'r1'); seed(app, 'filling', 'f1')
	const operator = { _id: 'operator', role: 'user', token: 'operator', page_permissions: {
		'/pages/pda/return-reweigh': { view: true }, '/pages/pda/reweigh': { view: false } } }
	app.db.data('crm_users').set(operator._id, operator)
	assert.equal((await app.invoke(actions.return, { date: day }, '')).code, 401)
	assert.equal((await app.invoke(actions.filling, { date: day }, 'operator')).code, 403)
	const result = await app.invoke(actions.return, { date: day }, 'operator')
	assert.equal(result.code, 0); assert.equal(result.data.rows.length, 0)
	operator.page_permissions['/pages/pda/return-reweigh'].view = false
	operator.page_permissions['/pages/pda/reweigh'].view = true
	assert.equal((await app.invoke(actions.return, { date: day }, 'operator')).code, 403)
	assert.equal((await app.invoke(actions.filling, { date: day }, 'operator')).code, 0)
})
