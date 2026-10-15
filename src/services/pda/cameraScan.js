// Keep camera decoding and asynchronous entity lookup bound to one explicit target.
export function createCameraScanSession() {
	let version = 0
	let current = null
	return {
		begin(target) {
			current = { ...target, version: ++version, accepted: false }
			return { ...current }
		},
		accept(token) {
			if (!current || token?.version !== current.version || current.accepted) return false
			current.accepted = true
			return true
		},
		isCurrent(token) {
			return Boolean(current && token?.version === current.version)
		},
		invalidate() {
			version += 1
			current = null
		}
	}
}

export function getMobileCaptureCapabilities(environment = globalThis) {
	const secure = environment.isSecureContext === true
	return {
		secure,
		camera: secure && typeof environment.navigator?.mediaDevices?.getUserMedia === 'function',
		bluetooth: secure && typeof environment.navigator?.bluetooth?.requestDevice === 'function'
	}
}

export function findScanTargetIndex(rows, target) {
	if (!target?.rowId) return -1
	return (rows || []).findIndex((row) => row.rowId === target.rowId)
}

export function createCameraScannerLifecycle({ loadScanner, onResult, onError }) {
	let generation = 0
	let scanner = null
	const release = () => {
		if (!scanner) return
		scanner.destroy()
		scanner = null
	}
	return {
		async open(video) {
			const activeGeneration = ++generation
			release()
			let instance = null
			let accepted = false
			try {
				const Scanner = await loadScanner()
				if (activeGeneration !== generation) return
				instance = new Scanner(video, (result) => {
					if (activeGeneration !== generation || accepted) return
					const rawText = String(result?.data ?? result ?? '').trim()
					if (!rawText) return
					accepted = true
					instance.stop()
					onResult(rawText)
				}, { preferredCamera: 'environment', returnDetailedScanResult: true, maxScansPerSecond: 8 })
				scanner = instance
				await instance.start()
				if (activeGeneration !== generation) instance.destroy()
			} catch (error) {
				if (activeGeneration !== generation) return
				release()
				onError(error)
			}
		},
		close() {
			generation += 1
			release()
		}
	}
}
