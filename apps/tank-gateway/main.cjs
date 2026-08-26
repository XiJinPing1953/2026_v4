'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, ipcMain, safeStorage, screen } = require('electron')
const {
	DEFAULT_TANK_CONFIG,
	normalizeString,
	toNumber,
	toInt,
	normalizeGatewayConfig,
	repairKnownGatewayConfig,
	validateGatewayConfig,
	readTankTelemetry
} = require('../../scripts/tankTelemetryCore.cjs')
const {
	normalizeAlarmConfig,
	buildAlarmCandidates,
	buildAlarmRuntime
} = require('./alarm.cjs')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let keytar = null
try {
	keytar = require('keytar')
} catch (_) {
	keytar = null
}

const APP_NAME = 'XintuoTankGateway'
const CONFIG_VERSION = 5
const CREDENTIAL_SERVICE = 'Xintuo Tank Gateway'
const CREDENTIAL_ACCOUNT = 'tank-gateway-password'

let mainWindow = null
let displayWindow = null
let displayReady = false
let pendingDisplayTestSound = false
let currentConfig = null
let currentToken = ''
let isRunning = false
let loopTimer = null
let cycleRunning = false
let alarmRuntime = {}
let alarmAcknowledgedCodes = new Set()
let state = {
	running: false,
	status: 'idle',
	message: '',
	lastTelemetry: null,
	lastUploadAt: null,
	lastErrorAt: null,
	credentialBackend: 'none',
	passwordSaved: false,
	alarms: [],
	alarmActive: false
}

function defaultConfig() {
	return {
		configVersion: CONFIG_VERSION,
		gatewayUrl: '',
		host: DEFAULT_TANK_CONFIG.host,
		port: 102,
		rack: 0,
		slot: 1,
		levelAddress: DEFAULT_TANK_CONFIG.levelAddress,
		pressureAddress: DEFAULT_TANK_CONFIG.pressureAddress,
		weightAddress: DEFAULT_TANK_CONFIG.weightAddress,
		levelReferenceKpa: DEFAULT_TANK_CONFIG.levelReferenceKpa,
		levelReferencePercent: DEFAULT_TANK_CONFIG.levelReferencePercent,
		intervalMs: 5000,
		timeoutMs: 5000,
		tankId: 'main',
		gatewayId: os.hostname() || 'tank-gateway',
		alarmEnabled: true,
		levelAlarmEnabled: true,
		pressureAlarmEnabled: true,
		communicationAlarmEnabled: true,
		levelRangeUpperKpa: 80,
		levelRangeLowerKpa: 0,
		levelCorrectionKpa: 0,
		pressureRangeUpperMpa: 2.5,
		pressureRangeLowerMpa: 0,
		pressureCorrectionMpa: 0,
		levelLowLowKpa: null,
		levelLowKpa: null,
		levelHighKpa: null,
		levelHighHighKpa: null,
		pressureLowLowMpa: null,
		pressureLowMpa: null,
		pressureHighMpa: null,
		pressureHighHighMpa: null,
		alarmDelayMs: 5000,
		communicationDelayMs: 5000
	}
}

function getConfigDir() {
	return path.join(app.getPath('appData'), APP_NAME)
}

function getConfigPath() {
	return path.join(getConfigDir(), 'config.json')
}

function getEncryptedPasswordPath() {
	return path.join(getConfigDir(), 'password.bin')
}

function ensureConfigDir() {
	fs.mkdirSync(getConfigDir(), { recursive: true })
}

function readJsonFile(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch (_) {
		return fallback
	}
}

function normalizeAppConfig(input = {}, options = {}) {
	const source = input && typeof input === 'object' ? input : {}
	let merged = { ...defaultConfig(), ...source }
	if (options.migrateLegacy && toInt(source.configVersion, 0) < CONFIG_VERSION) {
		if (normalizeString(source.host) === '192.168.0.1') merged.host = DEFAULT_TANK_CONFIG.host
		if (normalizeString(source.levelAddress) === 'DB1,REAL2000') {
			merged.levelAddress = DEFAULT_TANK_CONFIG.levelAddress
		}
		if (normalizeString(source.pressureAddress) === 'DB1,REAL2040') {
			merged.pressureAddress = DEFAULT_TANK_CONFIG.pressureAddress
		}
		merged = repairKnownGatewayConfig(merged)
	}
	if (
		source.levelAlarmEnabled == null &&
		source.level_alarm_enabled == null &&
		source.pressureAlarmEnabled == null &&
		source.pressure_alarm_enabled == null &&
		(source.alarmEnabled === false || source.alarm_enabled === false)
	) {
		merged.levelAlarmEnabled = false
		merged.pressureAlarmEnabled = false
	}
	const gateway = validateGatewayConfig(normalizeGatewayConfig(merged))
	return {
		configVersion: CONFIG_VERSION,
		gatewayUrl: normalizeString(merged.gatewayUrl || merged.gateway_url),
		host: gateway.host,
		port: gateway.port,
		rack: gateway.rack,
		slot: gateway.slot,
		levelAddress: gateway.levelAddress,
		pressureAddress: gateway.pressureAddress,
		weightAddress: gateway.weightAddress,
		levelReferenceKpa: gateway.levelReferenceKpa,
		levelReferencePercent: gateway.levelReferencePercent,
		intervalMs: gateway.intervalMs,
		timeoutMs: gateway.timeoutMs,
		tankId: gateway.tankId,
		gatewayId: gateway.gatewayId,
		...normalizeAlarmConfig(merged)
	}
}

function loadConfig() {
	const storedConfig = readJsonFile(getConfigPath(), defaultConfig())
	currentConfig = normalizeAppConfig(storedConfig, { migrateLegacy: true })
	ensureConfigDir()
	fs.writeFileSync(getConfigPath(), JSON.stringify(currentConfig, null, 2))
	if (
		normalizeString(storedConfig.levelAddress) &&
		normalizeString(storedConfig.levelAddress) !== normalizeString(currentConfig.levelAddress)
	) {
		state.message = `已自动修复液位地址为 ${currentConfig.levelAddress}`
	}
	return currentConfig
}

function saveConfig(config) {
	currentConfig = normalizeAppConfig(config)
	ensureConfigDir()
	fs.writeFileSync(getConfigPath(), JSON.stringify(currentConfig, null, 2))
	return currentConfig
}

function credentialBackend() {
	if (keytar) return process.platform === 'win32' ? 'Windows Credential Vault' : 'System Keychain'
	if (safeStorage && safeStorage.isEncryptionAvailable()) return 'Electron safeStorage'
	return 'unavailable'
}

async function setStoredPassword(password) {
	const value = normalizeString(password)
	if (!value) return false
	if (keytar) {
		await keytar.setPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT, value)
		return true
	}
	if (safeStorage && safeStorage.isEncryptionAvailable()) {
		ensureConfigDir()
		fs.writeFileSync(getEncryptedPasswordPath(), safeStorage.encryptString(value))
		return true
	}
	throw new Error('当前系统不可用安全凭据存储')
}

async function getStoredPassword() {
	if (keytar) return normalizeString(await keytar.getPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT))
	if (safeStorage && safeStorage.isEncryptionAvailable()) {
		try {
			const encrypted = fs.readFileSync(getEncryptedPasswordPath())
			return normalizeString(safeStorage.decryptString(encrypted))
		} catch (_) {
			return ''
		}
	}
	return ''
}

async function deleteStoredPassword() {
	if (keytar) return keytar.deletePassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
	try {
		fs.unlinkSync(getEncryptedPasswordPath())
		return true
	} catch (_) {
		return false
	}
}

async function refreshCredentialState() {
	state.credentialBackend = credentialBackend()
	state.passwordSaved = Boolean(await getStoredPassword())
	return state
}

function emitState(patch = {}) {
	state = { ...state, ...patch, running: isRunning }
	state.alarmActive = Boolean(isRunning && state.alarms && state.alarms.length)
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send('gateway:state', state)
	}
	if (displayWindow && !displayWindow.isDestroyed()) {
		displayWindow.webContents.send('gateway:state', state)
	}
	return state
}

function updateAlarms({ telemetry = null, readError = '' } = {}) {
	if (!isRunning && !telemetry) {
		alarmRuntime = {}
		alarmAcknowledgedCodes = new Set()
		emitState({ alarms: [] })
		return []
	}
	const candidates = buildAlarmCandidates({ telemetry, readError, config: currentConfig || defaultConfig() })
	const candidateCodes = new Set(candidates.map((item) => item && item.code).filter(Boolean))
	alarmAcknowledgedCodes = new Set(
		[...alarmAcknowledgedCodes].filter((code) => candidateCodes.has(code))
	)
	const runtime = buildAlarmRuntime(candidates, alarmRuntime, Date.now())
	alarmRuntime = runtime
	const active = Object.values(runtime)
		.filter((item) => item.active)
		.map((item) => ({ ...item, acknowledged: alarmAcknowledgedCodes.has(item.code) }))
	emitState({ alarms: active })
	return active
}

function acknowledgeActiveAlarms() {
	const active = Array.isArray(state.alarms) ? state.alarms : []
	active.forEach((item) => {
		if (item && item.code) alarmAcknowledgedCodes.add(item.code)
	})
	const alarms = active.map((item) => ({ ...item, acknowledged: true }))
	emitState({
		alarms,
		message: alarms.length ? '报警已确认，等待现场值恢复后自动复位' : state.message
	})
	return state
}

function requestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function callGateway(action, data = {}, token = '') {
	const config = currentConfig || loadConfig()
	const url = normalizeString(config.gatewayUrl)
	if (!url) throw new Error('请先填写云端网关接口 URL')
	if (typeof fetch !== 'function') throw new Error('当前 Electron 运行时缺少 fetch')
	const headers = { 'content-type': 'application/json' }
	if (token) headers.Authorization = `Bearer ${token}`
	const res = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			action,
			data,
			request_id: requestId()
		})
	})
	const text = await res.text()
	let json = {}
	try {
		json = text ? JSON.parse(text) : {}
	} catch (_) {
		throw new Error(`云端响应不是 JSON: ${text}`)
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
	if (!json || json.code !== 0) throw new Error(json && json.msg ? json.msg : `云端调用失败: ${text}`)
	return json.data || {}
}

async function loginGateway(password, options = {}) {
	const config = saveConfig(options.config || currentConfig || defaultConfig())
	const passwordText = normalizeString(password) || (await getStoredPassword())
	if (!passwordText) throw new Error('请输入网关密码')
	const data = await callGateway('loginV1', {
		password: passwordText,
		gateway_id: config.gatewayId
	})
	currentToken = normalizeString(data.token)
	if (!currentToken) throw new Error('登录成功但云端未返回 token')
	if (options.savePassword) await setStoredPassword(passwordText)
	await refreshCredentialState()
	emitState({ status: 'ready', message: '登录成功' })
	return { token: currentToken, expiresInMs: data.expires_in_ms || data.expiresInMs || null }
}

async function ensureLoggedIn() {
	if (currentToken) return currentToken
	await loginGateway('', { config: currentConfig || loadConfig(), savePassword: false })
	return currentToken
}

async function probeOnce(configInput = null) {
	const config = configInput ? saveConfig(configInput) : currentConfig || loadConfig()
	emitState({ status: 'probing', message: '正在读取 PLC' })
	const telemetry = await readTankTelemetry(config)
	const alarms = buildAlarmCandidates({ telemetry, config })
	emitState({ status: 'ready', message: alarms.length ? `探测成功，发现 ${alarms.length} 项超限` : '探测成功', lastTelemetry: telemetry, alarms: [] })
	return telemetry
}

async function runCycle() {
	if (!isRunning || cycleRunning) return
	cycleRunning = true
	let telemetry = null
	try {
		const config = currentConfig || loadConfig()
		const token = await ensureLoggedIn()
		telemetry = await readTankTelemetry(config)
		updateAlarms({ telemetry })
		await callGateway('ingestV1', telemetry, token)
		emitState({
			status: 'online',
			message: '上报成功',
			lastTelemetry: telemetry,
			lastUploadAt: Date.now()
		})
	} catch (err) {
		if (!telemetry) updateAlarms({ readError: err && err.message ? err.message : String(err) })
		emitState({
			status: 'error',
			message: err && err.message ? err.message : String(err),
			lastErrorAt: Date.now()
		})
	} finally {
		cycleRunning = false
		if (isRunning) {
			const intervalMs = toInt((currentConfig || defaultConfig()).intervalMs, 5000)
			loopTimer = setTimeout(runCycle, Math.max(intervalMs, 1000))
		}
	}
}

function startGateway(configInput = null) {
	if (configInput) saveConfig(configInput)
	if (isRunning) return state
	isRunning = true
	emitState({ status: 'starting', message: '正在启动' })
	void runCycle()
	return state
}

function stopGateway() {
	isRunning = false
	alarmRuntime = {}
	alarmAcknowledgedCodes = new Set()
	if (loopTimer) clearTimeout(loopTimer)
	loopTimer = null
	emitState({ status: 'stopped', message: '已停止', alarms: [] })
	return state
}

function getMonitorDisplay() {
	const displays = screen.getAllDisplays()
	const primary = screen.getPrimaryDisplay()
	return displays.find((item) => item.id !== primary.id) || primary
}

function openDisplayWindow() {
	if (displayWindow && !displayWindow.isDestroyed()) {
		displayWindow.show()
		displayWindow.focus()
		return { opened: true, external: displayWindow.getBounds().x !== screen.getPrimaryDisplay().bounds.x }
	}
	const displays = screen.getAllDisplays()
	const target = getMonitorDisplay()
	const hasExternal = displays.length > 1
	displayWindow = new BrowserWindow({
		x: target.bounds.x,
		y: target.bounds.y,
		width: target.bounds.width,
		height: target.bounds.height,
		frame: false,
		fullscreen: hasExternal,
		kiosk: hasExternal,
		autoHideMenuBar: true,
		title: '新拓储罐监控屏',
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false
		}
	})
	displayWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'))
	displayWindow.webContents.once('did-finish-load', () => {
		displayReady = true
		displayWindow.webContents.send('gateway:state', state)
		if (pendingDisplayTestSound) {
			pendingDisplayTestSound = false
			displayWindow.webContents.send('display:test-sound')
		}
	})
	displayWindow.on('closed', () => {
		displayWindow = null
		displayReady = false
		pendingDisplayTestSound = false
	})
	return { opened: true, external: hasExternal }
}

function closeDisplayWindow() {
	if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close()
	displayWindow = null
	return { closed: true }
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 980,
		height: 720,
		minWidth: 860,
		minHeight: 620,
		title: '新拓储罐网关',
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false
		}
	})
	mainWindow.on('closed', () => {
		mainWindow = null
		closeDisplayWindow()
	})
	mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

ipcMain.handle('app:getInitialState', async () => {
	const config = currentConfig || loadConfig()
	await refreshCredentialState()
	return { config, state }
})

ipcMain.handle('config:save', async (_event, config) => {
	return saveConfig(config || {})
})

ipcMain.handle('credential:clear', async () => {
	await deleteStoredPassword()
	currentToken = ''
	await refreshCredentialState()
	return state
})

ipcMain.handle('gateway:login', async (_event, payload = {}) => {
	return loginGateway(payload.password, {
		config: payload.config,
		savePassword: payload.savePassword !== false
	})
})

ipcMain.handle('gateway:probe', async (_event, config) => {
	return probeOnce(config)
})

ipcMain.handle('gateway:start', async (_event, config) => {
	startGateway(config)
	return state
})

ipcMain.handle('gateway:stop', async () => {
	return stopGateway()
})

ipcMain.handle('display:open', async () => openDisplayWindow())
ipcMain.handle('display:close', async () => closeDisplayWindow())
ipcMain.handle('alarm:acknowledge', async () => acknowledgeActiveAlarms())
ipcMain.on('display:test-sound', () => {
	if (!displayWindow || displayWindow.isDestroyed()) openDisplayWindow()
	if (!displayReady) {
		pendingDisplayTestSound = true
		return
	}
	displayWindow.webContents.send('display:test-sound')
})

app.whenReady().then(async () => {
	loadConfig()
	await refreshCredentialState()
	createWindow()
	if (screen.getAllDisplays().length > 1) openDisplayWindow()
	screen.on('display-added', () => {
		if (!displayWindow || displayWindow.isDestroyed()) openDisplayWindow()
	})
	screen.on('display-removed', () => {
		if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close()
	})
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', () => {
	stopGateway()
	if (process.platform !== 'darwin') app.quit()
})
