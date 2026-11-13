'use strict'

// A callee cannot persist a duration including the write of that same log.
// Use the caller's settled cloud promise for full returned-call latency, and
// keep timeout waits separate: a timed-out callee may still be running.
const CALL_ACTION = 'sale_web_start_loss_call_v1'
const VERSION = 'start-loss-call/1'
const duration = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
const summary = (values) => {
	const sorted = [...values].sort((a, b) => a - b)
	if (!sorted.length) return null
	const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
	return { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: sorted.at(-1) }
}

function summarizeStartLossTiming({ callLogs, jobLogs }) {
	const observations = callLogs.rows.map((r) => r.detail || {})
	const valid = observations.filter((d) => d.timing_version === VERSION && duration(d.caller_elapsed_ms)
		&& ['returned', 'error', 'timeout'].includes(d.outcome))
	const samples = (outcome) => valid.filter((d) => d.outcome === outcome).map((d) => d.caller_elapsed_ms)
	const returned = samples('returned'), timeouts = samples('timeout'), errors = samples('error')
	const completions = {}
	for (const d of valid) if (d.outcome === 'returned') completions[d.completion || 'invalid_response'] = (completions[d.completion || 'invalid_response'] || 0) + 1
	const work = jobLogs.rows.map((r) => r.detail?.elapsed_ms).filter(duration)
	return {
		measurement_source: CALL_ACTION,
		calls: observations.length, complete: callLogs.complete,
		valid_samples: valid.length, invalid_samples: observations.length - valid.length,
		returned_calls: returned.length, completions,
		// These fields intentionally never fall back to callee pre-log timestamps.
		wall_elapsed_ms: summary(returned),
		wall_over_9000ms: returned.length ? returned.filter((v) => v > 9000).length : null,
		timeout_count: timeouts.length, timeout_wait_ms: summary(timeouts),
		error_count: errors.length, error_wait_ms: summary(errors),
		jobs: new Set(valid.map((d) => d.job_key).filter(Boolean)).size,
		callee_work: { calls: jobLogs.rows.length, complete: jobLogs.complete, samples: work.length,
			elapsed_ms: summary(work), over_9000ms: work.length ? work.filter((v) => v > 9000).length : null }
	}
}

module.exports = { CALL_ACTION, summarizeStartLossTiming }
