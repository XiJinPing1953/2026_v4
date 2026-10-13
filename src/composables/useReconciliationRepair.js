import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

export function useReconciliationRepair({ customerId, batchId, resultHash, api, storage, actorId, onChanged }) {
	const sources = ref(null), operation = ref(null), loading = ref(false), busy = ref(false), issue = ref('')
	const form = reactive({ type: 'correct_receipt_date', receipt_id: '', biz_date: '', basis: '', confirmed_total_amount: '', targets: [] })
	let serial = 0, disposed = false
	const key = () => `crm_reconciliation_repair:${actorId}:${batchId.value}:${customerId.value}`
	const fingerprint = () => JSON.stringify([batchId.value, customerId.value, resultHash.value, form])
	const unresolved = computed(() => ['preparing', 'executing', 'unknown', 'not_prepared', 'committed_pending'].includes(operation.value?.status))
	const locked = computed(() => busy.value || unresolved.value)
	const canConfirm = computed(() => !locked.value && operation.value?.status === 'prepared' && !!operation.value?.preview?.plan_hash && operation.value.fingerprint === fingerprint())
	const receipt = computed(() => sources.value?.receipts.find(item => item._id === form.receipt_id))
	const captured = () => ({ key: key(), serial })
	const current = scope => !disposed && scope.serial === serial && scope.key === key()
	async function request(action, data) {
		const response = await api[action](data)
		if (response?.code !== 0 || !response.data) throw new Error(response?.msg || '请求未确认，请查询原操作结果。')
		return response.data
	}
	function persist(scope, value) {
		try { storage.setStorageSync(scope.key, JSON.parse(JSON.stringify(value))); return true }
		catch { if (current(scope)) issue.value = '本机无法保存操作号，暂不能提交，请检查存储后重试。'; return false }
	}
	function base(value = operation.value) { return { batch_id: value.input.batch_id, customer_id: value.input.customer_id, operation_id: value.operation_id, plan_hash: value.preview?.plan_hash } }
	async function load() {
		const scope = captured(); loading.value = true; sources.value = null; issue.value = ''
		try {
			const data = await request('repairSources', { batch_id: batchId.value, customer_id: customerId.value })
			if (!current(scope)) return
			if (!data.snapshot_hash || !Array.isArray(data.receipts) || !Array.isArray(data.sales)) throw new Error('修正来源不完整，暂不能预览。')
			sources.value = data
		} catch (error) { if (current(scope)) issue.value = error.message }
		finally { if (current(scope)) loading.value = false }
	}
	function number(value, allowZero = false) {
		if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value)) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) throw new Error('金额须为有效的两位小数，补齐金额应大于零。')
		return Number(value)
	}
	function input() {
		if (!receipt.value) throw new Error('请选择已核实的原收款。')
		if (!/^\d{4}-\d{2}-\d{2}$/.test(form.biz_date) || new Date(`${form.biz_date}T00:00:00Z`).toISOString().slice(0, 10) !== form.biz_date) throw new Error('请填写有效的收款日期。')
		if (!form.basis.trim()) throw new Error('请填写核实依据。')
		const correction = { type: form.type, receipt_id: form.receipt_id, biz_date: form.biz_date }
		if (form.type === 'complete_receipt_backing') {
			if (!form.targets.length || form.targets.some(row => !row.sale_id)) throw new Error('请选择需要补齐收款依据的销售单。')
			if (new Set(form.targets.map(row => row.sale_id)).size !== form.targets.length) throw new Error('同一销售单不能重复选择。')
			correction.confirmed_total_amount = number(form.confirmed_total_amount)
			correction.targets = form.targets.map(row => ({ sale_id: row.sale_id, cash_amount: number(row.cash_amount), move_sale_rounding: number(row.move_sale_rounding || '0', true) }))
		}
		return { batch_id: batchId.value, customer_id: customerId.value, expected_result_hash: resultHash.value, basis: form.basis.trim(), correction }
	}
	async function acceptPrepared(scope, pending, result) {
		if (result.status === 'rejected') { acceptRejected(scope, pending, result); return }
		if (result.status === 'committed') { await acceptSaved(scope, pending, result); return }
		if (!result.plan_hash || !Array.isArray(result.writes) || !result.writes.length) throw new Error('预览变更未完整返回，请查询原操作结果。')
		const next = { ...pending, status: 'prepared', preview: result }
		if (!persist(scope, next)) return
		if (current(scope)) operation.value = next
	}
	async function prepare() {
		if (locked.value || !sources.value) return
		const scope = captured()
		let pending
		try {
			const data = input()
			const id = `reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
			pending = { operation_id: id, status: 'preparing', fingerprint: fingerprint(), input: { ...data, operation_id: id }, form: JSON.parse(JSON.stringify(form)) }
		} catch (error) { issue.value = error.message; return }
		if (!persist(scope, pending)) return
		operation.value = pending; busy.value = true; issue.value = ''
		try { await acceptPrepared(scope, pending, await request('prepareRepair', pending.input)) }
		catch (error) { const next = { ...pending, status: 'unknown' }; persist(scope, next); if (current(scope)) { operation.value = next; issue.value = `${error.message} 请先查询原操作号。` } }
		finally { if (current(scope)) busy.value = false }
	}
	function acceptRejected(scope, pending, result) {
		if (result.operation_id !== pending.operation_id) throw new Error('拒绝回执与原操作号不一致，请继续查询。')
		if (persist(scope, null) && current(scope)) { operation.value = null; issue.value = `${result.rejection_reason || '本次预览被明确拒绝，未写入账务。'} 请核实并修改输入后重新预览。` }
	}
	async function retryPreparation() {
		if (busy.value || operation.value?.status !== 'not_prepared') return
		const scope = captured(), pending = { ...operation.value, status: 'preparing' }
		if (!persist(scope, pending)) return
		operation.value = pending; busy.value = true; issue.value = ''
		try { await acceptPrepared(scope, pending, await request('prepareRepair', pending.input)) }
		catch (error) { const next = { ...pending, status: 'unknown' }; persist(scope, next); if (current(scope)) { operation.value = next; issue.value = `${error.message} 请先查询原操作号。` } }
		finally { if (current(scope)) busy.value = false }
	}
	async function acceptSaved(scope, pending, result) {
		if (result.status !== 'committed' || result.operation_id !== pending.operation_id) throw new Error('修正结果尚未确认，请查询原操作号。')
		if (result.verification?.complete !== true) {
			const next = { ...pending, status: 'committed_pending', preview: pending.preview || result, result }
			if (persist(scope, next) && current(scope)) { operation.value = next; issue.value = '修正已提交，写后复核尚未完成。请使用原操作号继续复核。' }
			return
		}
		if (!persist(scope, { ...pending, status: 'committed', result })) return
		if (current(scope)) { operation.value = null; issue.value = '修正已登记，正在重新核查。'; await onChanged?.(); await load() }
	}
	async function submit() {
		if (!canConfirm.value) return
		await executePending()
	}
	async function resumeVerification() {
		if (busy.value || operation.value?.status !== 'committed_pending') return
		await executePending()
	}
	async function executePending() {
		const scope = captured(), pending = { ...operation.value, status: 'executing' }
		if (!persist(scope, pending)) return
		operation.value = pending; busy.value = true; issue.value = ''
		try { await acceptSaved(scope, pending, await request('executeRepair', base(pending))) }
		catch (error) { const next = { ...pending, status: 'unknown' }; persist(scope, next); if (current(scope)) { operation.value = next; issue.value = `${error.message} 请先查询原操作号。` } }
		finally { if (current(scope)) busy.value = false }
	}
	async function query() {
		if (busy.value || !operation.value) return
		const scope = captured(), pending = operation.value
		busy.value = true; issue.value = ''
		try {
			const result = await request('repairStatus', base(pending))
			if (result.status === 'committed') await acceptSaved(scope, pending, result)
			else if (result.status === 'rejected') acceptRejected(scope, pending, result)
			else if (result.status === 'prepared') await acceptPrepared(scope, pending, result)
			else if (result.status === 'not_prepared') {
				const next = { ...pending, status: 'not_prepared' }; persist(scope, next)
				if (current(scope)) { operation.value = next; issue.value = '尚未查到预览记录，结果仍待确认。请查询或使用原操作号原样重试。' }
			} else throw new Error('操作状态仍待确认，请稍后查询。')
		} catch (error) { if (current(scope)) issue.value = error.message }
		finally { if (current(scope)) busy.value = false }
	}
	watch(fingerprint, () => { if (operation.value?.status === 'prepared' && operation.value.fingerprint !== fingerprint()) { operation.value = null; persist(captured(), null) } }, { flush: 'sync' })
	watch(() => [customerId.value, batchId.value], async () => {
		serial += 1; sources.value = null; operation.value = null; busy.value = false
		Object.assign(form, { type: 'correct_receipt_date', receipt_id: '', biz_date: '', basis: '', confirmed_total_amount: '', targets: [] })
		try {
			const saved = storage.getStorageSync(key())
			if (saved && !['committed', 'rejected'].includes(saved.status)) { Object.assign(form, saved.form); operation.value = saved }
		} catch { issue.value = '本机操作记录读取失败，请确认旧操作结果后再处理。'; return }
		await load()
		if (unresolved.value) await query()
	}, { immediate: true })
	onBeforeUnmount(() => { disposed = true; serial += 1 })
	return { form, sources, receipt, operation, loading, busy, issue, locked, unresolved, canConfirm, prepare, retryPreparation, submit, resumeVerification, query, load }
}
