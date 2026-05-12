'use strict'

let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-bottle] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const bottles = db.collection('crm_bottles')
const movements = db.collection('crm_bottle_movements')
const saleRecords = db.collection('crm_sale_records')
const bottleImportBackups = db.collection('crm_bottles_import_backups')

const STATUS = ['unknown', 'in_station', 'at_customer', 'scrapped', 'lost']
const CHECK_CYCLE_MONTHS = [6, 12, 24, 36]
const INSPECTION_DUE_MODULES = ['bottle', 'gauge', 'valve']
const INSPECTION_DUE_STATES = ['overdue', 'due_60d']
const BATCH_INSPECTION_LIMIT = 2000
const BOTTLE_NUMERIC_SEGMENT_SCAN_LIMIT = 5000
const BOTTLE_SORT_BACKFILL_LIMIT = 5000
const REG_FIELDS_BACKFILL_LIMIT = 10000
const DUPLICATE_CLEANUP_CONFIRM_TEXT = 'bottle_cleanup_duplicates_v1'
const GAS_MEDIUM_CODES = ['LNG', 'LPG', 'O2', 'N2', 'Ar', 'OTHER']
const DUPLICATE_MERGE_FIELDS = [
	'filling_company',
	'registration_mark',
	'equipment_type',
	'product_no',
	'gas_medium_code',
	'station_id',
	'pda_qr_code',
	'qr_code',
	'manufacturer',
	'volume_l',
	'manufacture_date',
	'bottle_check_date',
	'bottle_next_check_date',
	'bottle_check_cycle_months',
	'scrap_due_date',
	'pressure_gauge_no',
	'pressure_gauge_manufacturer',
	'pressure_gauge_range_min',
	'pressure_gauge_range_max',
	'pressure_gauge_check_date',
	'pressure_gauge_next_check_date',
	'pressure_gauge_cycle_months',
	'safety_valve_count',
	'safety_valve_check_date',
	'safety_valve_next_check_date',
	'safety_valve_cycle_months',
	'tare_weight',
	'suggested_fill_weight_kg'
]
const PAGE_ACTION_RULES = {
	listV1: [
		{ pagePath: '/pages/bottle/list', action: 'view' },
		{ pagePath: '/pages/pda/bottle-query', action: 'view' },
		{ pagePath: '/pages/pda/sale-create', action: 'view' },
		{ pagePath: '/pages/pda/filling-create', action: 'view' }
	],
	getV1: [
		{ pagePath: '/pages/bottle/list', action: 'view' },
		{ pagePath: '/pages/bottle/edit', action: 'view' },
		{ pagePath: '/pages/pda/bottle-query', action: 'view' }
	],
	resolveQrCodeV1: [
		{ pagePath: '/pages/pda/filling-create', action: 'view' },
		{ pagePath: '/pages/pda/sale-create', action: 'view' }
	],
	resolveBottleNoV1: [
		{ pagePath: '/pages/pda/filling-create', action: 'view' },
		{ pagePath: '/pages/pda/sale-create', action: 'view' }
	],
	createV1: [{ pagePath: '/pages/bottle/edit', action: 'create' }],
	updateV1: [{ pagePath: '/pages/bottle/edit', action: 'update' }],
	batchUpdateInspectionV1: [{ pagePath: '/pages/bottle/list', action: 'update' }],
	rebuildCurrentStatusV1: [{ pagePath: '/pages/bottle/list', action: 'update' }],
	backfillRegFieldsV1: [{ pagePath: '/pages/bottle/list', action: 'update' }]
}
const SUPERADMIN_ONLY_ACTIONS = [
	'backfillBottleSortKeysV1',
	'auditUniqueFieldsV1',
	'rebuildCurrentStatusV1',
	'cleanupDuplicatesV1',
	'backfillRegFieldsV1'
]

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
	const s = normalizeString(value)
	if (!s) return null
	return STATUS.includes(s) ? s : null
}

function normalizeGasMediumCode(value, fallback = '') {
	const text = normalizeString(value).toUpperCase()
	if (GAS_MEDIUM_CODES.includes(text)) return text
	const fb = normalizeString(fallback).toUpperCase()
	if (GAS_MEDIUM_CODES.includes(fb)) return fb
	return ''
}

function resolveDefaultStationId() {
	return normalizeString(process.env.REG_STATION_ID)
}

function resolveDefaultGasMediumCode() {
	return normalizeGasMediumCode(process.env.REG_DEFAULT_MEDIUM_CODE || 'LNG', 'LNG')
}

function normalizeDate(value) {
	return normalizeString(value)
}

function normalizeEventDay(dateText, fallbackTs) {
	const text = normalizeDate(dateText)
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
	const ts = toTimestamp(fallbackTs, 0)
	if (!ts) return ''
	return formatDateCN(getCNDate(ts))
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

	const gasMediumCodeRaw = data.gas_medium_code ?? data.gasMediumCode
	if (!forUpdate || gasMediumCodeRaw != null) {
		patch.gas_medium_code = normalizeGasMediumCode(gasMediumCodeRaw)
	}

	const stationIdRaw = data.station_id ?? data.stationId
	if (!forUpdate || stationIdRaw != null) {
		patch.station_id = normalizeString(stationIdRaw)
	}

	const pdaQrCodeRaw = data.pda_qr_code
	if (!forUpdate || pdaQrCodeRaw != null) patch.pda_qr_code = normalizeCode(pdaQrCodeRaw)

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
		patch.safety_valve_count = Number.isInteger(count) ? count : null
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
	if (!forUpdate || hasOwn(data, 'suggested_fill_weight_kg')) {
		patch.suggested_fill_weight_kg = toNullableNumber(data.suggested_fill_weight_kg)
	}

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
	if (!normalizeString(doc.station_id)) return '监管站点ID必填'
	if (!normalizeGasMediumCode(doc.gas_medium_code)) return '充装介质编码无效'
	if (!(typeof doc.tare_weight === 'number' && Number.isFinite(doc.tare_weight) && doc.tare_weight >= 0)) {
		return '标准皮重必填且必须为非负数字'
	}
	if (doc.suggested_fill_weight_kg != null && !(typeof doc.suggested_fill_weight_kg === 'number' && Number.isFinite(doc.suggested_fill_weight_kg) && doc.suggested_fill_weight_kg > 0)) {
		return '建议目标必须为大于 0 的数字'
	}
	if (!doc.status) return '当前流向必填'

	if (!doc.status || !STATUS.includes(doc.status)) return '状态无效'

	if (doc.volume_l != null && !(typeof doc.volume_l === 'number' && Number.isFinite(doc.volume_l) && doc.volume_l > 0)) {
		return '容积必须为大于 0 的数字'
	}

	const hasGaugeRangeMin = doc.pressure_gauge_range_min != null
	const hasGaugeRangeMax = doc.pressure_gauge_range_max != null
	if (hasGaugeRangeMin || hasGaugeRangeMax) {
		if (!(typeof doc.pressure_gauge_range_min === 'number' && Number.isFinite(doc.pressure_gauge_range_min) && doc.pressure_gauge_range_min >= 0)) {
			return '压力区间下限必须为非负数字'
		}
		if (!(typeof doc.pressure_gauge_range_max === 'number' && Number.isFinite(doc.pressure_gauge_range_max) && doc.pressure_gauge_range_max >= 0)) {
			return '压力区间上限必须为非负数字'
		}
		if (doc.pressure_gauge_range_min > doc.pressure_gauge_range_max) {
			return '压力区间下限不能大于上限'
		}
	}

	if (doc.manufacture_date && !isValidDateString(doc.manufacture_date)) return '制造日期格式无效'
	if (doc.bottle_check_date && !isValidDateString(doc.bottle_check_date)) return '钢瓶检验日期格式无效'
	if (doc.bottle_next_check_date && !isValidDateString(doc.bottle_next_check_date)) return '钢瓶下次检验日期格式无效'
	if (doc.scrap_due_date && !isValidDateString(doc.scrap_due_date)) return '报废期限格式无效'
	if (doc.pressure_gauge_check_date && !isValidDateString(doc.pressure_gauge_check_date)) return '压力表检验日期格式无效'
	if (doc.pressure_gauge_next_check_date && !isValidDateString(doc.pressure_gauge_next_check_date)) return '压力表下次检验日期格式无效'
	if (doc.safety_valve_check_date && !isValidDateString(doc.safety_valve_check_date)) return '安全阀检测日期格式无效'
	if (doc.safety_valve_next_check_date && !isValidDateString(doc.safety_valve_next_check_date)) return '安全阀下次检测日期格式无效'

	if (doc.bottle_check_cycle_months != null && !CHECK_CYCLE_MONTHS.includes(Number(doc.bottle_check_cycle_months))) {
		return '钢瓶检测周期无效'
	}
	if (doc.pressure_gauge_cycle_months != null && !CHECK_CYCLE_MONTHS.includes(Number(doc.pressure_gauge_cycle_months))) {
		return '压力表检测周期无效'
	}
	if (doc.safety_valve_cycle_months != null && !CHECK_CYCLE_MONTHS.includes(Number(doc.safety_valve_cycle_months))) {
		return '安全阀检测周期无效'
	}

	if (doc.safety_valve_count != null && Number(doc.safety_valve_count) !== 2) return '安全阀数量固定为 2'

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

	const duplicatePdaQr = await findDuplicateByField('pda_qr_code', doc.pda_qr_code, excludeId)
	if (duplicatePdaQr) return 'PDA二维码号已存在'

	const duplicateQr = await findDuplicateByField('qr_code', doc.qr_code, excludeId)
	if (duplicateQr) return '原二维码号已存在'

	const duplicateGauge = await findDuplicateByField('pressure_gauge_no', doc.pressure_gauge_no, excludeId)
	if (duplicateGauge) return '压力表号已存在'

	return ''
}

async function resolveUniqueBottleByField(field, rawValue, { label, normalizer, matchType } = {}) {
	const normalize = typeof normalizer === 'function' ? normalizer : normalizeString
	const value = normalize(rawValue)
	if (!value) return { code: 400, msg: `${label || field}必填` }
	const res = await bottles
		.where({ [field]: value })
		.field({
			_id: true,
			bottle_no: true,
			tare_weight: true,
			suggested_fill_weight_kg: true,
			status: true,
			current_customer_id: true,
			current_customer_name: true,
			is_active: true
		})
		.limit(2)
		.get()
	const list = Array.isArray(res.data) ? res.data : []
	if (!list.length) return { code: 404, msg: `未找到匹配${label || field}` }
	if (list.length > 1) {
		return {
			code: 409,
			msg: `${label || field}存在重复档案，请先清洗主数据`,
			data: {
				matched: false,
				match_type: 'multiple',
				conflict_count: list.length
			}
		}
	}
	return {
		code: 0,
		data: {
			matched: true,
			match_type: matchType || field,
			bottle: {
				_id: list[0]._id,
				bottle_no: list[0].bottle_no,
				tare_weight: list[0].tare_weight,
				suggested_fill_weight_kg: list[0].suggested_fill_weight_kg == null ? null : list[0].suggested_fill_weight_kg,
				status: list[0].status,
				current_customer_id: list[0].current_customer_id || null,
				current_customer_name: list[0].current_customer_name || '',
				is_active: list[0].is_active !== false
			}
		}
	}
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toBoolean(value, fallback = false) {
	if (value === true || value === 'true' || value === 1 || value === '1') return true
	if (value === false || value === 'false' || value === 0 || value === '0') return false
	return fallback
}

function toTimestamp(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function resolveRegBridgeTimeoutMs() {
	const raw = Number(process.env.REG_BRIDGE_ENQUEUE_TIMEOUT_MS || 1200)
	const fallback = 1200
	if (!Number.isFinite(raw)) return fallback
	return Math.min(Math.max(Math.floor(raw), 300), 5000)
}

function withTimeout(promise, timeoutMs, message) {
	const timeout = Math.max(Number(timeoutMs) || 0, 1)
	return new Promise((resolve, reject) => {
		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			reject(new Error(message || `timeout(${timeout}ms)`))
		}, timeout)
		promise
			.then((value) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				resolve(value)
			})
			.catch((err) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				reject(err)
			})
	})
}

async function enqueueRegBridge(action, data, token, requestId, user, logAction = '') {
	const normalizedAction = normalizeString(action)
	if (!normalizedAction) return ''
	try {
		const timeoutMs = resolveRegBridgeTimeoutMs()
		const callPromise = uniCloud.callFunction({
			name: 'crm-reg-bridge',
			data: {
				action: normalizedAction,
				token,
				request_id: requestId,
				data: data && typeof data === 'object' ? data : {}
			}
		})
		const res = await withTimeout(callPromise, timeoutMs, `crm-reg-bridge ${normalizedAction} timeout`)
		const result = res && res.result ? res.result : {}
		if (Number(result.code) === 0) return ''
		const warning = normalizeString(result.msg) || '监管同步入队失败'
		await recordLog(
			user,
			logAction || 'bottle_reg_enqueue_failed',
			{ reg_action: normalizedAction, warning },
			requestId
		)
		return warning
	} catch (err) {
		const warning = normalizeString(err && err.message) || '监管同步入队失败'
		await recordLog(
			user,
			logAction || 'bottle_reg_enqueue_failed',
			{ reg_action: normalizedAction, warning },
			requestId
		)
		return warning
	}
}

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function normalizeMovementEventType(value) {
	const text = normalizeString(value)
	if (text === 'back' || text === 'fill' || text === 'out' || text === 'adjust') return text
	return ''
}

function compareMovementEventAsc(a, b) {
	const aAt = toTimestamp(a && a.event_at, toTimestamp(a && a.created_at, 0))
	const bAt = toTimestamp(b && b.event_at, toTimestamp(b && b.created_at, 0))
	if (aAt !== bAt) return aAt - bAt
	const aOrderRaw = Number(a && a.type_order)
	const bOrderRaw = Number(b && b.type_order)
	const aOrder = Number.isFinite(aOrderRaw) ? aOrderRaw : movementTypeOrder(normalizeMovementEventType(a && a.type))
	const bOrder = Number.isFinite(bOrderRaw) ? bOrderRaw : movementTypeOrder(normalizeMovementEventType(b && b.type))
	if (aOrder !== bOrder) return aOrder - bOrder
	return toTimestamp(a && a.created_at, 0) - toTimestamp(b && b.created_at, 0)
}

function listEffectiveMovementEvents(events) {
	return (events || []).filter((row) => {
		const type = normalizeMovementEventType(row && row.type)
		return type === 'back' || type === 'fill' || type === 'out'
	})
}

function hasSameDayBackOutWithoutFill(events) {
	const effectiveEvents = listEffectiveMovementEvents(events)
	if (!effectiveEvents.length) return false
	const hasBack = effectiveEvents.some((row) => normalizeMovementEventType(row && row.type) === 'back')
	const hasFill = effectiveEvents.some((row) => normalizeMovementEventType(row && row.type) === 'fill')
	const hasOut = effectiveEvents.some((row) => normalizeMovementEventType(row && row.type) === 'out')
	return hasBack && hasOut && !hasFill
}

function sortMovementDayEventsByTypePriority(events, priorities) {
	return [...events].sort((a, b) => {
		const aType = normalizeMovementEventType(a && a.type)
		const bType = normalizeMovementEventType(b && b.type)
		const aPriority = Object.prototype.hasOwnProperty.call(priorities, aType) ? priorities[aType] : 99
		const bPriority = Object.prototype.hasOwnProperty.call(priorities, bType) ? priorities[bType] : 99
		if (aPriority !== bPriority) return aPriority - bPriority
		return compareMovementEventAsc(a, b)
	})
}

function shouldQueueSameDayBackOut(events, state) {
	if (!hasSameDayBackOutWithoutFill(events)) return false
	if (Array.isArray(state && state.pendingSameDayBackOut) && state.pendingSameDayBackOut.length > 0) return true
	if (state && state.activeBackEvent) return false
	if (normalizeMovementEventType(state && state.lastEffectiveType) === 'out') return false
	return true
}

function buildMovementDayBusinessOrder(events, state) {
	const sorted = [...events].sort(compareMovementEventAsc)
	if (!hasSameDayBackOutWithoutFill(sorted)) return sorted
	if (shouldQueueSameDayBackOut(sorted, state)) return sorted
	if (state && state.activeBackEvent) {
		return sortMovementDayEventsByTypePriority(sorted, { out: 10, back: 20, adjust: 30 })
	}
	return sorted
}

function buildPendingSameDayBackOutEntry(events) {
	const sorted = [...listEffectiveMovementEvents(events)].sort(compareMovementEventAsc)
	const backEvents = sorted.filter((row) => normalizeMovementEventType(row && row.type) === 'back')
	const outEvents = sorted.filter((row) => normalizeMovementEventType(row && row.type) === 'out')
	const back = backEvents[backEvents.length - 1] || null
	const out = outEvents[outEvents.length - 1] || null
	if (!back || !out) return null
	return {
		event_day: normalizeEventDay(
			(out && out.event_day) || (back && back.event_day) || '',
			Math.max(toTimestamp(out && out.event_at, 0), toTimestamp(back && back.event_at, 0), Date.now())
		),
		back,
		out
	}
}

function resolvePendingSameDayBackOut(state, nextType) {
	const queue = Array.isArray(state && state.pendingSameDayBackOut) ? state.pendingSameDayBackOut : []
	if (!queue.length) return
	const type = normalizeMovementEventType(nextType)
	if (!type || type === 'adjust') return
	const latest = queue[queue.length - 1] || null
	state.pendingSameDayBackOut = []
	if (!latest || !latest.back || !latest.out) return
	if (type === 'fill') {
		state.activeBackEvent = latest.back
		state.lastEffectiveType = 'back'
		state.lastEffectiveEvent = latest.back
		return
	}
	state.activeBackEvent = null
	state.lastEffectiveType = 'out'
	state.lastEffectiveEvent = latest.out
}

function buildBottleFlowStateFromMovementRows(rows = []) {
	const state = {
		activeBackEvent: null,
		pendingSameDayBackOut: [],
		lastEffectiveType: '',
		lastEffectiveEvent: null
	}
	const sortedRows = [...(rows || [])].sort(compareMovementEventAsc)
	let dayBuffer = []

	const flushDayBuffer = () => {
		if (!dayBuffer.length) return
		const sorted = buildMovementDayBusinessOrder(dayBuffer, state)
		dayBuffer = []
		if (shouldQueueSameDayBackOut(sorted, state)) {
			const pendingEntry = buildPendingSameDayBackOutEntry(sorted)
			if (pendingEntry) state.pendingSameDayBackOut = [...state.pendingSameDayBackOut, pendingEntry]
			return
		}
		const effectiveEvents = listEffectiveMovementEvents(sorted)
		if (effectiveEvents.length) resolvePendingSameDayBackOut(state, effectiveEvents[0].type)
		for (const row of sorted) {
			const type = normalizeMovementEventType(row && row.type)
			if (type === 'back') {
				state.activeBackEvent = row
				state.lastEffectiveType = 'back'
				state.lastEffectiveEvent = row
				continue
			}
			if (type === 'fill') {
				state.lastEffectiveType = 'fill'
				state.lastEffectiveEvent = row
				continue
			}
			if (type === 'out') {
				state.lastEffectiveType = 'out'
				state.lastEffectiveEvent = row
				if (state.activeBackEvent) state.activeBackEvent = null
			}
		}
	}

	for (const row of sortedRows) {
		const eventDay = normalizeEventDay(
			(row && (row.event_day || row.date)) || '',
			toTimestamp(row && row.event_at, toTimestamp(row && row.created_at, Date.now()))
		)
		if (!dayBuffer.length) {
			dayBuffer.push(row)
			continue
		}
		const currentDay = normalizeEventDay(
			(dayBuffer[0] && (dayBuffer[0].event_day || dayBuffer[0].date)) || '',
			toTimestamp(dayBuffer[0] && dayBuffer[0].event_at, toTimestamp(dayBuffer[0] && dayBuffer[0].created_at, Date.now()))
		)
		if (eventDay === currentDay) {
			dayBuffer.push(row)
			continue
		}
		flushDayBuffer()
		dayBuffer.push(row)
	}
	flushDayBuffer()

	return {
		last_effective_type: normalizeMovementEventType(state.lastEffectiveType),
		last_effective_event: state.lastEffectiveEvent || null,
		active_back_event: state.activeBackEvent || null,
		has_pending_same_day_back_out: Array.isArray(state.pendingSameDayBackOut) && state.pendingSameDayBackOut.length > 0
	}
}

function isPseudoBottleNo(value) {
	const no = normalizeBottleNo(value)
	return !no || no === '000' || /^TRUCK-/.test(no)
}

async function fetchBottleRowsByWhere(where, field = null) {
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
		if (rows.length < pageSize) break
		page += 1
	}
	return out
}

async function fetchBottleMovementRowsByBottleNos(bottleNos = []) {
	const normalizedNos = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalizedNos.length) return []
	const out = []
	const chunkSize = 80
	for (let i = 0; i < normalizedNos.length; i += chunkSize) {
		const chunk = normalizedNos.slice(i, i + chunkSize)
		let page = 0
		const pageSize = 500
		while (true) {
			const res = await movements
				.where({ bottle_no: dbCmd.in(chunk) })
				.field({
					bottle_no: true,
					type: true,
					date: true,
					event_day: true,
					event_at: true,
					type_order: true,
					customer_id: true,
					customer_name: true,
					created_at: true
				})
				.orderBy('event_at', 'asc')
				.orderBy('type_order', 'asc')
				.orderBy('created_at', 'asc')
				.skip(page * pageSize)
				.limit(pageSize)
				.get()
			const rows = (res && res.data) || []
			out.push(...rows)
			if (rows.length < pageSize) break
			page += 1
		}
	}
	return out
}

function buildBottleMovementRowMap(rows = []) {
	const map = new Map()
	;(rows || []).forEach((row) => {
		const no = normalizeBottleNo(row && row.bottle_no)
		if (!no) return
		if (!map.has(no)) map.set(no, [])
		map.get(no).push(row)
	})
	return map
}

function buildExpectedBottleState(doc = {}, movementRows = []) {
	const state = buildBottleFlowStateFromMovementRows(movementRows)
	if (state.has_pending_same_day_back_out) {
		return {
			skip_reason: 'pending_same_day_back_out',
			last_effective_type: state.last_effective_type,
			last_effective_event: state.last_effective_event || null
		}
	}
	const lastType = normalizeMovementEventType(state.last_effective_type)
	const lastEvent = state.last_effective_event || null
	if (lastType === 'out') {
		return {
			status: 'at_customer',
			current_customer_id: normalizeString(lastEvent && lastEvent.customer_id) || null,
			current_customer_name: normalizeString(lastEvent && lastEvent.customer_name),
			last_effective_type: lastType,
			last_effective_event: lastEvent
		}
	}
	if (lastType === 'back' || lastType === 'fill') {
		return {
			status: 'in_station',
			current_customer_id: null,
			current_customer_name: '',
			last_effective_type: lastType,
			last_effective_event: lastEvent
		}
	}
	return {
		status: 'unknown',
		current_customer_id: null,
		current_customer_name: '',
		last_effective_type: '',
		last_effective_event: null
	}
}

function summarizeBottleStatusChange(doc = {}, expected = {}) {
	return {
		_id: normalizeString(doc && doc._id),
		bottle_no: normalizeBottleNo(doc && doc.bottle_no),
		from_status: normalizeStatus(doc && doc.status) || normalizeString(doc && doc.status),
		to_status: normalizeStatus(expected && expected.status) || normalizeString(expected && expected.status),
		from_customer_id: normalizeString(doc && doc.current_customer_id) || null,
		to_customer_id: normalizeString(expected && expected.current_customer_id) || null,
		from_customer_name: normalizeString(doc && doc.current_customer_name),
		to_customer_name: normalizeString(expected && expected.current_customer_name),
		last_effective_type: normalizeMovementEventType(expected && expected.last_effective_type),
		last_effective_date: normalizeString(expected && expected.last_effective_event && expected.last_effective_event.date)
	}
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
		const normalizedKeyword = normalizeBottleNo(keyword)
		const keywordOrConditions = []
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		keywordOrConditions.push({ bottle_no: rx })
		keywordOrConditions.push({ bottle_no_sort_text: rx })
		keywordOrConditions.push({ pda_qr_code: rx })
		keywordOrConditions.push({ qr_code: rx })
		keywordOrConditions.push({ current_customer_name: rx })
		if (normalizedKeyword && normalizedKeyword !== keyword) {
			const normalizedRx = db.RegExp({ regexp: escapeRegExp(normalizedKeyword), options: 'i' })
			keywordOrConditions.push({ bottle_no: normalizedRx })
			keywordOrConditions.push({ bottle_no_sort_text: normalizedRx })
			keywordOrConditions.push({ pda_qr_code: normalizedRx })
			keywordOrConditions.push({ qr_code: normalizedRx })
		}
		if (normalizedKeyword) {
			keywordOrConditions.push({ bottle_no: normalizedKeyword })
			keywordOrConditions.push({ pda_qr_code: normalizedKeyword })
			keywordOrConditions.push({ qr_code: normalizedKeyword })
		}
		if (/^\d+$/.test(normalizedKeyword)) {
			const numericKeyword = Number(normalizedKeyword)
			if (Number.isFinite(numericKeyword)) {
				keywordOrConditions.push({ bottle_no_sort_num: numericKeyword })
				keywordOrConditions.push({ bottle_no: numericKeyword })
			}
		}
		conditions.push(dbCmd.or(keywordOrConditions))
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

async function rebuildCurrentStatusV1(user, data, requestId) {
	const preview = toBoolean(data && data.preview, true)
	const onlyActive = toBoolean(data && data.only_active, true)
	const includeSpecialStatus = toBoolean(data && data.include_special_status, false)
	const rawBottleNos = Array.isArray(data && data.bottle_nos)
		? data.bottle_nos
		: normalizeString(data && data.bottle_no)
			? [data.bottle_no]
			: []
	const bottleNos = Array.from(new Set(rawBottleNos.map((item) => normalizeBottleNo(item)).filter(Boolean)))
	const bottleField = {
		_id: true,
		bottle_no: true,
		status: true,
		current_customer_id: true,
		current_customer_name: true,
		is_active: true
	}
	let targetRows = []
	if (bottleNos.length) {
		targetRows = await fetchBottleRowsByWhere({ bottle_no: dbCmd.in(bottleNos) }, bottleField)
	} else {
		const where = onlyActive ? { is_active: true } : {}
		targetRows = await fetchBottleRowsByWhere(where, bottleField)
	}

	const movementRows = await fetchBottleMovementRowsByBottleNos(targetRows.map((row) => row && row.bottle_no))
	const movementMap = buildBottleMovementRowMap(movementRows)
	const sampleChanges = []
	const updates = []
	const summary = {
		target_total: 0,
		updated_total: 0,
		changed_total: 0,
		unchanged_total: 0,
		no_movement_total: 0,
		pending_same_day_total: 0,
		skipped_special_status_total: 0,
		skipped_inactive_total: 0,
		skipped_pseudo_total: 0
	}

	for (const doc of targetRows) {
		summary.target_total += 1
		const bottleNo = normalizeBottleNo(doc && doc.bottle_no)
		if (isPseudoBottleNo(bottleNo)) {
			summary.skipped_pseudo_total += 1
			continue
		}
		if (!includeSpecialStatus && ['scrapped', 'lost'].includes(normalizeStatus(doc && doc.status))) {
			summary.skipped_special_status_total += 1
			continue
		}
		if (onlyActive && !toBoolean(doc && doc.is_active, false)) {
			summary.skipped_inactive_total += 1
			continue
		}
		const rows = movementMap.get(bottleNo) || []
		if (!rows.length) summary.no_movement_total += 1
		const expected = buildExpectedBottleState(doc, rows)
		if (expected.skip_reason === 'pending_same_day_back_out') {
			summary.pending_same_day_total += 1
			continue
		}
		const nextStatus = normalizeStatus(expected && expected.status) || 'unknown'
		const nextCustomerId = normalizeString(expected && expected.current_customer_id) || null
		const nextCustomerName = normalizeString(expected && expected.current_customer_name)
		const currentStatus = normalizeStatus(doc && doc.status) || 'unknown'
		const currentCustomerId = normalizeString(doc && doc.current_customer_id) || null
		const currentCustomerName = normalizeString(doc && doc.current_customer_name)
		const changed =
			currentStatus !== nextStatus ||
			currentCustomerId !== nextCustomerId ||
			currentCustomerName !== nextCustomerName
		if (!changed) {
			summary.unchanged_total += 1
			continue
		}
		summary.changed_total += 1
		const change = summarizeBottleStatusChange(doc, {
			status: nextStatus,
			current_customer_id: nextCustomerId,
			current_customer_name: nextCustomerName,
			last_effective_type: expected.last_effective_type,
			last_effective_event: expected.last_effective_event
		})
		if (sampleChanges.length < 50) sampleChanges.push(change)
		if (!preview) {
			updates.push({
				_id: doc._id,
				patch: {
					status: nextStatus,
					current_customer_id: nextCustomerId,
					current_customer_name: nextCustomerName,
					updated_at: Date.now()
				}
			})
		}
	}

	if (!preview && updates.length) {
		for (const item of updates) {
			await bottles.doc(item._id).update(item.patch)
		}
		summary.updated_total = updates.length
		await recordLog(
			user,
			'bottle_rebuild_current_status_execute_v1',
			{
				target_total: summary.target_total,
				updated_total: summary.updated_total,
				changed_total: summary.changed_total,
				unchanged_total: summary.unchanged_total,
				no_movement_total: summary.no_movement_total,
				pending_same_day_total: summary.pending_same_day_total,
				skipped_special_status_total: summary.skipped_special_status_total,
				skipped_inactive_total: summary.skipped_inactive_total,
				skipped_pseudo_total: summary.skipped_pseudo_total,
				scoped_bottle_total: bottleNos.length
			},
			requestId
		)
	} else {
		await recordLog(
			user,
			'bottle_rebuild_current_status_preview_v1',
			{
				target_total: summary.target_total,
				changed_total: summary.changed_total,
				unchanged_total: summary.unchanged_total,
				no_movement_total: summary.no_movement_total,
				pending_same_day_total: summary.pending_same_day_total,
				skipped_special_status_total: summary.skipped_special_status_total,
				skipped_inactive_total: summary.skipped_inactive_total,
				skipped_pseudo_total: summary.skipped_pseudo_total,
				scoped_bottle_total: bottleNos.length
			},
			requestId
		)
	}

	return {
		code: 0,
		msg: preview ? '预览成功' : '更新成功',
		data: {
			preview,
			summary,
			sample_changes: sampleChanges
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

async function resolveQrCodeV1(user, data) {
	void user
	return resolveUniqueBottleByField('pda_qr_code', data.pda_qr_code ?? data.pdaQrCode ?? data.qr_code ?? data.qrCode ?? data.token, {
		label: '钢瓶PDA二维码',
		normalizer: normalizeCode,
		matchType: 'pda_qr_code'
	})
}

async function resolveBottleNoV1(user, data) {
	void user
	return resolveUniqueBottleByField('bottle_no', data.bottle_no ?? data.bottleNo ?? data.token, {
		label: '钢瓶号',
		normalizer: normalizeBottleNo,
		matchType: 'bottle_no'
	})
}

async function createV1(user, data, requestId, token) {
	const normalized = normalizeBottlePayload(data, { forUpdate: false })
	normalized.safety_valve_count = 2
	normalized.station_id = normalizeString(normalized.station_id) || resolveDefaultStationId()
	normalized.gas_medium_code = normalizeGasMediumCode(normalized.gas_medium_code, resolveDefaultGasMediumCode())

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
	const regWarning = await enqueueRegBridge(
		'enqueueEventV1',
		{
			source_type: 'bottle',
			source_id: res.id,
			event_type: 'profile_update',
			bottle_nos: [normalizeBottleNo(doc && doc.bottle_no)],
			event_at: now,
			enqueue_snapshot: true
		},
		token,
		requestId,
		user,
		'bottle_reg_enqueue_create_failed'
	)
	return {
		code: 0,
		msg: regWarning ? `创建成功（${regWarning}）` : '创建成功',
		data: {
			_id: res.id,
			warning: regWarning || ''
		}
	}
}

async function updateV1(user, data, requestId, token) {
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
	if (!normalizeString(merged.station_id)) merged.station_id = resolveDefaultStationId()
	if (!normalizeGasMediumCode(merged.gas_medium_code)) {
		merged.gas_medium_code = resolveDefaultGasMediumCode()
	}
	if (!normalizeString(patch.station_id) && normalizeString(merged.station_id)) patch.station_id = normalizeString(merged.station_id)
	if (!normalizeGasMediumCode(patch.gas_medium_code) && normalizeGasMediumCode(merged.gas_medium_code)) {
		patch.gas_medium_code = normalizeGasMediumCode(merged.gas_medium_code)
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
	const regWarning = await enqueueRegBridge(
		'enqueueEventV1',
		{
			source_type: 'bottle',
			source_id: id,
			event_type: 'profile_update',
			bottle_nos: [normalizeBottleNo(merged && merged.bottle_no)],
			event_at: patch.updated_at,
			enqueue_snapshot: true
		},
		token,
		requestId,
		user,
		'bottle_reg_enqueue_update_failed'
	)
	return {
		code: 0,
		msg: regWarning ? `更新成功（${regWarning}）` : '更新成功',
		data: { warning: regWarning || '' }
	}
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

async function backfillRegFieldsV1(user, data, requestId) {
	const execute = toBoolean(data.execute, false)
	const preview = !execute
	const onlyMissing = toBoolean(data.only_missing ?? data.onlyMissing, true)
	const limitInput = Number(data.limit || 2000)
	const pageSizeInput = Number(data.pageSize ?? data.page_size ?? 200)
	const limit = Math.min(
		Math.max(Number.isFinite(limitInput) ? Math.floor(limitInput) : 2000, 1),
		REG_FIELDS_BACKFILL_LIMIT
	)
	const pageSize = Math.min(
		Math.max(Number.isFinite(pageSizeInput) ? Math.floor(pageSizeInput) : 200, 20),
		200
	)
	const stationId = normalizeString(data.station_id || data.stationId || resolveDefaultStationId())
	const gasMediumCode = normalizeGasMediumCode(data.gas_medium_code || data.gasMediumCode, resolveDefaultGasMediumCode())
	if (!stationId) return { code: 400, msg: '缺少 station_id（可通过 REG_STATION_ID 提供）' }
	if (!gasMediumCode) return { code: 400, msg: '缺少 gas_medium_code（可通过 REG_DEFAULT_MEDIUM_CODE 提供）' }

	const bottleNos = Array.isArray(data.bottle_nos)
		? data.bottle_nos.map((item) => normalizeBottleNo(item)).filter(Boolean)
		: normalizeString(data.bottle_no)
			? [normalizeBottleNo(data.bottle_no)]
			: []
	const where = bottleNos.length ? { bottle_no: dbCmd.in(bottleNos) } : {}
	const totalRes = await bottles.where(where).count()
	const total = Number(totalRes.total || 0)
	let scanned = 0
	let cursor = 0
	let targetTotal = 0
	let updated = 0
	const failedItems = []
	const sample = []
	let hasMore = false

	while (scanned < limit && cursor < total) {
		const currentBatch = Math.min(pageSize, limit - scanned, total - cursor)
		if (currentBatch <= 0) break
		const res = await bottles
			.where(where)
			.field({
				_id: true,
				bottle_no: true,
				station_id: true,
				gas_medium_code: true,
				created_at: true
			})
			.orderBy('created_at', 'asc')
			.skip(cursor)
			.limit(currentBatch)
			.get()
		const rows = Array.isArray(res && res.data) ? res.data : []
		if (!rows.length) break
		scanned += rows.length
		cursor += rows.length
		for (let i = 0; i < rows.length; i += 1) {
			const row = rows[i] || {}
			if (!row._id) continue
			const currentStation = normalizeString(row.station_id)
			const currentMedium = normalizeGasMediumCode(row.gas_medium_code)
			const patch = {}
			if (!onlyMissing || !currentStation) patch.station_id = stationId
			if (!onlyMissing || !currentMedium) patch.gas_medium_code = gasMediumCode
			if (!Object.keys(patch).length) continue
			targetTotal += 1
			if (sample.length < 100) {
				sample.push({
					_id: normalizeString(row._id),
					bottle_no: normalizeBottleNo(row.bottle_no),
					before: {
						station_id: currentStation,
						gas_medium_code: currentMedium
					},
					after: {
						station_id: patch.station_id || currentStation,
						gas_medium_code: patch.gas_medium_code || currentMedium
					}
				})
			}
			if (preview) continue
			try {
				await bottles.doc(row._id).update({
					...patch,
					updated_at: Date.now()
				})
				updated += 1
			} catch (err) {
				failedItems.push({
					_id: normalizeString(row._id),
					bottle_no: normalizeBottleNo(row.bottle_no),
					error: normalizeString(err && err.message) || '更新失败'
				})
			}
		}
	}
	hasMore = cursor < total

	const detail = {
		execute,
		preview,
		only_missing: onlyMissing,
		limit,
		page_size: pageSize,
		total,
		scanned,
		target_total: targetTotal,
		updated_total: preview ? 0 : updated,
		failed_total: preview ? 0 : failedItems.length,
		station_id: stationId,
		gas_medium_code: gasMediumCode,
		has_more: hasMore
	}
	await recordLog(
		user,
		execute ? 'bottle_backfill_reg_fields_execute_v1' : 'bottle_backfill_reg_fields_preview_v1',
		detail,
		requestId
	)
	return {
		code: 0,
		msg: execute ? '监管字段回填完成' : '监管字段回填预览完成',
		data: {
			...detail,
			sample_rows: sample,
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

function isMeaningfulValue(value) {
	if (value == null) return false
	if (typeof value === 'string') return Boolean(normalizeString(value))
	if (typeof value === 'number') return Number.isFinite(value)
	if (typeof value === 'boolean') return true
	if (Array.isArray(value)) return value.length > 0
	if (typeof value === 'object') return Object.keys(value).length > 0
	return false
}

function getBottleStatusPriority(value) {
	const status = normalizeStatus(value) || 'unknown'
	if (status === 'at_customer') return 4
	if (status === 'in_station') return 3
	if (status === 'unknown') return 2
	if (status === 'scrapped') return 1
	if (status === 'lost') return 0
	return 0
}

function countBottleCompleteness(doc = {}) {
	let score = 0
	for (let i = 0; i < DUPLICATE_MERGE_FIELDS.length; i += 1) {
		if (isMeaningfulValue(doc[DUPLICATE_MERGE_FIELDS[i]])) score += 1
	}
	if (isMeaningfulValue(doc.remark)) score += 1
	if (isMeaningfulValue(doc.current_customer_name)) score += 1
	return score
}

function summarizeBottleArchiveRow(doc = {}, refCountMap = new Map()) {
	const id = normalizeString(doc && doc._id)
	return {
		_id: id,
		bottle_no: normalizeBottleNo(doc && doc.bottle_no),
		raw_bottle_no: normalizeString(doc && doc.bottle_no),
		is_active: toBoolean(doc && doc.is_active, false),
		status: normalizeStatus(doc && doc.status) || normalizeString(doc && doc.status),
		current_customer_name: normalizeString(doc && doc.current_customer_name),
		sale_ref_count: Number(refCountMap.get(id) || 0),
		completeness_score: countBottleCompleteness(doc),
		updated_at: toTimestamp(doc && doc.updated_at, 0),
		created_at: toTimestamp(doc && doc.created_at, 0)
	}
}

function compareCanonicalBottleDocs(a, b, refCountMap = new Map()) {
	const refDiff = Number(refCountMap.get(normalizeString(b && b._id)) || 0) - Number(refCountMap.get(normalizeString(a && a._id)) || 0)
	if (refDiff !== 0) return refDiff
	const activeDiff = Number(toBoolean(b && b.is_active, false)) - Number(toBoolean(a && a.is_active, false))
	if (activeDiff !== 0) return activeDiff
	const statusDiff = getBottleStatusPriority(b && b.status) - getBottleStatusPriority(a && a.status)
	if (statusDiff !== 0) return statusDiff
	const completenessDiff = countBottleCompleteness(b) - countBottleCompleteness(a)
	if (completenessDiff !== 0) return completenessDiff
	const updatedDiff = toTimestamp(b && b.updated_at, 0) - toTimestamp(a && a.updated_at, 0)
	if (updatedDiff !== 0) return updatedDiff
	const createdDiff = toTimestamp(a && a.created_at, 0) - toTimestamp(b && b.created_at, 0)
	if (createdDiff !== 0) return createdDiff
	return normalizeString(a && a._id).localeCompare(normalizeString(b && b._id))
}

function selectCanonicalBottleDoc(rows = [], refCountMap = new Map()) {
	const sorted = [...rows].sort((a, b) => compareCanonicalBottleDocs(a, b, refCountMap))
	return sorted[0] || null
}

function buildCanonicalMergePatch(canonical = {}, duplicates = []) {
	const patch = {
		bottle_no: normalizeBottleNo(canonical && canonical.bottle_no),
		...buildBottleNoSortMeta(canonical && canonical.bottle_no)
	}
	for (let i = 0; i < DUPLICATE_MERGE_FIELDS.length; i += 1) {
		const field = DUPLICATE_MERGE_FIELDS[i]
		if (isMeaningfulValue(canonical && canonical[field])) continue
		for (let j = 0; j < duplicates.length; j += 1) {
			const candidateValue = duplicates[j] && duplicates[j][field]
			if (!isMeaningfulValue(candidateValue)) continue
			patch[field] = candidateValue
			break
		}
	}
	if (!toBoolean(canonical && canonical.is_active, false)) {
		const hasActiveDuplicate = duplicates.some((row) => toBoolean(row && row.is_active, false))
		if (hasActiveDuplicate) patch.is_active = true
	}
	if (!isMeaningfulValue(canonical && canonical.remark)) {
		const duplicateRemark = duplicates.map((row) => normalizeString(row && row.remark)).find(Boolean)
		if (duplicateRemark) patch.remark = duplicateRemark
	}
	if (!isMeaningfulValue(canonical && canonical.current_customer_name)) {
		const duplicateCustomerName = duplicates.map((row) => normalizeString(row && row.current_customer_name)).find(Boolean)
		if (duplicateCustomerName) patch.current_customer_name = duplicateCustomerName
	}
	if (!isMeaningfulValue(canonical && canonical.current_customer_id)) {
		const duplicateCustomerId = duplicates.map((row) => normalizeString(row && row.current_customer_id)).find(Boolean)
		if (duplicateCustomerId) patch.current_customer_id = duplicateCustomerId
	}
	return patch
}

async function fetchAllSaleRowsForDuplicateCleanup() {
	const out = []
	const pageSize = 200
	let page = 0
	while (true) {
		const res = await saleRecords
			.field({
				_id: true,
				date: true,
				customer_name: true,
				out_items: true,
				back_items: true,
				deposit_rows: true,
				deposit_items: true,
				agent_sale_items: true,
				updated_at: true
			})
			.orderBy('date', 'desc')
			.orderBy('updated_at', 'desc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const rows = (res && res.data) || []
		if (!rows.length) break
		out.push(...rows)
		if (rows.length < pageSize) break
		page += 1
	}
	return out
}

function buildSaleBottleReferenceMaps(rows = []) {
	const refCountMap = new Map()
	const refsBySaleId = new Map()
	const addRef = (saleId, bucket) => {
		const bottleId = normalizeString(bucket && bucket.bottle_id)
		if (!bottleId) return
		refCountMap.set(bottleId, Number(refCountMap.get(bottleId) || 0) + 1)
		if (!refsBySaleId.has(saleId)) refsBySaleId.set(saleId, [])
		refsBySaleId.get(saleId).push(bucket)
	}
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		const saleId = normalizeString(row._id)
		if (!saleId) continue
		;['out_items', 'back_items', 'deposit_rows', 'deposit_items', 'agent_sale_items'].forEach((field) => {
			const list = Array.isArray(row && row[field]) ? row[field] : []
			list.forEach((item, index) => {
				addRef(saleId, {
					field,
					index,
					bottle_id: item && item.bottle_id
				})
			})
		})
	}
	return { refCountMap, refsBySaleId }
}

function rewriteSaleRowBottleRefs(row = {}, duplicateToCanonicalMap = new Map()) {
	let changed = false
	const replacements = []
	const patch = {}
	;['out_items', 'back_items', 'deposit_rows', 'deposit_items', 'agent_sale_items'].forEach((field) => {
		const list = Array.isArray(row && row[field]) ? row[field] : null
		if (!list) return
		let fieldChanged = false
		const nextList = list.map((item) => {
			const bottleId = normalizeString(item && item.bottle_id)
			if (!bottleId || !duplicateToCanonicalMap.has(bottleId)) return item
			const canonical = duplicateToCanonicalMap.get(bottleId)
			const nextItem = {
				...item,
				bottle_id: canonical._id,
				bottle_no: canonical.bottle_no
			}
			fieldChanged = true
			replacements.push({
				field,
				from_bottle_id: bottleId,
				to_bottle_id: canonical._id,
				bottle_no: canonical.bottle_no
			})
			return nextItem
		})
		if (fieldChanged) {
			patch[field] = nextList
			changed = true
		}
	})
	return { changed, patch, replacements }
}

function groupBottleDuplicates(rows = []) {
	const groups = new Map()
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		const bottleNo = normalizeBottleNo(row.bottle_no)
		if (!bottleNo || isPseudoBottleNo(bottleNo)) continue
		if (!groups.has(bottleNo)) groups.set(bottleNo, [])
		groups.get(bottleNo).push(row)
	}
	return Array.from(groups.entries())
		.filter(([, list]) => list.length > 1)
		.map(([bottleNo, list]) => ({ bottle_no: bottleNo, rows: list }))
		.sort((a, b) => b.rows.length - a.rows.length || a.bottle_no.localeCompare(b.bottle_no))
}

async function buildBottleDuplicateCleanupPlan() {
	const bottleRows = await fetchBottleRowsByWhere({}, null)
	const duplicateGroups = groupBottleDuplicates(bottleRows)
	if (!duplicateGroups.length) {
		return {
			duplicate_group_total: 0,
			duplicate_row_total: 0,
			sale_row_total: 0,
			sale_row_rewrite_total: 0,
			remove_doc_total: 0,
			update_canonical_total: 0,
			rebuild_status_total: 0,
			groups: [],
			duplicate_to_canonical_map: new Map(),
			sale_row_patches: [],
			canonical_updates: [],
			remove_docs: [],
			affected_bottle_nos: []
		}
	}
	const saleRows = await fetchAllSaleRowsForDuplicateCleanup()
	const { refCountMap } = buildSaleBottleReferenceMaps(saleRows)
	const duplicateToCanonicalMap = new Map()
	const canonicalUpdates = []
	const removeDocs = []
	const affectedBottleNos = []
	const groups = []
	for (let i = 0; i < duplicateGroups.length; i += 1) {
		const group = duplicateGroups[i]
		const canonical = selectCanonicalBottleDoc(group.rows, refCountMap)
		if (!canonical) continue
		const duplicates = group.rows.filter((row) => normalizeString(row && row._id) !== normalizeString(canonical && canonical._id))
		const mergePatch = buildCanonicalMergePatch(canonical, duplicates)
		const canonicalNeedsUpdate = Object.keys(mergePatch).some((key) => {
			if (key === 'bottle_no') return normalizeBottleNo(canonical && canonical.bottle_no) !== normalizeBottleNo(mergePatch[key])
			if (key === 'bottle_no_sort_group' || key === 'bottle_no_sort_num' || key === 'bottle_no_sort_text' || key === 'bottle_no_sort_key') {
				return !isBottleNoSortMetaSame(canonical, mergePatch)
			}
			return canonical[key] !== mergePatch[key]
		})
		if (canonicalNeedsUpdate) {
			canonicalUpdates.push({
				_id: canonical._id,
				patch: {
					...mergePatch,
					updated_at: Date.now()
				},
				before: canonical
			})
		}
		duplicates.forEach((row) => {
			duplicateToCanonicalMap.set(normalizeString(row && row._id), {
				_id: normalizeString(canonical && canonical._id),
				bottle_no: normalizeBottleNo(canonical && canonical.bottle_no)
			})
			removeDocs.push(row)
		})
		affectedBottleNos.push(normalizeBottleNo(canonical && canonical.bottle_no))
		groups.push({
			bottle_no: group.bottle_no,
			keep: summarizeBottleArchiveRow(canonical, refCountMap),
			remove: duplicates.map((row) => summarizeBottleArchiveRow(row, refCountMap)),
			merge_patch: mergePatch
		})
	}
	const saleRowPatches = []
	for (let i = 0; i < saleRows.length; i += 1) {
		const row = saleRows[i] || {}
		const rewritten = rewriteSaleRowBottleRefs(row, duplicateToCanonicalMap)
		if (!rewritten.changed) continue
		saleRowPatches.push({
			_id: normalizeString(row._id),
			date: normalizeString(row.date),
			customer_name: normalizeString(row.customer_name),
			patch: {
				...rewritten.patch,
				updated_at: Date.now()
			},
			before: row,
			replacements: rewritten.replacements
		})
	}
	return {
		duplicate_group_total: groups.length,
		duplicate_row_total: removeDocs.length,
		sale_row_total: saleRows.length,
		sale_row_rewrite_total: saleRowPatches.length,
		remove_doc_total: removeDocs.length,
		update_canonical_total: canonicalUpdates.length,
		rebuild_status_total: Array.from(new Set(affectedBottleNos.filter(Boolean))).length,
		groups,
		duplicate_to_canonical_map: duplicateToCanonicalMap,
		sale_row_patches: saleRowPatches,
		canonical_updates: canonicalUpdates,
		remove_docs: removeDocs,
		affected_bottle_nos: Array.from(new Set(affectedBottleNos.filter(Boolean)))
	}
}

async function backupDuplicateCleanupRows(batchId, subtype, rows = [], requestId) {
	let savedTotal = 0
	let skippedTotal = 0
	let disabledReason = ''
	for (let i = 0; i < rows.length; i += 1) {
		if (disabledReason) {
			skippedTotal += 1
			continue
		}
		try {
			await bottleImportBackups.add({
				type: 'duplicate_cleanup_v1',
				subtype,
				batch_id: batchId,
				request_id: requestId,
				created_at: Date.now(),
				payload: rows[i]
			})
			savedTotal += 1
		} catch (err) {
			const message = normalizeString(err && (err.message || err.errMsg || err.toString()))
			if (/not found collection/i.test(message)) {
				disabledReason = message || 'backup_collection_missing'
				skippedTotal += rows.length - i
				console.warn('[crm-bottle] duplicate cleanup backup skipped: collection missing', {
					subtype,
					message
				})
				break
			}
			throw err
		}
	}
	return {
		subtype,
		row_total: rows.length,
		saved_total: savedTotal,
		skipped_total: skippedTotal,
		disabled_reason: disabledReason || ''
	}
}

async function cleanupDuplicateBottleStatusByNos(bottleNos = []) {
	const normalizedNos = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNo(item)).filter(Boolean)))
	if (!normalizedNos.length) {
		return {
			target_total: 0,
			updated_total: 0,
			changed_total: 0,
			unchanged_total: 0,
			no_movement_total: 0,
			pending_same_day_total: 0
		}
	}
	const targetRows = await fetchBottleRowsByWhere({ bottle_no: dbCmd.in(normalizedNos) }, {
		_id: true,
		bottle_no: true,
		status: true,
		current_customer_id: true,
		current_customer_name: true
	})
	const movementRows = await fetchBottleMovementRowsByBottleNos(normalizedNos)
	const movementMap = buildBottleMovementRowMap(movementRows)
	const summary = {
		target_total: targetRows.length,
		updated_total: 0,
		changed_total: 0,
		unchanged_total: 0,
		no_movement_total: 0,
		pending_same_day_total: 0
	}
	for (let i = 0; i < targetRows.length; i += 1) {
		const doc = targetRows[i] || {}
		const bottleNo = normalizeBottleNo(doc.bottle_no)
		const rows = movementMap.get(bottleNo) || []
		if (!rows.length) summary.no_movement_total += 1
		const expected = buildExpectedBottleState(doc, rows)
		if (expected.skip_reason === 'pending_same_day_back_out') {
			summary.pending_same_day_total += 1
			continue
		}
		const nextStatus = normalizeStatus(expected && expected.status) || 'unknown'
		const nextCustomerId = normalizeString(expected && expected.current_customer_id) || null
		const nextCustomerName = normalizeString(expected && expected.current_customer_name)
		const currentStatus = normalizeStatus(doc && doc.status) || 'unknown'
		const currentCustomerId = normalizeString(doc && doc.current_customer_id) || null
		const currentCustomerName = normalizeString(doc && doc.current_customer_name)
		const changed =
			currentStatus !== nextStatus ||
			currentCustomerId !== nextCustomerId ||
			currentCustomerName !== nextCustomerName
		if (!changed) {
			summary.unchanged_total += 1
			continue
		}
		summary.changed_total += 1
		await bottles.doc(doc._id).update({
			status: nextStatus,
			current_customer_id: nextCustomerId,
			current_customer_name: nextCustomerName,
			updated_at: Date.now()
		})
		summary.updated_total += 1
	}
	return summary
}

async function cleanupDuplicatesV1(user, data, requestId) {
	const preview = toBoolean(data && data.preview, true)
	const confirmText = normalizeString(data && (data.confirm_text || data.confirmText))
	if (!preview && confirmText !== DUPLICATE_CLEANUP_CONFIRM_TEXT) {
		return { code: 400, msg: `执行清洗请确认 confirm_text=${DUPLICATE_CLEANUP_CONFIRM_TEXT}` }
	}
	const plan = await buildBottleDuplicateCleanupPlan()
	const responseData = {
		preview,
		confirm_text: DUPLICATE_CLEANUP_CONFIRM_TEXT,
		duplicate_group_total: plan.duplicate_group_total,
		duplicate_row_total: plan.duplicate_row_total,
		sale_row_rewrite_total: plan.sale_row_rewrite_total,
		update_canonical_total: plan.update_canonical_total,
		rebuild_status_total: plan.rebuild_status_total,
		sample_groups: plan.groups.slice(0, 100)
	}
	if (preview || !plan.duplicate_group_total) {
		await recordLog(
			user,
			'bottle_cleanup_duplicates_preview_v1',
			{
				duplicate_group_total: plan.duplicate_group_total,
				duplicate_row_total: plan.duplicate_row_total,
				sale_row_rewrite_total: plan.sale_row_rewrite_total,
				update_canonical_total: plan.update_canonical_total,
				rebuild_status_total: plan.rebuild_status_total
			},
			requestId
		)
		return { code: 0, msg: '预览成功', data: responseData }
	}

	const batchId = `bottle_duplicate_cleanup_${Date.now()}`
	const backupSummaries = []
	backupSummaries.push(await backupDuplicateCleanupRows(batchId, 'bottle_remove', plan.remove_docs, requestId))
	backupSummaries.push(
		await backupDuplicateCleanupRows(batchId, 'canonical_before', plan.canonical_updates.map((item) => item.before), requestId)
	)
	backupSummaries.push(
		await backupDuplicateCleanupRows(
			batchId,
			'sale_record_before',
			plan.sale_row_patches.map((item) => ({
				_id: item._id,
				date: item.date,
				customer_name: item.customer_name,
				row: item.before,
				replacements: item.replacements
			})),
			requestId
		)
	)

	for (let i = 0; i < plan.canonical_updates.length; i += 1) {
		const item = plan.canonical_updates[i]
		await bottles.doc(item._id).update(item.patch)
	}
	for (let i = 0; i < plan.sale_row_patches.length; i += 1) {
		const item = plan.sale_row_patches[i]
		await saleRecords.doc(item._id).update(item.patch)
	}
	for (let i = 0; i < plan.remove_docs.length; i += 1) {
		await bottles.doc(plan.remove_docs[i]._id).remove()
	}
	const rebuildSummary = await cleanupDuplicateBottleStatusByNos(plan.affected_bottle_nos)
	await recordLog(
		user,
		'bottle_cleanup_duplicates_execute_v1',
		{
			batch_id: batchId,
			duplicate_group_total: plan.duplicate_group_total,
			duplicate_row_total: plan.duplicate_row_total,
			sale_row_rewrite_total: plan.sale_row_rewrite_total,
			update_canonical_total: plan.update_canonical_total,
			rebuild_status_total: plan.rebuild_status_total,
			rebuild_summary: rebuildSummary,
			backup_summaries: backupSummaries
		},
		requestId
	)
	return {
		code: 0,
		msg: '清洗完成',
		data: {
			...responseData,
			batch_id: batchId,
			rebuild_summary: rebuildSummary,
			backup_summaries: backupSummaries
		}
	}
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
				pda_qr_code: true,
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
	let emptyPdaQrCode = 0
	let emptyQrCode = 0
	let emptyGaugeNo = 0

	rows.forEach((row) => {
		if (!normalizeString(row.bottle_no)) emptyBottleNo += 1
		if (!normalizeString(row.pda_qr_code)) emptyPdaQrCode += 1
		if (!normalizeString(row.qr_code)) emptyQrCode += 1
		if (!normalizeString(row.pressure_gauge_no)) emptyGaugeNo += 1
	})

	return {
		code: 0,
		data: {
			total: rows.length,
			empty: {
				bottle_no: emptyBottleNo,
				pda_qr_code: emptyPdaQrCode,
				qr_code: emptyQrCode,
				pressure_gauge_no: emptyGaugeNo
			},
			duplicates: {
				bottle_no: collectDuplicateValues(rows, 'bottle_no', sampleLimit),
				pda_qr_code: collectDuplicateValues(rows, 'pda_qr_code', sampleLimit),
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
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
		recordLog,
		requestId,
		cloudFunction: 'crm-bottle'
	})
	if (!acl.ok) return { code: acl.code, msg: acl.msg }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'resolveQrCodeV1') return resolveQrCodeV1(user, data)
	if (action === 'resolveBottleNoV1') return resolveBottleNoV1(user, data)
	if (action === 'createV1') return createV1(user, data, requestId, token)
	if (action === 'updateV1') return updateV1(user, data, requestId, token)
	if (action === 'batchUpdateInspectionV1') return batchUpdateInspectionV1(user, data, requestId)
	if (action === 'rebuildCurrentStatusV1') return rebuildCurrentStatusV1(user, data, requestId)
	if (action === 'backfillBottleSortKeysV1') return backfillBottleSortKeysV1(user, data, requestId)
	if (action === 'backfillRegFieldsV1') return backfillRegFieldsV1(user, data, requestId)
	if (action === 'auditUniqueFieldsV1') return auditUniqueFieldsV1(user, data)
	if (action === 'cleanupDuplicatesV1') return cleanupDuplicatesV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
