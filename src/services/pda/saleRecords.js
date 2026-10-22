import { callCloud } from '@/services/api'
import { getToken, getUser } from '@/services/auth'
function read(action, data, { shouldContinue = () => true } = {}) {
 const owner = getUser()?._id, token = getToken() || ''
 const current = () => shouldContinue() && owner === getUser()?._id && token === (getToken() || '')
 if (!current()) return Promise.resolve({ code: 499, msg: '查询已取消' })
 return callCloud('crm-sale', { action, data, token, isResponseCurrent: current })
}
export const listPdaSales = (data, options) => read('listPdaV1', data, options)
export const getPdaSale = (id, options) => read('getPdaV1', { id }, options)
