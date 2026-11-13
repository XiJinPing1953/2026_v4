'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { runStartLossStep } = require('../uniCloud-alipay/cloudfunctions/crm-sale/webStartLossScope')
const { createStartLossJobs } = require('../uniCloud-alipay/cloudfunctions/crm-filling/startLossJobs')
const { createFakeDb } = require('./fakeCloudDb.cjs')
const { loadCrmFilling } = require('./loadCrmFillingInternals.cjs')
const { CALL_ACTION, summarizeStartLossTiming } = require('./lib/startLossTiming.cjs')

const logs = (rows = [], complete = true) => ({ rows, total: rows.length, complete })
const report = (calls = [], jobs = []) => summarizeStartLossTiming({ callLogs: logs(calls), jobLogs: logs(jobs) })
const base = { jobKey: 'wsl_timing_000000000001', bottleNos: ['25'], dateFrom: '', deadline: 9000 }

test('真实分批任务：工作5秒+最终日志8秒，caller日志与audit都报告13秒、超过9秒1次', async () => {
	const fake = createFakeDb(), helpers = loadCrmFilling(fake.db)
	let t = 0
	const callRows = [], jobRows = []
	fake.table('crm_fillings').push({ _id: 'fill1', bottle_no: '25', date: '2026-11-10',
		record_type: 'normal_fill', weight_start: 120, weight_end: 170, fill_weight: 50 })
	const jobs = createStartLossJobs({
		db: fake.db, fillings: fake.db.collection('crm_fillings'), now: () => t,
		isCandidate: helpers.isStartLossSyncCandidate, normalizeBottleNo: helpers.normalizeBottleNo,
		normalizeFillingDate: helpers.normalizeFillingDate,
		processRow: async () => { t += 5000; return { status: 'matched', write: 'unchanged' } },
		recordLog: async (user, action, detail) => { jobRows.push({ action, detail: structuredClone(detail) }); t += 8000 }
	})
	await assert.rejects(runStartLossStep({ ...base, now: () => t,
		call: (payload) => jobs.run({ _id: 'user1' }, payload, 'timing-1'),
		recordCall: async (detail) => { callRows.push({ action: CALL_ACTION, detail }); t += 2000 }
	}), (error) => error.deferral === 'progress')
	assert.equal(callRows.length, 1)
	assert.equal(callRows[0].detail.caller_elapsed_ms, 13000, 'includes callee log, excludes caller telemetry write')
	assert.equal(t, 15000)
	assert.equal(jobRows[0].detail.elapsed_ms, 5000)
	const timing = report(callRows, jobRows)
	assert.equal(timing.measurement_source, CALL_ACTION)
	assert.deepEqual(timing.wall_elapsed_ms, { p50: 13000, p90: 13000, p99: 13000, max: 13000 })
	assert.equal(timing.wall_over_9000ms, 1)
	assert.equal(timing.callee_work.elapsed_ms.max, 5000)
	assert.equal(timing.callee_work.over_9000ms, 0)
	assert.equal(timing.timeout_count, 0)
})

test('10秒超时写入独立等待样本，保留原异常，不伪装成已结束的灌装总耗时', async () => {
	let t = 0
	const rows = [], original = new Error('HttpClientRequestTimeoutError: Request timeout for 10000 ms')
	await assert.rejects(runStartLossStep({ ...base, now: () => t,
		call: async () => { t += 10000; throw original }, recordCall: async detail => rows.push({ detail })
	}), error => error === original)
	assert.equal(rows[0].detail.outcome, 'timeout')
	assert.equal(rows[0].detail.caller_elapsed_ms, 10000)
	const timing = report(rows)
	assert.equal(timing.timeout_count, 1)
	assert.equal(timing.timeout_wait_ms.max, 10000)
	assert.equal(timing.returned_calls, 0)
	assert.equal(timing.wall_elapsed_ms, null)
	assert.equal(timing.wall_over_9000ms, null)
})

test('普通调用错误与超时分开记录，响应业务错误仍有已返回时长', async () => {
	let t = 0
	const rows = [], original = new Error('network unavailable')
	const observe = async detail => rows.push({ detail })
	await assert.rejects(runStartLossStep({ ...base, now: () => t, recordCall: observe,
		call: async () => { t += 150; throw original }
	}), error => error === original)
	await assert.rejects(runStartLossStep({ ...base, now: () => t, recordCall: observe,
		call: async () => { t += 250; return { code: 401, msg: 'token invalid' } }
	}), /token invalid/)
	const timing = report(rows)
	assert.equal(timing.error_count, 1)
	assert.equal(timing.error_wait_ms.max, 150)
	assert.equal(timing.timeout_count, 0)
	assert.equal(timing.returned_calls, 1)
	assert.equal(timing.wall_elapsed_ms.max, 250)
	assert.equal(rows[1].detail.response_code, 401)
})

test('观测日志写入失败既不能吞掉原调用错误，也不能把成功改成失败', async () => {
	const recordCall = async () => { throw new Error('telemetry unavailable') }
	const data = { completion: 'complete', review_total: 0 }
	assert.equal(await runStartLossStep({ ...base, now: () => 0, recordCall,
		call: async () => ({ code: 0, data }) }), data)
	const original = new Error('original call error')
	await assert.rejects(runStartLossStep({ ...base, now: () => 0, recordCall,
		call: async () => { throw original } }), error => error === original)
})

test('同一销售步骤中每个分批调用各写一条观测，不能只记录最后一批', async () => {
	let t = 0, calls = 0
	const rows = []
	const result = await runStartLossStep({ ...base, deadline: 30000, now: () => t,
		call: async () => { calls++; t += calls * 1000; return { code: 0, data: {
			completion: calls === 1 ? 'partial' : 'complete', advanced_this_call: 1 } } },
		recordCall: async detail => rows.push({ detail })
	})
	assert.equal(result.completion, 'complete')
	assert.deepEqual(rows.map(r => r.detail.caller_elapsed_ms), [1000, 2000])
	assert.equal(report(rows).returned_calls, 2)
})

test('无caller样本、旧callee日志、缺字段或无效值不能推导为0次慢调用', () => {
	const timing = summarizeStartLossTiming({
		callLogs: logs([{ detail: { timing_version: 'start-loss-call/1', outcome: 'returned', caller_elapsed_ms: null } }], false),
		jobLogs: logs([{ detail: { elapsed_ms: 5000, wall_elapsed_ms: 5000 } }])
	})
	assert.equal(timing.wall_elapsed_ms, null)
	assert.equal(timing.wall_over_9000ms, null)
	assert.equal(timing.complete, false)
	assert.equal(timing.invalid_samples, 1)
	assert.equal(timing.callee_work.elapsed_ms.max, 5000)
	assert.equal(report().wall_over_9000ms, null)
})

test('真实crm-sale保存流程把调用观测持久化到操作日志，包含销售/任务ID及超时', async () => {
	const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
	const { createRequire } = require('node:module')
	const fixturePath = path.join(__dirname, 'mobileSaleCreate.test.cjs')
	const fixture = { require: createRequire(fixturePath), exports: {}, __dirname, process, structuredClone, console, Buffer, setTimeout, clearTimeout }
	let source = fs.readFileSync(fixturePath, 'utf8').split("test('server capability")[0]
	source = source.replace("input:(operation='mobile-test-0001')", "drain:()=>context.exports.main({},{SOURCE:'timing'}), input:(operation='mobile-test-0001')")
	vm.runInNewContext(source + '\nexports.harness=harness;', fixture, { filename: fixturePath })
	let fail = true
	const h = fixture.exports.harness({ cloud: async request => {
		if (request.name === 'crm-filling' && request.data.action === 'syncStartLossJobV1') {
			if (fail) throw new Error('Request timeout for 10000 ms')
			return { result: { code: 0, data: { completion: 'complete' } } }
		}
		return { result: { code: 0, data: { job_id: 'test-job', done: true, status: 'completed', applied_amount: 0, unresolved_count: 0 } } }
	} })
	const payload = structuredClone(h.input().payload)
	payload.backRows = [{ bottle_no: 'B2', bottle_id: 'bottle-2', gross: 3, tare: 2, net: 1 }]
	payload.ignore_bottle_flow_warning = true
	const operationId = 'web-save-timing-00001'
	await h.invoke('saveWebV1', { operation_id: operationId, save_action: 'createV2', payload }, 'admin')
	const ready = () => { for (const op of h.tables.crm_web_sale_operations || []) { op.next_retry_at = 0; op.lease_until = 0 } }
	ready(); await h.drain()
	fail = false
	ready(); await h.drain()
	const rows = h.tables.crm_operation_logs.filter(r => r.action === CALL_ACTION)
	assert.ok(rows.some(r => r.detail.outcome === 'timeout'))
	assert.ok(rows.some(r => r.detail.outcome === 'returned' && r.detail.completion === 'complete'))
	assert.ok(rows.every(r => r.detail.operation_id === operationId && r.detail.sale_id && r.detail.job_key))
	assert.ok(rows.every(r => typeof r.detail.caller_elapsed_ms === 'number' && r.detail.caller_elapsed_ms >= 0))
	assert.equal(h.tables.crm_web_sale_operations[0].status, 'complete')
})
