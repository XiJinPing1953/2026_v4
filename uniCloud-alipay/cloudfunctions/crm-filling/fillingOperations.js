'use strict'

const crypto = require('crypto')
const COLLECTION = 'crm_filling_operations'
const VERSION = 'filling-consistency-2026-09-08-v2'
const LEASE_MS = 120000 // Longer than the configured 60 second function timeout.
const operationKey = (id) => `fillop_${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 40)}`
const stableValue = (value) => Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stableValue(value[key])])) : value
function fingerprint(data = {}) {
	const { operation_id, preview, ignore_bottle_flow_warning, ignoreBottleFlowWarning, ...input } = data
	return crypto.createHash('sha256').update(JSON.stringify(stableValue(input))).digest('hex')
}
function publicStatus(op) {
	const saved = Number(op.saved_cursor || 0)
	const targets = op.targets || []
	return {
		...op.summary, operation_id: op.operation_id, status: op.status,
		accepted_total: (op.rows || []).length, success: saved, saved_total: saved,
		pending_save_total: Math.max((op.rows || []).length - saved, 0),
		processed_total: Number(op.target_cursor || 0), target_total: targets.length,
		remaining_total: Math.max(targets.length - Number(op.target_cursor || 0), 0),
		complete: op.status === 'complete', rule_version: op.rule_version || '',
		last_transaction_ms: op.last_transaction_ms ?? null,
		created_at: op.created_at, updated_at: op.updated_at, attempts: op.attempts || 0,
		last_error: op.last_error || '', next_retry_at: op.next_retry_at || 0,
		...(op.rows && op.rows.length === 1 && saved > 0 ? { _id: op.rows[0]._id } : {})
	}
}
function response(op) {
	return { code: 0, msg: op.status === 'complete' ? '灌装保存及流转核查已完成' : op.status === 'failed'
		? '提交已受理，处理遇到问题，请查看处理状态' : '提交已受理，后台继续保存及核查流转', data: publicStatus(op) }
}
function canAccess(user, op) {
	return user && (String(user._id) === String(op.created_by) || ['superadmin', 'admin'].includes(user.role))
}
function createFillingOperations({ db, saveRow, synchronizeRow, scanTarget, now = Date.now }) {
	const operations = db.collection(COLLECTION)
	const get = async (id) => ((await operations.doc(operationKey(id)).get()).data || [])[0] || null
	async function existing(user, data) {
		if (!/^[A-Za-z0-9_-]{12,128}$/.test(String(data.operation_id || ''))) return { code: 400, msg: '缺少有效 operation_id，请升级客户端后重试' }
		const op = await get(data.operation_id)
		if (!op) return null
		if (!canAccess(user, op)) return { code: 403, msg: '无权访问该灌装操作' }
		if (op.input_hash !== fingerprint(data)) return { code: 409, msg: '同一操作编号不能用于不同内容，请重新建立提交' }
		return response(op)
	}
	async function submit(user, input, rows, targets, summary) {
		const old = await existing(user, input)
		if (old) return old
		const op = {
			_id: operationKey(input.operation_id), operation_id: input.operation_id, input_hash: fingerprint(input),
			created_by: user._id, created_by_name: user.username || '', actor_role: user.role || '',
			worker_secret: crypto.randomBytes(32).toString('hex'), rows,
			targets, summary, saved_cursor: 0, row_cursor: 0, target_cursor: 0, scan_cursor: null,
			status: 'pending', lease_id: '', lease_until: 0, attempts: 0, next_retry_at: 0,
			created_at: now(), updated_at: now(), rule_version: VERSION, last_error: ''
		}
		try { await operations.add(op) } catch (error) {
			const previous = await existing(user, input)
			if (previous) return previous
			throw error
		}
		// Processing only starts after the durable intent exists. No fire-and-forget promises.
		return response(await run(op.operation_id, { maxMs: 6000 }))
	}
	async function run(id, { maxMs = 40000, maxSteps = 200 } = {}) {
		let op = await get(id)
		if (!op || op.status === 'complete' || op.status === 'failed') return op
		const leaseId = crypto.randomBytes(16).toString('hex')
		const acquired = await operations.where({ _id: op._id, lease_until: db.command.lte(now()), status: db.command.in(['pending', 'processing']), next_retry_at: db.command.lte(now()) }).update({ lease_id: leaseId, lease_until: now() + LEASE_MS, status: 'processing', updated_at: now() })
		if (!acquired.updated) return get(id)
		op = await get(id)
		const started = now()
		let steps = 0
		const actor = { _id: op.created_by, username: op.created_by_name, role: op.actor_role }
		async function checkpoint(patch) {
			const result = await operations.where({ _id: op._id, lease_id: leaseId, lease_until: db.command.gt(now()) }).update({ ...patch, progress_version: db.command.inc(1), updated_at: now() })
			if (!result.updated) throw Object.assign(new Error('操作处理锁已失效'), { lostLease: true })
			op = { ...op, ...patch }
		}
		try {
			if (op.rule_version !== VERSION) throw Object.assign(new Error('操作处理版本与后台不一致，请核对部署后恢复'), { permanent: true })
			while (now() - started < maxMs && steps++ < maxSteps) {
				if (now() >= op.lease_until) throw Object.assign(new Error('操作处理锁已失效'), { lostLease: true })
				if (op.row_cursor < op.rows.length) {
					const row = op.rows[op.row_cursor]
					const saved = await saveRow(row, op, actor)
					await checkpoint({ saved_cursor: op.row_cursor + 1, ...(saved ? { last_transaction_ms: saved.transaction_ms } : {}) })
					await synchronizeRow(row, op, actor)
					await checkpoint({ row_cursor: op.row_cursor + 1, attempts: 0, last_error: '' })
				} else if (op.target_cursor < op.targets.length) {
					const result = await scanTarget(op.targets[op.target_cursor], op.scan_cursor, op, actor)
					if (!result || result.code !== 0) throw Object.assign(new Error(result && result.msg || '异常核查未返回有效结果'), { permanent: result && result.code === 409 })
					const data = result.data || {}
					if (!data.done && !data.cursor) throw new Error('异常核查未完成且缺少续扫位置')
					await checkpoint({ target_cursor: op.target_cursor + (data.done ? 1 : 0), scan_cursor: data.done ? null : data.cursor, attempts: 0, last_error: '' })
					if (data.waiting_for_lock) break
				} else {
					await checkpoint({ status: 'complete', completed_at: now(), lease_id: '', lease_until: 0 })
					return get(id)
				}
			}
			await checkpoint({ status: 'pending', lease_id: '', lease_until: 0 })
		} catch (error) {
			if (!error.lostLease) {
				const attempts = Number(op.attempts || 0) + 1
				await checkpoint({ status: attempts >= 5 || error.permanent ? 'failed' : 'pending', attempts,
					last_error: String(error.message || error).slice(0, 600),
					next_retry_at: now() + Math.min(60000 * 2 ** (attempts - 1), 900000), lease_id: '', lease_until: 0 })
			}
		}
		return get(id)
	}
	async function status(user, data) {
		const op = await get(data.operation_id)
		if (!op) return { code: 404, msg: '未找到该提交，可使用原操作编号重试提交' }
		if (!canAccess(user, op)) return { code: 403, msg: '无权访问该灌装操作' }
		const result = response(op)
		// Read by frozen IDs, including a committed row whose checkpoint acknowledgement was lost.
		const sourceRecords = []
		for (let offset = 0; offset < op.rows.length; offset += 50) {
			const expected = op.rows.slice(offset, offset + 50)
			const found = (await db.collection('crm_fillings').where({ _id: db.command.in(expected.map((row) => row._id)) }).limit(50).get()).data
			if (!Array.isArray(found)) throw new Error('源单保存状态读取失败')
			const byId = new Map(found.map((row) => [row._id, row]))
			for (const row of expected) {
				const source = byId.get(row._id)
				sourceRecords.push({ _id: row._id, bottle_no: row.bottle_no, saved: Boolean(source),
					source_version: source ? source.source_version : null,
					version_matches: Boolean(source && source.operation_id === op.operation_id && source.source_version === row.source_version && source.updated_at === row.updated_at),
					consistency_status: source ? source.consistency_status || '' : 'not_saved' })
			}
		}
		result.data.source_records = sourceRecords
		result.data.source_saved_total = sourceRecords.filter((row) => row.saved).length
		return result
	}
	async function retry(user, data) {
		const found = await status(user, data)
		if (found.code !== 0) return found
		const op = await get(data.operation_id)
		await operations.where({ _id: op._id, lease_until: db.command.lte(now()), status: db.command.neq('complete') }).update({ status: 'pending', attempts: 0, next_retry_at: 0, updated_at: now() })
		return response(await run(op.operation_id, { maxMs: 6000 }))
	}
	async function list(user) {
		const where = ['superadmin', 'admin'].includes(user.role) ? {} : { created_by: user._id }
		const pending = (await operations.where(db.command.and([where, { status: db.command.neq('complete') }])).orderBy('created_at', 'asc').limit(100).get()).data || []
		const complete = pending.length < 20
			? (await operations.where(db.command.and([where, { status: 'complete' }])).orderBy('created_at', 'desc').limit(20 - pending.length).get()).data || [] : []
		const rows = [...pending, ...complete]
		return { code: 0, data: rows.map(publicStatus) }
	}
	async function drain() {
		const started = now()
		const rows = (await operations.where({ status: db.command.in(['pending', 'processing']), lease_until: db.command.lte(now()), next_retry_at: db.command.lte(now()) }).orderBy('updated_at', 'asc').limit(10).get()).data || []
		let processed = 0
		for (const row of rows) {
			if (now() - started > 40000) break
			await run(row.operation_id, { maxMs: Math.min(12000, 40000 - (now() - started)) })
			processed += 1
		}
		return { code: 0, data: { processed } }
	}
	return { existing, submit, run, status, retry, list, drain, get }
}
module.exports = { COLLECTION, VERSION, operationKey, fingerprint, publicStatus, response, createFillingOperations }
