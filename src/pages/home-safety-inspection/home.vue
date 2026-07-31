<template>
	<HomeSafetyInspectionHomeView ref="viewRef" />
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import HomeSafetyInspectionHomeView from '@/components/domain/homeSafetyInspection/HomeSafetyInspectionHomeView.vue'

const viewRef = ref(null)
let firstShow = true

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	viewRef.value?.refresh?.()
})
</script>
