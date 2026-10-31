<template>
	<!-- #ifndef APP-PLUS -->
	<DashboardHome v-if="!redirecting" />
	<!-- #endif -->
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
// #ifndef APP-PLUS
import DashboardHome from '@/components/domain/dashboard/DashboardHome.vue'
// #endif
import { reLaunchOnce } from '@/services/navigation'
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
		reLaunchOnce(targetPath).catch(error => { console.error('首页跳转失败', error) })
	}
})
</script>
