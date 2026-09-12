'use strict'
const { TABLES, digest, snapshotHash, batchId, buildPlan, CUSTOMER_ID } = require('./plan')
const { executePrepared } = require('./transaction')
const { readComplete } = require('./financialReadLocal')
const db = uniCloud.database()
const first = result => Array.isArray(result?.data) ? result.data[0] : result?.data
const missing = error => String(error?.message || '').trim() === 'not found collection'
async function snapshot() {
  const started = Date.now(), customer = first(await db.collection('crm_customers').doc(CUSTOMER_ID).get())
  if (!customer) throw Error('K002客户不存在')
  const tables = { crm_customers: [customer] }, absent = []
  for (const name of TABLES.slice(1)) {
    try { tables[name] = await readComplete(db.collection(name), { customer_id: CUSTOMER_ID }, { command: db.command, source: name, maxRows: 10000 }) }
    catch (error) { if (!missing(error)) throw error; tables[name] = []; absent.push(name) }
  }
  const saleIds = tables.crm_sale_records.map(row => row._id)
  const receiptIds = tables.crm_customer_receipts.map(row => row._id)
  const targetIds = [...saleIds, ...tables.crm_customer_opening_debts.map(row => row._id)]
  for (const [name, queries] of [
    ['crm_customer_receipts', [{source_id: db.command.in(saleIds)}]],
    ['crm_customer_allocations', [{receipt_id: db.command.in(receiptIds)}, {target_id: db.command.in(targetIds)}, {sale_id: db.command.in(saleIds)}]]
  ]) for (const query of queries) {
    const rows = await readComplete(db.collection(name), query, {command: db.command, source: `${name}_reverse`, maxRows:10000})
    if (rows.some(row => row.customer_id !== CUSTOMER_ID || !tables[name].some(local => local._id === row._id))) throw Error('反向关联存在范围外记录，停止修正')
  }
  return { customer_id: CUSTOMER_ID, tables, snapshot_hash: snapshotHash(tables), complete: true, atomic_snapshot: false,
    read_started_at: started, read_completed_at: Date.now(), absent_collections: absent,
    counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])) }
}
exports.main = async (event = {}) => {
  const runId = batchId(), logId = `k002_reconcile_${runId}`
  try {
    if (typeof event.token !== 'string' || !event.token.trim()) return { code: 403, msg: '缺少有效登录凭据' }
    const user = first(await db.collection('crm_users').where({ token: event.token }).limit(1).get())
    if (!user || user.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可执行K002核准批次' }
    if (event.data?.customer_id !== CUSTOMER_ID) return { code: 400, msg: '客户范围不符' }
    const data = event.data, existing = first(await db.collection('crm_operation_logs').doc(logId).get())
    if (event.action === 'inspectV1') return { code: 0, data: await snapshot() }
    if (event.action === 'statusV1') return { code: 0, data: { run_id: runId, status: existing?.status || 'not_prepared',
      plan_hash: existing?.detail?.plan?.plan_hash, summary: existing?.detail?.plan?.summary,
      before_snapshot_hash: existing?.detail?.before?.snapshot_hash, after_snapshot_hash: existing?.after_snapshot_hash } }
    if (event.action === 'prepareV1') {
      if (existing) return { code: 0, data: { run_id: runId, status: existing.status, plan_hash: existing.detail.plan.plan_hash, summary: existing.detail.plan.summary } }
      const before = await snapshot()
      if (before.snapshot_hash !== data.expected_snapshot_hash) throw Error('备份后原始数据已变化，必须重新取证')
      const plan = buildPlan(before, data.evidence, user, Date.now())
      await db.collection('crm_operation_logs').add({ _id: logId, action: 'k002_accountant_reconciliation', request_id: runId,
        user_id: user._id, username: user.username || '', role: user.role, customer_id: CUSTOMER_ID, created_at: Date.now(), status: 'prepared', detail: { before, plan } })
      return { code: 0, data: { run_id: runId, status: 'prepared', plan_hash: plan.plan_hash, summary: plan.summary, writes: plan.writes } }
    }
    if (['rehearseV1', 'executeV1'].includes(event.action)) {
      if (!existing || data.run_id !== runId || data.plan_hash !== existing.detail?.plan?.plan_hash) throw Error('批次编号或计划版本不符')
      if (existing.status === 'committed') return { code: 0, data: { run_id: runId, status: 'committed', summary: existing.detail.plan.summary, idempotent: true } }
      if (existing.status !== 'prepared') throw Error('批次状态不支持执行')
      if (event.action === 'executeV1' && !existing.rehearsed_at) throw Error('须先通过事务回滚演练')
      const current = await snapshot()
      if (current.snapshot_hash !== existing.detail.before.snapshot_hash) throw Error('预览后源数据已变化，禁止执行')
      const checkMembership = async () => {
        const outside = await snapshot()
        if (outside.snapshot_hash !== existing.detail.before.snapshot_hash) throw Error('事务期间原值或范围变化')
      }
      const result = await executePrepared({ db, logId, run: existing, rehearse: event.action === 'rehearseV1',
        failAfterWrites: event.action === 'rehearseV1' ? Number(data.fail_after_writes || 0) : 0, readSnapshot: snapshot, checkMembership })
      if (result.status === 'rehearsed_rolled_back' || result.status === 'interruption_rolled_back') {
        const after = await snapshot()
        if (after.snapshot_hash !== current.snapshot_hash) throw Error('回滚后原值校验不符')
        if (result.status === 'rehearsed_rolled_back') await db.collection('crm_operation_logs').doc(logId).update({ rehearsed_at: Date.now(), rehearsal_snapshot_hash: after.snapshot_hash })
        result.snapshot_unchanged = true
      }
      return { code: 0, data: result }
    }
    return { code: 400, msg: '不支持的操作' }
  } catch (error) { return { code: 409, error_code: 'K002_RECONCILIATION_REJECTED', msg: error.message,
    committed: error.committed === true, run_id: runId } }
}
