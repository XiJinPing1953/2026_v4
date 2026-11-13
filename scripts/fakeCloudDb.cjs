'use strict'

// Minimal in-memory stand-in for the uniCloud database API used by the start-loss
// tests: where/field/orderBy/skip/limit/get/count/update/remove/add, doc(),
// commands (in/gt/gte/lt/lte/eq/neq/exists/and/or/set) with MongoDB-style type
// bracketing, and buffered transactions with commit/rollback. `failures` lets a
// test make the next matching operation throw.

class Cmd { constructor(op, val) { this.op = op; this.val = val } }
const command = {
	in: (v) => new Cmd('in', v), nin: (v) => new Cmd('nin', v), gt: (v) => new Cmd('gt', v), gte: (v) => new Cmd('gte', v),
	lt: (v) => new Cmd('lt', v), lte: (v) => new Cmd('lte', v), eq: (v) => new Cmd('eq', v), neq: (v) => new Cmd('neq', v),
	exists: (v) => new Cmd('exists', v), and: (v) => new Cmd('and', v), or: (v) => new Cmd('or', v), set: (v) => new Cmd('set', v),
	inc: (v) => new Cmd('inc', v)
}

function valuesAt(doc, key) {
	let current = [doc]
	const parts = key.split('.')
	parts.forEach((part, index) => {
		current = current.flatMap((item) => {
			const next = item == null ? undefined : item[part]
			return Array.isArray(next) && index < parts.length - 1 ? next : [next]
		})
	})
	return current.flatMap((v) => (Array.isArray(v) ? [v, ...v] : [v]))
}
const sameType = (a, b) => typeof a === typeof b && a !== null && b !== null
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
function matchField(list, cond) {
	if (cond instanceof Cmd) {
		switch (cond.op) {
			case 'and': return cond.val.every((c) => matchField(list, c))
			case 'or': return cond.val.some((c) => matchField(list, c))
			case 'exists': return list.some((v) => v !== undefined) === Boolean(cond.val)
			case 'eq': return cond.val === null ? list.every((v) => v == null) : list.some((v) => v === cond.val)
			case 'neq': return list.every((v) => JSON.stringify(v) !== JSON.stringify(cond.val))
			case 'in': return list.some((v) => cond.val.includes(v))
			case 'regex': return list.some((v) => typeof v === 'string' && new RegExp(cond.val.regexp, cond.val.options || '').test(v))
			case 'nin': return list.every((v) => !cond.val.includes(v))
			default: return list.some((v) => sameType(v, cond.val) && ({ gt: 1, gte: 1, lt: -1, lte: -1 }[cond.op] === cmp(v, cond.val) ||
				((cond.op === 'gte' || cond.op === 'lte') && cmp(v, cond.val) === 0)))
		}
	}
	if (cond === null) return list.every((v) => v == null)
	return list.some((v) => v === cond)
}
function matches(doc, where) {
	if (where instanceof Cmd) {
		if (where.op === 'and') return where.val.every((w) => matches(doc, w))
		if (where.op === 'or') return where.val.some((w) => matches(doc, w))
		throw new Error(`unsupported top-level command ${where.op}`)
	}
	return Object.entries(where || {}).every(([key, cond]) => matchField(valuesAt(doc, key), cond))
}
function applyPatch(doc, patch) {
	for (const [key, value] of Object.entries(patch)) {
		if (value instanceof Cmd && value.op === 'set') doc[key] = structuredClone(value.val)
		else if (value instanceof Cmd && value.op === 'inc') doc[key] = (Number(doc[key]) || 0) + value.val
		else doc[key] = structuredClone(value)
	}
}

function createFakeDb({ onRead } = {}) {
	const tables = new Map()
	const stats = { reads: 0, readsByTable: {}, writes: 0, commits: 0, rollbacks: 0 }
	const failures = [] // { op, table, when?(doc|patch) , message }
	let seq = 0
	const table = (name) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name) }
	const maybeFail = (op, name, payload) => {
		const index = failures.findIndex((f) => f.op === op && (!f.table || f.table === name) && (!f.when || f.when(payload)))
		if (index >= 0) { const [f] = failures.splice(index, 1); throw new Error(f.message || `injected ${op} failure`) }
	}
	const sortRows = (rows, order) => rows.sort((a, b) => {
		for (const [k, dir] of order) { const c = cmp(a[k] ?? '', b[k] ?? ''); if (c) return dir === 'desc' ? -c : c }
		return 0
	})

	class Query {
		constructor(name, store, where = {}, opts = {}) { this.name = name; this.store = store; this.w = where; this.o = { order: [], skip: 0, limit: 100, ...opts } }
		where(w) { return new Query(this.name, this.store, w, this.o) }
		field() { return this }
		orderBy(k, dir) { return new Query(this.name, this.store, this.w, { ...this.o, order: [...this.o.order, [k, dir]] }) }
		skip(n) { return new Query(this.name, this.store, this.w, { ...this.o, skip: n }) }
		limit(n) { return new Query(this.name, this.store, this.w, { ...this.o, limit: n }) }
		rows() { return sortRows(this.store.list(this.name).filter((d) => matches(d, this.w)), this.o.order) }
		async get() {
			maybeFail('get', this.name, this.w)
			const data = this.rows().slice(this.o.skip, this.o.skip + this.o.limit).map((d) => structuredClone(d))
			stats.reads += data.length
			stats.readsByTable[this.name] = (stats.readsByTable[this.name] || 0) + data.length
			if (onRead) await onRead(this.name, data.length)
			return { data }
		}
		async count() { return { total: this.rows().length } }
		async update(patch) {
			maybeFail('update', this.name, patch)
			const rows = this.rows()
			rows.forEach((d) => this.store.update(this.name, d._id, patch))
			return { updated: rows.length }
		}
		async remove() {
			maybeFail('remove', this.name, this.w)
			const rows = this.rows()
			rows.forEach((d) => this.store.remove(this.name, d._id))
			return { deleted: rows.length }
		}
		async add(input) {
			const docs = Array.isArray(input) ? input : [input]
			const ids = []
			for (const doc of docs) {
				maybeFail('add', this.name, doc)
				const id = doc._id || `auto${String(++seq).padStart(8, '0')}`
				if (this.store.list(this.name).some((d) => d._id === id)) throw new Error(`E11000 duplicate key ${this.name} ${id}`)
				this.store.insert(this.name, { ...structuredClone(doc), _id: id })
				ids.push(id)
			}
			return Array.isArray(input) ? { ids, inserted: ids.length } : { id: ids[0] }
		}
		doc(id) {
			const self = this
			return {
				async get() { return { data: self.store.list(self.name).filter((d) => d._id === id).map((d) => structuredClone(d)) } },
				async update(patch) {
					maybeFail('update', self.name, patch)
					const hit = self.store.list(self.name).some((d) => d._id === id)
					if (hit) self.store.update(self.name, id, patch)
					return { updated: hit ? 1 : 0 }
				},
				async remove() {
					maybeFail('remove', self.name, { _id: id })
					const hit = self.store.list(self.name).some((d) => d._id === id)
					if (hit) self.store.remove(self.name, id)
					return { deleted: hit ? 1 : 0 }
				}
			}
		}
	}

	const committed = {
		list: (name) => table(name),
		insert: (name, doc) => { table(name).push(doc); stats.writes += 1 },
		update: (name, id, patch) => { applyPatch(table(name).find((d) => d._id === id), patch); stats.writes += 1 },
		remove: (name, id) => { tables.set(name, table(name).filter((d) => d._id !== id)); stats.writes += 1 }
	}

	// Buffered operations; reads see committed data plus this transaction's own ops.
	// Commit re-validates every op against the then-committed state, so a document
	// removed/inserted by another commit in between aborts this one (write conflict).
	function startTransaction() {
		const ops = []
		let done = false
		const viewOf = (name) => {
			const rows = structuredClone(table(name))
			for (const op of ops.filter((o) => o.name === name)) {
				if (op.kind === 'insert') rows.push(structuredClone(op.doc))
				if (op.kind === 'update') applyPatch(rows.find((d) => d._id === op.id), op.patch)
				if (op.kind === 'remove') rows.splice(rows.findIndex((d) => d._id === op.id), 1)
			}
			return rows
		}
		const store = {
			list: (name) => viewOf(name),
			insert: (name, doc) => ops.push({ kind: 'insert', name, doc }),
			update: (name, id, patch) => ops.push({ kind: 'update', name, id, patch }),
			remove: (name, id) => ops.push({ kind: 'remove', name, id })
		}
		return {
			collection: (name) => new Query(name, store),
			async commit() {
				if (done) throw new Error('transaction finished')
				done = true
				maybeFail('commit', '', null)
				const staged = new Map()
				const rowsOf = (name) => { if (!staged.has(name)) staged.set(name, structuredClone(table(name))); return staged.get(name) }
				for (const op of ops) {
					const rows = rowsOf(op.name)
					const index = rows.findIndex((d) => d._id === (op.kind === 'insert' ? op.doc._id : op.id))
					if (op.kind === 'insert') {
						if (index >= 0) { stats.rollbacks += 1; throw new Error(`WriteConflict duplicate key ${op.name} ${op.doc._id}`) }
						rows.push(structuredClone(op.doc))
					} else {
						if (index < 0) { stats.rollbacks += 1; throw new Error(`WriteConflict missing ${op.name} ${op.id}`) }
						if (op.kind === 'update') applyPatch(rows[index], op.patch)
						else rows.splice(index, 1)
					}
				}
				for (const [name, rows] of staged) tables.set(name, rows)
				stats.writes += ops.length
				stats.commits += 1
			},
			async rollback() { done = true; stats.rollbacks += 1 }
		}
	}

	const db = { command, collection: (name) => new Query(name, committed), RegExp: (o) => new Cmd('regex', o), startTransaction: async () => startTransaction() }
	return { db, command, table, stats, failures }
}

module.exports = { createFakeDb, command }
