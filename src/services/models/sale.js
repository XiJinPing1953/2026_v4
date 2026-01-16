const BIZ_MODES = ['bottle', 'truck', 'agent_sale']
const PRICE_UNITS = ['kg', 'bottle', 'm3']

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	if (Number.isNaN(num)) return fallback
	return num
}

function isPlateNumber(value) {
	const str = normalizeString(value)
	if (!str) return false
	// 车牌号必须过滤掉，避免被误当作瓶号参与流转/存瓶
	return /^(京|津|沪|渝|冀|豫|云|辽|黑|湘|皖|鲁|新|苏|浙|赣|鄂|桂|甘|晋|蒙|陕|吉|闽|贵|粤|青|藏|川|宁|琼|使|领|WJ|警|学|挂|港|澳|临|军)[A-Z][A-Z0-9]{4,5}$/i.test(str)
}

function normalizeBottleNo(value) {
	const no = normalizeString(value).toUpperCase()
	if (!no || no === 'TRUCK-NO') return ''
	if (isPlateNumber(no)) return ''
	return no
}

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

function buildDepositRaw(outItems, backItems, explicitDepositNos, bizMode) {
	if (bizMode === 'truck' || bizMode === 'agent_sale') return ''
	const backSet = new Set(backItems.map((item) => item.bottle_no))
	const explicitSet = new Set(explicitDepositNos)
	const implicit = []
	outItems.forEach((item) => {
		if (!item?.bottle_no) return
		if (backSet.has(item.bottle_no)) return
		if (explicitSet.has(item.bottle_no)) return
		implicit.push(item.bottle_no)
	})
	const all = Array.from(new Set([...explicitDepositNos, ...implicit]))
	return all.join(' / ')
}

function normalizeFlow(base, priceUnit, totalNetWeight) {
	let flowIndexPrev = toNumber(base.flow_index_prev, null)
	let flowIndexCurr = toNumber(base.flow_index_curr, null)
	let flowVolumeM3 = toNumber(base.flow_volume_m3 ?? base.flow_volume, null)
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

	const unitPrice = toNumber(base.unit_price, 0)
	const flowUnitPrice = unitPrice
	// m3 强制口径：应收 = flow_volume_m3 * unit_price
	const flowAmountShould = priceUnit === 'm3' && flowVolumeM3 != null
		? Number((flowVolumeM3 * flowUnitPrice).toFixed(2))
		: null

	const flowTheoreticalVolumeM3 = (flowTheoryRatio && totalNetWeight)
		? Number((totalNetWeight * flowTheoryRatio).toFixed(3))
		: null

	return {
		flow_index_prev: flowIndexPrev,
		flow_index_curr: flowIndexCurr,
		flow_volume_m3: flowVolumeM3,
		flow_theory_ratio: flowTheoryRatio,
		flow_conversion_ratio: flowTheoryRatio,
		flow_theoretical_volume_m3: flowTheoreticalVolumeM3,
		flow_unit_price: flowUnitPrice,
		flow_amount_should: flowAmountShould,
		flow_amount_received: toNumber(base.flow_amount_received ?? base.amount_received, 0),
		flow_payment_status: normalizeString(base.flow_payment_status ?? base.payment_status),
		flow_remark: normalizeString(base.flow_remark)
	}
}

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
		car_no: normalizeString(input.carNo),
		remark: normalizeString(input.remark),
		amountReceived: toNumber(input.amountReceived, 0),
		paymentStatus: normalizeString(input.paymentStatus),
		paymentNote: normalizeString(input.paymentNote),
		unitPrice: toNumber(input.unitPrice, 0),
		priceUnit,
		bizMode,
		truckGross: toNumber(input.truckGross, 0),
		truckTare: toNumber(input.truckTare, 0),
		truckNet: toNumber(input.truckNet, 0),
		truck_out_gross: toNumber(input.truckOutGross, 0),
		truck_back_gross: toNumber(input.truckBackGross, 0),
		truck_sale_net: toNumber(input.truckSaleNet, 0),
		truck_no: normalizeString(input.truckNo)
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

	const outNetTotal = outItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	const backNetTotal = backItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)

	let totalNetWeight = outNetTotal - backNetTotal
	if (bizMode === 'truck') {
		totalNetWeight = toNumber(base.truck_sale_net, 0)
	}

	const flow = normalizeFlow(base, priceUnit, totalNetWeight)

	let outAmount = 0
	let backAmount = 0
	let shouldReceive = 0
	if (bizMode === 'agent_sale') {
		const totalWeight = agentSaleRows.reduce((sum, row) => sum + toNumber(row.fill_weight, 0), 0)
		outAmount = totalWeight * base.unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'kg') {
		outAmount = outNetTotal * base.unitPrice
		backAmount = backNetTotal * base.unitPrice
		shouldReceive = outAmount - backAmount
	} else if (priceUnit === 'bottle') {
		outAmount = outItems.length * base.unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'm3') {
		const flowVolume = flow.flow_volume_m3 || 0
		outAmount = flowVolume * base.unitPrice
		shouldReceive = outAmount
	}

	outAmount = Number(outAmount.toFixed(2))
	backAmount = Number(backAmount.toFixed(2))
	shouldReceive = Number(shouldReceive.toFixed(2))

	const explicitDepositNos = depositRows.map((row) => row.bottle_no)
	const depositRaw = buildDepositRaw(outItems, backItems, explicitDepositNos, bizMode)

	return {
		base: {
			...base,
			out_net_total: outNetTotal,
			back_net_total: backNetTotal,
			total_net_weight: totalNetWeight,
			amount: shouldReceive,
			amountReceived: base.amountReceived,
			paymentStatus: base.paymentStatus,
			paymentNote: base.paymentNote,
			flow_amount_should: flow.flow_amount_should,
			flow_amount_received: flow.flow_amount_received,
			flow_payment_status: flow.flow_payment_status,
			flow_remark: flow.flow_remark
		},
		outRows: outItems,
		backRows: backItems,
		depositRows,
		agentSaleRows,
		deposit_bottles_raw: depositRaw,
		derived: {
			outAmount,
			backAmount,
			shouldReceive,
			flowAmountShould: flow.flow_amount_should,
			flowVolumeM3: flow.flow_volume_m3,
			totalNetWeight
		}
	}
}

export { normalizeSaleDraft, isPlateNumber }
