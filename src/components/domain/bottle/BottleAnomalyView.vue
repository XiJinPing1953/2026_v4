<template>
	<AppPage title="流转异常" subtitle="扫描并处理瓶子流转异常" icon="alert">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="待处理"
					:value="summary.open"
					hint="条"
					icon="alert"
					@click="onSummaryFilter('open')"
				/>
				<AppStatCard
					class="summary-card"
					label="已修复"
					:value="summary.resolved"
					hint="条"
					icon="check-circle"
					@click="onSummaryFilter('resolved')"
				/>
				<AppStatCard
					class="summary-card"
					label="全部异常"
					:value="summary.total"
					hint="条"
					icon="list"
					@click="onSummaryFilter('all')"
				/>
			</view>
		</template>

		<view class="view-body">
			<AppSection title="扫描检测">
				<view class="scan-card">
					<AppInput v-model="scanBottleNo" placeholder="输入或扫描瓶号" prefix-icon="search" size="sm" class="scan-input" />
					<view class="scan-actions">
						<AppButton size="sm" :loading="scanning" @click="onScan">开始扫描</AppButton>
						<AppButton v-if="isSuperAdmin" size="sm" kind="outline" :loading="rebuilding" @click="onRebuild">
							全量扫描异常
						</AppButton>
					</view>
				</view>
			</AppSection>

			<AppSection title="异常筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>
				<view class="filter-grid">
					<AppInput v-model="filters.bottleNo" label="瓶号/车牌" placeholder="搜索瓶号或车牌" size="sm" />
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
						<AppInput :model-value="statusLabel" label="状态" disabled size="sm" />
					</picker>
					<picker class="picker-block" mode="selector" :range="typeOptions" range-key="label" @change="onTypeChange">
						<AppInput :model-value="typeLabel" label="异常类型" disabled size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="(e) => (filters.dateStart = e.detail.value)">
						<AppInput :model-value="filters.dateStart" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="(e) => (filters.dateEnd = e.detail.value)">
						<AppInput :model-value="filters.dateEnd" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
				</view>
			</AppSection>

			<AppSection title="排查视图">
				<template #actions>
					<text class="section-hint">
						基于当前筛选统计 {{ breakdown.scannedTotal }} 条
						<text v-if="breakdown.limited">（仅统计前 5000 条）</text>
					</text>
				</template>
				<view class="inspect-card">
					<text class="inspect-title">按异常类型</text>
					<AppList :loading="loading" :empty="breakdown.byType.length === 0" empty-title="暂无类型统计">
						<AppListItem
							v-for="item in breakdown.byType"
							:key="item.anomaly_type"
							:title="anomalyTypeText(item.anomaly_type)"
							:subtitle="`待处理 ${item.open} · 已修复 ${item.resolved}`"
							:status="`${item.total} 条`"
							:status-kind="item.open > 0 ? 'danger' : 'success'"
							icon="list"
							:icon-class="item.open > 0 ? 'bg-danger' : 'bg-success'"
						>
							<template #footer>
								<AppButton size="sm" kind="ghost" @click="onQuickType(item.anomaly_type)">只看此类型</AppButton>
							</template>
						</AppListItem>
					</AppList>
				</view>
			</AppSection>

			<AppSection title="异常列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>
				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无异常记录">
					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="`${item.bottle_no || '-'} · ${anomalyTypeText(item.anomaly_type)}`"
						:subtitle="`${anomalyDateText(item)} • ${item.note || '无备注'}`"
						:status="item.status === 'resolved' ? '已修复' : '待处理'"
						:status-kind="item.status === 'resolved' ? 'success' : 'danger'"
						icon="alert"
						:icon-class="item.status === 'resolved' ? 'bg-success' : 'bg-danger'"
					>
						<template v-if="buildAnomalyActionHint(item)" #meta>
							<text class="meta-text">{{ buildAnomalyActionHint(item) }}</text>
						</template>
						<template #footer>
							<template v-if="item.status === 'open' && item.anomaly_type === 'missing_fill'">
									<AppButton
										v-if="canUpdateAnomaly"
										size="sm"
										:kind="buildMissingFillLossButtonKind(item)"
										:disabled="!canResolveMissingFillByLoss(item)"
										:loading="resolvingId === item._id && (resolvingMode === 'loss_accept' || resolvingMode === 'swell_accept')"
										@click="onResolveMissingFillLoss(item)"
									>
										{{ buildMissingFillPrimaryActionText(item) }}
									</AppButton>
								<AppButton
									v-if="canUpdateAnomaly"
									size="sm"
									:kind="buildMissingFillBackfillButtonKind(item)"
									:disabled="!canResolveMissingFillByBackfill(item)"
									@click="onBackfillMissingFill(item)"
								>
									补灌装单
								</AppButton>
							</template>
							<template v-else-if="item.status === 'open' && item.anomaly_type === 'continuous_fill'">
								<AppButton
									v-if="canUpdateAnomaly"
									size="sm"
									:kind="canRemoveContinuousFill(item) ? 'primary' : 'neutral'"
									:disabled="!canRemoveContinuousFill(item)"
									:loading="resolvingId === item._id && resolvingMode === 'remove_fill'"
									@click="onRemoveContinuousFill(item)"
								>
									删除后灌装
								</AppButton>
							</template>
							<AppButton v-else-if="item.status === 'open' && isSourceCorrectionOnlyAnomaly(item)" size="sm" kind="neutral" disabled>
								回原单修正
							</AppButton>
							<AppButton
								v-else-if="item.status === 'open' && canUpdateAnomaly"
								size="sm"
								:loading="resolvingId === item._id && resolvingMode === 'default'"
								@click="onResolve(item)"
							>
								修复
							</AppButton>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">
						上一页
					</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="onNextPage">
						下一页
					</AppButton>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { useAuthGuard } from '@/composables/useAuthGuard'
import {
	listBottleAnomaliesV1,
	getBottleAnomalyTypesV1,
	scanBottleAnomaliesSafeV2,
	rebuildBottleAnomaliesSafeV2,
	resolveBottleAnomalyV1
} from '@/services/bottleAnomaly'
import { removeFillingV1 } from '@/services/filling'
import { getUser } from '@/services/auth'

const scanBottleNo = ref('')
const scanning = ref(false)
const rebuilding = ref(false)
const resolvingId = ref('')
const resolvingMode = ref('')
const MISSING_FILL_THRESHOLD_KG = 10
const list = ref([])
const summary = ref({ total: 0, open: 0, resolved: 0 })
const breakdown = ref({
	scannedTotal: 0,
	limited: false,
	byType: []
})
const currentUser = ref(getUser() || null)
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const statusOptions = [
	{ label: '全部', value: '' },
	{ label: '待处理', value: 'open' },
	{ label: '已修复', value: 'resolved' }
]
const typeOptions = ref([{ label: '全部', value: '' }])
const statusIndex = ref(1)
const typeIndex = ref(0)
const statusLabel = computed(() => statusOptions[statusIndex.value]?.label || '全部')
const typeLabel = computed(() => typeOptions.value[typeIndex.value]?.label || '全部')
const ANOMALY_TYPE_LABEL_MAP = {
	missing_back: '缺回瓶',
	missing_fill: '缺灌装',
	missing_out: '缺出瓶',
	continuous_fill: '连续灌装',
	continuous_out: '连续出瓶',
	continuous_back: '连续回瓶',
	missing_truck_fill: '缺整车补给',
	truck_return_diff_excess: '整车回站差异过大',
	missing_truck_back_gross: '缺回站总重'
}
const SOURCE_CORRECTION_ONLY_ANOMALY_SET = new Set([
	'missing_back',
	'missing_out',
	'continuous_fill',
	'continuous_out',
	'continuous_back',
	'missing_truck_fill',
	'truck_return_diff_excess',
	'missing_truck_back_gross'
])

const filters = reactive({
	bottleNo: '',
	status: 'open',
	anomalyType: '',
	dateStart: '',
	dateEnd: ''
})
const BACKFILL_REFRESH_RECONCILE_TYPES = ['missing_back', 'missing_fill', 'missing_out', 'continuous_fill', 'continuous_out', 'continuous_back']
const { canPageAction } = useAuthGuard()
const canUpdateAnomaly = computed(() => canPageAction('/pages/bottle/anomaly', 'update'))
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const isSuperAdmin = computed(() => normalizeRole(currentUser.value?.role) === 'superadmin')

function normalizeRole(value) {
	if (value == null) return ''
	return String(value).trim().toLowerCase()
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function toNumber(value, fallback = null) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function roundTo(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	const factor = 10 ** digits
	return Math.round(num * factor) / factor
}

function formatWeightValue(value, maxFractionDigits = 1) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '-'
	return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits })
}

function formatSignedWeight(value, maxFractionDigits = 1) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '-'
	const prefix = num > 0 ? '+' : ''
	return `${prefix}${formatWeightValue(num, maxFractionDigits)}`
}

function buildMissingFillDecision(item) {
	const context = item && typeof item.context === 'object' ? item.context : {}
	const lastBack = context && typeof context.last_back === 'object' ? context.last_back : {}
	const nextOut = context && typeof context.next_out === 'object' ? context.next_out : {}
	const lastBackNet = toNumber(lastBack.net, null)
	const nextOutNet = toNumber(nextOut.net, null)
	if (lastBackNet == null || nextOutNet == null) {
		return {
			code: 'missing_weight',
			diff: null,
			diffAbs: null,
			lossEnabled: false,
			backfillEnabled: false,
			hint: '缺少回瓶净重或出瓶净重，无法自动判断，请先人工核查。'
		}
	}
	const diff = roundTo(nextOutNet - lastBackNet, 3)
	const diffAbs = roundTo(Math.abs(diff), 3)
	if (diff > MISSING_FILL_THRESHOLD_KG) {
		return {
			code: 'backfill',
			diff,
			diffAbs,
			lossEnabled: false,
			backfillEnabled: true,
			hint: `净重差值 ${formatSignedWeight(diff)}kg（增重），超过 ${MISSING_FILL_THRESHOLD_KG}kg，建议补灌装单。`
		}
	}
	if (diff < -MISSING_FILL_THRESHOLD_KG) {
		return {
			code: 'manual_review',
			diff,
			diffAbs,
			lossEnabled: false,
			backfillEnabled: false,
			hint: `净重差值 ${formatSignedWeight(diff)}kg，减重超过 ${MISSING_FILL_THRESHOLD_KG}kg，请先人工核查。`
		}
	}
	if (diff > 0) {
		return {
			code: 'swell_accept',
			diff,
			diffAbs,
			lossEnabled: true,
			backfillEnabled: false,
			hint: `净重差值 ${formatSignedWeight(diff)}kg（增重），在 ${MISSING_FILL_THRESHOLD_KG}kg 内，建议记胀重修复。`
		}
	}
	if (diff < 0) {
		return {
			code: 'loss_accept',
			diff,
			diffAbs,
			lossEnabled: true,
			backfillEnabled: false,
			hint: `净重差值 ${formatSignedWeight(diff)}kg，建议记损耗修复。`
		}
	}
	return {
		code: 'loss_accept',
		diff,
		diffAbs,
		lossEnabled: true,
		backfillEnabled: false,
		hint: '净重无差异，可直接按差异修复并关闭异常。'
	}
}

function canResolveMissingFillByLoss(item) {
	return buildMissingFillDecision(item).lossEnabled
}

function canResolveMissingFillByBackfill(item) {
	return buildMissingFillDecision(item).backfillEnabled
}

function buildMissingFillActionHint(item) {
	return buildMissingFillDecision(item).hint
}

function buildSourceCorrectionOnlyHint(item) {
	if (!isSourceCorrectionOnlyAnomaly(item) || item?.status !== 'open') return ''
	const anomalyType = normalizeString(item?.anomaly_type).toLowerCase()
	if (anomalyType === 'truck_return_diff_excess') {
		return '这类异常需要回原整车销售单核对出站总重、回站总重和毛重差值。正差更像额外损耗，负差更像车上仍有余量或重量口径不一致，不支持直接标记修复。'
	}
	if (['missing_truck_fill', 'missing_truck_back_gross'].includes(anomalyType)) {
		return '这类异常通常来自整车销售单补给或回站重量录入错误，请回原整车销售单修正，不支持直接标记修复。'
	}
	return '这类异常通常来自销售单瓶号录入错误，请回原销售单修正，不支持直接标记修复。'
}

function buildMissingFillLossButtonKind(item) {
	return canResolveMissingFillByLoss(item) ? 'primary' : 'neutral'
}

function buildMissingFillBackfillButtonKind(item) {
	return canResolveMissingFillByBackfill(item) ? 'primary' : 'neutral'
}

function buildMissingFillPrimaryActionText(item) {
	const decision = buildMissingFillDecision(item)
	if (decision.code === 'swell_accept') return '记胀重'
	if (decision.diff === 0) return '按差值修复'
	return '记损耗'
}

function getContinuousFillDeleteTarget(item) {
	const context = item && typeof item.context === 'object' ? item.context : {}
	const nextFill = context && typeof context.next_fill === 'object' ? context.next_fill : {}
	return {
		recordId: normalizeString(nextFill.source_id),
		date: normalizeString(nextFill.date),
		sourceType: normalizeString(nextFill.source_type).toLowerCase(),
		net: toNumber(nextFill.net, null)
	}
}

function canRemoveContinuousFill(item) {
	const target = getContinuousFillDeleteTarget(item)
	return Boolean(target.recordId)
}

function buildContinuousFillDeleteHint(item) {
	const target = getContinuousFillDeleteTarget(item)
	if (!target.recordId) return '未定位到后一次灌装记录，请回原灌装单修正。'
	const fillDateText = target.date || '该次'
	const fillNetText = target.net != null ? `（净重 ${formatWeightValue(target.net)} kg）` : ''
	return `建议删除 ${fillDateText} 的后一次灌装${fillNetText}，删除后将同步更新异常状态。`
}

function buildMissingFillResolveMode(item) {
	const decision = buildMissingFillDecision(item)
	if (decision.code === 'swell_accept') return 'swell_accept'
	return 'loss_accept'
}

function isSourceCorrectionOnlyAnomaly(item) {
	const type = normalizeString(item?.anomaly_type).toLowerCase()
	return SOURCE_CORRECTION_ONLY_ANOMALY_SET.has(type)
}

function buildAnomalyActionHint(item) {
	if (item?.anomaly_type === 'missing_fill') return buildMissingFillActionHint(item)
	if (item?.anomaly_type === 'continuous_fill') return buildContinuousFillDeleteHint(item)
	return buildSourceCorrectionOnlyHint(item)
}

function buildLocalAnomalyIdentity(item) {
	const type = normalizeString(item?.anomaly_type).toLowerCase()
	const bottleNo = normalizeBottleNo(item?.bottle_no)
	const fingerprint = normalizeString(item?.fingerprint)
	if (fingerprint) return `fp:${type}|${bottleNo}|${fingerprint}`
	return `fallback:${type}|${bottleNo}|${normalizeString(item?.date)}|${normalizeString(item?.note)}`
}

function patchBreakdownCounts(item, removedCount) {
	const count = Math.max(Number(removedCount || 0), 0)
	if (!count) return
	const type = normalizeString(item?.anomaly_type).toLowerCase()
	breakdown.value = {
		...breakdown.value,
		scannedTotal: Math.max(0, Number(breakdown.value.scannedTotal || 0) - count),
		byType: (breakdown.value.byType || []).map((row) => {
			if (normalizeString(row?.anomaly_type).toLowerCase() !== type) return row
			return {
				...row,
				total: Math.max(0, Number(row?.total || 0) - count),
				open: Math.max(0, Number(row?.open || 0) - count),
				resolved: Number(row?.resolved || 0) + count
			}
		})
	}
}

function removeResolvedAnomalyLocally(item, resolvedCount = 1) {
	if (filters.status !== 'open') return 0
	const identity = buildLocalAnomalyIdentity(item)
	let removed = 0
	list.value = (list.value || []).filter((row) => {
		const same = buildLocalAnomalyIdentity(row) === identity
		if (same) removed += 1
		return !same
	})
	const finalRemoved = Math.max(removed, Math.min(Math.max(Number(resolvedCount || 0), 0), 20))
	if (!finalRemoved) return 0
	pager.total = Math.max(0, Number(pager.total || 0) - finalRemoved)
	pager.hasMore = Number(list.value.length || 0) < Number(pager.total || 0)
	summary.value = {
		...summary.value,
		open: Math.max(0, Number(summary.value.open || 0) - finalRemoved),
		resolved: Number(summary.value.resolved || 0) + finalRemoved
	}
	patchBreakdownCounts(item, finalRemoved)
	return finalRemoved
}

function scheduleSearchSync(delay = 180) {
	setTimeout(() => {
		onSearch(false)
	}, delay)
}

function normalizeRouteNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	if (Number.isInteger(num)) return String(num)
	return String(num).replace(/\.?0+$/, '')
}

function normalizeScrollTop(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num < 0) return 0
	return Math.round(num)
}

function getViewportScrollTop() {
	return new Promise((resolve) => {
		try {
			const query = uni.createSelectorQuery()
			query.selectViewport().scrollOffset((res) => {
				resolve(normalizeScrollTop(res?.scrollTop))
			}).exec()
		} catch (err) {
			resolve(0)
		}
	})
}

function buildMissingFillBackfillRemark(item, diff) {
	const anomalyId = normalizeString(item?._id) || '-'
	const context = item && typeof item.context === 'object' ? item.context : {}
	const nextOut = context && typeof context.next_out === 'object' ? context.next_out : {}
	const outDate = normalizeString(nextOut.date || item?.date) || '-'
	return `[missing-fill-backfill] anomaly=${anomalyId} out=${outDate} diff=${normalizeRouteNumber(diff)}`
}

function getMissingFillBackfillDate(item) {
	const context = item && typeof item.context === 'object' ? item.context : {}
	const lastBack = context && typeof context.last_back === 'object' ? context.last_back : {}
	const nextOut = context && typeof context.next_out === 'object' ? context.next_out : {}
	return normalizeString(lastBack.date || nextOut.date || item?.date)
}

function buildMissingFillBackfillUrl(item, { returnScrollTop = 0 } = {}) {
	const decision = buildMissingFillDecision(item)
	if (!decision.backfillEnabled) return ''
	const params = [
		['sourceAnomalyId', normalizeString(item?._id)],
		['returnToAnomaly', '1'],
		['returnScrollTop', normalizeRouteNumber(normalizeScrollTop(returnScrollTop))],
		['bottleNo', normalizeBottleNo(item?.bottle_no)],
		['date', getMissingFillBackfillDate(item)],
		['inputMode', 'net'],
		['recordType', 'normal_fill'],
		['fillWeight', normalizeRouteNumber(decision.diff)],
		['remark', buildMissingFillBackfillRemark(item, decision.diff)]
	]
		.filter(([, value]) => Boolean(normalizeString(value)))
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join('&')
	return params ? `/pages/filling/list?${params}` : '/pages/filling/list'
}

async function restoreViewportScrollTop(scrollTop) {
	const target = normalizeScrollTop(scrollTop)
	await nextTick()
	setTimeout(() => {
		uni.pageScrollTo({
			scrollTop: target,
			duration: 0
		})
	}, 40)
}

const { loading, run: fetchList } = useQuery(
	async () => {
			const res = await listBottleAnomaliesV1({
				bottleNo: filters.bottleNo,
				status: filters.status,
				anomalyType: filters.anomalyType,
				dateStart: filters.dateStart,
				dateEnd: filters.dateEnd,
				page: pager.page,
				pageSize: pager.pageSize,
				withBreakdown: true,
				summaryIgnoreStatus: true
			})
			if (res?.code !== 0) {
				uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
				return {
					items: [],
					paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
					summary: { total: 0, open: 0, resolved: 0 },
					breakdown: { scannedTotal: 0, limited: false, byType: [] }
				}
			}
			const serverBreakdown = res.breakdown || {}
			return {
				items: Array.isArray(res.data) ? res.data : [],
				paging: res.paging || {
					page: pager.page,
					pageSize: pager.pageSize,
					total: Number(res.total || 0),
					hasMore: false
				},
				summary: res.summary || { total: 0, open: 0, resolved: 0 },
				breakdown: {
					scannedTotal: Number(serverBreakdown.scanned_total || 0),
					limited: Boolean(serverBreakdown.limited),
					byType: Array.isArray(serverBreakdown.by_type) ? serverBreakdown.by_type : []
				}
			}
		},
		{
			immediate: false,
			initialData: {
				items: [],
				paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
				summary: { total: 0, open: 0, resolved: 0 },
				breakdown: { scannedTotal: 0, limited: false, byType: [] }
			}
		}
	)

function applyResult(payload) {
	const data = payload || {}
	list.value = Array.isArray(data.items) ? data.items : []
	const paging = data.paging || {}
	pager.page = Number(paging.page || pager.page || 1)
	pager.pageSize = Number(paging.pageSize || pager.pageSize || 50)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)
	const summaryData = data.summary || {}
	summary.value = {
		total: Number(summaryData.total || 0),
		open: Number(summaryData.open || 0),
		resolved: Number(summaryData.resolved || 0)
	}
	const breakdownData = data.breakdown || {}
	breakdown.value = {
		scannedTotal: Number(breakdownData.scannedTotal || 0),
		limited: Boolean(breakdownData.limited),
		byType: Array.isArray(breakdownData.byType) ? breakdownData.byType : []
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.bottleNo = ''
	statusIndex.value = 1
	filters.status = 'open'
	typeIndex.value = 0
	filters.anomalyType = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	onSearch(true)
}

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	statusIndex.value = Number.isFinite(idx) ? idx : 0
	filters.status = statusOptions[statusIndex.value]?.value || ''
	onSearch(true)
}

function onTypeChange(e) {
	const idx = Number(e?.detail?.value)
	typeIndex.value = Number.isFinite(idx) ? idx : 0
	filters.anomalyType = typeOptions.value[typeIndex.value]?.value || ''
	onSearch(true)
}

function onQuickType(type) {
	const targetType = String(type || '').trim().toLowerCase()
	const idx = typeOptions.value.findIndex((item) => item.value === targetType)
	typeIndex.value = idx >= 0 ? idx : 0
	filters.anomalyType = targetType
	onSearch(true)
}

function onQuickBottle(bottleNo) {
	const targetBottleNo = String(bottleNo || '').trim().toUpperCase()
	if (!targetBottleNo || targetBottleNo === '-') return
	filters.bottleNo = targetBottleNo
	onSearch(true)
}

function onSummaryFilter(type) {
	if (type === 'open') {
		statusIndex.value = 1
		filters.status = 'open'
	} else if (type === 'resolved') {
		statusIndex.value = 2
		filters.status = 'resolved'
	} else {
		statusIndex.value = 0
		filters.status = ''
	}
	onSearch(true)
}

function anomalyTypeText(type) {
	const key = String(type || '').trim().toLowerCase()
	const found = typeOptions.value.find((item) => item.value === key)
	return found?.label || ANOMALY_TYPE_LABEL_MAP[key] || key || '未知异常'
}

function anomalyDateText(item) {
	const text = String(item?.date || '').trim()
	if (text) return text
	const createdAt = Number(item?.created_at || 0)
	if (!Number.isFinite(createdAt) || createdAt <= 0) return '-'
	const d = new Date(createdAt)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

async function loadAnomalyTypes() {
	const res = await getBottleAnomalyTypesV1()
	const rows = Array.isArray(res?.data) ? res.data : []
	const merged = new Map()
	Object.entries(ANOMALY_TYPE_LABEL_MAP).forEach(([value, label]) => {
		merged.set(value, { label, value })
	})
	rows
		.map((item) => ({
			label: String(item?.name || '').trim(),
			value: String(item?.code || '').trim().toLowerCase()
		}))
		.filter((item) => item.label && item.value)
		.forEach((item) => {
			merged.set(item.value, item)
		})
	typeOptions.value = [{ label: '全部', value: '' }, ...Array.from(merged.values())]
}

async function onScan() {
	if (scanning.value) return
	scanning.value = true
	try {
		const bottleNo = String(scanBottleNo.value || '').trim()
		if (!bottleNo) {
			uni.showToast({ title: '请输入瓶号', icon: 'none' })
			return
		}
		const res = await scanBottleAnomaliesSafeV2({
			bottleNo,
			reconcileAnomalies: true,
			reconcileTypes: ['missing_back', 'missing_fill', 'missing_out', 'continuous_fill', 'continuous_out', 'continuous_back'],
			maxRounds: 12
		})
		if (res?.code === 0) {
			const created = Number(res.data?.created || 0)
			const resolvedStale = Number(res.data?.resolved_stale || 0)
			const done = Boolean(res.data?.done)
			const rounds = Number(res.data?.rounds || 0)
			uni.showToast({
				title: done
					? `扫描完成，新增 ${created} 条，自动关闭 ${resolvedStale} 条`
					: `已扫描 ${rounds} 轮，新增 ${created} 条，自动关闭 ${resolvedStale} 条`,
				icon: 'none'
			})
			onSearch(true)
		} else {
			uni.showToast({ title: res?.msg || '扫描失败', icon: 'none' })
		}
	} finally {
		scanning.value = false
	}
}

async function onRebuild() {
	if (!isSuperAdmin.value || rebuilding.value) return
	const confirmRes = await uni.showModal({
		title: '全量扫描异常',
		content: '将按多轮安全方式持续扫描直到完成，并自动在多轮之间续扫。是否立即开始？',
		showCancel: true
	})
	if (!confirmRes.confirm) return

	rebuilding.value = true
	try {
		const res = await rebuildBottleAnomaliesSafeV2({
			maxRounds: 240,
			maxStallRounds: 3,
			batchBottlesPerRound: 18,
			maxMsPerRound: 2200,
			maxEventsPerRound: 700,
			maxWritesPerRound: 160,
			batchSize: 160
		})
		if (res?.code === 0) {
			const rounds = Number(res.data?.rounds || 0)
			const bottles = Number(res.data?.bottles || 0)
			const trucks = Number(res.data?.trucks || 0)
			const created = Number(res.data?.created || 0)
			const resolvedStale = Number(res.data?.resolved_stale || 0)
			const done = Boolean(res.data?.done)
			const limitReached = Boolean(res.data?.limit_reached)
			const scopeText = `瓶${bottles} / 车${trucks}`
			uni.showToast({
				title: done
					? `全量扫描完成：${scopeText}，新增${created}，自动关闭${resolvedStale}`
					: limitReached
						? `已扫描${rounds}轮/${scopeText}，仍未完成`
						: `已扫描${rounds}轮/${scopeText}，新增${created}，自动关闭${resolvedStale}`,
				icon: 'none'
			})
			onSearch(true)
		} else {
			uni.showToast({ title: res?.msg || '全量扫描失败', icon: 'none' })
		}
	} finally {
		rebuilding.value = false
	}
}

async function onResolve(item) {
	if (isSourceCorrectionOnlyAnomaly(item)) {
		uni.showToast({ title: '请回原销售单修正', icon: 'none' })
		return
	}
	if (resolvingId.value) return
	const res = await uni.showModal({
		title: '标记修复',
		content: '确认标记为已修复？',
		showCancel: true
	})
	if (!res.confirm) return

	resolvingId.value = item._id
	resolvingMode.value = 'default'
	try {
		const res = await resolveBottleAnomalyV1({ id: item._id })
		if (res?.code === 0) {
			const resolvedCount = Number(res?.data?.resolved_count || 0)
			removeResolvedAnomalyLocally(item, resolvedCount)
			uni.showToast({ title: resolvedCount > 1 ? `已修复，并关闭${resolvedCount}条重复异常` : '已修复', icon: 'success' })
			scheduleSearchSync()
		} else {
			uni.showToast({ title: res?.msg || '修复失败', icon: 'none' })
		}
	} finally {
		resolvingId.value = ''
		resolvingMode.value = ''
	}
}

async function onResolveMissingFillLoss(item) {
	if (resolvingId.value || !canResolveMissingFillByLoss(item)) return
	const decision = buildMissingFillDecision(item)
	const resolutionMode = buildMissingFillResolveMode(item)
	const confirmRes = await uni.showModal({
		title: decision.code === 'swell_accept' ? '记胀重修复' : '记损耗修复',
		content:
			decision.code === 'swell_accept'
				? `净重差值为 ${formatSignedWeight(decision.diff)}kg，将按差值记胀重并关闭异常。确认执行？`
				: decision.diff < 0
					? `净重差值为 ${formatSignedWeight(decision.diff)}kg，将按差值记损耗并关闭异常。确认执行？`
					: '净重无差异，将直接关闭异常，不新增差值记录。确认执行？',
		showCancel: true
	})
	if (!confirmRes.confirm) return

	resolvingId.value = normalizeString(item?._id)
	resolvingMode.value = resolutionMode
	try {
		const res = await resolveBottleAnomalyV1({
			id: item?._id,
			resolutionMode
		})
		if (res?.code === 0) {
			const resolvedCount = Number(res?.data?.resolved_count || 0)
			removeResolvedAnomalyLocally(item, resolvedCount)
			uni.showToast({ title: resolvedCount > 1 ? `已修复，并关闭${resolvedCount}条重复异常` : '已修复', icon: 'success' })
			scheduleSearchSync()
		} else {
			uni.showToast({ title: res?.msg || '修复失败', icon: 'none' })
		}
	} finally {
		resolvingId.value = ''
		resolvingMode.value = ''
	}
}

async function onBackfillMissingFill(item) {
	if (!canResolveMissingFillByBackfill(item)) return
	const decision = buildMissingFillDecision(item)
	const confirmRes = await uni.showModal({
		title: '补灌装单',
		content: `净重差值为 ${formatSignedWeight(decision.diff)}kg（增重且超过 ${MISSING_FILL_THRESHOLD_KG}kg），将跳转灌装页预填补单信息，确认继续？`,
		showCancel: true
	})
	if (!confirmRes.confirm) return
	const returnScrollTop = await getViewportScrollTop()
	const url = buildMissingFillBackfillUrl(item, { returnScrollTop })
	if (!url) {
		uni.showToast({ title: '补单参数不完整', icon: 'none' })
		return
	}
	uni.navigateTo({ url })
}

async function onRemoveContinuousFill(item) {
	if (resolvingId.value || !canRemoveContinuousFill(item)) return
	const target = getContinuousFillDeleteTarget(item)
	if (!target.recordId) {
		uni.showToast({ title: '未定位到后一次灌装记录', icon: 'none' })
		return
	}
	const bottleNo = normalizeBottleNo(item?.bottle_no)
	const confirmRes = await uni.showModal({
		title: '删除后一次灌装',
		content: `${bottleNo || '该瓶'}${target.date ? ` 在 ${target.date}` : ''} 的后一次灌装${target.net != null ? `（净重 ${formatWeightValue(target.net)}kg）` : ''}将被删除，并同步更新该瓶异常状态。确认继续？`,
		showCancel: true
	})
	if (!confirmRes.confirm) return

	resolvingId.value = normalizeString(item?._id)
	resolvingMode.value = 'remove_fill'
	try {
		const res = await removeFillingV1({ _id: target.recordId })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
			return
		}
		removeResolvedAnomalyLocally(item, 1)
		uni.showToast({ title: res?.msg || '删除成功', icon: 'success' })
		scheduleSearchSync()
	} finally {
		resolvingId.value = ''
		resolvingMode.value = ''
	}
}

async function refreshAfterBackfillReturn(payload = {}) {
	const bottleNo = normalizeBottleNo(payload?.bottleNo || payload?.bottle_no)
	const scrollTop = normalizeScrollTop(payload?.scrollTop || payload?.returnScrollTop)
	if (bottleNo) {
		try {
			await scanBottleAnomaliesSafeV2({
				bottleNo,
				reconcileAnomalies: true,
				reconcileTypes: BACKFILL_REFRESH_RECONCILE_TYPES,
				maxRounds: 12
			})
		} catch (err) {
			console.error('refreshAfterBackfillReturn scan failed', err)
		}
	}
	await onSearch(false)
	await restoreViewportScrollTop(scrollTop)
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

onMounted(async () => {
	await loadAnomalyTypes()
	onSearch()
})

defineExpose({
	refresh: () => onSearch(false),
	refreshAfterBackfillReturn
})
</script>

<style scoped>
.view-body {
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

.scan-card {
	background: #ffffff;
	border-radius: var(--crm-radius-sm);
	padding: 20rpx;
	border: 1rpx solid var(--crm-border);
	display: flex;
	gap: 16rpx;
	align-items: center;
}

.scan-input {
	flex: 1;
}

.scan-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	line-height: 1.5;
}

.inspect-card {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.inspect-title {
	font-size: 24rpx;
	font-weight: 600;
	color: var(--crm-text);
}

.pager-row {
	margin-top: 12rpx;
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
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
