'use strict'

const configFields = ['gatewayUrl', 'gatewayId', 'bindHost', 'port', 'unitId', 'timeoutMs', 'heartbeatMs', 'syncIntervalMs', 'autoStart']
const byId = (id) => document.getElementById(id)
const fields = Object.fromEntries(configFields.map((id) => [id, byId(id)]))
const logs = []
let latestState = {}

function timeText(value = Date.now()) {
	return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function appendLog(message) {
	if (!message) return
	logs.unshift(`[${timeText()}] ${message}`)
	if (logs.length > 150) logs.pop()
	byId('logList').textContent = logs.join('\n')
}

function readConfig() {
	return {
		gatewayUrl: fields.gatewayUrl.value,
		gatewayId: fields.gatewayId.value,
		bindHost: fields.bindHost.value,
		port: Number(fields.port.value),
		unitId: Number(fields.unitId.value),
		timeoutMs: Number(fields.timeoutMs.value),
		heartbeatMs: Number(fields.heartbeatMs.value),
		syncIntervalMs: Number(fields.syncIntervalMs.value),
		autoStart: fields.autoStart.checked
	}
}

function fillConfig(config = {}) {
	for (const id of configFields) {
		if (id === 'autoStart') fields[id].checked = config[id] === true
		else fields[id].value = config[id] == null ? '' : String(config[id])
	}
}

function stateLabel(value) {
	return ['停止', '启动中', '就绪', '忙', '降级', '故障'][Number(value)] || '未知'
}

function renderState(state = {}) {
	latestState = state
	const gatewayState = Number(state.gatewayState || 0)
	byId('statusText').textContent = `${stateLabel(gatewayState)} · ${state.message || (state.running ? '许可联锁运行中' : '原始许可位保持 0')}`
	byId('hmiState').textContent = stateLabel(gatewayState)
	byId('endpoint').textContent = `${fields.bindHost.value || '-'}:${fields.port.value || '-'} / Unit ${fields.unitId.value || '-'}`
	byId('cloudState').textContent = state.cloudStatus === 'ready' ? '正常' : state.cloudStatus === 'unknown' ? '未知' : '异常'
	byId('cloudMessage').textContent = state.cloudMessage || '-'
	byId('auditState').textContent = state.auditStatus === 'ready' ? '可写' : '故障'
	byId('pendingAudits').textContent = `待补传 ${Number(state.pendingAudits || 0)}`
	byId('bootHeartbeat').textContent = `${state.bootId || '-'} / ${state.heartbeat || 0}`
	byId('faultCode').textContent = `故障码 ${Number(state.faultCode || 0)}`
	byId('credentialState').textContent = `${state.credentialBackend || 'unavailable'} · ${state.passwordSaved ? '密码已保存' : '密码未保存'}`
	const stats = state.stats || {}
	byId('countTotal').textContent = Number(stats.total || 0)
	byId('countAllowed').textContent = Number(stats.allowed || 0)
	byId('countDenied').textContent = Number(stats.denied || 0)
	byId('countFaults').textContent = Number(stats.faults || 0)
	byId('startBtn').disabled = state.running === true
	byId('stopBtn').disabled = state.running !== true
	for (const id of configFields) fields[id].disabled = state.running === true
	const last = state.lastQuery
	if (last) {
		byId('lastQuery').className = last.allowed ? 'permit allowed' : 'permit denied'
		byId('lastQuery').textContent = `${last.allowed ? '允许' : '禁止'} · 原因 ${last.reasonCode} ${last.reasonText || ''} · Boot ${last.bootId} / Seq ${last.sequence} · ${last.latencyMs} ms · ${timeText(last.completedAt)}`
	}
}

async function action(label, fn) {
	try {
		const result = await fn()
		appendLog(`${label}成功`)
		return result
	} catch (err) {
		appendLog(`${label}失败：${err && err.message ? err.message : String(err)}`)
		throw err
	}
}

byId('configForm').addEventListener('submit', async (event) => {
	event.preventDefault()
	const config = await action('保存设置', () => window.fillingPermitGateway.saveConfig(readConfig()))
	fillConfig(config)
})
byId('loginBtn').addEventListener('click', async () => {
	await action('云端登录', () =>
		window.fillingPermitGateway.login({ config: readConfig(), password: byId('password').value, savePassword: byId('savePassword').checked })
	)
	byId('password').value = ''
})
byId('clearPasswordBtn').addEventListener('click', () => action('清除凭据', () => window.fillingPermitGateway.clearCredential()))
byId('probeBtn').addEventListener('click', () => action('云端和审计探测', () => window.fillingPermitGateway.probe(readConfig())))
byId('startBtn').addEventListener('click', () => action('启动网关', () => window.fillingPermitGateway.start(readConfig())))
byId('stopBtn').addEventListener('click', () => action('停止网关', () => window.fillingPermitGateway.stop()))
byId('openAuditBtn').addEventListener('click', () => action('打开审计目录', () => window.fillingPermitGateway.openAuditDir()))

window.fillingPermitGateway.onState((state) => {
	renderState(state)
	if (state.message) appendLog(state.message)
})

window.fillingPermitGateway.getInitialState().then(({ config, state }) => {
	fillConfig(config)
	renderState(state)
	appendLog('界面已就绪；PLC 不由本程序直接连接')
})
