import { callCloud } from '@/services/api'
export const listPdaSales = data => callCloud('crm-sale', { action: 'listPdaV1', data })
export const getPdaSale = id => callCloud('crm-sale', { action: 'getPdaV1', data: { id } })
