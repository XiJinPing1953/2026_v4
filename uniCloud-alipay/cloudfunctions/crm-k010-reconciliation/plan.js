'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const VERSION='k010-reconciliation/2026-09-15.1'
const CID='694045c0adf6dbd796e261da'
const SOURCE='09dcac446f887fd72690fa9ab867d1e337131c3d06a2c3da82374f2b9d82014c'
const check=(ok,msg)=>{if(!ok)throw Error(msg)}
function buildPlan(before,request,actor,now){
 check(before.complete && before.customer_id===CID && request.customer_id===CID,'仅限K010完整原值')
 check(before.snapshot_hash===SOURCE && snapshotHash(before.tables)===SOURCE && request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k010-reconciliation-20260915-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true && /^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'') && /^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id && Number.isSafeInteger(now) && now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[]
 const audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 const update=(table,row,changes)=>{const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'底家烧烤',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};writes.push({table,id:after._id,before:null,after});return after}
 const sales=t.crm_sale_records,s0=sales.find(s=>s.date==='2026-01-25'),s1=sales.find(s=>s.date==='2026-03-15')
 for(const a of t.crm_customer_allocations)update('crm_customer_allocations',a,{status:'void',void_reason:'K010按实际收款及退款重建分配，撤销错误抹零及退款费用冲抵'})
 const round=t.crm_customer_receipts.find(r=>r.amount===0),offset=t.crm_customer_receipts.find(r=>r.entry_kind==='offset_credit')
 update('crm_customer_receipts',round,{status:'void',void_reason:'不存在4元抹零，使用1月多收款抵扣'})
 update('crm_customer_opening_debts',t.crm_customer_opening_debts[0],{status:'void',void_reason:'18元为实际退款，不是其他费用'})
 const receipt=(key,date,amount,allocated,extra={})=>add('crm_customer_receipts',key,{biz_date:date,amount,allocated_amount:allocated,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',payment_method:'unknown',source_type:'k010_accountant_reconciliation',allocation_mode:'checked',note:'按用户确认的会计日期恢复既有资金事实；渠道未核，不默认为现金',...extra})
 const cash0=receipt('cash650','2026-01-27',650,598,{cash_refunded_amount:52,allocation_targets:[{target_type:'sale',target_id:s0._id},{target_type:'sale',target_id:s1._id}]})
 const cash1=receipt('cash500','2026-03-15',500,500,{allocation_targets:[{target_type:'sale',target_id:s1._id}]})
 const alloc=(key,r,s,amount)=>add('crm_customer_allocations',key,{receipt_id:r._id,target_type:'sale',target_id:s._id,sale_id:s._id,sale_date:s.date,biz_date:r.biz_date>s.date?r.biz_date:s.date,receipt_biz_date:r.biz_date,allocate_kind:'receipt',allocate_amount:amount,receipt_source_type:r.source_type,receipt_entry_kind:'prepay',source_type:'k010_accountant_reconciliation',allocation_mode:'checked',target_title:'销售单 '+s.date})
 alloc('650-to-jan',cash0,s0,594);alloc('650-to-mar',cash0,s1,4);alloc('500-to-mar',cash1,s1,500)
 update('crm_sale_records',s0,{amount_received:594,receipt_rounding_amount:0,payment_status:'paid'})
 update('crm_sale_records',s1,{amount_received:504,receipt_rounding_amount:0,payment_status:'paid'})
 update('crm_customer_receipts',offset,{allocated_amount:0,unallocated_amount:0,offset_cash_refunded_amount:18,allocation_targets:[],note:'4月17日退回余气18元已实际退款，撤销原其他费用分配'})
 receipt('refund18','2026-04-17',-18,0,{entry_kind:'refund',source_type:'offset_credit_cash_refund',source_id:offset._id,offset_source_receipt_id:offset._id,offset_refund_operation_id:runId+':refund18',note:'用户确认4月17日退余气款18元；会计记-060'})
 receipt('refund52','2026-04-17',-52,0,{entry_kind:'refund',source_type:'k010_prepay_cash_refund',source_id:cash0._id,original_receipt_id:cash0._id,note:'1月多收56元，3月抵扣4元，剩余52元于4月17日实际退还；会计记-060'})
 update('crm_customers',t.crm_customers[0],{should_receive_total:1080,amount_received_total:1098,receivable_balance:0,prepay_balance:0,prepay_manual_balance:0,receipt_unallocated_balance:0,offset_credit_balance:0,net_balance:0,last_receipt_at:Date.parse('2026-03-15T00:00:00+08:00')})
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:1150,refund_total:70,net_cash_received:1080,business_revenue:1080,rounding_total:0,receivable_balance:0,prepay_balance:0,writes:writes.length},writes}
 plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
