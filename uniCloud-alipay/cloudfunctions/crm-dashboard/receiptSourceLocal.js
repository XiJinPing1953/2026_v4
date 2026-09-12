'use strict'
// A carried-in credit can be allocated normally, but has no new cash event.
const OPENING_PREPAY_SOURCE = 'opening_prepay'
const isOpeningPrepayReceipt = row => String(row?.source_type || '').trim() === OPENING_PREPAY_SOURCE
const isDepositTransferReceipt = row => String(row?.source_type || '').trim() === 'deposit_transfer'
const isNonCashPrepayReceipt = row => isOpeningPrepayReceipt(row) || isDepositTransferReceipt(row)
const isOffsetCreditReceipt = row => String(row?.source_type || '').trim().startsWith('sale_offset_credit') ||
	['offset_credit', 'offset'].includes(String(row?.entry_kind || '').trim().toLowerCase())
const isCashReceipt = row => !isNonCashPrepayReceipt(row) && !isOffsetCreditReceipt(row)
module.exports = { OPENING_PREPAY_SOURCE, isOpeningPrepayReceipt, isDepositTransferReceipt, isNonCashPrepayReceipt, isOffsetCreditReceipt, isCashReceipt }
