'use strict'

const CONFIRM_TEXT = 'CONVERT_OFFSET_CREDIT_TO_CASH_REFUND'
// Deliberately does not start with sale_offset_credit: reporting must count this
// negative receipt as real cash while the linked source remains non-cash.
const SOURCE_TYPE = 'offset_credit_cash_refund'
const OPERATION_VERSION = 'offset-credit-cash-refund/2026-09-12.1'

const text = value => String(value == null ? '' : value).trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : ''
const fix = (value, scale) => Number(number(value).toFixed(scale))

function isOffsetSource(row) {
	return text(row && row.source_type).startsWith('sale_offset_credit') ||
		['offset_credit', 'offset'].includes(text(row && row.entry_kind).toLowerCase())
}

function buildOffsetCreditRefundPlan({ source, customerId, refundAmount, refundDate, operationId, expected = {}, moneyScale = 2 }) {
	if (!source || !text(source._id)) return { ok: false, code: 404, reason: 'offset_source_missing' }
	if (text(source.customer_id) !== text(customerId)) return { ok: false, code: 400, reason: 'offset_source_customer_mismatch' }
	if (text(source.status) !== 'posted') return { ok: false, code: 409, reason: 'offset_source_not_posted' }
	if (!isOffsetSource(source)) return { ok: false, code: 400, reason: 'not_offset_credit_source' }
	if (!text(operationId)) return { ok: false, code: 400, reason: 'operation_id_required' }
	if (!date(refundDate)) return { ok: false, code: 400, reason: 'refund_date_required' }
	const amount = fix(refundAmount, moneyScale)
	const sourceAmount = fix(source.amount, moneyScale)
	const allocated = fix(source.allocated_amount, moneyScale)
	const rounding = fix(source.rounding_allocated_amount, moneyScale)
	const available = fix(source.unallocated_amount, moneyScale)
	const refunded = fix(source.offset_cash_refunded_amount, moneyScale)
	if (sourceAmount !== fix(allocated + rounding + available + refunded, moneyScale)) {
		return { ok: false, code: 409, reason: 'offset_source_balance_incomplete', source_amount: sourceAmount,
			components_total: fix(allocated + rounding + available + refunded, moneyScale) }
	}
	if (!(amount > 0)) return { ok: false, code: 400, reason: 'refund_amount_must_be_positive' }
	if (amount > available) return { ok: false, code: 409, reason: 'refund_exceeds_unallocated_offset', available_amount: available }
	const locks = [
		['updated_at', number(source.updated_at), expected.updated_at],
		['amount', sourceAmount, expected.amount],
		['allocated_amount', allocated, expected.allocated_amount],
		['rounding_allocated_amount', rounding, expected.rounding_allocated_amount],
		['unallocated_amount', available, expected.unallocated_amount],
		['offset_cash_refunded_amount', refunded, expected.offset_cash_refunded_amount]
	]
	for (const [field, actual, supplied] of locks) {
		if (supplied == null || supplied === '') return { ok: false, code: 400, reason: `expected_${field}_required` }
		const wanted = field === 'updated_at' ? number(supplied) : fix(supplied, moneyScale)
		if (actual !== wanted) return { ok: false, code: 409, reason: 'source_version_conflict', field, expected: wanted, actual }
	}
	return {
		ok: true,
		operation_version: OPERATION_VERSION,
		operation_id: text(operationId), customer_id: text(customerId), source_receipt_id: text(source._id),
		refund_date: date(refundDate), refund_amount: amount,
		before: { amount: sourceAmount, allocated_amount: allocated, rounding_allocated_amount: rounding, unallocated_amount: available,
			offset_cash_refunded_amount: refunded, updated_at: number(source.updated_at) },
		after: { unallocated_amount: fix(available - amount, moneyScale), offset_cash_refunded_amount: fix(refunded + amount, moneyScale) },
		refund_receipt: { amount: -amount, biz_date: date(refundDate), status: 'posted', entry_kind: 'refund', source_type: SOURCE_TYPE }
	}
}

module.exports = { CONFIRM_TEXT, SOURCE_TYPE, OPERATION_VERSION, isOffsetSource, buildOffsetCreditRefundPlan }
