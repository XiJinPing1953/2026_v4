<template><SafetyManagementPeriodView kind="monthly" :month="month" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import SafetyManagementPeriodView from '@/components/domain/safetyManagement/SafetyManagementPeriodView.vue'
const month = ref('')
onLoad(query => { month.value = String(query?.month || '') })
</script>
