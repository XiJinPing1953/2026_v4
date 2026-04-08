'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const customers = db.collection('crm_customers')
const sales = db.collection('crm_sale_records')
const receipts = db.collection('crm_customer_receipts')
const allocations = db.collection('crm_customer_allocations')
const flowSettlements = db.collection('crm_customer_flow_settlements')
const openingDebts = db.collection('crm_customer_opening_debts')
let ensureActionAcl = null
try {
	;({ ensureActionAcl } = require('../common/pageAcl'))
} catch (err) {
	console.warn('[crm-customer-settlement] fallback to local pageAcl helpers', err && err.message)
	;({ ensureActionAcl } = require('./pageAclLocal'))
}

const WRITE_ROLES = ['superadmin', 'admin', 'finance', 'user']
const REBUILD_ROLES = ['superadmin', 'admin', 'finance']
const FLOW_WEIGHT_GO_LIVE_DATE = '2026-01-01'
const STATEMENT_COMPANY_NAME = '无极县新拓能源开发有限公司'
const AUTO_OFFSET_NOTE_PREFIX = '【自动冲抵】'
const PAGE_ACTION_RULES = {
	previewAllocationV1: [{ pagePath: '/pages/customer/statement', action: 'view' }],
	createReceiptV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	updateReceiptV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	removeReceiptV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	confirmAllocationV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	createPrepayEntryV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	repairReceiptAllocationV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	repairOffsetCreditsV1: [
		{ pagePath: '/pages/customer/statement', action: 'update' },
		{ pagePath: '/pages/sale/edit', action: 'create' },
		{ pagePath: '/pages/sale/edit', action: 'update' },
		{ pagePath: '/pages/sale/detail', action: 'update' }
	],
	autoApplyPrepayToSaleV1: [
		{ pagePath: '/pages/customer/statement', action: 'update' },
		{ pagePath: '/pages/sale/edit', action: 'create' },
		{ pagePath: '/pages/sale/edit', action: 'update' }
	],
	autoApplyPrepayToFlowSettlementV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	previewFlowSettlementV1: [{ pagePath: '/pages/customer/statement', action: 'view' }],
	createFlowSettlementV1: [{ pagePath: '/pages/customer/statement', action: 'create' }],
	updateFlowSettlementV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	removeFlowSettlementV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	createOpeningDebtEntryV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	updateOpeningDebtEntryV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	removeOpeningDebtEntryV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	createOtherFeeEntryV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	updateOtherFeeEntryV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	removeOtherFeeEntryV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	releaseSaleSettlementOnRemoveV1: [
		{ pagePath: '/pages/sale/detail', action: 'delete' },
		{ pagePath: '/pages/customer/statement', action: 'update' }
	],
	listOffsetCreditPoolV1: [
		{ pagePath: '/pages/customer/statement', action: 'view' },
		{ pagePath: '/pages/sale/edit', action: 'create' },
		{ pagePath: '/pages/sale/edit', action: 'update' },
		{ pagePath: '/pages/sale/detail', action: 'update' }
	],
	allocateOffsetCreditV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	getCustomerStatementAnalysisV1: [{ pagePath: '/pages/customer/statement', action: 'view' }],
	exportCustomerStatementV1: [{ pagePath: '/pages/customer/statement', action: 'view' }],
	refreshCustomerBalancesV1: [{ pagePath: '/pages/customer/statement', action: 'update' }],
	getCustomerStatementV1: [{ pagePath: '/pages/customer/statement', action: 'view' }],
	listCustomerStatementRowsV1: [{ pagePath: '/pages/customer/statement', action: 'view' }]
}
const SUPERADMIN_ONLY_ACTIONS = ['rebuildOpeningBalancesV1']

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
		console.error('[crm-customer-settlement] recordLog failed', action, err)
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

function truncateByScale(value, scale = 2) {
	const digits = Math.max(Math.floor(toNumber(scale, 0)), 0)
	const text = normalizeDecimalText(value)
	if (!text) return 0
	const sourceScale = countDecimalPlaces(text)
	const parsed = parseScaledBigInt(text, sourceScale)
	if (parsed == null) return 0
	const scaled = scaleBigInt(parsed, sourceScale, digits)
	const factor = 10 ** digits
	if (!Number.isFinite(factor) || factor <= 0) return Number(scaled)
	return Number(scaled) / factor
}

function fix3(value) {
	return truncateByScale(value, 3)
}

function fixByScale(value, scale = 2) {
	return Number(scale) === 3 ? fix3(value) : fix2(value)
}

function resolveMoneyScaleByPriceUnit(priceUnit) {
	return normalizeString(priceUnit) === 'm3' ? 3 : 2
}

function resolveCustomerMoneyScale(customerDoc) {
	return resolveMoneyScaleByPriceUnit(customerDoc && customerDoc.default_price_unit)
}

function countDecimalPlaces(text) {
	const source = normalizeString(text)
	const dotIndex = source.indexOf('.')
	if (dotIndex < 0) return 0
	return Math.max(source.length - dotIndex - 1, 0)
}

function parseScaledBigInt(text, scaleDigits) {
	const source = normalizeString(text)
	if (!source) return null
	const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
	if (!match) return null
	const sign = match[1] === '-' ? -1n : 1n
	const integerPart = match[2] || '0'
	const decimalPart = (match[3] || '').padEnd(scaleDigits, '0').slice(0, scaleDigits)
	const combined = `${integerPart}${decimalPart}`.replace(/^0+(?=\d)/, '') || '0'
	return sign * BigInt(combined)
}

function pow10BigInt(digits) {
	const value = Number(digits)
	if (!Number.isFinite(value) || value <= 0) return 1n
	return 10n ** BigInt(Math.floor(value))
}

function scaleBigInt(value, fromScale, toScale) {
	if (fromScale === toScale) return value
	if (fromScale < toScale) {
		return value * pow10BigInt(toScale - fromScale)
	}
	return value / pow10BigInt(fromScale - toScale)
}

function normalizeDecimalText(value) {
	const raw = value == null ? '' : String(value).trim()
	if (!raw) return ''
	if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return raw
	const num = Number(raw)
	if (!Number.isFinite(num)) return ''
	return String(num)
}

function normalizeFlowValue3(value) {
	const text = normalizeDecimalText(value)
	if (!text) return null
	const sourceScale = countDecimalPlaces(text)
	const parsed = parseScaledBigInt(text, sourceScale)
	if (parsed == null) return null
	const scaled = scaleBigInt(parsed, sourceScale, 3)
	return Number(scaled) / 1000
}

function calcFlowVolume3(currValue, prevValue) {
	const currText = normalizeDecimalText(currValue)
	const prevText = normalizeDecimalText(prevValue)
	if (!currText || !prevText) return null
	const sourceScale = Math.max(countDecimalPlaces(currText), countDecimalPlaces(prevText), 0)
	const currScaled = parseScaledBigInt(currText, sourceScale)
	const prevScaled = parseScaledBigInt(prevText, sourceScale)
	if (currScaled == null || prevScaled == null) return null
	let diff = currScaled - prevScaled
	if (diff < 0n) diff = 0n
	const diff3 = scaleBigInt(diff, sourceScale, 3)
	return Number(diff3) / 1000
}

function formatAmount2(value) {
	return fix2(value).toFixed(2)
}

function formatAmountByScale(value, scale = 2) {
	const digits = Number(scale) === 3 ? 3 : 2
	return fixByScale(value, digits).toFixed(digits)
}

function extractOffsetSourceDateFromNote(note) {
	const text = normalizeString(note)
	if (!text) return ''
	const matched = text.match(/^自动冲抵来源\s+(\d{4}-\d{2}-\d{2})/)
	return matched ? normalizeDate(matched[1]) : ''
}

function resolveOffsetSourceDateFromAllocation(row) {
	const date = normalizeDate(row && row.receipt_biz_date)
	if (date) return date
	return extractOffsetSourceDateFromNote(row && row.note)
}

function isOffsetAllocationRow(row) {
	const sourceType = normalizeString(row && row.source_type)
	if (sourceType === 'offset_manual_allocate') return true
	const entryKind = normalizeEntryKind(row && row.receipt_entry_kind, '')
	if (entryKind === 'offset_credit') return true
	const receiptSourceType = normalizeString(row && row.receipt_source_type)
	if (receiptSourceType.startsWith('sale_offset_credit')) return true
	const note = normalizeString(row && row.note)
	if (note.startsWith('自动冲抵来源 ')) return true
	if (sourceType && sourceType !== 'sale_auto_prepay' && sourceType !== 'flow_auto_prepay') return false
	return false
}

function sortOffsetSourceRows(rows = []) {
	return (rows || []).slice().sort((a, b) => {
		const left = normalizeDate(a && a.date)
		const right = normalizeDate(b && b.date)
		if (left === right) return 0
		if (!left) return 1
		if (!right) return -1
		return left < right ? -1 : 1
	})
}

function buildSaleOffsetSummaryMap(rows = []) {
	const bucket = new Map()
	for (const row of rows || []) {
		if (!isOffsetAllocationRow(row)) continue
		const saleId = normalizeId(row && row.sale_id)
		if (!saleId) continue
		const amount = fix2(toNumber(row && row.allocate_amount, 0))
		if (!(amount > 0)) continue
		const sourceDate = resolveOffsetSourceDateFromAllocation(row)
		if (!bucket.has(saleId)) {
			bucket.set(saleId, {
				offset_applied_amount: 0,
				source_map: new Map()
			})
		}
		const item = bucket.get(saleId)
		item.offset_applied_amount = fix2(item.offset_applied_amount + amount)
		item.source_map.set(sourceDate, fix2(toNumber(item.source_map.get(sourceDate), 0) + amount))
	}
	const summaryMap = new Map()
	for (const [saleId, item] of bucket.entries()) {
		const offsetSources = sortOffsetSourceRows(
			Array.from(item.source_map.entries()).map(([date, amount]) => ({
				date,
				amount: fix2(amount)
			}))
		)
		summaryMap.set(saleId, {
			offset_applied_amount: fix2(item.offset_applied_amount),
			offset_sources: offsetSources
		})
	}
	return summaryMap
}

function buildOffsetAppliedTargetMap(rows = []) {
	const map = new Map()
	for (const row of rows || []) {
		if (!isOffsetAllocationRow(row)) continue
		const targetType = normalizeReceivableTargetType(row && row.target_type)
		const targetId = normalizeId(row && (row.target_id || row.sale_id || row.flow_settlement_id))
		if (!targetId) continue
		const amount = fix2(toNumber(row && row.allocate_amount, 0))
		if (!(amount > 0)) continue
		const key = `${targetType}:${targetId}`
		map.set(key, fix2(toNumber(map.get(key), 0) + amount))
	}
	return map
}

async function buildBusinessSummaryFromTargets(
	customer,
	{
		salesDocs = [],
		flowDocs = [],
		openingDebtDocs = []
	} = {}
) {
	const customerId = normalizeId(customer && customer._id)
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const targetIds = Array.from(
		new Set(
			[
				...salesDocs.map((doc) => normalizeId(doc && doc._id)),
				...flowDocs.map((doc) => normalizeId(doc && doc._id)),
				...openingDebtDocs.map((doc) => normalizeId(doc && doc._id))
			].filter(Boolean)
		)
	)
	const offsetAllocRows = targetIds.length
		? await listSaleAutoAllocationsBySaleIds(customerId, targetIds, 5000)
		: []
	const offsetAppliedTargetMap = buildOffsetAppliedTargetMap(offsetAllocRows)
	const getOffsetApplied = (targetType, targetId) =>
		fixMoney(toNumber(offsetAppliedTargetMap.get(`${normalizeReceivableTargetType(targetType)}:${normalizeId(targetId)}`), 0))

	let receivable = 0
	let shouldTotal = 0
	let receivedTotal = 0
	for (const doc of salesDocs) {
		const snapshot = computeSaleSnapshot(doc)
		const saleId = normalizeId(doc && doc._id)
		const offsetApplied = getOffsetApplied('sale', saleId)
		const businessReceived = fixMoney(Math.max(snapshot.amount_received - offsetApplied, 0))
		shouldTotal = fixMoney(shouldTotal + snapshot.should_receive_effective)
		receivedTotal = fixMoney(receivedTotal + businessReceived)
		receivable = fixMoney(receivable + snapshot.outstanding)
	}
	for (const doc of flowDocs) {
		const snapshot = computeFlowSettlementSnapshot(doc)
		const flowSettlementId = normalizeId(doc && doc._id)
		const offsetApplied = getOffsetApplied('flow_settlement', flowSettlementId)
		const businessReceived = fixMoney(Math.max(snapshot.amount_received - offsetApplied, 0))
		shouldTotal = fixMoney(shouldTotal + snapshot.should_receive)
		receivedTotal = fixMoney(receivedTotal + businessReceived)
		receivable = fixMoney(receivable + snapshot.outstanding)
	}
	for (const doc of openingDebtDocs) {
		const snapshot = computeOpeningDebtSnapshot(doc, moneyScale)
		const openingDebtId = normalizeId(doc && doc._id)
		const targetType = resolveOpeningDebtEntryType(doc)
		const offsetApplied = getOffsetApplied(targetType, openingDebtId)
		const businessReceived = fixMoney(Math.max(snapshot.amount_received - offsetApplied, 0))
		shouldTotal = fixMoney(shouldTotal + snapshot.should_receive_effective)
		receivedTotal = fixMoney(receivedTotal + businessReceived)
		receivable = fixMoney(receivable + snapshot.outstanding)
	}

	return {
		receivable_balance: receivable,
		should_receive_total: shouldTotal,
		amount_received_total: receivedTotal
	}
}

function chunkStrings(list = [], size = 80) {
	const source = Array.isArray(list) ? list : []
	const chunkSize = Math.max(toNumber(size, 80), 1)
	const out = []
	for (let index = 0; index < source.length; index += chunkSize) {
		out.push(source.slice(index, index + chunkSize))
	}
	return out
}

async function listSaleAutoAllocationsBySaleIds(customerId, saleIds = [], limitPerChunk = 5000) {
	const normalizedCustomerId = normalizeId(customerId)
	if (!normalizedCustomerId) return []
	const uniqueSaleIds = Array.from(
		new Set(
			(Array.isArray(saleIds) ? saleIds : [])
				.map((item) => normalizeId(item))
				.filter(Boolean)
		)
	)
	if (!uniqueSaleIds.length) return []
	const maxRows = Math.min(Math.max(toNumber(limitPerChunk, 5000), 1), 5000)
	const allRows = []
	for (const saleIdChunk of chunkStrings(uniqueSaleIds, 80)) {
		let page = 1
		let guard = 0
		let loaded = 0
		while (guard < 500 && loaded < maxRows) {
			const res = await allocations
				.where(
					dbCmd.and([
						{ customer_id: normalizedCustomerId },
						{ source_type: dbCmd.in(['sale_auto_prepay', 'flow_auto_prepay', 'offset_manual_allocate']) },
						{ sale_id: dbCmd.in(saleIdChunk) }
					])
				)
				.orderBy('created_at', 'asc')
				.skip((page - 1) * 200)
				.limit(200)
				.get()
			const list = Array.isArray(res.data) ? res.data : []
			if (!list.length) break
			allRows.push(...list)
			loaded += list.length
			if (list.length < 200 || loaded >= maxRows) break
			page += 1
			guard += 1
		}
	}
	return allRows
}

async function getSaleOffsetSummaryMap(customerId, saleIds = []) {
	const rows = await listSaleAutoAllocationsBySaleIds(customerId, saleIds, 5000)
	return buildSaleOffsetSummaryMap(rows)
}

function buildAutoOffsetPaymentNote(summary) {
	const offsetTotal = fix2(toNumber(summary && summary.offset_applied_amount, 0))
	const sourceRows = Array.isArray(summary && summary.offset_sources) ? summary.offset_sources : []
	if (!(offsetTotal > 0) || !sourceRows.length) return ''
	const parts = sourceRows
		.map((row) => {
			const amount = fix2(toNumber(row && row.amount, 0))
			if (!(amount > 0)) return ''
			const date = normalizeDate(row && row.date) || '-'
			return `${date}¥${formatAmount2(amount)}`
		})
		.filter(Boolean)
	if (!parts.length) return ''
	return `${AUTO_OFFSET_NOTE_PREFIX}${parts.join(' + ')} = ¥${formatAmount2(offsetTotal)}`
}

function mergePaymentNoteWithAutoOffset(baseNote, autoOffsetNote) {
	const manualLines = normalizeString(baseNote)
		.split(/\r?\n+/)
		.map((line) => normalizeString(line))
		.filter((line) => line && !line.startsWith(AUTO_OFFSET_NOTE_PREFIX))
	const offsetLine = normalizeString(autoOffsetNote)
	if (offsetLine) manualLines.push(offsetLine)
	return manualLines.join('\n')
}

function normalizeDate(value) {
	const text = normalizeString(value)
	if (!text) return ''
	const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (ymd) return ymd[0]
	const parsed = Date.parse(text)
	if (!Number.isFinite(parsed) || parsed <= 0) return ''
	return formatDate(new Date(parsed))
}

function formatDate(date) {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function normalizeBizDate(value, fallbackTs = Date.now()) {
	const date = normalizeDate(value)
	if (date) return date
	return formatDate(new Date(fallbackTs))
}

function parseBizDateToTimestamp(value) {
	const date = normalizeDate(value)
	if (!date) return null
	const parsed = Date.parse(`${date}T00:00:00+08:00`)
	if (!Number.isFinite(parsed) || parsed <= 0) return null
	return parsed
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function canWrite(user, allowedRoles = WRITE_ROLES) {
	const role = normalizeString(user?.role)
	return (allowedRoles || []).includes(role)
}

async function ensureWritePermission(user, actionName, requestId, allowedRoles = WRITE_ROLES) {
	if (canWrite(user, allowedRoles)) return { ok: true }
	await recordLog(user, 'customer_settlement_forbidden', { action: actionName }, requestId)
	return { ok: false, code: 403, msg: '仅管理员可操作' }
}

function normalizePaymentStatus(value) {
	const text = normalizeString(value)
	if (text === 'paid' || text === '已结清') return 'paid'
	if (text === 'partial' || text === '部分付') return 'partial'
	if (text === 'unpaid' || text === '未付款' || text === '挂账') return 'unpaid'
	return 'unpaid'
}

function normalizePaymentMethod(value, paymentStatus = 'unpaid') {
	const status = normalizePaymentStatus(paymentStatus)
	const text = normalizeString(value).toLowerCase()
	if (status === 'unpaid') return 'on_account'
	if (text === 'cash' || text === '现金') return 'cash'
	if (text === 'bank' || text === '银行' || text === '转账' || text === '银行转账') return 'bank'
	if (text === 'wechat' || text === '微信') return 'wechat'
	if (text === 'alipay' || text === '支付宝') return 'alipay'
	if (text === 'check' || text === 'cheque' || text === '支票') return 'check'
	if (text === 'on_account' || text === '挂账') return 'cash'
	return 'cash'
}

function normalizeAllocationMode(value, fallback = 'period') {
	const text = normalizeString(value).toLowerCase()
	if (text === 'period') return 'period'
	if (text === 'checked') return 'checked'
	return fallback
}

function normalizeEntryKind(value, fallback = 'prepay') {
	const text = normalizeString(value).toLowerCase()
	if (text === 'offset_credit' || text === 'offset') return 'offset_credit'
	if (text === 'prepay') return 'prepay'
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

function isOffsetCreditReceiptRow(row) {
	const sourceType = normalizeString(row && row.source_type)
	if (sourceType.startsWith('sale_offset_credit')) return true
	const entryKind = normalizeEntryKind(row && row.entry_kind, '')
	return entryKind === 'offset_credit'
}

function normalizeAllocationTargets(raw = []) {
	const source = Array.isArray(raw) ? raw : []
	const unique = new Map()
	for (const item of source) {
		const targetType = normalizeReceivableTargetType(item && (item.target_type || item.targetType))
		const targetId = normalizeId(item && (item.target_id || item.targetId || item.sale_id || item.saleId || item._id))
		if (!targetId) continue
		const key = `${targetType}:${targetId}`
		if (unique.has(key)) continue
		unique.set(key, {
			target_type: targetType,
			target_id: targetId
		})
	}
	return Array.from(unique.values())
}

function normalizePrepayApplyStrategy(value, fallback = 'hold_only') {
	const text = normalizeString(value).toLowerCase()
	if (text === 'hold_only' || text === 'hold' || text === '仅入预付') return 'hold_only'
	if (text === 'allocate_period' || text === 'period' || text === '立即冲欠') return 'allocate_period'
	return fallback
}

function resolveAllocationConfig(data = {}, fallbackDate = '') {
	const mode = normalizeAllocationMode(data.allocation_mode || data.allocationMode, 'period')
	const startDate = normalizeDate(data.allocation_start_date || data.allocationStartDate)
	const endDate = normalizeDate(data.allocation_end_date || data.allocationEndDate)
	const targets = normalizeAllocationTargets(data.allocation_targets || data.allocationTargets)
	const hasPeriodInput = Boolean(startDate || endDate)
	const hasTargetsInput = targets.length > 0
	if (mode === 'period') {
		if (hasTargetsInput) return { ok: false, code: 400, msg: '时间段分配与勾选分配不能同时使用' }
		if (!startDate || !endDate) return { ok: false, code: 400, msg: '请填写分配开始日期和结束日期' }
		if (startDate > endDate) return { ok: false, code: 400, msg: '分配开始日期不能晚于结束日期' }
		return {
			ok: true,
			allocation_mode: mode,
			allocation_start_date: startDate,
			allocation_end_date: endDate,
			allocation_targets: []
		}
	}
	if (mode === 'checked') {
		if (hasPeriodInput) return { ok: false, code: 400, msg: '勾选分配模式下不能填写日期区间' }
		if (!hasTargetsInput) return { ok: false, code: 400, msg: '请先勾选至少一条待分配单据' }
		const fallbackYmd = normalizeDate(fallbackDate)
		return {
			ok: true,
			allocation_mode: mode,
			allocation_start_date: fallbackYmd,
			allocation_end_date: fallbackYmd,
			allocation_targets: targets
		}
	}
	return {
		ok: true,
		allocation_mode: mode,
		allocation_start_date: startDate || normalizeDate(fallbackDate),
		allocation_end_date: endDate || normalizeDate(fallbackDate),
		allocation_targets: targets
	}
}

function resolvePaymentStatusByAmount(shouldReceive, amountReceived, scale = 2) {
	const moneyScale = Number(scale) === 3 ? 3 : 2
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const should = fixMoney(shouldReceive)
	const received = fixMoney(amountReceived)
	if (should <= 0) return 'paid'
	if (received <= 0) return 'unpaid'
	if (received >= should) return 'paid'
	return 'partial'
}

function resolveEffectiveShouldReceive(shouldReceive, roundingAmount) {
	const should = fix2(toNumber(shouldReceive, 0))
	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	if (should > 0) return fix2(should - rounding)
	if (should < 0) return fix2(should + rounding)
	return 0
}

function normalizeSettlementMode(value, fallback = 'sale') {
	const text = normalizeString(value)
	if (text === 'customer_flow' || text === 'sale') return text
	return fallback
}

function normalizeReceivableTargetType(value) {
	const text = normalizeString(value)
	if (text === 'flow_settlement' || text === 'sale' || text === 'opening_debt' || text === 'other_fee') return text
	return 'sale'
}

function isOtherFeeSourceType(value) {
	const text = normalizeString(value).toLowerCase()
	if (!text) return false
	return text.includes('other_fee')
}

function resolveOpeningDebtEntryType(doc) {
	return isOtherFeeSourceType(doc && doc.source_type) ? 'other_fee' : 'opening_debt'
}

function resolveOpeningDebtRoundingAmount(amountValue, roundingValue, moneyScale = 2) {
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const amount = fixMoney(Math.max(toNumber(amountValue, 0), 0))
	if (!(amount > 0)) return 0
	const rounding = fixMoney(Math.max(toNumber(roundingValue, 0), 0))
	return fixMoney(Math.min(rounding, amount))
}

function openingDebtEntryLabelByType(entryType) {
	return normalizeReceivableTargetType(entryType) === 'other_fee' ? '其他费用' : '历史欠款'
}

function buildOpeningDebtTargetTitle({ entryType = 'opening_debt', bizDate = '', targetId = '' } = {}) {
	const label = openingDebtEntryLabelByType(entryType)
	const id = normalizeId(targetId)
	return `${label} ${normalizeString(bizDate)} / ${id.slice(-6)}`
}

function computeFlow(base, priceUnit) {
	let flowIndexPrev = normalizeFlowValue3(base.flow_index_prev)
	let flowIndexCurr = normalizeFlowValue3(base.flow_index_curr)
	let flowVolumeM3 = normalizeFlowValue3(base.flow_volume_m3)
	const flowTheoryRatio = toNumber(base.flow_theory_ratio, null)

	if (flowVolumeM3 == null && flowIndexPrev != null && flowIndexCurr != null) {
		flowVolumeM3 = calcFlowVolume3(flowIndexCurr, flowIndexPrev)
		if (flowVolumeM3 == null) flowVolumeM3 = 0
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

function computeAmounts({ settlementMode = 'sale', bizMode, priceUnit, unitPrice, outItems, backItems, agentRows, truckSaleNet, flow, roundingAmount }) {
	const outNetTotal = outItems.reduce((sum, item) => sum + toNumber(item && item.net, 0), 0)
	const backNetTotal = backItems.reduce((sum, item) => sum + toNumber(item && item.net, 0), 0)

	let totalNetWeight = outNetTotal - backNetTotal
	if (bizMode === 'truck') totalNetWeight = toNumber(truckSaleNet, 0)

	let outAmount = 0
	let backAmount = 0
	let shouldReceive = 0

	if (normalizeSettlementMode(settlementMode) === 'customer_flow') {
		return {
			out_net_total: fix2(outNetTotal),
			back_net_total: fix2(backNetTotal),
			total_net_weight: fix2(totalNetWeight),
			out_amount: 0,
			back_amount: 0,
			rounding_amount: 0,
			effective_should_receive: 0,
			should_receive: 0
		}
	}

	if (bizMode === 'agent_sale') {
		const totalWeight = agentRows.reduce((sum, row) => sum + toNumber(row && row.fill_weight, 0), 0)
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
	const effectiveShouldReceive = resolveEffectiveShouldReceive(shouldReceive, rounding)

	return {
		out_net_total: fix2(outNetTotal),
		back_net_total: fix2(backNetTotal),
		total_net_weight: fix2(totalNetWeight),
		out_amount: fix2(outAmount),
		back_amount: fix2(backAmount),
		rounding_amount: fix2(rounding),
		effective_should_receive: fix2(effectiveShouldReceive),
		should_receive: fix2(shouldReceive)
	}
}

function computeSaleSnapshot(doc) {
	const bizMode = normalizeString(doc && doc.biz_mode) || 'bottle'
	const priceUnit = normalizeString(doc && doc.price_unit) || 'kg'
	const settlementMode = normalizeSettlementMode(doc && doc.settlement_mode, 'sale')
	const unitPrice = toNumber(doc && doc.unit_price, 0)
	const outItems = Array.isArray(doc && doc.out_items) ? doc.out_items : []
	const backItems = Array.isArray(doc && doc.back_items) ? doc.back_items : []
	const agentRows = Array.isArray(doc && doc.agent_sale_items) ? doc.agent_sale_items : []
	const truckSaleNet = resolveTruckSaleNetValue(doc && (doc.truck_gross_diff ?? doc.truck_sale_net), doc && doc.truck_out_gross, doc && doc.truck_back_gross)
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
		flow,
		roundingAmount: toNumber(doc && doc.rounding_amount, 0)
	})
	const shouldReceive = fix2(amounts.should_receive)
	const effectiveShouldReceive = fix2(amounts.effective_should_receive)
	const amountReceived = fix2(toNumber(doc && doc.amount_received, 0))
	const outstanding = effectiveShouldReceive > amountReceived ? fix2(effectiveShouldReceive - amountReceived) : 0
	return {
		should_receive: shouldReceive,
		should_receive_effective: effectiveShouldReceive,
		amount_received: amountReceived,
		outstanding,
		payment_status: resolvePaymentStatusByAmount(effectiveShouldReceive, amountReceived)
	}
}

function normalizeBottleNo(value) {
	const text = normalizeString(value)
	if (!text) return ''
	return text.toUpperCase().replace(/\s+/g, '')
}

function collectBottleNosFromRows(rows = []) {
	const set = new Set()
	const source = Array.isArray(rows) ? rows : []
	for (const row of source) {
		const bottleNo = normalizeBottleNo(
			row && (row.bottle_no || row.bottleNo || row.no || row.id)
		)
		if (!bottleNo) continue
		set.add(bottleNo)
	}
	return Array.from(set)
}

function countBottleNosFromRows(rows = []) {
	return collectBottleNosFromRows(rows).length
}

function buildSaleDepositBalanceSnapshotMap(salesDocs = [], previewLimit = 20) {
	const docs = Array.isArray(salesDocs) ? salesDocs : []
	const depositSet = new Set()
	const snapshotMap = new Map()
	const limit = Math.max(toNumber(previewLimit, 20), 1)
	for (const doc of docs) {
		const saleId = normalizeId(doc && doc._id)
		const outNos = collectBottleNosFromRows(doc && doc.out_items)
		const backNos = collectBottleNosFromRows(doc && doc.back_items)
		const depositNos = collectBottleNosFromRows(doc && doc.deposit_rows)
		const hasOutOrBack = outNos.length > 0 || backNos.length > 0

		outNos.forEach((bottleNo) => {
			depositSet.add(bottleNo)
		})
		// 仅纯存瓶补录（无出/回）时采纳存瓶行，避免历史残留污染“截止本单”存瓶快照。
		if (!hasOutOrBack) {
			depositNos.forEach((bottleNo) => {
				depositSet.add(bottleNo)
			})
		}
		backNos.forEach((bottleNo) => {
			depositSet.delete(bottleNo)
		})

		if (saleId) {
			const allBottles = Array.from(depositSet).sort()
			snapshotMap.set(saleId, {
				count: allBottles.length,
				bottles_preview: allBottles.slice(0, limit),
				bottles_truncated: allBottles.length > limit
			})
		}
	}
	return snapshotMap
}

function resolveTruckSaleNetValue(rawTruckSaleNet, rawTruckOutGross, rawTruckBackGross) {
	const outGross = toNumber(rawTruckOutGross, null)
	const backGross = toNumber(rawTruckBackGross, null)
	if (outGross != null && backGross != null) {
		const diff = outGross - backGross
		return diff > 0 ? fix2(diff) : 0
	}
	const explicit = toNumber(rawTruckSaleNet, null)
	return explicit != null && explicit > 0 ? fix2(explicit) : 0
}

function computeSaleActualWeight(doc) {
	const current = doc && typeof doc === 'object' ? doc : {}
	const bizMode = normalizeString(current.biz_mode) || 'bottle'
	if (bizMode === 'truck') {
		return resolveTruckSaleNetValue(current.truck_gross_diff ?? current.truck_sale_net, current.truck_out_gross, current.truck_back_gross)
	}
	if (bizMode === 'agent_sale') {
		const total = (Array.isArray(current.agent_sale_items) ? current.agent_sale_items : []).reduce(
			(sum, row) => sum + toNumber(row && row.fill_weight, 0),
			0
		)
		return fix2(total)
	}
	const amounts = computeAmounts({
		settlementMode: 'sale',
		bizMode,
		priceUnit: normalizeString(current.price_unit) || 'kg',
		unitPrice: toNumber(current.unit_price, 0),
		outItems: Array.isArray(current.out_items) ? current.out_items : [],
		backItems: Array.isArray(current.back_items) ? current.back_items : [],
		agentRows: Array.isArray(current.agent_sale_items) ? current.agent_sale_items : [],
		truckSaleNet: resolveTruckSaleNetValue(current.truck_gross_diff ?? current.truck_sale_net, current.truck_out_gross, current.truck_back_gross),
		flow: computeFlow(current, normalizeString(current.price_unit) || 'kg'),
		roundingAmount: toNumber(current.rounding_amount, 0)
	})
	return fix2(toNumber(amounts.total_net_weight, 0))
}

function computeFlowSettlementSnapshot(doc) {
	const shouldReceive = fix3(toNumber(doc && doc.should_receive, 0))
	const amountReceived = fix3(toNumber(doc && doc.amount_received, 0))
	const outstanding = shouldReceive > amountReceived ? fix3(shouldReceive - amountReceived) : 0
	return {
		should_receive: shouldReceive,
		amount_received: amountReceived,
		outstanding,
		payment_status: resolvePaymentStatusByAmount(shouldReceive, amountReceived, 3)
	}
}

function computeOpeningDebtSnapshot(doc, moneyScale = 2) {
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const amount = fixMoney(toNumber(doc && doc.amount, 0))
	const roundingAmount = resolveOpeningDebtRoundingAmount(amount, doc && doc.rounding_amount, moneyScale)
	const effectiveShouldReceive = amount > 0 ? fixMoney(Math.max(amount - roundingAmount, 0)) : 0
	const amountReceived = fixMoney(toNumber(doc && doc.amount_received, 0))
	const outstanding = effectiveShouldReceive > amountReceived ? fixMoney(effectiveShouldReceive - amountReceived) : 0
	return {
		amount,
		rounding_amount: roundingAmount,
		should_receive_effective: effectiveShouldReceive,
		amount_received: amountReceived,
		outstanding,
		payment_status: resolvePaymentStatusByAmount(effectiveShouldReceive, amountReceived, moneyScale)
	}
}

function resolveOpeningDebtMoneyScale(doc, fallback = 2) {
	const fixedFallback = Number(fallback) === 3 ? 3 : 2
	const scale = Number(doc && doc.money_scale)
	if (scale === 3) return 3
	if (scale === 2) return 2
	return fixedFallback
}

async function getCustomerById(customerId) {
	const id = normalizeId(customerId)
	if (!id) return null
	const res = await customers.doc(id).get()
	return (res.data && res.data[0]) || null
}

async function listCustomerSales(customerId, { dateFrom = '', dateTo = '' } = {}) {
	const id = normalizeId(customerId)
	if (!id) return []
	const whereParts = [{ customer_id: id }]
	if (dateFrom) whereParts.push({ date: dbCmd.gte(dateFrom) })
	if (dateTo) whereParts.push({ date: dbCmd.lte(dateTo) })
	const where = whereParts.length === 1 ? whereParts[0] : dbCmd.and(whereParts)

	const rows = []
	const batchSize = 200
	let page = 1
	let guard = 0
	while (guard < 500) {
		const res = await sales
			.where(where)
			.orderBy('date', 'asc')
			.orderBy('created_at', 'asc')
			.skip((page - 1) * batchSize)
			.limit(batchSize)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		if (!list.length) break
		rows.push(...list)
		if (list.length < batchSize) break
		page += 1
		guard += 1
	}
	return rows
}

async function listCustomerFlowSettlements(customerId, { dateFrom = '', dateTo = '', limit = 5000 } = {}) {
	const id = normalizeId(customerId)
	if (!id) return []
	const whereParts = [{ customer_id: id }, { status: 'posted' }]
	if (dateFrom) whereParts.push({ biz_date: dbCmd.gte(dateFrom) })
	if (dateTo) whereParts.push({ biz_date: dbCmd.lte(dateTo) })
	const where = whereParts.length === 1 ? whereParts[0] : dbCmd.and(whereParts)
	const batchSize = Math.min(Math.max(toNumber(limit, 5000), 1), 5000)
	const rows = []
	let page = 1
	let guard = 0
	while (guard < 500 && rows.length < batchSize) {
		const res = await flowSettlements
			.where(where)
			.orderBy('biz_date', 'asc')
			.orderBy('created_at', 'asc')
			.skip((page - 1) * 200)
			.limit(200)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		if (!list.length) break
		rows.push(...list)
		if (list.length < 200 || rows.length >= batchSize) break
		page += 1
		guard += 1
	}
	return rows.slice(0, batchSize)
}

async function listCustomerReceipts(customerId, { dateFrom = '', dateTo = '', dateBefore = '', limit = 5000 } = {}) {
	const id = normalizeId(customerId)
	if (!id) return []
	const whereParts = [{ customer_id: id }, { status: 'posted' }]
	if (dateFrom) whereParts.push({ biz_date: dbCmd.gte(dateFrom) })
	if (dateTo) whereParts.push({ biz_date: dbCmd.lte(dateTo) })
	if (dateBefore) whereParts.push({ biz_date: dbCmd.lt(dateBefore) })
	const where = whereParts.length === 1 ? whereParts[0] : dbCmd.and(whereParts)
	const batchSize = Math.min(Math.max(toNumber(limit, 5000), 1), 5000)
	const rows = []
	let page = 1
	let guard = 0
	while (guard < 500 && rows.length < batchSize) {
		const res = await receipts
			.where(where)
			.orderBy('biz_date', 'asc')
			.orderBy('created_at', 'asc')
			.skip((page - 1) * 200)
			.limit(200)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		if (!list.length) break
		rows.push(...list)
		if (list.length < 200 || rows.length >= batchSize) break
		page += 1
		guard += 1
	}
	return rows.slice(0, batchSize)
}

async function listCustomerOpeningDebts(customerId, { dateFrom = '', dateTo = '', dateBefore = '', limit = 5000 } = {}) {
	const id = normalizeId(customerId)
	if (!id) return []
	const whereParts = [{ customer_id: id }, { status: 'posted' }]
	if (dateFrom) whereParts.push({ biz_date: dbCmd.gte(dateFrom) })
	if (dateTo) whereParts.push({ biz_date: dbCmd.lte(dateTo) })
	if (dateBefore) whereParts.push({ biz_date: dbCmd.lt(dateBefore) })
	const where = whereParts.length === 1 ? whereParts[0] : dbCmd.and(whereParts)
	const batchSize = Math.min(Math.max(toNumber(limit, 5000), 1), 5000)
	const rows = []
	let page = 1
	let guard = 0
	while (guard < 500 && rows.length < batchSize) {
		const res = await openingDebts
			.where(where)
			.orderBy('biz_date', 'asc')
			.orderBy('created_at', 'asc')
			.skip((page - 1) * 200)
			.limit(200)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		if (!list.length) break
		rows.push(...list)
		if (list.length < 200 || rows.length >= batchSize) break
		page += 1
		guard += 1
	}
	return rows.slice(0, batchSize)
}

function isDateInExclusiveInclusiveRange(date, startExclusive = '', endInclusive = '') {
	const current = normalizeDate(date)
	if (!current) return false
	if (startExclusive && current <= startExclusive) return false
	if (endInclusive && current > endInclusive) return false
	return true
}

function isDateInInclusiveRange(date, startInclusive = '', endInclusive = '') {
	const current = normalizeDate(date)
	if (!current) return false
	if (startInclusive && current < startInclusive) return false
	if (endInclusive && current > endInclusive) return false
	return true
}

function addDays(dateText, days = 0) {
	const current = normalizeDate(dateText)
	if (!current) return ''
	const base = new Date(`${current}T00:00:00`)
	base.setDate(base.getDate() + Number(days || 0))
	return formatDate(base)
}

function buildDateSeries(dateFrom, dateTo) {
	const start = normalizeDate(dateFrom)
	const end = normalizeDate(dateTo)
	if (!start || !end || start > end) return []
	const rows = []
	let cursor = start
	let guard = 0
	while (cursor && cursor <= end && guard < 4000) {
		rows.push(cursor)
		cursor = addDays(cursor, 1)
		guard += 1
	}
	return rows
}

function buildFlowSettlementWindow(previousDoc) {
	const previousBizDate = normalizeDate(previousDoc && previousDoc.biz_date)
	const actualStartDate = previousBizDate ? addDays(previousBizDate, 1) : FLOW_WEIGHT_GO_LIVE_DATE
	const meterPeriodLabel = previousBizDate ? `${previousBizDate} 之后的表数` : '历史上次表数（可录系统启用前读数）'
	const periodNote = previousBizDate
		? ''
		: `首笔流量结算：上次表数可录历史读数；阶段实际重量仅统计 ${FLOW_WEIGHT_GO_LIVE_DATE} 起系统内销售。若该表数起点早于 ${FLOW_WEIGHT_GO_LIVE_DATE}，本次亏损会混入系统启用前用气，仅供参考。`
	return {
		previousBizDate,
		actualStartDate,
		meterPeriodLabel,
		periodNote
	}
}

async function getLatestPreviousFlowSettlement(customerId, bizDate, { excludeId = '' } = {}) {
	const excluded = normalizeId(excludeId)
	const rows = await listCustomerFlowSettlements(customerId, { dateTo: bizDate, limit: 5000 })
	const filtered = rows
		.filter((row) => {
			const rowId = normalizeId(row && row._id)
			if (excluded && rowId === excluded) return false
			return normalizeDate(row && row.biz_date) <= normalizeDate(bizDate)
		})
		.sort((a, b) => {
			const aDate = normalizeDate(a && a.biz_date)
			const bDate = normalizeDate(b && b.biz_date)
			if (aDate !== bDate) return aDate < bDate ? 1 : -1
			return toNumber(a && a.created_at, 0) < toNumber(b && b.created_at, 0) ? 1 : -1
		})
	return filtered[0] || null
}

function buildFlowSettlementPreviewPayload({ customer, bizDate, previousDoc, salesDocs, flowIndexPrev, flowIndexCurr, flowTheoryRatio }) {
	const prev = normalizeFlowValue3(flowIndexPrev)
	const curr = normalizeFlowValue3(flowIndexCurr)
	const flowVolumeM3 = prev != null && curr != null ? (calcFlowVolume3(curr, prev) ?? 0) : 0
	const ratio = flowTheoryRatio == null ? null : toNumber(flowTheoryRatio, null)
	const actualWeightKg = fix2((salesDocs || []).reduce((sum, row) => sum + computeSaleActualWeight(row), 0))
	const theoryWeightKg = ratio == null ? null : fix2(flowVolumeM3 * ratio)
	const lossWeightKg = theoryWeightKg == null ? null : fix2(actualWeightKg - theoryWeightKg)
	const unitPrice = fix2(toNumber(customer && customer.default_unit_price, 0))
	const shouldReceive = fix3(flowVolumeM3 * unitPrice)
	const window = buildFlowSettlementWindow(previousDoc)
	return {
		customer_id: normalizeId(customer && customer._id),
		customer_name: normalizeString(customer && customer.name),
		biz_date: normalizeBizDate(bizDate),
		period_start_date: window.actualStartDate,
		period_end_date: normalizeBizDate(bizDate),
		previous_flow_settlement_id: normalizeId(previousDoc && previousDoc._id) || null,
		meter_period_label: window.meterPeriodLabel,
		period_note: window.periodNote,
		flow_index_prev: prev,
		flow_index_curr: curr,
		flow_volume_m3: flowVolumeM3,
		flow_theory_ratio: ratio,
		theory_weight_kg: theoryWeightKg,
		actual_weight_kg: actualWeightKg,
		loss_weight_kg: lossWeightKg,
		unit_price: unitPrice,
		should_receive: shouldReceive,
		amount_received: 0,
		payment_status: resolvePaymentStatusByAmount(shouldReceive, 0),
		sale_ids: (salesDocs || []).map((row) => normalizeId(row && row._id)).filter(Boolean)
	}
}

async function buildCustomerFlowSettlementPreview(customerId, data = {}) {
	const customer = await getCustomerById(customerId)
	if (!customer) return { ok: false, code: 404, msg: '客户不存在' }
	if (normalizeString(customer.default_price_unit) !== 'm3') {
		return { ok: false, code: 400, msg: '仅 m3 客户可使用流量结算' }
	}
	const bizDate = normalizeBizDate(data.biz_date || data.bizDate, Date.now())
	const flowIndexPrevRaw = data.flow_index_prev ?? data.flowIndexPrev
	const flowIndexCurrRaw = data.flow_index_curr ?? data.flowIndexCurr
	const flowIndexPrev = normalizeFlowValue3(flowIndexPrevRaw)
	const flowIndexCurr = normalizeFlowValue3(flowIndexCurrRaw)
	if (flowIndexPrev == null || flowIndexCurr == null) {
		return { ok: false, code: 400, msg: '上次表数和本次表数必填' }
	}
	const flowTheoryRatioRaw = normalizeString(data.flow_theory_ratio ?? data.flowTheoryRatio)
	const flowTheoryRatio = flowTheoryRatioRaw ? toNumber(flowTheoryRatioRaw, null) : null
	const previousDoc = await getLatestPreviousFlowSettlement(customer._id, bizDate, {
		excludeId: data.exclude_flow_settlement_id || data.excludeFlowSettlementId || ''
	})
	const window = buildFlowSettlementWindow(previousDoc)
	const allSales = await listCustomerSales(customer._id, {
		dateFrom: window.actualStartDate,
		dateTo: bizDate
	})
	const stageSales = allSales.filter((row) => isDateInInclusiveRange(row && row.date, window.actualStartDate, bizDate))
	const preview = buildFlowSettlementPreviewPayload({
		customer,
		bizDate,
		previousDoc,
		salesDocs: stageSales,
		flowIndexPrev: flowIndexPrevRaw,
		flowIndexCurr: flowIndexCurrRaw,
		flowTheoryRatio
	})
	return {
		ok: true,
		data: {
			...preview,
			period_sale_count: stageSales.length
		}
	}
}

async function previewFlowSettlementV1(user, data) {
	void user
	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const preview = await buildCustomerFlowSettlementPreview(customerId, data)
	if (!preview.ok) return { code: preview.code || 400, msg: preview.msg || '预览失败' }
	return { code: 0, msg: 'ok', data: preview.data }
}

async function createFlowSettlementV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'createFlowSettlementV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }
	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const preview = await buildCustomerFlowSettlementPreview(customerId, data)
	if (!preview.ok) return { code: preview.code || 400, msg: preview.msg || '创建失败' }
	const now = Date.now()
	const payload = preview.data || {}
	const doc = {
		customer_id: payload.customer_id,
		customer_name: payload.customer_name,
		biz_date: payload.biz_date,
		period_start_date: payload.period_start_date,
		period_end_date: payload.period_end_date,
		previous_flow_settlement_id: payload.previous_flow_settlement_id,
		flow_index_prev: payload.flow_index_prev,
		flow_index_curr: payload.flow_index_curr,
		flow_volume_m3: payload.flow_volume_m3,
		flow_theory_ratio: payload.flow_theory_ratio,
		theory_weight_kg: payload.theory_weight_kg,
		actual_weight_kg: payload.actual_weight_kg,
		loss_weight_kg: payload.loss_weight_kg,
		unit_price: payload.unit_price,
		should_receive: payload.should_receive,
		amount_received: payload.amount_received,
		payment_status: payload.payment_status,
		sale_ids: Array.isArray(payload.sale_ids) ? payload.sale_ids : [],
		status: 'posted',
		note: normalizeString(data.note),
		request_id: requestId,
		created_at: now,
		created_by: normalizeId(user && user._id) || null,
		created_by_name: normalizeString(user && user.username),
		updated_at: now
	}
	const res = await flowSettlements.add(doc)
	const autoApplyRes = await autoApplyPrepayToFlowSettlementV1(
		user,
		{ flow_settlement_id: res.id },
		requestId
	)
	const autoAppliedAmount = fix3(toNumber(autoApplyRes?.data?.applied_amount, 0))
	const balances =
		autoApplyRes && autoApplyRes.code === 0 && autoApplyRes.data && autoApplyRes.data.balances
			? autoApplyRes.data.balances
			: await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_flow_settlement_create_v1',
		{
			customer_id: customerId,
			flow_settlement_id: res.id,
			flow_volume_m3: doc.flow_volume_m3,
			actual_weight_kg: doc.actual_weight_kg,
			loss_weight_kg: doc.loss_weight_kg,
			auto_applied_amount: autoAppliedAmount
		},
		requestId
	)
	const nextAmountReceived =
		autoApplyRes && autoApplyRes.code === 0 ? fix3(toNumber(autoApplyRes?.data?.amount_received, doc.amount_received)) : doc.amount_received
	const nextPaymentStatus =
		autoApplyRes && autoApplyRes.code === 0
			? normalizePaymentStatus(autoApplyRes?.data?.payment_status || doc.payment_status)
			: doc.payment_status
	const messageSuffix =
		autoApplyRes && autoApplyRes.code === 0
			? autoAppliedAmount > 0
				? `（已自动冲抵 ¥${formatAmountByScale(autoAppliedAmount, 3)}）`
				: ''
			: '（预付款冲抵未同步）'
	return {
		code: 0,
		msg: `流量结算单已创建${messageSuffix}`,
		data: {
			...doc,
			_id: res.id,
			balances,
			amount_received: nextAmountReceived,
			payment_status: nextPaymentStatus,
			outstanding: fix3(Math.max(toNumber(doc.should_receive, 0) - nextAmountReceived, 0))
		}
	}
}

async function updateFlowSettlementV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'updateFlowSettlementV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }
	const flowSettlementId = normalizeId(data.flow_settlement_id || data.flowSettlementId || data._id)
	if (!flowSettlementId) return { code: 400, msg: 'flow_settlement_id 必填' }

	const flowRes = await flowSettlements.doc(flowSettlementId).get()
	const flowDoc = (flowRes.data && flowRes.data[0]) || null
	if (!flowDoc) return { code: 404, msg: '流量结算单不存在' }
	if (normalizeString(flowDoc.status) !== 'posted') return { code: 400, msg: '仅支持编辑已入账结算单' }

	const flowCustomerId = normalizeId(flowDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || flowCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== flowCustomerId) return { code: 400, msg: '流量结算单不属于该客户' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }

	const preview = await buildCustomerFlowSettlementPreview(customerId, {
		biz_date: data.biz_date ?? data.bizDate ?? flowDoc.biz_date,
		flow_index_prev: data.flow_index_prev ?? data.flowIndexPrev ?? flowDoc.flow_index_prev,
		flow_index_curr: data.flow_index_curr ?? data.flowIndexCurr ?? flowDoc.flow_index_curr,
		flow_theory_ratio: data.flow_theory_ratio ?? data.flowTheoryRatio ?? flowDoc.flow_theory_ratio,
		note: data.note ?? flowDoc.note,
		exclude_flow_settlement_id: flowSettlementId
	})
	if (!preview.ok) return { code: preview.code || 400, msg: preview.msg || '更新失败' }

	const payload = preview.data || {}
	const amountReceived = fix3(toNumber(flowDoc.amount_received, 0))
	const shouldReceive = fix3(toNumber(payload.should_receive, 0))
	const note = data.note === undefined ? normalizeString(flowDoc.note) : normalizeString(data.note)
	const nextStatus = resolvePaymentStatusByAmount(shouldReceive, amountReceived, 3)
	const now = Date.now()
	await flowSettlements.doc(flowSettlementId).update({
		biz_date: payload.biz_date,
		period_start_date: payload.period_start_date,
		period_end_date: payload.period_end_date,
		previous_flow_settlement_id: payload.previous_flow_settlement_id,
		flow_index_prev: payload.flow_index_prev,
		flow_index_curr: payload.flow_index_curr,
		flow_volume_m3: payload.flow_volume_m3,
		flow_theory_ratio: payload.flow_theory_ratio,
		theory_weight_kg: payload.theory_weight_kg,
		actual_weight_kg: payload.actual_weight_kg,
		loss_weight_kg: payload.loss_weight_kg,
		unit_price: payload.unit_price,
		should_receive: shouldReceive,
		amount_received: amountReceived,
		payment_status: nextStatus,
		sale_ids: Array.isArray(payload.sale_ids) ? payload.sale_ids : [],
		note,
		request_id: requestId,
		updated_at: now,
		updated_by: normalizeId(user && user._id) || null,
		updated_by_name: normalizeString(user && user.username)
	})

	const autoApplyRes = await autoApplyPrepayToFlowSettlementV1(
		user,
		{ flow_settlement_id: flowSettlementId },
		requestId
	)
	const autoAppliedAmount = fix3(toNumber(autoApplyRes?.data?.applied_amount, 0))
	const balances =
		autoApplyRes && autoApplyRes.code === 0 && autoApplyRes.data && autoApplyRes.data.balances
			? autoApplyRes.data.balances
			: await rebuildCustomerBalances(customerId)
	const nextAmountReceived =
		autoApplyRes && autoApplyRes.code === 0 ? fix3(toNumber(autoApplyRes?.data?.amount_received, amountReceived)) : amountReceived
	const nextPaymentStatus =
		autoApplyRes && autoApplyRes.code === 0
			? normalizePaymentStatus(autoApplyRes?.data?.payment_status || nextStatus)
			: nextStatus
	await recordLog(
		user,
		'customer_flow_settlement_update_v1',
		{
			customer_id: customerId,
			flow_settlement_id: flowSettlementId,
			flow_volume_m3: payload.flow_volume_m3,
			should_receive: shouldReceive,
			amount_received: nextAmountReceived,
			auto_applied_amount: autoAppliedAmount
		},
		requestId
	)
	const messageSuffix =
		autoApplyRes && autoApplyRes.code === 0
			? autoAppliedAmount > 0
				? `（已自动冲抵 ¥${formatAmountByScale(autoAppliedAmount, 3)}）`
				: ''
			: '（预付款冲抵未同步）'

	return {
		code: 0,
		msg: `流量结算单已更新${messageSuffix}`,
		data: {
			_id: flowSettlementId,
			customer_id: customerId,
			should_receive: shouldReceive,
			amount_received: nextAmountReceived,
			payment_status: nextPaymentStatus,
			balances
		}
	}
}

async function removeFlowSettlementV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'removeFlowSettlementV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }
	const flowSettlementId = normalizeId(data.flow_settlement_id || data.flowSettlementId || data._id)
	if (!flowSettlementId) return { code: 400, msg: 'flow_settlement_id 必填' }

	const flowRes = await flowSettlements.doc(flowSettlementId).get()
	const flowDoc = (flowRes.data && flowRes.data[0]) || null
	if (!flowDoc) return { code: 404, msg: '流量结算单不存在' }
	if (normalizeString(flowDoc.status) !== 'posted') return { code: 400, msg: '仅支持删除已入账结算单' }

	const flowCustomerId = normalizeId(flowDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || flowCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== flowCustomerId) return { code: 400, msg: '流量结算单不属于该客户' }

	const snapshot = computeFlowSettlementSnapshot(flowDoc)
	if (snapshot.amount_received > 0) {
		return { code: 400, msg: '该流量结算单已有收款分配，请先处理相关收款单后再删除' }
	}

	const linkedRes = await allocations
		.where({
			customer_id: customerId,
			target_type: 'flow_settlement',
			target_id: flowSettlementId
		})
		.limit(1)
		.get()
	const linkedRows = Array.isArray(linkedRes.data) ? linkedRes.data : []
	if (linkedRows.length) {
		return { code: 400, msg: '该流量结算单已有分配记录，请先删除相关收款单后再删除' }
	}

	const now = Date.now()
	await flowSettlements.doc(flowSettlementId).update({
		status: 'void',
		void_reason: normalizeString(data.reason || data.note) || 'manual_remove',
		void_at: now,
		void_by: normalizeId(user && user._id) || null,
		void_by_name: normalizeString(user && user.username),
		request_id: requestId,
		updated_at: now
	})
	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_flow_settlement_remove_v1',
		{
			customer_id: customerId,
			flow_settlement_id: flowSettlementId
		},
		requestId
	)

	return {
		code: 0,
		msg: '流量结算单已删除',
		data: {
			_id: flowSettlementId,
			customer_id: customerId,
			balances
		}
	}
}

async function callBottleMovementCustomerLossSummary(customerId, dateFrom, dateTo, token, requestId) {
	try {
		const res = await uniCloud.callFunction({
			name: 'crm-bottle-movement',
			timeout: 30000,
			data: {
				action: 'customerLossSummaryV1',
				token,
				request_id: requestId,
				data: {
					customer_id: customerId,
					dateStart: dateFrom,
					dateEnd: dateTo
				}
			}
		})
		return res && res.result ? res.result : {}
	} catch (err) {
		return {
			code: 500,
			msg: normalizeString(err && err.message) || '客户损耗分析调用失败'
		}
	}
}

async function getCustomerStatementAnalysisV1(user, data, token, requestId) {
	void user
	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const priceUnit = normalizeString(customer.default_price_unit) || 'kg'
	const dateFrom = normalizeDate(data.date_from || data.dateFrom)
	const dateTo = normalizeDate(data.date_to || data.dateTo)
	if (dateFrom && dateTo && dateFrom > dateTo) return { code: 400, msg: '开始日期不能晚于结束日期' }
	const bottleReferencePrice = toNumber(data.bottle_reference_price ?? data.bottleReferencePrice, null)

	const result = {
		customer_price_unit: priceUnit,
		requires_date_range: false,
		kg_loss_weight: 0,
		bottle_reference_weight: 0,
		bottle_reference_amount: null,
		bottle_reference_gap: null,
		bottle_should_receive_total: 0
	}

	if (priceUnit === 'kg') {
		if (!dateFrom || !dateTo) {
			result.requires_date_range = true
			result.kg_loss_weight = null
			return { code: 0, msg: 'ok', data: result }
		}
		const lossRes = await callBottleMovementCustomerLossSummary(customerId, dateFrom, dateTo, token, requestId)
		if (lossRes.code !== 0) return { code: lossRes.code || 400, msg: lossRes.msg || '客户理论损耗统计失败' }
		result.kg_loss_weight = fix2(toNumber(lossRes?.data?.loss_total_kg, 0))
	}

	if (priceUnit === 'bottle') {
		const salesDocs = await listCustomerSales(customerId, { dateFrom, dateTo })
		result.bottle_reference_weight = fix2(salesDocs.reduce((sum, row) => sum + computeSaleActualWeight(row), 0))
		result.bottle_should_receive_total = fix2(
			salesDocs.reduce((sum, row) => sum + computeSaleSnapshot(row).should_receive, 0)
		)
		if (bottleReferencePrice != null && Number.isFinite(bottleReferencePrice) && bottleReferencePrice >= 0) {
			result.bottle_reference_amount = fix2(result.bottle_reference_weight * bottleReferencePrice)
			result.bottle_reference_gap = fix2(result.bottle_should_receive_total - result.bottle_reference_amount)
		}
	}

	return { code: 0, msg: 'ok', data: result }
}

function normalizeManualAllocations(raw = []) {
	const source = Array.isArray(raw) ? raw : []
	const merged = new Map()
	for (const item of source) {
		const targetType = normalizeReceivableTargetType(item && (item.target_type || item.targetType))
		const targetId = normalizeId(item && (item.target_id || item.targetId || item.sale_id || item.saleId || item._id))
		const amount = fix3(toNumber(item && (item.allocate_amount ?? item.amount), 0))
		if (!targetId || amount <= 0) continue
		const key = `${targetType}:${targetId}`
		const prev = merged.get(key) || 0
		merged.set(key, fix3(prev + amount))
	}
	return Array.from(merged.entries()).map(([key, allocate_amount]) => {
		const [target_type, target_id] = key.split(':')
		return {
			target_type: target_type || 'sale',
			target_id: target_id || '',
			allocate_amount
		}
	})
}

function buildReceivableTargetRows({ saleDocs = [], flowDocs = [], openingDebtDocs = [], moneyScale = 2 } = {}) {
	const saleRows = saleDocs.map((doc) => {
		const snapshot = computeSaleSnapshot(doc)
		return {
			target_type: 'sale',
			target_id: normalizeId(doc._id),
			target_title: `销售单 ${normalizeString(doc.date)} / ${normalizeId(doc._id).slice(-6)}`,
			target_date: normalizeString(doc.date),
			sale_id: normalizeId(doc._id),
			should_receive: snapshot.should_receive,
			amount_received: snapshot.amount_received,
			outstanding: snapshot.outstanding,
			payment_status: normalizePaymentStatus(doc.payment_status),
			meta: {
				biz_mode: normalizeString(doc.biz_mode) || 'bottle',
				settlement_mode: normalizeSettlementMode(doc.settlement_mode, 'sale')
			}
		}
	})
	const flowRows = flowDocs.map((doc) => {
		const snapshot = computeFlowSettlementSnapshot(doc)
		return {
			target_type: 'flow_settlement',
			target_id: normalizeId(doc._id),
			target_title: `流量结算 ${normalizeString(doc.biz_date)} / ${normalizeId(doc._id).slice(-6)}`,
			target_date: normalizeString(doc.biz_date),
			sale_id: normalizeId(doc._id),
			flow_settlement_id: normalizeId(doc._id),
			should_receive: snapshot.should_receive,
			amount_received: snapshot.amount_received,
			outstanding: snapshot.outstanding,
			payment_status: snapshot.payment_status,
			meta: {
				flow_volume_m3: toNumber(doc.flow_volume_m3, null),
				loss_weight_kg: toNumber(doc.loss_weight_kg, null)
			}
		}
	})
	const openingDebtRows = openingDebtDocs.map((doc) => {
		const debtId = normalizeId(doc && doc._id)
		const snapshot = computeOpeningDebtSnapshot(doc, moneyScale)
		const entryType = resolveOpeningDebtEntryType(doc)
		return {
			target_type: entryType,
			target_id: debtId,
			target_title: buildOpeningDebtTargetTitle({
				entryType,
				bizDate: doc && doc.biz_date,
				targetId: debtId
			}),
			target_date: normalizeString(doc && doc.biz_date),
			sale_id: debtId,
			opening_debt_id: debtId,
			should_receive: snapshot.should_receive_effective,
			should_receive_raw: snapshot.amount,
			rounding_amount: snapshot.rounding_amount,
			amount_received: snapshot.amount_received,
			outstanding: snapshot.outstanding,
			payment_status: snapshot.payment_status,
			meta: {
				note: normalizeString(doc && doc.note),
				entry_type: entryType
			}
		}
	})
	return [...saleRows, ...flowRows, ...openingDebtRows]
}

async function buildAllocationPlan(
	customerId,
	amount,
	{
		manualAllocations = null,
		allocationMode = 'period',
		allocationStartDate = '',
		allocationEndDate = '',
		allocationTargets = null
	} = {}
) {
	const customer = await getCustomerById(customerId)
	if (!customer) return { ok: false, code: 400, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const totalAmount = fixMoney(toNumber(amount, 0))
	if (totalAmount <= 0) return { ok: false, code: 400, msg: '收款金额必须大于0' }
	const mode = normalizeAllocationMode(allocationMode, 'period')
	const startDate = normalizeDate(allocationStartDate)
	const endDate = normalizeDate(allocationEndDate)
	const targets = normalizeAllocationTargets(allocationTargets || [])
	if (mode === 'period') {
		if (!startDate || !endDate) return { ok: false, code: 400, msg: '请填写分配开始日期和结束日期' }
		if (startDate > endDate) return { ok: false, code: 400, msg: '分配开始日期不能晚于结束日期' }
	}
	if (mode === 'checked' && !targets.length) return { ok: false, code: 400, msg: '请先勾选至少一条待分配单据' }

	const saleDocs = await listCustomerSales(customer._id)
	const flowDocs = await listCustomerFlowSettlements(customer._id)
	const openingDebtDocs = await listCustomerOpeningDebts(customer._id)
	const receivableRows = buildReceivableTargetRows({ saleDocs, flowDocs, openingDebtDocs, moneyScale })
	const targetKeySet = new Set(targets.map((item) => `${normalizeReceivableTargetType(item.target_type)}:${normalizeId(item.target_id)}`))

	const outstandingRows = receivableRows
		.filter((row) => {
			if (!(row.outstanding > 0)) return false
			if (mode === 'checked') {
				return targetKeySet.has(`${normalizeReceivableTargetType(row.target_type)}:${normalizeId(row.target_id)}`)
			}
			const targetDate = normalizeDate(row.target_date)
			if (!targetDate) return false
			return targetDate >= startDate && targetDate <= endDate
		})
		.sort((a, b) => {
			if (a.target_date !== b.target_date) return a.target_date < b.target_date ? -1 : 1
			return a.target_id < b.target_id ? -1 : 1
		})

	let remaining = totalAmount
	const allocationsPlan = []

	if (manualAllocations && manualAllocations.length) {
		for (const manual of manualAllocations) {
			if (remaining <= 0) break
			const target = outstandingRows.find(
				(row) => row.target_type === normalizeReceivableTargetType(manual.target_type) && row.target_id === normalizeId(manual.target_id)
			)
			if (!target) continue
			const canUse = Math.min(target.outstanding, remaining)
			const wantUse = Math.min(manual.allocate_amount, canUse)
			const amountUse = fixMoney(wantUse)
			if (amountUse <= 0) continue
			allocationsPlan.push({
				target_type: target.target_type,
				target_id: target.target_id,
				target_title: target.target_title,
				sale_id: target.sale_id,
				sale_date: target.target_date,
				should_receive: target.should_receive,
				amount_received: target.amount_received,
				outstanding_before: target.outstanding,
				allocate_amount: amountUse,
				outstanding_after: fixMoney(target.outstanding - amountUse)
			})
			remaining = fixMoney(remaining - amountUse)
			target.outstanding = fixMoney(target.outstanding - amountUse)
			target.amount_received = fixMoney(target.amount_received + amountUse)
		}
	} else {
		for (const row of outstandingRows) {
			if (remaining <= 0) break
			const amountUse = fixMoney(Math.min(row.outstanding, remaining))
			if (amountUse <= 0) continue
			allocationsPlan.push({
				target_type: row.target_type,
				target_id: row.target_id,
				target_title: row.target_title,
				sale_id: row.sale_id,
				sale_date: row.target_date,
				should_receive: row.should_receive,
				amount_received: row.amount_received,
				outstanding_before: row.outstanding,
				allocate_amount: amountUse,
				outstanding_after: fixMoney(row.outstanding - amountUse)
			})
			remaining = fixMoney(remaining - amountUse)
		}
	}

	const allocatedTotal = fixMoney(allocationsPlan.reduce((sum, item) => sum + toNumber(item.allocate_amount, 0), 0))
	const prepayAmount = fixMoney(totalAmount - allocatedTotal)
	const totalOutstanding = fixMoney(outstandingRows.reduce((sum, row) => sum + toNumber(row.outstanding, 0), 0))

	return {
		ok: true,
		customer_id: customer._id,
		customer_name: customer.name,
		amount: totalAmount,
		allocation_mode: mode,
		allocation_start_date: mode === 'period' ? startDate : '',
		allocation_end_date: mode === 'period' ? endDate : '',
		allocation_targets: targets,
		allocated_total: allocatedTotal,
		prepay_amount: prepayAmount,
		total_outstanding_before: totalOutstanding,
		allocations: allocationsPlan
	}
}

async function applyAllocationAndPersist({
	user,
	requestId,
	customer,
	plan,
	bizDate,
	paymentMethod,
	allocationMode,
	allocationStartDate,
	allocationEndDate,
	allocationTargets,
	note,
	sourceType,
	sourceId,
	entryKind
}) {
	const now = Date.now()
	const normalizedMode = normalizeAllocationMode(allocationMode || plan.allocation_mode, 'period')
	const normalizedTargets = normalizeAllocationTargets(
		allocationTargets || plan.allocation_targets || []
	)
	const resolvedEntryKind = normalizeEntryKind(
		entryKind,
		normalizeString(sourceType).includes('offset') ? 'offset_credit' : 'prepay'
	)
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const receiptDoc = {
		customer_id: customer._id,
		customer_name: customer.name,
		biz_date: bizDate,
		amount: fixMoney(plan.amount),
		allocated_amount: 0,
		unallocated_amount: fixMoney(plan.amount),
		payment_method: normalizePaymentMethod(paymentMethod, 'paid'),
		entry_kind: resolvedEntryKind,
		allocation_mode: normalizedMode,
		allocation_start_date: normalizeDate(allocationStartDate || plan.allocation_start_date),
		allocation_end_date: normalizeDate(allocationEndDate || plan.allocation_end_date),
		allocation_targets: normalizedTargets,
		note: normalizeString(note),
		source_type: normalizeString(sourceType) || 'manual',
		source_id: normalizeId(sourceId) || null,
		status: 'posted',
		request_id: requestId,
		created_at: now,
		created_by: normalizeId(user?._id) || null,
		created_by_name: normalizeString(user?.username),
		updated_at: now
	}

	const receiptRes = await receipts.add(receiptDoc)
	const receiptId = receiptRes.id
	let allocatedTotal = 0
	let seq = 1

	for (const item of plan.allocations || []) {
		const targetType = normalizeReceivableTargetType(item.target_type)
		const targetId = normalizeId(item.target_id || item.sale_id)
		if (!targetId) continue

		let targetDate = ''
		let targetTitle = normalizeString(item.target_title)
		let allocateAmount = 0

		if (targetType === 'flow_settlement') {
			const flowRes = await flowSettlements.doc(targetId).get()
			const flowDoc = (flowRes.data && flowRes.data[0]) || null
			if (!flowDoc) continue
			if (normalizeId(flowDoc.customer_id) !== customer._id) continue
			const snapshot = computeFlowSettlementSnapshot(flowDoc)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fix3(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fix3(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive, nextAmountReceived, 3)
			await flowSettlements.doc(targetId).update({
				amount_received: nextAmountReceived,
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(flowDoc.biz_date)
			if (!targetTitle) targetTitle = `流量结算 ${targetDate} / ${targetId.slice(-6)}`
		} else if (targetType === 'opening_debt' || targetType === 'other_fee') {
			const debtRes = await openingDebts.doc(targetId).get()
			const debtDoc = (debtRes.data && debtRes.data[0]) || null
			if (!debtDoc) continue
			if (normalizeId(debtDoc.customer_id) !== customer._id) continue
			if (normalizeString(debtDoc.status) !== 'posted') continue
			const snapshot = computeOpeningDebtSnapshot(debtDoc, moneyScale)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fixMoney(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fixMoney(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived, moneyScale)
			await openingDebts.doc(targetId).update({
				amount_received: nextAmountReceived,
				outstanding: fixMoney(Math.max(snapshot.should_receive_effective - nextAmountReceived, 0)),
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(debtDoc.biz_date)
			if (!targetTitle) {
				targetTitle = buildOpeningDebtTargetTitle({
					entryType: targetType,
					bizDate: targetDate,
					targetId
				})
			}
		} else {
			const saleRes = await sales.doc(targetId).get()
			const saleDoc = (saleRes.data && saleRes.data[0]) || null
			if (!saleDoc) continue
			if (normalizeId(saleDoc.customer_id) !== customer._id) continue
			const snapshot = computeSaleSnapshot(saleDoc)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fix2(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fix2(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived)
			await sales.doc(targetId).update({
				amount_received: nextAmountReceived,
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(saleDoc.date)
			if (!targetTitle) targetTitle = `销售单 ${targetDate} / ${targetId.slice(-6)}`
		}

		await allocations.add({
			receipt_id: receiptId,
			customer_id: customer._id,
			customer_name: customer.name,
			sale_id: targetId,
			sale_date: targetDate,
			flow_settlement_id: targetType === 'flow_settlement' ? targetId : null,
			target_type: targetType,
			target_id: targetId,
			target_title: targetTitle,
			biz_date: bizDate,
			allocate_amount: allocateAmount,
			seq,
			note: '',
			allocation_mode: normalizedMode,
			allocation_start_date: normalizeDate(allocationStartDate || plan.allocation_start_date),
			allocation_end_date: normalizeDate(allocationEndDate || plan.allocation_end_date),
			allocation_targets: normalizedTargets,
			source_type: normalizeString(sourceType) || 'manual',
			source_id: normalizeId(sourceId) || null,
			request_id: requestId,
			created_at: Date.now(),
			created_by: normalizeId(user?._id) || null,
			created_by_name: normalizeString(user?.username)
		})

		seq += 1
		allocatedTotal = fixMoney(allocatedTotal + allocateAmount)
	}

	await receipts.doc(receiptId).update({
		allocated_amount: allocatedTotal,
		unallocated_amount: fixMoney(plan.amount - allocatedTotal),
		updated_at: Date.now()
	})

	return {
		receipt_id: receiptId,
		allocated_total: allocatedTotal,
		prepay_amount: fixMoney(plan.amount - allocatedTotal)
	}
}

async function listReceiptAllocationRows(receiptId, customerId) {
	const where = {
		receipt_id: normalizeId(receiptId),
		customer_id: normalizeId(customerId)
	}
	const res = await allocations
		.where(where)
		.orderBy('seq', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()
	return Array.isArray(res.data) ? res.data : []
}

async function listSaleTargetAllocationRows(customerId, saleId) {
	const normalizedCustomerId = normalizeId(customerId)
	const normalizedSaleId = normalizeId(saleId)
	if (!normalizedCustomerId || !normalizedSaleId) return []

	const rows = []
	let page = 1
	let guard = 0
	const where = dbCmd.and([
		{ customer_id: normalizedCustomerId },
		dbCmd.or([{ target_id: normalizedSaleId }, { sale_id: normalizedSaleId }])
	])
	while (guard < 500) {
		const res = await allocations
			.where(where)
			.orderBy('created_at', 'asc')
			.skip((page - 1) * 200)
			.limit(200)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		if (!list.length) break
		rows.push(...list)
		if (list.length < 200) break
		page += 1
		guard += 1
	}
	return rows.filter((row) => {
		const targetType = normalizeReceivableTargetType(row && row.target_type)
		const targetId = normalizeId(row && (row.target_id || row.sale_id))
		return targetType === 'sale' && targetId === normalizedSaleId
	})
}

async function releaseSaleTargetAllocationsToPrepay({ customerId, saleId }) {
	const normalizedCustomerId = normalizeId(customerId)
	const normalizedSaleId = normalizeId(saleId)
	if (!normalizedCustomerId || !normalizedSaleId) {
		return {
			allocation_rows: 0,
			released_total: 0,
			receipt_touched: 0,
			mismatch_total: 0
		}
	}

	const rows = await listSaleTargetAllocationRows(normalizedCustomerId, normalizedSaleId)
	if (!rows.length) {
		return {
			allocation_rows: 0,
			released_total: 0,
			receipt_touched: 0,
			mismatch_total: 0
		}
	}

	const allocIds = []
	const receiptAmountMap = new Map()
	for (const row of rows) {
		const allocId = normalizeId(row && row._id)
		if (allocId) allocIds.push(allocId)
		const receiptId = normalizeId(row && row.receipt_id)
		const amount = fix2(toNumber(row && row.allocate_amount, 0))
		if (!receiptId || !(amount > 0)) continue
		const prev = fix2(toNumber(receiptAmountMap.get(receiptId), 0))
		receiptAmountMap.set(receiptId, fix2(prev + amount))
	}

	let releasedTotal = 0
	let receiptTouched = 0
	let mismatchTotal = 0
	for (const [receiptId, expectRelease] of receiptAmountMap.entries()) {
		const receiptRes = await receipts.doc(receiptId).get()
		const receiptDoc = (receiptRes.data && receiptRes.data[0]) || null
		if (
			!receiptDoc ||
			normalizeId(receiptDoc.customer_id) !== normalizedCustomerId ||
			normalizeString(receiptDoc.status) !== 'posted'
		) {
			mismatchTotal = fix2(mismatchTotal + expectRelease)
			continue
		}
		const currentAllocated = fix2(toNumber(receiptDoc.allocated_amount, 0))
		const currentUnallocated = fix2(toNumber(receiptDoc.unallocated_amount, 0))
		const released = fix2(Math.min(expectRelease, Math.max(currentAllocated, 0)))
		const truncated = fix2(Math.max(expectRelease - released, 0))
		if (released > 0) {
			await receipts.doc(receiptId).update({
				allocated_amount: fix2(Math.max(currentAllocated - released, 0)),
				unallocated_amount: fix2(currentUnallocated + released),
				updated_at: Date.now()
			})
			releasedTotal = fix2(releasedTotal + released)
			receiptTouched += 1
		}
		if (truncated > 0) mismatchTotal = fix2(mismatchTotal + truncated)
	}

	for (const idChunk of chunkStrings(allocIds, 80)) {
		await allocations
			.where(
				dbCmd.and([
					{ customer_id: normalizedCustomerId },
					{ _id: dbCmd.in(idChunk) }
				])
			)
			.remove()
	}

	return {
		allocation_rows: rows.length,
		released_total: releasedTotal,
		receipt_touched: receiptTouched,
		mismatch_total: mismatchTotal
	}
}

async function rollbackReceiptAllocations({ customerId, receiptId }) {
	const rows = await listReceiptAllocationRows(receiptId, customerId)
	let rollbackTotal = 0
	let skipped = 0

	for (const row of rows) {
		const targetType = normalizeReceivableTargetType(row.target_type)
		const targetId = normalizeId(row.target_id || row.sale_id || row.flow_settlement_id)
		const amountRaw = toNumber(row.allocate_amount, 0)
		const amount = targetType === 'flow_settlement' ? fix3(amountRaw) : fix2(amountRaw)
		if (!targetId || amount <= 0) {
			skipped += 1
			continue
		}

		if (targetType === 'flow_settlement') {
			const flowRes = await flowSettlements.doc(targetId).get()
			const flowDoc = (flowRes.data && flowRes.data[0]) || null
			if (!flowDoc || normalizeId(flowDoc.customer_id) !== customerId) {
				skipped += 1
				continue
			}
			const snapshot = computeFlowSettlementSnapshot(flowDoc)
			const nextAmountReceived = fix3(Math.max(snapshot.amount_received - amount, 0))
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive, nextAmountReceived, 3)
			await flowSettlements.doc(targetId).update({
				amount_received: nextAmountReceived,
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			rollbackTotal = fix3(rollbackTotal + amount)
			continue
		}
		if (targetType === 'opening_debt' || targetType === 'other_fee') {
			const debtRes = await openingDebts.doc(targetId).get()
			const debtDoc = (debtRes.data && debtRes.data[0]) || null
			if (!debtDoc || normalizeId(debtDoc.customer_id) !== customerId || normalizeString(debtDoc.status) !== 'posted') {
				skipped += 1
				continue
			}
			const moneyScale = resolveOpeningDebtMoneyScale(debtDoc, 2)
			const fixMoney = (value) => fixByScale(value, moneyScale)
			const snapshot = computeOpeningDebtSnapshot(debtDoc, moneyScale)
			const amountFixed = fixMoney(amountRaw)
			const nextAmountReceived = fixMoney(Math.max(snapshot.amount_received - amountFixed, 0))
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived, moneyScale)
			await openingDebts.doc(targetId).update({
				amount_received: nextAmountReceived,
				outstanding: fixMoney(Math.max(snapshot.should_receive_effective - nextAmountReceived, 0)),
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			rollbackTotal = fix3(rollbackTotal + amountFixed)
			continue
		}

		const saleRes = await sales.doc(targetId).get()
		const saleDoc = (saleRes.data && saleRes.data[0]) || null
		if (!saleDoc || normalizeId(saleDoc.customer_id) !== customerId) {
			skipped += 1
			continue
		}
		const snapshot = computeSaleSnapshot(saleDoc)
		const nextAmountReceived = fix2(Math.max(snapshot.amount_received - amount, 0))
		const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived)
		await sales.doc(targetId).update({
			amount_received: nextAmountReceived,
			payment_status: nextStatus,
			updated_at: Date.now()
		})
		rollbackTotal = fix3(rollbackTotal + amount)
	}

	await allocations.where({ receipt_id: normalizeId(receiptId), customer_id: customerId }).remove()
	return {
		rows: rows.length,
		rollback_total: rollbackTotal,
		skipped
	}
}

async function applyPlanToExistingReceipt({
	user,
	requestId,
	customer,
	receiptDoc,
	plan,
	paymentMethod,
	allocationMode,
	allocationStartDate,
	allocationEndDate,
	allocationTargets,
	sourceType,
	sourceId,
	allocationNote = '',
	entryKind
}) {
	const receiptId = normalizeId(receiptDoc && receiptDoc._id)
	if (!receiptId) return { ok: false, code: 400, msg: 'receipt_id 无效' }
	const bizDate = normalizeBizDate((receiptDoc && receiptDoc.biz_date) || '', Date.now())
	const method = normalizePaymentMethod(paymentMethod || (receiptDoc && receiptDoc.payment_method), 'paid')
	const normalizedMode = normalizeAllocationMode(allocationMode || plan.allocation_mode, 'period')
	const normalizedTargets = normalizeAllocationTargets(
		allocationTargets || plan.allocation_targets || []
	)
	const resolvedEntryKind = normalizeEntryKind(
		entryKind || (receiptDoc && receiptDoc.entry_kind),
		normalizeString(sourceType).includes('offset') ? 'offset_credit' : 'prepay'
	)
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	let allocatedTotal = 0
	let seq = 1

	for (const item of plan.allocations || []) {
		const targetType = normalizeReceivableTargetType(item.target_type)
		const targetId = normalizeId(item.target_id || item.sale_id)
		if (!targetId) continue

		let targetDate = ''
		let targetTitle = normalizeString(item.target_title)
		let allocateAmount = 0

		if (targetType === 'flow_settlement') {
			const flowRes = await flowSettlements.doc(targetId).get()
			const flowDoc = (flowRes.data && flowRes.data[0]) || null
			if (!flowDoc || normalizeId(flowDoc.customer_id) !== customer._id) continue
			const snapshot = computeFlowSettlementSnapshot(flowDoc)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fix3(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fix3(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive, nextAmountReceived, 3)
			await flowSettlements.doc(targetId).update({
				amount_received: nextAmountReceived,
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(flowDoc.biz_date)
			if (!targetTitle) targetTitle = `流量结算 ${targetDate} / ${targetId.slice(-6)}`
		} else if (targetType === 'opening_debt' || targetType === 'other_fee') {
			const debtRes = await openingDebts.doc(targetId).get()
			const debtDoc = (debtRes.data && debtRes.data[0]) || null
			if (!debtDoc || normalizeId(debtDoc.customer_id) !== customer._id || normalizeString(debtDoc.status) !== 'posted') continue
			const snapshot = computeOpeningDebtSnapshot(debtDoc, moneyScale)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fixMoney(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fixMoney(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived, moneyScale)
			await openingDebts.doc(targetId).update({
				amount_received: nextAmountReceived,
				outstanding: fixMoney(Math.max(snapshot.should_receive_effective - nextAmountReceived, 0)),
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(debtDoc.biz_date)
			if (!targetTitle) {
				targetTitle = buildOpeningDebtTargetTitle({
					entryType: targetType,
					bizDate: targetDate,
					targetId
				})
			}
		} else {
			const saleRes = await sales.doc(targetId).get()
			const saleDoc = (saleRes.data && saleRes.data[0]) || null
			if (!saleDoc || normalizeId(saleDoc.customer_id) !== customer._id) continue
			const snapshot = computeSaleSnapshot(saleDoc)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fix2(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fix2(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived)
			await sales.doc(targetId).update({
				amount_received: nextAmountReceived,
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(saleDoc.date)
			if (!targetTitle) targetTitle = `销售单 ${targetDate} / ${targetId.slice(-6)}`
		}

		await allocations.add({
			receipt_id: receiptId,
			customer_id: customer._id,
			customer_name: customer.name,
			sale_id: targetId,
			sale_date: targetDate,
			flow_settlement_id: targetType === 'flow_settlement' ? targetId : null,
			target_type: targetType,
			target_id: targetId,
			target_title: targetTitle,
			biz_date: bizDate,
			allocate_amount: allocateAmount,
			seq,
			note: normalizeString(allocationNote),
			allocation_mode: normalizedMode,
			allocation_start_date: normalizeDate(allocationStartDate || plan.allocation_start_date),
			allocation_end_date: normalizeDate(allocationEndDate || plan.allocation_end_date),
			allocation_targets: normalizedTargets,
			source_type: normalizeString(sourceType) || 'receipt_repair_v1',
			source_id: normalizeId(sourceId) || null,
			request_id: requestId,
			created_at: Date.now(),
			created_by: normalizeId(user?._id) || null,
			created_by_name: normalizeString(user?.username)
		})
		seq += 1
		allocatedTotal = fixMoney(allocatedTotal + allocateAmount)
	}

	await receipts.doc(receiptId).update({
		allocated_amount: allocatedTotal,
		unallocated_amount: fixMoney(plan.amount - allocatedTotal),
		payment_method: method,
		entry_kind: resolvedEntryKind,
		allocation_mode: normalizedMode,
		allocation_start_date: normalizeDate(allocationStartDate || plan.allocation_start_date),
		allocation_end_date: normalizeDate(allocationEndDate || plan.allocation_end_date),
		allocation_targets: normalizedTargets,
		updated_at: Date.now()
	})

	return {
		ok: true,
		receipt_id: receiptId,
		allocated_total: allocatedTotal,
		prepay_amount: fixMoney(plan.amount - allocatedTotal),
		payment_method: method
	}
}

async function rebuildCustomerBalances(customerId) {
	const customer = await getCustomerById(customerId)
	if (!customer) return null
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const salesDocs = await listCustomerSales(customer._id)
	const flowDocs = await listCustomerFlowSettlements(customer._id)
	const openingDebtDocs = await listCustomerOpeningDebts(customer._id)
	const businessSummary = await buildBusinessSummaryFromTargets(customer, {
		salesDocs,
		flowDocs,
		openingDebtDocs
	})
	const receivable = fixMoney(businessSummary.receivable_balance)
	const shouldTotal = fixMoney(businessSummary.should_receive_total)
	const receivedTotal = fixMoney(businessSummary.amount_received_total)

	let prepay = 0
	let prepayOnly = 0
	let offsetCredit = 0
	let lastReceiptAt = null
	let lastReceiptBizDate = ''
	let lastReceiptCreatedAt = null
	const receiptRows = []
	const batchSize = 200
	let page = 1
	let guard = 0
	while (guard < 500) {
		const res = await receipts
			.where({ customer_id: customer._id, status: 'posted' })
			.orderBy('biz_date', 'desc')
			.orderBy('created_at', 'desc')
			.skip((page - 1) * batchSize)
			.limit(batchSize)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		if (!list.length) break
		receiptRows.push(...list)
		if (list.length < batchSize) break
		page += 1
		guard += 1
	}

	for (const row of receiptRows) {
		const amount = Math.max(0, toNumber(row.unallocated_amount, 0))
		prepay = fixMoney(prepay + amount)
		if (isOffsetCreditReceiptRow(row)) {
			offsetCredit = fixMoney(offsetCredit + amount)
		} else {
			prepayOnly = fixMoney(prepayOnly + amount)
		}
		const bizDate = normalizeDate(row && row.biz_date)
		if (bizDate && (!lastReceiptBizDate || bizDate > lastReceiptBizDate)) {
			lastReceiptBizDate = bizDate
		}
		if (lastReceiptCreatedAt == null) {
			lastReceiptCreatedAt = toNumber(row && row.created_at, null)
		}
	}
	lastReceiptAt = parseBizDateToTimestamp(lastReceiptBizDate)
	if (!(Number.isFinite(lastReceiptAt) && lastReceiptAt > 0)) {
		lastReceiptAt = Number.isFinite(lastReceiptCreatedAt) && lastReceiptCreatedAt > 0 ? lastReceiptCreatedAt : null
	}

	const net = fixMoney(receivable - prepay)
	await customers.doc(customer._id).update({
		receivable_balance: receivable,
		prepay_balance: prepay,
		prepay_manual_balance: prepayOnly,
		offset_credit_balance: offsetCredit,
		net_balance: net,
		should_receive_total: shouldTotal,
		amount_received_total: receivedTotal,
		last_receipt_at: lastReceiptAt,
		updated_at: Date.now()
	})

	return {
		customer_id: customer._id,
		customer_name: customer.name,
		receivable_balance: receivable,
		prepay_balance: prepay,
		prepay_manual_balance: prepayOnly,
		offset_credit_balance: offsetCredit,
		net_balance: net,
		should_receive_total: shouldTotal,
		amount_received_total: receivedTotal,
		last_receipt_at: lastReceiptAt
	}
}

async function previewAllocationV1(user, data) {
	void user
	const customerId = normalizeId(data.customer_id || data.customerId)
	const amount = toNumber(data.amount, 0)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!(amount > 0)) return { code: 400, msg: '收款金额必须大于0' }
	const allocation = resolveAllocationConfig(data)
	if (!allocation.ok) return { code: allocation.code || 400, msg: allocation.msg || '分配参数无效' }

	const manual = normalizeManualAllocations(data.allocations || [])
	const plan = await buildAllocationPlan(customerId, amount, {
		manualAllocations: manual.length ? manual : null,
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets
	})
	if (!plan.ok) return { code: plan.code || 400, msg: plan.msg || '预览失败' }

	return {
		code: 0,
		msg: 'ok',
		data: plan
	}
}

async function createReceiptV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'createReceiptV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const amount = toNumber(data.amount, 0)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!(amount > 0)) return { code: 400, msg: '收款金额必须大于0' }
	const allocation = resolveAllocationConfig(data)
	if (!allocation.ok) return { code: allocation.code || 400, msg: allocation.msg || '分配参数无效' }

	const previewOnly = Boolean(data.preview)
	const plan = await buildAllocationPlan(customerId, amount, {
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets
	})
	if (!plan.ok) return { code: plan.code || 400, msg: plan.msg || '创建失败' }
	if (previewOnly) return { code: 0, msg: 'ok', data: plan }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const bizDate = normalizeBizDate(data.biz_date || data.bizDate, Date.now())
	const paymentMethodRaw = normalizeString(data.payment_method || data.paymentMethod).toLowerCase()
	if (paymentMethodRaw === 'on_account' || paymentMethodRaw === '挂账') {
		return { code: 400, msg: '收款登记必须选择现金/转账/微信/支付宝/支票' }
	}
	const paymentMethod = normalizePaymentMethod(data.payment_method || data.paymentMethod, 'paid')
	const note = normalizeString(data.note)
	const sourceType = normalizeString(data.source_type || data.sourceType) || 'manual'
	const sourceId = normalizeId(data.source_id || data.sourceId)

	const applyRes = await applyAllocationAndPersist({
		user,
		requestId,
		customer,
		plan,
		bizDate,
		paymentMethod,
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets,
		note,
		sourceType,
		sourceId,
		entryKind: 'prepay'
	})

	const balances = await rebuildCustomerBalances(customer._id)
	await recordLog(
		user,
		'customer_receipt_create_v1',
		{
			receipt_id: applyRes.receipt_id,
			customer_id: customer._id,
			amount: fixMoney(amount),
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount
		},
		requestId
	)

	return {
		code: 0,
		msg: '入账成功',
		data: {
			receipt_id: applyRes.receipt_id,
			customer_id: customer._id,
			customer_name: customer.name,
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount,
			balances
		}
	}
}

async function updateReceiptV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'updateReceiptV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const receiptId = normalizeId(data.receipt_id || data.receiptId || data._id)
	if (!receiptId) return { code: 400, msg: 'receipt_id 必填' }

	const receiptRes = await receipts.doc(receiptId).get()
	const receiptDoc = (receiptRes.data && receiptRes.data[0]) || null
	if (!receiptDoc) return { code: 404, msg: '收款单不存在' }
	if (normalizeString(receiptDoc.status) !== 'posted') return { code: 400, msg: '仅支持编辑已入账收款单' }

	const receiptCustomerId = normalizeId(receiptDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || receiptCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== receiptCustomerId) return { code: 400, msg: '收款单不属于该客户' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const amountRaw = data.amount == null || data.amount === '' ? receiptDoc.amount : data.amount
	const amount = fixMoney(toNumber(amountRaw, 0))
	if (!(amount > 0)) return { code: 400, msg: '收款金额必须大于0' }

	const bizDate = normalizeBizDate(data.biz_date || data.bizDate || receiptDoc.biz_date, Date.now())
	const allocation = resolveAllocationConfig(
		{
			allocation_mode: data.allocation_mode ?? data.allocationMode ?? receiptDoc.allocation_mode,
			allocation_start_date: data.allocation_start_date ?? data.allocationStartDate ?? receiptDoc.allocation_start_date,
			allocation_end_date: data.allocation_end_date ?? data.allocationEndDate ?? receiptDoc.allocation_end_date,
			allocation_targets: data.allocation_targets ?? data.allocationTargets ?? receiptDoc.allocation_targets
		},
		bizDate
	)
	if (!allocation.ok) return { code: allocation.code || 400, msg: allocation.msg || '分配参数无效' }

	const paymentMethodInput = data.payment_method ?? data.paymentMethod ?? receiptDoc.payment_method
	const paymentMethodRaw = normalizeString(paymentMethodInput).toLowerCase()
	if (paymentMethodRaw === 'on_account' || paymentMethodRaw === '挂账') {
		return { code: 400, msg: '收款登记必须选择现金/转账/微信/支付宝/支票' }
	}
	const paymentMethod = normalizePaymentMethod(paymentMethodInput, 'paid')
	const sourceType = normalizeString(data.source_type || data.sourceType || receiptDoc.source_type) || 'manual'
	const sourceIdRaw = data.source_id !== undefined || data.sourceId !== undefined ? data.source_id ?? data.sourceId : receiptDoc.source_id
	const sourceId = normalizeId(sourceIdRaw)
	const note = data.note === undefined ? normalizeString(receiptDoc.note) : normalizeString(data.note)
	const entryKind = normalizeEntryKind(
		data.entry_kind || data.entryKind || receiptDoc.entry_kind,
		sourceType.includes('offset') ? 'offset_credit' : 'prepay'
	)

	const rollback = await rollbackReceiptAllocations({ customerId, receiptId })
	const plan = await buildAllocationPlan(customerId, amount, {
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets
	})
	if (!plan.ok) return { code: plan.code || 400, msg: plan.msg || '收款单重算失败' }

	const applyRes = await applyPlanToExistingReceipt({
		user,
		requestId,
		customer,
		receiptDoc: {
			...receiptDoc,
			biz_date: bizDate,
			payment_method: paymentMethod,
			entry_kind: entryKind
		},
		plan,
		paymentMethod,
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets,
		sourceType,
		sourceId,
		allocationNote: '',
		entryKind
	})
	if (!applyRes.ok) return { code: applyRes.code || 400, msg: applyRes.msg || '收款单重算失败' }

	await receipts.doc(receiptId).update({
		customer_name: customer.name,
		biz_date: bizDate,
		amount,
		note,
		source_type: sourceType,
		source_id: sourceId || null,
		payment_method: paymentMethod,
		entry_kind: entryKind,
		request_id: requestId,
		updated_at: Date.now(),
		updated_by: normalizeId(user && user._id) || null,
		updated_by_name: normalizeString(user && user.username)
	})

	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_receipt_update_v1',
		{
			customer_id: customerId,
			receipt_id: receiptId,
			amount,
			allocation_mode: allocation.allocation_mode,
			rollback_total: rollback.rollback_total,
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount
		},
		requestId
	)

	return {
		code: 0,
		msg: '收款单已更新',
		data: {
			receipt_id: receiptId,
			customer_id: customerId,
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount,
			balances
		}
	}
}

async function removeReceiptV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'removeReceiptV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const receiptId = normalizeId(data.receipt_id || data.receiptId || data._id)
	if (!receiptId) return { code: 400, msg: 'receipt_id 必填' }

	const receiptRes = await receipts.doc(receiptId).get()
	const receiptDoc = (receiptRes.data && receiptRes.data[0]) || null
	if (!receiptDoc) return { code: 404, msg: '收款单不存在' }
	if (normalizeString(receiptDoc.status) !== 'posted') return { code: 400, msg: '仅支持删除已入账收款单' }

	const receiptCustomerId = normalizeId(receiptDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || receiptCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== receiptCustomerId) return { code: 400, msg: '收款单不属于该客户' }

	const rollback = await rollbackReceiptAllocations({ customerId, receiptId })
	const now = Date.now()
	await receipts.doc(receiptId).update({
		status: 'void',
		allocated_amount: 0,
		unallocated_amount: 0,
		void_reason: normalizeString(data.reason || data.note) || 'manual_remove',
		void_at: now,
		void_by: normalizeId(user && user._id) || null,
		void_by_name: normalizeString(user && user.username),
		request_id: requestId,
		updated_at: now
	})

	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_receipt_remove_v1',
		{
			customer_id: customerId,
			receipt_id: receiptId,
			rollback_total: rollback.rollback_total,
			allocation_rows: rollback.rows
		},
		requestId
	)

	return {
		code: 0,
		msg: '收款单已删除',
		data: {
			receipt_id: receiptId,
			customer_id: customerId,
			balances
		}
	}
}

async function createPrepayEntryV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'createPrepayEntryV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const amount = toNumber(data.amount, 0)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!(amount > 0)) return { code: 400, msg: '预付金额必须大于0' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const bizDate = normalizeBizDate(data.biz_date || data.bizDate, Date.now())
	const paymentMethodRaw = normalizeString(data.payment_method || data.paymentMethod).toLowerCase()
	if (paymentMethodRaw === 'on_account' || paymentMethodRaw === '挂账') {
		return { code: 400, msg: '预付录入必须选择现金/转账/微信/支付宝/支票' }
	}
	const paymentMethod = normalizePaymentMethod(data.payment_method || data.paymentMethod, 'paid')
	const note = normalizeString(data.note)
	const applyStrategy = normalizePrepayApplyStrategy(data.apply_strategy || data.applyStrategy, 'hold_only')
	const entryKind = normalizeEntryKind(data.entry_kind || data.entryKind, 'prepay')

	let plan = null
	let allocationMode = 'period'
	let allocationStartDate = bizDate
	let allocationEndDate = bizDate
	let allocationTargets = []
	if (applyStrategy === 'allocate_period') {
		const allocation = resolveAllocationConfig(data)
		if (!allocation.ok) return { code: allocation.code || 400, msg: allocation.msg || '分配参数无效' }
		allocationMode = allocation.allocation_mode
		allocationStartDate = allocation.allocation_start_date
		allocationEndDate = allocation.allocation_end_date
		allocationTargets = allocation.allocation_targets
		const allocationPlan = await buildAllocationPlan(customerId, amount, {
			allocationMode,
			allocationStartDate,
			allocationEndDate,
			allocationTargets
		})
		if (!allocationPlan.ok) return { code: allocationPlan.code || 400, msg: allocationPlan.msg || '预付录入失败' }
		plan = allocationPlan
	} else {
		plan = {
			ok: true,
			customer_id: customer._id,
			customer_name: customer.name,
			amount: fixMoney(amount),
			allocation_mode: 'period',
			allocation_start_date: bizDate,
			allocation_end_date: bizDate,
			allocation_targets: [],
			allocated_total: 0,
			prepay_amount: fixMoney(amount),
			total_outstanding_before: 0,
			allocations: []
		}
	}

	const sourceType = normalizeString(data.source_type || data.sourceType) || (entryKind === 'offset_credit' ? 'customer_offset_credit_manual' : 'customer_prepay_manual')
	const sourceId = normalizeId(data.source_id || data.sourceId)
	const applyRes = await applyAllocationAndPersist({
		user,
		requestId,
		customer,
		plan,
		bizDate,
		paymentMethod,
		allocationMode,
		allocationStartDate,
		allocationEndDate,
		allocationTargets,
		note,
		sourceType,
		sourceId,
		entryKind
	})
	const balances = await rebuildCustomerBalances(customer._id)
	await recordLog(
		user,
		'customer_prepay_entry_v1',
		{
			receipt_id: applyRes.receipt_id,
			customer_id: customer._id,
			amount: fixMoney(amount),
			apply_strategy: applyStrategy,
			entry_kind: entryKind,
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount
		},
		requestId
	)

	return {
		code: 0,
		msg: applyStrategy === 'allocate_period' ? '录入成功（已按规则冲欠）' : '录入成功',
		data: {
			receipt_id: applyRes.receipt_id,
			customer_id: customer._id,
			customer_name: customer.name,
			apply_strategy: applyStrategy,
			entry_kind: entryKind,
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount,
			balances
		}
	}
}

async function createOpeningDebtEntryV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'createOpeningDebtEntryV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const amountRaw = toNumber(data.amount, 0)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!(amountRaw > 0)) return { code: 400, msg: '欠款金额必须大于0' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const amount = fixMoney(amountRaw)
	const roundingAmountInput = data.rounding_amount ?? data.roundingAmount
	const roundingAmountRaw = roundingAmountInput == null || roundingAmountInput === '' ? 0 : toNumber(roundingAmountInput, 0)
	if (!Number.isFinite(roundingAmountRaw) || roundingAmountRaw < 0) return { code: 400, msg: '抹零金额不能小于0' }
	const roundingAmountFixed = fixMoney(roundingAmountRaw)
	if (roundingAmountFixed > amount) return { code: 400, msg: '抹零金额不能大于欠款金额' }
	const roundingAmount = resolveOpeningDebtRoundingAmount(amount, roundingAmountFixed, moneyScale)
	const effectiveShouldReceive = amount > 0 ? fixMoney(Math.max(amount - roundingAmount, 0)) : 0
	const paymentStatus = resolvePaymentStatusByAmount(effectiveShouldReceive, 0, moneyScale)
	const bizDate = normalizeBizDate(data.biz_date || data.bizDate, Date.now())
	const note = normalizeString(data.note)
	const sourceTypeInput = normalizeString(data.source_type || data.sourceType)
	const sourceType = isOtherFeeSourceType(sourceTypeInput)
		? 'customer_opening_debt_manual'
		: (sourceTypeInput || 'customer_opening_debt_manual')
	const sourceId = normalizeId(data.source_id || data.sourceId)

	const now = Date.now()
	const payload = {
		customer_id: customer._id,
		customer_name: customer.name,
		biz_date: bizDate,
		amount,
		rounding_amount: roundingAmount,
		amount_received: 0,
		outstanding: effectiveShouldReceive,
		payment_status: paymentStatus,
		note,
		status: 'posted',
		source_type: sourceType,
		source_id: sourceId || null,
		money_scale: moneyScale,
		request_id: requestId,
		created_at: now,
		created_by: normalizeId(user && user._id) || null,
		created_by_name: normalizeString(user && user.username),
		updated_at: now
	}
	const addRes = await openingDebts.add(payload)
	const openingDebtId = normalizeId(addRes && addRes.id)
	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_opening_debt_create_v1',
		{
			customer_id: customerId,
			opening_debt_id: openingDebtId,
			amount,
			rounding_amount: roundingAmount,
			should_receive_effective: effectiveShouldReceive,
			biz_date: bizDate
		},
		requestId
	)

	return {
		code: 0,
		msg: '历史欠款已登记',
		data: {
			_id: openingDebtId,
			customer_id: customerId,
			amount,
			rounding_amount: roundingAmount,
			should_receive_effective: effectiveShouldReceive,
			amount_received: 0,
			outstanding: effectiveShouldReceive,
			payment_status: paymentStatus,
			biz_date: bizDate,
			note,
			balances
		}
	}
}

async function updateOpeningDebtEntryV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'updateOpeningDebtEntryV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const openingDebtId = normalizeId(data.opening_debt_id || data.openingDebtId || data._id)
	if (!openingDebtId) return { code: 400, msg: 'opening_debt_id 必填' }

	const debtRes = await openingDebts.doc(openingDebtId).get()
	const debtDoc = (debtRes.data && debtRes.data[0]) || null
	if (!debtDoc) return { code: 404, msg: '历史欠款不存在' }
	if (normalizeString(debtDoc.status) !== 'posted') return { code: 400, msg: '仅支持编辑已入账历史欠款' }
	if (resolveOpeningDebtEntryType(debtDoc) !== 'opening_debt') return { code: 400, msg: '该记录不是历史欠款' }

	const debtCustomerId = normalizeId(debtDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || debtCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== debtCustomerId) return { code: 400, msg: '历史欠款不属于该客户' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveOpeningDebtMoneyScale(debtDoc, resolveCustomerMoneyScale(customer))
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const amountRaw = data.amount == null || data.amount === '' ? debtDoc.amount : data.amount
	const amount = fixMoney(toNumber(amountRaw, 0))
	if (!(amount > 0)) return { code: 400, msg: '欠款金额必须大于0' }
	const roundingAmountInput = data.rounding_amount ?? data.roundingAmount
	const roundingAmountRaw = roundingAmountInput == null || roundingAmountInput === ''
		? toNumber(debtDoc.rounding_amount, 0)
		: toNumber(roundingAmountInput, 0)
	if (!Number.isFinite(roundingAmountRaw) || roundingAmountRaw < 0) return { code: 400, msg: '抹零金额不能小于0' }
	const roundingAmountFixed = fixMoney(roundingAmountRaw)
	if (roundingAmountFixed > amount) return { code: 400, msg: '抹零金额不能大于欠款金额' }
	const roundingAmount = resolveOpeningDebtRoundingAmount(amount, roundingAmountFixed, moneyScale)
	const effectiveShouldReceive = amount > 0 ? fixMoney(Math.max(amount - roundingAmount, 0)) : 0
	const amountReceived = fixMoney(toNumber(debtDoc.amount_received, 0))
	if (effectiveShouldReceive < amountReceived) return { code: 400, msg: '计费应收不能小于已收金额' }
	const bizDate = normalizeBizDate(data.biz_date || data.bizDate || debtDoc.biz_date, Date.now())
	const note = data.note === undefined ? normalizeString(debtDoc.note) : normalizeString(data.note)
	const sourceTypeInput = normalizeString(data.source_type || data.sourceType || debtDoc.source_type)
	const sourceType = isOtherFeeSourceType(sourceTypeInput)
		? 'customer_opening_debt_manual'
		: (sourceTypeInput || 'customer_opening_debt_manual')
	const sourceIdRaw = data.source_id !== undefined || data.sourceId !== undefined ? data.source_id ?? data.sourceId : debtDoc.source_id
	const sourceId = normalizeId(sourceIdRaw)
	const paymentStatus = resolvePaymentStatusByAmount(effectiveShouldReceive, amountReceived, moneyScale)
	const outstanding = effectiveShouldReceive > amountReceived ? fixMoney(effectiveShouldReceive - amountReceived) : 0

	await openingDebts.doc(openingDebtId).update({
		customer_name: customer.name,
		biz_date: bizDate,
		amount,
		rounding_amount: roundingAmount,
		amount_received: amountReceived,
		outstanding,
		payment_status: paymentStatus,
		note,
		source_type: sourceType,
		source_id: sourceId || null,
		money_scale: moneyScale,
		request_id: requestId,
		updated_at: Date.now(),
		updated_by: normalizeId(user && user._id) || null,
		updated_by_name: normalizeString(user && user.username)
	})

	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_opening_debt_update_v1',
		{
			customer_id: customerId,
			opening_debt_id: openingDebtId,
			amount,
			rounding_amount: roundingAmount,
			should_receive_effective: effectiveShouldReceive,
			amount_received: amountReceived,
			outstanding
		},
		requestId
	)

	return {
		code: 0,
		msg: '历史欠款已更新',
		data: {
			_id: openingDebtId,
			customer_id: customerId,
			amount,
			rounding_amount: roundingAmount,
			should_receive_effective: effectiveShouldReceive,
			amount_received: amountReceived,
			outstanding,
			payment_status: paymentStatus,
			biz_date: bizDate,
			note,
			balances
		}
	}
}

async function removeOpeningDebtEntryV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'removeOpeningDebtEntryV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const openingDebtId = normalizeId(data.opening_debt_id || data.openingDebtId || data._id)
	if (!openingDebtId) return { code: 400, msg: 'opening_debt_id 必填' }

	const debtRes = await openingDebts.doc(openingDebtId).get()
	const debtDoc = (debtRes.data && debtRes.data[0]) || null
	if (!debtDoc) return { code: 404, msg: '历史欠款不存在' }
	if (normalizeString(debtDoc.status) !== 'posted') return { code: 400, msg: '仅支持删除已入账历史欠款' }
	if (resolveOpeningDebtEntryType(debtDoc) !== 'opening_debt') return { code: 400, msg: '该记录不是历史欠款' }

	const debtCustomerId = normalizeId(debtDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || debtCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== debtCustomerId) return { code: 400, msg: '历史欠款不属于该客户' }

	const linkedRes = await allocations
		.where({
			customer_id: customerId,
			target_type: 'opening_debt',
			target_id: openingDebtId
		})
		.limit(1)
		.get()
	const linkedRows = Array.isArray(linkedRes.data) ? linkedRes.data : []
	if (linkedRows.length || toNumber(debtDoc.amount_received, 0) > 0) {
		return { code: 400, msg: '该历史欠款已有收款分配，请先处理相关收款单后再删除' }
	}

	const now = Date.now()
	await openingDebts.doc(openingDebtId).update({
		status: 'void',
		void_reason: normalizeString(data.reason || data.note) || 'manual_remove',
		void_at: now,
		void_by: normalizeId(user && user._id) || null,
		void_by_name: normalizeString(user && user.username),
		request_id: requestId,
		updated_at: now
	})
	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_opening_debt_remove_v1',
		{
			customer_id: customerId,
			opening_debt_id: openingDebtId
		},
		requestId
	)

	return {
		code: 0,
		msg: '历史欠款已删除',
		data: {
			_id: openingDebtId,
			customer_id: customerId,
			balances
		}
	}
}

async function createOtherFeeEntryV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'createOtherFeeEntryV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const amountRaw = toNumber(data.amount, 0)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!(amountRaw > 0)) return { code: 400, msg: '其他费用金额必须大于0' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const amount = fixMoney(amountRaw)
	const bizDate = normalizeBizDate(data.biz_date || data.bizDate, Date.now())
	const note = normalizeString(data.note)
	const sourceTypeInput = normalizeString(data.source_type || data.sourceType)
	const sourceType = isOtherFeeSourceType(sourceTypeInput)
		? sourceTypeInput
		: 'customer_other_fee_manual'
	const sourceId = normalizeId(data.source_id || data.sourceId)

	const now = Date.now()
	const payload = {
		customer_id: customer._id,
		customer_name: customer.name,
		biz_date: bizDate,
		amount,
		rounding_amount: 0,
		amount_received: 0,
		outstanding: amount,
		payment_status: 'unpaid',
		note,
		status: 'posted',
		source_type: sourceType,
		source_id: sourceId || null,
		money_scale: moneyScale,
		request_id: requestId,
		created_at: now,
		created_by: normalizeId(user && user._id) || null,
		created_by_name: normalizeString(user && user.username),
		updated_at: now
	}
	const addRes = await openingDebts.add(payload)
	const otherFeeId = normalizeId(addRes && addRes.id)
	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_other_fee_create_v1',
		{
			customer_id: customerId,
			other_fee_id: otherFeeId,
			amount,
			biz_date: bizDate
		},
		requestId
	)

	return {
		code: 0,
		msg: '其他费用已登记',
		data: {
			_id: otherFeeId,
			customer_id: customerId,
			amount,
			amount_received: 0,
			outstanding: amount,
			payment_status: 'unpaid',
			biz_date: bizDate,
			note,
			balances
		}
	}
}

async function updateOtherFeeEntryV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'updateOtherFeeEntryV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const otherFeeId = normalizeId(
		data.other_fee_id || data.otherFeeId || data.opening_debt_id || data.openingDebtId || data._id
	)
	if (!otherFeeId) return { code: 400, msg: 'other_fee_id 必填' }

	const debtRes = await openingDebts.doc(otherFeeId).get()
	const debtDoc = (debtRes.data && debtRes.data[0]) || null
	if (!debtDoc) return { code: 404, msg: '其他费用不存在' }
	if (normalizeString(debtDoc.status) !== 'posted') return { code: 400, msg: '仅支持编辑已入账其他费用' }
	if (resolveOpeningDebtEntryType(debtDoc) !== 'other_fee') return { code: 400, msg: '该记录不是其他费用' }

	const debtCustomerId = normalizeId(debtDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || debtCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== debtCustomerId) return { code: 400, msg: '其他费用不属于该客户' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveOpeningDebtMoneyScale(debtDoc, resolveCustomerMoneyScale(customer))
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const amountRaw = data.amount == null || data.amount === '' ? debtDoc.amount : data.amount
	const amount = fixMoney(toNumber(amountRaw, 0))
	if (!(amount > 0)) return { code: 400, msg: '其他费用金额必须大于0' }

	const amountReceived = fixMoney(toNumber(debtDoc.amount_received, 0))
	if (amount < amountReceived) return { code: 400, msg: '其他费用金额不能小于已收金额' }
	const bizDate = normalizeBizDate(data.biz_date || data.bizDate || debtDoc.biz_date, Date.now())
	const note = data.note === undefined ? normalizeString(debtDoc.note) : normalizeString(data.note)
	const sourceTypeInput = normalizeString(data.source_type || data.sourceType || debtDoc.source_type)
	const sourceType = isOtherFeeSourceType(sourceTypeInput)
		? sourceTypeInput
		: 'customer_other_fee_manual'
	const sourceIdRaw = data.source_id !== undefined || data.sourceId !== undefined ? data.source_id ?? data.sourceId : debtDoc.source_id
	const sourceId = normalizeId(sourceIdRaw)
	const paymentStatus = resolvePaymentStatusByAmount(amount, amountReceived, moneyScale)
	const outstanding = amount > amountReceived ? fixMoney(amount - amountReceived) : 0

	await openingDebts.doc(otherFeeId).update({
		customer_name: customer.name,
		biz_date: bizDate,
		amount,
		rounding_amount: 0,
		amount_received: amountReceived,
		outstanding,
		payment_status: paymentStatus,
		note,
		source_type: sourceType,
		source_id: sourceId || null,
		money_scale: moneyScale,
		request_id: requestId,
		updated_at: Date.now(),
		updated_by: normalizeId(user && user._id) || null,
		updated_by_name: normalizeString(user && user.username)
	})

	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_other_fee_update_v1',
		{
			customer_id: customerId,
			other_fee_id: otherFeeId,
			amount,
			amount_received: amountReceived,
			outstanding
		},
		requestId
	)

	return {
		code: 0,
		msg: '其他费用已更新',
		data: {
			_id: otherFeeId,
			customer_id: customerId,
			amount,
			amount_received: amountReceived,
			outstanding,
			payment_status: paymentStatus,
			biz_date: bizDate,
			note,
			balances
		}
	}
}

async function removeOtherFeeEntryV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'removeOtherFeeEntryV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const otherFeeId = normalizeId(
		data.other_fee_id || data.otherFeeId || data.opening_debt_id || data.openingDebtId || data._id
	)
	if (!otherFeeId) return { code: 400, msg: 'other_fee_id 必填' }

	const debtRes = await openingDebts.doc(otherFeeId).get()
	const debtDoc = (debtRes.data && debtRes.data[0]) || null
	if (!debtDoc) return { code: 404, msg: '其他费用不存在' }
	if (normalizeString(debtDoc.status) !== 'posted') return { code: 400, msg: '仅支持删除已入账其他费用' }
	if (resolveOpeningDebtEntryType(debtDoc) !== 'other_fee') return { code: 400, msg: '该记录不是其他费用' }

	const debtCustomerId = normalizeId(debtDoc.customer_id)
	const customerId = normalizeId(data.customer_id || data.customerId || debtCustomerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (customerId !== debtCustomerId) return { code: 400, msg: '其他费用不属于该客户' }

	const linkedRes = await allocations
		.where({
			customer_id: customerId,
			target_type: 'other_fee',
			target_id: otherFeeId
		})
		.limit(1)
		.get()
	const linkedRows = Array.isArray(linkedRes.data) ? linkedRes.data : []
	if (linkedRows.length || toNumber(debtDoc.amount_received, 0) > 0) {
		return { code: 400, msg: '该其他费用已有收款分配，请先处理相关收款单后再删除' }
	}

	const now = Date.now()
	await openingDebts.doc(otherFeeId).update({
		status: 'void',
		void_reason: normalizeString(data.reason || data.note) || 'manual_remove',
		void_at: now,
		void_by: normalizeId(user && user._id) || null,
		void_by_name: normalizeString(user && user.username),
		request_id: requestId,
		updated_at: now
	})
	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_other_fee_remove_v1',
		{
			customer_id: customerId,
			other_fee_id: otherFeeId
		},
		requestId
	)

	return {
		code: 0,
		msg: '其他费用已删除',
		data: {
			_id: otherFeeId,
			customer_id: customerId,
			balances
		}
	}
}

async function voidSaleOffsetReceipts({ user, requestId, customerId, saleId }) {
	const normalizedCustomerId = normalizeId(customerId)
	const normalizedSaleId = normalizeId(saleId)
	if (!normalizedCustomerId || !normalizedSaleId) {
		return {
			source_receipt_rows: 0,
			voided_receipt_count: 0,
			rollback_total: 0,
			rollback_rows: 0,
			rollback_skipped: 0
		}
	}

	const rows = await listSaleOffsetCreditReceipts(normalizedCustomerId, normalizedSaleId)
	if (!rows.length) {
		return {
			source_receipt_rows: 0,
			voided_receipt_count: 0,
			rollback_total: 0,
			rollback_rows: 0,
			rollback_skipped: 0
		}
	}

	let rollbackTotal = 0
	let rollbackRows = 0
	let rollbackSkipped = 0
	let voidedCount = 0
	for (const row of rows) {
		const receiptId = normalizeId(row && row._id)
		if (!receiptId) continue
		const rollbackRes = await rollbackReceiptAllocations({
			customerId: normalizedCustomerId,
			receiptId
		})
		rollbackTotal = fix3(rollbackTotal + toNumber(rollbackRes && rollbackRes.rollback_total, 0))
		rollbackRows += toNumber(rollbackRes && rollbackRes.rows, 0)
		rollbackSkipped += toNumber(rollbackRes && rollbackRes.skipped, 0)
		const now = Date.now()
		await receipts.doc(receiptId).update({
			status: 'void',
			allocated_amount: 0,
			unallocated_amount: 0,
			void_reason: 'sale_removed',
			void_at: now,
			void_by: normalizeId(user && user._id) || null,
			void_by_name: normalizeString(user && user.username),
			request_id: requestId,
			updated_at: now
		})
		voidedCount += 1
	}

	return {
		source_receipt_rows: rows.length,
		voided_receipt_count: voidedCount,
		rollback_total: rollbackTotal,
		rollback_rows: rollbackRows,
		rollback_skipped: rollbackSkipped
	}
}

async function releaseSaleSettlementOnRemoveV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'releaseSaleSettlementOnRemoveV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const saleId = normalizeId(data.sale_id || data.saleId || data._id || data.id)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!saleId) return { code: 400, msg: 'sale_id 必填' }

	const released = await releaseSaleTargetAllocationsToPrepay({
		customerId,
		saleId
	})
	const voided = await voidSaleOffsetReceipts({
		user,
		requestId,
		customerId,
		saleId
	})
	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_sale_remove_release_v1',
		{
			customer_id: customerId,
			sale_id: saleId,
			released,
			voided
		},
		requestId
	)

	return {
		code: 0,
		msg: '销售结算关联已回收',
		data: {
			customer_id: customerId,
			sale_id: saleId,
			released,
			voided,
			balances
		}
	}
}

function normalizeOffsetCreditPoolFilters(data = {}) {
	return {
		customer_id: normalizeId(data.customer_id || data.customerId),
		only_unallocated: data.only_unallocated == null && data.onlyUnallocated == null
			? true
			: Boolean(data.only_unallocated ?? data.onlyUnallocated),
		page: Math.max(toNumber(data.page, 1), 1),
		page_size: Math.min(Math.max(toNumber(data.pageSize || data.page_size, 20), 1), 200)
	}
}

function buildOffsetCreditPoolWhere(customerId, onlyUnallocated = true) {
	const whereParts = [
		{ customer_id: customerId },
		{ status: 'posted' },
		dbCmd.or([
			{ entry_kind: 'offset_credit' },
			{ source_type: dbCmd.in(['sale_offset_credit', 'sale_offset_credit_repair']) }
		])
	]
	if (onlyUnallocated) whereParts.push({ unallocated_amount: dbCmd.gt(0) })
	return dbCmd.and(whereParts)
}

async function listOffsetCreditPoolV1(user, data) {
	void user
	const filters = normalizeOffsetCreditPoolFilters(data)
	if (!filters.customer_id) return { code: 400, msg: 'customer_id 必填' }
	const customer = await getCustomerById(filters.customer_id)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const where = buildOffsetCreditPoolWhere(filters.customer_id, filters.only_unallocated)

	const countRes = await receipts.where(where).count()
	const total = toNumber(countRes && countRes.total, 0)
	const skip = (filters.page - 1) * filters.page_size
	const res = await receipts
		.where(where)
		.orderBy('biz_date', 'desc')
		.orderBy('created_at', 'desc')
		.skip(skip)
		.limit(filters.page_size)
		.get()
	const list = Array.isArray(res.data) ? res.data : []

	const sourceSaleIds = Array.from(
		new Set(
			list
				.map((row) => normalizeId(row && row.source_id))
				.filter(Boolean)
		)
	)
	const saleMap = new Map()
	for (const saleIdChunk of chunkStrings(sourceSaleIds, 80)) {
		if (!saleIdChunk.length) continue
		const saleRes = await sales
			.where({ _id: dbCmd.in(saleIdChunk) })
			.field({ _id: true, date: true, offset_enabled: true, customer_id: true })
			.get()
		const saleList = Array.isArray(saleRes.data) ? saleRes.data : []
		saleList.forEach((row) => {
			const saleId = normalizeId(row && row._id)
			if (!saleId) return
			saleMap.set(saleId, row)
		})
	}

	const rows = list.map((row) => {
		const sourceSaleId = normalizeId(row && row.source_id)
		const sourceSale = sourceSaleId ? saleMap.get(sourceSaleId) : null
		return {
			_id: normalizeId(row && row._id),
			biz_date: normalizeDate(row && row.biz_date),
			amount: fixMoney(toNumber(row && row.amount, 0)),
			allocated_amount: fixMoney(toNumber(row && row.allocated_amount, 0)),
			unallocated_amount: fixMoney(toNumber(row && row.unallocated_amount, 0)),
			note: normalizeString(row && row.note),
			entry_kind: normalizeEntryKind(row && row.entry_kind, normalizeString(row && row.source_type).includes('offset') ? 'offset_credit' : 'prepay'),
			source_type: normalizeString(row && row.source_type),
			source_id: sourceSaleId,
			source_sale_date: normalizeDate(sourceSale && sourceSale.date),
			source_sale_offset_enabled: sourceSale ? resolveSaleOffsetEnabled(sourceSale, true) : null,
			created_at: toNumber(row && row.created_at, 0)
		}
	})
	const hasMore = skip + rows.length < total

	return {
		code: 0,
		msg: 'ok',
		data: rows,
		total,
		paging: {
			page: filters.page,
			pageSize: filters.page_size,
			total,
			hasMore
		}
	}
}

async function applyOffsetAllocationsToReceipt({
	user,
	requestId,
	customer,
	receiptDoc,
	plan,
	allocationMode = 'checked',
	allocationStartDate = '',
	allocationEndDate = '',
	allocationTargets = []
}) {
	const receiptId = normalizeId(receiptDoc && receiptDoc._id)
	if (!receiptId) return { ok: false, code: 400, msg: 'receipt_id 无效' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const normalizedMode = normalizeAllocationMode(allocationMode || plan.allocation_mode, 'checked')
	const normalizedStartDate = normalizedMode === 'period' ? normalizeDate(allocationStartDate || plan.allocation_start_date) : ''
	const normalizedEndDate = normalizedMode === 'period' ? normalizeDate(allocationEndDate || plan.allocation_end_date) : ''
	const normalizedTargets = normalizeAllocationTargets(allocationTargets || plan.allocation_targets || [])
	const allocationNote = normalizedMode === 'period' ? '冲抵区间分配' : '冲抵手工分配'
	const currentAllocated = fixMoney(toNumber(receiptDoc && receiptDoc.allocated_amount, 0))
	const currentUnallocated = fixMoney(toNumber(receiptDoc && receiptDoc.unallocated_amount, 0))
	const receiptSourceType = normalizeString(receiptDoc && receiptDoc.source_type)
	const receiptEntryKind = normalizeEntryKind(
		receiptDoc && receiptDoc.entry_kind,
		receiptSourceType.includes('offset') ? 'offset_credit' : 'prepay'
	)
	const existingRows = await listReceiptAllocationRows(receiptId, customer._id)
	let seq = existingRows.reduce((maxValue, row) => Math.max(maxValue, toNumber(row && row.seq, 0)), 0) + 1
	let allocatedDelta = 0

	for (const item of plan.allocations || []) {
		const targetType = normalizeReceivableTargetType(item.target_type)
		const targetId = normalizeId(item.target_id || item.sale_id)
		if (!targetId) continue

		let targetDate = ''
		let targetTitle = normalizeString(item.target_title)
		let allocateAmount = 0

		if (targetType === 'flow_settlement') {
			const flowRes = await flowSettlements.doc(targetId).get()
			const flowDoc = (flowRes.data && flowRes.data[0]) || null
			if (!flowDoc || normalizeId(flowDoc.customer_id) !== customer._id || normalizeString(flowDoc.status) !== 'posted') continue
			const snapshot = computeFlowSettlementSnapshot(flowDoc)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fix3(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fix3(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive, nextAmountReceived, 3)
			await flowSettlements.doc(targetId).update({
				amount_received: nextAmountReceived,
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(flowDoc.biz_date)
			if (!targetTitle) targetTitle = `流量结算 ${targetDate} / ${targetId.slice(-6)}`
		} else if (targetType === 'opening_debt' || targetType === 'other_fee') {
			const debtRes = await openingDebts.doc(targetId).get()
			const debtDoc = (debtRes.data && debtRes.data[0]) || null
			if (!debtDoc || normalizeId(debtDoc.customer_id) !== customer._id || normalizeString(debtDoc.status) !== 'posted') continue
			const snapshot = computeOpeningDebtSnapshot(debtDoc, moneyScale)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fixMoney(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fixMoney(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived, moneyScale)
			await openingDebts.doc(targetId).update({
				amount_received: nextAmountReceived,
				outstanding: fixMoney(Math.max(snapshot.should_receive_effective - nextAmountReceived, 0)),
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(debtDoc.biz_date)
			if (!targetTitle) {
				targetTitle = buildOpeningDebtTargetTitle({
					entryType: targetType,
					bizDate: targetDate,
					targetId
				})
			}
		} else {
			const saleRes = await sales.doc(targetId).get()
			const saleDoc = (saleRes.data && saleRes.data[0]) || null
			if (!saleDoc || normalizeId(saleDoc.customer_id) !== customer._id) continue
			const snapshot = computeSaleSnapshot(saleDoc)
			if (snapshot.outstanding <= 0) continue
			allocateAmount = fix2(Math.min(snapshot.outstanding, toNumber(item.allocate_amount, 0)))
			if (allocateAmount <= 0) continue
			const nextAmountReceived = fix2(snapshot.amount_received + allocateAmount)
			const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived)
			await sales.doc(targetId).update({
				amount_received: nextAmountReceived,
				payment_status: nextStatus,
				updated_at: Date.now()
			})
			targetDate = normalizeString(saleDoc.date)
			if (!targetTitle) targetTitle = `销售单 ${targetDate} / ${targetId.slice(-6)}`
		}

		await allocations.add({
			receipt_id: receiptId,
			customer_id: customer._id,
			customer_name: customer.name,
			sale_id: targetId,
			sale_date: targetDate,
			flow_settlement_id: targetType === 'flow_settlement' ? targetId : null,
			target_type: targetType,
			target_id: targetId,
			target_title: targetTitle,
			biz_date: normalizeBizDate(receiptDoc && receiptDoc.biz_date, Date.now()),
			allocate_amount: allocateAmount,
			seq,
			note: allocationNote,
			receipt_source_type: receiptSourceType,
			receipt_entry_kind: receiptEntryKind,
			receipt_biz_date: normalizeString(receiptDoc && receiptDoc.biz_date),
			allocation_mode: normalizedMode,
			allocation_start_date: normalizedStartDate,
			allocation_end_date: normalizedEndDate,
			allocation_targets: normalizedTargets,
			source_type: 'offset_manual_allocate',
			source_id: receiptId,
			request_id: requestId,
			created_at: Date.now(),
			created_by: normalizeId(user && user._id) || null,
			created_by_name: normalizeString(user && user.username)
		})
		seq += 1
		allocatedDelta = fixMoney(allocatedDelta + allocateAmount)
	}

	const nextAllocated = fixMoney(currentAllocated + allocatedDelta)
	const nextUnallocated = fixMoney(Math.max(currentUnallocated - allocatedDelta, 0))
	await receipts.doc(receiptId).update({
		allocated_amount: nextAllocated,
		unallocated_amount: nextUnallocated,
		allocation_mode: normalizedMode,
		allocation_start_date: normalizedStartDate,
		allocation_end_date: normalizedEndDate,
		allocation_targets: normalizedTargets,
		updated_at: Date.now(),
		updated_by: normalizeId(user && user._id) || null,
		updated_by_name: normalizeString(user && user.username)
	})

	return {
		ok: true,
		receipt_id: receiptId,
		allocated_delta: allocatedDelta,
		allocated_amount: nextAllocated,
		unallocated_amount: nextUnallocated
	}
}

async function allocateOffsetCreditV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'allocateOffsetCreditV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const receiptId = normalizeId(data.receipt_id || data.receiptId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!receiptId) return { code: 400, msg: 'receipt_id 必填' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const receiptRes = await receipts.doc(receiptId).get()
	const receiptDoc = (receiptRes.data && receiptRes.data[0]) || null
	if (!receiptDoc) return { code: 404, msg: '冲抵来源不存在' }
	if (normalizeId(receiptDoc.customer_id) !== customerId) return { code: 400, msg: '冲抵来源不属于该客户' }
	if (normalizeString(receiptDoc.status) !== 'posted') return { code: 400, msg: '仅支持已入账冲抵来源' }
	if (!isOffsetCreditReceiptRow(receiptDoc)) return { code: 400, msg: '该单据不是冲抵款来源' }

	const available = fixMoney(toNumber(receiptDoc.unallocated_amount, 0))
	if (!(available > 0)) return { code: 400, msg: '该冲抵来源无可用余额' }
	let amount = data.amount == null || data.amount === '' ? available : fixMoney(toNumber(data.amount, 0))
	if (!(amount > 0)) return { code: 400, msg: '本次冲抵金额必须大于0' }
	if (amount > available) amount = available

	const inputTargets = normalizeAllocationTargets(data.allocation_targets || data.allocationTargets || [])
	const inputStartDate = normalizeDate(data.allocation_start_date || data.allocationStartDate)
	const inputEndDate = normalizeDate(data.allocation_end_date || data.allocationEndDate)
	const inputMode = normalizeString(data.allocation_mode || data.allocationMode).toLowerCase()
	const inferredMode =
		inputMode === 'period' || inputMode === 'checked'
			? inputMode
			: inputTargets.length > 0 && !inputStartDate && !inputEndDate
				? 'checked'
				: 'period'
	const allocation = resolveAllocationConfig(
		{
			allocation_mode: inferredMode,
			allocation_start_date: inputStartDate,
			allocation_end_date: inputEndDate,
			allocation_targets: inputTargets
		},
		normalizeDate(receiptDoc.biz_date)
	)
	if (!allocation.ok) return { code: allocation.code || 400, msg: allocation.msg || '冲抵分配失败' }

	const plan = await buildAllocationPlan(customerId, amount, {
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets
	})
	if (!plan.ok) return { code: plan.code || 400, msg: plan.msg || '冲抵分配失败' }
	if (!(toNumber(plan.allocated_total, 0) > 0)) {
		return {
			code: 400,
			msg: allocation.allocation_mode === 'period' ? '当前时间段内无可冲抵欠款' : '当前勾选目标无可冲抵欠款'
		}
	}

	const applyRes = await applyOffsetAllocationsToReceipt({
		user,
		requestId,
		customer,
		receiptDoc,
		plan,
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets
	})
	if (!applyRes.ok) return { code: applyRes.code || 400, msg: applyRes.msg || '冲抵分配失败' }

	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_offset_credit_allocate_v1',
		{
			customer_id: customerId,
			receipt_id: receiptId,
			allocation_mode: allocation.allocation_mode,
			allocation_start_date: allocation.allocation_start_date,
			allocation_end_date: allocation.allocation_end_date,
			target_count: allocation.allocation_targets.length,
			allocated_delta: applyRes.allocated_delta,
			allocated_rows: Array.isArray(plan.allocations) ? plan.allocations.length : 0
		},
		requestId
	)

	return {
		code: 0,
		msg: '冲抵分配成功',
		data: {
			receipt_id: receiptId,
			customer_id: customerId,
			allocation_mode: allocation.allocation_mode,
			allocation_start_date: allocation.allocation_start_date,
			allocation_end_date: allocation.allocation_end_date,
			allocated_total: applyRes.allocated_delta,
			remaining_unallocated: applyRes.unallocated_amount,
			allocations: Array.isArray(plan.allocations) ? plan.allocations : [],
			balances
		}
	}
}

async function exportCustomerStatementV1(user, data) {
	void user
	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const dateFrom = normalizeDate(data.date_from || data.dateFrom)
	const dateTo = normalizeDate(data.date_to || data.dateTo)
	if (!dateFrom || !dateTo) return { code: 400, msg: 'date_from/date_to 必填' }
	if (dateFrom > dateTo) return { code: 400, msg: '开始日期不能晚于结束日期' }

	const openingDateTo = addDays(dateFrom, -1)
	const openingSales = openingDateTo ? await listCustomerSales(customerId, { dateTo: openingDateTo }) : []
	const openingFlowSettlements = openingDateTo ? await listCustomerFlowSettlements(customerId, { dateTo: openingDateTo }) : []
	const openingDebtRowsBefore = openingDateTo ? await listCustomerOpeningDebts(customerId, { dateTo: openingDateTo }) : []
	const openingReceipts = await listCustomerReceipts(customerId, { dateBefore: dateFrom })
	const openingShouldReceive = fixMoney(
		openingSales.reduce((sum, row) => sum + computeSaleSnapshot(row).should_receive, 0) +
			openingFlowSettlements.reduce((sum, row) => sum + computeFlowSettlementSnapshot(row).should_receive, 0) +
			openingDebtRowsBefore.reduce((sum, row) => sum + computeOpeningDebtSnapshot(row, moneyScale).should_receive_effective, 0)
	)
	const openingReceived = fixMoney(openingReceipts.reduce((sum, row) => sum + toNumber(row && row.amount, 0), 0))
	const openingBalance = fixMoney(openingShouldReceive - openingReceived)

	const rangeSales = await listCustomerSales(customerId, { dateFrom, dateTo })
	const rangeFlowSettlements = await listCustomerFlowSettlements(customerId, { dateFrom, dateTo })
	const rangeOpeningDebts = await listCustomerOpeningDebts(customerId, { dateFrom, dateTo })
	const rangeReceipts = await listCustomerReceipts(customerId, { dateFrom, dateTo })
	const rangeAllocRes = await allocations
		.where(
			dbCmd.and([
				{ customer_id: customerId },
				{ biz_date: dbCmd.gte(dateFrom) },
				{ biz_date: dbCmd.lte(dateTo) }
			])
		)
		.orderBy('biz_date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()
	const rangeAllocations = Array.isArray(rangeAllocRes.data) ? rangeAllocRes.data : []

	const dayMap = new Map()
	const dateSeries = buildDateSeries(dateFrom, dateTo)
	dateSeries.forEach((date) => {
		dayMap.set(date, {
			date,
			weight_kg: 0,
			weight_amount: 0,
			amount: 0,
			receipt: 0,
			flow_count: 0,
			offset_notes: new Set()
		})
	})

	rangeSales.forEach((row) => {
		const date = normalizeDate(row && row.date)
		const day = dayMap.get(date)
		if (!day) return
		const snapshot = computeSaleSnapshot(row)
		day.amount = fixMoney(day.amount + snapshot.should_receive)
		const isKgSale = normalizeString(row && row.price_unit) === 'kg'
		const actualWeight = isKgSale ? computeSaleActualWeight(row) : 0
		if (actualWeight > 0) {
			day.weight_kg = fix2(day.weight_kg + actualWeight)
			day.weight_amount = fix2(day.weight_amount + snapshot.should_receive)
		}
	})

	rangeFlowSettlements.forEach((row) => {
		const date = normalizeDate(row && row.biz_date)
		const day = dayMap.get(date)
		if (!day) return
		const snapshot = computeFlowSettlementSnapshot(row)
		day.amount = fixMoney(day.amount + snapshot.should_receive)
		day.flow_count += 1
	})
	rangeOpeningDebts.forEach((row) => {
		const date = normalizeDate(row && row.biz_date)
		const day = dayMap.get(date)
		if (!day) return
		const snapshot = computeOpeningDebtSnapshot(row, moneyScale)
		day.amount = fixMoney(day.amount + snapshot.should_receive_effective)
	})

	rangeReceipts.forEach((row) => {
		const date = normalizeDate(row && row.biz_date)
		const day = dayMap.get(date)
		if (!day) return
		day.receipt = fixMoney(day.receipt + toNumber(row && row.amount, 0))
	})

	rangeAllocations.forEach((row) => {
		const date = normalizeDate(row && row.biz_date)
		const day = dayMap.get(date)
		if (!day) return
		const note = normalizeString(row && row.note)
		if (!note) return
		if (!note.startsWith('自动冲抵来源 ')) return
		day.offset_notes.add(note)
	})

	let runningBalance = openingBalance
	let totalWeight = 0
	let totalAmount = 0
	let totalReceipt = 0
	const rows = dateSeries.map((date) => {
		const day = dayMap.get(date) || {
			weight_kg: 0,
			weight_amount: 0,
			amount: 0,
			receipt: 0,
			flow_count: 0,
			offset_notes: new Set()
		}
		const amount = fixMoney(day.amount)
		const receipt = fixMoney(day.receipt)
		const weight = day.weight_kg > 0 ? fix2(day.weight_kg) : null
		const unitPrice = day.weight_kg > 0 ? fix2(day.weight_amount / day.weight_kg) : null
		const notes = []
		if (day.flow_count > 0) notes.push(`流量结算${day.flow_count}笔`)
		if (day.offset_notes && day.offset_notes.size) {
			const list = Array.from(day.offset_notes.values())
			notes.push(list.join('；'))
		}
		runningBalance = fixMoney(runningBalance + amount - receipt)
		totalWeight = fix2(totalWeight + (weight || 0))
		totalAmount = fixMoney(totalAmount + amount)
		totalReceipt = fixMoney(totalReceipt + receipt)
		return {
			biz_date: date,
			weight_kg: weight,
			unit_price: unitPrice,
			amount,
			receipt,
			balance: runningBalance,
			note: notes.join('；')
		}
	})

	return {
		code: 0,
		msg: 'ok',
		data: {
			company_name: STATEMENT_COMPANY_NAME,
			customer: {
				_id: customer._id,
				name: normalizeString(customer.name),
				contact: normalizeString(customer.contact),
				phone: normalizeString(customer.phone),
				default_price_unit: normalizeString(customer.default_price_unit) || 'kg'
			},
			period: {
				date_from: dateFrom,
				date_to: dateTo
			},
			opening_balance: openingBalance,
			rows,
			totals: {
				weight_kg: totalWeight,
				amount: totalAmount,
				receipt: totalReceipt
			},
			closing_balance: rows.length ? fixMoney(rows[rows.length - 1].balance) : openingBalance
		}
	}
}

async function confirmAllocationV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'confirmAllocationV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const amount = toNumber(data.amount, 0)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!(amount > 0)) return { code: 400, msg: '收款金额必须大于0' }
	const allocation = resolveAllocationConfig(data)
	if (!allocation.ok) return { code: allocation.code || 400, msg: allocation.msg || '分配参数无效' }

	const manual = normalizeManualAllocations(data.allocations || [])
	const plan = await buildAllocationPlan(customerId, amount, {
		manualAllocations: manual,
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets
	})
	if (!plan.ok) return { code: plan.code || 400, msg: plan.msg || '确认失败' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const bizDate = normalizeBizDate(data.biz_date || data.bizDate, Date.now())
	const paymentMethodRaw = normalizeString(data.payment_method || data.paymentMethod).toLowerCase()
	if (paymentMethodRaw === 'on_account' || paymentMethodRaw === '挂账') {
		return { code: 400, msg: '收款登记必须选择现金/转账/微信/支付宝/支票' }
	}
	const paymentMethod = normalizePaymentMethod(data.payment_method || data.paymentMethod, 'paid')
	const note = normalizeString(data.note)
	const sourceType = normalizeString(data.source_type || data.sourceType) || 'manual'
	const sourceId = normalizeId(data.source_id || data.sourceId)

	const applyRes = await applyAllocationAndPersist({
		user,
		requestId,
		customer,
		plan,
		bizDate,
		paymentMethod,
		allocationMode: allocation.allocation_mode,
		allocationStartDate: allocation.allocation_start_date,
		allocationEndDate: allocation.allocation_end_date,
		allocationTargets: allocation.allocation_targets,
		note,
		sourceType,
		sourceId,
		entryKind: 'prepay'
	})
	const balances = await rebuildCustomerBalances(customer._id)

	await recordLog(
		user,
		'customer_receipt_confirm_v1',
		{
			receipt_id: applyRes.receipt_id,
			customer_id: customer._id,
			amount: fixMoney(amount),
			manual_allocations: manual.length,
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount
		},
		requestId
	)

	return {
		code: 0,
		msg: '确认入账成功',
		data: {
			receipt_id: applyRes.receipt_id,
			customer_id: customer._id,
			customer_name: customer.name,
			allocated_total: applyRes.allocated_total,
			prepay_amount: applyRes.prepay_amount,
			balances
		}
	}
}

function normalizeRepairItems(items = []) {
	if (!Array.isArray(items)) return []
	return items
		.map((item) => ({
			receipt_id: normalizeId(item && (item.receipt_id || item.receiptId)),
			allocation_mode: normalizeAllocationMode(item && (item.allocation_mode || item.allocationMode), 'period'),
			allocation_start_date: normalizeDate(item && (item.allocation_start_date || item.allocationStartDate)),
			allocation_end_date: normalizeDate(item && (item.allocation_end_date || item.allocationEndDate)),
			allocation_targets: normalizeAllocationTargets(item && (item.allocation_targets || item.allocationTargets)),
			payment_method_override: normalizeString(item && (item.payment_method_override || item.paymentMethodOverride))
		}))
		.filter((item) => item.receipt_id)
}

async function repairReceiptAllocationV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'repairReceiptAllocationV1', requestId, REBUILD_ROLES)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const execute = Boolean(data && data.execute)
	const dateFrom = normalizeDate(data.date_from || data.dateFrom)
	const dateTo = normalizeDate(data.date_to || data.dateTo)
	const items = normalizeRepairItems(data.items || [])

	if (!items.length) {
		if (execute) return { code: 400, msg: '执行模式必须提供 items' }
		const whereParts = [{ customer_id: customerId, status: 'posted' }]
		if (dateFrom) whereParts.push({ biz_date: dbCmd.gte(dateFrom) })
		if (dateTo) whereParts.push({ biz_date: dbCmd.lte(dateTo) })
		const where = whereParts.length === 1 ? whereParts[0] : dbCmd.and(whereParts)
		const receiptRes = await receipts
			.where(where)
			.orderBy('biz_date', 'desc')
			.orderBy('created_at', 'desc')
			.limit(500)
			.get()
		const receiptRows = Array.isArray(receiptRes.data) ? receiptRes.data : []
		const candidates = []
		for (const row of receiptRows) {
			const receiptId = normalizeId(row._id)
			const allocRows = await listReceiptAllocationRows(receiptId, customerId)
			const saleDates = allocRows.map((item) => normalizeString(item.sale_date)).filter(Boolean).sort()
			candidates.push({
				receipt_id: receiptId,
				biz_date: normalizeString(row.biz_date),
				amount: fixMoney(toNumber(row.amount, 0)),
				allocated_amount: fixMoney(toNumber(row.allocated_amount, 0)),
				unallocated_amount: fixMoney(toNumber(row.unallocated_amount, 0)),
				payment_method: normalizePaymentMethod(row.payment_method, 'paid'),
				entry_kind: normalizeEntryKind(row.entry_kind, normalizeString(row.source_type).includes('offset') ? 'offset_credit' : 'prepay'),
				allocation_mode: normalizeAllocationMode(row.allocation_mode, 'period'),
				allocation_start_date: normalizeDate(row.allocation_start_date),
				allocation_end_date: normalizeDate(row.allocation_end_date),
				allocation_targets: normalizeAllocationTargets(row.allocation_targets),
				allocations_count: allocRows.length,
				allocation_sale_date_min: saleDates[0] || '',
				allocation_sale_date_max: saleDates[saleDates.length - 1] || ''
			})
		}
		await recordLog(
			user,
			'customer_repair_receipt_allocation_v1_preview_candidates',
			{
				customer_id: customerId,
				date_from: dateFrom,
				date_to: dateTo,
				candidates: candidates.length
			},
			requestId
		)
		return {
			code: 0,
			msg: '候选清单已生成',
			data: {
				execute: false,
				customer_id: customerId,
				date_from: dateFrom,
				date_to: dateTo,
				candidates
			}
		}
	}

	const results = []
	let successCount = 0
	let errorCount = 0
	for (const item of items) {
		const receiptId = normalizeId(item.receipt_id)
		const receiptRes = await receipts.doc(receiptId).get()
		const receiptDoc = (receiptRes.data && receiptRes.data[0]) || null
		if (!receiptDoc) {
			errorCount += 1
			results.push({ receipt_id: receiptId, ok: false, msg: '收款单不存在' })
			continue
		}
		if (normalizeId(receiptDoc.customer_id) !== customerId) {
			errorCount += 1
			results.push({ receipt_id: receiptId, ok: false, msg: '收款单不属于该客户' })
			continue
		}
		if (normalizeString(receiptDoc.status) !== 'posted') {
			errorCount += 1
			results.push({ receipt_id: receiptId, ok: false, msg: '仅支持已入账收款单' })
			continue
		}

		const amount = fixMoney(toNumber(receiptDoc.amount, 0))
		if (!(amount > 0)) {
			errorCount += 1
			results.push({ receipt_id: receiptId, ok: false, msg: '收款单金额无效' })
			continue
		}

		const allocation = resolveAllocationConfig({
			allocation_mode: item.allocation_mode,
			allocation_start_date: item.allocation_start_date,
			allocation_end_date: item.allocation_end_date,
			allocation_targets: item.allocation_targets
		})
		if (!allocation.ok) {
			errorCount += 1
			results.push({ receipt_id: receiptId, ok: false, msg: allocation.msg || '分配参数无效' })
			continue
		}

		const currentAllocRows = await listReceiptAllocationRows(receiptId, customerId)
		const currentAllocatedTotal = fixMoney(currentAllocRows.reduce((sum, row) => sum + toNumber(row.allocate_amount, 0), 0))
		const currentTargets = currentAllocRows.map((row) => ({
			target_type: normalizeReceivableTargetType(row.target_type),
			target_id: normalizeId(row.target_id || row.sale_id),
			sale_date: normalizeString(row.sale_date),
			allocate_amount: fixMoney(toNumber(row.allocate_amount, 0))
		}))

		const plan = await buildAllocationPlan(customerId, amount, {
			allocationMode: allocation.allocation_mode,
			allocationStartDate: allocation.allocation_start_date,
			allocationEndDate: allocation.allocation_end_date,
			allocationTargets: allocation.allocation_targets
		})
		if (!plan.ok) {
			errorCount += 1
			results.push({ receipt_id: receiptId, ok: false, msg: plan.msg || '重建分配计划失败' })
			continue
		}

		const paymentMethodBefore = normalizePaymentMethod(receiptDoc.payment_method, 'paid')
		let paymentMethodAfter = paymentMethodBefore
		if (item.payment_method_override) {
			paymentMethodAfter = normalizePaymentMethod(item.payment_method_override, 'paid')
			if (paymentMethodAfter === 'on_account') {
				errorCount += 1
				results.push({ receipt_id: receiptId, ok: false, msg: 'payment_method_override 不能为挂账' })
				continue
			}
		}

		const resultItem = {
			receipt_id: receiptId,
			ok: true,
			execute,
			biz_date: normalizeString(receiptDoc.biz_date),
			amount,
			payment_method_before: paymentMethodBefore,
			payment_method_after: paymentMethodAfter,
			allocation_mode: allocation.allocation_mode,
			allocation_start_date: allocation.allocation_start_date,
			allocation_end_date: allocation.allocation_end_date,
			allocation_targets: allocation.allocation_targets,
			current_allocations_total: currentAllocatedTotal,
			current_allocations_count: currentTargets.length,
			current_allocations: currentTargets,
			next_allocations_total: fixMoney(plan.allocated_total),
			next_allocations_count: Array.isArray(plan.allocations) ? plan.allocations.length : 0,
			next_allocations: (plan.allocations || []).map((row) => ({
				target_type: normalizeReceivableTargetType(row.target_type),
				target_id: normalizeId(row.target_id || row.sale_id),
				sale_date: normalizeString(row.sale_date),
				allocate_amount: fixMoney(toNumber(row.allocate_amount, 0))
			}))
		}

		if (!execute) {
			successCount += 1
			results.push(resultItem)
			continue
		}

		const rollbackRes = await rollbackReceiptAllocations({
			customerId,
			receiptId
		})
		const applyRes = await applyPlanToExistingReceipt({
			user,
			requestId,
			customer,
			receiptDoc,
			plan,
			paymentMethod: paymentMethodAfter,
			allocationMode: allocation.allocation_mode,
			allocationStartDate: allocation.allocation_start_date,
			allocationEndDate: allocation.allocation_end_date,
			allocationTargets: allocation.allocation_targets,
			sourceType: 'receipt_repair_v1',
			sourceId: receiptId,
			allocationNote: '修复重分配'
		})
		if (!applyRes.ok) {
			errorCount += 1
			results.push({
				...resultItem,
				ok: false,
				msg: applyRes.msg || '执行失败',
				rollback: rollbackRes
			})
			continue
		}
		successCount += 1
		results.push({
			...resultItem,
			rollback: rollbackRes,
			applied: {
				allocated_total: applyRes.allocated_total,
				prepay_amount: applyRes.prepay_amount
			}
		})
	}

	const balances = execute ? await rebuildCustomerBalances(customerId) : null
	await recordLog(
		user,
		execute ? 'customer_repair_receipt_allocation_v1_execute' : 'customer_repair_receipt_allocation_v1_preview',
		{
			customer_id: customerId,
			total_items: items.length,
			success_count: successCount,
			error_count: errorCount,
			execute
		},
		requestId
	)

	return {
		code: 0,
		msg: execute ? '收款分配修复完成' : '收款分配修复预览完成',
		data: {
			execute,
			customer_id: customerId,
			total_items: items.length,
			success_count: successCount,
			error_count: errorCount,
			results,
			balances
		}
	}
}

async function listSaleOffsetCreditReceipts(customerId, saleId) {
	const where = {
		customer_id: normalizeId(customerId),
		source_id: normalizeId(saleId),
		status: 'posted',
		source_type: dbCmd.in(['sale_offset_credit', 'sale_offset_credit_repair'])
	}
	const res = await receipts
		.where(where)
		.orderBy('created_at', 'asc')
		.limit(200)
		.get()
	return Array.isArray(res.data) ? res.data : []
}

async function createOffsetCreditReceipt({ user, requestId, customer, saleDoc, amount, sourceType = 'sale_offset_credit' }) {
	const total = fix2(toNumber(amount, 0))
	if (!(total > 0)) return null
	const saleId = normalizeId(saleDoc && saleDoc._id)
	const saleDate = normalizeDate(saleDoc && saleDoc.date)
	const now = Date.now()
	const payload = {
		customer_id: normalizeId(customer && customer._id),
		customer_name: normalizeString(customer && customer.name),
		biz_date: saleDate || normalizeBizDate('', now),
		amount: total,
		allocated_amount: 0,
		unallocated_amount: total,
		payment_method: 'cash',
		entry_kind: 'offset_credit',
		allocation_mode: 'period',
		allocation_start_date: saleDate || '',
		allocation_end_date: saleDate || '',
		allocation_targets: [],
		note: `销售单${saleDate || '-'}冲抵款入池`,
		source_type: normalizeString(sourceType) || 'sale_offset_credit',
		source_id: saleId || null,
		status: 'posted',
		request_id: requestId,
		created_at: now,
		created_by: normalizeId(user && user._id) || null,
		created_by_name: normalizeString(user && user.username),
		updated_at: now
	}
	const addRes = await receipts.add(payload)
	return normalizeId(addRes && addRes.id)
}

async function repairOffsetCreditsV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'repairOffsetCreditsV1', requestId, WRITE_ROLES)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	const dateFrom = normalizeDate(data.date_from || data.dateFrom)
	const dateTo = normalizeDate(data.date_to || data.dateTo)
	const execute = Boolean(data && data.execute)
	const autoApply = Boolean(data && (data.auto_apply ?? data.autoApply))
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	if (!dateFrom || !dateTo) return { code: 400, msg: 'date_from/date_to 必填' }
	if (dateFrom > dateTo) return { code: 400, msg: '开始日期不能晚于结束日期' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }

	const salesDocs = await listCustomerSales(customerId, { dateFrom, dateTo })
	const sortedSales = (Array.isArray(salesDocs) ? salesDocs : [])
		.slice()
		.sort((a, b) => {
			const aDate = normalizeString(a && a.date)
			const bDate = normalizeString(b && b.date)
			if (aDate !== bDate) return aDate < bDate ? -1 : 1
			const aId = normalizeId(a && a._id)
			const bId = normalizeId(b && b._id)
			return aId < bId ? -1 : 1
		})

	const results = []
	let createdCount = 0
	let reducedCount = 0
	let unresolvedCount = 0

	for (const saleDoc of sortedSales) {
		const saleId = normalizeId(saleDoc && saleDoc._id)
		if (!saleId) continue
		const snapshot = computeSaleSnapshot(saleDoc)
		const offsetEnabled = resolveSaleOffsetEnabled(saleDoc, true)
		const expectedOffset = offsetEnabled ? fix2(Math.max(0, snapshot.amount_received - snapshot.should_receive_effective)) : 0
		const existingRows = await listSaleOffsetCreditReceipts(customerId, saleId)
		const existingTotal = fix2(existingRows.reduce((sum, row) => sum + toNumber(row && row.amount, 0), 0))
		const existingAllocated = fix2(existingRows.reduce((sum, row) => sum + toNumber(row && row.allocated_amount, 0), 0))
		const existingAdjustable = fix2(
			existingRows.reduce((sum, row) => {
				const amount = toNumber(row && row.amount, 0)
				const allocated = toNumber(row && row.allocated_amount, 0)
				return sum + Math.max(0, amount - allocated)
			}, 0)
		)
		const diff = fix2(expectedOffset - existingTotal)

		const detail = {
			sale_id: saleId,
			sale_date: normalizeString(saleDoc && saleDoc.date),
			offset_enabled: offsetEnabled,
			should_receive_effective: fix2(snapshot.should_receive_effective),
			amount_received: fix2(snapshot.amount_received),
			expected_offset_credit: expectedOffset,
			existing_offset_total: existingTotal,
			existing_offset_allocated: existingAllocated,
			existing_offset_adjustable: existingAdjustable,
			diff,
			existing_receipts: existingRows.map((row) => ({
				receipt_id: normalizeId(row && row._id),
				source_type: normalizeString(row && row.source_type),
				biz_date: normalizeString(row && row.biz_date),
				amount: fix2(toNumber(row && row.amount, 0)),
				allocated_amount: fix2(toNumber(row && row.allocated_amount, 0)),
				unallocated_amount: fix2(toNumber(row && row.unallocated_amount, 0))
			}))
		}

		if (!execute) {
			results.push({ ...detail, ok: true })
			continue
		}

		const executed = {
			created_receipt_ids: [],
			reduced_receipt_ids: [],
			remaining_unresolved_reduce: 0
		}

		if (diff > 0) {
			const createdId = await createOffsetCreditReceipt({
				user,
				requestId,
				customer,
				saleDoc,
				amount: diff,
				sourceType: existingRows.length ? 'sale_offset_credit_repair' : 'sale_offset_credit'
			})
			if (createdId) {
				createdCount += 1
				executed.created_receipt_ids.push(createdId)
			}
		} else if (diff < 0) {
			let needReduce = fix2(Math.abs(diff))
			const rowsForReduce = existingRows
				.slice()
				.sort((a, b) => toNumber(b && b.created_at, 0) - toNumber(a && a.created_at, 0))
			for (const row of rowsForReduce) {
				if (needReduce <= 0) break
				const receiptId = normalizeId(row && row._id)
				if (!receiptId) continue
				const amountRaw = fix2(toNumber(row && row.amount, 0))
				const allocatedRaw = fix2(toNumber(row && row.allocated_amount, 0))
				const unallocatedRaw = fix2(toNumber(row && row.unallocated_amount, 0))
				const adjustable = fix2(Math.max(0, amountRaw - allocatedRaw))
				if (adjustable <= 0) continue
				const reduceAmount = fix2(Math.min(adjustable, needReduce))
				if (!(reduceAmount > 0)) continue
				const nextAmount = fix2(amountRaw - reduceAmount)
				const nextUnallocated = fix2(Math.max(0, unallocatedRaw - reduceAmount))
				if (nextAmount <= 0 && allocatedRaw <= 0) {
					await receipts.doc(receiptId).remove()
				} else {
					await receipts.doc(receiptId).update({
						amount: nextAmount,
						unallocated_amount: nextUnallocated,
						updated_at: Date.now()
					})
				}
				reducedCount += 1
				executed.reduced_receipt_ids.push(receiptId)
				needReduce = fix2(needReduce - reduceAmount)
			}
			if (needReduce > 0) {
				unresolvedCount += 1
				executed.remaining_unresolved_reduce = needReduce
			}
		}

		results.push({
			...detail,
			ok: true,
			executed
		})
	}

	const autoApplyResults = []
	if (execute && autoApply) {
		for (const row of sortedSales) {
			const saleId = normalizeId(row && row._id)
			if (!saleId) continue
			const applyRes = await autoApplyPrepayToSaleV1(user, { sale_id: saleId }, requestId)
			autoApplyResults.push({
				sale_id: saleId,
				applied_amount: fix2(toNumber(applyRes && applyRes.data && applyRes.data.applied_amount, 0)),
				code: toNumber(applyRes && applyRes.code, 500),
				msg: normalizeString(applyRes && applyRes.msg)
			})
		}
	}
	const balances = execute ? await rebuildCustomerBalances(customerId) : null
	await recordLog(
		user,
		execute ? 'customer_repair_offset_credits_v1_execute' : 'customer_repair_offset_credits_v1_preview',
		{
			customer_id: customerId,
			date_from: dateFrom,
			date_to: dateTo,
			execute,
			auto_apply: autoApply,
			sales: sortedSales.length,
			created_count: createdCount,
			reduced_count: reducedCount,
			unresolved_count: unresolvedCount
		},
		requestId
	)
	return {
		code: 0,
		msg: execute ? '冲抵款修复完成' : '冲抵款修复预览完成',
		data: {
			execute,
			auto_apply: autoApply,
			customer_id: customerId,
			date_from: dateFrom,
			date_to: dateTo,
			total_sales: sortedSales.length,
			created_count: createdCount,
			reduced_count: reducedCount,
			unresolved_count: unresolvedCount,
			results,
			auto_apply_results: autoApplyResults,
			balances
		}
	}
}

async function autoApplyPrepayToFlowSettlementV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'autoApplyPrepayToFlowSettlementV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const flowSettlementId = normalizeId(data.flow_settlement_id || data.flowSettlementId || data._id || data.id)
	if (!flowSettlementId) return { code: 400, msg: 'flow_settlement_id 必填' }

	const flowRes = await flowSettlements.doc(flowSettlementId).get()
	const flowDoc = (flowRes.data && flowRes.data[0]) || null
	if (!flowDoc) return { code: 404, msg: '流量结算单不存在' }
	if (normalizeString(flowDoc.status) !== 'posted') return { code: 400, msg: '仅支持已入账流量结算单' }

	const customerId = normalizeId(flowDoc.customer_id)
	if (!customerId) return { code: 400, msg: '流量结算单缺少客户' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }

	const snapshot = computeFlowSettlementSnapshot(flowDoc)
	if (snapshot.outstanding <= 0) {
		const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive, snapshot.amount_received, 3)
		if (normalizeString(flowDoc.payment_status) !== nextStatus) {
			await flowSettlements.doc(flowSettlementId).update({
				payment_status: nextStatus,
				updated_at: Date.now()
			})
		}
		const balancesNoop = await rebuildCustomerBalances(customerId)
		return {
			code: 0,
			msg: '无需抵扣',
			data: {
				flow_settlement_id: flowSettlementId,
				applied_amount: 0,
				amount_received: snapshot.amount_received,
				payment_status: nextStatus,
				outstanding: snapshot.outstanding,
				balances: balancesNoop
			}
		}
	}

	const receiptRes = await receipts
		.where({
			customer_id: customerId,
			status: 'posted',
			unallocated_amount: dbCmd.gt(0)
		})
		.orderBy('biz_date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(2000)
		.get()
	const receiptRows = Array.isArray(receiptRes.data) ? receiptRes.data : []
	if (!receiptRows.length) {
		const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive, snapshot.amount_received, 3)
		if (normalizeString(flowDoc.payment_status) !== nextStatus) {
			await flowSettlements.doc(flowSettlementId).update({
				payment_status: nextStatus,
				updated_at: Date.now()
			})
		}
		const balancesNoop = await rebuildCustomerBalances(customerId)
		return {
			code: 0,
			msg: '无可用预付款',
			data: {
				flow_settlement_id: flowSettlementId,
				applied_amount: 0,
				amount_received: snapshot.amount_received,
				payment_status: nextStatus,
				outstanding: snapshot.outstanding,
				balances: balancesNoop
			}
		}
	}

	let remaining = snapshot.outstanding
	let appliedTotal = 0
	let seq = 1
	const targetTitle = `流量结算 ${normalizeString(flowDoc.biz_date)} / ${flowSettlementId.slice(-6)}`
	for (const receiptRow of receiptRows) {
		if (remaining <= 0) break
		const receiptId = normalizeId(receiptRow && receiptRow._id)
		if (!receiptId) continue
		const available = fix3(toNumber(receiptRow && receiptRow.unallocated_amount, 0))
		if (!(available > 0)) continue
		const amountUse = fix3(Math.min(available, remaining))
		if (!(amountUse > 0)) continue

		await receipts.doc(receiptId).update({
			allocated_amount: fix3(toNumber(receiptRow && receiptRow.allocated_amount, 0) + amountUse),
			unallocated_amount: fix3(available - amountUse),
			updated_at: Date.now()
		})
		const receiptSourceType = normalizeString(receiptRow && receiptRow.source_type)
		const receiptEntryKind = normalizeEntryKind(
			receiptRow && receiptRow.entry_kind,
			receiptSourceType.includes('offset') ? 'offset_credit' : 'prepay'
		)
		const allocNote =
			receiptEntryKind === 'offset_credit' || receiptSourceType.startsWith('sale_offset_credit')
				? `自动冲抵来源 ${normalizeString(receiptRow && receiptRow.biz_date) || '-'}`
				: '自动预付款抵扣'

		await allocations.add({
			receipt_id: receiptId,
			customer_id: customerId,
			customer_name: normalizeString(customer && customer.name),
			sale_id: flowSettlementId,
			sale_date: normalizeString(flowDoc && flowDoc.biz_date),
			flow_settlement_id: flowSettlementId,
			target_type: 'flow_settlement',
			target_id: flowSettlementId,
			target_title: targetTitle,
			biz_date: normalizeBizDate(flowDoc && flowDoc.biz_date, Date.now()),
			allocate_amount: amountUse,
			seq,
			note: allocNote,
			receipt_source_type: receiptSourceType,
			receipt_entry_kind: receiptEntryKind,
			receipt_biz_date: normalizeString(receiptRow && receiptRow.biz_date),
			source_type: 'flow_auto_prepay',
			source_id: flowSettlementId,
			request_id: requestId,
			created_at: Date.now(),
			created_by: normalizeId(user && user._id) || null,
			created_by_name: normalizeString(user && user.username)
		})
		seq += 1
		appliedTotal = fix3(appliedTotal + amountUse)
		remaining = fix3(remaining - amountUse)
	}

	const nextAmountReceived = fix3(snapshot.amount_received + appliedTotal)
	const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive, nextAmountReceived, 3)
	await flowSettlements.doc(flowSettlementId).update({
		amount_received: nextAmountReceived,
		payment_status: nextStatus,
		updated_at: Date.now()
	})

	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_auto_apply_prepay_flow_v1',
		{
			flow_settlement_id: flowSettlementId,
			customer_id: customerId,
			applied_amount: appliedTotal
		},
		requestId
	)

	return {
		code: 0,
		msg: appliedTotal > 0 ? '已自动抵扣预付款' : '无需抵扣',
		data: {
			flow_settlement_id: flowSettlementId,
			applied_amount: appliedTotal,
			amount_received: nextAmountReceived,
			payment_status: nextStatus,
			outstanding: fix3(snapshot.should_receive - nextAmountReceived),
			balances
		}
	}
}

async function autoApplyPrepayToSaleV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'autoApplyPrepayToSaleV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const saleId = normalizeId(data.sale_id || data.saleId || data._id || data.id)
	if (!saleId) return { code: 400, msg: 'sale_id 必填' }

	const saleRes = await sales.doc(saleId).get()
	const saleDoc = (saleRes.data && saleRes.data[0]) || null
	if (!saleDoc) return { code: 404, msg: '销售单不存在' }
	if (normalizeSettlementMode(saleDoc && saleDoc.settlement_mode) === 'customer_flow') {
		const balancesNoop = await rebuildCustomerBalances(normalizeId(saleDoc.customer_id))
		return {
			code: 0,
			msg: '该销售单按客户流量结算，不参与销售预付款抵扣',
			data: {
				sale_id: saleId,
				applied_amount: 0,
				balances: balancesNoop
			}
		}
	}
	const customerId = normalizeId(saleDoc.customer_id)
	if (!customerId) return { code: 400, msg: '销售单缺少客户' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }
	const excludeOffsetCredit = Boolean(data && (data.exclude_offset_credit ?? data.excludeOffsetCredit))

	const snapshot = computeSaleSnapshot(saleDoc)
	if (snapshot.outstanding <= 0) {
		const offsetSummaryMap = await getSaleOffsetSummaryMap(customerId, [saleId])
		const offsetSummary = offsetSummaryMap.get(saleId) || { offset_applied_amount: 0, offset_sources: [] }
		const mergedPaymentNote = mergePaymentNoteWithAutoOffset(
			saleDoc && saleDoc.payment_note,
			buildAutoOffsetPaymentNote(offsetSummary)
		)
		if (normalizeString(mergedPaymentNote) !== normalizeString(saleDoc && saleDoc.payment_note)) {
			await sales.doc(saleId).update({
				payment_note: mergedPaymentNote,
				updated_at: Date.now()
			})
		}
		const balancesNoop = await rebuildCustomerBalances(customerId)
		return {
			code: 0,
			msg: '无需抵扣',
			data: {
				sale_id: saleId,
				applied_amount: 0,
				balances: balancesNoop
			}
		}
	}

	const receiptRes = await receipts
		.where({
			customer_id: customerId,
			status: 'posted',
			unallocated_amount: dbCmd.gt(0)
		})
		.orderBy('biz_date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(2000)
		.get()
	const receiptRowsAll = Array.isArray(receiptRes.data) ? receiptRes.data : []
	const receiptRows = excludeOffsetCredit
		? receiptRowsAll.filter((row) => !isOffsetCreditReceiptRow(row))
		: receiptRowsAll
	if (!receiptRows.length) {
		const shouldStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, snapshot.amount_received)
		const offsetSummaryMap = await getSaleOffsetSummaryMap(customerId, [saleId])
		const offsetSummary = offsetSummaryMap.get(saleId) || { offset_applied_amount: 0, offset_sources: [] }
		const mergedPaymentNote = mergePaymentNoteWithAutoOffset(
			saleDoc && saleDoc.payment_note,
			buildAutoOffsetPaymentNote(offsetSummary)
		)
		const updateDoc = { updated_at: Date.now() }
		let changed = false
		if (normalizeString(saleDoc.payment_status) !== shouldStatus) {
			updateDoc.payment_status = shouldStatus
			changed = true
		}
		if (normalizeString(mergedPaymentNote) !== normalizeString(saleDoc && saleDoc.payment_note)) {
			updateDoc.payment_note = mergedPaymentNote
			changed = true
		}
		if (changed) {
			await sales.doc(saleId).update(updateDoc)
		}
		const balancesNoop = await rebuildCustomerBalances(customerId)
		return {
			code: 0,
			msg: '无可用预付款',
			data: {
				sale_id: saleId,
				applied_amount: 0,
				balances: balancesNoop
			}
		}
	}

	let remaining = snapshot.outstanding
	let appliedTotal = 0
	let seq = 1
	for (const receiptRow of receiptRows) {
		if (remaining <= 0) break
		const receiptId = normalizeId(receiptRow._id)
		if (!receiptId) continue
		const available = fix2(toNumber(receiptRow.unallocated_amount, 0))
		if (available <= 0) continue
		const amountUse = fix2(Math.min(available, remaining))
		if (amountUse <= 0) continue

		await receipts.doc(receiptId).update({
			allocated_amount: fix2(toNumber(receiptRow.allocated_amount, 0) + amountUse),
			unallocated_amount: fix2(available - amountUse),
			updated_at: Date.now()
		})
		const receiptSourceType = normalizeString(receiptRow.source_type)
		const receiptEntryKind = normalizeEntryKind(
			receiptRow.entry_kind,
			receiptSourceType.includes('offset') ? 'offset_credit' : 'prepay'
		)
		const allocNote =
			receiptEntryKind === 'offset_credit' || receiptSourceType.startsWith('sale_offset_credit')
				? `自动冲抵来源 ${normalizeString(receiptRow.biz_date) || '-'}`
				: '自动预付款抵扣'

		await allocations.add({
			receipt_id: receiptId,
			customer_id: customerId,
			customer_name: normalizeString(customer.name),
			sale_id: saleId,
			sale_date: normalizeString(saleDoc.date),
			biz_date: normalizeBizDate(saleDoc.date, Date.now()),
			allocate_amount: amountUse,
			seq,
			note: allocNote,
			receipt_source_type: receiptSourceType,
			receipt_entry_kind: receiptEntryKind,
			receipt_biz_date: normalizeString(receiptRow.biz_date),
			source_type: 'sale_auto_prepay',
			source_id: saleId,
			request_id: requestId,
			created_at: Date.now(),
			created_by: normalizeId(user?._id) || null,
			created_by_name: normalizeString(user?.username)
		})

		seq += 1
		appliedTotal = fix2(appliedTotal + amountUse)
		remaining = fix2(remaining - amountUse)
	}

	const nextAmountReceived = fix2(snapshot.amount_received + appliedTotal)
	const nextStatus = resolvePaymentStatusByAmount(snapshot.should_receive_effective, nextAmountReceived)
	const offsetSummaryMap = await getSaleOffsetSummaryMap(customerId, [saleId])
	const offsetSummary = offsetSummaryMap.get(saleId) || { offset_applied_amount: 0, offset_sources: [] }
	const mergedPaymentNote = mergePaymentNoteWithAutoOffset(
		saleDoc && saleDoc.payment_note,
		buildAutoOffsetPaymentNote(offsetSummary)
	)
	const updateDoc = { updated_at: Date.now() }
	let changed = false
	if (appliedTotal > 0 || normalizeString(saleDoc.payment_status) !== nextStatus) {
		updateDoc.amount_received = nextAmountReceived
		updateDoc.payment_status = nextStatus
		changed = true
	}
	if (normalizeString(mergedPaymentNote) !== normalizeString(saleDoc && saleDoc.payment_note)) {
		updateDoc.payment_note = mergedPaymentNote
		changed = true
	}
	if (changed) {
		await sales.doc(saleId).update(updateDoc)
	}

	const balances = await rebuildCustomerBalances(customerId)
	await recordLog(
		user,
		'customer_auto_apply_prepay_v1',
		{
			sale_id: saleId,
			customer_id: customerId,
			applied_amount: appliedTotal
		},
		requestId
	)

	return {
		code: 0,
		msg: appliedTotal > 0 ? '已自动抵扣预付款' : '无需抵扣',
		data: {
			sale_id: saleId,
			applied_amount: appliedTotal,
			balances
		}
	}
}

async function refreshCustomerBalancesV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'refreshCustomerBalancesV1', requestId)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const balances = await rebuildCustomerBalances(customerId)
	if (!balances) return { code: 404, msg: '客户不存在' }

	await recordLog(user, 'customer_refresh_balances_v1', { customer_id: customerId }, requestId)
	return { code: 0, msg: 'ok', data: balances }
}

async function getCustomerStatementV1(user, data) {
	void user
	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const summaryDateFrom = normalizeDate(
		data.summary_date_from
		|| data.summaryDateFrom
		|| data.date_from
		|| data.dateFrom
	)
	const summaryDateTo = normalizeDate(
		data.summary_date_to
		|| data.summaryDateTo
		|| data.date_to
		|| data.dateTo
	)
	if ((summaryDateFrom && !summaryDateTo) || (!summaryDateFrom && summaryDateTo)) {
		return { code: 400, msg: 'summary_date_from/summary_date_to 必须同时传入' }
	}
	if (summaryDateFrom && summaryDateTo && summaryDateFrom > summaryDateTo) {
		return { code: 400, msg: 'summary_date_from 不能晚于 summary_date_to' }
	}
	const summaryOnly = Boolean(data.summary_only || data.summaryOnly)
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)
	const customerPayload = {
		_id: customer._id,
		name: customer.name,
		short_name: customer.short_name,
		phone: customer.phone,
		contact: customer.contact,
		default_price_unit: normalizeString(customer.default_price_unit) || 'kg',
		default_unit_price: toNumber(customer.default_unit_price, null)
	}

	const balances = await rebuildCustomerBalances(customerId)
	let scopedSummary = null
	if (summaryDateFrom && summaryDateTo) {
		const scopedSalesDocs = await listCustomerSales(customerId, { dateFrom: summaryDateFrom, dateTo: summaryDateTo })
		const scopedFlowDocs = await listCustomerFlowSettlements(customerId, { dateFrom: summaryDateFrom, dateTo: summaryDateTo })
		const scopedOpeningDebtDocs = await listCustomerOpeningDebts(customerId, { dateFrom: summaryDateFrom, dateTo: summaryDateTo })
		const scopedReceipts = await listCustomerReceipts(customerId, { dateFrom: summaryDateFrom, dateTo: summaryDateTo })
		const scoped = await buildBusinessSummaryFromTargets(customer, {
			salesDocs: scopedSalesDocs,
			flowDocs: scopedFlowDocs,
			openingDebtDocs: scopedOpeningDebtDocs
		})
		const scopedReceivable = fixMoney(scoped.receivable_balance)
		const scopedPrepaySplit = scopedReceipts.reduce(
			(acc, row) => {
				const amount = Math.max(0, toNumber(row && row.unallocated_amount, 0))
				if (!(amount > 0)) return acc
				if (isOffsetCreditReceiptRow(row)) acc.offset += amount
				else acc.prepay += amount
				return acc
			},
			{ prepay: 0, offset: 0 }
		)
		const scopedPrepayOnly = fixMoney(scopedPrepaySplit.prepay)
		const scopedOffsetCredit = fixMoney(scopedPrepaySplit.offset)
		const scopedPrepay = fixMoney(scopedPrepayOnly + scopedOffsetCredit)
		const scopedLastReceiptBizDate = scopedReceipts.reduce((maxDate, row) => {
			const bizDate = normalizeDate(row && row.biz_date)
			if (!bizDate) return maxDate
			if (!maxDate || bizDate > maxDate) return bizDate
			return maxDate
		}, '')
		let scopedLastReceiptAt = parseBizDateToTimestamp(scopedLastReceiptBizDate)
		if (!(Number.isFinite(scopedLastReceiptAt) && scopedLastReceiptAt > 0)) {
			scopedLastReceiptAt = scopedReceipts.reduce(
				(maxValue, row) => Math.max(maxValue, toNumber(row && row.created_at, 0)),
				0
			) || null
		}
		scopedSummary = {
			date_from: summaryDateFrom,
			date_to: summaryDateTo,
			receivable_balance: scopedReceivable,
			prepay_balance: scopedPrepay,
			prepay_manual_balance: scopedPrepayOnly,
			offset_credit_balance: scopedOffsetCredit,
			net_balance: fixMoney(scopedReceivable - scopedPrepay),
			should_receive_total: fixMoney(scoped.should_receive_total),
			amount_received_total: fixMoney(scoped.amount_received_total),
			last_receipt_at: scopedLastReceiptAt
		}
	}
	if (summaryOnly) {
		return {
			code: 0,
			data: {
				customer: customerPayload,
				summary: balances || {
					receivable_balance: 0,
					prepay_balance: 0,
					prepay_manual_balance: 0,
					offset_credit_balance: 0,
					net_balance: 0,
					should_receive_total: 0,
					amount_received_total: 0,
					last_receipt_at: null
				},
				summary_scope: scopedSummary,
				recent_sales: [],
				recent_receipts: [],
				recent_flow_settlements: [],
				recent_opening_debts: [],
				recent_other_fees: []
			}
		}
	}
	const salesDocs = await listCustomerSales(customerId)
	const flowDocs = await listCustomerFlowSettlements(customerId)
	const openingDebtDocs = await listCustomerOpeningDebts(customerId)
	const saleDepositBalanceSnapshotMap = buildSaleDepositBalanceSnapshotMap(salesDocs, 20)
	let saleRows = salesDocs
		.map((doc) => {
			const snapshot = computeSaleSnapshot(doc)
			const saleId = normalizeId(doc && doc._id)
			const outBottleNos = collectBottleNosFromRows(doc && doc.out_items)
			const backBottleNos = collectBottleNosFromRows(doc && doc.back_items)
			const depositSnapshot = saleDepositBalanceSnapshotMap.get(saleId) || {
				count: 0,
				bottles_preview: [],
				bottles_truncated: false
			}
			return {
				_id: saleId,
				date: normalizeString(doc.date),
				biz_mode: normalizeString(doc.biz_mode) || 'bottle',
				should_receive: snapshot.should_receive,
				should_receive_effective: snapshot.should_receive_effective,
				amount_received: snapshot.amount_received,
				outstanding: snapshot.outstanding,
				payment_status: normalizeString(doc.payment_status) || snapshot.payment_status,
				remark: normalizeString(doc.remark),
				out_bottle_count: outBottleNos.length,
				back_bottle_count: backBottleNos.length,
				out_bottles_preview: outBottleNos.slice(0, 20),
				out_bottles_truncated: outBottleNos.length > 20,
				back_bottles_preview: backBottleNos.slice(0, 20),
				back_bottles_truncated: backBottleNos.length > 20,
				deposit_bottle_count: countBottleNosFromRows(doc && doc.deposit_rows),
				deposit_balance_count: toNumber(depositSnapshot.count, 0),
				deposit_balance_bottles_preview: Array.isArray(depositSnapshot.bottles_preview)
					? depositSnapshot.bottles_preview
					: [],
				deposit_balance_bottles_truncated: Boolean(depositSnapshot.bottles_truncated)
			}
		})
		.sort((a, b) => {
			if (a.date !== b.date) return a.date < b.date ? 1 : -1
			return a._id < b._id ? 1 : -1
		})
	const saleOffsetSummaryMap = await getSaleOffsetSummaryMap(
		customerId,
		saleRows
			.slice(0, 100)
			.map((row) => normalizeId(row && row._id))
			.filter(Boolean)
	)
	saleRows = saleRows.map((row) => {
		const saleId = normalizeId(row && row._id)
		const summary = saleOffsetSummaryMap.get(saleId) || { offset_applied_amount: 0, offset_sources: [] }
		const postedAmount = fix2(toNumber(row && row.amount_received, 0))
		const offsetAmount = fix2(toNumber(summary && summary.offset_applied_amount, 0))
		const manualAmount = fix2(postedAmount - offsetAmount)
		return {
			...row,
			posted_amount_received: postedAmount,
			offset_applied_amount: offsetAmount,
			manual_amount_received: manualAmount,
			offset_sources: Array.isArray(summary && summary.offset_sources)
				? summary.offset_sources.map((item) => ({
					date: normalizeDate(item && item.date),
					amount: fix2(toNumber(item && item.amount, 0))
				}))
				: []
		}
	})

	const receiptRes = await receipts
		.where({ customer_id: customerId, status: 'posted' })
		.orderBy('biz_date', 'desc')
		.orderBy('created_at', 'desc')
		.limit(20)
		.get()
	const recentReceipts = (Array.isArray(receiptRes.data) ? receiptRes.data : []).map((row) => ({
		_id: normalizeId(row._id),
		biz_date: normalizeString(row.biz_date),
		amount: fixMoney(toNumber(row.amount, 0)),
		allocated_amount: fixMoney(toNumber(row.allocated_amount, 0)),
		unallocated_amount: fixMoney(toNumber(row.unallocated_amount, 0)),
		payment_method: normalizePaymentMethod(row.payment_method, 'paid'),
		entry_kind: normalizeEntryKind(row.entry_kind, normalizeString(row.source_type).includes('offset') ? 'offset_credit' : 'prepay'),
		allocation_mode: normalizeAllocationMode(row.allocation_mode, 'period'),
		allocation_start_date: normalizeDate(row.allocation_start_date),
		allocation_end_date: normalizeDate(row.allocation_end_date),
		allocation_targets: normalizeAllocationTargets(row.allocation_targets),
		note: normalizeString(row.note),
		created_at: toNumber(row.created_at, 0)
	}))
	const recentFlowSettlements = flowDocs
		.map((doc) => {
			const snapshot = computeFlowSettlementSnapshot(doc)
			return {
				_id: normalizeId(doc._id),
				biz_date: normalizeString(doc.biz_date),
				flow_index_prev: toNumber(doc.flow_index_prev, null),
				flow_index_curr: toNumber(doc.flow_index_curr, null),
				flow_volume_m3: toNumber(doc.flow_volume_m3, null),
				flow_theory_ratio: toNumber(doc.flow_theory_ratio, null),
				theory_weight_kg: toNumber(doc.theory_weight_kg, null),
				actual_weight_kg: toNumber(doc.actual_weight_kg, null),
				loss_weight_kg: toNumber(doc.loss_weight_kg, null),
				should_receive: snapshot.should_receive,
				amount_received: snapshot.amount_received,
				outstanding: snapshot.outstanding,
				payment_status: snapshot.payment_status,
				note: normalizeString(doc.note),
				created_at: toNumber(doc.created_at, 0)
			}
		})
		.sort((a, b) => {
			if (a.biz_date !== b.biz_date) return a.biz_date < b.biz_date ? 1 : -1
			return a.created_at < b.created_at ? 1 : -1
		})
	const recentOpeningDebts = openingDebtDocs
		.filter((doc) => resolveOpeningDebtEntryType(doc) === 'opening_debt')
		.map((doc) => {
			const snapshot = computeOpeningDebtSnapshot(doc, moneyScale)
			return {
				_id: normalizeId(doc._id),
				biz_date: normalizeString(doc.biz_date),
				amount: snapshot.amount,
				rounding_amount: snapshot.rounding_amount,
				should_receive_effective: snapshot.should_receive_effective,
				amount_received: snapshot.amount_received,
				outstanding: snapshot.outstanding,
				payment_status: snapshot.payment_status,
				note: normalizeString(doc.note),
				created_at: toNumber(doc.created_at, 0)
			}
		})
		.sort((a, b) => {
			if (a.biz_date !== b.biz_date) return a.biz_date < b.biz_date ? 1 : -1
			return a.created_at < b.created_at ? 1 : -1
		})
	const recentOtherFees = openingDebtDocs
		.filter((doc) => resolveOpeningDebtEntryType(doc) === 'other_fee')
		.map((doc) => {
			const snapshot = computeOpeningDebtSnapshot(doc, moneyScale)
			return {
				_id: normalizeId(doc._id),
				biz_date: normalizeString(doc.biz_date),
				amount: snapshot.amount,
				rounding_amount: snapshot.rounding_amount,
				should_receive_effective: snapshot.should_receive_effective,
				amount_received: snapshot.amount_received,
				outstanding: snapshot.outstanding,
				payment_status: snapshot.payment_status,
				note: normalizeString(doc.note),
				created_at: toNumber(doc.created_at, 0)
			}
		})
		.sort((a, b) => {
			if (a.biz_date !== b.biz_date) return a.biz_date < b.biz_date ? 1 : -1
			return a.created_at < b.created_at ? 1 : -1
		})

	return {
		code: 0,
		data: {
			customer: customerPayload,
			summary: balances || {
				receivable_balance: 0,
				prepay_balance: 0,
				prepay_manual_balance: 0,
				offset_credit_balance: 0,
				net_balance: 0,
				should_receive_total: 0,
				amount_received_total: 0,
				last_receipt_at: null
			},
			summary_scope: scopedSummary,
			recent_sales: saleRows.slice(0, 100),
			recent_receipts: recentReceipts,
			recent_flow_settlements: recentFlowSettlements.slice(0, 20),
			recent_opening_debts: recentOpeningDebts.slice(0, 20),
			recent_other_fees: recentOtherFees.slice(0, 20)
		}
	}
}

async function listCustomerStatementRowsV1(user, data) {
	void user
	const customerId = normalizeId(data.customer_id || data.customerId)
	if (!customerId) return { code: 400, msg: 'customer_id 必填' }
	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 404, msg: '客户不存在' }
	const moneyScale = resolveCustomerMoneyScale(customer)
	const fixMoney = (value) => fixByScale(value, moneyScale)

	const dateFrom = normalizeDate(data.date_from || data.dateFrom)
	const dateTo = normalizeDate(data.date_to || data.dateTo)
	const page = Math.max(toNumber(data.page, 1), 1)
	const pageSize = Math.min(Math.max(toNumber(data.pageSize, 50), 1), 200)

	const salesDocs = await listCustomerSales(customerId, { dateFrom, dateTo })
	const flowDocs = await listCustomerFlowSettlements(customerId, { dateFrom, dateTo })
	const openingDebtDocs = await listCustomerOpeningDebts(customerId, { dateFrom, dateTo })
	const saleRows = salesDocs.map((doc) => {
		const snapshot = computeSaleSnapshot(doc)
		return {
			row_type: 'sale',
			row_id: normalizeId(doc._id),
			biz_date: normalizeString(doc.date),
			created_at: toNumber(doc.created_at, 0),
			sale_id: normalizeId(doc._id),
			receipt_id: '',
			amount: snapshot.should_receive,
			amount_received: snapshot.amount_received,
			outstanding: snapshot.outstanding,
			note: normalizeString(doc.remark),
			meta: {
				biz_mode: normalizeString(doc.biz_mode) || 'bottle',
				payment_status: normalizeString(doc.payment_status) || snapshot.payment_status
			}
		}
	})

	const receiptWhereParts = [{ customer_id: customerId, status: 'posted' }]
	if (dateFrom) receiptWhereParts.push({ biz_date: dbCmd.gte(dateFrom) })
	if (dateTo) receiptWhereParts.push({ biz_date: dbCmd.lte(dateTo) })
	const receiptWhere = receiptWhereParts.length === 1 ? receiptWhereParts[0] : dbCmd.and(receiptWhereParts)

	const receiptRes = await receipts
		.where(receiptWhere)
		.orderBy('biz_date', 'desc')
		.orderBy('created_at', 'desc')
		.limit(5000)
		.get()
	const receiptRows = (Array.isArray(receiptRes.data) ? receiptRes.data : []).map((row) => ({
		row_type: 'receipt',
		row_id: normalizeId(row._id),
		biz_date: normalizeString(row.biz_date),
		created_at: toNumber(row.created_at, 0),
		sale_id: '',
		receipt_id: normalizeId(row._id),
		amount: fixMoney(toNumber(row.amount, 0)),
		allocated_amount: fixMoney(toNumber(row.allocated_amount, 0)),
		prepay_delta: fixMoney(toNumber(row.unallocated_amount, 0)),
		note: normalizeString(row.note),
		meta: {
			source_type: normalizeString(row.source_type),
			entry_kind: normalizeEntryKind(row.entry_kind, normalizeString(row.source_type).includes('offset') ? 'offset_credit' : 'prepay'),
			payment_method: normalizePaymentMethod(row.payment_method, 'paid'),
			allocation_mode: normalizeAllocationMode(row.allocation_mode, 'period'),
			allocation_start_date: normalizeDate(row.allocation_start_date),
			allocation_end_date: normalizeDate(row.allocation_end_date),
			allocation_targets: normalizeAllocationTargets(row.allocation_targets)
		}
	}))

	const allocWhereParts = [{ customer_id: customerId }]
	if (dateFrom) allocWhereParts.push({ biz_date: dbCmd.gte(dateFrom) })
	if (dateTo) allocWhereParts.push({ biz_date: dbCmd.lte(dateTo) })
	const allocWhere = allocWhereParts.length === 1 ? allocWhereParts[0] : dbCmd.and(allocWhereParts)

	const allocRes = await allocations
		.where(allocWhere)
		.orderBy('biz_date', 'desc')
		.orderBy('created_at', 'desc')
		.limit(5000)
		.get()
	const allocRows = (Array.isArray(allocRes.data) ? allocRes.data : []).map((row) => ({
		row_type: 'allocation',
		row_id: normalizeId(row._id),
		biz_date: normalizeString(row.biz_date),
		created_at: toNumber(row.created_at, 0),
		sale_id: normalizeId(row.sale_id),
		receipt_id: normalizeId(row.receipt_id),
		amount: fixMoney(toNumber(row.allocate_amount, 0)),
		note: normalizeString(row.note),
		meta: {
			sale_date: normalizeString(row.sale_date),
			source_type: normalizeString(row.source_type),
			target_type: normalizeReceivableTargetType(row.target_type),
			target_id: normalizeId(row.target_id || row.sale_id),
			target_title: normalizeString(row.target_title),
			allocation_mode: normalizeAllocationMode(row.allocation_mode, 'period'),
			allocation_start_date: normalizeDate(row.allocation_start_date),
			allocation_end_date: normalizeDate(row.allocation_end_date),
			allocation_targets: normalizeAllocationTargets(row.allocation_targets)
		}
	}))
	const flowRows = flowDocs.map((doc) => {
		const snapshot = computeFlowSettlementSnapshot(doc)
		return {
			row_type: 'flow_settlement',
			row_id: normalizeId(doc._id),
			biz_date: normalizeString(doc.biz_date),
			created_at: toNumber(doc.created_at, 0),
			sale_id: '',
			receipt_id: '',
			amount: snapshot.should_receive,
			amount_received: snapshot.amount_received,
			outstanding: snapshot.outstanding,
			note: normalizeString(doc.note),
			meta: {
				payment_status: snapshot.payment_status,
				flow_volume_m3: toNumber(doc.flow_volume_m3, null),
				loss_weight_kg: toNumber(doc.loss_weight_kg, null)
			}
		}
	})
	const openingDebtRows = openingDebtDocs.map((doc) => {
		const snapshot = computeOpeningDebtSnapshot(doc, moneyScale)
		const entryType = resolveOpeningDebtEntryType(doc)
		return {
			row_type: entryType,
			row_id: normalizeId(doc._id),
			biz_date: normalizeString(doc.biz_date),
			created_at: toNumber(doc.created_at, 0),
			sale_id: normalizeId(doc._id),
			receipt_id: '',
			amount: snapshot.amount,
			rounding_amount: snapshot.rounding_amount,
			should_receive_effective: snapshot.should_receive_effective,
			amount_received: snapshot.amount_received,
			outstanding: snapshot.outstanding,
			note: normalizeString(doc.note),
			meta: {
				payment_status: snapshot.payment_status,
				entry_type: entryType,
				rounding_amount: snapshot.rounding_amount,
				should_receive_effective: snapshot.should_receive_effective
			}
		}
	})

	const rows = [...saleRows, ...flowRows, ...openingDebtRows, ...receiptRows, ...allocRows].sort((a, b) => {
		if (a.biz_date !== b.biz_date) return a.biz_date < b.biz_date ? 1 : -1
		if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
		return a.row_id < b.row_id ? 1 : -1
	})

	const total = rows.length
	const start = (page - 1) * pageSize
	const end = start + pageSize
	const dataRows = rows.slice(start, end)
	const hasMore = end < total

	return {
		code: 0,
		data: dataRows,
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		}
	}
}

async function rebuildOpeningBalancesV1(user, data, requestId) {
	const auth = await ensureWritePermission(user, 'rebuildOpeningBalancesV1', requestId, REBUILD_ROLES)
	if (!auth.ok) return { code: auth.code, msg: auth.msg }

	const execute = Boolean(data.execute)
	const batchSize = 200
	let page = 1
	let guard = 0
	let total = 0
	let updated = 0
	const samples = []

	while (guard < 500) {
		const res = await customers
			.field({ _id: true, name: true })
			.skip((page - 1) * batchSize)
			.limit(batchSize)
			.get()
		const list = Array.isArray(res.data) ? res.data : []
		if (!list.length) break

		for (const row of list) {
			total += 1
			const balances = await rebuildCustomerBalances(row._id)
			if (!balances) continue
			if (!execute) {
				if (samples.length < 20) samples.push(balances)
				continue
			}
			updated += 1
		}
		if (list.length < batchSize) break
		page += 1
		guard += 1
	}

	await recordLog(
		user,
		'customer_opening_rebuild_v1',
		{ execute, total, updated },
		requestId
	)

	return {
		code: 0,
		msg: execute ? '期初余额迁移已执行' : '期初余额迁移预览完成',
		data: {
			execute,
			total,
			updated,
			samples
		}
	}
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event || {}
	const requestId =
		normalizeString(event?.request_id || event?.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, SUPERADMIN_ONLY_ACTIONS, {
		recordLog,
		requestId,
		cloudFunction: 'crm-customer-settlement'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	if (action === 'previewAllocationV1') return previewAllocationV1(user, data)
	if (action === 'createReceiptV1') return createReceiptV1(user, data, requestId)
	if (action === 'updateReceiptV1') return updateReceiptV1(user, data, requestId)
	if (action === 'removeReceiptV1') return removeReceiptV1(user, data, requestId)
	if (action === 'createPrepayEntryV1') return createPrepayEntryV1(user, data, requestId)
	if (action === 'createOpeningDebtEntryV1') return createOpeningDebtEntryV1(user, data, requestId)
	if (action === 'updateOpeningDebtEntryV1') return updateOpeningDebtEntryV1(user, data, requestId)
	if (action === 'removeOpeningDebtEntryV1') return removeOpeningDebtEntryV1(user, data, requestId)
	if (action === 'createOtherFeeEntryV1') return createOtherFeeEntryV1(user, data, requestId)
	if (action === 'updateOtherFeeEntryV1') return updateOtherFeeEntryV1(user, data, requestId)
	if (action === 'removeOtherFeeEntryV1') return removeOtherFeeEntryV1(user, data, requestId)
	if (action === 'releaseSaleSettlementOnRemoveV1') return releaseSaleSettlementOnRemoveV1(user, data, requestId)
	if (action === 'listOffsetCreditPoolV1') return listOffsetCreditPoolV1(user, data)
	if (action === 'allocateOffsetCreditV1') return allocateOffsetCreditV1(user, data, requestId)
	if (action === 'confirmAllocationV1') return confirmAllocationV1(user, data, requestId)
	if (action === 'repairReceiptAllocationV1') return repairReceiptAllocationV1(user, data, requestId)
	if (action === 'repairOffsetCreditsV1') return repairOffsetCreditsV1(user, data, requestId)
	if (action === 'autoApplyPrepayToSaleV1') return autoApplyPrepayToSaleV1(user, data, requestId)
	if (action === 'autoApplyPrepayToFlowSettlementV1') return autoApplyPrepayToFlowSettlementV1(user, data, requestId)
	if (action === 'previewFlowSettlementV1') return previewFlowSettlementV1(user, data)
	if (action === 'createFlowSettlementV1') return createFlowSettlementV1(user, data, requestId)
	if (action === 'updateFlowSettlementV1') return updateFlowSettlementV1(user, data, requestId)
	if (action === 'removeFlowSettlementV1') return removeFlowSettlementV1(user, data, requestId)
	if (action === 'exportCustomerStatementV1') return exportCustomerStatementV1(user, data)
	if (action === 'getCustomerStatementAnalysisV1') return getCustomerStatementAnalysisV1(user, data, token, requestId)
	if (action === 'refreshCustomerBalancesV1') return refreshCustomerBalancesV1(user, data, requestId)
	if (action === 'getCustomerStatementV1') return getCustomerStatementV1(user, data)
	if (action === 'listCustomerStatementRowsV1') return listCustomerStatementRowsV1(user, data)
	if (action === 'rebuildOpeningBalancesV1') return rebuildOpeningBalancesV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
