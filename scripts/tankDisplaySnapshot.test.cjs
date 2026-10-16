'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { deriveTankEstimate, buildTankTelemetryDoc, buildTankSummary } = require('../uniCloud-alipay/cloudfunctions/common/tankTelemetry')
const { DISPLAY_FILTER_VERSION } = require('../uniCloud-alipay/cloudfunctions/common/tankDisplayFilter')
const now = Date.parse('2026-10-16T17:00:00+08:00')
const sample = overrides => ({ tank_id: 'main', gateway_id: 'test-site', level_kpa: 37.97,
	pressure_mpa: .5, lng_weight_t: 19.65, sampled_at: now, ...overrides })
const display = overrides => ({ filter_version: DISPLAY_FILTER_VERSION, level_kpa: 37.9,
	sampled_at: now, source_sampled_at: now, status: 'live', ...overrides })

test('display snapshot is independently recomputed while original mass and level remain unchanged', () => {
	const raw = Object.freeze(sample({ display: Object.freeze(display({ estimated_weight_t: 999, corrected_level_kpa: 999 })) }))
	const doc = buildTankTelemetryDoc(raw, now).doc
	const summary = buildTankSummary(doc, now)
	assert.equal(doc.level_kpa, 37.97)
	assert.equal(doc.lng_weight_t, 19.65)
	assert.equal(summary.estimated_weight_t, deriveTankEstimate(raw).estimated_weight_t)
	assert.equal(summary.display.estimated_weight_t, deriveTankEstimate({ tank_id: 'main', level_kpa: 37.9 }).estimated_weight_t)
	assert.ok(Math.abs(summary.display.corrected_level_kpa - 38.17) < 1e-12)
	assert.equal(raw.display.estimated_weight_t, 999)
})

test('pending snapshots retain their committed timestamp and the raw source stays current', () => {
	const doc = buildTankTelemetryDoc(sample({ display: display({ sampled_at: now - 11000, status: 'pending', pending_since: now - 6000 }) }), now).doc
	assert.equal(doc.sampled_at, now)
	assert.equal(doc.display.sampled_at, now - 11000)
	assert.equal(doc.display.source_sampled_at, now)
	assert.equal(doc.display.status, 'pending')
})

test('invalid advertised display snapshots never fall back to an unsafe raw display', () => {
	for (const overrides of [{ filter_version: 'unknown' }, { level_kpa: true }, { level_kpa: [] }, { level_kpa: ' ' }, { level_kpa: [37] }, { level_kpa: -1 }, { level_kpa: 999 },
		{ source_sampled_at: now - 1 }, { sampled_at: now + 1 }, { sampled_at: now - 61000 }, { status: 'invalid' }]) {
		const doc = buildTankTelemetryDoc(sample({ display: display(overrides) }), now).doc
		assert.equal(doc.display.status, 'invalid')
		assert.equal(doc.display.estimated_weight_t, null)
		assert.equal(doc.level_kpa, 37.97)
	}
})

test('old gateway payload explicitly clears the optional snapshot and preserves existing formula', () => {
	const doc = buildTankTelemetryDoc(sample(), now).doc
	assert.equal(doc.display, null)
	assert.equal(buildTankSummary(doc, now).estimated_weight_t, deriveTankEstimate(doc).estimated_weight_t)
})

test('a stored display becomes stale on read without affecting raw ledger fields', () => {
	const doc = buildTankTelemetryDoc(sample({ display: display() }), now).doc
	const summary = buildTankSummary(doc, now + 61000)
	assert.equal(summary.display.status, 'stale')
	assert.equal(summary.level_kpa, doc.level_kpa)
	assert.equal(summary.lng_weight_t, doc.lng_weight_t)
})

test('dashboard mapper selects display only for the live view and preserves raw references', async () => {
	const source = fs.readFileSync(require.resolve('../src/services/mappers/tankDisplay.js'), 'utf8')
	const { mapTankDisplay } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
	const raw = buildTankSummary(buildTankTelemetryDoc(sample({ display: display() }), now).doc, now)
	const mapped = mapTankDisplay(raw)
	assert.equal(mapped.level_kpa, raw.level_kpa)
	assert.equal(mapped.lng_weight_t, raw.lng_weight_t)
	assert.equal(mapped.estimated_weight_t, raw.display.estimated_weight_t)
	assert.equal(raw.estimated_weight_t, deriveTankEstimate(raw).estimated_weight_t)
	assert.equal(mapTankDisplay({ estimated_weight_t: 5 }).estimated_weight_t, 5)
	const invalid = mapTankDisplay({ estimated_weight_t: 5, display: { status: 'invalid' } })
	assert.equal(invalid.estimated_weight_t, null)
	assert.equal(invalid.status, 'error')
})
