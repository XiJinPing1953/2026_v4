#!/usr/bin/env node
'use strict'
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')

const file = path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js')
const collections = Object.fromEntries(['crm_users', 'crm_operation_logs', 'crm_bottle_anomalies',
	'crm_bottle_movements', 'crm_fillings', 'crm_bottles', 'crm_sale_records', 'crm_bottle_scan_locks']
	.map((name) => [name, []]))
let beforeMovementGet = null
const command = {
	gt: (value) => ({ op: 'gt', value }), lte: (value) => ({ op: 'lte', value }),
	and: (...items) => ({ op: 'and', items }), or: (items) => ({ op: 'or', items })
}
function matches(row, query) {
	if (query?.op === 'and') return query.items.every((item) => matches(row, item))
	if (query?.op === 'or') return query.items.some((item) => matches(row, item))
	return Object.entries(query || {}).every(([key, expected]) => {
		if (expected?.op === 'gt') return row[key] > expected.value
		if (expected?.op === 'lte') return row[key] <= expected.value
		return row[key] === expected
	})
}
function collection(name) {
	const rows = collections[name] ||= []
	return {
		where(where) {
			const sorts = []
			let maximum = Infinity
			return {
				orderBy(key, direction) { sorts.push([key, direction]); return this },
				limit(value) { maximum = value; return this },
				async get() {
					if (name === 'crm_bottle_movements' && beforeMovementGet) beforeMovementGet(where, sorts)
					const selected = rows.filter((row) => matches(row, where)).sort((a, b) => {
						for (const [key, direction] of sorts) {
							if (a[key] === b[key]) continue
							return (a[key] > b[key] ? 1 : -1) * (direction === 'desc' ? -1 : 1)
						}
						return 0
					})
					return { data: structuredClone(selected.slice(0, maximum)) }
				},
				async update(patch) {
					let updated = 0
					for (const row of rows) if (matches(row, where)) { Object.assign(row, patch); updated++ }
					return { updated }
				}
			}
		},
		doc(id) { return {
			async get() { return { data: structuredClone(rows.filter((row) => row._id === id)) } },
			async update(patch) { const row = rows.find((item) => item._id === id); Object.assign(row, patch); return { updated: 1 } }
		} },
		async add(input) {
			const row = structuredClone(input)
			row._id ||= `${name}-${rows.length + 1}`
			if (rows.some((existing) => existing._id === row._id)) throw Error('duplicate')
			rows.push(row)
			return { id: row._id }
		}
	}
}
const sandbox = { uniCloud: { database: () => ({ command, collection }) }, require: createRequire(file),
	module: { exports: {} }, exports: {}, console, Buffer, Date, setTimeout, clearTimeout }
vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__test = { scanV2 };', sandbox, { filename: file })
const { scanV2 } = sandbox.module.exports.__test
const actor = { _id: 'test-user', username: 'tester', role: 'admin' }
const day = (date) => Date.parse(`${date}T00:00:00+08:00`)
function event(id, bottle, type, date, weight, created = 100) {
	return { _id: id, bottle_no: bottle, type, date, event_day: date, event_at: day(date),
		type_order: { back: 10, fill: 20, out: 30, adjust: 40 }[type], created_at: created,
		net_weight: weight, source_type: type === 'fill' ? 'filling' : 'sale', source_id: id,
		customer_name: '浩诺' }
}
async function complete(no, cursor = null) {
	let scanned = 0
	for (let i = 0; i < 8; i++) {
		const result = await scanV2(actor, { bottle_no: no, cursor, reconcile_anomalies: true,
			max_events_per_round: 50, batch_size: 20, max_ms_per_round: 8000 }, `test-${no}`)
		assert.equal(result.code, 0)
		scanned += result.data.round_scanned_events
		if (result.data.done) return { result, scanned }
		assert.ok(result.data.cursor)
		cursor = result.data.cursor
	}
	throw Error('scan did not complete')
}
async function main() {
	collections.crm_bottle_movements.push(event('back-240', '240', 'back', '2026-09-23', -4))
	for (let i = 0; i < 55; i++) collections.crm_bottle_movements.push(event(`adjust-${String(i).padStart(3, '0')}`, '240', 'adjust', '2026-09-23', null, 100))
	collections.crm_bottle_movements.push(event('fill-240', '240', 'fill', '2026-09-23', 186))
	collections.crm_bottle_movements.push(event('out-240', '240', 'out', '2026-09-24', 182))
	collections.crm_bottle_anomalies.push({ _id: 'old-240', bottle_no: '240', anomaly_type: 'missing_fill',
		status: 'open', fingerprint: 'historical-alert', date: '2026-09-24', note: '缺灌装', context: {}, created_at: 1 })
	const first = await scanV2(actor, { bottle_no: '240', reconcile_anomalies: true,
		max_events_per_round: 50, batch_size: 20, max_ms_per_round: 8000 }, 'test-240')
	assert.equal(first.data.done, false)
	assert.equal(first.data.round_scanned_events, 50)
	assert.equal(collections.crm_bottle_anomalies[0].status, 'open')
	const finished = await complete('240', first.data.cursor)
	assert.equal(finished.scanned + 50, 58)
	assert.equal(collections.crm_bottle_anomalies[0].status, 'resolved')
	assert.equal(collections.crm_bottle_anomalies[0].resolved_by_name, 'system-reconcile')

	collections.crm_bottle_movements.push(event('back-243', '243', 'back', '2026-09-23', -5))
	collections.crm_bottle_movements.push(event('out-243', '243', 'out', '2026-09-24', 179))
	await complete('243')
	assert.equal(collections.crm_bottle_anomalies.some((row) => row.bottle_no === '243' && row.status === 'open' && row.anomaly_type === 'missing_fill'), true)

	collections.crm_bottle_movements.push(event('back-245', '245', 'back', '2026-09-23', -4))
	for (let i = 0; i < 55; i++) collections.crm_bottle_movements.push(event(`245-adjust-${String(i).padStart(3, '0')}`, '245', 'adjust', '2026-09-23', null, 100))
	collections.crm_bottle_movements.push(event('out-245', '245', 'out', '2026-09-24', 182))
	collections.crm_bottle_anomalies.push({ _id: 'old-245', bottle_no: '245', anomaly_type: 'missing_fill',
		status: 'open', fingerprint: 'old-245-fingerprint', date: '2026-09-24', note: '缺灌装', context: {}, created_at: 2 })
	const paused = await scanV2(actor, { bottle_no: '245', reconcile_anomalies: true,
		max_events_per_round: 50, batch_size: 20, max_ms_per_round: 8000 }, 'test-245')
	assert.equal(paused.data.done, false)
	collections.crm_bottle_movements.push(event('fill-245', '245', 'fill', '2026-09-23', 186))
	await complete('245', paused.data.cursor)
	assert.equal(collections.crm_bottle_anomalies.find((row) => row._id === 'old-245').status, 'resolved')

	collections.crm_bottle_scan_locks.push({ _id: `scan_${require('crypto').createHash('sha256').update('246').digest('hex').slice(0, 40)}`,
		lease_id: 'another-worker', lease_until: Date.now() + 60000 })
	const locked = await scanV2(actor, { bottle_no: '246', reconcile_anomalies: true }, 'test-246')
	assert.equal(locked.data.waiting_for_lock, true)
	assert.equal(locked.data.done, false)

	collections.crm_bottle_movements.push(event('back-247', '247', 'back', '2026-09-23', -4))
	collections.crm_bottle_movements.push(event('out-247', '247', 'out', '2026-09-24', 182))
	collections.crm_bottle_anomalies.push({ _id: 'old-247', bottle_no: '247', anomaly_type: 'missing_fill',
		status: 'open', fingerprint: 'old-247-fingerprint', date: '2026-09-24', note: '缺灌装', context: {}, created_at: 3 })
	let witnessReads = 0
	beforeMovementGet = (_, sorts) => {
		if (sorts[0]?.[0] !== '_id') return
		witnessReads++
		if (witnessReads === 2) collections.crm_bottle_movements.push(event('fill-247', '247', 'fill', '2026-09-23', 186))
	}
	const changed = await scanV2(actor, { bottle_no: '247', reconcile_anomalies: true }, 'test-247')
	beforeMovementGet = null
	assert.equal(changed.data.done, false)
	assert.equal(changed.data.history_changed, true)
	assert.equal(collections.crm_bottle_anomalies.find((row) => row._id === 'old-247').status, 'open')
	await complete('247', changed.data.cursor)
	assert.equal(collections.crm_bottle_anomalies.find((row) => row._id === 'old-247').status, 'resolved')
	console.log('240号瓶跨轮分页与旧异常关闭、真实缺灌装保留测试通过')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
