'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

let aclHelpers = null
try {
	aclHelpers = require('../common/pageAcl')
} catch (error) {
	console.warn('[crm-home-safety-export] fallback to local pageAcl helpers', error?.message)
	aclHelpers = require('./pageAclLocal')
}

const { ensureActionAcl, isSuperAdmin } = aclHelpers
const {
	MAX_EXPORT_RECORDS,
	MAX_EXPORT_PHOTOS,
	EXPORT_RETENTION_MS,
	normalizeString,
	resolveDateRange,
	normalizeClientRequestId,
	collectInspectionPhotoFileIds,
	collectInspectionMediaFileIds,
	buildInspectionXlsxFileName,
	buildExportZipFileName,
	exportLimitMessage
} = require('./exportPolicy')
const { buildInspectionWorkbookBuffer } = require('./workbookBuilder')

const db = uniCloud.database()
const dbCmd = db.command
const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const customers = db.collection('crm_customers')
const inspections = db.collection('crm_home_safety_inspections')
const jobs = db.collection('crm_home_safety_export_jobs')
const jobItems = db.collection('crm_home_safety_export_items')

const CLOUD_FUNCTION = 'crm-home-safety-export'
const EXPORT_PATH = '/pages/home-safety-inspection/export'
const WORKER_LEASE_MS = 115 * 1000
const PUBLIC_ACTIONS = new Set(['previewV1', 'createV1', 'getJobV1', 'listMineV1', 'resumeV1', 'getDownloadV1'])
const PAGE_ACTION_RULES = Object.fromEntries(
	Array.from(PUBLIC_ACTIONS).map((action) => [action, [{ pagePath: EXPORT_PATH, action: 'view' }]])
)

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function randomToken() {
	return crypto.randomBytes(24).toString('hex')
}

function isDuplicateKeyError(error) {
	const message = normalizeString(error?.message).toLowerCase()
	return message.includes('duplicate key') || message.includes('e11000')
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
		console.error('[crm-home-safety-export] recordLog failed', action, error)
	}
}

function rangeWhere(range) {
	if (range.scope === 'all') return {}
	return dbCmd.and([
		{ inspection_at: dbCmd.gte(range.start_at) },
		{ inspection_at: dbCmd.lt(range.end_at_exclusive) }
	])
}

async function listVisibleCustomerIds(ids = []) {
	const unique = Array.from(new Set(ids.map(normalizeString).filter(Boolean)))
	const visible = new Set()
	for (let offset = 0; offset < unique.length; offset += 100) {
		const chunk = unique.slice(offset, offset + 100)
		const res = await customers
			.where(dbCmd.and([{ is_hidden: dbCmd.neq(true) }, { _id: dbCmd.in(chunk) }]))
			.field({ _id: true })
			.limit(chunk.length)
			.get()
		for (const customer of res.data || []) visible.add(normalizeString(customer._id))
	}
	return visible
}

async function getVisibleCustomer(customerId) {
	const id = normalizeString(customerId)
	if (!id) return null
	const res = await customers
		.where(dbCmd.and([{ is_hidden: dbCmd.neq(true) }, { _id: id }]))
		.field({ _id: true })
		.limit(1)
		.get()
	return (res.data || [])[0] || null
}

function buildStats(rows, overflow = false) {
	let normalCount = 0
	let abnormalCount = 0
	let photoCount = 0
	for (const row of rows) {
		if (row.overall_result === 'abnormal') abnormalCount += 1
		else normalCount += 1
		photoCount += collectInspectionPhotoFileIds(row).length
	}
	const limitMessage = exportLimitMessage(rows.length, photoCount)
	return {
		record_count: rows.length,
		normal_count: normalCount,
		abnormal_count: abnormalCount,
		photo_count: photoCount,
		customer_count: new Set(rows.map((row) => normalizeString(row.customer_id)).filter(Boolean)).size,
		within_limit: !overflow && !limitMessage,
		limit_message: overflow && rows.length <= MAX_EXPORT_RECORDS
			? `当前范围数据量过大，请缩小日期范围`
			: limitMessage
	}
}

async function scanVisibleInspections(range) {
	const rows = []
	let offset = 0
	let overflow = false
	let photoCount = 0
	while (!overflow) {
		const res = await inspections
			.where(rangeWhere(range))
			.orderBy('inspection_at', 'asc')
			.skip(offset)
			.limit(100)
			.get()
		const page = Array.isArray(res.data) ? res.data : []
		if (!page.length) break
		const visibleCustomerIds = await listVisibleCustomerIds(page.map((row) => row.customer_id))
		for (const row of page) {
			if (!visibleCustomerIds.has(normalizeString(row.customer_id))) continue
			rows.push(row)
			photoCount += collectInspectionPhotoFileIds(row).length
			if (rows.length > MAX_EXPORT_RECORDS || photoCount > MAX_EXPORT_PHOTOS) {
				overflow = true
				break
			}
		}
		offset += page.length
		if (page.length < 100) break
	}
	return { rows, stats: buildStats(rows, overflow), overflow }
}

function publicJob(job = {}) {
	return {
		_id: job._id,
		scope: job.scope || 'range',
		start_date: job.start_date || '',
		end_date: job.end_date || '',
		status: job.status || '',
		total_count: Number(job.total_count || 0),
		processed_count: Number(job.processed_count || 0),
		normal_count: Number(job.normal_count || 0),
		abnormal_count: Number(job.abnormal_count || 0),
		photo_count: Number(job.photo_count || 0),
		missing_file_count: Number(job.missing_file_count || 0),
		zip_file_name: job.zip_file_name || '',
		error_message: job.error_message || '',
		created_at: Number(job.created_at || 0),
		updated_at: Number(job.updated_at || 0),
		expires_at: Number(job.expires_at || 0),
		can_download: job.status === 'ready' && Number(job.expires_at || 0) > Date.now(),
		can_resume: job.status === 'failed'
	}
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

async function previewV1(data) {
	const rangeResult = resolveDateRange(data)
	if (!rangeResult.ok) return { code: 400, msg: rangeResult.msg }
	const scan = await scanVisibleInspections(rangeResult.data)
	return { code: 0, data: { ...rangeResult.data, ...scan.stats } }
}

async function triggerWorker(jobId, workerToken) {
	const promise = uniCloud.callFunction({
		name: CLOUD_FUNCTION,
		data: {
			action: 'workerV1',
			data: { job_id: jobId, worker_token: workerToken }
		}
	})
	promise.catch((error) => console.error('[inspection-export] worker trigger failed', jobId, error))
	await new Promise((resolve) => setTimeout(resolve, 350))
}

function sameRange(job, range) {
	return job?.scope === range.scope &&
		normalizeString(job?.start_date) === range.start_date &&
		normalizeString(job?.end_date) === range.end_date
}

async function createV1(user, data, requestId) {
	const clientRequestId = normalizeClientRequestId(data.client_request_id ?? data.clientRequestId)
	if (!clientRequestId) return { code: 400, msg: '导出请求标识无效，请刷新页面后重试' }
	const rangeResult = resolveDateRange(data)
	if (!rangeResult.ok) return { code: 400, msg: rangeResult.msg }
	const existingRes = await jobs
		.where({ created_by: normalizeString(user?._id), client_request_id: clientRequestId })
		.limit(1)
		.get()
	const existing = (existingRes.data || [])[0]
	if (existing) {
		if (!sameRange(existing, rangeResult.data)) return { code: 409, msg: '该请求标识已用于其他导出范围' }
		if (['queued', 'processing', 'packaging'].includes(existing.status) && Number(existing.lease_until || 0) <= Date.now()) {
			await triggerWorker(existing._id, existing.worker_token)
		}
		return { code: 0, msg: '导出任务已存在', data: publicJob(existing) }
	}

	const scan = await scanVisibleInspections(rangeResult.data)
	if (!scan.rows.length) return { code: 404, msg: '当前时间范围内没有可导出的巡检记录' }
	if (!scan.stats.within_limit) return { code: 400, msg: scan.stats.limit_message || '导出范围过大，请缩小日期范围' }
	const missingNumber = scan.rows.find((row) => !normalizeString(row.inspection_no))
	if (missingNumber) return { code: 409, msg: '存在尚未分配编号的巡检单，请先由超级管理员执行编号回填' }

	const now = Date.now()
	const workerToken = randomToken()
	const zipFileName = buildExportZipFileName(rangeResult.data, scan.rows.length)
	const jobDoc = {
		client_request_id: clientRequestId,
		...rangeResult.data,
		status: 'queued',
		total_count: scan.rows.length,
		processed_count: 0,
		normal_count: scan.stats.normal_count,
		abnormal_count: scan.stats.abnormal_count,
		photo_count: scan.stats.photo_count,
		missing_file_count: 0,
		customer_ids: Array.from(new Set(scan.rows.map((row) => normalizeString(row.customer_id)).filter(Boolean))),
		zip_file_id: '',
		zip_cloud_path: '',
		zip_file_name: zipFileName,
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
		const addRes = await jobs.add(jobDoc)
		jobId = addRes.id
		const itemDocs = scan.rows.map((inspection, index) => ({
			job_id: jobId,
			inspection_id: inspection._id,
			customer_id: inspection.customer_id,
			sequence: index + 1,
			inspection_no: inspection.inspection_no,
			status: 'pending',
			xlsx_file_id: '',
			xlsx_cloud_path: '',
			xlsx_file_name: buildInspectionXlsxFileName(inspection),
			missing_file_count: 0,
			error_message: '',
			created_at: now,
			updated_at: now
		}))
		for (let offset = 0; offset < itemDocs.length; offset += 50) {
			await jobItems.add(itemDocs.slice(offset, offset + 50))
		}
	} catch (error) {
		if (isDuplicateKeyError(error)) {
			const retry = await jobs
				.where({ created_by: normalizeString(user?._id), client_request_id: clientRequestId })
				.limit(1)
				.get()
			const found = (retry.data || [])[0]
			if (found) return { code: 0, msg: '导出任务已存在', data: publicJob(found) }
		}
		console.error('[inspection-export] create failed', error)
		return { code: 500, msg: '导出任务创建失败' }
	}

	await recordLog(
		user,
		'home_safety_inspection_export_create_v1',
		{
			job_id: jobId,
			scope: rangeResult.data.scope,
			start_date: rangeResult.data.start_date,
			end_date: rangeResult.data.end_date,
			record_count: scan.rows.length,
			photo_count: scan.stats.photo_count
		},
		requestId
	)
	await triggerWorker(jobId, workerToken)
	return { code: 0, msg: '导出任务已开始', data: publicJob({ _id: jobId, ...jobDoc }) }
}

async function getJobV1(user, data) {
	const job = await getOwnedJob(user, data.job_id ?? data.jobId ?? data._id)
	if (!job) return { code: 404, msg: '导出任务不存在' }
	if (Number(job.expires_at || 0) <= Date.now() && job.status !== 'expired') {
		await expireJob(job)
		job.status = 'expired'
	}
	if (['queued', 'processing', 'packaging'].includes(job.status) && Number(job.lease_until || 0) <= Date.now()) {
		await triggerWorker(job._id, job.worker_token)
	}
	return { code: 0, data: publicJob(job) }
}

async function listMineV1(user, data) {
	const limit = Math.min(Math.max(Number(data.limit || 10) || 10, 1), 20)
	const where = isSuperAdmin(user) && normalizeString(data.owner_id)
		? { created_by: normalizeString(data.owner_id) }
		: { created_by: normalizeString(user?._id) }
	const res = await jobs.where(where).orderBy('created_at', 'desc').limit(limit).get()
	return { code: 0, data: (res.data || []).map(publicJob) }
}

async function resumeV1(user, data) {
	const job = await getOwnedJob(user, data.job_id ?? data.jobId)
	if (!job) return { code: 404, msg: '导出任务不存在' }
	if (Number(job.expires_at || 0) <= Date.now()) return { code: 410, msg: '导出任务已过期，请重新创建' }
	if (job.status === 'ready') return { code: 0, msg: '导出文件已经生成', data: publicJob(job) }
	if (job.status === 'stale') return { code: 409, msg: '客户显隐状态已变化，请重新创建导出任务' }
	await jobItems.where({ job_id: job._id, status: 'failed' }).update({
		status: 'pending',
		error_message: '',
		updated_at: Date.now()
	})
	await jobs.doc(job._id).update({ status: 'processing', error_message: '', lease_until: 0, updated_at: Date.now() })
	await triggerWorker(job._id, job.worker_token)
	return { code: 0, msg: '已恢复导出任务', data: publicJob({ ...job, status: 'processing', error_message: '' }) }
}

async function deleteCloudFiles(fileIds = []) {
	const normalized = Array.from(new Set(fileIds.map(normalizeString).filter((fileId) => fileId.startsWith('cloud://'))))
	if (!normalized.length) return
	try {
		await uniCloud.deleteFile({ fileList: normalized })
	} catch (error) {
		console.warn('[inspection-export] delete files failed', error?.message)
	}
}

async function expireJob(job) {
	const itemRes = await jobItems.where({ job_id: job._id }).field({ xlsx_file_id: true }).limit(MAX_EXPORT_RECORDS).get()
	await deleteCloudFiles([
		job.zip_file_id,
		...(itemRes.data || []).map((item) => item.xlsx_file_id)
	])
	await jobs.doc(job._id).update({
		status: 'expired',
		zip_file_id: '',
		zip_cloud_path: '',
		lease_until: 0,
		updated_at: Date.now()
	})
}

async function cleanupExpiredJobs() {
	try {
		const res = await jobs.where({ expires_at: dbCmd.lte(Date.now()), status: dbCmd.neq('expired') }).limit(3).get()
		for (const job of res.data || []) await expireJob(job)
	} catch (error) {
		console.warn('[inspection-export] cleanup failed', error?.message)
	}
}

async function getDownloadV1(user, data, requestId) {
	const job = await getOwnedJob(user, data.job_id ?? data.jobId)
	if (!job) return { code: 404, msg: '导出任务不存在' }
	if (Number(job.expires_at || 0) <= Date.now()) {
		await expireJob(job)
		return { code: 410, msg: '导出文件已过期，请重新生成' }
	}
	if (job.status !== 'ready' || !normalizeString(job.zip_file_id)) return { code: 409, msg: '导出文件尚未生成完成' }
	const visibleIds = await listVisibleCustomerIds(job.customer_ids || [])
	if (visibleIds.size !== new Set(job.customer_ids || []).size) {
		await jobs.doc(job._id).update({
			status: 'stale',
			error_message: '客户显隐状态已变化，请重新生成',
			updated_at: Date.now()
		})
		await deleteCloudFiles([job.zip_file_id])
		return { code: 409, msg: '客户显隐状态已变化，请重新生成导出文件' }
	}
	const urlRes = await uniCloud.getTempFileURL({ fileList: [job.zip_file_id] })
	const item = (urlRes.fileList || [])[0] || {}
	const tempUrl = normalizeString(item.tempFileURL || item.tempFileUrl)
	if (!tempUrl) return { code: 500, msg: '临时下载地址生成失败' }
	await recordLog(
		user,
		'home_safety_inspection_export_download_v1',
		{ job_id: job._id, record_count: job.total_count, start_date: job.start_date, end_date: job.end_date },
		requestId
	)
	return {
		code: 0,
		data: { job_id: job._id, file_name: job.zip_file_name, temp_url: tempUrl, expires_at: job.expires_at }
	}
}

async function downloadCloudFile(fileId, attempts = 3) {
	let lastError = null
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const res = await uniCloud.downloadFile({ fileID: fileId })
			const content = res?.fileContent
			if (Buffer.isBuffer(content)) return content
			if (content) return Buffer.from(content)
			throw new Error('云文件内容为空')
		} catch (error) {
			lastError = error
		}
	}
	throw lastError || new Error('云文件下载失败')
}

async function prepareInspectionMedia(inspection) {
	const sharp = require('sharp')
	const mediaByFileId = {}
	for (const fileId of collectInspectionMediaFileIds(inspection)) {
		try {
			const source = await downloadCloudFile(fileId, 3)
			const buffer = await sharp(source)
				.rotate()
				.resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
				.jpeg({ quality: 75, mozjpeg: true })
				.toBuffer()
			mediaByFileId[fileId] = { buffer, extension: 'jpeg' }
		} catch (error) {
			mediaByFileId[fileId] = { error: normalizeString(error?.message) || '图片读取失败' }
		}
	}
	return mediaByFileId
}

async function generateInspectionFile(job, item) {
	const inspectionRes = await inspections.doc(item.inspection_id).get()
	const inspection = (inspectionRes.data || [])[0]
	if (!inspection) throw new Error('巡检单不存在')
	if (!(await getVisibleCustomer(inspection.customer_id))) {
		const staleError = new Error('客户已隐藏，导出任务需要重新生成')
		staleError.code = 'STALE_CUSTOMER'
		throw staleError
	}
	const mediaByFileId = await prepareInspectionMedia(inspection)
	const workbook = await buildInspectionWorkbookBuffer({ inspection, mediaByFileId })
	const xlsxFileName = buildInspectionXlsxFileName(inspection)
	const cloudPath = `home-safety-inspection/exports/${job._id}/xlsx/${String(item.sequence).padStart(4, '0')}-${xlsxFileName}`
	const uploadRes = await uniCloud.uploadFile({ cloudPath, fileContent: workbook.buffer })
	if (!normalizeString(uploadRes?.fileID)) throw new Error('Excel 上传失败')
	return {
		fileId: uploadRes.fileID,
		cloudPath,
		fileName: xlsxFileName,
		missingFileCount: workbook.missingFileCount
	}
}

async function packageJob(job) {
	const archiver = require('archiver')
	const itemRes = await jobItems
		.where({ job_id: job._id, status: 'generated' })
		.orderBy('sequence', 'asc')
		.limit(MAX_EXPORT_RECORDS)
		.get()
	const items = itemRes.data || []
	if (items.length !== Number(job.total_count || 0)) throw new Error('生成的 Excel 数量不完整')
	const temporaryPath = path.join('/tmp', `${job._id}.zip`)
	if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
	await new Promise(async (resolve, reject) => {
		const output = fs.createWriteStream(temporaryPath)
		const archive = archiver('zip', { zlib: { level: 6 } })
		output.on('close', resolve)
		output.on('error', reject)
		archive.on('warning', (error) => error.code === 'ENOENT' ? console.warn(error) : reject(error))
		archive.on('error', reject)
		archive.pipe(output)
		try {
			for (const item of items) {
				const buffer = await downloadCloudFile(item.xlsx_file_id, 3)
				archive.append(buffer, { name: item.xlsx_file_name })
			}
			await archive.finalize()
		} catch (error) {
			reject(error)
		}
	})
	const cloudPath = `home-safety-inspection/exports/${job._id}/${job.zip_file_name}`
	const uploadRes = await uniCloud.uploadFile({
		cloudPath,
		fileContent: fs.createReadStream(temporaryPath)
	})
	try {
		fs.unlinkSync(temporaryPath)
	} catch (_) {}
	if (!normalizeString(uploadRes?.fileID)) throw new Error('ZIP 上传失败')
	await deleteCloudFiles(items.map((item) => item.xlsx_file_id))
	return { fileId: uploadRes.fileID, cloudPath }
}

async function acquireWorkerLease(jobId, workerToken) {
	const now = Date.now()
	const result = await jobs
		.where(dbCmd.and([
			{ _id: jobId },
			{ worker_token: workerToken },
			{ status: dbCmd.in(['queued', 'processing', 'packaging']) },
			{ lease_until: dbCmd.lte(now) }
		]))
		.updateAndReturn({
			status: 'processing',
			lease_until: now + WORKER_LEASE_MS,
			updated_at: now
		})
	return result?.doc || null
}

async function workerV1(data) {
	const jobId = normalizeString(data.job_id ?? data.jobId)
	const workerToken = normalizeString(data.worker_token ?? data.workerToken)
	if (!jobId || !workerToken) return { code: 403, msg: '导出任务凭证无效' }
	const job = await acquireWorkerLease(jobId, workerToken)
	if (!job) return { code: 0, msg: '导出任务正在由其他实例处理' }
	if (Number(job.expires_at || 0) <= Date.now()) {
		await expireJob(job)
		return { code: 410, msg: '导出任务已过期' }
	}
	let activeItem = null
	try {
		const itemRes = await jobItems
			.where({ job_id: job._id, status: 'pending' })
			.orderBy('sequence', 'asc')
			.limit(1)
			.get()
		activeItem = (itemRes.data || [])[0] || null
		if (activeItem) {
			const generated = await generateInspectionFile(job, activeItem)
			await jobItems.doc(activeItem._id).update({
				status: 'generated',
				xlsx_file_id: generated.fileId,
				xlsx_cloud_path: generated.cloudPath,
				xlsx_file_name: generated.fileName,
				missing_file_count: generated.missingFileCount,
				error_message: '',
				updated_at: Date.now()
			})
			await jobs.doc(job._id).update({
				processed_count: dbCmd.inc(1),
				missing_file_count: dbCmd.inc(generated.missingFileCount),
				lease_until: 0,
				updated_at: Date.now()
			})
			await triggerWorker(job._id, job.worker_token)
			return { code: 0, msg: '已生成一张巡检单' }
		}

		await jobs.doc(job._id).update({ status: 'packaging', lease_until: Date.now() + WORKER_LEASE_MS, updated_at: Date.now() })
		const packaged = await packageJob(job)
		await jobs.doc(job._id).update({
			status: 'ready',
			zip_file_id: packaged.fileId,
			zip_cloud_path: packaged.cloudPath,
			error_message: '',
			lease_until: 0,
			updated_at: Date.now()
		})
		return { code: 0, msg: '导出文件生成完成' }
	} catch (error) {
		const stale = error?.code === 'STALE_CUSTOMER'
		if (activeItem && !stale) {
			await jobItems.doc(activeItem._id).update({
				status: 'failed',
				error_message: normalizeString(error?.message) || 'Excel 生成失败',
				updated_at: Date.now()
			})
		}
		await jobs.doc(job._id).update({
			status: stale ? 'stale' : 'failed',
			error_message: normalizeString(error?.message) || '导出任务失败',
			lease_until: 0,
			updated_at: Date.now()
		})
		console.error('[inspection-export] worker failed', job._id, error)
		return { code: 500, msg: normalizeString(error?.message) || '导出任务失败' }
	}
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event || {}
	const requestId = normalizeString(event?.request_id || event?.requestId || context?.requestId) || generateRequestId()
	if (action === 'workerV1') return workerV1(data)
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, [], {
		recordLog,
		requestId,
		cloudFunction: CLOUD_FUNCTION
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }
	if (!PUBLIC_ACTIONS.has(action)) return { code: 400, msg: '未知 action' }
	if (action === 'createV1' || action === 'listMineV1') await cleanupExpiredJobs()
	try {
		if (action === 'previewV1') return previewV1(data)
		if (action === 'createV1') return createV1(user, data, requestId)
		if (action === 'getJobV1') return getJobV1(user, data)
		if (action === 'listMineV1') return listMineV1(user, data)
		if (action === 'resumeV1') return resumeV1(user, data)
		if (action === 'getDownloadV1') return getDownloadV1(user, data, requestId)
		return { code: 400, msg: '未知 action' }
	} catch (error) {
		console.error('[crm-home-safety-export] main failed', action, error)
		return { code: 500, msg: error?.message || '巡检记录导出服务异常' }
	}
}
