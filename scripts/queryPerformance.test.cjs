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

test('customer selector skips statistics and bottles; full list batches and reads >500 bottles completely',async()=>{
 const tables={crm_users:[{_id:'u',token:'test',role:'superadmin'}],crm_customers:Array.from({length:20},(_,i)=>({_id:'c'+i,name:'Customer'+i,is_active:true})),crm_bottles:Array.from({length:601},(_,i)=>({_id:'b'+String(i).padStart(5,'0'),bottle_no:String(i),current_customer_id:'c0'}))}
 let bottleReads=0
 const db=makeDb(tables,{get:(n,rows)=>{if(n==='crm_bottles')bottleReads++;return {data:structuredClone(rows)}}}),main=loadHandler('crm-customer',db)
 const light=await invoke(main,'listV1',{page:1,pageSize:20,include_summary:false,include_deposit:false})
 assert.equal(light.code,0);assert.equal(bottleReads,0);assert.equal(light.summary,null)
 const full=await invoke(main,'listV1',{page:1,pageSize:20})
 assert.equal(full.code,0);assert.equal(full.data.find(x=>x._id==='c0').deposit_count,601);assert.ok(bottleReads<=5,bottleReads)
})
test('light sale and filling pages omit unrelated statistics but keep pagination',async()=>{
 for(const [name,action,data] of [['crm-sale','listV2',{dateStart:'2026-08-01',dateEnd:'2026-08-31'}],['crm-filling','listV1',{}],['crm-bottle','listV1',{}]]) {
  const db=makeDb(fixture()),r=await invoke(loadHandler(name,db),action,{...data,page:1,pageSize:20,include_summary:false})
  assert.equal(r.code,0,name+': '+r.msg);assert.equal(r.summary,null,name);assert.ok(r.paging);assert.equal(db.writes.length,0)
 }
})
test('summary loads independently, pagination reuses it and changed filters reject stale results',async()=>{
 const jobs=[],seen=[];let epoch=0
 const context={ref:v=>({value:v}),getToken:()=> 'account',getQueryEpoch:()=>epoch,Promise,JSON}
 vm.runInNewContext(fs.readFileSync('src/composables/usePagedSummary.js','utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')+'\nthis.use=usePagedSummary',context)
 const reader=context.use(p=>p.summaryOnly?new Promise(resolve=>jobs.push({p,resolve})):Promise.resolve({code:0,data:[p.page]}),s=>seen.push(s))
 const first=await reader.read({date:'a',page:1,pageSize:20});assert.deepEqual(first.data,[1]);assert.equal(reader.pending.value,true)
 await reader.read({date:'a',page:2,pageSize:20});assert.equal(jobs.length,1)
 await reader.read({date:'b',page:1,pageSize:20});assert.equal(jobs.length,2)
 jobs[0].resolve({code:0,summary:{marker:'old'}});jobs[1].resolve({code:0,summary:{marker:'new'}})
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(seen,[{marker:'new'}])
 epoch++;await reader.read({date:'b',page:2,pageSize:20});assert.equal(jobs.length,3)
 jobs[2].resolve({code:409,msg:'incomplete'});await new Promise(resolve=>setImmediate(resolve));assert.equal(reader.error.value,'incomplete');assert.equal(seen.length,1)
})
test('quick dashboard status never reads sales, fillings or financial histories',async()=>{
 const readNames=[]
 const db=makeDb(fixture(),{get:(name,rows)=>{readNames.push(name);return {data:structuredClone(rows)}}})
 const r=await invoke(loadHandler('crm-dashboard',db),'summaryV1',{section:'quick'})
 assert.equal(r.code,0);assert.equal(r.data.section,'quick')
 assert.ok(!readNames.some(name=>['crm_sale_records','crm_fillings','crm_customer_receipts','crm_customer_flow_settlements'].includes(name)))
 assert.equal(db.writes.length,0)
})
