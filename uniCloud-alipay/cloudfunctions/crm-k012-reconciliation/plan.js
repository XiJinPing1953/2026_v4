'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const VERSION='k012-reconciliation/2026-09-15.1',CID='694045c0adf6dbd796e261fb',SOURCE='dc543c4d00a6221241b9ef6bc38f03cff1064287070577f5944209bfceffeb3d'
const check=(v,m)=>{if(!v)throw Error(m)}, milli=v=>Math.round(Number(v)*1000),money=v=>v/1000
function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K012完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k012-reconciliation-20260915-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 const update=(table,row,changes)=>{const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:'东丰庄饺子馆',created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};writes.push({table,id:after._id,before:null,after});return after}
 for(const a of t.crm_customer_allocations)update('crm_customer_allocations',a,{status:'void',void_reason:'K012拆分期初及真实收款，重新分配，原分配留痕'})
 const merged=t.crm_customer_receipts.find(r=>r.amount===3384.115)
 update('crm_customer_receipts',merged,{status:'void',void_reason:'合并余额拆为653.57期初、2269.450历史气款及5000真实收款，不产生退款'})
 const opening=add('crm_customer_receipts','opening',{biz_date:'2025-12-31',amount:653.57,allocated_amount:653.57,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:'prepay',source_type:'opening_prepay',payment_method:'unknown',allocation_mode:'checked',allocation_targets:[],note:'用户核准的会计期初来源，非当日新收款；与去年末段气款分别列示。'})
 const historical=add('crm_customer_opening_debts','historical',{biz_date:'2025-12-31',amount:2269.45,amount_received:2269.45,rounding_amount:0,receipt_rounding_amount:0,outstanding:0,payment_status:'paid',money_scale:3,source_type:'customer_opening_debt_manual',note:'2025-11-18表4170.279至2025-12-31表4624.169，453.890m³×5=2269.450。用户确认拆分，不计2026营收。'})
 const cash=t.crm_customer_receipts.filter(r=>r.amount===5000||r.amount===2000).sort((a,b)=>a.biz_date.localeCompare(b.biz_date)).map(r=>({...r,status:'posted',allocated_amount:r.amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,allocation_targets:[]}))
 const flows=t.crm_customer_flow_settlements.slice().sort((a,b)=>a.biz_date.localeCompare(b.biz_date)).map(r=>({...r}))
 let prev=4624169,previousDate='2025-12-31',previousId=null
 for(const f of flows){if(f.biz_date==='2026-06-30')f.biz_date='2026-07-01';if(f.biz_date==='2026-07-29'){f.biz_date='2026-07-30';f.flow_index_curr=6125.12}const curr=milli(f.flow_index_curr);f.flow_index_prev=money(prev);f.flow_volume_m3=money(curr-prev);f.should_receive=money((curr-prev)*5);f.period_end_date=f.biz_date;f.period_start_date=new Date(Date.parse(previousDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);f.previous_flow_settlement_id=previousId;f.receipt_rounding_amount=0;prev=curr;previousDate=f.biz_date;previousId=f._id}
 const credits=[opening,...cash],remaining=new Map(credits.map(r=>[r._id,milli(r.amount)]))
 for(const target of [historical,...flows]){const type=target===historical?'opening_debt':'flow_settlement';let need=milli(target.amount??target.should_receive),paid=0
 for(const c of credits){const n=Math.min(need,remaining.get(c._id));if(!n)continue;need-=n;paid+=n;remaining.set(c._id,remaining.get(c._id)-n);c.allocation_targets.push({target_type:type,target_id:target._id});add('crm_customer_allocations','alloc-'+c._id+'-'+target._id,{receipt_id:c._id,target_type:type,target_id:target._id,sale_id:'',...(type==='opening_debt'?{opening_debt_id:target._id}:{flow_settlement_id:target._id}),sale_date:target.biz_date,biz_date:c.biz_date>target.biz_date?c.biz_date:target.biz_date,receipt_biz_date:c.biz_date,receipt_source_type:c.source_type,receipt_entry_kind:'prepay',allocate_kind:'receipt',allocate_amount:money(n),allocation_mode:'checked',source_type:'accountant_reconciliation',target_title:(type==='opening_debt'?'历史欠款 ':'流量结算 ')+target.biz_date})}
 target.amount_received=money(paid);target.payment_status=need===0?'paid':paid?'partial':'unpaid';if(type==='opening_debt')target.outstanding=money(need)
 }
 for(const c of cash){const old=t.crm_customer_receipts.find(r=>r._id===c._id);update('crm_customer_receipts',old,{status:'posted',allocated_amount:c.amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,allocation_targets:c.allocation_targets,...(old.status==='void'?{void_at:null,void_by:null,void_reason:'',void_by_name:'',note:'按用户确认恢复2026-03-06真实收款5000；旧作废状态保存在修正原值备份。'}:{})})}
 for(const f of flows){const old=t.crm_customer_flow_settlements.find(r=>r._id===f._id);const keys=['biz_date','flow_index_prev','flow_index_curr','flow_volume_m3','should_receive','period_end_date','period_start_date','previous_flow_settlement_id','amount_received','receipt_rounding_amount','payment_status'];update('crm_customer_flow_settlements',old,Object.fromEntries(keys.map(k=>[k,f[k]])))}
 const revenue=flows.reduce((s,f)=>s+milli(f.should_receive),0),total=revenue+milli(historical.amount),paid=9653570,balance=total-paid
 check(revenue===8369290&&balance===985170&&[...remaining.values()].every(n=>n===0),'控制数不符')
 update('crm_customers',t.crm_customers[0],{should_receive_total:money(total),amount_received_total:money(paid),receivable_balance:money(balance),prepay_balance:0,prepay_manual_balance:0,receipt_unallocated_balance:0,offset_credit_balance:0,net_balance:money(balance),last_receipt_at:Date.parse('2026-07-28T00:00:00+08:00')})
 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{cash_received:9000,business_revenue:money(revenue),historical_receivable:2269.45,opening_prepay:653.57,receivable_balance:money(balance),rounding_total:0,writes:writes.length},writes};plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
