'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const { operationKey } = require('../uniCloud-alipay/cloudfunctions/crm-filling/fillingOperations')

function makeDatabase() {
	const tables = new Map()
	let seq = 0
	let fault = null
	const data = (name) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) }
	const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
	const cond = (kind, value) => ({ __condition: kind, value })
	const command = Object.fromEntries(['in', 'nin', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists', 'inc'].map((name) => [name, (value) => cond(name, value)]))
	command.and = (...args) => cond('and', args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
	command.or = (...args) => cond('or', args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
	const matchValue = (actual, expected) => {
		if (expected && expected.__condition) {
			const v = expected.value
			switch (expected.__condition) {
			case 'in': return v.includes(actual)
			case 'nin': return !v.includes(actual)
			case 'eq': return actual === v
			case 'neq': return actual !== v
			case 'gt': return actual > v
			case 'gte': return actual >= v
			case 'lt': return actual < v
			case 'lte': return actual <= v
			case 'exists': return (actual !== undefined) === v
			case 'and': return v.every((item) => matchValue(actual, item))
			case 'or': return v.some((item) => matchValue(actual, item))
			}
		}
		if (expected instanceof RegExp) return expected.test(String(actual || ''))
		return actual === expected
	}
	const matches = (row, where) => {
		if (where.__condition === 'and') return where.value.every((item) => matches(row, item))
		if (where.__condition === 'or') return where.value.some((item) => matches(row, item))
		return Object.entries(where).every(([key, value]) => matchValue(row[key], value))
	}
	const db = { command, tables, data, setFault: (fn) => { fault = fn },
		collection(name) {
			const build = (filter = {}, sorts = [], skip = 0, limit = Infinity, fields = null) => {
				const selected = () => {
					let rows = [...data(name).values()].filter((row) => matches(row, filter))
					rows.sort((a, b) => { for (const [key, dir] of sorts) { if (a[key] === b[key]) continue; return (a[key] > b[key] ? 1 : -1) * (dir === 'asc' ? 1 : -1) } return 0 })
					return rows.slice(skip, skip + limit)
				}
				return {
					where: (where) => build(where, sorts, skip, limit, fields), doc: (id) => build({ _id: id }),
					orderBy: (key, dir) => build(filter, [...sorts, [key, dir]], skip, limit, fields),
					skip: (v) => build(filter, sorts, v, limit, fields), limit: (v) => build(filter, sorts, skip, v, fields),
					field: (v) => build(filter, sorts, skip, limit, v),
					async get() { return { data: selected().map((row) => clone(fields ? Object.fromEntries(Object.entries(row).filter(([key]) => key === '_id' || fields[key])) : row)) } },
					async count() { return { total: selected().length } },
					async add(row) { if (fault) await fault(name, 'add', row); const id = row._id || `r${++seq}`; if (data(name).has(id)) throw new Error('duplicate key'); data(name).set(id, clone({ ...row, _id: id })); return { id } },
					async set(row) { data(name).set(filter._id, clone({ ...row, _id: filter._id })); return { id: filter._id } },
					async update(patch) { if (fault) await fault(name, 'update', patch); const rows = selected(); for (const row of rows) { for (const [key, value] of Object.entries(patch)) row[key] = value && value.__condition === 'inc' ? Number(row[key] || 0) + value.value : clone(value) } return { updated: rows.length } },
					async remove() { const rows = selected(); rows.forEach((row) => data(name).delete(row._id)); return { deleted: rows.length } }
				}
			}
			return build()
		},
		async startTransaction() {
			// Transactions serialize on the mock store, preserving source/slot/side-effect atomicity.
			const previous = db._tx || Promise.resolve()
			let unlock
			db._tx = new Promise((resolve) => { unlock = resolve })
			await previous
			const snapshot = clone([...tables].map(([name, rows]) => [name, [...rows]]))
			let ended = false
			return { collection(name) {
				const collection = db.collection(name)
				return { ...collection, doc(id) {
					const document = collection.doc(id)
					return { ...document, async get() {
						const result = await document.get()
						return { data: result.data[0] || null }
					} }
				} }
			},
				async commit() { ended = true; unlock() },
				async rollback() { if (ended) return; ended = true; tables.clear(); snapshot.forEach(([name, rows]) => tables.set(name, new Map(rows))); unlock() }
			}
		}
	}
	return db
}

function makeApp({ scan, regulatory } = {}) {
	const db = makeDatabase()
	let time = Date.parse('2026-09-06T00:00:00Z')
	const DateMock = class extends Date { static now() { return time } }
	const user = { _id: 'owner', username: 'tester', role: 'superadmin', token: 'good' }
	db.data('crm_users').set(user._id, user)
	for (let i = 1; i <= 53; i++) db.data('crm_bottles').set(`b${i}`, { _id: `b${i}`, bottle_no: `B${i}`, is_active: true, status: 'empty' })
	let scanned = []
	const cloud = { database: () => db, callFunction: async ({ name, data }) => {
		if (name === 'crm-reg-bridge') return { result: regulatory ? await regulatory({ db, data }) : { code: 0, data: {
			total_event_payload: 1, enqueued_total: 1, duplicate_total: 0, missing_bottle_total: 0,
			snapshot: { found_total: 1, enqueued_total: 1, duplicate_total: 0, missing_total: 0 }
		} } }
		assert.equal(name, 'crm-bottle-anomaly')
		assert.equal(data.action, 'touchFillingOperationV1')
		const op = db.data('crm_filling_operations').get(operationKey(data.data.operation_id))
		assert.equal(data.data.worker_secret, op.worker_secret)
		const target = op.targets[data.data.target_index]
		const result = scan ? await scan({ db, op, target, scanned, advance: (n) => { time += n } }) : { code: 0, data: { done: true } }
		if (result.code === 0 && result.data.done) scanned.push(target.bottle_no)
		return { result: { ...result, data: { read_complete: Boolean(result.data?.done), rule_version: 'bottle-flow-2026-09-05-v1', ...result.data } } }
	} }
	const fnPath = path.resolve('uniCloud-alipay/cloudfunctions/crm-filling/index.js')
	const localRequire = createRequire(fnPath)
	const exports = {}
	const helperSource = fs.readFileSync(path.resolve('uniCloud-alipay/cloudfunctions/crm-filling/fillingOperations.js'), 'utf8')
	const helperModule = { exports: {} }
	vm.runInNewContext(helperSource, { module: helperModule, exports: helperModule.exports, require: localRequire, Date: DateMock, Buffer })
	const requireFn = (name) => name === './fillingOperations' ? helperModule.exports : localRequire(name)
	vm.runInNewContext(fs.readFileSync(fnPath, 'utf8'), { exports, require: requireFn, uniCloud: cloud, console, Date: DateMock, process, setTimeout, clearTimeout, Buffer })
	const invoke = (action, data = {}, token = 'good', context = { SOURCE: 'client' }) => exports.main({ action, data, token }, context)
	return { db, invoke, user, scanned, advance: (n) => { time += n }, operation: (id) => db.data('crm_filling_operations').get(operationKey(id)) }
}
const payload = (operation_id = 'operation_batch_53', count = 53) => ({ operation_id, date: '2026-09-05', record_type: 'normal_fill', input_mode: 'net', operator: 'tester', batch_text: Array.from({ length: count }, (_, i) => `B${i + 1} 10`).join('\n') })

// All tests below dispatch the production cloud handler, with only storage/transport mocked.
test('53 bottles stop after six scans, timer resumes all 47 and exact retry creates no duplicate rows', async () => {
	const app = makeApp({ scan: async ({ scanned, advance }) => { if (scanned.length === 5) advance(6100); return { code: 0, data: { done: true } } } })
	let result = await app.invoke('batchCreateV1', payload())
	assert.equal(result.code, 0)
	assert.equal(result.data.saved_total, 53)
	assert.equal(result.data.processed_total, 6)
	assert.equal(result.data.remaining_total, 47)
	assert.equal(result.data.complete, false)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	result = await app.invoke('getOperationV1', { operation_id: payload().operation_id })
	assert.equal(result.data.complete, true)
	assert.equal(new Set(app.scanned).size, 53)
	const repeat = await app.invoke('batchCreateV1', payload())
	assert.equal(repeat.data.complete, true)
	for (const name of ['crm_fillings', 'crm_bottle_movements', 'crm_gas_inventory_movements']) assert.equal(app.db.data(name).size, 53, name)
	assert.ok([...app.db.data('crm_fillings').values()].every((row) => row.consistency_status === 'complete'))
	assert.equal(JSON.stringify(result).includes('worker_secret'), false)
})

test('parallel same operation submits one source/movement/inventory set; changed input is rejected', async () => {
	const app = makeApp()
	const data = payload('operation_parallel_1', 1)
	const responses = await Promise.all([app.invoke('batchCreateV1', data), app.invoke('batchCreateV1', data)])
	assert.ok(responses.every((res) => res.code === 0))
	assert.equal(app.db.data('crm_fillings').size, 1)
	assert.equal(app.db.data('crm_bottle_movements').size, 1)
	assert.equal((await app.invoke('batchCreateV1', { ...data, operator: 'other' })).code, 409)
})

test('source transaction rollback recovers without orphan movement or duplicate inventory', async () => {
	const app = makeApp()
	let fail = true
	app.db.setFault(async (name, action) => { if (name === 'crm_fillings' && action === 'add' && fail) { fail = false; throw new Error('simulated write failure') } })
	const data = payload('operation_tx_failure', 1)
	const response = await app.invoke('batchCreateV1', data)
	assert.equal(response.data.status, 'pending')
	assert.equal(response.data.saved_total, 0)
	assert.equal(app.db.data('crm_bottle_movements').size, 0)
	app.advance(61000)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal((await app.invoke('getOperationV1', data)).data.complete, true)
	assert.equal(app.db.data('crm_fillings').size, 1)
	assert.equal(app.db.data('crm_gas_inventory_movements').size, 1)
})

test('partial single-bottle scan cursor is persisted and resumed instead of restarting each time', async () => {
	const app = makeApp({ scan: async ({ op, advance }) => { if (!op.scan_cursor) { advance(6100); return { code: 0, data: { done: false, cursor: { page: 2 } } } } assert.equal(op.scan_cursor.page, 2); return { code: 0, data: { done: true } } } })
	const data = payload('operation_cursor_1', 1)
	const response = await app.invoke('batchCreateV1', data)
	assert.equal(response.data.remaining_total, 1)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal((await app.invoke('getOperationV1', data)).data.complete, true)
})

test('pending source edits are blocked; changed source version makes stale retry stop before overwriting', async () => {
	const app = makeApp()
	let fail = true
	app.db.setFault(async (name, action) => { if (name === 'crm_bottles' && action === 'update' && fail) throw new Error('status failure') })
	const data = payload('operation_version_1', 1)
	const response = await app.invoke('batchCreateV1', data)
	assert.equal(response.data.saved_total, 1)
	const row = [...app.db.data('crm_fillings').values()][0]
	assert.equal((await app.invoke('updateV1', { _id: row._id, fill_weight: 99 })).code, 409)
	assert.equal((await app.invoke('removeV1', { _id: row._id })).code, 409)
	row.source_version = 2; row.fill_weight = 99
	fail = false
	app.advance(61000)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal((await app.invoke('getOperationV1', data)).data.status, 'failed')
	assert.equal(app.db.data('crm_fillings').get(row._id).fill_weight, 99)
})

test('auth, owner checks and forged timer requests cannot create or process operations', async () => {
	const app = makeApp()
	assert.equal((await app.invoke('batchCreateV1', payload(), '')).code, 401)
	app.db.data('crm_users').set('denied', { _id: 'denied', token: 'denied', role: 'safety_inspector' })
	assert.equal((await app.invoke('batchCreateV1', payload(), 'denied')).code, 403)
	assert.equal((await app.invoke('drain', { SOURCE: 'timing', type: 'timer' }, '', { SOURCE: 'client' })).code, 401)
	assert.equal(app.db.data('crm_fillings').size, 0)
	await app.invoke('batchCreateV1', payload('operation_owner_1', 1))
	app.db.data('crm_users').set('other', { _id: 'other', token: 'other', role: 'user', page_permissions: { '/pages/filling/list': { view: true, create: true } } })
	assert.equal((await app.invoke('getOperationV1', { operation_id: 'operation_owner_1' }, 'other')).code, 403)
	assert.equal((await app.invoke('retryOperationV1', { operation_id: 'operation_owner_1' }, 'other')).code, 403)
})

test('expired lease is recoverable; live lease prevents second runner; repeated failures retain recoverable operation', async () => {
	const app = makeApp({ scan: async () => ({ code: 500, msg: 'temporary outage' }) })
	const data = payload('operation_lease_1', 1)
	await app.invoke('batchCreateV1', data)
	const op = app.operation(data.operation_id)
	op.lease_id = 'crashed'; op.lease_until = Date.now() + 10 ** 12; op.status = 'processing'
	const before = app.scanned.length
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal(app.scanned.length, before)
	op.lease_until = 0; op.next_retry_at = 0
	for (let i = 0; i < 5; i++) { app.advance(1000000); await app.invoke(undefined, {}, '', { SOURCE: 'timing' }) }
	assert.equal(app.operation(data.operation_id).status, 'failed')
	assert.match(app.operation(data.operation_id).last_error, /temporary outage/)
	assert.equal((await app.invoke('retryOperationV1', data)).code, 0)
})

module.exports = { makeDatabase, makeApp }

function loadAnomaly(db) {
	const filename = path.resolve('uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js')
	const exported = {}
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports: exported, require: createRequire(filename),
		uniCloud: { database: () => db }, console, Date, process, Buffer, setTimeout, clearTimeout })
	return exported.main
}

test('real anomaly handler preserves equal-timestamp rows across an 800-event pause and authenticates frozen targets', async () => {
	const db = makeDatabase()
	const handler = loadAnomaly(db)
	const id = 'operation_real_anomaly'
	const ts = Date.parse('2026-09-06T00:00:00Z')
	const row = { _id: 'source', bottle_no: 'B1', source_version: 1, updated_at: ts }
	db.data('crm_fillings').set(row._id, row)
	const op = { _id: operationKey(id), operation_id: id, rows: [{ ...row }], row_cursor: 1,
		targets: [{ kind: 'bottle', bottle_no: 'B1' }], target_cursor: 0, scan_cursor: null,
		created_by: 'owner', actor_role: 'superadmin', status: 'processing', worker_secret: 'secret', lease_id: 'lease', lease_until: Date.now() + 120000 }
	db.data('crm_filling_operations').set(op._id, op)
	for (let i = 0; i < 1001; i++) {
		const _id = `event_${String(i).padStart(4, '0')}`
		db.data('crm_bottle_movements').set(_id, { _id, bottle_no: 'B1', type: 'adjust', type_order: 40, event_at: ts, created_at: ts, date: '2026-09-06', event_day: '2026-09-06', source_type: 'manual', source_id: 'test' })
	}
	const data = { operation_id: id, worker_secret: 'secret', lease_id: 'lease', target_index: 0, bottle_no: 'UNAUTHORIZED' }
	assert.equal((await handler({ action: 'touchFillingOperationV1', data: { ...data, worker_secret: 'wrong' } }, {})).code, 403)
	const first = await handler({ action: 'touchFillingOperationV1', data }, {})
	assert.equal(first.code, 0)
	assert.equal(first.data.done, false)
	assert.equal(first.data.round_scanned_events, 800)
	assert.equal(first.data.cursor.scan.db_cursor._id, 'event_0799')
	op.scan_cursor = first.data.cursor
	const second = await handler({ action: 'touchFillingOperationV1', data }, {})
	assert.equal(second.code, 0)
	assert.equal(second.data.done, true)
	assert.equal(second.data.round_scanned_events, 201)
	assert.equal(second.data.read_complete, true)
	assert.equal(db.data('crm_bottle_anomalies').size, 0)
	row.source_version = 2
	assert.equal((await handler({ action: 'touchFillingOperationV1', data }, {})).code, 409)
})

test('common flow rules keep same-day ambiguity, interleave effective back/out and exclude neutral adjustments', () => {
	const rules = require('../uniCloud-alipay/cloudfunctions/common/bottleFlowRules')
	const event = (type, id) => ({ _id: id, type, date: '2026-09-05', event_at: 1, created_at: 1 })
	const rows = [event('out', 'out2'), event('adjust', 'adjust'), event('back', 'back2'), event('out', 'out1'), event('back', 'back1')]
	assert.equal(rules.hasSameDayBackOutWithoutFill(rows), true)
	assert.deepEqual(rules.effectiveEvents(rows).map((row) => row.type), ['out', 'back', 'out', 'back'])
	assert.deepEqual(rules.businessDayOrder(rows, { hasBack: true }).map((row) => row._id), ['out1', 'back1', 'out2', 'back2', 'adjust'])
	assert.deepEqual(rules.businessDayOrder(rows, { lastWasOut: true }).map((row) => row._id), ['back1', 'out1', 'back2', 'out2', 'adjust'])
	assert.deepEqual(rules.businessDayOrder(rows, { pending: true }).map((row) => row._id), ['back1', 'back2', 'out1', 'out2', 'adjust'])
	assert.equal(rules.hasSameDayBackOutWithoutFill([...rows, event('fill', 'fill')]), false)
})

test('lost progress acknowledgement after source commit resumes from existing row instead of inserting twice', async () => {
	const app = makeApp()
	let fail = true
	app.db.setFault(async (name, action, patch) => { if (name === 'crm_filling_operations' && action === 'update' && patch.saved_cursor === 1 && fail) { fail = false; throw new Error('ack lost after source commit') } })
	const data = payload('operation_ack_lost_1', 1)
	const first = await app.invoke('batchCreateV1', data)
	assert.equal(first.data.complete, false)
	assert.equal(app.db.data('crm_fillings').size, 1)
	app.advance(61000)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal((await app.invoke('getOperationV1', data)).data.complete, true)
	assert.equal(app.db.data('crm_fillings').size, 1)
	assert.equal(app.db.data('crm_bottle_movements').size, 1)
	assert.equal(app.db.data('crm_gas_inventory_movements').size, 1)
})

test('parallel different operation IDs cannot both reserve the same date/bottle', async () => {
	const app = makeApp()
	const results = await Promise.all([
		app.invoke('batchCreateV1', payload('operation_cross_1', 1)),
		app.invoke('batchCreateV1', payload('operation_cross_2', 1))
	])
	assert.ok(results.some((result) => result.data.status === 'failed'))
	assert.equal(app.db.data('crm_fillings').size, 1)
	assert.equal(app.db.data('crm_bottle_movements').size, 1)
})

test('single/PDA entry shares durable transaction and cannot race a batch into duplicate records', async () => {
	const app = makeApp()
	const one = { operation_id: 'operation_single_pda_1', date: '2026-09-05', bottle_no: 'B1', record_type: 'normal_fill', input_mode: 'net', operator: 'tester', fill_weight: 10 }
	const responses = await Promise.all([app.invoke('createV1', one), app.invoke('batchCreateV1', payload('operation_batch_race_1', 1))])
	assert.equal(app.db.data('crm_fillings').size, 1)
	assert.equal(app.db.data('crm_bottle_movements').size, 1)
	assert.equal(app.db.data('crm_gas_inventory_movements').size, 1)
	assert.ok(responses.some((result) => result.code === 0 && result.data.complete))
	const retry = await app.invoke('createV1', one)
	assert.equal(retry.code, 0)
	assert.equal(app.db.data('crm_fillings').size, 1)
})

test('a historical filling without a slot cannot be inserted again by a queued operation', async () => {
	const app = makeApp({ scan: async () => ({ code: 0, data: { done: true } }) })
	const old = { _id: 'historical', date: '2026-09-05', bottle_no: 'B1', record_type: 'normal_fill', created_at: 1 }
	// Inject after preflight, before transaction checks. Legacy data never had a slot.
	const start = app.db.startTransaction
	app.db.startTransaction = async () => { app.db.data('crm_fillings').set(old._id, old); return start() }
	const result = await app.invoke('batchCreateV1', payload('operation_legacy_race', 1))
	assert.equal(result.code, 0)
	assert.equal(result.data.status, 'failed')
	assert.equal(result.data.saved_total, 0)
	assert.equal(app.db.data('crm_fillings').size, 1)
	assert.equal(app.db.data('crm_bottle_movements').size, 0)
})

test('unfinished operations remain visible even behind many recently completed batches', async () => {
	const app = makeApp()
	for (let i = 0; i < 25; i++) app.db.data('crm_filling_operations').set(`done-${i}`, {
		_id: `done-${i}`, operation_id: `done-${i}`, created_by: 'owner', status: 'complete', rows: [], targets: [], created_at: i + 10
	})
	app.db.data('crm_filling_operations').set('failed', {
		_id: 'failed', operation_id: 'failed', created_by: 'owner', status: 'failed', rows: [], targets: [], created_at: 1
	})
	const result = await app.invoke('listOperationsV1')
	assert.equal(result.data[0].operation_id, 'failed')
})

test('single/PDA code zero with zero regulatory payloads stays pending, then retries with current credentials', async () => {
	let ready = false
	const tokens = []
	const app = makeApp({ regulatory: async ({ data }) => {
		tokens.push(data.token)
		return { code: 0, data: { total_event_payload: ready ? 1 : 0, enqueued_total: ready ? 1 : 0, duplicate_total: 0,
			missing_bottle_total: 0, snapshot: { found_total: 1, enqueued_total: 1, duplicate_total: 0, missing_total: 0 } } }
	} })
	const input = { operation_id: 'operation_regulatory', date: '2026-09-05', bottle_no: 'B1', fill_weight: 10 }
	const first = await app.invoke('createV1', input)
	assert.equal(first.data.saved_total, 1)
	assert.equal(first.data.complete, false)
	assert.match(first.data.last_error, /监管/)
	ready = true
	app.user.token = 'renewed'
	app.advance(61000)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal(app.operation(input.operation_id).status, 'complete')
	assert.deepEqual(tokens, ['good', 'renewed'])
	assert.equal(JSON.stringify(app.operation(input.operation_id)).includes('renewed'), false)
})

test('source changed during anomaly call cannot be marked complete by the old operation', async () => {
	const app = makeApp({ scan: async ({ db, op }) => {
		const source = db.data('crm_fillings').get(op.rows[0]._id)
		source.source_version = 2; source.fill_weight = 99
		return { code: 0, data: { done: true } }
	} })
	const result = await app.invoke('batchCreateV1', payload('operation_scan_changed', 1))
	assert.equal(result.data.status, 'failed')
	assert.equal(result.data.complete, false)
	assert.equal([...app.db.data('crm_fillings').values()][0].fill_weight, 99)
})

test('scan done without complete read evidence is never accepted as complete', async () => {
	const app = makeApp({ scan: async () => ({ code: 0, data: { done: true, read_complete: false } }) })
	const result = await app.invoke('batchCreateV1', payload('operation_scan_unproven', 1))
	assert.equal(result.data.complete, false)
	assert.equal(result.data.processed_total, 0)
})

test('PDA-only creator can list own operations for recovery but cannot see another operator', async () => {
	const app = makeApp()
	app.db.data('crm_users').set('pda', { _id: 'pda', token: 'pda', role: 'user', page_permissions: {
		'/pages/pda/filling-create': { view: true, create: true }, '/pages/filling/list': { view: false, create: false }
	} })
	await app.invoke('batchCreateV1', payload('operation_admin_only', 1))
	const result = await app.invoke('listOperationsV1', {}, 'pda')
	assert.equal(result.code, 0)
	assert.equal(result.data.length, 0)
})

test('source query finds committed source even when saved cursor acknowledgement was lost', async () => {
	const app = makeApp()
	let fail = true
	app.db.setFault(async (name, action, patch) => {
		if (name === 'crm_filling_operations' && patch.saved_cursor === 1 && fail) { fail = false; throw new Error('ack lost') }
	})
	const input = payload('operation_query_source', 1)
	await app.invoke('batchCreateV1', input)
	const result = await app.invoke('getOperationV1', input)
	assert.equal(result.data.saved_total, 0)
	assert.equal(result.data.source_saved_total, 1)
	assert.equal(result.data.source_records[0].version_matches, true)
	assert.equal((await app.invoke('getV1', { _id: result.data.source_records[0]._id })).code, 0)
})

test('anomaly durable scan includes historical rows with absent paging fields across 800 boundary', async () => {
	const db = makeDatabase()
	const handler = loadAnomaly(db)
	const id = 'operation_legacy_events'
	const row = { _id: 'source', bottle_no: 'B1', source_version: 1, updated_at: 1 }
	db.data('crm_fillings').set(row._id, row)
	const op = { _id: operationKey(id), operation_id: id, rows: [row], row_cursor: 1, targets: [{ kind: 'bottle', bottle_no: 'B1' }],
		target_cursor: 0, scan_cursor: null, created_by: 'owner', actor_role: 'superadmin', status: 'processing',
		worker_secret: 'secret', lease_id: 'lease', lease_until: Date.now() + 120000 }
	db.data('crm_filling_operations').set(op._id, op)
	for (let i = 0; i < 1001; i++) {
		const _id = `event_${String(i).padStart(4, '0')}`
		db.data('crm_bottle_movements').set(_id, { _id, bottle_no: 'B1', type: 'adjust', date: '2026-01-01', event_at: 1 })
	}
	const input = { action: 'touchFillingOperationV1', data: { operation_id: id, worker_secret: 'secret', lease_id: 'lease', target_index: 0 } }
	const first = await handler(input, {})
	assert.equal(first.data.round_scanned_events, 800)
	op.scan_cursor = first.data.cursor
	const second = await handler(input, {})
	assert.equal(second.data.round_scanned_events, 201)
	assert.equal(second.data.read_complete, true)
	assert.equal(db.data('crm_bottle_anomalies').size, 0)
})

test('real anomaly handler reads all 5189 synthetic historical events across 53 bottles without false anomalies', async () => {
	const { buildFixture } = require('./fillingCloudAcceptance.cjs')
	const fixture = buildFixture()
	const db = makeDatabase()
	const handler = loadAnomaly(db)
	for (const [name, rows] of Object.entries(fixture.collections)) for (const row of rows) db.data(name).set(row._id, row)
	const sources = fixture.collections.crm_bottles.map((bottle, index) => ({ _id: `source_${index}`, bottle_no: bottle.bottle_no, source_version: 1, updated_at: 1 }))
	for (const row of sources) db.data('crm_fillings').set(row._id, row)
	const op = { _id: operationKey(fixture.operation_id), rows: sources, row_cursor: 53,
		targets: sources.map((row) => ({ kind: 'bottle', bottle_no: row.bottle_no })), target_cursor: 0, scan_cursor: null,
		status: 'processing', worker_secret: 'secret', lease_id: 'lease', lease_until: Date.now() + 120000 }
	db.data('crm_filling_operations').set(op._id, op)
	let scanned = 0
	for (let index = 0; index < 53; index++) {
		op.target_cursor = index
		const result = await handler({ action: 'touchFillingOperationV1', data: {
			operation_id: fixture.operation_id, worker_secret: 'secret', lease_id: 'lease', target_index: index
		} }, {})
		assert.equal(result.data.read_complete, true)
		assert.equal(result.data.history_total, index < 48 ? 98 : 97)
		scanned += result.data.round_scanned_events
	}
	assert.equal(scanned, 5189)
	assert.equal(db.data('crm_bottle_anomalies').size, 0)
})

test('manual scan shares bottle lease with durable scan and cannot write through an active lease', async () => {
	const db = makeDatabase()
	db.data('crm_users').set('owner', { _id: 'owner', role: 'superadmin', token: 'good' })
	const lockId = `scan_${require('crypto').createHash('sha256').update('B1').digest('hex').slice(0, 40)}`
	db.data('crm_bottle_scan_locks').set(lockId, { _id: lockId, lease_id: 'worker', lease_until: Date.now() + 120000 })
	const result = await loadAnomaly(db)({ action: 'scanV2', token: 'good', data: { bottle_no: 'B1' } }, {})
	assert.equal(result.data.waiting_for_lock, true)
	assert.equal(result.data.read_complete, false)
	assert.equal(db.data('crm_bottle_anomalies').size, 0)
})

test('transaction approaching 10-second window rolls back and remains recoverable', async () => {
	const app = makeApp()
	let slow = true
	app.db.setFault(async (name, action) => { if (name === 'crm_fillings' && action === 'add' && slow) { slow = false; app.advance(8100) } })
	const input = payload('operation_slow_transaction', 1)
	const first = await app.invoke('batchCreateV1', input)
	assert.equal(first.data.saved_total, 0)
	assert.equal(app.db.data('crm_fillings').size, 0)
	assert.equal(app.db.data('crm_bottle_movements').size, 0)
	app.advance(61000)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal((await app.invoke('getOperationV1', input)).data.complete, true)
})

test('read-only acceptance tool refuses production and mismatched environment before cloud calls', async () => {
	const { buildFixture, inspectCloud } = require('./fillingCloudAcceptance.cjs')
	let calls = 0
	const adapter = { provider: 'alipay', spaceId: 'test-space', isolated: true, call: () => { calls++ } }
	await assert.rejects(inspectCloud({ adapter, spaceId: 'env-00jxuffegf2n', fixture: buildFixture() }), /生产/)
	await assert.rejects(inspectCloud({ adapter, spaceId: 'wrong-space', fixture: buildFixture() }), /不匹配/)
	assert.equal(calls, 0)
})

test('legacy client and current PDA task-shaped payload without operation ID fail before any source write', async () => {
	const app = makeApp()
	const result = await app.invoke('createV1', { date: '2026-09-05', bottle_no: 'B1', fill_weight: 10,
		raw_scale_payload: { task: { task_id: 'synthetic_pda_task' } } })
	assert.equal(result.code, 400)
	assert.match(result.msg, /operation_id/)
	assert.equal(app.db.data('crm_filling_operations').size, 0)
	assert.equal(app.db.data('crm_fillings').size, 0)
})

test('conditional source completion losing a version race stops the operation', async () => {
	const app = makeApp()
	app.db.setFault(async (name, action, patch) => {
		if (name === 'crm_fillings' && action === 'update' && patch.consistency_status === 'complete') {
			const row = [...app.db.data('crm_fillings').values()][0]
			row.source_version = 2; row.fill_weight = 99
		}
	})
	const result = await app.invoke('batchCreateV1', payload('operation_cas_changed', 1))
	assert.equal(result.data.status, 'failed')
	assert.equal([...app.db.data('crm_fillings').values()][0].consistency_status, 'anomaly_pending')
})

test('old processing protocol does not execute a pending frozen operation under new code', async () => {
	const app = makeApp()
	app.db.setFault(async (name, action) => { if (name === 'crm_fillings' && action === 'add') throw new Error('temporary') })
	const input = payload('operation_old_protocol', 1)
	await app.invoke('batchCreateV1', input)
	app.operation(input.operation_id).rule_version = 'filling-consistency-2026-09-05-v1'
	app.db.setFault(null)
	app.advance(61000)
	await app.invoke(undefined, {}, '', { SOURCE: 'timing' })
	assert.equal(app.operation(input.operation_id).status, 'failed')
	assert.equal(app.db.data('crm_fillings').size, 0)
})
