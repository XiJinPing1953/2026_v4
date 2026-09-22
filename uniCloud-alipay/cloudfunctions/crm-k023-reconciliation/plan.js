'use strict'
const {digest,snapshotHash,batchId,expectedAfter}=require('./basePlan')
const SPEC=require('./spec.json')
const VERSION='k023-reconciliation/2026-09-22.1'
const CID='694045c0adf6dbd796e261e1'
const CUSTOMER_NAME='固营馒头'
const SOURCE='b5e75e4733d0f2a6e878867cdcc4d920621e1cb8b31b0594a4427b5a0262a69d'
const check=(v,m)=>{if(!v)throw Error(m)}
const active=r=>!r.status||r.status==='posted'
const fen=v=>Math.round(Number(v||0)*100)

function buildPlan(before,request,actor,now){
 check(before.complete&&before.customer_id===CID&&request.customer_id===CID,'仅限K023完整原值')
 check(before.snapshot_hash===SOURCE&&snapshotHash(before.tables)===SOURCE&&request.expected_snapshot_hash===SOURCE,'原值变化，停止修正')
 check(request.operation_id==='k023-reconciliation-20260922-v1','批次不符')
 check(request.evidence?.confirmed_by_user===true&&/^[a-f0-9]{64}$/.test(request.evidence.approval_sha256||'')&&/^[a-f0-9]{40}$/.test(request.evidence.source_commit||''),'确认依据不完整')
 check(actor?._id&&Number.isSafeInteger(now)&&now>Math.max(...Object.values(before.tables).flat().map(r=>Number(r.updated_at||0))),'执行人或时间无效')
 const t=before.tables,runId=batchId(CID,request.operation_id),writes=[],touched=new Set()
 const audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:SOURCE,approval_sha256:request.evidence.approval_sha256}
 check(t.crm_customers.length===1&&t.crm_customers[0].name===CUSTOMER_NAME,'客户身份不符')
 check(t.crm_sale_records.length===19&&t.crm_customer_receipts.length===13&&t.crm_customer_allocations.length===14,'原单范围不符')
 check(!t.crm_customer_receipt_adjustments.some(r=>r.status==='pending'),'存在待处理收款调整')
 const add=(table,key,fields)=>{const after={_id:digest(runId+':'+key).slice(0,24),customer_id:CID,customer_name:CUSTOMER_NAME,created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username||'',request_id:runId,status:'posted',accounting_reconciliation:audit,...fields};check(!t[table].some(r=>r._id===after._id)&&!touched.has(table+'/'+after._id),'固定编号已存在');touched.add(table+'/'+after._id);writes.push({table,id:after._id,before:null,after});return after}
 const update=(table,row,changes)=>{check(row,'原单缺失');const key=table+'/'+row._id;check(!touched.has(key),'同批重复修改原单');touched.add(key);const patch={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const sale=id=>{const row=t.crm_sale_records.find(x=>x._id===id);check(row&&row.customer_id===CID&&active(row),'销售原单无效');return row}
 const targetAllocations=id=>t.crm_customer_allocations.filter(a=>active(a)&&(a.target_id===id||a.sale_id===id))

 // The old one-yuan rounding is reclassified as one yuan of the confirmed opening prepayment.
 const oldRounding=t.crm_customer_receipts.find(r=>r._id===SPEC.old_rounding.receipt_id)
 const oldRoundingAllocation=t.crm_customer_allocations.find(a=>a._id===SPEC.old_rounding.allocation_id)
 check(oldRounding?.status==='posted'&&fen(oldRounding.amount)===0&&fen(oldRounding.rounding_amount)===100&&fen(oldRounding.rounding_allocated_amount)===100,'原抹零收款不符')
 check(active(oldRoundingAllocation)&&oldRoundingAllocation.receipt_id===oldRounding._id&&fen(oldRoundingAllocation.allocate_amount)===100&&oldRoundingAllocation.allocate_kind==='rounding','原抹零分配不符')
 update('crm_customer_receipts',oldRounding,{status:'void',allocated_amount:0,unallocated_amount:0,rounding_allocated_amount:0,note:'用户确认该1元由期初预付款抵扣；原抹零退出有效汇总，原值保留于受保护批次。'})
 update('crm_customer_allocations',oldRoundingAllocation,{status:'void'})

 const addReceipt=(key,date,amount,voucher,sourceType='legacy_received_confirmation',entryKind='prepay',note='')=>add('crm_customer_receipts',key,{biz_date:date,amount,allocated_amount:amount,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,entry_kind:entryKind,source_type:sourceType,source_id:runId,payment_method:'unknown',allocation_mode:'checked',accounting_voucher:voucher||'',note})
 const addAllocation=(key,receipt,target,type,amount,targetDate)=>add('crm_customer_allocations',key,{receipt_id:receipt._id,target_type:type,target_id:target._id,sale_id:type==='sale'?target._id:'',opening_debt_id:type==='balance_adjustment'?target._id:'',sale_date:targetDate,biz_date:receipt.biz_date>targetDate?receipt.biz_date:targetDate,receipt_biz_date:receipt.biz_date,receipt_source_type:receipt.source_type,receipt_entry_kind:receipt.entry_kind,source_type:receipt.source_type,source_id:runId,allocation_mode:'checked',target_title:type==='sale'?'销售 '+targetDate:'非现金余额调整 '+targetDate,allocate_kind:'receipt',allocate_amount:amount})

 // Backfill only the cash already embedded in the seven sales. One sale has two accounting receipts.
 for(const item of SPEC.receipts){
  const s=sale(item.sale_id)
  check(s.date===item.sale_date&&fen(s.amount_received)===fen(item.sale_received),'销售原已收事实不符')
  check(targetAllocations(s._id).filter(a=>a.allocate_kind!=='rounding').length===0,'已有现金分配，禁止重复背书')
  const total=item.parts.reduce((n,p)=>n+fen(p.amount),0)
  check(total===fen(item.sale_received),'会计收款拆分与原已收不符')
  for(const part of item.parts){
   const r=addReceipt('cash:'+part.date+':'+part.voucher,part.date,part.amount,part.voucher,'legacy_received_confirmation','prepay','用户确认原已收款，按会计日期和凭证补齐依据；不重复增加销售实收。')
   addAllocation('allocation:'+r._id+':'+s._id,r,s,'sale',part.amount,s.date)
  }
  const patch={receipt_allocated_amount:item.sale_received}
  if(s._id===SPEC.opening_sale_id){
   check(fen(s.receipt_rounding_amount)===100&&fen(s.amount_received)===62000,'期初抵扣目标原值不符')
   patch.amount_received=621
   patch.receipt_allocated_amount=621
   patch.receipt_rounding_amount=0
  }
  update('crm_sale_records',s,patch)
 }

 const opening=addReceipt('opening-prepay','2026-01-01',8,'','opening_prepay','opening_prepay','用户确认以前年度剩余预付款8元转入；不计本年实际收款。')
 const openingSale=sale(SPEC.opening_sale_id)
 addAllocation('opening-sale',opening,openingSale,'sale',1,openingSale.date)
 const adjustment=add('crm_customer_opening_debts','balance-adjustment',{biz_date:'2026-06-12',source_type:'balance_adjustment',amount:7,amount_received:7,outstanding:0,payment_status:'paid',note:'会计凭证记-037：液款抹零7元，用户确认未发生现金收退；以非现金余额调整消耗剩余期初预付款。'})
 addAllocation('opening-adjustment',opening,adjustment,'balance_adjustment',7,'2026-06-12')

 const currentCash=t.crm_customer_receipts.filter(r=>active(r)&&r.entry_kind==='prepay'&&r.source_type!=='opening_prepay').reduce((n,r)=>n+fen(r.amount),0)
 check(currentCash===857300,'原正式现金控制数不符')
 check(SPEC.receipts.flatMap(x=>x.parts).reduce((n,p)=>n+fen(p.amount),0)===539000,'补证现金控制数不符')
 check(t.crm_sale_records.reduce((n,s)=>n+fen(s.amount_received),0)===1396300,'原销售已收控制数不符')
 const customer=t.crm_customers[0]
 check(fen(customer.should_receive_total)===1396400&&fen(customer.amount_received_total)===1396300&&fen(customer.net_balance)===0,'客户控制数不符')
 update('crm_customers',customer,{should_receive_total:13964,amount_received_total:13963,receivable_balance:0,net_balance:0,prepay_balance:0,prepay_manual_balance:0,receipt_unallocated_balance:0,offset_credit_balance:0})

 const plan={run_id:runId,customer_id:CID,rule_version:VERSION,source_snapshot_hash:SOURCE,request_hash:digest(request),evidence:request.evidence,summary:{business_revenue:13964,noncash_balance_adjustment:7,receivable_total:13971,cash_received:13963,opening_prepay_transferred:8,rounding_total:0,refund_total:0,net_cash_received:13963,receivable_balance:0,prepay_balance:0,cash_receipts_created:8,cash_backing_created:5390,writes:writes.length},writes}
 plan.plan_hash=digest(plan)
 return plan
}
module.exports={buildPlan,expectedAfter,snapshotHash,batchId,digest,VERSION}
