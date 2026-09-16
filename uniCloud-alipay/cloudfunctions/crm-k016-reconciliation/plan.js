'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const VERSION='k016-reconciliation/2026-09-16.1',CID='694045c0adf6dbd796e261ea',SOURCE='982800d86ef17c58eb068ab7b4cefc5e7e1aebe19b0b00d58065ff8cfe9b4795'
const check=(v,m)=>{if(!v)throw Error(m)}, milli=v=>Math.round(Number(v)*1000),money=v=>v/1000
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K016完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k016-reconciliation-20260916-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 const update=(table,row,changes)=>{const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'东西小院',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};writes.push({table,id:after._id,before:null,after});return after}
 const sale=date=>t.crm_sale_records.find(s=>s.date===date)
 const opening=add('crm_customer_opening_debts','opening',{biz_date:'2025-12-31',amount:4824,amount_received:4824,rounding_amount:0,receipt_rounding_amount:0,payment_status:'paid',source_type:'customer_opening_debt_manual',note:'会计2026年期初欠款4824元；用户核准补齐，已由1月5日、6日、19日收款结清。'})
 const receipt=(key,date,amount,extra={})=>add('crm_customer_receipts',key,{biz_date:date,amount,allocated_amount:amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'accountant_reconciliation',payment_method:'unknown',note:'用户确认原有实际收款，按会计补齐依据，不重复计款。',...extra})
 const alloc=(key,r,target,amount,kind='receipt',type='sale')=>add('crm_customer_allocations',key,{receipt_id:r._id,target_type:type,target_id:target._id,...(type==='sale'?{sale_id:target._id}:{}),sale_date:target.date||target.biz_date,biz_date:r.biz_date,receipt_biz_date:r.biz_date,receipt_source_type:r.source_type,receipt_entry_kind:r.entry_kind,allocate_kind:kind,allocate_amount:amount,source_type:'accountant_reconciliation',target_title:(type==='sale'?'销售 ':'历史欠款 ')+(target.date||target.biz_date)})
 for(const [d,amount]of [['2026-01-05',3276],['2026-01-06',1107]]){const r=receipt('cash-'+d,d,amount);alloc('opening-'+d,r,opening,amount,'receipt','opening_debt')}
 const jan=receipt('cash-jan19','2026-01-19',2062,{rounding_amount:0.8,rounding_allocated_amount:0.8});alloc('opening-jan19',jan,opening,441,'receipt','opening_debt')
 for(const [d,amount]of [['2026-01-01',334],['2026-01-04',639],['2026-01-06',648]])alloc('jan19-'+d,jan,sale(d),amount)
 alloc('rounding-jan19',jan,sale('2026-01-01'),0.8,'rounding');update('crm_sale_records',sale('2026-01-01'),{rounding_amount:0,receipt_rounding_amount:0.8})
 const feb=receipt('cash-feb10','2026-02-10',945);for(const [d,amount]of [['2026-01-11',495],['2026-01-16',450]])alloc('feb10-'+d,feb,sale(d),amount)
 // The old February allocation put the 27 shortfall on January 30. Restore the accountant's January 25 shortfall.
 for(const [d,amount]of [['2026-01-25',567],['2026-01-30',657]]){const a=t.crm_customer_allocations.find(a=>a.receipt_id==='69cf2f70d51308f649aa9947'&&a.target_id===sale(d)._id);update('crm_customer_allocations',a,{allocate_amount:amount})}
 const mar=receipt('cash-mar20','2026-03-20',1494);for(const [d,amount]of [['2026-02-05',513],['2026-02-13',954],['2026-01-25',27]])alloc('mar20-'+d,mar,sale(d),amount)
 const mar31=t.crm_customer_receipts.find(r=>r._id==='69cfae6593457177addf1402');update('crm_customer_receipts',mar31,{amount:729,allocated_amount:729,note:(mar31.note||'')+'；补齐同笔3月31日729元收款中已记销售的567元。'});alloc('mar31-567',mar31,sale('2026-03-02'),567)
 const aug=t.crm_customer_receipts.find(r=>r._id==='6a6ffc8a818b53788c811f43');update('crm_customer_receipts',aug,{biz_date:'2026-08-02'});for(const a of t.crm_customer_allocations.filter(a=>a.receipt_id===aug._id))update('crm_customer_allocations',a,{biz_date:'2026-08-02',receipt_biz_date:'2026-08-02'})
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:27382,business_revenue:21978.8,refund_total:0,net_cash_received:27382,receivable_balance:0,prepay_balance:580,rounding_total:0.8,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
