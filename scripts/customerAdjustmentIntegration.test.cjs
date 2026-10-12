'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const {loadHandler,saleDoc,tablesFor,invoke}=require('./lib/accountingTestHarness.cjs')
function fixture(){
 const tables=tablesFor(saleDoc({settlement_mode:'sale',price_unit:'kg',out_items:[{net:22942.5}],unit_price:1,should_receive:22942.5,amount_received:22940,receipt_rounding_amount:2.5,date:'2026-07-22'}))
 Object.assign(tables.crm_customers[0],{default_price_unit:'kg',prepay_balance:960,unallocated_receipt_balance:960,receivable_balance:0,net_balance:-960})
 const base={customer_id:'customer-1',biz_date:'2026-08-18',status:'posted',created_at:1,updated_at:1}
 tables.crm_customer_receipts=[{...base,_id:'cash',amount:23900,allocated_amount:22940,unallocated_amount:960,rounding_amount:2.5,rounding_allocated_amount:2.5,source_type:'manual',entry_kind:'prepay',payment_method:'bank'}]
 tables.crm_customer_allocations=[{...base,_id:'paid',receipt_id:'cash',target_type:'sale',target_id:'sale-1',allocate_kind:'receipt',allocate_amount:22940},{...base,_id:'rounding',receipt_id:'cash',target_type:'sale',target_id:'sale-1',allocate_kind:'rounding',allocate_amount:2.5}]
 const db=mutableDb(tables);return {tables,db,handler:loadHandler('crm-customer-settlement',db)}
}
async function prepare(handler,kind,amount,date='2026-08-18'){
 const sources=await invoke(handler,'getCustomerAdjustmentSourcesV1',{customer_id:'customer-1',kind});assert.equal(sources.code,0,sources.msg)
 const source=sources.data.sources.find(r=>r.available>=amount);assert.ok(source,JSON.stringify(sources.data))
 const input={customer_id:'customer-1',kind,source_key:source.source_key,source_version:source.version,amount,biz_date:date,note:'双方协商确认',evidence:'测试确认凭据',confirm_no_refund_or_offset:true}
 const preview=await invoke(handler,'previewCustomerAdjustmentV1',input);assert.equal(preview.code,0,preview.msg)
 return {...input,plan_hash:preview.data.plan_hash,operation_id:`test_${kind}_${amount}`}
}
async function readAll(handler,from='2026-01-01',to='2026-12-31'){
 const result=[]
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
 const r=await invoke(handler,action,{customer_id:'customer-1',date_from:from,date_to:to,summary_only:true});assert.equal(r.code,0,r.msg);result.push(r.data)
 }
 assert.deepEqual(result[0].period_summary.rounding_total,result[1].period_summary.rounding_total)
 return result
}
test('付佳核算：23900现金、22942.50货款、2.50优惠和960结清三入口一致且不重复现金',async()=>{
 const {tables,handler}=fixture(),input=await prepare(handler,'prepay_writeoff',960)
 const posted=await invoke(handler,'postCustomerAdjustmentV1',input);assert.equal(posted.code,0,posted.msg)
 const again=await invoke(handler,'postCustomerAdjustmentV1',input);assert.equal(again.code,0,again.msg);assert.equal(again.data.idempotent,true)
 assert.equal(tables.crm_customer_receipts[0].amount,23900);assert.equal(tables.crm_customer_receipts[0].biz_date,'2026-08-18');assert.equal(tables.crm_customer_receipts[0].payment_method,'bank');assert.equal(tables.crm_customer_receipts[0].unallocated_amount,0)
 const results=await readAll(handler)
 for(const d of results){const p=d.period_summary;assert.equal(p.complete,true,JSON.stringify(p.unresolved_sources));assert.equal(p.business_revenue,22942.5);assert.equal(p.cash_received,23900);assert.equal(p.rounding_total,2.5);assert.equal(p.rounding_net_total,2.5);assert.equal(p.settlement_writeoff_income,960);assert.equal(p.receivable_total,22942.5)}
 assert.equal(results[1].closing_balance,0);assert.equal(results[1].totals.settlement_writeoff_income,960);assert.equal(results[1].totals.amount,22942.5)
 assert.equal(results[2].closing.balance,0);assert.equal(results[2].rows.filter(r=>r.source_type==='prepay_writeoff').length,1)
 const rows=await invoke(handler,'listCustomerStatementRowsV1',{customer_id:'customer-1',row_type:'prepay_writeoff'});assert.equal(rows.data.length,1);assert.equal(rows.data[0].meta.adjustment_source.receipt_id,'cash')
 const before=structuredClone(tables),blocked=await invoke(handler,'updateReceiptV1',{customer_id:'customer-1',receipt_id:'cash',amount:1,biz_date:'2026-08-18'});assert.equal(blocked.code,409);assert.deepEqual(tables,before)
})
test('部分跨期冲回不改原减免，恢复应收并保持现金日期，旧销售修改受保护',async()=>{
 const {tables,db,handler}=fixture(),input=await prepare(handler,'rounding_reversal',1,'2026-09-01')
 const saved=await invoke(handler,'postCustomerAdjustmentV1',input);assert.equal(saved.code,0,saved.msg)
 assert.equal(tables.crm_sale_records[0].receipt_rounding_amount,2.5);assert.equal(tables.crm_customers[0].receivable_balance,1)
 const august=await readAll(handler,'2026-08-01','2026-08-31'),september=await readAll(handler,'2026-09-01','2026-09-30')
 assert.equal(august[0].period_summary.rounding_total,2.5);assert.equal(august[0].period_summary.rounding_reversal_total,0)
 for(const d of september){const p=d.period_summary;assert.equal(p.cash_received,0);assert.equal(p.business_revenue,0);assert.equal(p.rounding_reversal_total,1);assert.equal(p.rounding_net_total,-1);assert.equal(p.receivable_total,1)}
 assert.equal(september[1].totals.rounding_reversal,1);assert.equal(september[1].closing_balance,-959)
 const before=structuredClone(tables),saleHandler=loadHandler('crm-sale',db)
 const blocked=await invoke(saleHandler,'updateSettlementV1',{recordId:'sale-1',amount_received:10});assert.equal(blocked.code,409);assert.deepEqual(tables,before)
})
