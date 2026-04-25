import { computed, onBeforeUnmount, ref } from 'vue'
import { getPdaScaleLatestV1, PDA_SCALE_DEFAULT_CODE } from '@/services/pda/scale'
import { formatDateTime, normalizeText } from '@/services/pda/shared'

const DEFAULT_POLL_MS = 1000
const DEFAULT_STALE_AFTER_MS = 5000

export function usePdaScale(options = {}) {
	const scaleCode = normalizeText(options.scaleCode || options.scale_code) || PDA_SCALE_DEFAULT_CODE
	const pollMs = Math.max(Number(options.pollMs || options.poll_ms) || DEFAULT_POLL_MS, 500)
	const staleAfterMs = Math.max(Number(options.staleAfterMs || options.stale_after_ms) || DEFAULT_STALE_AFTER_MS, pollMs * 2)

	const snapshot = ref(null)
	const loading = ref(false)
	const requestError = ref('')
	const active = ref(false)
	const clock = ref(Date.now())
	let timer = null

	function clearTimer() {
		if (!timer) return
		clearInterval(timer)
		timer = null
	}

	function touchClock() {
		clock.value = Date.now()
	}

	async function refresh(options = {}) {
		const silent = options.silent === true
		touchClock()
		if (!silent) loading.value = true
		try {
			const res = await getPdaScaleLatestV1({ scale_code: scaleCode, timeout: options.timeout })
			if (res?.code === 0) {
				snapshot.value = res.data
				requestError.value = ''
			} else {
				requestError.value = res?.msg || '秤状态读取失败'
			}
			return res
		} catch (error) {
			requestError.value = normalizeText(error?.message) || '秤状态读取失败'
			return {
				code: 500,
				msg: requestError.value,
				data: snapshot.value
			}
		} finally {
			touchClock()
			if (!silent) loading.value = false
		}
	}

	function startPollingTimer() {
		clearTimer()
		if (!active.value) return
		timer = setInterval(() => {
			touchClock()
			refresh({ silent: true })
		}, pollMs)
	}

	async function resumePolling() {
		active.value = true
		const res = await refresh({ silent: false })
		startPollingTimer()
		return res
	}

	function pausePolling() {
		active.value = false
		clearTimer()
	}

	const resolvedSnapshot = computed(() => {
		const base = snapshot.value || {
			hasData: false,
			scaleCode,
			weightKg: null,
			isStable: false,
			isOnline: false,
			sampledAt: null,
			gatewayAt: null,
			errorCode: 'not_reported',
			errorMessage: 'C606+称重网关尚未上报'
		}
		const lastSeenAt = Number(base.gatewayAt || base.sampledAt || 0)
		const isFresh = Boolean(lastSeenAt) && clock.value - lastSeenAt <= staleAfterMs
		const effectiveOnline = Boolean(base.isOnline) && isFresh
		const timeoutError = base.hasData && !isFresh ? 'C606+称重网关心跳超时' : ''
		return {
			...base,
			lastSeenAt: lastSeenAt || null,
			isFresh,
			isOnline: effectiveOnline,
			errorMessage: effectiveOnline ? base.errorMessage : timeoutError || base.errorMessage || '秤离线'
		}
	})

	const weightText = computed(() => {
		const weight = resolvedSnapshot.value.weightKg
		if (!(weight > 0)) return '--'
		return `${Number(weight).toFixed(3)} kg`
	})

	const statusText = computed(() => {
		if (!resolvedSnapshot.value.hasData) return 'C606+称重网关未上报'
		if (!resolvedSnapshot.value.isOnline) return resolvedSnapshot.value.errorMessage || '秤离线'
		return resolvedSnapshot.value.isStable ? '稳定' : '动态中'
	})

	const statusKind = computed(() => {
		if (!resolvedSnapshot.value.hasData || !resolvedSnapshot.value.isOnline) return 'offline'
		return resolvedSnapshot.value.isStable ? 'stable' : 'moving'
	})

	const lastUpdatedText = computed(() => {
		if (!resolvedSnapshot.value.lastSeenAt) return '-'
		return formatDateTime(resolvedSnapshot.value.lastSeenAt)
	})

	const usableStableSnapshot = computed(() => {
		if (!resolvedSnapshot.value.isOnline || !resolvedSnapshot.value.isStable) return null
		if (!(resolvedSnapshot.value.weightKg > 0)) return null
		return resolvedSnapshot.value
	})

	onBeforeUnmount(() => {
		pausePolling()
	})

	return {
		scaleCode,
		snapshot: resolvedSnapshot,
		loading,
		requestError,
		active,
		weightText,
		statusText,
		statusKind,
		lastUpdatedText,
		usableStableSnapshot,
		refresh,
		resumePolling,
		pausePolling
	}
}
