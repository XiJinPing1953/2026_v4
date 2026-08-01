<template>
	<StationSafetyInspectionShell :title="hazardId ? '隐患整改详情' : '隐患整改'" :subtitle="hazardId ? '上报、整改、验证闭环' : '集中跟踪待整改和待验证任务'" back>
		<view v-if="loading" class="state-card">正在加载…</view>
		<view v-else-if="error" class="state-card state-card--error">{{ error }}</view>

		<view v-else-if="!hazardId" class="list-stack">
			<view class="filter-card">
				<input v-model="keyword" class="input" placeholder="搜索编号、区域、隐患或责任人" confirm-type="search" @confirm="loadList(true)" />
					<scroll-view scroll-x class="status-scroll"><view class="status-row"><view v-for="option in statusOptions" :key="option.value" :class="['filter-chip', { 'filter-chip--active': status === option.value }]" @click="selectStatus(option.value)">{{ option.label }}</view></view></scroll-view>
				<button class="search-button" type="button" @click="loadList(true)">查询</button>
			</view>
			<view v-if="!rows.length" class="state-card">当前条件下没有隐患记录</view>
			<view v-for="row in rows" :key="row._id" :class="['hazard-card', { 'hazard-card--major': row.hazard_level === 'major' }]" @click="openHazard(row)">
				<view class="hazard-card__head"><text class="hazard-card__no">{{ row.hazard_no }}</text><text :class="['status-pill', `status-pill--${row.status}`]">{{ statusText(row.status) }}</text></view>
				<text class="hazard-card__area">{{ row.area_label_snapshot }} · {{ row.item_label_snapshot }}</text>
				<text class="hazard-card__issue">{{ row.issue_note }}</text>
				<view class="hazard-card__meta"><text>{{ row.hazard_level === 'major' ? '重大隐患' : '一般隐患' }}</text><text>责任人 {{ row.responsible_name }}</text><text :class="{ overdue: row.is_overdue }">{{ row.is_overdue ? '已逾期 ' : '期限 ' }}{{ row.planned_complete_date }}</text></view>
			</view>
			<button v-if="paging.hasMore" class="load-more" :disabled="loadingMore" type="button" @click="loadMore">{{ loadingMore ? '加载中…' : '加载更多' }}</button>
		</view>

		<view v-else-if="hazard" class="detail-stack">
			<view class="detail-card">
				<view class="detail-head"><view><text class="detail-no">{{ hazard.hazard_no }}</text><text class="detail-source">{{ hazard.inspection_no }} · {{ hazard.inspection_date }}</text></view><text :class="['status-pill', `status-pill--${hazard.status}`]">{{ statusText(hazard.status) }}</text></view>
				<view class="detail-grid"><view><text class="detail-label">检查区域</text><text class="detail-value">{{ hazard.area_label_snapshot }}</text></view><view><text class="detail-label">检查项</text><text class="detail-value">{{ hazard.item_label_snapshot }}</text></view><view><text class="detail-label">隐患等级</text><text class="detail-value">{{ hazard.hazard_level === 'major' ? '重大' : '一般' }}</text></view><view><text class="detail-label">责任人</text><text class="detail-value">{{ hazard.responsible_name }}</text></view></view>
				<view class="text-block"><text class="detail-label">隐患描述</text><text class="detail-value">{{ hazard.issue_note }}</text></view>
				<view class="text-block"><text class="detail-label">计划整改措施</text><text class="detail-value">{{ hazard.planned_measure }}</text></view>
				<view class="text-block"><text class="detail-label">计划完成日期</text><text :class="['detail-value', { overdue: hazard.is_overdue }]">{{ hazard.planned_complete_date }}{{ hazard.is_overdue ? '（已逾期）' : '' }}</text></view>
					<text class="detail-label">巡检现场照片</text><view class="photo-grid"><image v-for="id in hazard.inspection_photo_file_ids" :key="id" class="photo" :src="mediaMap[id] || id" mode="aspectFill" @click="preview(hazard.inspection_photo_file_ids, id)" /></view>
					<text class="detail-label">责任人签名</text><image class="signature" :src="mediaMap[hazard.responsible_signature_file_id] || hazard.responsible_signature_file_id" mode="aspectFit" />
					<button v-if="hazard.can_admin_edit" class="admin-link" type="button" @click="editInspection">修改原始巡检及隐患信息</button>
			</view>

			<view v-if="hazard.rectification_note" class="detail-card">
				<text class="card-title">已提交整改结果</text><text class="paragraph">{{ hazard.rectification_note }}</text>
				<view class="photo-grid"><image v-for="id in hazard.rectification_photo_file_ids" :key="id" class="photo" :src="mediaMap[id] || id" mode="aspectFill" @click="preview(hazard.rectification_photo_file_ids, id)" /></view>
				<text class="detail-source">{{ formatDateTime(hazard.rectified_at) }} · {{ hazard.rectified_by_name }}</text>
			</view>

				<view v-if="hazard.verification_note" class="detail-card">
				<text class="card-title">最近验证结论</text><text class="paragraph">{{ hazard.verification_result === 'passed' ? '验证通过' : '验证退回' }}：{{ hazard.verification_note }}</text>
				<view v-if="hazard.verification_photo_file_ids?.length" class="photo-grid"><image v-for="id in hazard.verification_photo_file_ids" :key="id" class="photo" :src="mediaMap[id] || id" mode="aspectFill" @click="preview(hazard.verification_photo_file_ids, id)" /></view>
				</view>

				<view v-if="hazard.can_admin_edit && hazard.rectified_at && hazard.status !== 'cancelled'" class="detail-card admin-card">
					<text class="card-title">超级管理员修订闭环内容</text>
					<text class="admin-hint">修改不保留旧版本，修改人和时间会写入操作日志。</text>
					<textarea v-model="adminRectificationNote" class="textarea" maxlength="1000" placeholder="实际整改措施" />
					<text class="field-label">整改照片 <text class="required">*</text></text>
					<StationSafetyPhotoField :model-value="adminRectificationPhotos" :max="3" @update:model-value="updateAdminRectificationPhotos" @retry="retryUpload('admin-rectification', $event)" />
					<template v-if="hazard.verified_at">
						<view class="verification-options"><view :class="['verify-option', { 'verify-option--active': adminVerificationResult === 'passed' }]" @click="adminVerificationResult = 'passed'">验证通过</view><view :class="['verify-option', 'verify-option--danger', { 'verify-option--active': adminVerificationResult === 'rejected' }]" @click="adminVerificationResult = 'rejected'">验证退回</view></view>
						<textarea v-model="adminVerificationNote" class="textarea" maxlength="1000" placeholder="验证结论" />
						<text class="field-label">验证照片（选填）</text>
						<StationSafetyPhotoField :model-value="adminVerificationPhotos" :max="3" :required="false" @update:model-value="updateAdminVerificationPhotos" @retry="retryUpload('admin-verification', $event)" />
					</template>
					<button class="primary-button" :disabled="saving" type="button" @click="saveAdminOutcome">{{ saving ? '正在保存…' : '保存闭环内容修改' }}</button>
				</view>

			<view v-if="hazard.status === 'pending_rectification'" class="detail-card">
				<text class="card-title">提交实际整改结果</text>
				<textarea v-model="rectificationNote" class="textarea" maxlength="1000" placeholder="请填写实际整改措施和复查情况" />
				<text class="field-label">整改后照片 <text class="required">*</text></text>
				<StationSafetyPhotoField :model-value="rectificationPhotos" :max="3" @update:model-value="updateRectificationPhotos" @retry="retryUpload('rectification', $event)" />
				<button class="primary-button" :disabled="saving" type="button" @click="submitRectification">{{ saving ? '正在提交…' : '提交整改，等待验证' }}</button>
			</view>

			<view v-if="hazard.status === 'pending_verification' && hazard.can_verify" class="detail-card">
				<text class="card-title">超级管理员验证</text>
				<view class="verification-options"><view :class="['verify-option', { 'verify-option--active': verificationResult === 'passed' }]" @click="verificationResult = 'passed'">验证通过</view><view :class="['verify-option', 'verify-option--danger', { 'verify-option--active': verificationResult === 'rejected' }]" @click="verificationResult = 'rejected'">验证退回</view></view>
				<textarea v-model="verificationNote" class="textarea" maxlength="1000" placeholder="请填写验证结论" />
				<text class="field-label">验证照片（选填）</text>
				<StationSafetyPhotoField :model-value="verificationPhotos" :max="3" :required="false" @update:model-value="updateVerificationPhotos" @retry="retryUpload('verification', $event)" />
				<button class="primary-button" :disabled="saving" type="button" @click="verify">{{ saving ? '正在提交…' : '确认验证结论' }}</button>
			</view>
		</view>
	</StationSafetyInspectionShell>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import StationSafetyInspectionShell from './StationSafetyInspectionShell.vue'
import StationSafetyPhotoField from './StationSafetyPhotoField.vue'
import { getStationSafetyHazardV1, listStationSafetyHazardsV1, submitStationSafetyRectificationV1, updateStationSafetyHazardOutcomeV1, verifyStationSafetyHazardV1 } from '@/services/stationSafetyInspection'
import { resolveInspectionFileUrls, uploadStationSafetyImage } from '@/services/stationSafetyInspectionMedia'

const props = defineProps({ hazardId: { type: String, default: '' } })
const statusOptions = [{ label: '待闭环', value: 'open' }, { label: '待整改', value: 'pending_rectification' }, { label: '待验证', value: 'pending_verification' }, { label: '已关闭', value: 'closed' }, { label: '已取消', value: 'cancelled' }]
const loading = ref(false); const loadingMore = ref(false); const error = ref(''); const rows = ref([]); const page = ref(1); const paging = ref({ hasMore: false, total: 0 }); const keyword = ref(''); const status = ref('open'); const hazard = ref(null); const mediaMap = ref({}); const saving = ref(false)
const rectificationNote = ref(''); const rectificationPhotos = ref([]); const verificationResult = ref('passed'); const verificationNote = ref(''); const verificationPhotos = ref([])
const adminRectificationNote = ref(''); const adminRectificationPhotos = ref([]); const adminVerificationResult = ref('passed'); const adminVerificationNote = ref(''); const adminVerificationPhotos = ref([])

function statusText(value) { return ({ pending_rectification: '待整改', pending_verification: '待验证', closed: '已关闭', cancelled: '已取消' })[value] || value || '-' }
function formatDateTime(value) { const date = new Date(Number(value || 0)); return Number.isFinite(date.getTime()) && Number(value) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '-' }
function openHazard(row) { uni.navigateTo({ url: `/pages/station-safety-inspection/hazards?id=${encodeURIComponent(row._id)}` }) }
function selectStatus(value) { status.value = value; loadList(true) }
function preview(ids, current) { const urls = (ids || []).map((id) => mediaMap.value[id] || id); if (urls.length) uni.previewImage({ urls, current: mediaMap.value[current] || current }) }
function editInspection() { if (hazard.value?.inspection_id) uni.navigateTo({ url: `/pages/station-safety-inspection/form?id=${encodeURIComponent(hazard.value.inspection_id)}` }) }
function photoRecords(ids) { return (ids || []).map((fileId) => ({ fileId, localPath: '', previewUrl: mediaMap.value[fileId] || fileId, uploading: false, uploadState: 'uploaded', errorMessage: '' })) }
function hydrateAdminFields() {
	adminRectificationNote.value = hazard.value?.rectification_note || ''
	adminRectificationPhotos.value = photoRecords(hazard.value?.rectification_photo_file_ids)
	adminVerificationResult.value = hazard.value?.verification_result || 'passed'
	adminVerificationNote.value = hazard.value?.verification_note || ''
	adminVerificationPhotos.value = photoRecords(hazard.value?.verification_photo_file_ids)
}

async function loadList(reset = false) {
	const flag = reset || !rows.value.length ? loading : loadingMore
	if (flag.value) return
	if (reset) page.value = 1
	flag.value = true; error.value = ''
	try {
		const res = await listStationSafetyHazardsV1({ page: page.value, pageSize: 20, keyword: keyword.value, status: status.value })
		if (res?.code !== 0) throw new Error(res?.msg || '加载失败')
		rows.value = reset ? (res.data || []) : rows.value.concat(res.data || [])
		paging.value = res.paging || { hasMore: false, total: rows.value.length }
	} catch (err) { error.value = err?.message || '加载失败' }
	finally { flag.value = false }
}

async function loadDetail() {
	loading.value = true; error.value = ''
	try {
		const res = await getStationSafetyHazardV1(props.hazardId)
		if (res?.code !== 0) throw new Error(res?.msg || '加载失败')
		hazard.value = res.data
			const ids = [hazard.value.responsible_signature_file_id, ...(hazard.value.inspection_photo_file_ids || []), ...(hazard.value.rectification_photo_file_ids || []), ...(hazard.value.verification_photo_file_ids || [])].filter(Boolean)
			mediaMap.value = await resolveInspectionFileUrls(ids)
			hydrateAdminFields()
	} catch (err) { error.value = err?.message || '加载失败' }
	finally { loading.value = false }
}

async function drainUploads(kind, target) {
	while (true) {
		const index = target.value.findIndex((photo) => photo.localPath && !photo.fileId && photo.uploadState !== 'failed' && !photo.uploading)
		if (index < 0) break
		const photo = target.value[index]; photo.uploading = true; photo.uploadState = 'uploading'
		try { photo.fileId = await uploadStationSafetyImage({ filePath: photo.localPath, submissionId: props.hazardId, scope: kind, index }); photo.previewUrl = photo.previewUrl || photo.localPath; photo.localPath = ''; photo.uploading = false; photo.uploadState = 'uploaded' }
		catch (err) { photo.uploading = false; photo.uploadState = 'failed'; photo.errorMessage = err?.message || '上传失败' }
		target.value = target.value.slice()
	}
}
function updateRectificationPhotos(value) { rectificationPhotos.value = value; drainUploads('rectification', rectificationPhotos) }
function updateVerificationPhotos(value) { verificationPhotos.value = value; drainUploads('verification', verificationPhotos) }
function updateAdminRectificationPhotos(value) { adminRectificationPhotos.value = value; drainUploads('admin-rectification', adminRectificationPhotos) }
function updateAdminVerificationPhotos(value) { adminVerificationPhotos.value = value; drainUploads('admin-verification', adminVerificationPhotos) }
function targetForKind(kind) { return ({ rectification: rectificationPhotos, verification: verificationPhotos, 'admin-rectification': adminRectificationPhotos, 'admin-verification': adminVerificationPhotos })[kind] }
function retryUpload(kind, index) { const target = targetForKind(kind); const photo = target?.value?.[index]; if (!photo?.localPath) return; photo.uploadState = 'pending'; drainUploads(kind, target) }
function uploadedIds(target) { return target.value.map((photo) => photo.fileId).filter(Boolean) }
function uploadsReady(target, required) { return (!required || target.value.length > 0) && target.value.every((photo) => photo.fileId && !photo.uploading && photo.uploadState !== 'failed') }

async function submitRectification() {
	if (!rectificationNote.value.trim()) return uni.showToast({ title: '请填写实际整改措施', icon: 'none' })
	if (!uploadsReady(rectificationPhotos, true)) return uni.showToast({ title: '请上传至少 1 张整改后照片', icon: 'none' })
	saving.value = true
	try { const res = await submitStationSafetyRectificationV1(props.hazardId, { rectification_note: rectificationNote.value, rectification_photo_file_ids: uploadedIds(rectificationPhotos) }); if (res?.code !== 0) throw new Error(res?.msg); uni.showToast({ title: '整改已提交', icon: 'success' }); await loadDetail() }
	catch (err) { uni.showToast({ title: err?.message || '提交失败', icon: 'none' }) }
	finally { saving.value = false }
}

async function verify() {
	if (!verificationNote.value.trim()) return uni.showToast({ title: '请填写验证结论', icon: 'none' })
	if (!uploadsReady(verificationPhotos, false)) return uni.showToast({ title: '验证照片尚未上传完成', icon: 'none' })
	saving.value = true
	try { const res = await verifyStationSafetyHazardV1(props.hazardId, { verification_result: verificationResult.value, verification_note: verificationNote.value, verification_photo_file_ids: uploadedIds(verificationPhotos) }); if (res?.code !== 0) throw new Error(res?.msg); uni.showToast({ title: verificationResult.value === 'passed' ? '已验证关闭' : '已退回整改', icon: 'success' }); await loadDetail() }
	catch (err) { uni.showToast({ title: err?.message || '验证失败', icon: 'none' }) }
	finally { saving.value = false }
}

async function saveAdminOutcome() {
	if (!adminRectificationNote.value.trim()) return uni.showToast({ title: '请填写实际整改措施', icon: 'none' })
	if (!uploadsReady(adminRectificationPhotos, true)) return uni.showToast({ title: '整改照片需为1–3张且全部上传成功', icon: 'none' })
	if (hazard.value?.verified_at && !adminVerificationNote.value.trim()) return uni.showToast({ title: '请填写验证结论', icon: 'none' })
	if (hazard.value?.verified_at && !uploadsReady(adminVerificationPhotos, false)) return uni.showToast({ title: '验证照片尚未上传完成', icon: 'none' })
	saving.value = true
	try {
		const payload = {
			rectification_note: adminRectificationNote.value,
			rectification_photo_file_ids: uploadedIds(adminRectificationPhotos),
			...(hazard.value?.verified_at ? {
				verification_result: adminVerificationResult.value,
				verification_note: adminVerificationNote.value,
				verification_photo_file_ids: uploadedIds(adminVerificationPhotos)
			} : {})
		}
		const res = await updateStationSafetyHazardOutcomeV1(props.hazardId, payload)
		if (res?.code !== 0) throw new Error(res?.msg || '保存失败')
		uni.showToast({ title: '闭环内容已修改', icon: 'success' })
		await loadDetail()
	} catch (err) { uni.showToast({ title: err?.message || '保存失败', icon: 'none' }) }
	finally { saving.value = false }
}

function loadMore() { if (paging.value.hasMore && !loadingMore.value) { page.value += 1; loadList(false) } }
onMounted(() => props.hazardId ? loadDetail() : loadList(true))
defineExpose({ refresh: () => props.hazardId ? loadDetail() : loadList(true) })
</script>

<style scoped>
.state-card,.filter-card,.hazard-card,.detail-card { padding: 22rpx; border: 1rpx solid #d9e2ec; border-radius: 20rpx; background: #fff; }.state-card { text-align: center; color: #718096; }.state-card--error { color: #b91c1c; }.list-stack,.detail-stack { display: flex; flex-direction: column; gap: 16rpx; }
.input,.textarea { width: 100%; box-sizing: border-box; color: #243b53; border: 1rpx solid #cbd5e1; border-radius: 14rpx; background: #fff; font-size: 24rpx; }.input { min-height: 72rpx; padding: 0 16rpx; }.textarea { min-height: 160rpx; margin-top: 16rpx; padding: 16rpx; line-height: 1.55; }
.status-scroll { margin-top: 14rpx; white-space: nowrap; }.status-row { display: inline-flex; gap: 10rpx; }.filter-chip { padding: 10rpx 18rpx; color: #64748b; border-radius: 999rpx; background: #f1f5f9; font-size: 21rpx; }.filter-chip--active { color: #9a3412; background: #ffedd5; }
.search-button,.load-more,.primary-button { margin: 16rpx 0 0; width: 100%; min-height: 72rpx; color: #fff; border-radius: 14rpx; background: #c2410c; font-size: 24rpx; font-weight: 800; }.search-button::after,.load-more::after,.primary-button::after { border: 0; }
.hazard-card--major { border-color: #fca5a5; }.hazard-card__head,.detail-head { display: flex; justify-content: space-between; gap: 14rpx; }.hazard-card__no,.detail-no { color: #243b53; font-size: 25rpx; font-weight: 900; }.hazard-card__area { display: block; margin-top: 9rpx; color: #475569; font-size: 22rpx; }.hazard-card__issue { display: block; margin-top: 8rpx; color: #7f1d1d; font-size: 23rpx; line-height: 1.5; }.hazard-card__meta { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 12rpx; color: #64748b; font-size: 20rpx; }
.status-pill { flex: none; padding: 6rpx 13rpx; border-radius: 999rpx; font-size: 20rpx; }.status-pill--pending_rectification { color: #b45309; background: #fef3c7; }.status-pill--pending_verification { color: #1d4ed8; background: #dbeafe; }.status-pill--closed { color: #047857; background: #d1fae5; }.status-pill--cancelled { color: #64748b; background: #e2e8f0; }.overdue { color: #dc2626 !important; font-weight: 800; }
.detail-source { display: block; margin-top: 5rpx; color: #64748b; font-size: 20rpx; }.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18rpx; margin-top: 20rpx; }.detail-label,.detail-value { display: block; }.detail-label,.field-label { margin-top: 18rpx; color: #64748b; font-size: 20rpx; }.detail-value { margin-top: 5rpx; color: #243b53; font-size: 23rpx; line-height: 1.5; }.text-block { margin-top: 18rpx; }.card-title { color: #102a43; font-size: 27rpx; font-weight: 900; }.paragraph { display: block; margin-top: 12rpx; color: #334e68; font-size: 23rpx; line-height: 1.6; }
.photo-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10rpx; margin-top: 10rpx; }.photo { width: 100%; aspect-ratio: 1; border-radius: 12rpx; background: #e2e8f0; }.signature { width: 100%; height: 180rpx; margin-top: 10rpx; border: 1rpx solid #e2e8f0; border-radius: 12rpx; background: #fff; }.required { color: #dc2626; }
	.verification-options { display: grid; grid-template-columns: 1fr 1fr; gap: 12rpx; margin-top: 16rpx; }.verify-option { padding: 17rpx; text-align: center; color: #475569; border: 1rpx solid #cbd5e1; border-radius: 14rpx; }.verify-option--active { color: #047857; border-color: #10b981; background: #ecfdf5; }.verify-option--danger.verify-option--active { color: #b91c1c; border-color: #ef4444; background: #fef2f2; }
	.admin-link { margin: 18rpx 0 0; width: 100%; min-height: 66rpx; color: #9a3412; border: 1rpx solid #fdba74; border-radius: 14rpx; background: #fff7ed; font-size: 22rpx; }.admin-link::after { border: 0; }.admin-card { border-color: #c7d2fe; background: #f8faff; }.admin-hint { display: block; margin-top: 8rpx; color: #64748b; font-size: 20rpx; line-height: 1.5; }
</style>
