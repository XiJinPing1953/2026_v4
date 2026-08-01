<template>
	<AppPage hide-nav hide-bottle-query :body-padding="false">
		<view class="hub">
			<view class="hub__header">
				<view>
					<text class="hub__eyebrow">无极县新拓能源开发有限公司</text>
					<text class="hub__title">安全巡检工作台</text>
					<text class="hub__welcome">{{ displayName }} · {{ roleLabel }}</text>
				</view>
				<button class="hub__logout" type="button" @click="logout">退出</button>
			</view>
			<view class="hub__body">
				<view class="module-card module-card--home" @click="open('/pages/home-safety-inspection/home')">
					<text class="module-card__tag">客户现场</text>
					<text class="module-card__title">入户随瓶安全巡检</text>
					<text class="module-card__description">选择客户，完成入户设备、泄漏、报警器等安全检查。</text>
					<text class="module-card__action">进入客户巡检 →</text>
				</view>
				<view class="module-card module-card--station" @click="open('/pages/station-safety-inspection/home')">
					<text class="module-card__tag">厂站内部</text>
					<text class="module-card__title">厂站安全巡检</text>
					<text class="module-card__description">储罐区、泵区、充装区和全厂公共项，共36项并跟踪隐患整改。</text>
					<text class="module-card__action">进入厂站巡检 →</text>
				</view>
			</view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import { clearAuth, getUser } from '@/services/auth'
import { normalizeRoleTemplate } from '@/services/pageAclRegistry'
import { goLogin } from '@/services/navigation'

const user = ref(getUser() || {})
const displayName = computed(() => user.value.nickname || user.value.username || '巡检员')
const roleLabel = computed(() => normalizeRoleTemplate(user.value.role_template || user.value.role) === 'superadmin' ? '超级管理员' : '安全巡检员')
function open(url) { uni.navigateTo({ url }) }
function logout() { clearAuth(); goLogin() }
</script>

<style scoped>
.hub { min-height: 100vh; background: #f3f6fa; }
.hub__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; padding: calc(48rpx + env(safe-area-inset-top)) 32rpx 44rpx; color: #fff; background: linear-gradient(145deg,#0f766e,#0b5f58 52%,#9a3412); }
.hub__eyebrow,.hub__title,.hub__welcome { display: block; }
.hub__eyebrow { font-size: 21rpx; opacity: .78; }
.hub__title { margin-top: 8rpx; font-size: 40rpx; font-weight: 900; }
.hub__welcome { margin-top: 12rpx; font-size: 24rpx; opacity: .9; }
.hub__logout { flex: none; margin: 0; padding: 0 22rpx; min-height: 66rpx; color: #fff; border: 1rpx solid rgba(255,255,255,.4); border-radius: 16rpx; background: rgba(255,255,255,.12); font-size: 23rpx; }
.hub__logout::after { border: 0; }
.hub__body { display: flex; flex-direction: column; gap: 24rpx; padding: 28rpx; }
.module-card { display: flex; flex-direction: column; min-height: 260rpx; padding: 30rpx; color: #fff; border-radius: 28rpx; box-shadow: 0 18rpx 38rpx rgba(15,23,42,.14); }
.module-card--home { background: linear-gradient(135deg,#0f766e,#115e59); }
.module-card--station { background: linear-gradient(135deg,#c2410c,#9a3412); }
.module-card__tag { align-self: flex-start; padding: 7rpx 14rpx; border-radius: 999rpx; background: rgba(255,255,255,.18); font-size: 20rpx; }
.module-card__title { margin-top: 18rpx; font-size: 33rpx; font-weight: 900; }
.module-card__description { margin-top: 12rpx; font-size: 23rpx; line-height: 1.6; opacity: .9; }
.module-card__action { margin-top: auto; padding-top: 18rpx; font-size: 25rpx; font-weight: 800; }
</style>
