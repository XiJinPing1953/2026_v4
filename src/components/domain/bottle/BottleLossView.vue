<template>
	<AppPage title="理论损耗统计" subtitle="按 回瓶 + 灌装 - 出瓶 计算" icon="chart">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch(false)">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="总损耗" :value="summary.loss_total_kg" hint="kg" icon="alert" />
				<AppStatCard class="summary-card" label="总胀重" :value="summary.swell_total_kg" hint="kg" icon="plus" />
				<AppStatCard class="summary-card" label="完整周期" :value="summary.cycle_count" hint="轮" icon="list" />
				<AppStatCard class="summary-card" label="链路不完整" :value="summary.incomplete_count" hint="条" icon="bottle" />
			</view>
		</template>

		<view class="view-body">
			<AppSection title="筛选条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>
				<view class="filter-grid">
					<AppInput v-model="filters.bottle_no" label="瓶号" placeholder="输入瓶号" prefix-icon="search" size="sm" />
					<picker class="picker-block" mode="date" @change="(e) => (filters.dateStart = e.detail.value)">
						<AppInput :model-value="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="(e) => (filters.dateEnd = e.detail.value)">
						<AppInput :model-value="filters.dateEnd" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
				</view>
			</AppSection>

			<AppSection title="周期明细">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>
				<AppList :loading="loading" :empty="list.length === 0" :empty-title="mainEmptyTitle">
					<AppListItem
						v-for="(item, index) in list"
						:key="item.source_out_id || `${item.out_date || '-'}:${item.bottle_no || '-'}:${index}`"
						:title="`${item.out_date || '-'} · 瓶号 ${item.bottle_no || '-'}`"
						:subtitle="buildCycleSubtitle(item)"
						:status="buildDeltaLabel(item.delta_kg)"
						:status-kind="buildDeltaKind(item.delta_kg)"
						icon="alert"
						:icon-class="buildDeltaIconClass(item.delta_kg)"
					>
						<template #meta>
							<view class="meta-tags">
								<AppTag :kind="buildResultKind(item.result_type)">{{ buildResultLabel(item.result_type) }}</AppTag>
								<AppTag kind="soft">灌装 {{ item.fill_count || 0 }} 次</AppTag>
								<text class="meta-text">理论 {{ formatKg(item.theoretical_out_kg) }} kg</text>
								<text class="meta-text">实际 {{ formatKg(item.out_net_kg) }} kg</text>
							</view>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="onNextPage">下一页</AppButton>
				</view>
			</AppSection>

			<AppSection title="链路不完整预览">
				<template #actions>
					<text class="section-hint">共 {{ summary.incomplete_count }} 条（预览 {{ incompletePreview.length }} 条）</text>
				</template>
				<AppList
					:loading="loading"
					:empty="incompletePreview.length === 0"
					:empty-title="searched ? '暂无链路不完整记录' : '查询后可查看链路不完整预览'"
				>
					<AppListItem
						v-for="(item, index) in incompletePreview"
						:key="`${item.reason || '-'}:${item.event_day || '-'}:${item.source_id || '-'}:${index}`"
						:title="`${item.event_day || '-'} · ${buildIncompleteLabel(item.reason)}`"
						:subtitle="item.detail || '-'"
						:status="item.source_id || '-'"
						status-kind="warning"
						icon="alert"
						icon-class="bg-warning"
					/>
				</AppList>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { getBottleCycleLossV1 } from '@/services/bottleMovement'

const PAGE_SIZE = 50
const loading = ref(false)
const list = ref([])
const incompletePreview = ref([])
const searched = ref(false)
const summary = ref({
	cycle_count: 0,
	loss_count: 0,
	loss_total_kg: 0,
	swell_count: 0,
	swell_total_kg: 0,
	exact_count: 0,
	incomplete_count: 0
})
const pager = reactive({
	page: 1,
	pageSize: PAGE_SIZE,
	total: 0,
	hasMore: false
})

const filters = reactive({
	bottle_no: '',
	dateStart: '',
	dateEnd: ''
})

const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || PAGE_SIZE))
	return pages > 0 ? pages : 1
})

const mainEmptyTitle = computed(() => {
	if (!searched.value) return '请输入瓶号并点击查询'
	return '暂无周期明细'
})

function round2(value) {
	const num = Number(value || 0)
	if (!Number.isFinite(num)) return 0
	return Math.round(num * 100) / 100
}

function formatKg(value) {
	return `${round2(value)}`
}

function buildResultLabel(type) {
	if (type === 'loss') return '损耗'
	if (type === 'swell') return '胀重'
	if (type === 'exact') return '吻合'
	return '未知'
}

function buildResultKind(type) {
	if (type === 'loss') return 'danger'
	if (type === 'swell') return 'warning'
	if (type === 'exact') return 'success'
	return 'info'
}

function buildDeltaLabel(deltaValue) {
	const delta = round2(deltaValue)
	if (delta > 0) return `损耗 ${delta} kg`
	if (delta < 0) return `胀 ${Math.abs(delta)} kg`
	return '吻合 0 kg'
}

function buildDeltaKind(deltaValue) {
	const delta = round2(deltaValue)
	if (delta > 0) return 'danger'
	if (delta < 0) return 'warning'
	return 'success'
}

function buildDeltaIconClass(deltaValue) {
	const delta = round2(deltaValue)
	if (delta > 0) return 'bg-danger'
	if (delta < 0) return 'bg-warning'
	return 'bg-success'
}

function buildCycleSubtitle(item) {
	return `回瓶 ${formatKg(item.back_net_kg)} + 灌装 ${formatKg(item.fill_sum_kg)} = 理论 ${formatKg(item.theoretical_out_kg)} · 实际出瓶 ${formatKg(item.out_net_kg)}`
}

function buildIncompleteLabel(reason) {
	if (reason === 'out_without_back') return '出瓶缺回瓶'
	if (reason === 'back_without_out') return '回瓶缺出瓶'
	return reason || '链路不完整'
}

function resetResultState() {
	list.value = []
	incompletePreview.value = []
	summary.value = {
		cycle_count: 0,
		loss_count: 0,
		loss_total_kg: 0,
		swell_count: 0,
		swell_total_kg: 0,
		exact_count: 0,
		incomplete_count: 0
	}
	pager.page = 1
	pager.pageSize = PAGE_SIZE
	pager.total = 0
	pager.hasMore = false
}

async function fetchList() {
	loading.value = true
	try {
		const res = await getBottleCycleLossV1({
			bottle_no: filters.bottle_no,
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			resetResultState()
			return
		}
		const payload = res.data || {}
		list.value = Array.isArray(payload.list) ? payload.list : []
		incompletePreview.value = Array.isArray(payload.incomplete_preview) ? payload.incomplete_preview : []
		summary.value = payload.summary || {
			cycle_count: 0,
			loss_count: 0,
			loss_total_kg: 0,
			swell_count: 0,
			swell_total_kg: 0,
			exact_count: 0,
			incomplete_count: 0
		}
		const paging = payload.paging || {}
		pager.page = Number(paging.page || pager.page || 1)
		pager.pageSize = Number(paging.pageSize || pager.pageSize || PAGE_SIZE)
		pager.total = Number(paging.total || 0)
		pager.hasMore = Boolean(paging.hasMore)
	} finally {
		loading.value = false
	}
}

async function onSearch(resetPage = false) {
	searched.value = true
	if (resetPage) pager.page = 1
	if (!String(filters.bottle_no || '').trim()) {
		uni.showToast({ title: '请输入瓶号', icon: 'none' })
		resetResultState()
		return
	}
	await fetchList()
}

async function onPrevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	await onSearch(false)
}

async function onNextPage() {
	if (!pager.hasMore) return
	pager.page += 1
	await onSearch(false)
}

function onReset() {
	filters.bottle_no = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	searched.value = false
	resetResultState()
}
</script>

<style scoped>
.view-body {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
	width: 100%;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
	align-items: center;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.pager-row {
	margin-top: 16rpx;
	display: flex;
	justify-content: space-between;
	gap: 12rpx;
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
}
</style>
