'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const {
	normalizeString,
	toNumber,
	toInt,
	normalizeGatewayConfig,
	readTankTelemetry
} = require('../../scripts/tankTelemetryCore.cjs')

let keytar = null
try {
	keytar = require('keytar')
} catch (_) {
	keytar = null
}

const APP_NAME = 'XintuoTankGateway'
const CREDENTIAL_SERVICE = 'Xintuo Tank Gateway'
const CREDENTIAL_ACCOUNT = 'tank-gateway-password'

let mainWindow = null
let currentConfig = null
let currentToken = ''
let isRunning = false
let loopTimer = null
let cycleRunning = false
let state = {
	running: false,
	status: 'idle',
	message: '',
	lastTelemetry: null,
	lastUploadAt: null,
	lastErrorAt: null,
	credentialBackend: 'none',
	passwordSaved: false
}

function defaultConfig() {
	return {
		gatewayUrl: '',
		host: '192.168.0.1',
		port: 102,
		rack: 0,
		slot: 1,
		levelAddress: 'DB1,REAL2000',
		pressureAddress: 'DB1,REAL2040',
		fullLevelM: 10,
		intervalMs: 5000,
		timeoutMs: 5000,
		tankId: 'main',
		gatewayId: os.hostname() || 'tank-gateway'
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

function normalizeAppConfig(input = {}) {
	const merged = { ...defaultConfig(), ...(input || {}) }
	const gateway = normalizeGatewayConfig(merged)
	return {
		gatewayUrl: normalizeString(merged.gatewayUrl || merged.gateway_url),
		host: gateway.host,
		port: gateway.port,
		rack: gateway.rack,
		slot: gateway.slot,
		levelAddress: gateway.levelAddress,
		pressureAddress: gateway.pressureAddress,
		fullLevelM: gateway.fullLevelM,
		intervalMs: gateway.intervalMs,
		timeoutMs: gateway.timeoutMs,
		tankId: gateway.tankId,
		gatewayId: gateway.gatewayId
	}
}

function loadConfig() {
	currentConfig = normalizeAppConfig(readJsonFile(getConfigPath(), defaultConfig()))
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
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send('gateway:state', state)
	}
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
	emitState({ status: 'ready', message: '探测成功', lastTelemetry: telemetry })
	return telemetry
}

async function runCycle() {
	if (!isRunning || cycleRunning) return
	cycleRunning = true
	try {
		const config = currentConfig || loadConfig()
		const token = await ensureLoggedIn()
		const telemetry = await readTankTelemetry(config)
		await callGateway('ingestV1', telemetry, token)
		emitState({
			status: 'online',
			message: '上报成功',
			lastTelemetry: telemetry,
			lastUploadAt: Date.now()
		})
	} catch (err) {
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
	if (loopTimer) clearTimeout(loopTimer)
	loopTimer = null
	emitState({ status: 'stopped', message: '已停止' })
	return state
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

app.whenReady().then(async () => {
	loadConfig()
	await refreshCredentialState()
	createWindow()
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', () => {
	stopGateway()
	if (process.platform !== 'darwin') app.quit()
})
