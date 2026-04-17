<template>
	<AppPage title="销售录入" subtitle="瓶装 kg" icon="document" hideBottleQuery>
		<view class="stepper">
			<view
				v-for="step in steps"
				:key="step.value"
				:class="['step-chip', currentStep === step.value ? 'step-chip--active' : '', currentStep > step.value ? 'step-chip--done' : '']"
				@click="goStep(step.value)"
			>
				<text class="step-chip__index">{{ step.value }}</text>
				<view class="step-chip__content">
					<text class="step-chip__title">{{ step.title }}</text>
					<text class="step-chip__desc">{{ step.desc }}</text>
				</view>
			</view>
		</view>

		<template v-if="currentStep === 1">
			<AppSection title="1. 选择客户">
				<view class="customer-search-row">
					<view class="customer-search-field">
						<AppInput
							v-model="customerKeyword"
							label="客户搜索"
							placeholder="输入客户名称 / 联系人 / 手机"
							@input="onCustomerKeywordInput"
							@focus="onCustomerFocus"
							@blur="onCustomerBlur"
							@confirm="onCustomerConfirm"
						/>
						<PdaSuggestList
							:visible="customerSuggestVisible"
							:loading="customerSuggestLoading"
							:items="customerSuggestItems"
							empty-text="未找到匹配客户"
							@select="onSelectCustomer"
						/>
					</view>
					<view class="customer-search-actions">
						<AppButton v-if="form.customerId || customerKeyword" size="sm" kind="neutral" @click="onClearCustomer">清空</AppButton>
					</view>
				</view>

				<view v-if="selectedCustomer" class="selected-customer">
					<view class="selected-customer__row">
						<text class="selected-customer__name">{{ selectedCustomer.name || '-' }}</text>
						<AppTag kind="soft">kg</AppTag>
					</view>
					<view class="selected-customer__meta">
						<text class="meta-text">联系人 {{ selectedCustomer.contact || '-' }}</text>
						<text class="meta-text">电话 {{ selectedCustomer.phone || '-' }}</text>
						<text class="meta-text">应收 {{ formatMoney(selectedCustomer.receivable_balance) }}</text>
						<text class="meta-text">预收 {{ formatMoney(selectedCustomer.prepay_balance) }}</text>
						<text class="meta-text">净额 {{ formatMoney(selectedCustomer.net_balance) }}</text>
						<text class="meta-text">存瓶 {{ Number(selectedCustomer.deposit_count || 0) }}</text>
					</view>
					<text class="selected-customer__price">默认单价 {{ form.unitPrice || '-' }} / kg</text>
					<text v-if="customerPricingWarning" class="warning-text">{{ customerPricingWarning }}</text>
				</view>

			</AppSection>

			<AppSection title="基础信息">
				<view class="form-grid">
					<picker class="picker-block" mode="date" :value="form.date" @change="onDateChange">
						<view class="picker-trigger">
							<AppInput :model-value="form.date" label="日期" readonly placeholder="请选择日期" />
						</view>
					</picker>
					<AppInput :model-value="form.unitPrice" label="单价(元/kg)" readonly />
					<AppInput v-model="form.delivery1" label="配送员 1" placeholder="可选" @input="markDepositDirty" />
					<AppInput v-model="form.delivery2" label="配送员 2" placeholder="可选" @input="markDepositDirty" />
					<AppInput v-model="form.vehicleNo" label="车牌号" placeholder="可选" @input="markDepositDirty" />
				</view>
				<view class="textarea-field">
					<text class="textarea-label">备注</text>
					<textarea v-model="form.remark" class="textarea-control" maxlength="120" placeholder="可选备注" />
				</view>
			</AppSection>

			<view class="wizard-actions">
				<AppButton :disabled="!canGoToBottleStep" @click="enterBottleStep">下一步：录出回瓶</AppButton>
			</view>
		</template>

		<template v-else-if="currentStep === 2">
			<AppSection title="当前客户">
				<view class="summary-grid">
					<view class="summary-cell">
						<text class="summary-label">客户</text>
						<text class="summary-value">{{ selectedCustomer?.name || form.customerName || '-' }}</text>
					</view>
					<view class="summary-cell">
						<text class="summary-label">日期</text>
						<text class="summary-value">{{ form.date || '-' }}</text>
					</view>
					<view class="summary-cell">
						<text class="summary-label">单价</text>
						<text class="summary-value">{{ form.unitPrice || '-' }}/kg</text>
					</view>
					<view class="summary-cell">
						<text class="summary-label">存瓶基线</text>
						<text class="summary-value">{{ form.depositCount || 0 }} 瓶</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="2. 出瓶">
				<view class="section-toolbar">
					<AppButton size="sm" kind="neutral" @click="addOutItem">新增出瓶</AppButton>
				</view>
				<view class="rows-wrap">
					<AppCard v-for="(row, index) in form.outItems" :key="`out-${index}`" padding="20rpx">
						<view class="row-header">
							<text class="row-title">出瓶 {{ index + 1 }}</text>
							<AppButton size="sm" kind="ghost" @click="removeOutItem(index)">删除</AppButton>
						</view>
						<view class="row-grid">
							<PdaBottleSuggestField
								v-model="row.bottleNo"
								label="瓶号"
								placeholder="请输入瓶号"
								@blur="normalizeOutBottle(index)"
								@input="onBottleInput('out', index)"
								@select="onSelectBottleSuggestion('out', index, $event)"
							/>
							<AppInput v-model="row.net" label="净重(kg)" placeholder="请输入净重" type="digit" @input="markDepositDirty" />
						</view>
						<view class="item-actions">
							<AppButton size="sm" kind="neutral" :loading="resolvingBottleKey === `out:${index}`" @click="onResolveBottle('out', index)">
								查瓶
							</AppButton>
						</view>
					</AppCard>
				</view>
			</AppSection>

			<AppSection title="回瓶">
				<view class="section-toolbar">
					<AppButton size="sm" kind="neutral" @click="addBackItem">新增回瓶</AppButton>
				</view>
				<view v-if="form.backItems.length === 0" class="hint-box">
					<text class="hint-text">本次没有回瓶可留空。</text>
				</view>
				<view class="rows-wrap">
					<AppCard v-for="(row, index) in form.backItems" :key="`back-${index}`" padding="20rpx">
						<view class="row-header">
							<text class="row-title">回瓶 {{ index + 1 }}</text>
							<AppButton size="sm" kind="ghost" @click="removeBackItem(index)">删除</AppButton>
						</view>
						<view class="row-grid row-grid--back">
							<PdaBottleSuggestField
								v-model="row.bottleNo"
								label="瓶号"
								placeholder="请输入瓶号"
								@blur="normalizeBackBottle(index)"
								@input="onBottleInput('back', index)"
								@select="onSelectBottleSuggestion('back', index, $event)"
							/>
							<AppInput v-model="row.gross" label="毛重(kg)" placeholder="可选" type="digit" @input="syncBackRow(index)" />
							<AppInput v-model="row.tare" label="空瓶重(kg)" placeholder="可选" type="digit" @input="syncBackRow(index)" />
							<AppInput v-model="row.net" label="净重(kg)" placeholder="可手填" type="digit" @input="syncBackRow(index)" />
						</view>
						<view class="item-actions">
							<AppButton size="sm" kind="neutral" :loading="resolvingBottleKey === `back:${index}`" @click="onResolveBottle('back', index)">
								查瓶补空瓶重
							</AppButton>
						</view>
					</AppCard>
				</view>
			</AppSection>

			<view class="wizard-actions">
				<AppButton kind="neutral" @click="currentStep = 1">上一步：客户</AppButton>
				<AppButton @click="enterPreviewStep">下一步：预览提交</AppButton>
			</view>
		</template>

		<template v-else>
			<AppSection title="3. 提交预览">
				<view class="summary-grid">
					<view class="summary-cell">
						<text class="summary-label">客户</text>
						<text class="summary-value">{{ selectedCustomer?.name || form.customerName || '-' }}</text>
					</view>
					<view class="summary-cell">
						<text class="summary-label">日期</text>
						<text class="summary-value">{{ form.date || '-' }}</text>
					</view>
					<view class="summary-cell">
						<text class="summary-label">单价</text>
						<text class="summary-value">{{ form.unitPrice || '-' }}/kg</text>
					</view>
					<view class="summary-cell">
						<text class="summary-label">出瓶行数</text>
						<text class="summary-value">{{ outPreviewRows.length }}</text>
					</view>
					<view class="summary-cell">
						<text class="summary-label">回瓶行数</text>
						<text class="summary-value">{{ backPreviewRows.length }}</text>
					</view>
					<view class="summary-cell" v-for="item in headerSummary" :key="item.label">
						<text class="summary-label">{{ item.label }}</text>
						<text class="summary-value">{{ item.value }}</text>
					</view>
				</view>

				<view class="preview-block">
					<text class="preview-title">出瓶明细</text>
					<view v-if="outPreviewRows.length > 0" class="preview-list">
						<view v-for="row in outPreviewRows" :key="`preview-out-${row.bottleNo}`" class="preview-row">
							<text class="preview-row__name">{{ row.bottleNo }}</text>
							<text class="preview-row__value">{{ formatWeight(row.net) }} kg</text>
						</view>
					</view>
					<view v-else class="hint-box">
						<text class="hint-text">暂无有效出瓶行。</text>
					</view>
				</view>

				<view class="preview-block">
					<text class="preview-title">回瓶明细</text>
					<view v-if="backPreviewRows.length > 0" class="preview-list">
						<view v-for="row in backPreviewRows" :key="`preview-back-${row.bottleNo}`" class="preview-row">
							<text class="preview-row__name">{{ row.bottleNo }}</text>
							<text class="preview-row__value">{{ formatWeight(row.net) }} kg</text>
						</view>
					</view>
					<view v-else class="hint-box">
						<text class="hint-text">本次没有回瓶。</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="存瓶预览">
				<view class="deposit-head">
					<view class="deposit-summary">
						<text class="deposit-summary__text">客户当前存瓶基线 {{ form.depositCount || 0 }} 瓶</text>
						<text class="deposit-summary__text">提交后预览 {{ form.depositRows.length }} 瓶</text>
					</view>
					<AppButton size="sm" kind="neutral" :loading="depositLoading" @click="onRefreshDeposit">手动刷新</AppButton>
				</view>
				<text class="deposit-note">客户、日期、出瓶或回瓶变化后，会自动刷新存瓶预览；进入本页前也会强制刷新一次。</text>
				<text v-if="form.depositRaw" class="deposit-raw">当前基线：{{ form.depositRaw }}</text>
				<text v-if="depositDirty" class="warning-text">后台正在准备最新存瓶预览，提交时会再次校验。</text>
				<view v-if="form.depositRows.length > 0" class="deposit-tags">
					<AppTag v-for="row in form.depositRows" :key="row.bottle_no" kind="soft">{{ row.bottle_no }}</AppTag>
				</view>
				<view v-else class="hint-box">
					<text class="hint-text">暂无存瓶预览。</text>
				</view>
			</AppSection>

			<view class="wizard-actions">
				<AppButton kind="neutral" @click="currentStep = 2">上一步：修改明细</AppButton>
				<AppButton :loading="submitting" @click="onSubmit">提交销售单</AppButton>
			</view>
		</template>
	</AppPage>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import PdaBottleSuggestField from '@/components/domain/pda/PdaBottleSuggestField.vue'
import PdaSuggestList from '@/components/domain/pda/PdaSuggestList.vue'
import { usePdaSuggestions } from '@/composables/pda/usePdaSuggestions'
import { usePdaSaleForm } from '@/composables/pda/usePdaSaleForm'
import { resolvePdaCustomerPricing } from '@/services/pda/customer'
import { createPdaOutItem, validatePdaBottleSaleForm } from '@/services/pda/sale'
import { formatMoney, formatWeight, normalizeBottleNo, normalizeText } from '@/services/pda/shared'

const props = defineProps({
	initialCustomerId: { type: String, default: '' },
	initialCustomerName: { type: String, default: '' },
	initialOutBottleNo: { type: String, default: '' }
})

const steps = [
	{ value: 1, title: '客户', desc: '先选客户和基础信息' },
	{ value: 2, title: '明细', desc: '录出瓶、回瓶' },
	{ value: 3, title: '预览', desc: '看存瓶并提交' }
]

const currentStep = ref(1)

const {
	form,
	selectedCustomer,
	customerKeyword,
	resolvingBottleKey,
	depositLoading,
	depositDirty,
	submitting,
	markDepositDirty,
	applySelectedCustomer,
	applyBottleSelection,
	hydrateSelectedCustomer,
	searchCustomers,
	setCustomerKeyword,
	clearSelectedCustomer,
	addOutItem,
	removeOutItem,
	addBackItem,
	removeBackItem,
	normalizeOutBottle,
	normalizeBackBottle,
	syncBackRow,
	resolveBottle,
	refreshDepositRows,
	submit
} = usePdaSaleForm()

const {
	items: customerSuggestItems,
	loading: customerSuggestLoading,
	visible: customerSuggestVisible,
	handleInput: handleCustomerSuggestInput,
	handleFocus: handleCustomerSuggestFocus,
	handleBlur: handleCustomerSuggestBlur,
	handleSelect: handleCustomerSuggestSelect,
	clear: clearCustomerSuggest
} = usePdaSuggestions({
	minLength: 2,
	debounceMs: 200,
	hideDelayMs: 150,
	fetcher: async (keyword) => {
		const res = await searchCustomers(keyword)
		return res?.code === 0 ? res.data || [] : []
	},
	mapItem: (item) => ({
		key: item?._id || item?.name || '',
		title: item?.name || '-',
		subtitle: `${item?.contact || '-'} · ${item?.phone || '-'} · 存瓶 ${Number(item?.deposit_count || 0)}`,
		raw: item
	})
})

const customerPricingWarning = computed(() => {
	if (!selectedCustomer.value) return ''
	const pricing = resolvePdaCustomerPricing(selectedCustomer.value)
	return pricing.ok ? '' : pricing.msg
})

const canGoToBottleStep = computed(() => Boolean(form.value.customerId) && !customerPricingWarning.value)

const outPreviewRows = computed(() =>
	(form.value.outItems || [])
		.map((row) => ({
			bottleNo: normalizeBottleNo(row?.bottleNo || row?.bottle_no),
			net: Number(row?.net)
		}))
		.filter((row) => row.bottleNo && Number.isFinite(row.net) && row.net > 0)
)

const backPreviewRows = computed(() =>
	(form.value.backItems || [])
		.map((row) => ({
			bottleNo: normalizeBottleNo(row?.bottleNo || row?.bottle_no),
			net: Number(row?.net)
		}))
		.filter((row) => row.bottleNo && Number.isFinite(row.net) && row.net > 0)
)

const headerSummary = computed(() => {
	const items = []
	if (normalizeText(form.value.delivery1)) items.push({ label: '配送员 1', value: normalizeText(form.value.delivery1) })
	if (normalizeText(form.value.delivery2)) items.push({ label: '配送员 2', value: normalizeText(form.value.delivery2) })
	if (normalizeText(form.value.vehicleNo)) items.push({ label: '车牌号', value: normalizeText(form.value.vehicleNo) })
	if (normalizeText(form.value.remark)) items.push({ label: '备注', value: normalizeText(form.value.remark) })
	return items
})

watch(
	() => props.initialCustomerId,
	(value) => {
		const customerId = normalizeText(value)
		if (!customerId) return
		hydrateSelectedCustomer(customerId)
	},
	{ immediate: true }
)

watch(
	() => props.initialCustomerName,
	(value) => {
		if (selectedCustomer.value) return
		customerKeyword.value = normalizeText(value)
	},
	{ immediate: true }
)

watch(
	() => props.initialOutBottleNo,
	(value) => {
		const bottleNo = normalizeBottleNo(value)
		if (!bottleNo) return
		if (!Array.isArray(form.value.outItems) || !form.value.outItems.length) {
			form.value.outItems = [createPdaOutItem()]
		}
		form.value.outItems[0].bottleNo = bottleNo
	},
	{ immediate: true }
)

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

function onDateChange(event) {
	form.value.date = event?.detail?.value || form.value.date
	markDepositDirty()
}

function onCustomerKeywordInput(value) {
	setCustomerKeyword(value)
	handleCustomerSuggestInput(value)
}

function onCustomerFocus() {
	handleCustomerSuggestFocus(customerKeyword.value)
}

function onCustomerBlur() {
	handleCustomerSuggestBlur()
}

function onCustomerConfirm() {
	handleCustomerSuggestFocus(customerKeyword.value)
}

function onSelectCustomer(item) {
	const picked = handleCustomerSuggestSelect(item)
	const customer = picked?.raw || null
	if (!customer) return
	applySelectedCustomer(customer)
}

function onBottleInput(type, index) {
	const list = type === 'back' ? form.value.backItems : form.value.outItems
	const row = list[index]
	if (!row) return
	row.bottleId = ''
	markDepositDirty()
}

function onSelectBottleSuggestion(type, index, bottle) {
	applyBottleSelection(type, index, bottle)
}

function onClearCustomer() {
	clearSelectedCustomer()
	clearCustomerSuggest()
	currentStep.value = 1
}

async function onResolveBottle(type, index) {
	const res = await resolveBottle(type, index)
	if (res?.code !== 0) showToast(res?.msg || '钢瓶查询失败')
}

function enterBottleStep() {
	if (!form.value.customerId) {
		showToast('请先选择客户')
		return
	}
	if (customerPricingWarning.value) {
		showToast(customerPricingWarning.value)
		return
	}
	currentStep.value = 2
}

async function enterPreviewStep() {
	const validation = validatePdaBottleSaleForm(form.value, selectedCustomer.value)
	if (!validation.ok) {
		showToast(validation.msg)
		return
	}
	const res = await refreshDepositRows()
	if (res?.code !== 0) {
		showToast(res?.msg || '存瓶预览刷新失败')
		return
	}
	currentStep.value = 3
}

async function goStep(step) {
	if (step <= currentStep.value) {
		currentStep.value = step
		return
	}
	if (step === 2) {
		enterBottleStep()
		return
	}
	if (step === 3) {
		await enterPreviewStep()
	}
}

async function onRefreshDeposit() {
	const res = await refreshDepositRows()
	showToast(res?.code === 0 ? '存瓶预览已刷新' : res?.msg || '刷新失败')
}

async function onSubmit() {
	const res = await submit()
	if (res?.code === 0) currentStep.value = 1
	showToast(res?.code === 0 ? '销售单已提交' : res?.msg || '提交失败')
}
</script>

<style scoped>
.stepper {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16rpx;
}

.step-chip {
	padding: 18rpx 20rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #fff;
	display: flex;
	align-items: center;
	gap: 16rpx;
}

.step-chip--active {
	border-color: #2563eb;
	background: #eff6ff;
}

.step-chip--done {
	border-color: #93c5fd;
	background: #f8fbff;
}

.step-chip__index {
	width: 44rpx;
	height: 44rpx;
	border-radius: 50%;
	background: #e2e8f0;
	color: #0f172a;
	font-size: 24rpx;
	font-weight: 700;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}

.step-chip--active .step-chip__index,
.step-chip--done .step-chip__index {
	background: #2563eb;
	color: #fff;
}

.step-chip__content {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	min-width: 0;
}

.step-chip__title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.step-chip__desc {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	line-height: 1.4;
}

.customer-search-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 16rpx;
	align-items: end;
}

.customer-search-field {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.customer-search-actions,
.item-actions,
.wizard-actions,
.section-toolbar {
	display: flex;
	gap: 12rpx;
}

.selected-customer {
	margin-top: 20rpx;
	padding: 20rpx 24rpx;
	border: 1rpx solid #cfe0ff;
	border-radius: var(--crm-radius-sm);
	background: #f8fbff;
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.selected-customer__row,
.deposit-head {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16rpx;
}

.selected-customer__name {
	font-size: 30rpx;
	font-weight: 700;
	color: #0b5cab;
}

.selected-customer__meta,
.meta-row,
.deposit-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.selected-customer__price,
.meta-text,
.deposit-summary__text,
.deposit-note,
.deposit-raw,
.hint-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.warning-text {
	font-size: 22rpx;
	color: #c2410c;
	line-height: 1.6;
}

.form-grid,
.summary-grid,
.row-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.row-grid--back {
	grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-cell {
	padding: 20rpx;
	border-radius: var(--crm-radius-sm);
	background: #f8fafc;
	border: 1rpx solid var(--crm-border);
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.summary-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.summary-value {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
	word-break: break-all;
}

.textarea-field {
	margin-top: 24rpx;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.textarea-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.textarea-control {
	min-height: 160rpx;
	padding: 20rpx 24rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	font-size: 28rpx;
	color: var(--crm-text);
	box-sizing: border-box;
}

.rows-wrap,
.preview-block,
.deposit-summary {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.row-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
	margin-bottom: 16rpx;
}

.row-title,
.preview-title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.preview-list {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.preview-row {
	padding: 18rpx 20rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #fff;
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16rpx;
}

.preview-row__name {
	font-size: 26rpx;
	color: var(--crm-text);
	font-weight: 600;
}

.preview-row__value {
	font-size: 24rpx;
	color: #0b5cab;
	font-weight: 700;
}

.hint-box {
	padding: 20rpx 24rpx;
	border-radius: var(--crm-radius-sm);
	background: #fafafa;
	border: 1rpx dashed var(--crm-border);
}

.wizard-actions {
	justify-content: flex-end;
}

@media (max-width: 720px) {
	.stepper,
	.customer-search-row,
	.form-grid,
	.summary-grid,
	.row-grid,
	.row-grid--back {
		grid-template-columns: 1fr;
	}

	.selected-customer__row,
	.deposit-head,
	.wizard-actions {
		flex-direction: column;
		align-items: stretch;
	}
}
</style>
