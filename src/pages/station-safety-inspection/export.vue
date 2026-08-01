<template><StationSafetyInspectionExportView ref="viewRef" /></template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import StationSafetyInspectionExportView from '@/components/domain/stationSafetyInspection/StationSafetyInspectionExportView.vue'

const viewRef = ref(null)
let firstShow = true
onShow(() => {
	if (firstShow) { firstShow = false; return }
	viewRef.value?.refresh?.()
})
</script>
