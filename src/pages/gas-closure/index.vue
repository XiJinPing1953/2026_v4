<template>
	<GasClosureView :visible="visible" />
</template>

<script setup>
import { ref } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import GasClosureView from '@/components/domain/gas/GasClosureView.vue'

const visible = ref(false)
onShow(() => { visible.value = true })
onHide(() => { visible.value = false })
onUnload(() => { visible.value = false })
</script>
