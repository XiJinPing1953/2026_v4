import { computed } from 'vue'
import { toNumber, fix2, fmt2, nearlyEqual } from '@/utils/number'
import {
	normalizePaymentMethod,
	normalizePaymentStatus,
	resolveEffectiveShouldReceive
} from '@/services/models'

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

function resolveTruckReferenceNet(truckState) {
	const outGross = toNumber(truckState?.truckOutGross, null)
	const backGross = toNumber(truckState?.truckBackGross, null)
	if (outGross == null || backGross == null) return 0
	return Math.max(outGross - backGross, 0)
}

function resolveTruckSettlementNet(truckState) {
	const settleGross = toNumber(truckState?.truckSettleGross, null)
	const settleTare = toNumber(truckState?.truckSettleTare, null)
	if (settleGross == null || settleTare == null) return 0
	return Math.max(settleGross - settleTare, 0)
}

function resolveTruckSaleNet(truckState, priceUnit) {
	if (priceUnit === 'kg') {
		const settlementNet = resolveTruckSettlementNet(truckState)
		if (settlementNet > 0) return settlementNet
		const explicit = toNumber(truckState?.truckSaleNet, 0)
		if (explicit > 0) return explicit
	}
	return resolveTruckReferenceNet(truckState)
}

function buildSettlementSummary({ form, outItems, backItems, agentSaleRows, truck, flow, settlement }) {
	const bizMode = form.value.bizMode || 'bottle'
	const priceUnit = form.value.priceUnit || 'kg'
	const settlementMode = form.value.settlementMode || 'sale'
	const unitPrice = toNumber(form.value.unitPrice, 0)
	const rounding = Math.max(toNumber(settlement.value.roundingAmount, 0), 0)

	const outNetTotal = sumNet(outItems.value)
	const backNetTotal = sumNet(backItems.value)
	const agentTotal = sumAgent(agentSaleRows.value)
	const outCount = countBottleRows(outItems.value)
	const truckReferenceNet = resolveTruckReferenceNet(truck.value)
	const truckSettlementNet = resolveTruckSettlementNet(truck.value)
	const truckSaleNet = resolveTruckSaleNet(truck.value, priceUnit)
	const flowVolume = calcFlowVolume(flow.value.flowPrev, flow.value.flowCurr, flow.value.flowVolume)

	let shouldReceive = 0
	let formula = ''

	if (settlementMode === 'customer_flow') {
		return {
			amount: 0,
			baseAmount: 0,
			settledAmount: 0,
			formula: '该客户按客户对账页流量结算，本销售单仅记录实际送货重量，不在本单计费'
		}
	}

	if (bizMode === 'agent_sale') {
		shouldReceive = agentTotal * unitPrice
		formula = `应收 = 灌装净重合计 ${fmt2(agentTotal)} × 单价 ${fmt2(unitPrice)}`
	} else if (bizMode === 'truck') {
		shouldReceive = truckSaleNet * unitPrice
		if (priceUnit === 'kg') {
			formula = `应收 = 结算净重 ${fmt2(truckSaleNet)} × 单价 ${fmt2(unitPrice)}`
			const netDiff = fix2(truckSaleNet - truckReferenceNet)
			if (Math.abs(netDiff) > 0) {
				const sign = netDiff > 0 ? '+' : ''
				formula += `；参考净重 ${fmt2(truckReferenceNet)}，净重误差 ${sign}${fmt2(netDiff)}`
				if (netDiff < 0) {
					formula += `（已计入损耗 ${fmt2(Math.abs(netDiff))}）`
				}
			}
			if (truckSaleNet <= 0 && truckSettlementNet <= 0) {
				formula += '；请补录车皮重与灌装后车毛重'
			}
		} else {
			formula = `应收 = 参考净重 ${fmt2(truckSaleNet)} × 单价 ${fmt2(unitPrice)}`
		}
	} else if (priceUnit === 'kg') {
		const totalNet = outNetTotal - backNetTotal
		shouldReceive = totalNet * unitPrice
		formula = `应收 = (出瓶净重 ${fmt2(outNetTotal)} - 回瓶净重 ${fmt2(backNetTotal)}) × 单价 ${fmt2(unitPrice)}`
	} else if (priceUnit === 'bottle') {
		shouldReceive = outCount * unitPrice
		formula = `应收 = 出瓶瓶数 ${outCount} × 单价 ${fmt2(unitPrice)}`
	} else if (priceUnit === 'm3') {
		shouldReceive = flowVolume * unitPrice
		formula = `应收 = 流量 ${fmt2(flowVolume)} × 单价 ${fmt2(unitPrice)}`
	}

	const settledAmount = resolveEffectiveShouldReceive(shouldReceive, rounding)
	if (rounding > 0) {
		formula += shouldReceive < 0
			? `；实付 = 应收 + 抹零 ${fmt2(rounding)}`
			: `；实收 = 应收 - 抹零 ${fmt2(rounding)}`
	}

	return {
		amount: fix2(shouldReceive),
		baseAmount: fix2(shouldReceive),
		settledAmount,
		formula
	}
}

function validateSettlement({ form, settlement, summary }) {
	if (String(settlement?.value?.settlementMode || '') === 'customer_flow') {
		return { ok: true }
	}
	const roundingValue = toNumber(settlement.value.roundingAmount, 0)
	if (roundingValue < 0) return { ok: false, msg: '抹零金额不能为负数' }

	const shouldReceive = Number(summary.value.amount)
	const baseShould = Number(summary.value.baseAmount)
	const settledShould = Number(
		summary.value.settledAmount == null
			? resolveEffectiveShouldReceive(summary.value.amount, roundingValue)
			: summary.value.settledAmount
	)
	const receivedValue = toNumber(settlement.value.amountReceived, 0)

	if (Math.abs(roundingValue) > Math.abs(baseShould || 0)) {
		return { ok: false, msg: '抹零金额不能超过应收/应退金额' }
	}

	if (shouldReceive < 0 && receivedValue > 0) {
		return { ok: false, msg: '退款场景实收需为负数' }
	}

	const paymentStatus = normalizePaymentStatus(settlement.value.paymentStatus)
	const paymentMethod = normalizePaymentMethod(settlement.value.paymentMethod, {
		paymentStatus,
		settlementMode: form.value.settlementMode || 'sale',
		fallback: paymentStatus === 'unpaid' ? 'on_account' : 'cash'
	})
	if (paymentStatus === 'unpaid' && paymentMethod !== 'on_account') {
		return { ok: false, msg: '未付款状态必须选择挂账' }
	}
	if (paymentStatus !== 'unpaid' && paymentMethod === 'on_account') {
		return { ok: false, msg: '已收款场景不能选择挂账' }
	}
	if (paymentStatus === 'unpaid') {
		if (!nearlyEqual(receivedValue, 0)) {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
	} else if (paymentStatus === 'partial') {
		if (settledShould > 0) {
			if (!(receivedValue > 0 && receivedValue < settledShould)) {
				return { ok: false, msg: '结算金额与付款状态不一致' }
			}
		} else if (settledShould < 0) {
			if (!(receivedValue < 0 && receivedValue > settledShould)) {
				return { ok: false, msg: '结算金额与付款状态不一致' }
			}
		} else {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
	} else if (paymentStatus === 'paid') {
		if (settledShould > 0 && receivedValue < 0 && !nearlyEqual(receivedValue, 0)) {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
		if (settledShould < 0 && receivedValue < settledShould && !nearlyEqual(receivedValue, settledShould)) {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
		if (settledShould === 0 && !nearlyEqual(receivedValue, 0)) return { ok: false, msg: '结算金额与付款状态不一致' }
	}

	return { ok: true }
}

export function useSaleSettlement({ form, outItems, backItems, agentSaleRows, truck, flow, settlement }) {
	const summary = computed(() =>
		buildSettlementSummary({ form, outItems, backItems, agentSaleRows, truck, flow, settlement })
	)

	const validate = () => validateSettlement({
		form,
		settlement: {
			value: {
				...(settlement.value || {}),
				settlementMode: form.value.settlementMode || 'sale'
			}
		},
		summary
	})

	return {
		summary,
		validate
	}
}
