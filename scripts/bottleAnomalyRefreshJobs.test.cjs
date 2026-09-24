#!/usr/bin/env node
'use strict'
const assert = require('assert/strict')
const { createRefreshJobs } = require('../uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/refreshJobs')

const docs = new Map()
const ops = {
	in: (values) => ({ op: 'in', values }),
	lte: (value) => ({ op: 'lte', value }),
	gt: (value) => ({ op: 'gt', value })
}
function matches(row, where) {
	return Object.entries(where).every(([key, expected]) => {
		const actual = row[key]
		if (expected?.op === 'in') return expected.values.includes(actual)
		if (expected?.op === 'lte') return actual <= expected.value
		if (expected?.op === 'gt') return actual > expected.value
		return actual === expected
	})
}
function query(where) {
	let sortField = ''
	let maximum = Infinity
	return {
		orderBy(field) { sortField = field; return this },
		limit(value) { maximum = value; return this },
		async get() {
			const rows = [...docs.values()].filter((row) => matches(row, where))
			if (sortField) rows.sort((a, b) => a[sortField] - b[sortField])
			return { data: rows.slice(0, maximum).map((row) => structuredClone(row)) }
		},
		async update(patch) {
			let updated = 0
			for (const [id, row] of docs) if (matches(row, where)) {
				docs.set(id, { ...row, ...structuredClone(patch) }); updated++
			}
			return { updated }
		}
	}
}
const db = { command: ops, collection() { return {
	doc(id) { return { get: async () => ({ data: docs.has(id) ? [structuredClone(docs.get(id))] : [] }) } },
	where: query,
	async add(row) { if (docs.has(row._id)) throw Error('duplicate'); docs.set(row._id, structuredClone(row)) }
} } }

async function main() {
	let clock = 100000
	const calls = new Map()
	let locked = false
	const jobs = createRefreshJobs({ db, now: () => clock,
		scanBottle: async (_, no, cursor) => {
			clock += 200
			calls.set(no, (calls.get(no) || 0) + 1)
			if (locked) { locked = false; return { code: 0, data: { waiting_for_lock: true, done: false } } }
			return { code: 0, data: { done: Boolean(cursor), read_complete: Boolean(cursor),
				cursor: cursor ? null : { position: 1 }, round_scanned_events: 1, round_resolved_stale: no === '240' && cursor ? 1 : 0 } }
		}, scanTruck: async () => ({ code: 0, data: { done: true, round_scanned_events: 1 } }) })
	const user = { _id: 'admin-id', username: 'admin', role: 'admin' }
	const nos = Array.from({ length: 34 }, (_, i) => i === 0 ? '240' : String(300 + i))
	let result = await jobs.submit(user, 'same-request', nos, [])
	assert.equal(result.code, 0)
	assert.equal(result.data.done, false)
	assert.equal(result.data.pending_total > 0, true)
	assert.equal(result.data.scanned_bottles > 0, true)
	const duplicate = await jobs.submit(user, 'same-request', nos, [])
	assert.equal(duplicate.data.job_id, result.data.job_id)
	assert.equal(docs.size, 1)
	locked = true
	await jobs.drain()
	assert.equal((await jobs.status(user, result.data.job_id)).data.done, false)
	for (let i = 0; i < 10; i++) {
		await jobs.drain()
		if ((await jobs.status(user, result.data.job_id)).data.done) break
	}
	result = await jobs.status(user, result.data.job_id)
	assert.equal(result.data.done, true)
	assert.equal(result.data.scanned_bottles, 34)
	assert.equal(result.data.pending_total, 0)
	assert.equal(result.data.round_resolved_stale, 1)
	assert.ok(nos.every((no) => calls.get(no) >= 2))
	assert.equal((await jobs.status({ _id: 'other', role: 'user' }, result.data.job_id)).code, 403)

	let attempts = 0
	let recovered = false
	const failing = createRefreshJobs({ db, now: () => clock,
		scanBottle: async () => { attempts++; if (!recovered) throw Error('temporary failure')
			return { code: 0, data: { done: true, read_complete: true } } }, scanTruck: async () => {} })
	const failed = await failing.submit(user, 'failure-request', ['999'], [])
	assert.equal(failed.data.status, 'pending')
	for (let i = 1; i < 5; i++) {
		clock += [60000, 120000, 240000, 480000][i - 1]
		await failing.drain()
	}
	assert.equal((await failing.status(user, failed.data.job_id)).data.status, 'failed')
	assert.equal(attempts, 5)
	assert.equal((await failing.retry({ _id: 'operator', role: 'user' }, failed.data.job_id)).code, 403)
	recovered = true
	assert.equal((await failing.retry(user, failed.data.job_id)).data.done, true)
	console.log('瓶异常任务续扫、锁等待、幂等、权限和退避测试通过')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
