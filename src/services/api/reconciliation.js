import { callCloud } from './callCloud'

const invoke = (action, data = {}) => callCloud('crm-reconciliation', { action, data, timeout: 60000 })

export const reconciliationApi = {
	context: data => invoke('contextV1', data),
	importBatch: data => invoke('importBatchV1', data),
	getBatch: data => invoke('getBatchV1', data),
	saveMapping: data => invoke('saveMappingV1', data),
	checkCustomer: data => invoke('checkCustomerV1', data),
	importDetail: data => invoke('importDetailV1', data),
	reviewCustomer: data => invoke('reviewCustomerV1', data),
	downloadSource: data => invoke('downloadSourceV1', data),
	repairSources: data => invoke('repairSourcesV1', data),
	prepareRepair: data => invoke('prepareRepairV1', data),
	executeRepair: data => invoke('executeRepairV1', data),
	repairStatus: data => invoke('repairStatusV1', data)
}
