'use strict'
const {snapshot,digest}=require('./snapshot')
const original=require('./plan')
const {batchId}=original
const {VERSION}=original
const {executePrepared}=require('./transaction')
const first=r=>Array.isArray(r?.data)?r.data[0]:r?.data
exports.main=async(event={})=>{
 try {
  const {buildPlan,VERSION}=original
  if(typeof event.token!=='string'||!event.token.trim())return{code:403,msg:'需要超级管理员登录'}
  const db=uniCloud.database(),user=first(await db.collection('crm_users').where({token:event.token}).limit(1).get())
  if(!user||user.role!=='superadmin')return{code:403,msg:'仅超级管理员可读取或修正原值'}
  const id=event.data?.customer_id
  if(!/^[a-f0-9]{24}$/.test(id||''))return{code:400,msg:'客户编号无效'}
  if(event.data?.customer_id!=='694045c0adf6dbd796e261e7')throw Error('仅限K017');
  if(event.action==='inspectV1')return{code:0,data:await snapshot(db,id),rule_version:VERSION}
  const data=event.data,runId=batchId(id,data.operation_id),logId='accounting_correction_'+runId
  const logs=db.collection('crm_operation_logs'),existing=first(await logs.doc(logId).get())
  if(event.action==='statusV1')return{code:0,data:{run_id:runId,status:existing?.status||'not_prepared',plan_hash:existing?.detail?.plan?.plan_hash,summary:existing?.detail?.plan?.summary,after_snapshot_hash:existing?.after_snapshot_hash},rule_version:VERSION}
  if(event.action==='prepareV1'){
   if(existing){if(existing.detail?.plan?.request_hash!==digest(data))throw Error('批次号已用于其他计划');return{code:0,data:{run_id:runId,status:existing.status,plan_hash:existing.detail.plan.plan_hash,summary:existing.detail.plan.summary}}}
   const before=await snapshot(db,id),plan=buildPlan(before,data,user,Date.now())
   await logs.add({_id:logId,action:'protected_accounting_correction',customer_id:id,request_id:runId,user_id:user._id,created_at:Date.now(),status:'prepared',detail:{before,plan}})
   return{code:0,data:{run_id:runId,plan_hash:plan.plan_hash,summary:plan.summary,writes:plan.writes}}
  }
  if(!['rehearseV1','executeV1'].includes(event.action))return{code:400,msg:'不支持的操作'}
  if(!existing||data.plan_hash!==existing.detail?.plan?.plan_hash)throw Error('批次不存在或计划版本不符')
  if(existing.status==='committed')return{code:0,data:{run_id:runId,status:'committed',idempotent:true,summary:existing.detail.plan.summary}}
  if(existing.status!=='prepared')throw Error('批次状态不支持执行')
  if(existing.detail.plan.rule_version!==VERSION)throw Error('工具规则已变更，须重新预览')
  if(event.action==='executeV1'&&!existing.rehearsed_at)throw Error('本批尚未通过完整回滚演练')
  const current=await snapshot(db,id)
  if(current.snapshot_hash!==existing.detail.before.snapshot_hash)throw Error('原值或记录范围发生变化，禁止执行')
  const result=await executePrepared({db,logId,run:existing,rehearse:event.action==='rehearseV1',failAfterWrites:Number(data.fail_after_writes||0),readSnapshot:()=>snapshot(db,id),checkMembership:async()=>{
   if((await snapshot(db,id)).snapshot_hash!==current.snapshot_hash)throw Error('事务期间原值或范围变化')
  }})
  if(event.action==='rehearseV1'){
   if((await snapshot(db,id)).snapshot_hash!==current.snapshot_hash)throw Error('回滚后原值不符')
   if(result.status==='rehearsed_rolled_back')await logs.doc(logId).update({rehearsed_at:Date.now(),rehearsal_snapshot_hash:current.snapshot_hash})
   result.snapshot_unchanged=true
  }
  return{code:0,data:result,rule_version:VERSION}
 }catch(e){return{code:409,msg:e.message,committed:e.committed===true,rule_version:VERSION}}
}
