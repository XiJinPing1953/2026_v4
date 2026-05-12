<template>
	<AppPage :title="title" subtitle="FILLING STATION" icon="bottle" hideBottleQuery>
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :loading="loading" @click="loadStation">刷新</AppButton>
			<AppButton size="sm" kind="neutral" @click="goBoard">返回看板</AppButton>
		</template>

		<AppSection title="当前重量">
			<view class="weight-panel">
				<text class="weight-value">{{ weightText(station?.scale?.weightKg) }}</text>
				<AppTag :kind="station?.scale?.isOnline ? station?.scale?.isStable ? 'success' : 'warning' : 'danger'">
					{{ station?.scale?.isOnline ? station?.scale?.isStable ? '稳定' : '动态' : '离线' }}
				</AppTag>
			</view>
		</AppSection>

		<AppSection title="任务信息">
			<view v-if="task" class="info-list">
				<view class="info-row">
					<text class="info-label">瓶号</text>
					<text class="info-value">{{ task.bottleNo || '-' }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">目标</text>
					<text class="info-value">{{ weightText(task.targetNetWeight) }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">已充</text>
					<text class="info-value">{{ weightText(task.currentNetWeight) }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">状态</text>
					<view class="info-value">
						<AppTag :kind="statusKind(station.status)">{{ statusLabel(station.status) }}</AppTag>
					</view>
				</view>
			</view>
			<view v-else class="empty-block">
				<text class="empty-text">{{ station?.status === 'wait_zero' ? '当前重量未回零' : '当前无任务' }}</text>
			</view>
		</AppSection>

		<AppSection title="设备状态">
			<view class="info-list">
				<view class="info-row">
					<text class="info-label">通讯</text>
					<text class="info-value">{{ station?.scale?.isOnline ? '正常' : station?.scale?.errorMessage || '离线' }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">稳定</text>
					<text class="info-value">{{ station?.scale?.isStable ? '是' : '否' }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">报警</text>
					<text class="info-value">{{ station?.status === 'abnormal' ? '有' : '无' }}</text>
				</view>
			</view>
		</AppSection>

		<AppSection title="下一步">
			<view class="next-actions">
				<text class="hint-text">{{ nextHint }}</text>
				<view class="actions-row">
					<AppButton v-if="canCreate" kind="primary" @click="goCreate">扫气瓶</AppButton>
					<AppButton v-if="task" kind="primary" @click="goComplete">确认完成</AppButton>
					<AppButton v-if="task" kind="neutral" @click="goComplete">异常上报</AppButton>
				</view>
			</view>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import {
	formatPdaFillingWeight,
	getPdaFillingStationV1,
	getPdaFillingStatusKind,
	getPdaFillingStatusLabel,
	PDA_FILLING_STATION_STATUS
} from '@/services/pda/fillingTask'

const props = defineProps({
	stationCode: { type: String, default: '' }
})

const loading = ref(false)
const station = ref(null)
let timer = null

const task = computed(() => station.value?.task || null)
const title = computed(() => station.value?.stationName ? `${station.value.stationName}灌装机` : '灌装工位')
const canCreate = computed(() => station.value?.status === PDA_FILLING_STATION_STATUS.IDLE)
const nextHint = computed(() => {
	if (!station.value) return '-'
	if (station.value.status === PDA_FILLING_STATION_STATUS.IDLE) return '可创建任务'
	if (station.value.status === PDA_FILLING_STATION_STATUS.WRITING) return '目标写入 C606+ 中'
	if (station.value.status === PDA_FILLING_STATION_STATUS.READY) return '现场可启动 C606+'
	if (station.value.status === PDA_FILLING_STATION_STATUS.FILLING) return '接近目标，请注意返回处理'
	if (station.value.status === PDA_FILLING_STATION_STATUS.REACHED) return '已到量，等待确认'
	if (station.value.status === PDA_FILLING_STATION_STATUS.WAIT_ZERO) return '等待回零后创建新任务'
	return '请处理异常'
})

function weightText(value) {
	return formatPdaFillingWeight(value, 1)
}

function statusLabel(status) {
	return getPdaFillingStatusLabel(status)
}

function statusKind(status) {
	return getPdaFillingStatusKind(status)
}

async function loadStation() {
	if (!props.stationCode) return
	loading.value = true
	try {
		const res = await getPdaFillingStationV1({ station_code: props.stationCode })
		if (res.code !== 0) {
			showToast(res.msg || '工位加载失败')
			return
		}
		station.value = res.data
	} finally {
		loading.value = false
	}
}

function goCreate() {
	uni.navigateTo({ url: `/pages/pda/filling-create?station_code=${encodeURIComponent(props.stationCode)}` })
}

function goComplete() {
	if (!task.value?._id) return
	uni.navigateTo({ url: `/pages/pda/filling-complete?task_id=${encodeURIComponent(task.value._id)}` })
}

function goBoard() {
	uni.redirectTo({ url: '/pages/pda/filling-board' })
}

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

function startPolling() {
	if (timer) clearInterval(timer)
	timer = setInterval(loadStation, 1200)
}

watch(
	() => props.stationCode,
	() => {
		loadStation()
		startPolling()
	},
	{ immediate: true }
)

onMounted(startPolling)

onBeforeUnmount(() => {
	if (timer) clearInterval(timer)
	timer = null
})

defineExpose({ loadStation })
</script>

<style scoped>
.weight-panel {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 20rpx;
}

.weight-value {
	font-size: 52rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.info-list {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.info-row {
	display: grid;
	grid-template-columns: 140rpx minmax(0, 1fr);
	gap: 18rpx;
	align-items: center;
}

.info-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.info-value {
	font-size: 30rpx;
	font-weight: 700;
	color: var(--crm-text);
	word-break: break-all;
}

.empty-block {
	padding: 24rpx;
	border: 1rpx dashed var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
}

.empty-text,
.hint-text {
	font-size: 26rpx;
	color: var(--crm-text-muted);
	line-height: 1.5;
}

.next-actions {
	display: flex;
	flex-direction: column;
	gap: 20rpx;
}

.actions-row {
	display: flex;
	flex-wrap: wrap;
	gap: 16rpx;
	justify-content: flex-end;
}
</style>
