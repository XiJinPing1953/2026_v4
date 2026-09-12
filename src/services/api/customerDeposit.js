import { callCloud } from './callCloud'

const FUNCTION_NAME = 'crm-customer-deposit'

function invoke(action, data) {
	return callCloud(FUNCTION_NAME, { action, data, timeout: 30000 })
}

export function getDepositStatementV1(params = {}) {
	return invoke('getDepositStatementV1', {
		customer_id: params.customer_id || params.customerId || '',
		date_from: params.date_from ?? params.dateFrom ?? '',
		date_to: params.date_to ?? params.dateTo ?? ''
	})
}

export function previewDepositEntryV1(params = {}) {
	return invoke('previewDepositEntryV1', { ...params })
}

export function createDepositEntryV1(params = {}) {
	return invoke('createDepositEntryV1', { ...params })
}

export function voidDepositEntryV1(params = {}) {
	return invoke('voidDepositEntryV1', { ...params })
}

export function getDepositOperationV1(params = {}) {
	return invoke('getDepositOperationV1', {
		customer_id: params.customer_id || params.customerId || '',
		operation_id: params.operation_id || params.operationId || ''
	})
}
