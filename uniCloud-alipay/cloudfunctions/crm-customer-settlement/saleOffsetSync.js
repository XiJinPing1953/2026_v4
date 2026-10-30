'use strict'

const crypto = require('crypto')
const { assertCustomerAdjustmentSourceMutable } = require('./customerAdjustmentGuardLocal')
const VERSION = 'sale-offset-sync/2026-10-30.1'
const SOURCE_TYPES = ['sale_offset_credit', 'sale_offset_credit_repair']
const text = value => String(value ?? '').trim()
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const fail = (message, details = {}, code = 409) => { throw Object.assign(new Error(message), { code, details: { write_status: 'not_written', ...details } }) }
const doc = result => Array.isArray(result?.data) ? result.data[0] : result?.data
const isLive = row => !['void', 'voided', 'cancelled', 'canceled'].includes(text(row?.status))
const minor = (value, field, optional = false) => {
	if (optional && (value == null || value === '')) return 0
	if (!['number', 'string'].includes(typeof value) || text(value) === '' || !Number.isFinite(Number(value))) fail('冲抵金额依据不完整', { field })
	const units = Math.round(Number(value) * 100)
	if (!Number.isSafeInteger(units) || Math.abs(units / 100 - Number(value)) > 1e-8) fail('销售冲抵金额精度无效', { field })
	return units
}
const money = units => units / 100
function offsetEnabled(sale) {
	const value = sale?.offset_enabled
	if (value == null || value === '') return true // existing legacy compatibility; never a new-sale default
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (['0', 'false', 'no', 'n', 'off'].includes(text(value).toLowerCase())) return false
	return true
}
function receiptAmounts(row) {
	const parts = {
		amount: minor(row.amount, 'amount'), allocated: minor(row.allocated_amount, 'allocated_amount'),
		available: minor(row.unallocated_amount, 'unallocated_amount'),
		rounding: minor(row.rounding_allocated_amount, 'rounding_allocated_amount', true),
		refunded: minor(row.offset_cash_refunded_amount, 'offset_cash_refunded_amount', true)
	}
	if (Object.values(parts).some(value => value < 0) || parts.amount !== parts.allocated + parts.available + parts.rounding + parts.refunded ||
		minor(row.cash_refunded_amount, 'cash_refunded_amount', true) !== 0) fail('冲抵来源余额不守恒，需核对原始记录', { receipt_id: row._id })
	return parts
}
function saleOffsetSourceFingerprint(sale) {
	// Keep business fields, including source amounts/date/customer, but ignore sync progress metadata.
	const copy = { ...sale }
	for (const key of ['offset_sync_status', 'offset_sync_completed_at', 'offset_sync_error']) delete copy[key]
	return digest(copy)
}
function input(data) {
	const value = { customer_id: text(data.customer_id), sale_id: text(data.sale_id), operation_id: text(data.operation_id) }
	if (!value.customer_id || !value.sale_id || !value.operation_id || value.operation_id.length > 160) fail('冲抵同步须提供客户、源单及固定操作号', {}, 400)
	if (data.expected_updated_at != null) {
		if (!['number', 'string'].includes(typeof data.expected_updated_at) || text(data.expected_updated_at) === '' || !Number.isSafeInteger(Number(data.expected_updated_at)) || Number(data.expected_updated_at) < 0) fail('源单版本无效', {}, 400)
		value.expected_updated_at = Number(data.expected_updated_at)
	}
	return value
}
const operationKey = value => `sale-offset-sync-${digest([value.customer_id, value.operation_id]).slice(0, 40)}`
const fingerprint = value => digest(value)

function createSaleOffsetSyncService({ db, command = db.command, readComplete, saleSnapshot, refreshBalances = async () => {} }) {
	if (typeof readComplete !== 'function' || typeof saleSnapshot !== 'function') throw new Error('sale offset sync requires authoritative read and amount helpers')
	const get = async (database, name, id, known = false) => {
		// Alipay may throw on doc().get() for a missing deterministic id. A bounded
		// equality query proves absence without swallowing network/permission errors.
		const collection = database.collection(name)
		return doc(await (known ? collection.doc(id) : collection.where({ _id: id }).limit(1)).get())
	}
	const all = (database, name, where, source) => readComplete(database.collection(name), where, { command, source })

	async function readScope(database, value) {
		const sale = await get(database, 'crm_sale_records', value.sale_id)
		if (!sale || text(sale.customer_id) !== value.customer_id) fail('销售来源不存在或不属于该客户')
		if (text(sale.offset_sync_revision) !== value.operation_id) fail('源单同步版本已变化或未登记本次同步，不能补写历史账务', { reason: 'source_revision_conflict' })
		if (value.expected_updated_at != null && Number(sale.updated_at) !== value.expected_updated_at) fail('源单已变化，请重新读取本单同步结果', { reason: 'source_version_conflict' })
		if (['draft', 'void', 'voided', 'cancelled', 'canceled', 'deleted'].includes(text(sale.status))) fail('草稿或作废销售不能生成冲抵额度')
		const customer = await get(database, 'crm_customers', value.customer_id)
		if (!customer) fail('客户不存在', {}, 404)
		const snapshot = saleSnapshot(sale)
		const expected = text(sale.settlement_mode) === 'customer_flow' || !offsetEnabled(sale) ? 0 :
			Math.max(0, minor(snapshot.amount_received, 'sale.amount_received') - minor(snapshot.should_receive_effective, 'sale.should_receive_effective'))
		const sourceRows = await all(database, 'crm_customer_receipts', { source_id: value.sale_id }, 'sale_offset_sync_sources')
		const creditRows = sourceRows.filter(row => SOURCE_TYPES.includes(text(row.source_type)))
		if (creditRows.some(row => text(row.customer_id) !== value.customer_id)) fail('冲抵来源存在跨客户关联，需先核对')
		if (sourceRows.some(row => text(row.source_type).startsWith('sale_offset_credit') && !SOURCE_TYPES.includes(text(row.source_type)))) fail('存在未识别的销售冲抵来源，需先核对')
		const active = creditRows.filter(row => row.status === 'posted')
		if (creditRows.some(row => row.status !== 'posted')) fail('该源单有作废或未入账冲抵记录，需按历史更正流程核对')
		const receipts = await all(database, 'crm_customer_receipts', { customer_id: value.customer_id }, 'sale_offset_sync_refund_evidence')
		const states = []
		for (const row of active) {
			if (row.receipt_adjustment_status === 'pending') fail('该冲抵来源正在调整，不能同步', { receipt_id: row._id })
			const amounts = receiptAmounts(row)
			const links = (await all(database, 'crm_customer_allocations', { receipt_id: row._id }, 'sale_offset_sync_allocations')).filter(isLive)
			if (links.some(link => text(link.customer_id) !== value.customer_id)) fail('冲抵分配存在跨客户关联', { receipt_id: row._id })
			let allocated = 0, rounding = 0, refunded = 0
			for (const link of links) {
				const amount = minor(link.allocate_amount, 'allocation.allocate_amount')
				if (amount <= 0) fail('冲抵分配金额无效', { allocation_id: link._id })
				if (link.allocate_kind === 'rounding') rounding += amount
				else allocated += amount
			}
			for (const refund of receipts.filter(item => item.status === 'posted')) {
				if (refund.source_type === 'customer_cash_refund') {
					const linked = (refund.refund_sources || []).filter(item => text(item.id) === text(row._id))
					if (linked.length > 1) fail('退款来源重复关联', { refund_id: refund._id })
					for (const link of linked) refunded += minor(link.amount, 'refund_source.amount')
				} else if (refund.source_type === 'offset_credit_cash_refund' && text(refund.offset_source_receipt_id || refund.source_id) === text(row._id)) {
					refunded += -minor(refund.amount, 'refund.amount')
				}
			}
			if (allocated !== amounts.allocated || rounding !== amounts.rounding || refunded !== amounts.refunded) fail('冲抵来源与分配或退款背书不一致，不能同步', { receipt_id: row._id })
			states.push({ row, links, ...amounts })
		}
		const current = states.reduce((sum, item) => sum + item.amount, 0)
		const delta = expected - current
		if (delta !== 0) {
			if (receipts.some(row => row.status === 'posted' && row.source_type === 'customer_cash_refund' && row.refund_source_status === 'pending')) fail('该客户有来源待核的实际退款，不能推定新增可用冲抵余额')
			if (states.some(item => item.allocated || item.rounding || item.refunded)) fail('该来源已有分配或退款，不能自动改写额度，请先核对关联记录')
			await assertCustomerAdjustmentSourceMutable({ db: database, command, readComplete, customerId: value.customer_id, targetType: 'sale', targetId: value.sale_id })
			for (const item of states) await assertCustomerAdjustmentSourceMutable({ db: database, command, readComplete, customerId: value.customer_id, receiptId: item.row._id })
		}
		return { sale, customer, states, receipts, expected, current, delta }
	}

	async function readOperation(value) {
		const existing = await get(db, 'crm_operation_logs', operationKey(value))
		if (existing) {
			if (existing.detail?.sale_id !== value.sale_id || (value.expected_updated_at != null && existing.detail?.fingerprint !== fingerprint(value))) fail('该同步操作号已用于不同请求')
			return existing.detail
		}
		const sale = await get(db, 'crm_sale_records', value.sale_id)
		if (!sale || text(sale.customer_id) !== value.customer_id) fail('销售来源不存在或不属于该客户')
		const same = text(sale.offset_sync_revision) === value.operation_id
		return { status: same ? 'pending' : 'not_found', customer_id: value.customer_id, sale_id: value.sale_id, operation_id: value.operation_id,
			source_revision_current: same, operation_version: VERSION }
	}

	async function refreshResult(value, stored) {
		const result = { ...stored }
		if (!result.balance_refresh_pending) return result
		try {
			await refreshBalances(value.customer_id)
			await db.collection('crm_operation_logs').doc(operationKey(value)).update({ detail: { ...stored, balance_refresh_pending: false } })
			result.balance_refresh_pending = false
		} catch (_) { /* Saved money is never reported as failed because a cache is stale. */ }
		return result
	}

	async function run(action, data, user) {
		const value = input(data)
		if (!user || !['superadmin', 'admin', 'finance', 'user'].includes(user.role)) fail('当前账号无冲抵同步权限', {}, 403)
		if (action === 'getSaleOffsetSyncOperationV1') return readOperation(value)
		if (action !== 'syncSaleOffsetCreditV1') fail('不支持的冲抵同步操作', {}, 400)
		if (value.expected_updated_at == null) fail('必须提供本次保存的源单版本，不能推断历史同步依据', {}, 400)
		if (!db.startTransaction) fail('当前环境不支持事务，未同步冲抵款', {}, 503)
		const saved = await get(db, 'crm_operation_logs', operationKey(value))
		if (saved) {
			if (saved.detail?.fingerprint !== fingerprint(value)) fail('该同步操作号已用于不同请求')
			return { ...await refreshResult(value, saved.detail), idempotent: true }
		}
		// Full pagination stays outside the ten-second transaction. Every cooperating
		// money writer must lock the same customer revision before changing membership.
		const scope = await readScope(db, value)
		const tx = await db.startTransaction()
		const txStarted = Date.now()
		let committed = false
		try {
			const logs = tx.collection('crm_operation_logs')
			const prior = await get(tx, 'crm_operation_logs', operationKey(value))
			if (prior) {
				if (prior.detail?.fingerprint !== fingerprint(value)) fail('该同步操作号已用于不同请求')
				await tx.rollback()
				return { ...await refreshResult(value, prior.detail), idempotent: true }
			}
			const currentCustomer = await get(tx, 'crm_customers', value.customer_id, true)
			const currentSale = await get(tx, 'crm_sale_records', value.sale_id, true)
			if (digest(currentCustomer) !== digest(scope.customer) || digest(currentSale) !== digest(scope.sale)) fail('客户或源单在核查后发生变化，请重新查询')
			const now = Date.now()
			// All cooperating money writers touch this customer revision; the source write
			// also conflicts with sale edits, even when its business timestamp stays unchanged.
			await tx.collection('crm_customers').doc(value.customer_id).update({ receipt_allocation_revision: value.operation_id, updated_at: now })
			await tx.collection('crm_sale_records').doc(value.sale_id).update({ offset_sync_revision: value.operation_id, offset_sync_status: 'completed', offset_sync_completed_at: now })
			const receipts = tx.collection('crm_customer_receipts')
			for (const state of scope.states) {
				const current = await get(tx, 'crm_customer_receipts', state.row._id, true)
				if (digest(current) !== digest(state.row)) fail('冲抵来源在核查后发生变化，请重新查询', { receipt_id: state.row._id })
			}
			const changes = []
			if (scope.delta > 0) {
				const existing = scope.states.slice().sort((a, b) => text(b.row._id).localeCompare(text(a.row._id)))[0]
				if (existing) {
					const after = { amount: money(existing.amount + scope.delta), unallocated_amount: money(existing.available + scope.delta), updated_at: now }
					await receipts.doc(existing.row._id).update(after)
					changes.push({ receipt_id: existing.row._id, before: existing.row, after: { ...existing.row, ...after } })
				} else {
					const id = `sale-offset-${digest(value.sale_id).slice(0, 32)}`
					if (await get(tx, 'crm_customer_receipts', id)) fail('冲抵确定编号已被占用，需先核对')
					const row = { _id: id, customer_id: value.customer_id, customer_name: text(scope.customer.name), biz_date: text(scope.sale.date),
						amount: money(scope.delta), allocated_amount: 0, rounding_amount: 0, rounding_allocated_amount: 0, unallocated_amount: money(scope.delta),
						payment_method: 'cash', entry_kind: 'offset_credit', allocation_mode: 'period', allocation_start_date: text(scope.sale.date),
						allocation_end_date: text(scope.sale.date), allocation_targets: [], note: `销售单${text(scope.sale.date)}冲抵款入池`,
						source_type: 'sale_offset_credit', source_id: value.sale_id, status: 'posted', request_id: value.operation_id,
						created_at: now, updated_at: now, created_by: text(user._id) || null, created_by_name: text(user.username) }
					await receipts.add(row)
					changes.push({ receipt_id: id, before: null, after: row })
				}
			} else if (scope.delta < 0) {
				let remaining = -scope.delta
				for (const existing of scope.states.slice().sort((a, b) => text(b.row._id).localeCompare(text(a.row._id)))) {
					if (!remaining) break
					const reduction = Math.min(remaining, existing.available)
					if (!reduction) continue
					const after = { amount: money(existing.amount - reduction), unallocated_amount: money(existing.available - reduction), updated_at: now }
					await receipts.doc(existing.row._id).update(after)
					changes.push({ receipt_id: existing.row._id, before: existing.row, after: { ...existing.row, ...after } })
					remaining -= reduction
				}
				if (remaining) fail('可调整余额不足，未执行同步')
			}
			const detail = { status: 'completed', operation_version: VERSION, operation_id: value.operation_id, customer_id: value.customer_id, sale_id: value.sale_id,
				fingerprint: fingerprint(value), source_version: saleOffsetSourceFingerprint(scope.sale), source_updated_at: scope.sale.updated_at,
				expected_offset_credit: money(scope.expected), previous_offset_credit: money(scope.current), delta: money(scope.delta),
				changed_receipts: changes, balance_refresh_pending: true }
			await logs.add({ _id: operationKey(value), action: 'sale_offset_credit_sync_v1', request_id: value.operation_id, created_at: now,
				user_id: text(user._id) || null, username: text(user.username), role: text(user.role), detail })
			if (Date.now() - txStarted > 8000) fail('冲抵同步事务耗时过长，已停止提交，请使用原操作号查询或重试')
			await tx.commit()
			committed = true
			// The accounting result stays completed even if a derived balance cache fails.
			return refreshResult(value, detail)
		} catch (error) {
			if (!committed) await tx.rollback().catch(() => {})
			throw error
		}
	}
	return { run }
}

module.exports = { VERSION, createSaleOffsetSyncService, saleOffsetSourceFingerprint, receiptAmounts }
