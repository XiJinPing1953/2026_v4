<template><PdaFloorCalibration ref="bench"/></template>
<script setup>
import { nextTick, ref } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import PdaFloorCalibration from '@/components/domain/pda/PdaFloorCalibration.vue'
const bench = ref(null)
let epoch = 0
onShow(async () => { const ticket = ++epoch; await nextTick(); if (ticket === epoch) await bench.value?.activate() })
function close() { epoch++; void bench.value?.deactivate() }
onHide(close)
onUnload(close)
</script>
