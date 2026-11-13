'use strict'
const crypto = require('crypto')

// Earliest business date among the saved versions that carry return bottles.
// crm-filling only re-syncs fillings dated on/after it (a return can only be the
// start-loss basis of later-or-same-day fillings). Any unknown date => '' so the
// callee falls back to the full historical sync instead of guessing a bound.
const YMD = /^\d{4}-\d{2}-\d{2}$/

function webStartLossDateFrom(docs, backBottleNos) {
	const relevant = (docs || []).filter((doc) => doc && backBottleNos(doc).length)
	if (!relevant.length) return ''
	const dates = relevant.map((doc) => (doc.date == null ? '' : String(doc.date).trim()))
	if (dates.some((date) => !YMD.test(date))) return ''
	return dates.sort()[0]
}

function webStartLossJobKey(operationKey, bottleNos, dateFrom) {
	const scope = JSON.stringify(['web-start-loss/1', operationKey, [...bottleNos].sort(), dateFrom || ''])
	return `wsl_${crypto.createHash('sha256').update(scope).digest('hex').slice(0, 40)}`
}

const signal = (message, extra) => Object.assign(new Error(message), extra)
const CALL_RESERVE_MS = 9000 // scheduling allowance; the callee's 6 s budget is soft
const MIN_CALL_MS = 1500

// Drive crm-filling.syncStartLossJobV1 until it reports a final completion or this
// run's time is used up. Throws step signals understood by webSaleSave.run:
//   deferral 'progress' - bounded work done and checkpointed by the callee
//   deferral 'yield'    - no time left to start a call in this run
//   deferral 'busy'     - another call currently owns the sub-job
//   blocked             - business/data review needed; automation stops
//   plain Error         - technical failure (counts toward the failure streak)
async function runStartLossStep({ call, jobKey, bottleNos, dateFrom, resumeToken = 0, deadline, now = Date.now, recordCall }) {
	let calls = 0
	for (;;) {
		const left = deadline - now()
		if (left < MIN_CALL_MS && calls === 0) throw signal('灌装上秤差处理等待后台继续', { deferral: 'yield' })
		const maxMs = Math.max(500, Math.min(5000, left - 2500))
		const started = now()
		let res, callError, callFailed = false
		try {
			res = await call({ job_key: jobKey, bottle_nos: bottleNos, date_from: dateFrom || '', resume_token: resumeToken, max_ms: maxMs })
		} catch (error) {
			callFailed = true
			callError = error
		}
		// Capture after the cloud promise settles, before writing this observation.
		// Callee log/checkpoint/transport time is included; our own telemetry write is not.
		const observation = {
			timing_version: 'start-loss-call/1', job_key: jobKey,
			caller_elapsed_ms: Math.max(0, now() - started),
			outcome: callFailed ? (/timeout|timed\s*out|超时/i.test(`${callError?.name || ''} ${callError?.code || ''} ${callError?.message || callError}`) ? 'timeout' : 'error') : 'returned'
		}
		if (callFailed) {
			observation.error_name = String(callError?.name || 'Error').slice(0, 80)
			observation.error_code = String(callError?.code || '').slice(0, 80)
		} else {
			observation.response_code = res?.code ?? null
			observation.completion = typeof res?.data?.completion === 'string' ? res.data.completion : ''
		}
		if (recordCall) {
			// Telemetry failure must not replace either a valid result or the original error.
			try { await recordCall(observation) } catch (_) {}
		}
		if (callFailed) throw callError
		calls += 1
		if (!res || res.code !== 0 || !res.data || typeof res.data.completion !== 'string') {
			throw new Error((res && res.msg) || '灌装上秤差处理返回无效')
		}
		const data = res.data
		switch (data.completion) {
			case 'complete':
			case 'complete_with_review':
				return data
			case 'partial':
				if (!(data.advanced_this_call > 0)) throw signal('灌装上秤差处理本轮未推进', { deferral: 'yield' })
				if (deadline - now() >= CALL_RESERVE_MS) continue
				throw signal(`灌装上秤差处理分批进行中（已处理${data.counts?.scanned || 0}条）`, { deferral: 'progress' })
			case 'busy':
				throw signal('灌装上秤差处理正在另一进程中', { deferral: 'busy' })
			case 'blocked':
				throw signal(`灌装上秤差处理需人工核对：灌装${(data.blocked_ids || []).slice(0, 5).join(',')}多次失败`, { blocked: true })
			case 'error':
				throw new Error(`灌装上秤差处理单条失败：${data.row_error?.error || ''}（第${data.row_error?.attempts || 1}次）`)
			default:
				throw new Error(`灌装上秤差处理状态未知：${data.completion}`)
		}
	}
}

module.exports = { webStartLossDateFrom, webStartLossJobKey, runStartLossStep, CALL_RESERVE_MS }
