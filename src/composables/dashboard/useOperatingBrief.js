import { computed, onBeforeUnmount, ref } from 'vue'
import { getOperatingBriefV1, getOperatingCurrentV1, getOperatingTankLossV1, getDashboardDailyReportV1 } from '@/services/api/dashboard'
import { mapOperatingBrief, mapOperatingCurrent, mapOperatingTankLoss, mapDashboardDailyReport } from '@/services/mappers/operatingBrief'
import { listSalesV2 } from '@/services/sale'

export function operatingBriefDateRange(preset, now = Date.now()) {
	const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10)
	const day = new Date(`${today}T00:00:00Z`)
	const shift = offset => new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10)
	if (preset === 'today') return { start: today, end: today }
	if (preset === 'yesterday') return { start: shift(-1), end: shift(-1) }
	if (preset === 'last3') return { start: shift(-2), end: today }
	if (preset === 'last5') return { start: shift(-4), end: today }
	if (preset === 'lastMonth') {
		const last = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
		last.setUTCDate(0)
		const end = last.toISOString().slice(0, 10)
		return { start: `${end.slice(0, 7)}-01`, end }
	}
	return { start: `${today.slice(0, 7)}-01`, end: today }
}

// The request owns its period/range. Hidden-page, old-period and unmounted
// responses cannot replace the latest displayed evidence or trigger a download.
export function useOperatingBrief(options = {}) {
	const fetchBrief = options.fetchBrief || getOperatingBriefV1
	const fetchReport = options.fetchReport || getDashboardDailyReportV1
	const fetchCurrent = options.fetchCurrent || getOperatingCurrentV1
	const fetchTankLoss = options.fetchTankLoss || getOperatingTankLossV1
	const canReadCurrent = options.canReadCurrent || (() => true)
	const fetchSales = options.fetchSales || listSalesV2
	const period = ref('yesterday')
	const result = ref(null)
	const loading = ref(false)
	const error = ref('')
	const stale = ref(false)
	const current = ref(null)
	const currentLoading = ref(false)
	const currentError = ref('')
	const currentStale = ref(false)
	const tankLoss = ref(null)
	const tankLossLoading = ref(false)
	const tankLossError = ref('')
	const tankLossStale = ref(false)
	const reportOpen = ref(false)
	const reportPreset = ref('last5')
	const reportRange = ref(operatingBriefDateRange('last5'))
	const report = ref(null)
	const reportLoading = ref(false)
	const reportError = ref('')
	const reportStale = ref(false)
	const exporting = ref(false)
	const exportError = ref('')
	let visible = false
	let disposed = false
	let timer = null
	let revision = 0
	let currentRevision = 0
	let tankLossRevision = 0
	let reportRevision = 0
	let exportRevision = 0

	const reportCanExport = computed(() => Boolean(report.value?.complete && !reportLoading.value && !reportError.value && !reportStale.value && !exporting.value))
	function clearTimer() {
		if (timer != null) clearInterval(timer)
		timer = null
	}
	async function refresh({ background = false } = {}) {
		if (!visible || disposed || (background && loading.value)) return
		const current = ++revision
		const selected = period.value
		loading.value = true
		error.value = ''
		try {
			const response = await fetchBrief(selected)
			if (current !== revision || !visible || disposed) return
			if (response?.code !== 0) throw new Error(response?.msg || '经营简报读取失败')
			result.value = mapOperatingBrief(response.data, selected)
			stale.value = false
		} catch (err) {
			if (current !== revision || !visible || disposed) return
			error.value = err?.message || '经营简报读取失败'
			stale.value = Boolean(result.value)
		} finally {
			if (current === revision) loading.value = false
		}
	}
	function selectPeriod(value) {
		if (!['yesterday', 'today', 'month'].includes(value) || value === period.value) return
		period.value = value
		result.value = null
		error.value = ''
		stale.value = false
		tankLoss.value = null
		tankLossError.value = ''
		tankLossStale.value = false
		refreshTankLoss()
		return refresh()
	}
	async function refreshTankLoss({ background = false } = {}) {
		if (!visible || disposed || (background && tankLossLoading.value)) return
		const request = ++tankLossRevision
		const selected = period.value
		tankLossLoading.value = true
		tankLossError.value = ''
		try {
			const response = await fetchTankLoss(selected)
			if (request !== tankLossRevision || !visible || disposed) return
			if (response?.code !== 0) throw new Error(response?.msg || '估算损耗读取失败')
			tankLoss.value = mapOperatingTankLoss(response.data, selected)
			tankLossStale.value = false
		} catch (err) {
			if (request !== tankLossRevision || !visible || disposed) return
			tankLossError.value = err?.message || '估算损耗读取失败'
			tankLossStale.value = Boolean(tankLoss.value)
		} finally {
			if (request === tankLossRevision) tankLossLoading.value = false
		}
	}
	async function refreshCurrent() {
		if (!visible || disposed || currentLoading.value || !canReadCurrent()) return
		const request = ++currentRevision
		currentLoading.value = true
		currentError.value = ''
		try {
			const response = await fetchCurrent()
			if (request !== currentRevision || !visible || disposed || !canReadCurrent()) return
			if (response?.code !== 0) throw new Error(response?.msg || '客户资金读取失败')
			current.value = mapOperatingCurrent(response.data)
			currentStale.value = false
		} catch (err) {
			if (request !== currentRevision || !visible || disposed || !canReadCurrent()) return
			currentError.value = err?.message || '客户资金读取失败'
			currentStale.value = Boolean(current.value)
		} finally {
			if (request === currentRevision) currentLoading.value = false
		}
	}
	function refreshAll() {
		refresh()
		refreshTankLoss()
		refreshCurrent()
		if (reportOpen.value) refreshReport()
	}
	async function refreshReport() {
		if (!visible || disposed || !reportOpen.value) return
		const range = operatingBriefDateRange(reportPreset.value)
		if (range.start !== reportRange.value.start || range.end !== reportRange.value.end) report.value = null
		reportRange.value = range
		const current = ++reportRevision
		reportLoading.value = true
		reportError.value = ''
		try {
			const response = await fetchReport({ ...range })
			if (current !== reportRevision || !visible || disposed) return
			if (response?.code !== 0) throw new Error(response?.msg || '日报读取失败')
			report.value = mapDashboardDailyReport(response.data, range)
			reportStale.value = false
		} catch (err) {
			if (current !== reportRevision || !visible || disposed) return
			reportError.value = err?.message || '日报读取失败'
			reportStale.value = Boolean(report.value)
		} finally {
			if (current === reportRevision) reportLoading.value = false
		}
	}
	function toggleReport() {
		reportOpen.value = !reportOpen.value
		if (reportOpen.value) return refreshReport()
	}
	function selectReportPreset(value) {
		if (!['today', 'yesterday', 'last3', 'last5', 'lastMonth', 'month'].includes(value) || value === reportPreset.value) return
		reportPreset.value = value
		report.value = null
		reportError.value = ''
		exportError.value = ''
		reportStale.value = false
		exportRevision += 1
		exporting.value = false
		return refreshReport()
	}
	async function prepareExport() {
		if (!visible || disposed || !reportCanExport.value) return null
		const current = ++exportRevision
		const range = { ...reportRange.value }
		const isCurrent = () => current === exportRevision && visible && !disposed
		exporting.value = true
		exportError.value = ''
		try {
			// Re-read the exact range: cached previews never certify an export.
			const response = await fetchReport(range)
			if (!isCurrent()) return null
			if (response?.code !== 0) throw new Error(response?.msg || '日报导出读取失败')
			const completeReport = mapDashboardDailyReport(response.data, range)
			const salesRows = []
			const ids = new Set()
			let expectedTotal = null
			let page = 1
			while (true) {
				if (page > 500) throw new Error('导出数据过多，请缩小日期范围')
				const sales = await fetchSales({ dateStart: range.start, dateEnd: range.end, page, pageSize: 50, include_summary: false })
				if (!isCurrent()) return null
				if (sales?.code !== 0) throw new Error(sales?.msg || '销售明细读取失败')
				const paging = sales.paging
				if (!Array.isArray(sales.data) || !paging || typeof paging.hasMore !== 'boolean' || !Number.isInteger(paging.total) || paging.total < 0 || paging.page !== page) throw new Error('销售明细完整性无法确认，请刷新后重试')
				if (expectedTotal != null && expectedTotal !== paging.total) throw new Error('销售记录已变化，请重新导出')
				expectedTotal = paging.total
				for (const row of sales.data) {
					const id = row?._id || row?.id
					if (!id || ids.has(id)) throw new Error('销售明细分页不完整，请重新导出')
					const date = row?.date
					if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < range.start || date > range.end) throw new Error('销售明细超出日期范围，请重新导出')
					if (row.accounting?.status === 'unresolved' || row.accounting?.complete === false) throw new Error('销售明细含待核账务，核实后才能导出')
					ids.add(id)
					salesRows.push(row)
				}
				if (!paging.hasMore) break
				if (!sales.data.length) throw new Error('销售明细分页未完成，请重新导出')
				page += 1
			}
			if (salesRows.length !== expectedTotal) throw new Error('销售明细读取未完成，请重新导出')
			return { summaryRows: completeReport.rows, salesRows, range, isCurrent }
		} catch (err) {
			if (isCurrent()) exportError.value = err?.message || '导出失败'
			return null
		} finally {
			if (current === exportRevision) exporting.value = false
		}
	}
	function setVisible(value) {
		const next = Boolean(value) && !disposed
		if (next === visible) return
		visible = next
		clearTimer()
		if (!visible) {
			revision += 1
			currentRevision += 1
			tankLossRevision += 1
			reportRevision += 1
			exportRevision += 1
			loading.value = false
			currentLoading.value = false
			tankLossLoading.value = false
			reportLoading.value = false
			exporting.value = false
			stale.value = Boolean(result.value)
			tankLossStale.value = Boolean(tankLoss.value)
			reportStale.value = Boolean(report.value)
			return
		}
		refresh()
		refreshTankLoss()
		if (!current.value) refreshCurrent()
		if (reportOpen.value) refreshReport()
		timer = setInterval(() => {
			refresh({ background: true })
			refreshTankLoss({ background: true })
		}, 60000)
	}
	function dispose() {
		disposed = true
		setVisible(false)
	}
	onBeforeUnmount(dispose)
	return {
		period, result, loading, error, stale, refresh, selectPeriod, setVisible, dispose,
		current, currentLoading, currentError, currentStale, refreshCurrent, refreshAll,
		tankLoss, tankLossLoading, tankLossError, tankLossStale, refreshTankLoss,
		reportOpen, reportPreset, reportRange, report, reportLoading, reportError, reportStale,
		reportCanExport, exporting, exportError, toggleReport, selectReportPreset, refreshReport, prepareExport
	}
}
