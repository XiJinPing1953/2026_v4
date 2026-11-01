<template>
 <AppSection title="地秤校准">
  <text class="hint">按空秤归零、标准砝码标定、复核的顺序操作。</text>
  <text v-if="error || state.error" class="notice" role="alert">{{ error || state.error }}</text>
  <text v-if="!snapshot.is_connected" class="notice">请先连接原地秤。</text>
  <text v-else-if="!snapshot.can_calibrate" class="notice">未发现校准写入接口，请核对设备型号。</text>
  <view v-if="state.pending" class="pending">
   <text class="heading">{{ state.pending.kind === 'zero' ? '空秤归零' : '砝码标定' }} · 待现场核对</text>
   <text v-if="state.pending.kind === 'mass'">标准砝码：{{ state.pending.grams / 1000 }} kg</text>
   <text v-if="state.pending.needsReconnect">发送结果不明确，请先断开并重新连接原地秤，再核对。</text>
   <text v-else>指令已提交；请检查实际秤值，提交并不代表校准成功。</text>
   <view class="actions"><AppButton :disabled="disabled || state.running" @click="$emit('resolve', true)">已核对，结果正常</AppButton><AppButton kind="outline" :disabled="disabled || state.running" @click="$emit('resolve', false)">核对后发现异常</AppButton></view>
  </view>
  <template v-else>
   <view class="step"><text class="heading">第一步：空秤归零</text><text>清空秤台，等待读数稳定。</text>
    <AppButton :disabled="disabled || state.running || !snapshot.can_calibrate || Boolean(state.error)" @click="$emit('zero')">确认空秤并归零</AppButton>
   </view>
   <view class="step"><text class="heading">第二步：标准砝码标定</text><text>放上标准砝码，输入砝码总重量。</text>
    <view class="mass"><input v-model="mass" type="digit" placeholder="输入砝码重量" :disabled="disabled || state.running" /><text>kg</text></view>
    <text v-if="state.zeroFor !== snapshot.device_id" class="hint">请先完成当前地秤的空秤归零复核。</text>
    <AppButton :disabled="disabled || state.running || !snapshot.can_calibrate || !validMass || !state.zeroFor || state.zeroFor !== snapshot.device_id || Boolean(state.error)" @click="$emit('mass', mass)">确认砝码并标定</AppButton>
   </view>
   <view class="step"><text class="heading">第三步：复核</text><text>分别检查砝码读数和移走砝码后的零点。</text>
    <text v-if="state.lastVerified?.kind === 'mass' && !state.requiresReview" class="hint">已记录上次现场复核；每次重新校准仍需从空秤归零开始。</text>
    <text v-else-if="state.requiresReview" class="notice">校准尚未完成复核，不能用于业务称重。</text>
   </view>
  </template>
  <AppButton kind="ghost" :disabled="state.running" @click="$emit('close')">返回地秤复秤</AppButton>
 </AppSection>
</template>
<script setup>
import { computed, ref } from 'vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import { floorScaleKilogramsToGrams } from '@/services/pda/floorScaleCalibration'
defineProps({ snapshot: { type: Object, required: true }, state: { type: Object, required: true }, error: { type: String, default: '' }, disabled: Boolean })
defineEmits(['zero', 'mass', 'resolve', 'close'])
const mass = ref('')
const validMass = computed(() => { try { floorScaleKilogramsToGrams(mass.value); return true } catch (_) { return false } })
</script>
<style scoped>
.hint{display:block;color:#61798a;font-size:14px;line-height:1.6}.notice,.pending{display:block;background:#fff7ed;color:#9a3412;padding:12px;border-radius:8px;line-height:1.6}.pending,.step{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin:12px 0;padding:12px;border:1px solid #dce5ea;border-radius:8px}.pending{border-color:#fdba74}.heading{font-size:18px;font-weight:700}.actions{display:flex;flex-wrap:wrap;gap:8px}.mass{display:flex;gap:10px;align-items:center}.mass input{width:180px;min-height:48px;padding:8px;border:1px solid #aebfc8;border-radius:8px;font-size:18px}.step :deep(.btn),.pending :deep(.btn){min-height:48px}
</style>
