'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module')
const {makeDb,loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
function fixture(){return {crm_users:[{_id:'u',token:'test',role:'superadmin'}],crm_customers:[{_id:'c',name:'Test'}],crm_bottle_movements:Array.from({length:501},(_,i)=>({_id:'e'+String(i).padStart(5,'0'),bottle_no:'1',type:'out',source_type:'sale',customer_id:'c',event_day:'2026-09-05',created_at:i+1,event_at:i+1,net_weight:10})),crm_bottle_anomalies:[{_id:'a',bottle_no:'1',anomaly_type:'missing_fill',status:'resolved',date:'2026-09-05',context:{next_out:{customer_id:'c',date:'2026-09-05'},resolution:{mode:'loss_accept',loss_kg:2.75}}}],crm_customer_loss_daily:[{_id:'stale',customer_id:'c',day:'2026-09-04',loss_total_weight:999}]}}
function database(tables,hooks={}){const db=makeDb(tables,hooks),and=db.command.and;db.command.and=(...args)=>args.length>1?Object.assign({},...args):and(args[0]);return db}
const args={customer_id:'c',dateStart:'2026-09-01',dateEnd:'2026-09-19'}
test('read-only loss summary matches the persisted calculation without reading or writing daily cache',async()=>{
 const tables=fixture(),names=[],db=database(tables,{get:(name,rows)=>{names.push(name);return {data:structuredClone(rows)}}})
 const result=await invoke(loadHandler('crm-bottle-movement',db),'customerLossSummaryV1',args)
 assert.equal(result.code,0,result.msg);assert.equal(result.data.loss_total_kg,2.75);assert.equal(result.data.manual_loss_count,1);assert.equal(db.writes.length,0);assert.ok(!names.includes('crm_customer_loss_daily'));assert.equal(result.financial_evidence.read_complete,true)
 const file=path.resolve('uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js'),oldDb=database(fixture(),{mutate:true});const source=fs.readFileSync(file,'utf8').replace('requestId, readOnly: true','requestId, readOnly: false').replace('const summaryRows = rebuildResult.rows','const summaryRows = await fetchCustomerLossDailySummaryRows(customerId, rebuildResult.dateStart, rebuildResult.dateEnd)');const ctx={exports:{},require:createRequire(file),uniCloud:{database:()=>oldDb},console,Date,Math,Map,Set,Buffer,process};vm.runInNewContext(source,ctx,{filename:file});const before=await invoke(ctx.exports.main,'customerLossSummaryV1',args);assert.equal(before.code,0,before.msg);assert.deepEqual(JSON.parse(JSON.stringify(result.data)),JSON.parse(JSON.stringify(before.data)));assert.ok(oldDb.writes.length>0)
})
test('loss summary fails explicitly when complete source counts cannot be established',async()=>{
 const db=database(fixture(),{count:(name,total)=>name==='crm_bottle_movements'?{}:{total}});const r=await invoke(loadHandler('crm-bottle-movement',db),'customerLossSummaryV1',args);assert.equal(r.code,409);assert.equal(r.error_code,'FINANCIAL_READ_INCOMPLETE');assert.equal(db.writes.length,0)
})
