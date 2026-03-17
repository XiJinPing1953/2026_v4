<template>
	<AppPage title="灌装记录" :subtitle="subtitle" icon="bottle">
		<template #headerActions>
			<AppButton size="sm" kind="primary" icon="plus" @click="onAdd">单条灌装</AppButton>
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
						label="已备注"
						:value="summary.withRemark"
						hint="条"
						icon="document"
					/>
					<AppStatCard
						class="summary-card"
						label="未备注"
						:value="summary.withoutRemark"
						hint="条"
						icon="list"
					/>
			</view>
		</template>

			<view class="list-shell">
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
									@tap.stop="selectFilterOperatorSuggestion(item)"
								>
									<text class="filter-suggestion-no">{{ item.name || item.label }}</text>
								</view>
							</view>
						</view>
						<picker class="picker-block" mode="selector" :range="recordTypeFilterOptions" range-key="label" @change="onRecordTypeFilterChange">
							<AppInput :model-value="recordTypeFilterLabel" label="作业类型" placeholder="选择作业类型" prefix-icon="list" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="date" @change="e => filters.dateStart = e.detail.value">
							<AppInput v-model="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="date" @change="e => filters.dateEnd = e.detail.value">
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

					<view id="single-filling-section">
						<AppSection class="single-create-section" title="单条灌装">
							<template #actions>
								<AppButton size="sm" kind="neutral" @click="toggleSingleCreatePanel">
									{{ singleCreatePanelOpen ? '收起' : '展开' }}
								</AppButton>
								<AppButton size="sm" kind="ghost" @click="onSingleCreateReset">清空</AppButton>
								<AppButton size="sm" kind="primary" :loading="singleCreateSubmitting" @click="onSingleCreateSubmit">保存</AppButton>
							</template>

							<view v-if="singleCreatePanelOpen" class="single-grid">
								<picker class="picker-block" mode="date" :value="singleCreateForm.date" @change="onSingleCreateDateChange">
									<AppInput :model-value="singleCreateForm.date" label="灌装日期" placeholder="请选择日期" disabled prefix-icon="calendar" size="sm" />
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
											:key="item._id || item.bottle_no"
											class="single-suggestion-item"
											@tap.stop="selectSingleCreateBottleSuggestion(item)"
										>
											<text class="single-suggestion-no">{{ item.bottle_no }}</text>
											<text class="single-suggestion-sub">{{ formatBottleSuggestionSub(item) }}</text>
										</view>
									</view>
								</view>
								<AppInput v-model="singleCreateForm.fill_weight" label="灌装净重(kg)" placeholder="请输入大于0的数值" size="sm" />
								<picker class="picker-block" mode="selector" :range="recordTypeCreateOptions" range-key="label" @change="onSingleCreateRecordTypeChange">
									<AppInput :model-value="singleCreateRecordTypeLabel" label="作业类型" placeholder="请选择作业类型" disabled prefix-icon="list" size="sm" />
								</picker>
								<picker class="picker-block" mode="selector" :range="operatorCreateOptions" range-key="label" @change="onSingleCreateOperatorChange">
									<AppInput :model-value="singleCreateOperatorLabel" label="操作人" placeholder="请选择操作人" disabled prefix-icon="user" size="sm" />
								</picker>
									<AppInput v-model="singleCreateForm.remark" label="备注" placeholder="可选" size="sm" />
								</view>
								<text v-if="singleCreatePanelOpen" class="batch-hint">{{ singleCreateBottleHint }}</text>
							</AppSection>
						</view>

					<AppSection title="批量新增灌装">
						<template #actions>
							<AppButton kind="ghost" size="sm" @click="onBatchCreateReset">清空</AppButton>
							<AppButton size="sm" kind="neutral" :loading="batchCreatePreviewLoading" @click="onBatchCreatePreview">预览</AppButton>
							<AppButton size="sm" kind="primary" :loading="batchCreateExecuting" @click="onBatchCreateExecute">执行</AppButton>
						</template>

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
									<AppInput v-model="batchCreateForm.defaultFillWeight" label="默认净重(kg)" placeholder="可空，行内未填时使用" size="sm" />
									<AppInput v-model="batchCreateForm.remark" label="备注" placeholder="可选" size="sm" />
								</view>
						<view class="batch-textarea-wrap">
							<text class="batch-textarea-label">批量内容（每行一条：`瓶号,净重` 或仅 `瓶号`）</text>
							<textarea
								v-model="batchCreateForm.batchText"
								class="batch-textarea"
								placeholder="示例：\n134,68\n135,67.5\n136"
								maxlength="120000"
							/>
						</view>
						<text class="batch-hint">若某行未填写净重，将使用“默认净重”；若默认净重也为空，该行会在预览中标为无效。</text>

						<view v-if="batchCreatePreviewResult" class="batch-result">
							<text class="batch-result-title">预览结果</text>
							<text class="batch-result-line">可新增：{{ batchCreatePreviewResult.target_total }}（上限 {{ batchCreatePreviewResult.limit }}）</text>
							<text class="batch-result-line">
								无效行：{{ batchCreatePreviewResult.invalid_total || 0 }}，已存在：{{ batchCreatePreviewResult.existing_total || 0 }}，内容重复：{{ batchCreatePreviewResult.duplicate_total || 0 }}
							</text>
							<text class="batch-result-line">样例瓶号：{{ formatBottleNoSamples(batchCreatePreviewResult.sample_bottle_nos) }}</text>
							<view v-if="batchCreatePreviewCreateItems.length" class="batch-detail-block">
								<text class="batch-detail-title">待新增明细（前 {{ batchCreatePreviewCreateItems.length }} 条）</text>
								<text v-for="item in batchCreatePreviewCreateItems" :key="`create-${item.line_no}-${item.bottle_no}`" class="batch-detail-line">
									{{ formatBatchCreatePreviewCreateItem(item) }}
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

					<AppSection title="批量改日期">
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
								<AppButton size="sm" kind="outline" @click="onEdit(item)">编辑</AppButton>
								<AppButton
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
import { useQuery } from '@/composables/useQuery'
import { searchBottlesV1 } from '@/services/bottle'
import { searchDeliveriesV1 } from '@/services/delivery'
import { batchCreateFillingsV1, batchUpdateFillingDateV1, createFillingV1, listFillingsV1, removeFillingV1 } from '@/services/filling'

const BATCH_LIMIT = 2000
const RECORD_TYPE_OPTIONS = [
	{ label: '常规灌装', value: 'normal_fill' },
	{ label: '随车出液-代理销售', value: 'truck_out_agent_sale' },
	{ label: '随车出液-未销售', value: 'truck_out_no_sale' }
]
const DEFAULT_OPERATOR_NAME = '陈铁栓'
const STATUS_LABEL_MAP = {
	unknown: '未知',
	in_station: '在站',
	at_customer: '在客户',
	scrapped: '报废',
	lost: '丢失'
}
const RECORD_TYPE_FILTER_OPTIONS = [{ label: '全部', value: '' }, ...RECORD_TYPE_OPTIONS]
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
const batchCreatePreviewLoading = ref(false)
const batchCreateExecuting = ref(false)
const batchCreatePreviewResult = ref(null)
const batchCreateExecuteResult = ref(null)
const operatorOptions = ref([])
const isLoadingOperatorOptions = ref(false)
const batchPreviewLoading = ref(false)
const batchExecuting = ref(false)
const batchPreviewResult = ref(null)
const batchExecuteResult = ref(null)
const summary = ref({ total: 0, withRemark: 0, withoutRemark: 0 })
const listRefreshVersion = ref(0)
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const filters = reactive({
	bottle_no: '',
	operator: '',
	record_type: '',
	dateStart: '',
	dateEnd: ''
})

const singleCreateForm = reactive({
	date: '',
	bottle_no: '',
	fill_weight: '',
	record_type: 'normal_fill',
	operator: '',
	operator_id: '',
	remark: ''
})

const batchCreateForm = reactive({
	date: '',
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
const recordTypeCreateOptions = computed(() => RECORD_TYPE_OPTIONS)
const operatorCreateOptions = computed(() => operatorOptions.value)
const recordTypeFilterLabel = computed(() => {
	const target = normalizeRecordType(filters.record_type, '')
	return RECORD_TYPE_FILTER_OPTIONS.find((item) => item.value === target)?.label || RECORD_TYPE_FILTER_OPTIONS[0].label
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
const singleCreateBottleRequired = computed(() => isInventoryLinkedRecordType(singleCreateForm.record_type))
const singleCreateBottleLabel = computed(() => (singleCreateBottleRequired.value ? '瓶号' : '瓶号（可空）'))
const singleCreateBottlePlaceholder = computed(() =>
	singleCreateBottleRequired.value ? '输入瓶号联想钢瓶档案' : '可不填，填写时可联想钢瓶档案'
)
const singleCreateBottleHint = computed(() =>
	singleCreateBottleRequired.value
		? '常规灌装与代理销售要求钢瓶已建档且启用。'
		: '随车出液-未销售可不填瓶号。'
)
const batchCreatePreviewCreateItems = computed(() => {
	return Array.isArray(batchCreatePreviewResult.value?.create_items) ? batchCreatePreviewResult.value.create_items : []
})
const batchCreatePreviewExistingItems = computed(() => {
	return Array.isArray(batchCreatePreviewResult.value?.existing_items) ? batchCreatePreviewResult.value.existing_items : []
})
const batchCreatePreviewInvalidItems = computed(() => {
	return Array.isArray(batchCreatePreviewResult.value?.invalid_items) ? batchCreatePreviewResult.value.invalid_items : []
})

const filterChips = computed(() => {
	const chips = []
	if (filters.bottle_no) chips.push({ key: 'bottle', label: `瓶号: ${filters.bottle_no}` })
	if (filters.operator) chips.push({ key: 'operator', label: `操作人: ${filters.operator}` })
	if (filters.record_type) chips.push({ key: 'recordType', label: `类型: ${getRecordTypeLabel(filters.record_type)}` })
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

function isInventoryLinkedRecordType(value) {
	const type = normalizeRecordType(value, '')
	return type === 'normal_fill' || type === 'truck_out_agent_sale'
}

function getRecordTypeLabel(value) {
	const key = normalizeRecordType(value, 'normal_fill')
	return RECORD_TYPE_OPTIONS.find((item) => item.value === key)?.label || '常规灌装'
}

function getStatusLabel(value) {
	const key = normalizeString(value)
	return STATUS_LABEL_MAP[key] || '未知'
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
		dateStart: normalizeString(filters.dateStart),
		dateEnd: normalizeString(filters.dateEnd)
	})
}

function clearFilterChip(key) {
	if (key === 'bottle') filters.bottle_no = ''
	if (key === 'operator') filters.operator = ''
	if (key === 'recordType') filters.record_type = ''
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
				summary: { total: 0, with_remark: 0, without_remark: 0 }
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
			summary: res.summary || { total: 0, with_remark: 0, without_remark: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, with_remark: 0, without_remark: 0 }
		},
		cacheTTL: 10000,
			cacheKey: () =>
				`filling:list:${filters.bottle_no}:${filters.operator}:${filters.record_type}:${filters.dateStart}:${filters.dateEnd}:${pager.page}:${pager.pageSize}:${listRefreshVersion.value}`
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
		withoutRemark: Number(summaryData.without_remark ?? summaryData.withoutRemark ?? 0)
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
	filters.dateStart = ''
	filters.dateEnd = ''
	clearFilterBottleSuggestions()
	clearFilterOperatorSuggestions()
	onSearch(true, { force: true })
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
		const res = await searchBottlesV1({ keyword: targetKeyword, limit: 20, is_active: true })
		if (normalizeBottleNo(filters.bottle_no) !== normalizeBottleNo(targetKeyword)) return
		if (res?.code !== 0) {
			filterBottleSuggestions.value = []
			return
		}
		filterBottleSuggestions.value = Array.isArray(res.data)
			? res.data.filter((item) => Boolean(item && item.is_active)).slice(0, 20)
			: []
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

function formatBottleSuggestionSub(item) {
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
		const res = await searchBottlesV1({ keyword: targetKeyword, limit: 20, is_active: true })
		if (normalizeBottleNo(singleCreateForm.bottle_no) !== normalizeBottleNo(targetKeyword)) return
		if (res?.code !== 0) {
			singleCreateBottleSuggestions.value = []
			return
		}
		singleCreateBottleSuggestions.value = Array.isArray(res.data)
			? res.data
					.filter((item) => Boolean(item && item.is_active))
					.slice(0, 20)
			: []
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

function selectSingleCreateBottleSuggestion(item) {
	const bottleNo = normalizeBottleNo(item?.bottle_no)
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

function toggleSingleCreatePanel() {
	singleCreatePanelOpen.value = !singleCreatePanelOpen.value
	if (!singleCreatePanelOpen.value) clearSingleCreateSuggestions()
}

function onSingleCreateDateChange(event) {
	singleCreateForm.date = normalizeString(event?.detail?.value)
}

function onSingleCreateRecordTypeChange(event) {
	const idx = Number(event?.detail?.value)
	singleCreateForm.record_type = RECORD_TYPE_OPTIONS[idx]?.value || 'normal_fill'
}

function onSingleCreateOperatorChange(event) {
	const idx = Number(event?.detail?.value)
	const option = operatorOptions.value[idx]
	if (!option) return
	setSingleCreateOperatorByOption(option)
}

function onSingleCreateReset() {
	singleCreateForm.date = formatTodayUtc8()
	singleCreateForm.bottle_no = ''
	singleCreateForm.fill_weight = ''
	singleCreateForm.record_type = 'normal_fill'
	singleCreateForm.operator = ''
	singleCreateForm.operator_id = ''
	singleCreateForm.remark = ''
	applySingleCreateDefaultOperator()
	clearSingleCreateSuggestions()
}

function buildSingleCreatePayload() {
	const date = normalizeString(singleCreateForm.date)
	if (!isValidDateString(date)) {
		uni.showToast({ title: '请选择合法的灌装日期', icon: 'none' })
		return null
	}
	const recordType = normalizeRecordType(singleCreateForm.record_type, 'normal_fill')
	const bottleNo = normalizeBottleNo(singleCreateForm.bottle_no)
	if (isInventoryLinkedRecordType(recordType) && !bottleNo) {
		uni.showToast({ title: '该作业类型必须填写瓶号', icon: 'none' })
		return null
	}
	const fillWeight = Number(singleCreateForm.fill_weight)
	if (!Number.isFinite(fillWeight) || fillWeight <= 0) {
		uni.showToast({ title: '灌装净重必须大于 0', icon: 'none' })
		return null
	}
	const operator = normalizeString(singleCreateForm.operator)
	if (!operator) {
		uni.showToast({ title: '请选择操作人', icon: 'none' })
		return null
	}
	return {
		date,
		bottle_no: bottleNo,
		fill_weight: fillWeight,
		record_type: recordType,
		operator,
		operator_id: normalizeId(singleCreateForm.operator_id),
		remark: normalizeString(singleCreateForm.remark)
	}
}

async function onSingleCreateSubmit() {
	if (singleCreateSubmitting.value) return
	const payload = buildSingleCreatePayload()
	if (!payload) return
	singleCreateSubmitting.value = true
	try {
		const res = await createFillingV1(payload)
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '保存失败', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: res?.msg || '保存成功', icon: 'success' })
		singleCreateForm.bottle_no = ''
		singleCreateForm.fill_weight = ''
		singleCreateForm.remark = ''
		clearSingleCreateSuggestions()
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
	const defaultWeightText = normalizeString(batchCreateForm.defaultFillWeight)
	if (defaultWeightText) {
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
		record_type: normalizeRecordType(batchCreateForm.record_type, 'normal_fill'),
		operator,
		operator_id: normalizeId(batchCreateForm.operator_id),
		remark: normalizeString(batchCreateForm.remark),
		default_fill_weight: defaultWeightText,
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
			uni.showToast({ title: res?.msg || '预览失败', icon: 'none', duration: 2600 })
			return
		}
		batchCreatePreviewResult.value = res.data || null
		uni.showToast({
			title: `预览可新增 ${Number(res?.data?.target_total || 0)} 条`,
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
			uni.showToast({ title: previewRes?.msg || '预览失败', icon: 'none', duration: 2600 })
			return
		}
		const previewData = previewRes.data || {}
		batchCreatePreviewResult.value = previewData
		const total = Number(previewData.target_total || 0)
		if (total <= 0) {
			uni.showToast({ title: '没有可新增的数据', icon: 'none' })
			return
		}
		if (total > BATCH_LIMIT) {
			uni.showToast({ title: `单次最多新增 ${BATCH_LIMIT} 条，请拆批`, icon: 'none', duration: 2800 })
			return
		}
			const confirmRes = await uni.showModal({
				title: '确认批量新增',
				content: `将新增 ${total} 条灌装记录（日期 ${previewData.date}，类型 ${batchCreateRecordTypeLabel.value}，操作人 ${batchCreateOperatorLabel.value}），确认执行吗？`,
				showCancel: true
			})
		if (!confirmRes.confirm) return
		const executeRes = await batchCreateFillingsV1({ ...previewPayload, preview: false })
		if (executeRes?.code !== 0) {
			uni.showToast({ title: executeRes?.msg || '执行失败', icon: 'none', duration: 2800 })
			return
		}
		batchCreateExecuteResult.value = executeRes.data || null
		const failed = Number(executeRes.data?.failed || 0)
		const success = Number(executeRes.data?.success || 0)
		uni.showToast({
			title: failed > 0 ? `新增完成：成功${success}，失败${failed}` : `新增成功 ${success} 条`,
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
	const dateStart = normalizeString(filters.dateStart)
	const dateEnd = normalizeString(filters.dateEnd)
	if (bottleNo) selector.bottle_no = bottleNo
	if (operator) selector.operator = operator
	if (recordType) selector.record_type = recordType
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
	const weightText = Number.isFinite(fillWeight) ? fillWeight : '-'
	return `行${lineNo || '-'} · ${bottleNo} · ${weightText}kg`
}

function formatBatchCreatePreviewIssueItem(item) {
	const lineNo = Number(item?.line_no || 0)
	const bottleNo = normalizeString(item?.bottle_no) || '-'
	const error = normalizeString(item?.error) || '无效数据'
	return `行${lineNo || '-'} · ${bottleNo} · ${error}`
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
	onSingleCreateReset()
	if (!batchCreateForm.date) batchCreateForm.date = formatTodayUtc8()
	loadOperatorOptions()
	onSearch()
})

onBeforeUnmount(() => {
	clearFilterBottleSuggestTimer()
	clearFilterOperatorSuggestTimer()
	clearSingleCreateSuggestTimer()
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

defineExpose({
	refresh: () => onSearch(false, { force: true })
})
</script>

<style scoped>
.list-shell {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
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
