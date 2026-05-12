import { onBeforeUnmount, ref } from 'vue'
import { normalizeText } from '@/services/pda/shared'

export function usePdaSuggestions(options = {}) {
	const minLength = Math.max(Number(options.minLength || 1), 0)
	const debounceMs = Math.max(Number(options.debounceMs || 200), 0)
	const hideDelayMs = Math.max(Number(options.hideDelayMs || 150), 0)
	const fetcher = typeof options.fetcher === 'function' ? options.fetcher : async () => []
	const mapItem = typeof options.mapItem === 'function' ? options.mapItem : (item) => item

	const items = ref([])
	const loading = ref(false)
	const visible = ref(false)

	let debounceTimer = null
	let blurTimer = null
	let requestId = 0

	function clearDebounceTimer() {
		if (!debounceTimer) return
		clearTimeout(debounceTimer)
		debounceTimer = null
	}

	function clearBlurTimer() {
		if (!blurTimer) return
		clearTimeout(blurTimer)
		blurTimer = null
	}

	function resetState() {
		items.value = []
		loading.value = false
		visible.value = false
	}

	function normalizeKeyword(keyword) {
		return normalizeText(keyword)
	}

	function meetsThreshold(keyword) {
		return normalizeKeyword(keyword).length >= minLength
	}

	async function fetchItems(keyword) {
		const text = normalizeKeyword(keyword)
		if (!meetsThreshold(text)) {
			requestId += 1
			resetState()
			return []
		}
		const currentRequestId = ++requestId
		loading.value = true
		try {
			const rawItems = await fetcher(text)
			if (currentRequestId !== requestId) return items.value
			const nextItems = (Array.isArray(rawItems) ? rawItems : []).map(mapItem).filter(Boolean)
			items.value = nextItems
			visible.value = true
			return nextItems
		} catch (error) {
			if (currentRequestId === requestId) {
				items.value = []
				visible.value = false
			}
			return []
		} finally {
			if (currentRequestId === requestId) loading.value = false
		}
	}

	function schedule(keyword) {
		clearDebounceTimer()
		clearBlurTimer()
		if (!meetsThreshold(keyword)) {
			requestId += 1
			resetState()
			return
		}
		debounceTimer = setTimeout(() => {
			fetchItems(keyword)
		}, debounceMs)
	}

	function handleInput(keyword) {
		schedule(keyword)
	}

	function handleFocus(keyword) {
		clearBlurTimer()
		if (!meetsThreshold(keyword)) {
			if (!normalizeKeyword(keyword)) resetState()
			return
		}
		fetchItems(keyword)
	}

	function handleBlur() {
		clearBlurTimer()
		blurTimer = setTimeout(() => {
			visible.value = false
		}, hideDelayMs)
	}

	function handleSelect(item) {
		clearDebounceTimer()
		clearBlurTimer()
		visible.value = false
		return item
	}

	function clear() {
		requestId += 1
		clearDebounceTimer()
		clearBlurTimer()
		resetState()
	}

	onBeforeUnmount(() => {
		clear()
	})

	return {
		items,
		loading,
		visible,
		handleInput,
		handleFocus,
		handleBlur,
		handleSelect,
		fetchItems,
		clear
	}
}
