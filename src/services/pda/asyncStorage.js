// A failed native read is not an empty draft. Confirm absence before returning null.
export function readPdaStorage(runtime, key) {
	return new Promise((resolve, reject) => {
		let settled = false
		const timer = setTimeout(() => finish(new Error('本机记录读取超时，请重新进入')), 10000)
		function finish(error, data) {
			if (settled) return
			settled = true; clearTimeout(timer)
			if (error) reject(error); else resolve(data)
		}
		try {
			runtime.getStorage({
				key,
				success: result => finish(null, result.data),
				fail: cause => {
					if (settled) return
					try { runtime.getStorageInfo({
						success: info => {
							if (Array.isArray(info.keys) && !info.keys.includes(key)) finish(null, null)
							else finish(new Error(cause?.errMsg || '本机记录读取失败，请重新进入'))
						},
						fail: () => finish(new Error('无法核对本机记录，请重新进入'))
					}) } catch (error) { finish(error) }
				}
			})
		} catch (error) { finish(error) }
	})
}
