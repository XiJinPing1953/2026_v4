<template>
	<SaleListView
		ref="listRef"
		:preset-has-remark="routePreset.hasRemark"
		:preset-remark-tag="routePreset.remarkTag"
		:preset-keyword="routePreset.keyword"
		:preset-customer-id="routePreset.customerId"
		:preset-date-start="routePreset.dateStart"
		:preset-date-end="routePreset.dateEnd"
		:preset-settlement-scope="routePreset.settlementScope"
	/>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import SaleListView from '@/components/domain/sale/SaleListView.vue'

const listRef = ref(null)
const routePreset = reactive({
	hasRemark: '',
	remarkTag: '',
	keyword: '',
	customerId: '',
	dateStart: '',
	dateEnd: '',
	settlementScope: ''
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
	routePreset.keyword = String(options.keyword || '')
	routePreset.customerId = String(options.customerId || options.customer_id || '')
	routePreset.dateStart = String(options.dateStart || options.date_start || '')
	routePreset.dateEnd = String(options.dateEnd || options.date_end || '')
	routePreset.settlementScope = String(options.settlementScope || options.settlement_scope || '')
	routePresetPending.value = Boolean(
		routePreset.hasRemark ||
		routePreset.remarkTag ||
		routePreset.keyword ||
		routePreset.customerId ||
		routePreset.dateStart ||
		routePreset.dateEnd ||
		routePreset.settlementScope
	)
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
