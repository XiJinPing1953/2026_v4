'use strict'

// Web-sale follow-up retry control (crm-sale/webSaleSave.run) and the start_loss
// step driver (crm-sale/webStartLossScope.runStartLossStep).
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb } = require('./fakeCloudDb.cjs')
const webSave = require('../uniCloud-alipay/cloudfunctions/crm-sale/webSaleSave')
const { runStartLossStep, webStartLossJobKey } = require('../uniCloud-alipay/cloudfunctions/crm-sale/webStartLossScope')

const KEY = 'a'.repeat(24)

function setup(stepRun, { op: seedOp = {} } = {}) {
	const fake = createFakeDb()
	const clock = { t: 10_000_000 }
	fake.table('crm_sale_records').push({ _id: 'sale-1', web_save_operation_key: KEY })
	fake.table('crm_web_sale_operations').push({ _id: KEY, operation_id: 'web-op-1', sale_id: 'sale-1', created_by: 'u1',
		request_id: 'req', rule_version: webSave.VERSION, status: 'pending', completed_steps: ['movements'], lease_id: '',
		lease_until: 0, attempts: 0, next_retry_at: 0, last_error: '', created_at: 1, save_action: 'createV2', ...seedOp })
	const calls = []
	const service = webSave.createService({
		db: fake.db, handlers: {}, now: () => clock.t,
		authorize: async () => ({ ok: true }),
		actor: async () => ({ _id: 'u1', token: 'tok' }),
		steps: () => [
			{ name: 'movements', run: async () => { throw new Error('completed steps must not rerun') } },
			{ name: 'start_loss', run: async (args) => { calls.push(args); return stepRun(args, calls.length) } },
			{ name: 'anomaly', run: async () => {} }
		]
	})
	const op = () => fake.table('crm_web_sale_operations')[0]
	const ready = () => { op().next_retry_at = 0; op().lease_until = 0 }
	return { fake, clock, service, calls, op, ready }
}

test('分批推进不计失败：attempts/连续失败清零并立即续办', async () => {
	const h = setup(() => { throw Object.assign(new Error('分批进行中'), { deferral: 'progress' }) }, { op: { attempts: 7, failure_streak: 7 } })
	await h.service.run(KEY)
	assert.equal(h.op().status, 'pending')
	assert.equal(h.op().attempts, 0)
	assert.equal(h.op().failure_streak, 0)
	assert.equal(h.op().next_retry_at, h.clock.t)
	assert.deepEqual(h.op().completed_steps, ['movements'])
	assert.ok(h.calls[0].deadline > h.clock.t, 'step receives the run deadline')
})

test('让出时间与子任务忙：计数不变；忙时一分钟后再试', async () => {
	const y = setup(() => { throw Object.assign(new Error('等待'), { deferral: 'yield' }) }, { op: { attempts: 3, failure_streak: 3 } })
	await y.service.run(KEY)
	assert.equal(y.op().attempts, 3); assert.equal(y.op().failure_streak, 3); assert.equal(y.op().next_retry_at, y.clock.t)
	const b = setup(() => { throw Object.assign(new Error('忙'), { deferral: 'busy' }) }, { op: { attempts: 3, failure_streak: 3 } })
	await b.service.run(KEY)
	assert.equal(b.op().attempts, 3); assert.equal(b.op().next_retry_at, b.clock.t + 60000)
})

test('技术失败按退避重试；连续失败达到上限后停止（blocked），已完成步骤保留，定时续办不再领取', async () => {
	const h = setup(() => { throw new Error('Request timeout for 10000 ms') })
	for (let i = 1; i < webSave.MAX_FAILURE_STREAK; i += 1) {
		h.ready(); await h.service.run(KEY)
		assert.equal(h.op().status, 'pending'); assert.equal(h.op().failure_streak, i)
		assert.ok(h.op().next_retry_at > h.clock.t)
	}
	h.ready(); await h.service.run(KEY)
	assert.equal(h.op().status, 'blocked')
	assert.equal(h.op().blocked_at, h.clock.t)
	assert.deepEqual(h.op().completed_steps, ['movements'])
	const n = h.calls.length
	await h.service.drain()
	assert.equal(h.calls.length, n, 'blocked job is not picked by the timer')
	assert.equal((await h.service.guard({ web_save_operation_key: KEY }).catch((e) => e.code)), 409, 'sale stays locked')
})

test('业务阻塞信号立即停止，人工恢复后带新的 resume_count 继续并完成', async () => {
	let blocked = true
	const h = setup((args) => {
		if (blocked) throw Object.assign(new Error('需人工核对'), { blocked: true })
		assert.equal(args.op.resume_count, 1)
	})
	await h.service.run(KEY)
	assert.equal(h.op().status, 'blocked')
	assert.equal(h.op().failure_streak, 1)
	assert.equal((await h.service.resume({}, { operation_key: 'bad' })).code, 400)
	blocked = false
	const resumed = await h.service.resume({}, { operation_key: KEY })
	assert.equal(resumed.code, 0)
	assert.equal(h.op().status, 'pending'); assert.equal(h.op().attempts, 0); assert.equal(h.op().resume_count, 1)
	assert.equal((await h.service.resume({}, { operation_key: KEY })).code, 409, 'only blocked jobs can be resumed')
	await h.service.drain()
	assert.equal(h.op().status, 'complete')
	assert.deepEqual(h.op().completed_steps, ['movements', 'start_loss', 'anomaly'])
})

test('旧任务累计 attempts 很大时，首次新失败不会直接停止（按连续失败计）', async () => {
	const h = setup(() => { throw new Error('timeout') }, { op: { attempts: 910 } })
	await h.service.run(KEY)
	assert.equal(h.op().status, 'pending')
	assert.equal(h.op().failure_streak, 1)
})

// ---- runStartLossStep ----
function stepHarness(responses, { budget = 40000 } = {}) {
	const clock = { t: 0 }
	const sent = []
	const call = async (payload) => {
		sent.push(payload)
		clock.t += 6000
		const next = responses.shift()
		if (next instanceof Error) throw next
		return next
	}
	return { sent, run: (extra = {}) => runStartLossStep({ call, jobKey: 'wsl_x', bottleNos: ['25'], dateFrom: '2026-11-10',
		deadline: budget, now: () => clock.t, ...extra }) }
}
const reply = (completion, data = {}) => ({ code: 0, data: { completion, advanced_this_call: 10, counts: { scanned: 10 }, ...data } })

test('步骤驱动：partial 时在时限内连续续办，直到 complete', async () => {
	const h = stepHarness([reply('partial'), reply('partial'), reply('complete_with_review', { review_total: 1 })])
	const data = await h.run()
	assert.equal(data.completion, 'complete_with_review')
	assert.equal(h.sent.length, 3)
	assert.ok(h.sent.every((p) => p.max_ms <= 5000 && p.job_key === 'wsl_x' && p.date_from === '2026-11-10'))
})

test('步骤驱动：时间不足时以 progress 交还；未推进时以 yield 交还', async () => {
	await assert.rejects(stepHarness([reply('partial')], { budget: 8000 }).run(), (e) => e.deferral === 'progress')
	await assert.rejects(stepHarness([reply('partial', { advanced_this_call: 0 })]).run(), (e) => e.deferral === 'yield')
	await assert.rejects(stepHarness([], { budget: 1000 }).run(), (e) => e.deferral === 'yield')
})

test('步骤驱动：error/超时为技术失败，blocked 为阻塞，busy 为忙，非 0 返回码及缺少 completion 都不算完成', async () => {
	await assert.rejects(stepHarness([reply('error', { row_error: { error: 'x', attempts: 2 } })]).run(), (e) => !e.deferral && !e.blocked && /单条失败/.test(e.message))
	await assert.rejects(stepHarness([new Error('HttpClientRequestTimeoutError')]).run(), (e) => !e.deferral && !e.blocked)
	await assert.rejects(stepHarness([reply('blocked', { blocked_ids: ['f1'] })]).run(), (e) => e.blocked === true)
	await assert.rejects(stepHarness([reply('busy')]).run(), (e) => e.deferral === 'busy')
	await assert.rejects(stepHarness([{ code: 400, msg: '未知 action' }]).run(), /未知 action/)
	await assert.rejects(stepHarness([{ code: 0, data: { scanned_total: 5 } }]).run(), /返回无效/)
})

test('任务号稳定：同一操作和范围得到同一任务号，范围不同则不同', () => {
	const a = webStartLossJobKey(KEY, ['26', '25'], '2026-11-10')
	assert.equal(a, webStartLossJobKey(KEY, ['25', '26'], '2026-11-10'))
	assert.notEqual(a, webStartLossJobKey(KEY, ['25'], '2026-11-10'))
	assert.notEqual(a, webStartLossJobKey(KEY, ['25', '26'], ''))
	assert.match(a, /^[a-zA-Z0-9_-]{16,64}$/)
})
