import { normalizePaymentMethod, normalizePaymentStatus, normalizeSettlementMode } from './settlement'

const BIZ_MODES = ['bottle', 'truck', 'agent_sale']
const PRICE_UNITS = ['kg', 'bottle', 'm3']

function isPositiveNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function hasAnyBottleRows(outRows, backRows, depositRows) {
	return (Array.isArray(outRows) && outRows.length > 0)
		|| (Array.isArray(backRows) && backRows.length > 0)
			|| (Array.isArray(depositRows) && depositRows.length > 0)
}

function resolveTruckReferenceNet(base) {
	const outGross = typeof base.truckOutGross === 'number' ? base.truckOutGross : Number(base.truckOutGross)
	const backGross = typeof base.truckBackGross === 'number' ? base.truckBackGross : Number(base.truckBackGross)
	if (!Number.isFinite(outGross) || !Number.isFinite(backGross)) return 0
	return Math.max(outGross - backGross, 0)
}

function resolveTruckSettlementNet(base) {
	const settleTare = typeof base.truckSettleTare === 'number' ? base.truckSettleTare : Number(base.truckSettleTare)
	const settleGross = typeof base.truckSettleGross === 'number' ? base.truckSettleGross : Number(base.truckSettleGross)
	if (!Number.isFinite(settleTare) || !Number.isFinite(settleGross)) return 0
	return Math.max(settleGross - settleTare, 0)
}

function resolveTruckBillableNet(base, priceUnit = 'kg') {
	if (normalizeString(priceUnit) === 'kg') {
		const settlementNet = resolveTruckSettlementNet(base)
		if (isPositiveNumber(settlementNet)) return settlementNet
	}
	return resolveTruckReferenceNet(base)
}

function validateSaleDraftForCreate(normalized) {
	const base = normalized?.base || {}
	const outRows = normalized?.outRows || []
	const backRows = normalized?.backRows || []
	const depositRows = normalized?.depositRows || []
	const agentRows = normalized?.agentSaleRows || []

	const date = normalizeString(base.date)
	if (!date) return { ok: false, msg: '日期必填' }

	const customerId = normalizeString(base.customerId)
	if (!customerId) return { ok: false, msg: '客户必选' }

	const priceUnit = normalizeString(base.priceUnit)
	if (!PRICE_UNITS.includes(priceUnit)) return { ok: false, msg: '计价单位无效' }

	const settlementMode = priceUnit === 'm3' ? 'customer_flow' : normalizeSettlementMode(base.settlementMode)
	const unitPrice = typeof base.unitPrice === 'number' ? base.unitPrice : Number(base.unitPrice)
	if (settlementMode !== 'customer_flow' && !isPositiveNumber(unitPrice)) return { ok: false, msg: '单价必须大于 0' }
	const paymentStatus = settlementMode === 'customer_flow' ? 'paid' : normalizePaymentStatus(base.paymentStatus)
	const paymentMethod = normalizePaymentMethod(base.paymentMethod, {
		paymentStatus,
		settlementMode,
		fallback: paymentStatus === 'unpaid' ? 'on_account' : 'cash'
	})
	if (settlementMode !== 'customer_flow') {
		if (paymentStatus === 'unpaid' && paymentMethod !== 'on_account') {
			return { ok: false, msg: '未付款状态必须选择挂账' }
		}
		if (paymentStatus !== 'unpaid' && paymentMethod === 'on_account') {
			return { ok: false, msg: '已收款场景不能选择挂账' }
		}
	}

	const bizMode = normalizeString(base.bizMode)
	if (!BIZ_MODES.includes(bizMode)) return { ok: false, msg: '业务模式无效' }

	if (bizMode === 'truck') {
		const truckNo = normalizeString(base.truckNo)
		if (!truckNo) return { ok: false, msg: '整车模式车牌必填' }
		const truckReferenceNet = resolveTruckReferenceNet(base)
		if (!isPositiveNumber(truckReferenceNet)) return { ok: false, msg: '出厂毛重与回厂毛重差值必须大于 0' }
		if (priceUnit === 'kg') {
			const truckSettlementNet = resolveTruckSettlementNet(base)
			if (!isPositiveNumber(truckSettlementNet)) {
				return { ok: false, msg: '整车kg结算需填写车皮重与灌装后车毛重，且结算净重必须大于 0' }
			}
		}
	}

	if (bizMode === 'bottle') {
		const hasBottleRows = hasAnyBottleRows(outRows, backRows, depositRows)
		if (!hasBottleRows) return { ok: false, msg: '瓶装模式需填写出瓶/回瓶/存瓶' }
	}

	if (bizMode === 'agent_sale') {
		if (!Array.isArray(agentRows) || agentRows.length === 0) return { ok: false, msg: '代理销售至少填写一行灌装明细' }
	}

	return { ok: true }
}

// 轻量清理：去空白并统一成字符串
function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeTruckNoByRule(value) {
	const raw = normalizeString(value).toUpperCase().replace(/\s+/g, '')
	if (!raw) return ''
	const prefixed = raw.match(/^TRUCK[-_]?([A-Z0-9]+)$/)
	if (prefixed && prefixed[1]) return `TRUCK-${prefixed[1]}`
	const compact = raw.replace(/[^A-Z0-9\u4E00-\u9FA5]/g, '')
	if (!compact) return ''
	const plateMatch = compact.match(/^[\u4E00-\u9FA5][A-Z]([A-Z0-9]+)$/)
	const core = plateMatch && plateMatch[1] ? plateMatch[1] : compact
	return core ? `TRUCK-${core}` : ''
}

// 数值兜底：空值/NaN 统一回退
function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	if (Number.isNaN(num)) return fallback
	return num
}

function normalizeScanLocation(value) {
	if (!value || typeof value !== 'object') return null
	const status = normalizeString(value.status || (value.latitude != null && value.longitude != null ? 'ok' : 'failed')) || 'failed'
	const capturedAt = toNumber(value.capturedAt ?? value.captured_at, null)
	const coordinateType = normalizeString(value.coordinateType || value.coordinate_type) || 'wgs84'
	const source = normalizeString(value.source) || 'pda_bottle_scan'
	const base = {
		status,
		coordinate_type: coordinateType,
		captured_at: capturedAt || Date.now(),
		source
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
		error_code: normalizeString(value.errorCode || value.error_code) || 'get_location_failed',
		error_message: normalizeString(value.errorMessage || value.error_message) || '定位失败'
	}
}

function toBoolean(value, fallback = false) {
	if (typeof value === 'boolean') return value
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true
	if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false
	return fallback
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

// 清理瓶号：去空白、统一大写
function normalizeBottleNo(value) {
	const no = normalizeString(value).toUpperCase()
	return no
}

// 规范出/回瓶明细：补 net、去重
function normalizeBottleRows(rows = []) {
	const seen = new Set()
	return rows
		.map((row) => {
			const bottleNo = normalizeBottleNo(row?.bottleNo ?? row?.bottle_no ?? row?.bottleInput)
			if (!bottleNo) return null
			const gross = toNumber(row?.gross ?? row?.gross_weight)
			const tare = toNumber(row?.tare ?? row?.tare_weight)
			let net = toNumber(row?.net ?? row?.net_weight, null)
			if (net === null) {
				if (gross != null || tare != null) net = toNumber(gross, 0) - toNumber(tare, 0)
				else net = 0
			}
			if (seen.has(bottleNo)) return null
			seen.add(bottleNo)
			const normalized = {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null,
				gross,
				tare,
				net
			}
			const scanLocation = normalizeScanLocation(row?.scanLocation || row?.scan_location)
			if (scanLocation) normalized.scan_location = scanLocation
			return normalized
		})
		.filter(Boolean)
}

// 规范存瓶：去重并生成标准结构
function normalizeDepositRows(rows = []) {
	const seen = new Set()
	return rows
		.map((row) => {
			const bottleNo = normalizeBottleNo(row?.bottleNo ?? row?.bottle_no ?? row?.bottleInput)
			if (!bottleNo) return null
			return {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null
			}
		})
		.filter((row) => {
			const bottleNo = row?.bottle_no
			if (!bottleNo) return false
			if (seen.has(bottleNo)) return false
			seen.add(bottleNo)
			return true
		})
}

// 规范代理出站：保留有效灌装行并去重
function normalizeAgentSaleRows(rows = []) {
	const seen = new Set()
	return rows
		.map((row) => {
			const bottleNo = normalizeBottleNo(row?.bottle_no ?? row?.bottleNo)
			if (!bottleNo) return null
			if (seen.has(bottleNo)) return null
			seen.add(bottleNo)
			const fillWeight = toNumber(row?.fill_weight ?? row?.fillWeight, 0)
			return {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null,
				fill_weight: fillWeight,
				address: normalizeString(row?.address),
				filling_record_id: row?.filling_record_id ?? row?.fillingRecordId ?? null
			}
		})
		.filter(Boolean)
}

// 入口：将表单草稿规范化为后端可用 payload
function normalizeSaleDraft(input = {}) {
	const bizMode = BIZ_MODES.includes(input.bizMode) ? input.bizMode : 'bottle'
	const priceUnit = PRICE_UNITS.includes(input.priceUnit) ? input.priceUnit : 'kg'
	const settlementMode = priceUnit === 'm3' ? 'customer_flow' : normalizeSettlementMode(input.settlementMode)
	const paymentStatus = settlementMode === 'customer_flow' ? 'paid' : normalizePaymentStatus(input.paymentStatus)
	const paymentMethod = normalizePaymentMethod(input.paymentMethod, {
		paymentStatus,
		settlementMode,
		fallback: paymentStatus === 'unpaid' ? 'on_account' : 'cash'
	})
	const normalizedCarNo = normalizeString(input.carNo)
	const normalizedTruckNo = normalizeTruckNoByRule(input.truckNo || normalizedCarNo)

	const base = {
		date: normalizeString(input.date),
		customerId: normalizeString(input.customerId),
		customerName: normalizeString(input.customerName),
		delivery1: normalizeString(input.delivery1),
		delivery2: normalizeString(input.delivery2),
		vehicleId: normalizeString(input.vehicleId),
		carNo: normalizedCarNo,
		remark: normalizeString(input.remark),
		ticketImage: normalizeString(input.ticketImage),
		ticketImages: normalizeTicketImages(input.ticketImages, input.ticketImage),
		amountReceived: toNumber(input.amountReceived, 0),
		roundingAmount: toNumber(input.roundingAmount, 0),
		applyOffsetCredit: toBoolean(input.applyOffsetCredit ?? input.apply_offset_credit, false),
		offsetEnabled: toBoolean(input.offsetEnabled ?? input.offset_enabled, false),
		paymentStatus,
		paymentMethod,
		paymentNote: normalizeString(input.paymentNote),
		unitPrice: toNumber(input.unitPrice, 0),
		priceUnit,
		settlementMode,
		bizMode,

			truckNo: bizMode === 'truck' ? normalizedTruckNo : normalizeString(input.truckNo),
			truckOutGross: toNumber(input.truckOutGross, 0),
			truckBackGross: toNumber(input.truckBackGross, 0),
			truckSettleTare: toNumber(input.truckSettleTare, null),
			truckSettleGross: toNumber(input.truckSettleGross, null),
			truckGrossDiff: resolveTruckReferenceNet({
				truckOutGross: toNumber(input.truckOutGross, 0),
				truckBackGross: toNumber(input.truckBackGross, 0)
			}),
			truckSaleNet: resolveTruckBillableNet(
				{
					truckOutGross: toNumber(input.truckOutGross, 0),
					truckBackGross: toNumber(input.truckBackGross, 0),
					truckSettleTare: toNumber(input.truckSettleTare, null),
					truckSettleGross: toNumber(input.truckSettleGross, null)
				},
				priceUnit
			),

		flowIndexPrev: toNumber(input.flowIndexPrev, null),
		flowIndexCurr: toNumber(input.flowIndexCurr, null),
		flowVolumeM3: toNumber(input.flowVolumeM3, null),
		flowTheoryRatio: toNumber(input.flowTheoryRatio, null)
	}

	let outItems = normalizeBottleRows(input.outItems)
	let backItems = normalizeBottleRows(input.backItems)
	let depositRows = normalizeDepositRows(input.depositRows)
	let agentSaleRows = normalizeAgentSaleRows(input.agentSaleRows)

	// 模式隔离：非本模式字段必须清空，避免脏数据落库
	if (bizMode === 'agent_sale') {
		outItems = agentSaleRows.map((item) => ({
			bottle_no: item.bottle_no,
			bottle_id: item.bottle_id || null,
			gross: null,
			tare: null,
			net: item.fill_weight
		}))
		backItems = []
		depositRows = []
	} else if (bizMode === 'truck') {
		outItems = []
		backItems = []
		depositRows = []
		agentSaleRows = []
	}

	return {
		base,
		outRows: outItems,
		backRows: backItems,
		depositRows,
		agentSaleRows
	}
}

export { normalizeSaleDraft, validateSaleDraftForCreate, normalizePaymentStatus }
