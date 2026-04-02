<template>
	<AppPage title="车辆档案" :subtitle="subtitle" icon="truck">
		<template #headerActions>
			<AppButton v-if="canCreateVehicle" size="sm" kind="primary" icon="plus" @click="onAdd">新增车辆</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="筛选结果"
					:value="summary.total"
					hint="辆"
					icon="truck"
					@click="onSummaryFilter('all')"
				/>
				<AppStatCard
					class="summary-card"
					label="启用车辆"
					:value="summary.active"
					hint="辆"
					icon="check-circle"
					@click="onSummaryFilter('active')"
				/>
				<AppStatCard
					class="summary-card"
					label="停用车辆"
					:value="summary.inactive"
					hint="辆"
					icon="minus-circle"
					@click="onSummaryFilter('inactive')"
				/>
				<AppStatCard
					class="summary-card"
					label="已完善备注"
					:value="summary.withRemark"
					hint="辆"
					icon="document"
				/>
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="车辆筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.keyword"
						label="关键词"
						placeholder="输入车牌号/备注"
						prefix-icon="search"
						size="sm"
					/>
					<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
						<AppInput
							:model-value="activeLabel"
							label="启用状态"
							placeholder="全部状态"
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

			<AppSection title="车辆列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 辆 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无车辆数据">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">重新查询</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.plate_no"
						:subtitle="item.remark || '无备注信息'"
						:status="item.is_active ? '在用' : '停用'"
						:status-kind="item.is_active ? 'success' : 'danger'"
						icon="truck"
						:icon-class="item.is_active ? 'bg-emerald' : 'bg-danger'"
						:clickable="canUpdateVehicle"
						@click="canUpdateVehicle && onEdit(item)"
					>
						<template #right>
							<view class="info-box">
								<text class="info-label">档案状态</text>
								<AppTag :kind="item.is_active ? 'success' : 'danger'">
									{{ item.is_active ? '正常运行' : '锁定中' }}
								</AppTag>
							</view>
						</template>
						
						<template #meta>
							<view class="meta-tags">
								<text class="mode-label">自营配送</text>
							</view>
						</template>
						
						<template #footer>
							<view class="footer-btns">
								<AppButton v-if="canUpdateVehicle" kind="ghost" size="sm" @click.stop="onEdit(item)">编辑详情</AppButton>
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
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useQuery } from '@/composables/useQuery'
import { searchVehiclesV1 } from '@/services/vehicle'

const list = ref([])
const summary = ref({ total: 0, active: 0, inactive: 0, withRemark: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const activeOptions = [
	{ label: '全部状态', value: 'all' },
	{ label: '在用', value: 'true' },
	{ label: '停用', value: 'false' }
]

const filters = reactive({
	keyword: '',
	activeIndex: 0
})

const activeLabel = computed(() => activeOptions[filters.activeIndex]?.label || '全部状态')

const subtitle = computed(() => {
	if (!pager.total) return '配送车辆管理与合规监控'
	return `当前筛选 ${pager.total} 辆`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const filterChips = computed(() => {
	const chips = []
	if (filters.keyword) chips.push({ key: 'keyword', label: `关键词: ${filters.keyword}` })
	if (filters.activeIndex > 0) chips.push({ key: 'active', label: `状态: ${activeLabel.value}` })
	return chips
})
const { canPageAction } = useAuthGuard()
const canCreateVehicle = computed(() => canPageAction('/pages/vehicle/edit', 'create'))
const canUpdateVehicle = computed(() => canPageAction('/pages/vehicle/edit', 'update'))

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'active') filters.activeIndex = 0
	onSearch(true)
}

function onSummaryFilter(type) {
	if (type === 'active') filters.activeIndex = 1
	else if (type === 'inactive') filters.activeIndex = 2
	else filters.activeIndex = 0
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
		const res = await searchVehiclesV1({
			keyword: filters.keyword,
			is_active: buildIsActiveParam(),
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, active: 0, inactive: 0, with_remark: 0 }
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
			summary: res.summary || { total: 0, active: 0, inactive: 0, with_remark: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, active: 0, inactive: 0, with_remark: 0 }
		},
		cacheTTL: 15000,
		throttleMs: 300,
		cacheKey: () => `vehicle:list:${filters.keyword}:${filters.activeIndex}:${pager.page}:${pager.pageSize}`
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
		active: Number(summaryData.active || 0),
		inactive: Number(summaryData.inactive || 0),
		withRemark: Number(summaryData.with_remark ?? summaryData.withRemark ?? 0)
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.keyword = ''
	filters.activeIndex = 0
	onSearch(true)
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	filters.activeIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onAdd() {
	uni.navigateTo({ url: '/pages/vehicle/edit' })
}

function onEdit(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/vehicle/edit?_id=${encodeURIComponent(item._id)}` })
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
	gap: 8rpx;
}

.info-label {
	font-size: 20rpx;
	color: var(--crm-text-muted);
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
