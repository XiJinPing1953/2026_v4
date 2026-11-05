const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
const src = f => fs.readFileSync('src/services/pda/'+f+'.js','utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')
const {createCalibrationWindow} = vm.runInNewContext(src('floorScaleProtocol')+'\n'+src('floorCalibrationReading')+'\n;({createCalibrationWindow})')
const frame = (kg, seq, patch={}) => ({format:'milligrams',moduleId:0,status:0,weightHex:(BigInt(Math.round(kg*1e6))&0xffffffffffffffffn).toString(16).toUpperCase().padStart(16,'0'),adcHex:'FFFFFFF9',timestampHex:String(seq),...patch})
test('fresh distinct frames follow 185 to 165 without hold; repeated timestamps, bad frames and new sessions cannot certify a point',()=>{
 const w=createCalibrationWindow();let at=10000,n=0
 const add=(kg,patch={})=>{at+=100;w.observe(frame(kg,++n,patch),at,'A');return w.read(at,'A')}
 for(let i=0;i<20;i++) add(185)
 assert.equal(w.read(at,'A').stable,true)
 for(let i=1;i<=200;i++){const p=add(185-i/10);assert.equal(p.kg,185-i/10);if(i>=2) assert.equal(p.stable,false)}
 for(let i=0;i<19;i++)add(165)
 assert.equal(w.read(at,'A').stable,true);assert.equal(w.read(at,'A').ad,-7)
 for(let i=0;i<20;i++){at+=100;w.observe(frame(165,n),at,'A')}
 assert.equal(w.read(at,'A'),null);assert.equal(add(165).stable,false)
 assert.equal(add(165,{status:1}),null);assert.equal(add(165,{format:'legacy-grams'}),null)
 w.observe(frame(165,++n),at,'B');assert.equal(w.read(at,'A'),null);assert.equal(w.read(at,'B').stable,false)
})
test('maintenance excludes active and unreadable work, possibly stored in a legacy floor draft',()=>{
 const {floorCalibrationWorkIdle} = vm.runInNewContext(src('reweighDraft')+'\n'+src('reweighWorkStore')+'\n;({floorCalibrationWorkIdle})')
 const rows=new Map(),store={getStorageSync:key=>rows.get(key)}, key='crm_pda_floor_reweigh_v1:u'
 const head={ownerId:'u', version:1,current:{operationId:'o',bottleNo:''},metadata:{}}
 assert.equal(floorCalibrationWorkIdle('u',store),true)
 rows.set(key,JSON.stringify({...head,current:{...head.current,bottleNo:'123'}}));assert.equal(floorCalibrationWorkIdle('u',store),false)
 rows.set(key+':work-v3',JSON.stringify(head));assert.equal(floorCalibrationWorkIdle('u',store),true)
 rows.set(key+':work-v3',JSON.stringify({...head,metadata:{pendingEndRound:{}}}));assert.equal(floorCalibrationWorkIdle('u',store),false)
 rows.set(key+':work-v3','invalid');assert.throws(()=>floorCalibrationWorkIdle('u',store))
 rows.clear()
 const returnKey='crm_pda_floor_return_reweigh_v1:u:work-v3'
 rows.set(returnKey,JSON.stringify({...head,current:{...head.current,bottleNo:'123'}}));assert.equal(floorCalibrationWorkIdle('u',store),false)
 rows.set(returnKey,JSON.stringify(head));assert.equal(floorCalibrationWorkIdle('u',store),true)
 rows.set(returnKey,JSON.stringify({...head,metadata:{pendingEndRound:{}}}));assert.equal(floorCalibrationWorkIdle('u',store),false)
 rows.set(returnKey,JSON.stringify({...head,current:{...head.current,bottleNo:'123',frozen:{mode:'create',payload:{operation_id:'o',bottle_no:'123'}},receipt:{saved:true}}}));assert.equal(floorCalibrationWorkIdle('u',store),true)
 rows.set(returnKey,JSON.stringify({...head,current:{...head.current,bottleNo:'123',frozen:{mode:'create',payload:{operation_id:'o',bottle_no:'123'}},receipt:{saved:false}}}));assert.equal(floorCalibrationWorkIdle('u',store),false)
})
