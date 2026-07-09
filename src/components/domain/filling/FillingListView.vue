<template>
		<AppPage title="灌装记录" :subtitle="subtitle" icon="bottle">
			<template #headerActions>
				<AppButton v-if="canCreateFilling" size="sm" kind="primary" icon="plus" @click="onAdd">单条灌装</AppButton>
				<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="loading" @click="onExport">导出</AppButton>
				<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch(false, { force: true })">刷新</AppButton>
			</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="筛选结果"
					:value="summary.total"
					hint="条"
					icon="bottle"
				/>
				<AppStatCard
					class="summary-card"
					label="常规灌装净重"
					:value="normalFillWeightText"
					:hint="normalFillCountHint"
					icon="plus"
				/>
				<AppStatCard
					class="summary-card"
					label="代理销售净重"
					:value="truckOutAgentSaleWeightText"
					:hint="truckOutAgentSaleCountHint"
					icon="truck"
				/>
				<AppStatCard
					class="summary-card"
					label="车辆燃气净重"
					:value="truckOutNoSaleWeightText"
					:hint="truckOutNoSaleCountHint"
					icon="list"
				/>
			</view>
		</template>

			<view class="list-shell">
				<view class="quick-date-strip">
					<AppDatePresetBar v-model="datePreset" :items="fillingDatePresetItems" @update:modelValue="onDatePresetChange" />
				</view>
				<AppSection class="filter-section" title="查询条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true, { force: true })">查询</AppButton>
				</template>

					<view class="filter-grid">
						<view class="filter-bottle-wrap">
							<AppInput
								v-model="filters.bottle_no"
								label="瓶号"
								placeholder="输入瓶号联想钢瓶档案"
								prefix-icon="search"
								size="sm"
								confirm-type="search"
								@input="onFilterBottleInput"
								@focus="onFilterBottleFocus"
								@blur="onFilterBottleBlur"
								@confirm="onFilterBottleConfirm"
							/>
							<view v-if="filterBottleSuggestions.length" class="filter-suggestions">
								<view
									v-for="item in filterBottleSuggestions"
									:key="`filter-${item._id || item.bottle_no}`"
									class="filter-suggestion-item"
									@click.stop="selectFilterBottleSuggestion(item)"
									@tap.stop="selectFilterBottleSuggestion(item)"
								>
									<text class="filter-suggestion-no">{{ item.bottle_no }}</text>
									<text class="filter-suggestion-sub">{{ formatBottleSuggestionSub(item) }}</text>
								</view>
							</view>
						</view>
						<view class="filter-operator-wrap">
							<AppInput
								v-model="filters.operator"
								label="操作人"
								placeholder="输入操作人联想配送员"
								prefix-icon="search"
								size="sm"
								confirm-type="search"
								@input="onFilterOperatorInput"
								@focus="onFilterOperatorFocus"
								@blur="onFilterOperatorBlur"
								@confirm="onFilterOperatorConfirm"
							/>
							<view v-if="filterOperatorSuggestions.length" class="filter-suggestions">
								<view
									v-for="item in filterOperatorSuggestions"
									:key="`operator-${item.id || item._id || item.name}`"
									class="filter-suggestion-item"
									@click.stop="selectFilterOperatorSuggestion(item)"
									@tap.stop="selectFilterOperatorSuggestion(item)"
								>
									<text class="filter-suggestion-no">{{ item.name || item.label }}</text>
								</view>
							</view>
						</view>
						<picker class="picker-block" mode="selector" :range="recordTypeFilterOptions" range-key="label" @change="onRecordTypeFilterChange">
							<AppInput :model-value="recordTypeFilterLabel" label="作业类型" placeholder="选择作业类型" prefix-icon="list" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="selector" :range="saleStateFilterOptions" range-key="label" @change="onSaleStateFilterChange">
							<AppInput :model-value="saleStateFilterLabel" label="销售状态" placeholder="选择销售状态" prefix-icon="list" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="date" @change="onFilterDateStartChange">
							<AppInput v-model="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="date" @change="onFilterDateEndChange">
							<AppInput v-model="filters.dateEnd" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
				</view>

					<view v-if="filterChips.length" class="filter-chips">
						<view v-for="chip in filterChips" :key="chip.key" class="filter-chip" @click="clearFilterChip(chip.key)">
							<text class="filter-chip__label">{{ chip.label }}</text>
							<text class="filter-chip__close">×</text>
						</view>
					</view>
					</AppSection>

					<view v-if="canCreateFilling" id="single-filling-section">
						<AppSection class="single-create-section" title="单条灌装">
						<template #actions>
							<AppButton size="sm" kind="neutral" @click="toggleSingleCreatePanel">
								{{ singleCreatePanelOpen ? '收起' : '展开' }}
							</AppButton>
							<AppButton size="sm" kind="ghost" @click="onSingleCreateReset">清空</AppButton>
							<AppButton size="sm" kind="primary" :loading="singleCreateSubmitting" @click="onSingleCreateSubmit">保存</AppButton>
						</template>

						<view v-if="singleCreatePanelOpen">
							<view class="mode-toggle">
								<text class="mode-toggle__label">录入模式</text>
								<view class="mode-toggle__actions">
									<AppButton
										v-for="item in singleFillingInputModeOptions"
										:key="`single-mode-${item.value}`"
										size="sm"
										:kind="singleCreateInputMode === item.value ? 'primary' : 'neutral'"
										@click="onSingleCreateInputModeChange(item.value)"
									>
										{{ item.label }}
									</AppButton>
								</view>
							</view>

							<view class="single-grid">
								<picker class="picker-block" mode="date" :value="singleCreateForm.date" @change="onSingleCreateDateChange">
									<AppInput :model-value="singleCreateForm.date" label="灌装日期" placeholder="请选择日期" disabled prefix-icon="calendar" size="sm" />
								</picker>
								<picker class="picker-block" mode="selector" :range="recordTypeCreateOptions" range-key="label" @change="onSingleCreateRecordTypeChange">
									<AppInput :model-value="singleCreateRecordTypeLabel" label="作业类型" placeholder="请选择作业类型" disabled prefix-icon="list" size="sm" />
								</picker>
								<view class="single-bottle-wrap">
									<AppInput
											v-model="singleCreateForm.bottle_no"
											:focus="singleCreateBottleFocusFlag"
											:label="singleCreateBottleLabel"
											:placeholder="singleCreateBottlePlaceholder"
											prefix-icon="bottle"
											size="sm"
											confirm-type="done"
										@input="onSingleCreateBottleInput"
										@focus="onSingleCreateBottleFocus"
										@blur="onSingleCreateBottleBlur"
										@confirm="onSingleCreateBottleConfirm"
									/>
									<view v-if="singleCreateBottleSuggestions.length" class="single-suggestions">
										<view
											v-for="item in singleCreateBottleSuggestions"
											:key="item._id || item.bottle_no || item.plate_no"
											class="single-suggestion-item"
											@click.stop="selectSingleCreateBottleSuggestion(item)"
											@tap.stop="selectSingleCreateBottleSuggestion(item)"
										>
											<text class="single-suggestion-no">{{ getSingleCreateSuggestionNo(item) }}</text>
											<text class="single-suggestion-sub">{{ formatBottleSuggestionSub(item) }}</text>
										</view>
									</view>
								</view>
								<AppInput
									v-if="singleCreateInputMode === 'after_fill_total'"
									v-model="singleCreateForm.after_fill_total_weight"
									:label="singleCreateWeightLabel"
									:placeholder="singleCreateWeightPlaceholder"
									size="sm"
								/>
								<AppInput
									v-else
									v-model="singleCreateForm.fill_weight"
									:label="singleCreateWeightLabel"
									:placeholder="singleCreateWeightPlaceholder"
									size="sm"
								/>
								<picker class="picker-block" mode="selector" :range="operatorCreateOptions" range-key="label" @change="onSingleCreateOperatorChange">
									<AppInput :model-value="singleCreateOperatorLabel" label="操作人" placeholder="请选择操作人" disabled prefix-icon="user" size="sm" />
								</picker>
									<AppInput v-model="singleCreateForm.remark" label="备注" placeholder="可选" size="sm" />
								</view>
								<text class="batch-hint">{{ singleCreateBottleHint }}</text>
								<view v-if="singleCreateInputMode === 'after_fill_total'" class="resolve-box">
									<view class="resolve-head">
										<text class="resolve-title">推导结果</text>
										<AppTag :kind="singleCreateResolveStatusKind">{{ singleCreateResolveStatusLabel }}</AppTag>
									</view>
									<view v-if="singleCreateResolveResult" class="resolve-grid">
										<view class="resolve-line">
											<text class="resolve-label">命中依据值</text>
											<text class="resolve-value">{{ formatWeightValue(singleCreateResolveResult.basis_value) }}kg</text>
										</view>
										<view class="resolve-line">
											<text class="resolve-label">依据类型</text>
											<text class="resolve-value">{{ getDerivedBasisSourceLabel(singleCreateResolveResult.basis_source) }}</text>
										</view>
										<view class="resolve-line">
											<text class="resolve-label">来源日期/单据</text>
											<text class="resolve-value">{{ formatDerivedBasisRef(singleCreateResolveResult) }}</text>
										</view>
										<view class="resolve-line">
											<text class="resolve-label">推导净重</text>
											<text class="resolve-value">{{ formatWeightValue(singleCreateResolveResult.derived_fill_weight) }}kg</text>
										</view>
									</view>
									<text v-else class="resolve-empty">{{ singleCreateResolveDisplayText }}</text>
									<view class="resolve-actions">
										<AppButton size="sm" kind="ghost" @click="onSingleCreateInputModeChange('net')">改为手填净重</AppButton>
									</view>
								</view>
							</view>
						</AppSection>
					</view>

					<AppSection v-if="canCreateFilling" title="批量新增灌装">
						<template #actions>
							<AppButton kind="ghost" size="sm" @click="onBatchCreateReset">清空</AppButton>
							<AppButton size="sm" kind="neutral" :loading="batchCreatePreviewLoading" @click="onBatchCreatePreview">预览</AppButton>
							<AppButton size="sm" kind="primary" :loading="batchCreateExecuting" @click="onBatchCreateExecute">执行</AppButton>
						</template>

								<view class="mode-toggle">
									<text class="mode-toggle__label">录入模式</text>
									<view class="mode-toggle__actions">
										<AppButton
											v-for="item in batchFillingInputModeOptions"
											:key="`batch-mode-${item.value}`"
											size="sm"
											:kind="batchCreateInputMode === item.value ? 'primary' : 'neutral'"
											@click="onBatchCreateInputModeChange(item.value)"
										>
											{{ item.label === '按灌后总重推导' ? '批量总重' : '批量净重' }}
										</AppButton>
									</view>
								</view>

								<view class="batch-grid">
									<picker class="picker-block" mode="date" :value="batchCreateForm.date" @change="onBatchCreateDateChange">
										<AppInput :model-value="batchCreateForm.date" label="灌装日期" placeholder="请选择日期" disabled prefix-icon="calendar" size="sm" />
									</picker>
									<picker class="picker-block" mode="selector" :range="recordTypeCreateOptions" range-key="label" @change="onBatchCreateRecordTypeChange">
										<AppInput :model-value="batchCreateRecordTypeLabel" label="作业类型" placeholder="请选择作业类型" disabled prefix-icon="list" size="sm" />
									</picker>
									<picker class="picker-block" mode="selector" :range="operatorCreateOptions" range-key="label" @change="onBatchCreateOperatorChange">
										<AppInput :model-value="batchCreateOperatorLabel" label="操作人" placeholder="请选择操作人" disabled prefix-icon="user" size="sm" />
									</picker>
									<AppInput
										v-if="batchCreateDefaultWeightVisible"
										v-model="batchCreateForm.defaultFillWeight"
										label="默认净重(kg)"
										placeholder="可空，行内未填时使用"
										size="sm"
									/>
									<AppInput v-model="batchCreateForm.remark" label="备注" placeholder="可选" size="sm" />
								</view>
						<view class="batch-textarea-wrap">
							<text class="batch-textarea-label">{{ batchCreateTextareaLabel }}</text>
							<textarea
								v-model="batchCreateForm.batchText"
								class="batch-textarea"
								:placeholder="batchCreateTextareaPlaceholder"
								maxlength="120000"
							/>
						</view>
						<text class="batch-hint">{{ batchCreateHintText }}</text>

						<view v-if="batchCreatePreviewResult" class="batch-result">
							<text class="batch-result-title">预览结果</text>
							<text class="batch-result-line">可新增：{{ batchCreatePreviewResult.target_total }}（上限 {{ batchCreatePreviewResult.limit }}）</text>
							<text class="batch-result-line">
								无效行：{{ batchCreatePreviewResult.invalid_total || 0 }}，已存在：{{ batchCreatePreviewResult.existing_total || 0 }}，内容重复：{{ batchCreatePreviewResult.duplicate_total || 0 }}
							</text>
							<text v-if="batchCreatePreviewWarningTotal > 0" class="batch-result-line">
								瓶流转预警：{{ batchCreatePreviewWarningTotal }} 条
							</text>
							<text v-if="batchCreatePendingBasisTotal > 0" class="batch-result-line batch-result-line--warning">
								有 {{ batchCreatePendingBasisTotal }} 条未命中最近回瓶重量，已标记为待销售回瓶自动补算。
							</text>
							<text class="batch-result-line">样例{{ batchCreateIdentifierLabel }}：{{ formatBottleNoSamples(batchCreatePreviewResult.sample_bottle_nos) }}</text>
							<view v-if="batchCreatePreviewCreateItems.length" class="batch-detail-block">
								<text class="batch-detail-title">待新增明细（前 {{ batchCreatePreviewCreateItems.length }} 条）</text>
								<text v-for="item in batchCreatePreviewCreateItems" :key="`create-${item.line_no}-${item.bottle_no}`" class="batch-detail-line">
									{{ formatBatchCreatePreviewCreateItem(item) }}
								</text>
							</view>
							<view v-if="batchCreatePreviewWarningItems.length" class="batch-detail-block">
								<text class="batch-detail-title">瓶流转预警（前 {{ batchCreatePreviewWarningItems.length }} 条）</text>
								<text
									v-for="item in batchCreatePreviewWarningItems"
									:key="`warning-${item.bottle_no}-${item.last_out_date}-${item.status_code}`"
									class="batch-detail-line"
								>
									{{ formatBatchCreatePreviewWarningItem(item) }}
								</text>
							</view>
							<view v-if="batchCreatePreviewExistingItems.length" class="batch-detail-block">
								<text class="batch-detail-title">已存在冲突（前 {{ batchCreatePreviewExistingItems.length }} 条）</text>
								<text v-for="item in batchCreatePreviewExistingItems" :key="`existing-${item.line_no}-${item.bottle_no}`" class="batch-detail-line">
									{{ formatBatchCreatePreviewIssueItem(item) }}
								</text>
							</view>
							<view v-if="batchCreatePreviewInvalidItems.length" class="batch-detail-block">
								<text class="batch-detail-title">无效行（前 {{ batchCreatePreviewInvalidItems.length }} 条）</text>
								<text v-for="item in batchCreatePreviewInvalidItems" :key="`invalid-${item.line_no}-${item.bottle_no}-${item.error}`" class="batch-detail-line">
									{{ formatBatchCreatePreviewIssueItem(item) }}
								</text>
							</view>
						</view>

						<view v-if="batchCreateExecuteResult" class="batch-result">
							<text class="batch-result-title">执行结果</text>
							<text class="batch-result-line">总数：{{ batchCreateExecuteResult.total }}，成功：{{ batchCreateExecuteResult.success }}，失败：{{ batchCreateExecuteResult.failed }}</text>
							<text v-if="batchCreateExecuteResult.failed > 0" class="batch-result-line">
								失败记录：{{ formatFailedItems(batchCreateExecuteResult.failed_items) }}
							</text>
						</view>
					</AppSection>

					<AppSection v-if="canUpdateFilling" title="批量改日期">
					<template #actions>
						<AppButton kind="ghost" size="sm" @click="onBatchReset">清空</AppButton>
						<AppButton size="sm" kind="neutral" :loading="batchPreviewLoading" @click="onBatchPreview">预览</AppButton>
						<AppButton size="sm" kind="primary" :loading="batchExecuting" @click="onBatchExecute">执行</AppButton>
					</template>

					<view class="batch-grid">
						<picker class="picker-block" mode="selector" :range="batchScopeOptions" range-key="label" @change="onBatchScopeChange">
							<AppInput :model-value="batchScopeLabel" label="更新范围" disabled prefix-icon="list" size="sm" />
						</picker>
						<picker class="picker-block" mode="date" :value="batchForm.newDate" @change="onBatchDateChange">
							<AppInput :model-value="batchForm.newDate" label="新灌装日期" placeholder="请选择日期" disabled prefix-icon="calendar" size="sm" />
						</picker>
						<AppInput :model-value="String(selectedCount)" label="已勾选数量" disabled prefix-icon="list" size="sm" />
					</view>
					<text class="batch-hint">按筛选全量模式会更新当前筛选命中的全部记录；勾选子集模式只更新已勾选记录。</text>

					<view v-if="batchPreviewResult" class="batch-result">
						<text class="batch-result-title">预览结果</text>
						<text class="batch-result-line">命中数量：{{ batchPreviewResult.target_total }}（上限 {{ batchPreviewResult.limit }}）</text>
						<text class="batch-result-line">样例瓶号：{{ formatBottleNoSamples(batchPreviewResult.sample_bottle_nos) }}</text>
					</view>

					<view v-if="batchExecuteResult" class="batch-result">
						<text class="batch-result-title">执行结果</text>
						<text class="batch-result-line">总数：{{ batchExecuteResult.total }}，成功：{{ batchExecuteResult.success }}，失败：{{ batchExecuteResult.failed }}</text>
						<text v-if="batchExecuteResult.failed > 0" class="batch-result-line">
							失败记录：{{ formatFailedItems(batchExecuteResult.failed_items) }}
						</text>
					</view>
				</AppSection>

				<AppSection title="记录列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无记录" @retry="onSearch">
					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.bottle_no"
						:subtitle="item.date"
						icon="bottle"
						icon-class="bg-teal"
					>
						<template #right>
							<view class="weight-box">
								<text class="weight-value">{{ item.fill_weight }}</text>
								<text class="weight-unit">kg</text>
							</view>
						</template>
							<template #meta>
								<view class="meta-tags">
									<AppTag kind="soft">{{ getRecordTypeLabel(item.record_type) }}</AppTag>
									<AppTag v-if="item.operator" kind="soft">操作人: {{ item.operator }}</AppTag>
									<text v-if="item.remark" class="meta-text">{{ item.remark }}</text>
								</view>
							</template>
							<template #footer>
								<AppTag v-if="isFillingSelected(item._id)" kind="success">已勾选</AppTag>
								<AppButton size="sm" kind="neutral" @click="onToggleFillingSelect(item)">
									{{ isFillingSelected(item._id) ? '取消勾选' : '勾选子集' }}
								</AppButton>
								<AppButton v-if="canUpdateFilling" size="sm" kind="outline" @click="onEdit(item)">编辑</AppButton>
								<AppButton
									v-if="canDeleteFilling"
									size="sm"
									kind="neutral"
								:loading="removingId === item._id"
								@click="onRemove(item)"
							>
								删除
							</AppButton>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="onNextPage">下一页</AppButton>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppDatePresetBar from '@/components/base/AppDatePresetBar.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useQuery } from '@/composables/useQuery'
import { searchBottleSuggestions } from '@/composables/useBottleSuggestions'
import { searchDeliveriesV1 } from '@/services/delivery'
import { searchVehiclesV1 } from '@/services/vehicle'
import { buildDatePresetRange, detectDatePreset } from '@/utils/datePreset'
import {
	batchCreateFillingsV1,
	batchUpdateFillingDateV1,
	createFillingV1,
	listFillingsV1,
	removeFillingV1,
	resolveFillingFillWeightV1
} from '@/services/filling'

const props = defineProps({
	presetSourceAnomalyId: { type: String, default: '' },
	presetReturnToAnomaly: { type: String, default: '' },
	presetReturnScrollTop: { type: String, default: '' },
	presetBottleNo: { type: String, default: '' },
	presetDate: { type: String, default: '' },
	presetInputMode: { type: String, default: '' },
	presetRecordType: { type: String, default: '' },
	presetFillWeight: { type: String, default: '' },
	presetRemark: { type: String, default: '' }
})

const BATCH_LIMIT = 2000
const ANOMALY_BACKFILL_SAVED_STORAGE_KEY = 'crm:bottle-anomaly:backfill-saved'
const MISSING_RECENT_BACK_BASIS_GUIDE_TEXT = '新瓶首单请改用净重录入；有回瓶历史后再用总重推导。'
const FILLING_INPUT_MODE_OPTIONS = [
	{ label: '按灌后总重推导', value: 'after_fill_total' },
	{ label: '直接录净重', value: 'net' }
]
const RECORD_TYPE_OPTIONS = [
	{ label: '常规灌装', value: 'normal_fill' },
	{ label: '代理销售', value: 'truck_out_agent_sale' },
	{ label: '车辆燃气补给', value: 'truck_out_no_sale' }
]
const DEFAULT_OPERATOR_NAME = '陈铁栓'
const ANOMALY_BACKFILL_SAVED_EVENT = 'crm:bottle-anomaly:backfill-saved'
const STATUS_LABEL_MAP = {
	unknown: '未知',
	in_station: '在站',
	at_customer: '在客户',
	scrapped: '报废',
	lost: '丢失'
}
const RECORD_TYPE_FILTER_OPTIONS = [{ label: '全部', value: '' }, ...RECORD_TYPE_OPTIONS]
const SALE_STATE_FILTER_OPTIONS = [
	{ label: '全部', value: '' },
	{ label: '已灌未售', value: 'filled_unsold' }
]
const batchScopeOptions = [
	{ label: '按当前筛选全量', value: 'filter' },
	{ label: '勾选子集', value: 'ids' }
]

const list = ref([])
const removingId = ref('')
const selectedFillingIds = ref([])
const filterBottleSuggestions = ref([])
const filterBottleSuggestLoading = ref(false)
let filterBottleSuggestTimer = 0
const filterOperatorSuggestions = ref([])
let filterOperatorSuggestTimer = 0
const singleCreatePanelOpen = ref(false)
const singleCreateSubmitting = ref(false)
const singleCreateBottleFocusFlag = ref(false)
const singleCreateBottleSuggestions = ref([])
const singleCreateSuggestLoading = ref(false)
let singleCreateSuggestTimer = 0
const singleCreateResolveLoading = ref(false)
const singleCreateResolveResult = ref(null)
const singleCreateResolveError = ref('')
let singleCreateResolveTimer = 0
let singleCreateResolveToken = 0
const batchCreatePreviewLoading = ref(false)
const batchCreateExecuting = ref(false)
const batchCreatePreviewResult = ref(null)
const batchCreateExecuteResult = ref(null)
const operatorOptions = ref([])
const { canPageAction } = useAuthGuard()
const canCreateFilling = computed(() => canPageAction('/pages/filling/list', 'create'))
const canUpdateFilling = computed(() => canPageAction('/pages/filling/edit', 'update') || canPageAction('/pages/filling/list', 'update'))
const canDeleteFilling = computed(() => canPageAction('/pages/filling/list', 'delete'))
const isLoadingOperatorOptions = ref(false)
const batchPreviewLoading = ref(false)
const batchExecuting = ref(false)
const batchPreviewResult = ref(null)
const batchExecuteResult = ref(null)
const exporting = ref(false)
const summary = ref({
	total: 0,
	withRemark: 0,
	withoutRemark: 0,
	normalFillCount: 0,
	truckOutAgentSaleCount: 0,
	truckOutNoSaleCount: 0,
	normalFillWeight: 0,
	truckOutAgentSaleWeight: 0,
	truckOutNoSaleWeight: 0
})
const listRefreshVersion = ref(0)
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})
const datePreset = ref('custom')
const fillingDatePresetItems = [
	{ label: '今日', value: 'today' },
	{ label: '前一日', value: 'yesterday' },
	{ label: '本周', value: 'week' },
	{ label: '上周', value: 'lastWeek' },
	{ label: '本月', value: 'month' },
	{ label: '上月', value: 'lastMonth' },
	{ label: '自定义', value: 'custom' }
]

const filters = reactive({
	bottle_no: '',
	operator: '',
	record_type: '',
	sale_state: '',
	dateStart: '',
	dateEnd: ''
})

const singleCreateForm = reactive({
	date: '',
	input_mode: 'after_fill_total',
	bottle_no: '',
	after_fill_total_weight: '',
	fill_weight: '',
	record_type: 'normal_fill',
	operator: '',
	operator_id: '',
	remark: ''
})

const batchCreateForm = reactive({
	date: '',
	input_mode: 'after_fill_total',
	record_type: 'normal_fill',
	operator: '',
	operator_id: '',
	defaultFillWeight: '',
	remark: '',
	batchText: ''
})

const batchForm = reactive({
	scopeMode: 'filter',
	newDate: ''
})
const singleCreateRouteContext = reactive({
	sourceAnomalyId: '',
	returnToAnomaly: false,
	returnScrollTop: 0
})

const subtitle = computed(() => {
	if (!pager.total) return '按瓶号与日期查询'
	return `当前筛选 ${pager.total} 条`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})
const batchScopeLabel = computed(() => {
	return batchScopeOptions.find((item) => item.value === batchForm.scopeMode)?.label || batchScopeOptions[0].label
})
const selectedCount = computed(() => selectedFillingIds.value.length)
const recordTypeFilterOptions = computed(() => RECORD_TYPE_FILTER_OPTIONS)
const saleStateFilterOptions = computed(() => SALE_STATE_FILTER_OPTIONS)
const recordTypeCreateOptions = computed(() => RECORD_TYPE_OPTIONS)
const singleFillingInputModeOptions = computed(() =>
	isTruckOutNoSaleRecordType(singleCreateForm.record_type)
		? FILLING_INPUT_MODE_OPTIONS.filter((item) => item.value === 'net')
		: FILLING_INPUT_MODE_OPTIONS
)
const batchFillingInputModeOptions = computed(() =>
	isTruckOutNoSaleRecordType(batchCreateForm.record_type)
		? FILLING_INPUT_MODE_OPTIONS.filter((item) => item.value === 'net')
		: FILLING_INPUT_MODE_OPTIONS
)
const operatorCreateOptions = computed(() => operatorOptions.value)
const recordTypeFilterLabel = computed(() => {
	const target = normalizeRecordType(filters.record_type, '')
	return RECORD_TYPE_FILTER_OPTIONS.find((item) => item.value === target)?.label || RECORD_TYPE_FILTER_OPTIONS[0].label
})
const saleStateFilterLabel = computed(() => {
	const target = normalizeSaleStateFilter(filters.sale_state, '')
	return SALE_STATE_FILTER_OPTIONS.find((item) => item.value === target)?.label || SALE_STATE_FILTER_OPTIONS[0].label
})
const batchCreateRecordTypeLabel = computed(() => {
	const target = normalizeRecordType(batchCreateForm.record_type, 'normal_fill')
	return RECORD_TYPE_OPTIONS.find((item) => item.value === target)?.label || RECORD_TYPE_OPTIONS[0].label
})
const batchCreateOperatorLabel = computed(() => {
	const name = normalizeString(batchCreateForm.operator)
	if (name) return name
	if (isLoadingOperatorOptions.value) return '加载中...'
	return '未选择'
})
const batchCreateInputMode = computed(() =>
	resolveInputModeByRecordType(batchCreateForm.record_type, batchCreateForm.input_mode, 'after_fill_total')
)
const singleCreateRecordTypeLabel = computed(() => {
	const target = normalizeRecordType(singleCreateForm.record_type, 'normal_fill')
	return RECORD_TYPE_OPTIONS.find((item) => item.value === target)?.label || RECORD_TYPE_OPTIONS[0].label
})
const singleCreateOperatorLabel = computed(() => {
	const name = normalizeString(singleCreateForm.operator)
	if (name) return name
	if (isLoadingOperatorOptions.value) return '加载中...'
	return '未选择'
})
const singleCreateInputMode = computed(() =>
	resolveInputModeByRecordType(singleCreateForm.record_type, singleCreateForm.input_mode, 'after_fill_total')
)
const singleCreateUseVehicleSuggestion = computed(() => normalizeRecordType(singleCreateForm.record_type, '') === 'truck_out_no_sale')
const singleCreateIdentifierBaseLabel = computed(() => (singleCreateUseVehicleSuggestion.value ? '车牌号' : '瓶号'))
const singleCreateBottleRequired = computed(() =>
	singleCreateInputMode.value === 'after_fill_total' || isInventoryLinkedRecordType(singleCreateForm.record_type)
)
const singleCreateBottleLabel = computed(() =>
	singleCreateBottleRequired.value ? singleCreateIdentifierBaseLabel.value : `${singleCreateIdentifierBaseLabel.value}（可空）`
)
const singleCreateBottlePlaceholder = computed(() =>
	singleCreateUseVehicleSuggestion.value
		? singleCreateBottleRequired.value
			? '输入车牌号联想车辆档案'
			: '可不填，填写时联想车辆档案车牌'
		: singleCreateBottleRequired.value
			? '输入瓶号联想钢瓶档案'
			: '可不填，填写时可联想钢瓶档案'
)
const singleCreateBottleHint = computed(() =>
	singleCreateUseVehicleSuggestion.value
		? '车辆燃气补给按净重录入，不校验上次回站/回瓶依据；净重会直接扣减库存并计入车辆消耗。'
		: singleCreateInputMode.value === 'after_fill_total'
			? '系统将按最近一次回瓶总重自动推导灌装净重。'
			: singleCreateBottleRequired.value
				? '常规灌装与代理销售要求钢瓶已建档且启用。'
				: '可不填瓶号。'
)
const singleCreateWeightLabel = computed(() =>
	singleCreateInputMode.value === 'after_fill_total' ? '灌后总重(kg)' : '灌装净重(kg)'
)
const singleCreateWeightPlaceholder = computed(() =>
	singleCreateInputMode.value === 'after_fill_total' ? '请输入灌后总重' : '请输入大于0的数值'
)
const singleCreateResolveStatusLabel = computed(() => {
	if (singleCreateResolveLoading.value) return '推导中'
	if (singleCreateResolveResult.value) return '已命中依据'
	if (singleCreateResolveError.value) return '待手工处理'
	return '待推导'
})
const singleCreateResolveStatusKind = computed(() => {
	if (singleCreateResolveLoading.value) return 'soft'
	if (singleCreateResolveResult.value) return 'success'
	if (singleCreateResolveError.value) return 'warning'
	return 'warning'
})
const singleCreateResolveDisplayText = computed(() => {
	if (!singleCreateResolveError.value) return '请输入标识和灌后总重后自动推导。'
	if (isMissingRecentBackBasisError(singleCreateResolveError.value)) return MISSING_RECENT_BACK_BASIS_GUIDE_TEXT
	return singleCreateResolveError.value
})
const batchCreateIdentifierLabel = computed(() => (normalizeRecordType(batchCreateForm.record_type, '') === 'truck_out_no_sale' ? '车牌号' : '瓶号'))
const batchCreateValueLabel = computed(() => (batchCreateInputMode.value === 'after_fill_total' ? '上秤重量/灌装完重量' : '净重'))
const batchCreateDefaultWeightVisible = computed(() => batchCreateInputMode.value === 'net')
const batchCreateTextareaLabel = computed(() =>
	batchCreateInputMode.value === 'after_fill_total'
		? `批量内容（每行一条：\`${batchCreateIdentifierLabel.value},瓶子上秤重量,灌装完重量\`）`
		: `批量内容（每行一条：\`${batchCreateIdentifierLabel.value},净重\` 或仅 \`${batchCreateIdentifierLabel.value}\`）`
)
const batchCreateTextareaPlaceholder = computed(() => {
	if (isTruckOutNoSaleRecordType(batchCreateForm.record_type)) {
		return '示例：\n冀A263AP,540\n冀A565PC,823'
	}
	if (batchCreateInputMode.value === 'after_fill_total') {
		return normalizeRecordType(batchCreateForm.record_type, '') === 'truck_out_no_sale'
			? '示例：\n冀A263AP,540\n冀A565PC,823'
			: '示例：\n134,118,188\n135,119.5,187.5'
	}
	return '示例：\n134,68\n135,67.5\n136'
})
const batchCreateHintText = computed(() => {
	if (isTruckOutNoSaleRecordType(batchCreateForm.record_type)) {
		return '车辆燃气补给按净重录入；如填写车牌将联想车辆档案，录入净重直接扣减库存并计入车辆消耗。'
	}
	if (batchCreateInputMode.value === 'after_fill_total') {
		return normalizeRecordType(batchCreateForm.record_type, '') === 'truck_out_no_sale'
			? '每行必须填写“车牌号,灌后总重”；系统将按最近整车回站总重推导净重。'
			: '每行必须填写“瓶号,瓶子上秤重量,灌装完重量”；灌装净重=灌装完重量-瓶子上秤重量，未命中最近回瓶重量时提交后等待销售回瓶自动补算上秤差。'
	}
	return '若某行未填写净重，将使用“默认净重”；若默认净重也为空，该行会在预览中标为无效。'
})
const batchCreatePreviewCreateItems = computed(() => {
	return Array.isArray(batchCreatePreviewResult.value?.create_items) ? batchCreatePreviewResult.value.create_items : []
})
const batchCreatePreviewWarningItems = computed(() => {
	return Array.isArray(batchCreatePreviewResult.value?.warning_items) ? batchCreatePreviewResult.value.warning_items : []
})
const batchCreatePreviewWarningTotal = computed(() => Number(batchCreatePreviewResult.value?.warning_total || 0))
const batchCreatePreviewExistingItems = computed(() => {
	return Array.isArray(batchCreatePreviewResult.value?.existing_items) ? batchCreatePreviewResult.value.existing_items : []
})
const batchCreatePreviewInvalidItems = computed(() => {
	return Array.isArray(batchCreatePreviewResult.value?.invalid_items) ? batchCreatePreviewResult.value.invalid_items : []
})
const batchCreatePendingBasisTotal = computed(() => {
	const explicitTotal = Number(batchCreatePreviewResult.value?.pending_basis_total)
	if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal
	return batchCreatePreviewCreateItems.value.reduce((count, item) => {
		return count + (normalizeString(item?.loss_match_status) === 'pending' || item?.basis_missing ? 1 : 0)
	}, 0)
})
const normalFillWeightText = computed(() => formatWeightStat(summary.value.normalFillWeight))
const truckOutAgentSaleWeightText = computed(() => formatWeightStat(summary.value.truckOutAgentSaleWeight))
const truckOutNoSaleWeightText = computed(() => formatWeightStat(summary.value.truckOutNoSaleWeight))
const normalFillCountHint = computed(() => `${formatCountStat(summary.value.normalFillCount)}瓶`)
const truckOutAgentSaleCountHint = computed(() => `${formatCountStat(summary.value.truckOutAgentSaleCount)}瓶`)
const truckOutNoSaleCountHint = computed(() => `${formatCountStat(summary.value.truckOutNoSaleCount)}辆`)

const filterChips = computed(() => {
	const chips = []
	if (filters.bottle_no) chips.push({ key: 'bottle', label: `瓶号: ${filters.bottle_no}` })
	if (filters.operator) chips.push({ key: 'operator', label: `操作人: ${filters.operator}` })
	if (filters.record_type) chips.push({ key: 'recordType', label: `类型: ${getRecordTypeLabel(filters.record_type)}` })
	if (filters.sale_state) chips.push({ key: 'saleState', label: `销售状态: ${getSaleStateLabel(filters.sale_state)}` })
	if (filters.dateStart || filters.dateEnd) {
		const start = filters.dateStart || '起'
		const end = filters.dateEnd || '今'
		chips.push({ key: 'date', label: `日期: ${start} ~ ${end}` })
	}
	return chips
})

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		const oid = normalizeString(value.$oid || value.oid || value.id)
		if (oid) return oid
	}
	return normalizeString(value)
}

function normalizeRecordType(value, fallback = 'normal_fill') {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (RECORD_TYPE_OPTIONS.some((item) => item.value === text)) return text
	return fallback
}

function normalizeSaleStateFilter(value, fallback = '') {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (SALE_STATE_FILTER_OPTIONS.some((item) => item.value === text)) return text
	return fallback
}

function isTruckOutNoSaleRecordType(value) {
	return normalizeRecordType(value, '') === 'truck_out_no_sale'
}

function normalizeInputMode(value, fallback = 'after_fill_total') {
	const text = normalizeString(value).toLowerCase()
	if (!text) return fallback
	if (text === 'net' || text === 'after_fill_total') return text
	return fallback
}

function resolveInputModeByRecordType(recordType, mode, fallback = 'after_fill_total') {
	const normalizedMode = normalizeInputMode(mode, fallback)
	if (isTruckOutNoSaleRecordType(recordType)) return 'net'
	return normalizedMode
}

function normalizeBooleanFlag(value) {
	const text = normalizeString(value).toLowerCase()
	return text === '1' || text === 'true' || text === 'yes'
}

function isInventoryLinkedRecordType(value) {
	const type = normalizeRecordType(value, '')
	return type === 'normal_fill' || type === 'truck_out_agent_sale'
}

function getRecordTypeLabel(value) {
	const key = normalizeRecordType(value, 'normal_fill')
	return RECORD_TYPE_OPTIONS.find((item) => item.value === key)?.label || '常规灌装'
}

function getSaleStateLabel(value) {
	const key = normalizeSaleStateFilter(value, '')
	return SALE_STATE_FILTER_OPTIONS.find((item) => item.value === key)?.label || SALE_STATE_FILTER_OPTIONS[0].label
}

function getStatusLabel(value) {
	const key = normalizeString(value)
	return STATUS_LABEL_MAP[key] || '未知'
}

function formatCountStat(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num < 0) return '0'
	return String(Math.round(num))
}

function formatStatNumber(value, maxFractionDigits = 2) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0'
	return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits })
}

function formatWeightStat(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0kg'
	if (Math.abs(num) > 1000) {
		const tonValue = num / 1000
		return `${formatStatNumber(tonValue, 2)}吨`
	}
	return `${formatStatNumber(num, 2)}kg`
}

function formatWeightValue(value, maxFractionDigits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '-'
	return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits })
}

function getDerivedBasisSourceLabel(value) {
	const key = normalizeString(value)
	if (key === 'truck_back_gross') return '整车回站总重'
	if (key === 'back_tare_plus_net') return '回瓶皮重+净重'
	return '回瓶总重'
}

function formatDerivedBasisRef(payload = {}) {
	const date = normalizeString(payload?.basis_date)
	const ref = normalizeString(payload?.basis_ref)
	if (date && ref) return `${date} / ${ref}`
	return date || ref || '-'
}

function clearSingleCreateRouteContext() {
	singleCreateRouteContext.sourceAnomalyId = ''
	singleCreateRouteContext.returnToAnomaly = false
	singleCreateRouteContext.returnScrollTop = 0
}

function normalizeScrollTop(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num < 0) return 0
	return Math.round(num)
}

function hasSingleCreateRoutePreset(params = {}) {
	return Boolean(
		normalizeString(params?.sourceAnomalyId || params?.source_anomaly_id || params?.presetSourceAnomalyId) ||
			normalizeString(params?.bottleNo || params?.bottle_no || params?.presetBottleNo) ||
			normalizeString(params?.date || params?.presetDate) ||
			normalizeString(params?.fillWeight || params?.fill_weight || params?.presetFillWeight) ||
			normalizeString(params?.remark || params?.presetRemark)
	)
}

function buildSingleCreateRoutePresetFromProps() {
	return {
		sourceAnomalyId: props.presetSourceAnomalyId,
		returnToAnomaly: props.presetReturnToAnomaly,
		returnScrollTop: props.presetReturnScrollTop,
		bottleNo: props.presetBottleNo,
		date: props.presetDate,
		inputMode: props.presetInputMode,
		recordType: props.presetRecordType,
		fillWeight: props.presetFillWeight,
		remark: props.presetRemark
	}
}

function setBatchCreateOperatorByOption(option) {
	if (!option || typeof option !== 'object') return
	batchCreateForm.operator = normalizeString(option.name || option.label)
	batchCreateForm.operator_id = normalizeId(option.id || option._id)
}

function setSingleCreateOperatorByOption(option) {
	if (!option || typeof option !== 'object') return
	singleCreateForm.operator = normalizeString(option.name || option.label)
	singleCreateForm.operator_id = normalizeId(option.id || option._id)
}

function ensureBatchCreateOperatorOptionByCurrent() {
	const name = normalizeString(batchCreateForm.operator)
	if (!name) return
	const currentId = normalizeId(batchCreateForm.operator_id)
	const matched = operatorOptions.value.find((item) => {
		const itemId = normalizeId(item.id || item._id)
		const itemName = normalizeString(item.name || item.label)
		if (currentId && itemId) return itemId === currentId
		return itemName === name
	})
	if (matched) {
		setBatchCreateOperatorByOption(matched)
		return
	}
	operatorOptions.value = [{ id: currentId, name, label: name }, ...operatorOptions.value]
}

function ensureSingleCreateOperatorOptionByCurrent() {
	const name = normalizeString(singleCreateForm.operator)
	if (!name) return
	const currentId = normalizeId(singleCreateForm.operator_id)
	const matched = operatorOptions.value.find((item) => {
		const itemId = normalizeId(item.id || item._id)
		const itemName = normalizeString(item.name || item.label)
		if (currentId && itemId) return itemId === currentId
		return itemName === name
	})
	if (matched) {
		setSingleCreateOperatorByOption(matched)
		return
	}
	operatorOptions.value = [{ id: currentId, name, label: name }, ...operatorOptions.value]
}

function applyBatchCreateDefaultOperator() {
	if (normalizeString(batchCreateForm.operator)) return
	const preferred =
		operatorOptions.value.find((item) => normalizeString(item.name || item.label) === DEFAULT_OPERATOR_NAME) ||
		operatorOptions.value[0]
	if (preferred) setBatchCreateOperatorByOption(preferred)
}

function applySingleCreateDefaultOperator() {
	if (normalizeString(singleCreateForm.operator)) return
	const preferred =
		operatorOptions.value.find((item) => normalizeString(item.name || item.label) === DEFAULT_OPERATOR_NAME) ||
		operatorOptions.value[0]
	if (preferred) setSingleCreateOperatorByOption(preferred)
}

async function loadOperatorOptions() {
	if (isLoadingOperatorOptions.value) return
	isLoadingOperatorOptions.value = true
	try {
		const rows = []
		let page = 1
		while (page <= 20) {
			const res = await searchDeliveriesV1({ is_active: true, page, pageSize: 50 })
			if (res?.code !== 0) break
			const pageRows = Array.isArray(res.data) ? res.data : []
			rows.push(...pageRows)
			const hasMore = Boolean(res?.paging?.hasMore)
			if (!hasMore || !pageRows.length) break
			page += 1
		}
		operatorOptions.value = rows
			.map((row) => ({
				id: normalizeId(row && row._id),
				name: normalizeString(row && row.name),
				label: normalizeString(row && row.name)
			}))
			.filter((row) => row.name)
		ensureBatchCreateOperatorOptionByCurrent()
		ensureSingleCreateOperatorOptionByCurrent()
		applyBatchCreateDefaultOperator()
		applySingleCreateDefaultOperator()
	} catch (err) {
		console.error('load operator options failed', err)
	} finally {
		isLoadingOperatorOptions.value = false
	}
}

function formatTodayUtc8() {
	const now = new Date()
	const utc8Time = now.getTime() + 8 * 60 * 60 * 1000
	const date = new Date(utc8Time)
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function normalizeUniqueIds(rawIds) {
	const set = new Set()
	const listData = []
	const source = Array.isArray(rawIds) ? rawIds : []
	for (let i = 0; i < source.length; i += 1) {
		const id = normalizeString(source[i])
		if (!id || set.has(id)) continue
		set.add(id)
		listData.push(id)
	}
	return listData
}

function isValidDateString(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [year, month, day] = text.split('-').map((item) => Number(item))
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
	if (month < 1 || month > 12) return false
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	return day >= 1 && day <= maxDay
}

function clearBatchResultState() {
	batchPreviewResult.value = null
	batchExecuteResult.value = null
}

function clearBatchCreateResultState() {
	batchCreatePreviewResult.value = null
	batchCreateExecuteResult.value = null
}

function clearSelectedFillings({ silent = false, fallbackToFilter = false } = {}) {
	if (fallbackToFilter && batchForm.scopeMode === 'ids') {
		batchForm.scopeMode = 'filter'
	}
	if (!selectedFillingIds.value.length) return
	selectedFillingIds.value = []
	clearBatchResultState()
	clearBatchCreateResultState()
	if (!silent) {
		uni.showToast({ title: '已清空勾选子集', icon: 'none' })
	}
}

function getFilterSnapshot() {
	return JSON.stringify({
		bottle_no: normalizeString(filters.bottle_no),
		operator: normalizeString(filters.operator),
		record_type: normalizeRecordType(filters.record_type, ''),
		sale_state: normalizeSaleStateFilter(filters.sale_state, ''),
		dateStart: normalizeString(filters.dateStart),
		dateEnd: normalizeString(filters.dateEnd)
	})
}

function clearFilterChip(key) {
	if (key === 'bottle') filters.bottle_no = ''
	if (key === 'operator') filters.operator = ''
	if (key === 'recordType') filters.record_type = ''
	if (key === 'saleState') filters.sale_state = ''
	if (key === 'date') {
		filters.dateStart = ''
		filters.dateEnd = ''
	}
	clearFilterBottleSuggestions()
	clearFilterOperatorSuggestions()
	onSearch(true, { force: true })
}

function buildListParams({ page = 1, pageSize = 50 } = {}) {
	return {
		bottle_no: normalizeString(filters.bottle_no),
		operator: normalizeString(filters.operator),
		record_type: normalizeRecordType(filters.record_type, ''),
		sale_state: normalizeSaleStateFilter(filters.sale_state, ''),
		dateStart: normalizeString(filters.dateStart),
		dateEnd: normalizeString(filters.dateEnd),
		page,
		pageSize
	}
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listFillingsV1(buildListParams({ page: pager.page, pageSize: pager.pageSize }))
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: {
					total: 0,
					with_remark: 0,
					without_remark: 0,
					normal_fill_count: 0,
					truck_out_agent_sale_count: 0,
					truck_out_no_sale_count: 0,
					normal_fill_weight: 0,
					truck_out_agent_sale_weight: 0,
					truck_out_no_sale_weight: 0
				}
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: 0,
				hasMore: false
			},
			summary: res.summary || {
				total: 0,
				with_remark: 0,
				without_remark: 0,
				normal_fill_count: 0,
				truck_out_agent_sale_count: 0,
				truck_out_no_sale_count: 0,
				normal_fill_weight: 0,
				truck_out_agent_sale_weight: 0,
				truck_out_no_sale_weight: 0
			}
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: {
				total: 0,
				with_remark: 0,
				without_remark: 0,
				normal_fill_count: 0,
				truck_out_agent_sale_count: 0,
				truck_out_no_sale_count: 0,
				normal_fill_weight: 0,
				truck_out_agent_sale_weight: 0,
				truck_out_no_sale_weight: 0
			}
		},
		cacheTTL: 10000,
			cacheKey: () =>
				`filling:list:${filters.bottle_no}:${filters.operator}:${filters.record_type}:${filters.sale_state}:${filters.dateStart}:${filters.dateEnd}:${pager.page}:${pager.pageSize}:${listRefreshVersion.value}`
		}
	)

function applyResult(payload) {
	const data = payload || {}
	list.value = Array.isArray(data.items)
		? data.items.map((row) => ({
				...(row || {}),
				record_type: normalizeRecordType(row?.record_type, 'normal_fill'),
				operator: normalizeString(row?.operator || row?.created_by_name)
			}))
		: []
	const paging = data.paging || {}
	pager.page = Number(paging.page || pager.page || 1)
	pager.pageSize = Number(paging.pageSize || pager.pageSize || 50)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)
	const summaryData = data.summary || {}
	summary.value = {
		total: Number(summaryData.total || 0),
		withRemark: Number(summaryData.with_remark ?? summaryData.withRemark ?? 0),
		withoutRemark: Number(summaryData.without_remark ?? summaryData.withoutRemark ?? 0),
		normalFillCount: Number(summaryData.normal_fill_count ?? summaryData.normalFillCount ?? 0),
		truckOutAgentSaleCount: Number(summaryData.truck_out_agent_sale_count ?? summaryData.truckOutAgentSaleCount ?? 0),
		truckOutNoSaleCount: Number(summaryData.truck_out_no_sale_count ?? summaryData.truckOutNoSaleCount ?? 0),
		normalFillWeight: Number(summaryData.normal_fill_weight ?? summaryData.normalFillWeight ?? 0),
		truckOutAgentSaleWeight: Number(summaryData.truck_out_agent_sale_weight ?? summaryData.truckOutAgentSaleWeight ?? 0),
		truckOutNoSaleWeight: Number(summaryData.truck_out_no_sale_weight ?? summaryData.truckOutNoSaleWeight ?? 0)
	}
}

async function onSearch(resetPage = false, { force = false } = {}) {
	if (resetPage) pager.page = 1
	clearFilterBottleSuggestions()
	clearFilterOperatorSuggestions()
	if (force) listRefreshVersion.value += 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.bottle_no = ''
	filters.operator = ''
	filters.record_type = ''
	filters.sale_state = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	datePreset.value = 'custom'
	clearFilterBottleSuggestions()
	clearFilterOperatorSuggestions()
	onSearch(true, { force: true })
}

async function onDatePresetChange(value) {
	datePreset.value = value
	if (value === 'custom') return
	const range = buildDatePresetRange(value, new Date())
	filters.dateStart = range.dateStart
	filters.dateEnd = range.dateEnd
	await onSearch(true, { force: true })
}

function syncDatePreset() {
	datePreset.value = detectDatePreset(filters.dateStart, filters.dateEnd, new Date(), { includePrevious: true })
}

function onFilterDateStartChange(event) {
	filters.dateStart = event?.detail?.value || ''
	syncDatePreset()
}

function onFilterDateEndChange(event) {
	filters.dateEnd = event?.detail?.value || ''
	syncDatePreset()
}

function isFillingSelected(id) {
	const target = normalizeString(id)
	if (!target) return false
	return selectedFillingIds.value.includes(target)
}

function onToggleFillingSelect(item) {
	const id = normalizeString(item?._id)
	if (!id) return
	if (isFillingSelected(id)) {
		selectedFillingIds.value = selectedFillingIds.value.filter((rowId) => rowId !== id)
	} else {
		selectedFillingIds.value = [...selectedFillingIds.value, id]
	}
	clearBatchResultState()
}

function onRecordTypeFilterChange(event) {
	const idx = Number(event?.detail?.value)
	filters.record_type = RECORD_TYPE_FILTER_OPTIONS[idx]?.value || ''
	clearFilterBottleSuggestions()
}

function onSaleStateFilterChange(event) {
	const idx = Number(event?.detail?.value)
	filters.sale_state = SALE_STATE_FILTER_OPTIONS[idx]?.value || ''
}

function clearFilterBottleSuggestTimer() {
	if (!filterBottleSuggestTimer) return
	clearTimeout(filterBottleSuggestTimer)
	filterBottleSuggestTimer = 0
}

function clearFilterBottleSuggestions() {
	filterBottleSuggestions.value = []
	filterBottleSuggestLoading.value = false
	clearFilterBottleSuggestTimer()
}

async function fetchFilterBottleSuggestions(keyword) {
	const targetKeyword = normalizeString(keyword)
	if (!targetKeyword) {
		filterBottleSuggestions.value = []
		filterBottleSuggestLoading.value = false
		return
	}
	filterBottleSuggestLoading.value = true
	try {
		const useVehicle = normalizeRecordType(filters.record_type, '') === 'truck_out_no_sale'
		const res = useVehicle
			? await searchVehiclesV1({ keyword: targetKeyword, limit: 20, is_active: true })
			: null
		const bottleList = useVehicle ? [] : await searchBottleSuggestions(targetKeyword, { limit: 20 })
		if (normalizeBottleNo(filters.bottle_no) !== normalizeBottleNo(targetKeyword)) return
		if (useVehicle && res?.code !== 0) {
			filterBottleSuggestions.value = []
			return
		}
		if (useVehicle && !Array.isArray(res.data)) {
			filterBottleSuggestions.value = []
			return
		}
		if (useVehicle) {
			filterBottleSuggestions.value = res.data
				.filter((item) => Boolean(item) && item.is_active !== false)
				.map((item) => ({
					...(item || {}),
					_suggest_source: 'vehicle',
					bottle_no: normalizeBottleNo(item?.plate_no || item?.bottle_no)
				}))
				.filter((item) => Boolean(item.bottle_no))
				.slice(0, 20)
			return
		}
		filterBottleSuggestions.value = bottleList
	} finally {
		filterBottleSuggestLoading.value = false
	}
}

function onFilterBottleInput(value) {
	const text = normalizeString(value)
	clearFilterBottleSuggestTimer()
	if (!text) {
		filterBottleSuggestions.value = []
		return
	}
	filterBottleSuggestTimer = setTimeout(() => {
		fetchFilterBottleSuggestions(text)
	}, 180)
}

function onFilterBottleFocus() {
	const text = normalizeString(filters.bottle_no)
	if (!text) return
	clearFilterBottleSuggestTimer()
	filterBottleSuggestTimer = setTimeout(() => {
		fetchFilterBottleSuggestions(text)
	}, 120)
}

function onFilterBottleBlur() {
	setTimeout(() => {
		filterBottleSuggestions.value = []
	}, 160)
}

function onFilterBottleConfirm() {
	const normalized = normalizeBottleNo(filters.bottle_no)
	if (normalized) filters.bottle_no = normalized
	clearFilterBottleSuggestions()
	onSearch(true)
}

function selectFilterBottleSuggestion(item) {
	const bottleNo = normalizeBottleNo(item?.bottle_no)
	if (!bottleNo) return
	filters.bottle_no = bottleNo
	clearFilterBottleSuggestions()
}

function clearFilterOperatorSuggestTimer() {
	if (!filterOperatorSuggestTimer) return
	clearTimeout(filterOperatorSuggestTimer)
	filterOperatorSuggestTimer = 0
}

function clearFilterOperatorSuggestions() {
	filterOperatorSuggestions.value = []
	clearFilterOperatorSuggestTimer()
}

function updateFilterOperatorSuggestions(keyword) {
	const text = normalizeString(keyword)
	if (!text) {
		filterOperatorSuggestions.value = []
		return
	}
	const lowered = text.toLowerCase()
	filterOperatorSuggestions.value = operatorOptions.value
		.filter((item) => {
			const name = normalizeString(item?.name || item?.label)
			return name.toLowerCase().includes(lowered)
		})
		.slice(0, 20)
}

function onFilterOperatorInput(value) {
	const text = normalizeString(value)
	clearFilterOperatorSuggestTimer()
	if (!text) {
		filterOperatorSuggestions.value = []
		return
	}
	filterOperatorSuggestTimer = setTimeout(() => {
		if (normalizeString(filters.operator) !== text) return
		updateFilterOperatorSuggestions(text)
	}, 120)
}

function onFilterOperatorFocus() {
	const text = normalizeString(filters.operator)
	if (!text) return
	clearFilterOperatorSuggestTimer()
	filterOperatorSuggestTimer = setTimeout(() => {
		updateFilterOperatorSuggestions(text)
	}, 80)
}

function onFilterOperatorBlur() {
	setTimeout(() => {
		filterOperatorSuggestions.value = []
	}, 160)
}

function onFilterOperatorConfirm() {
	filters.operator = normalizeString(filters.operator)
	clearFilterOperatorSuggestions()
	onSearch(true)
}

function selectFilterOperatorSuggestion(item) {
	const name = normalizeString(item?.name || item?.label)
	if (!name) return
	filters.operator = name
	clearFilterOperatorSuggestions()
}

function clearSingleCreateSuggestTimer() {
	if (!singleCreateSuggestTimer) return
	clearTimeout(singleCreateSuggestTimer)
	singleCreateSuggestTimer = 0
}

function clearSingleCreateSuggestions() {
	singleCreateBottleSuggestions.value = []
	singleCreateSuggestLoading.value = false
	clearSingleCreateSuggestTimer()
}

function clearSingleCreateResolveTimer() {
	if (!singleCreateResolveTimer) return
	clearTimeout(singleCreateResolveTimer)
	singleCreateResolveTimer = 0
}

function resetSingleCreateResolveState(message = '') {
	clearSingleCreateResolveTimer()
	singleCreateResolveLoading.value = false
	singleCreateResolveResult.value = null
	singleCreateResolveError.value = normalizeString(message)
}

function getSingleCreateSuggestionNo(item) {
	if (!item || typeof item !== 'object') return ''
	if (normalizeString(item._suggest_source) === 'vehicle') {
		return normalizeBottleNo(item.plate_no || item.bottle_no)
	}
	return normalizeBottleNo(item.bottle_no || item.plate_no)
}

function formatBottleSuggestionSub(item) {
	if (normalizeString(item?._suggest_source) === 'vehicle') {
		const remark = normalizeString(item?.remark)
		return remark ? `车辆档案 · ${remark}` : '车辆档案'
	}
	const status = getStatusLabel(item?.status)
	const customer = normalizeString(item?.current_customer_name)
	return customer ? `${status} · ${customer}` : status
}

async function fetchSingleCreateBottleSuggestions(keyword) {
	const targetKeyword = normalizeString(keyword)
	if (!targetKeyword) {
		singleCreateBottleSuggestions.value = []
		singleCreateSuggestLoading.value = false
		return
	}
	singleCreateSuggestLoading.value = true
	try {
		const useVehicle = singleCreateUseVehicleSuggestion.value
		const res = useVehicle
			? await searchVehiclesV1({ keyword: targetKeyword, limit: 20, is_active: true })
			: null
		const bottleList = useVehicle ? [] : await searchBottleSuggestions(targetKeyword, { limit: 20 })
		if (normalizeBottleNo(singleCreateForm.bottle_no) !== normalizeBottleNo(targetKeyword)) return
		if (useVehicle && res?.code !== 0) {
			singleCreateBottleSuggestions.value = []
			return
		}
		if (useVehicle && !Array.isArray(res.data)) {
			singleCreateBottleSuggestions.value = []
			return
		}
		if (useVehicle) {
			singleCreateBottleSuggestions.value = res.data
				.filter((item) => Boolean(item) && item.is_active !== false)
				.map((item) => ({
					...(item || {}),
					_suggest_source: 'vehicle',
					bottle_no: normalizeBottleNo(item?.plate_no || item?.bottle_no)
				}))
				.filter((item) => Boolean(item.bottle_no))
				.slice(0, 20)
			return
		}
		singleCreateBottleSuggestions.value = bottleList
			.map((item) => ({
				...(item || {}),
				_suggest_source: 'bottle'
			}))
	} finally {
		singleCreateSuggestLoading.value = false
	}
}

function onSingleCreateBottleInput(value) {
	const text = normalizeString(value)
	clearSingleCreateSuggestTimer()
	if (!text) {
		singleCreateBottleSuggestions.value = []
		return
	}
	singleCreateSuggestTimer = setTimeout(() => {
		fetchSingleCreateBottleSuggestions(text)
	}, 180)
}

function onSingleCreateBottleFocus() {
	singleCreateBottleFocusFlag.value = false
	const text = normalizeString(singleCreateForm.bottle_no)
	if (!text) return
	clearSingleCreateSuggestTimer()
	singleCreateSuggestTimer = setTimeout(() => {
		fetchSingleCreateBottleSuggestions(text)
	}, 120)
}

function onSingleCreateBottleBlur() {
	singleCreateBottleFocusFlag.value = false
	setTimeout(() => {
		singleCreateBottleSuggestions.value = []
	}, 160)
}

function onSingleCreateBottleConfirm() {
	const normalized = normalizeBottleNo(singleCreateForm.bottle_no)
	if (normalized) singleCreateForm.bottle_no = normalized
}

function buildSingleCreateResolvePayload() {
	const date = normalizeString(singleCreateForm.date)
	if (!isValidDateString(date)) return { ok: false, msg: '请选择合法的灌装日期' }
	const bottleNo = normalizeBottleNo(singleCreateForm.bottle_no)
	if (!bottleNo) return { ok: false, msg: `请输入${singleCreateIdentifierBaseLabel.value}` }
	const totalWeightText = normalizeString(singleCreateForm.after_fill_total_weight)
	if (!totalWeightText) return { ok: false, msg: '请输入灌后总重' }
	const afterFillTotalWeight = Number(totalWeightText)
	if (!Number.isFinite(afterFillTotalWeight) || afterFillTotalWeight <= 0) {
		return { ok: false, msg: '灌后总重必须大于 0' }
	}
	return {
		ok: true,
		data: {
			date,
			record_type: normalizeRecordType(singleCreateForm.record_type, 'normal_fill'),
			bottle_no: bottleNo,
			after_fill_total_weight: afterFillTotalWeight
		}
	}
}

function buildSingleCreateResolveKey(payload) {
	if (!payload || typeof payload !== 'object') return ''
	return JSON.stringify({
		date: normalizeString(payload.date),
		record_type: normalizeRecordType(payload.record_type, 'normal_fill'),
		bottle_no: normalizeBottleNo(payload.bottle_no),
		after_fill_total_weight: Number(payload.after_fill_total_weight || 0)
	})
}

async function runSingleCreateResolve(payload, expectedKey, requestToken) {
	if (!payload || requestToken !== singleCreateResolveToken) return
	if (buildSingleCreateResolveKey(payload) !== expectedKey) return
	singleCreateResolveLoading.value = true
	try {
		const res = await resolveFillingFillWeightV1(payload)
		if (requestToken !== singleCreateResolveToken) return
		if (res?.code !== 0) {
			singleCreateResolveResult.value = null
			singleCreateResolveError.value = normalizeString(res?.msg) || '推导失败'
			return
		}
		const data = res?.data && typeof res.data === 'object' ? res.data : null
		if (!data) {
			singleCreateResolveResult.value = null
			singleCreateResolveError.value = '未返回推导结果'
			return
		}
		singleCreateResolveResult.value = {
			...data,
			after_fill_total_weight: data.after_fill_total_weight ?? payload.after_fill_total_weight
		}
		singleCreateResolveError.value = ''
	} catch (err) {
		if (requestToken !== singleCreateResolveToken) return
		singleCreateResolveResult.value = null
		singleCreateResolveError.value = normalizeString(err?.message) || '推导失败'
	} finally {
		if (requestToken === singleCreateResolveToken) singleCreateResolveLoading.value = false
	}
}

function refreshSingleCreateResolveState({ immediate = false } = {}) {
	clearSingleCreateResolveTimer()
	const requestToken = singleCreateResolveToken + 1
	singleCreateResolveToken = requestToken
	if (singleCreateInputMode.value !== 'after_fill_total') {
		resetSingleCreateResolveState()
		return
	}
	const built = buildSingleCreateResolvePayload()
	if (!built.ok) {
		resetSingleCreateResolveState(built.msg)
		return
	}
	singleCreateResolveLoading.value = false
	singleCreateResolveResult.value = null
	singleCreateResolveError.value = ''
	const payload = built.data
	const expectedKey = buildSingleCreateResolveKey(payload)
	if (immediate) {
		void runSingleCreateResolve(payload, expectedKey, requestToken)
		return
	}
	singleCreateResolveTimer = setTimeout(() => {
		void runSingleCreateResolve(payload, expectedKey, requestToken)
	}, 220)
}

function onSingleCreateInputModeChange(mode) {
	const nextMode = resolveInputModeByRecordType(singleCreateForm.record_type, mode, 'after_fill_total')
	if (singleCreateForm.input_mode === nextMode) return
	singleCreateForm.input_mode = nextMode
	if (nextMode === 'after_fill_total') singleCreateForm.fill_weight = ''
	else if (isTruckOutNoSaleRecordType(singleCreateForm.record_type) && !normalizeString(singleCreateForm.fill_weight)) {
		singleCreateForm.fill_weight = normalizeString(singleCreateForm.after_fill_total_weight)
	}
	refreshSingleCreateResolveState()
}

function selectSingleCreateBottleSuggestion(item) {
	const bottleNo = getSingleCreateSuggestionNo(item)
	if (!bottleNo) return
	singleCreateForm.bottle_no = bottleNo
	singleCreateBottleSuggestions.value = []
}

async function openSingleCreatePanel({ focusBottle = false, scrollToPanel = false } = {}) {
	singleCreatePanelOpen.value = true
	await nextTick()
	if (scrollToPanel) {
		uni.pageScrollTo({
			selector: '#single-filling-section',
			duration: 200
		})
	}
	if (focusBottle) {
		singleCreateBottleFocusFlag.value = true
		setTimeout(() => {
			singleCreateBottleFocusFlag.value = false
		}, 320)
	}
}

async function applyRoutePreset(params = {}) {
	if (!hasSingleCreateRoutePreset(params)) return false
	onSingleCreateReset()
	const routeRecordType = normalizeRecordType(
		params.record_type || params.recordType || params.presetRecordType,
		'normal_fill'
	)
	const inputMode = resolveInputModeByRecordType(
		routeRecordType,
		params.input_mode || params.inputMode || params.presetInputMode || 'net',
		'net'
	)
	const presetDate = normalizeString(params.date || params.presetDate)
	singleCreateForm.date = isValidDateString(presetDate) ? presetDate : formatTodayUtc8()
	singleCreateForm.input_mode = inputMode
	singleCreateForm.record_type = routeRecordType
	singleCreateForm.bottle_no = normalizeBottleNo(params.bottle_no || params.bottleNo || params.presetBottleNo)
	singleCreateForm.remark = normalizeString(params.remark || params.presetRemark)
	if (inputMode === 'after_fill_total') {
		singleCreateForm.after_fill_total_weight = normalizeString(
			params.after_fill_total_weight || params.afterFillTotalWeight || params.presetFillWeight
		)
		singleCreateForm.fill_weight = ''
	} else {
		singleCreateForm.fill_weight = normalizeString(
			params.fill_weight || params.fillWeight || params.presetFillWeight
		)
		singleCreateForm.after_fill_total_weight = ''
	}
	singleCreateRouteContext.sourceAnomalyId = normalizeString(
		params.source_anomaly_id || params.sourceAnomalyId || params.presetSourceAnomalyId
	)
	singleCreateRouteContext.returnToAnomaly = normalizeBooleanFlag(
		params.return_to_anomaly || params.returnToAnomaly || params.presetReturnToAnomaly
	)
	singleCreateRouteContext.returnScrollTop = normalizeScrollTop(
		params.return_scroll_top || params.returnScrollTop || params.presetReturnScrollTop
	)
	await openSingleCreatePanel({ focusBottle: true, scrollToPanel: true })
	return true
}

function toggleSingleCreatePanel() {
	singleCreatePanelOpen.value = !singleCreatePanelOpen.value
	if (!singleCreatePanelOpen.value) {
		clearSingleCreateSuggestions()
		clearSingleCreateResolveTimer()
		return
	}
	refreshSingleCreateResolveState()
}

function onSingleCreateDateChange(event) {
	singleCreateForm.date = normalizeString(event?.detail?.value)
}

function onSingleCreateRecordTypeChange(event) {
	const idx = Number(event?.detail?.value)
	singleCreateForm.record_type = RECORD_TYPE_OPTIONS[idx]?.value || 'normal_fill'
	const nextMode = resolveInputModeByRecordType(singleCreateForm.record_type, singleCreateForm.input_mode, 'after_fill_total')
	if (singleCreateForm.input_mode !== nextMode) singleCreateForm.input_mode = nextMode
	clearSingleCreateSuggestions()
	refreshSingleCreateResolveState()
}

function onSingleCreateOperatorChange(event) {
	const idx = Number(event?.detail?.value)
	const option = operatorOptions.value[idx]
	if (!option) return
	setSingleCreateOperatorByOption(option)
}

function onSingleCreateReset() {
	singleCreateForm.date = formatTodayUtc8()
	singleCreateForm.input_mode = 'after_fill_total'
	singleCreateForm.bottle_no = ''
	singleCreateForm.after_fill_total_weight = ''
	singleCreateForm.fill_weight = ''
	singleCreateForm.record_type = 'normal_fill'
	singleCreateForm.operator = ''
	singleCreateForm.operator_id = ''
	singleCreateForm.remark = ''
	applySingleCreateDefaultOperator()
	clearSingleCreateSuggestions()
	resetSingleCreateResolveState()
	clearSingleCreateRouteContext()
}

function extractFillingBottleFlowWarningData(source) {
	if (source?.data && typeof source.data === 'object') return source.data
	if (source && typeof source === 'object') return source
	return {}
}

function isFillingBottleFlowWarningResult(result) {
	return Number(result?.code || 0) === 409
		&& Boolean(result?.data?.confirmable)
		&& String(result?.data?.warning_kind || '') === 'bottle_flow_mismatch'
		&& Array.isArray(result?.data?.warning_items)
		&& result.data.warning_items.length > 0
}

function buildFillingBottleFlowWarningContent(source) {
	const data = extractFillingBottleFlowWarningData(source)
	const items = Array.isArray(data.warning_items) ? data.warning_items : []
	const summaryText = normalizeString(data.summary_text || source?.msg || '发现瓶流转异常，请核对')
	const preview = items.slice(0, 6).map((item, index) => {
		const bottleNo = normalizeString(item?.bottle_no) || '-'
		const reason = normalizeString(item?.reason) || '请检查'
		return `${index + 1}. ${bottleNo}：${reason}`
	})
	if (items.length > preview.length) preview.push(`等 ${items.length} 条，请确认是否仍要继续提交。`)
	else preview.push('请确认是否仍要继续提交。')
	return [summaryText, '', ...preview].join('\n')
}

function isMissingRecentBackBasisError(message) {
	const text = normalizeString(message)
	if (!text) return false
	return /未找到(?:瓶号|车牌).*(?:最近回瓶总重|最近回站总重)/.test(text)
}

function countMissingRecentBackBasisInvalidItems(items = []) {
	if (!Array.isArray(items) || !items.length) return 0
	return items.reduce((count, item) => {
		return count + (isMissingRecentBackBasisError(item?.error) ? 1 : 0)
	}, 0)
}

function switchSingleCreateToNetModeWithGuideToast() {
	onSingleCreateInputModeChange('net')
	uni.showToast({ title: '已切换为净重录入，请填写净重后保存', icon: 'none', duration: 2800 })
}

function switchBatchCreateToNetModeWithGuideToast() {
	onBatchCreateInputModeChange('net')
	uni.showToast({ title: '已切换为净重录入，请填写净重后保存', icon: 'none', duration: 2800 })
}

async function promptSwitchSingleCreateToNetMode() {
	const confirmRes = await uni.showModal({
		title: '缺少回瓶基准',
		content: `${MISSING_RECENT_BACK_BASIS_GUIDE_TEXT}\n\n是否切换为净重录入？`,
		confirmText: '切换净重录入',
		cancelText: '继续修改'
	})
	if (!confirmRes.confirm) return false
	switchSingleCreateToNetModeWithGuideToast()
	return true
}

async function promptSwitchBatchCreateToNetMode(missingTotal = 0) {
	const countText = Number(missingTotal) > 0 ? `检测到 ${Number(missingTotal)} 条记录缺少最近回瓶基准。\n` : ''
	const confirmRes = await uni.showModal({
		title: '批量总重推导受限',
		content: `${countText}${MISSING_RECENT_BACK_BASIS_GUIDE_TEXT}\n\n是否切换为批量净重录入？`,
		confirmText: '切换批量净重',
		cancelText: '继续修改'
	})
	if (!confirmRes.confirm) return false
	switchBatchCreateToNetModeWithGuideToast()
	return true
}

function buildSingleCreatePayload() {
	const date = normalizeString(singleCreateForm.date)
	if (!isValidDateString(date)) {
		uni.showToast({ title: '请选择合法的灌装日期', icon: 'none' })
		return null
	}
	const recordType = normalizeRecordType(singleCreateForm.record_type, 'normal_fill')
	const bottleNo = normalizeBottleNo(singleCreateForm.bottle_no)
	const inputMode = resolveInputModeByRecordType(recordType, singleCreateForm.input_mode, 'after_fill_total')
	if (inputMode === 'after_fill_total' && !bottleNo) {
		uni.showToast({ title: `请填写${singleCreateIdentifierBaseLabel.value}`, icon: 'none' })
		return null
	}
	if (isInventoryLinkedRecordType(recordType) && !bottleNo) {
		uni.showToast({ title: '该作业类型必须填写瓶号', icon: 'none' })
		return null
	}
	const operator = normalizeString(singleCreateForm.operator)
	if (!operator) {
		uni.showToast({ title: '请选择操作人', icon: 'none' })
		return null
	}
	const payload = {
		date,
		bottle_no: bottleNo,
		input_mode: inputMode,
		record_type: recordType,
		operator,
		operator_id: normalizeId(singleCreateForm.operator_id),
		remark: normalizeString(singleCreateForm.remark)
	}
	if (inputMode === 'after_fill_total') {
		const afterFillTotalWeight = Number(singleCreateForm.after_fill_total_weight)
		if (!Number.isFinite(afterFillTotalWeight) || afterFillTotalWeight <= 0) {
			uni.showToast({ title: '灌后总重必须大于 0', icon: 'none' })
			return null
		}
		return {
			...payload,
			after_fill_total_weight: afterFillTotalWeight
		}
	}
	let fillWeight = Number(singleCreateForm.fill_weight)
	if ((!Number.isFinite(fillWeight) || fillWeight <= 0) && isTruckOutNoSaleRecordType(recordType)) {
		fillWeight = Number(singleCreateForm.after_fill_total_weight)
	}
	if (!Number.isFinite(fillWeight) || fillWeight <= 0) {
		uni.showToast({ title: '灌装净重必须大于 0', icon: 'none' })
		return null
	}
	return {
		...payload,
		fill_weight: fillWeight
	}
}

async function onSingleCreateSubmit() {
	if (singleCreateSubmitting.value) return
	const payload = buildSingleCreatePayload()
	if (!payload) return
	singleCreateSubmitting.value = true
	try {
		let res = await createFillingV1(payload)
		if (isFillingBottleFlowWarningResult(res)) {
			const confirmRes = await uni.showModal({
				title: '请核对瓶号',
				content: buildFillingBottleFlowWarningContent(res),
				confirmText: '继续提交',
				cancelText: '返回修改'
			})
			if (!confirmRes.confirm) return
			res = await createFillingV1(payload, { ignoreBottleFlowWarning: true })
		}
		if (res?.code !== 0) {
			const failMsg = normalizeString(res?.msg) || '保存失败'
			if (singleCreateInputMode.value === 'after_fill_total' && isMissingRecentBackBasisError(failMsg)) {
				await promptSwitchSingleCreateToNetMode()
				return
			}
			uni.showToast({ title: failMsg, icon: 'none', duration: 2800 })
			return
		}
		const shouldReturnToAnomaly = Boolean(singleCreateRouteContext.returnToAnomaly)
		const savedWithOverride = Boolean(res?.data?.bottle_flow_warning_overridden) && Number(res?.data?.bottle_flow_warning_count || 0) > 0
		uni.showToast({ title: savedWithOverride ? '已核对并保存' : (res?.msg || '保存成功'), icon: 'success' })
		singleCreateForm.bottle_no = ''
		singleCreateForm.after_fill_total_weight = ''
		singleCreateForm.fill_weight = ''
		singleCreateForm.remark = ''
		clearSingleCreateSuggestions()
		resetSingleCreateResolveState()
		if (shouldReturnToAnomaly) {
			const backfillReturnPayload = {
				sourceAnomalyId: singleCreateRouteContext.sourceAnomalyId,
				bottleNo: payload.bottle_no,
				scrollTop: singleCreateRouteContext.returnScrollTop
			}
			uni.$emit(ANOMALY_BACKFILL_SAVED_EVENT, backfillReturnPayload)
			try {
				uni.setStorageSync(ANOMALY_BACKFILL_SAVED_STORAGE_KEY, backfillReturnPayload)
			} catch (err) {
				console.error('save anomaly backfill return payload failed', err)
			}
			clearSingleCreateRouteContext()
			setTimeout(() => {
				uni.navigateBack({ delta: 1 })
			}, 300)
			return
		}
		clearSingleCreateRouteContext()
		await onSearch(true, { force: true })
		await openSingleCreatePanel({ focusBottle: true, scrollToPanel: false })
	} catch (err) {
		uni.showToast({ title: err?.message || '保存失败', icon: 'none', duration: 2800 })
	} finally {
		singleCreateSubmitting.value = false
	}
}

function onBatchCreateDateChange(event) {
	batchCreateForm.date = normalizeString(event?.detail?.value)
	clearBatchCreateResultState()
}

function onBatchCreateRecordTypeChange(event) {
	const idx = Number(event?.detail?.value)
	batchCreateForm.record_type = RECORD_TYPE_OPTIONS[idx]?.value || 'normal_fill'
	const nextMode = resolveInputModeByRecordType(batchCreateForm.record_type, batchCreateForm.input_mode, 'after_fill_total')
	if (batchCreateForm.input_mode !== nextMode) batchCreateForm.input_mode = nextMode
	clearBatchCreateResultState()
}

function onBatchCreateInputModeChange(mode) {
	batchCreateForm.input_mode = resolveInputModeByRecordType(batchCreateForm.record_type, mode, 'after_fill_total')
	if (batchCreateForm.input_mode === 'after_fill_total') batchCreateForm.defaultFillWeight = ''
	clearBatchCreateResultState()
}

function onBatchCreateOperatorChange(event) {
	const idx = Number(event?.detail?.value)
	const option = operatorOptions.value[idx]
	if (!option) return
	setBatchCreateOperatorByOption(option)
	clearBatchCreateResultState()
}

function onBatchCreateReset() {
	batchCreateForm.date = formatTodayUtc8()
	batchCreateForm.input_mode = 'after_fill_total'
	batchCreateForm.record_type = 'normal_fill'
	batchCreateForm.operator = ''
	batchCreateForm.operator_id = ''
	batchCreateForm.defaultFillWeight = ''
	batchCreateForm.remark = ''
	batchCreateForm.batchText = ''
	applyBatchCreateDefaultOperator()
	clearBatchCreateResultState()
}

function buildBatchCreatePayload(preview) {
	const date = normalizeString(batchCreateForm.date)
	if (!isValidDateString(date)) {
		uni.showToast({ title: '请选择合法的灌装日期', icon: 'none' })
		return null
	}
	const text = normalizeString(batchCreateForm.batchText)
	if (!text) {
		uni.showToast({ title: '请先输入批量内容', icon: 'none' })
		return null
	}
	const recordType = normalizeRecordType(batchCreateForm.record_type, 'normal_fill')
	const inputMode = resolveInputModeByRecordType(recordType, batchCreateForm.input_mode, 'after_fill_total')
	const defaultWeightText = normalizeString(batchCreateForm.defaultFillWeight)
	if (inputMode === 'net' && defaultWeightText) {
		const num = Number(defaultWeightText)
		if (!Number.isFinite(num) || num <= 0) {
			uni.showToast({ title: '默认净重必须大于 0', icon: 'none' })
			return null
		}
	}
	const operator = normalizeString(batchCreateForm.operator)
	if (!operator) {
		uni.showToast({ title: '请选择操作人', icon: 'none' })
		return null
	}
	return {
		preview: Boolean(preview),
		date,
		record_type: recordType,
		input_mode: inputMode,
		operator,
		operator_id: normalizeId(batchCreateForm.operator_id),
		remark: normalizeString(batchCreateForm.remark),
		default_fill_weight: inputMode === 'net' ? defaultWeightText : '',
		batch_text: text
	}
}

async function onBatchCreatePreview() {
	if (batchCreatePreviewLoading.value || batchCreateExecuting.value) return
	const payload = buildBatchCreatePayload(true)
	if (!payload) return
	batchCreatePreviewLoading.value = true
	batchCreateExecuteResult.value = null
	try {
		const res = await batchCreateFillingsV1(payload)
		if (res?.code !== 0) {
			batchCreatePreviewResult.value = null
			const failMsg = normalizeString(res?.msg) || '预览失败'
			if (payload.input_mode === 'after_fill_total' && isMissingRecentBackBasisError(failMsg)) {
				await promptSwitchBatchCreateToNetMode()
				return
			}
			uni.showToast({ title: failMsg, icon: 'none', duration: 2600 })
			return
		}
		batchCreatePreviewResult.value = res.data || null
		uni.showToast({
			title: Number(res?.data?.warning_total || 0) > 0
				? `预览可新增 ${Number(res?.data?.target_total || 0)} 条，含 ${Number(res?.data?.warning_total || 0)} 条预警`
				: `预览可新增 ${Number(res?.data?.target_total || 0)} 条`,
			icon: 'none'
		})
	} catch (err) {
		batchCreatePreviewResult.value = null
		uni.showToast({ title: err?.message || '预览失败', icon: 'none', duration: 2600 })
	} finally {
		batchCreatePreviewLoading.value = false
	}
}

async function onBatchCreateExecute() {
	if (batchCreateExecuting.value || batchCreatePreviewLoading.value) return
	const previewPayload = buildBatchCreatePayload(true)
	if (!previewPayload) return
	batchCreateExecuting.value = true
	batchCreateExecuteResult.value = null
	try {
		const previewRes = await batchCreateFillingsV1(previewPayload)
		if (previewRes?.code !== 0) {
			const previewFailMsg = normalizeString(previewRes?.msg) || '预览失败'
			if (previewPayload.input_mode === 'after_fill_total' && isMissingRecentBackBasisError(previewFailMsg)) {
				await promptSwitchBatchCreateToNetMode()
				return
			}
			uni.showToast({ title: previewFailMsg, icon: 'none', duration: 2600 })
			return
		}
		const previewData = previewRes.data || {}
		batchCreatePreviewResult.value = previewData
		const total = Number(previewData.target_total || 0)
		const missingBasisTotal = countMissingRecentBackBasisInvalidItems(previewData.invalid_items)
		if (total <= 0) {
			if (previewPayload.input_mode === 'after_fill_total' && missingBasisTotal > 0) {
				await promptSwitchBatchCreateToNetMode(missingBasisTotal)
				return
			}
			uni.showToast({ title: '没有可新增的数据', icon: 'none' })
			return
		}
		if (total > BATCH_LIMIT) {
			uni.showToast({ title: `单次最多新增 ${BATCH_LIMIT} 条，请拆批`, icon: 'none', duration: 2800 })
			return
		}
		const warningTotal = Number(previewData.warning_total || 0)
		const confirmRes = warningTotal > 0
			? await uni.showModal({
				title: '请核对瓶号',
				content: buildFillingBottleFlowWarningContent(previewData),
				confirmText: '继续执行',
				cancelText: '返回修改'
			})
			: await uni.showModal({
				title: '确认批量新增',
				content: `将新增 ${total} 条灌装记录（日期 ${previewData.date}，类型 ${batchCreateRecordTypeLabel.value}，操作人 ${batchCreateOperatorLabel.value}），确认执行吗？`,
				showCancel: true
			})
		if (!confirmRes.confirm) return
		let executeRes = await batchCreateFillingsV1({
			...previewPayload,
			preview: false,
			...(warningTotal > 0 ? { ignoreBottleFlowWarning: true } : {})
		})
		if (isFillingBottleFlowWarningResult(executeRes)) {
			const warningConfirmRes = await uni.showModal({
				title: '请核对瓶号',
				content: buildFillingBottleFlowWarningContent(executeRes),
				confirmText: '继续执行',
				cancelText: '返回修改'
			})
			if (!warningConfirmRes.confirm) return
			executeRes = await batchCreateFillingsV1({
				...previewPayload,
				preview: false,
				ignoreBottleFlowWarning: true
			})
		}
		if (executeRes?.code !== 0) {
			const executeFailMsg = normalizeString(executeRes?.msg) || '执行失败'
			if (previewPayload.input_mode === 'after_fill_total' && isMissingRecentBackBasisError(executeFailMsg)) {
				await promptSwitchBatchCreateToNetMode()
				return
			}
			uni.showToast({ title: executeFailMsg, icon: 'none', duration: 2800 })
			return
		}
		batchCreateExecuteResult.value = executeRes.data || null
		const failed = Number(executeRes.data?.failed || 0)
		const success = Number(executeRes.data?.success || 0)
		const warningCount = Number(executeRes.data?.bottle_flow_warning_count || 0)
		const savedWithOverride = Boolean(executeRes.data?.bottle_flow_warning_overridden) && warningCount > 0
		uni.showToast({
			title: failed > 0
				? `新增完成：成功${success}，失败${failed}${savedWithOverride ? `，已忽略${warningCount}条预警` : ''}`
				: savedWithOverride
					? `新增成功 ${success} 条（已忽略${warningCount}条预警）`
					: `新增成功 ${success} 条`,
			icon: failed > 0 ? 'none' : 'success',
			duration: 3000
		})
		await onSearch(true, { force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '执行失败', icon: 'none', duration: 2800 })
	} finally {
		batchCreateExecuting.value = false
	}
}

function onBatchScopeChange(event) {
	const idx = Number(event?.detail?.value)
	batchForm.scopeMode = batchScopeOptions[idx]?.value || 'filter'
	clearBatchResultState()
	if (batchForm.scopeMode === 'ids' && !selectedFillingIds.value.length) {
		uni.showToast({ title: '请先勾选要修改的记录', icon: 'none' })
	}
}

function onBatchDateChange(event) {
	batchForm.newDate = normalizeString(event?.detail?.value)
	clearBatchResultState()
}

function onBatchReset() {
	batchForm.scopeMode = 'filter'
	batchForm.newDate = ''
	clearBatchResultState()
}

function buildBatchSelectorByFilters() {
	const selector = {}
	const bottleNo = normalizeString(filters.bottle_no)
	const operator = normalizeString(filters.operator)
	const recordType = normalizeRecordType(filters.record_type, '')
	const saleState = normalizeSaleStateFilter(filters.sale_state, '')
	const dateStart = normalizeString(filters.dateStart)
	const dateEnd = normalizeString(filters.dateEnd)
	if (bottleNo) selector.bottle_no = bottleNo
	if (operator) selector.operator = operator
	if (recordType) selector.record_type = recordType
	if (saleState) selector.sale_state = saleState
	if (dateStart) selector.dateStart = dateStart
	if (dateEnd) selector.dateEnd = dateEnd
	return selector
}

function buildBatchPayload(preview) {
	const newDate = normalizeString(batchForm.newDate)
	if (!isValidDateString(newDate)) {
		uni.showToast({ title: '请选择合法的新灌装日期', icon: 'none' })
		return null
	}
	const payload = {
		preview: Boolean(preview),
		scope_mode: batchForm.scopeMode === 'ids' ? 'ids' : 'filter',
		selector: {},
		new_date: newDate
	}
	if (payload.scope_mode === 'ids') {
		const ids = normalizeUniqueIds(selectedFillingIds.value)
		if (!ids.length) {
			uni.showToast({ title: '勾选子集为空，请先勾选记录', icon: 'none' })
			return null
		}
		payload.selector = { ids }
		return payload
	}
	payload.selector = buildBatchSelectorByFilters()
	return payload
}

function formatBottleNoSamples(samples) {
	const listData = Array.isArray(samples) ? samples.map((item) => normalizeString(item)).filter(Boolean) : []
	if (!listData.length) return '无'
	const preview = listData.slice(0, 12).join('、')
	return listData.length > 12 ? `${preview} ...` : preview
}

function formatBatchCreatePreviewCreateItem(item) {
	const lineNo = Number(item?.line_no || 0)
	const bottleNo = normalizeString(item?.bottle_no) || '-'
	const fillWeight = Number(item?.fill_weight)
	const weightText = Number.isFinite(fillWeight) ? formatWeightValue(fillWeight) : '-'
	const warningReason = normalizeString(item?.warning_reason)
	const weightStart = Number(item?.weight_start)
	const weightEnd = Number(item?.weight_end)
	if (Number.isFinite(weightStart) && weightStart > 0 && Number.isFinite(weightEnd) && weightEnd > 0) {
		const basisValue = Number(item?.basis_value)
		const status = normalizeString(item?.loss_match_status)
		const startLoss = Number(item?.start_loss_weight)
		const matchText = Number.isFinite(basisValue)
			? `上秤差 ${Number.isFinite(startLoss) ? formatWeightValue(startLoss) : '-'}kg · 依据 ${getDerivedBasisSourceLabel(item?.basis_source)} ${formatWeightValue(basisValue)}kg · 来源 ${formatDerivedBasisRef(item)}`
			: (status === 'pending' || item?.basis_missing ? '待销售回瓶自动补算上秤差' : '未生成上秤差')
		const baseText = `行${lineNo || '-'} · ${bottleNo} · 上秤 ${formatWeightValue(weightStart)}kg · 灌完 ${formatWeightValue(weightEnd)}kg · 净重 ${weightText}kg · ${matchText}`
		return warningReason ? `${baseText} · 预警 ${warningReason}` : baseText
	}
	const baseText = `行${lineNo || '-'} · ${bottleNo} · ${weightText}kg`
	return warningReason ? `${baseText} · 预警 ${warningReason}` : baseText
}

function formatBatchCreatePreviewIssueItem(item) {
	const lineNo = Number(item?.line_no || 0)
	const bottleNo = normalizeString(item?.bottle_no) || '-'
	const error = normalizeString(item?.error) || '无效数据'
	return `行${lineNo || '-'} · ${bottleNo} · ${error}`
}

function formatBatchCreatePreviewWarningItem(item) {
	const bottleNo = normalizeString(item?.bottle_no) || '-'
	const reason = normalizeString(item?.reason) || '请检查'
	return `${bottleNo} · ${reason}`
}

function formatFailedItems(items) {
	const listData = Array.isArray(items) ? items : []
	if (!listData.length) return '无'
	const values = listData
		.slice(0, 15)
		.map((row) => {
			const bottleNo = normalizeString(row?.bottle_no)
			const id = normalizeString(row?._id)
			return bottleNo || id || '-'
		})
		.filter(Boolean)
	const text = values.join('、') || '无'
	return listData.length > 15 ? `${text} ...` : text
}

function normalizeBottleNoForSort(value) {
	return String(value == null ? '' : value).trim().toUpperCase()
}

function compareBottleNoNatural(leftValue, rightValue) {
	const left = normalizeBottleNoForSort(leftValue)
	const right = normalizeBottleNoForSort(rightValue)
	const leftIsNumber = /^\d+$/.test(left)
	const rightIsNumber = /^\d+$/.test(right)
	if (leftIsNumber && rightIsNumber) return Number(left) - Number(right)
	if (leftIsNumber && !rightIsNumber) return -1
	if (!leftIsNumber && rightIsNumber) return 1
	return left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

function compareFillingForExport(a, b) {
	const leftDate = normalizeString(a?.date)
	const rightDate = normalizeString(b?.date)
	if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
	const leftCreatedAt = Number(a?.created_at || 0)
	const rightCreatedAt = Number(b?.created_at || 0)
	if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt
	const bottleCompare = compareBottleNoNatural(a?.bottle_no, b?.bottle_no)
	if (bottleCompare !== 0) return bottleCompare
	return normalizeString(a?._id).localeCompare(normalizeString(b?._id))
}

function toCsvCell(value) {
	const text = value == null ? '' : String(value)
	if (!/[",\n\r]/.test(text)) return text
	return `"${text.replace(/"/g, '""')}"`
}

function formatExportTimestamp(date = new Date()) {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	const ss = String(date.getSeconds()).padStart(2, '0')
	return `${y}${m}${d}_${hh}${mm}${ss}`
}

function formatDateCompact(value) {
	return normalizeString(value).replace(/-/g, '')
}

function normalizeFileNamePart(value, fallback = '全部') {
	const text = normalizeString(value)
	if (!text) return fallback
	return (
		text
			.replace(/[\\/:*?"<>|]/g, '-')
			.replace(/\s+/g, '')
			.slice(0, 24) || fallback
	)
}

function buildFillingExportFileName(total) {
	const typePart = normalizeFileNamePart(
		filters.record_type ? getRecordTypeLabel(filters.record_type) : '全部类型',
		'全部类型'
	)
	const start = normalizeString(filters.dateStart)
	const end = normalizeString(filters.dateEnd)
	let datePart = '日期-全部'
	if (start && end) datePart = `日期-${formatDateCompact(start)}_${formatDateCompact(end)}`
	else if (start) datePart = `日期-${formatDateCompact(start)}_今`
	else if (end) datePart = `日期-起_${formatDateCompact(end)}`
	const bottlePart = `瓶号-${normalizeFileNamePart(filters.bottle_no, '全部')}`
	const operatorPart = `操作人-${normalizeFileNamePart(filters.operator, '全部')}`
	const saleStatePart = `销售状态-${normalizeFileNamePart(getSaleStateLabel(filters.sale_state), '全部')}`
	return `灌装记录_类型-${typePart}_${saleStatePart}_${datePart}_${bottlePart}_${operatorPart}_${total}条_${formatExportTimestamp()}.csv`
}

function buildFilledUnsoldExportFileName(total) {
	const start = normalizeString(filters.dateStart)
	const end = normalizeString(filters.dateEnd)
	let datePart = '日期-全部'
	if (start && end) datePart = `日期-${formatDateCompact(start)}_${formatDateCompact(end)}`
	else if (start) datePart = `日期-${formatDateCompact(start)}_今`
	else if (end) datePart = `日期-起_${formatDateCompact(end)}`
	const bottlePart = `瓶号-${normalizeFileNamePart(filters.bottle_no, '全部')}`
	return `已灌未售_${datePart}_${bottlePart}_${total}瓶_${formatExportTimestamp()}.csv`
}

function formatExportNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	if (Number.isInteger(num)) return String(num)
	return num.toFixed(6).replace(/\.?0+$/, '')
}

function buildFillingExportCsv(rows = []) {
	const columns = [
		{ label: '日期', get: (row) => normalizeString(row?.date) },
		{ label: '瓶号', get: (row) => normalizeString(row?.bottle_no) },
		{ label: '净重(kg)', get: (row) => formatExportNumber(row?.fill_weight) },
		{ label: '作业类型', get: (row) => getRecordTypeLabel(row?.record_type) },
		{ label: '操作人', get: (row) => normalizeString(row?.operator || row?.created_by_name) },
		{ label: '备注', get: (row) => normalizeString(row?.remark) }
	]
	const header = columns.map((col) => toCsvCell(col.label)).join(',')
	const body = rows.map((row) => columns.map((col) => toCsvCell(col.get(row))).join(','))
	return [header, ...body].join('\r\n')
}

function buildFilledUnsoldExportCsv(rows = []) {
	const columns = [
		{ label: '瓶号', get: (row) => normalizeString(row?.bottle_no) },
		{ label: '灌装净重(kg)', get: (row) => formatExportNumber(row?.fill_weight) }
	]
	const header = columns.map((col) => toCsvCell(col.label)).join(',')
	const body = rows.map((row) => columns.map((col) => toCsvCell(col.get(row))).join(','))
	return [header, ...body].join('\r\n')
}

async function fetchAllFillingsForExport({ saleState = '' } = {}) {
	const allRows = []
	const pageSize = 200
	let page = 1
	let hasMore = true
	let guard = 0
	const activeSaleState = normalizeSaleStateFilter(saleState || filters.sale_state, '')
	if (activeSaleState === 'filled_unsold') {
		const params = {
			...buildListParams({ page: 1, pageSize: 12000 }),
			sale_state: activeSaleState,
			for_export: true
		}
		const res = await listFillingsV1(params)
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const rows = Array.isArray(res.data) ? res.data : []
		return rows.map((row) => ({
			...(row || {}),
			record_type: normalizeRecordType(row?.record_type, 'normal_fill'),
			operator: normalizeString(row?.operator || row?.created_by_name)
		}))
	}
	while (hasMore) {
		guard += 1
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const params = buildListParams({ page, pageSize })
		if (activeSaleState) params.sale_state = activeSaleState
		const res = await listFillingsV1(params)
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const rows = Array.isArray(res.data) ? res.data : []
		allRows.push(
			...rows.map((row) => ({
				...(row || {}),
				record_type: normalizeRecordType(row?.record_type, 'normal_fill'),
				operator: normalizeString(row?.operator || row?.created_by_name)
			}))
		)
		const paging = res.paging || {}
		const total = Number(paging.total || res.total || allRows.length)
		hasMore = Boolean(paging.hasMore) || page * pageSize < total
		page += 1
	}
	return allRows
}

function downloadCsvOnH5(csvText, fileName) {
	if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Blob === 'undefined') return false
	const blob = new Blob([`\uFEFF${csvText}`], { type: 'text/csv;charset=utf-8;' })
	const url = window.URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	anchor.style.display = 'none'
	document.body.appendChild(anchor)
	anchor.click()
	document.body.removeChild(anchor)
	window.URL.revokeObjectURL(url)
	return true
}

async function onExport() {
	if (exporting.value) return
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const activeSaleState = normalizeSaleStateFilter(filters.sale_state, '')
		const isFilledUnsold = activeSaleState === 'filled_unsold'
		const rows = await fetchAllFillingsForExport({ saleState: activeSaleState })
		if (!rows.length) {
			uni.showToast({ title: isFilledUnsold ? '没有已灌未售数据' : '没有可导出的数据', icon: 'none' })
			return
		}
		const sortedRows = [...rows].sort(compareFillingForExport)
		const csvText = isFilledUnsold ? buildFilledUnsoldExportCsv(sortedRows) : buildFillingExportCsv(sortedRows)
		const fileName = isFilledUnsold ? buildFilledUnsoldExportFileName(sortedRows.length) : buildFillingExportFileName(sortedRows.length)
		const downloaded = downloadCsvOnH5(csvText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持下载，请在浏览器端导出', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: isFilledUnsold ? `已导出${sortedRows.length}瓶` : `已导出${sortedRows.length}条`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2800 })
	} finally {
		uni.hideLoading()
		exporting.value = false
	}
}

async function onBatchPreview() {
	if (batchPreviewLoading.value || batchExecuting.value) return
	const payload = buildBatchPayload(true)
	if (!payload) return
	batchPreviewLoading.value = true
	batchExecuteResult.value = null
	try {
		const res = await batchUpdateFillingDateV1(payload)
		if (res?.code !== 0) {
			batchPreviewResult.value = null
			uni.showToast({ title: res?.msg || '预览失败', icon: 'none', duration: 2600 })
			return
		}
		batchPreviewResult.value = res.data || null
		uni.showToast({
			title: `预览命中 ${Number(res?.data?.target_total || 0)} 条`,
			icon: 'none'
		})
	} catch (err) {
		batchPreviewResult.value = null
		uni.showToast({ title: err?.message || '预览失败', icon: 'none', duration: 2600 })
	} finally {
		batchPreviewLoading.value = false
	}
}

async function onBatchExecute() {
	if (batchExecuting.value || batchPreviewLoading.value) return
	const previewPayload = buildBatchPayload(true)
	if (!previewPayload) return
	batchExecuting.value = true
	batchExecuteResult.value = null
	try {
		const previewRes = await batchUpdateFillingDateV1(previewPayload)
		if (previewRes?.code !== 0) {
			uni.showToast({ title: previewRes?.msg || '预览失败', icon: 'none', duration: 2600 })
			return
		}
		const previewData = previewRes.data || {}
		batchPreviewResult.value = previewData
		const total = Number(previewData.target_total || 0)
		if (total <= 0) {
			uni.showToast({ title: '没有可更新的数据', icon: 'none' })
			return
		}
		if (total > BATCH_LIMIT) {
			uni.showToast({ title: `单次最多更新 ${BATCH_LIMIT} 条，请缩小范围`, icon: 'none', duration: 2800 })
			return
		}
		const confirmRes = await uni.showModal({
			title: '确认批量改日期',
			content: `将把 ${total} 条灌装记录日期统一改为 ${previewData.new_date}，确认执行吗？`,
			showCancel: true
		})
		if (!confirmRes.confirm) return
		const executeRes = await batchUpdateFillingDateV1({ ...previewPayload, preview: false })
		if (executeRes?.code !== 0) {
			uni.showToast({ title: executeRes?.msg || '执行失败', icon: 'none', duration: 2800 })
			return
		}
		batchExecuteResult.value = executeRes.data || null
		const failed = Number(executeRes.data?.failed || 0)
		const success = Number(executeRes.data?.success || 0)
		uni.showToast({
			title: failed > 0 ? `执行完成：成功${success}，失败${failed}` : `执行成功 ${success} 条`,
			icon: failed > 0 ? 'none' : 'success',
			duration: 3000
		})
		await onSearch(false, { force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '执行失败', icon: 'none', duration: 2800 })
	} finally {
		batchExecuting.value = false
	}
}

function onAdd() {
	openSingleCreatePanel({ focusBottle: true, scrollToPanel: true })
}

function onEdit(item) {
	const id = normalizeString(item?._id)
	if (!id) return
	uni.navigateTo({ url: `/pages/filling/edit?_id=${encodeURIComponent(id)}` })
}

async function onRemove(item) {
	const id = normalizeString(item?._id)
	if (!id || removingId.value) return
	const confirmRes = await uni.showModal({
		title: '删除灌装记录',
		content: '确认删除该灌装记录？删除后将同步更新该瓶异常状态。',
		showCancel: true
	})
	if (!confirmRes.confirm) return
	removingId.value = id
	try {
		const res = await removeFillingV1({ _id: id })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
			return
		}
		selectedFillingIds.value = selectedFillingIds.value.filter((rowId) => rowId !== id)
		uni.showToast({ title: res?.msg || '删除成功', icon: 'success' })
		await onSearch(false, { force: true })
	} finally {
		removingId.value = ''
	}
}

function onPrevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	onSearch()
}

function onNextPage() {
	if (!pager.hasMore) return
	pager.page += 1
	onSearch()
}

onMounted(() => {
	if (!hasSingleCreateRoutePreset(buildSingleCreateRoutePresetFromProps())) {
		onSingleCreateReset()
	}
	if (!batchCreateForm.date) batchCreateForm.date = formatTodayUtc8()
	loadOperatorOptions()
	onSearch()
})

onBeforeUnmount(() => {
	clearFilterBottleSuggestTimer()
	clearFilterOperatorSuggestTimer()
	clearSingleCreateSuggestTimer()
	clearSingleCreateResolveTimer()
})

watch(
	() => getFilterSnapshot(),
	(next, prev) => {
		if (!prev || next === prev) return
		clearSelectedFillings({ silent: true, fallbackToFilter: true })
		clearBatchResultState()
		clearBatchCreateResultState()
	}
)

watch(
	() => [
		singleCreateForm.input_mode,
		singleCreateForm.record_type,
		singleCreateForm.bottle_no,
		singleCreateForm.after_fill_total_weight,
		singleCreateForm.date
	],
	() => {
		refreshSingleCreateResolveState()
	}
)

watch(
	() => singleCreateForm.record_type,
	() => {
		const nextMode = resolveInputModeByRecordType(singleCreateForm.record_type, singleCreateForm.input_mode, 'after_fill_total')
		if (singleCreateForm.input_mode !== nextMode) {
			singleCreateForm.input_mode = nextMode
			if (nextMode === 'net' && isTruckOutNoSaleRecordType(singleCreateForm.record_type) && !normalizeString(singleCreateForm.fill_weight)) {
				singleCreateForm.fill_weight = normalizeString(singleCreateForm.after_fill_total_weight)
			}
		}
	}
)

watch(
	() => batchCreateForm.record_type,
	() => {
		const nextMode = resolveInputModeByRecordType(batchCreateForm.record_type, batchCreateForm.input_mode, 'after_fill_total')
		if (batchCreateForm.input_mode !== nextMode) batchCreateForm.input_mode = nextMode
	}
)

watch(
	() => [
		props.presetSourceAnomalyId,
		props.presetReturnToAnomaly,
		props.presetReturnScrollTop,
		props.presetBottleNo,
		props.presetDate,
		props.presetInputMode,
		props.presetRecordType,
		props.presetFillWeight,
		props.presetRemark
	],
	() => {
		const preset = buildSingleCreateRoutePresetFromProps()
		if (!hasSingleCreateRoutePreset(preset)) return
		void applyRoutePreset(preset)
	},
	{ immediate: true, flush: 'post' }
)

defineExpose({
	refresh: () => onSearch(false, { force: true }),
	applyRoutePreset
})
</script>

<style scoped>
.list-shell {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.quick-date-strip {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	overflow-x: auto;
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

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

:deep(.filter-section.section) {
	overflow: visible;
	position: relative;
	z-index: 30;
}

.filter-bottle-wrap {
	position: relative;
}

.filter-operator-wrap {
	position: relative;
}

.filter-suggestions {
	position: absolute;
	left: 0;
	right: 0;
	top: calc(100% + 8rpx);
	z-index: 80;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.08);
	max-height: 320rpx;
	overflow: auto;
}

.filter-suggestion-item {
	padding: 14rpx 16rpx;
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	border-bottom: 1rpx solid #f1f5f9;
}

.filter-suggestion-item:last-child {
	border-bottom: none;
}

.filter-suggestion-item:active {
	background: #f8fafc;
}

.filter-suggestion-no {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.filter-suggestion-sub {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.filter-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	margin-top: 16rpx;
}

.filter-chip {
	display: inline-flex;
	align-items: center;
	gap: 8rpx;
	padding: 6rpx 14rpx;
	border-radius: 999rpx;
	background: #f1f5f9;
	color: #475569;
	font-size: 22rpx;
}

.filter-chip__close {
	font-size: 24rpx;
	color: #94a3b8;
}

.mode-toggle {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	margin-bottom: 14rpx;
}

.mode-toggle__label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.mode-toggle__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}

.batch-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
}

.single-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
}

:deep(.single-create-section.section) {
	overflow: visible;
	position: relative;
	z-index: 20;
}

.single-bottle-wrap {
	position: relative;
}

.single-suggestions {
	position: absolute;
	left: 0;
	right: 0;
	top: calc(100% + 8rpx);
	z-index: 60;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.08);
	max-height: 320rpx;
	overflow: auto;
}

.single-suggestion-item {
	padding: 14rpx 16rpx;
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	border-bottom: 1rpx solid #f1f5f9;
}

.single-suggestion-item:last-child {
	border-bottom: none;
}

.single-suggestion-item:active {
	background: #f8fafc;
}

.single-suggestion-no {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.single-suggestion-sub {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.batch-hint {
	display: block;
	margin-top: 10rpx;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.resolve-box {
	margin-top: 14rpx;
	padding: 16rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #f8fafc;
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.resolve-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
}

.resolve-title {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.resolve-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 12rpx 16rpx;
}

.resolve-line {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
}

.resolve-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.resolve-value {
	font-size: 24rpx;
	font-weight: 600;
	color: var(--crm-text);
	word-break: break-all;
}

.resolve-empty {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.resolve-actions {
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
	flex-wrap: wrap;
}

.batch-result {
	margin-top: 16rpx;
	padding: 16rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #f8fafc;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.batch-result-title {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.batch-result-line {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.batch-result-line--warning {
	color: var(--crm-warning, #d97706);
	font-weight: 600;
}

.batch-detail-block {
	margin-top: 10rpx;
	padding-top: 10rpx;
	border-top: 1rpx dashed #dbe4ee;
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.batch-detail-title {
	font-size: 22rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.batch-detail-line {
	font-size: 21rpx;
	color: var(--crm-text-muted);
}

.batch-textarea-wrap {
	margin-top: 12rpx;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.batch-textarea-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.batch-textarea {
	width: 100%;
	min-height: 180rpx;
	padding: 16rpx;
	box-sizing: border-box;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	font-size: 24rpx;
	line-height: 1.5;
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.pager-row {
	margin-top: 12rpx;
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
}

.weight-box {
	display: flex;
	align-items: baseline;
	gap: 4rpx;
}

.weight-value {
	font-size: 36rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.weight-unit {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

:deep(.item__footer) {
	display: flex;
	flex-wrap: wrap;
	gap: 10rpx;
	align-items: center;
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
}
</style>
