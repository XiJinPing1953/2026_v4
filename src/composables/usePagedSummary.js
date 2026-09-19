import { ref } from 'vue'
import { getToken } from '@/services/auth'
import { getQueryEpoch } from '@/services/api/callCloud'

// A displayed summary belongs to a filter, account and write generation, not a page.
export function usePagedSummary(fetcher, applySummary) {
	const pending = ref(false)
	const error = ref('')
	let currentKey = ''
	let generation = 0
	let loaded = false
	function invalidate() { currentKey = ''; loaded = false; generation += 1 }
	async function read(params, { force = false } = {}) {
		const { page, pageSize, ...filters } = params
		const key = JSON.stringify([getToken(), getQueryEpoch(), filters])
		if (force || key !== currentKey || (!loaded && !pending.value)) {
			currentKey = key
			const seq = ++generation
			pending.value = true; error.value = ''; loaded = false
			Promise.resolve(fetcher({ ...params, page: 1, includeSummary: true, summaryOnly: true })).then(result => {
				if (seq !== generation) return
				if (result?.code !== 0 || !result.summary) throw new Error(result?.msg || '统计读取未完成')
				applySummary(result.summary)
				loaded = true
			}).catch(err => {
				if (seq === generation) error.value = err?.message || '统计加载失败，请刷新重试'
			}).finally(() => { if (seq === generation) pending.value = false })
		}
		return fetcher({ ...params, includeSummary: false, summaryOnly: false })
	}
	return { read, pending, error, invalidate }
}
