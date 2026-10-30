'use strict'

const { digest } = require('./offsetOperation')
const { isOffsetCreditReceipt } = require('./receiptSource')
const { assertCustomerAdjustmentSourceMutable } = require('./customerAdjustmentGuardLocal')
const VERSION = 'sale-offset-use/2026-10-30.1'
const ACTION = 'sale_offset_use_committed_v1'
const SOURCES = ['sale_offset_credit', 'sale_offset_credit_repair']
const MANUAL_SOURCES = ['customer_offset_credit_manual', 'customer_offset_credit_manual_compensation']
const text = value => String(value ?? '').trim()
const doc = response => Array.isArray(response?.data) ? response.data[0] : response?.data
const live = row => !['void', 'voided', 'cancelled', 'canceled'].includes(text(row.status))
const enabled = value => value === true || value === 1 || ['true', '1'].includes(text(value).toLowerCase())
const fail = (message, details = {}, code = 409) => { throw Object.assign(new Error(message), { code, details }) }
function input(data) {
	const value = { customer_id: text(data.customer_id), sale_id: text(data.sale_id), operation_id: text(data.operation_id) }
	if (!value.customer_id || !value.sale_id || !value.operation_id || value.operation_id.length > 160) fail('缺少客户、销售单或固定冲抵操作号', {}, 400)
	return value
}
const key = value => 'sale-offset-use-' + digest([value.customer_id, value.operation_id]).slice(0, 40)
function currency(scale) {
	if (![2, 3].includes(scale)) fail('客户金额精度无效')
	const factor = 10 ** scale
	return { factor, money: n => n / factor, units(value, label, optional = false) {
		if (optional && (value == null || value === '')) return 0
		if (!['string', 'number'].includes(typeof value) || text(value) === '' || !Number.isFinite(Number(value))) fail(`${label}金额缺失或无效`)
		const n = Math.round(Number(value) * factor)
		if (!Number.isSafeInteger(n) || Math.abs(n / factor - Number(value)) > 1e-8) fail(`${label}金额精度无效`)
		return n
	} }
}
function createService({ db, command = db.command, readComplete, saleSnapshot, moneyScale, refreshBalances = async () => {} }) {
	if (![readComplete, saleSnapshot, moneyScale].every(fn => typeof fn === 'function')) throw Error('sale offset use requires authoritative read and accounting helpers')
	const read = async (database, table, id, known = false) => doc(await (known ? database.collection(table).doc(id) : database.collection(table).where({ _id: id }).limit(1)).get())
	const all = (table, where, source) => readComplete(db.collection(table), where, { command, source })
	async function operation(database, value) {
		const row = await read(database, 'crm_operation_logs', key(value))
		if (!row) return { status: 'not_found', operation_id: value.operation_id }
		if (row.action !== ACTION || row.detail?.fingerprint !== digest(value)) fail('该操作号已用于不同的销售冲抵请求')
		return { status: 'saved', operation_id: value.operation_id, result: row.detail.result }
	}
	async function getOperation(data) { return operation(db, input(data)) }
	async function refresh(value, result) {
		const output = { ...result }
		if (!output.balance_refresh_pending) return output
		try {
			await refreshBalances(value.customer_id)
			const stored = await read(db, 'crm_operation_logs', key(value))
			if (!stored || stored.detail?.fingerprint !== digest(value)) fail('已提交操作记录待核')
			await db.collection('crm_operation_logs').doc(key(value)).update({ detail: { ...stored.detail, result: { ...stored.detail.result, balance_refresh_pending: false } } })
			output.balance_refresh_pending = false
		} catch (_) { /* Committed funds remain successful when their balance cache is stale. */ }
		return output
	}
	async function prepare(value) {
		const customer = await read(db, 'crm_customers', value.customer_id)
		const sale = await read(db, 'crm_sale_records', value.sale_id)
		if (!customer || !sale || text(sale.customer_id) !== value.customer_id) fail('销售单或客户不存在，或销售单不属于该客户')
		if (text(sale.offset_use_revision) !== value.operation_id) fail('销售版本已变化或没有本次操作号，不能使用旧计划冲抵')
		if (sale.offset_sync_status === 'pending') fail('请先完成本单入池同步，再继续使用冲抵款')
		if (!enabled(sale.apply_offset_credit)) fail('本次保存未选择使用冲抵款')
		if (text(sale.settlement_mode) === 'customer_flow' || ['draft', 'void', 'voided', 'cancelled', 'canceled', 'deleted'].includes(text(sale.status))) fail('该销售单不支持直接使用冲抵款')
		const cents = currency(2), cash = currency(moneyScale(customer)), centUnits = cash.factor / 100
		const snapshot = saleSnapshot(sale)
		const should = cents.units(snapshot.should_receive_effective, '销售应收'), received = cents.units(snapshot.amount_received, '销售已收'), rounded = cents.units(snapshot.receipt_rounding_amount, '销售收款抹零', true)
		if (cents.units(sale.amount_received, '销售原已收', true) !== received || cents.units(sale.receipt_rounding_amount, '销售原收款抹零', true) !== rounded || cents.units(sale.rounding_amount, '销售原抹零', true) < 0) fail('销售原值与核算金额不一致，须先核对')
		const outstanding = Math.max(0, should - received - rounded)
		if (rounded < 0 || (outstanding > 0 && (should <= 0 || received < 0)) || cents.units(snapshot.outstanding, '销售欠款') !== outstanding) fail('销售金额或欠款依据不一致，须先核对')
		const receipts = await all('crm_customer_receipts', { customer_id: value.customer_id }, 'sale_offset_use_pool_and_refunds')
		if (receipts.some(row => row.status === 'posted' && row.source_type === 'customer_cash_refund' && row.refund_source_status === 'pending')) fail('该客户有来源待核退款，不能推定可用冲抵余额')
		const adjustmentRows = await all('crm_customer_opening_debts', { customer_id: value.customer_id }, 'sale_offset_use_adjustments')
		const guard = args => assertCustomerAdjustmentSourceMutable({ db, command, readComplete: async () => adjustmentRows, customerId: value.customer_id, ...args })
		await guard({ targetType: 'sale', targetId: value.sale_id })
		const targetLinks = await all('crm_customer_allocations', command.or([{ target_id: value.sale_id }, { sale_id: value.sale_id }]), 'sale_offset_use_target_backing')
		let targetReceived = 0, targetRounded = 0
		for (const link of targetLinks.filter(live)) {
			if (text(link.customer_id) !== value.customer_id || (link.target_type && link.target_type !== 'sale') || (link.target_id && link.target_id !== value.sale_id) || (link.sale_id && link.sale_id !== value.sale_id)) fail('销售目标存在不一致或跨客户分配')
			const n = cents.units(link.allocate_amount, '销售分配')
			if (!(n > 0) || !['', 'receipt', 'rounding'].includes(text(link.allocate_kind))) fail('销售分配金额或类型无效')
			if (link.allocate_kind === 'rounding') targetRounded += n; else targetReceived += n
			await guard({ allocationId: link._id })
		}
		if (targetReceived > received || targetRounded > rounded) fail('销售已收或抹零不足以覆盖已有分配，须先核对')
		const pool = receipts.filter(row => row.status === 'posted' && isOffsetCreditReceipt(row) && text(row.source_id) !== value.sale_id)
			.sort((a, b) => text(a.biz_date).localeCompare(text(b.biz_date)) || Number(a.created_at || 0) - Number(b.created_at || 0) || text(a._id).localeCompare(text(b._id)))
		const plans = [], sourceSales = new Map()
		let remaining = outstanding
		for (const row of pool) {
			if (remaining <= 0) break
			const available = cash.units(row.unallocated_amount, '来源可用余额')
			if (available < 0) fail('来源可用余额为负，须先核对')
			if (available === 0) continue
			const manual = MANUAL_SOURCES.includes(text(row.source_type)) && text(row.entry_kind) === 'offset_credit'
			if ((!manual && (!SOURCES.includes(text(row.source_type)) || !text(row.source_id))) || !row._id) fail('冲抵来源类型或原始销售链不完整，须先核对')
			if (row.receipt_adjustment_status === 'pending') fail('冲抵来源正在调整，不能使用')
			const total = cash.units(row.amount, '来源总额'), allocated = cash.units(row.allocated_amount, '来源已分配'), rounding = cash.units(row.rounding_allocated_amount, '来源分配抹零', true), refunded = cash.units(row.offset_cash_refunded_amount, '来源已退款', true)
			if ([total, allocated, rounding, refunded].some(n => n < 0) || cash.units(row.cash_refunded_amount, '来源现金退款', true) !== 0 || total !== allocated + available + rounding + refunded) fail('冲抵来源余额不守恒，须先核对', { receipt_id: row._id })
			if (!manual) {
				let sourceSale = sourceSales.get(row.source_id)
				if (!sourceSale) {
					sourceSale = await read(db, 'crm_sale_records', row.source_id)
					if (!sourceSale || text(sourceSale.customer_id) !== value.customer_id || text(sourceSale.settlement_mode) === 'customer_flow' || ['draft', 'void', 'voided', 'cancelled', 'canceled', 'deleted'].includes(text(sourceSale.status))) fail('冲抵来源销售链缺失或归属不一致')
					saleSnapshot(sourceSale) // Includes authoritative legacy classification guard.
					sourceSales.set(row.source_id, sourceSale)
				}
				await guard({ targetType: 'sale', targetId: row.source_id })
			}
			await guard({ receiptId: row._id })
			const links = await all('crm_customer_allocations', { receipt_id: row._id }, 'sale_offset_use_source_backing')
			let linkedAmount = 0, linkedRounding = 0, linkedRefund = 0
			for (const link of links.filter(live)) {
				if (text(link.customer_id) !== value.customer_id || (link.target_id && link.sale_id && link.target_id !== link.sale_id)) fail('冲抵来源存在跨客户或不一致分配')
				const n = cash.units(link.allocate_amount, '来源分配')
				if (!(n > 0) || !['', 'receipt', 'rounding'].includes(text(link.allocate_kind))) fail('冲抵来源分配金额或类型无效')
				if (link.allocate_kind === 'rounding') linkedRounding += n; else linkedAmount += n
				await guard({ allocationId: link._id })
			}
			for (const refund of receipts.filter(item => item.status === 'posted')) {
				if (refund.source_type === 'customer_cash_refund') {
					const matches = (refund.refund_sources || []).filter(link => text(link.id) === text(row._id))
					if (matches.length > 1) fail('退款来源重复关联')
					if (matches.length) {
						const refundLinks = refund.refund_sources || [], ids = refundLinks.map(link => text(link.id))
						const linkedTotal = refundLinks.reduce((sum, link) => {
							const n = cash.units(link.amount, '退款来源合计')
							if (!(n > 0)) fail('退款来源金额无效')
							return sum + n
						}, 0)
						if (ids.some(id => !id) || new Set(ids).size !== ids.length || linkedTotal !== -cash.units(refund.amount, '实际退款')) fail('实际退款金额与全部来源背书不一致')
					}
					for (const link of matches) {
						const n = cash.units(link.amount, '退款关联')
						if (!(n > 0) || !(cash.units(refund.amount, '实际退款') < 0)) fail('退款金额或方向不一致')
						linkedRefund += n
					}
				} else if (refund.source_type === 'offset_credit_cash_refund' && text(refund.offset_source_receipt_id || refund.source_id) === text(row._id)) {
					const n = -cash.units(refund.amount, '实际退款')
					if (!(n > 0)) fail('实际退款方向无效')
					linkedRefund += n
				}
			}
			if (linkedAmount !== allocated || linkedRounding !== rounding || linkedRefund !== refunded) fail('冲抵来源与分配或退款背书不一致', { receipt_id: row._id })
			// Sales settle in cents even for a customer whose other ledgers use mills.
			// A fractional cent is retained in its source rather than rounded upward.
			const applyCents = Math.min(remaining, Math.floor(available / centUnits))
			if (!applyCents) continue
			if (plans.length >= 30) fail('本单需使用超过30笔冲抵来源，请在客户对账中分批处理', {}, 400)
			plans.push({ row, links, amount: applyCents * centUnits, allocated, available,
				seq: links.reduce((n, link) => Math.max(n, Number(link.seq) || 0), 0) + 1 })
			remaining -= applyCents
		}
		return { customer, sale, snapshot, plans, sourceSales: [...sourceSales.values()], targetLinks, cash, cents, should, received, rounded, applied: outstanding - remaining, outstanding }
	}
	async function run(data, user) {
		const value = input(data)
		if (!user || !['superadmin', 'admin', 'finance', 'user'].includes(text(user.role))) fail('当前账号无销售冲抵权限', {}, 403)
		const prior = await operation(db, value)
		if (prior.status === 'saved') return { ...await refresh(value, prior.result), idempotent: true }
		if (!db.startTransaction) fail('数据库不支持事务，未执行冲抵', {}, 503)
		const scope = await prepare(value)
		const tx = await db.startTransaction(), started = Date.now()
		let committed = false
		const budget = () => { if (Date.now() - started >= 8000) fail('冲抵事务超出安全时限，请用原操作号查询或重试', {}, 503) }
		const same = async (table, row) => { budget(); if (digest(await read(tx, table, row._id, true)) !== digest(row)) fail('销售或来源账务已变化，请查询原操作后重试') }
		try {
			const saved = await operation(tx, value)
			if (saved.status === 'saved') { await tx.rollback(); return { ...await refresh(value, saved.result), idempotent: true } }
			await same('crm_customers', scope.customer); await same('crm_sale_records', scope.sale)
			for (const row of scope.sourceSales) await same('crm_sale_records', row)
			for (const plan of scope.plans) await same('crm_customer_receipts', plan.row)
			const now = Date.now(), actor = { updated_at: now, updated_by: text(user._id), updated_by_name: text(user.username) }
			await tx.collection('crm_customers').doc(value.customer_id).update({ receipt_allocation_revision: value.operation_id, updated_at: now })
			const nextReceived = scope.received + scope.applied, nextPaid = nextReceived + scope.rounded
			const status = nextPaid >= scope.should ? 'paid' : nextPaid > 0 ? 'partial' : 'unpaid'
			budget(); await tx.collection('crm_sale_records').doc(value.sale_id).update({
				...(scope.applied > 0 ? { amount_received: scope.cents.money(nextReceived), payment_status: status, updated_at: now } : {}),
				apply_offset_credit: false, offset_use_status: 'completed', offset_use_completed_at: now
			})
			const appliedReceipts = []
			for (const plan of scope.plans) {
				budget()
				const receiptId = text(plan.row._id), allocationId = 'sale-use-link-' + digest([value.customer_id, value.operation_id, receiptId]).slice(0, 40)
				if (await read(tx, 'crm_customer_allocations', allocationId)) fail('本次分配编号已有记录但操作日志缺失，须先核对')
				await tx.collection('crm_customer_receipts').doc(receiptId).update({ allocated_amount: scope.cash.money(plan.allocated + plan.amount), unallocated_amount: scope.cash.money(plan.available - plan.amount), ...actor })
				await tx.collection('crm_customer_allocations').add({ _id: allocationId, receipt_id: receiptId, customer_id: value.customer_id, customer_name: text(scope.customer.name),
					sale_id: value.sale_id, sale_date: text(scope.sale.date), target_type: 'sale', target_id: value.sale_id, target_title: `销售单 ${text(scope.sale.date)}`,
					biz_date: text(plan.row.biz_date), allocate_kind: 'receipt', allocate_amount: scope.cash.money(plan.amount), seq: plan.seq,
					receipt_source_type: plan.row.source_type, receipt_entry_kind: plan.row.entry_kind || 'offset_credit', receipt_biz_date: text(plan.row.biz_date),
					allocation_mode: 'checked', allocation_start_date: '', allocation_end_date: '', allocation_targets: [{ target_type: 'sale', target_id: value.sale_id }],
					source_type: 'sale_offset_use', source_id: receiptId, request_id: value.operation_id, note: '销售单使用冲抵款', created_at: now, created_by: text(user._id), created_by_name: text(user.username) })
				appliedReceipts.push({ receipt_id: receiptId, allocation_id: allocationId, allocated_amount: scope.cash.money(plan.amount), unallocated_amount: scope.cash.money(plan.available - plan.amount) })
			}
			const result = { status: 'completed', operation_version: VERSION, customer_id: value.customer_id, sale_id: value.sale_id, operation_id: value.operation_id,
				applied_amount: scope.cents.money(scope.applied), applied_receipts: appliedReceipts, applied_source_count: appliedReceipts.length,
				payment_status: status, amount_received: scope.cents.money(nextReceived), outstanding: scope.cents.money(Math.max(0, scope.should - nextPaid)), balance_refresh_pending: true }
			budget()
			await tx.collection('crm_operation_logs').add({ _id: key(value), action: ACTION, request_id: value.operation_id, user_id: text(user._id), username: text(user.username), created_at: now,
				detail: { fingerprint: digest(value), customer_id: value.customer_id, sale_id: value.sale_id, operation_id: value.operation_id, result,
					before: { sale: scope.sale, receipts: scope.plans.map(plan => plan.row) }, source_versions: scope.plans.map(plan => ({ receipt_id: plan.row._id, version: digest(plan.row) })) } })
			budget(); await tx.commit(); committed = true
			return refresh(value, result)
		} catch (error) { if (!committed) await tx.rollback().catch(() => {}); throw error }
	}
	return { run, getOperation }
}

module.exports = { createService, VERSION }
