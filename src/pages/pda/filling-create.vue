<template>
	<PdaFillingTaskCreateView ref="viewRef" :station-code="stationCode" />
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import PdaFillingTaskCreateView from '@/components/domain/pda/PdaFillingTaskCreateView.vue'
import { restoreScannerProfile } from '@/services/pda/capture'

const stationCode = ref('')
const viewRef = ref(null)

onLoad((options) => {
	stationCode.value = String(options?.station_code || options?.stationCode || '')
})

function activateSession() {
	nextTick(() => {
		viewRef.value?.activateBarcodeSession?.()
	})
}

async function deactivateSession(reason) {
	if (viewRef.value?.deactivateBarcodeSession) {
		await viewRef.value.deactivateBarcodeSession(reason)
		return
	}
	await restoreScannerProfile({ reason })
}

onShow(() => {
	activateSession()
})

onHide(() => {
	deactivateSession('pda-filling-task-create-hide')
})

onUnload(() => {
	deactivateSession('pda-filling-task-create-unload')
})
</script>
