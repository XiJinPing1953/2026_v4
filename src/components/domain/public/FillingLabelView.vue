<template>
 <view class="label-page">
  <text class="company">新拓能源</text>
  <text v-if="error" class="warning">{{ error }}</text>
  <template v-else-if="record">
   <text v-if="!record.valid" class="warning">此标签已有变更，请核对最新充装信息</text>
   <text class="bottle">{{ record.bottle_no }} 号瓶</text>
   <view v-for="item in weights" :key="item.key" class="line"><text>{{ item.name }}</text><text>{{ Number(record[item.key]).toFixed(1) }} kg</text></view>
   <view class="line"><text>充装人员</text><text>{{ record.operator || '未记录' }}</text></view>
   <view class="line"><text>充装时间</text><text>{{ record.weighed_at || '未记录' }}</text></view>
  </template>
  <text v-else>正在查询充装信息…</text>
 </view>
</template>
<script setup>
import { ref, watch } from 'vue'
import { getPublicFillingLabel } from '@/services/pda/fillingLabel'
const props = defineProps({ token:String }), record = ref(null), error = ref('')
const weights = [{ key:'tare_weight', name:'皮重' }, { key:'gross_weight', name:'毛重' }, { key:'net_weight', name:'净重' }]
let epoch = 0
watch(() => props.token, async token => {
 const version = ++epoch; record.value = null; error.value = ''
 if (!token) return
 try { const result = await getPublicFillingLabel(token); if (version !== epoch) return; if (result.code !== 0) throw new Error(result.msg || '标签暂不可用'); record.value = result.data }
 catch (cause) { if (version === epoch) error.value = cause.message || '查询失败，请稍后重试' }
}, { immediate:true })
</script>
<style scoped>
.label-page{max-width:480px;margin:0 auto;padding:32px 24px;display:flex;flex-direction:column;gap:20px;background:white;min-height:100vh;box-sizing:border-box;font-size:18px;color:#17232e}.company{font-size:28px;font-weight:700}.bottle{font-size:24px;font-weight:700}.line{display:flex;justify-content:space-between;gap:16px;line-height:1.6}.warning{color:#b42318;font-size:16px;line-height:1.6}
</style>
