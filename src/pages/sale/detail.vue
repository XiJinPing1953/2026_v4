<template>
	<SaleDetailView ref="detailViewRef" :record-id="recordId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import SaleDetailView from '@/components/domain/sale/SaleDetailView.vue'

const recordId = ref('')
const detailViewRef = ref(null)

onLoad((options) => {
	const id = options?._id
	recordId.value = id ? String(id) : ''
})

onShow(() => {
	detailViewRef.value?.refresh?.()
})
</script>
