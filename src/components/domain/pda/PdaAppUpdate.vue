<template>
 <view class="app-update">
  <text class="version">版本 {{ version || '—' }}</text>
  <button class="check" :disabled="busy" @click="check">{{ busy ? '检查中…' : '检查更新' }}</button>
 </view>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import { readPdaAppVersion, checkPdaAppUpdate } from '@/services/pda/appUpdate'
const version = ref(''), busy = ref(false)
onMounted(async () => { try { version.value = (await readPdaAppVersion()).resource } catch (_) {} })
async function check() { if (busy.value) return; busy.value = true; try { await checkPdaAppUpdate() } finally { busy.value = false } }
</script>
<style scoped>
.app-update { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 4px; }
.version { color:var(--crm-text-secondary); font-size:12px; }
.check { margin:0; background:transparent; color:var(--crm-primary); font-size:14px; min-height:44px; line-height:44px; padding:0 10px; }
.check::after { border:none; }
</style>
