const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
function load(path,names,context={}){let code=fs.readFileSync(path,'utf8').replace(/^import .*$/gm,'').replace(/export /g,'');const c={...context};vm.createContext(c);vm.runInContext(code+'\nthis.api={'+names.join(',')+'}',c);return c.api}
const {buildDepositPreviewRows}=load('src/services/pda/shared.js',['buildDepositPreviewRows'])
const {receiptPrinterHarness}=require('./lib/receiptPrinterHarness.cjs')
const {writeReceiptText}=load('src/services/pda/receiptPrinter.js',['writeReceiptText'])
const {salePrintPages,writeSalePage}=load('src/services/pda/salePrint.js',['salePrintPages','writeSalePage'],{buildDepositPreviewRows,writeReceiptText})
const sale={_id:'s',biz_mode:'bottle',price_unit:'kg',unit_price:5,should_receive:50,total_net_weight:10,customer_name:'客户',out_items:[{bottle_no:'1',net:12}],back_items:[{bottle_no:'2',net:2}],deposit_rows:[{bottle_no:'1'}]}
test('long continuous receipts keep every bottle, repeat table headers, and preserve the source',()=>{
 const doc={...sale,out_items:Array.from({length:80},(_,i)=>({bottle_no:`B${i}`,net:12})),should_receive:4790,total_net_weight:958}
 const before=JSON.stringify(doc),pages=salePrintPages(doc),all=pages.flatMap(p=>p.rows).join('')
 assert.ok(pages.length>1)
 for(let i=0;i<80;i++)assert.ok(all.includes(`B${i}`))
 assert.ok(all.includes('4790.00'));assert.ok(all.includes('存瓶(81瓶):'));assert.equal(JSON.stringify(doc),before)
 for(const page of pages.filter(p=>p.commands.some(r=>/^B\d+$/.test(r.text)))){
  assert.ok(page.rows.includes('瓶号'));assert.ok(page.rows.some(r=>r.startsWith('出瓶 80瓶')))
 }
 assertBounds(pages)
})
test('sales use ESC/POS receipt commands, bounded tail feed and preserve original validation',()=>{
 const h=receiptPrinterHarness(),page=salePrintPages(sale)[0]
 writeSalePage(h.android,page,h.address)
 assert.equal(h.sends.length,1)
 assert.deepEqual(h.sends[0].slice(0,8),[27,64,28,38,29,80,203,203])
 assert.ok(h.operations.some(c=>c[0]==='addSetPrintingAreaWidth'&&c[1]===576))
 assert.ok(h.operations.some(c=>c[0]==='addText'&&c[1]==='新拓能源 销售单'))
 const feeds=h.operations.filter(c=>c[0]==='addPrintAndFeedPaper').map(c=>c[1])
 assert.equal(feeds.at(-1),56)
 assert.equal(feeds.reduce((a,b)=>a+b,0),Math.max(...page.commands.map(c=>c.y))+24+32)
 assert.ok(feeds.every(n=>n>0&&n<=127))
 assert.doesNotMatch(Buffer.from(h.sends[0]).toString('ascii'),/SIZE |GAP |CLS|TEXT |PRINT |FORMFEED|HOME/)
 assert.throws(()=>salePrintPages({...sale,total_net_weight:99}));assert.throws(()=>salePrintPages({...sale,out_items:[{bottle_no:'1',net:null}]}))
})
const {createService}=require('../uniCloud-alipay/cloudfunctions/crm-sale/pdaSaleRecords')
test('PDA detail uses server vehicle binding and fails closed when missing',async()=>{let read=0;const db={collection:()=>({doc:()=>({get:async()=>({data:[{car_no:'A'}]})})})};const svc=createService({db,isAdmin:u=>u.admin,hiddenIds:async()=>[],mentionsHidden:()=>false,amounts:()=>{read++;return{amounts:{}}}});assert.equal((await svc.get({_id:'u'},{id:'s',vehicle_no:'A'})).code,403);assert.equal((await svc.get({mobile_sale_defaults:{vehicle_id:'b',vehicle_no:'B'}},{id:'s',vehicle_no:'A'})).code,404);assert.equal(read,0);assert.equal((await svc.get({mobile_sale_defaults:{vehicle_id:'a',vehicle_no:'A'}},{id:'s'})).code,0);assert.equal(read,1)})
function printerHarness(){let user={_id:'u'},active=true,callback,sends=0;const native=receiptPrinterHarness(),store=new Map();const session={connected:true,close(){},connect(){callback({connected:true,message:'ok'})},sendDocument:async writer=>{writer({});sends++}};const api=load('src/composables/pda/usePdaSalePrinter.js',['usePdaSalePrinter'],{ref:v=>({value:v}),onBeforeUnmount(){},getUser:()=>user,ensurePdaBleRuntimePermission:async()=>({code:0}),getPairedPrinters:()=>[{address:native.address}],plus:{android:native.android},uni:{getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),requireNativePlugin:()=>({})},createLabelPrinterSession:(_,cb)=>{callback=cb;return session},getPdaSale:async()=>({code:0,data:sale}),salePrintPages,writeSalePage,setInterval:()=>0,clearInterval(){}});const p=api.usePdaSalePrinter(()=>active);return{p,store,get sends(){return sends},setUser:v=>user=v,disable:()=>active=false}}
test('sales automatic print deduplicates and old records never auto print; explicit reprint allowed',async()=>{const h=printerHarness();await h.p.connect();const r={sourceSaved:true,saleId:'s',operationId:'op'};await h.p.confirmed(r);assert.equal(h.sends,0);h.p.arm('op');await Promise.all([h.p.confirmed(r),h.p.confirmed(r)]);assert.equal(h.sends,salePrintPages(sale).length);h.p.arm('op');await h.p.confirmed(r);assert.equal(h.sends,salePrintPages(sale).length);await h.p.print('s');assert.equal(h.sends,salePrintPages(sale).length*2);h.setUser({_id:'other'});await h.p.print('s');assert.equal(h.sends,salePrintPages(sale).length*2)})
test('disconnected save consumes automatic attempt and reconnect does not send',async()=>{const h=printerHarness();const r={sourceSaved:true,saleId:'s',operationId:'op'};h.p.arm('op');await h.p.confirmed(r);assert.equal(h.sends,0);await h.p.connect();await h.p.confirmed(r);assert.equal(h.sends,0);await h.p.print('s');assert.equal(h.sends,salePrintPages(sale).length)})
test('list binds account vehicle and ignores forged client vehicle filter',async()=>{let where;const chain={where:v=>(where=v,chain),orderBy:()=>chain,skip:()=>chain,limit:()=>chain,get:async()=>({data:[]})};const db={command:{and:v=>v,or:v=>v,nin:v=>v},collection:()=>chain};const svc=createService({db,isAdmin:()=>false,hiddenIds:async()=>[],amounts:()=>({amounts:{}})});assert.equal((await svc.list({mobile_sale_defaults:{vehicle_id:'a',vehicle_no:'A'}},{date:'2026-10-22',vehicle_no:'B'})).code,0);assert.ok(where.some(c=>c.car_no==='A'));assert.ok(!where.some(c=>c.car_no==='B'))})
test('local print ledger failure prevents automatic send without touching saved sale',async()=>{const h=printerHarness();await h.p.connect();h.p.arm('op');h.store.set=()=>{throw Error('storage full')};await h.p.confirmed({sourceSaved:true,saleId:'s',operationId:'op'});assert.equal(h.sends,0);assert.match(h.p.status.value,/storage full/);await h.p.print('s');assert.equal(h.sends,salePrintPages(sale).length)})
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
 assert.ok(lines.some(s=>s.includes('123456789')));assert.ok(lines.some(s=>s.includes('12.5')));assert.ok(lines.some(s=>s.includes('123456')))
})

test('legacy PDA runtime without Array.at can paginate deposits and send all pages',()=>{
 const c={writeReceiptText};vm.createContext(c);vm.runInContext('Array.prototype.at = undefined',c)
 const code=fs.readFileSync('src/services/pda/shared.js','utf8').replace(/export /g,'')+'\n'+fs.readFileSync('src/services/pda/salePrint.js','utf8').replace(/^import .*$/gm,'').replace(/export /g,'')
 vm.runInContext(code+'\nthis.api={salePrintPages,writeSalePage}',c)
 const doc={...sale,deposit_rows:Array.from({length:300},(_,i)=>({bottle_no:'BOTTLE'+i}))}
 const before=JSON.stringify(doc),pages=c.api.salePrintPages(doc),h=receiptPrinterHarness()
 for(const page of pages)c.api.writeSalePage(h.android,page,h.address)
 assert.ok(pages.length>1);assertBounds(pages)
 assert.ok(pages.map(p=>p.rows.join('')).join('').includes('BOTTLE299'))
 assert.equal(h.sends.length,pages.length)
 assert.equal(JSON.stringify(doc),before)
})

test('one bottle per table row exposes original tare/gross/net and preserves missing historical values',()=>{
 const doc={...sale,out_items:[{bottle_no:'147',tare:110,gross:122,net:12},{bottle_no:'90',net:0}]}
 const pages=salePrintPages(doc),detail=pages.find(p=>p.commands.some(c=>c.text==='147'))
 const row=detail.commands.find(c=>c.text==='147').y
 for(const v of ['110.0','122.0','12.0'])assert.ok(detail.commands.some(c=>c.text===v&&c.y===row))
 const missingRow=detail.commands.find(c=>c.text==='90').y;assert.equal(detail.commands.filter(c=>c.text==='未记录'&&c.y===missingRow).length,2)
 assertBounds(pages)
})

const fourEach={...sale,date:'2026-10-23',car_no:'冀A19E6T',delivery_man:'徐永辉/罗小强',customer_name:'恒昌皮业',out_items:Array.from({length:4},(_,i)=>({bottle_no:String(90+i),tare:110,gross:180,net:70})),back_items:Array.from({length:4},(_,i)=>({bottle_no:String(190+i),tare:110,gross:115,net:5})),unit_price:8,total_net_weight:260,should_receive:2080,deposit_rows:[{bottle_no:'55'}]}
const dotWidth=s=>[...s].reduce((n,c)=>n+(c.charCodeAt(0)>127?24:12),0)
function assertBounds(pages){
 for(const page of pages){
  assert.ok(page.heightMm>0&&page.heightMm<=200)
  let printed
  const {writeSalePage:writer}=load('src/services/pda/salePrint.js',['writeSalePage'],{writeReceiptText:(_,rows)=>{printed=rows}})
  writer({},page,'address')
  const boxes=printed.map(c=>({x:c.x,y:c.y,w:dotWidth(c.text),h:24,text:c.text}))
  for(const b of boxes)assert.ok(b.x>=16&&b.x+b.w<=560&&b.y>=16&&b.y+b.h<=page.heightMm*8-16,JSON.stringify(b))
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
   const a=boxes[i],b=boxes[j]
   assert.ok(!(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h),`${a.text} overlaps ${b.text}`)
  }
 }
}
test('four outgoing then four returning fit one variable-length receipt including settlement and corrected deposits',()=>{
 const before=JSON.stringify(fourEach),pages=salePrintPages(fourEach)
 assert.equal(pages.length,1);assert.ok(pages[0].heightMm>50&&pages[0].heightMm<110)
 const rows=pages[0].rows.join('');assert.match(rows,/计费: 260kg  单价: 8元\/kg/);assert.match(rows,/\(280-20\)×8=2080.00元/);assert.match(rows,/存瓶\(5瓶\): 55、90、91、92、93/)
 assert.ok(pages[0].commands.find(c=>c.text.startsWith('回瓶 4瓶')).y>pages[0].commands.find(c=>c.text==='93').y)
 for(const items of [fourEach.out_items,fourEach.back_items])for(const item of items){
  const cell=pages[0].commands.find(c=>c.text===item.bottle_no);assert.ok(cell)
  for(const k of ['tare','gross','net'])assert.ok(pages[0].commands.some(c=>c.y===cell.y&&c.text===item[k].toFixed(1)))
 }
 assertBounds(pages);assert.equal(JSON.stringify(fourEach),before)
})
test('only outgoing or returning prints no empty direction and retains signed formula',()=>{
 for(const direction of ['out_items','back_items']){
  const doc={...fourEach,out_items:[],back_items:[],[direction]:fourEach[direction],total_net_weight:direction==='out_items'?280:-20,should_receive:direction==='out_items'?2240:-160}
  const pages=salePrintPages(doc);assert.ok(!pages.some(p=>p.rows.some(r=>r.startsWith(direction==='out_items'?'回瓶':'出瓶'))))
  assert.ok(pages.flatMap(p=>p.rows).join('').includes(`${doc.should_receive.toFixed(2)}元`));assertBounds(pages)
 }
})
test('long metadata, bottle IDs, large amounts, deposit continuation and rounding never overlap or omit',()=>{
 const doc={...fourEach,customer_name:'非常长的客户名称'.repeat(3),delivery_man:'配送员甲和配送员乙共同配送',out_items:[{bottle_no:'B'.repeat(48),tare:110,gross:100110,net:100000}],back_items:[],total_net_weight:100000,should_receive:800000,rounding_amount:0.5,effective_should_receive:799999.5,deposit_rows:Array.from({length:40},(_,i)=>({bottle_no:'DEPOSIT'+i}))}
 const pages=salePrintPages(doc),all=pages.flatMap(p=>p.rows).join('')
 assert.match(all,/800000.00元/);assert.match(all,/抹零: 0.50 元/);assert.match(all,/实应收: 799999.50 元/);assert.match(all,/DEPOSIT39/)
 assert.equal(pages.flatMap(p=>p.commands).filter(c=>c.x===16&&/^B+$/.test(c.text)).slice(0,4).map(c=>c.text).join(''),'B'.repeat(48));assertBounds(pages)
})

test('post-sale deposits add outgoing, remove returning, normalize and deduplicate without mutating the saved list',()=>{
 const base=[{bottle_no:'KEEP'},{bottle_no:'190'},{bottleNo:' 191 '},{bottle_no:'90'},{bottle_no:'keep'}]
 const doc={...fourEach,deposit_rows:base},before=JSON.stringify(doc)
 const lines=salePrintPages(doc).flatMap(p=>p.rows),deposits=lines.slice(lines.findIndex(s=>s.startsWith('存瓶('))).join('')
 assert.equal(deposits,'存瓶(5瓶): 90、91、92、93、KEEP')
 const computed=buildDepositPreviewRows({baseBottleNos:base,outItems:doc.out_items,backItems:doc.back_items})
 const again=salePrintPages({...doc,deposit_rows:computed}).flatMap(p=>p.rows)
 assert.equal(again.slice(again.findIndex(s=>s.startsWith('存瓶('))).join(''),deposits)
 assert.equal(JSON.stringify(doc),before)
})

test('return wins when the same bottle is both outgoing and returning; empty and missing baseline remain distinct',()=>{
 const doc={...sale,out_items:[{bottle_no:' x1 ',net:12}],back_items:[{bottle_no:'X1',net:2}],deposit_rows:[{bottle_no:'x1'}]}
 assert.ok(salePrintPages(doc)[0].rows.includes('存瓶(0瓶): 无'))
 assert.ok(salePrintPages({...sale,deposit_rows:[]})[0].rows.includes('存瓶(1瓶): 1'))
 for(const missing of [null,undefined])assert.ok(salePrintPages({...sale,deposit_rows:missing})[0].rows.includes('存瓶: 原单未记录，待核对'))
})

test('receipt length grows with extra bottles or wrapped deposits, without fixing it to the roll diameter',()=>{
 const first=salePrintPages(fourEach)[0]
 const longer=salePrintPages({...fourEach,out_items:[...fourEach.out_items,{bottle_no:'94',tare:110,gross:180,net:70}],total_net_weight:330,should_receive:2640})[0]
 const deposits=salePrintPages({...fourEach,deposit_rows:Array.from({length:30},(_,i)=>({bottle_no:'STORED'+i}))})[0]
 assert.ok(longer.heightMm>first.heightMm);assert.ok(deposits.heightMm>first.heightMm)
 assertBounds([longer,deposits])
})

test('missing receipt class or silent Native.js command failure prevents all transmission',()=>{
 for(const missing of ['class','getCommand','addInitializePrinter','addSetHorAndVerMotionUnits','addSetAbsolutePrintPosition','addText','addPrintAndFeedPaper']){
  const h=receiptPrinterHarness({missing})
  assert.throws(()=>writeSalePage(h.android,salePrintPages(sale)[0],h.address),/小票打印接口/)
  assert.equal(h.sends.length,0)
 }
})

test('receipt sends only through the selected connected printer and strips embedded control codes',()=>{
 for(const options of [{connected:false},{address:'00:00:00:00:00:00'}]){
  const h=receiptPrinterHarness(options)
  assert.throws(()=>writeSalePage(h.android,salePrintPages(sale)[0],h.address),/连接已变化/)
  assert.equal(h.sends.length,0)
 }
 const h=receiptPrinterHarness(),page=salePrintPages({...sale,customer_name:'客户\x1b@\n名字'})[0]
 writeSalePage(h.android,page,h.address)
 assert.ok(h.operations.filter(c=>c[0]==='addText').every(c=>!/[\x00-\x1f\x7f]/.test(c[1])))
 const late=receiptPrinterHarness(),invoke=late.android.invoke
 late.android.invoke=(target,method,...args)=>{const r=invoke(target,method,...args);if(method==='addText')late.disconnect();return r}
 assert.throws(()=>writeSalePage(late.android,page,late.address),/连接已变化/)
 assert.equal(late.sends.length,0)
})
