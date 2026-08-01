'use strict'

const crypto = require('crypto')

let aclHelpers = null
try {
	aclHelpers = require('../common/pageAcl')
} catch (error) {
	console.warn('[crm-station-safety-export] fallback to local pageAcl helpers', error?.message)
	aclHelpers = require('./pageAclLocal')
}

const { ensureActionAcl, isSuperAdmin } = aclHelpers
const {
	MAX_EXPORT_RECORDS,
	MAX_EXPORT_MEDIA,
	EXPORT_RETENTION_MS,
	normalizeString,
	resolveFilters,
	normalizeClientRequestId,
	collectInspectionMediaFileIds,
	collectHazardMediaFileIds,
	buildExportFileName,
	exportLimitMessage
} = require('./exportPolicy')
const { buildStationSafetyWorkbookBuffer } = require('./workbookBuilder')

const db = uniCloud.database()
const dbCmd = db.command
const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const inspections = db.collection('crm_station_safety_inspections')
const hazards = db.collection('crm_station_safety_hazards')
const jobs = db.collection('crm_station_safety_export_jobs')

const CLOUD_FUNCTION = 'crm-station-safety-export'
const EXPORT_PATH = '/pages/station-safety-inspection/export'
const WORKER_LEASE_MS = 11 * 60 * 1000
const PUBLIC_ACTIONS = new Set(['previewV1', 'createV1', 'getJobV1', 'listMineV1', 'resumeV1', 'getDownloadV1'])
const PAGE_ACTION_RULES = Object.fromEntries(Array.from(PUBLIC_ACTIONS).map((action) => [action, [{ pagePath: EXPORT_PATH, action: 'view' }]]))

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function randomToken() {
	return crypto.randomBytes(24).toString('hex')
}

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data || [])[0] || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (error) {
		console.error('[crm-station-safety-export] recordLog failed', action, error)
	}
}

function inspectionWhere(filters) {
	const conditions = []
	if (filters.scope !== 'all') {
		conditions.push({ inspection_at: dbCmd.gte(filters.start_at) })
		conditions.push({ inspection_at: dbCmd.lt(filters.end_at_exclusive) })
	}
	if (filters.inspection_result) conditions.push({ overall_result: filters.inspection_result })
	return conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)
}

async function listHazardsForInspections(inspectionIds, hazardStatus = '') {
	const rows = []
	for (let offset = 0; offset < inspectionIds.length; offset += 50) {
		const chunk = inspectionIds.slice(offset, offset + 50)
		if (!chunk.length) continue
		const conditions = [{ inspection_id: dbCmd.in(chunk) }]
		if (hazardStatus) conditions.push({ status: hazardStatus })
		const res = await hazards.where(conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)).limit(2000).get()
		rows.push(...(res.data || []))
	}
	return rows.sort((a, b) => Number(a.inspection_at || 0) - Number(b.inspection_at || 0) || normalizeString(a.hazard_no).localeCompare(normalizeString(b.hazard_no)))
}

function photoIdsForInspection(inspection = {}) {
	return (Array.isArray(inspection.items) ? inspection.items : []).flatMap((item) => Array.isArray(item?.photo_file_ids) ? item.photo_file_ids : [])
		.map(normalizeString).filter((fileId) => fileId.startsWith('cloud://'))
}

function photoIdsForHazard(hazard = {}) {
	return [hazard.inspection_photo_file_ids, hazard.rectification_photo_file_ids, hazard.verification_photo_file_ids]
		.flatMap((value) => Array.isArray(value) ? value : [])
		.map(normalizeString).filter((fileId) => fileId.startsWith('cloud://'))
}

function buildStats(rows, hazardRows, recordOverflow) {
	const mediaIds = new Set()
	const photoIds = new Set()
	let normalCount = 0
	let abnormalCount = 0
	for (const row of rows) {
		if (row.overall_result === 'abnormal') abnormalCount += 1
		else normalCount += 1
		collectInspectionMediaFileIds(row).forEach((id) => mediaIds.add(id))
		photoIdsForInspection(row).forEach((id) => photoIds.add(id))
	}
	for (const row of hazardRows) {
		collectHazardMediaFileIds(row).forEach((id) => mediaIds.add(id))
		photoIdsForHazard(row).forEach((id) => photoIds.add(id))
	}
	const limitMessage = recordOverflow
		? `当前范围超过 ${MAX_EXPORT_RECORDS} 张巡检单，请缩小日期范围`
		: exportLimitMessage(rows.length, mediaIds.size)
	return {
		record_count: rows.length,
		hazard_count: hazardRows.length,
		normal_count: normalCount,
		abnormal_count: abnormalCount,
		photo_count: photoIds.size,
		media_count: mediaIds.size,
		within_limit: !limitMessage,
		limit_message: limitMessage
	}
}

async function scan(filters) {
	const res = await inspections.where(inspectionWhere(filters)).orderBy('inspection_at', 'asc').limit(MAX_EXPORT_RECORDS + 1).get()
	const found = Array.isArray(res.data) ? res.data : []
	const recordOverflow = found.length > MAX_EXPORT_RECORDS
	const rows = found.slice(0, MAX_EXPORT_RECORDS)
	const hazardRows = await listHazardsForInspections(rows.map((row) => row._id), filters.hazard_status)
	return { rows, hazardRows, stats: buildStats(rows, hazardRows, recordOverflow) }
}

function publicJob(job = {}) {
	return {
		_id: job._id,
		scope: job.scope || 'range',
		start_date: job.start_date || '',
		end_date: job.end_date || '',
		inspection_result: job.inspection_result || '',
		hazard_status: job.hazard_status || '',
		status: job.status || '',
		total_count: Number(job.total_count || 0),
		hazard_count: Number(job.hazard_count || 0),
		photo_count: Number(job.photo_count || 0),
		media_count: Number(job.media_count || 0),
		missing_file_count: Number(job.missing_file_count || 0),
		file_name: job.file_name || '',
		error_message: job.error_message || '',
		created_at: Number(job.created_at || 0),
		updated_at: Number(job.updated_at || 0),
		expires_at: Number(job.expires_at || 0),
		can_download: job.status === 'ready' && Number(job.expires_at || 0) > Date.now(),
		can_resume: job.status === 'failed'
	}
}

async function previewV1(data) {
	const resolved = resolveFilters(data)
	if (!resolved.ok) return { code: 400, msg: resolved.msg }
	const result = await scan(resolved.data)
	return { code: 0, data: { ...resolved.data, ...result.stats } }
}

async function triggerWorker(jobId, workerToken) {
	const promise = uniCloud.callFunction({ name: CLOUD_FUNCTION, data: { action: 'workerV1', data: { job_id: jobId, worker_token: workerToken } } })
	promise.catch((error) => console.error('[station-safety-export] worker trigger failed', jobId, error))
	await new Promise((resolve) => setTimeout(resolve, 350))
}

function sameFilters(job, filters) {
	return ['scope', 'start_date', 'end_date', 'inspection_result', 'hazard_status'].every((key) => normalizeString(job?.[key]) === normalizeString(filters?.[key]))
}

async function createV1(user, data, requestId) {
	const clientRequestId = normalizeClientRequestId(data.client_request_id ?? data.clientRequestId)
	if (!clientRequestId) return { code: 400, msg: '导出请求标识无效，请刷新页面后重试' }
	const resolved = resolveFilters(data)
	if (!resolved.ok) return { code: 400, msg: resolved.msg }
	const existingRes = await jobs.where({ created_by: normalizeString(user?._id), client_request_id: clientRequestId }).limit(1).get()
	const existing = (existingRes.data || [])[0]
	if (existing) {
		if (!sameFilters(existing, resolved.data)) return { code: 409, msg: '该请求标识已用于其他导出范围' }
		if (['queued', 'processing'].includes(existing.status) && Number(existing.lease_until || 0) <= Date.now()) await triggerWorker(existing._id, existing.worker_token)
		return { code: 0, msg: '导出任务已存在', data: publicJob(existing) }
	}
	const result = await scan(resolved.data)
	if (!result.rows.length) return { code: 404, msg: '当前范围内没有可导出的巡检记录' }
	if (!result.stats.within_limit) return { code: 400, msg: result.stats.limit_message }
	const now = Date.now()
	const workerToken = randomToken()
	const doc = {
		client_request_id: clientRequestId,
		...resolved.data,
		inspection_ids: result.rows.map((row) => row._id),
		status: 'queued',
		total_count: result.stats.record_count,
		hazard_count: result.stats.hazard_count,
		photo_count: result.stats.photo_count,
		media_count: result.stats.media_count,
		missing_file_count: 0,
		file_id: '',
		cloud_path: '',
		file_name: buildExportFileName(resolved.data, result.rows.length),
		error_message: '',
		worker_token: workerToken,
		lease_until: 0,
		created_by: normalizeString(user?._id),
		created_by_name: normalizeString(user?.username),
		created_at: now,
		updated_at: now,
		expires_at: now + EXPORT_RETENTION_MS
	}
	let jobId = ''
	try {
		const addRes = await jobs.add(doc)
		jobId = addRes.id
	} catch (error) {
		const retryRes = await jobs.where({ created_by: normalizeString(user?._id), client_request_id: clientRequestId }).limit(1).get()
		const retry = (retryRes.data || [])[0]
		if (retry) return { code: 0, msg: '导出任务已存在', data: publicJob(retry) }
		throw error
	}
	await recordLog(user, 'station_safety_export_create_v1', {
		job_id: jobId,
		record_count: result.stats.record_count,
		hazard_count: result.stats.hazard_count,
		media_count: result.stats.media_count,
		start_date: resolved.data.start_date,
		end_date: resolved.data.end_date
	}, requestId)
	await triggerWorker(jobId, workerToken)
	return { code: 0, msg: '导出任务已开始', data: publicJob({ _id: jobId, ...doc }) }
}

async function getOwnedJob(user, jobId) {
	const id = normalizeString(jobId)
	if (!id) return null
	const res = await jobs.doc(id).get()
	const job = (res.data || [])[0] || null
	if (!job) return null
	if (!isSuperAdmin(user) && normalizeString(job.created_by) !== normalizeString(user?._id)) return null
	return job
}

async function deleteCloudFile(fileId) {
	if (!normalizeString(fileId).startsWith('cloud://')) return
	try { await uniCloud.deleteFile({ fileList: [fileId] }) } catch (error) { console.warn('[station-safety-export] cleanup failed', error?.message) }
}

async function expireJob(job) {
	await deleteCloudFile(job.file_id)
	await jobs.doc(job._id).update({ status: 'expired', file_id: '', cloud_path: '', lease_until: 0, updated_at: Date.now() })
}

async function cleanupExpiredJobs() {
	const res = await jobs.where({ expires_at: dbCmd.lte(Date.now()), status: dbCmd.neq('expired') }).limit(3).get()
	for (const job of res.data || []) await expireJob(job)
}

async function getJobV1(user, data) {
	const job = await getOwnedJob(user, data.job_id ?? data.jobId ?? data._id)
	if (!job) return { code: 404, msg: '导出任务不存在' }
	if (Number(job.expires_at || 0) <= Date.now() && job.status !== 'expired') {
		await expireJob(job)
		job.status = 'expired'
	}
	if (['queued', 'processing'].includes(job.status) && Number(job.lease_until || 0) <= Date.now()) await triggerWorker(job._id, job.worker_token)
	return { code: 0, data: publicJob(job) }
}

async function listMineV1(user, data) {
	const limit = Math.min(Math.max(Number(data.limit || 10) || 10, 1), 20)
	const where = isSuperAdmin(user) && normalizeString(data.owner_id) ? { created_by: normalizeString(data.owner_id) } : { created_by: normalizeString(user?._id) }
	const res = await jobs.where(where).orderBy('created_at', 'desc').limit(limit).get()
	return { code: 0, data: (res.data || []).map(publicJob) }
}

async function resumeV1(user, data) {
	const job = await getOwnedJob(user, data.job_id ?? data.jobId)
	if (!job) return { code: 404, msg: '导出任务不存在' }
	if (Number(job.expires_at || 0) <= Date.now()) return { code: 410, msg: '导出任务已过期，请重新创建' }
	if (job.status === 'ready') return { code: 0, msg: '导出文件已经生成', data: publicJob(job) }
	await jobs.doc(job._id).update({ status: 'queued', error_message: '', lease_until: 0, updated_at: Date.now() })
	await triggerWorker(job._id, job.worker_token)
	return { code: 0, msg: '已恢复导出任务', data: publicJob({ ...job, status: 'queued', error_message: '' }) }
}

async function getDownloadV1(user, data, requestId) {
	const job = await getOwnedJob(user, data.job_id ?? data.jobId)
	if (!job) return { code: 404, msg: '导出任务不存在' }
	if (Number(job.expires_at || 0) <= Date.now()) {
		await expireJob(job)
		return { code: 410, msg: '导出文件已过期，请重新生成' }
	}
	if (job.status !== 'ready' || !normalizeString(job.file_id)) return { code: 409, msg: '导出文件尚未生成完成' }
	const urlRes = await uniCloud.getTempFileURL({ fileList: [job.file_id] })
	const item = (urlRes.fileList || [])[0] || {}
	const tempUrl = normalizeString(item.tempFileURL || item.tempFileUrl)
	if (!tempUrl) return { code: 500, msg: '临时下载地址生成失败' }
	await recordLog(user, 'station_safety_export_download_v1', { job_id: job._id, record_count: job.total_count, hazard_count: job.hazard_count }, requestId)
	return { code: 0, data: { job_id: job._id, file_name: job.file_name, temp_url: tempUrl, expires_at: job.expires_at } }
}

async function downloadCloudFile(fileId, attempts = 3) {
	let lastError = null
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const result = await uniCloud.downloadFile({ fileID: fileId })
			if (Buffer.isBuffer(result?.fileContent)) return result.fileContent
			if (result?.fileContent) return Buffer.from(result.fileContent)
			throw new Error('云文件内容为空')
		} catch (error) { lastError = error }
	}
	throw lastError || new Error('云文件下载失败')
}

async function prepareMedia(fileIds) {
	const sharp = require('sharp')
	const result = {}
	for (let offset = 0; offset < fileIds.length; offset += 8) {
		const chunk = fileIds.slice(offset, offset + 8)
		await Promise.all(chunk.map(async (fileId) => {
			try {
				const source = await downloadCloudFile(fileId)
				const buffer = await sharp(source).rotate().resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer()
				result[fileId] = { buffer, extension: 'jpeg' }
			} catch (error) { result[fileId] = { error: normalizeString(error?.message) || '图片读取失败' } }
		}))
	}
	return result
}

async function loadJobData(job) {
	const ids = Array.isArray(job.inspection_ids) ? job.inspection_ids.map(normalizeString).filter(Boolean) : []
	const byId = new Map()
	for (let offset = 0; offset < ids.length; offset += 50) {
		const chunk = ids.slice(offset, offset + 50)
		const res = await inspections.where({ _id: dbCmd.in(chunk) }).limit(chunk.length).get()
		for (const row of res.data || []) byId.set(normalizeString(row._id), row)
	}
	const inspectionRows = ids.map((id) => byId.get(id)).filter(Boolean)
	if (inspectionRows.length !== ids.length) throw new Error('部分巡检单已不存在，请重新创建导出任务')
	const hazardRows = await listHazardsForInspections(ids, job.hazard_status)
	return { inspectionRows, hazardRows }
}

async function acquireWorkerLease(jobId, workerToken) {
	const now = Date.now()
	const result = await jobs.where(dbCmd.and([
		{ _id: jobId },
		{ worker_token: workerToken },
		{ status: dbCmd.in(['queued', 'processing']) },
		{ lease_until: dbCmd.lte(now) }
	])).updateAndReturn({ status: 'processing', lease_until: now + WORKER_LEASE_MS, updated_at: now })
	return result?.doc || null
}

async function workerV1(data) {
	const jobId = normalizeString(data.job_id ?? data.jobId)
	const workerToken = normalizeString(data.worker_token ?? data.workerToken)
	if (!jobId || !workerToken) return { code: 403, msg: '导出任务凭证无效' }
	const job = await acquireWorkerLease(jobId, workerToken)
	if (!job) return { code: 0, msg: '导出任务正在由其他实例处理' }
	try {
		if (Number(job.expires_at || 0) <= Date.now()) {
			await expireJob(job)
			return { code: 410, msg: '导出任务已过期' }
		}
		const { inspectionRows, hazardRows } = await loadJobData(job)
		const photoIds = Array.from(new Set([
			...inspectionRows.flatMap(photoIdsForInspection),
			...hazardRows.flatMap(photoIdsForHazard)
		]))
		const mediaByFileId = await prepareMedia(photoIds)
		const workbook = await buildStationSafetyWorkbookBuffer({ inspections: inspectionRows, hazards: hazardRows, mediaByFileId })
		const cloudPath = `station-safety-inspection/exports/${job._id}/${job.file_name}`
		const uploadRes = await uniCloud.uploadFile({ cloudPath, fileContent: workbook.buffer })
		if (!normalizeString(uploadRes?.fileID)) throw new Error('Excel 上传失败')
		await jobs.doc(job._id).update({
			status: 'ready',
			file_id: uploadRes.fileID,
			cloud_path: cloudPath,
			missing_file_count: workbook.missingFileCount,
			error_message: '',
			lease_until: 0,
			updated_at: Date.now()
		})
		return { code: 0, msg: '导出文件生成完成' }
	} catch (error) {
		await jobs.doc(job._id).update({ status: 'failed', error_message: normalizeString(error?.message) || '导出任务失败', lease_until: 0, updated_at: Date.now() })
		console.error('[station-safety-export] worker failed', job._id, error)
		return { code: 500, msg: normalizeString(error?.message) || '导出任务失败' }
	}
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event || {}
	const requestId = normalizeString(event?.request_id || event?.requestId || context?.requestId) || generateRequestId()
	if (action === 'workerV1') return workerV1(data)
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, [], { recordLog, requestId, cloudFunction: CLOUD_FUNCTION })
	if (!acl.ok) return { code: acl.code, msg: acl.msg }
	if (!PUBLIC_ACTIONS.has(action)) return { code: 400, msg: '未知 action' }
	try {
		if (action === 'createV1' || action === 'listMineV1') await cleanupExpiredJobs()
		if (action === 'previewV1') return previewV1(data)
		if (action === 'createV1') return createV1(user, data, requestId)
		if (action === 'getJobV1') return getJobV1(user, data)
		if (action === 'listMineV1') return listMineV1(user, data)
		if (action === 'resumeV1') return resumeV1(user, data)
		if (action === 'getDownloadV1') return getDownloadV1(user, data, requestId)
		return { code: 400, msg: '未知 action' }
	} catch (error) {
		console.error('[crm-station-safety-export] main failed', action, error)
		return { code: 500, msg: error?.message || '厂站巡检导出服务异常' }
	}
}
