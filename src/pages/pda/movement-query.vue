<template>
	<AppPage title="钢瓶查询" subtitle="流转记录" icon="bottle" hideBottleQuery>
		<PdaMovementQueryView :initial-bottle-no="initialBottleNo" />
	</AppPage>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/base/AppPage.vue'
import PdaMovementQueryView from '@/components/domain/pda/PdaMovementQueryView.vue'

const initialBottleNo = ref('')

onLoad((options) => {
	initialBottleNo.value = String(options?.bottle_no || '')
})
</script>
