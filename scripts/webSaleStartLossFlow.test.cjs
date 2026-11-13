'use strict'
// Real crm-sale web save pipeline with a return bottle: the start_loss step drives
// crm-filling.syncStartLossJobV1 and only completes on an explicit final completion.
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module')
const fixturePath = path.join(__dirname, 'mobileSaleCreate.test.cjs')
const fixture = { require: createRequire(fixturePath), exports: {}, __dirname, process, structuredClone, console, Buffer, setTimeout, clearTimeout }
let fixtureCode = fs.readFileSync(fixturePath, 'utf8').split("test('server capability")[0]
fixtureCode = fixtureCode.replace("input:(operation='mobile-test-0001')", "drain:()=>context.exports.main({},{SOURCE:'timing'}), input:(operation='mobile-test-0001')")
vm.runInNewContext(fixtureCode + '\nexports.harness=harness;', fixture, { filename: fixturePath })

const DEFAULT = { result: { code: 0, data: { job_id: 'test-job', done: true, status: 'completed', applied_amount: 0, unresolved_count: 0 } } }
function make(fillingJob) {
	const jobCalls = []
	const h = fixture.exports.harness({ cloud: async (request) => {
		if (request.name === 'crm-filling' && request.data.action === 'syncStartLossJobV1') {
			jobCalls.push(request.data.data)
			return fillingJob(request.data.data, jobCalls.length)
		}
		if (request.name === 'crm-filling' && request.data.action === 'syncStartLossAdjustmentsV1') throw new Error('web path must not call the legacy sync')
		return DEFAULT
	} })
	return { h, jobCalls }
}
const input = (h, id = 'web-save-loss-0001') => {
	const payload = structuredClone(h.input().payload)
	payload.backRows = [{ bottle_no: 'B2', bottle_id: 'bottle-2', gross: 3, tare: 2, net: 1 }]
	payload.ignore_bottle_flow_warning = true
	return { operation_id: id, save_action: 'createV2', payload }
}
const ops = (h) => h.tables.crm_web_sale_operations || []
const ready = (h) => { for (const row of ops(h)) { row.next_retry_at = 0; row.lease_until = 0 } }
const done = (completion, extra = {}) => ({ result: { code: 0, data: { completion, advanced_this_call: 5, counts: { scanned: 5 }, job_key: 'k', review_total: 0, ...extra } } })

test('上秤差步骤按销售日期发起分批任务，partial 续办后 complete 才完成', async () => {
	const { h, jobCalls } = make((data, n) => done(n < 2 ? 'partial' : 'complete'))
	const r = await h.invoke('saveWebV1', input(h), 'admin')
	assert.equal(r.code, 0, JSON.stringify(r))
	ready(h); await h.drain(); ready(h); await h.drain()
	assert.equal(ops(h)[0].status, 'complete', JSON.stringify(ops(h)[0]))
	assert.ok(jobCalls.length >= 2)
	assert.ok(jobCalls.every((c) => c.date_from === '2026-10-15' && JSON.stringify(c.bottle_nos) === '["B2"]'))
	assert.equal(new Set(jobCalls.map((c) => c.job_key)).size, 1, 'one stable job key across calls')
})

test('调用超时不算完成：任务保持 pending、计一次连续失败，下次以同一任务号续办', async () => {
	let fail = true
	const { h, jobCalls } = make(() => { if (fail) throw new Error('HttpClientRequestTimeoutError: Request timeout for 10000 ms'); return done('complete') })
	await h.invoke('saveWebV1', input(h), 'admin')
	ready(h); await h.drain()
	assert.equal(ops(h)[0].status, 'pending')
	assert.ok(!ops(h)[0].completed_steps.includes('start_loss'))
	assert.ok(ops(h)[0].failure_streak >= 1)
	fail = false
	ready(h); await h.drain()
	assert.equal(ops(h)[0].status, 'complete')
	assert.equal(new Set(jobCalls.map((c) => c.job_key)).size, 1)
})

test('单条异常（error）与人工核对（blocked）都不会把上秤差步骤标为完成', async () => {
	const e = make(() => done('error', { row_error: { error: 'x', attempts: 1 } }))
	await e.h.invoke('saveWebV1', input(e.h), 'admin'); ready(e.h); await e.h.drain()
	assert.equal(ops(e.h)[0].status, 'pending'); assert.ok(!ops(e.h)[0].completed_steps.includes('start_loss'))
	const b = make(() => done('blocked', { blocked_ids: ['f1'] }))
	await b.h.invoke('saveWebV1', input(b.h, 'web-save-loss-0002'), 'admin'); ready(b.h); await b.h.drain()
	assert.equal(ops(b.h)[0].status, 'blocked'); assert.ok(!ops(b.h)[0].completed_steps.includes('start_loss'))
	assert.match(ops(b.h)[0].last_error, /人工核对/)
})

test('待核项随完成结果记录日志，不阻塞任务', async () => {
	const { h } = make(() => done('complete_with_review', { review_total: 2, review_items: [{ filling_id: 'f', reason: 'missing_back_basis' }] }))
	await h.invoke('saveWebV1', input(h), 'admin'); ready(h); await h.drain()
	assert.equal(ops(h)[0].status, 'complete')
	assert.ok((h.tables.crm_operation_logs || []).some((row) => row.action === 'sale_web_start_loss_review' && row.detail.review_total === 2))
})

test('并发补算时过期计算不覆盖新结果（stale basis race regression）', async () => {
	const { h } = make((data, n) => {
		if (n === 1) return done('partial')
		if (n === 2) return done('complete')
		if (n === 3) return done('partial')
		return done('complete')
	})
	const r1 = h.invoke('saveWebV1', input(h, 'op001-valid-012'), 'admin')
	await new Promise((resolve) => setImmediate(resolve))
	const r2 = h.invoke('saveWebV1', input(h, 'op002-valid-012'), 'admin')
	const [res1, res2] = await Promise.all([r1, r2])
	assert.equal(res1.code, 0, `op1 should succeed: ${JSON.stringify(res1)}`)
	assert.equal(res2.code, 0, `op2 should succeed: ${JSON.stringify(res2)}`)
	ready(h)
	await h.drain()
	const allOps = ops(h)
	assert.ok(allOps.some((o) => o.operation_id === 'op002-valid-012' && o.status === 'complete'),
		`op2 should be complete: ${JSON.stringify(allOps.map(o => ({ id: o.operation_id, status: o.status })))}`)
})
