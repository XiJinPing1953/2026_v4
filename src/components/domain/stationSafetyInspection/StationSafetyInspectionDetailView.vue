<template>
	<StationSafetyInspectionShell title="厂站巡检单详情" subtitle="完整检查结果与现场证据" back>
		<template #action><button v-if="record?.can_update" class="edit-button" type="button" @click="edit">修改</button></template>
		<view v-if="loading" class="state-card">正在加载…</view>
		<view v-else-if="error" class="state-card state-card--error">{{ error }}</view>
		<view v-else-if="record" class="detail-stack">
			<view class="detail-card">
				<view :class="['result-banner', { 'result-banner--danger': record.overall_result === 'abnormal' }]"><text>{{ record.inspection_no }}</text><text>{{ record.overall_result === 'abnormal' ? `${record.abnormal_count}项异常` : '整单正常' }}</text></view>
				<view class="meta-grid"><view><text class="meta-label">巡检时间</text><text class="meta-value">{{ formatDateTime(record.inspection_at) }}</text></view><view><text class="meta-label">巡检员</text><text class="meta-value">{{ record.inspector_name }}</text></view><view><text class="meta-label">厂站</text><text class="meta-value">{{ record.station_name_snapshot }}</text></view><view><text class="meta-label">照片</text><text class="meta-value">{{ record.photo_count }} 张</text></view></view>
				<text v-if="record.remark" class="remark">备注：{{ record.remark }}</text>
			</view>
			<view v-for="area in groupedItems" :key="area.code" class="detail-card">
				<text class="area-title">{{ area.label }}</text>
				<view v-for="item in area.items" :key="item.item_code" :class="['item-row', { 'item-row--danger': item.is_abnormal }]">
					<view class="item-row__head"><text class="item-row__label">{{ item.item_label_snapshot }}</text><text class="item-row__result">{{ item.result_label_snapshot }}</text></view>
					<view class="photo-grid">
						<template v-for="fileId in item.photo_file_ids" :key="fileId">
							<image v-if="mediaMap[fileId]" class="photo" :src="mediaMap[fileId]" mode="aspectFill" lazy-load @error="retryMedia(fileId)" @click="preview(item.photo_file_ids, fileId)" />
							<view v-else class="photo photo--loading"><text>加载中</text></view>
						</template>
					</view>
					<view v-if="item.is_abnormal" class="hazard-summary">
						<text>隐患：{{ item.issue_note }}</text><text>等级：{{ item.hazard_level === 'major' ? '重大' : '一般' }}</text><text>责任人：{{ item.responsible_name }}</text><text>计划措施：{{ item.planned_measure }}</text><text>计划日期：{{ item.planned_complete_date }}</text>
						<image v-if="item.responsible_signature_file_id && mediaMap[item.responsible_signature_file_id]" class="signature" :src="mediaMap[item.responsible_signature_file_id]" mode="aspectFit" lazy-load @error="retryMedia(item.responsible_signature_file_id)" />
					</view>
				</view>
			</view>
		</view>
	</StationSafetyInspectionShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import StationSafetyInspectionShell from './StationSafetyInspectionShell.vue'
import { getStationSafetyInspectionV1 } from '@/services/stationSafetyInspection'
import { invalidateInspectionFileUrl, resolveInspectionFileUrls } from '@/services/stationSafetyInspectionMedia'

const props = defineProps({ inspectionId: { type: String, required: true } })
const loading = ref(true); const error = ref(''); const record = ref(null); const mediaMap = ref({})
const retriedMediaIds = new Set()
let loadSequence = 0
const groupedItems = computed(() => {
	const map = new Map()
	for (const item of record.value?.items || []) {
		if (!map.has(item.area_code)) map.set(item.area_code, { code: item.area_code, label: item.area_label_snapshot, items: [] })
		map.get(item.area_code).items.push(item)
	}
	return Array.from(map.values())
})
function formatDateTime(value) { const date = new Date(Number(value || 0)); return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '-' }
function edit() { uni.navigateTo({ url: `/pages/station-safety-inspection/form?id=${encodeURIComponent(props.inspectionId)}` }) }
function preview(fileIds, current) {
	const urls = fileIds.map((id) => mediaMap.value[id]).filter(Boolean)
	const currentUrl = mediaMap.value[current]
	if (currentUrl && urls.length) uni.previewImage({ urls, current: currentUrl })
}
function mergeResolvedMedia(resolved, sequence = loadSequence) {
	if (sequence !== loadSequence) return
	const usable = Object.fromEntries(Object.entries(resolved || {}).filter(([fileId, url]) => url && url !== fileId))
	if (Object.keys(usable).length) mediaMap.value = { ...mediaMap.value, ...usable }
}
async function retryMedia(fileId) {
	if (!fileId || retriedMediaIds.has(fileId)) return
	retriedMediaIds.add(fileId)
	invalidateInspectionFileUrl(fileId)
	const retained = { ...mediaMap.value }
	delete retained[fileId]
	mediaMap.value = retained
	const resolved = await resolveInspectionFileUrls([fileId], { forceRefresh: true })
	mergeResolvedMedia(resolved)
}
async function load() {
	const sequence = ++loadSequence
	loading.value = true
	error.value = ''
	try {
		const res = await getStationSafetyInspectionV1(props.inspectionId)
		if (res?.code !== 0) throw new Error(res?.msg || '加载失败')
		if (sequence !== loadSequence) return
		record.value = res.data
		const ids = (record.value.items || []).flatMap((item) => [...(item.photo_file_ids || []), item.responsible_signature_file_id || '']).filter(Boolean)
		const activeIds = new Set(ids)
		mediaMap.value = Object.fromEntries(Object.entries(mediaMap.value).filter(([fileId]) => activeIds.has(fileId)))
		loading.value = false
		const resolved = await resolveInspectionFileUrls(ids, {
			batchSize: 20,
			onBatchResolved: (batch) => mergeResolvedMedia(batch, sequence)
		})
		mergeResolvedMedia(resolved, sequence)
	} catch (err) { error.value = err?.message || '加载失败' }
	finally { if (sequence === loadSequence) loading.value = false }
}
onMounted(load)
defineExpose({ refresh: load })
</script>

<style scoped>
.edit-button { margin: 0; padding: 0 20rpx; min-height: 62rpx; color: #fff; border: 1rpx solid rgba(255,255,255,.45); border-radius: 14rpx; background: rgba(255,255,255,.12); font-size: 22rpx; }.edit-button::after { border: 0; }
.state-card,.detail-card { padding: 24rpx; border: 1rpx solid #d9e2ec; border-radius: 22rpx; background: #fff; }.state-card--error { color: #b91c1c; }.detail-stack { display: flex; flex-direction: column; gap: 18rpx; }
.result-banner { display: flex; justify-content: space-between; padding: 18rpx; color: #047857; border-radius: 16rpx; background: #ecfdf5; font-size: 25rpx; font-weight: 900; }.result-banner--danger { color: #b91c1c; background: #fef2f2; }
.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18rpx; margin-top: 20rpx; }.meta-label,.meta-value { display: block; }.meta-label { color: #64748b; font-size: 20rpx; }.meta-value { margin-top: 5rpx; color: #243b53; font-size: 23rpx; font-weight: 700; }.remark { display: block; margin-top: 18rpx; color: #475569; font-size: 22rpx; }
.area-title { color: #102a43; font-size: 29rpx; font-weight: 900; }.item-row { margin-top: 16rpx; padding: 18rpx; border-radius: 16rpx; background: #f8fafc; }.item-row--danger { background: #fff1f2; }.item-row__head { display: flex; justify-content: space-between; gap: 16rpx; }.item-row__label { flex: 1; color: #334e68; font-size: 24rpx; line-height: 1.5; }.item-row__result { color: #047857; font-weight: 900; }.item-row--danger .item-row__result { color: #b91c1c; }
.photo-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10rpx; margin-top: 12rpx; }.photo { width: 100%; aspect-ratio: 1; border-radius: 12rpx; background: #e2e8f0; }.photo--loading { display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 19rpx; }.hazard-summary { display: flex; flex-direction: column; gap: 8rpx; margin-top: 14rpx; padding: 14rpx; color: #881337; border-radius: 12rpx; background: #ffe4e6; font-size: 21rpx; line-height: 1.5; }.signature { width: 100%; height: 160rpx; background: #fff; border-radius: 10rpx; }
</style>
