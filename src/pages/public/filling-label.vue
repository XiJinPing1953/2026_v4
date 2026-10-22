<template><FillingLabelView :token="token" /></template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import FillingLabelView from '@/components/domain/public/FillingLabelView.vue'
const token = ref('')
onLoad(options => { token.value = String(options.t || '') })
</script>
