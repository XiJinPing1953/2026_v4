<template>
	<view v-if="items.length || error" class="operation-panel">
		<view class="operation-heading">
			<text>灌装处理状态</text>
			<AppButton size="sm" kind="neutral" :loading="loading" @click="refresh">刷新状态</AppButton>
		</view>
		<text v-if="error" class="operation-error">{{ error }}</text>
		<view v-for="item in items" :key="item.operation_id" class="operation-row">
			<text>{{ item.date || '灌装批次' }} · {{ label(item) }}</text>
			<text>提交编号：{{ item.operation_id }}</text>
			<text v-if="item.accepted_total != null">已确认保存 {{ item.saved_total }}/{{ item.accepted_total }} 条，流转已核查 {{ item.processed_total }}/{{ item.target_total }} 个</text>
			<text v-if="item.failed">未纳入 {{ item.failed }} 条，请核对批量结果</text>
			<text v-if="item.last_error" class="operation-error">{{ item.last_error }}</text>
			<AppButton v-if="canRetry && item.status === 'failed'" size="sm" kind="neutral" :disabled="loading" @click="retry(item)">重试剩余处理</AppButton>
			<AppButton v-if="item.accepted_total != null" size="sm" kind="neutral" @click="inspect(item)">查看源单状态</AppButton>
			<text v-for="source in sourceDetails[item.operation_id] || []" :key="source._id">{{ source.bottle_no || '无瓶号' }} · {{ !source.saved ? '尚未保存' : !source.version_matches ? '源单版本已变更' : source.consistency_status === 'complete' ? '已保存并核查' : '已保存，后续处理中' }} · {{ source._id }}</text>
		</view>
	</view>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { listFillingOperationsV1, retryFillingOperationV1, getFillingOperationV1 } from '@/services/fillingOperations'

defineProps({ canRetry: { type: Boolean, default: false } })
const items = ref([])
const loading = ref(false)
const error = ref('')
const sourceDetails = ref({})
let timer = null
let stopped = false
const label = (item) => item.complete ? '保存及流转核查已完成' : item.status === 'failed' ? '处理遇到问题' : item.status === 'confirmation_required' ? '提交状态待确认' : '后台处理中'
async function inspect(item) {
	try {
		const result = await getFillingOperationV1(item.operation_id)
		if (result.code !== 0) throw new Error(result.msg || '源单状态读取失败')
		sourceDetails.value[item.operation_id] = result.data.source_records || []
	} catch (err) { error.value = err.message || '源单状态读取失败' }
}
async function refresh() {
	if (loading.value || stopped) return
	loading.value = true
	clearTimeout(timer)
	try {
		const result = await listFillingOperationsV1()
		if (result.code !== 0) throw new Error(result.msg || '处理状态读取失败')
		items.value = result.data || []
		error.value = ''
	} catch (err) { error.value = err.message || '处理状态读取失败' }
	finally {
		loading.value = false
		if (!stopped && (error.value || items.value.some((item) => ['pending', 'processing', 'confirmation_required'].includes(item.status)))) timer = setTimeout(refresh, 5000)
	}
}
async function retry(item) {
	try {
		const result = await retryFillingOperationV1(item.operation_id)
		if (result.code !== 0) throw new Error(result.msg || '重试失败')
		await refresh()
	} catch (err) { error.value = err.message || '重试失败' }
}
function activate() { stopped = false; return refresh() }
function deactivate() { stopped = true; clearTimeout(timer) }
onMounted(activate)
onBeforeUnmount(() => { stopped = true; clearTimeout(timer) })
defineExpose({ refresh, activate, deactivate })
</script>

<style scoped>
.operation-panel { padding: 16px; margin-bottom: 16px; border: 1px solid #d8e0ea; border-radius: 12px; background: #f8fafc; }
.operation-heading { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
.operation-row { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; overflow-wrap: anywhere; }
.operation-row:last-child { border-bottom: 0; }
.operation-error { color: #b45309; }
</style>
