import { callCloud } from '@/services/api'

export async function listFillingsV1(params) {
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		operator: params.operator || '',
		record_type: params.record_type || params.recordType || '',
		sale_state: params.sale_state || params.saleState || params.sale_status || params.saleStatus || '',
		for_export: Boolean(params.for_export ?? params.forExport ?? params.exporting),
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

export async function createFillingV1(data, options = {}) {
	const payload = { ...(data || {}) }
	if (options.ignoreBottleFlowWarning || payload.ignoreBottleFlowWarning) {
		payload.ignore_bottle_flow_warning = true
		delete payload.ignoreBottleFlowWarning
	}
	return callCloud('crm-filling', {
		action: 'createV1',
		data: payload
	})
}

export async function resolveFillingFillWeightV1(params = {}) {
	return callCloud('crm-filling', {
		action: 'resolveFillWeightV1',
		data: {
			date: params.date || '',
			record_type: params.record_type || params.recordType || '',
			bottle_no: params.bottle_no || params.bottleNo || params.identifier || '',
			after_fill_total_weight: params.after_fill_total_weight ?? params.afterFillTotalWeight
		}
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
	const ignoreBottleFlowWarning = Boolean(params.ignoreBottleFlowWarning)
	return callCloud('crm-filling', {
		action: 'updateV1',
		data: {
			_id: recordId,
			date: params.date,
			bottle_no: params.bottle_no || params.bottleNo,
			record_type: params.record_type || params.recordType,
			operator: params.operator,
			operator_id: params.operator_id || params.operatorId,
			fill_weight: params.fill_weight ?? params.fillWeight,
			remark: params.remark,
			...(ignoreBottleFlowWarning ? { ignore_bottle_flow_warning: true } : {})
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

export async function batchUpdateFillingDateV1(params = {}) {
	const scopeMode = params.scope_mode || params.scopeMode || 'ids'
	const selector = params.selector && typeof params.selector === 'object' ? params.selector : {}
	return callCloud('crm-filling', {
		action: 'batchUpdateDateV1',
		data: {
			preview: Boolean(params.preview),
			scope_mode: scopeMode,
			selector,
			new_date: params.new_date || params.newDate || ''
		}
	})
}

export async function batchCreateFillingsV1(params = {}) {
	return callCloud('crm-filling', {
		action: 'batchCreateV1',
		data: {
			preview: Boolean(params.preview),
			date: params.date || '',
			record_type: params.record_type || params.recordType || '',
			input_mode: params.input_mode || params.inputMode || '',
			operator: params.operator || '',
			operator_id: params.operator_id || params.operatorId || '',
			remark: params.remark || '',
			default_fill_weight: params.default_fill_weight ?? params.defaultFillWeight ?? '',
			batch_text: params.batch_text ?? params.batchText ?? '',
			...(params.ignoreBottleFlowWarning ? { ignore_bottle_flow_warning: true } : {})
		}
	})
}
