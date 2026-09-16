'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const SPEC=require('./spec.json')
const VERSION='k017-reconciliation/2026-09-16.1',CID='694045c0adf6dbd796e261e7',SOURCE='7de97fb306dda72ff1c4429bcec9f7cd955563ea2ac30cad0ce94c83c63e6905'
const check=(v,m)=>{if(!v)throw Error(m)}
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K017完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k017-reconciliation-20260916-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 check(t.crm_sale_records.length===15&&SPEC.length===11,'原单范围不符')
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'乏马拉面',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};check(!t[table].some(r=>r._id===after._id),'固定编号已存在');writes.push({table,id:after._id,before:null,after});return after}
 for(const item of SPEC){
  const sale=t.crm_sale_records.find(s=>s._id===item.id)
  check(sale&&sale.date===item.date&&sale.amount_received===item.amount&&sale.rounding_amount===0,'原已收事实不符')
  check(!t.crm_customer_allocations.some(a=>(a.target_id===item.id||a.sale_id===item.id)&&a.status!=='void'),'已有分配，禁止重复背书')
  const receipt=add('crm_customer_receipts','cash-'+item.id,{biz_date:item.date,amount:item.amount,allocated_amount:item.amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'legacy_received_confirmation',source_id:runId,payment_method:'unknown',allocation_mode:'checked',accounting_voucher:item.voucher,note:'用户确认原已收款，按会计日期补齐依据；不重复增加销售实收。'})
  add('crm_customer_allocations','allocation-'+item.id,{receipt_id:receipt._id,target_type:'sale',target_id:item.id,sale_id:item.id,sale_date:sale.date,biz_date:item.date,receipt_biz_date:item.date,receipt_source_type:receipt.source_type,receipt_entry_kind:receipt.entry_kind,allocate_kind:'receipt',allocate_amount:item.amount,source_type:'legacy_received_confirmation',allocation_mode:'checked',target_title:'销售 '+sale.date})
 }
 check(SPEC.reduce((s,r)=>s+r.amount,0)===6156,'旧实收控制数不符')
 check(t.crm_customer_receipts.filter(r=>r.status==='posted'&&r.entry_kind==='prepay').reduce((s,r)=>s+r.amount,0)===1256,'原现金控制数不符')
 check(t.crm_customer_receipts.find(r=>r._id==='6a4754748cf7530057b320b0')?.unallocated_amount===30,'退气余额不符')
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:7412,business_revenue:7382,refund_total:0,net_cash_received:7412,receivable_balance:0,prepay_balance:30,rounding_total:0,cash_backing_created:6156,sales_unchanged:15,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
