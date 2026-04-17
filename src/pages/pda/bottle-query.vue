<template>
	<PdaBottleQueryView :initial-keyword="initialKeyword" />
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PdaBottleQueryView from '@/components/domain/pda/PdaBottleQueryView.vue'

const initialKeyword = ref('')

onLoad((options) => {
	initialKeyword.value = String(options?.keyword || options?.bottle_no || '')
})
</script>
