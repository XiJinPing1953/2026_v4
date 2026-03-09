<template>
	<AppPage title="客户档案" :subtitle="subtitle" icon="user">
		<template #headerActions>
			<AppButton size="sm" kind="primary" icon="plus" @click="onAdd">新增客户</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="筛选结果"
					:value="summary.total"
					hint="客户"
					icon="user"
					@click="onSummaryFilter('all')"
				/>
				<AppStatCard
					class="summary-card"
					label="启用客户"
					:value="summary.active"
					hint="客户"
					icon="check-circle"
					@click="onSummaryFilter('active')"
				/>
				<AppStatCard
					class="summary-card"
					label="停用客户"
					:value="summary.inactive"
					hint="客户"
					icon="minus-circle"
					@click="onSummaryFilter('inactive')"
				/>
				<AppStatCard
					class="summary-card"
					label="已配定价"
					:value="summary.priced"
					hint="客户"
					icon="list"
				/>
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="客户筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.keyword"
						label="关键词"
						placeholder="客户名/联系人/电话"
						prefix-icon="search"
						size="sm"
					/>
					<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
						<AppInput
							:model-value="activeLabel"
							label="启用状态"
							placeholder="状态筛选"
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

			<AppSection title="客户列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 客户 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无客户数据">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">刷新重试</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.name"
						:subtitle="item.contact || '暂无联系人'"
						:status="item.is_active ? '启用中' : '已停用'"
						:status-kind="item.is_active ? 'success' : 'danger'"
						icon="user"
						:icon-class="item.is_active ? 'bg-customer' : 'bg-muted'"
						clickable
						@click="onEdit(item)"
					>
						<template #right>
							<view class="info-box">
								<text class="info-label">默认单价</text>
								<view class="price-box">
									<text class="price-symbol">¥</text>
									<text class="price-value">{{ item.default_unit_price || '0' }}</text>
									<text class="price-unit">/{{ item.default_price_unit || 'kg' }}</text>
								</view>
							</view>
						</template>
						
						<template #meta>
							<view class="meta-tags">
								<AppTag v-if="item.phone" kind="soft" class="tag-item">
									<AppIcon name="calendar" size="24rpx" style="margin-right: 4rpx;" />
									{{ item.phone }}
								</AppTag>
								<AppTag kind="soft" class="tag-item">{{ item.default_price_unit || 'kg' }}</AppTag>
								<text v-if="item.short_name" class="mode-label">{{ item.short_name }}</text>
							</view>
						</template>
						
						<template #footer>
							<view class="footer-btns">
								<AppButton kind="ghost" size="sm" @click.stop="onEdit(item)">编辑档案</AppButton>
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
import AppIcon from '@/components/base/AppIcon.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { listCustomersV1 } from '@/services/customer'

const list = ref([])
const summary = ref({ total: 0, active: 0, inactive: 0, priced: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const filters = reactive({
	keyword: '',
	activeIndex: 0
})

const activeOptions = [
	{ label: '全部状态', value: 'all' },
	{ label: '启用中', value: 'true' },
	{ label: '已停用', value: 'false' }
]

const activeLabel = computed(() => {
	return activeOptions[filters.activeIndex]?.label || '全部状态'
})

const subtitle = computed(() => {
	if (!pager.total) return '维护客户资料与定价策略'
	return `当前筛选 ${pager.total} 客户`
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
		const res = await listCustomersV1({
			keyword: filters.keyword,
			is_active: buildIsActiveParam(),
			page: pager.page,
			pageSize: pager.pageSize,
			summaryIgnoreActive: true
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, active: 0, inactive: 0, priced: 0 }
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
			summary: res.summary || { total: 0, active: 0, inactive: 0, priced: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, active: 0, inactive: 0, priced: 0 }
		},
		cacheTTL: 15000,
		throttleMs: 300,
		cacheKey: () => `customer:list:${filters.keyword}:${filters.activeIndex}:${pager.page}:${pager.pageSize}`
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
		priced: Number(summaryData.priced || 0)
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
	uni.navigateTo({ url: '/pages/customer/edit' })
}

function onEdit(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/customer/edit?_id=${encodeURIComponent(item._id)}` })
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
	gap: 6rpx;
}

.price-symbol {
	font-size: 22rpx;
	color: var(--crm-text);
	font-weight: 600;
}

.price-value {
	font-size: 36rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.price-unit {
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

.bg-customer {
	background: var(--crm-action-customer);
}

.bg-muted {
	background: #94a3b8;
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
