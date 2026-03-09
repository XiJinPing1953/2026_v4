import { callCloud } from '@/services/api'

export async function listBottleMovementsV1(params) {
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		type: params.type || '',
		source_type: params.source_type || params.sourceType || '',
		dateStart: params.dateStart || '',
		dateEnd: params.dateEnd || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 100
	}
	return callCloud('crm-bottle-movement', {
		action: 'listV1',
		data
	})
}

export async function createBottleMovementV1(data) {
	return callCloud('crm-bottle-movement', {
		action: 'createV1',
		data
	})
}

export async function getBottleMovementTimelineV1(params) {
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		limit: params.limit || 1000
	}
	return callCloud('crm-bottle-movement', {
		action: 'timelineV1',
		data
	})
}

export async function getBottleLossStatsV1(params = {}) {
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		dateStart: params.dateStart || '',
		dateEnd: params.dateEnd || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 50
	}
	return callCloud('crm-bottle-movement', {
		action: 'lossStatsV1',
		data
	})
}

export async function getBottleCycleLossV1(params = {}) {
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		dateStart: params.dateStart || '',
		dateEnd: params.dateEnd || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 50
	}
	return callCloud('crm-bottle-movement', {
		action: 'cycleLossV1',
		data
	})
}
