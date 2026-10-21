<template>
	<PdaHomeView ref="viewRef" />
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { onBackPress, onHide, onShow, onUnload } from '@dcloudio/uni-app'
import PdaHomeView from '@/components/domain/pda/PdaHomeView.vue'

const viewRef = ref(null)
let visible = false
let version = 0
onShow(async () => {
	visible = true
	const current = ++version
	await nextTick()
	if (visible && current === version) await viewRef.value?.activate()
})
function deactivate() { visible = false; version++; void viewRef.value?.deactivate() }
onHide(deactivate)
onUnload(deactivate)
onBackPress(() => Boolean(viewRef.value?.closeRecords()))
</script>
