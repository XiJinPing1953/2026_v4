<template>
	<OperationLogListView ref="listRef" />
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationLogListView from '@/components/domain/log/OperationLogListView.vue'

const listRef = ref(null)
let firstShow = true

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	listRef.value?.refresh?.()
})
</script>
