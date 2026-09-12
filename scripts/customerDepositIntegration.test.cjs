'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
function fixture() {
 return {crm_users:[{_id:'user-1',token:'test',role:'superadmin'}],crm_customers:[{_id:'customer-1',name:'客户1',default_price_unit:'kg'}],crm_sale_records:[{_id:'sale-1',customer_id:'customer-1',date:'2026-08-01',price_unit:'kg',settlement_mode:'sale',unit_price:10,out_items:[{net:300}],back_items:[],amount_received:0}],crm_customer_receipts:[{_id:'transfer-1',customer_id:'customer-1',status:'posted',source_type:'deposit_transfer',entry_kind:'prepay',biz_date:'2026-08-02',amount:3000,allocated_amount:0,unallocated_amount:3000,rounding_amount:0,rounding_allocated_amount:0}],crm_customer_allocations:[],crm_customer_flow_settlements:[],crm_customer_opening_debts:[],crm_customer_deposit_accounts:[],crm_customer_deposit_entries:[]}
}
const period={customer_id:'customer-1',date_from:'2026-01-01',date_to:'2026-09-12',summary_only:true}
test('押金转气款在三入口不计现金、不计退款、独立列示且导出保留气款贷方',async()=>{
 const t=fixture(),before=structuredClone(t),db=makeDb(t),h=loadHandler('crm-customer-settlement',db)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']) {
  const r=await invoke(h,action,period);assert.equal(r.code,0,r.msg)
  assert.equal(r.data.period_summary.cash_received,0);assert.equal(r.data.period_summary.refund_total,0);assert.equal(r.data.period_summary.deposit_transferred,3000)
  assert.equal(r.data.deposit_summary.read_complete,true);assert.equal(r.data.deposit_summary.account_initialized,false)
  if(action==='exportCustomerAccountingLedgerV1')assert.equal(r.data.rows.find(row=>row.source_id==='transfer-1').source_type,'deposit_transfer')
  if(action==='exportCustomerStatementV1') {assert.equal(r.data.totals.cash_received,0);assert.equal(r.data.totals.deposit_transfer,3000)}
 }
 assert.equal(db.writes.length,0);assert.deepEqual(t,before)
})
test('押金来源不能从旧气款入口创建、改值或删除',async()=>{
 const t=fixture(),before=structuredClone(t),h=loadHandler('crm-customer-settlement',makeDb(t,{mutate:true}))
 for(const [action,data] of [
  ['createReceiptV1',{...period,amount:10,biz_date:'2026-08-02',payment_method:'unknown',allocation_mode:'checked',allocation_targets:[{target_type:'sale',target_id:'sale-1'}],source_type:'deposit_transfer'}],
  ['confirmAllocationV1',{...period,amount:10,biz_date:'2026-08-02',payment_method:'unknown',allocation_mode:'checked',allocation_targets:[{target_type:'sale',target_id:'sale-1'}],source_type:'deposit_transfer'}],
  ['createPrepayEntryV1',{...period,amount:10,biz_date:'2026-08-02',payment_method:'unknown',allocation_mode:'checked',allocation_targets:[{target_type:'sale',target_id:'sale-1'}],source_type:'deposit_transfer'}],
  ['updateReceiptV1',{...period,receipt_id:'transfer-1',amount:3001}],
  ['removeReceiptV1',{...period,receipt_id:'transfer-1'}],
  ['beginReceiptAdjustmentV1',{...period,receipt_id:'transfer-1'}]
 ]) {const r=await invoke(h,action,data);assert.notEqual(r.code,0,action);assert.match(r.msg,/押金/,action)}
 assert.deepEqual(t,before)
})
const allocation={customer_id:'customer-1',receipt_id:'transfer-1',amount:3000,allocation_mode:'checked',allocation_targets:[{target_type:'sale',target_id:'sale-1'}]}
test('押金转气款可用现有手工分配，原来源保留，不再次计收款',async()=>{
 const t=fixture(),h=loadHandler('crm-customer-settlement',makeDb(t,{mutate:true,transaction:true}))
 const r=await invoke(h,'allocatePrepayReceiptV1',allocation);assert.equal(r.code,0,r.msg)
 assert.equal(t.crm_sale_records[0].amount_received,3000);assert.equal(t.crm_customer_receipts[0].unallocated_amount,0);assert.equal(t.crm_customer_receipts[0].source_type,'deposit_transfer');assert.equal(t.crm_customer_allocations.length,1)
 const p=(await invoke(h,'getCustomerStatementV1',period)).data.period_summary;assert.equal(p.cash_received,0);assert.equal(p.deposit_transferred,3000)
})
test('转款后分配事务中断完整回滚源单、债权与分配',async()=>{
 const t=fixture(),before=structuredClone(t),h=loadHandler('crm-customer-settlement',makeDb(t,{mutate:true,transaction:true,txWrite:(kind,name)=>{if(name==='crm_customer_allocations')throw new Error('模拟中断')}}))
 await assert.rejects(invoke(h,'allocatePrepayReceiptV1',allocation),/模拟中断/);assert.deepEqual(t,before)
})
test('旧查询期间来源变动时，不用过期转款快照完成分配',async()=>{
 const t=fixture(),before=structuredClone(t);let reads=0
 const db=makeDb(t,{mutate:true,transaction:true,get:(name,rows)=>{if(name==='crm_customer_receipts'&&rows.some(row=>row._id==='transfer-1')&&++reads===2) rows[0]={...rows[0],status:'void'};return {data:structuredClone(rows)}}})
 const h=loadHandler('crm-customer-settlement',db)
 const r=await invoke(h,'allocatePrepayReceiptV1',allocation).catch(e=>({code:e.code,msg:e.message}));assert.notEqual(r.code,0);assert.deepEqual(t,before)
})

test('普通气款确认仍成功，押金保护不会改变原兼容入口',async()=>{
 const t=fixture(),h=loadHandler('crm-customer-settlement',makeDb(t,{mutate:true,transaction:true}))
 const r=await invoke(h,'confirmAllocationV1',{customer_id:'customer-1',amount:10,biz_date:'2026-08-02',allocation_mode:'checked',allocation_targets:[{target_type:'sale',target_id:'sale-1'}]})
 assert.equal(r.code,0,r.msg);assert.ok(r.data.receipt_id)
})

test('两种导出缺押金字段未完成；空账户不声称客户押金为零',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),context={};vm.createContext(context)
 const read=file=>fs.readFileSync(path.resolve(__dirname,'../src',file),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')
 for(const file of ['services/mappers/customerPeriodSummary.js','services/mappers/customerDeposit.js','components/domain/customer/statement/exportWorkbook.js'])vm.runInContext(read(file),context)
 vm.runInContext('this.builders=[buildCustomerStatementWorkbookXml,buildCustomerAccountingLedgerWorkbookXml]',context)
 const h=loadHandler('crm-customer-settlement',makeDb(fixture()))
 for(const [i,action] of ['exportCustomerStatementV1','exportCustomerAccountingLedgerV1'].entries()) {
  const p=(await invoke(h,action,period)).data,xml=context.builders[i](p)
  assert.match(xml,/<Worksheet ss:Name="押金独立账"/);assert.match(xml,/尚未登记，历史押金未核实/)
  const invalid={...p,deposit_summary:{...p.deposit_summary,date_from:'2025-01-01'}}
  assert.match(context.builders[i](invalid),/当前押金余额（全历史）<\/Data><\/Cell><Cell><Data ss:Type="String">未完成/)
 }
})
test('转气款来源只能分配原本金，独立抹零不会让押金流水失真',async()=>{
 const t=fixture(),before=structuredClone(t),h=loadHandler('crm-customer-settlement',makeDb(t,{mutate:true,transaction:true}))
 const r=await invoke(h,'allocatePrepayReceiptV1',{...allocation,rounding_amount:1});assert.equal(r.code,400);assert.match(r.msg,/押金/);assert.deepEqual(t,before)
})

test('真实押金入口串联收退转气款，页面三入口及两导出与气款余额一致',async()=>{
 const t=fixture();t.crm_customer_receipts=[];Object.assign(t.crm_customers[0],{receivable_balance:3000,net_balance:3000,prepay_balance:0})
 const db=makeDb(t,{mutate:true,transaction:true}),deposit=loadHandler('crm-customer-deposit',db),gas=loadHandler('crm-customer-settlement',db)
 let version=0,receiptId
 for(const [kind,amount] of [['receive',20000],['refund',5000],['transfer',3000]]) {
  const input={customer_id:'customer-1',kind,amount,biz_date:'2026-08-02',payment_method:kind==='transfer'?'unknown':'bank',note:'独立收退转款依据',operation_id:'integration-real-'+kind,expected_version:version}
  const preview=await invoke(deposit,'previewDepositEntryV1',input);assert.equal(preview.code,0,preview.msg)
  const r=await invoke(deposit,'createDepositEntryV1',preview.data.submission);assert.equal(r.code,0,r.msg);version=r.data.version;if(r.data.receipt_id)receiptId=r.data.receipt_id
 }
 assert.equal(t.crm_customers[0].prepay_balance,3000);assert.equal(t.crm_customers[0].net_balance,0)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']) {
  const r=await invoke(gas,action,period);assert.equal(r.code,0,r.msg);assert.equal(r.data.deposit_summary.current_balance,12000);assert.equal(r.data.deposit_summary.received_total,20000);assert.equal(r.data.deposit_summary.refunded_total,5000);assert.equal(r.data.period_summary.cash_received,0);assert.equal(r.data.period_summary.refund_total,0)
 }
 const applied=await invoke(gas,'allocatePrepayReceiptV1',{...allocation,receipt_id:receiptId});assert.equal(applied.code,0,applied.msg)
 const after=await invoke(deposit,'getDepositStatementV1',period);assert.equal(after.code,0,after.msg);assert.equal(after.data.current_balance,12000)
 const snapshot=structuredClone(t),transfer=t.crm_customer_deposit_entries.find(e=>e.kind==='transfer')
 const rejected=await invoke(deposit,'voidDepositEntryV1',{customer_id:'customer-1',entry_id:transfer._id,reason:'原转款已分配，核对保护',operation_id:'integration-void-allocated',expected_version:3});assert.equal(rejected.code,409);assert.deepEqual(t,snapshot)
})

test('按m³的三位气款分配保留来源余额精度，押金金额继续使用分',async()=>{
 const t=fixture();t.crm_sale_records=[];t.crm_customer_receipts=[];Object.assign(t.crm_customers[0],{default_price_unit:'m3',receivable_balance:1.234,net_balance:1.234});t.crm_customer_flow_settlements=[{_id:'flow-1',customer_id:'customer-1',biz_date:'2026-08-01',status:'posted',should_receive:1.234,amount_received:0}]
 const db=makeDb(t,{mutate:true,transaction:true}),deposit=loadHandler('crm-customer-deposit',db),gas=loadHandler('crm-customer-settlement',db);let receiptId
 for(const [i,kind] of ['receive','transfer'].entries()) {const r=await invoke(deposit,'createDepositEntryV1',{customer_id:'customer-1',kind,amount:3,biz_date:'2026-08-02',payment_method:'unknown',note:'三位精度核查',operation_id:'integration-milli-'+kind,expected_version:i});assert.equal(r.code,0,r.msg);if(r.data.receipt_id)receiptId=r.data.receipt_id}
 const r=await invoke(gas,'allocatePrepayReceiptV1',{...allocation,amount:1.234,receipt_id:receiptId,allocation_targets:[{target_type:'flow_settlement',target_id:'flow-1'}]});assert.equal(r.code,0,r.msg)
 assert.equal(t.crm_customer_receipts[0].allocated_amount,1.234);assert.equal(t.crm_customer_receipts[0].unallocated_amount,1.766)
 const p=await invoke(deposit,'getDepositStatementV1',period);assert.equal(p.code,0,p.msg);assert.equal(p.data.current_balance,0)
})


test('支付宝事务单对象返回仍完成转款来源与销售债权分配',async()=>{
 const t=fixture(),h=loadHandler('crm-customer-settlement',makeDb(t,{mutate:true,transaction:true,txDocumentObject:true}))
 const r=await invoke(h,'allocatePrepayReceiptV1',allocation);assert.equal(r.code,0,r.msg)
 assert.equal(t.crm_sale_records[0].amount_received,3000);assert.equal(t.crm_customer_receipts[0].unallocated_amount,0);assert.equal(t.crm_customer_allocations.length,1)
})
