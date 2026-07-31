<template>
	<HomeSafetyInspectionDetailView v-if="inspectionId" ref="viewRef" :inspection-id="inspectionId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import HomeSafetyInspectionDetailView from '@/components/domain/homeSafetyInspection/HomeSafetyInspectionDetailView.vue'

const inspectionId = ref('')
const viewRef = ref(null)
let firstShow = true

onLoad((options = {}) => {
	inspectionId.value = String(options.id || options._id || '')
})

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	viewRef.value?.refresh?.()
})
</script>
