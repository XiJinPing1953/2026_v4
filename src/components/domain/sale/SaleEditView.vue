<template>
	<AppPage :title="recordId ? '修改销售记录' : '新建销售单'" subtitle="EDIT RECORD" icon="edit">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="onCancel" :disabled="submitting">取消</AppButton>
		</template>

		<view class="edit-container">
			<!-- Highlights / Header Info -->
			<AppCard class="edit-header-card" padding="24rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">业务模式</text>
						<text class="pill-value">{{ bizModeLabel }}</text>
					</view>
					<view v-if="form.customerName" class="info-pill">
						<text class="pill-label">当前客户</text>
						<text class="pill-value">{{ form.customerName }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
					<AppSection title="基础信息" class="section-popover-host">
						<SaleBasicInfoCard v-model="form" size="sm" />
					</AppSection>

				<view v-if="showBottleBlocks" class="bottle-sections">
					<AppSection title="出瓶明细">
						<SaleBottleLinesCard
							v-model="outItems"
							size="sm"
							type="out"
							:unit-price="form.unitPrice"
							:price-unit="form.priceUnit"
							title="出瓶"
							subtitle="本次送出去的瓶子，可添加多行"
							bottle-label="出厂瓶号"
							summary-label="本次出瓶净重合计"
						/>
					</AppSection>

					<AppSection title="回瓶明细">
						<SaleBottleLinesCard
							v-model="backItems"
							size="sm"
							type="back"
							:unit-price="form.unitPrice"
							:price-unit="form.priceUnit"
							title="回瓶"
							subtitle="本次收回的瓶子，可添加多行"
							bottle-label="回厂瓶号"
							summary-label="本次回瓶净重合计"
						/>
					</AppSection>

					<AppSection title="存瓶记录">
						<view class="deposit-summary">
							<view class="deposit-summary__main">
								<text class="deposit-summary__label">当前存瓶</text>
								<text class="deposit-summary__value">{{ depositMerged.count }} 个</text>
								<text v-if="depositLoading" class="deposit-summary__loading">更新中…</text>
							</view>
							<text class="deposit-summary__hint">{{ depositSummaryHint }}</text>
							<view v-if="depositMerged.list.length" class="deposit-summary__list">
								<text v-for="item in depositMerged.list" :key="item" class="deposit-summary__tag">{{ item }}</text>
							</view>
							<text v-else class="deposit-summary__empty">暂无存瓶明细</text>
						</view>
						<SaleDepositCard v-model="depositRows" size="sm" />
					</AppSection>
				</view>

				<AppSection v-if="showAgentBlocks" title="代理出站">
					<SaleAgentSaleCard v-model="agentSaleRows" size="sm" :sale-date="form.date" />
				</AppSection>

				<AppSection v-if="showTruckBlocks" title="整车业务">
					<SaleTruckCard v-model="truck" :price-unit="form.priceUnit" size="sm" />
				</AppSection>

				<AppSection title="销售底单">
					<view class="ticket-card">
						<view class="ticket-card__header">
							<view class="ticket-card__meta">
								<text class="ticket-card__title">销售底单图片</text>
								<text class="ticket-card__hint">可选，最多上传 3 张图片</text>
							</view>
							<AppButton
								size="sm"
								kind="primary"
								@click="chooseTicketImage"
								:disabled="submitting || ticketImageUploading || ticketImages.length >= 3"
							>
								上传图片（{{ ticketImages.length }}/3）
							</AppButton>
						</view>
						<view v-if="ticketImages.length" class="ticket-card__preview-list">
							<view v-for="(item, index) in ticketImages" :key="item.localPath || item.fileId || index" class="ticket-card__preview-item">
								<image class="ticket-card__preview" :src="resolveTicketImagePreview(item)" mode="aspectFill" @click="previewTicketImage(index)" />
								<view class="ticket-card__actions">
									<text v-if="item.uploading" class="ticket-card__status">上传中…</text>
									<text v-else-if="item.fileId" class="ticket-card__status">已上传</text>
									<AppButton size="sm" kind="neutral" @click="previewTicketImage(index)">预览</AppButton>
									<AppButton
										size="sm"
										kind="outline"
										@click="removeTicketImage(index)"
										:disabled="submitting || ticketImageUploading"
									>
										移除
									</AppButton>
								</view>
							</view>
						</view>
						<view v-else class="ticket-card__empty">
							<text class="ticket-card__empty-title">未上传销售底单</text>
							<text class="ticket-card__empty-text">保存时会自动上传到云端，不影响销售单正常提交。</text>
						</view>
					</view>
				</AppSection>

				<AppSection v-if="showSettlementBlocks" title="收款结算">
					<SaleSettlementCard
						v-model="settlement"
						size="sm"
						:should-receive="settlementSummary.amount"
						:formula="settlementSummary.formula"
						:payment-status-locked="true"
						:offset-credit-available="offsetCreditAvailable"
						:offset-credit-loading="offsetCreditLoading"
						:expected-offset-applied="expectedOffsetAppliedAmount"
						:final-amount-received="finalAmountReceivedPreview"
					/>
				</AppSection>
				<AppSection v-else title="对账说明">
					<view class="settlement-mode-note">
						<text class="settlement-mode-note__title">该客户按客户对账页流量结算</text>
						<text class="settlement-mode-note__text">销售单仅记录实际送货重量和流转，不在本单生成应收或登记收款。</text>
					</view>
				</AppSection>

				<view class="submit-footer">
					<AppButton size="md" kind="neutral" @click="onCancel" :disabled="submitting">取消</AppButton>
					<AppButton
						v-if="canSubmitSale"
						size="md"
						kind="primary"
						@click="onSubmit"
						:loading="submitting"
						icon="check"
					>
						保存并提交
					</AppButton>
				</view>
			</view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppButton from '@/components/base/AppButton.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { normalizeBottleNo } from '@/services/models'
import { createSaleV2, getSaleV2, updateSaleV2, getCustomerDepositV1 } from '@/services/sale'
import { listOffsetCreditPoolV1 } from '@/services/customerSettlement'
import { useQuery } from '@/composables/useQuery'
import { useSaleSettlement } from '@/composables/useSaleSettlement'
import { toNumber, fix2 } from '@/utils/number'
import SaleBasicInfoCard from '@/components/domain/sale/SaleBasicInfoCard.vue'
import SaleBottleLinesCard from '@/components/domain/sale/SaleBottleLinesCard.vue'
import SaleDepositCard from '@/components/domain/sale/SaleDepositCard.vue'
import SaleTruckCard from '@/components/domain/sale/SaleTruckCard.vue'
import SaleAgentSaleCard from '@/components/domain/sale/SaleAgentSaleCard.vue'
import SaleSettlementCard from '@/components/domain/sale/SaleSettlementCard.vue'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const { canPageAction } = useAuthGuard()
const SALE_LIST_REFRESH_KEY = 'sale:list:refresh'

const form = ref({
	date: '',
	customerId: '',
	customerName: '',
	deliveryMan1: '',
	deliveryMan2: '',
	vehicleNo: '',
	settlementMode: 'sale',
	bizMode: 'bottle',
	priceUnit: 'kg',
	unitPrice: '',
	remark: '',
	ticketImage: '',
	ticketImages: []
})

const flow = ref({
	flowPrev: '',
	flowCurr: '',
	flowVolume: '',
	flowRatio: ''
})

const truck = ref({
	truckNo: '',
	truckOutGross: '',
	truckBackGross: '',
	truckSettleTare: '',
	truckSettleGross: '',
	truckGrossDiff: '',
	truckSaleNet: ''
})

const settlement = ref({
	paymentStatus: 'unpaid',
	paymentMethod: 'on_account',
	amountReceived: '',
	roundingAmount: '',
	applyOffsetCredit: false,
	offsetEnabled: false,
	paymentNote: ''
})

const outItems = ref([])
const backItems = ref([])
const depositRows = ref([])
const agentSaleRows = ref([])
const submitting = ref(false)
const originBottleSnapshot = ref({ out: [], back: [], deposit: [] })
const ticketImages = ref([])
const offsetCreditLoading = ref(false)
const offsetCreditAvailable = ref(0)
let offsetCreditFetchSeq = 0

const showBottleBlocks = computed(() => form.value.bizMode === 'bottle')
const showTruckBlocks = computed(() => form.value.bizMode === 'truck')
const showAgentBlocks = computed(() => form.value.bizMode === 'agent_sale')
const showSettlementBlocks = computed(() => form.value.settlementMode !== 'customer_flow')
const ticketImageUploading = computed(() => ticketImages.value.some((item) => Boolean(item?.uploading)))
const canSubmitSale = computed(() =>
	recordId.value ? canPageAction('/pages/sale/edit', 'update') : canPageAction('/pages/sale/edit', 'create')
)

const bizModeLabel = computed(() => {
	const map = {
		bottle: '瓶装',
		truck: '整车',
		agent_sale: '代理出站'
	}
	return map[form.value.bizMode] || form.value.bizMode || '-'
})

const { summary: settlementSummary, validate: validateSettlement } = useSaleSettlement({
	form,
	outItems,
	backItems,
	agentSaleRows,
	truck,
	flow,
	settlement
})
const effectiveShouldReceive = computed(() => {
	const num = Number(settlementSummary.value?.settledAmount)
	return Number.isFinite(num) ? fix2(num) : 0
})
const manualAmountReceived = computed(() => {
	const num = Number(settlement.value?.amountReceived)
	return Number.isFinite(num) ? fix2(num) : 0
})
const normalizedOffsetCreditAvailable = computed(() => {
	const num = Number(offsetCreditAvailable.value)
	return Number.isFinite(num) && num > 0 ? fix2(num) : 0
})
const expectedOffsetAppliedAmount = computed(() => {
	if (!showSettlementBlocks.value || !settlement.value?.applyOffsetCredit) return 0
	if (effectiveShouldReceive.value <= 0) return 0
	const outstanding = fix2(effectiveShouldReceive.value - manualAmountReceived.value)
	if (outstanding <= 0) return 0
	return fix2(Math.min(normalizedOffsetCreditAvailable.value, outstanding))
})
const finalAmountReceivedPreview = computed(() => fix2(manualAmountReceived.value + expectedOffsetAppliedAmount.value))
const autoPaymentStatus = computed(() => resolvePaymentStatusByAmount(effectiveShouldReceive.value, finalAmountReceivedPreview.value))

const depositSummaryHint = computed(() => {
	const dateText = form.value.date ? `截至${form.value.date}` : '截至当前'
	return `实时合并：历史存瓶 + 本单出/存 - 本单回（${dateText}）`
})

const depositMerged = computed(() => {
	if (form.value.bizMode !== 'bottle') return { count: 0, list: [], raw: '' }
	const baseList = Array.isArray(depositData.value?.bottles) ? depositData.value.bottles : []
	const set = new Set(baseList.map(normalizeBottleNo).filter(Boolean))

	if (recordId.value) {
		const origin = originBottleSnapshot.value || { out: [], back: [], deposit: [] }
		origin.out.forEach((no) => set.delete(no))
		origin.deposit.forEach((no) => set.delete(no))
		origin.back.forEach((no) => set.add(no))
	}

	extractBottleNos(outItems.value).forEach((no) => set.add(no))
	extractBottleNos(depositRows.value).forEach((no) => set.add(no))
	extractBottleNos(backItems.value).forEach((no) => set.delete(no))

	const list = Array.from(set).filter(Boolean).sort()
	return { count: list.length, list, raw: list.join(' / ') }
})

function normalizeIdValue(value) {
	if (value == null) return null
	if (typeof value === 'object') {
		return value.$oid || value.oid || value.id || value._id || null
	}
	const text = String(value).trim()
	return text || null
}

function resolveOffsetEnabled(doc, fallback = false) {
	const raw = doc?.offset_enabled
	if (raw == null || raw === '') return Boolean(fallback)
	if (typeof raw === 'boolean') return raw
	if (typeof raw === 'number') return raw !== 0
	const text = String(raw).trim().toLowerCase()
	if (!text) return Boolean(fallback)
	if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true
	if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false
	return Boolean(fallback)
}

function resolveApplyOffsetCredit(doc, fallback = false) {
	const raw = doc?.apply_offset_credit ?? doc?.applyOffsetCredit
	if (raw == null || raw === '') return Boolean(fallback)
	if (typeof raw === 'boolean') return raw
	if (typeof raw === 'number') return raw !== 0
	const text = String(raw).trim().toLowerCase()
	if (!text) return Boolean(fallback)
	if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true
	if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false
	return Boolean(fallback)
}

function resolvePaymentStatusByAmount(shouldReceive, amountReceived) {
	const should = fix2(toNumber(shouldReceive, 0))
	const received = fix2(toNumber(amountReceived, 0))
	if (should <= 0) return 'paid'
	if (received <= 0) return 'unpaid'
	if (received >= should || Math.abs(received - should) < 0.01) return 'paid'
	return 'partial'
}

function extractBottleNos(rows) {
	return (rows || [])
		.map((row) => normalizeBottleNo(row?.bottle_no))
		.filter(Boolean)
}

function toNullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function formatTruckWeight(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	if (Number.isInteger(num)) return String(num)
	return num.toFixed(6).replace(/\.?0+$/, '')
}

function normalizeTruckNoByRule(value) {
	const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
	if (!raw) return ''
	const prefixed = raw.match(/^TRUCK[-_]?([A-Z0-9]+)$/)
	if (prefixed && prefixed[1]) return `TRUCK-${prefixed[1]}`
	const compact = raw.replace(/[^A-Z0-9\u4E00-\u9FA5]/g, '')
	if (!compact) return ''
	const plateMatch = compact.match(/^[\u4E00-\u9FA5][A-Z]([A-Z0-9]+)$/)
	const core = plateMatch && plateMatch[1] ? plateMatch[1] : compact
	return core ? `TRUCK-${core}` : ''
}

function resolveTruckReferenceNet(state) {
	const outGross = toNullableNumber(state?.truckOutGross)
	const backGross = toNullableNumber(state?.truckBackGross)
	if (outGross == null || backGross == null) return ''
	return formatTruckWeight(Math.max(outGross - backGross, 0))
}

function resolveTruckSettlementNet(state) {
	const settleGross = toNullableNumber(state?.truckSettleGross)
	const settleTare = toNullableNumber(state?.truckSettleTare)
	if (settleGross == null || settleTare == null) return ''
	return formatTruckWeight(Math.max(settleGross - settleTare, 0))
}

function normalizeTruckStateByPriceUnit() {
	const referenceNet = resolveTruckReferenceNet(truck.value)
	const settlementNet = resolveTruckSettlementNet(truck.value)
	truck.value.truckGrossDiff = referenceNet
	truck.value.truckSaleNet = form.value.priceUnit === 'kg' ? settlementNet : referenceNet
}

const { run: fetchDetail } = useQuery(
	async (id) => {
		const res = await getSaleV2({ _id: id })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
			return null
		}
		return res.data || null
	},
	{
		immediate: false,
		initialData: null,
		cacheTTL: 10000,
		throttleMs: 300,
		cacheKey: (id) => `sale:detail:${id}`
	}
)

const { data: depositData, loading: depositLoading, run: fetchDeposit } = useQuery(
	async (customerId, date) => {
		const res = await getCustomerDepositV1({ customerId, date })
		if (res?.code !== 0) {
			return { count: 0, raw: '' }
		}
		return res.data || { count: 0, raw: '' }
	},
	{
		immediate: false,
		cacheTTL: 10000,
		throttleMs: 300,
		cacheKey: (customerId, date) => `sale:deposit:${customerId || ''}:${date || ''}`
	}
)

watch(
	() => recordId.value,
	(id) => {
		const normalized = String(id || '')
		if (!normalized) return
		loadDetail(normalized)
	},
	{ immediate: true }
)

watch(
	() => [form.value.customerId, form.value.date, form.value.bizMode],
	([customerId, date, bizMode]) => {
		if (bizMode !== 'bottle' || !customerId) {
			depositData.value = { count: 0, raw: '', bottles: [] }
			return
		}
		fetchDeposit(customerId, date)
	},
	{ immediate: true }
)

watch(
	() => [form.value.customerId, form.value.settlementMode],
	([customerId, settlementMode]) => {
		if (!customerId || settlementMode === 'customer_flow') {
			offsetCreditFetchSeq += 1
			offsetCreditAvailable.value = 0
			offsetCreditLoading.value = false
			settlement.value.applyOffsetCredit = false
			return
		}
		loadOffsetCreditAvailability(customerId)
	},
	{ immediate: true }
)

watch(
	() => form.value.priceUnit,
	(priceUnit, prevPriceUnit) => {
		if (!priceUnit || priceUnit === prevPriceUnit) return
		if (form.value.bizMode === 'truck') {
			normalizeTruckStateByPriceUnit()
		}
		if (priceUnit === 'm3') {
			form.value.settlementMode = 'customer_flow'
			settlement.value.paymentMethod = 'on_account'
			return
		}
		if (form.value.settlementMode === 'customer_flow') {
			form.value.settlementMode = 'sale'
		}
	}
)

watch(
	() => [form.value.bizMode, form.value.vehicleNo],
	([mode, vehicleNo], [prevMode, prevVehicleNo] = []) => {
		if (mode !== 'truck') return
		const nextAutoTruckNo = normalizeTruckNoByRule(vehicleNo)
		if (!nextAutoTruckNo) return
		const currentTruckNo = normalizeTruckNoByRule(truck.value.truckNo)
		const prevAutoTruckNo = normalizeTruckNoByRule(prevVehicleNo)
		const switchedToTruck = prevMode !== 'truck'
		if (!currentTruckNo || switchedToTruck || (prevAutoTruckNo && currentTruckNo === prevAutoTruckNo)) {
			truck.value.truckNo = nextAutoTruckNo
		}
	}
)

watch(
	() => settlement.value.paymentStatus,
	(status) => {
		const current = String(status || '').trim()
		if (!current) return
		if (current === 'unpaid' || current === '未付款') {
			settlement.value.paymentMethod = 'on_account'
			return
		}
		if (!settlement.value.paymentMethod || settlement.value.paymentMethod === 'on_account') {
			settlement.value.paymentMethod = 'cash'
		}
	},
	{ immediate: true }
)

watch(
	() => autoPaymentStatus.value,
	(status) => {
		if (!showSettlementBlocks.value) return
		if (settlement.value.paymentStatus === status) return
		settlement.value.paymentStatus = status
	},
	{ immediate: true }
)

watch(
	() => form.value.bizMode,
	(mode, prevMode) => {
		if (!mode || mode === prevMode) return
			if (mode === 'bottle') {
				truck.value = {
				truckNo: '',
				truckOutGross: '',
				truckBackGross: '',
				truckSettleTare: '',
				truckSettleGross: '',
				truckGrossDiff: '',
				truckSaleNet: ''
				}
			agentSaleRows.value = []
			return
		}
		if (mode === 'truck') {
			outItems.value = []
			backItems.value = []
			depositRows.value = []
			agentSaleRows.value = []
			return
		}
			if (mode === 'agent_sale') {
				outItems.value = []
				backItems.value = []
				depositRows.value = []
				truck.value = {
				truckNo: '',
				truckOutGross: '',
				truckBackGross: '',
				truckSettleTare: '',
				truckSettleGross: '',
				truckGrossDiff: '',
				truckSaleNet: ''
				}
		}
	}
)

async function loadDetail(id) {
	const data = await fetchDetail(id)
	if (!data) return
	const doc = data
	form.value = {
		date: doc.date || '',
		customerId: doc.customer_id || '',
		customerName: doc.customer_name || '',
		vehicleNo: doc.car_no || '',
		settlementMode: (doc.price_unit || 'kg') === 'm3' ? 'customer_flow' : (doc.settlement_mode || 'sale'),
		priceUnit: doc.price_unit || 'kg',
		unitPrice: doc.unit_price == null ? '' : String(doc.unit_price),
		remark: doc.remark || '',
		ticketImage: doc.ticket_image || '',
		ticketImages: [],
		bizMode: doc.biz_mode || 'bottle',
		deliveryMan1: '',
		deliveryMan2: ''
	}
	const delivery = String(doc.delivery_man || '')
	const parts = delivery.split(' / ')
	form.value.deliveryMan1 = parts[0] || ''
	form.value.deliveryMan2 = parts[1] || ''

	flow.value = {
		flowPrev: doc.flow_index_prev == null ? '' : String(doc.flow_index_prev),
		flowCurr: doc.flow_index_curr == null ? '' : String(doc.flow_index_curr),
		flowVolume: doc.flow_volume_m3 == null ? '' : String(doc.flow_volume_m3),
		flowRatio: doc.flow_theory_ratio == null ? '' : String(doc.flow_theory_ratio)
	}

	truck.value = {
		truckNo: doc.truck_no || '',
		truckOutGross: doc.truck_out_gross == null ? '' : String(doc.truck_out_gross),
		truckBackGross: doc.truck_back_gross == null ? '' : String(doc.truck_back_gross),
		truckSettleTare: doc.truck_settle_tare == null ? '' : String(doc.truck_settle_tare),
		truckSettleGross: doc.truck_settle_gross == null ? '' : String(doc.truck_settle_gross),
		truckGrossDiff: doc.truck_gross_diff == null ? '' : String(doc.truck_gross_diff),
		truckSaleNet: doc.truck_sale_net == null ? '' : String(doc.truck_sale_net)
	}
	normalizeTruckStateByPriceUnit()

	settlement.value = {
		paymentStatus: doc.payment_status || 'unpaid',
		paymentMethod: doc.payment_method || ((doc.payment_status || 'unpaid') === 'unpaid' ? 'on_account' : 'cash'),
		amountReceived: doc.amount_received == null ? '' : String(doc.amount_received),
		roundingAmount: doc.rounding_amount == null ? '' : String(doc.rounding_amount),
		applyOffsetCredit: resolveApplyOffsetCredit(doc, false),
		offsetEnabled: resolveOffsetEnabled(doc, true),
		paymentNote: doc.payment_note || ''
	}

	outItems.value = Array.isArray(doc.out_items)
		? doc.out_items.map((row) => ({
			bottle_no: row.bottle_no || '',
			bottle_id: row.bottle_id || null,
			gross: row.gross == null ? '' : String(row.gross),
			tare: row.tare == null ? '' : String(row.tare),
			net: row.net == null ? '' : String(row.net),
			netManual: false,
			suggestions: []
		}))
		: []
	backItems.value = Array.isArray(doc.back_items)
		? doc.back_items.map((row) => ({
			bottle_no: row.bottle_no || '',
			bottle_id: row.bottle_id || null,
			gross: row.gross == null ? '' : String(row.gross),
			tare: row.tare == null ? '' : String(row.tare),
			net: row.net == null ? '' : String(row.net),
			netManual: false,
			suggestions: []
		}))
		: []
	depositRows.value = Array.isArray(doc.deposit_rows)
		? doc.deposit_rows.map((row) => ({
			bottle_no: row.bottle_no || '',
			bottle_id: row.bottle_id || null,
			suggestions: []
		}))
		: []
	agentSaleRows.value = Array.isArray(doc.agent_sale_items)
		? doc.agent_sale_items.map((row) => ({
			bottle_no: row.bottle_no || '',
			bottle_id: row.bottle_id || null,
			fill_weight: row.fill_weight == null ? '' : String(row.fill_weight),
			address: row.address || '',
			filling_record_id: normalizeIdValue(row.filling_record_id),
			suggestions: []
		}))
		: []

	originBottleSnapshot.value = {
		out: extractBottleNos(outItems.value),
		back: extractBottleNos(backItems.value),
		deposit: extractBottleNos(depositRows.value)
	}
	await applyTicketImages(Array.isArray(doc.ticket_images) ? doc.ticket_images : [doc.ticket_image || ''])
}

async function loadOffsetCreditAvailability(customerId = form.value.customerId) {
	const targetCustomerId = String(customerId || '').trim()
	const fetchSeq = ++offsetCreditFetchSeq
	if (!targetCustomerId || !showSettlementBlocks.value) {
		offsetCreditAvailable.value = 0
		offsetCreditLoading.value = false
		settlement.value.applyOffsetCredit = false
		return
	}
	offsetCreditLoading.value = true
	let availableTotal = 0
	try {
		let page = 1
		let guard = 0
		while (guard < 200) {
			const res = await listOffsetCreditPoolV1({
				customerId: targetCustomerId,
				onlyUnallocated: true,
				page,
				pageSize: 200
			})
			if (fetchSeq !== offsetCreditFetchSeq) return
			if (res?.code !== 0) {
				availableTotal = 0
				break
			}
			const rows = Array.isArray(res?.data) ? res.data : []
			availableTotal = fix2(
				availableTotal + rows.reduce((sum, row) => sum + toNumber(row?.unallocated_amount, 0), 0)
			)
			const hasMore = Boolean(res?.paging?.hasMore)
			if (!hasMore || rows.length <= 0) break
			page += 1
			guard += 1
		}
	} catch (_) {
		if (fetchSeq !== offsetCreditFetchSeq) return
		availableTotal = 0
	} finally {
		if (fetchSeq !== offsetCreditFetchSeq) return
		offsetCreditAvailable.value = fix2(Math.max(availableTotal, 0))
		offsetCreditLoading.value = false
		if (offsetCreditAvailable.value <= 0) settlement.value.applyOffsetCredit = false
	}
}

function syncSettlementStatusForSubmit() {
	if (!showSettlementBlocks.value) return
	settlement.value.paymentStatus = autoPaymentStatus.value
	if (settlement.value.paymentStatus === 'unpaid') {
		settlement.value.paymentMethod = 'on_account'
		return
	}
	if (!settlement.value.paymentMethod || settlement.value.paymentMethod === 'on_account') {
		settlement.value.paymentMethod = 'cash'
	}
}

async function onSubmit() {
	if (submitting.value) return
	
	// Validation
	if (!form.value.date) {
		uni.showToast({ title: '请选择销售日期', icon: 'none' })
		return
	}
	if (!form.value.customerId) {
		uni.showToast({ title: '请从列表选择客户', icon: 'none' })
		return
	}

	syncSettlementStatusForSubmit()
	const validation = validateSettlement()
	if (!validation.ok) {
		uni.showToast({ title: validation.msg || '结算金额与付款状态不一致', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		let result = await submitSale(false)
		if (isBottleFlowWarningResult(result)) {
			const confirmRes = await uni.showModal({
				title: '请核对瓶号',
				content: buildBottleFlowWarningContent(result),
				confirmText: '继续提交',
				cancelText: '返回修改'
			})
			if (!confirmRes.confirm) return
			result = await submitSale(true)
		}
		
		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}
		try {
			uni.setStorageSync(SALE_LIST_REFRESH_KEY, String(Date.now()))
		} catch (_) {
			// ignore storage failures
		}
		const savedWithOverride = Boolean(result?.data?.bottle_flow_warning_overridden) && Number(result?.data?.bottle_flow_warning_count || 0) > 0
		const reminder = buildOverCollectionReminder()
		if (reminder) {
			await uni.showModal({
				title: savedWithOverride ? '已核对并保存' : '保存成功',
				content: reminder,
				showCancel: false,
				confirmText: '知道了'
			})
		} else {
			uni.showToast({ title: savedWithOverride ? '已核对并保存' : '保存成功', icon: 'success' })
		}
		navigateAfterSave()
	} catch (err) {
		const failure = resolveSubmitFailure(err)
		console.error('save sale failed', failure, err)
		if (failure.timeout) {
			await uni.showModal({
				title: '保存请求超时',
				content: `${failure.message}\n可能已保存成功，请返回销售列表刷新确认。`,
				showCancel: false,
				confirmText: '知道了'
			})
		} else if (failure.message && failure.message !== '保存失败') {
			await uni.showModal({
				title: '保存失败',
				content: failure.message,
				showCancel: false,
				confirmText: '知道了'
			})
		} else {
			uni.showToast({ title: '保存失败', icon: 'none' })
		}
	} finally {
		submitting.value = false
	}
}

function buildOverCollectionReminder() {
	if (form.value.settlementMode === 'customer_flow') return ''
	const shouldReceive = Number(settlementSummary.value?.settledAmount)
	const amountReceived = Number(settlement.value?.amountReceived)
	if (!Number.isFinite(shouldReceive) || !Number.isFinite(amountReceived)) return ''
	if (shouldReceive <= 0) return ''
	const overAmount = Number((amountReceived - shouldReceive).toFixed(2))
	if (!(overAmount > 0)) return ''
	if (Boolean(settlement.value?.offsetEnabled)) {
		return `本单应收 ¥${shouldReceive.toFixed(2)}，实收 ¥${amountReceived.toFixed(2)}，多收 ¥${overAmount.toFixed(2)}。\n该差额将进入冲抵池，需在客户对账页手工分配。`
	}
	return `本单应收 ¥${shouldReceive.toFixed(2)}，实收 ¥${amountReceived.toFixed(2)}，多收 ¥${overAmount.toFixed(2)}。\n当前未勾选“是否冲抵”，该差额不会进入冲抵池。`
}

function resolveSubmitFailure(err) {
	const parts = [
		err?.userMessage,
		err?.result?.msg,
		err?.errMsg,
		err?.message,
		err?.cause?.userMessage,
		err?.cause?.result?.msg,
		err?.cause?.errMsg,
		err?.cause?.message
	]
	const message = parts
		.map((item) => String(item || '').trim())
		.find(Boolean) || '保存失败'
	const normalized = message.toLowerCase()
	const timeout = /timeout|timed out|超时|request:fail|network|网络异常/.test(normalized)
	return {
		message,
		timeout
	}
}

function onCancel() {
	uni.navigateBack({ delta: 1 })
}

function navigateAfterSave() {
	// 新建保存后固定返回销售列表；编辑保持返回上一页
	if (!recordId.value) {
		uni.redirectTo({ url: '/pages/sale/list' })
		return
	}
	uni.navigateBack({ delta: 1 })
}

async function submitSale(ignoreBottleFlowWarning = false) {
	const ticketImageIds = await ensureTicketImagesUploaded()
	const payload = {
		form: {
			...form.value,
			ticketImage: ticketImageIds[0] || '',
			ticketImages: ticketImageIds
		},
		flow: flow.value,
		truck: truck.value,
		settlement: settlement.value,
		outItems: outItems.value,
		backItems: backItems.value,
		depositRows: depositRows.value,
		agentSaleRows: agentSaleRows.value
	}
	try {
		const result = await (recordId.value
			? updateSaleV2({ _id: recordId.value, draft: payload, ignoreBottleFlowWarning })
			: createSaleV2(payload, { ignoreBottleFlowWarning }))
		return result
	} catch (err) {
		const wrapped = new Error('云函数调用失败')
		wrapped.userMessage = String(err?.result?.msg || err?.errMsg || err?.message || '').trim()
		wrapped.cause = err
		throw wrapped
	}
}

async function chooseTicketImage() {
	try {
		const remain = Math.max(3 - ticketImages.value.length, 0)
		if (!remain) {
			uni.showToast({ title: '最多上传 3 张', icon: 'none' })
			return
		}
		const res = await uni.chooseImage({
			count: remain,
			sizeType: ['compressed'],
			sourceType: ['album', 'camera']
		})
		const paths = extractChooseImagePaths(res)
		if (!paths.length) return
		const merged = ticketImages.value.slice()
		for (const path of paths) {
			const localPath = String(path || '').trim()
			if (!localPath) continue
			const exists = merged.some((item) => String(item?.localPath || '') === localPath)
			if (exists) continue
			merged.push({
				fileId: '',
				localPath,
				previewUrl: localPath,
				uploading: false
			})
			if (merged.length >= 3) break
		}
		ticketImages.value = merged
		form.value.ticketImage = merged[0]?.fileId || ''
		form.value.ticketImages = merged.map((item) => item.fileId).filter(Boolean)
	} catch (err) {
		if (String(err?.errMsg || '').includes('cancel')) return
		uni.showToast({ title: '选择图片失败', icon: 'none' })
	}
}

function extractChooseImagePaths(res = null) {
	const merged = []
	const pushOne = (value) => {
		const path = String(value || '').trim()
		if (!path) return
		if (!merged.includes(path)) merged.push(path)
	}
	;(Array.isArray(res?.tempFilePaths) ? res.tempFilePaths : []).forEach(pushOne)
	;(Array.isArray(res?.apFilePaths) ? res.apFilePaths : []).forEach(pushOne)
	;(Array.isArray(res?.tempFiles) ? res.tempFiles : []).forEach((item) => {
		pushOne(item?.path)
		pushOne(item?.tempFilePath)
		pushOne(item?.apFilePath)
	})
	return merged
}

function removeTicketImage(index) {
	if (ticketImageUploading.value) return
	const list = ticketImages.value.slice()
	list.splice(index, 1)
	ticketImages.value = list
	const fileIds = list.map((item) => item.fileId).filter(Boolean)
	form.value.ticketImage = fileIds[0] || ''
	form.value.ticketImages = fileIds
}

function resolveTicketImagePreview(item) {
	if (!item) return ''
	return String(item.localPath || item.previewUrl || item.fileId || '').trim()
}

function previewTicketImage(index = 0) {
	const urls = ticketImages.value.map((item) => resolveTicketImagePreview(item)).filter(Boolean)
	if (!urls.length) return
	const current = urls[index] || urls[0]
	uni.previewImage({
		urls,
		current
	})
}

async function resolveTicketImageUrls(fileIds = []) {
	const normalized = Array.from(
		new Set((fileIds || []).map((item) => String(item || '').trim()).filter(Boolean))
	)
	if (!normalized.length) return []
	try {
		const res = await uniCloud.getTempFileURL({
			fileList: normalized
		})
		const list = Array.isArray(res?.fileList) ? res.fileList : []
		const urlMap = new Map()
		for (const item of list) {
			const fileId = String(item?.fileID || item?.fileId || '').trim()
			if (!fileId) continue
			urlMap.set(fileId, item?.tempFileURL || fileId)
		}
		return normalized.map((fileId) => urlMap.get(fileId) || fileId)
	} catch (err) {
		return normalized
	}
}

async function applyTicketImages(fileIds = []) {
	const normalized = Array.from(
		new Set((fileIds || []).map((item) => String(item || '').trim()).filter(Boolean))
	).slice(0, 3)
	if (!normalized.length) {
		ticketImages.value = []
		form.value.ticketImage = ''
		form.value.ticketImages = []
		return
	}
	const urls = await resolveTicketImageUrls(normalized)
	ticketImages.value = normalized.map((fileId, index) => ({
		fileId,
		localPath: '',
		previewUrl: urls[index] || fileId,
		uploading: false
	}))
	form.value.ticketImage = normalized[0] || ''
	form.value.ticketImages = normalized
}

async function ensureTicketImagesUploaded() {
	const list = ticketImages.value.slice(0, 3)
	const resultIds = []
	for (let i = 0; i < list.length; i += 1) {
		const item = list[i] || {}
		if (!item.localPath) {
			const fileId = String(item.fileId || '').trim()
			if (fileId) resultIds.push(fileId)
			continue
		}
		list[i] = { ...item, uploading: true }
		ticketImages.value = list.slice()
		try {
			const attempt = await tryUploadTicketImage({
				filePath: item.localPath,
				ext: resolveUploadExt(item.localPath),
				index: i
			})
			if (!attempt.fileId) throw attempt.error || new Error('上传结果缺少 fileID')
			list[i] = {
				fileId: attempt.fileId,
				localPath: '',
				previewUrl: item.previewUrl || item.localPath || '',
				uploading: false
			}
			resultIds.push(attempt.fileId)
			ticketImages.value = list.slice()
		} catch (err) {
			list[i] = { ...item, uploading: false }
			ticketImages.value = list.slice()
			const wrapped = new Error('销售底单上传失败')
			wrapped.userMessage = buildTicketUploadFailureMessage({
				index: i,
				error: err,
				localPath: item.localPath
			})
			wrapped.cause = err
			throw wrapped
		}
	}
	const normalized = Array.from(new Set(resultIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 3)
	form.value.ticketImage = normalized[0] || ''
	form.value.ticketImages = normalized
	return normalized
}

async function tryUploadTicketImage({ filePath = '', ext = '.jpg', index = 0 } = {}) {
	const normalizedPath = String(filePath || '').trim()
	if (!normalizedPath) {
		return { fileId: '', error: new Error('上传文件路径为空') }
	}
	const normalizedExt = String(ext || '').trim() || '.jpg'
	const cloudPath = `sale-ticket/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}${normalizedExt}`
	try {
		const res = await uniCloud.uploadFile({
			fileType: 'image',
			cloudPath,
			filePath: normalizedPath
		})
			const fileId = resolveCloudFileIdFromUploadResult(res)
			if (fileId) return { fileId, error: null }
			const recoveredId = await recoverCloudFileIdByPath(cloudPath)
			if (recoveredId) return { fileId: recoveredId, error: null }
			return { fileId: '', error: new Error('上传结果缺少 fileID') }
		} catch (err) {
			const recoveredId = await recoverCloudFileIdByPath(cloudPath)
			if (recoveredId) return { fileId: recoveredId, error: null }
			return { fileId: '', error: err || new Error('uploadFile:fail') }
		}
}

function inferCloudSpaceId() {
	const candidates = []
	const pushOne = (value) => {
		const text = String(value || '').trim()
		if (!text) return
		const match = text.match(/^cloud:\/\/([^/]+)\//)
		if (!match || !match[1]) return
		const id = String(match[1]).trim()
		if (!id) return
		if (!candidates.includes(id)) candidates.push(id)
	}
	pushOne(form.value.ticketImage)
	;(Array.isArray(form.value.ticketImages) ? form.value.ticketImages : []).forEach(pushOne)
	;(Array.isArray(ticketImages.value) ? ticketImages.value : []).forEach((item) => {
		pushOne(item?.fileId)
		pushOne(item?.previewUrl)
	})
	return candidates[0] || 'env-00jxuffegf2n'
}

async function recoverCloudFileIdByPath(cloudPath = '') {
	const normalized = String(cloudPath || '').trim().replace(/^\/+/, '')
	if (!normalized) return ''
	const spaceId = inferCloudSpaceId()
	if (!spaceId) return ''
	const fileId = `cloud://${spaceId}/${normalized}`
	try {
		const res = await uniCloud.getTempFileURL({
			fileList: [fileId]
		})
		const list = Array.isArray(res?.fileList) ? res.fileList : []
		const hit = list.find((item) => {
			const id = String(item?.fileID || item?.fileId || '').trim()
			return id === fileId
		})
		if (!hit) return ''
		const code = Number(hit?.code)
		const tempUrl = String(hit?.tempFileURL || hit?.tempFileUrl || '').trim()
		if ((Number.isFinite(code) && code === 0) || tempUrl) return fileId
	} catch (_) {
		// ignore verify errors
	}
	return ''
}

function resolveCloudFileIdFromUploadResult(result = null) {
	const direct = String(result?.fileID || result?.fileId || '').trim()
	if (direct.startsWith('cloud://')) return direct
	const queue = [result]
	const seen = new Set()
	while (queue.length > 0) {
		const current = queue.shift()
		if (current == null) continue
		if (typeof current === 'string') {
			const text = String(current).trim()
			const match = text.match(/cloud:\/\/[^\s"'`\\]+/)
			if (match && match[0]) return match[0]
			if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
				try {
					queue.push(JSON.parse(text))
				} catch (_) {
					// ignore parse error
				}
			}
			continue
		}
		if (typeof current !== 'object') continue
		if (seen.has(current)) continue
		seen.add(current)
		if (Array.isArray(current)) {
			current.forEach((item) => queue.push(item))
			continue
		}
		Object.keys(current).forEach((key) => queue.push(current[key]))
	}
	return ''
}

function resolveUploadExt(filePath) {
	const pathText = String(filePath || '').trim()
	const extMatch = pathText.match(/\.([a-zA-Z0-9]+)$/)
	if (extMatch && extMatch[1]) return `.${extMatch[1].toLowerCase()}`
	return '.jpg'
}

function buildTicketUploadFailureMessage({ index = 0, error = null, localPath = '' } = {}) {
	const raw = String(error?.errMsg || error?.message || 'uploadFile:fail').trim() || 'uploadFile:fail'
	const pathText = String(localPath || '').trim()
	const shortPath = pathText.length > 40 ? `...${pathText.slice(-40)}` : pathText
	if (/timeout|timed out|超时|network|网络|request:fail/i.test(raw)) {
		return `第 ${index + 1} 张底单上传超时或网络异常（${raw}）。请检查网络后重试。`
	}
	if (/no such file|not found|文件不存在|file not exist|路径为空/i.test(raw)) {
		return `第 ${index + 1} 张底单临时文件失效（${raw}）。请重新选择该图片后保存。`
	}
	return `第 ${index + 1} 张底单上传失败（${raw}${shortPath ? `，路径 ${shortPath}` : ''}）。`
}

function isBottleFlowWarningResult(result) {
	return Number(result?.code || 0) === 409
		&& Boolean(result?.data?.confirmable)
		&& String(result?.data?.warning_kind || '') === 'bottle_flow_mismatch'
		&& Array.isArray(result?.data?.warning_items)
		&& result.data.warning_items.length > 0
}

function buildBottleFlowWarningContent(result) {
	const items = Array.isArray(result?.data?.warning_items) ? result.data.warning_items : []
	const summaryText = String(result?.data?.summary_text || result?.msg || '发现瓶流转异常，请核对').trim()
	const preview = items.slice(0, 6).map((item, index) => {
		const directionText = item?.direction === 'back' ? '回瓶' : '出瓶'
		const bottleNo = String(item?.bottle_no || '-').trim() || '-'
		const reason = String(item?.reason || '').trim()
		return `${index + 1}. ${directionText} ${bottleNo}：${reason}`
	})
	if (items.length > preview.length) preview.push(`等 ${items.length} 条，请确认是否仍要继续提交。`)
	else preview.push('请确认是否仍要继续提交。')
	return [summaryText, '', ...preview].join('\n')
}
</script>

<style scoped>
.edit-container {
	padding-bottom: 48rpx;
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.edit-header-card {
	box-shadow: 0 12rpx 32rpx rgba(15, 23, 42, 0.06);
}

.edit-header-info {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 20rpx;
}

.info-pill {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 16rpx 18rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
}

.pill-label {
	font-size: 20rpx;
	color: var(--crm-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.6rpx;
}

.pill-value {
	font-size: 28rpx;
	color: var(--crm-text);
	font-weight: 700;
}

.form-body {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.submit-footer {
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 12rpx;
	padding: 8rpx 0 4rpx;
}

.section-popover-host {
	overflow: visible;
}

.section-popover-host :deep(.section__body) {
	overflow: visible;
}

.bottle-sections {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.deposit-summary {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 16rpx 18rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
	margin-bottom: 16rpx;
}

.deposit-summary__main {
	display: flex;
	align-items: center;
	gap: 12rpx;
}

.deposit-summary__label {
	font-size: 24rpx;
	color: #64748b;
}

.deposit-summary__value {
	font-size: 28rpx;
	font-weight: 700;
	color: #0f172a;
}

.deposit-summary__loading {
	font-size: 22rpx;
	color: #94a3b8;
}

.deposit-summary__hint {
	font-size: 22rpx;
	color: #94a3b8;
}

.deposit-summary__list {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
	max-height: 160rpx;
	overflow: auto;
	padding-right: 4rpx;
}

.deposit-summary__tag {
	padding: 6rpx 12rpx;
	border-radius: 999rpx;
	background: #fff;
	border: 1rpx solid #e2e8f0;
	font-size: 22rpx;
	color: #475569;
}

.deposit-summary__empty {
	font-size: 22rpx;
	color: #cbd5e1;
}

.settlement-mode-note {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	padding: 18rpx 20rpx;
	border: 1rpx solid #dbeafe;
	border-radius: 16rpx;
	background: #eff6ff;
}

.settlement-mode-note__title {
	font-size: 26rpx;
	font-weight: 700;
	color: #1d4ed8;
}

.settlement-mode-note__text {
	font-size: 22rpx;
	line-height: 1.6;
	color: #475569;
}

.ticket-card {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.ticket-card__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 24rpx;
}

.ticket-card__meta {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.ticket-card__title {
	font-size: 28rpx;
	font-weight: 700;
	color: #0f172a;
}

.ticket-card__hint {
	font-size: 22rpx;
	color: #94a3b8;
}

.ticket-card__preview-list {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 14rpx;
}

.ticket-card__preview-item {
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.ticket-card__preview {
	width: 100%;
	height: 240rpx;
	border-radius: 20rpx;
	background: #f8fafc;
	border: 1rpx solid #e2e8f0;
}

.ticket-card__actions {
	display: flex;
	align-items: center;
	gap: 12rpx;
	flex-wrap: wrap;
}

.ticket-card__status {
	font-size: 22rpx;
	color: #64748b;
}

.ticket-card__empty {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	padding: 28rpx 24rpx;
	border-radius: 20rpx;
	background: #f8fafc;
	border: 1rpx dashed #cbd5e1;
}

.ticket-card__empty-title {
	font-size: 26rpx;
	font-weight: 700;
	color: #334155;
}

.ticket-card__empty-text {
	font-size: 22rpx;
	color: #94a3b8;
	line-height: 1.6;
}

@media (max-width: 600px) {
	.submit-footer {
		flex-direction: column-reverse;
		align-items: stretch;
	}

	.ticket-card__preview-list {
		grid-template-columns: 1fr;
	}
}
</style>
