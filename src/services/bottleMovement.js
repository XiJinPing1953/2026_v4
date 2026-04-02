import { callCloud } from '@/services/api'

function normalizeLossResultType(value) {
	const text = String(value || '').trim().toLowerCase()
	if (text === 'loss' || text === 'swell' || text === 'exact') return text
	return ''
}

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
		customer_name: params.customer_name || params.customerName || '',
		dateStart: params.dateStart || '',
		dateEnd: params.dateEnd || '',
		result_type: normalizeLossResultType(params.result_type || params.resultType),
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
		customer_name: params.customer_name || params.customerName || '',
		dateStart: params.dateStart || '',
		dateEnd: params.dateEnd || '',
		result_type: normalizeLossResultType(params.result_type || params.resultType),
		include_incomplete_list: Boolean(params.include_incomplete_list || params.includeIncompleteList),
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 50
	}
	return callCloud('crm-bottle-movement', {
		action: 'cycleLossV1',
		data
	})
}
