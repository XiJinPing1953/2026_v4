import { callCloud } from '@/services/api'

export async function getReportSummaryV1(params) {
	return callCloud('crm-report', {
		action: 'summaryV1',
		data: { period: params.period || '' }
	})
}
