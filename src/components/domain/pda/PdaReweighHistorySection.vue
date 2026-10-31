<template>
 <AppSection :class="['history-panel', !expanded && 'history-panel--closed']" :title="title + ' ' + items.length + ' 条'">
  <template #actions><AppButton size="sm" kind="ghost" @click="toggle">{{ expanded ? '收起 ⌃' : '展开 ⌄' }}</AppButton></template>
  <template v-if="expanded">
   <view v-if="pageCount > 1" class="history-pager">
    <AppButton size="sm" kind="outline" :disabled="currentPage <= 1" @click="page = currentPage - 1">上一页</AppButton>
    <text class="hint">{{ currentPage }} / {{ pageCount }} 页</text>
    <AppButton size="sm" kind="outline" :disabled="currentPage >= pageCount" @click="page = currentPage + 1">下一页</AppButton>
   </view>
   <view v-for="item in visibleItems" :key="item.operationId" class="history-row">
    <text>{{ item.bottleNo }} 号瓶 · {{ isReturn ? '回瓶毛重' : '本次灌装量' }} {{ weight(isReturn ? item.grossWeight : item.preview?.fill_weight) }} kg</text>
    <text :class="['hint', !item.receipt?.complete && 'pending']">{{ receiptTitle(item.receipt) }}</text>
    <view v-if="!isReturn && item.receipt?.saved" class="print-result">
     <text v-if="printer.messages.value[item.operationId]">{{ printer.messages.value[item.operationId] }}</text>
     <text v-if="printer.reason(item)" class="hint">{{ printer.reason(item) }}</text>
     <AppButton v-else kind="outline" :disabled="printer.busy.value" @click="printer.reprint(item)">补打标签</AppButton>
    </view>
    <text class="history-time">{{ reweighHistoryTime(item) }}</text>
    <text v-if="!item.receipt?.complete" class="hint">{{ item.receipt?.message }}</text>
    <view v-if="!item.receipt?.complete" class="actions">
     <AppButton size="sm" kind="neutral" :disabled="busy" @click="$emit('query', item.operationId)">查询状态</AppButton>
     <AppButton size="sm" kind="neutral" :disabled="busy" @click="$emit('query', item.operationId, true)">重试处理</AppButton>
    </view>
   </view>
  </template>
 </AppSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSection from '@/components/base/AppSection.vue'
import { reweighHistoryTime } from '@/services/pda/reweighDraft'

const props = defineProps({ title: String, items: { type: Array, required: true }, isReturn: Boolean, busy: Boolean, printer: { type: Object, required: true } })
defineEmits(['query'])
const PAGE_SIZE = 20
const expanded = ref(false), page = ref(1)
const pageCount = computed(() => Math.max(1, Math.ceil(props.items.length / PAGE_SIZE)))
const currentPage = computed(() => Math.max(1, Math.min(page.value, pageCount.value)))
// Slice only this page before reversing; the complete history stays with the form.
const visibleItems = computed(() => {
 if (!expanded.value) return []
 const end = Math.max(0, props.items.length - (currentPage.value - 1) * PAGE_SIZE)
 return props.items.slice(Math.max(0, end - PAGE_SIZE), end).reverse()
})
function toggle() { page.value = 1; expanded.value = !expanded.value }
const weight = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1)
const receiptTitle = receipt => receipt?.complete ? '已保存' : receipt?.saved ? '记录已保存，还有信息待核对' : '还没确认是否保存成功'
</script>

<style scoped>
.history-panel { border:1px solid #cbd5e1; border-radius:8px; }
.history-panel.history-panel :deep(.section__header) { padding:6px 12px; }
.history-panel--closed.history-panel :deep(.section__header) { border-bottom:0; }
.history-panel--closed :deep(.section__body) { display:none; }
.history-panel :deep(.btn) { min-height:48px; font-size:16px; }
.history-pager { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.history-pager :deep(.btn) { padding:0 12px; }
.history-row { padding:12px 0; border-bottom:1px solid #e2e8f0; font-size:16px; }
.history-row:last-child { border-bottom:0; }
.hint { display:block; color:var(--crm-text-muted); font-size:14px; line-height:1.6; }
.pending { color:#9a3412; }
.history-time { display:block; margin-top:4px; font-weight:700; }
.print-result { display:flex; flex-direction:column; gap:8px; margin:12px 0; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0; }
</style>
