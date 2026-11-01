const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm')
function component(file,api){
 const code=fs.readFileSync('src/components/domain/pda/'+file,'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*\n/gm,'')
 const watches=[],unmount=[],timers=[];let owner='u1'
 const props={active:true,disabled:false,fillingId:'f1'}
 const context={console,Date,Number,Error,Math,Promise,defineProps:()=>props,ref:value=>({value}),watch:(s,fn)=>watches.push(fn),onBeforeUnmount:fn=>unmount.push(fn),getUser:()=>({_id:owner}),setTimeout:fn=>(timers.push(fn),1),setInterval:fn=>(timers.push(fn),1),clearTimeout:()=>{},clearInterval:()=>{},uni:{hideKeyboard(){}},...api}
 const names=file==='PdaDailyTemperature.vue'?'refresh,save,editOrRefresh,temperature,date,input,error,loading,needsCheck':'refresh,message,needsReview,loading'
 const state=vm.runInNewContext(code+`;({${names}})`,context)
 return {state,props,watches,unmount,timers,setOwner:x=>owner=x}
}
test('late daily-temperature response after navigation/account change cannot populate new view',async()=>{
 let resolve;const h=component('PdaDailyTemperature.vue',{getHebeiDailyTemperature:()=>new Promise(r=>resolve=r)})
 const p=h.state.refresh();h.setOwner('u2');resolve({code:0,data:{date:'2026-11-01',temperature:{temperature_c:15}}});await p;assert.equal(h.state.temperature.value,null)
})
test('manual negative and zero temperatures are accepted, blank cannot become zero',async()=>{
 const sent=[];const h=component('PdaDailyTemperature.vue',{setHebeiDailyTemperature:async d=>(sent.push(d),{code:0,data:d})})
 h.state.date.value='2026-11-01';h.state.input.value=' ';await h.state.save();assert.equal(sent.length,0)
 h.state.input.value='0';await h.state.save();assert.equal(sent[0].temperature_c,0)
 h.state.input.value='-5';await h.state.save();assert.equal(sent[1].temperature_c,-5)
})
test('switching current cylinder drops old remote result and unknown does not request a retry',async()=>{
 let resolve;const h=component('PdaHebeiSubmissionStatus.vue',{getHebeiFillingStatus:()=>new Promise(r=>resolve=r)})
 const p=h.state.refresh();h.props.fillingId='f2';resolve({code:0,data:{state:'confirmed'}});await p;assert.doesNotMatch(h.state.message.value,/已提交并核验/)
 const p2=h.state.refresh();resolve({code:0,data:{state:'unknown'}});await p2;assert.match(h.state.message.value,/勿重复填报/);assert.equal(h.timers.length,0)
})

test('failed first read retries in place and preserves typed temperature',async()=>{
 let calls=0;const h=component('PdaDailyTemperature.vue',{getHebeiDailyTemperature:async()=>{
  if(++calls===1)throw Error('network failure');return {code:0,data:{date:'2026-11-01',temperature:null}}
 }})
 h.state.input.value='-5';await h.state.refresh();assert.equal(h.state.date.value,'');assert.match(h.state.error.value,/network/)
 h.state.editOrRefresh();await new Promise(setImmediate)
 assert.equal(calls,2);assert.equal(h.state.date.value,'2026-11-01');assert.equal(h.state.input.value,'-5');assert.equal(h.state.error.value,'')
})
test('lost temperature save response is read back before another save is allowed',async()=>{
 let writes=0,reads=0;const h=component('PdaDailyTemperature.vue',{
  setHebeiDailyTemperature:async()=>{writes++;throw Error('timeout')},
  getHebeiDailyTemperature:async()=>{reads++;return {code:0,data:{date:'2026-11-01',temperature:{temperature_c:0}}}}
 })
 h.state.date.value='2026-11-01';h.state.input.value='0';await h.state.save();await h.state.save()
 assert.equal(writes,1);assert.equal(h.state.needsCheck.value,true)
 h.state.editOrRefresh();await new Promise(setImmediate);assert.equal(reads,1);assert.equal(h.state.temperature.value.temperature_c,0)
})
function realApi(){
 let resolve,auth=0,forbidden=0
 const source=fs.readFileSync('src/services/api/callCloud.js','utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')
 const shared=vm.runInNewContext(source+';({callCloud})',{getToken:()=> 'same-account',handle401:()=>auth++,handle403:()=>forbidden++,uniCloud:{callFunction:()=>new Promise(r=>resolve=r)},console:{info(){}},Date,Math,Number,JSON,Map,Set,Error})
 const service=fs.readFileSync('src/services/api/hebeiFilling.js','utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')
 return {api:vm.runInNewContext(service+';({getHebeiDailyTemperature,setHebeiDailyTemperature,getHebeiFillingStatus})',shared),reply:code=>resolve({result:{code,msg:'expired'}}),counts:()=>({auth,forbidden})}
}
for(const file of ['PdaDailyTemperature.vue','PdaHebeiSubmissionStatus.vue']){
 for(const code of [401,403])test(file+' hidden response '+code+' cannot invoke global auth UI',async()=>{
  const a=realApi(),h=component(file,a.api),pending=h.state.refresh()
  h.props.active=false;h.watches[0](false);a.reply(code);await pending
  assert.deepEqual(a.counts(),{auth:0,forbidden:0})
 })
}
test('active authentication failure still reaches shared login handling',async()=>{
 const a=realApi(),h=component('PdaDailyTemperature.vue',a.api),pending=h.state.refresh();a.reply(401);await pending;assert.equal(a.counts().auth,1)
})
test('hidden temperature save suppresses old auth UI without retrying its write',async()=>{
 const a=realApi(),h=component('PdaDailyTemperature.vue',a.api);h.state.date.value='2026-11-01';h.state.input.value='10'
 const pending=h.state.save();h.props.active=false;h.watches[0](false);a.reply(401);await pending
 assert.equal(a.counts().auth,0);assert.equal(h.state.needsCheck.value,true)
})
test('repeated retry clicks do not overlap a slow temperature read',async()=>{
 let reads=0,resolve;const h=component('PdaDailyTemperature.vue',{getHebeiDailyTemperature:()=>{reads++;return new Promise(r=>resolve=r)}})
 h.state.editOrRefresh();h.state.editOrRefresh();h.state.editOrRefresh();assert.equal(reads,1)
 resolve({code:0,data:{date:'2026-11-01',temperature:null}});await new Promise(setImmediate);assert.equal(h.state.loading.value,false)
})
