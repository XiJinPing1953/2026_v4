<template>
	<PdaFillingStationView ref="viewRef" :station-code="stationCode" />
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import PdaFillingStationView from '@/components/domain/pda/PdaFillingStationView.vue'

const stationCode = ref('')
const viewRef = ref(null)

onLoad((options) => {
	stationCode.value = String(options?.station_code || options?.stationCode || '')
})

onShow(() => {
	nextTick(() => {
		viewRef.value?.loadStation?.()
	})
})
</script>
