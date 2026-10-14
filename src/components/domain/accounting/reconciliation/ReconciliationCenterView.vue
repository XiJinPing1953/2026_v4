<template>
	<AppPage title="对账中心" subtitle="导入报表 · 核查差异 · 处理后复核" icon="search" hide-bottle-query>
		<template #headerActions><AppButton size="sm" kind="neutral" :disabled="blocked" @click="refresh">刷新批次</AppButton><AppButton size="sm" :disabled="writeBlocked" @click="showImport = !showImport">导入好会计报表</AppButton></template>
		<view v-if="!canRead" class="notice">对账中心仅供财务、管理员和超级管理员使用。</view>
		<view v-else class="center-shell">
			<view v-if="issue" class="notice" role="alert">{{ issue }}</view>
			<text v-if="!canWrite" class="hint">当前账号可查看资料，操作需要对账中心修改权限。</text>
			<AppSection v-if="showImport || !context?.batches?.length" title="导入应收统计表">
				<text class="hint">选择好会计完整导出的报表，确认账套及已经入账的截止日。本版核对同年年初至截止日。导入后先确认客户对应，再开始核查。</text>
				<view class="import-fields"><AppInput v-model="importForm.company" label="好会计账套名称" placeholder="与报表上的公司名称一致" :disabled="writeBlocked" /><picker mode="date" :value="importForm.cutoff" :disabled="writeBlocked" @change="importForm.cutoff = $event.detail.value"><AppInput class="picker-trigger" label="好会计入账截止日" :model-value="importForm.cutoff" placeholder="请选择确认的截止日" readonly /></picker></view>
				<view class="actions"><AppButton size="sm" kind="neutral" :disabled="writeBlocked" @click="chooseSummary">{{ summaryFile ? '更换文件' : '选择 .xls / .xlsx' }}</AppButton><text class="file-name">{{ summaryFile?.name || '原始文件将随本批保留，单文件不超过 2 MB。' }}</text><AppButton size="sm" :disabled="writeBlocked || !summaryFile" @click="startImport">导入报表</AppButton></view>
			</AppSection>
			<view class="workspace">
				<AppSection title="对账批次" class="batch-column">
					<text v-if="busy && !context" class="hint">正在读取批次…</text>
					<text v-else-if="!context?.batches?.length" class="hint">尚未导入报表。首次导入后，确认客户与会计科目的对应关系。</text>
					<view v-for="item in context?.batches || []" :key="item._id" class="batch-card" :class="{ 'batch-card--selected': batch?._id === item._id }">
						<text class="batch-name">{{ item.company }}</text><text class="hint">资料截至 {{ item.cutoff }}</text><text class="file-name">{{ item.source?.name }}</text>
						<AppButton size="sm" kind="ghost" :disabled="blocked" @click="selectBatch(item._id)">{{ batch?._id === item._id ? '当前批次' : '查看本批' }}</AppButton>
					</view>
				</AppSection>
				<view class="work-column">
					<AppSection v-if="batch" :title="batch.company">
						<template #actions><AppButton size="sm" kind="ghost" :disabled="blocked || !batch.source?.source_id && !batch.source?._id && !batch.source_id" @click="download(batch.source?.source_id || batch.source?._id || batch.source_id)">下载原始报表</AppButton></template>
						<view class="scope-line"><text class="scope-date">好会计资料截至 {{ batch.cutoff }}</text><text class="hint">核对 {{ batch.cutoff?.slice(0, 4) }}-01-01 至 {{ batch.cutoff }}</text></view>
						<view class="counts"><view><text class="count-value">{{ customers.length }}</text><text>结算客户</text></view><view><text class="count-value">{{ pending.length }}</text><text>尚待核查</text></view><view><text class="count-value">{{ differenceCount }}</text><text>差异或待核</text></view><view><text class="count-value">{{ matchedCount }}</text><text>汇总一致</text></view></view>
						<text class="hint">先在“查看与处理”中确认客户对应，再发起核查。包含隐藏及停用客户，别名归并到结算客户。</text>
						<checkbox-group @change="autoRefresh = $event.detail.value.includes('auto_refresh')"><label class="cache-toggle"><checkbox value="auto_refresh" :checked="autoRefresh" :disabled="writeBlocked" /><text>自动刷新核验通过的客户汇总</text></label></checkbox-group>
						<view class="actions"><AppButton v-if="!running" size="sm" :disabled="writeBlocked || !pending.length" @click="runChecks()">继续未完成核查</AppButton><AppButton v-if="!running" size="sm" kind="neutral" :disabled="writeBlocked" @click="runChecks({ all: true })">重新核查本批全部客户</AppButton><AppButton v-else size="sm" kind="neutral" :disabled="stopping" @click="pause">{{ stopping ? '本户完成后暂停' : '暂停核查' }}</AppButton></view>
						<view v-if="totalThisRun" class="progress" role="status" aria-live="polite"><text>{{ running ? '正在核查' : '本轮已尝试' }} {{ checkedThisRun }} / {{ totalThisRun }}<template v-if="currentCustomer"> · {{ currentCustomer }}</template></text><view class="progress-track"><view class="progress-fill" :style="{ width: Math.round(checkedThisRun / totalThisRun * 100) + '%' }" /></view></view>
						<text v-if="retryableFailureCount" class="warning">{{ retryableFailureCount }} 户读取未完成，可点“继续未完成核查”重试。</text><text v-if="blockedReadCount" class="warning">{{ blockedReadCount }} 户读取失败，须先处理权限等原因，再重新核查。</text>
					</AppSection>
					<AppSection v-if="batch" title="客户核查与差异待办">
						<view class="filters"><AppInput v-model="search" label="客户" placeholder="搜索客户名称" size="sm" /><picker :range="statusFilters" range-key="label" :value="statusFilterIndex" @change="statusFilter = statusFilters[Number($event.detail.value)].value"><AppInput class="picker-trigger" label="核查状态" :model-value="statusFilters[statusFilterIndex].label" readonly size="sm" /></picker><picker :range="issueFilters" range-key="label" :value="issueFilterIndex" @change="issueFilter = issueFilters[Number($event.detail.value)].value"><AppInput class="picker-trigger" label="问题类型" :model-value="issueFilters[issueFilterIndex].label" readonly size="sm" /></picker></view>
						<text class="hint">显示 {{ filteredCustomers.length }} / {{ customers.length }} 户 · 处理后仍需复核，备注不会自动关闭差异。</text>
						<view v-for="customer in filteredCustomers" :key="customer._id" class="customer-row">
							<view class="customer-main"><view class="customer-title"><text>{{ customer.name }}</text><AppTag v-if="customer.is_hidden" kind="soft">隐藏</AppTag><AppTag v-if="customer.is_active === false" kind="soft">停用</AppTag></view><text class="hint">{{ mappingText(customer._id) }}</text><text :class="rowHasIssue(customer._id) ? 'warning' : !resultByCustomer[customer._id] ? 'hint' : 'level'">{{ failures[customer._id] ? '读取未完成 · 可继续重试' : level(resultByCustomer[customer._id]) }}</text><text v-if="resultByCustomer[customer._id]?.review?.kind === 'accounting_followup'" class="hint">好会计待处理 · 重新导入后验证</text></view>
							<view class="row-actions"><text v-if="resultByCustomer[customer._id]?.comparison?.difference" class="amount">期末差额 ¥{{ money(resultByCustomer[customer._id].comparison.difference.closing_milli) }}</text><AppButton size="sm" kind="neutral" :disabled="busy" @click="openCustomer(customer)">查看与处理</AppButton></view>
						</view>
						<text v-if="!filteredCustomers.length" class="empty">没有符合当前筛选的客户。</text>
					</AppSection>
					<AppSection v-if="batch" :title="'未对应的会计科目 · ' + unmappedAccounts.length">
						<text class="hint">每个科目须明确对应结算客户。名称相同仅供参考，不自动确认。</text><AppButton v-if="unmappedAccounts.length" size="sm" kind="ghost" @click="showUnmapped = !showUnmapped">{{ showUnmapped ? '收起' : '展开查看' }}</AppButton>
						<view v-if="showUnmapped" class="account-list"><view v-for="account in unmappedAccounts" :key="account.code" class="account-row"><text>{{ account.code }} · {{ account.name }}</text><text>期末 ¥{{ money(account.closing_milli) }}</text></view></view>
					</AppSection>
					<view v-if="!batch && context?.batches?.length && !busy" class="empty">选择一个批次，查看核查结果与差异。</view>
				</view>
			</view>
		</view>
		<AppModal v-model="customerOpen" :title="selectedCustomer?.name || '客户核查'" class="customer-modal">
			<view v-if="selectedCustomer" class="customer-detail">
				<view v-if="issue" class="notice" role="alert">{{ issue }}</view>
				<text class="hint">资料截至 {{ batch?.cutoff }} · {{ level(selectedResult) }}</text>
				<text v-if="failures[selectedCustomer._id]" class="notice">{{ failures[selectedCustomer._id] }}</text>
				<text v-if="readFailed(selectedResult)" class="notice">{{ selectedResult.read_failure?.message || '原始资料读取未完成，本次不能判断账务是否一致。' }}</text>
				<view class="actions"><AppButton size="sm" kind="neutral" :disabled="writeBlocked" @click="recheckSelected">重新核查本户</AppButton><AppButton size="sm" kind="ghost" @click="editMapping = !editMapping">{{ editMapping ? '收起客户对应' : '确认客户对应' }}</AppButton></view>
				<view v-if="editMapping" class="sub-panel">
					<text class="section-title">对应好会计科目</text><text class="hint">可选多个科目；已对应其他客户的科目不能重复使用。</text><AppInput v-model="accountSearch" placeholder="搜索科目编码或名称" label="科目" size="sm" />
					<checkbox-group class="mapping-list" @change="mappingCodes = $event.detail.value"><label v-for="account in availableAccounts" :key="account.code" class="mapping-option"><checkbox :value="account.code" :checked="mappingCodes.includes(account.code)" :disabled="writeBlocked || !!account.owner" /><text>{{ account.code }} · {{ account.name }}<text v-if="account.owner">（已对应 {{ account.owner }}）</text></text></label></checkbox-group>
					<text class="hint">已选：{{ mappingCodes.join('、') || '未选择' }}</text><AppInput v-model="mappingBasis" label="对应或解除依据" placeholder="已确认的客户档案、科目明细等" :disabled="writeBlocked" /><view class="actions"><AppButton size="sm" :disabled="writeBlocked || !mappingCodes.length || !mappingBasis.trim()" @click="confirmMapping">保存对应并复核</AppButton><AppButton v-if="selectedMapping?.accountant_codes?.length" size="sm" kind="neutral" :disabled="writeBlocked || !mappingBasis.trim()" @click="confirmMapping(true)">解除对应关系</AppButton></view><text v-if="selectedMapping?.accountant_codes?.length" class="hint">解除后本户回到待对应状态，再确认正确客户。账务记录保留。</text>
				</view>
				<view v-if="selectedResult?.comparison" class="sub-panel"><text class="section-title">四项控制数</text><view class="comparison-header"><text>项目</text><text>CRM</text><text>好会计</text><text>差额</text></view><view v-for="field in controls" :key="field.key" class="comparison-row"><text>{{ field.label }}</text><text>{{ money(selectedResult.comparison.crm?.[field.key]) }}</text><text>{{ money(selectedResult.comparison.accounting?.[field.key]) }}</text><text>{{ money(selectedResult.comparison.difference?.[field.key]) }}</text></view></view>
				<view class="sub-panel">
					<text class="section-title">检查提示与依据</text>
					<text v-if="!selectedResult" class="hint">本户尚未核查，不能判断是否一致。</text>
					<text v-else-if="readFailed(selectedResult)" class="hint">资料未读全，以下仅展示已返回的依据。</text>
					<text v-else-if="!selectedProblems.length" class="hint">当前规则未发现待核差异。{{ selectedResult.detail_match ? '明细已比对。' : '尚未完成逐笔明细核对。' }}</text>
					<text v-if="selectedProblems.length" class="hint">共 {{ selectedProblems.length }} 条检查提示，不代表 {{ selectedProblems.length }} 笔错账。同一原单可能触发多条规则；对应候选仍需凭据确认。</text>
					<view v-for="(problem, index) in selectedProblems" :key="index" class="problem">
						<AppTag kind="warning">{{ problem.category }}</AppTag>
						<view v-for="(record, recordIndex) in problem.records" :key="recordIndex" class="problem-record">
							<text class="problem-record-title">{{ record.side }} · {{ record.date }} · {{ record.business }}</text>
							<text class="problem-amount">{{ record.amount }}</text>
							<text v-if="record.reference" class="hint">{{ record.reference }}</text>
							<text v-if="record.summary" class="hint">原始摘要：{{ record.summary }}</text>
						</view>
						<text v-for="comparison in problem.comparisons" :key="comparison" class="problem-amount">{{ comparison }}</text>
						<text><text class="problem-caption">查到了什么：</text>{{ problem.finding }}</text>
						<text><text class="problem-caption">还需核对：</text>{{ problem.missing }}</text>
						<text><text class="problem-caption">先处理哪边：</text>{{ problem.handling }}</text>
						<AppButton size="sm" kind="ghost" :aria-expanded="!!expandedDiagnostics[index]" @click="expandedDiagnostics[index] = !expandedDiagnostics[index]">{{ expandedDiagnostics[index] ? '收起技术详情' : '技术详情' }}</AppButton>
						<text v-if="expandedDiagnostics[index]" class="evidence" selectable>{{ problem.diagnostic }}</text>
					</view>
				</view>
				<view v-if="selectedResult?.cache_refresh" class="hint">汇总缓存：{{ cacheStatus(selectedResult.cache_refresh) }}</view>
				<view class="sub-panel"><text class="section-title">好会计明细账</text><text class="hint">逐个导入已对应科目的完整明细账。与本批相同期间，用于定位逐笔差异。</text><view v-for="code in selectedMapping?.accountant_codes || []" :key="code" class="account-row"><text>{{ accountName(code) }}</text><AppButton size="sm" kind="neutral" :disabled="writeBlocked" @click="uploadDetail(code)">导入明细账</AppButton></view><text v-if="!selectedMapping?.accountant_codes?.length" class="hint">先确认客户对应，才能导入该客户明细。</text><view v-for="source in selectedDetailSources" :key="source._id || source.source_id" class="account-row"><text class="file-name">{{ source.name || source.source?.name }}</text><AppButton size="sm" kind="ghost" :disabled="blocked" @click="download(source.source_id || source._id || source.source?.source_id)">下载原始明细</AppButton></view></view>
				<view v-if="selectedResult" class="sub-panel"><text class="section-title">记录处理依据</text><text v-if="selectedResult.review" class="hint">{{ selectedResult.review.kind === 'manual_approval' ? (selectedResult.review.valid ? '已人工核准' : '原核准已失效') : '已记好会计待办' }}：{{ selectedResult.review.basis }}</text><AppInput v-model="reviewBasis" label="核准或待办依据" placeholder="核对凭据、差异处理意见等" :disabled="writeBlocked" /><view class="actions"><AppButton size="sm" kind="neutral" :disabled="writeBlocked || !reviewBasis.trim() || !currentResult(selectedCustomer._id)" @click="saveReview('accounting_followup')">记录好会计待办</AppButton><AppButton size="sm" :disabled="writeBlocked || !reviewBasis.trim() || !canApprove" @click="saveReview('manual_approval')">确认人工核准</AppButton></view><text class="hint">好会计待办保留差异，须在会计处理后重新导入报表验证。来源变化后，原核准须重新复核。</text></view>
				<view v-if="selectedResult && currentResult(selectedCustomer._id)" class="sub-panel"><text class="section-title">通用财务处理</text><text class="hint">根据已核实事实选择处理方式；同类问题可直接复用。每项先预览，再确认。</text><view class="actions"><AppButton size="sm" kind="neutral" :disabled="writeBlocked" @click="repairKind = 'rounding_reversal'">抹零冲回</AppButton><AppButton size="sm" kind="neutral" :disabled="writeBlocked" @click="repairKind = 'prepay_writeoff'">多收款结清</AppButton><AppButton v-if="canRepairLegacy" size="sm" kind="neutral" :disabled="writeBlocked" @click="repairKind = 'legacy'">日期或收款依据修正</AppButton></view><text v-if="!canRepairLegacy" class="hint">原收款日期及同笔收款依据修正由超级管理员处理。</text><text v-if="repairKind" class="hint">处理完成后，本户将重新核查。</text><CustomerAdjustmentPanel v-if="canWrite && (repairKind === 'rounding_reversal' || repairKind === 'prepay_writeoff')" :key="selectedCustomer._id + repairKind" :customer-id="selectedCustomer._id" :kind="repairKind" @changed="recheckSelected" /><ReconciliationRepairPanel v-if="canWrite && repairKind === 'legacy' && canRepairLegacy" :customer-id="selectedCustomer._id" :batch-id="batch._id" :result-hash="selectedResult.result_hash" @changed="recheckSelected" /></view>
				<view v-if="selectedResult" class="result-reference"><text class="reference">最近核查 {{ timeText(selectedResult.checked_at) }}</text><AppButton size="sm" kind="ghost" :aria-expanded="resultDiagnosticOpen" @click="resultDiagnosticOpen = !resultDiagnosticOpen">{{ resultDiagnosticOpen ? '收起核查技术信息' : '核查技术信息' }}</AppButton><text v-if="resultDiagnosticOpen" class="reference" selectable>结果编号 {{ selectedResult.result_hash }}</text></view>
			</view>
		</AppModal>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppModal from '@/components/base/AppModal.vue'
import CustomerAdjustmentPanel from '@/components/domain/customer/statement/CustomerAdjustmentPanel.vue'
import ReconciliationRepairPanel from './ReconciliationRepairPanel.vue'
import { getRoleTemplate } from '@/services/auth'
import { canPageAction } from '@/services/pageAcl'
import { reconciliationApi } from '@/services/api/reconciliation'
import { pickReconciliationWorkbook, downloadReconciliationSource } from '@/services/reconciliationFiles'
import { useReconciliationCenter, reconciliationMoney as money, reconciliationLevel as level, reconciliationReadFailed as readFailed } from '@/composables/useReconciliationCenter'
import { presentReconciliationIssue, reconciliationIssueType as problemLabel } from '@/services/mappers/reconciliationIssue'

const canRead = computed(() => ['finance', 'admin', 'superadmin'].includes(getRoleTemplate()) && canPageAction('/pages/accounting/reconciliation-center', 'view'))
const canWrite = computed(() => canRead.value && canPageAction('/pages/accounting/reconciliation-center', 'update'))
const canRepairLegacy = computed(() => getRoleTemplate() === 'superadmin')
const { context, detail, batch, customers, pending, retryableFailureCount, blockedReadCount, resultByCustomer, autoRefresh, busy, issue, running, stopping, currentCustomer, checkedThisRun, totalThisRun, failures, loadContext, openBatch, runChecks, pause, importBatch, saveMapping, importDetail, reviewCustomer, request } = useReconciliationCenter({ api: reconciliationApi, canWrite: () => canWrite.value })
const blocked = computed(() => busy.value || running.value)
const writeBlocked = computed(() => blocked.value || !canWrite.value)
const showImport = ref(false), summaryFile = ref(null), importForm = reactive({ company: '', cutoff: '' })
const search = ref(''), statusFilter = ref('all'), issueFilter = ref('all'), showUnmapped = ref(false)
const customerOpen = ref(false), selectedCustomer = ref(null), editMapping = ref(false), accountSearch = ref(''), mappingCodes = ref([]), mappingBasis = ref(''), reviewBasis = ref(''), repairKind = ref('')
const expandedDiagnostics = ref({}), resultDiagnosticOpen = ref(false)
let importIdentity = null
const controls = [{ key: 'opening_milli', label: '期初' }, { key: 'debit_milli', label: '发生' }, { key: 'credit_milli', label: '收回' }, { key: 'closing_milli', label: '期末' }]
const statusFilters = [{ value: 'all', label: '全部客户' }, { value: 'pending', label: '尚未完成 / 待复核' }, { value: 'read_failed', label: '读取失败' }, { value: 'difference', label: '有差异或待核' }, { value: 'summary', label: '汇总一致' }, { value: 'detail', label: '明细一致' }, { value: 'approved', label: '人工核准' }, { value: 'followup', label: '好会计待办' }]
const statusFilterIndex = computed(() => Math.max(0, statusFilters.findIndex(item => item.value === statusFilter.value)))
const issueFilters = computed(() => [{ value: 'all', label: '全部问题类型' }, ...[...new Set(Object.values(resultByCustomer.value).flatMap(result => result.issues || []).map(problem => problem.type))].filter(Boolean).sort().map(type => ({ value: type, label: problemLabel(type) }))])
const issueFilterIndex = computed(() => Math.max(0, issueFilters.value.findIndex(item => item.value === issueFilter.value)))
const mapping = id => (detail.value?.mappings?.items || []).find(item => item.crm_customer_id === id)
const rowHasIssue = id => !!failures.value[id] || readFailed(resultByCustomer.value[id]) || !!resultByCustomer.value[id]?.stale || resultByCustomer.value[id]?.issues?.some(problem => problem.blocking !== false && problem.severity !== 'info') || resultByCustomer.value[id]?.summary_match === false
const differenceCount = computed(() => customers.value.filter(customer => rowHasIssue(customer._id)).length)
const currentResult = id => !!resultByCustomer.value[id] && !resultByCustomer.value[id].stale && !readFailed(resultByCustomer.value[id]) && !failures.value[id]
const matchedCount = computed(() => customers.value.filter(customer => resultByCustomer.value[customer._id]?.summary_match === true && currentResult(customer._id)).length)
const filteredCustomers = computed(() => customers.value.filter(customer => {
	const result = resultByCustomer.value[customer._id]
	if (search.value.trim() && !customer.name?.includes(search.value.trim())) return false
	if (issueFilter.value !== 'all' && !result?.issues?.some(problem => problem.type === issueFilter.value)) return false
	if (statusFilter.value === 'pending') return pending.value.some(item => item._id === customer._id)
	if (statusFilter.value === 'read_failed') return readFailed(result) || failures.value[customer._id]
	if (statusFilter.value === 'difference') return rowHasIssue(customer._id)
	if (statusFilter.value === 'summary') return result?.summary_match && currentResult(customer._id)
	if (statusFilter.value === 'detail') return result?.detail_match && currentResult(customer._id)
	if (statusFilter.value === 'approved') return result?.review?.kind === 'manual_approval' && result.review.valid && currentResult(customer._id)
	if (statusFilter.value === 'followup') return result?.review?.kind === 'accounting_followup'
	return true
}))
const unmappedAccounts = computed(() => { const codes = new Set((detail.value?.mappings?.items || []).flatMap(item => item.accountant_codes)); return (detail.value?.accounts || []).filter(account => !codes.has(account.code)) })
const selectedResult = computed(() => resultByCustomer.value[selectedCustomer.value?._id] || null)
const selectedProblems = computed(() => (selectedResult.value?.issues || []).map(presentReconciliationIssue))
watch(selectedResult, () => { expandedDiagnostics.value = {}; resultDiagnosticOpen.value = false })
const selectedMapping = computed(() => mapping(selectedCustomer.value?._id))
const selectedDetailSources = computed(() => (detail.value?.detail_sources || []).filter(source => selectedMapping.value?.accountant_codes.includes(source.accountant_code)))
const canApprove = computed(() => selectedResult.value?.summary_match === true && selectedResult.value?.internal?.complete === true && selectedResult.value?.detail_match !== false && currentResult(selectedCustomer.value?._id) && !selectedResult.value?.issues?.some(problem => problem.blocking !== false && problem.severity !== 'info'))
const availableAccounts = computed(() => (detail.value?.accounts || []).map(account => {
	const owner = (detail.value?.mappings?.items || []).find(item => item.crm_customer_id !== selectedCustomer.value?._id && item.accountant_codes.includes(account.code))
	return { ...account, owner: owner ? (customers.value.find(customer => customer._id === owner.crm_customer_id)?.name || owner.crm_customer_id) : '' }
}).filter(account => !accountSearch.value.trim() || `${account.code} ${account.name}`.includes(accountSearch.value.trim()) || mappingCodes.value.includes(account.code)))

function mappingText(id) { const item = mapping(id); return item?.accountant_codes?.length ? `好会计科目 ${item.accountant_codes.join('、')}` : '尚未确认好会计科目' }
function accountName(code) { const account = detail.value?.accounts.find(item => item.code === code); return account ? `${code} · ${account.name}` : code }
function timeText(value) { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间待核' }
function cacheStatus(value) { if (value.status === 'refreshed' || value.refreshed === true) return '已校验并刷新，前后值已留存'; if (value.status === 'unchanged' || value.status === 'current') return '与原始账务一致'; return value.message || '待核，未自动改写' }
async function refresh() { if (!canRead.value) return; const id = batch.value?._id; await loadContext(); if (id) await openBatch(id) }
async function selectBatch(id) { customerOpen.value = false; repairKind.value = ''; await openBatch(id) }
async function chooseSummary() { if (writeBlocked.value) return; try { const file = await pickReconciliationWorkbook(); if (file) { summaryFile.value = file; importIdentity = null } } catch (error) { issue.value = error.message } }
async function startImport() {
	if (writeBlocked.value) return
	if (!summaryFile.value || !importForm.company.trim() || !importForm.cutoff) { issue.value = '请选择完整报表，并填写账套和确认的入账截止日。'; return }
	const signature = JSON.stringify([summaryFile.value.name, summaryFile.value.base64, importForm.company.trim(), importForm.cutoff])
	if (importIdentity?.signature !== signature) importIdentity = { signature, id: `reconcile-import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
	const success = await importBatch({ operation_id: importIdentity.id, company: importForm.company.trim(), cutoff: importForm.cutoff, source: { name: summaryFile.value.name, base64: summaryFile.value.base64 } })
	if (success) { showImport.value = false; summaryFile.value = null; importIdentity = null }
}
function openCustomer(customer) { selectedCustomer.value = customer; expandedDiagnostics.value = {}; resultDiagnosticOpen.value = false; editMapping.value = !mapping(customer._id); mappingCodes.value = [...(mapping(customer._id)?.accountant_codes || [])]; mappingBasis.value = mapping(customer._id)?.basis || ''; accountSearch.value = ''; reviewBasis.value = ''; repairKind.value = ''; customerOpen.value = true }
async function confirmMapping(unlink = false) { const id = selectedCustomer.value._id; if (await saveMapping({ customer_id: id, accountant_codes: unlink === true ? [] : [...mappingCodes.value], basis: mappingBasis.value.trim(), expected_version: detail.value.mappings.version })) { editMapping.value = false; mappingCodes.value = [...(mapping(id)?.accountant_codes || [])] } }
async function recheckSelected() { if (selectedCustomer.value) await runChecks({ ids: [selectedCustomer.value._id] }) }
async function uploadDetail(code) { if (writeBlocked.value) return; try { const file = await pickReconciliationWorkbook(); if (file) await importDetail({ accountant_code: code, source: { name: file.name, base64: file.base64 } }) } catch (error) { issue.value = error.message } }
async function saveReview(kind) { if (await reviewCustomer({ customer_id: selectedCustomer.value._id, expected_result_hash: selectedResult.value.result_hash, kind, basis: reviewBasis.value.trim() })) reviewBasis.value = '' }
async function download(id) { if (!id) return; try { downloadReconciliationSource(await request('downloadSource', { source_id: id })) } catch (error) { issue.value = error.message } }
onMounted(async () => { if (!canRead.value) return; await loadContext(); if (context.value?.batches?.length) await openBatch(context.value.batches[0]._id) })
</script>

<style scoped>
/* H5 moves picker popups under uni-app, outside the scoped modal subtree. */
:global(uni-app:has(.customer-modal.app-modal-backdrop) > .uni-picker-container) { z-index:1101; }
.picker-trigger { pointer-events:none; }
.center-shell,.work-column,.customer-detail { display:flex; flex-direction:column; gap:18px; min-width:0; }
.workspace { display:grid; grid-template-columns:260px minmax(0,1fr); align-items:start; gap:18px; }
.import-fields,.filters { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin:16px 0; }
.filters { grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:0; }
.hint,.file-name,.reference { color:var(--crm-text-muted); font-size:13px; line-height:1.65; overflow-wrap:anywhere; }
.hint { display:block; }
.file-name { flex:1; min-width:0; }
.notice { color:#9c4c0b; background:#fff7e9; border:1px solid #edd9b9; border-radius:8px; padding:12px 16px; font-size:14px; line-height:1.7; overflow-wrap:anywhere; }
.cache-toggle { display:flex; align-items:center; gap:8px; font-size:13px; line-height:1.6; color:var(--crm-text-muted); }
.actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:12px; }
.batch-card { padding:14px 0; display:flex; flex-direction:column; gap:6px; border-bottom:1px solid var(--crm-border); min-width:0; }
.batch-card:first-child { padding-top:0; }.batch-card:last-child { border-bottom:0; padding-bottom:0; }.batch-card--selected .batch-name { color:var(--crm-primary); }
.batch-name,.scope-date,.section-title { font-weight:600; line-height:1.55; overflow-wrap:anywhere; }
.scope-line { display:flex; flex-wrap:wrap; align-items:center; gap:12px; }
.counts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:20px 0; }
.counts>view { display:flex; flex-direction:column; gap:7px; color:var(--crm-text-muted); font-size:13px; }
.count-value { font-size:27px; color:var(--crm-text); font-variant-numeric:tabular-nums; }
.progress { margin-top:14px; display:flex; flex-direction:column; gap:8px; font-size:13px; line-height:1.6; }
.progress-track { height:5px; background:#edf1f5; border-radius:4px; overflow:hidden; }.progress-fill { height:100%; background:var(--crm-primary); transition:width .15s; }
.customer-row { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:17px 0; border-bottom:1px solid var(--crm-border-weak); }
.customer-main { display:flex; flex-direction:column; gap:6px; min-width:0; }.customer-title { display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-weight:600; overflow-wrap:anywhere; }
.row-actions { display:flex; align-items:flex-end; flex-direction:column; gap:10px; min-width:0; }.amount { font-variant-numeric:tabular-nums; font-size:13px; overflow-wrap:anywhere; }
.warning { color:#995300; font-size:13px; line-height:1.6; }.level { color:#276248; font-size:13px; line-height:1.6; }
.empty { display:block; padding:28px 12px; color:var(--crm-text-muted); text-align:center; font-size:14px; line-height:1.6; }
.account-list { display:flex; flex-direction:column; margin-top:12px; }.account-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:10px 0; font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.customer-modal :deep(.app-modal) { width:860px; }.sub-panel { display:flex; flex-direction:column; gap:12px; padding-top:18px; border-top:1px solid var(--crm-border); min-width:0; }
.comparison-header,.comparison-row { display:grid; grid-template-columns:.65fr repeat(3,minmax(0,1fr)); gap:10px; font-size:13px; line-height:1.6; font-variant-numeric:tabular-nums; }.comparison-header { color:var(--crm-text-muted); }.comparison-row>*,.comparison-header>* { overflow-wrap:anywhere; }.comparison-row>:not(:first-child),.comparison-header>:not(:first-child) { text-align:right; }
.mapping-list { display:flex; flex-direction:column; max-height:260px; overflow:auto; gap:10px; }.mapping-option { display:flex; align-items:flex-start; gap:8px; font-size:14px; line-height:1.7; overflow-wrap:anywhere; }.mapping-option checkbox { flex:none; }
.problem { display:flex; align-items:flex-start; flex-direction:column; gap:10px; padding:14px; background:#f8fafc; border-radius:8px; font-size:14px; line-height:1.65; min-width:0; overflow-wrap:anywhere; }.problem-record { display:flex; flex-direction:column; gap:4px; width:100%; min-width:0; }.problem-record + .problem-record { padding-top:8px; border-top:1px solid var(--crm-border-weak); }.problem-record-title,.problem-caption { font-weight:600; }.problem-amount { font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }.result-reference { display:flex; align-items:flex-start; flex-direction:column; gap:8px; min-width:0; }.evidence { max-width:100%; white-space:pre-wrap; font-size:12px; color:var(--crm-text-muted); overflow-wrap:anywhere; }
@media(max-width:1000px) { .workspace { grid-template-columns:220px minmax(0,1fr); }.filters { grid-template-columns:1fr 1fr; }.filters>:first-child { grid-column:1/-1; } }
@media(max-width:700px) { .workspace { display:flex; flex-direction:column; }.batch-column,.work-column { width:100%; }.batch-column :deep(.section__body) { display:flex; flex-wrap:wrap; gap:12px; }.batch-card { flex:1 1 200px; border:1px solid var(--crm-border); padding:12px!important; border-radius:7px; }.batch-card:last-child { border:1px solid var(--crm-border); }.import-fields,.filters { grid-template-columns:1fr; }.counts { grid-template-columns:repeat(2,minmax(0,1fr)); }.customer-row { align-items:flex-start; }.row-actions { max-width:45%; }.comparison-header,.comparison-row { gap:6px; font-size:12px; }.actions :deep(.btn) { max-width:100%; min-height:44px; height:auto; padding:10px 12px; line-height:1.5; }.actions :deep(.btn__inner) { white-space:normal; }.customer-detail { gap:14px; } }
@media(max-width:390px) { .customer-row { flex-direction:column; }.row-actions { max-width:100%; width:100%; flex-direction:row; align-items:center; justify-content:space-between; } }
</style>
