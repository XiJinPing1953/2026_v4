<template>
	<PdaReweighView ref="viewRef" mode="return" scale-mode="floor" />
</template>
<script setup>
import { nextTick, ref } from 'vue'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import PdaReweighView from '@/components/domain/pda/PdaReweighView.vue'
const viewRef = ref(null)
let visible = false, version = 0
onShow(async () => {
	visible = true
	const current = ++version
	await nextTick()
	if (visible && current === version) await viewRef.value?.activate()
})
function deactivate() { visible = false; version++; void viewRef.value?.deactivate() }
onHide(deactivate)
onUnload(deactivate)
</script>
