<template>
	<CollectionTaskDetailView :task-id="taskId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import CollectionTaskDetailView from '@/components/domain/collection/CollectionTaskDetailView.vue'

const taskId = ref('')

onLoad((options) => {
	const id = options?._id
	taskId.value = id ? String(id) : ''
})
</script>
