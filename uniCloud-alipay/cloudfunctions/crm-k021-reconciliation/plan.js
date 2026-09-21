'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const SPEC=require('./spec.json'),CID='694045c0adf6dbd796e261eb',CHILD='694045c0adf6dbd796e261d7',VERSION='k021-reconciliation/2026-09-21.1'
const check=(v,m)=>{if(!v)throw Error(m)}
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K021主户完整原值')
 check(before.snapshot_hash===SPEC.source&&snapshotHash(before.tables)===SPEC.source&&request.expected_snapshot_hash===SPEC.source,'原值变化，停止修正')
 check(request.operation_id==='k021-reconciliation-20260921-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SPEC.source,approval_sha256:request.evidence.approval_sha256}
 check(t.crm_sale_records.length===43&&SPEC.receipts.length===18&&t.crm_customers.length===2&&t.crm_customers.find(x=>x._id===CHILD)?.settlement_customer_id===CID,'主子户范围不符')
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};check(!t[table].some(r=>r._id===after._id),'固定编号已存在');writes.push({table,id:after._id,before:null,after});return after}
 const update=(table,row,changes)=>{check(row,'原单缺失');const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 for(const item of SPEC.receipts){
  const sale=t.crm_sale_records.find(s=>s._id===item.id),allocated=t.crm_customer_allocations.filter(a=>a.status!=='void'&&(a.target_id===item.id||a.sale_id===item.id)&&a.allocate_kind!=='rounding').reduce((s,a)=>s+Number(a.allocate_amount||0),0)
  check(sale&&sale.customer_id===CID&&sale.date===item.sale_date&&Number(sale.amount_received)-allocated===item.amount&&Number(sale.rounding_amount||0)===0,'原已收事实不符')
  const receipt=add('crm_customer_receipts','cash-'+item.id,{biz_date:item.date,amount:item.amount,allocated_amount:item.amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'legacy_received_confirmation',source_id:runId,payment_method:'unknown',allocation_mode:'checked',note:'用户确认原已收款，依据两户好会计明细补齐到账日期；不重复增加销售实收。'})
  add('crm_customer_allocations','allocation-'+item.id,{receipt_id:receipt._id,target_type:'sale',target_id:item.id,sale_id:item.id,sale_date:sale.date,biz_date:item.date,receipt_biz_date:item.date,receipt_source_type:receipt.source_type,receipt_entry_kind:receipt.entry_kind,source_type:'legacy_received_confirmation',allocation_mode:'checked',target_title:'销售 '+sale.date,allocate_kind:'receipt',allocate_amount:item.amount})
 }
 const r=t.crm_customer_receipts.find(x=>x._id==='6a7fbdf7250dd1627762b296');check(r?.status==='posted'&&r.biz_date==='2026-08-15'&&r.amount===520,'520元原单不符');update('crm_customer_receipts',r,{biz_date:'2026-08-14'})
 for(const a of t.crm_customer_allocations.filter(a=>a.receipt_id===r._id&&a.status!=='void')){check(a.biz_date==='2026-08-15','分配日期不符');update('crm_customer_allocations',a,{biz_date:'2026-08-14',...(a.receipt_biz_date?{receipt_biz_date:'2026-08-14'}:{})})}
 // A fixed, user-confirmed historical exception: actual refund preceded the recorded return by one day.
 // Keep both source dates intact. This does not loosen the normal refund API date guard.
 const source=t.crm_customer_receipts.find(x=>x._id==='6a8e88a56b72017e622d0f36');check(source?.status==='posted'&&source.source_type==='sale_offset_credit'&&source.amount===210&&source.unallocated_amount===210&&Number(source.allocated_amount||0)===0&&!source.offset_cash_refunded_amount&&source.biz_date==='2026-08-26','210元退款来源不符')
 update('crm_customer_receipts',source,{unallocated_amount:0,offset_cash_refunded_amount:210})
 add('crm_customer_receipts','refund-210',{amount:-210,biz_date:'2026-08-25',payment_method:'unknown',entry_kind:'refund',source_type:'customer_cash_refund',allocated_amount:0,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,refund_source_status:'linked',refund_sources:[{id:source._id,amount:210}],refund_operation_id:request.operation_id+'-210',voucher_ref:'2026-08-25 记-080',note:'用户确认已实际退还谈北路气款210元；会计退款8月25日，退气原单8月26日，两日期保留；不涉及另行押金金额。'})
 const customer=t.crm_customers.find(x=>x._id===CID);check(customer.offset_credit_balance===410&&customer.prepay_balance===410&&customer.net_balance===-410,'原余额不符');update('crm_customers',customer,{offset_credit_balance:200,prepay_balance:200,net_balance:-200})
 check(SPEC.receipts.reduce((s,x)=>s+x.amount,0)===11124,'补证控制数不符')
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SPEC.source,request_hash:digest(request),evidence:request.evidence,summary:{business_revenue:24848,cash_received:25258,cash_backing_created:11124,refund_total:210,net_cash_received:25048,remaining_refund:200,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
