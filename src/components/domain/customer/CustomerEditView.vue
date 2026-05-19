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
					<view class="info-pill">
						<text class="pill-label">结算关系</text>
						<text class="pill-value">{{ settlementSummary }}</text>
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

				<AppSection title="结算关系">
					<template #actions>
						<AppButton size="sm" kind="ghost" :disabled="submitting" @click="clearSettlementCustomer">自己结算</AppButton>
					</template>
					<view class="form-grid">
						<view class="form-item span-2 settlement-field">
							<AppInput
								:model-value="form.settlement_customer_name"
								label="结算客户"
								placeholder="不选则该客户自己结算"
								prefix-icon="user"
								size="sm"
								@update:modelValue="onSettlementCustomerInput"
								@focus="onSettlementCustomerFocus"
								@blur="onSettlementCustomerBlur"
								@confirm="onSettlementCustomerConfirm"
							/>
							<view v-if="showSettlementSuggestions" class="settlement-suggestions">
								<view
									v-for="item in settlementSuggestions"
									:key="item._id"
									class="settlement-suggestion"
									@tap.stop="selectSettlementCustomer(item)"
									@click.stop="selectSettlementCustomer(item)"
								>
									<text class="settlement-suggestion__name">{{ item.name }}</text>
									<text v-if="item.contact || item.phone" class="settlement-suggestion__sub">{{ [item.contact, item.phone].filter(Boolean).join(' · ') }}</text>
								</view>
								<view v-if="settlementSuggestions.length === 0" class="settlement-suggestion settlement-suggestion--empty">
									<text>未找到可绑定客户</text>
								</view>
							</view>
							<text class="field-hint">送达地点绑定结算客户后，销售欠款和收款对账归到结算客户；存瓶和气瓶流转仍归当前地点。</text>
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
import { createCustomerV1, getCustomerV1, listCustomersV1, updateCustomerV1 } from '@/services/customer'

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
	settlement_customer_id: '',
	settlement_customer_name: '',
	default_unit_price: '',
	default_price_unit: 'kg'
})
const settlementSuggestions = ref([])
const showSettlementSuggestions = ref(false)
let settlementFetchTimer = null

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
const settlementSummary = computed(() => {
	const name = String(form.settlement_customer_name || '').trim()
	return name ? `归 ${name} 结算` : '自己结算'
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
	form.settlement_customer_id = doc.settlement_customer_id || ''
	form.settlement_customer_name = doc.settlement_customer_name || ''
	form.default_unit_price = doc.default_unit_price == null ? '' : String(doc.default_unit_price)
	form.default_price_unit = doc.default_price_unit || 'kg'
}

function clearSettlementCustomer() {
	form.settlement_customer_id = ''
	form.settlement_customer_name = ''
	settlementSuggestions.value = []
	showSettlementSuggestions.value = false
}

function onSettlementCustomerInput(value) {
	form.settlement_customer_name = value
	form.settlement_customer_id = ''
	if (settlementFetchTimer) clearTimeout(settlementFetchTimer)
	const keyword = String(value || '').trim()
	if (!keyword) {
		clearSettlementCustomer()
		return
	}
	showSettlementSuggestions.value = true
	settlementFetchTimer = setTimeout(() => {
		fetchSettlementCustomers(keyword)
	}, 200)
}

async function fetchSettlementCustomers(keyword) {
	const key = String(keyword || '').trim()
	if (!key) {
		settlementSuggestions.value = []
		showSettlementSuggestions.value = false
		return
	}
	const res = await listCustomersV1({ keyword: key, pageSize: 20, is_active: true, settlementOnly: true })
	if (res?.code !== 0) {
		settlementSuggestions.value = []
		return
	}
	const currentId = String(recordId.value || '').trim()
	settlementSuggestions.value = (Array.isArray(res.data) ? res.data : [])
		.filter((item) => String(item?._id || '').trim() && String(item?._id || '').trim() !== currentId)
		.slice(0, 20)
}

function selectSettlementCustomer(item) {
	form.settlement_customer_id = item?._id || ''
	form.settlement_customer_name = item?.name || ''
	settlementSuggestions.value = []
	showSettlementSuggestions.value = false
}

function onSettlementCustomerFocus() {
	const keyword = String(form.settlement_customer_name || '').trim()
	if (!keyword) return
	showSettlementSuggestions.value = true
	if (settlementFetchTimer) clearTimeout(settlementFetchTimer)
	settlementFetchTimer = setTimeout(() => fetchSettlementCustomers(keyword), 120)
}

function onSettlementCustomerBlur() {
	setTimeout(() => {
		showSettlementSuggestions.value = false
	}, 160)
}

function onSettlementCustomerConfirm() {
	if (settlementSuggestions.value.length > 0) {
		selectSettlementCustomer(settlementSuggestions.value[0])
		return
	}
	form.settlement_customer_name = String(form.settlement_customer_name || '').trim()
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

.settlement-field {
	position: relative;
}

.settlement-suggestions {
	position: absolute;
	top: calc(100% - 32rpx);
	left: 0;
	right: 0;
	z-index: 80;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	box-shadow: 0 12rpx 28rpx rgba(15, 23, 42, 0.1);
	overflow: hidden;
}

.settlement-suggestion {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
	padding: 16rpx 18rpx;
	border-bottom: 1rpx solid #f1f5f9;
}

.settlement-suggestion:last-child {
	border-bottom: none;
}

.settlement-suggestion__name {
	font-size: 26rpx;
	font-weight: 700;
	color: #0f172a;
}

.settlement-suggestion__sub {
	font-size: 22rpx;
	color: #64748b;
}

.settlement-suggestion--empty {
	justify-content: center;
	color: #64748b;
	font-size: 24rpx;
}

.field-hint {
	margin-top: 10rpx;
	font-size: 22rpx;
	line-height: 1.5;
	color: #64748b;
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
