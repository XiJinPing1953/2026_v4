<template>
	<HomeSafetyInspectionShell title="客户巡检">
		<template #action>
			<button class="logout-button" type="button" @click="logout">退出</button>
		</template>

		<view class="welcome-card">
			<text class="welcome-card__name">{{ userDisplayName }}</text>
			<text class="welcome-card__role">{{ roleLabel }}</text>
		</view>

		<view class="search-card">
			<input
				v-model="keyword"
				class="search-input"
				placeholder="搜索客户名称或地址"
				confirm-type="search"
				@confirm="search"
			/>
			<button class="search-button" type="button" @click="search">搜索</button>
		</view>

		<view v-if="loading && !customers.length" class="state-card">正在加载客户…</view>
		<view v-else-if="!customers.length" class="state-card">
			<text class="state-card__title">没有可巡检客户</text>
			<!-- <text class="state-card__hint">隐藏客户不会出现在这里；停用但未隐藏的客户仍会显示。</text> -->
		</view>

		<view v-else class="customer-list">
			<view v-for="customer in customers" :key="customer._id" class="customer-card">
				<view class="customer-card__head">
					<text class="customer-card__name">{{ customer.name || '未命名客户' }}</text>
					<text :class="['status-pill', resultClass(customer.latest_inspection)]">
						{{ resultText(customer.latest_inspection) }}
					</text>
				</view>
				<text class="customer-card__address">{{ customer.address || '客户档案暂无地址，可在巡检单内现场补录' }}</text>
				<text v-if="customer.latest_inspection" class="customer-card__last">
					最近巡检：{{ formatDateTime(customer.latest_inspection.inspection_at) }}
				</text>
				<text v-else class="customer-card__last">暂无巡检记录</text>
				<view class="customer-card__actions">
					<button class="card-button card-button--primary" type="button" @click="startInspection(customer)">开始巡检</button>
					<button class="card-button" type="button" @click="openHistory(customer)">历史记录</button>
				</view>
			</view>
		</view>

		<button v-if="paging.hasMore" class="load-more" :disabled="loading" type="button" @click="loadMore">
			{{ loading ? '加载中…' : '加载更多' }}
		</button>
	</HomeSafetyInspectionShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import HomeSafetyInspectionShell from './HomeSafetyInspectionShell.vue'
import { clearAuth, getUser } from '@/services/auth'
import { goLogin } from '@/services/navigation'
import { listHomeSafetyCustomersV1 } from '@/services/homeSafetyInspection'

const customers = ref([])
const keyword = ref('')
const loading = ref(false)
const page = ref(1)
const paging = ref({ hasMore: false, total: 0 })
const user = ref(getUser() || {})

const userDisplayName = computed(() => user.value.nickname || user.value.username || '巡检员')
const roleLabel = computed(() =>
	String(user.value.role_template || user.value.role || '').toLowerCase() === 'superadmin'
		? '超级管理员'
		: '入户安全巡检员'
)

function formatDateTime(value) {
	const date = new Date(Number(value || 0))
	if (!Number.isFinite(date.getTime())) return '-'
	const pad = (number) => String(number).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function resultText(latest) {
	if (!latest) return '未巡检'
	return latest.overall_result === 'abnormal' ? '有异常' : '正常'
}

function resultClass(latest) {
	if (!latest) return 'status-pill--empty'
	return latest.overall_result === 'abnormal' ? 'status-pill--danger' : 'status-pill--ok'
}

async function load(reset = false) {
	if (loading.value) return
	if (reset) page.value = 1
	loading.value = true
	try {
		const res = await listHomeSafetyCustomersV1({
			keyword: keyword.value,
			page: page.value,
			pageSize: 20
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '客户加载失败', icon: 'none' })
			return
		}
		const rows = Array.isArray(res.data) ? res.data : []
		customers.value = reset ? rows : customers.value.concat(rows)
		paging.value = res.paging || { hasMore: false, total: customers.value.length }
	} catch (err) {
		uni.showToast({ title: err?.message || '客户加载失败', icon: 'none' })
	} finally {
		loading.value = false
	}
}

function search() {
	load(true)
}

function loadMore() {
	if (!paging.value.hasMore) return
	page.value += 1
	load(false)
}

function startInspection(customer) {
	uni.navigateTo({
		url: `/pages/home-safety-inspection/form?customerId=${encodeURIComponent(customer._id)}`
	})
}

function openHistory(customer) {
	uni.navigateTo({
		url: `/pages/home-safety-inspection/history?customerId=${encodeURIComponent(customer._id)}`
	})
}

async function logout() {
	const confirmed = await new Promise((resolve) => {
		uni.showModal({
			title: '退出登录',
			content: '确认退出巡检账号吗？',
			success: (res) => resolve(Boolean(res.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirmed) return
	clearAuth()
	goLogin()
}

function refresh() {
	user.value = getUser() || {}
	return load(true)
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<style scoped>
.logout-button {
	margin: 0;
	padding: 0 18rpx;
	height: 60rpx;
	line-height: 58rpx;
	border-radius: 14rpx;
	background: rgba(255, 255, 255, 0.14);
	color: #fff;
	font-size: 23rpx;
}
.logout-button::after,
.search-button::after,
.card-button::after,
.load-more::after {
	border: 0;
}
.welcome-card,
.search-card,
.customer-card,
.state-card {
	background: #fff;
	border-radius: 22rpx;
	box-shadow: 0 6rpx 22rpx rgba(15, 42, 67, 0.06);
}
.welcome-card {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 22rpx 24rpx;
	margin-bottom: 18rpx;
}
.welcome-card__name {
	font-size: 28rpx;
	font-weight: 700;
	color: #102a43;
}
.welcome-card__role {
	font-size: 22rpx;
	color: #0f766e;
}
.search-card {
	display: flex;
	gap: 12rpx;
	padding: 16rpx;
	margin-bottom: 20rpx;
}
.search-input {
	flex: 1;
	height: 72rpx;
	padding: 0 22rpx;
	border-radius: 14rpx;
	background: #f3f6fa;
	font-size: 26rpx;
	box-sizing: border-box;
}
.search-button {
	flex: none;
	margin: 0;
	padding: 0 28rpx;
	height: 72rpx;
	line-height: 70rpx;
	border-radius: 14rpx;
	background: #0f766e;
	color: #fff;
	font-size: 25rpx;
}
.customer-list {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}
.customer-card {
	padding: 24rpx;
}
.customer-card__head {
	display: flex;
	align-items: flex-start;
	gap: 18rpx;
}
.customer-card__name {
	flex: 1;
	font-size: 30rpx;
	font-weight: 800;
	line-height: 1.35;
	color: #102a43;
}
.status-pill {
	flex: none;
	padding: 7rpx 14rpx;
	border-radius: 999rpx;
	font-size: 21rpx;
	font-weight: 700;
}
.status-pill--empty {
	color: #64748b;
	background: #edf2f7;
}
.status-pill--ok {
	color: #047857;
	background: #d1fae5;
}
.status-pill--danger {
	color: #b91c1c;
	background: #fee2e2;
}
.customer-card__address,
.customer-card__last {
	display: block;
	margin-top: 12rpx;
	color: #526d82;
	font-size: 24rpx;
	line-height: 1.55;
}
.customer-card__last {
	color: #8795a1;
	font-size: 22rpx;
}
.customer-card__actions {
	display: flex;
	gap: 14rpx;
	margin-top: 20rpx;
}
.card-button {
	flex: 1;
	margin: 0;
	height: 70rpx;
	line-height: 68rpx;
	border-radius: 14rpx;
	border: 1rpx solid #9fb3c8;
	background: #fff;
	color: #334e68;
	font-size: 25rpx;
}
.card-button--primary {
	border-color: #0f766e;
	background: #0f766e;
	color: #fff;
}
.state-card {
	padding: 60rpx 28rpx;
	text-align: center;
	color: #64748b;
	font-size: 26rpx;
}
.state-card__title,
.state-card__hint {
	display: block;
}
.state-card__title {
	color: #334e68;
	font-size: 28rpx;
	font-weight: 700;
}
.state-card__hint {
	margin-top: 12rpx;
	font-size: 23rpx;
	line-height: 1.5;
}
.load-more {
	margin: 24rpx auto 0;
	width: 100%;
	height: 74rpx;
	line-height: 72rpx;
	border-radius: 16rpx;
	background: #fff;
	color: #0f766e;
	font-size: 25rpx;
}
</style>
