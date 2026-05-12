<template>
	<DashboardHome v-if="!redirecting" />
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import DashboardHome from '@/components/domain/dashboard/DashboardHome.vue'
import { getUser } from '@/services/auth'
import { DEFAULT_HOME_PATH, isPdaAppMode, resolveHomePath } from '@/services/pda/entry'

function resolveIndexRedirectState() {
	return isPdaAppMode() || resolveHomePath(getUser()) !== DEFAULT_HOME_PATH
}

const redirecting = ref(resolveIndexRedirectState())

onShow(() => {
	const targetPath = resolveHomePath(getUser())
	const shouldRedirect = targetPath !== DEFAULT_HOME_PATH
	redirecting.value = isPdaAppMode() || shouldRedirect
	if (shouldRedirect) {
		uni.reLaunch({ url: targetPath })
	}
})
</script>
