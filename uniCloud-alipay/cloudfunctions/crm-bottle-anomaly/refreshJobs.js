'use strict'

const crypto = require('crypto')
const COLLECTION = 'crm_bottle_anomaly_refresh_jobs'
const LEASE_MS = 120000
const RETRY_DELAYS = [60000, 120000, 240000, 480000, 900000]

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const jobKey = (userId, requestId, targets) => `refresh_${digest([userId, requestId, targets]).slice(0, 40)}`

function publicStatus(job) {
	return {
		job_id: job._id, status: job.status, done: job.status === 'complete',
		input_bottles: job.bottle_nos.length, input_trucks: job.truck_nos.length,
		scanned_bottles: job.scanned_bottles || 0, scanned_trucks: job.scanned_trucks || 0,
		round_scanned_events: job.round_scanned_events || 0,
		round_created: job.round_created || 0,
		round_resolved_stale: job.round_resolved_stale || 0,
		pending_total: job.targets.length - job.target_index,
		last_error: job.last_error || '', attempts: job.attempts || 0,
		updated_at: job.updated_at
	}
}

function createRefreshJobs({ db, scanBottle, scanTruck, now = Date.now }) {
	const collection = db.collection(COLLECTION)
	const get = async (id) => ((await collection.doc(id).get()).data || [])[0] || null
	const canRead = (user, job) => user && job &&
		(user._id === job.created_by || ['admin', 'superadmin'].includes(user.role))

	async function submit(user, requestId, bottleNos, truckNos) {
		const targets = [...bottleNos.map((no) => ({ kind: 'bottle', no })),
			...truckNos.map((no) => ({ kind: 'truck', no }))]
		if (!targets.length) return { code: 400, msg: 'bottle_nos 或 truck_nos 必填' }
		const id = jobKey(user._id, requestId, targets)
		let job = await get(id)
		if (!job) {
			const timestamp = now()
			try {
				await collection.add({ _id: id, request_id: requestId, targets, bottle_nos: bottleNos,
					truck_nos: truckNos, targets_hash: digest(targets), target_index: 0, scan_cursor: null,
					status: 'pending', lease_id: '', lease_until: 0, attempts: 0, next_retry_at: 0,
					scanned_bottles: 0, scanned_trucks: 0, round_scanned_events: 0,
					round_created: 0, round_resolved_stale: 0, last_error: '',
					created_by: user._id, created_by_name: user.username || '', created_role: user.role || '',
					created_at: timestamp, updated_at: timestamp })
			} catch (error) {
				job = await get(id)
				if (!job) throw error
			}
		}
		job = job || await get(id)
		if (job.targets_hash !== digest(targets) || job.created_by !== user._id) {
			return { code: 409, msg: '刷新任务编号对应的目标不一致' }
		}
		if (job.status === 'pending' && job.next_retry_at <= now()) job = await run(id, { maxMs: 2300 })
		return { code: 0, data: publicStatus(job) }
	}

	async function run(id, { maxMs = 35000 } = {}) {
		let job = await get(id)
		if (!job || !['pending', 'processing'].includes(job.status)) return job
		const leaseId = crypto.randomBytes(16).toString('hex')
		const acquired = await collection.where({ _id: id, status: db.command.in(['pending', 'processing']),
			lease_until: db.command.lte(now()), next_retry_at: db.command.lte(now()) })
			.update({ lease_id: leaseId, lease_until: now() + LEASE_MS, status: 'processing', updated_at: now() })
		if (!acquired.updated) return get(id)
		job = await get(id)
		const started = now()
		async function checkpoint(patch) {
			const changed = await collection.where({ _id: id, lease_id: leaseId,
				lease_until: db.command.gt(now()) }).update({ ...patch, updated_at: now() })
			if (!changed.updated) throw Object.assign(new Error('刷新任务租约失效'), { lostLease: true })
			job = { ...job, ...patch }
		}
		try {
			if (job.targets_hash !== digest(job.targets)) throw Object.assign(new Error('刷新任务目标摘要不一致'), { permanent: true })
			while (job.target_index < job.targets.length && now() - started < maxMs) {
				const target = job.targets[job.target_index]
				const actor = { _id: job.created_by, username: job.created_by_name, role: job.created_role }
				const scan = target.kind === 'truck' ? scanTruck : scanBottle
				const result = await scan(actor, target.no, job.scan_cursor, job.request_id)
				if (!result || result.code !== 0) throw new Error(result?.msg || '异常扫描未返回有效结果')
				const data = result.data || {}
				if (data.waiting_for_lock) break
				if (!data.done && !data.cursor) throw new Error('扫描未完成且缺少续扫位置')
				if (data.done && target.kind === 'bottle' && data.read_complete !== true) {
					throw new Error('扫描完成但缺少完整读取凭据')
				}
				await checkpoint({ target_index: job.target_index + (data.done ? 1 : 0),
					scan_cursor: data.done ? null : data.cursor,
					scanned_bottles: job.scanned_bottles + (data.done && target.kind === 'bottle' ? 1 : 0),
					scanned_trucks: job.scanned_trucks + (data.done && target.kind === 'truck' ? 1 : 0),
					round_scanned_events: job.round_scanned_events + Number(data.round_scanned_events || 0),
					round_created: job.round_created + Number(data.round_created || 0),
					round_resolved_stale: job.round_resolved_stale + Number(data.round_resolved_stale || 0),
					attempts: 0, last_error: '' })
		}
		await checkpoint({ status: job.target_index === job.targets.length ? 'complete' : 'pending',
				lease_id: '', lease_until: 0, ...(job.target_index === job.targets.length ? { completed_at: now() } : {}) })
		} catch (error) {
			if (!error.lostLease) {
				const attempts = Number(job.attempts || 0) + 1
				await checkpoint({ status: attempts >= 5 || error.permanent ? 'failed' : 'pending',
					attempts, last_error: String(error.message || error).slice(0, 500),
					next_retry_at: now() + RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)],
					lease_id: '', lease_until: 0 })
			}
		}
		return get(id)
	}

	async function status(user, id) {
		const job = await get(id)
		if (!job) return { code: 404, msg: '刷新任务不存在' }
		if (!canRead(user, job)) return { code: 403, msg: '无权查看该任务' }
		return { code: 0, data: publicStatus(job) }
	}

	async function retry(user, id) {
		if (!['admin', 'superadmin'].includes(user.role)) return { code: 403, msg: '仅管理员可重试刷新任务' }
		const job = await get(id)
		if (!job) return { code: 404, msg: '刷新任务不存在' }
		if (job.status === 'complete') return { code: 0, data: publicStatus(job) }
		const changed = await collection.where({ _id: id, lease_until: db.command.lte(now()) })
			.update({ status: 'pending', attempts: 0, next_retry_at: 0, last_error: '', updated_at: now() })
		if (!changed.updated) return { code: 409, msg: '任务正在处理，请稍后查询' }
		return { code: 0, data: publicStatus(await run(id, { maxMs: 2300 })) }
	}

	async function drain() {
		const started = now()
		const result = await collection.where({ status: db.command.in(['pending', 'processing']),
			lease_until: db.command.lte(now()), next_retry_at: db.command.lte(now()) })
			.orderBy('updated_at', 'asc').limit(10).get()
		if (!result || !Array.isArray(result.data)) throw new Error('待处理刷新任务读取失败')
		let processed = 0
		for (const job of result.data) {
			if (now() - started > 40000) break
			await run(job._id, { maxMs: Math.min(12000, 40000 - (now() - started)) })
			processed += 1
		}
		return { code: 0, data: { processed } }
	}

	return { submit, run, status, retry, drain }
}

module.exports = { createRefreshJobs, publicStatus, jobKey }
