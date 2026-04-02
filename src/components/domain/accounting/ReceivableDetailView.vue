<template>
	<AppPage title="往来明细" :subtitle="subtitle" icon="document">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="记录数" :value="summary.total" hint="条" icon="list" />
				<AppStatCard class="summary-card" label="借方合计" :value="summary.debit" hint="元" icon="check-circle" />
				<AppStatCard class="summary-card" label="贷方合计" :value="summary.credit" hint="元" icon="minus-circle" />
				<AppStatCard class="summary-card" label="冲减后净额" :value="netAmountText" :hint="netAmountHint" icon="wallet" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="查询条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput v-model="filters.keyword" label="关键字" placeholder="客户/凭证号/摘要" size="sm" />
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
			</AppSection>

			<AppSection title="明细">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>
				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无明细">
					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.aux?.customer_name || '未知客户'"
						:subtitle="item.date + ' ' + item.voucher_no"
						icon="document"
						icon-class="bg-info"
					>
						<template #meta>
							<view class="meta-tags">
								<text class="meta-text">{{ item.direction === 'debit' ? '借' : '贷' }} {{ item.amount }}</text>
								<text class="meta-text">{{ item.summary }}</text>
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
import { computed, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { getReceivableDetailV1 } from '@/services/ledger'

const list = ref([])
const summary = ref({ total: 0, debit: '0.00', credit: '0.00' })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})
const filters = reactive({
	keyword: '',
	dateStart: '',
	dateEnd: ''
})

const subtitle = computed(() => {
	if (!pager.total) return '应收账款明细'
	return `当前筛选 ${pager.total} 条`
})
const netAmount = computed(() => {
	const debit = Number(summary.value.debit || 0)
	const credit = Number(summary.value.credit || 0)
	return Number((debit - credit).toFixed(2))
})
const netAmountText = computed(() => netAmount.value.toFixed(2))
const netAmountHint = computed(() => {
	if (Math.abs(netAmount.value) < 0.01) return '已冲平'
	return netAmount.value > 0 ? '净应收' : '净应退'
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await getReceivableDetailV1({
			keyword: filters.keyword,
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
				summary: { total: 0, debit: 0, credit: 0 }
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
			summary: res.summary || { total: 0, debit: 0, credit: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, debit: 0, credit: 0 }
		},
		cacheTTL: 8000,
		throttleMs: 300,
		cacheKey: () => `ledger:receivable:${filters.keyword}:${filters.dateStart}:${filters.dateEnd}:${pager.page}:${pager.pageSize}`
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
		debit: Number(summaryData.debit || 0).toFixed(2),
		credit: Number(summaryData.credit || 0).toFixed(2)
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.keyword = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	pager.page = 1
	list.value = []
	summary.value = { total: 0, debit: '0.00', credit: '0.00' }
	pager.total = 0
	pager.hasMore = false
}

function onDateStartChange(e) {
	filters.dateStart = e?.detail?.value || ''
}

function onDateEndChange(e) {
	filters.dateEnd = e?.detail?.value || ''
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
