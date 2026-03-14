'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const bottles = db.collection('crm_bottles')

const STATUS = ['unknown', 'in_station', 'at_customer', 'scrapped', 'lost']
const CHECK_CYCLE_MONTHS = [6, 12, 24, 36]

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
		console.error('[crm-bottle] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeCode(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeStatus(value) {
	const s = normalizeString(value) || 'unknown'
	return STATUS.includes(s) ? s : null
}

function normalizeDate(value) {
	return normalizeString(value)
}

function isValidDateString(value) {
	const text = normalizeDate(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [year, month, day] = text.split('-').map((item) => Number(item))
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
	if (month < 1 || month > 12) return false
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	return day >= 1 && day <= maxDay
}

function toNullableNumber(value) {
	if (value == null) return null
	const text = normalizeString(value)
	if (!text) return null
	const num = Number(text)
	return Number.isFinite(num) ? num : NaN
}

function toCycleMonths(value) {
	const num = Number(value)
	if (!Number.isInteger(num)) return null
	return CHECK_CYCLE_MONTHS.includes(num) ? num : null
}

function hasOwn(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key)
}

function normalizeBottlePayload(data = {}, { forUpdate = false } = {}) {
	const patch = {}

	const bottleNoRaw = data.bottle_no
	if (!forUpdate || bottleNoRaw != null) patch.bottle_no = normalizeBottleNo(bottleNoRaw)

	const statusRaw = data.status
	if (!forUpdate || statusRaw != null) patch.status = normalizeStatus(statusRaw)

	const fillingCompanyRaw = data.filling_company
	if (!forUpdate || fillingCompanyRaw != null) patch.filling_company = normalizeString(fillingCompanyRaw)

	const registrationMarkRaw = data.registration_mark
	if (!forUpdate || registrationMarkRaw != null) patch.registration_mark = normalizeString(registrationMarkRaw)

	const equipmentTypeRaw = data.equipment_type
	if (!forUpdate || equipmentTypeRaw != null) patch.equipment_type = normalizeString(equipmentTypeRaw)

	const productNoRaw = data.product_no
	if (!forUpdate || productNoRaw != null) patch.product_no = normalizeCode(productNoRaw)

	const qrCodeRaw = data.qr_code
	if (!forUpdate || qrCodeRaw != null) patch.qr_code = normalizeCode(qrCodeRaw)

	const manufacturerRaw = data.manufacturer
	if (!forUpdate || manufacturerRaw != null) patch.manufacturer = normalizeString(manufacturerRaw)

	if (!forUpdate || hasOwn(data, 'volume_l')) patch.volume_l = toNullableNumber(data.volume_l)

	const manufactureDateRaw = data.manufacture_date
	if (!forUpdate || manufactureDateRaw != null) patch.manufacture_date = normalizeDate(manufactureDateRaw)

	const bottleCheckDateRaw = data.bottle_check_date
	if (!forUpdate || bottleCheckDateRaw != null) patch.bottle_check_date = normalizeDate(bottleCheckDateRaw)

	const bottleNextCheckDateRaw = data.bottle_next_check_date
	if (!forUpdate || bottleNextCheckDateRaw != null) patch.bottle_next_check_date = normalizeDate(bottleNextCheckDateRaw)

	if (!forUpdate || hasOwn(data, 'bottle_check_cycle_months')) {
		patch.bottle_check_cycle_months = toCycleMonths(data.bottle_check_cycle_months)
	}

	if (!forUpdate || hasOwn(data, 'bottle_check_fee')) patch.bottle_check_fee = toNullableNumber(data.bottle_check_fee)

	const scrapDueDateRaw = data.scrap_due_date
	if (!forUpdate || scrapDueDateRaw != null) patch.scrap_due_date = normalizeDate(scrapDueDateRaw)

	const gaugeNoRaw = data.pressure_gauge_no
	if (!forUpdate || gaugeNoRaw != null) patch.pressure_gauge_no = normalizeCode(gaugeNoRaw)

	const gaugeManufacturerRaw = data.pressure_gauge_manufacturer
	if (!forUpdate || gaugeManufacturerRaw != null) {
		patch.pressure_gauge_manufacturer = normalizeString(gaugeManufacturerRaw)
	}

	if (!forUpdate || hasOwn(data, 'pressure_gauge_range_min')) {
		patch.pressure_gauge_range_min = toNullableNumber(data.pressure_gauge_range_min)
	}
	if (!forUpdate || hasOwn(data, 'pressure_gauge_range_max')) {
		patch.pressure_gauge_range_max = toNullableNumber(data.pressure_gauge_range_max)
	}

	const gaugeCheckDateRaw = data.pressure_gauge_check_date
	if (!forUpdate || gaugeCheckDateRaw != null) {
		patch.pressure_gauge_check_date = normalizeDate(gaugeCheckDateRaw)
	}

	const gaugeNextCheckDateRaw = data.pressure_gauge_next_check_date
	if (!forUpdate || gaugeNextCheckDateRaw != null) {
		patch.pressure_gauge_next_check_date = normalizeDate(gaugeNextCheckDateRaw)
	}

	if (!forUpdate || hasOwn(data, 'pressure_gauge_cycle_months')) {
		patch.pressure_gauge_cycle_months = toCycleMonths(data.pressure_gauge_cycle_months)
	}

	if (!forUpdate || hasOwn(data, 'pressure_gauge_check_fee')) {
		patch.pressure_gauge_check_fee = toNullableNumber(data.pressure_gauge_check_fee)
	}

	if (!forUpdate || hasOwn(data, 'safety_valve_count')) {
		const count = Number(data.safety_valve_count)
		patch.safety_valve_count = Number.isInteger(count) ? count : NaN
	}

	const valveCheckDateRaw = data.safety_valve_check_date
	if (!forUpdate || valveCheckDateRaw != null) patch.safety_valve_check_date = normalizeDate(valveCheckDateRaw)

	const valveNextCheckDateRaw = data.safety_valve_next_check_date
	if (!forUpdate || valveNextCheckDateRaw != null) {
		patch.safety_valve_next_check_date = normalizeDate(valveNextCheckDateRaw)
	}

	if (!forUpdate || hasOwn(data, 'safety_valve_cycle_months')) {
		patch.safety_valve_cycle_months = toCycleMonths(data.safety_valve_cycle_months)
	}

	if (!forUpdate || hasOwn(data, 'safety_valve_check_fee')) {
		patch.safety_valve_check_fee = toNullableNumber(data.safety_valve_check_fee)
	}

	if (!forUpdate || hasOwn(data, 'tare_weight')) patch.tare_weight = toNullableNumber(data.tare_weight)

	const currentCustomerIdRaw = data.current_customer_id
	if (!forUpdate || currentCustomerIdRaw != null) {
		patch.current_customer_id = currentCustomerIdRaw ? normalizeString(currentCustomerIdRaw) : null
	}

	const currentCustomerNameRaw = data.current_customer_name
	if (!forUpdate || currentCustomerNameRaw != null) {
		patch.current_customer_name = normalizeString(currentCustomerNameRaw)
	}

	const remarkRaw = data.remark
	if (!forUpdate || remarkRaw != null) patch.remark = normalizeString(remarkRaw)

	if (hasOwn(data, 'is_active')) patch.is_active = Boolean(data.is_active)

	return patch
}

function validateBottlePayload(doc = {}) {
	if (!doc.bottle_no) return '单位内编号必填'
	if (!doc.filling_company) return '充装单位必填'
	if (!doc.registration_mark) return '登记证标号必填'
	if (!doc.equipment_type) return '设备品种必填'
	if (!doc.product_no) return '产品编号必填'
	if (!doc.qr_code) return '二维码号必填'
	if (!doc.pressure_gauge_no) return '压力表号必填'

	if (!doc.status || !STATUS.includes(doc.status)) return '状态无效'

	if (!(typeof doc.volume_l === 'number' && Number.isFinite(doc.volume_l) && doc.volume_l > 0)) {
		return '容积必须为大于 0 的数字'
	}

	if (!(typeof doc.pressure_gauge_range_min === 'number' && Number.isFinite(doc.pressure_gauge_range_min) && doc.pressure_gauge_range_min >= 0)) {
		return '压力区间下限必须为非负数字'
	}
	if (!(typeof doc.pressure_gauge_range_max === 'number' && Number.isFinite(doc.pressure_gauge_range_max) && doc.pressure_gauge_range_max >= 0)) {
		return '压力区间上限必须为非负数字'
	}
	if (doc.pressure_gauge_range_min > doc.pressure_gauge_range_max) {
		return '压力区间下限不能大于上限'
	}

	if (doc.tare_weight != null && !(typeof doc.tare_weight === 'number' && Number.isFinite(doc.tare_weight) && doc.tare_weight >= 0)) {
		return '标准皮重必须为非负数字'
	}
	if (doc.bottle_check_fee != null && !(typeof doc.bottle_check_fee === 'number' && Number.isFinite(doc.bottle_check_fee) && doc.bottle_check_fee >= 0)) {
		return '钢瓶检测费用必须为非负数字'
	}
	if (doc.pressure_gauge_check_fee != null && !(typeof doc.pressure_gauge_check_fee === 'number' && Number.isFinite(doc.pressure_gauge_check_fee) && doc.pressure_gauge_check_fee >= 0)) {
		return '压力表检测费用必须为非负数字'
	}
	if (doc.safety_valve_check_fee != null && !(typeof doc.safety_valve_check_fee === 'number' && Number.isFinite(doc.safety_valve_check_fee) && doc.safety_valve_check_fee >= 0)) {
		return '安全阀检测费用必须为非负数字'
	}

	if (!isValidDateString(doc.manufacture_date)) return '制造日期格式无效'
	if (!isValidDateString(doc.bottle_check_date)) return '钢瓶检验日期格式无效'
	if (!isValidDateString(doc.bottle_next_check_date)) return '钢瓶下次检验日期格式无效'
	if (!isValidDateString(doc.scrap_due_date)) return '报废期限格式无效'
	if (!isValidDateString(doc.pressure_gauge_check_date)) return '压力表检验日期格式无效'
	if (!isValidDateString(doc.pressure_gauge_next_check_date)) return '压力表下次检验日期格式无效'
	if (!isValidDateString(doc.safety_valve_check_date)) return '安全阀检测日期格式无效'
	if (!isValidDateString(doc.safety_valve_next_check_date)) return '安全阀下次检测日期格式无效'

	if (!CHECK_CYCLE_MONTHS.includes(Number(doc.bottle_check_cycle_months))) return '钢瓶检测周期无效'
	if (!CHECK_CYCLE_MONTHS.includes(Number(doc.pressure_gauge_cycle_months))) return '压力表检测周期无效'
	if (!CHECK_CYCLE_MONTHS.includes(Number(doc.safety_valve_cycle_months))) return '安全阀检测周期无效'

	if (Number(doc.safety_valve_count) !== 2) return '安全阀数量固定为 2'

	return ''
}

async function findDuplicateByField(field, value, excludeId = '') {
	if (!value) return null
	const conditions = [{ [field]: value }]
	if (excludeId) conditions.push({ _id: dbCmd.neq(excludeId) })
	const where = conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)
	const res = await bottles.where(where).field({ _id: true }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function ensureBottleIdentityUnique(doc, excludeId = '') {
	const duplicateBottle = await findDuplicateByField('bottle_no', doc.bottle_no, excludeId)
	if (duplicateBottle) return '单位内编号已存在'

	const duplicateQr = await findDuplicateByField('qr_code', doc.qr_code, excludeId)
	if (duplicateQr) return '二维码号已存在'

	const duplicateGauge = await findDuplicateByField('pressure_gauge_no', doc.pressure_gauge_no, excludeId)
	if (duplicateGauge) return '压力表号已存在'

	return ''
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listV1(user, data) {
	void user
	const keyword = normalizeString(data.keyword)
	const status = normalizeString(data.status)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 20) || 20, 1),
		50
	)

	const conditions = []
	if (data.is_active != null) {
		const raw = data.is_active
		if (raw === true || raw === 'true' || raw === 1 || raw === '1') conditions.push({ is_active: true })
		else if (raw === false || raw === 'false' || raw === 0 || raw === '0') conditions.push({ is_active: false })
	}

	if (status) {
		const s = normalizeStatus(status)
		if (!s) return { code: 400, msg: '状态无效' }
		conditions.push({ status: s })
	}

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ bottle_no: rx }, { current_customer_name: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await bottles
		.where(where)
		.orderBy('updated_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const totalRes = await bottles.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
	const hasBaseFilter = conditions.length > 0
	const mergeWhere = (extra) => (hasBaseFilter ? dbCmd.and([where, extra]) : extra)

	const inStationRes = await bottles.where(mergeWhere({ status: 'in_station' })).count()
	const atCustomerRes = await bottles.where(mergeWhere({ status: 'at_customer' })).count()
	const abnormalRes = await bottles
		.where(mergeWhere(dbCmd.or([{ status: 'scrapped' }, { status: 'lost' }])))
		.count()

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
			in_station: Number(inStationRes.total || 0),
			at_customer: Number(atCustomerRes.total || 0),
			abnormal: Number(abnormalRes.total || 0)
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少钢瓶 ID' }
	const res = await bottles.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '钢瓶不存在' }
	return { code: 0, data: doc }
}

async function createV1(user, data, requestId) {
	const normalized = normalizeBottlePayload(data, { forUpdate: false })
	normalized.safety_valve_count = 2

	const validationMsg = validateBottlePayload(normalized)
	if (validationMsg) return { code: 400, msg: validationMsg }

	const uniqueMsg = await ensureBottleIdentityUnique(normalized)
	if (uniqueMsg) return { code: 409, msg: uniqueMsg }

	const now = Date.now()
	const doc = {
		...normalized,
		is_active: normalized.is_active == null ? true : Boolean(normalized.is_active),
		created_at: now,
		updated_at: now
	}

	const res = await bottles.add(doc)
	await recordLog(user, 'bottle_create_v1', { id: res.id }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少钢瓶 ID' }

	const current = await bottles.doc(id).get()
	const existing = (current.data && current.data[0]) || null
	if (!existing) return { code: 404, msg: '钢瓶不存在' }

	const patch = normalizeBottlePayload(data, { forUpdate: true })
	const merged = {
		...existing,
		...patch
	}
	if (merged.safety_valve_count == null) merged.safety_valve_count = 2
	if (merged.is_active == null) merged.is_active = true

	const validationMsg = validateBottlePayload(merged)
	if (validationMsg) return { code: 400, msg: validationMsg }

	const uniqueMsg = await ensureBottleIdentityUnique(merged, id)
	if (uniqueMsg) return { code: 409, msg: uniqueMsg }

	patch.updated_at = Date.now()

	await bottles.doc(id).update(patch)
	await recordLog(user, 'bottle_update_v1', { id }, requestId)
	return { code: 0, msg: '更新成功' }
}

function collectDuplicateValues(rows, field, sampleLimit) {
	const map = new Map()
	rows.forEach((row) => {
		const value = normalizeString(row[field]).toUpperCase()
		if (!value) return
		const bucket = map.get(value) || { value, count: 0, ids: [] }
		bucket.count += 1
		if (bucket.ids.length < sampleLimit && row._id) bucket.ids.push(row._id)
		map.set(value, bucket)
	})
	return Array.from(map.values())
		.filter((item) => item.count > 1)
		.sort((a, b) => b.count - a.count)
		.slice(0, sampleLimit)
}

async function auditUniqueFieldsV1(user, data) {
	void user
	const sampleLimit = Math.min(Math.max(Number(data.sampleLimit || 20) || 20, 1), 100)
	const pageSize = 200
	let page = 0
	const rows = []

	while (true) {
		const res = await bottles
			.field({
				_id: true,
				bottle_no: true,
				qr_code: true,
				pressure_gauge_no: true
			})
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const list = res.data || []
		rows.push(...list)
		if (list.length < pageSize) break
		page += 1
	}

	let emptyBottleNo = 0
	let emptyQrCode = 0
	let emptyGaugeNo = 0

	rows.forEach((row) => {
		if (!normalizeString(row.bottle_no)) emptyBottleNo += 1
		if (!normalizeString(row.qr_code)) emptyQrCode += 1
		if (!normalizeString(row.pressure_gauge_no)) emptyGaugeNo += 1
	})

	return {
		code: 0,
		data: {
			total: rows.length,
			empty: {
				bottle_no: emptyBottleNo,
				qr_code: emptyQrCode,
				pressure_gauge_no: emptyGaugeNo
			},
			duplicates: {
				bottle_no: collectDuplicateValues(rows, 'bottle_no', sampleLimit),
				qr_code: collectDuplicateValues(rows, 'qr_code', sampleLimit),
				pressure_gauge_no: collectDuplicateValues(rows, 'pressure_gauge_no', sampleLimit)
			}
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
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'updateV1') return updateV1(user, data, requestId)
	if (action === 'auditUniqueFieldsV1') return auditUniqueFieldsV1(user, data)

	return { code: 400, msg: '未知 action' }
}
