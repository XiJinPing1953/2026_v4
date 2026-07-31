<template>
	<HomeSafetyInspectionHistoryView v-if="customerId" ref="viewRef" :customer-id="customerId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import HomeSafetyInspectionHistoryView from '@/components/domain/homeSafetyInspection/HomeSafetyInspectionHistoryView.vue'

const customerId = ref('')
const viewRef = ref(null)
let firstShow = true

onLoad((options = {}) => {
	customerId.value = String(options.customerId || options.customer_id || '')
})

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	viewRef.value?.refresh?.()
})
</script>
