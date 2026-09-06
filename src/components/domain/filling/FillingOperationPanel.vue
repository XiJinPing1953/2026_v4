<template>
	<view v-if="items.length || error" class="operation-panel">
		<view class="operation-heading">
			<text>灌装处理状态</text>
			<AppButton size="sm" kind="neutral" :loading="loading" @click="refresh">刷新状态</AppButton>
		</view>
		<text v-if="error" class="operation-error">{{ error }}</text>
		<view v-for="item in items" :key="item.operation_id" class="operation-row">
			<text>{{ item.date || '灌装批次' }} · {{ label(item) }}</text>
			<text>已保存 {{ item.saved_total }}/{{ item.accepted_total }} 条，流转已核查 {{ item.processed_total }}/{{ item.target_total }} 个</text>
			<text v-if="item.failed">未纳入 {{ item.failed }} 条，请核对批量结果</text>
			<text v-if="item.last_error" class="operation-error">{{ item.last_error }}</text>
			<AppButton v-if="canRetry && item.status === 'failed'" size="sm" kind="neutral" :disabled="loading" @click="retry(item)">重试剩余处理</AppButton>
		</view>
	</view>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { listFillingOperationsV1, retryFillingOperationV1 } from '@/services/fillingOperations'

defineProps({ canRetry: { type: Boolean, default: false } })
const items = ref([])
const loading = ref(false)
const error = ref('')
let timer = null
let stopped = false
const label = (item) => item.complete ? '保存及流转核查已完成' : item.status === 'failed' ? '处理遇到问题' : '后台处理中'
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
		if (!stopped && items.value.some((item) => ['pending', 'processing'].includes(item.status))) timer = setTimeout(refresh, 5000)
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
.operation-row { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
.operation-row:last-child { border-bottom: 0; }
.operation-error { color: #b45309; }
</style>
