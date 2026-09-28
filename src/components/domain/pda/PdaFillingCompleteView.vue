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
					<text class="info-value">{{ weightText(endWeight) }}</text>
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
				<AppInput v-model="remark" label="备注" placeholder="可选" :disabled="completion.physicalComplete || completion.legacy" />
			</view>
			<view v-else class="empty-block">
				<text class="empty-text">任务不存在或已不可用</text>
			</view>

			<view v-if="task" class="save-panel">
				<text class="info-value">{{ saveMessage }}</text>
				<text v-if="completion.operationId" class="status-detail">完成编号：{{ completion.operationId }}</text>
				<text v-if="completion.sourceSaved" class="status-detail">源单：{{ completion.fillingRecordId }}</text>
				<text v-if="completion.physicalComplete" class="status-detail">完成操作者：{{ completion.operator || '-' }}；结束重量、时间和备注已冻结</text>
				<text class="status-detail">后续处理：{{ processingText }}</text>
				<text v-if="completion.lastError" class="status-error">{{ completion.lastError }}</text>
				<text v-if="requestError" class="status-error">{{ requestError }}</text>
			</view>
			<view class="actions-row">
				<AppButton kind="primary" :loading="submitting" :disabled="!canSubmit" @click="onComplete">{{ completion.physicalComplete ? '恢复重试' : '确认完成' }}</AppButton>
				<AppButton v-if="!completion.physicalComplete && !completion.legacy" kind="neutral" :loading="submitting" :disabled="!canSubmit" @click="onMarkAbnormal">标记异常</AppButton>
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
	getPdaCompletionMessage,
	normalizePdaFillingTask,
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
const requestError = ref('')
const completion = computed(() => task.value?.completion || {})
const saveMessage = computed(() => getPdaCompletionMessage(completion.value))
const canSubmit = computed(() => Boolean(task.value && !loading.value && !submitting.value && !completion.value.legacy && (!completion.value.physicalComplete || completion.value.canRetry)))
const endWeight = computed(() => completion.value.physicalComplete ? task.value?.weightEnd : scale.value?.weightKg)
const processingText = computed(() => {
	const state = completion.value
	if (state.complete) return '流转、监管入队与异常核查已完成'
	if (state.processingStatus === 'failed') return '处理失败，可恢复重试'
	if (state.processingStatus === 'conflict') return '原操作与源单不一致，需管理员核查'
	if (state.legacy) return '旧任务待核查'
	if (state.remainingTotal != null) return `核查已完成 ${state.processedTotal ?? 0} / ${state.targetTotal ?? 0}，剩余 ${state.remainingTotal}；其他处理以最终完成状态为准`
	return state.physicalComplete ? '等待查询确认' : '尚未提交'
})

const title = computed(() => (task.value?.stationName ? `${task.value.stationName} - 完成确认` : '完成确认'))
const actualNetWeight = computed(() => {
	if (completion.value.physicalComplete) return task.value?.actualNetWeight ?? null
	if (task.value?.weightStart == null || endWeight.value == null) return null
	const start = Number(task.value?.weightStart)
	const end = Number(endWeight.value)
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null
	return Number((end - start).toFixed(3))
})
const deviation = computed(() => {
	if (actualNetWeight.value == null || task.value?.targetNetWeight == null) return null
	const actual = Number(actualNetWeight.value)
	const target = Number(task.value?.targetNetWeight)
	if (!Number.isFinite(actual) || !Number.isFinite(target)) return null
	return Number((actual - target).toFixed(3))
})
const resultText = computed(() => {
	if (completion.value.physicalComplete) return ({ completed: '正常', overweight: '超量', underweight: '不足', error: '异常完成' })[completion.value.physicalStatus] || '完成结果待核'
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
		if (completion.value.complete && completion.value.taskLinked) requestError.value = ''
		if (!remark.value || completion.value.physicalComplete) remark.value = task.value?.remark || ''
	} catch (error) {
		requestError.value = error?.message || '查询确认中断，请刷新原任务'
		showToast(requestError.value)
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
		requestError.value = ''
		const res = await action({ task_id: task.value._id, remark: remark.value })
		if (res?.data?.task) task.value = normalizePdaFillingTask(res.data.task)
		if (res?.code !== 0) requestError.value = res?.msg || '提交未确认，请刷新或重试原任务'
		showToast(res?.code !== 0 ? requestError.value : getPdaCompletionMessage(task.value?.completion))
		await loadTask()
	} catch (error) {
		requestError.value = error?.message || '确认中断，请刷新或重试原任务'
		showToast(requestError.value)
		await loadTask()
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
.save-panel {
	margin-top: 24rpx;
	padding: 22rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.status-detail,
.status-error {
	font-size: 26rpx;
	line-height: 1.5;
	word-break: break-all;
}

.status-error { color: #ba0517; }

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
