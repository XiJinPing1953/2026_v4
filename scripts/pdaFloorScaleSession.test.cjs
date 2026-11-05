const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const protocol = fs.readFileSync('src/services/pda/floorScaleProtocol.js', 'utf8').replace(/export /g, '')
const session = fs.readFileSync('src/services/pda/floorScaleSession.js', 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
test('candidate readings remain display-only and are invalidated on disconnection', async () => {
	let push, state = { status: 'idle' }, interval
	const diagnostic = {
		subscribe(cb) { push = cb; cb(state); return () => {} },
		getSnapshot() { return state }, discover: async () => ({ code: 0, data: [] }),
		connect: async () => { state = { status: 'connected', deviceId: 'floor' }; push(state); return { code: 0 } },
		disconnect: async () => { state = { status: 'disconnected' }; push(state) }
	}
	const { createFloorScaleSession } = vm.runInNewContext(`${protocol}\n${session}\n;({createFloorScaleSession})`, {
		Date, Number, ArrayBuffer, Uint8Array, parseInt, Set,
		createFloorScaleDiagnostic: () => diagnostic,
		setInterval: fn => { interval = fn; return 1 }, clearInterval: () => {}
	})
	const s = createFloorScaleSession({}); await s.connect({ preferredDeviceId: 'floor' }); s.beginMeasurement()
	state = { status: 'connected', deviceId: 'floor', fresh: true, sampledAt: 1000,
		frame: { weightHex: '00000000000F4240', rawHex: 'AA', verifiedForCapture: false } }; push(state)
	assert.equal(s.getSnapshot().weight_kg, 1); assert.equal(s.getSnapshot().is_stable, false)
	assert.equal(s.getSnapshot().diagnostic_frame.verifiedForCapture, false)
	state = { status: 'connected', deviceId: 'floor', fresh: false }; interval()
	assert.equal(s.getSnapshot().weight_kg, null)
	await s.disconnect(); assert.equal(s.getSnapshot().is_connected, false)
})

test('boot readiness blocks business capture and tare while preserving explicit recovery messages',async()=>{
 let callbacks,push,state={status:'idle'},clock=10000;const emitted=[]
 const diagnostic={subscribe(fn){push=fn;fn(state);return()=>{}},getSnapshot:()=>state,
  connect:async()=>{state={status:'connected',deviceId:'A',sessionKey:'s'};push(state);return{code:0}},disconnect:async()=>{}}
 const display=fs.readFileSync('src/services/pda/floorScaleDisplay.js','utf8').replace(/export /g,'')
 const api=vm.runInNewContext(`${protocol}\n${display}\n${session}\n;({createFloorScaleSession,floorScaleDisplayWeight,floorDisplayTarePoint})`,{
  Date:{now:()=>clock},Number,ArrayBuffer,Uint8Array,parseInt,Set,
  createFloorScaleDiagnostic:(_,options)=>{callbacks=options;return diagnostic},setInterval:()=>1,clearInterval(){}})
 const s=api.createFloorScaleSession({}, {onWeightFrame:frame=>emitted.push(frame)});await s.connect();s.beginMeasurement()
 const feed=status=>{clock+=100;const frame={format:'milligrams',moduleId:0,status,weightHex:'00000000000F4240',timestampHex:String(clock),rawHex:'test'};state={...state,fresh:true,sampledAt:clock,frame};callbacks.onFrame(frame,clock,'A');push(state);return s.getSnapshot()}
 assert.equal(feed(0).qualified_frame,true);assert.equal(emitted.length,1)
 for(const [status,code] of [[0xe0,'boot_zero_pending'],[0xe2,'boot_zero_timeout'],[0xe3,'boot_calibration_invalid']]){
  const snap=feed(status);assert.equal(snap.error_code,code);assert.equal(snap.qualified_frame,false)
  assert.equal(api.floorScaleDisplayWeight(snap),'—');assert.equal(api.floorDisplayTarePoint(snap,clock),null)
 }
 assert.equal(emitted.length,1);assert.equal(feed(0).qualified_frame,true);assert.equal(emitted.length,2)
})
