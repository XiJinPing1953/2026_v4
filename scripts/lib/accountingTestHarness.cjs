'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
function makeDb(tables = {}, hooks = {}) {
	const writes = []
	const command = Object.fromEntries(['gt', 'gte', 'lt', 'lte', 'neq', 'in', 'nin', 'exists'].map((op) => [op, (value) => ({ ['$' + op]: value })]))
	command.and = (value) => ({ $and: value }); command.or = (value) => ({ $or: value })
	function matches(doc, where) {
		if (!where) return true
		if (where.$and) return where.$and.every((part) => matches(doc, part))
		if (where.$or) return where.$or.some((part) => matches(doc, part))
		return Object.entries(where).every(([key, cond]) => {
			const value = doc[key]
			if (cond instanceof RegExp) return cond.test(String(value || ''))
			if (!cond || typeof cond !== 'object') return value === cond
			return Object.entries(cond).every(([op, expected]) => {
				if (op === '$gt') return value > expected
				if (op === '$gte') return value >= expected
				if (op === '$lt') return value < expected
				if (op === '$lte') return value <= expected
				if (op === '$neq') return value !== expected
				if (op === '$in') return expected.includes(value)
				if (op === '$nin') return !expected.includes(value)
				if (op === '$exists') return (value !== undefined) === expected
				throw new Error('Unsupported mock operator ' + op)
			})
		})
	}
	function query(name, opts = {}, sourceTables = tables, transactional = false) {
		return {
			where: (where) => query(name, { ...opts, where }, sourceTables, transactional),
			doc: (id) => query(name, { ...opts, where: { _id: id } }, sourceTables, transactional),
			orderBy: (key, dir) => query(name, { ...opts, order: [...(opts.order || []), [key, dir]] }, sourceTables, transactional),
			field: (field) => query(name, { ...opts, field }, sourceTables, transactional), skip: (skip) => query(name, { ...opts, skip }, sourceTables, transactional),
			limit: (limit) => query(name, { ...opts, limit }, sourceTables, transactional),
			count: async () => {
				const total = (sourceTables[name] || []).filter((doc) => matches(doc, opts.where)).length
				return hooks.count ? hooks.count(name, total, opts) : { total }
			},
			get: async () => {
				let rows = (sourceTables[name] || []).filter((doc) => matches(doc, opts.where))
				for (const [key, dir] of [...(opts.order || [])].reverse()) rows.sort((a, b) => a[key] < b[key] ? (dir === 'asc' ? -1 : 1) : a[key] > b[key] ? (dir === 'asc' ? 1 : -1) : 0)
				rows = rows.slice(opts.skip || 0, (opts.skip || 0) + (opts.limit || 100))
				if (opts.field) rows = rows.map((doc) => Object.fromEntries(Object.entries(doc).filter(([key]) => key === '_id' || opts.field[key])))
				if (hooks.get) return hooks.get(name, rows, opts)
				return { data: structuredClone(rows) }
			},
			update: async (data) => {
				if (transactional && hooks.txWrite) hooks.txWrite('update', name, data)
				writes.push({ name, opts, data })
				const rows = (sourceTables[name] || []).filter((doc) => matches(doc, opts.where))
				if (hooks.mutate) for (const row of rows) Object.assign(row, structuredClone(data))
				return { updated: rows.length }
			},
			add: async (data) => {
				if (transactional && hooks.txWrite) hooks.txWrite('add', name, data)
				const id = data._id || `new-${writes.length + 1}`
				writes.push({ name, data })
				if (hooks.mutate) (sourceTables[name] ||= []).push(structuredClone({ ...data, _id: id }))
				return { id }
			},
			remove: async () => {
				const rows = (sourceTables[name] || []).filter((doc) => matches(doc, opts.where))
				writes.push({ name, opts, remove: true })
				if (hooks.mutate) sourceTables[name] = (sourceTables[name] || []).filter((doc) => !matches(doc, opts.where))
				return { deleted: rows.length }
			}
		}
	}
	const database = { command, collection: query, writes, RegExp: ({ regexp, options }) => new RegExp(regexp, options) }
	if (hooks.transaction) database.startTransaction = async () => {
		const transactionTables = structuredClone(tables)
		return {
			collection: (name) => query(name, {}, transactionTables, true),
			commit: async () => {
				for (const key of new Set([...Object.keys(tables), ...Object.keys(transactionTables)])) tables[key] = structuredClone(transactionTables[key] || [])
				return { ok: true }
			},
			rollback: async () => ({ ok: true })
		}
	}
	return database
}

function loadHandler(name, db) {
	const filename = path.resolve(__dirname, '../../uniCloud-alipay/cloudfunctions', name, 'index.js')
	const localRequire = createRequire(filename)
	const context = { exports: {}, require: localRequire, uniCloud: { database: () => db }, console: { log() {}, warn() {}, error() {} }, Date, Math, Set, Map, Buffer, process }
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
	return context.exports.main
}

const saleDoc = (extra = {}) => ({ _id: 'sale-1', customer_id: 'customer-1', customer_name: '测试客户', date: '2026-08-01',
	created_at: 1, updated_at: 1, biz_mode: 'bottle', price_unit: 'm3', unit_price: 10, flow_volume_m3: 100, amount_received: 0, ...extra })
const tablesFor = (sale) => ({ crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }],
	crm_customers: [{ _id: 'customer-1', name: '测试客户', default_price_unit: 'm3', default_unit_price: 10 }], crm_sale_records: [sale] })
const invoke = (main, action, data) => main({ action, token: 'test', data }, {})


module.exports = { makeDb, loadHandler, saleDoc, tablesFor, invoke }
