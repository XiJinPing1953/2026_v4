'use strict'
// One cash event, optionally linked to several available credit sources.
const crypto = require('crypto')
const { isOffsetCreditReceipt, isSettlementFeeReceipt, isDepositTransferReceipt } = require('./receiptSource')
const SOURCE = 'customer_cash_refund'
const text = x => String(x ?? '').trim()
const num = x => Number(x || 0)
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex')
const fail = (msg, code = 409) => { throw Object.assign(new Error(msg), { code }) }
const sourceSnapshot = r => ({ id:r._id, customer_id:r.customer_id, status:r.status, amount:r.amount,
 allocated_amount:r.allocated_amount || 0, rounding_amount:r.rounding_amount || 0,
 rounding_allocated_amount:r.rounding_allocated_amount || 0, unallocated_amount:r.unallocated_amount || 0,
 cash_refunded_amount:r.cash_refunded_amount || 0, offset_cash_refunded_amount:r.offset_cash_refunded_amount || 0,
 updated_at:r.updated_at || 0, source_type:r.source_type, entry_kind:r.entry_kind, receipt_adjustment_status:r.receipt_adjustment_status })
const protectedReceipt = r => r && (r.source_type === SOURCE || num(r.cash_refunded_amount)>0 || num(r.offset_cash_refunded_amount)>0)
function createRefundService({ db, command, readComplete, moneyScale, refreshBalances }) {
 const get = async (store,id) => { const {data}=await store.doc(id).get(); return Array.isArray(data)?data[0]:data }
 const all = async (store,cid) => readComplete(store,{customer_id:cid},{command,source:'customer_refunds',sort:['created_at']})
 async function context(cid) {
  const customer=await get(db.collection('crm_customers'),cid)
  if(!customer) fail('客户不存在',404)
  return {customer,fix:x=>Number(Number(x).toFixed(moneyScale(customer)))}
 }
 function eligible(r) {return r.status==='posted' && num(r.amount)>0 && !isSettlementFeeReceipt(r) && !isDepositTransferReceipt(r) && r.receipt_adjustment_status!=='pending'}
 async function list(data) {
  const cid=text(data.customer_id);const {customer}=await context(cid)
  const rows=await all(db.collection('crm_customer_receipts'),cid)
  return {money_scale:moneyScale(customer),sources:rows.filter(r=>eligible(r)&&num(r.unallocated_amount)>0).map(r=>({
   id:r._id,date:r.biz_date,label:isOffsetCreditReceipt(r)?'退气可抵余额':r.source_type==='opening_prepay'?'期初预付款':'预付款 / 多付款',
   available:r.unallocated_amount,version:hash(sourceSnapshot(r))})),
   refunds:rows.filter(r=>r.source_type===SOURCE).map(r=>({id:r._id,date:r.biz_date,amount:-r.amount,payment_method:r.payment_method,
    note:r.note,voucher_ref:r.voucher_ref,status:r.status,source_status:r.refund_source_status,links:r.refund_sources||[],operation_id:r.refund_operation_id})),complete:true}
 }
 function input(data,fix) {
  const raw=Number(data.amount), amount=fix(raw), date=text(data.biz_date), method=text(data.payment_method)
  if(!Number.isFinite(raw)||amount<=0||raw!==amount) fail('请输入精度范围内的正数退款金额',400)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) fail('实际退款日期无效',400)
  if(!['cash','bank','wechat','alipay','check','unknown'].includes(method)) fail('请选择实际付款方式',400)
  if(!text(data.note)) fail('请填写退款原因',400)
  if ((data.sources||[]).some(x=>Number(x.amount)!==fix(Number(x.amount)))) fail('来源金额超出允许精度',400)
  const links=(Array.isArray(data.sources)?data.sources:[]).map(x=>({id:text(x.id),amount:fix(Number(x.amount)),version:text(x.version)})).sort((a,b)=>a.id.localeCompare(b.id))
  if(new Set(links.map(x=>x.id)).size!==links.length||links.some(x=>!x.id||!Number.isFinite(x.amount)||x.amount<=0||!x.version)) fail('余额来源或金额无效',400)
  const pending=data.source_pending===true
  if(pending?links.length>0:fix(links.reduce((s,x)=>s+x.amount,0))!==amount) fail('来源合计必须等于退款金额；来源待核时不扣余额',400)
  return {customer_id:text(data.customer_id),amount,biz_date:date,payment_method:method,note:text(data.note),voucher_ref:text(data.voucher_ref),sources:links,source_pending:pending,link_refund_id:text(data.link_refund_id)}
 }
 async function plan(data,store=db.collection('crm_customer_receipts')) {
  const {fix}=await context(text(data.customer_id)), value=input(data,fix), changes=[]
  let original=null
  if(value.link_refund_id) {
   original=await get(store,value.link_refund_id)
   if(!original||original.customer_id!==value.customer_id||original.source_type!==SOURCE||original.status!=='posted'||original.refund_source_status!=='pending') fail('该退款不处于来源待核状态')
   if(value.source_pending||fix(-original.amount)!==value.amount||original.biz_date!==value.biz_date||original.payment_method!==value.payment_method||original.note!==value.note||text(original.voucher_ref)!==value.voucher_ref) fail('补关联不能改变原退款事实')
  }
  for(const link of value.sources) {
   const r=await get(store,link.id)
   if(!r||r.customer_id!==value.customer_id||!eligible(r)) fail('退款来源不可用或不属于该客户')
   if(hash(sourceSnapshot(r))!==link.version) fail('余额已变化，请重新加载并预览')
   if(text(r.biz_date) && value.biz_date<text(r.biz_date)) fail('退款日期不能早于所选余额来源日期')
   const offset=isOffsetCreditReceipt(r), field=offset?'offset_cash_refunded_amount':'cash_refunded_amount'
   const available=fix(num(r.unallocated_amount)),refunded=fix(num(r[field]))
   // Legacy offset sources may include rounding in the source amount; cash sources do not.
   const components=fix(num(r.allocated_amount)+available+refunded+(offset?num(r.rounding_allocated_amount):0))
   if(fix(r.amount)!==components||available<link.amount) fail('来源余额不完整或退款超过可退余额')
   changes.push({id:r._id,before:sourceSnapshot(r),after:{unallocated_amount:fix(available-link.amount),[field]:fix(refunded+link.amount)},amount:link.amount})
  }
  return {value,changes,original_id:original?._id||null,plan_hash:hash({value,changes})}
 }
 async function run(action,data,user) {
  if(action==='listCustomerRefundsV1') return list(data)
  if(action==='getCustomerRefundOperationV1') {
   const operationId=text(data.operation_id),cid=text(data.customer_id);await context(cid)
   const found=await get(db.collection('crm_operation_logs'),'refund-'+hash([cid,operationId]))
   return found?.detail||{status:'not_found',operation_id:operationId}
  }
  if(action==='previewCustomerRefundV1') return plan(data)
  const operationId=text(data.operation_id)
  if(!operationId||operationId.length>100) fail('退款操作号无效',400)
  if(data.confirm_paid!==true) fail('请确认钱已经实际退给客户',400)
  const {fix}=await context(text(data.customer_id)),value=input(data,fix),fingerprint=hash(value)
  const logId='refund-'+hash([value.customer_id,operationId])
  const tx=await db.startTransaction();let committed=false
  try {
   const store=tx.collection('crm_customer_receipts'),audit=tx.collection('crm_operation_logs')
   const prior=await get(audit,logId)
   if(prior){if(prior.detail.fingerprint!==fingerprint) fail('该操作号已有不同内容的退款');await tx.rollback();return {...prior.detail,idempotent:true}}
   const p=await plan(data,store)
   if(text(data.plan_hash)!==p.plan_hash) fail('预览已变化，请重新预览')
   const now=Date.now(),actor={updated_at:now,updated_by:user._id,updated_by_name:user.username}
   for(const change of p.changes) await store.doc(change.id).update({...change.after,...actor})
   let id=p.original_id
   if(id) await store.doc(id).update({refund_source_status:'linked',refund_sources:value.sources,...actor})
   else {
    id='refund-'+hash([value.customer_id,operationId]).slice(0,24)
    await store.add({_id:id,customer_id:value.customer_id,amount:-value.amount,biz_date:value.biz_date,payment_method:value.payment_method,
     note:value.note,voucher_ref:value.voucher_ref,status:'posted',source_type:SOURCE,entry_kind:'refund',
     allocated_amount:0,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,
     refund_source_status:value.source_pending?'pending':'linked',refund_sources:value.sources,refund_operation_id:operationId,
     created_at:now,created_by:user._id,...actor})
   }
   const detail={status:'saved',operation_id:operationId,refund_id:id,customer_id:value.customer_id,fingerprint,plan:p}
   await audit.add({_id:logId,action:p.original_id?'customer_refund_link':'customer_refund_create',created_at:now,user_id:user._id,detail})
   await tx.commit();committed=true
   // A cache refresh failure must never be represented as a failed cash registration.
   try {await refreshBalances(value.customer_id)} catch (_) {detail.balance_refresh_pending=true}
   return detail
  }catch(error){if(!committed) await tx.rollback();throw error}
 }
 return {run}
}
module.exports={createRefundService,protectedReceipt,SOURCE}
