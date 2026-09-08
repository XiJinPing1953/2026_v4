'use strict'
const { buildPlan, digest, SPEC, CUSTOMER_ID, VERSION } = require('./plan')
const { executePrepared } = require('./transaction')
const db = uniCloud.database()
const { readComplete } = require('./financialReadLocal')
const TABLES = ['crm_sale_records', 'crm_customer_receipts', 'crm_customer_allocations',
  'crm_customer_flow_settlements', 'crm_customer_opening_debts', 'crm_customer_receipt_adjustments',
  'crm_collection_tasks', 'crm_collection_followups']
async function snapshot() {
  const started = Date.now()
  const customer = (await db.collection('crm_customers').doc(CUSTOMER_ID).get()).data?.[0]
  if (!customer || customer.name !== '浩诺') throw Error('客户范围不匹配')
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
    const logs=db.collection('crm_operation_logs'), runId=digest({customer_id:CUSTOMER_ID,version:VERSION}).slice(0,24)
    const logId=`haonuo_reconcile_${runId}`
    const existing=(await logs.doc(logId).get()).data?.[0]
    if(event.action==='statusV1') return {code:0,data:{run_id:runId,status:existing?.status || 'not_prepared',summary:existing?.detail?.plan?.summary,plan_hash:existing?.detail?.plan?.plan_hash}}
    if(event.action==='prepareV1') {
      if(existing) return {code:0,data:{run_id:runId,status:existing.status,plan_hash:existing.detail.plan.plan_hash,summary:existing.detail.plan.summary,writes:existing.detail.plan.writes}}
      const before=await snapshot()
      if(before.snapshot_hash!==event.data.expected_snapshot_hash) throw Error('备份后原始数据已变化，必须重新取证')
      const plan=buildPlan(before,event.data.evidence,user,Date.now())
      await logs.add({_id:logId,action:'haonuo_accountant_reconciliation',request_id:runId,user_id:user._id,username:user.username || '',role:user.role,
        created_at:Date.now(),status:'prepared',customer_id:CUSTOMER_ID,detail:{before,plan}})
      return {code:0,data:{run_id:runId,status:'prepared',plan_hash:plan.plan_hash,summary:plan.summary,writes:plan.writes}}
    }
    if(['executeV1','rehearseV1'].includes(event.action)) {
      if(event.data.run_id!==runId || !existing) throw Error('核对批次不存在')
      if(event.data.plan_hash!==existing.detail.plan.plan_hash) throw Error('预览版本不匹配')
      if(existing.status==='committed') return {code:0,data:{run_id:runId,status:'committed',summary:existing.detail.plan.summary}}
      if(existing.status!=='prepared') throw Error('核对批次状态不支持执行')
      if(event.action==='executeV1' && !existing.rehearsed_at) throw Error('须先通过事务回滚预演')
      const current=await snapshot()
      if(current.snapshot_hash!==existing.detail.before.snapshot_hash) throw Error('预览后源单或范围已变化，禁止执行')
      const checkMembership=async()=>{
        for(const [table,rows] of Object.entries(existing.detail.before.tables)) {
          if(existing.detail.before.absent_collections.includes(table)) continue
          const where=table==='crm_customers'?{_id:CUSTOMER_ID}:table==='crm_vouchers'?{source:db.command.in(existing.detail.before.tables.crm_sale_records.map(r=>`sale:${r._id}`))}:{customer_id:CUSTOMER_ID}
          const result=await db.collection(table).where(where).count()
          if(result.total!==rows.length) throw Error(`事务期间数据范围变化：${table}`)
        }
      }
      const result=await executePrepared({db,logId,run:existing,rehearse:event.action==='rehearseV1',
        failAfterWrites:event.action==='rehearseV1'?Number(event.data.fail_after_writes || 0):0,checkMembership})
      if(result.status==='rehearsed_rolled_back' || result.status==='interruption_rolled_back') {
        const after=await snapshot()
        if(after.snapshot_hash!==current.snapshot_hash) throw Error('回滚后源数据校验不符，禁止正式执行')
        if(result.status==='rehearsed_rolled_back') await logs.doc(logId).update({rehearsed_at:Date.now(),rehearsal_snapshot_hash:after.snapshot_hash})
        result.snapshot_unchanged=true
      }
      return {code:0,data:result}
    }
    return { code: 400, msg: '不支持的操作' }
  } catch (e) { return { code: 409, msg: e.message, error_code: e.code || 'RECONCILIATION_READ_FAILED' } }
}
