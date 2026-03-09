<template>
	<AppPage title="科目表" :subtitle="subtitle" icon="list">
		<template #headerActions>
			<AppButton size="sm" kind="primary" icon="plus" @click="onAdd">新增科目</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="筛选结果" :value="summary.total" hint="个" icon="list" />
				<AppStatCard class="summary-card" label="启用科目" :value="summary.active" hint="个" icon="check-circle" />
				<AppStatCard class="summary-card" label="停用科目" :value="summary.inactive" hint="个" icon="minus-circle" />
				<AppStatCard class="summary-card" label="含上级" :value="summary.withParent" hint="个" icon="document" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="科目筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput v-model="filters.keyword" label="关键字" placeholder="科目编码/名称" prefix-icon="search" size="sm" />
					<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
						<view class="picker-trigger">
							<AppInput :model-value="activeLabel" label="状态" disabled size="sm" />
						</view>
					</picker>
				</view>

				<view v-if="filterChips.length" class="filter-chips">
					<view v-for="chip in filterChips" :key="chip.key" class="filter-chip" @click="clearFilterChip(chip.key)">
						<text class="filter-chip__label">{{ chip.label }}</text>
						<text class="filter-chip__close">×</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="科目列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 个 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无科目">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">刷新重试</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.name"
						:subtitle="item.code"
						:status="item.is_active ? '启用' : '停用'"
						:status-kind="item.is_active ? 'success' : 'danger'"
						icon="list"
						:icon-class="item.is_active ? 'bg-info' : 'bg-danger'"
						clickable
						@click="onEdit(item)"
					>
						<template #meta>
							<view class="meta-tags">
								<AppTag kind="soft">{{ typeText(item.type) }}</AppTag>
								<AppTag kind="soft">{{ directionText(item.direction) }}</AppTag>
								<text v-if="item.level" class="meta-text">级次 {{ item.level }}</text>
							</view>
						</template>
						<template #footer>
							<view class="footer-btns">
								<AppButton kind="ghost" size="sm" @click.stop="onEdit(item)">编辑</AppButton>
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
import { listAccountsV1 } from '@/services/account'

const list = ref([])
const summary = ref({ total: 0, active: 0, inactive: 0, withParent: 0 })
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
	{ label: '全部', value: 'all' },
	{ label: '启用', value: 'true' },
	{ label: '停用', value: 'false' }
]

const activeLabel = computed(() => activeOptions[filters.activeIndex]?.label || '全部')

const subtitle = computed(() => {
	if (!pager.total) return '会计科目管理'
	return `当前筛选 ${pager.total} 个`
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

function buildIsActiveParam() {
	const value = activeOptions[filters.activeIndex]?.value
	if (value === 'true') return true
	if (value === 'false') return false
	return undefined
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listAccountsV1({
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
				summary: { total: 0, active: 0, inactive: 0, with_parent: 0 }
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
			summary: res.summary || { total: 0, active: 0, inactive: 0, with_parent: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, active: 0, inactive: 0, with_parent: 0 }
		},
		cacheTTL: 20000,
		throttleMs: 300,
		cacheKey: () => `account:list:${filters.keyword}:${filters.activeIndex}:${pager.page}:${pager.pageSize}`
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
		withParent: Number(summaryData.with_parent ?? summaryData.withParent ?? 0)
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

function typeText(type) {
	const map = {
		asset: '资产',
		liability: '负债',
		equity: '权益',
		revenue: '收入',
		expense: '费用',
		cost: '成本',
		other: '其他'
	}
	return map[type] || type || '-'
}

function directionText(direction) {
	return direction === 'credit' ? '贷' : '借'
}

function onAdd() {
	uni.navigateTo({ url: '/pages/accounting/account-edit' })
}

function onEdit(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/accounting/account-edit?_id=${encodeURIComponent(item._id)}` })
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

.picker-block {
	display: block;
	width: 100%;
}

.filter-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 8px;
}

.filter-chip {
	background: #f1f5f9;
	border: 1px solid #e2e8f0;
	border-radius: 999px;
	padding: 4px 8px 4px 10px;
	font-size: 11px;
	color: #475569;
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.filter-chip__close {
	font-size: 12px;
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

.footer-btns {
	display: flex;
	gap: 12rpx;
}

.picker-trigger {
	pointer-events: none;
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
