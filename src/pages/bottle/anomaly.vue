<template>
	<BottleAnomalyView ref="viewRef" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import BottleAnomalyView from '@/components/domain/bottle/BottleAnomalyView.vue'

const viewRef = ref(null)
let firstShow = true
const ANOMALY_BACKFILL_SAVED_EVENT = 'crm:bottle-anomaly:backfill-saved'
const ANOMALY_BACKFILL_SAVED_STORAGE_KEY = 'crm:bottle-anomaly:backfill-saved'
const pendingBackfillReturn = ref(null)

function onBackfillSaved(payload = {}) {
	pendingBackfillReturn.value = payload
}

function takePendingBackfillReturn() {
	if (pendingBackfillReturn.value) {
		const payload = pendingBackfillReturn.value
		pendingBackfillReturn.value = null
		return payload
	}
	try {
		const payload = uni.getStorageSync(ANOMALY_BACKFILL_SAVED_STORAGE_KEY)
		if (payload && typeof payload === 'object') {
			uni.removeStorageSync(ANOMALY_BACKFILL_SAVED_STORAGE_KEY)
			return payload
		}
	} catch (err) {
		console.error('takePendingBackfillReturn failed', err)
	}
	return null
}

onLoad(() => {
	uni.$on(ANOMALY_BACKFILL_SAVED_EVENT, onBackfillSaved)
})

onUnload(() => {
	uni.$off(ANOMALY_BACKFILL_SAVED_EVENT, onBackfillSaved)
})

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	const payload = takePendingBackfillReturn()
	if (payload) {
		viewRef.value?.refreshAfterBackfillReturn?.(payload)
		return
	}
	viewRef.value?.refresh?.()
})
</script>
