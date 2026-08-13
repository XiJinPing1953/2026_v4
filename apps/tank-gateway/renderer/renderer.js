'use strict'

const fieldIds = [
	'gatewayUrl',
	'gatewayId',
	'host',
	'port',
	'rack',
	'slot',
	'levelAddress',
	'pressureAddress',
	'weightAddress',
	'levelReferenceKpa',
	'levelReferencePercent',
	'intervalMs',
	'timeoutMs',
	'tankId'
]

const els = {
	form: document.getElementById('configForm'),
	statusText: document.getElementById('statusText'),
	probeBtn: document.getElementById('probeBtn'),
	startBtn: document.getElementById('startBtn'),
	stopBtn: document.getElementById('stopBtn'),
	loginBtn: document.getElementById('loginBtn'),
	clearPasswordBtn: document.getElementById('clearPasswordBtn'),
	password: document.getElementById('password'),
	savePassword: document.getElementById('savePassword'),
	credentialBackend: document.getElementById('credentialBackend'),
	passwordSaved: document.getElementById('passwordSaved'),
	levelKpa: document.getElementById('levelKpa'),
	pressureMpa: document.getElementById('pressureMpa'),
	weightT: document.getElementById('weightT'),
	levelPercent: document.getElementById('levelPercent'),
	tankFill: document.getElementById('tankFill'),
	sampledAt: document.getElementById('sampledAt'),
	logList: document.getElementById('logList')
}

const fields = Object.fromEntries(fieldIds.map((id) => [id, document.getElementById(id)]))
const logs = []
let latestState = {}

function nowText() {
	return new Date().toLocaleString('zh-CN', { hour12: false })
}

function appendLog(message) {
	logs.unshift(`[${nowText()}] ${message}`)
	if (logs.length > 120) logs.pop()
	els.logList.textContent = logs.join('\n')
}

function setBusy(isBusy) {
	if (isBusy) {
		els.probeBtn.disabled = true
		els.startBtn.disabled = true
		els.loginBtn.disabled = true
		return
	}
	renderState(latestState)
}

function readConfigForm() {
	return {
		gatewayUrl: fields.gatewayUrl.value,
		gatewayId: fields.gatewayId.value,
		host: fields.host.value,
		port: Number(fields.port.value),
		rack: Number(fields.rack.value),
		slot: Number(fields.slot.value),
		levelAddress: fields.levelAddress.value,
		pressureAddress: fields.pressureAddress.value,
		weightAddress: fields.weightAddress.value,
		levelReferenceKpa: Number(fields.levelReferenceKpa.value),
		levelReferencePercent: Number(fields.levelReferencePercent.value),
		intervalMs: Number(fields.intervalMs.value),
		timeoutMs: Number(fields.timeoutMs.value),
		tankId: fields.tankId.value
	}
}

function fillConfigForm(config = {}) {
	fieldIds.forEach((id) => {
		if (!fields[id]) return
		fields[id].value = config[id] == null ? '' : String(config[id])
	})
}

function formatNumber(value, digits = 2) {
	const num = Number(value)
	return Number.isFinite(num) ? num.toFixed(digits) : '--'
}

function formatTime(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num <= 0) return '--'
	return new Date(num).toLocaleString('zh-CN', { hour12: false })
}

function renderTelemetry(telemetry) {
	if (!telemetry) {
		els.levelKpa.textContent = '-- kPa'
		els.pressureMpa.textContent = '-- MPa'
		els.weightT.textContent = '-- t'
		els.levelPercent.textContent = '--%'
		els.tankFill.style.height = '0%'
		els.sampledAt.textContent = '--'
		return
	}
	const percent = Math.min(Math.max(Number(telemetry.level_percent || 0), 0), 100)
	els.levelKpa.textContent = `${formatNumber(telemetry.level_kpa)} kPa`
	els.pressureMpa.textContent = `${formatNumber(telemetry.pressure_mpa)} MPa`
	els.weightT.textContent = `${formatNumber(telemetry.lng_weight_t)} t`
	els.levelPercent.textContent = `${formatNumber(percent)}%`
	els.tankFill.style.height = `${percent}%`
	els.sampledAt.textContent = formatTime(telemetry.sampled_at)
}

function renderState(state = {}) {
	latestState = state || {}
	const statusMap = {
		idle: '未启动',
		ready: '已登录',
		probing: '正在探测',
		starting: '正在启动',
		online: '运行中',
		error: '异常',
		stopped: '已停止'
	}
	const label = statusMap[state.status] || state.status || '未启动'
	els.statusText.textContent = state.message ? `${label}：${state.message}` : label
	els.startBtn.disabled = Boolean(state.running)
	els.stopBtn.disabled = !state.running
	els.credentialBackend.textContent = state.credentialBackend || '-'
	els.passwordSaved.textContent = state.passwordSaved ? '已保存' : '未保存'
	renderTelemetry(state.lastTelemetry)
}

async function runAction(label, fn) {
	setBusy(true)
	try {
		const result = await fn()
		appendLog(`${label}成功`)
		return result
	} catch (err) {
		appendLog(`${label}失败：${err && err.message ? err.message : String(err)}`)
		throw err
	} finally {
		setBusy(false)
	}
}

els.form.addEventListener('submit', async (event) => {
	event.preventDefault()
	await runAction('保存设置', async () => {
		const config = await window.tankGateway.saveConfig(readConfigForm())
		fillConfigForm(config)
	})
})

els.loginBtn.addEventListener('click', async () => {
	await runAction('登录', () =>
		window.tankGateway.login({
			config: readConfigForm(),
			password: els.password.value,
			savePassword: els.savePassword.checked
		})
	)
	els.password.value = ''
})

els.clearPasswordBtn.addEventListener('click', async () => {
	await runAction('清除凭据', () => window.tankGateway.clearCredential())
})

els.probeBtn.addEventListener('click', async () => {
	const config = readConfigForm()
	const telemetry = await runAction('单次探测', () => window.tankGateway.probe(config))
	renderTelemetry(telemetry)
	appendLog(
		`地址核对：液位 ${config.levelAddress}；压力 ${config.pressureAddress}；重量 ${config.weightAddress}`
	)
	appendLog(
		`读数核对：液位 ${formatNumber(telemetry.level_kpa)} kPa；压力 ${formatNumber(telemetry.pressure_mpa)} MPa；重量 ${formatNumber(telemetry.lng_weight_t)} t`
	)
})

els.startBtn.addEventListener('click', async () => {
	await runAction('启动', () => window.tankGateway.start(readConfigForm()))
})

els.stopBtn.addEventListener('click', async () => {
	await runAction('停止', () => window.tankGateway.stop())
})

window.tankGateway.onState((state) => {
	renderState(state)
	if (state.message) appendLog(state.message)
})

window.tankGateway.getInitialState().then(({ config, state }) => {
	fillConfigForm(config)
	renderState(state)
	appendLog('界面已就绪')
})
