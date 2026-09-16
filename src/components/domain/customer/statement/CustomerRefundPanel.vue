<template>
 <view class="refund-panel">
  <view class="refund-head"><text>登记已经实际退给客户的钱。退押金请使用“押金”入口。</text><AppButton size="sm" kind="ghost" :disabled="busy || !!operation" @click="load">刷新</AppButton></view>
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
.refund-panel { width:100%; max-width:1120px; box-sizing:border-box; padding:20px 24px; display:flex; flex-direction:column; gap:18px; color:#263445; font-size:14px; }
.refund-head { display:flex; justify-content:space-between; align-items:center; gap:16px; color:#697586; font-size:13px; }
.refund-panel :deep(.btn) { margin:0; flex:none; height:36px; padding:0 16px; font-size:13px; border-radius:6px; }
.refund-form { display:flex; flex-direction:column; gap:20px; padding:22px; border:1px solid #e2e7ee; border-radius:10px; background:#fff; }
.title { font-size:15px; font-weight:600; color:#243247; }
.fields { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px 20px; }
.fields > * { min-width:0; }
.reason-field { grid-column:span 2; }
.refund-panel :deep(.field) { gap:7px; }
.refund-panel :deep(.field__label), .field-label { font-size:12px; line-height:18px; color:#64748b; }
.refund-panel :deep(.field__control) { box-sizing:border-box; height:40px; min-height:40px; padding:0 12px; border:1px solid #d7dfe8; border-radius:6px; }
.refund-panel :deep(.field__input) { font-size:14px; }
.payment-field { display:flex; flex-direction:column; gap:7px; }
.select { height:40px; box-sizing:border-box; display:flex; align-items:center; justify-content:space-between; padding:0 12px; border:1px solid #d7dfe8; border-radius:6px; font-size:14px; }
.chevron { color:#94a3b8; }
.source-choice { display:flex; align-items:center; gap:18px; padding-top:18px; border-top:1px solid #edf0f4; }
.source-switch { display:flex; gap:4px; padding:3px; background:#f1f4f8; border-radius:7px; }
.source-switch :deep(.btn) { height:32px; padding:0 14px; border-color:transparent; background:transparent; color:#66758b; }
.source-switch :deep(.btn--primary) { background:#fff; color:#0877cd; box-shadow:0 1px 4px #24324718; }
.source-hint { display:block; color:#758297; font-size:12px; margin-bottom:10px; line-height:1.6; }
.source { display:grid; grid-template-columns:minmax(0,1fr) 180px; gap:24px; align-items:center; background:#f8fafc; border:1px solid #e7ecf2; padding:14px 16px; border-radius:8px; margin-top:8px; }
.source-info { font-size:13px; line-height:1.6; }
.source-info .muted { margin-top:4px; }
.muted { display:block; color:#8390a2; font-size:12px; line-height:1.6; }
.warning { color:#966014; background:#fff8eb; padding:12px 14px; border-radius:6px; font-size:13px; line-height:1.6; }
.preview { display:flex; flex-direction:column; gap:8px; padding:14px 16px; background:#edf6ff; border-radius:8px; font-size:13px; }
.actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.form-footer { border-top:1px solid #edf0f4; padding-top:18px; }
.history-heading { display:flex; align-items:center; gap:10px; margin-top:8px; }
.refund-row { display:flex; flex-wrap:wrap; gap:12px; align-items:center; border-bottom:1px solid #edf0f4; padding:12px 0; font-size:13px; }
@media(max-width:680px) {
 .refund-panel { padding:12px 0; }
 .refund-head { align-items:flex-start; }
 .refund-form { padding:16px; }
 .fields { grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 12px; }
 .reason-field { grid-column:1 / -1; }
 .source { grid-template-columns:minmax(0,1fr) 130px; gap:12px; padding:12px; }
}
@media(max-width:400px) { .fields { grid-template-columns:1fr; } .source { grid-template-columns:1fr; } }
</style>
