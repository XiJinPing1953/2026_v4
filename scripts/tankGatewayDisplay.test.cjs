'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.join(__dirname, '..')
const mainPath = path.join(root, 'apps/tank-gateway/main.cjs')
const mainRequire = createRequire(mainPath)
const { deriveTankEstimate } = mainRequire('./tankTelemetryLocal.cjs')

function sample(overrides = {}) {
	const sampledAt = Date.now()
	return { tank_id: 'main', gateway_id: 'display-test', level_kpa: 21.97, pressure_mpa: 0.72, lng_weight_t: 11.17, level_percent: 44.43, sampled_at: sampledAt, ...overrides }
}

function mainHarness(rawTelemetry) {
	const alarmInputs = []
	const uploads = []
	let nextRead = rawTelemetry
	let uploadError = null
	const alarm = mainRequire('./alarm.cjs')
	const context = vm.createContext({
		__dirname: path.dirname(mainPath),
		process,
		setTimeout: () => 1,
		clearTimeout: () => {},
		fetch: async (_url, options) => {
			uploads.push(JSON.parse(options.body))
			if (uploadError) throw uploadError
			return { ok: true, text: async () => JSON.stringify({ code: 0, data: {} }) }
		},
		require(name) {
			if (name === 'electron') return {
				app: { commandLine: { appendSwitch() {} }, whenReady: () => ({ then() {} }), on() {}, getPath: () => '/tmp/tank-test' },
				ipcMain: { handle() {}, on() {} },
				safeStorage: { isEncryptionAvailable: () => false }
			}
			if (name === 'keytar') throw new Error('Not available in test')
			if (name === 'fs') return { ...fs, mkdirSync() {}, writeFileSync() {} }
			if (name === '../../scripts/tankTelemetryCore.cjs') return {
				...mainRequire(name), readTankTelemetry: async () => {
					if (nextRead instanceof Error) throw nextRead
					if (typeof nextRead === 'function') return nextRead()
					return nextRead
				}
			}
			if (name === './alarm.cjs') return {
				...alarm,
				buildAlarmCandidates(input) {
					alarmInputs.push(input.telemetry)
					return alarm.buildAlarmCandidates(input)
				}
			}
			return mainRequire(name)
		}
	})
	vm.runInContext(`${fs.readFileSync(mainPath, 'utf8')}\n` +
		`currentConfig = { ...defaultConfig(), gatewayUrl: 'https://example.test', levelCorrectionKpa: 1, levelHighKpa: 22.5, alarmDelayMs: 0 };\n` +
		`currentToken = 'test-token';\n` +
		`globalThis.testApi = { probeOnce, runCycle, stopGateway, saveConfig, getConfig: () => currentConfig, getState: () => state, start: () => { isRunning = true } };`, context)
	return {
		api: context.testApi, alarmInputs, uploads,
		setTelemetry: (raw) => { nextRead = raw },
		failUpload: (error) => { uploadError = error }
	}
}

function rendererHarness(file, config = {}) {
	const elements = new Map()
	const context = vm.createContext({
		document: {
			getElementById(id) {
				if (!elements.has(id)) elements.set(id, { textContent: '', style: {}, value: '', addEventListener() {} })
				return elements.get(id)
			}
		},
		window: { tankGateway: { onState() {}, onTestSound() {}, getInitialState: () => ({ then: (fn) => fn({ config, state: {} }) }) } },
		setInterval() {}
	})
	vm.runInContext(fs.readFileSync(path.join(root, 'apps/tank-gateway/renderer', file), 'utf8'), context)
	return {
		elements,
		render(telemetry, state = {}) {
			context.inputState = { status: 'online', running: true, alarms: [], lastTelemetry: telemetry, ...state }
			vm.runInContext('renderState(inputState)', context)
		},
		refresh() { vm.runInContext('refreshFreshness()', context) }
	}
}

test('probe and cycle expose a display copy while upload and alarms keep raw telemetry', async () => {
	const raw = Object.freeze(sample())
	const { api, alarmInputs, uploads } = mainHarness(raw)
	const probed = await api.probeOnce()
	assert.notEqual(probed, raw)
	assert.equal(probed, api.getState().lastTelemetry)
	assert.equal(probed.level_kpa, raw.level_kpa)
	assert.equal(probed.lng_weight_t, raw.lng_weight_t)
	assert.equal(probed.corrected_level_kpa, 22.24)
	assert.ok(Math.abs(probed.estimated_weight_t - 11.429700) < 0.000001)
	assert.equal(probed.estimate_version, deriveTankEstimate(raw).estimate_version)
	api.start()
	await api.runCycle()
	assert.equal(uploads.length, 1)
	const { display, ...uploadedRaw } = uploads[0].data
	assert.deepEqual(uploadedRaw, raw)
	assert.equal(display.filter_version, 'tank-display-ema30-2026-10-16-v1')
	assert.equal(display.sampled_at, raw.sampled_at)
	assert.equal(display.corrected_level_kpa, 22.24)
	assert.ok(Math.abs(display.estimated_weight_t - 11.429700) < 0.000001)
	assert.ok(alarmInputs.every((input) => input === raw))
	assert.equal(api.getState().alarms[0].value, 22.97)
	assert.equal(api.getState().lastTelemetry.corrected_level_kpa, 22.24)
	assert.equal(raw.corrected_level_kpa, undefined)
})

test('probe and cycles share pending protection and show the last confirmed timestamp', async () => {
	const base = Date.now() - 20000
	const raw = sample({ level_kpa: 37.97, sampled_at: base })
	const harness = mainHarness(raw)
	const first = await harness.api.probeOnce()
	harness.api.start()
	harness.setTelemetry(sample({ level_kpa: 9.37, sampled_at: base + 5000 }))
	await harness.api.runCycle()
	const pending = harness.api.getState().lastTelemetry
	assert.equal(pending.level_kpa, 9.37)
	assert.equal(pending.display_filter_status, 'pending')
	assert.equal(pending.display_sampled_at, base)
	assert.equal(pending.display_source_sampled_at, base + 5000)
	assert.equal(pending.estimated_weight_t, first.estimated_weight_t)
	assert.equal(harness.uploads[0].data.level_kpa, 9.37)
	assert.equal(harness.uploads[0].data.display.status, 'pending')
	harness.setTelemetry(sample({ level_kpa: 37.97, sampled_at: base + 10000 }))
	await harness.api.probeOnce()
	harness.setTelemetry(sample({ level_kpa: 37.97, sampled_at: base + 15000 }))
	const recovered = await harness.api.probeOnce()
	assert.equal(recovered.display_filter_status, 'live')
	assert.equal(recovered.display_sampled_at, base + 15000)
	assert.equal(recovered.estimated_weight_t, first.estimated_weight_t)
	assert.equal(recovered.lng_weight_t, 11.17)
})

test('upload failure keeps a fresh local display without changing raw data', async () => {
	const raw = Object.freeze(sample())
	const harness = mainHarness(raw)
	harness.failUpload(new Error('offline'))
	harness.api.start()
	await harness.api.runCycle()
	const current = harness.api.getState()
	assert.equal(current.status, 'error')
	assert.equal(current.lastTelemetry.display_sampled_at, raw.sampled_at)
	assert.equal(current.lastTelemetry.corrected_level_kpa, 22.24)
	assert.equal(current.lastTelemetry.level_kpa, raw.level_kpa)
	assert.equal(current.lastUploadAt, null)
})

test('read failure, stop, and source changes reset filter state', async () => {
	const base = Date.now() - 20000
	const harness = mainHarness(sample({ sampled_at: base }))
	await harness.api.probeOnce()
	harness.setTelemetry(new Error('PLC disconnected'))
	await assert.rejects(harness.api.probeOnce(), /PLC disconnected/)
	assert.equal(harness.api.getState().status, 'error')
	assert.equal(harness.api.getState().lastTelemetry.estimated_weight_t, null)
	assert.equal(harness.api.getState().lastTelemetry.display_sampled_at, null)
	harness.setTelemetry(sample({ level_kpa: 10, sampled_at: base + 5000 }))
	const connected = await harness.api.probeOnce()
	assert.equal(connected.corrected_level_kpa, 10.27)
	harness.api.stopGateway()
	harness.setTelemetry(sample({ level_kpa: 20, sampled_at: base + 10000 }))
	const afterStop = await harness.api.probeOnce()
	assert.equal(afterStop.corrected_level_kpa, 20.27)
	harness.api.saveConfig({ ...harness.api.getConfig(), host: '192.168.2.2' })
	assert.equal(harness.api.getState().lastTelemetry.estimated_weight_t, null)
	harness.setTelemetry(sample({ level_kpa: 30, sampled_at: base + 15000 }))
	const newSource = await harness.api.probeOnce()
	assert.equal(newSource.corrected_level_kpa, 30.27)
})

test('finite out-of-range samples cannot contaminate the display estimate', async () => {
	const base = Date.now() - 10000
	const harness = mainHarness(sample({ sampled_at: base }))
	await harness.api.probeOnce()
	harness.setTelemetry(sample({ level_kpa: 999, sampled_at: base + 5000 }))
	const invalid = await harness.api.probeOnce()
	assert.equal(invalid.display_filter_status, 'invalid')
	assert.equal(invalid.corrected_level_kpa, null)
	assert.equal(invalid.estimated_weight_t, null)
	assert.equal(invalid.level_kpa, 999)
})

test('a stopped in-flight read cannot revive the display or upload its snapshot', async () => {
	let finishRead
	const harness = mainHarness(() => new Promise((resolve) => { finishRead = resolve }))
	harness.api.start()
	const cycle = harness.api.runCycle()
	await Promise.resolve()
	harness.api.stopGateway()
	finishRead(sample())
	await cycle
	assert.equal(harness.api.getState().status, 'stopped')
	assert.equal(harness.api.getState().lastTelemetry, null)
	assert.equal(harness.uploads.length, 0)
})

test('both windows show identical derived values, with raw references only in management', () => {
	const telemetry = sample()
	Object.assign(telemetry, deriveTankEstimate(telemetry), { display_sampled_at: telemetry.sampled_at })
	const management = rendererHarness('renderer.js', { levelCorrectionKpa: 1, pressureCorrectionMpa: 0.1 })
	const monitor = rendererHarness('display.js')
	for (const ui of [management, monitor]) {
		ui.render(telemetry)
		assert.equal(ui.elements.get('levelKpa').textContent, '22.24 kPa')
		assert.equal(ui.elements.get('weightT').textContent, '11.430 t')
		assert.equal(ui.elements.get('pressureMpa').textContent, '0.72 MPa')
		assert.equal(ui.elements.get('levelPercent').textContent, '44.43%')
		assert.equal(ui.elements.get('sampledAt').textContent, new Date(telemetry.display_sampled_at).toLocaleString('zh-CN', { hour12: false }))
	}
	assert.equal(management.elements.get('rawLevelKpa').textContent, 'PLC原液位 21.97 kPa')
	assert.equal(management.elements.get('rawWeightT').textContent, 'PLC原重量 11.17 t')
	assert.equal(management.elements.get('levelAlarmCurrent').textContent, '22.97 kPa')
	assert.equal(management.elements.get('pressureAlarmCurrent').textContent, '0.82 MPa')
})

test('missing or unavailable derived values display dashes rather than old PLC weight or zero', () => {
	for (const file of ['renderer.js', 'display.js']) {
		const ui = rendererHarness(file, { levelCorrectionKpa: 1, pressureCorrectionMpa: 0.1 })
		ui.render(sample({ corrected_level_kpa: null, estimated_weight_t: null, pressure_mpa: null, level_percent: null }))
		assert.equal(ui.elements.get('levelKpa').textContent, '-- kPa')
		assert.equal(ui.elements.get('weightT').textContent, '-- t')
		assert.equal(ui.elements.get('pressureMpa').textContent, '-- MPa')
		assert.equal(ui.elements.get('levelPercent').textContent, '--%')
		assert.equal(ui.elements.get('tankFill').style.height, '0%')
		ui.render(null)
		assert.equal(ui.elements.get('weightT').textContent, '-- t')
	}
})

test('monitor keeps delayed data visibly delayed and retains existing screen wording', () => {
	const ui = rendererHarness('display.js')
	ui.render(sample({ ...deriveTankEstimate(sample()), display_sampled_at: Date.now() - 120000 }))
	ui.refresh()
	assert.equal(ui.elements.get('connectionStatus').textContent, '数据延迟')
	assert.equal(ui.elements.get('ageText').textContent, '数据延迟')
	const html = fs.readFileSync(path.join(root, 'apps/tank-gateway/renderer/display.html'), 'utf8')
	assert.match(html, /液位信号/)
	assert.match(html, /LNG 重量/)
	assert.doesNotMatch(html, /修正|估算/)
})

test('both windows display committed time while pending and flag stale or invalid snapshots', () => {
	const base = Date.now() - 120000
	for (const file of ['renderer.js', 'display.js']) {
		const ui = rendererHarness(file)
		const telemetry = sample({
			...deriveTankEstimate(sample()), sampled_at: Date.now(), display_sampled_at: base,
			display_filter_status: 'pending'
		})
		ui.render(telemetry)
		ui.refresh()
		assert.equal(ui.elements.get('sampledAt').textContent, new Date(base).toLocaleString('zh-CN', { hour12: false }))
		assert.equal(ui.elements.get(file === 'display.js' ? 'connectionStatus' : 'statusText').textContent, '数据延迟')
		ui.render({ ...telemetry, display_filter_status: 'invalid', display_sampled_at: null })
		assert.equal(ui.elements.get('levelKpa').textContent, '-- kPa')
		assert.equal(ui.elements.get('weightT').textContent, '-- t')
		assert.equal(ui.elements.get('sampledAt').textContent, '--')
	}
})
