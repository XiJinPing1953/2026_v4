import { callCloud } from '@/services/api'

async function call(action, data = {}) {
  const response = await callCloud('crm-safety-management', { action, data, timeout: 180000 })
  if (response?.code !== 0) { const error = new Error(response?.msg || response?.message || '安全管理服务暂不可用'); error.code = response?.code; throw error }
  return response.data
}
export const getSafetyConfig = (data) => call('getConfigV1', data)
export const saveSafetyConfig = (data) => call('saveConfigV1', data)
export const getSafetyDaily = (data) => call('getDailyV1', data)
export const listSafetyDaily = (data) => call('listDailyV1', data)
export const saveSafetySupplement = (data) => call('saveSupplementV1', data)
export const confirmSafetyDaily = (data) => call('confirmDailyV1', data)
export const getSafetyWeekly = (data) => call('getWeeklyV1', data)
export const saveSafetyWeekly = (data) => call('saveWeeklyV1', data)
export const getSafetyMonthly = (data) => call('getMonthlyV1', data)
export const saveSafetyMonthly = (data) => call('saveMonthlyV1', data)
export const registerSafetyIssue = (data) => call('registerIssueV1', data)
export const exportSafetyDocument = (data) => call('exportV1', data)
export const listSafetyRevisions = (data) => call('listRevisionsV1', data)
