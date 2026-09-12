'use strict'
const M = require('./depositModel')
const R = require('./report')
const T = require('./transaction')
const { ensureActionAcl, isSuperAdmin } = require('./pageAclLocal')
const db = uniCloud.database()
const RULES = Object.fromEntries(['getDepositStatementV1', 'previewDepositEntryV1', 'createDepositEntryV1', 'voidDepositEntryV1', 'getDepositOperationV1']
  .map(action => [action, [{ pagePath: '/pages/customer/statement', action: ['createDepositEntryV1', 'voidDepositEntryV1'].includes(action) ? 'update' : 'view' }]]))

async function inspectStorage() {
  const collections = []
  let names = null, metadataError = ''
  if (typeof db.listCollections === 'function') {
    try { names = await db.listCollections() } catch (error) { metadataError = String(error.message) }
  }
  for (const name of [M.TABLES.accounts, M.TABLES.entries]) {
    const collection = db.collection(name), result = { name, exists: null, existence_verified: false,
      count_available: false, count: null, index_query_available: false, indexes: null }
    try {
      const count = await collection.count()
      if (!Number.isSafeInteger(Number(count.total)) || Number(count.total) < 0) throw Error('count unavailable')
      result.count = Number(count.total); result.count_available = true
      // Zero query results do not prove collection existence on every provider.
      if (result.count > 0) { result.exists = true; result.existence_verified = true }
    } catch (error) { result.count_error = String(error.message) }
    if (names) {
      const rows = Array.isArray(names) ? names : names.collections || names.data
      if (Array.isArray(rows)) { result.exists = rows.some(row => (typeof row === 'string' ? row : row.name || row.collectionName) === name); result.existence_verified = true }
    }
    const indexMethod = ['listIndexes', 'getIndexes'].find(method => typeof collection[method] === 'function')
    if (indexMethod) {
      try { result.indexes = await collection[indexMethod](); result.index_query_available = true }
      catch (error) { result.index_error = String(error.message) }
    }
    collections.push(result)
  }
  return { rule_version: M.RULE_VERSION, collections, metadata_query_available: Boolean(names), metadata_error: metadataError,
    note: '数量为0不等于已证明集合存在；SDK不能枚举结构时须以同环境控制台或明确结构上传回执核对。' }
}

exports.main = async (event = {}) => {
  try {
    const { action, token, data = {} } = event
    if (!Object.prototype.hasOwnProperty.call(RULES, action) && action !== 'inspectDepositStorageV1') M.fail('未知押金操作', 400)
    if (typeof token !== 'string' || !token.trim()) M.fail('未登录或登录已过期', 401)
    const user = R.first(await db.collection('crm_users').where({ token }).limit(1).get())
    if (!user || user.is_disabled === true || ['disabled', 'inactive', 'deleted'].includes(user.status)) M.fail('未登录或账号不可用', 401)
    if (action === 'inspectDepositStorageV1') {
      if (!isSuperAdmin(user)) M.fail('仅超级管理员可核验押金存储结构', 403)
      return { code: 0, data: await inspectStorage() }
    }
    const acl = await ensureActionAcl(user, action, RULES, [], { cloudFunction: 'crm-customer-deposit' })
    if (!acl.ok) M.fail(acl.msg, acl.code || 403)
    if (data.rehearse !== undefined && typeof data.rehearse !== 'boolean') M.fail('事务演练参数无效', 400)
    if (data.rehearse && !isSuperAdmin(user)) M.fail('仅超级管理员可执行回滚演练', 403)
    if (data.rehearsal_seed_amount !== undefined && (!data.rehearse || !isSuperAdmin(user) || action !== 'createDepositEntryV1')) M.fail('临时演练期初仅限超级管理员创建事务回滚演练', 403)
    if (data.fail_after_writes !== undefined && (!data.rehearse || !Number.isInteger(data.fail_after_writes) || data.fail_after_writes < 0 || data.fail_after_writes > 100)) M.fail('事务故障注入仅用于授权回滚演练', 400)
    const customerId = M.customerId(data.customer_id)
    if (action === 'getDepositStatementV1') return { code: 0, data: await R.readDepositStatement(db, customerId, { dateFrom: data.date_from, dateTo: data.date_to }) }
    const snapshot = await R.readDepositSnapshot(db, customerId)
    if (action === 'getDepositOperationV1') {
      const operationId = M.operationId(data.operation_id), row = snapshot.entries.find(item => item._id === M.entryId(customerId, operationId))
      return { code: 0, data: row ? { found: true, ...T.savedResult(row, snapshot) } : { found: false, customer_id: customerId, operation_id: operationId } }
    }
    const isVoid = action === 'voidDepositEntryV1' || action === 'previewDepositEntryV1' && data.entry_id !== undefined
    const input = isVoid ? M.normalizeVoid(data) : M.normalizeCreate(data)
    const original = isVoid ? snapshot.entries.find(row => row._id === input.command.entry_id) : null
    if (input.command.kind === 'opening' || original?.kind === 'opening') {
      if (!isSuperAdmin(user) && !['admin', 'finance'].includes(String(user.role_template || user.role))) M.fail('期初押金登记或作废仅限管理员及财务', 403)
    }
    const duplicate = T.findDuplicate(snapshot, input)
    if (duplicate) return { code: 0, data: duplicate, msg: '该操作已登记，已返回原结果' }
    const prepared = await T.prepare(db, snapshot, input, user, { rehearsalSeedAmount: data.rehearsal_seed_amount })
    if (action === 'previewDepositEntryV1') {
      const { action: commandAction, amount_cents, ...command } = input.command
      return { code: 0, data: { rule_version: M.RULE_VERSION, money_scale: 2, customer_id: customerId,
        before_balance: prepared.change.before_balance, after_balance: prepared.change.after_balance, current_version: snapshot.version,
        submission: { ...command, ...(amount_cents !== undefined ? { amount: amount_cents / 100 } : {}),
          operation_id: input.operation_id, expected_version: snapshot.version } } }
    }
    return { code: 0, data: await T.execute(db, prepared, { rehearse: data.rehearse === true, failAfterWrites: data.fail_after_writes || 0 }) }
  } catch (error) {
    const code = [400, 401, 403, 409].includes(error.code) ? error.code : 409
    return { code, msg: error.message || '押金处理未完成，请查询原操作号后重试', error_code: typeof error.code === 'string' ? error.code : 'DEPOSIT_OPERATION_REJECTED',
      data: { read_complete: false, ...(error.details || {}) } }
  }
}
