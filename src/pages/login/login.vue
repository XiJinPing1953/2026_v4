<template>
	<AppPage title="登录" subtitle="请输入账号密码">
		<AppCard>
			<AppInput v-model="username" label="账号" placeholder="请输入账号" />
			<view style="height: 12rpx" />
			<AppInput v-model="password" label="密码" type="password" placeholder="请输入密码" />
			<view style="height: 18rpx" />
			<AppButton :loading="loading" @click="onLogin">登录</AppButton>
		</AppCard>
	</AppPage>
</template>

<script setup>
import { ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import { callCloud } from '@/services/api'
import { setToken, setUser } from '@/services/auth'

const username = ref('')
const password = ref('')
const loading = ref(false)

async function onLogin() {
	if (!username.value || !password.value) {
		uni.showToast({ title: '请填写账号和密码', icon: 'none' })
		return
	}

	loading.value = true
	try {
		const result = await callCloud('crm-auth', {
			action: 'login',
			data: { username: username.value, password: password.value },
			token: ''
		})
		if (result.code !== 0) return
		setToken(result.token || '')
		setUser(result.user || null)
		uni.reLaunch({ url: '/pages/index/index' })
	} catch (e) {
		console.error('login error', e)
		uni.showToast({ title: '登录失败', icon: 'none' })
	} finally {
		loading.value = false
	}
}
</script>
