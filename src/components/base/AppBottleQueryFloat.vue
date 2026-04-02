<template>
	<view class="bottle-query">
		<view v-if="open" class="bottle-query__overlay"></view>

		<view
			v-if="open"
			class="bottle-query__panel"
			:style="panelStyle"
		>
			<view class="bottle-query__header">
				<view class="bottle-query__header-main">
					<view
						class="bottle-query__drag-handle"
						@mousedown.stop.prevent="onPanelMouseDown"
						@touchstart.stop.prevent="onPanelHandleTouchStart"
					>
						<AppIcon name="list" size="28rpx" color="var(--crm-text-muted)" />
					</view>
					<text class="bottle-query__title">瓶子查询</text>
				</view>
				<view class="bottle-query__close" @click="close">
					<AppIcon name="close" size="28rpx" />
				</view>
			</view>

			<view class="bottle-query__search-row">
				<AppInput
					v-model="keyword"
					placeholder="输入瓶号"
					confirm-type="search"
					@confirm="onSearch"
				/>
				<AppButton kind="primary" :loading="loading" @click="onSearch">搜索</AppButton>
			</view>

			<scroll-view scroll-y class="bottle-query__body">
				<view v-if="hasResult" class="bottle-query__card">
					<view class="bottle-query__hero">
						<text class="bottle-query__hero-title">瓶号：{{ result.bottleNo }}</text>
						<AppTag :kind="result.statusKind">当前：{{ result.currentStatus }}</AppTag>
					</view>

					<view class="bottle-query__stats">
						<view class="bottle-query__stat">
							<text class="bottle-query__stat-value">{{ result.totalEvents }}</text>
							<text class="bottle-query__stat-label">总事件</text>
						</view>
						<view class="bottle-query__stat">
							<text class="bottle-query__stat-value">{{ result.saleRecordCount }}</text>
							<text class="bottle-query__stat-label">销售记录</text>
						</view>
						<view class="bottle-query__stat">
							<text class="bottle-query__stat-value">{{ result.fillRecordCount }}</text>
							<text class="bottle-query__stat-label">灌装记录</text>
						</view>
					</view>

					<view class="bottle-query__section">
						<text class="bottle-query__section-title">当前状态</text>
						<view class="bottle-query__kv">
							<text class="bottle-query__kv-label">状态：</text>
							<text class="bottle-query__kv-value">{{ result.currentStatus }}</text>
						</view>
						<view class="bottle-query__kv">
							<text class="bottle-query__kv-label">{{ result.currentCustomerLabel }}：</text>
							<text class="bottle-query__kv-value">{{ result.currentCustomer }}</text>
						</view>
						<view class="bottle-query__kv">
							<text class="bottle-query__kv-label">上次出瓶：</text>
							<text class="bottle-query__kv-value">{{ result.lastOutDate }}</text>
						</view>
						<view class="bottle-query__kv">
							<text class="bottle-query__kv-label">上次回瓶：</text>
							<text class="bottle-query__kv-value">{{ result.lastBackDate }}</text>
						</view>
					</view>

					<view class="bottle-query__section">
						<text class="bottle-query__section-title">最后事件</text>
						<view class="bottle-query__kv">
							<text class="bottle-query__kv-label">类型：</text>
							<text class="bottle-query__kv-value">{{ result.lastEventType }}</text>
						</view>
						<view class="bottle-query__kv">
							<text class="bottle-query__kv-label">日期：</text>
							<text class="bottle-query__kv-value">{{ result.lastEventDate }}</text>
						</view>
						<view class="bottle-query__kv">
							<text class="bottle-query__kv-label">事件客户：</text>
							<text class="bottle-query__kv-value">{{ result.lastEventCustomer }}</text>
						</view>
					</view>

					<view class="bottle-query__section">
						<view class="bottle-query__section-row">
							<text class="bottle-query__section-title">流转记录（前10条）</text>
							<AppButton size="sm" kind="ghost" @click="goTimeline">查看完整时间线</AppButton>
						</view>
						<view class="bottle-query__records">
							<view v-for="row in result.records" :key="row.key" class="bottle-query__record">
								<AppTag kind="soft">{{ row.typeText }}</AppTag>
								<text class="bottle-query__record-date">{{ row.date }}</text>
								<text class="bottle-query__record-customer">{{ row.detail }}</text>
							</view>
						</view>
					</view>
				</view>

				<view v-else-if="searched && !loading" class="bottle-query__empty">
					<text class="bottle-query__empty-title">未找到该瓶号的流转记录</text>
					<text class="bottle-query__empty-desc">请确认瓶号后重试。</text>
				</view>
			</scroll-view>
		</view>

		<view
			v-if="!open"
			class="bottle-query__trigger"
			:style="triggerStyle"
			@mousedown.stop.prevent="onTriggerMouseDown"
			@touchstart.stop.prevent="onTriggerTouchStart"
			@click.stop="onTriggerClick"
		>
			<AppIcon name="search" size="40rpx" color="#fff" />
		</view>
	</view>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import { getBottleMovementTimelineV1 } from '@/services/bottleMovement'
import { buildBottleTimelineDisplayEvents } from '@/services/models/bottleTimeline'

const open = ref(false)
const loading = ref(false)
const searched = ref(false)
const keyword = ref('')
const timeline = ref(buildTimelineDefault())
const DRAG_EDGE_GAP = 2
const metrics = reactive({
	windowWidth: 390,
	windowHeight: 844,
	triggerSize: 48,
	triggerMargin: 20,
	panelWidth: 420,
	panelHeight: 620
})
const triggerPosition = reactive({ x: 0, y: 0 })
const panelPosition = reactive({ x: 0, y: 0 })
const mouseDrag = reactive({ active: '', startX: 0, startY: 0, originX: 0, originY: 0, moved: false })
const touchDrag = reactive({ active: '', startX: 0, startY: 0, originX: 0, originY: 0, moved: false })
const suppressTriggerClick = ref(false)
const touchMoveOptions = { passive: false }

const triggerStyle = computed(() => ({
	left: `${triggerPosition.x}px`,
	top: `${triggerPosition.y}px`,
	width: `${metrics.triggerSize}px`,
	height: `${metrics.triggerSize}px`
}))

const panelStyle = computed(() => ({
	left: `${panelPosition.x}px`,
	top: `${panelPosition.y}px`,
	width: `${metrics.panelWidth}px`,
	height: `${metrics.panelHeight}px`
}))

const hasResult = computed(() => {
	return Boolean(timeline.value?.bottle_no) && Array.isArray(timeline.value?.events) && timeline.value.events.length > 0
})

const result = computed(() => {
	const data = timeline.value || buildTimelineDefault()
	const events = Array.isArray(data.events) ? data.events : []
	const displayRows = buildBottleTimelineDisplayEvents(events).slice(0, 10)
	const latestEvent = displayRows[0] || {}
	const latestOut = findLatestEventByType(events, 'out')
	const latestBack = findLatestEventByType(events, 'back')
	const saleRecordCount = countUniqueSourceIds(events.filter((row) => normalizeString(row?.source_type).toLowerCase() === 'sale'))
	const fillRecordCount = countUniqueSourceIds(events.filter((row) => normalizeString(row?.type).toLowerCase() === 'fill'))
	const currentStatus = resolveCurrentStatus(data.state, latestEvent)
	const currentCustomer = resolveCurrentCustomer(currentStatus, latestEvent, latestOut, latestBack)
	return {
		bottleNo: normalizeBottleNo(data.bottle_no),
		statusKind: normalizeString(data.state?.kind) || 'soft',
		currentStatus,
		currentCustomerLabel: resolveCurrentCustomerLabel(currentStatus),
		currentCustomer,
		lastOutDate: displayEventDay(latestOut),
		lastBackDate: displayEventDay(latestBack),
		lastEventType: typeText(latestEvent?.type),
		lastEventDate: displayEventDay(latestEvent),
		lastEventCustomer: normalizeString(latestEvent?.customer_name) || '站内流转',
		totalEvents: Number(data.stats?.total || events.length || 0),
		saleRecordCount,
		fillRecordCount,
		records: displayRows.map((row) => ({
			key: `${normalizeString(row?._id) || normalizeString(row?.source_id) || displayEventDay(row)}:${normalizeString(row?.type)}`,
			typeText: typeText(row?.type),
			date: displayEventDay(row),
			detail: buildRecordDetail(row)
		}))
	}
})

function buildTimelineDefault() {
	return {
		bottle_no: '',
		state: { code: 'empty', label: '暂无流转', kind: 'soft' },
		stats: { total: 0, out: 0, back: 0, fill: 0, adjust: 0, open_anomalies: 0, resolved_anomalies: 0, cycle_estimated: 0 },
		events: [],
		anomalies: [],
		markers: []
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

function typeText(type) {
	const map = {
		out: '出瓶',
		back: '回瓶',
		fill: '灌装',
		adjust: '调整'
	}
	return map[normalizeString(type).toLowerCase()] || normalizeString(type) || '-'
}

function findLatestEventByType(events, type) {
	const targetType = normalizeString(type).toLowerCase()
	for (let i = Number(events?.length || 0) - 1; i >= 0; i -= 1) {
		const row = events[i]
		if (normalizeString(row?.type).toLowerCase() === targetType) return row
	}
	return null
}

function countUniqueSourceIds(rows) {
	const set = new Set()
	for (const row of rows || []) {
		const id = normalizeString(row?.source_id)
		if (id) set.add(id)
	}
	return set.size
}

function resolveCurrentStatus(state, latestEvent) {
	const code = normalizeString(state?.code)
	if (code === 'waiting_back') return '在客户'
	if (['waiting_fill', 'ready_out', 'adjusted'].includes(code)) return '在站'
	if (code === 'waiting_next_action') return '待后续动作'
	if (code === 'anomaly_open') {
		return normalizeString(latestEvent?.type).toLowerCase() === 'out' ? '在客户' : '在站'
	}
	return normalizeString(state?.label) || '待确认'
}

function resolveCurrentCustomer(currentStatus, latestEvent, latestOut, latestBack) {
	if (currentStatus === '在客户') {
		return normalizeString(latestOut?.customer_name) || normalizeString(latestEvent?.customer_name) || '—'
	}
	if (currentStatus === '在站') {
		return normalizeString(latestBack?.customer_name) || normalizeString(latestEvent?.customer_name) || '—'
	}
	return normalizeString(latestEvent?.customer_name) || normalizeString(latestOut?.customer_name) || normalizeString(latestBack?.customer_name) || '—'
}

function resolveCurrentCustomerLabel(currentStatus) {
	if (currentStatus === '在客户') return '持有客户'
	if (currentStatus === '在站') return '最近往来客户'
	return '关联客户'
}

function formatNetWeight(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	return Number.isInteger(num) ? String(num) : String(num).replace(/\.?0+$/, '')
}

function buildRecordDetail(row) {
	const type = normalizeString(row?.type).toLowerCase()
	const customer = normalizeString(row?.customer_name)
	if (type === 'fill') {
		const netText = formatNetWeight(row?.net_weight)
		if (netText) return `净重 ${netText} kg`
		return normalizeString(row?.note) || '灌装记录'
	}
	if (type === 'adjust') {
		const netText = formatNetWeight(Math.abs(Number(row?.loss_weight || 0)))
		if (netText) return `${Number(row?.loss_weight || 0) >= 0 ? '损耗' : '胀重'} ${netText} kg`
	}
	return customer || '—'
}

function getTouchPoint(event) {
	const touch = event?.touches?.[0] || event?.changedTouches?.[0]
	if (!touch) return null
	return {
		x: Number(touch.clientX),
		y: Number(touch.clientY)
	}
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max)
}

function resolveViewportSizeByWindow() {
	if (typeof window === 'undefined') return { width: 0, height: 0 }
	const visualWidth = Number(window?.visualViewport?.width || 0)
	const visualHeight = Number(window?.visualViewport?.height || 0)
	const innerWidth = Number(window?.innerWidth || 0)
	const innerHeight = Number(window?.innerHeight || 0)
	const docWidth = Number(window?.document?.documentElement?.clientWidth || 0)
	const docHeight = Number(window?.document?.documentElement?.clientHeight || 0)
	return {
		width: Math.round(Math.max(visualWidth, innerWidth, docWidth)),
		height: Math.round(Math.max(visualHeight, innerHeight, docHeight))
	}
}

function getTriggerBounds() {
	return {
		minX: DRAG_EDGE_GAP,
		maxX: Math.max(DRAG_EDGE_GAP, metrics.windowWidth - metrics.triggerSize - DRAG_EDGE_GAP),
		minY: DRAG_EDGE_GAP,
		maxY: Math.max(DRAG_EDGE_GAP, metrics.windowHeight - metrics.triggerSize - DRAG_EDGE_GAP)
	}
}

function getPanelBounds() {
	return {
		minX: 0,
		maxX: Math.max(0, metrics.windowWidth - metrics.panelWidth),
		minY: 0,
		maxY: Math.max(0, metrics.windowHeight - metrics.panelHeight)
	}
}

function clampTriggerPosition(x, y) {
	const bounds = getTriggerBounds()
	triggerPosition.x = clamp(x, bounds.minX, bounds.maxX)
	triggerPosition.y = clamp(y, bounds.minY, bounds.maxY)
}

function clampPanelPosition(x, y) {
	const bounds = getPanelBounds()
	panelPosition.x = clamp(x, bounds.minX, bounds.maxX)
	panelPosition.y = clamp(y, bounds.minY, bounds.maxY)
}

function initMetrics({ preservePosition = false } = {}) {
	const currentTrigger = { x: triggerPosition.x, y: triggerPosition.y }
	const currentPanel = { x: panelPosition.x, y: panelPosition.y }
	try {
		const sys = uni.getSystemInfoSync()
		const h5Viewport = resolveViewportSizeByWindow()
		const resolvedWidth = Number(h5Viewport.width || sys.windowWidth || 0)
		const resolvedHeight = Number(h5Viewport.height || sys.windowHeight || 0)
		metrics.windowWidth = Math.max(resolvedWidth, 390)
		metrics.windowHeight = Math.max(resolvedHeight, 844)
		metrics.triggerSize = Math.max(48, Math.round(uni.upx2px(96)))
		metrics.triggerMargin = Math.max(12, Math.round(uni.upx2px(40)))
		metrics.panelWidth = Math.min(metrics.windowWidth - 16, Math.max(320, Math.round(uni.upx2px(760))))
		metrics.panelHeight = Math.min(metrics.windowHeight - 24, Math.max(420, Math.round(uni.upx2px(1300))))
	} catch (err) {
		const h5Viewport = resolveViewportSizeByWindow()
		metrics.windowWidth = Math.max(h5Viewport.width || 0, 390)
		metrics.windowHeight = Math.max(h5Viewport.height || 0, 844)
		metrics.triggerSize = 48
		metrics.triggerMargin = 20
		metrics.panelWidth = 380
		metrics.panelHeight = 620
	}
	if (preservePosition) {
		clampTriggerPosition(currentTrigger.x, currentTrigger.y)
		clampPanelPosition(currentPanel.x, currentPanel.y)
		return
	}
	clampTriggerPosition(
		Math.max(metrics.windowWidth - metrics.triggerSize - metrics.triggerMargin, metrics.triggerMargin),
		Math.max(metrics.windowHeight - metrics.triggerSize - metrics.triggerMargin * 2, metrics.triggerMargin)
	)
	clampPanelPosition(
		Math.max(metrics.windowWidth - metrics.panelWidth - metrics.triggerMargin, 8),
		Math.max(12, Math.min(32, metrics.windowHeight - metrics.panelHeight - 12))
	)
}

function openPanel() {
	open.value = true
}

function close() {
	open.value = false
}

async function onSearch() {
	const bottleNo = normalizeBottleNo(keyword.value)
	if (!bottleNo || loading.value) {
		if (!bottleNo) uni.showToast({ title: '请输入瓶号', icon: 'none' })
		return
	}
	loading.value = true
	try {
		const res = await getBottleMovementTimelineV1({ bottleNo, limit: 1200 })
		searched.value = true
		if (res?.code !== 0) {
			timeline.value = buildTimelineDefault()
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return
		}
		timeline.value = res?.data && typeof res.data === 'object'
			? {
				...buildTimelineDefault(),
				...res.data,
				state: { ...buildTimelineDefault().state, ...(res.data.state || {}) },
				stats: { ...buildTimelineDefault().stats, ...(res.data.stats || {}) },
				events: Array.isArray(res.data.events) ? res.data.events : []
			}
			: buildTimelineDefault()
	} finally {
		loading.value = false
	}
}

function goTimeline() {
	const bottleNo = normalizeBottleNo(result.value.bottleNo)
	if (!bottleNo) return
	close()
	uni.navigateTo({ url: `/pages/bottle/timeline?bottle_no=${encodeURIComponent(bottleNo)}` })
}

function onTriggerClick() {
	if (suppressTriggerClick.value) {
		suppressTriggerClick.value = false
		return
	}
	if (touchDrag.active || touchDrag.moved) return
	openPanel()
}

function beginTouchDrag(kind, point) {
	touchDrag.active = kind
	touchDrag.startX = point.x
	touchDrag.startY = point.y
	touchDrag.moved = false
	if (kind === 'trigger') {
		touchDrag.originX = triggerPosition.x
		touchDrag.originY = triggerPosition.y
		return
	}
	touchDrag.originX = panelPosition.x
	touchDrag.originY = panelPosition.y
}

function onTriggerTouchStart(event) {
	const point = getTouchPoint(event)
	if (!point) return
	beginTouchDrag('trigger', point)
}

function onPanelHandleTouchStart(event) {
	const point = getTouchPoint(event)
	if (!point) return
	beginTouchDrag('panel', point)
}

function beginMouseDrag(kind, x, y) {
	if (touchDrag.active) return
	mouseDrag.active = kind
	mouseDrag.startX = x
	mouseDrag.startY = y
	mouseDrag.moved = false
	if (kind === 'trigger') {
		mouseDrag.originX = triggerPosition.x
		mouseDrag.originY = triggerPosition.y
	} else {
		mouseDrag.originX = panelPosition.x
		mouseDrag.originY = panelPosition.y
	}
}

function onTriggerMouseDown(event) {
	beginMouseDrag('trigger', Number(event?.clientX || 0), Number(event?.clientY || 0))
}

function onPanelMouseDown(event) {
	beginMouseDrag('panel', Number(event?.clientX || 0), Number(event?.clientY || 0))
}

function handleMouseMove(event) {
	if (touchDrag.active) return
	if (!mouseDrag.active) return
	const x = Number(event?.clientX || 0)
	const y = Number(event?.clientY || 0)
	const dx = x - mouseDrag.startX
	const dy = y - mouseDrag.startY
	if (Math.abs(dx) > 4 || Math.abs(dy) > 4) mouseDrag.moved = true
	if (mouseDrag.active === 'trigger') {
		clampTriggerPosition(mouseDrag.originX + dx, mouseDrag.originY + dy)
		return
	}
	clampPanelPosition(mouseDrag.originX + dx, mouseDrag.originY + dy)
}

function handleMouseUp() {
	if (mouseDrag.active === 'trigger' && mouseDrag.moved) {
		suppressTriggerClick.value = true
	}
	mouseDrag.active = ''
	mouseDrag.moved = false
}

function handleTouchMove(event) {
	if (!touchDrag.active) return
	const point = getTouchPoint(event)
	if (!point) return
	if (typeof event?.preventDefault === 'function') event.preventDefault()
	const dx = point.x - touchDrag.startX
	const dy = point.y - touchDrag.startY
	if (Math.abs(dx) > 4 || Math.abs(dy) > 4) touchDrag.moved = true
	if (touchDrag.active === 'trigger') {
		clampTriggerPosition(touchDrag.originX + dx, touchDrag.originY + dy)
		return
	}
	clampPanelPosition(touchDrag.originX + dx, touchDrag.originY + dy)
}

function handleTouchEnd() {
	if (!touchDrag.active) return
	if (touchDrag.active === 'trigger' && touchDrag.moved) {
		suppressTriggerClick.value = true
	}
	touchDrag.active = ''
	touchDrag.moved = false
}

function handleViewportResize() {
	initMetrics({ preservePosition: true })
}

onMounted(() => {
	initMetrics()
	if (typeof window !== 'undefined') {
		window.addEventListener('mousemove', handleMouseMove)
		window.addEventListener('mouseup', handleMouseUp)
		window.addEventListener('touchmove', handleTouchMove, touchMoveOptions)
		window.addEventListener('touchend', handleTouchEnd)
		window.addEventListener('touchcancel', handleTouchEnd)
		window.addEventListener('resize', handleViewportResize)
		window.visualViewport?.addEventListener('resize', handleViewportResize)
	}
})

onBeforeUnmount(() => {
	if (typeof window !== 'undefined') {
		window.removeEventListener('mousemove', handleMouseMove)
		window.removeEventListener('mouseup', handleMouseUp)
		window.removeEventListener('touchmove', handleTouchMove, touchMoveOptions)
		window.removeEventListener('touchend', handleTouchEnd)
		window.removeEventListener('touchcancel', handleTouchEnd)
		window.removeEventListener('resize', handleViewportResize)
		window.visualViewport?.removeEventListener('resize', handleViewportResize)
	}
})
</script>

<style scoped>
.bottle-query__trigger {
	position: fixed;
	z-index: 1001;
	border-radius: 999rpx;
	background: linear-gradient(135deg, #2563eb, #1d4ed8);
	display: flex;
	align-items: center;
	justify-content: center;
	box-shadow: 0 12rpx 32rpx rgba(37, 99, 235, 0.28);
	opacity: 0.42;
	transition: opacity 0.2s ease, transform 0.2s ease;
	cursor: move;
	touch-action: none;
}

.bottle-query__trigger:hover {
	opacity: 1;
}

.bottle-query__overlay {
	position: fixed;
	inset: 0;
	background: rgba(15, 23, 42, 0.18);
	z-index: 1002;
	pointer-events: none;
}

.bottle-query__panel {
	position: fixed;
	background: #fff;
	z-index: 1003;
	border-radius: 24rpx;
	box-shadow: 0 16rpx 48rpx rgba(15, 23, 42, 0.16);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.bottle-query__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 28rpx 32rpx 16rpx;
	border-bottom: 1rpx solid var(--crm-border-weak);
}

.bottle-query__header-main {
	display: flex;
	align-items: center;
	gap: 12rpx;
	min-width: 0;
}

.bottle-query__drag-handle {
	width: 44rpx;
	height: 44rpx;
	border-radius: 12rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: move;
	user-select: none;
	touch-action: none;
	flex: none;
}

.bottle-query__title {
	font-size: 40rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.bottle-query__close {
	width: 64rpx;
	height: 64rpx;
	border-radius: 32rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--crm-text-muted);
}

.bottle-query__search-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 16rpx;
	padding: 24rpx 32rpx 0;
	align-items: end;
}

.bottle-query__body {
	flex: 1;
	min-height: 0;
	padding: 24rpx 32rpx 40rpx;
	box-sizing: border-box;
}

.bottle-query__card {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.bottle-query__hero {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
	padding: 28rpx;
	border-radius: 24rpx;
	background: #fff;
	border: 1rpx solid var(--crm-border);
}

.bottle-query__hero-title {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.bottle-query__stats {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16rpx;
	padding: 24rpx 20rpx;
	border-radius: 24rpx;
	background: linear-gradient(180deg, #eef7ff 0%, #f8fbff 100%);
}

.bottle-query__stat {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10rpx;
}

.bottle-query__stat-value {
	font-size: 54rpx;
	font-weight: 700;
	color: var(--crm-primary);
	line-height: 1;
}

.bottle-query__stat-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.bottle-query__section {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
	padding: 28rpx;
	border-radius: 24rpx;
	background: #fff;
	border: 1rpx solid var(--crm-border);
}

.bottle-query__section-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
}

.bottle-query__section-title {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.bottle-query__kv {
	display: flex;
	gap: 12rpx;
	font-size: 24rpx;
	line-height: 1.6;
}

.bottle-query__kv-label {
	color: var(--crm-text-muted);
	min-width: 112rpx;
}

.bottle-query__kv-value {
	color: var(--crm-text);
	flex: 1;
	word-break: break-all;
}

.bottle-query__records {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.bottle-query__record {
	display: grid;
	grid-template-columns: auto 180rpx minmax(0, 1fr);
	align-items: center;
	gap: 16rpx;
	padding: 18rpx 20rpx;
	border-radius: 18rpx;
	background: var(--crm-bg);
}

.bottle-query__record-date {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.bottle-query__record-customer {
	font-size: 24rpx;
	color: var(--crm-text);
	text-align: right;
}

.bottle-query__empty {
	padding: 80rpx 32rpx;
	display: flex;
	flex-direction: column;
	gap: 12rpx;
	align-items: center;
	justify-content: center;
	color: var(--crm-text-muted);
}

.bottle-query__empty-title {
	font-size: 28rpx;
	font-weight: 600;
	color: var(--crm-text);
}

.bottle-query__empty-desc {
	font-size: 24rpx;
}

@media (max-width: 640px) {
	.bottle-query__panel {
		max-width: calc(100vw - 12px);
	}

	.bottle-query__search-row {
		grid-template-columns: 1fr;
	}

	.bottle-query__record {
		grid-template-columns: auto 1fr;
	}

	.bottle-query__record-customer {
		grid-column: 1 / -1;
		text-align: left;
	}
}
</style>
