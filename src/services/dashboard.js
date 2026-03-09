import { callCloud } from '@/services/api'

export async function getDashboardSummaryV1(params = {}) {
	return callCloud('crm-dashboard', {
		action: 'summaryV1',
		data: {
			days: params.days || 7
		}
	})
}
