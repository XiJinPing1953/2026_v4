'use strict'

const DISPLAY_FILTER_VERSION = 'tank-display-ema30-2026-10-16-v1'
const TAU_MS = 30000
const GAP_MS = 60000
const CONFIRM_MS = 20000
const JUMP_KPA = 3
const RETURN_KPA = 0.10
const EPS = 1e-9

// This module only filters the raw level coordinate. Unit conversion, the 0.27
// offset, mass estimation, uploads and alarms belong to the caller.
function createTankDisplayFilter(options = {}) {
	const isValidLevel = typeof options.isValidLevel === 'function' ? options.isValidLevel : () => true
	let source = null
	let recent = []
	let pending = null
	let value = null
	let committedAt = null
	let lastStatus = 'reset'
	let resetBeforeNext = false

	function snapshot(sourceSampledAt, status = lastStatus) {
		return {
			level_kpa: value,
			sampled_at: committedAt,
			source_sampled_at: sourceSampledAt,
			status,
			filter_version: DISPLAY_FILTER_VERSION,
			pending_since: pending ? pending.b.time : null
		}
	}

	function reset() {
		source = null
		recent = []
		pending = null
		value = null
		committedAt = null
		lastStatus = 'reset'
		resetBeforeNext = false
		return snapshot(null)
	}

	function commit(point, level = point.level) {
		if (committedAt == null || point.time - committedAt > GAP_MS) value = level
		else value += (1 - Math.exp(-(point.time - committedAt) / TAU_MS)) * (level - value)
		committedAt = point.time
	}

	function adjacent(a, b) {
		return !!a && !!b && b.time > a.time && b.time - a.time <= CONFIRM_MS
	}

	function isolated(a, b, c) {
		return adjacent(a, b) && adjacent(b, c) &&
			Math.abs(b.level - a.level) >= JUMP_KPA - EPS &&
			Math.abs(c.level - a.level) <= RETURN_KPA + EPS
	}

	function processPoint(point, previous, beforePrevious) {
		const largeStep = adjacent(previous, point) && Math.abs(point.level - previous.level) >= JUMP_KPA - EPS
		// If the predecessor itself forms an isolated candidate, these two
		// centers overlap. Neither may be repaired using the other as truth.
		if (largeStep && !isolated(beforePrevious, previous, point)) {
			pending = { a: previous, b: point, c: null }
		} else commit(point)
	}

	function push(raw = {}) {
		raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
		const time = timestamp(raw.sampled_at)
		const level = numericLevel(raw.level_kpa)
		const tank = identity(raw.tank_id)
		const gateway = identity(raw.gateway_id)
		const key = tank && gateway ? JSON.stringify([tank, gateway]) : null
		const previous = recent[recent.length - 1]
		const beforePrevious = recent[recent.length - 2]
		if (source === key && previous && time != null && time <= previous.time) {
			// Even an invalid duplicate must not cancel a newer pending window.
			return snapshot(time)
		}
		let valid = time != null && level != null && tank !== '' && gateway !== ''
		if (valid) {
			try { valid = isValidLevel(level) === true } catch (_) { valid = false }
		}
		if (!valid) {
			// An invalid observation cannot silently serve as a bridge in a
			// confirmation window. Keep the last display but abandon that window.
			if (pending) {
				pending = null
				resetBeforeNext = true
			}
			lastStatus = 'invalid'
			return snapshot(time)
		}

		const point = { time, level }
		if (source !== key || !previous || resetBeforeNext || time - previous.time > GAP_MS) {
			source = key
			recent = [point]
			pending = null
			value = level
			committedAt = time
			resetBeforeNext = false
			lastStatus = 'reset'
			return snapshot(time)
		}

		if (!pending) processPoint(point, previous, beforePrevious)
		else if (!pending.c) {
			if (isolated(pending.a, pending.b, point)) {
				// Three-point return is provisional. A fourth point is needed to
				// rule out A-B-A-B alternation; no provisional value enters the EMA.
				pending.c = point
			} else {
				commit(pending.b)
				pending = null
				processPoint(point, previous, beforePrevious)
			}
		} else {
			const { a, b, c } = pending
			if (adjacent(c, point) && !isolated(b, c, point)) {
				const interpolated = a.level + (c.level - a.level) * (b.time - a.time) / (c.time - a.time)
				commit(b, interpolated)
			} else commit(b)
			commit(c)
			pending = null
			processPoint(point, previous, beforePrevious)
		}

		recent.push(point)
		if (recent.length > 3) recent.shift()
		lastStatus = pending ? 'pending' : 'live'
		return snapshot(time)
	}

	return { push, reset }
}

function identity(value) {
	return typeof value === 'string' ? value.trim() : ''
}

function numericLevel(value) {
	if (value == null || typeof value === 'boolean' || (typeof value !== 'number' && typeof value !== 'string')) return null
	if (typeof value === 'string' && value.trim() === '') return null
	const number = Number(value)
	return Number.isFinite(number) && number >= 0 ? number : null
}

function timestamp(value) {
	if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
	if (typeof value !== 'string' || value.trim() === '') return null
	const text = value.trim()
	const number = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : Date.parse(text)
	return Number.isFinite(number) && number > 0 ? number : null
}

module.exports = { DISPLAY_FILTER_VERSION, createTankDisplayFilter }
