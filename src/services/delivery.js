import { callCloud } from '@/services/api'

export async function searchDeliveriesV1(params = {}) {
	const data = {
		keyword: params.keyword || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 20
	}
	if (params.is_active != null) data.is_active = params.is_active
	else if (params.isActive != null) data.is_active = params.isActive

	return callCloud('crm-delivery', {
		action: 'listV1',
		data
	})
}

export async function getDeliveryV1(params) {
	return callCloud('crm-delivery', {
		action: 'getV1',
		data: { _id: params._id || params.id || '' }
	})
}

export async function resolveDeliveryQrCodeV1(params = {}) {
	return callCloud('crm-delivery', {
		action: 'resolveQrCodeV1',
		data: {
			qr_code: params.qr_code || params.qrCode || params.token || ''
		}
	})
}

export async function createDeliveryV1(data) {
	return callCloud('crm-delivery', {
		action: 'createV1',
		data
	})
}

export async function updateDeliveryV1(data) {
	return callCloud('crm-delivery', {
		action: 'updateV1',
		data
	})
}
