'use strict'

// Evidence-locked classification for the K023 opening prepayment clearance.
// The original protected batch remains untouched; these IDs and control values
// identify its two existing source records, rather than classifying by note text.
const K023 = Object.freeze({
	customer_id: '694045c0adf6dbd796e261e1',
	opening_receipt_id: 'cf6a88de34aed3757dd61249',
	adjustment_id: 'b9154df2e659c547eba3b24b',
	opening_amount: 8,
	writeoff_amount: 7,
	opening_date: '2026-01-01',
	writeoff_date: '2026-06-12'
})

const active = row => row && (!row.status || row.status === 'posted')

function isConfirmedOpeningPrepay(row) {
	return active(row) && row.customer_id === K023.customer_id && row._id === K023.opening_receipt_id &&
		row.source_type === 'opening_prepay' && row.biz_date === K023.opening_date && Number(row.amount) === K023.opening_amount
}

function isConfirmedPrepayWriteoff(row) {
	return active(row) && row.customer_id === K023.customer_id && row._id === K023.adjustment_id &&
		row.source_type === 'balance_adjustment' && row.biz_date === K023.writeoff_date && Number(row.amount) === K023.writeoff_amount
}

module.exports = { K023, isConfirmedOpeningPrepay, isConfirmedPrepayWriteoff }
