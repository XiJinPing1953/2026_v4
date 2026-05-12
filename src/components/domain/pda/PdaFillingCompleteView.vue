<template>
	<AppPage :title="title" subtitle="COMPLETE" icon="check-circle" hideBottleQuery>
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :loading="loading" @click="loadTask">刷新</AppButton>
			<AppButton size="sm" kind="neutral" @click="goBoard">返回看板</AppButton>
		</template>

		<AppSection title="完成确认">
			<view v-if="task" class="confirm-panel">
				<view class="info-row">
					<text class="info-label">目标重量</text>
					<text class="info-value">{{ weightText(task.targetNetWeight) }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">开始重量</text>
					<text class="info-value">{{ weightText(task.weightStart) }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">结束重量</text>
					<text class="info-value">{{ weightText(scale.weightKg) }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">实际充装</text>
					<text class="info-value">{{ weightText(actualNetWeight) }}</text>
				</view>
				<view class="info-row">
					<text class="info-label">结果</text>
					<view class="info-value">
						<AppTag :kind="resultKind">{{ resultText }}</AppTag>
					</view>
				</view>
				<AppInput v-model="remark" label="备注" placeholder="可选" />
			</view>
			<view v-else class="empty-block">
				<text class="empty-text">任务不存在或已不可用</text>
			</view>

			<view class="actions-row">
				<AppButton kind="primary" :loading="submitting" :disabled="!task" @click="onComplete">确认完成</AppButton>
				<AppButton kind="neutral" :loading="submitting" :disabled="!task" @click="onMarkAbnormal">标记异常</AppButton>
			</view>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import {
	completePdaFillingTaskV1,
	formatPdaFillingWeight,
	getPdaFillingTaskV1,
	markPdaFillingTaskAbnormalV1
} from '@/services/pda/fillingTask'

const props = defineProps({
	taskId: { type: String, default: '' }
})

const loading = ref(false)
const submitting = ref(false)
const task = ref(null)
const scale = ref({})
const remark = ref('')

const title = computed(() => (task.value?.stationName ? `${task.value.stationName} - 完成确认` : '完成确认'))
const actualNetWeight = computed(() => {
	const start = Number(task.value?.weightStart)
	const end = Number(scale.value?.weightKg)
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null
	return Number((end - start).toFixed(3))
})
const deviation = computed(() => {
	const actual = Number(actualNetWeight.value)
	const target = Number(task.value?.targetNetWeight)
	if (!Number.isFinite(actual) || !Number.isFinite(target)) return null
	return Number((actual - target).toFixed(3))
})
const resultText = computed(() => {
	if (!scale.value?.isOnline) return scale.value?.errorMessage || '秤离线'
	if (!scale.value?.isStable) return '未稳定'
	if (deviation.value == null) return '-'
	if (deviation.value > 0.3) return '超量'
	if (deviation.value < -0.3) return '不足'
	return '正常'
})
const resultKind = computed(() => (resultText.value === '正常' ? 'success' : resultText.value === '未稳定' ? 'warning' : 'danger'))

function weightText(value) {
	return formatPdaFillingWeight(value, 1)
}

async function loadTask() {
	if (!props.taskId) return
	loading.value = true
	try {
		const res = await getPdaFillingTaskV1({ task_id: props.taskId })
		if (res.code !== 0) {
			showToast(res.msg || '任务加载失败')
			task.value = null
			return
		}
		task.value = res.data.task
		scale.value = res.data.scale || {}
		if (!remark.value) remark.value = task.value?.remark || ''
	} finally {
		loading.value = false
	}
}

async function onComplete() {
	await submit(false)
}

async function onMarkAbnormal() {
	await submit(true)
}

async function submit(abnormal) {
	if (submitting.value || !task.value?._id) return
	submitting.value = true
	try {
		const action = abnormal ? markPdaFillingTaskAbnormalV1 : completePdaFillingTaskV1
		const res = await action({ task_id: task.value._id, remark: remark.value })
		if (res?.code !== 0) {
			showToast(res?.msg || '保存失败')
			return
		}
		showToast(abnormal ? '异常记录已保存' : '灌装记录已保存')
		uni.redirectTo({ url: '/pages/pda/filling-board' })
	} finally {
		submitting.value = false
	}
}

function goBoard() {
	uni.redirectTo({ url: '/pages/pda/filling-board' })
}

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

watch(
	() => props.taskId,
	() => loadTask(),
	{ immediate: true }
)

defineExpose({ loadTask })
</script>

<style scoped>
.confirm-panel {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.info-row {
	display: grid;
	grid-template-columns: 160rpx minmax(0, 1fr);
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

.empty-text {
	font-size: 26rpx;
	color: var(--crm-text-muted);
}

.actions-row {
	margin-top: 24rpx;
	display: flex;
	flex-wrap: wrap;
	gap: 16rpx;
	justify-content: flex-end;
}
</style>
