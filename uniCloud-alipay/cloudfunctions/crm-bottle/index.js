'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const bottles = db.collection('crm_bottles')

const STATUS = ['unknown', 'in_station', 'at_customer', 'scrapped', 'lost']
const CHECK_CYCLE_MONTHS = [6, 12, 24, 36]
const INSPECTION_DUE_MODULES = ['bottle', 'gauge', 'valve']
const INSPECTION_DUE_STATES = ['overdue', 'due_60d']
const BATCH_INSPECTION_LIMIT = 2000
const BOTTLE_NUMERIC_SEGMENT_SCAN_LIMIT = 5000
const BOTTLE_SORT_BACKFILL_LIMIT = 5000

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

function buildBottleNoSortMeta(value) {
	const text = normalizeBottleNo(value)
	const isNumeric = /^\d+$/.test(text)
	const num = isNumeric ? Number(text) : null
	const normalizedNum = Number.isFinite(num) ? num : 0
	const naturalText = (text.match(/\d+|\D+/g) || [text])
		.map((token) => {
			if (/^\d+$/.test(token)) return `#${String(Number(token)).padStart(12, '0')}`
			return `$${token}`
		})
		.join('')
	const key = isNumeric
		? `0:${String(normalizedNum).padStart(12, '0')}:${text}`
		: `1:999999999999:${naturalText}:${text}`
	return {
		bottle_no_sort_group: isNumeric ? 0 : 1,
		bottle_no_sort_num: isNumeric ? normalizedNum : null,
		bottle_no_sort_text: text,
		bottle_no_sort_key: key
	}
}

function hasBottleNoSortMeta(doc = {}) {
	const group = Number(doc.bottle_no_sort_group)
	const text = normalizeString(doc.bottle_no_sort_text)
	const key = normalizeString(doc.bottle_no_sort_key)
	const num = doc.bottle_no_sort_num
	const hasGroup = Number.isInteger(group) && (group === 0 || group === 1)
	const hasText = Boolean(text)
	const hasKey = Boolean(key)
	const hasNum = num === null || (typeof num === 'number' && Number.isFinite(num))
	return hasGroup && hasText && hasKey && hasNum
}

function isBottleNoSortMetaSame(doc = {}, meta = {}) {
	const group = Number(doc.bottle_no_sort_group)
	const num = doc.bottle_no_sort_num
	const text = normalizeString(doc.bottle_no_sort_text)
	const key = normalizeString(doc.bottle_no_sort_key)
	return (
		group === Number(meta.bottle_no_sort_group) &&
		(num == null ? null : Number(num)) === (meta.bottle_no_sort_num == null ? null : Number(meta.bottle_no_sort_num)) &&
		text === normalizeString(meta.bottle_no_sort_text) &&
		key === normalizeString(meta.bottle_no_sort_key)
	)
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

function getCNDate(ts = Date.now()) {
	return new Date(ts + 8 * 60 * 60 * 1000)
}

function formatDateCN(date) {
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
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

function addDaysDateCN(dateText, days) {
	if (!isValidDateString(dateText)) return ''
	const [year, month, day] = dateText.split('-').map((item) => Number(item))
	const date = new Date(Date.UTC(year, month - 1, day))
	date.setUTCDate(date.getUTCDate() + Number(days || 0))
	return formatDateCN(date)
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

function toBoolean(value, fallback = false) {
	if (value === true || value === 'true' || value === 1 || value === '1') return true
	if (value === false || value === 'false' || value === 0 || value === '0') return false
	return fallback
}

function toNonNegativeInteger(value) {
	if (value == null) return null
	const text = normalizeString(value)
	if (!text) return null
	const num = Number(text)
	if (!Number.isInteger(num) || num < 0) return NaN
	return num
}

function parseInspectionDateEqPair(data = {}, keys = {}, label = '检验批次') {
	const checkDate = normalizeDate(data[keys.check] ?? data[keys.checkAlt])
	const nextDate = normalizeDate(data[keys.next] ?? data[keys.nextAlt])
	const hasCheck = Boolean(checkDate)
	const hasNext = Boolean(nextDate)
	if (hasNext && !hasCheck) {
		return { ok: false, msg: `${label}筛选填写下次检验日期时，检验日期必填` }
	}
	if (hasCheck && !isValidDateString(checkDate)) {
		return { ok: false, msg: `${label}检验日期格式无效` }
	}
	if (hasNext && !isValidDateString(nextDate)) {
		return { ok: false, msg: `${label}下次检验日期格式无效` }
	}
	return {
		ok: true,
		data: {
			check_date_eq: hasCheck ? checkDate : '',
			next_check_date_eq: hasNext ? nextDate : ''
		}
	}
}

function resolveInspectionDueField(moduleValue) {
	if (moduleValue === 'bottle') return 'bottle_next_check_date'
	if (moduleValue === 'gauge') return 'pressure_gauge_next_check_date'
	if (moduleValue === 'valve') return 'safety_valve_next_check_date'
	return ''
}

function parseInspectionDueFilter(data = {}) {
	const moduleValue = normalizeString(data.inspection_due_module ?? data.inspectionDueModule).toLowerCase()
	const stateValue = normalizeString(data.inspection_due_state ?? data.inspectionDueState).toLowerCase()
	if (!moduleValue && !stateValue) {
		return {
			ok: true,
			data: {
				module: '',
				state: '',
				field: '',
				today: '',
				due_end: ''
			}
		}
	}
	if (moduleValue && !stateValue) {
		return { ok: false, msg: '到期提醒筛选缺少状态' }
	}
	if (!moduleValue && stateValue) {
		return { ok: false, msg: '到期提醒筛选缺少模块' }
	}
	if (!INSPECTION_DUE_MODULES.includes(moduleValue)) {
		return { ok: false, msg: '到期提醒模块无效' }
	}
	if (!INSPECTION_DUE_STATES.includes(stateValue)) {
		return { ok: false, msg: '到期提醒状态无效' }
	}
	const today = formatDateCN(getCNDate())
	const dueEnd = addDaysDateCN(today, 60)
	return {
		ok: true,
		data: {
			module: moduleValue,
			state: stateValue,
			field: resolveInspectionDueField(moduleValue),
			today,
			due_end: dueEnd
		}
	}
}

function parseBottleNoNumericValue(value) {
	const text = normalizeString(value)
	if (!/^\d+$/.test(text)) return null
	const num = Number(text)
	return Number.isFinite(num) ? num : null
}

function applyBottleNoNumericRange(rows = [], start = null, end = null) {
	if (start == null && end == null) return rows.slice()
	return rows.filter((row) => {
		const bottleNoNum = parseBottleNoNumericValue(row && row.bottle_no)
		if (bottleNoNum == null) return false
		if (start != null && bottleNoNum < start) return false
		if (end != null && bottleNoNum > end) return false
		return true
	})
}

function buildSummaryByRows(rows = []) {
	let inStation = 0
	let atCustomer = 0
	let abnormal = 0
	for (let i = 0; i < rows.length; i += 1) {
		const status = normalizeString(rows[i] && rows[i].status)
		if (status === 'in_station') inStation += 1
		if (status === 'at_customer') atCustomer += 1
		if (status === 'scrapped' || status === 'lost') abnormal += 1
	}
	return {
		total: rows.length,
		in_station: inStation,
		at_customer: atCustomer,
		abnormal: abnormal
	}
}

function applyBottleNaturalOrder(query) {
	return query.orderBy('bottle_no_sort_key', 'asc')
}

function buildBottleListWhereByFilter(data = {}) {
	const keyword = normalizeString(data.keyword)
	const status = normalizeString(data.status)
	const bottleNoModeRaw = normalizeString(data.bottle_no_mode ?? data.bottleNoMode).toLowerCase()
	const bottleNoMode = bottleNoModeRaw || 'all'
	const bottleNoPrefix = normalizeString(data.bottle_no_prefix ?? data.bottleNoPrefix)
	const numericStart = toNonNegativeInteger(data.bottle_no_numeric_start ?? data.bottleNoNumericStart)
	const numericEnd = toNonNegativeInteger(data.bottle_no_numeric_end ?? data.bottleNoNumericEnd)
	const dueFilterResult = parseInspectionDueFilter(data)

	if (!['all', 'numeric', 'prefix'].includes(bottleNoMode)) {
		return { ok: false, msg: '瓶号规则无效' }
	}
	if (!dueFilterResult.ok) return { ok: false, msg: dueFilterResult.msg }
	if (bottleNoMode === 'prefix' && !bottleNoPrefix) {
		return { ok: false, msg: '瓶号前缀不能为空' }
	}
	if (Number.isNaN(numericStart) || Number.isNaN(numericEnd)) {
		return { ok: false, msg: '纯数字分段必须为非负整数' }
	}
	if ((numericStart != null || numericEnd != null) && bottleNoMode !== 'numeric') {
		return { ok: false, msg: '纯数字分段仅可在瓶号规则=纯数字时使用' }
	}
	if (numericStart != null && numericEnd != null && numericStart > numericEnd) {
		return { ok: false, msg: '纯数字分段起始号不能大于结束号' }
	}

	const conditions = []
	let isActive = undefined
	if (data.is_active != null) {
		const raw = data.is_active
		if (raw === true || raw === 'true' || raw === 1 || raw === '1') {
			isActive = true
			conditions.push({ is_active: true })
		} else if (raw === false || raw === 'false' || raw === 0 || raw === '0') {
			isActive = false
			conditions.push({ is_active: false })
		}
	}

	if (status) {
		const s = normalizeStatus(status)
		if (!s) return { ok: false, msg: '状态无效' }
		conditions.push({ status: s })
	}

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ bottle_no: rx }, { current_customer_name: rx }]))
	}

	if (bottleNoMode === 'numeric') {
		conditions.push({ bottle_no: db.RegExp({ regexp: '^[0-9]+$', options: '' }) })
	} else if (bottleNoMode === 'prefix') {
		conditions.push({ bottle_no: db.RegExp({ regexp: `^${escapeRegExp(bottleNoPrefix)}`, options: 'i' }) })
	}

	const bottlePair = parseInspectionDateEqPair(
		data,
		{
			check: 'bottle_check_date_eq',
			next: 'bottle_next_check_date_eq',
			checkAlt: 'bottleCheckDateEq',
			nextAlt: 'bottleNextCheckDateEq'
		},
		'钢瓶检验批次'
	)
	if (!bottlePair.ok) return { ok: false, msg: bottlePair.msg }
	if (bottlePair.data.check_date_eq) {
		conditions.push({ bottle_check_date: bottlePair.data.check_date_eq })
	}
	if (bottlePair.data.next_check_date_eq) {
		conditions.push({ bottle_next_check_date: bottlePair.data.next_check_date_eq })
	}

	const gaugePair = parseInspectionDateEqPair(
		data,
		{
			check: 'gauge_check_date_eq',
			next: 'gauge_next_check_date_eq',
			checkAlt: 'gaugeCheckDateEq',
			nextAlt: 'gaugeNextCheckDateEq'
		},
		'压力表检验批次'
	)
	if (!gaugePair.ok) return { ok: false, msg: gaugePair.msg }
	if (gaugePair.data.check_date_eq) {
		conditions.push({ pressure_gauge_check_date: gaugePair.data.check_date_eq })
	}
	if (gaugePair.data.next_check_date_eq) {
		conditions.push({ pressure_gauge_next_check_date: gaugePair.data.next_check_date_eq })
	}

	const valvePair = parseInspectionDateEqPair(
		data,
		{
			check: 'valve_check_date_eq',
			next: 'valve_next_check_date_eq',
			checkAlt: 'valveCheckDateEq',
			nextAlt: 'valveNextCheckDateEq'
		},
		'安全阀检验批次'
	)
	if (!valvePair.ok) return { ok: false, msg: valvePair.msg }
	if (valvePair.data.check_date_eq) {
		conditions.push({ safety_valve_check_date: valvePair.data.check_date_eq })
	}
	if (valvePair.data.next_check_date_eq) {
		conditions.push({ safety_valve_next_check_date: valvePair.data.next_check_date_eq })
	}

	if (dueFilterResult.data.field) {
		const dueField = dueFilterResult.data.field
		const validDateRx = db.RegExp({ regexp: '^\\d{4}-\\d{2}-\\d{2}$', options: '' })
		conditions.push({ [dueField]: validDateRx })
		if (dueFilterResult.data.state === 'overdue') {
			conditions.push({ [dueField]: dbCmd.lt(dueFilterResult.data.today) })
		} else {
			conditions.push({ [dueField]: dbCmd.gte(dueFilterResult.data.today) })
			conditions.push({ [dueField]: dbCmd.lte(dueFilterResult.data.due_end) })
		}
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)
	const needsNumericPostFilter = bottleNoMode === 'numeric' && (numericStart != null || numericEnd != null)

	return {
		ok: true,
		where,
		hasBaseFilter: conditions.length > 0,
		needs_numeric_post_filter: needsNumericPostFilter,
		bottle_no_numeric_start: numericStart,
		bottle_no_numeric_end: numericEnd,
		scan_limit: BOTTLE_NUMERIC_SEGMENT_SCAN_LIMIT,
		filters: {
			keyword,
			status,
			is_active: isActive,
			bottle_no_mode: bottleNoMode,
			bottle_no_prefix: bottleNoPrefix,
			bottle_no_numeric_start: numericStart,
			bottle_no_numeric_end: numericEnd,
			bottle_check_date_eq: bottlePair.data.check_date_eq,
			bottle_next_check_date_eq: bottlePair.data.next_check_date_eq,
				gauge_check_date_eq: gaugePair.data.check_date_eq,
				gauge_next_check_date_eq: gaugePair.data.next_check_date_eq,
				valve_check_date_eq: valvePair.data.check_date_eq,
				valve_next_check_date_eq: valvePair.data.next_check_date_eq,
				inspection_due_module: dueFilterResult.data.module,
				inspection_due_state: dueFilterResult.data.state
			}
		}
}

function addMonthsDate(dateText, months) {
	if (!isValidDateString(dateText)) return ''
	const [year, month, day] = dateText.split('-').map((item) => Number(item))
	const totalMonth = month - 1 + Number(months || 0)
	const targetYear = year + Math.floor(totalMonth / 12)
	const targetMonth = ((totalMonth % 12) + 12) % 12
	const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
	const safeDay = Math.min(day, maxDay)
	return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function normalizeUniqueIds(rawIds) {
	if (!Array.isArray(rawIds)) return []
	const set = new Set()
	const ids = []
	for (let i = 0; i < rawIds.length; i += 1) {
		const id = normalizeString(rawIds[i])
		if (!id || set.has(id)) continue
		set.add(id)
		ids.push(id)
	}
	return ids
}

function parseInspectionModuleInput(raw, label) {
	if (!raw || typeof raw !== 'object') return { ok: false, msg: `${label}参数缺失` }
	const checkDate = normalizeDate(raw.check_date ?? raw.checkDate)
	const cycleMonths = toCycleMonths(raw.cycle_months ?? raw.cycleMonths)
	const nextOverride = normalizeDate(raw.next_check_date_override ?? raw.nextCheckDateOverride)

	if (!isValidDateString(checkDate)) return { ok: false, msg: `${label}检验日期格式无效` }
	if (cycleMonths == null) return { ok: false, msg: `${label}检测周期无效` }
	if (nextOverride && !isValidDateString(nextOverride)) return { ok: false, msg: `${label}下次检验日期格式无效` }

	return {
		ok: true,
		data: {
			check_date: checkDate,
			cycle_months: cycleMonths,
			next_check_date_override: nextOverride || ''
		}
	}
}

function parseBatchInspectionPayload(data = {}) {
	const preview = toBoolean(data.preview, false)
	const scopeMode = normalizeString(data.scope_mode ?? data.scopeMode).toLowerCase()
	if (!['filter', 'ids'].includes(scopeMode)) {
		return { ok: false, msg: '更新范围无效' }
	}

	const selector = data.selector && typeof data.selector === 'object' ? data.selector : {}
	const modulesRaw = data.modules && typeof data.modules === 'object' ? data.modules : {}
	const modules = {}

	if (hasOwn(modulesRaw, 'bottle')) {
		const parsed = parseInspectionModuleInput(modulesRaw.bottle, '钢瓶检验')
		if (!parsed.ok) return { ok: false, msg: parsed.msg }
		modules.bottle = parsed.data
	}
	if (hasOwn(modulesRaw, 'gauge')) {
		const parsed = parseInspectionModuleInput(modulesRaw.gauge, '压力表检验')
		if (!parsed.ok) return { ok: false, msg: parsed.msg }
		modules.gauge = parsed.data
	}
	if (hasOwn(modulesRaw, 'valve')) {
		const parsed = parseInspectionModuleInput(modulesRaw.valve, '安全阀检验')
		if (!parsed.ok) return { ok: false, msg: parsed.msg }
		modules.valve = parsed.data
	}
	if (!Object.keys(modules).length) {
		return { ok: false, msg: '至少选择一个更新模块' }
	}

	if (scopeMode === 'ids') {
		const ids = normalizeUniqueIds(selector.ids)
		if (!ids.length) return { ok: false, msg: '勾选子集为空，请先勾选钢瓶' }
		return {
			ok: true,
			data: {
				preview,
				scope_mode: 'ids',
				selector: { ids },
				modules
			}
		}
	}

	const whereResult = buildBottleListWhereByFilter(selector)
	if (!whereResult.ok) return { ok: false, msg: whereResult.msg }
	return {
		ok: true,
		data: {
			preview,
			scope_mode: 'filter',
			where: whereResult.where,
			where_meta: {
				needs_numeric_post_filter: Boolean(whereResult.needs_numeric_post_filter),
				bottle_no_numeric_start: whereResult.bottle_no_numeric_start,
				bottle_no_numeric_end: whereResult.bottle_no_numeric_end,
				scan_limit: whereResult.scan_limit
			},
			selector: whereResult.filters,
			modules
		}
	}
}

function buildBatchInspectionPatch(modules) {
	const patch = {}
	if (modules.bottle) {
		patch.bottle_check_date = modules.bottle.check_date
		patch.bottle_check_cycle_months = Number(modules.bottle.cycle_months)
		patch.bottle_next_check_date =
			modules.bottle.next_check_date_override || addMonthsDate(modules.bottle.check_date, modules.bottle.cycle_months)
	}
	if (modules.gauge) {
		patch.pressure_gauge_check_date = modules.gauge.check_date
		patch.pressure_gauge_cycle_months = Number(modules.gauge.cycle_months)
		patch.pressure_gauge_next_check_date =
			modules.gauge.next_check_date_override || addMonthsDate(modules.gauge.check_date, modules.gauge.cycle_months)
	}
	if (modules.valve) {
		patch.safety_valve_check_date = modules.valve.check_date
		patch.safety_valve_cycle_months = Number(modules.valve.cycle_months)
		patch.safety_valve_next_check_date =
			modules.valve.next_check_date_override || addMonthsDate(modules.valve.check_date, modules.valve.cycle_months)
	}
	return patch
}

function buildBatchInspectionFieldSummary(modules) {
	const list = []
	if (modules.bottle) {
		list.push({
			module: 'bottle',
			label: '钢瓶检验',
			check_date: modules.bottle.check_date,
			cycle_months: Number(modules.bottle.cycle_months),
			next_check_date: modules.bottle.next_check_date_override || 'auto'
		})
	}
	if (modules.gauge) {
		list.push({
			module: 'gauge',
			label: '压力表检验',
			check_date: modules.gauge.check_date,
			cycle_months: Number(modules.gauge.cycle_months),
			next_check_date: modules.gauge.next_check_date_override || 'auto'
		})
	}
	if (modules.valve) {
		list.push({
			module: 'valve',
			label: '安全阀检验',
			check_date: modules.valve.check_date,
			cycle_months: Number(modules.valve.cycle_months),
			next_check_date: modules.valve.next_check_date_override || 'auto'
		})
	}
	return list
}

async function fetchBottlesByIds(ids, field = { _id: true, bottle_no: true }) {
	const out = []
	const chunkSize = 80
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize)
		const res = await bottles.where({ _id: dbCmd.in(chunk) }).field(field).limit(chunk.length).get()
		const rows = (res && res.data) || []
		out.push(...rows)
	}
	return out
}

async function fetchBottlesByWhere(where, maxTotal = BATCH_INSPECTION_LIMIT, field = { _id: true, bottle_no: true }) {
	const out = []
	const pageSize = 200
	let page = 0
	while (out.length < maxTotal) {
		let query = bottles.where(where).field(field)
		query = applyBottleNaturalOrder(query)
		const res = await query.skip(page * pageSize).limit(pageSize).get()
		const rows = (res && res.data) || []
		out.push(...rows)
		if (rows.length < pageSize) break
		page += 1
	}
	return out.slice(0, maxTotal)
}

async function scanBottlesByWhereWithLimit(where, scanLimit = BOTTLE_NUMERIC_SEGMENT_SCAN_LIMIT, field = null) {
	const out = []
	const pageSize = 200
	let page = 0
	while (true) {
		let query = bottles.where(where)
		if (field && typeof field === 'object') query = query.field(field)
		query = applyBottleNaturalOrder(query)
		const res = await query.skip(page * pageSize).limit(pageSize).get()
		const rows = (res && res.data) || []
		if (!rows.length) break
		out.push(...rows)
		if (out.length > scanLimit) {
			return {
				rows: out.slice(0, scanLimit),
				overflow: true
			}
		}
		if (rows.length < pageSize) break
		page += 1
	}
	return {
		rows: out,
		overflow: false
	}
}

async function listV1(user, data) {
	void user
	const whereResult = buildBottleListWhereByFilter(data)
	if (!whereResult.ok) return { code: 400, msg: whereResult.msg }
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(
		Math.max(Number(data.pageSize ?? data.limit ?? 20) || 20, 1),
		50
	)
	const {
		where,
		hasBaseFilter,
		needs_numeric_post_filter: needsNumericPostFilter,
		bottle_no_numeric_start: numericStart,
		bottle_no_numeric_end: numericEnd,
		scan_limit: scanLimit
	} = whereResult

	if (needsNumericPostFilter) {
		const scanRes = await scanBottlesByWhereWithLimit(where, Number(scanLimit || BOTTLE_NUMERIC_SEGMENT_SCAN_LIMIT))
		if (scanRes.overflow) {
			return {
				code: 400,
				msg: `纯数字分段候选超过安全上限 ${Number(scanLimit || BOTTLE_NUMERIC_SEGMENT_SCAN_LIMIT)}，请缩小筛选范围`
			}
		}
		const filteredRows = applyBottleNoNumericRange(scanRes.rows, numericStart, numericEnd)
		const total = filteredRows.length
		const begin = (page - 1) * pageSize
		const pageRows = filteredRows.slice(begin, begin + pageSize)
		const hasMore = page * pageSize < total
		const summary = buildSummaryByRows(filteredRows)
		return {
			code: 0,
			data: pageRows,
			total,
			paging: {
				page,
				pageSize,
				total,
				hasMore
			},
			summary
		}
	}

	let listQuery = bottles.where(where)
	listQuery = applyBottleNaturalOrder(listQuery)
	const res = await listQuery.skip((page - 1) * pageSize).limit(pageSize).get()

	const totalRes = await bottles.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total
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

async function batchUpdateInspectionV1(user, data, requestId) {
	const parsed = parseBatchInspectionPayload(data || {})
	if (!parsed.ok) return { code: 400, msg: parsed.msg }

	const payload = parsed.data
	const fieldsSummary = buildBatchInspectionFieldSummary(payload.modules)

	let targetRows = []
	let requestedTotal = 0
	let missingIds = []

	if (payload.scope_mode === 'ids') {
		const ids = payload.selector.ids || []
		if (ids.length > BATCH_INSPECTION_LIMIT) {
			return { code: 400, msg: `目标数量超过单批上限 ${BATCH_INSPECTION_LIMIT}，请缩小范围` }
		}
		requestedTotal = ids.length
		const foundRows = await fetchBottlesByIds(ids, { _id: true, bottle_no: true })
		const foundMap = new Map(foundRows.map((row) => [String(row._id), row]))
		targetRows = ids.map((id) => foundMap.get(id)).filter(Boolean)
		missingIds = ids.filter((id) => !foundMap.has(id))
	} else {
		const whereMeta = payload.where_meta || {}
		if (whereMeta.needs_numeric_post_filter) {
			const scanLimit = Number(whereMeta.scan_limit || BOTTLE_NUMERIC_SEGMENT_SCAN_LIMIT)
			const scanRes = await scanBottlesByWhereWithLimit(payload.where, scanLimit, { _id: true, bottle_no: true })
			if (scanRes.overflow) {
				return { code: 400, msg: `纯数字分段候选超过安全上限 ${scanLimit}，请缩小筛选范围` }
			}
			const filteredRows = applyBottleNoNumericRange(
				scanRes.rows,
				whereMeta.bottle_no_numeric_start,
				whereMeta.bottle_no_numeric_end
			)
			requestedTotal = filteredRows.length
			if (requestedTotal > BATCH_INSPECTION_LIMIT) {
				return {
					code: 400,
					msg: `命中 ${requestedTotal} 条，超过单批上限 ${BATCH_INSPECTION_LIMIT}，请缩小筛选范围`
				}
			}
			targetRows = payload.preview ? filteredRows.slice(0, 20) : filteredRows
		} else {
			const totalRes = await bottles.where(payload.where).count()
			requestedTotal = Number(totalRes.total || 0)
			if (requestedTotal > BATCH_INSPECTION_LIMIT) {
				return {
					code: 400,
					msg: `命中 ${requestedTotal} 条，超过单批上限 ${BATCH_INSPECTION_LIMIT}，请缩小筛选范围`
				}
			}
				if (payload.preview) {
					let sampleQuery = bottles.where(payload.where).field({ _id: true, bottle_no: true })
					sampleQuery = applyBottleNaturalOrder(sampleQuery)
					const sampleRes = await sampleQuery.limit(20).get()
					targetRows = (sampleRes && sampleRes.data) || []
				} else {
				targetRows = await fetchBottlesByWhere(payload.where, BATCH_INSPECTION_LIMIT, { _id: true, bottle_no: true })
			}
		}
	}

	if (payload.preview) {
		const sampleBottleNos = targetRows
			.slice(0, 20)
			.map((item) => normalizeString(item && item.bottle_no))
			.filter(Boolean)
		const previewData = {
			scope_mode: payload.scope_mode,
			target_total: requestedTotal,
			found_total: payload.scope_mode === 'ids' ? targetRows.length : requestedTotal,
			missing_total: missingIds.length,
			sample_bottle_nos: sampleBottleNos,
			update_fields: fieldsSummary,
			limit: BATCH_INSPECTION_LIMIT
		}
		if (missingIds.length) previewData.missing_ids = missingIds.slice(0, 50)
		await recordLog(
			user,
			'bottle_batch_update_inspection_preview_v1',
			{
				scope_mode: payload.scope_mode,
				target_total: requestedTotal,
				found_total: payload.scope_mode === 'ids' ? targetRows.length : requestedTotal,
				missing_total: missingIds.length,
				modules: Object.keys(payload.modules)
			},
			requestId
		)
		return { code: 0, msg: '预览成功', data: previewData }
	}

	const patchBase = buildBatchInspectionPatch(payload.modules)
	const failedItems = []
	let success = 0

	for (let i = 0; i < missingIds.length; i += 1) {
		failedItems.push({
			_id: missingIds[i],
			bottle_no: '',
			error: '钢瓶不存在'
		})
	}

	const chunkSize = 20
	for (let i = 0; i < targetRows.length; i += chunkSize) {
		const chunk = targetRows.slice(i, i + chunkSize)
		const jobs = chunk.map((doc) =>
			bottles
				.doc(doc._id)
				.update({
					...patchBase,
					updated_at: Date.now()
				})
				.then(() => ({ ok: true, doc }))
				.catch((err) => ({
					ok: false,
					doc,
					error: err && err.message ? err.message : String(err)
				}))
		)
		const results = await Promise.all(jobs)
		for (let j = 0; j < results.length; j += 1) {
			const row = results[j]
			if (row.ok) {
				success += 1
			} else {
				failedItems.push({
					_id: row.doc && row.doc._id ? row.doc._id : '',
					bottle_no: normalizeString(row.doc && row.doc.bottle_no),
					error: row.error || '更新失败'
				})
			}
		}
	}

	const total = requestedTotal
	const failed = Math.max(total - success, 0)
	const executeData = {
		scope_mode: payload.scope_mode,
		total,
		success,
		failed,
		update_fields: fieldsSummary,
		failed_items: failedItems.slice(0, 200)
	}

	await recordLog(
		user,
		'bottle_batch_update_inspection_execute_v1',
		{
			scope_mode: payload.scope_mode,
			total,
			success,
			failed,
			modules: Object.keys(payload.modules)
		},
		requestId
	)

	return { code: 0, msg: '批量更新完成', data: executeData }
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
		...buildBottleNoSortMeta(normalized.bottle_no),
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
	const sortMeta = buildBottleNoSortMeta(merged.bottle_no)
	Object.assign(merged, sortMeta)
	Object.assign(patch, sortMeta)
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

async function backfillBottleSortKeysV1(user, data, requestId) {
	const preview = toBoolean(data.preview, false)
	const force = toBoolean(data.force ?? data.force_refresh, false)
	const limitInput = Number(data.limit || 2000)
	const pageSizeInput = Number(data.pageSize ?? data.page_size ?? 200)
	const limit = Math.min(
		Math.max(Number.isFinite(limitInput) ? Math.floor(limitInput) : 2000, 1),
		BOTTLE_SORT_BACKFILL_LIMIT
	)
	const pageSize = Math.min(
		Math.max(Number.isFinite(pageSizeInput) ? Math.floor(pageSizeInput) : 200, 20),
		200
	)

	const totalRes = await bottles.where({}).count()
	const total = Number(totalRes.total || 0)
	let scanned = 0
	let cursor = 0
	const candidates = []

	while (scanned < limit && cursor < total) {
		const currentBatch = Math.min(pageSize, limit - scanned, total - cursor)
		if (currentBatch <= 0) break
		const res = await bottles
			.field({
				_id: true,
				bottle_no: true,
				bottle_no_sort_group: true,
				bottle_no_sort_num: true,
				bottle_no_sort_text: true,
				bottle_no_sort_key: true
			})
			.orderBy('created_at', 'asc')
			.skip(cursor)
			.limit(currentBatch)
			.get()
		const rows = (res && res.data) || []
		if (!rows.length) break
		scanned += rows.length
		cursor += rows.length
		for (let i = 0; i < rows.length; i += 1) {
			const row = rows[i] || {}
			if (!row._id) continue
			const meta = buildBottleNoSortMeta(row.bottle_no)
			const same = isBottleNoSortMetaSame(row, meta)
			const needsUpdate = force ? !same : !hasBottleNoSortMeta(row) || !same
			if (!needsUpdate) continue
			candidates.push({
				_id: row._id,
				bottle_no: normalizeString(row.bottle_no),
				patch: meta
			})
		}
	}

	let updated = 0
	const failedItems = []
	if (!preview) {
		const chunkSize = 20
		for (let i = 0; i < candidates.length; i += chunkSize) {
			const chunk = candidates.slice(i, i + chunkSize)
			const jobs = chunk.map((item) =>
				bottles
					.doc(item._id)
					.update(item.patch)
					.then(() => ({ ok: true, item }))
					.catch((err) => ({
						ok: false,
						item,
						error: err && err.message ? err.message : String(err)
					}))
			)
			const results = await Promise.all(jobs)
			for (let j = 0; j < results.length; j += 1) {
				const row = results[j]
				if (row.ok) {
					updated += 1
					continue
				}
				failedItems.push({
					_id: row.item?._id || '',
					bottle_no: row.item?.bottle_no || '',
					error: row.error || '更新失败'
				})
			}
		}
	}

	const detail = {
		preview,
		force,
		limit,
		page_size: pageSize,
		total,
		scanned,
		target_total: candidates.length,
		updated: preview ? 0 : updated,
		failed: preview ? 0 : failedItems.length,
		has_more: cursor < total
	}
	await recordLog(user, 'bottle_backfill_sort_keys_v1', detail, requestId)

	return {
		code: 0,
		msg: preview ? '排序键回填预览完成' : '排序键回填完成',
		data: {
			...detail,
			sample_bottle_nos: candidates.slice(0, 30).map((item) => item.bottle_no),
			failed_items: failedItems.slice(0, 100)
		}
	}
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
	if (action === 'batchUpdateInspectionV1') return batchUpdateInspectionV1(user, data, requestId)
	if (action === 'backfillBottleSortKeysV1') return backfillBottleSortKeysV1(user, data, requestId)
	if (action === 'auditUniqueFieldsV1') return auditUniqueFieldsV1(user, data)

	return { code: 400, msg: '未知 action' }
}
