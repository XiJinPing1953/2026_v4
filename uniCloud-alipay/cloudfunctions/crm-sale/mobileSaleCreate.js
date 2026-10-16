'use strict'

// Permanent creation receipt, deliberately not a side-effect retry queue.
const crypto = require('crypto')
const { newToken, tokenHash } = require('./mobileSaleEffectsLocal')
const OPERATIONS = 'crm_mobile_sale_create_operations', SALES = 'crm_sale_records'
const SOURCE = 'mobile-sale-v1'
const text = value => String(value == null ? '' : value).trim()
const first = res => Array.isArray(res?.data) ? res.data[0] || null : res?.data || null
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
function fail(message, code = 400, errorCode = 'MOBILE_SALE_INVALID') {
  throw Object.assign(new Error(message), { code, error_code: errorCode })
}
function operationId(value) {
  const id = text(value)
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) fail('缺少有效的手机销售操作号')
  return id
}
const keyFor = (user, id) => digest(['mobile-sale-v1', text(user._id), id]).slice(0, 24)
function number(value, label, { zero = false, tenths = false } = {}) {
  if (value === '' || value == null || typeof value === 'boolean') fail(`${label}无效`)
  const n = Number(value)
  if (!Number.isFinite(n) || (zero ? n < 0 : n <= 0) || (tenths && Math.abs(n * 10 - Math.round(n * 10)) > 1e-7)) fail(`${label}无效`)
  return tenths ? Math.round(n * 10) / 10 : n
}
function scanLocation(raw) {
  if (!raw) return null
  const status = raw.status === 'ok' ? 'ok' : 'failed'
  const result = { status, coordinate_type: text(raw.coordinate_type ?? raw.coordinateType) || 'wgs84',
    captured_at: number(raw.captured_at ?? raw.capturedAt, '扫码定位时间'), source: text(raw.source) || 'mobile_bottle_scan' }
  if (status === 'ok') {
    const latitude = Number(raw.latitude), longitude = Number(raw.longitude)
    if (raw.latitude == null || raw.longitude == null || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) fail('扫码定位坐标无效')
    Object.assign(result, { latitude, longitude, accuracy: raw.accuracy == null ? null : number(raw.accuracy, '定位精度', { zero: true }) })
  } else Object.assign(result, { error_code: text(raw.error_code ?? raw.errorCode) || 'get_location_failed', error_message: text(raw.error_message ?? raw.errorMessage) || '定位失败' })
  return result
}
function rows(raw, direction) {
  if (!Array.isArray(raw) || raw.length > 200) fail(`${direction}明细无效或超过200行`)
  const seen = new Set()
  return raw.map(row => {
    const bottleNo = text(row.bottle_no ?? row.bottleNo).toUpperCase().replace(/\s+/g, '')
    const bottleId = text(row.bottle_id ?? row.bottleId)
    if (!bottleNo || !bottleId) fail(`${direction}须先匹配钢瓶档案`)
    if (seen.has(bottleNo)) fail(`${direction}瓶号 ${bottleNo} 重复`)
    seen.add(bottleNo)
    const gross = number(row.gross, '毛重', { tenths: true }), tare = number(row.tare, '皮重', { zero: true, tenths: true })
    const net = number(row.net, '净重', { tenths: true })
    if (Math.round(gross * 10) - Math.round(tare * 10) !== Math.round(net * 10)) fail(`${direction}瓶号 ${bottleNo} 毛重减皮重必须等于净重`)
    const result = { bottle_no: bottleNo, bottle_id: bottleId, gross, tare, net }
    const location = scanLocation(row.scan_location ?? row.scanLocation)
    if (location) result.scan_location = location
    for (const [field, alias] of [['weight_source', 'weightSource'], ['scale_session_id', 'scaleSessionId'], ['scale_device_id', 'scaleDeviceId']]) {
      const value = text(row[field] ?? row[alias])
      if (value.length > 200) fail('称重采集标识过长')
      if (value) result[field] = value
    }
    for (const [field, alias] of [['weight_sampled_at', 'weightSampledAt'], ['scale_stable_seq', 'scaleStableSeq']]) {
      const value = row[field] ?? row[alias]
      if (value != null) result[field] = number(value, '称重采集时间或序号')
    }
    return result
  })
}
function normalizePayload(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('销售内容无效')
  const base = raw.base || {}
  for (const [field, expected] of [['bizMode', 'bottle'], ['priceUnit', 'kg'], ['settlementMode', 'sale'], ['paymentStatus', 'unpaid'], ['paymentMethod', 'on_account']]) {
    if (base[field] !== expected) fail('手机销售仅支持瓶装 kg 挂账')
  }
  if (Number(base.amountReceived) !== 0 || Number(base.roundingAmount || 0) !== 0 || base.applyOffsetCredit || base.offsetEnabled || (raw.agentSaleRows || []).length) fail('手机销售不支持收款、抹零或抵扣设置')
  const date = text(base.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail('销售日期无效')
  if (!text(base.customerId)) fail('客户必选')
  const outRows = rows(raw.outRows, '出瓶'), backRows = rows(raw.backRows || [], '回瓶')
  if (!outRows.length) fail('至少需要一行已称重出瓶')
  if (!Array.isArray(raw.depositRows || []) || (raw.depositRows || []).length > 1000) fail('存瓶明细无效')
  const depositRows = (raw.depositRows || []).map(row => ({ bottle_no: text(row.bottle_no ?? row.bottleNo).toUpperCase().replace(/\s+/g, ''), bottle_id: text(row.bottle_id ?? row.bottleId) || null }))
  if (depositRows.some(row => !row.bottle_no) || new Set(depositRows.map(row => row.bottle_no)).size !== depositRows.length) fail('存瓶明细瓶号为空或重复')
  return { base: { date, customerId: text(base.customerId), customerName: text(base.customerName), delivery1: text(base.delivery1),
    delivery2: text(base.delivery2), vehicleId: text(base.vehicleId), carNo: text(base.carNo), remark: text(base.remark),
    bizMode: 'bottle', priceUnit: 'kg', settlementMode: 'sale', unitPrice: number(base.unitPrice, '单价'),
    paymentStatus: 'unpaid', paymentMethod: 'on_account', amountReceived: 0, roundingAmount: 0, applyOffsetCredit: false, offsetEnabled: false,
    paymentNote: '', ticketImage: '', ticketImages: [] }, outRows, backRows, depositRows, agentSaleRows: [],
    ignore_bottle_flow_warning: raw.ignore_bottle_flow_warning === true, source: SOURCE }
}
function warningsFrom(result) {
  return [...new Set([...(Array.isArray(result?.data?.warnings) ? result.data.warnings : []),
    ...text(result?.data?.warning).split('；')].map(text).filter(Boolean))]
}
function processingGuard(doc) {
  if (doc?.mobile_create_operation_key && ['processing', 'pending_review'].includes(doc.mobile_create_state)) return {
    code: 409, error_code: 'MOBILE_SALE_PROCESSING', msg: '手机销售已保存，关联处理尚未确认完成，请先核查原操作，勿修改或删除',
    data: { sale_id: doc._id, source_saved: true, processing_state: doc.mobile_create_state }
  }
  return null
}
function createService({ db, createSale }) {
  const one = async (table, id) => first(await db.collection(table).where({ _id: id }).limit(1).get())
  async function writeState(operation, state, warnings, extra = {}) {
    let tx
    const patch = { ...extra, processing_state: state, warnings: [...new Set(warnings)], updated_at: Date.now() }
    try {
      tx = await db.startTransaction()
      const opUpdate = await tx.collection(OPERATIONS).where({ _id: operation._id, created_by: operation.created_by,
        payload_digest: operation.payload_digest, processing_state: 'processing',
        ...(operation.anomaly_refresh_job_id ? { anomaly_refresh_job_id: operation.anomaly_refresh_job_id } : {})
      }).update(patch)
      const source = first(await tx.collection(SALES).where({ _id: operation.sale_id, created_by: operation.created_by,
        mobile_create_operation_key: operation._id, mobile_create_state: 'processing' }).limit(1).get())
      if (!source) throw new Error('手机销售源单处理状态已变化，请核查原操作')
      if (Number(opUpdate.updated) !== 1) throw new Error('手机销售处理状态已变化，请核查原操作')
      // Queued work keeps the already-verified source in processing. Avoid relying on
      // whether the database counts an unchanged UPDATE as matched or modified.
      if (state !== 'processing') {
        const saleUpdate = await tx.collection(SALES).where({ _id: operation.sale_id, created_by: operation.created_by,
          mobile_create_operation_key: operation._id, mobile_create_state: 'processing' }).update({ mobile_create_state: state, updated_at: patch.updated_at })
        if (Number(saleUpdate.updated) !== 1) throw new Error('手机销售处理状态已变化，请核查原操作')
      }
      await tx.commit()
      return { ...operation, ...patch }
    } catch (error) {
      if (tx) { try { await tx.rollback() } catch (_) { /* committed or uncertain: only re-read status */ } }
      throw error
    }
  }
  async function reconcileRefresh(operation, source) {
    // The job reference is recorded only after the winning create finished all synchronous work.
    // This query may settle that receipt, but never invokes or replays any business step.
    try {
      const job = await one('crm_anomaly_refresh_jobs', operation.anomaly_refresh_job_id)
      const expectedNos = [...new Set([...(source.out_items || []), ...(source.back_items || []), ...(source.deposit_rows || [])]
        .map(row => text(row.bottle_no).toUpperCase().replace(/\s+/g, '')).filter(Boolean))].sort()
      const targets = Array.isArray(job?.targets) ? job.targets.map(row => ({ kind: row.kind, no: row.no })) : []
      const actualNos = targets.map(row => row.no).sort()
      const validScope = job && job.created_by === operation.created_by && job.request_id === `mobile-sale-${operation._id}`
        && targets.every(row => row.kind === 'bottle' && typeof row.no === 'string')
        && JSON.stringify(actualNos) === JSON.stringify(expectedNos)
        && job.targets_hash === crypto.createHash('sha256').update(JSON.stringify(targets)).digest('hex')
      let warning = !job ? '关联异常刷新任务已不存在，请管理员核查'
        : !validScope ? '关联异常刷新任务与本销售单不一致，请管理员核查'
          : job.status === 'failed' ? `异常刷新失败，请管理员核查${text(job.last_error) ? `：${text(job.last_error)}` : ''}`
            : !['pending', 'processing', 'complete'].includes(job.status) ? '异常刷新任务状态无效，请管理员核查'
              : job.status === 'complete' && job.target_index !== targets.length ? '异常刷新完成凭据不完整，请管理员核查' : ''
      if (!warning && job.status !== 'complete') return operation
      return await writeState(operation, warning ? 'pending_review' : 'completed',
        [...(operation.warnings || []), ...(warning ? [warning] : [])],
        validScope && ['pending', 'processing', 'complete', 'failed'].includes(job.status) ? { anomaly_refresh_state: job.status } : {})
    } catch (_) {
      // A concurrent query may already have settled both rows. No write retry is needed.
      const current = await one(OPERATIONS, operation._id)
      if (current?.payload_digest === operation.payload_digest && current.created_by === operation.created_by
        && current.anomaly_refresh_job_id === operation.anomaly_refresh_job_id && current.processing_state !== 'processing') return current
      return { ...operation, warnings: [...(operation.warnings || []), '异常刷新结果暂未核实，请稍后查询原操作'] }
    }
  }
  async function existingResult(operation, user, fingerprint, idempotent = true) {
    if (operation.created_by !== text(user._id)) fail('无权查询该手机销售操作', 403, 'MOBILE_SALE_FORBIDDEN')
    if (fingerprint && fingerprint !== operation.payload_digest) fail('该操作号已用于不同内容，请查询原结果', 409, 'MOBILE_SALE_OPERATION_CONFLICT')
    const source = await one(SALES, operation.sale_id)
    if (operation.processing_state === 'processing' && operation.anomaly_refresh_job_id
      && source?.mobile_create_operation_key === operation._id && source.created_by === operation.created_by
      && source.mobile_create_state === 'processing') operation = await reconcileRefresh(operation, source)
    let state = operation.processing_state
    const warnings = [...(operation.warnings || [])]
    if (!source) { state = 'pending_review'; warnings.push('原销售单已不存在，操作凭据保留，禁止重新创建') }
    else if (source.mobile_create_operation_key !== operation._id || source.created_by !== operation.created_by) {
      state = 'pending_review'; warnings.push('原销售单与创建凭据不一致，请管理员核查')
    }
    if (state === 'processing') warnings.push('销售单已保存，关联处理尚未确认完成，请勿重复录入')
    return { code: 0, msg: state === 'completed' ? '销售单已保存' : state === 'processing' ? '销售单已保存，关联处理中' : '销售单已保存，关联处理待核', data: {
      operation_id: operation.operation_id, sale_id: operation.sale_id, _id: operation.sale_id, source_saved: true,
      source_exists: Boolean(source), processing_state: state, warnings: [...new Set(warnings)], idempotent,
      ...(operation.anomaly_refresh_job_id ? { anomaly_refresh_job_id: operation.anomaly_refresh_job_id,
        anomaly_refresh_state: operation.anomaly_refresh_state } : {})
    } }
  }
  async function assertBottles(payload) {
    const checked = new Map()
    for (const row of [...payload.outRows, ...payload.backRows, ...payload.depositRows]) {
      const key = row.bottle_id || `no:${row.bottle_no}`
      if (!checked.has(key)) {
        const result = row.bottle_id ? await db.collection('crm_bottles').where({ _id: row.bottle_id }).limit(1).get()
          : await db.collection('crm_bottles').where({ bottle_no: row.bottle_no }).limit(2).get()
        const found = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : []
        if (found.length !== 1) fail(`钢瓶 ${row.bottle_no} 未唯一匹配已有档案`)
        checked.set(key, found[0])
      }
      const bottle = checked.get(key)
      if (text(bottle.bottle_no).toUpperCase().replace(/\s+/g, '') !== row.bottle_no || bottle.is_active === false) fail(`钢瓶 ${row.bottle_no} 档案已变化或停用，请重新扫码`)
    }
  }
  const unknown = id => ({ code: 503, error_code: 'MOBILE_SALE_RESULT_UNKNOWN', msg: '销售提交结果尚未确认，请查询原操作，勿换号重建',
    data: { operation_id: id, source_saved: null, processing_state: 'unknown' } })
  async function getResult(user, data) {
    try {
      const id = operationId(data.operation_id), operation = await one(OPERATIONS, keyFor(user, id))
      if (!operation) return { code: 404, error_code: 'MOBILE_SALE_OPERATION_NOT_FOUND', msg: '尚未查询到原操作，请保留原内容与操作号', data: { operation_id: id, source_saved: null, processing_state: 'unknown' } }
      return await existingResult(operation, user)
    } catch (error) {
      return { code: typeof error.code === 'number' ? error.code : 503, error_code: error.error_code || 'MOBILE_SALE_RESULT_UNKNOWN', msg: error.message,
        data: { operation_id: text(data.operation_id), source_saved: null, processing_state: 'unknown' } }
    }
  }
  async function create(user, data, requestId, token) {
    let id = text(data.operation_id), operation = null, saved = false, uncertain = true, capability = null
    try {
      id = operationId(id)
      const key = keyFor(user, id), existing = await one(OPERATIONS, key)
      let payload
      try { payload = normalizePayload(data.payload) } catch (error) {
        if (existing) fail('该操作号已有创建记录，请查询原结果', 409, 'MOBILE_SALE_OPERATION_CONFLICT')
        uncertain = false
        throw error
      }
      const fingerprint = digest(payload)
      if (existing) return await existingResult(existing, user, fingerprint)
      uncertain = false
      await assertBottles(payload)
      const result = await createSale(user, payload, requestId, token, { mobile: true, getSideEffectCapability: () => capability, insertSource: async doc => {
        if (typeof db.startTransaction !== 'function') fail('当前数据库不支持事务，销售尚未保存', 503, 'MOBILE_SALE_TRANSACTION_UNAVAILABLE')
        const now = Date.now(), tx = await db.startTransaction()
        
        const effectToken = newToken()
        operation = { _id: key, operation_id: id, payload_digest: fingerprint, sale_id: key, created_by: text(user._id),
          processing_state: 'processing', warnings: [], created_at: now, updated_at: now,
          side_effect_token_hash: tokenHash(effectToken), side_effect_claims: [] }
        Object.assign(doc, { _id: key, mobile_create_operation_key: key, mobile_create_state: 'processing' })
        try {
          await tx.collection(OPERATIONS).add(operation)
          await tx.collection(SALES).add(doc)
          await tx.commit()
          saved = true
          capability = { operation_key: key, token: effectToken }
          return { id: key }
        } catch (error) {
          try { await tx.rollback() } catch (_) { /* committed or unreachable */ }
          // Even a rolled-back loser can race a winner not visible to this read yet.
          // No failure after attempting an insert permits a new operation number.
          uncertain = true
          let raced
          try { raced = await one(OPERATIONS, key) } catch (_) { uncertain = true }
          if (raced) throw Object.assign(new Error('Existing mobile operation'), { mobileResult: await existingResult(raced, user, fingerprint) })
          throw error
        }
      } })
      if (!saved) return { ...result, data: { ...result.data, operation_id: id, source_saved: false } }
      const warnings = warningsFrom(result)
      if (result?.code !== 0) warnings.push(text(result?.msg) || '关联处理未完成')
      return await finish(operation, user, warnings, result?.data?.anomaly_refresh_job)
    } catch (error) {
      if (error.mobileResult) return error.mobileResult
      if (saved) return await finish(operation, user, [text(error.message) || '关联处理未完成'])
      if (error.error_code === 'MOBILE_SALE_OPERATION_CONFLICT' || error.error_code === 'MOBILE_SALE_FORBIDDEN') return {
        code: error.code, error_code: error.error_code, msg: error.message, data: { operation_id: id, source_saved: null } }
      if (uncertain) return unknown(id)
      return { code: typeof error.code === 'number' ? error.code : 500, error_code: error.error_code || error.code || 'MOBILE_SALE_NOT_SAVED', msg: error.message,
        data: { operation_id: id, source_saved: false } }
    }
  }
  async function finish(operation, user, warnings, job = null) {
    const validJob = job && text(job.id) && ['pending', 'processing', 'complete', 'failed'].includes(job.state)
    if (job && !validJob) warnings.push('异常刷新回执状态无效，请管理员核查')
    if (validJob && job.state === 'failed') warnings.push('异常刷新失败，请管理员核查')
    const state = warnings.length ? 'pending_review' : validJob && job.state !== 'complete' ? 'processing' : 'completed'
    try {
      const updated = await writeState(operation, state, warnings, validJob ? {
        anomaly_refresh_job_id: text(job.id), anomaly_refresh_state: job.state
      } : {})
      return await existingResult(updated, user, null, false)
    } catch (error) {
      return { code: 0, msg: '销售单已保存，关联处理结果待核', data: { operation_id: operation.operation_id, sale_id: operation.sale_id, _id: operation.sale_id,
        source_saved: true, source_exists: true, processing_state: 'pending_review', idempotent: false,
        warnings: [...new Set([...warnings, '处理回执未完整确认，请查询原操作，勿重复录入'])] } }
    }
  }
  return { create, getResult }
}
module.exports = { createService, processingGuard, normalizePayload, keyFor, OPERATIONS, SOURCE }
