<template>
	<HomeSafetyInspectionShell
		:title="editMode ? '管理员修改巡检单' : '填写巡检单'"
		:subtitle="editMode ? '修改前版本将完整留存' : '逐项完成检查，照片会即时上传'"
		:before-back="handleHeaderBack"
		back
	>
		<view v-if="loading" class="state-card">正在准备巡检表单…</view>
		<view v-else-if="loadError" class="state-card state-card--error">
			<text>{{ loadError }}</text>
			<button class="retry-button" type="button" @click="load">重新加载</button>
		</view>
		<view v-else class="form-stack">
			<view class="wizard-card">
				<view class="phase-row">
					<view
						v-for="(phase, index) in phases"
						:key="phase"
						:class="['phase', activePhase === index ? 'phase--active' : '', activePhase > index ? 'phase--done' : '']"
					>
						<text class="phase__dot">{{ activePhase > index ? '✓' : index + 1 }}</text>
						<text class="phase__label">{{ phase }}</text>
					</view>
				</view>
				<view v-if="activePhase === 1" class="item-progress">
					<view class="item-progress__labels">
						<text>检查项目 {{ currentItemIndex + 1 }}/{{ items.length }}</text>
						<text>已完成 {{ completedItemCount }} 项</text>
					</view>
					<view class="item-progress__track">
						<view class="item-progress__bar" :style="{ width: `${inspectionProgress}%` }"></view>
					</view>
				</view>
			</view>

			<view v-show="currentStep === 0" class="section-card">
				<view class="section-title">
					<text class="section-title__number">1</text>
					<view>
						<text class="section-title__main">时间与地点</text>
						<text class="section-title__hint">{{ editMode ? '超级管理员可修改业务时间和客户' : '首次提交时间由服务端生成' }}</text>
					</view>
				</view>

				<view class="field">
					<text class="field__label">客户 <text class="required">*</text></text>
					<view class="customer-value">
						<text class="customer-value__name">{{ selectedCustomer?.name || '-' }}</text>
						<text class="customer-value__address">{{ selectedCustomer?.address || '客户档案暂无地址' }}</text>
					</view>
					<button v-if="editMode" class="minor-button" type="button" @click="customerPickerOpen = !customerPickerOpen">
						{{ customerPickerOpen ? '收起客户选择' : '更换客户' }}
					</button>
				</view>

				<view v-if="editMode && customerPickerOpen" class="customer-picker">
					<view class="customer-picker__search">
						<input v-model="customerKeyword" class="input" placeholder="搜索未隐藏客户" confirm-type="search" @confirm="searchCustomers" />
						<button class="minor-button" type="button" @click="searchCustomers">搜索</button>
					</view>
					<view v-for="customer in customerOptions" :key="customer._id" class="customer-option" @click="selectCustomer(customer)">
						<text class="customer-option__name">{{ customer.name }}</text>
						<text class="customer-option__address">{{ customer.address || '暂无地址' }}</text>
					</view>
				</view>

				<view v-if="editMode" class="datetime-grid">
					<view class="field">
						<text class="field__label">巡检日期 <text class="required">*</text></text>
						<picker mode="date" :value="inspectionDate" @change="inspectionDate = $event.detail.value">
							<view class="picker-value">{{ inspectionDate }}</view>
						</picker>
					</view>
					<view class="field">
						<text class="field__label">巡检时间 <text class="required">*</text></text>
						<picker mode="time" :value="inspectionTime" @change="inspectionTime = $event.detail.value">
							<view class="picker-value">{{ inspectionTime }}</view>
						</picker>
					</view>
				</view>

				<view class="field">
					<text class="field__label">本次实际地点 <text class="required">*</text></text>
					<textarea
						v-model="locationText"
						class="textarea textarea--short"
						maxlength="200"
						placeholder="请输入客户现场实际地址"
						@input="markLocationTextEdited"
					/>
					<text class="field__tip">客户档案有地址时自动带入；档案为空时自动填入定位地址。可现场修正，不会反写客户档案。</text>
				</view>

				<view class="location-row">
					<view>
						<text class="location-row__label">手机定位凭证</text>
						<text :class="['location-row__state', locationCapture.status === 'ok' ? 'location-row__state--ok' : '']">
							{{ locationStatusText }}
						</text>
						<text
							v-if="locationAddressStatusText"
							:class="['location-row__state', geocodeStatus === 'success' ? 'location-row__state--ok' : '']"
						>
							{{ locationAddressStatusText }}
						</text>
					</view>
					<button class="minor-button" :disabled="locating || geocoding" type="button" @click="locate">
						{{ locationButtonText }}
					</button>
				</view>
			</view>

			<view
				v-for="(item, itemIndex) in items"
				v-show="currentStep === itemIndex + 1"
				:key="item.item_code"
				:class="['section-card', 'inspection-page', itemIsAbnormal(item) ? 'inspection-page--danger' : '']"
			>
				<view class="section-title">
					<text class="section-title__number">{{ itemIndex + 1 }}</text>
					<view>
						<text class="section-title__main">{{ item.item_label }}</text>
						<text class="section-title__hint">请选择所有检查结果，并上传 1–3 张现场照片</text>
					</view>
				</view>
				<text v-if="item.description" class="inspection-description">{{ item.description }}</text>

				<view
					v-for="check in visibleChecks(item)"
					:key="check.code"
					class="check-block"
				>
					<text class="check-block__label">{{ check.label || '检查结果' }} <text class="required">*</text></text>
					<view class="option-grid">
						<view
							v-for="option in check.options"
							:key="option.code"
							:class="[
								'option-button',
								answerCode(item, check) === option.code ? 'option-button--active' : '',
								answerCode(item, check) === option.code && option.is_abnormal ? 'option-button--danger' : ''
							]"
							@click="selectCheckOption(item, check, option.code)"
						>
							<text class="option-button__dot"></text>
							<text>{{ option.label }}</text>
						</view>
					</view>
				</view>

				<view v-if="itemIsAbnormal(item)" class="field abnormal-note">
					<text class="field__label">问题说明 <text class="required">*</text></text>
					<textarea v-model="item.issue_note" class="textarea" maxlength="500" placeholder="请描述异常位置、现象及现场处置情况" />
				</view>

				<view class="field">
					<text class="field__label">现场照片 <text class="required">*</text></text>
					<HomeSafetyInspectionPhotoField
						:model-value="item.photos"
						:max="item.max_photos"
						@update:model-value="updateItemPhotos(item, $event)"
						@retry="retryPhotoUpload(item, $event)"
					/>
				</view>

				<view :class="['item-state', itemValidationMessage(item) ? '' : 'item-state--ok']">
					<text>{{ itemValidationMessage(item) || '本项已完成，可以进入下一项' }}</text>
				</view>
			</view>

			<view v-show="currentStep === finalStep" class="review-stack">
				<view class="section-card">
					<view class="section-title">
						<text class="section-title__number">3</text>
						<view>
							<text class="section-title__main">检查结果复核</text>
							<text class="section-title__hint">点击任一项目可返回修改</text>
						</view>
					</view>

					<view :class="['overall-result', overallResult === 'abnormal' ? 'overall-result--danger' : '']">
						<text>整单结果</text>
						<text>{{ overallResult === 'abnormal' ? '有异常' : '正常' }}</text>
					</view>

					<view
						v-for="(item, itemIndex) in items"
						:key="`review-${item.item_code}`"
						:class="[
							'review-item',
							itemIsAbnormal(item) ? 'review-item--danger' : '',
							itemIsNotApplicable(item) ? 'review-item--neutral' : ''
						]"
						@click="jumpToItem(itemIndex)"
					>
						<view class="review-item__heading">
							<text class="review-item__number">{{ itemIndex + 1 }}</text>
							<text class="review-item__title">{{ item.item_label }}</text>
							<text
								:class="[
									'review-item__result',
									itemIsAbnormal(item) ? 'review-item__result--danger' : '',
									itemIsNotApplicable(item) ? 'review-item__result--neutral' : ''
								]"
							>
								{{ itemResultLabel(item) }}
							</text>
						</view>
						<text v-for="line in answerSummary(item)" :key="line" class="review-item__answer">{{ line }}</text>
						<text class="review-item__meta">现场照片 {{ uploadedPhotoCount(item) }} 张</text>
						<text v-if="item.issue_note" class="review-item__note">问题说明：{{ item.issue_note }}</text>
					</view>
				</view>

				<view class="section-card">
					<view class="section-title">
						<text class="section-title__number">✓</text>
						<view>
							<text class="section-title__main">双方电子签名</text>
							<text class="section-title__hint">双方姓名和手写签名均必填</text>
						</view>
					</view>

					<view class="signature-block">
						<view class="field">
							<text class="field__label">客户现场人员姓名 <text class="required">*</text></text>
							<input v-model="customerSignerName" class="input" maxlength="50" placeholder="请输入现场签名人姓名" />
						</view>
						<text class="signature-block__title">客户现场人员手写签名 <text class="required">*</text></text>
						<view v-if="customerSignatureFileId && !replaceCustomerSignature" class="existing-signature">
							<image class="existing-signature__image" :src="customerSignaturePreview" mode="aspectFit" @click="previewSignature(customerSignaturePreview)" />
							<button class="minor-button" type="button" @click="replaceCustomerSignature = true">重新签名</button>
						</view>
						<HomeSafetyInspectionSignaturePad
							v-else
							ref="customerSignaturePad"
							@change="customerSignatureHasInk = $event"
						/>
					</view>

					<view class="signature-block">
						<view class="field">
							<text class="field__label">巡检员 <text class="required">*</text></text>
							<input
								v-model="inspectorName"
								class="input"
								maxlength="50"
								:disabled="!editMode"
								placeholder="巡检员姓名"
							/>
							<text v-if="!editMode" class="field__tip">身份由当前登录账号带出。</text>
						</view>
						<text class="signature-block__title">巡检员本人手写签名 <text class="required">*</text></text>
						<view v-if="inspectorSignatureFileId && !replaceInspectorSignature" class="existing-signature">
							<image class="existing-signature__image" :src="inspectorSignaturePreview" mode="aspectFit" @click="previewSignature(inspectorSignaturePreview)" />
							<button class="minor-button" type="button" @click="replaceInspectorSignature = true">重新签名</button>
						</view>
						<HomeSafetyInspectionSignaturePad
							v-else
							ref="inspectorSignaturePad"
							@change="inspectorSignatureHasInk = $event"
						/>
					</view>
				</view>

				<view v-if="editMode" class="section-card section-card--admin">
					<text class="admin-title">管理员修改原因 <text class="required">*</text></text>
					<textarea
						v-model="editReason"
						class="textarea"
						maxlength="500"
						placeholder="请说明本次修改原因；原版本会自动保留"
					/>
				</view>
			</view>

			<view class="wizard-footer">
				<button
					class="wizard-footer__button wizard-footer__button--secondary"
					:disabled="saving"
					type="button"
					@click="goPrevious"
				>
					{{ currentStep === 0 ? '返回' : '上一步' }}
				</button>
				<button
					class="wizard-footer__button wizard-footer__button--primary"
					:disabled="saving"
					type="button"
					@click="goNext"
				>
					{{ primaryButtonText }}
				</button>
			</view>
		</view>
	</HomeSafetyInspectionShell>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBackPress } from '@dcloudio/uni-app'
import HomeSafetyInspectionShell from './HomeSafetyInspectionShell.vue'
import HomeSafetyInspectionPhotoField from './HomeSafetyInspectionPhotoField.vue'
import HomeSafetyInspectionSignaturePad from './HomeSafetyInspectionSignaturePad.vue'
import { getUser } from '@/services/auth'
import {
	getHomeSafetyInspectionV1,
	getHomeSafetyTemplateV1,
	getVisibleHomeSafetyCustomerV1,
	listHomeSafetyCustomersV1,
	reverseGeocodeHomeSafetyLocationV1,
	submitHomeSafetyInspectionV1,
	updateHomeSafetyInspectionV1
} from '@/services/homeSafetyInspection'
import {
	resolveInspectionFileUrls,
	uploadInspectionImage
} from '@/services/homeSafetyInspectionMedia'
import { captureWgs84Location } from '@/services/homeSafetyInspectionLocation'
import {
	canApplyGeocodedAddress,
	restoredLocationText,
	shouldInvalidateAutomaticAddress
} from '@/services/homeSafetyInspectionLocationPolicy.mjs'

const props = defineProps({
	customerId: { type: String, default: '' },
	inspectionId: { type: String, default: '' },
	editMode: { type: Boolean, default: false }
})

const DRAFT_PREFIX = 'home_safety_inspection_draft_v2'
const phases = ['现场信息', '逐项检查', '确认签名']
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const saveProgress = ref('')
const template = ref(null)
const selectedCustomer = ref(null)
const locationText = ref('')
const locationCapture = ref({ status: 'not_requested', coordinate_type: 'wgs84' })
const locating = ref(false)
const geocoding = ref(false)
const geocodeStatus = ref('idle')
const geocodeMessage = ref('')
const geocodedLocationText = ref('')
const locationTextTouched = ref(false)
const locationAttemptMessage = ref('')
const items = ref([])
const currentStep = ref(0)
const customerSignerName = ref('')
const inspectorName = ref('')
const customerSignatureFileId = ref('')
const inspectorSignatureFileId = ref('')
const customerSignaturePreview = ref('')
const inspectorSignaturePreview = ref('')
const replaceCustomerSignature = ref(true)
const replaceInspectorSignature = ref(true)
const customerSignatureHasInk = ref(false)
const inspectorSignatureHasInk = ref(false)
const customerSignaturePad = ref(null)
const inspectorSignaturePad = ref(null)
const clientSubmissionId = ref(createSubmissionId())
const inspectionDate = ref('')
const inspectionTime = ref('')
const editReason = ref('')
const customerPickerOpen = ref(false)
const customerKeyword = ref('')
const customerOptions = ref([])
const draftReady = ref(false)
const draftRestored = ref(false)
const submitted = ref(false)
const initialProgressFingerprint = ref('')
const returnToReviewItemIndex = ref(-1)
const photoUploadTasks = new Map()
const currentUser = getUser() || {}
const draftOwner = String(currentUser._id || currentUser.username || 'anonymous')
	.replace(/[^a-zA-Z0-9_-]/g, '_')
let draftTimer = null
let autoLocationTimer = null
let allowBackOnce = false
let locationRequestSequence = 0
let disposed = false

const finalStep = computed(() => items.value.length + 1)
const activePhase = computed(() => {
	if (currentStep.value === 0) return 0
	if (currentStep.value >= finalStep.value) return 2
	return 1
})
const currentItemIndex = computed(() =>
	Math.min(Math.max(currentStep.value - 1, 0), Math.max(items.value.length - 1, 0))
)
const completedItemCount = computed(() =>
	items.value.filter((item) => !itemValidationMessage(item)).length
)
const inspectionProgress = computed(() => {
	if (!items.value.length) return 0
	return Math.round((completedItemCount.value / items.value.length) * 100)
})
const overallResult = computed(() =>
	items.value.some((item) => itemIsAbnormal(item)) ? 'abnormal' : 'normal'
)
const primaryButtonText = computed(() => {
	if (saving.value) return saveProgress.value || '处理中…'
	if (currentStep.value === finalStep.value) return props.editMode ? '保存修改' : '提交巡检单'
	if (
		returnToReviewItemIndex.value >= 0 &&
		returnToReviewItemIndex.value === currentStep.value - 1
	) {
		return '保存并返回复核'
	}
	if (currentStep.value === items.value.length) return '进入复核'
	return '下一步'
})
const locationStatusText = computed(() => {
	if (locationCapture.value.status === 'ok') {
		const rawLatitude = locationCapture.value.latitude
		const rawLongitude = locationCapture.value.longitude
		const latitude =
			rawLatitude !== null && rawLatitude !== undefined && rawLatitude !== ''
				? Number(rawLatitude)
				: Number.NaN
		const longitude =
			rawLongitude !== null && rawLongitude !== undefined && rawLongitude !== ''
				? Number(rawLongitude)
				: Number.NaN
		const rawAccuracy = locationCapture.value.accuracy
		const accuracy =
			rawAccuracy !== null && rawAccuracy !== undefined && rawAccuracy !== ''
				? Number(rawAccuracy)
				: Number.NaN
		const coordinateText =
			Number.isFinite(latitude) && Number.isFinite(longitude)
				? `WGS84 纬度 ${latitude.toFixed(6)}，经度 ${longitude.toFixed(6)}`
				: 'WGS84 坐标已获取'
		const accuracyText = Number.isFinite(accuracy) ? `，精度约 ${Math.round(accuracy)} 米` : ''
		return `${coordinateText}${accuracyText}${locationAttemptMessage.value ? `；${locationAttemptMessage.value}` : ''}`
	}
	if (locationCapture.value.status === 'failed') return '定位失败，不影响提交，可重试'
	return props.editMode
		? '尚未定位，可按需获取定位凭证'
		: '正在进入表单后自动定位；如失败可重试'
})
const locationAddressStatusText = computed(() => {
	if (geocodeStatus.value === 'loading') return '正在将坐标转换为现场地址…'
	if (geocodeStatus.value === 'failed') {
		return geocodeMessage.value || '经纬度已保存，地址识别失败，可手工填写'
	}
	if (geocodeStatus.value !== 'success' || !geocodedLocationText.value) return ''
	if (locationTextTouched.value) return '定位地址已识别，已保留巡检员现场修正'
	if (String(selectedCustomer.value?.address || '').trim()) {
		return '定位地址已识别，本次地点优先采用客户档案地址'
	}
	if (String(locationText.value || '').trim() === geocodedLocationText.value) {
		return `已自动填入：${geocodedLocationText.value}`
	}
	return '定位地址已识别，客户或现场地点已变化，未自动覆盖'
})
const locationButtonText = computed(() => {
	if (locating.value) return '定位中…'
	if (geocoding.value) return '识别地址中…'
	return locationCapture.value.status === 'ok' ? '重新定位' : '尝试定位'
})
const draftStorageKey = computed(() => {
	const identity = props.editMode
		? `edit_${props.inspectionId || 'unknown'}`
		: `new_${props.customerId || selectedCustomer.value?._id || 'unknown'}`
	return `${DRAFT_PREFIX}:${draftOwner}:${identity}`
})
const hasPendingLocalPhotos = computed(() =>
	items.value.some((item) =>
		(item.photos || []).some((photo) => photo.localPath && !photo.fileId)
	)
)
const hasUnuploadedSignatureInk = computed(() =>
	(Boolean(customerSignatureHasInk.value) && replaceCustomerSignature.value) ||
	(Boolean(inspectorSignatureHasInk.value) && replaceInspectorSignature.value)
)
const hasMeaningfulDraft = computed(() => {
	if (!draftReady.value || submitted.value) return false
	if (draftRestored.value) return true
	return progressFingerprint() !== initialProgressFingerprint.value
})

function createSubmissionId() {
	return `hsi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function templateCodeOf(value) {
	return String(value?.template_code || value?.code || '')
}

function templateVersionOf(value) {
	return Number(value?.template_version ?? value?.version ?? 0)
}

function formatEditDateTime(timestamp) {
	const date = new Date(Number(timestamp || Date.now()))
	const pad = (value) => String(value).padStart(2, '0')
	return {
		date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
	}
}

function parseInspectionAt() {
	const value = new Date(`${inspectionDate.value}T${inspectionTime.value}:00`)
	return value.getTime()
}

function normalizeTemplateChecks(templateItem) {
	if (Array.isArray(templateItem?.checks) && templateItem.checks.length) {
		return templateItem.checks.map((check) => ({
			code: check.code,
			label: check.label || '',
			options: Array.isArray(check.options) ? check.options : [],
			visible_when: check.visible_when || null
		}))
	}
	return []
}

function makeTemplateItems(templateData) {
	return (templateData?.items || []).map((item) => ({
		item_code: item.code,
		item_label: item.label,
		description: item.description || '',
		checks: normalizeTemplateChecks(item),
		answers: [],
		options: Array.isArray(item.options) ? item.options : [],
		option_code: '',
		issue_note: '',
		min_photos: Math.max(Number(item.min_photos || 1), 1),
		max_photos: Math.min(Math.max(Number(item.max_photos || 3), 1), 3),
		photos: []
	}))
}

function legacyCheck(item) {
	return {
		code: '__legacy__',
		label: '检查结果',
		options: item.options || [],
		legacy: true
	}
}

function findAnswer(item, checkCode) {
	return (item.answers || []).find((answer) => answer.check_code === checkCode) || null
}

function answerCode(item, check) {
	if (check.legacy) return item.option_code || ''
	return findAnswer(item, check.code)?.option_code || ''
}

function checkIsVisible(item, check) {
	const rule = check?.visible_when
	if (!rule) return true
	const dependency = (item.checks || []).find((entry) => entry.code === rule.check_code)
	if (!dependency) return false
	return answerCode(item, dependency) === rule.option_code
}

function visibleChecks(item) {
	if (!Array.isArray(item?.checks) || !item.checks.length) return [legacyCheck(item)]
	return item.checks.filter((check) => checkIsVisible(item, check))
}

function selectedCheckOption(item, check) {
	const code = answerCode(item, check)
	return (check.options || []).find((option) => option.code === code) || null
}

function selectCheckOption(item, check, optionCode) {
	if (check.legacy) {
		item.option_code = optionCode
	} else {
		const existing = findAnswer(item, check.code)
		if (existing) existing.option_code = optionCode
		else item.answers.push({ check_code: check.code, option_code: optionCode })
		for (const candidate of item.checks || []) {
			if (candidate.visible_when && !checkIsVisible(item, candidate)) {
				const hiddenAnswer = findAnswer(item, candidate.code)
				if (hiddenAnswer) hiddenAnswer.option_code = ''
			}
		}
	}
	if (!itemIsAbnormal(item)) item.issue_note = ''
	items.value = items.value.slice()
}

function itemIsAbnormal(item) {
	return visibleChecks(item).some((check) => Boolean(selectedCheckOption(item, check)?.is_abnormal))
}

function itemResultLabel(item) {
	if (itemIsAbnormal(item)) return '异常'
	return itemIsNotApplicable(item) ? '不适用' : '正常'
}

function itemIsNotApplicable(item) {
	if (itemIsAbnormal(item)) return false
	const checks = visibleChecks(item)
	return checks.length > 0 && checks.every(
		(check) => selectedCheckOption(item, check)?.code === 'not_applicable'
	)
}

function uploadedPhotoCount(item) {
	return (item?.photos || []).filter((photo) => String(photo?.fileId || '').startsWith('cloud://')).length
}

function itemValidationMessage(item) {
	for (const check of visibleChecks(item)) {
		if (!selectedCheckOption(item, check)) {
			return `请选择“${check.label || item.item_label}”的检查结果`
		}
	}
	const photos = Array.isArray(item?.photos) ? item.photos : []
	if (photos.length < item.min_photos) return `至少需要 ${item.min_photos} 张现场照片`
	if (photos.length > item.max_photos) return `最多只能上传 ${item.max_photos} 张照片`
	if (photos.some((photo) => photo.uploading)) return '照片正在上传，请稍候'
	if (photos.some((photo) => photo.uploadState === 'failed')) return '存在上传失败的照片，请重试'
	if (uploadedPhotoCount(item) !== photos.length) return '照片尚未全部上传成功'
	if (itemIsAbnormal(item) && !String(item.issue_note || '').trim()) return '异常项目必须填写问题说明'
	return ''
}

function answerSummary(item) {
	return visibleChecks(item).map((check) => {
		const option = selectedCheckOption(item, check)
		if (check.legacy) return option?.label || '未选择'
		return `${check.label}：${option?.label || '未选择'}`
	})
}

async function refreshCloudPreviews() {
	const ids = []
	for (const item of items.value) {
		for (const photo of item.photos || []) {
			if (photo.fileId) ids.push(photo.fileId)
		}
	}
	ids.push(customerSignatureFileId.value, inspectorSignatureFileId.value)
	const map = await resolveInspectionFileUrls(ids)
	for (const item of items.value) {
		item.photos = (item.photos || []).map((photo) => ({
			...photo,
			previewUrl: map[photo.fileId] || photo.previewUrl || photo.fileId
		}))
	}
	customerSignaturePreview.value = map[customerSignatureFileId.value] || customerSignaturePreview.value || customerSignatureFileId.value
	inspectorSignaturePreview.value = map[inspectorSignatureFileId.value] || inspectorSignaturePreview.value || inspectorSignatureFileId.value
	items.value = items.value.slice()
}

async function resolveStoredFiles(record) {
	const byCode = new Map((record.items || []).map((item) => [item.item_code, item]))
	items.value = items.value.map((templateItem) => {
		const stored = byCode.get(templateItem.item_code) || {}
		const storedAnswers = Array.isArray(stored.answers) ? stored.answers : []
		return {
			...templateItem,
			item_label: stored.item_label_snapshot || templateItem.item_label,
			option_code: stored.option_code || '',
			answers: storedAnswers.map((answer) => ({
				check_code: answer.check_code,
				option_code: answer.option_code
			})),
			issue_note: stored.issue_note || '',
			photos: (stored.photo_file_ids || []).map((fileId) => ({
				fileId,
				localPath: '',
				previewUrl: fileId,
				uploading: false,
				uploadState: 'uploaded',
				errorMessage: ''
			}))
		}
	})
	customerSignatureFileId.value = record.customer_signature_file_id || ''
	inspectorSignatureFileId.value = record.inspector_signature_file_id || ''
	replaceCustomerSignature.value = !customerSignatureFileId.value
	replaceInspectorSignature.value = !inspectorSignatureFileId.value
	await refreshCloudPreviews()
}

async function loadNewForm(templateData) {
	if (!props.customerId) throw new Error('缺少客户信息')
	const customerRes = await getVisibleHomeSafetyCustomerV1(props.customerId)
	if (customerRes?.code !== 0) throw new Error(customerRes?.msg || '客户不可用')
	selectedCustomer.value = customerRes.data
	locationText.value = String(customerRes.data.address || '').trim()
	locationTextTouched.value = false
	geocodedLocationText.value = ''
	geocodeStatus.value = 'idle'
	geocodeMessage.value = ''
	items.value = makeTemplateItems(templateData)
	const user = getUser() || {}
	inspectorName.value = user.nickname || user.username || ''
	replaceCustomerSignature.value = true
	replaceInspectorSignature.value = true
}

async function loadEditForm(record) {
	if (!record.can_update) throw new Error('仅超级管理员可修改巡检单')
	selectedCustomer.value = {
		_id: record.customer_id,
		name: record.customer_name_snapshot || '',
		address: String(record.customer_address_snapshot || '').trim()
	}
	locationText.value = String(record.location_text || '').trim()
	locationTextTouched.value = false
	geocodedLocationText.value = ''
	geocodeStatus.value = 'idle'
	geocodeMessage.value = ''
	locationCapture.value = record.location_capture || { status: 'not_requested', coordinate_type: 'wgs84' }
	customerSignerName.value = record.customer_signer_name || ''
	inspectorName.value = record.inspector_name || record.inspector_username_snapshot || ''
	clientSubmissionId.value = record.client_submission_id || clientSubmissionId.value
	const parts = formatEditDateTime(record.inspection_at)
	inspectionDate.value = parts.date
	inspectionTime.value = parts.time
	items.value = makeTemplateItems(template.value)
	await resolveStoredFiles(record)
}

async function restoreDraft() {
	let raw = null
	try {
		raw = uni.getStorageSync(draftStorageKey.value)
	} catch (_) {
		return false
	}
	if (!raw || typeof raw !== 'object') return false
	if (
		raw.template_code !== templateCodeOf(template.value) ||
		Number(raw.template_version) !== templateVersionOf(template.value)
	) {
		return false
	}
	if (props.editMode && raw.selected_customer?._id) {
		let customerRes = null
		try {
			customerRes = await getVisibleHomeSafetyCustomerV1(raw.selected_customer._id)
		} catch (_) {
			uni.showToast({
				title: '草稿客户校验失败，已继续加载原巡检单',
				icon: 'none',
				duration: 3200
			})
			return false
		}
		if (customerRes?.code !== 0) {
			uni.showToast({
				title: '草稿中的客户已隐藏或不存在，本次未恢复该草稿',
				icon: 'none',
				duration: 3200
			})
			return false
		}
		selectedCustomer.value = customerRes.data
	}
	const draftLocationText =
		typeof raw.location_text === 'string' ? raw.location_text : locationText.value
	const currentCustomerAddress = String(selectedCustomer.value?.address || '').trim()
	const draftCustomerAddress = String(raw.selected_customer?.address || '').trim()
	locationText.value = restoredLocationText({
		currentCustomerAddress,
		draftCustomerAddress,
		draftLocationText,
		locationTextTouched: raw.location_text_touched
	})
	if (typeof raw.location_text_touched === 'boolean') {
		locationTextTouched.value = raw.location_text_touched
	} else {
		locationTextTouched.value =
			Boolean(String(locationText.value || '').trim()) &&
			String(locationText.value || '').trim() !== currentCustomerAddress
	}
	geocodedLocationText.value =
		typeof raw.geocoded_location_text === 'string' ? raw.geocoded_location_text : ''
	if (geocodedLocationText.value) geocodeStatus.value = 'success'
	if (raw.location_capture && typeof raw.location_capture === 'object') {
		locationCapture.value = raw.location_capture
	}
	if (raw.client_submission_id) clientSubmissionId.value = raw.client_submission_id
	const draftItems = new Map((raw.items || []).map((item) => [item.item_code, item]))
	items.value = items.value.map((item) => {
		const saved = draftItems.get(item.item_code)
		if (!saved) return item
		return {
			...item,
			option_code: saved.option_code || item.option_code,
			answers: Array.isArray(saved.answers)
				? saved.answers.map((answer) => ({
					check_code: answer.check_code,
					option_code: answer.option_code
				}))
				: item.answers,
			issue_note: saved.issue_note || '',
			photos: (saved.photo_file_ids || []).map((fileId) => ({
				fileId,
				localPath: '',
				previewUrl: fileId,
				uploading: false,
				uploadState: 'uploaded',
				errorMessage: ''
			}))
		}
	})
	customerSignerName.value = raw.customer_signer_name || customerSignerName.value
	inspectorName.value = raw.inspector_name || inspectorName.value
	customerSignatureFileId.value = raw.customer_signature_file_id || customerSignatureFileId.value
	inspectorSignatureFileId.value = raw.inspector_signature_file_id || inspectorSignatureFileId.value
	if (customerSignatureFileId.value) replaceCustomerSignature.value = false
	if (inspectorSignatureFileId.value) replaceInspectorSignature.value = false
	inspectionDate.value = raw.inspection_date || inspectionDate.value
	inspectionTime.value = raw.inspection_time || inspectionTime.value
	editReason.value = raw.edit_reason || ''
	currentStep.value = Math.min(Math.max(Number(raw.current_step || 0), 0), finalStep.value)
	draftRestored.value = true
	return true
}

function scheduleAutomaticLocation(callback) {
	if (autoLocationTimer) clearTimeout(autoLocationTimer)
	autoLocationTimer = setTimeout(() => {
		autoLocationTimer = null
		if (disposed) return
		void callback()
	}, 100)
}

async function load() {
	if (autoLocationTimer) {
		clearTimeout(autoLocationTimer)
		autoLocationTimer = null
	}
	loading.value = true
	loadError.value = ''
	draftReady.value = false
	try {
		if (props.editMode) {
			if (!props.inspectionId) throw new Error('缺少巡检单 ID')
			const recordRes = await getHomeSafetyInspectionV1(props.inspectionId)
			if (recordRes?.code !== 0) throw new Error(recordRes?.msg || '巡检单加载失败')
			const record = recordRes.data
			const templateRes = await getHomeSafetyTemplateV1({
				templateCode: record.template_code,
				templateVersion: record.template_version
			})
			if (templateRes?.code !== 0) {
				throw new Error(templateRes?.msg || '该巡检单模板无法识别，不能修改')
			}
			template.value = templateRes.data
			await loadEditForm(record)
		} else {
			const templateRes = await getHomeSafetyTemplateV1()
			if (templateRes?.code !== 0) throw new Error(templateRes?.msg || '巡检模板加载失败')
			template.value = templateRes.data
			await loadNewForm(templateRes.data)
		}
		const restored = await restoreDraft()
		if (restored) {
			await refreshCloudPreviews()
			uni.showToast({ title: '已恢复上次保存的草稿', icon: 'none' })
		}
		initialProgressFingerprint.value = progressFingerprint()
		draftReady.value = true
		if (!props.editMode && locationCapture.value.status === 'not_requested') {
			scheduleAutomaticLocation(locate)
		} else if (
			!props.editMode &&
			locationCapture.value.status === 'ok' &&
			!String(selectedCustomer.value?.address || '').trim() &&
			!String(locationText.value || '').trim()
		) {
			scheduleAutomaticLocation(resolveStoredLocationAddress)
		}
	} catch (err) {
		loadError.value = err?.message || '表单加载失败'
	} finally {
		loading.value = false
		if (!loadError.value) {
			setTimeout(refreshSignaturePads, 30)
		}
	}
}

async function resolveLocationAddress(captured, requestSequence, customerIdAtStart) {
	if (disposed) return
	geocoding.value = true
	geocodeStatus.value = 'loading'
	geocodeMessage.value = ''
	const previousGeocodedText = geocodedLocationText.value
	try {
		const response = await reverseGeocodeHomeSafetyLocationV1(captured)
		if (requestSequence !== locationRequestSequence) return
		if ((selectedCustomer.value?._id || '') !== customerIdAtStart) return
		const addressText = String(response?.data?.address_text || '').trim()
		if (response?.code !== 0 || !addressText) {
			geocodeStatus.value = 'failed'
			geocodeMessage.value =
				response?.msg || '经纬度已保存，地址识别失败，可手工填写'
			return
		}

		geocodedLocationText.value = addressText
		geocodeStatus.value = 'success'
		const customerAddress = String(selectedCustomer.value?.address || '').trim()
		const currentLocationText = String(locationText.value || '').trim()
		const canReplaceAutoText = canApplyGeocodedAddress({
			customerId: selectedCustomer.value?._id,
			requestCustomerId: customerIdAtStart,
			customerAddress,
			currentLocationText,
			previousGeocodedText,
			locationTextTouched: locationTextTouched.value
		})
		if (canReplaceAutoText) {
			locationText.value = addressText
		}
	} catch (_) {
		if (requestSequence !== locationRequestSequence) return
		geocodeStatus.value = 'failed'
		geocodeMessage.value = '经纬度已保存，地址识别失败，可手工填写'
	} finally {
		if (requestSequence === locationRequestSequence) geocoding.value = false
	}
}

function resolveStoredLocationAddress() {
	if (disposed || locating.value || geocoding.value || locationCapture.value.status !== 'ok') return
	const requestSequence = ++locationRequestSequence
	const customerIdAtStart = selectedCustomer.value?._id || ''
	void resolveLocationAddress({ ...locationCapture.value }, requestSequence, customerIdAtStart)
}

function invalidateAutomaticAddressForNewCapture() {
	const customerAddress = String(selectedCustomer.value?.address || '').trim()
	const currentLocationText = String(locationText.value || '').trim()
	const previousGeocodedText = String(geocodedLocationText.value || '').trim()
	if (shouldInvalidateAutomaticAddress({
		customerAddress,
		currentLocationText,
		previousGeocodedText,
		locationTextTouched: locationTextTouched.value
	})) {
		locationText.value = ''
	}
	geocodedLocationText.value = ''
	geocodeStatus.value = 'idle'
	geocodeMessage.value = ''
}

async function locate() {
	if (disposed || locating.value || geocoding.value) return
	const requestSequence = ++locationRequestSequence
	const customerIdAtStart = selectedCustomer.value?._id || ''
	const previousSuccessfulCapture =
		locationCapture.value.status === 'ok' ? { ...locationCapture.value } : null
	locating.value = true
	locationAttemptMessage.value = ''
	try {
		let captured
		try {
			captured = await captureWgs84Location()
		} catch (err) {
			captured = {
				status: 'failed',
				coordinate_type: 'wgs84',
				latitude: null,
				longitude: null,
				accuracy: null,
				error_code: 'location_exception',
				error_message: String(err?.message || '定位失败'),
				captured_at: Date.now(),
				source: 'home_safety_inspection_h5'
			}
		}
		if (requestSequence !== locationRequestSequence) return
		if (captured.status !== 'ok') {
			if (previousSuccessfulCapture) {
				locationCapture.value = previousSuccessfulCapture
				locationAttemptMessage.value = '本次重新定位失败，已保留上次成功坐标'
			} else {
				locationCapture.value = captured
				geocodeStatus.value = 'idle'
				geocodeMessage.value = ''
			}
			return
		}

		invalidateAutomaticAddressForNewCapture()
		locationCapture.value = captured
		locating.value = false
		await resolveLocationAddress(captured, requestSequence, customerIdAtStart)
	} finally {
		if (requestSequence === locationRequestSequence) locating.value = false
	}
}

function markLocationTextEdited() {
	locationTextTouched.value = true
}

async function searchCustomers() {
	const res = await listHomeSafetyCustomersV1({ keyword: customerKeyword.value, page: 1, pageSize: 20 })
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '客户搜索失败', icon: 'none' })
		return
	}
	customerOptions.value = Array.isArray(res.data) ? res.data : []
}

function selectCustomer(customer) {
	const previousAddress = selectedCustomer.value?.address || ''
	const currentLocationText = String(locationText.value || '').trim()
	const shouldPrefillAddress =
		!currentLocationText ||
		currentLocationText === String(previousAddress || '').trim() ||
		(!locationTextTouched.value &&
			currentLocationText === String(geocodedLocationText.value || '').trim())
	locationRequestSequence += 1
	locating.value = false
	geocoding.value = false
	geocodedLocationText.value = ''
	geocodeStatus.value = 'idle'
	geocodeMessage.value = ''
	locationAttemptMessage.value = ''
	const customerAddress = String(customer?.address || '').trim()
	selectedCustomer.value = { ...customer, address: customerAddress }
	if (shouldPrefillAddress) {
		locationText.value = customerAddress
		locationTextTouched.value = false
	}
	customerPickerOpen.value = false
}

function updateItemPhotos(item, photos) {
	item.photos = Array.isArray(photos) ? photos : []
	items.value = items.value.slice()
	void uploadPendingPhotos(item)
}

async function uploadPendingPhotos(item) {
	const key = item.item_code
	if (photoUploadTasks.has(key)) return photoUploadTasks.get(key)
	const task = (async () => {
		while (true) {
			const index = (item.photos || []).findIndex(
				(photo) => photo.localPath && !photo.fileId && photo.uploadState !== 'failed' && !photo.uploading
			)
			if (index < 0) break
			const photo = item.photos[index]
			photo.uploading = true
			photo.uploadState = 'uploading'
			photo.errorMessage = ''
			items.value = items.value.slice()
			try {
				const fileId = await uploadInspectionImage({
					filePath: photo.localPath,
					submissionId: clientSubmissionId.value,
					scope: item.item_code,
					index
				})
				photo.fileId = fileId
				photo.previewUrl = photo.previewUrl || photo.localPath
				photo.localPath = ''
				photo.uploading = false
				photo.uploadState = 'uploaded'
			} catch (err) {
				photo.uploading = false
				photo.uploadState = 'failed'
				photo.errorMessage = err?.message || '上传失败'
				uni.showToast({ title: `${item.item_label}照片上传失败，请重试`, icon: 'none', duration: 2800 })
			}
			items.value = items.value.slice()
		}
	})()
	photoUploadTasks.set(key, task)
	try {
		await task
	} finally {
		photoUploadTasks.delete(key)
	}
}

function retryPhotoUpload(item, index) {
	const photo = item.photos?.[index]
	if (!photo || !photo.localPath || photo.fileId) return
	photo.uploadState = 'pending'
	photo.errorMessage = ''
	items.value = items.value.slice()
	void uploadPendingPhotos(item)
}

function validateSite() {
	if (!selectedCustomer.value?._id) return '请选择客户'
	if (locating.value || geocoding.value) return '手机定位或地址识别尚未完成，请稍候'
	if (!String(locationText.value || '').trim()) return '请填写本次实际地点'
	if (props.editMode && (!inspectionDate.value || !inspectionTime.value || !Number.isFinite(parseInspectionAt()))) {
		return '请填写有效的巡检时间'
	}
	return ''
}

function validateSignatures() {
	if (!String(customerSignerName.value || '').trim()) return '请填写客户现场人员姓名'
	if (!String(inspectorName.value || '').trim()) return '巡检员姓名不能为空'
	if (replaceCustomerSignature.value && !customerSignatureHasInk.value) return '请完成客户现场人员手写签名'
	if (replaceInspectorSignature.value && !inspectorSignatureHasInk.value) return '请完成巡检员本人手写签名'
	if (props.editMode && !String(editReason.value || '').trim()) return '请填写管理员修改原因'
	return ''
}

function showValidation(message) {
	uni.showToast({ title: message, icon: 'none', duration: 2800 })
}

async function refreshSignaturePads() {
	if (currentStep.value !== finalStep.value) return
	await nextTick()
	customerSignaturePad.value?.refresh?.()
	inspectorSignaturePad.value?.refresh?.()
}

function scrollToTop() {
	uni.pageScrollTo({ scrollTop: 0, duration: 160 })
}

function setStep(step) {
	currentStep.value = Math.min(Math.max(step, 0), finalStep.value)
	scrollToTop()
	void refreshSignaturePads()
}

function jumpToItem(itemIndex) {
	returnToReviewItemIndex.value = itemIndex
	setStep(itemIndex + 1)
}

function goPrevious() {
	if (saving.value) return
	if (currentStep.value > 0) {
		setStep(currentStep.value - 1)
		return
	}
	void exitFromFirstStep()
}

function goNext() {
	if (saving.value) return
	if (currentStep.value === finalStep.value) {
		void save()
		return
	}
	const message = currentStep.value === 0
		? validateSite()
		: itemValidationMessage(items.value[currentStep.value - 1])
	if (message) {
		showValidation(message)
		return
	}
	if (
		returnToReviewItemIndex.value >= 0 &&
		returnToReviewItemIndex.value === currentStep.value - 1
	) {
		returnToReviewItemIndex.value = -1
		setStep(finalStep.value)
		return
	}
	setStep(currentStep.value + 1)
}

function validateAllAndFocus() {
	const siteMessage = validateSite()
	if (siteMessage) {
		setStep(0)
		return siteMessage
	}
	for (let index = 0; index < items.value.length; index += 1) {
		const message = itemValidationMessage(items.value[index])
		if (message) {
			setStep(index + 1)
			return message
		}
	}
	const signatureMessage = validateSignatures()
	if (signatureMessage) {
		setStep(finalStep.value)
		return signatureMessage
	}
	return ''
}

async function ensureSignature(kind) {
	const isCustomer = kind === 'customer'
	const replacing = isCustomer ? replaceCustomerSignature.value : replaceInspectorSignature.value
	const existingId = isCustomer ? customerSignatureFileId.value : inspectorSignatureFileId.value
	if (!replacing && existingId) return existingId
	const pad = isCustomer ? customerSignaturePad.value : inspectorSignaturePad.value
	const hasInk = isCustomer ? customerSignatureHasInk.value : inspectorSignatureHasInk.value
	if (!hasInk || !pad) throw new Error(isCustomer ? '客户现场人员签名为空' : '巡检员签名为空')
	saveProgress.value = isCustomer ? '上传客户签名' : '上传巡检员签名'
	const localPath = await pad.exportFile()
	const fileId = await uploadInspectionImage({
		filePath: localPath,
		submissionId: clientSubmissionId.value,
		scope: isCustomer ? 'customer-signature' : 'inspector-signature'
	})
	if (isCustomer) {
		customerSignatureFileId.value = fileId
		customerSignaturePreview.value = localPath
		replaceCustomerSignature.value = false
	} else {
		inspectorSignatureFileId.value = fileId
		inspectorSignaturePreview.value = localPath
		replaceInspectorSignature.value = false
	}
	return fileId
}

function buildPayloadItem(item) {
	const base = {
		item_code: item.item_code,
		issue_note: String(item.issue_note || '').trim(),
		photo_file_ids: item.photos.map((photo) => photo.fileId).filter(Boolean)
	}
	if (!item.checks.length) {
		base.option_code = item.option_code
		return base
	}
	base.answers = visibleChecks(item).map((check) => ({
		check_code: check.code,
		option_code: answerCode(item, check)
	}))
	return base
}

function buildPayload() {
	const payload = {
		customer_id: selectedCustomer.value._id,
		client_submission_id: clientSubmissionId.value,
		location_text: String(locationText.value || '').trim(),
		location_capture: locationCapture.value,
		template_code: templateCodeOf(template.value),
		template_version: templateVersionOf(template.value),
		items: items.value.map(buildPayloadItem),
		customer_signer_name: String(customerSignerName.value || '').trim(),
		customer_signature_file_id: customerSignatureFileId.value,
		inspector_name: String(inspectorName.value || '').trim(),
		inspector_signature_file_id: inspectorSignatureFileId.value
	}
	if (props.editMode) {
		payload._id = props.inspectionId
		payload.inspection_at = parseInspectionAt()
		payload.edit_reason = String(editReason.value || '').trim()
	}
	return payload
}

async function save() {
	if (saving.value) return
	const errorMessage = validateAllAndFocus()
	if (errorMessage) {
		showValidation(errorMessage)
		return
	}
	saving.value = true
	try {
		await ensureSignature('customer')
		await ensureSignature('inspector')
		saveProgress.value = props.editMode ? '保存修改中…' : '提交巡检单…'
		const res = props.editMode
			? await updateHomeSafetyInspectionV1(buildPayload())
			: await submitHomeSafetyInspectionV1(buildPayload())
		if (res?.code !== 0) throw new Error(res?.msg || '巡检单提交失败')
		submitted.value = true
		clearDraft()
		const id = res?.data?._id || props.inspectionId
		uni.showToast({ title: props.editMode ? '修改已保存' : '巡检单已提交', icon: 'success' })
		setTimeout(() => {
			uni.redirectTo({
				url: `/pages/home-safety-inspection/detail?id=${encodeURIComponent(id)}`
			})
		}, 500)
	} catch (err) {
		uni.showToast({
			title: `${err?.message || '保存失败'}；草稿已保留，可重试`,
			icon: 'none',
			duration: 3500
		})
	} finally {
		saving.value = false
		saveProgress.value = ''
	}
}

function buildDraft() {
	return {
		version: 2,
		template_code: templateCodeOf(template.value),
		template_version: templateVersionOf(template.value),
		client_submission_id: clientSubmissionId.value,
		selected_customer: selectedCustomer.value
			? {
				_id: selectedCustomer.value._id,
				name: selectedCustomer.value.name || '',
				address: selectedCustomer.value.address || ''
			}
			: null,
		location_text: locationText.value,
		location_text_touched: locationTextTouched.value,
		geocoded_location_text: geocodedLocationText.value,
		location_capture: locationCapture.value,
		current_step: currentStep.value,
		items: items.value.map((item) => ({
			item_code: item.item_code,
			option_code: item.option_code || '',
			answers: (item.answers || []).map((answer) => ({
				check_code: answer.check_code,
				option_code: answer.option_code
			})),
			issue_note: item.issue_note || '',
			photo_file_ids: (item.photos || []).map((photo) => photo.fileId).filter(Boolean)
		})),
		customer_signer_name: customerSignerName.value,
		inspector_name: inspectorName.value,
		customer_signature_file_id: customerSignatureFileId.value,
		inspector_signature_file_id: inspectorSignatureFileId.value,
		inspection_date: inspectionDate.value,
		inspection_time: inspectionTime.value,
		edit_reason: editReason.value,
		updated_at: Date.now()
	}
}

function saveDraft() {
	if (!draftReady.value || submitted.value || !template.value) return
	try {
		if (
			!draftRestored.value &&
			!hasPendingLocalPhotos.value &&
			progressFingerprint() === initialProgressFingerprint.value
		) {
			uni.removeStorageSync(draftStorageKey.value)
			return
		}
		uni.setStorageSync(draftStorageKey.value, buildDraft())
	} catch (_) {
		// Storage failure must not block the field inspection.
	}
}

function scheduleDraft() {
	if (!draftReady.value || submitted.value) return
	if (draftTimer) clearTimeout(draftTimer)
	draftTimer = setTimeout(saveDraft, 250)
}

function clearDraft() {
	if (draftTimer) {
		clearTimeout(draftTimer)
		draftTimer = null
	}
	try {
		uni.removeStorageSync(draftStorageKey.value)
	} catch (_) {
		// Ignore storage cleanup failure after a successful submit.
	}
	draftRestored.value = false
}

function progressFingerprint() {
	return JSON.stringify({
		customer_id: selectedCustomer.value?._id || '',
		location_text: locationText.value,
		items: items.value.map((item) => ({
			item_code: item.item_code,
			option_code: item.option_code || '',
			answers: item.answers || [],
			issue_note: item.issue_note || '',
			photo_file_ids: (item.photos || []).map((photo) => photo.fileId || photo.localPath || '')
		})),
		customer_signer_name: customerSignerName.value,
		inspector_name: inspectorName.value,
		customer_signature_file_id: customerSignatureFileId.value,
		inspector_signature_file_id: inspectorSignatureFileId.value,
		customer_signature_ink: customerSignatureHasInk.value,
		inspector_signature_ink: inspectorSignatureHasInk.value,
		inspection_date: inspectionDate.value,
		inspection_time: inspectionTime.value,
		edit_reason: editReason.value
	})
}

function confirmLeave() {
	return new Promise((resolve) => {
		uni.showModal({
			title: hasPendingLocalPhotos.value
				? '照片尚未上传完成'
				: hasUnuploadedSignatureInk.value
					? '手写签名尚未提交'
					: '退出巡检',
			content: hasPendingLocalPhotos.value
				? '未上传成功的临时照片无法在刷新后恢复。建议先重试上传，仍要退出吗？'
				: hasUnuploadedSignatureInk.value
					? '其他内容已保存为草稿，但未提交的手写签名不会保存；退出后需要重新签名。确认退出吗？'
					: '已填写内容已保存为草稿，下次进入可继续填写。确认退出吗？',
			confirmText: '退出',
			cancelText: '继续填写',
			success: (res) => resolve(Boolean(res.confirm)),
			fail: () => resolve(false)
		})
	})
}

async function handleHeaderBack() {
	if (currentStep.value > 0) {
		setStep(currentStep.value - 1)
		return false
	}
	if (!hasMeaningfulDraft.value && !hasPendingLocalPhotos.value) return true
	const allowed = await confirmLeave()
	if (allowed) allowBackOnce = true
	return allowed
}

async function exitFromFirstStep() {
	const allowed = await handleHeaderBack()
	if (!allowed) return
	const pages = getCurrentPages()
	if (pages.length > 1) uni.navigateBack()
	else uni.reLaunch({ url: '/pages/home-safety-inspection/home' })
}

function beforeWindowUnload(event) {
	if (!hasMeaningfulDraft.value && !hasPendingLocalPhotos.value) return
	event.preventDefault()
	event.returnValue = ''
}

function previewSignature(url) {
	if (url) uni.previewImage({ urls: [url], current: url })
}

watch(
	() => [
		locationText.value,
		locationCapture.value,
		selectedCustomer.value,
		items.value,
		currentStep.value,
		customerSignerName.value,
		inspectorName.value,
		customerSignatureFileId.value,
		inspectorSignatureFileId.value,
		inspectionDate.value,
		inspectionTime.value,
		editReason.value
	],
	scheduleDraft,
	{ deep: true }
)

onBackPress(() => {
	if (allowBackOnce || submitted.value || loading.value || loadError.value) {
		allowBackOnce = false
		return false
	}
	if (currentStep.value > 0) {
		setStep(currentStep.value - 1)
		return true
	}
	if (!hasMeaningfulDraft.value && !hasPendingLocalPhotos.value) return false
	void confirmLeave().then((allowed) => {
		if (!allowed) return
		allowBackOnce = true
		const pages = getCurrentPages()
		if (pages.length > 1) uni.navigateBack()
		else uni.reLaunch({ url: '/pages/home-safety-inspection/home' })
	})
	return true
})

onMounted(() => {
	disposed = false
	if (typeof window !== 'undefined') window.addEventListener('beforeunload', beforeWindowUnload)
	void load()
})

onBeforeUnmount(() => {
	disposed = true
	locationRequestSequence += 1
	if (autoLocationTimer) {
		clearTimeout(autoLocationTimer)
		autoLocationTimer = null
	}
	if (draftTimer) clearTimeout(draftTimer)
	saveDraft()
	if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeWindowUnload)
})
</script>

<style scoped>
.form-stack,
.review-stack {
	display: flex;
	flex-direction: column;
	gap: 20rpx;
}
.form-stack {
	padding-bottom: calc(126rpx + env(safe-area-inset-bottom));
}
.wizard-card,
.section-card,
.state-card {
	background: #fff;
	border-radius: 22rpx;
	box-shadow: 0 6rpx 22rpx rgba(15, 42, 67, 0.06);
}
.wizard-card {
	padding: 22rpx 24rpx;
}
.phase-row {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 8rpx;
}
.phase {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8rpx;
	min-width: 0;
	color: #94a3b8;
}
.phase__dot {
	flex: none;
	width: 38rpx;
	height: 38rpx;
	line-height: 38rpx;
	text-align: center;
	border-radius: 50%;
	background: #e2e8f0;
	font-size: 20rpx;
	font-weight: 800;
}
.phase__label {
	white-space: nowrap;
	font-size: 21rpx;
	font-weight: 700;
}
.phase--active {
	color: #0f766e;
}
.phase--active .phase__dot {
	color: #fff;
	background: #0f766e;
}
.phase--done {
	color: #047857;
}
.phase--done .phase__dot {
	color: #047857;
	background: #d1fae5;
}
.item-progress {
	margin-top: 20rpx;
	padding-top: 18rpx;
	border-top: 1rpx solid #e2e8f0;
}
.item-progress__labels {
	display: flex;
	align-items: center;
	justify-content: space-between;
	color: #475569;
	font-size: 22rpx;
	font-weight: 700;
}
.item-progress__track {
	height: 10rpx;
	margin-top: 12rpx;
	overflow: hidden;
	border-radius: 99rpx;
	background: #e2e8f0;
}
.item-progress__bar {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #0f766e, #14b8a6);
	transition: width 0.2s ease;
}
.section-card {
	padding: 26rpx 24rpx;
}
.section-card--admin {
	border: 2rpx solid #d69e2e;
	background: #fffbeb;
}
.section-title {
	display: flex;
	align-items: center;
	gap: 18rpx;
	padding-bottom: 22rpx;
	border-bottom: 1rpx solid #e6edf3;
}
.section-title__number {
	flex: none;
	width: 58rpx;
	height: 58rpx;
	line-height: 58rpx;
	text-align: center;
	border-radius: 16rpx;
	color: #fff;
	background: #0f766e;
	font-size: 28rpx;
	font-weight: 800;
}
.section-title__main,
.section-title__hint {
	display: block;
}
.section-title__main {
	color: #102a43;
	font-size: 29rpx;
	font-weight: 800;
}
.section-title__hint {
	margin-top: 4rpx;
	color: #718096;
	font-size: 21rpx;
}
.field {
	margin-top: 22rpx;
}
.field__label,
.field__tip {
	display: block;
}
.field__label,
.signature-block__title,
.admin-title {
	margin-bottom: 10rpx;
	color: #334e68;
	font-size: 24rpx;
	font-weight: 700;
}
.field__tip {
	margin-top: 9rpx;
	color: #718096;
	font-size: 21rpx;
	line-height: 1.45;
}
.required {
	color: #dc2626;
}
.input,
.textarea,
.picker-value {
	width: 100%;
	border: 1rpx solid #cbd5e1;
	border-radius: 14rpx;
	background: #fff;
	box-sizing: border-box;
	color: #102a43;
	font-size: 25rpx;
}
.input,
.picker-value {
	height: 76rpx;
	padding: 0 20rpx;
	line-height: 74rpx;
}
.input[disabled] {
	background: #f1f5f9;
	color: #475569;
}
.textarea {
	min-height: 150rpx;
	padding: 18rpx 20rpx;
	line-height: 1.55;
}
.textarea--short {
	min-height: 116rpx;
}
.customer-value {
	padding: 18rpx 20rpx;
	border-radius: 14rpx;
	background: #f1f8f7;
}
.customer-value__name,
.customer-value__address {
	display: block;
}
.customer-value__name {
	color: #102a43;
	font-size: 27rpx;
	font-weight: 800;
}
.customer-value__address {
	margin-top: 7rpx;
	color: #627d98;
	font-size: 22rpx;
	line-height: 1.5;
}
.minor-button,
.retry-button {
	margin: 14rpx 0 0;
	padding: 0 18rpx;
	height: 64rpx;
	line-height: 62rpx;
	border: 1rpx solid #0f766e;
	border-radius: 13rpx;
	background: #fff;
	color: #0f766e;
	font-size: 23rpx;
}
.minor-button::after,
.retry-button::after,
.wizard-footer__button::after {
	border: 0;
}
.datetime-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16rpx;
}
.customer-picker {
	margin-top: 16rpx;
	padding: 16rpx;
	border-radius: 14rpx;
	background: #f8fafc;
}
.customer-picker__search {
	display: flex;
	align-items: flex-end;
	gap: 12rpx;
}
.customer-picker__search .minor-button {
	flex: none;
	margin: 0;
}
.customer-option {
	padding: 16rpx 4rpx;
	border-bottom: 1rpx solid #e2e8f0;
}
.customer-option__name,
.customer-option__address {
	display: block;
}
.customer-option__name {
	color: #102a43;
	font-size: 24rpx;
	font-weight: 700;
}
.customer-option__address {
	margin-top: 5rpx;
	color: #718096;
	font-size: 21rpx;
}
.location-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 14rpx;
	margin-top: 20rpx;
	padding: 18rpx;
	border-radius: 14rpx;
	background: #f8fafc;
}
.location-row > view {
	flex: 1;
	min-width: 0;
}
.location-row .minor-button {
	flex: none;
	margin: 0;
}
.location-row__label,
.location-row__state {
	display: block;
}
.location-row__label {
	color: #334e68;
	font-size: 24rpx;
	font-weight: 700;
}
.location-row__state {
	margin-top: 6rpx;
	color: #9a6700;
	font-size: 21rpx;
	line-height: 1.45;
	overflow-wrap: anywhere;
}
.location-row__state--ok {
	color: #047857;
}
.inspection-page {
	border: 2rpx solid transparent;
}
.inspection-page--danger {
	border-color: #fca5a5;
	background: #fffafa;
}
.inspection-description {
	display: block;
	margin-top: 18rpx;
	padding: 16rpx 18rpx;
	border-radius: 14rpx;
	color: #475569;
	background: #f1f5f9;
	font-size: 22rpx;
	line-height: 1.55;
}
.check-block {
	margin-top: 24rpx;
}
.check-block + .check-block {
	padding-top: 22rpx;
	border-top: 1rpx solid #e2e8f0;
}
.check-block__label {
	display: block;
	color: #334e68;
	font-size: 25rpx;
	font-weight: 800;
	line-height: 1.4;
}
.option-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12rpx;
	margin-top: 14rpx;
}
.option-button {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10rpx;
	min-height: 76rpx;
	padding: 11rpx 10rpx;
	border: 2rpx solid #cbd5e1;
	border-radius: 14rpx;
	color: #475569;
	background: #fff;
	font-size: 24rpx;
	box-sizing: border-box;
	text-align: center;
}
.option-button--active {
	border-color: #0f766e;
	color: #0f766e;
	background: #ecfdf5;
	font-weight: 700;
}
.option-button--danger {
	border-color: #dc2626;
	color: #b91c1c;
	background: #fef2f2;
}
.option-button__dot {
	flex: none;
	width: 18rpx;
	height: 18rpx;
	border: 2rpx solid currentColor;
	border-radius: 50%;
	box-sizing: border-box;
}
.option-button--active .option-button__dot {
	border: 5rpx solid currentColor;
}
.abnormal-note {
	padding: 18rpx;
	border-radius: 16rpx;
	background: #fef2f2;
}
.item-state {
	margin-top: 22rpx;
	padding: 16rpx 18rpx;
	border-radius: 14rpx;
	color: #9a6700;
	background: #fffbeb;
	font-size: 22rpx;
	line-height: 1.45;
}
.item-state--ok {
	color: #047857;
	background: #ecfdf5;
}
.overall-result {
	display: flex;
	justify-content: space-between;
	margin-top: 22rpx;
	padding: 20rpx;
	border-radius: 14rpx;
	color: #047857;
	background: #d1fae5;
	font-size: 26rpx;
	font-weight: 800;
}
.overall-result--danger {
	color: #b91c1c;
	background: #fee2e2;
}
.review-item {
	margin-top: 16rpx;
	padding: 18rpx;
	border: 1rpx solid #d9e2ec;
	border-radius: 16rpx;
	background: #fbfdff;
}
.review-item--danger {
	border-color: #fca5a5;
	background: #fff7f7;
}
.review-item--neutral {
	border-color: #cbd5e1;
	background: #f8fafc;
}
.review-item__heading {
	display: flex;
	align-items: center;
	gap: 10rpx;
}
.review-item__number {
	flex: none;
	width: 38rpx;
	height: 38rpx;
	line-height: 38rpx;
	text-align: center;
	border-radius: 10rpx;
	color: #fff;
	background: #64748b;
	font-size: 20rpx;
	font-weight: 800;
}
.review-item__title {
	flex: 1;
	min-width: 0;
	color: #102a43;
	font-size: 24rpx;
	font-weight: 800;
}
.review-item__result {
	flex: none;
	color: #047857;
	font-size: 22rpx;
	font-weight: 800;
}
.review-item__result--danger {
	color: #b91c1c;
}
.review-item__result--neutral {
	color: #64748b;
}
.review-item__answer,
.review-item__meta,
.review-item__note {
	display: block;
	margin-top: 8rpx;
	padding-left: 48rpx;
	color: #475569;
	font-size: 21rpx;
	line-height: 1.45;
}
.review-item__meta {
	color: #718096;
}
.review-item__note {
	color: #b91c1c;
}
.signature-block {
	margin-top: 24rpx;
	padding-top: 2rpx;
}
.signature-block + .signature-block {
	margin-top: 28rpx;
	padding-top: 24rpx;
	border-top: 1rpx solid #e2e8f0;
}
.signature-block__title {
	display: block;
	margin: 20rpx 0 12rpx;
}
.existing-signature {
	padding: 14rpx;
	border: 1rpx solid #cbd5e1;
	border-radius: 16rpx;
	background: #f8fafc;
}
.existing-signature__image {
	width: 100%;
	height: 220rpx;
	background: #fff;
}
.admin-title {
	display: block;
}
.wizard-footer {
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 30;
	display: grid;
	grid-template-columns: minmax(180rpx, 0.7fr) minmax(0, 1.3fr);
	gap: 14rpx;
	padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
	border-top: 1rpx solid #e2e8f0;
	background: rgba(255, 255, 255, 0.96);
	box-shadow: 0 -8rpx 28rpx rgba(15, 42, 67, 0.1);
	box-sizing: border-box;
}
.wizard-footer__button {
	margin: 0;
	width: 100%;
	height: 84rpx;
	line-height: 82rpx;
	border-radius: 17rpx;
	font-size: 27rpx;
	font-weight: 800;
}
.wizard-footer__button--secondary {
	border: 1rpx solid #94a3b8;
	color: #475569;
	background: #fff;
}
.wizard-footer__button--primary {
	border: 1rpx solid #0f766e;
	color: #fff;
	background: #0f766e;
}
.wizard-footer__button[disabled] {
	opacity: 0.7;
}
.state-card {
	padding: 70rpx 26rpx;
	text-align: center;
	color: #64748b;
	font-size: 25rpx;
}
.state-card--error {
	color: #b91c1c;
}
.retry-button {
	margin: 22rpx auto 0;
}
@media (orientation: landscape) and (min-width: 700px) {
	.form-stack {
		max-width: 900px;
		margin: 0 auto;
	}
	.wizard-footer {
		left: 50%;
		width: 900px;
		transform: translateX(-50%);
		border-radius: 20rpx 20rpx 0 0;
	}
}
</style>
