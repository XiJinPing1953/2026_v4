import { normalizeText } from './shared'

export const PDA_BLE_SCALE_BAUD_RATE = 9600
export const PDA_BLE_SCALE_DATA_BITS = 8
export const PDA_BLE_SCALE_STOP_BITS = 1
export const PDA_BLE_SCALE_PARITY = 'none'
export const PDA_BLE_SCALE_FRAME_MODE = 'nvk_uart'
export const PDA_BLE_SCALE_DIVISION_STEP_KG = 0.1
export const PDA_BLE_SCALE_DISPLAY_DECIMALS = 1

const DEFAULT_DEVICE_NAME_PREFIX = 'NVK'
const DEFAULT_SERVICE_ID = '0000FFE0-0000-1000-8000-00805F9B34FB'
const DEFAULT_NOTIFY_CHARACTERISTIC_ID = '0000FFE1-0000-1000-8000-00805F9B34FB'
const DEFAULT_WRITE_CHARACTERISTIC_ID = '0000FFE1-0000-1000-8000-00805F9B34FB'
const DEFAULT_SCAN_TIMEOUT_MS = 5000
const DEFAULT_STALE_AFTER_MS = 3000
const DEFAULT_STABLE_WINDOW_MS = 1200
const DEFAULT_STABLE_MIN_HITS = 5
const DEFAULT_STABLE_HEAD_CONFIRM_MS = 1500
const DEFAULT_SNAPSHOT_EMIT_MS = 200
const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 5000]

function nowMs() {
	return Date.now()
}

function toFiniteNumber(value, fallback = null) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function roundNumber(value, digits = PDA_BLE_SCALE_DISPLAY_DECIMALS) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return Number(num.toFixed(Math.max(0, Number(digits) || 0)))
}

export function quantizeBleScaleWeightKg(value, stepKg = PDA_BLE_SCALE_DIVISION_STEP_KG, digits = PDA_BLE_SCALE_DISPLAY_DECIMALS) {
	const num = toFiniteNumber(value, null)
	const step = Math.max(toFiniteNumber(stepKg, 0) || 0, 0)
	if (num == null) return null
	if (!(step > 0)) return roundNumber(num, digits)
	return roundNumber(Math.round(num / step) * step, digits)
}

function normalizeBleDeviceId(value = '') {
	return normalizeText(value).toUpperCase().replace(/[^0-9A-F]/g, '')
}

function isSameBleDeviceId(left = '', right = '') {
	const normalizedLeft = normalizeBleDeviceId(left)
	const normalizedRight = normalizeBleDeviceId(right)
	if (!normalizedLeft || !normalizedRight) return false
	return normalizedLeft === normalizedRight
}

function normalizeUuidText(value = '') {
	return normalizeText(value).toUpperCase()
}

function toShortUuid(value = '') {
	const normalized = normalizeUuidText(value).replace(/-/g, '')
	if (/^[0-9A-F]{4}$/.test(normalized)) return normalized
	const matched = normalized.match(/^0000([0-9A-F]{4})00001000800000805F9B34FB$/)
	return matched?.[1] || ''
}

function toFullBleUuid(value = '', fallback = '') {
	const normalized = normalizeUuidText(value)
	const shortUuid = toShortUuid(normalized)
	if (shortUuid) return `0000${shortUuid}-0000-1000-8000-00805F9B34FB`
	const fallbackNormalized = normalizeUuidText(fallback)
	const fallbackShort = toShortUuid(fallbackNormalized)
	if (fallbackShort) return `0000${fallbackShort}-0000-1000-8000-00805F9B34FB`
	return fallbackNormalized
}

function matchUuid(uuid = '', expected = '') {
	const left = toShortUuid(uuid)
	const right = toShortUuid(expected)
	if (left && right) return left === right
	return normalizeUuidText(uuid) === normalizeUuidText(expected)
}

function normalizeUnitText(unit) {
	const text = normalizeText(unit).toLowerCase()
	if (!text || text === 'kg') return 'kg'
	if (text === 'g' || text === 't' || text === 'mg') return text
	if (text.includes('公斤') || text.includes('千克')) return 'kg'
	if (text.includes('吨')) return 't'
	if (text.includes('毫克')) return 'mg'
	if (text.includes('克')) return 'g'
	return 'kg'
}

function convertToKg(value, unitText) {
	const num = toFiniteNumber(value, null)
	if (num == null) return null
	const unit = normalizeUnitText(unitText)
	if (unit === 'g') return num / 1000
	if (unit === 't') return num * 1000
	if (unit === 'mg') return num / 1000000
	return num
}

function normalizeSignedNumber(value = '') {
	const compact = String(value || '').replace(/\s+/g, '')
	if (!compact || compact === '+' || compact === '-') return ''
	if (compact.startsWith('+.')) return `+0${compact.slice(1)}`
	if (compact.startsWith('-.')) return `-0${compact.slice(1)}`
	if (compact.startsWith('.')) return `0${compact}`
	return compact
}

function parseSignedWeightText(rawWeight = '', displayDecimals = PDA_BLE_SCALE_DISPLAY_DECIMALS) {
	const token = normalizeSignedNumber(rawWeight)
	const matched = token.match(/^([+-]?)(\d+(?:\.\d+)?)$/)
	if (!matched) return null
	let value = Number(`${matched[1] || ''}${matched[2]}`)
	if (!Number.isFinite(value)) return null
	if (!matched[2].includes('.')) {
		const decimals = Math.max(0, Math.trunc(toFiniteNumber(displayDecimals, 0) || 0))
		if (decimals > 0) value /= 10 ** decimals
	}
	return value
}

function parseWeightWithUnit(payload = '', profile = {}) {
	const source = String(payload || '').replace(/\u0000/g, '').trim()
	const matched = source.match(/^([+-]\s*(?:\d+(?:\.\d+)?|\.\d+))\s*([A-Za-z\u4e00-\u9fa5]{1,4})?$/)
	if (!matched) return null
	const rawValue = parseSignedWeightText(matched[1], profile.displayDecimals)
	if (rawValue == null) return null
	const weightKg = convertToKg(rawValue, matched[2] || 'kg')
	if (weightKg == null) return null
	return {
		weightKg,
		unit: 'kg'
	}
}

function parseHeadFrame(rawLine, profile = {}) {
	const text = String(rawLine || '').replace(/\u0000/g, '').trim()
	const matched = text.match(/^(ST|UT)\s*,\s*NT\s*,\s*(.+)$/i)
	if (!matched) return null
	const parsedWeight = parseWeightWithUnit(matched[2], profile)
	if (!parsedWeight) return null
	return {
		frameMode: 'head',
		weightKg: parsedWeight.weightKg,
		unit: parsedWeight.unit,
		headStable: String(matched[1]).toUpperCase() === 'ST'
	}
}

function parseFixedWeightFrame(rawLine, profile = {}) {
	const source = String(rawLine || '').replace(/\u0000/g, '')
	const line = source.endsWith('\r\n') || source.endsWith('\n') || source.endsWith('\r') ? source.replace(/[\r\n]+$/, '') : source
	if (line.length !== 11) return null
	if (line[0] !== '+' && line[0] !== '-') return null
	const weightField = line.slice(1, 8)
	const unitField = line.slice(8, 11)
	if (!/\d/.test(weightField)) return null
	const rawValue = parseSignedWeightText(`${line[0]}${weightField}`, profile.displayDecimals)
	if (rawValue == null) return null
	const weightKg = convertToKg(rawValue, unitField)
	if (weightKg == null) return null
	return {
		frameMode: 'fixed13',
		weightKg,
		unit: 'kg',
		headStable: null
	}
}

export function parsePdaBleScaleLine(rawLine, profile = {}) {
	return parseHeadFrame(rawLine, profile) || parseFixedWeightFrame(rawLine, profile)
}

function splitLines(source = '') {
	const text = String(source || '')
	if (!text) return { lines: [], rest: '' }
	const lines = []
	let buffer = text
	let index = buffer.search(/\r\n|\n|\r/)
	while (index >= 0) {
		lines.push(buffer.slice(0, index))
		const isCrLf = buffer.slice(index, index + 2) === '\r\n'
		buffer = buffer.slice(index + (isCrLf ? 2 : 1))
		index = buffer.search(/\r\n|\n|\r/)
	}
	return { lines, rest: buffer }
}

function findFixedFrameStart(buffer = '') {
	for (let index = 0; index < buffer.length; index += 1) {
		const ch = buffer[index]
		if (ch !== '+' && ch !== '-') continue
		const prev = index > 0 ? buffer[index - 1] : ''
		if (!prev || prev === '\r' || prev === '\n') return index
	}
	return -1
}

function consumeFixedFrames(sourceBuffer = '', profile = {}) {
	let buffer = String(sourceBuffer || '')
	const frames = []
	let frameRx = 0
	let frameOk = 0
	let frameFail = 0

	while (buffer.length > 0) {
		const start = findFixedFrameStart(buffer)
		if (start < 0) {
			if (buffer.length > 64) buffer = buffer.slice(-32)
			break
		}
		if (start > 0) buffer = buffer.slice(start)
		if (buffer.length < 12) break

		let payload = ''
		let consumed = 0
		if (buffer.length >= 13 && buffer[11] === '\r' && buffer[12] === '\n') {
			payload = buffer.slice(0, 11)
			consumed = 13
		} else if (buffer.length >= 12 && (buffer[11] === '\r' || buffer[11] === '\n')) {
			payload = buffer.slice(0, 11)
			consumed = 12
		} else {
			buffer = buffer.slice(1)
			continue
		}

		frameRx += 1
		const parsed = parseFixedWeightFrame(payload, profile)
		if (parsed) {
			frameOk += 1
			frames.push({ rawLine: payload, parsed })
		} else {
			frameFail += 1
		}
		buffer = buffer.slice(consumed)
	}

	return { frames, buffer, frameRx, frameOk, frameFail }
}

function decodeArrayBuffer(value) {
	if (!value) return ''
	try {
		const view = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer || value)
		if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(view)
		let out = ''
		for (let i = 0; i < view.length; i += 1) out += String.fromCharCode(view[i])
		return out
	} catch (error) {
		return ''
	}
}

function getBytesLength(value) {
	if (!value) return 0
	if (value instanceof ArrayBuffer) return value.byteLength
	if (typeof value.byteLength === 'number') return value.byteLength
	if (typeof value.length === 'number') return value.length
	return 0
}

function parseBleErrorCode(error = null) {
	const numeric = Number(error?.errCode)
	if (Number.isFinite(numeric)) return `err_${Math.trunc(numeric)}`
	const text = normalizeText(error?.errMsg || error?.message)
	if (!text) return ''
	const matched = text.match(/errCode[:=\s]+(-?\d+)/i)
	if (matched?.[1]) return `err_${matched[1]}`
	return text.slice(0, 64)
}

function createDeferred() {
	let resolve = null
	let reject = null
	const promise = new Promise((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function callUni(method, options = {}) {
	return new Promise((resolve, reject) => {
		if (typeof uni === 'undefined' || typeof uni[method] !== 'function') {
			reject(new Error(`uni.${method} 不可用`))
			return
		}
		uni[method]({
			...options,
			success: (res) => resolve(res || {}),
			fail: (error) => reject(error || new Error(`${method} failed`))
		})
	})
}

function runOnAppPlusAndroid(handler, fallback = null) {
	// #ifdef APP-PLUS
	if (typeof plus !== 'undefined' && String(plus?.os?.name || '').toLowerCase() === 'android') return handler()
	// #endif
	return fallback
}

function getAndroidSdkInt() {
	return runOnAppPlusAndroid(() => {
		try {
			const Build = plus.android.importClass('android.os.Build')
			const sdk = Number(Build?.VERSION?.SDK_INT || 0)
			return Number.isFinite(sdk) ? sdk : 0
		} catch (error) {
			return 0
		}
	}, 0)
}

export async function ensurePdaBleRuntimePermission() {
	const supported = runOnAppPlusAndroid(() => true, false)
	if (!supported) return { code: 501, msg: '当前环境不支持 Android BLE 运行时权限申请', data: { granted: [] } }

	const sdkInt = getAndroidSdkInt()
	const permissions =
		sdkInt >= 31
			? ['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT']
			: [
					'android.permission.BLUETOOTH',
					'android.permission.BLUETOOTH_ADMIN',
					'android.permission.ACCESS_FINE_LOCATION',
					'android.permission.ACCESS_COARSE_LOCATION'
				]

	const permissionResult = await new Promise((resolve) => {
		runOnAppPlusAndroid(() => {
			try {
				plus.android.requestPermissions(
					permissions,
					(result) => resolve({ ok: true, data: result || {} }),
					(error) => resolve({ ok: false, error: normalizeText(error?.message) || 'permission_request_failed' })
				)
			} catch (error) {
				resolve({ ok: false, error: normalizeText(error?.message) || 'permission_request_failed' })
			}
			return null
		})
	})

	if (!permissionResult.ok) return { code: 500, msg: permissionResult.error || '蓝牙权限申请失败', data: { granted: [] } }
	const resultData = permissionResult.data || {}
	const denied = [...(resultData.deniedPresent || []), ...(resultData.deniedAlways || [])].filter(Boolean)
	if (denied.length > 0) {
		return {
			code: 403,
			msg: `缺少蓝牙权限: ${denied.join(', ')}`,
			data: {
				granted: resultData.granted || [],
				denied
			}
		}
	}
	return {
		code: 0,
		msg: '',
		data: {
			granted: resultData.granted || permissions,
			denied: []
		}
	}
}

function normalizeProfile(input = {}) {
	return {
		deviceId: normalizeText(input.deviceId || input.device_id),
		deviceNamePrefix: normalizeText(input.deviceNamePrefix || input.device_name_prefix) || DEFAULT_DEVICE_NAME_PREFIX,
		serviceId: toFullBleUuid(input.serviceId || input.service_id, DEFAULT_SERVICE_ID),
		notifyCharacteristicId: toFullBleUuid(input.notifyCharacteristicId || input.notify_characteristic_id, DEFAULT_NOTIFY_CHARACTERISTIC_ID),
		writeCharacteristicId: toFullBleUuid(input.writeCharacteristicId || input.write_characteristic_id, DEFAULT_WRITE_CHARACTERISTIC_ID),
		frameMode: PDA_BLE_SCALE_FRAME_MODE,
		displayDecimals: Math.max(0, Math.trunc(toFiniteNumber(input.displayDecimals || input.display_decimals, PDA_BLE_SCALE_DISPLAY_DECIMALS) || 0)),
		divisionStepKg: Math.max(toFiniteNumber(input.divisionStepKg || input.division_step_kg, PDA_BLE_SCALE_DIVISION_STEP_KG) || 0, 0),
		staleAfterMs: Math.max(toFiniteNumber(input.staleAfterMs || input.stale_after_ms, DEFAULT_STALE_AFTER_MS) || DEFAULT_STALE_AFTER_MS, 1000),
		stableWindowMs: Math.max(toFiniteNumber(input.stableWindowMs || input.stable_window_ms, DEFAULT_STABLE_WINDOW_MS) || DEFAULT_STABLE_WINDOW_MS, 200),
		stableMinHits: Math.max(Math.trunc(toFiniteNumber(input.stableMinHits || input.stable_min_hits, DEFAULT_STABLE_MIN_HITS) || DEFAULT_STABLE_MIN_HITS), 2),
		stableHeadConfirmMs: Math.max(
			toFiniteNumber(input.stableHeadConfirmMs || input.stable_head_confirm_ms, DEFAULT_STABLE_HEAD_CONFIRM_MS) || DEFAULT_STABLE_HEAD_CONFIRM_MS,
			1000
		),
		scanTimeoutMs: Math.max(toFiniteNumber(input.scanTimeoutMs || input.scan_timeout_ms, DEFAULT_SCAN_TIMEOUT_MS) || DEFAULT_SCAN_TIMEOUT_MS, 1000),
		reconnectDelays: Array.isArray(input.reconnectDelays || input.reconnect_delays)
			? (input.reconnectDelays || input.reconnect_delays)
					.map((item) => Math.max(toFiniteNumber(item, 0) || 0, 500))
					.filter(Boolean)
			: [...DEFAULT_RECONNECT_DELAYS]
	}
}

export function createEmptyPdaBleScaleSnapshot(profile = {}) {
	const normalizedProfile = normalizeProfile(profile)
	return {
		weight_kg: null,
		is_stable: false,
		is_connected: false,
		is_online: false,
		unit: 'kg',
		frame_raw: '',
		last_frame_raw: '',
		frame_rx_count: 0,
		frame_parse_ok_count: 0,
		frame_parse_fail_count: 0,
		notify_rx_count: 0,
		notify_rx_bytes: 0,
		last_notify_at: null,
		parser_buffer_len: 0,
		frame_mode: normalizedProfile.frameMode,
		sampled_at: null,
		last_stable_weight_kg: null,
		last_stable_at: null,
		stable_seq: 0,
		error_code: 'not_connected',
		error_message: '吊秤未连接',
		device_id: normalizedProfile.deviceId || '',
		service_id: normalizedProfile.serviceId || '',
		characteristic_id: normalizedProfile.notifyCharacteristicId || ''
	}
}

function pickReconnectDelay(reconnectDelays = [], attempt = 0) {
	if (!Array.isArray(reconnectDelays) || reconnectDelays.length === 0) return DEFAULT_RECONNECT_DELAYS[0]
	const index = Math.min(Math.max(Number(attempt) || 0, 0), reconnectDelays.length - 1)
	return reconnectDelays[index]
}

function pickDeviceByPrefix(devices = [], prefix = '') {
	if (!Array.isArray(devices) || devices.length === 0) return null
	const expected = normalizeText(prefix).toUpperCase()
	if (!expected) return devices[0]
	return (
		devices.find((item) => {
			const name = normalizeText(item?.name || item?.localName).toUpperCase()
			return Boolean(name && name.includes(expected))
		}) || null
	)
}

function normalizeDiscoveredDevice(device = {}) {
	const deviceId = normalizeText(device?.deviceId)
	if (!deviceId) return null
	return {
		deviceId,
		name: normalizeText(device?.name),
		localName: normalizeText(device?.localName)
	}
}

function collectDevicesByPrefix(devices = [], prefix = '') {
	if (!Array.isArray(devices) || devices.length === 0) return []
	const expected = normalizeText(prefix).toUpperCase()
	return devices
		.map((item) => normalizeDiscoveredDevice(item))
		.filter((item) => {
			if (!item) return false
			if (!expected) return true
			const name = `${item.name} ${item.localName}`.toUpperCase()
			return Boolean(name && name.includes(expected))
		})
}

function buildMissingDeviceMessage(prefix = '') {
	return `未发现吊秤设备（名称包含 ${normalizeText(prefix) || '任意'}）`
}

async function discoverDeviceId(profile) {
	const prefix = profile.deviceNamePrefix
	let settled = false
	const deferred = createDeferred()
	const timer = setTimeout(async () => {
		if (settled) return
		settled = true
		try {
			const listRes = await callUni('getBluetoothDevices')
			const picked = pickDeviceByPrefix(listRes?.devices || [], prefix)
			if (picked?.deviceId) deferred.resolve(picked.deviceId)
			else deferred.reject(new Error(buildMissingDeviceMessage(prefix)))
		} catch (error) {
			deferred.reject(error)
		}
	}, profile.scanTimeoutMs)

	const onFound = (res) => {
		const list = Array.isArray(res?.devices) ? res.devices : []
		const picked = pickDeviceByPrefix(list, prefix)
		if (!picked?.deviceId || settled) return
		settled = true
		clearTimeout(timer)
		deferred.resolve(picked.deviceId)
	}

	try {
		if (typeof uni?.onBluetoothDeviceFound === 'function') uni.onBluetoothDeviceFound(onFound)
		await callUni('startBluetoothDevicesDiscovery', { allowDuplicatesKey: false })
		return await deferred.promise
	} finally {
		clearTimeout(timer)
		if (typeof uni?.offBluetoothDeviceFound === 'function') uni.offBluetoothDeviceFound(onFound)
		try {
			await callUni('stopBluetoothDevicesDiscovery')
		} catch (error) {
		}
	}
}

async function discoverDevicesByPrefix(profile) {
	const pickedMap = new Map()
	const addDevices = (devices = []) => {
		collectDevicesByPrefix(devices, profile.deviceNamePrefix).forEach((item) => pickedMap.set(item.deviceId, item))
	}
	const onFound = (res) => {
		addDevices(Array.isArray(res?.devices) ? res.devices : [])
	}
	try {
		if (typeof uni?.onBluetoothDeviceFound === 'function') uni.onBluetoothDeviceFound(onFound)
		await callUni('startBluetoothDevicesDiscovery', { allowDuplicatesKey: false })
		await new Promise((resolve) => setTimeout(resolve, profile.scanTimeoutMs))
		const listRes = await callUni('getBluetoothDevices')
		addDevices(listRes?.devices || [])
		return Array.from(pickedMap.values())
	} finally {
		if (typeof uni?.offBluetoothDeviceFound === 'function') uni.offBluetoothDeviceFound(onFound)
		try {
			await callUni('stopBluetoothDevicesDiscovery')
		} catch (error) {
		}
	}
}

export function createPdaBleScaleSession(inputProfile = {}) {
	let profile = normalizeProfile(inputProfile)
	let snapshot = createEmptyPdaBleScaleSnapshot(profile)
	const listeners = new Set()
	let lineBuffer = ''
	let fixedBuffer = ''
	let connected = false
	let connecting = false
	let keepAlive = false
	let reconnectAttempt = 0
	let reconnectTimer = null
	let staleTimer = null
	let lastFrameAt = 0
	let staleMarked = false
	let deviceId = profile.deviceId || ''
	let serviceId = profile.serviceId
	let notifyCharacteristicId = profile.notifyCharacteristicId
	let writeCharacteristicId = profile.writeCharacteristicId
	let charHandlerBound = null
	let connHandlerBound = null
	let bleListenersAttached = false
	let frameRxCount = 0
	let frameParseOkCount = 0
	let frameParseFailCount = 0
	let notifyRxCount = 0
	let notifyRxBytes = 0
	let lastNotifyAt = 0
	let lastFrameRaw = ''
	let lastStableWeightKg = null
	let lastStableAt = null
	let stableLockedWeightKg = null
	let stableSeq = 0
	let stableSeqLastAt = 0
	let headStableCandidateWeightKg = null
	let headStableCandidateStartAt = 0
	let localStableCandidateWeightKg = null
	let localStableCandidateStartAt = 0
	let localStableCandidateHits = 0
	let lastSnapshotEmitAt = 0
	let snapshotEmitTimer = null

	function notifySnapshotListeners() {
		lastSnapshotEmitAt = nowMs()
		if (snapshotEmitTimer) {
			clearTimeout(snapshotEmitTimer)
			snapshotEmitTimer = null
		}
		for (const listener of listeners) {
			try {
				listener(snapshot)
			} catch (error) {
			}
		}
	}

	function clearSnapshotEmitTimer() {
		if (!snapshotEmitTimer) return
		clearTimeout(snapshotEmitTimer)
		snapshotEmitTimer = null
	}

	function shouldEmitImmediately(previous, patch = {}, options = {}) {
		if (options.immediate) return true
		if (Object.prototype.hasOwnProperty.call(patch, 'is_connected') && patch.is_connected !== previous.is_connected) return true
		if (Object.prototype.hasOwnProperty.call(patch, 'is_online') && patch.is_online !== previous.is_online) return true
		if (Object.prototype.hasOwnProperty.call(patch, 'is_stable') && patch.is_stable !== previous.is_stable) return true
		if (Object.prototype.hasOwnProperty.call(patch, 'last_stable_weight_kg') && patch.last_stable_weight_kg !== previous.last_stable_weight_kg) return true
		if (Object.prototype.hasOwnProperty.call(patch, 'stable_seq') && patch.stable_seq !== previous.stable_seq) return true
		if (Object.prototype.hasOwnProperty.call(patch, 'error_code') && patch.error_code !== previous.error_code) return true
		if (Object.prototype.hasOwnProperty.call(patch, 'error_message') && patch.error_message !== previous.error_message) return true
		return false
	}

	function emit(nextPatch = {}, options = {}) {
		const previous = snapshot
		snapshot = {
			...snapshot,
			...nextPatch
		}
		const elapsed = nowMs() - Number(lastSnapshotEmitAt || 0)
		if (shouldEmitImmediately(previous, nextPatch, options) || elapsed >= DEFAULT_SNAPSHOT_EMIT_MS) {
			notifySnapshotListeners()
			return
		}
		if (snapshotEmitTimer) return
		snapshotEmitTimer = setTimeout(() => {
			notifySnapshotListeners()
		}, Math.max(DEFAULT_SNAPSHOT_EMIT_MS - elapsed, 16))
	}

	function withDiagnostics(nextPatch = {}) {
		return {
			...nextPatch,
			last_frame_raw: lastFrameRaw,
			frame_rx_count: frameRxCount,
			frame_parse_ok_count: frameParseOkCount,
			frame_parse_fail_count: frameParseFailCount,
			notify_rx_count: notifyRxCount,
			notify_rx_bytes: notifyRxBytes,
			last_notify_at: lastNotifyAt || null,
			parser_buffer_len: fixedBuffer.length + lineBuffer.length,
			last_stable_weight_kg: lastStableWeightKg,
			last_stable_at: lastStableAt,
			stable_seq: stableSeq,
			device_id: deviceId,
			service_id: serviceId,
			characteristic_id: notifyCharacteristicId
		}
	}

	function resetReconnectTimer() {
		if (!reconnectTimer) return
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}

	function resetStaleTimer() {
		if (!staleTimer) return
		clearInterval(staleTimer)
		staleTimer = null
	}

	function scheduleReconnect(reason = 'reconnect') {
		if (!keepAlive) return
		resetReconnectTimer()
		const delay = pickReconnectDelay(profile.reconnectDelays, reconnectAttempt)
		reconnectAttempt += 1
		reconnectTimer = setTimeout(() => {
			connectInternal({ reason, silent: true }).catch(() => {})
		}, delay)
	}

	function clearStableCandidates() {
		headStableCandidateWeightKg = null
		headStableCandidateStartAt = 0
		localStableCandidateWeightKg = null
		localStableCandidateStartAt = 0
		localStableCandidateHits = 0
	}

	function resetRuntimeStats() {
		lineBuffer = ''
		fixedBuffer = ''
		frameRxCount = 0
		frameParseOkCount = 0
		frameParseFailCount = 0
		notifyRxCount = 0
		notifyRxBytes = 0
		lastNotifyAt = 0
		lastFrameRaw = ''
		lastStableWeightKg = null
		lastStableAt = null
		stableLockedWeightKg = null
		stableSeq = 0
		stableSeqLastAt = 0
		clearStableCandidates()
		lastFrameAt = 0
		staleMarked = false
	}

	function deriveLocalStableByCandidate(weightKg, sampledAt) {
		const current = quantizeBleScaleWeightKg(weightKg, profile.divisionStepKg, profile.displayDecimals)
		if (current == null) return false
		if (localStableCandidateWeightKg !== current) {
			localStableCandidateWeightKg = current
			localStableCandidateStartAt = sampledAt
			localStableCandidateHits = 1
			return false
		}
		localStableCandidateHits += 1
		return localStableCandidateHits >= profile.stableMinHits && sampledAt - localStableCandidateStartAt >= profile.stableWindowMs
	}

	function deriveHeadStableByCandidate(weightKg, headStable, sampledAt) {
		const current = quantizeBleScaleWeightKg(weightKg, profile.divisionStepKg, profile.displayDecimals)
		if (current == null) return false
		if (!headStableCandidateStartAt) {
			if (headStable) {
				headStableCandidateWeightKg = current
				headStableCandidateStartAt = sampledAt
			}
			return false
		}
		if (headStableCandidateWeightKg !== current) {
			headStableCandidateWeightKg = current
			headStableCandidateStartAt = sampledAt
			return false
		}
		return headStableCandidateStartAt > 0 && sampledAt - headStableCandidateStartAt >= profile.stableHeadConfirmMs
	}

	function deriveBusinessStable(weightKg, parsed, sampledAt) {
		const current = quantizeBleScaleWeightKg(weightKg, profile.divisionStepKg, profile.displayDecimals)
		if (current == null) return false
		const headStable = parsed?.headStable === true
		const headStableConfirmed = deriveHeadStableByCandidate(current, headStable, sampledAt)
		const localStableConfirmed = deriveLocalStableByCandidate(current, sampledAt)
		return headStableConfirmed || localStableConfirmed
	}

	function handleParsedFrame(rawLine, parsed, sampledAt) {
		const quantized = quantizeBleScaleWeightKg(parsed.weightKg, profile.divisionStepKg, profile.displayDecimals)
		if (quantized == null) return
		const stable = deriveBusinessStable(quantized, parsed, sampledAt)
		lastFrameAt = sampledAt
		staleMarked = false
		reconnectAttempt = 0
		lastFrameRaw = String(rawLine || '')
		if (!stable && stableLockedWeightKg !== null && stableLockedWeightKg !== quantized) {
			stableLockedWeightKg = null
			stableSeqLastAt = 0
		}
		if (stable) {
			const shouldPublishStableEvent =
				stableLockedWeightKg !== quantized ||
				!stableSeqLastAt ||
				sampledAt - stableSeqLastAt >= profile.stableHeadConfirmMs
			if (shouldPublishStableEvent) {
				stableSeq += 1
				stableLockedWeightKg = quantized
				stableSeqLastAt = sampledAt
			}
			lastStableWeightKg = quantized
			lastStableAt = sampledAt
		}
		emit(
			withDiagnostics({
				weight_kg: quantized,
				is_stable: stable,
				is_connected: true,
				is_online: true,
				unit: parsed.unit || 'kg',
				frame_raw: String(rawLine || ''),
				frame_mode: parsed.frameMode || PDA_BLE_SCALE_FRAME_MODE,
				sampled_at: sampledAt,
				error_code: null,
				error_message: null
			})
		)
	}

	function consumeScaleChunk(text = '', sampledAt = nowMs()) {
		const source = String(text || '').replace(/\u0000/g, '')
		if (!source) return

		fixedBuffer += source
		const fixed = consumeFixedFrames(fixedBuffer, profile)
		fixedBuffer = fixed.buffer
		frameRxCount += Number(fixed.frameRx || 0)
		frameParseOkCount += Number(fixed.frameOk || 0)
		frameParseFailCount += Number(fixed.frameFail || 0)
		fixed.frames.forEach((item) => handleParsedFrame(item.rawLine, item.parsed, sampledAt))

		lineBuffer += source
		const { lines, rest } = splitLines(lineBuffer)
		lineBuffer = rest
		lines.forEach((line) => {
			const rawLine = String(line || '').replace(/\u0000/g, '')
			const normalized = normalizeText(rawLine)
			if (!normalized || !/^(ST|UT)\s*,/i.test(normalized)) return
			frameRxCount += 1
			const parsed = parseHeadFrame(rawLine, profile)
			if (!parsed) {
				frameParseFailCount += 1
				return
			}
			frameParseOkCount += 1
			handleParsedFrame(rawLine, parsed, sampledAt)
		})
	}

	function handleCharacteristicValueChange(res = {}) {
		if (!connected) return
		const incomingUuid = normalizeUuidText(res?.characteristicId)
		if (incomingUuid && !matchUuid(incomingUuid, notifyCharacteristicId)) return
		const incomingDeviceId = normalizeText(res?.deviceId)
		if (incomingDeviceId && deviceId && !isSameBleDeviceId(incomingDeviceId, deviceId)) return

		const sampledAt = nowMs()
		lastNotifyAt = sampledAt
		notifyRxCount += 1
		notifyRxBytes += getBytesLength(res?.value)
		const beforeOk = frameParseOkCount
		consumeScaleChunk(decodeArrayBuffer(res?.value), sampledAt)
		if (frameParseOkCount === beforeOk) {
			emit(
				withDiagnostics({
					is_connected: true,
					is_online: frameParseOkCount > 0,
					is_stable: false,
					error_code: frameParseOkCount > 0 ? 'waiting_stable' : 'no_valid_frame',
					error_message: frameParseOkCount > 0 ? '称重中，请保持稳定' : '收到吊秤数据但未解析出重量'
				})
			)
		}
	}

	function bindBleListeners() {
		if (!charHandlerBound) charHandlerBound = (res) => handleCharacteristicValueChange(res)
		if (!connHandlerBound) {
			connHandlerBound = (res) => {
				const incomingDeviceId = normalizeText(res?.deviceId)
				if (incomingDeviceId && deviceId && !isSameBleDeviceId(incomingDeviceId, deviceId)) return
				if (res?.connected === false) {
					connected = false
					emit(
						withDiagnostics({
							is_online: false,
							is_stable: false,
							is_connected: false,
							error_code: 'connection_lost',
							error_message: '吊秤连接中断'
						})
					)
					scheduleReconnect('connection_lost')
				}
			}
		}
		if (bleListenersAttached) return
		if (typeof uni?.onBLECharacteristicValueChange === 'function') uni.onBLECharacteristicValueChange(charHandlerBound)
		if (typeof uni?.onBLEConnectionStateChange === 'function') uni.onBLEConnectionStateChange(connHandlerBound)
		bleListenersAttached = true
	}

	async function unbindBleListeners() {
		try {
			if (charHandlerBound && typeof uni?.offBLECharacteristicValueChange === 'function') uni.offBLECharacteristicValueChange(charHandlerBound)
		} catch (error) {
		}
		try {
			if (connHandlerBound && typeof uni?.offBLEConnectionStateChange === 'function') uni.offBLEConnectionStateChange(connHandlerBound)
		} catch (error) {
		}
		charHandlerBound = null
		connHandlerBound = null
		bleListenersAttached = false
	}

	function startStaleWatcher() {
		resetStaleTimer()
		staleTimer = setInterval(() => {
			if (!connected || !lastFrameAt) return
			if (nowMs() - lastFrameAt <= profile.staleAfterMs || staleMarked) return
			staleMarked = true
			emit(
				withDiagnostics({
					is_online: false,
					is_stable: false,
					is_connected: true,
					error_code: 'read_timeout',
					error_message: '吊秤数据超时'
				})
			)
			scheduleReconnect('read_timeout')
		}, 500)
	}

	async function closeConnectionQuietly() {
		if (!deviceId) return
		try {
			await callUni('closeBLEConnection', { deviceId })
		} catch (error) {
		}
	}

	async function closeAdapterQuietly() {
		try {
			await callUni('closeBluetoothAdapter')
		} catch (error) {
		}
	}

	async function connectInternal(options = {}) {
		if (connecting) return { code: 409, msg: '吊秤连接进行中' }
		connecting = true
		resetReconnectTimer()
		const preferredDeviceId = normalizeText(options.preferredDeviceId || options.preferred_device_id)
		const hasPreferredDevice = Boolean(preferredDeviceId)
		const boundDeviceId = hasPreferredDevice ? '' : normalizeText(profile.deviceId || deviceId)
		const connectMode = hasPreferredDevice ? 'preferred' : boundDeviceId ? 'bound' : 'discover'
		let targetDeviceId = hasPreferredDevice ? preferredDeviceId : boundDeviceId

		try {
			await callUni('openBluetoothAdapter')
			bindBleListeners()
			if (!targetDeviceId) targetDeviceId = await discoverDeviceId(profile)
			if (!targetDeviceId) throw new Error(buildMissingDeviceMessage(profile.deviceNamePrefix))

			deviceId = targetDeviceId
			serviceId = profile.serviceId
			notifyCharacteristicId = profile.notifyCharacteristicId
			writeCharacteristicId = profile.writeCharacteristicId
			await callUni('createBLEConnection', { deviceId })
			await callUni('notifyBLECharacteristicValueChange', {
				deviceId,
				serviceId,
				characteristicId: notifyCharacteristicId,
				state: true
			})

			connected = true
			keepAlive = options.keepAlive !== false
			reconnectAttempt = 0
			resetRuntimeStats()
			startStaleWatcher()
			profile = normalizeProfile({
				...profile,
				deviceId,
				serviceId,
				notifyCharacteristicId,
				writeCharacteristicId
			})
			emit(
				withDiagnostics({
					is_online: false,
					is_stable: false,
					is_connected: true,
					error_code: 'waiting_data',
					error_message: '等待称重数据'
				})
			)
			return {
				code: 0,
				msg: options.silent ? '' : '吊秤连接成功',
				data: {
					device_id: deviceId,
					service_id: serviceId,
					characteristic_id: notifyCharacteristicId,
					write_characteristic_id: writeCharacteristicId
				}
			}
		} catch (error) {
			connected = false
			const message = normalizeText(error?.errMsg || error?.message) || '吊秤连接失败'
			const errorCode = parseBleErrorCode(error) || 'connect_failed'
			await closeConnectionQuietly()
			if (connectMode === 'bound') {
				keepAlive = false
				emit(
					withDiagnostics({
						is_online: false,
						is_stable: false,
						is_connected: false,
						error_code: 'bound_device_unavailable',
						error_message: '已绑定吊秤不可用，请更换设备后重试'
					})
				)
				return {
					code: 409,
					msg: '已绑定吊秤不可用，请更换设备后重试',
					data: {
						error_code: 'bound_device_unavailable',
						bound_device_id: boundDeviceId,
						detail: message
					}
				}
			}
			emit(
				withDiagnostics({
					is_online: false,
					is_stable: false,
					is_connected: false,
					error_code: errorCode,
					error_message: message
				})
			)
			if (keepAlive) scheduleReconnect('connect_failed')
			return {
				code: 500,
				msg: message,
				data: null
			}
		} finally {
			connecting = false
		}
	}

	async function disconnect(options = {}) {
		keepAlive = false
		resetReconnectTimer()
		resetStaleTimer()
		await closeConnectionQuietly()
		connected = false
		resetRuntimeStats()
		emit(
			withDiagnostics({
				is_online: false,
				is_stable: false,
				is_connected: false,
				error_code: options.error_code || 'disconnected',
				error_message: options.error_message || '吊秤已断开'
			})
		)
		return { code: 0, msg: '', data: null }
	}

	async function stop() {
		await disconnect({ error_code: 'stopped', error_message: '吊秤会话已停止' })
		await unbindBleListeners()
		await closeAdapterQuietly()
		clearSnapshotEmitTimer()
		return { code: 0, msg: '', data: null }
	}

	async function connect(options = {}) {
		keepAlive = true
		return connectInternal({
			...(options || {}),
			keepAlive: true
		})
	}

	async function discoverDevices() {
		try {
			await callUni('openBluetoothAdapter')
			const devices = await discoverDevicesByPrefix(profile)
			if (!devices.length) return { code: 404, msg: buildMissingDeviceMessage(profile.deviceNamePrefix), data: [] }
			return { code: 0, msg: '', data: devices }
		} catch (error) {
			return {
				code: 500,
				msg: normalizeText(error?.errMsg || error?.message) || '吊秤设备扫描失败',
				data: []
			}
		}
	}

	function onSnapshot(listener) {
		if (typeof listener !== 'function') return () => {}
		listeners.add(listener)
		listener(snapshot)
		return () => {
			listeners.delete(listener)
		}
	}

	function updateProfile(nextProfile = {}) {
		profile = normalizeProfile({
			...profile,
			...(nextProfile || {})
		})
		deviceId = profile.deviceId || deviceId
		serviceId = profile.serviceId
		notifyCharacteristicId = profile.notifyCharacteristicId
		writeCharacteristicId = profile.writeCharacteristicId
		snapshot = {
			...snapshot,
			frame_mode: profile.frameMode,
			device_id: deviceId,
			service_id: serviceId,
			characteristic_id: notifyCharacteristicId
		}
	}

	function getSnapshot() {
		return { ...snapshot }
	}

	return {
		connect,
		start: connect,
		discoverDevices,
		disconnect,
		stop,
		onSnapshot,
		updateProfile,
		getSnapshot
	}
}
