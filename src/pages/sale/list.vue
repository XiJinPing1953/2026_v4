<template>
	<SaleListView
		ref="listRef"
		:preset-has-remark="routePreset.hasRemark"
		:preset-remark-tag="routePreset.remarkTag"
	/>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import SaleListView from '@/components/domain/sale/SaleListView.vue'

const listRef = ref(null)
const routePreset = reactive({
	hasRemark: '',
	remarkTag: ''
})
const routePresetPending = ref(false)
let firstShow = true
const SALE_LIST_REFRESH_KEY = 'sale:list:refresh'

function consumeListRefreshSignal() {
	let shouldRefresh = false
	try {
		shouldRefresh = Boolean(uni.getStorageSync(SALE_LIST_REFRESH_KEY))
		if (shouldRefresh) uni.removeStorageSync(SALE_LIST_REFRESH_KEY)
	} catch (_) {
		shouldRefresh = false
	}
	return shouldRefresh
}

onLoad((options = {}) => {
	routePreset.hasRemark = String(options.hasRemark || '')
	routePreset.remarkTag = String(options.remarkTag || '')
	routePresetPending.value = Boolean(routePreset.hasRemark || routePreset.remarkTag)
})

onShow(() => {
	const shouldRefresh = consumeListRefreshSignal()
	if (firstShow) {
		firstShow = false
		if (shouldRefresh) listRef.value?.refresh?.()
		return
	}
	if (routePresetPending.value) {
		listRef.value?.applyRoutePreset?.(routePreset)
		routePresetPending.value = false
		if (shouldRefresh) listRef.value?.refresh?.()
		return
	}
	if (shouldRefresh) {
		listRef.value?.refresh?.()
		return
	}
	listRef.value?.refresh?.()
})
</script>
