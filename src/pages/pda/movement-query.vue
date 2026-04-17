<template>
	<PdaMovementQueryView :initial-bottle-no="initialBottleNo" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PdaMovementQueryView from '@/components/domain/pda/PdaMovementQueryView.vue'

const initialBottleNo = ref('')

onLoad((options) => {
	initialBottleNo.value = String(options?.bottle_no || '')
})
</script>
