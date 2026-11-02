const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const source = ['floorScaleDisplay', 'autoReturnWeight', 'floorScaleProtocol', 'floorScaleDiagnostic', 'floorScaleSession', 'floorScaleCalibration', 'floorScaleCalibrationController']
 .map(name => fs.readFileSync(`src/services/pda/${name}.js`, 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')).join('\n')
function setup(options = {}) {
 let time = Date.now(), tick, timers = 0
 class Clock extends Date { static now() { return time } }
 const api = vm.runInNewContext(`${source}\n;({createAutoReweighWeight,createFloorScaleDiagnostic,createFloorScaleSession,createFloorScaleCalibrationController,createFloorScaleFrameDecoder,floorScaleCandidateKg,FLOOR_SCALE_SERVICE_ID,FLOOR_SCALE_NOTIFY_ID,FLOOR_SCALE_WRITE_ID})`, {
  Date: Clock, Number, Math, ArrayBuffer, Uint8Array, Set, Map, WeakMap, parseInt, Promise, setTimeout, clearTimeout,
  setInterval: fn => { tick = fn; timers++; return timers }, clearInterval: () => { timers-- }
 })
 const runtime = {}, events = {}, writes = []
 for (const k of ['openBluetoothAdapter','createBLEConnection','closeBLEConnection','notifyBLECharacteristicValueChange']) runtime[k] = o => o.success({})
 runtime.getBLEDeviceServices = o => o.success({ services: [{ uuid: api.FLOOR_SCALE_SERVICE_ID }] })
 runtime.getBLEDeviceCharacteristics = o => o.success({ characteristics: [{ uuid: api.FLOOR_SCALE_NOTIFY_ID, properties: { notify: true } }, { uuid: api.FLOOR_SCALE_WRITE_ID, properties: { writeNoResponse: true } }] })
 runtime.onBLECharacteristicValueChange = fn => events.value = fn
 runtime.onBLEConnectionStateChange = fn => events.connection = fn
 runtime.writeBLECharacteristicValue = o => { writes.push([...new Uint8Array(o.value)]); o.success({}) }
 const notify = bytes => events.value({ deviceId: 'a', serviceId: api.FLOOR_SCALE_SERVICE_ID, characteristicId: api.FLOOR_SCALE_NOTIFY_ID, value: Uint8Array.from(bytes).buffer })
 return { ...api, runtime, events, writes, notify, advance(ms) { time += ms }, tick() { tick?.() }, timers: () => timers }
}
function frame(value = 1000000n, legacy = false) {
 const count = legacy ? 4 : 8, bytes = [0xaa,3,1,legacy ? 19 : 23,0,legacy ? 12 : 16,legacy ? 6 : 34,0,0,0,0,0]
 let n = BigInt.asUintN(count * 8, value), weight = Array(count)
 for (let i = count - 1; i >= 0; i--) { weight[i] = Number(n & 255n); n >>= 8n }
 bytes.push(...weight,1,0,42); bytes[4] = bytes.reduce((a,b) => a ^ b,0); return bytes
}
test('supplier legacy and current signed frames survive every fragmentation boundary', () => {
 const h = setup()
 for (const legacy of [false,true]) for (const value of [0n, -1000n, 1000n]) {
  const bytes = frame(value,legacy)
  for (let i = 1; i < bytes.length; i++) {
   const d = h.createFloorScaleFrameDecoder(); assert.equal(d.push(bytes.slice(0,i)).length,0)
   const f = d.push(bytes.slice(i))[0]; assert.ok(f, `legacy=${legacy}, split=${i}`)
   assert.equal(h.floorScaleCandidateKg(f),Number(value)/(legacy?1000:1000000)); assert.equal(f.verifiedForCapture,false)
  }
 }
})
test('first notification before native notify success is retained', async () => {
 const h = setup(); h.runtime.notifyBLECharacteristicValueChange = o => { h.notify(frame()); o.success({}) }
 const d = h.createFloorScaleDiagnostic(h.runtime); await d.connect('a')
 assert.ok(d.getSnapshot().fresh); await d.disconnect()
})
test('connected without bytes, invalid bytes, valid unreadable and stale are distinct', async () => {
 const h = setup(), s = h.createFloorScaleSession(h.runtime); await s.connect({preferredDeviceId:'a'})
 assert.equal(s.getSnapshot().error_code,'no_data')
 h.notify([1,2,3]); assert.equal(s.getSnapshot().error_code,'invalid_frame')
 const bad=frame(); bad[4]^=1; h.notify(bad)
 assert.ok(s.getSnapshot().communication.checksumErrors > 0)
 h.notify(frame(9223372036854775807n)); assert.equal(s.getSnapshot().is_online,true)
 assert.equal(s.getSnapshot().weight_kg,null); assert.equal(s.getSnapshot().error_code,'unreadable_weight')
 h.notify(frame()); h.advance(3001); assert.equal(s.getSnapshot().is_online,false); assert.equal(s.getSnapshot().error_code,'stale')
 await s.disconnect()
})
test('50Hz input updates view at most 4Hz, latest actions stay fresh; disconnect releases timer', async () => {
 const h=setup(), s=h.createFloorScaleSession(h.runtime); await s.connect({preferredDeviceId:'a'})
 let updates=0; s.onSnapshot(()=>updates++)
 for(let i=0;i<3000;i++) { h.advance(20); h.notify(frame(BigInt(i))); if(i%13===0) h.tick() }
 assert.equal(s.getSnapshot().weight_kg,0.002999)
 assert.ok(updates<=242, `view updates: ${updates}`)
 h.events.connection({deviceId:'a',connected:false}); assert.equal(h.timers(),0)
 await s.stop()
})
test('silent native callback times out and close cannot keep page stopping forever', { timeout: 300 }, async () => {
 const h=setup(); h.runtime.getBLEDeviceServices = () => {}; h.runtime.closeBLEConnection = () => {}
 const d=h.createFloorScaleDiagnostic(h.runtime,{callTimeoutMs:10,closeTimeoutMs:10})
 const result=await d.connect('a'); assert.equal(result.code,500); assert.match(result.msg,/超时/)
 assert.equal(d.getSnapshot().status,'disconnected'); await d.disconnect()
 h.runtime.getBLEDeviceServices=o=>o.success({services:[{uuid:h.FLOOR_SCALE_SERVICE_ID}]})
 assert.equal((await d.connect('a')).code,0); await d.disconnect()
})
test('negative fresh raw reading can zero, missing data cannot; write is not calibration success', async () => {
 const h=setup(), s=h.createFloorScaleSession(h.runtime), data=new Map()
 await s.connect({preferredDeviceId:'a'})
 const c=h.createFloorScaleCalibrationController({ownerId:'test',storage:{getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,v)},ownerMatches:()=>true,canStart:()=>true,connection:()=>s.getSnapshot(),send:(...args)=>s.writeCalibrationCommand(...args)})
 await assert.rejects(c.issueZero(),/尚未收到/); assert.equal(h.writes.length,0)
 h.notify(frame(-1000n)); assert.equal(s.getSnapshot().weight_kg,-0.001)
 assert.equal((await c.issueZero()).sent,true); assert.equal(h.writes.length,1)
 assert.ok(c.getState().pending); assert.throws(()=>c.resolvePending(true),/尚未收到|新读数/)
 h.notify(frame(0n)); c.resolvePending(true); assert.equal(c.getState().zeroFor,'a')
 assert.equal(c.getState().requiresReview,true); await s.stop()
})
test('late timed-out native connection is closed without closing a newer same-device session', async () => {
 const h=setup(), callbacks=[]; let closes=0
 h.runtime.createBLEConnection=o=>callbacks.push(o)
 h.runtime.closeBLEConnection=o=>{closes++;o.success({})}
 const d=h.createFloorScaleDiagnostic(h.runtime,{callTimeoutMs:10})
 assert.equal((await d.connect('a')).code,500)
 const before=closes; callbacks[0].success({}); await Promise.resolve(); assert.equal(closes,before+1)
 assert.equal((await d.connect('a')).code,500)
 h.runtime.createBLEConnection=o=>o.success({}); assert.equal((await d.connect('a')).code,0)
 const current=closes; callbacks[1].success({}); await Promise.resolve()
 assert.equal(closes,current); assert.equal(d.getSnapshot().status,'connected'); await d.disconnect()
})
test('garbage stream is bounded and decoder recovers without retaining a raw history', () => {
 const h=setup(), d=h.createFloorScaleFrameDecoder()
 assert.equal(d.push(new Uint8Array(1000000).fill(0xaa)).length,0)
 assert.ok(d.getStats().bufferedBytes<=23)
 const frames=d.push(frame()); assert.equal(frames.length,1); assert.equal(d.getStats().bufferedBytes,0)
})
test('wrong module cannot be calibrated; silent command write is never retried', async () => {
 const h=setup(),s=h.createFloorScaleSession(h.runtime),data=new Map(); await s.connect({preferredDeviceId:'a'})
 const c=h.createFloorScaleCalibrationController({ownerId:'test',storage:{getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,v)},ownerMatches:()=>true,canStart:()=>true,connection:()=>s.getSnapshot(),send:(...args)=>s.writeCalibrationCommand(...args),timeoutMs:10})
 const wrong=frame(); wrong[7]=1;wrong[4]^=1;h.notify(wrong)
 await assert.rejects(c.issueZero(),/单地秤/);assert.equal(h.writes.length,0)
 let delayed, sent=0;h.runtime.writeBLECharacteristicValue=o=>{sent++;delayed=o}
 h.notify(frame());assert.equal((await c.issueZero()).sent,false);assert.equal(sent,1)
 delayed.success({});await Promise.resolve();assert.equal(c.getState().pending.needsReconnect,true)
 await assert.rejects(c.issueZero(),/待核对/);assert.equal(sent,1);await s.stop()
})

test('floor TTL bytes require empty transition per bottle; interruptions break 3s stability', async () => {
 const h = setup(), accepted = [], gate = h.createAutoReweighWeight()
 const s = h.createFloorScaleSession(h.runtime, {
  onWeightFrame(f) { const w = gate.feed(f, 100, f.sampled_at); if (w !== null) accepted.push([f.session_id, w]) },
  onInterrupted: gate.interrupt
 })
 await s.connect({preferredDeviceId:'a'})
 let stamp = 0
 function samples(mg, count, opts = {}) {
  for (let i = 0; i < count; i++) {
   const b = frame(BigInt(mg), opts.legacy); b[7] = opts.module || 0; b[b.length-3] = opts.status || 0
   if (!opts.repeat) stamp++
   b[b.length-2]=stamp>>8; b[b.length-1]=stamp&255; b[4]=0; b[4]=b.reduce((a,v)=>a^v,0) ^ (opts.bad ? 1 : 0)
   h.advance(100); h.notify(b)
  }
 }
 const id = s.beginMeasurement()
 samples(120187000,35); samples(487000,10); samples(120187000,35); assert.deepEqual(accepted,[])
 samples(0,5); samples(120187000,28); samples(120187000,1,{bad:true}); samples(120187000,10)
 samples(120187000,35,{status:1}); samples(120187000,35,{module:2}); samples(120000,35,{legacy:true})
 samples(120187000,35,{repeat:true}); samples(1001000000,35); assert.deepEqual(accepted,[])
 samples(120187000,32); assert.deepEqual(accepted,[[id,120]])
 gate.reset(); const next = s.beginMeasurement(); samples(120187000,40); assert.equal(accepted.length,1)
 samples(0,5); samples(120187000,32); assert.deepEqual(accepted,[[id,120],[next,120]])
 await s.stop()
})
