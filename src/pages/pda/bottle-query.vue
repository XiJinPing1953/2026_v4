<template>
	<PdaBottleQueryView ref="viewRef" :initial-keyword="initialKeyword" />
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import PdaBottleQueryView from '@/components/domain/pda/PdaBottleQueryView.vue'

const initialKeyword = ref('')
const viewRef = ref(null)
let visible = false
let version = 0
onShow(async () => {
	visible = true
	const current = ++version
	await nextTick()
	if (visible && current === version) await viewRef.value?.activate()
})
function deactivate() { visible = false; version += 1; void viewRef.value?.deactivate() }
onHide(deactivate)
onUnload(deactivate)

onLoad((options) => {
	initialKeyword.value = String(options?.keyword || options?.bottle_no || '')
})
</script>
