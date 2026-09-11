'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {TABLES,digest,batchId,snapshotHash,buildPlan,expectedAfter}=require('../uniCloud-alipay/cloudfunctions/crm-legacy-receipt-conversion/plan')
const {prepare,execute}=require('../uniCloud-alipay/cloudfunctions/crm-legacy-receipt-conversion/transaction')
const {makeDb,loadHandler,invoke,saleDoc,tablesFor}=require('./lib/accountingTestHarness.cjs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const clone=value=>JSON.parse(JSON.stringify(value))
function fixture() {
 const t=tablesFor(saleDoc());t.crm_customers[0]={_id:'customer-1',name:'合成客户',default_price_unit:'kg',updated_at:1}
 const base={customer_id:'customer-1',status:'posted',created_at:1,updated_at:1}
 const sale=(id,date,amount,extra={})=>saleDoc({_id:id,date,settlement_mode:'sale',price_unit:'kg',unit_price:1,out_items:[{net:amount}],back_items:[],...extra})
 t.crm_sale_records=Array.from({length:9},(_,i)=>sale(`old-${i}`,`2026-01-${String(i+1).padStart(2,'0')}`,(i+1)*10+(i===0?18:0),{amount_received:(i+1)*10+(i===0?15:0),rounding_amount:i===0?3:0,receipt_rounding_amount:0,payment_status:'paid'}))
 t.crm_sale_records.push(sale('negative-a','2026-01-10',-8),sale('negative-b','2026-01-11',-7),sale('later-paid','2026-04-01',23,{amount_received:23}),sale('later-unpaid','2026-09-06',200))
 t.crm_customer_receipts=[['offset-a','2026-01-10',8,'sale_offset_credit'],['offset-b','2026-01-11',7,'sale_offset_credit'],['opening-paid','2026-01-08',100,'manual'],['later-cash','2026-04-19',23,'manual']].map(([id,biz_date,amount,source_type])=>({...base,_id:id,biz_date,amount,source_type,allocated_amount:amount,unallocated_amount:0,rounding_allocated_amount:0,payment_method:'unknown'}))
 const allocation=(id,receipt,target,type,amount)=>({...base,_id:id,receipt_id:receipt,target_type:type,target_id:target,allocate_kind:'receipt',allocate_amount:amount})
 t.crm_customer_allocations=[allocation('offset-aa','offset-a','old-0','sale',8),allocation('offset-ba','offset-b','old-0','sale',7),allocation('opening-a','opening-paid','opening','opening_debt',100),allocation('later-a','later-cash','later-paid','sale',23)]
 t.crm_customer_opening_debts=[{...base,_id:'opening',biz_date:'2025-12-31',amount:100,amount_received:100,receipt_rounding_amount:0,source_type:'opening'}]
 t.crm_customer_flow_settlements=[];t.crm_customer_receipt_adjustments=[]
 return t
}
const snapshot=t=>{const tables=Object.fromEntries(TABLES.map(name=>[name,clone(t[name])]));return {customer_id:'customer-1',complete:true,atomic_snapshot:false,scope_guard:{reverse_link_query_complete:true,cross_customer_link_count:0,fixed_id_query_complete:true,fixed_id_existing_count:0,same_amount_receipt_query_complete:true,same_amount_receipt_count:0},tables,snapshot_hash:snapshotHash(tables)}}
function inputs(t=fixture()) {
 const before=snapshot(t),scope={locked:true,conversion_key:'synthetic-confirmed-cash-v1',customer_id:'customer-1',receipt_date:'2026-02-07',amount:450,voucher_no:'合成凭证',price_unit:'kg',expected_target_count:9,
  targets:t.crm_sale_records.slice(0,9).map((sale,i)=>({sale_id:sale._id,source_hash:digest(sale),cash_amount:(i+1)*10}))}
 const evidence={customer_id:'customer-1',confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40),scope_hash:digest(scope),source_snapshot_hash:before.snapshot_hash}
 return {before,scope,evidence,plan:buildPlan(before,evidence,scope,{_id:'admin'},1000)}
}
function apply(t,plan){const after=clone(t);for(const w of plan.writes){const i=after[w.table].findIndex(r=>r._id===w.id);if(i<0)after[w.table].push(clone(w.after));else after[w.table][i]=clone(w.after)}return after}
async function summary(t,action,from='2026-01-01',to='2026-09-06') {
 const db=makeDb(t),handler=loadHandler('crm-customer-settlement',db)
 const r=await invoke(handler,action,{customer_id:'customer-1',date_from:from,date_to:to,summary_only:true});assert.equal(r.code,0,r.msg);assert.equal(db.writes.length,0);return r.data
}

test('ordinary receipt preview cannot back already received sales without making new prepay',async()=>{
 const t=fixture(),db=makeDb(t),handler=loadHandler('crm-customer-settlement',db)
 const r=await invoke(handler,'createReceiptV1',{customer_id:'customer-1',amount:450,biz_date:'2026-02-07',preview:true,allocation_mode:'checked',allocation_targets:inputs(t).scope.targets.map(row=>({target_type:'sale',target_id:row.sale_id}))})
 assert.equal(r.code,0,r.msg);assert.equal(r.data.receipt_allocated_total,0);assert.equal(r.data.prepay_amount,450);assert.equal(db.writes.length,0)
})

test('cash backing removes nine pending items without changing business fields, rounding, offsets, opening or later receipts',async()=>{
 const t=fixture(),{before,plan}=inputs(t),after=apply(t,plan)
 assert.equal(plan.writes.filter(w=>!w.before).length,10);assert.equal(plan.summary.metadata_documents_changed,10)
 assert.equal(expectedAfter(before,plan),snapshot(after).snapshot_hash)
 for(const name of TABLES)for(const old of t[name]){
  const changed=after[name].find(r=>r._id===old._id),expected=clone(old)
  if(name==='crm_customers'||name==='crm_sale_records'&&old._id.startsWith('old-'))expected.updated_at=1000
  assert.deepEqual(changed,expected)
 }
 assert.ok(plan.writes.filter(w=>w.table==='crm_customer_allocations').every(w=>w.after.allocate_kind==='receipt'))
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
  const old=await summary(t,action),now=await summary(after,action)
  assert.equal(old.period_summary.unresolved_count,9);assert.equal(old.period_summary.cash_received,null)
  assert.equal(now.period_summary.complete,true);assert.equal(now.period_summary.unresolved_count,0);assert.equal(now.period_summary.cash_received,573)
  assert.equal(now.period_summary.known_cash.cash_received-old.period_summary.known_cash.cash_received,450)
  if(action!=='getCustomerStatementV1'){assert.equal(old.closing_balance,200);assert.equal(now.closing_balance,200)}
  for(const [from,to,cash]of[['2026-01-01','2026-01-31',100],['2026-02-01','2026-02-28',450],['2026-02-01','2026-02-06',0]])assert.equal((await summary(after,action,from,to)).period_summary.cash_received,cash)
 }
 for(const action of ['exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
  const old=await summary(t,action,'2026-01-01','2026-01-31'),now=await summary(after,action,'2026-01-01','2026-01-31')
  assert.equal(now.closing_balance-old.closing_balance,450)
 }
 const daily=await summary(after,'exportCustomerStatementV1');assert.equal(daily.totals.rounding,3);assert.equal(daily.totals.offset_credit,15);assert.equal(daily.totals.legacy_received,0)
 assert.equal(daily.rows.find(r=>r.biz_date==='2026-01-01').rounding,3)
 assert.equal(daily.rows.find(r=>r.biz_date==='2026-02-07').rounding,0)
})

test('fixed batch and target IDs cannot be bypassed by retries, source changes, missing evidence or existing cash candidates',()=>{
 const t=fixture(),{before,scope,evidence,plan}=inputs(t)
 assert.equal(batchId(scope),batchId({...scope,targets:[...scope.targets].reverse()}))
 assert.equal(plan.run_id,inputs(t).plan.run_id);assert.equal(plan.plan_hash,inputs(t).plan.plan_hash)
 for(const change of [s=>s.locked=false,s=>s.targets.pop(),s=>s.targets[0].cash_amount++,s=>s.targets[0].source_hash='c'.repeat(64)]){
  const s=clone(scope);change(s);assert.throws(()=>buildPlan(before,{...evidence,scope_hash:digest(s)},s,{_id:'admin'},1000))
 }
 for(const status of ['posted','void'])for(const biz_date of ['2026-02-07','2026-04-18']){
  const x=fixture();x.crm_customer_receipts.push({_id:'prior-cash',customer_id:'customer-1',status,biz_date,amount:450})
  assert.throws(()=>inputs(x),/已存在同批次或同额收款/)
 }
 const changed=clone(before);changed.tables.crm_sale_records[0].amount_received++
 assert.throws(()=>buildPlan(changed,evidence,scope,{_id:'admin'},1000),/快照/)
 const x=fixture();x.crm_customer_receipt_adjustments.push({_id:'adjustment',customer_id:'customer-1',status:'pending'})
 assert.throws(()=>inputs(x),/进行中/)
})

async function prepared(t=fixture(),hooks={}) {
 const db=mutableDb(t,hooks),{before,plan}=inputs(t),saved=await prepare({db,before,plan})
 return {t,db,before,plan,args:{db,logId:saved.log_id,runId:plan.run_id,planHash:plan.plan_hash,readSnapshot:async()=>snapshot(t)}}
}
test('transaction rehearsal, injected interruption, commit and repeat are all-or-nothing with exact before/after snapshots',async()=>{
 const h=await prepared(),before=h.before.snapshot_hash
 await assert.rejects(execute(h.args),/先完成/)
 for(const failAfterWrites of [12,0]){
  const result=await execute({...h.args,rehearse:true,failAfterWrites})
  assert.equal(result.status,failAfterWrites?'interruption_rolled_back':'rehearsed_rolled_back')
  assert.equal(snapshot(h.t).snapshot_hash,before)
 }
 const result=await execute(h.args);assert.equal(result.status,'committed');assert.equal(result.source_business_documents_changed,0)
 assert.equal(snapshot(h.t).snapshot_hash,expectedAfter(h.before,h.plan))
 const after=digest(h.t),writes=h.db.writes.length
 assert.equal((await execute(h.args)).already_committed,true);assert.equal(digest(h.t),after);assert.equal(h.db.writes.length,writes)
})

test('stale source, plan tampering, write failures and late scope additions reject without partial conversion',async()=>{
 const stale=await prepared();stale.t.crm_sale_records[0].updated_at++
 await assert.rejects(execute({...stale.args,rehearse:true}),/原值或范围/)
 assert.equal(stale.t.crm_customer_receipts.length,4)
 const corrupt=await prepared();corrupt.t.crm_operation_logs[0].detail.plan.writes.at(-1).after.allocate_amount++
 await assert.rejects(execute({...corrupt.args,rehearse:true}),/校验失败/)
 let count=0;const failed=await prepared(fixture(),{txWrite:()=>{if(++count===13)throw Error('injected database failure')}})
 await assert.rejects(execute({...failed.args,rehearse:true}),/database failure/);assert.equal(snapshot(failed.t).snapshot_hash,failed.before.snapshot_hash)
 const late=await prepared();let reads=0
 const readSnapshot=async()=>{if(++reads===2)late.t.crm_customer_receipts.push({_id:'concurrent',customer_id:'customer-1',status:'posted',biz_date:'2026-09-10',amount:1});return snapshot(late.t)}
 await assert.rejects(execute({...late.args,rehearse:true,readSnapshot}),/事务期间/)
 assert.equal(late.t.crm_customer_receipts.filter(r=>r.source_type==='legacy_received_confirmation').length,0)
 assert.equal(late.t.crm_sale_records[0].updated_at,1)
})

function entryFixture() {
 const t=fixture(),id='694045c0adf6dbd796e261bf';t.crm_customers[0]._id=id
 for(const name of TABLES.filter(n=>n!=='crm_customers'))for(const row of t[name])row.customer_id=id
 for(let i=0;i<9;i++){const amount=i===8?3500:1000,s=t.crm_sale_records[i];s.amount_received=amount+(i===0?15:0);s.out_items=[{net:amount+(i===0?18:0)}]}
 return t
}
test('restricted real conversion entry rejects empty credentials, foreign targets and existing same-amount receipts before writes',async()=>{
 const t=entryFixture(),db=mutableDb(t),handler=loadHandler('crm-legacy-receipt-conversion',db),customer_id=t.crm_customers[0]._id
 assert.equal((await handler({action:'inspectV1',token:'',data:{customer_id}},{})).code,403)
 assert.equal((await invoke(handler,'inspectV1',{customer_id:'other'})).code,400)
 for(const target_ids of [['foreign'],Array(10).fill('old-0')])assert.equal((await invoke(handler,'inspectV1',{customer_id,target_ids})).code,409)
 const inspect=await invoke(handler,'inspectV1',{customer_id});assert.equal(inspect.code,0,inspect.msg)
 const scope={...inspect.data.scope_template,locked:true,targets:t.crm_sale_records.slice(0,9).map((row,i)=>({sale_id:row._id,source_hash:digest(row),cash_amount:i===8?3500:1000}))}
 const evidence={confirmed_by_user:true,customer_id,scope_hash:digest(scope),source_snapshot_hash:inspect.data.snapshot_hash,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}
 const args={customer_id,scope,evidence,expected_snapshot_hash:inspect.data.snapshot_hash}
 const preview=await invoke(handler,'previewV1',args);assert.equal(preview.code,0,preview.msg);assert.equal(db.writes.length,0)
 assert.match(preview.data.plan.writes.find(w=>w.table==='crm_customer_receipts').after.note,/记-024/)
 const prep=await invoke(handler,'prepareV1',args);assert.equal(prep.code,0,prep.msg)
 const execution={customer_id,run_id:prep.data.run_id,plan_hash:prep.data.plan_hash}
 assert.equal((await invoke(handler,'executeV1',execution)).code,409)
 assert.equal((await invoke(handler,'rehearseV1',execution)).code,0)
 const committed=await invoke(handler,'executeV1',execution);assert.equal(committed.code,0,committed.msg);assert.equal(committed.data.status,'committed')
 assert.equal((await invoke(handler,'statusV1',{customer_id})).data.scope_guard.reverse_link_query_complete,true)
 assert.equal((await invoke(handler,'executeV1',execution)).data.already_committed,true)
})

test('reverse target, fixed receipt and fixed allocation queries reject cross-customer links',async()=>{
 for(const mode of ['target','receipt','allocation']){
  const t=entryFixture(),customer_id=t.crm_customers[0]._id,run=batchId({customer_id,conversion_key:'k001-confirmed-cash-20260207-v1'}),fixedReceipt=digest(`${run}:receipt`).slice(0,24)
  if(mode==='target')t.crm_customer_allocations.push({_id:'foreign-link',customer_id:'foreign',target_id:'old-0',target_type:'sale'})
  if(mode==='receipt')t.crm_customer_receipts.push({_id:fixedReceipt,customer_id:'foreign',amount:1,status:'posted'})
  if(mode==='allocation')t.crm_customer_allocations.push({_id:'foreign-batch-link',customer_id:'foreign',receipt_id:fixedReceipt})
  const db=mutableDb(t),handler=loadHandler('crm-legacy-receipt-conversion',db)
  const r=await invoke(handler,'inspectV1',{customer_id,target_ids:['old-0']});assert.equal(r.code,409);assert.match(r.msg,/跨客户关联/);assert.equal(db.writes.length,0)
 }
})

test('backup size budget rejects before audit write and transaction deadline waits for requests before rollback',async(t)=>{
 const huge=fixture();huge.crm_customers[0].note='x'.repeat(512*1024)
 const db=mutableDb(huge),{before,plan}=inputs(huge)
 await assert.rejects(prepare({db,before,plan}),/单文档预算/);assert.equal(db.writes.length,0)
 let clock=100000,advanced=false,inFlight=0,rollbackInFlight=-1
 t.mock.method(Date,'now',()=>clock)
 const h=await prepared(fixture(),{txWrite:()=>{if(!advanced){clock+=7000;advanced=true}}})
 const start=h.db.startTransaction
 h.db.startTransaction=async()=>{const tx=await start(),rollback=tx.rollback;tx.rollback=async()=>{rollbackInFlight=inFlight;return rollback()};return tx}
 await assert.rejects(execute({...h.args,rehearse:true}),/预算/)
 assert.equal(rollbackInFlight,0);assert.equal(snapshot(h.t).snapshot_hash,h.before.snapshot_hash)
 const {withinBudget,mapBounded}=require('../uniCloud-alipay/cloudfunctions/crm-legacy-receipt-conversion/budget')
 let peak=0,completed=0;clock=100000
 await assert.rejects(withinBudget(()=>mapBounded([1,2,3,4,5,6],async()=>{inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setImmediate(resolve));inFlight--;completed++;clock+=2000}),101000),/预算/)
 assert.equal(inFlight,0);assert.equal(completed,6);assert.ok(peak<=4)
})

test('a lost commit response remains queryable and cannot cause a second receipt',async()=>{
 const h=await prepared();await execute({...h.args,rehearse:true})
 const start=h.db.startTransaction
 h.db.startTransaction=async()=>{const tx=await start(),commit=tx.commit;tx.commit=async()=>{await commit();throw Error('commit response lost')};return tx}
 await assert.rejects(execute(h.args),error=>error.commit_attempted===true&&error.commit_status_unknown===true)
 const count=h.t.crm_customer_receipts.length
 assert.equal(h.t.crm_operation_logs[0].status,'committed')
 assert.equal((await execute(h.args)).already_committed,true);assert.equal(h.t.crm_customer_receipts.length,count)
})
