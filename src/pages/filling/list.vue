<template>
	<FillingListView
		ref="listRef"
		:preset-source-anomaly-id="routePreset.sourceAnomalyId"
		:preset-return-to-anomaly="routePreset.returnToAnomaly"
		:preset-return-scroll-top="routePreset.returnScrollTop"
		:preset-bottle-no="routePreset.bottleNo"
		:preset-date="routePreset.date"
		:preset-input-mode="routePreset.inputMode"
		:preset-record-type="routePreset.recordType"
		:preset-fill-weight="routePreset.fillWeight"
		:preset-remark="routePreset.remark"
	/>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import FillingListView from '@/components/domain/filling/FillingListView.vue'

const listRef = ref(null)
const routePreset = reactive({
	sourceAnomalyId: '',
	returnToAnomaly: '',
	returnScrollTop: '',
	bottleNo: '',
	date: '',
	inputMode: '',
	recordType: '',
	fillWeight: '',
	remark: ''
})
let firstShow = true

function decodeRouteParam(value) {
	const text = String(value || '').trim()
	if (!text) return ''
	try {
		return decodeURIComponent(text)
	} catch (err) {
		return text
	}
}

onLoad((options = {}) => {
	routePreset.sourceAnomalyId = decodeRouteParam(options.sourceAnomalyId)
	routePreset.returnToAnomaly = decodeRouteParam(options.returnToAnomaly)
	routePreset.returnScrollTop = decodeRouteParam(options.returnScrollTop)
	routePreset.bottleNo = decodeRouteParam(options.bottleNo)
	routePreset.date = decodeRouteParam(options.date)
	routePreset.inputMode = decodeRouteParam(options.inputMode)
	routePreset.recordType = decodeRouteParam(options.recordType)
	routePreset.fillWeight = decodeRouteParam(options.fillWeight)
	routePreset.remark = decodeRouteParam(options.remark)
})

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	listRef.value?.refresh?.()
})
</script>
