import { computed, onBeforeUnmount, ref } from 'vue'

export const RECONCILIATION_ISSUE_TYPES = {
	mapping: '客户未对应', evidence: '证据不足', amount: '金额不同', date: '日期不同', classification: '分类不同', duplicate: '疑似重复',
	unposted: '未入账', date_difference: '日期不同', amount_difference: '金额不同',
	classification_difference: '分类不同', suspected_duplicate: '疑似重复',
	insufficient_evidence: '证据不足', internal_integrity: 'CRM 内部待核',
	unmapped: '客户未对应', source_changed: '来源变化', cache_stale: '汇总缓存过期'
}
export function reconciliationMoney(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) ? (value / 1000).toFixed(value % 10 === 0 ? 2 : 3) : '待核'
}
export function reconciliationCustomers(customers) {
	if (!Array.isArray(customers)) return []
	return customers.filter(customer => customer?._id && (!customer.settlement_customer_id || customer.settlement_customer_id === customer._id))
}
export function reconciliationReadFailed(result) {
	if (!result) return false
	if (result.check_status === 'read_failed' || result.read_complete === false || result.internal?.read_complete === false) return true
	// Older failed reads had no source snapshot, only this explicit read error.
	const issues = [result.issues, result.internal?.issues].flatMap(items => Array.isArray(items) ? items : [])
	return !result.source_hash && issues.some(problem => problem?.code === 'read_incomplete' || problem?.type === 'read_incomplete')
}
export function reconciliationNeedsCheck(result) {
	if (reconciliationReadFailed(result)) return result.retryable !== false
	return !result || !!result.stale
}
export function reconciliationLevel(result) {
	if (!result) return '尚未核查'
	if (reconciliationReadFailed(result)) return result.retryable === false ? '读取失败 · 需处理后重查' : '读取失败 · 可继续重试'
	if (result.stale) return '历史核查 · 待复核'
	if (result.issues?.some(problem => problem.blocking !== false && problem.severity !== 'info')) return result.summary_match ? '汇总一致 · 仍有待核事项' : '存在差异或资料待核'
	if (result.review?.kind === 'manual_approval' && result.review?.valid === true) return '人工核准'
	if (result.detail_match === true) return '明细一致'
	if (result.summary_match === true) return '汇总一致 · 明细待核'
	return '存在差异或资料待核'
}

// A single queue avoids saturating cloud reads. Completed results live on the server.
// Read failures remain queued; a completed read with business issues does not.
export function useReconciliationCenter({ api, canWrite = () => true }) {
	const context = ref(null), detail = ref(null), busy = ref(false), issue = ref('')
	const autoRefresh = ref(false)
	const running = ref(false), stopping = ref(false), currentCustomer = ref(''), checkedThisRun = ref(0), totalThisRun = ref(0)
	const failures = ref({}), resultByCustomer = ref({})
	let generation = 0, disposed = false, activeQueue = 0
	const customers = computed(() => reconciliationCustomers(detail.value?.customers || []))
	const pending = computed(() => customers.value.filter(customer => failures.value[customer._id] || reconciliationNeedsCheck(resultByCustomer.value[customer._id])))
	const retryableFailureCount = computed(() => customers.value.filter(customer => failures.value[customer._id] || reconciliationReadFailed(resultByCustomer.value[customer._id]) && resultByCustomer.value[customer._id].retryable !== false).length)
	const blockedReadCount = computed(() => customers.value.filter(customer => !failures.value[customer._id] && reconciliationReadFailed(resultByCustomer.value[customer._id]) && resultByCustomer.value[customer._id].retryable === false).length)
	const batch = computed(() => detail.value?.batch || null)
	function allowWrite() {
		if (canWrite()) return true
		issue.value = '当前账号可查看资料，操作需要对账中心修改权限。'
		return false
	}
	async function request(name, data) {
		const response = await api[name](data)
		if (response?.code !== 0 || response.data == null) throw new Error(response?.msg || '请求未完成，请重试。')
		return response.data
	}
	async function loadContext(company) {
		busy.value = true; issue.value = ''
		try {
			const data = await request('context', company ? { company } : {})
			if (!Array.isArray(data.batches) || !Array.isArray(data.customers)) throw new Error('对账范围未完整返回，请重试。')
			if (!disposed) context.value = data
		} catch (error) { if (!disposed) issue.value = error.message }
		finally { if (!disposed) busy.value = false }
	}
	async function openBatch(id) {
		const scope = ++generation
		stopping.value = true; running.value = false; activeQueue += 1; currentCustomer.value = ''
		checkedThisRun.value = 0; totalThisRun.value = 0
		busy.value = true; issue.value = ''; detail.value = null; resultByCustomer.value = {}; failures.value = {}
		try {
			const data = await request('getBatch', { batch_id: id })
			if (scope !== generation || disposed) return false
			if (!data.batch?._id || !Array.isArray(data.customers) || !Array.isArray(data.accounts) || !Array.isArray(data.results)) throw new Error('本批对账资料未完整返回，请重试。')
			detail.value = data
			resultByCustomer.value = Object.fromEntries(data.results.map(result => [result.customer_id, result]))
			return true
		} catch (error) { if (scope === generation && !disposed) issue.value = error.message; return false }
		finally { if (scope === generation && !disposed) { busy.value = false; stopping.value = false } }
	}
	async function checkOne(customerId, scope = generation, batchId = batch.value?._id) {
		if (!batchId || !allowWrite()) return false
		try {
			const result = await request('checkCustomer', { batch_id: batchId, customer_id: customerId, auto_refresh: autoRefresh.value === true })
			if (scope !== generation || disposed) return false
			if (result.customer_id !== customerId || !result.result_hash || !Array.isArray(result.issues)) throw new Error('本户核查结果不完整，请重试。')
			resultByCustomer.value = { ...resultByCustomer.value, [customerId]: result }
			const remaining = { ...failures.value }; delete remaining[customerId]; failures.value = remaining
			return !reconciliationReadFailed(result)
		} catch (error) {
			if (scope === generation && !disposed) failures.value = { ...failures.value, [customerId]: error.message }
			return false
		}
	}
	async function runChecks({ all = false, ids } = {}) {
		if (running.value || busy.value || !batch.value || !allowWrite()) return
		const scope = generation, queue = ++activeQueue, batchId = batch.value._id
		const wanted = ids ? new Set(ids) : null
		const rows = customers.value.filter(customer => wanted ? wanted.has(customer._id) : all || pending.value.some(item => item._id === customer._id))
		running.value = true; stopping.value = false; checkedThisRun.value = 0; totalThisRun.value = rows.length; issue.value = ''
		try {
			for (const customer of rows) {
				if (stopping.value || scope !== generation || disposed || queue !== activeQueue) break
				currentCustomer.value = customer.name
				await checkOne(customer._id, scope, batchId)
				if (scope !== generation || disposed || queue !== activeQueue) break
				checkedThisRun.value += 1
			}
		} finally {
			if (scope === generation && !disposed && queue === activeQueue) { running.value = false; currentCustomer.value = ''; stopping.value = false }
		}
	}
	function pause() { stopping.value = true }
	async function importBatch(data) {
		if (busy.value || running.value || !allowWrite()) return false
		busy.value = true; issue.value = ''
		let imported
		try { imported = await request('importBatch', data); if (!imported.batch?._id) throw new Error('导入结果未确认，请使用同一文件重试。') }
		catch (error) { issue.value = error.message; return false }
		finally { busy.value = false }
		await loadContext(data.company)
		return await openBatch(imported.batch._id)
	}
	async function saveMapping(data) {
		if (busy.value || running.value || !batch.value || !allowWrite()) return false
		const id = batch.value._id
		busy.value = true; issue.value = ''
		try { await request('saveMapping', { company: batch.value.company, ...data }) }
		catch (error) { issue.value = error.message; return false }
		finally { busy.value = false }
		if (await openBatch(id)) await runChecks({ ids: [data.customer_id] })
		return true
	}
	async function importDetail(data) {
		if (busy.value || running.value || !batch.value || !allowWrite()) return false
		const id = batch.value._id
		busy.value = true; issue.value = ''
		try { await request('importDetail', { batch_id: id, ...data }) }
		catch (error) { issue.value = error.message; return false }
		finally { busy.value = false }
		const linked = (detail.value.mappings?.items || []).filter(mapping => mapping.accountant_codes.includes(data.accountant_code)).map(mapping => mapping.crm_customer_id)
		if (await openBatch(id)) await runChecks({ ids: linked })
		return true
	}
	async function reviewCustomer(data) {
		if (busy.value || running.value || !batch.value || !allowWrite()) return false
		const scope = generation, id = batch.value._id
		busy.value = true; issue.value = ''
		try {
			await request('reviewCustomer', { batch_id: id, ...data })
			return await checkOne(data.customer_id, scope, id)
		} catch (error) { if (scope === generation && !disposed) issue.value = error.message; return false }
		finally { if (scope === generation && !disposed) busy.value = false }
	}
	onBeforeUnmount(() => { disposed = true; generation += 1; activeQueue += 1; stopping.value = true })
	return { context, detail, batch, customers, pending, retryableFailureCount, blockedReadCount, resultByCustomer, autoRefresh, busy, issue, running, stopping, currentCustomer, checkedThisRun, totalThisRun, failures, loadContext, openBatch, checkOne, runChecks, pause, importBatch, saveMapping, importDetail, reviewCustomer, request }
}
