'use strict'

// A filling's start-loss basis is the latest return of the same bottle dated on
// or before the filling date. A sale dated D can therefore only change fillings
// dated D or later; earlier fillings keep their basis and need no re-sync.
const YMD = /^\d{4}-\d{2}-\d{2}$/

function normalizeStartLossDateFrom(value) {
	const text = value == null ? '' : String(value).trim()
	return YMD.test(text) ? text : ''
}

function isInStartLossScope(row, dateFrom, normalizeFillingDate) {
	if (!dateFrom) return true
	const date = normalizeFillingDate(row && row.date, row && row.created_at)
	// Unknown dates stay in scope: skipping them could leave a stale adjustment.
	return !date || date >= dateFrom
}

module.exports = { normalizeStartLossDateFrom, isInStartLossScope }
