import { callCloud } from '@/services/api'

export async function searchBottlesV1(params) {
	const data = {
		keyword: params.keyword || '',
		status: params.status || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 20
	}
	if (params.is_active != null) data.is_active = params.is_active
	else if (params.isActive != null) data.is_active = params.isActive

	return callCloud('crm-bottle', {
		action: 'listV1',
		data
	})
}

export async function getBottleV1(params) {
	return callCloud('crm-bottle', {
		action: 'getV1',
		data: { _id: params._id || params.id || '' }
	})
}

export async function createBottleV1(data) {
	return callCloud('crm-bottle', {
		action: 'createV1',
		data
	})
}

export async function updateBottleV1(data) {
	return callCloud('crm-bottle', {
		action: 'updateV1',
		data
	})
}
