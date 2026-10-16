'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DISPLAY_FILTER_VERSION, createTankDisplayFilter } = require('../uniCloud-alipay/cloudfunctions/common/tankDisplayFilter.js')
const { deriveTankEstimate } = require('../uniCloud-alipay/cloudfunctions/common/tankTelemetry.js')

const epoch = Date.parse('2026-10-16T12:00:00+08:00')
const input = (level, seconds, overrides = {}) => ({ tank_id: 'main', gateway_id: 'test-gateway', level_kpa: level, sampled_at: epoch + seconds * 1000, ...overrides })
const close = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
const ema = (state, level, seconds) => state + (1 - Math.exp(-seconds / 30)) * (level - state)
const mass = level => deriveTankEstimate({ tank_id: 'main', level_kpa: level }).estimated_weight_t * 1000

test('the unchanged raw coordinate is filtered without mutating input or converting mass', () => {
	const filter = createTankDisplayFilter()
	const raw = Object.freeze(input(21.97, 0))
	const first = filter.push(raw)
	assert.deepEqual(first, { level_kpa: 21.97, sampled_at: epoch, source_sampled_at: epoch, status: 'reset', filter_version: DISPLAY_FILTER_VERSION, pending_since: null })
	const next = filter.push(input(21.90, 12))
	close(next.level_kpa, ema(21.97, 21.90, 12))
	assert.equal(next.status, 'live')
	assert.equal(next.sampled_at, epoch + 12000)
	assert.equal(raw.level_kpa, 21.97)
})

test('an extreme isolated point is held through both future observations and repaired in sample order', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(37.97, 0))
	for (const [level, time] of [[9.37, 5], [37.97, 10]]) {
		const held = filter.push(input(level, time))
		assert.equal(held.status, 'pending')
		assert.equal(held.level_kpa, 37.97)
		assert.equal(held.sampled_at, epoch)
		assert.equal(held.source_sampled_at, epoch + time * 1000)
		assert.equal(held.pending_since, epoch + 5000)
	}
	const confirmed = filter.push(input(37.97, 15))
	assert.equal(confirmed.status, 'live')
	assert.equal(confirmed.level_kpa, 37.97)
	assert.equal(confirmed.sampled_at, epoch + 15000)
	assert.equal(confirmed.pending_since, null)
})

test('a return at the tolerance boundary is time-interpolated before the frozen EMA', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(35, 5))
	filter.push(input(37.90, 15))
	const result = filter.push(input(37.90, 20))
	let expected = ema(38, 38 - .1 * 5 / 15, 5)
	expected = ema(expected, 37.90, 10)
	expected = ema(expected, 37.90, 5)
	close(result.level_kpa, expected)
	assert.equal(result.sampled_at, epoch + 20000)
})

test('a persistent real step is released on the first nonreturn sample', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	assert.equal(filter.push(input(9, 5)).status, 'pending')
	const released = filter.push(input(9.02, 10))
	close(released.level_kpa, ema(ema(38, 9, 5), 9.02, 5))
	assert.equal(released.status, 'live')
	assert.equal(released.sampled_at, epoch + 10000)
})

test('A-B-A-B alternation is preserved rather than choosing one side as truth', () => {
	const filter = createTankDisplayFilter()
	const levels = [38, 9, 38, 9, 38, 9, 9]
	let expected = levels[0]
	let result
	levels.forEach((level, index) => {
		result = filter.push(input(level, index * 5))
		if (index) expected = ema(expected, level, 5)
		if (index >= 3) {
			assert.equal(result.status, 'live')
			close(result.level_kpa, expected)
		}
	})
})

test('two consecutive extreme points are retained, including their return', () => {
	const filter = createTankDisplayFilter()
	const levels = [38, 9, 9, 38, 38]
	let expected = levels[0]
	let result
	levels.forEach((level, index) => {
		result = filter.push(input(level, index * 5))
		if (index) expected = ema(expected, level, 5)
	})
	assert.equal(result.status, 'live')
	close(result.level_kpa, expected)
})

test('a later candidate is held independently after an earlier candidate is released', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(9, 5))
	const nextCandidate = filter.push(input(41, 10))
	assert.equal(nextCandidate.status, 'pending')
	assert.equal(nextCandidate.sampled_at, epoch + 5000)
	close(nextCandidate.level_kpa, ema(38, 9, 5))
	filter.push(input(9, 15))
	const confirmed = filter.push(input(9, 20))
	let expected = ema(38, 9, 5)
	for (let index = 0; index < 3; index++) expected = ema(expected, 9, 5)
	close(confirmed.level_kpa, expected)
})

test('a short confirmation timeout retains the original change, while a >60s gap resets', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(9, 5))
	const timedOut = filter.push(input(38, 26))
	close(timedOut.level_kpa, ema(ema(38, 9, 5), 38, 21))
	assert.equal(timedOut.status, 'live')
	filter.push(input(9, 31))
	const reconnected = filter.push(input(38, 92))
	assert.equal(reconnected.level_kpa, 38)
	assert.equal(reconnected.status, 'reset')
	assert.equal(reconnected.sampled_at, epoch + 92000)
})

test('a return near the tail stays pending, and late final confirmation cannot retroactively repair', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(9, 5))
	const tail = filter.push(input(38, 10))
	assert.equal(tail.sampled_at, epoch)
	assert.equal(tail.status, 'pending')
	const late = filter.push(input(38, 31))
	close(late.level_kpa, ema(ema(ema(38, 9, 5), 38, 5), 38, 21))
	assert.equal(late.status, 'live')
})

test('20 second confirmation boundaries and the 60 second reset boundary are inclusive', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(9, 20))
	assert.equal(filter.push(input(38, 40)).status, 'pending')
	assert.equal(filter.push(input(38, 60)).level_kpa, 38)
	const sixty = filter.push(input(37, 120))
	assert.equal(sixty.status, 'live')
	close(sixty.level_kpa, ema(38, 37, 60))
})

test('a jump below 3kPa or a return outside tolerance is never repaired', () => {
	const below = createTankDisplayFilter()
	below.push(input(38, 0))
	const small = below.push(input(35.01, 5))
	assert.equal(small.status, 'live')
	close(small.level_kpa, ema(38, 35.01, 5))
	const outside = createTankDisplayFilter()
	let expected = 38
	for (const [level, seconds] of [[38, 0], [9, 5], [38.11, 10], [38.11, 15]]) {
		const result = outside.push(input(level, seconds))
		if (seconds) expected = ema(expected, level, 5)
		if (seconds === 15) close(result.level_kpa, expected)
	}
})

test('duplicates and out-of-order packets do not advance display or pending confirmation', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(9, 5))
	for (const raw of [input(9, 5), input(45, 4), input(38, 0), input(null, 4), input(999, 5)]) {
		const held = filter.push(raw)
		assert.equal(held.status, 'pending')
		assert.equal(held.level_kpa, 38)
		assert.equal(held.sampled_at, epoch)
	}
	filter.push(input(38, 10))
	assert.equal(filter.push(input(38, 15)).level_kpa, 38)
})

test('source changes and explicit restarts reset rather than mixing independent streams', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(9, 5))
	const other = filter.push(input(20, 3, { gateway_id: 'other' }))
	assert.equal(other.status, 'reset')
	assert.equal(other.level_kpa, 20)
	const otherTank = filter.push(input(25, 10, { tank_id: 'other-tank', gateway_id: 'other' }))
	assert.equal(otherTank.level_kpa, 25)
	assert.equal(otherTank.status, 'reset')
	const cleared = filter.reset()
	assert.equal(cleared.level_kpa, null)
	assert.equal(cleared.sampled_at, null)
	assert.equal(filter.push(input(9, 20)).level_kpa, 9)
})

test('invalid fields and model-invalid finite levels cannot enter the EMA', () => {
	const filter = createTankDisplayFilter({ isValidLevel: level => deriveTankEstimate({ tank_id: 'main', level_kpa: level }).estimate_status === 'valid' })
	filter.push(input(20, 0))
	const bad = [null, '', ' ', false, NaN, Infinity, -1, 999, [], {}]
	for (const level of bad) {
		const result = filter.push(input(level, 5))
		assert.equal(result.status, 'invalid')
		assert.equal(result.sampled_at, epoch)
		assert.equal(result.source_sampled_at, epoch + 5000)
		assert.equal(result.level_kpa, 20)
	}
	for (const time of [null, '', false, 0, Infinity, 'not a date']) {
		const result = filter.push(input(20, 5, { sampled_at: time }))
		assert.equal(result.status, 'invalid')
		assert.equal(result.source_sampled_at, null)
	}
	assert.equal(filter.push(input(20, 10, { gateway_id: '' })).status, 'invalid')
	const recovered = filter.push(input(19.9, 10))
	close(recovered.level_kpa, ema(20, 19.9, 10))
	assert.equal(recovered.status, 'live')
})

test('an invalid observation breaks pending confirmation without committing its extreme point', () => {
	const filter = createTankDisplayFilter()
	filter.push(input(38, 0))
	filter.push(input(9, 5))
	const bad = filter.push(input(null, 10))
	assert.equal(bad.status, 'invalid')
	assert.equal(bad.level_kpa, 38)
	assert.equal(bad.sampled_at, epoch)
	const next = filter.push(input(37.9, 15))
	assert.equal(next.status, 'reset')
	assert.equal(next.level_kpa, 37.9)
})

test('timestamp normalization and callback failure are deterministic', () => {
	const filter = createTankDisplayFilter()
	assert.equal(filter.push(input('3.00', 0, { sampled_at: String(epoch) })).sampled_at, epoch)
	const next = filter.push(input(2.99, 5, { sampled_at: new Date(epoch + 5000).toISOString() }))
	assert.equal(next.sampled_at, epoch + 5000)
	const throwing = createTankDisplayFilter({ isValidLevel() { throw Error('Invalid model') } })
	assert.equal(throwing.push(input(3, 0)).status, 'invalid')
	assert.equal(throwing.push(input(3, 0)).level_kpa, null)
})

const historicalPath = path.join(__dirname, '../outputs/trust-audit/2026-10-16-spike-guard-history/series.json')
test('3080 historical observations match the offline guard after each sequential commit', { skip: !fs.existsSync(historicalPath) }, () => {
	const historical = JSON.parse(fs.readFileSync(historicalPath, 'utf8'))
	let total = 0
	let held = 0
	let corrected = 0
	for (const [day, rows] of Object.entries(historical)) {
		const filter = createTankDisplayFilter()
		const byTime = new Map(rows.map(row => [row.t, row]))
		for (const row of rows) {
			const out = filter.push(input(row.raw_level, 0, { tank_id: row.tank, gateway_id: row.gateway, sampled_at: row.t }))
			assert.equal(out.source_sampled_at, row.t)
			assert.ok(out.sampled_at <= row.t)
			const committedReference = byTime.get(out.sampled_at)
			assert.ok(committedReference, `${day}: missing submitted sample`)
			close(out.level_kpa, committedReference.guard_smooth_level, 1e-10)
			close(mass(out.level_kpa), committedReference.guard_smooth_kg, 1e-7)
			if (out.status === 'pending') {
				held++
				assert.ok(out.sampled_at < out.source_sampled_at)
			} else assert.equal(out.sampled_at, row.t)
			if (row.clean_level !== row.raw_level) corrected++
			total++
		}
	}
	assert.equal(total, 3080)
	assert.equal(corrected, 1)
	assert.equal(held, 2)
})
