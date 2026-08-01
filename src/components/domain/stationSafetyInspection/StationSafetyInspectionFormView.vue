<template>
	<StationSafetyInspectionShell
		:title="editMode ? '超级管理员修改巡检单' : '填写厂站巡检单'"
		:subtitle="editMode ? '修改后不保留旧版本，但会记录操作日志' : '四个分区共36项，每项必须拍照'"
		:before-back="handleBack"
		back
	>
		<view v-if="loading" class="state-card">正在准备巡检表…</view>
		<view v-else-if="loadError" class="state-card state-card--error">
			<text>{{ loadError }}</text>
			<button class="minor-button" type="button" @click="load">重新加载</button>
		</view>
		<view v-else class="form-stack">
			<view class="overview-card">
				<view>
					<text class="overview-card__label">固定厂站</text>
					<text class="overview-card__value">{{ template.station.name }}</text>
					<text class="overview-card__meta">{{ template.station.id }} · {{ totalItems }} 项检查</text>
				</view>
				<view :class="['progress-badge', { 'progress-badge--done': completedItems === totalItems }]">
					{{ completedItems }}/{{ totalItems }}
				</view>
			</view>

			<scroll-view scroll-x class="area-tabs">
				<view class="area-tabs__row">
					<view
						v-for="(area, index) in areas"
						:key="area.code"
						:class="['area-tab', { 'area-tab--active': currentStep === index, 'area-tab--done': areaComplete(area) }]"
						@click="jumpTo(index)"
					>
						<text>{{ area.label }}</text>
						<text class="area-tab__count">{{ areaCompletedCount(area) }}/{{ area.items.length }}</text>
					</view>
					<view :class="['area-tab', { 'area-tab--active': currentStep === reviewStep }]" @click="jumpTo(reviewStep)">
						<text>复核提交</text>
						<text class="area-tab__count">{{ abnormalCount ? `${abnormalCount}项异常` : '待复核' }}</text>
					</view>
				</view>
			</scroll-view>

			<view v-for="(area, areaIndex) in areas" v-show="currentStep === areaIndex" :key="area.code" class="area-section">
				<view class="area-heading">
					<view>
						<text class="area-heading__title">{{ areaIndex + 1 }}. {{ area.label }}</text>
						<text class="area-heading__hint">每项选结果并上传 1–3 张现场照片</text>
					</view>
					<text class="area-heading__progress">{{ areaCompletedCount(area) }}/{{ area.items.length }}</text>
				</view>

				<view
					v-for="(item, itemIndex) in area.items"
					:key="item.item_code"
					:class="['item-card', { 'item-card--abnormal': item.result_code === 'abnormal' }]"
				>
					<view class="item-card__head">
						<text class="item-card__number">{{ itemIndex + 1 }}</text>
						<text class="item-card__title">{{ item.item_label }}</text>
						<text :class="['item-card__state', { 'item-card__state--done': !itemMessage(item) }]">
							{{ itemMessage(item) ? '待完成' : '已完成' }}
						</text>
					</view>
					<view class="result-options">
						<view :class="['result-option', { 'result-option--active': item.result_code === 'normal' }]" @click="selectResult(item, 'normal')">正常</view>
						<view :class="['result-option', 'result-option--danger', { 'result-option--active': item.result_code === 'abnormal' }]" @click="selectResult(item, 'abnormal')">异常</view>
					</view>

					<view class="field">
						<text class="field__label">现场照片 <text class="required">*</text></text>
						<StationSafetyPhotoField
							:model-value="item.photos"
							:max="3"
							@update:model-value="updatePhotos(item, $event)"
							@retry="retryPhoto(item, $event)"
						/>
					</view>

					<view v-if="item.result_code === 'abnormal'" class="hazard-fields">
						<view class="hazard-fields__title">隐患整改信息</view>
						<label class="field">
							<text class="field__label">隐患描述 <text class="required">*</text></text>
							<textarea v-model="item.issue_note" class="textarea" maxlength="500" placeholder="请描述异常位置、现象及现场情况" />
						</label>
						<view class="field">
							<text class="field__label">隐患等级 <text class="required">*</text></text>
							<view class="result-options result-options--level">
								<view :class="['result-option', { 'result-option--active': item.hazard_level === 'general' }]" @click="item.hazard_level = 'general'">一般</view>
								<view :class="['result-option', 'result-option--danger', { 'result-option--active': item.hazard_level === 'major' }]" @click="item.hazard_level = 'major'">重大</view>
							</view>
						</view>
						<label class="field">
							<text class="field__label">整改责任人 <text class="required">*</text></text>
							<input v-model="item.responsible_name" class="input" maxlength="50" placeholder="请填写责任人姓名" />
						</label>
						<label class="field">
							<text class="field__label">计划整改措施 <text class="required">*</text></text>
							<textarea v-model="item.planned_measure" class="textarea" maxlength="1000" placeholder="请填写整改措施" />
						</label>
						<view class="field">
							<text class="field__label">计划完成日期 <text class="required">*</text></text>
							<picker mode="date" :value="item.planned_complete_date" :start="today" @change="item.planned_complete_date = $event.detail.value">
								<view class="picker-value">{{ item.planned_complete_date || '请选择日期' }}</view>
							</picker>
						</view>
						<view class="field">
							<text class="field__label">责任人现场签认 <text class="required">*</text></text>
							<view v-if="item.responsible_signature_file_id" class="signature-preview">
								<image class="signature-preview__image" :src="item.signature_preview_url || item.responsible_signature_file_id" mode="aspectFit" />
								<button class="minor-button" type="button" @click="replaceSignature(item)">重新签名</button>
							</view>
							<view v-else>
								<StationSafetySignaturePad :ref="(value) => setSignatureRef(item.item_code, value)" @change="markDirty" />
								<button class="signature-button" :disabled="item.signature_uploading" type="button" @click="saveSignature(item)">
									{{ item.signature_uploading ? '签名上传中…' : '确认并上传签名' }}
								</button>
							</view>
						</view>
					</view>
					<text v-if="itemMessage(item)" class="item-error">{{ itemMessage(item) }}</text>
				</view>
			</view>

			<view v-show="currentStep === reviewStep" class="review-stack">
				<view class="review-card">
					<view :class="['overall-result', { 'overall-result--danger': abnormalCount }]">
						<text>整单结果</text>
						<text>{{ abnormalCount ? `有异常（${abnormalCount}项）` : '正常' }}</text>
					</view>
					<view v-for="(area, areaIndex) in areas" :key="`review-${area.code}`" class="review-area">
						<text class="review-area__title">{{ area.label }}</text>
						<view v-for="item in area.items" :key="item.item_code" :class="['review-row', { 'review-row--danger': item.result_code === 'abnormal' }]">
							<text class="review-row__label">{{ item.item_label }}</text>
							<text class="review-row__result">{{ item.result_code === 'abnormal' ? '异常' : item.result_code === 'normal' ? '正常' : '未填' }}</text>
							<text class="review-row__meta">{{ uploadedPhotoCount(item) }} 张照片</text>
							<button v-if="itemMessage(item)" class="review-row__edit" type="button" @click="jumpTo(areaIndex)">去补充</button>
						</view>
					</view>
				</view>
				<view class="review-card">
					<view v-if="editMode" class="datetime-grid">
						<view class="field"><text class="field__label">巡检日期</text><picker mode="date" :value="inspectionDate" @change="inspectionDate = $event.detail.value"><view class="picker-value">{{ inspectionDate }}</view></picker></view>
						<view class="field"><text class="field__label">巡检时间</text><picker mode="time" :value="inspectionTime" @change="inspectionTime = $event.detail.value"><view class="picker-value">{{ inspectionTime }}</view></picker></view>
					</view>
					<label class="field"><text class="field__label">巡检员</text><input v-model="inspectorName" class="input" :disabled="!editMode" maxlength="50" /></label>
					<label class="field"><text class="field__label">备注</text><textarea v-model="remark" class="textarea" maxlength="1000" placeholder="选填" /></label>
				</view>
			</view>

			<view class="footer-actions">
				<button class="footer-button footer-button--secondary" :disabled="saving" type="button" @click="previous">{{ currentStep === 0 ? '返回' : '上一步' }}</button>
				<button class="footer-button footer-button--primary" :disabled="saving" type="button" @click="next">{{ primaryText }}</button>
			</view>
		</view>
	</StationSafetyInspectionShell>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBackPress } from '@dcloudio/uni-app'
import StationSafetyInspectionShell from './StationSafetyInspectionShell.vue'
import StationSafetyPhotoField from './StationSafetyPhotoField.vue'
import StationSafetySignaturePad from './StationSafetySignaturePad.vue'
import { getUser } from '@/services/auth'
import {
	getStationSafetyInspectionV1,
	getStationSafetyTemplateV1,
	submitStationSafetyInspectionV1,
	updateStationSafetyInspectionV1
} from '@/services/stationSafetyInspection'
import { resolveInspectionFileUrls, uploadStationSafetyImage } from '@/services/stationSafetyInspectionMedia'

const props = defineProps({ inspectionId: { type: String, default: '' } })
const editMode = computed(() => Boolean(props.inspectionId))
const loading = ref(true)
const loadError = ref('')
const template = ref({ station: {}, areas: [] })
const areas = ref([])
const currentStep = ref(0)
const saving = ref(false)
const inspectorName = ref('')
const remark = ref('')
const clientSubmissionId = ref('')
const inspectionDate = ref('')
const inspectionTime = ref('')
const dirty = ref(false)
const submitted = ref(false)
const signatureRefs = new Map()
const uploadTasks = new Map()
let draftTimer = null
let allowNextBack = false

const today = formatDate(new Date())
const totalItems = computed(() => areas.value.reduce((sum, area) => sum + area.items.length, 0))
const reviewStep = computed(() => areas.value.length)
const flatItems = computed(() => areas.value.flatMap((area) => area.items))
const completedItems = computed(() => flatItems.value.filter((item) => !itemMessage(item)).length)
const abnormalCount = computed(() => flatItems.value.filter((item) => item.result_code === 'abnormal').length)
const primaryText = computed(() => saving.value ? '正在保存…' : currentStep.value === reviewStep.value ? (editMode.value ? '保存修改' : '确认提交') : '下一步')
const draftKey = computed(() => `station-safety-draft-v1:${getUser()?._id || 'anonymous'}:${props.inspectionId || 'new'}`)

function pad(value) { return String(value).padStart(2, '0') }
function formatDate(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
function formatTime(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}` }
function generateId() { return `station_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` }

function makeAreas(templateData) {
	return (templateData.areas || []).map((area) => ({
		code: area.code,
		label: area.label,
		items: (area.items || []).map((item) => ({
			item_code: item.code,
			item_label: item.label,
			result_code: '',
			issue_note: '',
			hazard_level: 'general',
			responsible_name: '',
			planned_measure: '',
			planned_complete_date: '',
			responsible_signature_file_id: '',
			signature_preview_url: '',
			signature_uploading: false,
			photos: []
		}))
	}))
}

function uploadedPhotoCount(item) { return (item.photos || []).filter((photo) => String(photo.fileId || '').startsWith('cloud://')).length }
function hasPendingUploads(item) { return (item.photos || []).some((photo) => photo.uploading || (photo.localPath && !photo.fileId) || photo.uploadState === 'failed') }

function itemMessage(item) {
	if (!item.result_code) return '请选择检查结果'
	if (!(item.photos || []).length) return '至少需要 1 张现场照片'
	if (hasPendingUploads(item) || uploadedPhotoCount(item) !== item.photos.length) return '照片尚未全部上传成功'
	if (item.result_code === 'abnormal') {
		if (!String(item.issue_note || '').trim()) return '请填写隐患描述'
		if (!['general', 'major'].includes(item.hazard_level)) return '请选择隐患等级'
		if (!String(item.responsible_name || '').trim()) return '请填写整改责任人'
		if (!String(item.planned_measure || '').trim()) return '请填写计划整改措施'
		if (!item.planned_complete_date) return '请选择计划完成日期'
		if (!item.responsible_signature_file_id) return '请上传责任人手写签名'
	}
	return ''
}

function areaCompletedCount(area) { return area.items.filter((item) => !itemMessage(item)).length }
function areaComplete(area) { return areaCompletedCount(area) === area.items.length }
function markDirty() { dirty.value = true }

function selectResult(item, result) {
	item.result_code = result
	if (result === 'normal') {
		item.issue_note = ''
		item.hazard_level = 'general'
		item.responsible_name = ''
		item.planned_measure = ''
		item.planned_complete_date = ''
		item.responsible_signature_file_id = ''
		item.signature_preview_url = ''
	}
	markDirty()
}

function setSignatureRef(code, value) { if (value) signatureRefs.set(code, value); else signatureRefs.delete(code) }
function replaceSignature(item) { item.responsible_signature_file_id = ''; item.signature_preview_url = ''; markDirty() }

async function saveSignature(item) {
	const signature = signatureRefs.get(item.item_code)
	if (!signature?.hasInk?.value) return uni.showToast({ title: '请先手写签名', icon: 'none' })
	item.signature_uploading = true
	try {
		const localPath = await signature.exportFile()
		const fileId = await uploadStationSafetyImage({ filePath: localPath, submissionId: clientSubmissionId.value, scope: `signature-${item.item_code}` })
		item.responsible_signature_file_id = fileId
		item.signature_preview_url = localPath
		markDirty()
		uni.showToast({ title: '签名已保存', icon: 'success' })
	} catch (error) {
		uni.showToast({ title: error?.message || '签名上传失败', icon: 'none' })
	} finally { item.signature_uploading = false }
}

function updatePhotos(item, photos) {
	item.photos = Array.isArray(photos) ? photos : []
	markDirty()
	drainUploads(item)
}

async function drainUploads(item) {
	if (uploadTasks.has(item.item_code)) return uploadTasks.get(item.item_code)
	const task = (async () => {
		while (true) {
			const index = (item.photos || []).findIndex((photo) => photo.localPath && !photo.fileId && photo.uploadState !== 'failed' && !photo.uploading)
			if (index < 0) break
			const photo = item.photos[index]
			photo.uploading = true; photo.uploadState = 'uploading'; photo.errorMessage = ''
			try {
				photo.fileId = await uploadStationSafetyImage({ filePath: photo.localPath, submissionId: clientSubmissionId.value, scope: item.item_code, index })
				photo.previewUrl = photo.previewUrl || photo.localPath
				photo.localPath = ''
				photo.uploading = false; photo.uploadState = 'uploaded'
			} catch (error) {
				photo.uploading = false; photo.uploadState = 'failed'; photo.errorMessage = error?.message || '上传失败'
			}
			areas.value = areas.value.slice()
		}
	})()
	uploadTasks.set(item.item_code, task)
	try { await task } finally { uploadTasks.delete(item.item_code) }
}

function retryPhoto(item, index) {
	const photo = item.photos?.[index]
	if (!photo?.localPath || photo.fileId) return
	photo.uploadState = 'pending'; photo.errorMessage = ''
	drainUploads(item)
}

function hydrateRecord(record) {
	const storedByCode = new Map((record.items || []).map((item) => [item.item_code, item]))
	areas.value = makeAreas(template.value).map((area) => ({
		...area,
		items: area.items.map((item) => {
			const stored = storedByCode.get(item.item_code) || {}
			return {
				...item,
				result_code: stored.result_code || '',
				issue_note: stored.issue_note || '',
				hazard_level: stored.hazard_level || 'general',
				responsible_name: stored.responsible_name || '',
				planned_measure: stored.planned_measure || '',
				planned_complete_date: stored.planned_complete_date || '',
				responsible_signature_file_id: stored.responsible_signature_file_id || '',
				photos: (stored.photo_file_ids || []).map((fileId) => ({ fileId, localPath: '', previewUrl: fileId, uploading: false, uploadState: 'uploaded', errorMessage: '' }))
			}
		})
	}))
	inspectorName.value = record.inspector_name || ''
	remark.value = record.remark || ''
	const date = new Date(Number(record.inspection_at || Date.now()))
	inspectionDate.value = formatDate(date)
	inspectionTime.value = formatTime(date)
}

async function resolvePreviews() {
	const ids = []
	for (const item of flatItems.value) {
		for (const photo of item.photos || []) if (photo.fileId) ids.push(photo.fileId)
		if (item.responsible_signature_file_id) ids.push(item.responsible_signature_file_id)
	}
	const map = await resolveInspectionFileUrls(ids)
	for (const item of flatItems.value) {
		item.photos = item.photos.map((photo) => ({ ...photo, previewUrl: map[photo.fileId] || photo.previewUrl }))
		item.signature_preview_url = map[item.responsible_signature_file_id] || item.signature_preview_url
	}
}

function restoreDraft() {
	if (editMode.value) return false
	try {
		const draft = uni.getStorageSync(draftKey.value)
		if (!draft || draft.template_code !== template.value.template_code || Number(draft.template_version) !== Number(template.value.template_version)) return false
		const savedByCode = new Map((draft.items || []).map((item) => [item.item_code, item]))
		for (const item of flatItems.value) {
			const saved = savedByCode.get(item.item_code)
			if (!saved) continue
			Object.assign(item, saved, { signature_uploading: false, photos: (saved.photos || []).map((photo) => ({ ...photo, uploading: false })) })
		}
		clientSubmissionId.value = draft.client_submission_id || clientSubmissionId.value
		remark.value = draft.remark || ''
		currentStep.value = Math.min(Math.max(Number(draft.current_step || 0), 0), reviewStep.value)
		return true
	} catch (_) { return false }
}

function saveDraft() {
	if (editMode.value || submitted.value || !template.value.template_code) return
	try {
		uni.setStorageSync(draftKey.value, {
			template_code: template.value.template_code,
			template_version: template.value.template_version,
			client_submission_id: clientSubmissionId.value,
			remark: remark.value,
			current_step: currentStep.value,
			items: flatItems.value.map((item) => ({
				item_code: item.item_code,
				result_code: item.result_code,
				issue_note: item.issue_note,
				hazard_level: item.hazard_level,
				responsible_name: item.responsible_name,
				planned_measure: item.planned_measure,
				planned_complete_date: item.planned_complete_date,
				responsible_signature_file_id: item.responsible_signature_file_id,
				signature_preview_url: item.signature_preview_url,
				photos: item.photos
			})),
			saved_at: Date.now()
		})
	} catch (_) { /* storage quota is non-fatal */ }
}

async function load() {
	loading.value = true; loadError.value = ''
	try {
		const recordRes = editMode.value ? await getStationSafetyInspectionV1(props.inspectionId) : null
		if (recordRes && recordRes.code !== 0) throw new Error(recordRes.msg || '巡检单加载失败')
		const templateRes = await getStationSafetyTemplateV1(recordRes ? { templateCode: recordRes.data.template_code, templateVersion: recordRes.data.template_version } : {})
		if (templateRes?.code !== 0) throw new Error(templateRes?.msg || '巡检模板加载失败')
		template.value = templateRes.data
		areas.value = makeAreas(template.value)
		const user = getUser() || {}
		inspectorName.value = user.nickname || user.username || ''
		clientSubmissionId.value = generateId()
		const now = new Date()
		inspectionDate.value = formatDate(now); inspectionTime.value = formatTime(now)
		if (recordRes) hydrateRecord(recordRes.data)
		else if (restoreDraft()) uni.showToast({ title: '已恢复未提交草稿', icon: 'none' })
		await resolvePreviews()
		dirty.value = false
	} catch (error) { loadError.value = error?.message || '巡检表加载失败' }
	finally { loading.value = false }
}

function jumpTo(step) { currentStep.value = Math.min(Math.max(step, 0), reviewStep.value) }
function previous() {
	if (currentStep.value === 0) return handleBack().then((allowed) => { if (allowed !== false) uni.navigateBack() })
	currentStep.value -= 1
}

function firstInvalid() {
	for (let areaIndex = 0; areaIndex < areas.value.length; areaIndex += 1) {
		const item = areas.value[areaIndex].items.find((entry) => itemMessage(entry))
		if (item) return { areaIndex, item, message: itemMessage(item) }
	}
	return null
}

function buildItemPayload(item) {
	return {
		item_code: item.item_code,
		result_code: item.result_code,
		issue_note: item.issue_note,
		hazard_level: item.hazard_level,
		responsible_name: item.responsible_name,
		planned_measure: item.planned_measure,
		planned_complete_date: item.planned_complete_date,
		responsible_signature_file_id: item.responsible_signature_file_id,
		photo_file_ids: item.photos.map((photo) => photo.fileId).filter(Boolean)
	}
}

function inspectionTimestamp() {
	const value = Date.parse(`${inspectionDate.value}T${inspectionTime.value}:00+08:00`)
	return Number.isFinite(value) ? value : Date.now()
}

async function submit() {
	const invalid = firstInvalid()
	if (invalid) { currentStep.value = invalid.areaIndex; return uni.showToast({ title: invalid.message, icon: 'none' }) }
	if (!String(inspectorName.value || '').trim()) return uni.showToast({ title: '巡检员姓名不能为空', icon: 'none' })
	saving.value = true
	try {
		const payload = {
			...(editMode.value ? { _id: props.inspectionId, inspection_at: inspectionTimestamp() } : { client_submission_id: clientSubmissionId.value }),
			template_code: template.value.template_code,
			template_version: template.value.template_version,
			inspector_name: inspectorName.value,
			remark: remark.value,
			items: flatItems.value.map(buildItemPayload)
		}
		const res = editMode.value ? await updateStationSafetyInspectionV1(payload) : await submitStationSafetyInspectionV1(payload)
		if (res?.code !== 0) throw new Error(res?.msg || '保存失败')
		submitted.value = true; dirty.value = false
		if (!editMode.value) uni.removeStorageSync(draftKey.value)
		uni.showToast({ title: editMode.value ? '修改已保存' : '巡检单已提交', icon: 'success' })
		setTimeout(() => uni.redirectTo({ url: `/pages/station-safety-inspection/detail?id=${encodeURIComponent(res.data?._id || props.inspectionId)}` }), 500)
	} catch (error) { uni.showToast({ title: error?.message || '保存失败', icon: 'none' }) }
	finally { saving.value = false }
}

async function next() {
	if (saving.value) return
	if (currentStep.value < reviewStep.value) {
		const area = areas.value[currentStep.value]
		const invalid = area.items.find((item) => itemMessage(item))
		if (invalid) return uni.showToast({ title: itemMessage(invalid), icon: 'none' })
		currentStep.value += 1; return
	}
	await submit()
}

async function handleBack() {
	if (!dirty.value || submitted.value) { allowNextBack = true; return true }
	if (!editMode.value) saveDraft()
	return new Promise((resolve) => {
		uni.showModal({
			title: '退出巡检',
			content: editMode.value ? '尚有修改未保存，确认退出吗？' : '已自动保存草稿，下次可继续填写。确认退出吗？',
			success: (res) => { allowNextBack = Boolean(res.confirm); resolve(Boolean(res.confirm)) },
			fail: () => resolve(false)
		})
	})
}

watch([areas, remark, currentStep], () => {
	if (loading.value) return
	markDirty()
	clearTimeout(draftTimer)
	draftTimer = setTimeout(saveDraft, 400)
}, { deep: true })

onBackPress(() => {
	if (allowNextBack) { allowNextBack = false; return false }
	handleBack().then((allowed) => { if (allowed) uni.navigateBack() })
	return true
})
onMounted(load)
onBeforeUnmount(() => { clearTimeout(draftTimer); saveDraft() })
</script>

<style scoped>
.form-stack, .review-stack { display: flex; flex-direction: column; gap: 20rpx; }
.state-card, .overview-card, .area-heading, .item-card, .review-card { padding: 24rpx; border: 1rpx solid #d9e2ec; border-radius: 22rpx; background: #fff; box-shadow: 0 8rpx 20rpx rgba(15,23,42,.04); }
.state-card--error { color: #b91c1c; }
.overview-card { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; }
.overview-card__label, .overview-card__value, .overview-card__meta { display: block; }
.overview-card__label { color: #64748b; font-size: 21rpx; }
.overview-card__value { margin-top: 6rpx; color: #102a43; font-size: 27rpx; font-weight: 800; }
.overview-card__meta { margin-top: 6rpx; color: #64748b; font-size: 22rpx; }
.progress-badge { flex: none; padding: 12rpx 18rpx; color: #9a3412; border-radius: 20rpx; background: #ffedd5; font-size: 25rpx; font-weight: 800; }
.progress-badge--done { color: #047857; background: #d1fae5; }
.area-tabs { width: 100%; white-space: nowrap; }
.area-tabs__row { display: inline-flex; gap: 12rpx; padding-bottom: 4rpx; }
.area-tab { display: inline-flex; flex-direction: column; gap: 4rpx; min-width: 180rpx; padding: 16rpx 20rpx; color: #52667a; border: 1rpx solid #d9e2ec; border-radius: 18rpx; background: #fff; font-size: 24rpx; }
.area-tab--active { color: #9a3412; border-color: #fdba74; background: #fff7ed; }
.area-tab--done { color: #047857; border-color: #a7f3d0; }
.area-tab__count { font-size: 20rpx; opacity: .75; }
.area-section { display: flex; flex-direction: column; gap: 18rpx; }
.area-heading { display: flex; justify-content: space-between; align-items: center; }
.area-heading__title, .area-heading__hint { display: block; }
.area-heading__title { color: #102a43; font-size: 30rpx; font-weight: 900; }
.area-heading__hint { margin-top: 6rpx; color: #718096; font-size: 21rpx; }
.area-heading__progress { color: #9a3412; font-weight: 800; }
.item-card { transition: border-color .2s; }
.item-card--abnormal { border-color: #fecaca; background: #fffafa; }
.item-card__head { display: flex; align-items: flex-start; gap: 12rpx; }
.item-card__number { flex: none; width: 42rpx; height: 42rpx; line-height: 42rpx; text-align: center; color: #9a3412; border-radius: 50%; background: #ffedd5; font-size: 22rpx; font-weight: 800; }
.item-card__title { flex: 1; color: #243b53; font-size: 27rpx; font-weight: 800; line-height: 1.55; }
.item-card__state { flex: none; color: #b45309; font-size: 20rpx; }
.item-card__state--done { color: #047857; }
.result-options { display: grid; grid-template-columns: 1fr 1fr; gap: 14rpx; margin-top: 20rpx; }
.result-option { padding: 18rpx; text-align: center; color: #475569; border: 2rpx solid #cbd5e1; border-radius: 16rpx; background: #fff; font-size: 26rpx; font-weight: 700; }
.result-option--active { color: #047857; border-color: #10b981; background: #ecfdf5; }
.result-option--danger.result-option--active { color: #b91c1c; border-color: #ef4444; background: #fef2f2; }
.result-options--level { margin-top: 0; }
.field { display: block; margin-top: 20rpx; }
.field__label { display: block; margin-bottom: 10rpx; color: #334e68; font-size: 24rpx; font-weight: 700; }
.required { color: #dc2626; }
.input, .textarea, .picker-value { width: 100%; box-sizing: border-box; color: #102a43; border: 1rpx solid #bcccdc; border-radius: 14rpx; background: #fff; font-size: 25rpx; }
.input, .picker-value { min-height: 76rpx; padding: 0 18rpx; line-height: 76rpx; }
.textarea { min-height: 150rpx; padding: 16rpx 18rpx; line-height: 1.55; }
.hazard-fields { margin-top: 22rpx; padding: 20rpx; border-radius: 18rpx; background: #fff1f2; }
.hazard-fields__title { color: #9f1239; font-size: 25rpx; font-weight: 900; }
.signature-preview { padding: 12rpx; border: 1rpx solid #d9e2ec; border-radius: 16rpx; background: #fff; }
.signature-preview__image { width: 100%; height: 200rpx; }
.signature-button, .minor-button { margin: 14rpx 0 0; padding: 0 18rpx; min-height: 68rpx; color: #9a3412; border: 1rpx solid #fdba74; border-radius: 14rpx; background: #fff7ed; font-size: 23rpx; }
.signature-button::after, .minor-button::after { border: 0; }
.item-error { display: block; margin-top: 16rpx; color: #b91c1c; font-size: 22rpx; }
.overall-result { display: flex; justify-content: space-between; padding: 20rpx; color: #047857; border-radius: 18rpx; background: #ecfdf5; font-size: 27rpx; font-weight: 900; }
.overall-result--danger { color: #b91c1c; background: #fef2f2; }
.review-area { margin-top: 22rpx; }
.review-area__title { color: #102a43; font-size: 27rpx; font-weight: 900; }
.review-row { display: grid; grid-template-columns: 1fr auto; gap: 6rpx 16rpx; margin-top: 12rpx; padding: 16rpx; border-radius: 14rpx; background: #f8fafc; }
.review-row--danger { background: #fff1f2; }
.review-row__label { color: #334e68; font-size: 23rpx; }
.review-row__result { color: #047857; font-weight: 800; }
.review-row--danger .review-row__result { color: #b91c1c; }
.review-row__meta { color: #64748b; font-size: 20rpx; }
.review-row__edit { grid-column: 2; grid-row: 2; margin: 0; padding: 0; color: #c2410c; background: transparent; font-size: 21rpx; line-height: 1.4; }
.review-row__edit::after { border: 0; }
.datetime-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; }
.footer-actions { position: sticky; bottom: 0; z-index: 4; display: grid; grid-template-columns: .8fr 1.2fr; gap: 14rpx; padding: 16rpx; border-radius: 20rpx; background: rgba(255,255,255,.96); box-shadow: 0 -8rpx 24rpx rgba(15,23,42,.08); }
.footer-button { margin: 0; min-height: 82rpx; border-radius: 16rpx; font-size: 27rpx; font-weight: 800; }
.footer-button::after { border: 0; }
.footer-button--secondary { color: #475569; background: #e2e8f0; }
.footer-button--primary { color: #fff; background: #c2410c; }
</style>
