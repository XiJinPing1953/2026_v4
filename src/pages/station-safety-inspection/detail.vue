<template><StationSafetyInspectionDetailView v-if="inspectionId" :inspection-id="inspectionId" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import StationSafetyInspectionDetailView from '@/components/domain/stationSafetyInspection/StationSafetyInspectionDetailView.vue'
const inspectionId = ref('')
onLoad((query) => { inspectionId.value = String(query?.id || '').trim() })
</script>
