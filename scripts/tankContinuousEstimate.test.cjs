'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const {
	deriveTankEstimate, buildTankSummary, buildTankTelemetryDoc,
	TANK_LEVEL_SCALE, TANK_VOLUME_TABLE
} = require('../uniCloud-alipay/cloudfunctions/common/tankTelemetry')

test('frozen samples apply the level offset exactly once, including operational zero', () => {
	const weight = level => deriveTankEstimate({ level_kpa: level }).estimated_weight_t
	assert.ok(Math.abs(weight(21.97) - 11.429700474771153) < 1e-12)
	assert.ok(Math.abs(weight(0) - 0.015026042631372047) < 1e-12)
	assert.ok(Math.abs((weight(22.87) - weight(21.96)) * 1000 - 488.00532516869845) < 1e-8)
	assert.ok(Math.abs(weight(26.23) - 13.711139214890945) < 1e-12)
})

test('every table boundary is continuous and the valid range is monotone', () => {
	for (const [height] of TANK_VOLUME_TABLE.slice(1, -1)) {
		const level = height / TANK_LEVEL_SCALE - 0.27
		if (level < 0) continue
		const left = deriveTankEstimate({ level_kpa: level - 1e-8 }).estimated_weight_t
		const right = deriveTankEstimate({ level_kpa: level + 1e-8 }).estimated_weight_t
		assert.ok(right >= left && right - left < 1e-6)
	}
	let previous = 0
	for (let level = 0; level <= 48; level += .01) {
		const current = deriveTankEstimate({ level_kpa: level }).estimated_weight_t
		assert.ok(current >= previous)
		previous = current
	}
})

test('invalid values and other tanks do not become zeros or extrapolated weights', () => {
	for (const level of [undefined, null, '', -1, true, NaN, Infinity, 49]) {
		const result = deriveTankEstimate({ level_kpa: level })
		assert.equal(result.estimated_weight_t, null)
		assert.notEqual(result.estimate_status, 'valid')
	}
	assert.equal(deriveTankEstimate(null).estimated_weight_t, null)
	assert.equal(deriveTankEstimate({ tank_id: 'other', level_kpa: 21.97 }).estimate_status, 'unsupported_tank')
})

test('read projection preserves original sensor data and freshness; ingestion stays raw', () => {
	const input = { tank_id: 'main', level_kpa: 21.97, lng_weight_t: 11.17,
		pressure_mpa: .72, sampled_at: 100000, status: 'online' }
	const original = JSON.stringify(input)
	const summary = buildTankSummary(input, 105000)
	assert.equal(summary.level_kpa, 21.97)
	assert.equal(summary.lng_weight_t, 11.17)
	assert.equal(summary.corrected_level_kpa, 22.24)
	assert.equal(summary.status, 'online')
	assert.equal(buildTankSummary(input, 161001).status, 'stale')
	const doc = buildTankTelemetryDoc(input, 105000).doc
	assert.equal(doc.level_kpa, 21.97)
	assert.equal(doc.lng_weight_t, 11.17)
	assert.equal(doc.corrected_level_kpa, undefined)
	assert.equal(JSON.stringify(input), original)
})

test('cloud and Windows deployment copies match the canonical source', () => {
	const source = 'uniCloud-alipay/cloudfunctions/common/tankTelemetry.js'
	const bytes = fs.readFileSync(source)
	const copies = require('../config/domain-contracts.json').copies.find(entry => entry.source === source)
	for (const target of copies.targets) assert.deepEqual(fs.readFileSync(target), bytes, target)
})
