import { callCloud } from '@/services/api'

export async function listGasInV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'listV1',
		data: {
			keyword: params.keyword || '',
			plate_no: params.plate_no || params.plateNo || '',
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || '',
			inventory_as_of: params.inventory_as_of || params.inventoryAsOf || '',
			page: params.page || 1,
			pageSize: params.pageSize || params.limit || 50
		}
	})
}

export async function getCurrentGasInventoryV1() {
	return callCloud('crm-gas-in', {
		action: 'getCurrentInventoryV1',
		data: {}
	})
}

export async function getGasInV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'getV1',
		data: {
			_id: params._id || params.id || ''
		}
	})
}

export async function createGasInV1(data = {}) {
	return callCloud('crm-gas-in', {
		action: 'createV1',
		data
	})
}

export async function updateGasInV1(params = {}) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	return callCloud('crm-gas-in', {
		action: 'updateV1',
		data: {
			_id: recordId,
			...params
		}
	})
}

export async function removeGasInV1(params = {}) {
	const recordId = params._id || params.id || params.recordId || ''
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	return callCloud('crm-gas-in', {
		action: 'removeV1',
		data: {
			_id: recordId
		}
	})
}

export async function getGasTankConfigV1() {
	return callCloud('crm-gas-in', {
		action: 'getTankConfigV1',
		data: {}
	})
}

export async function updateGasTankConfigV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'updateTankConfigV1',
		data: {
			full_tank_weight_t: params.full_tank_weight_t ?? params.fullTankWeightT ?? 0
		}
	})
}

export async function previewGasInventoryPeriodV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'previewInventoryPeriodV1',
		data: {
			cutoff_day: params.cutoff_day || params.cutoffDay || '2026-08-12',
			opening_tank_t: params.opening_tank_t ?? params.openingTankT ?? 0,
			reason: params.reason || ''
		}
	})
}

export async function activateGasInventoryPeriodV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'activateInventoryPeriodV1',
		data: {
			cutoff_day: params.cutoff_day || params.cutoffDay || '2026-08-12',
			opening_tank_t: params.opening_tank_t ?? params.openingTankT ?? 0,
			reason: params.reason || ''
		}
	})
}

export async function listGasInventoryPeriodsV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'listInventoryPeriodsV1',
		data: {
			page: params.page || 1,
			pageSize: params.pageSize || params.limit || 20
		}
	})
}

export async function syncGasCycleAdjustmentsV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'syncCycleAdjustmentsV1',
		data: {
			preview: params.preview !== false,
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || ''
		},
		timeout: params.timeout || 60000
	})
}

export async function rebuildGasInventoryV1(params = {}) {
	return callCloud('crm-gas-in', {
		action: 'rebuildInventoryV1',
		data: {
			preview: params.preview !== false,
			include_cycle_adjust: params.include_cycle_adjust !== false,
			backup_before_rebuild: params.backup_before_rebuild === true,
			dateStart: params.dateStart || '',
			dateEnd: params.dateEnd || '',
			run_id: params.run_id || params.runId || ''
		},
		timeout: params.timeout || 120000
	})
}

export async function restoreGasInventoryV1(params = {}) {
	const runId = params.run_id || params.runId || ''
	if (!runId) return { code: 400, msg: 'run_id 必填' }
	return callCloud('crm-gas-in', {
		action: 'restoreInventoryV1',
		data: {
			run_id: runId
		}
	})
}
