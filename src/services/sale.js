import { callCloud } from '@/services/api'
import { normalizeSaleDraft, validateSaleDraftForCreate } from '@/services/models'

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
		vehicleId: '',
		carNo: draft.form.vehicleNo,
		priceUnit: draft.form.priceUnit,
		unitPrice: draft.form.unitPrice,
		bizMode: inferBizMode({ agentSaleRows: draft.agentSaleRows, truckNo: draft.truck.truckNo }),
		truckNo: draft.truck.truckNo,
		truckOutGross: draft.truck.truckOutGross,
		truckBackGross: draft.truck.truckBackGross,
		truckSaleNet: draft.truck.truckSaleNet,
		flowIndexPrev: draft.flow.flowPrev,
		flowIndexCurr: draft.flow.flowCurr,
		flowVolumeM3: draft.flow.flowVolume,
		flowTheoryRatio: draft.flow.flowRatio,
		paymentStatus: draft.settlement.paymentStatus,
		paymentMethod: draft.settlement.paymentMethod,
		amountReceived: draft.settlement.amountReceived,
		roundingAmount: draft.settlement.roundingAmount,
		paymentNote: draft.settlement.paymentNote,
		outItems: draft.outItems,
		backItems: draft.backItems,
		depositRows: draft.depositRows,
		agentSaleRows: draft.agentSaleRows
	})

	const validation = validateSaleDraftForCreate(normalized)
	if (!validation.ok) return { code: 400, msg: validation.msg }

	return callCloud('crm-sale', {
		action: 'createV2',
		data: normalized
	})
}

export async function updateSaleV2(params) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }

	const draft = params.draft
	if (!draft) return { code: 400, msg: '缺少 draft' }

	const normalized = normalizeSaleDraft({
		date: draft.form.date,
		customerId: draft.form.customerId,
		customerName: draft.form.customerName,
		delivery1: draft.form.deliveryMan1,
		delivery2: draft.form.deliveryMan2,
		vehicleId: '',
		carNo: draft.form.vehicleNo,
		priceUnit: draft.form.priceUnit,
		unitPrice: draft.form.unitPrice,
		bizMode: inferBizMode({ agentSaleRows: draft.agentSaleRows, truckNo: draft.truck.truckNo }),
		truckNo: draft.truck.truckNo,
		truckOutGross: draft.truck.truckOutGross,
		truckBackGross: draft.truck.truckBackGross,
		truckSaleNet: draft.truck.truckSaleNet,
		flowIndexPrev: draft.flow.flowPrev,
		flowIndexCurr: draft.flow.flowCurr,
		flowVolumeM3: draft.flow.flowVolume,
		flowTheoryRatio: draft.flow.flowRatio,
		paymentStatus: draft.settlement.paymentStatus,
		paymentMethod: draft.settlement.paymentMethod,
		amountReceived: draft.settlement.amountReceived,
		roundingAmount: draft.settlement.roundingAmount,
		paymentNote: draft.settlement.paymentNote,
		outItems: draft.outItems,
		backItems: draft.backItems,
		depositRows: draft.depositRows,
		agentSaleRows: draft.agentSaleRows
	})

	const validation = validateSaleDraftForCreate(normalized)
	if (!validation.ok) return { code: 400, msg: validation.msg }

	return callCloud('crm-sale', {
		action: 'updateV2',
		data: {
			recordId,
			payload: normalized
		}
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
			bizMode: filters.bizMode || filters.biz_mode || '',
			page: filters.page || 1,
			pageSize: filters.pageSize || 20
		}
	})
}

export async function getSaleV2(params) {
	return callCloud('crm-sale', {
		action: 'getV2',
		data: {
			_id: params._id || params.id || ''
		}
	})
}

export async function getCustomerDepositV1(params) {
	return callCloud('crm-sale', {
		action: 'getCustomerDepositV1',
		data: {
			customerId: params.customerId || '',
			customerName: params.customerName || '',
			date: params.date || ''
		}
	})
}

export async function removeSaleV2(params = {}) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	return callCloud('crm-sale', {
		action: 'removeV2',
		data: {
			recordId
		}
	})
}
