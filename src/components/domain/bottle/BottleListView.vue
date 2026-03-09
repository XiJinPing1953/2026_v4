<template>
	<AppPage title="钢瓶档案" :subtitle="subtitle" icon="bottle">
		<template #headerActions>
			<AppButton size="sm" kind="primary" icon="plus" @click="onAdd">新增钢瓶</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="筛选结果"
					:value="summary.total"
					hint="瓶"
					icon="bottle"
					@click="onSummaryFilter('all')"
				/>
				<AppStatCard
					class="summary-card"
					label="在站库存"
					:value="summary.inStation"
					hint="瓶"
					icon="list"
					@click="onSummaryFilter('in_station')"
				/>
				<AppStatCard
					class="summary-card"
					label="在客户"
					:value="summary.atCustomer"
					hint="瓶"
					icon="user"
					@click="onSummaryFilter('at_customer')"
				/>
				<AppStatCard
					class="summary-card"
					label="报废/丢失"
					:value="summary.abnormal"
					hint="瓶"
					icon="alert"
				/>
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="钢瓶筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.keyword"
						label="关键词"
						placeholder="钢瓶编号/客户名称"
						prefix-icon="search"
						size="sm"
					/>
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
						<AppInput
							:model-value="statusLabel"
							label="流向状态"
							placeholder="全部状态"
							prefix-icon="list"
							disabled
							size="sm"
						/>
					</picker>
					<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
						<AppInput
							:model-value="activeLabel"
							label="启用状态"
							placeholder="全部启用"
							prefix-icon="list"
							disabled
							size="sm"
						/>
					</picker>
				</view>

				<view v-if="filterChips.length" class="filter-chips">
					<view v-for="chip in filterChips" :key="chip.key" class="filter-chip" @click="clearFilterChip(chip.key)">
						<text class="filter-chip__label">{{ chip.label }}</text>
						<text class="filter-chip__close">×</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="钢瓶列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 瓶 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无钢瓶数据">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">重新加载</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.bottle_no"
						:subtitle="item.current_customer_name || '库内待命'"
						:status="statusText(item.status)"
						:status-kind="statusKind(item.status)"
						icon="bottle"
						:icon-class="getBottleIconColor(item.status)"
						clickable
						@click="onEdit(item)"
					>
						<template #right>
							<view class="info-box">
								<text class="info-label">标准皮重</text>
								<view class="price-box">
									<text class="price-value">{{ item.tare_weight || '--' }}</text>
									<text class="price-symbol">kg</text>
								</view>
							</view>
						</template>
						
						<template #meta>
							<view class="meta-tags">
								<AppTag kind="soft" class="tag-item">{{ item.is_active ? '在用' : '停用' }}</AppTag>
								<text v-if="item.last_check_date" class="mode-label">检: {{ item.last_check_date }}</text>
							</view>
						</template>
						
						<template #footer>
							<view class="footer-btns">
								<AppButton kind="ghost" size="sm" @click.stop="onEdit(item)">修改档案</AppButton>
							</view>
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
import { searchBottlesV1 } from '@/services/bottle'

const list = ref([])
const summary = ref({ total: 0, inStation: 0, atCustomer: 0, abnormal: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const statusOptions = [
	{ label: '全部状态', value: '' },
	{ label: '未知', value: 'unknown' },
	{ label: '在站', value: 'in_station' },
	{ label: '在客户', value: 'at_customer' },
	{ label: '报废', value: 'scrapped' },
	{ label: '丢失', value: 'lost' }
]

const activeOptions = [
	{ label: '全部启用', value: 'all' },
	{ label: '在用', value: 'true' },
	{ label: '停用', value: 'false' }
]

const filters = reactive({
	keyword: '',
	statusIndex: 0,
	activeIndex: 0
})

const statusLabel = computed(() => statusOptions[filters.statusIndex]?.label || '全部状态')
const activeLabel = computed(() => activeOptions[filters.activeIndex]?.label || '全部启用')

const subtitle = computed(() => {
	if (!pager.total) return '钢瓶生命周期与流向监控'
	return `当前筛选 ${pager.total} 瓶`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const filterChips = computed(() => {
	const chips = []
	if (filters.keyword) chips.push({ key: 'keyword', label: `关键词: ${filters.keyword}` })
	if (filters.statusIndex > 0) chips.push({ key: 'status', label: `流向: ${statusLabel.value}` })
	if (filters.activeIndex > 0) chips.push({ key: 'active', label: `启用: ${activeLabel.value}` })
	return chips
})

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'status') filters.statusIndex = 0
	if (key === 'active') filters.activeIndex = 0
	onSearch(true)
}

function onSummaryFilter(type) {
	if (type === 'in_station') {
		const idx = statusOptions.findIndex((item) => item.value === 'in_station')
		filters.statusIndex = idx > -1 ? idx : 0
	} else if (type === 'at_customer') {
		const idx = statusOptions.findIndex((item) => item.value === 'at_customer')
		filters.statusIndex = idx > -1 ? idx : 0
	} else {
		filters.statusIndex = 0
	}
	filters.activeIndex = 0
	onSearch(true)
}

function buildIsActiveParam() {
	const value = activeOptions[filters.activeIndex]?.value
	if (value === 'true') return true
	if (value === 'false') return false
	return undefined
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await searchBottlesV1({
			keyword: filters.keyword,
			status: statusOptions[filters.statusIndex]?.value || '',
			is_active: buildIsActiveParam(),
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, in_station: 0, at_customer: 0, abnormal: 0 }
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: Number(res.total || 0),
				hasMore: false
			},
			summary: res.summary || { total: 0, in_station: 0, at_customer: 0, abnormal: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, in_station: 0, at_customer: 0, abnormal: 0 }
		},
		cacheTTL: 15000,
		throttleMs: 300,
		cacheKey: () => `bottle:list:${filters.keyword}:${filters.statusIndex}:${filters.activeIndex}:${pager.page}:${pager.pageSize}`
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
		inStation: Number(summaryData.in_station ?? summaryData.inStation ?? 0),
		atCustomer: Number(summaryData.at_customer ?? summaryData.atCustomer ?? 0),
		abnormal: Number(summaryData.abnormal || 0)
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.keyword = ''
	filters.statusIndex = 0
	filters.activeIndex = 0
	onSearch(true)
}

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	filters.statusIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	filters.activeIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function statusText(status) {
	const map = {
		unknown: '未知',
		in_station: '在站',
		at_customer: '在客户',
		scrapped: '报废',
		lost: '丢失'
	}
	return map[status] || status || '-'
}

function statusKind(status) {
	if (status === 'scrapped' || status === 'lost') return 'danger'
	if (status === 'in_station' || status === 'at_customer') return 'success'
	return 'info'
}

function getBottleIconColor(status) {
	if (status === 'scrapped' || status === 'lost') return 'bg-danger'
	if (status === 'in_station') return 'bg-teal'
	if (status === 'at_customer') return 'bg-emerald'
	return 'bg-primary'
}

function onAdd() {
	uni.navigateTo({ url: '/pages/bottle/edit' })
}

function onEdit(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/bottle/edit?_id=${encodeURIComponent(item._id)}` })
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

.info-box {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4rpx;
}

.info-label {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.price-box {
	display: flex;
	align-items: baseline;
	gap: 4rpx;
}

.price-symbol {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	font-weight: 600;
}

.price-value {
	font-size: 36rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.mode-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	background: #f1f5f9;
	padding: 4rpx 12rpx;
	border-radius: 8rpx;
}

.footer-btns {
	display: flex;
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
