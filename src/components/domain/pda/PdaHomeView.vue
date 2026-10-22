<template>
	<PdaReweighRecordsView v-if="recordsOpened" v-show="showRecords" ref="recordsRef" @back="closeRecords" />
	<AppPage v-show="!showRecords" class="pda-compact-page" :title="isNative ? '新拓能源' : '移动工作台'" :subtitle="isNative ? '' : '销售与现场查询'" icon="home" hideBottleQuery>
		<AppSection title="当前账号">
			<view class="session-grid">
				<view class="session-cell">
					<text class="session-label">昵称</text>
					<text class="session-value">{{ currentUser.nickname || '-' }}</text>
				</view>
				<view class="session-cell">
					<text class="session-label">角色</text>
					<text class="session-value">{{ isNative ? roleLabel : currentUser.role_template || currentUser.role || '-' }}</text>
				</view>
			</view>
		</AppSection>

		<AppSection title="快捷入口">
			<view class="action-grid">
				<view v-if="canRecords" class="action-card" @click="openRecords">
					<text class="action-card__title">复秤记录</text>
					<text class="action-card__desc">查已保存的称重记录</text>
				</view>
				<view v-for="item in actions" :key="item.url" class="action-card" @click="go(item.url)">
					<text class="action-card__title">{{ item.title }}</text>
					<text class="action-card__desc">{{ item.desc }}</text>
				</view>
			</view>
		</AppSection>

		<view class="footer-actions">
			<AppButton kind="outline" @click="onLogout">退出登录</AppButton>
		</view>
		<PdaAppUpdate v-if="isNative" />
	</AppPage>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'
import PdaReweighRecordsView from './PdaReweighRecordsView.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import PdaAppUpdate from '@/components/domain/pda/PdaAppUpdate.vue'
import { clearAuth, getUser } from '@/services/auth'
import { goLogin } from '@/services/navigation'
import { canPageAction, canViewPage } from '@/services/pageAcl'
import { isPdaAppMode } from '@/services/pda/entry'

const currentUser = getUser() || {}
const isNative = isPdaAppMode()
const roleLabel = ({ superadmin: '超级管理员', admin: '管理员', finance: '财务', pda_operator: '现场操作员', safety_inspector: '安全巡检员', user: '普通用户' })[currentUser.role_template || currentUser.role] || '其他角色'
const canRecords = isNative && (canViewPage('/pages/pda/return-reweigh') || canViewPage('/pages/pda/reweigh'))
const showRecords = ref(false)
const recordsOpened = ref(false)
const recordsRef = ref(null)
let visible = false
let lifecycle = 0
async function activate() {
	visible = true
	const version = ++lifecycle
	await nextTick()
	if (visible && version === lifecycle && showRecords.value) await recordsRef.value?.activate()
}
function deactivate() { visible = false; lifecycle++; return recordsRef.value?.deactivate() }
async function openRecords() {
	if (!canRecords || showRecords.value) return
	recordsOpened.value = true
	showRecords.value = true
	const version = ++lifecycle
	await nextTick()
	if (visible && version === lifecycle && showRecords.value) await recordsRef.value?.activate()
}
function closeRecords() {
	if (!showRecords.value) return false
	lifecycle++
	void recordsRef.value?.deactivate()
	showRecords.value = false
	return true
}
onBeforeUnmount(deactivate)
defineExpose({ activate, deactivate, closeRecords })
const actions = [
	{ title: '钢瓶查询', desc: '看瓶号、流向、空瓶重、检验日期', url: '/pages/pda/bottle-query' },
	{ title: '罐装复秤', desc: '称罐装后的瓶子', url: '/pages/pda/reweigh', nativeOnly: true, createRequired: true },
	{ title: '回瓶复秤', desc: '称回来的瓶子', url: '/pages/pda/return-reweigh', nativeOnly: true, createRequired: true },
	{ title: isNative ? '称重销售' : '手机称重销售', desc: isNative ? '选客户，称瓶，保存' : '摄像头扫码、吊秤称重、提交瓶装 kg 销售', url: '/pages/pda/sale-create' }
].filter((item) => (!item.nativeOnly || isNative) && (!item.webOnly || !isNative) && canViewPage(item.url) && (!(item.createRequired || item.url === '/pages/pda/sale-create') || canPageAction(item.url, 'create')))

async function go(url) {
	await recordsRef.value?.deactivate()
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
	await recordsRef.value?.deactivate()
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
	padding: 12rpx;
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
	padding: 20rpx 16rpx;
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

.footer-actions {
	display: flex;
	justify-content: flex-end;
}


</style>

<style scoped lang="scss">
@import './pdaCompact.scss';
</style>
