<template>
	<AppPage title="销售单详情" :subtitle="detail.customer_name || '销售单详情'" icon="document">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="onBack">返回</AppButton>
			<AppButton v-if="canDeleteSale" size="sm" kind="outline" :loading="removing" @click="onRemove">删除单据</AppButton>
			<AppButton v-if="canViewStatement" size="sm" kind="neutral" @click="onCustomerStatement">客户对账</AppButton>
			<AppButton v-if="canUpdateSale" size="sm" kind="primary" @click="onEdit" icon="document">编辑单据</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="销售日期" :value="detail.date || '-'" icon="calendar" />
				<AppStatCard class="summary-card" label="业务模式" :value="bizModeText(detail.biz_mode)" icon="list" />
				<AppStatCard class="summary-card" label="应收总额" :value="formatMoney(detail.should_receive)" hint="元" icon="wallet" />
				<AppStatCard class="summary-card" label="实收金额" :value="formatMoney(detail.amount_received)" hint="元" icon="check-circle" />
				<AppStatCard class="summary-card" label="净未收" :value="formatMoney(outstandingNumber)" hint="元" icon="alert" />
				<AppStatCard class="summary-card" label="付款状态" :value="paymentStatusText(detail.payment_status)" icon="credit-card" />
			</view>
		</template>

		<view class="detail-container">
			<AppSection title="基础信息">
				<view class="info-grid info-grid--base">
					<view class="info-item info-item--inline">
						<text class="info-label">客户名称</text>
						<text class="info-value">{{ detail.customer_name || '-' }}</text>
					</view>
					<view class="info-item info-item--inline">
						<text class="info-label">销售日期</text>
						<text class="info-value">{{ detail.date || '-' }}</text>
					</view>
					<view class="info-item info-item--inline">
						<text class="info-label">业务模式</text>
						<text class="info-value">{{ bizModeText(detail.biz_mode) }}</text>
					</view>
					<view class="info-item info-item--inline">
						<text class="info-label">配送车辆</text>
						<text class="info-value">{{ deliveryVehicleText }}</text>
					</view>
					<view class="info-item info-item--inline">
						<text class="info-label">配送员</text>
						<text class="info-value">{{ deliveryManText }}</text>
					</view>
					<view class="info-item info-item--inline">
						<text class="info-label">计价单位 / 单价</text>
						<text class="info-value">{{ priceUnitAndPriceText }}</text>
					</view>
					<view class="info-item span-3">
						<text class="info-label">业务备注</text>
						<text class="info-value">{{ detail.remark || '无' }}</text>
					</view>
					<view class="info-item span-3">
						<text class="info-label">系统备注</text>
						<text class="info-value">{{ detail.system_note || '无' }}</text>
					</view>
					<view class="info-item span-3">
						<text class="info-label">解析标签</text>
						<view v-if="remarkTagLabels.length" class="remark-tag-list">
							<AppTag
								v-for="tag in remarkTagLabels"
								:key="tag.value"
								kind="soft"
								@click="onRemarkTagClick(tag.value)"
							>
								{{ tag.label }}
							</AppTag>
						</view>
						<text v-else class="info-value">无</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="销售底单">
				<view v-if="!ticketImageFileIds.length" class="ticket-placeholder">
					<text class="ticket-placeholder__text">未上传销售底单</text>
				</view>
				<view v-else class="ticket-block">
					<text v-if="ticketImageLoading" class="ticket-loading">图片加载中...</text>
					<view class="ticket-grid">
						<view
							v-for="(item, index) in ticketImagePreviews"
							:key="item.fileId || index"
							class="ticket-item"
						>
							<image
								class="ticket-item__image"
								:src="item.url || item.fileId"
								mode="aspectFill"
								@click="onPreviewTicketImage(index)"
							/>
							<text class="ticket-item__label">底单 {{ index + 1 }}</text>
						</view>
					</view>
				</view>
			</AppSection>

			<AppSection title="结算公式">
				<view class="formula-panel">
					<text class="formula-text">{{ settlementFormula.formula }}</text>
					<view class="formula-metrics">
						<text class="formula-metrics__item">应收：¥{{ formatMoney(settlementFormula.shouldAmount) }}</text>
						<text class="formula-metrics__item">抹零：¥{{ formatMoney(settlementFormula.roundingAmount) }}</text>
						<text class="formula-metrics__item formula-metrics__item--strong">实收口径：¥{{ formatMoney(settlementFormula.settledAmount) }}</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="关联项（已整合）">
				<view v-if="hasRelatedData" class="related-stack">
					<view class="related-block" v-if="outRows.length">
						<view class="related-head">
							<text class="related-title">出瓶明细</text>
							<text class="related-count">{{ outRows.length }} 行</text>
						</view>
						<view class="detail-table">
							<view class="detail-table__head">
								<text class="col-index">#</text>
								<text class="col-bottle">瓶号</text>
								<text class="col-num">毛重</text>
								<text class="col-num">皮重</text>
								<text class="col-num">净重</text>
							</view>
							<view v-for="row in outRows" :key="`out-${row.key}`" class="detail-table__row">
								<text class="col-index">{{ row.index }}</text>
								<text class="col-bottle">{{ row.bottle_no }}</text>
								<text class="col-num">{{ row.gross }}</text>
								<text class="col-num">{{ row.tare }}</text>
								<text class="col-num">{{ row.net }}</text>
							</view>
						</view>
					</view>

					<view class="related-block" v-if="backRows.length">
						<view class="related-head">
							<text class="related-title">回瓶明细</text>
							<text class="related-count">{{ backRows.length }} 行</text>
						</view>
						<view class="detail-table">
							<view class="detail-table__head">
								<text class="col-index">#</text>
								<text class="col-bottle">瓶号</text>
								<text class="col-num">毛重</text>
								<text class="col-num">皮重</text>
								<text class="col-num">净重</text>
							</view>
							<view v-for="row in backRows" :key="`back-${row.key}`" class="detail-table__row">
								<text class="col-index">{{ row.index }}</text>
								<text class="col-bottle">{{ row.bottle_no }}</text>
								<text class="col-num">{{ row.gross }}</text>
								<text class="col-num">{{ row.tare }}</text>
								<text class="col-num">{{ row.net }}</text>
							</view>
						</view>
					</view>

					<view class="related-block" v-if="depositRows.length">
						<view class="related-head">
							<text class="related-title">存瓶明细</text>
							<text class="related-count">{{ depositRows.length }} 行</text>
						</view>
						<view class="detail-table detail-table--simple">
							<view class="detail-table__head">
								<text class="col-index">#</text>
								<text class="col-bottle">瓶号</text>
							</view>
							<view v-for="row in depositRows" :key="`deposit-${row.key}`" class="detail-table__row">
								<text class="col-index">{{ row.index }}</text>
								<text class="col-bottle">{{ row.bottle_no }}</text>
							</view>
						</view>
					</view>

					<view class="related-block" v-if="agentRows.length">
						<view class="related-head">
							<text class="related-title">代理灌装明细</text>
							<text class="related-count">{{ agentRows.length }} 行</text>
						</view>
						<view class="detail-table detail-table--compact">
							<view class="detail-table__head">
								<text class="col-index">#</text>
								<text class="col-bottle">瓶号</text>
								<text class="col-num">灌装净重(kg)</text>
							</view>
							<view v-for="row in agentRows" :key="`agent-${row.key}`" class="detail-table__row">
								<text class="col-index">{{ row.index }}</text>
								<text class="col-bottle">{{ row.bottle_no }}</text>
								<text class="col-num">{{ row.fill_weight }}</text>
							</view>
						</view>
					</view>

						<view class="related-block" v-if="isTruckMode">
							<view class="related-head">
								<text class="related-title">整车信息</text>
							</view>
							<view class="info-grid info-grid--tight">
								<view class="info-item">
									<text class="info-label">车牌</text>
									<text class="info-value">{{ detail.truck_no || '-' }}</text>
								</view>
								<view class="info-item">
									<text class="info-label">出厂毛重（参考）</text>
									<text class="info-value">{{ detail.truck_out_gross ?? '-' }}</text>
								</view>
								<view class="info-item">
									<text class="info-label">回厂毛重（参考）</text>
									<text class="info-value">{{ detail.truck_back_gross ?? '-' }}</text>
								</view>
								<view class="info-item">
									<text class="info-label">参考净重</text>
									<text class="info-value">{{ resolveTruckReferenceNetText(detail) }}</text>
								</view>
								<view class="info-item">
									<text class="info-label">车皮重（结算）</text>
									<text class="info-value">{{ detail.truck_settle_tare ?? '-' }}</text>
								</view>
								<view class="info-item">
									<text class="info-label">灌装后车毛重（结算）</text>
									<text class="info-value">{{ detail.truck_settle_gross ?? '-' }}</text>
								</view>
								<view class="info-item">
									<text class="info-label">结算净重</text>
									<text class="info-value">{{ resolveTruckSettlementNetText(detail) }}</text>
								</view>
								<view class="info-item">
									<text class="info-label">净重误差（结算-参考）</text>
									<text class="info-value" :class="{ 'highlight-warning': isTruckNetDiffWarning(detail) }">
										{{ resolveTruckNetDiffText(detail) }}
									</text>
								</view>
								<view class="info-item">
									<text class="info-label">损耗（已计入）</text>
									<text class="info-value" :class="{ 'highlight-warning': resolveTruckLossKgValue(detail) > 0 }">
										{{ resolveTruckLossKgText(detail) }}
									</text>
								</view>
							</view>
						</view>
				</view>
				<view v-else class="placeholder-content">
					<AppEmpty title="暂无关联明细" subtitle="该单据未包含可展示的明细行" />
				</view>
			</AppSection>

				<AppSection title="结算信息">
					<view class="info-grid">
					<view class="info-item">
						<text class="info-label">付款状态</text>
						<AppTag :kind="paymentStatusKind(detail.payment_status)">
							{{ paymentStatusText(detail.payment_status) }}
						</AppTag>
					</view>
					<view class="info-item">
						<text class="info-label">实收金额</text>
						<text class="info-value highlight-text">¥{{ formatMoney(detail.amount_received) }}</text>
					</view>
					<view class="info-item">
						<text class="info-label">抹零金额</text>
						<text class="info-value">¥{{ formatMoney(detail.rounding_amount) }}</text>
					</view>
						<view class="info-item span-2">
							<text class="info-label">收款备注</text>
							<text class="info-value">{{ detail.payment_note || '无' }}</text>
						</view>
					</view>
					<view v-if="overCollectionAmount > 0" class="over-collection-alert">
						<text class="over-collection-alert__title">多收提醒</text>
						<text class="over-collection-alert__content">
							本单实收超出应收 ¥{{ formatMoney(overCollectionAmount) }}，该差额应计入冲抵款并在后续结算抵扣。
						</text>
					</view>
				</AppSection>

			<AppSection title="欠款视图">
				<view class="debt-grid">
					<view class="debt-item">
						<text class="debt-item__label">应收总额</text>
						<text class="debt-item__value">¥{{ shouldReceiveText }}</text>
					</view>
					<view class="debt-item">
						<text class="debt-item__label">实收总额</text>
						<text class="debt-item__value">¥{{ formatMoney(amountReceivedNumber) }}</text>
					</view>
					<view class="debt-item">
						<text class="debt-item__label">{{ outstandingScenario.label }}</text>
						<text class="debt-item__value" :class="`debt-item__value--${outstandingScenario.kind}`">
							¥{{ formatMoney(outstandingScenario.amount) }}
						</text>
					</view>
					<view class="debt-item">
						<text class="debt-item__label">净未收</text>
						<text class="debt-item__value">¥{{ outstandingText }}</text>
					</view>
				</view>
				<text class="debt-tip">{{ outstandingScenario.tip }}</text>
			</AppSection>

			<AppSection title="回款登记">
				<template #actions>
					<AppButton v-if="canViewStatement" size="sm" kind="primary" @click="onQuickReceiveGoStatement">去客户对账登记</AppButton>
				</template>
				<text class="quick-tip">应收 {{ shouldReceiveText }} 元，净未收 {{ outstandingText }} 元。</text>
				<text class="quick-tip quick-tip--strong">
					销售单不再直接登记收款，请在客户对账页选择“时间段分配/勾选分配”并提交收款。
				</text>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppTag from '@/components/base/AppTag.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { getSaleV2, removeSaleV2 } from '@/services/sale'
import { useQuery } from '@/composables/useQuery'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const { canPageAction, canViewPage } = useAuthGuard()
const canUpdateSale = computed(() => canPageAction('/pages/sale/detail', 'update'))
const canDeleteSale = computed(() => canPageAction('/pages/sale/detail', 'delete'))
const canViewStatement = computed(() => canViewPage('/pages/customer/statement'))

const recordId = toRef(props, 'recordId')
const detail = ref({})
const removing = ref(false)
const ticketImageLoading = ref(false)
const ticketImagePreviews = ref([])
let ticketImageLoadSeq = 0
const REMARK_TAG_LABELS = {
	ticket_adjust_up: '票上多算',
	ticket_adjust_down: '票上少算',
	remove_back_bottle: '去掉回瓶',
	balance_carry: '余款结转',
	material_install: '安装材料',
	cash_mark: '现金标记',
	merge_trace: '合并痕迹',
	payment_event: '收款事件',
	other: '其他备注'
}

const outRows = computed(() => normalizeBottleRows(detail.value?.out_items))
const backRows = computed(() => normalizeBottleRows(detail.value?.back_items))
const depositRows = computed(() => normalizeDepositRows(detail.value?.deposit_rows))
const agentRows = computed(() => normalizeAgentRows(detail.value?.agent_sale_items))
const deliveryVehicleText = computed(() =>
	normalizeString(detail.value?.car_no) || normalizeString(detail.value?.truck_no) || '-'
)
const deliveryManText = computed(() => normalizeString(detail.value?.delivery_man) || '-')
const priceUnitAndPriceText = computed(() => {
	const unit = normalizeString(detail.value?.price_unit) || '-'
	return `¥${formatMoney(detail.value?.unit_price)}/${unit}`
})
const isTruckMode = computed(() => normalizeString(detail.value?.biz_mode) === 'truck')
const hasRelatedData = computed(
	() => outRows.value.length > 0 || backRows.value.length > 0 || depositRows.value.length > 0 || agentRows.value.length > 0 || isTruckMode.value
)
const shouldReceiveNumber = computed(() => toNumber(detail.value?.should_receive, 0))
const roundingAmountNumber = computed(() => Math.max(toNumber(detail.value?.rounding_amount, 0), 0))
const effectiveShouldReceiveNumber = computed(() =>
	resolveEffectiveShould(shouldReceiveNumber.value, roundingAmountNumber.value)
)
const amountReceivedNumber = computed(() => toNumber(detail.value?.amount_received, 0))
const outstandingNumber = computed(() => fix2(effectiveShouldReceiveNumber.value - amountReceivedNumber.value))
const overCollectionAmount = computed(() => {
	if (effectiveShouldReceiveNumber.value <= 0) return 0
	const delta = fix2(amountReceivedNumber.value - effectiveShouldReceiveNumber.value)
	return delta > 0 ? delta : 0
})
const shouldReceiveText = computed(() => formatMoney(shouldReceiveNumber.value))
const outstandingText = computed(() => formatMoney(outstandingNumber.value))
const settlementFormula = computed(() => buildSettlementFormulaDetail(detail.value))
const outstandingScenario = computed(() =>
	buildOutstandingScenario(effectiveShouldReceiveNumber.value, amountReceivedNumber.value)
)
const ticketImageFileIds = computed(() =>
	normalizeTicketFileIds(detail.value?.ticket_images, detail.value?.ticket_image)
)
const remarkTagLabels = computed(() =>
	normalizeRemarkTagList(detail.value?.remark_tags).map((value) => ({
		value,
		label: REMARK_TAG_LABELS[value] || value
	}))
)

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
		throttleMs: 0,
		cacheKey: (id, refreshToken = 0) => `sale:detail:${id}:${refreshToken || 'base'}`
	}
)

async function refreshDetail(force = false) {
	const id = normalizeString(recordId.value)
	if (!id) return
	const data = await fetchDetail(id, force ? Date.now() : 0)
	if (!data) return
	detail.value = data
}

watch(
	recordId,
	async (id) => {
		if (!id) return
		await refreshDetail(false)
	},
	{ immediate: true }
)

watch(
	ticketImageFileIds,
	(fileIds) => {
		loadTicketImagePreviews(fileIds)
	},
	{ immediate: true }
)

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Number(num.toFixed(2))
}

function formatMoney(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0.00'
	return num.toFixed(2)
}

function formatFlowVolume(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0.000'
	return num.toFixed(3)
}

function normalizeTicketFileIds(listValue, singleValue) {
	const list = []
	const pushOne = (value) => {
		const fileId = normalizeString(value)
		if (!fileId) return
		if (!list.includes(fileId)) list.push(fileId)
	}
	if (Array.isArray(listValue)) listValue.forEach(pushOne)
	else pushOne(listValue)
	pushOne(singleValue)
	return list.slice(0, 3)
}

async function loadTicketImagePreviews(fileIds = []) {
	const currentSeq = ++ticketImageLoadSeq
	const ids = Array.isArray(fileIds) ? fileIds.map((item) => normalizeString(item)).filter(Boolean) : []
	if (!ids.length) {
		ticketImagePreviews.value = []
		ticketImageLoading.value = false
		return
	}
	ticketImageLoading.value = true
	const fallback = ids.map((fileId) => ({ fileId, url: fileId }))
	try {
		const res = await uniCloud.getTempFileURL({
			fileList: ids
		})
		if (currentSeq !== ticketImageLoadSeq) return
		const rows = Array.isArray(res?.fileList) ? res.fileList : []
		const urlMap = new Map()
		rows.forEach((row) => {
			const fileId = normalizeString(row?.fileID || row?.fileId)
			if (!fileId) return
			const url = normalizeString(row?.tempFileURL || row?.tempFileUrl || fileId)
			urlMap.set(fileId, url || fileId)
		})
		ticketImagePreviews.value = ids.map((fileId) => ({
			fileId,
			url: urlMap.get(fileId) || fileId
		}))
	} catch (_) {
		if (currentSeq !== ticketImageLoadSeq) return
		ticketImagePreviews.value = fallback
	} finally {
		if (currentSeq === ticketImageLoadSeq) ticketImageLoading.value = false
	}
}

function onPreviewTicketImage(index = 0) {
	const urls = ticketImagePreviews.value.map((item) => normalizeString(item?.url || item?.fileId)).filter(Boolean)
	if (!urls.length) return
	const current = urls[index] || urls[0]
	uni.previewImage({
		urls,
		current
	})
}

function normalizeBizMode(value) {
	const text = normalizeString(value)
	if (text === 'truck' || text === 'agent_sale' || text === 'bottle') return text
	return 'bottle'
}

function normalizePriceUnit(value) {
	const text = normalizeString(value)
	if (text === 'kg' || text === 'bottle' || text === 'm3') return text
	return 'kg'
}

function sumNetRows(rows) {
	return rows.reduce((sum, row) => sum + toNumber(row?.net, 0), 0)
}

function sumAgentRows(rows) {
	return rows.reduce((sum, row) => sum + toNumber(row?.fill_weight, 0), 0)
}

function resolveFlowVolume(source) {
	const explicit = toNumber(source?.flow_volume_m3, null)
	if (explicit != null) return explicit
	const prev = toNumber(source?.flow_index_prev, null)
	const curr = toNumber(source?.flow_index_curr, null)
	if (prev == null || curr == null) return 0
	const diff = curr - prev
	return diff > 0 ? diff : 0
}

function resolveTruckReferenceNetValue(source) {
	const outGross = toNumber(source?.truck_out_gross, null)
	const backGross = toNumber(source?.truck_back_gross, null)
	if (outGross != null && backGross != null) return Math.max(outGross - backGross, 0)
	const explicit = toNumber(source?.truck_gross_diff, null)
	if (explicit != null && explicit > 0) return explicit
	return null
}

function resolveTruckSettlementNetValue(source) {
	const settleTare = toNumber(source?.truck_settle_tare, null)
	const settleGross = toNumber(source?.truck_settle_gross, null)
	if (settleTare != null && settleGross != null) return Math.max(settleGross - settleTare, 0)
	const explicit = toNumber(source?.truck_sale_net, null)
	if (explicit != null && explicit > 0) return explicit
	return null
}

function resolveTruckBillableNetValue(source) {
	const priceUnit = normalizePriceUnit(source?.price_unit)
	const referenceNet = resolveTruckReferenceNetValue(source)
	if (priceUnit === 'kg') {
		const settlementNet = resolveTruckSettlementNetValue(source)
		if (settlementNet != null && settlementNet > 0) return settlementNet
	}
	return referenceNet == null ? 0 : referenceNet
}

function resolveTruckReferenceNetText(source) {
	const value = resolveTruckReferenceNetValue(source)
	return value == null ? '-' : formatMoney(value)
}

function resolveTruckSettlementNetText(source) {
	const value = resolveTruckSettlementNetValue(source)
	return value == null ? '-' : formatMoney(value)
}

function resolveTruckNetDiffValue(source) {
	const settlement = resolveTruckSettlementNetValue(source)
	const reference = resolveTruckReferenceNetValue(source)
	if (settlement == null || reference == null) return null
	return fix2(settlement - reference)
}

function resolveTruckNetDiffText(source) {
	const diff = resolveTruckNetDiffValue(source)
	if (diff == null) return '-'
	const sign = diff > 0 ? '+' : ''
	return `${sign}${formatMoney(diff)}`
}

function isTruckNetDiffWarning(source) {
	const diff = resolveTruckNetDiffValue(source)
	if (diff == null) return false
	return Math.abs(diff) > 0
}

function resolveTruckLossKgValue(source) {
	const explicit = toNumber(source?.truck_loss_kg, null)
	if (explicit != null) return Math.max(explicit, 0)
	const diff = resolveTruckNetDiffValue(source)
	if (diff == null) return 0
	return Math.max(-diff, 0)
}

function resolveTruckLossKgText(source) {
	return formatMoney(resolveTruckLossKgValue(source))
}

function resolveEffectiveShould(shouldReceive, roundingAmount) {
	const should = fix2(toNumber(shouldReceive, 0))
	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	if (should > 0) return fix2(should - rounding)
	if (should < 0) return fix2(should + rounding)
	return 0
}

function buildSettlementFormulaDetail(source) {
	const bizMode = normalizeBizMode(source?.biz_mode)
	const priceUnit = normalizePriceUnit(source?.price_unit)
	const settlementMode = normalizeString(source?.settlement_mode) || 'sale'
	const unitPrice = toNumber(source?.unit_price, 0)
	const roundingAmount = Math.max(toNumber(source?.rounding_amount, 0), 0)
	const outNetTotal = toNumber(source?.out_net_total, sumNetRows(outRows.value))
	const backNetTotal = toNumber(source?.back_net_total, sumNetRows(backRows.value))
	const outCount = outRows.value.length
	const agentTotal = sumAgentRows(agentRows.value)
	const truckReferenceNet = toNumber(resolveTruckReferenceNetValue(source), 0)
	const truckSettlementNet = toNumber(resolveTruckSettlementNetValue(source), 0)
	const truckSaleNet = toNumber(resolveTruckBillableNetValue(source), 0)
	const flowVolume = resolveFlowVolume(source)

	if (settlementMode === 'customer_flow' || priceUnit === 'm3') {
		return {
			shouldAmount: 0,
			roundingAmount: 0,
			settledAmount: 0,
			formula: '该客户按客户对账页流量结算，本销售单仅记录实际送货重量，不在本单计费'
		}
	}

	let shouldAmount = 0
	let formulaBase = ''
	if (bizMode === 'agent_sale') {
		shouldAmount = agentTotal * unitPrice
		formulaBase = `应收 = 代理灌装净重合计 ${formatMoney(agentTotal)} × 单价 ${formatMoney(unitPrice)}`
	} else if (bizMode === 'truck') {
		shouldAmount = truckSaleNet * unitPrice
		if (priceUnit === 'kg') {
			formulaBase = `应收 = 结算净重 ${formatMoney(truckSaleNet)} × 单价 ${formatMoney(unitPrice)}`
			const netDiff = fix2(truckSaleNet - truckReferenceNet)
			if (Math.abs(netDiff) > 0) {
				const sign = netDiff > 0 ? '+' : ''
				formulaBase += `（参考净重 ${formatMoney(truckReferenceNet)}，误差 ${sign}${formatMoney(netDiff)}）`
				if (netDiff < 0) {
					formulaBase += `；计损耗 ${formatMoney(Math.abs(netDiff))}`
				}
			}
			if (truckSaleNet <= 0 && truckSettlementNet <= 0) {
				formulaBase += '（结算依据缺失）'
			}
		} else {
			formulaBase = `应收 = 参考净重 ${formatMoney(truckSaleNet)} × 单价 ${formatMoney(unitPrice)}`
		}
	} else if (priceUnit === 'bottle') {
		shouldAmount = outCount * unitPrice
		formulaBase = `应收 = 出瓶瓶数 ${outCount} × 单价 ${formatMoney(unitPrice)}`
	} else if (priceUnit === 'm3') {
		shouldAmount = flowVolume * unitPrice
		formulaBase = `应收 = 流量 ${formatFlowVolume(flowVolume)} × 单价 ${formatMoney(unitPrice)}`
	} else {
		shouldAmount = (outNetTotal - backNetTotal) * unitPrice
		formulaBase = `应收 = (出瓶净重 ${formatMoney(outNetTotal)} - 回瓶净重 ${formatMoney(backNetTotal)}) × 单价 ${formatMoney(unitPrice)}`
	}

	const settledAmount = resolveEffectiveShould(shouldAmount, roundingAmount)
	let roundingText = ''
	if (roundingAmount > 0) roundingText = shouldAmount < 0
		? `；实付 = 应收 + 抹零 ${formatMoney(roundingAmount)}`
		: `；实收 = 应收 - 抹零 ${formatMoney(roundingAmount)}`

	return {
		shouldAmount: fix2(shouldAmount),
		roundingAmount: fix2(roundingAmount),
		settledAmount: fix2(settledAmount),
		formula: `${formulaBase}${roundingText}`
	}
}

function buildOutstandingScenario(shouldReceive, amountReceived) {
	const should = fix2(toNumber(shouldReceive, 0))
	const received = fix2(toNumber(amountReceived, 0))
	const outstanding = fix2(should - received)

	if (should > 0) {
		if (outstanding > 0) {
			return { label: '应收未收', amount: outstanding, kind: 'danger', tip: '当前单据还有欠款，建议继续登记回款。' }
		}
		if (outstanding < 0) {
			return { label: '超收', amount: Math.abs(outstanding), kind: 'warning', tip: '实收高于应收，通常属于超收或预收挂在本单。' }
		}
		return { label: '结清', amount: 0, kind: 'success', tip: '该单据已结清。' }
	}

	if (should < 0) {
		if (outstanding < 0) {
			return { label: '应退未退', amount: Math.abs(outstanding), kind: 'danger', tip: '该单据属于应退金额，尚未全部退款。' }
		}
		if (outstanding > 0) {
			return { label: '超退', amount: outstanding, kind: 'warning', tip: '退款金额超过应退金额，请核对。' }
		}
		return { label: '已退款', amount: 0, kind: 'success', tip: '该单据已完成退款。' }
	}

	if (received > 0) {
		return { label: '预收', amount: received, kind: 'warning', tip: '应收为 0 且实收为正，属于预收单。' }
	}
	if (received < 0) {
		return { label: '预退', amount: Math.abs(received), kind: 'warning', tip: '应收为 0 且实收为负，属于预退单。' }
	}
	return { label: '结清', amount: 0, kind: 'success', tip: '当前无应收应退。' }
}

function normalizeBottleRows(rows) {
	const source = Array.isArray(rows) ? rows : []
	return source
		.map((row, index) => ({
			key: `${index}-${normalizeString(row?.bottle_no || row?.bottleNo)}`,
			index: index + 1,
			bottle_no: normalizeString(row?.bottle_no || row?.bottleNo) || '-',
			gross: toNumber(row?.gross ?? row?.gross_weight, 0),
			tare: toNumber(row?.tare ?? row?.tare_weight, 0),
			net: toNumber(row?.net ?? row?.net_weight, 0)
		}))
		.filter((row) => row.bottle_no && row.bottle_no !== '-')
}

function normalizeDepositRows(rows) {
	const source = Array.isArray(rows) ? rows : []
	return source
		.map((row, index) => {
			const bottleNo = typeof row === 'string'
				? normalizeString(row)
				: normalizeString(row?.bottle_no || row?.bottleNo || row?.no)
			return {
				key: `${index}-${bottleNo}`,
				index: index + 1,
				bottle_no: bottleNo || '-'
			}
		})
		.filter((row) => row.bottle_no && row.bottle_no !== '-')
}

function normalizeAgentRows(rows) {
	const source = Array.isArray(rows) ? rows : []
	return source
		.map((row, index) => ({
			key: `${index}-${normalizeString(row?.bottle_no || row?.bottleNo)}`,
			index: index + 1,
			bottle_no: normalizeString(row?.bottle_no || row?.bottleNo) || '-',
			fill_weight: toNumber(row?.fill_weight ?? row?.fillWeight, 0)
		}))
		.filter((row) => row.bottle_no && row.bottle_no !== '-')
}

function bizModeText(value) {
	const map = {
		bottle: '瓶装',
		truck: '整车',
		agent_sale: '代理出站'
	}
	return map[value] || value || '-'
}

function paymentStatusText(value) {
	const map = {
		paid: '已结清',
		partial: '部分付',
		unpaid: '未付款',
		'已结清': '已结清',
		'部分付': '部分付',
		'未付款': '未付款'
	}
	return map[value] || '未知'
}

function paymentStatusKind(status) {
	const map = {
		paid: 'success',
		partial: 'warning',
		unpaid: 'danger',
		'已结清': 'success',
		'部分付': 'warning',
		'未付款': 'danger'
	}
	return map[status] || 'info'
}

function normalizeRemarkTagList(value) {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => normalizeString(item))
		.filter(Boolean)
}

function onQuickReceiveGoStatement() {
	const customerId = normalizeString(detail.value?.customer_id)
	const saleId = normalizeString(recordId.value)
	if (!customerId) {
		uni.showToast({ title: '客户信息缺失', icon: 'none' })
		return
	}
	const scenePart = 'scene=quickReceive'
	const salePart = saleId ? `&sale_id=${encodeURIComponent(saleId)}` : ''
	uni.navigateTo({ url: `/pages/customer/statement?_id=${encodeURIComponent(customerId)}&${scenePart}${salePart}` })
}

function onEdit() {
	if (!recordId.value) return
	uni.navigateTo({ url: `/pages/sale/edit?_id=${encodeURIComponent(recordId.value)}` })
}

function onCustomerStatement() {
	const customerId = normalizeString(detail.value?.customer_id)
	if (!customerId) {
		uni.showToast({ title: '客户信息缺失', icon: 'none' })
		return
	}
	uni.navigateTo({ url: `/pages/customer/statement?_id=${encodeURIComponent(customerId)}` })
}

function onRemarkTagClick(tag) {
	const value = normalizeString(tag)
	if (!value) return
	uni.navigateTo({
		url: `/pages/sale/list?hasRemark=yes&remarkTag=${encodeURIComponent(value)}`
	})
}

function onBack() {
	uni.navigateBack({ delta: 1 })
}

async function onRemove() {
	if (!recordId.value || removing.value) return
	const confirmRes = await uni.showModal({
		title: '删除销售单',
		content: '删除后将同步移除对应流转事件（已过账凭证不允许删除）。确认继续？',
		showCancel: true
	})
	if (!confirmRes.confirm) return
	removing.value = true
	try {
		const res = await removeSaleV2({ recordId: recordId.value })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || '删除成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 300)
	} finally {
		removing.value = false
	}
}

defineExpose({
	refresh: () => refreshDetail(true)
})
</script>

<style scoped>
.detail-container {
	padding-bottom: 48rpx;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
	width: 100%;
}

:deep(.summary-card .stat__content) {
	align-items: center;
	gap: 16rpx;
}

:deep(.summary-card .stat__value-wrap) {
	align-items: flex-start;
}

:deep(.summary-card .stat__value) {
	text-align: left;
	font-size: 24px;
}

:deep(.summary-card .stat__icon) {
	margin-left: 12rpx;
}

.info-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12rpx 16rpx;
}

.info-grid--base {
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10rpx 14rpx;
}

.info-grid--tight {
	gap: 10rpx 14rpx;
}

.info-item {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.info-item--inline {
	flex-direction: row;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
	padding: 10rpx 12rpx;
	border-radius: 12rpx;
	background: #f8fafc;
	border: 1rpx solid #e2e8f0;
}

.info-item--inline .info-label {
	margin-right: auto;
}

.info-item--inline .info-value {
	font-size: 24rpx;
	text-align: right;
}

.span-2 {
	grid-column: span 2;
}

.span-3 {
	grid-column: span 3;
}

.info-label {
	font-size: 21rpx;
	color: var(--crm-text-muted);
}

.info-value {
	font-size: 26rpx;
	color: var(--crm-text);
	font-weight: 600;
}

.remark-tag-list {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
}

.highlight-text {
	color: var(--crm-primary);
}

.highlight-warning {
	color: #b45309;
}

.over-collection-alert {
	margin-top: 14rpx;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	padding: 14rpx 16rpx;
	border-radius: 12rpx;
	background: #fff7ed;
	border: 1rpx solid #fdba74;
}

.over-collection-alert__title {
	font-size: 24rpx;
	font-weight: 700;
	color: #c2410c;
}

.over-collection-alert__content {
	font-size: 22rpx;
	line-height: 1.5;
	color: #9a3412;
}

.formula-panel {
	display: flex;
	flex-direction: column;
	gap: 10rpx;
	padding: 14rpx;
	border-radius: 14rpx;
	background: #f8fafc;
	border: 1rpx solid #e2e8f0;
}

.ticket-block {
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.ticket-loading {
	font-size: 21rpx;
	color: #64748b;
}

.ticket-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(210rpx, 1fr));
	gap: 12rpx;
}

.ticket-item {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.ticket-item__image {
	width: 100%;
	height: 220rpx;
	border-radius: 12rpx;
	background: #f8fafc;
	border: 1rpx solid #e2e8f0;
}

.ticket-item__label {
	font-size: 20rpx;
	color: #64748b;
}

.ticket-placeholder {
	padding: 10rpx 0;
}

.ticket-placeholder__text {
	font-size: 22rpx;
	color: #94a3b8;
}

.formula-text {
	font-size: 23rpx;
	line-height: 1.6;
	color: #1e293b;
}

.formula-metrics {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
}

.formula-metrics__item {
	padding: 4rpx 10rpx;
	border-radius: 999rpx;
	background: #eef2ff;
	font-size: 20rpx;
	color: #334155;
}

.formula-metrics__item--strong {
	background: #dbeafe;
	color: #1e40af;
}

.placeholder-content {
	padding: 20rpx 0;
}

.related-stack {
	display: flex;
	flex-direction: column;
	gap: 14rpx;
}

.related-block {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.related-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
}

.related-title {
	font-size: 24rpx;
	font-weight: 700;
	color: #0f172a;
}

.related-count {
	font-size: 21rpx;
	color: #64748b;
}

.quick-tip {
	display: block;
	margin-top: 12rpx;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.quick-tip--strong {
	margin-top: 8rpx;
	color: #92400e;
}

.detail-table {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
}

.detail-table__head,
.detail-table__row {
	display: grid;
	grid-template-columns: 64rpx minmax(180rpx, 1fr) repeat(3, minmax(90rpx, 1fr));
	gap: 10rpx;
	align-items: center;
}

.detail-table__head {
	font-size: 21rpx;
	color: var(--crm-text-muted);
	font-weight: 600;
}

.detail-table__row {
	font-size: 23rpx;
	color: #0f172a;
	padding: 8rpx 0;
	border-top: 1rpx solid var(--crm-border, #edf2f7);
}

.col-index {
	text-align: left;
}

.col-bottle {
	text-align: left;
}

.col-num {
	text-align: right;
}

.detail-table--compact .detail-table__head,
.detail-table--compact .detail-table__row {
	grid-template-columns: 64rpx minmax(180rpx, 1fr) minmax(120rpx, 1fr);
}

.detail-table--simple .detail-table__head,
.detail-table--simple .detail-table__row {
	grid-template-columns: 64rpx minmax(180rpx, 1fr);
}

.debt-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12rpx;
}

.debt-item {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 10rpx 12rpx;
	border-radius: 12rpx;
	background: #f8fafc;
	border: 1rpx solid #e2e8f0;
}

.debt-item__label {
	font-size: 21rpx;
	color: #64748b;
}

.debt-item__value {
	font-size: 27rpx;
	font-weight: 700;
	color: #0f172a;
}

.debt-item__value--danger {
	color: #b91c1c;
}

.debt-item__value--warning {
	color: #b45309;
}

.debt-item__value--success {
	color: #166534;
}

.debt-tip {
	display: block;
	margin-top: 10rpx;
	font-size: 21rpx;
	color: #64748b;
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 1120px) {
	.info-grid--base {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.span-3 {
		grid-column: span 2;
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
}

@media (max-width: 720px) {
	.info-grid {
		grid-template-columns: 1fr;
	}
	.span-2 {
		grid-column: auto;
	}
	.span-3 {
		grid-column: auto;
	}
	.debt-grid {
		grid-template-columns: 1fr;
	}
	.detail-table__head,
	.detail-table__row {
		grid-template-columns: 52rpx minmax(140rpx, 1fr) repeat(3, minmax(70rpx, 1fr));
	}
	.detail-table--compact .detail-table__head,
	.detail-table--compact .detail-table__row {
		grid-template-columns: 52rpx minmax(140rpx, 1fr) minmax(90rpx, 1fr);
	}
	.detail-table--simple .detail-table__head,
	.detail-table--simple .detail-table__row {
		grid-template-columns: 52rpx minmax(140rpx, 1fr);
	}
}
</style>
