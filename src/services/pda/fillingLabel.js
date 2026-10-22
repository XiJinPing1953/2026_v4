import { callCloud } from '@/services/api'
import { getToken, getUser } from '@/services/auth'
export const FILLING_LABEL_ORIGIN = 'https://env-00jxuffegf2n-static.normal.cloudstatic.cn'
export function parseFillingLabel(value) {
 const text = String(value || '').trim(), prefix = `${FILLING_LABEL_ORIGIN}/#/pages/public/filling-label?`
 if (!text.startsWith(prefix)) return null
 const values = Object.fromEntries(text.slice(prefix.length).split('&').map(pair => { const i = pair.indexOf('='); return [pair.slice(0,i), decodeURIComponent(pair.slice(i+1))] }))
 if (values.c !== '新拓能源' || !/^[a-f0-9]{48}$/.test(values.t || '') || !/^[A-Za-z0-9_-]{1,48}$/.test(values.b || '') || ['p','g','n'].some(k => !/^\d+(\.\d)?$/.test(values[k] || ''))) throw new Error('充装二维码不完整，请重新扫描')
 return { token:values.t, bottle_no:values.b, tare_weight:Number(values.p), gross_weight:Number(values.g), net_weight:Number(values.n) }
}
function scopedRequest(action, data, { shouldContinue = () => true } = {}) {
 const owner = getUser()?._id, token = getToken() || ''
 const current = () => shouldContinue() && owner === getUser()?._id && token === (getToken() || '')
 if (!current()) return Promise.resolve({ code: 499, msg: '查询已取消' })
 return callCloud('crm-filling', { action, data, token, isResponseCurrent: current })
}
export const issueFillingLabel = (data, options) => scopedRequest('issueFillingLabelV1', data, options)
export const resolveFillingLabel = (data, options) => scopedRequest('resolveFillingLabelV1', data, options)
export const getPublicFillingLabel = token => callCloud('crm-filling', { action:'getPublicFillingLabelV1', token:'', data:{ token } })
