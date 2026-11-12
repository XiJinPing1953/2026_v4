<template>
 <view class="floor-scale">
  <view class="heading"><text>地秤毛重</text><text>{{ snapshot.is_connected ? (snapshot.is_online ? '已连接' : '等待读数') : '未连接' }}</text></view>
  <view class="reading"><text class="number">{{ weight }}</text><text>kg</text></view>
  <text v-if="snapshot.boot_zero_state" class="hint">{{ snapshot.error_message }}</text>
  <view class="controls">
   <AppButton v-if="!snapshot.is_connected" :loading="busy" :disabled="busy" @click="$emit('connect', false)">连接地秤</AppButton>
   <AppButton kind="ghost" :disabled="busy" @click="showConnection = !showConnection">连接设置</AppButton>
  </view>
  <view v-if="showConnection" class="controls">
   <AppButton kind="outline" :disabled="busy" @click="$emit('connect', true)">选择地秤</AppButton>
   <AppButton v-if="snapshot.is_connected" kind="ghost" :disabled="busy" @click="$emit('disconnect')">断开连接</AppButton>
  </view>
 </view>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { floorScaleDisplayWeight } from '@/services/pda/floorScaleDisplay'
const props = defineProps({ snapshot: { type: Object, required: true }, busy: Boolean, active: { type: Boolean, default: true } })
defineEmits(['connect', 'disconnect'])
const showConnection = ref(false)
const weight = computed(() => floorScaleDisplayWeight(props.snapshot))
watch(() => props.active, active => { if (!active) showConnection.value = false })
</script>
<style scoped>
.floor-scale{padding:14px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#334155}.heading,.reading,.controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.heading{justify-content:space-between;font-size:14px}.reading{align-items:baseline;margin:8px 0}.number{font-size:46px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.2}.hint{display:block;color:#526773;font-size:13px;line-height:1.5;margin-top:8px}.controls{margin-top:10px}.controls :deep(.btn){min-height:44px;font-size:16px}
</style>
