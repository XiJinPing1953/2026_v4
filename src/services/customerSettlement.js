import { callCloud } from '@/services/api'

export async function previewAllocationV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'previewAllocationV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			amount: params.amount,
			allocation_mode: params.allocationMode || params.allocation_mode || '',
			allocation_start_date: params.allocationStartDate || params.allocation_start_date || '',
			allocation_end_date: params.allocationEndDate || params.allocation_end_date || '',
			allocation_targets: Array.isArray(params.allocationTargets || params.allocation_targets)
				? (params.allocationTargets || params.allocation_targets)
				: [],
			allocations: Array.isArray(params.allocations) ? params.allocations : []
		}
	})
}

export async function createReceiptV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'createReceiptV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			amount: params.amount,
			biz_date: params.bizDate || params.biz_date || '',
			allocation_mode: params.allocationMode || params.allocation_mode || '',
			allocation_start_date: params.allocationStartDate || params.allocation_start_date || '',
			allocation_end_date: params.allocationEndDate || params.allocation_end_date || '',
			allocation_targets: Array.isArray(params.allocationTargets || params.allocation_targets)
				? (params.allocationTargets || params.allocation_targets)
				: [],
			payment_method: params.paymentMethod || params.payment_method || '',
			note: params.note || '',
			source_type: params.sourceType || params.source_type || 'manual',
			source_id: params.sourceId || params.source_id || '',
			preview: Boolean(params.preview)
		}
	})
}

export async function updateReceiptV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'updateReceiptV1',
		data: {
			receipt_id: params.receiptId || params.receipt_id || '',
			customer_id: params.customerId || params.customer_id || '',
			amount: params.amount,
			biz_date: params.bizDate || params.biz_date || '',
			allocation_mode: params.allocationMode || params.allocation_mode || '',
			allocation_start_date: params.allocationStartDate || params.allocation_start_date || '',
			allocation_end_date: params.allocationEndDate || params.allocation_end_date || '',
			allocation_targets: Array.isArray(params.allocationTargets || params.allocation_targets)
				? (params.allocationTargets || params.allocation_targets)
				: [],
			payment_method: params.paymentMethod || params.payment_method || '',
			note: params.note || '',
			source_type: params.sourceType || params.source_type || '',
			source_id: params.sourceId || params.source_id || ''
		}
	})
}

export async function removeReceiptV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'removeReceiptV1',
		data: {
			receipt_id: params.receiptId || params.receipt_id || '',
			customer_id: params.customerId || params.customer_id || '',
			reason: params.reason || ''
		}
	})
}

export async function confirmAllocationV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'confirmAllocationV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			amount: params.amount,
			biz_date: params.bizDate || params.biz_date || '',
			allocation_mode: params.allocationMode || params.allocation_mode || '',
			allocation_start_date: params.allocationStartDate || params.allocation_start_date || '',
			allocation_end_date: params.allocationEndDate || params.allocation_end_date || '',
			allocation_targets: Array.isArray(params.allocationTargets || params.allocation_targets)
				? (params.allocationTargets || params.allocation_targets)
				: [],
			payment_method: params.paymentMethod || params.payment_method || '',
			note: params.note || '',
			source_type: params.sourceType || params.source_type || 'manual',
			source_id: params.sourceId || params.source_id || '',
			allocations: Array.isArray(params.allocations) ? params.allocations : []
		}
	})
}

export async function createPrepayEntryV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'createPrepayEntryV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			amount: params.amount,
			biz_date: params.bizDate || params.biz_date || '',
			payment_method: params.paymentMethod || params.payment_method || '',
			note: params.note || '',
			apply_strategy: params.applyStrategy || params.apply_strategy || 'hold_only',
			entry_kind: params.entryKind || params.entry_kind || 'prepay',
			allocation_mode: params.allocationMode || params.allocation_mode || '',
			allocation_start_date: params.allocationStartDate || params.allocation_start_date || '',
			allocation_end_date: params.allocationEndDate || params.allocation_end_date || '',
			source_type: params.sourceType || params.source_type || 'customer_prepay_manual',
			source_id: params.sourceId || params.source_id || ''
		}
	})
}

export async function getCustomerStatementV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'getCustomerStatementV1',
		data: {
			customer_id: params.customerId || params.customer_id || ''
		}
	})
}

export async function previewFlowSettlementV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'previewFlowSettlementV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			biz_date: params.bizDate || params.biz_date || '',
			flow_index_prev: params.flowIndexPrev ?? params.flow_index_prev ?? '',
			flow_index_curr: params.flowIndexCurr ?? params.flow_index_curr ?? '',
			flow_theory_ratio: params.flowTheoryRatio ?? params.flow_theory_ratio ?? '',
			note: params.note || ''
		}
	})
}

export async function createFlowSettlementV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'createFlowSettlementV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			biz_date: params.bizDate || params.biz_date || '',
			flow_index_prev: params.flowIndexPrev ?? params.flow_index_prev ?? '',
			flow_index_curr: params.flowIndexCurr ?? params.flow_index_curr ?? '',
			flow_theory_ratio: params.flowTheoryRatio ?? params.flow_theory_ratio ?? '',
			note: params.note || ''
		}
	})
}

export async function updateFlowSettlementV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'updateFlowSettlementV1',
		data: {
			flow_settlement_id: params.flowSettlementId || params.flow_settlement_id || params._id || '',
			customer_id: params.customerId || params.customer_id || '',
			biz_date: params.bizDate || params.biz_date || '',
			flow_index_prev: params.flowIndexPrev ?? params.flow_index_prev ?? '',
			flow_index_curr: params.flowIndexCurr ?? params.flow_index_curr ?? '',
			flow_theory_ratio: params.flowTheoryRatio ?? params.flow_theory_ratio ?? '',
			note: params.note || ''
		}
	})
}

export async function removeFlowSettlementV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'removeFlowSettlementV1',
		data: {
			flow_settlement_id: params.flowSettlementId || params.flow_settlement_id || params._id || '',
			customer_id: params.customerId || params.customer_id || '',
			reason: params.reason || ''
		}
	})
}

export async function getCustomerStatementAnalysisV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'getCustomerStatementAnalysisV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			date_from: params.dateFrom || params.date_from || '',
			date_to: params.dateTo || params.date_to || '',
			bottle_reference_price: params.bottleReferencePrice ?? params.bottle_reference_price ?? ''
		},
		timeout: 30000
	})
}

export async function listCustomerStatementRowsV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'listCustomerStatementRowsV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			date_from: params.dateFrom || params.date_from || '',
			date_to: params.dateTo || params.date_to || '',
			page: params.page || 1,
			pageSize: params.pageSize || 50
		}
	})
}

export async function exportCustomerStatementV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'exportCustomerStatementV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			date_from: params.dateFrom || params.date_from || '',
			date_to: params.dateTo || params.date_to || ''
		},
		timeout: 30000
	})
}

export async function refreshCustomerBalancesV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'refreshCustomerBalancesV1',
		data: {
			customer_id: params.customerId || params.customer_id || ''
		}
	})
}

export async function rebuildOpeningBalancesV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'rebuildOpeningBalancesV1',
		data: {
			execute: Boolean(params.execute)
		}
	})
}

export async function repairReceiptAllocationV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'repairReceiptAllocationV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			date_from: params.dateFrom || params.date_from || '',
			date_to: params.dateTo || params.date_to || '',
			execute: Boolean(params.execute),
			items: Array.isArray(params.items) ? params.items : []
		}
	})
}

export async function repairOffsetCreditsV1(params = {}) {
	return callCloud('crm-customer-settlement', {
		action: 'repairOffsetCreditsV1',
		data: {
			customer_id: params.customerId || params.customer_id || '',
			date_from: params.dateFrom || params.date_from || '',
			date_to: params.dateTo || params.date_to || '',
			execute: Boolean(params.execute)
		}
	})
}
