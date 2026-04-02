<template>
		<AppPage title="销售记录" :subtitle="subtitle" icon="list">
		<template #headerActions>
			<AppButton v-if="canCreateSale" size="sm" kind="primary" @click="onAdd" icon="plus">新建销售单</AppButton>
			<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="loading" @click="onExport">导出</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

			<template #highlights>
				<view class="summary-row">
					<AppStatCard
						:class="['summary-card', isSummaryScopeActive('paid') ? 'summary-card--active' : '']"
						label="实收总额"
						:value="amountReceivedText"
						:hint="paidHintText"
						icon="check-circle"
						@click="onSummaryCardClick('paid')"
					/>
					<AppStatCard
						:class="['summary-card', 'summary-card--receivable', isSummaryScopeActive('receivable_outstanding') ? 'summary-card--active' : '']"
						label="应收未收"
						:value="receivableOutstandingText"
						:hint="receivableHintText"
						icon="alert"
						@click="onSummaryCardClick('receivable_outstanding')"
					/>
					<AppStatCard
						:class="['summary-card', 'summary-card--refund', isSummaryScopeActive('refund_outstanding') ? 'summary-card--active' : '']"
						label="应退未退"
						:value="refundOutstandingText"
						:hint="refundHintText"
						icon="alert"
						@click="onSummaryCardClick('refund_outstanding')"
					/>
					<AppStatCard
						:class="['summary-card', 'summary-card--outstanding', outstandingCardClass, isSummaryScopeActive('net_outstanding_non_zero') ? 'summary-card--active' : '']"
						label="净未收总额"
						:value="outstandingText"
						:hint="outstandingHintText"
						icon="alert"
						@click="onSummaryCardClick('net_outstanding_non_zero')"
					/>
					<AppStatCard
						:class="['summary-card', isSummaryScopeActive('all') ? 'summary-card--active' : '']"
						label="净重合计"
						:value="totalNetWeightText"
						:hint="netModeHintText"
						icon="list"
						@click="onSummaryCardClick('all')"
					/>
				</view>
			</template>

			<view class="list-shell">
				<view class="quick-date-strip">
					<AppDatePresetBar v-model="datePreset" @update:modelValue="onDatePresetChange" />
				</view>
				<AppSection title="筛选条件" class="filter-section">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

					<view class="filter-grid">
					<view class="search-field">
					<AppInput
						v-model="filters.keyword"
						label="关键词"
						placeholder="搜索客户、车牌或备注..."
						prefix-icon="search"
						size="sm"
						@input="onSearchInput"
						@confirm="onKeywordConfirm"
						@focus="showSuggestions = true"
						@blur="onSearchBlur"
					/>
						<view v-if="showSuggestions && suggestions.length > 0" class="suggestions">
							<view
								v-for="item in suggestions"
								:key="item.key"
								class="suggestion-item"
								@click.stop="selectSuggestion(item)"
								@tap.stop="selectSuggestion(item)"
							>
								<text class="suggestion-text">{{ item.label }}</text>
								<text class="suggestion-sub">{{ item.sub }}</text>
							</view>
						</view>
					</view>

					<picker class="picker-block" mode="date" @change="onDateStartChange">
						<AppInput v-model="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="onDateEndChange">
						<AppInput v-model="filters.dateEnd" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>

					<view class="picker-field">
						<text class="picker-label">计价单位</text>
						<picker class="picker-block" mode="selector" :range="priceUnitOptions" range-key="label" @change="onPriceUnitChange">
							<view class="picker-tap">
								<AppInput :model-value="priceUnitOptions[priceUnitIndex].label" disabled size="sm" />
							</view>
						</picker>
					</view>
						<view class="picker-field">
							<text class="picker-label">销售模式</text>
							<picker class="picker-block" mode="selector" :range="bizModeOptions" range-key="label" @change="onBizModeChange">
								<view class="picker-tap">
									<AppInput :model-value="bizModeOptions[bizModeIndex].label" disabled size="sm" />
								</view>
							</picker>
						</view>
						<view class="picker-field">
							<text class="picker-label">付款状态</text>
							<picker class="picker-block" mode="selector" :range="paymentStatusOptions" range-key="label" @change="onPaymentStatusChange">
								<view class="picker-tap">
									<AppInput :model-value="paymentStatusOptions[paymentStatusIndex].label" disabled size="sm" />
								</view>
							</picker>
						</view>
						<view class="picker-field">
							<text class="picker-label">有无备注</text>
							<picker class="picker-block" mode="selector" :range="hasRemarkOptions" range-key="label" @change="onHasRemarkChange">
								<view class="picker-tap">
									<AppInput :model-value="hasRemarkOptions[hasRemarkIndex].label" disabled size="sm" />
								</view>
							</picker>
						</view>
						<view class="picker-field">
							<text class="picker-label">备注标签</text>
							<picker class="picker-block" mode="selector" :range="remarkTagOptions" range-key="label" @change="onRemarkTagChange">
								<view class="picker-tap">
									<AppInput :model-value="remarkTagOptions[remarkTagIndex].label" disabled size="sm" />
								</view>
							</picker>
						</view>
					</view>

				<view v-if="filterChips.length" class="filter-chips">
					<view v-for="chip in filterChips" :key="chip.key" class="filter-chip" @tap="clearFilterChip(chip.key)">
						<text class="filter-chip__label">{{ chip.label }}</text>
						<text class="filter-chip__close">×</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="记录列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList
					:loading="loading"
					:empty="list.length === 0"
					empty-title="未找到符合条件的记录"
					@retry="onSearch"
				>
					<AppListItem
						v-for="item in list"
						:key="item._id"
						class="sale-item"
						:title="item.customer_name"
						:subtitle="item.date"
						:status="paymentStatusText(item.payment_status)"
						:status-kind="paymentStatusKind(item.payment_status)"
						:icon="getBizModeIcon(item.biz_mode)"
						:icon-class="getBizModeColor(item.biz_mode)"
						clickable
						@click="onDetail(item)"
					>
						<template #header>
							<view class="sale-header">
								<view class="sale-title">
									<text class="sale-name">{{ item.customer_name }}</text>
									<text class="sale-date">{{ item.date }}</text>
								</view>
								<view class="sale-subtitle">
									<text class="sale-meta">{{ bizModeText(item.biz_mode) }}</text>
									<text class="sale-meta">单价 {{ item.unit_price || '-' }}</text>
								</view>
							</view>
						</template>
						<template #right>
							<view class="price-box">
								<text class="price-symbol">¥</text>
								<text class="price-value">{{ item.should_receive }}</text>
								<text class="price-trend" :class="priceTrendClass(item)">{{ priceTrendText(item) }}</text>
							</view>
						</template>

						<template #meta>
							<view class="sale-meta-stack">
								<view class="meta-tags">
									<AppTag kind="soft">{{ item.price_unit }}</AppTag>
									<text v-if="item.biz_mode !== 'bottle'" class="mode-badge">
										{{ item.biz_mode === 'truck' ? '整车' : '代理' }}
									</text>
								</view>
								<view v-if="item.biz_mode === 'bottle'" class="sale-mini-amounts">
									<text class="sale-mini-amounts__movement">
										本单出瓶 {{ resolveOutBottleCount(item) }} · 本单回瓶 {{ resolveBackBottleCount(item) }} · 存瓶(截止本单) {{ resolveDepositBalanceCount(item) }}
									</text>
									<text class="sale-mini-amounts__detail">本单出瓶明细：{{ resolveOutBottleDetailText(item) }}</text>
									<text class="sale-mini-amounts__detail">本单回瓶明细：{{ resolveBackBottleDetailText(item) }}</text>
									<text v-if="resolveDepositDetailText(item)" class="sale-mini-amounts__deposit">
										存瓶明细：{{ resolveDepositDetailText(item) }}
									</text>
								</view>
								<view v-if="remarkSummaryText(item)" class="remark-summary">
									<text class="remark-summary__text">{{ remarkSummaryText(item) }}</text>
									<view v-if="remarkTagLabels(item).length" class="remark-summary__tags">
										<AppTag v-for="tag in remarkTagLabels(item)" :key="`${item._id}-${tag}`" kind="soft">{{ tag }}</AppTag>
									</view>
								</view>
							</view>
						</template>
						<template #footer>
							<AppButton v-if="canViewCustomerStatement" size="sm" kind="ghost" @click.stop="onCustomerStatement(item)">客户对账</AppButton>
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppDatePresetBar from '@/components/base/AppDatePresetBar.vue'
import { useQuery } from '@/composables/useQuery'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { listSalesV2 } from '@/services/sale'
import { listCustomersV1 } from '@/services/customer'
import { searchVehiclesV1 } from '@/services/vehicle'
import { buildDatePresetRange, detectDatePreset } from '@/utils/datePreset'

const props = defineProps({
	presetHasRemark: { type: String, default: '' },
	presetRemarkTag: { type: String, default: '' }
})

const { canPageAction, canViewPage } = useAuthGuard()
const canCreateSale = computed(() => canPageAction('/pages/sale/edit', 'create'))
const canViewCustomerStatement = computed(() => canViewPage('/pages/customer/statement'))

const list = ref([])
const exporting = ref(false)
const summary = ref({
	total: 0,
	paid: 0,
	paidBottleCount: 0,
	partial: 0,
	unpaid: 0,
	shouldReceiveTotal: 0,
	monthSalesDocTotal: 0,
	monthFlowTotal: 0,
	monthSalesTotal: 0,
	monthRangeStart: '',
	monthRangeEnd: '',
	amountReceivedTotal: 0,
	outstandingTotal: 0,
	totalNetWeight: 0,
	bottleCount: 0,
	truckCount: 0,
	agentSaleCount: 0,
	bottleNetWeight: 0,
	truckNetWeight: 0,
	agentSaleNetWeight: 0,
	receivableOutstandingTotal: 0,
	receivableOutstandingCount: 0,
	receivableOutstandingBottleCount: 0,
	refundOutstandingTotal: 0,
	refundOutstandingCount: 0,
	refundOutstandingBottleCount: 0,
	overpaidTotal: 0,
	overpaidCount: 0,
	overrefundTotal: 0,
	overrefundCount: 0,
	prereceiveTotal: 0,
	prereceiveCount: 0,
	prerefundTotal: 0,
	prerefundCount: 0
})
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})
const datePreset = ref('custom')
const showSuggestions = ref(false)
const suggestions = ref([])
let searchTimer = null

const filters = reactive({
	keyword: '',
	dateStart: '',
	dateEnd: '',
	priceUnit: '',
	bizMode: '',
	paymentStatus: '',
	settlementScope: '',
	hasRemark: '',
	remarkTag: ''
})

const priceUnitOptions = [
	{ label: '全部单位', value: '' },
	{ label: 'kg', value: 'kg' },
	{ label: '瓶', value: 'bottle' },
	{ label: 'm3', value: 'm3' }
]
const bizModeOptions = [
	{ label: '全部模式', value: '' },
	{ label: '瓶装', value: 'bottle' },
	{ label: '整车', value: 'truck' },
	{ label: '代理出站', value: 'agent_sale' }
]
const paymentStatusOptions = [
	{ label: '全部状态', value: '' },
	{ label: '仅未结清(未付+部分付)', value: 'unsettled' },
	{ label: '未付款', value: 'unpaid' },
	{ label: '部分付', value: 'partial' },
	{ label: '已结清', value: 'paid' }
]
const hasRemarkOptions = [
	{ label: '全部备注', value: '' },
	{ label: '有备注', value: 'yes' },
	{ label: '无备注', value: 'no' }
]
const remarkTagOptions = [
	{ label: '全部标签', value: '' },
	{ label: '票上多算', value: 'ticket_adjust_up' },
	{ label: '票上少算', value: 'ticket_adjust_down' },
	{ label: '去掉回瓶', value: 'remove_back_bottle' },
	{ label: '余款结转', value: 'balance_carry' },
	{ label: '安装材料', value: 'material_install' },
	{ label: '现金标记', value: 'cash_mark' },
	{ label: '合并痕迹', value: 'merge_trace' },
	{ label: '收款事件', value: 'payment_event' },
	{ label: '其他备注', value: 'other' }
]
const priceUnitIndex = ref(0)
const bizModeIndex = ref(0)
const paymentStatusIndex = ref(0)
const hasRemarkIndex = ref(0)
const remarkTagIndex = ref(0)
const settlementScopeTextMap = {
	receivable_outstanding: '应收未收',
	refund_outstanding: '应退未退',
	net_outstanding_non_zero: '净未收非零'
}
const remarkTagLabelMap = {
	ticket_adjust_up: '票上多算',
	ticket_adjust_down: '票上少算',
	remove_back_bottle: '去掉回瓶',
	balance_carry: '余款结转',
	material_install: '安装材料',
	cash_mark: '现金标记',
	merge_trace: '合并痕迹',
	payment_event: '收款事件',
	other: '其他备注'
}

const subtitle = computed(() => {
	if (!pager.total) return '按客户与日期检索'
	return `当前筛选 ${pager.total} 条`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})
const amountReceivedText = computed(() => formatMoneyStat(summary.value.amountReceivedTotal))
const outstandingText = computed(() => formatMoneyStat(summary.value.outstandingTotal))
const totalNetWeightText = computed(() => formatWeightStat(summary.value.totalNetWeight))
const receivableOutstandingText = computed(() => formatMoneyStat(summary.value.receivableOutstandingTotal))
const refundOutstandingText = computed(() => formatMoneyStat(summary.value.refundOutstandingTotal))
const paidHintText = computed(() => `已结清${formatCount(summary.value.paid)}单 / ${formatCount(summary.value.paidBottleCount)}瓶`)
const receivableHintText = computed(() => `${formatCount(summary.value.receivableOutstandingCount)}单 / ${formatCount(summary.value.receivableOutstandingBottleCount)}瓶`)
const refundHintText = computed(() => `${formatCount(summary.value.refundOutstandingCount)}单 / ${formatCount(summary.value.refundOutstandingBottleCount)}瓶`)
const outstandingHintText = computed(() => {
	const tags = []
	if (summary.value.overpaidCount > 0) tags.push(`超收${formatCount(summary.value.overpaidCount)}单`)
	if (summary.value.overrefundCount > 0) tags.push(`超退${formatCount(summary.value.overrefundCount)}单`)
	if (summary.value.prereceiveCount > 0) tags.push(`预收${formatCount(summary.value.prereceiveCount)}单`)
	if (summary.value.prerefundCount > 0) tags.push(`预退${formatCount(summary.value.prerefundCount)}单`)
	if (!tags.length) return '无特殊项'
	if (tags.length <= 2) return tags.join(' · ')
	return `${tags.slice(0, 2).join(' · ')} · +${tags.length - 2}`
})
const outstandingCardClass = computed(() => {
	const value = Number(summary.value.outstandingTotal || 0)
	if (value > 0) return 'summary-card--outstanding-positive'
	if (value < 0) return 'summary-card--outstanding-negative'
	return 'summary-card--outstanding-zero'
})
const netModeHintText = computed(() => {
	const b = formatWeightStat(summary.value.bottleNetWeight)
	const t = formatWeightStat(summary.value.truckNetWeight)
	const a = formatWeightStat(summary.value.agentSaleNetWeight)
	return `瓶${b} / 车${t} / 代${a}`
})

const filterChips = computed(() => {
	const chips = []
	if (filters.keyword) chips.push({ key: 'keyword', label: `关键词: ${filters.keyword}` })
	if (filters.dateStart || filters.dateEnd) {
		const start = filters.dateStart || '起'
		const end = filters.dateEnd || '今'
		chips.push({ key: 'date', label: `日期: ${start} ~ ${end}` })
	}
	if (filters.priceUnit) {
		const option = priceUnitOptions.find((item) => item.value === filters.priceUnit)
		chips.push({ key: 'priceUnit', label: `单位: ${option?.label || filters.priceUnit}` })
	}
	if (filters.bizMode) {
		const option = bizModeOptions.find((item) => item.value === filters.bizMode)
		chips.push({ key: 'bizMode', label: `模式: ${option?.label || filters.bizMode}` })
	}
	if (filters.paymentStatus) {
		const option = paymentStatusOptions.find((item) => item.value === filters.paymentStatus)
		chips.push({ key: 'paymentStatus', label: `付款: ${option?.label || filters.paymentStatus}` })
	}
	if (filters.hasRemark) {
		const option = hasRemarkOptions.find((item) => item.value === filters.hasRemark)
		chips.push({ key: 'hasRemark', label: `备注: ${option?.label || filters.hasRemark}` })
	}
	if (filters.remarkTag) {
		const option = remarkTagOptions.find((item) => item.value === filters.remarkTag)
		chips.push({ key: 'remarkTag', label: `标签: ${option?.label || filters.remarkTag}` })
	}
	if (filters.settlementScope) {
		chips.push({ key: 'settlementScope', label: `口径: ${settlementScopeTextMap[filters.settlementScope] || filters.settlementScope}` })
	}
	return chips
})

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'date') {
		filters.dateStart = ''
		filters.dateEnd = ''
		syncDatePreset()
	}
	if (key === 'priceUnit') {
		filters.priceUnit = ''
		priceUnitIndex.value = 0
	}
	if (key === 'bizMode') {
		filters.bizMode = ''
		bizModeIndex.value = 0
	}
	if (key === 'paymentStatus') {
		filters.paymentStatus = ''
		paymentStatusIndex.value = 0
	}
	if (key === 'hasRemark') {
		filters.hasRemark = ''
		hasRemarkIndex.value = 0
	}
	if (key === 'remarkTag') {
		filters.remarkTag = ''
		remarkTagIndex.value = 0
	}
	if (key === 'settlementScope') {
		filters.settlementScope = ''
	}
	onSearch(true)
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listSalesV2({
			keyword: filters.keyword,
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			priceUnit: filters.priceUnit,
			bizMode: filters.bizMode,
			paymentStatus: filters.paymentStatus,
			settlementScope: filters.settlementScope,
			hasRemark: filters.hasRemark,
			remarkTag: filters.remarkTag,
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			throw new Error(res?.msg || '销售记录加载失败')
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: Number(res.total || 0),
				hasMore: false
			},
			summary: res.summary || {
				total: 0,
				paid: 0,
				paid_bottle_count: 0,
				partial: 0,
				unpaid: 0,
				should_receive_total: 0,
				month_sales_doc_total: 0,
				month_flow_total: 0,
				month_sales_total: 0,
				month_range_start: '',
				month_range_end: '',
				amount_received_total: 0,
				outstanding_total: 0,
				total_net_weight: 0,
				bottle_count: 0,
				truck_count: 0,
				agent_sale_count: 0,
				bottle_net_weight: 0,
				truck_net_weight: 0,
				agent_sale_net_weight: 0,
				receivable_outstanding_total: 0,
				receivable_outstanding_count: 0,
				receivable_outstanding_bottle_count: 0,
				refund_outstanding_total: 0,
				refund_outstanding_count: 0,
				refund_outstanding_bottle_count: 0,
				overpaid_total: 0,
				overpaid_count: 0,
				overrefund_total: 0,
				overrefund_count: 0,
				prereceive_total: 0,
				prereceive_count: 0,
				prerefund_total: 0,
				prerefund_count: 0
			}
			}
		},
	{
		immediate: false,
			initialData: {
				items: [],
				paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
				summary: {
					total: 0,
					paid: 0,
					paid_bottle_count: 0,
					partial: 0,
					unpaid: 0,
					should_receive_total: 0,
					month_sales_doc_total: 0,
					month_flow_total: 0,
					month_sales_total: 0,
					month_range_start: '',
					month_range_end: '',
					amount_received_total: 0,
					outstanding_total: 0,
					total_net_weight: 0,
					bottle_count: 0,
					truck_count: 0,
					agent_sale_count: 0,
					bottle_net_weight: 0,
					truck_net_weight: 0,
					agent_sale_net_weight: 0,
					receivable_outstanding_total: 0,
					receivable_outstanding_count: 0,
					receivable_outstanding_bottle_count: 0,
					refund_outstanding_total: 0,
					refund_outstanding_count: 0,
					refund_outstanding_bottle_count: 0,
					overpaid_total: 0,
					overpaid_count: 0,
					overrefund_total: 0,
					overrefund_count: 0,
					prereceive_total: 0,
					prereceive_count: 0,
					prerefund_total: 0,
					prerefund_count: 0
				}
			},
		cacheTTL: 10000,
		throttleMs: 300,
			cacheKey: () =>
				`sale:list:${filters.keyword}:${filters.dateStart}:${filters.dateEnd}:${filters.priceUnit}:${filters.bizMode}:${filters.paymentStatus}:${filters.settlementScope}:${filters.hasRemark}:${filters.remarkTag}:${pager.page}:${pager.pageSize}`,
		onError(err) {
			uni.showToast({ title: err?.message || '销售记录加载失败', icon: 'none' })
		}
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
		paid: Number(summaryData.paid || 0),
		paidBottleCount: Number(summaryData.paid_bottle_count || 0),
		partial: Number(summaryData.partial || 0),
		unpaid: Number(summaryData.unpaid || 0),
		shouldReceiveTotal: toNumber(summaryData.should_receive_total, 0),
		monthSalesDocTotal: toNumber(summaryData.month_sales_doc_total, 0),
		monthFlowTotal: toNumber(summaryData.month_flow_total, 0),
		monthSalesTotal: toNumber(summaryData.month_sales_total, 0),
		monthRangeStart: String(summaryData.month_range_start || ''),
		monthRangeEnd: String(summaryData.month_range_end || ''),
		amountReceivedTotal: toNumber(summaryData.amount_received_total, 0),
		outstandingTotal: toNumber(summaryData.outstanding_total, 0),
		totalNetWeight: toNumber(summaryData.total_net_weight, 0),
		bottleCount: Number(summaryData.bottle_count || 0),
		truckCount: Number(summaryData.truck_count || 0),
		agentSaleCount: Number(summaryData.agent_sale_count || 0),
		bottleNetWeight: toNumber(summaryData.bottle_net_weight, 0),
		truckNetWeight: toNumber(summaryData.truck_net_weight, 0),
		agentSaleNetWeight: toNumber(summaryData.agent_sale_net_weight, 0),
		receivableOutstandingTotal: toNumber(summaryData.receivable_outstanding_total, 0),
		receivableOutstandingCount: Number(summaryData.receivable_outstanding_count || 0),
		receivableOutstandingBottleCount: Number(summaryData.receivable_outstanding_bottle_count || 0),
		refundOutstandingTotal: toNumber(summaryData.refund_outstanding_total, 0),
		refundOutstandingCount: Number(summaryData.refund_outstanding_count || 0),
		refundOutstandingBottleCount: Number(summaryData.refund_outstanding_bottle_count || 0),
		overpaidTotal: toNumber(summaryData.overpaid_total, 0),
		overpaidCount: Number(summaryData.overpaid_count || 0),
		overrefundTotal: toNumber(summaryData.overrefund_total, 0),
		overrefundCount: Number(summaryData.overrefund_count || 0),
		prereceiveTotal: toNumber(summaryData.prereceive_total, 0),
		prereceiveCount: Number(summaryData.prereceive_count || 0),
		prerefundTotal: toNumber(summaryData.prerefund_total, 0),
		prerefundCount: Number(summaryData.prerefund_count || 0)
	}
}

async function onSearch(resetPage = false, options = {}) {
	if (resetPage) pager.page = 1
	const force = Boolean(options?.force)
	const data = force ? await fetchList({ force: true }) : await fetchList()
	if (!data) return
	applyResult(data)
}

async function refreshList() {
	await onSearch(false, { force: true })
}

function onReset() {
	filters.keyword = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	filters.priceUnit = ''
	filters.bizMode = ''
	filters.paymentStatus = ''
	filters.settlementScope = ''
	filters.hasRemark = ''
	filters.remarkTag = ''
	priceUnitIndex.value = 0
	bizModeIndex.value = 0
	paymentStatusIndex.value = 0
	hasRemarkIndex.value = 0
	remarkTagIndex.value = 0
	datePreset.value = 'custom'
	onSearch(true)
}

function buildSearchSuggestionItems(customers = [], vehicles = []) {
	const list = []
	const seen = new Set()
	customers.forEach((item) => {
		const name = String(item?.name || '').trim()
		if (!name) return
		const key = `customer:${name}`
		if (seen.has(key)) return
		seen.add(key)
		list.push({
			key,
			type: 'customer',
			keyword: name,
			label: name,
			sub: [item?.contact, item?.phone].filter(Boolean).join(' · ')
		})
	})
	vehicles.forEach((item) => {
		const plateNo = String(item?.plate_no || '').trim()
		if (!plateNo) return
		const key = `vehicle:${plateNo}`
		if (seen.has(key)) return
		seen.add(key)
		list.push({
			key,
			type: 'vehicle',
			keyword: plateNo,
			label: plateNo,
			sub: [item?.driver_name, item?.owner_name, item?.phone].filter(Boolean).join(' · ')
		})
	})
	return list.slice(0, 12)
}

function onSearchInput(val) {
	if (searchTimer) clearTimeout(searchTimer)
	if (!val) {
		suggestions.value = []
		showSuggestions.value = false
		return
	}
	showSuggestions.value = true
	searchTimer = setTimeout(async () => {
		try {
			const [customerRes, vehicleRes] = await Promise.all([
				listCustomersV1({ keyword: val, page: 1, pageSize: 8 }),
				searchVehiclesV1({ keyword: val, page: 1, pageSize: 8 })
			])
			suggestions.value = buildSearchSuggestionItems(
				customerRes?.code === 0 ? customerRes.data || [] : [],
				vehicleRes?.code === 0 ? vehicleRes.data || [] : []
			)
		} catch (e) {
			console.error(e)
		}
	}, 300)
}

function onKeywordConfirm() {
	if (suggestions.value.length > 0) {
		selectSuggestion(suggestions.value[0])
		return
	}
	onSearch(true)
}

function selectSuggestion(item) {
	filters.keyword = item?.keyword || ''
	showSuggestions.value = false
	onSearch(true)
}

function onSearchBlur() {
	setTimeout(() => {
		showSuggestions.value = false
	}, 200)
}

async function onDatePresetChange(value) {
	datePreset.value = value
	if (value === 'custom') return
	const range = buildDatePresetRange(value, new Date())
	filters.dateStart = range.dateStart
	filters.dateEnd = range.dateEnd
	await onSearch(true)
}

function syncDatePreset() {
	datePreset.value = detectDatePreset(filters.dateStart, filters.dateEnd, new Date())
}

function onDateStartChange(e) {
	filters.dateStart = e?.detail?.value || ''
	syncDatePreset()
}

function onDateEndChange(e) {
	filters.dateEnd = e?.detail?.value || ''
	syncDatePreset()
}

function onPriceUnitChange(e) {
	const index = Number(e.detail.value || 0)
	priceUnitIndex.value = index
	filters.priceUnit = priceUnitOptions[index]?.value || ''
}

function onBizModeChange(e) {
	const index = Number(e.detail.value || 0)
	bizModeIndex.value = index
	filters.bizMode = bizModeOptions[index]?.value || ''
}

function onPaymentStatusChange(e) {
	const index = Number(e.detail.value || 0)
	paymentStatusIndex.value = index
	filters.paymentStatus = paymentStatusOptions[index]?.value || ''
}

function onHasRemarkChange(e) {
	const index = Number(e.detail.value || 0)
	hasRemarkIndex.value = index
	filters.hasRemark = hasRemarkOptions[index]?.value || ''
}

function onRemarkTagChange(e) {
	const index = Number(e.detail.value || 0)
	remarkTagIndex.value = index
	filters.remarkTag = remarkTagOptions[index]?.value || ''
}

function isSummaryScopeActive(scope) {
	if (scope === 'all') return !filters.paymentStatus && !filters.settlementScope
	if (scope === 'paid') return filters.paymentStatus === 'paid' && !filters.settlementScope
	return filters.settlementScope === scope
}

function onSummaryCardClick(scope) {
	if (scope === 'all') {
		filters.paymentStatus = ''
		filters.settlementScope = ''
		paymentStatusIndex.value = 0
		onSearch(true)
		return
	}
	if (scope === 'paid') {
		if (filters.paymentStatus === 'paid' && !filters.settlementScope) {
			filters.paymentStatus = ''
			paymentStatusIndex.value = 0
		} else {
			filters.paymentStatus = 'paid'
			filters.settlementScope = ''
			paymentStatusIndex.value = paymentStatusOptions.findIndex((item) => item.value === 'paid')
		}
		onSearch(true)
		return
	}
	if (filters.settlementScope === scope) filters.settlementScope = ''
	else {
		filters.paymentStatus = ''
		paymentStatusIndex.value = 0
		filters.settlementScope = scope
	}
	onSearch(true)
}

function onAdd() {
	uni.navigateTo({ url: '/pages/sale/edit' })
}

function onDetail(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/sale/detail?_id=${encodeURIComponent(item._id)}` })
}

function onCustomerStatement(item) {
	const customerId = String(item?.customer_id || '').trim()
	if (!customerId) {
		uni.showToast({ title: '客户信息缺失', icon: 'none' })
		return
	}
	uni.navigateTo({ url: `/pages/customer/statement?_id=${encodeURIComponent(customerId)}` })
}

function getBizModeIcon(mode) {
	const map = {
		bottle: 'bottle',
		truck: 'truck',
		agent_sale: 'user'
	}
	return map[mode] || 'document'
}

function getBizModeColor(mode) {
	const map = {
		bottle: 'bg-teal',
		truck: 'bg-emerald',
		agent_sale: 'bg-purple'
	}
	return map[mode] || 'bg-primary'
}

function bizModeText(value) {
	const map = {
		bottle: '瓶装',
		truck: '整车',
		agent_sale: '代理出站'
	}
	return map[value] || '瓶装'
}

function paymentStatusText(value) {
	const map = {
		paid: '已结清',
		partial: '部分付',
		unpaid: '未付款',
		'已结清': '已结清',
		'部分付': '部分付',
		'未付款': '未付款'
	}
	return map[value] || value
}

function paymentStatusKind(value) {
	const map = {
		paid: 'success',
		partial: 'warning',
		unpaid: 'danger',
		'已结清': 'success',
		'部分付': 'warning',
		'未付款': 'danger'
	}
	return map[value] || 'info'
}

function normalizeRemarkTagList(value) {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => String(item || '').trim())
		.filter(Boolean)
}

function remarkTagLabels(item) {
	return normalizeRemarkTagList(item?.remark_tags)
		.map((tag) => remarkTagLabelMap[tag] || tag)
		.slice(0, 3)
}

function remarkSummaryText(item) {
	const business = String(item?.remark || '').trim()
	if (business) return business
	const system = String(item?.system_note || '').trim()
	return system
}

function resolveOutBottleCount(item) {
	const explicit = Number(item?.out_bottle_count)
	if (Number.isFinite(explicit)) return Math.max(Math.floor(explicit), 0)
	return collectBottleNosByRows(item?.out_items).length
}

function resolveBackBottleCount(item) {
	const explicit = Number(item?.back_bottle_count)
	if (Number.isFinite(explicit)) return Math.max(Math.floor(explicit), 0)
	return collectBottleNosByRows(item?.back_items).length
}

function resolveDepositBalanceCount(item) {
	const explicit = Number(item?.deposit_balance_count)
	if (Number.isFinite(explicit)) return Math.max(Math.floor(explicit), 0)
	const fallback = Array.isArray(item?.deposit_rows) ? item.deposit_rows : (Array.isArray(item?.deposit_items) ? item.deposit_items : [])
	return collectBottleNosByRows(fallback).length
}

function formatBottlePreviewText(previewList, total, truncated) {
	const list = Array.isArray(previewList)
		? previewList.map((row) => String(row || '').trim().toUpperCase()).filter(Boolean)
		: []
	if (!list.length) return '无'
	const text = list.join('、')
	if (truncated || total > list.length) return `${text} 等${total}只`
	return text
}

function resolveOutBottleDetailText(item) {
	const total = resolveOutBottleCount(item)
	const previewList = Array.isArray(item?.out_bottles_preview) ? item.out_bottles_preview : []
	if (previewList.length > 0) {
		return formatBottlePreviewText(previewList, total, Boolean(item?.out_bottles_truncated))
	}
	return total > 0 ? formatBottleNoList(item?.out_items) : '无'
}

function resolveBackBottleDetailText(item) {
	const total = resolveBackBottleCount(item)
	const previewList = Array.isArray(item?.back_bottles_preview) ? item.back_bottles_preview : []
	if (previewList.length > 0) {
		return formatBottlePreviewText(previewList, total, Boolean(item?.back_bottles_truncated))
	}
	return total > 0 ? formatBottleNoList(item?.back_items) : '无'
}

function resolveDepositDetailText(item) {
	const previewList = Array.isArray(item?.deposit_balance_bottles_preview)
		? item.deposit_balance_bottles_preview.map((row) => String(row || '').trim().toUpperCase()).filter(Boolean)
		: []
	if (previewList.length > 0) {
		const total = resolveDepositBalanceCount(item)
		const truncated = Boolean(item?.deposit_balance_bottles_truncated) || total > previewList.length
		const text = previewList.join('、')
		if (truncated) return `${text} 等${total}只`
		return text
	}
	const fallbackRows = Array.isArray(item?.deposit_rows) ? item.deposit_rows : (Array.isArray(item?.deposit_items) ? item.deposit_items : [])
	return formatBottleNoList(fallbackRows)
}

function priceTrendText(item) {
	const state = getSettlementState(item)
	return state.text
}

function priceTrendClass(item) {
	const state = getSettlementState(item)
	return state.className
}

function getSettlementState(item) {
	const shouldReceive = Number(item?.should_receive)
	const roundingAmount = Number(item?.rounding_amount)
	const amountReceived = Number(item?.amount_received)
	if (!Number.isFinite(shouldReceive) || !Number.isFinite(amountReceived)) return { text: '', className: '' }
	const effectiveShouldReceive = resolveEffectiveShouldReceive(
		shouldReceive,
		Number.isFinite(roundingAmount) ? roundingAmount : 0
	)
	const outstanding = Number((effectiveShouldReceive - amountReceived).toFixed(2))
	if (effectiveShouldReceive > 0) {
		if (outstanding > 0) return { text: '未收', className: 'price-trend--down' }
		if (outstanding < 0) return { text: '超收', className: 'price-trend--up' }
		return { text: '结清', className: 'price-trend--flat' }
	}
	if (effectiveShouldReceive < 0) {
		if (outstanding < 0) return { text: '应退未退', className: 'price-trend--warn' }
		if (outstanding > 0) return { text: '超退', className: 'price-trend--down' }
		return { text: '已退款', className: 'price-trend--up' }
	}
	if (amountReceived > 0) return { text: '预收', className: 'price-trend--up' }
	if (amountReceived < 0) return { text: '预退', className: 'price-trend--warn' }
	return { text: '结清', className: 'price-trend--flat' }
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function resolveEffectiveShouldReceive(shouldReceive, roundingAmount = 0) {
	const should = toNumber(shouldReceive, 0)
	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	if (should > 0) return Number((should - rounding).toFixed(2))
	if (should < 0) return Number((should + rounding).toFixed(2))
	return 0
}

function formatCount(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num < 0) return '0'
	return String(Math.round(num))
}

function formatNumber(value, maxFractionDigits = 2) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0'
	return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits })
}

function formatMoneyStat(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0'
	return formatNumber(num, 2)
}

function formatWeightStat(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0kg'
	if (Math.abs(num) >= 10000) return `${formatNumber(num / 1000, 2)}吨`
	return `${formatNumber(num, 2)}kg`
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

function buildListParams(page = 1, pageSize = 50) {
	return {
		keyword: filters.keyword,
		dateStart: filters.dateStart,
		dateEnd: filters.dateEnd,
		priceUnit: filters.priceUnit,
		bizMode: filters.bizMode,
		paymentStatus: filters.paymentStatus,
		settlementScope: filters.settlementScope,
		hasRemark: filters.hasRemark,
		remarkTag: filters.remarkTag,
		page,
		pageSize
	}
}

async function fetchAllRowsForExport() {
	const rows = []
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await listSalesV2(buildListParams(page, 50))
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const pageRows = Array.isArray(res.data) ? res.data : []
		rows.push(...pageRows)
		hasMore = Boolean(res?.paging?.hasMore)
		if (!pageRows.length) break
		page += 1
		guard += 1
	}
	return rows
}

function compareSaleRows(a, b) {
	const dateA = String(a?.date || '')
	const dateB = String(b?.date || '')
	if (dateA !== dateB) return dateA < dateB ? 1 : -1
	const createdA = Number(a?.created_at || 0)
	const createdB = Number(b?.created_at || 0)
	if (createdA !== createdB) return createdA < createdB ? 1 : -1
	const idA = String(a?._id || '')
	const idB = String(b?._id || '')
	if (idA !== idB) return idA < idB ? 1 : -1
	return 0
}

function escapeCsvValue(value) {
	const text = value == null ? '' : String(value)
	if (text.includes('"') || text.includes(',') || text.includes('\n')) {
		return `"${text.replace(/"/g, '""')}"`
	}
	return text
}

function formatMoneyCell(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	return num.toFixed(2)
}

function collectBottleNosByRows(rows) {
	if (!Array.isArray(rows)) return []
	const list = rows
		.map((row) => String(row?.bottle_no || row?.bottleNo || '').trim().toUpperCase())
		.filter(Boolean)
	const deduped = []
	const seen = new Set()
	for (const no of list) {
		if (seen.has(no)) continue
		seen.add(no)
		deduped.push(no)
	}
	return deduped
}

function formatBottleNoList(rows) {
	const list = collectBottleNosByRows(rows)
	return list.join('、')
}

function buildExportCsv(rows) {
	const headers = [
		'日期',
		'客户',
		'出瓶号',
		'回瓶号',
		'存瓶号',
		'出瓶净重(kg)',
		'回瓶净重(kg)',
		'净出气量(kg)',
		'单价',
		'应收金额',
		'实收金额',
		'抹零金额',
		'未收金额',
		'配送员',
		'车号',
		'收款状态',
		'业务备注',
		'系统备注',
		'收款备注'
	]
	const lines = [headers.map(escapeCsvValue).join(',')]
	for (const row of rows) {
		const shouldReceive = Number(row?.should_receive)
		const roundingAmount = Number(row?.rounding_amount)
		const amountReceived = Number(row?.amount_received)
		const effectiveShouldReceive = Number.isFinite(shouldReceive)
			? resolveEffectiveShouldReceive(shouldReceive, Number.isFinite(roundingAmount) ? roundingAmount : 0)
			: null
		const outstanding = Number.isFinite(effectiveShouldReceive) && Number.isFinite(amountReceived)
			? Number((effectiveShouldReceive - amountReceived).toFixed(2))
			: null
		const outItems = Array.isArray(row?.out_items) ? row.out_items : []
		const backItems = Array.isArray(row?.back_items) ? row.back_items : []
		const depositRows = Array.isArray(row?.deposit_rows)
			? row.deposit_rows
			: (Array.isArray(row?.deposit_items) ? row.deposit_items : [])
		const carNo = String(row?.car_no || row?.truck_no || '').trim()
		const cells = [
			row?.date || '',
			row?.customer_name || '',
			formatBottleNoList(outItems),
			formatBottleNoList(backItems),
			formatBottleNoList(depositRows),
			formatMoneyCell(row?.out_net_total),
			formatMoneyCell(row?.back_net_total),
			formatMoneyCell(row?.total_net_weight),
			formatMoneyCell(row?.unit_price),
			formatMoneyCell(row?.should_receive),
			formatMoneyCell(row?.amount_received),
			formatMoneyCell(row?.rounding_amount),
			formatMoneyCell(outstanding),
			row?.delivery_man || '',
			carNo,
			paymentStatusText(row?.payment_status),
			String(row?.remark || '').trim(),
			String(row?.system_note || '').trim(),
			String(row?.payment_note || '').trim()
		]
		lines.push(cells.map(escapeCsvValue).join(','))
	}
	return lines.join('\n')
}

function formatNowForFile() {
	const now = new Date()
	const y = now.getFullYear()
	const m = String(now.getMonth() + 1).padStart(2, '0')
	const d = String(now.getDate()).padStart(2, '0')
	const hh = String(now.getHours()).padStart(2, '0')
	const mm = String(now.getMinutes()).padStart(2, '0')
	const ss = String(now.getSeconds()).padStart(2, '0')
	return `${y}${m}${d}_${hh}${mm}${ss}`
}

function sanitizeFilePart(value) {
	return String(value || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '')
}

function buildExportFileName(total) {
	const parts = ['销售导出']
	if (filters.bizMode) parts.push(`模式-${bizModeText(filters.bizMode)}`)
	if (filters.priceUnit) parts.push(`单位-${filters.priceUnit}`)
	if (filters.paymentStatus) {
		const label = paymentStatusOptions.find((item) => item.value === filters.paymentStatus)?.label || filters.paymentStatus
		parts.push(`付款-${label}`)
	}
	if (filters.settlementScope) {
		parts.push(`口径-${settlementScopeTextMap[filters.settlementScope] || filters.settlementScope}`)
	}
	if (filters.hasRemark) {
		const label = hasRemarkOptions.find((item) => item.value === filters.hasRemark)?.label || filters.hasRemark
		parts.push(`备注-${label}`)
	}
	if (filters.remarkTag) {
		const label = remarkTagOptions.find((item) => item.value === filters.remarkTag)?.label || filters.remarkTag
		parts.push(`标签-${label}`)
	}
	if (filters.dateStart || filters.dateEnd) parts.push(`日期-${filters.dateStart || '起'}_${filters.dateEnd || '今'}`)
	if (filters.keyword) parts.push(`关键词-${filters.keyword}`)
	parts.push(`${formatCount(total)}条`)
	parts.push(formatNowForFile())
	return `${parts.map((item) => sanitizeFilePart(item)).filter(Boolean).join('_')}.csv`
}

function downloadCsvOnH5(csvText, fileName) {
	if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Blob === 'undefined') return false
	const blob = new Blob([`\uFEFF${csvText}`], { type: 'text/csv;charset=utf-8;' })
	const url = window.URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	document.body.appendChild(anchor)
	anchor.click()
	document.body.removeChild(anchor)
	window.URL.revokeObjectURL(url)
	return true
}

async function onExport() {
	if (exporting.value) return
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const rows = await fetchAllRowsForExport()
		if (!rows.length) {
			uni.showToast({ title: '没有可导出的数据', icon: 'none' })
			return
		}
		const sortedRows = [...rows].sort(compareSaleRows)
		const csvText = buildExportCsv(sortedRows)
		const fileName = buildExportFileName(sortedRows.length)
		const downloaded = downloadCsvOnH5(csvText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持下载，请在浏览器端导出', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: `已导出${sortedRows.length}条`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2800 })
	} finally {
		uni.hideLoading()
		exporting.value = false
	}
}

function applyRoutePreset(params = {}, autoSearch = true) {
	const hasRemarkValue = String(params?.hasRemark || '').trim()
	const remarkTagValue = String(params?.remarkTag || '').trim()
	const hasRemarkOptionIndex = hasRemarkOptions.findIndex((item) => item.value === hasRemarkValue)
	const remarkTagOptionIndex = remarkTagOptions.findIndex((item) => item.value === remarkTagValue)
	if (hasRemarkOptionIndex >= 0) {
		hasRemarkIndex.value = hasRemarkOptionIndex
		filters.hasRemark = hasRemarkOptions[hasRemarkOptionIndex].value
	}
	if (remarkTagOptionIndex >= 0) {
		remarkTagIndex.value = remarkTagOptionIndex
		filters.remarkTag = remarkTagOptions[remarkTagOptionIndex].value
	}
	if (autoSearch) onSearch(true)
}

onMounted(() => {
	applyRoutePreset(
		{
			hasRemark: props.presetHasRemark,
			remarkTag: props.presetRemarkTag
		},
		false
	)
	syncDatePreset()
	onSearch()
})

watch(
	() => [props.presetHasRemark, props.presetRemarkTag],
	([hasRemark, remarkTag]) => {
		if (!hasRemark && !remarkTag) return
		applyRoutePreset({ hasRemark, remarkTag }, true)
	}
)

defineExpose({
	refresh: refreshList,
	applyRoutePreset
})
</script>

<style scoped>
.list-shell {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.quick-date-strip {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	overflow-x: auto;
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

:deep(.summary-card--active) {
	border-color: #93c5fd;
	box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.25);
}

:deep(.summary-card--outstanding-positive .stat__value) {
	color: #b91c1c;
}

:deep(.summary-card--receivable .stat__value) {
	color: #b91c1c;
}

:deep(.summary-card--refund .stat__value) {
	color: #b45309;
}

:deep(.summary-card--outstanding-negative .stat__value) {
	color: #b45309;
}

:deep(.summary-card--outstanding-zero .stat__value) {
	color: #0f172a;
}

:deep(.summary-card--outstanding .stat__hint) {
	max-width: 220rpx;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

:deep(.filter-section.section) {
	overflow: visible;
	position: relative;
	z-index: 30;
}

:deep(.filter-section .section__body) {
	overflow: visible;
}

.picker-block {
	display: block;
	width: 100%;
	overflow: hidden;
}

.picker-field {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.picker-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
	font-weight: 400;
}

.search-field {
	position: relative;
	z-index: 40;
}

.picker-tap {
	display: block;
	width: 100%;
}

.picker-tap :deep(.field) {
	pointer-events: none;
}

.picker-tap :deep(.field__control) {
	min-height: 64rpx;
}

.suggestions {
	position: absolute;
	top: calc(100% + 8rpx);
	left: 0;
	right: 0;
	z-index: 80;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.08);
	max-height: 320rpx;
	overflow: auto;
}

.suggestion-item {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	padding: 14rpx 16rpx;
	border-bottom: 1rpx solid #f1f5f9;
}

.suggestion-item:last-child {
	border-bottom: none;
}

.suggestion-item:active {
	background: #f8fafc;
}

.suggestion-text {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.suggestion-sub {
	font-size: 20rpx;
	color: var(--crm-text-muted);
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

.price-box {
	display: flex;
	align-items: baseline;
	gap: 6px;
}

.price-symbol {
	font-size: 12px;
	color: #94a3b8;
}

.price-value {
	font-size: 18px;
	font-weight: 700;
	color: var(--crm-primary);
}

.price-trend {
	font-size: 11px;
	padding: 2px 6px;
	border-radius: 999px;
	background: #f1f5f9;
	color: #64748b;
}

.price-trend--up {
	background: rgba(22, 163, 74, 0.12);
	color: #166534;
}

.price-trend--down {
	background: rgba(220, 38, 38, 0.12);
	color: #991b1b;
}

.price-trend--flat {
	background: rgba(148, 163, 184, 0.2);
	color: #475569;
}

.price-trend--warn {
	background: rgba(245, 158, 11, 0.16);
	color: #92400e;
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;
}

.sale-meta-stack {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	width: 100%;
}

.sale-mini-amounts {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 2px;
	font-size: 12px;
	color: #0f172a;
	width: 100%;
}

.sale-mini-amounts__movement {
	color: #475569;
}

.sale-mini-amounts__detail,
.sale-mini-amounts__deposit {
	color: #64748b;
	min-width: 0;
	max-width: 100%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.remark-summary {
	margin-top: 8px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.remark-summary__text {
	font-size: 12px;
	color: #475569;
	line-height: 1.4;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.remark-summary__tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.mode-badge {
	font-size: 11px;
	color: #fff;
	background: #94a3b8;
	padding: 2px 8px;
	border-radius: 999px;
	font-weight: 700;
	text-transform: uppercase;
}

:deep(.sale-item) {
	padding: 12px 14px;
	border-radius: 14px;
}

:deep(.sale-item .item__main) {
	gap: 14px;
}

:deep(.sale-item .item__row) {
	gap: 12px;
}

:deep(.sale-item .item__title),
:deep(.sale-item .item__subtitle) {
	display: none;
}

:deep(.sale-item .item__meta) {
	margin-top: 4px;
}

.sale-header {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.sale-title {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.sale-name {
	font-size: 15px;
	font-weight: 700;
	color: #0f172a;
}

.sale-date {
	font-size: 12px;
	color: #94a3b8;
}

.sale-subtitle {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	font-size: 12px;
	color: #64748b;
}

.sale-meta {
	background: #f8fafc;
	padding: 2px 8px;
	border-radius: 999px;
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
