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

		<view :class="['barcode-status', barcodeSessionReady ? 'barcode-status--active' : '', currentStep === 3 ? 'barcode-status--muted' : '']">
			<text class="barcode-status__title">物理扫码</text>
			<text class="barcode-status__text">当前目标：{{ barcodeTargetLabel }}</text>
			<text class="barcode-status__text">{{ barcodeHint }}</text>
			<text v-if="lastBarcodeText" class="barcode-status__text">最近扫码：{{ lastBarcodeText }}</text>
		</view>

		<template v-if="currentStep === 1">
			<AppSection title="1. 选择客户">
				<view class="customer-search-row">
					<view :class="['customer-search-field', isHeaderBarcodeActive('customer') ? 'capture-field--active' : '']" @click="onScanCustomer()">
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
						<AppButton size="sm" kind="neutral" @click.stop="onScanCustomer">扫码客户码</AppButton>
						<AppButton v-if="form.customerId || customerKeyword" size="sm" kind="neutral" @click.stop="onClearCustomer">清空</AppButton>
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
					<view :class="['capture-field', isHeaderBarcodeActive('delivery1') ? 'capture-field--active' : '']" @click="onScanDelivery('delivery1')">
						<PdaLookupSuggestField
							v-model="form.delivery1"
							label="配送员 1"
							placeholder="姓名 / 手机 / 二维码"
							:min-length="1"
							:fetcher="fetchDeliverySuggestions"
							:map-item="mapDeliverySuggestion"
							empty-text="未找到匹配配送员"
							@input="markDepositDirty"
							@focus="onFocusHeaderTarget('delivery1')"
							@select="onSelectDelivery('delivery1', $event)"
						/>
						<view class="capture-actions">
							<AppButton size="sm" kind="neutral" @click.stop="onScanDelivery('delivery1')">扫码</AppButton>
						</view>
					</view>
					<view :class="['capture-field', isHeaderBarcodeActive('delivery2') ? 'capture-field--active' : '']" @click="onScanDelivery('delivery2')">
						<PdaLookupSuggestField
							v-model="form.delivery2"
							label="配送员 2"
							placeholder="姓名 / 手机 / 二维码"
							:min-length="1"
							:fetcher="fetchDeliverySuggestions"
							:map-item="mapDeliverySuggestion"
							empty-text="未找到匹配配送员"
							@input="markDepositDirty"
							@focus="onFocusHeaderTarget('delivery2')"
							@select="onSelectDelivery('delivery2', $event)"
						/>
						<view class="capture-actions">
							<AppButton size="sm" kind="neutral" @click.stop="onScanDelivery('delivery2')">扫码</AppButton>
						</view>
					</view>
					<view :class="['capture-field', isHeaderBarcodeActive('vehicle') ? 'capture-field--active' : '']" @click="onScanVehicle()">
						<PdaLookupSuggestField
							v-model="form.vehicleNo"
							label="车牌号"
							placeholder="车牌 / 二维码"
							:min-length="1"
							:fetcher="fetchVehicleSuggestions"
							:map-item="mapVehicleSuggestion"
							empty-text="未找到匹配车辆"
							@input="markDepositDirty"
							@focus="onFocusHeaderTarget('vehicle')"
							@select="onSelectVehicle"
						/>
						<view class="capture-actions">
							<AppButton size="sm" kind="neutral" @click.stop="onScanVehicle">扫码</AppButton>
						</view>
					</view>
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
					<view v-for="(row, index) in form.outItems" :key="`out-${index}`" :class="['barcode-row', isBottleBarcodeActive('out', index) ? 'barcode-row--active' : '']">
						<AppCard padding="20rpx">
							<view class="row-header">
								<text class="row-title">出瓶 {{ index + 1 }}</text>
								<AppButton size="sm" kind="ghost" @click.stop="removeOutItem(index)">删除</AppButton>
							</view>
							<view class="row-grid">
								<PdaBottleSuggestField
									v-model="row.bottleNo"
									label="瓶号"
									placeholder="请输入瓶号"
									@blur="normalizeOutBottle(index)"
									@focus="onFocusBottleTarget('out', index)"
									@input="onBottleInput('out', index)"
									@select="onSelectBottleSuggestion('out', index, $event)"
								/>
								<AppInput v-model="row.net" label="净重(kg)" placeholder="请输入净重" type="digit" @input="markDepositDirty" />
							</view>
							<view class="item-actions">
								<AppButton size="sm" kind="neutral" @click.stop="onScanBottle('out', index)">扫瓶码</AppButton>
								<AppButton size="sm" kind="neutral" :loading="resolvingBottleKey === `out:${index}`" @click.stop="onResolveBottle('out', index)">
									查瓶
								</AppButton>
							</view>
							<text class="capture-hint">扫码仅回填瓶号，净重固定手工录入。</text>
						</AppCard>
					</view>
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
					<view v-for="(row, index) in form.backItems" :key="`back-${index}`" :class="['barcode-row', isBottleBarcodeActive('back', index) ? 'barcode-row--active' : '']">
						<AppCard padding="20rpx">
							<view class="row-header">
								<text class="row-title">回瓶 {{ index + 1 }}</text>
								<AppButton size="sm" kind="ghost" @click.stop="removeBackItem(index)">删除</AppButton>
							</view>
							<view class="row-grid row-grid--back">
								<PdaBottleSuggestField
									v-model="row.bottleNo"
									label="瓶号"
									placeholder="请输入瓶号"
									@blur="normalizeBackBottle(index)"
									@focus="onFocusBottleTarget('back', index)"
									@input="onBottleInput('back', index)"
									@select="onSelectBottleSuggestion('back', index, $event)"
								/>
								<AppInput v-model="row.gross" label="毛重(kg)" placeholder="可选" type="digit" @input="syncBackRow(index)" />
								<AppInput v-model="row.tare" label="空瓶重(kg)" placeholder="可选" type="digit" @input="syncBackRow(index)" />
								<AppInput v-model="row.net" label="净重(kg)" placeholder="可手填" type="digit" @input="syncBackRow(index)" />
							</view>
							<view class="item-actions">
								<AppButton size="sm" kind="neutral" @click.stop="onScanBottle('back', index)">扫瓶码</AppButton>
								<AppButton size="sm" kind="neutral" :loading="resolvingBottleKey === `back:${index}`" @click.stop="onResolveBottle('back', index)">
									查瓶补空瓶重
								</AppButton>
							</view>
							<text class="capture-hint">扫码仅回填瓶号，毛重/空瓶重/净重固定手工录入。</text>
						</AppCard>
					</view>
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
				<text class="deposit-note">步骤 1/2 只标记存瓶预览待刷新；进入本页时会强制刷新一次，也可手动刷新。</text>
				<text v-if="form.depositRaw" class="deposit-raw">当前基线：{{ form.depositRaw }}</text>
				<text v-if="depositDirty" class="warning-text">当前明细已变化，进入本页或手动刷新后会重算存瓶预览；提交时仍会再次校验。</text>
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
import PdaLookupSuggestField from '@/components/domain/pda/PdaLookupSuggestField.vue'
import PdaSuggestList from '@/components/domain/pda/PdaSuggestList.vue'
import { usePdaSuggestions } from '@/composables/pda/usePdaSuggestions'
import { usePdaSaleForm } from '@/composables/pda/usePdaSaleForm'
import { resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { enterBarcodeSession, leaveBarcodeSession, PDA_CAPTURE_TARGETS, setActiveBarcodeTarget } from '@/services/pda/capture'
import { resolvePdaCustomerByQrCode, resolvePdaCustomerPricing } from '@/services/pda/customer'
import { listPdaDeliveries, resolvePdaDeliveryByQrCode } from '@/services/pda/delivery'
import { createPdaOutItem, validatePdaBottleSaleForm } from '@/services/pda/sale'
import { formatMoney, formatWeight, normalizeBottleNo, normalizeQrCode, normalizeText } from '@/services/pda/shared'
import { listPdaVehicles, resolvePdaVehicleByQrCode } from '@/services/pda/vehicle'

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
const barcodeSessionReady = ref(false)
const activeHeaderTarget = ref('customer')
const activeBottleTarget = ref({
	type: 'out',
	index: 0
})
const barcodeHint = ref('进入页面后可直接按 PDA 扫码键回填主键字段。')
const lastBarcodeText = ref('')

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
	applyDeliverySelection,
	applyVehicleSelection,
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

const barcodeTargetLabel = computed(() => {
	if (currentStep.value === 1) {
		return {
			customer: '客户',
			delivery1: '配送员 1',
			delivery2: '配送员 2',
			vehicle: '车牌号'
		}[activeHeaderTarget.value] || '客户'
	}
	if (currentStep.value === 2) {
		const typeLabel = activeBottleTarget.value.type === 'back' ? '回瓶' : '出瓶'
		return `${typeLabel} ${Number(activeBottleTarget.value.index || 0) + 1} 瓶号`
	}
	return '预览页未启用物理扫码'
})

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

async function fetchDeliverySuggestions(keyword) {
	const res = await listPdaDeliveries({
		keyword,
		page: 1,
		pageSize: 12,
		isActive: true
	})
	return res?.code === 0 ? res.data || [] : []
}

function mapDeliverySuggestion(item) {
	return {
		key: item?._id || item?.name || '',
		title: item?.name || '-',
		subtitle: [item?.phone, item?.qr_code].filter(Boolean).join(' · ') || '未登记电话',
		raw: item
	}
}

async function fetchVehicleSuggestions(keyword) {
	const res = await listPdaVehicles({
		keyword,
		page: 1,
		pageSize: 12,
		isActive: true
	})
	return res?.code === 0 ? res.data || [] : []
}

function mapVehicleSuggestion(item) {
	return {
		key: item?._id || item?.plate_no || '',
		title: item?.plate_no || '-',
		subtitle: [item?.remark, item?.qr_code].filter(Boolean).join(' · ') || '未登记备注',
		raw: item
	}
}

function isHeaderBarcodeActive(field) {
	return currentStep.value === 1 && activeHeaderTarget.value === field
}

function isBottleBarcodeActive(type, index) {
	return currentStep.value === 2 && activeBottleTarget.value.type === type && Number(activeBottleTarget.value.index || 0) === Number(index)
}

function buildHeaderBarcodeTarget(field) {
	if (field === 'delivery1') {
		return {
			page: 'pda-sale',
			target: PDA_CAPTURE_TARGETS.SALE_DELIVERY_1,
			label: '配送员 1',
			scope: 'header',
			field: 'delivery1'
		}
	}
	if (field === 'delivery2') {
		return {
			page: 'pda-sale',
			target: PDA_CAPTURE_TARGETS.SALE_DELIVERY_2,
			label: '配送员 2',
			scope: 'header',
			field: 'delivery2'
		}
	}
	if (field === 'vehicle') {
		return {
			page: 'pda-sale',
			target: PDA_CAPTURE_TARGETS.SALE_VEHICLE_NO,
			label: '车牌号',
			scope: 'header',
			field: 'vehicle'
		}
	}
	return {
		page: 'pda-sale',
		target: PDA_CAPTURE_TARGETS.SALE_CUSTOMER,
		label: '客户',
		scope: 'header',
		field: 'customer'
	}
}

function buildBottleBarcodeTarget(type, index) {
	return {
		page: 'pda-sale',
		target: type === 'back' ? PDA_CAPTURE_TARGETS.saleBackBottleNo(index) : PDA_CAPTURE_TARGETS.saleOutBottleNo(index),
		label: `${type === 'back' ? '回瓶' : '出瓶'} ${Number(index) + 1} 瓶号`,
		scope: 'bottle',
		field: 'bottleNo',
		type,
		index
	}
}

function getSafeBottleTarget() {
	const outCount = Array.isArray(form.value.outItems) ? form.value.outItems.length : 0
	const backCount = Array.isArray(form.value.backItems) ? form.value.backItems.length : 0
	if (activeBottleTarget.value.type === 'back' && activeBottleTarget.value.index < backCount) {
		return {
			type: 'back',
			index: activeBottleTarget.value.index
		}
	}
	if (activeBottleTarget.value.type === 'out' && activeBottleTarget.value.index < outCount) {
		return {
			type: 'out',
			index: activeBottleTarget.value.index
		}
	}
	return {
		type: 'out',
		index: 0
	}
}

async function applyBarcodeTarget(targetMeta, options = {}) {
	const res = await setActiveBarcodeTarget(targetMeta)
	if (res?.code !== 0) {
		barcodeHint.value = res?.msg || '物理扫码目标设置失败'
		if (options.toast !== false) showToast(barcodeHint.value)
		return res
	}
	if (targetMeta?.scope === 'header') activeHeaderTarget.value = targetMeta.field || 'customer'
	if (targetMeta?.scope === 'bottle') {
		activeBottleTarget.value = {
			type: targetMeta.type || 'out',
			index: Number(targetMeta.index || 0)
		}
	}
	if (!targetMeta?.target) {
		barcodeHint.value = '预览页不接收物理扫码。'
		return res
	}
	barcodeHint.value = `当前目标：${targetMeta.label || '未命名'}，请按 PDA 扫码键。`
	if (options.toast !== false) showToast(`已切换到${targetMeta.label || '当前字段'}扫码`)
	return res
}

async function syncBarcodeTarget(options = {}) {
	if (!barcodeSessionReady.value) return { code: 0, msg: '物理扫码未启用' }
	if (currentStep.value === 1) return applyBarcodeTarget(buildHeaderBarcodeTarget(activeHeaderTarget.value), { toast: false, ...options })
	if (currentStep.value === 2) {
		const safeTarget = getSafeBottleTarget()
		activeBottleTarget.value = safeTarget
		return applyBarcodeTarget(buildBottleBarcodeTarget(safeTarget.type, safeTarget.index), { toast: false, ...options })
	}
	return applyBarcodeTarget(null, { toast: false, ...options })
}

async function activateBarcodeSession() {
	const sessionRes = await enterBarcodeSession({
		page: 'pda-sale',
		onResult: onBarcodeScanned
	})
	if (sessionRes?.code !== 0) {
		barcodeSessionReady.value = false
		barcodeHint.value = sessionRes?.msg || '物理扫码会话初始化失败'
		return sessionRes
	}
	barcodeSessionReady.value = true
	return syncBarcodeTarget({ toast: false })
}

async function deactivateBarcodeSession(reason = '') {
	barcodeSessionReady.value = false
	return leaveBarcodeSession({ page: 'pda-sale', reason })
}

async function onFocusHeaderTarget(field) {
	activeHeaderTarget.value = field
	if (currentStep.value !== 1) return
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) return
	}
	await applyBarcodeTarget(buildHeaderBarcodeTarget(field), { toast: false })
}

async function onFocusBottleTarget(type, index) {
	activeBottleTarget.value = {
		type,
		index: Number(index || 0)
	}
	if (currentStep.value !== 2) return
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) return
	}
	await applyBarcodeTarget(buildBottleBarcodeTarget(type, Number(index || 0)), { toast: false })
}

async function onBarcodeScanned(payload = {}) {
	lastBarcodeText.value = normalizeText(payload?.rawText)
	const targetMeta = payload?.targetMeta || null
	if (!targetMeta?.target) {
		barcodeHint.value = '当前页未启用物理扫码目标。'
		showToast('请先选择扫码目标')
		return
	}
	if (targetMeta.scope === 'header') {
		await onScannedHeaderEntity(targetMeta, payload)
		return
	}
	if (targetMeta.scope === 'bottle') {
		await onScannedBottle(targetMeta, payload)
		return
	}
	barcodeHint.value = '当前扫码目标暂不支持该码。'
	showToast('当前扫码目标不支持该码')
}

async function onScannedHeaderEntity(targetMeta, payload) {
	const rawText = normalizeText(payload?.rawText)
	if (!rawText) {
		barcodeHint.value = '未读取到有效二维码，请重试。'
		showToast('未读取到有效二维码')
		return
	}
	if (targetMeta.field === 'customer') {
		const customerRes = await resolvePdaCustomerByQrCode(rawText)
		if (customerRes?.code !== 0 || !customerRes?.data) {
			barcodeHint.value = '未命中客户二维码，请改用手工搜索。'
			showToast(customerRes?.msg || '未找到匹配客户')
			return
		}
		if (!isEntityUsable(customerRes.data, '客户')) return
		applySelectedCustomer(customerRes.data)
		barcodeHint.value = `已回填客户 ${customerRes.data.name || ''}。`
		showToast(`已回填客户 ${customerRes.data.name || ''}`)
		return
	}
	if (targetMeta.field === 'delivery1' || targetMeta.field === 'delivery2') {
		const deliveryRes = await resolvePdaDeliveryByQrCode(rawText)
		if (deliveryRes?.code !== 0 || !deliveryRes?.data) {
			barcodeHint.value = '未命中配送员二维码，请改用手工搜索。'
			showToast(deliveryRes?.msg || '未找到匹配配送员')
			return
		}
		if (!isEntityUsable(deliveryRes.data, '配送员')) return
		applyDeliverySelection(targetMeta.field, deliveryRes.data)
		barcodeHint.value = `已回填${targetMeta.label} ${deliveryRes.data.name || ''}。`
		showToast(`已回填${targetMeta.label} ${deliveryRes.data.name || ''}`)
		return
	}
	if (targetMeta.field === 'vehicle') {
		const vehicleRes = await resolvePdaVehicleByQrCode(rawText)
		if (vehicleRes?.code !== 0 || !vehicleRes?.data) {
			barcodeHint.value = '未命中车辆二维码，请改用手工搜索。'
			showToast(vehicleRes?.msg || '未找到匹配车辆')
			return
		}
		if (!isEntityUsable(vehicleRes.data, '车辆')) return
		applyVehicleSelection(vehicleRes.data)
		barcodeHint.value = `已回填车辆 ${vehicleRes.data.plate_no || ''}。`
		showToast(`已回填车辆 ${vehicleRes.data.plate_no || ''}`)
	}
}

async function onScannedBottle(targetMeta, payload) {
	const qrCode = normalizeQrCode(payload?.rawText)
	if (!qrCode) {
		barcodeHint.value = '扫码内容无效，请改用手工输入瓶号。'
		showToast('扫码内容无效')
		return
	}
	const bottleRes = await resolvePdaBottleByQrCode(qrCode)
	if (bottleRes?.code !== 0 || !bottleRes?.data) {
		barcodeHint.value = '未命中钢瓶 PDA 码，请改用手工输入瓶号。'
		showToast(bottleRes?.msg || '未找到匹配钢瓶')
		return
	}
	applyBottleSelection(targetMeta.type, targetMeta.index, bottleRes.data)
	barcodeHint.value = `已回填 ${targetMeta.label || '钢瓶'}。`
	showToast(`已回填 ${bottleRes.data.bottle_no || ''}`)
}

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
		if (!Array.isArray(form.value.outItems) || !form.value.outItems.length) form.value.outItems = [createPdaOutItem()]
		form.value.outItems[0].bottleNo = bottleNo
	},
	{ immediate: true }
)

watch(
	() => currentStep.value,
	() => {
		syncBarcodeTarget({ toast: false })
	},
	{ immediate: false }
)

watch(
	() => [form.value.outItems?.length || 0, form.value.backItems?.length || 0],
	() => {
		if (currentStep.value !== 2) return
		syncBarcodeTarget({ toast: false })
	}
)

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

function isEntityUsable(entity, label) {
	if (!entity) return false
	if (entity.is_active === false) {
		showToast(`${label}已停用，请改用其他档案`)
		return false
	}
	return true
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
	onFocusHeaderTarget('customer')
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
	barcodeHint.value = `已选择客户 ${customer.name || ''}。`
}

function onSelectDelivery(slot, delivery) {
	if (!delivery || !isEntityUsable(delivery, '配送员')) return
	applyDeliverySelection(slot, delivery)
	barcodeHint.value = `已选择${slot === 'delivery2' ? '配送员 2' : '配送员 1'} ${delivery.name || ''}。`
}

function onSelectVehicle(vehicle) {
	if (!vehicle || !isEntityUsable(vehicle, '车辆')) return
	applyVehicleSelection(vehicle)
	barcodeHint.value = `已选择车辆 ${vehicle.plate_no || vehicle.plateNo || ''}。`
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
	barcodeHint.value = `已选择${type === 'back' ? '回瓶' : '出瓶'} ${Number(index) + 1} 瓶号。`
}

function onClearCustomer() {
	clearSelectedCustomer()
	clearCustomerSuggest()
	currentStep.value = 1
	activeHeaderTarget.value = 'customer'
	syncBarcodeTarget({ toast: false })
}

async function onResolveBottle(type, index) {
	const res = await resolveBottle(type, index)
	if (res?.code !== 0) showToast(res?.msg || '钢瓶查询失败')
}

async function onScanCustomer() {
	activeHeaderTarget.value = 'customer'
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) {
			showToast(readyRes?.msg || '物理扫码未就绪')
			return
		}
	}
	await applyBarcodeTarget(buildHeaderBarcodeTarget('customer'))
}

async function onScanDelivery(slot) {
	activeHeaderTarget.value = slot === 'delivery2' ? 'delivery2' : 'delivery1'
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) {
			showToast(readyRes?.msg || '物理扫码未就绪')
			return
		}
	}
	await applyBarcodeTarget(buildHeaderBarcodeTarget(activeHeaderTarget.value))
}

async function onScanVehicle() {
	activeHeaderTarget.value = 'vehicle'
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) {
			showToast(readyRes?.msg || '物理扫码未就绪')
			return
		}
	}
	await applyBarcodeTarget(buildHeaderBarcodeTarget('vehicle'))
}

async function onScanBottle(type, index) {
	activeBottleTarget.value = {
		type,
		index: Number(index || 0)
	}
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) {
			showToast(readyRes?.msg || '物理扫码未就绪')
			return
		}
	}
	await applyBarcodeTarget(buildBottleBarcodeTarget(type, Number(index || 0)))
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
	if (step === 3) await enterPreviewStep()
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

defineExpose({
	activateBarcodeSession,
	deactivateBarcodeSession
})
</script>

<style scoped>
.barcode-status {
	margin-top: 20rpx;
	padding: 18rpx 20rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid #dbeafe;
	background: #f8fbff;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.barcode-status--active {
	border-color: #93c5fd;
	background: #eff6ff;
}

.barcode-status--muted {
	border-style: dashed;
}

.barcode-status__title {
	font-size: 24rpx;
	font-weight: 700;
	color: #0b5cab;
}

.barcode-status__text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	line-height: 1.5;
}

.stepper {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.step-chip {
	display: flex;
	gap: 16rpx;
	padding: 16rpx 18rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
}

.step-chip--active {
	border-color: #93c5fd;
	background: #eff6ff;
}

.step-chip--done {
	border-color: #86efac;
	background: #f0fdf4;
}

.step-chip__index {
	width: 42rpx;
	height: 42rpx;
	border-radius: 999rpx;
	background: #e2e8f0;
	color: #0f172a;
	font-size: 24rpx;
	font-weight: 700;
	display: flex;
	align-items: center;
	justify-content: center;
}

.step-chip--active .step-chip__index {
	background: #3b82f6;
	color: #fff;
}

.step-chip--done .step-chip__index {
	background: #22c55e;
	color: #fff;
}

.step-chip__content {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
}

.step-chip__title {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.step-chip__desc {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.customer-search-row {
	display: flex;
	flex-direction: column;
	gap: 14rpx;
}

.customer-search-field {
	position: relative;
}

.customer-search-actions,
.capture-actions,
.item-actions,
.wizard-actions,
.actions-row {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}

.selected-customer {
	margin-top: 12rpx;
	padding: 20rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid #c7d2fe;
	background: #f8faff;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.selected-customer__row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
}

.selected-customer__name {
	font-size: 30rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.selected-customer__meta {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8rpx 14rpx;
}

.meta-text,
.selected-customer__price,
.hint-text,
.capture-hint,
.deposit-note,
.deposit-raw {
	font-size: 22rpx;
	line-height: 1.6;
	color: var(--crm-text-muted);
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.capture-field {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.capture-field--active {
	padding: 14rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid #93c5fd;
	background: #eff6ff;
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

.summary-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.summary-cell {
	padding: 16rpx 18rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #fff;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.summary-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.summary-value {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
	word-break: break-all;
}

.section-toolbar {
	display: flex;
	justify-content: flex-end;
	margin-bottom: 14rpx;
}

.rows-wrap {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.barcode-row--active :deep(.app-card) {
	border: 1rpx solid #93c5fd;
	background: #f8fbff;
}

.row-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
	margin-bottom: 12rpx;
}

.row-title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.row-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.row-grid--back {
	grid-template-columns: repeat(2, minmax(0, 1fr));
}

.preview-block {
	margin-top: 14rpx;
	padding: 16rpx 18rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #fff;
}

.preview-title {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.preview-list {
	margin-top: 10rpx;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.preview-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
	font-size: 24rpx;
}

.preview-row__name {
	color: var(--crm-text);
}

.preview-row__value {
	color: #0b5cab;
	font-weight: 700;
}

.hint-box {
	margin-top: 10rpx;
	padding: 14rpx 16rpx;
	border-radius: var(--crm-radius-sm);
	background: #f8fafc;
	border: 1rpx dashed #cbd5e1;
}

.warning-text {
	font-size: 22rpx;
	color: #dc2626;
	line-height: 1.6;
}

.deposit-head {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
	justify-content: space-between;
}

.deposit-summary {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
}

.deposit-summary__text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.deposit-tags {
	margin-top: 10rpx;
	display: flex;
	flex-wrap: wrap;
	gap: 10rpx;
}

@media (max-width: 680px) {
	.form-grid,
	.summary-grid,
	.selected-customer__meta,
	.row-grid,
	.row-grid--back {
		grid-template-columns: 1fr;
	}
}
</style>
