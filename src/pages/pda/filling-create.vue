<template>
	<PdaFillingCreateView :initial-bottle-no="initialBottleNo" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PdaFillingCreateView from '@/components/domain/pda/PdaFillingCreateView.vue'

const initialBottleNo = ref('')

onLoad((options) => {
	initialBottleNo.value = String(options?.bottle_no || '')
})
</script>
