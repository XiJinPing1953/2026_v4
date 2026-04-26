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
						<text class="highlight-group__title">库存快照</text>
						<text class="highlight-group__hint">截至 {{ inventoryAsOfText }} 的系统流水回算库存</text>
					</view>
					<view class="summary-row summary-row--inventory">
						<AppStatCard class="summary-card" label="总库存净值" :value="formatTonText(summary.inventory.asset_total_t)" hint="吨" icon="bottle" />
						<AppStatCard class="summary-card" label="站内可灌装" :value="formatTonText(summary.inventory.station_total_t)" hint="吨" icon="check-circle" />
						<AppStatCard class="summary-card" label="在瓶未售" :value="formatTonText(summary.inventory.in_bottle_total_t)" hint="吨" icon="list" />
						<AppStatCard class="summary-card" label="在车待售" :value="formatTonText(summary.inventory.vehicle_total_t)" hint="吨" icon="truck" />
						<AppStatCard class="summary-card" label="未归类差额" :value="formatTonText(summary.inventory.balance_diff_t)" hint="吨" icon="alert" />
					</view>
				</view>
				<view class="highlight-group">
					<view class="highlight-group__head">
						<text class="highlight-group__title">入库来源</text>
						<text class="highlight-group__hint">当前筛选范围：{{ flowRangeText }}</text>
					</view>
					<view class="summary-row summary-row--flow">
						<AppStatCard class="summary-card" label="入库车次" :value="summary.total" hint="条" icon="list" />
						<AppStatCard class="summary-card" label="入库净重" :value="formatTonText(summary.netWeightTTotal)" hint="吨" icon="chart" />
						<AppStatCard class="summary-card" label="入库金额" :value="formatMoneyText(summary.amountTotal)" hint="元" icon="wallet" />
						<AppStatCard class="summary-card" label="采购均价" :value="formatMoneyText(summary.avgPricePerTon)" hint="元/吨" icon="chart" />
						<AppStatCard class="summary-card" label="损耗率" :value="formatPercentText(summary.lossRate)" hint="%" icon="alert" />
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
				<AppButton v-if="canMaintainGasInventory" size="sm" kind="neutral" :loading="syncing" :disabled="loading || rebuilding" @click="onSyncCycle">闭环同步</AppButton>
				<AppButton v-if="canMaintainGasInventory" size="sm" kind="neutral" :loading="rebuilding" :disabled="loading || syncing" @click="onRebuildInventory">库存重建</AppButton>
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
import { computed, onMounted, reactive, ref } from 'vue'
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
	listGasInV1,
	removeGasInV1,
	rebuildGasInventoryV1,
	syncGasCycleAdjustmentsV1
} from '@/services/gasIn'

const list = ref([])
const removingId = ref('')
const exporting = ref(false)
const syncing = ref(false)
const rebuilding = ref(false)
const serviceWarning = ref('')

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

const summary = reactive({
	total: 0,
	loadWeightTTotal: 0,
	netWeightTTotal: 0,
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
		movement_total: 0
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

function formatMoneyText(value) {
	return formatWithThousands(toNumber(value, 0), 2)
}

function formatPercentText(value) {
	return formatWithThousands(toNumber(value, 0) * 100, 2)
}

function getTodayText() {
	return formatDateInput(new Date())
}

function getInventoryAsOfDate() {
	return normalizeString(filters.dateEnd) || getTodayText()
}

const subtitle = computed(() => {
	const asOf = summary.inventory.as_of_date || getInventoryAsOfDate()
	if (!pager.total) return `库存快照截至 ${asOf} · 本月入库来源`
	return `库存快照截至 ${asOf} · 当前入库流水 ${pager.total} 条`
})

const inventoryAsOfText = computed(() => summary.inventory.as_of_date || getInventoryAsOfDate())

const flowRangeText = computed(() => {
	const start = normalizeString(filters.dateStart)
	const end = normalizeString(filters.dateEnd)
	if (start && end) return `${start} 至 ${end}`
	if (start) return `${start} 至今`
	if (end) return `截至 ${end}`
	return '全部入库流水'
})

const inventoryWarning = computed(() => {
	const asset = Number(summary.inventory.asset_total_t || 0)
	const station = Number(summary.inventory.station_total_t || 0)
	const inBottle = Number(summary.inventory.in_bottle_total_t || 0)
	const vehicle = Number(summary.inventory.vehicle_total_t || 0)
	const residual = Number(summary.inventory.balance_diff_t || 0)
	if (asset >= 0 && station >= 0 && inBottle >= 0 && vehicle >= 0 && Math.abs(residual) < 0.001) return ''
	let text = `库存快照按截至 ${inventoryAsOfText.value} 的系统天然气流水净值回算。若系统启用前已有期初库存，或历史入库未补齐，会出现负数；建议补齐期初/历史入库后再执行库存重建。`
	if (Math.abs(residual) >= 0.001) {
		text += ` 当前仍有 ${formatTonText(residual)} 吨未归类差额，多来自历史整车/TRUCK 链路或旧流水残差。`
	}
	return text
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
					movement_total: 0
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
		movement_total: Number(s?.inventory?.movement_total || 0)
	}
}

async function onSearch(resetPage = false, options = {}) {
	if (resetPage) pager.page = 1
	const result = await fetchList({ force: Boolean(options.force) })
	if (!result) return
	applyResult(result || {})
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
		{ label: '净重(吨)', get: (row) => formatTonText(row.net_weight_t) },
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
	if (syncing.value || rebuilding.value) return
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

async function onRebuildInventory() {
	if (rebuilding.value || syncing.value) return
	rebuilding.value = true
	try {
		const previewRes = await rebuildGasInventoryV1({
			preview: true,
			include_cycle_adjust: false
		})
		if (previewRes?.code !== 0) {
			uni.showToast({ title: previewRes?.msg || '重建预览失败', icon: 'none' })
			return
		}
		const movementTotal = Number(previewRes?.data?.stats?.movement_total || 0)
		const confirm = await new Promise((resolve) => {
			uni.showModal({
				title: '库存重建确认',
				content: `将重建 ${movementTotal} 条库存流水。当前默认不自动备份旧流水，是否继续？`,
				success: (res) => resolve(Boolean(res && res.confirm)),
				fail: () => resolve(false)
			})
		})
		if (!confirm) return

		const executeRes = await rebuildGasInventoryV1({
			preview: false,
			include_cycle_adjust: false,
			backup_before_rebuild: false
		})
		if (executeRes?.code !== 0) {
			uni.showToast({ title: executeRes?.msg || '重建失败', icon: 'none' })
			return
		}
		const runId = normalizeString(executeRes?.data?.run_id)
		uni.showToast({ title: runId ? `重建完成 run_id:${runId}` : '重建完成', icon: 'none', duration: 3600 })
		onSearch(false, { force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '重建失败', icon: 'none' })
	} finally {
		rebuilding.value = false
	}
}

function refresh() {
	onSearch(false, { force: true })
}

defineExpose({ refresh })

onMounted(() => {
	syncDatePreset()
	onSearch(true)
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
	.summary-row--flow {
		grid-template-columns: repeat(5, minmax(0, 1fr));
	}
}

@media (max-width: 960px) {
	.summary-row,
	.filter-grid {
		grid-template-columns: 1fr;
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
