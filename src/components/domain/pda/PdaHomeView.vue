<template>
		<AppPage :title="isNative ? 'PDA 工作台' : '移动工作台'" :subtitle="isNative ? '现场设备' : '销售与现场查询'" icon="home" hideBottleQuery>
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
				<text class="scope-item">按灌装工位扫码创建任务并回传灌装记录</text>
				<text v-if="isNative" class="scope-item">复秤：连接 NVK 吊秤，逐瓶核算本次灌装量并保存；暂不打印标签</text>
				<text v-if="isNative" class="scope-item">回瓶复秤：保存回瓶称重依据，统计本轮已复秤瓶数</text>
						<text class="scope-item">手机称重销售：网页调用摄像头扫码，连接 BLE 吊秤录入瓶装 kg 销售</text>
						<text class="scope-item">销售保留客户、配送员、车辆与瓶号搜索；灌装继续使用现场设备</text>
				<text class="scope-item">灌装任务支持 C606+ 称重仪表取值和目标写入；首版不做收款结算</text>
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
import { canPageAction, canViewPage } from '@/services/pageAcl'
import { isPdaAppMode } from '@/services/pda/entry'

const currentUser = getUser() || {}
const isNative = isPdaAppMode()
const actions = [
	{ title: '钢瓶查询', desc: '看瓶号、流向、空瓶重、检验日期', url: '/pages/pda/bottle-query' },
	{ title: '流转查询', desc: '按瓶号、类型、来源、日期看流转记录', url: '/pages/pda/movement-query' },
	{ title: '客户查询', desc: '看余额、存瓶和默认单价', url: '/pages/pda/customer-query' },
	{ title: '灌装看板', desc: '按工位扫码创建任务、写入目标并确认完成', url: '/pages/pda/filling-board' },
	{ title: '复秤', desc: '吊秤称重，结合上次回瓶核算本次灌装量', url: '/pages/pda/reweigh', nativeOnly: true, createRequired: true },
	{ title: '回瓶复秤', desc: '保存回瓶称重依据，统计本轮已复秤瓶数', url: '/pages/pda/return-reweigh', nativeOnly: true, createRequired: true },
	{ title: '手机称重销售', desc: '摄像头扫码、吊秤称重、提交瓶装 kg 销售', url: '/pages/pda/sale-create' }
].filter((item) => (!item.nativeOnly || isNative) && canViewPage(item.url) && (!(item.createRequired || item.url === '/pages/pda/sale-create') || canPageAction(item.url, 'create')))

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
