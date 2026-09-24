'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {fixture,depositDb}=require('./lib/customerDepositTestHarness.cjs')
const {createService,TABLE,OPS}=require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/cashierIntake')
const {readComplete}=require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/financialReadLocal')
const R=require('../uniCloud-alipay/cloudfunctions/crm-customer-deposit/report')
const {loadHandler}=require('./lib/accountingTestHarness.cjs')
function harness(extra={},hooks={},options={}) {
 const tables=fixture({[TABLE]:[],[OPS]:[],...extra}),db=depositDb(tables,hooks)
 const user=tables.crm_users[0]
 const service=createService({db,readComplete,moneyScale:c=>c.default_price_unit==='m3'?3:2,
 resolveCustomer:async id=>({ok:true,customer:tables.crm_customers.find(c=>c._id===id)}),
 hiddenIds:async()=>tables.crm_customers.filter(c=>c.is_hidden).map(c=>c._id),canWrite:()=>true,...options})
 const run=(action,data,actor=user)=>service.run(action,data,actor)
 let seq=0
 const input=(patch={})=>({customer_id:'customer-1',operation_id:`synthetic-${++seq}`,expected_version:0,kind:'mixed',amount:'120.01',gas_amount:'100',deposit_amount:'20.01',purpose:'prepay',biz_date:'2026-09-20',payment_method:'bank',proof_images:['cloud://synthetic/proof'],note:'合成到账',...patch})
 const preview=data=>run('previewReceiptIntakeV2',data)
 const save=async data=>{const p=await preview(data);return run('saveReceiptIntakeV2',p.submission||data)}
 return {tables,db,run,input,preview,save,user}
}
test('one mixed arrival creates exactly one gas receipt and one independent deposit, purpose never reclassifies gas',async()=>{
 const h=harness(),data=h.input(),before=structuredClone(h.tables)
 const p=await h.preview(data);assert.deepEqual(h.tables,before)
 const result=await h.run('saveReceiptIntakeV2',p.submission)
 assert.equal(result.status,'committed');assert.equal(h.tables[TABLE].length,1);assert.equal(h.tables[OPS].length,1)
 assert.equal(h.tables.crm_customer_receipts[0].amount,100);assert.equal(h.tables.crm_customer_receipts[0].source_type,'cashier_intake')
 assert.equal(h.tables.crm_customers[0].receipt_unallocated_balance,100);assert.equal(h.tables.crm_customers[0].prepay_manual_balance,0)
 assert.equal((await R.readDepositSnapshot(h.db,'customer-1')).balance_cents,2001)
 const detail=await h.run('getReceiptIntakeDetailV2',{intake_id:result.intake_id});assert.equal(detail.receipt._id,result.receipt_id)
 assert.deepEqual(detail.proof_images,data.proof_images)
 const again=await h.run('saveReceiptIntakeV2',p.submission);assert.equal(again.idempotent,true)
 await assert.rejects(h.run('saveReceiptIntakeV2',{...p.submission,amount:121.01,gas_amount:101}),/不同内容/)
})
test('every transactional write failure leaves neither header nor either funding ledger',async()=>{
 for(let failure=1;failure<=6;failure++) {
 let writes=0;const h=harness({}, {txWrite:()=>{if(++writes===failure)throw Error('injected write failure')}})
 const p=await h.preview(h.input()),before=structuredClone(h.tables)
 await assert.rejects(h.run('saveReceiptIntakeV2',p.submission),/injected/);assert.deepEqual(h.tables,before)
 }
})
test('lost commit response is recoverable by same operation; no second arrival',async()=>{
 const h=harness({}, {afterCommit:()=>{throw Error('response lost')}}),data=h.input(),p=await h.preview(data)
 await assert.rejects(h.run('saveReceiptIntakeV2',p.submission),e=>e.details.commit_status_unknown===true)
 const lookup=await h.run('getReceiptIntakeOperationV2',{operation_id:data.operation_id});assert.equal(lookup.found,true)
 assert.equal((await h.run('saveReceiptIntakeV2',p.submission)).idempotent,true);assert.equal(h.tables[TABLE].length,1)
})
test('unused mixed correction preserves original gas and void/re-entry deposit history; void is atomic',async()=>{
 const h=harness(),first=await h.save(h.input())
 const correction=h.input({intake_id:first.intake_id,expected_version:1,command:'update',amount:125.01,gas_amount:100,deposit_amount:25.01,reason:'凭据金额录错'})
 const updated=await h.save(correction)
 assert.equal(updated.version,2);assert.equal(h.tables.crm_customer_receipts.length,2);assert.equal(h.tables.crm_customer_receipts[0].status,'void')
 assert.equal((await R.readDepositSnapshot(h.db,'customer-1')).balance_cents,2501)
 const v=await h.preview(h.input({intake_id:first.intake_id,expected_version:2,command:'void',reason:'重复到账'}))
 await h.run('voidReceiptIntakeV2',v.submission)
 assert.equal((await R.readDepositSnapshot(h.db,'customer-1')).balance_cents,0);assert.equal(h.tables.crm_customers[0].prepay_balance,0)
 assert.equal(h.tables[TABLE][0].status,'void');assert.equal(h.tables[OPS].length,3)
})
test('legacy gas corrections remain idempotent after linking to a new arrival; legacy is not double listed',async()=>{
 const h=harness({crm_customer_receipts:[{_id:'old-gas',customer_id:'customer-1',customer_name:'合成客户',source_type:'cashier_intake',amount:100,unallocated_amount:100,allocated_amount:0,status:'posted',biz_date:'2026-09-01',payment_method:'bank',proof_images:['cloud://synthetic/old'],created_at:1,updated_at:1}]})
 const data=h.input({intake_id:'legacy:old-gas',command:'update',expected_version:1,kind:'gas',amount:90,gas_amount:90,deposit_amount:0,reason:'更正旧登记'})
 const p=await h.preview(data),result=await h.run('saveReceiptIntakeV2',p.submission)
 assert.equal((await h.run('saveReceiptIntakeV2',p.submission)).intake_id,result.intake_id)
 const list=await h.run('listReceiptIntakeV2',{include_void:true});assert.equal(list.rows.length,1)
})
test('Alipay automatic IDs omitted by _id in still return authoritative legacy balances and complete export links',async()=>{
 const h=harness({crm_customer_receipts:[{_id:'6aaf4a5b70a52b8b4e319d52',customer_id:'customer-1',customer_name:'合成客户',source_type:'cashier_intake',amount:960,unallocated_amount:960,allocated_amount:0,status:'posted',biz_date:'2026-09-01',payment_method:'bank',proof_images:['cloud://synthetic/old'],created_at:1,updated_at:1}]},
 {get:(name,rows,opts)=>({data:opts.where?._id?.$in?[]:structuredClone(rows)})})
 const page=await h.run('listReceiptIntakeV2',{})
 assert.equal(page.rows[0].unallocated_amount,960)
 assert.equal(page.rows[0].allocation_status,'unallocated')
 await h.save(h.input())
 const exported=await h.run('listReceiptIntakeV2',{export_mode:true})
 assert.equal(exported.rows.length,2)
 assert.ok(exported.rows.every(row=>row.allocation_status==='unallocated'))
})
test('allocation and later deposit refund block cashier correction, including mixed entries',async()=>{
 const h=harness(),result=await h.save(h.input())
 const input=h.input({intake_id:result.intake_id,expected_version:1,command:'void',reason:'录错'})
 h.tables.crm_customer_receipts[0].allocated_amount=1;h.tables.crm_customer_receipts[0].unallocated_amount=99
 await assert.rejects(h.preview(input),/分配/)
 h.tables.crm_customer_receipts[0].allocated_amount=0;h.tables.crm_customer_receipts[0].unallocated_amount=100
 const main=loadHandler('crm-customer-deposit',h.db)
 const refund=await main({token:'test',action:'createDepositEntryV1',data:{customer_id:'customer-1',kind:'refund',amount:1,biz_date:'2026-09-20',payment_method:'cash',operation_id:'later-refund',expected_version:1,note:'合成退款'}})
 assert.equal(refund.code,0,refund.msg);await assert.rejects(h.preview(input),/后续退还或转款/)
})
test('concurrent customer or gas modification aborts complete transaction',async()=>{
 let race=false;const h=harness({}, {beforeCommit:tables=>{if(race)tables.crm_customers[0].updated_at=-10}})
 await h.save(h.input());const p=await h.preview(h.input({intake_id:h.tables[TABLE][0]._id,expected_version:1,command:'void',reason:'误录'}));race=true
 await assert.rejects(h.run('voidReceiptIntakeV2',p.submission),/conflict/)
 assert.equal(h.tables[TABLE][0].status,'posted');assert.equal(h.tables.crm_customer_receipts[0].status,'posted');assert.equal(h.tables.crm_customer_deposit_accounts[0].balance_cents,2001)
})
test('precision, hidden customer, missing permissions and closed create fail without writes',async()=>{
 const h=harness()
 for(const patch of [{gas_amount:99},{deposit_amount:'20.001'},{amount:'120.001'},{proof_images:[]},{proof_images:['https://invalid']},{biz_date:'2026-02-30'},
  ...['12a','1e2','-1','1,000','12..3','12.3456'].flatMap(value=>[{amount:value},{gas_amount:value},{deposit_amount:value}])])await assert.rejects(h.preview(h.input(patch)))
 assert.equal(h.tables[TABLE].length,0)
 const closed=harness({}, {},{enabled:false});await assert.rejects(closed.preview(closed.input()),/暂时关闭/)
 const denied=harness({}, {},{canWrite:()=>false});await assert.rejects(denied.preview(denied.input()),/权限/)
 h.tables.crm_customers[0].is_hidden=true;await assert.rejects(h.preview(h.input()),/不可访问/)
})
test('tampered prepared submissions with illegal amount text never write',async()=>{
 const h=harness(),preview=await h.preview(h.input()),before=structuredClone(h.tables)
 for(const field of ['amount','gas_amount','deposit_amount']) {
  await assert.rejects(h.run('saveReceiptIntakeV2',{...preview.submission,[field]:'12x'}),/金额/)
  assert.deepEqual(h.tables,before)
 }
})
test('new and legacy arrivals paginate without duplicates including equal timestamps; export invalidates changed children',async()=>{
 const h=harness()
 for(let i=0;i<23;i++)await h.save(h.input({kind:i%2?'gas':'deposit',amount:10,gas_amount:i%2?10:0,deposit_amount:i%2?0:10}))
 h.tables.crm_customer_receipts.push(...Array.from({length:24},(_,i)=>({_id:`old-${String(i).padStart(2,'0')}`,customer_id:'customer-1',source_type:'cashier_intake',amount:5,unallocated_amount:5,allocated_amount:0,status:'posted',biz_date:'2026-09-20',created_at:500,updated_at:500})))
 h.tables[TABLE].forEach(r=>r.created_at=500)
 let cursor='',rows=[],first
 do{const page=await h.run('listReceiptIntakeV2',{page_size:7,cursor,export_mode:true});first ||=page;rows.push(...page.rows);cursor=page.paging.next_cursor}while(cursor)
 assert.equal(rows.length,47);assert.equal(new Set(rows.map(r=>r._id)).size,47);assert.equal(first.paging.total,47)
 h.tables.crm_customer_receipts[0].allocated_amount=1;h.tables.crm_customer_receipts[0].unallocated_amount-=1
 await assert.rejects(h.run('listReceiptIntakeV2',{page_size:7,cursor:first.paging.next_cursor,export_mode:true}),/发生变化/)
})
test('three-decimal gas and cent deposits conserve split without rounding',async()=>{
 const h=harness();h.tables.crm_customers[0].default_price_unit='m3'
 await h.save(h.input({amount:'120.011',gas_amount:'100.001',deposit_amount:'20.01'}))
 assert.equal(h.tables.crm_customers[0].receipt_unallocated_balance,100.001)
 assert.equal(h.tables.crm_customer_deposit_accounts[0].balance_cents,2001)
})
test('Alipay object-shaped transaction documents are supported',async()=>{
 const h=harness({}, {transactionDocumentObject:true});const result=await h.save(h.input());assert.equal(result.status,'committed')
})
test('closed-entry admin rehearsal rolls back all six writes and each injected interruption',async()=>{
 for(let failure=0;failure<=6;failure++){
 const h=harness({}, {},{enabled:false}),data={...h.input(),rehearse:true},p=await h.preview(data),before=structuredClone(h.tables)
 const result=await h.run('saveReceiptIntakeV2',{...p.submission,rehearse:true,fail_after_writes:failure})
 assert.equal(result.committed,false);assert.equal(result.snapshot_verified,true);assert.deepEqual(h.tables,before)
 }
 const h=harness({}, {},{enabled:false});await assert.rejects(h.preview({...h.input(),rehearse:'true'}),/参数/)
 await assert.rejects(h.run('previewReceiptIntakeV2',{...h.input(),rehearse:true},{_id:'cashier',role:'user'}),/管理员/)
})
test('real settlement dispatcher enforces cashier permissions and refuses old unsafe writers',async()=>{
 const config=require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/cashierIntakeConfig.json'),was=config.enabled;config.enabled=true
 try{
 const h=harness(),main=loadHandler('crm-customer-settlement',h.db)
 const invoke=(action,data={},token='test')=>main({action,data,token})
 const p=await invoke('previewReceiptIntakeV2',h.input());assert.equal(p.code,0,p.msg)
 const saved=await invoke('saveReceiptIntakeV2',p.data.submission);assert.equal(saved.code,0,saved.msg)
 for(const action of ['createReceiptIntakeV1','updateReceiptIntakeV1','removeReceiptIntakeV1'])assert.equal((await invoke(action,h.input())).code,409)
 assert.equal((await invoke('listReceiptIntakeV2',{},'')).code,401)
 h.tables.crm_users.push({_id:'readonly',token:'readonly-token',role:'user',page_permissions:{'/pages/cashier/receipt-intake':{view:true,create:false,update:false,delete:false}}})
 assert.equal((await invoke('listReceiptIntakeV2',{},'readonly-token')).code,0)
 const denied=await invoke('previewReceiptIntakeV2',h.input(),'readonly-token');assert.equal(denied.code,403,denied.msg)
 }finally{config.enabled=was}
})
test('partial deposit transfer adds a noncash gas source without increasing arrival totals',async()=>{
 const h=harness(),result=await h.save(h.input())
 const deposit=loadHandler('crm-customer-deposit',h.db)
 const transfer=await deposit({token:'test',action:'createDepositEntryV1',data:{customer_id:'customer-1',kind:'transfer',amount:5,biz_date:'2026-09-20',payment_method:'unknown',operation_id:'deposit-to-gas',expected_version:1,note:'合成部分转款'}})
 assert.equal(transfer.code,0,transfer.msg)
 assert.equal(h.tables.crm_customer_receipts.filter(x=>x.source_type==='deposit_transfer').length,1)
 assert.equal(h.tables.crm_customers[0].prepay_balance,105)
 assert.equal((await R.readDepositSnapshot(h.db,'customer-1')).balance_cents,1501)
 const list=await h.run('listReceiptIntakeV2',{export_mode:true});assert.equal(list.rows.length,1);assert.equal(list.rows[0].amount,120.01)
 await assert.rejects(h.preview(h.input({command:'void',intake_id:result.intake_id,expected_version:1,reason:'不能绕过转款'})),/后续退还或转款/)
 const oldVoid=await deposit({token:'test',action:'voidDepositEntryV1',data:{customer_id:'customer-1',entry_id:result.deposit_entry_id,operation_id:'bypass-deposit-void',expected_version:2,reason:'旧入口绕过'}})
 assert.notEqual(oldVoid.code,0);assert.match(oldVoid.msg,/到账/)
})
test('incomplete deposit reads and stale preview never write, financial evidence cannot become zero',async()=>{
 const h=harness();const p=await h.preview(h.input());h.tables.crm_customers[0].updated_at=123
 await assert.rejects(h.run('saveReceiptIntakeV2',p.submission),/变化/);assert.equal(h.tables[TABLE].length,0)
 const broken=harness({}, {count:(name,total)=>({total:name==='crm_customer_deposit_entries'?1:total})})
 await assert.rejects(broken.preview(broken.input()));assert.equal(broken.tables[TABLE].length,0)
})
test('cashier deposit receive does not grant refund, transfer or allocation permissions',async()=>{
 const config=require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/cashierIntakeConfig.json'),was=config.enabled;config.enabled=true
 try{
 const h=harness();h.tables.crm_users.push({_id:'cashier',token:'cashier-token',role:'user',page_permissions:{'/pages/cashier/receipt-intake':{view:true,create:true,update:true,delete:true},'/pages/customer/statement':{view:true,create:false,update:false,delete:false}}})
 const settlement=loadHandler('crm-customer-settlement',h.db),deposit=loadHandler('crm-customer-deposit',h.db),input=h.input({kind:'deposit',amount:10,gas_amount:0,deposit_amount:10})
 const p=await settlement({token:'cashier-token',action:'previewReceiptIntakeV2',data:input});assert.equal(p.code,0,p.msg)
 const saved=await settlement({token:'cashier-token',action:'saveReceiptIntakeV2',data:p.data.submission});assert.equal(saved.code,0,saved.msg)
 for(const kind of ['refund','transfer']){
 const r=await deposit({token:'cashier-token',action:'createDepositEntryV1',data:{customer_id:'customer-1',kind,amount:1,biz_date:'2026-09-20',payment_method:kind==='transfer'?'unknown':'cash',operation_id:'cashier-denied-'+kind,expected_version:1,note:'越权测试'}});assert.equal(r.code,403,r.msg)
 }
 const alloc=await settlement({token:'cashier-token',action:'allocatePrepayReceiptV1',data:{customer_id:'customer-1',receipt_id:'missing',amount:1}});assert.equal(alloc.code,403,alloc.msg)
 assert.equal(h.tables.crm_customer_deposit_accounts[0].balance_cents,1000)
 }finally{config.enabled=was}
})
test('statement and both existing exports keep gas cash and deposits in separate ledgers',async()=>{
 const h=harness();await h.save(h.input());const main=loadHandler('crm-customer-settlement',h.db)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
 const r=await main({token:'test',action,data:{customer_id:'customer-1',date_from:'2026-09-01',date_to:'2026-09-30',summary_only:true}})
 assert.equal(r.code,0,r.msg);assert.equal(r.data.period_summary.cash_received,100);assert.equal(r.data.deposit_summary.received_total,20.01)
 assert.equal(r.data.deposit_summary.current_balance,20.01)
 if(action==='exportCustomerStatementV1')assert.equal(r.data.totals.cash_received,100)
 }
})

test('cashier export refuses incomplete or inconsistent gas balances instead of showing zero',async()=>{
 const h=harness();await h.save(h.input({kind:'gas',amount:10,gas_amount:10,deposit_amount:0}))
 delete h.tables.crm_customer_receipts[0].unallocated_amount
 await assert.rejects(h.run('listReceiptIntakeV2',{export_mode:true}))
 h.tables.crm_customer_receipts[0].unallocated_amount=9
 await assert.rejects(h.run('listReceiptIntakeV2',{export_mode:true}),/不守恒/)
})
test('detail refuses foreign allocation links and never exposes them as this customer targets',async()=>{
 const h=harness();const result=await h.save(h.input())
 h.tables.crm_customer_allocations.push({_id:'foreign-link',receipt_id:result.receipt_id,customer_id:'other-customer',allocate_amount:1})
 await assert.rejects(h.run('getReceiptIntakeDetailV2',{intake_id:result.intake_id}),/跨客户/)
})

test('released deposit dependencies still require accountant correction, not cashier reuse of a shared balance',async()=>{
 const h=harness(),result=await h.save(h.input()),deposit=loadHandler('crm-customer-deposit',h.db)
 const refund=await deposit({token:'test',action:'createDepositEntryV1',data:{customer_id:'customer-1',kind:'refund',amount:1,biz_date:'2026-09-20',payment_method:'cash',operation_id:'refund-then-release',expected_version:1}})
 assert.equal(refund.code,0,refund.msg)
 const row=h.tables.crm_customer_deposit_entries.find(x=>x.kind==='refund')
 const canceled=await deposit({token:'test',action:'voidDepositEntryV1',data:{customer_id:'customer-1',entry_id:row._id,operation_id:'release-refund',expected_version:2,reason:'合成退还更正'}})
 assert.equal(canceled.code,0,canceled.msg)
 const input=h.input({command:'void',intake_id:result.intake_id,expected_version:1,reason:'关联解除后更正'})
 await assert.rejects(h.run('previewReceiptIntakeV2',input,{_id:'cashier',role:'user'}),/仍须由会计/)
 assert.ok((await h.preview(input)).submission)
})
