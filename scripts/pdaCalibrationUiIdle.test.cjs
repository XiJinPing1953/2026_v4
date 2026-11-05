const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
function bench() {
 const code=fs.readFileSync('src/composables/pda/useFloorCalibrationBench.js','utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')
 let state={status:'idle',fresh:false,sessionKey:'',deviceId:''},controllerUpdates,diagnosticUpdates,now=10000,reads=0
 const timers=new Set(), ref=value=>({value})
 const diag={getSnapshot(){reads++;return state},subscribe(fn){diagnosticUpdates=fn;fn(state);return()=>{diagnosticUpdates=null}},disconnect:async()=>{}}
 const ctrl={getState:()=>({}),subscribe(fn){controllerUpdates=fn;fn({});return()=>{controllerUpdates=null}}}
 const ui=vm.runInNewContext(code+';useFloorCalibrationBench()',{
 ref,shallowRef:ref,computed:fn=>({get value(){return fn()}}),Date:class extends Date{static now(){return now}},
 setInterval:fn=>{timers.add(fn);return fn},clearInterval:fn=>timers.delete(fn),getUser:()=>({_id:'u'}),canPageAction:()=>true,
 createCalibrationWindow:()=>({read:()=>({kg:0,ad:8,stable:true}),clear(){}}),
 createFloorScaleNativeRuntime:()=>({}),createFloorScaleDiagnostic:()=>diag,createFloorScaleCalibrationController:()=>ctrl,
 uni:{getStorageSync(){}},floorScaleDivisionKg:v=>v
 })
 return {ui,reads:()=>reads,timers,change(s){state=s;diagnosticUpdates?.(s)},tick(n){for(let i=0;i<n;i++){now+=250;for(const fn of timers)fn()}},subscribed:()=>Boolean(controllerUpdates||diagnosticUpdates)}
}
test('unconnected bench has no UI polling; stable displayed data keeps its reference and stale weight disappears',async()=>{
 const b=bench();await b.ui.activate();const reads=b.reads();b.tick(40);assert.equal(b.reads(),reads);assert.equal(b.timers.size,0)
 const s={status:'connected',fresh:true,sessionKey:'1',deviceId:'a',canWriteCalibration:true};b.change(s);const initial=b.ui.point.value
 b.tick(4);assert.equal(b.ui.point.value,initial);assert.equal(b.timers.size,1)
 b.change({...s,fresh:false});b.tick(1);assert.equal(b.ui.point.value,null)
 b.change({...s,status:'disconnected',fresh:false});assert.equal(b.timers.size,0)
 await b.ui.deactivate();assert.equal(b.subscribed(),false);assert.equal(b.timers.size,0)
})
