import { normalizeText } from '@/services/pda/shared'

const PLATFORM_PLUGIN_NAME = 'TH-PlatformSDK'
const DEFAULT_BROADCAST_ACTION = 'android.intent.ACTION_DECODE_DATA'
const DEFAULT_BROADCAST_DATA_KEY = 'barcode_string'
const BROADCAST_ACTION_CANDIDATES = [
	DEFAULT_BROADCAST_ACTION,
	'android.intent.action.SCANRESULT',
	'android.intent.action.BARCODE_SCAN',
	'com.android.server.scannerservice.broadcast',
	'com.seuic.scanner.decode',
	'com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED',
	'nlscan.action.SCANNER_RESULT'
]
const BROADCAST_ACTION_CONFIG_KEY = 200000
const BROADCAST_DATA_KEY_CONFIG_KEY = 200002
const BROADCAST_DEDUP_MS = 600
const RECEIVER_CLASS_CANDIDATES = ['io.dcloud.feature.internal.reflect.BroadcastReceiver', 'io.dcloud.android.content.BroadcastReceiver']
const INTENT_FILTER_CLASS = 'android.content.IntentFilter'
const SCANNER_BROADCAST_OUTPUT_MODE = 0
const SCANNER_PROFILE_READ_TIMEOUT_MS = 900
const SCANNER_OPEN_SETTLE_MS = 250
const SCANNER_PROFILE_RETRY_DELAY_MS = 150

const TYPE_KEYS = ['barcodeType', 'barcode_type', 'symbology', 'symName', 'codetype', 'com.ubx.datawedge.symbology_name']
const TEXT_KEYS = [DEFAULT_BROADCAST_DATA_KEY, 'scannerdata', 'decode_data', 'data', 'com.ubx.datawedge.data_string']

export const PDA_CAPTURE_TARGETS = {
	FILLING_BOTTLE_NO: 'filling.bottleNo',
	SALE_CUSTOMER: 'sale.customer',
	SALE_DELIVERY_1: 'sale.delivery1',
	SALE_DELIVERY_2: 'sale.delivery2',
	SALE_VEHICLE_NO: 'sale.vehicleNo',
	saleOutBottleNo(index = 0) {
		return `sale.out[${Number(index) || 0}].bottleNo`
	},
	saleBackBottleNo(index = 0) {
		return `sale.back[${Number(index) || 0}].bottleNo`
	}
}

const runtimeState = {
	supported: null,
	pluginReady: false,
	captureMode: 'unknown',
	ready: false,
	mainActivity: null,
	plugin: null,
	receiver: null,
	receiverRegistered: false,
	session: null,
	lastError: '',
	broadcastAction: DEFAULT_BROADCAST_ACTION,
	broadcastDataKey: DEFAULT_BROADCAST_DATA_KEY,
	registeredActions: [],
	scannerProfile: {
		active: false,
		before: null,
		applied: null,
		restored: null,
		lastError: '',
		openedBySession: false,
		defaultedBroadcastProfile: false
	},
	lastPayload: '',
	lastSymbology: '',
	lastBroadcastAction: '',
	lastDelivered: {
		target: '',
		rawText: '',
		at: 0
	},
	diagnostic: {
		broadcastReceivedCount: 0,
		broadcastMatchedCount: 0,
		broadcastPayloadCount: 0,
		broadcastIgnoredCount: 0,
		broadcastDedupedCount: 0,
		lastExtraKeys: []
	}
}

function isAndroidAppPlus() {
	// #ifdef APP-PLUS
	return typeof plus !== 'undefined' && String(plus?.os?.name || '').toLowerCase() === 'android'
	// #endif
	return false
}

function normalizeBarcodeTargetMeta(targetMeta = null) {
	if (!targetMeta || typeof targetMeta !== 'object') return null
	const target = normalizeText(targetMeta.target)
	if (!target) return null
	const index = Number(targetMeta.index)
	return {
		page: normalizeText(targetMeta.page),
		target,
		label: normalizeText(targetMeta.label),
		scope: normalizeText(targetMeta.scope),
		field: normalizeText(targetMeta.field),
		type: normalizeText(targetMeta.type),
		index: Number.isInteger(index) ? index : null
	}
}

function normalizeBroadcastActions(actions = []) {
	const list = Array.isArray(actions) ? actions : [actions]
	const normalized = list.map((item) => normalizeText(item)).filter(Boolean)
	return Array.from(new Set(normalized))
}

function resolveBroadcastActions() {
	const actions = normalizeBroadcastActions([runtimeState.broadcastAction, ...BROADCAST_ACTION_CANDIDATES])
	return actions.length ? actions : [DEFAULT_BROADCAST_ACTION]
}

function decodeIntentByteArray(bytes = null) {
	if (!bytes || typeof bytes.length !== 'number' || bytes.length <= 0) return ''
	let out = ''
	for (let index = 0; index < bytes.length; index += 1) {
		const raw = Number(bytes[index])
		const code = raw < 0 ? raw + 256 : raw
		if (code === 0) break
		out += String.fromCharCode(code)
	}
	return normalizeText(out)
}

function extractIntentExtra(intent, keys = []) {
	// #ifdef APP-PLUS
	for (let index = 0; index < keys.length; index += 1) {
		const key = normalizeText(keys[index])
		if (!key) continue
		try {
			const value = typeof intent.getStringExtra === 'function' ? intent.getStringExtra(key) : plus.android.invoke(intent, 'getStringExtra', key)
			const text = normalizeText(value)
			if (text) return text
		} catch (error) {
		}
		try {
			const bytes = typeof intent.getByteArrayExtra === 'function' ? intent.getByteArrayExtra(key) : plus.android.invoke(intent, 'getByteArrayExtra', key)
			const text = decodeIntentByteArray(bytes)
			if (text) return text
		} catch (error) {
		}
	}
	// #endif
	return ''
}

function getIntentExtraKeys(intent) {
	// #ifdef APP-PLUS
	try {
		const extras = typeof intent.getExtras === 'function' ? intent.getExtras() : plus.android.invoke(intent, 'getExtras')
		if (!extras) return []
		const keySet = typeof extras.keySet === 'function' ? extras.keySet() : plus.android.invoke(extras, 'keySet')
		if (!keySet) return []
		const iterator = typeof keySet.iterator === 'function' ? keySet.iterator() : plus.android.invoke(keySet, 'iterator')
		if (!iterator) return []
		const keys = []
		while (true) {
			const hasNext = typeof iterator.hasNext === 'function' ? iterator.hasNext() : plus.android.invoke(iterator, 'hasNext')
			if (!hasNext) break
			const next = typeof iterator.next === 'function' ? iterator.next() : plus.android.invoke(iterator, 'next')
			const text = normalizeText(next)
			if (text) keys.push(text)
		}
		return Array.from(new Set(keys))
	} catch (error) {
	}
	// #endif
	return []
}

function getPlatformPlugin() {
	try {
		const plugin = uni.requireNativePlugin(PLATFORM_PLUGIN_NAME)
		return plugin || null
	} catch (error) {
		return null
	}
}

function normalizeProfileDiagnosticValue(value) {
	if (value == null) return null
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
	if (Array.isArray(value)) return value.map((item) => normalizeProfileDiagnosticValue(item))
	try {
		return JSON.parse(JSON.stringify(value))
	} catch (error) {
		return normalizeText(value)
	}
}

function delay(ms = 0) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

function normalizeOutputMode(value) {
	const mode = Number(value)
	if (mode === 0 || mode === 1) return mode
	return null
}

function normalizeScannerPowerState(value) {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value > 0
	const text = normalizeText(value).toLowerCase()
	if (['true', '1', 'open', 'opened', 'on', 'yes'].includes(text)) return true
	if (['false', '0', 'close', 'closed', 'off', 'no'].includes(text)) return false
	return null
}

function pickParameterValue(value, key, index = 0) {
	const normalized = normalizeProfileDiagnosticValue(value)
	if (normalized == null) return null
	if (Array.isArray(normalized)) return normalized[index] ?? normalized[0] ?? null
	if (typeof normalized === 'object') {
		const keyText = String(key)
		if (Object.prototype.hasOwnProperty.call(normalized, keyText)) return normalized[keyText]
		if (Object.prototype.hasOwnProperty.call(normalized, key)) return normalized[key]
		if (Array.isArray(normalized.data)) return normalized.data[index] ?? normalized.data[0] ?? null
		if (normalized.data && typeof normalized.data === 'object') return normalized.data[keyText] ?? normalized.data[key] ?? null
		if (Object.prototype.hasOwnProperty.call(normalized, 'data')) return normalized.data
		if (Object.prototype.hasOwnProperty.call(normalized, 'value')) return normalized.value
	}
	return normalized
}

function summarizePluginResult(methodName, result = {}) {
	if (result.ok) return ''
	return normalizeText(result.msg) || `插件方法调用失败: ${methodName}`
}

function summarizeParameterAttempt(attempt = {}) {
	const label = normalizeText(attempt.label) || String(attempt.key || '')
	const prefix = label ? `${label}/${attempt.method}` : normalizeText(attempt.method)
	if (!attempt.ok) return `${prefix}: ${attempt.msg || '读取失败'}`
	return `${prefix}: 返回空`
}

function isBroadcastProfileMissing(snapshot = {}) {
	return !normalizeText(snapshot?.broadcastAction) || !normalizeText(snapshot?.broadcastDataKey)
}

function callPluginSetter(methodName, args = []) {
	const plugin = runtimeState.plugin
	if (!plugin || typeof plugin[methodName] !== 'function') {
		return {
			ok: false,
			skipped: true,
			msg: `插件方法不可用: ${methodName}`
		}
	}
	try {
		const ret = plugin[methodName](...args)
		if (ret === false) {
			return {
				ok: false,
				ret: false,
				msg: `插件方法返回失败: ${methodName}`
			}
		}
		return {
			ok: true,
			ret: normalizeProfileDiagnosticValue(ret)
		}
	} catch (error) {
		return {
			ok: false,
			msg: normalizeText(error?.message) || `插件方法调用失败: ${methodName}`
		}
	}
}

function callPluginGetter(methodName, args = []) {
	const plugin = runtimeState.plugin
	if (!plugin || typeof plugin[methodName] !== 'function') {
		return Promise.resolve({
			ok: false,
			skipped: true,
			msg: `插件方法不可用: ${methodName}`
		})
	}
	return new Promise((resolve) => {
		let settled = false
		const done = (result) => {
			if (settled) return
			settled = true
			resolve(result)
		}
		const timer = setTimeout(() => {
			done({
				ok: false,
				timeout: true,
				msg: `读取扫码配置超时: ${methodName}`
			})
		}, SCANNER_PROFILE_READ_TIMEOUT_MS)
		const finish = (result) => {
			clearTimeout(timer)
			done(result)
		}
		try {
			const ret = plugin[methodName](...args, (value) => {
				finish({
					ok: true,
					value: normalizeProfileDiagnosticValue(value),
					via: 'callback'
				})
			})
			if (ret !== undefined) {
				finish({
					ok: true,
					value: normalizeProfileDiagnosticValue(ret),
					via: 'return'
				})
			}
		} catch (callbackError) {
			try {
				const ret = plugin[methodName](...args)
				clearTimeout(timer)
				done({
					ok: true,
					value: normalizeProfileDiagnosticValue(ret),
					via: 'return'
				})
			} catch (error) {
				clearTimeout(timer)
				done({
					ok: false,
					msg: normalizeText(error?.message || callbackError?.message) || `插件方法调用失败: ${methodName}`
				})
			}
		}
	})
}

async function readScanParameterString(key, label = '') {
	const attempts = []
	const readWith = async (methodName, args = []) => {
		const res = await callPluginGetter(methodName, args)
		const value = res.ok ? pickParameterValue(res.value, key, 0) : null
		attempts.push({
			label,
			key,
			method: methodName,
			ok: Boolean(res.ok),
			via: normalizeText(res.via),
			timeout: Boolean(res.timeout),
			skipped: Boolean(res.skipped),
			value: normalizeProfileDiagnosticValue(value),
			rawValue: res.ok ? normalizeProfileDiagnosticValue(res.value) : null,
			msg: res.ok ? '' : summarizePluginResult(methodName, res)
		})
		return value
	}
	const scanValue = await readWith('getScanParameterString', [[key]])
	if (normalizeText(scanValue)) {
		return {
			value: scanValue,
			attempts,
			readErrors: attempts.filter((item) => !item.ok).map((item) => summarizeParameterAttempt(item)).filter(Boolean)
		}
	}
	const parameterValue = await readWith('getParameterString', [[key]])
	const finalValue = normalizeText(parameterValue)
	return {
		value: parameterValue,
		attempts,
		readErrors: finalValue ? attempts.filter((item) => !item.ok).map((item) => summarizeParameterAttempt(item)).filter(Boolean) : attempts.map((item) => summarizeParameterAttempt(item)).filter(Boolean)
	}
}

async function captureScannerProfileSnapshot(label = '') {
	const [outputModeRes, triggerLockRes, scannerStateRes, actionRead, dataKeyRead] = await Promise.all([
		callPluginGetter('getOutputMode'),
		callPluginGetter('getTriggerLockState'),
		callPluginGetter('getScannerState'),
		readScanParameterString(BROADCAST_ACTION_CONFIG_KEY, 'broadcastAction'),
		readScanParameterString(BROADCAST_DATA_KEY_CONFIG_KEY, 'broadcastDataKey')
	])
	const outputModeValue = outputModeRes.ok ? pickParameterValue(outputModeRes.value, 'outputMode') : null
	const outputMode = normalizeOutputMode(outputModeValue)
	const scannerStateValue = scannerStateRes.ok ? pickParameterValue(scannerStateRes.value, 'scannerState') : null
	const readErrors = [outputModeRes, triggerLockRes, scannerStateRes]
		.filter((item) => !item.ok && !item.skipped)
		.map((item) => normalizeText(item.msg))
		.filter(Boolean)
	if (outputModeRes.ok && outputMode == null) {
		readErrors.push(`getOutputMode: 返回无效值 ${normalizeText(outputModeValue) || 'null'}`)
	}
	if (!normalizeText(actionRead.value)) readErrors.push(...actionRead.readErrors)
	if (!normalizeText(dataKeyRead.value)) readErrors.push(...dataKeyRead.readErrors)
	return {
		label,
		at: Date.now(),
		outputMode,
		outputModeRaw: normalizeProfileDiagnosticValue(outputModeValue),
		triggerLockState: triggerLockRes.ok ? pickParameterValue(triggerLockRes.value, 'triggerLockState') : null,
		scannerState: normalizeScannerPowerState(scannerStateValue),
		scannerStateRaw: normalizeProfileDiagnosticValue(scannerStateValue),
		broadcastAction: normalizeText(actionRead.value),
		broadcastDataKey: normalizeText(dataKeyRead.value),
		defaultedBroadcastProfile: Boolean(runtimeState.scannerProfile.defaultedBroadcastProfile),
		openedBySession: Boolean(runtimeState.scannerProfile.openedBySession),
		readDiagnostics: [...actionRead.attempts, ...dataKeyRead.attempts],
		readErrors
	}
}

function applyBroadcastProfile() {
	const plugin = runtimeState.plugin
	if (!plugin || typeof plugin.setScanParameterString !== 'function') return { ok: true, skipped: true }
	try {
		plugin.setScanParameterString([BROADCAST_ACTION_CONFIG_KEY, BROADCAST_DATA_KEY_CONFIG_KEY], [runtimeState.broadcastAction, runtimeState.broadcastDataKey], () => {})
		return { ok: true }
	} catch (error) {
		return {
			ok: false,
			msg: normalizeText(error?.message) || '设置扫码广播参数失败'
		}
	}
}

function shouldSuppressDuplicate(targetMeta = null, rawText = '') {
	const target = normalizeText(targetMeta?.target)
	const text = normalizeText(rawText)
	if (!target || !text) return false
	const now = Date.now()
	const duplicate =
		runtimeState.lastDelivered.target === target &&
		runtimeState.lastDelivered.rawText === text &&
		now - Number(runtimeState.lastDelivered.at || 0) < BROADCAST_DEDUP_MS
	if (!duplicate) {
		runtimeState.lastDelivered = {
			target,
			rawText: text,
			at: now
		}
	}
	return duplicate
}

function dispatchBarcodeSessionPayload(payload = {}) {
	const session = runtimeState.session
	if (!session || typeof session.onResult !== 'function') return
	const routeResolver = typeof session.routeResolver === 'function' ? session.routeResolver : null
	const targetMeta = normalizeBarcodeTargetMeta(routeResolver ? routeResolver(session.activeTarget || null, payload) : session.activeTarget)
	const rawText = normalizeText(payload.rawText)
	if (!targetMeta || !rawText) return
	if (shouldSuppressDuplicate(targetMeta, rawText)) {
		runtimeState.diagnostic.broadcastDedupedCount += 1
		return
	}
	session.onResult({
		rawText,
		symbology: normalizeText(payload.symbology),
		action: normalizeText(payload.action),
		targetMeta
	})
}

function createBroadcastReceiver() {
	// #ifdef APP-PLUS
	for (let index = 0; index < RECEIVER_CLASS_CANDIDATES.length; index += 1) {
		const receiverClass = RECEIVER_CLASS_CANDIDATES[index]
		try {
			const receiver = plus.android.implements(receiverClass, {
				onReceive(context, intent) {
					void context
					try {
						plus.android.importClass(intent)
					} catch (importError) {
					}
						const action = normalizeText(typeof intent.getAction === 'function' ? intent.getAction() : plus.android.invoke(intent, 'getAction'))
						runtimeState.diagnostic.broadcastReceivedCount += 1
						runtimeState.lastBroadcastAction = action
						const registeredActions = Array.isArray(runtimeState.registeredActions) && runtimeState.registeredActions.length ? runtimeState.registeredActions : resolveBroadcastActions()
						if (!registeredActions.includes(action)) {
							runtimeState.diagnostic.broadcastIgnoredCount += 1
							return
						}
					runtimeState.diagnostic.broadcastMatchedCount += 1
					const extraKeys = getIntentExtraKeys(intent)
					runtimeState.diagnostic.lastExtraKeys = extraKeys.slice(0, 20)
					const rawText = extractIntentExtra(intent, [runtimeState.broadcastDataKey, ...TEXT_KEYS, ...extraKeys])
					if (!rawText) {
						runtimeState.diagnostic.broadcastIgnoredCount += 1
						return
					}
					const symbology = extractIntentExtra(intent, [...TYPE_KEYS, ...extraKeys])
					runtimeState.diagnostic.broadcastPayloadCount += 1
					runtimeState.lastPayload = rawText
					runtimeState.lastSymbology = symbology
					dispatchBarcodeSessionPayload({
						rawText,
						symbology,
						action
					})
				}
			})
			if (receiver) return receiver
		} catch (error) {
		}
	}
	// #endif
	return null
}

function registerBroadcastReceiver() {
	// #ifdef APP-PLUS
	if (runtimeState.receiverRegistered) return { ok: true }
	if (!runtimeState.mainActivity || !runtimeState.receiver) return { ok: false, msg: '广播接收器未就绪' }
	try {
		const filter = plus.android.newObject(INTENT_FILTER_CLASS)
		const registeredActions = resolveBroadcastActions()
		registeredActions.forEach((action) => {
			plus.android.invoke(filter, 'addAction', action)
		})
		plus.android.invoke(runtimeState.mainActivity, 'registerReceiver', runtimeState.receiver, filter)
		runtimeState.receiverRegistered = true
		runtimeState.registeredActions = registeredActions
		return { ok: true }
	} catch (error) {
		runtimeState.registeredActions = []
		return {
			ok: false,
			msg: normalizeText(error?.message) || '注册扫码广播失败'
		}
	}
	// #endif
	return { ok: false, msg: '当前环境不支持扫描采集' }
}

function unregisterBroadcastReceiver() {
	// #ifdef APP-PLUS
	if (!runtimeState.receiverRegistered || !runtimeState.mainActivity || !runtimeState.receiver) return
	try {
		plus.android.invoke(runtimeState.mainActivity, 'unregisterReceiver', runtimeState.receiver)
	} catch (error) {
	} finally {
		runtimeState.receiverRegistered = false
		runtimeState.registeredActions = []
	}
	// #endif
}

function ensureRuntimeReady() {
	if (!isAndroidAppPlus()) {
		runtimeState.supported = false
		runtimeState.captureMode = 'unsupported'
		runtimeState.lastError = '仅支持 Android PDA 真机采集'
		return { ok: false, msg: runtimeState.lastError }
	}
	if (!runtimeState.plugin) runtimeState.plugin = getPlatformPlugin()
	const pluginReady = Boolean(runtimeState.plugin)
	if (!pluginReady) {
		runtimeState.supported = false
		runtimeState.pluginReady = false
		runtimeState.captureMode = 'failed'
		runtimeState.ready = false
		runtimeState.lastError = '当前构建未集成 TH-PlatformSDK 插件，请使用包含该插件的自定义基座'
		return { ok: false, msg: runtimeState.lastError }
	}
	// #ifdef APP-PLUS
	try {
		if (!runtimeState.mainActivity) runtimeState.mainActivity = plus.android.runtimeMainActivity()
		if (!runtimeState.receiver) runtimeState.receiver = createBroadcastReceiver()
		if (!runtimeState.receiver) {
			runtimeState.supported = false
			runtimeState.captureMode = 'failed'
			runtimeState.lastError = '扫码广播接收器创建失败'
			return { ok: false, msg: runtimeState.lastError }
		}
		runtimeState.supported = true
		runtimeState.pluginReady = true
		runtimeState.captureMode = 'enhanced'
		runtimeState.ready = true
		runtimeState.lastError = ''
		return { ok: true, warning: '' }
	} catch (error) {
		runtimeState.supported = false
		runtimeState.pluginReady = false
		runtimeState.captureMode = 'failed'
		runtimeState.lastError = normalizeText(error?.message) || '扫码插件初始化失败'
		return { ok: false, msg: runtimeState.lastError }
	}
	// #endif
	runtimeState.captureMode = 'unsupported'
	return { ok: false, msg: '当前环境不支持扫描采集' }
}

function releaseScanProfile() {
	if (!runtimeState.pluginReady) return Promise.resolve({ ok: true, skipped: true })
	if (!runtimeState.scannerProfile.active && !runtimeState.scannerProfile.openedBySession) return Promise.resolve({ ok: true, skipped: true })
	return restoreScannerProfileSnapshot()
}

async function ensureScannerPoweredForSession() {
	const stateRes = await callPluginGetter('getScannerState')
	const stateValue = stateRes.ok ? normalizeScannerPowerState(pickParameterValue(stateRes.value, 'scannerState')) : null
	if (stateValue === true) {
		return { ok: true, alreadyOpen: true }
	}
	const openResult = callPluginSetter('openScanner')
	if (!openResult.ok) {
		runtimeState.scannerProfile.openedBySession = false
		return {
			ok: false,
			msg: openResult.msg || '扫描头打开失败，请检查扫描头是否启用'
		}
	}
	runtimeState.scannerProfile.openedBySession = true
	await delay(SCANNER_OPEN_SETTLE_MS)
	const verifyRes = await callPluginGetter('getScannerState')
	let verifyState = verifyRes.ok ? normalizeScannerPowerState(pickParameterValue(verifyRes.value, 'scannerState')) : null
	if (verifyState === false) {
		await delay(SCANNER_PROFILE_RETRY_DELAY_MS)
		const retryVerifyRes = await callPluginGetter('getScannerState')
		verifyState = retryVerifyRes.ok ? normalizeScannerPowerState(pickParameterValue(retryVerifyRes.value, 'scannerState')) : verifyState
	}
	if (verifyState === false) {
		return {
			ok: false,
			msg: '扫描头打开失败，请检查扫描头是否启用'
		}
	}
	const warning = verifyRes.ok ? '' : summarizePluginResult('getScannerState', verifyRes)
	return { ok: true, warning }
}

async function captureScannerProfileSnapshotWithRetry() {
	let snapshot = await captureScannerProfileSnapshot('before-enter')
	if (!isBroadcastProfileMissing(snapshot)) return snapshot
	await delay(SCANNER_PROFILE_RETRY_DELAY_MS)
	const retrySnapshot = await captureScannerProfileSnapshot('before-enter-retry')
	if (!isBroadcastProfileMissing(retrySnapshot)) return retrySnapshot
	return retrySnapshot || snapshot
}

function applyDefaultBroadcastProfileSnapshot(snapshot = {}) {
	const broadcastAction = normalizeText(snapshot.broadcastAction)
	const broadcastDataKey = normalizeText(snapshot.broadcastDataKey)
	if (broadcastAction && broadcastDataKey) {
		runtimeState.scannerProfile.defaultedBroadcastProfile = false
		return snapshot
	}
	const readErrors = Array.isArray(snapshot.readErrors) ? snapshot.readErrors.slice() : []
	if (!broadcastAction) readErrors.push(`broadcastAction: 读取为空，已使用默认值 ${DEFAULT_BROADCAST_ACTION}`)
	if (!broadcastDataKey) readErrors.push(`broadcastDataKey: 读取为空，已使用默认值 ${DEFAULT_BROADCAST_DATA_KEY}`)
	runtimeState.scannerProfile.defaultedBroadcastProfile = true
	return {
		...snapshot,
		broadcastAction: broadcastAction || DEFAULT_BROADCAST_ACTION,
		broadcastDataKey: broadcastDataKey || DEFAULT_BROADCAST_DATA_KEY,
		defaultedBroadcastProfile: true,
		readErrors
	}
}

async function applyScannerProfileSnapshot() {
	if (!runtimeState.pluginReady) {
		return { ok: false, msg: '当前构建未集成 TH-PlatformSDK 插件，请使用包含该插件的自定义基座' }
	}
	if (!runtimeState.scannerProfile.active) {
		runtimeState.scannerProfile.defaultedBroadcastProfile = false
		const powerResult = await ensureScannerPoweredForSession()
		if (!powerResult.ok) {
			runtimeState.scannerProfile.lastError = powerResult.msg || ''
			return { ok: false, msg: powerResult.msg || '扫描头打开失败' }
		}
		runtimeState.scannerProfile.before = applyDefaultBroadcastProfileSnapshot(await captureScannerProfileSnapshotWithRetry())
	}
	const before = runtimeState.scannerProfile.before
	if (normalizeOutputMode(before?.outputMode) == null) {
		runtimeState.scannerProfile.lastError = '无法读取扫描头输出模式，已取消接管'
		return { ok: false, msg: '无法读取扫描头输出模式，已取消接管以避免破坏原生配置' }
	}
	if (!normalizeText(before?.broadcastAction) || !normalizeText(before?.broadcastDataKey)) {
		runtimeState.scannerProfile.lastError = '无法读取扫描头广播配置，已取消接管'
		return { ok: false, msg: '无法读取扫描头广播配置，已取消接管以避免破坏原生配置' }
	}
	const outputResult = callPluginSetter('switchOutputMode', [SCANNER_BROADCAST_OUTPUT_MODE])
	if (!outputResult.ok) {
		runtimeState.scannerProfile.lastError = outputResult.msg || ''
		return { ok: false, msg: outputResult.msg || '切换扫码广播输出失败' }
	}
	runtimeState.scannerProfile.active = true
	runtimeState.scannerProfile.lastError = ''
	return { ok: true }
}

async function restoreScannerProfileSnapshot() {
	if (!runtimeState.pluginReady) return { ok: true, skipped: true }
	const before = runtimeState.scannerProfile.before
	const openedBySession = Boolean(runtimeState.scannerProfile.openedBySession)
	let restoreError = ''
	if (before?.broadcastAction || before?.broadcastDataKey) {
		const action = before.broadcastAction || runtimeState.broadcastAction
		const dataKey = before.broadcastDataKey || runtimeState.broadcastDataKey
		const restoreBroadcast = callPluginSetter('setScanParameterString', [
			[BROADCAST_ACTION_CONFIG_KEY, BROADCAST_DATA_KEY_CONFIG_KEY],
			[action, dataKey],
			() => {}
		])
		if (!restoreBroadcast.ok) restoreError = restoreBroadcast.msg || restoreError
	}
	const outputMode = normalizeOutputMode(before?.outputMode)
	if (outputMode != null) {
		const restoreOutput = callPluginSetter('switchOutputMode', [outputMode])
		if (!restoreOutput.ok) restoreError = restoreOutput.msg || restoreError
	}
	runtimeState.scannerProfile.restored = await captureScannerProfileSnapshot('after-restore')
	if (openedBySession) {
		const closeResult = callPluginSetter('closeScanner')
		if (!closeResult.ok) restoreError = closeResult.msg || restoreError
		runtimeState.scannerProfile.restored = {
			...runtimeState.scannerProfile.restored,
			closedBySession: Boolean(closeResult.ok),
			closeError: closeResult.ok ? '' : normalizeText(closeResult.msg)
		}
	}
	runtimeState.scannerProfile.active = false
	runtimeState.scannerProfile.openedBySession = false
	runtimeState.scannerProfile.defaultedBroadcastProfile = false
	runtimeState.scannerProfile.lastError = restoreError
	if (restoreError) return { ok: false, msg: restoreError }
	return { ok: true }
}

async function ensureSharedCaptureReady() {
	if (!runtimeState.pluginReady) {
		return { ok: false, msg: '当前构建未集成 TH-PlatformSDK 插件，请使用包含该插件的自定义基座' }
	}
	let warning = ''
	const profileResult = await applyScannerProfileSnapshot()
	if (!profileResult.ok) return { ok: false, msg: profileResult.msg || '设置扫码模式失败' }
	const broadcastResult = applyBroadcastProfile()
	if (!broadcastResult.ok) {
		runtimeState.lastError = broadcastResult.msg || ''
		warning = runtimeState.lastError
	}
	runtimeState.scannerProfile.applied = await captureScannerProfileSnapshot('after-enter')
	const receiverResult = registerBroadcastReceiver()
	if (!receiverResult.ok) return { ok: false, msg: receiverResult.msg || '注册扫码广播失败' }
	return { ok: true, warning }
}

async function releaseHardwareIfIdle() {
	if (runtimeState.session) return
	unregisterBroadcastReceiver()
	await releaseScanProfile()
}

export async function enterBarcodeSession(options = {}) {
	const ready = ensureRuntimeReady()
	if (!ready.ok) return { code: 501, msg: ready.msg, data: null }
	const onResult = typeof options.onResult === 'function' ? options.onResult : null
	if (!onResult) return { code: 400, msg: '扫码会话缺少结果处理函数', data: null }
	const prepare = await ensureSharedCaptureReady()
	if (!prepare.ok) return { code: 500, msg: prepare.msg, data: null }
	const warningParts = [ready.warning, prepare.warning].map((item) => normalizeText(item)).filter(Boolean)
	const warningText = Array.from(new Set(warningParts)).join('；')
	runtimeState.session = {
		page: normalizeText(options.page),
		onResult,
		routeResolver: typeof options.routeResolver === 'function' ? options.routeResolver : null,
		activeTarget: normalizeBarcodeTargetMeta(options.activeTarget)
	}
	runtimeState.lastError = warningText
	runtimeState.lastDelivered = {
		target: '',
		rawText: '',
		at: 0
	}
	return {
		code: 0,
		msg: warningText ? `扫码会话已启动（${warningText}）` : '',
		data: {
			page: runtimeState.session.page,
			activeTarget: runtimeState.session.activeTarget
		}
	}
}

export async function setActiveBarcodeTarget(targetMeta = null) {
	if (!runtimeState.session) return { code: 409, msg: '当前页面未启用物理扫码会话', data: null }
	runtimeState.session.activeTarget = normalizeBarcodeTargetMeta(targetMeta)
	runtimeState.lastDelivered = {
		target: '',
		rawText: '',
		at: 0
	}
	return {
		code: 0,
		msg: '',
		data: {
			activeTarget: runtimeState.session.activeTarget
		}
	}
}

export async function leaveBarcodeSession(options = {}) {
	const page = normalizeText(options.page)
	const reason = normalizeText(options.reason)
	if (!runtimeState.session) return restoreScannerProfile({ reason, clearSession: true })
	if (page && runtimeState.session.page && page !== runtimeState.session.page) {
		return { code: 0, msg: '当前页无物理扫码会话', data: { restored: false } }
	}
	runtimeState.session = null
	await releaseHardwareIfIdle()
	return {
		code: 0,
		msg: reason ? `已退出扫码会话：${reason}` : '已退出扫码会话',
		data: {
			restored: true
		}
	}
}

export async function restoreScannerProfile(options = {}) {
	const reason = normalizeText(options.reason)
	if (options.clearSession !== false) runtimeState.session = null
	unregisterBroadcastReceiver()
	await releaseScanProfile()
	runtimeState.lastError = ''
	runtimeState.lastDelivered = {
		target: '',
		rawText: '',
		at: 0
	}
	return {
		code: 0,
		msg: reason ? `扫描头已恢复：${reason}` : '扫描头已恢复',
		data: {
			restored: true
		}
	}
}

export async function stopCapture() {
	return restoreScannerProfile({ reason: 'stop-capture' })
}

export async function scanCode() {
	return {
		code: 410,
		msg: 'V1 已移除按钮触发扫码，请先选择字段后按实体扫码键',
		data: null
	}
}

export async function scanOcr() {
	return {
		code: 410,
		msg: 'V1 已下线 OCR 功能，请改用实体扫码或秤网关取重',
		data: null
	}
}

export async function scanScaleWeightOcr() {
	return {
		code: 410,
		msg: 'V1 已下线重量 OCR，请手工输入总重或使用秤网关稳定值',
		data: null
	}
}

export function verifyBroadcastConfig() {
	return {
		ok: true,
		data: {
			action: runtimeState.broadcastAction,
			key: runtimeState.broadcastDataKey,
			registeredActions: runtimeState.registeredActions,
			receiverRegistered: runtimeState.receiverRegistered
		}
	}
}

export function getScannerState() {
	const mode = normalizeText(runtimeState.captureMode)
	const captureMode = mode === 'enhanced' || mode === 'failed' || mode === 'unsupported' ? mode : 'failed'
	return {
		supported: Boolean(runtimeState.supported),
		pluginReady: Boolean(runtimeState.pluginReady),
		pluginRequired: true,
		captureMode,
		androidBroadcastReady: Boolean(runtimeState.ready && runtimeState.mainActivity && runtimeState.receiver),
		ready: Boolean(runtimeState.ready),
		lastError: normalizeText(runtimeState.lastError),
		sessionPage: normalizeText(runtimeState.session?.page),
		activeTarget: runtimeState.session?.activeTarget || null,
		lastPayload: normalizeText(runtimeState.lastPayload),
		lastSymbology: normalizeText(runtimeState.lastSymbology),
		lastBroadcastAction: normalizeText(runtimeState.lastBroadcastAction),
		broadcastAction: normalizeText(runtimeState.broadcastAction),
		broadcastDataKey: normalizeText(runtimeState.broadcastDataKey),
		registeredActions: runtimeState.registeredActions.slice(),
		scannerProfile: {
			active: Boolean(runtimeState.scannerProfile.active),
			before: runtimeState.scannerProfile.before,
			applied: runtimeState.scannerProfile.applied,
			restored: runtimeState.scannerProfile.restored,
			lastError: normalizeText(runtimeState.scannerProfile.lastError),
			openedBySession: Boolean(runtimeState.scannerProfile.openedBySession),
			defaultedBroadcastProfile: Boolean(runtimeState.scannerProfile.defaultedBroadcastProfile)
		},
		captureDiagnostic: {
			...runtimeState.diagnostic
		}
	}
}

export async function teardownPdaCapture() {
	unregisterBroadcastReceiver()
	await releaseScanProfile()
	runtimeState.session = null
	runtimeState.receiver = null
	runtimeState.mainActivity = null
	runtimeState.supported = null
	runtimeState.pluginReady = false
	runtimeState.captureMode = 'unknown'
	runtimeState.ready = false
	runtimeState.lastError = ''
	runtimeState.lastPayload = ''
	runtimeState.lastSymbology = ''
	runtimeState.lastBroadcastAction = ''
	runtimeState.registeredActions = []
	runtimeState.scannerProfile = {
		active: false,
		before: null,
		applied: null,
		restored: null,
		lastError: '',
		openedBySession: false,
		defaultedBroadcastProfile: false
	}
	runtimeState.lastDelivered = {
		target: '',
		rawText: '',
		at: 0
	}
	runtimeState.diagnostic = {
		broadcastReceivedCount: 0,
		broadcastMatchedCount: 0,
		broadcastPayloadCount: 0,
		broadcastIgnoredCount: 0,
		broadcastDedupedCount: 0,
		lastExtraKeys: []
	}
}
