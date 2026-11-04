<template>
	<SaleCreateView
		ref="viewRef"
		:initial-customer-id="initialCustomerId"
		:initial-customer-name="initialCustomerName"
		:initial-out-bottle-no="initialOutBottleNo"
	/>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
// #ifdef APP-PLUS
import SaleCreateView from '@/components/domain/pda/PdaNativeSaleView.vue'
// #endif
// #ifndef APP-PLUS
import SaleCreateView from '@/components/domain/pda/PdaSaleCreateView.vue'
// #endif
import { isPdaAppMode } from '@/services/pda/entry'
import { restoreScannerProfile } from '@/services/pda/capture'

const initialCustomerId = ref('')
const isNative = isPdaAppMode()
const initialCustomerName = ref('')
const initialOutBottleNo = ref('')
const viewRef = ref(null)
let activateTimer = null
let activationVersion = 0
let pageVisible = false

onLoad((options) => {
	if (isNative) uni.setNavigationBarTitle({ title: '称重销售' })
	initialCustomerId.value = String(options?.customer_id || '')
	initialCustomerName.value = String(options?.customer_name || '')
	initialOutBottleNo.value = String(options?.out_bottle_no || '')
})

function activateSession() {
	pageVisible = true
	const version = ++activationVersion
	if (activateTimer) clearTimeout(activateTimer)
	nextTick(() => {
		if (!pageVisible || version !== activationVersion) return
		activateTimer = setTimeout(async () => {
			activateTimer = null
			if (!pageVisible || version !== activationVersion) return
			await viewRef.value?.activateBarcodeSession?.()
		}, 180)
	})
}

async function deactivateSession(reason) {
	pageVisible = false
	activationVersion += 1
	if (activateTimer) {
		clearTimeout(activateTimer)
		activateTimer = null
	}
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
