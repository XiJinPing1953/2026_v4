import { callCloud } from '@/services/api'
import { normalizeSaleDraft } from '@/services/models'

function inferBizMode({ agentSaleRows, truckNo }) {
	if (Array.isArray(agentSaleRows) && agentSaleRows.length) return 'agent_sale'
	if (truckNo) return 'truck'
	return 'bottle'
}

export async function createSaleV2(draft) {
	const normalized = normalizeSaleDraft({
		date: draft.form.date,
		customerId: draft.form.customerId,
		customerName: draft.form.customerName,
		delivery1: draft.form.deliveryMan1,
		delivery2: draft.form.deliveryMan2,
		vehicleId: draft.form.vehicleId,
		carNo: draft.form.vehicleNo,
		priceUnit: draft.form.priceUnit,
		unitPrice: draft.form.unitPrice,
		bizMode: inferBizMode({ agentSaleRows: draft.agentSaleRows, truckNo: draft.truck.truckNo }),
		truckNo: draft.truck.truckNo,
		truckOutGross: draft.truck.truckOutGross,
		truckBackGross: draft.truck.truckBackGross,
		truckSaleNet: draft.truck.truckSaleNet,
		flow_index_prev: draft.flow.flowPrev,
		flow_index_curr: draft.flow.flowCurr,
		flow_volume_m3: draft.flow.flowVolume,
		flow_theory_ratio: draft.flow.flowRatio,
		paymentStatus: draft.settlement.paymentStatus,
		amountReceived: draft.settlement.amountReceived,
		paymentNote: draft.settlement.paymentNote,
		outItems: draft.outItems,
		backItems: draft.backItems,
		depositRows: draft.depositRows,
		agentSaleRows: draft.agentSaleRows
	})

	return callCloud('crm-sale', {
		action: 'createV2',
		data: normalized
	})
}

export async function listSalesV2(filters) {
	return callCloud('crm-sale', {
		action: 'listV2',
		data: {
			keyword: filters.keyword || '',
			dateStart: filters.dateStart || '',
			dateEnd: filters.dateEnd || '',
			priceUnit: filters.priceUnit || '',
			page: filters.page || 1,
			pageSize: filters.pageSize || 20
		}
	})
}
