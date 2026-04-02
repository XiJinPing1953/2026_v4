'use strict'

const db = uniCloud.database()

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const anomalies = db.collection('crm_bottle_anomalies')
const movements = db.collection('crm_bottle_movements')
const fillings = db.collection('crm_fillings')
const bottles = db.collection('crm_bottles')
const sales = db.collection('crm_sale_records')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-bottle-anomaly] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}

const ANOMALY_TYPES = {
	missing_back: { code: 'missing_back', name: '缺回瓶', desc: '未回瓶却发生灌装或出瓶' },
	missing_fill: { code: 'missing_fill', name: '缺灌装', desc: '回瓶后未灌装就出瓶' },
	missing_out: { code: 'missing_out', name: '缺出瓶', desc: '回瓶后已灌装但未出瓶又再次回瓶' },
	continuous_fill: { code: 'continuous_fill', name: '连续灌装', desc: '前一次灌装未出瓶又再次灌装' },
	continuous_out: { code: 'continuous_out', name: '连续出瓶', desc: '不经过回瓶/灌装连续出瓶' },
	continuous_back: { code: 'continuous_back', name: '连续回瓶', desc: '不经过出瓶连续回瓶' },
	missing_truck_fill: { code: 'missing_truck_fill', name: '缺整车补给', desc: '上次回站后未见补给却直接整车销售' },
	truck_return_diff_excess: {
		code: 'truck_return_diff_excess',
		name: '整车回站差异过大',
		desc: '整车出站总重、回站总重与毛重差值超过阈值'
	},
	missing_truck_back_gross: { code: 'missing_truck_back_gross', name: '缺回站总重', desc: '整车销售单缺少回站总重' }
}
const PAGE_ACTION_RULES = {
	listV1: [{ pagePath: '/pages/bottle/anomaly', action: 'view' }],
	typesV1: [{ pagePath: '/pages/bottle/anomaly', action: 'view' }],
	scanV2: [{ pagePath: '/pages/bottle/anomaly', action: 'view' }],
	scanTruckAnomaliesV1: [{ pagePath: '/pages/bottle/anomaly', action: 'view' }],
	touchV2: [{ pagePath: '/pages/bottle/anomaly', action: 'view' }],
	resolveV1: [{ pagePath: '/pages/bottle/anomaly', action: 'update' }]
}
const SUPERADMIN_ONLY_ACTIONS = ['rebuildV2', 'purgeV1', 'cleanupDuplicatesV1']
const BOTTLE_RECONCILE_TYPE_LIST = [
	'missing_back',
	'missing_fill',
	'missing_out',
	'continuous_fill',
	'continuous_out',
	'continuous_back'
]
const TRUCK_RECONCILE_TYPE_LIST = ['missing_truck_fill', 'truck_return_diff_excess', 'missing_truck_back_gross']
const RECONCILE_TYPE_LIST = [...BOTTLE_RECONCILE_TYPE_LIST, ...TRUCK_RECONCILE_TYPE_LIST]
const RECONCILE_TYPE_SET = new Set(RECONCILE_TYPE_LIST)
const BOTTLE_ANOMALY_TYPE_SET = new Set(BOTTLE_RECONCILE_TYPE_LIST)
const TRUCK_ANOMALY_TYPE_SET = new Set(TRUCK_RECONCILE_TYPE_LIST)
const REBUILD_SCAN_ROLES = new Set(['superadmin'])
const MISSING_FILL_THRESHOLD_KG = 10
const TRUCK_RETURN_DIFF_THRESHOLD_KG = 100
const NON_DIRECT_RESOLVE_TYPE_SET = new Set([
	'missing_back',
	'missing_out',
	'continuous_fill',
	'continuous_out',
	'continuous_back',
	'missing_truck_fill',
	'truck_return_diff_excess',
	'missing_truck_back_gross'
])
const CLEANUP_DUPLICATE_CONFIRM_TEXT = 'DELETE_DUPLICATE_BOTTLE_ANOMALIES'
const MISSING_FILL_RESOLUTION_MODE_LOSS = 'loss_accept'
const MISSING_FILL_RESOLUTION_MODE_SWELL = 'swell_accept'
const MISSING_FILL_RESOLUTION_MODE_SET = new Set([
	MISSING_FILL_RESOLUTION_MODE_LOSS,
	MISSING_FILL_RESOLUTION_MODE_SWELL
])

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

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
		console.error('[crm-bottle-anomaly] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeMissingFillResolutionMode(value) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return ''
	return MISSING_FILL_RESOLUTION_MODE_SET.has(text) ? text : ''
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

function normalizeDay(value) {
	const text = normalizeString(value)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	return m ? m[1] : ''
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

function normalizeFillingRecordType(value) {
	const text = normalizeString(value).toLowerCase()
	return text || 'normal_fill'
}

function looksLikeTruckNo(value) {
	const text = normalizeBottleNo(value)
	return /^TRUCK[-_A-Z0-9]/.test(text)
}

function normalizeBottleNoList(value, maxLen = 200) {
	let list = value
	if (typeof list === 'string') {
		list = list
			.split(',')
			.map((item) => normalizeBottleNo(item))
			.filter(Boolean)
	}
	if (!Array.isArray(list)) return []
	const uniq = []
	const seen = new Set()
	for (const item of list) {
		const no = normalizeBottleNo(item)
		if (!no || seen.has(no)) continue
		seen.add(no)
		uniq.push(no)
		if (uniq.length >= maxLen) break
	}
	return uniq
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function resolveTruckSaleNetValue(rawTruckSaleNet, rawTruckOutGross, rawTruckBackGross) {
	const outGross = toNumber(rawTruckOutGross, null)
	const backGross = toNumber(rawTruckBackGross, null)
	if (outGross != null && backGross != null) {
		const diff = outGross - backGross
		return diff > 0 ? diff : 0
	}
	const explicit = toNumber(rawTruckSaleNet, null)
	return explicit != null && explicit > 0 ? explicit : null
}

function clampNumber(value, min, max, fallback) {
	const num = Number(value)
	if (!Number.isFinite(num)) return fallback
	if (num < min) return min
	if (num > max) return max
	return num
}

function toBoolean(value, fallback = false) {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (text === 'true' || text === '1' || text === 'yes' || text === 'y') return true
	if (text === 'false' || text === '0' || text === 'no' || text === 'n') return false
	return fallback
}

function normalizeReconcileTypes(value) {
	let list = value
	if (typeof list === 'string') {
		list = list
			.split(',')
			.map((item) => normalizeString(item))
			.filter(Boolean)
	}
	if (!Array.isArray(list)) return []
	const unique = []
	const seen = new Set()
	for (const item of list) {
		const type = normalizeString(item)
		if (!RECONCILE_TYPE_SET.has(type)) continue
		if (seen.has(type)) continue
		seen.add(type)
		unique.push(type)
	}
	return unique
}

function buildEmptyDetectedFpsByType() {
	return {
		missing_back: [],
		missing_fill: [],
		missing_out: [],
		continuous_fill: [],
		continuous_out: [],
		continuous_back: [],
		missing_truck_fill: [],
		truck_return_diff_excess: [],
		missing_truck_back_gross: []
	}
}

function toDetectedFpsSetMap(input) {
	const map = new Map()
	for (const type of RECONCILE_TYPE_LIST) {
		const list = Array.isArray(input && input[type]) ? input[type] : []
		map.set(
			type,
			new Set(
				list
					.map((item) => normalizeString(item))
					.filter(Boolean)
			)
		)
	}
	return map
}

function fromDetectedFpsSetMap(map) {
	const out = buildEmptyDetectedFpsByType()
	for (const type of RECONCILE_TYPE_LIST) {
		const set = map.get(type)
		out[type] = set ? Array.from(set).filter(Boolean) : []
	}
	return out
}

function normalizeType(value) {
	const text = normalizeString(value)
	if (text === 'back' || text === 'fill' || text === 'out' || text === 'adjust') return text
	return ''
}

function normalizeAnomalyType(value) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return ''
	return Object.prototype.hasOwnProperty.call(ANOMALY_TYPES, text) ? text : ''
}

function buildMissingFill(event, lastBack) {
	const prevCustomer = lastBack.customer_name || '未知客户'
	const curCustomer = event.customer_name || '未知客户'
	const prevNet = toNumber(lastBack.net_weight, null)
	const outNet = toNumber(event.net_weight, null)
	const prevNetText = prevNet != null ? `（净重 ${prevNet} kg）` : ''
	const outNetText = outNet != null ? `（净重 ${outNet} kg）` : ''
	return {
		type: 'missing_fill',
		bottle_no: event.bottle_no,
		date: event.date,
		detail: `${lastBack.date}从"${prevCustomer}"处回瓶${prevNetText}后未灌装，${event.date}直接出瓶至"${curCustomer}"${outNetText}`,
		context: {
			last_back: {
				date: lastBack.date,
				customer: prevCustomer,
				net: prevNet,
				source_type: normalizeString(lastBack.source_type),
				source_id: normalizeString(lastBack.source_id) || null
			},
			next_out: {
				date: event.date,
				customer: curCustomer,
				net: outNet,
				source_type: normalizeString(event.source_type),
				source_id: normalizeString(event.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildMissingBack(fillEvent, lastOut) {
	const outCustomer = lastOut.customer_name || '未知客户'
	const outNet = toNumber(lastOut.net_weight, null)
	const fillNet = toNumber(fillEvent.net_weight, null)
	return {
		type: 'missing_back',
		bottle_no: fillEvent.bottle_no,
		date: fillEvent.date,
		detail: `${lastOut.date}出瓶至"${outCustomer}"后未回瓶，${fillEvent.date}直接灌装`,
		context: {
			last_out: {
				date: lastOut.date,
				customer: outCustomer,
				net: outNet,
				source_type: normalizeString(lastOut.source_type),
				source_id: normalizeString(lastOut.source_id) || null
			},
			next_fill: {
				date: fillEvent.date,
				net: fillNet,
				source_type: normalizeString(fillEvent.source_type),
				source_id: normalizeString(fillEvent.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildContinuousOut(event, lastOut) {
	return {
		type: 'continuous_out',
		bottle_no: event.bottle_no,
		date: event.date,
		detail: `${lastOut.date}出瓶后未回瓶/灌装，${event.date}再次出瓶`,
		context: {
			last_out: {
				date: lastOut.date,
				customer: normalizeString(lastOut.customer_name),
				net: toNumber(lastOut.net_weight, null),
				source_type: normalizeString(lastOut.source_type),
				source_id: normalizeString(lastOut.source_id) || null
			},
			next_out: {
				date: event.date,
				customer: normalizeString(event.customer_name),
				net: toNumber(event.net_weight, null),
				source_type: normalizeString(event.source_type),
				source_id: normalizeString(event.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildContinuousBack(event, lastBack, hasFillSinceLastBack = false) {
	const prevCustomer = normalizeString(lastBack.customer_name) || '未知客户'
	const curCustomer = normalizeString(event.customer_name) || '未知客户'
	const prevNet = toNumber(lastBack.net_weight, null)
	const backNet = toNumber(event.net_weight, null)
	const prevNetText = prevNet != null ? `（净重 ${prevNet} kg）` : ''
	const backNetText = backNet != null ? `（净重 ${backNet} kg）` : ''
	const midText = hasFillSinceLastBack ? '后已灌装但未出瓶，' : '后未出瓶，'
	return {
		type: 'continuous_back',
		bottle_no: event.bottle_no,
		date: event.date,
		detail: `${lastBack.date}从"${prevCustomer}"处回瓶${prevNetText}${midText}${event.date}又从"${curCustomer}"处回瓶${backNetText}`,
		context: {
			last_back: {
				date: lastBack.date,
				customer: prevCustomer,
				net: prevNet,
				source_type: normalizeString(lastBack.source_type),
				source_id: normalizeString(lastBack.source_id) || null
			},
			next_back: {
				date: event.date,
				customer: curCustomer,
				net: backNet,
				source_type: normalizeString(event.source_type),
				source_id: normalizeString(event.source_id) || null
			},
			has_fill_since_last_back: Boolean(hasFillSinceLastBack)
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildMissingOut(event, lastBack, fillEvent = null) {
	const prevCustomer = normalizeString(lastBack.customer_name) || '未知客户'
	const curCustomer = normalizeString(event.customer_name) || '未知客户'
	const prevNet = toNumber(lastBack.net_weight, null)
	const fillNet = toNumber(fillEvent && fillEvent.net_weight, null)
	const backNet = toNumber(event.net_weight, null)
	const prevNetText = prevNet != null ? `（净重 ${prevNet} kg）` : ''
	const fillText = fillEvent ? `${fillEvent.date}已灌装${fillNet != null ? `（净重 ${fillNet} kg）` : ''}` : '已灌装'
	const backNetText = backNet != null ? `（净重 ${backNet} kg）` : ''
	return {
		type: 'missing_out',
		bottle_no: event.bottle_no,
		date: event.date,
		detail: `${lastBack.date}从"${prevCustomer}"处回瓶${prevNetText}后，${fillText}但未出瓶，${event.date}又从"${curCustomer}"处回瓶${backNetText}`,
		context: {
			last_back: {
				date: lastBack.date,
				customer: prevCustomer,
				net: prevNet,
				source_type: normalizeString(lastBack.source_type),
				source_id: normalizeString(lastBack.source_id) || null
			},
			next_fill: fillEvent
				? {
					date: fillEvent.date,
					net: fillNet,
					source_type: normalizeString(fillEvent.source_type),
					source_id: normalizeString(fillEvent.source_id) || null
				}
				: null,
			next_back: {
				date: event.date,
				customer: curCustomer,
				net: backNet,
				source_type: normalizeString(event.source_type),
				source_id: normalizeString(event.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildContinuousFill(event, lastFill, lastBack = null) {
	const prevFillNet = toNumber(lastFill && lastFill.net_weight, null)
	const fillNet = toNumber(event && event.net_weight, null)
	const prevFillText = prevFillNet != null ? `（净重 ${prevFillNet} kg）` : ''
	const fillText = fillNet != null ? `（净重 ${fillNet} kg）` : ''
	const prefix = lastBack
		? `${lastBack.date}回瓶后，${lastFill.date}已灌装${prevFillText}但未出瓶，`
		: `${lastFill.date}已灌装${prevFillText}但未出瓶，`
	return {
		type: 'continuous_fill',
		bottle_no: event.bottle_no,
		date: event.date,
		detail: `${prefix}${event.date}又再次灌装${fillText}`,
		context: {
			last_back: lastBack
				? {
					date: lastBack.date,
					customer: normalizeString(lastBack.customer_name) || '未知客户',
					net: toNumber(lastBack.net_weight, null),
					source_type: normalizeString(lastBack.source_type),
					source_id: normalizeString(lastBack.source_id) || null
				}
				: null,
			last_fill: {
				date: lastFill.date,
				net: prevFillNet,
				source_type: normalizeString(lastFill.source_type),
				source_id: normalizeString(lastFill.source_id) || null
			},
			next_fill: {
				date: event.date,
				net: fillNet,
				source_type: normalizeString(event.source_type),
				source_id: normalizeString(event.source_id) || null
			}
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildTruckSaleContext(sale, extra = {}) {
	const truckSaleNet = resolveTruckSaleNetValue(sale && (sale.truck_gross_diff ?? sale.truck_sale_net), sale && sale.truck_out_gross, sale && sale.truck_back_gross)
	return {
		date: normalizeString(sale && sale.date),
		customer: normalizeString(sale && sale.customer_name) || '未知客户',
		truck_no: normalizeBottleNo(sale && sale.truck_no),
		truck_out_gross: toNumber(sale && sale.truck_out_gross, null),
		truck_back_gross: toNumber(sale && sale.truck_back_gross, null),
		truck_sale_net: truckSaleNet,
		source_type: 'sale',
		source_id: normalizeString(sale && sale._id) || null,
		...extra
	}
}

function sumTruckSupplementWeight(rows) {
	let total = 0
	for (const row of rows || []) {
		total += toNumber(row && row.fill_weight, 0) || 0
	}
	return round3(total)
}

function buildTruckMissingFillChainText(prevSale, sale, supplementTotalKg) {
	const parts = []
	const prevDate = normalizeString(prevSale && prevSale.date)
	const prevBackGross = toNumber(prevSale && prevSale.truck_back_gross, null)
	const currentDate = normalizeString(sale && sale.date)
	const currentOutGross = toNumber(sale && sale.truck_out_gross, null)
	if (prevDate || prevBackGross != null) {
		parts.push(`${prevDate || '上次'}回站总重${prevBackGross != null ? ` ${prevBackGross} kg` : ''}`)
	}
	if (supplementTotalKg > 0) {
		parts.push(`中间补给 ${supplementTotalKg} kg`)
	}
	if (currentDate || currentOutGross != null) {
		parts.push(`${currentDate || '本次'}出站总重${currentOutGross != null ? ` ${currentOutGross} kg` : ''}`)
	}
	return parts.join(' -> ')
}

function buildMissingTruckFill(sale, prevSale, gapKg, supplements = []) {
	const currentCustomer = normalizeString(sale && sale.customer_name) || '未知客户'
	const previousBackGross = toNumber(prevSale && prevSale.truck_back_gross, null)
	const currentOutGross = toNumber(sale && sale.truck_out_gross, null)
	const supplementTotalKg = sumTruckSupplementWeight(supplements)
	const chainText = buildTruckMissingFillChainText(prevSale, sale, supplementTotalKg)
	return {
		type: 'missing_truck_fill',
		bottle_no: normalizeBottleNo(sale && sale.truck_no),
		date: normalizeString(sale && sale.date),
		detail: `${chainText || `${normalizeString(prevSale && prevSale.date)}回站后至${normalizeString(sale && sale.date)}出站` }，按车重链路推算至少还需补给 ${gapKg} kg，但当前未匹配到有效车辆补给记录，${normalizeString(sale && sale.date)}直接整车销售至"${currentCustomer}"${currentOutGross != null ? `（出站总重 ${currentOutGross} kg）` : ''}`,
		context: {
			last_truck_sale: buildTruckSaleContext(prevSale),
			next_truck_sale: buildTruckSaleContext(sale, {
				supply_gap_kg: toNumber(gapKg, null),
				supplement_total_kg: supplementTotalKg > 0 ? supplementTotalKg : 0
			})
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildTruckReturnDiffExcess(sale, diffKg, prevSale = null, supplements = []) {
	const customer = normalizeString(sale && sale.customer_name) || '未知客户'
	const outGross = toNumber(sale && sale.truck_out_gross, null)
	const backGross = toNumber(sale && sale.truck_back_gross, null)
	const saleNet = resolveTruckSaleNetValue(sale && (sale.truck_gross_diff ?? sale.truck_sale_net), sale && sale.truck_out_gross, sale && sale.truck_back_gross)
	const supplementTotalKg = sumTruckSupplementWeight(supplements)
	const actualConsumedKg = outGross != null && backGross != null ? round3(outGross - backGross) : null
	const diffAbs = round3(Math.abs(diffKg))
	const prevDate = normalizeString(prevSale && prevSale.date)
	const prevBackGross = toNumber(prevSale && prevSale.truck_back_gross, null)
	const chainParts = []
	if (prevDate || prevBackGross != null) {
		chainParts.push(`${prevDate || '上次'}回站总重${prevBackGross != null ? ` ${prevBackGross} kg` : ''}`)
	}
	if (supplementTotalKg > 0) {
		chainParts.push(`中间补给 ${supplementTotalKg} kg`)
	}
	if (normalizeString(sale && sale.date) || outGross != null) {
		chainParts.push(`${normalizeString(sale && sale.date) || '本次'}出站总重${outGross != null ? ` ${outGross} kg` : ''}`)
	}
	let explanation = ''
	if (diffKg > 0) {
		explanation = `本次实际减重 ${actualConsumedKg ?? '-'} kg，比登记毛重差值 ${saleNet ?? '-'} kg 多 ${diffAbs} kg，疑似存在额外损耗、补给漏记或重量录入偏差。`
	} else {
		explanation = `本次实际减重 ${actualConsumedKg ?? '-'} kg，比登记毛重差值 ${saleNet ?? '-'} kg 少 ${diffAbs} kg，说明本次回站后车上仍可能结转约 ${diffAbs} kg 余量，或毛重差值/回站总重录入偏大。上次余量会自然并入回站总重基线，无需单独再加。`
	}
	return {
		type: 'truck_return_diff_excess',
		bottle_no: normalizeBottleNo(sale && sale.truck_no),
		date: normalizeString(sale && sale.date),
		detail: `${chainParts.join(' -> ')}；回站总重 ${backGross ?? '-'} kg，登记毛重差值 ${saleNet ?? '-'} kg，车重链路差值 ${diffKg > 0 ? '+' : ''}${diffKg} kg，超过 ${TRUCK_RETURN_DIFF_THRESHOLD_KG} kg。${explanation}${normalizeString(sale && sale.date)}整车销售客户为"${customer}"。`,
		context: {
			truck_sale: buildTruckSaleContext(sale, {
				diff_kg: toNumber(diffKg, null),
				threshold_kg: TRUCK_RETURN_DIFF_THRESHOLD_KG,
				actual_consumed_kg: actualConsumedKg,
				supplement_total_kg: supplementTotalKg > 0 ? supplementTotalKg : 0,
				direction: diffKg > 0 ? 'positive' : diffKg < 0 ? 'negative' : 'exact'
			}),
			last_truck_sale: buildTruckSaleContext(prevSale)
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function buildMissingTruckBackGross(sale) {
	const customer = normalizeString(sale && sale.customer_name) || '未知客户'
	const outGross = toNumber(sale && sale.truck_out_gross, null)
	const saleNet = resolveTruckSaleNetValue(sale && (sale.truck_gross_diff ?? sale.truck_sale_net), sale && sale.truck_out_gross, sale && sale.truck_back_gross)
	return {
		type: 'missing_truck_back_gross',
		bottle_no: normalizeBottleNo(sale && sale.truck_no),
		date: normalizeString(sale && sale.date),
		detail: `${normalizeString(sale && sale.date)}整车销售至"${customer}"${outGross != null ? `（出站总重 ${outGross} kg）` : ''}${saleNet != null ? `，毛重差值 ${saleNet} kg` : ''}，但未填写回站总重`,
		context: {
			truck_sale: buildTruckSaleContext(sale)
		},
		resolved: false,
		ignored: false,
		created_at: Date.now()
	}
}

function normalizeContext(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value
}

function hasMissingFillLossResolution(row) {
	const ctx = normalizeContext(row && row.context)
	const resolution = normalizeContext(ctx.resolution)
	const mode = normalizeString(resolution.mode).toLowerCase()
	return MISSING_FILL_RESOLUTION_MODE_SET.has(mode)
}

function buildMissingFillResolutionContext(mode, diffKg, lossKg, swellKg, now) {
	return {
		mode,
		threshold_kg: MISSING_FILL_THRESHOLD_KG,
		diff_kg: diffKg,
		loss_kg: lossKg,
		swell_kg: swellKg,
		resolved_at: now
	}
}

function buildAnomalyFingerprint(input) {
	const bottleNo = normalizeBottleNo(input?.bottle_no)
	const anomalyType = normalizeString(input?.anomaly_type || input?.type).toLowerCase()
	const context = normalizeContext(input?.context)
	const pickDate = (...values) => values.map((value) => normalizeString(value)).find(Boolean) || ''
	let date = pickDate(input?.date, context.legacy_date)
	if (!date) {
		if (anomalyType === 'missing_fill') {
			date = pickDate(context.next_out?.date, context.last_back?.date)
		} else if (anomalyType === 'missing_back') {
			date = pickDate(context.next_fill?.date, context.last_out?.date)
		} else if (anomalyType === 'missing_out') {
			date = pickDate(context.next_back?.date, context.next_fill?.date, context.last_back?.date)
		} else if (anomalyType === 'continuous_out') {
			date = pickDate(context.next_out?.date, context.last_out?.date)
		} else if (anomalyType === 'continuous_back') {
			date = pickDate(context.next_back?.date, context.last_back?.date)
		} else if (anomalyType === 'continuous_fill') {
			date = pickDate(context.next_fill?.date, context.last_fill?.date, context.last_back?.date)
		} else if (anomalyType === 'missing_truck_fill') {
			date = pickDate(context.next_truck_sale?.date, context.last_truck_sale?.date)
		} else if (anomalyType === 'truck_return_diff_excess' || anomalyType === 'missing_truck_back_gross') {
			date = pickDate(context.truck_sale?.date)
		}
	}
	const detail = normalizeString(input?.note || input?.detail)
	const lastBack = normalizeContext(context.last_back)
	const lastFill = normalizeContext(context.last_fill)
	const nextOut = normalizeContext(context.next_out)
	const lastOut = normalizeContext(context.last_out)
	const nextFill = normalizeContext(context.next_fill)
	const nextBack = normalizeContext(context.next_back)
	const lastTruckSale = normalizeContext(context.last_truck_sale)
	const nextTruckSale = normalizeContext(context.next_truck_sale)
	const truckSale = normalizeContext(context.truck_sale)
	const key = (value) => normalizeString(value).toLowerCase()
	const numKey = (value) => {
		const num = toNumber(value, null)
		return num == null ? '' : String(num)
	}
	const backSig = (event) => [
		key(event.date),
		key(event.source_type),
		key(event.source_id),
		key(event.customer),
		numKey(event.net)
	]
	const outSig = (event) => [
		key(event.date),
		key(event.source_type),
		key(event.source_id),
		key(event.customer),
		numKey(event.net)
	]
	const fillSig = (event) => [key(event.date), key(event.source_type), key(event.source_id), numKey(event.net)]
	const truckSaleSig = (event) => [
		key(event.date),
		key(event.source_type),
		key(event.source_id),
		key(event.customer),
		key(event.truck_no),
		numKey(event.truck_out_gross),
		numKey(event.truck_back_gross),
		numKey(event.truck_gross_diff ?? event.truck_sale_net),
		numKey(event.supply_gap_kg),
		numKey(event.diff_kg),
		numKey(event.threshold_kg)
	]
	let sig = [key(bottleNo), key(anomalyType), key(date)]
	if (anomalyType === 'missing_fill') {
		sig = sig.concat(backSig(lastBack), outSig(nextOut))
	} else if (anomalyType === 'missing_back') {
		sig = sig.concat(outSig(lastOut), fillSig(nextFill))
	} else if (anomalyType === 'missing_out') {
		sig = sig.concat(backSig(lastBack), fillSig(nextFill), backSig(nextBack))
	} else if (anomalyType === 'continuous_out') {
		sig = sig.concat(outSig(lastOut), outSig(nextOut))
	} else if (anomalyType === 'continuous_back') {
		sig = sig.concat(backSig(lastBack), backSig(nextBack), key(context.has_fill_since_last_back ? '1' : '0'))
	} else if (anomalyType === 'continuous_fill') {
		sig = sig.concat(backSig(lastBack), fillSig(lastFill), fillSig(nextFill))
	} else if (anomalyType === 'missing_truck_fill') {
		sig = sig.concat(truckSaleSig(lastTruckSale), truckSaleSig(nextTruckSale))
	} else if (anomalyType === 'truck_return_diff_excess' || anomalyType === 'missing_truck_back_gross') {
		sig = sig.concat(truckSaleSig(truckSale))
	}
	const hasStructuredIdentity = sig.slice(3).some(Boolean)
	if (!hasStructuredIdentity && detail) {
		sig.push(key(detail))
	}
	return sig.join('|')
}

function getComparableAnomalyFingerprint(row) {
	return buildAnomalyFingerprint(row) || normalizeString(row && row.fingerprint)
}

function anomalyIdentity(row) {
	const fingerprint = getComparableAnomalyFingerprint(row)
	if (fingerprint) return `fp:${fingerprint}`
	const id = normalizeString(row && row._id)
	if (id) return `id:${id}`
	const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
	const type = normalizeAnomalyType(row && row.anomaly_type) || normalizeString(row && row.anomaly_type) || 'other'
	const day = normalizeDay(
		ctx.legacy_date ||
			ctx.next_out?.date ||
			ctx.next_back?.date ||
			ctx.last_back?.date ||
			ctx.last_fill?.date ||
			ctx.last_out?.date ||
			ctx.next_fill?.date ||
			ctx.next_truck_sale?.date ||
			ctx.last_truck_sale?.date ||
			ctx.truck_sale?.date ||
			row?.date
	)
	const note = normalizeString(row && row.note)
	return `fallback:${type}|${day}|${note}`
}

function anomalyStatusPriority(status) {
	return normalizeAnomalyStatus(status) === 'open' ? 2 : 1
}

function anomalySelectionPriority(row) {
	const status = normalizeAnomalyStatus(row && row.status)
	const resolvedByName = normalizeString(row && row.resolved_by_name).toLowerCase()
	const resolvedBy = normalizeString(row && row.resolved_by)
	if (status === 'resolved') {
		if ((resolvedBy || (resolvedByName && resolvedByName !== 'system-reconcile')) && resolvedByName !== 'system-reconcile') {
			return 4
		}
		if (resolvedByName === 'system-reconcile') return 1
		return 2
	}
	if (status === 'open') return 3
	return 0
}

function selectPreferredAnomaly(a, b) {
	const aPriority = anomalySelectionPriority(a)
	const bPriority = anomalySelectionPriority(b)
	if (aPriority !== bPriority) return bPriority > aPriority ? b : a

	const aUpdated = toTimestamp(a && a.updated_at, toTimestamp(a && a.created_at, 0))
	const bUpdated = toTimestamp(b && b.updated_at, toTimestamp(b && b.created_at, 0))
	if (aUpdated !== bUpdated) return bUpdated > aUpdated ? b : a

	const aCreated = toTimestamp(a && a.created_at, 0)
	const bCreated = toTimestamp(b && b.created_at, 0)
	return bCreated >= aCreated ? b : a
}

function sortAnomalyRowsDesc(rows) {
	return [...(rows || [])].sort((a, b) => {
		const aCreated = toTimestamp(a && a.created_at, 0)
		const bCreated = toTimestamp(b && b.created_at, 0)
		if (aCreated !== bCreated) return bCreated - aCreated
		const aUpdated = toTimestamp(a && a.updated_at, aCreated)
		const bUpdated = toTimestamp(b && b.updated_at, bCreated)
		if (aUpdated !== bUpdated) return bUpdated - aUpdated
		return normalizeString(b && b._id).localeCompare(normalizeString(a && a._id))
	})
}

function dedupeAnomalyRows(rows) {
	const uniq = new Map()
	for (const row of rows || []) {
		const key = anomalyIdentity(row)
		if (!uniq.has(key)) {
			uniq.set(key, row)
			continue
		}
		uniq.set(key, selectPreferredAnomaly(uniq.get(key), row))
	}
	return sortAnomalyRowsDesc(Array.from(uniq.values()))
}

function filterAnomalyRowsByStatus(rows, status) {
	const normalizedStatus = normalizeString(status).toLowerCase()
	if (normalizedStatus !== 'open' && normalizedStatus !== 'resolved') return [...(rows || [])]
	return (rows || []).filter((row) => normalizeAnomalyStatus(row && row.status) === normalizedStatus)
}

function buildDuplicateCleanupPlan(rows, limited = false) {
	const groups = new Map()
	for (const row of rows || []) {
		const key = anomalyIdentity(row)
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(row)
	}
	const deleteRows = []
	const keepRows = []
	const groupSamples = []
	let duplicateGroups = 0
	for (const [key, groupRows] of groups.entries()) {
		let keepRow = groupRows[0] || null
		for (let i = 1; i < groupRows.length; i += 1) {
			keepRow = selectPreferredAnomaly(keepRow, groupRows[i])
		}
		if (keepRow) keepRows.push(keepRow)
		if (groupRows.length <= 1) continue
		duplicateGroups += 1
		const keepId = normalizeString(keepRow && keepRow._id)
		const staleRows = groupRows.filter((row) => normalizeString(row && row._id) !== keepId)
		deleteRows.push(...staleRows)
		if (groupSamples.length < 20) {
			groupSamples.push({
				identity: key,
				keep_id: keepId,
				keep_status: normalizeAnomalyStatus(keepRow && keepRow.status),
				keep_type: normalizeAnomalyType(keepRow && keepRow.anomaly_type) || normalizeString(keepRow && keepRow.anomaly_type),
				bottle_no: normalizeBottleNo(keepRow && keepRow.bottle_no),
				size: groupRows.length,
				delete_ids: staleRows.map((row) => normalizeString(row && row._id)).filter(Boolean)
			})
		}
	}
	return {
		limited: Boolean(limited),
		total_rows: Array.isArray(rows) ? rows.length : 0,
		unique_rows: keepRows.length,
		duplicate_groups: duplicateGroups,
		duplicate_rows: deleteRows.length,
		keep_rows: keepRows,
		delete_rows: deleteRows,
		sample_groups: groupSamples
	}
}

function compareBusinessOrder(a, b) {
	const aDay = normalizeEventDay(a.event_day || a.date, a.event_at || a.created_at || Date.now())
	const bDay = normalizeEventDay(b.event_day || b.date, b.event_at || b.created_at || Date.now())
	if (aDay !== bDay) return aDay.localeCompare(bDay)
	const aOrder = toNumber(a.type_order, movementTypeOrder(a.type))
	const bOrder = toNumber(b.type_order, movementTypeOrder(b.type))
	if (aOrder !== bOrder) return aOrder - bOrder
	const aAt = toTimestamp(a.event_at, parseEventAt(a.date, a.created_at || Date.now()))
	const bAt = toTimestamp(b.event_at, parseEventAt(b.date, b.created_at || Date.now()))
	if (aAt !== bAt) return aAt - bAt
	return toTimestamp(a.created_at, 0) - toTimestamp(b.created_at, 0)
}

function normalizeStateEvent(input, bottleNoFallback = '') {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const type = normalizeType(input.type)
	if (!type) return null
	const createdAt = toTimestamp(input.created_at, Date.now())
	const eventAt = toTimestamp(input.event_at, parseEventAt(input.date, createdAt))
	const bottleNo = normalizeBottleNo(input.bottle_no || bottleNoFallback)
	if (!bottleNo) return null
	return {
		bottle_no: bottleNo,
		date: normalizeString(input.date) || normalizeEventDay(input.event_day, eventAt),
		event_day: normalizeEventDay(input.event_day || input.date, eventAt),
		type,
		type_order: toNumber(input.type_order, movementTypeOrder(type)),
		customer_name: normalizeString(input.customer_name),
		net_weight: toNumber(input.net_weight, null),
		event_at: eventAt,
		created_at: createdAt,
		source_type: normalizeString(input.source_type),
		source_id: normalizeString(input.source_id) || null
	}
}

function normalizePendingSameDayBackOutEntry(input, bottleNo) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const backEvent = normalizeStateEvent(input.back_event || input.backEvent || input.last_back, bottleNo)
	const outEvent = normalizeStateEvent(input.out_event || input.outEvent || input.last_out, bottleNo)
	if (!backEvent || !outEvent) return null
	const eventDay = normalizeEventDay(
		input.event_day || input.eventDay || outEvent.event_day || backEvent.event_day,
		Math.max(toTimestamp(outEvent.event_at, 0), toTimestamp(backEvent.event_at, 0), Date.now())
	)
	return {
		event_day: eventDay,
		back_event: backEvent,
		out_event: outEvent,
		created_at: toTimestamp(
			input.created_at,
			Math.max(toTimestamp(backEvent.created_at, 0), toTimestamp(outEvent.created_at, 0), Date.now())
		)
	}
}

function normalizePendingSameDayBackOutQueue(input, bottleNo) {
	let list = input
	if (list && typeof list === 'object' && !Array.isArray(list)) {
		list = [list]
	}
	if (!Array.isArray(list)) return []
	return list
		.map((item) => normalizePendingSameDayBackOutEntry(item, bottleNo))
		.filter(Boolean)
}

function buildMovementEvent(row, bottleNo) {
	const fallbackTs = toTimestamp(row.created_at, Date.now())
	const type = normalizeType(row.type)
	const eventAt = toTimestamp(row.event_at, parseEventAt(row.date, fallbackTs))
	const createdAt = toTimestamp(row.created_at, eventAt)
	const eventDay = normalizeEventDay(row.event_day || row.date, eventAt)
	return {
		_id: normalizeString(row._id),
		bottle_no: bottleNo,
		date: normalizeString(row.date) || eventDay,
		event_day: eventDay,
		type,
		type_order: toNumber(row.type_order, movementTypeOrder(type)),
		customer_name: normalizeString(row.customer_name),
		net_weight: toNumber(row.net_weight, null),
		event_at: eventAt,
		created_at: createdAt,
		source_type: normalizeString(row.source_type),
		source_id: normalizeString(row.source_id) || null
	}
}

function normalizeAnalyzerState(input, bottleNo) {
	const state = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
	const legacyLastEvent = normalizeStateEvent(state.last_event, bottleNo)
	const lastEffective = normalizeStateEvent(state.last_effective_event, bottleNo) || legacyLastEvent
	const lastOut = normalizeStateEvent(state.last_out_event, bottleNo)
	const lastBack = normalizeStateEvent(state.last_back_event, bottleNo) || normalizeStateEvent(state.last_back, bottleNo)
	const normalizedLastOut = lastOut || (lastEffective && lastEffective.type === 'out' ? lastEffective : null)
	const normalized = {
		last_effective_event: lastEffective && lastEffective.type !== 'adjust' ? lastEffective : null,
		last_out_event: normalizedLastOut,
		last_back_event: lastBack,
		has_fill_since_last_back: Boolean(state.has_fill_since_last_back),
		pending_same_day_back_out: normalizePendingSameDayBackOutQueue(
			state.pending_same_day_back_out || state.pendingSameDayBackOut,
			bottleNo
		)
	}
	if (!normalized.last_back_event) {
		normalized.has_fill_since_last_back = false
	}
	return normalized
}

function listEffectiveEvents(events) {
	if (!Array.isArray(events)) return []
	return events.filter((item) => {
		const type = normalizeType(item && item.type)
		return type === 'back' || type === 'fill' || type === 'out'
	})
}

function hasSameDayBackOutWithoutFill(events) {
	const effectiveEvents = listEffectiveEvents(events)
	if (!effectiveEvents.length) return false
	const hasBack = effectiveEvents.some((item) => item.type === 'back')
	const hasFill = effectiveEvents.some((item) => item.type === 'fill')
	const hasOut = effectiveEvents.some((item) => item.type === 'out')
	return hasBack && hasOut && !hasFill
}

function sortDayEventsByTypePriority(events, priorities) {
	return [...events].sort((a, b) => {
		const aType = normalizeType(a && a.type)
		const bType = normalizeType(b && b.type)
		const aPriority = Object.prototype.hasOwnProperty.call(priorities, aType) ? priorities[aType] : 99
		const bPriority = Object.prototype.hasOwnProperty.call(priorities, bType) ? priorities[bType] : 99
		if (aPriority !== bPriority) return aPriority - bPriority
		return compareBusinessOrder(a, b)
	})
}

function interleaveSameDayBackOutEvents(events, startType) {
	const sorted = [...events].sort(compareBusinessOrder)
	const backs = sorted.filter((item) => normalizeType(item && item.type) === 'back')
	const outs = sorted.filter((item) => normalizeType(item && item.type) === 'out')
	const others = sorted.filter((item) => {
		const type = normalizeType(item && item.type)
		return type !== 'back' && type !== 'out'
	})
	const result = []
	let expect = startType === 'out' ? 'out' : 'back'
	while (backs.length || outs.length) {
		if (expect === 'back') {
			if (backs.length) result.push(backs.shift())
			else if (outs.length) result.push(outs.shift())
			expect = 'out'
			continue
		}
		if (outs.length) result.push(outs.shift())
		else if (backs.length) result.push(backs.shift())
		expect = 'back'
	}
	return [...result, ...others]
}

function shouldQueueSameDayBackOut(events, state) {
	if (!hasSameDayBackOutWithoutFill(events)) return false
	if (Array.isArray(state && state.pending_same_day_back_out) && state.pending_same_day_back_out.length > 0) return true
	if (state && state.last_back_event) return false
	if (state && state.last_out_event && state.last_out_event.type === 'out') return false
	return true
}

function buildDayBusinessOrder(events, state) {
	const sorted = [...events].sort(compareBusinessOrder)
	if (!hasSameDayBackOutWithoutFill(sorted)) return sorted
	if (shouldQueueSameDayBackOut(sorted, state)) return sorted
	if (state && state.last_back_event) {
		return interleaveSameDayBackOutEvents(sorted, 'out')
	}
	if (state && state.last_out_event && state.last_out_event.type === 'out') {
		return interleaveSameDayBackOutEvents(sorted, 'back')
	}
	return sorted
}

function buildPendingSameDayBackOutEntry(events) {
	const sorted = [...listEffectiveEvents(events)].sort(compareBusinessOrder)
	const backEvents = sorted.filter((item) => item.type === 'back')
	const outEvents = sorted.filter((item) => item.type === 'out')
	const backEvent = backEvents[backEvents.length - 1] || null
	const outEvent = outEvents[outEvents.length - 1] || null
	if (!backEvent || !outEvent) return null
	return {
		event_day: normalizeEventDay(
			outEvent.event_day || backEvent.event_day,
			Math.max(toTimestamp(outEvent.event_at, 0), toTimestamp(backEvent.event_at, 0), Date.now())
		),
		back_event: backEvent,
		out_event: outEvent,
		created_at: Math.max(toTimestamp(backEvent.created_at, 0), toTimestamp(outEvent.created_at, 0), Date.now())
	}
}

function findFirstEffectiveEvent(events) {
	return listEffectiveEvents(events)[0] || null
}

function resolvePendingSameDayBackOut(state, nextType) {
	const queue = Array.isArray(state && state.pending_same_day_back_out) ? state.pending_same_day_back_out : []
	if (!queue.length) return []
	const type = normalizeType(nextType)
	if (!type || type === 'adjust') return []
	const latest = queue[queue.length - 1] || null
	state.pending_same_day_back_out = []
	if (!latest || !latest.back_event || !latest.out_event) return []
	if (type === 'fill') {
		state.last_effective_event = latest.back_event
		state.last_out_event = null
		state.last_back_event = latest.back_event
		state.has_fill_since_last_back = false
		return []
	}
	state.last_effective_event = latest.out_event
	state.last_out_event = latest.out_event
	state.last_back_event = null
	state.has_fill_since_last_back = false
	return [buildMissingFill(latest.out_event, latest.back_event)]
}

function detectAnomaliesForEvent(event, inputState) {
	const state = {
		last_effective_event: inputState.last_effective_event,
		last_out_event: inputState.last_out_event,
		last_back_event: inputState.last_back_event,
		has_fill_since_last_back: Boolean(inputState.has_fill_since_last_back),
		pending_same_day_back_out: Array.isArray(inputState.pending_same_day_back_out)
			? [...inputState.pending_same_day_back_out]
			: []
	}
	const detected = []

	if (event.type === 'back') {
		if (state.last_back_event) {
			if (state.has_fill_since_last_back) {
				detected.push(buildMissingOut(event, state.last_back_event, state.last_effective_event))
			} else {
				detected.push(buildContinuousBack(event, state.last_back_event, false))
			}
		}
		state.last_back_event = event
		state.last_out_event = null
		state.has_fill_since_last_back = false
		state.last_effective_event = event
		return { anomalies: detected, nextState: state }
	}

	if (event.type === 'fill') {
		if (state.last_out_event && state.last_out_event.type === 'out') {
			detected.push(buildMissingBack(event, state.last_out_event))
		}
		if (state.last_effective_event && state.last_effective_event.type === 'fill') {
			detected.push(buildContinuousFill(event, state.last_effective_event, state.last_back_event))
		}
		if (state.last_back_event) state.has_fill_since_last_back = true
		state.last_out_event = null
		state.last_effective_event = event
		return { anomalies: detected, nextState: state }
	}

	if (event.type === 'out') {
		if (state.last_effective_event && state.last_effective_event.type === 'out') {
			detected.push(buildContinuousOut(event, state.last_effective_event))
		}
		if (state.last_back_event && !state.has_fill_since_last_back) {
			detected.push(buildMissingFill(event, state.last_back_event))
		}
		state.last_back_event = null
		state.has_fill_since_last_back = false
		state.last_out_event = event
		state.last_effective_event = event
		return { anomalies: detected, nextState: state }
	}

	// adjust is a neutral event in anomaly scan state machine.
	return { anomalies: detected, nextState: state }
}

function normalizePendingAnomalyQueue(value, bottleNo) {
	if (!Array.isArray(value)) return []
	const list = []
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue
		const type = normalizeString(item.type)
		if (!type) continue
		list.push({
			type,
			bottle_no: normalizeBottleNo(item.bottle_no || bottleNo),
			date: normalizeString(item.date),
			detail: normalizeString(item.detail),
			context: normalizeContext(item.context),
			resolved: false,
			ignored: false,
			created_at: toTimestamp(item.created_at, Date.now())
		})
	}
	return list
}

function ensureTypeSet(map, type) {
	if (!map.has(type)) map.set(type, new Set())
	return map.get(type)
}

function buildOpenFingerprintMap(rows) {
	const map = new Map()
	for (const row of rows) {
		const type = normalizeString(row.anomaly_type)
		if (!type) continue
		const fp = getComparableAnomalyFingerprint(row)
		if (!fp) continue
		ensureTypeSet(map, type).add(fp)
	}
	return map
}

function buildOpenFingerprintRowMap(rows) {
	const map = new Map()
	for (const row of rows || []) {
		const type = normalizeString(row && row.anomaly_type)
		if (!type) continue
		const fp = getComparableAnomalyFingerprint(row)
		if (!fp) continue
		if (!map.has(type)) map.set(type, new Map())
		const typeMap = map.get(type)
		if (!typeMap.has(fp)) {
			typeMap.set(fp, row)
			continue
		}
		typeMap.set(fp, selectPreferredAnomaly(typeMap.get(fp), row))
	}
	return map
}

function buildResolvedMissingFillFingerprintSet(rows) {
	const set = new Set()
	for (const row of rows || []) {
		if (!hasMissingFillLossResolution(row)) continue
		const fp = getComparableAnomalyFingerprint(row)
		if (!fp) continue
		set.add(fp)
	}
	return set
}

function round3(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Math.round(num * 1000) / 1000
}

function buildMissingFillManualFixIdentity(row) {
	const sourceId = normalizeString(row && row.source_id)
	if (sourceId) return `source:${sourceId}`
	const bottleNo = normalizeBottleNo(row && row.bottle_no)
	const eventDay = normalizeEventDay(row && (row.event_day || row.date), toTimestamp(row && (row.event_at || row.created_at), Date.now()))
	const adjustReason = normalizeString(row && row.adjust_reason).toLowerCase()
	const note = normalizeString(row && row.note)
	const lossWeight = toNumber(row && row.loss_weight, null)
	const lossKey = lossWeight == null ? '' : String(round3(lossWeight))
	return `legacy:${bottleNo}|${eventDay}|${adjustReason}|${lossKey}|${note}`
}

async function ensureMissingFillManualFix(movementDoc) {
	const bottleNo = normalizeBottleNo(movementDoc && movementDoc.bottle_no)
	const eventDay = normalizeEventDay(
		movementDoc && (movementDoc.event_day || movementDoc.date),
		toTimestamp(movementDoc && (movementDoc.event_at || movementDoc.created_at), Date.now())
	)
	const adjustReason = normalizeString(movementDoc && movementDoc.adjust_reason)
	if (bottleNo && eventDay && adjustReason) {
		const res = await movements
			.where({
				bottle_no: bottleNo,
				type: 'adjust',
				source_type: 'manual_fix',
				adjust_reason: adjustReason,
				event_day: eventDay
			})
			.limit(200)
			.get()
		const targetIdentity = buildMissingFillManualFixIdentity(movementDoc)
		const matched = (res.data || []).find((row) => buildMissingFillManualFixIdentity(row) === targetIdentity) || null
		if (matched) {
			return { created: false, row: matched }
		}
	}
	await movements.add(movementDoc)
	return { created: true, row: movementDoc }
}

async function resolveOpenAnomaliesByFingerprint(anomaly, updateDoc) {
	const bottleNo = normalizeBottleNo(anomaly && anomaly.bottle_no)
	const anomalyType = normalizeAnomalyType(anomaly && anomaly.anomaly_type)
	const targetFingerprint = getComparableAnomalyFingerprint(anomaly)
	const fallbackId = normalizeString(anomaly && anomaly._id)
	const targetIds = []

	if (bottleNo && anomalyType && targetFingerprint) {
		const openRes = await anomalies.where({ bottle_no: bottleNo, anomaly_type: anomalyType, status: 'open' }).limit(5000).get()
		for (const row of openRes.data || []) {
			const rowFingerprint = getComparableAnomalyFingerprint(row)
			if (rowFingerprint !== targetFingerprint) continue
			const rowId = normalizeString(row && row._id)
			if (!rowId || targetIds.includes(rowId)) continue
			targetIds.push(rowId)
		}
	}

	if (!targetIds.length && fallbackId) {
		targetIds.push(fallbackId)
	}

	for (const id of targetIds) {
		await anomalies.doc(id).update(updateDoc)
	}

	return {
		resolvedCount: targetIds.length,
		fingerprint: targetFingerprint
	}
}

function parseScanCursor(raw, bottleNo) {
	let cursor = raw
	if (typeof cursor === 'string') {
		try {
			cursor = JSON.parse(cursor)
		} catch (err) {
			cursor = null
		}
	}
	if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
		return {
			dbCursor: null,
			analyzerState: normalizeAnalyzerState(null, bottleNo),
			dayBuffer: [],
			pendingAnomalies: [],
			scanDone: false,
			scanStartedAt: 0,
			detectedFpsByType: buildEmptyDetectedFpsByType()
		}
	}

	const dbCursor = cursor.db_cursor && typeof cursor.db_cursor === 'object'
		? {
			event_at: toTimestamp(cursor.db_cursor.event_at, 0),
			type_order: toNumber(cursor.db_cursor.type_order, 0) || 0,
			created_at: toTimestamp(cursor.db_cursor.created_at, 0)
		}
		: null

	const dayBuffer = Array.isArray(cursor.day_buffer)
		? cursor.day_buffer
			.map((item) => normalizeStateEvent(item, bottleNo))
			.filter(Boolean)
		: []

	const detectedFpsByType = buildEmptyDetectedFpsByType()
	const cursorDetected = cursor.detected_fps_by_type
	if (cursorDetected && typeof cursorDetected === 'object' && !Array.isArray(cursorDetected)) {
		for (const type of RECONCILE_TYPE_LIST) {
			const list = Array.isArray(cursorDetected[type]) ? cursorDetected[type] : []
			detectedFpsByType[type] = list.map((item) => normalizeString(item)).filter(Boolean)
		}
	}
	if (!detectedFpsByType.missing_back.length && Array.isArray(cursor.detected_missing_back_fps)) {
		detectedFpsByType.missing_back = cursor.detected_missing_back_fps.map((item) => normalizeString(item)).filter(Boolean)
	}

	return {
		dbCursor,
		analyzerState: normalizeAnalyzerState(cursor.analyzer_state, bottleNo),
		dayBuffer,
		pendingAnomalies: normalizePendingAnomalyQueue(cursor.pending_anomalies, bottleNo),
		scanDone: toBoolean(cursor.scan_done, false),
		scanStartedAt: toTimestamp(cursor.scan_started_at, 0),
		detectedFpsByType
	}
}

function buildNextCursor(payload) {
	if (payload.done) return null
	return {
		db_cursor: payload.dbCursor,
		analyzer_state: {
			last_effective_event: payload.analyzerState.last_effective_event,
			last_out_event: payload.analyzerState.last_out_event,
			last_back_event: payload.analyzerState.last_back_event,
			has_fill_since_last_back: Boolean(payload.analyzerState.has_fill_since_last_back),
			pending_same_day_back_out: Array.isArray(payload.analyzerState.pending_same_day_back_out)
				? payload.analyzerState.pending_same_day_back_out
				: []
		},
		day_buffer: payload.dayBuffer,
		pending_anomalies: payload.pendingAnomalies,
		scan_done: Boolean(payload.scanDone),
		scan_started_at: payload.scanStartedAt,
		detected_fps_by_type: payload.detectedFpsByType,
		detected_missing_back_fps: payload.detectedFpsByType.missing_back || []
	}
}

function buildMovementWhereAfterCursor(bottleNo, dbCursor) {
	if (!dbCursor || !Number.isFinite(dbCursor.event_at) || dbCursor.event_at <= 0) {
		return { bottle_no: bottleNo }
	}
	return db.command.and(
		{ bottle_no: bottleNo },
		db.command.or([
			{ event_at: db.command.gt(dbCursor.event_at) },
			{ event_at: dbCursor.event_at, type_order: db.command.gt(dbCursor.type_order || 0) },
			{ event_at: dbCursor.event_at, type_order: dbCursor.type_order || 0, created_at: db.command.gt(dbCursor.created_at || 0) }
		])
		)
}

function normalizeTruckSaleDoc(input, truckNoFallback = '') {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const truckNo = normalizeBottleNo(input.truck_no || truckNoFallback)
	if (!truckNo) return null
	const truckSaleNet = resolveTruckSaleNetValue(input.truck_gross_diff ?? input.truck_sale_net, input.truck_out_gross, input.truck_back_gross)
	return {
		_id: normalizeString(input._id),
		truck_no: truckNo,
		date: normalizeString(input.date),
		customer_name: normalizeString(input.customer_name),
		truck_out_gross: toNumber(input.truck_out_gross, null),
		truck_back_gross: toNumber(input.truck_back_gross, null),
		truck_gross_diff: truckSaleNet,
		truck_sale_net: truckSaleNet,
		created_at: toTimestamp(input.created_at, Date.now())
	}
}

function normalizeTruckSupplementDoc(input, truckNoFallback = '') {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const truckNo = normalizeBottleNo(input.bottle_no || input.truck_no || truckNoFallback)
	if (!truckNo) return null
	return {
		_id: normalizeString(input._id),
		truck_no: truckNo,
		date: normalizeString(input.date),
		fill_weight: toNumber(input.fill_weight, null),
		created_at: toTimestamp(input.created_at, Date.now())
	}
}

function compareBizDocAsc(a, b) {
	const aDay = normalizeDay(a && a.date)
	const bDay = normalizeDay(b && b.date)
	if (aDay !== bDay) return aDay.localeCompare(bDay)
	const aCreated = toTimestamp(a && a.created_at, 0)
	const bCreated = toTimestamp(b && b.created_at, 0)
	if (aCreated !== bCreated) return aCreated - bCreated
	return normalizeString(a && a._id).localeCompare(normalizeString(b && b._id))
}

function isBizDocBetween(doc, startExclusive, endInclusive) {
	return compareBizDocAsc(doc, startExclusive) > 0 && compareBizDocAsc(doc, endInclusive) <= 0
}

function collectTruckSupplementsBetween(rows, prevSale, currentSale) {
	return (rows || []).filter((row) => isBizDocBetween(row, prevSale, currentSale))
}

function isSameTruckBizDay(left, right) {
	const leftDay = normalizeDay(left && left.date)
	const rightDay = normalizeDay(right && right.date)
	return Boolean(leftDay) && leftDay === rightDay
}

function isSameTruckSupplementWeight(row, gapKg) {
	const fillWeight = toNumber(row && row.fill_weight, null)
	if (fillWeight == null || gapKg == null) return false
	return Math.abs(round3(fillWeight - gapKg)) <= 0.001
}

function collectSameDayTruckSupplements(rows, prevSale, currentSale, gapKg) {
	const currentDay = normalizeDay(currentSale && currentSale.date)
	if (!currentDay || !isSameTruckBizDay(prevSale, currentSale)) return []
	const sameDayRows = (rows || []).filter((row) => normalizeDay(row && row.date) === currentDay)
	if (!sameDayRows.length) return []
	const exactGapRows = sameDayRows.filter((row) => isSameTruckSupplementWeight(row, gapKg))
	return exactGapRows.length ? exactGapRows : sameDayRows
}

function detectTruckAnomaliesForSales(truckNo, saleRows, supplementRows) {
	const resolvedTruckNo = normalizeBottleNo(truckNo)
	if (!resolvedTruckNo) return []
	const salesAsc = [...(saleRows || [])].sort(compareBizDocAsc)
	const supplementsAsc = [...(supplementRows || [])].sort(compareBizDocAsc)
	const detected = []
	let previousSaleWithBack = null

	for (const sale of salesAsc) {
		const outGross = toNumber(sale && sale.truck_out_gross, null)
		const backGross = toNumber(sale && sale.truck_back_gross, null)
		const saleNet = resolveTruckSaleNetValue(sale && (sale.truck_gross_diff ?? sale.truck_sale_net), sale && sale.truck_out_gross, sale && sale.truck_back_gross)
		let supplements = []
		let sameDaySupplements = []
		let supplementCandidates = []

		if (!(backGross > 0)) {
			detected.push(buildMissingTruckBackGross(sale))
		}

		if (previousSaleWithBack && outGross != null) {
			supplements = collectTruckSupplementsBetween(supplementsAsc, previousSaleWithBack, sale)
			const previousBackGross = toNumber(previousSaleWithBack && previousSaleWithBack.truck_back_gross, null)
			const gapKg = previousBackGross != null ? round3(outGross - previousBackGross) : null
			sameDaySupplements = !supplements.length
				? collectSameDayTruckSupplements(supplementsAsc, previousSaleWithBack, sale, gapKg)
				: []
			supplementCandidates = supplements.length ? supplements : sameDaySupplements
		}

		if (outGross != null && backGross != null && saleNet != null) {
			const diffKg = round3(outGross - backGross - saleNet)
			if (Math.abs(diffKg) > TRUCK_RETURN_DIFF_THRESHOLD_KG) {
				detected.push(buildTruckReturnDiffExcess(sale, diffKg, previousSaleWithBack, supplementCandidates))
			}
		}

		if (previousSaleWithBack && outGross != null) {
			const previousBackGross = toNumber(previousSaleWithBack && previousSaleWithBack.truck_back_gross, null)
			const gapKg = round3(outGross - previousBackGross)
			if (previousBackGross != null && gapKg > 0) {
				if (!supplements.length && !sameDaySupplements.length) {
					detected.push(buildMissingTruckFill(sale, previousSaleWithBack, gapKg, supplementCandidates))
				}
			}
		}

		if (backGross != null && backGross > 0) {
			previousSaleWithBack = sale
		}
	}

	return detected
}

async function fetchTruckSaleRowsByTruckNo(truckNo) {
	const resolvedTruckNo = normalizeBottleNo(truckNo)
	if (!resolvedTruckNo) return []
	const res = await sales
		.where({ biz_mode: 'truck', truck_no: resolvedTruckNo })
		.field({
			_id: true,
			date: true,
			customer_name: true,
			truck_no: true,
			truck_out_gross: true,
			truck_back_gross: true,
			truck_gross_diff: true,
			truck_sale_net: true,
			created_at: true
		})
		.orderBy('date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()
	return (res.data || [])
		.map((row) => normalizeTruckSaleDoc(row, resolvedTruckNo))
		.filter(Boolean)
}

async function resolveOpenBottleFlowAnomaliesByNo(identifier, maxWritesPerRound = 160) {
	const targetNo = normalizeBottleNo(identifier)
	if (!targetNo) return { resolved: 0, limited: false }
	const openRes = await anomalies.where({ bottle_no: targetNo, status: 'open' }).limit(5000).get()
	const openRows = Array.isArray(openRes.data) ? openRes.data : []
	let resolved = 0
	for (const row of openRows) {
		if (resolved >= maxWritesPerRound) {
			return { resolved, limited: true }
		}
		const anomalyType = normalizeAnomalyType(row && row.anomaly_type)
		if (!BOTTLE_ANOMALY_TYPE_SET.has(anomalyType)) continue
		const id = normalizeString(row && row._id)
		if (!id) continue
		await anomalies.doc(id).update({
			status: 'resolved',
			updated_at: Date.now(),
			resolved_by: null,
			resolved_by_name: 'system-reconcile'
		})
		resolved += 1
	}
	return { resolved, limited: openRows.length >= 5000 || resolved >= maxWritesPerRound }
}

async function fetchTruckSupplementRowsByTruckNo(truckNo) {
	const resolvedTruckNo = normalizeBottleNo(truckNo)
	if (!resolvedTruckNo) return []
	const res = await fillings
		.where({ bottle_no: resolvedTruckNo })
		.field({
			_id: true,
			bottle_no: true,
			date: true,
			record_type: true,
			fill_weight: true,
			created_at: true
		})
		.orderBy('date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()
	return (res.data || [])
		.filter((row) => {
			const rowBottleNo = normalizeBottleNo(row && row.bottle_no)
			if (!rowBottleNo || rowBottleNo !== resolvedTruckNo) return false
			const recordType = normalizeFillingRecordType(row && row.record_type)
			if (recordType === 'truck_out_agent_sale') return false
			if (recordType === 'truck_out_no_sale') return true
			return looksLikeTruckNo(resolvedTruckNo) && recordType === 'normal_fill'
		})
		.map((row) => normalizeTruckSupplementDoc(row, resolvedTruckNo))
		.filter(Boolean)
}

function parseRebuildCursor(raw) {
	let cursor = raw
	if (typeof cursor === 'string') {
		try {
			cursor = JSON.parse(cursor)
		} catch (err) {
			cursor = null
		}
	}
	if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
		return {
			phase: 'bottle',
			bottleAfter: '',
			currentBottleNo: '',
			currentScanCursor: null,
			truckAfter: '',
			currentTruckNo: ''
		}
	}
	return {
		phase: normalizeString(cursor.phase).toLowerCase() === 'truck' ? 'truck' : 'bottle',
		bottleAfter: normalizeBottleNo(cursor.bottle_after || cursor.bottleAfter),
		currentBottleNo: normalizeBottleNo(cursor.current_bottle_no || cursor.currentBottleNo),
		currentScanCursor: cursor.current_scan_cursor || cursor.currentScanCursor || null,
		truckAfter: normalizeBottleNo(cursor.truck_after || cursor.truckAfter),
		currentTruckNo: normalizeBottleNo(cursor.current_truck_no || cursor.currentTruckNo)
	}
}

function buildRebuildCursor(payload) {
	if (payload.done) return null
	return {
		phase: normalizeString(payload.phase).toLowerCase() === 'truck' ? 'truck' : 'bottle',
		bottle_after: normalizeBottleNo(payload.bottleAfter),
		current_bottle_no: normalizeBottleNo(payload.currentBottleNo),
		current_scan_cursor: payload.currentScanCursor || null,
		truck_after: normalizeBottleNo(payload.truckAfter),
		current_truck_no: normalizeBottleNo(payload.currentTruckNo)
	}
}

async function fetchNextBottleNo(afterBottleNo) {
	let cursor = normalizeBottleNo(afterBottleNo)
	for (let round = 0; round < 20; round += 1) {
		const where = cursor ? { bottle_no: db.command.gt(cursor) } : {}
		const res = await bottles
			.where(where)
			.field({ bottle_no: true })
			.orderBy('bottle_no', 'asc')
			.limit(50)
			.get()
		const rows = Array.isArray(res.data) ? res.data : []
		if (!rows.length) return ''
		for (const row of rows) {
			const bottleNo = normalizeBottleNo(row && row.bottle_no)
			if (!bottleNo) continue
			if (looksLikeTruckNo(bottleNo)) {
				cursor = bottleNo
				continue
			}
			return bottleNo
		}
		if (rows.length < 50) return ''
		cursor = normalizeBottleNo(rows[rows.length - 1] && rows[rows.length - 1].bottle_no)
		if (!cursor) return ''
	}
	return ''
}

async function fetchNextTruckNo(afterTruckNo) {
	const where = { biz_mode: 'truck' }
	if (afterTruckNo) where.truck_no = db.command.gt(afterTruckNo)
	const res = await sales
		.where(where)
		.field({ truck_no: true })
		.orderBy('truck_no', 'asc')
		.limit(20)
		.get()
	for (const row of res.data || []) {
		const truckNo = normalizeBottleNo(row && row.truck_no)
		if (truckNo) return truckNo
	}
	return ''
}

function normalizeAnomalyStatus(value) {
	return normalizeString(value).toLowerCase() === 'resolved' ? 'resolved' : 'open'
}

async function fetchAnomalyRowsForBreakdown(where, maxRows = 5000) {
	const pageSize = 200
	let page = 0
	let rows = []
	while (true) {
		const remaining = maxRows - rows.length
		if (remaining <= 0) {
			return { rows, limited: true }
		}
		const limit = Math.min(pageSize, remaining)
		const res = await anomalies.where(where).orderBy('created_at', 'desc').skip(page * pageSize).limit(limit).get()
		const current = Array.isArray(res.data) ? res.data : []
		rows = rows.concat(current)
		if (current.length < limit) break
		page += 1
		if (page > 200) return { rows, limited: true }
	}
	return { rows, limited: false }
}

function buildAnomalyBreakdown(rows, limited = false) {
	const dedupedRows = dedupeAnomalyRows(rows)
	const typeMap = new Map()
	const bottleMap = new Map()

	for (const row of dedupedRows) {
		const type = normalizeAnomalyType(row && row.anomaly_type) || normalizeString(row && row.anomaly_type) || 'other'
		const status = normalizeAnomalyStatus(row && row.status)
		const bottleNo = normalizeBottleNo(row && row.bottle_no) || '-'

		if (!typeMap.has(type)) {
			typeMap.set(type, { anomaly_type: type, total: 0, open: 0, resolved: 0 })
		}
		const typeTarget = typeMap.get(type)
		typeTarget.total += 1
		if (status === 'resolved') typeTarget.resolved += 1
		else typeTarget.open += 1

		if (!bottleMap.has(bottleNo)) {
			bottleMap.set(bottleNo, {
				bottle_no: bottleNo,
				total: 0,
				open: 0,
				resolved: 0,
				type_set: new Set()
			})
		}
		const bottleTarget = bottleMap.get(bottleNo)
		bottleTarget.total += 1
		if (status === 'resolved') bottleTarget.resolved += 1
		else bottleTarget.open += 1
		bottleTarget.type_set.add(type)
	}

	const byType = Array.from(typeMap.values()).sort((a, b) => {
		if (a.open !== b.open) return b.open - a.open
		if (a.total !== b.total) return b.total - a.total
		return String(a.anomaly_type).localeCompare(String(b.anomaly_type))
	})

	const topBottles = Array.from(bottleMap.values())
		.sort((a, b) => {
			if (a.open !== b.open) return b.open - a.open
			if (a.total !== b.total) return b.total - a.total
			return String(a.bottle_no).localeCompare(String(b.bottle_no))
		})
		.slice(0, 20)
		.map((item) => ({
			bottle_no: item.bottle_no,
			total: item.total,
			open: item.open,
			resolved: item.resolved,
			type_list: Array.from(item.type_set).sort()
		}))

	return {
		scanned_total: dedupedRows.length,
		limited: Boolean(limited),
		by_type: byType,
		top_bottles: topBottles
	}
}

async function listV1(user, data) {
	void user
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo)
	const anomalyType = normalizeAnomalyType(data.anomaly_type || data.anomalyType)
	const dateStart = normalizeDay(data.dateStart || data.date_start)
	const dateEnd = normalizeDay(data.dateEnd || data.date_end)
	const page = Math.max(Number(data.page || 1), 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || 20), 1), 50)
	const rawStatus = normalizeString(data.status).toLowerCase()
	const status = rawStatus === 'open' || rawStatus === 'resolved' ? rawStatus : ''
	const withBreakdown = toBoolean(data.with_breakdown ?? data.withBreakdown, false)
	const summaryIgnoreStatus = toBoolean(data.summary_ignore_status ?? data.summaryIgnoreStatus, false)
	const scopeWhere = {}
	if (bottleNo) scopeWhere.bottle_no = bottleNo
	if (anomalyType) scopeWhere.anomaly_type = anomalyType
	if (dateStart && dateEnd) {
		scopeWhere.date = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		scopeWhere.date = db.command.gte(dateStart)
	} else if (dateEnd) {
		scopeWhere.date = db.command.lte(dateEnd)
	}

	const scopeRes = await fetchAnomalyRowsForBreakdown(scopeWhere, 5000)
	const scopeRows = dedupeAnomalyRows(scopeRes.rows)
	const filteredRows = filterAnomalyRowsByStatus(scopeRows, status)
	const total = filteredRows.length
	const hasMore = page * pageSize < total
	const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
	const summaryRows = summaryIgnoreStatus || !status ? scopeRows : filteredRows
	const summaryTotal = summaryRows.length

	let openTotal = 0
	let resolvedTotal = 0
	if (summaryIgnoreStatus || !status) {
		openTotal = scopeRows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'open').length
		resolvedTotal = scopeRows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'resolved').length
	} else if (status === 'open') {
		openTotal = summaryTotal
	} else if (status === 'resolved') {
		resolvedTotal = summaryTotal
	}

	let breakdown = null
	if (withBreakdown) {
		breakdown = buildAnomalyBreakdown(filteredRows, scopeRes.limited)
	}

	return {
		code: 0,
		data: pageRows,
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore,
			limited: Boolean(scopeRes.limited)
		},
		summary: {
			total: summaryTotal,
			open: openTotal,
			resolved: resolvedTotal
		},
		breakdown
	}
}

async function typesV1() {
	return { code: 0, data: Object.values(ANOMALY_TYPES) }
}

async function scanV2(user, data, requestId) {
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo)
	if (!bottleNo) return { code: 400, msg: 'bottle_no 必填' }
	if (looksLikeTruckNo(bottleNo)) {
		const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 800, 160)
		const reconcileRes = await resolveOpenBottleFlowAnomaliesByNo(bottleNo, maxWritesPerRound)
		await recordLog(
			user,
			'bottle_anomaly_scan_v2_skip_truck',
			{
				bottle_no: bottleNo,
				round_created: 0,
				round_resolved_stale: reconcileRes.resolved,
				round_scanned_events: 0
			},
			requestId
		)
		return {
			code: 0,
			data: {
				done: !reconcileRes.limited,
				cursor: null,
				round_created: 0,
				round_resolved_stale: reconcileRes.resolved,
				round_scanned_events: 0
			}
		}
	}

	const batchSize = clampNumber(data.batch_size, 20, 500, 200)
	const maxEventsPerRound = clampNumber(data.max_events_per_round, 50, 4000, 900)
	const maxMsPerRound = clampNumber(data.max_ms_per_round, 400, 8000, 3200)
	const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 800, 160)
	const legacyReconcileMissingBack = toBoolean(data.reconcile_missing_back, false)
	const explicitReconcileTypes = normalizeReconcileTypes(data.reconcile_types)
	const hasExplicitReconcileAnomalies =
		data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'reconcile_anomalies')
	const reconcileAnomalies = hasExplicitReconcileAnomalies
		? toBoolean(data.reconcile_anomalies, false)
		: explicitReconcileTypes.length > 0 || legacyReconcileMissingBack
	let reconcileTypes = []
	if (explicitReconcileTypes.length > 0) {
		reconcileTypes = explicitReconcileTypes.filter((type) => BOTTLE_ANOMALY_TYPE_SET.has(type))
	} else if (legacyReconcileMissingBack && !hasExplicitReconcileAnomalies) {
		reconcileTypes = ['missing_back']
	} else if (reconcileAnomalies) {
		reconcileTypes = [...BOTTLE_RECONCILE_TYPE_LIST]
	}
	const reconcileTypeSet = new Set(reconcileTypes)
	const shouldReconcile = reconcileAnomalies && reconcileTypes.length > 0

	const cursorState = parseScanCursor(data.cursor, bottleNo)
	let dbCursor = cursorState.dbCursor
	let analyzerState = cursorState.analyzerState
	let dayBuffer = cursorState.dayBuffer
	let pendingAnomalies = cursorState.pendingAnomalies
	let scanDone = cursorState.scanDone
	let scanStartedAt = cursorState.scanStartedAt
	if (shouldReconcile && !scanStartedAt) scanStartedAt = Date.now()
	if (!shouldReconcile) scanStartedAt = 0
	const detectedFpsByTypeSet = toDetectedFpsSetMap(shouldReconcile ? cursorState.detectedFpsByType : buildEmptyDetectedFpsByType())

	let roundCreated = 0
	let roundResolvedStale = 0
	let roundScannedEvents = 0
	let writeCount = 0
	let stopByWriteLimit = false
	const startedAt = Date.now()

	const isTimeExceeded = () => Date.now() - startedAt >= maxMsPerRound
	const isEventExceeded = () => roundScannedEvents >= maxEventsPerRound
	const isWriteExceeded = () => writeCount >= maxWritesPerRound

	const openRes = await anomalies.where({ bottle_no: bottleNo, status: 'open' }).limit(5000).get()
	const openRows = openRes.data || []
	const openFingerprintMap = buildOpenFingerprintMap(openRows)
	const openFingerprintRowMap = buildOpenFingerprintRowMap(openRows)
	const resolvedMissingFillRes = await anomalies
		.where({ bottle_no: bottleNo, anomaly_type: 'missing_fill', status: 'resolved' })
		.limit(5000)
		.get()
	const resolvedMissingFillFingerprintSet = buildResolvedMissingFillFingerprintSet(resolvedMissingFillRes.data || [])

	const persistAnomaly = async (anomaly) => {
		const type = normalizeString(anomaly.type)
		if (!type) return { limited: false }
		const fingerprint = buildAnomalyFingerprint(anomaly)
		if (!fingerprint) return { limited: false }
		if (shouldReconcile && reconcileTypeSet.has(type)) {
			ensureTypeSet(detectedFpsByTypeSet, type).add(fingerprint)
		}
		if (type === 'missing_fill' && resolvedMissingFillFingerprintSet.has(fingerprint)) {
			return { limited: false }
		}
		const typeSet = ensureTypeSet(openFingerprintMap, type)
		if (typeSet.has(fingerprint)) {
			const matchedRow = openFingerprintRowMap.get(type)?.get(fingerprint) || null
			const matchedId = normalizeString(matchedRow && matchedRow._id)
			if (!matchedId) return { limited: false }
			const nextDate = normalizeString(anomaly.date)
			const nextNote = normalizeString(anomaly.detail)
			const nextContext = normalizeContext(anomaly.context)
			const changed =
				normalizeString(matchedRow && matchedRow.date) !== nextDate ||
				normalizeString(matchedRow && matchedRow.note) !== nextNote ||
				JSON.stringify(normalizeContext(matchedRow && matchedRow.context)) !== JSON.stringify(nextContext)
			if (!changed) return { limited: false }
			if (isWriteExceeded()) return { limited: true }
			await anomalies.doc(matchedId).update({
				date: nextDate,
				note: nextNote,
				context: nextContext,
				updated_at: Date.now()
			})
			writeCount += 1
			return { limited: false }
		}
		if (isWriteExceeded()) return { limited: true }

		const now = Date.now()
		await anomalies.add({
			bottle_no: bottleNo,
			anomaly_type: type,
			date: normalizeString(anomaly.date),
			fingerprint,
			status: 'open',
			note: normalizeString(anomaly.detail),
			context: normalizeContext(anomaly.context),
			resolved_by: null,
			resolved_by_name: '',
			created_at: now,
			updated_at: now
		})
		writeCount += 1
		roundCreated += 1
		typeSet.add(fingerprint)
		return { limited: false }
	}

	const flushDayBuffer = async () => {
		if (!dayBuffer.length) return
		const sorted = buildDayBusinessOrder(dayBuffer, analyzerState)
		dayBuffer = []
		if (shouldQueueSameDayBackOut(sorted, analyzerState)) {
			const pendingEntry = buildPendingSameDayBackOutEntry(sorted)
			if (pendingEntry) {
				const queue = Array.isArray(analyzerState.pending_same_day_back_out)
					? [...analyzerState.pending_same_day_back_out]
					: []
				queue.push(pendingEntry)
				analyzerState.pending_same_day_back_out = queue
			}
			return
		}
		const firstEffectiveEvent = findFirstEffectiveEvent(sorted)
		if (firstEffectiveEvent) {
			const pendingDetected = resolvePendingSameDayBackOut(analyzerState, firstEffectiveEvent.type)
			for (let j = 0; j < pendingDetected.length; j += 1) {
				const anomaly = pendingDetected[j]
				const saveResult = await persistAnomaly(anomaly)
				if (saveResult.limited) {
					pendingAnomalies.push(anomaly)
					pendingAnomalies.push(...pendingDetected.slice(j + 1))
					dayBuffer = sorted
					stopByWriteLimit = true
					return
				}
				if (isTimeExceeded()) {
					dayBuffer = sorted
					return
				}
			}
		}
		for (let i = 0; i < sorted.length; i += 1) {
			if (isTimeExceeded()) {
				dayBuffer = sorted.slice(i)
				return
			}
			const event = sorted[i]
			const { anomalies: detected, nextState } = detectAnomaliesForEvent(event, analyzerState)
			analyzerState = nextState
			for (let j = 0; j < detected.length; j += 1) {
				const anomaly = detected[j]
				const saveResult = await persistAnomaly(anomaly)
				if (saveResult.limited) {
					pendingAnomalies.push(anomaly)
					pendingAnomalies.push(...detected.slice(j + 1))
					dayBuffer = sorted.slice(i + 1)
					stopByWriteLimit = true
					return
				}
			}
		}
	}

	while (pendingAnomalies.length > 0 && !stopByWriteLimit && !isTimeExceeded()) {
		const anomaly = pendingAnomalies[0]
		const saveResult = await persistAnomaly(anomaly)
		if (saveResult.limited) {
			stopByWriteLimit = true
			break
		}
		pendingAnomalies.shift()
	}

	if (!scanDone && !stopByWriteLimit && !isTimeExceeded()) {
		while (!scanDone && !stopByWriteLimit && !isTimeExceeded() && !isEventExceeded()) {
			const queryLimit = Math.min(batchSize, Math.max(maxEventsPerRound - roundScannedEvents, 1))
			const where = buildMovementWhereAfterCursor(bottleNo, dbCursor)
			const res = await movements
				.where(where)
				.orderBy('event_at', 'asc')
				.orderBy('type_order', 'asc')
				.orderBy('created_at', 'asc')
				.limit(queryLimit)
				.get()
			const rows = res.data || []
			if (!rows.length) {
				scanDone = true
				break
			}

			for (const row of rows) {
				if (isTimeExceeded() || isEventExceeded() || stopByWriteLimit) break
				const event = buildMovementEvent(row, bottleNo)
				roundScannedEvents += 1

				if (!dayBuffer.length) {
					dayBuffer.push(event)
				} else {
					const currentDay = dayBuffer[0].event_day
					if (event.event_day === currentDay) {
						dayBuffer.push(event)
					} else {
						await flushDayBuffer()
						if (stopByWriteLimit || isTimeExceeded()) {
							roundScannedEvents -= 1
							break
						}
						dayBuffer.push(event)
					}
				}

				dbCursor = {
					event_at: toTimestamp(row.event_at, event.event_at),
					type_order: toNumber(row.type_order, movementTypeOrder(event.type)) || 0,
					created_at: toTimestamp(row.created_at, event.created_at)
				}
			}

			if (!stopByWriteLimit && !isTimeExceeded() && rows.length < queryLimit) {
				scanDone = true
				break
			}
		}
	}

	if (scanDone && !stopByWriteLimit && !isTimeExceeded()) {
		await flushDayBuffer()
	}

	if (scanDone && !stopByWriteLimit && !isTimeExceeded() && pendingAnomalies.length === 0 && dayBuffer.length === 0) {
		if (shouldReconcile) {
			for (const anomalyType of reconcileTypes) {
				if (isTimeExceeded() || isWriteExceeded()) {
					scanDone = false
					break
				}
				const detectedSet = ensureTypeSet(detectedFpsByTypeSet, anomalyType)
				const openResByType = await anomalies
					.where({ bottle_no: bottleNo, anomaly_type: anomalyType, status: 'open' })
					.orderBy('created_at', 'asc')
					.limit(5000)
					.get()
				const openRowsByType = openResByType.data || []
				for (const row of openRowsByType) {
					if (isTimeExceeded() || isWriteExceeded()) {
						scanDone = false
						break
					}
					const fp = getComparableAnomalyFingerprint(row)
					if (!fp || detectedSet.has(fp)) continue
					const id = normalizeString(row._id)
					if (!id) continue
					await anomalies.doc(id).update({
						status: 'resolved',
						updated_at: Date.now(),
						resolved_by: null,
						resolved_by_name: 'system-reconcile'
					})
					writeCount += 1
					roundResolvedStale += 1
				}
				if (openRowsByType.length >= 5000) {
					scanDone = false
				}
				if (!isTimeExceeded() && !isWriteExceeded()) {
					const verifyRes = await anomalies
						.where({ bottle_no: bottleNo, anomaly_type: anomalyType, status: 'open' })
						.limit(5000)
						.get()
					const verifyRows = verifyRes.data || []
					const staleRemaining = verifyRows.some((row) => {
						const fp = getComparableAnomalyFingerprint(row)
						if (!fp) return false
						return !detectedSet.has(fp)
					})
					if (staleRemaining) scanDone = false
					if (verifyRows.length >= 5000) scanDone = false
				} else {
					scanDone = false
				}
			}
		}
	}

	if (isTimeExceeded()) scanDone = false
	if (stopByWriteLimit) scanDone = false
	if (pendingAnomalies.length > 0 || dayBuffer.length > 0) scanDone = false

	const done = Boolean(scanDone)
	const cursor = buildNextCursor({
		done,
		dbCursor,
		analyzerState,
		dayBuffer,
		pendingAnomalies,
		scanDone,
		scanStartedAt,
		detectedFpsByType: fromDetectedFpsSetMap(detectedFpsByTypeSet)
	})

	await recordLog(
		user,
		'bottle_anomaly_scan_v2',
		{
			bottle_no: bottleNo,
			done,
			has_cursor: Boolean(cursor),
			reconcile_anomalies: shouldReconcile,
			reconcile_types: reconcileTypes,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale
		},
		requestId
	)

	return {
		code: 0,
		data: {
			done,
			cursor,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			round_scanned_events: roundScannedEvents
		}
	}
}

async function scanTruckAnomaliesV1(user, data, requestId) {
	const truckNo = normalizeBottleNo(data.truck_no || data.truckNo)
	if (!truckNo) return { code: 400, msg: 'truck_no 必填' }

	const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 800, 160)
	const explicitReconcileTypes = normalizeReconcileTypes(data.reconcile_types)
	const hasExplicitReconcileAnomalies =
		data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'reconcile_anomalies')
	const reconcileAnomalies = hasExplicitReconcileAnomalies
		? toBoolean(data.reconcile_anomalies, false)
		: explicitReconcileTypes.length > 0
	let reconcileTypes = []
	if (explicitReconcileTypes.length > 0) {
		reconcileTypes = explicitReconcileTypes.filter((type) => TRUCK_ANOMALY_TYPE_SET.has(type))
	} else if (reconcileAnomalies) {
		reconcileTypes = [...TRUCK_RECONCILE_TYPE_LIST]
	}
	const reconcileTypeSet = new Set(reconcileTypes)
	const shouldReconcile = reconcileAnomalies && reconcileTypes.length > 0

	const openRes = await anomalies.where({ bottle_no: truckNo, status: 'open' }).limit(5000).get()
	const openRows = openRes.data || []
	const openFingerprintMap = buildOpenFingerprintMap(openRows)
	const openFingerprintRowMap = buildOpenFingerprintRowMap(openRows)
	const detectedFpsByTypeSet = toDetectedFpsSetMap(buildEmptyDetectedFpsByType())
	const saleRows = await fetchTruckSaleRowsByTruckNo(truckNo)
	const supplementRows = await fetchTruckSupplementRowsByTruckNo(truckNo)
	const detected = detectTruckAnomaliesForSales(truckNo, saleRows, supplementRows)

	let roundCreated = 0
	let roundResolvedStale = 0
	let roundScannedEvents = saleRows.length + supplementRows.length
	let writeCount = 0

	const persistAnomaly = async (anomaly) => {
		const type = normalizeString(anomaly && anomaly.type)
		if (!type) return false
		const fingerprint = buildAnomalyFingerprint(anomaly)
		if (!fingerprint) return false
		if (shouldReconcile && reconcileTypeSet.has(type)) {
			ensureTypeSet(detectedFpsByTypeSet, type).add(fingerprint)
		}
		const typeSet = ensureTypeSet(openFingerprintMap, type)
		if (typeSet.has(fingerprint)) {
			const matchedRow = openFingerprintRowMap.get(type)?.get(fingerprint) || null
			const matchedId = normalizeString(matchedRow && matchedRow._id)
			if (!matchedId) return false
			const nextDate = normalizeString(anomaly.date)
			const nextNote = normalizeString(anomaly.detail)
			const nextContext = normalizeContext(anomaly.context)
			const changed =
				normalizeString(matchedRow && matchedRow.date) !== nextDate ||
				normalizeString(matchedRow && matchedRow.note) !== nextNote ||
				JSON.stringify(normalizeContext(matchedRow && matchedRow.context)) !== JSON.stringify(nextContext)
			if (!changed) return false
			if (writeCount >= maxWritesPerRound) return false
			await anomalies.doc(matchedId).update({
				date: nextDate,
				note: nextNote,
				context: nextContext,
				updated_at: Date.now()
			})
			writeCount += 1
			return true
		}
		if (writeCount >= maxWritesPerRound) return false
		const now = Date.now()
		await anomalies.add({
			bottle_no: truckNo,
			anomaly_type: type,
			date: normalizeString(anomaly.date),
			fingerprint,
			status: 'open',
			note: normalizeString(anomaly.detail),
			context: normalizeContext(anomaly.context),
			resolved_by: null,
			resolved_by_name: '',
			created_at: now,
			updated_at: now
		})
		typeSet.add(fingerprint)
		writeCount += 1
		roundCreated += 1
		return true
	}

	for (const anomaly of detected) {
		await persistAnomaly(anomaly)
	}

	if (shouldReconcile) {
		for (const anomalyType of reconcileTypes) {
			const detectedSet = ensureTypeSet(detectedFpsByTypeSet, anomalyType)
			const typeRows = openRows.filter((row) => normalizeAnomalyType(row && row.anomaly_type) === anomalyType)
			for (const row of typeRows) {
				if (writeCount >= maxWritesPerRound) break
				const fp = getComparableAnomalyFingerprint(row)
				if (!fp || detectedSet.has(fp)) continue
				const id = normalizeString(row && row._id)
				if (!id) continue
				await anomalies.doc(id).update({
					status: 'resolved',
					updated_at: Date.now(),
					resolved_by: null,
					resolved_by_name: 'system-reconcile'
				})
				writeCount += 1
				roundResolvedStale += 1
			}
		}
	}

	const bottleFlowRows = openRows.filter((row) => BOTTLE_ANOMALY_TYPE_SET.has(normalizeAnomalyType(row && row.anomaly_type)))
	for (const row of bottleFlowRows) {
		if (writeCount >= maxWritesPerRound) break
		const id = normalizeString(row && row._id)
		if (!id) continue
		await anomalies.doc(id).update({
			status: 'resolved',
			updated_at: Date.now(),
			resolved_by: null,
			resolved_by_name: 'system-reconcile'
		})
		writeCount += 1
		roundResolvedStale += 1
	}

	await recordLog(
		user,
		'bottle_anomaly_scan_truck_v1',
		{
			truck_no: truckNo,
			reconcile_anomalies: shouldReconcile,
			reconcile_types: reconcileTypes,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale
		},
		requestId
	)

	return {
		code: 0,
		data: {
			done: true,
			cursor: null,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			round_scanned_events: roundScannedEvents
		}
	}
}

async function rebuildV2(user, data, requestId) {
	if (!REBUILD_SCAN_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅超级管理员可操作' }
	}

	const batchBottlesPerRound = clampNumber(data.batch_bottles_per_round, 1, 200, 20)
	const maxMsPerRound = clampNumber(data.max_ms_per_round, 400, 8000, 2400)
	const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 1200, 180)
	const maxEventsPerRound = clampNumber(data.max_events_per_round, 50, 4000, 900)
	const batchSize = clampNumber(data.batch_size, 20, 500, 200)
	const rebuildCursor = parseRebuildCursor(data.cursor)

	let phase = rebuildCursor.phase
	let bottleAfter = rebuildCursor.bottleAfter
	let currentBottleNo = rebuildCursor.currentBottleNo
	let currentScanCursor = rebuildCursor.currentScanCursor
	let truckAfter = rebuildCursor.truckAfter
	let currentTruckNo = rebuildCursor.currentTruckNo
	let roundBottles = 0
	let roundTrucks = 0
	let roundScannedEvents = 0
	let roundCreated = 0
	let roundResolvedStale = 0
	let done = false

	const startedAt = Date.now()
	const isTimeExceeded = () => Date.now() - startedAt >= maxMsPerRound

	while (!isTimeExceeded() && roundBottles + roundTrucks < batchBottlesPerRound) {
		if (phase === 'bottle') {
			if (!currentBottleNo) {
				const nextBottleNo = await fetchNextBottleNo(bottleAfter)
				if (!nextBottleNo) {
					phase = 'truck'
					continue
				}
				currentBottleNo = nextBottleNo
				currentScanCursor = null
			}

			const remainingMs = Math.max(maxMsPerRound - (Date.now() - startedAt), 400)
			const roundRes = await scanV2(
				user,
				{
					bottle_no: currentBottleNo,
					cursor: currentScanCursor,
					reconcile_anomalies: true,
					reconcile_types: BOTTLE_RECONCILE_TYPE_LIST,
					batch_size: batchSize,
					max_events_per_round: maxEventsPerRound,
					max_ms_per_round: remainingMs,
					max_writes_per_round: maxWritesPerRound
				},
				requestId
			)
			if (roundRes?.code !== 0) return roundRes

			const payload = roundRes.data || {}
			roundScannedEvents += Number(payload.round_scanned_events || 0)
			roundCreated += Number(payload.round_created || 0)
			roundResolvedStale += Number(payload.round_resolved_stale || 0)
			roundBottles += 1

			if (payload.done) {
				bottleAfter = currentBottleNo
				currentBottleNo = ''
				currentScanCursor = null
				if (roundCreated + roundResolvedStale >= maxWritesPerRound) break
				continue
			}

			currentScanCursor = payload.cursor || null
			break
		}

		if (!currentTruckNo) {
			const nextTruckNo = await fetchNextTruckNo(truckAfter)
			if (!nextTruckNo) {
				done = true
				break
			}
			currentTruckNo = nextTruckNo
		}

		const roundRes = await scanTruckAnomaliesV1(
			user,
			{
				truck_no: currentTruckNo,
				reconcile_anomalies: true,
				reconcile_types: TRUCK_RECONCILE_TYPE_LIST,
				max_writes_per_round: maxWritesPerRound
			},
			requestId
		)
		if (roundRes?.code !== 0) return roundRes
		const payload = roundRes.data || {}
		roundScannedEvents += Number(payload.round_scanned_events || 0)
		roundCreated += Number(payload.round_created || 0)
		roundResolvedStale += Number(payload.round_resolved_stale || 0)
		roundTrucks += 1
		truckAfter = currentTruckNo
		currentTruckNo = ''
		if (roundCreated + roundResolvedStale >= maxWritesPerRound) break
	}

	if (currentBottleNo || currentTruckNo) done = false
	if (isTimeExceeded()) done = false

	const cursor = buildRebuildCursor({
		done,
		phase,
		bottleAfter,
		currentBottleNo,
		currentScanCursor,
		truckAfter,
		currentTruckNo
	})
	const elapsedMs = Date.now() - startedAt

	await recordLog(
		user,
		'bottle_anomaly_rebuild_v2',
		{
			done,
			has_cursor: Boolean(cursor),
			phase,
			bottle_after: bottleAfter,
			current_bottle_no: currentBottleNo,
			has_current_scan_cursor: Boolean(currentScanCursor),
			truck_after: truckAfter,
			current_truck_no: currentTruckNo,
			round_bottles: roundBottles,
			round_trucks: roundTrucks,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			elapsed_ms: elapsedMs
		},
		requestId
	)

	return {
		code: 0,
		data: {
			done,
			cursor,
			round_bottles: roundBottles,
			round_trucks: roundTrucks,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			elapsed_ms: elapsedMs
		}
	}
}

async function purgeV1(user, data, requestId) {
	if (!REBUILD_SCAN_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅超级管理员可操作' }
	}

	const execute = toBoolean(data && data.execute, false)
	const beforeOpenRes = await anomalies.where({ status: 'open' }).count()
	const beforeResolvedRes = await anomalies.where({ status: 'resolved' }).count()
	const beforeOpen = Number(beforeOpenRes.total || 0)
	const beforeResolved = Number(beforeResolvedRes.total || 0)
	const beforeTotal = beforeOpen + beforeResolved

	if (!execute) {
		return {
			code: 0,
			msg: '预览成功',
			data: {
				execute: false,
				before: {
					total: beforeTotal,
					open: beforeOpen,
					resolved: beforeResolved
				}
			}
		}
	}

	const confirmText = normalizeString(data && (data.confirm_text || data.confirmText))
	if (confirmText !== 'CLEAR_ALL_BOTTLE_ANOMALIES') {
		return { code: 400, msg: '缺少确认口令，拒绝清空' }
	}

	const removeRes = await anomalies.where({}).remove()
	const removed = Number(removeRes?.deleted || removeRes?.deletedCount || 0)

	const afterOpenRes = await anomalies.where({ status: 'open' }).count()
	const afterResolvedRes = await anomalies.where({ status: 'resolved' }).count()
	const afterOpen = Number(afterOpenRes.total || 0)
	const afterResolved = Number(afterResolvedRes.total || 0)
	const afterTotal = afterOpen + afterResolved

	await recordLog(
		user,
		'bottle_anomaly_purge_v1',
		{
			before_total: beforeTotal,
			before_open: beforeOpen,
			before_resolved: beforeResolved,
			removed,
			after_total: afterTotal,
			after_open: afterOpen,
			after_resolved: afterResolved
		},
		requestId
	)

	return {
		code: 0,
		msg: '清空完成',
		data: {
			execute: true,
			removed,
			before: {
				total: beforeTotal,
				open: beforeOpen,
				resolved: beforeResolved
			},
			after: {
				total: afterTotal,
				open: afterOpen,
				resolved: afterResolved
			}
		}
	}
}

async function touchV2(user, data, requestId) {
	const rawBottleNos = normalizeBottleNoList(data.bottle_nos || data.bottleNos, 200)
	const bottleNos = rawBottleNos.filter((item) => !looksLikeTruckNo(item))
	const truckNos = Array.from(
		new Set([
			...normalizeBottleNoList(data.truck_nos || data.truckNos, 200),
			...rawBottleNos.filter((item) => looksLikeTruckNo(item))
		])
	)
	if (!bottleNos.length && !truckNos.length) return { code: 400, msg: 'bottle_nos 或 truck_nos 必填' }

	const batchSize = clampNumber(data.batch_size, 20, 500, 120)
	const maxEventsPerRound = clampNumber(data.max_events_per_round, 50, 4000, 800)
	const maxMsPerRound = clampNumber(data.max_ms_per_round, 400, 8000, 2200)
	const maxWritesPerRound = clampNumber(data.max_writes_per_round, 10, 800, 120)

	const startedAt = Date.now()
	const isTimeExceeded = () => Date.now() - startedAt >= maxMsPerRound

	let scannedBottles = 0
	let scannedTrucks = 0
	let roundScannedEvents = 0
	let roundCreated = 0
	let roundResolvedStale = 0
	let done = true

	for (const bottleNo of bottleNos) {
		if (isTimeExceeded()) {
			done = false
			break
		}
		const remainingMs = Math.max(maxMsPerRound - (Date.now() - startedAt), 400)
		const res = await scanV2(
			user,
			{
				bottle_no: bottleNo,
				reconcile_anomalies: true,
				reconcile_types: BOTTLE_RECONCILE_TYPE_LIST,
				batch_size: batchSize,
				max_events_per_round: maxEventsPerRound,
				max_ms_per_round: remainingMs,
				max_writes_per_round: maxWritesPerRound
			},
			requestId
		)
		if (res?.code !== 0) return res
		const payload = res.data || {}
		scannedBottles += 1
		roundScannedEvents += Number(payload.round_scanned_events || 0)
		roundCreated += Number(payload.round_created || 0)
		roundResolvedStale += Number(payload.round_resolved_stale || 0)
		if (!payload.done) done = false
	}

	for (const truckNo of truckNos) {
		if (isTimeExceeded()) {
			done = false
			break
		}
		const res = await scanTruckAnomaliesV1(
			user,
			{
				truck_no: truckNo,
				reconcile_anomalies: true,
				reconcile_types: TRUCK_RECONCILE_TYPE_LIST,
				max_writes_per_round: maxWritesPerRound
			},
			requestId
		)
		if (res?.code !== 0) return res
		const payload = res.data || {}
		scannedTrucks += 1
		roundScannedEvents += Number(payload.round_scanned_events || 0)
		roundCreated += Number(payload.round_created || 0)
		roundResolvedStale += Number(payload.round_resolved_stale || 0)
		if (!payload.done) done = false
	}

	if (scannedBottles < bottleNos.length || scannedTrucks < truckNos.length) done = false

	await recordLog(
		user,
		'bottle_anomaly_touch_v2',
		{
			done,
			input_bottles: bottleNos.length,
			input_trucks: truckNos.length,
			scanned_bottles: scannedBottles,
			scanned_trucks: scannedTrucks,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale
		},
		requestId
	)

	return {
		code: 0,
		data: {
			scanned_bottles: scannedBottles,
			scanned_trucks: scannedTrucks,
			round_scanned_events: roundScannedEvents,
			round_created: roundCreated,
			round_resolved_stale: roundResolvedStale,
			done
		}
	}
}

async function cleanupDuplicatesV1(user, data, requestId) {
	if (!REBUILD_SCAN_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅超级管理员可操作' }
	}

	const execute = toBoolean(data && data.execute, false)
	const maxRows = clampNumber(data && (data.max_rows || data.maxRows), 1000, 50000, 20000)
	const bottleNo = normalizeBottleNo(data && (data.bottle_no || data.bottleNo))
	const anomalyType = normalizeAnomalyType(data && (data.anomaly_type || data.anomalyType))
	const rawStatus = normalizeString(data && data.status).toLowerCase()
	const status = rawStatus === 'open' || rawStatus === 'resolved' ? rawStatus : ''
	const where = {}
	if (bottleNo) where.bottle_no = bottleNo
	if (anomalyType) where.anomaly_type = anomalyType
	if (status) where.status = status

	const fetchRes = await fetchAnomalyRowsForBreakdown(where, maxRows)
	const plan = buildDuplicateCleanupPlan(fetchRes.rows, fetchRes.limited)
	const keepOpen = plan.keep_rows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'open').length
	const keepResolved = plan.keep_rows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'resolved').length
	const deleteOpen = plan.delete_rows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'open').length
	const deleteResolved = plan.delete_rows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'resolved').length

	const summary = {
		scope: {
			bottle_no: bottleNo,
			anomaly_type: anomalyType,
			status
		},
		limited: Boolean(plan.limited),
		max_rows: maxRows,
		total_rows: plan.total_rows,
		unique_rows: plan.unique_rows,
		duplicate_groups: plan.duplicate_groups,
		duplicate_rows: plan.duplicate_rows,
		keep_open: keepOpen,
		keep_resolved: keepResolved,
		delete_open: deleteOpen,
		delete_resolved: deleteResolved,
		sample_groups: plan.sample_groups
	}

	if (!execute) {
		return {
			code: 0,
			msg: '预览成功',
			data: {
				execute: false,
				...summary
			}
		}
	}

	if (plan.limited) {
		return { code: 400, msg: `待清理记录超过 ${maxRows} 条，请增大 max_rows 后重试` }
	}

	const confirmText = normalizeString(data && (data.confirm_text || data.confirmText))
	if (confirmText !== CLEANUP_DUPLICATE_CONFIRM_TEXT) {
		return { code: 400, msg: '缺少确认口令，拒绝删除重复异常' }
	}

	let deleted = 0
	for (const row of plan.delete_rows) {
		const id = normalizeString(row && row._id)
		if (!id) continue
		await anomalies.doc(id).remove()
		deleted += 1
	}

	await recordLog(
		user,
		'bottle_anomaly_cleanup_duplicates_v1',
		{
			scope: summary.scope,
			max_rows: maxRows,
			total_rows: plan.total_rows,
			unique_rows: plan.unique_rows,
			duplicate_groups: plan.duplicate_groups,
			duplicate_rows: plan.duplicate_rows,
			deleted
		},
		requestId
	)

	return {
		code: 0,
		msg: '清理完成',
		data: {
			execute: true,
			deleted,
			...summary
		}
	}
}

async function resolveMissingFill(user, anomaly, resolutionMode = '') {
	const ctx = anomaly.context || {}
	const lastBack = ctx.last_back || {}
	const nextOut = ctx.next_out || {}
	const lastBackNet = toNumber(lastBack.net, null)
	const nextOutNet = toNumber(nextOut.net, null)
	const normalizedMode = normalizeMissingFillResolutionMode(resolutionMode)
	if (resolutionMode && !normalizedMode) {
		return { code: 400, msg: '缺灌装修复方式无效' }
	}
	if (lastBackNet == null || nextOutNet == null) {
		return { code: 400, msg: '缺少净重，无法修复' }
	}
	const diff = nextOutNet - lastBackNet
	const abs = Math.abs(diff)
	if (diff > MISSING_FILL_THRESHOLD_KG) {
		return { code: 400, msg: `净重差值为 +${diff.toFixed(1)} kg（增重），超过${MISSING_FILL_THRESHOLD_KG}kg，需补灌装后再修复` }
	}
	if (diff < -MISSING_FILL_THRESHOLD_KG) {
		return { code: 400, msg: `净重差值为 ${diff.toFixed(1)} kg，减重超过${MISSING_FILL_THRESHOLD_KG}kg，请先人工处理` }
	}

	const now = Date.now()
	const date = normalizeString(anomaly.date || nextOut.date || lastBack.date)
	const diffRounded = Math.round(diff * 1000) / 1000
	const anomalyFingerprint = getComparableAnomalyFingerprint(anomaly) || normalizeString(anomaly && anomaly._id)
	let lossKg = 0
	let swellKg = 0
	let appliedMode = normalizedMode
	if (!appliedMode) {
		if (diff > 0) appliedMode = MISSING_FILL_RESOLUTION_MODE_SWELL
		else appliedMode = MISSING_FILL_RESOLUTION_MODE_LOSS
	}
	if (diff < 0) {
		if (appliedMode !== MISSING_FILL_RESOLUTION_MODE_LOSS) {
			return { code: 400, msg: '当前差值为减重，请使用记损耗修复' }
		}
		const loss = Math.abs(diff)
		lossKg = Math.round(loss * 1000) / 1000
		const eventDay = normalizeEventDay(date, now)
		const eventAt = parseEventAt(date, now)
		await ensureMissingFillManualFix({
			bottle_no: normalizeBottleNo(anomaly.bottle_no),
			type: 'adjust',
			date,
			event_day: eventDay,
			event_at: eventAt,
			type_order: movementTypeOrder('adjust'),
			source_type: 'manual_fix',
			source_id: anomalyFingerprint || null,
			customer_id: null,
			customer_name: '',
			net_weight: null,
			loss_weight: loss,
			adjust_reason: 'missing_fill_loss_accept',
			note: `缺灌装差值损耗 ${loss.toFixed(1)}kg`,
			created_at: now,
			created_by: user?._id || null,
			created_by_name: user?.username || ''
		})
	} else if (diff > 0) {
		if (appliedMode !== MISSING_FILL_RESOLUTION_MODE_SWELL) {
			return { code: 400, msg: '当前差值为增重，请使用记胀重修复或补灌装单' }
		}
		const swell = Math.abs(diff)
		swellKg = Math.round(swell * 1000) / 1000
		const eventDay = normalizeEventDay(date, now)
		const eventAt = parseEventAt(date, now)
		await ensureMissingFillManualFix({
			bottle_no: normalizeBottleNo(anomaly.bottle_no),
			type: 'adjust',
			date,
			event_day: eventDay,
			event_at: eventAt,
			type_order: movementTypeOrder('adjust'),
			source_type: 'manual_fix',
			source_id: anomalyFingerprint || null,
			customer_id: null,
			customer_name: '',
			net_weight: null,
			loss_weight: -swell,
			adjust_reason: 'missing_fill_swell_accept',
			note: `缺灌装差值胀重 ${swell.toFixed(1)}kg`,
			created_at: now,
			created_by: user?._id || null,
			created_by_name: user?.username || ''
		})
	}

	return {
		code: 0,
		msg: '缺灌装已修复',
		resolution: buildMissingFillResolutionContext(appliedMode, diffRounded, lossKg, swellKg, now)
	}
}

async function resolveV1(user, data, requestId) {
	const id = normalizeString(data.id)
	if (!id) return { code: 400, msg: 'id 必填' }

	const res = await anomalies.doc(id).get()
	const anomaly = (res.data && res.data[0]) || null
	if (!anomaly) return { code: 404, msg: '异常不存在' }

	if (anomaly.status === 'resolved') return { code: 0, msg: '已修复' }

	if (NON_DIRECT_RESOLVE_TYPE_SET.has(normalizeString(anomaly.anomaly_type).toLowerCase())) {
		return { code: 400, msg: '该异常通常需要回原销售单修正，不支持直接标记修复' }
	}

	let nextContext = normalizeContext(anomaly.context)
	const resolutionMode = normalizeMissingFillResolutionMode(data.resolution_mode || data.resolutionMode)
	if (normalizeString(data.resolution_mode || data.resolutionMode) && !resolutionMode) {
		return { code: 400, msg: 'resolution_mode 无效' }
	}
	if (anomaly.anomaly_type === 'missing_fill') {
		const fix = await resolveMissingFill(user, anomaly, resolutionMode)
		if (fix.code !== 0) return fix
		nextContext = {
			...nextContext,
			resolution: normalizeContext(fix.resolution)
		}
	}

	const resolvedAt = Date.now()
	const resolveResult = await resolveOpenAnomaliesByFingerprint(anomaly, {
		status: 'resolved',
		updated_at: resolvedAt,
		resolved_by: user?._id || null,
		resolved_by_name: user?.username || '',
		context: nextContext
	})

	await recordLog(
		user,
		'bottle_anomaly_resolve_v1',
		{
			id,
			resolution_mode: resolutionMode || '',
			resolved_count: Number(resolveResult.resolvedCount || 0),
			fingerprint: resolveResult.fingerprint || ''
		},
		requestId
	)
	return {
		code: 0,
		msg: '已标记为修复',
		data: {
			resolved_count: Number(resolveResult.resolvedCount || 0),
			fingerprint: resolveResult.fingerprint || ''
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
		cloudFunction: 'crm-bottle-anomaly'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'listV1') return listV1(user, data)
	if (action === 'typesV1') return typesV1(user, data)
	if (action === 'scanV2') return scanV2(user, data, requestId)
	if (action === 'scanTruckAnomaliesV1') return scanTruckAnomaliesV1(user, data, requestId)
	if (action === 'rebuildV2') return rebuildV2(user, data, requestId)
	if (action === 'purgeV1') return purgeV1(user, data, requestId)
	if (action === 'touchV2') return touchV2(user, data, requestId)
	if (action === 'cleanupDuplicatesV1') return cleanupDuplicatesV1(user, data, requestId)
	if (action === 'resolveV1') return resolveV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
