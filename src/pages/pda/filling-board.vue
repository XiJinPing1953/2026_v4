<template>
	<PdaFillingBoardView ref="viewRef" />
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PdaFillingBoardView from '@/components/domain/pda/PdaFillingBoardView.vue'

const viewRef = ref(null)

onShow(() => {
	nextTick(() => {
		viewRef.value?.loadBoard?.()
	})
})
</script>
