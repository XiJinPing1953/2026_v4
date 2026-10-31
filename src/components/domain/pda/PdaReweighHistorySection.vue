<template>
 <AppSection :class="['history-panel', !expanded && 'history-panel--closed']" :title="title + ' ' + items.length + ' 条'">
  <template #actions><AppButton size="sm" kind="ghost" @click="toggle">{{ expanded ? '收起 ⌃' : '展开 ⌄' }}</AppButton></template>
  <template v-if="expanded">
   <view class="history-page-start" />
   <view v-for="item in displayItems" :key="item.operationId" class="history-row">
    <text>{{ item.bottleNo }} 号瓶 · {{ isReturn ? '回瓶毛重' : '本次灌装量' }} {{ item.weightText }} kg</text>
    <text :class="['hint', !item.saved && 'pending']">{{ item.receiptText }}</text>
    <view v-if="!isReturn && item.saved" class="print-result">
     <text v-if="printer.messages.value[item.operationId]">{{ printer.messages.value[item.operationId] }}</text>
     <text v-if="item.printReason" class="hint">{{ item.printReason }}</text>
     <AppButton v-else kind="outline" :disabled="printer.busy.value" @click="reprint(item.operationId)">补打标签</AppButton>
    </view>
    <text class="history-time">{{ item.timeText }}</text>
    <text v-if="!item.saved" class="hint">{{ item.message }}</text>
    <view v-if="!item.saved" class="actions">
     <AppButton size="sm" kind="neutral" :disabled="busy" @click="$emit('query', item.operationId)">查询状态</AppButton>
     <AppButton size="sm" kind="neutral" :disabled="busy" @click="$emit('query', item.operationId, true)">重试处理</AppButton>
    </view>
   </view>

   <view v-if="pageCount > 1" class="history-pager">
    <AppButton size="sm" kind="outline" :disabled="currentPage <= 1" @click="changePage(currentPage - 1)">上一页</AppButton>
    <text class="hint">{{ currentPage }} / {{ pageCount }} 页</text>
    <AppButton size="sm" kind="outline" :disabled="currentPage >= pageCount" @click="changePage(currentPage + 1)">下一页</AppButton>
   </view>
  </template>
 </AppSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSection from '@/components/base/AppSection.vue'
import { useRecordPageScroll } from '@/composables/pda/useRecordPageScroll'
import { reweighHistoryTime } from '@/services/pda/reweighDraft'

const props = defineProps({ title: String, items: { type: Array, required: true }, isReturn: Boolean, busy: Boolean, printer: { type: Object, required: true } })
defineEmits(['query'])
const scrollToRecords = useRecordPageScroll('.history-page-start')
function changePage(value) { page.value = value; void scrollToRecords() }
const PAGE_SIZE = 10
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
const receiptTitle = receipt => receipt?.saved ? '已保存' : '还没确认是否保存成功'
// Keep formatting/label validation out of unrelated busy/message rerenders.
const displayItems = computed(() => visibleItems.value.map(item => ({
 operationId: item.operationId, bottleNo: item.bottleNo,
 weightText: weight(props.isReturn ? item.grossWeight : item.preview?.fill_weight),
 receiptText: receiptTitle(item.receipt), complete: Boolean(item.receipt?.complete), saved: Boolean(item.receipt?.saved),
 timeText: reweighHistoryTime(item), message: item.receipt?.message || '',
 printReason: !props.isReturn && item.receipt?.saved ? props.printer.reason(item) : ''
})))
function reprint(id) { const entry = visibleItems.value.find(item => item.operationId === id); if (entry) return props.printer.reprint(entry) }
</script>

<style scoped>
.history-panel { border:1px solid #cbd5e1; border-radius:8px; }
.history-panel.history-panel :deep(.section__header) { padding:6px 12px; }
.history-panel--closed.history-panel :deep(.section__header) { border-bottom:0; }
.history-panel--closed :deep(.section__body) { display:none; }
.history-panel :deep(.btn) { min-height:48px; font-size:16px; }
.history-pager { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; }
.history-pager :deep(.btn) { padding:0 12px; }
.history-row { padding:12px 0; border-bottom:1px solid #e2e8f0; font-size:16px; }
.history-row:last-child { border-bottom:0; }
.hint { display:block; color:var(--crm-text-muted); font-size:14px; line-height:1.6; }
.pending { color:#9a3412; }
.history-time { display:block; margin-top:4px; font-weight:700; }
.print-result { display:flex; flex-direction:column; gap:8px; margin:12px 0; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0; }
</style>
