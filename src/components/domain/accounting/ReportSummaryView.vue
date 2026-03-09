<template>
	<AppPage title="报表汇总" :subtitle="subtitle" icon="chart">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="资产" :value="totals.asset" hint="元" icon="wallet" />
				<AppStatCard class="summary-card" label="负债" :value="totals.liability" hint="元" icon="list" />
				<AppStatCard class="summary-card" label="权益" :value="totals.equity" hint="元" icon="document" />
				<AppStatCard class="summary-card" label="收入" :value="totals.revenue" hint="元" icon="check-circle" />
				<AppStatCard class="summary-card" label="费用" :value="totals.expense" hint="元" icon="minus-circle" />
				<AppStatCard class="summary-card" label="成本" :value="totals.cost" hint="元" icon="alert" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="查询条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput v-model="filters.period" label="账期" placeholder="YYYY-MM" size="sm" />
				</view>
			</AppSection>

			<AppSection title="试算平衡">
				<template #actions>
					<text class="section-hint">共 {{ rows.length }} 条</text>
				</template>
				<AppList :loading="loading" :empty="rows.length === 0" empty-title="暂无数据">
					<AppListItem
						v-for="item in rows"
						:key="item.account_code"
						:title="item.account_name"
						:subtitle="item.account_code"
						icon="list"
						icon-class="bg-info"
					>
						<template #meta>
							<view class="meta-tags">
								<text class="meta-text">借 {{ item.debit }}</text>
								<text class="meta-text">贷 {{ item.credit }}</text>
								<text class="meta-text">余额 {{ item.balance }}</text>
							</view>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { reactive, ref, computed } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { getReportSummaryV1 } from '@/services/report'

const rows = ref([])
const totals = reactive({
	asset: 0,
	liability: 0,
	equity: 0,
	revenue: 0,
	expense: 0,
	cost: 0
})

const filters = reactive({
	period: ''
})

const subtitle = computed(() => {
	if (!filters.period) return '试算平衡/资产负债/利润表概览'
	return `账期 ${filters.period}`
})

const { loading, run: fetchSummary } = useQuery(
	async () => {
		const res = await getReportSummaryV1({ period: filters.period })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return null
		}
		return res.data || null
	},
	{
		immediate: false,
		initialData: null,
		cacheTTL: 8000,
		throttleMs: 300,
		cacheKey: () => `report:summary:${filters.period}`
	}
)

async function onSearch() {
	if (!String(filters.period || '').trim()) {
		uni.showToast({ title: '请先填写账期', icon: 'none' })
		return
	}
	const data = await fetchSummary()
	if (!data) return
	rows.value = Array.isArray(data.trial_balance) ? data.trial_balance : []
	const nextTotals = data.totals || {}
	totals.asset = nextTotals.asset || 0
	totals.liability = nextTotals.liability || 0
	totals.equity = nextTotals.equity || 0
	totals.revenue = nextTotals.revenue || 0
	totals.expense = nextTotals.expense || 0
	totals.cost = nextTotals.cost || 0
}

function onReset() {
	filters.period = ''
	rows.value = []
	totals.asset = 0
	totals.liability = 0
	totals.equity = 0
	totals.revenue = 0
	totals.expense = 0
	totals.cost = 0
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
	grid-template-columns: repeat(auto-fit, minmax(200rpx, 1fr));
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
	font-size: 22px;
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

.section-hint {
	font-size: 22rpx;
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
