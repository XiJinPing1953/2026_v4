'use strict'
const { digest, snapshotHash, expectedAfter } = require('./plan')
const { LIMITS, mapBounded, withinBudget } = require('./budget')
const first = result => Array.isArray(result?.data) ? result.data[0] : result?.data
function validatePlan(plan, before) {
  if (digest({ ...plan, plan_hash: undefined }) !== plan.plan_hash || plan.source_snapshot_hash !== snapshotHash(before.tables)) throw Error('保存的计划或原始备份校验失败')
  for (const write of plan.writes) {
    if (write.before) {
      if (!['crm_customers', 'crm_sale_records'].includes(write.table) || Object.keys(write.patch).join(',') !== 'updated_at' || digest(write.after) !== digest({ ...write.before, ...write.patch })) throw Error('旧源单只允许推进版本时间')
    } else if (!['crm_customer_receipts', 'crm_customer_allocations'].includes(write.table)) throw Error('转换只允许新增已确认收款及关联')
  }
}
async function prepare({ db, before, plan }) {
  validatePlan(plan, before)
  const logId = `legacy_cash_${plan.run_id}`, logs = db.collection('crm_operation_logs')
  const existing = first(await logs.doc(logId).get())
  if (existing) {
    if (existing.customer_id !== plan.customer_id || existing.detail?.plan?.plan_hash !== plan.plan_hash) throw Error('固定批次已存在且计划不同，禁止另建批次重复入账')
    return { log_id: logId, run_id: plan.run_id, status: existing.status, plan_hash: plan.plan_hash }
  }
  const creator = plan.writes.find(write => write.table === 'crm_customer_receipts' && !write.before).after
  const record = { user_id: creator.created_by, username: creator.created_by_name, _id: logId, action: 'legacy_received_cash_confirmation', request_id: plan.run_id,
    customer_id: plan.customer_id, status: 'prepared', created_at: Date.now(), detail: { before, plan } }
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8')
  if (bytes > LIMITS.operation_log_bytes) throw Error(`原始备份超过候选单文档预算：${bytes} bytes；尚未写入，须调整备份方案`)
  record.operation_log_bytes = bytes
  await logs.add(record)
  return { log_id: logId, run_id: plan.run_id, status: 'prepared', plan_hash: plan.plan_hash, operation_log_bytes: bytes }
}
async function execute({ db, logId, runId, planHash, readSnapshot, rehearse = false, failAfterWrites = 0 }) {
  const logs = db.collection('crm_operation_logs'), run = first(await logs.doc(logId).get())
  if (!run || run.request_id !== runId || run.detail?.plan?.plan_hash !== planHash) throw Error('固定批次或预览版本不符')
  const { before, plan } = run.detail
  validatePlan(plan, before)
  if (run.status === 'committed') return { run_id: runId, status: 'committed', already_committed: true, summary: plan.summary }
  if (run.status !== 'prepared') throw Error('批次状态不允许执行')
  if (!rehearse && !run.rehearsed_at) throw Error('必须先完成整批事务回滚演练')
  const preReadStarted = Date.now(), current = await readSnapshot(), preReadMs = Date.now() - preReadStarted
  if (!current.complete || current.snapshot_hash !== before.snapshot_hash || snapshotHash(current.tables) !== before.snapshot_hash) throw Error('预览后原值或范围已变化，禁止执行')
  const sourceRows = Object.values(before.tables).reduce((total, rows) => total + rows.length, 0)
  if (sourceRows > LIMITS.source_rows) throw Error('原始范围超过候选读取预算，禁止进入事务')
  const started = Date.now(), deadline = started + LIMITS.transaction_work_ms, tx = await db.startTransaction()
  let count = 0, committed = false, commitAttempted = false, outcome, transactionMs = 0, inTransactionSnapshotMs = 0, stage = 'start'
  const signal = { aborted: false }, inFlight = new Set()
  const request = async work => {
    if (signal.aborted || Date.now() >= deadline) throw Error('事务工作预算已耗尽，停止后续请求')
    const pending = Promise.resolve().then(work); inFlight.add(pending)
    try { return await pending } finally { inFlight.delete(pending) }
  }
  const budget = work => withinBudget(work, deadline, signal)

  try {
    stage = 'read operation lock'
    const lock = first(await budget(() => request(() => tx.collection('crm_operation_logs').doc(logId).get())))
    if (lock?.status !== 'prepared' || lock.detail?.plan?.plan_hash !== planHash) throw Error('事务中批次状态已变化')
    // The complete ordinary-DB snapshot immediately above guards every source row
    // and scope membership. The Alipay transaction client does not reliably allow
    // concurrent document reads; the metadata-only source writes below establish
    // write contention without replacing any business value.
    // Alipay transactions return a generic Database error when get() targets a missing
    // deterministic document. The complete pre-read already proves these IDs absent;
    // add() remains the in-transaction uniqueness guard if another writer races us.
    // A real batch write provides contention on the fixed run; no source amounts are incremented.
    stage = 'lock operation log'
    await budget(() => request(() => tx.collection('crm_operation_logs').doc(logId).update({ status: 'applying' })))
    for (const write of plan.writes) {
      stage = `apply ${write.table}/${write.id}`
      if (write.before) {
        const result = await budget(() => request(() => tx.collection(write.table).doc(write.id).update(write.patch)))
        if (Number(result.updated) !== 1) throw Error(`原值版本保护未更新预期行：${write.id}`)
      } else await budget(() => request(() => tx.collection(write.table).add(write.after)))
      count++
      if (rehearse && failAfterWrites > 0 && count === failAfterWrites) throw Object.assign(Error('预定事务中断'), { interruption: true })
    }
    // Ordinary readers see the pre-commit data; compare full values, not merely row counts.
    // Customer and target updated_at writes also establish transaction write conflicts; business fields stay unchanged.
    stage = 'verify outside snapshot'
    const outsideStarted = Date.now(), outside = await budget(() => request(() => readSnapshot({ signal })))
    inTransactionSnapshotMs = Date.now() - outsideStarted
    if (!outside.complete || outside.snapshot_hash !== before.snapshot_hash || snapshotHash(outside.tables) !== before.snapshot_hash) throw Error('事务期间原值或关联范围变化')
    stage = 'mark operation committed'
    await budget(() => request(() => tx.collection('crm_operation_logs').doc(logId).update({ status: 'committed', committed_at: Date.now(), expected_after_hash: expectedAfter(before, plan) })))
    if (Date.now() >= deadline) throw Error('提交前事务预算不足，回滚')
    if (rehearse) { stage = 'rollback rehearsal'; await tx.rollback(); outcome = 'rehearsed_rolled_back' }
    else { stage = 'commit transaction'; commitAttempted = true; await tx.commit(); committed = true; outcome = 'committed' }
    transactionMs = Date.now() - started
  } catch (error) {
    signal.aborted = true
    await Promise.allSettled([...inFlight])
    error.message = `${stage}: ${error.message}`
    if (commitAttempted && !committed) { error.commit_attempted = true; error.commit_status_unknown = true; error.message = `提交结果未确认，须status回查，不得重新准备批次：${error.message}` }
    if (!committed) await tx.rollback().catch(() => {})
    if (rehearse && error.interruption) outcome = 'interruption_rolled_back'
    else throw error
  }
  const afterReadStarted = Date.now(), after = await readSnapshot(), expectedHash = committed ? expectedAfter(before, plan) : before.snapshot_hash
  if (!after.complete || after.snapshot_hash !== expectedHash || snapshotHash(after.tables) !== expectedHash) {
    const error = Error(committed ? '批次已提交但完整回读不符；先核对，不得重复入账' : '事务回滚后的完整原值不符，禁止执行')
    error.committed = committed; error.run_id = runId; throw error
  }
  if (outcome === 'rehearsed_rolled_back') await logs.doc(logId).update({ rehearsed_at: Date.now(), rehearsal_snapshot_hash: after.snapshot_hash })
  return { run_id: runId, status: outcome, writes: count, transaction_ms: transactionMs || Date.now() - started, in_transaction_snapshot_ms: inTransactionSnapshotMs, source_business_documents_changed: 0, metadata_documents_changed: plan.summary.metadata_documents_changed,
    snapshot_verified: true, pre_transaction_snapshot_ms: preReadMs, after_snapshot_ms: Date.now() - afterReadStarted, summary: plan.summary }
}
module.exports = { prepare, execute }
