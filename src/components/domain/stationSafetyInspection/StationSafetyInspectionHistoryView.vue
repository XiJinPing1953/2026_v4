<template>
	<StationSafetyInspectionShell title="巡检历史" subtitle="按日期与结果查看整站记录" back>
		<view class="filter-card">
			<view class="date-grid">
				<picker mode="date" :value="startDate" @change="startDate = $event.detail.value"><view class="picker-value">{{ startDate || '开始日期' }}</view></picker>
				<picker mode="date" :value="endDate" @change="endDate = $event.detail.value"><view class="picker-value">{{ endDate || '结束日期' }}</view></picker>
			</view>
			<view class="result-filter">
				<view v-for="option in resultOptions" :key="option.value" :class="['filter-chip', { 'filter-chip--active': result === option.value }]" @click="result = option.value">{{ option.label }}</view>
			</view>
			<button class="search-button" type="button" @click="load(true)">查询</button>
		</view>
		<view v-if="loading && !rows.length" class="state-card">正在加载…</view>
		<view v-else-if="!rows.length" class="state-card">当前条件下没有巡检记录</view>
		<view v-else class="history-list">
			<view v-for="row in rows" :key="row._id" class="history-card" @click="openDetail(row)">
				<view class="history-card__head"><text class="history-card__no">{{ row.inspection_no }}</text><text :class="['status-pill', { 'status-pill--danger': row.overall_result === 'abnormal' }]">{{ row.overall_result === 'abnormal' ? '异常' : '正常' }}</text></view>
				<text class="history-card__time">{{ formatDateTime(row.inspection_at) }}</text>
				<view class="history-card__meta"><text>巡检员：{{ row.inspector_name }}</text><text>照片：{{ row.photo_count }} 张</text><text>隐患：{{ row.abnormal_count }} 项</text></view>
			</view>
			<button v-if="paging.hasMore" class="load-more" :disabled="loading" type="button" @click="loadMore">{{ loading ? '加载中…' : '加载更多' }}</button>
		</view>
	</StationSafetyInspectionShell>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import StationSafetyInspectionShell from './StationSafetyInspectionShell.vue'
import { listStationSafetyInspectionsV1 } from '@/services/stationSafetyInspection'

const resultOptions = [{ label: '全部', value: '' }, { label: '正常', value: 'normal' }, { label: '异常', value: 'abnormal' }]
const rows = ref([]); const loading = ref(false); const page = ref(1); const paging = ref({ hasMore: false, total: 0 }); const startDate = ref(''); const endDate = ref(''); const result = ref('')
function formatDateTime(value) { const date = new Date(Number(value || 0)); return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '-' }
function openDetail(row) { uni.navigateTo({ url: `/pages/station-safety-inspection/detail?id=${encodeURIComponent(row._id)}` }) }
async function load(reset = false) {
	if (loading.value) return
	if (reset) page.value = 1
	loading.value = true
	try {
		const res = await listStationSafetyInspectionsV1({ page: page.value, pageSize: 20, start_date: startDate.value, end_date: endDate.value, result: result.value })
		if (res?.code !== 0) throw new Error(res?.msg || '加载失败')
		rows.value = reset ? (res.data || []) : rows.value.concat(res.data || [])
		paging.value = res.paging || { hasMore: false, total: rows.value.length }
	} catch (error) { uni.showToast({ title: error?.message || '加载失败', icon: 'none' }) }
	finally { loading.value = false }
}
function loadMore() { if (paging.value.hasMore) { page.value += 1; load() } }
onMounted(() => load(true))
defineExpose({ refresh: () => load(true) })
</script>

<style scoped>
.filter-card,.state-card,.history-card { padding: 22rpx; border: 1rpx solid #d9e2ec; border-radius: 20rpx; background: #fff; }.state-card { text-align: center; color: #718096; }
.date-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12rpx; }.picker-value { min-height: 72rpx; padding: 0 16rpx; line-height: 72rpx; color: #475569; border: 1rpx solid #cbd5e1; border-radius: 14rpx; font-size: 23rpx; }
.result-filter { display: flex; gap: 10rpx; margin-top: 14rpx; }.filter-chip { padding: 10rpx 20rpx; color: #64748b; border-radius: 999rpx; background: #f1f5f9; font-size: 22rpx; }.filter-chip--active { color: #9a3412; background: #ffedd5; }
.search-button,.load-more { margin: 16rpx 0 0; width: 100%; min-height: 70rpx; color: #fff; border-radius: 14rpx; background: #c2410c; font-size: 24rpx; }.search-button::after,.load-more::after { border: 0; }
.history-list { display: flex; flex-direction: column; gap: 16rpx; margin-top: 18rpx; }.history-card__head { display: flex; justify-content: space-between; gap: 16rpx; }.history-card__no { color: #243b53; font-size: 26rpx; font-weight: 900; }.status-pill { padding: 6rpx 14rpx; color: #047857; border-radius: 999rpx; background: #d1fae5; font-size: 20rpx; }.status-pill--danger { color: #b91c1c; background: #fee2e2; }
.history-card__time { display: block; margin-top: 8rpx; color: #64748b; font-size: 22rpx; }.history-card__meta { display: flex; flex-wrap: wrap; gap: 14rpx; margin-top: 12rpx; color: #475569; font-size: 21rpx; }
</style>
