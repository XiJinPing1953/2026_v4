import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { getTruckQuantityClosureV1 } from '@/services/gasClosure'
import { businessToday } from '@/composables/gas/useGasClosure'

export function validateTruckQuantityFilters(filters) {
	const isDay = value => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
		const date = new Date(`${value}T00:00:00Z`)
		return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
	}
	if ((filters.dateStart && !isDay(filters.dateStart)) || !isDay(filters.dateEnd) || !isDay(filters.cutoffDay)) return '请选择有效日期'
	if (filters.dateStart && filters.dateStart > filters.dateEnd) return '进液开始日不能晚于结束日'
	if (filters.cutoffDay < filters.dateEnd) return '观察截止日不能早于进液结束日'
	return ''
}

// Quantity attribution and all weight totals come from the complete server read.
// Local pagination below the panel is presentation only.
export function useTruckQuantityClosure(options = {}) {
	const fetchClosure = options.fetchClosure || getTruckQuantityClosureV1
	const today = businessToday()
	const filters = reactive({ dateStart: '', dateEnd: today, cutoffDay: today })
	const appliedFilters = ref(null)
	const result = ref(null)
	const loading = ref(false)
	const stale = ref(false)
	const error = ref('')
	const formError = ref('')
	const receivedAt = ref(null)
	const expandedBatch = ref('')
	const batches = computed(() => result.value?.batches || [])
	const unassignedFillings = computed(() => result.value?.unassigned_fillings || [])
	const sharedCycles = computed(() => result.value?.shared_cycles || [])
	let activeQuery = { ...filters }
	let revision = 0
	let timer = null
	let visible = false
	let disposed = false
	async function refresh({ background = false } = {}) {
		if (!visible || disposed || (background && loading.value) || (options.canRead && !options.canRead())) return
		const requestRevision = ++revision
		const query = { ...activeQuery }
		loading.value = true
		error.value = ''
		try {
			const response = await fetchClosure(query)
			if (requestRevision !== revision || !visible || disposed) return
			const data = response?.data
			if (response?.code !== 0 || !data || !Array.isArray(data.batches) || !Array.isArray(data.unassigned_fillings) || !Array.isArray(data.shared_cycles) || data.scope?.read_complete !== true) throw new Error(response?.msg || '逐车数量读取未完成')
			result.value = data
			appliedFilters.value = { ...query, dateStart: data.scope.date_start || query.dateStart }
			receivedAt.value = Date.now()
			stale.value = false
			if (!data.batches.some(row => row.id === expandedBatch.value)) expandedBatch.value = ''
		} catch (err) {
			if (requestRevision !== revision || !visible || disposed) return
			error.value = err?.message || '读取失败，请重试'
			stale.value = Boolean(result.value)
		} finally {
			if (requestRevision === revision) loading.value = false
		}
	}
	function search() {
		formError.value = validateTruckQuantityFilters(filters)
		if (formError.value) return
		activeQuery = { ...filters }
		return refresh()
	}
	function setVisible(value) {
		const next = Boolean(value)
		if (disposed || next === visible) return
		visible = next
		if (timer) clearInterval(timer)
		timer = null
		if (!visible) {
			revision += 1
			loading.value = false
			stale.value = Boolean(result.value)
			return
		}
		refresh()
		timer = setInterval(() => refresh({ background: true }), 60000)
	}
	function dispose() {
		setVisible(false)
		disposed = true
	}
	onBeforeUnmount(dispose)
	return { filters, appliedFilters, result, batches, unassignedFillings, sharedCycles, loading, stale, error, formError, receivedAt, expandedBatch, refresh, search, setVisible, dispose }
}
