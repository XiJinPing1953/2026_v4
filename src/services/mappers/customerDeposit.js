export const CUSTOMER_DEPOSIT_RULE_VERSION = 'customer-deposit/2026-09-12.1'
export const CUSTOMER_DEPOSIT_KINDS = [
	{ value: 'receive', label: '收取押金' },
	{ value: 'refund', label: '退还押金' },
	{ value: 'opening', label: '期初押金转入' },
	{ value: 'transfer', label: '押金转气款' }
]
export const CUSTOMER_DEPOSIT_CHANNELS = [
	{ value: 'unknown', label: '渠道待核' },
	{ value: 'cash', label: '现金' },
	{ value: 'bank', label: '银行转账' },
	{ value: 'wechat', label: '微信' },
	{ value: 'alipay', label: '支付宝' },
	{ value: 'check', label: '支票' }
]

const balanceFields = ['current_balance', 'opening_balance', 'received_total', 'refunded_total', 'transferred_total', 'opening_transferred_total', 'closing_balance']

export function depositAmountCents(value) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
	const cents = Math.round(value * 100)
	if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) return null
	return cents
}

export function parseDepositAmount(value) {
	const text = String(value ?? '').trim()
	if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
	const [whole, fraction = ''] = text.split('.')
	const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
	return Number.isSafeInteger(cents) && cents > 0 ? cents / 100 : null
}

export function isDepositDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const date = new Date(`${value}T00:00:00Z`)
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function depositKindLabel(value) {
	return CUSTOMER_DEPOSIT_KINDS.find(item => item.value === value)?.label || '类型待核'
}

export function depositChannelLabel(value) {
	return CUSTOMER_DEPOSIT_CHANNELS.find(item => item.value === value)?.label || '渠道待核'
}

export function depositMoneyText(value) {
	return depositAmountCents(value) == null ? '未完成' : value.toFixed(2)
}

export function normalizeCustomerDepositStatement(value, expected = {}) {
	if (!value || value.rule_version !== CUSTOMER_DEPOSIT_RULE_VERSION || value.read_complete !== true) return null
	if (typeof value.customer_id !== 'string' || !value.customer_id) return null
	if (expected.customerId != null && value.customer_id !== expected.customerId) return null
	if (typeof value.account_initialized !== 'boolean' || !['not_initialized', 'not_confirmed', 'opening_recorded'].includes(value.history_status)) return null
	if (value.money_scale !== 2 || !Number.isSafeInteger(value.version) || value.version < 0 || !Array.isArray(value.entries)) return null
	if (expected.dateFrom != null && value.date_from !== expected.dateFrom) return null
	if (expected.dateTo != null && value.date_to !== expected.dateTo) return null
	if (balanceFields.some(field => depositAmountCents(value[field]) == null)) return null
	const calculated = depositAmountCents(value.opening_balance) + depositAmountCents(value.received_total)
		+ depositAmountCents(value.opening_transferred_total) - depositAmountCents(value.refunded_total) - depositAmountCents(value.transferred_total)
	if (!Number.isSafeInteger(calculated) || calculated !== depositAmountCents(value.closing_balance)) return null
	const ids = new Set()
	for (const entry of value.entries) {
		const id = entry?.entry_id || entry?._id
		if (typeof id !== 'string' || !id || ids.has(id)) return null
		if (entry.customer_id != null && entry.customer_id !== value.customer_id) return null
		if (entry.kind !== 'void' && !CUSTOMER_DEPOSIT_KINDS.some(item => item.value === entry.kind)) return null
		if (!(depositAmountCents(entry.amount) > 0) || !isDepositDate(entry.biz_date)) return null
		if (!CUSTOMER_DEPOSIT_CHANNELS.some(item => item.value === entry.payment_method)) return null
		if (!['posted', 'void'].includes(entry.status)) return null
		ids.add(id)
	}
	return { ...value, entries: value.entries.map(entry => ({ ...entry, entry_id: entry.entry_id || entry._id })) }
}

export function buildDepositEntryInput(form, customerId) {
	const amount = parseDepositAmount(form.amount)
	if (!customerId || !amount || !isDepositDate(form.bizDate)) return null
	if (!CUSTOMER_DEPOSIT_KINDS.some(item => item.value === form.kind)) return null
	if (!CUSTOMER_DEPOSIT_CHANNELS.some(item => item.value === form.paymentMethod)) return null
	return {
		customer_id: customerId,
		kind: form.kind,
		amount,
		biz_date: form.bizDate,
		payment_method: ['opening', 'transfer'].includes(form.kind) ? 'unknown' : form.paymentMethod,
		voucher_ref: String(form.voucherRef || '').trim(),
		note: String(form.note || '').trim()
	}
}

// Only business content identifies a retry. The account version comes from each preview.
export function depositOperationFingerprint(input) {
	return JSON.stringify([
		input.customer_id, input.kind || 'void', input.amount ?? null, input.biz_date || '',
		input.payment_method || '', input.voucher_ref || '', input.note || '', input.entry_id || '', input.reason || ''
	])
}

export function normalizeDepositPreview(value) {
	if (!value || depositAmountCents(value.before_balance) == null || depositAmountCents(value.after_balance) == null) return null
	if (!Number.isSafeInteger(value.current_version) || value.current_version < 0) return null
	return value
}

export function normalizeDepositOperation(value, expected = {}) {
	if (!value || value.customer_id !== expected.customerId || value.operation_id !== expected.operationId) return null
	if (value.found === false) return value
	const entry = value.entry
	const entryId = entry?._id || entry?.entry_id
	if (typeof entryId !== 'string' || !entryId) return null
	if (entry.customer_id != null && entry.customer_id !== value.customer_id) return null
	if (entry.operation_id != null && entry.operation_id !== value.operation_id) return null
	if (entry.kind !== 'void' && !CUSTOMER_DEPOSIT_KINDS.some(item => item.value === entry.kind)) return null
	if (!(depositAmountCents(entry.amount) > 0) || !isDepositDate(entry.biz_date)) return null
	if (!CUSTOMER_DEPOSIT_CHANNELS.some(item => item.value === entry.payment_method) || !['posted', 'void'].includes(entry.status)) return null
	if (depositAmountCents(value.balance) == null || !Number.isSafeInteger(value.version) || value.version < 1) return null
	return value
}
