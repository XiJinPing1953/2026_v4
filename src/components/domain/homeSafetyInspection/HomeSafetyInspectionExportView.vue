<template>
	<HomeSafetyInspectionShell title="导出巡检记录" subtitle="每张巡检单生成一个独立 Excel" back>
		<view class="export-card">
			<text class="section-title">选择巡检时间</text>
			<view class="preset-grid">
				<button
					v-for="preset in presets"
					:key="preset.value"
					:class="['preset-button', { 'preset-button--active': activePreset === preset.value }]"
					type="button"
					@click="selectPreset(preset.value)"
				>
					{{ preset.label }}
				</button>
			</view>
			<view v-if="scope !== 'all'" class="date-grid">
				<picker mode="date" :value="startDate" :end="today" @change="onStartDateChange">
					<view class="date-field">
						<text class="date-field__label">开始日期</text>
						<text class="date-field__value">{{ startDate }}</text>
					</view>
				</picker>
				<picker mode="date" :value="endDate" :end="today" @change="onEndDateChange">
					<view class="date-field">
						<text class="date-field__label">结束日期</text>
						<text class="date-field__value">{{ endDate }}</text>
					</view>
				</picker>
			</view>
			<button class="preview-button" type="button" :disabled="previewLoading" @click="loadPreview">
				{{ previewLoading ? '统计中…' : '刷新导出统计' }}
			</button>
		</view>

		<view class="export-card">
			<view class="summary-head">
				<text class="section-title">导出内容</text>
				<text class="range-text">{{ rangeText }}</text>
			</view>
			<view v-if="previewLoading && !preview" class="state-text">正在统计巡检记录…</view>
			<view v-else-if="preview" class="stats-grid">
				<view class="stat-item">
					<text class="stat-value">{{ preview.record_count }}</text>
					<text class="stat-label">巡检单</text>
				</view>
				<view class="stat-item">
					<text class="stat-value">{{ preview.customer_count }}</text>
					<text class="stat-label">客户</text>
				</view>
				<view class="stat-item stat-item--ok">
					<text class="stat-value">{{ preview.normal_count }}</text>
					<text class="stat-label">正常</text>
				</view>
				<view class="stat-item stat-item--danger">
					<text class="stat-value">{{ preview.abnormal_count }}</text>
					<text class="stat-label">异常</text>
				</view>
				<view class="stat-item stat-item--wide">
					<text class="stat-value">{{ preview.photo_count }}</text>
					<text class="stat-label">现场照片将嵌入 Excel</text>
				</view>
			</view>
			<text v-if="preview && !preview.within_limit" class="limit-warning">{{ preview.limit_message }}</text>
			<button
				class="create-button"
				type="button"
				:disabled="!canCreateExport"
				@click="createExport"
			>
				{{ creating ? '正在创建任务…' : '生成并下载 ZIP' }}
			</button>
			<text class="helper-text">每张巡检记录对应一个独立 Excel；导出文件保留 24 小时。</text>
		</view>

		<view v-if="activeJob" class="export-card">
			<view class="summary-head">
				<text class="section-title">当前任务</text>
				<text :class="['job-status', `job-status--${activeJob.status}`]">{{ statusText(activeJob.status) }}</text>
			</view>
			<text class="job-file">{{ activeJob.zip_file_name || '正在准备导出文件' }}</text>
			<view class="progress-track">
				<view class="progress-value" :style="{ width: `${progressPercent}%` }" />
			</view>
			<text class="progress-text">已完成 {{ activeJob.processed_count || 0 }} / {{ activeJob.total_count || 0 }} 单</text>
			<text v-if="activeJob.missing_file_count" class="missing-warning">有 {{ activeJob.missing_file_count }} 张图片未能读取，Excel 中已标记。</text>
			<text v-if="activeJob.error_message" class="limit-warning">{{ activeJob.error_message }}</text>
			<view class="job-actions">
				<button v-if="activeJob.can_download" class="action-button action-button--primary" type="button" @click="downloadJob(activeJob)">下载 ZIP</button>
				<button v-if="activeJob.can_download" class="action-button" type="button" @click="copyDownloadLink(activeJob)">复制链接</button>
				<button v-if="activeJob.can_resume" class="action-button action-button--primary" type="button" @click="resumeJob(activeJob)">重试生成</button>
				<button class="action-button" type="button" @click="refreshActiveJob">刷新进度</button>
			</view>
			<text v-if="isWechat && activeJob.can_download" class="wechat-tip">微信内无法直接保存 ZIP 时，请复制链接后使用 Safari 或 Chrome 打开。</text>
		</view>

		<view v-if="jobs.length" class="export-card">
			<text class="section-title">最近导出</text>
			<view class="job-list">
				<view v-for="job in jobs" :key="job._id" class="job-row" @click="selectJob(job)">
					<view class="job-row__body">
						<text class="job-row__title">{{ job.zip_file_name || '巡检记录导出' }}</text>
						<text class="job-row__meta">{{ formatDateTime(job.created_at) }} · {{ job.total_count }} 单</text>
					</view>
					<text :class="['job-status', `job-status--${job.status}`]">{{ statusText(job.status) }}</text>
				</view>
			</view>
		</view>
	</HomeSafetyInspectionShell>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import HomeSafetyInspectionShell from './HomeSafetyInspectionShell.vue'
import {
	createHomeSafetyInspectionExportV1,
	getHomeSafetyInspectionExportDownloadV1,
	getHomeSafetyInspectionExportJobV1,
	listMyHomeSafetyInspectionExportsV1,
	previewHomeSafetyInspectionExportV1,
	resumeHomeSafetyInspectionExportV1
} from '@/services/homeSafetyInspectionExport'

const presets = [
	{ label: '本周', value: 'week' },
	{ label: '本月', value: 'month' },
	{ label: '今年', value: 'year' },
	{ label: '全部', value: 'all' },
	{ label: '自定义', value: 'custom' }
]

const today = formatDate(new Date())
const activePreset = ref('month')
const scope = ref('range')
const startDate = ref(monthStart(new Date()))
const endDate = ref(today)
const preview = ref(null)
const previewLoading = ref(false)
const creating = ref(false)
const jobs = ref([])
const activeJob = ref(null)
const pendingRequestId = ref('')
let pollTimer = null

const rangeText = computed(() => scope.value === 'all' ? '全部历史' : `${startDate.value} 至 ${endDate.value}`)
const canCreateExport = computed(() =>
	!creating.value &&
	!previewLoading.value &&
	Boolean(preview.value?.record_count) &&
	Boolean(preview.value?.within_limit)
)
const progressPercent = computed(() => {
	const total = Number(activeJob.value?.total_count || 0)
	if (!total) return 0
	if (activeJob.value?.status === 'ready') return 100
	return Math.min(Math.round(Number(activeJob.value?.processed_count || 0) / total * 100), 99)
})
const isWechat = computed(() => {
	// #ifdef H5
	return /MicroMessenger/i.test(navigator.userAgent || '')
	// #endif
	return false
})

function pad(value) {
	return String(value).padStart(2, '0')
}

function formatDate(date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthStart(date) {
	return formatDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

function weekStart(date) {
	const day = date.getDay() || 7
	const result = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day + 1)
	return formatDate(result)
}

function yearStart(date) {
	return `${date.getFullYear()}-01-01`
}

function requestParams() {
	return scope.value === 'all'
		? { scope: 'all' }
		: { scope: 'range', start_date: startDate.value, end_date: endDate.value }
}

function selectPreset(value) {
	activePreset.value = value
	const now = new Date()
	scope.value = value === 'all' ? 'all' : 'range'
	if (value === 'week') startDate.value = weekStart(now)
	if (value === 'month') startDate.value = monthStart(now)
	if (value === 'year') startDate.value = yearStart(now)
	if (value !== 'all') endDate.value = formatDate(now)
	loadPreview()
}

function onStartDateChange(event) {
	activePreset.value = 'custom'
	scope.value = 'range'
	startDate.value = event.detail.value
	loadPreview()
}

function onEndDateChange(event) {
	activePreset.value = 'custom'
	scope.value = 'range'
	endDate.value = event.detail.value
	loadPreview()
}

async function loadPreview() {
	if (previewLoading.value) return
	previewLoading.value = true
	try {
		const res = await previewHomeSafetyInspectionExportV1(requestParams())
		if (res?.code !== 0) throw new Error(res?.msg || '统计失败')
		preview.value = res.data || null
	} catch (error) {
		preview.value = null
		uni.showToast({ title: error?.message || '统计失败', icon: 'none' })
	} finally {
		previewLoading.value = false
	}
}

function generateClientRequestId() {
	return `export_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

async function createExport() {
	if (!canCreateExport.value) return
	creating.value = true
	if (!pendingRequestId.value) pendingRequestId.value = generateClientRequestId()
	try {
		const res = await createHomeSafetyInspectionExportV1({
			...requestParams(),
			client_request_id: pendingRequestId.value
		})
		if (res?.code !== 0) throw new Error(res?.msg || '创建导出任务失败')
		activeJob.value = res.data || null
		pendingRequestId.value = ''
		await loadJobs()
		startPolling()
		uni.showToast({ title: '导出任务已开始', icon: 'success' })
	} catch (error) {
		uni.showToast({ title: error?.message || '创建导出任务失败', icon: 'none' })
	} finally {
		creating.value = false
	}
}

async function loadJobs() {
	try {
		const res = await listMyHomeSafetyInspectionExportsV1(10)
		if (res?.code !== 0) throw new Error(res?.msg || '导出记录加载失败')
		jobs.value = Array.isArray(res.data) ? res.data : []
		if (!activeJob.value && jobs.value.length) activeJob.value = jobs.value[0]
	} catch (error) {
		uni.showToast({ title: error?.message || '导出记录加载失败', icon: 'none' })
	}
}

function isWorking(job) {
	return ['queued', 'processing', 'packaging'].includes(job?.status)
}

function startPolling() {
	clearPolling()
	if (!isWorking(activeJob.value)) return
	pollTimer = setTimeout(async () => {
		await refreshActiveJob(false)
		startPolling()
	}, 2200)
}

function clearPolling() {
	if (pollTimer) clearTimeout(pollTimer)
	pollTimer = null
}

async function refreshActiveJob(showError = true) {
	if (!activeJob.value?._id) return
	try {
		const res = await getHomeSafetyInspectionExportJobV1(activeJob.value._id)
		if (res?.code !== 0) throw new Error(res?.msg || '进度加载失败')
		activeJob.value = res.data || activeJob.value
		jobs.value = jobs.value.map((job) => job._id === activeJob.value._id ? activeJob.value : job)
		if (!isWorking(activeJob.value)) clearPolling()
	} catch (error) {
		if (showError) uni.showToast({ title: error?.message || '进度加载失败', icon: 'none' })
	}
}

async function resumeJob(job) {
	try {
		const res = await resumeHomeSafetyInspectionExportV1(job._id)
		if (res?.code !== 0) throw new Error(res?.msg || '恢复任务失败')
		activeJob.value = res.data || job
		startPolling()
	} catch (error) {
		uni.showToast({ title: error?.message || '恢复任务失败', icon: 'none' })
	}
}

async function getDownload(job) {
	const res = await getHomeSafetyInspectionExportDownloadV1(job._id)
	if (res?.code !== 0) throw new Error(res?.msg || '下载地址生成失败')
	return res.data || {}
}

async function downloadJob(job) {
	try {
		const data = await getDownload(job)
		// #ifdef H5
		const link = document.createElement('a')
		link.href = data.temp_url
		link.target = '_blank'
		link.rel = 'noopener noreferrer'
		link.download = data.file_name || ''
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
		// #endif
		// #ifndef H5
		uni.setClipboardData({ data: data.temp_url })
		uni.showToast({ title: '下载链接已复制', icon: 'none' })
		// #endif
	} catch (error) {
		uni.showToast({ title: error?.message || '下载失败', icon: 'none' })
	}
}

async function copyDownloadLink(job) {
	try {
		const data = await getDownload(job)
		await uni.setClipboardData({ data: data.temp_url })
		uni.showToast({ title: '下载链接已复制', icon: 'success' })
	} catch (error) {
		uni.showToast({ title: error?.message || '复制失败', icon: 'none' })
	}
}

function selectJob(job) {
	activeJob.value = job
	startPolling()
}

function statusText(status) {
	return {
		queued: '排队中',
		processing: '生成中',
		packaging: '打包中',
		ready: '可下载',
		failed: '生成失败',
		stale: '需重新导出',
		expired: '已过期'
	}[status] || '未知状态'
}

function formatDateTime(value) {
	const date = new Date(Number(value || 0))
	if (!Number.isFinite(date.getTime())) return '-'
	return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function refresh() {
	await Promise.all([loadPreview(), loadJobs()])
	if (isWorking(activeJob.value)) startPolling()
}

onMounted(refresh)
onUnmounted(clearPolling)
defineExpose({ refresh })
</script>

<style scoped>
.export-card {
	margin-bottom: 20rpx;
	padding: 24rpx;
	border-radius: 22rpx;
	background: #fff;
	box-shadow: 0 6rpx 22rpx rgba(15, 42, 67, 0.06);
}
.section-title {
	font-size: 28rpx;
	font-weight: 800;
	color: #102a43;
}
.preset-grid {
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	gap: 10rpx;
	margin-top: 18rpx;
}
.preset-button,
.preview-button,
.create-button,
.action-button {
	margin: 0;
	border: 0;
	border-radius: 14rpx;
	font-size: 23rpx;
}
.preset-button::after,
.preview-button::after,
.create-button::after,
.action-button::after {
	border: 0;
}
.preset-button {
	padding: 0;
	height: 64rpx;
	line-height: 64rpx;
	background: #edf2f7;
	color: #486581;
}
.preset-button--active {
	background: #d9f3ed;
	color: #0f766e;
	font-weight: 700;
}
.date-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14rpx;
	margin-top: 18rpx;
}
.date-field {
	display: flex;
	flex-direction: column;
	gap: 7rpx;
	padding: 18rpx;
	border-radius: 14rpx;
	background: #f3f6fa;
}
.date-field__label {
	font-size: 21rpx;
	color: #829ab1;
}
.date-field__value {
	font-size: 26rpx;
	font-weight: 700;
	color: #243b53;
}
.preview-button {
	width: 100%;
	height: 68rpx;
	line-height: 68rpx;
	margin-top: 18rpx;
	background: #edf2f7;
	color: #334e68;
}
.summary-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
}
.range-text {
	font-size: 21rpx;
	color: #627d98;
}
.stats-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12rpx;
	margin-top: 20rpx;
}
.stat-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6rpx;
	padding: 18rpx 8rpx;
	border-radius: 14rpx;
	background: #f3f6fa;
}
.stat-item--wide {
	grid-column: span 4;
	flex-direction: row;
	justify-content: center;
}
.stat-item--ok { background: #e7f8f0; }
.stat-item--danger { background: #fff0f0; }
.stat-value {
	font-size: 32rpx;
	font-weight: 800;
	color: #102a43;
}
.stat-label,
.state-text,
.helper-text,
.progress-text,
.job-row__meta {
	font-size: 21rpx;
	color: #627d98;
}
.limit-warning,
.missing-warning,
.wechat-tip {
	display: block;
	margin-top: 16rpx;
	padding: 16rpx;
	border-radius: 12rpx;
	background: #fff1f0;
	color: #b42318;
	font-size: 22rpx;
	line-height: 1.5;
}
.missing-warning { background: #fff8e6; color: #8a4b08; }
.wechat-tip { background: #edf6ff; color: #175cd3; }
.create-button {
	width: 100%;
	height: 78rpx;
	line-height: 78rpx;
	margin-top: 20rpx;
	background: #0f766e;
	color: #fff;
	font-size: 27rpx;
	font-weight: 700;
}
.create-button[disabled] { background: #b8c5cf; color: #fff; }
.helper-text {
	display: block;
	margin-top: 12rpx;
	text-align: center;
}
.job-status {
	flex: none;
	padding: 7rpx 12rpx;
	border-radius: 999rpx;
	background: #edf2f7;
	color: #486581;
	font-size: 20rpx;
}
.job-status--ready { background: #dff7eb; color: #087443; }
.job-status--failed,
.job-status--stale { background: #ffe4e4; color: #b42318; }
.job-status--processing,
.job-status--packaging,
.job-status--queued { background: #e6f1ff; color: #175cd3; }
.job-file {
	display: block;
	margin-top: 18rpx;
	font-size: 24rpx;
	font-weight: 700;
	color: #243b53;
	word-break: break-all;
}
.progress-track {
	height: 14rpx;
	margin-top: 18rpx;
	overflow: hidden;
	border-radius: 999rpx;
	background: #e6ecf1;
}
.progress-value {
	height: 100%;
	border-radius: inherit;
	background: #0f766e;
	transition: width 0.25s ease;
}
.progress-text { display: block; margin-top: 10rpx; }
.job-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	margin-top: 18rpx;
}
.action-button {
	flex: 1;
	min-width: 180rpx;
	height: 68rpx;
	line-height: 68rpx;
	background: #edf2f7;
	color: #334e68;
}
.action-button--primary { background: #0f766e; color: #fff; }
.job-list { margin-top: 16rpx; }
.job-row {
	display: flex;
	align-items: center;
	gap: 16rpx;
	padding: 18rpx 0;
	border-bottom: 1rpx solid #e9eef3;
}
.job-row:last-child { border-bottom: 0; }
.job-row__body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 7rpx;
}
.job-row__title {
	font-size: 23rpx;
	font-weight: 700;
	color: #243b53;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
@media (max-width: 430px) {
	.preset-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.stat-item--wide { grid-column: span 2; }
}
</style>
