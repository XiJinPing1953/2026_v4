<template><StationSafetyInspectionFormView :inspection-id="inspectionId" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import StationSafetyInspectionFormView from '@/components/domain/stationSafetyInspection/StationSafetyInspectionFormView.vue'
const inspectionId = ref('')
onLoad((query) => { inspectionId.value = String(query?.id || '').trim() })
</script>
