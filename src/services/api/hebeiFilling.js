import { callCloud } from '@/services/api'

export const getHebeiDailyTemperature = () => callCloud('crm-hebei-filling', { action: 'getDailyTemperatureV1', data: {}, timeout: 12000 })
export const setHebeiDailyTemperature = data => callCloud('crm-hebei-filling', { action: 'setDailyTemperatureV1', data, timeout: 12000 })
export const getHebeiFillingStatus = filling_id => callCloud('crm-hebei-filling', { action: 'getFillingStatusV1', data: {filling_id}, timeout: 12000 })
