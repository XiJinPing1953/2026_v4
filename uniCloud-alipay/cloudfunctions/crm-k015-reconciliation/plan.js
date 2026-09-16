'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const VERSION='k015-reconciliation/2026-09-16.1',CID='694045c0adf6dbd796e261d4',SOURCE='444011f009793846a53706d0af865cc8c5e77b5e76adfbc4cb868d9b746e0d7d'
const check=(v,m)=>{if(!v)throw Error(m)}, milli=v=>Math.round(Number(v)*1000),money=v=>v/1000
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K015完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k015-reconciliation-20260916-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 const update=(table,row,changes)=>{const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'东桥寨洗衣房',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};writes.push({table,id:after._id,before:null,after});return after}
 const may=t.crm_customer_receipts.find(r=>r._id==='6a0eadad9922195956e9f923'),sep=t.crm_customer_receipts.find(r=>r._id==='6a969d598b0323bfecf51d13')
 update('crm_customer_receipts',may,{rounding_amount:0.8,rounding_allocated_amount:0.8,note:(may.note||'')+'；核准：净到账5498元，手续费21元，抹零0.80元。'})
 const rounding=t.crm_customer_allocations.find(a=>a._id==='6a0eb9278183ca0a9ff82859')
 update('crm_customer_allocations',rounding,{allocate_amount:0.8})
 const s=t.crm_sale_records.find(s=>s._id===rounding.target_id)
 update('crm_sale_records',s,{amount_received:853.9,receipt_rounding_amount:0.8})
 update('crm_customer_receipts',sep,{amount:1601,allocated_amount:1601,note:(sep.note||'')+'；核准：结清1608元，其中净到账1601元、手续费7元。'})
 const sepAlloc=t.crm_customer_allocations.find(a=>a._id==='6a977de8cc54bda3f699d995')
 update('crm_customer_allocations',sepAlloc,{allocate_amount:481})
 for(const [key,r,amount,a]of [['may',may,21,rounding],['sep',sep,7,sepAlloc]]){
  const fee=add('crm_customer_receipts','fee-'+key,{biz_date:r.biz_date,amount,allocated_amount:amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'settlement_fee',source_id:r._id,payment_method:'noncash',note:'已确认收款手续费，用于结清应收；不是到账、退款或抹零。'})
  add('crm_customer_allocations','fee-allocation-'+key,{receipt_id:fee._id,target_type:a.target_type,target_id:a.target_id,sale_id:a.sale_id,sale_date:a.sale_date,biz_date:r.biz_date,receipt_biz_date:r.biz_date,receipt_source_type:'settlement_fee',receipt_entry_kind:'prepay',allocate_kind:'receipt',allocate_amount:amount,source_type:'settlement_fee',target_title:a.target_title})
 }
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:19099,business_revenue:11071.3,refund_total:0,net_cash_received:19099,receivable_balance:0,settlement_fee_total:28,rounding_total:0.8,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
