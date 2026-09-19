'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const {makeDb,loadHandler,invoke,saleDoc,tablesFor}=require('./lib/accountingTestHarness.cjs')
const fixture = () => tablesFor(saleDoc({ price_unit:'kg', settlement_mode:'sale', should_receive:100 }))
const params = {customer_id:'customer-1',summary_date_from:'2026-08-01',summary_date_to:'2026-08-31',page:1,pageSize:20}
test('combined statement stays below 60 reads and equals standalone rows without writes',async()=>{
 let reads=0
 const db=makeDb(fixture(),{get:(n,rows)=>{reads++;return {data:structuredClone(rows)}},count:(n,total)=>{reads++;return {total}}})
 const main=loadHandler('crm-customer-settlement',db)
 const result=await invoke(main,'getCustomerStatementV1',{...params,include_rows:true})
 assert.equal(result.code,0); assert.ok(reads<=60,`reads=${reads}`)
 console.log('statement combined database reads:',reads)
 const rows=await invoke(main,'listCustomerStatementRowsV1',{...params,date_from:params.summary_date_from,date_to:params.summary_date_to})
 assert.equal(JSON.stringify(result.data.statement_rows),JSON.stringify(rows.data))
 assert.equal(JSON.stringify(result.data.rows_paging),JSON.stringify(rows.paging))
 assert.equal(db.writes.length,0)
})
test('report contexts are isolated across requests and do not survive a changed source',async()=>{
 const tables=fixture(),db=makeDb(tables),main=loadHandler('crm-customer-settlement',db)
 const a=await invoke(main,'getCustomerStatementV1',params)
 tables.crm_sale_records.push(saleDoc({_id:'new-sale',price_unit:'kg',settlement_mode:'sale',should_receive:100}))
 const b=await invoke(main,'getCustomerStatementV1',params)
 assert.equal(a.data.recent_sales.length,1);assert.equal(b.data.recent_sales.length,2)
 assert.equal(db.writes.length,0)
})
test('more than one page remains complete and original scoped/void semantics are preserved',async()=>{
 const tables=fixture();tables.crm_sale_records=Array.from({length:501},(_,i)=>saleDoc({_id:'s'+String(i).padStart(6,'0'),price_unit:'kg',settlement_mode:'sale'}))
 tables.crm_customer_receipts=[{_id:'void',customer_id:'customer-1',status:'void',amount:900,biz_date:'2026-08-01'}]
 const r=await invoke(loadHandler('crm-customer-settlement',makeDb(tables)),'getCustomerStatementV1',{...params,include_rows:true})
 assert.equal(r.code,0);assert.equal(r.data.rows_paging.total,501);assert.equal(r.data.recent_receipts.length,0)
 assert.equal(r.financial_evidence.read_complete,true)
})
test('in-flight sharing is account scoped, cleared on failure and never combines writes',async()=>{
 let token='a',calls=[]
 const context={getToken:()=>token,handle401(){},handle403(){},console:{info(){}},Date,Math,Map,Set,Promise,
 uniCloud:{callFunction:opts=>new Promise((resolve,reject)=>calls.push({opts,resolve,reject}))}}
 let code=fs.readFileSync('src/services/api/callCloud.js','utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')+'\nthis.call=callCloud'
 vm.runInNewContext(code,context)
 const a=context.call('crm-customer-settlement',{action:'getCustomerStatementV1',data:{b:1,a:2}})
 const b=context.call('crm-customer-settlement',{action:'getCustomerStatementV1',data:{a:2,b:1}})
 assert.equal(a,b);assert.equal(calls.length,1)
 token='b';const c=context.call('crm-customer-settlement',{action:'getCustomerStatementV1',data:{a:2,b:1}});assert.equal(calls.length,2)
 calls[0].resolve({result:{code:0}});calls[1].resolve({result:{code:0}});await Promise.all([a,b,c])
 const w1=context.call('crm-customer-settlement',{action:'createReceiptV1'}),w2=context.call('crm-customer-settlement',{action:'createReceiptV1'})
 assert.equal(calls.length,4);calls[2].resolve({result:{code:0}});calls[3].resolve({result:{code:0}});await Promise.all([w1,w2])
 const fail=context.call('crm-customer-settlement',{action:'getCustomerStatementV1'});calls[4].reject(new Error('offline'));await assert.rejects(fail)
 const retry=context.call('crm-customer-settlement',{action:'getCustomerStatementV1'});assert.equal(calls.length,6);calls[5].resolve({result:{code:0}});await retry
})
