const test=require('node:test'),assert=require('node:assert/strict')
const {fillingPrintTime,withFillingPrintTimes}=require('../uniCloud-alipay/cloudfunctions/crm-sale/fillingPrintTime')
const {createService}=require('../uniCloud-alipay/cloudfunctions/crm-sale/pdaSaleRecords')
const proof={filling_id:'f1',operation_id:'op1',source_version:1,bottle_no:'1',tare_weight:100,gross_weight:170,net_weight:70}
const sale={car_no:'A',out_items:[{bottle_no:'1',tare:100,gross:170,net:70}],back_items:[{bottle_no:'2',tare:100,gross:110,net:10}],mobile_filling_label_sources:[proof]}
function db(rows=[],doc=sale){let reads=0;return {command:{in:ids=>ids},collection(name){if(name==='crm_sale_records')return {doc:()=>({get:async()=>({data:[doc]})})};return {where(filter){assert.ok(filter._id.includes('f1'));return this},field(){return this},limit(){return this},async get(){reads++;return {data:rows}}}},reads:()=>reads}}
test('original business time is frozen/validated and never replaced by a current timestamp',()=>{
 assert.equal(fillingPrintTime({filling_time:'2026-10-29-09',date:'2026-10-31',updated_at:Date.now()}),'2026-10-29-09')
 assert.equal(fillingPrintTime({date:'2026-10-29'}),'2026-10-29')
 for(const value of ['2026-02-30-09','2026-10-31-25','',Date.now()])assert.equal(fillingPrintTime({filling_time:value}),'')
})
test('new sales use frozen filling time without any additional database read; return time remains unknown',async()=>{
 const stored={...sale,mobile_filling_label_sources:[{...proof,filling_time:'2026-10-29-09'}]},database=db()
 const result=await withFillingPrintTimes(stored,database)
 assert.equal(result.out_items[0].filling_time,'2026-10-29-09');assert.equal(result.back_items[0].filling_time,'');assert.equal(database.reads(),0)
 assert.equal(stored.out_items[0].filling_time,undefined)
})
test('legacy sales read only exact associated filling; unrelated or changed originals are not substituted',async()=>{
 const source={_id:'f1',operation_id:'op1',source_version:1,bottle_no:'1',filling_time:'2026-10-29-09',reweigh:{label:{...proof}}}
 const database=db([source]);assert.equal((await withFillingPrintTimes(sale,database)).out_items[0].filling_time,'2026-10-29-09');assert.equal(database.reads(),1)
 for(const patch of [{operation_id:'new-op'},{source_version:2},{bottle_no:'99'},{reweigh:{label:{...proof,net_weight:80}}}]){
  assert.equal((await withFillingPrintTimes(sale,db([{...source,...patch}]))).out_items[0].filling_time,'')
 }
 assert.equal((await withFillingPrintTimes({...sale,mobile_filling_label_sources:[]},db([source]))).out_items[0].filling_time,'')
})
test('time enrichment happens only after existing vehicle/hidden-customer authorization',async()=>{
 const database=db(),svc=createService({db:database,isAdmin:()=>false,hiddenIds:async()=>[],mentionsHidden:()=>false,amounts:()=>({amounts:{}})})
 assert.equal((await svc.get({mobile_sale_defaults:{vehicle_id:'other',vehicle_no:'B'}},{id:'s1'})).code,404)
 assert.equal(database.reads(),0)
})

test('minute precision uses matching original capture, never a later correction or another business day',()=>{
 const sampled=Date.parse('2026-10-29T09:18:57+08:00')
 const row={entry_source:'pda_reweigh',source_version:2,filling_time:'2026-10-29-09',reweigh:{original_ble_capture:{sampled_at:sampled,stable:true},capture:{sampled_at:Date.parse('2026-10-31T18:45:00+08:00'),stable:true},measured_at:Date.now()}}
 assert.equal(fillingPrintTime(row),'2026-10-29 09:18')
 assert.equal(fillingPrintTime({...row,filling_time:'2026-10-28-09'}),'2026-10-28-09')
 assert.equal(fillingPrintTime({...row,filling_time:'2026-10-29-08'}),'2026-10-29-08')
 assert.equal(fillingPrintTime({...row,filling_time:'2026-10-29 09:16:59'}),'2026-10-29 09:16')
 assert.equal(fillingPrintTime({...row,reweigh:{...row.reweigh,original_ble_capture:null}}),'2026-10-29-09')
 assert.equal(fillingPrintTime({...row,source_version:1,reweigh:{capture_method:'ble',capture:{sampled_at:sampled,stable:true}}}),'2026-10-29 09:18')
})
test('old sales resolve original source minutes; new frozen minute snapshots need no reads',async()=>{
 const source={_id:'f1',operation_id:'op1',source_version:1,entry_source:'pda_reweigh',bottle_no:'1',filling_time:'2026-10-29-09',reweigh:{label:{...proof},original_ble_capture:{sampled_at:Date.parse('2026-10-29T09:18:57+08:00'),stable:true}}}
 assert.equal((await withFillingPrintTimes(sale,db([source]))).out_items[0].filling_time,'2026-10-29 09:18')
 const stored={...sale,mobile_filling_label_sources:[{...proof,filling_time:'2026-10-29 09:18'}]},database=db()
 assert.equal((await withFillingPrintTimes(stored,database)).out_items[0].filling_time,'2026-10-29 09:18');assert.equal(database.reads(),0)
})
