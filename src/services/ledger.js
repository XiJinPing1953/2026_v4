import { callCloud } from '@/services/api'

export async function getTrialBalanceV1(params) {
	return callCloud('crm-ledger', {
		action: 'trialBalanceV1',
		data: {
			period: params.period || '',
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || '',
			limit: params.limit || 2000
		}
	})
}

export async function getGeneralLedgerV1(params) {
	return callCloud('crm-ledger', {
		action: 'generalLedgerV1',
		data: {
			account_code: params.account_code || params.accountCode || '',
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || '',
			page: params.page || 1,
			pageSize: params.pageSize || params.limit || 50
		}
	})
}

export async function getSubLedgerV1(params) {
	return callCloud('crm-ledger', {
		action: 'subLedgerV1',
		data: {
			account_code: params.account_code || params.accountCode || '',
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || '',
			page: params.page || 1,
			pageSize: params.pageSize || params.limit || 50
		}
	})
}

export async function getReceivableDetailV1(params) {
	return callCloud('crm-ledger', {
		action: 'receivableDetailV1',
		data: {
			keyword: params.keyword || '',
			customer_id: params.customer_id || params.customerId || '',
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || '',
			page: params.page || 1,
			pageSize: params.pageSize || 50
		}
	})
}
