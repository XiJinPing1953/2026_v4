<template>
 <view class="app-update">
  <text class="version" @longpress="togglePerformance">版本 {{ version || '—' }}</text>
  <button class="check" :disabled="busy" @click="check">{{ busy ? '检查中…' : '检查更新' }}</button>
 </view>
</template>
<script setup>
import { startPerformanceSession, stopPerformanceSession, performanceSessionActive } from '@/services/performanceTrace'
import { ref, onMounted } from 'vue'
import { readPdaAppVersion, checkPdaAppUpdate } from '@/services/pda/appUpdate'
const version = ref(''), busy = ref(false)
onMounted(async () => { try { version.value = (await readPdaAppVersion()).resource } catch (_) {} })
async function togglePerformance() {
 if (performanceSessionActive()) { stopPerformanceSession(); uni.showToast({ title: '性能采样已停止', icon: 'none' }); return }
 const result = await new Promise(resolve => uni.showModal({ title: '页面性能采样', content: '记录页面、网络及数据库耗时，10分钟后自动停止。不记录瓶号、客户资料或登录凭据。', confirmText: '开始采样', success: resolve, fail: () => resolve({ confirm: false }) }))
 if (result.confirm) { startPerformanceSession(); uni.showToast({ title: '性能采样已开始', icon: 'none' }) }
}
async function check() { if (busy.value) return; busy.value = true; try { await checkPdaAppUpdate() } finally { busy.value = false } }
</script>
<style scoped>
.app-update { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 4px; }
.version { color:var(--crm-text-secondary); font-size:14px; }
.check { margin:0; background:transparent; color:var(--crm-primary); font-size:16px; min-height:48px; line-height:48px; padding:0 10px; }
.check::after { border:none; }
</style>
