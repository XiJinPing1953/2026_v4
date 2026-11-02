// Persist the exact request before sending. A missing query result is not proof
// that a concurrent original request cannot still commit; retries keep its ID.
const clone = value => JSON.parse(JSON.stringify(value))
export function createWebSaleRecovery({ storage, actor, call, makeId }) {
  const key = scope => `crm_web_sale_save_v1:${actor()}:${scope || 'new'}`
  function read(scope) {
    const value = storage.get(key(scope))
    if (!value) return null
    const row = typeof value === 'string' ? JSON.parse(value) : clone(value)
    if (row.version !== 1 || row.actor !== actor() || row.scope !== (scope || 'new') || !row.operation_id || !row.payload || !row.action) throw new Error('上次保存恢复资料不完整，请核对原单；暂不能重新提交')
    return row
  }
  function persist(scope, row) {
    storage.set(key(scope), clone(row))
    const back = read(scope)
    if (!back || JSON.stringify(back) !== JSON.stringify(row)) throw new Error('无法可靠保存操作号，尚未发送销售请求')
  }
  const unknown = () => ({ code: 503, msg: '保存结果暂未确认，已保留原内容。请使用“查询并继续原保存”，不要重新录入。', data: { source_saved: null } })
  async function accept(scope, row, result) {
    if (row.actor !== actor()) return { code: 499, msg: '账号已变化，原结果保留在原账号下' }
    if (result?.code === 0) {
      if (result.data?.source_saved !== true || result.data.operation_id !== row.operation_id || !result.data.sale_id || result.data.protocol !== 'web-sale-save/1') return unknown()
      // A failed local acknowledgement must not turn a known committed sale into a failure.
      try { persist(scope, { ...row, result: clone(result) }) } catch (_) { /* original pending receipt remains */ }
      return result
    }
    if (result?.data?.source_saved === false && result.code >= 400 && result.code < 500) {
      storage.remove(key(scope))
      return result
    }
    return result?.data?.source_saved === false ? result : unknown()
  }
  async function query(scope) {
    const row = read(scope)
    if (!row) return { code: 404, msg: '没有待确认的保存' }
    if (row.result) return row.result
    try { return await accept(scope, row, await call('getWebSaveResultV1', { operation_id: row.operation_id })) } catch (_) { return unknown() }
  }
  async function send(scope, row) {
    try {
      return await accept(scope, row, await call('saveWebV1', { operation_id: row.operation_id, save_action: row.action, payload: clone(row.payload) }))
    } catch (_) { return query(scope) }
  }
  async function submit(scope, action, payload) {
    if (!actor()) throw new Error('请先登录')
    const previous = read(scope)
    if (previous) return query(scope)
    const row = { version: 1, actor: actor(), scope: scope || 'new', operation_id: makeId(), action, payload: clone(payload), created_at: Date.now() }
    persist(scope, row)
    return send(scope, row)
  }
  async function resume(scope) {
    const row = read(scope)
    if (!row) return { code: 404, msg: '没有待确认的保存' }
    if (row.result) return row.result
    const identity = row.actor
    let result
    try { result = await call('getWebSaveResultV1', { operation_id: row.operation_id }) } catch (_) { return unknown() }
    if (identity !== actor()) return { code: 499, msg: '账号已变化' }
    if (result.code === 404 && result.error_code === 'SALE_OPERATION_NOT_FOUND') return send(scope, row)
    return accept(scope, row, result)
  }
  function acknowledge(scope, operationId) {
    const row = read(scope)
    if (row?.operation_id === operationId) storage.remove(key(scope))
  }
  return { read, submit, query, resume, acknowledge }
}
