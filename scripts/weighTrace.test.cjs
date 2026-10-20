const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {createWeighTrace}=vm.runInNewContext(fs.readFileSync('src/services/pda/weighTrace.js','utf8').replace(/export /g,'')+'\n;({createWeighTrace})',{setTimeout:()=>1,clearTimeout(){},Date,JSON})
function store(){const m=new Map();return {getStorageSync:k=>m.get(k),setStorageSync:(k,v)=>m.set(k,JSON.parse(JSON.stringify(v))),removeStorageSync:k=>m.delete(k)}}
test('保留完整连续帧与取重后读数，重启恢复、账号隔离',()=>{const s=store(),a=createWeighTrace('a',s);a.start();a.record('frame',{weight:4});a.record('capture',{weight:4});a.record('frame',{weight:122});a.stop();const b=createWeighTrace('a',s);assert.equal(JSON.parse(b.dump()).records.filter(r=>r.type==='frame').length,2);assert.equal(JSON.parse(createWeighTrace('b',s).dump()).count,0)})
test('上限停止不覆盖，导出后才由用户清空',()=>{const a=createWeighTrace('a',store());a.start();for(let i=0;i<21000;i++)a.record('frame',{weight:i});const x=JSON.parse(a.dump());assert.equal(x.count,20000);assert.match(x.error,/上限/);assert.equal(x.records[1].weight,0);assert.throws(()=>a.start());a.clear();a.start();a.stop();assert.equal(JSON.parse(a.dump()).count,2)})
test('存储失败不向称重调用者抛错，缺段导出明确失败',()=>{let fail=false;const s=store(),set=s.setStorageSync;s.setStorageSync=(k,v)=>{if(fail)throw Error('full');set(k,v)};const a=createWeighTrace('a',s);a.start();fail=true;assert.doesNotThrow(()=>{for(let i=0;i<100;i++)a.record('frame')});assert.match(JSON.parse(a.dump()).error,/存储/);fail=false;a.stop();s.getStorageSync=()=>null;assert.throws(()=>a.dump(),/缺失/)})
test('读取索引失败不写回空索引，不假装空导出',()=>{const s=store(),a=createWeighTrace('a',s);a.start();a.record('frame',{weight:122});a.stop();const original=s.getStorageSync;let writes=0;const broken={...s,getStorageSync(){throw Error('read')},setStorageSync(){writes++}};const b=createWeighTrace('a',broken);b.flush();b.stop();assert.throws(()=>b.dump(),/读取/);assert.throws(()=>b.start(),/读取/);assert.equal(writes,0);assert.ok(original('pda_weigh_trace_v1_a').count>0)})
test('Android文件流为空时导出失败并删除空文件，不能报告成功',async()=>{
 let deleted=false
 const android={importClass:name=>name.endsWith('VERSION')?{SDK_INT:30}:name.endsWith('Uri')?{parse:x=>x}:function(){},runtimeMainActivity:()=>({}),invoke:(obj,method)=>{if(method==='getContentResolver')return {};if(method==='insert')return {};if(method==='openOutputStream')return null;if(method==='delete')deleted=true}}
 const {exportWeighTrace}=vm.runInNewContext(fs.readFileSync('src/services/pda/weighTrace.js','utf8').replace(/export /g,'')+'\n;({exportWeighTrace})',{plus:{android},Date})
 await assert.rejects(exportWeighTrace('{}'),/无法写入/);assert.equal(deleted,true)
})
function exporter(mode='ok') {
 const state={text:'',deleted:false,closed:0},stream={},writer={},descriptor={}
 const android={
  importClass:name=>name.endsWith('VERSION')?{SDK_INT:30}:name.endsWith('Uri')?{parse:x=>x}:function(){},
  runtimeMainActivity:()=>({}),
  newObject:(name,s,encoding)=>{assert.equal(name,'java.io.OutputStreamWriter');assert.equal(s,stream);assert.equal(encoding,'UTF-8');return mode==='noWriter'?null:writer},
  invoke:(obj,method,...args)=>{
   if(method==='getContentResolver'||method==='insert')return {}
   if(method==='openOutputStream')return stream
   if(method==='write'){assert.equal(obj,writer);assert.equal(args[1],0);assert.equal(args[2],args[0].length);if(mode!=='silent')state.text=args[0]}
   if(method==='openFileDescriptor')return mode==='noDescriptor'?null:descriptor
   if(method==='getStatSize')return mode==='partial'?2:Buffer.byteLength(state.text,'utf8')
   if(method==='close')state.closed++
   if(method==='delete')state.deleted=true
  }
 }
 return {state,run:vm.runInNewContext(fs.readFileSync('src/services/pda/weighTrace.js','utf8').replace(/export /g,'')+'\n;exportWeighTrace',{plus:{android},Date}).bind(null)}
}
test('UTF-8中文与非BMP字符写入后核验实际字节，成功才返回路径',async()=>{const x=exporter();const text=JSON.stringify({records:['新拓能源','😀',122]});assert.match(await x.run(text),/^Download\/weigh-trace-\d+\.json$/);assert.equal(x.state.text,text);assert.equal(x.state.deleted,false);assert.equal(x.state.closed,3)})
for(const mode of ['silent','partial','noWriter','noDescriptor'])test(`导出${mode}失败，删除本次不完整文件且保留2833条原采样`,async()=>{
 const s=store(),a=createWeighTrace('original',s);a.start();for(let i=0;i<2831;i++)a.record('frame',{weight:i});a.stop();const before=JSON.parse(a.dump());assert.equal(before.count,2833)
 const x=exporter(mode);await assert.rejects(x.run(a.dump()));assert.equal(x.state.deleted,true)
 const after=JSON.parse(createWeighTrace('original',s).dump());assert.deepEqual(after.records,before.records);assert.equal(after.count,2833)
})
