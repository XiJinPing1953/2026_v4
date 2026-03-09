'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const fillings = db.collection('crm_fillings')
const movements = db.collection('crm_bottle_movements')

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
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
	} catch (err) {
		console.error('[crm-filling] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toTimestamp(value, fallback = Date.now()) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
	if (typeof value === 'string' && value.trim()) {
		const asNum = Number(value)
		if (Number.isFinite(asNum) && asNum > 0) return asNum
		const asDate = Date.parse(value)
		if (Number.isFinite(asDate) && asDate > 0) return asDate
	}
	return fallback
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function formatDayByTs(ts) {
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = pad2(d.getMonth() + 1)
	const day = pad2(d.getDate())
	return `${y}-${m}-${day}`
}

function normalizeEventDay(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	if (m) return m[1]
	return formatDayByTs(toTimestamp(fallbackTs, Date.now()))
}

function parseEventAt(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
	if (m) {
		const y = m[1]
		const mon = m[2]
		const d = m[3]
		const hh = pad2(m[4] || '00')
		const mm = pad2(m[5] || '00')
		const ss = pad2(m[6] || '00')
		const ts = Date.parse(`${y}-${mon}-${d}T${hh}:${mm}:${ss}+08:00`)
		if (Number.isFinite(ts) && ts > 0) return ts
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return toTimestamp(fallbackTs, Date.now())
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

async function triggerAnomalyTouchV2(user, token, bottleNos, requestId) {
	const normalizedNos = Array.from(
		new Set(
			(bottleNos || [])
				.map((item) => normalizeBottleNo(item))
				.filter(Boolean)
		)
	)
	if (!normalizedNos.length) return { ok: true, warning: '' }

	try {
		const res = await uniCloud.callFunction({
			name: 'crm-bottle-anomaly',
			data: {
				action: 'touchV2',
				token,
				request_id: requestId,
				data: {
					bottle_nos: normalizedNos,
					batch_size: 120,
					max_events_per_round: 800,
					max_ms_per_round: 2200,
					max_writes_per_round: 120
				}
			}
		})
		const result = res && res.result ? res.result : {}
		if (result.code === 0) {
			if (result.data && result.data.done === false) {
				return { ok: true, warning: '异常增量扫描未完成，请在异常页继续扫描' }
			}
			return { ok: true, warning: '' }
		}
		const warning = normalizeString(result.msg) || '异常增量扫描触发失败'
		await recordLog(
			user,
			'filling_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	} catch (err) {
		const warning = normalizeString(err && err.message) || '异常增量扫描触发失败'
		await recordLog(
			user,
			'filling_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	}
}

async function listV1(user, data) {
	void user
	const bottleNo = normalizeString(data.bottle_no)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 50) || 50, 1),
		200
	)

	const where = {}
	if (bottleNo) where.bottle_no = normalizeBottleNo(bottleNo)
	if (dateStart && dateEnd) {
		where.date = dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd))
	} else if (dateStart) {
		where.date = dbCmd.gte(dateStart)
	} else if (dateEnd) {
		where.date = dbCmd.lte(dateEnd)
	}

	const res = await fillings
		.where(where)
		.orderBy('date', 'desc')
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await fillings.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total

	const mergeWhere = (base, extra) => {
		if (!base || (typeof base === 'object' && Object.keys(base).length === 0)) return extra
		return dbCmd.and([base, extra])
	}

	const stationRes = await fillings.where(mergeWhere(where, { address: '' })).count()
	const withRemarkRes = await fillings.where(mergeWhere(where, { remark: dbCmd.neq('') })).count()
	const station = Number(stationRes.total || 0)
	const withRemark = Number(withRemarkRes.total || 0)

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
			station,
			external: Math.max(total - station, 0),
			with_remark: withRemark
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const res = await fillings.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	return { code: 0, data: doc }
}

async function createV1(user, data, requestId, token) {
	const date = normalizeString(data.date)
	if (!date) return { code: 400, msg: '日期必填' }
	const bottleNo = normalizeBottleNo(data.bottle_no)
	if (!bottleNo) return { code: 400, msg: '瓶号必填' }
	const fillWeight = toNumber(data.fill_weight, null)
	if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
		return { code: 400, msg: '灌装重量必填且大于 0' }
	}

	const doc = {
		date,
		bottle_no: bottleNo,
		fill_weight: fillWeight,
		address: normalizeString(data.address),
		remark: normalizeString(data.remark),
		created_at: Date.now(),
		updated_at: Date.now(),
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}
	const movementEventDay = normalizeEventDay(date, doc.created_at)
	const movementEventAt = parseEventAt(date, doc.created_at)

	const res = await fillings.add(doc)
	await recordLog(user, 'filling_create_v1', { id: res.id, bottle_no: bottleNo }, requestId)

	await movements.add({
		bottle_no: bottleNo,
		type: 'fill',
		date,
		event_day: movementEventDay,
		event_at: movementEventAt,
		type_order: 20,
		source_type: normalizeString(data.source_type) || 'filling',
		source_id: res.id,
		customer_id: null,
		customer_name: '',
		net_weight: fillWeight,
		loss_weight: null,
		note: normalizeString(data.note || data.remark),
		created_at: Date.now(),
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	})

	const touchRes = await triggerAnomalyTouchV2(user, token, [bottleNo], requestId)
	return {
		code: 0,
		msg: touchRes.warning ? `创建成功（${touchRes.warning}）` : '创建成功',
		data: { _id: res.id, warning: touchRes.warning || '' }
	}
}

async function updateV1(user, data, requestId, token) {
	const id = normalizeString(data._id || data.id || data.recordId)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const oldRes = await fillings.doc(id).get()
	const oldDoc = (oldRes.data && oldRes.data[0]) || null
	if (!oldDoc) return { code: 404, msg: '记录不存在' }

	const date = normalizeString(data.date || oldDoc.date)
	if (!date) return { code: 400, msg: '日期必填' }
	const bottleNo = normalizeBottleNo(data.bottle_no || oldDoc.bottle_no)
	if (!bottleNo) return { code: 400, msg: '瓶号必填' }
	const fillWeight = toNumber(data.fill_weight != null ? data.fill_weight : oldDoc.fill_weight, null)
	if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
		return { code: 400, msg: '灌装重量必填且大于 0' }
	}

	const now = Date.now()
	const updateDoc = {
		date,
		bottle_no: bottleNo,
		fill_weight: fillWeight,
		address: normalizeString(data.address != null ? data.address : oldDoc.address),
		remark: normalizeString(data.remark != null ? data.remark : oldDoc.remark),
		updated_at: now
	}
	await fillings.doc(id).update(updateDoc)

	const movementEventDay = normalizeEventDay(date, now)
	const movementEventAt = parseEventAt(date, now)
	await movements.where({ source_id: id, type: 'fill' }).remove()
	await movements.add({
		bottle_no: bottleNo,
		type: 'fill',
		date,
		event_day: movementEventDay,
		event_at: movementEventAt,
		type_order: 20,
		source_type: 'filling',
		source_id: id,
		customer_id: null,
		customer_name: '',
		net_weight: fillWeight,
		loss_weight: null,
		note: normalizeString(data.note || updateDoc.remark),
		created_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	})

	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		[oldDoc.bottle_no, bottleNo],
		requestId
	)
	await recordLog(
		user,
		'filling_update_v1',
		{ id, bottle_no: bottleNo, touch_warning: touchRes.warning || '' },
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `更新成功（${touchRes.warning}）` : '更新成功',
		data: { warning: touchRes.warning || '' }
	}
}

async function removeV1(user, data, requestId, token) {
	const id = normalizeString(data._id || data.id || data.recordId)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const oldRes = await fillings.doc(id).get()
	const oldDoc = (oldRes.data && oldRes.data[0]) || null
	if (!oldDoc) return { code: 404, msg: '记录不存在' }

	await movements.where({ source_id: id, type: 'fill' }).remove()
	await fillings.doc(id).remove()
	const touchRes = await triggerAnomalyTouchV2(user, token, [oldDoc.bottle_no], requestId)
	await recordLog(
		user,
		'filling_remove_v1',
		{ id, bottle_no: normalizeBottleNo(oldDoc.bottle_no), touch_warning: touchRes.warning || '' },
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `删除成功（${touchRes.warning}）` : '删除成功',
		data: { warning: touchRes.warning || '' }
	}
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId, token)
	if (action === 'updateV1') return updateV1(user, data, requestId, token)
	if (action === 'removeV1') return removeV1(user, data, requestId, token)

	return { code: 400, msg: '未知 action' }
}
