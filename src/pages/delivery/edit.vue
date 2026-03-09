<template>
	<DeliveryEditView :record-id="recordId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import DeliveryEditView from '@/components/domain/delivery/DeliveryEditView.vue'

const recordId = ref('')

onLoad((options) => {
	const id = options && options._id
	recordId.value = id ? String(id) : ''
})
</script>
