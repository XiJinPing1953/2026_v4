'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron')
const {
	normalizeConfig,
	normalizeString,
	LocalAuditJournal,
	CloudClient,
	FillingPermitRuntime
} = require('../../scripts/fillingPermitCore.cjs')

let keytar = null
try {
	keytar = require('keytar')
} catch (_) {
	keytar = null
}

const APP_NAME = 'XintuoFillingPermitGateway'
const CREDENTIAL_SERVICE = 'Xintuo Filling Permit Gateway'
const CREDENTIAL_ACCOUNT = 'filling-permit-gateway-password'

let mainWindow = null
let currentConfig = null
let currentToken = ''
let runtime = null
let journal = null
let uiState = {
	cloudStatus: 'unknown',
	cloudMessage: '',
	credentialBackend: 'unavailable',
	passwordSaved: false,
	auditStatus: 'unknown',
	pendingAudits: 0
}

function defaultConfig() {
	return {
		gatewayUrl: '',
		gatewayId: os.hostname() || 'filling-permit-gateway',
		bindHost: '0.0.0.0',
		port: 502,
		unitId: 1,
		timeoutMs: 5000,
		heartbeatMs: 1000,
		syncIntervalMs: 30000,
		autoStart: false
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

function getAuditDir() {
	return path.join(getConfigDir(), 'audits')
}

function ensureConfigDir() {
	fs.mkdirSync(getConfigDir(), { recursive: true })
}

function loadConfig() {
	let value = defaultConfig()
	try {
		value = { ...value, ...JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')) }
	} catch (_) {}
	currentConfig = normalizeConfig(value)
	return currentConfig
}

function saveConfig(input) {
	if (runtime && runtime.running) throw new Error('请先停止网关再修改连接设置')
	currentConfig = normalizeConfig({ ...defaultConfig(), ...(input || {}) })
	ensureConfigDir()
	fs.writeFileSync(getConfigPath(), JSON.stringify(currentConfig, null, 2))
	app.setLoginItemSettings({ openAtLogin: currentConfig.autoStart, openAsHidden: false })
	return currentConfig
}

function credentialBackend() {
	if (keytar) return process.platform === 'win32' ? 'Windows Credential Vault' : 'System Keychain'
	if (safeStorage && safeStorage.isEncryptionAvailable()) return 'Electron safeStorage'
	return 'unavailable'
}

async function setStoredPassword(password) {
	const value = normalizeString(password)
	if (!value) throw new Error('密码不能为空')
	if (keytar) {
		await keytar.setPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT, value)
		return
	}
	if (safeStorage && safeStorage.isEncryptionAvailable()) {
		ensureConfigDir()
		fs.writeFileSync(getEncryptedPasswordPath(), safeStorage.encryptString(value))
		return
	}
	throw new Error('当前系统不可用安全凭据存储')
}

async function getStoredPassword() {
	if (keytar) return normalizeString(await keytar.getPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT))
	if (safeStorage && safeStorage.isEncryptionAvailable()) {
		try {
			return normalizeString(safeStorage.decryptString(fs.readFileSync(getEncryptedPasswordPath())))
		} catch (_) {
			return ''
		}
	}
	return ''
}

async function clearStoredPassword() {
	currentToken = ''
	if (keytar) await keytar.deletePassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
	else {
		try {
			fs.unlinkSync(getEncryptedPasswordPath())
		} catch (_) {}
	}
	await refreshCredentialState()
	emitState('已清除网关凭据')
	return getState()
}

async function refreshCredentialState() {
	uiState.credentialBackend = credentialBackend()
	uiState.passwordSaved = Boolean(await getStoredPassword())
}

function refreshAuditState() {
	try {
		journal.ensureDir()
		fs.accessSync(getAuditDir(), fs.constants.R_OK | fs.constants.W_OK)
		uiState.auditStatus = 'ready'
		uiState.pendingAudits = journal.listPending(100000).length
	} catch (_) {
		uiState.auditStatus = 'fault'
	}
}

function getState() {
	refreshAuditState()
	return {
		...uiState,
		...(runtime ? runtime.snapshot() : {}),
		auditDir: getAuditDir()
	}
}

function emitState(message = '') {
	const state = { ...getState(), message }
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('gateway:state', state)
	return state
}

async function callCloud(action, data = {}, token = '') {
	const config = currentConfig || loadConfig()
	if (!config.gatewayUrl) throw new Error('请先填写云端接口 URL')
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), config.timeoutMs)
	try {
		const headers = { 'content-type': 'application/json' }
		if (token) headers.authorization = `Bearer ${token}`
		const response = await fetch(config.gatewayUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify({ action, data, request_id: `gui_${Date.now().toString(36)}` }),
			signal: controller.signal
		})
		const text = await response.text()
		let json
		try {
			json = text ? JSON.parse(text) : {}
		} catch (_) {
			throw new Error('云端响应不是 JSON')
		}
		if (!response.ok || json.code !== 0) {
			const error = new Error(json.msg || `HTTP ${response.status}`)
			error.kind = response.status === 401 || json.code === 401 ? 'auth' : json && json.data && json.data.failure_kind ? json.data.failure_kind : 'network'
			throw error
		}
		return json.data || {}
	} catch (err) {
		if (err && err.name === 'AbortError') throw Object.assign(new Error('云端请求超时'), { kind: 'timeout' })
		if (err && !err.kind) err.kind = 'network'
		throw err
	} finally {
		clearTimeout(timer)
	}
}

async function login(password, options = {}) {
	if (options.config && !(runtime && runtime.running)) saveConfig(options.config)
	const value = normalizeString(password) || (await getStoredPassword())
	if (!value) throw new Error('请输入网关密码')
	const response = await callCloud('loginV1', { password: value, gateway_id: currentConfig.gatewayId })
	currentToken = normalizeString(response.token)
	if (!currentToken) throw new Error('云端未返回令牌')
	if (options.savePassword !== false) await setStoredPassword(value)
	await refreshCredentialState()
	uiState.cloudStatus = 'ready'
	uiState.cloudMessage = '鉴权成功'
	emitState('云端登录成功')
	return { expiresInMs: response.expires_in_ms || null }
}

async function ensureToken() {
	if (currentToken) return currentToken
	await login('', { savePassword: false })
	return currentToken
}

async function probe(configInput) {
	if (configInput && !(runtime && runtime.running)) saveConfig(configInput)
	try {
		const response = await callCloud('healthV1')
		refreshAuditState()
		uiState.cloudStatus = response.status === 'ok' ? 'ready' : 'fault'
		uiState.cloudMessage = `服务时间 ${new Date(response.server_time).toLocaleString('zh-CN', { hour12: false })}`
		return { cloud: response, localAudit: uiState.auditStatus, pendingAudits: uiState.pendingAudits }
	} catch (err) {
		uiState.cloudStatus = 'fault'
		uiState.cloudMessage = err && err.message ? err.message : String(err)
		throw err
	} finally {
		emitState(uiState.cloudMessage)
	}
}

async function startGateway(configInput) {
	if (configInput) saveConfig(configInput)
	await runtime.start()
	return emitState('充装许可网关已启动')
}

async function stopGateway() {
	await runtime.stop()
	return emitState('充装许可网关已停止')
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1120,
		height: 820,
		minWidth: 940,
		minHeight: 680,
		title: '新拓充装许可网关',
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false
		}
	})
	mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

ipcMain.handle('app:getInitialState', async () => {
	await refreshCredentialState()
	return { config: currentConfig || loadConfig(), state: getState() }
})
ipcMain.handle('config:save', (_event, config) => saveConfig(config))
ipcMain.handle('credential:clear', () => clearStoredPassword())
ipcMain.handle('gateway:login', (_event, payload = {}) => login(payload.password, payload))
ipcMain.handle('gateway:probe', (_event, config) => probe(config))
ipcMain.handle('gateway:start', (_event, config) => startGateway(config))
ipcMain.handle('gateway:stop', () => stopGateway())
ipcMain.handle('audit:open', async () => {
	journal.ensureDir()
	const error = await shell.openPath(getAuditDir())
	if (error) throw new Error(error)
	return true
})

app.whenReady().then(async () => {
	loadConfig()
	journal = new LocalAuditJournal(getAuditDir())
	runtime = new FillingPermitRuntime({
		getConfig: () => currentConfig || loadConfig(),
		journal,
		cloudClient: new CloudClient(
			() => currentConfig || loadConfig(),
			() => ensureToken(),
			() => {
				currentToken = ''
				uiState.cloudStatus = 'auth-fault'
			}
		),
		onState: (state) => {
			if (state.lastQuery && state.lastQuery.reasonCode >= 90) uiState.cloudStatus = 'fault'
			emitState(state.message)
		}
	})
	await refreshCredentialState()
	createWindow()
	if (currentConfig.autoStart) {
		try {
			await startGateway()
		} catch (err) {
			emitState(err && err.message ? err.message : String(err))
		}
	}
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('before-quit', () => {
	if (runtime) void runtime.stop()
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
