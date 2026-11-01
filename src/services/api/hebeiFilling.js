import { callCloud } from '@/services/api'

export const getHebeiDailyTemperature = (options = {}) => callCloud('crm-hebei-filling', { action: 'getDailyTemperatureV1', data: {}, timeout: 12000, isResponseCurrent: options.isResponseCurrent })
export const setHebeiDailyTemperature = (data, options = {}) => callCloud('crm-hebei-filling', { action: 'setDailyTemperatureV1', data, timeout: 12000, isResponseCurrent: options.isResponseCurrent })
export const getHebeiFillingStatus = (filling_id, options = {}) => callCloud('crm-hebei-filling', { action: 'getFillingStatusV1', data: {filling_id}, timeout: 12000, isResponseCurrent: options.isResponseCurrent })
