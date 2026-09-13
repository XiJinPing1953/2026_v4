'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')
function fixture() {
 const tables = tablesFor(saleDoc({settlement_mode:'sale',unit_price:1,flow_volume_m3:100,amount_received:100}))
 const base = {customer_id:'customer-1',status:'posted',created_at:1,updated_at:1,biz_date:'2026-01-01'}
 tables.crm_customer_opening_debts=[{...base,_id:'adjustment',source_type:'balance_adjustment',entry_kind:'balance_adjustment',amount:21,amount_received:0,receipt_rounding_amount:0}]
 tables.crm_customer_receipts=[{...base,_id:'cash',amount:121,allocated_amount:100,unallocated_amount:21,source_type:'manual',entry_kind:'prepay'}]
 tables.crm_customer_allocations=[{...base,_id:'sale-paid',receipt_id:'cash',target_type:'sale',target_id:tables.crm_sale_records[0]._id,allocate_kind:'receipt',allocate_amount:100}]
 const db=mutableDb(tables),handler=loadHandler('crm-customer-settlement',db)
 return {tables,db,handler}
}
test('noncash debit adjustment accepts existing cash allocation, consumes prepay and stays outside cash/revenue/history',async()=>{
 const {tables,handler}=fixture()
 const applied=await invoke(handler,'allocatePrepayReceiptV1',{customer_id:'customer-1',receipt_id:'cash',amount:21,allocation_mode:'checked',allocation_targets:[{target_type:'balance_adjustment',target_id:'adjustment'}]})
 assert.equal(applied.code,0,applied.msg)
 assert.equal(tables.crm_customer_opening_debts[0].amount_received,21)
 assert.equal(tables.crm_customer_receipts[0].amount,121)
 assert.equal(tables.crm_customer_receipts[0].unallocated_amount,0)
 assert.equal(tables.crm_customers[0].prepay_balance,0)
 assert.equal(tables.crm_customers[0].net_balance,0)
 assert.equal(tables.crm_customers[0].should_receive_total,100)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']) {
  const result=await invoke(handler,action,{customer_id:'customer-1',date_from:'2025-01-01',date_to:'2026-12-31',summary_only:true})
  assert.equal(result.code,0,result.msg)
  const p=result.data.period_summary
  assert.equal(p.complete,true,JSON.stringify(p.unresolved_sources))
  assert.equal(p.business_revenue,100);assert.equal(p.historical_receivable,0)
  assert.equal(p.noncash_balance_adjustment,21);assert.equal(p.receivable_total,121)
  assert.equal(p.cash_received,121);assert.equal(p.refund_total,0);assert.equal(p.rounding_total,0)
  if(action==='exportCustomerStatementV1') { assert.equal(result.data.totals.balance_adjustment,21);assert.equal(result.data.totals.amount,100);assert.equal(result.data.closing_balance,0) }
  if(action==='exportCustomerAccountingLedgerV1') {assert.equal(result.data.closing.balance,0);assert.match(result.data.rows.find(row=>row.source_type==='balance_adjustment').summary,/非现金余额调整/) }
 }
})
test('ordinary debt mutation cannot forge or alter protected adjustment',async()=>{
 const {tables,db,handler}=fixture(),before=structuredClone(tables)
 const result=await invoke(handler,'updateOpeningDebtEntryV1',{customer_id:'customer-1',opening_debt_id:'adjustment',amount:20,biz_date:'2026-01-01'})
 assert.notEqual(result.code,0);assert.deepEqual(tables,before);assert.equal(db.writes.length,0)
})
