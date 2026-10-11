import { callCloud } from '@/services/api'

export function getFillingClosureV1(params = {}) {
	return callCloud('crm-bottle-movement', {
		action: 'fillingClosureV1', timeout: 65000,
		data: {
			dateStart: params.dateStart, dateEnd: params.dateEnd, cutoffDay: params.cutoffDay,
			bottle_no: params.bottle_no || '', status: params.status || '',
			page: params.page || 1, pageSize: params.pageSize || 20
		}
	})
}

export function getTankBeforeFillingV1(day) {
	return callCloud('crm-bottle-movement', {
		action: 'tankBeforeFillingV1', timeout: 65000,
		data: { day }
	})
}

export function getTruckQuantityClosureV1(params = {}) {
	return callCloud('crm-bottle-movement', {
		action: 'truckQuantityClosureV1', timeout: 65000,
		data: { dateStart: params.dateStart || '', dateEnd: params.dateEnd, cutoffDay: params.cutoffDay }
	})
}
