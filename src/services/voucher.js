import { callCloud } from '@/services/api'

export async function listVouchersV1(filters) {
	return callCloud('crm-voucher', {
		action: 'listV1',
		data: {
			keyword: filters.keyword || '',
			status: filters.status || '',
			dateStart: filters.dateStart || '',
			dateEnd: filters.dateEnd || '',
			page: filters.page || 1,
			pageSize: filters.pageSize || 20
		}
	})
}

export async function getVoucherV1(params) {
	return callCloud('crm-voucher', {
		action: 'getV1',
		data: { _id: params._id || params.id || '' }
	})
}

export async function createVoucherV1(data) {
	return callCloud('crm-voucher', {
		action: 'createV1',
		data
	})
}

export async function updateVoucherV1(data) {
	return callCloud('crm-voucher', {
		action: 'updateV1',
		data
	})
}

export async function postVoucherV1(data) {
	return callCloud('crm-voucher', {
		action: 'postV1',
		data
	})
}

export async function unpostVoucherV1(data) {
	return callCloud('crm-voucher', {
		action: 'unpostV1',
		data
	})
}
