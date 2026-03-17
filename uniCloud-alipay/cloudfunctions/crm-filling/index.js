'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const fillings = db.collection('crm_fillings')
const movements = db.collection('crm_bottle_movements')
const bottles = db.collection('crm_bottles')
const BATCH_UPDATE_LIMIT = 2000
const BATCH_PREVIEW_DETAIL_LIMIT = 50
const DEFAULT_RECORD_TYPE = 'normal_fill'
const FILLING_RECORD_TYPES = [
	'normal_fill',
	'truck_out_agent_sale',
	'truck_out_no_sale'
]
const INVENTORY_LINKED_RECORD_TYPES = ['normal_fill', 'truck_out_agent_sale']
const CLEANUP_BACKUP_COLLECTION = 'crm_filling_no_sale_movement_backups'
const CLEANUP_SCAN_LIMIT = 5000
const CLEANUP_SAMPLE_LIMIT = 20
const CLEANUP_ALLOWED_ROLES = new Set(['superadmin', 'admin'])

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

function escapeRegExp(value) {
	return normalizeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeIdString(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		const oid = normalizeString(value.$oid || value.oid || value.id)
		if (oid) return oid
	}
	return normalizeString(value)
}

function normalizeRecordType(value, fallback = DEFAULT_RECORD_TYPE) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (FILLING_RECORD_TYPES.includes(text)) return text
	return ''
}

function isInventoryLinkedRecordType(value) {
	const recordType = normalizeRecordType(value, '')
	return INVENTORY_LINKED_RECORD_TYPES.includes(recordType)
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function normalizeOperatorName(value, fallback = '') {
	const text = normalizeString(value)
	if (text) return text
	return normalizeString(fallback)
}

function normalizeFillingRow(row = {}) {
	const doc = row && typeof row === 'object' ? { ...row } : {}
	const recordType = normalizeRecordType(doc.record_type, DEFAULT_RECORD_TYPE)
	const operatorName = normalizeOperatorName(doc.operator, doc.created_by_name)
	return {
		...doc,
		record_type: recordType,
		operator: operatorName,
		operator_id: normalizeIdString(doc.operator_id || doc.created_by) || null
	}
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

function isValidDateString(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [year, month, day] = text.split('-').map((item) => Number(item))
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
	if (month < 1 || month > 12) return false
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	return day >= 1 && day <= maxDay
}

function normalizeUniqueIds(rawIds) {
	if (!Array.isArray(rawIds)) return []
	const set = new Set()
	const result = []
	for (let i = 0; i < rawIds.length; i += 1) {
		const id = normalizeString(rawIds[i])
		if (!id || set.has(id)) continue
		set.add(id)
		result.push(id)
	}
	return result
}

function mergeWhere(base, extra) {
	if (!base || (typeof base === 'object' && Object.keys(base).length === 0)) return extra
	return dbCmd.and([base, extra])
}

function buildListWhereByFilter(data = {}) {
	const bottleNo = normalizeString(data.bottle_no)
	const operator = normalizeOperatorName(data.operator)
	const recordType = normalizeRecordType(data.record_type || data.recordType, '')
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	if (normalizeString(data.record_type || data.recordType) && !recordType) {
		return { ok: false, msg: '作业类型筛选无效' }
	}
	const conditions = []
	if (bottleNo) conditions.push({ bottle_no: normalizeBottleNo(bottleNo) })
	if (operator) {
		const operatorRx = db.RegExp({ regexp: escapeRegExp(operator), options: 'i' })
		conditions.push(
			dbCmd.or([
				{ operator: operatorRx },
				{ created_by_name: operatorRx }
			])
		)
	}
	if (recordType) conditions.push({ record_type: recordType })
	if (dateStart && dateEnd) {
		conditions.push({ date: dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd)) })
	} else if (dateStart) {
		conditions.push({ date: dbCmd.gte(dateStart) })
	} else if (dateEnd) {
		conditions.push({ date: dbCmd.lte(dateEnd) })
	}
	let where = {}
	if (conditions.length === 1) where = conditions[0]
	if (conditions.length > 1) where = dbCmd.and(conditions)
	return {
		ok: true,
		where,
		filters: {
			bottle_no: bottleNo ? normalizeBottleNo(bottleNo) : '',
			operator,
			record_type: recordType,
			dateStart,
			dateEnd
		}
	}
}

async function fetchFillingsByWhere(where, limit = BATCH_UPDATE_LIMIT) {
	const docs = []
	const pageSize = 200
	let skip = 0
	while (true) {
		const res = await fillings
			.where(where)
			.orderBy('date', 'desc')
			.orderBy('created_at', 'desc')
			.skip(skip)
			.limit(pageSize)
			.field({ _id: true, bottle_no: true, date: true, record_type: true })
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		docs.push(...rows)
		if (docs.length > limit) {
			return { ok: false, msg: `单次最多更新 ${limit} 条，请缩小筛选范围` }
		}
		if (rows.length < pageSize) break
		skip += rows.length
	}
	return { ok: true, data: docs }
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
	const filterResult = buildListWhereByFilter(data)
	if (!filterResult.ok) return { code: 400, msg: filterResult.msg || '筛选参数无效' }
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 50) || 50, 1),
		200
	)
	const where = filterResult.where

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

	const withRemarkRes = await fillings.where(mergeWhere(where, { remark: dbCmd.neq('') })).count()
	const withRemark = Number(withRemarkRes.total || 0)

	const rows = Array.isArray(res.data) ? res.data.map((row) => normalizeFillingRow(row)) : []

	return {
		code: 0,
		data: rows,
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		},
		summary: {
			total,
			with_remark: withRemark,
			without_remark: Math.max(total - withRemark, 0)
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
	return { code: 0, data: normalizeFillingRow(doc) }
}

async function hasDuplicateFillingByDateBottle(date, bottleNo, excludeId = '') {
	const normalizedDate = normalizeString(date)
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	const normalizedExcludeId = normalizeString(excludeId)
	if (!normalizedDate || !normalizedBottleNo) return false
	const res = await fillings
		.where({ date: normalizedDate, bottle_no: normalizedBottleNo })
		.field({ _id: true })
		.limit(5)
		.get()
	const rows = Array.isArray(res.data) ? res.data : []
	if (!normalizedExcludeId) return rows.length > 0
	return rows.some((row) => normalizeString(row && row._id) !== normalizedExcludeId)
}

function getBottleArchiveErrorMessage(state) {
	if (!state || !state.exists) return '钢瓶档案不存在，请先建档'
	if (!state.is_active) return '钢瓶档案未启用，不能灌装'
	return ''
}

function buildBottleRequiredMessage(recordType) {
	if (recordType === 'truck_out_agent_sale') return '随车出液-代理销售必须填写瓶号'
	return '常规灌装必须填写瓶号'
}

async function getBottleArchiveMapByBottleNos(bottleNos = []) {
	const normalized = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	const map = new Map()
	for (let i = 0; i < normalized.length; i += 1) {
		map.set(normalized[i], { exists: false, is_active: false })
	}
	if (!normalized.length) return map

	const chunkSize = 200
	for (let i = 0; i < normalized.length; i += chunkSize) {
		const chunk = normalized.slice(i, i + chunkSize)
		const res = await bottles
			.where({ bottle_no: dbCmd.in(chunk) })
			.field({ bottle_no: true, is_active: true })
			.limit(chunk.length)
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let j = 0; j < rows.length; j += 1) {
			const row = rows[j]
			const bottleNo = normalizeBottleNo(row && row.bottle_no)
			if (!bottleNo) continue
			map.set(bottleNo, { exists: true, is_active: Boolean(row && row.is_active) })
		}
	}
	return map
}

async function getBottleArchiveStateByBottleNo(bottleNo) {
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	if (!normalizedBottleNo) return { exists: false, is_active: false }
	const map = await getBottleArchiveMapByBottleNos([normalizedBottleNo])
	return map.get(normalizedBottleNo) || { exists: false, is_active: false }
}

function normalizeUniqueBottleNos(rawBottleNos = []) {
	const set = new Set()
	const out = []
	for (let i = 0; i < rawBottleNos.length; i += 1) {
		const bottleNo = normalizeBottleNo(rawBottleNos[i])
		if (!bottleNo || set.has(bottleNo)) continue
		set.add(bottleNo)
		out.push(bottleNo)
	}
	return out
}

async function fetchFillMovementsBySourceIds(sourceIds = [], limit = CLEANUP_SCAN_LIMIT) {
	const ids = normalizeUniqueIds(sourceIds)
	if (!ids.length) return { ok: true, data: [] }
	const chunkSize = 150
	const rows = []
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize)
		const res = await movements
			.where({ type: 'fill', source_id: dbCmd.in(chunk) })
			.limit(500)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (rows.length > limit) {
			return { ok: false, msg: `待清洗 movement 超过 ${limit} 条，请先分批处理` }
		}
	}
	return { ok: true, data: rows }
}

async function triggerAnomalyTouchV2InChunks(user, token, bottleNos, requestId, chunkSize = 120) {
	const normalized = normalizeUniqueBottleNos(bottleNos || [])
	if (!normalized.length) return { ok: true, warning: '' }
	let warning = ''
	let allOk = true
	for (let i = 0; i < normalized.length; i += chunkSize) {
		const chunk = normalized.slice(i, i + chunkSize)
		const res = await triggerAnomalyTouchV2(user, token, chunk, requestId)
		if (!res.ok) allOk = false
		if (!warning && normalizeString(res.warning)) warning = normalizeString(res.warning)
	}
	return { ok: allOk, warning }
}

function buildCleanupSampleItems(movementRows = [], fillingMap = new Map()) {
	return movementRows.slice(0, CLEANUP_SAMPLE_LIMIT).map((movement) => {
		const movementId = normalizeString(movement && movement._id)
		const sourceId = normalizeString(movement && movement.source_id)
		const fillingDoc = fillingMap.get(sourceId) || null
		return {
			movement_id: movementId,
			source_id: sourceId,
			bottle_no: normalizeBottleNo(movement && movement.bottle_no) || normalizeBottleNo(fillingDoc && fillingDoc.bottle_no),
			date: normalizeString(movement && movement.date) || normalizeString(fillingDoc && fillingDoc.date)
		}
	})
}

async function cleanupNoSaleMovementsV1(user, data, requestId, token) {
	if (!CLEANUP_ALLOWED_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅管理员可操作' }
	}
	const preview = data && data.preview !== false
	const runId = normalizeString(data && (data.run_id || data.runId)) || `cleanup_no_sale_${Date.now()}`
	const scanLimitRaw = toNumber(data && (data.scan_limit || data.scanLimit), CLEANUP_SCAN_LIMIT)
	const scanLimit = Math.min(
		CLEANUP_SCAN_LIMIT,
		Math.max(Number.isFinite(scanLimitRaw) ? Math.floor(scanLimitRaw) : CLEANUP_SCAN_LIMIT, 1)
	)

	const noSaleWhere = { record_type: 'truck_out_no_sale' }
	const noSaleRowsRes = await fetchFillingsByWhere(noSaleWhere, scanLimit)
	if (!noSaleRowsRes.ok) return { code: 400, msg: noSaleRowsRes.msg || '清洗扫描失败' }
	const noSaleRows = Array.isArray(noSaleRowsRes.data) ? noSaleRowsRes.data : []
	const sourceIds = noSaleRows.map((row) => normalizeString(row && row._id)).filter(Boolean)
	const fillingMap = new Map()
	for (let i = 0; i < noSaleRows.length; i += 1) {
		const row = noSaleRows[i]
		const id = normalizeString(row && row._id)
		if (!id) continue
		fillingMap.set(id, row)
	}

	const movementRowsRes = await fetchFillMovementsBySourceIds(sourceIds, scanLimit)
	if (!movementRowsRes.ok) return { code: 400, msg: movementRowsRes.msg || '清洗扫描失败' }
	const candidateMovements = Array.isArray(movementRowsRes.data)
		? movementRowsRes.data.filter((row) => fillingMap.has(normalizeString(row && row.source_id)))
		: []
	const movementIds = candidateMovements
		.map((row) => normalizeString(row && row._id))
		.filter(Boolean)
	const touchedBottleNos = normalizeUniqueBottleNos(
		candidateMovements
			.map((row) => normalizeBottleNo(row && row.bottle_no) || normalizeBottleNo((fillingMap.get(normalizeString(row && row.source_id)) || {}).bottle_no))
			.filter(Boolean)
	)
	const sampleItems = buildCleanupSampleItems(candidateMovements, fillingMap)
	const baseData = {
		preview,
		run_id: runId,
		scan_limit: scanLimit,
		filling_total: noSaleRows.length,
		movement_total: candidateMovements.length,
		skipped_without_movement: Math.max(noSaleRows.length - candidateMovements.length, 0),
		touched_bottle_total: touchedBottleNos.length,
		sample_items: sampleItems,
		backup_collection: CLEANUP_BACKUP_COLLECTION
	}

	if (preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				...baseData,
				can_execute: candidateMovements.length > 0
			}
		}
	}

	const backups = db.collection(CLEANUP_BACKUP_COLLECTION)
	for (let i = 0; i < candidateMovements.length; i += 1) {
		const movementDoc = candidateMovements[i]
		const sourceId = normalizeString(movementDoc && movementDoc.source_id)
		const fillingDoc = fillingMap.get(sourceId) || null
		try {
			await backups.add({
				run_id: runId,
				request_id: requestId,
				source_collection: 'crm_bottle_movements',
				source_id: normalizeString(movementDoc && movementDoc._id),
				source_filling_id: sourceId,
				record_type: 'truck_out_no_sale',
				bottle_no:
					normalizeBottleNo(movementDoc && movementDoc.bottle_no) || normalizeBottleNo(fillingDoc && fillingDoc.bottle_no),
				backup_doc: movementDoc,
				filling_doc: fillingDoc,
				backed_up_at: Date.now(),
				backed_up_by: user?._id || null,
				backed_up_by_name: user?.username || ''
			})
		} catch (err) {
			return {
				code: 500,
				msg: `备份失败，已停止执行：${normalizeString(err && err.message) || '未知错误'}`,
				data: {
					...baseData,
					failed_backup_movement_id: normalizeString(movementDoc && movementDoc._id)
				}
			}
		}
	}

	const chunkSize = 150
	let removed = 0
	for (let i = 0; i < movementIds.length; i += chunkSize) {
		const chunk = movementIds.slice(i, i + chunkSize)
		if (!chunk.length) continue
		await movements.where({ _id: dbCmd.in(chunk) }).remove()
		removed += chunk.length
	}

	const touchRes = await triggerAnomalyTouchV2InChunks(user, token, touchedBottleNos, requestId)
	await recordLog(
		user,
		'filling_cleanup_no_sale_movements_v1',
		{
			run_id: runId,
			filling_total: noSaleRows.length,
			movement_total: candidateMovements.length,
			removed,
			touched_bottle_total: touchedBottleNos.length,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `清洗完成（${touchRes.warning}）` : '清洗完成',
		data: {
			...baseData,
			preview: false,
			removed,
			backed_up: candidateMovements.length,
			touch_warning: touchRes.warning || ''
		}
	}
}

async function createV1(user, data, requestId, token) {
	const date = normalizeString(data.date)
	if (!date) return { code: 400, msg: '日期必填' }
	const recordType = normalizeRecordType(data.record_type || data.recordType, DEFAULT_RECORD_TYPE)
	if (!recordType) return { code: 400, msg: '作业类型无效' }
	const inventoryLinked = isInventoryLinkedRecordType(recordType)
	const bottleNo = normalizeBottleNo(data.bottle_no)
	if (inventoryLinked && !bottleNo) return { code: 400, msg: buildBottleRequiredMessage(recordType) }
	if (inventoryLinked && bottleNo) {
		const archiveState = await getBottleArchiveStateByBottleNo(bottleNo)
		const archiveError = getBottleArchiveErrorMessage(archiveState)
		if (archiveError) return { code: 400, msg: archiveError }
	}
	const operatorName = normalizeOperatorName(data.operator, user?.username)
	const operatorId = normalizeIdString(data.operator_id || data.operatorId || user?._id) || null
	const fillWeight = toNumber(data.fill_weight, null)
	if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
		return { code: 400, msg: '灌装重量必填且大于 0' }
	}
	if (inventoryLinked && bottleNo) {
		const hasDuplicate = await hasDuplicateFillingByDateBottle(date, bottleNo)
		if (hasDuplicate) {
			return { code: 409, msg: '同日期同瓶号记录已存在，请勿重复录入' }
		}
	}

	const doc = {
		date,
		bottle_no: bottleNo,
		record_type: recordType,
		operator: operatorName,
		operator_id: operatorId,
		fill_weight: fillWeight,
		remark: normalizeString(data.remark),
		created_at: Date.now(),
		updated_at: Date.now(),
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}
	const movementEventDay = normalizeEventDay(date, doc.created_at)
	const movementEventAt = parseEventAt(date, doc.created_at)

	const res = await fillings.add(doc)
	await recordLog(
		user,
		'filling_create_v1',
		{ id: res.id, bottle_no: bottleNo, record_type: recordType, operator: operatorName },
		requestId
	)

	if (inventoryLinked && bottleNo) {
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
	}

	const touchRes = await triggerAnomalyTouchV2(user, token, inventoryLinked && bottleNo ? [bottleNo] : [], requestId)
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
	const recordType = normalizeRecordType(
		data.record_type != null ? data.record_type : oldDoc.record_type,
		DEFAULT_RECORD_TYPE
	)
	if (!recordType) return { code: 400, msg: '作业类型无效' }
	const inventoryLinked = isInventoryLinkedRecordType(recordType)
	const oldRecordType = normalizeRecordType(oldDoc.record_type, DEFAULT_RECORD_TYPE)
	const oldInventoryLinked = isInventoryLinkedRecordType(oldRecordType)
	const bottleNo = normalizeBottleNo(data.bottle_no != null ? data.bottle_no : oldDoc.bottle_no)
	if (inventoryLinked && !bottleNo) return { code: 400, msg: buildBottleRequiredMessage(recordType) }
	const oldBottleNo = normalizeBottleNo(oldDoc.bottle_no)
	if (inventoryLinked && bottleNo && (bottleNo !== oldBottleNo || !oldInventoryLinked)) {
		const archiveState = await getBottleArchiveStateByBottleNo(bottleNo)
		const archiveError = getBottleArchiveErrorMessage(archiveState)
		if (archiveError) return { code: 400, msg: archiveError }
	}
	const operatorName = normalizeOperatorName(
		data.operator != null ? data.operator : oldDoc.operator,
		oldDoc.created_by_name || user?.username
	)
	const operatorId = normalizeIdString(
		data.operator_id != null ? data.operator_id : (oldDoc.operator_id || oldDoc.created_by || user?._id)
	) || null
	const fillWeight = toNumber(data.fill_weight != null ? data.fill_weight : oldDoc.fill_weight, null)
	if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
		return { code: 400, msg: '灌装重量必填且大于 0' }
	}
	if (inventoryLinked && bottleNo) {
		const hasDuplicate = await hasDuplicateFillingByDateBottle(date, bottleNo, id)
		if (hasDuplicate) {
			return { code: 409, msg: '同日期同瓶号记录已存在，请修改日期或瓶号' }
		}
	}

	const now = Date.now()
	const updateDoc = {
		date,
		bottle_no: bottleNo,
		record_type: recordType,
		operator: operatorName,
		operator_id: operatorId,
		fill_weight: fillWeight,
		remark: normalizeString(data.remark != null ? data.remark : oldDoc.remark),
		updated_at: now
	}
	await fillings.doc(id).update(updateDoc)

	const movementEventDay = normalizeEventDay(date, now)
	const movementEventAt = parseEventAt(date, now)
	await movements.where({ source_id: id, type: 'fill' }).remove()
	if (inventoryLinked && bottleNo) {
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
	}

	const touchBottleNos = []
	if (oldInventoryLinked && oldBottleNo) touchBottleNos.push(oldBottleNo)
	if (inventoryLinked && bottleNo) touchBottleNos.push(bottleNo)
	const touchRes = await triggerAnomalyTouchV2(user, token, touchBottleNos, requestId)
	await recordLog(
		user,
		'filling_update_v1',
		{
			id,
			bottle_no: bottleNo,
			record_type: recordType,
			operator: operatorName,
			touch_warning: touchRes.warning || ''
		},
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

function parseBatchCreateRows(batchText, defaultWeight) {
	const lines = String(batchText || '').split(/\r?\n/)
	const seenBottleNos = new Set()
	const validRows = []
	const invalidItems = []
	let nonEmptyTotal = 0
	let duplicateTotal = 0

	for (let i = 0; i < lines.length; i += 1) {
		const raw = normalizeString(lines[i])
		if (!raw) continue
		nonEmptyTotal += 1
		const tokens = raw
			.split(/[\s,，;；]+/)
			.map((item) => normalizeString(item))
			.filter(Boolean)
		const bottleNo = normalizeBottleNo(tokens[0])
		if (!bottleNo) {
			invalidItems.push({ line_no: i + 1, bottle_no: '', error: '瓶号为空' })
			continue
		}
		let fillWeight = defaultWeight
		if (tokens[1]) {
			fillWeight = toNumber(tokens[1], null)
		}
		if (!(typeof fillWeight === 'number' && fillWeight > 0)) {
			invalidItems.push({
				line_no: i + 1,
				bottle_no: bottleNo,
				error: '灌装净重无效（需大于 0）'
			})
			continue
		}
		if (seenBottleNos.has(bottleNo)) {
			duplicateTotal += 1
			invalidItems.push({
				line_no: i + 1,
				bottle_no: bottleNo,
				error: '批量内容内瓶号重复'
			})
			continue
		}
		seenBottleNos.add(bottleNo)
		validRows.push({
			line_no: i + 1,
			bottle_no: bottleNo,
			fill_weight: fillWeight
		})
	}

	return {
		non_empty_total: nonEmptyTotal,
		valid_rows: validRows,
		invalid_items: invalidItems,
		duplicate_total: duplicateTotal
	}
}

async function findExistingBottleNosByDate(date, bottleNos = []) {
	const normalized = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalized.length) return new Set()
	const existed = new Set()
	const chunkSize = 200
	for (let i = 0; i < normalized.length; i += chunkSize) {
		const chunk = normalized.slice(i, i + chunkSize)
		const res = await fillings
			.where({ date, bottle_no: dbCmd.in(chunk) })
			.field({ bottle_no: true })
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let j = 0; j < rows.length; j += 1) {
			const bottleNo = normalizeBottleNo(rows[j] && rows[j].bottle_no)
			if (bottleNo) existed.add(bottleNo)
		}
	}
	return existed
}

function parseBatchCreatePayload(data = {}) {
	const preview = Boolean(data.preview)
	const date = normalizeString(data.date)
	const batchText = normalizeString(data.batch_text || data.batchText)
	const remark = normalizeString(data.remark)
	const recordType = normalizeRecordType(data.record_type || data.recordType, DEFAULT_RECORD_TYPE)
	const defaultWeightRaw = normalizeString(data.default_fill_weight || data.defaultFillWeight)
	if (!isValidDateString(date)) return { ok: false, msg: '灌装日期格式无效' }
	if (normalizeString(data.record_type || data.recordType) && !recordType) {
		return { ok: false, msg: '作业类型无效' }
	}
	if (!batchText) return { ok: false, msg: '批量内容为空' }
	let defaultWeight = null
	if (defaultWeightRaw) {
		defaultWeight = toNumber(defaultWeightRaw, null)
		if (!(typeof defaultWeight === 'number' && defaultWeight > 0)) {
			return { ok: false, msg: '默认净重无效（需大于 0）' }
		}
	}
	const parsedRows = parseBatchCreateRows(batchText, defaultWeight)
	if (parsedRows.valid_rows.length > BATCH_UPDATE_LIMIT) {
		return { ok: false, msg: `单次最多新增 ${BATCH_UPDATE_LIMIT} 条，请拆批执行` }
	}
	return {
		ok: true,
		data: {
			preview,
			date,
			record_type: recordType,
			remark,
			default_fill_weight: defaultWeight,
			parsed_rows: parsedRows
		}
	}
}

async function batchCreateV1(user, data, requestId, token) {
	const parsed = parseBatchCreatePayload(data)
	if (!parsed.ok) return { code: 400, msg: parsed.msg }
	const payload = parsed.data
	const inventoryLinked = isInventoryLinkedRecordType(payload.record_type)
	const operatorName = normalizeOperatorName(data.operator, user?.username)
	const operatorId = normalizeIdString(data.operator_id || data.operatorId || user?._id) || null
	const parsedRows = payload.parsed_rows
	const validRows = parsedRows.valid_rows

	const existedBottleNoSet = inventoryLinked
		? await findExistingBottleNosByDate(
			payload.date,
			validRows.map((row) => row.bottle_no)
		)
		: new Set()
	const bottleArchiveMap = inventoryLinked
		? await getBottleArchiveMapByBottleNos(validRows.map((row) => row.bottle_no))
		: new Map()
	const toCreateRows = []
	const existingItems = []
	const invalidItems = [...parsedRows.invalid_items]
	for (let i = 0; i < validRows.length; i += 1) {
		const row = validRows[i]
		if (inventoryLinked) {
			const archiveState = bottleArchiveMap.get(row.bottle_no)
			const archiveError = getBottleArchiveErrorMessage(archiveState)
			if (archiveError) {
				invalidItems.push({
					line_no: row.line_no,
					bottle_no: row.bottle_no,
					error: archiveError
				})
				continue
			}
			if (existedBottleNoSet.has(row.bottle_no)) {
				existingItems.push({
					line_no: row.line_no,
					bottle_no: row.bottle_no,
					error: '同日期同瓶号记录已存在'
				})
				continue
			}
		}
		toCreateRows.push(row)
	}

	if (payload.preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				date: payload.date,
				target_total: toCreateRows.length,
				invalid_total: invalidItems.length,
				duplicate_total: parsedRows.duplicate_total,
				existing_total: existingItems.length,
				sample_bottle_nos: toSampleBottleNos(toCreateRows),
				create_items: toCreateRows.slice(0, BATCH_PREVIEW_DETAIL_LIMIT).map((row) => ({
					line_no: row.line_no,
					bottle_no: row.bottle_no,
					fill_weight: row.fill_weight
				})),
				existing_items: existingItems.slice(0, BATCH_PREVIEW_DETAIL_LIMIT),
				invalid_items: invalidItems.slice(0, BATCH_PREVIEW_DETAIL_LIMIT),
				limit: BATCH_UPDATE_LIMIT
			}
		}
	}

	const failedItems = []
	const touchedBottleNos = []
	let success = 0
	for (let i = 0; i < invalidItems.length; i += 1) {
		const row = invalidItems[i]
		failedItems.push({
			line_no: row.line_no,
			bottle_no: normalizeBottleNo(row.bottle_no),
			error: normalizeString(row.error) || '无效数据'
		})
	}
	for (let i = 0; i < existingItems.length; i += 1) {
		const row = existingItems[i]
		failedItems.push({
			line_no: row.line_no,
			bottle_no: normalizeBottleNo(row.bottle_no),
			error: normalizeString(row.error) || '同日期同瓶号记录已存在'
		})
	}

	for (let i = 0; i < toCreateRows.length; i += 1) {
		const row = toCreateRows[i]
		try {
			const now = Date.now()
			const doc = {
				date: payload.date,
				bottle_no: row.bottle_no,
				record_type: payload.record_type,
				operator: operatorName,
				operator_id: operatorId,
				fill_weight: row.fill_weight,
				remark: payload.remark,
				created_at: now,
				updated_at: now,
				created_by: user?._id || null,
				created_by_name: user?.username || ''
			}
			const addRes = await fillings.add(doc)
			if (inventoryLinked && row.bottle_no) {
				await movements.add({
					bottle_no: row.bottle_no,
					type: 'fill',
					date: payload.date,
					event_day: normalizeEventDay(payload.date, now),
					event_at: parseEventAt(payload.date, now),
					type_order: 20,
					source_type: 'filling',
					source_id: addRes.id,
					customer_id: null,
					customer_name: '',
					net_weight: row.fill_weight,
					loss_weight: null,
					note: payload.remark,
					created_at: now,
					created_by: user?._id || null,
					created_by_name: user?.username || ''
				})
			}
			success += 1
			if (inventoryLinked && row.bottle_no) touchedBottleNos.push(row.bottle_no)
		} catch (err) {
			failedItems.push({
				line_no: row.line_no,
				bottle_no: row.bottle_no,
					error: normalizeString(err && err.message) || '新增失败'
			})
		}
	}

	const touchRes = await triggerAnomalyTouchV2(user, token, touchedBottleNos, requestId)
	await recordLog(
		user,
		'filling_batch_create_v1',
		{
			date: payload.date,
			record_type: payload.record_type,
			operator: operatorName,
			total: parsedRows.non_empty_total,
			target_total: toCreateRows.length,
			existing_total: existingItems.length,
			success,
			failed: failedItems.length,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)

	return {
		code: 0,
		msg: touchRes.warning ? `批量新增完成（${touchRes.warning}）` : '批量新增完成',
		data: {
			date: payload.date,
			total: parsedRows.non_empty_total,
			success,
			failed: failedItems.length,
			failed_items: failedItems.slice(0, 200),
			warning: touchRes.warning || ''
		}
	}
}

function parseBatchUpdateDatePayload(data = {}) {
	const preview = Boolean(data.preview)
	const scopeMode = normalizeString(data.scope_mode || data.scopeMode).toLowerCase()
	const newDate = normalizeString(data.new_date || data.newDate)
	if (!['ids', 'filter'].includes(scopeMode)) {
		return { ok: false, msg: '批量范围无效' }
	}
	if (!isValidDateString(newDate)) {
		return { ok: false, msg: '新灌装日期格式无效' }
	}

	const selector = data.selector && typeof data.selector === 'object' ? data.selector : {}
	if (scopeMode === 'ids') {
		const ids = normalizeUniqueIds(selector.ids)
		if (!ids.length) return { ok: false, msg: '勾选子集为空，请先勾选记录' }
		if (ids.length > BATCH_UPDATE_LIMIT) {
			return { ok: false, msg: `单次最多更新 ${BATCH_UPDATE_LIMIT} 条，请缩小范围` }
		}
		return {
			ok: true,
			data: {
				preview,
				scope_mode: 'ids',
				selector: { ids },
				new_date: newDate
			}
		}
	}

	const filterResult = buildListWhereByFilter(selector)
	if (!filterResult.ok) {
		return { ok: false, msg: filterResult.msg || '筛选参数无效' }
	}
	const hasFilter = Boolean(
		filterResult.filters.bottle_no ||
		filterResult.filters.operator ||
		filterResult.filters.record_type ||
		filterResult.filters.dateStart ||
		filterResult.filters.dateEnd
	)
	if (!hasFilter) {
		return { ok: false, msg: '按筛选全量模式至少填写一个筛选条件' }
	}
	return {
		ok: true,
		data: {
			preview,
			scope_mode: 'filter',
			where: filterResult.where,
			selector: filterResult.filters,
			new_date: newDate
		}
	}
}

function toSampleBottleNos(rows = []) {
	return rows
		.map((row) => normalizeBottleNo(row && row.bottle_no))
		.filter(Boolean)
		.slice(0, 20)
}

async function batchUpdateDateV1(user, data, requestId, token) {
	const parsed = parseBatchUpdateDatePayload(data)
	if (!parsed.ok) return { code: 400, msg: parsed.msg }
	const payload = parsed.data

	let targetRows = []
	let missingIds = []
	if (payload.scope_mode === 'ids') {
		const ids = payload.selector.ids
		const res = await fillings
			.where({ _id: dbCmd.in(ids) })
			.field({ _id: true, bottle_no: true, date: true, record_type: true })
			.get()
		targetRows = Array.isArray(res.data) ? res.data : []
		const foundIds = new Set(targetRows.map((row) => normalizeString(row && row._id)).filter(Boolean))
		missingIds = ids.filter((id) => !foundIds.has(id))
	} else {
		const rowsRes = await fetchFillingsByWhere(payload.where, BATCH_UPDATE_LIMIT)
		if (!rowsRes.ok) return { code: 400, msg: rowsRes.msg }
		targetRows = rowsRes.data || []
	}

	const sampleBottleNos = toSampleBottleNos(targetRows)
	if (payload.preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				scope_mode: payload.scope_mode,
				new_date: payload.new_date,
				target_total: targetRows.length,
				missing_total: missingIds.length,
				missing_ids: missingIds.slice(0, 50),
				sample_bottle_nos: sampleBottleNos,
				limit: BATCH_UPDATE_LIMIT
			}
		}
	}

	const failedItems = missingIds.map((id) => ({
		_id: id,
		bottle_no: '',
		error: '记录不存在'
	}))
	let success = 0
	const touchedBottleNos = []
	const now = Date.now()
	const eventDay = normalizeEventDay(payload.new_date, now)
	const eventAt = parseEventAt(payload.new_date, now)

	for (let i = 0; i < targetRows.length; i += 1) {
		const row = targetRows[i]
		const rowId = normalizeString(row && row._id)
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		const rowRecordType = normalizeRecordType(row && row.record_type, DEFAULT_RECORD_TYPE)
		const inventoryLinked = isInventoryLinkedRecordType(rowRecordType)
		if (!rowId) {
			failedItems.push({
				_id: rowId || '',
				bottle_no: bottleNo || '',
				error: '记录数据不完整'
			})
			continue
		}
		if (inventoryLinked && !bottleNo) {
			failedItems.push({
				_id: rowId,
				bottle_no: '',
				error: buildBottleRequiredMessage(rowRecordType)
			})
			continue
		}
		try {
			if (inventoryLinked && bottleNo) {
				const hasDuplicate = await hasDuplicateFillingByDateBottle(payload.new_date, bottleNo, rowId)
				if (hasDuplicate) {
					failedItems.push({
						_id: rowId,
						bottle_no: bottleNo,
						error: '目标日期已存在同瓶号记录'
					})
					continue
				}
			}
			await fillings.doc(rowId).update({
				date: payload.new_date,
				updated_at: Date.now()
			})
			if (inventoryLinked) {
				await movements.where({ source_id: rowId, type: 'fill' }).update({
					date: payload.new_date,
					event_day: eventDay,
					event_at: eventAt
				})
			} else {
				await movements.where({ source_id: rowId, type: 'fill' }).remove()
			}
			success += 1
			if (bottleNo) touchedBottleNos.push(bottleNo)
		} catch (err) {
			failedItems.push({
				_id: rowId,
				bottle_no: bottleNo,
				error: normalizeString(err && err.message) || '更新失败'
			})
		}
	}

	const touchRes = await triggerAnomalyTouchV2(user, token, touchedBottleNos, requestId)
	await recordLog(
		user,
		'filling_batch_update_date_v1',
		{
			scope_mode: payload.scope_mode,
			selector:
				payload.scope_mode === 'ids'
					? { ids_count: payload.selector.ids.length }
					: (payload.selector || {}),
			new_date: payload.new_date,
			total: targetRows.length + missingIds.length,
			success,
			failed: failedItems.length,
			touch_warning: touchRes.warning || ''
		},
		requestId
	)

	return {
		code: 0,
		msg: touchRes.warning ? `批量更新完成（${touchRes.warning}）` : '批量更新完成',
		data: {
			scope_mode: payload.scope_mode,
			new_date: payload.new_date,
			total: targetRows.length + missingIds.length,
			success,
			failed: failedItems.length,
			failed_items: failedItems.slice(0, 200),
			warning: touchRes.warning || ''
		}
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
	if (action === 'batchCreateV1') return batchCreateV1(user, data, requestId, token)
	if (action === 'batchUpdateDateV1') return batchUpdateDateV1(user, data, requestId, token)
	if (action === 'cleanupNoSaleMovementsV1') return cleanupNoSaleMovementsV1(user, data, requestId, token)

	return { code: 400, msg: '未知 action' }
}
