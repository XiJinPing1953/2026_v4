'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
function event(id, bottle, type, date, source = id) {
 return { _id: id, bottle_no: bottle, type, date, event_day: date, event_at: Date.parse(date),
  type_order: { back: 10, fill: 20, out: 30, adjust: 40 }[type], source_type: type === 'fill' ? 'filling' : 'sale',
  source_id: source, customer_name: '测试客户', created_at: 1, updated_at: 1 }
}
function setup(rows, hooks = {}, extra = {}) {
 const tables = { crm_users: [{ _id: 'u', token: 'test', role: 'superadmin' }],
  crm_bottles: ['192', '358', '228'].map(n => ({ _id: n, bottle_no: n, is_active: true, status: 'at_customer' })),
  crm_bottle_movements: rows, ...extra }
 const db = makeDb(tables, hooks)
 return { main: loadHandler('crm-filling', db), db, tables }
}
const payload = (extra = {}) => ({ date: '2026-09-01', preview: true, input_mode: 'net',
 record_type: 'normal_fill', batch_text: '192,66\n358,58\n228,66', operator: '测试', ...extra })
const preview = (s, extra) => invoke(s.main, 'batchCreateV1', payload(extra))
function largeHistory() {
 const rows = Array.from({length: 5186}, (_, i) => event(String(i).padStart(6, '0'), ['192','358','228'][i % 3],
  i < 3 ? 'out' : 'adjust', '2026-08-25'))
 return [...rows, ...['192','358','228'].map((n,i) => event(`z${i}`,n,'back','2026-08-31'))]
}
test('5189 events: latest returns beyond old 5000 limit are read, batch equals single and preview writes nothing', async () => {
 const s = setup(largeHistory()); const r = await preview(s)
 assert.equal(r.code,0); assert.equal(r.data.warning_total,0); assert.equal(r.data.read_complete,true)
 for (const n of ['192','358','228']) assert.equal((await preview(s,{ batch_text:`${n},66` })).data.warning_total,0)
 assert.equal(s.db.writes.length,0)
})
test('historical cutoff and a later outbound preserve real warnings', async () => {
 const s = setup([event('a','192','out','2026-08-25'),event('b','192','back','2026-08-31'),event('c','192','out','2026-09-02')])
 assert.equal((await preview(s,{date:'2026-08-30'})).data.warning_total,1)
 assert.equal((await preview(s)).data.warning_total,0)
 assert.equal((await preview(s,{date:'2026-09-03'})).data.warning_items[0].last_out_date,'2026-09-02')
})
test('same-day ambiguity remains pending; a subsequent effective action resolves it', async () => {
 const s = setup([event('a','192','back','2026-08-31'),event('b','192','out','2026-08-31')])
 assert.equal((await preview(s)).data.warning_items[0].status_code,'waiting_next_action')
 s.tables.crm_bottle_movements.push(event('c','192','back','2026-09-01'))
 assert.equal((await preview(s)).data.warning_total,0)
})
for (const failure of ['query','count','short_page','membership','changed']) {
 test(`incomplete ${failure}: preview and ignored-warning submission cannot write`, async () => {
  for (const isPreview of [true,false]) {
   let counts=0
   const s=setup(largeHistory(),{
    count(name,total) { if(name!=='crm_bottle_movements')return {total}; counts++
     return failure==='count'?{}:{total: failure==='membership' && counts>1 ? total+1:total} },
    get(name,rows,opts) {
     if(name==='crm_bottle_movements') {
      if(failure==='query' && opts.where.$and)throw Error('read failed')
      if(failure==='short_page')return {data:rows.slice(0,100)}
      if(failure==='changed' && opts.limit===1)return {data:[{_id:'changed'}]}
     }
     return {data:structuredClone(rows)}
    }
   })
   const r=await preview(s,{ preview:isPreview,ignoreBottleFlowWarning:true })
   assert.equal(r.error_code,'BOTTLE_FLOW_HISTORY_INCOMPLETE');assert.equal(r.data.confirmable,false)
   assert.equal(r.data.read_complete,false);assert.equal(s.db.writes.length,0)
  }
 })
}
test('create and update ignore flags cannot bypass incomplete history, update excludes own fill', async()=>{
 const rows=[event('a','192','out','2026-08-25'),event('b','192','fill','2026-09-01','fill-self')]
 const extra={crm_fillings:[{_id:'fill-self',date:'2026-09-01',bottle_no:'192',record_type:'normal_fill',fill_weight:66}]}
 const s=setup(rows,{},extra)
 const r=await invoke(s.main,'updateV1',{_id:'fill-self',date:'2026-09-01',bottle_no:'192',fill_weight:66})
 assert.equal(r.code,409);assert.equal(r.data.warning_items[0].status_code,'out');assert.equal(s.db.writes.length,0)
 for(const action of ['createV1','updateV1']) {
  const failed=setup(rows,{count:()=>({})},extra)
  const r=await invoke(failed.main,action,{_id:'fill-self',date:'2026-09-02',bottle_no:'192',fill_weight:66,ignoreBottleFlowWarning:true})
  assert.equal(r.error_code,'BOTTLE_FLOW_HISTORY_INCOMPLETE');assert.equal(failed.db.writes.length,0)
 }
})
test('execution rechecks history after a successful preview',async()=>{
 const s=setup([event('a','192','back','2026-08-31')]);assert.equal((await preview(s)).data.warning_total,0)
 s.tables.crm_bottle_movements.push(event('b','192','out','2026-09-01'))
 const r=await preview(s,{preview:false});assert.equal(r.code,409);assert.equal(r.data.warning_items[0].bottle_no,'192')
 assert.equal(s.db.writes.length,0)
})
test('warning rows beyond the old display limit are prioritized without losing input line numbers',async()=>{
 const nos=Array.from({length:51},(_,i)=>String(i+1))
 const s=setup([event('out','51','out','2026-08-31')],{}, {crm_bottles:nos.map(n=>({_id:n,bottle_no:n,is_active:true}))})
 const r=await preview(s,{batch_text:nos.map(n=>`${n},60`).join('\n')})
 assert.equal(r.data.create_items.length,50);assert.equal(r.data.create_items[0].bottle_no,'51')
 assert.equal(r.data.create_items[0].line_no,51);assert.equal(r.data.warning_total,1)
})
test('post-save incomplete history never updates bottle status and explicitly reports the saved source',async()=>{
 let counts=0
 const s=setup([event('a','192','back','2026-08-31')],{mutate:true,count(name,total){
  if(name==='crm_bottle_movements' && ++counts>2)return {}
  return {total}
 }})
 const r=await invoke(s.main,'createV1',{date:'2026-09-01',bottle_no:'192',fill_weight:66})
 assert.equal(r.error_code,'BOTTLE_FLOW_HISTORY_INCOMPLETE');assert.equal(r.data.source_saved,true)
 assert.equal(s.db.writes.filter(w=>w.name==='crm_fillings').length,1)
 assert.equal(s.db.writes.filter(w=>w.name==='crm_bottles').length,0)
})
