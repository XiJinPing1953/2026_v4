'use strict'
const { TABLES, digest, batchId, snapshotHash, buildPlan } = require('./plan')
const { prepare, execute } = require('./transaction')
const { readComplete } = require('./financialReadLocal')
const { LIMITS, mapBounded } = require('./budget')
const db = uniCloud.database()
// Approved case boundary. Actual source IDs/hashes are supplied only after original-source collection.
const BOUNDARY = Object.freeze({ customer_id: '694045c0adf6dbd796e261bf', conversion_key: 'k001-confirmed-cash-20260207-v1',
  receipt_date: '2026-02-07', amount: 11500, voucher_no: '记-024', expected_target_count: 9, price_unit: 'kg' })
const first = result => Array.isArray(result?.data) ? result.data[0] : result?.data
const missingCollection = error => String(error?.message || '').trim() === 'not found collection'
const completeRead = (name, where) => readComplete(db.collection(name), where, {
  command: db.command, source: name, maxRows: LIMITS.source_rows
})
async function snapshot(targetIds = [], { signal = {} } = {}) {
  const alive = () => { if (signal.aborted) throw Error('读取已中止') }
  if (!Array.isArray(targetIds) || targetIds.length > 9 || targetIds.some(id => typeof id !== 'string' || !id)) throw Error('目标编号参数无效或超过9项')
  alive()
  const started = Date.now(), customer = first(await db.collection('crm_customers').doc(BOUNDARY.customer_id).get())
  if (!customer) throw Error('指定客户不存在')
  const tables = { crm_customers: [customer] }, absent = []
  await mapBounded(TABLES.filter(name => name !== 'crm_customers'), async name => {
    try { alive(); tables[name] = await completeRead(name, { customer_id: BOUNDARY.customer_id }) }
    catch (error) {
      if (name !== 'crm_customer_receipt_adjustments' || !missingCollection(error)) throw error
      tables[name] = []; absent.push(name)
    }
  }, 3)
  if (targetIds.some(id => !tables.crm_sale_records.some(row => row._id === id))) throw Error('目标编号不属于本客户')
  const ids = targetIds.length ? targetIds : tables.crm_sale_records.map(row => row._id)
  const runId = batchId(BOUNDARY), fixedReceiptId = digest(`${runId}:receipt`).slice(0, 24)
  const fixedAllocationIds = ids.map(id => digest(`${runId}:allocation:${id}`).slice(0, 24))
  const reverseRows = []
  for (let index = 0; index < ids.length; index += 80) {
    alive(); const chunk = ids.slice(index, index + 80)
    reverseRows.push(...await completeRead('crm_customer_allocations', db.command.or([
      { target_id: db.command.in(chunk) }, { sale_id: db.command.in(chunk) }
    ])))
  }
  alive(); const batchReceipts = await completeRead('crm_customer_receipts', db.command.or([
    { _id: fixedReceiptId }, { source_id: runId }, { request_id: runId }
  ]))
  alive(); const batchAllocations = await completeRead('crm_customer_allocations', db.command.or([
    { receipt_id: fixedReceiptId }, { _id: db.command.in(fixedAllocationIds) }, { source_id: runId }, { request_id: runId }
  ]))
  const linkedRows = [...reverseRows, ...batchReceipts, ...batchAllocations]
  if (linkedRows.some(row => row.customer_id !== BOUNDARY.customer_id)) throw Error('目标或本批固定编号存在跨客户关联，禁止转换')
  const receiptIds = new Set(tables.crm_customer_receipts.map(row => row._id)), allocationIds = new Set(tables.crm_customer_allocations.map(row => row._id))
  if (batchReceipts.some(row => !receiptIds.has(row._id)) || [...reverseRows, ...batchAllocations].some(row => !allocationIds.has(row._id))) throw Error('原始范围与反向关联读取不一致')
  return { customer_id: BOUNDARY.customer_id, tables, snapshot_hash: snapshotHash(tables), complete: true,
    atomic_snapshot: false, read_started_at: started, read_completed_at: Date.now(), absent_collections: absent,
    scope_guard: { reverse_link_query_complete: true, cross_customer_link_count: 0, fixed_id_query_complete: true,
      fixed_id_existing_count: new Set(batchReceipts.map(row => row._id)).size + new Set(batchAllocations.map(row => row._id)).size,
      same_amount_receipt_query_complete: true, same_amount_receipt_count: tables.crm_customer_receipts.filter(row => Number(row.amount) === BOUNDARY.amount).length },
    link_checks: { complete: true, target_count: ids.length, target_links: new Set(reverseRows.map(row => row._id)).size,
      fixed_receipt_links: batchReceipts.length, fixed_allocation_links: batchAllocations.length, cross_customer_links: 0 } }
}
function scopeFrom(data) {
  const supplied = data.scope || {}
  for (const [key, value] of Object.entries(BOUNDARY)) if (supplied[key] !== value) throw Error(`已批准范围不符：${key}`)
  return { ...BOUNDARY, locked: supplied.locked === true, targets: supplied.targets }
}
exports.main = async (event = {}) => {
  if (typeof event.token !== 'string' || !event.token.trim()) return { code: 403, msg: '缺少有效登录凭据' }
  const user = first(await db.collection('crm_users').where({ token: event.token }).limit(1).get())
  if (!user || user.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可执行已确认的单户转换' }
  if (event.data?.customer_id !== BOUNDARY.customer_id) return { code: 400, msg: '客户范围不符' }
  const data = event.data, runId = batchId(BOUNDARY), logId = `legacy_cash_${runId}`
  try {
    if (event.action === 'inspectV1') return { code: 0, data: { ...await snapshot(data.target_ids || []),
      scope_template: { ...BOUNDARY, locked: false, targets: [] }, limits: LIMITS } }
    const run = first(await db.collection('crm_operation_logs').doc(logId).get())
    if (event.action === 'statusV1') return { code: 0, data: { run_id: runId, status: run?.status || 'not_prepared',
      plan_hash: run?.detail?.plan?.plan_hash, summary: run?.detail?.plan?.summary, link_checks: run?.detail?.before?.link_checks,
      operation_log_bytes: run?.operation_log_bytes, scope_guard: run?.detail?.before?.scope_guard, limits: LIMITS } }
    if (['previewV1', 'prepareV1'].includes(event.action)) {
      const scope = scopeFrom(data)
      if (run) {
        if (data.evidence?.scope_hash !== digest(run.detail.plan.scope)) throw Error('固定批次已存在且范围不同，禁止重复准备')
        return { code: 0, data: { run_id: runId, status: run.status, plan_hash: run.detail.plan.plan_hash, summary: run.detail.plan.summary } }
      }
      const before = await snapshot((scope.targets || []).map(row => row.sale_id))
      if (before.snapshot_hash !== data.expected_snapshot_hash) throw Error('原始备份后范围或原值已变化')
      const plan = buildPlan(before, data.evidence, scope, user, Date.now())
      if (event.action === 'previewV1') return { code: 0, data: { plan, link_checks: before.link_checks, limits: LIMITS,
        estimated_operation_log_bytes: Buffer.byteLength(JSON.stringify({ before, plan }), 'utf8') } }
      return { code: 0, data: await prepare({ db, before, plan }) }
    }
    if (['rehearseV1', 'executeV1'].includes(event.action)) {
      if (data.run_id !== runId || !run) throw Error('固定批次不存在或编号不符')
      return { code: 0, data: await execute({ db, logId, runId, planHash: data.plan_hash,
        readSnapshot: options => snapshot(run.detail.plan.scope.targets.map(row => row.sale_id), options),
        rehearse: event.action === 'rehearseV1', failAfterWrites: event.action === 'rehearseV1' ? Number(data.fail_after_writes || 0) : 0 }) }
    }
    return { code: 400, msg: '不支持的操作' }
  } catch (error) { return { code: 409, error_code: 'LEGACY_CASH_CONVERSION_REJECTED', msg: error.message,
    committed: error.committed === true, commit_attempted: error.commit_attempted === true, commit_status_unknown: error.commit_status_unknown === true, run_id: runId } }
}
