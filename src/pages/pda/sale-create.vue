<template>
	<PdaSaleCreateView
		ref="viewRef"
		:initial-customer-id="initialCustomerId"
		:initial-customer-name="initialCustomerName"
		:initial-out-bottle-no="initialOutBottleNo"
	/>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import PdaSaleCreateView from '@/components/domain/pda/PdaSaleCreateView.vue'
import { restoreScannerProfile } from '@/services/pda/capture'

const initialCustomerId = ref('')
const initialCustomerName = ref('')
const initialOutBottleNo = ref('')
const viewRef = ref(null)

onLoad((options) => {
	initialCustomerId.value = String(options?.customer_id || '')
	initialCustomerName.value = String(options?.customer_name || '')
	initialOutBottleNo.value = String(options?.out_bottle_no || '')
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
	deactivateSession('pda-sale-hide')
})

onUnload(() => {
	deactivateSession('pda-sale-unload')
})
</script>
