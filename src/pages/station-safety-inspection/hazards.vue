<template><StationSafetyHazardsView ref="viewRef" :hazard-id="hazardId" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import StationSafetyHazardsView from '@/components/domain/stationSafetyInspection/StationSafetyHazardsView.vue'
const hazardId = ref('')
const viewRef = ref(null)
let firstShow = true
onLoad((query) => { hazardId.value = String(query?.id || '').trim() })
onShow(() => { if (firstShow) { firstShow = false; return } viewRef.value?.refresh?.() })
</script>
