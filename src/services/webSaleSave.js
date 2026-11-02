import { getUser } from '@/services/auth'
import { callCloud } from '@/services/api'
import { createWebSaleRecovery } from '@/services/models/webSaleRecovery'

export const webSaleRecovery = createWebSaleRecovery({
  storage: { get: key => uni.getStorageSync(key), set: (key, value) => uni.setStorageSync(key, value), remove: key => uni.removeStorageSync(key) },
  actor: () => String(getUser()?._id || ''),
  makeId: () => `websale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
  call: (action, data) => callCloud('crm-sale', { action, data, timeout: action === 'saveWebV1' ? 65000 : 15000 })
})
