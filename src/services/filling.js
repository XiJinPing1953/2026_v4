import { callCloud } from '@/services/api'

export async function listFillingsV1(params) {
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		dateStart: params.dateStart || '',
		dateEnd: params.dateEnd || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 50
	}
	return callCloud('crm-filling', {
		action: 'listV1',
		data
	})
}

export async function createFillingV1(data) {
	return callCloud('crm-filling', {
		action: 'createV1',
		data
	})
}

export async function getFillingV1(params = {}) {
	return callCloud('crm-filling', {
		action: 'getV1',
		data: {
			_id: params._id || params.id || ''
		}
	})
}

export async function updateFillingV1(params = {}) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	return callCloud('crm-filling', {
		action: 'updateV1',
		data: {
			_id: recordId,
			date: params.date,
			bottle_no: params.bottle_no || params.bottleNo,
			fill_weight: params.fill_weight ?? params.fillWeight,
			address: params.address,
			remark: params.remark
		}
	})
}

export async function removeFillingV1(params = {}) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	return callCloud('crm-filling', {
		action: 'removeV1',
		data: {
			_id: recordId
		}
	})
}
