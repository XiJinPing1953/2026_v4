<template>
	<GasInEditView :record-id="recordId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import GasInEditView from '@/components/domain/gasIn/GasInEditView.vue'

const recordId = ref('')

onLoad((options) => {
	const id = options?._id
	recordId.value = id ? String(id) : ''
})
</script>
