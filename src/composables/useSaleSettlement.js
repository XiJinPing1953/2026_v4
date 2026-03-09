import { computed } from 'vue'
import { toNumber, fix2, fmt2, nearlyEqual } from '@/utils/number'
import { normalizePaymentStatus } from '@/services/models/sale'

function sumNet(rows) {
	return (rows || []).reduce((sum, row) => {
		const net = toNumber(row?.net, null)
		if (net != null) return sum + net
		const gross = toNumber(row?.gross, 0)
		const tare = toNumber(row?.tare, 0)
		if (gross || tare) return sum + (gross - tare)
		return sum
	}, 0)
}

function sumAgent(rows) {
	return (rows || []).reduce((sum, row) => sum + toNumber(row?.fill_weight, 0), 0)
}

function countBottleRows(rows) {
	return (rows || []).filter((row) => String(row?.bottle_no || '').trim()).length
}

function calcFlowVolume(prev, curr, volume) {
	const vol = toNumber(volume, null)
	if (vol != null) return Math.max(vol, 0)
	const prevNum = toNumber(prev, null)
	const currNum = toNumber(curr, null)
	if (prevNum == null || currNum == null) return 0
	return Math.max(currNum - prevNum, 0)
}

function buildSettlementSummary({ form, outItems, backItems, agentSaleRows, truck, flow, settlement }) {
	const bizMode = form.value.bizMode || 'bottle'
	const priceUnit = form.value.priceUnit || 'kg'
	const unitPrice = toNumber(form.value.unitPrice, 0)
	const rounding = Math.max(toNumber(settlement.value.roundingAmount, 0), 0)

	const outNetTotal = sumNet(outItems.value)
	const backNetTotal = sumNet(backItems.value)
	const agentTotal = sumAgent(agentSaleRows.value)
	const outCount = countBottleRows(outItems.value)
	const truckSaleNet = toNumber(truck.value.truckSaleNet, 0)
	const flowVolume = calcFlowVolume(flow.value.flowPrev, flow.value.flowCurr, flow.value.flowVolume)

	let shouldReceive = 0
	let formula = ''

	if (bizMode === 'agent_sale') {
		shouldReceive = agentTotal * unitPrice
		formula = `应收 = 灌装净重合计 ${fmt2(agentTotal)} × 单价 ${fmt2(unitPrice)} - 抹零 ${fmt2(rounding)}`
	} else if (bizMode === 'truck') {
		shouldReceive = truckSaleNet * unitPrice
		formula = `应收 = 槽车销售净重 ${fmt2(truckSaleNet)} × 单价 ${fmt2(unitPrice)} - 抹零 ${fmt2(rounding)}`
	} else if (priceUnit === 'kg') {
		const totalNet = outNetTotal - backNetTotal
		shouldReceive = totalNet * unitPrice
		formula = `应收 = (出瓶净重 ${fmt2(outNetTotal)} - 回瓶净重 ${fmt2(backNetTotal)}) × 单价 ${fmt2(unitPrice)} - 抹零 ${fmt2(rounding)}`
	} else if (priceUnit === 'bottle') {
		shouldReceive = outCount * unitPrice
		formula = `应收 = 出瓶瓶数 ${outCount} × 单价 ${fmt2(unitPrice)} - 抹零 ${fmt2(rounding)}`
	} else if (priceUnit === 'm3') {
		shouldReceive = flowVolume * unitPrice
		formula = `应收 = 流量 ${fmt2(flowVolume)} × 单价 ${fmt2(unitPrice)} - 抹零 ${fmt2(rounding)}`
	}

	let finalShould = shouldReceive
	if (shouldReceive > 0) finalShould = shouldReceive - rounding
	else if (shouldReceive < 0) finalShould = shouldReceive + rounding
	else finalShould = 0

	if (shouldReceive < 0 && rounding > 0) {
		formula = formula.replace(' - 抹零', ' + 抹零')
	}

	return {
		amount: fix2(finalShould),
		baseAmount: fix2(shouldReceive),
		formula
	}
}

function validateSettlement({ settlement, summary }) {
	const roundingValue = toNumber(settlement.value.roundingAmount, 0)
	if (roundingValue < 0) return { ok: false, msg: '抹零金额不能为负数' }

	const shouldReceive = Number(summary.value.amount)
	const baseShould = Number(summary.value.baseAmount)
	const receivedValue = toNumber(settlement.value.amountReceived, 0)

	if (Math.abs(roundingValue) > Math.abs(baseShould || 0)) {
		return { ok: false, msg: '抹零金额不能超过应收/应退金额' }
	}

	if (shouldReceive < 0 && receivedValue > 0) {
		return { ok: false, msg: '退款场景实收需为负数' }
	}

	const paymentStatus = normalizePaymentStatus(settlement.value.paymentStatus)
	if (paymentStatus === 'unpaid') {
		if (!nearlyEqual(receivedValue, 0)) {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
	} else if (paymentStatus === 'partial') {
		if (shouldReceive > 0) {
			if (!(receivedValue > 0 && receivedValue < shouldReceive)) {
				return { ok: false, msg: '结算金额与付款状态不一致' }
			}
		} else if (shouldReceive < 0) {
			if (!(receivedValue < 0 && receivedValue > shouldReceive)) {
				return { ok: false, msg: '结算金额与付款状态不一致' }
			}
		} else {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
	} else if (paymentStatus === 'paid') {
		if (!nearlyEqual(receivedValue, shouldReceive)) {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
	}

	return { ok: true }
}

export function useSaleSettlement({ form, outItems, backItems, agentSaleRows, truck, flow, settlement }) {
	const summary = computed(() =>
		buildSettlementSummary({ form, outItems, backItems, agentSaleRows, truck, flow, settlement })
	)

	const validate = () => validateSettlement({ settlement, summary })

	return {
		summary,
		validate
	}
}
