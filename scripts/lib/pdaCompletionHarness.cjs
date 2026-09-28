'use strict'
// Dedicated storage/transport harness; production PDA and filling handlers are loaded unchanged.
// Store behavior follows fillingConsistency.test.cjs, adding nested selectors and acknowledgement faults.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { operationKey } = require('../../uniCloud-alipay/cloudfunctions/crm-filling/fillingOperations')
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
		return Object.entries(where).every(([key, value]) => matchValue(key.split('.').reduce((value, part) => value?.[part], row), value))
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
					async get() { if (fault) await fault(name, 'get', filter); return { data: selected().map((row) => clone(fields ? Object.fromEntries(Object.entries(row).filter(([key]) => key === '_id' || fields[key])) : row)) } },
					async count() { return { total: selected().length } },
					async add(row) { if (fault) await fault(name, 'add', row); const id = row._id || `r${++seq}`; if (data(name).has(id)) throw new Error('duplicate key'); data(name).set(id, clone({ ...row, _id: id })); return { id } },
					async set(row) { data(name).set(filter._id, clone({ ...row, _id: filter._id })); return { id: filter._id } },
					async update(patch) { if (fault) await fault(name, 'update', patch); const rows = selected(); for (const row of rows) { for (const [key, value] of Object.entries(patch)) row[key] = value && value.__condition === 'inc' ? Number(row[key] || 0) + value.value : clone(value) } if (fault) await fault(name, 'updated', patch); return { updated: rows.length } },
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

function makeApp(options = {}) {
	const db = makeDatabase()
	let time = Date.parse('2026-09-08T01:00:00Z')
	const DateMock = class extends Date { static now() { return time } }
	const permissions = {
		'/pages/pda/filling-create': { view: true, create: true },
		'/pages/pda/filling-complete': { view: true, update: true },
		'/pages/pda/filling-board': { view: true, update: true },
		'/pages/pda/filling-station': { view: true }
	}
	const user = { _id: 'owner', username: 'operator', nickname: '原操作者', role: 'user', page_permissions: permissions, token: 'good' }
	db.data('crm_users').set(user._id, user)
	db.data('crm_users').set('other', { ...structuredClone(user), _id: 'other', token: 'other', nickname: '其他人' })
	db.data('crm_users').set('admin', { _id: 'admin', username: 'admin', role: 'superadmin', token: 'admin' })
	db.data('crm_bottles').set('b1', { _id: 'b1', bottle_no: 'B1', is_active: true, status: 'empty' })
	db.data('crm_pda_filling_tasks').set('task-1', {
		_id: 'task-1', station_code: 'station_1', station_name: '1号机', scale_code: 'filling_scale_main', date: '2026-09-08',
		bottle_id: 'b1', bottle_no: 'B1', target_net_weight: 10, target_gross_weight: 30, weight_start: 20,
		status: 'ready', target_write_status: 'success', target_write_finished_at: time - 30000,
		created_at: time - 40000, updated_at: time - 30000, created_by: user._id, created_by_name: user.username,
		filling_record_id: null, ended_at: null, completed_at: null, remark: '任务原备注'
	})
	const scale = (weight = 30) => db.data('crm_pda_scale_latest').set('scale-1', {
		_id: 'scale-1', scale_code: 'filling_scale_main', weight_kg: weight,
		is_stable: true, is_online: true, gateway_at: time, sampled_at: time, scale_read_mode: 'modbus'
	})
	scale()
	const calls = []
	const handlers = {}
	const cloud = { database: () => db, callFunction: async ({ name, data }) => {
		calls.push(structuredClone({ name, ...data }))
		if (name === 'crm-filling') {
			const intercepted = options.fillingCall ? await options.fillingCall({ db, request: data, real: () => handlers.filling(data, {}) }) : undefined
			return { result: intercepted === undefined ? await handlers.filling(data, {}) : intercepted }
		}
		if (name === 'crm-reg-bridge') return { result: options.regulatory ? await options.regulatory({ db, request: data }) : { code: 0, data: {
			total_event_payload: 1, enqueued_total: 1, duplicate_total: 0, missing_bottle_total: 0,
			snapshot: { found_total: 1, enqueued_total: 1, duplicate_total: 0, missing_total: 0 }
		} } }
		if (name !== 'crm-bottle-anomaly') throw new Error('Unexpected cloud function ' + name)
		return { result: options.scan ? await options.scan({ db, request: data, advance: (n) => { time += n } })
			: { code: 0, data: { done: true, read_complete: true, rule_version: 'bottle-flow-2026-09-05-v1' } } }
	} }
	function load(name, helperName) {
		const filename = path.resolve('uniCloud-alipay/cloudfunctions', name, 'index.js')
		const localRequire = createRequire(filename)
		const helper = { exports: {} }
		vm.runInNewContext(fs.readFileSync(path.join(path.dirname(filename), helperName + '.js'), 'utf8'), { module: helper, exports: helper.exports, require: localRequire, Date: DateMock, Buffer })
		const context = { exports: {}, require: (name) => name === './' + helperName ? helper.exports : localRequire(name), uniCloud: cloud,
			Date: DateMock, console: { log() {}, warn() {}, error() {} }, process, setTimeout, clearTimeout, Buffer }
		vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
		return context.exports.main
	}
	handlers.filling = load('crm-filling', 'fillingOperations')
	handlers.pda = load('crm-pda-filling', 'completionProtocol')
	const invoke = (action = 'completeTaskV1', data = {}, token = 'good') => handlers.pda({ action, token, data: { task_id: 'task-1', completion_protocol: 'pda-completion-2026-09-08-v1', ...data } }, {})
	return { db, calls, invoke, user, scale, advance: (n) => { time += n }, task: () => db.data('crm_pda_filling_tasks').get('task-1'),
		operation: () => db.data('crm_filling_operations').get(operationKey(db.data('crm_pda_filling_tasks').get('task-1')?.completion_intent?.payload?.operation_id)),
		filling: (action, data, token = 'good') => handlers.filling({ action, data, token }, {}) }
}
module.exports = { makeApp }
