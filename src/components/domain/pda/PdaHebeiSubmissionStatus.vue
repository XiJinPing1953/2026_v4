<template><view class="hebei-status"><text>{{ message }}</text><AppButton v-if="needsReview" kind="ghost" size="sm" :disabled="loading" @click="refresh">刷新结果</AppButton></view></template>
<script setup>
import {ref,watch,onBeforeUnmount} from 'vue'
import {getHebeiFillingStatus} from '@/services/api/hebeiFilling'
import AppButton from '@/components/base/AppButton.vue'
const props=defineProps({active:Boolean,fillingId:String})
const message=ref('河北：正在查询提交状态'),needsReview=ref(false),loading=ref(false)
let version=0,timer=null
async function refresh(){
 const v=++version,id=props.fillingId;clearTimeout(timer);loading.value=true
 try{
  const r=await getHebeiFillingStatus(id,{isResponseCurrent:()=>v===version&&props.active&&props.fillingId===id})
  if(v!==version||!props.active||props.fillingId!==id)return
  if(r?.code!==0)throw Error(r?.msg||'暂未查到提交结果')
  const s=r.data.state
  const labels={disabled:'自动提交尚未启用',outside_scope:'本条不在自动提交范围',pending:'等待后台提交',waiting:r.data.reason||'等待后台处理',preparing:'准备提交',attempting:'正在提交',unknown:'提交结果待核，勿重复填报',accepted_pending_verify:'已收到成功响应，正在核验',confirmed:'已提交并核验',blocked:r.data.reason||'资料需要核对',requires_review:'原记录已变更，需要核对已报内容'}
  message.value='河北：'+(labels[s]||'提交结果待核')
  needsReview.value=['unknown','blocked','requires_review'].includes(s)
  if(['pending','waiting','preparing','attempting','accepted_pending_verify'].includes(s))timer=setTimeout(()=>void refresh(),15000)
 }catch(e){if(v===version){message.value='河北：'+e.message;needsReview.value=true}}
 finally{if(v===version)loading.value=false}
}
watch(()=>[props.active,props.fillingId],()=>{version++;clearTimeout(timer);if(props.active&&props.fillingId)void refresh()},{immediate:true})
onBeforeUnmount(()=>{version++;clearTimeout(timer)})
</script>
<style scoped>.hebei-status{display:flex;align-items:center;gap:8px;margin:8px 0;color:#475569;font-size:14px;line-height:1.5}</style>
