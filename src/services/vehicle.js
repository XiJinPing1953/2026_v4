import { callCloud } from '@/services/api'

export async function searchVehiclesV1(params) {
	const data = {
		keyword: params.keyword || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 20
	}
	if (params.is_active != null) data.is_active = params.is_active
	else if (params.isActive != null) data.is_active = params.isActive

	return callCloud('crm-vehicle', {
		action: 'listV1',
		data
	})
}

export async function getVehicleV1(params) {
	return callCloud('crm-vehicle', {
		action: 'getV1',
		data: { _id: params._id || params.id || '' }
	})
}

export async function resolveVehicleQrCodeV1(params = {}) {
	return callCloud('crm-vehicle', {
		action: 'resolveQrCodeV1',
		data: {
			qr_code: params.qr_code || params.qrCode || params.token || ''
		}
	})
}

export async function createVehicleV1(data) {
	return callCloud('crm-vehicle', {
		action: 'createV1',
		data
	})
}

export async function updateVehicleV1(data) {
	return callCloud('crm-vehicle', {
		action: 'updateV1',
		data
	})
}
