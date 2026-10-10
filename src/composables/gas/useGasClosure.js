import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { getFillingClosureV1, getTankBeforeFillingV1 } from '@/services/gasClosure'

export function businessToday(now = Date.now()) {
	return new Date(now + 8 * 3600000).toISOString().slice(0, 10)
}

export function validateClosureFilters(filters) {
	const isDay = value => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
		const date = new Date(`${value}T00:00:00Z`)
		return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
	}
	if (![filters.dateStart, filters.dateEnd, filters.cutoffDay].every(isDay)) return '请选择有效日期'
	if (filters.dateStart > filters.dateEnd) return '首次灌装开始日期不能晚于结束日期'
	if (filters.cutoffDay < filters.dateEnd) return '观察截止日不能早于首次灌装结束日期'
	return ''
}

// Only the server aggregates cycles. Requests retain their own query snapshot so a
// delayed response cannot replace a newer query or data fetched after returning.
export function useGasClosure(options = {}) {
	const fetchClosure = options.fetchClosure || getFillingClosureV1
	const fetchTank = options.fetchTank || getTankBeforeFillingV1
	const today = businessToday()
	const filters = reactive({ dateStart: today, dateEnd: today, cutoffDay: today, bottle_no: '', status: '' })
	const appliedFilters = ref(null)
	const result = ref(null)
	const loading = ref(false)
	const error = ref('')
	const formError = ref('')
	const stale = ref(false)
	const page = ref(1)
	const pageSize = 20
	const expandedCycle = ref('')
	const expandedDay = ref('')
	const tankResults = reactive({})
	const receivedAt = ref(null)
	let revision = 0
	let timer = null
	let visible = false
	let disposed = false
	let activeQuery = { ...filters }
	const cycles = computed(() => result.value?.cycles || [])
	const summary = computed(() => result.value?.summary || {})
	const days = computed(() => result.value?.days || [])
	const total = computed(() => result.value?.total ?? 0)
	const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

	function invalidateTank() {
		for (const day of Object.keys(tankResults)) delete tankResults[day]
	}
	async function refresh({ background = false } = {}) {
		if (disposed || !visible || (background && loading.value)) return
		if (options.canRead && !options.canRead()) return
		const requestRevision = ++revision
		const query = { ...activeQuery, page: page.value, pageSize }
		loading.value = true
		error.value = ''
		invalidateTank()
		try {
			const response = await fetchClosure(query)
			if (requestRevision !== revision || !visible || disposed) return
			if (response?.code !== 0 || !response.data || !Array.isArray(response.data.cycles) || response.data.scope?.read_complete === false) throw new Error(response?.msg || '闭环数据读取未完成')
			result.value = response.data
			appliedFilters.value = query
			page.value = response.data.page || query.page
			receivedAt.value = Date.now()
			stale.value = false
			if (!cycles.value.some(row => row.id === expandedCycle.value)) expandedCycle.value = ''
			// A day is fetched only after the user has explicitly opened it.
			if (expandedDay.value && days.value.some(row => row.day === expandedDay.value)) loadTank(expandedDay.value)
		} catch (err) {
			if (requestRevision !== revision || !visible || disposed) return
			error.value = err?.message || '读取失败，请重试'
			stale.value = Boolean(result.value)
		} finally {
			if (requestRevision === revision) loading.value = false
		}
	}
	function search() {
		formError.value = validateClosureFilters(filters)
		if (formError.value) return
		activeQuery = { ...filters, bottle_no: filters.bottle_no.trim() }
		page.value = 1
		expandedCycle.value = ''
		expandedDay.value = ''
		return refresh()
	}
	function setStatus(status) {
		filters.status = status
		return search()
	}
	function changePage(nextPage) {
		if (nextPage < 1 || nextPage > totalPages.value || loading.value) return
		page.value = nextPage
		expandedCycle.value = ''
		return refresh()
	}
	async function loadTank(day) {
		if (!visible || disposed || tankResults[day]?.loading) return
		const requestRevision = revision
		const entry = reactive({ loading: true, data: null, error: '' })
		tankResults[day] = entry
		try {
			const response = await fetchTank(day)
			if (requestRevision !== revision || !visible || disposed || tankResults[day] !== entry) return
			if (response?.code !== 0 || !response.data) throw new Error(response?.msg || '灌装前余量读取未完成')
			entry.data = response.data
		} catch (err) {
			if (requestRevision === revision && visible && !disposed && tankResults[day] === entry) entry.error = err?.message || '读取失败，请重试'
		} finally {
			if (requestRevision === revision && tankResults[day] === entry) entry.loading = false
		}
	}
	function toggleDay(day) {
		expandedDay.value = expandedDay.value === day ? '' : day
		if (expandedDay.value && !tankResults[day]) return loadTank(day)
	}
	function setVisible(value) {
		visible = Boolean(value)
		if (timer) clearInterval(timer)
		timer = null
		if (!visible) {
			revision += 1
			loading.value = false
			return
		}
		refresh()
		timer = setInterval(() => refresh({ background: true }), 60000)
	}
	function dispose() {
		disposed = true
		setVisible(false)
	}
	onBeforeUnmount(dispose)
	return {
		filters, appliedFilters, result, loading, error, formError, stale, receivedAt,
		page, total, totalPages, cycles, summary, days, expandedCycle, expandedDay, tankResults,
		refresh, search, setStatus, changePage, loadTank, toggleDay, setVisible, dispose
	}
}
