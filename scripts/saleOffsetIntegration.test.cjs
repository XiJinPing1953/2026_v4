'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const {optimisticDb}=require('./lib/optimisticAccountingDb.cjs')
const {assertOffsetSourceEditable}=require('../uniCloud-alipay/cloudfunctions/crm-sale/saleOffsetGuard')
const {sourceVersion}=require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/offsetOperation')
function fixture(){return {crm_users:[{_id:'actor',token:'test',role:'superadmin',username:'合成用户'}],crm_customers:[{_id:'customer',name:'合成客户',price_unit:'kg',default_price_unit:'kg',default_unit_price:8,updated_at:1}],crm_sale_records:[],crm_customer_receipts:[],crm_customer_allocations:[],crm_operation_logs:[],crm_bottles:[{_id:'bottle-1',bottle_no:'1',current_status:'out',current_customer_id:'customer',is_active:true,updated_at:1}]}}
function harness(){const state=fixture(),db=optimisticDb(state),handlers={},calls=[];let failSync=false
 function load(name){const filename=path.resolve('uniCloud-alipay/cloudfunctions',name,'index.js');const context={exports:{},require:createRequire(filename),uniCloud:{database:()=>db,callFunction:async args=>{calls.push(args);if(args.name==='crm-customer-settlement'){if(failSync&&args.data.action==='syncSaleOffsetCreditV1')return {result:{code:500,msg:'合成同步中断'}};return {result:await handlers[args.name](args.data,{requestId:'child'})}}return {result:{code:0,data:{}}}}},Date,Math,Set,Map,Buffer,process,setTimeout,clearTimeout,console:{log(){},warn(){},error(){}}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});return context.exports.main}
 handlers['crm-customer-settlement']=load('crm-customer-settlement');handlers['crm-sale']=load('crm-sale');return {state,db,calls,setFail:v=>{failSync=v},invoke:(name,action,data)=>handlers[name]({action,token:'test',data},{requestId:'parent'})}}
function payload(enabled=true){return {base:{date:'2026-10-30',customerId:'customer',customerName:'合成客户',delivery1:'司机',carNo:'TEST',bizMode:'bottle',priceUnit:'kg',settlementMode:'sale',unitPrice:8,paymentStatus:'paid',paymentMethod:'cash',amountReceived:0,roundingAmount:0,offsetEnabled:enabled},outRows:[],backRows:[{bottle_no:'1',bottle_id:'bottle-1',gross:13,tare:10,net:3}],depositRows:[],agentSaleRows:[],ignore_bottle_flow_warning:true}}
test('real sale create calls only current-sale sync; an unrelated protected customer adjustment does not block it',async()=>{const h=harness();h.state.crm_customer_opening_debts=[{_id:'adjust',customer_id:'customer',source_type:'balance_adjustment',adjustment_kind:'prepay_writeoff',status:'posted',amount:0,amount_received:0}];const r=await h.invoke('crm-sale','createV2',payload());assert.equal(r.code,0,r.msg);assert.equal(r.data.offset_sync.status,'completed',JSON.stringify(r));assert.equal(h.state.crm_customer_receipts.filter(x=>x.source_type==='sale_offset_credit').length,1);assert.equal(h.state.crm_customer_receipts[0].amount,24);assert.equal(h.calls.some(x=>x.data.action==='repairOffsetCreditsV1'),false)})
test('failed sync leaves durable pending source and explicit warning; retry finishes exactly once without resaving sale',async()=>{const h=harness();h.setFail(true);const r=await h.invoke('crm-sale','createV2',payload());assert.equal(r.code,0,r.msg);assert.match(r.data.warning,/合成同步中断/);assert.equal(h.state.crm_customer_receipts.length,0);const sale=h.state.crm_sale_records[0],rev=sale.offset_sync_revision;assert.equal(sale.offset_sync_status,'pending');h.setFail(false);const retry=await h.invoke('crm-sale','retryOffsetSyncV1',{sale_id:sale._id});assert.equal(retry.code,0,retry.msg);const again=await h.invoke('crm-sale','retryOffsetSyncV1',{sale_id:sale._id});assert.equal(again.code,0,again.msg);assert.equal(h.state.crm_customer_receipts.length,1);assert.equal(h.state.crm_sale_records[0].offset_sync_revision,rev)})
test('explicit disabled switch is preserved and historical records without a revision cannot be silently backfilled',async()=>{const h=harness();const r=await h.invoke('crm-sale','createV2',payload(false));assert.equal(r.code,0,r.msg);assert.equal(h.state.crm_customer_receipts.length,0);const sale=h.state.crm_sale_records[0];delete sale.offset_sync_revision;assert.equal((await h.invoke('crm-sale','retryOffsetSyncV1',{sale_id:sale._id})).code,409)})
test('source financial edits and deletion refuse prior pool links; target edits refuse allocated receipts without changing data',async()=>{const h=harness();await h.invoke('crm-sale','createV2',payload());const sale=h.state.crm_sale_records[0];const before=JSON.stringify(h.state);for(const after of [null,{...sale,amount_received:-10},{...sale,date:'2026-10-29'},{...sale,offset_enabled:false}])await assert.rejects(assertOffsetSourceEditable(h.db,sale,after),/冲抵来源/);await assertOffsetSourceEditable(h.db,sale,{...sale,remark:'可改备注'});assert.equal(JSON.stringify(h.state),before);h.state.crm_customer_receipts=[];h.state.crm_customer_allocations=[{_id:'link',customer_id:'customer',target_id:sale._id,allocate_amount:5}];await assert.rejects(assertOffsetSourceEditable(h.db,sale,{...sale,amount_received:1}),/关联收款或冲抵/)})
test('settlement-only permission can sync its saved sale without gaining monthly rebuild or allocation permission',async()=>{const h=harness();h.state.crm_users[0]={_id:'actor',token:'test',role:'finance',page_permissions:{'/pages/sale/settlement':{view:true,update:true},'/pages/customer/statement':{},'/pages/sale/edit':{},'/pages/sale/detail':{}}};h.state.crm_sale_records=[{_id:'sale',customer_id:'customer',date:'2026-10-30',settlement_mode:'sale',biz_mode:'bottle',price_unit:'kg',unit_price:8,out_items:[],back_items:[{net:3}],amount_received:0,offset_enabled:true,offset_sync_revision:'sync-authorized',updated_at:1}];const r=await h.invoke('crm-customer-settlement','syncSaleOffsetCreditV1',{customer_id:'customer',sale_id:'sale',operation_id:'sync-authorized',expected_updated_at:1});assert.equal(r.code,0,r.msg);const reject=await h.invoke('crm-customer-settlement','allocateOffsetCreditV1',{customer_id:'customer'});assert.equal(reject.code,403);assert.equal((await h.invoke('crm-customer-settlement','repairOffsetCreditsV1',{customer_id:'customer',execute:true})).code,403)})

test('historical note edits neither create a revision nor repair missing or inconsistent credits', async () => {
  for (const credit of ['missing', 'inconsistent']) {
    const h = harness()
    await h.invoke('crm-sale', 'createV2', payload())
    const sale = h.state.crm_sale_records[0], id = sale._id
    for (const key of Object.keys(sale).filter(key => key.startsWith('offset_sync_'))) delete sale[key]
    if (credit === 'missing') h.state.crm_customer_receipts = []
    else Object.assign(h.state.crm_customer_receipts[0], { amount: 8, unallocated_amount: 8 })
    const receiptsBefore = structuredClone(h.state.crm_customer_receipts)
    h.calls.length = 0
    const edit = payload(); edit.base.remark = '只更新备注'
    const general = await h.invoke('crm-sale', 'updateV2', { recordId: id, payload: edit, ignore_bottle_flow_warning: true })
    assert.equal(general.code, 0, general.msg)
    const settlement = await h.invoke('crm-sale', 'updateSettlementV1', { recordId: id, settlement: { paymentNote: '只更新付款备注' } })
    assert.equal(settlement.code, 0, settlement.msg)
    assert.equal(h.state.crm_sale_records.find(row => row._id === id).offset_sync_revision, undefined)
    assert.deepEqual(h.state.crm_customer_receipts, receiptsBefore)
    assert.equal(h.calls.some(row => ['syncSaleOffsetCreditV1', 'autoApplyPrepayToSaleV1'].includes(row.data.action)), false)
  }
})

test('metadata save keeps pending operation for explicit retry and completed operation unchanged', async () => {
  for (const pending of [true, false]) {
    const h = harness(); h.setFail(pending)
    await h.invoke('crm-sale', 'createV2', payload())
    const before = structuredClone(h.state.crm_sale_records[0]), receiptsBefore = structuredClone(h.state.crm_customer_receipts)
    h.setFail(false); h.calls.length = 0
    const edit = payload(); edit.base.remark = '保存备注不能替代重试'
    const result = await h.invoke('crm-sale', 'updateV2', { recordId: before._id, payload: edit, ignore_bottle_flow_warning: true })
    assert.equal(result.code, 0, result.msg)
    const saved = h.state.crm_sale_records[0]
    assert.equal(saved.offset_sync_revision, before.offset_sync_revision)
    assert.equal(saved.offset_sync_status, before.offset_sync_status)
    assert.deepEqual(h.state.crm_customer_receipts, receiptsBefore)
    assert.equal(h.calls.some(row => row.data.action === 'syncSaleOffsetCreditV1'), false)
    if (pending) {
      assert.equal(result.data.offset_sync.status, 'pending')
      const retry = await h.invoke('crm-sale', 'retryOffsetSyncV1', { sale_id: before._id })
      assert.equal(retry.code, 0, retry.msg)
      assert.equal(h.state.crm_customer_receipts.length, 1)
    }
  }
})

test('source guard rejects before creating missing bottles and returns explicit 409 for update and delete', async () => {
  const h = harness(); await h.invoke('crm-sale', 'createV2', payload())
  const id = h.state.crm_sale_records[0]._id, before = structuredClone(h.state)
  const edit = payload(); edit.backRows = [{ bottle_no: 'new-bottle', gross: 14, tare: 10, net: 4 }]
  const result = await h.invoke('crm-sale', 'updateV2', { recordId: id, payload: edit, ignore_bottle_flow_warning: true })
  assert.equal(result.code, 409, result.msg)
  assert.deepEqual(h.state.crm_bottles, before.crm_bottles)
  assert.deepEqual(h.state.crm_sale_records, before.crm_sale_records)
  assert.deepEqual(h.state.crm_customer_receipts, before.crm_customer_receipts)
  const settlement = await h.invoke('crm-sale', 'updateSettlementV1', { recordId: id, settlement: { amountReceived: -8 } })
  assert.equal(settlement.code, 409, settlement.msg)
  assert.equal((await h.invoke('crm-sale', 'removeV2', { recordId: id })).code, 409)
  assert.deepEqual(h.state.crm_sale_records, before.crm_sale_records)
})

test('note-only settlement preserves legacy switch and cannot replay a prior use-offset preference', async () => {
  const h = harness(); await h.invoke('crm-sale', 'createV2', payload())
  const sale = h.state.crm_sale_records[0]
  sale.back_items = []; sale.out_items = [{ net: 3 }]; sale.amount_received = 0
  sale.payment_status = 'unpaid'; sale.payment_method = 'on_account'; sale.apply_offset_credit = true
  for (const key of Object.keys(sale).filter(key => key.startsWith('offset_sync_'))) delete sale[key]
  h.state.crm_customer_receipts = [{ _id: 'other-credit', customer_id: 'customer', amount: 24, allocated_amount: 0, unallocated_amount: 24, source_type: 'sale_offset_credit', source_id: 'other-sale', status: 'posted' }]
  const receiptsBefore = structuredClone(h.state.crm_customer_receipts); h.calls.length = 0
  const result = await h.invoke('crm-sale', 'updateSettlementV1', { recordId: sale._id, settlement: { paymentNote: '只保存备注' } })
  assert.equal(result.code, 0, result.msg)
  const saved = h.state.crm_sale_records[0]
  assert.equal(saved.offset_sync_revision, undefined)
  assert.equal(saved.offset_enabled, true)
  assert.equal(saved.amount_received, 0)
  assert.deepEqual(h.state.crm_customer_receipts, receiptsBefore)
  assert.equal(h.calls.some(row => ['syncSaleOffsetCreditV1', 'autoApplyPrepayToSaleV1'].includes(row.data.action)), false)
})

test('an allowed financial source change still creates a new explicit synchronization', async () => {
  const h = harness(); await h.invoke('crm-sale', 'createV2', payload(false))
  const sale = h.state.crm_sale_records[0], revision = sale.offset_sync_revision
  const result = await h.invoke('crm-sale', 'updateSettlementV1', { recordId: sale._id, settlement: { offsetEnabled: true } })
  assert.equal(result.code, 0, result.msg)
  assert.notEqual(h.state.crm_sale_records[0].offset_sync_revision, revision)
  assert.equal(h.state.crm_customer_receipts[0].amount, 24)
})
