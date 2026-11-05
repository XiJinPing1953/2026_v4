const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {reactive,ref,computed,watch,nextTick,effectScope}=require('vue')
test('display-only tare is dropped when the board restarts or its connection changes',async()=>{
 const functions=fs.readFileSync('src/services/pda/floorScaleDisplay.js','utf8').replace(/^export /gm,'')
 const view=fs.readFileSync('src/components/domain/pda/PdaFloorScale.vue','utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm,'')
 const props=reactive({active:true,busy:false,snapshot:{is_connected:true,is_online:true,qualified_frame:true,device_id:'A',connection_key:'s1',weight_kg:20,sampled_at:Date.now()}})
 const scope=effectScope()
 const c=scope.run(()=>vm.runInNewContext(functions+'\n'+view+'\n;({tare,weight,takeTare})',{computed,ref,watch,defineProps:()=>props,defineEmits:()=>{}}))
 try {
  c.takeTare();assert.equal(c.weight.value,'0.0')
  props.snapshot={...props.snapshot,boot_zero_state:'boot_zero_pending',warming:true,qualified_frame:false};await nextTick()
  props.snapshot={...props.snapshot,boot_zero_state:'',warming:false,qualified_frame:true,weight_kg:0};await nextTick()
  assert.equal(c.weight.value,'0.0');assert.equal(c.tare.value,null)
  props.snapshot={...props.snapshot,weight_kg:20,sampled_at:Date.now()};c.takeTare();assert.equal(c.weight.value,'0.0')
  props.snapshot={...props.snapshot,connection_key:'s2',weight_kg:0};await nextTick()
  assert.equal(c.tare.value,null);assert.equal(c.weight.value,'0.0')
 } finally {scope.stop()}
})
