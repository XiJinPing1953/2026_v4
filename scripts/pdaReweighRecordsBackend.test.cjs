'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeApp } = require('./lib/fillingHarness.cjs')
const day = '2026-10-21'
const instant = Date.parse(`${day}T00:00:00+08:00`)
const actions = { return: 'listReturnReweighRecordsV1', filling: 'listFillingReweighRecordsV1' }
const tables = { return: 'crm_return_reweighs', filling: 'crm_fillings' }
const roundAction = 'listReturnReweighRoundRecordsV1'
const roundId = 'round_restore_20261021'

function seedRound(app, id = roundId, owner = 'owner') {
	app.db.data('crm_return_reweigh_rounds').set(id, { _id: id, created_by: owner, bottle_ids: [] })
}

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

test('owned return round restores all 127 records across dates with equal timestamps and bounded cursor pages', async () => {
	const app = fixture(); seedRound(app)
	for (let i = 0; i < 127; i++) seed(app, 'return', `r${String(i).padStart(3, '0')}`, {
		round_id: roundId, operation_id: `operation_restore_${i}`, created_at: instant,
		date: i % 2 ? '2026-10-20 23:59:59' : `${day} 00:00:01`
	})
	seed(app, 'return', 'other-round', { round_id: 'other_round_20261021' })
	seed(app, 'return', 'other-owner', { round_id: roundId, created_by: 'other' })
	const before = JSON.stringify([...app.db.tables].map(([name, rows]) => [name, [...rows]]))
	let cursor = '', rows = []
	do {
		const response = await app.invoke(roundAction, { round_id: roundId, page_size: 50, cursor })
		assert.equal(response.code, 0, response.msg)
		rows.push(...response.data.rows); cursor = response.data.next_cursor
		assert.ok(rows.length <= 127)
	} while (cursor)
	assert.equal(rows.length, 127); assert.equal(new Set(rows.map(row => row.id)).size, 127)
	assert.equal(rows.filter(row => row.date === '2026-10-20 23:59:59').length, 63)
	assert.ok(rows.every(row => row.round_id === roundId && row.operation_id.startsWith('operation_restore_')))
	assert.deepEqual(rows[0].capture, { sampled_at: instant })
	assert.equal(rows[0].weighed_at, '2026-10-21 00:00:00')
	assert.ok(!JSON.stringify(rows).includes('private'))
	assert.deepEqual(app.reads, [51, 51, 51])
	assert.equal(JSON.stringify([...app.db.tables].map(([name, data]) => [name, [...data]])), before)
})

test('return round cursor cannot cross rounds, users, bottle filters or date queries; invalid rounds do not scan records', async () => {
	const app = fixture(); seedRound(app); seedRound(app, 'other_round_20261021')
	seedRound(app, 'foreign_round_20261021', 'other')
	for (const id of ['r1', 'r2']) seed(app, 'return', id, { round_id: roundId })
	const first = await app.invoke(roundAction, { round_id: roundId, page_size: 1 })
	const cursor = first.data.next_cursor; assert.ok(cursor)
	for (const data of [{}, { round_id: '' }, { round_id: 'short' }, { round_id: { $ne: null } },
		{ round_id: `${roundId} ` }, { round_id: roundId, page_size: 51 }, { round_id: 'other_round_20261021', cursor },
		{ round_id: roundId, cursor: 'invalid' }, { round_id: roundId, bottle_no: '282', cursor }]) {
		assert.equal((await app.invoke(roundAction, data)).code, 400)
	}
	assert.equal((await app.invoke(roundAction, { round_id: 'foreign_round_20261021' })).code, 403)
	assert.equal((await app.invoke(roundAction, { round_id: 'missing_round_20261021' })).code, 404)
	assert.equal((await app.invoke(actions.return, { date: day, cursor })).code, 400)
	app.db.data('crm_users').set('other', { _id: 'other', token: 'other', role: 'superadmin' })
	assert.equal((await app.invoke(roundAction, { round_id: roundId, cursor }, 'other')).code, 400)
	assert.deepEqual(app.reads, [2])
	const datePage = await app.invoke(actions.return, { date: day, page_size: 1 })
	assert.equal((await app.invoke(roundAction, { round_id: roundId, cursor: datePage.data.next_cursor })).code, 400)
})

test('return round restoration requires return-view permission and owned round; filling-only permission is insufficient', async () => {
	const app = fixture(); seedRound(app)
	const operator = { _id: 'operator', role: 'user', token: 'operator', page_permissions: {
		'/pages/pda/return-reweigh': { view: false }, '/pages/pda/reweigh': { view: true } } }
	app.db.data('crm_users').set(operator._id, operator)
	assert.equal((await app.invoke(roundAction, { round_id: roundId }, '')).code, 401)
	assert.equal((await app.invoke(roundAction, { round_id: roundId }, 'operator')).code, 403)
	operator.page_permissions['/pages/pda/return-reweigh'].view = true
	assert.equal((await app.invoke(roundAction, { round_id: roundId }, 'operator')).code, 403)
	seedRound(app, 'operator_round_20261021', 'operator')
	assert.equal((await app.invoke(roundAction, { round_id: 'operator_round_20261021' }, 'operator')).code, 0)
})

test('explicit summary reads entire owned scope and deduplicates bottles beyond the displayed page', async () => {
 const app = fixture(); seedRound(app)
 for (let i = 0; i < 127; i++) seed(app, 'return', `r${String(i).padStart(3, '0')}`, { bottle_no: String(i % 55), round_id: roundId })
 seed(app, 'return', 'foreign', { created_by: 'other', bottle_no: '999' })
 const response = await app.invoke(actions.return, { date: day, page_size: 30, include_summary: true })
 assert.equal(response.code, 0)
 assert.equal(response.data.rows.length, 30)
 assert.equal(response.data.summary.record_count, 127)
 assert.equal(response.data.summary.bottle_count, 55)
 assert.equal(response.data.summary.rounds[0].bottle_count, 55)
 assert.deepEqual(app.reads, [31, 100, 100])
 const scoped = await app.invoke(actions.return, { date: day, bottle_no: '1', include_summary: true })
 assert.equal(scoped.data.summary.bottle_count, 1)
 assert.equal(scoped.data.summary.record_count, 3)
})

test('print history exposes only stored label snapshot, never fabricates one from weights', async () => {
 const app = fixture()
 const row = seed(app, 'filling', 'label', { operation_id: 'op-label' })
 row.reweigh.label = { company: '新拓能源', bottle_no: '282', tare_weight: 110, gross_weight: 120, net_weight: 10, secret: 'private' }
 seed(app, 'filling', 'legacy')
 const result = await app.invoke(actions.filling, { date: day, include_print: true, include_summary: true })
 assert.equal(result.data.summary.record_count, 2)
 assert.equal(result.data.rows.find(item => item.id === 'label').operation_id, 'op-label')
 assert.equal(result.data.rows.find(item => item.id === 'legacy').label, null)
 assert.ok(!JSON.stringify(result).includes('private'))
})
