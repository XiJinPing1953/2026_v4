<template>
	<AppPage title="出纳收款登记" subtitle="CASHIER RECEIPT" icon="wallet">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="rowsLoading || exporting" @click="onExport">导出</AppButton>
			<AppButton size="sm" kind="neutral" :loading="rowsLoading" @click="refreshAll">刷新</AppButton>
		</template>

		<view class="cashier-wrap">
			<AppSection v-if="!canView" title="无权限访问">
				<text class="section-hint">当前账号没有“出纳收款登记”查看权限，请联系管理员开通。</text>
			</AppSection>

			<template v-else>
				<AppSection title="快速录款">
					<view class="intake-main-grid">
						<view class="form-item customer-field" :class="{ 'field-popover-open': showIntakeSuggestions }">
							<AppInput
								:model-value="intakeCustomerKeyword"
								label="录入客户"
								placeholder="输入关键字搜索"
								prefix-icon="user"
								size="sm"
								confirm-type="search"
								@update:modelValue="onIntakeCustomerInput"
								@confirm="onIntakeCustomerConfirm"
								@focus="onIntakeCustomerFocus"
								@blur="onIntakeCustomerBlur"
							/>
							<scroll-view v-if="showIntakeSuggestions && shouldUseScrollableSuggestions(intakeCustomerOptions)" scroll-y class="suggestions suggestions--scroll">
								<view class="suggest-list">
									<view
										v-for="item in intakeCustomerOptions"
										:key="`intake:${item.value}`"
										class="suggest-item"
										@tap.stop="onPickIntakeCustomer(item)"
										@click.stop="onPickIntakeCustomer(item)"
									>
										<view class="suggest-info">
											<text class="suggest-name">{{ item.name || item.label }}</text>
											<text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text>
											<text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text>
										</view>
										<AppIcon name="plus" size="24rpx" color="#94a3b8" />
									</view>
								</view>
							</scroll-view>
							<view v-else-if="showIntakeSuggestions && intakeCustomerOptions.length" class="suggestions">
								<view class="suggest-list">
									<view
										v-for="item in intakeCustomerOptions"
										:key="`intake:inline:${item.value}`"
										class="suggest-item"
										@tap.stop="onPickIntakeCustomer(item)"
										@click.stop="onPickIntakeCustomer(item)"
									>
										<view class="suggest-info">
											<text class="suggest-name">{{ item.name || item.label }}</text>
											<text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text>
											<text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text>
										</view>
										<AppIcon name="plus" size="24rpx" color="#94a3b8" />
									</view>
								</view>
							</view>
							<view v-else-if="showIntakeSuggestions" class="suggestions">
								<view class="suggest-empty">
									<text>未找到匹配客户</text>
								</view>
							</view>
						</view>
						<picker class="picker-block" mode="date" @change="onBizDateChange">
							<AppInput v-model="form.bizDate" label="业务日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker
							class="picker-block"
							mode="selector"
							:range="receiptPaymentMethodOptions"
							range-key="label"
							:value="intakePaymentMethodIndex"
							@change="onIntakePaymentMethodChange"
						>
							<AppInput :model-value="intakePaymentMethodLabel" label="收款方式" placeholder="请选择收款方式" readonly size="sm" />
						</picker>
						<AppInput
							v-model="form.amount"
							label="收到金额(元)"
							type="digit"
							placeholder="请输入正数"
							size="sm"
							@blur="normalizeAmountInput"
						/>
					</view>
					<view class="picker-row">
						<view class="picker-row__text-group">
							<text class="picker-row__text">
								{{ selectedIntakeCustomerId ? `已选结算客户：${selectedIntakeCustomerLabel}` : '请从下拉候选中点选客户' }}
							</text>
							<text v-if="selectedIntakeCustomerHint" class="picker-row__hint">{{ selectedIntakeCustomerHint }}</text>
						</view>
						<AppButton size="sm" kind="ghost" :disabled="!selectedIntakeCustomerId" @click="clearIntakeCustomer">清空</AppButton>
					</view>

					<view class="proof-card">
						<view class="proof-card__header">
							<view class="proof-card__meta">
								<text class="proof-card__title">收款凭证</text>
								<text class="proof-card__hint">至少上传 1 张，可多张</text>
							</view>
							<AppButton
								size="sm"
								kind="primary"
								:disabled="!canCreateOrUpdate || submitting || proofUploading || proofImages.length >= PROOF_IMAGE_LIMIT"
								@click="chooseProofImages"
							>
								上传图片（{{ proofImages.length }}/{{ PROOF_IMAGE_LIMIT }}）
							</AppButton>
						</view>

						<view v-if="proofImages.length" class="proof-list">
							<view
								v-for="(item, index) in proofImages"
								:key="item.localPath || item.fileId || index"
								class="proof-item"
							>
								<image class="proof-item__image" :src="resolveProofPreview(item)" mode="aspectFill" @click="previewProofImage(index)" />
								<view class="proof-item__actions">
									<text v-if="item.uploading" class="proof-item__status">上传中…</text>
									<text v-else-if="item.fileId" class="proof-item__status">已上传</text>
									<AppButton size="sm" kind="neutral" @click="previewProofImage(index)">预览</AppButton>
									<AppButton
										size="sm"
										kind="outline"
										:disabled="!canCreateOrUpdate || submitting || proofUploading"
										@click="removeProofImage(index)"
									>
										移除
									</AppButton>
								</view>
							</view>
						</view>
						<view v-else class="proof-card__empty">
							<text class="proof-card__empty-title">未上传收款凭证</text>
							<text class="proof-card__empty-text">请至少上传 1 张后再提交。</text>
						</view>
					</view>

					<view class="form-actions">
						<AppButton size="sm" kind="ghost" :disabled="submitting || proofUploading" @click="resetForm">重置</AppButton>
						<AppButton
							size="sm"
							kind="outline"
							v-if="isEditing"
							:disabled="submitting || proofUploading"
							@click="cancelEditing"
						>
							取消编辑
						</AppButton>
						<AppButton
							size="sm"
							kind="primary"
							:loading="submitting"
							:disabled="!canCreateOrUpdate || proofUploading"
							@click="onSubmit"
						>
							{{ isEditing ? '保存登记' : '登记收款' }}
						</AppButton>
					</view>
					<text class="section-hint">该入口只做款项登记，不做分配。分配请在客户对账页完成。</text>
				</AppSection>

				<AppSection title="最近登记">
					<view class="recent-filter-inline">
						<view class="form-item customer-field" :class="{ 'field-popover-open': showFilterSuggestions }">
							<AppInput
								:model-value="filterCustomerKeyword"
								label="筛选客户"
								placeholder="输入关键字搜索"
								prefix-icon="user"
								size="sm"
								confirm-type="search"
								@update:modelValue="onFilterCustomerInput"
								@confirm="onFilterCustomerConfirm"
								@focus="onFilterCustomerFocus"
								@blur="onFilterCustomerBlur"
							/>
							<scroll-view v-if="showFilterSuggestions && shouldUseScrollableSuggestions(filterCustomerOptions)" scroll-y class="suggestions suggestions--scroll">
								<view class="suggest-list">
									<view
										v-for="item in filterCustomerOptions"
										:key="`filter:${item.value}`"
										class="suggest-item"
										@tap.stop="onPickFilterCustomer(item)"
										@click.stop="onPickFilterCustomer(item)"
									>
										<view class="suggest-info">
											<text class="suggest-name">{{ item.name || item.label }}</text>
											<text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text>
											<text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text>
										</view>
										<AppIcon name="plus" size="24rpx" color="#94a3b8" />
									</view>
								</view>
							</scroll-view>
							<view v-else-if="showFilterSuggestions && filterCustomerOptions.length" class="suggestions">
								<view class="suggest-list">
									<view
										v-for="item in filterCustomerOptions"
										:key="`filter:inline:${item.value}`"
										class="suggest-item"
										@tap.stop="onPickFilterCustomer(item)"
										@click.stop="onPickFilterCustomer(item)"
									>
										<view class="suggest-info">
											<text class="suggest-name">{{ item.name || item.label }}</text>
											<text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text>
											<text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text>
										</view>
										<AppIcon name="plus" size="24rpx" color="#94a3b8" />
									</view>
								</view>
							</view>
							<view v-else-if="showFilterSuggestions" class="suggestions">
								<view class="suggest-empty">
									<text>未找到匹配客户</text>
								</view>
							</view>
						</view>
						<picker class="picker-block" mode="date" @change="onFilterDateStartChange">
							<AppInput :model-value="listFilter.dateStart" label="开始日期" placeholder="不限" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="date" @change="onFilterDateEndChange">
							<AppInput :model-value="listFilter.dateEnd" label="结束日期" placeholder="不限" prefix-icon="calendar" readonly size="sm" />
						</picker>
					</view>
					<view class="picker-row">
						<view class="picker-row__text-group">
							<text class="picker-row__text">
								{{ selectedFilterCustomerId ? `当前筛选结算客户：${selectedFilterCustomerLabel}` : '当前筛选客户：全部客户' }}；{{ listFilter.dateStart || listFilter.dateEnd ? `日期 ${listFilter.dateStart || '不限'} ~ ${listFilter.dateEnd || '不限'}` : '日期不限' }}；{{ includeVoided ? '包含已作废' : '仅已入账' }}
							</text>
							<text v-if="selectedFilterCustomerHint" class="picker-row__hint">{{ selectedFilterCustomerHint }}</text>
						</view>
						<view class="picker-row__actions">
							<AppButton
								size="sm"
								kind="ghost"
								:disabled="rowsLoading"
								@click="clearFilterCustomer"
							>
								清空筛选
							</AppButton>
							<AppButton
								size="sm"
								kind="neutral"
								:disabled="!selectedIntakeCustomerId || rowsLoading"
								@click="applyIntakeCustomerToFilter"
							>
								用录入客户筛选
							</AppButton>
							<AppButton
								size="sm"
								kind="neutral"
								:disabled="rowsLoading"
								@click="applyRecentFilters"
							>
								查询
							</AppButton>
							<AppButton
								size="sm"
								kind="ghost"
								:disabled="rowsLoading || (!listFilter.dateStart && !listFilter.dateEnd)"
								@click="clearDateFilters"
							>
								清空日期
							</AppButton>
						</view>
					</view>

					<view class="list-actions">
						<text class="section-hint">
							最近登记默认显示已入账前20条，可按客户和日期筛选，也可切换查看已作废。
						</text>
						<view class="pager-actions">
							<AppButton size="sm" kind="neutral" :disabled="rowsLoading" @click="toggleIncludeVoided">
								{{ includeVoided ? '隐藏已作废' : '显示已作废' }}
							</AppButton>
							<AppButton size="sm" kind="ghost" :disabled="rowsLoading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
							<AppButton size="sm" kind="ghost" :disabled="rowsLoading || !pager.hasMore" @click="onNextPage">下一页</AppButton>
						</view>
					</view>

					<AppList
						:loading="rowsLoading"
						:empty="rows.length === 0"
						:empty-title="'暂无收款登记'"
					>
						<AppListItem
							v-for="row in rows"
							:key="row._id"
							:title="`${row.biz_date || '-'} · ${normalizeString(row.customer_name) || '未命名客户'} · 收款登记`"
							:subtitle="`单据 ${row._id}`"
							:status="row.allocation_status_text"
							:status-kind="allocationStatusKind(row.allocation_status)"
							icon="wallet"
							icon-class="bg-success"
							:clickable="canViewStatement"
							@click="onGoStatementSales(row)"
						>
							<template #right>
								<view class="mini-amounts">
									<text>收款 ¥{{ formatMoney(row.amount, row.money_scale) }}</text>
									<text>已分配 ¥{{ formatMoney(row.allocated_total, row.money_scale) }}</text>
									<text>未分配 ¥{{ formatMoney(row.unallocated_amount, row.money_scale) }}</text>
								</view>
							</template>

							<template #default>
								<view class="target-list">
									<text class="row-detail row-detail--customer">分配客户：{{ normalizeString(row.customer_name) || '-' }}</text>
									<text class="row-detail row-detail--source">来源：{{ sourceTypeText(row.source_type) }}</text>
									<text class="row-detail">收款方式：{{ paymentMethodText(row.payment_method) }}</text>
									<text class="row-detail row-detail--range">{{ allocationDateScopeText(row) }}</text>
									<text
										v-for="(target, index) in visibleTargets(row)"
										:key="`${row._id}:${index}:${target.target_id || ''}:${target.allocate_kind || ''}`"
										class="row-detail"
									>
										{{ formatTargetLine(target, row.money_scale) }}
									</text>
									<text v-if="!visibleTargets(row).length" class="row-detail row-detail--muted">暂未分配到任何目标</text>
									<text v-if="normalizeString(row.status) === 'void'" class="row-detail row-detail--void">
										作废原因：{{ normalizeString(row.void_reason) || '未填写' }}
									</text>
									<text v-if="normalizeString(row.status) === 'void' && row.void_at" class="row-detail row-detail--muted">
										作废时间：{{ formatDateTime(row.void_at) }}{{ row.void_by_name ? ` · 操作人 ${row.void_by_name}` : '' }}
									</text>
								</view>

								<view v-if="row.allocation_target_count > (row.allocation_targets_preview || []).length" class="target-actions">
									<AppButton
										size="sm"
										kind="neutral"
										:loading="isTargetLoading(row._id)"
										@click.stop="toggleTargetExpand(row)"
									>
										{{ isTargetExpanded(row._id) ? '收起去向' : `查看全部去向（${row.allocation_target_count}）` }}
									</AppButton>
									<AppButton
										v-if="isTargetExpanded(row._id) && hasMoreTargets(row._id)"
										size="sm"
										kind="ghost"
										:loading="isTargetLoading(row._id)"
										@click.stop="loadMoreTargets(row)"
									>
										加载更多
									</AppButton>
								</view>

								<text class="row-detail">凭证 {{ row.proof_images_count || 0 }} 张</text>
							</template>

							<template #footer>
								<view class="row-actions">
									<AppButton
										v-if="hasReceiptProofs(row)"
										size="sm"
										kind="neutral"
										:loading="previewingReceiptProofId === normalizeString(row._id)"
										@click.stop="onPreviewReceiptProofs(row)"
									>
										查看凭证
									</AppButton>
									<AppButton
										size="sm"
										kind="ghost"
										:disabled="!canUpdate || !row.editable"
										@click.stop="onEdit(row)"
									>
										编辑
									</AppButton>
									<AppButton
										size="sm"
										kind="outline"
										:disabled="!canDelete || !row.removable"
										@click.stop="onRemove(row)"
									>
										作废
									</AppButton>
								</view>
							</template>
						</AppListItem>
					</AppList>
				</AppSection>
			</template>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { listCustomersV1 } from '@/services/customer'
import { downloadWorkbookFile } from '@/components/domain/customer/statement/exportWorkbook'
import {
	buildCashierReceiptIntakeWorkbookXml,
	buildCashierReceiptIntakeExportFileName
} from '@/components/domain/customer/exportCashierReceiptIntakeWorkbook'
import {
	createReceiptIntakeV1,
	updateReceiptIntakeV1,
	removeReceiptIntakeV1,
	listReceiptIntakeV1,
	listReceiptAllocationTargetsV1
} from '@/services/customerSettlement'

const PAGE_PATH = '/pages/cashier/receipt-intake'
const PROOF_IMAGE_LIMIT = 9
const CUSTOMER_SUGGEST_LIMIT = 20
const CUSTOMER_SEARCH_DEBOUNCE_MS = 180
const SUGGESTION_BLUR_DELAY_MS = 150
const SUGGESTION_SCROLL_THRESHOLD = 4
const VOID_REASON_OPTIONS = ['误录作废', '重复登记', '凭证有误', '客户信息错误']

const { requireLogin, canPageAction, canViewPage } = useAuthGuard()
requireLogin()

const intakeCustomerKeyword = ref('')
const intakeCustomerOptions = ref([])
const intakeCustomerLoading = ref(false)
const showIntakeSuggestions = ref(false)
const intakeCustomerTimer = ref(null)
const selectedIntakeCustomerId = ref('')
const selectedIntakeCustomerName = ref('')
const selectedIntakeMatchedDeliveryName = ref('')
const filterCustomerKeyword = ref('')
const filterCustomerOptions = ref([])
const filterCustomerLoading = ref(false)
const showFilterSuggestions = ref(false)
const filterCustomerTimer = ref(null)
const selectedFilterCustomerId = ref('')
const selectedFilterCustomerName = ref('')
const selectedFilterMatchedDeliveryName = ref('')
const rows = ref([])
const rowsLoading = ref(false)
const exporting = ref(false)
const submitting = ref(false)
const includeVoided = ref(false)
const editingReceiptId = ref('')
const proofImages = ref([])
const previewingReceiptProofId = ref('')
const expandedTargets = ref([])
const targetDetailMap = ref({})
const pager = reactive({
	page: 1,
	pageSize: 20,
	total: 0,
	hasMore: false
})
const receiptPaymentMethodOptions = [
	{ label: '现金', value: 'cash' },
	{ label: '银行转账', value: 'bank' },
	{ label: '微信', value: 'wechat' },
	{ label: '支付宝', value: 'alipay' },
	{ label: '支票', value: 'check' }
]

const form = reactive({
	bizDate: todayYmd(),
	amount: '',
	paymentMethod: 'cash'
})
const listFilter = reactive({
	dateStart: '',
	dateEnd: ''
})

const canView = computed(() => canPageAction(PAGE_PATH, 'view'))
const canCreate = computed(() => canPageAction(PAGE_PATH, 'create'))
const canUpdate = computed(() => canPageAction(PAGE_PATH, 'update'))
const canDelete = computed(() => canPageAction(PAGE_PATH, 'delete'))
const canViewStatement = computed(() => canViewPage('/pages/customer/statement'))
const canCreateOrUpdate = computed(() => (isEditing.value ? canUpdate.value : canCreate.value))
const isEditing = computed(() => Boolean(editingReceiptId.value))
const selectedIntakeCustomerLabel = computed(() => {
	const selectedId = normalizeString(selectedIntakeCustomerId.value)
	if (!selectedId) return ''
	const found = intakeCustomerOptions.value.find((item) => normalizeString(item?.value) === selectedId)
	if (found) return found.label || found.name || ''
	return normalizeString(selectedIntakeCustomerName.value)
})
const selectedIntakeCustomerHint = computed(() => {
	const deliveryName = normalizeString(selectedIntakeMatchedDeliveryName.value)
	if (!deliveryName) return ''
	const settlementName = normalizeString(selectedIntakeCustomerLabel.value)
	return `匹配送达地点：${deliveryName}；收款归属：${settlementName || '结算客户'}`
})
const selectedFilterCustomerLabel = computed(() => {
	const selectedId = normalizeString(selectedFilterCustomerId.value)
	if (!selectedId) return ''
	const found = filterCustomerOptions.value.find((item) => normalizeString(item?.value) === selectedId)
	if (found) return found.label || found.name || ''
	return normalizeString(selectedFilterCustomerName.value)
})
const selectedFilterCustomerHint = computed(() => {
	const deliveryName = normalizeString(selectedFilterMatchedDeliveryName.value)
	if (!deliveryName) return ''
	const settlementName = normalizeString(selectedFilterCustomerLabel.value)
	return `匹配送达地点：${deliveryName}；收款归属：${settlementName || '结算客户'}`
})
const intakePaymentMethodIndex = computed(() => {
	const normalized = normalizeReceiptPaymentMethod(form.paymentMethod)
	const idx = receiptPaymentMethodOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const intakePaymentMethodLabel = computed(() => {
	return receiptPaymentMethodOptions[intakePaymentMethodIndex.value]?.label || '现金'
})
const proofUploading = computed(() => proofImages.value.some((item) => Boolean(item?.uploading)))

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function shouldUseScrollableSuggestions(list = []) {
	return Array.isArray(list) && list.length > SUGGESTION_SCROLL_THRESHOLD
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function todayYmd() {
	const now = new Date()
	const y = now.getFullYear()
	const m = String(now.getMonth() + 1).padStart(2, '0')
	const d = String(now.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function digitsByScale(scale) {
	return Number(scale) === 3 ? 3 : 2
}

function formatMoney(value, scale = 2) {
	const digits = digitsByScale(scale)
	const num = Number(value)
	if (!Number.isFinite(num)) return digits === 3 ? '0.000' : '0.00'
	return num.toFixed(digits)
}

function normalizeMoneyInput(value, scale = 2) {
	const digits = digitsByScale(scale)
	const text = normalizeString(value)
	if (!text) return ''
	const num = Number(text)
	if (!Number.isFinite(num) || num <= 0) return ''
	return num.toFixed(digits)
}

function normalizeProofFileId(value) {
	const text = normalizeString(value)
	if (!text.startsWith('cloud://')) return ''
	return text
}

function normalizeProofImageIds(value, limit = PROOF_IMAGE_LIMIT) {
	const source = Array.isArray(value) ? value : []
	const rows = []
	for (const item of source) {
		const fileId = normalizeProofFileId(item)
		if (!fileId || rows.includes(fileId)) continue
		rows.push(fileId)
		if (rows.length >= limit) break
	}
	return rows
}

function allocationStatusKind(status) {
	const value = normalizeString(status).toLowerCase()
	if (value === 'void') return 'danger'
	if (value === 'allocated') return 'success'
	if (value === 'partial') return 'warning'
	return 'danger'
}

function sourceTypeText(value) {
	const text = normalizeString(value)
	if (text === 'cashier_intake') return '出纳登记'
	return text || '未知来源'
}

function normalizeReceiptPaymentMethod(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'cash' || text === '现金') return 'cash'
	if (text === 'bank' || text === '银行' || text === '转账' || text === '银行转账') return 'bank'
	if (text === 'wechat' || text === '微信') return 'wechat'
	if (text === 'alipay' || text === '支付宝') return 'alipay'
	if (text === 'check' || text === 'cheque' || text === '支票') return 'check'
	return 'cash'
}

function paymentMethodText(value) {
	const method = normalizeReceiptPaymentMethod(value)
	if (method === 'bank') return '银行转账'
	if (method === 'wechat') return '微信'
	if (method === 'alipay') return '支付宝'
	if (method === 'check') return '支票'
	return '现金'
}

function formatDateTime(value) {
	const ts = Number(value)
	if (!Number.isFinite(ts) || ts <= 0) return '-'
	const date = new Date(ts)
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}`
}

function normalizeAllocationMode(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'checked') return 'checked'
	return 'period'
}

function allocationDateScopeText(row) {
	const targetCount = toNumber(row?.allocation_target_count, 0)
	if (targetCount <= 0) return '分配日期：暂未分配'
	const mode = normalizeAllocationMode(row?.allocation_mode)
	const allocationStart = normalizeString(row?.allocation_start_date)
	const allocationEnd = normalizeString(row?.allocation_end_date)
	const targetDateStart = normalizeString(row?.allocation_target_date_start)
	const targetDateEnd = normalizeString(row?.allocation_target_date_end)
	const targetDateCount = Math.max(toNumber(row?.allocation_target_date_count, 0), 0)
	if (mode === 'period') {
		const start = allocationStart || targetDateStart
		const end = allocationEnd || targetDateEnd
		if (start && end) return start === end ? `分配日期范围：${start}` : `分配日期范围：${start} ~ ${end}`
		if (start) return `分配日期范围：${start}`
		return '分配日期范围：按时间段'
	}
	if (targetDateStart && targetDateEnd) {
		if (targetDateStart === targetDateEnd) return `分配到销售日期：${targetDateStart}`
		const suffix = targetDateCount > 0 ? `（共${targetDateCount}天）` : ''
		return `分配到销售日期：${targetDateStart} ~ ${targetDateEnd}${suffix}`
	}
	return `分配到销售单：${targetCount}条`
}

function formatTargetLine(item, moneyScale = 2) {
	const date = normalizeString(item?.target_date) || '-'
	const label = normalizeString(item?.target_type_label) || '销售单'
	const amount = formatMoney(item?.amount, moneyScale)
	const kind = normalizeString(item?.allocate_kind_label)
	if (kind) return `销售日期 ${date} · ${label} · ${kind} ¥${amount}`
	return `销售日期 ${date} · ${label} · ¥${amount}`
}

function onGoStatementSales(row) {
	if (!canViewStatement.value) {
		uni.showToast({ title: '当前账号没有客户对账权限', icon: 'none' })
		return
	}
	const customerId = normalizeString(row?.customer_id)
	if (!customerId) {
		uni.showToast({ title: '该登记缺少客户信息', icon: 'none' })
		return
	}
	uni.navigateTo({ url: `/pages/customer/statement?_id=${encodeURIComponent(customerId)}` })
}

function isTargetExpanded(receiptId) {
	return expandedTargets.value.includes(normalizeString(receiptId))
}

function isTargetLoading(receiptId) {
	const key = normalizeString(receiptId)
	return Boolean(targetDetailMap.value?.[key]?.loading)
}

function hasMoreTargets(receiptId) {
	const key = normalizeString(receiptId)
	return Boolean(targetDetailMap.value?.[key]?.hasMore)
}

function visibleTargets(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return []
	if (!isTargetExpanded(receiptId)) {
		return Array.isArray(row?.allocation_targets_preview) ? row.allocation_targets_preview : []
	}
	const detail = targetDetailMap.value?.[receiptId]
	if (Array.isArray(detail?.items) && detail.items.length) return detail.items
	return Array.isArray(row?.allocation_targets_preview) ? row.allocation_targets_preview : []
}

function customerMatchesKeyword(row = {}, keyword = '') {
	const key = normalizeString(keyword).toLowerCase()
	if (!key) return false
	return [
		row?.name,
		row?.label,
		row?.phone
	]
		.map((value) => normalizeString(value).toLowerCase())
		.some((value) => value && value.includes(key))
}

function resolveMatchedDeliverySite(item = {}, keyword = '') {
	const sites = Array.isArray(item?.matched_delivery_sites) ? item.matched_delivery_sites : []
	if (!sites.length) return null
	const key = normalizeString(keyword).toLowerCase()
	if (customerMatchesKeyword(item, key)) return null
	if (!key) return sites[0] || null
	return sites.find((site) => {
		const siteName = normalizeString(site?.name).toLowerCase()
		return siteName && siteName.includes(key)
	}) || sites[0] || null
}

function buildSettlementHint(deliveryName = '', settlementName = '') {
	const delivery = normalizeString(deliveryName)
	const settlement = normalizeString(settlementName)
	if (!delivery || !settlement) return ''
	return `匹配送达地点：${delivery}；收款归属：${settlement}`
}

function mapCustomerOptions(rows = [], keyword = '') {
	return (Array.isArray(rows) ? rows : []).map((item) => {
		const id = normalizeString(item?._id)
		const name = normalizeString(item?.name)
		const phone = normalizeString(item?.phone)
		const matchedDeliverySite = resolveMatchedDeliverySite(item, keyword)
		const matchedDeliveryName = normalizeString(matchedDeliverySite?.name)
		return {
			value: id,
			name,
			phone,
			label: phone ? `${name}（${phone}）` : name,
			matchedDeliveryName,
			settlementHint: buildSettlementHint(matchedDeliveryName, name)
		}
	}).filter((item) => item.value && item.name)
}

async function searchCustomersByKeyword(keyword = '') {
	const key = normalizeString(keyword)
	if (!key) return []
	const res = await listCustomersV1({
		keyword: key,
		page: 1,
		pageSize: CUSTOMER_SUGGEST_LIMIT,
		settlementOnly: true
	})
	if (res?.code !== 0) {
		throw new Error(res?.msg || '客户加载失败')
	}
	return mapCustomerOptions(res.data, key)
}

async function searchIntakeCustomers(keyword = intakeCustomerKeyword.value) {
	if (intakeCustomerLoading.value) return
	const key = normalizeString(keyword)
	if (!key) {
		intakeCustomerOptions.value = []
		showIntakeSuggestions.value = false
		return
	}
	intakeCustomerLoading.value = true
	try {
		const options = await searchCustomersByKeyword(key)
		if (normalizeString(intakeCustomerKeyword.value) !== key) return
		intakeCustomerOptions.value = options
		showIntakeSuggestions.value = true
	} catch (err) {
		intakeCustomerOptions.value = []
		uni.showToast({ title: normalizeString(err?.message) || '录入客户加载失败', icon: 'none' })
	} finally {
		intakeCustomerLoading.value = false
	}
}

async function searchFilterCustomers(keyword = filterCustomerKeyword.value) {
	if (filterCustomerLoading.value) return
	const key = normalizeString(keyword)
	if (!key) {
		filterCustomerOptions.value = []
		showFilterSuggestions.value = false
		return
	}
	filterCustomerLoading.value = true
	try {
		const options = await searchCustomersByKeyword(key)
		if (normalizeString(filterCustomerKeyword.value) !== key) return
		filterCustomerOptions.value = options
		showFilterSuggestions.value = true
	} catch (err) {
		filterCustomerOptions.value = []
		uni.showToast({ title: normalizeString(err?.message) || '筛选客户加载失败', icon: 'none' })
	} finally {
		filterCustomerLoading.value = false
	}
}

function clearRowsAndPager() {
	rows.value = []
	pager.page = 1
	pager.total = 0
	pager.hasMore = false
	expandedTargets.value = []
	targetDetailMap.value = {}
}

function queueIntakeCustomerSearch(keyword = intakeCustomerKeyword.value) {
	if (intakeCustomerTimer.value) clearTimeout(intakeCustomerTimer.value)
	intakeCustomerTimer.value = setTimeout(() => {
		searchIntakeCustomers(keyword)
	}, CUSTOMER_SEARCH_DEBOUNCE_MS)
}

function queueFilterCustomerSearch(keyword = filterCustomerKeyword.value) {
	if (filterCustomerTimer.value) clearTimeout(filterCustomerTimer.value)
	filterCustomerTimer.value = setTimeout(() => {
		searchFilterCustomers(keyword)
	}, CUSTOMER_SEARCH_DEBOUNCE_MS)
}

function onIntakeCustomerInput(value) {
	intakeCustomerKeyword.value = normalizeString(value)
	selectedIntakeCustomerId.value = ''
	selectedIntakeCustomerName.value = ''
	selectedIntakeMatchedDeliveryName.value = ''
	if (!intakeCustomerKeyword.value) {
		intakeCustomerOptions.value = []
		showIntakeSuggestions.value = false
		if (intakeCustomerTimer.value) clearTimeout(intakeCustomerTimer.value)
		return
	}
	showIntakeSuggestions.value = true
	queueIntakeCustomerSearch(intakeCustomerKeyword.value)
}

function onIntakeCustomerFocus() {
	const key = normalizeString(intakeCustomerKeyword.value)
	if (!key) return
	showIntakeSuggestions.value = true
	queueIntakeCustomerSearch(key)
}

function onIntakeCustomerBlur() {
	setTimeout(() => {
		showIntakeSuggestions.value = false
	}, SUGGESTION_BLUR_DELAY_MS)
}

function onIntakeCustomerConfirm() {
	const key = normalizeString(intakeCustomerKeyword.value)
	if (!key) return
	showIntakeSuggestions.value = true
	queueIntakeCustomerSearch(key)
}

function onFilterCustomerInput(value) {
	filterCustomerKeyword.value = normalizeString(value)
	selectedFilterCustomerId.value = ''
	selectedFilterCustomerName.value = ''
	selectedFilterMatchedDeliveryName.value = ''
	if (!filterCustomerKeyword.value) {
		filterCustomerOptions.value = []
		showFilterSuggestions.value = false
		if (filterCustomerTimer.value) clearTimeout(filterCustomerTimer.value)
		pager.page = 1
		void loadRows(true)
		return
	}
	showFilterSuggestions.value = true
	queueFilterCustomerSearch(filterCustomerKeyword.value)
}

function onFilterCustomerFocus() {
	const key = normalizeString(filterCustomerKeyword.value)
	if (!key) return
	showFilterSuggestions.value = true
	queueFilterCustomerSearch(key)
}

function onFilterCustomerBlur() {
	setTimeout(() => {
		showFilterSuggestions.value = false
	}, SUGGESTION_BLUR_DELAY_MS)
}

function onFilterCustomerConfirm() {
	const key = normalizeString(filterCustomerKeyword.value)
	if (!key) return
	showFilterSuggestions.value = true
	queueFilterCustomerSearch(key)
}

function onPickIntakeCustomer(item) {
	const customerId = normalizeString(item?.value)
	if (!customerId) return
	selectedIntakeCustomerId.value = customerId
	selectedIntakeCustomerName.value = normalizeString(item?.name || item?.label)
	selectedIntakeMatchedDeliveryName.value = normalizeString(item?.matchedDeliveryName)
	intakeCustomerKeyword.value = normalizeString(item?.name || item?.label)
	showIntakeSuggestions.value = false
}

function clearIntakeCustomer() {
	selectedIntakeCustomerId.value = ''
	selectedIntakeCustomerName.value = ''
	selectedIntakeMatchedDeliveryName.value = ''
	intakeCustomerKeyword.value = ''
	intakeCustomerOptions.value = []
	showIntakeSuggestions.value = false
}

async function onPickFilterCustomer(item) {
	const customerId = normalizeString(item?.value)
	if (!customerId) return
	selectedFilterCustomerId.value = customerId
	selectedFilterCustomerName.value = normalizeString(item?.name || item?.label)
	selectedFilterMatchedDeliveryName.value = normalizeString(item?.matchedDeliveryName)
	filterCustomerKeyword.value = normalizeString(item?.name || item?.label)
	showFilterSuggestions.value = false
	pager.page = 1
	await loadRows(true)
}

async function applyIntakeCustomerToFilter() {
	const customerId = normalizeString(selectedIntakeCustomerId.value)
	if (!customerId) return
	selectedFilterCustomerId.value = customerId
	selectedFilterCustomerName.value = normalizeString(selectedIntakeCustomerName.value || selectedIntakeCustomerLabel.value)
	selectedFilterMatchedDeliveryName.value = normalizeString(selectedIntakeMatchedDeliveryName.value)
	filterCustomerKeyword.value = normalizeString(selectedIntakeCustomerName.value || selectedIntakeCustomerLabel.value)
	showFilterSuggestions.value = false
	pager.page = 1
	await loadRows(true)
}

async function clearFilterCustomer() {
	selectedFilterCustomerId.value = ''
	selectedFilterCustomerName.value = ''
	selectedFilterMatchedDeliveryName.value = ''
	filterCustomerKeyword.value = ''
	filterCustomerOptions.value = []
	showFilterSuggestions.value = false
	listFilter.dateStart = ''
	listFilter.dateEnd = ''
	clearRowsAndPager()
	await loadRows(true)
}

function onBizDateChange(e) {
	form.bizDate = normalizeString(e?.detail?.value) || todayYmd()
}

function onIntakePaymentMethodChange(e) {
	const idx = Number(e?.detail?.value)
	if (!Number.isFinite(idx) || idx < 0) return
	const item = receiptPaymentMethodOptions[idx]
	if (!item?.value) return
	form.paymentMethod = item.value
}

function onFilterDateStartChange(e) {
	listFilter.dateStart = normalizeString(e?.detail?.value)
}

function onFilterDateEndChange(e) {
	listFilter.dateEnd = normalizeString(e?.detail?.value)
}

async function applyRecentFilters() {
	if (rowsLoading.value) return
	if (listFilter.dateStart && listFilter.dateEnd && listFilter.dateStart > listFilter.dateEnd) {
		uni.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
		return
	}
	pager.page = 1
	await loadRows(true)
}

async function clearDateFilters() {
	if (!listFilter.dateStart && !listFilter.dateEnd) return
	listFilter.dateStart = ''
	listFilter.dateEnd = ''
	pager.page = 1
	await loadRows(true)
}

async function toggleIncludeVoided() {
	if (rowsLoading.value) return
	includeVoided.value = !includeVoided.value
	pager.page = 1
	await loadRows(true)
}

function normalizeAmountInput() {
	form.amount = normalizeMoneyInput(form.amount, 2)
}

function extractChooseImagePaths(res = null) {
	const merged = []
	const pushOne = (value) => {
		const path = normalizeString(value)
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

async function chooseProofImages() {
	try {
		const remain = Math.max(PROOF_IMAGE_LIMIT - proofImages.value.length, 0)
		if (!remain) {
			uni.showToast({ title: `最多上传 ${PROOF_IMAGE_LIMIT} 张`, icon: 'none' })
			return
		}
		const res = await uni.chooseImage({
			count: remain,
			sizeType: ['compressed'],
			sourceType: ['album', 'camera']
		})
		const paths = extractChooseImagePaths(res)
		if (!paths.length) return
		const merged = proofImages.value.slice()
		for (const path of paths) {
			const localPath = normalizeString(path)
			if (!localPath) continue
			const exists = merged.some((item) => normalizeString(item?.localPath) === localPath)
			if (exists) continue
			merged.push({
				fileId: '',
				localPath,
				previewUrl: localPath,
				uploading: false
			})
			if (merged.length >= PROOF_IMAGE_LIMIT) break
		}
		proofImages.value = merged
	} catch (err) {
		if (normalizeString(err?.errMsg).includes('cancel')) return
		uni.showToast({ title: '选择图片失败', icon: 'none' })
	}
}

function resolveProofPreview(item) {
	if (!item) return ''
	return normalizeString(item.localPath || item.previewUrl || item.fileId)
}

function previewProofImage(index = 0) {
	const urls = proofImages.value.map((item) => resolveProofPreview(item)).filter(Boolean)
	if (!urls.length) return
	const current = urls[index] || urls[0]
	uni.previewImage({ urls, current })
}

function hasReceiptProofs(row) {
	return normalizeProofImageIds(row?.proof_images || [], PROOF_IMAGE_LIMIT).length > 0
}

async function onPreviewReceiptProofs(row) {
	const receiptId = normalizeString(row?._id)
	if (previewingReceiptProofId.value) return
	const ids = normalizeProofImageIds(row?.proof_images || [], PROOF_IMAGE_LIMIT)
	if (!ids.length) {
		uni.showToast({ title: '暂无可查看凭证', icon: 'none' })
		return
	}
	previewingReceiptProofId.value = receiptId || '__preview__'
	try {
		const urls = await resolveProofImageUrls(ids)
		if (!urls.length) {
			uni.showToast({ title: '凭证图片加载失败', icon: 'none' })
			return
		}
		uni.previewImage({ urls, current: urls[0] })
	} finally {
		previewingReceiptProofId.value = ''
	}
}

function removeProofImage(index) {
	if (proofUploading.value) return
	const list = proofImages.value.slice()
	list.splice(index, 1)
	proofImages.value = list
}

async function resolveProofImageUrls(fileIds = []) {
	const ids = normalizeProofImageIds(fileIds, PROOF_IMAGE_LIMIT)
	if (!ids.length) return []
	try {
		const res = await uniCloud.getTempFileURL({
			fileList: ids
		})
		const list = Array.isArray(res?.fileList) ? res.fileList : []
		const map = new Map()
		for (const item of list) {
			const fileId = normalizeString(item?.fileID || item?.fileId)
			if (!fileId) continue
			map.set(fileId, normalizeString(item?.tempFileURL || item?.tempFileUrl || fileId))
		}
		return ids.map((fileId) => map.get(fileId) || fileId)
	} catch (_) {
		return ids
	}
}

async function applyProofImages(fileIds = []) {
	const ids = normalizeProofImageIds(fileIds, PROOF_IMAGE_LIMIT)
	if (!ids.length) {
		proofImages.value = []
		return
	}
	const urls = await resolveProofImageUrls(ids)
	proofImages.value = ids.map((fileId, index) => ({
		fileId,
		localPath: '',
		previewUrl: urls[index] || fileId,
		uploading: false
	}))
}

function resolveUploadExt(filePath = '') {
	const text = normalizeString(filePath)
	const match = text.match(/\.([a-zA-Z0-9]+)$/)
	if (match && match[1]) return `.${match[1].toLowerCase()}`
	return '.jpg'
}

function resolveCloudFileIdFromUploadResult(result = null) {
	const direct = normalizeString(result?.fileID || result?.fileId)
	if (direct.startsWith('cloud://')) return direct
	const queue = [result]
	const seen = new Set()
	while (queue.length > 0) {
		const current = queue.shift()
		if (current == null) continue
		if (typeof current === 'string') {
			const text = normalizeString(current)
			const match = text.match(/cloud:\/\/[^\s"'`\\]+/)
			if (match && match[0]) return match[0]
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

async function uploadProofImage(filePath = '', index = 0) {
	const normalizedPath = normalizeString(filePath)
	if (!normalizedPath) throw new Error('上传文件路径为空')
	const ext = resolveUploadExt(normalizedPath)
	const attempt = await tryUploadProofImage({
		filePath: normalizedPath,
		ext,
		index
	})
	if (!attempt.fileId) throw attempt.error || new Error('上传结果缺少 fileID')
	return attempt.fileId
}

async function tryUploadProofImage({ filePath = '', ext = '.jpg', index = 0 } = {}) {
	const normalizedPath = normalizeString(filePath)
	if (!normalizedPath) return { fileId: '', error: new Error('上传文件路径为空') }
	const normalizedExt = normalizeString(ext) || '.jpg'
	const cloudPath = `cashier-receipt-proof/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}${normalizedExt}`
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
		const text = normalizeString(value)
		if (!text) return
		const match = text.match(/^cloud:\/\/([^/]+)\//)
		if (!match || !match[1]) return
		const id = normalizeString(match[1])
		if (!id || candidates.includes(id)) return
		candidates.push(id)
	}
	;(Array.isArray(proofImages.value) ? proofImages.value : []).forEach((item) => {
		pushOne(item?.fileId)
		pushOne(item?.previewUrl)
	})
	return candidates[0] || 'env-00jxuffegf2n'
}

async function recoverCloudFileIdByPath(cloudPath = '') {
	const normalized = normalizeString(cloudPath).replace(/^\/+/, '')
	if (!normalized) return ''
	const spaceId = inferCloudSpaceId()
	if (!spaceId) return ''
	const fileId = `cloud://${spaceId}/${normalized}`
	try {
		const res = await uniCloud.getTempFileURL({
			fileList: [fileId]
		})
		const list = Array.isArray(res?.fileList) ? res.fileList : []
		const hit = list.find((item) => normalizeString(item?.fileID || item?.fileId) === fileId)
		if (!hit) return ''
		const code = Number(hit?.code)
		const tempUrl = normalizeString(hit?.tempFileURL || hit?.tempFileUrl)
		if ((Number.isFinite(code) && code === 0) || tempUrl) return fileId
	} catch (_) {
		// ignore
	}
	return ''
}

function buildProofUploadFailureMessage({ index = 0, error = null, localPath = '' } = {}) {
	const raw = normalizeString(error?.errMsg || error?.message || 'uploadFile:fail') || 'uploadFile:fail'
	const pathText = normalizeString(localPath)
	const shortPath = pathText.length > 40 ? `...${pathText.slice(-40)}` : pathText
	if (/timeout|timed out|超时|network|网络|request:fail/i.test(raw)) {
		return `第 ${index + 1} 张凭证上传超时或网络异常（${raw}）。请检查网络后重试。`
	}
	if (/no such file|not found|文件不存在|file not exist|路径为空/i.test(raw)) {
		return `第 ${index + 1} 张凭证临时文件失效（${raw}）。请重新选择该图片后提交。`
	}
	return `第 ${index + 1} 张凭证上传失败（${raw}${shortPath ? `，路径 ${shortPath}` : ''}）。`
}

async function ensureProofImagesUploaded() {
	const list = proofImages.value.slice(0, PROOF_IMAGE_LIMIT)
	const resultIds = []
	for (let i = 0; i < list.length; i += 1) {
		const item = list[i] || {}
		if (!item.localPath) {
			const fileId = normalizeProofFileId(item.fileId)
			if (fileId) resultIds.push(fileId)
			continue
		}
		list[i] = { ...item, uploading: true }
		proofImages.value = list.slice()
		try {
			const fileId = await uploadProofImage(item.localPath, i)
			list[i] = {
				fileId,
				localPath: '',
				previewUrl: item.previewUrl || item.localPath || fileId,
				uploading: false
			}
			resultIds.push(fileId)
			proofImages.value = list.slice()
		} catch (err) {
			list[i] = { ...item, uploading: false }
			proofImages.value = list.slice()
			const wrapped = new Error('收款凭证上传失败')
			wrapped.userMessage = buildProofUploadFailureMessage({
				index: i,
				error: err,
				localPath: item.localPath
			})
			wrapped.cause = err
			throw wrapped
		}
	}
	const normalized = normalizeProofImageIds(resultIds, PROOF_IMAGE_LIMIT)
	proofImages.value = proofImages.value.map((item) => ({
		...item,
		fileId: normalizeProofFileId(item.fileId),
		uploading: false
	}))
	return normalized
}

async function onSubmit() {
	if (!canCreateOrUpdate.value || submitting.value) return
	const customerId = normalizeString(selectedIntakeCustomerId.value)
	if (!customerId) {
		uni.showToast({ title: '请先选择客户', icon: 'none' })
		return
	}
	const amount = toNumber(form.amount, 0)
	if (!(amount > 0)) {
		uni.showToast({ title: '请输入正确的收到金额', icon: 'none' })
		return
	}
	if (!proofImages.value.length) {
		uni.showToast({ title: '请至少上传1张收款凭证', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const proofImageIds = await ensureProofImagesUploaded()
		if (!proofImageIds.length) {
			uni.showToast({ title: '请至少上传1张收款凭证', icon: 'none' })
			return
		}
		const payload = {
			customerId,
			bizDate: form.bizDate || todayYmd(),
			amount,
			paymentMethod: normalizeReceiptPaymentMethod(form.paymentMethod),
			proofImages: proofImageIds,
			sourceType: 'cashier_intake'
		}
		const res = isEditing.value
			? await updateReceiptIntakeV1({
				receiptId: editingReceiptId.value,
				...payload
			})
			: await createReceiptIntakeV1(payload)
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || (isEditing.value ? '保存失败' : '登记失败'), icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || (isEditing.value ? '已保存' : '登记成功'), icon: 'success' })
		editingReceiptId.value = ''
		form.amount = ''
		form.bizDate = todayYmd()
		form.paymentMethod = 'cash'
		proofImages.value = []
		await loadRows(true)
	} catch (err) {
		uni.showToast({
			title: normalizeString(err?.userMessage || err?.message) || '凭证上传失败',
			icon: 'none',
			duration: 2600
		})
	} finally {
		submitting.value = false
	}
}

function resetForm() {
	if (submitting.value || proofUploading.value) return
	form.bizDate = todayYmd()
	form.amount = ''
	form.paymentMethod = 'cash'
	proofImages.value = []
}

function cancelEditing() {
	editingReceiptId.value = ''
	resetForm()
}

async function onEdit(row) {
	if (!canUpdate.value) return
	if (!row?.editable) {
		uni.showToast({ title: '该收款单已分配，不能在出纳入口编辑', icon: 'none' })
		return
	}
	const customerId = normalizeString(row?.customer_id)
	if (customerId && selectedIntakeCustomerId.value !== customerId) {
		selectedIntakeCustomerId.value = customerId
		selectedIntakeCustomerName.value = normalizeString(row?.customer_name)
		selectedIntakeMatchedDeliveryName.value = ''
		intakeCustomerKeyword.value = normalizeString(row?.customer_name)
	}
	editingReceiptId.value = normalizeString(row?._id)
	form.bizDate = normalizeString(row?.biz_date) || todayYmd()
	form.amount = normalizeMoneyInput(row?.amount, row?.money_scale)
	form.paymentMethod = normalizeReceiptPaymentMethod(row?.payment_method)
	await applyProofImages(row?.proof_images || [])
	uni.showToast({ title: '已加载收款登记，修改后点保存', icon: 'none' })
}

async function chooseVoidReason() {
	return new Promise((resolve) => {
		uni.showActionSheet({
			itemList: VOID_REASON_OPTIONS,
			success: (res) => {
				const index = Number(res?.tapIndex)
				if (!Number.isFinite(index) || index < 0 || index >= VOID_REASON_OPTIONS.length) {
					resolve('')
					return
				}
				resolve(VOID_REASON_OPTIONS[index] || '')
			},
			fail: () => resolve('')
		})
	})
}

async function onRemove(row) {
	if (!canDelete.value) return
	if (!row?.removable) {
		uni.showToast({ title: '该收款单已作废，不能重复作废', icon: 'none' })
		return
	}
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return
	const confirmed = await new Promise((resolve) => {
		uni.showModal({
			title: '作废收款登记',
			content: '作废后会保留留痕记录；若已分配会先自动回滚分配，确认继续吗？',
			confirmText: '继续',
			cancelText: '取消',
			success: (res) => resolve(Boolean(res?.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirmed) return
	const voidReason = normalizeString(await chooseVoidReason())
	if (!voidReason) {
		uni.showToast({ title: '请先选择作废原因', icon: 'none' })
		return
	}
	const res = await removeReceiptIntakeV1({
		receiptId,
		customerId: normalizeString(row?.customer_id),
		voidReason
	})
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '作废失败', icon: 'none' })
		return
	}
	if (editingReceiptId.value === receiptId) cancelEditing()
	uni.showToast({ title: res?.msg || '已作废', icon: 'success' })
	await loadRows(true)
}

async function loadRows(reset = false) {
	if (!canView.value) return
	const customerId = normalizeString(selectedFilterCustomerId.value)
	if (reset) pager.page = 1
	rowsLoading.value = true
	try {
		const res = await listReceiptIntakeV1({
			customerId,
			dateFrom: listFilter.dateStart,
			dateTo: listFilter.dateEnd,
			includeVoid: includeVoided.value,
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '收款登记加载失败', icon: 'none' })
			rows.value = []
			pager.total = 0
			pager.hasMore = false
			return
		}
		rows.value = Array.isArray(res.data) ? res.data : []
		const paging = res?.paging || {}
		pager.page = Number(paging.page || pager.page || 1)
		pager.pageSize = Number(paging.pageSize || pager.pageSize || 20)
		pager.total = Number(paging.total || 0)
		pager.hasMore = Boolean(paging.hasMore)
		const ids = new Set(rows.value.map((item) => normalizeString(item?._id)).filter(Boolean))
		expandedTargets.value = expandedTargets.value.filter((item) => ids.has(item))
		const nextDetailMap = {}
		Object.keys(targetDetailMap.value || {}).forEach((key) => {
			if (ids.has(key)) nextDetailMap[key] = targetDetailMap.value[key]
		})
		targetDetailMap.value = nextDetailMap
	} finally {
		rowsLoading.value = false
	}
}

async function ensureTargetDetail(row, append = false) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return
	const prev = targetDetailMap.value?.[receiptId] || {
		items: [],
		page: 1,
		pageSize: 50,
		total: 0,
		hasMore: false,
		loading: false
	}
	if (prev.loading) return
	const nextPage = append ? Math.max(toNumber(prev.page, 1) + 1, 1) : 1
	targetDetailMap.value = {
		...targetDetailMap.value,
		[receiptId]: {
			...prev,
			loading: true
		}
	}
	try {
		const res = await listReceiptAllocationTargetsV1({
			customerId: normalizeString(row?.customer_id || selectedFilterCustomerId.value),
			receiptId,
			page: nextPage,
			pageSize: prev.pageSize || 50
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '分配去向加载失败', icon: 'none' })
			return
		}
		const data = Array.isArray(res.data) ? res.data : []
		const paging = res?.paging || {}
		const merged = append ? [...(prev.items || []), ...data] : data
		targetDetailMap.value = {
			...targetDetailMap.value,
			[receiptId]: {
				items: merged,
				page: Number(paging.page || nextPage),
				pageSize: Number(paging.pageSize || prev.pageSize || 50),
				total: Number(paging.total || merged.length),
				hasMore: Boolean(paging.hasMore),
				loading: false
			}
		}
	} catch (_) {
		targetDetailMap.value = {
			...targetDetailMap.value,
			[receiptId]: {
				...prev,
				loading: false
			}
		}
	}
}

async function toggleTargetExpand(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return
	const expanded = isTargetExpanded(receiptId)
	if (expanded) {
		expandedTargets.value = expandedTargets.value.filter((item) => item !== receiptId)
		return
	}
	if (!expandedTargets.value.includes(receiptId)) expandedTargets.value.push(receiptId)
	await ensureTargetDetail(row, false)
}

async function loadMoreTargets(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return
	await ensureTargetDetail(row, true)
}

async function fetchAllRowsForExport() {
	const allRows = []
	const pageSize = 50
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await listReceiptIntakeV1({
			customerId: normalizeString(selectedFilterCustomerId.value),
			dateFrom: listFilter.dateStart,
			dateTo: listFilter.dateEnd,
			includeVoid: includeVoided.value,
			page,
			pageSize
		})
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const batch = Array.isArray(res.data) ? res.data : []
		allRows.push(...batch)
		const paging = res?.paging || {}
		const total = Number(paging.total || allRows.length)
		hasMore = Boolean(paging.hasMore) || page * pageSize < total
		page += 1
	}
	return allRows
}

async function onExport() {
	if (exporting.value) return
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const exportRows = await fetchAllRowsForExport()
		if (!exportRows.length) {
			uni.showToast({ title: '没有可导出的数据', icon: 'none' })
			return
		}
		const workbookText = buildCashierReceiptIntakeWorkbookXml({
			rows: exportRows,
			filter: {
				customerLabel: selectedFilterCustomerId.value ? selectedFilterCustomerLabel.value : '全部客户',
				dateStart: listFilter.dateStart,
				dateEnd: listFilter.dateEnd,
				includeVoided: includeVoided.value
			}
		})
		const fileName = buildCashierReceiptIntakeExportFileName({
			total: exportRows.length,
			filter: {
				customerLabel: selectedFilterCustomerId.value ? selectedFilterCustomerLabel.value : '全部客户',
				dateStart: listFilter.dateStart,
				dateEnd: listFilter.dateEnd,
				includeVoided: includeVoided.value
			}
		})
		const downloaded = await downloadWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持导出，请联系管理员', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: `已导出${exportRows.length}条`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2800 })
	} finally {
		exporting.value = false
		uni.hideLoading()
	}
}

function onPrevPage() {
	if (pager.page <= 1 || rowsLoading.value) return
	pager.page -= 1
	loadRows()
}

function onNextPage() {
	if (!pager.hasMore || rowsLoading.value) return
	pager.page += 1
	loadRows()
}

async function refreshAll() {
	if (!canView.value) return
	await loadRows(true)
}

onMounted(async () => {
	if (!canView.value) return
	await loadRows(true)
})

onShow(() => {
	if (!canView.value) return
	loadRows(true)
})
</script>

<style scoped>
.cashier-wrap {
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-lg);
}

.cashier-wrap :deep(.section) {
	overflow: visible;
}

.cashier-wrap :deep(.section__body) {
	overflow: visible;
}

.customer-chooser {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
	overflow: visible;
}

.recent-filter-inline {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16rpx;
	align-items: end;
}

.form-item {
	display: flex;
	flex-direction: column;
	overflow: visible;
}

.customer-field {
	position: relative;
}

.field-popover-open {
	z-index: 120;
}

.suggestions {
	position: absolute;
	top: calc(100% + 8rpx);
	left: 0;
	right: 0;
	z-index: 80;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.08);
	overflow: hidden;
}

.suggestions--scroll {
	height: 320rpx;
}

.suggest-list {
	padding-bottom: 8rpx;
}

.suggest-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 14rpx 16rpx;
	border-bottom: 1rpx solid #f1f5f9;
	transition: background 0.2s;
}

.suggest-item:last-child {
	border-bottom: none;
}

.suggest-item:active {
	background: #f8fafc;
}

.suggest-info {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	min-width: 0;
}

.suggest-name {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.suggest-sub {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.suggest-sub--settlement {
	color: #0f766e;
	font-weight: 600;
}

.suggest-empty {
	padding: 32rpx;
	text-align: center;
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.picker-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
	flex-wrap: wrap;
}

.picker-row__text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.picker-row__text-group {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	flex: 1;
	min-width: 0;
}

.picker-row__hint {
	font-size: 22rpx;
	font-weight: 600;
	color: #0f766e;
}

.picker-row__actions {
	display: flex;
	gap: 8rpx;
	flex-wrap: wrap;
}

.intake-main-grid {
	margin-top: 16rpx;
	display: grid;
	grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
	gap: 16rpx;
	align-items: end;
	overflow: visible;
}

.picker-block {
	display: block;
}

.proof-card {
	margin-top: 16rpx;
	padding: 18rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #fff;
	display: flex;
	flex-direction: column;
	gap: 14rpx;
}

.proof-card__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
}

.proof-card__meta {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
}

.proof-card__title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.proof-card__hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.proof-card__empty {
	padding: 20rpx;
	border-radius: 10rpx;
	background: #f8fafc;
	border: 1rpx dashed #cbd5e1;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.proof-card__empty-title {
	font-size: 24rpx;
	font-weight: 600;
	color: var(--crm-text);
}

.proof-card__empty-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.proof-list {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 12rpx;
}

.proof-item {
	border: 1rpx solid var(--crm-border);
	border-radius: 10rpx;
	padding: 10rpx;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
	background: #fff;
}

.proof-item__image {
	width: 100%;
	height: 180rpx;
	border-radius: 8rpx;
	background: #f1f5f9;
}

.proof-item__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
	align-items: center;
}

.proof-item__status {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.form-actions {
	margin-top: 16rpx;
	display: flex;
	gap: 12rpx;
	justify-content: flex-end;
	flex-wrap: wrap;
}

.section-hint {
	display: block;
	margin-top: 12rpx;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.list-actions {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
	margin-bottom: 12rpx;
}

.pager-actions {
	display: flex;
	gap: 10rpx;
}

.mini-amounts {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	align-items: flex-end;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.target-list {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.row-detail {
	font-size: 24rpx;
	color: var(--crm-text-secondary);
}

.row-detail--source {
	color: #0f766e;
	font-weight: 700;
}

.row-detail--customer {
	color: #1d4ed8;
	font-weight: 700;
}

.row-detail--range {
	color: #0f172a;
	font-weight: 600;
}

.row-detail--void {
	color: #b45309;
	font-weight: 700;
}

.row-detail--muted {
	color: var(--crm-text-muted);
}

.target-actions {
	margin-top: 8rpx;
	display: flex;
	gap: 8rpx;
	flex-wrap: wrap;
}

.row-actions {
	display: flex;
	gap: 10rpx;
}

@media (max-width: 900px) {
	.intake-main-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.intake-main-grid .customer-field {
		grid-column: span 2;
	}

	.recent-filter-inline {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.recent-filter-inline .customer-field {
		grid-column: span 2;
	}
}

@media (max-width: 640px) {
	.intake-main-grid {
		grid-template-columns: minmax(0, 1fr);
	}

	.intake-main-grid .customer-field {
		grid-column: span 1;
	}

	.picker-row {
		flex-direction: column;
		align-items: stretch;
	}

	.picker-row__actions {
		justify-content: flex-end;
	}

	.recent-filter-inline {
		grid-template-columns: minmax(0, 1fr);
	}

	.proof-list {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.list-actions {
		flex-direction: column;
		align-items: flex-start;
	}

	.pager-actions {
		align-self: flex-end;
	}
}
</style>
