'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const VERSION='k014-reconciliation/2026-09-15.1',CID='694045c0adf6dbd796e261d6',SOURCE='6d090b4c8fb840398ddb007aa627c1d8e95e850ea89c93860e5e5b964e121b5e'
const check=(v,m)=>{if(!v)throw Error(m)}, milli=v=>Math.round(Number(v)*1000),money=v=>v/1000
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K014完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k014-reconciliation-20260915-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 const update=(table,row,changes)=>{const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'东门包子',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};writes.push({table,id:after._id,before:null,after});return after}
 const sale=date=>t.crm_sale_records.find(s=>s.date===date)
 const fake=t.crm_customer_receipts.find(r=>r.amount===392)
 update('crm_customer_receipts',fake,{status:'void',void_reason:'用户确认392元并非实际收款，拆回8元抹零与384元退气冲抵'})
 for(const a of t.crm_customer_allocations.filter(a=>a.receipt_id===fake._id))update('crm_customer_allocations',a,{status:'void',void_reason:'替换误记现金分配，原值留痕'})
 const receipt=(key,date,amount,s,extra={})=>add('crm_customer_receipts',key,{biz_date:date,amount,allocated_amount:amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'accountant_reconciliation',payment_method:'unknown',allocation_mode:'checked',allocation_targets:s?[{target_type:'sale',target_id:s._id}]:[],note:'用户确认既有真实资金，按会计补齐，不重复计款；渠道未核。',...extra})
 const alloc=(key,r,s,amount,kind='receipt')=>add('crm_customer_allocations',key,{receipt_id:r._id,target_type:'sale',target_id:s._id,sale_id:s._id,sale_date:s.date,biz_date:r.biz_date>s.date?r.biz_date:s.date,receipt_biz_date:r.biz_date,receipt_source_type:r.source_type,receipt_entry_kind:r.entry_kind,allocate_kind:kind,allocate_amount:amount,source_type:r.entry_kind==='offset_credit'?'offset_manual_allocate':'accountant_reconciliation',allocation_mode:'checked',target_title:'销售 '+s.date})
 for(const [sd,rd,amount]of [['2026-01-03','2026-01-04',584],['2026-01-20','2026-01-20',504],['2026-01-30','2026-02-04',536],['2026-02-27','2026-02-27',568],['2026-03-25','2026-03-26',480],['2026-04-04','2026-04-04',520],['2026-07-03','2026-07-05',472]]){const s=sale(sd),r=receipt('cash-'+sd,rd,amount,s,sd==='2026-01-20'?{rounding_amount:8,rounding_allocated_amount:8}:{});alloc('cash-to-'+s._id,r,s,amount);if(sd==='2026-01-20'){alloc('rounding8',r,s,8,'rounding');update('crm_sale_records',s,{amount_received:504,receipt_rounding_amount:8,payment_status:'paid'})}if(sd==='2026-07-03')update('crm_sale_records',s,{amount_received:472,payment_status:'paid'})}
 const target=sale('2026-02-27'),offset=receipt('offset384','2026-02-14',384,target,{entry_kind:'offset_credit',source_type:'sale_offset_credit',source_id:sale('2026-02-14')._id,note:'2月14日退气384元，全部抵2月27日气款，没有实际退款。'})
 alloc('offset384-to-feb27',offset,target,384)
 update('crm_sale_records',sale('2026-02-14'),{amount_received:0,payment_status:'paid'})
 for(const [oldDate,newDate,amount]of [['2026-06-14','2026-06-16',520],['2026-07-13','2026-07-12',480]]){const r=t.crm_customer_receipts.find(r=>r.biz_date===oldDate&&r.amount===amount);update('crm_customer_receipts',r,{biz_date:newDate});for(const a of t.crm_customer_allocations.filter(a=>a.receipt_id===r._id))update('crm_customer_allocations',a,{biz_date:newDate,receipt_biz_date:newDate})}
 const refundSource=t.crm_customer_receipts.find(r=>r.entry_kind==='offset_credit'&&r.amount===176)
 update('crm_customer_receipts',refundSource,{allocated_amount:0,unallocated_amount:0,offset_cash_refunded_amount:176,note:'8月29日退气176元已实际退还客户，不再留作抵扣。'})
 receipt('refund176','2026-08-29',-176,null,{allocated_amount:0,entry_kind:'refund',source_type:'offset_credit_cash_refund',source_id:refundSource._id,offset_source_receipt_id:refundSource._id,offset_refund_operation_id:runId+':refund176',note:'用户确认8月29日实际退款176元，会计记-092。'})
 update('crm_customers',t.crm_customers[0],{should_receive_total:7552,amount_received_total:7720,receivable_balance:0,prepay_balance:0,prepay_manual_balance:0,receipt_unallocated_balance:0,offset_credit_balance:0,net_balance:0,last_receipt_at:Date.parse('2026-08-22T00:00:00+08:00')})
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:7720,business_revenue:7552,refund_total:176,net_cash_received:7544,receivable_balance:0,offset_credit_balance:0,rounding_total:8,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
