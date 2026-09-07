'use strict'
const crypto = require('crypto')
const db = uniCloud.database()
const { readComplete } = require('./financialReadLocal')
const { buildPlan } = require('./plan')
const CUSTOMER_ID = '694045c0adf6dbd796e261fa'
const VERSION = 'julite-reconciliation/2026-09-07.1'
const TABLES = ['crm_sale_records', 'crm_customer_receipts', 'crm_customer_allocations',
  'crm_customer_flow_settlements', 'crm_customer_opening_debts', 'crm_customer_receipt_adjustments',
  'crm_collection_tasks', 'crm_collection_followups']
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }
async function snapshot() {
  const started = Date.now()
  const customer = (await db.collection('crm_customers').doc(CUSTOMER_ID).get()).data?.[0]
  if (!customer || customer.name !== '聚力特') throw Error('客户范围不匹配')
  const tables = { crm_customers: [customer] }
  const absentCollections = []
  for (const name of TABLES) {
    try { tables[name] = await readComplete(db.collection(name), { customer_id: CUSTOMER_ID }, {
      command: db.command, source: name, maxRows: 10000
    }) } catch (e) {
      if (String(e.message).trim() !== 'not found collection') throw e
      tables[name] = []; absentCollections.push(name)
    }
  }
  const saleIds = tables.crm_sale_records.map(row => `sale:${row._id}`)
  tables.crm_vouchers = []
  try {
    tables.crm_vouchers = await readComplete(db.collection('crm_vouchers'), { source: db.command.in(saleIds) }, {
      command: db.command, source: 'crm_vouchers', maxRows: 10000
    })
  } catch (e) { if (String(e.message).trim() !== 'not found collection') throw e; absentCollections.push('crm_vouchers') }
  return { customer_id: CUSTOMER_ID, tables, snapshot_hash: digest(tables), read_started_at: started,
    read_completed_at: Date.now(), complete: true, absent_collections: absentCollections,
    atomic_snapshot: false, rule_version: VERSION }
}
exports.main = async (event = {}) => {
  const user = (await db.collection('crm_users').where({ token: event.token || '__missing__' }).limit(1).get()).data?.[0]
  if (!user || user.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可核查指定客户' }
  if (event.data?.customer_id !== CUSTOMER_ID) return { code: 400, msg: '客户范围不匹配' }
  try {
    if (event.action === 'inspectV1') return { code: 0, data: await snapshot() }
    const logs = db.collection('crm_operation_logs')
    if (event.action === 'prepareV1') {
      const before = await snapshot()
      if (before.snapshot_hash !== event.data.expected_snapshot_hash) throw Error('原始数据已变化，必须重新取证')
      const plan = buildPlan(before, event.data.evidence, user, Date.now())
      const logId = `reconcile_${plan.run_id}`
      const existing = (await logs.doc(logId).get()).data?.[0]
      if (existing) return { code: 409, msg: '该核对批次已存在，请查询状态', data: { run_id: plan.run_id, status: existing.status } }
      await logs.add({ _id: logId, action: 'customer_accountant_reconciliation', request_id: plan.run_id,
        user_id: user._id, username: user.username || '', role: user.role, created_at: Date.now(),
        status: 'prepared', customer_id: CUSTOMER_ID, detail: { before, plan } })
      return { code: 0, data: { run_id: plan.run_id, plan_hash: plan.plan_hash, summary: plan.summary, writes: plan.writes } }
    }
    if (!['executeV1', 'statusV1', 'rehearseV1'].includes(event.action)) return { code: 400, msg: '不支持的操作' }
    if (!/^[a-f0-9]{24}$/.test(event.data.run_id || '')) throw Error('核对批次无效')
    const logId = `reconcile_${event.data.run_id}`
    const run = (await logs.doc(logId).get()).data?.[0]
    if (!run || run.customer_id !== CUSTOMER_ID) throw Error('核对批次不存在')
    if (event.action === 'statusV1' || run.status === 'committed') return { code: 0, data: { run_id: run.request_id, status: run.status, summary: run.detail.plan.summary } }
    if (run.status !== 'prepared' || run.detail.plan.plan_hash !== event.data.plan_hash) throw Error('预览版本不匹配')
    const current = await snapshot()
    if (current.snapshot_hash !== run.detail.before.snapshot_hash) throw Error('预览后原始数据已变化，禁止执行')
    const tx = await db.startTransaction()
    const started = Date.now()
    const unwrap = res => Array.isArray(res?.data) ? res.data[0] : res?.data
    try {
      const txRun = unwrap(await tx.collection('crm_operation_logs').doc(logId).get())
      if (!txRun || txRun.status !== 'prepared') throw Error('核对批次已被其他操作处理')
      for (const write of run.detail.plan.writes) {
        const row = unwrap(await tx.collection(write.table).doc(write.id).get())
        if (write.before ? digest(row) !== digest(write.before) : Boolean(row && row._id)) throw Error(`源单版本冲突：${write.table}/${write.id}`)
      }
      for (const write of run.detail.plan.writes) {
        if (write.before) {
          const result = await tx.collection(write.table).doc(write.id).update(write.patch)
          if (Number(result.updated) !== 1) throw Error(`未更新预期源单：${write.table}/${write.id}`)
        } else await tx.collection(write.table).add(write.after)
      }
      await tx.collection('crm_operation_logs').doc(logId).update({ status: 'committed', committed_at: Date.now() })
      if (event.action === 'rehearseV1') {
        await tx.rollback()
        return { code: 0, data: { run_id: run.request_id, status: 'rehearsed_rolled_back', transaction_ms: Date.now() - started, summary: run.detail.plan.summary } }
      }
      await tx.commit()
      return { code: 0, data: { run_id: run.request_id, status: 'committed', transaction_ms: Date.now() - started, summary: run.detail.plan.summary } }
    } catch (e) { await tx.rollback().catch(() => {}); throw e }
  }
  catch (e) { return { code: 409, msg: e.message, error_code: e.code || 'RECONCILIATION_READ_FAILED' } }
}
