'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const component = fs.readFileSync('src/components/base/AppBottleQueryFloat.vue', 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm, '')
const labelSource = fs.readFileSync('src/composables/useBottleSuggestions.js', 'utf8').replace(/^import .*\n/gm, '').replace(/export\s*\{[\s\S]*?\}\s*$/m, '')
const getLabel = vm.runInNewContext(labelSource + '\ngetBottleSuggestionStatusLabel', {})
function harness(bottleResponse) {
 const context = {ref: value => ({value}), reactive: value => value, computed: fn => ({get value(){return fn()}}), onMounted(){}, onBeforeUnmount(){},
  getBottleSuggestionStatusLabel:getLabel, buildBottleTimelineDisplayEvents:rows=>[...rows].reverse(),
  getBottleMovementTimelineV1:async()=>({code:0,data:{bottle_no:'367',state:{code:'ready_out',kind:'success'},events:[{type:'fill',event_day:'2026-10-27'}]}}),
  searchBottlesV1:async()=>({code:0,data:[{bottle_no:'367',tare_weight:132}]}),
  resolveBottleNoV1:async()=>bottleResponse,uni:{showToast(){}} }
 return vm.runInNewContext(component+'\n;({ keyword, onSearch, result })', context)
}
test('query and sales suggestions use the same exact archive status, even if movement suggests otherwise', async()=>{
 for (const [status,label] of [['in_station','在站'],['unknown','未知'],['at_customer','在客户']]) {
  const h=harness({code:0,data:{bottle:{bottle_no:'367',status,current_customer_name:status==='at_customer'?'测试客户':''}}})
  h.keyword.value='367';await h.onSearch();assert.equal(h.result.value.currentStatus,label);assert.equal(h.result.value.currentStatus,getLabel(status))
  if(status==='at_customer')assert.equal(h.result.value.currentCustomer,'测试客户')
 }
})
test('missing, conflicting or unavailable archive cannot be presented as in station',async()=>{
 for(const reply of [null,{code:404},{code:0,data:{bottle:{bottle_no:'368',status:'in_station'}}}]){
  const h=harness(reply);h.keyword.value='367';await h.onSearch();assert.equal(h.result.value.currentStatus,'状态读取失败')
 }
})
