'use strict'

// Durable, bounded start-loss re-sync jobs.
//
// One job = one caller operation (e.g. a web-sale follow-up) and a frozen scope
// (bottle numbers + optional business-date lower bound). Each call uses a soft
// `max_ms` budget, checkpoints a stable `_id` cursor, and returns an explicit
// completion. A caller whose request timed out finds the stored progress (or the
// stored final result) on its next call instead of starting from the beginning.
// An in-flight row/query cannot be interrupted; caller latency is measured by
// crm-sale and may exceed this work budget.
//
// completion:
//   complete              every in-scope filling processed, nothing to review
//   complete_with_review  every in-scope filling processed; some are business review
//                         states (no return basis yet, confirmed basis changed)
//   partial               time budget used up; call again to continue
//   busy                  another call holds the lease; call again later
//   error                 a technical error on one filling; it is retried next call
//   blocked               a filling failed ROW_MAX_ATTEMPTS times; needs manual review
//                         (pass a higher resume_token to retry blocked fillings)
const crypto = require('crypto')
const { normalizeStartLossDateFrom, isInStartLossScope } = require('./startLossScope')

const JOB_VERSION = 'start-loss-job/1'
const JOBS = 'crm_filling_start_loss_jobs'
const PAGE = 100
const CHECKPOINT_EVERY = 10
const ROW_MAX_ATTEMPTS = 5
const LEASE_MS = 70000 // longer than the 60 s crm-filling platform timeout
const DEFAULT_MAX_MS = 5000
const MAX_MAX_MS = 6000 // work budget, not a hard bound on a database call or logging
const OVERHEAD_MS = 1500 // reserve for final checkpoint + recordLog
const REVIEW_KEEP = 100
const RESULT_REVIEW_KEEP = 20
const BLOCKED_MAX = 50
const NON_CANONICAL_DATE = '^(?!\\d{4}-\\d{2}-\\d{2}$)'
const CANONICAL = /^\d{4}-\d{2}-\d{2}$/
const COMPLETE = new Set(['complete', 'complete_with_review'])
const FIELD = { _id: true, date: true, filling_time: true, bottle_no: true, record_type: true, fill_weight: true,
	weight_start: true, weight_end: true, actual_net_weight: true, created_at: true, updated_at: true, created_by: true, created_by_name: true }

const text = (v) => (v == null ? '' : String(v).trim())
const first = (r) => (Array.isArray(r && r.data) ? r.data[0] : r && r.data) || null
const emptyCounts = () => ({ scanned: 0, matched: 0, zero: 0, missing_basis: 0, skipped: 0, out_of_scope: 0,
	unchanged: 0, created: 0, replaced: 0, removed_only: 0, docs_removed: 0, docs_created: 0, review: 0, row_errors: 0 })

function createStartLossJobs({ db, fillings, processRow, isCandidate, normalizeBottleNo, normalizeFillingDate,
	recordLog = async () => {}, now = Date.now, newContext = () => ({}) }) {
	const cmd = db.command
	const jobs = db.collection(JOBS)

	function normalizeScope(data = {}) {
		const jobKey = text(data.job_key)
		if (!/^[a-zA-Z0-9_-]{16,64}$/.test(jobKey)) return { error: '补算任务号无效' }
		const raw = Array.isArray(data.bottle_nos) ? data.bottle_nos : []
		const bottles = [...new Set(raw.map(normalizeBottleNo).filter(Boolean))].sort()
		if (!bottles.length) return { error: '缺少补算瓶号' }
		if (bottles.length > 500) return { error: '补算瓶号过多' }
		const dateFrom = normalizeStartLossDateFrom(data.date_from)
		const maxMs = Math.min(Math.max(Number(data.max_ms) || DEFAULT_MAX_MS, 500), MAX_MAX_MS)
		const resumeToken = Number.isInteger(data.resume_token) && data.resume_token > 0 ? data.resume_token : 0
		const digest = crypto.createHash('sha256').update(JSON.stringify({ v: JOB_VERSION, bottles, dateFrom })).digest('hex')
		return { jobKey, bottles, dateFrom, maxMs, resumeToken, digest }
	}

	const phasesFor = (job) => (job.date_from ? ['retry', 'main', 'guard', 'done'] : ['retry', 'main', 'done'])
	const chunksFor = (job) => {
		const out = []
		for (let i = 0; i < job.bottle_nos.length; i += 100) out.push(job.bottle_nos.slice(i, i + 100))
		return out
	}

	// The date bound is pushed into the query. For canonical YYYY-MM-DD strings the
	// lexicographic `>=` is exact. Any other stored form (blank, unpadded, other
	// separators, timestamp strings, missing) is read by the guard phase, which uses
	// the same negative-lookahead RegExp form already used by crm-log in production.
	// Every row is then re-checked with the shared date parser.
	function phaseWhere(phase, chunk, job, cursor) {
		const parts = [{ bottle_no: cmd.in(chunk) }, { weight_start: cmd.gt(0) }]
		if (phase === 'main' && job.date_from) parts.push({ date: cmd.gte(job.date_from) })
		if (phase === 'guard') {
			parts.push(cmd.or([{ date: db.RegExp({ regexp: NON_CANONICAL_DATE, options: '' }) }, { date: cmd.exists(false) }, { date: cmd.eq(null) }]))
		}
		if (cursor) parts.push({ _id: cmd.gt(cursor) })
		return cmd.and(parts)
	}

	function view(job, extra = {}) {
		return {
			job_key: job._id,
			rule_version: JOB_VERSION,
			status: job.status,
			phase: job.phase,
			date_from: job.date_from || '',
			bottle_total: job.bottle_nos.length,
			counts: job.counts,
			review_total: job.review_total || 0,
			review_items: (job.review_items || []).slice(0, RESULT_REVIEW_KEEP),
			blocked_ids: job.blocked_ids || [],
			row_error: job.row_error || null,
			calls: job.calls || 0,
			elapsed_ms_total: job.elapsed_ms_total || 0,
			...extra
		}
	}

	async function load(key) {
		return first(await jobs.where({ _id: key }).limit(1).get())
	}

	async function ensureJob(user, scope, requestId) {
		const existing = await load(scope.jobKey)
		if (existing) return existing
		const t = now()
		const doc = { _id: scope.jobKey, rule_version: JOB_VERSION, scope_digest: scope.digest, bottle_nos: scope.bottles,
			date_from: scope.dateFrom, created_by: text(user && user._id), request_id: text(requestId), status: 'running',
			phase: 'retry', chunk: 0, cursor: '', retry_queue: [], retry_only: false, row_error: null, blocked_ids: [], blocked_errors: {},
			resume_token: scope.resumeToken, counts: emptyCounts(), review_total: 0, review_items: [], calls: 0,
			elapsed_ms_total: 0, lease_id: '', lease_until: 0, created_at: t, updated_at: t }
		try {
			await jobs.add(doc)
		} catch (error) {
			const raced = await load(scope.jobKey)
			if (raced) return raced
			throw error
		}
		return doc
	}

	async function run(user, data = {}, requestId = '') {
		const scope = normalizeScope(data)
		if (scope.error) return { code: 400, msg: scope.error }
		const started = now()
		let job = await ensureJob(user, scope, requestId)
		if (job.scope_digest !== scope.digest || job.rule_version !== JOB_VERSION) {
			return { code: 409, error_code: 'START_LOSS_JOB_SCOPE_CONFLICT', msg: '补算任务号已绑定其他范围' }
		}
		const resuming = job.status === 'blocked' && scope.resumeToken > (job.resume_token || 0)
		if (COMPLETE.has(job.status) || (job.status === 'blocked' && !resuming)) {
			return { code: 0, msg: 'ok', data: view(job, { completion: job.status, processed_this_call: 0, elapsed_ms: 0, stored: true }) }
		}

		const lease = crypto.randomBytes(12).toString('hex')
		const locked = await jobs.where({ _id: job._id, lease_until: cmd.lte(now()) })
			.update({ lease_id: lease, lease_until: now() + LEASE_MS, updated_at: now() })
		if (Number(locked && locked.updated) !== 1) {
			return { code: 0, msg: 'ok', data: view(job, { completion: 'busy', processed_this_call: 0, elapsed_ms: now() - started }) }
		}
		job = await load(job._id)
		const state = {
			status: 'running', phase: job.phase, chunk: job.chunk || 0, cursor: job.cursor || '',
			retry_queue: [...(job.retry_queue || [])], row_error: job.row_error || null,
			blocked_ids: [...(job.blocked_ids || [])], blocked_errors: { ...(job.blocked_errors || {}) },
			resume_token: job.resume_token || 0, retry_only: Boolean(job.retry_only), counts: { ...emptyCounts(), ...(job.counts || {}) },
			review_total: job.review_total || 0, review_items: [...(job.review_items || [])]
		}
		if (resuming) {
			state.retry_queue = [...new Set([...state.retry_queue, ...state.blocked_ids])]
			state.blocked_ids = []
			state.blocked_errors = {}
			state.resume_token = scope.resumeToken
			state.phase = 'retry'
			state.retry_only = true // the full scan already finished; only blocked fillings remain
		}

		const phases = phasesFor(job)
		const chunks = chunksFor(job)
		const ctx = newContext()
		let processed = 0
		let touched = 0 // rows skipped without processing (still advance the cursor)
		let sinceCheckpoint = 0
		let stop = ''
		let leaseLost = false

		// At least one filling per call, so a slow query can never starve progress.
		const outOfTime = () => processed + touched > 0 && now() - started >= Math.max(scope.maxMs - OVERHEAD_MS, scope.maxMs * 0.75)
		const checkpoint = async (extra = {}) => {
			const patch = { ...state, updated_at: now(), ...extra }
			const res = await jobs.where({ _id: job._id, lease_id: lease }).update(patch)
			if (Number(res && res.updated) !== 1) {
				leaseLost = true
				throw Object.assign(new Error('补算任务锁已变化'), { leaseLost: true })
			}
			sinceCheckpoint = 0
		}
		const nextPhase = () => {
			state.phase = state.retry_only ? 'done' : phases[phases.indexOf(state.phase) + 1] || 'done'
			state.retry_only = false
			state.chunk = 0
			state.cursor = ''
		}
		const review = (row, reason) => {
			state.review_total += 1
			state.counts.review += 1
			if (state.review_items.length < REVIEW_KEEP) {
				state.review_items.push({ filling_id: text(row._id), bottle_no: normalizeBottleNo(row.bottle_no), date: text(row.date), reason })
			}
		}
		const tally = (row, result) => {
			const status = text(result && result.status)
			if (status === 'matched') state.counts.matched += 1
			else if (status === 'matched_zero') state.counts.zero += 1
			else if (status === 'pending') {
				state.counts.missing_basis += 1
				review(row, text(result.reason) || 'missing_back_basis')
			} else state.counts.skipped += 1
			const write = text(result && result.write)
			if (write === 'unchanged') state.counts.unchanged += 1
			if (write === 'created') state.counts.created += 1
			if (write === 'replaced') state.counts.replaced += 1
			if (write === 'removed') state.counts.removed_only += 1
			state.counts.docs_removed += Number(result && result.docs_removed) || 0
			state.counts.docs_created += Number(result && result.docs_created) || 0
		}

		// Returns false when the call must stop before this row (row cursor not advanced).
		async function handle(row) {
			state.counts.scanned += 1
			let result
			try {
				result = await processRow(row, user, ctx)
			} catch (error) {
				if (error && error.code === 'CONFIRMED_BASIS_CHANGED') {
					review(row, 'confirmed_basis_changed')
					state.row_error = null
					processed += 1
					sinceCheckpoint += 1
					return true
				}
				state.counts.scanned -= 1
				state.counts.row_errors += 1
				const id = text(row._id)
				const attempts = state.row_error && state.row_error.filling_id === id ? state.row_error.attempts + 1 : 1
				const message = text(error && error.message).slice(0, 200) || '补算失败'
				if (attempts < ROW_MAX_ATTEMPTS || state.blocked_ids.length >= BLOCKED_MAX) {
					state.row_error = { filling_id: id, attempts, error: message, at: now() }
					return false
				}
				state.blocked_ids.push(id)
				state.blocked_errors[id] = message
				state.row_error = null
				processed += 1
				sinceCheckpoint += 1
				return true
			}
			// If processRow signals a stale input (filling was updated between scan and
			// write), re-read this filling from DB and retry once within the same call.
			if (result && result.stale) {
				const freshRes = await fillings.where({ _id: row._id }).field(FIELD).limit(1).get()
				const freshRow = Array.isArray(freshRes.data) ? freshRes.data[0] : null
				if (!freshRow) {
					// Filling deleted concurrently — skip gracefully.
					state.counts.scanned -= 1
					processed += 1
					sinceCheckpoint += 1
					return true
				}
				try {
					result = await processRow(freshRow, user, ctx)
				} catch (error) {
					if (error && error.code === 'CONFIRMED_BASIS_CHANGED') {
						review(row, 'confirmed_basis_changed')
						state.row_error = null
						processed += 1
						sinceCheckpoint += 1
						return true
					}
					// Second attempt also errored: treat as row error, do not advance cursor.
					state.counts.scanned -= 1
					state.counts.row_errors += 1
					const id = text(row._id)
					const attempts = state.row_error && state.row_error.filling_id === id ? state.row_error.attempts + 1 : 1
					const message = text(error && error.message).slice(0, 200) || '补算失败(重读)'
					if (attempts < ROW_MAX_ATTEMPTS || state.blocked_ids.length >= BLOCKED_MAX) {
						state.row_error = { filling_id: id, attempts, error: message, at: now() }
						return false
					}
					state.blocked_ids.push(id)
					state.blocked_errors[id] = message
					state.row_error = null
					processed += 1
					sinceCheckpoint += 1
					return true
				}
				if (result && result.stale) {
					// Still stale after re-read — treat as error so it retries next call.
					state.counts.scanned -= 1
					state.counts.row_errors += 1
					const id = text(row._id)
					const attempts = state.row_error && state.row_error.filling_id === id ? state.row_error.attempts + 1 : 1
					if (attempts < ROW_MAX_ATTEMPTS || state.blocked_ids.length >= BLOCKED_MAX) {
						state.row_error = { filling_id: id, attempts, error: 'stale after re-read', at: now() }
						return false
					}
					state.blocked_ids.push(id)
					state.blocked_errors[id] = 'stale after re-read'
					state.row_error = null
					processed += 1
					sinceCheckpoint += 1
					return true
				}
			}
			tally(row, result)
			state.row_error = null
			processed += 1
			sinceCheckpoint += 1
			return true
		}

		try {
			outer: while (state.phase !== 'done') {
				if (outOfTime()) { stop = 'budget'; break }
				if (state.phase === 'retry') {
					if (!state.retry_queue.length) { nextPhase(); continue }
					const ids = state.retry_queue.slice(0, PAGE)
					const res = await fillings.where({ _id: cmd.in(ids) }).field(FIELD).limit(ids.length).get()
					const byId = new Map((res.data || []).map((row) => [text(row._id), row]))
					for (const id of ids) {
						if (outOfTime()) { stop = 'budget'; break outer }
						const row = byId.get(id)
						// A deleted filling has its adjustments removed by the delete path.
						if (row && isCandidate(row) && !(await handle(row))) { stop = 'error'; break outer }
						state.retry_queue = state.retry_queue.filter((x) => x !== id)
						if (sinceCheckpoint >= CHECKPOINT_EVERY) await checkpoint()
					}
					continue
				}
				if (state.chunk >= chunks.length) { nextPhase(); continue }
				const res = await fillings.where(phaseWhere(state.phase, chunks[state.chunk], job, state.cursor))
					.field(FIELD).orderBy('_id', 'asc').limit(PAGE).get()
				const rows = Array.isArray(res.data) ? res.data : []
				for (const row of rows) {
					if (outOfTime()) { stop = 'budget'; break outer }
					if (state.phase === 'main' && job.date_from && !(typeof row.date === 'string' && CANONICAL.test(row.date))) {
						touched += 1 // non-canonical dates belong to the guard phase
					} else if (!isCandidate(row)) {
						state.counts.skipped += 1
						touched += 1
					} else if (!isInStartLossScope(row, job.date_from, normalizeFillingDate)) {
						state.counts.out_of_scope += 1
						touched += 1
					} else if (!(await handle(row))) {
						stop = 'error'
						break outer
					}
					state.cursor = text(row._id)
					if (sinceCheckpoint >= CHECKPOINT_EVERY) await checkpoint()
				}
				if (rows.length < PAGE) {
					state.chunk += 1
					state.cursor = ''
				}
			}
			const elapsed = now() - started
			const final = state.phase === 'done'
			if (final) state.status = state.blocked_ids.length ? 'blocked' : state.review_total ? 'complete_with_review' : 'complete'
			await checkpoint({ lease_id: '', lease_until: 0, calls: (job.calls || 0) + 1,
				elapsed_ms_total: (job.elapsed_ms_total || 0) + elapsed, ...(final ? { completed_at: now() } : {}) })
			const completion = final ? state.status : stop === 'error' ? 'error' : 'partial'
			const out = view({ ...job, ...state, calls: (job.calls || 0) + 1, elapsed_ms_total: (job.elapsed_ms_total || 0) + elapsed },
				{ completion, processed_this_call: processed, advanced_this_call: processed + touched, elapsed_ms: elapsed })
			// This log cannot contain its own write latency. Name the observation
			// explicitly; end-to-end latency comes from the caller's per-call log.
			const wallBeforeLog = now() - started
			await recordLog(user, 'filling_start_loss_job_v1', {
				job_key: job._id, completion, phase: out.phase, date_from: out.date_from, bottle_total: out.bottle_total,
				processed_this_call: processed, elapsed_ms: elapsed, pre_log_elapsed_ms: wallBeforeLog, calls: out.calls, counts: out.counts,
				review_total: out.review_total, blocked_total: out.blocked_ids.length, row_error: out.row_error
			}, requestId)
			const wallElapsed = now() - started
			return { code: 0, msg: 'ok', data: { ...out, wall_elapsed_ms: wallElapsed } }
		} catch (error) {
			if (leaseLost) {
				return { code: 0, msg: 'ok', data: view(job, { completion: 'busy', processed_this_call: processed, elapsed_ms: now() - started }) }
			}
			// Unexpected failure outside a row (query/checkpoint): keep the last checkpoint and free the lease.
			await jobs.where({ _id: job._id, lease_id: lease }).update({ lease_id: '', lease_until: 0, updated_at: now() }).catch(() => {})
			throw error
		}
	}

	return { run, normalizeScope, phaseWhere }
}

module.exports = { createStartLossJobs, JOB_VERSION, JOBS, ROW_MAX_ATTEMPTS, LEASE_MS, MAX_MAX_MS, NON_CANONICAL_DATE }
