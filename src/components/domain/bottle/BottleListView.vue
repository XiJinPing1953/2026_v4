<template>
	<AppPage title="钢瓶档案" :subtitle="subtitle" icon="bottle">
		<template #headerActions>
			<AppButton v-if="canCreateBottle" size="sm" kind="primary" icon="plus" @click="onAdd">新增钢瓶</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="筛选结果"
					:value="summary.total"
					hint="瓶"
					icon="bottle"
					@click="onSummaryFilter('all')"
				/>
				<AppStatCard
					class="summary-card"
					label="在站库存"
					:value="summary.inStation"
					hint="瓶"
					icon="list"
					@click="onSummaryFilter('in_station')"
				/>
				<AppStatCard
					class="summary-card"
					label="在客户"
					:value="summary.atCustomer"
					hint="瓶"
					icon="user"
					@click="onSummaryFilter('at_customer')"
				/>
				<AppStatCard
					class="summary-card"
					label="报废/丢失"
					:value="summary.abnormal"
					hint="瓶"
					icon="alert"
				/>
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="钢瓶筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.keyword"
						label="关键词"
						placeholder="钢瓶编号/PDA二维码/客户名称"
						prefix-icon="search"
						size="sm"
					/>
					<picker class="picker-block" mode="selector" :range="bottleNoModeOptions" range-key="label" @change="onBottleNoModeChange">
						<AppInput
							:model-value="bottleNoModeLabel"
							label="瓶号规则"
							placeholder="全部"
							prefix-icon="list"
							disabled
							size="sm"
						/>
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
						<AppInput
							:model-value="statusLabel"
							label="流向状态"
							placeholder="全部状态"
							prefix-icon="list"
							disabled
							size="sm"
						/>
					</picker>
					<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
						<AppInput
							:model-value="activeLabel"
							label="启用状态"
							placeholder="全部启用"
							prefix-icon="list"
							disabled
							size="sm"
						/>
					</picker>
					<picker class="picker-block" mode="selector" :range="inspectionDueModuleOptions" range-key="label" @change="onInspectionDueModuleChange">
						<AppInput
							:model-value="inspectionDueModuleLabel"
							label="到期提醒模块"
							placeholder="全部"
							prefix-icon="calendar"
							disabled
							size="sm"
						/>
					</picker>
					<picker class="picker-block" mode="selector" :range="inspectionDueStateOptions" range-key="label" @change="onInspectionDueStateChange">
						<AppInput
							:model-value="inspectionDueStateLabel"
							label="到期提醒状态"
							placeholder="全部"
							prefix-icon="alert"
							disabled
							size="sm"
						/>
					</picker>
				</view>

				<view class="inspection-filter-wrap">
					<view class="inspection-filter-head">
						<text class="inspection-filter-title">检验批次筛选（检验日期必选，下次日期可选精确匹配）</text>
						<AppButton kind="ghost" size="sm" @click="onClearInspectionFilter">清空批次</AppButton>
					</view>
					<view class="inspection-filter-grid">
						<view class="inspection-filter-card">
							<text class="inspection-filter-card__title">钢瓶批次</text>
							<picker
								class="picker-block"
								mode="date"
								:value="filters.bottleCheckDateEq"
								@change="onInspectionFilterDateChange('bottleCheckDateEq', $event)"
							>
								<AppInput
									:model-value="filters.bottleCheckDateEq"
									label="检验日期"
									placeholder="请选择"
									disabled
									prefix-icon="calendar"
									size="sm"
								/>
							</picker>
							<picker
								class="picker-block"
								mode="date"
								:value="filters.bottleNextCheckDateEq"
								@change="onInspectionFilterDateChange('bottleNextCheckDateEq', $event)"
							>
								<AppInput
									:model-value="filters.bottleNextCheckDateEq"
									label="下次检验日期"
									placeholder="请选择"
									disabled
									prefix-icon="calendar"
									size="sm"
								/>
							</picker>
						</view>
						<view class="inspection-filter-card">
							<text class="inspection-filter-card__title">压力表批次</text>
							<picker
								class="picker-block"
								mode="date"
								:value="filters.gaugeCheckDateEq"
								@change="onInspectionFilterDateChange('gaugeCheckDateEq', $event)"
							>
								<AppInput
									:model-value="filters.gaugeCheckDateEq"
									label="检验日期"
									placeholder="请选择"
									disabled
									prefix-icon="calendar"
									size="sm"
								/>
							</picker>
							<picker
								class="picker-block"
								mode="date"
								:value="filters.gaugeNextCheckDateEq"
								@change="onInspectionFilterDateChange('gaugeNextCheckDateEq', $event)"
							>
								<AppInput
									:model-value="filters.gaugeNextCheckDateEq"
									label="下次检验日期"
									placeholder="请选择"
									disabled
									prefix-icon="calendar"
									size="sm"
								/>
							</picker>
						</view>
						<view class="inspection-filter-card">
							<text class="inspection-filter-card__title">安全阀批次</text>
							<picker
								class="picker-block"
								mode="date"
								:value="filters.valveCheckDateEq"
								@change="onInspectionFilterDateChange('valveCheckDateEq', $event)"
							>
								<AppInput
									:model-value="filters.valveCheckDateEq"
									label="检验日期"
									placeholder="请选择"
									disabled
									prefix-icon="calendar"
									size="sm"
								/>
							</picker>
							<picker
								class="picker-block"
								mode="date"
								:value="filters.valveNextCheckDateEq"
								@change="onInspectionFilterDateChange('valveNextCheckDateEq', $event)"
							>
								<AppInput
									:model-value="filters.valveNextCheckDateEq"
									label="下次检验日期"
									placeholder="请选择"
									disabled
									prefix-icon="calendar"
									size="sm"
								/>
							</picker>
						</view>
					</view>
				</view>

				<view v-if="filterChips.length" class="filter-chips">
					<view v-for="chip in filterChips" :key="chip.key" class="filter-chip" @click="clearFilterChip(chip.key)">
						<text class="filter-chip__label">{{ chip.label }}</text>
						<text class="filter-chip__close">×</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="批量检验更新">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onBatchReset">清空</AppButton>
					<AppButton size="sm" kind="neutral" :loading="batchPreviewLoading" @click="onBatchPreview">预览</AppButton>
					<AppButton size="sm" kind="primary" :loading="batchExecuting" @click="onBatchExecute">执行</AppButton>
				</template>

				<view class="batch-head-grid">
					<picker class="picker-block" mode="selector" :range="batchScopeOptions" range-key="label" @change="onBatchScopeChange">
						<AppInput :model-value="batchScopeLabel" label="更新范围" disabled prefix-icon="list" size="sm" />
					</picker>
					<AppInput :model-value="String(selectedCount)" label="已勾选数量" disabled prefix-icon="list" size="sm" />
				</view>

				<view class="batch-module-toggle">
					<AppButton
						size="sm"
						:kind="batchForm.bottle.enabled ? 'primary' : 'neutral'"
						@click="toggleBatchModule('bottle')"
					>
						钢瓶检验
					</AppButton>
					<AppButton size="sm" :kind="batchForm.gauge.enabled ? 'primary' : 'neutral'" @click="toggleBatchModule('gauge')">
						压力表检验
					</AppButton>
					<AppButton size="sm" :kind="batchForm.valve.enabled ? 'primary' : 'neutral'" @click="toggleBatchModule('valve')">
						安全阀检验
					</AppButton>
				</view>

				<view v-if="batchForm.bottle.enabled" class="batch-module-card">
					<text class="batch-module-title">钢瓶检验</text>
					<view class="batch-module-grid">
						<picker class="picker-block" mode="date" :value="batchForm.bottle.checkDate" @change="onBatchDateChange('bottle', 'checkDate', $event)">
							<AppInput :model-value="batchForm.bottle.checkDate" label="检验日期" placeholder="请选择日期" disabled prefix-icon="calendar" size="sm" />
						</picker>
						<picker class="picker-block" mode="selector" :range="cycleOptions" range-key="label" @change="onBatchCycleChange('bottle', $event)">
							<AppInput :model-value="getCycleLabel(batchForm.bottle.cycleMonths)" label="检测周期" disabled prefix-icon="list" size="sm" />
						</picker>
						<picker class="picker-block" mode="date" :value="batchForm.bottle.nextOverrideDate" @change="onBatchDateChange('bottle', 'nextOverrideDate', $event)">
							<AppInput :model-value="batchForm.bottle.nextOverrideDate" label="下次检验日期(覆盖)" placeholder="留空则自动计算" disabled prefix-icon="calendar" size="sm" />
						</picker>
					</view>
					<text class="batch-hint">自动下次日期：{{ getBatchAutoNextDate('bottle') || '待输入检验日期' }}</text>
				</view>

				<view v-if="batchForm.gauge.enabled" class="batch-module-card">
					<text class="batch-module-title">压力表检验</text>
					<view class="batch-module-grid">
						<picker class="picker-block" mode="date" :value="batchForm.gauge.checkDate" @change="onBatchDateChange('gauge', 'checkDate', $event)">
							<AppInput :model-value="batchForm.gauge.checkDate" label="检验日期" placeholder="请选择日期" disabled prefix-icon="calendar" size="sm" />
						</picker>
						<picker class="picker-block" mode="selector" :range="cycleOptions" range-key="label" @change="onBatchCycleChange('gauge', $event)">
							<AppInput :model-value="getCycleLabel(batchForm.gauge.cycleMonths)" label="检测周期" disabled prefix-icon="list" size="sm" />
						</picker>
						<picker class="picker-block" mode="date" :value="batchForm.gauge.nextOverrideDate" @change="onBatchDateChange('gauge', 'nextOverrideDate', $event)">
							<AppInput :model-value="batchForm.gauge.nextOverrideDate" label="下次检验日期(覆盖)" placeholder="留空则自动计算" disabled prefix-icon="calendar" size="sm" />
						</picker>
					</view>
					<text class="batch-hint">自动下次日期：{{ getBatchAutoNextDate('gauge') || '待输入检验日期' }}</text>
				</view>

				<view v-if="batchForm.valve.enabled" class="batch-module-card">
					<text class="batch-module-title">安全阀检验（2个阀共用）</text>
					<view class="batch-module-grid">
						<picker class="picker-block" mode="date" :value="batchForm.valve.checkDate" @change="onBatchDateChange('valve', 'checkDate', $event)">
							<AppInput :model-value="batchForm.valve.checkDate" label="检验日期" placeholder="请选择日期" disabled prefix-icon="calendar" size="sm" />
						</picker>
						<picker class="picker-block" mode="selector" :range="cycleOptions" range-key="label" @change="onBatchCycleChange('valve', $event)">
							<AppInput :model-value="getCycleLabel(batchForm.valve.cycleMonths)" label="检测周期" disabled prefix-icon="list" size="sm" />
						</picker>
						<picker class="picker-block" mode="date" :value="batchForm.valve.nextOverrideDate" @change="onBatchDateChange('valve', 'nextOverrideDate', $event)">
							<AppInput :model-value="batchForm.valve.nextOverrideDate" label="下次检验日期(覆盖)" placeholder="留空则自动计算" disabled prefix-icon="calendar" size="sm" />
						</picker>
					</view>
					<text class="batch-hint">自动下次日期：{{ getBatchAutoNextDate('valve') || '待输入检验日期' }}</text>
				</view>

				<view v-if="batchPreviewResult" class="batch-result">
					<text class="batch-result-title">预览结果</text>
					<text class="batch-result-line">命中数量：{{ batchPreviewResult.target_total }}（上限 {{ batchPreviewResult.limit }}）</text>
					<text class="batch-result-line">更新字段：{{ formatUpdateFieldSummary(batchPreviewResult.update_fields) }}</text>
					<text class="batch-result-line">样例瓶号：{{ formatBottleNoSamples(batchPreviewResult.sample_bottle_nos) }}</text>
					<text class="batch-result-line" v-if="batchPreviewResult.missing_total">未命中：{{ batchPreviewResult.missing_total }}</text>
				</view>

				<view v-if="batchExecuteResult" class="batch-result">
					<text class="batch-result-title">执行结果</text>
					<text class="batch-result-line">总数：{{ batchExecuteResult.total }}，成功：{{ batchExecuteResult.success }}，失败：{{ batchExecuteResult.failed }}</text>
					<text v-if="batchExecuteResult.failed > 0" class="batch-result-line">
						失败瓶号：{{ formatFailedBottleNos(batchExecuteResult.failed_items) }}
					</text>
				</view>
			</AppSection>

			<AppSection title="钢瓶列表">
				<template #actions>
					<view class="section-actions">
						<text class="section-hint">共 {{ pager.total }} 瓶 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
						<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="loading" @click="onExport">
							导出筛选
						</AppButton>
					</view>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无钢瓶数据">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">重新加载</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.bottle_no"
						:subtitle="item.filling_company || item.current_customer_name || '库内待命'"
						:status="statusText(item.status)"
						:status-kind="statusKind(item.status)"
						icon="bottle"
						:icon-class="getBottleIconColor(item.status)"
						:clickable="canUpdateBottle"
						@click="canUpdateBottle && onEdit(item)"
					>
						<template #right>
							<view class="info-box">
								<text class="info-label">容积 / 皮重</text>
								<view class="price-box">
									<text class="price-value">{{ formatVolume(item.volume_l) }}</text>
									<text class="price-symbol">L /</text>
									<text class="price-value">{{ formatWeight(item.tare_weight) }}</text>
									<text class="price-symbol">kg</text>
								</view>
							</view>
						</template>
						
						<template #meta>
							<view class="meta-tags">
								<AppTag kind="soft" class="tag-item">{{ item.is_active ? '在用' : '停用' }}</AppTag>
								<text v-if="item.product_no" class="mode-label">产品: {{ item.product_no }}</text>
								<text v-if="item.bottle_next_check_date" class="mode-label">瓶检: {{ item.bottle_next_check_date }}</text>
								<text v-if="item.pressure_gauge_next_check_date" class="mode-label">表检: {{ item.pressure_gauge_next_check_date }}</text>
								<text v-if="item.safety_valve_next_check_date" class="mode-label">阀检: {{ item.safety_valve_next_check_date }}</text>
							</view>
						</template>
						
						<template #footer>
							<view class="footer-btns" @click.stop>
								<AppTag v-if="isBottleSelected(item._id)" kind="success">已勾选</AppTag>
								<AppButton kind="neutral" size="sm" @click="onToggleBottleSelect(item)">
									{{ isBottleSelected(item._id) ? '取消勾选' : '勾选子集' }}
								</AppButton>
								<AppButton v-if="canUpdateBottle" kind="ghost" size="sm" @click="onEdit(item)">修改档案</AppButton>
							</view>
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useQuery } from '@/composables/useQuery'
import { batchUpdateInspectionV1, searchBottlesV1 } from '@/services/bottle'

const props = defineProps({
	initialInspectionDueModule: { type: String, default: '' },
	initialInspectionDueState: { type: String, default: '' }
})

const list = ref([])
const exporting = ref(false)
const summary = ref({ total: 0, inStation: 0, atCustomer: 0, abnormal: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

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
const { canPageAction } = useAuthGuard()
const canCreateBottle = computed(() => canPageAction('/pages/bottle/edit', 'create'))
const canUpdateBottle = computed(() => canPageAction('/pages/bottle/edit', 'update'))
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

const bottleNoModeOptions = [
	{ label: '全部', value: 'all' },
	{ label: '纯数字', value: 'numeric' },
	{ label: '前缀', value: 'prefix' }
]
const CHECK_CYCLE_MONTHS = [6, 12, 24, 36]
const cycleOptions = [
	{ label: '半年', value: 6 },
	{ label: '1 年', value: 12 },
	{ label: '2 年', value: 24 },
	{ label: '3 年', value: 36 }
]
const batchScopeOptions = [
	{ label: '按当前筛选全量', value: 'filter' },
	{ label: '勾选子集', value: 'ids' }
]

const filters = reactive({
	keyword: '',
	statusIndex: 0,
	activeIndex: 0,
	inspectionDueModuleIndex: 0,
	inspectionDueStateIndex: 0,
	bottleNoModeIndex: 0,
	bottleNoPrefix: '',
	bottleNoNumericStart: '',
	bottleNoNumericEnd: '',
	bottleCheckDateEq: '',
	bottleNextCheckDateEq: '',
	gaugeCheckDateEq: '',
	gaugeNextCheckDateEq: '',
	valveCheckDateEq: '',
	valveNextCheckDateEq: ''
})
const selectedBottleIds = ref([])
const batchPreviewLoading = ref(false)
const batchExecuting = ref(false)
const batchPreviewResult = ref(null)
const batchExecuteResult = ref(null)

const batchForm = reactive({
	scopeMode: 'filter',
	bottle: {
		enabled: true,
		checkDate: '',
		cycleMonths: 12,
		nextOverrideDate: ''
	},
	gauge: {
		enabled: false,
		checkDate: '',
		cycleMonths: 12,
		nextOverrideDate: ''
	},
	valve: {
		enabled: false,
		checkDate: '',
		cycleMonths: 12,
		nextOverrideDate: ''
	}
})

const statusLabel = computed(() => statusOptions[filters.statusIndex]?.label || '全部状态')
const activeLabel = computed(() => activeOptions[filters.activeIndex]?.label || '全部启用')
const inspectionDueModuleLabel = computed(() => inspectionDueModuleOptions[filters.inspectionDueModuleIndex]?.label || '全部模块')
const inspectionDueStateLabel = computed(() => inspectionDueStateOptions[filters.inspectionDueStateIndex]?.label || '全部状态')
const bottleNoModeLabel = computed(() => bottleNoModeOptions[filters.bottleNoModeIndex]?.label || '全部')
const isPrefixMode = computed(() => bottleNoModeOptions[filters.bottleNoModeIndex]?.value === 'prefix')
const isNumericMode = computed(() => bottleNoModeOptions[filters.bottleNoModeIndex]?.value === 'numeric')
const batchScopeLabel = computed(() => {
	return batchScopeOptions.find((item) => item.value === batchForm.scopeMode)?.label || batchScopeOptions[0].label
})
const selectedCount = computed(() => selectedBottleIds.value.length)

const subtitle = computed(() => {
	if (!pager.total) return '钢瓶生命周期与流向监控'
	return `当前筛选 ${pager.total} 瓶`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNoPrefix(value) {
	return String(value || '').trim().toUpperCase()
}

function getBottleNoModeValue() {
	return bottleNoModeOptions[filters.bottleNoModeIndex]?.value || 'all'
}

function getInspectionDueModuleValue() {
	return inspectionDueModuleOptions[filters.inspectionDueModuleIndex]?.value || ''
}

function getInspectionDueStateValue() {
	return inspectionDueStateOptions[filters.inspectionDueStateIndex]?.value || ''
}

function toLowerString(value) {
	return normalizeString(value).toLowerCase()
}

function getSelectorIndexByValue(options, value) {
	const target = toLowerString(value)
	if (!target) return 0
	const idx = options.findIndex((item) => toLowerString(item?.value) === target)
	return idx > -1 ? idx : 0
}

function applyInitialInspectionDueFilter() {
	const moduleIndex = getSelectorIndexByValue(inspectionDueModuleOptions, props.initialInspectionDueModule)
	const stateIndex = getSelectorIndexByValue(inspectionDueStateOptions, props.initialInspectionDueState)
	if (moduleIndex > 0 && stateIndex > 0) {
		filters.inspectionDueModuleIndex = moduleIndex
		filters.inspectionDueStateIndex = stateIndex
		return
	}
	filters.inspectionDueModuleIndex = 0
	filters.inspectionDueStateIndex = 0
}

function getInspectionDueModuleText(value) {
	if (value === 'bottle') return '瓶检'
	if (value === 'gauge') return '表检'
	if (value === 'valve') return '阀检'
	return ''
}

function getInspectionDueStateText(value) {
	if (value === 'overdue') return '已过期'
	if (value === 'due_60d') return '60天内到期'
	return ''
}

function toNonNegativeIntegerFromInput(value) {
	const text = normalizeString(value)
	if (!text) return null
	const num = Number(text)
	if (!Number.isInteger(num) || num < 0) return NaN
	return num
}

function getInspectionFilterPairs() {
	return [
		{
			label: '钢瓶批次',
			checkKey: 'bottleCheckDateEq',
			nextKey: 'bottleNextCheckDateEq'
		},
		{
			label: '压力表批次',
			checkKey: 'gaugeCheckDateEq',
			nextKey: 'gaugeNextCheckDateEq'
		},
		{
			label: '安全阀批次',
			checkKey: 'valveCheckDateEq',
			nextKey: 'valveNextCheckDateEq'
		}
	]
}

function getCycleLabel(value) {
	const item = cycleOptions.find((opt) => opt.value === Number(value))
	return item?.label || `${Number(value) || '-'} 月`
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

function addMonths(dateText, months) {
	if (!isValidDateString(dateText)) return ''
	const [year, month, day] = dateText.split('-').map((item) => Number(item))
	const totalMonth = month - 1 + Number(months || 0)
	const targetYear = year + Math.floor(totalMonth / 12)
	const targetMonth = ((totalMonth % 12) + 12) % 12
	const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
	const safeDay = Math.min(day, maxDay)
	return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function getBatchAutoNextDate(moduleKey) {
	const moduleData = batchForm[moduleKey]
	if (!moduleData) return ''
	if (!isValidDateString(moduleData.checkDate)) return ''
	if (!CHECK_CYCLE_MONTHS.includes(Number(moduleData.cycleMonths))) return ''
	return addMonths(moduleData.checkDate, moduleData.cycleMonths)
}

function validateBottleNoRule() {
	const mode = getBottleNoModeValue()
	if (mode === 'prefix') {
		const prefix = normalizeBottleNoPrefix(filters.bottleNoPrefix)
		if (!prefix) {
			uni.showToast({ title: '请输入瓶号前缀', icon: 'none' })
			return false
		}
	}
	if (mode === 'numeric') {
		const start = toNonNegativeIntegerFromInput(filters.bottleNoNumericStart)
		const end = toNonNegativeIntegerFromInput(filters.bottleNoNumericEnd)
		if (Number.isNaN(start) || Number.isNaN(end)) {
			uni.showToast({ title: '纯数字分段必须为非负整数', icon: 'none' })
			return false
		}
		if (start != null && end != null && start > end) {
			uni.showToast({ title: '纯数字起始号不能大于结束号', icon: 'none' })
			return false
		}
	}
	return true
}

function validateInspectionBatchFilters() {
	const pairs = getInspectionFilterPairs()
	for (let i = 0; i < pairs.length; i += 1) {
		const pair = pairs[i]
		const checkDate = normalizeString(filters[pair.checkKey])
		const nextDate = normalizeString(filters[pair.nextKey])
		if (nextDate && !checkDate) {
			uni.showToast({ title: `${pair.label}填写下次日期前需先选择检验日期`, icon: 'none' })
			return false
		}
		if (checkDate && !isValidDateString(checkDate)) {
			uni.showToast({ title: `${pair.label}检验日期格式无效`, icon: 'none' })
			return false
		}
		if (nextDate && !isValidDateString(nextDate)) {
			uni.showToast({ title: `${pair.label}下次日期格式无效`, icon: 'none' })
			return false
		}
	}
	return true
}

function validateInspectionDueFilter() {
	const moduleValue = getInspectionDueModuleValue()
	const stateValue = getInspectionDueStateValue()
	if (moduleValue && !stateValue) {
		uni.showToast({ title: '请选择到期提醒状态', icon: 'none' })
		return false
	}
	if (!moduleValue && stateValue) {
		uni.showToast({ title: '请选择到期提醒模块', icon: 'none' })
		return false
	}
	return true
}

function validateFilterRules() {
	return validateBottleNoRule() && validateInspectionBatchFilters() && validateInspectionDueFilter()
}

function buildInspectionBatchChipLabel(prefix, checkDate, nextDate) {
	if (!checkDate) return ''
	return nextDate ? `${prefix}: ${checkDate}→${nextDate}` : `${prefix}: ${checkDate}`
}

const filterChips = computed(() => {
	const chips = []
	if (filters.keyword) chips.push({ key: 'keyword', label: `关键词: ${filters.keyword}` })
	if (filters.statusIndex > 0) chips.push({ key: 'status', label: `流向: ${statusLabel.value}` })
	if (filters.activeIndex > 0) chips.push({ key: 'active', label: `启用: ${activeLabel.value}` })
	const dueModuleValue = getInspectionDueModuleValue()
	const dueStateValue = getInspectionDueStateValue()
	if (dueModuleValue && dueStateValue) {
		chips.push({
			key: 'inspectionDue',
			label: `到期: ${getInspectionDueModuleText(dueModuleValue)}-${getInspectionDueStateText(dueStateValue)}`
		})
	}
	if (getBottleNoModeValue() === 'numeric') {
		chips.push({ key: 'bottleNoRule', label: '瓶号: 纯数字' })
		const start = normalizeString(filters.bottleNoNumericStart)
		const end = normalizeString(filters.bottleNoNumericEnd)
		if (start || end) chips.push({ key: 'bottleNoNumericRange', label: `瓶号段: ${start || '最小'}-${end || '最大'}` })
	}
	if (getBottleNoModeValue() === 'prefix') {
		const prefix = normalizeBottleNoPrefix(filters.bottleNoPrefix)
		chips.push({ key: 'bottleNoRule', label: `瓶号: 前缀 ${prefix || '(未填)'}` })
	}
	const bottleBatchChip = buildInspectionBatchChipLabel(
		'瓶批',
		normalizeString(filters.bottleCheckDateEq),
		normalizeString(filters.bottleNextCheckDateEq)
	)
	if (bottleBatchChip) chips.push({ key: 'bottleBatch', label: bottleBatchChip })
	const gaugeBatchChip = buildInspectionBatchChipLabel(
		'表批',
		normalizeString(filters.gaugeCheckDateEq),
		normalizeString(filters.gaugeNextCheckDateEq)
	)
	if (gaugeBatchChip) chips.push({ key: 'gaugeBatch', label: gaugeBatchChip })
	const valveBatchChip = buildInspectionBatchChipLabel(
		'阀批',
		normalizeString(filters.valveCheckDateEq),
		normalizeString(filters.valveNextCheckDateEq)
	)
	if (valveBatchChip) chips.push({ key: 'valveBatch', label: valveBatchChip })
	return chips
})

function getFilterSnapshot() {
	const parts = {
		keyword: normalizeString(filters.keyword),
		status: statusOptions[filters.statusIndex]?.value || '',
		active: activeOptions[filters.activeIndex]?.value || 'all',
		inspection_due_module: getInspectionDueModuleValue(),
		inspection_due_state: getInspectionDueStateValue(),
		bottle_no_mode: getBottleNoModeValue(),
		bottle_no_prefix: normalizeBottleNoPrefix(filters.bottleNoPrefix),
		bottle_no_numeric_start: normalizeString(filters.bottleNoNumericStart),
		bottle_no_numeric_end: normalizeString(filters.bottleNoNumericEnd),
		bottle_check_date_eq: normalizeString(filters.bottleCheckDateEq),
		bottle_next_check_date_eq: normalizeString(filters.bottleNextCheckDateEq),
		gauge_check_date_eq: normalizeString(filters.gaugeCheckDateEq),
		gauge_next_check_date_eq: normalizeString(filters.gaugeNextCheckDateEq),
		valve_check_date_eq: normalizeString(filters.valveCheckDateEq),
		valve_next_check_date_eq: normalizeString(filters.valveNextCheckDateEq)
	}
	return JSON.stringify(parts)
}

function clearBatchResultState() {
	batchPreviewResult.value = null
	batchExecuteResult.value = null
}

function clearSelectedBottles({ silent = false, fallbackToFilter = false } = {}) {
	if (fallbackToFilter && batchForm.scopeMode === 'ids') {
		batchForm.scopeMode = 'filter'
	}
	if (!selectedBottleIds.value.length) return
	selectedBottleIds.value = []
	clearBatchResultState()
	if (!silent) {
		uni.showToast({ title: '已清空勾选子集', icon: 'none' })
	}
}

function isBottleSelected(id) {
	const target = normalizeString(id)
	if (!target) return false
	return selectedBottleIds.value.includes(target)
}

function onToggleBottleSelect(item) {
	const id = normalizeString(item?._id)
	if (!id) return
	if (isBottleSelected(id)) {
		selectedBottleIds.value = selectedBottleIds.value.filter((rowId) => rowId !== id)
	} else {
		selectedBottleIds.value = [...selectedBottleIds.value, id]
	}
	clearBatchResultState()
}

function onBatchScopeChange(e) {
	const idx = Number(e?.detail?.value)
	const nextScope = batchScopeOptions[idx]?.value || 'filter'
	batchForm.scopeMode = nextScope
	clearBatchResultState()
	if (nextScope === 'ids' && selectedBottleIds.value.length === 0) {
		uni.showToast({ title: '请先勾选要更新的钢瓶', icon: 'none' })
	}
}

function toggleBatchModule(moduleKey) {
	if (!batchForm[moduleKey]) return
	batchForm[moduleKey].enabled = !batchForm[moduleKey].enabled
	clearBatchResultState()
}

function onBatchDateChange(moduleKey, field, event) {
	if (!batchForm[moduleKey]) return
	batchForm[moduleKey][field] = event?.detail?.value || ''
	clearBatchResultState()
}

function onBatchCycleChange(moduleKey, event) {
	if (!batchForm[moduleKey]) return
	const idx = Number(event?.detail?.value)
	const item = cycleOptions[idx]
	if (!item) return
	batchForm[moduleKey].cycleMonths = item.value
	clearBatchResultState()
}

function resetBatchForm() {
	batchForm.scopeMode = 'filter'
	batchForm.bottle.enabled = true
	batchForm.bottle.checkDate = ''
	batchForm.bottle.cycleMonths = 12
	batchForm.bottle.nextOverrideDate = ''
	batchForm.gauge.enabled = false
	batchForm.gauge.checkDate = ''
	batchForm.gauge.cycleMonths = 12
	batchForm.gauge.nextOverrideDate = ''
	batchForm.valve.enabled = false
	batchForm.valve.checkDate = ''
	batchForm.valve.cycleMonths = 12
	batchForm.valve.nextOverrideDate = ''
	clearBatchResultState()
}

function onBatchReset() {
	resetBatchForm()
}

function onInspectionFilterDateChange(key, event) {
	if (!Object.prototype.hasOwnProperty.call(filters, key)) return
	filters[key] = event?.detail?.value || ''
}

function onClearInspectionFilter() {
	filters.bottleCheckDateEq = ''
	filters.bottleNextCheckDateEq = ''
	filters.gaugeCheckDateEq = ''
	filters.gaugeNextCheckDateEq = ''
	filters.valveCheckDateEq = ''
	filters.valveNextCheckDateEq = ''
	clearBatchResultState()
}

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'status') filters.statusIndex = 0
	if (key === 'active') filters.activeIndex = 0
	if (key === 'inspectionDue') {
		filters.inspectionDueModuleIndex = 0
		filters.inspectionDueStateIndex = 0
	}
	if (key === 'bottleNoRule') {
		filters.bottleNoModeIndex = 0
		filters.bottleNoPrefix = ''
		filters.bottleNoNumericStart = ''
		filters.bottleNoNumericEnd = ''
	}
	if (key === 'bottleNoNumericRange') {
		filters.bottleNoNumericStart = ''
		filters.bottleNoNumericEnd = ''
	}
	if (key === 'bottleBatch') {
		filters.bottleCheckDateEq = ''
		filters.bottleNextCheckDateEq = ''
	}
	if (key === 'gaugeBatch') {
		filters.gaugeCheckDateEq = ''
		filters.gaugeNextCheckDateEq = ''
	}
	if (key === 'valveBatch') {
		filters.valveCheckDateEq = ''
		filters.valveNextCheckDateEq = ''
	}
	onSearch(true)
}

function onSummaryFilter(type) {
	if (type === 'in_station') {
		const idx = statusOptions.findIndex((item) => item.value === 'in_station')
		filters.statusIndex = idx > -1 ? idx : 0
	} else if (type === 'at_customer') {
		const idx = statusOptions.findIndex((item) => item.value === 'at_customer')
		filters.statusIndex = idx > -1 ? idx : 0
	} else {
		filters.statusIndex = 0
	}
	filters.activeIndex = 0
	onSearch(true)
}

function buildIsActiveParam() {
	const value = activeOptions[filters.activeIndex]?.value
	if (value === 'true') return true
	if (value === 'false') return false
	return undefined
}

function buildListParams({ page = 1, pageSize = 50 } = {}) {
	const bottleNoMode = getBottleNoModeValue()
	const bottleNoPrefix = normalizeBottleNoPrefix(filters.bottleNoPrefix)
	const numericStart = toNonNegativeIntegerFromInput(filters.bottleNoNumericStart)
	const numericEnd = toNonNegativeIntegerFromInput(filters.bottleNoNumericEnd)
	const inspectionDueModule = getInspectionDueModuleValue()
	const inspectionDueState = getInspectionDueStateValue()
	const data = {
		keyword: filters.keyword,
		status: statusOptions[filters.statusIndex]?.value || '',
		is_active: buildIsActiveParam(),
		inspection_due_module: inspectionDueModule,
		inspection_due_state: inspectionDueState,
		bottle_no_mode: bottleNoMode,
		bottle_check_date_eq: normalizeString(filters.bottleCheckDateEq),
		bottle_next_check_date_eq: normalizeString(filters.bottleNextCheckDateEq),
		gauge_check_date_eq: normalizeString(filters.gaugeCheckDateEq),
		gauge_next_check_date_eq: normalizeString(filters.gaugeNextCheckDateEq),
		valve_check_date_eq: normalizeString(filters.valveCheckDateEq),
		valve_next_check_date_eq: normalizeString(filters.valveNextCheckDateEq),
		page,
		pageSize
	}
	if (data.is_active == null) delete data.is_active
	if (bottleNoMode === 'prefix') data.bottle_no_prefix = bottleNoPrefix
	if (bottleNoMode === 'numeric') {
		if (numericStart != null && !Number.isNaN(numericStart)) data.bottle_no_numeric_start = numericStart
		if (numericEnd != null && !Number.isNaN(numericEnd)) data.bottle_no_numeric_end = numericEnd
	}
	if (!inspectionDueModule || !inspectionDueState) {
		delete data.inspection_due_module
		delete data.inspection_due_state
	}
	if (!data.bottle_check_date_eq) delete data.bottle_check_date_eq
	if (!data.bottle_next_check_date_eq) delete data.bottle_next_check_date_eq
	if (!data.gauge_check_date_eq) delete data.gauge_check_date_eq
	if (!data.gauge_next_check_date_eq) delete data.gauge_next_check_date_eq
	if (!data.valve_check_date_eq) delete data.valve_check_date_eq
	if (!data.valve_next_check_date_eq) delete data.valve_next_check_date_eq
	return data
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await searchBottlesV1(buildListParams({ page: pager.page, pageSize: pager.pageSize }))
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, in_station: 0, at_customer: 0, abnormal: 0 }
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: Number(res.total || 0),
				hasMore: false
			},
			summary: res.summary || { total: 0, in_station: 0, at_customer: 0, abnormal: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, in_station: 0, at_customer: 0, abnormal: 0 }
		},
			cacheTTL: 15000,
			throttleMs: 300,
			cacheKey: () =>
				`bottle:list:${filters.keyword}:${filters.statusIndex}:${filters.activeIndex}:${filters.inspectionDueModuleIndex}:${filters.inspectionDueStateIndex}:${filters.bottleNoModeIndex}:${normalizeBottleNoPrefix(filters.bottleNoPrefix)}:${normalizeString(filters.bottleNoNumericStart)}:${normalizeString(filters.bottleNoNumericEnd)}:${normalizeString(filters.bottleCheckDateEq)}:${normalizeString(filters.bottleNextCheckDateEq)}:${normalizeString(filters.gaugeCheckDateEq)}:${normalizeString(filters.gaugeNextCheckDateEq)}:${normalizeString(filters.valveCheckDateEq)}:${normalizeString(filters.valveNextCheckDateEq)}:${pager.page}:${pager.pageSize}`
		}
	)

function applyResult(payload) {
	const data = payload || {}
	const rows = Array.isArray(data.items) ? data.items : []
	list.value = [...rows].sort((a, b) => compareBottleNoNatural(a?.bottle_no, b?.bottle_no))
	const paging = data.paging || {}
	pager.page = Number(paging.page || pager.page || 1)
	pager.pageSize = Number(paging.pageSize || pager.pageSize || 50)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)
	const summaryData = data.summary || {}
	summary.value = {
		total: Number(summaryData.total || 0),
		inStation: Number(summaryData.in_station ?? summaryData.inStation ?? 0),
		atCustomer: Number(summaryData.at_customer ?? summaryData.atCustomer ?? 0),
		abnormal: Number(summaryData.abnormal || 0)
	}
}

async function onSearch(resetPage = false) {
	const shouldResetPage = resetPage === true
	if (!validateFilterRules()) return
	if (shouldResetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.keyword = ''
	filters.statusIndex = 0
	filters.activeIndex = 0
	filters.inspectionDueModuleIndex = 0
	filters.inspectionDueStateIndex = 0
	filters.bottleNoModeIndex = 0
	filters.bottleNoPrefix = ''
	filters.bottleNoNumericStart = ''
	filters.bottleNoNumericEnd = ''
	filters.bottleCheckDateEq = ''
	filters.bottleNextCheckDateEq = ''
	filters.gaugeCheckDateEq = ''
	filters.gaugeNextCheckDateEq = ''
	filters.valveCheckDateEq = ''
	filters.valveNextCheckDateEq = ''
	onSearch(true)
}

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	filters.statusIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	filters.activeIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onInspectionDueModuleChange(e) {
	const idx = Number(e?.detail?.value)
	filters.inspectionDueModuleIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onInspectionDueStateChange(e) {
	const idx = Number(e?.detail?.value)
	filters.inspectionDueStateIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onBottleNoModeChange(e) {
	const idx = Number(e?.detail?.value)
	filters.bottleNoModeIndex = Number.isFinite(idx) ? idx : 0
	const mode = getBottleNoModeValue()
	if (mode !== 'prefix') {
		filters.bottleNoPrefix = ''
	}
	if (mode !== 'numeric') {
		filters.bottleNoNumericStart = ''
		filters.bottleNoNumericEnd = ''
	}
	if (mode !== 'prefix') {
		onSearch(true)
		return
	}
	clearSelectedBottles({ silent: true, fallbackToFilter: true })
	clearBatchResultState()
}

function buildBatchSelectorByFilters() {
	const params = buildListParams({ page: 1, pageSize: 1 })
	const selector = {
		keyword: normalizeString(params.keyword),
		status: normalizeString(params.status),
		bottle_no_mode: normalizeString(params.bottle_no_mode || 'all')
	}
	if (params.is_active != null) selector.is_active = Boolean(params.is_active)
	if (selector.bottle_no_mode === 'prefix') {
		selector.bottle_no_prefix = normalizeBottleNoPrefix(params.bottle_no_prefix)
	}
	if (selector.bottle_no_mode === 'numeric') {
		if (params.bottle_no_numeric_start != null) selector.bottle_no_numeric_start = params.bottle_no_numeric_start
		if (params.bottle_no_numeric_end != null) selector.bottle_no_numeric_end = params.bottle_no_numeric_end
	}
	if (params.inspection_due_module) selector.inspection_due_module = params.inspection_due_module
	if (params.inspection_due_state) selector.inspection_due_state = params.inspection_due_state
	if (params.bottle_check_date_eq) selector.bottle_check_date_eq = params.bottle_check_date_eq
	if (params.bottle_next_check_date_eq) selector.bottle_next_check_date_eq = params.bottle_next_check_date_eq
	if (params.gauge_check_date_eq) selector.gauge_check_date_eq = params.gauge_check_date_eq
	if (params.gauge_next_check_date_eq) selector.gauge_next_check_date_eq = params.gauge_next_check_date_eq
	if (params.valve_check_date_eq) selector.valve_check_date_eq = params.valve_check_date_eq
	if (params.valve_next_check_date_eq) selector.valve_next_check_date_eq = params.valve_next_check_date_eq
	return selector
}

function getBatchModuleLabel(moduleKey) {
	if (moduleKey === 'bottle') return '钢瓶检验'
	if (moduleKey === 'gauge') return '压力表检验'
	if (moduleKey === 'valve') return '安全阀检验'
	return '检验模块'
}

function buildBatchModulesPayload() {
	const modules = {}
	const moduleKeys = ['bottle', 'gauge', 'valve']
	for (let i = 0; i < moduleKeys.length; i += 1) {
		const key = moduleKeys[i]
		const moduleData = batchForm[key]
		if (!moduleData?.enabled) continue
		const label = getBatchModuleLabel(key)
		const checkDate = normalizeString(moduleData.checkDate)
		const cycleMonths = Number(moduleData.cycleMonths)
		const nextOverrideDate = normalizeString(moduleData.nextOverrideDate)
		if (!isValidDateString(checkDate)) {
			return { ok: false, msg: `${label}的检验日期必填且格式正确` }
		}
		if (!CHECK_CYCLE_MONTHS.includes(cycleMonths)) {
			return { ok: false, msg: `${label}的检测周期无效` }
		}
		if (nextOverrideDate && !isValidDateString(nextOverrideDate)) {
			return { ok: false, msg: `${label}的下次检验日期格式无效` }
		}
		modules[key] = {
			check_date: checkDate,
			cycle_months: cycleMonths,
			next_check_date_override: nextOverrideDate || ''
		}
	}
	if (!Object.keys(modules).length) return { ok: false, msg: '至少选择一个更新模块' }
	return { ok: true, data: modules }
}

function buildBatchRequest(preview) {
	const scopeMode = batchForm.scopeMode === 'ids' ? 'ids' : 'filter'
	if (scopeMode === 'filter' && !validateFilterRules()) return null
	const modulesResult = buildBatchModulesPayload()
	if (!modulesResult.ok) {
		uni.showToast({ title: modulesResult.msg, icon: 'none' })
		return null
	}
	const payload = {
		preview: Boolean(preview),
		scope_mode: scopeMode,
		selector: {},
		modules: modulesResult.data
	}
	if (scopeMode === 'ids') {
		const ids = Array.from(new Set(selectedBottleIds.value.map((id) => normalizeString(id)).filter(Boolean)))
		if (!ids.length) {
			uni.showToast({ title: '勾选子集为空，请先勾选钢瓶', icon: 'none' })
			return null
		}
		payload.selector = { ids }
		return payload
	}
	payload.selector = buildBatchSelectorByFilters()
	if (payload.selector.bottle_no_mode === 'prefix' && !payload.selector.bottle_no_prefix) {
		uni.showToast({ title: '请输入瓶号前缀', icon: 'none' })
		return null
	}
	return payload
}

function formatBottleNoSamples(samples) {
	const listData = Array.isArray(samples) ? samples.map((item) => normalizeString(item)).filter(Boolean) : []
	if (!listData.length) return '无'
	const preview = listData.slice(0, 12).join('、')
	return listData.length > 12 ? `${preview} ...` : preview
}

function formatFailedBottleNos(items) {
	const listData = Array.isArray(items) ? items : []
	if (!listData.length) return '无'
	const values = listData
		.slice(0, 20)
		.map((item) => normalizeString(item?.bottle_no) || normalizeString(item?._id))
		.filter(Boolean)
	const text = values.join('、') || '无'
	return listData.length > 20 ? `${text} ...` : text
}

function formatUpdateFieldSummary(updateFields) {
	const rows = Array.isArray(updateFields) ? updateFields : []
	if (!rows.length) return '无'
	return rows
		.map((row) => {
			const label = normalizeString(row?.label) || getBatchModuleLabel(row?.module)
			const cycle = getCycleLabel(row?.cycle_months)
			const nextText = row?.next_check_date && row.next_check_date !== 'auto' ? `下次=${row.next_check_date}` : '下次自动计算'
			return `${label}(检验=${row?.check_date || '-'}，周期=${cycle}，${nextText})`
		})
		.join('；')
}

async function onBatchPreview() {
	if (batchPreviewLoading.value || batchExecuting.value) return
	const payload = buildBatchRequest(true)
	if (!payload) return
	batchPreviewLoading.value = true
	batchExecuteResult.value = null
	try {
		const res = await batchUpdateInspectionV1(payload)
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
	const previewPayload = buildBatchRequest(true)
	if (!previewPayload) return
	batchExecuting.value = true
	batchExecuteResult.value = null
	try {
		const previewRes = await batchUpdateInspectionV1(previewPayload)
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
		const confirmRes = await uni.showModal({
			title: '确认批量更新',
			content: `将更新 ${total} 条钢瓶记录。\n${formatUpdateFieldSummary(previewData.update_fields)}\n确认执行吗？`,
			showCancel: true
		})
		if (!confirmRes.confirm) return

		const executeRes = await batchUpdateInspectionV1({ ...previewPayload, preview: false })
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
		await onSearch()
	} catch (err) {
		uni.showToast({ title: err?.message || '执行失败', icon: 'none', duration: 2800 })
	} finally {
		batchExecuting.value = false
	}
}

function statusText(status) {
	const map = {
		unknown: '未知',
		in_station: '在站',
		at_customer: '在客户',
		scrapped: '报废',
		lost: '丢失'
	}
	return map[status] || status || '-'
}

function statusKind(status) {
	if (status === 'scrapped' || status === 'lost') return 'danger'
	if (status === 'in_station' || status === 'at_customer') return 'success'
	return 'info'
}

function getBottleIconColor(status) {
	if (status === 'scrapped' || status === 'lost') return 'bg-danger'
	if (status === 'in_station') return 'bg-teal'
	if (status === 'at_customer') return 'bg-emerald'
	return 'bg-primary'
}

function formatVolume(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num <= 0) return '--'
	return Number.isInteger(num) ? String(num) : num.toFixed(2)
}

function formatWeight(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num < 0) return '--'
	return Number.isInteger(num) ? String(num) : num.toFixed(2)
}

function formatExportNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	if (Number.isInteger(num)) return String(num)
	return num.toFixed(6).replace(/\.?0+$/, '')
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

function normalizeFileNamePart(value, fallback = '全部') {
	const text = String(value || '').trim()
	if (!text) return fallback
	return text
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\s+/g, '')
		.slice(0, 24) || fallback
}

function formatDateCompact(value) {
	const text = normalizeString(value)
	if (!text) return ''
	return text.replace(/-/g, '')
}

function buildInspectionExportNameParts() {
	const parts = []
	const bottleCheck = normalizeString(filters.bottleCheckDateEq)
	const bottleNext = normalizeString(filters.bottleNextCheckDateEq)
	if (bottleCheck) {
		parts.push(
			bottleNext
				? `瓶批-${formatDateCompact(bottleCheck)}_${formatDateCompact(bottleNext)}`
				: `瓶批-${formatDateCompact(bottleCheck)}`
		)
	}
	const gaugeCheck = normalizeString(filters.gaugeCheckDateEq)
	const gaugeNext = normalizeString(filters.gaugeNextCheckDateEq)
	if (gaugeCheck) {
		parts.push(
			gaugeNext
				? `表批-${formatDateCompact(gaugeCheck)}_${formatDateCompact(gaugeNext)}`
				: `表批-${formatDateCompact(gaugeCheck)}`
		)
	}
	const valveCheck = normalizeString(filters.valveCheckDateEq)
	const valveNext = normalizeString(filters.valveNextCheckDateEq)
	if (valveCheck) {
		parts.push(
			valveNext
				? `阀批-${formatDateCompact(valveCheck)}_${formatDateCompact(valveNext)}`
				: `阀批-${formatDateCompact(valveCheck)}`
		)
	}
	return parts
}

function buildInspectionDueExportNamePart() {
	const moduleValue = getInspectionDueModuleValue()
	const stateValue = getInspectionDueStateValue()
	if (!moduleValue || !stateValue) return ''
	const moduleText = getInspectionDueModuleText(moduleValue)
	const stateText = getInspectionDueStateText(stateValue)
	if (!moduleText || !stateText) return ''
	return `到期-${moduleText}${stateText}`
}

function buildExportFileName(total) {
	const bottleNoMode = getBottleNoModeValue()
	const bottleNoRulePart =
		bottleNoMode === 'numeric'
			? '瓶号-纯数字'
			: bottleNoMode === 'prefix'
				? `瓶号-前缀${normalizeFileNamePart(normalizeBottleNoPrefix(filters.bottleNoPrefix), '未填')}`
				: '瓶号-全部'
	const bottleNoRangePart =
		bottleNoMode === 'numeric' && (normalizeString(filters.bottleNoNumericStart) || normalizeString(filters.bottleNoNumericEnd))
			? `瓶号段-${normalizeFileNamePart(normalizeString(filters.bottleNoNumericStart) || '最小')}-${normalizeFileNamePart(normalizeString(filters.bottleNoNumericEnd) || '最大')}`
			: ''
	const inspectionParts = buildInspectionExportNameParts()
	const inspectionDuePart = buildInspectionDueExportNamePart()
	const statusPart = normalizeFileNamePart(statusLabel.value, '全部状态')
	const activePart = normalizeFileNamePart(activeLabel.value, '全部启用')
	const keywordPart = normalizeFileNamePart(filters.keyword, '关键词-全部')
	const dynamicParts = [bottleNoRulePart]
	if (bottleNoRangePart) dynamicParts.push(bottleNoRangePart)
	if (inspectionDuePart) dynamicParts.push(inspectionDuePart)
	dynamicParts.push(...inspectionParts)
	return `钢瓶档案_${dynamicParts.join('_')}_${statusPart}_${activePart}_${keywordPart}_${total}条_${formatExportTimestamp()}.csv`
}

function buildBottleExportCsv(rows = []) {
	const columns = [
		{ label: '单位内编号', get: (row) => row.bottle_no || '' },
		{ label: '充装单位', get: (row) => row.filling_company || '' },
		{ label: '登记证标号', get: (row) => row.registration_mark || '' },
		{ label: '设备品种', get: (row) => row.equipment_type || '' },
		{ label: '产品编号', get: (row) => row.product_no || '' },
		{ label: 'PDA二维码号', get: (row) => row.pda_qr_code || '' },
		{ label: '原二维码号', get: (row) => row.qr_code || '' },
		{ label: '制造单位', get: (row) => row.manufacturer || '' },
		{ label: '容积(L)', get: (row) => formatExportNumber(row.volume_l) },
		{ label: '制造日期', get: (row) => row.manufacture_date || '' },
		{ label: '钢瓶检验日期', get: (row) => row.bottle_check_date || '' },
		{ label: '钢瓶下次检验日期', get: (row) => row.bottle_next_check_date || '' },
		{ label: '钢瓶检测周期(月)', get: (row) => formatExportNumber(row.bottle_check_cycle_months) },
		{ label: '报废期限', get: (row) => row.scrap_due_date || '' },
		{ label: '压力表号', get: (row) => row.pressure_gauge_no || '' },
		{ label: '压力表厂家', get: (row) => row.pressure_gauge_manufacturer || '' },
		{ label: '压力区间最小', get: (row) => formatExportNumber(row.pressure_gauge_range_min) },
		{ label: '压力区间最大', get: (row) => formatExportNumber(row.pressure_gauge_range_max) },
		{ label: '压力表检验日期', get: (row) => row.pressure_gauge_check_date || '' },
		{ label: '压力表下次检验日期', get: (row) => row.pressure_gauge_next_check_date || '' },
		{ label: '压力表检测周期(月)', get: (row) => formatExportNumber(row.pressure_gauge_cycle_months) },
		{ label: '安全阀数量', get: (row) => formatExportNumber(row.safety_valve_count) },
		{ label: '安全阀检验日期', get: (row) => row.safety_valve_check_date || '' },
		{ label: '安全阀下次检验日期', get: (row) => row.safety_valve_next_check_date || '' },
		{ label: '安全阀检测周期(月)', get: (row) => formatExportNumber(row.safety_valve_cycle_months) },
		{ label: '皮重(kg)', get: (row) => formatExportNumber(row.tare_weight) },
		{ label: '流向状态', get: (row) => statusText(row.status) },
		{ label: '启用状态', get: (row) => (row.is_active ? '在用' : '停用') },
		{ label: '当前客户', get: (row) => row.current_customer_name || '' },
		{ label: '备注', get: (row) => row.remark || '' }
	]

	const header = columns.map((col) => toCsvCell(col.label)).join(',')
	const body = rows.map((row) => columns.map((col) => toCsvCell(col.get(row))).join(','))
	return [header, ...body].join('\r\n')
}

async function fetchAllBottlesForExport() {
	const allRows = []
	const pageSize = 50
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 400) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await searchBottlesV1(buildListParams({ page, pageSize }))
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const rows = Array.isArray(res.data) ? res.data : []
		allRows.push(...rows)
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
	if (!validateFilterRules()) return
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const rows = await fetchAllBottlesForExport()
		if (!rows.length) {
			uni.showToast({ title: '没有可导出的数据', icon: 'none' })
			return
		}
		const sortedRows = [...rows].sort((a, b) => compareBottleNoNatural(a?.bottle_no, b?.bottle_no))
		const csvText = buildBottleExportCsv(sortedRows)
		const fileName = buildExportFileName(sortedRows.length)
		const downloaded = downloadCsvOnH5(csvText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持下载，请在浏览器端导出', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: `已导出${sortedRows.length}条`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2600 })
	} finally {
		uni.hideLoading()
		exporting.value = false
	}
}

function onAdd() {
	uni.navigateTo({ url: '/pages/bottle/edit' })
}

function onEdit(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/bottle/edit?_id=${encodeURIComponent(item._id)}` })
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
	applyInitialInspectionDueFilter()
	onSearch(true)
})

watch(
	() => getFilterSnapshot(),
	(next, prev) => {
		if (!prev || next === prev) return
		clearSelectedBottles({ silent: true, fallbackToFilter: true })
		clearBatchResultState()
	}
)

defineExpose({
	refresh: onSearch
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

.inspection-filter-wrap {
	margin-top: 16rpx;
	padding: 14rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #f8fafc;
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.inspection-filter-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
	flex-wrap: wrap;
}

.inspection-filter-title {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.inspection-filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320rpx, 1fr));
	gap: 12rpx;
}

.inspection-filter-card {
	background: #fff;
	border: 1rpx solid #e2e8f0;
	border-radius: 10rpx;
	padding: 12rpx;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.inspection-filter-card__title {
	font-size: 22rpx;
	font-weight: 600;
	color: var(--crm-text);
}

.batch-head-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.batch-module-toggle {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	margin-top: 16rpx;
}

.batch-module-card {
	margin-top: 16rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	padding: 16rpx;
	background: #f8fafc;
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.batch-module-title {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.batch-module-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.batch-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.batch-result {
	margin-top: 16rpx;
	padding: 14rpx 16rpx;
	background: #f1f5f9;
	border-radius: var(--crm-radius-sm);
	display: flex;
	flex-direction: column;
	gap: 6rpx;
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

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.section-actions {
	display: flex;
	align-items: center;
	gap: 12rpx;
	flex-wrap: wrap;
	justify-content: flex-end;
}

.pager-row {
	margin-top: 12rpx;
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
}

.info-box {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4rpx;
}

.info-label {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.price-box {
	display: flex;
	align-items: baseline;
	gap: 4rpx;
}

.price-symbol {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	font-weight: 600;
}

.price-value {
	font-size: 36rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.mode-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	background: #f1f5f9;
	padding: 4rpx 12rpx;
	border-radius: 8rpx;
}

.footer-btns {
	display: flex;
	gap: 10rpx;
	align-items: center;
	flex-wrap: wrap;
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
