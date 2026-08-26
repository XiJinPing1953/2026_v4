<template>
	<AppPage title="钢瓶检验登记" subtitle="INSPECTION UPDATE" icon="calendar">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="goBottleList">返回档案</AppButton>
		</template>

		<view class="inspection-shell">
			<AppSection title="1. 选择检定日期和项目">
				<view class="form-grid">
					<picker class="picker-block" mode="date" :value="inspectionDate" @change="onInspectionDateChange">
						<AppInput
							:model-value="inspectionDate"
							label="检定日期"
							placeholder="请选择本次检定日期"
							disabled
							prefix-icon="calendar"
							size="sm"
						/>
					</picker>
				</view>
				<view class="module-heading">
					<text class="module-heading__title">本次检验项目</text>
					<text class="module-heading__hint">至少勾选一项；下次日期按每只瓶档已有周期自动计算</text>
				</view>
				<checkbox-group class="module-grid" @change="onModuleChange">
					<label v-for="module in moduleOptions" :key="module.key" class="module-card">
						<checkbox :value="module.key" :checked="isModuleSelected(module.key)" color="#2563eb" />
						<view class="module-card__body">
							<text class="module-card__title">{{ module.label }}</text>
							<text class="module-card__desc">{{ module.desc }}</text>
						</view>
					</label>
				</checkbox-group>
			</AppSection>

			<AppSection title="2. 筛选待检钢瓶">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onResetFilters">重置</AppButton>
					<AppButton size="sm" kind="primary" :loading="loading" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.keyword"
						label="关键词"
						placeholder="钢瓶号/PDA二维码/客户名称"
						prefix-icon="search"
						size="sm"
						confirm-type="search"
						@confirm="onSearch(true)"
					/>
					<picker class="picker-block" mode="selector" :range="bottleNoModeOptions" range-key="label" @change="onBottleNoModeChange">
						<AppInput :model-value="bottleNoModeLabel" label="瓶号规则" disabled prefix-icon="list" size="sm" />
					</picker>
					<AppInput
						v-if="isPrefixMode"
						v-model="filters.bottleNoPrefix"
						label="瓶号前缀"
						placeholder="例如 N / Y / J / X"
						prefix-icon="search"
						size="sm"
					/>
					<AppInput
						v-if="isNumericMode"
						v-model="filters.bottleNoNumericStart"
						label="纯数字起始号"
						placeholder="例如 1"
						prefix-icon="list"
						size="sm"
					/>
					<AppInput
						v-if="isNumericMode"
						v-model="filters.bottleNoNumericEnd"
						label="纯数字结束号"
						placeholder="例如 134"
						prefix-icon="list"
						size="sm"
					/>
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
						<AppInput :model-value="statusLabel" label="流向状态" disabled prefix-icon="list" size="sm" />
					</picker>
					<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
						<AppInput :model-value="activeLabel" label="启用状态" disabled prefix-icon="list" size="sm" />
					</picker>
					<picker class="picker-block" mode="selector" :range="inspectionDueModuleOptions" range-key="label" @change="onInspectionDueModuleChange">
						<AppInput :model-value="inspectionDueModuleLabel" label="到期提醒模块" disabled prefix-icon="calendar" size="sm" />
					</picker>
					<picker class="picker-block" mode="selector" :range="inspectionDueStateOptions" range-key="label" @change="onInspectionDueStateChange">
						<AppInput :model-value="inspectionDueStateLabel" label="到期提醒状态" disabled prefix-icon="alert" size="sm" />
					</picker>
				</view>
			</AppSection>

			<AppSection title="3. 勾选瓶子">
				<template #actions>
					<text class="section-hint">筛选 {{ pager.total }} 瓶 · 已选 {{ selectedCount }} 瓶</text>
				</template>

				<view class="selection-toolbar">
					<AppButton size="sm" kind="neutral" :disabled="!canSelectAll" @click="selectAllFiltered">全选当前筛选</AppButton>
					<AppButton size="sm" kind="ghost" :disabled="selectedCount === 0 && selectionMode !== 'filter'" @click="clearSelection">清空选择</AppButton>
					<text v-if="pager.total > BATCH_LIMIT" class="selection-warning">筛选结果超过 {{ BATCH_LIMIT }} 瓶，请缩小范围后再全选</text>
					<text v-else-if="selectionMode === 'filter'" class="selection-hint">已全选当前筛选，可取消个别瓶子</text>
					<text v-else class="selection-hint">可跨页勾选，选择会保留</text>
				</view>

				<checkbox-group class="candidate-list" @change="onVisibleSelectionChange">
					<view v-for="item in list" :key="item._id" class="candidate-card">
						<checkbox :value="String(item._id)" :checked="isBottleSelected(item._id)" color="#2563eb" />
							<view class="candidate-body">
								<view class="candidate-head">
									<view class="candidate-title-wrap">
										<text class="candidate-title">{{ item.bottle_no || '-' }}</text>
										<AppTag :kind="statusKind(item.status)">{{ statusText(item.status) }}</AppTag>
										<AppTag kind="soft">{{ item.is_active === false ? '停用' : '在用' }}</AppTag>
									</view>
								<text class="candidate-customer">{{ item.current_customer_name || item.filling_company || '库内待命' }}</text>
							</view>
							<view class="candidate-dates">
								<view v-for="module in moduleOptions" :key="module.key" class="candidate-date">
									<text class="candidate-date__label">{{ module.shortLabel }}</text>
									<text class="candidate-date__value">{{ formatModuleDate(item, module.key) }}</text>
									<text class="candidate-date__cycle">{{ formatModuleCycle(item, module.key) }}</text>
								</view>
							</view>
						</view>
					</view>
				</checkbox-group>
				<AppEmpty v-if="!loading && list.length === 0" title="暂无符合条件的钢瓶" subtitle="请调整筛选条件后重新查询" />
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
					<text class="pager-label">第 {{ pager.page }} / {{ totalPages }} 页</text>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="onNextPage">下一页</AppButton>
				</view>
			</AppSection>

			<AppSection title="提交检验登记">
				<view class="submit-summary">
					<text>检定日期：{{ inspectionDate || '未选择' }}</text>
					<text>检验项目：{{ selectedModuleLabels || '未选择' }}</text>
					<text>目标瓶数：{{ selectedCount }}</text>
				</view>
				<view v-if="previewResult" class="result-card" :class="{ 'result-card--danger': previewResult.invalid_total > 0 }">
					<text class="result-title">{{ previewResult.invalid_total > 0 ? '预检未通过' : '预检通过' }}</text>
					<text class="result-line">目标 {{ previewResult.target_total }} 瓶 · 更新 {{ formatModuleLabels(previewResult.modules) }}</text>
					<text v-if="previewResult.invalid_total > 0" class="result-line">有 {{ previewResult.invalid_total }} 瓶缺少所选项目的有效检测周期，本批未写入。</text>
					<text v-for="item in previewResult.invalid_items" :key="`${item._id}-${item.bottle_no}`" class="result-line result-line--danger">
						{{ item.bottle_no || item._id }}：{{ (item.missing_modules || []).join('、') }}
					</text>
				</view>
				<view v-if="executeResult" class="result-card result-card--success">
					<text class="result-title">登记完成</text>
					<text class="result-line">成功 {{ executeResult.success }} 瓶，失败 {{ executeResult.failed }} 瓶</text>
					<text v-for="item in executeResult.failed_items || []" :key="`${item._id}-${item.bottle_no}`" class="result-line result-line--danger">
						{{ item.bottle_no || item._id }}：{{ item.error || '更新失败' }}
					</text>
				</view>
				<AppButton
					class="submit-button"
					size="md"
					kind="primary"
					:loading="submitting"
					:disabled="!canSubmit"
					icon="check-circle"
					@click="onSubmit"
				>
					提交检验登记
				</AppButton>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { batchUpdateInspectionV2, searchBottlesV1 } from '@/services/bottle'

const BATCH_LIMIT = 2000
const CHECK_CYCLE_MONTHS = [6, 12, 24, 36]

const props = defineProps({
	initialInspectionDueModule: { type: String, default: '' },
	initialInspectionDueState: { type: String, default: '' }
})

const moduleOptions = [
	{ key: 'bottle', label: '钢瓶本体', shortLabel: '瓶检', desc: '更新钢瓶本体检验日期' },
	{ key: 'gauge', label: '压力表', shortLabel: '表检', desc: '更新压力表检验日期' },
	{ key: 'valve', label: '安全阀', shortLabel: '阀检', desc: '两个安全阀共用一组日期' }
]
const bottleNoModeOptions = [
	{ label: '全部', value: 'all' },
	{ label: '纯数字', value: 'numeric' },
	{ label: '前缀', value: 'prefix' }
]
const statusOptions = [
	{ label: '全部状态', value: '' },
	{ label: '未知', value: 'unknown' },
	{ label: '在站', value: 'in_station' },
	{ label: '在客户', value: 'at_customer' },
	{ label: '报废', value: 'scrapped' },
	{ label: '丢失', value: 'lost' }
]
const activeOptions = [
	{ label: '全部启用', value: 'all' },
	{ label: '在用', value: 'true' },
	{ label: '停用', value: 'false' }
]
const inspectionDueModuleOptions = [
	{ label: '全部模块', value: '' },
	{ label: '钢瓶检验', value: 'bottle' },
	{ label: '压力表检验', value: 'gauge' },
	{ label: '安全阀检验', value: 'valve' }
]
const inspectionDueStateOptions = [
	{ label: '全部状态', value: '' },
	{ label: '已过期', value: 'overdue' },
	{ label: '60天内到期', value: 'due_60d' }
]

const list = ref([])
const loading = ref(false)
const submitting = ref(false)
const inspectionDate = ref('')
const selectedModules = ref([])
const selectionMode = ref('ids')
const selectedBottleIds = ref([])
const excludedBottleIds = ref([])
const selectedFilterSnapshot = ref('')
const previewResult = ref(null)
const executeResult = ref(null)
const pager = reactive({ page: 1, pageSize: 50, total: 0, hasMore: false })
const filters = reactive({
	keyword: '',
	statusIndex: 0,
	activeIndex: 1,
	inspectionDueModuleIndex: 0,
	inspectionDueStateIndex: 0,
	bottleNoModeIndex: 0,
	bottleNoPrefix: '',
	bottleNoNumericStart: '',
	bottleNoNumericEnd: ''
})
const { canPageAction } = useAuthGuard()

const statusLabel = computed(() => statusOptions[filters.statusIndex]?.label || '全部状态')
const activeLabel = computed(() => activeOptions[filters.activeIndex]?.label || '在用')
const inspectionDueModuleLabel = computed(() => inspectionDueModuleOptions[filters.inspectionDueModuleIndex]?.label || '全部模块')
const inspectionDueStateLabel = computed(() => inspectionDueStateOptions[filters.inspectionDueStateIndex]?.label || '全部状态')
const bottleNoModeLabel = computed(() => bottleNoModeOptions[filters.bottleNoModeIndex]?.label || '全部')
const isPrefixMode = computed(() => bottleNoModeOptions[filters.bottleNoModeIndex]?.value === 'prefix')
const isNumericMode = computed(() => bottleNoModeOptions[filters.bottleNoModeIndex]?.value === 'numeric')
const totalPages = computed(() => Math.max(Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50)), 1))
const selectedCount = computed(() => {
	if (selectionMode.value === 'filter') return Math.max(Number(pager.total || 0) - excludedBottleIds.value.length, 0)
	return selectedBottleIds.value.length
})
const selectedModuleLabels = computed(() => formatModuleLabels(selectedModules.value))
const canSelectAll = computed(() => Number(pager.total || 0) > 0 && Number(pager.total || 0) <= BATCH_LIMIT)
const canSubmit = computed(() => Boolean(inspectionDate.value) && selectedModules.value.length > 0 && selectedCount.value > 0 && canPageAction('/pages/bottle/inspection', 'update'))

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function normalizeBottleNoPrefix(value) {
	return normalizeString(value).toUpperCase()
}

function isValidDateString(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [year, month, day] = text.split('-').map(Number)
	if (month < 1 || month > 12 || day < 1) return false
	return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function getInspectionDueModuleValue() {
	return inspectionDueModuleOptions[filters.inspectionDueModuleIndex]?.value || ''
}

function getInspectionDueStateValue() {
	return inspectionDueStateOptions[filters.inspectionDueStateIndex]?.value || ''
}

function toIntegerInput(value) {
	const text = normalizeString(value)
	if (!text) return null
	const num = Number(text)
	return Number.isInteger(num) && num >= 0 ? num : NaN
}

function applyInitialDueFilters() {
	const moduleIndex = inspectionDueModuleOptions.findIndex((item) => item.value === normalizeString(props.initialInspectionDueModule).toLowerCase())
	const stateIndex = inspectionDueStateOptions.findIndex((item) => item.value === normalizeString(props.initialInspectionDueState).toLowerCase())
	if (moduleIndex > 0 && stateIndex > 0) {
		filters.inspectionDueModuleIndex = moduleIndex
		filters.inspectionDueStateIndex = stateIndex
	}
}

function buildFilterParams({ page = 1, pageSize = 50 } = {}) {
	const mode = bottleNoModeOptions[filters.bottleNoModeIndex]?.value || 'all'
	const numericStart = toIntegerInput(filters.bottleNoNumericStart)
	const numericEnd = toIntegerInput(filters.bottleNoNumericEnd)
	const data = {
		keyword: normalizeString(filters.keyword),
		status: statusOptions[filters.statusIndex]?.value || '',
		is_active: activeOptions[filters.activeIndex]?.value === 'true' ? true : activeOptions[filters.activeIndex]?.value === 'false' ? false : undefined,
		bottle_no_mode: mode,
		inspection_due_module: getInspectionDueModuleValue(),
		inspection_due_state: getInspectionDueStateValue(),
		page,
		pageSize
	}
	if (mode === 'prefix') data.bottle_no_prefix = normalizeBottleNoPrefix(filters.bottleNoPrefix)
	if (mode === 'numeric') {
		if (numericStart != null) data.bottle_no_numeric_start = numericStart
		if (numericEnd != null) data.bottle_no_numeric_end = numericEnd
	}
	if (data.is_active == null) delete data.is_active
	if (!data.inspection_due_module || !data.inspection_due_state) {
		delete data.inspection_due_module
		delete data.inspection_due_state
	}
	return data
}

function validateFilters() {
	const mode = bottleNoModeOptions[filters.bottleNoModeIndex]?.value || 'all'
	if (mode === 'prefix' && !normalizeBottleNoPrefix(filters.bottleNoPrefix)) {
		uni.showToast({ title: '请输入瓶号前缀', icon: 'none' })
		return false
	}
	const numericStart = toIntegerInput(filters.bottleNoNumericStart)
	const numericEnd = toIntegerInput(filters.bottleNoNumericEnd)
	if (Number.isNaN(numericStart) || Number.isNaN(numericEnd)) {
		uni.showToast({ title: '纯数字分段必须为非负整数', icon: 'none' })
		return false
	}
	if (numericStart != null && numericEnd != null && numericStart > numericEnd) {
		uni.showToast({ title: '起始号不能大于结束号', icon: 'none' })
		return false
	}
	return true
}

function buildFilterSnapshot() {
	return JSON.stringify({
		keyword: normalizeString(filters.keyword),
		status: statusOptions[filters.statusIndex]?.value || '',
		active: activeOptions[filters.activeIndex]?.value || 'all',
		inspection_due_module: getInspectionDueModuleValue(),
		inspection_due_state: getInspectionDueStateValue(),
		bottle_no_mode: bottleNoModeOptions[filters.bottleNoModeIndex]?.value || 'all',
		bottle_no_prefix: normalizeBottleNoPrefix(filters.bottleNoPrefix),
		bottle_no_numeric_start: normalizeString(filters.bottleNoNumericStart),
		bottle_no_numeric_end: normalizeString(filters.bottleNoNumericEnd)
	})
}

function clearSelection({ silent = true } = {}) {
	selectionMode.value = 'ids'
	selectedBottleIds.value = []
	excludedBottleIds.value = []
	selectedFilterSnapshot.value = ''
	previewResult.value = null
	executeResult.value = null
	if (!silent) uni.showToast({ title: '已清空选择', icon: 'none' })
}

function isModuleSelected(key) {
	return selectedModules.value.includes(key)
}

function onModuleChange(event) {
	selectedModules.value = Array.from(new Set((event?.detail?.value || []).map((item) => normalizeString(item).toLowerCase()).filter((item) => moduleOptions.some((module) => module.key === item))))
	previewResult.value = null
	executeResult.value = null
}

function onInspectionDateChange(event) {
	inspectionDate.value = event?.detail?.value || ''
	previewResult.value = null
	executeResult.value = null
}

function statusText(status) {
	return { unknown: '未知', in_station: '在站', at_customer: '在客户', scrapped: '报废', lost: '丢失' }[status] || status || '-'
}

function statusKind(status) {
	if (status === 'scrapped' || status === 'lost') return 'danger'
	if (status === 'in_station' || status === 'at_customer') return 'success'
	return 'info'
}

function getModuleFields(moduleKey) {
	return {
		bottle: { check: 'bottle_check_date', next: 'bottle_next_check_date', cycle: 'bottle_check_cycle_months' },
		gauge: { check: 'pressure_gauge_check_date', next: 'pressure_gauge_next_check_date', cycle: 'pressure_gauge_cycle_months' },
		valve: { check: 'safety_valve_check_date', next: 'safety_valve_next_check_date', cycle: 'safety_valve_cycle_months' }
	}[moduleKey]
}

function formatModuleDate(item, moduleKey) {
	const fields = getModuleFields(moduleKey)
	return `${item?.[fields.check] || '-'} / ${item?.[fields.next] || '-'}`
}

function formatModuleCycle(item, moduleKey) {
	const cycle = Number(item?.[getModuleFields(moduleKey).cycle])
	return CHECK_CYCLE_MONTHS.includes(cycle) ? `${cycle}个月` : '周期缺失'
}

function formatModuleLabels(modules) {
	const keys = Array.isArray(modules) ? modules : []
	return keys.map((key) => moduleOptions.find((item) => item.key === key)?.label || key).join('、') || '无'
}

function isBottleSelected(id) {
	const target = normalizeString(id)
	if (!target) return false
	if (selectionMode.value === 'filter') return !excludedBottleIds.value.includes(target)
	return selectedBottleIds.value.includes(target)
}

function selectAllFiltered() {
	if (!canSelectAll.value) return
	selectionMode.value = 'filter'
	selectedBottleIds.value = []
	excludedBottleIds.value = []
	selectedFilterSnapshot.value = buildFilterSnapshot()
	previewResult.value = null
	executeResult.value = null
}

function onVisibleSelectionChange(event) {
	const visibleIds = list.value.map((item) => normalizeString(item?._id)).filter(Boolean)
	const checkedIds = Array.from(new Set((event?.detail?.value || []).map((item) => normalizeString(item)).filter(Boolean)))
	if (selectionMode.value === 'filter') {
		const nextExcluded = excludedBottleIds.value.filter((id) => !visibleIds.includes(id))
		visibleIds.forEach((id) => {
			if (!checkedIds.includes(id)) nextExcluded.push(id)
		})
		excludedBottleIds.value = Array.from(new Set(nextExcluded))
	} else {
		const keep = selectedBottleIds.value.filter((id) => !visibleIds.includes(id))
		selectedBottleIds.value = Array.from(new Set([...keep, ...checkedIds]))
	}
	previewResult.value = null
	executeResult.value = null
}

function buildSelectionSelector() {
	const params = buildFilterParams({ page: 1, pageSize: 1 })
	const selector = {
		keyword: params.keyword,
		status: params.status,
		bottle_no_mode: params.bottle_no_mode
	}
	if (params.is_active != null) selector.is_active = params.is_active
	if (params.bottle_no_prefix) selector.bottle_no_prefix = params.bottle_no_prefix
	if (params.bottle_no_numeric_start != null) selector.bottle_no_numeric_start = params.bottle_no_numeric_start
	if (params.bottle_no_numeric_end != null) selector.bottle_no_numeric_end = params.bottle_no_numeric_end
	if (params.inspection_due_module) selector.inspection_due_module = params.inspection_due_module
	if (params.inspection_due_state) selector.inspection_due_state = params.inspection_due_state
	if (selectionMode.value === 'filter' && excludedBottleIds.value.length) selector.excluded_ids = [...excludedBottleIds.value]
	return selector
}

function buildRequest(preview) {
	if (!isValidDateString(inspectionDate.value)) {
		uni.showToast({ title: '请选择有效的检定日期', icon: 'none' })
		return null
	}
	if (!selectedModules.value.length) {
		uni.showToast({ title: '至少勾选一个检验项目', icon: 'none' })
		return null
	}
	if (!selectedCount.value) {
		uni.showToast({ title: '请先勾选要更新的钢瓶', icon: 'none' })
		return null
	}
	if (selectionMode.value === 'filter' && selectedFilterSnapshot.value !== buildFilterSnapshot()) {
		clearSelection()
		uni.showToast({ title: '筛选条件已变化，请重新勾选钢瓶', icon: 'none' })
		return null
	}
	return {
		preview: Boolean(preview),
		inspection_date: inspectionDate.value,
		modules: [...selectedModules.value],
		scope_mode: selectionMode.value,
		selector: selectionMode.value === 'filter' ? buildSelectionSelector() : { ids: [...selectedBottleIds.value] }
	}
}

function showPreviewIssues(data) {
	previewResult.value = data || null
	if (Number(data?.invalid_total || 0) > 0) {
		uni.showToast({ title: '预检未通过，整批未更新', icon: 'none', duration: 2800 })
	}
}

async function onSubmit() {
	if (submitting.value) return
	const previewPayload = buildRequest(true)
	if (!previewPayload) return
	submitting.value = true
	previewResult.value = null
	executeResult.value = null
	try {
		const previewRes = await batchUpdateInspectionV2(previewPayload)
		if (previewRes?.code !== 0) {
			showPreviewIssues(previewRes?.data)
			uni.showToast({ title: previewRes?.msg || '预检失败', icon: 'none', duration: 2800 })
			return
		}
		const previewData = previewRes.data || {}
		showPreviewIssues(previewData)
		if (!previewData.can_execute) return
		const confirmRes = await uni.showModal({
			title: '确认提交检验登记',
			content: `将以 ${inspectionDate.value} 更新 ${Number(previewData.target_total || 0)} 瓶的${formatModuleLabels(selectedModules.value)}，下次日期按档案周期自动计算。\n确认提交吗？`,
			showCancel: true
		})
		if (!confirmRes.confirm) return
		const executeRes = await batchUpdateInspectionV2({ ...previewPayload, preview: false })
		if (executeRes?.code !== 0) {
			showPreviewIssues(executeRes?.data)
			uni.showToast({ title: executeRes?.msg || '更新失败', icon: 'none', duration: 2800 })
			return
		}
		const resultData = executeRes.data || null
		clearSelection()
		executeResult.value = resultData
		uni.showToast({ title: `登记成功 ${Number(executeRes.data?.success || 0)} 瓶`, icon: 'success', duration: 2400 })
		await onSearch(false)
	} catch (err) {
		uni.showToast({ title: err?.message || '提交失败', icon: 'none', duration: 2800 })
	} finally {
		submitting.value = false
	}
}

async function onSearch(resetPage = false) {
	if (!validateFilters()) return
	if (resetPage) pager.page = 1
	loading.value = true
	try {
		const res = await searchBottlesV1(buildFilterParams({ page: pager.page, pageSize: pager.pageSize }))
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			list.value = []
			pager.total = 0
			pager.hasMore = false
			return
		}
		list.value = Array.isArray(res.data) ? res.data : []
		pager.page = Number(res.paging?.page || pager.page)
		pager.pageSize = Number(res.paging?.pageSize || pager.pageSize)
		pager.total = Number(res.paging?.total ?? res.total ?? 0)
		pager.hasMore = Boolean(res.paging?.hasMore)
	} catch (err) {
		uni.showToast({ title: err?.message || '查询失败', icon: 'none' })
	} finally {
		loading.value = false
	}
}

function onResetFilters() {
	filters.keyword = ''
	filters.statusIndex = 0
	filters.activeIndex = 1
	filters.inspectionDueModuleIndex = 0
	filters.inspectionDueStateIndex = 0
	filters.bottleNoModeIndex = 0
	filters.bottleNoPrefix = ''
	filters.bottleNoNumericStart = ''
	filters.bottleNoNumericEnd = ''
	clearSelection()
	onSearch(true)
}

function onBottleNoModeChange(event) {
	filters.bottleNoModeIndex = Number(event?.detail?.value) || 0
	if (!isPrefixMode.value) filters.bottleNoPrefix = ''
	if (!isNumericMode.value) {
		filters.bottleNoNumericStart = ''
		filters.bottleNoNumericEnd = ''
	}
	clearSelection()
	onSearch(true)
}

function onStatusChange(event) {
	filters.statusIndex = Number(event?.detail?.value) || 0
	clearSelection()
	onSearch(true)
}

function onActiveChange(event) {
	filters.activeIndex = Number(event?.detail?.value) || 0
	clearSelection()
	onSearch(true)
}

function onInspectionDueModuleChange(event) {
	filters.inspectionDueModuleIndex = Number(event?.detail?.value) || 0
	clearSelection()
	onSearch(true)
}

function onInspectionDueStateChange(event) {
	filters.inspectionDueStateIndex = Number(event?.detail?.value) || 0
	clearSelection()
	onSearch(true)
}

function onPrevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	onSearch(false)
}

function onNextPage() {
	if (!pager.hasMore) return
	pager.page += 1
	onSearch(false)
}

function goBottleList() {
	const pages = getCurrentPages()
	if (pages.length > 1) {
		uni.navigateBack({ delta: 1 })
		return
	}
	uni.navigateTo({ url: '/pages/bottle/list' })
}

const filterSnapshot = computed(() => buildFilterSnapshot())
watch(filterSnapshot, (next, previous) => {
	if (!previous || next === previous) return
	if (selectionMode.value === 'filter' || selectedBottleIds.value.length) clearSelection()
	previewResult.value = null
	executeResult.value = null
})

onMounted(() => {
	applyInitialDueFilters()
	onSearch(true)
})
</script>

<style scoped>
.inspection-shell {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.form-grid,
.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.module-heading {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16rpx;
	flex-wrap: wrap;
	margin-top: 24rpx;
}

.module-heading__title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.module-heading__hint,
.selection-hint,
.selection-warning,
.section-hint,
.pager-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.selection-warning,
.result-line--danger {
	color: #b42318;
}

.module-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260rpx, 1fr));
	gap: 12rpx;
	margin-top: 12rpx;
}

.module-card {
	display: flex;
	align-items: flex-start;
	gap: 12rpx;
	padding: 18rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #f8fafc;
}

.module-card__body {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.module-card__title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.module-card__desc {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.selection-toolbar {
	display: flex;
	align-items: center;
	gap: 12rpx;
	flex-wrap: wrap;
	margin-bottom: 16rpx;
}

.candidate-list {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.candidate-card {
	display: flex;
	align-items: flex-start;
	gap: 14rpx;
	padding: 18rpx;
	background: #fff;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
}

.candidate-body {
	flex: 1;
	min-width: 0;
}

.candidate-head {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 16rpx;
}

.candidate-title-wrap {
	display: flex;
	align-items: center;
	gap: 12rpx;
	flex-wrap: wrap;
}

.candidate-title {
	font-size: 30rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.candidate-customer {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	text-align: right;
}

.candidate-dates {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10rpx;
	margin-top: 16rpx;
}

.candidate-date {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	padding: 10rpx;
	background: #f8fafc;
	border-radius: 8rpx;
}

.candidate-date__label,
.candidate-date__cycle {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.candidate-date__value {
	font-size: 22rpx;
	color: var(--crm-text);
	word-break: break-all;
}

.pager-row {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 14rpx;
	margin-top: 16rpx;
}

.submit-summary {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	padding: 16rpx;
	background: #f8fafc;
	border-radius: var(--crm-radius-sm);
	font-size: 24rpx;
	color: var(--crm-text);
}

.result-card {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	margin-top: 16rpx;
	padding: 16rpx;
	background: #eff6ff;
	border-radius: var(--crm-radius-sm);
}

.result-card--danger {
	background: #fef2f2;
}

.result-card--success {
	background: #ecfdf3;
}

.result-title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.result-line {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.submit-button {
	width: 100%;
	margin-top: 20rpx;
}

@media (max-width: 560px) {
	.candidate-head {
		flex-direction: column;
	}

	.candidate-customer {
		text-align: left;
	}

	.candidate-dates {
		grid-template-columns: 1fr;
	}
}
</style>
