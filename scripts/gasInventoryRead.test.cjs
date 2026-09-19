'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { makeDb } = require('./lib/accountingTestHarness.cjs')
const { readLatestMovements, readLedgerDelta } = require('../uniCloud-alipay/cloudfunctions/crm-gas-in/inventoryRead')
const core = require('../uniCloud-alipay/cloudfunctions/crm-gas-in/currentInventory')
const command = { in: (values) => ({ in: values }), gte: (value) => ({ gte: value }), aggregate: { first: (value) => ({ first: value }), sum: (value) => ({ sum: value }) } }
function aggregateCollection(source, metrics = {}) {
 return { aggregate() {
  let rows = [...source]
  return {
   match(where) { rows = rows.filter((row) => Object.entries(where).every(([key, value]) => value.in ? value.in.includes(row[key]) : row[key] >= value.gte)); return this },
   sort(order) { rows.sort((a,b) => { for (const [k,d] of Object.entries(order)) { if (a[k] !== b[k]) return (a[k] > b[k] ? 1 : -1)*d } return 0 }); return this },
   group(spec) { if (spec.movement_id) { const byBottle=new Map(); for (const row of rows) if (!byBottle.has(row.bottle_no)) byBottle.set(row.bottle_no,Object.fromEntries(Object.entries(spec).map(([key,value])=>[key,key==='_id'?row.bottle_no:row[value.first.slice(1)]]))); rows=[...byBottle.values()] } else { assert.equal(spec.station_delta_t.sum,'$station_delta_t'); rows=rows.length?[{_id:null,station_delta_t:rows.reduce((n,r)=>n+r.station_delta_t,0)}]:[] } return this },
   limit(n) { rows=rows.slice(0,n); return this },
   async end() { metrics.calls=(metrics.calls||0)+1; metrics.returned=(metrics.returned||0)+rows.length; return {data:rows} }
  }
 } }
}
test('long histories and missing movements do not require history-page round trips; all 601 bottles considered',async()=>{
 const bottles=Array.from({length:601},(_,i)=>`B${i}`), events=[];
 for(const b of bottles.slice(0,-1)) for(let i=0;i<25;i++) events.push({_id:`${b}-${i}`,bottle_no:b,type:i===24?'out':'fill',event_at:100+i,type_order:i===24?30:20,created_at:i})
 const metrics={}; const rows=await readLatestMovements(aggregateCollection(events,metrics),command,bottles,100);
 assert.equal(rows.length,600); assert.ok(rows.every(r=>r.type==='out')); assert.equal(metrics.calls,3); assert.equal(metrics.returned,600);
})
test('cutoff, type precedence and deterministic id ties preserve latest flow',async()=>{
 const rows=await readLatestMovements(aggregateCollection([
 {_id:'old',bottle_no:'A',type:'out',event_at:99,type_order:30,created_at:100},
 {_id:'a',bottle_no:'A',type:'fill',event_at:100,type_order:20,created_at:1},
 {_id:'b',bottle_no:'A',type:'out',event_at:100,type_order:30,created_at:1},
 {_id:'c',bottle_no:'A',type:'out',event_at:100,type_order:30,created_at:1},
 {_id:'ignored',bottle_no:'A',type:'adjust',event_at:200,type_order:99,created_at:1}
 ]),command,['a','A',' A '],100); assert.equal(rows.length,1); assert.equal(rows[0]._id,'c');
})
test('ledger aggregates the full period beyond the previous scan cap',async()=>{
 const rows=Array.from({length:120001},()=>({event_at:100,station_delta_t:0.001})); rows.push({event_at:99,station_delta_t:500});
 const delta=await readLedgerDelta(aggregateCollection(rows),command,100);
 assert.equal(core.roundTon(delta),120.001);
 assert.equal(await readLedgerDelta(aggregateCollection([]),command,100),0);
})
function handler(tables, hooks={}, aggregates={}) {
 const db=makeDb({crm_users:[{_id:'u',token:'test',role:'superadmin'}],...tables},hooks); db.command.aggregate=command.aggregate;
 const original=db.collection; db.collection=(name)=>{const c=original(name); if(aggregates[name]) c.aggregate=aggregates[name].aggregate; return c};
 const filename=path.resolve(__dirname,'../uniCloud-alipay/cloudfunctions/crm-gas-in/index.js');
 const context={exports:{},require:createRequire(filename),uniCloud:{database:()=>db},console:{info(){},warn(){},error(){}},Date,Math,Set,Map,Buffer,process};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
 return { main:(action,data={})=>context.exports.main({action,data,token:'test'},{}),db };
}
test('light list returns complete filtered totals without any inventory/filling query',async()=>{
 const queried=[];const rows=Array.from({length:405},(_,i)=>({_id:`g${i}`,date:'2026-09-19',net_weight_t:2,station_weight_t:1.5,direct_sale_weight_t:0.5,amount:200,load_weight_t:2}));
 const {main,db}=handler({crm_gas_in:rows},{get(name,rows){queried.push(name);assert.ok(!/movements|fillings|telemetry|periods/.test(name));return {data:rows}}});
 const r=await main('listV1',{include_inventory:false,pageSize:50});assert.equal(r.code,0);assert.equal(r.data.length,50);assert.equal(r.total,405);assert.equal(r.summary.net_weight_t_total,810);assert.equal(r.summary.station_weight_t_total,607.5);assert.equal(r.summary.inventory,null);assert.equal(db.writes.length,0);
})
test('failed bottle and ledger reads cannot appear as zero inventory',async()=>{
 const failing={aggregate(){return {match(){return this},group(){return this},end(){throw Error('database unavailable')}}}};
 const {main}=handler({crm_tank_telemetry:[{tank_id:'main',status:'online',lng_weight_t:10,sampled_at:Date.now(),updated_at:Date.now()}]}, {get(name,rows){if(name==='crm_fillings')throw Error('filling scan failed');return {data:rows}}},{crm_gas_inventory_movements:failing});
 const r=await main('getCurrentInventoryV1');assert.equal(r.code,0);assert.equal(r.data.current.physical.available,false);assert.equal(r.data.current.physical.total_t,null);assert.equal(r.data.current.physical.filled_unsold_t,null);assert.equal(r.data.current.ledger.tank_t,null);assert.equal(r.data.current.quality.load_error,true);assert.equal(r.data.current.quality.ledger_load_error,true);
})
function frontendHarness(call) {
 const vue=fs.readFileSync(path.resolve(__dirname,'../src/components/domain/gasIn/GasInListView.vue'),'utf8');
 const names=['buildEmptyCurrentInventory','applyResult','refreshCurrentInventory'];
 const functions=names.map(name=>{const start=vue.indexOf((name==='refreshCurrentInventory'?'async ':'')+'function '+name+'(');const end=vue.indexOf('\n}',start)+2;return vue.slice(start,end)}).join('\n');
 const context={summary:{inventory:{current:{physical:{total_t:12}},tank:{}}},list:{value:[]},pager:{},tankConfigDraft:{value:''},clockNow:{value:0},normalizeString:x=>String(x||''),getInventoryAsOfDate:()=>'',buildEmptyTankTelemetry:()=>({}),buildEmptyTankEstimate:()=>({}),getCurrentGasInventoryV1:call,console:{warn(){}},Date};
 vm.runInNewContext('let inventoryRefreshRunning=false;\n'+functions+'\nthis.apply=applyResult;this.refresh=refreshCurrentInventory;',context);return context;
}
test('late list response does not reset independently loaded inventory',()=>{
 const ui=frontendHarness();ui.apply({rows:[{_id:'g'}],summary:{total:1,amount_total:123}});assert.equal(ui.summary.inventory.current.physical.total_t,12);assert.equal(ui.summary.amountTotal,123);
})
test('failed inventory refresh hides old totals, and a retry restores real values',async()=>{
 let fail=true;const ui=frontendHarness(async()=>{if(fail)throw Error('timeout');return {code:0,data:{current:{physical:{total_t:9,filled_unsold_t:1,filled_unsold_count:10,available:true},quality:{unresolved_bottle_count:0}}}}});
 await ui.refresh();assert.equal(ui.summary.inventory.current.physical.total_t,null);assert.equal(ui.summary.inventory.current.physical.filled_unsold_count,null);assert.equal(ui.summary.inventory.current.ledger.tank_t,null);fail=false;await ui.refresh();assert.equal(ui.summary.inventory.current.physical.total_t,9);assert.equal(ui.summary.inventory.current.quality.load_error,undefined);
})
