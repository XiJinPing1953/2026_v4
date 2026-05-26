<template>
	<AppPage title="理论损耗统计" subtitle="按 回瓶 + 灌装 - 上秤差 - 出瓶 计算" icon="chart">
		<template #headerActions>
			<AppButton v-if="activeSummaryFilter" size="sm" kind="ghost" :disabled="cycleLoading" @click="clearSummaryFilter">清除卡片筛选</AppButton>
			<AppButton size="sm" kind="neutral" icon="document" :disabled="loading || exporting || manualLoading" @click="onExport">导出</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch(false)">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					:class="['summary-card', { 'summary-card--active': isSummaryFilterActive(SUMMARY_FILTER_KEYS.CYCLE_LOSS) }]"
					label="总损耗"
					:value="formatKg(totalLossKg)"
					hint="kg"
					icon="alert"
					@click="onSummaryCardFilter(SUMMARY_FILTER_KEYS.CYCLE_LOSS)"
				/>
				<AppStatCard
					:class="['summary-card', { 'summary-card--active': isSummaryFilterActive(SUMMARY_FILTER_KEYS.CYCLE_SWELL) }]"
					label="总胀重"
					:value="formatKg(totalSwellKg)"
					hint="kg"
					icon="plus"
					@click="onSummaryCardFilter(SUMMARY_FILTER_KEYS.CYCLE_SWELL)"
				/>
				<AppStatCard
					:class="['summary-card', { 'summary-card--active': isSummaryFilterActive(SUMMARY_FILTER_KEYS.CYCLE_ALL) }]"
					label="完整周期"
					:value="summary.cycle_count"
					hint="轮"
					icon="list"
					@click="onSummaryCardFilter(SUMMARY_FILTER_KEYS.CYCLE_ALL)"
				/>
				<AppStatCard
					:class="['summary-card', { 'summary-card--active': isSummaryFilterActive(SUMMARY_FILTER_KEYS.INCOMPLETE) }]"
					label="链路不完整"
					:value="summary.incomplete_count"
					hint="条"
					icon="bottle"
					@click="onSummaryCardFilter(SUMMARY_FILTER_KEYS.INCOMPLETE)"
				/>
				<AppStatCard
					:class="['summary-card', { 'summary-card--active': isSummaryFilterActive(SUMMARY_FILTER_KEYS.MANUAL_LOSS) }]"
					label="修复/上秤损耗"
					:value="formatKg(manualLoss.summary.total_loss_kg)"
					hint="kg"
					icon="alert"
					@click="onSummaryCardFilter(SUMMARY_FILTER_KEYS.MANUAL_LOSS)"
				/>
				<AppStatCard
					:class="['summary-card', { 'summary-card--active': isSummaryFilterActive(SUMMARY_FILTER_KEYS.MANUAL_SWELL) }]"
					label="修复/上秤胀重"
					:value="formatKg(manualLoss.summary.total_swell_kg)"
					hint="kg"
					icon="plus"
					@click="onSummaryCardFilter(SUMMARY_FILTER_KEYS.MANUAL_SWELL)"
				/>
			</view>
		</template>

		<view class="view-body">
			<view class="quick-date-strip">
				<AppDatePresetBar v-model="datePreset" @update:modelValue="onDatePresetChange" />
			</view>
			<AppSection title="筛选条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" :disabled="loading" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" :disabled="loading" @click="onSearch(true)">查询</AppButton>
				</template>
				<view class="filter-grid">
					<AppInput v-model="filters.bottle_no" label="瓶号" placeholder="输入瓶号" prefix-icon="search" size="sm" />
					<AppInput v-model="filters.customer_name" label="客户名称" placeholder="输入客户名称" prefix-icon="search" size="sm" />
					<picker class="picker-block" mode="date" @change="onDateStartChange">
						<AppInput :model-value="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="onDateEndChange">
						<AppInput :model-value="filters.dateEnd" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
				</view>
			</AppSection>

			<AppSection v-if="showAnomalySection" title="异常TOP">
				<template #actions>
					<text class="section-hint">{{ anomalyTopScopeHint }}</text>
				</template>
				<view class="anomaly-top-grid">
					<view class="anomaly-top-card">
						<view class="anomaly-top-head">
							<text class="anomaly-top-title">单次异常TOP</text>
							<AppButton
								size="sm"
								kind="ghost"
								:disabled="anomalyTopLoading || anomalyTop.singleTotal <= 0"
								@click="openAnomalyDrawer('single')"
							>
								查看全部
							</AppButton>
						</view>
						<AppList
							:loading="anomalyTopLoading"
							:empty="anomalyTop.single.length === 0"
							:empty-title="searched ? '暂无单次异常记录' : '查询后可查看单次异常TOP'"
						>
							<AppListItem
								v-for="(item, index) in anomalyTop.single"
								:key="`single-${item.source_id || item.bottle_no || '-'}-${item.event_day || '-'}-${index}`"
								:title="`${item.event_day || '-'} · 瓶号 ${item.bottle_no || '-'}`"
								:subtitle="buildAnomalySingleSubtitle(item)"
								:status="buildDeltaLabel(item.delta_kg)"
								:status-kind="buildDeltaKind(item.delta_kg)"
								icon="alert"
								:icon-class="buildDeltaIconClass(item.delta_kg)"
							/>
						</AppList>
					</view>
					<view class="anomaly-top-card">
						<view class="anomaly-top-head">
							<text class="anomaly-top-title">瓶号累计异常TOP</text>
							<AppButton
								size="sm"
								kind="ghost"
								:disabled="anomalyTopLoading || anomalyTop.bottleTotal <= 0"
								@click="openAnomalyDrawer('bottle')"
							>
								查看全部
							</AppButton>
						</view>
						<AppList
							:loading="anomalyTopLoading"
							:empty="anomalyTop.bottle.length === 0"
							:empty-title="searched ? '暂无累计异常记录' : '查询后可查看累计异常TOP'"
						>
							<AppListItem
								v-for="(item, index) in anomalyTop.bottle"
								:key="`bottle-${item.bottle_no || '-'}-${index}`"
								:title="`瓶号 ${item.bottle_no || '-'}`"
								:subtitle="buildAnomalyBottleSubtitle(item)"
								:status="`${formatKg(item.total_abs_delta_kg)} kg`"
								status-kind="danger"
								icon="bottle"
								icon-class="bg-danger"
							/>
						</AppList>
					</view>
				</view>
			</AppSection>

			<AppSection v-if="showCycleSection" :title="cycleSectionTitle">
				<template #actions>
					<text class="section-hint">{{ cycleScopeHint }} · 共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>
				<AppList :loading="cycleLoading" :empty="list.length === 0" :empty-title="mainEmptyTitle">
					<AppListItem
						v-for="(item, index) in list"
						:key="item.source_out_id || `${item.out_date || '-'}:${item.bottle_no || '-'}:${index}`"
						:title="`${item.out_date || '-'} · 瓶号 ${item.bottle_no || '-'}`"
						:subtitle="buildCycleSubtitle(item)"
						:status="buildDeltaLabel(item.delta_kg)"
						:status-kind="buildDeltaKind(item.delta_kg)"
						icon="alert"
						:icon-class="buildDeltaIconClass(item.delta_kg)"
					>
						<template #meta>
							<view class="meta-tags">
								<AppTag :kind="buildResultKind(item.result_type)">{{ buildResultLabel(item.result_type) }}</AppTag>
								<AppTag kind="soft">灌装 {{ item.fill_count || 0 }} 次</AppTag>
								<AppTag v-if="round2(item.start_loss_sum_kg) !== 0" kind="soft">上秤差 {{ formatKg(item.start_loss_sum_kg) }} kg</AppTag>
								<text class="meta-text">理论 {{ formatKg(item.theoretical_out_kg) }} kg</text>
								<text class="meta-text">实际 {{ formatKg(item.out_net_kg) }} kg</text>
							</view>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="cycleLoading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="cycleLoading || !pager.hasMore" @click="onNextPage">下一页</AppButton>
				</view>
			</AppSection>

			<AppSection v-if="showManualSection" :title="manualSectionTitle">
				<template #actions>
					<text class="section-hint">
						{{ manualScopeHint }}
					</text>
				</template>
				<AppList :loading="manualLoading" :empty="manualLoss.list.length === 0" :empty-title="searched ? '暂无修复/上秤差值记录' : '查询后可查看修复/上秤差值明细'">
					<AppListItem
						v-for="(item, index) in manualLoss.list"
						:key="item._id || `${item.event_day || '-'}:${item.bottle_no || '-'}:${index}`"
						:title="`${item.event_day || '-'} · 瓶号 ${item.bottle_no || '-'}`"
						:subtitle="item.note || '缺灌装修复差值'"
						:status="buildManualAdjustLabel(item)"
						:status-kind="buildManualAdjustKind(item)"
						icon="alert"
						:icon-class="buildManualAdjustIconClass(item)"
					/>
				</AppList>
			</AppSection>

			<AppSection v-if="showIncompleteSection" title="链路不完整预览">
				<template #actions>
					<text class="section-hint">共 {{ summary.incomplete_count }} 条（预览 {{ incompletePreview.length }} 条）</text>
				</template>
				<AppList
					:loading="cycleLoading"
					:empty="incompletePreview.length === 0"
					:empty-title="searched ? '暂无链路不完整记录' : '查询后可查看链路不完整预览'"
				>
					<AppListItem
						v-for="(item, index) in incompletePreview"
						:key="`${item.reason || '-'}:${item.event_day || '-'}:${item.source_id || '-'}:${index}`"
						:title="`${item.event_day || '-'} · ${buildIncompleteLabel(item.reason)}`"
						:subtitle="item.detail || '-'"
						:status="item.source_id || '-'"
						status-kind="warning"
						icon="alert"
						icon-class="bg-warning"
					/>
				</AppList>
			</AppSection>
		</view>

		<view v-if="anomalyDrawer.visible" class="anomaly-drawer-mask" @click="closeAnomalyDrawer">
			<view class="anomaly-drawer" @click.stop>
				<view class="anomaly-drawer__head">
					<view>
						<text class="anomaly-drawer__title">异常排行明细</text>
						<text class="anomaly-drawer__sub">{{ anomalyTopScopeHint }}</text>
					</view>
					<AppButton size="sm" kind="ghost" @click="closeAnomalyDrawer">关闭</AppButton>
				</view>
				<AppTabs :model-value="anomalyDrawer.tab" :items="anomalyDrawerTabs" @update:modelValue="onAnomalyDrawerTabChange" />
				<AppList :loading="anomalyDrawer.loading" :empty="anomalyDrawerRows.length === 0" empty-title="暂无异常记录">
					<template v-if="anomalyDrawer.tab === 'single'">
						<AppListItem
							v-for="(item, index) in anomalyDrawerRows"
							:key="`drawer-single-${item.source_id || item.bottle_no || '-'}-${item.event_day || '-'}-${index}`"
							:title="`${item.event_day || '-'} · 瓶号 ${item.bottle_no || '-'}`"
							:subtitle="buildAnomalySingleSubtitle(item)"
							:status="buildDeltaLabel(item.delta_kg)"
							:status-kind="buildDeltaKind(item.delta_kg)"
							icon="alert"
							:icon-class="buildDeltaIconClass(item.delta_kg)"
						/>
					</template>
					<template v-else>
						<AppListItem
							v-for="(item, index) in anomalyDrawerRows"
							:key="`drawer-bottle-${item.bottle_no || '-'}-${index}`"
							:title="`瓶号 ${item.bottle_no || '-'}`"
							:subtitle="buildAnomalyBottleSubtitle(item)"
							:status="`${formatKg(item.total_abs_delta_kg)} kg`"
							status-kind="danger"
							icon="bottle"
							icon-class="bg-danger"
						/>
					</template>
				</AppList>
				<view v-if="anomalyDrawer.paging.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="anomalyDrawer.loading || anomalyDrawer.paging.page <= 1" @click="onAnomalyDrawerPrevPage">
						上一页
					</AppButton>
					<text class="section-hint">第 {{ anomalyDrawer.paging.page }} / {{ anomalyDrawerTotalPages }} 页</text>
					<AppButton size="sm" kind="neutral" :disabled="anomalyDrawer.loading || !anomalyDrawer.paging.hasMore" @click="onAnomalyDrawerNextPage">
						下一页
					</AppButton>
				</view>
			</view>
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
import AppTabs from '@/components/base/AppTabs.vue'
import AppDatePresetBar from '@/components/base/AppDatePresetBar.vue'
import { getBottleCycleLossV1, getBottleLossStatsV1, getBottleLossAnomalyRankV1 } from '@/services/bottleMovement'
import { buildDatePresetRange, detectDatePreset, formatDateInput } from '@/utils/datePreset'

const PAGE_SIZE = 50
const MANUAL_PAGE_SIZE = 50
const TOP_LIMIT = 5
const DRAWER_PAGE_SIZE = 20
const PREFETCH_PAGE_SIZE = 50
const PREFETCH_TTL_MS = 5 * 60 * 1000
const SUMMARY_FILTER_KEYS = {
	CYCLE_ALL: 'cycle_all',
	CYCLE_LOSS: 'cycle_loss',
	CYCLE_SWELL: 'cycle_swell',
	INCOMPLETE: 'incomplete',
	MANUAL_LOSS: 'manual_loss',
	MANUAL_SWELL: 'manual_swell'
}
const cycleLoading = ref(false)
const manualLoading = ref(false)
const anomalyTopLoading = ref(false)
const cycleLoadingToken = ref(0)
const manualLoadingToken = ref(0)
const anomalyTopLoadingToken = ref(0)
const loading = computed(() => cycleLoading.value || anomalyTopLoading.value)
const exporting = ref(false)
const list = ref([])
const incompletePreview = ref([])
const searched = ref(false)
const activeSummaryFilter = ref('')
const lastSearchToken = ref(0)
const initialized = ref(false)
const summary = ref(createEmptySummary())
const manualLoss = ref(createEmptyManualLossState())
const anomalyTop = reactive({
	single: [],
	bottle: [],
	singleTotal: 0,
	bottleTotal: 0
})
const pager = reactive({
	page: 1,
	pageSize: PAGE_SIZE,
	total: 0,
	hasMore: false
})

const filters = reactive({
	bottle_no: '',
	customer_name: '',
	dateStart: '',
	dateEnd: ''
})
const datePreset = ref('custom')
const anomalyDrawer = reactive({
	visible: false,
	tab: 'single',
	loading: false,
	rows: [],
	paging: {
		page: 1,
		pageSize: DRAWER_PAGE_SIZE,
		total: 0,
		hasMore: false
	}
})
const monthPrefetchCache = ref(null)
const monthPrefetchRunning = ref(false)

const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || PAGE_SIZE))
	return pages > 0 ? pages : 1
})

const totalLossKg = computed(() => round2(Number(summary.value?.loss_total_kg || 0) + Number(manualLoss.value?.summary?.total_loss_kg || 0)))
const totalSwellKg = computed(() => round2(Number(summary.value?.swell_total_kg || 0) + Number(manualLoss.value?.summary?.total_swell_kg || 0)))
const cycleResultTypeFilter = computed(() => {
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_LOSS) return 'loss'
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_SWELL) return 'swell'
	return ''
})
const manualResultTypeFilter = computed(() => {
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_LOSS) return 'loss'
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_SWELL) return 'swell'
	return ''
})
const showCycleSection = computed(() =>
	['', SUMMARY_FILTER_KEYS.CYCLE_ALL, SUMMARY_FILTER_KEYS.CYCLE_LOSS, SUMMARY_FILTER_KEYS.CYCLE_SWELL].includes(activeSummaryFilter.value)
)
const showManualSection = computed(() =>
	['', SUMMARY_FILTER_KEYS.MANUAL_LOSS, SUMMARY_FILTER_KEYS.MANUAL_SWELL].includes(activeSummaryFilter.value)
)
const showIncompleteSection = computed(() => ['', SUMMARY_FILTER_KEYS.INCOMPLETE].includes(activeSummaryFilter.value))

const scopeHint = computed(() => {
	const scopeMode = String(summary.value?.scope_mode || '').trim().toLowerCase()
	const bottleCount = Number(summary.value?.bottle_count || 0)
	if (scopeMode === 'single' && String(filters.bottle_no || '').trim()) return '单瓶口径'
	if (scopeMode === 'global') return `全局口径（${bottleCount} 瓶）`
	return '全局口径'
})

const cycleSectionTitle = computed(() => {
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_LOSS) return '损耗周期明细'
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_SWELL) return '胀重周期明细'
	return '周期明细'
})

const cycleScopeHint = computed(() => {
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_LOSS) return `${scopeHint.value} · 已筛选损耗周期`
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_SWELL) return `${scopeHint.value} · 已筛选胀重周期`
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_ALL) return `${scopeHint.value} · 已筛选完整周期`
	return scopeHint.value
})

const manualSectionTitle = computed(() => {
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_LOSS) return '修复/上秤损耗明细'
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_SWELL) return '修复/上秤胀重明细'
	return '异常修复/上秤差值明细'
})

const manualScopeHint = computed(() => {
	const label =
		activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_LOSS
			? '已筛选修复/上秤损耗'
			: activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_SWELL
				? '已筛选修复/上秤胀重'
				: ''
	return `${label ? `${label} · ` : ''}共 ${manualLoss.value.total} 条 · 涉及 ${manualLoss.value.summary.bottle_count || 0} 瓶`
})

const mainEmptyTitle = computed(() => {
	if (!searched.value) return '点击查询查看损耗统计'
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_LOSS) return '暂无损耗周期'
	if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_SWELL) return '暂无胀重周期'
	return '暂无周期明细'
})

const showAnomalySection = computed(() => true)
const anomalyTopScopeHint = computed(() => {
	const start = normalizeString(filters.dateStart)
	const end = normalizeString(filters.dateEnd)
	const dateLabel = start && end ? `${start} ~ ${end}` : start || end || '全部日期'
	return `按当前筛选口径（${dateLabel}）`
})
const anomalyDrawerTabs = computed(() => [
	{ label: `单次异常(${anomalyTop.singleTotal})`, value: 'single' },
	{ label: `瓶号累计(${anomalyTop.bottleTotal})`, value: 'bottle' }
])
const anomalyDrawerRows = computed(() => (Array.isArray(anomalyDrawer.rows) ? anomalyDrawer.rows : []))
const anomalyDrawerTotalPages = computed(() => {
	const pages = Math.ceil(Number(anomalyDrawer.paging.total || 0) / Number(anomalyDrawer.paging.pageSize || DRAWER_PAGE_SIZE))
	return pages > 0 ? pages : 1
})

function round2(value) {
	const num = Number(value || 0)
	if (!Number.isFinite(num)) return 0
	return Math.round(num * 100) / 100
}

function createEmptySummary() {
	return {
		cycle_count: 0,
		loss_count: 0,
		loss_total_kg: 0,
		swell_count: 0,
		swell_total_kg: 0,
		exact_count: 0,
		bottle_count: 0,
		scanned_event_count: 0,
		scope_mode: 'single',
		incomplete_count: 0
	}
}

function createEmptyManualLossState() {
	return {
		summary: {
			total_loss_kg: 0,
			total_swell_kg: 0,
			loss_record_count: 0,
			swell_record_count: 0,
			record_count: 0,
			bottle_count: 0,
			daily: []
		},
		list: [],
		total: 0
	}
}

function createRollingSevenDayRange(baseDate = new Date()) {
	const end = new Date(baseDate)
	end.setHours(0, 0, 0, 0)
	const start = new Date(end.getTime())
	start.setDate(start.getDate() - 6)
	return {
		dateStart: formatDateInput(start),
		dateEnd: formatDateInput(end)
	}
}

function createMonthRange(baseDate = new Date()) {
	return buildDatePresetRange('month', baseDate)
}

function buildPrefetchCacheKey(filtersLike = {}) {
	return [normalizeString(filtersLike.bottle_no), normalizeString(filtersLike.customer_name), normalizeString(filtersLike.dateStart), normalizeString(filtersLike.dateEnd)].join(
		'|'
	)
}

function isDefaultPrefetchCondition() {
	if (normalizeString(filters.bottle_no)) return false
	if (normalizeString(filters.customer_name)) return false
	if (activeSummaryFilter.value) return false
	const rolling = createRollingSevenDayRange(new Date())
	return normalizeString(filters.dateStart) === rolling.dateStart && normalizeString(filters.dateEnd) === rolling.dateEnd
}

function isDefaultMonthFilter() {
	if (normalizeString(filters.bottle_no)) return false
	if (normalizeString(filters.customer_name)) return false
	const monthRange = createMonthRange(new Date())
	return normalizeString(filters.dateStart) === normalizeString(monthRange.dateStart) && normalizeString(filters.dateEnd) === normalizeString(monthRange.dateEnd)
}

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function formatKg(value) {
	return `${round2(value)}`
}

function formatExportNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	if (Number.isInteger(num)) return String(num)
	return num.toFixed(6).replace(/\.?0+$/, '')
}

function toCsvCell(value) {
	const text = value == null ? '' : String(value)
	if (text.includes('"') || text.includes(',') || text.includes('\n')) return `"${text.replace(/"/g, '""')}"`
	return text
}

function formatExportTimestamp(date = new Date()) {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	const ss = String(date.getSeconds()).padStart(2, '0')
	return `${y}${m}${d}_${hh}${mm}${ss}`
}

function formatDateCompact(value) {
	return normalizeString(value).replace(/-/g, '')
}

function normalizeFileNamePart(value, fallback = '全部') {
	const text = normalizeString(value)
	if (!text) return fallback
	return text.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '').slice(0, 24) || fallback
}

function buildLossExportFileName(total) {
	const scopePart =
		activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_LOSS
			? '损耗周期'
			: activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_SWELL
				? '胀重周期'
				: activeSummaryFilter.value === SUMMARY_FILTER_KEYS.CYCLE_ALL
					? '完整周期'
					: activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_LOSS
						? '修复损耗'
						: activeSummaryFilter.value === SUMMARY_FILTER_KEYS.MANUAL_SWELL
							? '修复胀重'
							: activeSummaryFilter.value === SUMMARY_FILTER_KEYS.INCOMPLETE
								? '链路不完整'
								: '全部'
	const start = normalizeString(filters.dateStart)
	const end = normalizeString(filters.dateEnd)
	let datePart = '日期-全部'
	if (start && end) datePart = `日期-${formatDateCompact(start)}_${formatDateCompact(end)}`
	else if (start) datePart = `日期-${formatDateCompact(start)}_今`
	else if (end) datePart = `日期-起_${formatDateCompact(end)}`
	const bottlePart = `瓶号-${normalizeFileNamePart(filters.bottle_no, '全部')}`
	const customerPart = `客户-${normalizeFileNamePart(filters.customer_name, '全部')}`
	return `理论损耗_${scopePart}_${datePart}_${bottlePart}_${customerPart}_${total}条_${formatExportTimestamp()}.xls`
}

function buildLossSummaryRows(rows = []) {
	const summaryMap = new Map()
	for (const row of rows) {
		const customerName = normalizeString(row?.customer_name) || '未填写'
		if (!summaryMap.has(customerName)) {
			summaryMap.set(customerName, {
				customer_name: customerName,
				cycle_loss_kg: 0,
				cycle_swell_kg: 0,
				manual_loss_kg: 0,
				manual_swell_kg: 0,
				incomplete_count: 0,
				row_count: 0,
				bottle_nos: new Set()
			})
		}
		const target = summaryMap.get(customerName)
		target.row_count += 1
		const bottleNo = normalizeString(row?.bottle_no)
		if (bottleNo) target.bottle_nos.add(bottleNo)
		if (row?.category === '链路不完整') {
			target.incomplete_count += 1
			continue
		}
		const delta = Number(row?.delta_kg)
		if (!Number.isFinite(delta) || delta === 0) continue
		if (row?.category === '修复差值') {
			if (delta > 0) target.manual_loss_kg += delta
			else target.manual_swell_kg += Math.abs(delta)
			continue
		}
		if (delta > 0) target.cycle_loss_kg += delta
		else target.cycle_swell_kg += Math.abs(delta)
	}
	return Array.from(summaryMap.values())
		.map((row) => ({
			...row,
			cycle_loss_kg: round2(row.cycle_loss_kg),
			cycle_swell_kg: round2(row.cycle_swell_kg),
			manual_loss_kg: round2(row.manual_loss_kg),
			manual_swell_kg: round2(row.manual_swell_kg),
			bottle_count: row.bottle_nos.size
		}))
		.sort((a, b) => {
			const aScore = a.cycle_loss_kg + a.manual_loss_kg + a.incomplete_count * 0.001
			const bScore = b.cycle_loss_kg + b.manual_loss_kg + b.incomplete_count * 0.001
			if (bScore !== aScore) return bScore - aScore
			return a.customer_name.localeCompare(b.customer_name)
		})
}

function escapeXml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function sanitizeSheetName(value) {
	const text = normalizeString(value).replace(/[:\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim()
	return (text || '未填写').slice(0, 31)
}

function ensureUniqueSheetName(name, used) {
	const base = sanitizeSheetName(name) || 'Sheet'
	let candidate = base
	let index = 1
	while (used.has(candidate)) {
		const suffix = `_${index}`
		candidate = `${base.slice(0, Math.max(31 - suffix.length, 1))}${suffix}`
		index += 1
	}
	used.add(candidate)
	return candidate
}

function buildWorksheetXml(name, columns, rows) {
	const headerXml = `<Row>${columns.map((col) => `<Cell><Data ss:Type="String">${escapeXml(col.label)}</Data></Cell>`).join('')}</Row>`
	const rowXml = rows
		.map((row) => {
			const cells = columns.map((col) => {
				const raw = col.get(row)
				const num = typeof raw === 'number' ? raw : Number(raw)
				if (raw != null && raw !== '' && Number.isFinite(num) && String(raw).trim() === String(num)) {
					return `<Cell><Data ss:Type="Number">${num}</Data></Cell>`
				}
				return `<Cell><Data ss:Type="String">${escapeXml(raw == null ? '' : raw)}</Data></Cell>`
			})
			return `<Row>${cells.join('')}</Row>`
		})
		.join('')
	return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${headerXml}${rowXml}</Table></Worksheet>`
}

function buildLossWorkbookXml(rows = []) {
	const summaryColumns = [
		{ label: '客户名称', get: (row) => normalizeString(row.customer_name) },
		{ label: '周期损耗(kg)', get: (row) => formatExportNumber(row.cycle_loss_kg) },
		{ label: '周期胀重(kg)', get: (row) => formatExportNumber(row.cycle_swell_kg) },
		{ label: '修复损耗(kg)', get: (row) => formatExportNumber(row.manual_loss_kg) },
		{ label: '修复胀重(kg)', get: (row) => formatExportNumber(row.manual_swell_kg) },
		{ label: '链路不完整(条)', get: (row) => formatExportNumber(row.incomplete_count) },
		{ label: '明细条数', get: (row) => formatExportNumber(row.row_count) },
		{ label: '涉及瓶数', get: (row) => formatExportNumber(row.bottle_count) }
	]
	const detailColumns = [
		{ label: '类别', get: (row) => normalizeString(row.category) },
		{ label: '结果', get: (row) => normalizeString(row.result_label) },
		{ label: '日期', get: (row) => normalizeString(row.day) },
		{ label: '瓶号', get: (row) => normalizeString(row.bottle_no) },
		{ label: '客户名称', get: (row) => normalizeString(row.customer_name) },
		{ label: '回瓶日期', get: (row) => normalizeString(row.back_date) },
		{ label: '回瓶净重(kg)', get: (row) => formatExportNumber(row.back_net_kg) },
		{ label: '灌装次数', get: (row) => formatExportNumber(row.fill_count) },
		{ label: '灌装总重(kg)', get: (row) => formatExportNumber(row.fill_sum_kg) },
		{ label: '上秤差(kg)', get: (row) => formatExportNumber(row.start_loss_sum_kg) },
		{ label: '理论出重(kg)', get: (row) => formatExportNumber(row.theoretical_out_kg) },
		{ label: '出瓶日期', get: (row) => normalizeString(row.out_date) },
		{ label: '实际出瓶(kg)', get: (row) => formatExportNumber(row.out_net_kg) },
		{ label: '差值(kg)', get: (row) => formatExportNumber(row.delta_kg) },
		{ label: '详情', get: (row) => normalizeString(row.detail) },
		{ label: '来源ID', get: (row) => normalizeString(row.source_id) }
	]
	const summaryRows = buildLossSummaryRows(rows)
	const rowsByCustomer = new Map()
	for (const row of rows) {
		const customerName = normalizeString(row?.customer_name) || '未填写'
		if (!rowsByCustomer.has(customerName)) rowsByCustomer.set(customerName, [])
		rowsByCustomer.get(customerName).push(row)
	}
	const usedSheetNames = new Set()
	const sheets = [buildWorksheetXml(ensureUniqueSheetName('客户汇总', usedSheetNames), summaryColumns, summaryRows)]
	for (const summaryRow of summaryRows) {
		const customerName = normalizeString(summaryRow.customer_name) || '未填写'
		const customerRows = rowsByCustomer.get(customerName) || []
		sheets.push(buildWorksheetXml(ensureUniqueSheetName(customerName, usedSheetNames), detailColumns, customerRows))
	}
	return [
		'<?xml version="1.0"?>',
		'<?mso-application progid="Excel.Sheet"?>',
		'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:o="urn:schemas-microsoft-com:office:office"',
		' xmlns:x="urn:schemas-microsoft-com:office:excel"',
		' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:html="http://www.w3.org/TR/REC-html40">',
		sheets.join(''),
		'</Workbook>'
	].join('')
}

function downloadWorkbookOnH5(workbookText, fileName) {
	if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Blob === 'undefined') return false
	const blob = new Blob([`\uFEFF${workbookText}`], { type: 'application/vnd.ms-excel;charset=utf-8;' })
	const url = window.URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	anchor.style.display = 'none'
	document.body.appendChild(anchor)
	anchor.click()
	document.body.removeChild(anchor)
	window.URL.revokeObjectURL(url)
	return true
}

function buildResultLabel(type) {
	if (type === 'loss') return '损耗'
	if (type === 'swell') return '胀重'
	if (type === 'exact') return '吻合'
	return '未知'
}

function buildResultKind(type) {
	if (type === 'loss') return 'danger'
	if (type === 'swell') return 'warning'
	if (type === 'exact') return 'success'
	return 'info'
}

function buildDeltaLabel(deltaValue) {
	const delta = round2(deltaValue)
	if (delta > 0) return `损耗 ${delta} kg`
	if (delta < 0) return `胀 ${Math.abs(delta)} kg`
	return '吻合 0 kg'
}

function buildDeltaKind(deltaValue) {
	const delta = round2(deltaValue)
	if (delta > 0) return 'danger'
	if (delta < 0) return 'warning'
	return 'success'
}

function buildDeltaIconClass(deltaValue) {
	const delta = round2(deltaValue)
	if (delta > 0) return 'bg-danger'
	if (delta < 0) return 'bg-warning'
	return 'bg-success'
}

function buildCycleSubtitle(item) {
	const startLoss = round2(item?.start_loss_sum_kg)
	const startLossText = startLoss !== 0 ? ` - 上秤差 ${formatKg(startLoss)}` : ''
	return `回瓶 ${formatKg(item.back_net_kg)} + 灌装 ${formatKg(item.fill_sum_kg)}${startLossText} = 理论 ${formatKg(item.theoretical_out_kg)} · 实际出瓶 ${formatKg(item.out_net_kg)}`
}

function buildIncompleteLabel(reason) {
	if (reason === 'out_without_back') return '出瓶缺回瓶'
	if (reason === 'back_without_out') return '回瓶缺出瓶'
	return reason || '链路不完整'
}

function buildManualAdjustLabel(item) {
	const weight = Math.abs(round2(item?.loss_weight))
	if (item?.result_type === 'swell') return `胀重 ${formatKg(weight)} kg`
	return `损耗 ${formatKg(weight)} kg`
}

function buildManualAdjustKind(item) {
	return item?.result_type === 'swell' ? 'warning' : 'danger'
}

function buildManualAdjustIconClass(item) {
	return item?.result_type === 'swell' ? 'bg-warning' : 'bg-danger'
}

function buildAnomalySingleSubtitle(item) {
	const sourceLabel = item?.entry_type === 'manual' ? '修复差值' : '周期差值'
	const customerName = normalizeString(item?.customer_name) || '未填写客户'
	const detail = normalizeString(item?.detail)
	return `${sourceLabel} · ${customerName}${detail ? ` · ${detail}` : ''}`
}

function buildAnomalyBottleSubtitle(item) {
	const cycleCount = Number(item?.cycle_count || 0)
	const manualCount = Number(item?.manual_count || 0)
	const eventCount = Number(item?.event_count || 0)
	const latestDay = normalizeString(item?.latest_day) || '-'
	const customerPreview = normalizeString(item?.customer_name_preview)
	const customerPart = customerPreview ? ` · ${customerPreview}` : ''
	return `累计${formatKg(item?.total_abs_delta_kg)}kg · 周期${cycleCount}次/修复${manualCount}次 · 事件${eventCount}条 · 最近${latestDay}${customerPart}`
}

function resetAnomalyTop() {
	anomalyTop.single = []
	anomalyTop.bottle = []
	anomalyTop.singleTotal = 0
	anomalyTop.bottleTotal = 0
}

function resetAnomalyDrawerPaging() {
	anomalyDrawer.paging.page = 1
	anomalyDrawer.paging.pageSize = DRAWER_PAGE_SIZE
	anomalyDrawer.paging.total = 0
	anomalyDrawer.paging.hasMore = false
}

function resetResultState() {
	list.value = []
	incompletePreview.value = []
	summary.value = createEmptySummary()
	manualLoss.value = createEmptyManualLossState()
	resetAnomalyTop()
	anomalyDrawer.rows = []
	resetAnomalyDrawerPaging()
	pager.page = 1
	pager.pageSize = PAGE_SIZE
	pager.total = 0
	pager.hasMore = false
}

function createSearchToken() {
	lastSearchToken.value += 1
	return lastSearchToken.value
}

function isSearchTokenActive(token) {
	return Number(token) === Number(lastSearchToken.value)
}

function buildCurrentQueryBase() {
	return {
		bottle_no: normalizeString(filters.bottle_no),
		customer_name: normalizeString(filters.customer_name),
		dateStart: normalizeString(filters.dateStart),
		dateEnd: normalizeString(filters.dateEnd)
	}
}

function applyCyclePayload(payload = {}) {
	list.value = Array.isArray(payload.list) ? payload.list : []
	incompletePreview.value = Array.isArray(payload.incomplete_preview) ? payload.incomplete_preview : []
	summary.value = payload.summary || createEmptySummary()
	const paging = payload.paging || {}
	pager.page = Number(paging.page || pager.page || 1)
	pager.pageSize = Number(paging.pageSize || pager.pageSize || PAGE_SIZE)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)
}

function applyManualPayload(payload = {}) {
	manualLoss.value = {
		summary: payload.summary || createEmptyManualLossState().summary,
		list: Array.isArray(payload.list) ? payload.list : [],
		total: Number(payload.total || 0)
	}
}

function applyAnomalyTopPayload(payload = {}) {
	anomalyTop.single = Array.isArray(payload.top_single) ? payload.top_single : []
	anomalyTop.bottle = Array.isArray(payload.top_bottle) ? payload.top_bottle : []
	const summaryPayload = payload.summary || {}
	anomalyTop.singleTotal = Number(summaryPayload.single_total || payload.single_total || anomalyTop.single.length || 0)
	anomalyTop.bottleTotal = Number(summaryPayload.bottle_total || payload.bottle_total || anomalyTop.bottle.length || 0)
}

function buildCycleListByCachedRows(rows = []) {
	const resultType = cycleResultTypeFilter.value
	const normalizedRows = Array.isArray(rows) ? rows : []
	const filteredRows = resultType ? normalizedRows.filter((row) => normalizeString(row?.result_type) === resultType) : normalizedRows
	const start = Math.max((Number(pager.page || 1) - 1) * Number(pager.pageSize || PAGE_SIZE), 0)
	list.value = filteredRows.slice(start, start + Number(pager.pageSize || PAGE_SIZE))
	pager.total = filteredRows.length
	pager.hasMore = Number(pager.page || 1) * Number(pager.pageSize || PAGE_SIZE) < filteredRows.length
}

function buildManualListByCachedRows(rows = []) {
	const resultType = manualResultTypeFilter.value
	const normalizedRows = Array.isArray(rows) ? rows : []
	const filteredRows = resultType ? normalizedRows.filter((row) => normalizeString(row?.result_type) === resultType) : normalizedRows
	manualLoss.value = {
		summary: manualLoss.value.summary || createEmptyManualLossState().summary,
		list: filteredRows.slice(0, MANUAL_PAGE_SIZE),
		total: filteredRows.length
	}
}

function readMonthPrefetchCache() {
	const cache = monthPrefetchCache.value
	if (!cache) return null
	if (Number(cache.expireAt || 0) <= Date.now()) return null
	const monthRange = createMonthRange(new Date())
	const key = buildPrefetchCacheKey({
		bottle_no: '',
		customer_name: '',
		dateStart: monthRange.dateStart,
		dateEnd: monthRange.dateEnd
	})
	if (normalizeString(cache.key) !== key) return null
	return cache
}

function isMonthCacheApplicable() {
	return !normalizeString(filters.bottle_no) && !normalizeString(filters.customer_name) && isDefaultMonthFilter()
}

async function fetchCycleData(token, options = {}) {
	const { allowCache = true, silent = false } = options
	cycleLoadingToken.value = Number(token) || 0
	cycleLoading.value = true
	try {
		if (allowCache && isMonthCacheApplicable()) {
			const cache = readMonthPrefetchCache()
			if (cache?.cycle) {
				summary.value = cache.cycle.summary || createEmptySummary()
				incompletePreview.value = Array.isArray(cache.cycle.incomplete_preview) ? cache.cycle.incomplete_preview : []
				pager.page = Math.max(Number(pager.page || 1), 1)
				pager.pageSize = Number(pager.pageSize || PAGE_SIZE) || PAGE_SIZE
				buildCycleListByCachedRows(cache.cycle.rows || [])
				return true
			}
		}
		const query = buildCurrentQueryBase()
		const res = await getBottleCycleLossV1({
			...query,
			resultType: cycleResultTypeFilter.value,
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (!isSearchTokenActive(token)) return false
		if (res?.code !== 0) {
			if (!silent) uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			resetResultState()
			return false
		}
		applyCyclePayload(res.data || {})
		return true
	} finally {
		if (cycleLoadingToken.value === (Number(token) || 0)) cycleLoading.value = false
	}
}

async function fetchManualLossData(token, options = {}) {
	const { allowCache = true, silent = true } = options
	manualLoadingToken.value = Number(token) || 0
	manualLoading.value = true
	try {
		if (allowCache && isMonthCacheApplicable()) {
			const cache = readMonthPrefetchCache()
			if (cache?.manual) {
				manualLoss.value = {
					summary: cache.manual.summary || createEmptyManualLossState().summary,
					list: [],
					total: 0
				}
				buildManualListByCachedRows(cache.manual.rows || [])
				return
			}
		}
		const query = buildCurrentQueryBase()
		const res = await getBottleLossStatsV1({
			...query,
			resultType: manualResultTypeFilter.value,
			page: 1,
			pageSize: MANUAL_PAGE_SIZE
		})
		if (!isSearchTokenActive(token)) return
		if (res?.code !== 0) {
			if (!silent) uni.showToast({ title: res?.msg || '修复差值查询失败', icon: 'none' })
			manualLoss.value = createEmptyManualLossState()
			return
		}
		applyManualPayload(res.data || {})
	} catch (err) {
		if (!isSearchTokenActive(token)) return
		if (!silent) uni.showToast({ title: err?.message || '修复差值查询失败', icon: 'none' })
		manualLoss.value = createEmptyManualLossState()
	} finally {
		if (manualLoadingToken.value === (Number(token) || 0)) manualLoading.value = false
	}
}

async function fetchAnomalyTopData(token, options = {}) {
	const { allowCache = true, silent = true } = options
	anomalyTopLoadingToken.value = Number(token) || 0
	anomalyTopLoading.value = true
	try {
		if (allowCache && isMonthCacheApplicable()) {
			const cache = readMonthPrefetchCache()
			if (cache?.top) {
				applyAnomalyTopPayload(cache.top)
				return
			}
		}
		const query = buildCurrentQueryBase()
		const res = await getBottleLossAnomalyRankV1({
			...query,
			mode: 'single',
			page: 1,
			pageSize: TOP_LIMIT,
			limit: TOP_LIMIT
		})
		if (!isSearchTokenActive(token)) return
		if (res?.code !== 0) {
			if (!silent) uni.showToast({ title: res?.msg || '异常TOP查询失败', icon: 'none' })
			resetAnomalyTop()
			return
		}
		applyAnomalyTopPayload(res.data || {})
	} catch (err) {
		if (!isSearchTokenActive(token)) return
		if (!silent) uni.showToast({ title: err?.message || '异常TOP查询失败', icon: 'none' })
		resetAnomalyTop()
	} finally {
		if (anomalyTopLoadingToken.value === (Number(token) || 0)) anomalyTopLoading.value = false
	}
}

async function fetchAllCycleRowsForPrefetch(query = {}) {
	const rows = []
	let summaryData = createEmptySummary()
	let incompletePreview = []
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 500) throw new Error('本月预取分页异常')
		const res = await getBottleCycleLossV1({
			...query,
			resultType: '',
			page,
			pageSize: PREFETCH_PAGE_SIZE,
			includeIncompleteList: page === 1
		})
		if (res?.code !== 0) throw new Error(res?.msg || '本月周期预取失败')
		const payload = res.data || {}
		if (page === 1) {
			summaryData = payload.summary || createEmptySummary()
			incompletePreview = Array.isArray(payload.incomplete_preview) ? payload.incomplete_preview : []
		}
		const listRows = Array.isArray(payload.list) ? payload.list : []
		rows.push(...listRows)
		const paging = payload.paging || {}
		const total = Number(paging.total || rows.length)
		hasMore = Boolean(paging.hasMore) || page * PREFETCH_PAGE_SIZE < total
		page += 1
	}
	return {
		rows,
		summary: summaryData,
		incomplete_preview: incompletePreview
	}
}

async function fetchAllManualRowsForPrefetch(query = {}) {
	const rows = []
	let summaryData = createEmptyManualLossState().summary
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 500) throw new Error('本月预取分页异常')
		const res = await getBottleLossStatsV1({
			...query,
			resultType: '',
			page,
			pageSize: PREFETCH_PAGE_SIZE
		})
		if (res?.code !== 0) throw new Error(res?.msg || '本月修复预取失败')
		const payload = res.data || {}
		if (page === 1) summaryData = payload.summary || summaryData
		const listRows = Array.isArray(payload.list) ? payload.list : []
		rows.push(...listRows)
		const total = Number(payload.total || rows.length)
		hasMore = page * PREFETCH_PAGE_SIZE < total
		page += 1
	}
	return {
		rows,
		summary: summaryData
	}
}

async function triggerMonthPrefetch(token) {
	if (!isSearchTokenActive(token)) return
	if (!isDefaultPrefetchCondition()) return
	if (monthPrefetchRunning.value) return
	const monthRange = createMonthRange(new Date())
	const cacheKey = buildPrefetchCacheKey({
		bottle_no: '',
		customer_name: '',
		dateStart: monthRange.dateStart,
		dateEnd: monthRange.dateEnd
	})
	const cache = monthPrefetchCache.value
	if (cache && normalizeString(cache.key) === cacheKey && Number(cache.expireAt || 0) > Date.now()) return
	monthPrefetchRunning.value = true
	try {
		const query = {
			bottle_no: '',
			customer_name: '',
			dateStart: monthRange.dateStart,
			dateEnd: monthRange.dateEnd
		}
		const [cycleData, manualData, topRes] = await Promise.all([
			fetchAllCycleRowsForPrefetch(query),
			fetchAllManualRowsForPrefetch(query),
			getBottleLossAnomalyRankV1({
				...query,
				mode: 'single',
				page: 1,
				pageSize: TOP_LIMIT,
				limit: TOP_LIMIT
			})
		])
		if (topRes?.code !== 0) throw new Error(topRes?.msg || '本月TOP预取失败')
		monthPrefetchCache.value = {
			key: cacheKey,
			expireAt: Date.now() + PREFETCH_TTL_MS,
			cycle: cycleData,
			manual: manualData,
			top: topRes.data || {}
		}
	} catch (err) {
		console.warn('[BottleLossView] month prefetch failed', err && err.message)
	} finally {
		monthPrefetchRunning.value = false
	}
}

async function fetchAnomalyDrawerList(resetPage = false) {
	if (!anomalyDrawer.visible) return
	if (resetPage) anomalyDrawer.paging.page = 1
	anomalyDrawer.loading = true
	try {
		const query = buildCurrentQueryBase()
		const mode = anomalyDrawer.tab === 'bottle' ? 'bottle' : 'single'
		const res = await getBottleLossAnomalyRankV1({
			...query,
			mode,
			page: anomalyDrawer.paging.page,
			pageSize: anomalyDrawer.paging.pageSize,
			limit: TOP_LIMIT
		})
		if (!anomalyDrawer.visible) return
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '异常排行查询失败', icon: 'none' })
			anomalyDrawer.rows = []
			resetAnomalyDrawerPaging()
			return
		}
		const payload = res.data || {}
		anomalyDrawer.rows = mode === 'bottle' ? payload.bottle_list || [] : payload.single_list || []
		const paging = payload.paging || {}
		anomalyDrawer.paging.page = Number(paging.page || anomalyDrawer.paging.page || 1)
		anomalyDrawer.paging.pageSize = Number(paging.pageSize || anomalyDrawer.paging.pageSize || DRAWER_PAGE_SIZE)
		anomalyDrawer.paging.total = Number(paging.total || 0)
		anomalyDrawer.paging.hasMore = Boolean(paging.hasMore)
	} finally {
		anomalyDrawer.loading = false
	}
}

async function onSearch(resetPage = false) {
	searched.value = true
	if (resetPage) pager.page = 1
	const token = createSearchToken()
	const cycleOk = await fetchCycleData(token)
	if (!cycleOk || !isSearchTokenActive(token)) return
	void fetchManualLossData(token)
	void fetchAnomalyTopData(token)
	void triggerMonthPrefetch(token)
}

function isSummaryFilterActive(key) {
	return activeSummaryFilter.value === key
}

async function onSummaryCardFilter(key) {
	activeSummaryFilter.value = activeSummaryFilter.value === key ? '' : key
	await onSearch(true)
}

async function clearSummaryFilter() {
	if (!activeSummaryFilter.value) return
	activeSummaryFilter.value = ''
	await onSearch(true)
}

async function onPrevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	const token = createSearchToken()
	await fetchCycleData(token)
}

async function onNextPage() {
	if (!pager.hasMore) return
	pager.page += 1
	const token = createSearchToken()
	await fetchCycleData(token)
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

function onReset() {
	filters.bottle_no = ''
	filters.customer_name = ''
	const rolling = createRollingSevenDayRange(new Date())
	filters.dateStart = rolling.dateStart
	filters.dateEnd = rolling.dateEnd
	datePreset.value = 'custom'
	activeSummaryFilter.value = ''
	searched.value = false
	resetResultState()
}

function openAnomalyDrawer(tab = 'single') {
	anomalyDrawer.visible = true
	anomalyDrawer.tab = tab === 'bottle' ? 'bottle' : 'single'
	anomalyDrawer.rows = []
	resetAnomalyDrawerPaging()
	void fetchAnomalyDrawerList(true)
}

function closeAnomalyDrawer() {
	anomalyDrawer.visible = false
	anomalyDrawer.loading = false
	anomalyDrawer.rows = []
	resetAnomalyDrawerPaging()
}

function onAnomalyDrawerTabChange(value) {
	anomalyDrawer.tab = value === 'bottle' ? 'bottle' : 'single'
	void fetchAnomalyDrawerList(true)
}

function onAnomalyDrawerPrevPage() {
	if (anomalyDrawer.paging.page <= 1) return
	anomalyDrawer.paging.page -= 1
	void fetchAnomalyDrawerList(false)
}

function onAnomalyDrawerNextPage() {
	if (!anomalyDrawer.paging.hasMore) return
	anomalyDrawer.paging.page += 1
	void fetchAnomalyDrawerList(false)
}

onMounted(() => {
	if (initialized.value) return
	initialized.value = true
	const rolling = createRollingSevenDayRange(new Date())
	filters.dateStart = rolling.dateStart
	filters.dateEnd = rolling.dateEnd
	datePreset.value = 'custom'
	resetResultState()
	void onSearch(true)
})

async function fetchAllCycleRowsForExport() {
	const allRows = []
	const pageSize = 200
	let page = 1
	let hasMore = true
	let incompleteList = []
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await getBottleCycleLossV1({
			bottle_no: filters.bottle_no,
			customer_name: filters.customer_name,
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			resultType: cycleResultTypeFilter.value,
			page,
			pageSize,
			includeIncompleteList: page === 1
		})
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const payload = res.data || {}
		const rows = Array.isArray(payload.list) ? payload.list : []
		allRows.push(...rows)
		if (page === 1) incompleteList = Array.isArray(payload.incomplete_list) ? payload.incomplete_list : []
		const paging = payload.paging || {}
		const total = Number(paging.total || allRows.length)
		hasMore = Boolean(paging.hasMore) || page * pageSize < total
		page += 1
	}
	return { cycleRows: allRows, incompleteList }
}

async function fetchAllManualRowsForExport() {
	const allRows = []
	const pageSize = 200
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await getBottleLossStatsV1({
			bottle_no: filters.bottle_no,
			customer_name: filters.customer_name,
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			resultType: manualResultTypeFilter.value,
			page,
			pageSize
		})
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const payload = res.data || {}
		const rows = Array.isArray(payload.list) ? payload.list : []
		allRows.push(...rows)
		const total = Number(payload.total || allRows.length)
		hasMore = page * pageSize < total
		page += 1
	}
	return allRows
}

function buildCycleExportRows(rows = []) {
	return rows.map((row) => ({
		category: '周期',
		result_label: buildResultLabel(row?.result_type),
		day: normalizeString(row?.out_date || row?.out_day),
		bottle_no: normalizeString(row?.bottle_no),
		customer_name: normalizeString(row?.out_customer_name),
		back_date: normalizeString(row?.back_date),
		back_net_kg: row?.back_net_kg,
		fill_count: row?.fill_count,
		fill_sum_kg: row?.fill_sum_kg,
		start_loss_sum_kg: row?.start_loss_sum_kg,
		theoretical_out_kg: row?.theoretical_out_kg,
		out_date: normalizeString(row?.out_date),
		out_net_kg: row?.out_net_kg,
		delta_kg: row?.delta_kg,
		detail: buildCycleSubtitle(row),
		source_id: normalizeString(row?.source_out_id)
	}))
}

function buildManualExportRows(rows = []) {
	return rows.map((row) => ({
		category: '修复差值',
		result_label: row?.result_type === 'swell' ? '胀重' : '损耗',
		day: normalizeString(row?.event_day),
		bottle_no: normalizeString(row?.bottle_no),
		customer_name: normalizeString(row?.customer_name),
		back_date: '',
		back_net_kg: '',
		fill_count: '',
		fill_sum_kg: '',
		start_loss_sum_kg: '',
		theoretical_out_kg: '',
		out_date: '',
		out_net_kg: '',
		delta_kg: row?.loss_weight,
		detail: normalizeString(row?.note || row?.adjust_reason || '缺灌装修复差值'),
		source_id: normalizeString(row?._id)
	}))
}

function buildIncompleteExportRows(rows = []) {
	return rows.map((row) => ({
		category: '链路不完整',
		result_label: buildIncompleteLabel(row?.reason),
		day: normalizeString(row?.event_day),
		bottle_no: normalizeString(row?.bottle_no),
		customer_name: normalizeString(row?.customer_name),
		back_date: '',
		back_net_kg: '',
		fill_count: '',
		fill_sum_kg: '',
		start_loss_sum_kg: '',
		theoretical_out_kg: '',
		out_date: normalizeString(row?.event_date),
		out_net_kg: '',
		delta_kg: '',
		detail: normalizeString(row?.detail),
		source_id: normalizeString(row?.source_id)
	}))
}

function sortExportRows(rows = []) {
	return [...rows].sort((a, b) => {
		const customerDiff = normalizeString(a.customer_name).localeCompare(normalizeString(b.customer_name))
		if (customerDiff !== 0) return customerDiff
		const dayDiff = normalizeString(b.day).localeCompare(normalizeString(a.day))
		if (dayDiff !== 0) return dayDiff
		const categoryDiff = normalizeString(a.category).localeCompare(normalizeString(b.category))
		if (categoryDiff !== 0) return categoryDiff
		return normalizeString(a.bottle_no).localeCompare(normalizeString(b.bottle_no))
	})
}

async function onExport() {
	if (exporting.value) return
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const [{ cycleRows, incompleteList }, manualRows] = await Promise.all([fetchAllCycleRowsForExport(), fetchAllManualRowsForExport()])
		let exportRows = []
		if (activeSummaryFilter.value === SUMMARY_FILTER_KEYS.INCOMPLETE) {
			exportRows = buildIncompleteExportRows(incompleteList)
		} else if (
			[SUMMARY_FILTER_KEYS.CYCLE_ALL, SUMMARY_FILTER_KEYS.CYCLE_LOSS, SUMMARY_FILTER_KEYS.CYCLE_SWELL].includes(activeSummaryFilter.value)
		) {
			exportRows = buildCycleExportRows(cycleRows)
		} else if ([SUMMARY_FILTER_KEYS.MANUAL_LOSS, SUMMARY_FILTER_KEYS.MANUAL_SWELL].includes(activeSummaryFilter.value)) {
			exportRows = buildManualExportRows(manualRows)
		} else {
			exportRows = [
				...buildCycleExportRows(cycleRows),
				...buildManualExportRows(manualRows),
				...buildIncompleteExportRows(incompleteList)
			]
		}
		const sortedRows = sortExportRows(exportRows)
		if (!sortedRows.length) {
			uni.showToast({ title: '没有可导出的数据', icon: 'none' })
			return
		}
		const workbookText = buildLossWorkbookXml(sortedRows)
		const fileName = buildLossExportFileName(sortedRows.length)
		const downloaded = downloadWorkbookOnH5(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持Excel下载，请在浏览器端导出', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: `已导出${sortedRows.length}条`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2600 })
	} finally {
		uni.hideLoading()
		exporting.value = false
	}
}
</script>

<style scoped>
.view-body {
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

.summary-card {
	min-height: 176rpx;
}

.summary-card--active {
	box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18), 0 14px 28px rgba(37, 99, 235, 0.12);
}

:deep(.summary-card .stat__content) {
	align-items: center;
	gap: 20rpx;
}

:deep(.summary-card .stat__value-wrap) {
	align-items: flex-start;
}

:deep(.summary-card .stat__value) {
	width: auto;
	text-align: left;
}

:deep(.summary-card .stat__icon) {
	flex-shrink: 0;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.picker-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.anomaly-top-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(420rpx, 1fr));
	gap: 16rpx;
}

.anomaly-top-card {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.anomaly-top-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
}

.anomaly-top-title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
	align-items: center;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.pager-row {
	margin-top: 16rpx;
	display: flex;
	justify-content: space-between;
	gap: 12rpx;
	align-items: center;
}

.anomaly-drawer-mask {
	position: fixed;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	background: rgba(15, 23, 42, 0.45);
	z-index: 90;
	display: flex;
	justify-content: flex-end;
	padding: 20rpx;
	box-sizing: border-box;
}

.anomaly-drawer {
	width: 880rpx;
	max-width: 100%;
	height: 100%;
	max-height: calc(100vh - 40rpx);
	background: #fff;
	border-radius: 20rpx;
	padding: 24rpx;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
	overflow: hidden;
}

.anomaly-drawer__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
}

.anomaly-drawer__title {
	display: block;
	font-size: 30rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.anomaly-drawer__sub {
	margin-top: 8rpx;
	display: block;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.anomaly-top-grid {
		grid-template-columns: 1fr;
	}
	.anomaly-drawer-mask {
		padding: 0;
	}
	.anomaly-drawer {
		width: 100%;
		height: 100%;
		max-height: 100vh;
		border-radius: 24rpx 24rpx 0 0;
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
}
</style>
