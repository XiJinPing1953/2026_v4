<template>
	<AppPage title="灌装看板" subtitle="PDA FILLING" icon="list" hideBottleQuery>
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :loading="loading" @click="loadBoard">刷新</AppButton>
			<AppButton size="sm" kind="primary" @click="goFirstCreatable">扫码</AppButton>
		</template>

		<AppSection title="统计">
			<view class="summary-grid">
				<view class="summary-cell">
					<text class="summary-label">空闲</text>
					<text class="summary-value">{{ summary.idle || 0 }}</text>
				</view>
				<view class="summary-cell">
					<text class="summary-label">充装中</text>
					<text class="summary-value">{{ summary.filling || 0 }}</text>
				</view>
				<view class="summary-cell">
					<text class="summary-label">已到量</text>
					<text class="summary-value">{{ summary.reached || 0 }}</text>
				</view>
				<view class="summary-cell">
					<text class="summary-label">异常</text>
					<text class="summary-value">{{ summary.abnormal || 0 }}</text>
				</view>
			</view>
		</AppSection>

		<AppSection title="工位卡片">
			<view class="station-list">
				<view v-for="station in stations" :key="station.stationCode" class="station-card" @click="goStation(station.stationCode)">
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
							v-else-if="station.task && station.status === 'reached'"
							size="sm"
							kind="primary"
							@click.stop="goComplete(station.task._id)"
						>
							确认完成
						</AppButton>
					</view>

					<view v-if="station.task" class="task-lines">
						<text class="task-line">{{ station.task.bottleNo || '-' }}</text>
						<text class="task-line">
							{{ weightText(station.task.currentNetWeight) }} / {{ weightText(station.task.targetNetWeight) }}
						</text>
						<text class="task-line">{{ stationHint(station) }}</text>
					</view>
					<view v-else class="task-lines">
						<text class="task-line">当前 {{ weightText(station.scale.weightKg) }}</text>
						<text class="task-line">{{ station.status === 'wait_zero' ? '等待回零' : '可创建任务' }}</text>
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

const idleStation = computed(() => stations.value.find((item) => canCreateTask(item)) || null)

function statusLabel(status) {
	return getPdaFillingStatusLabel(status)
}

function statusKind(status) {
	return getPdaFillingStatusKind(status)
}

function weightText(value) {
	return formatPdaFillingWeight(value, 1)
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

async function loadBoard() {
	loading.value = true
	try {
		const res = await getPdaFillingBoardV1()
		if (res.code !== 0) {
			showToast(res.msg || '看板加载失败')
			return
		}
		stations.value = res.data.stations
		summary.value = res.data.summary || {}
	} finally {
		loading.value = false
	}
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

function goFirstCreatable() {
	if (!idleStation.value) {
		showToast('暂无空闲工位')
		return
	}
	goCreate(idleStation.value.stationCode)
}

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

onMounted(() => {
	loadBoard()
	timer = setInterval(loadBoard, 1200)
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
	grid-template-columns: repeat(4, minmax(0, 1fr));
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

.task-line {
	font-size: 28rpx;
	color: var(--crm-text-muted);
	line-height: 1.45;
	word-break: break-all;
}

@media (max-width: 680px) {
	.summary-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
