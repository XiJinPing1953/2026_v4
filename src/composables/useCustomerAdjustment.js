import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

export const CUSTOMER_ADJUSTMENT_KINDS = { rounding_reversal: '抹零冲回', prepay_writeoff: '多收款结清' }
export function adjustmentMoney(value, scale = 2) {
	return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(scale) : '待核'
}
export function adjustmentPreviewBalances(preview) {
	const balances = preview?.balances
	const fields = [['receivable_balance', '应收余额'], ['prepay_balance', '可抵扣余额'], ['net_balance', '净欠款']]
	if (!balances || fields.some(([key]) => ['before', 'after'].some(side => typeof balances[side]?.[key] !== 'number' || !Number.isFinite(balances[side][key])))) return []
	return fields.map(([key, label]) => ({ key, label, before: balances.before[key], after: balances.after[key] }))
}
export function adjustmentAmount(value, scale = 2) {
	const text = String(value ?? '').trim()
	if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`).test(text)) return null
	const amount = Number(text)
	return Number.isFinite(amount) && amount > 0 ? amount : null
}
export function adjustmentDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false
	const date = new Date(`${value}T00:00:00Z`)
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function normalizeAdjustmentSources(data) {
	if (data?.complete !== true || ![2, 3].includes(data.money_scale) || !Array.isArray(data.sources) || !Array.isArray(data.adjustments)) return null
	const keys = new Set()
	for (const source of data.sources) {
		if (!source?.source_key || source.version == null || keys.has(source.source_key) ||
			['amount', 'processed', 'available'].some(key => typeof source[key] !== 'number' || !Number.isFinite(source[key]) || source[key] < 0)) return null
		keys.add(source.source_key)
	}
	return data
}

// Server amounts and effects are displayed as returned. This composable only validates input
// and keeps the same operation identity until a possibly completed write is resolved.
export function useCustomerAdjustment({ customerId, kind, canWrite, api, storage, actorId = '', onChanged = () => {} }) {
	const form = reactive({ source_key: '', amount: '', biz_date: '', note: '', evidence: '', confirm_no_refund_or_offset: false, release_dependent_allocations: false })
	const statement = ref(null), preview = ref(null), operation = ref(null), voidTarget = ref(null)
	const loading = ref(false), busy = ref(false), issue = ref(''), loadIssue = ref('')
	let scopeGeneration = 0, readSerial = 0, destroyed = false
	const scopeKey = () => `${customerId.value}:${kind.value}`
	const storageKey = () => `crm_customer_adjustment_pending:${actorId}:${scopeKey()}`
	const sources = computed(() => statement.value?.sources || [])
	const adjustments = computed(() => (statement.value?.adjustments || []).filter(row => row.kind === kind.value))
	const pendingSources = computed(() => statement.value?.pending || [])
	const scale = computed(() => statement.value?.money_scale || 2)
	const selectedSource = computed(() => sources.value.find(row => row.source_key === form.source_key) || null)
	const unresolved = computed(() => ['submitting', 'unknown', 'retryable'].includes(operation.value?.status))
	const locked = computed(() => busy.value || unresolved.value)
	const ready = computed(() => !!statement.value && !loading.value)
	const canPreview = computed(() => canWrite.value && ready.value && !locked.value)
	const fingerprint = () => JSON.stringify([customerId.value, kind.value, form.source_key, selectedSource.value?.version, form.amount, form.biz_date, form.note, form.evidence, form.confirm_no_refund_or_offset, form.release_dependent_allocations, voidTarget.value?.id || voidTarget.value?._id || voidTarget.value?.adjustment_id || '', voidTarget.value?.version])
	const canConfirm = computed(() => canWrite.value && !locked.value && ready.value && !!preview.value && operation.value?.status === 'previewed' && operation.value.fingerprint === fingerprint())
	const capture = () => ({ key: scopeKey(), generation: scopeGeneration, storageKey: storageKey() })
	const current = scope => !destroyed && scope.key === scopeKey() && scope.generation === scopeGeneration

	async function request(action, input) {
		const response = await api[action](input)
		if (response?.code !== 0) throw Object.assign(new Error(response?.msg || '请求未完成，请重试'), { code: response?.code, data: response?.data, details: response?.details })
		return response.data
	}
	function persist(scope, value) {
		try { storage.setStorageSync(scope.storageKey, JSON.parse(JSON.stringify(value))); return true }
		catch { if (current(scope)) issue.value = '操作号未能保存到本机，暂不能提交。请检查设备存储后重试。'; return false }
	}
	function clearDraft() {
		preview.value = null; operation.value = null; voidTarget.value = null
		Object.assign(form, { source_key: '', amount: '', biz_date: '', note: '', evidence: '', confirm_no_refund_or_offset: false, release_dependent_allocations: false })
	}
	function reset() {
		if (locked.value) return
		clearDraft(); issue.value = ''
	}
	async function load() {
		const scope = capture(), serial = ++readSerial
		loading.value = true; loadIssue.value = ''; statement.value = null
		try {
			const data = await request('sources', { customer_id: customerId.value, kind: kind.value })
			if (!current(scope) || serial !== readSerial) return
			statement.value = normalizeAdjustmentSources(data)
			if (!statement.value) loadIssue.value = '来源查询未完成，暂不能登记。请刷新后重试。'
		} catch (error) { if (current(scope) && serial === readSerial) loadIssue.value = error.message }
		finally { if (current(scope) && serial === readSerial) loading.value = false }
	}
	function input() {
		if (!voidTarget.value && !adjustmentDate(form.biz_date)) throw new Error('请选择有效的业务日期。')
		if (!String(form.note).trim()) throw new Error(voidTarget.value ? '请填写作废原因。' : '请填写调整原因。')
		const base = { customer_id: customerId.value, kind: kind.value, biz_date: form.biz_date, note: form.note.trim(), evidence: form.evidence.trim() }
		if (voidTarget.value) {
			const { biz_date, ...voidBase } = base
			return { ...voidBase, void_id: voidTarget.value.id || voidTarget.value._id || voidTarget.value.adjustment_id, source_version: voidTarget.value.version, release_dependent_allocations: kind.value === 'rounding_reversal' && form.release_dependent_allocations === true }
		}
		const source = selectedSource.value, amount = adjustmentAmount(form.amount, scale.value)
		if (!source) throw new Error('请选择已核实的来源。')
		if (amount == null) throw new Error(`请输入大于零、最多 ${scale.value} 位小数的金额。`)
		if (amount > source.available) throw new Error('本次金额超过来源可用金额，请核对或刷新来源。')
		if (!base.evidence) throw new Error('请填写确认依据。')
		if (kind.value === 'prepay_writeoff' && !form.confirm_no_refund_or_offset) throw new Error('请先确认此金额不再退款，也不再抵扣以后货款。')
		return { ...base, source_key: source.source_key, source_version: source.version, amount, confirm_no_refund_or_offset: form.confirm_no_refund_or_offset }
	}
	async function prepare() {
		if (!canPreview.value) return
		const scope = capture(), before = fingerprint()
		busy.value = true; issue.value = ''; preview.value = null
		try {
			const value = input()
			const operationId = operation.value?.fingerprint === before ? operation.value.operation_id : `adjustment-${Date.now()}-${Math.random().toString(36).slice(2)}`
			const data = await request('preview', { ...value, operation_id: operationId })
			if (!current(scope) || before !== fingerprint()) return
			if (!data?.value || !data.plan_hash || !data.effects || ['receivable_delta', 'available_delta', 'income_delta', 'cash_delta'].some(key => typeof data.effects[key] !== 'number' || !Number.isFinite(data.effects[key])) || data.effects.cash_delta !== 0) throw new Error('预览数据未完整返回，请重新预览。')
			if (value.release_dependent_allocations && (!Array.isArray(data.affected_allocations) || !Array.isArray(data.receipt_effects) || data.affected_allocations.some(row => !row.allocation_id || !row.receipt_id || typeof row.amount !== 'number' || !Number.isFinite(row.amount)) || data.receipt_effects.some(row => !row.receipt_id || ['available_delta', 'rounding_delta'].some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key]))))) throw new Error('后续分配与来源变化未完整返回，暂不能作废，请重新预览。')
			preview.value = data
			operation.value = { operation_id: operationId, fingerprint: before, status: 'previewed', action: voidTarget.value ? 'void' : 'post', input: { ...data.value, customer_id: value.customer_id, kind: value.kind, operation_id: operationId, plan_hash: data.plan_hash } }
		} catch (error) { if (current(scope)) issue.value = error.message }
		finally { if (current(scope)) busy.value = false }
	}
	async function markSaved(scope, saved, pending) {
		if (saved?.status !== (pending.action === 'void' ? 'voided' : 'saved') || saved.operation_id !== pending.operation_id) throw new Error('保存结果尚未确认，请查询原操作号。')
		// Keep the resolved identity on disk if deleting storage fails; it must never look pending.
		if (!persist(scope, { ...pending, status: 'saved', result: saved })) throw new Error('已收到保存结果，但本机状态未能更新。请查询原操作号确认。')
		if (!current(scope)) return
		clearDraft(); issue.value = '已保存。'
		await load()
		if (current(scope)) onChanged(saved)
	}
	async function submit() {
		if (!canConfirm.value) return
		const scope = capture(), pending = { ...operation.value, status: 'submitting' }
		if (!persist(scope, pending)) return
		operation.value = pending
		await send(scope, pending)
	}
	async function send(scope, pending) {
		busy.value = true; issue.value = ''
		try { await markSaved(scope, await request(pending.action, pending.input), pending) }
		catch (error) {
			const rejected = [error.data?.write_status, error.data?.details?.write_status, error.details?.write_status].includes('not_written')
			const next = { ...pending, status: rejected ? 'rejected' : 'unknown' }
			persist(scope, next)
			if (current(scope)) { operation.value = next; preview.value = null; issue.value = rejected ? `${error.message} 请重新预览。` : `${error.message} 保存结果待确认，请查询原操作号。` }
		} finally { if (current(scope)) busy.value = false }
	}
	async function queryOperation() {
		if (busy.value || !unresolved.value) return
		const scope = capture(), pending = { ...operation.value }
		busy.value = true; issue.value = ''
		try {
			const data = await request('query', { customer_id: pending.input.customer_id, operation_id: pending.operation_id })
			if (['saved', 'voided'].includes(data?.status)) await markSaved(scope, data, pending)
			else if (data?.status === 'not_found') {
				const next = { ...pending, status: 'retryable' }; persist(scope, next)
				if (current(scope)) { operation.value = next; issue.value = '暂未查到已保存记录，可用原操作号重试；请勿重复新建。' }
			} else throw new Error('保存状态仍待确认，请稍后查询。')
		} catch (error) { if (current(scope)) issue.value = error.message }
		finally { if (current(scope)) busy.value = false }
	}
	async function retry() {
		if (!canWrite.value || busy.value || operation.value?.status !== 'retryable') return
		const scope = capture(), pending = { ...operation.value, status: 'submitting' }
		if (!persist(scope, pending)) return
		operation.value = pending
		await send(scope, pending)
	}
	function beginVoid(row) {
		if (!canPreview.value || row.status === 'void' || row.kind !== kind.value) return
		reset(); voidTarget.value = row
	}
	watch(fingerprint, () => { if (!unresolved.value) preview.value = null }, { flush: 'sync' })
	watch(scopeKey, async () => {
		scopeGeneration += 1; busy.value = false; clearDraft(); issue.value = ''; loadIssue.value = ''; statement.value = null
		if (!customerId.value || !CUSTOMER_ADJUSTMENT_KINDS[kind.value]) return
		try {
			const saved = storage.getStorageSync(storageKey())
			if (saved && ['submitting', 'unknown', 'retryable'].includes(saved.status) && saved.input?.customer_id === customerId.value && saved.input?.kind === kind.value && saved.operation_id && saved.input.operation_id === saved.operation_id) {
				operation.value = { ...saved, status: 'unknown' }
				Object.assign(form, saved.input, { amount: String(saved.input.amount ?? '') })
				if (saved.input.void_id) voidTarget.value = { id: saved.input.void_id, amount: saved.input.amount, version: saved.input.source_version }
				issue.value = '有一笔保存结果待确认，请先查询原操作号。'
			}
		} catch { loadIssue.value = '本机待确认操作读取失败，请恢复设备存储后重试。'; return }
		await load()
	}, { immediate: true, flush: 'sync' })
	onBeforeUnmount(() => { destroyed = true; scopeGeneration += 1 })
	return { form, statement, sources, adjustments, pendingSources, scale, selectedSource, loading, busy, issue, loadIssue, preview, operation, voidTarget, unresolved, locked, ready, canPreview, canConfirm, load, reset, prepare, submit, retry, queryOperation, beginVoid }
}
