'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const ROOT = process.env.MOBILE_SALE_TEST_ROOT || path.resolve(__dirname, '..')
const { makeDb } = require(path.join(ROOT, 'scripts/lib/accountingTestHarness.cjs'))
const M = require(path.join(ROOT, 'uniCloud-alipay/cloudfunctions/crm-sale/mobileSaleCreate.js'))
const clone = value => structuredClone(value)
function database(tables, hooks = {}) {
  const writes = [], calls = []; let serial = 0, commits = 0
  function api(state, journal = null) {
    const base = makeDb(state, { get: async (name, rows, opts) => {
      if (hooks.read) await hooks.read(name, rows, opts)
      return { data: clone(rows) }
    } })
    function wrap(name, query) {
      return new Proxy(query, { get(q, key) {
        if (['where','doc','field','orderBy','skip','limit'].includes(key)) return (...args) => wrap(name, q[key](...args))
        if (key === 'add') return async input => {
          const ids = []
          for (const raw of Array.isArray(input) ? input : [input]) {
            const row = clone({ ...raw, _id: raw._id || `new-${++serial}` })
            if ((state[name] || []).some(r => r._id === row._id)) throw Error('duplicate key E11000')
            if (journal && hooks.txWrite) await hooks.txWrite(name, row)
            if (!journal && hooks.write) await hooks.write(name, row)
            ;(state[name] ||= []).push(row)
            ;(journal || writes).push({ kind:'add', name, id:row._id, row:clone(row) })
            ids.push(row._id)
          }
          return Array.isArray(input) ? { ids } : { id: ids[0] }
        }
        if (key === 'update') return async patch => {
          const rows = (await q.get()).data
          for (const found of rows) {
            if (journal && hooks.txWrite) await hooks.txWrite(name, patch)
            if (!journal && hooks.write) await hooks.write(name, patch)
            const row = state[name].find(r => r._id === found._id), before = clone(row)
            Object.assign(row, clone(patch))
            ;(journal || writes).push({ kind:'update', name, id:row._id, before, row:clone(row) })
          }
          return { updated: rows.length }
        }
        if (key === 'remove') return async () => {
          const rows = (await q.get()).data
          for (const row of rows) {
            state[name] = state[name].filter(r => r._id !== row._id)
            ;(journal || writes).push({ kind:'remove', name, id:row._id, before:clone(row) })
          }
          return { deleted:rows.length }
        }
        return q[key]
      } })
    }
    return { ...base, collection:name=>wrap(name,base.collection(name)) }
  }
  const db = api(tables)
  db.startTransaction = async () => {
    const local = clone(tables), journal = []; let ended = false
    return { ...api(local, journal), rollback:async()=>{ if(ended) throw Error('transaction ended'); ended=true }, commit:async()=>{
      if(ended) throw Error('transaction ended')
      if(hooks.beforeCommit) await hooks.beforeCommit(journal)
      const next=clone(tables)
      for(const change of journal) {
        const rows=next[change.name] ||= [], index=rows.findIndex(row=>row._id===change.id)
        if(change.kind==='add') { if(index>=0) throw Error('duplicate key at commit'); rows.push(clone(change.row)) }
        else {
          if(index<0 || JSON.stringify(rows[index])!==JSON.stringify(change.before)) throw Error('transaction write conflict')
          if(change.kind==='remove') rows.splice(index,1); else rows[index]=clone(change.row)
        }
      }
      for(const key of Object.keys(tables)) delete tables[key]
      Object.assign(tables,next);writes.push(...journal);ended=true;commits++
      if(hooks.afterCommit) await hooks.afterCommit(journal,commits)
      return { ok:true }
    } }
  }
  return { db, writes, calls }
}
function payload() {
  return { base: { date:'2026-10-15', customerId:'customer-1', customerName:'Synthetic customer', delivery1:'Driver', delivery2:'', vehicleId:'', carNo:'TEST', remark:'',
    bizMode:'bottle', priceUnit:'kg', settlementMode:'sale', unitPrice:5, paymentStatus:'unpaid', paymentMethod:'on_account', amountReceived:0, roundingAmount:0, applyOffsetCredit:false, offsetEnabled:false },
    outRows:[{bottle_no:'B1',bottle_id:'bottle-1',gross:12.5,tare:2,net:10.5,weight_source:'web_ble',weight_sampled_at:1792000000000,scale_session_id:'session-1',scale_stable_seq:2,
      scan_location:{status:'failed',captured_at:1792000000000,source:'mobile_bottle_scan',error_code:'permission_denied',error_message:'定位被拒绝'}}],
    backRows:[], depositRows:[{bottle_no:'B1'}], agentSaleRows:[] }
}
function harness(hooks = {}) {
  const tables = { crm_users:[{_id:'operator-1',token:'operator',role:'pda_operator'}, {_id:'admin',token:'admin',role:'superadmin'},
    {_id:'other',token:'other',role:'pda_operator'}, {_id:'reader',token:'reader',role:'user',page_permissions:{'/pages/pda/sale-create':{view:true,create:false}}}],
    crm_customers:[{_id:'customer-1',name:'Synthetic customer',default_price_unit:'kg',default_unit_price:5,is_active:true}],
    crm_bottles:[{_id:'bottle-1',bottle_no:'B1',tare_weight:2,is_active:true,status:'in_station'}], crm_sale_records:[], [M.OPERATIONS]:[] }
  const h=database(tables,hooks), filename=path.join(ROOT,'uniCloud-alipay/cloudfunctions/crm-sale/index.js')
  const context={exports:{},require:createRequire(filename),uniCloud:{database:()=>h.db,callFunction:async request=>{
    h.calls.push(clone(request)); if(hooks.cloud) return hooks.cloud(request)
    return {result:{code:0,data:{job_id:'test-job',done:true,status:'completed',applied_amount:0,unresolved_count:0}}}
  }},console:{log(){},warn(){},error(){}}, Date,Math,Set,Map,Buffer,process,setTimeout,clearTimeout}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename})
  return {...h,tables,invoke:(action,data,token='operator')=>context.exports.main({action,data,token},{}),
    input:(operation='mobile-test-0001')=>({operation_id:operation,payload:payload()})}
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}

test('actual mobile handler saves sale and receipt, reuses accounting and preserves capture evidence',async()=>{
  const h=harness(),input=h.input(),res=await h.invoke('createMobileV1',input)
  assert.equal(res.code,0,res.msg);assert.equal(res.data.processing_state,'completed',JSON.stringify(res))
  assert.equal(res.data.source_saved,true);assert.match(res.data.sale_id,/^[a-f0-9]{24}$/)
  assert.equal(h.tables.crm_sale_records.length,1);assert.equal(h.tables[M.OPERATIONS].length,1)
  const sale=h.tables.crm_sale_records[0]
  assert.equal(sale.source,M.SOURCE);assert.equal(sale.out_items[0].net,10.5);assert.equal(sale.out_items[0].scale_session_id,'session-1')
  assert.equal(sale.out_items[0].scan_location.status,'failed');assert.equal(h.tables.crm_bottle_movements.length,1)
  const detail=await h.invoke('getV2',{_id:sale._id},'admin');assert.equal(detail.data.should_receive,52.5)
  assert.equal(h.tables.crm_vouchers.length,1)
  const before=h.writes.length,again=await h.invoke('createMobileV1',input)
  assert.equal(again.data.idempotent,true);assert.equal(again.data.sale_id,sale._id);assert.equal(h.writes.length,before)
})
test('same operation and altered payload is conflict; existing result precedes mutable master validation',async()=>{
  const h=harness(),input=h.input();await h.invoke('createMobileV1',input)
  h.tables.crm_bottles=[];h.tables.crm_customers=[]
  const original=await h.invoke('createMobileV1',input);assert.equal(original.data.source_saved,true)
  input.payload.base.remark='different'
  const conflict=await h.invoke('createMobileV1',input)
  assert.equal(conflict.code,409);assert.equal(conflict.error_code,'MOBILE_SALE_OPERATION_CONFLICT');assert.notEqual(conflict.data.source_saved,false)
  input.payload.outRows[0].gross=-1
  const invalid=await h.invoke('createMobileV1',input);assert.equal(invalid.error_code,'MOBILE_SALE_OPERATION_CONFLICT')
})
test('strict mobile payload rejects invalid weight, duplicates, unsupported mode and unbound bottle before all writes',async()=>{
  for(const mutate of [p=>p.outRows[0].net=10.4,p=>p.outRows[0].gross=NaN,p=>p.outRows[0].tare=2.01,
    p=>p.outRows.push(clone(p.outRows[0])),p=>p.base.priceUnit='m3',p=>p.base.amountReceived=10,
    p=>p.outRows[0].bottle_id='missing',p=>p.outRows[0].bottle_no='wrong',p=>p.outRows[0].bottle_id='',p=>p.depositRows=[{bottle_no:'missing'}]]) {
    const h=harness(),input=h.input();mutate(input.payload)
    const res=await h.invoke('createMobileV1',input);assert.equal(res.code,400,JSON.stringify(res));assert.equal(res.data.source_saved,false)
    assert.equal(h.writes.length,0);assert.equal(h.tables.crm_bottles.length,1)
  }
})
test('flow warning stays confirmable and definitely unsaved; explicit confirmation can freeze a new payload',async()=>{
  const h=harness(),input=h.input()
  h.tables.crm_bottle_movements=[{_id:'old',bottle_no:'B1',type:'out',date:'2026-10-14',event_day:'2026-10-14',event_at:1791900000000,created_at:1791900000000,customer_id:'elsewhere'}]
  const res=await h.invoke('createMobileV1',input)
  assert.equal(res.code,409,JSON.stringify(res));assert.equal(res.data.confirmable,true);assert.equal(res.data.source_saved,false);assert.equal(h.writes.length,0)
  input.payload.ignore_bottle_flow_warning=true
  assert.equal((await h.invoke('createMobileV1',input)).data.source_saved,true)
})
test('transaction failure after receipt insert rolls back both objects; same id can retry',async()=>{
  let fail=true;const h=harness({txWrite:async name=>{if(fail&&name==='crm_sale_records')throw Error('injected source insert failure')}}),input=h.input()
  const result=await h.invoke('createMobileV1',input);assert.equal(result.data.source_saved,null);assert.equal(result.error_code,'MOBILE_SALE_RESULT_UNKNOWN')
  assert.equal(h.tables.crm_sale_records.length,0);assert.equal(h.tables[M.OPERATIONS].length,0);assert.equal(h.calls.length,0)
  fail=false;assert.equal((await h.invoke('createMobileV1',input)).data.processing_state,'completed')
})
test('concurrent same id has one transaction winner and one execution of side effects',async()=>{
  const gate=deferred();let enters=0
  const h=harness({beforeCommit:async journal=>{if(journal.some(c=>c.kind==='add'&&c.name===M.OPERATIONS)){if(++enters===2)gate.resolve();await gate.promise}}}),input=h.input()
  const responses=await Promise.all([h.invoke('createMobileV1',input),h.invoke('createMobileV1',input)])
  assert.equal(responses.every(r=>r.code===0),true,JSON.stringify(responses));assert.equal(h.tables.crm_sale_records.length,1)
  assert.equal(h.tables[M.OPERATIONS].length,1);assert.equal(h.tables.crm_bottle_movements.length,1);assert.equal(h.tables.crm_vouchers.length,1)
  assert.equal(h.calls.filter(c=>c.name==='crm-bottle-anomaly').length,1)
})
test('post-save failure retains source and receipt, marks pending, never retries side effects',async()=>{
  const h=harness({write:async name=>{if(name==='crm_bottle_movements')throw Error('injected movement failure')}}),input=h.input()
  const result=await h.invoke('createMobileV1',input)
  assert.equal(result.code,0);assert.equal(result.data.source_saved,true);assert.equal(result.data.processing_state,'pending_review')
  assert.match(result.data.warnings.join(' '),/movement failure/)
  const before=h.writes.length,again=await h.invoke('createMobileV1',input)
  assert.equal(again.data.processing_state,'pending_review');assert.equal(h.writes.length,before)
})
test('side warning text becomes durable warnings and does not look completed',async()=>{
  const h=harness({cloud:async()=>({result:{code:503,msg:'外部关联暂不可用'}})}),res=await h.invoke('createMobileV1',h.input())
  assert.equal(res.data.source_saved,true);assert.equal(res.data.processing_state,'pending_review');assert.ok(res.data.warnings.length)
  const query=await h.invoke('getMobileCreateResultV1',{operation_id:'mobile-test-0001'});assert.equal(query.data.warnings.length,res.data.warnings.length)
})
test('lost transaction commit response returns saved processing without running side effects',async()=>{
  const h=harness({afterCommit:async(journal,count)=>{if(count===1)throw Error('commit response lost')}}),res=await h.invoke('createMobileV1',h.input())
  assert.equal(res.code,0);assert.equal(res.data.source_saved,true);assert.equal(res.data.processing_state,'processing')
  assert.equal(h.tables.crm_sale_records.length,1);assert.equal(h.tables.crm_bottle_movements,undefined);assert.equal(h.calls.length,0)
})
test('processing guard blocks ordinary edit, settlement, collection and delete while worker is active',async()=>{
  const entered=deferred(),resume=deferred();let once=false
  const h=harness({write:async name=>{if(name==='crm_bottle_movements'&&!once){once=true;entered.resolve();await resume.promise}}})
  const save=h.invoke('createMobileV1',h.input());await entered.promise
  const id=h.tables.crm_sale_records[0]._id
  for(const action of ['updateV2','updateSettlementV1','quickReceiveV1','removeV2']) {
    const blocked=await h.invoke(action,{recordId:id,payload:payload(),amountReceived:1},'admin')
    assert.equal(blocked.error_code,'MOBILE_SALE_PROCESSING',JSON.stringify(blocked))
  }
  resume.resolve();assert.equal((await save).data.processing_state,'completed')
})
test('receipt survives real removeV2, so delayed create does not resurrect a deleted sale',async()=>{
  const h=harness(),input=h.input(),created=await h.invoke('createMobileV1',input)
  const removed=await h.invoke('removeV2',{recordId:created.data.sale_id},'admin');assert.equal(removed.code,0,JSON.stringify(removed))
  assert.equal(h.tables.crm_sale_records.length,0);assert.equal(h.tables[M.OPERATIONS].length,1)
  const before=h.writes.length,replayed=await h.invoke('createMobileV1',input)
  assert.equal(replayed.data.source_saved,true);assert.equal(replayed.data.source_exists,false);assert.equal(replayed.data.processing_state,'pending_review');assert.equal(h.writes.length,before)
})
test('creator query is isolated, read-only role cannot create, and a missing result never unlocks draft',async()=>{
  const h=harness();await h.invoke('createMobileV1',h.input())
  const other=await h.invoke('getMobileCreateResultV1',{operation_id:'mobile-test-0001'},'other')
  assert.equal(other.code,404);assert.equal(other.data.source_saved,null);assert.equal(other.data.sale_id,undefined)
  assert.equal((await h.invoke('createMobileV1',h.input('reader-test-0001'),'reader')).code,403)
  assert.equal((await h.invoke('getMobileCreateResultV1',{operation_id:'mobile-test-0001'})).data.source_saved,true)
})
test('existing desktop createV2 remains compatible and has no mobile receipt or strict mobile restrictions',async()=>{
  const h=harness(),p=payload();p.outRows=[{bottle_no:'new-desktop',gross:12,tare:2,net:10}];p.depositRows=[]
  const res=await h.invoke('createV2',p,'admin');assert.equal(res.code,0,JSON.stringify(res))
  assert.equal(h.tables.crm_sale_records[0].mobile_create_operation_key,undefined);assert.equal(h.tables[M.OPERATIONS].length,0)
  assert.equal(h.tables.crm_bottles.some(b=>b.bottle_no==='NEW-DESKTOP'),true)
})
test('schema declares captured fields, both mirrored schemas match, operation index matches canonical schema',()=>{
  const dir=path.join(ROOT,'uniCloud-alipay/database')
  for(const name of ['crm_sale_records','crm_mobile_sale_create_operations']) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,name+'.schema.json'))),JSON.parse(fs.readFileSync(path.join(dir,'schema',name+'.schema.json'))))
  }
  const schema=JSON.parse(fs.readFileSync(path.join(dir,'crm_sale_records.schema.json')))
  for(const row of ['out_items','back_items']) for(const key of ['weight_source','weight_sampled_at','scale_session_id','scale_stable_seq','scan_location']) assert.ok(schema.properties[row].items.properties[key])
  const {buildIndexFile}=require(path.join(ROOT,'scripts/syncDomainContracts.cjs'))
  assert.deepEqual(buildIndexFile(JSON.parse(fs.readFileSync(path.join(dir,M.OPERATIONS+'.schema.json')))),JSON.parse(fs.readFileSync(path.join(dir,M.OPERATIONS+'.index.json'))))
})

test('same-key insert collision with winner not yet visible stays unknown and never releases frozen content',async()=>{
  const h=harness({txWrite:async name=>{if(name===M.OPERATIONS)throw Error('duplicate key E11000: concurrent winner not visible')}})
  const result=await h.invoke('createMobileV1',h.input())
  assert.equal(result.code,503);assert.equal(result.error_code,'MOBILE_SALE_RESULT_UNKNOWN');assert.equal(result.data.source_saved,null)
  assert.equal(h.tables.crm_sale_records.length,0);assert.equal(h.calls.length,0)
  const queried=await h.invoke('getMobileCreateResultV1',{operation_id:'mobile-test-0001'})
  assert.equal(queried.code,404);assert.equal(queried.data.source_saved,null)
})
test('pending-review source cannot use ordinary edit or delete as an implicit side-effect retry',async()=>{
  const h=harness({write:async name=>{if(name==='crm_bottle_movements')throw Error('failed movement')}})
  const result=await h.invoke('createMobileV1',h.input()),before=h.writes.length
  for(const action of ['updateV2','updateSettlementV1','quickReceiveV1','removeV2']) {
    const blocked=await h.invoke(action,{recordId:result.data.sale_id,payload:payload(),amountReceived:1},'admin')
    assert.equal(blocked.error_code,'MOBILE_SALE_PROCESSING');assert.equal(blocked.data.processing_state,'pending_review')
  }
  assert.equal(h.writes.length,before)
})
test('receipt lookup outage before processing preserves unknown; no frozen request can be replaced',async()=>{
  const h=harness({read:async name=>{if(name===M.OPERATIONS)throw Error('lookup unavailable')}})
  const result=await h.invoke('createMobileV1',h.input())
  assert.equal(result.error_code,'MOBILE_SALE_RESULT_UNKNOWN');assert.equal(result.data.source_saved,null);assert.equal(h.writes.length,0)
})
