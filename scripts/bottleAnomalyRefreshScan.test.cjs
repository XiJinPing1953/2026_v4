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
vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__test = { scanV2, buildContinuousFill, buildAnomalyFingerprint };', sandbox, { filename: file })
const { scanV2, buildContinuousFill, buildAnomalyFingerprint } = sandbox.module.exports.__test
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
function filling(id, bottle, date, start, end) {
	collections.crm_fillings.push({ _id: id, bottle_no: bottle, date, record_type: 'normal_fill',
		weight_start: start, weight_end: end, fill_weight: end - start })
	const row = event(id, bottle, 'fill', date, end - start)
	row.source_id = id
	return row
}
function saleOut(id, bottle, date, gross, tare) {
	collections.crm_sale_records.push({ _id: id, date, out_items: [
		{ bottle_no: bottle, gross, tare, net: gross - tare }
	] })
	const row = event(id, bottle, 'out', date, gross - tare)
	row.source_id = id
	return row
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

	// 315 is a confirmed staged fill: every scale reading connects, and the final sale
	// uses the second fill's final gross. It must be closed even across scan rounds.
	const back315 = event('back-315', '315', 'back', '2026-09-01', 1)
	const first315 = filling('fill-315-a', '315', '2026-09-04', 360, 393)
	collections.crm_bottle_movements.push(back315, first315)
	for (let i = 0; i < 55; i++) collections.crm_bottle_movements.push(
		event(`315-adjust-${String(i).padStart(3, '0')}`, '315', 'adjust', '2026-09-04', null))
	const second315 = filling('fill-315-b', '315', '2026-09-05', 393, 513)
	collections.crm_bottle_movements.push(second315)
	collections.crm_bottle_movements.push(saleOut('out-315', '315', '2026-09-05', 513, 360))
	const prior315 = buildContinuousFill(second315, first315, back315)
	collections.crm_bottle_anomalies.push({ _id: 'old-315', bottle_no: '315',
		anomaly_type: 'continuous_fill', status: 'open', date: prior315.date,
		fingerprint: buildAnomalyFingerprint(prior315), note: prior315.detail,
		context: prior315.context, created_at: 5 })
	await complete('315')
	assert.equal(collections.crm_bottle_anomalies.some((row) => row.bottle_no === '315' &&
		row.anomaly_type === 'continuous_fill' && row.status === 'open'), false)
	assert.equal(collections.crm_bottle_anomalies.find((row) => row._id === 'old-315')?.resolved_by_name,
		'system-staged-fill')
	assert.equal(collections.crm_bottle_anomalies.filter((row) => row.bottle_no === '315' &&
		row.anomaly_type === 'continuous_fill').length, 1)
	await complete('315')
	assert.equal(collections.crm_bottle_anomalies.some((row) => row.bottle_no === '315' && row.status === 'open'), false)
	assert.equal(collections.crm_bottle_anomalies.filter((row) => row.bottle_no === '315' &&
		row.anomaly_type === 'continuous_fill').length, 1)
	const sale315 = collections.crm_sale_records.find((row) => row._id === 'out-315')
	sale315.out_items[0].gross = 512
	await complete('315')
	assert.equal(collections.crm_bottle_anomalies.find((row) => row._id === 'old-315')?.status, 'open')
	assert.equal(collections.crm_bottle_anomalies.filter((row) => row.bottle_no === '315' &&
		row.anomaly_type === 'continuous_fill').length, 1)
	sale315.out_items[0].gross = 513
	await complete('315')
	assert.equal(collections.crm_bottle_anomalies.find((row) => row._id === 'old-315')?.status, 'resolved')

	// 291 also has adjoining fills, but its sale gross matches the first fill, not the second.
	collections.crm_bottle_movements.push(event('back-291', '291', 'back', '2026-09-01', -11))
	collections.crm_bottle_movements.push(filling('fill-291-a', '291', '2026-09-04', 348, 478))
	collections.crm_bottle_movements.push(filling('fill-291-b', '291', '2026-09-05', 478, 489))
	collections.crm_bottle_movements.push(saleOut('out-291', '291', '2026-09-05', 478, 360))
	await complete('291')
	assert.equal(collections.crm_bottle_anomalies.some((row) => row.bottle_no === '291' &&
		row.anomaly_type === 'continuous_fill' && row.status === 'open'), true)

	// Bottle 2's second starting scale is not the first filling's final scale.
	collections.crm_bottle_movements.push(event('back-2', '2', 'back', '2026-06-17', 0))
	collections.crm_bottle_movements.push(filling('fill-2-a', '2', '2026-06-19', 123, 134.5))
	collections.crm_bottle_movements.push(filling('fill-2-b', '2', '2026-09-01', 120, 185))
	collections.crm_bottle_movements.push(saleOut('out-2', '2', '2026-09-03', 183, 124))
	await complete('2')
	assert.equal(collections.crm_bottle_anomalies.some((row) => row.bottle_no === '2' &&
		row.anomaly_type === 'continuous_fill' && row.status === 'open'), true)

	collections.crm_bottle_movements.push(event('back-2461', '2461', 'back', '2026-09-17', 3))
	collections.crm_bottle_movements.push(event('out-2461', '2461', 'out', '2026-09-18', 68))
	await complete('2461')
	assert.equal(collections.crm_bottle_anomalies.some((row) => row.bottle_no === '2461' &&
		row.anomaly_type === 'missing_fill' && row.status === 'open'), true)

	console.log('跨轮续扫、分次补灌关闭与重扫复用、证据变化重开、291/2/246异常保留测试通过')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
