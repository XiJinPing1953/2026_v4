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
						<text class="pill-label">灌装净重</text>
						<text class="pill-value">{{ weightSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">作业地点</text>
						<text class="pill-value">{{ addressSummary }}</text>
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
							<AppInput v-model="form.bottle_no" label="钢瓶编号" placeholder="请输入瓶号" prefix-icon="bottle" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.fill_weight" label="灌装净重" placeholder="0.00" size="sm" />
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.address" label="作业地点" placeholder="灌装站点或客户地址" size="sm" />
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
import { computed, reactive, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { createFillingV1, getFillingV1, updateFillingV1 } from '@/services/filling'

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

const submitting = ref(false)
const isLoadingDetail = ref(false)

const form = reactive({
	date: formatTodayUtc8(),
	bottle_no: '',
	fill_weight: '',
	address: '',
	remark: ''
})

const isEditMode = computed(() => Boolean(String(recordId.value || '').trim()))
const pageTitle = computed(() => (isEditMode.value ? '灌装作业编辑' : '灌装作业录入'))
const pageSubtitle = computed(() => (isEditMode.value ? 'FILLING EDIT' : 'FILLING RECORD'))
const submitText = computed(() => (isEditMode.value ? '保存修改' : '保存灌装记录'))

const dateSummary = computed(() => String(form.date || '').trim() || '未选择')

const bottleSummary = computed(() => String(form.bottle_no || '').trim() || '未填写')

const weightSummary = computed(() => {
	const value = String(form.fill_weight || '').trim()
	return value ? `${value} kg` : '未填写'
})

const addressSummary = computed(() => String(form.address || '').trim() || '站内灌装')

function onDateChange(e) {
	form.date = e?.detail?.value || ''
}

async function onSubmit() {
	if (submitting.value) return
	if (isLoadingDetail.value) return
	if (!String(form.date || '').trim()) {
		uni.showToast({ title: '日期必填', icon: 'none' })
		return
	}
	if (!String(form.bottle_no || '').trim()) {
		uni.showToast({ title: '瓶号必填', icon: 'none' })
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
			bottle_no: String(form.bottle_no || '').trim(),
			fill_weight: weight,
			address: String(form.address || '').trim(),
			remark: String(form.remark || '').trim()
		}
		const result = isEditMode.value
			? await updateFillingV1({ _id: recordId.value, ...payload })
			: await createFillingV1(payload)

		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}

		uni.showToast({ title: isEditMode.value ? '更新成功' : '保存成功', icon: 'success' })
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
			form.fill_weight = String(row.fill_weight ?? '')
			form.address = String(row.address || '')
			form.remark = String(row.remark || '')
		} finally {
			isLoadingDetail.value = false
		}
	},
	{ immediate: true }
)
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
