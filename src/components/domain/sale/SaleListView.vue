<template>
	<AppPage title="销售记录" :subtitle="subtitle" icon="list">
		<template #headerActions>
			<AppButton size="sm" kind="primary" @click="onAdd" icon="plus">新建销售单</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="筛选结果" :value="summary.total" hint="单" icon="document" />
				<AppStatCard class="summary-card" label="已结清" :value="summary.paid" hint="单" icon="check-circle" />
				<AppStatCard class="summary-card" label="未付款" :value="summary.unpaid" hint="单" icon="minus-circle" />
				<AppStatCard class="summary-card" label="部分付" :value="summary.partial" hint="单" icon="alert" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="筛选条件">
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
								v-for="(item, index) in suggestions"
								:key="index"
								class="suggestion-item"
								@tap="selectSuggestion(item)"
							>
								<text class="suggestion-text">{{ item.name }}</text>
								<text class="suggestion-sub">{{ item.phone || '客户' }}</text>
							</view>
						</view>
					</view>

					<picker class="picker-block" mode="date" @change="e => filters.dateStart = e.detail.value">
						<AppInput v-model="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="e => filters.dateEnd = e.detail.value">
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
									<text class="sale-meta">{{ paymentMethodText(item.payment_method) }}</text>
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
							<view class="meta-tags">
								<AppTag kind="soft">{{ item.price_unit }}</AppTag>
								<AppTag kind="soft">{{ paymentMethodText(item.payment_method) }}</AppTag>
								<text v-if="item.biz_mode !== 'bottle'" class="mode-badge">
									{{ item.biz_mode === 'truck' ? '整车' : '代理' }}
								</text>
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
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { listSalesV2 } from '@/services/sale'
import { listCustomersV1 } from '@/services/customer'

const list = ref([])
const summary = ref({ total: 0, paid: 0, partial: 0, unpaid: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})
const showSuggestions = ref(false)
const suggestions = ref([])
let searchTimer = null

const filters = reactive({
	keyword: '',
	dateStart: '',
	dateEnd: '',
	priceUnit: '',
	bizMode: ''
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
const priceUnitIndex = ref(0)
const bizModeIndex = ref(0)

const subtitle = computed(() => {
	if (!pager.total) return '按客户与日期检索'
	return `当前筛选 ${pager.total} 条`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
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
	return chips
})

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'date') {
		filters.dateStart = ''
		filters.dateEnd = ''
	}
	if (key === 'priceUnit') {
		filters.priceUnit = ''
		priceUnitIndex.value = 0
	}
	if (key === 'bizMode') {
		filters.bizMode = ''
		bizModeIndex.value = 0
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
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, paid: 0, partial: 0, unpaid: 0 }
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
			summary: res.summary || { total: 0, paid: 0, partial: 0, unpaid: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, paid: 0, partial: 0, unpaid: 0 }
		},
		cacheTTL: 10000,
		throttleMs: 300,
		cacheKey: () =>
			`sale:list:${filters.keyword}:${filters.dateStart}:${filters.dateEnd}:${filters.priceUnit}:${filters.bizMode}:${pager.page}:${pager.pageSize}`
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
		partial: Number(summaryData.partial || 0),
		unpaid: Number(summaryData.unpaid || 0)
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
	filters.priceUnit = ''
	filters.bizMode = ''
	priceUnitIndex.value = 0
	bizModeIndex.value = 0
	onSearch(true)
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
			const res = await listCustomersV1({ keyword: val, page: 1, pageSize: 10 })
			if (res?.code === 0) suggestions.value = res.data || []
		} catch (e) {
			console.error(e)
		}
	}, 300)
}

function onKeywordConfirm() {
	if (suggestions.value.length > 0) {
		selectSuggestion(suggestions.value[0])
	}
}

function selectSuggestion(item) {
	filters.keyword = item.name
	showSuggestions.value = false
	onSearch(true)
}

function onSearchBlur() {
	setTimeout(() => {
		showSuggestions.value = false
	}, 200)
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

function onAdd() {
	uni.navigateTo({ url: '/pages/sale/edit' })
}

function onDetail(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/sale/detail?_id=${encodeURIComponent(item._id)}` })
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

function paymentMethodText(value) {
	const map = {
		on_account: '挂账',
		cash: '现金',
		bank: '银行',
		wechat: '微信',
		alipay: '支付宝'
	}
	return map[value] || value
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

function priceTrendText(item) {
	if (!item?.should_receive || !item?.amount_received) return ''
	const diff = Number(item.amount_received) - Number(item.should_receive)
	if (diff > 0) return '超收'
	if (diff < 0) return '未收'
	return '结清'
}

function priceTrendClass(item) {
	if (!item?.should_receive || !item?.amount_received) return ''
	const diff = Number(item.amount_received) - Number(item.should_receive)
	if (diff > 0) return 'price-trend--up'
	if (diff < 0) return 'price-trend--down'
	return 'price-trend--flat'
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
	top: calc(100% + 6px);
	left: 0;
	right: 0;
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 14px;
	box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
	z-index: 1000;
	max-height: 320px;
	overflow-y: auto;
}

.suggestion-item {
	padding: 12px 14px;
	border-bottom: 1px solid #f1f5f9;
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.suggestion-item:active {
	background: #f8fafc;
}

.suggestion-text {
	font-size: 14px;
	color: #0f172a;
	font-weight: 600;
}

.suggestion-sub {
	font-size: 12px;
	color: #94a3b8;
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

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;
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
