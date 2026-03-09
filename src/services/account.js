import { callCloud } from '@/services/api'

export async function listAccountsV1(params) {
	return callCloud('crm-account', {
		action: 'listV1',
		data: {
			keyword: params.keyword || '',
			is_active: params.is_active ?? params.isActive,
			page: params.page || 1,
			pageSize: params.pageSize || params.limit || 50
		}
	})
}

export async function getAccountV1(params) {
	return callCloud('crm-account', {
		action: 'getV1',
		data: { _id: params._id || params.id || '' }
	})
}

export async function createAccountV1(data) {
	return callCloud('crm-account', {
		action: 'createV1',
		data
	})
}

export async function updateAccountV1(data) {
	return callCloud('crm-account', {
		action: 'updateV1',
		data
	})
}
