<template>
	<AppPage :title="pageTitle" :subtitle="pageSubtitle" icon="bottle">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">
				{{ submitText }}
			</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">作业日期</text>
						<text class="pill-value">{{ dateSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">钢瓶编号</text>
						<text class="pill-value">{{ bottleSummary }}</text>
					</view>
						<view class="info-pill">
							<text class="pill-label">作业类型</text>
							<text class="pill-value">{{ recordTypeLabel }}</text>
						</view>
						<view class="info-pill">
							<text class="pill-label">操作人</text>
							<text class="pill-value">{{ operatorLabel }}</text>
						</view>
						<view class="info-pill">
							<text class="pill-label">灌装净重</text>
							<text class="pill-value">{{ weightSummary }}</text>
						</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="灌装作业信息">
					<view class="form-grid">
						<view class="form-item span-2">
							<picker class="picker-full" mode="date" :value="form.date" @change="onDateChange">
								<AppInput :model-value="form.date" label="灌装日期" placeholder="请选择作业日期" disabled prefix-icon="calendar" size="sm" />
							</picker>
							</view>
							<view class="form-item">
								<picker class="picker-full" mode="selector" :range="recordTypeOptions" range-key="label" @change="onRecordTypeChange">
									<AppInput :model-value="recordTypeLabel" label="作业类型" placeholder="请选择作业类型" disabled prefix-icon="list" size="sm" />
								</picker>
							</view>
							<view class="form-item">
								<AppInput
									v-model="form.bottle_no"
									:label="bottleInputLabel"
									:placeholder="bottleInputPlaceholder"
									prefix-icon="bottle"
									size="sm"
								/>
							</view>
						<view class="form-item">
							<AppInput v-model="form.fill_weight" label="灌装净重" placeholder="0.00" size="sm" />
						</view>
							<view class="form-item">
								<picker class="picker-full" mode="selector" :range="operatorOptions" range-key="label" @change="onOperatorChange">
									<AppInput :model-value="operatorLabel" label="操作人" placeholder="请选择操作人" disabled prefix-icon="user" size="sm" />
								</picker>
							</view>
							<view class="form-item span-2">
								<AppInput v-model="form.remark" label="作业备注" placeholder="异常说明或备注信息" size="sm" />
							</view>
						</view>
				</AppSection>
			</view>

			<view class="safe-area-bottom"></view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, reactive, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { createFillingV1, getFillingV1, updateFillingV1 } from '@/services/filling'
import { searchDeliveriesV1 } from '@/services/delivery'

const RECORD_TYPE_OPTIONS = [
	{ label: '常规灌装', value: 'normal_fill' },
	{ label: '代理销售', value: 'truck_out_agent_sale' },
	{ label: '车辆燃气补给', value: 'truck_out_no_sale' }
]
const DEFAULT_OPERATOR_NAME = '陈铁栓'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')

function formatTodayUtc8() {
	const now = new Date()
	const utc8Time = now.getTime() + 8 * 60 * 60 * 1000
	const date = new Date(utc8Time)
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function normalizeRecordType(value, fallback = 'normal_fill') {
	const text = String(value || '').trim().toLowerCase()
	if (!text) return fallback
	if (RECORD_TYPE_OPTIONS.some((item) => item.value === text)) return text
	return fallback
}

function isInventoryLinkedRecordType(value) {
	const recordType = normalizeRecordType(value, '')
	return recordType === 'normal_fill' || recordType === 'truck_out_agent_sale'
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		const oid = normalizeString(value.$oid || value.oid || value.id)
		if (oid) return oid
	}
	return normalizeString(value)
}

const submitting = ref(false)
const isLoadingDetail = ref(false)
const operatorOptions = ref([])
const isLoadingOperatorOptions = ref(false)

const form = reactive({
	date: formatTodayUtc8(),
	bottle_no: '',
	record_type: 'normal_fill',
	operator: '',
	operator_id: '',
	fill_weight: '',
	remark: ''
})

const isEditMode = computed(() => Boolean(String(recordId.value || '').trim()))
const pageTitle = computed(() => (isEditMode.value ? '灌装作业编辑' : '灌装作业录入'))
const pageSubtitle = computed(() => (isEditMode.value ? 'FILLING EDIT' : 'FILLING RECORD'))
const submitText = computed(() => (isEditMode.value ? '保存修改' : '保存灌装记录'))

const recordTypeOptions = computed(() => RECORD_TYPE_OPTIONS)
const dateSummary = computed(() => String(form.date || '').trim() || '未选择')
const bottleSummary = computed(() => String(form.bottle_no || '').trim() || '未填写')
const recordTypeLabel = computed(() => {
	const current = normalizeRecordType(form.record_type)
	return RECORD_TYPE_OPTIONS.find((item) => item.value === current)?.label || '常规灌装'
})
const bottleRequired = computed(() => isInventoryLinkedRecordType(form.record_type))
const bottleInputLabel = computed(() => (bottleRequired.value ? '钢瓶编号' : '钢瓶编号（可空）'))
const bottleInputPlaceholder = computed(() =>
	bottleRequired.value ? '请输入瓶号' : '可不填（车辆燃气补给类型）'
)
const operatorLabel = computed(() => {
	const current = normalizeString(form.operator)
	if (current) return current
	if (isLoadingOperatorOptions.value) return '加载中...'
	return '未选择'
})
const weightSummary = computed(() => {
	const value = String(form.fill_weight || '').trim()
	return value ? `${value} kg` : '未填写'
})

function onDateChange(e) {
	form.date = e?.detail?.value || ''
}

function onRecordTypeChange(e) {
	const idx = Number(e?.detail?.value)
	form.record_type = RECORD_TYPE_OPTIONS[idx]?.value || 'normal_fill'
}

function setOperatorByOption(option) {
	if (!option || typeof option !== 'object') return
	form.operator = normalizeString(option.name || option.label)
	form.operator_id = normalizeId(option.id || option._id)
}

function ensureOperatorOptionByCurrent() {
	const name = normalizeString(form.operator)
	if (!name) return
	const currentId = normalizeId(form.operator_id)
	const matched = operatorOptions.value.find((item) => {
		const itemId = normalizeId(item.id || item._id)
		const itemName = normalizeString(item.name || item.label)
		if (currentId && itemId) return itemId === currentId
		return itemName === name
	})
	if (matched) {
		setOperatorByOption(matched)
		return
	}
	operatorOptions.value = [
		{ id: currentId, name, label: name },
		...operatorOptions.value
	]
}

function applyDefaultOperatorForCreate() {
	if (isEditMode.value) return
	if (normalizeString(form.operator)) return
	const preferred =
		operatorOptions.value.find((item) => normalizeString(item.name || item.label) === DEFAULT_OPERATOR_NAME) ||
		operatorOptions.value[0]
	if (preferred) setOperatorByOption(preferred)
}

function onOperatorChange(e) {
	const idx = Number(e?.detail?.value)
	const option = operatorOptions.value[idx]
	if (!option) return
	setOperatorByOption(option)
}

function isFillingBottleFlowWarningResult(result) {
	return Number(result?.code || 0) === 409
		&& Boolean(result?.data?.confirmable)
		&& String(result?.data?.warning_kind || '') === 'bottle_flow_mismatch'
		&& Array.isArray(result?.data?.warning_items)
		&& result.data.warning_items.length > 0
}

function buildFillingBottleFlowWarningContent(result) {
	const items = Array.isArray(result?.data?.warning_items) ? result.data.warning_items : []
	const summaryText = normalizeString(result?.data?.summary_text || result?.msg || '发现瓶流转异常，请核对')
	const preview = items.slice(0, 6).map((item, index) => {
		const bottleNo = normalizeString(item?.bottle_no) || '-'
		const reason = normalizeString(item?.reason) || '请检查'
		return `${index + 1}. ${bottleNo}：${reason}`
	})
	if (items.length > preview.length) preview.push(`等 ${items.length} 条，请确认是否仍要继续提交。`)
	else preview.push('请确认是否仍要继续提交。')
	return [summaryText, '', ...preview].join('\n')
}

async function loadOperatorOptions() {
	if (isLoadingOperatorOptions.value) return
	isLoadingOperatorOptions.value = true
	try {
		const rows = []
		let page = 1
		while (page <= 20) {
			const res = await searchDeliveriesV1({ is_active: true, page, pageSize: 50 })
			if (res?.code !== 0) break
			const pageRows = Array.isArray(res.data) ? res.data : []
			rows.push(...pageRows)
			const hasMore = Boolean(res?.paging?.hasMore)
			if (!hasMore || !pageRows.length) break
			page += 1
		}
		operatorOptions.value = rows
			.map((row) => ({
				id: normalizeId(row && row._id),
				name: normalizeString(row && row.name),
				label: normalizeString(row && row.name)
			}))
			.filter((row) => row.name)
		ensureOperatorOptionByCurrent()
		applyDefaultOperatorForCreate()
	} catch (err) {
		console.error('load operator options failed', err)
	} finally {
		isLoadingOperatorOptions.value = false
	}
}

async function onSubmit() {
	if (submitting.value || isLoadingDetail.value) return
	if (!String(form.date || '').trim()) {
		uni.showToast({ title: '日期必填', icon: 'none' })
		return
	}
	const recordType = normalizeRecordType(form.record_type)
	const bottleNo = String(form.bottle_no || '').trim()
	if (isInventoryLinkedRecordType(recordType) && !bottleNo) {
		uni.showToast({ title: '该作业类型必须填写瓶号', icon: 'none' })
		return
	}
	if (!normalizeString(form.operator)) {
		uni.showToast({ title: '请选择操作人', icon: 'none' })
		return
	}
	const weight = Number(form.fill_weight)
	if (!Number.isFinite(weight) || weight <= 0) {
		uni.showToast({ title: '灌装重量必填且大于 0', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const payload = {
			date: String(form.date || '').trim(),
			bottle_no: bottleNo,
			record_type: recordType,
			operator: normalizeString(form.operator),
			operator_id: normalizeId(form.operator_id),
			fill_weight: weight,
			remark: String(form.remark || '').trim()
		}
		let result = isEditMode.value
			? await updateFillingV1({ _id: recordId.value, ...payload })
			: await createFillingV1(payload)
		if (isFillingBottleFlowWarningResult(result)) {
			const confirmRes = await uni.showModal({
				title: '请核对瓶号',
				content: buildFillingBottleFlowWarningContent(result),
				confirmText: '继续提交',
				cancelText: '返回修改'
			})
			if (!confirmRes.confirm) return
			result = isEditMode.value
				? await updateFillingV1({ _id: recordId.value, ...payload, ignoreBottleFlowWarning: true })
				: await createFillingV1(payload, { ignoreBottleFlowWarning: true })
		}

		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}

		const savedWithOverride = Boolean(result?.data?.bottle_flow_warning_overridden) && Number(result?.data?.bottle_flow_warning_count || 0) > 0
		uni.showToast({
			title: savedWithOverride ? '已核对并保存' : (isEditMode.value ? '更新成功' : '保存成功'),
			icon: 'success'
		})
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save filling failed', err)
		uni.showToast({ title: '保存失败', icon: 'none' })
	} finally {
		submitting.value = false
	}
}

function onCancel() {
	uni.navigateBack({ delta: 1 })
}

watch(
	recordId,
	async (id) => {
		const normalized = String(id || '').trim()
		if (!normalized) return
		isLoadingDetail.value = true
		try {
			const res = await getFillingV1({ _id: normalized })
			if (res?.code !== 0) {
				uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
				return
			}
				const row = res.data || {}
				form.date = String(row.date || '')
				form.bottle_no = String(row.bottle_no || '')
				form.record_type = normalizeRecordType(row.record_type)
				form.operator = normalizeString(row.operator || row.created_by_name)
				form.operator_id = normalizeId(row.operator_id || row.created_by)
				form.fill_weight = String(row.fill_weight ?? '')
				form.remark = String(row.remark || '')
				ensureOperatorOptionByCurrent()
			} finally {
				isLoadingDetail.value = false
			}
		},
		{ immediate: true }
)

onMounted(() => {
	loadOperatorOptions()
})
</script>

<style scoped>
.edit-container {
	padding-bottom: 48rpx;
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.edit-header-card {
	box-shadow: 0 12rpx 32rpx rgba(15, 23, 42, 0.06);
}

.edit-header-info {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
}

.info-pill {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 12rpx 16rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
}

.pill-label {
	font-size: 18rpx;
	color: var(--crm-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.6rpx;
}

.pill-value {
	font-size: 26rpx;
	color: var(--crm-text);
	font-weight: 700;
}

.form-body {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.form-item {
	display: flex;
	flex-direction: column;
}

.span-2 {
	grid-column: span 2;
}

.safe-area-bottom {
	height: constant(safe-area-inset-bottom);
	height: env(safe-area-inset-bottom);
}

.form-body :deep(.section__header) {
	padding: 12rpx 20rpx;
}

.form-body :deep(.section__body) {
	padding: 20rpx;
}

@media (max-width: 720px) {
	.form-grid {
		grid-template-columns: 1fr;
	}
	.span-2 {
		grid-column: auto;
	}
}
</style>
