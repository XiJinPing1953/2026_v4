const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
function setup() {
 const calls=[], updates=[]; let callback, timer
 const plugin = new Proxy({}, {get(target,key) { return target[key] ||= (...args) => {calls.push([key,...args]); if(key==='connState')callback=args[0]} }})
 const source=fs.readFileSync('src/services/pda/printerTest.js','utf8').replace(/^export /gm,'')
 const api=vm.runInNewContext(source+'\n;({createPrinterTestSession,getPairedTestPrinters,TEST_QR})',{setTimeout(fn){timer=fn;return 1},clearTimeout(){}})
 const session=api.createPrinterTestSession(plugin, value=>updates.push(value))
 return {calls,updates,plugin,session,api,state(value){callback(value)},timeout(){timer()}}
}
test('one click sends one 50x80 test label; duplicate cannot send',()=>{
 const h=setup(); h.session.connect('00:11:22:33:AA:21'); h.state(0); h.session.print()
 assert.throws(()=>h.session.print(),/已发送/)
 assert.equal(h.calls.filter(x=>x[0]==='startPrint').length,1)
 assert.deepEqual(h.calls.find(x=>x[0]==='setSize').slice(1),[50,80])
 assert.match(h.api.TEST_QR,/TEST001/);assert.doesNotMatch(h.api.TEST_QR,/回瓶|灌装量/)
 assert.match(h.updates.at(-1).message,/已发送一张/)
})
test('disconnect, timeout and closed late callback cannot enable printing',()=>{
 for(const kind of ['disconnect','timeout','close']) {
  const h=setup(); h.session.connect('00:11:22:33:AA:21')
  if(kind==='disconnect'){h.state(0);h.state(2)}
  if(kind==='timeout'){h.timeout();h.state(0)}
  if(kind==='close'){h.session.close();h.state(0)}
  assert.throws(()=>h.session.print(),/先连接/);assert.equal(h.calls.filter(x=>x[0]==='startPrint').length,0)
 }
})
test('ambiguous native send error remains locked and never auto retries',()=>{
 const h=setup();h.session.connect('00:11:22:33:AA:21');h.state(0)
 h.plugin.startPrint=()=>{throw new Error('native failure')}
 assert.throws(()=>h.session.print(),/native failure/);assert.throws(()=>h.session.print(),/已发送/)
})
test('paired selection excludes scale and BLE alias; no adapter close or discovery',()=>{
 const h=setup(), devices=[{name:'NVK',address:'00:11:22:33:44:55'},{name:'QR380A-AA21_Ble',address:'00:11:22:33:AA:22'},{name:'QR380A-AA21',address:'00:11:22:33:AA:21'}]
 let i=0
 const adapter={isEnabled:()=>true,getBondedDevices:()=>({iterator:()=>({hasNext:()=>i<devices.length,next:()=>{const d=devices[i++];return {getName:()=>d.name,getAddress:()=>d.address}}})})}
 const result=h.api.getPairedTestPrinters({importClass:()=>({getDefaultAdapter:()=>adapter}),invoke:(o,m)=>o[m]()})
 assert.equal(result.length,1);assert.equal(result[0].name,'QR380A-AA21')
 h.session.connect(result[0].address);h.session.close();h.session.close()
 assert.equal(h.calls.filter(x=>x[0]==='bluetoothDisConn').length,1)
 assert.ok(!h.calls.some(x=>/Discovery|Adapter|Search/.test(x[0])))
})
