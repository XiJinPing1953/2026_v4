'use strict'

const KINDS = ['rounding_reversal', 'prepay_writeoff']
const text = value => String(value ?? '').trim()
const isCustomerAdjustment = row => Boolean(row && row.source_type === 'balance_adjustment' && KINDS.includes(row.adjustment_kind))

async function assertCustomerAdjustmentSourceMutable({ db, command, readComplete, customerId, receiptId = '', targetType = '', targetId = '', allocationId = '' }) {
	const rows = await readComplete(db.collection('crm_customer_opening_debts'), { customer_id: text(customerId) },
		{ command, source: 'customer_adjustment_dependencies' })
	const dependency = rows.find(row => {
		if (!isCustomerAdjustment(row) || row.status !== 'posted') return false
		const source = row.adjustment_source || {}
		return (targetId && row._id === targetId) || (receiptId && source.receipt_id === receiptId) ||
			(allocationId && source.type === 'receipt_rounding_allocation' && source.id === allocationId) ||
			(targetId && source.target_id === targetId && source.target_type === targetType)
	})
	if (dependency) throw Object.assign(new Error('该来源已有抹零冲回或多收款结清记录，请先核对并作废关联调整，不能整单重置或删除'),
		{ code: 409, details: { adjustment_id: dependency._id, kind: dependency.adjustment_kind } })
}

module.exports = { KINDS, isCustomerAdjustment, assertCustomerAdjustmentSourceMutable }
