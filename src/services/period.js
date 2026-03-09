import { callCloud } from '@/services/api'

export async function listPeriodsV1() {
	return callCloud('crm-period', {
		action: 'listV1',
		data: {}
	})
}

export async function createPeriodV1(data) {
	return callCloud('crm-period', {
		action: 'createV1',
		data
	})
}

export async function closePeriodV1(data) {
	return callCloud('crm-period', {
		action: 'closeV1',
		data
	})
}

export async function reopenPeriodV1(data) {
	return callCloud('crm-period', {
		action: 'reopenV1',
		data
	})
}
