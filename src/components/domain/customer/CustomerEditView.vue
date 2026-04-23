<template>
	<AppPage :title="recordId ? '修改客户档案' : '新建客户档案'" subtitle="CUSTOMER PROFILE" icon="user">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">
				保存客户档案
			</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">档案状态</text>
						<text class="pill-value">{{ activeLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">默认单价</text>
						<text class="pill-value">{{ priceSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">计价单位</text>
						<text class="pill-value">{{ form.default_price_unit || 'kg' }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">主要联系人</text>
						<text class="pill-value">{{ contactSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">二维码</text>
						<text class="pill-value">{{ qrCodeSummary }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="基础信息">
					<view class="form-grid">
						<view class="form-item span-2">
							<AppInput v-model="form.name" label="客户全称" placeholder="请输入营业执照名称" prefix-icon="user" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.short_name" label="客户简称" placeholder="便于搜索的简称" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.contact" label="主要联系人" placeholder="负责人姓名" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.phone" label="联系电话" placeholder="手机或座机" prefix-icon="calendar" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.qr_code" label="二维码号" placeholder="客户二维码" size="sm" />
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.address" label="配送地址" placeholder="详细的送货地址" size="sm" />
						</view>
					</view>
				</AppSection>

				<AppSection title="商务定价">
					<view class="form-grid">
						<view class="form-item">
							<AppInput v-model="form.default_unit_price" label="默认销售单价" placeholder="0.00" size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="priceUnitOptions" @change="onPriceUnitChange">
								<AppInput :model-value="form.default_price_unit" label="计价单位" placeholder="请选择单位" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
					</view>
				</AppSection>

				<AppSection title="状态管理">
					<view class="form-grid">
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
								<AppInput :model-value="activeLabel" label="启用状态" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.remark" label="备注说明" placeholder="其他需要记录的信息" size="sm" />
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
import { createCustomerV1, getCustomerV1, updateCustomerV1 } from '@/services/customer'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const submitting = ref(false)

const priceUnitOptions = ['kg', 'bottle', 'm3']
const activeOptions = [
	{ label: '启用中', value: true },
	{ label: '已停用', value: false }
]

const form = reactive({
	name: '',
	short_name: '',
	contact: '',
	phone: '',
	qr_code: '',
	address: '',
	remark: '',
	is_active: true,
	default_unit_price: '',
	default_price_unit: 'kg'
})

const activeLabel = computed(() => (form.is_active ? '启用中' : '已停用'))

const priceSummary = computed(() => {
	const value = String(form.default_unit_price || '').trim()
	if (!value) return '未设置'
	return `¥${value}`
})

const contactSummary = computed(() => {
	const contact = String(form.contact || '').trim()
	const phone = String(form.phone || '').trim()
	if (contact && phone) return `${contact} / ${phone}`
	return contact || phone || '未填写'
})

const qrCodeSummary = computed(() => {
	const value = normalizeQrCode(form.qr_code)
	return value || '未绑定'
})

function normalizeQrCode(value) {
	if (value == null) return ''
	return String(value).trim().toUpperCase().replace(/\s+/g, '')
}

function onPriceUnitChange(e) {
	const idx = Number(e?.detail?.value)
	const unit = priceUnitOptions[idx]
	if (unit) form.default_price_unit = unit
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	const item = activeOptions[idx]
	if (!item) return
	form.is_active = Boolean(item.value)
}

async function loadRecord(id) {
	const res = await getCustomerV1({ _id: id })
	if (res?.code !== 0 || !res?.data) {
		uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
		return
	}
	const doc = res.data
	form.name = doc.name || ''
	form.short_name = doc.short_name || ''
	form.contact = doc.contact || ''
	form.phone = doc.phone || ''
	form.qr_code = doc.qr_code || ''
	form.address = doc.address || ''
	form.remark = doc.remark || ''
	form.is_active = Boolean(doc.is_active)
	form.default_unit_price = doc.default_unit_price == null ? '' : String(doc.default_unit_price)
	form.default_price_unit = doc.default_price_unit || 'kg'
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
	if (!String(form.name || '').trim()) {
		uni.showToast({ title: '客户名称必填', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const payload = {
			...form,
			qr_code: normalizeQrCode(form.qr_code),
			default_unit_price: String(form.default_unit_price || '').trim()
		}

		const result = recordId.value
			? await updateCustomerV1({ _id: recordId.value, ...payload })
			: await createCustomerV1(payload)

		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}

		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save customer failed', err)
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
