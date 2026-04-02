<template>
	<AppPage title="凭证列表" :subtitle="subtitle" icon="document">
		<template #headerActions>
			<AppButton v-if="canCreateVoucher" size="sm" kind="primary" icon="plus" @click="onAdd">新增凭证</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="筛选结果" :value="summary.total" hint="张" icon="document" />
				<AppStatCard class="summary-card" label="已过账" :value="summary.posted" hint="张" icon="check-circle" />
				<AppStatCard class="summary-card" label="草稿" :value="summary.draft" hint="张" icon="minus-circle" />
				<AppStatCard class="summary-card" label="含摘要" :value="summary.withSummary" hint="张" icon="list" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="筛选条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput v-model="filters.keyword" label="关键字" placeholder="凭证号/摘要" prefix-icon="search" size="sm" />
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
						<view class="picker-trigger">
							<AppInput :model-value="statusLabel" label="状态" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="date" :value="filters.dateStart" @change="onDateStartChange">
						<view class="picker-trigger">
							<AppInput :model-value="filters.dateStart" label="开始日期" placeholder="YYYY-MM-DD" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="date" :value="filters.dateEnd" @change="onDateEndChange">
						<view class="picker-trigger">
							<AppInput :model-value="filters.dateEnd" label="结束日期" placeholder="YYYY-MM-DD" disabled size="sm" />
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

			<AppSection title="凭证列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 张 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无凭证">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">刷新重试</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.voucher_no"
						:subtitle="item.date + ' ' + item.summary"
						:status="item.status === 'posted' ? '已过账' : '草稿'"
						:status-kind="item.status === 'posted' ? 'success' : 'warning'"
						icon="document"
						:icon-class="item.status === 'posted' ? 'bg-emerald' : 'bg-warning'"
						:clickable="canUpdateVoucher"
						@click="canUpdateVoucher && onEdit(item)"
					>
						<template #meta>
							<view class="meta-tags">
								<text class="meta-text">借 {{ item.total_debit }}</text>
								<text class="meta-text">贷 {{ item.total_credit }}</text>
							</view>
						</template>
						<template #footer>
							<view class="footer-btns">
								<AppButton v-if="canUpdateVoucher" kind="ghost" size="sm" @click.stop="onEdit(item)">编辑</AppButton>
								<AppButton
									v-if="canUpdateVoucher"
									size="sm"
									:kind="item.status === 'posted' ? 'ghost' : 'primary'"
									@click.stop="onTogglePost(item)"
								>
									{{ item.status === 'posted' ? '反过账' : '过账' }}
								</AppButton>
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
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useQuery } from '@/composables/useQuery'
import { listVouchersV1, postVoucherV1, unpostVoucherV1 } from '@/services/voucher'

const list = ref([])
const summary = ref({ total: 0, posted: 0, draft: 0, withSummary: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const filters = reactive({
	keyword: '',
	statusIndex: 0,
	dateStart: '',
	dateEnd: ''
})

const statusOptions = [
	{ label: '全部', value: '' },
	{ label: '草稿', value: 'draft' },
	{ label: '已过账', value: 'posted' }
]

const statusLabel = computed(() => statusOptions[filters.statusIndex]?.label || '全部')

const subtitle = computed(() => {
	if (!pager.total) return '录入与过账管理'
	return `当前筛选 ${pager.total} 张`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const filterChips = computed(() => {
	const chips = []
	if (filters.keyword) chips.push({ key: 'keyword', label: `关键词: ${filters.keyword}` })
	if (filters.statusIndex > 0) chips.push({ key: 'status', label: `状态: ${statusLabel.value}` })
	if (filters.dateStart || filters.dateEnd) {
		const start = filters.dateStart || '起'
		const end = filters.dateEnd || '今'
		chips.push({ key: 'date', label: `日期: ${start} ~ ${end}` })
	}
	return chips
})
const { canPageAction } = useAuthGuard()
const canCreateVoucher = computed(() => canPageAction('/pages/accounting/voucher-edit', 'create'))
const canUpdateVoucher = computed(() => canPageAction('/pages/accounting/voucher-edit', 'update'))

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'status') filters.statusIndex = 0
	if (key === 'date') {
		filters.dateStart = ''
		filters.dateEnd = ''
	}
	onSearch(true)
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listVouchersV1({
			keyword: filters.keyword,
			status: statusOptions[filters.statusIndex]?.value || '',
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, posted: 0, draft: 0, with_summary: 0 }
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
			summary: res.summary || { total: 0, posted: 0, draft: 0, with_summary: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, posted: 0, draft: 0, with_summary: 0 }
		},
		cacheTTL: 10000,
		throttleMs: 300,
		cacheKey: () =>
			`voucher:list:${filters.keyword}:${filters.statusIndex}:${filters.dateStart}:${filters.dateEnd}:${pager.page}:${pager.pageSize}`
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
		posted: Number(summaryData.posted || 0),
		draft: Number(summaryData.draft || 0),
		withSummary: Number(summaryData.with_summary ?? summaryData.withSummary ?? 0)
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
	filters.dateStart = ''
	filters.dateEnd = ''
	onSearch(true)
}

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	filters.statusIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onDateStartChange(e) {
	filters.dateStart = e?.detail?.value || ''
	onSearch(true)
}

function onDateEndChange(e) {
	filters.dateEnd = e?.detail?.value || ''
	onSearch(true)
}

function onAdd() {
	uni.navigateTo({ url: '/pages/accounting/voucher-edit' })
}

function onEdit(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/accounting/voucher-edit?_id=${encodeURIComponent(item._id)}` })
}

async function onTogglePost(item) {
	if (!item?._id) return
	const action = item.status === 'posted' ? unpostVoucherV1 : postVoucherV1
	const res = await action({ _id: item._id })
	if (res?.code === 0) {
		uni.showToast({ title: item.status === 'posted' ? '已反过账' : '已过账', icon: 'success' })
		onSearch()
		return
	}
	uni.showToast({ title: res?.msg || '操作失败', icon: 'none' })
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
