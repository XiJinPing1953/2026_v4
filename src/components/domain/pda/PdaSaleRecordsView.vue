<template>
 <view class="sale-records">
  <view class="row"><AppButton kind="outline" @click="back">返回</AppButton><text class="title">销售记录</text></view>
  <view class="row"><picker mode="date" :value="date" @change="date=$event.detail.value"><view class="date">{{ date }}</view></picker><input v-model="customer" placeholder="客户名称" confirm-type="search" @confirm="search"/><AppButton :disabled="loading" @click="search">查询</AppButton></view>
  <text>{{ printer.status.value }}</text><view class="row"><AppButton :disabled="printer.busy.value || printer.connecting.value" @click="printer.connect">连接打印机</AppButton><AppButton v-if="printer.busy.value" @click="printer.stop">停止打印</AppButton></view>
  <text v-if="error" class="error">{{ error }}</text>
  <view v-if="detail" class="card">
   <text class="title">{{ detail.delivery_customer_name || detail.customer_name }}</text><text>{{ detail.date }}　{{ detail.car_no }}　{{ detail.delivery_man }}</text>
   <text>单价 {{ detail.unit_price }} 元/kg　应收 {{ detail.effective_should_receive }} 元</text>
   <template v-for="group in [{name:'出瓶',rows:detail.out_items||[]},{name:'回瓶',rows:detail.back_items||[]}]" :key="group.name"><text class="title">{{ group.name }} {{ group.rows.length }} 瓶</text><text v-for="(r,i) in group.rows" :key="i">{{ r.bottle_no || r.bottleNo }}号　毛 {{ r.gross }}　皮 {{ r.tare }}　净 {{ r.net }} kg</text></template>
   <AppButton :disabled="printer.busy.value" @click="printer.print(detail._id)">打印销售单</AppButton><AppButton kind="outline" @click="detail=null">收起明细</AppButton>
  </view>
  <view v-for="r in rows" :key="r.id" class="card" @click="open(r.id)"><text class="title">{{ r.customer }}</text><text>{{ r.date }}　{{ r.vehicle }}</text><text>出瓶 {{ r.out_count }}　回瓶 {{ r.back_count }}　金额 {{ r.amount == null ? '待核对' : r.amount }} 元</text><AppButton kind="outline" :disabled="loading" @click.stop="open(r.id)">查看明细 / 打印</AppButton></view>
  <text v-if="!loading && !rows.length && !error">当天没有销售记录</text><AppButton v-if="hasMore" :disabled="loading" @click="load(true)">加载更多</AppButton>
 </view>
</template>
<script setup>
import { ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { getUser } from '@/services/auth'
import { listPdaSales, getPdaSale } from '@/services/pda/saleRecords'
import { usePdaSalePrinter } from '@/composables/pda/usePdaSalePrinter'
const emit=defineEmits(['back']),active=ref(false),date=ref(''),customer=ref(''),rows=ref([]),detail=ref(null),loading=ref(false),error=ref(''),hasMore=ref(false)
const owner=String(getUser()?._id||''),valid=()=>active.value&&owner===String(getUser()?._id||'')
const printer=usePdaSalePrinter(valid)
let epoch=0,page=1,filter=null
async function load(more=false){if(!valid()||loading.value)return;const ticket=epoch;loading.value=true;error.value='';if(!more){page=1;rows.value=[];detail.value=null;filter={date:date.value,customer:customer.value}}
 try{const result=await listPdaSales({...filter,page}, { shouldContinue: () => ticket === epoch && valid() });if(ticket!==epoch||!valid())return;if(result.code!==0)throw Error(result.msg);rows.value=more?[...rows.value,...result.data.rows]:result.data.rows;hasMore.value=result.data.has_more;if(hasMore.value)page++}catch(e){if(ticket===epoch)error.value=e.message}finally{if(ticket===epoch)loading.value=false}}
function search(){return load(false)}
async function open(id){if(!valid()||loading.value)return;const ticket=epoch;loading.value=true;try{const result=await getPdaSale(id, { shouldContinue: () => ticket === epoch && valid() });if(ticket!==epoch||!valid())return;if(result.code!==0)throw Error(result.msg);detail.value=result.data}catch(e){if(ticket===epoch)error.value=e.message}finally{if(ticket===epoch)loading.value=false}}
function activate(){active.value=true;epoch++;const d=new Date();date.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return search()}
function deactivate(){active.value=false;epoch++;loading.value=false;printer.close()}
function back(){deactivate();emit('back')}
defineExpose({activate,deactivate})
</script>
<style scoped>
.sale-records{display:flex;flex-direction:column;gap:12px;padding:12px;font-size:16px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row input{min-width:120px;flex:1;background:#fff;padding:12px}.date{padding:12px;background:#eef2f6}.card{display:flex;flex-direction:column;gap:10px;padding:14px;background:white;border:1px solid #dbe3ed;border-radius:10px}.title{font-size:18px;font-weight:700}.error{color:#b42318}.sale-records :deep(.btn){min-height:48px;font-size:16px}
</style>
