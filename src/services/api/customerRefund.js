import { callCloud } from '@/services/api'
export const refundAction = (action, data) => callCloud('crm-customer-settlement', { action, data })
