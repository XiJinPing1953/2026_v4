import { ref } from 'vue'

export function useQuery(fetcher, options = {}) {
	const data = ref(options.initialData ?? null)
	const loading = ref(false)
	const error = ref('')
	const empty = ref(false)

	function resolveEmpty(value) {
		if (typeof options.isEmpty === 'function') {
			return options.isEmpty(value)
		}
		if (Array.isArray(value)) return value.length === 0
		if (value && typeof value === 'object') return Object.keys(value).length === 0
		return !value
	}

	async function run(...args) {
		loading.value = true
		error.value = ''
		try {
			const result = await fetcher(...args)
			const finalData = options.transform ? options.transform(result) : result
			data.value = finalData
			empty.value = resolveEmpty(finalData)
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
