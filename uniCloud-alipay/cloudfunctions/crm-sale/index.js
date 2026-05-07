'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const sales = db.collection('crm_sale_records')
const customers = db.collection('crm_customers')
const bottles = db.collection('crm_bottles')
const fillings = db.collection('crm_fillings')
const movements = db.collection('crm_bottle_movements')
const vouchers = db.collection('crm_vouchers')
const voucherEntries = db.collection('crm_voucher_entries')
const gasInventoryMovements = db.collection('crm_gas_inventory_movements')
const flowSettlements = db.collection('crm_customer_flow_settlements')
const customerReceipts = db.collection('crm_customer_receipts')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-sale] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}
const BOTTLE_FLOW_WARNING_KIND = 'bottle_flow_mismatch'
const AGENT_SALE_BACKFILL_ROLES = new Set(['superadmin'])
const AGENT_SALE_BACKFILL_CONFIRM_TEXT = 'BACKFILL_AGENT_SALE_BOTTLE_MOVEMENTS'
const PAGE_ACTION_RULES = {
	listV2: [{ pagePath: '/pages/sale/list', action: 'view' }],
	getV2: [{ pagePath: '/pages/sale/detail', action: 'view' }],
	createV2: [
		{ pagePath: '/pages/sale/edit', action: 'create' },
		{ pagePath: '/pages/pda/sale-create', action: 'create' }
	],
	updateV2: [{ pagePath: '/pages/sale/edit', action: 'update' }],
	updateSettlementV1: [{ pagePath: '/pages/sale/settlement', action: 'update' }],
	searchAgentFillSuggestionsV1: [{ pagePath: '/pages/sale/edit', action: 'view' }],
	removeV2: [{ pagePath: '/pages/sale/detail', action: 'delete' }],
	quickReceiveV1: [{ pagePath: '/pages/sale/detail', action: 'update' }],
	getCustomerDepositV1: [
		{ pagePath: '/pages/sale/edit', action: 'view' },
		{ pagePath: '/pages/customer/statement', action: 'view' },
		{ pagePath: '/pages/pda/sale-create', action: 'view' }
	]
}
const SUPERADMIN_ONLY_ACTIONS = [
	'backfillAgentSaleBottleMovementsV1',
	'backfillTruckGrossDiffV1',
	'cleanupPaymentMethodV1'
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
		console.error('[crm-sale] recordLog failed', action, err)
	}
}

function sliceIntoChunks(list = [], size = 200) {
	const source = Array.isArray(list) ? list : []
	const chunkSize = Math.max(Number(size) || 0, 1)
	const out = []
	for (let index = 0; index < source.length; index += chunkSize) {
		out.push(source.slice(index, index + chunkSize))
	}
	return out
}

function buildSaleMovementDoc({
	user,
	saleDoc,
	type,
	bottleNo,
	date,
	eventDay,
	eventAt,
	netWeight,
	note = '',
	scanLocation = null,
	createdAt = Date.now()
}) {
	const customerId = normalizeString(saleDoc && saleDoc.customer_id)
	const customerName = normalizeString(saleDoc && saleDoc.customer_name)
	const normalizedDate = normalizeString(date)
	const resolvedCreatedAt = toTimestamp(createdAt, Date.now())
	const doc = {
		bottle_no: normalizeBottleNoForCreate(bottleNo),
		type,
		date: normalizedDate,
		event_day: normalizeEventDay(eventDay || normalizedDate, resolvedCreatedAt),
		event_at: toTimestamp(eventAt, parseEventAt(normalizedDate, resolvedCreatedAt)),
		type_order: movementTypeOrder(type),
		source_type: 'sale',
		source_id: saleDoc && saleDoc._id,
		customer_id: customerId || null,
		customer_name: customerName,
		net_weight: toNumber(netWeight, null),
		loss_weight: null,
		note: normalizeString(note),
		created_at: resolvedCreatedAt,
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}
	const normalizedLocation = normalizeScanLocation(scanLocation)
	if (normalizedLocation) doc.scan_location = normalizedLocation
	return doc
}

async function appendMovementRecords(user, saleDoc, outRows, backRows) {
	const date = normalizeString(saleDoc.date)
	const now = Date.now()
	const eventDay = normalizeEventDay(date, now)
	const eventAt = parseEventAt(date, now)

	const inserts = []
	outRows.forEach((row) => {
		if (!row?.bottle_no) return
		inserts.push(
			buildSaleMovementDoc({
				user,
				saleDoc,
				type: 'out',
				bottleNo: row.bottle_no,
				date,
				eventDay,
				eventAt,
				netWeight: row.net,
				scanLocation: row.scan_location,
				createdAt: now
			})
		)
	})
	backRows.forEach((row) => {
		if (!row?.bottle_no) return
		inserts.push(
			buildSaleMovementDoc({
				user,
				saleDoc,
				type: 'back',
				bottleNo: row.bottle_no,
				date,
				eventDay,
				eventAt,
				netWeight: row.net,
				scanLocation: row.scan_location,
				createdAt: now
			})
		)
	})

	if (!inserts.length) return
	await movements.add(inserts)
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeTicketImages(images, legacyImage) {
	const list = []
	const pushOne = (value) => {
		const fileId = normalizeString(value)
		if (!fileId) return
		if (list.includes(fileId)) return
		list.push(fileId)
	}
	if (Array.isArray(images)) {
		images.forEach(pushOne)
	} else if (images != null && images !== '') {
		pushOne(images)
	}
	pushOne(legacyImage)
	return list.slice(0, 3)
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function normalizeIdString(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		const oid = normalizeString(value.$oid || value.oid || value.id || value._id)
		if (oid) return oid
	}
	return normalizeString(value)
}

function toBoolean(value, fallback = false) {
	if (typeof value === 'boolean') return value
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true
	if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false
	return fallback
}

function resolveSaleOffsetEnabled(doc, fallback = true) {
	if (!doc || typeof doc !== 'object') return Boolean(fallback)
	const raw = doc.offset_enabled
	if (raw == null || raw === '') return Boolean(fallback)
	if (typeof raw === 'boolean') return raw
	if (typeof raw === 'number') return raw !== 0
	const text = normalizeString(raw).toLowerCase()
	if (!text) return Boolean(fallback)
	if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true
	if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false
	return Boolean(fallback)
}

async function hasAllocatedOffsetCreditForSale(customerId, saleId) {
	const customerIdText = normalizeString(customerId)
	const saleIdText = normalizeString(saleId)
	if (!customerIdText || !saleIdText) return false
	const where = dbCmd.and([
		{ customer_id: customerIdText },
		{ source_id: saleIdText },
		{ status: 'posted' },
		{ source_type: dbCmd.in(['sale_offset_credit', 'sale_offset_credit_repair']) },
		{ allocated_amount: dbCmd.gt(0) }
	])
	const res = await customerReceipts.where(where).limit(1).get()
	const list = Array.isArray(res.data) ? res.data : []
	return list.length > 0
}

const REMARK_TAGS = new Set([
	'ticket_adjust_up',
	'ticket_adjust_down',
	'remove_back_bottle',
	'balance_carry',
	'material_install',
	'cash_mark',
	'merge_trace',
	'payment_event',
	'other'
])

function escapeRegExp(value) {
	return normalizeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqStrings(list = []) {
	return Array.from(new Set((list || []).map((item) => normalizeString(item)).filter(Boolean)))
}

function normalizeRemarkComparableText(value) {
	return normalizeString(value).replace(/[\s\r\n\t\u3000]+/g, '')
}

function extractMergeTraceTokens(value) {
	const text = normalizeString(value)
	if (!text) return []
	const matches = text.match(/\[合并自:[^\]]+\]/g)
	return uniqStrings(matches || [])
}

function stripMergeTraceTokens(value) {
	const text = normalizeString(value)
	if (!text) return ''
	return text
		.replace(/\[合并自:[^\]]+\]/g, ' ')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function normalizeRemarkTagsInput(value) {
	const source = Array.isArray(value) ? value : []
	return uniqStrings(source).filter((tag) => REMARK_TAGS.has(tag))
}

function parseRemarkTags({ businessRemark = '', systemNote = '' } = {}) {
	const text = normalizeString(businessRemark)
	const note = normalizeString(systemNote)
	const tags = []

	if (/(票上.*多算|多算.*票|补收|多收|补差价)/.test(text)) tags.push('ticket_adjust_up')
	if (/(票上.*少算|少算.*票|少收|多退|返差价)/.test(text)) tags.push('ticket_adjust_down')
	if (/(去掉回瓶|去回瓶|不算回瓶|扣回瓶)/.test(text)) tags.push('remove_back_bottle')
	if (/(余款|余\d+(?:\.\d+)?元|余额|结转|下次抵扣)/.test(text)) tags.push('balance_carry')
	if (/(新安装|安装|材料|配件|阀门|工时|改管)/.test(text)) tags.push('material_install')
	if (/现金/.test(text)) tags.push('cash_mark')
	if (note || /\[合并自:[^\]]+\]/.test(text)) tags.push('merge_trace')
	if (/(收款|回款|到账|付款|补款|转账|微信|支付宝|现金收)/.test(text)) tags.push('payment_event')
	if (!tags.length && text) tags.push('other')

	return uniqStrings(tags).filter((tag) => REMARK_TAGS.has(tag))
}

function deriveRemarkMeta(rawRemark, existingSystemNote = '') {
	const remark = normalizeString(rawRemark)
	const mergeTokens = extractMergeTraceTokens(remark)
	const businessRemark = stripMergeTraceTokens(remark)
	const normalizedRemark = normalizeRemarkComparableText(businessRemark)
	const systemNote = uniqStrings([existingSystemNote, ...mergeTokens]).join('；')
	const remarkTags = parseRemarkTags({ businessRemark, systemNote })
	const hasRemark = Boolean(normalizedRemark)
	return {
		remark,
		remark_normalized: normalizedRemark,
		remark_tags: remarkTags,
		system_note: systemNote,
		has_remark: hasRemark
	}
}

function applyRemarkMetaToDoc(doc = {}) {
	const derived = deriveRemarkMeta(doc && doc.remark, doc && doc.system_note)
	const hasRemark = typeof doc?.has_remark === 'boolean' ? doc.has_remark : derived.has_remark
	const systemNote = normalizeString(doc?.system_note) || derived.system_note
	const remarkNormalized = normalizeString(doc?.remark_normalized) || derived.remark_normalized
	const tags = normalizeRemarkTagsInput(doc?.remark_tags)
	const remarkTags = tags.length
		? tags
		: parseRemarkTags({
			businessRemark: stripMergeTraceTokens(normalizeString(doc && doc.remark)),
			systemNote
		})
	return {
		...doc,
		remark: normalizeString(doc && doc.remark),
		remark_normalized: remarkNormalized,
		remark_tags: remarkTags,
		system_note: systemNote,
		has_remark: hasRemark
	}
}

function normalizeHasRemarkFilter(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'yes' || text === 'true' || text === '1') return 'yes'
	if (text === 'no' || text === 'false' || text === '0') return 'no'
	return ''
}

function normalizeRemarkTagFilter(value) {
	const text = normalizeString(value)
	if (!text) return ''
	return REMARK_TAGS.has(text) ? text : ''
}

function matchRemarkFilters(doc, { hasRemark = '', remarkTag = '' } = {}) {
	const row = applyRemarkMetaToDoc(doc || {})
	if (hasRemark === 'yes' && !row.has_remark) return false
	if (hasRemark === 'no' && row.has_remark) return false
	if (remarkTag && !row.remark_tags.includes(remarkTag)) return false
	return true
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

function getCNDate(ts = Date.now()) {
	return new Date(ts + 8 * 60 * 60 * 1000)
}

function formatDateCN(date) {
	const y = date.getUTCFullYear()
	const m = date.getUTCMonth() + 1
	const d = date.getUTCDate()
	return `${y}-${pad2(m)}-${pad2(d)}`
}

function getMonthRange(date) {
	const y = date.getUTCFullYear()
	const m = date.getUTCMonth() + 1
	const start = `${y}-${pad2(m)}-01`
	const endDate = new Date(Date.UTC(y, m, 0))
	const end = formatDateCN(endDate)
	return { start, end }
}

async function fetchAll(collection, where, field) {
	const pageSize = 200
	let page = 0
	let list = []
	while (true) {
		let query = collection.where(where)
		if (field) query = query.field(field)
		const res = await query.skip(page * pageSize).limit(pageSize).get()
		const rows = res.data || []
		list = list.concat(rows)
		if (rows.length < pageSize) break
		page += 1
	}
	return list
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

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isNaN(num) ? fallback : num
}

function fix2(value) {
	const num = Number(value)
	return Number.isFinite(num) ? Number(num.toFixed(2)) : 0
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

function kgToTon(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return roundTon(num / 1000)
}

function joinDelivery(delivery1, delivery2) {
	const a = normalizeString(delivery1)
	const b = normalizeString(delivery2)
	if (a && b) return `${a} / ${b}`
	return a || b || ''
}

function normalizeScanLocation(value) {
	if (!value || typeof value !== 'object') return null
	const status = normalizeString(value.status || (value.latitude != null && value.longitude != null ? 'ok' : 'failed')) || 'failed'
	const capturedAt = toNumber(value.captured_at ?? value.capturedAt, null)
	const base = {
		status,
		coordinate_type: normalizeString(value.coordinate_type || value.coordinateType) || 'wgs84',
		captured_at: capturedAt || Date.now(),
		source: normalizeString(value.source) || 'pda_bottle_scan'
	}
	if (status === 'ok') {
		const latitude = toNumber(value.latitude, null)
		const longitude = toNumber(value.longitude, null)
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
			return {
				...base,
				status: 'failed',
				error_code: 'invalid_location',
				error_message: '定位结果缺少经纬度'
			}
		}
		const accuracy = toNumber(value.accuracy, null)
		return {
			...base,
			latitude,
			longitude,
			accuracy: Number.isFinite(accuracy) ? accuracy : null
		}
	}
	return {
		...base,
		status: 'failed',
		error_code: normalizeString(value.error_code || value.errorCode) || 'get_location_failed',
		error_message: normalizeString(value.error_message || value.errorMessage) || '定位失败'
	}
}

function normalizeBottleRows(rows = []) {
	return (rows || [])
		.map((row) => {
			const bottleNo = normalizeString(row?.bottle_no ?? row?.bottleInput)
			if (!bottleNo) return null
			const normalized = {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null,
				gross: toNumber(row?.gross, 0),
				tare: toNumber(row?.tare, 0),
				net: toNumber(row?.net, 0)
			}
			const scanLocation = normalizeScanLocation(row?.scan_location || row?.scanLocation)
			if (scanLocation) normalized.scan_location = scanLocation
			return normalized
		})
		.filter(Boolean)
}

function normalizeDepositRows(rows = []) {
	return (rows || [])
		.map((row) => {
			const bottleNo = normalizeString(row?.bottle_no ?? row?.bottleNo)
			if (!bottleNo) return null
			return { bottle_no: bottleNo, bottle_id: row?.bottle_id ?? row?.bottleId ?? null }
		})
		.filter(Boolean)
}

function normalizeBottleNoForCreate(value) {
	return normalizeString(value).toUpperCase()
}

function normalizeTruckNoForCreate(value, fallback = '') {
	const raw = normalizeBottleNoForCreate(value || fallback)
	if (!raw) return ''
	const prefixed = raw.match(/^TRUCK[-_]?([A-Z0-9]+)$/)
	if (prefixed && prefixed[1]) return `TRUCK-${prefixed[1]}`
	const compact = raw.replace(/[^A-Z0-9\u4E00-\u9FA5]/g, '')
	if (!compact) return ''
	const plateMatch = compact.match(/^[\u4E00-\u9FA5][A-Z]([A-Z0-9]+)$/)
	const core = plateMatch && plateMatch[1] ? plateMatch[1] : compact
	return core ? `TRUCK-${core}` : ''
}

function isDuplicateKeyError(err) {
	const msg = String(err?.message || err || '')
	return msg.includes('duplicate key') || msg.includes('E11000')
}

async function ensureBottlesExist({ customerId, customerName, outRows = [], backRows = [], depositRows = [] }) {
	const outNos = outRows
		.map((row) => normalizeBottleNoForCreate(row?.bottle_no))
		.filter(Boolean)
	const backNos = backRows
		.map((row) => normalizeBottleNoForCreate(row?.bottle_no))
		.filter(Boolean)
	const depositNos = depositRows
		.map((row) => normalizeBottleNoForCreate(row?.bottle_no))
		.filter(Boolean)

	const allNos = Array.from(new Set([...outNos, ...backNos, ...depositNos]))
	if (!allNos.length) return { ok: true }

	const existingRes = await bottles
		.where({ bottle_no: dbCmd.in(allNos) })
		.field({ bottle_no: true })
		.get()
	const existingSet = new Set(
		(existingRes.data || []).map((item) => normalizeBottleNoForCreate(item.bottle_no))
	)
	const missing = allNos.filter((no) => !existingSet.has(no))
	if (!missing.length) return { ok: true }

	const tareMap = new Map()
	const collectTare = (rows) => {
		rows.forEach((row) => {
			const no = normalizeBottleNoForCreate(row?.bottle_no)
			if (!no || tareMap.has(no)) return
			const tare = toNumber(row?.tare, null)
			if (tare != null && Number.isFinite(tare)) tareMap.set(no, tare)
		})
	}
	collectTare(outRows)
	collectTare(backRows)

	const backSet = new Set(backNos)
	const atCustomerSet = new Set([...outNos, ...depositNos])
	const now = Date.now()

	try {
		await Promise.all(
			missing.map(async (no) => {
				const status = backSet.has(no) ? 'in_station' : (atCustomerSet.has(no) ? 'at_customer' : 'unknown')
				const doc = {
					bottle_no: no,
					tare_weight: tareMap.has(no) ? tareMap.get(no) : null,
					status,
					current_customer_id: status === 'at_customer' ? customerId : null,
					current_customer_name: status === 'at_customer' ? customerName : '',
					remark: '',
					is_active: true,
					created_at: now,
					updated_at: now
				}
				try {
					await bottles.add(doc)
				} catch (err) {
					if (isDuplicateKeyError(err)) return
					throw err
				}
			})
		)
		return { ok: true }
	} catch (err) {
		return { ok: false, msg: `自动建瓶失败: ${err?.message || '未知错误'}` }
	}
}

function normalizeAgentRows(rows = []) {
	const seen = new Set()
	return (rows || [])
		.map((row) => {
			const bottleNo = normalizeBottleNoForCreate(row?.bottle_no ?? row?.bottleNo)
			if (!bottleNo || seen.has(bottleNo)) return null
			seen.add(bottleNo)
			return {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null,
				fill_weight: toNumber(row?.fill_weight ?? row?.fillWeight, 0),
				address: normalizeString(row?.address),
				filling_record_id: normalizeIdString(row?.filling_record_id ?? row?.fillingRecordId)
			}
		})
		.filter(Boolean)
}

function clampInt(value, min, max, fallback) {
	const num = Number(value)
	if (!Number.isFinite(num)) return fallback
	return Math.min(Math.max(Math.floor(num), min), max)
}

function buildAndWhere(conditions = []) {
	const list = (conditions || []).filter(Boolean)
	if (!list.length) return {}
	if (list.length === 1) return list[0]
	return dbCmd.and(list)
}

function pickLaterFillByDate(current, candidate) {
	if (!candidate) return current
	if (!current) return candidate
	const currentDate = normalizeString(current && current.date)
	const candidateDate = normalizeString(candidate && candidate.date)
	if (candidateDate && currentDate && candidateDate !== currentDate) {
		return candidateDate > currentDate ? candidate : current
	}
	if (candidateDate && !currentDate) return candidate
	return selectLatestByTimestamp(current, candidate, 'updated_at', 'created_at')
}

function scoreBottleNoByKeyword(bottleNo, keyword) {
	const source = normalizeBottleNoForCreate(bottleNo)
	const target = normalizeBottleNoForCreate(keyword)
	if (!source || !target) return 0
	if (source === target) return 1000
	if (source.startsWith(target)) return 600
	if (source.includes(target)) return 300
	return 0
}

function compareAgentSuggestionRows(left, right, keyword) {
	const scoreDiff = scoreBottleNoByKeyword(right && right.bottle_no, keyword) - scoreBottleNoByKeyword(left && left.bottle_no, keyword)
	if (scoreDiff !== 0) return scoreDiff
	const leftDate = normalizeString(left && left.fill_date)
	const rightDate = normalizeString(right && right.fill_date)
	if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
	return normalizeBottleNoForCreate(left && left.bottle_no).localeCompare(normalizeBottleNoForCreate(right && right.bottle_no), 'zh-CN', {
		numeric: true,
		sensitivity: 'base'
	})
}

function formatAgentFillWeight(weight) {
	const num = toNumber(weight, null)
	if (!(num > 0)) return null
	return fix2(num)
}

async function fetchLatestAgentFillByBottleNo(bottleNo, saleDate = '') {
	const normalizedBottleNo = normalizeBottleNoForCreate(bottleNo)
	if (!normalizedBottleNo) return null
	const date = normalizeString(saleDate)
	const conditions = [
		{ record_type: 'truck_out_agent_sale' },
		{ bottle_no: normalizedBottleNo },
		{ fill_weight: dbCmd.gt(0) }
	]
	if (date) conditions.push({ date: dbCmd.lte(date) })
	const where = buildAndWhere(conditions)

	try {
		const res = await fillings
			.where(where)
			.field({
				_id: true,
				bottle_no: true,
				record_type: true,
				date: true,
				fill_weight: true,
				created_at: true,
				updated_at: true
			})
			.orderBy('date', 'desc')
			.orderBy('updated_at', 'desc')
			.orderBy('created_at', 'desc')
			.limit(1)
			.get()
		const row = (res.data || [])[0] || null
		const fillWeight = formatAgentFillWeight(row && row.fill_weight)
		if (!row || fillWeight == null) return null
		return {
			...row,
			fill_weight: fillWeight
		}
	} catch (err) {
		console.warn('[crm-sale] fetchLatestAgentFillByBottleNo fallback', normalizedBottleNo, err && err.message)
	}

	const fallbackRes = await fillings
		.where(where)
		.field({
			_id: true,
			bottle_no: true,
			record_type: true,
			date: true,
			fill_weight: true,
			created_at: true,
			updated_at: true
		})
		.limit(200)
		.get()
	let latest = null
	for (const row of fallbackRes.data || []) {
		const fillWeight = formatAgentFillWeight(row && row.fill_weight)
		if (fillWeight == null) continue
		latest = pickLaterFillByDate(latest, {
			...row,
			fill_weight: fillWeight
		})
	}
	return latest
}

async function bindAgentRowsWithLatestFill(agentRows = [], saleDate = '') {
	const rows = Array.isArray(agentRows) ? agentRows : []
	if (!rows.length) return { ok: true, rows: [] }
	const fillIdSet = new Set()
	const bottleSet = new Set()
	for (const row of rows) {
		const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
		if (bottleNo) bottleSet.add(bottleNo)
		const fillId = normalizeString(row && row.filling_record_id)
		if (fillId) fillIdSet.add(fillId)
	}

	const fillDocById = new Map()
	if (fillIdSet.size) {
		for (const chunk of sliceIntoChunks(Array.from(fillIdSet), 120)) {
			const res = await fillings
				.where({ _id: dbCmd.in(chunk) })
				.field({
					_id: true,
					bottle_no: true,
					record_type: true,
					date: true,
					fill_weight: true,
					created_at: true,
					updated_at: true
				})
				.limit(chunk.length)
				.get()
			for (const doc of res.data || []) {
				const id = normalizeString(doc && doc._id)
				if (id) fillDocById.set(id, doc)
			}
		}
	}

	const latestByBottle = new Map()
	const missingFillIdBottleNos = Array.from(bottleSet).filter((bottleNo) => {
		const related = rows.some((row) => normalizeBottleNoForCreate(row && row.bottle_no) === bottleNo && !normalizeString(row && row.filling_record_id))
		return related
	})
	if (missingFillIdBottleNos.length) {
		const latestRows = await Promise.all(
			missingFillIdBottleNos.map((bottleNo) => fetchLatestAgentFillByBottleNo(bottleNo, saleDate))
		)
		latestRows.forEach((row) => {
			if (!row) return
			const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
			if (!bottleNo) return
			latestByBottle.set(bottleNo, row)
		})
	}

	const normalizedRows = []
	for (const row of rows) {
		const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
		if (!bottleNo) continue
		const explicitFillId = normalizeString(row && row.filling_record_id)
		let sourceFill = null
		if (explicitFillId) {
			sourceFill = fillDocById.get(explicitFillId)
			if (!sourceFill) return { ok: false, msg: `瓶号 ${bottleNo} 关联灌装记录不存在，请重新选择瓶号` }
		} else {
			sourceFill = latestByBottle.get(bottleNo) || null
			if (!sourceFill) return { ok: false, msg: `瓶号 ${bottleNo} 未找到代理灌装记录，请核对` }
		}
		if (normalizeString(sourceFill && sourceFill.record_type) !== 'truck_out_agent_sale') {
			return { ok: false, msg: `瓶号 ${bottleNo} 不是代理灌装来源，请核对` }
		}
		const sourceBottleNo = normalizeBottleNoForCreate(sourceFill && sourceFill.bottle_no)
		if (!sourceBottleNo || sourceBottleNo !== bottleNo) {
			return { ok: false, msg: `瓶号 ${bottleNo} 与关联代理灌装不一致，请重新选择` }
		}
		const fillWeight = formatAgentFillWeight(sourceFill && sourceFill.fill_weight)
		if (!(fillWeight > 0)) return { ok: false, msg: `瓶号 ${bottleNo} 代理灌装重量无效，请核对` }
		normalizedRows.push({
			...row,
			bottle_no: bottleNo,
			fill_weight: fillWeight,
			filling_record_id: normalizeString(sourceFill && sourceFill._id)
		})
	}
	return { ok: true, rows: normalizedRows }
}

async function searchAgentFillSuggestionsV1(user, data = {}) {
	void user
	const keyword = normalizeBottleNoForCreate(data.keyword || data.bottle_no || data.bottleNo)
	if (!keyword) return { code: 0, data: [] }
	const saleDate = normalizeString(data.date || data.sale_date || data.saleDate)
	const limit = clampInt(data.limit, 1, 30, 20)
	const scanLimit = clampInt(data.scan_limit || data.scanLimit, 50, 1200, Math.max(limit * 40, 200))

	const conditions = [
		{ record_type: 'truck_out_agent_sale' },
		{ bottle_no: db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' }) },
		{ fill_weight: dbCmd.gt(0) }
	]
	if (saleDate) conditions.push({ date: dbCmd.lte(saleDate) })
	const where = buildAndWhere(conditions)

	const candidateRes = await fillings
		.where(where)
		.field({ bottle_no: true })
		.limit(scanLimit)
		.get()
	const candidateNos = uniqStrings(
		(candidateRes.data || [])
			.map((row) => normalizeBottleNoForCreate(row && row.bottle_no))
			.filter(Boolean)
	)
	if (!candidateNos.length) return { code: 0, data: [] }

	candidateNos.sort((left, right) => {
		const scoreDiff = scoreBottleNoByKeyword(right, keyword) - scoreBottleNoByKeyword(left, keyword)
		if (scoreDiff !== 0) return scoreDiff
		return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
	})
	const lookupNos = candidateNos.slice(0, Math.max(limit * 3, 60))
	const latestFillRows = await Promise.all(
		lookupNos.map((bottleNo) => fetchLatestAgentFillByBottleNo(bottleNo, saleDate))
	)
	const latestByBottle = new Map()
	for (const row of latestFillRows) {
		if (!row) continue
		const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
		if (!bottleNo) continue
		latestByBottle.set(bottleNo, row)
	}
	const matchedBottleNos = Array.from(latestByBottle.keys())
	if (!matchedBottleNos.length) return { code: 0, data: [] }

	const bottleRes = await bottles
		.where({ bottle_no: dbCmd.in(matchedBottleNos) })
		.field({
			_id: true,
			bottle_no: true,
			status: true,
			current_customer_id: true,
			current_customer_name: true
		})
		.limit(Math.max(matchedBottleNos.length, 1))
		.get()
	const bottleByNo = new Map()
	for (const row of bottleRes.data || []) {
		const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
		if (bottleNo) bottleByNo.set(bottleNo, row)
	}

	const items = matchedBottleNos
		.map((bottleNo) => {
			const fillDoc = latestByBottle.get(bottleNo)
			const bottleDoc = bottleByNo.get(bottleNo)
			return {
				bottle_no: bottleNo,
				bottle_id: normalizeString(bottleDoc && bottleDoc._id) || null,
				fill_weight: formatAgentFillWeight(fillDoc && fillDoc.fill_weight) || 0,
				filling_record_id: normalizeString(fillDoc && fillDoc._id) || '',
				fill_date: normalizeString(fillDoc && fillDoc.date),
				status: normalizeString(bottleDoc && bottleDoc.status) || 'unknown',
				current_customer_id: normalizeString(bottleDoc && bottleDoc.current_customer_id) || '',
				current_customer_name: normalizeString(bottleDoc && bottleDoc.current_customer_name)
			}
		})
		.filter((item) => item && item.fill_weight > 0 && item.filling_record_id)

	items.sort((left, right) => compareAgentSuggestionRows(left, right, keyword))

	return {
		code: 0,
		data: items.slice(0, limit)
	}
}

function selectLatestByTimestamp(current, candidate, ...fields) {
	if (!current) return candidate
	const currentTs = fields.reduce((out, key) => {
		if (out > 0) return out
		return toTimestamp(current && current[key], 0)
	}, 0)
	const candidateTs = fields.reduce((out, key) => {
		if (out > 0) return out
		return toTimestamp(candidate && candidate[key], 0)
	}, 0)
	return candidateTs >= currentTs ? candidate : current
}

async function fetchAgentSaleLinkedFillMeta(agentRows = []) {
	const fillIds = uniqStrings(
		(agentRows || [])
			.map((row) => normalizeString(row && row.filling_record_id))
			.filter(Boolean)
	)
	const fillMovementById = new Map()
	const fillingById = new Map()
	const fallbackFillByBottleDay = new Map()
	if (!fillIds.length && !(agentRows || []).length) {
		return { fillMovementById, fillingById, fallbackFillByBottleDay }
	}

	for (const chunk of sliceIntoChunks(fillIds, 120)) {
		const [movementRes, fillingRes] = await Promise.all([
			movements
				.where({
					source_id: dbCmd.in(chunk),
					type: 'fill'
				})
				.field({
					source_id: true,
					bottle_no: true,
					date: true,
					event_day: true,
					event_at: true,
					created_at: true,
					updated_at: true,
					net_weight: true,
					note: true
				})
				.limit(chunk.length * 3)
				.get(),
			fillings
				.where({ _id: dbCmd.in(chunk) })
				.field({
					_id: true,
					date: true,
					bottle_no: true,
					record_type: true,
					fill_weight: true,
					created_at: true,
					updated_at: true,
					remark: true
				})
				.limit(chunk.length)
				.get()
		])

		for (const row of movementRes.data || []) {
			const sourceId = normalizeString(row && row.source_id)
			if (!sourceId) continue
			const current = fillMovementById.get(sourceId)
			fillMovementById.set(sourceId, selectLatestByTimestamp(current, row, 'updated_at', 'created_at', 'event_at'))
		}

		for (const row of fillingRes.data || []) {
			const id = normalizeString(row && row._id)
			if (!id) continue
			const current = fillingById.get(id)
			fillingById.set(id, selectLatestByTimestamp(current, row, 'updated_at', 'created_at'))
		}
	}

	const fallbackRows = (agentRows || []).filter((row) => !normalizeString(row && row.filling_record_id))
	const fallbackBottleNos = uniqStrings(
		fallbackRows
			.map((row) => normalizeBottleNoForCreate(row && row.bottle_no))
			.filter(Boolean)
	)
	const fallbackDays = uniqStrings(
		fallbackRows
			.map((row) => normalizeEventDay(row && row.sale_date, ''))
			.filter(Boolean)
	)
	if (!fallbackBottleNos.length || !fallbackDays.length) {
		return { fillMovementById, fillingById, fallbackFillByBottleDay }
	}

	const fallbackMovementRes = await movements
		.where({
			type: 'fill',
			bottle_no: dbCmd.in(fallbackBottleNos),
			event_day: dbCmd.in(fallbackDays)
		})
		.field({
			source_id: true,
			bottle_no: true,
			date: true,
			event_day: true,
			event_at: true,
			created_at: true,
			updated_at: true
		})
		.limit(Math.max(fallbackBottleNos.length * fallbackDays.length * 4, 40))
		.get()
	const fallbackSourceIds = uniqStrings(
		(fallbackMovementRes.data || [])
			.map((row) => normalizeString(row && row.source_id))
			.filter(Boolean)
	)
	if (!fallbackSourceIds.length) {
		return { fillMovementById, fillingById, fallbackFillByBottleDay }
	}

	for (const chunk of sliceIntoChunks(fallbackSourceIds, 120)) {
		const fallbackFillingRes = await fillings
			.where({ _id: dbCmd.in(chunk) })
			.field({
				_id: true,
				date: true,
				bottle_no: true,
				record_type: true,
				fill_weight: true,
				created_at: true,
				updated_at: true
			})
			.limit(chunk.length)
			.get()
		for (const row of fallbackFillingRes.data || []) {
			const id = normalizeString(row && row._id)
			if (!id) continue
			const current = fillingById.get(id)
			fillingById.set(id, selectLatestByTimestamp(current, row, 'updated_at', 'created_at'))
		}
	}

	for (const row of fallbackMovementRes.data || []) {
		const sourceId = normalizeString(row && row.source_id)
		const fillingDoc = sourceId ? fillingById.get(sourceId) : null
		if (!sourceId || normalizeString(fillingDoc && fillingDoc.record_type) !== 'truck_out_agent_sale') continue
		const bottleNo = normalizeBottleNoForCreate((row && row.bottle_no) || (fillingDoc && fillingDoc.bottle_no))
		const eventDay = normalizeEventDay((row && row.event_day) || (row && row.date) || (fillingDoc && fillingDoc.date), '')
		if (!bottleNo || !eventDay) continue
		const key = `${bottleNo}|${eventDay}`
		const current = fallbackFillByBottleDay.get(key)
		const candidate = {
			source_id: sourceId,
			bottle_no: bottleNo,
			date: normalizeString((row && row.date) || (fillingDoc && fillingDoc.date)),
			event_day: eventDay,
			event_at: toTimestamp(row && row.event_at, parseEventAt((row && row.date) || (fillingDoc && fillingDoc.date), row && row.created_at)),
			created_at: toTimestamp((row && row.created_at) || (fillingDoc && fillingDoc.created_at), Date.now()),
			updated_at: toTimestamp((row && row.updated_at) || (fillingDoc && fillingDoc.updated_at), 0)
		}
		fallbackFillByBottleDay.set(key, selectLatestByTimestamp(current, candidate, 'updated_at', 'created_at', 'event_at'))
	}

	return { fillMovementById, fillingById, fallbackFillByBottleDay }
}

function resolveAgentSaleMovementAnchor(row, saleDoc, fillMovementById, fillingById, fallbackFillByBottleDay, fallbackCreatedAt) {
	const saleDate = normalizeString(saleDoc && saleDoc.date)
	const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
	const explicitFillId = normalizeString(row && row.filling_record_id)
	const fallbackKey = `${bottleNo}|${normalizeEventDay(saleDate, fallbackCreatedAt)}`
	const fallbackFill = explicitFillId ? null : fallbackFillByBottleDay.get(fallbackKey)
	const fillId = explicitFillId || normalizeString(fallbackFill && fallbackFill.source_id)
	const fillMovement = fillId ? (fillMovementById.get(fillId) || fallbackFill) : null
	const fillingDoc = fillId ? fillingById.get(fillId) : null
	const recordTypeMatched = !fillingDoc || normalizeString(fillingDoc.record_type) === 'truck_out_agent_sale'
	const linkedBottleNo = normalizeBottleNoForCreate(
		(fillMovement && fillMovement.bottle_no) || (fillingDoc && fillingDoc.bottle_no)
	)
	const bottleMatched = !linkedBottleNo || linkedBottleNo === bottleNo
	const linkedDate = bottleMatched
		&& recordTypeMatched
		? normalizeString((fillMovement && fillMovement.date) || (fillingDoc && fillingDoc.date))
		: ''
	const linkedCreatedAt = toTimestamp(
		(fillMovement && fillMovement.created_at)
			|| (fillingDoc && fillingDoc.created_at),
		toTimestamp(fallbackCreatedAt, Date.now())
	)
	const movementDate = linkedDate || saleDate
	const movementEventDay = normalizeString(fillMovement && fillMovement.event_day) || normalizeEventDay(movementDate, linkedCreatedAt)
	const movementEventAt = fillMovement && fillMovement.event_at
		? toTimestamp(fillMovement.event_at, linkedCreatedAt)
		: parseEventAt(movementDate, linkedCreatedAt)
	let note = '代理销售自动补链'
	if (fillId && bottleMatched && recordTypeMatched && linkedDate) {
		note += `（关联灌装 ${fillId}）`
	} else if (fillId && !recordTypeMatched) {
		note += `（关联灌装 ${fillId} 不是代理灌装，按销售日期补链）`
	} else if (fillId && !bottleMatched) {
		note += `（关联灌装 ${fillId} 瓶号不匹配，按销售日期补链）`
	} else if (explicitFillId) {
		note += `（关联灌装 ${fillId} 未命中，按销售日期补链）`
	} else if (fillId) {
		note += `（按同日代理灌装 ${fillId} 补链）`
	}
	return {
		date: movementDate,
		event_day: movementEventDay,
		event_at: movementEventAt,
		note
	}
}

async function appendAgentSaleMovementRecords(user, saleDoc, agentRows = []) {
	const docs = await buildAgentSaleMovementDocs(user, saleDoc, agentRows)
	if (!docs.length) return
	await movements.add(docs)
}

async function buildAgentSaleMovementDocs(user, saleDoc, agentRows = [], linkedMeta = null) {
	const rows = Array.isArray(agentRows) ? agentRows : []
	if (!rows.length) return []
	const now = Date.now()
	const rowsWithSaleDate = rows.map((row) => ({ ...row, sale_date: saleDoc && saleDoc.date }))
	const {
		fillMovementById,
		fillingById,
		fallbackFillByBottleDay
	} = linkedMeta || await fetchAgentSaleLinkedFillMeta(rowsWithSaleDate)
	const inserts = []
	for (const row of rows) {
		const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
		const fillWeight = toNumber(row && row.fill_weight, null)
		if (!bottleNo || !(fillWeight > 0)) continue
		const anchor = resolveAgentSaleMovementAnchor(row, saleDoc, fillMovementById, fillingById, fallbackFillByBottleDay, now)
		inserts.push(
			buildSaleMovementDoc({
				user,
				saleDoc,
				type: 'back',
				bottleNo,
				date: anchor.date,
				eventDay: anchor.event_day,
				eventAt: anchor.event_at,
				netWeight: 0,
				note: `${anchor.note}回瓶`,
				createdAt: now
			}),
			buildSaleMovementDoc({
				user,
				saleDoc,
				type: 'out',
				bottleNo,
				date: anchor.date,
				eventDay: anchor.event_day,
				eventAt: anchor.event_at,
				netWeight: fillWeight,
				note: `${anchor.note}出瓶`,
				createdAt: now
			})
		)
	}
	return inserts
}

async function appendSaleMovementRecords(user, saleDoc, { bizMode = '', outRows = [], backRows = [], agentRows = [] } = {}) {
	const normalizedBizMode = normalizeBizModeValue(bizMode || saleDoc?.biz_mode)
	if (normalizedBizMode === 'bottle') {
		await appendMovementRecords(user, saleDoc, outRows, backRows)
		return
	}
	if (normalizedBizMode === 'agent_sale') {
		await appendAgentSaleMovementRecords(user, saleDoc, agentRows)
	}
}

function collectBottleNosFromRows(rows = []) {
	const set = new Set()
	for (const row of rows || []) {
		const no = normalizeBottleNoForCreate(row && row.bottle_no)
		if (no) set.add(no)
	}
	return Array.from(set)
}

function isSameBottleNoSet(leftRows = [], rightRows = []) {
	const left = collectBottleNosFromRows(leftRows)
	const right = collectBottleNosFromRows(rightRows)
	if (left.length !== right.length) return false
	const rightSet = new Set(right)
	return left.every((item) => rightSet.has(item))
}

function buildDepositRowsFromOutRows(outRows = []) {
	const seen = new Set()
	const result = []
	for (const row of outRows || []) {
		const bottleNo = normalizeBottleNoForCreate(row && row.bottle_no)
		if (!bottleNo || seen.has(bottleNo)) continue
		seen.add(bottleNo)
		result.push({
			bottle_no: bottleNo,
			bottle_id: normalizeIdString(row && row.bottle_id) || null
		})
	}
	return result
}

function shouldAutoSyncDepositRowsOnSaleUpdate({ existingDoc = null, incomingOutRows = [], incomingDepositRows = [] } = {}) {
	const existingOutRows = Array.isArray(existingDoc && existingDoc.out_items) ? existingDoc.out_items : []
	const existingDepositRows = Array.isArray(existingDoc && existingDoc.deposit_rows) ? existingDoc.deposit_rows : []
	if (!incomingOutRows.length) return false
	if (!existingOutRows.length || !existingDepositRows.length) return false
	// 仅在本次请求没有手工改存瓶行时自动同步，避免覆盖用户有意维护的存瓶明细。
	if (!isSameBottleNoSet(incomingDepositRows, existingDepositRows)) return false
	// 已经一致则无需同步；不一致才需要用出瓶行修正存瓶快照。
	if (isSameBottleNoSet(incomingDepositRows, incomingOutRows)) return false
	return true
}

function collectSaleBottleNosFromDoc(doc) {
	const outRows = Array.isArray(doc && doc.out_items) ? doc.out_items : []
	const backRows = Array.isArray(doc && doc.back_items) ? doc.back_items : []
	const depositRows = Array.isArray(doc && doc.deposit_rows) ? doc.deposit_rows : []
	const agentRows = Array.isArray(doc && doc.agent_sale_items) ? doc.agent_sale_items : []
	const set = new Set([
		...collectBottleNosFromRows(outRows),
		...collectBottleNosFromRows(backRows),
		...collectBottleNosFromRows(depositRows),
		...collectBottleNosFromRows(agentRows)
	])
	return Array.from(set)
}

function collectSaleCustomerIdsFromDoc(doc) {
	const customerId = normalizeString(doc && doc.customer_id)
	return customerId ? [customerId] : []
}

function collectSaleTruckNosFromDoc(doc) {
	const bizMode = normalizeBizModeValue(doc && doc.biz_mode)
	if (bizMode !== 'truck') return []
	const set = new Set()
	const rawTruckNo = normalizeBottleNoForCreate(doc && doc.truck_no)
	const normalizedTruckNo = normalizeTruckNoForCreate(doc && doc.truck_no, doc && doc.car_no)
	if (rawTruckNo) set.add(rawTruckNo)
	if (normalizedTruckNo) set.add(normalizedTruckNo)
	return Array.from(set)
}

async function fetchCustomerDepositSaleRows(customerId, dateEnd = '', excludeSaleId = '') {
	const resolvedCustomerId = normalizeString(customerId)
	if (!resolvedCustomerId) return []
	const where = { customer_id: resolvedCustomerId }
	if (dateEnd) where.date = dbCmd.lte(dateEnd)
	const res = await sales
		.where(where)
		.field({ _id: true, out_items: true, back_items: true, deposit_rows: true, date: true, created_at: true })
		.orderBy('date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()
	const excludedId = normalizeString(excludeSaleId)
	return (res.data || []).filter((row) => !excludedId || normalizeString(row && row._id) !== excludedId)
}

function buildCustomerDepositBottleSet(rows = []) {
	const set = new Set()
	;(rows || []).forEach((row) => {
		const outs = Array.isArray(row && row.out_items) ? row.out_items : []
		const backs = Array.isArray(row && row.back_items) ? row.back_items : []
		const deposits = Array.isArray(row && row.deposit_rows) ? row.deposit_rows : []
		const hasOutOrBack = outs.length > 0 || backs.length > 0

		outs.forEach((item) => {
			const no = normalizeBottleNoForCreate(item && item.bottle_no)
			if (no) set.add(no)
		})
		// 存瓶行只在“纯存瓶补录（无出/回行）”时参与存瓶快照，避免出瓶改号后旧存瓶行残留污染结果。
		if (!hasOutOrBack) {
			deposits.forEach((item) => {
				const no = normalizeBottleNoForCreate(item && item.bottle_no)
				if (no) set.add(no)
			})
		}
		backs.forEach((item) => {
			const no = normalizeBottleNoForCreate(item && item.bottle_no)
			if (no) set.delete(no)
		})
	})
	return set
}

function buildCustomerDepositBottleSnapshotMap(rows = [], previewLimit = 20) {
	const set = new Set()
	const map = new Map()
	const limit = Math.max(toNumber(previewLimit, 20), 1)
	;(rows || []).forEach((row) => {
		const saleId = normalizeString(row && row._id)
		const outs = Array.isArray(row && row.out_items) ? row.out_items : []
		const backs = Array.isArray(row && row.back_items) ? row.back_items : []
		const deposits = Array.isArray(row && row.deposit_rows) ? row.deposit_rows : []
		const hasOutOrBack = outs.length > 0 || backs.length > 0

		collectBottleNosFromRows(outs).forEach((bottleNo) => set.add(bottleNo))
		// 存瓶行仅在纯补录（无出/回）时参与，避免旧存瓶行残留污染快照。
		if (!hasOutOrBack) collectBottleNosFromRows(deposits).forEach((bottleNo) => set.add(bottleNo))
		collectBottleNosFromRows(backs).forEach((bottleNo) => set.delete(bottleNo))

		if (saleId) {
			const allBottles = Array.from(set).sort()
			map.set(saleId, {
				count: allBottles.length,
				bottles_preview: allBottles.slice(0, limit),
				bottles_truncated: allBottles.length > limit
			})
		}
	})
	return map
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
		if (effectiveEvents.length) {
			resolvePendingSameDayBackOut(state, effectiveEvents[0].type)
		}
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

async function fetchBottleMovementRowsByBottleNos(bottleNos = [], { dateEnd = '', excludeSaleId = '' } = {}) {
	const normalizedNos = Array.from(new Set((bottleNos || []).map((item) => normalizeBottleNoForCreate(item)).filter(Boolean)))
	if (!normalizedNos.length) return []
	const where = { bottle_no: dbCmd.in(normalizedNos) }
	if (dateEnd) where.date = dbCmd.lte(dateEnd)
	const res = await movements
		.where(where)
		.field({
			bottle_no: true,
			type: true,
			date: true,
			event_day: true,
			event_at: true,
			type_order: true,
			source_type: true,
			source_id: true,
			customer_id: true,
			customer_name: true,
			created_at: true
		})
		.orderBy('event_at', 'asc')
		.orderBy('type_order', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()
	const excludedId = normalizeString(excludeSaleId)
	return (res.data || []).filter((row) => {
		if (!excludedId) return true
		return !(normalizeString(row && row.source_type) === 'sale' && normalizeString(row && row.source_id) === excludedId)
	})
}

function buildBottleFlowStateMap(rows = [], bottleNos = []) {
	const grouped = new Map()
	;(bottleNos || []).forEach((item) => {
		const no = normalizeBottleNoForCreate(item)
		if (no && !grouped.has(no)) grouped.set(no, [])
	})
	;(rows || []).forEach((row) => {
		const no = normalizeBottleNoForCreate(row && row.bottle_no)
		if (!no) return
		if (!grouped.has(no)) grouped.set(no, [])
		grouped.get(no).push(row)
	})
	const map = new Map()
	for (const [bottleNo, bottleRows] of grouped.entries()) {
		map.set(bottleNo, buildBottleFlowStateFromMovementRows(bottleRows))
	}
	return map
}

function normalizeBottleCurrentStatus(value) {
	const text = normalizeString(value).toLowerCase()
	if (['unknown', 'in_station', 'at_customer', 'lost', 'scrapped'].includes(text)) return text
	return ''
}

function shouldSyncBottleCurrentStatus(value) {
	const bottleNo = normalizeBottleNoForCreate(value)
	return Boolean(bottleNo && bottleNo !== '000' && !/^TRUCK-/.test(bottleNo))
}

async function fetchBottleDocsByBottleNos(bottleNos = []) {
	const normalizedNos = Array.from(
		new Set((bottleNos || []).map((item) => normalizeBottleNoForCreate(item)).filter((item) => shouldSyncBottleCurrentStatus(item)))
	)
	if (!normalizedNos.length) return []
	const out = []
	for (const chunk of sliceIntoChunks(normalizedNos, 200)) {
		const res = await bottles
			.where({ bottle_no: dbCmd.in(chunk) })
			.field({
				_id: true,
				bottle_no: true,
				status: true,
				current_customer_id: true,
				current_customer_name: true
			})
			.limit(chunk.length)
			.get()
		out.push(...(res.data || []))
	}
	return out
}

function buildExpectedBottleCurrentState(state = null) {
	if (!state) {
		return {
			status: 'unknown',
			current_customer_id: null,
			current_customer_name: ''
		}
	}
	if (state.has_pending_same_day_back_out) {
		return { skip_reason: 'pending_same_day_back_out' }
	}
	const lastType = normalizeMovementEventType(state.last_effective_type)
	const lastEvent = state.last_effective_event || null
	if (lastType === 'out') {
		return {
			status: 'at_customer',
			current_customer_id: normalizeString(lastEvent && lastEvent.customer_id) || null,
			current_customer_name: normalizeString(lastEvent && lastEvent.customer_name)
		}
	}
	if (lastType === 'back' || lastType === 'fill') {
		return {
			status: 'in_station',
			current_customer_id: null,
			current_customer_name: ''
		}
	}
	return {
		status: 'unknown',
		current_customer_id: null,
		current_customer_name: ''
	}
}

async function syncBottleCurrentStatusByBottleNos(bottleNos = []) {
	const targetDocs = await fetchBottleDocsByBottleNos(bottleNos)
	if (!targetDocs.length) {
		return { target_total: 0, updated_total: 0, skipped_pending_total: 0 }
	}
	const targetBottleNos = targetDocs.map((item) => normalizeBottleNoForCreate(item && item.bottle_no)).filter(Boolean)
	const movementRows = await fetchBottleMovementRowsByBottleNos(targetBottleNos)
	const stateMap = buildBottleFlowStateMap(movementRows, targetBottleNos)
	let updatedTotal = 0
	let skippedPendingTotal = 0
	for (const doc of targetDocs) {
		const bottleNo = normalizeBottleNoForCreate(doc && doc.bottle_no)
		if (!bottleNo) continue
		const expected = buildExpectedBottleCurrentState(stateMap.get(bottleNo) || null)
		if (expected.skip_reason === 'pending_same_day_back_out') {
			skippedPendingTotal += 1
			continue
		}
		const nextStatus = normalizeBottleCurrentStatus(expected && expected.status) || 'unknown'
		const nextCustomerId = normalizeString(expected && expected.current_customer_id) || null
		const nextCustomerName = normalizeString(expected && expected.current_customer_name)
		const currentStatus = normalizeBottleCurrentStatus(doc && doc.status) || 'unknown'
		const currentCustomerId = normalizeString(doc && doc.current_customer_id) || null
		const currentCustomerName = normalizeString(doc && doc.current_customer_name)
		if (
			currentStatus === nextStatus &&
			currentCustomerId === nextCustomerId &&
			currentCustomerName === nextCustomerName
		) {
			continue
		}
		await bottles.doc(doc._id).update({
			status: nextStatus,
			current_customer_id: nextCustomerId,
			current_customer_name: nextCustomerName,
			updated_at: Date.now()
		})
		updatedTotal += 1
	}
	return {
		target_total: targetDocs.length,
		updated_total: updatedTotal,
		skipped_pending_total: skippedPendingTotal
	}
}

async function fetchCustomerNameMapByIds(customerIds = []) {
	const ids = uniqStrings((customerIds || []).map((item) => normalizeString(item))).filter(Boolean)
	const out = new Map()
	if (!ids.length) return out
	for (const chunk of sliceIntoChunks(ids, 200)) {
		const res = await customers
			.where({ _id: dbCmd.in(chunk) })
			.field({ _id: true, name: true })
			.limit(chunk.length)
			.get()
		;(res.data || []).forEach((row) => {
			const id = normalizeString(row && row._id)
			if (!id) return
			out.set(id, normalizeString(row && row.name))
		})
	}
	return out
}

async function reconcileBottleCurrentCustomerByDepositSnapshot({ customerIds = [], bottleNos = [] } = {}) {
	const normalizedCustomerIds = uniqStrings((customerIds || []).map((item) => normalizeString(item))).filter(Boolean)
	const normalizedCustomerIdSet = new Set(normalizedCustomerIds)
	const normalizedBottleNos = uniqStrings((bottleNos || []).map((item) => normalizeBottleNoForCreate(item))).filter((item) =>
		shouldSyncBottleCurrentStatus(item)
	)
	if (!normalizedCustomerIds.length || !normalizedBottleNos.length) {
		return {
			target_customer_total: normalizedCustomerIds.length,
			target_bottle_total: normalizedBottleNos.length,
			updated_total: 0,
			forced_customer_total: 0,
			cleared_customer_total: 0,
			conflict_total: 0
		}
	}

	const [customerNameMap, bottleDocs] = await Promise.all([
		fetchCustomerNameMapByIds(normalizedCustomerIds),
		fetchBottleDocsByBottleNos(normalizedBottleNos)
	])
	const bottleDocMap = new Map()
	bottleDocs.forEach((doc) => {
		const no = normalizeBottleNoForCreate(doc && doc.bottle_no)
		if (!no) return
		bottleDocMap.set(no, { ...doc })
	})

	const expectedOwnerMap = new Map()
	for (const customerId of normalizedCustomerIds) {
		const saleRows = await fetchCustomerDepositSaleRows(customerId, '', '')
		const depositSet = buildCustomerDepositBottleSet(saleRows)
		normalizedBottleNos.forEach((bottleNo) => {
			if (!depositSet.has(bottleNo)) return
			if (!expectedOwnerMap.has(bottleNo)) expectedOwnerMap.set(bottleNo, new Set())
			expectedOwnerMap.get(bottleNo).add(customerId)
		})
	}

	let updatedTotal = 0
	let forcedCustomerTotal = 0
	let clearedCustomerTotal = 0
	let conflictTotal = 0
	for (const bottleNo of normalizedBottleNos) {
		const doc = bottleDocMap.get(bottleNo)
		if (!doc || !doc._id) continue
		const owners = Array.from(expectedOwnerMap.get(bottleNo) || [])
		const currentCustomerId = normalizeString(doc && doc.current_customer_id) || null
		const currentCustomerName = normalizeString(doc && doc.current_customer_name)
		const currentStatus = normalizeBottleCurrentStatus(doc && doc.status) || 'unknown'

		if (owners.length > 1) {
			conflictTotal += 1
			continue
		}

		if (owners.length === 1) {
			const ownerId = owners[0]
			const ownerName = normalizeString(customerNameMap.get(ownerId))
			if (currentCustomerId === ownerId && currentStatus === 'at_customer' && currentCustomerName === ownerName) {
				continue
			}
			await bottles.doc(doc._id).update({
				status: 'at_customer',
				current_customer_id: ownerId,
				current_customer_name: ownerName,
				updated_at: Date.now()
			})
			updatedTotal += 1
			forcedCustomerTotal += 1
			continue
		}

		if (currentCustomerId && normalizedCustomerIdSet.has(currentCustomerId)) {
			const nextStatus = currentStatus === 'at_customer' ? 'unknown' : currentStatus || 'unknown'
			await bottles.doc(doc._id).update({
				status: nextStatus,
				current_customer_id: null,
				current_customer_name: '',
				updated_at: Date.now()
			})
			updatedTotal += 1
			clearedCustomerTotal += 1
		}
	}

	return {
		target_customer_total: normalizedCustomerIds.length,
		target_bottle_total: normalizedBottleNos.length,
		updated_total: updatedTotal,
		forced_customer_total: forcedCustomerTotal,
		cleared_customer_total: clearedCustomerTotal,
		conflict_total: conflictTotal
	}
}

function getBottleFlowActualCustomerName(state) {
	if (!state || !state.last_effective_event) return ''
	if (normalizeMovementEventType(state.last_effective_type) !== 'out') return ''
	return normalizeString(state.last_effective_event.customer_name)
}

function buildBackBottleFlowWarningReason(date, state) {
	const actualCustomerName = getBottleFlowActualCustomerName(state)
	let text = `该瓶不在当前客户截至${date}的应持有瓶清单中`
	if (actualCustomerName) text += `，最近出瓶客户为"${actualCustomerName}"`
	return text
}

function buildOutBottleFlowWarningReason(date, state) {
	const actualCustomerName = getBottleFlowActualCustomerName(state)
	let text = `该瓶截至${date}最近状态仍为出瓶，尚未回瓶`
	if (actualCustomerName) text += `，最近出瓶客户为"${actualCustomerName}"`
	return text
}

function buildBottleFlowWarningSummaryText(warningItems = []) {
	const total = Array.isArray(warningItems) ? warningItems.length : 0
	if (!total) return ''
	const backCount = warningItems.filter((item) => normalizeString(item && item.direction) === 'back').length
	const outCount = warningItems.filter((item) => normalizeString(item && item.direction) === 'out').length
	return `发现 ${total} 条瓶流转预警：回瓶 ${backCount} 条，出瓶 ${outCount} 条。`
}

function buildBottleFlowWarningResponse(warningItems = []) {
	const summaryText = buildBottleFlowWarningSummaryText(warningItems)
	return {
		code: 409,
		msg: summaryText || '请核对瓶号后再提交',
		data: {
			confirmable: true,
			warning_kind: BOTTLE_FLOW_WARNING_KIND,
			warning_items: warningItems,
			summary_text: summaryText
		}
	}
}

async function collectSaleBottleFlowWarnings({
	date,
	customerId,
	outRows = [],
	backRows = [],
	excludeSaleId = ''
} = {}) {
	const targetDate = normalizeString(date)
	const resolvedCustomerId = normalizeString(customerId)
	const backNos = collectBottleNosFromRows(backRows)
	const outNos = collectBottleNosFromRows(outRows)
	const targetBottleNos = Array.from(new Set([...backNos, ...outNos]))
	if (!targetDate || !resolvedCustomerId || !targetBottleNos.length) return []

	const [depositRows, movementRows] = await Promise.all([
		fetchCustomerDepositSaleRows(resolvedCustomerId, targetDate, excludeSaleId),
		fetchBottleMovementRowsByBottleNos(targetBottleNos, { dateEnd: targetDate, excludeSaleId })
	])
	const depositSet = buildCustomerDepositBottleSet(depositRows)
	const stateMap = buildBottleFlowStateMap(movementRows, targetBottleNos)
	const warningItems = []

	backNos.forEach((bottleNo) => {
		if (depositSet.has(bottleNo)) return
		const state = stateMap.get(bottleNo) || null
		warningItems.push({
			bottle_no: bottleNo,
			direction: 'back',
			reason: buildBackBottleFlowWarningReason(targetDate, state),
			actual_customer_name: getBottleFlowActualCustomerName(state) || ''
		})
	})

	outNos.forEach((bottleNo) => {
		const state = stateMap.get(bottleNo) || null
		if (!state) return
		if (state.has_pending_same_day_back_out) return
		if (normalizeMovementEventType(state.last_effective_type) !== 'out') return
		warningItems.push({
			bottle_no: bottleNo,
			direction: 'out',
			reason: buildOutBottleFlowWarningReason(targetDate, state),
			actual_customer_name: getBottleFlowActualCustomerName(state) || ''
		})
	})

	return warningItems
}

async function getCustomerById(customerId) {
	const id = normalizeString(customerId)
	if (!id) return null
	const res = await customers.doc(id).get()
	return (res.data && res.data[0]) || null
}

function inferBizMode(base, outRows, backRows, agentRows) {
	const bizMode = normalizeString(base.bizMode)
	if (bizMode === 'bottle' || bizMode === 'truck' || bizMode === 'agent_sale') return bizMode
	if (agentRows.length > 0) return 'agent_sale'
	if (normalizeString(base.truckNo)) return 'truck'
	if (outRows.length > 0 || backRows.length > 0) return 'bottle'
	return ''
}

function normalizeBizModeValue(value) {
	const text = normalizeString(value)
	if (text === 'truck' || text === 'agent_sale' || text === 'bottle') return text
	return 'bottle'
}

function normalizePaymentStatusValue(value) {
	const status = normalizePaymentStatus(value)
	if (status === 'paid' || status === 'partial' || status === 'unpaid') return status
	if (status === '已结清') return 'paid'
	if (status === '部分付') return 'partial'
	if (status === '未付款') return 'unpaid'
	return ''
}

function buildPaymentStatusWhere(value) {
	const text = normalizeString(value)
	if (!text) return null
	if (text === 'unsettled') {
		return dbCmd.or([
			{ payment_status: 'unpaid' },
			{ payment_status: '未付款' },
			{ payment_status: 'partial' },
			{ payment_status: '部分付' }
		])
	}
	const status = normalizePaymentStatusValue(text)
	if (!status) return null
	if (status === 'paid') return dbCmd.or([{ payment_status: 'paid' }, { payment_status: '已结清' }])
	if (status === 'partial') return dbCmd.or([{ payment_status: 'partial' }, { payment_status: '部分付' }])
	return dbCmd.or([{ payment_status: 'unpaid' }, { payment_status: '未付款' }])
}

function computeFlow(base, priceUnit) {
	let flowIndexPrev = toNumber(base.flow_index_prev, null)
	let flowIndexCurr = toNumber(base.flow_index_curr, null)
	let flowVolumeM3 = toNumber(base.flow_volume_m3, null)
	const flowTheoryRatio = toNumber(base.flow_theory_ratio, null)

	if (flowVolumeM3 == null && flowIndexPrev != null && flowIndexCurr != null) {
		const diff = flowIndexCurr - flowIndexPrev
		flowVolumeM3 = diff >= 0 ? diff : 0
	}

	if (priceUnit !== 'm3') {
		flowIndexPrev = null
		flowIndexCurr = null
		flowVolumeM3 = null
	}

	return {
		flow_index_prev: flowIndexPrev,
		flow_index_curr: flowIndexCurr,
		flow_volume_m3: flowVolumeM3,
		flow_theory_ratio: flowTheoryRatio
	}
}

function resolveTruckReferenceNetValue(rawTruckGrossDiff, rawTruckOutGross, rawTruckBackGross) {
	const outGross = rawTruckOutGross === '' || rawTruckOutGross == null ? null : toNumber(rawTruckOutGross, null)
	const backGross = rawTruckBackGross === '' || rawTruckBackGross == null ? null : toNumber(rawTruckBackGross, null)
	if (outGross != null && backGross != null) {
		return Math.max(outGross - backGross, 0)
	}
	const grossDiff = rawTruckGrossDiff === '' || rawTruckGrossDiff == null ? null : toNumber(rawTruckGrossDiff, null)
	if (grossDiff != null && Number.isFinite(grossDiff) && grossDiff > 0) return grossDiff
	return 0
}

function resolveTruckSettlementNetValue(rawTruckSaleNet, rawTruckSettleTare, rawTruckSettleGross) {
	const settleTare = rawTruckSettleTare === '' || rawTruckSettleTare == null ? null : toNumber(rawTruckSettleTare, null)
	const settleGross = rawTruckSettleGross === '' || rawTruckSettleGross == null ? null : toNumber(rawTruckSettleGross, null)
	if (settleTare != null && settleGross != null) {
		return Math.max(settleGross - settleTare, 0)
	}
	const explicit = rawTruckSaleNet === '' || rawTruckSaleNet == null ? null : toNumber(rawTruckSaleNet, null)
	if (explicit != null && Number.isFinite(explicit) && explicit > 0) return explicit
	return 0
}

function resolveTruckBillableNetValue({
	priceUnit = 'kg',
	rawTruckGrossDiff = null,
	rawTruckSaleNet = null,
	rawTruckOutGross = null,
	rawTruckBackGross = null,
	rawTruckSettleTare = null,
	rawTruckSettleGross = null
} = {}) {
	const referenceNet = resolveTruckReferenceNetValue(rawTruckGrossDiff, rawTruckOutGross, rawTruckBackGross)
	if (normalizeString(priceUnit) === 'kg') {
		const settlementNet = resolveTruckSettlementNetValue(rawTruckSaleNet, rawTruckSettleTare, rawTruckSettleGross)
		if (settlementNet > 0) return settlementNet
	}
	return referenceNet
}

function resolveTruckSaleNetValue(rawTruckGrossDiff, rawTruckSaleNet, rawTruckOutGross, rawTruckBackGross) {
	const referenceNet = resolveTruckReferenceNetValue(rawTruckGrossDiff, rawTruckOutGross, rawTruckBackGross)
	if (referenceNet > 0) return referenceNet
	const explicit = rawTruckSaleNet === '' || rawTruckSaleNet == null ? null : toNumber(rawTruckSaleNet, null)
	if (explicit != null && Number.isFinite(explicit) && explicit > 0) return explicit
	return 0
}

function computeAmounts({
	settlementMode = 'sale',
	bizMode,
	priceUnit,
	unitPrice,
	outItems,
	backItems,
	agentRows,
	truckSaleNet,
	truckOutGross,
	truckBackGross,
	truckSettleTare,
	truckSettleGross,
	flow,
	roundingAmount
}) {
	let outNetTotal = outItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	let backNetTotal = backItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	const agentTotalWeight = agentRows.reduce((sum, row) => sum + toNumber(row.fill_weight, 0), 0)

	let totalNetWeight = outNetTotal - backNetTotal
	if (bizMode === 'truck') {
		totalNetWeight = resolveTruckBillableNetValue({
			priceUnit,
			rawTruckGrossDiff: null,
			rawTruckSaleNet: truckSaleNet,
			rawTruckOutGross: truckOutGross,
			rawTruckBackGross: truckBackGross,
			rawTruckSettleTare: truckSettleTare,
			rawTruckSettleGross: truckSettleGross
		})
	} else if (bizMode === 'agent_sale') {
		outNetTotal = agentTotalWeight
		backNetTotal = 0
		totalNetWeight = agentTotalWeight
	}

	let outAmount = 0
	let backAmount = 0
	let shouldReceive = 0

	if (normalizeSettlementMode(settlementMode) === 'customer_flow') {
		return {
			out_net_total: outNetTotal,
			back_net_total: backNetTotal,
			total_net_weight: totalNetWeight,
			out_amount: 0,
			back_amount: 0,
			rounding_amount: 0,
			effective_should_receive: 0,
			should_receive: 0,
			amount: 0
		}
	}

	if (bizMode === 'agent_sale') {
		outAmount = agentTotalWeight * unitPrice
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
	const effectiveShouldReceive = resolveEffectiveShouldReceive(shouldReceive, rounding)

	return {
		out_net_total: outNetTotal,
		back_net_total: backNetTotal,
		total_net_weight: totalNetWeight,
		out_amount: fix2(outAmount),
		back_amount: fix2(backAmount),
		rounding_amount: fix2(rounding),
		effective_should_receive: fix2(effectiveShouldReceive),
		should_receive: fix2(shouldReceive),
		amount: fix2(shouldReceive)
	}
}

function resolveSaleGasMovementKind(bizMode) {
	const normalized = normalizeString(bizMode).toLowerCase()
	if (normalized === 'agent_sale') return 'sale_agent_sale'
	if (normalized === 'truck') return 'sale_truck'
	return 'sale_bottle'
}

function sumWeights(rows = [], key = 'net') {
	return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (toNumber(row && row[key], 0) || 0), 0)
}

function resolveSaleInventoryKg({ bizMode, saleDoc, amounts }) {
	const normalized = normalizeString(bizMode).toLowerCase() || 'bottle'
	if (normalized === 'agent_sale') return sumWeights(saleDoc && saleDoc.agent_sale_items, 'fill_weight')
	if (normalized === 'truck') {
		const truckReferenceNet = resolveTruckReferenceNetValue(
			saleDoc && saleDoc.truck_gross_diff,
			saleDoc && saleDoc.truck_out_gross,
			saleDoc && saleDoc.truck_back_gross
		)
		if (truckReferenceNet > 0) return truckReferenceNet
		const truckSaleNet = resolveTruckBillableNetValue({
			priceUnit: normalizeString(saleDoc && saleDoc.price_unit) || 'kg',
			rawTruckGrossDiff: saleDoc && saleDoc.truck_gross_diff,
			rawTruckSaleNet: saleDoc && saleDoc.truck_sale_net,
			rawTruckOutGross: saleDoc && saleDoc.truck_out_gross,
			rawTruckBackGross: saleDoc && saleDoc.truck_back_gross,
			rawTruckSettleTare: saleDoc && saleDoc.truck_settle_tare,
			rawTruckSettleGross: saleDoc && saleDoc.truck_settle_gross
		})
		if (truckSaleNet > 0) return truckSaleNet
		const outNet = sumWeights(saleDoc && saleDoc.out_items, 'net')
		if (outNet > 0) return outNet
		const fallback = toNumber(amounts && amounts.total_net_weight, 0) || 0
		return fallback
	}
	const outNetTotal = toNumber(amounts && amounts.out_net_total, null)
	const backNetTotal = toNumber(amounts && amounts.back_net_total, null)
	if (outNetTotal != null && backNetTotal != null) return outNetTotal - backNetTotal
	return sumWeights(saleDoc && saleDoc.out_items, 'net') - sumWeights(saleDoc && saleDoc.back_items, 'net')
}

function buildSaleGasMovementPayload({ sourceId, saleDoc, bizMode, amounts, now = Date.now(), user = null }) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return null
	const normalizedBizMode = normalizeString(bizMode).toLowerCase() || 'bottle'
	const saleKg = resolveSaleInventoryKg({ bizMode: normalizedBizMode, saleDoc, amounts })
	const qT = kgToTon(saleKg)
	if (!(typeof qT === 'number' && Number.isFinite(qT) && qT !== 0)) return null
	const movementKind = resolveSaleGasMovementKind(normalizedBizMode)
	const note = normalizeString(saleDoc && saleDoc.remark)
	const hasTruckSettlementBasis =
		normalizedBizMode === 'truck'
			&& (
				(saleDoc && saleDoc.truck_settle_tare != null)
				|| (saleDoc && saleDoc.truck_settle_gross != null)
				|| (saleDoc && saleDoc.truck_loss_kg != null)
			)
	const truckReferenceNet =
		normalizedBizMode === 'truck'
			? resolveTruckReferenceNetValue(
				saleDoc && saleDoc.truck_gross_diff,
				saleDoc && saleDoc.truck_out_gross,
				saleDoc && saleDoc.truck_back_gross
			)
			: 0
	const truckSettlementNet =
		normalizedBizMode === 'truck' && hasTruckSettlementBasis
			? resolveTruckSettlementNetValue(
				saleDoc && saleDoc.truck_sale_net,
				saleDoc && saleDoc.truck_settle_tare,
				saleDoc && saleDoc.truck_settle_gross
			)
			: 0
	const truckNetDiffKg = normalizedBizMode === 'truck' && hasTruckSettlementBasis ? fix2(truckSettlementNet - truckReferenceNet) : 0
	const truckLossKg = normalizedBizMode === 'truck' && hasTruckSettlementBasis ? fix2(Math.max(truckReferenceNet - truckSettlementNet, 0)) : 0
	const movementNote = truckLossKg > 0 ? `${note ? `${note}；` : ''}净重误差计损耗 ${truckLossKg}kg` : note
	const truckDiffKg =
		normalizedBizMode === 'truck'
			? truckNetDiffKg
			: 0

	return {
		event_day: normalizeEventDay(saleDoc && saleDoc.date, now),
		event_at: parseEventAt(saleDoc && saleDoc.date, now),
		source_type: 'sale',
		source_id: normalizedSourceId,
		movement_kind: movementKind,
		asset_delta_t: roundTon(-qT),
		station_delta_t: 0,
		in_bottle_delta_t: normalizedBizMode === 'truck' ? 0 : roundTon(-qT),
		note: movementNote,
		meta: {
			biz_mode: normalizedBizMode,
			q_kg: roundTon(Number(saleKg) || 0),
			truck_diff_kg: truckDiffKg,
			truck_reference_kg: normalizedBizMode === 'truck' ? fix2(truckReferenceNet) : 0,
			truck_settlement_kg: normalizedBizMode === 'truck' ? fix2(truckSettlementNet) : 0,
			truck_loss_kg: normalizedBizMode === 'truck' ? truckLossKg : 0,
			inventory_scope: normalizedBizMode === 'truck' ? 'truck' : 'bottle'
		},
		created_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}
}

async function replaceSaleGasInventoryMovement({ sourceId, saleDoc, bizMode, amounts, now = Date.now(), user = null }) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return
	await gasInventoryMovements.where({ source_type: 'sale', source_id: normalizedSourceId }).remove()
	const payload = buildSaleGasMovementPayload({
		sourceId: normalizedSourceId,
		saleDoc,
		bizMode,
		amounts,
		now,
		user
	})
	if (!payload) return
	await gasInventoryMovements.add(payload)
}

async function removeSaleGasInventoryMovement(sourceId) {
	const normalizedSourceId = normalizeString(sourceId)
	if (!normalizedSourceId) return
	await gasInventoryMovements.where({ source_type: 'sale', source_id: normalizedSourceId }).remove()
}

function isMissingCollectionError(err) {
	const msg = normalizeString(err && (err.message || err.errMsg || err.errDetail || ''))
	return /not found collection/i.test(msg)
}

function normalizePaymentStatus(value) {
	const text = normalizeString(value)
	if (!text) return 'unpaid'
	if (text === '已结清' || text === 'paid') return 'paid'
	if (text === '部分付' || text === 'partial') return 'partial'
	if (text === '未付款' || text === 'unpaid' || text === '挂账') return 'unpaid'
	return text
}

function normalizeSettlementMode(value, fallback = 'sale') {
	const text = normalizeString(value)
	if (text === 'customer_flow' || text === 'sale') return text
	return fallback
}

function normalizeYmdDate(value, fallback = '') {
	const text = normalizeString(value)
	if (!text) return fallback
	const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (match) return match[0]
	const parsed = Date.parse(text)
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback
	const d = new Date(parsed)
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthStartOf(dateText, fallback = '') {
	const normalized = normalizeYmdDate(dateText, '')
	if (!normalized) return fallback
	return `${normalized.slice(0, 7)}-01`
}

function normalizePaymentMethod(value, paymentStatus = 'unpaid') {
	const status = normalizePaymentStatus(paymentStatus)
	if (status === 'unpaid') return 'on_account'
	const text = normalizeString(value).toLowerCase()
	if (text === 'cash' || text === '现金') return 'cash'
	if (text === 'bank' || text === '银行' || text === '转账' || text === '银行转账') return 'bank'
	if (text === 'wechat' || text === '微信') return 'wechat'
	if (text === 'alipay' || text === '支付宝') return 'alipay'
	if (text === 'check' || text === 'cheque' || text === '支票') return 'check'
	if (text === 'on_account' || text === '挂账') return 'cash'
	return 'cash'
}

function nearlyEqual(a, b, eps = 0.01) {
	return Math.abs(a - b) < eps
}

function resolveEffectiveShouldReceive(shouldReceive, roundingAmount) {
	const should = fix2(toNumber(shouldReceive, 0))
	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	if (should > 0) return fix2(should - rounding)
	if (should < 0) return fix2(should + rounding)
	return 0
}

function computeSettlementOutstanding(shouldReceive, amountReceived, roundingAmount) {
	const effectiveShould = resolveEffectiveShouldReceive(shouldReceive, roundingAmount)
	const received = fix2(toNumber(amountReceived, 0))
	return fix2(effectiveShould - received)
}

function validateSettlement({ shouldReceive, paymentStatus, paymentMethod, amountReceived, roundingAmount }) {
	const should = fix2(toNumber(shouldReceive, 0))
	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	const effectiveShould = resolveEffectiveShouldReceive(should, rounding)

	if (rounding < 0) return { ok: false, msg: '抹零金额不能为负数' }
	if (Math.abs(rounding) > Math.abs(should || 0)) return { ok: false, msg: '抹零金额不能超过应收/应退金额' }

	const received = toNumber(amountReceived, 0)
	const status = normalizePaymentStatus(paymentStatus)
	const method = normalizePaymentMethod(paymentMethod, status)
	if (status === 'unpaid' && method !== 'on_account') return { ok: false, msg: '未付款状态必须选择挂账' }
	if (status !== 'unpaid' && method === 'on_account' && !nearlyEqual(received, 0)) {
		return { ok: false, msg: '已收款场景不能选择挂账' }
	}
	if (should < 0 && received > 0) return { ok: false, msg: '退款场景实收需为负数' }

	if (status === 'unpaid') {
		if (!nearlyEqual(received, 0)) return { ok: false, msg: '结算金额与付款状态不一致' }
	} else if (status === 'partial') {
		if (effectiveShould > 0) {
			if (!(received > 0 && received < effectiveShould)) return { ok: false, msg: '结算金额与付款状态不一致' }
		} else if (effectiveShould < 0) {
			if (!(received < 0 && received > effectiveShould)) return { ok: false, msg: '结算金额与付款状态不一致' }
		} else {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
	} else if (status === 'paid') {
		if (effectiveShould > 0 && received < 0 && !nearlyEqual(received, 0)) {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
		if (effectiveShould < 0 && received < effectiveShould && !nearlyEqual(received, effectiveShould)) {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
		if (effectiveShould === 0 && !nearlyEqual(received, 0)) return { ok: false, msg: '结算金额与付款状态不一致' }
	}

	return { ok: true }
}

const RECEIVABLE_ACCOUNT = { code: '1122', name: '应收账款' }
const REVENUE_ACCOUNT = { code: '6001', name: '主营业务收入' }
const CASH_ACCOUNT = { code: '1001', name: '库存现金' }
const BANK_ACCOUNT = { code: '1002', name: '银行存款' }
const WECHAT_ACCOUNT = { code: '1002-WECHAT', name: '银行存款-微信' }
const ALIPAY_ACCOUNT = { code: '1002-ALIPAY', name: '银行存款-支付宝' }
const CHECK_ACCOUNT = { code: '1002-CHECK', name: '银行存款-支票' }

function resolvePaymentAccount(paymentMethod) {
	const text = normalizeString(paymentMethod).toLowerCase()
	if (!text || text === 'on_account' || text === '挂账') return null
	if (text === 'cash' || text === '现金') return CASH_ACCOUNT
	if (text === 'bank' || text === '银行' || text === '转账' || text === '银行转账') return BANK_ACCOUNT
	if (text === 'wechat' || text === '微信') return WECHAT_ACCOUNT
	if (text === 'alipay' || text === '支付宝') return ALIPAY_ACCOUNT
	if (text === 'check' || text === 'cheque' || text === '支票') return CHECK_ACCOUNT
	return null
}

function normalizePeriod(date) {
	const value = normalizeString(date)
	const parts = value.split('-')
	if (parts.length < 2) return ''
	return `${parts[0]}-${parts[1]}`
}

function generateVoucherNo(date) {
	const day = String(date || '').replace(/-/g, '')
	const suffix = String(Date.now() % 100000).padStart(5, '0')
	return `V-${day || '00000000'}-${suffix}`
}

function buildSaleVoucherEntries(saleDoc, shouldReceive, amountReceived) {
	const summary = normalizeString(saleDoc.customer_name) + ' 销售收入'
	const receivedRaw = toNumber(amountReceived, 0)
	const total = fix2(shouldReceive)
	if (total === 0) return []

	const paymentAccount = resolvePaymentAccount(saleDoc && saleDoc.payment_method)

	if (total < 0) {
		const refundTotal = fix2(Math.abs(total))
		const refundPaid = paymentAccount && receivedRaw < 0
			? fix2(Math.min(Math.abs(receivedRaw), refundTotal))
			: 0
		const refundRemain = fix2(refundTotal - refundPaid)
		const entries = []

		if (refundPaid > 0 && paymentAccount) {
			entries.push({
				account_code: paymentAccount.code,
				account_name: paymentAccount.name,
				direction: 'credit',
				amount: refundPaid,
				summary
			})
		}
		if (refundRemain > 0) {
			entries.push({
				account_code: RECEIVABLE_ACCOUNT.code,
				account_name: RECEIVABLE_ACCOUNT.name,
				direction: 'credit',
				amount: refundRemain,
				summary
			})
		}
		entries.push({
			account_code: REVENUE_ACCOUNT.code,
			account_name: REVENUE_ACCOUNT.name,
			direction: 'debit',
			amount: refundTotal,
			summary
		})
		return entries
	}

	let received = fix2(Math.min(receivedRaw, total))
	let receivable = fix2(total - received)
	if (!paymentAccount) {
		received = 0
		receivable = total
	}

	const entries = []
	if (received > 0 && paymentAccount) {
		entries.push({
			account_code: paymentAccount.code,
			account_name: paymentAccount.name,
			direction: 'debit',
			amount: received,
			summary
		})
	}
	if (receivable > 0) {
		entries.push({
			account_code: RECEIVABLE_ACCOUNT.code,
			account_name: RECEIVABLE_ACCOUNT.name,
			direction: 'debit',
			amount: receivable,
			summary
		})
	}
	entries.push({
		account_code: REVENUE_ACCOUNT.code,
		account_name: REVENUE_ACCOUNT.name,
		direction: 'credit',
		amount: total,
		summary
	})
	return entries
}

async function syncSaleVoucher(user, saleDoc, amounts, requestId) {
	const shouldReceive = resolveEffectiveShouldReceive(
		toNumber(amounts.should_receive, 0),
		toNumber(amounts.rounding_amount, 0)
	)
	if (!shouldReceive) return

	const entriesRows = buildSaleVoucherEntries(saleDoc, shouldReceive, saleDoc.amount_received)
	if (!entriesRows.length) return

	const totals = entriesRows.reduce(
		(acc, row) => {
			if (row.direction === 'debit') acc.debit += row.amount
			else acc.credit += row.amount
			return acc
		},
		{ debit: 0, credit: 0 }
	)

	const period = normalizePeriod(saleDoc.date)
	const source = `sale:${saleDoc._id}`
	const now = Date.now()
	const summary = normalizeString(saleDoc.customer_name) + ' 销售收入'

	const existRes = await vouchers.where({ source }).limit(1).get()
	const exist = (existRes.data && existRes.data[0]) || null
	if (exist && exist.status === 'posted') return

	const voucherNo = exist?.voucher_no || generateVoucherNo(saleDoc.date)
	const header = {
		date: saleDoc.date,
		period,
		voucher_no: voucherNo,
		summary,
		status: 'draft',
		total_debit: fix2(totals.debit),
		total_credit: fix2(totals.credit),
		created_at: exist?.created_at || now,
		created_by: exist?.created_by || user?._id || null,
		created_by_name: exist?.created_by_name || user?.username || '',
		updated_at: now,
		posted_at: null,
		posted_by: null,
		posted_by_name: '',
		source
	}

	let voucherId = exist?._id || null
	if (voucherId) {
		await vouchers.doc(voucherId).update(header)
		await voucherEntries.where({ voucher_id: voucherId }).remove()
	} else {
		const res = await vouchers.add(header)
		voucherId = res.id
	}

	const entryDocs = entriesRows.map((row) => ({
		voucher_id: voucherId,
		voucher_no: voucherNo,
		date: saleDoc.date,
		period,
		account_code: row.account_code,
		account_name: row.account_name,
		direction: row.direction,
		amount: row.amount,
		summary: row.summary,
		aux: {
			customer_id: saleDoc.customer_id || null,
			customer_name: saleDoc.customer_name || '',
			source_type: 'sale',
			source_id: saleDoc._id
		},
		created_at: now
	}))

	if (entryDocs.length) await voucherEntries.add(entryDocs)
	await recordLog(user, 'sale_voucher_sync_v1', { sale_id: saleDoc._id, voucher_id: voucherId }, requestId)
}

async function triggerAnomalyTouchV2(user, token, bottleNosOrPayload, requestId) {
	const payload =
		Array.isArray(bottleNosOrPayload) || bottleNosOrPayload == null
			? { bottleNos: bottleNosOrPayload || [], truckNos: [] }
			: bottleNosOrPayload
	const normalizedBottleNos = Array.from(
		new Set(
			(payload.bottleNos || [])
				.map((item) => normalizeBottleNoForCreate(item))
				.filter(Boolean)
		)
	)
	const normalizedTruckNos = Array.from(
		new Set(
			(payload.truckNos || [])
				.map((item) => normalizeBottleNoForCreate(item))
				.filter(Boolean)
		)
	)
	if (!normalizedBottleNos.length && !normalizedTruckNos.length) return { ok: true, warning: '' }

	try {
		const res = await uniCloud.callFunction({
			name: 'crm-bottle-anomaly',
			data: {
				action: 'touchV2',
				token,
				request_id: requestId,
				data: {
					bottle_nos: normalizedBottleNos,
					truck_nos: normalizedTruckNos,
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
			'sale_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedBottleNos, truck_nos: normalizedTruckNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	} catch (err) {
		const warning = normalizeString(err && err.message) || '异常增量扫描触发失败'
		await recordLog(
			user,
			'sale_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedBottleNos, truck_nos: normalizedTruckNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	}
}

async function callCustomerSettlement(action, data, token, requestId) {
	try {
		const res = await uniCloud.callFunction({
			name: 'crm-customer-settlement',
			data: {
				action,
				token,
				request_id: requestId,
				data: data || {}
			}
		})
		return res && res.result ? res.result : {}
	} catch (err) {
		return {
			code: 500,
			msg: normalizeString(err && err.message) || '客户结算引擎调用失败'
		}
	}
}

async function syncOffsetCreditsByDates(customerId, dates = [], token, requestId) {
	const normalizedCustomerId = normalizeString(customerId)
	if (!normalizedCustomerId) return []
	const uniqueDates = Array.from(
		new Set(
			(Array.isArray(dates) ? dates : [])
				.map((item) => normalizeYmdDate(item, ''))
				.filter(Boolean)
		)
	)
	if (!uniqueDates.length) return []
	const sortedDates = uniqueDates.slice().sort()
	const dateFrom = sortedDates[0]
	const dateTo = sortedDates[sortedDates.length - 1]
	const res = await callCustomerSettlement(
		'repairOffsetCreditsV1',
		{
			customer_id: normalizedCustomerId,
			date_from: dateFrom,
			date_to: dateTo,
			execute: true,
			auto_apply: false
		},
		token,
		requestId
	)
	return [
		{
			date: dateFrom === dateTo ? dateFrom : `${dateFrom}~${dateTo}`,
			date_from: dateFrom,
			date_to: dateTo,
			code: toNumber(res && res.code, 500),
			msg: normalizeString(res && res.msg),
			total_sales: toNumber(res && res.data && res.data.total_sales, 0),
			unresolved_count: toNumber(res && res.data && res.data.unresolved_count, 0)
		}
	]
}

async function resyncSaleVoucherById(user, saleId, requestId) {
	const id = normalizeString(saleId)
	if (!id) return { code: 400, msg: 'sale_id 必填' }
	const saleRes = await sales.doc(id).get()
	const saleDoc = (saleRes.data && saleRes.data[0]) || null
	if (!saleDoc) return { code: 404, msg: '销售单不存在' }
	const { amounts } = computeSaleAmountsForDoc(saleDoc)
	await syncSaleVoucher(user, { ...saleDoc, _id: id }, amounts, requestId)
	return { code: 0, data: { sale_id: id } }
}

async function createV2(user, payload, requestId, token) {
	const base = payload.base || {}
	const outRows = normalizeBottleRows(payload.outRows || [])
	const backRows = normalizeBottleRows(payload.backRows || [])
	let depositRows = normalizeDepositRows(payload.depositRows || [])
	let agentRows = normalizeAgentRows(payload.agentSaleRows || [])
	const ignoreBottleFlowWarning = toBoolean(payload.ignore_bottle_flow_warning ?? payload.ignoreBottleFlowWarning, false)

	const date = normalizeString(base.date)
	if (!date) return { code: 400, msg: '日期必填' }

	const customerId = normalizeString(base.customerId)
	if (!customerId) return { code: 400, msg: '客户必选' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }
	const deliveryMan = joinDelivery(base.delivery1, base.delivery2)

	const bizMode = inferBizMode(base, outRows, backRows, agentRows)
	const customerPriceUnit = normalizeString(customer && customer.default_price_unit)
	const priceUnit = normalizeString(base.priceUnit) || customerPriceUnit || 'kg'
	const settlementMode = priceUnit === 'm3' ? 'customer_flow' : normalizeSettlementMode(base.settlementMode, 'sale')
	const unitPrice = toNumber(base.unitPrice, 0)

	const truckNo = normalizeTruckNoForCreate(base.truckNo, base.carNo)
	const truckOutGross = toNumber(base.truckOutGross, 0)
	const truckBackGross = toNumber(base.truckBackGross, 0)
	const truckSettleTare = base.truckSettleTare === '' || base.truckSettleTare == null ? null : toNumber(base.truckSettleTare, null)
	const truckSettleGross = base.truckSettleGross === '' || base.truckSettleGross == null ? null : toNumber(base.truckSettleGross, null)
	const truckReferenceNet = resolveTruckReferenceNetValue(base.truckGrossDiff, base.truckOutGross, base.truckBackGross)
	const truckSettlementNet = resolveTruckSettlementNetValue(base.truckSaleNet, base.truckSettleTare, base.truckSettleGross)
	const truckNetDiffKg = priceUnit === 'kg' ? fix2(truckSettlementNet - truckReferenceNet) : 0
	const truckLossKg = priceUnit === 'kg' ? fix2(Math.max(truckReferenceNet - truckSettlementNet, 0)) : 0
	const truckSaleNet = resolveTruckBillableNetValue({
		priceUnit,
		rawTruckGrossDiff: base.truckGrossDiff,
		rawTruckSaleNet: base.truckSaleNet,
		rawTruckOutGross: base.truckOutGross,
		rawTruckBackGross: base.truckBackGross,
		rawTruckSettleTare: base.truckSettleTare,
		rawTruckSettleGross: base.truckSettleGross
	})

	if (!bizMode) return { code: 400, msg: '业务模式必选' }
	if (bizMode === 'agent_sale' && (!Array.isArray(agentRows) || agentRows.length === 0)) {
		return { code: 400, msg: '代理销售至少填写一行灌装明细' }
	}
	if (bizMode === 'agent_sale') {
		const bindRes = await bindAgentRowsWithLatestFill(agentRows, date)
		if (!bindRes.ok) return { code: 400, msg: bindRes.msg }
		agentRows = bindRes.rows
	}
	if (bizMode === 'truck') {
		if (!truckNo) return { code: 400, msg: '整车模式车牌必填' }
		if (!(Number.isFinite(truckReferenceNet) && truckReferenceNet > 0)) {
			return { code: 400, msg: '整车模式出厂毛重与回厂毛重差值必须大于0' }
		}
		if (priceUnit === 'kg' && !(Number.isFinite(truckSettlementNet) && truckSettlementNet > 0)) {
			return { code: 400, msg: '整车kg结算需填写车皮重与灌装后车毛重，且结算净重必须大于0' }
		}
	}

	const flowIndexPrev = priceUnit === 'm3' ? toNumber(base.flowIndexPrev, null) : null
	const flowIndexCurr = priceUnit === 'm3' ? toNumber(base.flowIndexCurr, null) : null
	const flowVolumeM3 = priceUnit === 'm3' ? toNumber(base.flowVolumeM3, null) : null
	const flowTheoryRatio = priceUnit === 'm3' ? toNumber(base.flowTheoryRatio, null) : null

	if (bizMode === 'bottle' && outRows.length === 0 && backRows.length === 0 && depositRows.length === 0) {
		return { code: 400, msg: '瓶装模式需填写出瓶/回瓶/存瓶' }
	}

	const bottleFlowWarnings = bizMode === 'bottle'
		? await collectSaleBottleFlowWarnings({
			date,
			customerId: customer._id,
			outRows,
			backRows
		})
		: []
	if (!ignoreBottleFlowWarning && bottleFlowWarnings.length > 0) {
		return buildBottleFlowWarningResponse(bottleFlowWarnings)
	}

	if (bizMode === 'bottle') {
		const ensureRes = await ensureBottlesExist({
			customerId: customer._id,
			customerName: customer.name,
			outRows,
			backRows,
			depositRows
		})
		if (!ensureRes.ok) return { code: 400, msg: ensureRes.msg }
	}

	const flowForCheck = computeFlow(
		{
			flow_index_prev: flowIndexPrev,
			flow_index_curr: flowIndexCurr,
			flow_volume_m3: flowVolumeM3,
			flow_theory_ratio: flowTheoryRatio
		},
		priceUnit
	)
	const amountsForCheck = computeAmounts({
		settlementMode,
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
			agentRows,
			truckSaleNet,
			truckOutGross,
			truckBackGross,
			truckSettleTare,
			truckSettleGross,
			flow: flowForCheck,
			roundingAmount: 0
		})
	const amountReceived = 0
	const effectiveShouldReceive = toNumber(amountsForCheck.effective_should_receive, 0)
	const applyOffsetCredit = false
	const offsetEnabled = false
	const paymentStatus = settlementMode === 'customer_flow'
		? 'paid'
		: (effectiveShouldReceive <= 0 ? 'paid' : 'unpaid')
	const paymentMethod = settlementMode === 'customer_flow'
		? 'on_account'
		: normalizePaymentMethod('', paymentStatus)
	const remarkMeta = deriveRemarkMeta(base.remark)
	const ticketImages = normalizeTicketImages(base.ticketImages, base.ticketImage)

	const doc = {
		date,
		customer_id: customer._id,
		customer_name: customer.name,
		delivery_man: deliveryMan,
		vehicle_id: normalizeString(base.vehicleId),
		car_no: normalizeString(base.carNo),
		biz_mode: bizMode,
		settlement_mode: settlementMode,
		unit_price: unitPrice,
		price_unit: priceUnit,
		remark: remarkMeta.remark,
		ticket_image: ticketImages[0] || null,
		ticket_images: ticketImages,
		remark_normalized: remarkMeta.remark_normalized,
		remark_tags: remarkMeta.remark_tags,
		system_note: remarkMeta.system_note,
		has_remark: remarkMeta.has_remark,
		payment_status: paymentStatus,
		payment_method: paymentMethod,
		amount_received: amountReceived,
		rounding_amount: 0,
		payment_note: '',
		apply_offset_credit: applyOffsetCredit,
		offset_enabled: offsetEnabled,
		created_at: Date.now(),
		created_by: user._id,
		source: normalizeString(payload.source || 'manual-v4'),
		updated_at: Date.now()
	}

	if (bizMode === 'truck') {
		doc.truck_no = truckNo
		doc.truck_out_gross = truckOutGross
		doc.truck_back_gross = truckBackGross
		doc.truck_gross_diff = truckReferenceNet
		doc.truck_sale_net = priceUnit === 'kg' ? truckSaleNet : null
		doc.truck_settle_tare = priceUnit === 'kg' ? truckSettleTare : null
		doc.truck_settle_gross = priceUnit === 'kg' ? truckSettleGross : null
		doc.truck_net_diff_kg = priceUnit === 'kg' ? truckNetDiffKg : null
		doc.truck_loss_kg = priceUnit === 'kg' ? truckLossKg : null
	} else if (bizMode === 'agent_sale') {
		doc.agent_sale_items = agentRows
	} else {
		doc.out_items = outRows
		doc.back_items = backRows
		doc.deposit_rows = depositRows
	}

	if (priceUnit === 'm3' && settlementMode !== 'customer_flow') {
		doc.flow_index_prev = flowIndexPrev
		doc.flow_index_curr = flowIndexCurr
		doc.flow_volume_m3 = flowVolumeM3
		doc.flow_theory_ratio = flowTheoryRatio
	} else {
		doc.flow_index_prev = null
		doc.flow_index_curr = null
		doc.flow_volume_m3 = null
		doc.flow_theory_ratio = null
	}

	const res = await sales.add(doc)
	const saleDoc = { ...doc, _id: res.id }
	await appendSaleMovementRecords(user, saleDoc, {
		bizMode,
		outRows,
		backRows,
		agentRows
	})
	const touchedBottleNos = collectSaleBottleNosFromDoc(saleDoc)
	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(touchedBottleNos)
	const bottleDepositReconcileRes = await reconcileBottleCurrentCustomerByDepositSnapshot({
		customerIds: collectSaleCustomerIdsFromDoc(saleDoc),
		bottleNos: touchedBottleNos
	})
	const flow = computeFlow(saleDoc, priceUnit)
	const amounts = computeAmounts({
		settlementMode,
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
			agentRows,
			truckSaleNet,
			truckOutGross,
			truckBackGross,
			truckSettleTare,
			truckSettleGross,
			flow,
			roundingAmount: toNumber(base.roundingAmount, 0)
		})
	const sideWarnings = []
	try {
		await replaceSaleGasInventoryMovement({
			sourceId: res.id,
			saleDoc,
			bizMode,
			amounts,
			now: Date.now(),
			user
		})
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('库存流水未同步（缺集合）')
		else throw err
	}
	try {
		await syncSaleVoucher(user, saleDoc, amounts, requestId)
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('凭证未同步（缺集合）')
		else throw err
	}
	if (settlementMode !== 'customer_flow') {
		const offsetSyncResults = await syncOffsetCreditsByDates(
			customer._id,
			[monthStartOf(date, ''), date],
			token,
			requestId
		)
		offsetSyncResults.forEach((row) => {
			if (row.code !== 0) sideWarnings.push(`冲抵款同步失败(${row.date})`)
			if (row.unresolved_count > 0) sideWarnings.push(`冲抵款存在未消化差额(${row.date})`)
		})
	}
	if (settlementMode !== 'customer_flow') {
		const prepayApplyRes = await callCustomerSettlement(
			'autoApplyPrepayToSaleV1',
			{
				sale_id: res.id,
				exclude_offset_credit: !applyOffsetCredit
			},
			token,
			requestId
		)
		if (prepayApplyRes.code !== 0) {
			sideWarnings.push(normalizeString(prepayApplyRes.msg) || '客户预付款抵扣未同步')
		} else if (toNumber(prepayApplyRes?.data?.applied_amount, 0) > 0) {
			try {
				await resyncSaleVoucherById(user, res.id, requestId)
			} catch (err) {
				if (isMissingCollectionError(err)) sideWarnings.push('预付款抵扣后凭证未同步（缺集合）')
				else throw err
			}
		}
	}
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: touchedBottleNos,
			truckNos: collectSaleTruckNosFromDoc(saleDoc)
		},
		requestId
	)
	await recordLog(
		user,
		'sale_create_v2',
		{
			id: res.id,
			biz_mode: bizMode,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			bottle_status_deposit_reconciled_total: bottleDepositReconcileRes.updated_total,
			bottle_status_deposit_forced_total: bottleDepositReconcileRes.forced_customer_total,
			bottle_status_deposit_cleared_total: bottleDepositReconcileRes.cleared_customer_total,
			bottle_status_deposit_conflict_total: bottleDepositReconcileRes.conflict_total,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length,
			bottle_flow_warning_bottles: bottleFlowWarnings.map((item) => `${item.direction}:${item.bottle_no}`),
			touch_warning: touchRes.warning || '',
			side_warnings: sideWarnings
		},
		requestId
	)
	const warningText = [...sideWarnings, touchRes.warning || ''].filter(Boolean).join('；')
	return {
		code: 0,
		msg: warningText ? `创建成功（${warningText}）` : '创建成功',
		data: {
			_id: res.id,
			warning: warningText,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length,
			bottle_status_deposit_reconciled_total: bottleDepositReconcileRes.updated_total
		}
	}
}

function buildSaleListWhere(data = {}) {
	const keyword = normalizeString(data.keyword)
	const priceUnit = normalizeString(data.priceUnit)
	const bizMode = normalizeString(data.bizMode)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const paymentStatus = normalizeString(data.paymentStatus)

	const conditions = []
	if (keyword) {
		const escaped = escapeRegExp(keyword)
		const rx = db.RegExp({ regexp: escaped, options: 'i' })
		const normalizedKeyword = normalizeRemarkComparableText(keyword)
		const normalizedRx = normalizedKeyword
			? db.RegExp({ regexp: escapeRegExp(normalizedKeyword), options: 'i' })
			: null
		const keywordConditions = [
			{ customer_name: rx },
			{ car_no: rx },
			{ remark: rx },
			{ system_note: rx }
		]
		if (normalizedRx) keywordConditions.push({ remark_normalized: normalizedRx })
		conditions.push(dbCmd.or(keywordConditions))
	}
	if (priceUnit) conditions.push({ price_unit: priceUnit })
	if (bizMode) conditions.push({ biz_mode: bizMode })
	if (dateStart) conditions.push({ date: dbCmd.gte(dateStart) })
	if (dateEnd) conditions.push({ date: dbCmd.lte(dateEnd) })
	const paymentStatusWhere = buildPaymentStatusWhere(paymentStatus)
	if (paymentStatusWhere) conditions.push(paymentStatusWhere)

	return conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)
}

function normalizeSettlementScope(value) {
	const text = normalizeString(value)
	if (text === 'receivable_outstanding') return text
	if (text === 'refund_outstanding') return text
	if (text === 'net_outstanding_non_zero') return text
	if (text === 'overpaid_or_prereceive') return text
	return ''
}

function resolveSalePaidTotalAmount(amountReceived = 0, receiptRoundingAmount = 0) {
	return fix2(toNumber(amountReceived, 0) + toNumber(receiptRoundingAmount, 0))
}

function matchSettlementScope(
	scope,
	shouldReceive,
	paidTotal,
	roundingAmount = 0,
	refundPending = null,
	netOutstandingEffective = null
) {
	if (!scope) return true
	const should = resolveEffectiveShouldReceive(toNumber(shouldReceive, 0), toNumber(roundingAmount, 0))
	const paid = toNumber(paidTotal, 0)
	const outstanding = fix2(should - paid)
	if (scope === 'receivable_outstanding') return should > 0 && outstanding > 0
	if (scope === 'refund_outstanding') {
		const pending = toNumber(refundPending, NaN)
		if (Number.isFinite(pending)) return pending > 0.01
		return should < 0 && outstanding < 0
	}
	if (scope === 'net_outstanding_non_zero') {
		const normalized = toNumber(netOutstandingEffective, NaN)
		if (Number.isFinite(normalized)) return Math.abs(normalized) >= 0.01
		return Math.abs(outstanding) >= 0.01
	}
	if (scope === 'overpaid_or_prereceive') {
		return should >= 0 && outstanding < -0.01
	}
	return true
}

function matchSaleListFilters(
	doc,
	{ settlementScope = '', hasRemark = '', remarkTag = '', refundPending = null, netOutstandingEffective = null } = {}
) {
	const { amounts } = computeSaleAmountsForDoc(doc)
	const shouldReceive = toNumber(amounts.should_receive, 0)
	const amountReceived = toNumber(doc && doc.amount_received, 0)
	const receiptRoundingAmount = toNumber(doc && doc.receipt_rounding_amount, 0)
	const paidTotal = resolveSalePaidTotalAmount(amountReceived, receiptRoundingAmount)
	if (!matchSettlementScope(
		settlementScope,
		shouldReceive,
		paidTotal,
		amounts.rounding_amount,
		refundPending,
		netOutstandingEffective
	)) return false
	if (!matchRemarkFilters(doc, { hasRemark, remarkTag })) return false
	return true
}

function buildSaleListRow(doc) {
	const withRemark = applyRemarkMetaToDoc(doc || {})
	const { amounts } = computeSaleAmountsForDoc(withRemark)
	return {
		...withRemark,
		out_net_total: amounts.out_net_total,
		back_net_total: amounts.back_net_total,
		total_net_weight: amounts.total_net_weight,
		out_amount: amounts.out_amount,
		back_amount: amounts.back_amount,
		effective_should_receive: amounts.effective_should_receive,
		rounding_amount: amounts.rounding_amount,
		should_receive: amounts.should_receive
	}
}

async function enrichSaleListRowsWithBottleStats(rows = []) {
	const source = Array.isArray(rows) ? rows : []
	if (!source.length) return []
	const enriched = source.map((row) => {
		const outItems = Array.isArray(row && row.out_items) ? row.out_items : []
		const backItems = Array.isArray(row && row.back_items) ? row.back_items : []
		const outBottleNos = collectBottleNosFromRows(outItems)
		const backBottleNos = collectBottleNosFromRows(backItems)
		return {
			...row,
			out_bottle_count: outBottleNos.length,
			back_bottle_count: backBottleNos.length,
			out_bottles_preview: outBottleNos.slice(0, 20),
			out_bottles_truncated: outBottleNos.length > 20,
			back_bottles_preview: backBottleNos.slice(0, 20),
			back_bottles_truncated: backBottleNos.length > 20,
			deposit_balance_count: 0,
			deposit_balance_bottles_preview: [],
			deposit_balance_bottles_truncated: false
		}
	})
	const customerMap = new Map()
	enriched.forEach((row, index) => {
		const customerId = normalizeString(row && row.customer_id)
		const date = normalizeString(row && row.date)
		if (!customerId || !date) return
		const current = customerMap.get(customerId) || { indexes: [], maxDate: '' }
		current.indexes.push(index)
		if (!current.maxDate || date > current.maxDate) current.maxDate = date
		customerMap.set(customerId, current)
	})
	await Promise.all(
		Array.from(customerMap.entries()).map(async ([customerId, meta]) => {
			try {
				const salesRows = await fetchCustomerDepositSaleRows(customerId, meta.maxDate, '')
				const snapshotMap = buildCustomerDepositBottleSnapshotMap(salesRows, 20)
				meta.indexes.forEach((index) => {
					const saleId = normalizeString(enriched[index] && enriched[index]._id)
					const snapshot = snapshotMap.get(saleId) || {
						count: 0,
						bottles_preview: [],
						bottles_truncated: false
					}
					enriched[index].deposit_balance_count = Number(snapshot.count || 0)
					enriched[index].deposit_balance_bottles_preview = Array.isArray(snapshot.bottles_preview)
						? snapshot.bottles_preview
						: []
					enriched[index].deposit_balance_bottles_truncated = Boolean(snapshot.bottles_truncated)
				})
			} catch (err) {
				console.error('[crm-sale] enrichSaleListRowsWithBottleStats failed', customerId, err && err.message)
			}
		})
	)
	return enriched
}

function computeSaleAmountsForDoc(doc) {
	const bizMode = normalizeBizModeValue(doc && doc.biz_mode)
	const priceUnit = normalizeString(doc && doc.price_unit) || 'kg'
	const settlementMode = priceUnit === 'm3' ? 'customer_flow' : normalizeSettlementMode(doc && doc.settlement_mode, 'sale')
	const unitPrice = toNumber(doc && doc.unit_price, 0)
	const outItems = Array.isArray(doc && doc.out_items) ? doc.out_items : []
	const backItems = Array.isArray(doc && doc.back_items) ? doc.back_items : []
	const agentRows = Array.isArray(doc && doc.agent_sale_items) ? doc.agent_sale_items : []
	const truckSaleNet = resolveTruckBillableNetValue({
		priceUnit,
		rawTruckGrossDiff: doc && doc.truck_gross_diff,
		rawTruckSaleNet: doc && doc.truck_sale_net,
		rawTruckOutGross: doc && doc.truck_out_gross,
		rawTruckBackGross: doc && doc.truck_back_gross,
		rawTruckSettleTare: doc && doc.truck_settle_tare,
		rawTruckSettleGross: doc && doc.truck_settle_gross
	})
	const flow = computeFlow(doc || {}, priceUnit)
	const amounts = computeAmounts({
		settlementMode,
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outItems,
		backItems: bizMode === 'agent_sale' ? [] : backItems,
		agentRows,
		truckSaleNet,
		truckOutGross: doc && doc.truck_out_gross,
		truckBackGross: doc && doc.truck_back_gross,
		truckSettleTare: doc && doc.truck_settle_tare,
		truckSettleGross: doc && doc.truck_settle_gross,
		flow,
		roundingAmount: toNumber(doc && doc.rounding_amount, 0)
	})
	return { bizMode, amounts }
}

function computeSaleBottleQuantity(doc) {
	const bizMode = normalizeBizModeValue(doc && doc.biz_mode)
	if (bizMode === 'agent_sale') return Array.isArray(doc && doc.agent_sale_items) ? doc.agent_sale_items.length : 0
	if (bizMode === 'bottle') return Array.isArray(doc && doc.out_items) ? doc.out_items.length : 0
	return 0
}

async function buildSaleOffsetPoolStatsMapBySaleIds(saleIds = []) {
	const normalizedIds = Array.from(
		new Set(
			(Array.isArray(saleIds) ? saleIds : [])
				.map((item) => normalizeString(item))
				.filter(Boolean)
		)
	)
	const result = new Map()
	if (!normalizedIds.length) return result
	for (const chunk of sliceIntoChunks(normalizedIds, 80)) {
		if (!Array.isArray(chunk) || !chunk.length) continue
		const where = dbCmd.and([
			{ status: 'posted' },
			{ source_type: dbCmd.in(['sale_offset_credit', 'sale_offset_credit_repair']) },
			{ source_id: dbCmd.in(chunk) }
		])
		const batchSize = 200
		let page = 1
		let guard = 0
		while (guard < 500) {
			const res = await customerReceipts
				.where(where)
				.field({
					source_id: true,
					amount: true,
					allocated_amount: true
				})
				.skip((page - 1) * batchSize)
				.limit(batchSize)
				.get()
			const rows = Array.isArray(res.data) ? res.data : []
			if (!rows.length) break
			rows.forEach((row) => {
				const saleId = normalizeString(row && row.source_id)
				if (!saleId) return
				const prev = result.get(saleId) || {
					entered_amount: 0,
					allocated_amount: 0
				}
				result.set(saleId, {
					entered_amount: fix2(toNumber(prev.entered_amount, 0) + toNumber(row && row.amount, 0)),
					allocated_amount: fix2(toNumber(prev.allocated_amount, 0) + toNumber(row && row.allocated_amount, 0))
				})
			})
			if (rows.length < batchSize) break
			page += 1
			guard += 1
		}
	}
	return result
}

function resolveSaleOffsetPoolStats(offsetPoolStatsMap, saleId) {
	const stats = offsetPoolStatsMap && offsetPoolStatsMap.get(normalizeString(saleId))
	return {
		enteredAmount: fix2(Math.max(0, toNumber(stats && stats.entered_amount, 0))),
		allocatedAmount: fix2(Math.max(0, toNumber(stats && stats.allocated_amount, 0)))
	}
}

function computeSaleRefundPendingAmount({
	shouldReceive = 0,
	amountReceived = 0,
	receiptRoundingAmount = 0,
	paidTotal = null,
	roundingAmount = 0,
	effectiveShouldReceive = null,
	offsetPoolEntered = 0
} = {}) {
	const provided = toNumber(effectiveShouldReceive, NaN)
	const effectiveShould = Number.isFinite(provided)
		? fix2(provided)
		: resolveEffectiveShouldReceive(toNumber(shouldReceive, 0), toNumber(roundingAmount, 0))
	const refundShould = fix2(Math.max(0, -effectiveShould))
	if (!(refundShould > 0)) return 0
	const paid = toNumber(paidTotal, NaN)
	const normalizedPaid = Number.isFinite(paid)
		? fix2(paid)
		: resolveSalePaidTotalAmount(amountReceived, receiptRoundingAmount)
	const refundPaidCash = fix2(Math.max(0, -normalizedPaid))
	const offsetEntered = fix2(Math.max(0, toNumber(offsetPoolEntered, 0)))
	return fix2(Math.max(0, refundShould - refundPaidCash - offsetEntered))
}

function computeSaleNetOutstandingEffective({
	shouldReceive = 0,
	amountReceived = 0,
	receiptRoundingAmount = 0,
	paidTotal = null,
	roundingAmount = 0,
	effectiveShouldReceive = null,
	offsetPoolEntered = 0,
	offsetPoolAllocated = 0
} = {}) {
	const provided = toNumber(effectiveShouldReceive, NaN)
	const effectiveShould = Number.isFinite(provided)
		? fix2(provided)
		: resolveEffectiveShouldReceive(toNumber(shouldReceive, 0), toNumber(roundingAmount, 0))
	const paid = toNumber(paidTotal, NaN)
	const normalizedPaid = Number.isFinite(paid)
		? fix2(paid)
		: resolveSalePaidTotalAmount(amountReceived, receiptRoundingAmount)
	const outstanding = fix2(effectiveShould - normalizedPaid)
	if (outstanding < 0) {
		if (effectiveShould < 0) {
			const adjusted = fix2(outstanding + Math.max(toNumber(offsetPoolEntered, 0), 0))
			return adjusted > 0 ? 0 : adjusted
		}
		const adjusted = fix2(outstanding + Math.max(toNumber(offsetPoolAllocated, 0), 0))
		return adjusted > 0 ? 0 : adjusted
	}
	return outstanding
}

function buildSaleListBatchEntries(docs = []) {
	return (Array.isArray(docs) ? docs : []).map((doc) => {
		const row = buildSaleListRow(doc)
		const shouldReceive = toNumber(row && row.should_receive, 0)
		const roundingAmount = toNumber(row && row.rounding_amount, 0)
		const amountReceived = toNumber(doc && doc.amount_received, 0)
		const receiptRoundingAmount = toNumber(doc && doc.receipt_rounding_amount, 0)
		const paidTotal = resolveSalePaidTotalAmount(amountReceived, receiptRoundingAmount)
		const effectiveShouldReceive = resolveEffectiveShouldReceive(shouldReceive, roundingAmount)
		return {
			doc,
			row,
			shouldReceive,
			roundingAmount,
			amountReceived,
			receiptRoundingAmount,
			paidTotal,
			effectiveShouldReceive
		}
	})
}

async function computeSaleListSummary(where, filters = {}) {
	const settlementScope = normalizeSettlementScope(filters.settlementScope || filters.settlement_scope)
	const hasRemark = normalizeHasRemarkFilter(filters.hasRemark || filters.has_remark)
	const remarkTag = normalizeRemarkTagFilter(filters.remarkTag || filters.remark_tag)
	const summary = {
		total: 0,
		paid: 0,
		paid_bottle_count: 0,
		partial: 0,
		unpaid: 0,
		should_receive_total: 0,
		amount_received_total: 0,
		outstanding_total: 0,
		total_net_weight: 0,
		bottle_count: 0,
		truck_count: 0,
		agent_sale_count: 0,
		bottle_net_weight: 0,
		truck_net_weight: 0,
		agent_sale_net_weight: 0,
		receivable_outstanding_total: 0,
		receivable_outstanding_count: 0,
		receivable_outstanding_bottle_count: 0,
		refund_outstanding_total: 0,
		refund_outstanding_count: 0,
		refund_outstanding_bottle_count: 0,
		overpaid_total: 0,
		overpaid_count: 0,
		overrefund_total: 0,
		overrefund_count: 0,
		prereceive_total: 0,
		prereceive_count: 0,
		prerefund_total: 0,
		prerefund_count: 0
	}

	const batchSize = 200
	let page = 1
	let guard = 0
	while (guard < 600) {
		const res = await sales
			.where(where)
			.field({
				_id: true,
				biz_mode: true,
				price_unit: true,
				settlement_mode: true,
				unit_price: true,
				out_items: true,
				back_items: true,
				agent_sale_items: true,
				truck_gross_diff: true,
				truck_sale_net: true,
				truck_out_gross: true,
				truck_back_gross: true,
				truck_settle_tare: true,
				truck_settle_gross: true,
				rounding_amount: true,
				receipt_rounding_amount: true,
					flow_index_prev: true,
					flow_index_curr: true,
					flow_volume_m3: true,
					flow_theory_ratio: true,
					remark: true,
					remark_normalized: true,
					remark_tags: true,
					system_note: true,
					has_remark: true,
					amount_received: true,
					payment_status: true
				})
			.skip((page - 1) * batchSize)
			.limit(batchSize)
			.get()
		const docs = Array.isArray(res.data) ? res.data : []
		if (!docs.length) break
		const entryRows = buildSaleListBatchEntries(docs)
		const offsetSaleIds = Array.from(
			new Set(
				entryRows
					.filter((entry) => fix2(entry.effectiveShouldReceive - entry.paidTotal) < 0)
					.map((entry) => normalizeString(entry.doc && entry.doc._id))
					.filter(Boolean)
			)
		)
		const offsetPoolStatsMap = offsetSaleIds.length
			? await buildSaleOffsetPoolStatsMapBySaleIds(offsetSaleIds)
			: new Map()

		for (const entry of entryRows) {
				const doc = entry.doc
				const row = entry.row
				const bizMode = normalizeBizModeValue(row && row.biz_mode)
				const shouldReceive = entry.shouldReceive
				const amountReceived = entry.amountReceived
				const paidTotal = entry.paidTotal
				const saleId = normalizeString(doc && doc._id)
				const { enteredAmount: offsetPoolEntered, allocatedAmount: offsetPoolAllocated } = resolveSaleOffsetPoolStats(offsetPoolStatsMap, saleId)
				const refundPending = computeSaleRefundPendingAmount({
					shouldReceive,
					amountReceived,
					receiptRoundingAmount: entry.receiptRoundingAmount,
					paidTotal,
					effectiveShouldReceive: entry.effectiveShouldReceive,
					roundingAmount: entry.roundingAmount,
					offsetPoolEntered
				})
				const netOutstandingEffective = computeSaleNetOutstandingEffective({
					shouldReceive,
					amountReceived,
					receiptRoundingAmount: entry.receiptRoundingAmount,
					paidTotal,
					effectiveShouldReceive: entry.effectiveShouldReceive,
					roundingAmount: entry.roundingAmount,
					offsetPoolEntered,
					offsetPoolAllocated
				})
				if (!matchSaleListFilters(row, {
					settlementScope,
					hasRemark,
					remarkTag,
					refundPending,
					netOutstandingEffective
				})) continue
				const effectiveShouldReceive = entry.effectiveShouldReceive
				const outstanding = fix2(effectiveShouldReceive - paidTotal)
				const status = normalizePaymentStatusValue(doc && doc.payment_status)
				const netWeight = toNumber(row && row.total_net_weight, 0)
				const bottleQuantity = computeSaleBottleQuantity(doc)

				summary.total += 1
			if (status === 'paid') {
				summary.paid += 1
				summary.paid_bottle_count += bottleQuantity
			}
			else if (status === 'partial') summary.partial += 1
			else summary.unpaid += 1

			summary.should_receive_total = fix2(summary.should_receive_total + shouldReceive)
			summary.amount_received_total = fix2(summary.amount_received_total + amountReceived)
			summary.outstanding_total = fix2(summary.outstanding_total + netOutstandingEffective)
			summary.total_net_weight = fix2(summary.total_net_weight + netWeight)

			const outstandingCreditEffective = fix2(Math.max(0, -netOutstandingEffective))
			if (effectiveShouldReceive > 0) {
				if (outstanding > 0) {
					summary.receivable_outstanding_total = fix2(summary.receivable_outstanding_total + outstanding)
					summary.receivable_outstanding_count += 1
					summary.receivable_outstanding_bottle_count += bottleQuantity
				} else if (outstanding < 0 && outstandingCreditEffective > 0.01) {
					summary.overpaid_total = fix2(summary.overpaid_total + outstandingCreditEffective)
					summary.overpaid_count += 1
				}
			} else if (effectiveShouldReceive < 0) {
				if (refundPending > 0.01) {
					summary.refund_outstanding_total = fix2(summary.refund_outstanding_total + refundPending)
					summary.refund_outstanding_count += 1
					summary.refund_outstanding_bottle_count += bottleQuantity
				} else if (outstanding > 0) {
					summary.overrefund_total = fix2(summary.overrefund_total + outstanding)
					summary.overrefund_count += 1
				}
			} else if (paidTotal > 0 && outstandingCreditEffective > 0.01) {
				summary.prereceive_total = fix2(summary.prereceive_total + outstandingCreditEffective)
				summary.prereceive_count += 1
			} else if (paidTotal < 0) {
				summary.prerefund_total = fix2(summary.prerefund_total + Math.abs(paidTotal))
				summary.prerefund_count += 1
			}

			if (bizMode === 'truck') {
				summary.truck_count += 1
				summary.truck_net_weight = fix2(summary.truck_net_weight + netWeight)
			} else if (bizMode === 'agent_sale') {
				summary.agent_sale_count += 1
				summary.agent_sale_net_weight = fix2(summary.agent_sale_net_weight + netWeight)
			} else {
				summary.bottle_count += 1
				summary.bottle_net_weight = fix2(summary.bottle_net_weight + netWeight)
			}
		}

		if (docs.length < batchSize) break
		page += 1
		guard += 1
	}
	return summary
}

async function enrichSaleRowsWithNetOutstandingEffective(rows = []) {
	const source = Array.isArray(rows) ? rows : []
	if (!source.length) return source
	const entries = source.map((row) => {
		const shouldReceive = toNumber(row && row.should_receive, 0)
		const roundingAmount = toNumber(row && row.rounding_amount, 0)
		const amountReceived = toNumber(row && row.amount_received, 0)
		const receiptRoundingAmount = toNumber(row && row.receipt_rounding_amount, 0)
		const paidTotal = resolveSalePaidTotalAmount(amountReceived, receiptRoundingAmount)
		const effectiveShouldReceive = resolveEffectiveShouldReceive(shouldReceive, roundingAmount)
		return {
			row,
			shouldReceive,
			roundingAmount,
			amountReceived,
			receiptRoundingAmount,
			paidTotal,
			effectiveShouldReceive,
			saleId: normalizeString(row && row._id)
		}
	})
	const offsetSaleIds = Array.from(
		new Set(
			entries
				.filter((entry) => fix2(entry.effectiveShouldReceive - entry.paidTotal) < 0)
				.map((entry) => entry.saleId)
				.filter(Boolean)
		)
	)
	const offsetPoolStatsMap = offsetSaleIds.length
		? await buildSaleOffsetPoolStatsMapBySaleIds(offsetSaleIds)
		: new Map()
	return entries.map((entry) => {
		const { enteredAmount: offsetPoolEntered, allocatedAmount: offsetPoolAllocated } = resolveSaleOffsetPoolStats(offsetPoolStatsMap, entry.saleId)
		const netOutstandingEffective = computeSaleNetOutstandingEffective({
			shouldReceive: entry.shouldReceive,
			amountReceived: entry.amountReceived,
			receiptRoundingAmount: entry.receiptRoundingAmount,
			paidTotal: entry.paidTotal,
			roundingAmount: entry.roundingAmount,
			effectiveShouldReceive: entry.effectiveShouldReceive,
			offsetPoolEntered,
			offsetPoolAllocated
		})
		return {
			...entry.row,
			net_outstanding_effective: fix2(netOutstandingEffective)
		}
	})
}

async function computeMonthSalesHeadline() {
	const monthRange = getMonthRange(getCNDate())
	const monthWhere = dbCmd.and([{ date: dbCmd.gte(monthRange.start) }, { date: dbCmd.lte(monthRange.end) }])
	const monthDocs = await fetchAll(sales, monthWhere, {
		date: true,
		biz_mode: true,
		price_unit: true,
		settlement_mode: true,
		unit_price: true,
		out_items: true,
		back_items: true,
		agent_sale_items: true,
		truck_gross_diff: true,
		truck_sale_net: true,
		truck_out_gross: true,
		truck_back_gross: true,
		flow_volume_m3: true
	})
	let salesDocTotal = 0
	monthDocs.forEach((doc) => {
		const amounts = computeSaleAmountsForDoc(doc)
		salesDocTotal = fix2(salesDocTotal + toNumber(amounts && amounts.amounts && amounts.amounts.should_receive, 0))
	})
	let flowSettlementTotal = 0
	try {
		const monthFlowDocs = await fetchAll(
			flowSettlements,
			dbCmd.and([{ status: 'posted' }, { biz_date: dbCmd.gte(monthRange.start) }, { biz_date: dbCmd.lte(monthRange.end) }]),
			{ should_receive: true }
		)
		monthFlowDocs.forEach((doc) => {
			flowSettlementTotal = fix2(flowSettlementTotal + toNumber(doc && doc.should_receive, 0))
		})
	} catch (err) {
		console.error('[crm-sale] computeMonthSalesHeadline flow settlements failed', err)
	}
	return {
		month_sales_doc_total: fix2(salesDocTotal),
		month_flow_total: fix2(flowSettlementTotal),
		month_sales_total: fix2(salesDocTotal + flowSettlementTotal),
		month_range_start: monthRange.start,
		month_range_end: monthRange.end
	}
}

async function listV2(user, data) {
	void user
	const page = Math.max(toNumber(data.page, 1), 1)
	const pageSize = Math.min(Math.max(toNumber(data.pageSize, 20), 1), 50)
	const settlementScope = normalizeSettlementScope(data.settlementScope || data.settlement_scope)
	const hasRemark = normalizeHasRemarkFilter(data.hasRemark || data.has_remark)
	const remarkTag = normalizeRemarkTagFilter(data.remarkTag || data.remark_tag)

	const where = buildSaleListWhere(data)
	let dataList = []
	let total = 0
	const needPostFilter = Boolean(settlementScope || hasRemark || remarkTag)

	if (!needPostFilter) {
		const res = await sales
			.where(where)
			.orderBy('date', 'desc')
			.orderBy('created_at', 'desc')
			.skip((page - 1) * pageSize)
			.limit(pageSize)
			.get()
		dataList = (res.data || []).map((doc) => buildSaleListRow(doc))
	} else {
		const matchedRows = []
		const batchSize = 200
		let cursor = 1
		let guard = 0
		const needsRefundPending = settlementScope === 'refund_outstanding'
		const needsNetOutstandingEffective = settlementScope === 'net_outstanding_non_zero'
		const needsOffsetPool = needsRefundPending || needsNetOutstandingEffective
		while (guard < 600) {
			const res = await sales
				.where(where)
				.orderBy('date', 'desc')
				.orderBy('created_at', 'desc')
				.skip((cursor - 1) * batchSize)
				.limit(batchSize)
				.get()
			const docs = Array.isArray(res.data) ? res.data : []
			if (!docs.length) break
			const entryRows = buildSaleListBatchEntries(docs)
			const offsetSaleIds = needsOffsetPool
				? Array.from(
					new Set(
						entryRows
							.filter((entry) => {
								const outstanding = fix2(entry.effectiveShouldReceive - entry.paidTotal)
								if (!(outstanding < 0)) return false
								if (needsNetOutstandingEffective) return true
								if (needsRefundPending) return entry.effectiveShouldReceive < 0
								return false
							})
							.map((entry) => normalizeString(entry.doc && entry.doc._id))
							.filter(Boolean)
					)
				)
				: []
			const offsetPoolStatsMap = offsetSaleIds.length
				? await buildSaleOffsetPoolStatsMapBySaleIds(offsetSaleIds)
				: new Map()
			for (const entry of entryRows) {
				const row = entry.row
				let refundPending = null
				let netOutstandingEffective = null
				const saleId = normalizeString(entry.doc && entry.doc._id)
				const { enteredAmount: offsetPoolEntered, allocatedAmount: offsetPoolAllocated } = needsOffsetPool
					? resolveSaleOffsetPoolStats(offsetPoolStatsMap, saleId)
					: { enteredAmount: 0, allocatedAmount: 0 }
				if (needsRefundPending) {
					refundPending = computeSaleRefundPendingAmount({
						shouldReceive: entry.shouldReceive,
						amountReceived: entry.amountReceived,
						receiptRoundingAmount: entry.receiptRoundingAmount,
						paidTotal: entry.paidTotal,
						effectiveShouldReceive: entry.effectiveShouldReceive,
						roundingAmount: entry.roundingAmount,
						offsetPoolEntered
					})
				}
				if (needsNetOutstandingEffective) {
					netOutstandingEffective = computeSaleNetOutstandingEffective({
						shouldReceive: entry.shouldReceive,
						amountReceived: entry.amountReceived,
						receiptRoundingAmount: entry.receiptRoundingAmount,
						paidTotal: entry.paidTotal,
						effectiveShouldReceive: entry.effectiveShouldReceive,
						roundingAmount: entry.roundingAmount,
						offsetPoolEntered,
						offsetPoolAllocated
					})
				}
				if (!matchSaleListFilters(row, {
					settlementScope,
					hasRemark,
					remarkTag,
					refundPending,
					netOutstandingEffective
				})) continue
				if (Number.isFinite(toNumber(netOutstandingEffective, NaN))) {
					row.net_outstanding_effective = fix2(netOutstandingEffective)
				}
				matchedRows.push(row)
			}
			if (docs.length < batchSize) break
			cursor += 1
			guard += 1
		}
		total = matchedRows.length
		const start = (page - 1) * pageSize
		const end = start + pageSize
		dataList = matchedRows.slice(start, end)
	}
	dataList = await enrichSaleRowsWithNetOutstandingEffective(dataList)
	dataList = await enrichSaleListRowsWithBottleStats(dataList)

	const summary = await computeSaleListSummary(where, { settlementScope, hasRemark, remarkTag })
	const monthHeadline = await computeMonthSalesHeadline()
	if (!total) total = Number(summary.total || 0)
	const hasMore = page * pageSize < total

	return {
		code: 0,
		data: dataList,
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		},
		summary: {
			total,
			paid: Number(summary.paid || 0),
			paid_bottle_count: Number(summary.paid_bottle_count || 0),
			partial: Number(summary.partial || 0),
			unpaid: Number(summary.unpaid || 0),
			should_receive_total: fix2(summary.should_receive_total || 0),
			amount_received_total: fix2(summary.amount_received_total || 0),
			outstanding_total: fix2(summary.outstanding_total || 0),
			total_net_weight: fix2(summary.total_net_weight || 0),
			bottle_count: Number(summary.bottle_count || 0),
			truck_count: Number(summary.truck_count || 0),
			agent_sale_count: Number(summary.agent_sale_count || 0),
			bottle_net_weight: fix2(summary.bottle_net_weight || 0),
			truck_net_weight: fix2(summary.truck_net_weight || 0),
			agent_sale_net_weight: fix2(summary.agent_sale_net_weight || 0),
			receivable_outstanding_total: fix2(summary.receivable_outstanding_total || 0),
			receivable_outstanding_count: Number(summary.receivable_outstanding_count || 0),
			receivable_outstanding_bottle_count: Number(summary.receivable_outstanding_bottle_count || 0),
			refund_outstanding_total: fix2(summary.refund_outstanding_total || 0),
			refund_outstanding_count: Number(summary.refund_outstanding_count || 0),
			refund_outstanding_bottle_count: Number(summary.refund_outstanding_bottle_count || 0),
			overpaid_total: fix2(summary.overpaid_total || 0),
			overpaid_count: Number(summary.overpaid_count || 0),
			overrefund_total: fix2(summary.overrefund_total || 0),
			overrefund_count: Number(summary.overrefund_count || 0),
			prereceive_total: fix2(summary.prereceive_total || 0),
			prereceive_count: Number(summary.prereceive_count || 0),
			prerefund_total: fix2(summary.prerefund_total || 0),
			prerefund_count: Number(summary.prerefund_count || 0),
			month_sales_doc_total: fix2(monthHeadline.month_sales_doc_total || 0),
			month_flow_total: fix2(monthHeadline.month_flow_total || 0),
			month_sales_total: fix2(monthHeadline.month_sales_total || 0),
			month_range_start: normalizeString(monthHeadline.month_range_start),
			month_range_end: normalizeString(monthHeadline.month_range_end)
		}
	}
}

async function getV2(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const res = await sales.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	const bizMode = normalizeString(doc.biz_mode) || 'bottle'
	const priceUnit = normalizeString(doc.price_unit) || 'kg'
	const settlementMode = priceUnit === 'm3' ? 'customer_flow' : normalizeSettlementMode(doc.settlement_mode, 'sale')
	const unitPrice = toNumber(doc.unit_price, 0)

	const outItems = Array.isArray(doc.out_items) ? doc.out_items : []
	const backItems = Array.isArray(doc.back_items) ? doc.back_items : []
	const agentRows = Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : []
	const truckSaleNet = resolveTruckBillableNetValue({
		priceUnit,
		rawTruckGrossDiff: doc.truck_gross_diff,
		rawTruckSaleNet: doc.truck_sale_net,
		rawTruckOutGross: doc.truck_out_gross,
		rawTruckBackGross: doc.truck_back_gross,
		rawTruckSettleTare: doc.truck_settle_tare,
		rawTruckSettleGross: doc.truck_settle_gross
	})

	const flow = computeFlow(doc, priceUnit)
	const amounts = computeAmounts({
		settlementMode,
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outItems,
		backItems: bizMode === 'agent_sale' ? [] : backItems,
		agentRows,
		truckSaleNet,
		truckOutGross: doc.truck_out_gross,
		truckBackGross: doc.truck_back_gross,
		truckSettleTare: doc.truck_settle_tare,
		truckSettleGross: doc.truck_settle_gross,
		flow,
		roundingAmount: toNumber(doc.rounding_amount, 0)
	})

	return {
		code: 0,
		data: {
			...applyRemarkMetaToDoc(doc),
			out_net_total: amounts.out_net_total,
			back_net_total: amounts.back_net_total,
			total_net_weight: amounts.total_net_weight,
			out_amount: amounts.out_amount,
			back_amount: amounts.back_amount,
			effective_should_receive: amounts.effective_should_receive,
			rounding_amount: amounts.rounding_amount,
			should_receive: amounts.should_receive
		}
	}
}

async function quickReceiveV1(user, data, requestId, token) {
	const recordId = normalizeString(data.recordId || data._id || data.id)
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }

	const res = await sales.doc(recordId).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	if ((normalizeString(doc && doc.price_unit) || 'kg') === 'm3' || normalizeSettlementMode(doc && doc.settlement_mode) === 'customer_flow') {
		return { code: 400, msg: '该销售单按客户对账页流量结算，不支持直接登记回款' }
	}

	const receiptAmount = toNumber(data.amountReceived ?? data.amount_received, null)
	if (receiptAmount == null || !Number.isFinite(receiptAmount) || receiptAmount <= 0) {
		return { code: 400, msg: '本次回款金额必须大于0' }
	}
	const paymentMethod = normalizePaymentMethod(data.paymentMethod || data.payment_method || doc.payment_method, 'paid')
	if (paymentMethod === 'on_account') return { code: 400, msg: '回款登记必须选择现金/转账/微信/支付宝/支票' }
	const allocationMode = normalizeString(data.allocationMode || data.allocation_mode || 'period').toLowerCase() || 'period'
	if (allocationMode !== 'period') return { code: 400, msg: '仅支持按日期区间分配' }
	const allocationStartDate = normalizeYmdDate(data.allocationStartDate || data.allocation_start_date, '')
	const allocationEndDate = normalizeYmdDate(data.allocationEndDate || data.allocation_end_date, '')
	if (!allocationStartDate || !allocationEndDate) return { code: 400, msg: '请填写分配开始日期和结束日期' }
	if (allocationStartDate > allocationEndDate) return { code: 400, msg: '分配开始日期不能晚于结束日期' }

	const paymentNote = normalizeString(data.paymentNote || data.payment_note)
	const bizDate = normalizeString(data.biz_date || data.bizDate || doc.date)

	const settlementRes = await callCustomerSettlement(
		'createReceiptV1',
		{
			customer_id: normalizeString(doc.customer_id),
			amount: receiptAmount,
			biz_date: bizDate,
			allocation_mode: allocationMode,
			allocation_start_date: allocationStartDate,
			allocation_end_date: allocationEndDate,
			payment_method: paymentMethod,
			note: paymentNote,
			source_type: 'sale_quick_receive',
			source_id: recordId
		},
		token,
		requestId
	)
	if (settlementRes.code !== 0) {
		return { code: settlementRes.code || 400, msg: settlementRes.msg || '回款登记失败' }
	}

	await sales.doc(recordId).update({
		payment_method: paymentMethod,
		updated_at: Date.now()
	})

	const latestRes = await sales.doc(recordId).get()
	const latest = (latestRes.data && latestRes.data[0]) || doc
	const { amounts } = computeSaleAmountsForDoc(latest)
	const sideWarnings = []
	try {
		await resyncSaleVoucherById(user, recordId, requestId)
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('凭证未同步（缺集合）')
		else throw err
	}

	await recordLog(
		user,
		'sale_quick_receive_v1',
		{
			id: recordId,
			customer_id: normalizeString(doc.customer_id),
			receipt_amount: receiptAmount,
			side_warnings: sideWarnings
		},
		requestId
	)

	const warningText = sideWarnings.filter(Boolean).join('；')
	const message = warningText ? `回款登记成功（${warningText}）` : '回款登记成功'
	return {
		code: 0,
		msg: message,
		data: {
			_id: recordId,
			receipt_amount: receiptAmount,
			receipt_id: normalizeString(settlementRes?.data?.receipt_id),
			payment_status: normalizePaymentStatusValue(latest.payment_status) || 'unpaid',
			payment_method: normalizePaymentMethod(latest.payment_method, latest.payment_status),
			amount_received: fix2(toNumber(latest.amount_received, 0)),
			payment_note: normalizeString(latest.payment_note),
			should_receive: amounts.should_receive,
			outstanding_amount: computeSettlementOutstanding(
				toNumber(amounts.should_receive, 0),
				toNumber(latest.amount_received, 0),
				toNumber(amounts.rounding_amount, 0)
			),
			warning: warningText
		}
	}
}

async function getCustomerDepositV1(user, data) {
	void user
	const customerId = normalizeString(data.customerId)
	if (!customerId) return { code: 400, msg: 'customerId 必填', data: { bottles: [], raw: '', count: 0 } }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在', data: { bottles: [], raw: '', count: 0 } }

	const resolvedId = customer._id
	const resolvedName = customer.name

	const dateEnd = normalizeString(data.dateEnd || data.date)
	const depositRows = await fetchCustomerDepositSaleRows(resolvedId, dateEnd, '')
	const bottles = Array.from(buildCustomerDepositBottleSet(depositRows)).sort()
	return {
		code: 0,
		data: {
			customer_id: resolvedId,
			customer_name: resolvedName,
			bottles,
			raw: bottles.join(' / '),
			count: bottles.length
		}
	}
}

function normalizeMovementSignature(row) {
	const current = row && typeof row === 'object' ? row : {}
	return [
		normalizeBottleNoForCreate(current.bottle_no),
		normalizeString(current.type),
		normalizeString(current.date),
		normalizeEventDay(current.event_day || current.date, current.created_at || Date.now()),
		String(toTimestamp(current.event_at, parseEventAt(current.date, current.created_at || Date.now()))),
		String(toNumber(current.net_weight, 0)),
		normalizeString(current.source_type),
		normalizeString(current.source_id),
		normalizeString(current.customer_id),
		normalizeString(current.customer_name),
		normalizeString(current.note)
	].join('|')
}

async function fetchAgentSaleDocsForBackfill(where, maxRows) {
	const rows = []
	const batchSize = 200
	let page = 1
	let guard = 0
	let limited = false
	while (guard < 1000 && rows.length < maxRows) {
		const res = await sales
			.where(where)
			.field({
				_id: true,
				date: true,
				customer_id: true,
				customer_name: true,
				biz_mode: true,
				agent_sale_items: true,
				created_at: true,
				updated_at: true
			})
			.orderBy('date', 'asc')
			.orderBy('created_at', 'asc')
			.skip((page - 1) * batchSize)
			.limit(batchSize)
			.get()
		const docs = Array.isArray(res.data) ? res.data : []
		if (!docs.length) break
		rows.push(...docs)
		if (rows.length >= maxRows) {
			limited = docs.length === batchSize || rows.length > maxRows
			break
		}
		if (docs.length < batchSize) break
		page += 1
		guard += 1
	}
	return {
		rows: rows.slice(0, maxRows),
		limited
	}
}

async function fetchSaleMovementMapBySourceIds(sourceIds = []) {
	const ids = uniqStrings(sourceIds)
	const out = new Map()
	if (!ids.length) return out
	for (const chunk of sliceIntoChunks(ids, 120)) {
		const res = await movements
			.where({
				source_type: 'sale',
				source_id: dbCmd.in(chunk)
			})
			.field({
				_id: true,
				source_id: true,
				bottle_no: true,
				type: true,
				date: true,
				event_day: true,
				event_at: true,
				net_weight: true,
				customer_id: true,
				customer_name: true,
				note: true,
				created_at: true
			})
			.limit(chunk.length * 20)
			.get()
		for (const row of res.data || []) {
			const sourceId = normalizeString(row && row.source_id)
			if (!sourceId) continue
			if (!out.has(sourceId)) out.set(sourceId, [])
			out.get(sourceId).push(row)
		}
	}
	return out
}

function buildAgentSaleBackfillPlanRow(saleDoc, agentRows, existingRows, expectedRows) {
	const saleId = normalizeString(saleDoc && saleDoc._id)
	const normalizedExisting = Array.isArray(existingRows) ? existingRows : []
	const normalizedExpected = Array.isArray(expectedRows) ? expectedRows : []
	const existingSig = normalizedExisting.map(normalizeMovementSignature).sort()
	const expectedSig = normalizedExpected.map(normalizeMovementSignature).sort()
	const isExactMatch = existingSig.length === expectedSig.length
		&& existingSig.every((item, index) => item === expectedSig[index])
	const bottleNos = collectBottleNosFromRows(agentRows)
	return {
		sale_id: saleId,
		date: normalizeString(saleDoc && saleDoc.date),
		customer_name: normalizeString(saleDoc && saleDoc.customer_name),
		agent_item_count: agentRows.length,
		bottle_nos: bottleNos,
		existing_movement_count: normalizedExisting.length,
		expected_movement_count: normalizedExpected.length,
		needs_rebuild: !isExactMatch,
		reason: isExactMatch
			? ''
			: (normalizedExisting.length === 0 ? 'missing_sale_movements' : 'movement_signature_mismatch')
	}
}

async function triggerAnomalyTouchByChunks(user, token, bottleNos, requestId, batchSize = 120) {
	const normalizedNos = uniqStrings((bottleNos || []).map((item) => normalizeBottleNoForCreate(item)).filter(Boolean))
	if (!normalizedNos.length) {
		return { touched_bottles: 0, warning: '' }
	}
	let warning = ''
	let touchedBottles = 0
	for (const chunk of sliceIntoChunks(normalizedNos, Math.max(Number(batchSize) || 0, 1))) {
		const touchRes = await triggerAnomalyTouchV2(user, token, chunk, requestId)
		touchedBottles += chunk.length
		if (touchRes.warning) warning = warning ? `${warning}；${touchRes.warning}` : touchRes.warning
	}
	return {
		touched_bottles: touchedBottles,
		warning
	}
}

async function backfillAgentSaleBottleMovementsV1(user, data, requestId, token) {
	if (!AGENT_SALE_BACKFILL_ROLES.has(normalizeRole(user && user.role))) {
		return { code: 403, msg: '仅超级管理员可执行代理出站回填' }
	}

	const execute = toBoolean(data && data.execute, false)
	const maxRows = Math.min(Math.max(toNumber(data && (data.max_rows || data.maxRows), 1000), 1), 20000)
	const dateStart = normalizeString(data && (data.date_start || data.dateStart))
	const dateEnd = normalizeString(data && (data.date_end || data.dateEnd))
	const saleId = normalizeString(data && (data.sale_id || data.saleId))
	const touchAnomalies = toBoolean(data && (data.touch_anomalies || data.touchAnomalies), true)
	const touchBatchSize = Math.min(Math.max(toNumber(data && (data.touch_batch_size || data.touchBatchSize), 120), 20), 200)
	const confirmText = normalizeString(data && (data.confirm_text || data.confirmText))

	const where = { biz_mode: 'agent_sale' }
	if (saleId) {
		where._id = saleId
	} else if (dateStart && dateEnd) {
		where.date = dbCmd.and(dbCmd.gte(dateStart), dbCmd.lte(dateEnd))
	} else if (dateStart) {
		where.date = dbCmd.gte(dateStart)
	} else if (dateEnd) {
		where.date = dbCmd.lte(dateEnd)
	}

	const fetchRes = await fetchAgentSaleDocsForBackfill(where, maxRows)
	const saleDocs = fetchRes.rows || []
	const movementMap = await fetchSaleMovementMapBySourceIds(saleDocs.map((row) => normalizeString(row && row._id)))
	const sharedAgentRowsForLinking = saleDocs.flatMap((saleDoc) => {
		const normalizedRows = normalizeAgentRows(saleDoc && saleDoc.agent_sale_items)
		return normalizedRows.map((row) => ({
			...row,
			sale_date: normalizeString(saleDoc && saleDoc.date)
		}))
	})
	const sharedLinkedMeta = await fetchAgentSaleLinkedFillMeta(sharedAgentRowsForLinking)
	const planRows = []
	const rebuildTargets = []
	for (const saleDoc of saleDocs) {
		const agentRows = normalizeAgentRows(saleDoc && saleDoc.agent_sale_items)
		if (!agentRows.length) continue
		const expectedRows = await buildAgentSaleMovementDocs(user, saleDoc, agentRows, sharedLinkedMeta)
		const existingRows = movementMap.get(normalizeString(saleDoc && saleDoc._id)) || []
		const plan = buildAgentSaleBackfillPlanRow(saleDoc, agentRows, existingRows, expectedRows)
		planRows.push(plan)
		if (plan.needs_rebuild) {
			rebuildTargets.push({
				saleDoc,
				agentRows,
				expectedRows,
				bottleNos: plan.bottle_nos
			})
		}
	}

	const summary = {
		scope: {
			sale_id: saleId,
			date_start: dateStart,
			date_end: dateEnd
		},
		limited: Boolean(fetchRes.limited),
		max_rows: maxRows,
		scanned_sales: saleDocs.length,
		eligible_sales: planRows.length,
		rebuild_sales: rebuildTargets.length,
		unchanged_sales: planRows.length - rebuildTargets.length,
		expected_insert_rows: rebuildTargets.reduce((sum, row) => sum + Number(row.expectedRows.length || 0), 0),
		affected_bottles: uniqStrings(rebuildTargets.flatMap((row) => row.bottleNos || [])).length,
		sample_sales: planRows.filter((row) => row.needs_rebuild).slice(0, 20)
	}

	if (!execute) {
		await recordLog(user, 'sale_backfill_agent_sale_movements_v1_preview', summary, requestId)
		return {
			code: 0,
			msg: '预览完成',
			data: {
				execute: false,
				...summary
			}
		}
	}

	if (fetchRes.limited) {
		return { code: 400, msg: `待处理代理销售超过 ${maxRows} 条，请增大 max_rows 后重试` }
	}
	if (confirmText !== AGENT_SALE_BACKFILL_CONFIRM_TEXT) {
		return { code: 400, msg: '缺少确认口令，拒绝执行代理出站回填' }
	}

	let rebuiltSales = 0
	let insertedRows = 0
	const touchedBottleNos = new Set()
	for (const target of rebuildTargets) {
		const saleDoc = target.saleDoc
		const sourceId = normalizeString(saleDoc && saleDoc._id)
		if (!sourceId) continue
		await movements.where({ source_type: 'sale', source_id: sourceId }).remove()
		if (target.expectedRows.length > 0) {
			await movements.add(target.expectedRows)
			insertedRows += target.expectedRows.length
		}
		target.bottleNos.forEach((item) => {
			const no = normalizeBottleNoForCreate(item)
			if (no) touchedBottleNos.add(no)
		})
		rebuiltSales += 1
	}

	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(Array.from(touchedBottleNos))
	let touchSummary = { touched_bottles: 0, warning: '' }
	if (touchAnomalies && touchedBottleNos.size) {
		touchSummary = await triggerAnomalyTouchByChunks(user, token, Array.from(touchedBottleNos), requestId, touchBatchSize)
	}

	await recordLog(
		user,
		'sale_backfill_agent_sale_movements_v1_execute',
		{
			...summary,
			execute: true,
			rebuilt_sales: rebuiltSales,
			inserted_rows: insertedRows,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			touched_bottles: touchSummary.touched_bottles,
			touch_warning: touchSummary.warning || ''
		},
		requestId
	)

	const warningText = touchSummary.warning || ''
	return {
		code: 0,
		msg: warningText ? `回填完成（${warningText}）` : '回填完成',
		data: {
			execute: true,
			...summary,
			rebuilt_sales: rebuiltSales,
			inserted_rows: insertedRows,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			touched_bottles: touchSummary.touched_bottles,
			touch_warning: warningText
		}
	}
}

async function updateV2(user, data, requestId, token) {
	const recordId = normalizeString(data.recordId || data._id)
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	const payload = data.payload
	if (!payload) return { code: 400, msg: 'payload 必填' }
	const ignoreBottleFlowWarning = toBoolean(data.ignore_bottle_flow_warning ?? data.ignoreBottleFlowWarning, false)
	const existingRes = await sales.doc(recordId).get()
	const existing = (existingRes.data && existingRes.data[0]) || null
	if (!existing) return { code: 404, msg: '记录不存在' }

	const base = payload.base || {}
	const outRows = normalizeBottleRows(payload.outRows || [])
	const backRows = normalizeBottleRows(payload.backRows || [])
	let depositRows = normalizeDepositRows(payload.depositRows || [])
	let agentRows = normalizeAgentRows(payload.agentSaleRows || [])

	const date = normalizeString(base.date)
	if (!date) return { code: 400, msg: '日期必填' }

	const customerId = normalizeString(base.customerId)
	if (!customerId) return { code: 400, msg: '客户必选' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }
	const deliveryMan = joinDelivery(base.delivery1, base.delivery2)

	const bizMode = inferBizMode(base, outRows, backRows, agentRows)
	const customerPriceUnit = normalizeString(customer && customer.default_price_unit)
	const priceUnit = normalizeString(base.priceUnit) || customerPriceUnit || 'kg'
	const settlementMode = priceUnit === 'm3'
		? 'customer_flow'
		: normalizeSettlementMode(base.settlementMode, normalizeSettlementMode(existing && existing.settlement_mode, 'sale'))
	const unitPrice = toNumber(base.unitPrice, 0)

	const truckNo = normalizeTruckNoForCreate(base.truckNo, base.carNo)
	const truckOutGross = toNumber(base.truckOutGross, 0)
	const truckBackGross = toNumber(base.truckBackGross, 0)
	const truckSettleTare = base.truckSettleTare === '' || base.truckSettleTare == null ? null : toNumber(base.truckSettleTare, null)
	const truckSettleGross = base.truckSettleGross === '' || base.truckSettleGross == null ? null : toNumber(base.truckSettleGross, null)
	const truckReferenceNet = resolveTruckReferenceNetValue(base.truckGrossDiff, base.truckOutGross, base.truckBackGross)
	const truckSettlementNet = resolveTruckSettlementNetValue(base.truckSaleNet, base.truckSettleTare, base.truckSettleGross)
	const truckNetDiffKg = priceUnit === 'kg' ? fix2(truckSettlementNet - truckReferenceNet) : 0
	const truckLossKg = priceUnit === 'kg' ? fix2(Math.max(truckReferenceNet - truckSettlementNet, 0)) : 0
	const truckSaleNet = resolveTruckBillableNetValue({
		priceUnit,
		rawTruckGrossDiff: base.truckGrossDiff,
		rawTruckSaleNet: base.truckSaleNet,
		rawTruckOutGross: base.truckOutGross,
		rawTruckBackGross: base.truckBackGross,
		rawTruckSettleTare: base.truckSettleTare,
		rawTruckSettleGross: base.truckSettleGross
	})

	if (!bizMode) return { code: 400, msg: '业务模式必选' }
	if (bizMode === 'agent_sale' && (!Array.isArray(agentRows) || agentRows.length === 0)) {
		return { code: 400, msg: '代理销售至少填写一行灌装明细' }
	}
	if (bizMode === 'agent_sale') {
		const bindRes = await bindAgentRowsWithLatestFill(agentRows, date)
		if (!bindRes.ok) return { code: 400, msg: bindRes.msg }
		agentRows = bindRes.rows
	}
	if (bizMode === 'truck') {
		if (!truckNo) return { code: 400, msg: '整车模式车牌必填' }
		if (!(Number.isFinite(truckReferenceNet) && truckReferenceNet > 0)) {
			return { code: 400, msg: '整车模式出厂毛重与回厂毛重差值必须大于0' }
		}
		if (priceUnit === 'kg' && !(Number.isFinite(truckSettlementNet) && truckSettlementNet > 0)) {
			return { code: 400, msg: '整车kg结算需填写车皮重与灌装后车毛重，且结算净重必须大于0' }
		}
	}

	const flowIndexPrev = priceUnit === 'm3' ? toNumber(base.flowIndexPrev, null) : null
	const flowIndexCurr = priceUnit === 'm3' ? toNumber(base.flowIndexCurr, null) : null
	const flowVolumeM3 = priceUnit === 'm3' ? toNumber(base.flowVolumeM3, null) : null
	const flowTheoryRatio = priceUnit === 'm3' ? toNumber(base.flowTheoryRatio, null) : null

	if (bizMode === 'bottle' && outRows.length === 0 && backRows.length === 0 && depositRows.length === 0) {
		return { code: 400, msg: '瓶装模式需填写出瓶/回瓶/存瓶' }
	}

	if (
		bizMode === 'bottle' &&
		shouldAutoSyncDepositRowsOnSaleUpdate({
			existingDoc: existing,
			incomingOutRows: outRows,
			incomingDepositRows: depositRows
		})
	) {
		depositRows = buildDepositRowsFromOutRows(outRows)
	}

	const bottleFlowWarnings = bizMode === 'bottle'
		? await collectSaleBottleFlowWarnings({
			date,
			customerId: customer._id,
			outRows,
			backRows,
			excludeSaleId: recordId
		})
		: []
	if (!ignoreBottleFlowWarning && bottleFlowWarnings.length > 0) {
		return buildBottleFlowWarningResponse(bottleFlowWarnings)
	}

	if (bizMode === 'bottle') {
		const ensureRes = await ensureBottlesExist({
			customerId: customer._id,
			customerName: customer.name,
			outRows,
			backRows,
			depositRows
		})
		if (!ensureRes.ok) return { code: 400, msg: ensureRes.msg }
	}

	const flowForCheck = computeFlow(
		{
			flow_index_prev: flowIndexPrev,
			flow_index_curr: flowIndexCurr,
			flow_volume_m3: flowVolumeM3,
			flow_theory_ratio: flowTheoryRatio
		},
		priceUnit
	)
	const amountsForCheck = computeAmounts({
		settlementMode,
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
			agentRows,
			truckSaleNet,
			truckOutGross,
			truckBackGross,
			truckSettleTare,
			truckSettleGross,
			flow: flowForCheck,
			roundingAmount: settlementMode === 'customer_flow'
				? 0
				: Math.max(toNumber(existing && existing.rounding_amount, 0), 0)
		})
	const existingOffsetEnabled = resolveSaleOffsetEnabled(existing, true)
	const existingApplyOffsetCredit = toBoolean(existing && (existing.apply_offset_credit ?? existing.applyOffsetCredit), false)
	const nextApplyOffsetCredit = settlementMode === 'customer_flow'
		? false
		: existingApplyOffsetCredit
	const amountReceived = settlementMode === 'customer_flow' ? 0 : toNumber(existing && existing.amount_received, 0)
	const nextOffsetEnabled = settlementMode === 'customer_flow' ? false : existingOffsetEnabled
	const paymentStatus = settlementMode === 'customer_flow'
		? 'paid'
		: normalizePaymentStatus(existing && existing.payment_status)
	const paymentMethod = settlementMode === 'customer_flow'
		? 'on_account'
		: normalizePaymentMethod(existing && existing.payment_method, paymentStatus)
	const paymentNote = settlementMode === 'customer_flow' ? '' : normalizeString(existing && existing.payment_note)
	const remarkMeta = deriveRemarkMeta(base.remark)
	const ticketImages = normalizeTicketImages(base.ticketImages, base.ticketImage)

	const updateDoc = {
		date,
		customer_id: customer._id,
		customer_name: customer.name,
		delivery_man: deliveryMan,
		vehicle_id: normalizeString(base.vehicleId),
		car_no: normalizeString(base.carNo),
		biz_mode: bizMode,
		settlement_mode: settlementMode,
		unit_price: unitPrice,
		price_unit: priceUnit,
		remark: remarkMeta.remark,
		ticket_image: ticketImages[0] || null,
		ticket_images: ticketImages,
		remark_normalized: remarkMeta.remark_normalized,
		remark_tags: remarkMeta.remark_tags,
		system_note: remarkMeta.system_note,
		has_remark: remarkMeta.has_remark,
		payment_status: paymentStatus,
		payment_method: paymentMethod,
		amount_received: amountReceived,
		rounding_amount: settlementMode === 'customer_flow'
			? 0
			: Math.max(toNumber(existing && existing.rounding_amount, 0), 0),
		payment_note: paymentNote,
		apply_offset_credit: nextApplyOffsetCredit,
		offset_enabled: nextOffsetEnabled,
		updated_at: Date.now()
	}

	if (bizMode === 'truck') {
		updateDoc.truck_no = truckNo
		updateDoc.truck_out_gross = truckOutGross
		updateDoc.truck_back_gross = truckBackGross
		updateDoc.truck_gross_diff = truckReferenceNet
		updateDoc.truck_sale_net = priceUnit === 'kg' ? truckSaleNet : null
		updateDoc.truck_settle_tare = priceUnit === 'kg' ? truckSettleTare : null
		updateDoc.truck_settle_gross = priceUnit === 'kg' ? truckSettleGross : null
		updateDoc.truck_net_diff_kg = priceUnit === 'kg' ? truckNetDiffKg : null
		updateDoc.truck_loss_kg = priceUnit === 'kg' ? truckLossKg : null
		updateDoc.out_items = []
		updateDoc.back_items = []
		updateDoc.deposit_rows = []
		updateDoc.agent_sale_items = []
	} else if (bizMode === 'agent_sale') {
		updateDoc.truck_no = ''
		updateDoc.truck_out_gross = null
		updateDoc.truck_back_gross = null
		updateDoc.truck_gross_diff = null
		updateDoc.truck_sale_net = null
		updateDoc.truck_settle_tare = null
		updateDoc.truck_settle_gross = null
		updateDoc.truck_net_diff_kg = null
		updateDoc.truck_loss_kg = null
		updateDoc.agent_sale_items = agentRows
		updateDoc.out_items = []
		updateDoc.back_items = []
		updateDoc.deposit_rows = []
	} else {
		updateDoc.truck_no = ''
		updateDoc.truck_out_gross = null
		updateDoc.truck_back_gross = null
		updateDoc.truck_gross_diff = null
		updateDoc.truck_sale_net = null
		updateDoc.truck_settle_tare = null
		updateDoc.truck_settle_gross = null
		updateDoc.truck_net_diff_kg = null
		updateDoc.truck_loss_kg = null
		updateDoc.agent_sale_items = []
		updateDoc.out_items = outRows
		updateDoc.back_items = backRows
		updateDoc.deposit_rows = depositRows
	}

	if (priceUnit === 'm3' && settlementMode !== 'customer_flow') {
		updateDoc.flow_index_prev = flowIndexPrev
		updateDoc.flow_index_curr = flowIndexCurr
		updateDoc.flow_volume_m3 = flowVolumeM3
		updateDoc.flow_theory_ratio = flowTheoryRatio
	} else {
		updateDoc.flow_index_prev = null
		updateDoc.flow_index_curr = null
		updateDoc.flow_volume_m3 = null
		updateDoc.flow_theory_ratio = null
	}

	await sales.doc(recordId).update(updateDoc)
	await movements
		.where({ source_type: 'sale', source_id: recordId })
		.remove()
	await appendSaleMovementRecords(user, { ...updateDoc, _id: recordId }, {
		bizMode,
		outRows,
		backRows,
		agentRows
	})
	const touchedBottleNos = [
		...collectSaleBottleNosFromDoc(existing),
		...collectSaleBottleNosFromDoc({
			out_items: outRows,
			back_items: backRows,
			deposit_rows: depositRows,
			agent_sale_items: agentRows
		})
	]
	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(touchedBottleNos)
	const bottleDepositReconcileRes = await reconcileBottleCurrentCustomerByDepositSnapshot({
		customerIds: [
			...collectSaleCustomerIdsFromDoc(existing),
			...collectSaleCustomerIdsFromDoc({ customer_id: customer._id })
		],
		bottleNos: touchedBottleNos
	})
	const flow = computeFlow(updateDoc, priceUnit)
	const amounts = computeAmounts({
		settlementMode,
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
			agentRows,
			truckSaleNet,
			truckOutGross,
			truckBackGross,
			truckSettleTare,
			truckSettleGross,
			flow,
			roundingAmount: toNumber(base.roundingAmount, 0)
		})
	const sideWarnings = []
	try {
		await replaceSaleGasInventoryMovement({
			sourceId: recordId,
			saleDoc: { ...updateDoc, _id: recordId },
			bizMode,
			amounts,
			now: Date.now(),
			user
		})
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('库存流水未同步（缺集合）')
		else throw err
	}
	try {
		await syncSaleVoucher(user, { ...updateDoc, _id: recordId }, amounts, requestId)
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('凭证未同步（缺集合）')
		else throw err
	}
	if (settlementMode !== 'customer_flow') {
		const offsetSyncResults = await syncOffsetCreditsByDates(
			customer._id,
			[
				monthStartOf(date, ''),
				date,
				monthStartOf(normalizeString(existing.date), ''),
				normalizeString(existing.date)
			],
			token,
			requestId
		)
		offsetSyncResults.forEach((row) => {
			if (row.code !== 0) sideWarnings.push(`冲抵款同步失败(${row.date})`)
			if (row.unresolved_count > 0) sideWarnings.push(`冲抵款存在未消化差额(${row.date})`)
		})
	}
	if (settlementMode !== 'customer_flow') {
		const prepayApplyRes = await callCustomerSettlement(
			'autoApplyPrepayToSaleV1',
			{
				sale_id: recordId,
				exclude_offset_credit: !nextApplyOffsetCredit
			},
			token,
			requestId
		)
		if (prepayApplyRes.code !== 0) {
			sideWarnings.push(normalizeString(prepayApplyRes.msg) || '客户预付款抵扣未同步')
		} else if (toNumber(prepayApplyRes?.data?.applied_amount, 0) > 0) {
			try {
				await resyncSaleVoucherById(user, recordId, requestId)
			} catch (err) {
				if (isMissingCollectionError(err)) sideWarnings.push('预付款抵扣后凭证未同步（缺集合）')
				else throw err
			}
		}
	}
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: touchedBottleNos,
			truckNos: [
				...collectSaleTruckNosFromDoc(existing),
				...collectSaleTruckNosFromDoc({ biz_mode: bizMode, truck_no: truckNo })
			]
		},
		requestId
	)
	await recordLog(
		user,
		'sale_update_v2',
		{
			id: recordId,
			biz_mode: bizMode,
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			bottle_status_deposit_reconciled_total: bottleDepositReconcileRes.updated_total,
			bottle_status_deposit_forced_total: bottleDepositReconcileRes.forced_customer_total,
			bottle_status_deposit_cleared_total: bottleDepositReconcileRes.cleared_customer_total,
			bottle_status_deposit_conflict_total: bottleDepositReconcileRes.conflict_total,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length,
			bottle_flow_warning_bottles: bottleFlowWarnings.map((item) => `${item.direction}:${item.bottle_no}`),
			touch_warning: touchRes.warning || '',
			side_warnings: sideWarnings
		},
		requestId
	)
	const warningText = [...sideWarnings, touchRes.warning || ''].filter(Boolean).join('；')
	return {
		code: 0,
		msg: warningText ? `更新成功（${warningText}）` : '更新成功',
		data: {
			warning: warningText,
			bottle_flow_warning_overridden: ignoreBottleFlowWarning && bottleFlowWarnings.length > 0,
			bottle_flow_warning_count: bottleFlowWarnings.length,
			bottle_status_deposit_reconciled_total: bottleDepositReconcileRes.updated_total
		}
	}
}

async function updateSettlementV1(user, data, requestId, token) {
	const recordId = normalizeString(data.recordId || data._id || data.id)
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }

	const existingRes = await sales.doc(recordId).get()
	const existing = (existingRes.data && existingRes.data[0]) || null
	if (!existing) return { code: 404, msg: '记录不存在' }

	const payload = data && typeof data.settlement === 'object' ? data.settlement : {}
	const priceUnit = normalizeString(existing && existing.price_unit) || 'kg'
	const settlementMode = priceUnit === 'm3'
		? 'customer_flow'
		: normalizeSettlementMode(existing && existing.settlement_mode, 'sale')
	if (settlementMode === 'customer_flow') {
		return { code: 400, msg: '该销售单按客户对账页流量结算，不能在销售单内登记收款' }
	}

	const existingRounding = Math.max(toNumber(existing && existing.rounding_amount, 0), 0)
	const roundingAmount = Math.max(
		toNumber(payload.roundingAmount ?? payload.rounding_amount, existingRounding),
		0
	)
	const amountReceived = toNumber(
		payload.amountReceived ?? payload.amount_received,
		toNumber(existing && existing.amount_received, 0)
	)
	const settlementDoc = {
		...existing,
		rounding_amount: roundingAmount
	}
	const { amounts } = computeSaleAmountsForDoc(settlementDoc)

	const paymentStatus = normalizePaymentStatus(payload.paymentStatus ?? payload.payment_status ?? existing.payment_status)
	const paymentMethod = normalizePaymentMethod(payload.paymentMethod ?? payload.payment_method ?? existing.payment_method, paymentStatus)
	const paymentNote = normalizeString(payload.paymentNote ?? payload.payment_note ?? existing.payment_note)
	const settlementCheck = validateSettlement({
		shouldReceive: amounts.should_receive,
		paymentStatus,
		paymentMethod,
		amountReceived,
		roundingAmount
	})
	if (!settlementCheck.ok) return { code: 400, msg: settlementCheck.msg }

	const existingOffsetEnabled = resolveSaleOffsetEnabled(existing, true)
	const requestedOffsetEnabled = toBoolean(payload.offsetEnabled ?? payload.offset_enabled, existingOffsetEnabled)
	const existingApplyOffsetCredit = toBoolean(existing && (existing.apply_offset_credit ?? existing.applyOffsetCredit), false)
	const nextApplyOffsetCredit = toBoolean(payload.applyOffsetCredit ?? payload.apply_offset_credit, existingApplyOffsetCredit)

	const effectiveShouldReceive = toNumber(amounts.effective_should_receive, 0)
	const offsetDelta = fix2(Math.max(0, amountReceived - effectiveShouldReceive))
	const nextOffsetEnabled = offsetDelta > 0 ? requestedOffsetEnabled : false
	if (existingOffsetEnabled && !nextOffsetEnabled) {
		const hasAllocated = await hasAllocatedOffsetCreditForSale(normalizeString(existing.customer_id), recordId)
		if (hasAllocated) return { code: 400, msg: '请先在客户对账回滚/调整冲抵分配' }
	}

	const updateDoc = {
		payment_status: paymentStatus,
		payment_method: paymentMethod,
		amount_received: amountReceived,
		rounding_amount: roundingAmount,
		payment_note: paymentNote,
		apply_offset_credit: nextApplyOffsetCredit,
		offset_enabled: nextOffsetEnabled,
		updated_at: Date.now()
	}

	await sales.doc(recordId).update(updateDoc)
	const sideWarnings = []
	try {
		await syncSaleVoucher(user, { ...existing, ...updateDoc, _id: recordId }, amounts, requestId)
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('凭证未同步（缺集合）')
		else throw err
	}

	const date = normalizeString(existing && existing.date)
	const customerId = normalizeString(existing && existing.customer_id)
	if (date && customerId) {
		const offsetSyncResults = await syncOffsetCreditsByDates(
			customerId,
			[monthStartOf(date, ''), date],
			token,
			requestId
		)
		offsetSyncResults.forEach((row) => {
			if (row.code !== 0) sideWarnings.push(`冲抵款同步失败(${row.date})`)
			if (row.unresolved_count > 0) sideWarnings.push(`冲抵款存在未消化差额(${row.date})`)
		})
	}

	const prepayApplyRes = await callCustomerSettlement(
		'autoApplyPrepayToSaleV1',
		{
			sale_id: recordId,
			exclude_offset_credit: !nextApplyOffsetCredit
		},
		token,
		requestId
	)
	if (prepayApplyRes.code !== 0) {
		sideWarnings.push(normalizeString(prepayApplyRes.msg) || '客户预付款抵扣未同步')
	} else if (toNumber(prepayApplyRes?.data?.applied_amount, 0) > 0) {
		try {
			await resyncSaleVoucherById(user, recordId, requestId)
		} catch (err) {
			if (isMissingCollectionError(err)) sideWarnings.push('预付款抵扣后凭证未同步（缺集合）')
			else throw err
		}
	}

	await recordLog(
		user,
		'sale_update_settlement_v1',
		{
			id: recordId,
			payment_status: paymentStatus,
			payment_method: paymentMethod,
			amount_received: amountReceived,
			rounding_amount: roundingAmount,
			apply_offset_credit: nextApplyOffsetCredit,
			offset_enabled: nextOffsetEnabled,
			side_warnings: sideWarnings
		},
		requestId
	)

	const warningText = sideWarnings.filter(Boolean).join('；')
	return {
		code: 0,
		msg: warningText ? `结算更新成功（${warningText}）` : '结算更新成功',
		data: { warning: warningText }
	}
}

async function removeV2(user, data, requestId, token) {
	const recordId = normalizeString(data.recordId || data._id || data.id)
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }

	const saleRes = await sales.doc(recordId).get()
	const saleDoc = (saleRes.data && saleRes.data[0]) || null
	if (!saleDoc) return { code: 404, msg: '记录不存在' }

	const source = `sale:${recordId}`
	const sideWarnings = []
	try {
		const voucherRes = await vouchers.where({ source }).limit(1).get()
		const voucher = (voucherRes.data && voucherRes.data[0]) || null
		if (voucher && normalizeString(voucher.status) === 'posted') {
			return { code: 400, msg: '凭证已过账，禁止删除销售单' }
		}
		if (voucher) {
			await voucherEntries.where({ voucher_id: voucher._id }).remove()
			await vouchers.doc(voucher._id).remove()
		}
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('凭证未同步删除（缺集合）')
		else throw err
	}

	await movements.where({ source_type: 'sale', source_id: recordId }).remove()
	const touchedBottleNos = collectSaleBottleNosFromDoc(saleDoc)
	const bottleStatusSyncRes = await syncBottleCurrentStatusByBottleNos(touchedBottleNos)
	const bottleDepositReconcileRes = await reconcileBottleCurrentCustomerByDepositSnapshot({
		customerIds: collectSaleCustomerIdsFromDoc(saleDoc),
		bottleNos: touchedBottleNos
	})
	try {
		await removeSaleGasInventoryMovement(recordId)
	} catch (err) {
		if (isMissingCollectionError(err)) sideWarnings.push('库存流水未同步删除（缺集合）')
		else throw err
	}
	await sales.doc(recordId).remove()
	const customerId = normalizeString(saleDoc.customer_id)
	const releaseSaleSettlementRes = await callCustomerSettlement(
		'releaseSaleSettlementOnRemoveV1',
		{
			customer_id: customerId,
			sale_id: recordId
		},
		token,
		requestId
	)
	if (releaseSaleSettlementRes.code !== 0) {
		sideWarnings.push(normalizeString(releaseSaleSettlementRes.msg) || '销售结算关联未同步回收')
		const refreshBalanceRes = await callCustomerSettlement(
			'refreshCustomerBalancesV1',
			{ customer_id: customerId },
			token,
			requestId
		)
		if (refreshBalanceRes.code !== 0) {
			sideWarnings.push(normalizeString(refreshBalanceRes.msg) || '客户余额未同步')
		}
	}

	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		{
			bottleNos: touchedBottleNos,
			truckNos: collectSaleTruckNosFromDoc(saleDoc)
		},
		requestId
	)
	await recordLog(
		user,
		'sale_remove_v2',
		{
			id: recordId,
			biz_mode: normalizeString(saleDoc.biz_mode),
			bottle_status_updated_total: bottleStatusSyncRes.updated_total,
			bottle_status_skipped_pending_total: bottleStatusSyncRes.skipped_pending_total,
			bottle_status_deposit_reconciled_total: bottleDepositReconcileRes.updated_total,
			bottle_status_deposit_forced_total: bottleDepositReconcileRes.forced_customer_total,
			bottle_status_deposit_cleared_total: bottleDepositReconcileRes.cleared_customer_total,
			bottle_status_deposit_conflict_total: bottleDepositReconcileRes.conflict_total,
			touch_warning: touchRes.warning || '',
			side_warnings: sideWarnings
		},
		requestId
	)
	const warningText = [...sideWarnings, touchRes.warning || ''].filter(Boolean).join('；')
	return {
		code: 0,
		msg: warningText ? `删除成功（${warningText}）` : '删除成功',
		data: { warning: warningText }
	}
}

async function backfillTruckGrossDiffV1(user, data, requestId) {
	if (normalizeRole(user && user.role) !== 'superadmin') {
		return { code: 403, msg: '仅超级管理员可执行整车毛重差值回填' }
	}
	const execute = toBoolean(data && data.execute, false)
	const clearLegacy = toBoolean(data && data.clear_legacy, false)
	const batchSize = Math.min(Math.max(toNumber(data && data.batch_size, 200), 20), 500)
	let page = 1
	let guard = 0
	let scanned = 0
	let changed = 0
	let clearedLegacy = 0
	while (guard < 2000) {
		const res = await sales
			.where({ biz_mode: 'truck' })
			.field({
				_id: true,
				truck_out_gross: true,
				truck_back_gross: true,
				truck_gross_diff: true,
				truck_sale_net: true
			})
			.skip((page - 1) * batchSize)
			.limit(batchSize)
			.get()
		const docs = Array.isArray(res.data) ? res.data : []
		if (!docs.length) break
		for (const doc of docs) {
			scanned += 1
			const nextGrossDiff = resolveTruckReferenceNetValue(doc.truck_gross_diff, doc.truck_out_gross, doc.truck_back_gross)
			const currentGrossDiff = toNumber(doc.truck_gross_diff, null)
			const needsGrossDiff = currentGrossDiff == null || Math.abs(currentGrossDiff - nextGrossDiff) > 0.001
			const needsLegacyClear = clearLegacy && doc.truck_sale_net != null
			if (!needsGrossDiff && !needsLegacyClear) continue
			if (execute) {
				await sales.doc(doc._id).update({
					truck_gross_diff: nextGrossDiff > 0 ? nextGrossDiff : null,
					truck_sale_net: clearLegacy ? null : doc.truck_sale_net,
					updated_at: Date.now()
				})
			}
			if (needsGrossDiff) changed += 1
			if (needsLegacyClear) clearedLegacy += 1
		}
		if (docs.length < batchSize) break
		page += 1
		guard += 1
	}
	await recordLog(
		user,
		execute ? 'sale_backfill_truck_gross_diff_v1_execute' : 'sale_backfill_truck_gross_diff_v1_preview',
		{
			scanned,
			changed,
			cleared_legacy: clearedLegacy,
			execute,
			clear_legacy: clearLegacy
		},
		requestId
	)
	return {
		code: 0,
		msg: execute ? '整车毛重差值回填完成' : '整车毛重差值预览完成',
		data: {
			execute,
			clear_legacy: clearLegacy,
			scanned,
			changed,
			cleared_legacy: clearedLegacy
		}
	}
}

async function cleanupPaymentMethodV1(user, data, requestId) {
	const execute = Boolean(data && data.execute)
	const sampleLimitRaw = toNumber(data && data.sampleLimit, 10)
	const sampleLimit = Math.min(Math.max(sampleLimitRaw || 10, 1), 50)
	const targetWhere = { payment_method: dbCmd.neq('') }

	const beforeRes = await sales.where(targetWhere).count()
	const beforeTotal = Number(beforeRes.total || 0)

	const sampleRes = await sales
		.where(targetWhere)
		.field({ _id: true, date: true, customer_name: true, payment_status: true, payment_method: true })
		.orderBy('date', 'desc')
		.limit(sampleLimit)
		.get()
	const sample = Array.isArray(sampleRes.data) ? sampleRes.data : []

	if (!execute) {
		await recordLog(user, 'sale_cleanup_payment_method_v1_preview', { before_total: beforeTotal }, requestId)
		return {
			code: 0,
			msg: '预览完成',
			data: {
				execute: false,
				before_total: beforeTotal,
				sample
			}
		}
	}

	let updated = 0
	let rounds = 0
	while (rounds < 2000) {
		const batchRes = await sales.where(targetWhere).field({ _id: true }).limit(200).get()
		const docs = Array.isArray(batchRes.data) ? batchRes.data : []
		if (!docs.length) break
		for (const doc of docs) {
			await sales.doc(doc._id).update({
				payment_method: '',
				updated_at: Date.now()
			})
			updated += 1
		}
		rounds += 1
	}

	const afterRes = await sales.where(targetWhere).count()
	const afterTotal = Number(afterRes.total || 0)
	await recordLog(
		user,
		'sale_cleanup_payment_method_v1_execute',
		{ before_total: beforeTotal, updated, after_total: afterTotal },
		requestId
	)
	return {
		code: 0,
		msg: '清洗完成',
		data: {
			execute: true,
			before_total: beforeTotal,
			updated,
			after_total: afterTotal
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
		cloudFunction: 'crm-sale'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'createV2') return createV2(user, data, requestId, token)
	if (action === 'updateV2') return updateV2(user, data, requestId, token)
	if (action === 'updateSettlementV1') return updateSettlementV1(user, data, requestId, token)
	if (action === 'removeV2') return removeV2(user, data, requestId, token)
	if (action === 'listV2') return listV2(user, data)
	if (action === 'getV2') return getV2(user, data)
	if (action === 'searchAgentFillSuggestionsV1') return searchAgentFillSuggestionsV1(user, data)
	if (action === 'quickReceiveV1') return quickReceiveV1(user, data, requestId, token)
	if (action === 'getCustomerDepositV1') return getCustomerDepositV1(user, data)
	if (action === 'backfillAgentSaleBottleMovementsV1') return backfillAgentSaleBottleMovementsV1(user, data, requestId, token)
	if (action === 'backfillTruckGrossDiffV1') return backfillTruckGrossDiffV1(user, data, requestId)
	if (action === 'cleanupPaymentMethodV1') return cleanupPaymentMethodV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
