'use strict'

const { AsyncLocalStorage } = require('async_hooks')
const evidenceStorage = new AsyncLocalStorage()
const READ_VERSION = 'financial-read/2026-09-05.1'

class FinancialReadError extends Error {
	constructor(reason, evidence) {
		super('账务数据读取未完成或期间发生变化，请重试；本次未返回完整合计')
		this.code = 'FINANCIAL_READ_INCOMPLETE'
		this.details = { complete: false, reason, ...evidence }
	}
}

// Keyset pagination has a deterministic unique order. Counts detect membership changes;
// timestamps detect writes while this collection is read. This is not an MVCC snapshot.
async function readComplete(collection, where = {}, { command, field, maxRows = 100000,
	pageSize = 200, source = 'financial_collection', sort = [] } = {}) {
	const started = Date.now()
	const evidence = { source, read_started_at: started, read_version: READ_VERSION, rows: 0 }
	const before = await collection.where(where).count()
	if (!Number.isFinite(Number(before.total))) throw new FinancialReadError('count_unavailable', evidence)
	if (Number(before.total) > maxRows) throw new FinancialReadError('row_limit', { ...evidence, expected_rows: before.total, max_rows: maxRows })
	const rows = []; let cursor = ''; let ended = false
	while (rows.length <= maxRows) {
		const pageWhere = cursor ? command.and([where, { _id: command.gt(cursor) }]) : where
		let query = collection.where(pageWhere).orderBy('_id', 'asc').limit(Math.min(pageSize, maxRows + 1 - rows.length))
		if (field) query = query.field({ ...field, _id: true })
		const res = await query.get()
		if (!Array.isArray(res.data)) throw new FinancialReadError('invalid_page', evidence)
		const page = res.data
		for (const row of page) {
			const id = String(row._id || '')
			if (!id || (cursor && id <= cursor)) throw new FinancialReadError('nonadvancing_cursor', evidence)
			cursor = id; rows.push(row)
		}
		if (page.length < Math.min(pageSize, maxRows + 1 - (rows.length - page.length))) { ended = true; break }
		if (rows.length > maxRows) break
	}
	evidence.rows = rows.length
	if (!ended || rows.length > maxRows) throw new FinancialReadError('row_limit', { ...evidence, max_rows: maxRows })
	const after = await collection.where(where).count()
	if (Number(before.total) !== rows.length || Number(after.total) !== rows.length) throw new FinancialReadError('membership_changed', evidence)
	const changed = await collection.where(command.and([where, command.or([
		{ updated_at: command.gt(started) }, { created_at: command.gt(started) }
	])])).limit(1).get()
	if (!Array.isArray(changed.data) || changed.data.length) throw new FinancialReadError('records_changed_during_read', evidence)
	evidence.read_completed_at = Date.now(); evidence.complete = true
	const current = evidenceStorage.getStore()
	if (current) current.reads.push(evidence)
	if (sort.length) rows.sort((a, b) => {
		for (const key of [...sort, '_id']) {
			const left = a[key] == null ? '' : a[key]; const right = b[key] == null ? '' : b[key]
			if (left < right) return -1
			if (left > right) return 1
		}
		return 0
	})
	return rows
}

function withFinancialEvidence(handler, ruleVersion) {
	return async (event, context) => evidenceStorage.run({ started: Date.now(), reads: [] }, async () => {
		const evidence = evidenceStorage.getStore()
		try {
			const result = await handler(event, context)
			if (result && result.code === 0 && evidence.reads.length) result.financial_evidence = {
				complete: result.summary?.accounting_complete !== false && result.data?.accounting?.status !== 'unresolved',
				read_complete: true, consistency: 'live_read_non_atomic', snapshot_consistent: false,
				read_started_at: evidence.started, read_completed_at: Date.now(), rule_version: ruleVersion,
				read_version: READ_VERSION, reads: evidence.reads
			}
			return result
		} catch (error) {
			if (!['FINANCIAL_READ_INCOMPLETE', 'FINANCIAL_CLASSIFICATION_REQUIRED'].includes(error.code)) throw error
			return { code: 409, msg: error.message, error_code: error.code, data: {
				financial_evidence: { ...error.details, read_started_at: evidence.started, read_completed_at: Date.now(),
					rule_version: ruleVersion, snapshot_consistent: false, reads: evidence.reads }
			} }
		}
	})
}

module.exports = { READ_VERSION, FinancialReadError, readComplete, withFinancialEvidence }
