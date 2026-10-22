import { callCloud } from '@/services/api'
export const FILLING_LABEL_ORIGIN = 'https://env-00jxuffegf2n-static.normal.cloudstatic.cn'
export function parseFillingLabel(value) {
 const text = String(value || '').trim(), prefix = `${FILLING_LABEL_ORIGIN}/#/pages/public/filling-label?`
 if (!text.startsWith(prefix)) return null
 const values = Object.fromEntries(text.slice(prefix.length).split('&').map(pair => { const i = pair.indexOf('='); return [pair.slice(0,i), decodeURIComponent(pair.slice(i+1))] }))
 if (values.c !== '新拓能源' || !/^[a-f0-9]{48}$/.test(values.t || '') || !/^[A-Za-z0-9_-]{1,48}$/.test(values.b || '') || ['p','g','n'].some(k => !/^\d+(\.\d)?$/.test(values[k] || ''))) throw new Error('充装二维码不完整，请重新扫描')
 return { token:values.t, bottle_no:values.b, tare_weight:Number(values.p), gross_weight:Number(values.g), net_weight:Number(values.n) }
}
export const issueFillingLabel = data => callCloud('crm-filling', { action:'issueFillingLabelV1', data })
export const resolveFillingLabel = data => callCloud('crm-filling', { action:'resolveFillingLabelV1', data })
export const getPublicFillingLabel = token => callCloud('crm-filling', { action:'getPublicFillingLabelV1', token:'', data:{ token } })
