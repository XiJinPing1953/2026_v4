<template>
	<PdaFillingCreateView ref="viewRef" :initial-bottle-no="initialBottleNo" />
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import PdaFillingCreateView from '@/components/domain/pda/PdaFillingCreateView.vue'
import { restoreScannerProfile } from '@/services/pda/capture'

const initialBottleNo = ref('')
const viewRef = ref(null)

onLoad((options) => {
	initialBottleNo.value = String(options?.bottle_no || '')
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
	deactivateSession('pda-filling-hide')
})

onUnload(() => {
	deactivateSession('pda-filling-unload')
})
</script>
