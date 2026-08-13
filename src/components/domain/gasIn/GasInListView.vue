<template>
	<AppPage title="天然气库存" :subtitle="subtitle" icon="truck">
		<template #headerActions>
			<AppButton v-if="canCreateGasIn" size="sm" kind="primary" icon="plus" @click="onAdd">新增入库</AppButton>
			<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="loading" @click="onExport">导出</AppButton>
		</template>

		<template #highlights>
			<view class="highlight-groups">
				<view class="highlight-group">
					<view class="highlight-group__head">
						<view class="highlight-group__title-wrap">
							<text class="highlight-group__title">现场库存</text>
							<text :class="['tank-status', tankStatusClass]">{{ physicalStatusLabel }}</text>
						</view>
						<text class="highlight-group__hint">账期自 {{ currentPeriod.cutoff_day }} 起 · {{ tankSampledAtText }}</text>
					</view>
					<view class="summary-row summary-row--inventory">
						<AppStatCard class="summary-card" label="现场总库存" :value="formatOptionalTonText(currentPhysical.total_t)" hint="吨" icon="bottle" />
						<AppStatCard class="summary-card" label="储罐剩余" :value="formatOptionalTonText(currentPhysical.tank_t)" hint="吨" icon="check-circle" />
						<AppStatCard class="summary-card" label="已灌未售" :value="formatTonText(currentPhysical.filled_unsold_t)" hint="吨" icon="list" />
						<AppStatCard class="summary-card" label="已灌未售瓶数" :value="currentPhysical.filled_unsold_count" hint="只" icon="list" />
						<AppStatCard class="summary-card" label="待核对瓶数" :value="currentQuality.unresolved_bottle_count" hint="只" icon="alert" />
					</view>
				</view>
				<view class="highlight-group">
					<view class="highlight-group__head">
						<text class="highlight-group__title">入库来源</text>
						<text class="highlight-group__hint">当前筛选范围：{{ flowRangeText }}</text>
					</view>
					<view class="summary-row summary-row--flow">
						<AppStatCard class="summary-card" label="入库车次" :value="summary.total" hint="条" icon="list" />
						<AppStatCard class="summary-card" label="采购净重" :value="formatTonText(summary.netWeightTTotal)" hint="吨" icon="chart" />
						<AppStatCard class="summary-card" label="站内卸入" :value="formatTonText(summary.stationWeightTTotal)" hint="吨" icon="check-circle" />
						<AppStatCard class="summary-card" label="直销随车" :value="formatTonText(summary.directSaleWeightTTotal)" hint="吨" icon="truck" />
						<AppStatCard class="summary-card" label="入库金额" :value="formatMoneyText(summary.amountTotal)" hint="元" icon="wallet" />
						<AppStatCard class="summary-card" label="采购均价" :value="formatMoneyText(summary.avgPricePerTon)" hint="元/吨" icon="chart" />
						<AppStatCard class="summary-card" label="损耗率" :value="formatPercentText(summary.lossRate)" hint="%" icon="alert" />
					</view>
				</view>
				<view class="highlight-group">
					<view class="highlight-group__head">
						<view class="highlight-group__title-wrap">
							<text class="highlight-group__title">账面核对</text>
							<text :class="['tank-status', tankStatusClass]">{{ tankStatusLabel }}</text>
						</view>
						<text class="highlight-group__hint">切点前流水已封存，不参与当前账面储罐量</text>
					</view>
					<view class="tank-panel">
						<view class="tank-gauge-card">
							<view class="tank-gauge">
								<view class="tank-gauge__shell">
									<view class="tank-gauge__fill" :style="{ height: tankLevelFillHeight }"></view>
									<text class="tank-gauge__percent">{{ tankLevelPercentText }}</text>
								</view>
								<view class="tank-gauge__legs">
									<view></view>
									<view></view>
								</view>
							</view>
							<view class="tank-message">
								<text class="tank-message__title">{{ currentPhysical.message }}</text>
								<text class="tank-message__body">{{ tankWeightSourceText }}。账面差异只用于发现漏单，不会覆盖现场值。</text>
							</view>
						</view>
						<view class="summary-row summary-row--tank">
							<AppStatCard class="summary-card" label="账面储罐" :value="formatOptionalTonText(currentLedger.tank_t)" hint="吨" icon="chart" />
							<AppStatCard class="summary-card" label="现场储罐" :value="formatOptionalTonText(currentPhysical.tank_t)" hint="吨" icon="check-circle" />
							<AppStatCard class="summary-card" label="现场与账面差异" :value="formatOptionalSignedTonText(currentLedger.diff_t)" hint="吨" icon="alert" />
							<AppStatCard class="summary-card" label="储罐液位" :value="tankLevelDisplayText" :hint="tankLevelUnit" icon="list" />
							<AppStatCard class="summary-card" label="储罐压力" :value="tankPressureText" hint="MPa" icon="chart" />
						</view>
					</view>
					<view v-if="canMaintainGasInventory" class="tank-config-row">
						<AppInput v-model="tankConfigDraft" class="tank-config-input" label="备用满罐吨数" placeholder="仅PLC重量缺失时使用" prefix-icon="bottle" type="number" size="sm" />
						<AppButton size="sm" kind="primary" :loading="savingTankConfig" :disabled="loading || savingTankConfig" @click="onSaveTankConfig">保存配置</AppButton>
					</view>
				</view>
			</view>
			<view v-if="inventoryWarning" class="inventory-warning">
				{{ inventoryWarning }}
			</view>
		</template>

		<view class="list-shell">
			<view class="quick-date-strip">
				<AppDatePresetBar v-model="datePreset" @update:modelValue="onDatePresetChange" />
			</view>
			<view class="ops-row">
				<AppButton v-if="canMaintainGasInventory" size="sm" kind="neutral" :loading="syncing" :disabled="loading || periodActivating" @click="onSyncCycle">闭环同步</AppButton>
				<AppButton v-if="canMaintainGasInventory" size="sm" kind="neutral" :loading="periodActivating" :disabled="loading || syncing" @click="onManagePeriod">账期管理</AppButton>
			</view>
			<view v-if="serviceWarning" class="service-warning">{{ serviceWarning }}</view>

			<AppSection title="入库流水筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true, { force: true })">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput v-model="filters.keyword" label="关键词" placeholder="车牌/挂车/厂家/备注" prefix-icon="search" size="sm" />
					<AppInput v-model="filters.plate_no" label="车牌号" placeholder="精确车牌" prefix-icon="truck" size="sm" />
					<picker class="picker-block" mode="date" @change="onDateStartChange">
						<AppInput v-model="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="onDateEndChange">
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

			<AppSection title="入库来源流水">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无入库流水">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">重新查询</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.plate_no || '-'"
						:subtitle="item.date"
						icon="truck"
						icon-class="bg-emerald"
					>
						<template #right>
							<view class="weight-box">
								<text class="weight-value">{{ formatTonText(item.net_weight_t) }}</text>
								<text class="weight-unit">吨</text>
							</view>
						</template>

						<template #meta>
							<view class="meta-tags">
								<AppTag kind="soft">{{ item.product_name || 'LNG' }}</AppTag>
								<AppTag kind="soft">站内卸入: {{ formatTonText(item.station_weight_t == null ? item.net_weight_t : item.station_weight_t) }} 吨</AppTag>
								<AppTag v-if="toNumber(item.direct_sale_weight_t, 0) > 0" kind="warning">直销随车: {{ formatTonText(item.direct_sale_weight_t) }} 吨</AppTag>
								<AppTag kind="soft">单价: {{ formatMoneyText(item.unit_price_per_ton) }} 元/吨</AppTag>
								<AppTag kind="soft">金额: {{ formatMoneyText(item.amount) }} 元</AppTag>
								<AppTag v-if="item.loss_amount_t < 0" kind="warning">负损耗</AppTag>
								<text v-if="item.remark" class="meta-text">{{ item.remark }}</text>
							</view>
						</template>

						<template #footer>
							<AppButton v-if="canUpdateGasIn" size="sm" kind="outline" @click="onEdit(item)">编辑</AppButton>
							<AppButton v-if="canDeleteGasIn" size="sm" kind="neutral" :loading="removingId === item._id" @click="onRemove(item)">删除</AppButton>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
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
import { buildDatePresetRange, detectDatePreset, formatDateInput } from '@/utils/datePreset'
import {
	activateGasInventoryPeriodV1,
	getCurrentGasInventoryV1,
	getGasTankConfigV1,
	listGasInV1,
	listGasInventoryPeriodsV1,
	previewGasInventoryPeriodV1,
	removeGasInV1,
	syncGasCycleAdjustmentsV1,
	updateGasTankConfigV1
} from '@/services/gasIn'

const list = ref([])
const removingId = ref('')
const exporting = ref(false)
const syncing = ref(false)
const periodActivating = ref(false)
const savingTankConfig = ref(false)
const tankConfigDraft = ref('')
const serviceWarning = ref('')
const clockNow = ref(Date.now())
let freshnessTimer = null
let inventoryRefreshTimer = null
let inventoryRefreshRunning = false

const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const defaultMonthRange = buildDatePresetRange('month', new Date())

const filters = reactive({
	keyword: '',
	plate_no: '',
	dateStart: defaultMonthRange.dateStart,
	dateEnd: defaultMonthRange.dateEnd
})
const datePreset = ref('month')

function buildEmptyTankTelemetry() {
	return {
		level_m: null,
		level_kpa: null,
		level_percent: null,
		pressure_mpa: null,
		lng_weight_t: null,
		status: 'empty',
		sampled_at: null,
		updated_at: null,
		message: ''
	}
}

function buildEmptyCurrentInventory() {
	return {
		period: {
			cutoff_day: '2026-08-12',
			cutoff_at: 1786464000000,
			opening_tank_t: 0,
			persisted: false
		},
		physical: {
			tank_t: null,
			filled_unsold_t: 0,
			total_t: null,
			filled_unsold_count: 0,
			available: false,
			status: 'empty',
			sampled_at: null,
			weight_source: 'unavailable',
			is_fallback: false,
			message: '等待储罐网关上报，总库存暂不可用'
		},
		ledger: {
			tank_t: 0,
			diff_t: null
		},
		quality: {
			unresolved_bottle_count: 0,
			message: ''
		}
	}
}

function buildEmptyTankEstimate() {
	return {
		full_tank_weight_t: 0,
		estimated_t: null,
		station_total_t: 0,
		diff_t: null,
		configured: false,
		available: false,
		message: ''
	}
}

const summary = reactive({
	total: 0,
	loadWeightTTotal: 0,
	netWeightTTotal: 0,
	stationWeightTTotal: 0,
	directSaleWeightTTotal: 0,
	lossAmountTTotal: 0,
	avgPricePerTon: 0,
	lossRate: 0,
	amountTotal: 0,
	inventory: {
		asset_total_t: 0,
		station_total_t: 0,
		in_bottle_total_t: 0,
		vehicle_total_t: 0,
		balance_diff_t: 0,
		as_of_date: '',
		scope: '',
		movement_total: 0,
		tank: buildEmptyTankTelemetry(),
		estimate: buildEmptyTankEstimate(),
		current: buildEmptyCurrentInventory()
	}
})
const { canPageAction } = useAuthGuard()
const canCreateGasIn = computed(() => canPageAction('/pages/gas-in/edit', 'create'))
const canUpdateGasIn = computed(() => canPageAction('/pages/gas-in/edit', 'update'))
const canDeleteGasIn = computed(() => canPageAction('/pages/gas-in/list', 'delete'))
const canMaintainGasInventory = computed(() => canPageAction('/pages/gas-in/list', 'update'))

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function toNullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function formatWithThousands(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0'
	const text = num.toFixed(digits)
	const [intPart, decimalPart] = text.split('.')
	const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	if (!decimalPart) return grouped
	return `${grouped}.${decimalPart}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function formatTonText(value) {
	return formatWithThousands(toNumber(value, 0), 3)
}

function formatOptionalTonText(value) {
	const num = toNullableNumber(value)
	if (num == null) return '--'
	return formatWithThousands(num, 3)
}

function formatOptionalSignedTonText(value) {
	const num = toNullableNumber(value)
	if (num == null) return '--'
	const text = formatWithThousands(Math.abs(num), 3)
	if (num > 0) return `+${text}`
	if (num < 0) return `-${text}`
	return text
}

function formatMoneyText(value) {
	return formatWithThousands(toNumber(value, 0), 2)
}

function formatPercentText(value) {
	return formatWithThousands(toNumber(value, 0) * 100, 2)
}

function formatRawPercentText(value) {
	const num = toNullableNumber(value)
	if (num == null) return '--'
	return `${formatWithThousands(num, 2)}%`
}

function formatOptionalValueText(value, digits = 2) {
	const num = toNullableNumber(value)
	if (num == null) return '--'
	return formatWithThousands(num, digits)
}

function formatDateTime(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num <= 0) return ''
	const date = new Date(num)
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const h = String(date.getHours()).padStart(2, '0')
	const min = String(date.getMinutes()).padStart(2, '0')
	return `${y}-${m}-${d} ${h}:${min}`
}

function getTodayText() {
	return formatDateInput(new Date())
}

function getInventoryAsOfDate() {
	return normalizeString(filters.dateEnd) || getTodayText()
}

const subtitle = computed(() => {
	if (!pager.total) return `现场库存 · ${flowRangeText.value}`
	return `现场库存 · 当前筛选入库流水 ${pager.total} 条`
})

const flowRangeText = computed(() => {
	const start = normalizeString(filters.dateStart)
	const end = normalizeString(filters.dateEnd)
	if (start && end) return `${start} 至 ${end}`
	if (start) return `${start} 至今`
	if (end) return `截至 ${end}`
	return '全部入库流水'
})

const tankTelemetry = computed(() => summary.inventory.tank || buildEmptyTankTelemetry())
const currentInventory = computed(() => summary.inventory.current || buildEmptyCurrentInventory())
const currentPeriod = computed(() => currentInventory.value.period || buildEmptyCurrentInventory().period)
const currentPhysical = computed(() => {
	const source = currentInventory.value.physical || buildEmptyCurrentInventory().physical
	const sampledAt = Number(source.sampled_at || tankTelemetry.value.sampled_at || tankTelemetry.value.updated_at || 0)
	if (source.status === 'online' && sampledAt > 0 && clockNow.value - sampledAt > 60000) {
		return {
			...source,
			available: false,
			status: 'stale',
			total_t: null,
			message: '储罐数据超过60秒未更新，总库存暂不可用'
		}
	}
	return source
})
const currentLedger = computed(() => {
	const source = currentInventory.value.ledger || buildEmptyCurrentInventory().ledger
	return currentPhysical.value.available ? source : { ...source, diff_t: null }
})
const currentQuality = computed(() => currentInventory.value.quality || buildEmptyCurrentInventory().quality)

const tankLevelPercent = computed(() => {
	const num = Number(tankTelemetry.value.level_percent)
	if (!Number.isFinite(num)) return null
	return Math.min(Math.max(num, 0), 100)
})

const tankLevelFillHeight = computed(() => `${tankLevelPercent.value == null ? 0 : tankLevelPercent.value}%`)
const tankLevelPercentText = computed(() => formatRawPercentText(tankLevelPercent.value))
const tankLevelText = computed(() => formatOptionalValueText(tankTelemetry.value.level_m, 2))
const tankLevelKpaText = computed(() => formatOptionalValueText(tankTelemetry.value.level_kpa, 2))
const tankLevelDisplayText = computed(() => {
	if (toNullableNumber(tankTelemetry.value.level_kpa) != null) return tankLevelKpaText.value
	return tankLevelText.value
})
const tankLevelUnit = computed(() => (toNullableNumber(tankTelemetry.value.level_kpa) != null ? 'kPa' : '米'))
const tankPressureText = computed(() => formatOptionalValueText(tankTelemetry.value.pressure_mpa, 2))

const tankStatusLabel = computed(() => {
	const status = normalizeString(currentPhysical.value.status || tankTelemetry.value.status)
	if (status === 'online') return '在线'
	if (status === 'stale') return '数据延迟'
	if (status === 'error') return '异常'
	return '等待采集'
})

const tankStatusClass = computed(() => `tank-status--${normalizeString(currentPhysical.value.status || tankTelemetry.value.status) || 'empty'}`)

const physicalStatusLabel = computed(() => {
	if (currentPhysical.value.available) return currentPhysical.value.is_fallback ? '备用估算' : '可用'
	if (currentPhysical.value.status === 'stale') return '数据延迟'
	if (currentPhysical.value.status === 'error') return '采集异常'
	return '暂不可用'
})

const tankSampledAtText = computed(() => {
	const text = formatDateTime(tankTelemetry.value.sampled_at || tankTelemetry.value.updated_at)
	return text ? `采集 ${text}` : '暂无采集时间'
})

const tankWeightSourceText = computed(() => {
	if (currentPhysical.value.weight_source === 'plc_weight') return '储罐采用 PLC 直接重量'
	if (currentPhysical.value.weight_source === 'level_estimate') return '储罐采用液位比例备用估算'
	return '当前没有可用的储罐重量来源'
})

const inventoryWarning = computed(() => {
	const messages = []
	if (!currentPhysical.value.available) messages.push(normalizeString(currentPhysical.value.message))
	if (Number(currentQuality.value.unresolved_bottle_count || 0) > 0) messages.push(normalizeString(currentQuality.value.message))
	if (currentPhysical.value.is_fallback) messages.push('当前没有PLC直接重量，满罐吨数仅用于备用估算。')
	return messages.filter(Boolean).join(' ')
})

const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const filterChips = computed(() => {
	const chips = []
	if (filters.keyword) chips.push({ key: 'keyword', label: `关键词: ${filters.keyword}` })
	if (filters.plate_no) chips.push({ key: 'plate_no', label: `车牌: ${filters.plate_no}` })
	if (filters.dateStart) chips.push({ key: 'dateStart', label: `开始: ${filters.dateStart}` })
	if (filters.dateEnd) chips.push({ key: 'dateEnd', label: `结束: ${filters.dateEnd}` })
	return chips
})

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'plate_no') filters.plate_no = ''
	if (key === 'dateStart') filters.dateStart = ''
	if (key === 'dateEnd') filters.dateEnd = ''
	onSearch(true, { force: true })
}

function buildListParams(override = {}) {
	return {
		keyword: normalizeString(filters.keyword),
		plate_no: normalizePlateNo(filters.plate_no),
		dateStart: normalizeString(filters.dateStart),
		dateEnd: normalizeString(filters.dateEnd),
		inventoryAsOf: getInventoryAsOfDate(),
		page: override.page || pager.page,
		pageSize: override.pageSize || pager.pageSize
	}
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listGasInV1(buildListParams())
		if (res?.code !== 0) {
			serviceWarning.value = normalizeString(res?.msg) || '查询失败'
			throw new Error(serviceWarning.value)
		}
		serviceWarning.value = normalizeString(res?.msg)
		return {
			rows: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: Number(res.total || 0),
				hasMore: false
			},
			summary: res.summary || {
				total: Number(res.total || 0),
				load_weight_t_total: 0,
				net_weight_t_total: 0,
				station_weight_t_total: 0,
				direct_sale_weight_t_total: 0,
				loss_amount_t_total: 0,
				avg_price_per_ton: 0,
				loss_rate: 0,
				amount_total: 0,
				inventory: {
					asset_total_t: 0,
					station_total_t: 0,
					in_bottle_total_t: 0,
					vehicle_total_t: 0,
					balance_diff_t: 0,
					as_of_date: getInventoryAsOfDate(),
					scope: 'as_of',
					movement_total: 0,
					tank: buildEmptyTankTelemetry(),
					estimate: buildEmptyTankEstimate(),
					current: buildEmptyCurrentInventory()
				}
			}
		}
	},
	{
		immediate: false,
		cacheTTL: 30000,
		throttleMs: 260,
		cacheKey: () => `gasIn:list:${filters.keyword}:${filters.plate_no}:${filters.dateStart}:${filters.dateEnd}:${getInventoryAsOfDate()}:${pager.page}:${pager.pageSize}`,
		onError(err) {
			serviceWarning.value = normalizeString(err?.message) || '查询失败'
			uni.showToast({ title: serviceWarning.value, icon: 'none' })
		}
	}
)

function applyResult(payload = {}) {
	list.value = Array.isArray(payload.rows) ? payload.rows : []
	const paging = payload.paging || {}
	pager.page = Number(paging.page || 1)
	pager.pageSize = Number(paging.pageSize || 50)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)

	const s = payload.summary || {}
	summary.total = Number(s.total || 0)
	summary.loadWeightTTotal = Number(s.load_weight_t_total || 0)
	summary.netWeightTTotal = Number(s.net_weight_t_total || 0)
	summary.stationWeightTTotal = Number(s.station_weight_t_total || 0)
	summary.directSaleWeightTTotal = Number(s.direct_sale_weight_t_total || 0)
	summary.lossAmountTTotal = Number(s.loss_amount_t_total || 0)
	summary.avgPricePerTon = Number(s.avg_price_per_ton || 0)
	summary.lossRate = Number(s.loss_rate || 0)
	summary.amountTotal = Number(s.amount_total || 0)
	summary.inventory = {
		asset_total_t: Number(s?.inventory?.asset_total_t || 0),
		station_total_t: Number(s?.inventory?.station_total_t || 0),
		in_bottle_total_t: Number(s?.inventory?.in_bottle_total_t || 0),
		vehicle_total_t: Number(s?.inventory?.vehicle_total_t || 0),
		balance_diff_t: Number(s?.inventory?.balance_diff_t || 0),
		as_of_date: normalizeString(s?.inventory?.as_of_date) || getInventoryAsOfDate(),
		scope: normalizeString(s?.inventory?.scope),
		movement_total: Number(s?.inventory?.movement_total || 0),
		tank: {
			...buildEmptyTankTelemetry(),
			...(s?.inventory?.tank && typeof s.inventory.tank === 'object' ? s.inventory.tank : {})
		},
		estimate: {
			...buildEmptyTankEstimate(),
			...(s?.inventory?.estimate && typeof s.inventory.estimate === 'object' ? s.inventory.estimate : {})
		},
		current: {
			...buildEmptyCurrentInventory(),
			...(s?.inventory?.current && typeof s.inventory.current === 'object' ? s.inventory.current : {}),
			period: {
				...buildEmptyCurrentInventory().period,
				...(s?.inventory?.current?.period && typeof s.inventory.current.period === 'object' ? s.inventory.current.period : {})
			},
			physical: {
				...buildEmptyCurrentInventory().physical,
				...(s?.inventory?.current?.physical && typeof s.inventory.current.physical === 'object' ? s.inventory.current.physical : {})
			},
			ledger: {
				...buildEmptyCurrentInventory().ledger,
				...(s?.inventory?.current?.ledger && typeof s.inventory.current.ledger === 'object' ? s.inventory.current.ledger : {})
			},
			quality: {
				...buildEmptyCurrentInventory().quality,
				...(s?.inventory?.current?.quality && typeof s.inventory.current.quality === 'object' ? s.inventory.current.quality : {})
			}
		}
	}
	tankConfigDraft.value = summary.inventory.estimate.full_tank_weight_t
		? String(summary.inventory.estimate.full_tank_weight_t)
		: ''
}

async function refreshCurrentInventory() {
	if (inventoryRefreshRunning) return
	inventoryRefreshRunning = true
	try {
		const res = await getCurrentGasInventoryV1()
		if (res?.code !== 0) return
		const current = res?.data?.current
		const tank = res?.data?.tank
		if (current && typeof current === 'object') {
			summary.inventory.current = {
				...buildEmptyCurrentInventory(),
				...current,
				period: { ...buildEmptyCurrentInventory().period, ...(current.period || {}) },
				physical: { ...buildEmptyCurrentInventory().physical, ...(current.physical || {}) },
				ledger: { ...buildEmptyCurrentInventory().ledger, ...(current.ledger || {}) },
				quality: { ...buildEmptyCurrentInventory().quality, ...(current.quality || {}) }
			}
		}
		if (tank && typeof tank === 'object') {
			summary.inventory.tank = { ...buildEmptyTankTelemetry(), ...tank }
		}
		clockNow.value = Date.now()
	} catch (err) {
		console.warn('[gas-in] refresh current inventory failed', err)
	} finally {
		inventoryRefreshRunning = false
	}
}

async function onSearch(resetPage = false, options = {}) {
	if (resetPage) pager.page = 1
	const result = await fetchList({ force: Boolean(options.force) })
	if (!result) return
	applyResult(result || {})
}

async function loadTankConfig() {
	const res = await getGasTankConfigV1()
	if (res?.code !== 0) return
	const value = Number(res?.data?.full_tank_weight_t || 0)
	tankConfigDraft.value = value > 0 ? String(value) : ''
}

async function onSaveTankConfig() {
	if (savingTankConfig.value) return
	const value = Number(tankConfigDraft.value)
	if (!Number.isFinite(value) || value <= 0) {
		uni.showToast({ title: '请输入大于 0 的满罐吨数', icon: 'none' })
		return
	}
	savingTankConfig.value = true
	try {
		const res = await updateGasTankConfigV1({ full_tank_weight_t: value })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '配置保存失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '配置已保存', icon: 'success' })
		await onSearch(false, { force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '配置保存失败', icon: 'none' })
	} finally {
		savingTankConfig.value = false
	}
}

function onReset() {
	filters.keyword = ''
	filters.plate_no = ''
	const range = buildDatePresetRange('month', new Date())
	filters.dateStart = range.dateStart
	filters.dateEnd = range.dateEnd
	datePreset.value = 'month'
	onSearch(true, { force: true })
}

function onPrevPage() {
	if (loading.value || pager.page <= 1) return
	pager.page -= 1
	onSearch(false, { force: true })
}

function onNextPage() {
	if (loading.value || !pager.hasMore) return
	pager.page += 1
	onSearch(false, { force: true })
}

async function onDateStartChange(e) {
	filters.dateStart = e?.detail?.value || ''
	syncDatePreset()
	await onSearch(true, { force: true })
}

async function onDateEndChange(e) {
	filters.dateEnd = e?.detail?.value || ''
	syncDatePreset()
	await onSearch(true, { force: true })
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
	datePreset.value = detectDatePreset(filters.dateStart, filters.dateEnd, new Date())
}

function onAdd() {
	uni.navigateTo({ url: '/pages/gas-in/edit' })
}

function onEdit(item) {
	const id = normalizeString(item && item._id)
	if (!id) return
	uni.navigateTo({ url: `/pages/gas-in/edit?_id=${encodeURIComponent(id)}` })
}

async function onRemove(item) {
	const id = normalizeString(item && item._id)
	if (!id || removingId.value) return
	const confirm = await new Promise((resolve) => {
		uni.showModal({
			title: '确认删除',
			content: `确认删除 ${normalizeString(item && item.plate_no)} ${normalizeString(item && item.date)} 的入库记录？`,
			success: (res) => resolve(Boolean(res && res.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirm) return

	removingId.value = id
	try {
		const res = await removeGasInV1({ _id: id })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '删除成功', icon: 'success' })
		await onSearch(false, { force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '删除失败', icon: 'none' })
	} finally {
		removingId.value = ''
	}
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

function toCsvCell(value) {
	const text = value == null ? '' : String(value)
	if (!/[",\n\r]/.test(text)) return text
	return `"${text.replace(/"/g, '""')}"`
}

function normalizeFileNamePart(value, fallback = '全部') {
	const text = normalizeString(value)
	if (!text) return fallback
	return text.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '').slice(0, 24) || fallback
}

function formatDateCompact(value) {
	return normalizeString(value).replace(/-/g, '')
}

function buildExportFileName(total) {
	let datePart = '日期-全部'
	if (filters.dateStart && filters.dateEnd) datePart = `日期-${formatDateCompact(filters.dateStart)}_${formatDateCompact(filters.dateEnd)}`
	else if (filters.dateStart) datePart = `日期-${formatDateCompact(filters.dateStart)}_今`
	else if (filters.dateEnd) datePart = `日期-起_${formatDateCompact(filters.dateEnd)}`
	return `天然气入库流水_${datePart}_车牌-${normalizeFileNamePart(filters.plate_no, '全部')}_关键词-${normalizeFileNamePart(filters.keyword, '全部')}_${total}条_${formatExportTimestamp()}.csv`
}

function buildExportCsv(rows = []) {
	const columns = [
		{ label: '日期', get: (row) => normalizeString(row.date) },
		{ label: '车牌号', get: (row) => normalizeString(row.plate_no) },
		{ label: '挂车号', get: (row) => normalizeString(row.tanker_no) },
		{ label: '产品', get: (row) => normalizeString(row.product_name || 'LNG') },
		{ label: '装载重量(吨)', get: (row) => formatTonText(row.load_weight_t) },
		{ label: '出厂毛重(吨)', get: (row) => formatTonText(row.gross_weight_t) },
		{ label: '回厂皮重(吨)', get: (row) => formatTonText(row.tare_weight_t) },
		{ label: '采购净重(吨)', get: (row) => formatTonText(row.net_weight_t) },
		{ label: '站内卸入(吨)', get: (row) => formatTonText(row.station_weight_t == null ? row.net_weight_t : row.station_weight_t) },
		{ label: '直销随车(吨)', get: (row) => formatTonText(row.direct_sale_weight_t) },
		{ label: '损耗(吨)', get: (row) => formatTonText(row.loss_amount_t) },
		{ label: '单价(元/吨)', get: (row) => formatMoneyText(row.unit_price_per_ton) },
		{ label: '金额(元)', get: (row) => formatMoneyText(row.amount) },
		{ label: '送气人', get: (row) => normalizeString(row.sender) },
		{ label: '厂家', get: (row) => normalizeString(row.factory) },
		{ label: '备注', get: (row) => normalizeString(row.remark) }
	]
	const header = columns.map((col) => toCsvCell(col.label)).join(',')
	const body = rows.map((row) => columns.map((col) => toCsvCell(col.get(row))).join(','))
	return [header, ...body].join('\r\n')
}

function compareForExport(a, b) {
	const dayA = normalizeString(a?.date)
	const dayB = normalizeString(b?.date)
	if (dayA !== dayB) return dayA > dayB ? -1 : 1
	const createdA = Number(a?.created_at || 0)
	const createdB = Number(b?.created_at || 0)
	if (createdA !== createdB) return createdB - createdA
	const noA = normalizeString(a?.plate_no)
	const noB = normalizeString(b?.plate_no)
	return noA < noB ? -1 : noA > noB ? 1 : 0
}

async function fetchAllForExport() {
	const allRows = []
	const pageSize = 200
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		guard += 1
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await listGasInV1(buildListParams({ page, pageSize }))
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
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const rows = await fetchAllForExport()
		if (!rows.length) {
			uni.showToast({ title: '没有可导出的数据', icon: 'none' })
			return
		}
		const sortedRows = [...rows].sort(compareForExport)
		const csvText = buildExportCsv(sortedRows)
		const fileName = buildExportFileName(sortedRows.length)
		const downloaded = downloadCsvOnH5(csvText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持下载，请在浏览器端导出', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: `已导出${sortedRows.length}条`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2800 })
	} finally {
		exporting.value = false
		uni.hideLoading()
	}
}

async function onSyncCycle() {
	if (syncing.value || periodActivating.value) return
	syncing.value = true
	try {
		const previewRes = await syncGasCycleAdjustmentsV1({ preview: true })
		if (previewRes?.code !== 0) {
			uni.showToast({ title: previewRes?.msg || '预览失败', icon: 'none' })
			return
		}
		const targetTotal = Number(previewRes?.data?.target_total || 0)
		if (!targetTotal) {
			uni.showToast({ title: '没有可同步的闭环差值', icon: 'none' })
			return
		}
		const confirm = await new Promise((resolve) => {
			uni.showModal({
				title: '闭环同步确认',
				content: `将同步 ${targetTotal} 条闭环差值调整，是否继续？`,
				success: (res) => resolve(Boolean(res && res.confirm)),
				fail: () => resolve(false)
			})
		})
		if (!confirm) return

		const executeRes = await syncGasCycleAdjustmentsV1({ preview: false })
		if (executeRes?.code !== 0) {
			uni.showToast({ title: executeRes?.msg || '同步失败', icon: 'none' })
			return
		}
		const inserted = Number(executeRes?.data?.inserted || 0)
		const updated = Number(executeRes?.data?.updated || 0)
		uni.showToast({ title: `同步完成 新增${inserted} 更新${updated}`, icon: 'none', duration: 2800 })
		onSearch(false, { force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '同步失败', icon: 'none' })
	} finally {
		syncing.value = false
	}
}

async function onManagePeriod() {
	if (periodActivating.value || syncing.value) return
	periodActivating.value = true
	try {
		const params = {
			cutoff_day: '2026-08-12',
			opening_tank_t: 0,
			reason: '储罐持续清零后重新建立现场库存账期'
		}
		const [previewRes, historyRes] = await Promise.all([
			previewGasInventoryPeriodV1(params),
			listGasInventoryPeriodsV1({ page: 1, pageSize: 5 })
		])
		if (previewRes?.code !== 0) {
			uni.showToast({ title: previewRes?.msg || '账期预览失败', icon: 'none' })
			return
		}
		const candidate = previewRes?.data?.candidate || params
		const historyRows = Array.isArray(historyRes?.data) ? historyRes.data : []
		const activeHistory = historyRows.find((row) => row?.status === 'active')
		const content = [
			`切点：${candidate.cutoff_day} 00:00`,
			`储罐期初：${formatTonText(candidate.opening_tank_t)} 吨`,
			activeHistory ? `当前活动账期：${activeHistory.cutoff_day}` : '当前尚未持久化活动账期',
			`已保存历史账期：${Number(historyRes?.total || historyRows.length || 0)} 个`,
			'切点前流水保留查询，不删除、不参与新账期。',
			'重复确认不会创建多个活动账期。'
		].join('\n')
		const confirm = await new Promise((resolve) => {
			uni.showModal({
				title: '启用现场库存账期',
				content,
				confirmText: '确认启用',
				success: (res) => resolve(Boolean(res && res.confirm)),
				fail: () => resolve(false)
			})
		})
		if (!confirm) return
		const executeRes = await activateGasInventoryPeriodV1(params)
		if (executeRes?.code !== 0) {
			uni.showToast({ title: executeRes?.msg || '账期启用失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '账期已启用', icon: 'success' })
		await onSearch(false, { force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '账期操作失败', icon: 'none' })
	} finally {
		periodActivating.value = false
	}
}

function refresh() {
	onSearch(false, { force: true })
}

defineExpose({ refresh })

onMounted(() => {
	syncDatePreset()
	loadTankConfig()
	onSearch(true)
	freshnessTimer = setInterval(() => {
		clockNow.value = Date.now()
	}, 10000)
	inventoryRefreshTimer = setInterval(refreshCurrentInventory, 30000)
})

onBeforeUnmount(() => {
	if (freshnessTimer) clearInterval(freshnessTimer)
	if (inventoryRefreshTimer) clearInterval(inventoryRefreshTimer)
	freshnessTimer = null
	inventoryRefreshTimer = null
})
</script>

<style scoped>
.list-shell {
	display: flex;
	flex-direction: column;
	gap: 20rpx;
}

.quick-date-strip {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	overflow-x: auto;
}

.ops-row {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}

.service-warning {
	padding: 14rpx 16rpx;
	border: 1px solid #fdba74;
	background: #fffbeb;
	color: #9a3412;
	font-size: 24rpx;
	border-radius: 12rpx;
}

.highlight-groups {
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.highlight-group {
	padding: 18rpx;
	border: 1px solid rgba(15, 23, 42, 0.08);
	border-radius: 22rpx;
	background: rgba(255, 255, 255, 0.72);
	box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05);
}

.highlight-group__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16rpx;
	margin-bottom: 14rpx;
}

.highlight-group__title-wrap {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12rpx;
}

.highlight-group__title {
	font-size: 30rpx;
	font-weight: 800;
	color: #0f172a;
}

.highlight-group__hint {
	font-size: 23rpx;
	color: #64748b;
	text-align: right;
}

.summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 14rpx;
}

.summary-card {
	min-height: 176rpx;
}

.tank-panel {
	display: grid;
	grid-template-columns: 420rpx minmax(0, 1fr);
	gap: 16rpx;
	align-items: stretch;
}

.tank-gauge-card {
	display: grid;
	grid-template-columns: 132rpx minmax(0, 1fr);
	align-items: center;
	gap: 18rpx;
	padding: 18rpx;
	border-radius: 16rpx;
	background: #f8fafc;
	border: 1px solid #e2e8f0;
	min-height: 176rpx;
}

.tank-gauge {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6rpx;
}

.tank-gauge__shell {
	position: relative;
	width: 92rpx;
	height: 150rpx;
	overflow: hidden;
	border: 6rpx solid #2563eb;
	border-radius: 46rpx 46rpx 24rpx 24rpx;
	background: #fff;
	box-shadow: inset 0 0 0 1rpx rgba(15, 23, 42, 0.08);
}

.tank-gauge__fill {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	min-height: 4rpx;
	background: linear-gradient(180deg, #38bdf8 0%, #2563eb 100%);
	transition: height var(--crm-duration-normal) var(--crm-easing);
}

.tank-gauge__percent {
	position: absolute;
	left: 0;
	right: 0;
	top: 50%;
	transform: translateY(-50%);
	text-align: center;
	font-size: 22rpx;
	font-weight: 800;
	color: #0f172a;
}

.tank-gauge__legs {
	display: flex;
	gap: 28rpx;
}

.tank-gauge__legs view {
	width: 20rpx;
	height: 12rpx;
	border-radius: 0 0 8rpx 8rpx;
	background: #2563eb;
}

.tank-message {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	min-width: 0;
}

.tank-message__title {
	font-size: 28rpx;
	font-weight: 800;
	color: #0f172a;
	line-height: 1.35;
}

.tank-message__body {
	font-size: 23rpx;
	color: #64748b;
	line-height: 1.5;
}

.tank-status {
	flex-shrink: 0;
	padding: 6rpx 14rpx;
	border-radius: 999rpx;
	font-size: 22rpx;
	font-weight: 700;
	background: #f1f5f9;
	color: #64748b;
}

.tank-status--online {
	background: #dcfce7;
	color: #166534;
}

.tank-status--stale {
	background: #fef3c7;
	color: #92400e;
}

.tank-status--error {
	background: #fee2e2;
	color: #991b1b;
}

.tank-config-row {
	margin-top: 16rpx;
	display: flex;
	align-items: flex-end;
	gap: 12rpx;
}

.tank-config-input {
	width: 320rpx;
	max-width: 100%;
}

.inventory-warning {
	margin-top: 12rpx;
	padding: 16rpx 18rpx;
	border-radius: 14rpx;
	background: #fff7ed;
	border: 1px solid #fdba74;
	color: #9a3412;
	font-size: 24rpx;
	line-height: 1.6;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.picker-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.picker-block {
	display: block;
}

.filter-chips {
	margin-top: 12rpx;
	display: flex;
	flex-wrap: wrap;
	gap: 10rpx;
}

.filter-chip {
	display: inline-flex;
	align-items: center;
	gap: 8rpx;
	padding: 8rpx 14rpx;
	border-radius: 999rpx;
	background: #eef2ff;
	color: #1d4ed8;
}

.filter-chip__label {
	font-size: 22rpx;
}

.filter-chip__close {
	font-size: 22rpx;
	font-weight: 700;
}

.section-hint {
	font-size: 22rpx;
	color: #64748b;
}

.weight-box {
	display: flex;
	align-items: baseline;
	gap: 6rpx;
}

.weight-value {
	font-size: 30rpx;
	font-weight: 700;
	color: #0f172a;
}

.weight-unit {
	font-size: 22rpx;
	color: #64748b;
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10rpx;
}

.meta-text {
	font-size: 24rpx;
	color: #64748b;
}

.pager-row {
	margin-top: 16rpx;
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
}

@media (min-width: 1280px) {
	.summary-row {
		grid-template-columns: repeat(6, minmax(0, 1fr));
	}

	.summary-row--inventory,
	.summary-row--flow,
	.summary-row--tank {
		grid-template-columns: repeat(5, minmax(0, 1fr));
	}
}

@media (max-width: 960px) {
	.summary-row,
	.filter-grid {
		grid-template-columns: 1fr;
	}

	.tank-panel {
		grid-template-columns: 1fr;
	}

	.tank-config-row {
		align-items: stretch;
		flex-direction: column;
	}

	.tank-config-input {
		width: 100%;
	}

	.highlight-group__head {
		align-items: flex-start;
		flex-direction: column;
	}

	.highlight-group__hint {
		text-align: left;
	}
}
</style>
