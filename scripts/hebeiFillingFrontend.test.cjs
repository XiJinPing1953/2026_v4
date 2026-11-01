const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm')
function component(file,api){
 const code=fs.readFileSync('src/components/domain/pda/'+file,'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*\n/gm,'')
 const watches=[],unmount=[],timers=[];let owner='u1'
 const props={active:true,disabled:false,fillingId:'f1'}
 const context={console,Date,Number,Error,Math,Promise,defineProps:()=>props,ref:value=>({value}),watch:(s,fn)=>watches.push(fn),onBeforeUnmount:fn=>unmount.push(fn),getUser:()=>({_id:owner}),setTimeout:fn=>(timers.push(fn),1),setInterval:fn=>(timers.push(fn),1),clearTimeout:()=>{},clearInterval:()=>{},uni:{hideKeyboard(){}},...api}
 const names=file==='PdaDailyTemperature.vue'?'refresh,save,temperature,date,input,error,loading':'refresh,message,needsReview,loading'
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
