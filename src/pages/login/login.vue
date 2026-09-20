<template>
	<view class="login-page">
		<view class="login-bg"></view>
		<view class="login-content">
			<view class="login-main">
			<view class="login-panel">

			<view class="brand">
				<view class="logo-box">
					<image class="logo" src="/static/logo.png" mode="aspectFit" />
				</view>
				<text class="title">新拓能源</text>
				<text class="subtitle">登录新拓能源工作台</text>
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

			</view>
			</view>
			<view class="footer">
				<text class="footer-text">新拓能源 · 企业工作台</text>
				<!-- #ifdef H5 -->
				<a class="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">冀ICP备2026038379号-1</a>
				<!-- #endif -->
			</view>
		</view>
	</view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import { callCloud } from '@/services/api'
import { setToken, setUser } from '@/services/auth'
import { canViewPage } from '@/services/pageAcl'
import { consumePendingLoginRedirect, setPendingLoginRedirect } from '@/services/navigation'
import { normalizeAppPagePath, resolveHomePath, resolveLoginRedirectForRuntime } from '@/services/pda/entry'

const username = ref('')
const password = ref('')
const loading = ref(false)

function normalizeText(value) {
	return value == null ? '' : String(value).trim()
}

function resolveRedirectPathAfterLogin(user) {
	const redirectUrl = consumePendingLoginRedirect()
	const runtimeRedirectUrl = resolveLoginRedirectForRuntime(redirectUrl, user)
	const redirectPath = normalizeAppPagePath(runtimeRedirectUrl)
	if (runtimeRedirectUrl && redirectPath && canViewPage(redirectPath, user)) {
		return runtimeRedirectUrl
	}
	return resolveHomePath(user || null)
}

onLoad((options = {}) => {
	const redirect = normalizeText(options.redirect)
	if (redirect) setPendingLoginRedirect(decodeURIComponent(redirect))
})

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
		uni.reLaunch({ url: resolveRedirectPathAfterLogin(result.user || null) })
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
 position: relative;
 background: #f3f6fb;
 color: #1e293b;
}
.login-bg {
 position: absolute;
 inset: 0;
 background: radial-gradient(ellipse at 18% 12%, #dce9ff 0, transparent 55%), radial-gradient(ellipse at 90% 90%, #dff0ed 0, transparent 48%);
 pointer-events: none;
}
.login-content {
 position: relative;
 min-height: 100vh;
 box-sizing: border-box;
 display: flex;
 flex-direction: column;
 padding: 24px 20px 16px;
 font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
/* H5 login uses a custom navigation layout and fills the available viewport. */
/* #ifdef H5 */
.login-content {
 min-height: calc(100vh - var(--window-top, 0px));
 min-height: calc(100dvh - var(--window-top, 0px));
}
/* #endif */
.login-main {
 flex: 1;
 display: flex;
 align-items: center;
 justify-content: center;
 padding: 12px 0 24px;
}
.login-panel {
 width: 100%;
 max-width: 420px;
 box-sizing: border-box;
 padding: 32px 36px;
 border: 1px solid rgba(255,255,255,.9);
 border-radius: 24px;
 background: rgba(255,255,255,.96);
 box-shadow: 0 24px 70px -24px rgba(37,65,107,.22), 0 2px 8px rgba(37,65,107,.03);
}
.brand {
 display: flex;
 flex-direction: column;
 align-items: center;
 margin-bottom: 28px;
}
.logo-box {
 width: 64px;
 height: 64px;
 display: flex;
 align-items: center;
 justify-content: center;
 margin-bottom: 16px;
 border: 1px solid #e9eef5;
 border-radius: 18px;
 background: #fff;
}
.logo { width: 48px; height: 48px; }
.title { font-size: 26px; line-height: 1.4; font-weight: 700; letter-spacing: 1px; }
.subtitle { margin-top: 8px; font-size: 14px; color: #7a879b; }
.card-container { width: 100%; box-sizing: border-box; }
.form { display: flex; flex-direction: column; gap: 20px; }
.form :deep(.field__label) { font-size: 13px; color: #526078; }
.form :deep(.field__control) { height: 46px; border-radius: 10px; background: #fbfcfe; box-sizing: border-box; }
.form :deep(.field__input) { font-size: 15px; }
.actions { margin-top: 4px; }
.login-btn {
 width: 100%;
 height: 46px !important;
 border-radius: 10px !important;
 background: linear-gradient(110deg, #346ee8, #2455cd) !important;
 box-shadow: 0 8px 18px -8px rgba(37,99,235,.5);
 font-size: 16px !important;
 font-weight: 600;
 letter-spacing: 4px;
}
.footer { flex-shrink: 0; text-align: center; line-height: 1.6; padding-bottom: env(safe-area-inset-bottom, 0px); }
.footer-text { font-size: 12px; color: #8793a6; }
.icp-link { display: block; margin-top: 4px; font-size: 12px; color: #65748b; text-decoration: none; }
.icp-link:hover { color: #2455cd; text-decoration: underline; }
.icp-link:focus-visible { outline: 2px solid #346ee8; outline-offset: 3px; border-radius: 3px; }
@media (max-width: 480px) {
 .login-content { padding: 16px 20px 12px; }
 .login-panel { padding: 28px 24px; border-radius: 20px; }
}
@media (max-height: 650px) {
 .login-content { padding-top: 12px; }
 .login-main { padding: 0 0 16px; }
 .login-panel { padding-top: 20px; padding-bottom: 24px; }
 .brand { margin-bottom: 20px; }
 .logo-box { width: 48px; height: 48px; margin-bottom: 10px; border-radius: 14px; }
 .logo { width: 36px; height: 36px; }
 .form { gap: 16px; }
}
</style>
