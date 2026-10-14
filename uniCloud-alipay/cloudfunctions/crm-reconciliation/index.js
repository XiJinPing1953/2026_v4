'use strict'
const { readComplete } = require('./financialReadLocal')
const { hasPagePermission } = require('./pageAclLocal')
const { createService } = require('./service')
const first = response => Array.isArray(response?.data) ? response.data[0] : response?.data
const READS = new Set(['contextV1', 'getBatchV1', 'downloadSourceV1', 'repairSourcesV1', 'repairStatusV1'])
// Alipay allows 180 s per request. Keep one deadline across all nested calls,
// leaving time to save an incomplete result and return before the platform stops us.
function createInvoker(event, callFunction, startedAt, now = Date.now) {
  return async (name, action, data) => {
    const timeout = Math.min(60000, 170000 - (now() - startedAt))
    if (timeout < 1000) throw Object.assign(Error('本次读取时间不足，请按原操作继续核查'), { code: 409, retryable: true, before_dispatch: true })
    let response
    try { response = await callFunction({ name, timeout, data: { action, data, token: event.token, request_id: event.request_id } }) }
    catch (error) { throw Object.assign(error, { transport_error: true, retryable: true }) }
    const result = response.result || response
    if (result.code !== 0) throw Object.assign(Error(result.msg || '关联账务读取未完成'), { code: result.code, details: result.data,
      transport_error: /timeout|timed out|network|socket|超时|网络|连接中断/i.test(result.msg || '') })
    return result.data
  }
}
exports.main = async (event = {}) => {
  const startedAt = Date.now()
  try {
    const db = uniCloud.database()
    if (typeof event.token !== 'string' || !event.token.trim()) return { code: 401, msg: '请先登录' }
    const user = first(await db.collection('crm_users').where({ token: event.token }).limit(1).get())
    if (!user) return { code: 401, msg: '登录已过期' }
    if (!['finance', 'admin', 'superadmin'].includes(user.role) || !hasPagePermission(user, '/pages/accounting/reconciliation-center', READS.has(event.action) ? 'view' : 'update')) return { code: 403, msg: '需要对账中心财务权限' }
    const invoke = createInvoker(event, options => uniCloud.callFunction(options), startedAt)
    return { code: 0, data: await createService({ db, readComplete, invoke }).run(event.action, event.data || {}, user) }
  } catch (error) { return { code: [400, 401, 403, 404, 409].includes(error.code) ? error.code : 409, msg: error.message || '对账未完成', data: error.details || {} } }
}
exports.createInvoker = createInvoker
