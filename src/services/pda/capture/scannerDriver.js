// The i6310 system exposes ScanManager, but lacks the StatusListener required by
// the newer PlatformSDK module constructor. Use the same scanner API directly;
// loading that module repeatedly fails before any of its methods can run.
export function createSystemScannerDriver(android) {
	const manager = android?.newObject('android.device.ScanManager')
	if (!manager) return null
	const invoke = (method, ...args) => android.invoke(manager, method, ...args)
	const mode = invoke('getOutputMode')
	if (mode !== 0 && mode !== 1) return null
	const read = method => () => {
		const value = invoke(method)
		if (value == null) throw new Error(`无法读取扫描头配置：${method}`)
		return value
	}
	const write = method => (...args) => {
		const value = invoke(method, ...args)
		// Native.js returns undefined for an unavailable method; never treat it
		// as a successful hardware mutation.
		if (value !== true) throw new Error(`扫描头配置未生效：${method}`)
		return true
	}
	const getParameterString = keys => keys.map(key => {
		const value = invoke('getPropertyString', key)
		if (typeof value !== 'string') throw new Error('无法读取扫描头广播配置')
		return value
	})
	return {
		driver: 'system-scan-manager',
		getOutputMode: read('getOutputMode'),
		getScannerState: read('getScannerState'),
		getTriggerLockState: read('getTriggerLockState'),
		openScanner: write('openScanner'),
		closeScanner: write('closeScanner'),
		switchOutputMode: write('switchOutputMode'),
		getScanParameterString: getParameterString,
		getParameterString,
		setScanParameterString(keys, values) {
			keys.forEach((key, index) => write('setPropertyString')(key, values[index]))
			return true
		}
	}
}
