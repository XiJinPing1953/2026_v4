import { callCloud } from '@/services/api'

export async function listCustomersV1(params) {
	const rawSummaryIgnoreActive = params.summary_ignore_active ?? params.summaryIgnoreActive
	const data = {
		keyword: params.keyword || '',
		page: params.page || 1,
		pageSize: params.pageSize || 20
	}
	if (params.is_active != null) data.is_active = params.is_active
	else if (params.isActive != null) data.is_active = params.isActive
	const balanceType = params.balance_type ?? params.balanceType
	if (balanceType != null) data.balance_type = balanceType
	const updatedDateStart = params.updated_date_start ?? params.updatedDateStart
	if (updatedDateStart != null) data.updated_date_start = updatedDateStart
	const updatedDateEnd = params.updated_date_end ?? params.updatedDateEnd
	if (updatedDateEnd != null) data.updated_date_end = updatedDateEnd
	const cashierUnallocatedOnly = params.cashier_unallocated_only ?? params.cashierUnallocatedOnly
	if (cashierUnallocatedOnly != null) data.cashier_unallocated_only = Boolean(cashierUnallocatedOnly)
	const cashierDateStart = params.cashier_unallocated_date_start ?? params.cashierUnallocatedDateStart
	if (cashierDateStart != null) data.cashier_unallocated_date_start = cashierDateStart
	const cashierDateEnd = params.cashier_unallocated_date_end ?? params.cashierUnallocatedDateEnd
	if (cashierDateEnd != null) data.cashier_unallocated_date_end = cashierDateEnd
	if (rawSummaryIgnoreActive != null) data.summary_ignore_active = Boolean(rawSummaryIgnoreActive)

	return callCloud('crm-customer', {
		action: 'listV1',
		data
	})
}

export async function getCustomerV1(params) {
	return callCloud('crm-customer', {
		action: 'getV1',
		data: { _id: params._id || params.id || '' }
	})
}

export async function resolveCustomerQrCodeV1(params = {}) {
	return callCloud('crm-customer', {
		action: 'resolveQrCodeV1',
		data: {
			qr_code: params.qr_code || params.qrCode || params.token || ''
		}
	})
}

export async function createCustomerV1(data) {
	return callCloud('crm-customer', {
		action: 'createV1',
		data
	})
}

export async function updateCustomerV1(data) {
	return callCloud('crm-customer', {
		action: 'updateV1',
		data
	})
}
