import { callCloud } from '@/services/api'

export async function searchBottlesV1(params) {
	const data = {
		keyword: params.keyword || '',
		status: params.status || '',
		page: params.page || 1,
		pageSize: params.pageSize || params.limit || 20
	}
	if (params.is_active != null) data.is_active = params.is_active
	else if (params.isActive != null) data.is_active = params.isActive
	data.bottle_no_mode = params.bottle_no_mode || params.bottleNoMode || 'all'
	if ((data.bottle_no_mode || '').toLowerCase() === 'prefix') {
		data.bottle_no_prefix = params.bottle_no_prefix ?? params.bottleNoPrefix ?? ''
	}
	if (params.bottle_no_numeric_start != null) data.bottle_no_numeric_start = params.bottle_no_numeric_start
	else if (params.bottleNoNumericStart != null) data.bottle_no_numeric_start = params.bottleNoNumericStart
	if (params.bottle_no_numeric_end != null) data.bottle_no_numeric_end = params.bottle_no_numeric_end
	else if (params.bottleNoNumericEnd != null) data.bottle_no_numeric_end = params.bottleNoNumericEnd
	if (params.bottle_check_date_eq != null) data.bottle_check_date_eq = params.bottle_check_date_eq
	else if (params.bottleCheckDateEq != null) data.bottle_check_date_eq = params.bottleCheckDateEq
	if (params.bottle_next_check_date_eq != null) data.bottle_next_check_date_eq = params.bottle_next_check_date_eq
	else if (params.bottleNextCheckDateEq != null) data.bottle_next_check_date_eq = params.bottleNextCheckDateEq
	if (params.gauge_check_date_eq != null) data.gauge_check_date_eq = params.gauge_check_date_eq
	else if (params.gaugeCheckDateEq != null) data.gauge_check_date_eq = params.gaugeCheckDateEq
	if (params.gauge_next_check_date_eq != null) data.gauge_next_check_date_eq = params.gauge_next_check_date_eq
	else if (params.gaugeNextCheckDateEq != null) data.gauge_next_check_date_eq = params.gaugeNextCheckDateEq
	if (params.valve_check_date_eq != null) data.valve_check_date_eq = params.valve_check_date_eq
	else if (params.valveCheckDateEq != null) data.valve_check_date_eq = params.valveCheckDateEq
	if (params.valve_next_check_date_eq != null) data.valve_next_check_date_eq = params.valve_next_check_date_eq
	else if (params.valveNextCheckDateEq != null) data.valve_next_check_date_eq = params.valveNextCheckDateEq
	if (params.inspection_due_module != null) data.inspection_due_module = params.inspection_due_module
	else if (params.inspectionDueModule != null) data.inspection_due_module = params.inspectionDueModule
	if (params.inspection_due_state != null) data.inspection_due_state = params.inspection_due_state
	else if (params.inspectionDueState != null) data.inspection_due_state = params.inspectionDueState

	return callCloud('crm-bottle', {
		action: 'listV1',
		data
	})
}

export async function getBottleV1(params) {
	return callCloud('crm-bottle', {
		action: 'getV1',
		data: { _id: params._id || params.id || '' }
	})
}

export async function createBottleV1(data) {
	return callCloud('crm-bottle', {
		action: 'createV1',
		data
	})
}

export async function updateBottleV1(data) {
	return callCloud('crm-bottle', {
		action: 'updateV1',
		data
	})
}

export async function auditBottleUniqueFieldsV1(params = {}) {
	return callCloud('crm-bottle', {
		action: 'auditUniqueFieldsV1',
		data: {
			sampleLimit: params.sampleLimit || 20
		}
	})
}

export async function batchUpdateInspectionV1(data = {}) {
	return callCloud('crm-bottle', {
		action: 'batchUpdateInspectionV1',
		data
	})
}

export async function backfillBottleSortKeysV1(data = {}) {
	return callCloud('crm-bottle', {
		action: 'backfillBottleSortKeysV1',
		data
	})
}
