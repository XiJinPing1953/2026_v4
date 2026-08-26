'use strict'

const els = {
	connectionStatus: document.getElementById('connectionStatus'),
	alarmBanner: document.getElementById('alarmBanner'),
	alarmTitle: document.getElementById('alarmTitle'),
	alarmMessage: document.getElementById('alarmMessage'),
	acknowledgeBtn: document.getElementById('acknowledgeBtn'),
	tankFill: document.getElementById('tankFill'),
	levelPercent: document.getElementById('levelPercent'),
	levelKpa: document.getElementById('levelKpa'),
	pressureMpa: document.getElementById('pressureMpa'),
	weightT: document.getElementById('weightT'),
	sampledAt: document.getElementById('sampledAt'),
	ageText: document.getElementById('ageText'),
	footerMessage: document.getElementById('footerMessage'),
	soundBtn: document.getElementById('soundBtn'),
	muteBtn: document.getElementById('muteBtn'),
	closeBtn: document.getElementById('closeBtn')
}

let latestState = {}
let muted = false
let audioContext = null
let alarmOscillator = null
let alarmGain = null
let alarmFrequency = null

function formatNumber(value, digits = 2) {
	const num = Number(value)
	return Number.isFinite(num) ? num.toFixed(digits) : '--'
}

function formatTime(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num <= 0) return '--'
	return new Date(num).toLocaleString('zh-CN', { hour12: false })
}

function refreshFreshness() {
	const telemetry = latestState.lastTelemetry
	if (!telemetry) return
	const sampledAt = Number(telemetry.sampled_at)
	if (!Number.isFinite(sampledAt) || sampledAt <= 0) return
	const age = Math.max(Date.now() - sampledAt, 0)
	els.ageText.textContent = age > 60000 ? '数据延迟' : `约 ${Math.round(age / 1000)} 秒前`
	if (latestState.running && latestState.status === 'online' && age > 60000) {
		els.connectionStatus.textContent = '数据延迟'
		els.connectionStatus.className = 'status-badge status-badge--busy'
	}
}

function ensureAudioContext() {
	if (!audioContext) audioContext = new AudioContext()
	if (audioContext.state === 'suspended') void audioContext.resume()
	return audioContext
}

function playTone(frequency = 880, durationMs = 260) {
	if (muted) return
	const context = ensureAudioContext()
	const oscillator = context.createOscillator()
	const gain = context.createGain()
	oscillator.type = 'square'
	oscillator.frequency.value = frequency
	gain.gain.setValueAtTime(0.0001, context.currentTime)
	gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.015)
	gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000)
	oscillator.connect(gain)
	gain.connect(context.destination)
	oscillator.start()
	oscillator.stop(context.currentTime + durationMs / 1000 + 0.02)
}

function playTestSound() {
	muted = false
	els.muteBtn.textContent = '静音'
	playTone(880, 420)
}

function stopAlarmSound() {
	const oscillator = alarmOscillator
	const gain = alarmGain
	alarmOscillator = null
	alarmGain = null
	alarmFrequency = null
	if (!oscillator || !gain || !audioContext) return
	const now = audioContext.currentTime
	try {
		gain.gain.cancelScheduledValues(now)
		gain.gain.setValueAtTime(Math.max(Number(gain.gain.value) || 0.0001, 0.0001), now)
		gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
		oscillator.stop(now + 0.1)
	} catch (_) {
		try { oscillator.stop() } catch (_) {}
	}
}

function startContinuousAlarm(alarms = []) {
	if (!alarms.length || muted || !latestState.running) return
	const hasCritical = alarms.some((item) => item.level === 'critical')
	const frequency = hasCritical ? 980 : 720
	if (alarmOscillator && alarmFrequency === frequency) return
	stopAlarmSound()
	const context = ensureAudioContext()
	const oscillator = context.createOscillator()
	const gain = context.createGain()
	oscillator.type = 'square'
	oscillator.frequency.value = frequency
	gain.gain.setValueAtTime(0.0001, context.currentTime)
	gain.gain.exponentialRampToValueAtTime(hasCritical ? 0.2 : 0.14, context.currentTime + 0.05)
	oscillator.connect(gain)
	gain.connect(context.destination)
	oscillator.start()
	alarmOscillator = oscillator
	alarmGain = gain
	alarmFrequency = frequency
}

function updateAlarmSound(alarms = []) {
	if (!alarms.length || muted || !latestState.running) {
		stopAlarmSound()
		return
	}
	startContinuousAlarm(alarms)
}

function renderState(state = {}) {
	latestState = state || {}
	const statusMap = {
		idle: ['等待采集', 'status-badge--idle'],
		ready: ['已连接', 'status-badge--online'],
		probing: ['正在探测', 'status-badge--busy'],
		starting: ['正在启动', 'status-badge--busy'],
		online: ['在线', 'status-badge--online'],
		error: ['异常', 'status-badge--error'],
		stopped: ['已停止', 'status-badge--idle']
	}
	const [label, className] = statusMap[state.status] || statusMap.idle
	els.connectionStatus.textContent = label
	els.connectionStatus.className = `status-badge ${className}`
	els.footerMessage.textContent = state.message || '等待网关状态'

	const telemetry = state.lastTelemetry
	if (telemetry) {
		const percent = Math.min(Math.max(Number(telemetry.level_percent || 0), 0), 100)
		els.tankFill.style.height = `${percent}%`
		els.levelPercent.textContent = `${formatNumber(percent)}%`
		els.levelKpa.textContent = `${formatNumber(telemetry.level_kpa)} kPa`
		els.pressureMpa.textContent = `${formatNumber(telemetry.pressure_mpa)} MPa`
		els.weightT.textContent = `${formatNumber(telemetry.lng_weight_t)} t`
		els.sampledAt.textContent = formatTime(telemetry.sampled_at)
		const age = Math.max(Date.now() - Number(telemetry.sampled_at || Date.now()), 0)
		els.ageText.textContent = age > 60000 ? '数据延迟' : `约 ${Math.round(age / 1000)} 秒前`
	} else {
		els.tankFill.style.height = '0%'
		els.levelPercent.textContent = '--%'
		els.levelKpa.textContent = '-- kPa'
		els.pressureMpa.textContent = '-- MPa'
		els.weightT.textContent = '-- t'
		els.sampledAt.textContent = '--'
		els.ageText.textContent = '暂无数据'
	}

	const alarms = Array.isArray(state.alarms) ? state.alarms : []
	const unacknowledgedAlarms = alarms.filter((item) => !item.acknowledged)
	if (alarms.length) {
		els.alarmBanner.className = 'alarm-banner alarm-banner--active'
		els.alarmTitle.textContent = alarms.map((item) => item.label).join(' / ')
		els.alarmMessage.textContent = `${alarms.map((item) => item.message).join('；')}；${unacknowledgedAlarms.length ? '请确认报警' : '报警已确认，等待恢复后自动复位'}`
		els.acknowledgeBtn.disabled = unacknowledgedAlarms.length === 0
		els.acknowledgeBtn.textContent = unacknowledgedAlarms.length ? '确认报警' : '已确认，等待复位'
	} else {
		els.alarmBanner.className = 'alarm-banner alarm-banner--hidden'
		els.alarmTitle.textContent = '系统正常'
		els.alarmMessage.textContent = '暂无报警'
		els.acknowledgeBtn.disabled = true
		els.acknowledgeBtn.textContent = '确认报警'
		muted = false
		els.muteBtn.textContent = '静音'
	}
	updateAlarmSound(unacknowledgedAlarms)
}

els.soundBtn.addEventListener('click', playTestSound)
els.acknowledgeBtn.addEventListener('click', async () => {
	try {
		await window.tankGateway.acknowledgeAlarms()
	} catch (err) {
		els.footerMessage.textContent = `确认报警失败：${err && err.message ? err.message : String(err)}`
	}
})
els.muteBtn.addEventListener('click', () => {
	muted = !muted
	els.muteBtn.textContent = muted ? '解除静音' : '静音'
	if (!muted) updateAlarmSound(latestState.alarms || [])
	else stopAlarmSound()
})
els.closeBtn.addEventListener('click', () => window.tankGateway.closeDisplay())

window.tankGateway.onState(renderState)
window.tankGateway.onTestSound(playTestSound)
window.tankGateway.getInitialState().then(({ state }) => renderState(state))
setInterval(refreshFreshness, 1000)
