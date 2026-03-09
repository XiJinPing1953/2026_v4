<template>
	<AppPage :title="recordId ? '修改配送员档案' : '新建配送员档案'" subtitle="DELIVERY PROFILE" icon="user">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">
				保存配送员档案
			</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">在岗状态</text>
						<text class="pill-value">{{ activeLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">配送员姓名</text>
						<text class="pill-value">{{ nameSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">联系电话</text>
						<text class="pill-value">{{ phoneSummary }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="配送员信息">
					<view class="form-grid">
						<view class="form-item">
							<AppInput v-model="form.name" label="姓名" placeholder="请输入配送员姓名" prefix-icon="user" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.phone" label="手机号" placeholder="请输入手机号（可选）" prefix-icon="list" size="sm" />
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.remark" label="备注说明" placeholder="可选填班次、负责片区等信息" size="sm" />
						</view>
					</view>
				</AppSection>

				<AppSection title="档案状态">
					<view class="form-grid">
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
								<AppInput :model-value="activeLabel" label="在岗状态" disabled prefix-icon="list" size="sm" />
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
import { createDeliveryV1, getDeliveryV1, updateDeliveryV1 } from '@/services/delivery'
import { normalizeDeliveryName, normalizeDeliveryPhone, validateDeliveryDraftV1 } from '@/services/models'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const submitting = ref(false)

const activeOptions = [
	{ label: '在岗', value: true },
	{ label: '离岗', value: false }
]

const form = reactive({
	name: '',
	phone: '',
	remark: '',
	is_active: true
})

const activeLabel = computed(() => (form.is_active ? '在岗' : '离岗'))

const nameSummary = computed(() => {
	const value = String(form.name || '').trim()
	return value || '未填写'
})

const phoneSummary = computed(() => {
	const value = String(form.phone || '').trim()
	return value || '未填写'
})

function onActiveChange(e) {
	const idx = Number(e && e.detail && e.detail.value)
	const item = activeOptions[idx]
	if (item) form.is_active = Boolean(item.value)
}

async function loadRecord(id) {
	const res = await getDeliveryV1({ _id: id })
	if (!res || res.code !== 0 || !res.data) {
		uni.showToast({ title: res && res.msg || '加载失败', icon: 'none' })
		return
	}
	const doc = res.data
	form.name = doc.name || ''
	form.phone = doc.phone || ''
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

	const payload = {
		name: normalizeDeliveryName(form.name),
		phone: normalizeDeliveryPhone(form.phone),
		remark: String(form.remark || '').trim(),
		is_active: form.is_active
	}
	const validation = validateDeliveryDraftV1(payload)
	if (!validation.ok) {
		uni.showToast({ title: validation.msg || '参数不完整', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const result = recordId.value
			? await updateDeliveryV1({ _id: recordId.value, ...payload })
			: await createDeliveryV1(payload)

		if (!result || result.code !== 0) {
			uni.showToast({ title: result && result.msg || '保存失败', icon: 'none' })
			return
		}

		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save delivery failed', err)
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
