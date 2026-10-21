import { callCloud } from '@/services/api'
import { getToken } from '@/services/auth'
import { submitBatchFillingOperation, getFillingOperationV1, retryFillingOperationV1 } from '@/services/fillingOperations'

export const previewReweighV1 = (data) => callCloud('crm-filling', { action: 'previewReweighV1', data })
export const createReweighV1 = (data) => submitBatchFillingOperation(data, 'createReweighV1')
export const correctReweighV1 = (data) => submitBatchFillingOperation(data, 'correctReweighV1')
export const getReweighOperationV1 = getFillingOperationV1
export const retryReweighOperationV1 = retryFillingOperationV1

export const getReturnReweighRoundV1 = () => callCloud('crm-filling', { action: 'getReturnReweighRoundV1', data: {} })
export const startReturnReweighRoundV1 = (data) => callCloud('crm-filling', { action: 'startReturnReweighRoundV1', data })
export const previewReturnReweighV1 = (data) => callCloud('crm-filling', { action: 'previewReturnReweighV1', data })
export const saveReturnReweighV1 = (data) => callCloud('crm-filling', { action: 'saveReturnReweighV1', data })
export const getReturnReweighV1 = (operation_id) => callCloud('crm-filling', { action: 'getReturnReweighV1', data: { operation_id } })

// Only these read-only queries tolerate a briefly stale cloud instance after deployment.
async function listReweighRecords(action, data, { shouldContinue = () => true } = {}) {
 const token = getToken() || ''
 const retryDelays = [200, 500]
 for (let attempt = 0; ; attempt += 1) {
  if (!shouldContinue()) return { code: 499, msg: '复秤查询已取消' }
  const result = await callCloud('crm-filling', { action, data, token, isResponseCurrent: shouldContinue })
  if (!shouldContinue()) return { code: 499, msg: '复秤查询已取消' }
  if (result?.code !== 400 || !/^未知\s*action$/i.test(String(result.msg || ''))) return result
  if (attempt >= retryDelays.length) return { ...result, msg: '复秤查询服务暂未同步，请稍后重试' }
  await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
 }
}

export const listReturnReweighRecordsV1 = (data, options) => listReweighRecords('listReturnReweighRecordsV1', data, options)
export const listFillingReweighRecordsV1 = (data, options) => listReweighRecords('listFillingReweighRecordsV1', data, options)
export const listReturnReweighRoundRecordsV1 = (data, options) => listReweighRecords('listReturnReweighRoundRecordsV1', data, options)
