<template>
	<AppPage title="PDA 工作台" subtitle="Android Shell V1" icon="home" hideBottleQuery>
		<AppSection title="当前账号">
			<view class="session-grid">
				<view class="session-cell">
					<text class="session-label">账号</text>
					<text class="session-value">{{ currentUser.username || '-' }}</text>
				</view>
				<view class="session-cell">
					<text class="session-label">昵称</text>
					<text class="session-value">{{ currentUser.nickname || '-' }}</text>
				</view>
				<view class="session-cell">
					<text class="session-label">角色</text>
					<text class="session-value">{{ currentUser.role_template || currentUser.role || '-' }}</text>
				</view>
			</view>
		</AppSection>

		<AppSection title="快捷入口">
			<view class="action-grid">
				<view v-for="item in actions" :key="item.url" class="action-card" @click="go(item.url)">
					<text class="action-card__title">{{ item.title }}</text>
					<text class="action-card__desc">{{ item.desc }}</text>
				</view>
			</view>
		</AppSection>

		<AppSection title="首版范围">
			<view class="scope-list">
				<text class="scope-item">查询钢瓶档案、流转记录、客户摘要</text>
				<text class="scope-item">手工录入灌装单并回传灌装记录</text>
				<text class="scope-item">手工录入瓶装 kg 销售单并回传销售记录</text>
				<text class="scope-item">不接扫码头、不接蓝牙秤、不做收款结算</text>
			</view>
		</AppSection>

		<view class="footer-actions">
			<AppButton kind="outline" @click="onLogout">退出登录</AppButton>
		</view>
	</AppPage>
</template>

<script setup>
import AppButton from '@/components/base/AppButton.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import { clearAuth, getUser } from '@/services/auth'
import { goLogin } from '@/services/navigation'

const currentUser = getUser() || {}

const actions = [
	{ title: '钢瓶查询', desc: '看瓶号、流向、空瓶重、检验日期', url: '/pages/pda/bottle-query' },
	{ title: '流转查询', desc: '按瓶号、类型、来源、日期看流转记录', url: '/pages/pda/movement-query' },
	{ title: '客户查询', desc: '看余额、存瓶和默认单价', url: '/pages/pda/customer-query' },
	{ title: '灌装录入', desc: '按瓶号和灌装重量回传灌装记录', url: '/pages/pda/filling-create' },
	{ title: '销售录入', desc: '按瓶装 kg 回传销售记录', url: '/pages/pda/sale-create' }
]

function go(url) {
	uni.navigateTo({ url })
}

async function onLogout() {
	const confirmed = await new Promise((resolve) => {
		uni.showModal({
			title: '退出登录',
			content: '确认退出当前账号吗？',
			success: (res) => resolve(Boolean(res.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirmed) return
	clearAuth()
	goLogin()
}
</script>

<style scoped>
.session-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.session-cell {
	padding: 20rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #f8fbff;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.session-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.session-value {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
	word-break: break-all;
}

.action-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.action-card {
	padding: 28rpx 24rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid #cfe0ff;
	background: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%);
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.action-card:active {
	opacity: 0.88;
}

.action-card__title {
	font-size: 30rpx;
	font-weight: 700;
	color: #0b5cab;
}

.action-card__desc {
	font-size: 24rpx;
	color: #4b5563;
	line-height: 1.5;
}

.scope-list {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.scope-item {
	font-size: 26rpx;
	color: var(--crm-text);
	line-height: 1.6;
}

.footer-actions {
	display: flex;
	justify-content: flex-end;
}

@media (max-width: 680px) {
	.session-grid,
	.action-grid {
		grid-template-columns: 1fr;
	}
}
</style>
