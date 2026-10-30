const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const read=path=>fs.readFileSync(path,'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')
function load(paths,names,globals={}){return vm.runInNewContext(paths.map(read).join('\n')+'\n;({'+names.join(',')+'})',globals)}
const {getPairedPrinters,selectPairedPrinter,rememberPrinter}=load(['src/services/pda/labelPrinter.js','src/services/pda/printerSelection.js'],['getPairedPrinters','selectPairedPrinter','rememberPrinter'])
const devices=[{name:'HL30-AA21',address:'00:11:22:33:AA:21'},{name:'HL30-AA20',address:'00:11:22:33:AA:20'},{name:'NVK吊秤',address:'00:11:22:33:BB:20'}]
function androidFor(rows,enabled=true){let i=0;const adapter={},bonded={},iterator={};return{
 importClass(name){assert.equal(name,'android.bluetooth.BluetoothAdapter');return{getDefaultAdapter:()=>adapter}},
 invoke(target,method){if(method==='isEnabled')return enabled;if(method==='getBondedDevices')return bonded;if(method==='iterator'){i=0;return iterator}if(method==='hasNext')return i<rows.length;if(method==='next')return rows[i++];if(method==='getName')return target.name;if(method==='getAddress')return target.address;assert.fail(method)}
}}
function uiFor(last=devices[0]){const store=new Map(last?[['pda_label_printer_bound_v1',last]]:[]),menus=[];return{store,menus,getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),showActionSheet:o=>menus.push(o)}}

test('paired device enumeration has no name whitelist, deduplicates addresses and never scans or connects',()=>{
 const rows=[...devices,{name:'其他品牌打印机',address:'00:11:22:33:cc:00'},{name:'',address:'00:11:22:33:DD:00'},devices[1],{name:'invalid',address:'bad'}]
 const got=getPairedPrinters(androidFor(rows));assert.equal(got.length,5);assert.equal(got[3].address,'00:11:22:33:CC:00');assert.equal(got[4].name,'未命名设备')
 assert.throws(()=>getPairedPrinters(androidFor(rows,false)),/打开系统蓝牙/)
})
test('remembered printer is only prioritized; AA20 can replace an old paired AA21 without auto-connecting',async()=>{
 const ui=uiFor(devices[0]),pending=selectPairedPrinter({android:androidFor(devices),ui})
 assert.equal(ui.menus.length,1);assert.match(ui.menus[0].itemList[0],/上次.*HL30-AA21/);assert.match(ui.menus[0].itemList[1],/HL30-AA20.*00:11:22:33:AA:20/)
 ui.menus[0].success({tapIndex:1});const selected=await pending;assert.equal(selected.address,devices[1].address)
 assert.equal(ui.store.get('pda_label_printer_bound_v1'),devices[0]);rememberPrinter(ui,selected);assert.equal(ui.store.get('pda_label_printer_bound_v1').address,devices[1].address)
})
test('renamed, unremembered or sole devices still require an explicit selection; all devices remain listed',async()=>{
 for(const rows of [[devices[2]],[{...devices[0],name:'新名称'}],Array.from({length:12},(_,i)=>({name:'打印机',address:`00:11:22:33:CC:${String(i).padStart(2,'0')}`}))]){
  const ui=uiFor(),pending=selectPairedPrinter({android:androidFor(rows),ui});assert.equal(ui.menus[0].itemList.length,rows.length)
  ui.menus[0].success({tapIndex:rows.length-1});assert.equal((await pending).address,rows[rows.length-1].address)
 }
})
test('cancel, page exit and invalid selection do not change the remembered printer',async()=>{
 for(const mode of ['cancel','exit','bad-index']){
  let active=true;const ui=uiFor(),pending=selectPairedPrinter({android:androidFor(devices),ui,valid:()=>active})
  if(mode==='cancel')ui.menus[0].fail({errMsg:'cancel'});else {if(mode==='exit')active=false;ui.menus[0].success({tapIndex:mode==='bad-index'?99:1})}
  assert.equal(await pending,null);assert.equal(ui.store.get('pda_label_printer_bound_v1'),devices[0])
 }
 await assert.rejects(selectPairedPrinter({android:androidFor([]),ui:uiFor()}),/系统蓝牙中配对打印机/)
})

function entryHarness(kind){
 const ui=uiFor(),connections=[],sessions=[];let callback,owner={_id:'u'},active=true
 ui.requireNativePlugin=()=>({})
 const session={close(){},connect:address=>connections.push(address),print:async()=>callback({connected:true,message:'已发送一张，请查看出纸并扫码核对；未出纸也不会自动重打'})}
 const context={computed:fn=>({get value(){return fn()}}),ref:value=>({value}),onBeforeUnmount(){},defineExpose(){},getUser:()=>owner,plus:{android:androidFor(devices)},uni:ui,ensurePdaBleRuntimePermission:async()=>({code:0}),selectPairedPrinter,rememberPrinter,setInterval:()=>0,clearInterval(){},createLabelPrinterSession:(_,cb)=>{callback=cb;sessions.push(session);return session},createPrinterTestSession:(_,cb)=>{callback=cb;sessions.push(session);return session},createFillingPrintController:()=>({close(){}})}
 let entry
 if(kind==='test'){
  const source=fs.readFileSync('src/components/domain/pda/PdaPrinterTest.vue','utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'')
  entry=vm.runInNewContext(source+'\n;({connect,close,toggle,print,message})',context);entry.toggle()
 }else{
  const name=kind==='sale'?'usePdaSalePrinter':'usePdaFillingPrinter',api=load(['src/composables/pda/'+name+'.js'],[name],context)
  entry=kind==='sale'?api[name](()=>active):api[name]({enabled:true,active:()=>active,entries:()=>[]})
 }
 return{entry,ui,connections,sessions,state:s=>callback(s),changeOwner:()=>{owner={_id:'other'}},deactivate:()=>{active=false}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
for(const kind of ['sale','filling','test']){
 test(`${kind} connects only the chosen device and remembers only a successful connection`,async()=>{
  const h=entryHarness(kind),pending=h.entry.connect();await tick();assert.equal(h.sessions.length,0)
  h.ui.menus[0].success({tapIndex:1});await pending;assert.deepEqual(h.connections,[devices[1].address]);assert.equal(h.ui.store.get('pda_label_printer_bound_v1'),devices[0])
  h.state({connected:false,connecting:false,message:'连接失败'});assert.equal(h.ui.store.get('pda_label_printer_bound_v1'),devices[0])
  h.state({connected:true,message:'已连接'});assert.equal(h.ui.store.get('pda_label_printer_bound_v1').address,devices[1].address);h.entry.close()
 })
 test(`${kind} ignores a picker result after closing the page`,async()=>{
  const h=entryHarness(kind),pending=h.entry.connect();await tick();h.entry.close();h.ui.menus[0].success({tapIndex:1});await pending
  assert.equal(h.sessions.length,0);assert.equal(h.connections.length,0);assert.equal(h.ui.store.get('pda_label_printer_bound_v1'),devices[0])
 })
 test(`${kind} cancel is harmless and allows selecting again`,async()=>{
  const h=entryHarness(kind),pending=h.entry.connect();await tick();h.ui.menus[0].fail({errMsg:'cancel'});await pending;assert.equal(h.connections.length,0)
  const retry=h.entry.connect();await tick();assert.equal(h.ui.menus.length,2);h.ui.menus[1].success({tapIndex:1});await retry;assert.deepEqual(h.connections,[devices[1].address]);h.entry.close()
 })
}
test('account change while choosing a sale printer cannot start a connection',async()=>{
 const h=entryHarness('sale'),pending=h.entry.connect();await tick();h.changeOwner();h.ui.menus[0].success({tapIndex:1});await pending;assert.equal(h.connections.length,0)
})
test('printer test retains the sent-result message after selecting and connecting',async()=>{
 const h=entryHarness('test'),pending=h.entry.connect();await tick();h.ui.menus[0].success({tapIndex:1});await pending
 h.state({connected:true,message:'打印机已连接'});await h.entry.print();assert.match(h.entry.message.value,/已发送一张/);h.entry.close()
})
