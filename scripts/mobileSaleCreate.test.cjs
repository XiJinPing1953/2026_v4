'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const ROOT = process.env.MOBILE_SALE_TEST_ROOT || path.resolve(__dirname, '..')
const { makeDb } = require(path.join(ROOT, 'scripts/lib/accountingTestHarness.cjs'))
const M = require(path.join(ROOT, 'uniCloud-alipay/cloudfunctions/crm-sale/mobileSaleCreate.js'))
const Effects = require(path.join(ROOT, 'uniCloud-alipay/cloudfunctions/common/mobileSaleEffects.js'))
const { hasPagePermission } = require(path.join(ROOT, 'uniCloud-alipay/cloudfunctions/common/pageAcl.js'))
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

function loadDownstream(name, db) {
  const filename=path.join(ROOT,`uniCloud-alipay/cloudfunctions/${name}/index.js`)
  const context={exports:{},require:createRequire(filename),uniCloud:{database:()=>db},
    console:{log(){},warn(){},error(){}},Date,Math,Set,Map,Buffer,process,setTimeout,clearTimeout}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename})
  return event=>context.exports.main(event,{})
}

function effectHarness(hooks = {}) {
  const capability={operation_key:'a'.repeat(24),token:Effects.newToken()}
  const user={_id:'operator',role:'pda_operator',page_permissions:{'/pages/pda/sale-create':{view:true,create:true}}}
  const sale={_id:capability.operation_key,created_by:user._id,mobile_create_operation_key:capability.operation_key,mobile_create_state:'processing',
    source:M.SOURCE,biz_mode:'bottle',price_unit:'kg',settlement_mode:'sale',amount_received:0,apply_offset_credit:false,offset_enabled:false,
    customer_id:'customer',out_items:[{bottle_no:'B1'}],back_items:[{bottle_no:'B2'}],deposit_rows:[{bottle_no:'B3'}]}
  const operation={_id:capability.operation_key,sale_id:sale._id,created_by:user._id,processing_state:'processing',side_effect_token_hash:Effects.tokenHash(capability.token),side_effect_claims:[]}
  const tables={[M.OPERATIONS]:[operation],crm_sale_records:[sale]}
  const db=database(tables,hooks)
  const args={db:db.db,user,hasPagePermission,capability,cloudFunction:'crm-customer-settlement',action:'autoApplyPrepayToSaleV1',data:{sale_id:sale._id,exclude_offset_credit:true}}
  return {...db,tables,user,sale,operation,capability,args,authorize:()=>Effects.authorizeMobileSaleEffect(args)}
}

test('server capability grants only exact saved-source steps once and is never returned or stored in plaintext',async()=>{
  const h=harness(),res=await h.invoke('createMobileV1',h.input())
  const calls=h.calls.filter(call=>call.data.mobile_sale_capability)
  assert.deepEqual(calls.map(call=>call.data.action).sort(),['autoApplyPrepayToSaleV1','touchV2'])
  assert.equal(h.calls.some(call=>call.data.action==='repairOffsetCreditsV1'),false)
  const capability=calls[0].data.mobile_sale_capability
  assert.match(capability.token,/^[a-f0-9]{64}$/)
  assert.equal(h.tables[M.OPERATIONS][0].side_effect_token_hash,Effects.tokenHash(capability.token))
  assert.equal(JSON.stringify(h.tables).includes(capability.token),false)
  assert.equal(JSON.stringify(res).includes(capability.token),false)
  const one=effectHarness()
  assert.equal((await one.authorize()).ok,true)
  assert.deepEqual(one.tables[M.OPERATIONS][0].side_effect_claims,['crm-customer-settlement:autoApplyPrepayToSaleV1'])
  assert.equal((await one.authorize()).code,403)
})

test('capability rejects forged credentials, owner/source/state changes, broader scope and historical repair',async()=>{
  for(const mutate of [h=>h.args.capability=null,h=>h.args.capability={...h.capability,token:'b'.repeat(64)},
    h=>h.user._id='other',h=>h.user.page_permissions['/pages/pda/sale-create'].create=false,
    h=>h.operation.processing_state='completed',h=>h.sale.mobile_create_state='pending_review',h=>h.sale.created_by='other',
    h=>h.sale.mobile_create_operation_key='b'.repeat(24),h=>h.sale.source='manual-v4',h=>h.sale.amount_received=1,
    h=>h.args.data.sale_id='other',h=>h.args.data.exclude_offset_credit=false,h=>h.args.data.customer_id='other',
    h=>{h.args.action='repairOffsetCreditsV1';h.args.data={customer_id:'customer',date_from:'2026-10-01',date_to:'2026-10-16',execute:true,auto_apply:false}},
    h=>{h.args.cloudFunction='crm-filling';h.args.action='syncStartLossAdjustmentsV1';h.args.data={bottle_nos:['B1']}},
    h=>{h.args.cloudFunction='crm-filling';h.args.action='syncStartLossAdjustmentsV1';h.args.data={bottle_nos:['B2'],filling_ids:['other']}}]) {
    const h=effectHarness();mutate(h)
    const result=await h.authorize()
    assert.equal(result.code,403,JSON.stringify(result));assert.equal(h.writes.length,0)
  }
  const h=effectHarness();h.args.cloudFunction='crm-filling';h.args.action='syncStartLossAdjustmentsV1';h.args.data={bottle_nos:['B2']}
  assert.equal((await h.authorize()).ok,true)
  h.args.cloudFunction='crm-bottle-anomaly';h.args.action='touchV2';h.args.data={bottle_nos:['B1','B2','B3'],truck_nos:[],batch_size:120,max_events_per_round:800,max_ms_per_round:2200,max_writes_per_round:120}
  assert.equal((await h.authorize()).ok,true)
})

test('concurrent claims and a lost claim response never execute a downstream step twice',async()=>{
  const h=effectHarness(),results=await Promise.all([h.authorize(),h.authorize()])
  assert.equal(results.filter(result=>result.ok).length,1)
  assert.equal(h.writes.length,1)
  const lost=effectHarness({afterCommit:async()=>{throw Error('claim response lost')}})
  assert.equal((await lost.authorize()).code,503)
  assert.equal(lost.tables[M.OPERATIONS][0].side_effect_claims.length,1)
  assert.equal((await lost.authorize()).code,403)
  assert.equal(lost.writes.length,1)
})

test('minimal account traverses real downstream ACLs without gaining direct financial, anomaly or filling access',async()=>{
  let h
  const handlers=new Map(),results=[]
  h=harness({cloud:async request=>{
    if(request.name==='crm-reg-bridge')return {result:{code:0}}
    if(!handlers.has(request.name))handlers.set(request.name,loadDownstream(request.name,h.db))
    const result=await handlers.get(request.name)(request.data)
    results.push({name:request.name,result})
    return {result}
  }})
  h.tables.crm_bottles.push({_id:'bottle-2',bottle_no:'B2',tare_weight:2,is_active:true,status:'at_customer',current_customer_id:'customer-1'})
  const input=h.input();input.payload.outRows=[];input.payload.depositRows=[]
  input.payload.backRows=[{bottle_no:'B2',bottle_id:'bottle-2',gross:2.5,tare:2,net:0.5}]
  input.payload.ignore_bottle_flow_warning=true
  const response=await h.invoke('createMobileV1',input)
  assert.equal(response.data.source_saved,true,JSON.stringify(response))
  assert.equal(response.data.processing_state,'completed',JSON.stringify(response))
  assert.equal((await h.invoke('getV2',{_id:response.data.sale_id},'admin')).data.should_receive,-2.5)
  assert.equal(results.length,3,JSON.stringify(results))
  for(const entry of results)assert.equal(entry.result.code,0,JSON.stringify(entry))
  assert.equal(h.tables[M.OPERATIONS][0].side_effect_claims.length,3)
  for(const request of h.calls.filter(call=>call.data.mobile_sale_capability)) {
    const {mobile_sale_capability,...event}=request.data
    assert.equal((await handlers.get(request.name)(event)).code,403)
    assert.equal((await handlers.get(request.name)({...event,mobile_sale_capability:{...mobile_sale_capability,token:'b'.repeat(64)}})).code,403)
    assert.equal((await handlers.get(request.name)(request.data)).code,403)
  }
  const settlement=handlers.get('crm-customer-settlement')
  assert.equal((await settlement({token:'operator',action:'repairOffsetCreditsV1',data:{customer_id:'customer-1',execute:true,date_from:'2026-10-01',date_to:'2026-10-16'}})).code,403)
})

function queuedRefreshHarness(initialState = 'pending') {
  const {jobKey}=require(path.join(ROOT,'uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/refreshJobs.js'))
  const crypto=require('node:crypto')
  let h
  h=harness({cloud:async request=>{
    if(request.name!=='crm-bottle-anomaly')return {result:{code:0,data:{applied_amount:0}}}
    const event=request.data,bottleNos=event.data.bottle_nos.slice().sort()
    const targets=bottleNos.map(no=>({kind:'bottle',no}))
    const id=jobKey('operator-1',event.request_id,targets)
    ;(h.tables.crm_anomaly_refresh_jobs ||= []).push({_id:id,created_by:'operator-1',request_id:event.request_id,
      targets,targets_hash:crypto.createHash('sha256').update(JSON.stringify(targets)).digest('hex'),
      bottle_nos:bottleNos,truck_nos:[],target_index:0,status:initialState})
    return {result:{code:0,data:{job_id:id,status:initialState,done:false}}}
  }})
  return h
}
test('accepted refresh remains processing then query settles both rows without replaying effects',async()=>{
  const h=queuedRefreshHarness(),input=h.input(),created=await h.invoke('createMobileV1',input)
  assert.equal(created.data.processing_state,'processing',JSON.stringify(created))
  const op=h.tables[M.OPERATIONS][0],job=h.tables.crm_anomaly_refresh_jobs[0]
  assert.equal(op.anomaly_refresh_job_id,job._id);assert.equal(op.anomaly_refresh_state,'pending')
  assert.equal(job.request_id,`mobile-sale-${op._id}`);assert.equal(op.warnings.length,0)
  assert.equal(h.tables.crm_sale_records[0].mobile_create_state,'processing')
  const calls=h.calls.length,before=h.writes.length
  assert.equal((await h.invoke('getMobileCreateResultV1',{operation_id:input.operation_id})).data.processing_state,'processing')
  assert.equal(h.writes.length,before)
  job.status='complete';job.target_index=job.targets.length
  const results=await Promise.all([h.invoke('getMobileCreateResultV1',{operation_id:input.operation_id}),h.invoke('getMobileCreateResultV1',{operation_id:input.operation_id})])
  for(const result of results)assert.equal(result.data.processing_state,'completed',JSON.stringify(result))
  assert.equal(h.tables[M.OPERATIONS][0].processing_state,'completed')
  assert.equal(h.tables[M.OPERATIONS][0].anomaly_refresh_state,'complete')
  assert.equal(h.tables.crm_sale_records[0].mobile_create_state,'completed')
  assert.equal(h.calls.length,calls)
  assert.ok(h.writes.slice(before).every(row=>[M.OPERATIONS,'crm_sale_records'].includes(row.name)))
  const settled=h.writes.length
  assert.equal((await h.invoke('createMobileV1',input)).data.processing_state,'completed')
  assert.equal(h.writes.length,settled);assert.equal(h.calls.length,calls)
})
test('failed, missing, mismatched and incomplete refresh facts enter review without completing another sale',async()=>{
  const failed=queuedRefreshHarness('failed'),failedResult=await failed.invoke('createMobileV1',failed.input())
  assert.equal(failedResult.data.processing_state,'pending_review')
  assert.equal(failedResult.data.anomaly_refresh_job_id,failed.tables.crm_anomaly_refresh_jobs[0]._id)
  assert.equal(failedResult.data.anomaly_refresh_state,'failed')
  for(const mutate of [h=>{h.tables.crm_anomaly_refresh_jobs[0].status='failed'},
    h=>{h.tables.crm_anomaly_refresh_jobs=[]},h=>{h.tables.crm_anomaly_refresh_jobs[0].created_by='other'},
    h=>{h.tables.crm_anomaly_refresh_jobs[0].request_id='another-sale'},
    h=>{h.tables.crm_anomaly_refresh_jobs[0].targets[0].no='B2'},
    h=>{const job=h.tables.crm_anomaly_refresh_jobs[0];job.targets[0].kind='truck';job.targets_hash=require('node:crypto').createHash('sha256').update(JSON.stringify(job.targets)).digest('hex')},
    h=>{h.tables.crm_anomaly_refresh_jobs[0].targets_hash='wrong'},
    h=>{h.tables.crm_anomaly_refresh_jobs[0].target_index=0}]) {
    const h=queuedRefreshHarness(),input=h.input();await h.invoke('createMobileV1',input)
    const job=h.tables.crm_anomaly_refresh_jobs[0];job.status='complete';job.target_index=job.targets.length
    mutate(h)
    const calls=h.calls.length,before=h.writes.length
    const result=await h.invoke('getMobileCreateResultV1',{operation_id:input.operation_id})
    assert.equal(result.data.processing_state,'pending_review',JSON.stringify(result));assert.ok(result.data.warnings.length)
    assert.equal(h.tables[M.OPERATIONS][0].processing_state,'pending_review')
    assert.equal(h.tables.crm_sale_records[0].mobile_create_state,'pending_review')
    assert.equal(h.calls.length,calls)
    assert.ok(h.writes.slice(before).every(row=>[M.OPERATIONS,'crm_sale_records'].includes(row.name)))
  }
})

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
test('signed and return-only weights match desktop accounting and retain same-operation idempotency',async()=>{
  for(const [outNet,net,expectedAmount] of [[10.5,0,52.5],[10.5,-0.5,55],[0,-0.5,2.5],[0,0,0],[0,0.5,-2.5]]) {
    const mobile=harness(),desktop=harness(),input=mobile.input()
    for(const h of [mobile,desktop]) h.tables.crm_bottles.push({_id:'bottle-2',bottle_no:'B2',tare_weight:2,is_active:true,status:'at_customer',current_customer_id:'customer-1'})
    if(!outNet) { input.payload.outRows=[];input.payload.depositRows=[] }
    input.payload.backRows=[{bottle_no:'B2',bottle_id:'bottle-2',gross:2+net,tare:2,net}]
    if(!outNet) {
      const warning=await mobile.invoke('createMobileV1',input),ordinaryWarning=await desktop.invoke('createV2',clone(input.payload),'admin')
      assert.equal(warning.code,409);assert.equal(warning.data.confirmable,true);assert.equal(warning.data.source_saved,false)
      assert.equal(ordinaryWarning.code,409);assert.deepEqual(clone(warning.data.warning_items),clone(ordinaryWarning.data.warning_items))
      assert.equal(mobile.writes.length,0);assert.equal(desktop.writes.length,0)
    }
    input.payload.ignore_bottle_flow_warning=true
    const created=await mobile.invoke('createMobileV1',input)
    assert.equal(created.data.processing_state,'completed',JSON.stringify(created))
    const ordinary=await desktop.invoke('createV2',clone(input.payload),'admin')
    assert.equal(ordinary.code,0,JSON.stringify(ordinary))
    const sale=mobile.tables.crm_sale_records[0],desktopSale=desktop.tables.crm_sale_records[0]
    assert.equal(sale.back_items[0].net,net)
    assert.equal(sale.out_items.length,outNet?1:0)
    assert.equal(sale.payment_status,'unpaid');assert.equal(sale.payment_method,'on_account');assert.equal(sale.amount_received,0)
    assert.equal(mobile.tables.crm_bottle_movements.length,outNet?2:1)
    assert.equal(mobile.tables.crm_bottle_movements.filter(row=>row.type==='back').length,1)
    assert.equal(mobile.tables.crm_bottle_movements.find(row=>row.type==='back').net_weight,net)
    const detail=(await mobile.invoke('getV2',{_id:sale._id},'admin')).data
    const desktopDetail=(await desktop.invoke('getV2',{_id:desktopSale._id},'admin')).data
    for(const key of ['out_net_total','back_net_total','total_net_weight','out_amount','back_amount','should_receive','effective_should_receive']) assert.equal(detail[key],desktopDetail[key],key)
    assert.equal(detail.back_net_total,net);assert.equal(detail.back_amount,net*5);assert.equal(detail.should_receive,expectedAmount)
    const writes=mobile.writes.length,calls=mobile.calls.length
    const retry=await mobile.invoke('createMobileV1',input)
    assert.equal(retry.data.idempotent,true);assert.equal(retry.data.sale_id,sale._id)
    assert.equal(mobile.writes.length,writes);assert.equal(mobile.calls.length,calls)
    assert.equal(mobile.tables.crm_sale_records.length,1);assert.equal(mobile.tables[M.OPERATIONS].length,1)
  }
})
test('signed return net still requires registered bottle, finite tenths and consistent physical weights',async()=>{
  for(const patch of [{net:null},{net:NaN},{net:-Infinity},{net:-0.51},{net:-0.6},
    {gross:0,tare:0.5},{gross:1,tare:-0.5,net:1.5},{bottle_id:'missing'},{bottle_no:'wrong'}]) {
    const h=harness(),input=h.input()
    input.payload.backRows=[{bottle_no:'B1',bottle_id:'bottle-1',gross:1.5,tare:2,net:-0.5,...patch}]
    const result=await h.invoke('createMobileV1',input)
    assert.equal(result.code,400,JSON.stringify(result));assert.equal(result.data.source_saved,false)
    assert.equal(h.writes.length,0);assert.equal(h.calls.length,0)
  }
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
    p=>p.outRows=[],
    p=>Object.assign(p.outRows[0],{gross:2,tare:2,net:0}),p=>Object.assign(p.outRows[0],{gross:1.5,tare:2,net:-0.5}),
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
  assert.equal(h.calls.some(call=>call.data.action==='repairOffsetCreditsV1'),true)
  assert.equal(h.calls.some(call=>call.data.mobile_sale_capability),false)
})
test('schema declares captured fields, both mirrored schemas match, operation index matches canonical schema',()=>{
  const dir=path.join(ROOT,'uniCloud-alipay/database')
  for(const name of ['crm_sale_records','crm_mobile_sale_operations']) {
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
test('pending-review sale allows authorized ordinary mutation and preserves original receipt on retry',async()=>{
  for(const action of ['updateV2','updateSettlementV1','quickReceiveV1','removeV2']) {
    let failOnce=true
    const h=harness({write:async name=>{if(name==='crm_bottle_movements'&&failOnce){failOnce=false;throw Error('failed movement')}}})
    const input=h.input(), result=await h.invoke('createMobileV1',input)
    assert.equal(result.data.processing_state,'pending_review')
    const detail=await h.invoke('getV2',{_id:result.data.sale_id},'admin')
    assert.equal(detail.data.mobile_create_review.mutation_blocked,false)
    assert.match(detail.data.mobile_create_review.warnings.join(' '),/failed movement/)
    assert.equal(JSON.stringify(detail).includes('side_effect_token_hash'),false)
    const mutation=await h.invoke(action,{recordId:result.data.sale_id,payload:payload(),amountReceived:1},'admin')
    assert.notEqual(mutation.error_code,'MOBILE_SALE_PROCESSING',JSON.stringify(mutation))
    if(['updateV2','removeV2'].includes(action)) assert.equal(mutation.code,0,JSON.stringify(mutation))
    const before=h.writes.length, replay=await h.invoke('createMobileV1',input)
    assert.equal(replay.data.processing_state,'pending_review');assert.equal(h.writes.length,before)
    assert.equal(h.tables[M.OPERATIONS].length,1)
  }
})
test('first edit of an expired interrupted create accepts own receipt closure but rejects concurrent business changes',async()=>{
  for(const concurrent of [false,true]) {
    let armed=false,changed=false
    const h=harness({afterCommit:async(journal,count)=>{if(count===1)throw Error('commit response lost')},
      read:async name=>{
        if(armed&&concurrent&&!changed&&name==='crm_customers'&&h.tables.crm_sale_records[0]?.mobile_create_state==='pending_review') {
          changed=true;h.tables.crm_sale_records[0].remark='concurrent business change'
        }
      }})
    await h.invoke('createMobileV1',h.input())
    const source=h.tables.crm_sale_records[0]
    source.created_at=Date.now()-8*60*1000
    h.tables[M.OPERATIONS][0].created_at=source.created_at
    const p=payload();p.base.remark='first edit';armed=true
    const edit=h.invoke('updateV2',{recordId:source._id,payload:p},'admin')
    let result
    if(concurrent) await assert.rejects(edit,/销售单已变化/)
    else result=await edit
    assert.equal(h.tables.crm_sale_records[0].mobile_create_state,'pending_review')
    if(concurrent) {
      assert.equal(changed,true)
      assert.equal(h.tables.crm_sale_records[0].remark,'concurrent business change')
    } else {
      assert.equal(result.code,0,JSON.stringify(result))
      assert.equal(h.tables.crm_sale_records[0].remark,'first edit')
    }
  }
})
test('expired interrupted create unlocks, closes old capability, and never recreates after deletion',async()=>{
  const h=harness({afterCommit:async(journal,count)=>{if(count===1)throw Error('commit response lost')}}),input=h.input()
  const result=await h.invoke('createMobileV1',input),source=h.tables.crm_sale_records[0]
  source.created_at=Date.now()-8*60*1000
  h.tables[M.OPERATIONS][0].created_at=source.created_at
  const detail=await h.invoke('getV2',{_id:source._id},'admin')
  assert.equal(detail.data.mobile_create_review.processing_state,'pending_review')
  assert.match(detail.data.mobile_create_review.warnings.join(' '),/执行时限/)
  const removed=await h.invoke('removeV2',{recordId:result.data.sale_id},'admin')
  assert.equal(removed.code,0,JSON.stringify(removed))
  assert.equal(h.tables[M.OPERATIONS][0].processing_state,'pending_review')
  const before=h.writes.length,replay=await h.invoke('createMobileV1',input)
  assert.equal(replay.data.source_exists,false);assert.equal(h.writes.length,before)
})
test('ordinary sale permissions remain required to review or modify a mobile sale',async()=>{
  const h=harness(),result=await h.invoke('createMobileV1',h.input())
  for(const action of ['getV2','updateV2','removeV2']) {
    const response=await h.invoke(action,{_id:result.data.sale_id,recordId:result.data.sale_id,payload:payload()})
    assert.equal(response.code,403,JSON.stringify(response))
  }
})
test('receipt lookup outage before processing preserves unknown; no frozen request can be replaced',async()=>{
  const h=harness({read:async name=>{if(name===M.OPERATIONS)throw Error('lookup unavailable')}})
  const result=await h.invoke('createMobileV1',h.input())
  assert.equal(result.error_code,'MOBILE_SALE_RESULT_UNKNOWN');assert.equal(result.data.source_saved,null);assert.equal(h.writes.length,0)
})

test('filling label source is verified again at submit; correction or newer-filling race rolls back source',async()=>{
 for (const race of [false,'correct','newer']) {
  let h
  const proof={ filling_id:'fill-1',operation_id:'fill-op-1',source_version:1,label_token:'a'.repeat(48),bottle_no:'B1',tare_weight:2,gross_weight:12.5,net_weight:10.5 }
  h=harness({cloud:async request=>{
   if(request.data.action==='resolveFillingLabelV1') {
    assert.equal(request.data.data.token,proof.label_token)
    if(race === 'correct') h.tables.crm_fillings[0].source_version=2
    if(race === 'newer') h.tables.crm_fillings.push({_id:'fill-2',operation_id:'fill-op-2',source_version:1,bottle_no:'B1',created_at:101})
    return {result:{code:0,data:proof}}
   }
   return {result:{code:0,data:{job_id:'test-job',done:true,status:'completed',applied_amount:0,unresolved_count:0}}}
  }})
  h.tables.crm_fillings=[{_id:'fill-1',operation_id:'fill-op-1',source_version:1,bottle_no:'B1',created_at:100}]
  const input=h.input();Object.assign(input.payload.outRows[0],{weight_source:'filling_reweigh',filling_label_token:proof.label_token})
  const response=await h.invoke('createMobileV1',input)
  if(race) {assert.notEqual(response.code,0);assert.equal(h.tables.crm_sale_records.length,0);assert.equal(h.tables[M.OPERATIONS].length,0)}
  else {assert.equal(response.code,0);assert.equal(h.tables.crm_sale_records[0].mobile_filling_label_sources[0].label_token,proof.label_token)}
 }
 const h=harness({cloud:async()=>({result:{code:409,msg:'已更正'}})})
 const input=h.input();Object.assign(input.payload.outRows[0],{weight_source:'filling_reweigh',filling_label_token:'a'.repeat(48)})
 assert.equal((await h.invoke('createMobileV1',input)).code,409);assert.equal(h.tables.crm_sale_records.length,0)
})
