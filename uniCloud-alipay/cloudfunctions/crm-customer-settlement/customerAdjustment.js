'use strict'

const { digest } = require('./depositModel')
const { isOffsetCreditReceipt, isDepositTransferReceipt, isSettlementFeeReceipt, isNonCashPrepayReceipt } = require('./receiptSource')
const guard = require('./customerAdjustmentGuardLocal')
const VERSION = 'customer-adjustment/2026-10-12.1'
const TABLES = { sales: 'crm_sale_records', flows: 'crm_customer_flow_settlements', debts: 'crm_customer_opening_debts',
	receipts: 'crm_customer_receipts', allocations: 'crm_customer_allocations' }
const text = value => String(value ?? '').trim()
const active = row => row && (!row.status || row.status === 'posted')
const fail = (message, code = 409, details = {}) => { throw Object.assign(new Error(message), { code, details }) }
const document = result => Array.isArray(result?.data) ? (result.data.length === 1 ? result.data[0] : null) : result?.data || null
const keyOf = row => `${text(row.target_type || 'sale')}:${text(row.target_id || row.sale_id || row.flow_settlement_id)}`
const sorted = rows => [...rows].sort((a, b) => text(a._id).localeCompare(text(b._id)))
const clone = value => JSON.parse(JSON.stringify(value))
const operationKey = (cid, id) => digest(['customer-adjustment-operation', cid, id]).slice(0, 24)

function createAdjustmentService({ db, command, readComplete, moneyScale, saleSnapshot, flowSnapshot, debtSnapshot, balancePatch, resolveCustomer }) {
	const complete = (table, where) => readComplete(db.collection(table), where, { command, source: `customer_adjustment.${table}` })
	const get = async (store, id) => document(await store.doc(id).get())
	const fixed = async (store, id) => document(await store.where({ _id: id }).limit(1).get())
	const scaleOf = customer => Number(moneyScale(customer)) === 3 ? 3 : 2
	function units(value, scale, label = '金额') {
		if (!['number', 'string'].includes(typeof value) || text(value) === '') fail(`${label}缺失或无效`)
		const number = Number(value), n = Math.round(number * 10 ** scale)
		if (!Number.isFinite(number) || !Number.isSafeInteger(n) || Math.abs(number * 10 ** scale - n) > 0.00001 || n < 0) fail(`${label}无效或超过允许精度`)
		return n
	}
	const num = (value, scale) => units(value ?? 0, scale) / 10 ** scale
	function validDate(value) {
		const date = text(value)
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail('业务日期无效', 400)
		return date
	}
	async function customerDoc(cid) {
		if (!cid) fail('客户编号必填', 400)
		const customer = resolveCustomer ? await resolveCustomer(cid) : await get(db.collection('crm_customers'), cid)
		if (!customer || customer._id !== cid) fail('客户不存在', 404)
		return customer
	}
	async function scope(cid) {
		const customer = await customerDoc(cid)
		const result = { customer }
		await Promise.all(Object.entries(TABLES).map(async ([key, table]) => { result[key] = sorted(await complete(table, { customer_id: cid })) }))
		return result
	}
	function targets(s) {
		const scale = scaleOf(s.customer)
		return [
			...s.sales.filter(active).map(row => ({ row, type: 'sale', date: row.date, value: saleSnapshot(row) })),
			...s.flows.filter(row => row.status === 'posted').map(row => ({ row, type: 'flow_settlement', date: row.biz_date, value: flowSnapshot(row) })),
			...s.debts.filter(row => row.status === 'posted').map(row => ({ row,
				type: row.source_type === 'balance_adjustment' ? 'balance_adjustment' : text(row.source_type).includes('other_fee') ? 'other_fee' : 'opening_debt',
				date: row.biz_date, value: debtSnapshot(row, Number(row.money_scale) === 3 ? 3 : scale) }))
		]
	}
	function adjustmentView(row) {
		return { id: row._id, adjustment_id: row._id, kind: row.adjustment_kind, date: row.biz_date, biz_date: row.biz_date, amount: row.amount,
			status: row.status, note: row.note, evidence: row.adjustment_evidence, source: row.adjustment_source,
			operation_id: row.adjustment_operation_id, version: digest(row), void_reason: row.void_reason || '' }
	}
	function sourceList(s, kind) {
		if (!guard.KINDS.includes(kind)) fail('调整类型无效', 400)
		const scale = scaleOf(s.customer), divisor = 10 ** scale
		const adjustments = s.debts.filter(guard.isCustomerAdjustment), posted = adjustments.filter(row => row.status === 'posted')
		const sources = [], pending = []
		const map = new Map(targets(s).map(item => [`${item.type}:${item.row._id}`, item]))
		function add(type, row, amount, date, label, refs, backing = []) {
			const sourceKey = `${type}:${refs.target_type ? refs.target_type + ':' : ''}${row._id}`
			const related = posted.filter(item => item.adjustment_kind === kind && item.adjustment_source?.source_key === sourceKey)
			const processed = related.reduce((sum, item) => sum + units(item.amount, scale), 0)
			const total = units(amount, scale)
			if (kind === 'rounding_reversal' && processed > total) fail('累计冲回超过原抹零，需核对来源')
			const available = kind === 'prepay_writeoff' ? units(row.unallocated_amount, scale) : total - processed
			sources.push({ source_key: sourceKey, version: digest({ row, backing: sorted(backing), related: sorted(related) }), type,
				id: row._id, date: text(date), label, amount: total / divisor, processed: processed / divisor, available: available / divisor, ...refs })
		}
		if (kind === 'prepay_writeoff') {
			for (const row of s.receipts) {
				if (row.status !== 'posted' || !(Number(row.amount) > 0) || isOffsetCreditReceipt(row) || isDepositTransferReceipt(row) ||
					isSettlementFeeReceipt(row) || row.receipt_adjustment_status === 'pending' || !(Number(row.unallocated_amount) > 0)) continue
				const own = s.allocations.filter(item => item.receipt_id === row._id && active(item))
				const allocated = own.filter(item => (item.allocate_kind || 'receipt') === 'receipt').reduce((sum, item) => sum + units(item.allocate_amount, scale), 0)
				const rounding = own.filter(item => item.allocate_kind === 'rounding').reduce((sum, item) => sum + units(item.allocate_amount, scale), 0)
				if (allocated !== units(row.allocated_amount, scale) || rounding !== units(row.rounding_allocated_amount ?? 0, scale) ||
					units(row.amount, scale) !== allocated + units(row.unallocated_amount, scale) + units(row.cash_refunded_amount ?? 0, scale) ||
					own.some(item => !['receipt', 'rounding'].includes(item.allocate_kind || 'receipt'))) {
					pending.push({ id: row._id, reason: '来源收款与有效分配不守恒' }); continue
				}
				add('receipt_credit', row, row.amount, row.biz_date, row.source_type === 'opening_prepay' ? '期初预付款余款' : '收款可用余款', { receipt_id: row._id }, own)
			}
		} else {
			for (const item of map.values()) {
				if (guard.isCustomerAdjustment(item.row) || !(Number(item.value.should_receive ?? item.row.amount ?? item.value.should_receive_effective) > 0)) continue
				const own = num(item.value.rounding_amount, scale)
				if (own > 0) add('target_rounding', item.row, own, item.date, '原单自身抹零', { target_type: item.type, target_id: item.row._id })
				const rows = s.allocations.filter(row => active(row) && row.allocate_kind === 'rounding' && keyOf(row) === `${item.type}:${item.row._id}`)
				const backed = rows.reduce((sum, row) => sum + units(row.allocate_amount, scale), 0)
				if (backed !== units(item.value.receipt_rounding_amount ?? 0, scale)) {
					if (backed || Number(item.value.receipt_rounding_amount)) pending.push({ id: item.row._id, reason: '原单内嵌抹零与正式分配背书不一致' })
					continue
				}
				for (const row of rows) {
					const receipt = s.receipts.find(r => r._id === row.receipt_id)
					if (!receipt || receipt.status !== 'posted' || receipt.receipt_adjustment_status === 'pending' || isOffsetCreditReceipt(receipt)) {
						pending.push({ id: row._id, reason: '抹零缺少有效正式收款来源' }); continue
					}
					const related = s.allocations.filter(r => active(r) && r.receipt_id === receipt._id && r.allocate_kind === 'rounding')
					if (related.reduce((sum, r) => sum + units(r.allocate_amount, scale), 0) !== units(receipt.rounding_allocated_amount ?? 0, scale)) {
						pending.push({ id: row._id, reason: '正式收款抹零与分配不一致' }); continue
					}
					const date = ['prepay_manual_allocate', 'receipt_unallocated_allocate'].includes(row.source_type) || isNonCashPrepayReceipt(receipt) ? row.biz_date : receipt.biz_date
					add('receipt_rounding_allocation', row, row.allocate_amount, date, '正式收款抹零',
						{ target_type: item.type, target_id: item.row._id, receipt_id: receipt._id }, [receipt, item.row])
				}
			}
		}
		return { complete: true, money_scale: scale, sources, adjustments: adjustments.map(adjustmentView), pending }
	}
	function valueOf(data, scale) {
		const cid = text(data.customer_id), voidId = text(data.void_id)
		const value = { customer_id: cid, kind: text(data.kind), void_id: voidId, note: text(data.note), evidence: data.evidence ?? '' }
		if (!value.note || value.note.length > 1000) fail('请填写明确调整原因（不超过1000字）', 400)
		if (!['string', 'object'].includes(typeof value.evidence) || value.evidence === null || JSON.stringify(value.evidence).length > 8000) fail('确认依据格式无效或过长', 400)
		if (!voidId) {
			if (data.release_dependent_allocations === true) fail('解除后续分配仅用于抹零冲回作废', 400)
			if (!guard.KINDS.includes(value.kind)) fail('调整类型无效', 400)
			value.source_key = text(data.source_key); value.source_version = text(data.source_version)
			value.amount = units(data.amount, scale) / 10 ** scale
			if (!(value.amount > 0) || !value.source_key || !value.source_version) fail('来源、版本及正数调整金额必填', 400)
			value.biz_date = validDate(data.biz_date)
			value.confirm_no_refund_or_offset = data.confirm_no_refund_or_offset === true
			if (value.kind === 'prepay_writeoff' && !value.confirm_no_refund_or_offset) fail('请确认双方同意余款不再退款或抵扣', 400)
			if (value.kind === 'prepay_writeoff' && !JSON.stringify(value.evidence).replace(/[\s"{}\[\]]/g, '')) fail('请补充双方确认或原始凭据依据', 400)
		} else {
			value.source_version = text(data.source_version)
			value.release_dependent_allocations = data.release_dependent_allocations === true
		}
		return value
	}
	function releasePlan(s, original, own) {
		const scale = scaleOf(s.customer), divisor = 10 ** scale, receipts = [], affected = []
		let cash = 0, rounding = 0
		for (const row of own) {
			if (!['receipt', 'rounding'].includes(row.allocate_kind || 'receipt') || !units(row.allocate_amount, scale)) fail('后续分配类型或金额异常，不能解除')
			if (s.debts.some(debt => guard.isCustomerAdjustment(debt) && debt.status === 'posted' &&
				debt.adjustment_source?.type === 'receipt_rounding_allocation' && debt.adjustment_source.id === row._id)) fail('后续分配已被另一笔冲回引用，须先处理该笔冲回')
			const amount = units(row.allocate_amount, scale)
			if (row.allocate_kind === 'rounding') rounding += amount
			else cash += amount
		}
		if (cash !== units(original.amount_received, scale) || rounding !== units(original.receipt_rounding_amount ?? 0, scale) ||
			cash + rounding > units(original.amount, scale)) fail('冲回单已收及抹零与后续分配不一致，不能完整解除')
		for (const id of [...new Set(own.map(row => row.receipt_id))]) {
			const receipt = s.receipts.find(row => row._id === id)
			if (!receipt || receipt.status !== 'posted' || receipt.receipt_adjustment_status === 'pending' || isOffsetCreditReceipt(receipt) || isNonCashPrepayReceipt(receipt)) fail('后续分配关联待核或非现金特殊来源，不能自动解除')
			if (receipt.source_type === 'customer_cash_refund' || Number(receipt.cash_refunded_amount) > 0 || Number(receipt.offset_cash_refunded_amount) > 0 ||
				s.receipts.some(row => row.status === 'posted' && row.source_type === 'customer_cash_refund' &&
					(text(row.source_id) === id || (row.refund_sources || []).some(link => text(link.id) === id)))) fail('后续分配来源已有退款关联，不能自动解除')
			const all = s.allocations.filter(row => active(row) && row.receipt_id === id)
			if (all.some(row => !['receipt', 'rounding'].includes(row.allocate_kind || 'receipt'))) fail('后续分配来源存在未知分配类型，不能解除')
			const allocated = all.filter(row => (row.allocate_kind || 'receipt') === 'receipt').reduce((sum, row) => sum + units(row.allocate_amount, scale), 0)
			const rounded = all.filter(row => row.allocate_kind === 'rounding').reduce((sum, row) => sum + units(row.allocate_amount, scale), 0)
			const available = units(receipt.unallocated_amount, scale)
			if (allocated !== units(receipt.allocated_amount, scale) || rounded !== units(receipt.rounding_allocated_amount ?? 0, scale) ||
				units(receipt.amount, scale) !== allocated + available || units(receipt.rounding_amount ?? 0, scale) !== rounded) fail('后续分配来源金额与分配不守恒，不能解除')
			const selected = own.filter(row => row.receipt_id === id)
			const releasedCash = selected.filter(row => (row.allocate_kind || 'receipt') === 'receipt').reduce((sum, row) => sum + units(row.allocate_amount, scale), 0)
			const releasedRounding = selected.filter(row => row.allocate_kind === 'rounding').reduce((sum, row) => sum + units(row.allocate_amount, scale), 0)
			receipts.push({ before: receipt, patch: { allocated_amount: (allocated - releasedCash) / divisor, unallocated_amount: (available + releasedCash) / divisor,
				rounding_amount: (rounded - releasedRounding) / divisor, rounding_allocated_amount: (rounded - releasedRounding) / divisor } })
			for (const row of selected) affected.push({ allocation_id: row._id, receipt_id: id, receipt_date: text(receipt.biz_date),
				date: text(row.biz_date || receipt.biz_date), allocate_kind: row.allocate_kind || 'receipt', amount: units(row.allocate_amount, scale) / divisor })
		}
		return { receipts, affected, cash: cash / divisor, rounding: rounding / divisor }
	}
	async function dependencies(s, source, voidId = '', releaseReceiptIds = []) {
		const cid = s.customer._id
		if (s.receipts.some(row => row.status === 'posted' && row.refund_source_status === 'pending')) fail('客户存在来源待核退款，暂不能调整余额')
		const where = source.receipt_id ? { receipt_id: source.receipt_id } : command.or([{ target_id: source.target_id }, { sale_id: source.target_id }])
		const rows = await complete(TABLES.allocations, where)
		if (rows.some(row => row.customer_id !== cid)) fail('发现跨客户分配关联，未执行调整')
		const result = { rows: sorted(rows) }
		if (source.receipt_id) {
			const reverse = await complete(TABLES.receipts, { source_id: source.receipt_id })
			if (reverse.some(row => row.customer_id !== cid)) fail('发现跨客户收款关联，未执行调整')
			result.reverse = sorted(reverse)
			const store = db.collection('crm_customer_receipt_adjustments')
			let exists = true
			try { await store.where({ receipt_id: source.receipt_id }).count() }
			catch (error) { if (text(error.message) !== 'not found collection') throw error; exists = false }
			result.legacy_adjustments = exists ? sorted(await complete('crm_customer_receipt_adjustments', { receipt_id: source.receipt_id })) : []
			if (result.legacy_adjustments.some(row => row.status === 'pending')) fail('来源收款存在未完成的旧整单调整')
		}
		if (voidId) {
			const incoming = await complete(TABLES.allocations, command.or([{ target_id: voidId }, { sale_id: voidId }]))
			if (incoming.some(row => row.customer_id !== cid)) fail('调整单存在跨客户分配，不能作废')
			if (incoming.some(row => active(row) && keyOf(row) !== `balance_adjustment:${voidId}`)) fail('调整单后续分配目标类型异常，不能作废')
			result.incoming = sorted(incoming)
		}
		if (releaseReceiptIds.length) {
			result.release_sources = []
			for (const receiptId of [...new Set(releaseReceiptIds)].sort()) {
				const links = await dependencies(s, { receipt_id: receiptId })
				if (links.reverse.some(row => active(row) && (row.source_type === 'customer_cash_refund' || row.entry_kind === 'refund'))) fail('后续分配存在退款反向关联，不能解除')
				result.release_sources.push({ receipt_id: receiptId, links })
			}
		}
		return result
	}
	async function plan(data, s) {
		const scale = scaleOf(s.customer), value = valueOf(data, scale)
		let source, original = null, own = [], release = { receipts: [], affected: [], cash: 0, rounding: 0 }
		if (value.void_id) {
			original = s.debts.find(row => row._id === value.void_id)
			if (!guard.isCustomerAdjustment(original) || original.status !== 'posted') fail('调整单不存在或已作废')
			if (!value.source_version || value.source_version !== digest(original)) fail('调整单已变化，请重新查询并预览')
			value.kind = original.adjustment_kind
			if (!units(original.amount, scale) || units(original.rounding_amount ?? 0, scale)) fail('调整单金额或抹零状态异常，不能作废')
			if (value.release_dependent_allocations && value.kind !== 'rounding_reversal') fail('仅抹零冲回作废可以解除所列后续分配', 400)
			source = original.adjustment_source
			if (!source?.source_key) fail('调整单原始关联不完整，不能作废')
			own = s.allocations.filter(row => active(row) && keyOf(row) === `balance_adjustment:${original._id}`)
			if (s.debts.some(row => row.status === 'posted' && guard.isCustomerAdjustment(row) && row.adjustment_source?.target_id === original._id)) fail('该调整单已有后续调整依赖，不能作废')
			if (value.kind === 'rounding_reversal') {
				if (value.release_dependent_allocations) release = releasePlan(s, original, own)
				else if (own.length || num(original.amount_received, scale) || num(original.receipt_rounding_amount, scale)) fail('冲回应收已被收款或抵扣，请明确勾选解除所列后续分配，再预览作废', 409, { requires_allocation_release: true })
			} else {
				if (units(original.receipt_rounding_amount ?? 0, scale)) fail('调整单抹零状态异常，不能作废')
				const receipt = s.receipts.find(row => row._id === source.receipt_id)
				if (!receipt || receipt.status !== 'posted' || receipt.receipt_adjustment_status === 'pending' || own.length !== 1 ||
					own[0]._id !== original.adjustment_allocation_id || own[0].receipt_id !== receipt._id || own[0].source_type !== 'prepay_writeoff' ||
					units(original.amount_received, scale) !== units(original.amount, scale) || units(original.outstanding, scale) !== 0 ||
					units(own[0].allocate_amount, scale) !== units(original.amount, scale)) fail('清账原分配已变化，不能完整作废')
				const all = s.allocations.filter(row => active(row) && row.receipt_id === receipt._id && (row.allocate_kind || 'receipt') === 'receipt')
				if (all.reduce((sum, row) => sum + units(row.allocate_amount, scale), 0) !== units(receipt.allocated_amount, scale) ||
					units(receipt.amount, scale) !== units(receipt.allocated_amount, scale) + units(receipt.unallocated_amount, scale) + units(receipt.cash_refunded_amount ?? 0, scale)) fail('清账来源余额不守恒，不能作废')
			}
		} else {
			source = sourceList(s, value.kind).sources.find(row => row.source_key === value.source_key)
			if (!source || source.version !== value.source_version) fail('所选来源不存在或已变化，请重新选择并预览')
			if (value.amount > source.available) fail('金额超过该来源尚可处理余额')
			if (!source.date || value.biz_date < validDate(source.date)) fail('调整日期不能早于原来源日期')
		}
		const links = await dependencies(s, source, value.void_id, release.receipts.map(row => row.before._id))
		const amount = value.void_id ? num(original.amount, scale) : value.amount, sign = value.void_id ? -1 : 1
		const effects = { receivable_delta: value.kind === 'rounding_reversal' ? (value.void_id ? -(units(amount, scale) - units(release.cash, scale) - units(release.rounding, scale)) / 10 ** scale || 0 : amount) : 0,
			available_delta: value.kind === 'prepay_writeoff' ? -sign * amount : release.cash,
			income_delta: value.kind === 'prepay_writeoff' ? sign * amount : 0, cash_delta: 0 }
		const receiptEffects = release.receipts.map(({ before, patch }) => ({ receipt_id: before._id, date: text(before.biz_date),
			available_before: num(before.unallocated_amount, scale), available_after: patch.unallocated_amount,
			available_delta: (units(patch.unallocated_amount, scale) - units(before.unallocated_amount, scale)) / 10 ** scale,
			rounding_delta: (units(patch.rounding_amount, scale) - units(before.rounding_amount ?? 0, scale)) / 10 ** scale }))
		const current = await balancePatch(s, { operationId: 'preview', now: 0 }), fix = amount => Number(amount.toFixed(scale))
		const before = { receivable_balance: num(current.receivable_balance, scale), prepay_balance: num(current.prepay_balance, scale),
			net_balance: fix(Number(current.receivable_balance) - Number(current.prepay_balance)) }
		const after = { receivable_balance: fix(before.receivable_balance + effects.receivable_delta),
			prepay_balance: fix(before.prepay_balance + effects.available_delta) }
		after.net_balance = fix(after.receivable_balance - after.prepay_balance)
		return { value, source, original, own, effects, links, release, affected_allocations: release.affected, receipt_effects: receiptEffects,
			balances: { before, after },
			plan_hash: digest({ value, source, original, own, links, release, scope: s }) }
	}
	async function previous(cid, operationId) {
		return fixed(db.collection('crm_operation_logs'), operationKey(cid, operationId))
	}
	async function save(data, user, action) {
		const cid = text(data.customer_id), operationId = text(data.operation_id)
		if (!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) fail('固定操作号无效', 400)
		const customer = await customerDoc(cid), input = valueOf(data, scaleOf(customer))
		if ((action === 'voidCustomerAdjustmentV1') !== Boolean(input.void_id)) fail('操作与调整类型不匹配', 400)
		const fingerprint = digest(input), prior = await previous(cid, operationId)
		if (prior) {
			if (prior.detail?.fingerprint !== fingerprint) fail('该操作号已用于不同内容，请查询原结果')
			return { ...prior.detail.result, idempotent: true }
		}
		const s = await scope(cid)
		const p = await plan(data, s)
		if (text(data.plan_hash) !== p.plan_hash) fail('预览已变化，请重新预览后确认')
		if (typeof db.startTransaction !== 'function') fail('数据库事务不可用，未执行调整', 503)
		const now = Date.now(), id = digest(['customer-adjustment', cid, operationId]).slice(0, 24)
		const allocationId = digest(['customer-adjustment-allocation', id]).slice(0, 24)
		const projected = clone(s), updates = [], additions = [], removals = [], locks = []
		const update = (table, before, patch) => updates.push({ table, before, patch: { ...patch, updated_at: now } })
		const originalSource = p.source.type === 'receipt_credit' ? s.receipts.find(row => row._id === p.source.id)
			: p.source.type === 'receipt_rounding_allocation' ? s.allocations.find(row => row._id === p.source.id)
				: targets(s).find(item => item.type === p.source.target_type && item.row._id === p.source.target_id)?.row
		if (!originalSource) fail('原来源已经不存在，未执行调整')
		const sourceTable = p.source.type === 'receipt_credit' ? TABLES.receipts : p.source.type === 'receipt_rounding_allocation' ? TABLES.allocations
			: TABLES[p.source.target_type === 'sale' ? 'sales' : p.source.target_type === 'flow_settlement' ? 'flows' : 'debts']
		locks.push({ table: sourceTable, before: originalSource })
		if (p.source.receipt_id) locks.push({ table: TABLES.receipts, before: s.receipts.find(row => row._id === p.source.receipt_id) })
		if (p.source.target_id) locks.push({ table: TABLES[p.source.target_type === 'sale' ? 'sales' : p.source.target_type === 'flow_settlement' ? 'flows' : 'debts'],
			before: targets(s).find(item => item.type === p.source.target_type && item.row._id === p.source.target_id)?.row })
		let adjustment
		if (input.void_id) {
			adjustment = p.original
			update(TABLES.debts, adjustment, { status: 'void', adjustment_void_operation_id: operationId, void_reason: input.note, void_evidence: input.evidence,
				...(p.release.affected.length ? { amount_received: 0, receipt_rounding_amount: 0, outstanding: adjustment.amount, payment_status: 'unpaid' } : {}),
				void_at: now, void_by: user._id })
			Object.assign(projected.debts.find(row => row._id === adjustment._id), updates.at(-1).patch)
			if (adjustment.adjustment_kind === 'prepay_writeoff') {
				const receipt = s.receipts.find(row => row._id === p.source.receipt_id), amount = num(adjustment.amount, scaleOf(s.customer))
				const scale = scaleOf(s.customer), divisor = 10 ** scale
				update(TABLES.receipts, receipt, { allocated_amount: (units(receipt.allocated_amount, scale) - units(amount, scale)) / divisor,
					unallocated_amount: (units(receipt.unallocated_amount, scale) + units(amount, scale)) / divisor })
				Object.assign(projected.receipts.find(row => row._id === receipt._id), updates.at(-1).patch)
				removals.push({ table: TABLES.allocations, before: p.own[0] })
				projected.allocations = projected.allocations.filter(row => row._id !== p.own[0]._id)
			}
			for (const { before, patch } of p.release.receipts) {
				update(TABLES.receipts, before, patch)
				Object.assign(projected.receipts.find(row => row._id === before._id), updates.at(-1).patch)
			}
			if (p.release.affected.length) {
				for (const row of p.own) removals.push({ table: TABLES.allocations, before: row })
				const ids = new Set(p.own.map(row => row._id))
				projected.allocations = projected.allocations.filter(row => !ids.has(row._id))
			}
		} else {
			const source = Object.fromEntries(['source_key', 'type', 'id', 'target_type', 'target_id', 'receipt_id', 'date', 'label'].filter(key => p.source[key] !== undefined).map(key => [key, p.source[key]]))
			const writeoff = input.kind === 'prepay_writeoff'
			adjustment = { _id: id, customer_id: cid, customer_name: text(s.customer.name), source_type: 'balance_adjustment',
				adjustment_kind: input.kind, adjustment_source: source, adjustment_operation_id: operationId, adjustment_evidence: input.evidence,
				adjustment_rule_version: VERSION, money_scale: scaleOf(s.customer), biz_date: input.biz_date, amount: input.amount,
				rounding_amount: 0, receipt_rounding_amount: 0, amount_received: writeoff ? input.amount : 0,
				outstanding: writeoff ? 0 : input.amount, payment_status: writeoff ? 'paid' : 'unpaid', status: 'posted', note: input.note,
				created_at: now, updated_at: now, created_by: user._id, created_by_name: text(user.username), request_id: operationId }
			if (writeoff) {
				adjustment.adjustment_allocation_id = allocationId
				const receipt = originalSource, scale = scaleOf(s.customer)
				update(TABLES.receipts, receipt, { allocated_amount: (units(receipt.allocated_amount, scale) + units(input.amount, scale)) / 10 ** scale,
					unallocated_amount: (units(receipt.unallocated_amount, scale) - units(input.amount, scale)) / 10 ** scale })
				Object.assign(projected.receipts.find(row => row._id === receipt._id), updates.at(-1).patch)
				const allocation = { _id: allocationId, customer_id: cid, customer_name: text(s.customer.name), receipt_id: receipt._id,
					target_type: 'balance_adjustment', target_id: id, sale_id: id, sale_date: input.biz_date, target_title: '多收款结清',
					allocate_kind: 'receipt', allocate_amount: input.amount, source_type: 'prepay_writeoff', source_id: id,
					biz_date: input.biz_date, allocation_mode: 'checked', status: 'posted',
					seq: 1 + s.allocations.filter(row => row.receipt_id === receipt._id).reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0),
					note: input.note, created_at: now, updated_at: now, created_by: user._id, created_by_name: text(user.username), request_id: operationId }
				additions.push({ table: TABLES.allocations, row: allocation }); projected.allocations.push(allocation)
			}
			additions.push({ table: TABLES.debts, row: adjustment }); projected.debts.push(adjustment)
		}
		const customerPatch = await balancePatch(projected, { operationId, now })
		const result = { status: input.void_id ? 'voided' : 'saved', operation_id: operationId, adjustment_id: adjustment._id,
			kind: adjustment.adjustment_kind, amount: adjustment.amount, effects: p.effects, balances: customerPatch,
			affected_allocations: p.affected_allocations, receipt_effects: p.receipt_effects }
		const audit = { _id: operationKey(cid, operationId), action: input.void_id ? 'customer_adjustment_void_v1' : 'customer_adjustment_post_v1',
			customer_id: cid, user_id: user._id, username: text(user.username), role: user.role, request_id: operationId, created_at: now,
			detail: { fingerprint, value: input, plan_hash: p.plan_hash, result, before: { customer: s.customer, updates: updates.map(row => ({ table: row.table, row: row.before })),
				sources: locks, removed: removals }, after: { customer_patch: customerPatch, updates: updates.map(row => ({ table: row.table, id: row.before._id, patch: row.patch })), added: additions } } }
		const tx = await db.startTransaction(); let commitAttempted = false
		const started = Date.now()
		const within = async fn => { if (Date.now() - started > 8500) fail('事务预算不足，未提交调整，请重新预览'); return fn() }
		const verify = async (table, before) => {
			if (!before || digest(await get(tx.collection(table), before._id)) !== digest(before)) fail('来源原值已变化，未提交调整')
		}
		try {
			await within(() => verify('crm_customers', s.customer))
			const transactionPrior = await within(() => fixed(tx.collection('crm_operation_logs'), audit._id))
			if (transactionPrior) fail('该操作已提交或并发执行，请查询原结果')
			const checks = [...locks, ...updates.map(row => ({ table: row.table, before: row.before })), ...removals]
			const checked = new Set()
			for (const check of checks) {
				const key = `${check.table}:${check.before?._id}`
				if (!checked.has(key)) { await within(() => verify(check.table, check.before)); checked.add(key) }
			}
			for (const row of additions) if (await within(() => fixed(tx.collection(row.table), row.row._id))) fail('确定单据编号已存在，请查询原结果')
			const updatedCustomer = await within(() => tx.collection('crm_customers').doc(cid).update(customerPatch))
			if (updatedCustomer.updated !== 1) fail('客户余额更新未命中，未提交调整')
			for (const row of updates) {
				const changed = await within(() => tx.collection(row.table).doc(row.before._id).update(row.patch))
				if (changed.updated !== 1) fail('来源更新未命中，未提交调整')
			}
			for (const row of removals) {
				const removed = await within(() => tx.collection(row.table).doc(row.before._id).remove())
				if (removed.deleted !== 1) fail('原分配移除未命中，未提交调整')
			}
			for (const row of additions) await within(() => tx.collection(row.table).add(row.row))
			await within(() => tx.collection('crm_operation_logs').add(audit))
			const outside = await within(() => scope(cid))
			if (digest(outside) !== digest(s) || digest(await within(() => dependencies(outside, p.source, input.void_id, p.release.receipts.map(row => row.before._id)))) !== digest(p.links)) fail('提交前客户账务范围已变化，未提交调整')
			await within(async () => { commitAttempted = true; await tx.commit() })
			return result
		} catch (error) {
			await tx.rollback().catch(() => {})
			if (commitAttempted) {
				const saved = await previous(cid, operationId).catch(() => null)
				if (saved?.detail?.fingerprint === fingerprint) return { ...saved.detail.result, idempotent: true, commit_recovered: true }
				error.details = { ...(error.details || {}), commit_status_unknown: true, operation_id: operationId }
				error.message = '提交状态未确定，请保留操作号查询结果，勿重复登记：' + error.message
			}
			throw error
		}
	}
	async function dispatch(action, data = {}, user = {}) {
		if (!user._id || !['superadmin', 'admin', 'finance'].includes(user.role)) fail('仅会计或管理员可处理账务调整', 403)
		if (action === 'postCustomerAdjustmentV1' || action === 'voidCustomerAdjustmentV1') return save(data, user, action)
		if (action === 'getCustomerAdjustmentOperationV1') {
			await customerDoc(text(data.customer_id))
			return (await previous(text(data.customer_id), text(data.operation_id)))?.detail?.result || { status: 'not_found', operation_id: text(data.operation_id) }
		}
		const s = await scope(text(data.customer_id))
		if (action === 'getCustomerAdjustmentSourcesV1') return sourceList(s, text(data.kind))
		if (action === 'previewCustomerAdjustmentV1') {
			const p = await plan(data, s)
			return { value: p.value, plan_hash: p.plan_hash, effects: p.effects, source: p.source,
				affected_allocations: p.affected_allocations, receipt_effects: p.receipt_effects, balances: p.balances }
		}
		fail('不支持的调整操作', 400)
	}
	async function run(action, data = {}, user = {}) {
		try { return await dispatch(action, data, user) }
		catch (error) {
			if (['postCustomerAdjustmentV1', 'voidCustomerAdjustmentV1'].includes(action) && !error.details?.commit_status_unknown) {
				error.details = { ...(error.details || {}), write_status: 'not_written' }
			}
			throw error
		}
	}
	return { run }
}

module.exports = { VERSION, createAdjustmentService, ...guard }
