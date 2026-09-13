'use strict'
const { batchId, buildPlan } = require('./plan')
const { executePrepared } = require('./transaction')
const crypto = require('crypto')
const { readComplete } = require('./financialReadLocal')
const CUSTOMER_ID = '694045c0adf6dbd796e261b5'
const TABLES = ['crm_sale_records','crm_customer_receipts','crm_customer_allocations','crm_customer_flow_settlements','crm_customer_opening_debts','crm_customer_receipt_adjustments','crm_customer_deposit_accounts','crm_customer_deposit_entries','crm_collection_tasks','crm_collection_followups']
const optional = new Set(['crm_customer_receipt_adjustments','crm_collection_tasks','crm_collection_followups'])
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
async function snapshot(db) {
 const started=Date.now(), customer=first(await db.collection('crm_customers').doc(CUSTOMER_ID).get())
 if (!customer || customer.name !== '鲍立雄') throw Error('客户范围不符')
 const tables={crm_customers:[customer]}, absent=[]
 for(const name of TABLES) {
  try { await db.collection(name).where({customer_id:CUSTOMER_ID}).count() }
  catch(e) { if(optional.has(name)&&String(e.message).trim()==='not found collection'){tables[name]=[];absent.push(name);continue}throw Error(name+': '+e.message) }
  tables[name]=await readComplete(db.collection(name),{customer_id:CUSTOMER_ID},{command:db.command,source:name,maxRows:10000})
 }
 const sales=tables.crm_sale_records.map(x=>x._id),receipts=tables.crm_customer_receipts.map(x=>x._id),targets=[...sales,...tables.crm_customer_opening_debts.map(x=>x._id)]
 for(const [name,field,ids] of [['crm_customer_receipts','source_id',sales],['crm_customer_allocations','receipt_id',receipts],['crm_customer_allocations','target_id',targets],['crm_customer_allocations','sale_id',sales]]) {
  for(let i=0;i<ids.length;i+=50){const rows=await readComplete(db.collection(name),{[field]:db.command.in(ids.slice(i,i+50))},{command:db.command,source:name+'_reverse',maxRows:10000});if(rows.some(x=>x.customer_id!==CUSTOMER_ID||!tables[name].some(y=>y._id===x._id)))throw Error('范围外反向关联')}
 }
 const voucherMap=new Map();let hasVouchers=true
 try {await db.collection('crm_vouchers').where({customer_id:CUSTOMER_ID}).count()}catch(e){if(String(e.message).trim()!=='not found collection')throw e;hasVouchers=false;absent.push('crm_vouchers')}
 for(const field of hasVouchers ? ['customer_id','source','source_key'] : []) {
  const values=field==='customer_id'?[CUSTOMER_ID]:sales.map(x=>'sale:'+x)
  for(let i=0;i<values.length;i+=50){const rows=await readComplete(db.collection('crm_vouchers'),{[field]:db.command.in(values.slice(i,i+50))},{command:db.command,source:'crm_vouchers',maxRows:10000});for(const x of rows)voucherMap.set(x._id,x)}
 }
 tables.crm_vouchers=[...voucherMap.values()]
 for(const rows of Object.values(tables))rows.sort((a,b)=>a._id.localeCompare(b._id))
 const again=first(await db.collection('crm_customers').doc(CUSTOMER_ID).get());if(digest(again)!==digest(customer))throw Error('读取期间客户变化')
 return {customer_id:CUSTOMER_ID,tables,complete:true,atomic_snapshot:false,absent_collections:absent,read_started_at:started,read_completed_at:Date.now(),snapshot_hash:digest(tables),counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))}
}
exports.main = async (event = {}) => {
  const db = uniCloud.database()
  const runId = batchId(), logId = `k004_reconcile_${runId}`
  try {
    if (typeof event.token !== 'string' || !event.token.trim()) return { code: 403, msg: '缺少有效登录凭据' }
    const user = first(await db.collection('crm_users').where({ token: event.token }).limit(1).get())
    if (!user || user.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可执行K004核准批次' }
    if (event.data?.customer_id !== CUSTOMER_ID) return { code: 400, msg: '客户范围不符' }
    const data = event.data, existing = first(await db.collection('crm_operation_logs').doc(logId).get())
    if (event.action === 'inspectV1') return { code: 0, data: await snapshot(db) }
    if (event.action === 'statusV1') return { code: 0, data: { run_id: runId, status: existing?.status || 'not_prepared',
      plan_hash: existing?.detail?.plan?.plan_hash, summary: existing?.detail?.plan?.summary,
      before_snapshot_hash: existing?.detail?.before?.snapshot_hash, after_snapshot_hash: existing?.after_snapshot_hash } }
    if (event.action === 'prepareV1') {
      if (existing) return { code: 0, data: { run_id: runId, status: existing.status, plan_hash: existing.detail.plan.plan_hash, summary: existing.detail.plan.summary } }
      const before = await snapshot(db)
      if (before.snapshot_hash !== data.expected_snapshot_hash) throw Error('备份后原始数据已变化，必须重新取证')
      const plan = buildPlan(before, data.evidence, user, Date.now())
      await db.collection('crm_operation_logs').add({ _id: logId, action: 'k004_accountant_reconciliation', request_id: runId,
        user_id: user._id, username: user.username || '', role: user.role, customer_id: CUSTOMER_ID, created_at: Date.now(), status: 'prepared', detail: { before, plan } })
      return { code: 0, data: { run_id: runId, status: 'prepared', plan_hash: plan.plan_hash, summary: plan.summary, writes: plan.writes } }
    }
    if (['rehearseV1', 'executeV1'].includes(event.action)) {
      if (!existing || data.run_id !== runId || data.plan_hash !== existing.detail?.plan?.plan_hash) throw Error('批次编号或计划版本不符')
      if (existing.status === 'committed') return { code: 0, data: { run_id: runId, status: 'committed', summary: existing.detail.plan.summary, idempotent: true } }
      if (existing.status !== 'prepared') throw Error('批次状态不支持执行')
      if (event.action === 'executeV1' && !existing.rehearsed_at) throw Error('须先通过事务回滚演练')
      const current = await snapshot(db)
      if (current.snapshot_hash !== existing.detail.before.snapshot_hash) throw Error('预览后源数据已变化，禁止执行')
      const checkMembership = async () => {
        const outside = await snapshot(db)
        if (outside.snapshot_hash !== existing.detail.before.snapshot_hash) throw Error('事务期间原值或范围变化')
      }
      const result = await executePrepared({ db, logId, run: existing, rehearse: event.action === 'rehearseV1',
        failAfterWrites: event.action === 'rehearseV1' ? Number(data.fail_after_writes || 0) : 0, readSnapshot: () => snapshot(db), checkMembership })
      if (result.status === 'rehearsed_rolled_back' || result.status === 'interruption_rolled_back') {
        const after = await snapshot(db)
        if (after.snapshot_hash !== current.snapshot_hash) throw Error('回滚后原值校验不符')
        if (result.status === 'rehearsed_rolled_back') await db.collection('crm_operation_logs').doc(logId).update({ rehearsed_at: Date.now(), rehearsal_snapshot_hash: after.snapshot_hash })
        result.snapshot_unchanged = true
      }
      return { code: 0, data: result }
    }
    return { code: 400, msg: '不支持的操作' }
  } catch (error) { return { code: 409, error_code: 'K004_RECONCILIATION_REJECTED', msg: error.message,
    committed: error.committed === true, run_id: runId } }
}
