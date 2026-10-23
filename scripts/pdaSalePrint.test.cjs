const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
function load(path,names,context={}){let code=fs.readFileSync(path,'utf8').replace(/^import .*$/gm,'').replace(/export /g,'');const c={...context};vm.createContext(c);vm.runInContext(code+'\nthis.api={'+names.join(',')+'}',c);return c.api}
const {salePrintPages,writeSalePage}=load('src/services/pda/salePrint.js',['salePrintPages','writeSalePage'])
const sale={_id:'s',biz_mode:'bottle',price_unit:'kg',unit_price:5,should_receive:50,total_net_weight:10,customer_name:'客户',out_items:[{bottle_no:'1',net:12}],back_items:[{bottle_no:'2',net:2}],deposit_rows:[{bottle_no:'1'}]}
test('landscape pages keep every bottle and formula without changing source',()=>{const doc={...sale,out_items:Array.from({length:40},(_,i)=>({bottle_no:`B${i}`,net:12})),should_receive:2390,total_net_weight:478};const before=JSON.stringify(doc),pages=salePrintPages(doc);assert.ok(pages.length>1);const all=pages.flatMap(p=>p.rows).join('');for(let i=0;i<40;i++)assert.ok(all.includes(`B${i}号`));assert.ok(all.includes('2390.00'));assert.equal(JSON.stringify(doc),before);assert.ok(pages.every(p=>p.rows.length<=10));assert.ok(pages.at(-1).rows.at(-1).includes('存瓶'))})
test('uses rotation on portrait stock and rejects inconsistent/missing weight',()=>{const calls=[];const plugin=new Proxy({},{get:(_,k)=>(...args)=>calls.push([k,...args])});writeSalePage(plugin,salePrintPages(sale)[0]);assert.ok(calls.some(c=>c[0]==='setSize'&&c[1]===50&&c[2]===80));assert.ok(calls.filter(c=>c[0]==='setTextRotation').every(c=>c[4]===90));assert.throws(()=>salePrintPages({...sale,total_net_weight:99}));assert.throws(()=>salePrintPages({...sale,out_items:[{bottle_no:'1',net:null}]}))})
const {createService}=require('../uniCloud-alipay/cloudfunctions/crm-sale/pdaSaleRecords')
test('PDA detail uses server vehicle binding and fails closed when missing',async()=>{let read=0;const db={collection:()=>({doc:()=>({get:async()=>({data:[{car_no:'A'}]})})})};const svc=createService({db,isAdmin:u=>u.admin,hiddenIds:async()=>[],mentionsHidden:()=>false,amounts:()=>{read++;return{amounts:{}}}});assert.equal((await svc.get({_id:'u'},{id:'s',vehicle_no:'A'})).code,403);assert.equal((await svc.get({mobile_sale_defaults:{vehicle_id:'b',vehicle_no:'B'}},{id:'s',vehicle_no:'A'})).code,404);assert.equal(read,0);assert.equal((await svc.get({mobile_sale_defaults:{vehicle_id:'a',vehicle_no:'A'}},{id:'s'})).code,0);assert.equal(read,1)})
function printerHarness(){let user={_id:'u'},active=true,callback,sends=0;const store=new Map();const session={connected:true,close(){},connect(){callback({connected:true,message:'ok'})},sendDocument:async()=>{sends++}};const api=load('src/composables/pda/usePdaSalePrinter.js',['usePdaSalePrinter'],{ref:v=>({value:v}),onBeforeUnmount(){},getUser:()=>user,ensurePdaBleRuntimePermission:async()=>({code:0}),getPairedPrinters:()=>[{address:'A'}],plus:{android:{}},uni:{getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),requireNativePlugin:()=>({})},createLabelPrinterSession:(_,cb)=>{callback=cb;return session},getPdaSale:async()=>({code:0,data:sale}),salePrintPages,writeSalePage,setInterval:()=>0,clearInterval(){}});const p=api.usePdaSalePrinter(()=>active);return{p,store,get sends(){return sends},setUser:v=>user=v,disable:()=>active=false}}
test('sales automatic print deduplicates and old records never auto print; explicit reprint allowed',async()=>{const h=printerHarness();await h.p.connect();const r={sourceSaved:true,saleId:'s',operationId:'op'};await h.p.confirmed(r);assert.equal(h.sends,0);h.p.arm('op');await Promise.all([h.p.confirmed(r),h.p.confirmed(r)]);assert.equal(h.sends,1);h.p.arm('op');await h.p.confirmed(r);assert.equal(h.sends,1);await h.p.print('s');assert.equal(h.sends,2);h.setUser({_id:'other'});await h.p.print('s');assert.equal(h.sends,2)})
test('disconnected save consumes automatic attempt and reconnect does not send',async()=>{const h=printerHarness();const r={sourceSaved:true,saleId:'s',operationId:'op'};h.p.arm('op');await h.p.confirmed(r);assert.equal(h.sends,0);await h.p.connect();await h.p.confirmed(r);assert.equal(h.sends,0);await h.p.print('s');assert.equal(h.sends,1)})
test('list binds account vehicle and ignores forged client vehicle filter',async()=>{let where;const chain={where:v=>(where=v,chain),orderBy:()=>chain,skip:()=>chain,limit:()=>chain,get:async()=>({data:[]})};const db={command:{and:v=>v,or:v=>v,nin:v=>v},collection:()=>chain};const svc=createService({db,isAdmin:()=>false,hiddenIds:async()=>[],amounts:()=>({amounts:{}})});assert.equal((await svc.list({mobile_sale_defaults:{vehicle_id:'a',vehicle_no:'A'}},{date:'2026-10-22',vehicle_no:'B'})).code,0);assert.ok(where.some(c=>c.car_no==='A'));assert.ok(!where.some(c=>c.car_no==='B'))})
test('local print ledger failure prevents automatic send without touching saved sale',async()=>{const h=printerHarness();await h.p.connect();h.p.arm('op');h.store.set=()=>{throw Error('storage full')};await h.p.confirmed({sourceSaved:true,saleId:'s',operationId:'op'});assert.equal(h.sends,0);assert.match(h.p.status.value,/storage full/);await h.p.print('s');assert.equal(h.sends,1)})
test('detail returns only the same authorized snapshot with no re-read or reconciliation writes', async () => {
 let reads=0,writes=0
 const initial={...sale,car_no:'A',mobile_create_state:'processing',customer_id:'visible'}
 const changed={...sale,car_no:'B',customer_name:'other vehicle private data'}
 const db={collection:()=>({doc:()=>({get:async()=>({data:[++reads===1?initial:changed]}),update:async()=>{writes++}})})}
 const svc=createService({db,isAdmin:()=>false,hiddenIds:async()=>[],mentionsHidden:()=>false,amounts:doc=>({amounts:{should_receive:doc.should_receive}}),getSale:()=>{throw Error('must not invoke mutating getV2')}})
 const result=await svc.get({mobile_sale_defaults:{vehicle_id:'a',vehicle_no:'A'}},{id:'s'})
 assert.equal(result.code,0);assert.equal(result.data.car_no,'A');assert.equal(result.data.customer_name,initial.customer_name)
 assert.equal(reads,1);assert.equal(writes,0);assert.equal(result.data.mobile_create_state,'processing')
})
test('detail preserves hidden customer restriction before projection', async () => {
 const doc={...sale,car_no:'A',customer_id:'hidden'}
 let calculated=false
 const svc=createService({db:{collection:()=>({doc:()=>({get:async()=>({data:[doc]})})})},isAdmin:()=>true,hiddenIds:async()=>['hidden'],mentionsHidden:(row,ids)=>ids.includes(row.customer_id),amounts:()=>{calculated=true;return{amounts:{}}}})
 assert.equal((await svc.get({}, {id:'s'})).code,404);assert.equal(calculated,false)
})
test('line wrapping preserves bottle number and decimal weight tokens',()=>{
 const doc={...sale,customer_name:'客'.repeat(22)+'123456',out_items:[{bottle_no:'123456789',net:12.5}],back_items:[{bottle_no:'2',net:2.5}]}
 const lines=salePrintPages(doc).flatMap(p=>p.rows)
 assert.ok(lines.some(s=>s.includes('123456789号')));assert.ok(lines.some(s=>s.includes('12.5')));assert.ok(lines.some(s=>s.includes('123456')))
})

test('legacy PDA runtime without Array.at can paginate deposits and send all pages',()=>{
 const c={};vm.createContext(c);vm.runInContext('Array.prototype.at = undefined',c)
 const code=fs.readFileSync('src/services/pda/salePrint.js','utf8').replace(/export /g,'')
 vm.runInContext(code+'\nthis.api={salePrintPages,writeSalePage}',c)
 const doc={...sale,deposit_rows:Array.from({length:100},(_,i)=>({bottle_no:'BOTTLE'+i}))}
 const before=JSON.stringify(doc),pages=c.api.salePrintPages(doc),calls=[]
 const plugin=new Proxy({},{get:(_,key)=>(...args)=>calls.push([key,...args])})
 for(const page of pages)c.api.writeSalePage(plugin,page)
 assert.ok(pages.length>1);assert.ok(pages.every(p=>p.rows.length<=10))
 assert.ok(pages.map(p=>p.rows.join('')).join('').includes('BOTTLE99'))
 assert.equal(calls.filter(c=>c[0]==='startPrint').length,pages.length)
 assert.equal(JSON.stringify(doc),before)
})
