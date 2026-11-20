'use strict'
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto')
const test = require('node:test'), assert = require('node:assert/strict')
const { createRequire } = require('node:module')
// Exercise the existing real Vue/native and cloud-entry harnesses, not a second implementation.
function fixture(file, names) {
  const absolute = path.resolve(file)
  return vm.runInNewContext(fs.readFileSync(absolute, 'utf8').split(/\ntest\(/)[0] + '\n;({' + names.join(',') + '})', {
    require: createRequire(absolute), __dirname: path.dirname(absolute), process, console, Date, Math, Buffer,
    structuredClone, setTimeout, clearTimeout, setInterval, clearInterval
  }, { filename: absolute })
}
const frontend = fixture('scripts/pdaNativeSale.test.cjs', ['harness', 'sales', 'customer'])
const { harness, M } = fixture('scripts/mobileSaleCreate.test.cjs', ['harness', 'M'])
const empty = h => { assert.equal(h.tables.crm_sale_records.length, 0); assert.equal(h.tables[M.OPERATIONS].length, 0) }

test('changed effective price, unit, inactive masters, tare and settlement destination reject without writes', async () => {
  for (const change of [
    h => h.tables.crm_customers[0].default_unit_price = 9,
    h => h.tables.crm_customers[0].default_price_unit = 'm3',
    h => h.tables.crm_customers[0].is_active = false,
    h => h.tables.crm_bottles[0].tare_weight = 3,
    h => h.tables.crm_bottles[0].tare_weight = null,
    (h, p) => { delete p.base.settlementCustomerId },
    (h, p) => { p.base.settlementCustomerId = 'other' },
    h => { h.tables.crm_customers.push({_id:'billing',default_price_unit:'kg',default_unit_price:5}); h.tables.crm_customers[0].settlement_customer_id='billing' }
  ]) {
    const h = harness(), input = h.input(); change(h, input.payload)
    const res = await h.invoke('createMobileV1', input)
    assert.equal(res.code, 409, JSON.stringify(res)); assert.equal(res.data.source_saved, false)
    empty(h); assert.equal(h.writes.length, 0)
  }
})

test('effective inherited pricing, missing active flags and delivery override preserve existing semantics', async () => {
  for (const ownPrice of [false, true]) {
    const h = harness(), input = h.input(), child = h.tables.crm_customers[0]
    delete child.is_active
    child.settlement_customer_id = 'middle'
    if (!ownPrice) { delete child.default_price_unit; delete child.default_unit_price }
    h.tables.crm_customers.push({_id:'middle',settlement_customer_id:'billing'}, {_id:'billing',default_price_unit:'kg',default_unit_price:ownPrice ? 9 : 5})
    input.payload.base.settlementCustomerId = 'billing'
    const res = await h.invoke('createMobileV1', input)
    assert.equal(res.code, 0, JSON.stringify(res))
    const sale = h.tables.crm_sale_records[0]
    assert.equal(sale.customer_id, 'billing'); assert.equal(sale.delivery_customer_id, 'customer-1'); assert.equal(sale.unit_price, 5)
  }
})

test('missing, unknown and fractional BLE evidence rejects but frozen older samples remain valid', async () => {
  for (const patch of [{weight_source:''},{weight_source:'manual'},{scale_session_id:''},{weight_sampled_at:null},{scale_stable_seq:0},{scale_stable_seq:1.5}]) {
    const h = harness(), input = h.input(); Object.assign(input.payload.outRows[0], patch)
    const res = await h.invoke('createMobileV1', input)
    assert.equal(res.code, 400, JSON.stringify(res)); empty(h)
  }
  const h = harness(), input = h.input(); input.payload.outRows[0].weight_sampled_at = 1000
  assert.equal((await h.invoke('createMobileV1', input)).code, 0)
})

test('ordinary account vehicle mismatch/unbound rejects; same vehicle reads back and admin retains override', async () => {
  for (const change of [(h,p)=>p.base.carNo='OTHER', (h,p)=>p.base.carNo='', (h,p)=>p.base.vehicleId='OTHER', h=>delete h.tables.crm_users[0].mobile_sale_defaults]) {
    const h=harness(), input=h.input(); change(h,input.payload)
    assert.equal((await h.invoke('createMobileV1',input)).code,409); empty(h)
  }
  for (const token of ['operator','admin']) {
    const h=harness(), input=h.input()
    if(token==='admin') input.payload.base.carNo='OVERRIDE'
    const saved=await h.invoke('createMobileV1',input,token)
    assert.equal(saved.code,0,JSON.stringify(saved))
    assert.equal((await h.invoke('getPdaV1',{id:saved.data.sale_id},token)).code,0)
    if(token==='admin') assert.equal((await h.invoke('getPdaV1',{id:saved.data.sale_id},'operator')).code,404)
  }
})

test('writes racing source commit abort atomically for price, binding, tare and account vehicle', async () => {
  for (const change of [
    h=>h.tables.crm_customers[0].default_unit_price=9,
    h=>h.tables.crm_customers[0].settlement_customer_id='other',
    h=>h.tables.crm_customers[0].is_active=false,
    h=>h.tables.crm_bottles[0].tare_weight=3,
    h=>h.tables.crm_users[0].mobile_sale_defaults.vehicle_no='OTHER'
  ]) {
    let h, changed=false
    h=harness({beforeCommit:async journal=>{
      if(!changed && journal.some(row=>row.name===M.OPERATIONS&&row.kind==='add')) { changed=true; change(h) }
    }})
    const result=await h.invoke('createMobileV1',h.input())
    assert.equal(changed,true); assert.notEqual(result.code,0); empty(h)
    // Database commit errors remain unknown; never allow a different operation number.
    assert.equal(result.data.source_saved,null)
    assert.equal(h.calls.filter(c=>c.data.mobile_sale_capability).length,0)
  }
})

test('inactive or hidden settlement ancestors and cyclic chains cannot be bypassed by a child price', async () => {
  for (const mode of ['inactive','hidden','cycle','missing']) {
    const h=harness(), input=h.input()
    h.tables.crm_customers[0].settlement_customer_id='parent'; input.payload.base.settlementCustomerId='parent'
    if(mode!=='missing') h.tables.crm_customers.push({_id:'parent',is_active:mode!=='inactive',is_hidden:mode==='hidden',...(mode==='cycle'?{settlement_customer_id:'customer-1'}:{})})
    assert.notEqual((await h.invoke('createMobileV1',input)).code,0); empty(h)
  }
})

test('saved operation recovery precedes changed customer, bottle and vehicle rules', async () => {
  const h=harness(), input=h.input(), saved=await h.invoke('createMobileV1',input)
  assert.equal(saved.code,0)
  h.tables.crm_customers=[]; h.tables.crm_bottles=[]; h.tables.crm_users[0].mobile_sale_defaults.vehicle_no='OTHER'
  const count=h.writes.length, retry=await h.invoke('createMobileV1',input)
  assert.equal(retry.data.idempotent,true); assert.equal(retry.data.sale_id,saved.data.sale_id); assert.equal(h.writes.length,count)
})

test('legacy saved receipt with no new master or capture fields remains recoverable', async () => {
  const h=harness(), input=h.input()
  delete input.payload.base.settlementCustomerId
  for(const k of ['weight_source','scale_session_id','weight_sampled_at','scale_stable_seq']) delete input.payload.outRows[0][k]
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v
  const key=M.keyFor(h.tables.crm_users[0],input.operation_id)
  const digest=crypto.createHash('sha256').update(JSON.stringify(stable(M.normalizePayload(input.payload)))).digest('hex')
  h.tables[M.OPERATIONS].push({_id:key,operation_id:input.operation_id,payload_digest:digest,sale_id:key,created_by:'operator-1',processing_state:'completed',warnings:[]})
  h.tables.crm_sale_records.push({_id:key,created_by:'operator-1',mobile_create_operation_key:key})
  const res=await h.invoke('createMobileV1',input)
  assert.equal(res.code,0); assert.equal(res.data.idempotent,true); assert.equal(h.writes.length,0)
})

test('actual native label plus BLE payload reaches actual cloud handler and idempotent readback', async t => {
  const token='a'.repeat(48)
  const proof={filling_id:'fill-90',operation_id:'fill-op',source_version:1,label_token:token,bottle_no:'90',tare_weight:100,gross_weight:185.5,net_weight:85.5}
  const cloud=harness({cloud:async request=>({result:{code:0,data:request.data.action==='resolveFillingLabelV1'?proof:{job_id:'job',done:true,status:'completed',applied_amount:0,unresolved_count:0}}})})
  cloud.tables.crm_customers=[{...frontend.customer}]
  cloud.tables.crm_bottles=['90','101'].map(no=>({_id:'b'+no,bottle_no:no,tare_weight:100,is_active:true,status:'in_station'}))
  cloud.tables.crm_fillings=[{_id:proof.filling_id,operation_id:proof.operation_id,source_version:1,bottle_no:'90',created_at:100,filling_time:'2026-10-29-09'}]
  const client=await frontend.harness(t,{
    resolveQr:async raw=>{const no=raw.includes('filling-label')?'90':raw;return {code:0,data:{_id:'b'+no,bottle_no:no,tare_weight:100,is_active:true}}},
    resolveLabel:async()=>({code:0,data:proof}),send:(id,payload)=>cloud.invoke('createMobileV1',{operation_id:id,payload})})
  await client.start(); client.panel.sale.form.value.vehicleNo='TEST'
  await client.scan('https://xintuonengyuan.com/#/pages/public/filling-label?t='+token+'&c='+encodeURIComponent('新拓能源')+'&b=90&p=100.0&g=185.5&n=85.5')
  await client.scan('101'); client.frames(120)
  assert.equal(await client.panel.go(3),true); assert.equal(await client.panel.go(4),true)
  assert.equal(await client.panel.save(),true,JSON.stringify(client.panel.sale.receipt.value))
  assert.equal(cloud.tables.crm_sale_records.length,1)
  const input={operation_id:client.requests[0].id,payload:client.requests[0].payload}
  assert.equal(input.payload.base.settlementCustomerId,'customer')
  assert.equal(input.payload.outRows[0].weight_source,'filling_reweigh')
  assert.equal('scale_stable_seq' in input.payload.outRows[0],false)
  assert.equal(input.payload.outRows[1].weight_source,'ble_scale')
  assert.equal((await cloud.invoke('createMobileV1',input)).data.idempotent,true)
  const detail=await cloud.invoke('getPdaV1',{id:cloud.tables.crm_sale_records[0]._id})
  assert.equal(detail.code,0); assert.equal(detail.data.total_net_weight,105.5); assert.equal(detail.data.should_receive,844)
})

test('native vehicle preflight refuses mismatched or unbound accounts before sending, admin may edit',async t=>{
  for(const mode of ['mismatch','unbound','own','admin']) {
    const client=await frontend.harness(t,{role:mode==='admin'?'superadmin':'pda_operator',defaults:mode==='unbound'?{}:{vehicle_id:'v',vehicle_no:'TEST'}})
    await client.start();await client.scan('101');client.frames(120)
    if(mode==='mismatch'||mode==='admin')client.panel.sale.form.value.vehicleNo='OTHER'
    await client.panel.go(3);await client.panel.go(4)
    const okay=mode==='own'||mode==='admin'
    assert.equal(await client.panel.save(),okay,mode)
    assert.equal(client.requests.length,okay?1:0,mode)
    if(!okay)assert.match(client.panel.sale.contextIssue.value || client.panel.error.value,/车辆/)
  }
})

test('legacy label zero placeholder is accepted only with a valid source token and real proof',async()=>{
  const proof={filling_id:'f',operation_id:'op',source_version:1,label_token:'a'.repeat(48),bottle_no:'B1',tare_weight:2,gross_weight:12.5,net_weight:10.5}
  const h=harness({cloud:async request=>({result:{code:0,data:request.data.action==='resolveFillingLabelV1'?proof:{}}})})
  h.tables.crm_fillings=[{_id:'f',operation_id:'op',source_version:1,bottle_no:'B1',created_at:100}]
  const input=h.input();Object.assign(input.payload.outRows[0],{weight_source:'filling_reweigh',filling_label_token:proof.label_token,scale_stable_seq:0,weight_sampled_at:null,scale_session_id:''})
  assert.equal((await h.invoke('createMobileV1',input)).code,0)
})

test('transaction doc reads accept uniCloud object-shaped results, including inherited customers',async()=>{
  const h=harness(), input=h.input()
  h.tables.crm_customers[0].settlement_customer_id='billing';input.payload.base.settlementCustomerId='billing'
  h.tables.crm_customers.push({_id:'billing',default_price_unit:'kg',default_unit_price:5})
  const start=h.db.startTransaction
  h.db.startTransaction=async()=>{
    const tx=await start(), collection=tx.collection
    tx.collection=name=>{
      const col=collection(name)
      return new Proxy(col,{get(target,key){
        if(key==='doc')return id=>{const query=target.doc(id);return new Proxy(query,{get(q,k){
          if(k==='get')return async()=>{const res=await q.get();return {...res,data:Array.isArray(res.data)?res.data[0]||null:res.data}}
          return q[k]
        }})}
        return target[key]
      }})
    }
    return tx
  }
  const res=await h.invoke('createMobileV1',input)
  assert.equal(res.code,0,JSON.stringify(res));assert.equal(h.tables.crm_sale_records[0].customer_id,'billing')
})

test('intermediate settlement node changing at commit conflicts with the full-chain write guard',async()=>{
  let h
  h=harness({beforeCommit:async journal=>{
    if(journal.some(row=>row.name===M.OPERATIONS&&row.kind==='add'))h.tables.crm_customers.find(c=>c._id==='middle').settlement_customer_id='other'
  }})
  const input=h.input();input.payload.base.settlementCustomerId='billing'
  h.tables.crm_customers[0].settlement_customer_id='middle'
  h.tables.crm_customers.push({_id:'middle',settlement_customer_id:'billing'},{_id:'billing',default_price_unit:'kg',default_unit_price:5},{_id:'other',default_price_unit:'kg',default_unit_price:5})
  const result=await h.invoke('createMobileV1',input)
  assert.notEqual(result.code,0);empty(h)
})

test('legacy positive BLE metadata on a label cannot bypass proof and retains saved-request fingerprints',async()=>{
  for(const valid of [true,false]) {
    const proof={filling_id:'f',operation_id:'op',source_version:1,label_token:'a'.repeat(48),bottle_no:'B1',tare_weight:2,gross_weight:12.5,net_weight:10.5}
    let verifies=0
    const h=harness({cloud:async request=>{
      if(request.data.action==='resolveFillingLabelV1'){verifies++;return {result:valid?{code:0,data:proof}:{code:409,msg:'标签已失效'}}}
      return {result:{code:0,data:{}}}
    }})
    h.tables.crm_fillings=[{_id:'f',operation_id:'op',source_version:1,bottle_no:'B1',created_at:100}]
    const input=h.input();Object.assign(input.payload.outRows[0],{weight_source:'filling_reweigh',filling_label_token:proof.label_token})
    const result=await h.invoke('createMobileV1',input)
    assert.equal(verifies,1)
    if(valid){
      assert.equal(result.code,0)
      const retry=await h.invoke('createMobileV1',input)
      assert.equal(retry.data.idempotent,true);assert.equal(verifies,1);assert.equal(h.tables.crm_sale_records.length,1)
    }else{assert.equal(result.code,409);empty(h)}
  }
})
