'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const fixture=()=>({crm_users:[{_id:'testactor',username:'test',token:'test',role:'superadmin'}],crm_customers:[{_id:'customer-1',name:'退款测试',price_unit:'kg'}],crm_sale_records:[],crm_customer_receipts:[
 {_id:'offset',customer_id:'customer-1',status:'posted',amount:580,allocated_amount:0,unallocated_amount:580,source_type:'sale_offset_credit',entry_kind:'offset_credit',biz_date:'2026-08-26'},
 {_id:'cash',customer_id:'customer-1',status:'posted',amount:500,allocated_amount:0,unallocated_amount:500,source_type:'cashier_intake',entry_kind:'prepay',biz_date:'2026-09-08'}],crm_customer_allocations:[],crm_customer_flow_settlements:[],crm_customer_opening_debts:[],crm_operation_logs:[]})
const draft={customer_id:'customer-1',amount:600,biz_date:'2026-09-16',payment_method:'bank',note:'退回余额',voucher_ref:'测试凭据',source_pending:false}
async function prepare(h,value){const r=await invoke(h,'previewCustomerRefundV1',value);assert.equal(r.code,0,r.msg);return{...value,plan_hash:r.data.plan_hash,operation_id:'op-1',confirm_paid:true}}
test('跨来源退款、重复提交、部分余额、报表一致与来源待核补关联',async()=>{
 const t=fixture(),h=loadHandler('crm-customer-settlement',mutableDb(t));let list=await invoke(h,'listCustomerRefundsV1',{customer_id:'customer-1'});assert.equal(list.code,0,list.msg)
 const sources=list.data.sources.map(x=>({id:x.id,version:x.version,amount:x.id==='offset'?580:20})),req=await prepare(h,{...draft,sources})
 let r=await invoke(h,'createCustomerRefundV1',req);assert.equal(r.code,0,r.msg)
 assert.equal(t.crm_customer_receipts.find(x=>x._id==='offset').unallocated_amount,0)
 assert.equal(t.crm_customer_receipts.find(x=>x._id==='cash').unallocated_amount,480)
 assert.equal((await invoke(h,'createCustomerRefundV1',req)).data.idempotent,true)
 assert.equal((await invoke(h,'createCustomerRefundV1',{...req,amount:601})).code,400)
 assert.equal((await invoke(h,'removeReceiptV1',{customer_id:'customer-1',receipt_id:'cash'})).code,409)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
  r=await invoke(h,action,{customer_id:'customer-1',date_from:'2026-01-01',date_to:'2026-09-16'});assert.equal(r.code,0,r.msg);assert.equal(r.data.period_summary.refund_total,600);assert.equal(r.data.period_summary.cash_received,500);assert.equal(r.data.period_summary.net_cash_received,-100)
 }
 const pending=await prepare(h,{...draft,amount:80,source_pending:true,sources:[]});pending.operation_id='pending-2';r=await invoke(h,'createCustomerRefundV1',pending);assert.equal(r.code,0,r.msg);const id=r.data.refund_id
 assert.equal(t.crm_customer_receipts.find(x=>x._id==='cash').unallocated_amount,480)
 list=await invoke(h,'listCustomerRefundsV1',{customer_id:'customer-1'});const source=list.data.sources.find(x=>x.id==='cash')
 const linked=await prepare(h,{...draft,amount:80,link_refund_id:id,sources:[{id:'cash',amount:80,version:source.version}]});linked.operation_id='link-3'
 assert.equal((await invoke(h,'createCustomerRefundV1',linked)).code,0)
 assert.equal(t.crm_customer_receipts.filter(x=>x.source_type==='customer_cash_refund').length,2)
 assert.equal(t.crm_customer_receipts.find(x=>x._id==='cash').unallocated_amount,400)
 assert.equal((await invoke(h,'createCustomerRefundV1',linked)).data.idempotent,true)
 r=await invoke(h,'getCustomerStatementV1',{customer_id:'customer-1',date_from:'2026-01-01',date_to:'2026-09-16'});assert.equal(r.data.period_summary.refund_total,680)
})
test('原值冲突、超退、跨客户、无效日期与事务回滚',async()=>{
 const t=fixture(),db=mutableDb(t),h=loadHandler('crm-customer-settlement',db);const list=(await invoke(h,'listCustomerRefundsV1',{customer_id:'customer-1'})).data
 const source=list.sources.find(x=>x.id==='cash'),value={...draft,amount:50,sources:[{id:'cash',version:source.version,amount:50}]},req=await prepare(h,value)
 t.crm_customer_receipts[1].updated_at=1;assert.equal((await invoke(h,'createCustomerRefundV1',req)).code,409);t.crm_customer_receipts[1].updated_at=0
 assert.equal((await invoke(h,'previewCustomerRefundV1',{...value,biz_date:'2026-02-30'})).code,400)
 assert.equal((await invoke(h,'previewCustomerRefundV1',{...value,amount:501,sources:[{...value.sources[0],amount:501}]})).code,409)
 t.crm_customer_receipts[1].customer_id='other';assert.equal((await invoke(h,'previewCustomerRefundV1',value)).code,409)
 const t2=fixture();let n=0;const fail=loadHandler('crm-customer-settlement',mutableDb(t2,{txWrite:()=>{if(++n===2)throw Error('injected')}}));const req2=await prepare(fail,value)
 const before=JSON.stringify(t2);assert.equal((await invoke(fail,'createCustomerRefundV1',req2)).code,500);assert.equal(JSON.stringify(t2),before)
})
test('已退款来源剩余余额仍可分配、旧编辑不能恢复额度，未知来源不隐藏真实退款',async()=>{
 const t=fixture(),h=loadHandler('crm-customer-settlement',mutableDb(t))
 const source=(await invoke(h,'listCustomerRefundsV1',{customer_id:'customer-1'})).data.sources.find(x=>x.id==='cash')
 const req=await prepare(h,{...draft,amount:100,sources:[{id:'cash',version:source.version,amount:100}]});assert.equal((await invoke(h,'createCustomerRefundV1',req)).code,0)
 t.crm_sale_records.push({_id:'sale-1',customer_id:'customer-1',date:'2026-09-16',biz_mode:'bottle',price_unit:'m3',settlement_mode:'sale',flow_volume_m3:10,unit_price:10,amount_received:0,payment_status:'unpaid'})
 let r=await invoke(h,'allocatePrepayReceiptV1',{customer_id:'customer-1',receipt_id:'cash',amount:100,allocation_mode:'selected',allocation_targets:[{target_type:'sale',target_id:'sale-1'}],biz_date:'2026-09-16'})
 assert.equal(r.code,0,r.msg);assert.equal(t.crm_customer_receipts.find(x=>x._id==='cash').unallocated_amount,300)
 assert.equal((await invoke(h,'updateReceiptIntakeV1',{receipt_id:'cash',customer_id:'customer-1',amount:500})).code,409)
 const unknown=await prepare(h,{...draft,amount:30,source_pending:true,sources:[]});unknown.operation_id='pending-4';assert.equal((await invoke(h,'createCustomerRefundV1',unknown)).code,0)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){r=await invoke(h,action,{customer_id:'customer-1',date_from:'2026-01-01',date_to:'2026-09-16'});assert.equal(r.code,0,r.msg);assert.equal(r.data.period_summary.refund_total,130);assert.equal(r.data.period_summary.refund_source_pending_total,30);assert.equal(r.data.period_summary.balance_source_complete,false)}
})
test('退款权限、待调整来源、三位金额与只读预览',async()=>{
 const t=fixture();t.crm_users.push({_id:'limited',token:'limited',username:'limited',role:'user'});const db=mutableDb(t),h=loadHandler('crm-customer-settlement',db)
 assert.equal((await h({token:'limited',action:'createCustomerRefundV1',data:draft})).code,403)
 t.crm_customers[0].default_price_unit='m3';t.crm_customer_receipts[1].amount=0.021;t.crm_customer_receipts[1].unallocated_amount=0.021
 const source=(await invoke(h,'listCustomerRefundsV1',{customer_id:'customer-1'})).data.sources.find(x=>x.id==='cash'),value={...draft,amount:0.021,sources:[{id:'cash',amount:0.021,version:source.version}]}
 const before=JSON.stringify(t);const req=await prepare(h,value);assert.equal(JSON.stringify(t),before)
 assert.equal((await invoke(h,'createCustomerRefundV1',req)).code,0)
 assert.equal(t.crm_customer_receipts.find(x=>x._id==='cash').unallocated_amount,0)
 t.crm_customer_receipts[0].receipt_adjustment_status='pending';assert.equal((await invoke(h,'listCustomerRefundsV1',{customer_id:'customer-1'})).data.sources.length,0)
})
