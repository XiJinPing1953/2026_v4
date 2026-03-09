<template>
	<BottleMovementTimelineView :bottle-no="bottleNo" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import BottleMovementTimelineView from '@/components/domain/bottle/BottleMovementTimelineView.vue'

const bottleNo = ref('')

onLoad((options) => {
	const value = options?.bottle_no || options?.bottleNo || ''
	bottleNo.value = value ? String(value) : ''
})
</script>
