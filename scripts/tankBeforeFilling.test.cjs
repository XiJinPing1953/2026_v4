'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { analyzeTankBeforeFilling } = require('../uniCloud-alipay/cloudfunctions/crm-bottle-movement/tankBeforeFilling')

const day = '2026-10-10'
const start = Date.parse(`${day}T00:00:00+08:00`)
const minute = 60000
const coverage = { complete: true, from: start, to: start + 86400000 }
const facts = [{ date: day, started_at: start + 5 * minute }]

function makeLogs(levels, { offset = 0, weight = 21.42, pressure = 0.25 } = {}) {
	return levels.flatMap((level, index) => Array.from({ length: 12 }, (_, sample) => ({
		_id: `${offset}-${index}-${sample}`, action: 'tank_gateway_ingest', created_at: start + (index + offset) * minute + sample * 5000,
		detail: { tank_id: 'main', gateway_id: 'test', level_kpa: level, lng_weight_t: weight, pressure_mpa: pressure }
	})))
}

const estimatedPlatform = 21.788447204520335
const falling = [41.28, 41.28, 41.28, 41.28, 41.28, 40.98, 40.8, 40.6, 40.5]
function run(logs, extra = {}) { return analyzeTankBeforeFilling({ day, logs, fillingFacts: facts, coverage, ...extra }) }
function hasIssue(result, code) { return result.issues.some(issue => issue.code === code) }

test('stable platform becomes a qualified candidate, never a confirmed valve-open time', () => {
	const logs = makeLogs(falling)
	const before = JSON.stringify(logs)
	const result = run(logs)
	assert.equal(result.status, 'candidate')
	assert.equal(result.quantity_t, estimatedPlatform)
	assert.equal(result.level_kpa, 41.28)
	assert.equal(result.candidates.length, 1)
	assert.deepEqual(result.candidates[0].started_at_support, [new Date(facts[0].started_at).toISOString()])
	assert.ok(hasIssue(result, 'uncalibrated_indication'))
	assert.ok(hasIssue(result, 'operation_unconfirmed'))
	assert.equal(JSON.stringify(logs), before)
})

test('isolated telemetry spike cannot become a start or move the platform median', () => {
	const logs = makeLogs(falling)
	logs[20].detail = { ...logs[20].detail, level_kpa: 9.37, lng_weight_t: 4.54, pressure_mpa: 0.26 }
	assert.equal(run(logs).quantity_t, estimatedPlatform)
	assert.equal(run(logs).level_kpa, 41.28)
	const stationary = makeLogs(Array(10).fill(41.28))
	stationary[70].detail.level_kpa = 9.37
	assert.equal(run(stationary).candidates.length, 0)
})

test('a local afternoon window preserves a local candidate but not daily starting inventory', () => {
	const result = run(makeLogs(falling, { offset: 16 * 60 }))
	assert.equal(result.status, 'pending')
	assert.equal(result.quantity_t, null)
	assert.equal(result.candidates[0].quantity_t, estimatedPlatform)
	assert.ok(hasIssue(result, 'day_start_missing'))
})

test('incomplete query and a gap before the platform cannot establish the first daily operation', () => {
	assert.equal(run(makeLogs(falling), { coverage: { complete: false } }).quantity_t, null)
	const logs = [...makeLogs([41.28, 41.28]), ...makeLogs(falling, { offset: 30 })]
	const result = run(logs)
	assert.equal(result.quantity_t, null)
	assert.ok(hasIssue(result, 'gap_before_candidate'))
})

test('today is complete through a server observation time without requiring future logs', () => {
	const asOf = start + 10 * minute
	const result = run(makeLogs(falling), { coverage: { complete: true, from: start, to: asOf, asOf } })
	assert.equal(result.status, 'candidate')
	assert.equal(result.quantity_t, estimatedPlatform)
	assert.ok(!hasIssue(result, 'query_incomplete'))
	assert.equal(run(makeLogs(falling), { coverage: { complete: true, from: start, to: asOf - minute, asOf } }).quantity_t, null)
})

test('estimated quantity uses level even if PLC weight is missing or zero', () => {
	const missing = run(makeLogs(falling, { weight: null }))
	assert.equal(missing.quantity_t, estimatedPlatform)
	assert.equal(missing.plc_weight_t, null)
	assert.ok(!missing.candidates[0].issues.includes('quantity_missing'))
	const zeroWeight = run(makeLogs(falling, { weight: 0 }))
	assert.equal(zeroWeight.quantity_t, estimatedPlatform)
	assert.equal(zeroWeight.plc_weight_t, 0)
	assert.ok(Math.abs(zeroWeight.corrected_level_kpa - 41.55) < 1e-10)
	assert.equal(zeroWeight.estimate_status, 'valid')
})

test('started_at alone and source created_at do not supply a missing physical start', () => {
	const stationary = run(makeLogs(Array(10).fill(41.28)), { fillingFacts: [{ started_at: start + 5 * minute, created_at: start }] })
	assert.equal(stationary.status, 'pending')
	assert.equal(stationary.quantity_t, null)
	assert.ok(hasIssue(stationary, 'started_at_auxiliary_only'))
})

test('separate falling periods remain multiple candidates without choosing the first', () => {
	const levels = [...falling, ...Array(6).fill(40.5), 40.3, 40.1, 39.9]
	const result = run(makeLogs(levels))
	assert.equal(result.status, 'pending')
	assert.equal(result.quantity_t, null)
	assert.equal(result.candidates.length, 2)
	assert.ok(hasIssue(result, 'multiple_start_candidates'))
})

test('does not merge tanks, infer from sparse telemetry, or accept unrelated log types', () => {
	const logs = makeLogs(falling)
	logs[5].detail.tank_id = 'other'
	assert.ok(hasIssue(run(logs), 'multiple_sources'))
	assert.equal(run(makeLogs(falling).filter((_, index) => index % 12 === 0)).candidates.length, 0)
	assert.equal(run(makeLogs(falling).map(row => ({ ...row, action: 'filling_started' }))).quantity_t, null)
})

test('unknown operation and pressure changes remain explicit even when a filling row exists', () => {
	const logs = makeLogs(falling)
	for (const row of logs.slice(5 * 12)) row.detail.pressure_mpa = 0.5
	const result = run(logs)
	assert.ok(result.candidates[0].issues.includes('pressure_changed'))
	assert.ok(hasIssue(result, 'operation_unconfirmed'))
	assert.equal(run(logs, { fillingFacts: [] }).quantity_t, null)
})

test('deduplicates input without double-weighting and rejects invalid business dates', () => {
	const logs = makeLogs(falling)
	assert.deepEqual(run([...logs].reverse().concat(logs)), run(logs))
	assert.ok(hasIssue(analyzeTankBeforeFilling({ day: '2026-02-31', logs }), 'invalid_day'))
})
