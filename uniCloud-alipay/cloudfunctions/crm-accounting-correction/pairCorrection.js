'use strict'
// A bounded transfer of one fully allocated cashier receipt between two independent
// customer accounts. It does not accept arbitrary patches or create cash entries.
const { readComplete } = require('./financialReadLocal')
const { digest } = require('./snapshot')
const { snapshotHash, batchId } = require('./plan')
const { computeSaleAmountsForDoc } = require('./saleAccountingLocal')
const { executePrepared } = require('./transaction')
const VERSION = 'accounting-customer-transfer/2026-10-27.1'
const TABLES = ['crm_sale_records','crm_customer_receipts','crm_customer_allocations','crm_customer_flow_settlements','crm_customer_opening_debts','crm_customer_receipt_adjustments','crm_customer_deposit_accounts','crm_customer_deposit_entries','crm_collection_tasks','crm_collection_followups','crm_cashier_intakes','crm_vouchers']
const OPTIONAL = new Set(['crm_customer_receipt_adjustments','crm_collection_tasks','crm_collection_followups','crm_vouchers'])
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const assert = (v,m) => { if (!v) throw Error(m) }
const cents = v => { const n=Number(v); assert(v !== '' && v != null && Number.isFinite(n) && Math.abs(n*100-Math.round(n*100))<0.00001 && Number.isSafeInteger(Math.round(n*100)), '金额无效'); return Math.round(n*100) }
const sorted = rows => rows.sort((a,b)=>a._id.localeCompare(b._id))
async function pairSnapshot(db, from, to) {
 assert(/^[a-f0-9]{24}$/.test(from||'') && /^[a-f0-9]{24}$/.test(to||'') && from!==to, '客户范围无效')
 const started=Date.now(), cmd=db.command, ids=[from,to], tables={crm_customers:[]}, absent=[]
 const read=(name,where)=>readComplete(db.collection(name),where,{command:cmd,source:'customer_transfer.'+name,maxRows:10000})
 for(const id of ids) { const row=first(await db.collection('crm_customers').doc(id).get()); assert(row && row._id===id,'客户不存在'); assert(!row.settlement_customer_id || row.settlement_customer_id===id,'仅支持独立结算客户'); tables.crm_customers.push(row) }
 const children=await read('crm_customers',cmd.or(ids.map(settlement_customer_id=>({settlement_customer_id}))))
 assert(!children.some(r=>!ids.includes(r._id)), '存在结算子客户，不能自动迁移')
 for(const name of TABLES) {
  try { await db.collection(name).where({customer_id:from}).count() }
  catch(e) { if(OPTIONAL.has(name) && String(e.message).trim()==='not found collection') {tables[name]=[];absent.push(name);continue} throw e }
  tables[name]=await read(name,cmd.or(ids.map(customer_id=>({customer_id}))))
 }
 const allIds = table => tables[table].map(x=>x._id)
 const sales=allIds('crm_sale_records'), receipts=allIds('crm_customer_receipts'), targets=[...sales,...allIds('crm_customer_flow_settlements'),...allIds('crm_customer_opening_debts')]
 const checkReverse=async(name,field,values)=>{
  for(let i=0;i<values.length;i+=40) {
   const rows=await read(name,cmd.or(values.slice(i,i+40).map(value=>({[field]:value}))))
   assert(rows.every(r=>ids.includes(r.customer_id) && tables[name].some(x=>x._id===r._id && digest(x)===digest(r))), '存在范围外反向关联：'+name+'/'+field)
  }
 }
 for(const [name,field,values] of [
  ['crm_customer_allocations','receipt_id',receipts],['crm_customer_allocations','target_id',targets],
  ['crm_customer_allocations','sale_id',sales],['crm_customer_allocations','flow_settlement_id',allIds('crm_customer_flow_settlements')],
  ['crm_customer_receipts','source_id',[...receipts,...sales]],['crm_customer_receipts','offset_source_receipt_id',receipts],
  ['crm_cashier_intakes','receipt_id',receipts]]) await checkReverse(name,field,values)
 if(!absent.includes('crm_customer_receipt_adjustments')) await checkReverse('crm_customer_receipt_adjustments','receipt_id',receipts)
 if(!absent.includes('crm_vouchers')) for(const field of ['source','source_key']) await checkReverse('crm_vouchers',field,sales.map(x=>'sale:'+x))
 // Array references cannot be safely searched by provider-specific dotted predicates.
 const refunds=await read('crm_customer_receipts',{source_type:'customer_cash_refund'})
 assert(!refunds.some(r=>!ids.includes(r.customer_id) && (r.refund_sources||[]).some(x=>receipts.includes(x.id))), '存在范围外退款关联')
 const adjustments=await read('crm_customer_opening_debts',{source_type:'balance_adjustment'})
 assert(!adjustments.some(r=>!ids.includes(r.customer_id) && (receipts.includes(r.adjustment_source?.receipt_id)||targets.includes(r.adjustment_source?.target_id))), '存在范围外调整关联')
 for(const rows of Object.values(tables)) sorted(rows)
 for(const original of tables.crm_customers) assert(digest(first(await db.collection('crm_customers').doc(original._id).get()))===digest(original),'读取期间客户资料变化')
 return {customer_id:from,target_customer_id:to,tables,complete:true,atomic_snapshot:false,absent_collections:absent,read_started_at:started,read_completed_at:Date.now(),snapshot_hash:snapshotHash(tables),counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))}
}
function buildPairPlan(before, request, actor, now) {
 const t=before.tables, from=request.customer_id, to=request.target_customer_id, e=request.evidence
 assert(before.complete && before.customer_id===from && before.target_customer_id===to && snapshotHash(t)===before.snapshot_hash && request.expected_snapshot_hash===before.snapshot_hash,'原值不完整或已变化')
 assert(e?.confirmed_by_user===true && /^[a-f0-9]{64}$/.test(e.approval_sha256||'') && /^[a-f0-9]{64}$/.test(e.source_sha256||''),'缺少业务确认或源码依据')
 assert(actor?._id && Number.isSafeInteger(now),'执行人或时间无效')
 const old=t.crm_customers.find(r=>r._id===from), dest=t.crm_customers.find(r=>r._id===to)
 assert(t.crm_customers.length===2 && old && dest && old.is_active===false && dest.is_active!==false && !old.is_hidden && !dest.is_hidden,'客户状态不符合已确认范围')
 assert(!old.settlement_customer_id && !dest.settlement_customer_id && old.default_price_unit!=='m3' && dest.default_price_unit!=='m3','结算范围或金额精度不支持')
 const own=(table,cid)=>t[table].filter(r=>r.customer_id===cid), one=(table,id,cid)=>{const rows=own(table,cid).filter(r=>r._id===id);assert(rows.length===1,'指定原单缺失或客户不符：'+table);return rows[0]}
 for(const table of ['crm_sale_records','crm_customer_flow_settlements','crm_customer_opening_debts','crm_customer_receipt_adjustments','crm_customer_deposit_accounts','crm_customer_deposit_entries','crm_collection_tasks','crm_collection_followups','crm_vouchers']) assert(own(table,from).length===0,'原客户存在其他历史来源：'+table)
 assert(own('crm_customer_receipts',from).length===1 && own('crm_customer_allocations',from).length===1 && own('crm_cashier_intakes',from).length===1,'原客户其他收款关系须单独核查')
 assert(!t.crm_customer_receipts.some(r=>r.receipt_adjustment_status==='pending') && !t.crm_customer_receipt_adjustments.some(r=>r.status==='pending'),'存在未完成收款调整')
 const receipt=one('crm_customer_receipts',request.receipt_id,from), alloc=one('crm_customer_allocations',request.allocation_id,from), intake=one('crm_cashier_intakes',request.intake_id,from), sale=one('crm_sale_records',request.sale_id,to)
 assert(receipt.status==='posted' && receipt.source_type==='cashier_intake' && receipt.intake_id===intake._id && receipt.source_id===intake._id && receipt.entry_kind==='prepay','收款来源不符')
 assert(intake.status==='posted' && intake.receipt_id===receipt._id && intake.kind==='gas' && cents(intake.deposit_amount)===0 && intake.biz_date===receipt.biz_date && intake.payment_method===receipt.payment_method && Array.isArray(intake.proof_images) && intake.proof_images.length>0 && digest(intake.proof_images)===digest(receipt.proof_images),'出纳、日期、渠道或凭证不一致')
 assert(alloc.receipt_id===receipt._id && alloc.target_type==='sale' && alloc.target_id===sale._id && alloc.sale_id===sale._id && (alloc.allocate_kind||'receipt')==='receipt' && (!alloc.status || alloc.status==='posted'),'分配链不符')
 assert(t.crm_customer_allocations.filter(a=>a.receipt_id===receipt._id).length===1 && t.crm_customer_allocations.filter(a=>a.target_id===sale._id || a.sale_id===sale._id).length===1,'原收款或销售存在其他分配')
 assert(!receipt.refund_sources?.length && !receipt.cash_refunded_amount && !receipt.offset_cash_refunded_amount && !t.crm_customer_receipts.some(r=>r.source_id===receipt._id || r.offset_source_receipt_id===receipt._id || (r.refund_sources||[]).some(x=>x.id===receipt._id)) && !t.crm_customer_opening_debts.some(r=>r.adjustment_source?.receipt_id===receipt._id || r.adjustment_source?.target_id===sale._id),'存在退款或调整关联')
 const amount=cents(request.confirmed_amount)
 assert(amount>0 && cents(receipt.amount)===amount && cents(receipt.allocated_amount)===amount && cents(receipt.unallocated_amount)===0 && cents(receipt.rounding_amount||0)===0 && cents(receipt.rounding_allocated_amount||0)===0 && cents(alloc.allocate_amount)===amount && cents(intake.amount)===amount && cents(intake.gas_amount)===amount,'收款与分配不守恒')
 assert(sale.price_unit==='kg' && sale.settlement_mode==='sale' && sale.date===request.sale_date && receipt.biz_date===request.receipt_date && cents(sale.amount_received)===amount && cents(sale.rounding_amount||0)===0 && cents(sale.receipt_rounding_amount||0)===0 && cents(computeSaleAmountsForDoc(sale).amounts.should_receive)===amount,'销售金额、日期或结算方式不符')
 assert(alloc.biz_date===receipt.biz_date && alloc.receipt_biz_date===receipt.biz_date && alloc.sale_date===sale.date,'业务日期关联不符')
 const runId=batchId(from,request.operation_id), audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:before.snapshot_hash,approval_sha256:e.approval_sha256}, writes=[]
 const patch=(table,row,changes)=>{assert(!row.updated_at || now>Number(row.updated_at),'修正时间早于源版本');const update={...changes,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch:update,after:{...row,...update}})}
 for(const [table,row] of [['crm_customer_receipts',receipt],['crm_customer_allocations',alloc],['crm_cashier_intakes',intake]]) patch(table,row,{customer_id:to,customer_name:dest.name})
 patch('crm_customers',old,{receivable_balance:0,prepay_balance:0,prepay_manual_balance:0,receipt_unallocated_balance:0,offset_credit_balance:0,net_balance:0,should_receive_total:0,amount_received_total:0,last_receipt_at:null,receipt_allocation_revision:runId,cash_intake_revision:runId})
 patch('crm_customers',dest,{receipt_allocation_revision:runId,cash_intake_revision:runId})
 const plan={run_id:runId,customer_id:from,target_customer_id:to,rule_version:VERSION,source_snapshot_hash:before.snapshot_hash,request_hash:digest(request),evidence:e,summary:{transfer_amount:amount/100,receipt_id:receipt._id,allocation_id:alloc._id,intake_id:intake._id,sale_id:sale._id,created_receipts:0,writes:writes.length},writes}
 plan.plan_hash=digest(plan);return plan
}
async function run(db,user,action,data) {
 const from=data.customer_id,to=data.target_customer_id
 if(action==='inspectPairV1')return {code:0,data:await pairSnapshot(db,from,to),rule_version:VERSION}
 const runId=batchId(from,data.operation_id),logId='accounting_customer_transfer_'+runId,logs=db.collection('crm_operation_logs'),existing=first(await logs.doc(logId).get())
 if(action==='statusPairV1')return{code:0,data:{run_id:runId,status:existing?.status||'not_prepared',plan_hash:existing?.detail?.plan?.plan_hash,summary:existing?.detail?.plan?.summary,after_snapshot_hash:existing?.after_snapshot_hash},rule_version:VERSION}
 if(action==='preparePairV1'){
  if(existing){assert(existing.detail?.plan?.request_hash===digest(data),'批次号已用于其他计划');return{code:0,data:{run_id:runId,status:existing.status,plan_hash:existing.detail.plan.plan_hash,summary:existing.detail.plan.summary,writes:existing.detail.plan.writes}}}
  const before=await pairSnapshot(db,from,to),plan=buildPairPlan(before,data,user,Date.now())
  await logs.add({_id:logId,action:'protected_customer_receipt_transfer',customer_id:from,target_customer_id:to,request_id:runId,user_id:user._id,created_at:Date.now(),status:'prepared',detail:{before,plan}})
  return{code:0,data:{run_id:runId,plan_hash:plan.plan_hash,summary:plan.summary,writes:plan.writes},rule_version:VERSION}
 }
 assert(['rehearsePairV1','executePairV1'].includes(action),'不支持的操作')
 assert(existing && data.plan_hash===existing.detail?.plan?.plan_hash && to===existing.detail.plan.target_customer_id,'批次不存在或计划版本不符')
 if(existing.status==='committed')return{code:0,data:{run_id:runId,status:'committed',idempotent:true,summary:existing.detail.plan.summary,after_snapshot_hash:existing.after_snapshot_hash},rule_version:VERSION}
 assert(existing.status==='prepared' && existing.detail.plan.rule_version===VERSION,'批次状态或工具版本不符')
 if(action==='executePairV1')assert(existing.rehearsed_at,'本批尚未通过完整回滚演练')
 const current=await pairSnapshot(db,from,to);assert(current.snapshot_hash===existing.detail.before.snapshot_hash,'原值或记录范围发生变化')
 const readSnapshot=()=>pairSnapshot(db,from,to)
 const result=await executePrepared({db,logId,run:existing,rehearse:action==='rehearsePairV1',failAfterWrites:Number(data.fail_after_writes||0),readSnapshot,checkMembership:async()=>{assert((await readSnapshot()).snapshot_hash===current.snapshot_hash,'事务期间来源范围变化')}})
 if(action==='rehearsePairV1'){assert((await readSnapshot()).snapshot_hash===current.snapshot_hash,'回滚后原值不符');if(result.status==='rehearsed_rolled_back')await logs.doc(logId).update({rehearsed_at:Date.now(),rehearsal_snapshot_hash:current.snapshot_hash});result.snapshot_unchanged=true}
 return {code:0,data:result,rule_version:VERSION}
}
module.exports={pairSnapshot,buildPairPlan,run,VERSION}
