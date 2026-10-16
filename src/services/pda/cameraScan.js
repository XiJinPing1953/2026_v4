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

// Keep the decoded area identical to the complete, uncropped camera preview.
// The library default is an invisible central square downscaled to only 400px.
export function getCameraScanRegion(video) {
	const width = Math.max(1, Number(video.videoWidth) || 1)
	const height = Math.max(1, Number(video.videoHeight) || 1)
	const scale = Math.min(1, 1280 / Math.max(width, height))
	return { x: 0, y: 0, width, height, downScaledWidth: Math.max(1, Math.round(width * scale)), downScaledHeight: Math.max(1, Math.round(height * scale)) }
}

export function createCameraScannerLifecycle({ loadScanner, createSoftwareEngine, onResult, onError, onStatus = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
	let generation = 0
	let scanner = null
	let softwareEngine = null
	let hintTimer = null
	const release = () => {
		clearTimer(hintTimer)
		hintTimer = null
		softwareEngine?.terminate()
		softwareEngine = null
		scanner?.destroy()
		scanner = null
	}
	return {
		async open(video) {
			const activeGeneration = ++generation
			release()
			let instance = null
			let accepted = false
			let softwareBusy = false
			let lastSoftwareAttempt = now()
			onStatus('starting')
			try {
				const Scanner = await loadScanner()
				if (activeGeneration !== generation) return
				const isCurrent = () => activeGeneration === generation && !accepted
				const accept = (result) => {
					if (activeGeneration !== generation || accepted) return
					const rawText = String(result?.data ?? result ?? '').trim()
					if (!rawText) return
					accepted = true
					clearTimer(hintTimer)
					softwareEngine?.terminate()
					softwareEngine = null
					instance.stop()
					onResult(rawText)
				}
				// BarcodeDetector can return no result indefinitely without throwing the
				// errors that trigger qr-scanner's own fallback. Retry those frames with
				// the explicitly bundled worker through the public scanImage API.
				const isDecodeMiss = (error) => error === Scanner.NO_QR_CODE_FOUND || error === `Scanner error: ${Scanner.NO_QR_CODE_FOUND}`
				const decodeMiss = async (error) => {
					if (!isCurrent()) return
					if (!isDecodeMiss(error)) onStatus('decoder-error')
					if (!createSoftwareEngine || softwareBusy || now() - lastSoftwareAttempt < 1000) return
					lastSoftwareAttempt = now()
					softwareBusy = true
					try {
						if (!softwareEngine) softwareEngine = createSoftwareEngine()
						const result = await Scanner.scanImage(video, { qrEngine: softwareEngine, scanRegion: getCameraScanRegion(video), returnDetailedScanResult: true })
						accept(result)
					} catch (fallbackError) {
						if (isCurrent() && !isDecodeMiss(fallbackError)) onStatus('software-error')
					} finally {
						softwareBusy = false
					}
				}
				instance = new Scanner(video, accept, { preferredCamera: 'environment', returnDetailedScanResult: true, maxScansPerSecond: 8, calculateScanRegion: getCameraScanRegion, onDecodeError: decodeMiss })
				scanner = instance
				await instance.start()
				if (!isCurrent()) { instance.destroy(); return }
				onStatus('scanning')
				hintTimer = setTimer(() => { if (isCurrent()) onStatus('searching') }, 5000)
				hintTimer?.unref?.()
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
