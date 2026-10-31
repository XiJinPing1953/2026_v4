import { readPdaStorage } from '@/services/pda/asyncStorage'
import { createLocalFillingRoundsReader } from '@/services/pda/reweighHistory'
import { listReturnReweighRoundRecordsV1 } from '@/services/api/reweigh'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { getUser } from '@/services/auth'
import { canViewPage, canPageAction } from '@/services/pageAcl'
import { listReturnReweighRecordsV1, listFillingReweighRecordsV1, getReweighOperationV1, retryReweighOperationV1 } from '@/services/api/reweigh'
import { enterBarcodeSession, leaveBarcodeSession } from '@/services/pda/capture'
import { resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { normalizeBottleNo } from '@/services/pda/shared'
import { isPdaAppMode } from '@/services/pda/entry'

export function usePdaReweighRecords() {
	const types = ref([])
	const type = ref('return')
	const date = ref(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
	const bottleNo = ref('')
	// Read-only result snapshots are replaced as a whole, including local rounds.
	// Do not proxy every frozen print/capture field in the retained history.
	const rows = shallowRef([])
	const historyError = ref('')
	const summary = ref(null), rounds = shallowRef([]), roundId = ref(''), pageActive = ref(false)
	let localRounds = []
	const readLocalRounds = createLocalFillingRoundsReader()
	const localStorage = { getStorage: key => readPdaStorage({ getStorage: options => uni.getStorage(options), getStorageInfo: options => uni.getStorageInfo(options) }, key) }
	const loading = ref(false)
	const scannerReady = ref(false)
	const error = ref('')
	const hasMore = ref(false)
	const processingId = ref('')
	const canRetryProcessing = computed(() => canPageAction('/pages/pda/reweigh', 'create'))
	const typeLabel = computed(() => types.value.find(item => item.value === type.value)?.label || '复秤')
	const page = 'pda-reweigh-records'
	let active = false, lifecycle = 0, queryVersion = 0, scanVersion = 0, historyVersion = 0, processingVersion = 0, pendingSearch = null
	let owner = '', cursor = null, searched = null, stopping = Promise.resolve()
	const currentOwner = () => String(getUser()?._id || '')
	function invalidate() {
		queryVersion++; scanVersion++; historyVersion++; processingVersion++; processingId.value = ''; loading.value = false; error.value = ''
		rows.value = []; summary.value = null; hasMore.value = false; cursor = null; searched = null
	}
	function validOwner() {
		if (active && owner && owner === currentOwner()) return true
		invalidate()
		rounds.value = []; roundId.value = ''; localRounds = []
		if (active) error.value = '账号已变更，请返回首页后重新查询'
		return false
	}
	function setFilter(field, value) {
		invalidate()
		if (field !== 'round') { roundId.value = ''; rounds.value = [] }
		if (field === 'round') roundId.value = String(value || '')
		if (field === 'date') date.value = String(value || '')
		if (field === 'bottle') bottleNo.value = String(value || '')
		if (field === 'type' && types.value.some(item => item.value === value)) type.value = value
	}
	function search(append = false) {
		if (append) return runSearch(true)
		if (!validOwner()) return Promise.resolve()
		const key = JSON.stringify([owner, type.value, date.value, normalizeBottleNo(bottleNo.value), roundId.value])
		if (pendingSearch?.key === key && pendingSearch.version === queryVersion) return pendingSearch.promise
		const promise = runSearch(false)
		const pending = { key, version: queryVersion, promise: null }
		pending.promise = promise.finally(() => { if (pendingSearch === pending) pendingSearch = null })
		pendingSearch = pending
		return pending.promise
	}
	async function runSearch(append = false) {
		if (!validOwner()) return
		if (append && (loading.value || !hasMore.value || !searched)) return
		scanVersion++
		if (!append) {
			invalidate()
			if (!types.value.some(item => item.value === type.value)) { error.value = '无复秤记录查询权限'; return }
			searched = { type: type.value, date: date.value, bottle_no: normalizeBottleNo(bottleNo.value), round_id: roundId.value }
		}
		const version = ++queryVersion
		const snapshot = { ...searched }
		let localReady
		if (!append && searched.type === 'filling') {
			loading.value = true
			const readerOwner = owner, historyGeneration = historyVersion
			// Loading another cloud page does not invalidate the independent round picker.
			const isCurrent = () => active && readerOwner === currentOwner() && historyGeneration === historyVersion
			localReady = (async () => {
				try {
					const loaded = await readLocalRounds(readerOwner, localStorage, isCurrent)
					if (!isCurrent()) return false
					localRounds = loaded; rounds.value = loaded; historyError.value = ''
					return true
				} catch (cause) {
					if (isCurrent()) historyError.value = cause.message || '本机历史读取失败，请重新查询'
					return false
				}
			})()
		}
		if (!append && snapshot.type === 'filling' && snapshot.round_id) {
			const loaded = await localReady
			if (!validOwner() || version !== queryVersion) return
			loading.value = false
			if (!loaded) return
			const group = localRounds.find(item => item.id === snapshot.round_id)
			if (!group) { error.value = '本机未找到此轮次'; return }
			rows.value = group.rows.filter(item => !snapshot.bottle_no || item.bottle_no === snapshot.bottle_no)
			summary.value = { record_count: rows.value.length, bottle_count: new Set(rows.value.map(item => item.bottle_no)).size }
			return
		}
		// Date records are independent of the local archive; fetch them immediately.
		const requestCursor = append ? cursor : null
		loading.value = true; error.value = ''
		try {
			const request = snapshot.type === 'return' ? (snapshot.round_id ? listReturnReweighRoundRecordsV1 : listReturnReweighRecordsV1) : listFillingReweighRecordsV1
			const response = await request({ date: snapshot.date, round_id: snapshot.round_id || undefined, include_summary: !append, include_print: true, bottle_no: snapshot.bottle_no, cursor: requestCursor, page_size: 30 }, { shouldContinue: () => active && owner === currentOwner() && version === queryVersion })
			if (!validOwner() || version !== queryVersion) return
			if (response?.code !== 0) throw new Error(response?.msg || '复秤记录查询失败')
			if (!Array.isArray(response.data?.rows) || (response.data.has_more && !response.data.next_cursor)) throw new Error('复秤记录响应不完整，请重新查询')
			if (!append) {
				summary.value = response.data.summary || null
				if (!snapshot.round_id) rounds.value = snapshot.type === 'filling' ? localRounds : (response.data.summary?.rounds || [])
			}
			const incoming = response.data.rows
			rows.value = Array.from(new Map([...(append ? rows.value : []), ...incoming].map(item => [item.id, item])).values())
			cursor = response.data?.next_cursor || null
			hasMore.value = Boolean(response.data?.has_more && cursor)
		} catch (cause) {
			if (validOwner() && version === queryVersion) error.value = cause.message || '复秤记录查询失败'
		} finally {
			if (version === queryVersion) loading.value = false
		}
	}
	// Explicit per-record recovery belongs to queries. No entry-time sweep or polling.
	async function checkProcessing(id, retry = false) {
		if (!validOwner() || type.value !== 'filling' || processingId.value || (retry && !canRetryProcessing.value)) return false
		const row = rows.value.find(item => item.id === id)
		const operationId = row?.operation_id || row?.print_entry?.operationId
		if (!operationId) return false
		const version = queryVersion, requestOwner = owner, processingToken = ++processingVersion
		const isCurrent = () => active && requestOwner === currentOwner() && version === queryVersion && type.value === 'filling'
		processingId.value = id
		try {
			let response = await getReweighOperationV1(operationId)
			if (!isCurrent()) return false
			const matched = value => value?.code === 0 && value.data?.operation_id === operationId
			if (!matched(response)) throw new Error(response?.msg || '处理状态暂未确认，请重新查询')
			const conflict = response.data.source_records?.some(item => item.version_matches === false)
			if (retry && !response.data.complete && !conflict) {
				response = await retryReweighOperationV1(operationId)
				if (!isCurrent()) return false
				if (!matched(response)) throw new Error(response?.msg || '重试结果未确认，请重新查询状态')
			}
			const status = conflict ? 'conflict' : response.data.complete ? 'complete' : response.data.status === 'failed' ? 'failed' : 'pending'
			rows.value = rows.value.map(item => item.id === id ? { ...item, status, processing_checked: true,
				processing_message: conflict ? '原记录已变化，请核对该瓶；旧操作不会覆盖新记录。' : response.data.last_error || (status === 'complete' ? '后台处理已完成' : '记录已保存，后台处理中，可继续其他作业。') } : item)
			return true
		} catch (cause) {
			if (isCurrent()) rows.value = rows.value.map(item => item.id === id ? { ...item, processing_message: cause.message || '查询失败，请重试' } : item)
			return false
		} finally { if (processingToken === processingVersion) processingId.value = '' }
	}
	async function scan(payload) {
		if (!validOwner()) return
		invalidate()
		const version = scanVersion
		try {
			const result = await resolvePdaBottleByQrCode(payload.rawText)
			if (!validOwner() || version !== scanVersion) return
			if (result?.code !== 0 || !result.data?.bottle_no) throw new Error(result?.msg || '未找到钢瓶')
			bottleNo.value = result.data.bottle_no
			await search()
		} catch (cause) {
			if (validOwner() && version === scanVersion) error.value = cause.message || '扫码查询失败'
		}
	}
	function activate() {
		const generation = ++lifecycle
		active = true; pageActive.value = true; owner = currentOwner(); invalidate(); roundId.value = ''
		historyError.value = ''
		localRounds = []; rounds.value = []
		types.value = [
			{ value: 'return', label: '回瓶复秤', url: '/pages/pda/return-reweigh' },
			{ value: 'filling', label: '罐装复秤', url: '/pages/pda/reweigh' }
		].filter(item => canViewPage(item.url))
		if (!types.value.some(item => item.value === type.value)) type.value = types.value[0]?.value || ''
		void search()
		stopping = stopping.then(async () => {
			if (!active || generation !== lifecycle || !validOwner() || !isPdaAppMode() || !types.value.length) return
			try {
				const result = await enterBarcodeSession({ page, onResult: scan, activeTarget: { page, target: 'records.bottleNo', label: '复秤记录查询', scope: 'query', field: 'bottleNo' } })
				if (active && generation === lifecycle && validOwner()) scannerReady.value = result?.code === 0
			} catch (cause) {
				if (active && generation === lifecycle) scannerReady.value = false
			}
		})
		return stopping
	}
	function deactivate() {
		active = false; pageActive.value = false; lifecycle++; invalidate(); scannerReady.value = false
		stopping = stopping.then(() => leaveBarcodeSession({ page, reason: 'page-hidden' })).catch(() => {})
		return stopping
	}
	onBeforeUnmount(deactivate)
	return { processingId, canRetryProcessing, checkProcessing, historyError, summary, rounds, roundId, pageActive, types, type, typeLabel, date, bottleNo, rows, loading, scannerReady, error, hasMore, setFilter, search, loadMore: () => search(true), activate, deactivate }
}
