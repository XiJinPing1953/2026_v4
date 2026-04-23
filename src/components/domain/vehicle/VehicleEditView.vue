<template>
	<AppPage :title="recordId ? '修改车辆档案' : '新建车辆档案'" subtitle="VEHICLE PROFILE" icon="truck">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">
				保存车辆档案
			</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">启用状态</text>
						<text class="pill-value">{{ activeLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">车牌号码</text>
						<text class="pill-value">{{ plateSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">备注信息</text>
						<text class="pill-value">{{ remarkSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">二维码</text>
						<text class="pill-value">{{ qrCodeSummary }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="车辆信息">
					<view class="form-grid">
						<view class="form-item span-2">
							<AppInput v-model="form.plate_no" label="车牌号码" placeholder="请输入车牌号" prefix-icon="truck" size="sm" />
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.qr_code" label="二维码号" placeholder="车辆二维码" size="sm" />
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.remark" label="备注说明" placeholder="可选填车辆品牌、型号等信息" size="sm" />
						</view>
					</view>
				</AppSection>

				<AppSection title="档案状态">
					<view class="form-grid">
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
								<AppInput :model-value="activeLabel" label="启用状态" disabled prefix-icon="list" size="sm" />
							</picker>
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
import { createVehicleV1, getVehicleV1, updateVehicleV1 } from '@/services/vehicle'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const submitting = ref(false)

const activeOptions = [
	{ label: '启用中', value: true },
	{ label: '已停用', value: false }
]

const form = reactive({
	plate_no: '',
	qr_code: '',
	remark: '',
	is_active: true
})

const activeLabel = computed(() => (form.is_active ? '启用中' : '已停用'))

const plateSummary = computed(() => {
	const value = String(form.plate_no || '').trim()
	return value || '未填写'
})

const remarkSummary = computed(() => {
	const value = String(form.remark || '').trim()
	return value || '暂无备注'
})

const qrCodeSummary = computed(() => {
	const value = normalizeQrCode(form.qr_code)
	return value || '未绑定'
})

function normalizeQrCode(value) {
	if (value == null) return ''
	return String(value).trim().toUpperCase().replace(/\s+/g, '')
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	const item = activeOptions[idx]
	if (item) form.is_active = Boolean(item.value)
}

async function loadRecord(id) {
	const res = await getVehicleV1({ _id: id })
	if (res?.code !== 0 || !res?.data) {
		uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
		return
	}
	const doc = res.data
	form.plate_no = doc.plate_no || ''
	form.qr_code = doc.qr_code || ''
	form.remark = doc.remark || ''
	form.is_active = Boolean(doc.is_active)
}

watch(
	recordId,
	async (id) => {
		if (!id) return
		await loadRecord(String(id))
	},
	{ immediate: true }
)

async function onSubmit() {
	if (submitting.value) return
	if (!String(form.plate_no || '').trim()) {
		uni.showToast({ title: '车牌号必填', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const payload = {
			plate_no: String(form.plate_no || '').trim(),
			qr_code: normalizeQrCode(form.qr_code),
			remark: String(form.remark || '').trim(),
			is_active: form.is_active
		}

		const result = recordId.value
			? await updateVehicleV1({ _id: recordId.value, ...payload })
			: await createVehicleV1(payload)

		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}

		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save vehicle failed', err)
		uni.showToast({ title: '保存失败', icon: 'none' })
	} finally {
		submitting.value = false
	}
}

function onCancel() {
	uni.navigateBack({ delta: 1 })
}
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
