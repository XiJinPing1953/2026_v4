<template>
 <view class="refund-panel">
  <view class="refund-head"><text>登记已经实际退给客户的钱。退押金请使用“押金”入口。</text><AppButton size="sm" kind="neutral" :disabled="busy || !!operation" @click="load">刷新</AppButton></view>
  <text v-if="issue" class="warning">{{ issue }}</text>
  <text v-if="pendingTotal" class="warning">有 ¥{{ money(pendingTotal) }} 退款来源待核，尚未扣除对应余额；请补关联后再使用余额。</text>
  <view v-if="canWrite && ready" class="refund-form">
   <text class="title">{{ linking ? '补齐退款来源（不重复记退款）' : '退款登记' }}</text>
   <view class="fields">
    <AppInput v-model="form.amount" label="退款金额（元）" placeholder="0.00" type="digit" :disabled="locked || !!linking" />
    <AppInput v-model="form.biz_date" label="实际退款日期" placeholder="YYYY-MM-DD" :disabled="locked || !!linking" />
    <view class="payment-field"><text class="field-label">付款方式</text><picker :range="channels" range-key="label" :value="channelIndex" :disabled="locked || !!linking" @change="form.payment_method=channels[Number($event.detail.value)].value"><view class="select"><text>{{ channels[channelIndex].label }}</text><text class="chevron">⌄</text></view></picker></view>
    <AppInput class="voucher-field" v-model="form.voucher_ref" label="退款凭据（选填）" placeholder="编号或说明" :disabled="locked || !!linking" />
    <AppInput class="reason-field" v-model="form.note" label="退款原因（必填）" placeholder="例如：停用后退回剩余气款" :disabled="locked || !!linking" />
   </view>
   <view v-if="!linking" class="source-choice"><text class="field-label">退款来源</text><view class="source-switch"><AppButton size="sm" :disabled="locked" :kind="form.source_pending?'neutral':'primary'" @click="form.source_pending=false">从余额退回</AppButton><AppButton size="sm" :disabled="locked" :kind="form.source_pending?'primary':'neutral'" @click="form.source_pending=true">来源待核</AppButton></view></view>
   <text v-if="form.source_pending" class="warning">只登记实际退款，不猜测销售关联、不扣任何来源余额。之后从下方退款记录补关联。</text>
   <view v-else>
    <text class="source-hint">填写本次从各笔余额中退回的金额，合计须等于退款金额。</text>
    <text v-if="!sources.length">没有可退余额。已用于抵欠款的金额不能重复退款。</text>
    <view v-for="source in sources" :key="source.id" class="source"><view class="source-info"><text>{{ source.date }} · {{ source.label }} · 尾号 {{ source.id.slice(-6) }}</text><text class="muted">可退 ¥{{ money(source.available) }}</text></view><AppInput v-model="source.chosen" class="source-amount" label="本次退回（元）" placeholder="0.00" type="digit" :disabled="locked" /></view>
   </view>
   <view v-if="preview" class="preview"><text>本次实际退款 ¥{{ money(preview.value.amount) }} · {{ preview.value.biz_date }}</text><text v-for="item in preview.changes" :key="item.id">来源 {{ item.id.slice(-6) }}：退款后剩余 ¥{{ money(item.after.unallocated_amount) }}</text><text v-if="preview.value.source_pending">来源待核；余额尚未调整。</text></view>
   <view class="actions form-footer">
    <AppButton :disabled="busy || !!operation" @click="prepare">预览退款</AppButton>
    <AppButton v-if="preview" :disabled="busy || !!operation" kind="primary" @click="submit">{{ linking ? '确认补关联' : '确认已实际退款并登记' }}</AppButton>
    <AppButton v-if="operation" :disabled="busy" @click="queryOperation">查询保存结果</AppButton>
    <AppButton v-if="operation && retryable" :disabled="busy" @click="retry">使用原操作号重试</AppButton>
    <AppButton :disabled="busy || !!operation" kind="ghost" @click="reset">清空</AppButton>
   </view>
   <text v-if="operation" class="muted">保存结果待确认，请查询或用原操作号重试，不要另建退款。</text>
  </view>
  <view class="history-heading"><text class="title">退款记录</text><text class="muted">{{ refunds.length }} 笔</text></view>
  <view v-for="row in refunds" :key="row.id" class="refund-row"><text>{{ row.date }} · 退款 ¥{{ money(row.amount) }} · {{ row.source_status==='pending'?'来源待核':'来源已关联' }}</text><text class="muted">{{ row.note }}{{ row.voucher_ref ? ' · '+row.voucher_ref : '' }}</text><AppButton v-if="row.source_status==='pending' && canWrite" size="sm" :disabled="busy || !!operation" @click="link(row)">补关联来源</AppButton></view>
  <text v-if="ready && !refunds.length" class="muted">暂无退款登记 · 历史退款可在对账流水中查看</text>
 </view>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { refundAction } from '@/services/api/customerRefund'
import { getRoleTemplate } from '@/services/auth'
import { canPageAction } from '@/services/pageAcl'
const props=defineProps({customerId:{type:String,default:''}}),emit=defineEmits(['changed'])
const scale=ref(2)
const sources=ref([]),refunds=ref([]),busy=ref(false),ready=ref(false),issue=ref(''),preview=ref(null),operation=ref(null),retryable=ref(false),linking=ref('')
const form=reactive({amount:'',biz_date:'',payment_method:'unknown',note:'',voucher_ref:'',source_pending:false})
const channels=[{label:'待核',value:'unknown'},{label:'现金',value:'cash'},{label:'银行转账',value:'bank'},{label:'微信',value:'wechat'},{label:'支付宝',value:'alipay'},{label:'支票',value:'check'}]
const channelIndex=computed(()=>Math.max(0,channels.findIndex(x=>x.value===form.payment_method)))
const canWrite=computed(()=>['superadmin','admin','finance'].includes(getRoleTemplate())&&canPageAction('/pages/customer/statement','update'))
const locked=computed(()=>busy.value||!!operation.value)
const pendingTotal=computed(()=>refunds.value.filter(x=>x.source_status==='pending').reduce((s,x)=>s+Number(x.amount),0))
const money=x=>Number(x||0).toFixed(scale.value)
const key=()=>`customer-refund-pending:${props.customerId}`
async function api(action,data){const r=await refundAction(action,data);if(r.code!==0)throw Object.assign(Error(r.msg||'请求失败'),{code:r.code});return r.data}
function payload(){return {...form,customer_id:props.customerId,amount:Number(form.amount),link_refund_id:linking.value,sources:form.source_pending?[]:sources.value.filter(x=>Number(x.chosen)>0).map(x=>({id:x.id,amount:Number(x.chosen),version:x.version}))}}
function reset(){if(operation.value)return;Object.assign(form,{amount:'',biz_date:'',payment_method:'unknown',note:'',voucher_ref:'',source_pending:false});linking.value='';preview.value=null;sources.value.forEach(x=>x.chosen='')}
async function load(){busy.value=true;ready.value=false;issue.value='';const cid=props.customerId;try{const data=await api('listCustomerRefundsV1',{customer_id:cid});if(cid!==props.customerId)return;scale.value=data.money_scale;sources.value=data.sources.map(x=>({...x,chosen:''}));refunds.value=data.refunds;ready.value=data.complete===true}catch(e){issue.value=e.message}finally{busy.value=false}}
async function prepare(){busy.value=true;preview.value=null;issue.value='';try{preview.value=await api('previewCustomerRefundV1',payload())}catch(e){issue.value=e.message}finally{busy.value=false}}
function link(row){reset();linking.value=row.id;Object.assign(form,{amount:String(row.amount),biz_date:row.date,payment_method:row.payment_method,note:row.note,voucher_ref:row.voucher_ref||'',source_pending:false})}
async function saved(){uni.removeStorageSync(key());operation.value=null;retryable.value=false;reset();await load();emit('changed');uni.showToast({title:'退款登记已保存',icon:'success'})}
async function retry(){busy.value=true;issue.value='';try{await api('createCustomerRefundV1',operation.value);await saved()}catch(e){issue.value=e.message;if(e.code>=400 && e.code<500){uni.removeStorageSync(key());operation.value=null;preview.value=null;retryable.value=false}else retryable.value=true}finally{busy.value=false}}
async function submit(){if(!preview.value)return;const frozen=preview.value;busy.value=true;
 const answer=await new Promise(resolve=>uni.showModal({title:linking.value?'确认补关联':'确认已经实际退款',content:linking.value?'只补齐余额来源，不新增资金记录。':`确认已经退给客户 ${frozen.value.amount} 元？此操作只登记账务，不会发起银行转账。`,success:resolve}));busy.value=false;if(!answer.confirm)return
 operation.value={...frozen.value,plan_hash:frozen.plan_hash,operation_id:`refund-${Date.now()}-${Math.random().toString(36).slice(2)}`,confirm_paid:true};uni.setStorageSync(key(),operation.value);await retry()}
async function queryOperation(){busy.value=true;try{const result=await api('getCustomerRefundOperationV1',{customer_id:props.customerId,operation_id:operation.value.operation_id});if(result.status==='saved')await saved();else{retryable.value=true;issue.value='暂未找到保存记录，可使用原操作号重试。'}}catch(e){issue.value=e.message}finally{busy.value=false}}
watch(()=>[form.amount,form.biz_date,form.payment_method,form.note,form.voucher_ref,form.source_pending,JSON.stringify(sources.value.map(x=>x.chosen))],()=>{preview.value=null})
watch(()=>props.customerId,async()=>{operation.value=null;reset();operation.value=uni.getStorageSync(key())||null;retryable.value=!!operation.value;await load()},{immediate:true})
</script>
<style scoped>
.refund-panel { display:flex; flex-direction:column; gap:24rpx; width:100%; min-width:0; box-sizing:border-box; }
.refund-head { display:flex; justify-content:space-between; align-items:center; gap:16rpx; flex-wrap:wrap; font-size:24rpx; line-height:1.6; color:var(--crm-text-muted); }
.refund-panel :deep(.btn) { margin:0; flex:none; }
.refund-form { display:flex; flex-direction:column; gap:20rpx; padding:24rpx; border:1rpx solid var(--crm-border); border-radius:var(--crm-radius-sm); }
.title { display:block; font-size:28rpx; font-weight:700; color:var(--crm-text); }
.fields { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20rpx; }
.fields > * { min-width:0; }
.reason-field { grid-column:span 2; }
.field-label { font-size:24rpx; color:var(--crm-text-muted); font-weight:400; }
.payment-field { display:flex; flex-direction:column; gap:8rpx; }
.select { height:80rpx; display:flex; align-items:center; justify-content:space-between; padding:0 24rpx; border:1rpx solid var(--crm-border); border-radius:var(--crm-radius-sm); font-size:28rpx; color:var(--crm-text); }
.chevron { color:var(--crm-text-muted); }
.source-choice { display:flex; align-items:center; gap:24rpx; padding-top:20rpx; border-top:1rpx solid var(--crm-border); flex-wrap:wrap; }
.source-switch { display:flex; gap:8rpx; }
.source-hint { display:block; color:var(--crm-text-muted); font-size:24rpx; margin-bottom:16rpx; line-height:1.6; }
.source { display:grid; grid-template-columns:minmax(0,1fr) 320rpx; gap:24rpx; align-items:center; background:#f9fafb; border:1rpx solid var(--crm-border); padding:20rpx; border-radius:var(--crm-radius-sm); margin-top:16rpx; }
.source-info { font-size:28rpx; color:var(--crm-text); line-height:1.6; }
.source-info .muted { margin-top:8rpx; }
.muted { display:block; color:var(--crm-text-muted); font-size:24rpx; line-height:1.6; overflow-wrap:anywhere; }
.warning { color:#9d5e00; font-size:24rpx; line-height:1.6; }
.preview { display:flex; flex-direction:column; gap:12rpx; padding:24rpx; background:#eef6ff; border-radius:var(--crm-radius-sm); }
.actions { display:flex; align-items:center; gap:16rpx; flex-wrap:wrap; }
.form-footer { border-top:1rpx solid var(--crm-border); padding-top:20rpx; }
.history-heading { display:flex; align-items:center; gap:16rpx; margin-top:8rpx; }
.refund-row { display:flex; flex-wrap:wrap; gap:16rpx; align-items:center; border-bottom:1rpx solid var(--crm-border); padding:20rpx 0; font-size:28rpx; }
@media(max-width:720px) {
 .refund-head { align-items:flex-start; }
 .refund-form { padding:20rpx; }
 .fields { grid-template-columns:repeat(2,minmax(0,1fr)); }
 .reason-field { grid-column:1 / -1; }
 .source { grid-template-columns:minmax(0,1fr) 240rpx; }
}
@media(max-width:420px) { .fields,.source { grid-template-columns:minmax(0,1fr); } }
</style>
