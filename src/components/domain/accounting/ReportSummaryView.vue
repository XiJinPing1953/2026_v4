<template>
	<AppPage title="报表汇总" :subtitle="subtitle" icon="chart">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading || incomeLoading" @click="onSearch">刷新</AppButton>
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

			<AppSection v-if="canViewIncome" title="多收款结清收益">
				<text class="section-hint">本功能结清收益，并非公司全部营业外收入</text>
				<view v-if="incomeError" class="income-error" role="alert">{{ incomeError }}</view>
				<view v-else-if="incomeLoading" class="income-state">正在查询结清收益…</view>
				<view v-else-if="settlementIncome" class="income-results">
					<view class="income-summary">
						<text>{{ settlementIncome.date_from }} 至 {{ settlementIncome.date_to }}</text>
						<text class="income-amount">{{ incomeMoney(settlementIncome.total_amount, settlementIncome.money_scale) }} 元</text>
						<text class="section-hint">{{ settlementIncome.customer_count }} 个客户 · {{ settlementIncome.count }} 笔</text>
					</view>
					<AppList :empty="settlementIncome.customers.length === 0" empty-title="该期间无本功能结清收益">
						<AppListItem v-for="customer in settlementIncome.customers" :key="customer.customer_id" :title="customer.customer_name">
							<template #right>
								<text class="income-amount">{{ incomeMoney(customer.amount, customer.money_scale) }} 元</text>
							</template>
							<template #meta>
								<AppButton kind="ghost" size="sm" @click="toggleIncomeCustomer(customer.customer_id)">
									{{ expandedIncomeCustomers[customer.customer_id] ? '收起' : '展开' }} {{ customer.count }} 笔结清单
								</AppButton>
							</template>
							<view v-if="expandedIncomeCustomers[customer.customer_id]" class="income-detail-list">
								<view v-for="item in customer.items" :key="item._id" class="income-detail">
									<view class="income-detail-heading">
										<text>{{ item.biz_date }}</text>
										<text>{{ incomeMoney(item.amount, item.money_scale) }} 元</text>
									</view>
									<text class="meta-text">来源：{{ incomeSource(item.adjustment_source) }}</text>
									<text v-if="item.adjustment_evidence" class="meta-text">结清依据：{{ item.adjustment_evidence }}</text>
									<text v-if="item.note" class="meta-text">说明：{{ item.note }}</text>
									<text class="meta-text">结清单：{{ item._id }}<template v-if="item.created_by_name"> · {{ item.created_by_name }}</template></text>
								</view>
							</view>
						</AppListItem>
					</AppList>
				</view>
				<view v-else class="income-state">填写账期后查询。</view>
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
import { getReportSummaryV1, getSettlementIncomeV1 } from '@/services/report'
import { getRoleTemplate } from '@/services/auth'

const rows = ref([])
const canViewIncome = computed(() => ['finance', 'admin', 'superadmin'].includes(getRoleTemplate()))
const incomeLoading = ref(false)
const incomeError = ref('')
const settlementIncome = ref(null)
const expandedIncomeCustomers = ref({})
let searchSequence = 0
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
	async (period) => {
		const res = await getReportSummaryV1({ period })
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
		cacheKey: (period) => `report:summary:${period}`
	}
)

async function onSearch() {
	const period = String(filters.period || '').trim()
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
		uni.showToast({ title: '请填写有效账期（YYYY-MM）', icon: 'none' })
		return
	}
	const sequence = ++searchSequence
	const dateTo = new Date(`${period}-01T00:00:00Z`)
	dateTo.setUTCMonth(dateTo.getUTCMonth() + 1)
	dateTo.setUTCDate(0)
	await Promise.allSettled([
		loadSummary(period, sequence),
		canViewIncome.value ? loadIncome({ date_from: `${period}-01`, date_to: dateTo.toISOString().slice(0, 10) }, sequence) : Promise.resolve()
	])
}

async function loadSummary(period, sequence) {
	const data = await fetchSummary(period, { force: true })
	if (!data || sequence !== searchSequence) return
	rows.value = Array.isArray(data.trial_balance) ? data.trial_balance : []
	const nextTotals = data.totals || {}
	totals.asset = nextTotals.asset || 0
	totals.liability = nextTotals.liability || 0
	totals.equity = nextTotals.equity || 0
	totals.revenue = nextTotals.revenue || 0
	totals.expense = nextTotals.expense || 0
	totals.cost = nextTotals.cost || 0
}

async function loadIncome(range, sequence) {
	incomeLoading.value = true
	incomeError.value = ''
	settlementIncome.value = null
	expandedIncomeCustomers.value = {}
	try {
		const res = await getSettlementIncomeV1(range)
		if (sequence !== searchSequence) return
		if (res?.code !== 0 || res?.data?.read_complete !== true || !Array.isArray(res?.data?.customers) || !Number.isFinite(res?.data?.total_amount)) {
			throw new Error(res?.msg || '结清收益读取未完成，请重试')
		}
		settlementIncome.value = res.data
	} catch (error) {
		if (sequence === searchSequence) incomeError.value = error?.message || '结清收益查询失败，请重试'
	} finally {
		if (sequence === searchSequence) incomeLoading.value = false
	}
}

function incomeMoney(value, scale) {
	return Number(value).toFixed(Number(scale) === 3 ? 3 : 2)
}

function incomeSource(source = {}) {
	const kind = source.entry_kind === 'prepay' || source.source_type === 'opening_prepay' ? '预付款' : '收款'
	return [source.label || source.source_label || kind, source.date || source.biz_date, source.receipt_no || source.receipt_id || source.source_id || source.id].filter(Boolean).join(' · ')
}

function toggleIncomeCustomer(customerId) {
	expandedIncomeCustomers.value = { ...expandedIncomeCustomers.value, [customerId]: !expandedIncomeCustomers.value[customerId] }
}

function onReset() {
	searchSequence += 1
	incomeLoading.value = false
	incomeError.value = ''
	settlementIncome.value = null
	expandedIncomeCustomers.value = {}
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

.income-state, .income-error { padding: 20rpx 0; font-size: 26rpx; color: var(--crm-text-muted); }
.income-error { color: var(--crm-danger, #b42318); }
.income-results, .income-detail-list, .income-detail { display: flex; flex-direction: column; gap: 16rpx; }
.income-summary, .income-detail-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12rpx; }
.income-summary { padding: 24rpx 0; }
.income-amount { font-weight: 600; font-variant-numeric: tabular-nums; }
.income-detail { border-top: 1rpx solid var(--crm-border); padding-top: 16rpx; overflow-wrap: anywhere; }

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

/* H5 mobile layout; keep desktop and native layouts intact. */
/* #ifdef H5 */
@media (max-width: 767px) {
 .filter-grid { grid-template-columns:minmax(0,1fr); min-width:0; }
 .summary-row { grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; min-width:0; }
}
/* #endif */
</style>
