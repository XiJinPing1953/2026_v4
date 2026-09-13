'use strict'
const {snapshot}=require('./snapshot')
const {VERSION,ACTION,digest,fingerprint,fromTables}=require('./accountingReviewLocal')
const first=r=>Array.isArray(r?.data)?r.data[0]:r?.data
module.exports=async(db,user,data)=>{
 if(!/^[a-zA-Z0-9_-]{8,80}$/.test(data.operation_id||'') || !/^[a-f0-9]{64}$/.test(data.approval_sha256||''))throw Error('缺少固定核准编号或确认依据')
 const logId='manual_review_'+digest([data.customer_id,data.operation_id]).slice(0,24), logs=db.collection('crm_operation_logs')
 const requestHash=digest(data), old=first(await logs.doc(logId).get())
 if(old){if(old.detail?.request_hash!==requestHash)throw Error('核准编号已用于其他请求');return{code:0,data:{status:'approved',idempotent:true,review_id:logId}}}
 const before=await snapshot(db,data.customer_id)
 if(before.snapshot_hash!==data.expected_snapshot_hash)throw Error('原值变化，不能核准')
 if(!Array.isArray(data.items)||!data.items.length||data.items.length>50||new Set(data.items.map(x=>x.source_id)).size!==data.items.length)throw Error('核准范围无效')
 const t=before.tables
 for(const x of data.items){
  const sale=t.crm_sale_records.find(s=>s._id===x.source_id)
  if(!sale||x.source_type!=='sale'||x.reason!=='receipt_date_missing'||!Number.isFinite(x.amount)||x.amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(x.biz_date||'')||new Date(x.biz_date+'T00:00:00Z').toISOString().slice(0,10)!==x.biz_date||x.biz_date<sale.date||!String(x.voucher||'').trim())throw Error('核准销售、金额或会计日期无效')
  const backed=t.crm_customer_allocations.filter(a=>(!a.status||a.status==='posted')&&(a.allocate_kind||'receipt')==='receipt'&&(a.target_type||'sale')==='sale'&&(a.target_id||a.sale_id)===sale._id&&t.crm_customer_receipts.some(r=>r._id===a.receipt_id&&r.status==='posted')).reduce((s,a)=>s+Number(a.allocate_amount||0),0)
  if(Math.round((Number(sale.amount_received||0)-backed)*100)!==Math.round(x.amount*100))throw Error('核准金额与缺凭据已收不符')
 }
 const again=await snapshot(db,data.customer_id);if(again.snapshot_hash!==before.snapshot_hash)throw Error('读取期间原值变化')
 const log={_id:logId,action:ACTION,customer_id:data.customer_id,status:'posted',created_at:Date.now(),user_id:user._id,
  detail:{version:VERSION,request_hash:requestHash,fingerprint:fingerprint(fromTables(t)),source_snapshot_hash:before.snapshot_hash,approval_sha256:data.approval_sha256,items:data.items}}
 await logs.add(log)
 return{code:0,data:{status:'approved',review_id:logId,financial_writes:0,reviewed_count:data.items.length},rule_version:VERSION}
}
