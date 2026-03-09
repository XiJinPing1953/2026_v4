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

function validateSaleDraftForCreate(normalized) {
	const base = normalized?.base || {}
	const outRows = normalized?.outRows || []
	const backRows = normalized?.backRows || []
	const depositRows = normalized?.depositRows || []

	const date = normalizeString(base.date)
	if (!date) return { ok: false, msg: '日期必填' }

	const customerId = normalizeString(base.customerId)
	if (!customerId) return { ok: false, msg: '客户必选' }

	const priceUnit = normalizeString(base.priceUnit)
	if (!PRICE_UNITS.includes(priceUnit)) return { ok: false, msg: '计价单位无效' }

	const unitPrice = typeof base.unitPrice === 'number' ? base.unitPrice : Number(base.unitPrice)
	if (!isPositiveNumber(unitPrice)) return { ok: false, msg: '单价必须大于 0' }

	const bizMode = normalizeString(base.bizMode)
	if (!BIZ_MODES.includes(bizMode)) return { ok: false, msg: '业务模式无效' }

	if (bizMode === 'truck') {
		const truckSaleNet = typeof base.truckSaleNet === 'number' ? base.truckSaleNet : Number(base.truckSaleNet)
		if (!isPositiveNumber(truckSaleNet)) return { ok: false, msg: '槽车销售净重必填且大于 0' }
	}

	if (bizMode === 'bottle') {
		if (!hasAnyBottleRows(outRows, backRows, depositRows)) return { ok: false, msg: '出瓶/回瓶/存瓶至少填写一项' }
	}

	if (priceUnit === 'm3') {
		const prev = base.flowIndexPrev
		const curr = base.flowIndexCurr
		const prevNum = typeof prev === 'number' ? prev : Number(prev)
		const currNum = typeof curr === 'number' ? curr : Number(curr)
		if (!Number.isFinite(prevNum) || !Number.isFinite(currNum)) return { ok: false, msg: '流量表上期/本期必填' }
	}

	return { ok: true }
}

// 轻量清理：去空白并统一成字符串
function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

// 数值兜底：空值/NaN 统一回退
function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	if (Number.isNaN(num)) return fallback
	return num
}

function normalizePaymentStatus(value) {
	const text = normalizeString(value)
	if (!text) return 'unpaid'
	if (text === '已结清' || text === 'paid') return 'paid'
	if (text === '部分付' || text === 'partial') return 'partial'
	if (text === '未付款' || text === 'unpaid' || text === '挂账') return 'unpaid'
	return text
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
			return {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null,
				gross,
				tare,
				net
			}
		})
		.filter(Boolean)
}

// 规范存瓶：去重并生成标准结构
function normalizeDepositRows(rows = []) {
	const seen = new Set()
	return rows
		.map((row) => normalizeBottleNo(row?.bottleNo ?? row?.bottle_no ?? row?.bottleInput))
		.filter((no) => {
			if (!no) return false
			if (seen.has(no)) return false
			seen.add(no)
			return true
		})
		.map((no) => ({ bottle_no: no, bottle_id: null }))
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
		.filter((row) => row && row.fill_weight > 0)
}

// 入口：将表单草稿规范化为后端可用 payload
function normalizeSaleDraft(input = {}) {
	const bizMode = BIZ_MODES.includes(input.bizMode) ? input.bizMode : 'bottle'
	const priceUnit = PRICE_UNITS.includes(input.priceUnit) ? input.priceUnit : 'kg'

	const base = {
		date: normalizeString(input.date),
		customerId: normalizeString(input.customerId),
		customerName: normalizeString(input.customerName),
		delivery1: normalizeString(input.delivery1),
		delivery2: normalizeString(input.delivery2),
		vehicleId: normalizeString(input.vehicleId),
		carNo: normalizeString(input.carNo),
		remark: normalizeString(input.remark),
		amountReceived: toNumber(input.amountReceived, 0),
		roundingAmount: toNumber(input.roundingAmount, 0),
		paymentStatus: normalizeString(input.paymentStatus),
		paymentMethod: normalizeString(input.paymentMethod),
		paymentNote: normalizeString(input.paymentNote),
		unitPrice: toNumber(input.unitPrice, 0),
		priceUnit,
		bizMode,

		truckNo: normalizeString(input.truckNo),
		truckOutGross: toNumber(input.truckOutGross, 0),
		truckBackGross: toNumber(input.truckBackGross, 0),
		truckSaleNet: toNumber(input.truckSaleNet, 0),

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
