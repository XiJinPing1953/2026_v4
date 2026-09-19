import test from 'node:test'
import assert from 'node:assert/strict'
import { callCloud, resetFixtures } from './mock.mjs'
import plugin from './plugin.mjs'
const invoke=(action,data={})=>callCloud('crm-customer-settlement',{action,data:{customer_id:'demo-kg',...data}})
const statement=async()=> (await invoke('getCustomerStatementV1')).data

test('synthetic datasets, preview isolation, create/confirm, offset reversal, reset and deny unknown',async()=>{
 resetFixtures()
 for(const unit of ['kg','bottle','m3']){
  const {data}=await invoke('getCustomerStatementV1',{customer_id:'demo-'+unit})
  assert.equal(data.recent_sales.length,23);assert.match(data.recent_sales[0].date,/^2026-09-/);assert.equal(data.recent_receipts.length,13)
  assert.equal(data.recent_flow_settlements.length,unit==='m3'?7:0)
 }
 const before=(await statement()).summary.receivable_balance
 const preview=await invoke('previewAllocationV1',{amount:1000})
 assert.equal(preview.data.allocated_amount,1000)
 assert.equal((await statement()).summary.receivable_balance,before)
 assert.equal((await invoke('confirmAllocationV1',{amount:1000,allocations:preview.data.allocations,biz_date:'2026-09-20'})).code,0)
 assert.equal((await statement()).summary.receivable_balance,before-1000)
 assert.equal((await invoke('createReceiptV1',{amount:500,biz_date:'2026-09-20'})).code,0)
 assert.equal((await statement()).summary.receivable_balance,before-1500)
 assert.equal((await statement()).recent_receipts.length,15)
 assert.equal((await invoke('createPrepayEntryV1',{amount:200,entry_kind:'offset_credit',biz_date:'2026-09-20'})).code,0)
 assert.equal((await invoke('allocateOffsetCreditV1',{receipt_id:'demo-kg-offset-1',amount:500})).code,0)
 assert.equal((await statement()).summary.receivable_balance,before-2000)
 assert.equal((await invoke('removeOffsetCreditAllocationV1',{receipt_id:'demo-kg-offset-1'})).code,0)
 assert.equal((await statement()).summary.receivable_balance,before-1500)
 const snapshot=await statement()
 for(const action of ['deleteEverything','updateReceiptV1','createCustomerRefundV1'])assert.notEqual((await invoke(action)).code,0)
 assert.notEqual((await invoke('createReceiptV1',{customer_id:'actual-customer',amount:1})).code,0)
 assert.notEqual((await callCloud('production-function',{action:'createReceiptV1',data:{customer_id:'demo-kg',amount:1}})).code,0)
 assert.deepEqual(await statement(),snapshot)
 resetFixtures();assert.equal((await statement()).summary.receivable_balance,before)
})
test('preview plugin refuses all builds and only transforms explicitly targeted modules',()=>{
 const p=plugin();assert.throws(()=>p.configResolved({command:'build'}),/development-only/)
 assert.doesNotThrow(()=>p.configResolved({command:'serve'}))
 assert.match(p.transform('', '/project/src/services/api/callCloud.js'),/mock.mjs/)
 assert.equal(p.transform('original','/project/src/components/domain/customer/statement/CustomerStatementModule.vue'),undefined)
})

test('whole-receipt adjustment snapshots survive reads; cancel restores and save replaces allocation',async()=>{
 resetFixtures()
 const before=await statement(),receipt_id='demo-kg-receipt-1'
 const begin=await invoke('beginReceiptAdjustmentV1',{receipt_id})
 assert.equal(begin.code,0);assert.equal(begin.data.released_targets.length,1)
 assert.equal(begin.data.rollback_strategy,'deferred')
 assert.equal((await statement()).summary.receivable_balance,before.summary.receivable_balance)
 assert.equal((await statement()).recent_sales[0].outstanding+begin.data.released_targets[0].outstanding,1200)
 assert.deepEqual(await statement(),before)
 // Changing workspace performs reads only: the edit remains active and original snapshot stays intact.
 await invoke('listCustomerStatementRowsV1');await invoke('getCustomerStatementAnalysisV1');await invoke('listOffsetCreditPoolV1')
 assert.deepEqual(await invoke('beginReceiptAdjustmentV1',{receipt_id}),begin)
 assert.notEqual((await invoke('createReceiptV1',{amount:10})).code,0)
 assert.equal((await invoke('cancelReceiptAdjustmentV1',{receipt_id})).code,0)
 assert.deepEqual(await statement(),before)
 await invoke('beginReceiptAdjustmentV1',{receipt_id})
 assert.notEqual((await invoke('updateReceiptV1',{receipt_id,amount:1000,rounding_amount:1})).code,0)
 assert.equal((await invoke('updateReceiptV1',{receipt_id,amount:900,biz_date:'2026-09-20',allocation_mode:'checked',allocation_targets:[{target_type:'sale',target_id:'demo-kg-sale-23'}]})).code,0)
 const after=await statement()
 assert.equal(after.recent_receipts.length,13)
 assert.equal(after.summary.receivable_balance,before.summary.receivable_balance+100)
 assert.equal(after.recent_sales.find(r=>r._id==='demo-kg-sale-1').outstanding,1200)
 assert.equal(after.recent_sales.find(r=>r._id==='demo-kg-sale-23').outstanding,1400)
 assert.equal(after.recent_receipts[0].allocated_amount,900)
 // A new adjustment after save uses the newly committed snapshot.
 await invoke('beginReceiptAdjustmentV1',{receipt_id});await invoke('cancelReceiptAdjustmentV1',{receipt_id})
 assert.deepEqual(await statement(),after)
 resetFixtures()
})
