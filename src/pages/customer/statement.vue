<template>
	<CustomerStatementView :record-id="recordId" :scene="scene" :sale-id="saleId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import CustomerStatementView from '@/components/domain/customer/CustomerStatementView.vue'

const recordId = ref('')
const scene = ref('')
const saleId = ref('')

onLoad((options) => {
	const id = options?._id || options?.id || options?.customer_id
	recordId.value = id ? String(id) : ''
	scene.value = options?.scene ? String(options.scene) : ''
	const sourceSaleId = options?.sale_id || options?.saleId
	saleId.value = sourceSaleId ? String(sourceSaleId) : ''
})
</script>
