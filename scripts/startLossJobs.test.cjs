'use strict'

// Job protocol of crm-filling startLossJobs: bounded calls, stable cursor,
// checkpoints, leases, per-row retry/blocking and explicit completion.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb } = require('./fakeCloudDb.cjs')
const { loadCrmFilling } = require('./loadCrmFillingInternals.cjs')
const { createStartLossJobs, LEASE_MS, ROW_MAX_ATTEMPTS } = require('../uniCloud-alipay/cloudfunctions/crm-filling/startLossJobs')

const helpers = loadCrmFilling(createFakeDb().db) // real date parser and candidate rule
const user = { _id: 'u1', username: 'tester' }
const KEY = 'wsl_test_job_key_0001'

function setup({ rows = [], process, stepMs = 0, recordLog } = {}) {
	const fake = createFakeDb()
	const clock = { t: 1_000_000 }
	const seen = []
	fake.table('crm_fillings').push(...rows)
	const jobs = createStartLossJobs({
		db: fake.db,
		fillings: fake.db.collection('crm_fillings'),
		isCandidate: helpers.isStartLossSyncCandidate,
		normalizeBottleNo: helpers.normalizeBottleNo,
		normalizeFillingDate: helpers.normalizeFillingDate,
		now: () => clock.t,
		recordLog: recordLog || (async () => {}),
		processRow: async (row, u, ctx) => {
			seen.push(row._id)
			clock.t += stepMs
			if (process) return process(row, ctx)
			return { status: 'matched', write: 'unchanged' }
		}
	})
	const call = (data = {}) => jobs.run(user, { job_key: KEY, bottle_nos: ['25'], max_ms: 500, ...data }, 'req-1')
	return { fake, clock, seen, jobs, call, job: () => fake.table('crm_filling_start_loss_jobs').find((j) => j._id === KEY) }
}

const fills = (n, { bottle = '25', date = (i) => `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, prefix = 'f' } = {}) =>
	Array.from({ length: n }, (_, i) => ({ _id: `${prefix}${String(i).padStart(5, '0')}`, bottle_no: bottle, date: date(i),
		record_type: 'normal_fill', weight_start: 120, weight_end: 170, fill_weight: 50, created_at: i }))

async function drive(h, data, max = 200) {
	const completions = []
	for (let i = 0; i < max; i += 1) {
		const res = await h.call(data)
		assert.equal(res.code, 0, JSON.stringify(res))
		completions.push(res.data.completion)
		if (!['partial', 'error', 'busy'].includes(res.data.completion)) return { res, completions }
	}
	throw new Error('job did not finish')
}

test('跨批次续办：每次调用受时限约束，游标续接，每条灌装只处理一次', async () => {
	const h = setup({ rows: fills(250), stepMs: 40 })
	const { res, completions } = await drive(h)
	assert.equal(res.data.completion, 'complete')
	assert.ok(completions.length > 10, `expected many bounded calls, got ${completions.length}`)
	assert.ok(completions.slice(0, -1).every((c) => c === 'partial'))
	assert.equal(h.seen.length, 250)
	assert.equal(new Set(h.seen).size, 250)
	assert.equal(res.data.counts.scanned, 250)
	assert.equal(h.job().lease_id, '')
})

test('达到、恰好等于与超过分页大小时都不会提前结束或漏处理', async () => {
	for (const n of [0, 1, 99, 100, 101, 200, 201]) {
		const h = setup({ rows: fills(n) })
		const { res } = await drive(h, { max_ms: 6000 })
		assert.equal(res.data.completion, 'complete', `n=${n}`)
		assert.equal(new Set(h.seen).size, n, `n=${n}`)
		assert.equal(h.seen.length, n, `n=${n}`)
	}
})

test('调用方超时后重试：已完成任务直接返回保存结果，不再重算', async () => {
	const h = setup({ rows: fills(30) })
	const first = await h.call({ max_ms: 6000 })
	assert.equal(first.data.completion, 'complete')
	// The caller never saw `first` (request timeout) and retries the same job.
	const again = await h.call({ max_ms: 6000 })
	assert.equal(again.data.completion, 'complete')
	assert.equal(again.data.stored, true)
	assert.equal(h.seen.length, 30)
})

test('并发调用：持锁期间返回 busy；锁过期后接管并从检查点续办；旧持有者的检查点被拒绝', async () => {
	const rows = fills(40)
	let release
	let paused = false
	const h = setup({
		rows,
		process: async (row) => {
			if (row._id === 'f00015' && !paused) { paused = true; await new Promise((r) => { release = r }) }
			return { status: 'matched', write: 'unchanged' }
		}
	})
	const slow = h.call({ max_ms: 6000 })
	while (!paused) await new Promise((r) => setImmediate(r))
	const busy = await h.call({ max_ms: 6000 })
	assert.equal(busy.data.completion, 'busy')
	assert.equal(busy.data.processed_this_call, 0)
	assert.equal(h.job().cursor, 'f00009', 'checkpoint every 10 rows')
	h.clock.t += LEASE_MS + 1
	const takeover = await h.call({ max_ms: 6000 })
	assert.equal(takeover.data.completion, 'complete')
	release()
	const stale = await slow
	assert.equal(stale.data.completion, 'busy', 'stale lease holder must not overwrite the job')
	assert.equal(h.job().status, 'complete')
	const processedAfterCheckpoint = h.seen.filter((id) => id >= 'f00010')
	assert.ok(h.seen.filter((id) => id < 'f00010').length === 10, 'rows before the checkpoint are not redone')
	assert.ok(processedAfterCheckpoint.length >= 30)
})

test('单条技术失败：报告 error，游标停在该条，下次只从该条继续，不误判完成', async () => {
	let failures = 2
	const h = setup({
		rows: fills(30),
		process: (row) => {
			if (row._id === 'f00012' && failures > 0) { failures -= 1; throw new Error('Request timeout for 10000 ms') }
			return { status: 'matched', write: 'unchanged' }
		}
	})
	const r1 = await h.call({ max_ms: 6000 })
	assert.equal(r1.data.completion, 'error')
	assert.equal(r1.data.row_error.filling_id, 'f00012')
	assert.equal(r1.data.row_error.attempts, 1)
	assert.notEqual(h.job().status, 'complete')
	const r2 = await h.call({ max_ms: 6000 })
	assert.equal(r2.data.completion, 'error')
	assert.equal(r2.data.row_error.attempts, 2)
	const r3 = await h.call({ max_ms: 6000 })
	assert.equal(r3.data.completion, 'complete')
	assert.equal(h.seen.filter((id) => id < 'f00010').length, 10, 'rows before last checkpoint processed once')
	assert.equal(h.seen.filter((id) => id === 'f00012').length, 3)
})

test('同一条连续失败达到上限：转为 blocked 并停止自动处理；更高 resume_token 才重试', async () => {
	let broken = true
	const h = setup({
		rows: fills(15),
		process: (row) => {
			if (row._id === 'f00003' && broken) throw new Error('bad data')
			return { status: 'matched', write: 'unchanged' }
		}
	})
	const completions = []
	for (let i = 0; i < ROW_MAX_ATTEMPTS; i += 1) completions.push((await h.call({ max_ms: 6000 })).data.completion)
	assert.deepEqual(completions, [...Array(ROW_MAX_ATTEMPTS - 1).fill('error'), 'blocked'])
	assert.deepEqual(h.job().blocked_ids, ['f00003'])
	const seen = h.seen.length
	const stored = await h.call({ max_ms: 6000 })
	assert.equal(stored.data.completion, 'blocked')
	assert.equal(h.seen.length, seen, 'blocked job is not re-processed automatically')
	broken = false
	const resumed = await h.call({ max_ms: 6000, resume_token: 1 })
	assert.equal(resumed.data.completion, 'complete')
	assert.deepEqual(h.job().blocked_ids, [])
	assert.equal(h.seen.length, seen + 1, 'only the blocked filling is retried')
})

test('业务待核（缺回瓶依据、人工确认依据已变化）不当作技术失败，整步完成并保留待核清单', async () => {
	const h = setup({
		rows: fills(5),
		process: (row) => {
			if (row._id === 'f00001') return { status: 'pending', reason: 'missing_back_basis', write: 'unchanged' }
			if (row._id === 'f00002') throw Object.assign(new Error('依据已变化'), { code: 'CONFIRMED_BASIS_CHANGED' })
			return { status: 'matched', write: 'unchanged' }
		}
	})
	const res = await h.call({ max_ms: 6000 })
	assert.equal(res.data.completion, 'complete_with_review')
	assert.equal(res.data.review_total, 2)
	assert.deepEqual(res.data.review_items.map((x) => x.reason).sort(), ['confirmed_basis_changed', 'missing_back_basis'])
	assert.equal(h.seen.length, 5)
})

test('日期下推：只读取下界之后的规范日期，异常日期由补查阶段处理，按解析结果判定范围', async () => {
	const history = fills(300, { date: (i) => `2026-0${1 + (i % 9)}-${String((i % 28) + 1).padStart(2, '0')}`, prefix: 'h' })
	const odd = [
		{ _id: 'o1', date: ' 2026-11-12' }, // leading blank, in scope
		{ _id: 'o2', date: '2026 11 12' }, // separator sorts before '-', in scope
		{ _id: 'o3', date: '2026-11-1' }, // unpadded, 11-01 < bound -> out of scope
		{ _id: 'o4', date: String(Date.parse('2026-11-12T08:00:00+08:00')) }, // timestamp string, in scope
		{ _id: 'o5' }, // missing date -> created_at fallback (2026-11-12), in scope
		{ _id: 'o6', date: '' , created_at: Date.parse('2026-01-01T00:00:00+08:00') }, // empty -> created_at, out of scope
		{ _id: 'o7', date: '2026/11/12' }, // sorts after bound in main query but non-canonical -> guard only
		{ _id: 'o8', date: '2026-11-12' } // canonical in scope
	].map((row) => ({ bottle_no: '25', record_type: 'normal_fill', weight_start: 120, weight_end: 170, fill_weight: 50,
		created_at: Date.parse('2026-11-12T09:00:00+08:00'), ...row }))
	const h = setup({ rows: [...history, ...odd] })
	h.fake.stats.readsByTable = {}
	const res = await h.call({ max_ms: 6000, date_from: '2026-11-10' })
	assert.equal(res.data.completion, 'complete')
	const expected = [...history, ...odd]
		.filter((row) => { const d = helpers.normalizeFillingDate(row.date, row.created_at); return !d || d >= '2026-11-10' })
		.map((row) => row._id).sort()
	assert.deepEqual([...h.seen].sort(), expected)
	assert.deepEqual(expected, ['o1', 'o2', 'o4', 'o5', 'o7', 'o8'])
	assert.equal(new Set(h.seen).size, h.seen.length, 'no row processed twice across main/guard')
	assert.ok(h.fake.stats.readsByTable.crm_fillings < 20, `history must not be read: ${h.fake.stats.readsByTable.crm_fillings}`)
})

test('同一任务号绑定不同范围被拒绝；空瓶号与无效任务号被拒绝', async () => {
	const h = setup({ rows: fills(3) })
	assert.equal((await h.call({ max_ms: 6000 })).data.completion, 'complete')
	assert.equal((await h.call({ bottle_nos: ['26'] })).code, 409)
	assert.equal((await h.call({ date_from: '2026-11-01' })).code, 409)
	assert.equal((await h.jobs.run(user, { job_key: 'short', bottle_nos: ['1'] })).code, 400)
	assert.equal((await h.jobs.run(user, { job_key: KEY, bottle_nos: [] })).code, 400)
})

test('单条处理超过时限时每次调用仍至少推进一条', async () => {
	const h = setup({ rows: fills(3), stepMs: 10_000 })
	const advanced = []
	let res
	do {
		res = await h.call()
		advanced.push(res.data.advanced_this_call)
	} while (res.data.completion === 'partial')
	assert.equal(res.data.completion, 'complete')
	assert.deepEqual(advanced, [1, 1, 1, 0], 'one slow filling per call, then the empty tail completes')
	assert.equal(h.seen.length, 3)
})

test('时限预算为 recordLog 预留开销（timing instrumentation regression）', async () => {
	let logMs = 0
	const fake = createFakeDb()
	const seen = []
	fake.table('crm_fillings').push(...fills(10))
	const jobs = createStartLossJobs({
		db: fake.db,
		fillings: fake.db.collection('crm_fillings'),
		isCandidate: helpers.isStartLossSyncCandidate,
		normalizeBottleNo: helpers.normalizeBottleNo,
		normalizeFillingDate: helpers.normalizeFillingDate,
		recordLog: async () => { await new Promise((resolve) => setTimeout(resolve, logMs)) },
		processRow: async (row) => {
			seen.push(row._id)
			return { status: 'matched', write: 'unchanged' }
		}
	})
	// 预期：outOfTime 在 6000 - 1500 = 4500 ms 触发，留下 1500 ms 给 checkpoint + recordLog
	logMs = 2000
	const slow = await jobs.run(user, { job_key: 'wsl_timing_regression_001', bottle_nos: ['25'], max_ms: 6000 }, 'req-timing')
	assert.equal(slow.code, 0, JSON.stringify(slow))
	assert.equal(slow.data.completion, 'complete')
	assert.ok(slow.data.wall_elapsed_ms != null)
	assert.ok(slow.data.elapsed_ms < slow.data.wall_elapsed_ms, `work elapsed should be less than wall elapsed: ${slow.data.elapsed_ms} vs ${slow.data.wall_elapsed_ms}`)
	assert.ok(slow.data.wall_elapsed_ms >= 2000, `wall elapsed should include recordLog: ${slow.data.wall_elapsed_ms}`)
})
