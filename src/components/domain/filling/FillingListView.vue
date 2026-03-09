<template>
	<AppPage title="灌装记录" :subtitle="subtitle" icon="bottle">
		<template #headerActions>
			<AppButton size="sm" kind="primary" icon="plus" @click="onAdd">新增灌装</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="筛选结果"
					:value="summary.total"
					hint="条"
					icon="bottle"
				/>
				<AppStatCard
					class="summary-card"
					label="站内灌装"
					:value="summary.station"
					hint="条"
					icon="list"
				/>
				<AppStatCard
					class="summary-card"
					label="外出灌装"
					:value="summary.external"
					hint="条"
					icon="truck"
				/>
				<AppStatCard
					class="summary-card"
					label="已备注"
					:value="summary.withRemark"
					hint="条"
					icon="document"
				/>
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="查询条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.bottle_no"
						label="瓶号"
						placeholder="输入瓶号"
						prefix-icon="search"
						size="sm"
					/>
					<picker class="picker-block" mode="date" @change="e => filters.dateStart = e.detail.value">
						<AppInput v-model="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="e => filters.dateEnd = e.detail.value">
						<AppInput v-model="filters.dateEnd" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
				</view>

				<view v-if="filterChips.length" class="filter-chips">
					<view v-for="chip in filterChips" :key="chip.key" class="filter-chip" @click="clearFilterChip(chip.key)">
						<text class="filter-chip__label">{{ chip.label }}</text>
						<text class="filter-chip__close">×</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="记录列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无记录" @retry="onSearch">
					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.bottle_no"
						:subtitle="item.date"
						icon="bottle"
						icon-class="bg-teal"
					>
						<template #right>
							<view class="weight-box">
								<text class="weight-value">{{ item.fill_weight }}</text>
								<text class="weight-unit">kg</text>
							</view>
						</template>
						<template #meta>
							<view class="meta-tags">
								<AppTag kind="soft">{{ item.address || '站内灌装' }}</AppTag>
								<text v-if="item.remark" class="meta-text">{{ item.remark }}</text>
							</view>
						</template>
						<template #footer>
							<AppButton size="sm" kind="outline" @click="onEdit(item)">编辑</AppButton>
							<AppButton
								size="sm"
								kind="neutral"
								:loading="removingId === item._id"
								@click="onRemove(item)"
							>
								删除
							</AppButton>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="onNextPage">下一页</AppButton>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { listFillingsV1, removeFillingV1 } from '@/services/filling'

const list = ref([])
const removingId = ref('')
const summary = ref({ total: 0, station: 0, external: 0, withRemark: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const filters = reactive({
	bottle_no: '',
	dateStart: '',
	dateEnd: ''
})

const subtitle = computed(() => {
	if (!pager.total) return '按瓶号与日期查询'
	return `当前筛选 ${pager.total} 条`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const filterChips = computed(() => {
	const chips = []
	if (filters.bottle_no) chips.push({ key: 'bottle', label: `瓶号: ${filters.bottle_no}` })
	if (filters.dateStart || filters.dateEnd) {
		const start = filters.dateStart || '起'
		const end = filters.dateEnd || '今'
		chips.push({ key: 'date', label: `日期: ${start} ~ ${end}` })
	}
	return chips
})

function clearFilterChip(key) {
	if (key === 'bottle') filters.bottle_no = ''
	if (key === 'date') {
		filters.dateStart = ''
		filters.dateEnd = ''
	}
	onSearch(true)
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listFillingsV1({
			bottle_no: filters.bottle_no,
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, station: 0, external: 0, with_remark: 0 }
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: 0,
				hasMore: false
			},
			summary: res.summary || { total: 0, station: 0, external: 0, with_remark: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, station: 0, external: 0, with_remark: 0 }
		},
		cacheTTL: 10000,
		cacheKey: () => `filling:list:${filters.bottle_no}:${filters.dateStart}:${filters.dateEnd}:${pager.page}:${pager.pageSize}`
	}
)

function applyResult(payload) {
	const data = payload || {}
	list.value = Array.isArray(data.items) ? data.items : []
	const paging = data.paging || {}
	pager.page = Number(paging.page || pager.page || 1)
	pager.pageSize = Number(paging.pageSize || pager.pageSize || 50)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)
	const summaryData = data.summary || {}
	summary.value = {
		total: Number(summaryData.total || 0),
		station: Number(summaryData.station || 0),
		external: Number(summaryData.external || 0),
		withRemark: Number(summaryData.with_remark ?? summaryData.withRemark ?? 0)
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.bottle_no = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	onSearch(true)
}

function onAdd() {
	uni.navigateTo({ url: '/pages/filling/edit' })
}

function onEdit(item) {
	const id = String(item?._id || '')
	if (!id) return
	uni.navigateTo({ url: `/pages/filling/edit?_id=${encodeURIComponent(id)}` })
}

async function onRemove(item) {
	const id = String(item?._id || '')
	if (!id || removingId.value) return
	const confirmRes = await uni.showModal({
		title: '删除灌装记录',
		content: '确认删除该灌装记录？删除后将同步更新该瓶异常状态。',
		showCancel: true
	})
	if (!confirmRes.confirm) return
	removingId.value = id
	try {
		const res = await removeFillingV1({ _id: id })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || '删除成功', icon: 'success' })
		await onSearch()
	} finally {
		removingId.value = ''
	}
}

function onPrevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	onSearch()
}

function onNextPage() {
	if (!pager.hasMore) return
	pager.page += 1
	onSearch()
}

onMounted(() => {
	onSearch()
})

defineExpose({
	refresh: onSearch
})
</script>

<style scoped>
.list-shell {
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

:deep(.summary-card .stat__content) {
	align-items: center;
	gap: 16rpx;
}

:deep(.summary-card .stat__value-wrap) {
	align-items: flex-start;
}

:deep(.summary-card .stat__value) {
	text-align: left;
	font-size: 24px;
}

:deep(.summary-card .stat__icon) {
	margin-left: 12rpx;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.filter-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	margin-top: 16rpx;
}

.filter-chip {
	display: inline-flex;
	align-items: center;
	gap: 8rpx;
	padding: 6rpx 14rpx;
	border-radius: 999rpx;
	background: #f1f5f9;
	color: #475569;
	font-size: 22rpx;
}

.filter-chip__close {
	font-size: 24rpx;
	color: #94a3b8;
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.pager-row {
	margin-top: 12rpx;
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
}

.weight-box {
	display: flex;
	align-items: baseline;
	gap: 4rpx;
}

.weight-value {
	font-size: 36rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.weight-unit {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
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
