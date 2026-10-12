// Local UI fixture only; these examples are not accounting evidence or a production calculator.
function state(s) {
	if (!s.customerAdjustments) {
		const id = s.customer._id
		const rounding = { source_key: `sale_rounding:${id}-sale-1`, version: 'demo-1', type: 'sale_rounding', id: `${id}-sale-1`, date: '2026-09-01', label: '模拟销售抹零', amount: 37.5, processed: 5, available: 32.5, target_type: 'sale', target_id: `${id}-sale-1` }
		const credit = { source_key: `receipt_credit:${id}-receipt-11`, version: 'demo-1', type: 'receipt_credit', id: `${id}-receipt-11`, date: '2026-09-01', label: '模拟收款余款', amount: 1000, processed: 60, available: 940, receipt_id: `${id}-receipt-11` }
		s.customerAdjustments = { version: 1, sources: { rounding_reversal: rounding, prepay_writeoff: credit }, rows: [
			{ id: `${id}-adjustment-demo-1`, kind: 'rounding_reversal', date: '2026-09-20', biz_date: '2026-09-20', amount: 5, status: 'posted', note: '模拟：原抹零录入有误', evidence: '模拟核准凭据 A', source: { ...rounding }, operation_id: `${id}-adjustment-op-1`, version: 'demo-1' },
			{ id: `${id}-adjustment-demo-2`, kind: 'prepay_writeoff', date: '2026-09-20', biz_date: '2026-09-20', amount: 60, status: 'posted', note: '模拟：双方确认余款结清', evidence: '模拟确认凭据 B', source: { ...credit }, operation_id: `${id}-adjustment-op-2`, version: 'demo-1' }
		], operations: {} }
	}
	return s.customerAdjustments
}
const ok = data => ({ code: 0, data: structuredClone(data), msg: '本地模拟完成（未写入云端）' })
const fail = msg => ({ code: 409, msg: `本地模拟：${msg}`, details: { write_status: 'not_written' } })
export function adjustmentMockRows(s) {
	return state(s).rows.filter(row => row.status === 'posted').map(row => ({ row_id: row.id, row_type: row.kind, biz_date: row.date, amount: row.amount, outstanding: row.kind === 'rounding_reversal' ? row.amount : 0, note: row.note, meta: { payment_status: row.kind === 'rounding_reversal' ? 'unpaid' : 'paid', adjustment_source: row.source, adjustment_evidence: row.evidence, adjustment_operation_id: row.operation_id } }))
}
export function adjustmentMockSummary(s, dateFrom, dateTo) {
	const rows = state(s).rows.filter(row => row.status === 'posted' && (!dateFrom || row.date >= dateFrom) && (!dateTo || row.date <= dateTo))
	const rounding = rows.filter(row => row.kind === 'rounding_reversal').reduce((total, row) => total + row.amount, 0)
	return { prepay_writeoff_total: 0, rounding_total: 37.5, rounding_reversal_total: rounding, rounding_net_total: 37.5 - rounding, settlement_writeoff_income: rows.filter(row => row.kind === 'prepay_writeoff').reduce((total, row) => total + row.amount, 0) }
}
export function customerAdjustmentMock(s, action, input) {
	if (!['getCustomerAdjustmentSourcesV1', 'previewCustomerAdjustmentV1', 'postCustomerAdjustmentV1', 'getCustomerAdjustmentOperationV1', 'voidCustomerAdjustmentV1'].includes(action)) return null
	const fixture = state(s)
	if (action === 'getCustomerAdjustmentSourcesV1') return ok({ complete: true, money_scale: s.customer.money_scale, sources: [fixture.sources[input.kind]].filter(Boolean), adjustments: fixture.rows, pending: [] })
	if (action === 'getCustomerAdjustmentOperationV1') return ok(fixture.operations[input.operation_id] || { status: 'not_found' })
	if (fixture.operations[input.operation_id]) return ok(fixture.operations[input.operation_id])
	const original = input.void_id ? fixture.rows.find(row => row.id === input.void_id && row.status === 'posted') : null
	const source = original?.source || fixture.sources[input.kind]
	if (!source || !input.note || (!input.void_id && (!input.biz_date || !(input.amount > 0) || input.amount > source.available || input.source_version !== source.version))) return fail('请选择来源并核对金额、日期与原因')
	if (input.void_id && (!original || original.version !== input.source_version)) return fail('原记录已变化，请刷新来源')
	if (input.kind === 'prepay_writeoff' && !input.void_id && input.confirm_no_refund_or_offset !== true) return fail('请先确认不退不抵')
	const { plan_hash, ...value } = input
	const hash = `demo-plan:${fixture.version}:${JSON.stringify(value)}`
	const amount = input.void_id ? -original.amount : input.amount
	const effects = { receivable_delta: input.kind === 'rounding_reversal' ? amount : 0, available_delta: input.kind === 'prepay_writeoff' ? -amount : 0, income_delta: input.kind === 'prepay_writeoff' ? amount : 0, cash_delta: 0 }
	const before = { receivable_balance: [...s.sales, ...s.flows].reduce((n, row) => n + row.outstanding, 0), prepay_balance: [...s.receipts, ...s.pools].reduce((n, row) => n + row.unallocated_amount, 0) }
	before.net_balance = before.receivable_balance - before.prepay_balance
	const after = { receivable_balance: before.receivable_balance + effects.receivable_delta, prepay_balance: before.prepay_balance + effects.available_delta }
	after.net_balance = after.receivable_balance - after.prepay_balance
	if (action === 'previewCustomerAdjustmentV1') return ok({ value, plan_hash: hash, effects, source, balances: { before, after }, affected_allocations: [], receipt_effects: [] })
	if (!input.operation_id || input.plan_hash !== hash) return fail('预览已失效，请重新预览')
	fixture.version += 1
	const currentSource = fixture.sources[input.kind]
	currentSource.processed += amount; currentSource.available -= amount; currentSource.version = `demo-${fixture.version}`
	let id = input.void_id
	if (original) { original.status = 'void'; original.void_reason = input.note; original.version = `demo-${fixture.version}` }
	else {
		id = `${s.customer._id}-adjustment-local-${fixture.version}`
		fixture.rows.unshift({ id, kind: input.kind, amount: input.amount, date: input.biz_date, biz_date: input.biz_date, note: input.note, evidence: input.evidence, source: { ...source }, operation_id: input.operation_id, status: 'posted', version: `demo-${fixture.version}` })
	}
	const result = { status: input.void_id ? 'voided' : 'saved', operation_id: input.operation_id, adjustment_id: id, kind: input.kind }
	fixture.operations[input.operation_id] = result
	return ok(result)
}
