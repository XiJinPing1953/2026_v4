const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const source = ['floorScaleProtocol', 'floorScaleNativeRuntime', 'floorScaleDiagnostic'].map(name => fs.readFileSync(`src/services/pda/${name}.js`, 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')).join('\n')
const api = vm.runInThisContext(`${source}\n;({createFloorScaleNativeRuntime,createFloorScaleDiagnostic,FLOOR_SCALE_SERVICE_ID,FLOOR_SCALE_NOTIFY_ID,FLOOR_SCALE_WRITE_ID})`)
function setup(implementation=api) {
 const calls = [], drivers = [], shared = []
 const runtime = Object.fromEntries(['openBluetoothAdapter','startBluetoothDevicesDiscovery','stopBluetoothDevicesDiscovery','getBluetoothDevices'].map(name => [name, o => {shared.push(name);o.success({devices:[]})}]))
 runtime.createBLEConnection = () => {throw Error('must not use shared GATT')}
 runtime.closeBluetoothAdapter = () => {throw Error('must not reset shared adapter')}
 const android = {
  importClass: () => ({apiVersion:()=>1}), runtimeMainActivity:()=>({}), implements:(_,methods)=>methods,
  newObject:(_,activity,listener)=>{const d={listener,address:'',active:false};drivers.push(d);return d},
  invoke(d,method,...args) {
   const id=args.at(-1); calls.push({d,method,args})
   if(method==='connect') {d.address=args[0];d.active=true;emit(d,{type:'result',id,ok:true,data:{notifyProperties:16,writeProperties:4}})}
   if(method==='subscribe'||method==='write') emit(d,{type:'result',id,ok:true})
   if(method==='close') {d.active=false;emit(d,{type:'disconnected',deviceId:d.address,status:0,reason:'closed'});emit(d,{type:'result',id,ok:true})}
  }
 }
 function emit(d,event) {d.listener.onEvent(JSON.stringify(event))}
 const bridge=implementation.createFloorScaleNativeRuntime(runtime,android)
 return {android,bridge,calls,drivers,shared,emit,runtime}
}
const request = (r, method, options={}) => new Promise((resolve,reject)=>r[method]({...options,success:resolve,fail:reject}))
test('floor connects and subscribes through owned native GATT, preserving shared discovery', async()=>{
 const h=setup(), d=api.createFloorScaleDiagnostic(h.bridge)
 assert.equal((await d.connect('aa')).code,0)
 assert.deepEqual(h.calls.map(c=>c.method),['connect','subscribe'])
 assert.deepEqual(h.shared,['openBluetoothAdapter'])
 h.emit(h.drivers[0],{type:'value',deviceId:'AA',hex:'AA030113000C060000000000000003E801002A'})
 assert.equal(d.getSnapshot().communication.chunks,1)
 await d.disconnect();assert.equal(h.drivers[0].active,false)
})
test('subscription waits for descriptor acknowledgement and retains an early notification',async()=>{
 const h=setup(), invoke=h.android.invoke;let pending
 h.android.invoke=(d,m,...args)=>{if(m==='subscribe')pending={d,id:args.at(-1)};else invoke(d,m,...args)}
 const d=api.createFloorScaleDiagnostic(h.bridge), connecting=d.connect('aa')
 for(let i=0;i<12&&!pending;i++)await Promise.resolve()
 assert.ok(pending);assert.equal(d.getSnapshot().status,'connecting')
 h.emit(pending.d,{type:'value',deviceId:'AA',hex:'AA030113000C060000000000000003E801002A'})
 assert.equal(d.getSnapshot().communication.chunks,1)
 h.emit(pending.d,{type:'result',id:pending.id,ok:true});assert.equal((await connecting).code,0)
 await d.disconnect()
})
for(const failedMethod of ['connect','subscribe']) {
 test(`native ${failedMethod} result followed by disconnection preserves the failure through cleanup`,async()=>{
  const h=setup(), invoke=h.android.invoke
  h.android.invoke=(driver,method,...args)=>{
   if(method!==failedMethod)return invoke(driver,method,...args)
   if(method==='connect')driver.address=args[0]
   driver.active=false
   // FloorScaleGatt.terminate emits the pending result before disconnected.
   h.emit(driver,{type:'result',id:args.at(-1),ok:false,message:`${method} failed, status=62`})
   h.emit(driver,{type:'disconnected',deviceId:driver.address,status:62,reason:'connection ended'})
  }
  const d=api.createFloorScaleDiagnostic(h.bridge),result=await d.connect('AA')
  assert.equal(result.code,500);assert.equal(result.msg,`地秤蓝牙操作失败：${failedMethod} failed, status=62`)
  assert.equal(d.getSnapshot().reason,result.msg);assert.equal(d.getSnapshot().fresh,false)
  h.android.invoke=invoke
  assert.equal((await d.connect('AA')).code,0);await d.disconnect()
 })
}
test('bridge cancellation clears old request watchdogs before a later connection',async()=>{
 const h=setup(), invoke=h.android.invoke;let abandoned
 h.android.invoke=(d,m,...args)=>{if(m==='connect'&&!abandoned)abandoned={d,id:args.at(-1)};else invoke(d,m,...args)}
 const pending=request(h.bridge,'createBLEConnection',{deviceId:'AA'}).catch(error=>error)
 await request(h.bridge,'closeBLEConnection',{deviceId:'AA'});assert.match((await pending).errMsg,/已结束/)
 await request(h.bridge,'createBLEConnection',{deviceId:'AA'})
 h.emit(abandoned.d,{type:'result',id:abandoned.id,ok:true,data:{notifyProperties:0}})
 const chars=await request(h.bridge,'getBLEDeviceCharacteristics',{deviceId:'AA'})
 assert.equal(chars.characteristics[0].properties.notify,true)
 await request(h.bridge,'closeBLEConnection',{deviceId:'AA'})
})
test('old page close owns a different native instance and cannot close the new page',async()=>{
 const h=setup(), next=api.createFloorScaleNativeRuntime(h.runtime,h.android)
 await request(h.bridge,'createBLEConnection',{deviceId:'AA'})
 await request(h.bridge,'closeBLEConnection',{deviceId:'AA'})
 await request(next,'createBLEConnection',{deviceId:'AA'})
 await request(h.bridge,'closeBLEConnection',{deviceId:'AA'})
 assert.equal(h.drivers[1].active,true)
 await request(next,'closeBLEConnection',{deviceId:'AA'})
})
test('write failure is reported once and never retried',async()=>{
 const h=setup(), invoke=h.android.invoke;let writes=0
 h.android.invoke=(d,m,...args)=>{if(m==='write'){writes++;h.emit(d,{type:'result',id:args.at(-1),ok:false,message:'write failed'})}else invoke(d,m,...args)}
 await request(h.bridge,'createBLEConnection',{deviceId:'AA'})
 await assert.rejects(request(h.bridge,'writeBLECharacteristicValue',{deviceId:'AA',characteristicId:api.FLOOR_SCALE_WRITE_ID,value:new Uint8Array([0xaa,1,3,8,0xa6,1,7,0]).buffer}), e=>/write failed/.test(e.errMsg))
 assert.equal(writes,1);await request(h.bridge,'closeBLEConnection',{deviceId:'AA'})
})
test('old APK fails explicitly without falling back to leaking shared GATT',async()=>{
 const runtime={createBLEConnection(){throw Error('unexpected fallback')}}
 const bridge=api.createFloorScaleNativeRuntime(runtime,null)
 await assert.rejects(request(bridge,'createBLEConnection',{deviceId:'AA'}),e=>/新 APK/.test(e.errMsg))
 await request(bridge,'closeBLEConnection',{deviceId:'AA'})
})
test('lost close acknowledgement watchdog cannot close a later connection',async()=>{
 const timers=new Map();let seq=0
 const isolated=vm.runInNewContext(`${source}\n;({createFloorScaleNativeRuntime})`,{setTimeout(fn){const id=++seq;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},Uint8Array,ArrayBuffer})
 const h=setup(isolated), invoke=h.android.invoke;let oldTimer
 h.android.invoke=(d,m,...args)=>{if(m==='close'&&!oldTimer){oldTimer=[...timers.values()].at(-1);d.active=false}else invoke(d,m,...args)}
 await request(h.bridge,'createBLEConnection',{deviceId:'AA'})
 const close=request(h.bridge,'closeBLEConnection',{deviceId:'AA'}).catch(e=>e)
 await request(h.bridge,'createBLEConnection',{deviceId:'AA'});assert.equal(h.drivers[0].active,true)
 oldTimer();assert.equal(h.drivers[0].active,true);await close
 assert.deepEqual(h.calls.map(c=>c.method),['connect','connect'])
 await request(h.bridge,'closeBLEConnection',{deviceId:'AA'})
})
test('valid weight queued for four seconds remains stale and cannot calibrate',async()=>{
 const h=setup(), d=api.createFloorScaleDiagnostic(h.bridge,{now:()=>10000})
 await d.connect('AA')
 const bytes=[0xaa,3,1,19,0,12,6,0,0,0,0,0,0,0,3,232,1,0,42];bytes[4]=bytes.reduce((a,b)=>a^b,0)
 const hex=bytes.map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase()
 h.emit(h.drivers[0],{type:'value',deviceId:'AA',hex,receivedAt:6000})
 assert.equal(d.getSnapshot().fresh,false);assert.equal(d.getSnapshot().frame,null)
 h.emit(h.drivers[0],{type:'value',deviceId:'AA',hex,receivedAt:9900})
 assert.equal(d.getSnapshot().fresh,true);assert.equal(d.getSnapshot().sampledAt,9900)
 await d.disconnect()
})
