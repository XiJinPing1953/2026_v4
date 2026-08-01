<template>
	<StationSafetyInspectionShell title="Excel 导出" subtitle="巡检明细 + 隐患整改台账" back>
		<view class="card">
			<text class="section-title">选择导出范围</text>
			<view class="preset-grid">
				<button v-for="preset in presets" :key="preset.value" :class="['preset', { 'preset--active': activePreset === preset.value }]" type="button" @click="selectPreset(preset.value)">{{ preset.label }}</button>
			</view>
			<view v-if="scope !== 'all'" class="field-grid">
				<picker mode="date" :value="startDate" :end="today" @change="onStartDate"><view class="field"><text>开始日期</text><text class="field__value">{{ startDate }}</text></view></picker>
				<picker mode="date" :value="endDate" :end="today" @change="onEndDate"><view class="field"><text>结束日期</text><text class="field__value">{{ endDate }}</text></view></picker>
			</view>
			<view class="field-grid">
				<picker :range="resultOptions" range-key="label" :value="resultIndex" @change="onResult"><view class="field"><text>巡检结果</text><text class="field__value">{{ resultOptions[resultIndex].label }}</text></view></picker>
				<picker :range="hazardOptions" range-key="label" :value="hazardIndex" @change="onHazard"><view class="field"><text>台账状态</text><text class="field__value">{{ hazardOptions[hazardIndex].label }}</text></view></picker>
			</view>
			<button class="secondary" type="button" :disabled="previewLoading" @click="loadPreview">{{ previewLoading ? '统计中…' : '刷新统计' }}</button>
		</view>

		<view class="card">
			<view class="section-head"><text class="section-title">导出预览</text><text class="range-text">{{ rangeText }}</text></view>
			<view v-if="preview" class="stats">
				<view><text class="stat-value">{{ preview.record_count }}</text><text>巡检单</text></view>
				<view><text class="stat-value">{{ preview.hazard_count }}</text><text>隐患</text></view>
				<view><text class="stat-value">{{ preview.photo_count }}</text><text>照片</text></view>
				<view><text class="stat-value">{{ preview.media_count }}</text><text>媒体文件</text></view>
			</view>
			<text v-if="preview && !preview.within_limit" class="warning">{{ preview.limit_message }}</text>
			<button class="primary" type="button" :disabled="!canCreate" @click="createExport">{{ creating ? '正在创建…' : '生成一个 Excel 文件' }}</button>
			<text class="helper">最多50张巡检单、2000个媒体文件；文件保留24小时。</text>
		</view>

		<view v-if="activeJob" class="card">
			<view class="section-head"><text class="section-title">当前任务</text><text :class="['status', `status--${activeJob.status}`]">{{ statusText(activeJob.status) }}</text></view>
			<text class="file-name">{{ activeJob.file_name || '正在准备文件' }}</text>
			<view class="progress"><view :class="['progress__value', { 'progress__value--working': isWorking(activeJob) }]" :style="{ width: activeJob.status === 'ready' ? '100%' : isWorking(activeJob) ? '72%' : '0%' }" /></view>
			<text class="job-meta">{{ activeJob.total_count }} 张巡检单 · {{ activeJob.hazard_count }} 项隐患 · {{ activeJob.photo_count }} 张照片</text>
			<text v-if="activeJob.missing_file_count" class="warning">有 {{ activeJob.missing_file_count }} 张图片读取失败，表格内已标记。</text>
			<text v-if="activeJob.error_message" class="warning">{{ activeJob.error_message }}</text>
			<view class="actions">
				<button v-if="activeJob.can_download" class="primary small" type="button" @click="download(activeJob)">下载 Excel</button>
				<button v-if="activeJob.can_download" class="secondary small" type="button" @click="copyLink(activeJob)">复制链接</button>
				<button v-if="activeJob.can_resume" class="primary small" type="button" @click="resume(activeJob)">重试</button>
				<button class="secondary small" type="button" @click="refreshActiveJob">刷新</button>
			</view>
		</view>

		<view v-if="jobs.length" class="card">
			<text class="section-title">最近导出</text>
			<view v-for="job in jobs" :key="job._id" class="job-row" @click="selectJob(job)"><view><text class="job-row__name">{{ job.file_name }}</text><text class="job-meta">{{ formatDateTime(job.created_at) }} · {{ job.total_count }} 单</text></view><text :class="['status', `status--${job.status}`]">{{ statusText(job.status) }}</text></view>
		</view>
	</StationSafetyInspectionShell>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import StationSafetyInspectionShell from './StationSafetyInspectionShell.vue'
import { createStationSafetyExportV1, getStationSafetyExportDownloadV1, getStationSafetyExportJobV1, listMyStationSafetyExportsV1, previewStationSafetyExportV1, resumeStationSafetyExportV1 } from '@/services/stationSafetyInspectionExport'

const presets = [{ label: '本周', value: 'week' }, { label: '本月', value: 'month' }, { label: '今年', value: 'year' }, { label: '全部', value: 'all' }, { label: '自定义', value: 'custom' }]
const resultOptions = [{ label: '全部结果', value: '' }, { label: '仅正常', value: 'normal' }, { label: '仅异常', value: 'abnormal' }]
const hazardOptions = [{ label: '全部状态', value: '' }, { label: '待整改', value: 'pending_rectification' }, { label: '待验证', value: 'pending_verification' }, { label: '已关闭', value: 'closed' }, { label: '已取消', value: 'cancelled' }]
const pad = (value) => String(value).padStart(2, '0')
const formatDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const today = formatDate(new Date())
const activePreset = ref('month')
const scope = ref('range')
const startDate = ref(`${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-01`)
const endDate = ref(today)
const resultIndex = ref(0)
const hazardIndex = ref(0)
const preview = ref(null)
const previewLoading = ref(false)
const creating = ref(false)
const jobs = ref([])
const activeJob = ref(null)
let requestId = ''
let timer = null

const rangeText = computed(() => scope.value === 'all' ? '全部历史' : `${startDate.value} 至 ${endDate.value}`)
const canCreate = computed(() => !creating.value && !previewLoading.value && Boolean(preview.value?.record_count) && Boolean(preview.value?.within_limit))
function params() { return { scope: scope.value, start_date: scope.value === 'all' ? '' : startDate.value, end_date: scope.value === 'all' ? '' : endDate.value, inspection_result: resultOptions[resultIndex.value].value, hazard_status: hazardOptions[hazardIndex.value].value } }
function weekStart(date) { const day = date.getDay() || 7; return formatDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - day + 1)) }
function selectPreset(value) { activePreset.value = value; scope.value = value === 'all' ? 'all' : 'range'; const now = new Date(); if (value === 'week') startDate.value = weekStart(now); if (value === 'month') startDate.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`; if (value === 'year') startDate.value = `${now.getFullYear()}-01-01`; if (value !== 'all') endDate.value = formatDate(now); loadPreview() }
function onStartDate(event) { activePreset.value = 'custom'; scope.value = 'range'; startDate.value = event.detail.value; loadPreview() }
function onEndDate(event) { activePreset.value = 'custom'; scope.value = 'range'; endDate.value = event.detail.value; loadPreview() }
function onResult(event) { resultIndex.value = Number(event.detail.value || 0); loadPreview() }
function onHazard(event) { hazardIndex.value = Number(event.detail.value || 0); loadPreview() }
async function loadPreview() { if (previewLoading.value) return; previewLoading.value = true; try { const res = await previewStationSafetyExportV1(params()); if (res?.code !== 0) throw new Error(res?.msg || '统计失败'); preview.value = res.data } catch (error) { preview.value = null; uni.showToast({ title: error?.message || '统计失败', icon: 'none' }) } finally { previewLoading.value = false } }
function newRequestId() { return `station_export_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}` }
async function createExport() { if (!canCreate.value) return; creating.value = true; if (!requestId) requestId = newRequestId(); try { const res = await createStationSafetyExportV1({ ...params(), client_request_id: requestId }); if (res?.code !== 0) throw new Error(res?.msg || '任务创建失败'); activeJob.value = res.data; requestId = ''; await loadJobs(); startPolling(); uni.showToast({ title: '任务已开始', icon: 'success' }) } catch (error) { uni.showToast({ title: error?.message || '任务创建失败', icon: 'none' }) } finally { creating.value = false } }
async function loadJobs() { try { const res = await listMyStationSafetyExportsV1(10); if (res?.code !== 0) throw new Error(res?.msg || '加载失败'); jobs.value = res.data || []; if (!activeJob.value && jobs.value.length) activeJob.value = jobs.value[0] } catch (error) { uni.showToast({ title: error?.message || '加载失败', icon: 'none' }) } }
function isWorking(job) { return ['queued', 'processing'].includes(job?.status) }
function clearPolling() { if (timer) clearTimeout(timer); timer = null }
function startPolling() { clearPolling(); if (!isWorking(activeJob.value)) return; timer = setTimeout(async () => { await refreshActiveJob(false); startPolling() }, 2500) }
async function refreshActiveJob(showError = true) { if (!activeJob.value?._id) return; try { const res = await getStationSafetyExportJobV1(activeJob.value._id); if (res?.code !== 0) throw new Error(res?.msg || '刷新失败'); activeJob.value = res.data; jobs.value = jobs.value.map((job) => job._id === res.data._id ? res.data : job); if (!isWorking(res.data)) clearPolling() } catch (error) { if (showError) uni.showToast({ title: error?.message || '刷新失败', icon: 'none' }) } }
async function resume(job) { try { const res = await resumeStationSafetyExportV1(job._id); if (res?.code !== 0) throw new Error(res?.msg || '重试失败'); activeJob.value = res.data; startPolling() } catch (error) { uni.showToast({ title: error?.message || '重试失败', icon: 'none' }) } }
async function downloadInfo(job) { const res = await getStationSafetyExportDownloadV1(job._id); if (res?.code !== 0) throw new Error(res?.msg || '下载地址生成失败'); return res.data }
async function download(job) {
	try {
		const data = await downloadInfo(job)
		// #ifdef H5
		const link = document.createElement('a')
		link.href = data.temp_url
		link.target = '_blank'
		link.download = data.file_name || ''
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
		// #endif
		// #ifndef H5
		uni.setClipboardData({ data: data.temp_url })
		uni.showToast({ title: '下载链接已复制', icon: 'none' })
		// #endif
	} catch (error) { uni.showToast({ title: error?.message || '下载失败', icon: 'none' }) }
}
async function copyLink(job) { try { const data = await downloadInfo(job); uni.setClipboardData({ data: data.temp_url }); uni.showToast({ title: '链接已复制', icon: 'success' }) } catch (error) { uni.showToast({ title: error?.message || '复制失败', icon: 'none' }) } }
function selectJob(job) { activeJob.value = job; startPolling() }
function statusText(status) { return ({ queued: '排队中', processing: '生成中', ready: '可下载', failed: '失败', expired: '已过期' })[status] || '未知' }
function formatDateTime(value) { const date = new Date(Number(value || 0)); return Number.isFinite(date.getTime()) ? `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}` : '-' }
async function refresh() { await Promise.all([loadPreview(), loadJobs()]); if (isWorking(activeJob.value)) startPolling() }
onMounted(refresh)
onUnmounted(clearPolling)
defineExpose({ refresh })
</script>

<style scoped>
.card { margin-bottom: 20rpx; padding: 24rpx; border: 1rpx solid #e2e8f0; border-radius: 22rpx; background: #fff; }
.section-title { color: #102a43; font-size: 28rpx; font-weight: 900; }.section-head { display:flex;align-items:center;justify-content:space-between;gap:16rpx }.range-text,.helper,.job-meta { color:#64748b;font-size:21rpx }.helper,.file-name,.warning,.job-meta,.field__value,.stat-value { display:block }.preset-grid { display:grid;grid-template-columns:repeat(5,1fr);gap:10rpx;margin-top:18rpx }.preset,.secondary,.primary { margin:0;border:0;border-radius:14rpx;font-size:23rpx }.preset::after,.secondary::after,.primary::after { border:0 }.preset { padding:0;height:62rpx;line-height:62rpx;color:#475569;background:#f1f5f9 }.preset--active { color:#9a3412;background:#ffedd5;font-weight:800 }.field-grid { display:grid;grid-template-columns:1fr 1fr;gap:14rpx;margin-top:16rpx }.field { display:flex;flex-direction:column;gap:7rpx;padding:16rpx;border-radius:14rpx;background:#f8fafc;color:#64748b;font-size:21rpx }.field__value { color:#1e293b;font-size:24rpx;font-weight:800 }.secondary,.primary { width:100%;height:70rpx;line-height:70rpx;margin-top:18rpx }.secondary { color:#334155;background:#f1f5f9 }.primary { color:#fff;background:#c2410c;font-weight:800 }.primary[disabled] { background:#cbd5e1 }.stats { display:grid;grid-template-columns:repeat(4,1fr);gap:10rpx;margin-top:20rpx }.stats view { display:flex;flex-direction:column;align-items:center;gap:5rpx;padding:16rpx 6rpx;border-radius:14rpx;background:#f8fafc }.stat-value { color:#102a43;font-size:31rpx;font-weight:800 }.stats text:not(.stat-value) { color:#64748b;font-size:20rpx }.helper { margin-top:12rpx;text-align:center }.warning { margin-top:16rpx;padding:14rpx;color:#b42318;border-radius:12rpx;background:#fff1f0;font-size:21rpx }.file-name { margin-top:16rpx;color:#334155;font-size:23rpx;font-weight:800;word-break:break-all }.progress { height:13rpx;margin-top:18rpx;overflow:hidden;border-radius:99rpx;background:#e2e8f0 }.progress__value { height:100%;background:#c2410c;transition:width .3s }.progress__value--working { animation:pulse 1.2s ease-in-out infinite }.job-meta { margin-top:9rpx }.actions { display:flex;gap:12rpx;flex-wrap:wrap }.small { flex:1;min-width:160rpx }.status { padding:7rpx 12rpx;border-radius:99rpx;color:#475569;background:#f1f5f9;font-size:20rpx }.status--ready { color:#047857;background:#d1fae5 }.status--failed { color:#b91c1c;background:#fee2e2 }.status--processing,.status--queued { color:#1d4ed8;background:#dbeafe }.job-row { display:flex;align-items:center;justify-content:space-between;gap:15rpx;padding:18rpx 0;border-bottom:1rpx solid #e2e8f0 }.job-row__name { display:block;max-width:540rpx;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-size:22rpx;font-weight:700 }@keyframes pulse{50%{opacity:.45}}@media(max-width:430px){.preset-grid{grid-template-columns:repeat(3,1fr)}.stats{grid-template-columns:repeat(2,1fr)}}
</style>
