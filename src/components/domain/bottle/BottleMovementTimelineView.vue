<template>
	<AppPage title="单瓶时间线" :subtitle="pageSubtitle" icon="list">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="onBack">返回</AppButton>
			<AppButton size="sm" kind="primary" :disabled="timelineLoading || !selectedBottleNo" @click="onLoadTimeline">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="事件总数" :value="timeline.stats.total" hint="条" icon="list" />
				<AppStatCard class="summary-card" label="闭环估算" :value="timeline.stats.cycle_estimated" hint="轮" icon="check-circle" />
				<AppStatCard class="summary-card" label="待处理异常" :value="timeline.stats.open_anomalies" hint="条" icon="alert" />
				<AppStatCard class="summary-card" label="已修复" :value="timeline.stats.resolved_anomalies" hint="条" icon="document" />
			</view>
		</template>

		<view class="view-body">
			<AppSection title="瓶号查询">
				<template #actions>
					<AppTag :kind="timeline.state.kind || 'soft'">{{ timeline.state.label || '暂无流转' }}</AppTag>
				</template>
				<view class="search-row">
					<AppInput
						v-model="timelineBottleInput"
						label="瓶号"
						placeholder="输入瓶号后查看完整时间线"
						size="sm"
						confirm-type="search"
						@confirm="onTimelineSearch"
					/>
					<AppButton size="sm" kind="primary" :disabled="timelineLoading" @click="onTimelineSearch">查看</AppButton>
				</view>
				<view v-if="selectedBottleNo" class="kpi-row">
					<AppTag kind="soft">瓶号 {{ selectedBottleNo }}</AppTag>
					<AppTag kind="soft">出瓶 {{ timeline.stats.out }}</AppTag>
					<AppTag kind="soft">回瓶 {{ timeline.stats.back }}</AppTag>
					<AppTag kind="soft">灌装 {{ timeline.stats.fill }}</AppTag>
				</view>
			</AppSection>

			<AppSection title="时间线事件">
				<template #actions>
					<AppButton v-if="hasMoreEvents" size="sm" kind="ghost" @click="toggleTimelineExpanded">
						{{ timelineExpanded ? '收起' : `展开剩余 ${hiddenEventCount} 条` }}
					</AppButton>
				</template>
				<AppList :loading="timelineLoading" :empty="visibleEvents.length === 0" :empty-title="timelineEmptyTitle">
					<AppListItem
						v-for="event in visibleEvents"
						:key="event._id || `${event.source_type}:${event.source_id || ''}:${event.event_at}:${event.type}`"
						:title="displayEventDay(event) + ' · ' + typeText(event.type)"
						:subtitle="event.customer_name || '站内流转'"
						:status="eventStatusText(event)"
						:status-kind="eventStatusKind(event)"
						icon="list"
						:icon-class="typeIconClass(event.type)"
					>
						<template #meta>
								<view class="meta-tags">
									<AppTag kind="soft">{{ sourceText(event.source_type) }}</AppTag>
									<text v-if="event.net_weight != null" class="meta-text">净重 {{ event.net_weight }} kg</text>
									<text v-if="buildLossWeightText(event)" class="meta-text">{{ buildLossWeightText(event) }}</text>
									<text v-if="event.note" class="meta-text">{{ event.note }}</text>
									<view class="marker-tags" v-if="getEventMarkers(event).length">
									<AppTag
										v-for="marker in getEventMarkers(event).slice(0, 2)"
										:key="`${marker.anomaly_id}:${marker.event_day}:${marker.type}`"
										:kind="marker.status === 'open' ? 'danger' : 'warning'"
									>
										{{ anomalyTypeText(marker.anomaly_type) }}
									</AppTag>
								</view>
							</view>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>

			<AppSection title="关联异常">
				<AppList :loading="timelineLoading" :empty="timeline.anomalies.length === 0" empty-title="该瓶号暂无异常记录">
					<AppListItem
						v-for="anomaly in timeline.anomalies"
						:key="anomaly._id || anomaly.fingerprint"
						:title="anomalyTypeText(anomaly.anomaly_type)"
						:subtitle="anomalyEventDay(anomaly)"
						:status="anomaly.status === 'resolved' ? '已修复' : '待处理'"
						:status-kind="anomaly.status === 'resolved' ? 'success' : 'danger'"
						icon="alert"
						:icon-class="anomaly.status === 'resolved' ? 'bg-success' : 'bg-danger'"
					>
						<template #meta>
							<view class="meta-tags">
								<text class="meta-text">{{ anomaly.note || '-' }}</text>
							</view>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { getBottleMovementTimelineV1 } from '@/services/bottleMovement'
import { scanBottleAnomaliesRoundV2 } from '@/services/bottleAnomaly'
import { buildBottleTimelineDisplayEvents } from '@/services/models/bottleTimeline'

const props = defineProps({
	bottleNo: { type: String, default: '' }
})

const TIMELINE_PREVIEW_LIMIT = 5
const TIMELINE_SCAN_BACKGROUND_ROUNDS = 3
const TIMELINE_SCAN_BATCH_SIZE = 180
const TIMELINE_SCAN_MAX_EVENTS_PER_ROUND = 900
const TIMELINE_SCAN_MAX_MS_PER_ROUND = 2400
const TIMELINE_SCAN_MAX_WRITES_PER_ROUND = 150

const timelineBottleInput = ref('')
const selectedBottleNo = ref('')
const timeline = ref(buildTimelineDefault())
const timelineExpanded = ref(false)
const scanTaskId = ref(0)

const pageSubtitle = computed(() => (selectedBottleNo.value ? `瓶号 ${selectedBottleNo.value}` : '按瓶号查看闭环状态'))

const timelineEmptyTitle = computed(() => {
	if (!selectedBottleNo.value) return '请输入瓶号并点击查看时间线'
	return '该瓶号暂无流转事件'
})

const sortedEvents = computed(() => {
	return buildBottleTimelineDisplayEvents(timeline.value.events)
})

const visibleEvents = computed(() => {
	if (timelineExpanded.value) return sortedEvents.value
	return sortedEvents.value.slice(0, TIMELINE_PREVIEW_LIMIT)
})

const hasMoreEvents = computed(() => sortedEvents.value.length > TIMELINE_PREVIEW_LIMIT)
const hiddenEventCount = computed(() => Math.max(sortedEvents.value.length - TIMELINE_PREVIEW_LIMIT, 0))

const markerMap = computed(() => {
	const map = new Map()
	for (const marker of timeline.value.markers || []) {
		const day = normalizeDay(marker.event_day)
		if (!day) continue
		const type = marker.type || ''
		const key = `${day}|${type}`
		if (!map.has(key)) map.set(key, [])
		map.get(key).push(marker)
	}
	return map
})

function buildTimelineDefault() {
	return {
		bottle_no: '',
		state: { code: 'empty', label: '暂无流转', kind: 'soft' },
		stats: {
			total: 0,
			out: 0,
			back: 0,
			fill: 0,
			adjust: 0,
			open_anomalies: 0,
			resolved_anomalies: 0,
			cycle_estimated: 0
		},
		events: [],
		anomalies: [],
		markers: []
	}
}

function buildTimelinePayload(raw) {
	const base = buildTimelineDefault()
	const src = raw && typeof raw === 'object' ? raw : {}
	const state = src.state && typeof src.state === 'object' ? src.state : base.state
	return {
		bottle_no: normalizeBottleNo(src.bottle_no),
		state: {
			code: normalizeString(state.code) || base.state.code,
			label: normalizeString(state.label) || base.state.label,
			kind: normalizeString(state.kind) || base.state.kind
		},
		stats: {
			total: Number(src.stats?.total || 0),
			out: Number(src.stats?.out || 0),
			back: Number(src.stats?.back || 0),
			fill: Number(src.stats?.fill || 0),
			adjust: Number(src.stats?.adjust || 0),
			open_anomalies: Number(src.stats?.open_anomalies || 0),
			resolved_anomalies: Number(src.stats?.resolved_anomalies || 0),
			cycle_estimated: Number(src.stats?.cycle_estimated || 0)
		},
		events: Array.isArray(src.events) ? src.events : [],
		anomalies: Array.isArray(src.anomalies) ? src.anomalies : [],
		markers: Array.isArray(src.markers) ? src.markers : []
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeDay(value) {
	const m = normalizeString(value).match(/^(\d{4}-\d{2}-\d{2})/)
	return m ? m[1] : ''
}

function displayEventDay(event) {
	const eventDay = normalizeDay(event && event.event_day)
	if (eventDay) return eventDay
	const fallbackDay = normalizeDay(event && event.date)
	if (fallbackDay) return fallbackDay
	return '-'
}

const { loading: timelineLoading, run: fetchTimeline } = useQuery(
	async (bottleNo) => {
		if (!bottleNo) return buildTimelineDefault()
		const res = await getBottleMovementTimelineV1({
			bottleNo,
			limit: 1200
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '时间线查询失败', icon: 'none' })
			return buildTimelineDefault()
		}
		return buildTimelinePayload(res.data)
	},
	{
		immediate: false,
		initialData: buildTimelineDefault(),
		cacheTTL: 4000,
		throttleMs: 200,
		cacheKey: (bottleNo) => `movement:timeline:${bottleNo}`
	}
)

async function loadTimeline(bottleNo) {
	const no = normalizeBottleNo(bottleNo)
	if (!no) return
	selectedBottleNo.value = no
	const taskId = scanTaskId.value + 1
	scanTaskId.value = taskId
	const firstRound = await runScanRound(no, null)
	if (scanTaskId.value !== taskId) return
	const data = await fetchTimeline(no)
	if (scanTaskId.value !== taskId) return
	timeline.value = buildTimelinePayload(data)
	timelineExpanded.value = false
	if (!firstRound.done && firstRound.cursor) {
		void continueScanInBackground(no, firstRound.cursor, firstRound.changed, taskId)
	}
}

async function onTimelineSearch() {
	const bottleNo = normalizeBottleNo(timelineBottleInput.value)
	if (!bottleNo) {
		uni.showToast({ title: '请输入瓶号', icon: 'none' })
		return
	}
	await loadTimeline(bottleNo)
}

async function onLoadTimeline() {
	if (!selectedBottleNo.value) return
	await loadTimeline(selectedBottleNo.value)
}

function toggleTimelineExpanded() {
	if (!hasMoreEvents.value) return
	timelineExpanded.value = !timelineExpanded.value
}

function onBack() {
	uni.navigateBack({ delta: 1 })
}

function anomalyTypeText(type) {
	const map = {
		missing_back: '缺回瓶',
		missing_fill: '缺灌装',
		continuous_fill: '连续灌装',
		continuous_out: '连续出瓶',
		continuous_back: '连续回瓶',
		missing_out: '缺出瓶',
		missing_truck_fill: '缺整车补给',
		truck_return_diff_excess: '整车回站差异过大',
		missing_truck_back_gross: '缺回站总重',
		customer_mismatch: '客户不一致',
		duplicate_sale: '重复出瓶'
	}
	return map[type] || type || '异常'
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

function buildLossWeightText(event) {
	const value = Number(event && event.loss_weight)
	if (!Number.isFinite(value) || value === 0) return ''
	if (value > 0) return `损耗 ${value} kg`
	return `胀重 ${Math.abs(value)} kg`
}

function getEventMarkers(event) {
	const day = normalizeDay(event && (event.event_day || event.date))
	if (!day) return []
	const type = normalizeString(event && event.type)
	const exact = markerMap.value.get(`${day}|${type}`) || []
	const generic = markerMap.value.get(`${day}|`) || []
	return [...exact, ...generic]
}

function eventStatusText(event) {
	const markers = getEventMarkers(event)
	if (!markers.length) return ''
	const hasOpen = markers.some((row) => normalizeString(row.status) !== 'resolved')
	return hasOpen ? '异常点' : '已修复'
}

function eventStatusKind(event) {
	const markers = getEventMarkers(event)
	if (!markers.length) return 'info'
	const hasOpen = markers.some((row) => normalizeString(row.status) !== 'resolved')
	return hasOpen ? 'danger' : 'success'
}

function anomalyEventDay(anomaly) {
	const ctx = anomaly && typeof anomaly.context === 'object' ? anomaly.context : {}
	const day = normalizeDay(
		ctx.legacy_date || ctx.next_out?.date || ctx.next_back?.date || ctx.last_back?.date || ctx.last_fill?.date || ctx.next_fill?.date || ''
	)
	if (!day) return '日期未知'
	return day
}

async function runScanRound(bottleNo, cursor) {
	const res = await scanBottleAnomaliesRoundV2({
		bottleNo,
		cursor,
		reconcileAnomalies: true,
		reconcileTypes: ['missing_back', 'missing_fill', 'missing_out', 'continuous_fill', 'continuous_out', 'continuous_back'],
		batchSize: TIMELINE_SCAN_BATCH_SIZE,
		maxEventsPerRound: TIMELINE_SCAN_MAX_EVENTS_PER_ROUND,
		maxMsPerRound: TIMELINE_SCAN_MAX_MS_PER_ROUND,
		maxWritesPerRound: TIMELINE_SCAN_MAX_WRITES_PER_ROUND
	})
	if (res?.code !== 0) {
		return { done: true, cursor: null, changed: false }
	}
	const payload = res.data || {}
	const created = Number(payload.round_created || 0)
	const resolvedStale = Number(payload.round_resolved_stale || 0)
	return {
		done: Boolean(payload.done),
		cursor: payload.cursor || null,
		changed: created + resolvedStale > 0
	}
}

async function continueScanInBackground(bottleNo, cursor, initialChanged, taskId) {
	let nextCursor = cursor
	let changed = Boolean(initialChanged)
	let rounds = 0
	while (nextCursor && rounds < TIMELINE_SCAN_BACKGROUND_ROUNDS) {
		if (scanTaskId.value !== taskId) return
		const round = await runScanRound(bottleNo, nextCursor)
		changed = changed || round.changed
		rounds += 1
		if (round.done) {
			nextCursor = null
			break
		}
		nextCursor = round.cursor
	}
	if (!changed) return
	if (scanTaskId.value !== taskId) return
	if (selectedBottleNo.value !== bottleNo) return
	const data = await fetchTimeline(bottleNo)
	if (scanTaskId.value !== taskId) return
	timeline.value = buildTimelinePayload(data)
	timelineExpanded.value = false
}

watch(
	() => props.bottleNo,
	async (value) => {
		const no = normalizeBottleNo(value)
		if (!no) return
		timelineBottleInput.value = no
		await loadTimeline(no)
	},
	{ immediate: true }
)
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

.search-row {
	display: grid;
	grid-template-columns: minmax(240rpx, 1fr) auto;
	gap: 12rpx;
	align-items: end;
}

.kpi-row {
	display: flex;
	flex-wrap: wrap;
	gap: 10rpx;
	align-items: center;
	margin-top: 8rpx;
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

.marker-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.search-row {
		grid-template-columns: 1fr;
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
}
</style>
