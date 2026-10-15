import { createBleScaleCoreSession } from './bleScaleCore'
import { createWebBleScaleSession, getWebBleScaleCapabilities } from './webBleScale'
import { normalizeText } from './shared'

export {
	PDA_BLE_SCALE_BAUD_RATE, PDA_BLE_SCALE_DATA_BITS, PDA_BLE_SCALE_STOP_BITS,
	PDA_BLE_SCALE_PARITY, PDA_BLE_SCALE_FRAME_MODE, PDA_BLE_SCALE_DIVISION_STEP_KG,
	PDA_BLE_SCALE_DISPLAY_DECIMALS, quantizeBleScaleWeightKg,
	parsePdaBleScaleLine, createEmptyPdaBleScaleSnapshot
} from './bleScaleCore'
export { createWebBleScaleSession }

function isNativeRuntime() {
	// #ifdef APP-PLUS
	if (typeof plus !== 'undefined') return true
	// #endif
	return typeof window === 'undefined' && typeof uni !== 'undefined'
}

export function getPdaBleScaleCapabilities() {
	if (isNativeRuntime()) {
		const supported = typeof uni !== 'undefined' && typeof uni.createBLEConnection === 'function'
		return { transport: 'native', supported, reason: supported ? '' : '当前环境不支持蓝牙连接' }
	}
	return { transport: 'web', ...getWebBleScaleCapabilities() }
}

export function createPdaBleScaleSession(profile = {}) {
	return isNativeRuntime() ? createBleScaleCoreSession(profile, uni) : createWebBleScaleSession(profile)
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
