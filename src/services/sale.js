import { callCloud } from '@/services/api'
import { normalizeSaleDraft, validateSaleDraftForCreate } from '@/services/models'

const SALE_SAVE_TIMEOUT_MS = 120000

function normalizeBizMode(value) {
	const text = String(value || '').trim()
	if (text === 'bottle' || text === 'truck' || text === 'agent_sale') return text
	return 'bottle'
}

export async function createSaleV2(draft, options = {}) {
	const normalized = normalizeSaleDraft({
		date: draft.form.date,
		customerId: draft.form.customerId,
		customerName: draft.form.customerName,
		delivery1: draft.form.deliveryMan1,
		delivery2: draft.form.deliveryMan2,
		vehicleId: '',
		carNo: draft.form.vehicleNo,
		remark: draft.form.remark,
		ticketImage: draft.form.ticketImage || (Array.isArray(draft.form.ticketImages) ? draft.form.ticketImages[0] || '' : ''),
		ticketImages: Array.isArray(draft.form.ticketImages) ? draft.form.ticketImages : [],
		priceUnit: draft.form.priceUnit,
		settlementMode: draft.form.settlementMode,
		unitPrice: draft.form.unitPrice,
		bizMode: normalizeBizMode(draft.form.bizMode),
			truckNo: draft.truck.truckNo,
			truckOutGross: draft.truck.truckOutGross,
			truckBackGross: draft.truck.truckBackGross,
			truckSettleTare: draft.truck.truckSettleTare,
			truckSettleGross: draft.truck.truckSettleGross,
			truckGrossDiff: draft.truck.truckGrossDiff,
		flowIndexPrev: draft.flow.flowPrev,
		flowIndexCurr: draft.flow.flowCurr,
		flowVolumeM3: draft.flow.flowVolume,
		flowTheoryRatio: draft.flow.flowRatio,
		paymentStatus: draft.settlement.paymentStatus,
		paymentMethod: draft.settlement.paymentMethod,
		amountReceived: draft.settlement.amountReceived,
		roundingAmount: draft.settlement.roundingAmount,
		applyOffsetCredit: draft.settlement.applyOffsetCredit,
		offsetEnabled: draft.settlement.offsetEnabled,
		paymentNote: draft.settlement.paymentNote,
		outItems: draft.outItems,
		backItems: draft.backItems,
		depositRows: draft.depositRows,
		agentSaleRows: draft.agentSaleRows
	})

	const validation = validateSaleDraftForCreate(normalized)
	if (!validation.ok) return { code: 400, msg: validation.msg }

	const data = { ...normalized }
	if (options.ignoreBottleFlowWarning) data.ignore_bottle_flow_warning = true

	return callCloud('crm-sale', {
		action: 'createV2',
		data,
		timeout: SALE_SAVE_TIMEOUT_MS
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
		remark: draft.form.remark,
		ticketImage: draft.form.ticketImage || (Array.isArray(draft.form.ticketImages) ? draft.form.ticketImages[0] || '' : ''),
		ticketImages: Array.isArray(draft.form.ticketImages) ? draft.form.ticketImages : [],
		priceUnit: draft.form.priceUnit,
		settlementMode: draft.form.settlementMode,
		unitPrice: draft.form.unitPrice,
		bizMode: normalizeBizMode(draft.form.bizMode),
			truckNo: draft.truck.truckNo,
			truckOutGross: draft.truck.truckOutGross,
			truckBackGross: draft.truck.truckBackGross,
			truckSettleTare: draft.truck.truckSettleTare,
			truckSettleGross: draft.truck.truckSettleGross,
			truckGrossDiff: draft.truck.truckGrossDiff,
		flowIndexPrev: draft.flow.flowPrev,
		flowIndexCurr: draft.flow.flowCurr,
		flowVolumeM3: draft.flow.flowVolume,
		flowTheoryRatio: draft.flow.flowRatio,
		paymentStatus: draft.settlement.paymentStatus,
		paymentMethod: draft.settlement.paymentMethod,
		amountReceived: draft.settlement.amountReceived,
		roundingAmount: draft.settlement.roundingAmount,
		applyOffsetCredit: draft.settlement.applyOffsetCredit,
		offsetEnabled: draft.settlement.offsetEnabled,
		paymentNote: draft.settlement.paymentNote,
		outItems: draft.outItems,
		backItems: draft.backItems,
		depositRows: draft.depositRows,
		agentSaleRows: draft.agentSaleRows
	})

	const validation = validateSaleDraftForCreate(normalized)
	if (!validation.ok) return { code: 400, msg: validation.msg }

	const data = {
		recordId,
		payload: normalized
	}
	if (params.ignoreBottleFlowWarning) data.ignore_bottle_flow_warning = true

	return callCloud('crm-sale', {
		action: 'updateV2',
		data,
		timeout: SALE_SAVE_TIMEOUT_MS
	})
}

export async function updateSaleSettlementV1(params = {}) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	const settlement = params.settlement && typeof params.settlement === 'object'
		? params.settlement
		: {}
	return callCloud('crm-sale', {
		action: 'updateSettlementV1',
		data: {
			recordId,
			settlement: {
				paymentStatus: settlement.paymentStatus ?? settlement.payment_status ?? '',
				paymentMethod: settlement.paymentMethod ?? settlement.payment_method ?? '',
				amountReceived: settlement.amountReceived ?? settlement.amount_received ?? '',
				roundingAmount: settlement.roundingAmount ?? settlement.rounding_amount ?? '',
				applyOffsetCredit: settlement.applyOffsetCredit ?? settlement.apply_offset_credit ?? false,
				offsetEnabled: settlement.offsetEnabled ?? settlement.offset_enabled ?? false,
				paymentNote: settlement.paymentNote ?? settlement.payment_note ?? ''
			}
		},
		timeout: SALE_SAVE_TIMEOUT_MS
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
			paymentStatus: filters.paymentStatus || filters.payment_status || '',
			settlementScope: filters.settlementScope || filters.settlement_scope || '',
			hasRemark: filters.hasRemark || filters.has_remark || '',
			remarkTag: filters.remarkTag || filters.remark_tag || '',
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

export async function searchAgentFillSuggestionsV1(params = {}) {
	return callCloud('crm-sale', {
		action: 'searchAgentFillSuggestionsV1',
		data: {
			keyword: params.keyword || params.bottleNo || params.bottle_no || '',
			date: params.date || params.saleDate || params.sale_date || '',
			limit: params.limit || 20
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

export async function quickReceiveSaleV1(params = {}) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	const data = {
		recordId,
		amountReceived: params.amountReceived,
		paymentNote: params.paymentNote || params.payment_note || '',
		paymentMethod: params.paymentMethod || params.payment_method || '',
		bizDate: params.bizDate || params.biz_date || '',
		allocationMode: params.allocationMode || params.allocation_mode || '',
		allocationStartDate: params.allocationStartDate || params.allocation_start_date || '',
		allocationEndDate: params.allocationEndDate || params.allocation_end_date || ''
	}
	if (params.paymentStatus || params.payment_status) {
		data.paymentStatus = params.paymentStatus || params.payment_status || ''
	}
	return callCloud('crm-sale', {
		action: 'quickReceiveV1',
		data
	})
}
