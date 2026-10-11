<template>
	<AppPage class="closure-shell">
		<view class="closure-page">
			<view class="closure-header">
				<view class="heading-group">
					<button class="back-button" aria-label="返回上一页" @click="goBack">← 返回</button>
					<view><text class="page-title" role="heading" aria-level="1">天然气闭环</text><text class="hint">按首次灌装归组，追踪补灌与出瓶</text></view>
				</view>
				<AppButton kind="neutral" size="sm" :loading="loading" @click="refresh()">刷新数据</AppButton>
			</view>
			<view class="workspace-tabs" aria-label="闭环工作区">
				<button class="workspace-tab" :class="{ 'is-active': activeView === 'cycles' }" :aria-pressed="activeView === 'cycles'" @click="activeView = 'cycles'">逐瓶闭环</button>
				<button class="workspace-tab" :class="{ 'is-active': activeView === 'tank' }" :aria-pressed="activeView === 'tank'" @click="activeView = 'tank'">每日灌前余量</button>
			</view>

			<AppSection>
				<view class="filter-grid">
					<picker mode="date" :value="filters.dateStart" @change="filters.dateStart = $event.detail.value"><AppInput :model-value="filters.dateStart" label="首次灌装开始日" readonly size="sm" /></picker>
					<picker mode="date" :value="filters.dateEnd" @change="filters.dateEnd = $event.detail.value"><AppInput :model-value="filters.dateEnd" label="首次灌装结束日" readonly size="sm" /></picker>
					<picker mode="date" :value="filters.cutoffDay" @change="filters.cutoffDay = $event.detail.value"><AppInput :model-value="filters.cutoffDay" label="观察截止日" readonly size="sm" /></picker>
					<AppInput v-model="filters.bottle_no" label="瓶号（仅逐瓶闭环）" placeholder="全部普通钢瓶" size="sm" />
					<AppButton size="sm" :loading="loading" @click="search">查询</AppButton>
				</view>
				<text v-if="formError" class="notice notice--error" role="alert">{{ formError }}</text>
			</AppSection>
			<view class="freshness" role="status">
				<text v-if="loading">正在读取最新记录{{ result ? '，当前显示上次结果' : '' }}…</text>
				<text v-else-if="receivedAt">{{ stale ? '上次成功读取' : '更新于' }} {{ formatTime(receivedAt) }} · 每60秒自动刷新</text>
				<text v-else>尚未取得闭环数据</text>
				<text v-if="appliedFilters">首灌 {{ appliedFilters.dateStart }} 至 {{ appliedFilters.dateEnd }} · 观察至 {{ appliedFilters.cutoffDay }}</text>
			</view>
			<view v-if="error" class="notice notice--error" role="alert">{{ error }}{{ stale ? '。下方为上次结果，已过期，请刷新后再核对。' : '。当前统计不可用。' }}</view>
			<view v-for="(warning, index) in scopeWarnings" :key="index" class="notice">{{ issueText(warning) }}</view>

			<template v-if="activeView === 'cycles'">
				<view class="summary-panel">
					<view class="metric metric--total">
						<text class="metric-label">本批累计灌入</text>
						<view class="metric-value">{{ kg(summary.total_fill_kg) }} <text class="unit">kg</text></view>
						<text class="hint">本批在选期灌入 {{ kg(summary.selected_fill_kg) }} kg</text>
						<text class="hint">后续补灌 {{ kg(summary.later_fill_kg) }} kg</text>
					</view>
					<view class="metric">
						<text class="metric-label">已核出瓶净气重</text>
						<view class="metric-value">{{ kg(summary.out_net_kg) }} <text class="unit">kg</text></view>
						<text class="hint">{{ summary.closed_count == null ? '—' : summary.closed_count }} 个已核周期 · 出瓶只计一次</text>
					</view>
					<view class="metric">
						<text class="metric-label">尚未出瓶账面瓶内重</text>
						<view class="metric-value">{{ kg(summary.unsold_net_kg) }} <text class="unit">kg</text></view>
						<text class="hint">尚未出瓶重量为末次账面值</text>
						<text class="hint">不代表当前实测库存</text>
					</view>
					<view class="metric">
						<text class="metric-label">待核灌入重量</text>
						<view class="metric-value">{{ kg(summary.pending_fill_kg) }} <text class="unit">kg</text></view>
						<text class="hint">已包含在累计灌入中，不能重复相加</text>
					</view>
				</view>
				<view class="scope-explainer">
					<text>灌入与出瓶不能直接相减作为损耗。</text>
					<button class="text-button" :aria-expanded="showScope" @click="showScope = !showScope">{{ showScope ? '收起口径' : '查看统计口径' }}</button>
				</view>
				<view v-if="showScope" class="notice">
					<text>跨日补灌合并在同一周期；一次有效出瓶关闭一个周期，出售重量只计一次。已核闭环表示来源链可解释，不代表零损耗。</text>
				</view>
				<view v-if="hasUnknownWeight" class="notice">部分称重尚未核清，对应汇总显示“—”；不把缺失重量当作0。</view>
				<view v-if="result?.scope?.selected_prior_fill_count > 0" class="notice">所选日期另有 {{ result.scope.selected_prior_fill_count }} 条补灌 {{ kg(result.scope.selected_prior_fill_kg) }} kg，归属于更早首灌批次，未计入上方汇总；可将开始日提前查看。</view>

				<AppSection title="逐瓶明细">
					<template #actions><text class="hint">当前 {{ total }} 个周期</text></template>
					<view class="status-tabs" aria-label="闭环状态筛选">
						<button v-for="tab in statusTabs" :key="tab.value" class="status-tab" :class="{ 'is-active': filters.status === tab.value }" :aria-pressed="filters.status === tab.value" @click="setStatus(tab.value)">{{ tab.label }} <text class="tab-count">{{ tab.count == null ? '—' : tab.count }}</text></button>
					</view>
					<view class="list-head" aria-hidden="true"><text>钢瓶 / 首次灌装</text><text>累计灌入 · kg</text><text>出瓶净气 · kg</text><text>末次瓶内 · kg</text><text>状态 / 待核原因</text></view>
					<view v-if="!cycles.length && !loading" class="empty">{{ result ? '当前筛选下没有灌装周期' : '读取成功后显示逐瓶依据' }}</view>
					<view v-for="cycle in cycles" :key="cycle.id" class="cycle">
						<button class="cycle-head" :aria-expanded="expandedCycle === cycle.id" @click="expandedCycle = expandedCycle === cycle.id ? '' : cycle.id">
							<view class="cycle-bottle"><text class="bottle-label">{{ cycle.bottle_no }} 号瓶</text><text class="hint">{{ cycle.first_fill_day }}</text></view>
							<view class="cycle-fill number-cell"><text class="mobile-label">累计灌入</text><text>{{ kg(cycle.total_fill_kg) }}</text><text v-if="cycle.later_fill_kg" class="hint">含后续补灌 {{ kg(cycle.later_fill_kg) }}</text></view>
							<view class="cycle-out number-cell"><text class="mobile-label">出瓶净气</text><text>{{ cycle.status === 'unsold' ? '—' : kg(cycle.out_net_kg) }}</text></view>
							<view class="cycle-stock number-cell"><text class="mobile-label">末次瓶内</text><text>{{ kg(cycle.last_net_kg) }}</text></view>
							<view class="cycle-state"><text class="status-badge" :class="'status-badge--' + cycle.status">{{ statusLabel(cycle.status) }}</text><text v-if="cycle.status === 'pending'" class="issue-preview">{{ firstIssue(cycle) }}</text><text class="expand-label">{{ expandedCycle === cycle.id ? '收起 −' : '详情 +' }}</text></view>
						</button>
					<view v-if="expandedCycle === cycle.id" class="cycle-detail">
						<view class="detail-grid">
							<view><text class="hint">首次灌前瓶内余气</text><text>{{ kg(cycle.pre_fill_net_kg) }} kg</text></view>
							<view><text class="hint">上秤差</text><text>{{ kg(cycle.start_loss_kg) }} kg</text></view>
							<view><text class="hint">末次灌完瓶内净重</text><text>{{ kg(cycle.last_net_kg) }} kg</text></view>
							<view><text class="hint">灌完至出瓶重量差</text><text>{{ kg(cycle.post_fill_difference_kg) }} kg</text></view>
						</view>
						<view v-if="cycle.status === 'unsold'" class="notice">截至观察日尚未找到有效出瓶；末次账面瓶内净重不代表当前实测余量。</view>
						<view v-for="(issue, index) in cycle.issue_labels || cycle.issues || []" :key="index" class="notice">{{ issueText(issue) }}</view>
						<text class="detail-title">源单依据</text>
						<view v-for="(evidence, index) in cycle.evidence || []" :key="`${evidence.source_id || index}-${index}`" class="evidence-row">
							<view><text>{{ evidenceLabel(evidence) }}</text><text class="hint">{{ evidenceDetail(evidence) }}</text></view>
							<AppButton v-if="evidenceUrl(evidence)" kind="ghost" size="sm" @click="openEvidence(evidence)">查看源单</AppButton>
						</view>
					</view>
					</view>
					<view class="pager">
						<text class="hint">汇总按完整查询范围计算</text>
						<view class="pager-actions"><AppButton kind="neutral" size="sm" :disabled="page <= 1 || loading" @click="changePage(page - 1)">上一页</AppButton><text>{{ result?.page || page }} / {{ totalPages }}</text><AppButton kind="neutral" size="sm" :disabled="page >= totalPages || loading" @click="changePage(page + 1)">下一页</AppButton></view>
					</view>
				</AppSection>
				<view class="scope-note"><text>其他出罐（不计入普通钢瓶周期）</text><text>整车补气 {{ kg(result?.scope?.excluded?.truck?.fill_kg) }} kg · 代理出站 {{ kg(result?.scope?.excluded?.agent?.fill_kg) }} kg · 车辆自用 {{ kg(result?.scope?.excluded?.self_use?.fill_kg) }} kg</text></view>
			</template>

			<AppSection v-else title="每天灌装前的大罐余量">
				<text class="hint">按首次灌装日期范围列出全站作业，不受瓶号和闭环状态筛选影响。</text>
				<view class="notice">仪表余量仅作参考，尚未校准。液位下降识别的是疑似启动时段，需现场核准。</view>
				<view v-if="!days.length && !loading" class="empty">当前日期范围暂无灌装日</view>
				<view v-for="day in days" :key="day.day" class="day-row">
					<button class="day-head" :aria-expanded="expandedDay === day.day" @click="toggleDay(day.day)">
						<view><text class="day-date">{{ day.day }}</text><text class="hint">{{ day.fill_count }} 条作业 · 登记出罐 {{ kg(day.fill_kg) }} kg</text><text v-if="day.unknown_count > 0" class="hint">有 {{ day.unknown_count }} 条重量待核</text></view>
						<text>{{ expandedDay === day.day ? '收起 −' : '查灌前余量 +' }}</text>
					</button>
					<view v-if="expandedDay === day.day" class="tank-detail">
						<text v-if="tankResults[day.day]?.loading" class="hint" role="status">正在更新这一天的日志{{ tankResults[day.day]?.data ? '，下方保留上次结果' : '' }}…</text>
						<view v-if="tankResults[day.day]?.error" class="notice notice--error" role="alert">{{ tankResults[day.day].error }}{{ tankResults[day.day]?.data ? '。下方为上次结果，已过期。' : '' }} <AppButton kind="ghost" size="sm" @click="loadTank(day.day)">重试</AppButton></view>
						<text v-else-if="tankResults[day.day]?.stale && tankResults[day.day]?.data && !tankResults[day.day]?.loading" class="notice">下方为上次结果，等待更新，请勿据此作最终核对。</text>
						<template v-if="tankResults[day.day]?.data">
							<view class="tank-reading"><text class="tank-quantity">{{ ton(tankResults[day.day].data.quantity_t) }} <text class="hint">吨</text></text><text class="status-badge status-badge--pending">{{ tankResults[day.day].data.status === 'candidate' ? '候选余量 · 待现场核准' : '待核' }}</text></view>
							<text class="hint">液位 {{ kg(tankResults[day.day].data.level_kpa) }} kPa · 压力 {{ kg(tankResults[day.day].data.pressure_mpa) }} MPa · 记录时刻 {{ formatTime(tankResults[day.day].data.observed_at) }}</text>
							<text v-if="tankResults[day.day].data.start_window" class="hint">疑似启动时段 {{ windowText(tankResults[day.day].data.start_window) }}</text>
							<view v-for="(issue, index) in tankResults[day.day].data.issues || []" :key="index" class="notice">{{ issueText(issue) }}</view>
							<view v-if="tankResults[day.day].data.candidates?.length" class="platforms">
								<text class="detail-title">局部平台参考</text>
								<view v-for="(candidate, index) in tankResults[day.day].data.candidates" :key="index" class="platform-row">
									<text class="hint">{{ formatTime(candidate.observed_at) }} · {{ ton(candidate.quantity_t) }} 吨 · 液位 {{ kg(candidate.level_kpa) }} kPa · 压力 {{ kg(candidate.pressure_mpa) }} MPa</text>
									<text v-if="candidate.start_window" class="hint">疑似启动 {{ windowText(candidate.start_window) }}</text>
									<text v-for="(issue, issueIndex) in candidate.issues || []" :key="issueIndex" class="hint">{{ tankIssueText(issue) }}</text>
								</view>
							</view>
							<text v-if="tankResults[day.day].updatedAt" class="hint tank-updated">本次参考读取于 {{ formatTime(tankResults[day.day].updatedAt) }}</text>
						</template>
						<text v-else-if="!tankResults[day.day]?.loading && !tankResults[day.day]?.error" class="hint">等待主数据刷新完成</text>
					</view>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useGasClosure } from '@/composables/gas/useGasClosure'

const activeView = ref('cycles')
const showScope = ref(false)
function goBack() {
	if (getCurrentPages().length > 1) uni.navigateBack()
	else uni.reLaunch({ url: '/pages/index/index' })
}
function firstIssue(cycle) {
	return issueText((cycle.issue_labels || cycle.issues || [])[0] || '来源依据待核')
}
const props = defineProps({ visible: { type: Boolean, default: false } })
const { requirePageView, canViewPage } = useAuthGuard()
const closure = useGasClosure({ canRead: () => requirePageView('/pages/gas-closure/index') })
const {
	filters, appliedFilters, result, loading, error, formError, stale, receivedAt,
	page, total, totalPages, cycles, summary, days, expandedCycle, expandedDay, tankResults,
	refresh, search, setStatus, changePage, loadTank, toggleDay, setVisible
} = closure
const scopeWarnings = computed(() => result.value?.scope?.warnings || [])
const statusTabs = computed(() => [
	{ value: '', label: '全部', count: summary.value.cycle_count },
	{ value: 'closed', label: '已核闭环', count: summary.value.closed_count },
	{ value: 'unsold', label: '尚未出瓶', count: summary.value.unsold_count },
	{ value: 'pending', label: '待核', count: summary.value.pending_count }
])
const hasUnknownWeight = computed(() => Object.values(summary.value.unknown_weight_counts || {}).some(value => Number(value) > 0))
function kg(value) {
	if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
	return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}
function ton(value) { return kg(value) }
function formatTime(value) {
	if (value == null || value === '') return '—'
	const date = new Date(value)
	if (!Number.isFinite(date.getTime())) return String(value)
	return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
}
function windowText(value) {
	if (typeof value === 'string') return value
	if (Array.isArray(value)) return value.map(formatTime).join(' 至 ')
	return [value.start || value.from, value.end || value.to].filter(Boolean).map(formatTime).join(' 至 ') || '待核'
}
function statusLabel(value) { return { closed: '已核闭环', unsold: '尚未出瓶', pending: '待核' }[value] || '待核' }
function issueText(value) { return typeof value === 'string' ? value : value?.message || value?.label || value?.code || '依据待核' }
function tankIssueText(value) {
	return { platform_pressure_unstable: '平台压力仍有波动', pressure_changed: '下降期间压力有变化', rise_before_decline: '下降之前出现液位上升', quantity_missing: '平台重量缺少有效记录' }[value] || issueText(value)
}
function evidenceLabel(row) { return row.label || `${row.date || row.event_day || ''} · ${{ fill: '灌装', back: '回瓶', out: '出瓶', boundary: '历史边界' }[row.type] || '流转依据'}` }
function evidenceDetail(row) {
	if (row.detail || row.message) return row.detail || row.message
	const parts = []
	if (row.fill_kg != null) parts.push(`灌入 ${kg(row.fill_kg)} kg`)
	if (row.net_weight != null) parts.push(`${row.type === 'fill' ? '灌入' : '净气重'} ${kg(row.net_weight)} kg`)
	if (row.weight_start != null || row.weight_end != null) parts.push(`上秤 ${kg(row.weight_start)} → 灌完 ${kg(row.weight_end)} kg`)
	if (row.issue_labels?.length) parts.push(...row.issue_labels)
	return parts.join(' · ')
}
function evidenceUrl(row) {
	if (!row.source_id || row.type === 'boundary') return ''
	const path = { filling: '/pages/filling/edit', sale: '/pages/sale/detail' }[row.source_type]
	return path && canViewPage(path) ? `${path}?_id=${encodeURIComponent(row.source_id)}` : ''
}
function openEvidence(row) { const url = evidenceUrl(row); if (url) uni.navigateTo({ url }) }
let mounted = false
function updateVisibility() { if (mounted) setVisible(props.visible && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) }
watch(() => props.visible, updateVisibility)
onMounted(() => {
	mounted = true
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', updateVisibility)
	updateVisibility()
})
onBeforeUnmount(() => { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', updateVisibility) })
</script>

<style scoped>
.closure-page { width:100%; max-width:1440px; margin:0 auto; padding:24px 0; box-sizing:border-box; display:flex; flex-direction:column; gap:16px; color:var(--crm-text); font-size:14px; }
.closure-header, .heading-group { display:flex; align-items:center; gap:20px; }
.closure-header { justify-content:space-between; }
.page-title { display:block; font-size:26px; line-height:1.4; font-weight:700; margin-bottom:2px; }
.hint { display:block; color:var(--crm-text-muted); font-size:12px; line-height:1.65; }
button { cursor:pointer; }
button:focus-visible { outline:2px solid var(--crm-primary); outline-offset:2px; }
.back-button, .workspace-tab, .status-tab, .text-button { margin:0; background:transparent; color:var(--crm-text-muted); border:0; border-radius:var(--crm-radius-sm); font-size:14px; line-height:1.5; }
.back-button::after, .workspace-tab::after, .status-tab::after, .text-button::after, .cycle-head::after, .day-head::after { border:0; }
.back-button { padding:8px 10px; border:1px solid var(--crm-border); background:var(--crm-surface); }
.workspace-tabs { display:flex; gap:24px; border-bottom:1px solid var(--crm-border); }
.workspace-tab { padding:10px 0 12px; border-radius:0; border-bottom:3px solid transparent; }
.workspace-tab.is-active { color:var(--crm-primary); border-bottom-color:var(--crm-primary); font-weight:700; }
.filter-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) minmax(150px,.8fr) auto; align-items:end; gap:16px; }
.freshness { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 16px; color:var(--crm-text-muted); font-size:12px; line-height:1.6; }
.summary-panel { display:grid; grid-template-columns:1.2fr 1fr 1fr 1fr; background:var(--crm-surface); border:1px solid var(--crm-border); border-radius:var(--crm-radius-md); overflow:hidden; }
.metric { padding:20px; border-left:1px solid var(--crm-border-weak); min-width:0; }
.metric:first-child { border-left:0; }
.metric--total { background:var(--crm-primary-weak); }
.metric-label { display:block; font-size:13px; font-weight:600; line-height:1.6; }
.metric-value { font-size:27px; font-weight:700; line-height:1.4; margin:8px 0; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.metric--total .metric-value { color:var(--crm-primary); }
.unit { color:var(--crm-text-muted); font-size:13px; font-weight:400; }
.scope-explainer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:4px 12px; font-size:12px; color:var(--crm-text-muted); margin-top:-8px; }
.text-button { color:var(--crm-primary); font-size:12px; padding:4px 0; }
.notice { display:block; background:#fff8e8; color:#805c16; padding:10px 12px; border-radius:var(--crm-radius-sm); font-size:13px; line-height:1.7; margin-top:8px; }
.notice--error { background:#fff0f0; color:#a32e2e; }
.status-tabs { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
.status-tab { font-size:13px; padding:7px 12px; border:1px solid var(--crm-border); background:var(--crm-surface); }
.status-tab.is-active { color:var(--crm-primary); border-color:var(--crm-primary); background:var(--crm-primary-weak); font-weight:600; }
.tab-count { margin-left:5px; font-variant-numeric:tabular-nums; }
.list-head, .cycle-head { display:grid; grid-template-columns:1.1fr 1fr 1fr 1fr 1.7fr; gap:20px; align-items:center; }
.list-head { padding:10px 14px; color:var(--crm-text-muted); font-size:12px; background:var(--crm-bg); border-radius:var(--crm-radius-sm); }
.list-head > text:nth-child(n+2):nth-child(-n+4) { text-align:right; }
.cycle { border-bottom:1px solid var(--crm-border-weak); }
.cycle-head { width:100%; margin:0; text-align:left; padding:12px 14px; font-size:14px; line-height:1.5; background:var(--crm-surface); border-radius:0; color:var(--crm-text); }
.cycle-head:hover { background:var(--crm-hover-bg); }
.bottle-label, .day-date { font-weight:600; }
.number-cell { text-align:right; font-variant-numeric:tabular-nums; }
.cycle-state { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; min-width:0; }
.status-badge { display:inline-block; padding:3px 7px; border-radius:4px; font-size:12px; white-space:nowrap; background:var(--crm-bg); color:var(--crm-text-muted); font-weight:400; }
.status-badge--closed { color:#17684b; background:#e8f5ee; }
.status-badge--unsold { color:#27629c; background:#edf4ff; }
.status-badge--pending { color:#805c16; background:#fff3d9; }
.issue-preview { width:100%; color:#805c16; font-size:12px; order:3; overflow-wrap:anywhere; }
.expand-label { margin-left:auto; color:var(--crm-primary); font-size:12px; white-space:nowrap; }
.mobile-label { display:none; }
.cycle-detail { padding:16px; background:var(--crm-bg); border-top:1px solid var(--crm-border-weak); }
.detail-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; font-size:15px; }
.detail-title { display:block; font-size:13px; font-weight:600; margin-top:16px; margin-bottom:6px; }
.evidence-row { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:13px; padding:10px 0; border-bottom:1px solid var(--crm-border-weak); }
.pager { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; margin-top:18px; font-size:13px; }
.pager-actions { display:flex; align-items:center; gap:14px; }
.empty { padding:32px 12px; text-align:center; color:var(--crm-text-muted); font-size:14px; }
.scope-note { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--crm-text-muted); line-height:1.7; }
.day-row { border-top:1px solid var(--crm-border-weak); margin-top:12px; }
.day-head { width:100%; display:flex; justify-content:space-between; align-items:center; text-align:left; gap:12px; margin:0; padding:14px 0; font-size:14px; background:transparent; color:var(--crm-text); line-height:1.7; }
.day-head > text { color:var(--crm-primary); font-size:13px; }
.tank-detail { background:var(--crm-bg); padding:16px; border-radius:var(--crm-radius-sm); }
.tank-reading { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin:8px 0; }
.tank-quantity { font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; }
.tank-quantity .hint { display:inline; }
.platforms { padding-top:4px; }
.platform-row { padding:6px 0; }
.tank-updated { margin-top:12px; }
@media (max-width:1000px) {
 .filter-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
 .filter-grid > :last-child { justify-self:end; grid-column:2; }
 .summary-panel { grid-template-columns:repeat(2,minmax(0,1fr)); }
 .metric:nth-child(3) { border-left:0; }
 .metric:nth-child(n+3) { border-top:1px solid var(--crm-border-weak); }
 .list-head, .cycle-head { gap:12px; grid-template-columns:1fr .8fr .8fr .8fr 1.7fr; }
}
@media (max-width:767px) {
 .closure-page { padding:16px 0; gap:12px; }
 .closure-header { gap:12px; align-items:flex-start; flex-wrap:wrap; }
 .heading-group { gap:12px; }
 .page-title { font-size:23px; }
 .back-button { font-size:13px; padding:10px 8px; min-height:44px; }
 .workspace-tab { min-height:44px; }
 .metric { padding:14px 12px; }
 .metric-value { font-size:23px; }
 .metric-label { font-size:12px; }
 .filter-grid { gap:12px; }
 .filter-grid > :last-child { grid-column:1 / -1; justify-self:stretch; }
 .list-head { display:none; }
 .status-tabs { gap:6px; }
 .status-tab { padding:10px; min-height:44px; font-size:12px; }
 .cycle { margin-top:10px; border:1px solid var(--crm-border); border-radius:var(--crm-radius-sm); overflow:hidden; }
 .cycle-head { grid-template-columns:repeat(3,minmax(0,1fr)); grid-template-areas:"bottle state state" "fill out stock"; gap:12px; padding:12px; }
 .cycle-bottle { grid-area:bottle; }
 .cycle-fill { grid-area:fill; }
 .cycle-out { grid-area:out; }
 .cycle-stock { grid-area:stock; }
 .cycle-state { grid-area:state; }
 .number-cell { text-align:left; }
 .mobile-label { display:block; color:var(--crm-text-muted); font-size:12px; margin-bottom:2px; }
 .detail-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
 .cycle-detail { padding:12px; }
 .day-head { align-items:flex-start; }
 .evidence-row { align-items:flex-start; flex-wrap:wrap; }
 .pager-actions { margin-left:auto; }
}
</style>
