'use strict'
// A carried-in credit can be allocated normally, but has no new cash event.
const OPENING_PREPAY_SOURCE = 'opening_prepay'
const isOpeningPrepayReceipt = row => String(row?.source_type || '').trim() === OPENING_PREPAY_SOURCE
module.exports = { OPENING_PREPAY_SOURCE, isOpeningPrepayReceipt }
