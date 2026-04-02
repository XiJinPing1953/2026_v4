import { ref } from 'vue'

const queryCache = new Map()

function getCache(key, ttl) {
	if (!key) return null
	const item = queryCache.get(key)
	if (!item) return null
	if (ttl == null) return item.value
	if (Date.now() - item.ts > ttl) {
		queryCache.delete(key)
		return null
	}
	return item.value
}

function setCache(key, value) {
	if (!key) return
	queryCache.set(key, { value, ts: Date.now() })
}

export function useQuery(fetcher, options = {}) {
	const data = ref(options.initialData ?? null)
	const loading = ref(false)
	const error = ref('')
	const empty = ref(false)
	const lastRunAt = ref(0)

	function resolveEmpty(value) {
		if (typeof options.isEmpty === 'function') {
			return options.isEmpty(value)
		}
		if (Array.isArray(value)) return value.length === 0
		if (value && typeof value === 'object') return Object.keys(value).length === 0
		return !value
	}

	async function run(...args) {
		const force = args.some((arg) => arg && typeof arg === 'object' && arg.force === true)
		const cacheKey = typeof options.cacheKey === 'function' ? options.cacheKey(...args) : options.cacheKey
		const cacheTTL = options.cacheTTL
		const throttleMs = Number(options.throttleMs || 0)
		const now = Date.now()
		if (!force && throttleMs > 0 && now - lastRunAt.value < throttleMs) return data.value
		lastRunAt.value = now

		const cached = force ? null : getCache(cacheKey, cacheTTL)
		if (cached != null) {
			data.value = cached
			empty.value = resolveEmpty(cached)
			return cached
		}

		loading.value = true
		error.value = ''
		try {
			const result = await fetcher(...args)
			const finalData = options.transform ? options.transform(result) : result
			data.value = finalData
			empty.value = resolveEmpty(finalData)
			setCache(cacheKey, finalData)
			options.onSuccess?.(finalData, result)
			return finalData
		} catch (err) {
			error.value = err?.message || '请求失败'
			options.onError?.(err)
			return null
		} finally {
			loading.value = false
		}
	}

	function reset() {
		data.value = options.initialData ?? null
		error.value = ''
		empty.value = false
	}

	const immediate = options.immediate !== false
	if (immediate) {
		const args = Array.isArray(options.immediateArgs) ? options.immediateArgs : []
		run(...args)
	}

	return {
		data,
		loading,
		error,
		empty,
		run,
		refresh: run,
		reset
	}
}
