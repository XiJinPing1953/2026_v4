<template>
	<PdaFillingCompleteView ref="viewRef" :task-id="taskId" />
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import PdaFillingCompleteView from '@/components/domain/pda/PdaFillingCompleteView.vue'

const taskId = ref('')
const viewRef = ref(null)

onLoad((options) => {
	taskId.value = String(options?.task_id || options?.taskId || '')
})

onShow(() => {
	nextTick(() => {
		viewRef.value?.loadTask?.()
	})
})
</script>
