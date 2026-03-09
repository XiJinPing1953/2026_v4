'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const tasks = db.collection('crm_collection_tasks')
const followups = db.collection('crm_collection_followups')
const sales = db.collection('crm_sale_records')

const WRITE_ROLES = ['superadmin', 'admin', 'finance']
const STATUS_LIST = ['open', 'in_progress', 'promised', 'partial_paid', 'paid', 'paused', 'closed']
const PRIORITY_LIST = ['P0', 'P1', 'P2']
const FOLLOWUP_ACTION_LIST = ['call', 'visit', 'wechat', 'sms', 'other']
const FOLLOWUP_RESULT_LIST = ['promised', 'partial_paid', 'paid', 'no_response', 'dispute']

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: normalizeId(user?._id),
			username: normalizeString(user?.username),
			role: normalizeString(user?.role),
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-collection] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'object' && value.$oid) return String(value.$oid).trim()
	return String(value).trim()
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	const num = Number(value)
	return Number.isFinite(num) ? Number(num.toFixed(2)) : 0
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeStatus(value) {
	const status = normalizeString(value)
	return STATUS_LIST.includes(status) ? status : ''
}

function normalizePriority(value) {
	const priority = normalizeString(value)
	return PRIORITY_LIST.includes(priority) ? priority : ''
}

function normalizeDate(value) {
	const text = normalizeString(value)
	if (!text) return ''
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
	return ''
}

function normalizeTimestamp(value) {
	if (value == null || value === '') return null
	const asNumber = Number(value)
	if (Number.isFinite(asNumber) && asNumber > 0) return Math.floor(asNumber)
	const text = normalizeString(value)
	if (!text) return null
	const parsed = Date.parse(text)
	if (!Number.isFinite(parsed) || parsed <= 0) return null
	return parsed
}

function normalizeFollowupAction(value) {
	const action = normalizeString(value)
	return FOLLOWUP_ACTION_LIST.includes(action) ? action : 'other'
}

function normalizeFollowupResult(value) {
	const result = normalizeString(value)
	return FOLLOWUP_RESULT_LIST.includes(result) ? result : 'no_response'
}

function canWrite(user) {
	return WRITE_ROLES.includes(normalizeString(user?.role))
}

async function ensureWritePermission(user, actionName, requestId) {
	if (canWrite(user)) return { ok: true }
	await recordLog(user, 'collection_forbidden', { action: actionName }, requestId)
	return { ok: false, code: 403, msg: '仅管理员可操作' }
}

function computeFlow(doc, priceUnit) {
	if (priceUnit !== 'm3') return { flow_volume_m3: 0 }
	const prev = toNumber(doc.flow_index_prev, 0)
	const curr = toNumber(doc.flow_index_curr, 0)
	const volume = toNumber(doc.flow_volume_m3, 0)
	if (volume > 0) return { flow_volume_m3: volume }
	if (curr >= prev) return { flow_volume_m3: curr - prev }
	return { flow_volume_m3: 0 }
}

function computeAmounts({ bizMode, priceUnit, unitPrice, outItems, backItems, agentRows, truckSaleNet, flow, roundingAmount }) {
	const outNetTotal = outItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	const backNetTotal = backItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)

	let totalNetWeight = outNetTotal - backNetTotal
	if (bizMode === 'truck') totalNetWeight = toNumber(truckSaleNet, 0)

	let outAmount = 0
	let backAmount = 0
	let shouldReceive = 0

	if (bizMode === 'agent_sale') {
		const totalWeight = agentRows.reduce((sum, row) => sum + toNumber(row.fill_weight, 0), 0)
		outAmount = totalWeight * unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'kg') {
		outAmount = outNetTotal * unitPrice
		backAmount = backNetTotal * unitPrice
		shouldReceive = totalNetWeight * unitPrice
	} else if (priceUnit === 'bottle') {
		outAmount = outItems.length * unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'm3') {
		const flowVolume = flow.flow_volume_m3 || 0
		outAmount = flowVolume * unitPrice
		shouldReceive = outAmount
	}

	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	let finalShouldReceive = shouldReceive
	if (shouldReceive > 0) finalShouldReceive = shouldReceive - rounding
	else if (shouldReceive < 0) finalShouldReceive = shouldReceive + rounding
	else finalShouldReceive = 0

	return {
		out_amount: fix2(outAmount),
		back_amount: fix2(backAmount),
		rounding_amount: fix2(rounding),
		should_receive: fix2(finalShouldReceive)
	}
}

function pickStatusByFollowup(result, defaultStatus) {
	if (result === 'paid') return 'paid'
	if (result === 'partial_paid') return 'partial_paid'
	if (result === 'promised') return 'promised'
	if (defaultStatus === 'open' || defaultStatus === 'paused') return 'in_progress'
	return defaultStatus || 'in_progress'
}

function buildTaskStatusAfterRecalc(currentStatus, amountShould, amountUnpaid) {
	if (amountShould <= 0) return 'closed'
	if (amountUnpaid <= 0) return 'paid'
	if (currentStatus === 'paid' || currentStatus === 'closed') return 'open'
	return normalizeStatus(currentStatus) || 'open'
}

async function sumTaskField(where, fieldName) {
	const batchSize = 500
	let skip = 0
	let total = 0
	while (true) {
		const res = await tasks
			.where(where)
			.field({ [fieldName]: true })
			.skip(skip)
			.limit(batchSize)
			.get()
		const rows = res.data || []
		if (!rows.length) break
		for (const row of rows) {
			total += toNumber(row[fieldName], 0)
		}
		if (rows.length < batchSize) break
		skip += rows.length
	}
	return fix2(total)
}

function buildTaskSalesWhere(taskDoc, dateFrom, dateTo) {
	const dateCond = { date: dbCmd.gte(dateFrom).and(dbCmd.lte(dateTo)) }
	const customerId = normalizeId(taskDoc.customer_id)
	const customerName = normalizeString(taskDoc.customer_name)
	if (customerId) {
		return dbCmd.and(dateCond, { customer_id: customerId })
	}
	if (customerName) {
		return dbCmd.and(dateCond, { customer_name: customerName })
	}
	return dateCond
}

// Aggregates sales into one receivable snapshot so auto-create and recalc stay identical.
async function aggregateTaskSnapshot(taskDoc, dateFrom, dateTo) {
	const where = buildTaskSalesWhere(taskDoc, dateFrom, dateTo)
	const listRes = await sales
		.where(where)
		.orderBy('date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()

	const list = listRes.data || []
	let amountShould = 0
	let amountReceived = 0
	let amountUnpaid = 0
	let saleCount = 0

	list.forEach((doc) => {
		const bizMode = normalizeString(doc.biz_mode) || 'bottle'
		const priceUnit = normalizeString(doc.price_unit) || 'kg'
		const unitPrice = toNumber(doc.unit_price, 0)
		const outItems = Array.isArray(doc.out_items) ? doc.out_items : []
		const backItems = Array.isArray(doc.back_items) ? doc.back_items : []
		const agentRows = Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : []
		const truckSaleNet = toNumber(doc.truck_sale_net, 0)
		const flow = computeFlow(doc, priceUnit)
		const amounts = computeAmounts({
			bizMode,
			priceUnit,
			unitPrice,
			outItems: bizMode === 'agent_sale' ? [] : outItems,
			backItems: bizMode === 'agent_sale' ? [] : backItems,
			agentRows,
			truckSaleNet,
			flow,
			roundingAmount: toNumber(doc.rounding_amount, 0)
		})
		const shouldReceive = toNumber(amounts.should_receive, 0)
		const received = toNumber(doc.amount_received, 0)
		const unpaid = Math.max(shouldReceive - received, 0)
		amountShould += shouldReceive
		amountReceived += received
		amountUnpaid += unpaid
		saleCount += 1
	})

	return {
		amount_should: fix2(amountShould),
		amount_received: fix2(amountReceived),
		amount_unpaid: fix2(amountUnpaid),
		sale_count: saleCount
	}
}

async function listTasksV1(user, data) {
	void user
	const page = Math.max(toNumber(data.page, 1), 1)
	const pageSize = Math.min(Math.max(toNumber(data.pageSize, 50), 1), 200)

	const keyword = normalizeString(data.keyword)
	const status = normalizeStatus(data.status)
	const ownerId = normalizeString(data.owner_id)
	const dateFrom = normalizeDate(data.date_from)
	const dateTo = normalizeDate(data.date_to)
	const minUnpaid = toNumber(data.min_unpaid, 0)

	const conditions = []
	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ customer_name: rx }, { owner_name: rx }, { latest_note: rx }]))
	}
	if (status) conditions.push({ status })
	if (ownerId) conditions.push({ owner_id: ownerId })
	if (dateFrom) conditions.push({ date_from: dbCmd.gte(dateFrom) })
	if (dateTo) conditions.push({ date_to: dbCmd.lte(dateTo) })
	if (minUnpaid > 0) conditions.push({ amount_unpaid: dbCmd.gte(minUnpaid) })

	const where = conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await tasks
		.where(where)
		.orderBy('amount_unpaid', 'desc')
		.orderBy('updated_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()
	const totalRes = await tasks.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const hasBaseFilter = conditions.length > 0
	const mergeWhere = (extra) => (hasBaseFilter ? dbCmd.and([where, extra]) : extra)

	let openCount = 0
	let promisedCount = 0
	if (!status) {
		const openRes = await tasks
			.where(mergeWhere(dbCmd.or([{ status: 'open' }, { status: 'in_progress' }])))
			.count()
		const promisedRes = await tasks.where(mergeWhere({ status: 'promised' })).count()
		openCount = Number(openRes.total || 0)
		promisedCount = Number(promisedRes.total || 0)
	} else {
		openCount = status === 'open' || status === 'in_progress' ? total : 0
		promisedCount = status === 'promised' ? total : 0
	}

	const unpaidTotal = await sumTaskField(where, 'amount_unpaid')

	return {
		code: 0,
		data: res.data || [],
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		},
		summary: {
			total,
			open: openCount,
			promised: promisedCount,
			unpaid: unpaidTotal
		}
	}
}

async function getTaskV1(user, data) {
	void user
	const id = normalizeId(data._id || data.id || data.task_id || data.taskId)
	if (!id) return { code: 400, msg: '缺少任务 ID' }
	const res = await tasks.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '任务不存在' }
	return { code: 0, data: doc }
}

async function updateTaskV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'updateTaskV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const id = normalizeId(data._id || data.id || data.task_id || data.taskId)
	if (!id) return { code: 400, msg: '缺少任务 ID' }

	const existingRes = await tasks.doc(id).get()
	const existing = (existingRes.data && existingRes.data[0]) || null
	if (!existing) return { code: 404, msg: '任务不存在' }

	const patch = {}
	const status = normalizeStatus(data.status)
	if (status) patch.status = status

	const priority = normalizePriority(data.priority)
	if (priority) patch.priority = priority

	if (data.owner_id != null || data.ownerId != null) {
		patch.owner_id = normalizeId(data.owner_id || data.ownerId) || null
	}
	if (data.owner_name != null || data.ownerName != null) {
		patch.owner_name = normalizeString(data.owner_name || data.ownerName)
	}

	if (data.next_followup_at != null || data.nextFollowupAt != null) {
		patch.next_followup_at = normalizeTimestamp(data.next_followup_at ?? data.nextFollowupAt)
	}

	if (data.latest_note != null || data.latestNote != null) {
		patch.latest_note = normalizeString(data.latest_note || data.latestNote)
	}

	if (!Object.keys(patch).length) return { code: 400, msg: '无可更新字段' }

	patch.updated_at = Date.now()
	await tasks.doc(id).update(patch)
	await recordLog(
		user,
		'collection_task_update_v1',
		{ id, patch, prev_status: normalizeStatus(existing.status), next_status: normalizeStatus(patch.status || existing.status) },
		requestId
	)

	const nextDoc = { ...existing, ...patch }
	return { code: 0, msg: '更新成功', data: nextDoc }
}

async function listFollowupsV1(user, data) {
	void user
	const taskId = normalizeId(data.task_id || data.taskId)
	if (!taskId) return { code: 400, msg: '缺少任务 ID' }
	const page = Math.max(toNumber(data.page, 1), 1)
	const pageSize = Math.min(Math.max(toNumber(data.pageSize, 50), 1), 200)

	const res = await followups
		.where({ task_id: taskId })
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	return { code: 0, data: res.data || [] }
}

async function addFollowupV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'addFollowupV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const taskId = normalizeId(data.task_id || data.taskId)
	if (!taskId) return { code: 400, msg: '缺少任务 ID' }

	const taskRes = await tasks.doc(taskId).get()
	const taskDoc = (taskRes.data && taskRes.data[0]) || null
	if (!taskDoc) return { code: 404, msg: '任务不存在' }

	const note = normalizeString(data.note)
	if (!note) return { code: 400, msg: '跟进内容必填' }

	const actionType = normalizeFollowupAction(data.action_type || data.actionType)
	const result = normalizeFollowupResult(data.result)
	const amountCollected = Math.max(toNumber(data.amount_collected ?? data.amountCollected, 0), 0)
	const nextFollowupAt = normalizeTimestamp(data.next_followup_at ?? data.nextFollowupAt)
	const now = Date.now()

	const followDoc = {
		task_id: taskId,
		customer_id: normalizeString(taskDoc.customer_id),
		customer_name: normalizeString(taskDoc.customer_name),
		action_type: actionType,
		result,
		amount_collected: amountCollected > 0 ? fix2(amountCollected) : null,
		note,
		next_followup_at: nextFollowupAt,
		operator_id: normalizeId(user._id),
		operator_name: normalizeString(user.username),
		created_at: now
	}

	const addRes = await followups.add(followDoc)

	const amountShould = toNumber(taskDoc.amount_should, 0)
	const amountReceived = toNumber(taskDoc.amount_received, 0)
	const nextReceived = fix2(amountReceived + amountCollected)
	const nextUnpaid = fix2(Math.max(amountShould - nextReceived, 0))

	let nextStatus = pickStatusByFollowup(result, normalizeStatus(taskDoc.status) || 'open')
	if (nextUnpaid <= 0 && amountShould > 0) nextStatus = 'paid'
	if (amountShould <= 0) nextStatus = 'closed'

	const taskPatch = {
		amount_received: nextReceived,
		amount_unpaid: nextUnpaid,
		status: nextStatus,
		last_followup_at: now,
		latest_note: note,
		updated_at: now
	}
	if (nextFollowupAt != null) taskPatch.next_followup_at = nextFollowupAt

	await tasks.doc(taskId).update(taskPatch)
	await recordLog(
		user,
		'collection_followup_add_v1',
		{ task_id: taskId, followup_id: addRes.id, result, amount_collected: followDoc.amount_collected, next_status: nextStatus },
		requestId
	)

	return {
		code: 0,
		msg: '跟进已记录',
		data: {
			followup_id: addRes.id,
			task: {
				_id: taskId,
				...taskPatch
			}
		}
	}
}

async function recalcTaskV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'recalcTaskV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const id = normalizeId(data._id || data.id || data.task_id || data.taskId)
	if (!id) return { code: 400, msg: '缺少任务 ID' }

	const taskRes = await tasks.doc(id).get()
	const taskDoc = (taskRes.data && taskRes.data[0]) || null
	if (!taskDoc) return { code: 404, msg: '任务不存在' }

	const dateFrom = normalizeDate(taskDoc.date_from)
	const dateTo = normalizeDate(taskDoc.date_to)
	if (!dateFrom || !dateTo) return { code: 400, msg: '任务日期范围无效' }

	const snapshot = await aggregateTaskSnapshot(taskDoc, dateFrom, dateTo)
	const nextStatus = buildTaskStatusAfterRecalc(taskDoc.status, snapshot.amount_should, snapshot.amount_unpaid)
	const patch = {
		...snapshot,
		status: nextStatus,
		updated_at: Date.now()
	}
	await tasks.doc(id).update(patch)

	await recordLog(
		user,
		'collection_task_recalc_v1',
		{
			id,
			prev: {
				amount_should: toNumber(taskDoc.amount_should, 0),
				amount_received: toNumber(taskDoc.amount_received, 0),
				amount_unpaid: toNumber(taskDoc.amount_unpaid, 0),
				status: normalizeStatus(taskDoc.status)
			},
			next: patch
		},
		requestId
	)

	return { code: 0, msg: '重算完成', data: { _id: id, ...patch } }
}

async function autoCreateTasksV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'autoCreateTasksV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const dateFrom = normalizeDate(data.date_from)
	const dateTo = normalizeDate(data.date_to)
	const minUnpaid = Math.max(toNumber(data.min_unpaid, 0), 0)
	if (!dateFrom || !dateTo) return { code: 400, msg: '缺少日期范围' }
	if (dateFrom > dateTo) return { code: 400, msg: '开始日期不能大于结束日期' }

	const dateCond = { date: dbCmd.gte(dateFrom).and(dbCmd.lte(dateTo)) }
	const listRes = await sales
		.where(dateCond)
		.orderBy('date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()

	const list = listRes.data || []
	const customerMap = {}

	list.forEach((doc) => {
		const customerId = normalizeId(doc.customer_id)
		const customerName = normalizeString(doc.customer_name) || '未知客户'
		if (!customerId && !customerName) return
		const key = customerId || customerName
		if (!customerMap[key]) {
			customerMap[key] = {
				customer_id: customerId,
				customer_name: customerName,
				amount_should: 0,
				amount_received: 0,
				amount_unpaid: 0,
				sale_count: 0
			}
		}

		const entry = customerMap[key]
		const bizMode = normalizeString(doc.biz_mode) || 'bottle'
		const priceUnit = normalizeString(doc.price_unit) || 'kg'
		const unitPrice = toNumber(doc.unit_price, 0)
		const outItems = Array.isArray(doc.out_items) ? doc.out_items : []
		const backItems = Array.isArray(doc.back_items) ? doc.back_items : []
		const agentRows = Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : []
		const truckSaleNet = toNumber(doc.truck_sale_net, 0)
		const flow = computeFlow(doc, priceUnit)
		const amounts = computeAmounts({
			bizMode,
			priceUnit,
			unitPrice,
			outItems: bizMode === 'agent_sale' ? [] : outItems,
			backItems: bizMode === 'agent_sale' ? [] : backItems,
			agentRows,
			truckSaleNet,
			flow,
			roundingAmount: toNumber(doc.rounding_amount, 0)
		})
		const shouldReceive = toNumber(amounts.should_receive, 0)
		const received = toNumber(doc.amount_received, 0)
		const unpaid = Math.max(shouldReceive - received, 0)

		entry.amount_should += shouldReceive
		entry.amount_received += received
		entry.amount_unpaid += unpaid
		entry.sale_count += 1
	})

	const groups = Object.values(customerMap)
		.map((item) => ({
			...item,
			amount_should: fix2(item.amount_should),
			amount_received: fix2(item.amount_received),
			amount_unpaid: fix2(item.amount_unpaid)
		}))
		.filter((item) => item.amount_unpaid >= minUnpaid)

	if (!groups.length) {
		await recordLog(user, 'collection_task_auto_create_v1', { created: 0, updated: 0, total: 0, date_from: dateFrom, date_to: dateTo }, requestId)
		return { code: 0, data: { created: 0, updated: 0, total: 0 }, msg: '当前范围无欠款客户' }
	}

	const rangeKeys = groups.map((item) => `${item.customer_id || item.customer_name}|${dateFrom}|${dateTo}`)
	let existingMap = {}
	if (rangeKeys.length) {
		const existingRes = await tasks.where({ range_key: dbCmd.in(rangeKeys) }).get()
		existingMap = (existingRes.data || []).reduce((acc, item) => {
			acc[item.range_key] = item
			return acc
		}, {})
	}

	const now = Date.now()
	const createDocs = []
	const updates = []
	let updated = 0

	groups.forEach((item) => {
		const rangeKey = `${item.customer_id || item.customer_name}|${dateFrom}|${dateTo}`
		const existing = existingMap[rangeKey]
		if (existing) {
			const patch = {
				amount_should: item.amount_should,
				amount_received: item.amount_received,
				amount_unpaid: item.amount_unpaid,
				sale_count: item.sale_count,
				status: buildTaskStatusAfterRecalc(existing.status, item.amount_should, item.amount_unpaid),
				updated_at: now
			}
			updates.push(tasks.doc(existing._id).update(patch))
			updated += 1
			return
		}
		createDocs.push({
			customer_id: item.customer_id,
			customer_name: item.customer_name,
			date_from: dateFrom,
			date_to: dateTo,
			sale_count: item.sale_count,
			amount_should: item.amount_should,
			amount_received: item.amount_received,
			amount_unpaid: item.amount_unpaid,
			status: buildTaskStatusAfterRecalc('open', item.amount_should, item.amount_unpaid),
			priority: 'P1',
			owner_id: null,
			owner_name: '',
			last_followup_at: null,
			next_followup_at: null,
			latest_note: '',
			source: 'auto_by_range',
			range_key: rangeKey,
			created_at: now,
			updated_at: now
		})
	})

	if (updates.length) await Promise.allSettled(updates)
	if (createDocs.length) await tasks.add(createDocs)

	await recordLog(
		user,
		'collection_task_auto_create_v1',
		{
			created: createDocs.length,
			updated,
			total: groups.length,
			date_from: dateFrom,
			date_to: dateTo,
			min_unpaid: minUnpaid
		},
		requestId
	)

	return { code: 0, data: { created: createDocs.length, updated, total: groups.length } }
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event
	const requestId = normalizeString(event.request_id || event.requestId || context?.requestId || '')
	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'listTasksV1') return listTasksV1(user, data)
	if (action === 'getTaskV1') return getTaskV1(user, data)
	if (action === 'updateTaskV1') return updateTaskV1(user, data, requestId)
	if (action === 'listFollowupsV1') return listFollowupsV1(user, data)
	if (action === 'addFollowupV1') return addFollowupV1(user, data, requestId)
	if (action === 'recalcTaskV1') return recalcTaskV1(user, data, requestId)
	if (action === 'autoCreateTasksV1') return autoCreateTasksV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
