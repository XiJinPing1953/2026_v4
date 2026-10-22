<template>
	<AppPage class="pda-compact-page" title="复秤记录" subtitle="查已保存的称重记录" icon="bottle" hideBottleQuery>
		<view class="top-row">
			<AppButton kind="neutral" size="sm" @click="$emit('back')">返回首页</AppButton>
			<text class="hint">{{ scannerReady ? '可按扫描键查询钢瓶' : '可输入瓶号查询' }}</text>
		</view>
		<AppSection title="查询条件">

			<view class="filter-grid">
				<picker mode="date" :value="date" @change="setFilter('date', $event.detail.value)">
					<AppInput label="记录日期" :model-value="date" readonly />
				</picker>
				<picker mode="selector" :range="types" range-key="label" :value="typeIndex" @change="changeType">
					<AppInput label="复秤类型" :model-value="typeLabel" readonly />
				</picker>
			</view>
			<view class="bottle-row">
				<PdaBottleInput class="bottle-input" label="瓶号" :model-value="bottleNo" placeholder="不填瓶号可查当天全部" @update:model-value="setFilter('bottle', $event)" @confirm="search()" />
				<AppButton @click="search()">查询</AppButton>
			</view>
			<picker v-if="rounds.length" mode="selector" :range="roundOptions" range-key="label" :value="roundIndex" @change="changeRound">
				<AppInput label="历史轮次" :model-value="roundOptions[roundIndex].label" readonly />
			</picker>
			<text v-if="type === 'filling'" class="hint">历史轮次仅包含本机本账号保留的记录；日期查询查看云端记录。</text>
		</AppSection>
		<AppSection :title="typeLabel + '记录'">
			<template #actions><text class="hint">{{ summary ? `${summary.bottle_count} 瓶 · ${summary.record_count} 条记录` : '总数待查询' }}</text></template>
			<view v-if="type === 'filling'" class="print-controls">
				<text>{{ printer.status.value }}</text>
				<AppButton kind="neutral" :disabled="printer.connecting.value || batchBusy" @click="printer.connect">连接打印机</AppButton>
				<AppButton v-if="roundId && rows.length" :disabled="loading || batchBusy || printer.busy.value" @click="printRound">打印本轮 {{ rows.length }} 张</AppButton>
				<AppButton v-if="batchBusy" kind="neutral" @click="stopBatch">停止打印</AppButton>
				<text v-if="batchMessage" class="hint">{{ batchMessage }}</text>
			</view>
			<text v-if="historyError && type === 'filling'" class="error">{{ historyError }}</text>
			<text v-if="error" class="error">{{ error }}</text>
			<text v-else-if="!loading && !rows.length" class="hint">暂无符合条件的记录</text>
			<view v-for="item in rows" :key="item.id" class="record">
				<view class="record-head"><text class="bottle">{{ item.bottle_no }} 号瓶</text><text class="hint">{{ item.status === 'complete' ? '已完成' : item.status === 'pending' ? '处理中' : '待核对' }}</text></view>
				<text class="record-time">{{ item.time_label || '称重时间' }} {{ item.weighed_at || '时间未记录' }}</text>
				<view class="weights">
					<text>毛重 {{ formatWeight(item.gross_weight) }} kg</text>
					<text>皮重 {{ formatWeight(item.tare_weight) }} kg</text>
					<text>净重 {{ formatWeight(item.net_weight) }} kg</text>
					<text v-if="type === 'filling'">罐装量 {{ formatWeight(item.fill_weight) }} kg</text>
				</view>
				<template v-if="type === 'filling'">
					<AppButton v-if="printEntry(item) && !printer.reason(printEntry(item))" kind="neutral" :disabled="batchBusy || printer.busy.value" @click="printer.reprint(printEntry(item))">补打标签</AppButton>
					<text v-else class="hint">缺少原标签资料或记录已更正，不能补打</text>
					<text class="hint">{{ printer.messages.value[printEntry(item)?.operationId] || '' }}</text>
				</template>
			</view>
			<text v-if="loading" class="hint">正在查询…</text>
			<AppButton v-if="hasMore" kind="neutral" :disabled="loading" @click="loadMore">加载更多</AppButton>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import PdaBottleInput from './PdaBottleInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import { formatWeight } from '@/services/pda/shared'
import { usePdaReweighRecords } from '@/composables/pda/usePdaReweighRecords'

import { historyPrintEntry } from '@/services/pda/reweighHistory'
import { usePdaFillingPrinter } from '@/composables/pda/usePdaFillingPrinter'
defineEmits(['back'])
const form = usePdaReweighRecords()
const { historyError, summary, rounds, roundId, pageActive, types, type, typeLabel, date, bottleNo, rows, loading, scannerReady, error, hasMore, setFilter, search, loadMore } = form
const typeIndex = computed(() => Math.max(0, types.value.findIndex(item => item.value === type.value)))
function changeType(event) { setFilter('type', types.value[Number(event.detail.value)]?.value) }
const printEntry = historyPrintEntry
const printer = usePdaFillingPrinter({ enabled: true, active: () => pageActive.value && type.value === 'filling', entries: () => rows.value.map(printEntry).filter(Boolean) })
const roundOptions = computed(() => [{ id: '', label: '按日期查询全部' }, ...rounds.value.map(item => ({ id: item.id, label: `${item.first_time || '时间未记录'} · ${item.bottle_count} 瓶${type.value === 'return' ? '（所选日期）' : ''}` }))])
const roundIndex = computed(() => Math.max(0, roundOptions.value.findIndex(item => item.id === roundId.value)))
function changeRound(event) { setFilter('round', roundOptions.value[Number(event.detail.value)]?.id); void search() }
const batchBusy = ref(false), batchMessage = ref('')
let batchVersion = 0
function stopBatch() { batchVersion++; printer.close(); batchMessage.value = '已停止；已发送的标签请查看出纸' }
async function printRound() {
 if (batchBusy.value || printer.busy.value || !roundId.value || !rows.value.length) return
 const items = rows.value.map(printEntry)
 if (items.some(item => !item || printer.reason(item))) { batchMessage.value = '部分记录不能补打，请逐条查看'; return }
 if (!printer.connected.value) { batchMessage.value = '请先连接打印机'; return }
 const version = ++batchVersion
 batchBusy.value = true
 try {
  const result = await new Promise(resolve => uni.showModal({ title: '打印本轮标签', content: `将连续发送 ${items.length} 张标签，请准备好打印纸。`, success: resolve, fail: () => resolve({ confirm: false }) }))
  if (!result.confirm || version !== batchVersion || !pageActive.value) return
  let sent = 0
  for (const entry of items) {
   if (version !== batchVersion || !pageActive.value) break
   if (!await printer.reprint(entry)) { batchMessage.value = `已停止，已发送 ${sent} 张；请查看出纸和本条提示后再补打`; break }
   sent++; batchMessage.value = `已发送 ${sent}/${items.length} 张，请查看出纸`
  }
 } finally { batchBusy.value = false }
}
watch([date, type, bottleNo, roundId], () => { stopBatch(); batchMessage.value = '' })
function activate() { return form.activate() }
function deactivate() { stopBatch(); return form.deactivate() }
defineExpose({ activate, deactivate })
</script>

<style scoped>
.print-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12rpx; margin-bottom: 12rpx; }
.top-row, .record-head { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.filter-grid, .weights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12rpx; }
.bottle-row { display: flex; align-items: flex-end; gap: 12rpx; margin-top: 12rpx; }
.bottle-input { flex: 1; min-width: 0; }
.hint { font-size: 16px; color: var(--crm-text-muted); }
.error { font-size: 16px; color: #b42318; }
.record { padding: 14rpx 0; border-bottom: 1rpx solid var(--crm-border); }
.bottle { font-size: 18px; font-weight: 700; }
.record-time { display: block; margin: 8rpx 0; font-size: 16px; font-weight: 700; }
.weights { font-size: 16px; color: var(--crm-text-muted); }
</style>
<style scoped lang="scss">
@import './pdaCompact.scss';
</style>
