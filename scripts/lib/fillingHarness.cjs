'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const { operationKey } = require('../../uniCloud-alipay/cloudfunctions/crm-filling/fillingOperations')

function makeDatabase({ nextId } = {}) {
	const tables = new Map()
	let seq = 0
	const allocateId = nextId || (() => `r${++seq}`)
	let fault = null
	const data = (name) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) }
	const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
	const cond = (kind, value) => ({ __condition: kind, value })
	const command = Object.fromEntries(['in', 'nin', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists', 'inc', 'set'].map((name) => [name, (value) => cond(name, value)]))
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
		const pathValues = (value, parts) => !parts.length ? [value] : Array.isArray(value)
			? value.flatMap(item => pathValues(item, parts)) : pathValues(value?.[parts[0]], parts.slice(1))
		return Object.entries(where).every(([key, value]) => key.includes('.')
			? pathValues(row, key.split('.')).some(actual => matchValue(actual, value)) : matchValue(row[key], value))
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
					async add(row) { if (fault) await fault(name, 'add', row); const id = row._id || allocateId(); if (data(name).has(id)) throw new Error('duplicate key'); data(name).set(id, clone({ ...row, _id: id })); return { id } },
					async set(row) { data(name).set(filter._id, clone({ ...row, _id: filter._id })); return { id: filter._id } },
					async update(patch) { if (patch.scan_cursor && !patch.scan_cursor.__condition && selected().some(row => row.scan_cursor === null)) throw Error('Cannot create field in scan_cursor: null'); if (fault) await fault(name, 'update', patch); const rows = selected(); for (const row of rows) { for (const [key, value] of Object.entries(patch)) row[key] = value && value.__condition === 'inc' ? Number(row[key] || 0) + value.value : value && value.__condition === 'set' ? clone(value.value) : clone(value) } return { updated: rows.length } },
					async remove() { const rows = selected(); rows.forEach((row) => data(name).delete(row._id)); return { deleted: rows.length } }
				}
			}
			return build()
		},
		async startTransaction() {
			// Isolated writes prevent rollback from erasing concurrent operation checkpoints.
			const previous = db._tx || Promise.resolve()
			let unlock
			db._tx = new Promise((resolve) => { unlock = resolve })
			await previous
			const snapshot = new Map(clone([...tables].map(([name, rows]) => [name, [...rows]])).map(([name, rows]) => [name, new Map(rows)]))
			const isolated = makeDatabase({ nextId: allocateId })
			for (const [name, rows] of snapshot) for (const [id, row] of rows) isolated.data(name).set(id, clone(row))
			isolated.setFault((...args) => fault && fault(...args))
			let ended = false
			return { collection(name) {
				const collection = isolated.collection(name)
				return { ...collection, doc(id) {
					const document = collection.doc(id)
					return { ...document, async get() {
						const result = await document.get()
						return { data: result.data[0] || null }
					} }
				} }
			},
				async commit() {
					const changes = []
					for (const name of new Set([...snapshot.keys(), ...isolated.tables.keys()])) {
						const before = snapshot.get(name) || new Map(), after = isolated.data(name)
						for (const id of new Set([...before.keys(), ...after.keys()])) {
							if (JSON.stringify(before.get(id)) === JSON.stringify(after.get(id))) continue
							if (JSON.stringify(data(name).get(id)) !== JSON.stringify(before.get(id))) throw new Error('transaction write conflict')
							changes.push({ name, id, row: after.get(id) })
						}
					}
					for (const { name, id, row } of changes) { if (row === undefined) data(name).delete(id); else data(name).set(id, clone(row)) }
					ended = true; unlock()
				},
				async rollback() { if (ended) return; ended = true; unlock() }
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
		if (data.action === 'touchV2') return { result: { code: 0, data: { done: true } } }
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
	const servicePath = path.resolve('uniCloud-alipay/cloudfunctions/crm-filling/reweighService.js')
	const serviceModule = { exports: {} }
	if (fs.existsSync(servicePath)) vm.runInNewContext(fs.readFileSync(servicePath, 'utf8'), { module: serviceModule, exports: serviceModule.exports, require: localRequire, Date: DateMock, Buffer })
	const requireFn = (name) => name === './fillingOperations' ? helperModule.exports : name === './reweighService' ? serviceModule.exports : localRequire(name)
	vm.runInNewContext(fs.readFileSync(fnPath, 'utf8'), { exports, require: requireFn, uniCloud: cloud, console, Date: DateMock, process, setTimeout, clearTimeout, Buffer })
	const invoke = (action, data = {}, token = 'good', context = { SOURCE: 'client' }) => exports.main({ action, data, token }, context)
	return { db, invoke, user, scanned, now: () => time, advance: (n) => { time += n }, operation: (id) => db.data('crm_filling_operations').get(operationKey(id)) }
}

module.exports = { makeDatabase, makeApp }
