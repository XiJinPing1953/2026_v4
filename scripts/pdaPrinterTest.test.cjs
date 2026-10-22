const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
function modules(globals={}) {
 const source=fs.readFileSync('src/services/pda/labelPrinter.js','utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync('src/services/pda/fillingPrint.js','utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')
 return vm.runInNewContext(source+'\n;({TEST_LABEL,labelLayout,createLabelPrinterSession,getPairedPrinters,createFillingPrintController,savedLabel,isSuperseded,verifyCurrentLabel})',{setTimeout,clearTimeout,Date,...globals})
}
const entry=(id='op1')=>({operationId:id,bottleNo:'0015',preview:{context_hash:'v',label:{company:'新拓能源',bottle_no:'0015',tare_weight:110,gross_weight:185.5,net_weight:75.5}},frozen:{mode:'create',payload:{operation_id:id,bottle_no:'0015',gross_weight:185.5,context_hash:'v'}},receipt:{saved:true,fillingId:'fill1'}})
function harness(options={}) {
 const m=modules(),data=options.data||new Map(),calls=[],messages=[];let owner='u1',active=true,rows=[entry()]
 const printer={connected:options.connected!==false,print:async label=>{calls.push(label);if(options.failure)throw Error('send unknown')}}
 const control=m.createFillingPrintController({ownerId:'u1',currentOwner:()=>owner,valid:()=>active,entries:()=>rows,printer:()=>printer,verify:options.verify || (async()=>true),report:(id,text)=>messages.push([id,text]),storage:{getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>{if(options.storageFailure)throw Error('storage unavailable');data.set(k,v)}}})
 return {m,data,calls,messages,printer,control,e:rows[0],setOwner:x=>owner=x,setRows:x=>rows=x,setActive:x=>active=x}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function arm(h){h.control.arm({...h.e,receipt:null})}
test('confirmed matching save prints once; unknown/mismatched receipt does not',async()=>{
 const h=harness();arm(h);h.control.confirmed(h.e,false);assert.equal(h.calls.length,0)
 h.control.confirmed({...h.e,receipt:null},true);h.control.confirmed(h.e,true);h.control.confirmed(h.e,true);await tick();assert.equal(h.calls.length,1)
 assert.equal(h.calls[0].bottle_no,'0015');assert.match(h.messages.at(-1)[1],/已发送/)
 const resumed=harness({data:h.data});arm(resumed);resumed.control.confirmed(resumed.e,true);await tick();assert.equal(resumed.calls.length,0)
})
test('no historical/reentry auto print; disconnect never queues a reconnect resend',async()=>{
 const h=harness({connected:false});h.control.confirmed(h.e,true);assert.equal(h.calls.length,0)
 arm(h);h.control.confirmed(h.e,true);await tick();h.printer.connected=true;h.control.confirmed(h.e,true);await tick();assert.equal(h.calls.length,0)
 await h.control.reprint(h.e);assert.equal(h.calls.length,1)
 h.control.close();h.control.confirmed(h.e,true);assert.equal(h.calls.length,1)
})
test('unknown send and storage failure do not retry; saved record untouched',async()=>{
 for(const options of [{failure:true},{storageFailure:true}]){const h=harness(options),before=JSON.stringify(h.e);arm(h);h.control.confirmed(h.e,true);await tick();h.control.confirmed(h.e,true);assert.equal(h.calls.length,options.failure?1:0);assert.equal(JSON.stringify(h.e),before)}
})
test('account change and closed eligibility block late callbacks',async()=>{
 const h=harness();arm(h);h.setOwner('u2');h.control.confirmed(h.e,true);await h.control.reprint(h.e);assert.equal(h.calls.length,0)
 h.setOwner('u1');h.control.close();h.control.confirmed(h.e,true);assert.equal(h.calls.length,0)
})
test('reprint double taps are serialized and old corrected entry cannot print',async()=>{
 const h=harness();let finish;h.printer.print=()=>new Promise(resolve=>{h.calls.push('send');finish=resolve})
 const pending=h.control.reprint(h.e);await tick();await h.control.reprint(h.e);assert.equal(h.calls.length,1);assert.equal(h.control.busy,true);finish();await pending
 const correction=entry('op2');correction.frozen.mode='correct';correction.frozen.payload.filling_id='fill1';h.setRows([h.e,correction]);await h.control.reprint(h.e);assert.equal(h.calls.length,1);assert.match(h.messages.at(-1)[1],/已更正/)
})
test('missing or mutable label never falls back to current bottle master',()=>{
 const m=modules(),e=entry();assert.equal(m.savedLabel(e).tare_weight,110)
 e.preview.context_hash='changed';assert.throws(()=>m.savedLabel(e));delete e.preview.label;assert.throws(()=>m.savedLabel(e))
})
test('layout contains only five fields, centered title and bounded long bottle lines',()=>{
 const m=modules();for(const bottle of ['0015','X046','A'.repeat(48)]){const l=m.labelLayout({...m.TEST_LABEL,bottle_no:bottle});assert.ok(l.lines.every(x=>x.x>=32 && x.y+24<l.qrY-20));assert.ok(l.qrY+(400-2*l.qrX)+20<=640);assert.doesNotMatch(l.qr,/回瓶|灌装量/);assert.match(l.qr,/皮重：110.0 kg/)}
 assert.throws(()=>m.labelLayout({...m.TEST_LABEL,bottle_no:'bad"\nPRINT'}))
})
test('native ownership is exclusive, closed late callbacks cannot reconnect or touch scale',async()=>{
 const timers=[],m=modules({setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(){}}),calls=[];let cb
 const p=new Proxy({}, {get:(o,k)=>o[k]||((...args)=>{calls.push([k,...args]);if(k==='connState')cb=args[0]})})
 const s=m.createLabelPrinterSession(p);assert.throws(()=>m.createLabelPrinterSession(p),/其他页面/);s.connect('00:11:22:33:AA:21');cb(null);assert.equal(s.connected,false);cb('0');assert.equal(s.connected,true)
 const send=s.print(m.TEST_LABEL);timers.at(-1)();await send;assert.equal(calls.filter(x=>x[0]==='startPrint').length,1)
 s.close();cb(0);await assert.rejects(s.print(m.TEST_LABEL));assert.ok(!calls.some(x=>/Adapter|Discovery|Search/.test(x[0])))
 m.createLabelPrinterSession(p).close()
})

test('authoritative correction, deletion or unavailable read prevents stale reprint',async()=>{
 const m=modules(),e=entry(),row={_id:'fill1',bottle_no:'0015',entry_source:'pda_reweigh',operation_id:'op1',reweigh:{label:e.preview.label}}
 assert.equal(m.verifyCurrentLabel(e,{code:0,data:row}),true)
 for(const response of [{code:404},{code:0,data:{...row,operation_id:'other'}},{code:0,data:{...row,reweigh:{label:{...e.preview.label,gross_weight:186,net_weight:76}}}}])assert.throws(()=>m.verifyCurrentLabel(e,response))
 const h=harness({verify:async()=>{throw Error('remote changed')}});await h.control.reprint(h.e);assert.equal(h.calls.length,0)
})
test('late read after page exit or account switch never sends',async()=>{
 let finish;const h=harness({verify:()=>new Promise(resolve=>finish=resolve)});const pending=h.control.reprint(h.e);h.control.close();finish();await pending;assert.equal(h.calls.length,0)
})
