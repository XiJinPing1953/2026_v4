const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
test('切换流转取消未完成档案请求，返回时不保留加载状态或迟到结果',async()=>{
 let finish
 const source=fs.readFileSync('src/components/domain/pda/PdaBottleQueryView.vue','utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm,'')
 const x=vm.runInNewContext(source+'\n;({runSearch,openMovement,loading,list,tab})',{
 ref:value=>({value}),reactive:x=>x,computed:fn=>({get value(){return fn()}}),watch(){},onBeforeUnmount(){},defineProps:()=>({}),defineExpose(){},
 canViewPage:()=>true,isPdaAppMode:()=>true,usePdaQueryScan:()=>({invalidate(){},activate(){},deactivate(){}}),
 queryPdaBottleArchive:()=>new Promise(resolve=>finish=resolve),uni:{showToast(){}},normalizeText:x=>String(x||'')
 })
 const pending=x.runSearch();assert.equal(x.loading.value,true);x.openMovement('282');assert.equal(x.loading.value,false)
 finish({code:0,data:[{bottle_no:'282'}],paging:{}});await pending;x.tab.value='bottle';assert.equal(x.loading.value,false);assert.equal(x.list.value.length,0)
})
