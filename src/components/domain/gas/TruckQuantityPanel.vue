<template>
	<view class="truck-panel">
		<AppSection>
			<view class="filters">
				<view><picker mode="date" :value="filters.dateStart" @change="filters.dateStart = $event.detail.value"><AppInput :model-value="filters.dateStart" label="进液开始日" placeholder="当前账期起点" readonly size="sm" /></picker><button v-if="filters.dateStart" class="text-button" @click="filters.dateStart = ''">清除开始日，回当前账期起点</button></view>
				<picker mode="date" :value="filters.dateEnd" @change="filters.dateEnd = $event.detail.value"><AppInput :model-value="filters.dateEnd" label="进液结束日" readonly size="sm" /></picker>
				<picker mode="date" :value="filters.cutoffDay" @change="filters.cutoffDay = $event.detail.value"><AppInput :model-value="filters.cutoffDay" label="观察截止日" readonly size="sm" /></picker>
				<AppButton size="sm" :loading="loading" @click="search">查询</AppButton>
			</view>
			<text v-if="formError" class="notice notice--error" role="alert">{{ formError }}</text>
		</AppSection>
		<view class="freshness" role="status">
			<text v-if="loading">正在读取逐车数量{{ result ? '，当前显示上次结果' : '' }}…</text>
			<text v-else-if="receivedAt">{{ stale ? '上次成功读取' : '更新于' }} {{ formatTime(receivedAt) }} · 页面可见时每60秒刷新</text>
			<text v-else>尚未取得逐车数量</text>
			<text v-if="appliedFilters">进液 {{ appliedFilters.dateStart || '当前账期起点' }} 至 {{ appliedFilters.dateEnd }} · 观察至 {{ appliedFilters.cutoffDay }}</text>
		</view>
		<view v-if="error" class="notice notice--error" role="alert">{{ error }}{{ stale ? '。下方为上次结果，已过期，请刷新后再核对。' : '。当前统计不可用。' }} <AppButton kind="ghost" size="sm" @click="refresh()">重试</AppButton></view>
		<view class="scope-note">按每次进液后的作业区间核对数量。出瓶净重含钢瓶原有余气；同日先后不明、跨车补灌单独待核。清罐表示再也灌不出来，不代表罐内物理余量为零。</view>
		<text v-if="result?.scope?.inventory_period?.cutoff_day" class="hint">当前账期起点 {{ result.scope.inventory_period.cutoff_day }}；账期只作默认筛选，不代表罐空或损耗核准。可指定更早日期查询。</text>
		<view v-for="(warning, index) in result?.scope?.warnings || []" :key="index" class="notice">{{ issueText(warning) }}</view>
		<AppSection title="逐车数量核对">
			<template #actions><text class="hint">{{ result ? `${batches.length} 车` : '等待读取' }} · 单位 kg</text></template>
			<view class="list-head" aria-hidden="true"><text>车次 / 进液日</text><text>采用入罐</text><text>作业区间出罐</text><text>已核出瓶</text><text>待核提示</text></view>
			<view v-if="!batches.length && !loading" class="empty">{{ result ? '当前范围没有进液车次' : '读取成功后显示逐车依据' }}</view>
			<view v-for="batch in batches" :key="batch.id" class="batch">
				<button class="batch-head" :aria-expanded="expandedBatch === batch.id" @click="expandedBatch = expandedBatch === batch.id ? '' : batch.id">
					<view class="vehicle"><text class="strong">{{ batch.truck_no || '车号待核' }}</text><text class="hint">{{ batch.day }}</text></view>
					<view class="in-weight number"><text class="mobile-label">采用入罐</text><text>{{ kg(batch.weight?.adopted_station_in_kg) }}</text><text class="hint">{{ basisLabel(batch.weight?.adopted_basis) }}</text></view>
					<view class="fill-weight number"><text class="mobile-label">区间出罐</text><text>{{ kg(batch.filling?.total?.kg) }}</text><text class="hint">普通灌装 {{ kg(batch.filling?.normal_fill?.kg) }}</text></view>
					<view class="sale-weight number"><text class="mobile-label">已核出瓶</text><text>{{ kg(batch.sales?.closed?.kg) }}</text><text class="hint">{{ batch.sales?.closed?.cycle_count ?? '—' }} 个周期</text></view>
					<view class="state"><text class="issue-preview">{{ firstIssue(batch) }}</text><text v-if="batch.unassigned_candidate_count || batch.shared_cycle_count" class="hint">待归车 {{ batch.unassigned_candidate_count || 0 }} 条 · 跨车或归属待核 {{ batch.shared_cycle_count || 0 }} 周期</text><text v-if="batch.open_period" class="badge">本车仍在使用</text><text v-if="batch.mixed_tank" class="badge">存在旧罐余液</text><text class="expand">{{ expandedBatch === batch.id ? '收起 −' : '依据 +' }}</text></view>
				</button>
				<view v-if="expandedBatch === batch.id" class="batch-detail">
					<view class="detail-heading"><text class="detail-title">入罐依据</text><AppButton v-if="evidenceUrl({ source_type: 'gas_in', source_id: batch.id })" kind="ghost" size="sm" @click="openEvidence({ source_type: 'gas_in', source_id: batch.id })">查看入库单</AppButton></view>
					<view class="detail-grid">
						<view><text class="hint">现场核准两次过磅 / 差值</text><text>{{ kg(batch.weight?.field_gross_kg) }} → {{ kg(batch.weight?.field_tare_kg) }} kg</text><text class="hint">过磅差 {{ kg(batch.weight?.confirmed_weigh_in_kg) }} kg</text></view>
						<view><text class="hint">登记毛重 / 皮重</text><text>{{ kg(batch.weight?.raw_gross_kg) }} → {{ kg(batch.weight?.raw_tare_kg) }} kg</text><text class="hint">登记差 {{ kg(batch.weight?.registered_gross_diff_kg) }} kg · 未据此认定为站内两磅</text></view>
						<view><text class="hint">登记站内卸入</text><text>{{ kg(batch.weight?.recorded_station_in_kg) }} kg</text></view>
						<view><text class="hint">随车直接销售</text><text>{{ kg(batch.weight?.direct_sale_kg) }} kg</text></view>
						<view><text class="hint">登记采购净重</text><text>{{ kg(batch.weight?.registered_net_kg) }} kg</text></view>
						<view><text class="hint">本次采用入罐</text><text>{{ kg(batch.weight?.adopted_station_in_kg) }} kg</text><text class="hint">{{ basisLabel(batch.weight?.adopted_basis) }}</text></view>
					</view>
					<text class="hint boundary">源单登记日期 {{ batch.source_date || batch.recorded_day || '待核' }} · 本次归属进液日 {{ batch.day }}</text>
					<text v-if="boundaryText(batch.boundary)" class="hint boundary">{{ boundaryText(batch.boundary) }}</text>
					<text v-if="batch.work_period" class="hint boundary">{{ workPeriodText(batch.work_period) }}</text>
					<text v-if="batch.fact_note" class="notice">{{ batch.fact_note }}</text>
					<text v-if="batch.unassigned_candidate_count || batch.shared_cycle_count" class="notice">另有 {{ batch.unassigned_candidate_count || 0 }} 条灌装待归车、{{ batch.shared_cycle_count || 0 }} 个跨车或归属不明周期，见下方待核池；未重复计入本车合计。</text>
					<view v-for="(issue, index) in batch.issue_labels || batch.issues || []" :key="index" class="notice">{{ issueText(issue) }}</view>
					<text class="detail-title">作业区间出罐</text>
					<view class="detail-grid">
						<view v-for="item in fillingKinds" :key="item.key"><text class="hint">{{ item.label }}</text><text>{{ kg(batch.filling?.[item.key]?.kg) }} kg</text><text v-if="batch.filling?.[item.key]?.unknown_count" class="hint">{{ batch.filling[item.key].unknown_count }} 条重量待核；已知 {{ kg(batch.filling[item.key].known_kg) }} kg</text></view>
					</view>
					<view class="balance"><text>区间收支余额 {{ kg(batch.arithmetic_balance_kg) }} kg</text><text class="hint">{{ batch.arithmetic_balance_note || '仅减已分配账面出罐；未扣待分配及余液变化，非损耗' }}。未包含真实期初、期末余液及放散。</text></view>
					<text class="detail-title">这些灌装周期的出瓶情况</text>
					<view class="detail-grid sales-grid">
						<view><text class="hint">已核出瓶净重</text><text>{{ kg(batch.sales?.closed?.kg) }} kg</text></view>
						<view><text class="hint">未出瓶末次账面重</text><text>{{ kg(batch.sales?.unsold?.kg) }} kg</text></view>
						<view><text class="hint">有单待核</text><text>{{ kg(batch.sales?.pending?.kg) }} kg</text></view>
					</view>
					<text class="hint">以上按唯一归属的钢瓶周期统计，出瓶含原瓶余气；待核重量不作为已核卖出，不与其他待核池重复相加。</text>
					<text class="detail-title">已归属灌装明细 · {{ batch.filling_rows?.length || 0 }} 条</text>
					<view v-for="(row, index) in pageRows(batch.filling_rows, `${batch.id}:fill`)" :key="row.source_id || index" class="evidence-row">
						<view><text>{{ row.date || row.day || '日期待核' }} · {{ row.bottle_no || '未登记瓶号' }} · {{ kindLabel(row.kind) }}</text><text class="hint">灌入 {{ kg(row.fill_kg) }} kg</text><text v-for="(issue, n) in row.issue_labels || []" :key="n" class="hint">{{ issueText(issue) }}</text></view>
						<AppButton v-if="evidenceUrl(row, 'filling')" kind="ghost" size="sm" @click="openEvidence(row, 'filling')">源单</AppButton>
					</view>
					<view v-if="(batch.filling_rows?.length || 0) > pageSize" class="pager"><AppButton kind="neutral" size="sm" :disabled="pageNumber(`${batch.id}:fill`) <= 1" @click="movePage(`${batch.id}:fill`, -1, batch.filling_rows)">上一页</AppButton><text>{{ pageNumber(`${batch.id}:fill`) }} / {{ pageCount(batch.filling_rows) }}</text><AppButton kind="neutral" size="sm" :disabled="pageNumber(`${batch.id}:fill`) >= pageCount(batch.filling_rows)" @click="movePage(`${batch.id}:fill`, 1, batch.filling_rows)">下一页</AppButton></view>
					<text class="detail-title">钢瓶周期 · {{ batch.cycles?.length || 0 }} 个</text>
					<view v-for="cycle in pageRows(batch.cycles, `${batch.id}:cycles`)" :key="cycle.id" class="evidence-row cycle-row">
						<view><text>{{ cycle.bottle_no }} 号瓶 · {{ statusLabel(cycle.status) }}</text><text class="hint">首次灌装 {{ cycle.first_fill_day || '待核' }} · 出瓶 {{ kg(cycle.out_net_kg) }} kg · 末次瓶内 {{ kg(cycle.last_net_kg) }} kg</text><text v-for="(issue, n) in cycle.issue_labels || []" :key="n" class="hint">{{ issueText(issue) }}</text></view>
						<view class="source-actions"><AppButton v-for="(row, n) in linkedEvidence(cycle)" :key="`${row.source_id}-${n}`" kind="ghost" size="sm" @click="openEvidence(row)">{{ evidenceLabel(row) }}</AppButton></view>
					</view>
					<view v-if="(batch.cycles?.length || 0) > pageSize" class="pager"><AppButton kind="neutral" size="sm" :disabled="pageNumber(`${batch.id}:cycles`) <= 1" @click="movePage(`${batch.id}:cycles`, -1, batch.cycles)">上一页</AppButton><text>{{ pageNumber(`${batch.id}:cycles`) }} / {{ pageCount(batch.cycles) }}</text><AppButton kind="neutral" size="sm" :disabled="pageNumber(`${batch.id}:cycles`) >= pageCount(batch.cycles)" @click="movePage(`${batch.id}:cycles`, 1, batch.cycles)">下一页</AppButton></view>
					<text class="hint detail-foot">明细每页20条，完整合计不受展示分页影响。“—”表示重量或依据尚未核清。</text>
				</view>
			</view>
		</AppSection>
		<AppSection title="尚未归到某一车的灌装">
			<template #actions><text class="hint">{{ result ? unassignedFillings.length : '—' }} 条</text></template>
			<text class="hint">同日卸液前后可能都有灌装。先后不明的记录留在此处，不强行归车，也不计入各车出罐合计。</text>
			<view v-if="result && !unassignedFillings.length" class="empty">当前范围无待归车灌装</view>
			<view v-for="(row, index) in pageRows(unassignedFillings, 'unassigned')" :key="row.source_id || index" class="evidence-row">
				<view><text>{{ row.date || row.day || '日期待核' }} · {{ row.bottle_no || '未登记瓶号' }} · {{ kindLabel(row.kind) }} {{ kg(row.fill_kg) }} kg</text><text class="hint">候选车次：{{ candidateText(row.candidate_batch_ids) }}</text><text v-for="(issue, n) in row.issue_labels || []" :key="n" class="hint">{{ issueText(issue) }}</text></view>
				<AppButton v-if="evidenceUrl(row, 'filling')" kind="ghost" size="sm" @click="openEvidence(row, 'filling')">查看源单</AppButton>
			</view>
			<view v-if="unassignedFillings.length > pageSize" class="pager"><AppButton kind="neutral" size="sm" :disabled="pageNumber('unassigned') <= 1" @click="movePage('unassigned', -1, unassignedFillings)">上一页</AppButton><text>{{ pageNumber('unassigned') }} / {{ pageCount(unassignedFillings) }}</text><AppButton kind="neutral" size="sm" :disabled="pageNumber('unassigned') >= pageCount(unassignedFillings)" @click="movePage('unassigned', 1, unassignedFillings)">下一页</AppButton></view>
		</AppSection>
		<AppSection title="跨车或归属不明的钢瓶周期">
			<template #actions><text class="hint">{{ result ? sharedCycles.length : '—' }} 个</text></template>
			<text class="hint">每个周期在这里保留一次；其出瓶量不重复分摊到各车。跨车补灌的灌入记录仍按各自作业时间归属。</text>
			<view v-if="result && !sharedCycles.length" class="empty">当前范围无跨车待核周期</view>
			<view v-for="cycle in pageRows(sharedCycles, 'shared')" :key="cycle.id" class="evidence-row cycle-row">
				<view><text>{{ cycle.bottle_no }} 号瓶 · {{ statusLabel(cycle.status) }}</text><text class="hint">首次灌装 {{ cycle.first_fill_day || '待核' }} · 出瓶 {{ kg(cycle.out_net_kg) }} kg</text><text class="hint">涉及车次：{{ candidateText(cycle.candidate_batch_ids) }}</text><text v-for="(issue, n) in cycle.issue_labels || []" :key="n" class="hint">{{ issueText(issue) }}</text></view>
				<view class="source-actions"><AppButton v-for="(row, n) in linkedEvidence(cycle)" :key="`${row.source_id}-${n}`" kind="ghost" size="sm" @click="openEvidence(row)">{{ evidenceLabel(row) }}</AppButton></view>
			</view>
			<view v-if="sharedCycles.length > pageSize" class="pager"><AppButton kind="neutral" size="sm" :disabled="pageNumber('shared') <= 1" @click="movePage('shared', -1, sharedCycles)">上一页</AppButton><text>{{ pageNumber('shared') }} / {{ pageCount(sharedCycles) }}</text><AppButton kind="neutral" size="sm" :disabled="pageNumber('shared') >= pageCount(sharedCycles)" @click="movePage('shared', 1, sharedCycles)">下一页</AppButton></view>
		</AppSection>
	</view>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useTruckQuantityClosure } from '@/composables/gas/useTruckQuantityClosure'

const props = defineProps({ visible: { type: Boolean, default: false } })
const { requirePageView, canViewPage } = useAuthGuard()
const { filters, appliedFilters, result, batches, unassignedFillings, sharedCycles, loading, stale, error, formError, receivedAt, expandedBatch, refresh, search, setVisible } = useTruckQuantityClosure({ canRead: () => requirePageView('/pages/gas-closure/index') })
const pageSize = 20
const detailPages = reactive({})
const fillingKinds = [
	{ key: 'normal_fill', label: '普通瓶灌装' }, { key: 'truck_refill', label: '站内向整车补气' },
	{ key: 'agent_out', label: '代理出站' }, { key: 'self_use', label: '车辆自用' },
	{ key: 'other', label: '其他出罐' }, { key: 'total', label: '区间总出罐' }
]
function kg(value) { return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 3 }) }
function issueText(value) { return typeof value === 'string' ? value : value?.message || value?.label || value?.code || '依据待核' }
function firstIssue(batch) { return issueText((batch.issue_labels || batch.issues || [])[0] || '查看区间依据') }
function basisLabel(value) { return { confirmed_field_record: '现场记录已核准', registered_pending: '登记值暂列 · 待核准', transfer_in_progress: '截止时卸液尚未完成' }[value] || '入罐依据待核' }
function kindLabel(value) { return fillingKinds.find(item => item.key === value)?.label || '灌装作业' }
function statusLabel(value) { return { closed: '已核出瓶', pending: '有单待核', unsold: '尚未出瓶' }[value] || '待核' }
function formatTime(value) { return value == null || !Number.isFinite(new Date(value).getTime()) ? '—' : new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') }
function boundaryText(value) {
	if (!value) return ''
	if (value.precision === 'day') return '进液仅有日期依据，卸液当天灌装先后仍待核。'
	return `进液时间窗口：${formatTime(value.start_at)} 至 ${formatTime(value.end_at)}`
}
function workPeriodText(value) {
	if (value.start_ms == null) return value.note || '作业归属区间待核'
	return `可明确归属的作业区间：${formatTime(value.start_ms)} 至 ${formatTime(value.end_ms)}${value.end_basis === 'observation_cutoff' ? '（观察截止）' : '（下一车进液前）'}`
}
function pageNumber(key) { return detailPages[key] || 1 }
function pageCount(rows) { return Math.max(1, Math.ceil((rows?.length || 0) / pageSize)) }
function pageRows(rows, key) { return (rows || []).slice((pageNumber(key) - 1) * pageSize, pageNumber(key) * pageSize) }
function movePage(key, step, rows) { detailPages[key] = Math.min(pageCount(rows), Math.max(1, pageNumber(key) + step)) }
function candidateText(ids) { return ids?.length ? ids.map(id => { const batch = batches.value.find(item => item.id === id); return batch ? `${batch.day} ${batch.truck_no || ''}` : '查询范围外车次' }).join('、') : '尚未确定' }
function evidenceUrl(row, sourceType) {
	if (!row.source_id || row.type === 'boundary') return ''
	const path = { gas_in: '/pages/gas-in/edit', filling: '/pages/filling/edit', sale: '/pages/sale/detail' }[row.source_type || sourceType]
	return path && canViewPage(path) ? `${path}?_id=${encodeURIComponent(row.source_id)}` : ''
}
function openEvidence(row, sourceType) { const url = evidenceUrl(row, sourceType); if (url) uni.navigateTo({ url }) }
function linkedEvidence(cycle) {
	return [
		...(cycle.source_fill_ids || []).map(source_id => ({ source_type: 'filling', source_id })),
		...(cycle.source_out_id ? [{ source_type: 'sale', source_id: cycle.source_out_id }] : [])
	].filter(row => evidenceUrl(row))
}
function evidenceLabel(row) { return `${row.date || row.event_day || ''} ${row.source_type === 'sale' ? '出瓶单' : '灌装单'}`.trim() }
watch(result, () => {
	for (const key of Object.keys(detailPages)) {
		const batch = batches.value.find(row => key === `${row.id}:fill` || key === `${row.id}:cycles`)
		const rows = key === 'unassigned' ? unassignedFillings.value : key === 'shared' ? sharedCycles.value : key.endsWith(':fill') ? batch?.filling_rows : batch?.cycles
		detailPages[key] = Math.min(pageNumber(key), pageCount(rows))
	}
})
let mounted = false
function updateVisibility() { if (mounted) setVisible(props.visible && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) }
watch(() => props.visible, updateVisibility)
onMounted(() => { mounted = true; if (typeof document !== 'undefined') document.addEventListener('visibilitychange', updateVisibility); updateVisibility() })
onBeforeUnmount(() => { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', updateVisibility) })
defineExpose({ refresh })
</script>

<style scoped>
.truck-panel { display:flex; flex-direction:column; gap:16px; min-width:0; color:var(--crm-text); font-size:14px; }
.filters { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) auto; align-items:start; gap:16px; }
.filters > :last-child { align-self:center; margin-top:20px; }
.hint, .mobile-label { display:block; color:var(--crm-text-muted); font-size:12px; line-height:1.65; }
.freshness { display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px 16px; color:var(--crm-text-muted); font-size:12px; line-height:1.6; }
.scope-note { font-size:13px; line-height:1.7; color:var(--crm-text-muted); }
.notice { padding:10px 12px; background:#fff8e8; color:#805c16; border-radius:var(--crm-radius-sm); font-size:13px; line-height:1.7; }
.notice--error { background:#fff0f0; color:#a32e2e; }
.filters + .notice, .batch-detail .notice { margin-top:10px; }
button { cursor:pointer; }
button:focus-visible { outline:2px solid var(--crm-primary); outline-offset:2px; }
.text-button, .batch-head { margin:0; border:0; color:var(--crm-text); background:transparent; border-radius:0; }
.text-button::after, .batch-head::after { border:0; }
.text-button { padding:6px 0 0; color:var(--crm-primary); font-size:12px; line-height:1.5; text-align:left; }
.list-head, .batch-head { display:grid; grid-template-columns:1.1fr 1fr 1fr 1fr 1.6fr; gap:18px; align-items:center; }
.list-head { padding:10px 14px; color:var(--crm-text-muted); font-size:12px; background:var(--crm-bg); border-radius:var(--crm-radius-sm); }
.list-head > text:nth-child(n+2):nth-child(-n+4) { text-align:right; }
.batch { border-bottom:1px solid var(--crm-border-weak); }
.batch-head { width:100%; padding:14px; text-align:left; font-size:14px; line-height:1.5; }
.batch-head:hover { background:var(--crm-hover-bg); }
.strong { font-weight:600; }
.number { text-align:right; font-variant-numeric:tabular-nums; }
.state { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; min-width:0; }
.issue-preview { width:100%; color:#805c16; font-size:12px; overflow-wrap:anywhere; }
.badge { color:#805c16; background:#fff3d9; padding:3px 6px; border-radius:4px; font-size:11px; }
.expand { color:var(--crm-primary); margin-left:auto; font-size:12px; white-space:nowrap; }
.mobile-label { display:none; }
.batch-detail { padding:16px; background:var(--crm-bg); border-top:1px solid var(--crm-border-weak); }
.detail-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
.detail-title { display:block; font-size:14px; font-weight:600; margin:18px 0 8px; }
.detail-heading .detail-title { margin:0; }
.detail-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; font-variant-numeric:tabular-nums; }
.boundary { margin-top:12px; }
.balance { padding:12px; margin-top:16px; background:var(--crm-surface); border:1px solid var(--crm-border); border-radius:var(--crm-radius-sm); }
.sales-grid { margin-bottom:10px; }
.evidence-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; font-size:13px; border-bottom:1px solid var(--crm-border-weak); line-height:1.6; }
.evidence-row > view:first-child { min-width:0; overflow-wrap:anywhere; }
.cycle-row { flex-wrap:wrap; }
.source-actions { display:flex; flex-wrap:wrap; gap:4px; }
.pager { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:12px; margin-top:14px; font-size:13px; }
.detail-foot { margin-top:16px; }
.empty { padding:24px 12px; text-align:center; color:var(--crm-text-muted); }
@media (max-width:900px) { .list-head, .batch-head { gap:10px; grid-template-columns:1fr 1fr 1fr 1fr 1.3fr; } }
@media (max-width:767px) {
 .truck-panel { gap:12px; }
 .filters { grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
 .filters > :last-child { align-self:end; margin-top:0; }
 .list-head { display:none; }
 .batch { margin-top:10px; border:1px solid var(--crm-border); border-radius:var(--crm-radius-sm); overflow:hidden; }
 .batch-head { padding:12px; grid-template-columns:repeat(3,minmax(0,1fr)); grid-template-areas:"vehicle state state" "in fill sale"; gap:12px; }
 .vehicle { grid-area:vehicle; }
 .state { grid-area:state; }
 .in-weight { grid-area:in; }
 .fill-weight { grid-area:fill; }
 .sale-weight { grid-area:sale; }
 .number { text-align:left; overflow-wrap:anywhere; }
 .mobile-label { display:block; }
 .detail-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
 .batch-detail { padding:12px; }
 .evidence-row { flex-wrap:wrap; align-items:flex-start; }
 .text-button { min-height:40px; }
}
</style>
