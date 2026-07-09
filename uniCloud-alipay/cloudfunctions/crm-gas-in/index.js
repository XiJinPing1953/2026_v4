'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const vehicles = db.collection('crm_vehicles')
const gasIn = db.collection('crm_gas_in')
const gasSettings = db.collection('crm_gas_settings')
const gasInventoryMovements = db.collection('crm_gas_inventory_movements')
const gasInventoryMovementBackups = db.collection('crm_gas_inventory_movements_backup')
const tankTelemetry = db.collection('crm_tank_telemetry')
const fillings = db.collection('crm_fillings')
const sales = db.collection('crm_sale_records')
const bottleMovements = db.collection('crm_bottle_movements')
let ensureActionAcl = null
let tankTelemetryCore = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-gas-in] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
try {
	tankTelemetryCore = require('../common/tankTelemetry')
} catch (err) {
	console.warn('[crm-gas-in] tank telemetry helper unavailable', err && err.message)
}

const DEFAULT_PRODUCT_NAME = 'LNG'
const GAS_TANK_SETTING_KEY = 'main_tank_estimate'
const LIST_PAGE_MAX = 200
const SUMMARY_SCAN_LIMIT = 120000
const REBUILD_SCAN_LIMIT = 120000
const CYCLE_SCAN_LIMIT = 120000
const REBUILD_ALLOWED_ROLES = new Set(['superadmin', 'admin'])
const FLOW_TYPES = ['back', 'fill', 'out']
const PAGE_ACTION_RULES = {
	listV1: [{ pagePath: '/pages/gas-in/list', action: 'view' }],
	getV1: [
		{ pagePath: '/pages/gas-in/list', action: 'view' },
		{ pagePath: '/pages/gas-in/edit', action: 'view' }
	],
	createV1: [{ pagePath: '/pages/gas-in/edit', action: 'create' }],
	updateV1: [{ pagePath: '/pages/gas-in/edit', action: 'update' }],
	removeV1: [{ pagePath: '/pages/gas-in/list', action: 'delete' }],
	getTankConfigV1: [{ pagePath: '/pages/gas-in/list', action: 'view' }],
	updateTankConfigV1: [{ pagePath: '/pages/gas-in/list', action: 'update' }],
	syncCycleAdjustmentsV1: [{ pagePath: '/pages/gas-in/list', action: 'update' }]
}
const SUPERADMIN_ONLY_ACTIONS = ['rebuildInventoryV1', 'restoreInventoryV1']

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
		console.error('[crm-gas-in] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function looksLikeTruckNo(value) {
	const text = normalizeBottleNo(value)
	return /^TRUCK[-_A-Z0-9]/.test(text)
}

function normalizeTextCode(value) {
	return normalizeString(value).replace(/\s+/g, '')
}

function getErrorMessage(err) {
	if (!err) return ''
	if (typeof err === 'string') return err
	return normalizeString(err.message || err.errMsg || err.msg || '')
}

function isCollectionNotFoundError(err) {
	const text = getErrorMessage(err).toLowerCase()
	return text.includes('not found collection') || text.includes('collection not found')
}

function hasOwn(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function roundTo(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	const base = 10 ** Number(digits || 0)
	return Math.round(num * base) / base
}

function roundTon(value) {
	return roundTo(value, 3)
}

function nullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function roundMoney(value) {
	return roundTo(value, 2)
}

function kgToTon(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return roundTon(num / 1000)
}

function buildEmptyTankSummary(message = '等待现场网关上报') {
	return {
		level_m: null,
		level_percent: null,
		pressure_mpa: null,
		status: 'empty',
		sampled_at: null,
		updated_at: null,
		message
	}
}

function normalizeTankStatus(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'online' || text === 'stale' || text === 'error' || text === 'empty') return text
	return 'empty'
}

function normalizeTankSummary(row = {}) {
	const source = row && typeof row === 'object' ? row : {}
	return {
		level_m: nullableNumber(source.level_m),
		level_percent: nullableNumber(source.level_percent),
		pressure_mpa: nullableNumber(source.pressure_mpa),
		status: normalizeTankStatus(source.status),
		sampled_at: nullableNumber(source.sampled_at),
		updated_at: nullableNumber(source.updated_at),
		message: normalizeString(source.message)
	}
}

function buildDefaultGasTankConfig() {
	return {
		key: GAS_TANK_SETTING_KEY,
		full_tank_weight_t: 0,
		updated_at: null,
		updated_by: null,
		updated_by_name: ''
	}
}

function normalizeGasTankConfig(row = {}) {
	const source = row && typeof row === 'object' ? row : {}
	return {
		key: normalizeString(source.key) || GAS_TANK_SETTING_KEY,
		full_tank_weight_t: roundTon(Math.max(toNumber(source.full_tank_weight_t, 0) || 0, 0)),
		updated_at: nullableNumber(source.updated_at),
		updated_by: source.updated_by || null,
		updated_by_name: normalizeString(source.updated_by_name)
	}
}

async function getGasTankConfig() {
	try {
		const res = await gasSettings.where({ key: GAS_TANK_SETTING_KEY }).limit(1).get()
		const doc = (res.data && res.data[0]) || null
		return normalizeGasTankConfig(doc || buildDefaultGasTankConfig())
	} catch (err) {
		if (isCollectionNotFoundError(err)) return buildDefaultGasTankConfig()
		console.error('[crm-gas-in] getGasTankConfig failed', err)
		return buildDefaultGasTankConfig()
	}
}

async function getTankTelemetrySummaryForGas() {
	try {
		if (tankTelemetryCore && typeof tankTelemetryCore.getTankTelemetrySummary === 'function') {
			return normalizeTankSummary(await tankTelemetryCore.getTankTelemetrySummary(tankTelemetry, 'main'))
		}
		const res = await tankTelemetry
			.where({ tank_id: 'main' })
			.orderBy('updated_at', 'desc')
			.limit(1)
			.get()
		return normalizeTankSummary((res.data && res.data[0]) || buildEmptyTankSummary())
	} catch (err) {
		if (isCollectionNotFoundError(err)) return buildEmptyTankSummary()
		console.error('[crm-gas-in] getTankTelemetrySummaryForGas failed', err)
		return buildEmptyTankSummary('储罐读数加载失败')
	}
}

function buildTankEstimate(inventory = {}, tank = {}, config = {}) {
	const fullTankWeightT = roundTon(toNumber(config.full_tank_weight_t, 0) || 0)
	const levelPercent = nullableNumber(tank.level_percent)
	const stationTotalT = roundTon(toNumber(inventory.station_total_t, 0) || 0)
	const configured = fullTankWeightT > 0
	const available = configured && levelPercent != null && normalizeTankStatus(tank.status) !== 'error'
	const estimatedT = available ? roundTon((Math.min(Math.max(levelPercent, 0), 100) * fullTankWeightT) / 100) : null
	const diffT = estimatedT == null ? null : roundTon(estimatedT - stationTotalT)
	let message = ''
	if (!configured) message = '请先配置满罐吨数'
	else if (levelPercent == null) message = '暂无有效液位读数'
	else if (normalizeTankStatus(tank.status) === 'error') message = '现场采集异常，暂停估算'
	else if (normalizeTankStatus(tank.status) === 'stale') message = '液位数据延迟，估算仅供参考'
	else message = '液位估算不参与账面库存'
	return {
		full_tank_weight_t: fullTankWeightT,
		estimated_t: estimatedT,
		station_total_t: stationTotalT,
		diff_t: diffT,
		configured,
		available,
		message
	}
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function toYmdByParts(yearValue, monthValue, dayValue) {
	const year = Number(yearValue)
	const month = Number(monthValue)
	const day = Number(dayValue)
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return ''
	if (year < 1970 || year > 2200) return ''
	if (month < 1 || month > 12) return ''
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	if (day < 1 || day > maxDay) return ''
	return `${year}-${pad2(month)}-${pad2(day)}`
}

function formatDayByTs(ts) {
	const d = new Date(ts)
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function normalizeGasDate(value, fallbackTs = null) {
	const text = normalizeString(value)
	if (!text) {
		if (fallbackTs == null) return ''
		return formatDayByTs(Number(fallbackTs) || Date.now())
	}

	const compactYmd = text.match(/^(\d{4})(\d{2})(\d{2})$/)
	if (compactYmd) {
		const normalized = toYmdByParts(compactYmd[1], compactYmd[2], compactYmd[3])
		if (normalized) return normalized
	}

	const ymdMatch = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
	if (ymdMatch) {
		const normalized = toYmdByParts(ymdMatch[1], ymdMatch[2], ymdMatch[3])
		if (normalized) return normalized
	}

	if (/^\d{10,13}$/.test(text)) {
		const asNum = Number(text)
		if (Number.isFinite(asNum) && asNum > 0) {
			const ts = text.length === 10 ? asNum * 1000 : asNum
			return formatDayByTs(ts)
		}
	}

	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return formatDayByTs(parsed)
	return ''
}

function isValidDateString(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [y, m, d] = text.split('-')
	return Boolean(toYmdByParts(y, m, d))
}

function normalizeEventDay(dateText, fallbackTs) {
	const normalized = normalizeGasDate(dateText, fallbackTs)
	if (normalized) return normalized
	return formatDayByTs(Number(fallbackTs) || Date.now())
}

function parseEventAt(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
	if (m) {
		const ts = Date.parse(
			`${m[1]}-${m[2]}-${m[3]}T${pad2(m[4] || '00')}:${pad2(m[5] || '00')}:${pad2(m[6] || '00')}+08:00`
		)
		if (Number.isFinite(ts) && ts > 0) return ts
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return Number(fallbackTs) || Date.now()
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function mergeWhere(base, extra) {
	if (!base || (typeof base === 'object' && Object.keys(base).length === 0)) return extra
	return dbCmd.and([base, extra])
}

function movementKey(sourceType, sourceId, movementKind) {
	return `${normalizeString(sourceType)}|${normalizeString(sourceId)}|${normalizeString(movementKind)}`
}

function toMovementDelta(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return roundTon(num)
}

function normalizeGasNumberField(value, digits = 3) {
	if (value === '' || value == null) return null
	const num = Number(value)
	if (!Number.isFinite(num)) return NaN
	if (digits === 2) return roundMoney(num)
	return roundTon(num)
}

function normalizeGasInPatch(data = {}, { forUpdate = false } = {}) {
	const patch = {}

	if (!forUpdate || hasOwn(data, 'date')) patch.date = normalizeGasDate(data.date)
	if (!forUpdate || hasOwn(data, 'product_name')) patch.product_name = normalizeString(data.product_name)
	if (!forUpdate || hasOwn(data, 'plate_no')) patch.plate_no = normalizePlateNo(data.plate_no)
	if (!forUpdate || hasOwn(data, 'tanker_no')) patch.tanker_no = normalizeTextCode(data.tanker_no)
	if (!forUpdate || hasOwn(data, 'sender')) patch.sender = normalizeString(data.sender)
	if (!forUpdate || hasOwn(data, 'factory')) patch.factory = normalizeString(data.factory)
	if (!forUpdate || hasOwn(data, 'remark')) patch.remark = normalizeString(data.remark)

	if (!forUpdate || hasOwn(data, 'load_weight_t')) patch.load_weight_t = normalizeGasNumberField(data.load_weight_t, 3)
	if (!forUpdate || hasOwn(data, 'gross_weight_t')) patch.gross_weight_t = normalizeGasNumberField(data.gross_weight_t, 3)
	if (!forUpdate || hasOwn(data, 'tare_weight_t')) patch.tare_weight_t = normalizeGasNumberField(data.tare_weight_t, 3)
	if (!forUpdate || hasOwn(data, 'net_weight_t')) patch.net_weight_t = normalizeGasNumberField(data.net_weight_t, 3)
	if (!forUpdate || hasOwn(data, 'station_weight_t')) patch.station_weight_t = normalizeGasNumberField(data.station_weight_t, 3)
	if (!forUpdate || hasOwn(data, 'direct_sale_weight_t')) patch.direct_sale_weight_t = normalizeGasNumberField(data.direct_sale_weight_t, 3)
	if (!forUpdate || hasOwn(data, 'loss_amount_t')) patch.loss_amount_t = normalizeGasNumberField(data.loss_amount_t, 3)
	if (!forUpdate || hasOwn(data, 'unit_price_per_ton')) {
		patch.unit_price_per_ton = normalizeGasNumberField(data.unit_price_per_ton, 2)
	}
	if (!forUpdate || hasOwn(data, 'amount')) patch.amount = normalizeGasNumberField(data.amount, 2)

	return patch
}

function finalizeGasInDoc(rawDoc = {}, manualFlags = {}) {
	const doc = {
		...rawDoc,
		product_name: normalizeString(rawDoc.product_name) || DEFAULT_PRODUCT_NAME,
		plate_no: normalizePlateNo(rawDoc.plate_no),
		tanker_no: normalizeTextCode(rawDoc.tanker_no),
		sender: normalizeString(rawDoc.sender),
		factory: normalizeString(rawDoc.factory),
		remark: normalizeString(rawDoc.remark)
	}

	doc.load_weight_t = normalizeGasNumberField(doc.load_weight_t, 3)
	doc.gross_weight_t = normalizeGasNumberField(doc.gross_weight_t, 3)
	doc.tare_weight_t = normalizeGasNumberField(doc.tare_weight_t, 3)
	doc.net_weight_t = normalizeGasNumberField(doc.net_weight_t, 3)
	doc.station_weight_t = normalizeGasNumberField(doc.station_weight_t, 3)
	doc.direct_sale_weight_t = normalizeGasNumberField(doc.direct_sale_weight_t, 3)
	doc.loss_amount_t = normalizeGasNumberField(doc.loss_amount_t, 3)
	doc.unit_price_per_ton = normalizeGasNumberField(doc.unit_price_per_ton, 2)
	doc.amount = normalizeGasNumberField(doc.amount, 2)

	if (!manualFlags.net_weight_t && Number.isFinite(doc.gross_weight_t) && Number.isFinite(doc.tare_weight_t)) {
		doc.net_weight_t = roundTon(doc.gross_weight_t - doc.tare_weight_t)
	}
	if (Number.isFinite(doc.net_weight_t)) {
		const hasStationWeight = Number.isFinite(doc.station_weight_t)
		const hasDirectSaleWeight = Number.isFinite(doc.direct_sale_weight_t)
		if (!hasStationWeight && !hasDirectSaleWeight) {
			doc.station_weight_t = doc.net_weight_t
			doc.direct_sale_weight_t = 0
		} else if (!hasStationWeight) {
			doc.station_weight_t = roundTon(doc.net_weight_t - doc.direct_sale_weight_t)
		} else if (!hasDirectSaleWeight) {
			doc.direct_sale_weight_t = roundTon(doc.net_weight_t - doc.station_weight_t)
		}
	}
	if (!manualFlags.loss_amount_t && Number.isFinite(doc.load_weight_t) && Number.isFinite(doc.net_weight_t)) {
		doc.loss_amount_t = roundTon(doc.load_weight_t - doc.net_weight_t)
	}
	if (!manualFlags.amount && Number.isFinite(doc.net_weight_t) && Number.isFinite(doc.unit_price_per_ton)) {
		doc.amount = roundMoney(doc.net_weight_t * doc.unit_price_per_ton)
	}

	const warning =
		Number.isFinite(doc.loss_amount_t) && doc.loss_amount_t < 0
			? '损耗为负值，请确认过磅数据是否正确'
			: ''

	return { doc, warning }
}

function validateGasInDoc(doc = {}) {
	if (!doc.date || !isValidDateString(doc.date)) return '入库日期必填且格式需为 YYYY-MM-DD'
	if (!normalizeString(doc.product_name)) return '产品名称必填'
	if (!doc.plate_no) return '车牌号必填'

	const requiredNumberFields = [
		['load_weight_t', '装载重量(吨)'],
		['gross_weight_t', '出厂毛重(吨)'],
		['tare_weight_t', '回厂皮重(吨)'],
		['net_weight_t', '净重(吨)'],
		['station_weight_t', '站内卸入(吨)'],
		['direct_sale_weight_t', '直销随车(吨)'],
		['loss_amount_t', '损耗(吨)'],
		['unit_price_per_ton', '单价(元/吨)'],
		['amount', '金额(元)']
	]
	for (let i = 0; i < requiredNumberFields.length; i += 1) {
		const [key, label] = requiredNumberFields[i]
		if (!(typeof doc[key] === 'number' && Number.isFinite(doc[key]))) {
			return `${label}必填且必须为数字`
		}
	}

	const nonNegativeFields = [
		['load_weight_t', '装载重量(吨)'],
		['gross_weight_t', '出厂毛重(吨)'],
		['tare_weight_t', '回厂皮重(吨)'],
		['net_weight_t', '净重(吨)'],
		['station_weight_t', '站内卸入(吨)'],
		['direct_sale_weight_t', '直销随车(吨)'],
		['unit_price_per_ton', '单价(元/吨)'],
		['amount', '金额(元)']
	]
	for (let i = 0; i < nonNegativeFields.length; i += 1) {
		const [key, label] = nonNegativeFields[i]
		if (doc[key] < 0) return `${label}不能为负数`
	}
	if (Math.abs(roundTon(doc.station_weight_t + doc.direct_sale_weight_t - doc.net_weight_t)) > 0.001) {
		return '站内卸入 + 直销随车 必须等于采购净重'
	}

	return ''
}

async function ensureActiveVehicleByPlateNo(plateNo) {
	const normalized = normalizePlateNo(plateNo)
	if (!normalized) return null
	const res = await vehicles
		.where({ plate_no: normalized, is_active: true })
		.field({ _id: true, plate_no: true })
		.limit(1)
		.get()
	return (res.data && res.data[0]) || null
}

function buildListWhereByFilter(data = {}) {
	const keyword = normalizeString(data.keyword)
	const plateNo = normalizePlateNo(data.plate_no || data.plateNo)
	const dateStartRaw = normalizeString(data.dateStart)
	const dateEndRaw = normalizeString(data.dateEnd)
	const dateStart = dateStartRaw ? normalizeGasDate(dateStartRaw) : ''
	const dateEnd = dateEndRaw ? normalizeGasDate(dateEndRaw) : ''
	if (dateStartRaw && !dateStart) return { ok: false, msg: '开始日期格式无效' }
	if (dateEndRaw && !dateEnd) return { ok: false, msg: '结束日期格式无效' }

	const conditions = []
	if (plateNo) conditions.push({ plate_no: plateNo })
	if (keyword) {
		const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const rx = db.RegExp({ regexp: escaped, options: 'i' })
		conditions.push(
			dbCmd.or([
				{ plate_no: rx },
				{ tanker_no: rx },
				{ sender: rx },
				{ factory: rx },
				{ remark: rx },
				{ product_name: rx }
			])
		)
	}
	if (dateStart && dateEnd) conditions.push({ date: dbCmd.and([dbCmd.gte(dateStart), dbCmd.lte(dateEnd)]) })
	else if (dateStart) conditions.push({ date: dbCmd.gte(dateStart) })
	else if (dateEnd) conditions.push({ date: dbCmd.lte(dateEnd) })

	let where = {}
	if (conditions.length === 1) where = conditions[0]
	if (conditions.length > 1) where = dbCmd.and(conditions)
	return {
		ok: true,
		where,
		filters: {
			keyword,
			plate_no: plateNo,
			dateStart,
			dateEnd
		}
	}
}

async function scanRows({ collection, where = {}, field = null, orderBy = [], limit = SUMMARY_SCAN_LIMIT, pageSize = 300 }) {
	const rows = []
	let skip = 0
	while (true) {
		let query = collection.where(where)
		for (let i = 0; i < orderBy.length; i += 1) {
			const item = orderBy[i]
			query = query.orderBy(item.key, item.order)
		}
		query = query.skip(skip).limit(pageSize)
		if (field) query = query.field(field)
		const res = await query.get()
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (rows.length > limit) {
			return { ok: false, msg: `扫描数据超过 ${limit} 条，请缩小范围`, data: [] }
		}
		if (list.length < pageSize) break
		skip += list.length
	}
	return { ok: true, data: rows }
}

async function summarizeGasInWhere(where) {
	const summary = {
		load_weight_t_total: 0,
		net_weight_t_total: 0,
		station_weight_t_total: 0,
		direct_sale_weight_t_total: 0,
		loss_amount_t_total: 0,
		avg_price_per_ton: 0,
		loss_rate: 0,
		amount_total: 0
	}
	let rowsRes = null
	try {
		rowsRes = await scanRows({
			collection: gasIn,
			where,
			field: { load_weight_t: true, net_weight_t: true, station_weight_t: true, direct_sale_weight_t: true, loss_amount_t: true, amount: true },
			orderBy: [{ key: 'date', order: 'desc' }, { key: 'created_at', order: 'desc' }],
			limit: SUMMARY_SCAN_LIMIT,
			pageSize: 400
		})
	} catch (err) {
		if (isCollectionNotFoundError(err)) return { ok: true, data: summary }
		return { ok: false, msg: getErrorMessage(err) || '统计扫描失败', data: summary }
	}
	if (!rowsRes.ok) return { ok: false, msg: rowsRes.msg, data: summary }
	const rows = rowsRes.data || []
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		const normalized = normalizeGasInRow(row)
		summary.load_weight_t_total += toNumber(row.load_weight_t, 0) || 0
		summary.net_weight_t_total += toNumber(row.net_weight_t, 0) || 0
		summary.station_weight_t_total += toNumber(normalized.station_weight_t, 0) || 0
		summary.direct_sale_weight_t_total += toNumber(normalized.direct_sale_weight_t, 0) || 0
		summary.loss_amount_t_total += toNumber(row.loss_amount_t, 0) || 0
		summary.amount_total += toNumber(row.amount, 0) || 0
	}
	summary.load_weight_t_total = roundTon(summary.load_weight_t_total)
	summary.net_weight_t_total = roundTon(summary.net_weight_t_total)
	summary.station_weight_t_total = roundTon(summary.station_weight_t_total)
	summary.direct_sale_weight_t_total = roundTon(summary.direct_sale_weight_t_total)
	summary.loss_amount_t_total = roundTon(summary.loss_amount_t_total)
	summary.amount_total = roundMoney(summary.amount_total)
	summary.avg_price_per_ton = summary.net_weight_t_total
		? roundMoney(summary.amount_total / summary.net_weight_t_total)
		: 0
	summary.loss_rate = summary.load_weight_t_total
		? roundTo(summary.loss_amount_t_total / summary.load_weight_t_total, 4)
		: 0
	return { ok: true, data: summary }
}

async function getInventorySnapshot(asOfDate = '') {
	const base = {
		asset_total_t: 0,
		station_total_t: 0,
		in_bottle_total_t: 0,
		vehicle_total_t: 0,
		balance_diff_t: 0,
		as_of_date: normalizeString(asOfDate),
		scope: asOfDate ? 'as_of' : 'current',
		movement_total: 0
	}
	let rowsRes = null
	try {
		rowsRes = await scanRows({
			collection: gasInventoryMovements,
			where: asOfDate ? { event_day: dbCmd.lte(asOfDate) } : {},
			field: {
				event_day: true,
				movement_kind: true,
				asset_delta_t: true,
				station_delta_t: true,
				in_bottle_delta_t: true,
				meta: true
			},
			orderBy: [{ key: 'event_day', order: 'desc' }, { key: 'event_at', order: 'desc' }],
			limit: SUMMARY_SCAN_LIMIT,
			pageSize: 400
		})
	} catch (err) {
		if (isCollectionNotFoundError(err)) return base
		return base
	}
	if (!rowsRes.ok) return base
	const rows = rowsRes.data || []
	base.movement_total = rows.length
	for (let i = 0; i < rows.length; i += 1) {
		const contribution = resolveInventoryContribution(rows[i] || {})
		base.asset_total_t += contribution.asset
		base.station_total_t += contribution.station
		base.in_bottle_total_t += contribution.inBottle
		base.vehicle_total_t += contribution.vehicle
	}
	base.asset_total_t = roundTon(base.asset_total_t)
	base.station_total_t = roundTon(base.station_total_t)
	base.in_bottle_total_t = roundTon(base.in_bottle_total_t)
	base.vehicle_total_t = roundTon(base.vehicle_total_t)
	base.balance_diff_t = roundTon(base.asset_total_t - base.station_total_t - base.in_bottle_total_t - base.vehicle_total_t)
	return base
}

function resolveInventoryContribution(row = {}) {
	const asset = toNumber(row.asset_delta_t, 0) || 0
	const station = toNumber(row.station_delta_t, 0) || 0
	const inBottleRaw = toNumber(row.in_bottle_delta_t, 0) || 0
	const movementKind = normalizeString(row.movement_kind)
	const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {}
	const bottleNo = normalizeBottleNo(meta.bottle_no)
	const inventoryScope = normalizeString(meta.inventory_scope).toLowerCase()

	let inBottle = inBottleRaw
	let vehicle = 0

	if (movementKind === 'filling_truck_fill') {
		vehicle = roundTon(-station)
	} else if (movementKind === 'sale_truck') {
		vehicle = roundTon(asset)
	} else if (movementKind === 'gas_in') {
		const directSaleWeight = toNumber(meta.direct_sale_weight_t, null)
		vehicle = roundTon(Number.isFinite(directSaleWeight) ? directSaleWeight : Math.max(asset - station, 0))
	} else if (movementKind === 'filling_normal_fill' && (inventoryScope === 'truck' || looksLikeTruckNo(bottleNo))) {
		inBottle = 0
		vehicle = roundTon(-station)
	}

	return {
		asset: roundTon(asset),
		station: roundTon(station),
		inBottle: roundTon(inBottle),
		vehicle: roundTon(vehicle)
	}
}

function normalizeGasInRow(row = {}) {
	const doc = row && typeof row === 'object' ? { ...row } : {}
	const lossAmount = toNumber(doc.loss_amount_t, null)
	const netWeight = toNumber(doc.net_weight_t, null)
	let directSaleWeight = toNumber(doc.direct_sale_weight_t, null)
	let stationWeight = toNumber(doc.station_weight_t, null)
	if (Number.isFinite(netWeight)) {
		if (!Number.isFinite(directSaleWeight) && Number.isFinite(stationWeight)) {
			directSaleWeight = roundTon(netWeight - stationWeight)
		} else if (!Number.isFinite(directSaleWeight)) {
			directSaleWeight = 0
		}
		if (!Number.isFinite(stationWeight)) {
			stationWeight = roundTon(netWeight - directSaleWeight)
		}
	}
	return {
		...doc,
		product_name: normalizeString(doc.product_name) || DEFAULT_PRODUCT_NAME,
		plate_no: normalizePlateNo(doc.plate_no),
		tanker_no: normalizeTextCode(doc.tanker_no),
		sender: normalizeString(doc.sender),
		factory: normalizeString(doc.factory),
		remark: normalizeString(doc.remark),
		station_weight_t: Number.isFinite(stationWeight) ? roundTon(stationWeight) : null,
		direct_sale_weight_t: Number.isFinite(directSaleWeight) ? roundTon(directSaleWeight) : null,
		warning: Number.isFinite(lossAmount) && lossAmount < 0 ? 'loss_negative' : ''
	}
}

function buildMovementDoc({
	eventDay,
	eventAt,
	sourceType,
	sourceId,
	movementKind,
	assetDeltaT,
	stationDeltaT,
	inBottleDeltaT,
	note,
	meta,
	createdAt,
	user,
	createdBy,
	createdByName
}) {
	return {
		event_day: normalizeString(eventDay),
		event_at: Number(eventAt) || Number(createdAt) || Date.now(),
		source_type: normalizeString(sourceType),
		source_id: normalizeString(sourceId),
		movement_kind: normalizeString(movementKind),
		asset_delta_t: toMovementDelta(assetDeltaT),
		station_delta_t: toMovementDelta(stationDeltaT),
		in_bottle_delta_t: toMovementDelta(inBottleDeltaT),
		note: normalizeString(note),
		meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {},
		created_at: Number(createdAt) || Date.now(),
		created_by: createdBy != null ? normalizeString(createdBy) : normalizeString(user?._id) || null,
		created_by_name: createdByName != null ? normalizeString(createdByName) : normalizeString(user?.username)
	}
}

async function removeGasInventoryMovementsBySource(sourceType, sourceId) {
	const normalizedSourceType = normalizeString(sourceType)
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceType || !normalizedSourceId) return
	await gasInventoryMovements
		.where({ source_type: normalizedSourceType, source_id: normalizedSourceId })
		.remove()
}

async function replaceGasInInboundMovement({ sourceId, date, netWeightT, stationWeightT, directSaleWeightT, note, user }) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return
	await removeGasInventoryMovementsBySource('gas_in', normalizedSourceId)
	const net = toNumber(netWeightT, null)
	if (!(typeof net === 'number' && Number.isFinite(net) && net !== 0)) return
	const directSale = Math.max(toNumber(directSaleWeightT, 0) || 0, 0)
	const station = Number.isFinite(toNumber(stationWeightT, null))
		? toNumber(stationWeightT, 0)
		: roundTon(net - directSale)
	const now = Date.now()
	await gasInventoryMovements.add(
		buildMovementDoc({
			eventDay: normalizeEventDay(date, now),
			eventAt: parseEventAt(date, now),
			sourceType: 'gas_in',
			sourceId: normalizedSourceId,
			movementKind: 'gas_in',
			assetDeltaT: net,
			stationDeltaT: station,
			inBottleDeltaT: 0,
			note: normalizeString(note) || '天然气入库',
			meta: {
				net_weight_t: roundTon(net),
				station_weight_t: roundTon(station),
				direct_sale_weight_t: roundTon(directSale)
			},
			createdAt: now,
			user
		})
	)
}

function sumNetKgFromSaleItems(rows = [], key = 'net') {
	return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
		return sum + (toNumber(row && row[key], 0) || 0)
	}, 0)
}

function buildFillingGasMovementCandidate(row = {}) {
	const sourceId = normalizeString(row._id)
	if (!sourceId) return null
	const recordType = normalizeString(row.record_type).toLowerCase() || 'normal_fill'
	const bottleNo = normalizeBottleNo(row.bottle_no)
	const isTruckFill = recordType === 'normal_fill' && looksLikeTruckNo(bottleNo)
	const fillWeightKg = toNumber(row.fill_weight, 0) || 0
	const qT = kgToTon(fillWeightKg)
	if (!(typeof qT === 'number' && Number.isFinite(qT) && qT !== 0)) return null

	let deltas = null
	let movementKind = ''
	if (recordType === 'normal_fill') {
		deltas = isTruckFill ? { asset: 0, station: -qT, inBottle: 0 } : { asset: 0, station: -qT, inBottle: qT }
		movementKind = isTruckFill ? 'filling_truck_fill' : 'filling_normal_fill'
	} else if (recordType === 'truck_out_agent_sale') {
		deltas = { asset: 0, station: -qT, inBottle: qT }
		movementKind = 'filling_truck_out_agent_sale'
	} else if (recordType === 'truck_out_no_sale') {
		deltas = { asset: -qT, station: -qT, inBottle: 0 }
		movementKind = 'filling_truck_out_no_sale'
	}
	if (!deltas || !movementKind) return null

	const createdAt = Number(row.created_at) || Date.now()
	return buildMovementDoc({
		eventDay: normalizeEventDay(row.date, createdAt),
		eventAt: parseEventAt(row.date, createdAt),
		sourceType: 'filling',
		sourceId,
		movementKind,
		assetDeltaT: deltas.asset,
		stationDeltaT: deltas.station,
		inBottleDeltaT: deltas.inBottle,
		note: normalizeString(row.remark),
		meta: {
			record_type: recordType,
			bottle_no: bottleNo,
			inventory_scope: isTruckFill ? 'truck' : 'bottle'
		},
		createdAt,
		createdBy: row.created_by,
		createdByName: row.created_by_name
	})
}

function buildSaleGasMovementCandidate(row = {}) {
	const sourceId = normalizeString(row._id)
	if (!sourceId) return null
	const bizMode = normalizeString(row.biz_mode).toLowerCase() || 'bottle'

	const outNetKg = sumNetKgFromSaleItems(row.out_items, 'net')
	const backNetKg = sumNetKgFromSaleItems(row.back_items, 'net')
	const agentNetKg = sumNetKgFromSaleItems(row.agent_sale_items, 'fill_weight')
	let saleNetKg = 0
	let movementKind = ''

	if (bizMode === 'agent_sale') {
		saleNetKg = agentNetKg
		movementKind = 'sale_agent_sale'
	} else if (bizMode === 'truck') {
		const outGross = toNumber(row.truck_out_gross, null)
		const backGross = toNumber(row.truck_back_gross, null)
		const truckReferenceNet = outGross != null && backGross != null
			? Math.max(outGross - backGross, 0)
			: toNumber(row.truck_gross_diff, toNumber(row.truck_sale_net, null))
		const hasTruckSettlementBasis =
			row.truck_settle_tare != null
			|| row.truck_settle_gross != null
			|| row.truck_loss_kg != null
		const truckSettlementNet = hasTruckSettlementBasis
			? Math.max(
				toNumber(
					(toNumber(row.truck_settle_gross, null) != null && toNumber(row.truck_settle_tare, null) != null)
						? (toNumber(row.truck_settle_gross, 0) - toNumber(row.truck_settle_tare, 0))
						: row.truck_sale_net,
					0
				),
				0
			)
			: 0
		saleNetKg = truckSettlementNet > 0
			? truckSettlementNet
			: truckReferenceNet != null && truckReferenceNet > 0 ? truckReferenceNet : outNetKg
		movementKind = 'sale_truck'
	} else {
		saleNetKg = outNetKg - backNetKg
		movementKind = 'sale_bottle'
	}

	const qT = kgToTon(saleNetKg)
	if (!(typeof qT === 'number' && Number.isFinite(qT) && qT !== 0)) return null

	const createdAt = Number(row.created_at) || Date.now()
	const hasTruckSettlementBasis =
		bizMode === 'truck'
			&& (
				row.truck_settle_tare != null
				|| row.truck_settle_gross != null
				|| row.truck_loss_kg != null
			)
	const truckReferenceKg =
		bizMode === 'truck'
			? Math.max(
				toNumber(row.truck_gross_diff, toNumber((toNumber(row.truck_out_gross, 0) || 0) - (toNumber(row.truck_back_gross, 0) || 0), 0)),
				0
			)
			: 0
	const truckSettlementKg =
		bizMode === 'truck' && hasTruckSettlementBasis
			? Math.max(
				toNumber(
					(toNumber(row.truck_settle_gross, null) != null && toNumber(row.truck_settle_tare, null) != null)
						? (toNumber(row.truck_settle_gross, 0) - toNumber(row.truck_settle_tare, 0))
						: row.truck_sale_net,
					0
				),
				0
			)
			: 0
	const truckNetDiffKg = bizMode === 'truck' && hasTruckSettlementBasis ? roundTo(truckSettlementKg - truckReferenceKg, 3) : 0
	const truckLossKg = bizMode === 'truck' && hasTruckSettlementBasis ? roundTo(Math.max(truckReferenceKg - truckSettlementKg, 0), 3) : 0
	const movementNoteBase = normalizeString(row.remark)
	const movementNote = truckLossKg > 0 ? `${movementNoteBase ? `${movementNoteBase}；` : ''}净重误差计损耗 ${truckLossKg}kg` : movementNoteBase
	const truckDiffKg =
		bizMode === 'truck'
			? truckNetDiffKg
			: 0

	return buildMovementDoc({
		eventDay: normalizeEventDay(row.date, createdAt),
		eventAt: parseEventAt(row.date, createdAt),
		sourceType: 'sale',
		sourceId,
		movementKind,
		assetDeltaT: -qT,
		stationDeltaT: 0,
		inBottleDeltaT: bizMode === 'truck' ? 0 : -qT,
		note: movementNote,
		meta: {
			biz_mode: bizMode,
			q_kg: roundTon(saleNetKg),
			truck_diff_kg: bizMode === 'truck' ? truckDiffKg : 0,
			truck_reference_kg: bizMode === 'truck' ? roundTo(truckReferenceKg, 3) : 0,
			truck_settlement_kg: bizMode === 'truck' ? roundTo(truckSettlementKg, 3) : 0,
			truck_loss_kg: bizMode === 'truck' ? roundTo(truckLossKg, 3) : 0,
			inventory_scope: bizMode === 'truck' ? 'truck' : 'bottle'
		},
		createdAt,
		createdBy: row.created_by,
		createdByName: row.created_by_name
	})
}

function normalizeFlowType(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'back' || text === 'fill' || text === 'out') return text
	return ''
}

function isDayInRange(day, start, end) {
	const value = normalizeString(day)
	if (!value) return false
	if (start && value < start) return false
	if (end && value > end) return false
	return true
}

function computeCycleAdjustCandidatesFromEvents(rows = [], { dateStart = '', dateEnd = '' } = {}) {
	const candidates = []
	const sorted = [...rows].sort((a, b) => {
		const noA = normalizePlateNo(a && a.bottle_no)
		const noB = normalizePlateNo(b && b.bottle_no)
		if (noA !== noB) return noA < noB ? -1 : 1
		const eventAtA = Number(a && a.event_at) || 0
		const eventAtB = Number(b && b.event_at) || 0
		if (eventAtA !== eventAtB) return eventAtA - eventAtB
		const orderA = Number(a && a.type_order) || 99
		const orderB = Number(b && b.type_order) || 99
		if (orderA !== orderB) return orderA - orderB
		const createdAtA = Number(a && a.created_at) || 0
		const createdAtB = Number(b && b.created_at) || 0
		return createdAtA - createdAtB
	})

	let currentBottle = ''
	let activeCycle = null

	for (let i = 0; i < sorted.length; i += 1) {
		const row = sorted[i] || {}
		const bottleNo = normalizePlateNo(row.bottle_no)
		if (!bottleNo) continue
		if (bottleNo !== currentBottle) {
			currentBottle = bottleNo
			activeCycle = null
		}
		const type = normalizeFlowType(row.type)
		if (!type) continue

		if (type === 'back') {
			activeCycle = {
				backNetKg: toNumber(row.net_weight, 0) || 0,
				backDate: normalizeString(row.date),
				fillSumKg: 0,
				fillCount: 0
			}
			continue
		}

		if (type === 'fill') {
			if (!activeCycle) continue
			activeCycle.fillSumKg += toNumber(row.net_weight, 0) || 0
			activeCycle.fillCount += 1
			continue
		}

		if (type === 'out') {
			if (!activeCycle) continue
			const outDay = normalizeString(row.event_day) || normalizeString(row.date)
			if (!isDayInRange(outDay, dateStart, dateEnd)) {
				activeCycle = null
				continue
			}
			const outNetKg = toNumber(row.net_weight, 0) || 0
			const deltaKg = roundTon(activeCycle.backNetKg + activeCycle.fillSumKg - outNetKg)
			if (deltaKg !== 0) {
				const sourceOutId = normalizeString(row.source_id)
				const sourceOutEventId = normalizeString(row._id)
				const sourceKeyBase = sourceOutId || sourceOutEventId
				if (sourceKeyBase) {
					const qT = kgToTon(Math.abs(deltaKg)) || 0
					if (qT > 0) {
						candidates.push({
							source_id: `${sourceKeyBase}::${bottleNo}`,
							source_out_id: sourceOutId || sourceOutEventId,
							bottle_no: bottleNo,
							event_day: outDay,
							event_at: Number(row.event_at) || parseEventAt(outDay, Date.now()),
							delta_kg: deltaKg,
							q_t: qT,
							back_date: activeCycle.backDate,
							out_date: normalizeString(row.date)
						})
					}
				}
			}
			activeCycle = null
		}
	}

	return candidates
}

function buildCycleAdjustMovementDoc(candidate = {}, user) {
	const deltaKg = toNumber(candidate.delta_kg, 0) || 0
	const qT = kgToTon(Math.abs(deltaKg)) || 0
	if (!(qT > 0)) return null
	const isLoss = deltaKg > 0
	const sign = isLoss ? -1 : 1
	return buildMovementDoc({
		eventDay: normalizeString(candidate.event_day),
		eventAt: Number(candidate.event_at) || Date.now(),
		sourceType: 'cycle_adjust',
		sourceId: normalizeString(candidate.source_id),
		movementKind: 'cycle_adjust',
		assetDeltaT: roundTon(sign * qT),
		stationDeltaT: 0,
		inBottleDeltaT: roundTon(sign * qT),
		note: `闭环差值${isLoss ? '损耗' : '回冲'} ${Math.abs(deltaKg).toFixed(3)}kg`,
		meta: {
			source_out_id: normalizeString(candidate.source_out_id),
			bottle_no: normalizeString(candidate.bottle_no),
			back_date: normalizeString(candidate.back_date),
			out_date: normalizeString(candidate.out_date),
			delta_kg: deltaKg
		},
		createdAt: Date.now(),
		user
	})
}

async function fetchFlowEventsForCycle({ scanLimit = CYCLE_SCAN_LIMIT } = {}) {
	const rowsRes = await scanRows({
		collection: bottleMovements,
		where: { type: dbCmd.in(FLOW_TYPES) },
		field: {
			_id: true,
			bottle_no: true,
			type: true,
			date: true,
			event_day: true,
			event_at: true,
			type_order: true,
			source_id: true,
			net_weight: true,
			created_at: true
		},
		orderBy: [{ key: 'event_at', order: 'asc' }, { key: 'created_at', order: 'asc' }],
		limit: scanLimit,
		pageSize: 500
	})
	if (!rowsRes.ok) return rowsRes
	return { ok: true, data: rowsRes.data || [] }
}

async function fetchExistingMovementMapByKeys(keys = []) {
	const normalizedKeys = Array.from(new Set((keys || []).map((item) => normalizeString(item)).filter(Boolean)))
	const map = new Map()
	if (!normalizedKeys.length) return map

	const chunkSize = 200
	for (let i = 0; i < normalizedKeys.length; i += chunkSize) {
		const chunk = normalizedKeys.slice(i, i + chunkSize)
		const res = await gasInventoryMovements
			.where({ source_type: 'cycle_adjust', movement_kind: 'cycle_adjust', source_id: dbCmd.in(chunk) })
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		for (let j = 0; j < rows.length; j += 1) {
			const row = rows[j] || {}
			const key = movementKey(row.source_type, row.source_id, row.movement_kind)
			map.set(key, row)
		}
	}
	return map
}

function isMovementChanged(oldRow = {}, newRow = {}) {
	if (normalizeString(oldRow.event_day) !== normalizeString(newRow.event_day)) return true
	if ((Number(oldRow.event_at) || 0) !== (Number(newRow.event_at) || 0)) return true
	if (toMovementDelta(oldRow.asset_delta_t) !== toMovementDelta(newRow.asset_delta_t)) return true
	if (toMovementDelta(oldRow.station_delta_t) !== toMovementDelta(newRow.station_delta_t)) return true
	if (toMovementDelta(oldRow.in_bottle_delta_t) !== toMovementDelta(newRow.in_bottle_delta_t)) return true
	if (normalizeString(oldRow.note) !== normalizeString(newRow.note)) return true
	return false
}

function summarizeMovementDocs(rows = []) {
	const summary = {
		total: 0,
		asset_total_t: 0,
		station_total_t: 0,
		in_bottle_total_t: 0,
		vehicle_total_t: 0,
		balance_diff_t: 0,
		by_kind: {}
	}
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		summary.total += 1
		const contribution = resolveInventoryContribution(row)
		summary.asset_total_t += contribution.asset
		summary.station_total_t += contribution.station
		summary.in_bottle_total_t += contribution.inBottle
		summary.vehicle_total_t += contribution.vehicle
		const kind = normalizeString(row.movement_kind) || 'unknown'
		if (!summary.by_kind[kind]) {
			summary.by_kind[kind] = {
				total: 0,
				asset_total_t: 0,
				station_total_t: 0,
				in_bottle_total_t: 0,
				vehicle_total_t: 0
			}
		}
		summary.by_kind[kind].total += 1
		summary.by_kind[kind].asset_total_t = roundTon(summary.by_kind[kind].asset_total_t + contribution.asset)
		summary.by_kind[kind].station_total_t = roundTon(summary.by_kind[kind].station_total_t + contribution.station)
		summary.by_kind[kind].in_bottle_total_t = roundTon(summary.by_kind[kind].in_bottle_total_t + contribution.inBottle)
		summary.by_kind[kind].vehicle_total_t = roundTon(summary.by_kind[kind].vehicle_total_t + contribution.vehicle)
	}
	summary.asset_total_t = roundTon(summary.asset_total_t)
	summary.station_total_t = roundTon(summary.station_total_t)
	summary.in_bottle_total_t = roundTon(summary.in_bottle_total_t)
	summary.vehicle_total_t = roundTon(summary.vehicle_total_t)
	summary.balance_diff_t = roundTon(
		summary.asset_total_t - summary.station_total_t - summary.in_bottle_total_t - summary.vehicle_total_t
	)
	return summary
}

function dedupeMovementDocs(rows = []) {
	const map = new Map()
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		const key = movementKey(row.source_type, row.source_id, row.movement_kind)
		if (!key || key === '||') continue
		map.set(key, row)
	}
	return Array.from(map.values()).sort((a, b) => {
		const atA = Number(a.event_at) || 0
		const atB = Number(b.event_at) || 0
		if (atA !== atB) return atA - atB
		const createdA = Number(a.created_at) || 0
		const createdB = Number(b.created_at) || 0
		if (createdA !== createdB) return createdA - createdB
		const keyA = movementKey(a.source_type, a.source_id, a.movement_kind)
		const keyB = movementKey(b.source_type, b.source_id, b.movement_kind)
		return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
	})
}

async function buildRebuildMovementDocs({ dateStart = '', dateEnd = '', includeCycleAdjust = true } = {}) {
	const whereByDate = {}
	if (dateStart && dateEnd) whereByDate.date = dbCmd.and([dbCmd.gte(dateStart), dbCmd.lte(dateEnd)])
	else if (dateStart) whereByDate.date = dbCmd.gte(dateStart)
	else if (dateEnd) whereByDate.date = dbCmd.lte(dateEnd)

	const [gasInRes, fillingRes, saleRes] = await Promise.all([
		scanRows({
			collection: gasIn,
			where: whereByDate,
			field: {
				_id: true,
				date: true,
				net_weight_t: true,
				station_weight_t: true,
				direct_sale_weight_t: true,
				remark: true,
				created_at: true,
				created_by: true,
				created_by_name: true
			},
			orderBy: [{ key: 'date', order: 'asc' }, { key: 'created_at', order: 'asc' }],
			limit: REBUILD_SCAN_LIMIT,
			pageSize: 400
		}),
		scanRows({
			collection: fillings,
			where: whereByDate,
			field: {
				_id: true,
				date: true,
				bottle_no: true,
				record_type: true,
				fill_weight: true,
				remark: true,
				created_at: true,
				created_by: true,
				created_by_name: true
			},
			orderBy: [{ key: 'date', order: 'asc' }, { key: 'created_at', order: 'asc' }],
			limit: REBUILD_SCAN_LIMIT,
			pageSize: 400
		}),
		scanRows({
			collection: sales,
			where: whereByDate,
			field: {
				_id: true,
				date: true,
				biz_mode: true,
				out_items: true,
				back_items: true,
				agent_sale_items: true,
				truck_gross_diff: true,
				truck_sale_net: true,
				truck_out_gross: true,
				truck_back_gross: true,
				truck_settle_tare: true,
				truck_settle_gross: true,
				truck_loss_kg: true,
				remark: true,
				created_at: true,
				created_by: true,
				source: true
			},
			orderBy: [{ key: 'date', order: 'asc' }, { key: 'created_at', order: 'asc' }],
			limit: REBUILD_SCAN_LIMIT,
			pageSize: 400
		})
	])

	if (!gasInRes.ok) return { ok: false, msg: gasInRes.msg || '扫描入库台账失败' }
	if (!fillingRes.ok) return { ok: false, msg: fillingRes.msg || '扫描灌装台账失败' }
	if (!saleRes.ok) return { ok: false, msg: saleRes.msg || '扫描销售台账失败' }

	const movementDocs = []
	const gasInRows = gasInRes.data || []
	const fillingRows = fillingRes.data || []
	const saleRows = saleRes.data || []

	for (let i = 0; i < gasInRows.length; i += 1) {
		const row = gasInRows[i] || {}
		const sourceId = normalizeString(row._id)
		if (!sourceId) continue
		const normalizedGasIn = normalizeGasInRow(row)
		const net = toNumber(normalizedGasIn.net_weight_t, 0) || 0
		const station = toNumber(normalizedGasIn.station_weight_t, net) || 0
		const directSale = toNumber(normalizedGasIn.direct_sale_weight_t, 0) || 0
		if (net === 0) continue
		const createdAt = Number(row.created_at) || Date.now()
		movementDocs.push(
			buildMovementDoc({
				eventDay: normalizeEventDay(row.date, createdAt),
				eventAt: parseEventAt(row.date, createdAt),
				sourceType: 'gas_in',
				sourceId,
				movementKind: 'gas_in',
				assetDeltaT: net,
				stationDeltaT: station,
				inBottleDeltaT: 0,
				note: normalizeString(row.remark) || '天然气入库',
				meta: {
					net_weight_t: roundTon(net),
					station_weight_t: roundTon(station),
					direct_sale_weight_t: roundTon(directSale)
				},
				createdAt,
				createdBy: row.created_by,
				createdByName: row.created_by_name
			})
		)
	}

	for (let i = 0; i < fillingRows.length; i += 1) {
		const doc = buildFillingGasMovementCandidate(fillingRows[i])
		if (doc) movementDocs.push(doc)
	}

	for (let i = 0; i < saleRows.length; i += 1) {
		const doc = buildSaleGasMovementCandidate(saleRows[i])
		if (doc) movementDocs.push(doc)
	}

	let cycleCandidateCount = 0
	let preservedCycleAdjustTotal = 0
	if (includeCycleAdjust) {
		const flowRes = await fetchFlowEventsForCycle({ scanLimit: CYCLE_SCAN_LIMIT })
		if (!flowRes.ok) return { ok: false, msg: flowRes.msg || '扫描闭环数据失败' }
		const cycleCandidates = computeCycleAdjustCandidatesFromEvents(flowRes.data || [], { dateStart, dateEnd })
		cycleCandidateCount = cycleCandidates.length
		for (let i = 0; i < cycleCandidates.length; i += 1) {
			const move = buildCycleAdjustMovementDoc(cycleCandidates[i], null)
			if (move) movementDocs.push(move)
		}
	} else {
		const existingCycleRes = await fetchExistingCycleAdjustDocs()
		if (!existingCycleRes.ok) return { ok: false, msg: existingCycleRes.msg || '读取闭环差值失败' }
		const existingCycleRows = existingCycleRes.data || []
		preservedCycleAdjustTotal = existingCycleRows.length
		for (let i = 0; i < existingCycleRows.length; i += 1) {
			const row = existingCycleRows[i]
			if (row && typeof row === 'object') movementDocs.push(row)
		}
	}

	const deduped = dedupeMovementDocs(movementDocs)
	return {
		ok: true,
		data: deduped,
		stats: {
			gas_in_source_total: gasInRows.length,
			filling_source_total: fillingRows.length,
			sale_source_total: saleRows.length,
			cycle_candidate_total: cycleCandidateCount,
			preserved_cycle_adjust_total: preservedCycleAdjustTotal,
			movement_total: deduped.length,
			summary: summarizeMovementDocs(deduped)
		}
	}
}

async function clearAllGasInventoryMovements() {
	while (true) {
		const res = await gasInventoryMovements.field({ _id: true }).limit(200).get()
		const rows = Array.isArray(res.data) ? res.data : []
		if (!rows.length) break
		const ids = rows.map((row) => normalizeString(row && row._id)).filter(Boolean)
		if (!ids.length) break
		await gasInventoryMovements.where({ _id: dbCmd.in(ids) }).remove()
		if (rows.length < 200) break
	}
}

async function insertMovementDocs(rows = []) {
	const list = Array.isArray(rows) ? rows : []
	const chunkSize = 200
	for (let i = 0; i < list.length; i += chunkSize) {
		const chunk = list.slice(i, i + chunkSize)
		if (!chunk.length) continue
		await gasInventoryMovements.add(chunk)
	}
}

async function fetchExistingCycleAdjustDocs() {
	const rowsRes = await scanRows({
		collection: gasInventoryMovements,
		where: { source_type: 'cycle_adjust', movement_kind: 'cycle_adjust' },
		limit: REBUILD_SCAN_LIMIT,
		pageSize: 300
	})
	if (!rowsRes.ok) return { ok: false, msg: rowsRes.msg || '读取现有闭环差值失败', data: [] }
	return {
		ok: true,
		data: Array.isArray(rowsRes.data) ? rowsRes.data : []
	}
}

async function backupCurrentMovements(runId, user, requestId) {
	const rowsRes = await scanRows({
		collection: gasInventoryMovements,
		where: {},
		limit: REBUILD_SCAN_LIMIT,
		pageSize: 300
	})
	if (!rowsRes.ok) return rowsRes
	const rows = rowsRes.data || []
	if (!rows.length) return { ok: true, total: 0 }

	const now = Date.now()
	const chunkSize = 120
	for (let i = 0; i < rows.length; i += chunkSize) {
		const chunk = rows.slice(i, i + chunkSize)
		await gasInventoryMovementBackups.add(
			chunk.map((row) => ({
				run_id: runId,
				request_id: requestId,
				backup_doc: row,
				backed_up_at: now,
				backed_up_by: user?._id || null,
				backed_up_by_name: user?.username || ''
			}))
		)
	}
	return { ok: true, total: rows.length }
}

async function listV1(user, data) {
	void user
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.limit || 50) || 50, 1), LIST_PAGE_MAX)
	const filterRes = buildListWhereByFilter(data)
	if (!filterRes.ok) return { code: 400, msg: filterRes.msg || '筛选参数无效' }
	const where = filterRes.where
	const inventoryAsOfRaw = normalizeString(data.inventory_as_of || data.inventoryAsOf)
	const inventoryAsOf = inventoryAsOfRaw ? normalizeGasDate(inventoryAsOfRaw) : ''
	if (inventoryAsOfRaw && !inventoryAsOf) return { code: 400, msg: '库存截止日期格式无效' }

	let res = null
	let totalRes = null
	try {
		res = await gasIn
			.where(where)
			.orderBy('date', 'desc')
			.orderBy('created_at', 'desc')
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get()
		totalRes = await gasIn.where(where).count()
	} catch (err) {
		if (!isCollectionNotFoundError(err)) throw err
		return {
			code: 0,
			msg: '天然气入库集合未初始化，请先上传 db schema（crm_gas_in、crm_gas_inventory_movements）',
			data: [],
			total: 0,
			paging: {
				page,
				pageSize,
				total: 0,
				hasMore: false
			},
			summary: {
				total: 0,
				load_weight_t_total: 0,
				net_weight_t_total: 0,
				station_weight_t_total: 0,
				direct_sale_weight_t_total: 0,
				loss_amount_t_total: 0,
				avg_price_per_ton: 0,
				loss_rate: 0,
				amount_total: 0,
				inventory: {
					asset_total_t: 0,
					station_total_t: 0,
					in_bottle_total_t: 0,
					vehicle_total_t: 0,
					balance_diff_t: 0,
					as_of_date: inventoryAsOf,
					scope: inventoryAsOf ? 'as_of' : 'current',
					movement_total: 0,
					tank: buildEmptyTankSummary(),
					estimate: buildTankEstimate({}, buildEmptyTankSummary(), buildDefaultGasTankConfig())
				}
			}
		}
	}
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total

	const summaryRes = await summarizeGasInWhere(where)
	if (!summaryRes.ok) return { code: 400, msg: summaryRes.msg || '统计失败' }
	const summary = summaryRes.data || { net_weight_t_total: 0, amount_total: 0 }
	const [inventory, tankConfig, tankSummary] = await Promise.all([
		getInventorySnapshot(inventoryAsOf),
		getGasTankConfig(),
		getTankTelemetrySummaryForGas()
	])
	inventory.tank = tankSummary
	inventory.estimate = buildTankEstimate(inventory, tankSummary, tankConfig)

	const rows = Array.isArray(res.data) ? res.data.map((row) => normalizeGasInRow(row)) : []

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
			load_weight_t_total: Number(summary.load_weight_t_total || 0),
			net_weight_t_total: Number(summary.net_weight_t_total || 0),
			station_weight_t_total: Number(summary.station_weight_t_total || 0),
			direct_sale_weight_t_total: Number(summary.direct_sale_weight_t_total || 0),
			loss_amount_t_total: Number(summary.loss_amount_t_total || 0),
			avg_price_per_ton: Number(summary.avg_price_per_ton || 0),
			loss_rate: Number(summary.loss_rate || 0),
			amount_total: Number(summary.amount_total || 0),
			inventory
		}
	}
}

async function getTankConfigV1(user) {
	void user
	const config = await getGasTankConfig()
	return { code: 0, data: config }
}

async function updateTankConfigV1(user, data, requestId) {
	const fullTankWeightT = toNumber(data.full_tank_weight_t ?? data.fullTankWeightT, null)
	if (!Number.isFinite(fullTankWeightT) || fullTankWeightT <= 0) {
		return { code: 400, msg: '满罐吨数必须大于 0' }
	}
	if (fullTankWeightT > 100000) {
		return { code: 400, msg: '满罐吨数超出合理范围' }
	}
	const now = Date.now()
	const saveDoc = {
		key: GAS_TANK_SETTING_KEY,
		full_tank_weight_t: roundTon(fullTankWeightT),
		updated_at: now,
		updated_by: user?._id || null,
		updated_by_name: user?.username || ''
	}
	try {
		const existingRes = await gasSettings.where({ key: GAS_TANK_SETTING_KEY }).field({ _id: true }).limit(1).get()
		const existing = (existingRes.data && existingRes.data[0]) || null
		if (existing && existing._id) {
			await gasSettings.doc(existing._id).update(saveDoc)
		} else {
			await gasSettings.add({
				...saveDoc,
				created_at: now,
				created_by: user?._id || null,
				created_by_name: user?.username || ''
			})
		}
	} catch (err) {
		if (isCollectionNotFoundError(err)) return { code: 500, msg: '天然气配置集合未初始化，请先上传 db schema（crm_gas_settings）' }
		throw err
	}
	await recordLog(user, 'gas_tank_config_update_v1', { full_tank_weight_t: saveDoc.full_tank_weight_t }, requestId)
	return { code: 0, msg: '配置已保存', data: normalizeGasTankConfig(saveDoc) }
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const res = await gasIn.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	return { code: 0, data: normalizeGasInRow(doc) }
}

async function createV1(user, data, requestId) {
	const patch = normalizeGasInPatch(data, { forUpdate: false })
	const manualFlags = {
		net_weight_t: hasOwn(data, 'net_weight_t'),
		loss_amount_t: hasOwn(data, 'loss_amount_t'),
		amount: hasOwn(data, 'amount')
	}
	const { doc, warning } = finalizeGasInDoc(patch, manualFlags)
	const validateMsg = validateGasInDoc(doc)
	if (validateMsg) return { code: 400, msg: validateMsg }

	const activeVehicle = await ensureActiveVehicleByPlateNo(doc.plate_no)
	if (!activeVehicle) return { code: 400, msg: '车牌未关联启用车辆档案' }

	const now = Date.now()
	const saveDoc = {
		...doc,
		created_at: now,
		updated_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || '',
		updated_by: user?._id || null,
		updated_by_name: user?.username || ''
	}

	const addRes = await gasIn.add(saveDoc)
	await replaceGasInInboundMovement({
		sourceId: addRes.id,
		date: saveDoc.date,
		netWeightT: saveDoc.net_weight_t,
		stationWeightT: saveDoc.station_weight_t,
		directSaleWeightT: saveDoc.direct_sale_weight_t,
		note: saveDoc.remark,
		user
	})

	await recordLog(user, 'gas_in_create_v1', { id: addRes.id, plate_no: saveDoc.plate_no }, requestId)

	return {
		code: 0,
		msg: warning ? `创建成功（${warning}）` : '创建成功',
		data: {
			_id: addRes.id,
			warning
		}
	}
}

async function updateV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id || data.recordId)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const oldRes = await gasIn.doc(id).get()
	const oldDoc = (oldRes.data && oldRes.data[0]) || null
	if (!oldDoc) return { code: 404, msg: '记录不存在' }

	const patch = normalizeGasInPatch(data, { forUpdate: true })
	const merged = {
		...oldDoc,
		...patch,
		date: hasOwn(patch, 'date') ? patch.date : normalizeGasDate(oldDoc.date, oldDoc.created_at)
	}
	const manualFlags = {
		net_weight_t: hasOwn(data, 'net_weight_t'),
		loss_amount_t: hasOwn(data, 'loss_amount_t'),
		amount: hasOwn(data, 'amount')
	}
	const { doc, warning } = finalizeGasInDoc(merged, manualFlags)
	const validateMsg = validateGasInDoc(doc)
	if (validateMsg) return { code: 400, msg: validateMsg }

	const activeVehicle = await ensureActiveVehicleByPlateNo(doc.plate_no)
	if (!activeVehicle) return { code: 400, msg: '车牌未关联启用车辆档案' }

	const now = Date.now()
	const updateDoc = {
		date: doc.date,
		product_name: doc.product_name,
		plate_no: doc.plate_no,
		tanker_no: doc.tanker_no,
		sender: doc.sender,
		factory: doc.factory,
		remark: doc.remark,
		load_weight_t: doc.load_weight_t,
		gross_weight_t: doc.gross_weight_t,
		tare_weight_t: doc.tare_weight_t,
		net_weight_t: doc.net_weight_t,
		station_weight_t: doc.station_weight_t,
		direct_sale_weight_t: doc.direct_sale_weight_t,
		loss_amount_t: doc.loss_amount_t,
		unit_price_per_ton: doc.unit_price_per_ton,
		amount: doc.amount,
		updated_at: now,
		updated_by: user?._id || null,
		updated_by_name: user?.username || ''
	}

	await gasIn.doc(id).update(updateDoc)
	await replaceGasInInboundMovement({
		sourceId: id,
		date: updateDoc.date,
		netWeightT: updateDoc.net_weight_t,
		stationWeightT: updateDoc.station_weight_t,
		directSaleWeightT: updateDoc.direct_sale_weight_t,
		note: updateDoc.remark,
		user
	})

	await recordLog(user, 'gas_in_update_v1', { id, plate_no: updateDoc.plate_no }, requestId)

	return {
		code: 0,
		msg: warning ? `更新成功（${warning}）` : '更新成功',
		data: { warning }
	}
}

async function removeV1(user, data, requestId) {
	const id = normalizeString(data._id || data.id || data.recordId)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const oldRes = await gasIn.doc(id).get()
	const oldDoc = (oldRes.data && oldRes.data[0]) || null
	if (!oldDoc) return { code: 404, msg: '记录不存在' }

	await removeGasInventoryMovementsBySource('gas_in', id)
	await gasIn.doc(id).remove()
	await recordLog(user, 'gas_in_remove_v1', { id, plate_no: normalizePlateNo(oldDoc.plate_no) }, requestId)
	return { code: 0, msg: '删除成功' }
}

async function syncCycleAdjustmentsV1(user, data, requestId) {
	if (!REBUILD_ALLOWED_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅管理员可操作' }
	}

	const preview = data && data.preview !== false
	const dateStartRaw = normalizeString(data && data.dateStart)
	const dateEndRaw = normalizeString(data && data.dateEnd)
	const dateStart = dateStartRaw ? normalizeGasDate(dateStartRaw) : ''
	const dateEnd = dateEndRaw ? normalizeGasDate(dateEndRaw) : ''
	if (dateStartRaw && !dateStart) return { code: 400, msg: '开始日期格式无效' }
	if (dateEndRaw && !dateEnd) return { code: 400, msg: '结束日期格式无效' }

	const flowRes = await fetchFlowEventsForCycle({ scanLimit: CYCLE_SCAN_LIMIT })
	if (!flowRes.ok) return { code: 400, msg: flowRes.msg || '扫描闭环数据失败' }

	const candidates = computeCycleAdjustCandidatesFromEvents(flowRes.data || [], { dateStart, dateEnd })
	const sample = candidates.slice(0, 20).map((item) => ({
		source_out_id: item.source_out_id,
		source_id: item.source_id,
		bottle_no: item.bottle_no,
		event_day: item.event_day,
		delta_kg: item.delta_kg,
		q_t: item.q_t
	}))

	if (preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				preview: true,
				dateStart,
				dateEnd,
				target_total: candidates.length,
				sample
			}
		}
	}

	const sourceIds = candidates.map((item) => normalizeString(item.source_id)).filter(Boolean)
	const existingMap = await fetchExistingMovementMapByKeys(sourceIds)

	let inserted = 0
	let updated = 0
	let unchanged = 0
	for (let i = 0; i < candidates.length; i += 1) {
		const candidate = candidates[i]
		const movementDoc = buildCycleAdjustMovementDoc(candidate, user)
		if (!movementDoc) continue
		const key = movementKey(movementDoc.source_type, movementDoc.source_id, movementDoc.movement_kind)
		const existing = existingMap.get(key)
		if (!existing) {
			await gasInventoryMovements.add(movementDoc)
			existingMap.set(key, movementDoc)
			inserted += 1
			continue
		}
		if (!isMovementChanged(existing, movementDoc)) {
			unchanged += 1
			continue
		}
		await gasInventoryMovements.doc(existing._id).update({
			event_day: movementDoc.event_day,
			event_at: movementDoc.event_at,
			asset_delta_t: movementDoc.asset_delta_t,
			station_delta_t: movementDoc.station_delta_t,
			in_bottle_delta_t: movementDoc.in_bottle_delta_t,
			note: movementDoc.note,
			meta: movementDoc.meta
		})
		updated += 1
	}

	await recordLog(
		user,
		'gas_in_sync_cycle_adjustments_v1',
		{
			date_start: dateStart,
			date_end: dateEnd,
			target_total: candidates.length,
			inserted,
			updated,
			unchanged
		},
		requestId
	)

	return {
		code: 0,
		msg: '同步完成',
		data: {
			preview: false,
			target_total: candidates.length,
			inserted,
			updated,
			unchanged,
			sample
		}
	}
}

async function rebuildInventoryV1(user, data, requestId) {
	if (!REBUILD_ALLOWED_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅管理员可操作' }
	}
	const preview = data && data.preview !== false
	const includeCycleAdjust = !(data && data.include_cycle_adjust === false)
	const backupBeforeRebuild = Boolean(data && data.backup_before_rebuild === true)
	const dateStartRaw = normalizeString(data && data.dateStart)
	const dateEndRaw = normalizeString(data && data.dateEnd)
	const dateStart = dateStartRaw ? normalizeGasDate(dateStartRaw) : ''
	const dateEnd = dateEndRaw ? normalizeGasDate(dateEndRaw) : ''
	if (dateStartRaw && !dateStart) return { code: 400, msg: '开始日期格式无效' }
	if (dateEndRaw && !dateEnd) return { code: 400, msg: '结束日期格式无效' }

	const buildRes = await buildRebuildMovementDocs({ dateStart, dateEnd, includeCycleAdjust })
	if (!buildRes.ok) return { code: 400, msg: buildRes.msg || '重建预处理失败' }
	const movementDocs = buildRes.data || []
	const stats = buildRes.stats || {}

	if (preview) {
		return {
			code: 0,
			msg: 'ok',
			data: {
				preview: true,
				dateStart,
				dateEnd,
				include_cycle_adjust: includeCycleAdjust,
				backup_before_rebuild: backupBeforeRebuild,
				stats
			}
		}
	}

	let runId = normalizeString(data && (data.run_id || data.runId))
	let backupTotal = 0
	if (backupBeforeRebuild) {
		runId = runId || `gas_inventory_rebuild_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
		const backupRes = await backupCurrentMovements(runId, user, requestId)
		if (!backupRes.ok) {
			return { code: 400, msg: backupRes.msg || '备份失败，已终止重建' }
		}
		backupTotal = Number(backupRes.total || 0)
	}

	await clearAllGasInventoryMovements()
	await insertMovementDocs(movementDocs)

	await recordLog(
		user,
		'gas_in_rebuild_inventory_v1',
		{
			run_id: runId || '',
			date_start: dateStart,
			date_end: dateEnd,
			include_cycle_adjust: includeCycleAdjust,
			backup_before_rebuild: backupBeforeRebuild,
			backup_total: backupTotal,
			inserted_total: movementDocs.length,
			stats
		},
		requestId
	)

	return {
		code: 0,
		msg: '重建完成',
		data: {
			preview: false,
			run_id: runId || '',
			backup_before_rebuild: backupBeforeRebuild,
			backup_total: backupTotal,
			inserted_total: movementDocs.length,
			stats
		}
	}
}

async function restoreInventoryV1(user, data, requestId) {
	if (!REBUILD_ALLOWED_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅管理员可操作' }
	}
	const runId = normalizeString(data && (data.run_id || data.runId))
	if (!runId) return { code: 400, msg: 'run_id 必填' }

	const backupRes = await scanRows({
		collection: gasInventoryMovementBackups,
		where: { run_id: runId },
		field: { backup_doc: true },
		orderBy: [{ key: 'backed_up_at', order: 'asc' }],
		limit: REBUILD_SCAN_LIMIT,
		pageSize: 300
	})
	if (!backupRes.ok) return { code: 400, msg: backupRes.msg || '读取备份失败' }
	const backups = backupRes.data || []
	if (!backups.length) return { code: 404, msg: '未找到对应 run_id 的备份数据' }

	const restoreDocs = backups
		.map((item) => item && item.backup_doc)
		.filter((doc) => doc && typeof doc === 'object')

	await clearAllGasInventoryMovements()
	await insertMovementDocs(restoreDocs)

	await recordLog(
		user,
		'gas_in_restore_inventory_v1',
		{ run_id: runId, restored_total: restoreDocs.length },
		requestId
	)

	return {
		code: 0,
		msg: '恢复完成',
		data: {
			run_id: runId,
			restored_total: restoreDocs.length
		}
	}
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	try {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
			recordLog,
			requestId,
			cloudFunction: 'crm-gas-in'
		})
		if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

		if (action === 'listV1') return listV1(user, data)
		if (action === 'getTankConfigV1') return getTankConfigV1(user, data)
		if (action === 'updateTankConfigV1') return updateTankConfigV1(user, data, requestId)
		if (action === 'getV1') return getV1(user, data)
		if (action === 'createV1') return createV1(user, data, requestId)
		if (action === 'updateV1') return updateV1(user, data, requestId)
		if (action === 'removeV1') return removeV1(user, data, requestId)
		if (action === 'syncCycleAdjustmentsV1') return syncCycleAdjustmentsV1(user, data, requestId)
		if (action === 'rebuildInventoryV1') return rebuildInventoryV1(user, data, requestId)
		if (action === 'restoreInventoryV1') return restoreInventoryV1(user, data, requestId)

		return { code: 400, msg: '未知 action' }
	} catch (err) {
		const msg = isCollectionNotFoundError(err)
			? '数据库集合未初始化，请先上传 db schema（crm_gas_in、crm_gas_inventory_movements）'
			: getErrorMessage(err) || '服务异常'
		console.error('[crm-gas-in] main failed', action, err)
		return { code: 500, msg }
	}
}
