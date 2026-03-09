import { callCloud } from '@/services/api'

export async function searchUsersV1(params) {
	return callCloud('crm-user', {
		action: 'listV1',
		data: {
			keyword: params.keyword || '',
			limit: params.limit || 20
		}
	})
}
