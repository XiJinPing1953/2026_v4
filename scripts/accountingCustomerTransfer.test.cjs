'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const {loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const {pairSnapshot,buildPairPlan}=require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/pairCorrection')
const old='a'.repeat(24),dest='b'.repeat(24),sale='c'.repeat(24),receipt='d'.repeat(24),allocation='e'.repeat(24),intake='f'.repeat(24)
function fixture(){
 const tables={crm_users:[{_id:'actor',token:'test',role:'superadmin'}],crm_operation_logs:[],crm_customers:[{_id:old,name:'旧户',is_active:false,is_hidden:false,default_price_unit:'kg',should_receive_total:500,amount_received_total:500},{_id:dest,name:'新户',is_active:true,is_hidden:false,default_price_unit:'kg'}],
 crm_sale_records:[{_id:sale,customer_id:dest,date:'2026-10-15',price_unit:'kg',settlement_mode:'sale',biz_mode:'bottle',unit_price:8,out_items:[{net:62.5}],back_items:[],amount_received:500,rounding_amount:0}],
 crm_customer_receipts:[{_id:receipt,customer_id:old,customer_name:'旧户',status:'posted',entry_kind:'prepay',source_type:'cashier_intake',intake_id:intake,source_id:intake,biz_date:'2026-10-15',payment_method:'wechat',amount:500,allocated_amount:500,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,proof_images:['cloud://proof']}],
 crm_customer_allocations:[{_id:allocation,customer_id:old,receipt_id:receipt,target_type:'sale',target_id:sale,sale_id:sale,allocate_kind:'receipt',allocate_amount:500,biz_date:'2026-10-15',receipt_biz_date:'2026-10-15',sale_date:'2026-10-15'}],
 crm_cashier_intakes:[{_id:intake,customer_id:old,status:'posted',kind:'gas',receipt_id:receipt,biz_date:'2026-10-15',payment_method:'wechat',amount:500,gas_amount:500,deposit_amount:0,proof_images:['cloud://proof']}],
 crm_customer_flow_settlements:[],crm_customer_opening_debts:[],crm_customer_receipt_adjustments:[],crm_customer_deposit_accounts:[],crm_customer_deposit_entries:[],crm_collection_tasks:[],crm_collection_followups:[],crm_vouchers:[]}
 const data={customer_id:old,target_customer_id:dest,operation_id:'test-transfer-v1',receipt_id:receipt,allocation_id:allocation,intake_id:intake,sale_id:sale,confirmed_amount:500,sale_date:'2026-10-15',receipt_date:'2026-10-15',evidence:{confirmed_by_user:true,approval_sha256:'1'.repeat(64),source_sha256:'2'.repeat(64)}}
 return {tables,data}
}
test('双户修正保留编号金额日期凭证；权限、源变更、回滚、事务和幂等',async()=>{
 const {tables,data}=fixture(),db=mutableDb(tables),handler=loadHandler('crm-accounting-correction',db)
 assert.equal((await handler({action:'inspectPairV1',data})).code,403)
 tables.crm_users[0].role='finance';assert.equal((await invoke(handler,'inspectPairV1',data)).code,403);tables.crm_users[0].role='superadmin'
 let r=await invoke(handler,'inspectPairV1',data);assert.equal(r.code,0,r.msg);data.expected_snapshot_hash=r.data.snapshot_hash
 r=await invoke(handler,'preparePairV1',data);assert.equal(r.code,0,r.msg);assert.equal(r.data.writes.length,5)
 const call={customer_id:old,target_customer_id:dest,operation_id:data.operation_id,plan_hash:r.data.plan_hash}
 assert.equal((await invoke(handler,'executePairV1',call)).code,409)
 tables.crm_sale_records[0].unit_price=9;assert.equal((await invoke(handler,'rehearsePairV1',call)).code,409);tables.crm_sale_records[0].unit_price=8
 r=await invoke(handler,'rehearsePairV1',{...call,fail_after_writes:3});assert.equal(r.data.status,'interruption_rolled_back');assert.equal(tables.crm_customer_receipts[0].customer_id,old)
 r=await invoke(handler,'rehearsePairV1',call);assert.equal(r.code,0,r.msg);assert.equal(r.data.status,'rehearsed_rolled_back')
 r=await invoke(handler,'executePairV1',call);assert.equal(r.code,0,r.msg);assert.equal(r.data.status,'committed')
 for(const name of ['crm_customer_receipts','crm_customer_allocations','crm_cashier_intakes'])assert.equal(tables[name][0].customer_id,dest)
 assert.equal(tables.crm_customer_receipts[0].amount,500);assert.equal(tables.crm_customer_receipts[0].biz_date,'2026-10-15');assert.deepEqual(tables.crm_customer_receipts[0].proof_images,['cloud://proof'])
 assert.equal(tables.crm_sale_records[0].amount_received,500);assert.equal(tables.crm_customers[0].is_active,false);assert.equal(tables.crm_customers[0].should_receive_total,0)
 const after=await pairSnapshot(db,old,dest);assert.equal(after.snapshot_hash,r.data.after_snapshot_hash)
 r=await invoke(handler,'executePairV1',call);assert.equal(r.data.idempotent,true);assert.equal((await pairSnapshot(db,old,dest)).snapshot_hash,after.snapshot_hash)
 assert.equal((await invoke(handler,'preparePairV1',{...data,confirmed_amount:499})).code,409)
})
test('额外来源、错误链、退款、优惠或凭证异常均阻止修正',async()=>{
 for(const mutate of [
  t=>t.crm_customer_receipts[0].amount=501,
  t=>t.crm_customer_allocations[0].customer_id=dest,
  t=>t.crm_customer_receipts[0].proof_images=['different'],
  t=>t.crm_sale_records[0].rounding_amount=1,
  t=>t.crm_customer_receipts[0].cash_refunded_amount=1,
  t=>t.crm_customer_receipts.push({_id:'1'.repeat(24),customer_id:old}),
  t=>t.crm_customer_deposit_accounts.push({_id:'2'.repeat(24),customer_id:old}),
  t=>t.crm_customers[0].is_active=true,
 ]){const {tables,data}=fixture();mutate(tables);const db=mutableDb(tables);const snap=await pairSnapshot(db,old,dest);data.expected_snapshot_hash=snap.snapshot_hash;assert.throws(()=>buildPairPlan(snap,data,{_id:'actor'},Date.now()))}
})
test('反向关系落在范围外时拒绝读取',async()=>{const {tables}=fixture();tables.crm_customer_allocations.push({_id:'1'.repeat(24),customer_id:'9'.repeat(24),target_id:sale});await assert.rejects(pairSnapshot(mutableDb(tables),old,dest),/范围外反向关联/)})
