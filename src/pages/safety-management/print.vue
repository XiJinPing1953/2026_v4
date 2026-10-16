<template><SafetyManagementPrintView :kind="kind" :date="date" :month="month" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import SafetyManagementPrintView from '@/components/domain/safetyManagement/SafetyManagementPrintView.vue'
const kind = ref('daily'), date = ref(''), month = ref('')
onLoad(query => { kind.value = ['daily','weekly','monthly'].includes(query?.kind) ? query.kind : 'daily'; date.value = String(query?.date || ''); month.value = String(query?.month || '') })
</script>
