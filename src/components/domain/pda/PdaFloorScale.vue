<template>
 <view class="floor-scale">
  <view class="heading"><text>蓝牙地秤</text><text>{{ snapshot.is_connected ? '已连接' : '未连接' }}</text></view>
  <view class="reading"><text class="number">{{ weight }}</text><text>kg</text></view>
  <text class="hint">显示分度：0.5 kg（App端）</text>
  <text class="hint">原始读数：{{ rawWeight }} kg</text>
  <text class="hint">{{ snapshot.error_message || '连接后查看地秤数据' }}</text>
  <view class="controls">
   <AppButton :loading="busy" :disabled="busy" @click="$emit('connect', false)">{{ snapshot.is_connected ? '重连地秤' : '连接地秤' }}</AppButton>
   <AppButton kind="outline" :disabled="busy" @click="$emit('connect', true)">更换地秤</AppButton>
   <AppButton v-if="snapshot.is_connected" kind="ghost" :disabled="busy" @click="$emit('disconnect')">断开</AppButton>
  </view>
  <AppButton v-if="snapshot.is_connected" kind="ghost" :disabled="busy" @click="showDetail = !showDetail">{{ showDetail ? '收起通信详情' : '通信详情' }}</AppButton>
  <view v-if="showDetail && snapshot.is_connected" class="details">
   <text v-if="snapshot.diagnostic_frame">原始数据：{{ snapshot.diagnostic_frame.rawHex }}</text>
   <text v-else>{{ snapshot.error_message }}</text>
   <text>已收通知：{{ snapshot.communication?.chunks || 0 }}；有效帧：{{ snapshot.communication?.validFrames || 0 }}；校验失败：{{ snapshot.communication?.checksumErrors || 0 }}</text>
   <text v-if="snapshot.communication?.lastRawHex">最近数据片段：{{ snapshot.communication.lastRawHex }}</text>
   <AppButton v-if="snapshot.communication?.lastRawHex || snapshot.diagnostic_frame" kind="outline" @click="copyRaw">复制数据</AppButton>
   <text>空秤观察期间请保持秤台空载，不要归零或标定。</text>
   <AppButton v-if="!observing" kind="outline" :disabled="busy || !snapshot.is_online" @click="startObservation">开始45分钟空秤观察</AppButton>
   <AppButton v-else kind="ghost" @click="finishObservation('手动结束')">结束空秤观察</AppButton>
  </view>
  <view v-if="observation" class="details" aria-live="off">
   <text>零点{{ observation.status }} · {{ Math.floor(observation.elapsed / 60) }}分{{ observation.elapsed % 60 }}秒</text>
   <text>原始起点 {{ fmt(observation.first) }} · 末值 {{ fmt(observation.last) }} kg</text>
   <text>最低 {{ fmt(observation.min) }} · 最高 {{ fmt(observation.max) }} kg</text>
   <text>有效采样 {{ observation.count }} · 缺测 {{ observation.missing }} · 最大有效采样间隔 {{ (observation.maxGapMs / 1000).toFixed(1) }} 秒</text>
  </view>
 </view>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { floorScaleDisplayWeight, floorZeroObservation } from '@/services/pda/floorScaleDisplay'
const props = defineProps({ snapshot: { type: Object, required: true }, busy: Boolean })
defineEmits(['connect', 'disconnect'])
const weight = computed(() => floorScaleDisplayWeight(props.snapshot))
const rawWeight = computed(() => floorScaleDisplayWeight(props.snapshot, { raw: true }))
const showDetail = ref(false)
const observation = ref(null), observing = computed(() => observation.value?.status === '观察中')
const fmt = value => Number.isFinite(value) ? value.toFixed(3) : '—'
let sampler = null, timer = null
function clearObservation() { if (timer !== null) clearInterval(timer); timer = null; sampler = null }
function finishObservation(reason) { if (sampler) observation.value = sampler.stop(reason); clearObservation() }
function sampleObservation() {
 if (!sampler) return
 observation.value = sampler.sample(props.snapshot)
 if (!observing.value) clearObservation()
}
function startObservation() {
 if (sampler || props.busy || !props.snapshot.is_online || !props.snapshot.connection_key) return
 sampler = floorZeroObservation(props.snapshot); sampleObservation()
 if (sampler) timer = setInterval(sampleObservation, 1000)
}
watch([() => props.snapshot.is_connected, () => props.snapshot.connection_key, () => props.busy], () => {
 if (sampler) { if (props.busy) finishObservation('设备操作中断'); else sampleObservation() }
})
onBeforeUnmount(clearObservation)
function copyRaw() {
 const s = props.snapshot
 const data = JSON.stringify({ status: s.error_code, frame: s.diagnostic_frame, communication: s.communication })
 uni.setClipboardData({ data })
}
</script>
<style scoped>
.floor-scale{padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#334155}.heading,.reading,.controls{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.heading{justify-content:space-between;font-weight:700}.reading{margin:8px 0}.number{font-size:36px;font-weight:800;font-variant-numeric:tabular-nums}.hint{display:block;color:#61798a;font-size:14px}.controls{margin-top:10px}.controls :deep(.btn){min-height:48px;font-size:16px}.details{display:flex;flex-direction:column;gap:8px;overflow-wrap:anywhere;font-size:14px}
</style>
