import { callCloud } from '@/services/api'

export async function listOperationLogsV1(params = {}) {
	return callCloud('crm-log', {
		action: 'listOperationLogsV1',
		data: {
			keyword: params.keyword || '',
			action: params.action || '',
			actionCategory: params.actionCategory || '',
			role: params.role || '',
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || '',
			page: params.page || 1,
			pageSize: params.pageSize || 50
		}
	})
}
