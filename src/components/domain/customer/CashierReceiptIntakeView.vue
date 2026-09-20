<template>
	<AppPage title="出纳收款登记" subtitle="CASHIER RECEIPT" icon="wallet">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="rowsLoading || exporting" @click="onExport">导出</AppButton>
			<AppButton size="sm" kind="neutral" :loading="rowsLoading" :disabled="exporting" @click="refreshAll">刷新</AppButton>
		</template>

		<view class="cashier-wrap">
			<AppSection v-if="!canView" title="无权限访问">
				<text class="section-hint">当前账号没有“出纳收款登记”查看权限，请联系管理员开通。</text>
			</AppSection>

			<template v-else>
				<AppSection title="收款登记">
					<view v-if="writeFeatureDisabled && !isEditing" class="feature-note">{{ createAvailabilityKnown ? '新登记当前暂停；历史查询、导出及服务器允许的更正仍可使用。' : '正在核对新登记开关；历史查询、导出及更正仍可使用。' }}</view>
					<view v-if="operation || actionIssue" class="operation-card" :class="operationCardClass">
						<view class="operation-card__content">
							<text class="operation-card__title">{{ operationTitle }}</text>
							<text v-if="operation" class="operation-card__meta">操作号 {{ operation.operation_id }}</text>
							<text v-if="actionIssue" class="operation-card__message">{{ actionIssue }}</text>
						</view>
						<view class="operation-card__actions">
							<AppButton v-if="operationNeedsQuery" size="sm" kind="neutral" :loading="queryLoading" :disabled="writeBusy" @click="querySavedOperation">查询保存结果</AppButton>
							<AppButton v-if="operation?.status === 'retryable'" size="sm" kind="primary" :loading="actionLoading" :disabled="queryLoading || !preparedWriteAllowed(operation)" @click="retryPreparedOperation">使用原操作号重试</AppButton>
							<AppButton v-if="canDiscardOperation" size="sm" kind="ghost" @click="discardPreparedOperation">取消本次预览</AppButton>
						</view>
					</view>

					<view v-if="operation?.status === 'previewed'" class="preview-card">
						<text class="preview-card__title">{{ operation.command === 'void' ? '作废预览' : (operation.command === 'update' ? '修改预览' : '新增预览') }}</text>
						<text class="preview-card__line">原记录：{{ previewSummaryText(operation.before, '无（新增）') }}</text>
						<text class="preview-card__line">保存后：{{ previewSummaryText(operation.after, operation.command === 'void' ? '已作废' : '待核') }}</text>
						<text v-if="previewStale" class="preview-card__warning">表单内容已经变化，请重新生成预览。</text>
						<view class="form-actions">
							<AppButton size="sm" kind="ghost" :disabled="writeBusy" @click="discardPreparedOperation">取消预览</AppButton>
							<AppButton size="sm" :kind="operation.command === 'void' ? 'outline' : 'primary'" :loading="actionLoading" :disabled="!canConfirmPrepared" @click="confirmPreparedOperation">
								{{ operation.command === 'void' ? '确认作废' : '确认保存' }}
							</AppButton>
						</view>
					</view>

					<view class="intake-main-grid">
						<view class="form-item customer-field intake-customer" :class="{ 'field-popover-open': showIntakeSuggestions }">
							<AppInput
								:model-value="intakeCustomerKeyword"
								label="录入客户"
								placeholder="输入关键字搜索"
								prefix-icon="user"
								size="sm"
								confirm-type="search"
								:disabled="fieldsLocked"
								@update:modelValue="onIntakeCustomerInput"
								@confirm="onIntakeCustomerConfirm"
								@focus="onIntakeCustomerFocus"
								@blur="onIntakeCustomerBlur"
							/>
							<scroll-view v-if="showIntakeSuggestions && intakeCustomerOptions.length > SUGGESTION_SCROLL_THRESHOLD" scroll-y class="suggestions suggestions--scroll">
								<view class="suggest-list"><view v-for="item in intakeCustomerOptions" :key="`intake:${item.value}`" class="suggest-item" @mousedown.stop.prevent="guardSuggestionPick('intake', item)" @tap.stop="guardSuggestionPick('intake', item)" @click.stop="guardSuggestionPick('intake', item)"><view class="suggest-info"><text class="suggest-name">{{ item.name }}</text><text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text><text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text></view><AppIcon name="plus" size="24rpx" color="#94a3b8" /></view></view>
							</scroll-view>
							<view v-else-if="showIntakeSuggestions" class="suggestions">
								<view v-if="intakeCustomerOptions.length" class="suggest-list"><view v-for="item in intakeCustomerOptions" :key="`intake:inline:${item.value}`" class="suggest-item" @mousedown.stop.prevent="guardSuggestionPick('intake', item)" @tap.stop="guardSuggestionPick('intake', item)" @click.stop="guardSuggestionPick('intake', item)"><view class="suggest-info"><text class="suggest-name">{{ item.name }}</text><text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text><text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text></view><AppIcon name="plus" size="24rpx" color="#94a3b8" /></view></view>
								<view v-else class="suggest-empty">未找到匹配客户</view>
							</view>
						</view>

						<picker class="picker-block" mode="date" :disabled="fieldsLocked" @change="onBizDateChange">
							<AppInput v-model="form.bizDate" label="业务日期" readonly size="sm" :disabled="fieldsLocked" />
						</picker>
						<picker class="picker-block" mode="selector" :range="kindOptions" range-key="label" :value="kindIndex" :disabled="fieldsLocked" @change="onKindChange">
							<AppInput :model-value="kindOptions[kindIndex]?.label || '气款'" label="资金类型" readonly size="sm" :disabled="fieldsLocked" />
						</picker>
						<picker class="picker-block" mode="selector" :range="paymentMethodOptions" range-key="label" :value="paymentMethodIndex" :disabled="fieldsLocked" @change="onPaymentMethodChange">
							<AppInput :model-value="paymentMethodOptions[paymentMethodIndex]?.label || '现金'" label="收款渠道" readonly size="sm" :disabled="fieldsLocked" />
						</picker>
						<AppInput v-model="form.amount" :label="`到账总额（${form.kind === 'deposit' ? 2 : selectedIntakeMoneyScale}位小数）`" type="digit" placeholder="按到账凭证填写" size="sm" :disabled="fieldsLocked" />
						<AppInput v-if="form.kind === 'mixed'" v-model="form.gasAmount" :label="`其中气款（${selectedIntakeMoneyScale}位小数）`" type="digit" placeholder="请输入正数" size="sm" :disabled="fieldsLocked" />
						<AppInput v-if="form.kind === 'mixed'" v-model="form.depositAmount" label="其中押金（2位小数）" type="digit" placeholder="请输入正数" size="sm" :disabled="fieldsLocked" />
						<picker v-if="form.kind !== 'deposit'" class="picker-block" mode="selector" :range="purposeOptions" range-key="label" :value="purposeIndex" :disabled="fieldsLocked" @change="onPurposeChange">
							<AppInput :model-value="purposeOptions.find(item => item.value === form.purpose)?.label || '用途待核，请选择'" label="气款用途" readonly size="sm" :disabled="fieldsLocked" />
						</picker>
						<AppInput v-model="form.note" label="备注（可选）" placeholder="可填写收据号或说明" size="sm" :disabled="fieldsLocked" />
						<AppInput v-if="isEditing" v-model="form.reason" label="修改原因（必填）" placeholder="请说明修改依据" size="sm" :disabled="fieldsLocked" />
					</view>

					<view class="picker-row">
						<view class="picker-row__text-group">
							<text class="picker-row__text">{{ selectedIntakeCustomerId ? `已选结算客户：${selectedIntakeCustomerLabel}` : '请从下拉候选中点选客户' }}</text>
							<text v-if="selectedIntakeCustomerHint" class="picker-row__hint">{{ selectedIntakeCustomerHint }}</text>
							<text class="picker-row__total">到账总额：{{ normalizeCashierText(form.amount) ? `¥${form.amount}` : '待填写' }}{{ form.kind === 'mixed' ? (currentAmounts ? `（已核对：气款 ¥${currentAmounts.gas_amount} + 押金 ¥${currentAmounts.deposit_amount}）` : '（须等于气款与押金之和）') : '' }}</text>
						</view>
						<AppButton size="sm" kind="ghost" :disabled="!selectedIntakeCustomerId || fieldsLocked" @click="clearIntakeCustomer">清空客户</AppButton>
					</view>

					<view class="proof-card">
						<view class="proof-card__header"><view class="proof-card__meta"><text class="proof-card__title">收款凭证</text><text class="proof-card__hint">至少 1 张，最多 {{ PROOF_IMAGE_LIMIT }} 张；预览前统一上传</text></view><AppButton size="sm" kind="primary" :disabled="fieldsLocked || !canCreateOrUpdate || proofImages.length >= PROOF_IMAGE_LIMIT" @click="chooseProofImages">选择图片（{{ proofImages.length }}/{{ PROOF_IMAGE_LIMIT }}）</AppButton></view>
						<view v-if="proofImages.length" class="proof-list">
							<view v-for="(item, index) in proofImages" :key="item.draftKey || item.fileId || index" class="proof-item">
								<image class="proof-item__image" :src="resolveProofPreview(item)" mode="aspectFill" @click="previewDraftProof(index)" />
								<view class="proof-item__actions"><text class="proof-item__status">{{ item.fileId ? '已上传' : '待上传' }}</text><AppButton size="sm" kind="neutral" @click="previewDraftProof(index)">预览</AppButton><AppButton size="sm" kind="outline" :disabled="fieldsLocked" @click="removeProofImage(index)">移除</AppButton></view>
							</view>
						</view>
						<view v-else class="proof-card__empty"><text class="proof-card__empty-title">未选择收款凭证</text><text class="proof-card__empty-text">至少选择 1 张后才能生成保存预览。</text></view>
					</view>

					<view class="form-actions">
						<AppButton size="sm" kind="ghost" :disabled="fieldsLocked" @click="resetForm">重置金额</AppButton>
						<AppButton v-if="isEditing" size="sm" kind="outline" :disabled="fieldsLocked" @click="cancelEditing">取消编辑</AppButton>
						<AppButton size="sm" kind="primary" :loading="writeBusy" :disabled="!canPreviewCurrent" @click="previewCurrentOperation">{{ isEditing ? '预览修改' : '预览登记' }}</AppButton>
					</view>
					<text class="section-hint">气款或混合收款中的气款部分可指定为预付款或结算款；纯押金用途固定为未注明。登记后分配仍在客户对账页完成。</text>
				</AppSection>

				<AppSection title="最近登记">
					<view class="recent-filter-inline">
						<view class="form-item customer-field filter-customer" :class="{ 'field-popover-open': showFilterSuggestions }">
							<AppInput :model-value="filterCustomerKeyword" label="筛选客户" placeholder="输入关键字搜索" prefix-icon="user" size="sm" confirm-type="search" :disabled="rowsLoading || exporting" @update:modelValue="onFilterCustomerInput" @confirm="onFilterCustomerConfirm" @focus="onFilterCustomerFocus" @blur="onFilterCustomerBlur" />
							<scroll-view v-if="showFilterSuggestions && filterCustomerOptions.length > SUGGESTION_SCROLL_THRESHOLD" scroll-y class="suggestions suggestions--scroll"><view class="suggest-list"><view v-for="item in filterCustomerOptions" :key="`filter:${item.value}`" class="suggest-item" @mousedown.stop.prevent="guardSuggestionPick('filter', item)" @tap.stop="guardSuggestionPick('filter', item)" @click.stop="guardSuggestionPick('filter', item)"><view class="suggest-info"><text class="suggest-name">{{ item.name }}</text><text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text><text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text></view><AppIcon name="plus" size="24rpx" color="#94a3b8" /></view></view></scroll-view>
							<view v-else-if="showFilterSuggestions" class="suggestions"><view v-if="filterCustomerOptions.length" class="suggest-list"><view v-for="item in filterCustomerOptions" :key="`filter:inline:${item.value}`" class="suggest-item" @mousedown.stop.prevent="guardSuggestionPick('filter', item)" @tap.stop="guardSuggestionPick('filter', item)" @click.stop="guardSuggestionPick('filter', item)"><view class="suggest-info"><text class="suggest-name">{{ item.name }}</text><text v-if="item.phone" class="suggest-sub">{{ item.phone }}</text><text v-if="item.settlementHint" class="suggest-sub suggest-sub--settlement">{{ item.settlementHint }}</text></view><AppIcon name="plus" size="24rpx" color="#94a3b8" /></view></view><view v-else class="suggest-empty">未找到匹配客户</view></view>
						</view>
						<picker class="picker-block" mode="date" :disabled="rowsLoading || exporting" @change="listFilter.dateFrom = normalizeCashierText($event.detail.value)"><AppInput :model-value="listFilter.dateFrom" label="开始日期" placeholder="不限" readonly size="sm" :disabled="rowsLoading || exporting" /></picker>
						<picker class="picker-block" mode="date" :disabled="rowsLoading || exporting" @change="listFilter.dateTo = normalizeCashierText($event.detail.value)"><AppInput :model-value="listFilter.dateTo" label="结束日期" placeholder="不限" readonly size="sm" :disabled="rowsLoading || exporting" /></picker>
						<picker class="picker-block" mode="selector" :range="kindFilterOptions" range-key="label" :value="kindFilterIndex" :disabled="rowsLoading || exporting" @change="onKindFilterChange"><AppInput :model-value="kindFilterOptions[kindFilterIndex]?.label || '全部'" label="资金类型" readonly size="sm" :disabled="rowsLoading || exporting" /></picker>
						<picker class="picker-block" mode="selector" :range="purposeFilterOptions" range-key="label" :value="purposeFilterIndex" :disabled="rowsLoading || exporting" @change="onPurposeFilterChange"><AppInput :model-value="purposeFilterOptions[purposeFilterIndex]?.label || '全部'" label="气款用途" readonly size="sm" :disabled="rowsLoading || exporting" /></picker>
					</view>

					<view class="list-actions">
						<view><text class="section-hint">每页 20 条；凭证、分配及押金关联仅在打开详情时读取。</text><text class="section-hint">导出始终保留作废单，作废金额不计入有效到账合计。</text></view>
						<view class="pager-actions">
							<AppButton size="sm" kind="ghost" :disabled="rowsLoading || exporting" @click="clearFilters">清空筛选</AppButton>
							<AppButton size="sm" kind="neutral" :disabled="rowsLoading || exporting" @click="toggleIncludeVoided">{{ listFilter.includeVoid ? '隐藏已作废' : '显示已作废' }}</AppButton>
							<AppButton size="sm" kind="primary" :disabled="rowsLoading || exporting" @click="applyFilters">查询</AppButton>
						</view>
					</view>

					<AppList :loading="rowsLoading" :empty="rows.length === 0" empty-title="暂无收款登记">
						<AppListItem v-for="row in rows" :key="rowIntakeId(row)" :title="`${row.biz_date || '-'} · ${normalizeCashierText(row.customer_name) || '未命名客户'} · ${kindText(row.kind)}`" :subtitle="`${rowIntakeId(row)} · ${sourceText(row)} · ${normalizeCashierText(row.created_by_name) || '登记人待核'}`" :status="rowStatusText(row)" :status-kind="rowStatusKind(row)" icon="wallet" icon-class="bg-success" clickable @click="toggleDetail(row)">
							<template #right><view class="mini-amounts"><text>合计 ¥{{ moneyText(row.amount, rowAmountScale(row)) }}</text><text>气款 ¥{{ moneyText(row.gas_amount, row.money_scale) }}</text><text>押金 ¥{{ moneyText(row.deposit_amount, 2) }}</text></view></template>
							<template #default>
								<view class="row-summary"><text class="row-detail">渠道：{{ paymentMethodText(row.payment_method) }} · 用途：{{ purposeText(row.purpose, row.kind) }}</text><text class="row-detail">已分配 ¥{{ moneyText(row.allocated_amount, row.money_scale) }} · 抹零 ¥{{ moneyText(row.rounding_allocated_amount, row.money_scale) }} · 未分配 ¥{{ moneyText(row.unallocated_amount, row.money_scale) }}</text><text v-if="row.note" class="row-detail">备注：{{ row.note }}</text><text class="row-detail">凭证 {{ Number(row.proof_images_count || 0) }} 张</text><text v-if="rowRestrictionReason(row) && (!rowEditable(row) || !rowRemovable(row))" class="row-detail row-detail--warning">限制：{{ rowRestrictionReason(row) }}</text></view>
								<view v-if="isDetailExpanded(row)" class="detail-panel">
									<text v-if="detailState(row).loading" class="row-detail">详情加载中…</text>
									<text v-else-if="detailState(row).error" class="row-detail row-detail--warning">{{ detailState(row).error }}</text>
									<template v-else-if="detailState(row).data">
										<text class="detail-title">气款分配（{{ detailState(row).data.allocation_targets.length }}）</text>
										<text v-for="(target, index) in detailState(row).data.allocation_targets" :key="`allocation:${rowIntakeId(row)}:${index}`" class="row-detail">{{ allocationTargetText(target, row.money_scale) }}</text>
										<text v-if="!detailState(row).data.allocation_targets.length" class="row-detail row-detail--muted">暂无气款分配</text>
										<text class="detail-title">客户押金账（原收取及后续 {{ detailState(row).data.deposit_entries.length }}）</text>
										<text v-if="detailState(row).data.row.deposit_entry_id" class="row-detail row-detail--warning">这里只展示本次原收取及其后的客户押金流水。押金余额为客户共用余额，后续退还或转款不能归因到某一笔收取。</text>
										<text v-for="(entry, index) in detailState(row).data.deposit_entries" :key="`deposit:${rowIntakeId(row)}:${index}`" class="row-detail">{{ depositEntryText(entry) }}</text>
										<text v-if="!detailState(row).data.deposit_entries.length" class="row-detail row-detail--muted">本单无可核对的押金流水</text>
									</template>
								</view>
							</template>
							<template #footer><view class="row-actions"><AppButton size="sm" kind="neutral" :loading="detailState(row).loading" @click.stop="toggleDetail(row)">{{ isDetailExpanded(row) ? '收起详情' : '查看详情' }}</AppButton><AppButton v-if="Number(row.proof_images_count || 0) > 0" size="sm" kind="neutral" :disabled="detailState(row).loading" @click.stop="previewRowProofs(row)">查看凭证</AppButton><AppButton size="sm" kind="ghost" :loading="detailState(row).loading" :disabled="!canUpdate || fieldsLocked || (detailAuthorizationLoaded(row) && !rowEditable(row))" @click.stop="onEdit(row)">编辑</AppButton><AppButton size="sm" kind="outline" :loading="detailState(row).loading" :disabled="!canDelete || fieldsLocked || (detailAuthorizationLoaded(row) && !rowRemovable(row))" @click.stop="onBeginVoid(row)">作废</AppButton></view></template>
						</AppListItem>
					</AppList>

					<view class="cursor-footer"><text class="section-hint">第 {{ pager.page }} 页 · 共 {{ pager.total }} 条</text><view class="pager-actions"><AppButton size="sm" kind="ghost" :disabled="rowsLoading || !pager.cursorStack.length" @click="onPrevPage">上一页</AppButton><AppButton size="sm" kind="ghost" :disabled="rowsLoading || !pager.hasMore" @click="onNextPage">下一页</AppButton></view></view>
				</AppSection>
			</template>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { getUser } from '@/services/auth'
import { listCustomersV1 } from '@/services/customer'
import { downloadWorkbookFile } from '@/components/domain/customer/statement/exportWorkbook'
import {
	buildCashierReceiptIntakeExportFileName,
	buildCashierReceiptIntakeWorkbookXml,
	collectCashierReceiptIntakeExportRows
} from '@/components/domain/customer/exportCashierReceiptIntakeWorkbook'
import {
	getReceiptIntakeDetailV2,
	getReceiptIntakeOperationV2,
	listReceiptIntakeV2,
	previewReceiptIntakeV2,
	saveReceiptIntakeV2,
	voidReceiptIntakeV2
} from '@/services/api/cashierIntake'
import {
	buildCashierAmounts,
	cashierDraftFingerprint,
	normalizeCashierKind,
	normalizeCashierMoney,
	normalizeCashierMoneyScale,
	normalizeCashierPurpose,
	normalizeCashierText
} from '@/services/mappers/cashierIntake'

const PAGE_PATH = '/pages/cashier/receipt-intake'
const PROOF_IMAGE_LIMIT = 9
const CUSTOMER_SUGGEST_LIMIT = 20
const CUSTOMER_SEARCH_DEBOUNCE_MS = 180
const SUGGESTION_BLUR_DELAY_MS = 150
const SUGGESTION_PICK_GUARD_MS = 500
const SUGGESTION_SCROLL_THRESHOLD = 4
const OPERATION_STORAGE_PREFIX = 'crm_cashier_intake_v2_operation'
const VOID_REASON_OPTIONS = ['误录作废', '重复登记', '凭证有误', '客户信息错误']

const { requireLogin, canPageAction } = useAuthGuard()
requireLogin()

const intakeCustomerKeyword = ref('')
const intakeCustomerOptions = ref([])
const intakeCustomerLoading = ref(false)
const showIntakeSuggestions = ref(false)
const intakeCustomerTimer = ref(null)
const selectedIntakeCustomerId = ref('')
const selectedIntakeCustomerName = ref('')
const selectedIntakeMatchedDeliveryName = ref('')
const selectedIntakeMoneyScale = ref(2)
const filterCustomerKeyword = ref('')
const filterCustomerOptions = ref([])
const filterCustomerLoading = ref(false)
const showFilterSuggestions = ref(false)
const filterCustomerTimer = ref(null)
const suggestionPickGuard = ref({ key: '', expiresAt: 0 })
const selectedFilterCustomerId = ref('')
const selectedFilterCustomerName = ref('')
const selectedFilterMatchedDeliveryName = ref('')
const rows = ref([])
const rowsLoading = ref(false)
const exporting = ref(false)
const proofImages = ref([])
const editingIntakeId = ref('')
const editingVersion = ref(0)
const operation = ref(null)
const actionIssue = ref('')
const actionLoading = ref(false)
const queryLoading = ref(false)
const storageReady = ref(true)
const writeFeatureDisabled = ref(true)
const createAvailabilityKnown = ref(false)
const detailMap = ref({})
const expandedDetails = ref([])
let initialized = false
let detailGeneration = 0
let detailRequestSerial = 0
let rowActionSerial = 0
const customerSearchSerial = { intake: 0, filter: 0 }

const form = reactive({ kind: 'gas', amount: '', gasAmount: '', depositAmount: '', purpose: 'unspecified', bizDate: todayYmd(), paymentMethod: 'cash', note: '', reason: '' })
const listFilter = reactive({ dateFrom: '', dateTo: '', kind: '', purpose: '', includeVoid: false })
const pager = reactive({ page: 1, pageSize: 20, total: 0, hasMore: false, cursor: '', nextCursor: null, snapshot: null, cursorStack: [] })

const kindOptions = [{ label: '气款', value: 'gas' }, { label: '押金', value: 'deposit' }, { label: '气款+押金', value: 'mixed' }]
const kindFilterOptions = [{ label: '全部', value: '' }, ...kindOptions]
const purposeOptions = [{ label: '未注明', value: 'unspecified' }, { label: '预付', value: 'prepay' }, { label: '结账', value: 'settlement' }]
const purposeFilterOptions = [{ label: '全部', value: '' }, ...purposeOptions]
const paymentMethodOptions = [{ label: '渠道待核，请选择', value: '' }, { label: '现金', value: 'cash' }, { label: '银行转账', value: 'bank' }, { label: '微信', value: 'wechat' }, { label: '支付宝', value: 'alipay' }, { label: '支票', value: 'check' }]

const canView = computed(() => canPageAction(PAGE_PATH, 'view'))
const canCreate = computed(() => canPageAction(PAGE_PATH, 'create'))
const canUpdate = computed(() => canPageAction(PAGE_PATH, 'update'))
const canDelete = computed(() => canPageAction(PAGE_PATH, 'delete'))
const isEditing = computed(() => Boolean(editingIntakeId.value))
const canCreateOrUpdate = computed(() => isEditing.value ? canUpdate.value : canCreate.value)
const selectedIntakeCustomerLabel = computed(() => selectedIntakeCustomerName.value || intakeCustomerOptions.value.find((item) => item.value === selectedIntakeCustomerId.value)?.name || '')
const selectedIntakeCustomerHint = computed(() => selectedIntakeMatchedDeliveryName.value ? `匹配送达地点：${selectedIntakeMatchedDeliveryName.value}；收款归属：${selectedIntakeCustomerLabel.value || '结算客户'}` : '')
const kindIndex = computed(() => Math.max(kindOptions.findIndex((item) => item.value === form.kind), 0))
const kindFilterIndex = computed(() => Math.max(kindFilterOptions.findIndex((item) => item.value === listFilter.kind), 0))
const purposeIndex = computed(() => Math.max(purposeOptions.findIndex((item) => item.value === form.purpose), 0))
const purposeFilterIndex = computed(() => Math.max(purposeFilterOptions.findIndex((item) => item.value === listFilter.purpose), 0))
const paymentMethodIndex = computed(() => Math.max(paymentMethodOptions.findIndex((item) => item.value === form.paymentMethod), 0))
const currentAmounts = computed(() => buildCashierAmounts({ kind: form.kind, amount: form.amount, gas_amount: form.gasAmount, deposit_amount: form.depositAmount, money_scale: selectedIntakeMoneyScale.value }))
const writeBusy = computed(() => actionLoading.value || ['uploading', 'previewing', 'saving'].includes(operation.value?.status))
const operationNeedsQuery = computed(() => ['unknown'].includes(operation.value?.status))
const fieldsLocked = computed(() => writeBusy.value || ['unknown', 'retryable'].includes(operation.value?.status) || (operation.value?.command === 'void' && operation.value?.status === 'previewed'))
const canDiscardOperation = computed(() => Boolean(operation.value) && !writeBusy.value && !['unknown', 'retryable'].includes(operation.value?.status))
const canPreviewCurrent = computed(() => canCreateOrUpdate.value && storageReady.value && (isEditing.value || !writeFeatureDisabled.value) && !fieldsLocked.value)
const previewStale = computed(() => operation.value?.command !== 'void' && operation.value?.status === 'previewed' && operation.value.fingerprint !== currentDraftFingerprint())
const canConfirmPrepared = computed(() => Boolean(operation.value?.submission) && operation.value?.status === 'previewed' && !previewStale.value && !writeBusy.value && storageReady.value && preparedWriteAllowed(operation.value))
const operationTitle = computed(() => {
	const status = operation.value?.status
	if (status === 'unknown') return '保存结果待确认'
	if (status === 'retryable') return '可按原内容安全重试'
	if (status === 'previewed') return '服务器预览已就绪'
	if (status === 'saving') return '正在保存'
	if (status === 'uploading') return '正在上传冻结的凭证'
	if (status === 'previewing') return '正在生成服务器预览'
	if (status === 'rejected') return '本次操作未保存'
	return actionIssue.value ? '操作提示' : '登记操作'
})
const operationCardClass = computed(() => ({ 'operation-card--warning': ['unknown', 'retryable'].includes(operation.value?.status), 'operation-card--danger': operation.value?.status === 'rejected' }))

function todayYmd() {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function deepClone(value) {
	return value == null ? value : JSON.parse(JSON.stringify(value))
}

function accountId() {
	const user = getUser() || {}
	return normalizeCashierText(user._id || user.id || user.user_id || user.username) || 'current'
}

function operationStorageKey() {
	return `${OPERATION_STORAGE_PREFIX}:${accountId()}`
}

function persistOperation() {
	try {
		if (!operation.value) uni.removeStorageSync(operationStorageKey())
		else uni.setStorageSync(operationStorageKey(), { account_id: accountId(), operation: operation.value })
		storageReady.value = true
		return true
	} catch (_) {
		storageReady.value = false
		actionIssue.value = '设备未能保存本次操作号，暂不能提交。请检查存储后重新预览。'
		return false
	}
}

function restoreOperation() {
	try {
		const saved = uni.getStorageSync(operationStorageKey())
		if (!saved?.operation?.operation_id || saved.account_id !== accountId()) return
		operation.value = saved.operation
		const op = operation.value
		if (op.status === 'saved') {
			if (committedResultMatches(op, op.result)) {
				const command = op.command
				operation.value = null
				if (command !== 'void') resetAmountsAndProofs()
				actionIssue.value = '上次登记已保存，操作号已完成收尾。'
				persistOperation()
				return
			}
			op.status = 'unknown'
			actionIssue.value = '上次保存终态不完整。请先查询原操作号，避免重复登记。'
			persistOperation()
			return
		}
		if (['create', 'update'].includes(op.command) && op.frozen_draft) applyFrozenDraft(op.frozen_draft)
		if (op.status === 'saving') {
			op.status = 'unknown'
			actionIssue.value = '上次保存回执未完成。请先查询原操作号，避免重复登记。'
			persistOperation()
		} else if (['uploading', 'previewing'].includes(op.status)) {
			op.status = 'rejected'
			actionIssue.value = '上次预览在保存前中断，可继续使用原操作号重新预览。'
			persistOperation()
		} else if (op.status === 'unknown') {
			actionIssue.value = '保存结果仍待确认。请先查询原操作号。'
		} else if (op.status === 'retryable') {
			actionIssue.value = '未找到已保存结果，可用冻结内容和原操作号安全重试。'
		}
	} catch (_) {
		storageReady.value = false
		actionIssue.value = '本地操作号读取失败，暂不能登记。'
	}
}

function clearOperation() {
	operation.value = null
	actionIssue.value = ''
	persistOperation()
}

function createOperationId() {
	return `cashin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

function customerMoneyScale(item = {}) {
	if ([2, 3].includes(Number(item.money_scale))) return Number(item.money_scale)
	const unit = normalizeCashierText(item.settlement_default_price_unit || item.effective_default_price_unit || item.default_price_unit).toLowerCase()
	return unit === 'm3' ? 3 : 2
}

function normalizeProofFileId(value) {
	const text = normalizeCashierText(value?.file_id || value?.fileId || value)
	return text.startsWith('cloud://') ? text : ''
}

function normalizeProofItems(value = []) {
	const result = []
	for (const source of Array.isArray(value) ? value : []) {
		const fileId = normalizeProofFileId(source)
		const localPath = normalizeCashierText(source?.local_path || source?.localPath)
		const draftKey = normalizeCashierText(source?.draft_key || source?.draftKey || fileId || (localPath ? `local:${localPath}` : ''))
		if ((!fileId && !localPath) || !draftKey || result.some((item) => item.draftKey === draftKey)) continue
		result.push({ fileId, localPath, previewUrl: normalizeCashierText(source?.preview_url || source?.previewUrl || localPath || fileId), draftKey })
		if (result.length >= PROOF_IMAGE_LIMIT) break
	}
	return result
}

function buildCurrentDraft() {
	const amounts = currentAmounts.value
	if (!amounts) return null
	return {
		command: isEditing.value ? 'update' : 'create', intake_id: editingIntakeId.value, customer_id: selectedIntakeCustomerId.value,
		customer_name: selectedIntakeCustomerLabel.value, matched_delivery_name: selectedIntakeMatchedDeliveryName.value,
		expected_version: isEditing.value ? Number(editingVersion.value || 0) : 0, money_scale: selectedIntakeMoneyScale.value,
		kind: normalizeCashierKind(form.kind), amount: amounts.amount, gas_amount: amounts.gas_amount, deposit_amount: amounts.deposit_amount,
		purpose: normalizeCashierPurpose(form.purpose, form.kind), biz_date: normalizeCashierText(form.bizDate), payment_method: normalizeCashierText(form.paymentMethod),
		proof_images: normalizeProofItems(proofImages.value).map((item) => ({ file_id: item.fileId, local_path: item.localPath, preview_url: item.previewUrl, draft_key: item.draftKey })),
		note: normalizeCashierText(form.note), reason: normalizeCashierText(form.reason)
	}
}

function currentDraftFingerprint() {
	return cashierDraftFingerprint(buildCurrentDraft() || {})
}

function validateCurrentDraft() {
	const draft = buildCurrentDraft()
	if (!normalizeCashierText(selectedIntakeCustomerId.value)) return { error: '请先选择客户' }
	if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeCashierText(form.bizDate))) return { error: '请选择正确的业务日期' }
	if (!draft) return { error: form.kind === 'mixed' ? '请核对到账总额，并确保它精确等于气款与押金之和' : '请输入正确的到账总额，且不要超过客户精度' }
	if (!draft.payment_method || !paymentMethodOptions.some((item) => item.value === draft.payment_method)) return { error: '请选择收款渠道' }
	if (!['unspecified', 'prepay', 'settlement'].includes(form.purpose) || !['unspecified', 'prepay', 'settlement'].includes(draft.purpose)) return { error: '请选择明确的气款用途' }
	if (!draft.proof_images.length) return { error: '请至少选择1张收款凭证' }
	if (draft.proof_images.length > PROOF_IMAGE_LIMIT) return { error: `收款凭证最多${PROOF_IMAGE_LIMIT}张` }
	if (draft.command === 'update' && !draft.reason) return { error: '修改登记必须填写原因' }
	return { draft }
}

function ensureOperation(draft) {
	const fingerprint = cashierDraftFingerprint(draft)
	if (operation.value?.fingerprint === fingerprint && operation.value?.command === draft.command) {
		operation.value.frozen_draft = deepClone(draft)
		operation.value.expected_version = Number(draft.expected_version || 0)
		return operation.value
	}
	if (['unknown', 'retryable', 'saving'].includes(operation.value?.status)) return null
	operation.value = { account_id: accountId(), operation_id: createOperationId(), command: draft.command, fingerprint, expected_version: Number(draft.expected_version || 0), frozen_draft: deepClone(draft), submission: null, before: null, after: null, status: 'draft', updated_at: Date.now() }
	actionIssue.value = ''
	return operation.value
}

function applyFrozenDraft(draft = {}) {
	selectedIntakeCustomerId.value = normalizeCashierText(draft.customer_id)
	selectedIntakeCustomerName.value = normalizeCashierText(draft.customer_name)
	selectedIntakeMatchedDeliveryName.value = normalizeCashierText(draft.matched_delivery_name)
	selectedIntakeMoneyScale.value = normalizeCashierMoneyScale(draft.money_scale)
	intakeCustomerKeyword.value = selectedIntakeCustomerName.value
	editingIntakeId.value = draft.command === 'update' ? normalizeCashierText(draft.intake_id) : ''
	editingVersion.value = draft.command === 'update' ? Number(draft.expected_version || 0) : 0
	form.kind = normalizeCashierKind(draft.kind)
	form.amount = normalizeCashierMoney(draft.amount, normalizeCashierKind(draft.kind) === 'deposit' ? 2 : selectedIntakeMoneyScale.value)
	form.gasAmount = normalizeCashierKind(draft.kind) === 'mixed' ? normalizeCashierMoney(draft.gas_amount, selectedIntakeMoneyScale.value) : ''
	form.depositAmount = normalizeCashierKind(draft.kind) === 'mixed' ? normalizeCashierMoney(draft.deposit_amount, 2) : ''
	form.purpose = normalizeCashierPurpose(draft.purpose, draft.kind)
	form.bizDate = normalizeCashierText(draft.biz_date) || todayYmd()
	form.paymentMethod = normalizeCashierText(draft.payment_method)
	form.note = normalizeCashierText(draft.note)
	form.reason = normalizeCashierText(draft.reason)
	proofImages.value = normalizeProofItems(draft.proof_images)
}

function resetAmountsAndProofs() {
	Object.assign(form, { kind: 'gas', amount: '', gasAmount: '', depositAmount: '', purpose: 'unspecified', bizDate: todayYmd(), paymentMethod: 'cash', note: '', reason: '' })
	proofImages.value = []
	editingIntakeId.value = ''
	editingVersion.value = 0
}

function resetForm() {
	if (fieldsLocked.value) return
	clearOperation()
	resetAmountsAndProofs()
}

function cancelEditing() {
	if (fieldsLocked.value) return
	resetForm()
}

function discardPreparedOperation() {
	if (!canDiscardOperation.value) return
	const wasVoid = operation.value?.command === 'void'
	clearOperation()
	if (wasVoid) actionIssue.value = ''
}

function customerMatchesKeyword(row = {}, keyword = '') {
	const key = normalizeCashierText(keyword).toLowerCase()
	return key && [row?.name, row?.label, row?.phone].map((value) => normalizeCashierText(value).toLowerCase()).some((value) => value.includes(key))
}

function resolveMatchedDeliverySite(item = {}, keyword = '') {
	const sites = Array.isArray(item?.matched_delivery_sites) ? item.matched_delivery_sites : []
	if (!sites.length || customerMatchesKeyword(item, keyword)) return null
	const key = normalizeCashierText(keyword).toLowerCase()
	return sites.find((site) => normalizeCashierText(site?.name).toLowerCase().includes(key)) || sites[0] || null
}

function mapCustomerOptions(rowsValue = [], keyword = '') {
	return (Array.isArray(rowsValue) ? rowsValue : []).map((item) => {
		const matched = resolveMatchedDeliverySite(item, keyword)
		const name = normalizeCashierText(item?.name)
		const delivery = normalizeCashierText(matched?.name)
		return { value: normalizeCashierText(item?._id), name, phone: normalizeCashierText(item?.phone), matchedDeliveryName: delivery, settlementHint: delivery ? `匹配送达地点：${delivery}；收款归属：${name}` : '', moneyScale: customerMoneyScale(item) }
	}).filter((item) => item.value && item.name)
}

async function searchCustomersByKeyword(keyword) {
	const key = normalizeCashierText(keyword)
	if (!key) return []
	const result = await listCustomersV1({ keyword: key, page: 1, pageSize: CUSTOMER_SUGGEST_LIMIT, settlementOnly: true, includeSummary: false, includeDeposit: false })
	if (result?.code !== 0) throw new Error(result?.msg || '客户加载失败')
	return mapCustomerOptions(result.data, key)
}

function queueCustomerSearch(scope, keyword) {
	const timerRef = scope === 'filter' ? filterCustomerTimer : intakeCustomerTimer
	if (timerRef.value) clearTimeout(timerRef.value)
	timerRef.value = setTimeout(() => { void searchCustomerOptions(scope, keyword) }, CUSTOMER_SEARCH_DEBOUNCE_MS)
}

async function searchCustomerOptions(scope, keyword) {
	const key = normalizeCashierText(keyword)
	const loadingRef = scope === 'filter' ? filterCustomerLoading : intakeCustomerLoading
	const optionsRef = scope === 'filter' ? filterCustomerOptions : intakeCustomerOptions
	const keywordRef = scope === 'filter' ? filterCustomerKeyword : intakeCustomerKeyword
	const showRef = scope === 'filter' ? showFilterSuggestions : showIntakeSuggestions
	if (!key) return
	const serial = ++customerSearchSerial[scope]
	loadingRef.value = true
	try {
		const options = await searchCustomersByKeyword(key)
		if (serial !== customerSearchSerial[scope] || normalizeCashierText(keywordRef.value) !== key) return
		optionsRef.value = options
		showRef.value = true
	} catch (error) {
		if (serial !== customerSearchSerial[scope]) return
		optionsRef.value = []
		uni.showToast({ title: normalizeCashierText(error?.message) || '客户加载失败', icon: 'none' })
	} finally { if (serial === customerSearchSerial[scope]) loadingRef.value = false }
}

function onIntakeCustomerInput(value) {
	if (fieldsLocked.value) return
	intakeCustomerKeyword.value = normalizeCashierText(value)
	selectedIntakeCustomerId.value = ''
	selectedIntakeCustomerName.value = ''
	selectedIntakeMatchedDeliveryName.value = ''
	selectedIntakeMoneyScale.value = 2
	showIntakeSuggestions.value = Boolean(intakeCustomerKeyword.value)
	if (intakeCustomerKeyword.value) queueCustomerSearch('intake', intakeCustomerKeyword.value)
}

function onFilterCustomerInput(value) {
	filterCustomerKeyword.value = normalizeCashierText(value)
	selectedFilterCustomerId.value = ''
	selectedFilterCustomerName.value = ''
	selectedFilterMatchedDeliveryName.value = ''
	showFilterSuggestions.value = Boolean(filterCustomerKeyword.value)
	if (filterCustomerKeyword.value) queueCustomerSearch('filter', filterCustomerKeyword.value)
}

function onIntakeCustomerFocus() { if (intakeCustomerKeyword.value && !fieldsLocked.value) { showIntakeSuggestions.value = true; queueCustomerSearch('intake', intakeCustomerKeyword.value) } }
function onFilterCustomerFocus() { if (filterCustomerKeyword.value) { showFilterSuggestions.value = true; queueCustomerSearch('filter', filterCustomerKeyword.value) } }
function onIntakeCustomerConfirm() { if (intakeCustomerKeyword.value) queueCustomerSearch('intake', intakeCustomerKeyword.value) }
function onFilterCustomerConfirm() { if (filterCustomerKeyword.value) queueCustomerSearch('filter', filterCustomerKeyword.value) }
function onIntakeCustomerBlur() { setTimeout(() => { showIntakeSuggestions.value = false }, SUGGESTION_BLUR_DELAY_MS) }
function onFilterCustomerBlur() { setTimeout(() => { showFilterSuggestions.value = false }, SUGGESTION_BLUR_DELAY_MS) }

function guardSuggestionPick(scope, item) {
	const key = `${scope}:${normalizeCashierText(item?.value)}`
	const now = Date.now()
	if (!item?.value || (suggestionPickGuard.value.key === key && now < suggestionPickGuard.value.expiresAt)) return
	suggestionPickGuard.value = { key, expiresAt: now + SUGGESTION_PICK_GUARD_MS }
	if (scope === 'filter') { void pickFilterCustomer(item); return }
	pickIntakeCustomer(item)
}

function pickIntakeCustomer(item) {
	if (fieldsLocked.value) return
	selectedIntakeCustomerId.value = normalizeCashierText(item.value)
	selectedIntakeCustomerName.value = normalizeCashierText(item.name)
	selectedIntakeMatchedDeliveryName.value = normalizeCashierText(item.matchedDeliveryName)
	selectedIntakeMoneyScale.value = normalizeCashierMoneyScale(item.moneyScale)
	intakeCustomerKeyword.value = selectedIntakeCustomerName.value
	showIntakeSuggestions.value = false
}

async function pickFilterCustomer(item) {
	selectedFilterCustomerId.value = normalizeCashierText(item.value)
	selectedFilterCustomerName.value = normalizeCashierText(item.name)
	selectedFilterMatchedDeliveryName.value = normalizeCashierText(item.matchedDeliveryName)
	filterCustomerKeyword.value = selectedFilterCustomerName.value
	showFilterSuggestions.value = false
	await loadRows(true)
}

function clearIntakeCustomer() {
	if (fieldsLocked.value) return
	selectedIntakeCustomerId.value = ''
	selectedIntakeCustomerName.value = ''
	selectedIntakeMatchedDeliveryName.value = ''
	selectedIntakeMoneyScale.value = 2
	intakeCustomerKeyword.value = ''
	intakeCustomerOptions.value = []
}

function onBizDateChange(event) { if (!fieldsLocked.value) form.bizDate = normalizeCashierText(event?.detail?.value) || todayYmd() }
function onKindChange(event) { if (!fieldsLocked.value) { form.kind = kindOptions[Number(event?.detail?.value)]?.value || 'gas'; if (form.kind === 'deposit') form.purpose = 'unspecified' } }
function onPaymentMethodChange(event) { if (!fieldsLocked.value) form.paymentMethod = paymentMethodOptions[Number(event?.detail?.value)]?.value || 'cash' }
function onPurposeChange(event) { if (!fieldsLocked.value && form.kind !== 'deposit') form.purpose = purposeOptions[Number(event?.detail?.value)]?.value || 'unspecified' }
function onKindFilterChange(event) { listFilter.kind = kindFilterOptions[Number(event?.detail?.value)]?.value || '' }
function onPurposeFilterChange(event) { listFilter.purpose = purposeFilterOptions[Number(event?.detail?.value)]?.value || '' }

function extractChooseImagePaths(result = {}) {
	const paths = Array.isArray(result.tempFilePaths) ? result.tempFilePaths : []
	return paths.map(normalizeCashierText).filter(Boolean)
}

async function chooseProofImages() {
	if (fieldsLocked.value) return
	const remaining = PROOF_IMAGE_LIMIT - proofImages.value.length
	if (remaining <= 0) return
	await new Promise((resolve) => {
		uni.chooseImage({ count: remaining, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: (result) => {
			const selectedAt = Date.now().toString(36)
			const additions = extractChooseImagePaths(result).map((localPath, index) => ({ fileId: '', localPath, previewUrl: localPath, draftKey: `local:${selectedAt}:${index}:${localPath}` }))
			proofImages.value = normalizeProofItems([...proofImages.value, ...additions])
			resolve()
		}, fail: () => resolve() })
	})
}

function resolveProofPreview(item = {}) { return normalizeCashierText(item.previewUrl || item.localPath || item.fileId) }
function previewDraftProof(index) { const urls = proofImages.value.map(resolveProofPreview).filter(Boolean); if (urls.length) uni.previewImage({ urls, current: resolveProofPreview(proofImages.value[index]) || urls[0] }) }
function removeProofImage(index) { if (!fieldsLocked.value) proofImages.value = proofImages.value.filter((_, itemIndex) => itemIndex !== index) }

function uploadExtension(path) {
	const match = normalizeCashierText(path).match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)
	return match?.[1] ? `.${match[1].toLowerCase()}` : '.jpg'
}

function cloudFileIdFromResult(result) {
	const queue = [result]
	const seen = new Set()
	while (queue.length) {
		const value = queue.shift()
		if (value == null) continue
		if (typeof value === 'string') {
			const match = value.match(/cloud:\/\/[^\s"'`\\]+/)
			if (match?.[0]) return match[0]
			continue
		}
		if (typeof value !== 'object' || seen.has(value)) continue
		seen.add(value)
		if (Array.isArray(value)) queue.push(...value)
		else queue.push(...Object.values(value))
	}
	return ''
}

async function recoverCloudFileId(cloudPath) {
	const fileId = `cloud://env-00jxuffegf2n/${normalizeCashierText(cloudPath).replace(/^\/+/, '')}`
	try {
		const result = await uniCloud.getTempFileURL({ fileList: [fileId] })
		const hit = (Array.isArray(result?.fileList) ? result.fileList : []).find((item) => normalizeCashierText(item?.fileID || item?.fileId) === fileId)
		return hit && (Number(hit.code) === 0 || normalizeCashierText(hit.tempFileURL || hit.tempFileUrl)) ? fileId : ''
	} catch (_) { return '' }
}

async function uploadFrozenProof(op, item, index) {
	if (item.file_id) return item.file_id
	const localPath = normalizeCashierText(item.local_path)
	if (!localPath) throw new Error(`第${index + 1}张凭证的临时文件已失效，请重新选择`)
	const safeAccount = accountId().replace(/[^a-zA-Z0-9_-]/g, '_')
	const cloudPath = `cashier-receipt-proof/${safeAccount}/${op.operation_id}/${index + 1}${uploadExtension(localPath)}`
	try {
		const result = await uniCloud.uploadFile({ fileType: 'image', cloudPath, filePath: localPath })
		const fileId = cloudFileIdFromResult(result)
		if (fileId) return fileId
		const recovered = await recoverCloudFileId(cloudPath)
		if (recovered) return recovered
		throw new Error('上传回执缺少永久文件ID')
	} catch (error) {
		const recovered = await recoverCloudFileId(cloudPath)
		if (recovered) return recovered
		const message = normalizeCashierText(error?.errMsg || error?.message) || '上传失败'
		throw new Error(`第${index + 1}张凭证上传失败：${message}`)
	}
}

async function uploadFrozenProofs(op) {
	const items = Array.isArray(op.frozen_draft?.proof_images) ? op.frozen_draft.proof_images : []
	const fileIds = []
	for (let index = 0; index < items.length; index += 1) {
		const fileId = await uploadFrozenProof(op, items[index], index)
		items[index].file_id = fileId
		items[index].local_path = ''
		items[index].preview_url = fileId
		fileIds.push(fileId)
		proofImages.value = proofImages.value.map((proof) => proof.draftKey === items[index].draft_key ? { ...proof, fileId, previewUrl: proof.previewUrl || proof.localPath || fileId } : proof)
		persistOperation()
	}
	return fileIds
}

function buildPreviewPayload(op, proofFileIds = []) {
	const draft = op.frozen_draft || {}
	return {
		command: op.command, intake_id: normalizeCashierText(draft.intake_id), customer_id: normalizeCashierText(draft.customer_id), operation_id: op.operation_id,
		expected_version: Number(op.expected_version || 0), kind: normalizeCashierKind(draft.kind), amount: draft.amount, gas_amount: draft.gas_amount,
		deposit_amount: draft.deposit_amount, purpose: normalizeCashierPurpose(draft.purpose, draft.kind), biz_date: normalizeCashierText(draft.biz_date),
		payment_method: normalizeCashierText(draft.payment_method), proof_images: proofFileIds, note: normalizeCashierText(draft.note), reason: normalizeCashierText(draft.reason)
	}
}

async function previewCurrentOperation() {
	if (!canPreviewCurrent.value) return
	const checked = validateCurrentDraft()
	if (checked.error) { uni.showToast({ title: checked.error, icon: 'none' }); return }
	const op = ensureOperation(checked.draft)
	if (!op || !persistOperation()) return
	await previewFrozenOperation(op, true)
}

async function previewFrozenOperation(op, needsUpload) {
	actionLoading.value = true
	actionIssue.value = ''
	try {
		op.status = needsUpload ? 'uploading' : 'previewing'
		op.updated_at = Date.now()
		if (!persistOperation()) return
		const proofFileIds = needsUpload ? await uploadFrozenProofs(op) : (op.frozen_draft?.proof_images || []).map((item) => normalizeProofFileId(item)).filter(Boolean)
		op.input = buildPreviewPayload(op, proofFileIds)
		op.status = 'previewing'
		persistOperation()
		const result = await previewReceiptIntakeV2(op.input)
		if (operation.value !== op) return
		if (result?.data?.committed === true && committedResultMatches(op, result.data.result)) { await markCommitted(op, result.data.result); return }
		if (result?.data?.commit_status_unknown === true) { await markUnknownAndRecover(op); return }
		if (result?.code !== 0) { markExplicitRejection(op, result); return }
		const data = result.data || {}
		const submission = data.submission
		const hasSnapshot = submission && Object.prototype.hasOwnProperty.call(submission, 'expected_snapshot')
		if (!submission || normalizeCashierText(submission.operation_id) !== op.operation_id || Number(submission.expected_version) !== Number(op.expected_version) || !hasSnapshot) {
			op.status = 'rejected'
			actionIssue.value = '服务器预览缺少操作号、版本或快照，暂不能保存。'
			persistOperation()
			return
		}
		op.submission = deepClone(submission)
		op.before = deepClone(data.before)
		op.after = deepClone(data.after)
		op.status = 'previewed'
		op.updated_at = Date.now()
		actionIssue.value = '请核对预览后确认保存；保存将使用服务器准备的同一版本和快照。'
		persistOperation()
	} catch (error) {
		if (operation.value !== op) return
		op.status = 'rejected'
		actionIssue.value = normalizeCashierText(error?.message) || '预览未完成，可继续使用原操作号重试。'
		persistOperation()
	} finally { actionLoading.value = false }
}

function markExplicitRejection(op, result) {
	op.status = 'rejected'
	op.updated_at = Date.now()
	if (Number(result?.code) === 403 && op.command === 'create') {
		createAvailabilityKnown.value = true
		writeFeatureDisabled.value = true
		actionIssue.value = `登记功能暂未开放：${normalizeCashierText(result?.msg) || '服务器已关闭新保存'}。历史记录仍可查询和导出。`
	} else actionIssue.value = normalizeCashierText(result?.msg) || '服务器拒绝了本次操作，请核对后重试。'
	persistOperation()
}

function isTimeoutError(error) {
	return /timeout|timed out|超时/i.test(normalizeCashierText(error?.errMsg || error?.message))
}

function preparedWriteAllowed(op) {
	if (!op) return false
	return op.command === 'create'
		? canCreate.value && createAvailabilityKnown.value && !writeFeatureDisabled.value
		: op.command === 'void' ? canDelete.value : canUpdate.value
}

function committedResultMatches(op, result) {
	return normalizeCashierText(result?.status) === 'committed' && normalizeCashierText(result?.operation_id) === op.operation_id
		&& Boolean(normalizeCashierText(result?.intake_id)) && Number.isSafeInteger(result?.version) && result.version > 0
}

async function confirmPreparedOperation() {
	if (!canConfirmPrepared.value) return
	const op = operation.value
	const confirmed = await new Promise((resolve) => uni.showModal({ title: op.command === 'void' ? '确认作废登记' : '确认保存登记', content: previewSummaryText(op.after, op.command === 'void' ? '作废后保留留痕' : '请确认金额、客户和日期'), confirmText: op.command === 'void' ? '确认作废' : '确认保存', success: (result) => resolve(Boolean(result.confirm)), fail: () => resolve(false) }))
	if (!confirmed || operation.value !== op || !canConfirmPrepared.value) return
	await submitPreparedOperation(op)
}

async function submitPreparedOperation(op) {
	if (!op?.submission || operation.value !== op) return
	if (!preparedWriteAllowed(op)) { actionIssue.value = '新登记开关尚未启用或权限已变化；可继续查询原操作号。'; return }
	op.status = 'saving'
	op.updated_at = Date.now()
	if (!persistOperation()) { op.status = 'previewed'; return }
	actionLoading.value = true
	actionIssue.value = ''
	try {
		const submission = deepClone(op.submission)
		const result = op.command === 'void' ? await voidReceiptIntakeV2(submission) : await saveReceiptIntakeV2(submission)
		if (operation.value !== op) return
		if (result?.code === 0 && committedResultMatches(op, result.data)) { await markCommitted(op, result.data); return }
		if (result?.data?.commit_status_unknown === true || ![400, 401, 403, 409].includes(Number(result?.code))) { await markUnknownAndRecover(op); return }
		markExplicitRejection(op, result)
		if (Number(result?.code) === 409) void loadRows(true)
	} catch (error) {
		if (operation.value !== op) return
		if (isTimeoutError(error)) await markUnknownAndRecover(op)
		else {
			op.status = 'unknown'
			actionIssue.value = '保存调用中断，结果可能已写入。请先查询原操作号。'
			persistOperation()
		}
	} finally { actionLoading.value = false }
}

async function markUnknownAndRecover(op) {
	op.status = 'unknown'
	op.updated_at = Date.now()
	actionIssue.value = '保存结果未知，正在查询原操作号。'
	persistOperation()
	try { await recoverOperation(op) } catch (_) { if (operation.value === op) actionIssue.value = '保存结果仍未确认。请保留本次内容并继续查询原操作号。' }
}

async function recoverOperation(op) {
	const result = await getReceiptIntakeOperationV2({ operation_id: op.operation_id })
	if (operation.value !== op) return
	if (result?.code !== 0) {
		actionIssue.value = normalizeCashierText(result?.msg) || '保存结果查询未完成，请继续查询。'
		persistOperation()
		return
	}
	const data = result.data || {}
	if (data.found === true && committedResultMatches(op, data.result)) { await markCommitted(op, data.result); return }
	if (data.found === false) {
		if (op.submission) {
			op.status = 'retryable'
			actionIssue.value = '未找到已保存结果。现在可用冻结的服务器提交内容和原操作号安全重试。'
		} else {
			op.status = 'rejected'
			actionIssue.value = '未找到已保存结果，请使用原操作号重新生成预览。'
		}
		persistOperation()
		return
	}
	actionIssue.value = '操作查询返回不完整，请继续查询原操作号。'
	persistOperation()
}

async function querySavedOperation() {
	const op = operation.value
	if (!op || queryLoading.value || writeBusy.value) return
	queryLoading.value = true
	try { await recoverOperation(op) } catch (_) { if (operation.value === op) actionIssue.value = '保存结果查询失败，请继续使用原操作号查询。' }
	finally { queryLoading.value = false }
}

async function retryPreparedOperation() {
	const op = operation.value
	if (op?.status !== 'retryable' || !op.submission) return
	await submitPreparedOperation(op)
}

async function markCommitted(op, result) {
	if (operation.value !== op) return
	op.status = 'saved'
	op.result = deepClone(result)
	persistOperation()
	const command = op.command
	const savedIntakeId = normalizeCashierText(result?.intake_id)
	clearOperation()
	if (editingIntakeId.value && (!savedIntakeId || savedIntakeId === editingIntakeId.value)) resetAmountsAndProofs()
	else if (command !== 'void') resetAmountsAndProofs()
	uni.showToast({ title: command === 'void' ? '已作废' : '登记已保存', icon: 'success' })
	void loadRows(true, { afterCommit: true })
}

function rowIntakeId(row = {}) {
	const direct = normalizeCashierText(row.intake_id)
	if (direct) return direct
	const id = normalizeCashierText(row._id)
	return row.legacy && id ? `legacy:${id}` : id
}

function rowAmountScale(row = {}) { return normalizeCashierKind(row.kind) === 'deposit' ? 2 : normalizeCashierMoneyScale(row.money_scale) }
function moneyText(value, scale = 2) { return normalizeCashierMoney(value, normalizeCashierMoneyScale(scale)) || '待核' }
function kindText(value) { const kind = normalizeCashierKind(value); return kind === 'deposit' ? '押金' : (kind === 'mixed' ? '气款+押金' : '气款') }
function purposeText(value, kind) { const purpose = normalizeCashierPurpose(value, kind); return purpose === 'prepay' ? '预付' : (purpose === 'settlement' ? '结账' : purpose === 'unspecified' ? '未注明' : '用途待核') }
function paymentMethodText(value) { const text = normalizeCashierText(value).toLowerCase(); return paymentMethodOptions.find((item) => item.value === text)?.label || (text === 'unknown' || !text ? '渠道待核' : normalizeCashierText(value)) }
function sourceText(row = {}) { const explicit = normalizeCashierText(row.source_text || row.source); return explicit === 'cashier_intake' ? '出纳登记' : (explicit || (row.legacy ? '历史收款' : '出纳登记')) }
function rowStatusText(row = {}) { return normalizeCashierText(row.status) === 'void' ? '已作废' : (normalizeCashierText(row.allocation_status_text) || normalizeCashierText(row.allocation_status) || '待分配') }
function rowStatusKind(row = {}) { if (normalizeCashierText(row.status) === 'void') return 'danger'; const value = normalizeCashierText(row.allocation_status); return value === 'allocated' ? 'success' : (value === 'partial' ? 'warning' : 'info') }

function previewSummaryText(value, fallback = '') {
	if (!value) return fallback
	if (typeof value === 'string') return value
	const parts = []
	if (value.customer_name) parts.push(normalizeCashierText(value.customer_name))
	if (value.biz_date) parts.push(normalizeCashierText(value.biz_date))
	if (value.kind) parts.push(kindText(value.kind))
	if (value.amount != null) parts.push(`合计 ¥${normalizeCashierMoney(value.amount, value.kind === 'deposit' ? 2 : normalizeCashierMoneyScale(value.money_scale)) || value.amount}`)
	if (value.gas_amount != null) parts.push(`气款 ¥${normalizeCashierMoney(value.gas_amount, normalizeCashierMoneyScale(value.money_scale)) || value.gas_amount}`)
	if (value.deposit_amount != null) parts.push(`押金 ¥${normalizeCashierMoney(value.deposit_amount, 2) || value.deposit_amount}`)
	if (value.status) parts.push(normalizeCashierText(value.status) === 'void' ? '已作废' : normalizeCashierText(value.status))
	return parts.join(' · ') || fallback
}

function depositEntryId(entry = {}) {
	return normalizeCashierText(entry._id || entry.entry_id || entry.deposit_entry_id)
}

function linkedDepositHistory(entries = [], row = {}) {
	const linkedId = normalizeCashierText(row.deposit_entry_id)
	if (!linkedId) return []
	const list = Array.isArray(entries) ? entries : []
	const original = list.find((entry) => depositEntryId(entry) === linkedId)
	if (!original) return []
	const originalVersion = Number(original.account_version)
	return list.filter((entry) => {
		if (depositEntryId(entry) === linkedId) return true
		const version = Number(entry?.account_version)
		return Number.isSafeInteger(originalVersion) && Number.isSafeInteger(version) && version > originalVersion
	}).sort((left, right) => Number(left?.account_version || 0) - Number(right?.account_version || 0) || normalizeCashierText(left?.biz_date).localeCompare(normalizeCashierText(right?.biz_date)) || depositEntryId(left).localeCompare(depositEntryId(right)))
}

function settleStaleDetailRequest(intakeId, requestId, previousData = null) {
	if (detailMap.value[intakeId]?.request_id !== requestId) return
	detailMap.value = { ...detailMap.value, [intakeId]: { loading: false, error: '', data: previousData } }
}

async function ensureDetail(row, force = false) {
	const intakeId = rowIntakeId(row)
	if (!intakeId) return null
	const existing = detailMap.value[intakeId]
	if (!force && existing?.data) return existing.data
	if (existing?.loading) return null
	const generation = detailGeneration
	const requestAccountId = accountId()
	const requestId = ++detailRequestSerial
	const previousData = existing?.data || null
	detailMap.value = { ...detailMap.value, [intakeId]: { loading: true, error: '', data: previousData, request_id: requestId } }
	try {
		const result = await getReceiptIntakeDetailV2({ intake_id: intakeId })
		if (generation !== detailGeneration || requestAccountId !== accountId()) { settleStaleDetailRequest(intakeId, requestId, previousData); return null }
		if (result?.code !== 0) throw new Error(result?.msg || '详情加载失败')
		const raw = result.data || {}
		if (!raw.row || typeof raw.row !== 'object' || Array.isArray(raw.row)) throw new Error('详情缺少权威到账记录')
		const authoritativeRow = raw.row
		if (rowIntakeId(authoritativeRow) !== intakeId) throw new Error('详情到账编号与请求不一致')
		const data = {
			row: authoritativeRow,
			receipt: raw.receipt || null,
			proof_images: normalizeProofItems(raw.proof_images || []),
			allocation_targets: Array.isArray(raw.allocation_targets) ? raw.allocation_targets : [],
			deposit_entries: linkedDepositHistory(raw.deposit_entries, authoritativeRow)
		}
		if (detailMap.value[intakeId]?.request_id !== requestId) return null
		detailMap.value = { ...detailMap.value, [intakeId]: { loading: false, error: '', data, request_id: requestId } }
		return data
	} catch (error) {
		if (generation !== detailGeneration || requestAccountId !== accountId()) { settleStaleDetailRequest(intakeId, requestId, previousData); return null }
		if (detailMap.value[intakeId]?.request_id === requestId) detailMap.value = { ...detailMap.value, [intakeId]: { loading: false, error: normalizeCashierText(error?.message) || '详情加载失败', data: null, request_id: requestId } }
		return null
	}
}

function detailState(row) { return detailMap.value[rowIntakeId(row)] || { loading: false, error: '', data: null } }
function detailAuthorizationLoaded(row) { return Boolean(detailState(row).data?.row) }
function authoritativeDetailRow(row) { return detailState(row).data?.row || row || {} }
function rowEditable(row) { return Boolean(authoritativeDetailRow(row).editable) }
function rowRemovable(row) { return Boolean(authoritativeDetailRow(row).removable) }
function rowRestrictionReason(row) { return normalizeCashierText(authoritativeDetailRow(row).restriction_reason) }
function isDetailExpanded(row) { return expandedDetails.value.includes(rowIntakeId(row)) }
async function toggleDetail(row) { const id = rowIntakeId(row); if (!id) return; if (isDetailExpanded(row)) { expandedDetails.value = expandedDetails.value.filter((item) => item !== id); return } expandedDetails.value = [...expandedDetails.value, id]; await ensureDetail(row) }

async function resolveProofUrls(items = []) {
	const fileIds = normalizeProofItems(items).map((item) => item.fileId).filter(Boolean)
	if (!fileIds.length) return []
	try {
		const result = await uniCloud.getTempFileURL({ fileList: fileIds })
		const map = new Map((Array.isArray(result?.fileList) ? result.fileList : []).map((item) => [normalizeCashierText(item.fileID || item.fileId), normalizeCashierText(item.tempFileURL || item.tempFileUrl)]))
		return fileIds.map((id) => map.get(id) || id)
	} catch (_) { return fileIds }
}

async function previewRowProofs(row) {
	const detail = await ensureDetail(row)
	const urls = await resolveProofUrls(detail?.proof_images || [])
	if (!urls.length) { uni.showToast({ title: '未读取到可预览凭证', icon: 'none' }); return }
	uni.previewImage({ urls, current: urls[0] })
}

function allocationTargetText(target = {}, scale = 2) { return `${normalizeCashierText(target.target_date || target.biz_date) || '日期待核'} · ${normalizeCashierText(target.target_name || target.target_type_label || target.target_type) || '分配目标'} · ¥${moneyText(target.amount, scale)}` }
function depositEntryText(entry = {}) { return `${normalizeCashierText(entry.biz_date) || '日期待核'} · ${normalizeCashierText(entry.kind_text || entry.kind) || '押金记录'} · ¥${moneyText(entry.amount, 2)}` }

async function onEdit(row) {
	if (!canUpdate.value || fieldsLocked.value) return
	const intent = ++rowActionSerial, actor = accountId(), previousOperation = operation.value
	const detail = await ensureDetail(row, true)
	if (!detail || intent !== rowActionSerial || actor !== accountId() || operation.value !== previousOperation || fieldsLocked.value) return
	const receipt = detail.row || row
	if (!receipt.editable) { uni.showToast({ title: normalizeCashierText(receipt.restriction_reason) || '该登记不能编辑', icon: 'none' }); return }
	clearOperation()
	const scale = normalizeCashierMoneyScale(receipt.money_scale)
	selectedIntakeCustomerId.value = normalizeCashierText(receipt.customer_id)
	selectedIntakeCustomerName.value = normalizeCashierText(receipt.customer_name)
	selectedIntakeMatchedDeliveryName.value = ''
	selectedIntakeMoneyScale.value = scale
	intakeCustomerKeyword.value = selectedIntakeCustomerName.value
	editingIntakeId.value = rowIntakeId(receipt)
	editingVersion.value = Number(receipt.version || 0)
	form.kind = normalizeCashierKind(receipt.kind)
	form.amount = normalizeCashierMoney(receipt.amount, form.kind === 'deposit' ? 2 : scale)
	form.gasAmount = form.kind === 'mixed' ? normalizeCashierMoney(receipt.gas_amount, scale) : ''
	form.depositAmount = form.kind === 'mixed' ? normalizeCashierMoney(receipt.deposit_amount, 2) : ''
	form.purpose = normalizeCashierPurpose(receipt.purpose, receipt.kind)
	form.bizDate = normalizeCashierText(receipt.biz_date) || todayYmd()
	form.paymentMethod = normalizeCashierText(receipt.payment_method)
	form.note = normalizeCashierText(receipt.note)
	form.reason = ''
	proofImages.value = normalizeProofItems(detail.proof_images)
	uni.pageScrollTo?.({ scrollTop: 0, duration: 200 })
	uni.showToast({ title: '已加载完整登记，请填写修改原因', icon: 'none' })
}

async function chooseVoidReason() {
	return new Promise((resolve) => uni.showActionSheet({ itemList: VOID_REASON_OPTIONS, success: (result) => resolve(VOID_REASON_OPTIONS[Number(result.tapIndex)] || ''), fail: () => resolve('') }))
}

async function onBeginVoid(row) {
	if (!canDelete.value || fieldsLocked.value) return
	const intent = ++rowActionSerial, actor = accountId(), previousOperation = operation.value, generation = detailGeneration
	const detail = await ensureDetail(row, true)
	if (!detail || intent !== rowActionSerial || actor !== accountId() || operation.value !== previousOperation || fieldsLocked.value) return
	const receipt = detail.row || row
	if (!receipt.removable) { uni.showToast({ title: normalizeCashierText(receipt.restriction_reason) || '该登记不能作废', icon: 'none' }); return }
	const reason = normalizeCashierText(await chooseVoidReason())
	if (!reason || intent !== rowActionSerial || actor !== accountId() || generation !== detailGeneration || operation.value !== previousOperation || fieldsLocked.value) return
	const scale = normalizeCashierMoneyScale(receipt.money_scale)
	const draft = {
		command: 'void', intake_id: rowIntakeId(receipt), customer_id: normalizeCashierText(receipt.customer_id), customer_name: normalizeCashierText(receipt.customer_name),
		expected_version: Number(receipt.version || 0), money_scale: scale, kind: normalizeCashierKind(receipt.kind),
		amount: normalizeCashierMoney(receipt.amount, rowAmountScale(receipt)), gas_amount: normalizeCashierMoney(receipt.gas_amount, scale), deposit_amount: normalizeCashierMoney(receipt.deposit_amount, 2),
		purpose: normalizeCashierPurpose(receipt.purpose, receipt.kind), biz_date: normalizeCashierText(receipt.biz_date), payment_method: normalizeCashierText(receipt.payment_method),
		proof_images: normalizeProofItems(detail.proof_images).map((item) => ({ file_id: item.fileId, draft_key: item.draftKey })), note: normalizeCashierText(receipt.note), reason
	}
	const op = ensureOperation(draft)
	if (!op || !persistOperation()) return
	await previewFrozenOperation(op, false)
}

function currentListParams() {
	return { customer_id: selectedFilterCustomerId.value, date_from: listFilter.dateFrom, date_to: listFilter.dateTo, include_void: listFilter.includeVoid, kind: listFilter.kind, purpose: listFilter.purpose }
}

let rowsRequestSerial = 0
function clonePagerState() { return { ...pager, cursorStack: [...pager.cursorStack] } }
function restorePagerState(value) { Object.assign(pager, value, { cursorStack: [...(value?.cursorStack || [])] }) }
function rowsLoadFailureMessage(message, afterCommit) {
	const detail = normalizeCashierText(message) || '收款登记加载失败'
	return afterCommit ? `操作已保存，但列表刷新失败：${detail}` : detail
}

async function loadRows(reset = false, options = {}) {
	if (!canView.value) return false
	const previousPager = clonePagerState()
	detailGeneration += 1
	if (reset) {
		Object.assign(pager, { page: 1, total: 0, hasMore: false, cursor: '', nextCursor: null, snapshot: null, cursorStack: [] })
		createAvailabilityKnown.value = false
		writeFeatureDisabled.value = true
	}
	const serial = ++rowsRequestSerial
	rowsLoading.value = true
	try {
		const result = await listReceiptIntakeV2({ ...currentListParams(), cursor: pager.cursor, page_size: pager.pageSize })
		if (serial !== rowsRequestSerial) return false
		if (result?.code !== 0) {
			restorePagerState(previousPager)
			uni.showToast({ title: rowsLoadFailureMessage(result?.msg, options.afterCommit), icon: 'none', duration: options.afterCommit ? 3000 : 1500 })
			return false
		}
		rows.value = Array.isArray(result.data) ? result.data : []
		const paging = result.paging || {}
		pager.total = Number.isInteger(Number(paging.total)) ? Number(paging.total) : rows.value.length
		pager.pageSize = Number(paging.pageSize || pager.pageSize || 20)
		pager.hasMore = Boolean(paging.hasMore)
		pager.nextCursor = paging.next_cursor ?? null
		pager.snapshot = paging.snapshot ?? pager.snapshot
		createAvailabilityKnown.value = true
		writeFeatureDisabled.value = paging.create_enabled !== true
		const visibleIds = new Set(rows.value.map(rowIntakeId).filter(Boolean))
		const retainedDetails = { ...detailMap.value }
		for (const id of visibleIds) delete retainedDetails[id]
		detailMap.value = retainedDetails
		expandedDetails.value = []
		return true
	} catch (error) {
		if (serial === rowsRequestSerial) {
			restorePagerState(previousPager)
			uni.showToast({ title: rowsLoadFailureMessage(error?.message, options.afterCommit), icon: 'none', duration: options.afterCommit ? 3000 : 1500 })
		}
		return false
	} finally { if (serial === rowsRequestSerial) rowsLoading.value = false }
}

async function onNextPage() {
	if (!pager.hasMore || pager.nextCursor == null || rowsLoading.value) return
	const before = clonePagerState()
	const previous = pager.cursor
	pager.cursorStack.push(previous)
	pager.cursor = pager.nextCursor
	pager.page += 1
	const attemptedCursor = pager.cursor
	if (!await loadRows(false) && pager.cursor === attemptedCursor) restorePagerState(before)
}

async function onPrevPage() {
	if (!pager.cursorStack.length || rowsLoading.value) return
	const before = clonePagerState()
	pager.cursor = pager.cursorStack.pop()
	pager.page = Math.max(pager.page - 1, 1)
	const attemptedCursor = pager.cursor
	if (!await loadRows(false) && pager.cursor === attemptedCursor) restorePagerState(before)
}

async function applyFilters() { await loadRows(true) }
async function toggleIncludeVoided() { listFilter.includeVoid = !listFilter.includeVoid; await loadRows(true) }
async function clearFilters() { selectedFilterCustomerId.value = ''; selectedFilterCustomerName.value = ''; selectedFilterMatchedDeliveryName.value = ''; filterCustomerKeyword.value = ''; filterCustomerOptions.value = []; Object.assign(listFilter, { dateFrom: '', dateTo: '', kind: '', purpose: '', includeVoid: false }); await loadRows(true) }

function exportFilterKey(value = currentListParams()) { return JSON.stringify(value) }
async function onExport() {
	if (exporting.value) return
	const filter = { ...currentListParams(), include_void: true, customer_label: selectedFilterCustomerName.value || '全部客户' }
	const filterKey = exportFilterKey(filter)
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const exportRows = await collectCashierReceiptIntakeExportRows((params) => listReceiptIntakeV2(params), filter, { page_size: 100, is_current: () => exportFilterKey({ ...currentListParams(), include_void: true, customer_label: selectedFilterCustomerName.value || '全部客户' }) === filterKey })
		if (!exportRows.length) { uni.showToast({ title: '没有可导出的数据', icon: 'none' }); return }
		const workbook = buildCashierReceiptIntakeWorkbookXml({ rows: exportRows, filter })
		const downloaded = await downloadWorkbookFile(workbook, buildCashierReceiptIntakeExportFileName({ total: exportRows.length, filter }))
		if (!downloaded) throw new Error('当前平台未完成文件下载')
		uni.showToast({ title: `已导出${exportRows.length}条`, icon: 'success' })
	} catch (error) { uni.showToast({ title: normalizeCashierText(error?.message) || '导出失败', icon: 'none', duration: 3000 }) }
	finally { uni.hideLoading(); exporting.value = false }
}

async function refreshAll() { await loadRows(true) }

onShow(() => {
	if (!initialized) { initialized = true; restoreOperation() }
	void loadRows(true)
})
</script>

<style scoped>
.cashier-wrap { display: flex; flex-direction: column; gap: var(--crm-gap-lg); }
.cashier-wrap :deep(.section), .cashier-wrap :deep(.section__body) { overflow: visible; }
.feature-note { margin-bottom: 16rpx; padding: 16rpx 20rpx; border: 1rpx solid #f59e0b; border-radius: var(--crm-radius-sm); background: #fffbeb; color: #92400e; font-size: 23rpx; }
.operation-card, .preview-card { margin-bottom: 20rpx; padding: 20rpx; border: 1rpx solid #bfdbfe; border-radius: var(--crm-radius-sm); background: #eff6ff; display: flex; gap: 16rpx; justify-content: space-between; align-items: center; }
.operation-card--warning { border-color: #f59e0b; background: #fffbeb; }
.operation-card--danger { border-color: #fecaca; background: #fef2f2; }
.operation-card__content, .preview-card { flex-direction: column; align-items: stretch; }
.operation-card__content { display: flex; flex-direction: column; gap: 6rpx; min-width: 0; }
.operation-card__title, .preview-card__title { font-size: 26rpx; font-weight: 700; color: var(--crm-text); }
.operation-card__meta, .operation-card__message, .preview-card__line { font-size: 22rpx; color: var(--crm-text-muted); overflow-wrap: anywhere; }
.operation-card__actions, .form-actions, .pager-actions, .row-actions { display: flex; gap: 10rpx; flex-wrap: wrap; justify-content: flex-end; }
.preview-card__warning, .row-detail--warning { color: #b45309; font-weight: 600; }
.intake-main-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16rpx; align-items: end; overflow: visible; }
.intake-customer { grid-column: span 2; }
.form-item { display: flex; flex-direction: column; overflow: visible; }
.customer-field { position: relative; }
.field-popover-open { z-index: 120; }
.suggestions { position: absolute; top: calc(100% + 8rpx); left: 0; right: 0; z-index: 80; border: 1rpx solid var(--crm-border); border-radius: var(--crm-radius-sm); background: #fff; box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.08); overflow: hidden; }
.suggestions--scroll { height: 320rpx; }
.suggest-list { padding-bottom: 8rpx; }
.suggest-item { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 16rpx; border-bottom: 1rpx solid #f1f5f9; }
.suggest-info { display: flex; flex-direction: column; gap: 4rpx; min-width: 0; }
.suggest-name { font-size: 24rpx; font-weight: 700; color: var(--crm-text); }
.suggest-sub, .suggest-empty { font-size: 20rpx; color: var(--crm-text-muted); }
.suggest-sub--settlement { color: #0f766e; font-weight: 600; }
.suggest-empty { padding: 32rpx; text-align: center; }
.picker-block { display: block; }
.picker-row { margin-top: 16rpx; display: flex; align-items: center; justify-content: space-between; gap: 12rpx; flex-wrap: wrap; }
.picker-row__text-group { display: flex; flex-direction: column; gap: 4rpx; flex: 1; min-width: 0; }
.picker-row__text, .picker-row__hint { font-size: 22rpx; color: var(--crm-text-muted); }
.picker-row__hint { color: #0f766e; font-weight: 600; }
.picker-row__total { font-size: 24rpx; color: var(--crm-text); font-weight: 700; }
.proof-card { margin-top: 16rpx; padding: 18rpx; border-radius: var(--crm-radius-sm); border: 1rpx solid var(--crm-border); background: #fff; display: flex; flex-direction: column; gap: 14rpx; }
.proof-card__header { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.proof-card__meta { display: flex; flex-direction: column; gap: 4rpx; }
.proof-card__title { font-size: 26rpx; font-weight: 700; color: var(--crm-text); }
.proof-card__hint, .proof-item__status { font-size: 22rpx; color: var(--crm-text-muted); }
.proof-card__empty { padding: 20rpx; border-radius: 10rpx; background: #f8fafc; border: 1rpx dashed #cbd5e1; display: flex; flex-direction: column; gap: 8rpx; }
.proof-card__empty-title { font-size: 24rpx; font-weight: 600; color: var(--crm-text); }
.proof-card__empty-text { font-size: 22rpx; color: var(--crm-text-muted); }
.proof-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12rpx; }
.proof-item { border: 1rpx solid var(--crm-border); border-radius: 10rpx; padding: 10rpx; display: flex; flex-direction: column; gap: 10rpx; background: #fff; }
.proof-item__image { width: 100%; height: 180rpx; border-radius: 8rpx; background: #f1f5f9; }
.proof-item__actions { display: flex; flex-wrap: wrap; gap: 8rpx; align-items: center; }
.form-actions { margin-top: 16rpx; }
.section-hint { display: block; font-size: 22rpx; color: var(--crm-text-muted); }
.recent-filter-inline { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16rpx; align-items: end; }
.filter-customer { grid-column: span 2; }
.list-actions, .cursor-footer { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin: 16rpx 0 12rpx; }
.mini-amounts { display: flex; flex-direction: column; gap: 6rpx; align-items: flex-end; font-size: 22rpx; color: var(--crm-text-muted); }
.row-summary, .detail-panel { display: flex; flex-direction: column; gap: 7rpx; }
.detail-panel { margin-top: 14rpx; padding: 16rpx; background: #f8fafc; border-radius: 10rpx; }
.detail-title { margin-top: 6rpx; font-size: 23rpx; font-weight: 700; color: var(--crm-text); }
.row-detail { font-size: 23rpx; color: var(--crm-text-secondary); }
.row-detail--muted { color: var(--crm-text-muted); }

@media (max-width: 900px) {
	.intake-main-grid, .recent-filter-inline { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.intake-customer, .filter-customer { grid-column: span 2; }
}
@media (max-width: 640px) {
	.intake-main-grid, .recent-filter-inline { grid-template-columns: minmax(0, 1fr); }
	.intake-customer, .filter-customer { grid-column: span 1; }
	.proof-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.operation-card, .proof-card__header, .list-actions, .cursor-footer { flex-direction: column; align-items: stretch; }
	.mini-amounts { align-items: flex-start; }
}
</style>
