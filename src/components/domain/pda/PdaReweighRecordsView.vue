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
		</AppSection>
		<AppSection :title="typeLabel + '记录'">
			<template #actions><text class="hint">已加载 {{ rows.length }} 条</text></template>
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
			</view>
			<text v-if="loading" class="hint">正在查询…</text>
			<AppButton v-if="hasMore" kind="neutral" :disabled="loading" @click="loadMore">加载更多</AppButton>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { computed } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import PdaBottleInput from './PdaBottleInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import { formatWeight } from '@/services/pda/shared'
import { usePdaReweighRecords } from '@/composables/pda/usePdaReweighRecords'

defineEmits(['back'])
const { types, type, typeLabel, date, bottleNo, rows, loading, scannerReady, error, hasMore, setFilter, search, loadMore, activate, deactivate } = usePdaReweighRecords()
const typeIndex = computed(() => Math.max(0, types.value.findIndex(item => item.value === type.value)))
function changeType(event) { setFilter('type', types.value[Number(event.detail.value)]?.value) }
defineExpose({ activate, deactivate })
</script>

<style scoped>
.top-row, .record-head { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.filter-grid, .weights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12rpx; }
.bottle-row { display: flex; align-items: flex-end; gap: 12rpx; margin-top: 12rpx; }
.bottle-input { flex: 1; min-width: 0; }
.hint { font-size: 14px; color: var(--crm-text-muted); }
.error { font-size: 16px; color: #b42318; }
.record { padding: 14rpx 0; border-bottom: 1rpx solid var(--crm-border); }
.bottle { font-size: 18px; font-weight: 700; }
.record-time { display: block; margin: 8rpx 0; font-size: 16px; font-weight: 700; }
.weights { font-size: 16px; color: var(--crm-text-muted); }
</style>
<style scoped lang="scss">
@import './pdaCompact.scss';
</style>
