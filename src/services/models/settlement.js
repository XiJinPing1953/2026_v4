const PAYMENT_METHODS = ['on_account', 'cash', 'bank', 'wechat', 'alipay', 'check']
const SETTLEMENT_MODES = ['sale', 'customer_flow']

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizePaymentStatus(value) {
	const text = normalizeString(value)
	if (!text) return 'unpaid'
	if (text === '已结清' || text === 'paid') return 'paid'
	if (text === '部分付' || text === 'partial') return 'partial'
	if (text === '未付款' || text === 'unpaid' || text === '挂账') return 'unpaid'
	return 'unpaid'
}

function normalizeSettlementMode(value, fallback = 'sale') {
	const text = normalizeString(value)
	if (SETTLEMENT_MODES.includes(text)) return text
	return fallback
}

function normalizePaymentMethod(value, { paymentStatus = '', settlementMode = 'sale', fallback = '' } = {}) {
	const mode = normalizeSettlementMode(settlementMode)
	const statusText = normalizeString(paymentStatus)
	const status = statusText ? normalizePaymentStatus(statusText) : ''
	if (mode === 'customer_flow') return 'on_account'

	const text = normalizeString(value).toLowerCase()
	let normalized = ''
	if (text === 'on_account' || text === '挂账') normalized = 'on_account'
	else if (text === 'cash' || text === '现金') normalized = 'cash'
	else if (text === 'bank' || text === '银行' || text === '转账' || text === '银行转账') normalized = 'bank'
	else if (text === 'wechat' || text === '微信') normalized = 'wechat'
	else if (text === 'alipay' || text === '支付宝') normalized = 'alipay'
	else if (text === 'check' || text === 'cheque' || text === '支票') normalized = 'check'
	else if (PAYMENT_METHODS.includes(text)) normalized = text

	if (!normalized) {
		const fallbackText = normalizeString(fallback).toLowerCase()
		if (PAYMENT_METHODS.includes(fallbackText)) normalized = fallbackText
	}
	if (!normalized) normalized = status === 'unpaid' ? 'on_account' : 'cash'

	if (status === 'unpaid') return 'on_account'
	if (status && status !== 'unpaid' && normalized === 'on_account') return 'cash'
	return normalized
}

function resolveEffectiveShouldReceive(shouldReceive, roundingAmount) {
	const should = Number(toFixed2(shouldReceive))
	const rounding = Math.max(Number(toFixed2(roundingAmount)), 0)
	if (should > 0) return Number(toFixed2(should - rounding))
	if (should < 0) return Number(toFixed2(should + rounding))
	return 0
}

function computeSettlementOutstanding(shouldReceive, amountReceived, roundingAmount = 0) {
	const effectiveShould = resolveEffectiveShouldReceive(shouldReceive, roundingAmount)
	const received = Number(toFixed2(amountReceived))
	return Number(toFixed2(effectiveShould - received))
}

function getPaymentMethodLabel(method) {
	const normalized = normalizePaymentMethod(method, { fallback: 'on_account' })
	if (normalized === 'cash') return '现金'
	if (normalized === 'bank') return '银行转账'
	if (normalized === 'wechat') return '微信'
	if (normalized === 'alipay') return '支付宝'
	if (normalized === 'check') return '支票'
	return '挂账'
}

function toFixed2(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return num.toFixed(2)
}

export {
	PAYMENT_METHODS,
	normalizePaymentStatus,
	normalizeSettlementMode,
	normalizePaymentMethod,
	resolveEffectiveShouldReceive,
	computeSettlementOutstanding,
	getPaymentMethodLabel
}
