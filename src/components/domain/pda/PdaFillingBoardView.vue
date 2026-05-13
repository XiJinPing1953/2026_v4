<template>
	<AppPage title="灌装看板" subtitle="PDA FILLING" icon="list" hideBottleQuery>
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :loading="loading" @click="loadBoard({ loading: true })">刷新</AppButton>
			<AppButton size="sm" kind="primary" @click="promptStationSelect">选择工位</AppButton>
		</template>

		<AppSection title="统计">
			<view class="summary-grid">
				<view v-for="item in summaryItems" :key="item.key" :class="['summary-cell', `summary-cell--${item.key}`]">
					<text class="summary-label">{{ item.label }}</text>
					<text class="summary-value">{{ item.value }}</text>
				</view>
			</view>
		</AppSection>

		<AppSection title="工位卡片">
			<view class="station-list">
				<view
					v-for="station in stations"
					:key="station.stationCode"
					:class="['station-card', `station-card--${station.status || 'unknown'}`]"
					@click="goStation(station.stationCode)"
				>
					<view class="station-head">
						<view class="station-title">
							<text class="station-name">{{ station.stationName }}</text>
							<AppTag :kind="statusKind(station.status)">{{ statusLabel(station.status) }}</AppTag>
						</view>
						<AppButton
							v-if="canCreateTask(station)"
							size="sm"
							kind="neutral"
							@click.stop="goCreate(station.stationCode)"
						>
							创建任务
						</AppButton>
						<AppButton
							v-else-if="station.task && station.status === PDA_FILLING_STATION_STATUS.REACHED"
							size="sm"
							kind="primary"
							@click.stop="goComplete(station.task._id)"
						>
							确认完成
						</AppButton>
						<AppButton
							v-else-if="station.task && station.status === PDA_FILLING_STATION_STATUS.ABNORMAL"
							size="sm"
							kind="neutral"
							@click.stop="goComplete(station.task._id)"
						>
							处理异常
						</AppButton>
					</view>

					<view v-if="station.task" class="task-lines">
						<text class="task-line">{{ station.task.bottleNo || '-' }}</text>
						<text class="task-line">
							已充 {{ weightText(station.task.currentNetWeight) }} / 目标 {{ weightText(station.task.targetNetWeight) }}
						</text>
						<text :class="['task-line', 'task-line--delta', deltaClass(station)]">{{ deltaText(station.task) }}</text>
						<text class="task-line">{{ stationHint(station) }}</text>
					</view>
					<view v-else-if="station.status === PDA_FILLING_STATION_STATUS.WAIT_ZERO" class="task-lines task-lines--wait-zero">
						<text class="task-line task-line--strong">等待回零：当前 {{ weightText(station.scale.weightKg) }}</text>
						<text class="task-line">回零后可创建新任务</text>
					</view>
					<view v-else class="task-lines">
						<text class="task-line">当前 {{ weightText(station.scale.weightKg) }}</text>
						<text class="task-line">可创建任务</text>
					</view>
				</view>
			</view>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import {
	formatPdaFillingWeight,
	getPdaFillingBoardV1,
	getPdaFillingStatusKind,
	getPdaFillingStatusLabel,
	PDA_FILLING_STATION_STATUS
} from '@/services/pda/fillingTask'

const loading = ref(false)
const stations = ref([])
const summary = ref({})
let timer = null
let boardRequest = null

const summaryItems = computed(() => [
	{ key: 'idle', label: '空闲', value: summary.value.idle || 0 },
	{ key: 'writing', label: '写入中', value: summary.value.writing || 0 },
	{ key: 'ready', label: '待启动', value: summary.value.ready || 0 },
	{ key: 'filling', label: '充装中', value: summary.value.filling || 0 },
	{ key: 'reached', label: '已到量', value: summary.value.reached || 0 },
	{ key: 'abnormal', label: '异常', value: summary.value.abnormal || 0 },
	{ key: 'wait_zero', label: '待回零', value: summary.value.wait_zero || 0 }
])

function statusLabel(status) {
	return getPdaFillingStatusLabel(status)
}

function statusKind(status) {
	return getPdaFillingStatusKind(status)
}

function weightText(value) {
	return formatPdaFillingWeight(value, 1)
}

function toNumber(value) {
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function deltaValue(task) {
	const current = toNumber(task?.currentNetWeight)
	const target = toNumber(task?.targetNetWeight)
	if (current == null || target == null) return null
	return Number((target - current).toFixed(3))
}

function deltaText(task) {
	const delta = deltaValue(task)
	if (delta == null) return '差值 --'
	if (delta > 0) return `还差 ${weightText(delta)}`
	if (delta < 0) return `超 ${weightText(Math.abs(delta))}`
	return '已到目标'
}

function deltaClass(station) {
	if (station?.status === PDA_FILLING_STATION_STATUS.REACHED) return 'task-line--ok'
	if (station?.status === PDA_FILLING_STATION_STATUS.ABNORMAL) return 'task-line--danger'
	const delta = deltaValue(station?.task)
	if (delta == null) return ''
	if (delta < 0) return 'task-line--danger'
	if (delta <= 0.5) return 'task-line--warning'
	return ''
}

function canCreateTask(station) {
	return station?.status === PDA_FILLING_STATION_STATUS.IDLE
}

function stationHint(station) {
	if (station.status === PDA_FILLING_STATION_STATUS.WRITING) return station.task?.targetWriteError || '等待写入 C606+ 目标'
	if (station.status === PDA_FILLING_STATION_STATUS.READY) return '现场可启动 C606+'
	if (station.status === PDA_FILLING_STATION_STATUS.FILLING) return '充装中'
	if (station.status === PDA_FILLING_STATION_STATUS.REACHED) return '等待确认'
	if (station.status === PDA_FILLING_STATION_STATUS.ABNORMAL) return station.task?.targetWriteError || '请处理异常'
	return station.scale?.isOnline ? '可创建任务' : station.scale?.errorMessage || '秤离线'
}

async function loadBoard(options = {}) {
	if (boardRequest) return boardRequest
	const showLoading = options.loading !== false
	const silent = options.silent === true
	if (showLoading) loading.value = true
	boardRequest = (async () => {
		try {
			const res = await getPdaFillingBoardV1()
			if (res.code !== 0) {
				if (!silent) showToast(res.msg || '看板加载失败')
				return
			}
			stations.value = res.data.stations
			summary.value = res.data.summary || {}
		} finally {
			if (showLoading) loading.value = false
			boardRequest = null
		}
	})()
	return boardRequest
}

function goStation(stationCode) {
	uni.navigateTo({ url: `/pages/pda/filling-station?station_code=${encodeURIComponent(stationCode)}` })
}

function goCreate(stationCode) {
	uni.navigateTo({ url: `/pages/pda/filling-create?station_code=${encodeURIComponent(stationCode)}` })
}

function goComplete(taskId) {
	uni.navigateTo({ url: `/pages/pda/filling-complete?task_id=${encodeURIComponent(taskId)}` })
}

function promptStationSelect() {
	showToast('请在下方选择具体工位')
}

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

onMounted(() => {
	loadBoard({ loading: true })
	timer = setInterval(() => loadBoard({ loading: false, silent: true }), 1200)
})

onBeforeUnmount(() => {
	if (timer) clearInterval(timer)
	timer = null
})

defineExpose({ loadBoard })
</script>

<style scoped>
.summary-grid {
	display: grid;
	grid-template-columns: repeat(7, minmax(0, 1fr));
	gap: 16rpx;
}

.summary-cell {
	padding: 18rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.summary-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.summary-value {
	font-size: 36rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.summary-cell--writing .summary-value,
.summary-cell--ready .summary-value,
.summary-cell--filling .summary-value {
	color: #8a5a00;
}

.summary-cell--reached .summary-value {
	color: #2e844a;
}

.summary-cell--abnormal .summary-value {
	color: #ba0517;
}

.summary-cell--wait_zero .summary-value {
	color: #706e6b;
}

.station-list {
	display: grid;
	grid-template-columns: 1fr;
	gap: 20rpx;
}

.station-card {
	padding: 22rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.station-card--reached {
	border-color: #91db8b;
	background: #f3fff2;
}

.station-card--abnormal {
	border-color: #ea001e;
	background: #fff5f5;
}

.station-card--wait_zero {
	border-color: #c9c7c5;
	background: #f7f7f7;
}

.station-card--writing,
.station-card--ready,
.station-card--filling {
	border-color: #fcc003;
}

.station-card:active {
	opacity: 0.88;
}

.station-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16rpx;
}

.station-title {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12rpx;
}

.station-name {
	font-size: 32rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.task-lines {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.task-lines--wait-zero {
	padding: 14rpx;
	border-radius: var(--crm-radius-sm);
	background: #fff;
	border: 1rpx dashed #c9c7c5;
}

.task-line {
	font-size: 28rpx;
	color: var(--crm-text-muted);
	line-height: 1.45;
	word-break: break-all;
}

.task-line--strong {
	font-weight: 700;
	color: var(--crm-text);
}

.task-line--delta {
	font-weight: 700;
	color: var(--crm-text);
}

.task-line--warning {
	color: #8a5a00;
}

.task-line--ok {
	color: #2e844a;
}

.task-line--danger {
	color: #ba0517;
}

@media (max-width: 680px) {
	.summary-grid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
}

@media (max-width: 420px) {
	.summary-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
