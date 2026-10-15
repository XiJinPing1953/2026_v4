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
	return { tank_id: 'main', level_kpa: 21.97, pressure_mpa: 0.72, lng_weight_t: 11.17, level_percent: 44.43, sampled_at: Date.now(), ...overrides }
}

function mainHarness(rawTelemetry) {
	const alarmInputs = []
	const uploads = []
	const alarm = mainRequire('./alarm.cjs')
	const context = vm.createContext({
		__dirname: path.dirname(mainPath),
		process,
		setTimeout: () => 1,
		clearTimeout: () => {},
		fetch: async (_url, options) => {
			uploads.push(JSON.parse(options.body))
			return { ok: true, text: async () => JSON.stringify({ code: 0, data: {} }) }
		},
		require(name) {
			if (name === 'electron') return {
				app: { commandLine: { appendSwitch() {} }, whenReady: () => ({ then() {} }), on() {} },
				ipcMain: { handle() {}, on() {} },
				safeStorage: { isEncryptionAvailable: () => false }
			}
			if (name === 'keytar') throw new Error('Not available in test')
			if (name === '../../scripts/tankTelemetryCore.cjs') return {
				...mainRequire(name), readTankTelemetry: async () => rawTelemetry
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
		`globalThis.testApi = { probeOnce, runCycle, getState: () => state, start: () => { isRunning = true } };`, context)
	return { api: context.testApi, alarmInputs, uploads }
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
	assert.deepEqual(uploads[0].data, raw)
	assert.ok(alarmInputs.every((input) => input === raw))
	assert.equal(api.getState().alarms[0].value, 22.97)
	assert.equal(api.getState().lastTelemetry.corrected_level_kpa, 22.24)
	assert.equal(raw.corrected_level_kpa, undefined)
})

test('both windows show identical derived values, with raw references only in management', () => {
	const telemetry = sample()
	Object.assign(telemetry, deriveTankEstimate(telemetry))
	const management = rendererHarness('renderer.js', { levelCorrectionKpa: 1, pressureCorrectionMpa: 0.1 })
	const monitor = rendererHarness('display.js')
	for (const ui of [management, monitor]) {
		ui.render(telemetry)
		assert.equal(ui.elements.get('levelKpa').textContent, '22.24 kPa')
		assert.equal(ui.elements.get('weightT').textContent, '11.430 t')
		assert.equal(ui.elements.get('pressureMpa').textContent, '0.72 MPa')
		assert.equal(ui.elements.get('levelPercent').textContent, '44.43%')
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
	ui.render(sample({ ...deriveTankEstimate(sample()), sampled_at: Date.now() - 120000 }))
	ui.refresh()
	assert.equal(ui.elements.get('connectionStatus').textContent, '数据延迟')
	assert.equal(ui.elements.get('ageText').textContent, '数据延迟')
	const html = fs.readFileSync(path.join(root, 'apps/tank-gateway/renderer/display.html'), 'utf8')
	assert.match(html, /液位信号/)
	assert.match(html, /LNG 重量/)
	assert.doesNotMatch(html, /修正|估算/)
})
