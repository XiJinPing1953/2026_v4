<template>
	<AppPage title="流转记录" subtitle="瓶子流转事件流" icon="list">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch(false)">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="记录总数" :value="summary.total" hint="条" icon="list" />
				<AppStatCard class="summary-card" label="出瓶" :value="summary.out" hint="条" icon="document" @click="onSummaryFilter('out')" />
				<AppStatCard class="summary-card" label="回瓶" :value="summary.back" hint="条" icon="bottle" @click="onSummaryFilter('back')" />
				<AppStatCard class="summary-card" label="灌装" :value="summary.fill" hint="条" icon="plus" @click="onSummaryFilter('fill')" />
			</view>
		</template>

		<view class="view-body">
			<AppSection title="记录筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>
				<view class="filter-grid">
					<view class="filter-bottle-wrap">
						<AppInput
							v-model="filters.bottleNo"
							label="瓶号"
							placeholder="输入瓶号联想钢瓶档案"
							size="sm"
							confirm-type="search"
							@input="onBottleInput"
							@focus="onBottleFocus"
							@blur="onBottleBlur"
							@confirm="onBottleConfirm"
						/>
						<view v-if="filterBottleSuggestions.length" class="filter-suggestions">
							<view
								v-for="item in filterBottleSuggestions"
								:key="`movement-filter-${item._id || item.bottle_no}`"
								class="filter-suggestion-item"
								@tap.stop="selectBottleSuggestion(item)"
							>
								<text class="filter-suggestion-no">{{ item.bottle_no }}</text>
								<text class="filter-suggestion-sub">{{ formatBottleSuggestionSub(item) }}</text>
							</view>
						</view>
					</view>
					<picker class="picker-block" mode="selector" :range="typeOptions" range-key="label" @change="onTypeChange">
						<view class="picker-trigger">
							<AppInput :model-value="typeLabel" label="类型" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="selector" :range="sourceOptions" range-key="label" @change="onSourceChange">
						<view class="picker-trigger">
							<AppInput :model-value="sourceLabel" label="来源" disabled size="sm" />
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
			</AppSection>

			<AppSection title="流转列表">
				<template #actions>
					<text class="section-hint">共 {{ total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无流转记录">
					<AppListItem
						v-for="item in list"
						:key="item._id || `${item.source_type}:${item.source_id || ''}:${item.bottle_no}:${item.event_at}:${item.type}`"
						:title="item.bottle_no + ' · ' + typeText(item.type)"
						:subtitle="displayEventDay(item)"
						icon="list"
						:icon-class="typeIconClass(item.type)"
						clickable
						@click="onOpenTimeline(item)"
					>
						<template #meta>
								<view class="meta-tags">
									<AppTag kind="soft">{{ sourceText(item.source_type) }}</AppTag>
									<text v-if="item.net_weight != null" class="meta-text">净重 {{ item.net_weight }} kg</text>
									<text v-if="buildLossWeightText(item)" class="meta-text">{{ buildLossWeightText(item) }}</text>
									<text v-if="item.note" class="meta-text">{{ item.note }}</text>
								</view>
							</template>
					</AppListItem>
				</AppList>

				<view class="pager-row">
					<view class="pager-left">
						<picker class="picker-block pager-size-picker" mode="selector" :range="pageSizeOptions" range-key="label" @change="onPageSizeChange">
							<view class="picker-trigger">
								<AppInput :model-value="pageSizeLabel" label="每页" disabled size="sm" />
							</view>
						</picker>
					</view>
					<view class="pager-actions">
						<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
						<AppButton size="sm" kind="neutral" :disabled="loading || pager.page >= totalPages" @click="onNextPage">下一页</AppButton>
					</view>
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
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { searchBottleSuggestions } from '@/composables/useBottleSuggestions'
import { listBottleMovementsV1 } from '@/services/bottleMovement'

const list = ref([])
const total = ref(0)
const summary = ref({ total: 0, out: 0, back: 0, fill: 0, adjust: 0 })

const typeOptions = [
	{ label: '全部类型', value: '' },
	{ label: '出瓶', value: 'out' },
	{ label: '回瓶', value: 'back' },
	{ label: '灌装', value: 'fill' },
	{ label: '调整', value: 'adjust' }
]

const sourceOptions = [
	{ label: '全部来源', value: '' },
	{ label: '销售单', value: 'sale' },
	{ label: '灌装单', value: 'filling' },
	{ label: '手工修复', value: 'manual_fix' },
	{ label: '手工录入', value: 'manual' }
]

const pageSizeOptions = [
	{ label: '20 条', value: 20 },
	{ label: '50 条', value: 50 },
	{ label: '100 条', value: 100 },
	{ label: '200 条', value: 200 }
]
const STATUS_LABEL_MAP = {
	unknown: '未知',
	in_station: '在站',
	at_customer: '在客户',
	scrapped: '报废',
	lost: '丢失'
}

const filters = reactive({
	bottleNo: '',
	typeIndex: 0,
	sourceIndex: 0,
	dateStart: '',
	dateEnd: ''
})
const filterBottleSuggestions = ref([])
const filterBottleSuggestLoading = ref(false)
let filterBottleSuggestTimer = 0

const pager = reactive({
	page: 1,
	pageSizeIndex: 1
})

const typeLabel = computed(() => typeOptions[filters.typeIndex]?.label || '全部类型')
const sourceLabel = computed(() => sourceOptions[filters.sourceIndex]?.label || '全部来源')
const pageSizeLabel = computed(() => pageSizeOptions[pager.pageSizeIndex]?.label || '50 条')
const pageSizeValue = computed(() => Number(pageSizeOptions[pager.pageSizeIndex]?.value || 50))
const totalPages = computed(() => {
	const pages = Math.ceil(Number(total.value || 0) / pageSizeValue.value)
	return pages > 0 ? pages : 1
})

function buildSummary(raw) {
	const base = { total: 0, out: 0, back: 0, fill: 0, adjust: 0 }
	if (!raw || typeof raw !== 'object') return base
	return {
		total: Number(raw.total || 0),
		out: Number(raw.out || 0),
		back: Number(raw.back || 0),
		fill: Number(raw.fill || 0),
		adjust: Number(raw.adjust || 0)
	}
}

function normalizeBottleNo(value) {
	if (value == null) return ''
	return String(value).trim().toUpperCase().replace(/\s+/g, '')
}

function getStatusLabel(value) {
	const key = String(value == null ? '' : value).trim()
	return STATUS_LABEL_MAP[key] || '未知'
}

function formatBottleSuggestionSub(item) {
	const status = getStatusLabel(item && item.status)
	const customer = String(item?.current_customer_name == null ? '' : item.current_customer_name).trim()
	return customer ? `${status} · ${customer}` : status
}

function normalizeDay(value) {
	const m = String(value == null ? '' : value).trim().match(/^(\d{4}-\d{2}-\d{2})/)
	return m ? m[1] : ''
}

function displayEventDay(item) {
	const eventDay = normalizeDay(item && item.event_day)
	if (eventDay) return eventDay
	const fallbackDay = normalizeDay(item && item.date)
	if (fallbackDay) return fallbackDay
	return '-'
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listBottleMovementsV1({
			bottleNo: filters.bottleNo,
			type: typeOptions[filters.typeIndex]?.value || '',
			sourceType: sourceOptions[filters.sourceIndex]?.value || '',
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			page: pager.page,
			pageSize: pageSizeValue.value
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				total: 0,
				summary: buildSummary(null)
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			total: Number(res.total || 0),
			summary: buildSummary(res.summary)
		}
	},
	{
		immediate: false,
		initialData: { items: [], total: 0, summary: buildSummary(null) },
		cacheTTL: 6000,
		throttleMs: 300,
		cacheKey: () =>
			`movement:list:${filters.bottleNo}:${filters.typeIndex}:${filters.sourceIndex}:${filters.dateStart}:${filters.dateEnd}:${pager.page}:${pageSizeValue.value}`
	}
)

function applyResult(payload) {
	const data = payload || {}
	list.value = Array.isArray(data.items) ? data.items : []
	total.value = Number(data.total || 0)
	summary.value = buildSummary(data.summary)
}

function clearFilterBottleSuggestTimer() {
	if (!filterBottleSuggestTimer) return
	clearTimeout(filterBottleSuggestTimer)
	filterBottleSuggestTimer = 0
}

function clearFilterBottleSuggestions() {
	filterBottleSuggestions.value = []
	filterBottleSuggestLoading.value = false
	clearFilterBottleSuggestTimer()
}

async function fetchFilterBottleSuggestions(keyword) {
	const targetKeyword = String(keyword == null ? '' : keyword).trim()
	if (!targetKeyword) {
		filterBottleSuggestions.value = []
		filterBottleSuggestLoading.value = false
		return
	}
	filterBottleSuggestLoading.value = true
	try {
		const suggestions = await searchBottleSuggestions(targetKeyword, { limit: 20 })
		if (normalizeBottleNo(filters.bottleNo) !== normalizeBottleNo(targetKeyword)) return
		filterBottleSuggestions.value = suggestions
	} finally {
		filterBottleSuggestLoading.value = false
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	clearFilterBottleSuggestions()
	const data = await fetchList()
	applyResult(data)
}

function initDateRange() {
	const end = new Date()
	const start = new Date()
	start.setDate(start.getDate() - 30)
	const fmt = (d) => {
		const y = d.getFullYear()
		const m = String(d.getMonth() + 1).padStart(2, '0')
		const day = String(d.getDate()).padStart(2, '0')
		return `${y}-${m}-${day}`
	}
	filters.dateStart = fmt(start)
	filters.dateEnd = fmt(end)
}

function onReset() {
	filters.bottleNo = ''
	filters.typeIndex = 0
	filters.sourceIndex = 0
	pager.page = 1
	pager.pageSizeIndex = 1
	clearFilterBottleSuggestions()
	initDateRange()
	onSearch(false)
}

function onBottleInput(value) {
	const text = String(value == null ? '' : value).trim()
	clearFilterBottleSuggestTimer()
	if (!text) {
		filterBottleSuggestions.value = []
		return
	}
	filterBottleSuggestTimer = setTimeout(() => {
		fetchFilterBottleSuggestions(text)
	}, 180)
}

function onBottleFocus() {
	const text = String(filters.bottleNo == null ? '' : filters.bottleNo).trim()
	if (!text) return
	clearFilterBottleSuggestTimer()
	filterBottleSuggestTimer = setTimeout(() => {
		fetchFilterBottleSuggestions(text)
	}, 120)
}

function onBottleBlur() {
	setTimeout(() => {
		filterBottleSuggestions.value = []
	}, 160)
}

function onBottleConfirm() {
	const normalized = normalizeBottleNo(filters.bottleNo)
	if (normalized) filters.bottleNo = normalized
	clearFilterBottleSuggestions()
	onSearch(true)
}

function selectBottleSuggestion(item) {
	const bottleNo = normalizeBottleNo(item?.bottle_no)
	if (!bottleNo) return
	filters.bottleNo = bottleNo
	clearFilterBottleSuggestions()
}

function onTypeChange(e) {
	const idx = Number(e?.detail?.value)
	filters.typeIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onSourceChange(e) {
	const idx = Number(e?.detail?.value)
	filters.sourceIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onDateStartChange(e) {
	filters.dateStart = e?.detail?.value || ''
}

function onDateEndChange(e) {
	filters.dateEnd = e?.detail?.value || ''
}

function onPageSizeChange(e) {
	const idx = Number(e?.detail?.value)
	pager.pageSizeIndex = Number.isFinite(idx) ? idx : 1
	pager.page = 1
	onSearch(false)
}

function onPrevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	onSearch(false)
}

function onNextPage() {
	if (pager.page >= totalPages.value) return
	pager.page += 1
	onSearch(false)
}

function onSummaryFilter(type) {
	const idx = typeOptions.findIndex((item) => item.value === type)
	filters.typeIndex = idx > -1 ? idx : 0
	onSearch(true)
}

function typeText(type) {
	const map = {
		out: '出瓶',
		back: '回瓶',
		fill: '灌装',
		adjust: '调整'
	}
	return map[type] || type || '-'
}

function sourceText(sourceType) {
	const map = {
		sale: '销售单',
		filling: '灌装单',
		manual_fix: '手工修复',
		manual: '手工录入'
	}
	return map[sourceType] || sourceType || '-'
}

function typeIconClass(type) {
	if (type === 'out') return 'bg-teal'
	if (type === 'back') return 'bg-emerald'
	if (type === 'fill') return 'bg-success'
	if (type === 'adjust') return 'bg-info'
	return 'bg-primary'
}

function buildLossWeightText(item) {
	const value = Number(item && item.loss_weight)
	if (!Number.isFinite(value) || value === 0) return ''
	if (value > 0) return `损耗 ${value} kg`
	return `胀重 ${Math.abs(value)} kg`
}

function onOpenTimeline(item) {
	const bottleNo = normalizeBottleNo(item && item.bottle_no)
	if (!bottleNo) return
	uni.navigateTo({ url: `/pages/bottle/timeline?bottle_no=${encodeURIComponent(bottleNo)}` })
}

onMounted(() => {
	initDateRange()
	onSearch(true)
})

defineExpose({
	refresh: () => onSearch(false)
})
</script>

<style scoped>
.view-body {
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

.filter-bottle-wrap {
	position: relative;
}

.picker-block {
	display: block;
	width: 100%;
}

.picker-trigger {
	pointer-events: none;
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

.filter-suggestions {
	position: absolute;
	left: 0;
	right: 0;
	top: calc(100% + 8rpx);
	z-index: 20;
	display: flex;
	flex-direction: column;
	border: 1rpx solid rgba(15, 23, 42, 0.08);
	border-radius: 24rpx;
	background: #fff;
	box-shadow: 0 16rpx 40rpx rgba(15, 23, 42, 0.12);
	overflow: hidden;
}

.filter-suggestion-item {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 18rpx 24rpx;
	border-bottom: 1rpx solid rgba(15, 23, 42, 0.06);
}

.filter-suggestion-item:last-child {
	border-bottom: none;
}

.filter-suggestion-item:active {
	background: rgba(14, 116, 144, 0.08);
}

.filter-suggestion-no {
	font-size: 28rpx;
	font-weight: 600;
	color: var(--crm-text);
}

.filter-suggestion-sub {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.pager-row {
	margin-top: 12rpx;
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 16rpx;
	flex-wrap: wrap;
}

.pager-left {
	width: 220rpx;
	max-width: 100%;
}

.pager-size-picker {
	width: 100%;
}

.pager-actions {
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

	.pager-left {
		width: 100%;
	}
}
</style>
