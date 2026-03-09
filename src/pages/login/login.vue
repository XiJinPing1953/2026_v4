<template>
	<view class="login-page">
		<!-- ... existing login content ... -->
		<!-- Login page does NOT use AppPage wrapper usually, but if it did, we'd set hideNav -->
		<view class="login-bg"></view>
		<view class="login-content">
            <!-- ... -->

			<view class="brand">
				<view class="logo-box">
					<image class="logo" src="/static/logo.png" mode="aspectFit" />
				</view>
				<text class="title">2026 CRM</text>
				<text class="subtitle">让业务更简单</text>
			</view>
			
			<view class="card-container">
				<view class="form">
					<AppInput 
						v-model="username" 
						label="账号" 
						placeholder="请输入账号" 
						prefix-icon="user"
					/>
					<AppInput 
						v-model="password" 
						label="密码" 
						type="password" 
						placeholder="请输入密码" 
						prefix-icon="lock"
						confirm-type="go"
						@confirm="onLogin"
					/>
					<view class="actions">
						<AppButton :loading="loading" @click="onLogin" class="login-btn">
							<text class="btn-text">登 录</text>
						</AppButton>
					</view>
				</view>
			</view>

			<view class="footer">
				<text class="footer-text">Powered by 2026 Team</text>
			</view>
		</view>
	</view>
</template>

<script setup>
import { ref } from 'vue'
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

<style scoped>
.login-page {
	min-height: 100vh;
	position: relative;
	background: #fff;
	overflow: hidden;
}

.login-bg {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	height: 60vh;
	background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
	border-bottom-left-radius: 60rpx;
	border-bottom-right-radius: 60rpx;
	z-index: 0;
}

.login-content {
	position: relative;
	z-index: 1;
	padding: 160rpx 40rpx 40rpx;
	display: flex;
	flex-direction: column;
	min-height: 100vh;
	box-sizing: border-box;
}

.brand {
	display: flex;
	flex-direction: column;
	align-items: center;
	margin-bottom: 60rpx;
}

.logo-box {
	width: 120rpx;
	height: 120rpx;
	background: #fff;
	border-radius: 28rpx;
	box-shadow: 0 16rpx 32rpx rgba(37, 99, 235, 0.15);
	display: flex;
	align-items: center;
	justify-content: center;
	margin-bottom: 24rpx;
}

.logo {
	width: 64rpx;
	height: 64rpx;
}

.title {
	font-size: 40rpx;
	font-weight: 800;
	color: #1e293b;
	margin-bottom: 8rpx;
	letter-spacing: -1rpx;
}

.subtitle {
	font-size: 26rpx;
	color: #64748b;
	font-weight: 500;
}

.card-container {
	background: #fff;
	border-radius: 32rpx;
	padding: 40rpx 32rpx;
	box-shadow: 0 16rpx 48rpx rgba(15, 23, 42, 0.06);
}

.form {
	display: flex;
	flex-direction: column;
	gap: 32rpx;
}

.actions {
	margin-top: 16rpx;
}

.login-btn {
	height: 88rpx !important;
	border-radius: 44rpx !important;
	background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
	box-shadow: 0 8rpx 24rpx rgba(37, 99, 235, 0.25);
	font-size: 30rpx !important;
	font-weight: 600;
	letter-spacing: 2rpx;
}

.footer {
	margin-top: auto;
	padding-top: 60rpx;
	text-align: center;
}

.footer-text {
	font-size: 24rpx;
	color: #94a3b8;
}
</style>
