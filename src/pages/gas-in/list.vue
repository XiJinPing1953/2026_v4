<template>
	<GasInListView ref="listRef" />
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import GasInListView from '@/components/domain/gasIn/GasInListView.vue'

const listRef = ref(null)
let firstShow = true
const GAS_IN_LIST_REFRESH_KEY = 'gasIn:list:refresh'

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	let shouldRefresh = false
	try {
		shouldRefresh = Boolean(uni.getStorageSync(GAS_IN_LIST_REFRESH_KEY))
		if (shouldRefresh) uni.removeStorageSync(GAS_IN_LIST_REFRESH_KEY)
	} catch (_) {
		shouldRefresh = false
	}
	if (shouldRefresh) {
		listRef.value?.refresh?.()
	}
})
</script>
