import { callCloud } from '@/services/api'

export async function getReportSummaryV1(params) {
	return callCloud('crm-report', {
		action: 'summaryV1',
		data: { period: params.period || '' }
	})
}

export async function getSettlementIncomeV1(params = {}) {
	return callCloud('crm-report', {
		action: 'settlementIncomeV1',
		data: { date_from: params.date_from || '', date_to: params.date_to || '' }
	})
}
