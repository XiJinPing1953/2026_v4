<template>
	<HomeSafetyInspectionShell
		title="巡检历史"
		:subtitle="customer ? customer.name : '按提交时间倒序'"
		back
	>
		<template #action>
			<button v-if="customer" class="new-button" type="button" @click="startNew">新增巡检</button>
		</template>

		<view v-if="customer" class="customer-banner">
			<text class="customer-banner__name">{{ customer.name }}</text>
			<text class="customer-banner__address">{{ customer.address || '客户档案暂无地址' }}</text>
		</view>

		<view v-if="loading && !records.length" class="state-card">正在加载巡检记录…</view>
		<view v-else-if="!records.length" class="state-card">暂无巡检记录</view>
		<view v-else class="record-list">
			<view
				v-for="record in records"
				:key="record._id"
				:class="['record-card', record.overall_result === 'abnormal' ? 'record-card--danger' : '']"
				@click="openDetail(record)"
			>
				<text v-if="record.inspection_no" class="record-card__number">{{ record.inspection_no }}</text>
				<view class="record-card__head">
					<text class="record-card__time">{{ formatDateTime(record.inspection_at) }}</text>
					<text :class="['record-card__result', record.overall_result === 'abnormal' ? 'record-card__result--danger' : '']">
						{{ record.overall_result === 'abnormal' ? '有异常' : '正常' }}
					</text>
				</view>
				<text class="record-card__location">{{ record.location_text || '未填写地点' }}</text>
				<text class="record-card__inspector">巡检员：{{ record.inspector_name || record.inspector_username_snapshot || '-' }}</text>
				<text v-if="record.revision_no" class="record-card__edited">管理员已修改 · 版本 {{ record.revision_no }}</text>
			</view>
		</view>

		<button v-if="paging.hasMore" class="load-more" :disabled="loading" type="button" @click="loadMore">
			{{ loading ? '加载中…' : '加载更多' }}
		</button>
	</HomeSafetyInspectionShell>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import HomeSafetyInspectionShell from './HomeSafetyInspectionShell.vue'
import { listHomeSafetyInspectionsV1 } from '@/services/homeSafetyInspection'

const props = defineProps({
	customerId: { type: String, required: true }
})
const customer = ref(null)
const records = ref([])
const loading = ref(false)
const page = ref(1)
const paging = ref({ hasMore: false })

function formatDateTime(value) {
	const date = new Date(Number(value || 0))
	if (!Number.isFinite(date.getTime())) return '-'
	const pad = (number) => String(number).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load(reset = false) {
	if (loading.value || !props.customerId) return
	if (reset) page.value = 1
	loading.value = true
	try {
		const res = await listHomeSafetyInspectionsV1({
			customerId: props.customerId,
			page: page.value,
			pageSize: 20
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '历史记录加载失败', icon: 'none' })
			return
		}
		const rows = Array.isArray(res.data) ? res.data : []
		records.value = reset ? rows : records.value.concat(rows)
		customer.value = res.customer || customer.value
		paging.value = res.paging || { hasMore: false }
	} catch (err) {
		uni.showToast({ title: err?.message || '历史记录加载失败', icon: 'none' })
	} finally {
		loading.value = false
	}
}

function loadMore() {
	if (!paging.value.hasMore) return
	page.value += 1
	load(false)
}

function startNew() {
	uni.navigateTo({
		url: `/pages/home-safety-inspection/form?customerId=${encodeURIComponent(props.customerId)}`
	})
}

function openDetail(record) {
	uni.navigateTo({
		url: `/pages/home-safety-inspection/detail?id=${encodeURIComponent(record._id)}`
	})
}

onMounted(() => load(true))
defineExpose({ refresh: () => load(true) })
</script>

<style scoped>
.new-button {
	margin: 0;
	padding: 0 16rpx;
	height: 60rpx;
	line-height: 58rpx;
	border-radius: 14rpx;
	background: rgba(255, 255, 255, 0.14);
	color: #fff;
	font-size: 22rpx;
}
.new-button::after,
.load-more::after {
	border: 0;
}
.customer-banner,
.record-card,
.state-card {
	background: #fff;
	border-radius: 20rpx;
	box-shadow: 0 6rpx 22rpx rgba(15, 42, 67, 0.06);
}
.customer-banner {
	padding: 22rpx 24rpx;
	margin-bottom: 18rpx;
}
.customer-banner__name,
.customer-banner__address {
	display: block;
}
.customer-banner__name {
	font-size: 28rpx;
	font-weight: 800;
	color: #102a43;
}
.customer-banner__address {
	margin-top: 8rpx;
	color: #627d98;
	font-size: 23rpx;
	line-height: 1.5;
}
.record-list {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}
.record-card {
	padding: 24rpx;
	border-left: 8rpx solid #10b981;
}
.record-card--danger {
	border-left-color: #dc2626;
	background: #fffafa;
}
.record-card__head {
	display: flex;
	align-items: center;
	gap: 18rpx;
}
.record-card__time {
	flex: 1;
	font-size: 28rpx;
	font-weight: 800;
	color: #102a43;
}
.record-card__result {
	padding: 7rpx 14rpx;
	border-radius: 999rpx;
	color: #047857;
	background: #d1fae5;
	font-size: 21rpx;
	font-weight: 700;
}
.record-card__result--danger {
	color: #b91c1c;
	background: #fee2e2;
}
.record-card__location,
.record-card__inspector,
.record-card__edited,
.record-card__number {
	display: block;
	margin-top: 11rpx;
	color: #526d82;
	font-size: 23rpx;
	line-height: 1.45;
}
.record-card__number {
	margin-top: 0;
	margin-bottom: 8rpx;
	color: #0f766e;
	font-weight: 700;
}
.record-card__inspector {
	color: #718096;
}
.record-card__edited {
	color: #9a6700;
}
.state-card {
	padding: 64rpx 24rpx;
	text-align: center;
	color: #64748b;
	font-size: 25rpx;
}
.load-more {
	margin: 24rpx 0 0;
	width: 100%;
	height: 74rpx;
	line-height: 72rpx;
	border-radius: 16rpx;
	background: #fff;
	color: #0f766e;
	font-size: 25rpx;
}
</style>
