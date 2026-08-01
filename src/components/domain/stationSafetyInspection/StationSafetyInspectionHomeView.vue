<template>
	<StationSafetyInspectionShell title="厂站安全巡检" subtitle="XTNY-001 · 四个分区共36项">
		<template #action><button class="switch-button" type="button" @click="switchModule">切换模块</button></template>
		<view class="hero-card">
			<view><text class="hero-card__label">当前厂站</text><text class="hero-card__value">无极县新拓能源开发有限公司</text></view>
			<button class="start-button" type="button" @click="startInspection">开始整站巡检</button>
		</view>
		<view class="action-grid">
			<view class="action-card" @click="open('/pages/station-safety-inspection/history')"><text class="action-card__title">巡检历史</text><text class="action-card__meta">{{ inspectionTotal }} 张巡检单</text></view>
			<view class="action-card action-card--warning" @click="open('/pages/station-safety-inspection/hazards')"><text class="action-card__title">隐患整改</text><text class="action-card__meta">{{ openHazardTotal }} 项待闭环</text></view>
			<view v-if="canExport" class="action-card action-card--export" @click="open('/pages/station-safety-inspection/export')"><text class="action-card__title">Excel 导出</text><text class="action-card__meta">巡检明细 + 整改台账</text></view>
		</view>
		<view class="latest-card">
			<view class="section-head"><text class="section-head__title">最近巡检</text><text class="section-head__link" @click="open('/pages/station-safety-inspection/history')">查看全部</text></view>
			<text v-if="loading" class="empty-text">正在加载…</text>
			<text v-else-if="!latest.length" class="empty-text">暂无厂站巡检记录</text>
			<view v-for="row in latest" :key="row._id" class="latest-row" @click="openDetail(row)">
				<view><text class="latest-row__no">{{ row.inspection_no }}</text><text class="latest-row__meta">{{ formatDateTime(row.inspection_at) }} · {{ row.inspector_name }}</text></view>
				<text :class="['result-pill', { 'result-pill--danger': row.overall_result === 'abnormal' }]">{{ row.overall_result === 'abnormal' ? `${row.abnormal_count}项异常` : '正常' }}</text>
			</view>
		</view>
	</StationSafetyInspectionShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import StationSafetyInspectionShell from './StationSafetyInspectionShell.vue'
import { listStationSafetyHazardsV1, listStationSafetyInspectionsV1 } from '@/services/stationSafetyInspection'
import { canViewPage } from '@/services/pageAcl'

const loading = ref(false)
const latest = ref([])
const inspectionTotal = ref(0)
const openHazardTotal = ref(0)
const canExport = computed(() => canViewPage('/pages/station-safety-inspection/export'))
function open(url) { uni.navigateTo({ url }) }
function startInspection() { open('/pages/station-safety-inspection/form') }
function openDetail(row) { open(`/pages/station-safety-inspection/detail?id=${encodeURIComponent(row._id)}`) }
function switchModule() { uni.reLaunch({ url: '/pages/safety-inspection/home' }) }
function formatDateTime(value) { const date = new Date(Number(value || 0)); return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '-' }
async function load() {
	loading.value = true
	try {
		const [inspectionRes, hazardRes] = await Promise.all([listStationSafetyInspectionsV1({ page: 1, pageSize: 5 }), listStationSafetyHazardsV1({ page: 1, pageSize: 1, status: 'open' })])
		if (inspectionRes?.code === 0) { latest.value = inspectionRes.data || []; inspectionTotal.value = Number(inspectionRes.paging?.total || 0) }
		if (hazardRes?.code === 0) openHazardTotal.value = Number(hazardRes.paging?.total || 0)
	} finally { loading.value = false }
}
onMounted(load)
defineExpose({ refresh: load })
</script>

<style scoped>
.switch-button { margin: 0; padding: 0 18rpx; min-height: 62rpx; color: #fff; border: 1rpx solid rgba(255,255,255,.42); border-radius: 14rpx; background: rgba(255,255,255,.12); font-size: 22rpx; }
.switch-button::after,.start-button::after { border: 0; }
.hero-card,.latest-card { padding: 26rpx; border: 1rpx solid #d9e2ec; border-radius: 24rpx; background: #fff; box-shadow: 0 10rpx 26rpx rgba(15,23,42,.05); }
.hero-card__label,.hero-card__value { display: block; }
.hero-card__label { color: #64748b; font-size: 21rpx; }.hero-card__value { margin-top: 6rpx; color: #102a43; font-size: 27rpx; font-weight: 800; }
.start-button { margin: 24rpx 0 0; width: 100%; min-height: 86rpx; color: #fff; border-radius: 18rpx; background: #c2410c; font-size: 28rpx; font-weight: 900; }
.action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; margin: 20rpx 0; }
.action-card { padding: 22rpx; border: 1rpx solid #bfdbfe; border-radius: 20rpx; background: #eff6ff; }.action-card--warning { border-color: #fed7aa; background: #fff7ed; }.action-card--export { grid-column: 1/-1; border-color: #c7d2fe; background: #eef2ff; }
.action-card__title,.action-card__meta { display: block; }.action-card__title { color: #1e3a5f; font-size: 26rpx; font-weight: 900; }.action-card__meta { margin-top: 8rpx; color: #64748b; font-size: 21rpx; }
.section-head,.latest-row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }.section-head__title { color: #102a43; font-size: 28rpx; font-weight: 900; }.section-head__link { color: #c2410c; font-size: 22rpx; }
.empty-text { display: block; padding: 34rpx 0; text-align: center; color: #94a3b8; font-size: 23rpx; }
.latest-row { padding: 18rpx 0; border-bottom: 1rpx solid #edf2f7; }.latest-row:last-child { border-bottom: 0; }.latest-row__no,.latest-row__meta { display: block; }.latest-row__no { color: #243b53; font-size: 24rpx; font-weight: 800; }.latest-row__meta { margin-top: 5rpx; color: #718096; font-size: 20rpx; }
.result-pill { flex: none; padding: 7rpx 13rpx; color: #047857; border-radius: 999rpx; background: #d1fae5; font-size: 20rpx; }.result-pill--danger { color: #b91c1c; background: #fee2e2; }
</style>
