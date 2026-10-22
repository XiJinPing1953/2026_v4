<template>
 <view :class="['pda-scale', 'pda-scale--' + status.tone]">
  <view class="reading"><text class="number">{{ weight }}</text><text>kg</text><text class="status" role="status">{{ status.text }}</text></view>
  <AppButton v-if="snapshot.is_connected && !connectionIssue" kind="ghost" :disabled="busy || disabled" @click="settings = !settings">吊秤设置 {{ settings ? '收起' : '展开' }}</AppButton>
  <view v-if="!snapshot.is_connected || connectionIssue || settings" class="controls">
   <AppButton :loading="busy" :disabled="busy || disabled" @click="$emit('connect', false)">{{ snapshot.is_connected ? '重连吊秤' : '连接吊秤' }}</AppButton>
   <AppButton kind="outline" :disabled="busy || disabled" @click="$emit('connect', true)">更换吊秤</AppButton>
   <AppButton v-if="snapshot.is_connected" kind="ghost" :disabled="busy || disabled" @click="$emit('disconnect')">断开</AppButton>
  </view>
 </view>
</template>
<script setup>
import { computed, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { pdaWeighStatus } from '@/services/pda/weighStatus'
const props = defineProps({ snapshot: { type: Object, required: true }, selected: Boolean, captured: Boolean, gross: { default: null }, tare: { default: null }, positiveNet: Boolean, minimumWeight: { type: Number, default: 0 }, busy: Boolean, disabled: Boolean })
defineEmits(['connect', 'disconnect'])
const settings = ref(false)
const status = computed(() => pdaWeighStatus(props.snapshot, props))
const connectionIssue = computed(() => props.snapshot.is_connected && props.snapshot.error_code && !['waiting_stable'].includes(props.snapshot.error_code))
const weight = computed(() => props.snapshot.is_connected && props.snapshot.is_online && props.snapshot.weight_kg != null ? Number(props.snapshot.weight_kg).toFixed(1) : '—')
</script>
<style scoped>
.pda-scale { padding: 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #f8fafc; color: #334155; font-size: 16px; }
.pda-scale--warning { background: #fff1f2; border-color: #fda4af; color: #9f1239; }
.pda-scale--ready { background: #ecfdf3; border-color: #86d3a2; color: #166534; }
.reading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.number { font-size: 36px; font-weight: 800; font-variant-numeric: tabular-nums; }
.status { flex: 1; min-width: 80px; text-align: right; font-weight: 700; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.pda-scale :deep(.btn) { min-height: 48px; font-size: 16px; }
</style>
