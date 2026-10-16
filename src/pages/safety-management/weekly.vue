<template><SafetyManagementPeriodView kind="weekly" :date="date" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import SafetyManagementPeriodView from '@/components/domain/safetyManagement/SafetyManagementPeriodView.vue'
const date = ref('')
onLoad(query => { date.value = String(query?.date || '') })
</script>
