import { computed, ref, watch } from 'vue'

// Display pagination never replaces the complete source used for business checks.
export function useStatementPage(rows, size = 10) {
	const page = ref(1)
	const total = computed(() => rows.value.length)
	const pages = computed(() => Math.max(1, Math.ceil(total.value / size)))
	const visible = computed(() => rows.value.slice((page.value - 1) * size, page.value * size))
	watch(pages, value => { page.value = Math.min(page.value, value) }, { flush: 'sync' })
	return { page, total, pages, visible, reset: () => { page.value = 1 } }
}

export function mergeVisibleSelection(selected, visibleKeys, checkedKeys) {
	const visible = new Set(visibleKeys)
	return [...new Set([...selected.filter(key => !visible.has(key)), ...checkedKeys.filter(key => visible.has(key))])]
}
