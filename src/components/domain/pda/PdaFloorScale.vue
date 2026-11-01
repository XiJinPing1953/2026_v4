<template>
 <view class="floor-scale">
  <view class="heading"><text>蓝牙地秤</text><text>{{ snapshot.is_connected ? '已连接' : '未连接' }}</text></view>
  <view class="reading"><text class="number">{{ weight }}</text><text>kg</text></view>
  <text class="hint">{{ snapshot.is_connected ? '调试读数，待设备实测后确认' : '连接后查看地秤数据' }}</text>
  <view class="controls">
   <AppButton :loading="busy" :disabled="busy" @click="$emit('connect', false)">{{ snapshot.is_connected ? '重连地秤' : '连接地秤' }}</AppButton>
   <AppButton kind="outline" :disabled="busy" @click="$emit('connect', true)">更换地秤</AppButton>
   <AppButton v-if="snapshot.is_connected" kind="ghost" :disabled="busy" @click="$emit('disconnect')">断开</AppButton>
  </view>
  <AppButton v-if="snapshot.is_connected" kind="ghost" :disabled="busy" @click="showDetail = !showDetail">{{ showDetail ? '收起通信详情' : '通信详情' }}</AppButton>
  <view v-if="showDetail && snapshot.is_connected" class="details">
   <text v-if="snapshot.diagnostic_frame">原始数据：{{ snapshot.diagnostic_frame.rawHex }}</text>
   <text v-else>等待完整数据</text>
   <AppButton v-if="snapshot.diagnostic_frame" kind="outline" @click="copyRaw">复制数据</AppButton>
  </view>
 </view>
</template>
<script setup>
import { computed, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
const props = defineProps({ snapshot: { type: Object, required: true }, busy: Boolean })
defineEmits(['connect', 'disconnect'])
const weight = computed(() => props.snapshot.is_connected && props.snapshot.is_online && props.snapshot.weight_kg != null ? Number(props.snapshot.weight_kg).toFixed(3) : '—')
const showDetail = ref(false)
function copyRaw() { if (props.snapshot.diagnostic_frame?.rawHex) uni.setClipboardData({ data: props.snapshot.diagnostic_frame.rawHex }) }
</script>
<style scoped>
.floor-scale{padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#334155}.heading,.reading,.controls{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.heading{justify-content:space-between;font-weight:700}.reading{margin:8px 0}.number{font-size:36px;font-weight:800;font-variant-numeric:tabular-nums}.hint{display:block;color:#61798a;font-size:14px}.controls{margin-top:10px}.controls :deep(.btn){min-height:48px;font-size:16px}.details{display:flex;flex-direction:column;gap:8px;overflow-wrap:anywhere;font-size:14px}
</style>
