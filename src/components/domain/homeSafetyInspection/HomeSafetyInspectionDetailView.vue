<template>
	<HomeSafetyInspectionShell title="巡检单详情" subtitle="现场巡检完整记录" back>
		<template #action>
			<button
				v-if="showEditAction"
				class="edit-button"
				:disabled="Boolean(editBlockedReason)"
				type="button"
				@click="editRecord"
			>
				管理员修改
			</button>
		</template>

		<view v-if="loading" class="state-card">正在加载巡检单…</view>
		<view v-else-if="loadError" class="state-card state-card--error">
			<text>{{ loadError }}</text>
			<button class="minor-button" type="button" @click="load">重新加载</button>
		</view>
		<view v-else-if="record" class="detail-stack">
			<view v-if="record.revision_no" class="modified-banner">
				<text class="modified-banner__title">管理员已修改</text>
				<text>{{ formatDateTime(record.last_edited_at) }} · {{ record.last_edited_by_name || '超级管理员' }}</text>
				<text>原因：{{ record.last_edit_reason || '-' }}</text>
			</view>

			<view v-if="editBlockedReason" class="edit-blocked-banner">
				<text class="edit-blocked-banner__title">该巡检单暂不可修改</text>
				<text>{{ editBlockedReason }}</text>
			</view>

			<view :class="['result-banner', record.overall_result === 'abnormal' ? 'result-banner--danger' : '']">
				<text class="result-banner__label">整单巡检结果</text>
				<text class="result-banner__value">{{ record.overall_result === 'abnormal' ? '有异常' : '正常' }}</text>
			</view>

			<view class="section-card">
				<view class="section-title"><text class="section-title__number">1</text><text>时间与地点</text></view>
				<DetailRow label="巡检编号" :value="record.inspection_no || '未编号'" />
				<DetailRow label="巡检时间" :value="formatDateTime(record.inspection_at)" />
				<DetailRow label="客户" :value="record.customer_name_snapshot || '-'" />
				<DetailRow label="客户地址快照" :value="record.customer_address_snapshot || '-'" />
				<DetailRow label="本次实际地点" :value="record.location_text || '-'" />
				<DetailRow label="手机定位" :value="locationText(record.location_capture)" />
			</view>

			<view class="section-card">
				<view class="section-title"><text class="section-title__number">2</text><text>巡检内容</text></view>
				<view
					v-for="(item, index) in record.items || []"
					:key="item.item_code"
					:class="inspectionItemClass(item)"
				>
					<view class="inspection-item__head">
						<text class="inspection-item__name">{{ index + 1 }}. {{ item.item_label_snapshot }}</text>
						<text :class="inspectionResultClass(item)">
							{{ inspectionResultLabel(item) }}
						</text>
					</view>
					<view v-if="itemAnswers(item).length" class="answer-list">
						<view
							v-for="(answer, answerIndex) in itemAnswers(item)"
							:key="answer.check_code || answer.code || answerIndex"
							:class="answerRowClass(answer)"
						>
							<text class="answer-row__label">{{ answerLabel(answer) }}</text>
							<text class="answer-row__value">{{ answerOptionLabel(answer) }}</text>
						</view>
					</view>
					<text
						v-if="item.issue_note"
						:class="['inspection-item__note', !isInspectionItemAbnormal(item) ? 'inspection-item__note--neutral' : '']"
					>
						问题说明：{{ item.issue_note }}
					</text>
					<view class="photo-head">
						<text>现场照片</text>
						<text>{{ item.photo_file_ids?.length || 0 }} 张</text>
					</view>
					<view v-if="item.photo_file_ids?.length" class="photo-grid">
						<image
							v-for="(fileId, photoIndex) in item.photo_file_ids || []"
							:key="fileId"
							class="photo"
							:src="fileUrls[fileId] || fileId"
							mode="aspectFill"
							@click="previewPhotos(item.photo_file_ids, photoIndex)"
						/>
					</view>
					<text v-else class="photo-empty">暂无现场照片</text>
				</view>
			</view>

			<view class="section-card">
				<view class="section-title"><text class="section-title__number">3</text><text>人员信息</text></view>
				<DetailRow label="客户现场人员" :value="record.customer_signer_name || '-'" />
				<DetailRow label="巡检员" :value="record.inspector_name || '-'" />
				<DetailRow label="巡检员账号" :value="record.inspector_username_snapshot || '-'" />
			</view>

			<view v-if="canViewRevisions" class="section-card">
				<view class="revision-head">
					<view>
						<text class="revision-head__title">历史修订版本</text>
						<text class="revision-head__hint">仅超级管理员可见</text>
					</view>
					<button class="minor-button" :disabled="revisionsLoading" type="button" @click="toggleRevisions">
						{{ revisionsVisible ? '收起' : revisionsLoaded ? '展开' : '加载版本' }}
					</button>
				</view>
				<view v-if="revisionsVisible" class="revision-list">
					<view v-if="!revisions.length" class="revision-empty">暂无历史修订版本</view>
					<view v-for="revision in revisions" :key="revision._id" class="revision-card">
						<view class="revision-card__head" @click="toggleRevision(revision._id)">
							<view>
								<text class="revision-card__title">修改前版本 {{ revision.version_no }}</text>
								<text class="revision-card__meta">
									{{ formatDateTime(revision.created_at) }} · {{ revision.created_by_name || '-' }}
								</text>
							</view>
							<text class="revision-card__toggle">{{ expandedRevisionId === revision._id ? '收起' : '查看' }}</text>
						</view>
						<text class="revision-card__reason">修改原因：{{ revision.edit_reason || '-' }}</text>
						<view v-if="expandedRevisionId === revision._id" class="revision-card__snapshot">
							<DetailRow label="原客户" :value="revision.snapshot?.customer_name_snapshot || '-'" />
							<DetailRow label="原巡检时间" :value="formatDateTime(revision.snapshot?.inspection_at)" />
							<DetailRow label="原实际地点" :value="revision.snapshot?.location_text || '-'" />
							<DetailRow label="原手机定位" :value="locationText(revision.snapshot?.location_capture)" />
							<DetailRow
								label="原整单结果"
								:value="revision.snapshot?.overall_result === 'abnormal' ? '有异常' : '正常'"
							/>
							<view
								v-for="(item, itemIndex) in revision.snapshot?.items || []"
								:key="item.item_code || itemIndex"
								:class="['revision-item', isInspectionItemAbnormal(item) ? 'revision-item--danger' : '', isInspectionItemNotApplicable(item) ? 'revision-item--neutral' : '']"
							>
								<view class="revision-item__head">
									<text class="revision-item__name">{{ item.item_label_snapshot || `检查项目 ${itemIndex + 1}` }}</text>
									<text :class="inspectionResultClass(item)">{{ inspectionResultLabel(item) }}</text>
								</view>
								<view v-if="itemAnswers(item).length" class="answer-list answer-list--revision">
									<view
										v-for="(answer, answerIndex) in itemAnswers(item)"
										:key="answer.check_code || answer.code || answerIndex"
										:class="answerRowClass(answer)"
									>
										<text class="answer-row__label">{{ answerLabel(answer) }}</text>
										<text class="answer-row__value">{{ answerOptionLabel(answer) }}</text>
									</view>
								</view>
								<text v-if="item.issue_note" class="revision-item__note">问题说明：{{ item.issue_note }}</text>
								<view class="photo-head photo-head--revision">
									<text>原现场照片</text>
									<text>{{ item.photo_file_ids?.length || 0 }} 张</text>
								</view>
								<view v-if="item.photo_file_ids?.length" class="photo-grid photo-grid--revision">
									<image
										v-for="(fileId, photoIndex) in item.photo_file_ids || []"
										:key="fileId"
										class="photo"
										:src="fileUrls[fileId] || fileId"
										mode="aspectFill"
										@click="previewPhotos(item.photo_file_ids, photoIndex)"
									/>
								</view>
							</view>
							<DetailRow label="原客户现场人员" :value="revision.snapshot?.customer_signer_name || '-'" />
							<DetailRow label="原巡检员" :value="revision.snapshot?.inspector_name || '-'" />
							<text class="revision-card__notice">原现场照片已完整保存在此版本中。</text>
						</view>
					</view>
				</view>
			</view>
		</view>
	</HomeSafetyInspectionShell>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import HomeSafetyInspectionShell from './HomeSafetyInspectionShell.vue'
import {
	getHomeSafetyInspectionV1,
	listHomeSafetyInspectionRevisionsV1
} from '@/services/homeSafetyInspection'
import { resolveInspectionFileUrls } from '@/services/homeSafetyInspectionMedia'

const props = defineProps({
	inspectionId: { type: String, required: true }
})
const loading = ref(true)
const loadError = ref('')
const record = ref(null)
const fileUrls = ref({})
const revisions = ref([])
const revisionsLoading = ref(false)
const revisionsLoaded = ref(false)
const revisionsVisible = ref(false)
const expandedRevisionId = ref('')
const editBlockedReason = computed(() => {
	const current = record.value || {}
	return String(
		current.edit_block_reason ||
		current.edit_blocked_reason ||
		current.update_blocked_reason ||
		current.update_disabled_reason ||
		''
	).trim()
})
const showEditAction = computed(() => Boolean(record.value?.can_update || editBlockedReason.value))
const canViewRevisions = computed(() =>
	Boolean(record.value?.can_view_revisions || record.value?.can_update || editBlockedReason.value)
)
const DetailRow = defineComponent({
	name: 'HomeSafetyInspectionDetailRow',
	props: {
		label: { type: String, required: true },
		value: { type: String, default: '-' }
	},
	setup(rowProps) {
		return () =>
			h('view', { class: 'detail-row' }, [
				h('text', { class: 'detail-row__label' }, rowProps.label),
				h('text', { class: 'detail-row__value' }, rowProps.value || '-')
			])
	}
})

function formatDateTime(value) {
	const date = new Date(Number(value || 0))
	if (!Number.isFinite(date.getTime()) || Number(value) <= 0) return '-'
	const pad = (number) => String(number).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function locationText(location) {
	if (location?.status === 'ok') {
		const rawLatitude = location.latitude
		const rawLongitude = location.longitude
		const latitude =
			rawLatitude !== null && rawLatitude !== undefined && rawLatitude !== ''
				? Number(rawLatitude)
				: Number.NaN
		const longitude =
			rawLongitude !== null && rawLongitude !== undefined && rawLongitude !== ''
				? Number(rawLongitude)
				: Number.NaN
		const rawAccuracy = location.accuracy
		const accuracy =
			rawAccuracy !== null && rawAccuracy !== undefined && rawAccuracy !== ''
				? Number(rawAccuracy)
				: Number.NaN
		const coordinate = Number.isFinite(latitude) && Number.isFinite(longitude)
			? `WGS84 纬度 ${latitude.toFixed(6)}，经度 ${longitude.toFixed(6)}`
			: '已获取'
		return Number.isFinite(accuracy) ? `${coordinate}（精度约 ${Math.round(accuracy)} 米）` : coordinate
	}
	if (location?.status === 'failed') return '定位失败（不影响本单有效提交）'
	return '未获取定位（不影响本单有效提交）'
}

function itemAnswers(item) {
	return Array.isArray(item?.answers) ? item.answers : []
}

function answerLabel(answer) {
	return (
		answer?.check_label_snapshot ||
		answer?.check_label ||
		answer?.label_snapshot ||
		answer?.label ||
		'检查结果'
	)
}

function answerOptionLabel(answer) {
	return (
		answer?.option_label_snapshot ||
		answer?.answer_label_snapshot ||
		answer?.option_label ||
		answer?.result_label_snapshot ||
		answer?.result_label ||
		'-'
	)
}

function hasNotApplicableValue(code, label) {
	const normalizedCode = String(code || '').trim().toLowerCase()
	const normalizedLabel = String(label || '').trim()
	return (
		['not_applicable', 'not-applicable', 'notapplicable', 'n/a', 'na'].includes(normalizedCode) ||
		normalizedLabel.includes('不适用') ||
		normalizedLabel.includes('未使用气化器')
	)
}

function isAnswerNotApplicable(answer) {
	return hasNotApplicableValue(
		answer?.option_code ?? answer?.answer_code ?? answer?.result_code,
		answerOptionLabel(answer)
	)
}

function isAnswerAbnormal(answer) {
	if (typeof answer?.is_abnormal === 'boolean') return answer.is_abnormal
	return String(answer?.result || answer?.status || '').toLowerCase() === 'abnormal'
}

function isInspectionItemAbnormal(item) {
	if (typeof item?.is_abnormal === 'boolean') return item.is_abnormal
	return itemAnswers(item).some(isAnswerAbnormal)
}

function isInspectionItemNotApplicable(item) {
	if (isInspectionItemAbnormal(item)) return false
	if (item?.is_not_applicable === true) return true
	if (
		hasNotApplicableValue(
			item?.result_code ?? item?.summary_code ?? item?.option_code,
			item?.result_label_snapshot ?? item?.summary_label_snapshot ?? item?.option_label_snapshot
		)
	) {
		return true
	}
	const answers = itemAnswers(item)
	return answers.length > 0 && answers.every(isAnswerNotApplicable)
}

function inspectionResultLabel(item) {
	const snapshotLabel =
		item?.result_label_snapshot ||
		item?.summary_label_snapshot ||
		item?.option_label_snapshot ||
		item?.result_label ||
		item?.summary_label
	if (snapshotLabel) return snapshotLabel
	if (isInspectionItemNotApplicable(item)) return '不适用'
	return isInspectionItemAbnormal(item) ? '异常' : '正常'
}

function inspectionItemClass(item) {
	return [
		'inspection-item',
		isInspectionItemAbnormal(item) ? 'inspection-item--danger' : '',
		isInspectionItemNotApplicable(item) ? 'inspection-item--neutral' : ''
	]
}

function inspectionResultClass(item) {
	return [
		'inspection-item__result',
		isInspectionItemAbnormal(item) ? 'inspection-item__result--danger' : '',
		isInspectionItemNotApplicable(item) ? 'inspection-item__result--neutral' : ''
	]
}

function answerRowClass(answer) {
	return [
		'answer-row',
		isAnswerAbnormal(answer) ? 'answer-row--danger' : '',
		isAnswerNotApplicable(answer) ? 'answer-row--neutral' : ''
	]
}

async function load() {
	loading.value = true
	loadError.value = ''
	try {
		const res = await getHomeSafetyInspectionV1(props.inspectionId)
		if (res?.code !== 0) throw new Error(res?.msg || '巡检单加载失败')
		record.value = res.data
		const ids = []
		for (const item of res.data.items || []) ids.push(...(item.photo_file_ids || []))
		fileUrls.value = await resolveInspectionFileUrls(ids)
	} catch (err) {
		loadError.value = err?.message || '巡检单加载失败'
	} finally {
		loading.value = false
	}
}

function previewPhotos(fileIds, index) {
	const urls = (fileIds || []).map((fileId) => fileUrls.value[fileId] || fileId).filter(Boolean)
	if (!urls.length) return
	uni.previewImage({ urls, current: urls[index] || urls[0] })
}

function editRecord() {
	uni.navigateTo({
		url: `/pages/home-safety-inspection/form?id=${encodeURIComponent(props.inspectionId)}&mode=edit`
	})
}

async function toggleRevisions() {
	if (revisionsVisible.value) {
		revisionsVisible.value = false
		return
	}
	if (!revisionsLoaded.value) {
		revisionsLoading.value = true
		try {
			const res = await listHomeSafetyInspectionRevisionsV1(props.inspectionId)
			if (res?.code !== 0) throw new Error(res?.msg || '修订版本加载失败')
			revisions.value = Array.isArray(res.data) ? res.data : []
			await resolveRevisionFileUrls(revisions.value)
			revisionsLoaded.value = true
		} catch (err) {
			uni.showToast({ title: err?.message || '修订版本加载失败', icon: 'none' })
			return
		} finally {
			revisionsLoading.value = false
		}
	}
	revisionsVisible.value = true
}

async function resolveRevisionFileUrls(rows) {
	const ids = []
	for (const revision of rows || []) {
		const snapshot = revision?.snapshot || {}
		for (const item of snapshot.items || []) ids.push(...(item.photo_file_ids || []))
	}
	const resolved = await resolveInspectionFileUrls(ids)
	fileUrls.value = { ...fileUrls.value, ...resolved }
}

function toggleRevision(id) {
	expandedRevisionId.value = expandedRevisionId.value === id ? '' : id
}

onMounted(load)
defineExpose({ refresh: load })
</script>

<style scoped>
:deep(.detail-row) {
	display: grid;
	grid-template-columns: 190rpx minmax(0, 1fr);
	gap: 18rpx;
	padding: 18rpx 0;
	border-bottom: 1rpx solid #edf2f7;
}
:deep(.detail-row__label) {
	color: #718096;
	font-size: 23rpx;
}
:deep(.detail-row__value) {
	color: #243b53;
	font-size: 24rpx;
	line-height: 1.5;
	word-break: break-all;
}
.edit-button {
	margin: 0;
	padding: 0 15rpx;
	height: 60rpx;
	line-height: 58rpx;
	border-radius: 14rpx;
	background: rgba(255, 255, 255, 0.14);
	color: #fff;
	font-size: 22rpx;
}
.edit-button[disabled] {
	opacity: 0.52;
}
.edit-button::after,
.minor-button::after {
	border: 0;
}
.detail-stack {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}
.section-card,
.state-card,
.result-banner,
.modified-banner,
.edit-blocked-banner {
	padding: 24rpx;
	border-radius: 20rpx;
	background: #fff;
	box-shadow: 0 6rpx 22rpx rgba(15, 42, 67, 0.06);
}
.modified-banner {
	display: flex;
	flex-direction: column;
	gap: 7rpx;
	color: #7c5c00;
	background: #fffbeb;
	border: 1rpx solid #f6d365;
	font-size: 22rpx;
	line-height: 1.45;
}
.modified-banner__title {
	font-size: 26rpx;
	font-weight: 800;
}
.edit-blocked-banner {
	display: flex;
	flex-direction: column;
	gap: 7rpx;
	color: #475569;
	background: #f8fafc;
	border: 1rpx solid #cbd5e1;
	font-size: 22rpx;
	line-height: 1.45;
}
.edit-blocked-banner__title {
	font-size: 26rpx;
	font-weight: 800;
	color: #334155;
}
.result-banner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	color: #047857;
	background: #d1fae5;
}
.result-banner--danger {
	color: #b91c1c;
	background: #fee2e2;
}
.result-banner__label {
	font-size: 24rpx;
}
.result-banner__value {
	font-size: 31rpx;
	font-weight: 900;
}
.section-title {
	display: flex;
	align-items: center;
	gap: 14rpx;
	padding-bottom: 18rpx;
	border-bottom: 1rpx solid #e6edf3;
	color: #102a43;
	font-size: 28rpx;
	font-weight: 800;
}
.section-title__number {
	width: 50rpx;
	height: 50rpx;
	line-height: 50rpx;
	text-align: center;
	border-radius: 14rpx;
	color: #fff;
	background: #0f766e;
	font-size: 24rpx;
}
.inspection-item {
	margin-top: 18rpx;
	padding: 20rpx;
	border-radius: 16rpx;
	background: #f8fafc;
}
.inspection-item--danger {
	background: #fff1f2;
	border: 1rpx solid #fecaca;
}
.inspection-item--neutral {
	background: #f8fafc;
	border: 1rpx solid #cbd5e1;
}
.inspection-item__head {
	display: flex;
	align-items: flex-start;
	gap: 14rpx;
}
.inspection-item__name {
	flex: 1;
	color: #243b53;
	font-size: 25rpx;
	font-weight: 800;
	line-height: 1.4;
}
.inspection-item__result {
	padding: 6rpx 12rpx;
	border-radius: 999rpx;
	color: #047857;
	background: #d1fae5;
	font-size: 21rpx;
	font-weight: 700;
}
.inspection-item__result--danger {
	color: #b91c1c;
	background: #fee2e2;
}
.inspection-item__result--neutral {
	color: #475569;
	background: #e2e8f0;
}
.answer-list {
	display: flex;
	flex-direction: column;
	gap: 9rpx;
	margin-top: 15rpx;
}
.answer-row {
	display: flex;
	align-items: flex-start;
	gap: 18rpx;
	padding: 13rpx 15rpx;
	border-radius: 11rpx;
	background: #fff;
	border: 1rpx solid #e2e8f0;
	font-size: 22rpx;
	line-height: 1.45;
}
.answer-row--danger {
	border-color: #fecaca;
	background: #fff7f7;
}
.answer-row--neutral {
	border-color: #cbd5e1;
	background: #f8fafc;
}
.answer-row__label {
	flex: 1;
	color: #526d82;
}
.answer-row__value {
	color: #047857;
	font-weight: 800;
	text-align: right;
}
.answer-row--danger .answer-row__value {
	color: #b91c1c;
}
.answer-row--neutral .answer-row__value {
	color: #475569;
}
.inspection-item__note {
	display: block;
	margin-top: 12rpx;
	color: #b91c1c;
	font-size: 23rpx;
	line-height: 1.5;
}
.inspection-item__note--neutral {
	color: #526d82;
}
.photo-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 16rpx;
	color: #718096;
	font-size: 21rpx;
}
.photo-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10rpx;
	margin-top: 9rpx;
}
.photo-empty {
	display: block;
	margin-top: 9rpx;
	padding: 18rpx;
	border-radius: 12rpx;
	background: #f1f5f9;
	color: #94a3b8;
	text-align: center;
	font-size: 21rpx;
}
.photo {
	width: 100%;
	aspect-ratio: 1;
	border-radius: 13rpx;
	background: #e2e8f0;
}
.revision-head,
.revision-card__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 14rpx;
}
.revision-head__title,
.revision-head__hint {
	display: block;
}
.revision-head__title {
	color: #102a43;
	font-size: 27rpx;
	font-weight: 800;
}
.revision-head__hint {
	margin-top: 4rpx;
	color: #718096;
	font-size: 20rpx;
}
.minor-button {
	margin: 0;
	padding: 0 17rpx;
	height: 62rpx;
	line-height: 60rpx;
	border: 1rpx solid #0f766e;
	border-radius: 13rpx;
	background: #fff;
	color: #0f766e;
	font-size: 22rpx;
}
.revision-list {
	margin-top: 18rpx;
}
.revision-card {
	margin-top: 12rpx;
	padding: 18rpx;
	border-radius: 14rpx;
	background: #f8fafc;
}
.revision-card__title,
.revision-card__meta,
.revision-card__reason,
.revision-card__notice {
	display: block;
}
.revision-card__title {
	color: #243b53;
	font-size: 24rpx;
	font-weight: 800;
}
.revision-card__meta,
.revision-card__reason {
	margin-top: 6rpx;
	color: #718096;
	font-size: 21rpx;
	line-height: 1.45;
}
.revision-card__toggle {
	color: #0f766e;
	font-size: 22rpx;
}
.revision-card__snapshot {
	margin-top: 16rpx;
	padding-top: 8rpx;
	border-top: 1rpx solid #e2e8f0;
}
.revision-item {
	display: flex;
	flex-direction: column;
	gap: 5rpx;
	margin-top: 10rpx;
	padding: 12rpx;
	border-radius: 10rpx;
	background: #fff;
	color: #526d82;
	font-size: 21rpx;
}
.revision-item--danger {
	background: #fff1f2;
	border: 1rpx solid #fecaca;
}
.revision-item--neutral {
	background: #f8fafc;
	border: 1rpx solid #cbd5e1;
}
.revision-item__head {
	display: flex;
	align-items: flex-start;
	gap: 12rpx;
}
.revision-item__name {
	flex: 1;
	color: #334e68;
	font-weight: 800;
	line-height: 1.45;
}
.revision-item__note {
	color: #b91c1c;
	line-height: 1.5;
}
.answer-list--revision {
	margin-top: 8rpx;
}
.photo-head--revision {
	margin-top: 8rpx;
}
.photo-grid--revision {
	margin-top: 4rpx;
}
.revision-card__notice {
	margin-top: 14rpx;
	color: #9a6700;
	font-size: 20rpx;
}
.revision-empty,
.state-card {
	text-align: center;
	color: #718096;
	font-size: 24rpx;
}
.state-card {
	padding: 70rpx 24rpx;
}
.state-card--error {
	color: #b91c1c;
}
.state-card .minor-button {
	margin: 20rpx auto 0;
}
</style>
