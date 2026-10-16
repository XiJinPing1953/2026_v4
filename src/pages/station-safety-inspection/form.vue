<template><StationSafetyInspectionFormView :inspection-id="inspectionId" :workflow-id="workflowId" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import StationSafetyInspectionFormView from '@/components/domain/stationSafetyInspection/StationSafetyInspectionFormView.vue'
const inspectionId = ref(''), workflowId = ref('')
onLoad((query) => { inspectionId.value = String(query?.id || '').trim(); workflowId.value = String(query?.workflow_id || '').trim() })
</script>
