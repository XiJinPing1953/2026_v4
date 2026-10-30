'use strict'
const { digest, sourceVersion } = require('./offsetOperation')
const { isOffsetCreditReceipt, isDepositTransferReceipt, isOpeningPrepayReceipt } = require('./receiptSource')
const { assertCustomerAdjustmentSourceMutable } = require('./customerAdjustmentGuardLocal')
const text = value => String(value ?? '').trim()
const fail = (message, code = 409) => { throw Object.assign(new Error(message), { code }) }
const tables = { sale: 'crm_sale_records', flow_settlement: 'crm_customer_flow_settlements', opening_debt: 'crm_customer_opening_debts', other_fee: 'crm_customer_opening_debts', balance_adjustment: 'crm_customer_opening_debts' }
const rowType = row => text(row.target_type) || 'sale'
const rowTarget = row => text(row.target_id || row.sale_id || row.flow_settlement_id)
const unwrap = response => Array.isArray(response.data) ? response.data[0] : response.data
const read = async (database, table, id) => unwrap(await database.collection(table).where({ _id: id }).limit(1).get())
function identity(data) {
	const value = { customer_id: text(data.customer_id || data.customerId), receipt_id: text(data.receipt_id || data.receiptId),
		operation_id: text(data.operation_id || data.operationId), expected_source_version: text(data.expected_source_version || data.expectedSourceVersion), reason: text(data.reason) }
	if (!value.customer_id || !value.operation_id || value.operation_id.length > 100) fail('缺少有效冲抵撤销操作号，请刷新网页后重试', 400)
	return value
}
const key = value => 'offset-release-' + digest([value.customer_id, value.operation_id]).slice(0, 40)
const fingerprint = value => digest(value)

function createService({ db, command, readComplete, saleSnapshot, flowSnapshot, debtSnapshot, moneyScale, refreshBalances }) {
	async function operation(database, value, checkFingerprint) {
		const log = await read(database, 'crm_operation_logs', key(value))
		if (!log) return { status: 'not_found', operation_id: value.operation_id }
		if (log.action !== 'offset_allocation_release_committed_v1' || log.detail?.customer_id !== value.customer_id ||
			(checkFingerprint && log.detail.fingerprint !== fingerprint(value))) fail('该操作号已用于其他冲抵撤销内容，请查询原操作')
		return { status: 'saved', operation_id: value.operation_id, result: log.detail.result }
	}
	async function getOperation(data) { return operation(db, identity(data), false) }
	async function refreshCommitted(value, original) {
		const result = { ...original }
		if (!result.balance_refresh_pending) return result
		try {
			await refreshBalances(value.customer_id)
			result.balance_refresh_pending = false
			const stored = await read(db, 'crm_operation_logs', key(value))
			await db.collection('crm_operation_logs').doc(key(value)).update({ detail: { ...stored.detail, result } })
		} catch (_) { /* Funds are committed; a retry may refresh the summary, never replay the release. */ }
		return result
	}
	const all = (table, where, label) => readComplete(db.collection(table), where, { command, source: label })
	async function prepare(value) {
		if (!value.receipt_id || !value.expected_source_version) fail('缺少冲抵来源或版本，请刷新后重新选择')
		const customer = await read(db, 'crm_customers', value.customer_id)
		const receipt = await read(db, 'crm_customer_receipts', value.receipt_id)
		if (!customer || !receipt || text(receipt.customer_id) !== value.customer_id || receipt.status !== 'posted') fail('冲抵来源不存在、已失效或不属于该客户')
		if (!isOffsetCreditReceipt(receipt) || isDepositTransferReceipt(receipt) || isOpeningPrepayReceipt(receipt)) fail('此入口仅支持普通冲抵来源撤销分配')
		if (sourceVersion(receipt) !== value.expected_source_version) fail('冲抵来源版本已变化，请刷新后重新确认')
		if (receipt.receipt_adjustment_status === 'pending') fail('该冲抵来源正在调整，请先完成原调整')
		if (Number(receipt.cash_refunded_amount || 0) !== 0 || Number(receipt.offset_cash_refunded_amount || 0) !== 0) fail('该来源已有退款，请使用受保护核查流程')
		const scale = moneyScale(customer), fix = n => Number(Number(n).toFixed(scale))
		function amount(n, label) { if (n == null || n === '' || !Number.isFinite(Number(n)) || Number(n) < 0 || fix(n) !== Number(n)) fail(`${label}缺失或金额精度不一致`); return Number(n) }
		const total = amount(receipt.amount, '冲抵总额'), allocated = amount(receipt.allocated_amount, '已分配金额'), available = amount(receipt.unallocated_amount, '可用余额'), rounding = amount(receipt.rounding_allocated_amount || 0, '分配抹零')
		if (fix(allocated + available + rounding) !== total) fail('冲抵来源金额不守恒，请先核查')
		const allocationRows = await all('crm_customer_allocations', { receipt_id: value.receipt_id }, 'offset_release_source_allocations')
		if (!allocationRows.length) fail('该冲抵来源暂无已分配记录')
		if (allocationRows.length > 100) fail('冲抵分配记录过多，请使用受保护分批核查流程')
		const customerReceipts = await all('crm_customer_receipts', { customer_id: value.customer_id }, 'offset_release_refunds')
		if (customerReceipts.some(row => row.status === 'posted' && (row.refund_source_status === 'pending' ||
			(row.refund_sources || []).some(link => text(link.id) === value.receipt_id) || text(row.source_receipt_id || row.offset_source_receipt_id) === value.receipt_id))) fail('存在退款关联或退款来源待核，不能释放可用余额')
		const adjustmentRows = await all('crm_customer_opening_debts', { customer_id: value.customer_id }, 'offset_release_adjustment_guards')
		const guard = args => assertCustomerAdjustmentSourceMutable({ db, command, readComplete: async () => adjustmentRows, customerId: value.customer_id, ...args })
		await guard({ receiptId: value.receipt_id })
		const groups = new Map()
		let receiptSum = 0, roundingSum = 0
		for (const row of allocationRows) {
			const type = rowType(row), id = rowTarget(row), kind = text(row.allocate_kind) || 'receipt'
			if (!row._id || text(row.customer_id) !== value.customer_id || !tables[type] || !id || !['receipt', 'rounding'].includes(kind) || (row.status && row.status !== 'posted') ||
				(row.target_id && row.sale_id && row.target_id !== row.sale_id)) fail('原冲抵分配归属或目标不一致')
			const n = amount(row.allocate_amount, '分配明细')
			if (!(n > 0)) fail('原冲抵分配金额无效')
			const group = groups.get(`${type}:${id}`) || { type, id, receipt: 0, rounding: 0 }
			group[kind] = fix(group[kind] + n); groups.set(`${type}:${id}`, group)
			if (kind === 'receipt') receiptSum = fix(receiptSum + n); else roundingSum = fix(roundingSum + n)
			await guard({ allocationId: row._id })
		}
		if (receiptSum !== allocated || roundingSum !== rounding) fail('分配明细与来源已分配金额不一致')
		if (groups.size > 50) fail('冲抵目标过多，请使用受保护分批核查流程')
		const targets = []
		for (const group of groups.values()) {
			const row = await read(db, tables[group.type], group.id)
			if (!row || text(row.customer_id) !== value.customer_id || (group.type !== 'sale' && row.status !== 'posted')) fail('原分配目标不存在、归属或状态已变化')
			await guard({ targetType: group.type, targetId: group.id })
			const targetScale = group.type === 'flow_settlement' ? 3 : group.type === 'sale' ? 2 : scale
			const targetFix = n => Number(Number(n).toFixed(targetScale))
			const snap = group.type === 'sale' ? saleSnapshot(row) : group.type === 'flow_settlement' ? flowSnapshot(row) : debtSnapshot(row, targetScale)
			const received = Number(row.amount_received), receiptRounding = Number(row.receipt_rounding_amount || 0)
			const rawShouldReceive = group.type === 'flow_settlement' ? snap.should_receive : snap.should_receive_effective
			if (rawShouldReceive == null || rawShouldReceive === '') fail('原分配目标的账务归属或应收金额待核')
			const shouldReceive = Number(rawShouldReceive)
			if (![received, receiptRounding, shouldReceive].every(Number.isFinite) || received < group.receipt || receiptRounding < group.rounding ||
				shouldReceive <= 0 || targetFix(received) !== received || targetFix(receiptRounding) !== receiptRounding ||
				targetFix(group.receipt) !== group.receipt || targetFix(group.rounding) !== group.rounding) fail('原目标金额不足以完整回退或金额精度不一致')
			const reverse = await all('crm_customer_allocations', command.or([{ target_id: group.id }, { sale_id: group.id }, { flow_settlement_id: group.id }]), 'offset_release_target_backing')
			if (reverse.some(item => item.target_id && item.sale_id && item.target_id !== item.sale_id)) fail('目标反向分配身份引用不一致')
			const matching = reverse.filter(item => rowType(item) === group.type && rowTarget(item) === group.id)
			let allReceived = 0, allRounding = 0
			for (const item of matching) {
				if (text(item.customer_id) !== value.customer_id || !(Number(item.allocate_amount) > 0)) fail('目标反向分配归属或金额不一致')
				if ((text(item.allocate_kind) || 'receipt') === 'receipt') allReceived += Number(item.allocate_amount)
				else if (item.allocate_kind === 'rounding') allRounding += Number(item.allocate_amount)
				else fail('目标反向分配类型不明')
			}
			if (targetFix(allReceived) > received || targetFix(allRounding) > receiptRounding) fail('目标分配合计超过已收或抹零，不能回退')
			const nextReceived = targetFix(received - group.receipt), nextRounding = targetFix(receiptRounding - group.rounding), nextPaid = targetFix(nextReceived + nextRounding)
			const patch = { amount_received: nextReceived, receipt_rounding_amount: nextRounding,
				payment_status: nextPaid >= shouldReceive ? 'paid' : nextPaid > 0 ? 'partial' : 'unpaid' }
			if (!['sale', 'flow_settlement'].includes(group.type)) patch.outstanding = targetFix(Math.max(0, shouldReceive - nextPaid))
			targets.push({ ...group, row, patch, reverse })
		}
		return { customer, receipt, allocationRows, targets, total, released: fix(allocated + rounding) }
	}
	async function run(data, user) {
		const value = identity(data)
		const prior = await operation(db, value, true)
		if (prior.status === 'saved') return { ...await refreshCommitted(value, prior.result), idempotent: true }
		const scope = await prepare(value)
		const tx = await db.startTransaction(), started = Date.now()
		let committed = false
		const budget = () => { if (Date.now() - started >= 8000) fail('处理时间超过安全范围，请用原操作号查询或重试', 500) }
		const same = async (table, row) => { budget(); if (digest(await read(tx, table, row._id)) !== digest(row)) fail('关联账务已变化，请刷新后重新确认') }
		try {
			const retry = await operation(tx, value, true)
			if (retry.status === 'saved') { await tx.rollback(); return { ...await refreshCommitted(value, retry.result), idempotent: true } }
			await same('crm_customers', scope.customer); await same('crm_customer_receipts', scope.receipt)
			for (const row of scope.allocationRows) await same('crm_customer_allocations', row)
			for (const target of scope.targets) { await same(tables[target.type], target.row); for (const row of target.reverse) await same('crm_customer_allocations', row) }
			const now = Date.now()
			await tx.collection('crm_customers').doc(value.customer_id).update({ receipt_allocation_revision: value.operation_id, updated_at: now })
			for (const target of scope.targets) { budget(); await tx.collection(tables[target.type]).doc(target.id).update({ ...target.patch, updated_at: now }) }
			for (const row of scope.allocationRows) { budget(); await tx.collection('crm_customer_allocations').doc(row._id).remove() }
			budget()
			await tx.collection('crm_customer_receipts').doc(value.receipt_id).update({ allocated_amount: 0, rounding_allocated_amount: 0, unallocated_amount: scope.total,
				allocation_targets: [], updated_at: now, updated_by: user._id, updated_by_name: user.username })
			const result = { operation_id: value.operation_id, customer_id: value.customer_id, receipt_id: value.receipt_id,
				released_total: scope.released, remaining_unallocated: scope.total, allocation_rows: scope.allocationRows.length, balance_refresh_pending: true }
			await tx.collection('crm_operation_logs').add({ _id: key(value), action: 'offset_allocation_release_committed_v1', user_id: user._id, username: user.username,
				created_at: now, detail: { customer_id: value.customer_id, fingerprint: fingerprint(value), result,
					before: { receipt: scope.receipt, allocations: scope.allocationRows, targets: scope.targets.map(t => ({ type: t.type, row: t.row })) },
					after: { available: scope.total, targets: scope.targets.map(t => ({ type: t.type, id: t.id, ...t.patch })) } } })
			budget(); await tx.commit(); committed = true
			return refreshCommitted(value, result)
		} catch (error) { if (!committed) await tx.rollback().catch(() => {}); throw error }
	}
	return { run, getOperation }
}
module.exports = { createService }
