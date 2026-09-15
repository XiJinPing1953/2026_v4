'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const VERSION='k013-reconciliation/2026-09-15.1',CID='694045c0adf6dbd796e261df',SOURCE='b75f198024ccc6ddd64520cf2f4d6e342934738d2352c1e67af9fb7752ce6415'
const check=(v,m)=>{if(!v)throw Error(m)}, milli=v=>Math.round(Number(v)*1000),money=v=>v/1000
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K013完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k013-reconciliation-20260915-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 const update=(table,row,changes)=>{const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'东岗路牛肉汤',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};writes.push({table,id:after._id,before:null,after});return after}
 const opening=add('crm_customer_opening_debts','opening459',{biz_date:'2025-12-31',amount:459,amount_received:459,outstanding:0,rounding_amount:0,receipt_rounding_amount:0,payment_status:'paid',money_scale:2,source_type:'customer_opening_debt_manual',note:'用户确认会计期初欠款459元，2026-01-04收回；不计本年营收。'})
 const receipt=(key,date,amount,target,type)=>add('crm_customer_receipts',key,{biz_date:date,amount,allocated_amount:amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'accountant_reconciliation',payment_method:'unknown',allocation_mode:'checked',allocation_targets:[{target_type:type,target_id:target._id}],note:'用户确认的既有真实收款，按会计日期补齐原始依据；不增加销售原已收，渠道未核。'})
 const allocation=(key,r,target,type,amount,kind='receipt')=>add('crm_customer_allocations',key,{receipt_id:r._id,target_type:type,target_id:target._id,sale_id:type==='sale'?target._id:'',...(type==='opening_debt'?{opening_debt_id:target._id}:{}),sale_date:target.date||target.biz_date,biz_date:r.biz_date,receipt_biz_date:r.biz_date,receipt_source_type:r.source_type,receipt_entry_kind:r.entry_kind,allocate_kind:'receipt',allocate_amount:amount,source_type:kind==='offset_credit'?'offset_manual_allocate':'accountant_reconciliation',allocation_mode:'checked',target_title:(type==='sale'?'销售 ':'历史欠款 ')+(target.date||target.biz_date),note:kind==='offset_credit'?'用户确认退气抵欠款，无实际退款':'补齐已确认收款依据'})
 const first=receipt('cash459','2026-01-04',459,opening,'opening_debt');allocation('cash459-to-opening',first,opening,'opening_debt',459)
 for(const [saleDate,cashDate,amount]of [['2026-01-04','2026-01-16',594],['2026-01-15','2026-01-30',621],['2026-03-29','2026-04-10',387]]){const sale=t.crm_sale_records.find(s=>s.date===saleDate);check(sale&&sale.amount_received===amount,'旧销售已收变化');const r=receipt('cash-'+amount,cashDate,amount,sale,'sale');allocation('cash-to-'+sale._id,r,sale,'sale',amount)}
 const offset=t.crm_customer_receipts.find(r=>r.entry_kind==='offset_credit'&&r.amount===430),targets=[]
 for(const [date,amount]of [['2026-07-13',410],['2026-08-05',20]]){const sale=t.crm_sale_records.find(s=>s.date===date);targets.push({target_type:'sale',target_id:sale._id});allocation('offset430-'+sale._id,offset,sale,'sale',amount,'offset_credit');update('crm_sale_records',sale,{amount_received:Number(sale.amount_received)+amount,payment_status:'paid'})}
 update('crm_customer_receipts',offset,{allocated_amount:430,unallocated_amount:0,allocation_mode:'checked',allocation_targets:targets})
 update('crm_customers',t.crm_customers[0],{should_receive_total:7703,amount_received_total:8133,receivable_balance:0,prepay_balance:0,prepay_manual_balance:0,receipt_unallocated_balance:0,offset_credit_balance:0,net_balance:0,last_receipt_at:Date.parse('2026-08-21T00:00:00+08:00')})
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:7703,business_revenue:7244,historical_receivable:459,receivable_balance:0,offset_credit_balance:0,rounding_total:0,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
