import { callCloud } from './callCloud'

export function dispatchRequest(action, data = {}) {
  return callCloud('crm-user', { action, data, timeout: 60000 })
}
