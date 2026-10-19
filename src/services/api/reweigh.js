import { callCloud } from '@/services/api'
import { submitBatchFillingOperation, getFillingOperationV1, retryFillingOperationV1 } from '@/services/fillingOperations'

export const previewReweighV1 = (data) => callCloud('crm-filling', { action: 'previewReweighV1', data })
export const createReweighV1 = (data) => submitBatchFillingOperation(data, 'createReweighV1')
export const correctReweighV1 = (data) => submitBatchFillingOperation(data, 'correctReweighV1')
export const getReweighOperationV1 = getFillingOperationV1
export const retryReweighOperationV1 = retryFillingOperationV1
