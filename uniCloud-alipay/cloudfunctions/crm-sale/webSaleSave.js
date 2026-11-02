'use strict'
const crypto = require('crypto')
const { AsyncLocalStorage } = require('async_hooks')
const context = new AsyncLocalStorage()
const TABLE = 'crm_web_sale_operations', SALES = 'crm_sale_records', VERSION = 'web-sale-save/1'
const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v
const hash = v => crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const keyFor = (user, id) => hash([VERSION, user._id, id]).slice(0, 24)
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{12,100}$/.test(id)
const actions = new Set(['createV2', 'updateV2', 'updateSettlementV1'])
const pending = op => op && op.status !== 'complete'
function savedResult(op) {
  return { code: 0, msg: op.status === 'complete' ? '保存成功' : '单据已保存，关联处理后台继续', data: {
    _id: op.sale_id, sale_id: op.sale_id, operation_id: op.operation_id, source_saved: true,
    processing_state: op.status, warning: pending(op) ? `单据已保存，${op.last_error || '关联处理尚未完成'}；后台将按原操作继续处理，请勿重复录入` : '',
    background_pending: pending(op), completed_steps: op.completed_steps || [], protocol: VERSION
  } }
}
function createService({ db, handlers, steps, authorize, actor, now = Date.now }) {
  const one = async (table, id, database = db) => first(await database.collection(table).where({ _id: id }).limit(1).get())
  const unknown = id => ({ code: 503, error_code: 'SALE_SAVE_UNKNOWN', msg: '保存结果暂未确认，请查询原操作；请勿重新录入', data: { operation_id: id, source_saved: null, protocol: VERSION } })
  async function guard(source, database = db) {
    if (!source?.web_save_operation_key) return
    const previous = await one(TABLE, source.web_save_operation_key, database)
    if (!previous || pending(previous)) throw Object.assign(new Error('本单关联处理尚未完成，请先查询原保存结果'), { code: 409, error_code: 'SALE_EFFECTS_PENDING' })
  }
  async function submit(user, data, requestId, token) {
    const id = data.operation_id
    if (!validId(id) || !actions.has(data.save_action) || !data.payload || typeof data.payload !== 'object') return { code: 400, msg: '保存操作无效，请刷新页面', data: { source_saved: false } }
    const permitted = await authorize(user, data.save_action, requestId)
    if (!permitted.ok) return { code: permitted.code || 403, msg: permitted.msg || '无权保存', data: { source_saved: false } }
    const key = keyFor(user, id), digest = hash([data.save_action, data.payload])
    const state = { saved: false, attempted: false, operation: null }
    async function lookup() {
      const op = await one(TABLE, key)
      if (!op) return null
      if (op.payload_digest !== digest) return { code: 409, error_code: 'SALE_OPERATION_CONFLICT', msg: '原操作已绑定其他内容，请先查询原保存结果', data: { operation_id: id, source_saved: true, sale_id: op.sale_id } }
      return savedResult(op)
    }
    state.prepare = async (tx, before, after) => {
      state.attempted = true
      const old = await one(TABLE, key, tx)
      if (old) throw Object.assign(new Error('原操作已存在'), { existingOperation: true })
      await guard(before, tx)
      if (!before) after._id = key
    }
    state.record = async (tx, before, after, result) => {
      const saleId = before?._id || result.id || after._id
      const op = { _id: key, operation_id: id, payload_digest: digest, sale_id: saleId, save_action: data.save_action,
        before: before || null, after: { ...after, _id: saleId, web_save_operation_key: key },
        created_by: user._id, request_id: requestId, rule_version: VERSION, status: 'pending',
        completed_steps: [], lease_id: '', lease_until: 0, attempts: 0, next_retry_at: 0, last_error: '', created_at: now(), updated_at: now() }
      await tx.collection(SALES).doc(saleId).update({ web_save_operation_key: key })
      await tx.collection(TABLE).add(op)
      await tx.collection('crm_operation_logs').add({ _id: hash(['web-sale-audit', key]).slice(0, 24),
        user_id: user._id, username: user.username || '', role: user.role || '',
        action: { createV2: 'sale_create_v2', updateV2: 'sale_update_v2', updateSettlementV1: 'sale_update_settlement_v1' }[data.save_action],
        detail: { id: saleId, customer_id: after.customer_id, operation_id: id, protocol: VERSION, followup_status: 'pending' },
        request_id: requestId, created_at: op.created_at })
      state.operation = op
    }
    try {
      const old = await lookup()
      if (old) return old
      const result = await context.run(state, () => handlers[data.save_action](user, data.payload, requestId, token))
      if (!state.saved) return { ...result, data: { ...result?.data, operation_id: id, source_saved: false, protocol: VERSION } }
      // Durable source + receipt first. Continue a bounded amount; timer owns recovery.
      try { return savedResult(await run(key, { maxMs: 6000 })) } catch (_) { return savedResult(state.operation) }
    } catch (error) {
      if (state.saved) return savedResult(state.operation)
      try { const found = await lookup(); if (found) return found } catch (_) { return unknown(id) }
      if (state.attempted) return unknown(id)
      return { code: typeof error.code === 'number' ? error.code : 503, error_code: error.error_code || 'SALE_NOT_SAVED',
        msg: error.code === 409 ? error.message : '本次尚未保存，请保留原操作重试', data: { operation_id: id, source_saved: false, protocol: VERSION } }
    }
  }
  async function getResult(user, data) {
    if (!validId(data.operation_id)) return { code: 400, msg: '操作号无效' }
    try {
      const op = await one(TABLE, keyFor(user, data.operation_id))
      if (!op) return { code: 404, error_code: 'SALE_OPERATION_NOT_FOUND', msg: '尚未查到原操作，可按原操作号继续提交', data: { source_saved: null, operation_id: data.operation_id, protocol: VERSION } }
      return savedResult(op)
    } catch (_) { return unknown(data.operation_id) }
  }
  async function run(key, { maxMs = 40000 } = {}) {
    let op = await one(TABLE, key)
    if (!op || !pending(op) || op.next_retry_at > now()) return op
    const lease = crypto.randomBytes(16).toString('hex')
    // 7 min exceeds the platform invocation and already-started child call lifetime.
    const locked = await db.collection(TABLE).where({ _id: key, status: db.command.in(['pending', 'processing']), lease_until: db.command.lte(now()), next_retry_at: db.command.lte(now()) })
      .update({ status: 'processing', lease_id: lease, lease_until: now() + 420000, updated_at: now() })
    if (!locked.updated) return one(TABLE, key)
    op = await one(TABLE, key)
    const started = now()
    async function checkpoint(patch) {
      const changed = await db.collection(TABLE).where({ _id: key, lease_id: lease, lease_until: db.command.gt(now()) }).update({ ...patch, updated_at: now() })
      if (Number(changed.updated) !== 1) throw new Error('处理锁已变化，等待原操作恢复')
      op = { ...op, ...patch }
    }
    try {
      if (op.rule_version !== VERSION) throw new Error('关联处理版本需核对')
      const user = await actor(op.created_by)
      const permission = user && await authorize(user, op.save_action, op.request_id)
      if (!user?.token || !permission?.ok) throw new Error('原操作账号或权限需核对')
      for (const step of steps(op)) {
        if (op.completed_steps.includes(step.name)) continue
        if (now() - started >= maxMs) break
        const source = await one(SALES, op.sale_id)
        if (!source || source.web_save_operation_key !== key) throw new Error('源单已变化，原任务停止，需核对')
        await step.run({ op, source, user, token: user.token })
        await checkpoint({ completed_steps: [...op.completed_steps, step.name], last_error: '', attempts: 0 })
      }
      const complete = steps(op).every(step => op.completed_steps.includes(step.name))
      await checkpoint({ status: complete ? 'complete' : 'pending', lease_id: '', lease_until: 0, next_retry_at: 0, ...(complete ? { completed_at: now() } : {}) })
    } catch (error) {
      const attempts = op.attempts + 1
      await checkpoint({ status: 'pending', attempts, last_error: String(error.message || error).slice(0, 220),
        lease_id: '', lease_until: 0, next_retry_at: now() + Math.min(60000 * 2 ** Math.min(attempts - 1, 4), 900000) })
    }
    return op
  }
  async function drain() {
    const started = now()
    const result = await db.collection(TABLE).where({ status: db.command.in(['pending', 'processing']), lease_until: db.command.lte(now()), next_retry_at: db.command.lte(now()) }).orderBy('created_at', 'asc').limit(10).get()
    let processed = 0
    for (const op of result.data || []) {
      if (now() - started > 40000) break
      try { await run(op._id, { maxMs: Math.max(1000, 40000 - (now() - started)) }); processed++ } catch (_) { /* durable lease will expire */ }
    }
    return { code: 0, data: { processed, protocol: VERSION } }
  }
  async function review(source) {
    if (!source?.web_save_operation_key) return null
    const op = await one(TABLE, source.web_save_operation_key)
    return { pending: !op || pending(op), message: op?.status === 'complete' ? '' :
      `本单已保存，${op?.last_error || '关联处理正在后台继续'}。完成前暂不能修改，请稍后刷新查看。` }
  }
  return { submit, getResult, guard, run, drain, review }
}
module.exports = { createService, context, keyFor, TABLE, VERSION, hash, savedResult }
