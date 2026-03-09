<template>
	<BottleEditView :record-id="recordId" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import BottleEditView from '@/components/domain/bottle/BottleEditView.vue'

const recordId = ref('')

onLoad((options) => {
	const id = options?._id
	recordId.value = id ? String(id) : ''
})
</script>
