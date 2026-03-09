<template>
	<AppPage :title="recordId ? '修改销售记录' : '新建销售单'" subtitle="EDIT RECORD" icon="edit">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="onCancel" :disabled="submitting">取消</AppButton>
			<AppButton size="sm" kind="primary" @click="onSubmit" :loading="submitting" icon="check">保存并提交</AppButton>
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
				<AppSection title="基础信息">
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
					<SaleAgentSaleCard v-model="agentSaleRows" size="sm" />
				</AppSection>

				<AppSection v-if="showFlowBlocks" title="流量结算">
					<SaleFlowCard v-model="flow" size="sm" />
				</AppSection>

				<AppSection v-if="showTruckBlocks" title="整车业务">
					<SaleTruckCard v-model="truck" size="sm" />
				</AppSection>

				<AppSection title="收款结算">
					<SaleSettlementCard
						v-model="settlement"
						size="sm"
						:should-receive="settlementSummary.amount"
						:formula="settlementSummary.formula"
					/>
				</AppSection>
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
import { normalizeBottleNo } from '@/services/models'
import { createSaleV2, getSaleV2, updateSaleV2, getCustomerDepositV1 } from '@/services/sale'
import { useQuery } from '@/composables/useQuery'
import { useSaleSettlement } from '@/composables/useSaleSettlement'
import SaleBasicInfoCard from '@/components/domain/sale/SaleBasicInfoCard.vue'
import SaleBottleLinesCard from '@/components/domain/sale/SaleBottleLinesCard.vue'
import SaleDepositCard from '@/components/domain/sale/SaleDepositCard.vue'
import SaleFlowCard from '@/components/domain/sale/SaleFlowCard.vue'
import SaleTruckCard from '@/components/domain/sale/SaleTruckCard.vue'
import SaleAgentSaleCard from '@/components/domain/sale/SaleAgentSaleCard.vue'
import SaleSettlementCard from '@/components/domain/sale/SaleSettlementCard.vue'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')

const form = ref({
	date: '',
	customerId: '',
	customerName: '',
	deliveryMan1: '',
	deliveryMan2: '',
	vehicleNo: '',
	bizMode: 'bottle',
	priceUnit: 'kg',
	unitPrice: ''
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
	truckSaleNet: ''
})

const settlement = ref({
	paymentStatus: 'unpaid',
	paymentMethod: 'on_account',
	amountReceived: '',
	roundingAmount: '',
	paymentNote: ''
})

const outItems = ref([])
const backItems = ref([])
const depositRows = ref([])
const agentSaleRows = ref([])
const submitting = ref(false)
const originBottleSnapshot = ref({ out: [], back: [], deposit: [] })

const showBottleBlocks = computed(() => form.value.bizMode === 'bottle')
const showTruckBlocks = computed(() => form.value.bizMode === 'truck')
const showAgentBlocks = computed(() => form.value.bizMode === 'agent_sale')
const showFlowBlocks = computed(() => form.value.priceUnit === 'm3')

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

function extractBottleNos(rows) {
	return (rows || [])
		.map((row) => normalizeBottleNo(row?.bottle_no))
		.filter(Boolean)
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

async function loadDetail(id) {
	const data = await fetchDetail(id)
	if (!data) return
	const doc = data
	form.value = {
		date: doc.date || '',
		customerId: doc.customer_id || '',
		customerName: doc.customer_name || '',
		vehicleNo: doc.car_no || '',
		priceUnit: doc.price_unit || 'kg',
		unitPrice: doc.unit_price == null ? '' : String(doc.unit_price),
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
		truckSaleNet: doc.truck_sale_net == null ? '' : String(doc.truck_sale_net)
	}

	settlement.value = {
		paymentStatus: doc.payment_status || 'unpaid',
		paymentMethod: doc.payment_method || 'on_account',
		amountReceived: doc.amount_received == null ? '' : String(doc.amount_received),
		roundingAmount: doc.rounding_amount == null ? '' : String(doc.rounding_amount),
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
		? doc.deposit_rows.map((row) => ({ bottle_no: row.bottle_no || '' }))
		: []
	agentSaleRows.value = Array.isArray(doc.agent_sale_items)
		? doc.agent_sale_items.map((row) => ({
			bottle_no: row.bottle_no || '',
			fill_weight: row.fill_weight == null ? '' : String(row.fill_weight),
			address: row.address || ''
		}))
		: []

	originBottleSnapshot.value = {
		out: extractBottleNos(outItems.value),
		back: extractBottleNos(backItems.value),
		deposit: extractBottleNos(depositRows.value)
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

	const validation = validateSettlement()
	if (!validation.ok) {
		uni.showToast({ title: validation.msg || '结算金额与付款状态不一致', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const payload = {
			form: form.value,
			flow: flow.value,
			truck: truck.value,
			settlement: settlement.value,
			outItems: outItems.value,
			backItems: backItems.value,
			depositRows: depositRows.value,
			agentSaleRows: agentSaleRows.value
		}
		const result = recordId.value
			? await updateSaleV2({ _id: recordId.value, draft: payload })
			: await createSaleV2(payload)
		
		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}
		
		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save sale failed', err)
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
</style>
