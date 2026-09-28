'use strict'

const RULE_VERSION = 'bottle-flow-2026-09-05-v1'
const typeOf = (row) => String(row && row.type || '').trim()
const effectiveEvents = (events) => (Array.isArray(events) ? events : []).filter((row) => ['back', 'fill', 'out'].includes(typeOf(row)))
function hasSameDayBackOutWithoutFill(events) {
	const types = new Set(effectiveEvents(events).map(typeOf))
	return types.has('back') && types.has('out') && !types.has('fill')
}
function timestamp(value, fallback = 0) {
	const num = Number(value)
	if (Number.isFinite(num) && num > 0) return num
	const parsed = typeof value === 'string' ? Date.parse(value) : NaN
	return Number.isFinite(parsed) ? parsed : fallback
}
function eventDay(row = {}) {
	const day = String(row.event_day || row.date || '').slice(0, 10)
	if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
	return new Date(timestamp(row.event_at, timestamp(row.created_at)) + 8 * 3600000).toISOString().slice(0, 10)
}
// Business order is day -> back/fill/out -> event time -> creation time -> ID.
// The ID tie-breaker matches the paged anomaly scan cursor so equal timestamps cannot skip rows.
function compareEvents(a = {}, b = {}) {
	const day = eventDay(a).localeCompare(eventDay(b))
	if (day) return day
	const priority = (row) => Number(row.type_order) || ({ back: 10, fill: 20, out: 30, adjust: 40 }[typeOf(row)] || 99)
	const order = priority(a) - priority(b)
	if (order) return order
	const time = timestamp(a.event_at, timestamp(a.created_at)) - timestamp(b.event_at, timestamp(b.created_at))
	if (time) return time
	const created = timestamp(a.created_at) - timestamp(b.created_at)
	return created || String(a._id || '').localeCompare(String(b._id || ''))
}
function interleaveBackOut(events, startType) {
	const sorted = [...events].sort(compareEvents)
	const backs = sorted.filter((row) => typeOf(row) === 'back')
	const outs = sorted.filter((row) => typeOf(row) === 'out')
	const others = sorted.filter((row) => !['back', 'out'].includes(typeOf(row)))
	const result = []
	let expect = startType === 'out' ? 'out' : 'back'
	while (backs.length || outs.length) {
		const first = expect === 'back' ? backs : outs
		const second = expect === 'back' ? outs : backs
		result.push((first.length ? first : second).shift())
		expect = expect === 'back' ? 'out' : 'back'
	}
	return [...result, ...others]
}
function businessDayOrder(events, { pending = false, hasBack = false, lastWasOut = false } = {}) {
	const sorted = [...events].sort(compareEvents)
	if (!hasSameDayBackOutWithoutFill(sorted) || pending || (!hasBack && !lastWasOut)) return sorted
	return interleaveBackOut(sorted, hasBack ? 'out' : 'back')
}
module.exports = { RULE_VERSION, effectiveEvents, hasSameDayBackOutWithoutFill, compareEvents, interleaveBackOut, businessDayOrder }
