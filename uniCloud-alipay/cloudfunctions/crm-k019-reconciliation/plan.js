'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const SPEC=require('./spec.json')
const VERSION='k019-reconciliation/2026-09-16.1',CID='694045c0adf6dbd796e261c1',SOURCE='06892f8a4f14e8557ce7ed61086019913215965c4126fe9ae06ac2933e364814'
const check=(v,m)=>{if(!v)throw Error(m)}
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K019完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k019-reconciliation-20260916-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 check(t.crm_sale_records.length===43&&SPEC.length===16,'原单范围不符')
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'福惠馒头',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};check(!t[table].some(r=>r._id===after._id),'固定编号已存在');writes.push({table,id:after._id,before:null,after});return after}
 const update=(table,row,changes)=>{check(row,'原单缺失');const prior=writes.find(w=>w.table===table&&w.id===row._id);if(prior){Object.assign(prior.patch,changes);Object.assign(prior.after,changes);return}const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const receipts=new Map()
 for(const item of SPEC){
  const sale=t.crm_sale_records.find(s=>s._id===item.id)
  check(sale&&sale.date===item.sale_date&&Number(sale.amount_received)-t.crm_customer_allocations.filter(a=>a.target_id===item.id&&a.receipt_entry_kind==='offset_credit'&&a.status!=='void').reduce((s,a)=>s+Number(a.allocate_amount),0)===item.amount,'原已收事实不符')
  check(!t.crm_customer_allocations.some(a=>(a.target_id===item.id||a.sale_id===item.id)&&a.status!=='void'&&a.receipt_entry_kind!=='offset_credit'),'已有现金分配，禁止重复背书')
  const key=item.date==='2026-02-07'?'feb07':item.id
  let receipt=receipts.get(key)
  if(!receipt){receipt=add('crm_customer_receipts','cash-'+key,{biz_date:item.date,amount:0,allocated_amount:0,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'legacy_received_confirmation',source_id:runId,payment_method:'unknown',allocation_mode:'checked',accounting_voucher:item.voucher,note:'用户确认原已收款，按会计日期补齐依据；不重复增加销售实收。'});receipts.set(key,receipt)}
  receipt.amount+=item.amount;receipt.allocated_amount+=item.amount
  const fields={receipt_id:receipt._id,target_type:'sale',target_id:item.id,sale_id:item.id,sale_date:sale.date,biz_date:item.date,receipt_biz_date:item.date,receipt_source_type:receipt.source_type,receipt_entry_kind:receipt.entry_kind,source_type:'legacy_received_confirmation',allocation_mode:'checked',target_title:'销售 '+sale.date}
  add('crm_customer_allocations','allocation-'+item.id,{...fields,allocate_kind:'receipt',allocate_amount:item.amount})
  if(sale.rounding_amount){const n=sale.rounding_amount;receipt.rounding_amount+=n;receipt.rounding_allocated_amount+=n;add('crm_customer_allocations','rounding-'+item.id,{...fields,allocate_kind:'rounding',allocate_amount:n});update('crm_sale_records',sale,{rounding_amount:0,receipt_rounding_amount:Number(sale.receipt_rounding_amount||0)+n})}
 }
 for(const [amount,from,to]of [[1750,'2026-04-16','2026-04-17'],[1449,'2026-04-23','2026-04-24'],[500,'2026-06-04','2026-06-03'],[982,'2026-06-27','2026-06-26']]){
  const r=t.crm_customer_receipts.find(r=>r.amount===amount&&r.biz_date===from&&r.entry_kind==='prepay');check(r,'日期修正原单不符');update('crm_customer_receipts',r,{biz_date:to})
  for(const a of t.crm_customer_allocations.filter(a=>a.receipt_id===r._id)){check(a.biz_date===from,'存在独立分配日期');update('crm_customer_allocations',a,{biz_date:to,...(a.receipt_biz_date?{receipt_biz_date:to}:{})})}
 }
 // Move rounding to its confirmed accounting receipt without moving cash allocations.
 for(const [fromDate,toDate,n,fromAmount,toAmount]of [['2026-05-18','2026-05-23',5],['2026-07-02','2026-07-13',0.5],['2026-06-04','2026-06-04',0.5,500,827]]){
  const from=t.crm_customer_receipts.find(r=>r.biz_date===fromDate&&r.entry_kind==='prepay'&&(!fromAmount||r.amount===fromAmount)),to=t.crm_customer_receipts.find(r=>r.biz_date===toDate&&r.entry_kind==='prepay'&&(!toAmount||r.amount===toAmount))
  const a=t.crm_customer_allocations.find(a=>a.receipt_id===from._id&&a.allocate_kind==='rounding'&&a.allocate_amount===n);check(a&&from&&to,'抹零关联不符')
  update('crm_customer_receipts',from,{rounding_amount:Number(from.rounding_amount||0)-n,rounding_allocated_amount:Number(from.rounding_allocated_amount||0)-n})
  update('crm_customer_receipts',to,{rounding_amount:Number(to.rounding_amount||0)+n,rounding_allocated_amount:Number(to.rounding_allocated_amount||0)+n})
  update('crm_customer_allocations',a,{receipt_id:to._id,source_id:to._id,biz_date:toDate,receipt_biz_date:toDate})
 }
 check(SPEC.reduce((s,r)=>s+r.amount,0)===15158,'旧实收控制数不符')
 check(t.crm_customer_receipts.filter(r=>r.status==='posted'&&r.entry_kind==='prepay').reduce((s,r)=>s+r.amount,0)===21728,'原现金控制数不符')
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:36886,business_revenue:36927,refund_total:0,net_cash_received:36886,receivable_balance:0,prepay_balance:0,rounding_total:41,cash_backing_created:15158,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
