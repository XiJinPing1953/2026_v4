<template><SafetyManagementDailyView :date="date" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import SafetyManagementDailyView from '@/components/domain/safetyManagement/SafetyManagementDailyView.vue'
const date = ref('')
onLoad(query => { date.value = String(query?.date || '') })
</script>
