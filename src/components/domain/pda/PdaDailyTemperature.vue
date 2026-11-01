<template>
 <view class="daily-temperature">
  <view class="daily-temperature__line">
   <text>今日参考温度{{ temperature ? ` ${temperature.temperature_c}℃` : (!date ? '：待读取' : '：待填写') }}</text>
   <AppButton v-if="!temperature" kind="ghost" size="sm" :disabled="disabled || loading" @click="editOrRefresh">{{ !date || error || needsCheck ? '重试读取' : (open ? '收起' : '填写') }}</AppButton>
   <AppButton v-else kind="ghost" size="sm" :disabled="loading" @click="refresh">刷新</AppButton>
  </view>
  <view v-if="open && !temperature" class="daily-temperature__form">
   <text class="daily-temperature__hint">查看今天的天气后填入℃，当天所有气瓶共用。未填写时，河北提交先等待。</text>
   <AppInput v-model="input" label="参考温度（℃）" placeholder="例如 15，支持负数" :disabled="disabled || loading" size="sm" />
   <AppButton size="sm" :disabled="disabled || loading || !date || needsCheck" :loading="loading" @click="save">保存今日温度</AppButton>
  </view>
  <text v-if="error" class="daily-temperature__error">{{ error }}</text>
  <text v-else-if="temperature" class="daily-temperature__hint">{{ date }} · 当天复用，次日重新填写</text>
 </view>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { getUser } from '@/services/auth'
import { getHebeiDailyTemperature, setHebeiDailyTemperature } from '@/services/api/hebeiFilling'
const props=defineProps({active:Boolean,disabled:Boolean})
const date=ref(''),temperature=ref(null),input=ref(''),open=ref(false),loading=ref(false),error=ref(''),needsCheck=ref(false)
let version=0,timer=null
const chinaDay=()=>new Date(Date.now()+28800000).toISOString().slice(0,10)
function editOrRefresh(){
 if(!date.value||error.value||needsCheck.value){open.value=true;void refresh()}
 else open.value=!open.value
}
async function refresh(){
 if(loading.value||!props.active)return
 const request=++version,owner=getUser()?._id
 const isResponseCurrent=()=>request===version&&props.active&&owner===getUser()?._id
 loading.value=true;error.value=''
 try{
  const r=await getHebeiDailyTemperature({isResponseCurrent})
  if(!isResponseCurrent())return
  if(r?.code!==0)throw new Error(r?.msg||'温度读取失败，可稍后重试')
  date.value=r.data.date;temperature.value=r.data.temperature;needsCheck.value=false
  if(temperature.value)open.value=false
 }catch(e){if(isResponseCurrent())error.value=e.message}
 finally{if(request===version)loading.value=false}
}
async function save(){
 if(loading.value||!props.active||props.disabled||!date.value||needsCheck.value)return
 const v=input.value.trim()
 if(!v||!Number.isFinite(Number(v))||Number(v)<-60||Number(v)>60){error.value='请填写-60至60℃的温度';return}
 const request=++version,owner=getUser()?._id
 const isResponseCurrent=()=>request===version&&props.active&&owner===getUser()?._id
 loading.value=true;error.value='';needsCheck.value=true
 try{
  const r=await setHebeiDailyTemperature({date:date.value,temperature_c:Number(v)},{isResponseCurrent})
  if(!isResponseCurrent())return
  if(r?.code!==0)throw new Error(r?.msg||'保存结果未确认，请刷新查看')
  temperature.value=r.data;needsCheck.value=false;open.value=false;uni.hideKeyboard()
 }catch(e){if(isResponseCurrent())error.value=e.message+'；请重试读取，核实保存结果'}
 finally{if(request===version)loading.value=false}
}
watch(()=>props.active,active=>{
 version++;loading.value=false;clearInterval(timer);timer=null
 if(!active)return
 if(date.value!==chinaDay()){temperature.value=null;date.value='';input.value=''}
 void refresh()
 timer=setInterval(()=>{if(!loading.value&&date.value&&date.value!==chinaDay()){temperature.value=null;date.value='';input.value='';void refresh()}},30000)
},{immediate:true})
onBeforeUnmount(()=>{version++;clearInterval(timer)})
</script>
<style scoped>
.daily-temperature{padding:8px 0 0;margin-top:8px;border-top:1px solid #e2e8f0;font-size:16px}
.daily-temperature__line{display:flex;align-items:center;justify-content:space-between;gap:8px}
.daily-temperature__form{display:flex;flex-direction:column;gap:8px;padding-top:8px}
.daily-temperature__hint,.daily-temperature__error{display:block;font-size:13px;line-height:1.5;color:#64748b}
.daily-temperature__error{color:#b91c1c}
</style>
