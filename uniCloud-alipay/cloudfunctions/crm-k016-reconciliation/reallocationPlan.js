'use strict'
const {digest,snapshotHash,batchId}=require('./basePlan')
const VERSION='k016-reallocation/2026-09-16.1',CID='694045c0adf6dbd796e261ea',SOURCE='f20b29049ead69a0c9c48a1970c20f1602e64678e7d626f3bc2b796cfd5ba54e'
const check=(v,m)=>{if(!v)throw Error(m)}
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K016完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止')
 check(request.operation_id==='k016-reallocation-20260916-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'缺确认依据')
 check(actor?._id&&Number.isSafeInteger(now),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 const patch=(table,row,changes)=>{check(row&&now>Number(row.updated_at||0),'源单缺失或版本无效');const update={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch:update,after:{...row,...update}})}
 const offset=t.crm_customer_receipts.find(r=>r._id==='6a8e9ed7fbc4c8ef097665ad'),cash=t.crm_customer_receipts.find(r=>r._id==='6a9fb0226c031c11faccf65c'),old=t.crm_customer_allocations.find(a=>a._id==='6a98c4756bf7688dc3129426')
 check(offset.amount===580&&offset.allocated_amount===500&&cash.amount===500&&cash.unallocated_amount===500&&old.allocate_amount===500,'分配原值不符')
 patch('crm_customer_allocations',old,{status:'void',void_reason:'按用户确认改由9月8日真实收款结清8月18日销售；580元退气余额完整保留'})
 patch('crm_customer_receipts',offset,{allocated_amount:0,unallocated_amount:580,allocation_targets:[]})
 patch('crm_customer_receipts',cash,{allocated_amount:500,unallocated_amount:0,allocation_mode:'checked',allocation_targets:[{target_type:'sale',target_id:old.target_id}],allocation_start_date:'',allocation_end_date:''})
 const after={...old,_id:digest(runId+':cash-allocation').slice(0,24),status:'posted',receipt_id:cash._id,source_id:cash._id,biz_date:cash.biz_date,receipt_biz_date:cash.biz_date,receipt_source_type:cash.source_type,receipt_entry_kind:cash.entry_kind,source_type:'receipt_unallocated_allocate',request_id:runId,created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',note:'9月8日实收500元结清8月18日销售；替代原退气冲抵分配',accounting_reconciliation:audit}
 writes.push({table:'crm_customer_allocations',id:after._id,before:null,after})
 patch('crm_customers',t.crm_customers[0],{receipt_unallocated_balance:0,offset_credit_balance:580,prepay_balance:580,net_balance:-580})
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:27382,business_revenue:21978.8,rounding_total:0.8,receivable_balance:0,receipt_unallocated_balance:0,offset_credit_balance:580,prepay_balance:580,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,VERSION}
