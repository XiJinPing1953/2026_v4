<template>
	<HomeSafetyInspectionFormView
		v-if="ready"
		:customer-id="route.customerId"
		:inspection-id="route.inspectionId"
		:edit-mode="route.editMode"
	/>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import HomeSafetyInspectionFormView from '@/components/domain/homeSafetyInspection/HomeSafetyInspectionFormView.vue'

const ready = ref(false)
const route = reactive({
	customerId: '',
	inspectionId: '',
	editMode: false
})

onLoad((options = {}) => {
	route.customerId = String(options.customerId || options.customer_id || '')
	route.inspectionId = String(options.id || options._id || '')
	route.editMode = String(options.mode || '').toLowerCase() === 'edit' || Boolean(route.inspectionId)
	ready.value = true
})
</script>
