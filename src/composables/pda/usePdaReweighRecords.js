import { computed, onBeforeUnmount, ref } from 'vue'
import { getUser } from '@/services/auth'
import { canViewPage } from '@/services/pageAcl'
import { listReturnReweighRecordsV1, listFillingReweighRecordsV1 } from '@/services/api/reweigh'
import { enterBarcodeSession, leaveBarcodeSession } from '@/services/pda/capture'
import { resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { normalizeBottleNo } from '@/services/pda/shared'
import { isPdaAppMode } from '@/services/pda/entry'

export function usePdaReweighRecords() {
	const types = ref([])
	const type = ref('return')
	const date = ref(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
	const bottleNo = ref('')
	const rows = ref([])
	const loading = ref(false)
	const scannerReady = ref(false)
	const error = ref('')
	const hasMore = ref(false)
	const typeLabel = computed(() => types.value.find(item => item.value === type.value)?.label || '复秤')
	const page = 'pda-reweigh-records'
	let active = false, lifecycle = 0, queryVersion = 0, scanVersion = 0
	let owner = '', cursor = null, searched = null, stopping = Promise.resolve()
	const currentOwner = () => String(getUser()?._id || '')
	function invalidate() {
		queryVersion++; scanVersion++; loading.value = false; error.value = ''
		rows.value = []; hasMore.value = false; cursor = null; searched = null
	}
	function validOwner() {
		if (active && owner && owner === currentOwner()) return true
		invalidate()
		if (active) error.value = '账号已变更，请返回首页后重新查询'
		return false
	}
	function setFilter(field, value) {
		invalidate()
		if (field === 'date') date.value = String(value || '')
		if (field === 'bottle') bottleNo.value = String(value || '')
		if (field === 'type' && types.value.some(item => item.value === value)) type.value = value
	}
	async function search(append = false) {
		if (!validOwner()) return
		if (append && (loading.value || !hasMore.value || !searched)) return
		scanVersion++
		if (!append) {
			invalidate()
			if (!types.value.some(item => item.value === type.value)) { error.value = '无复秤记录查询权限'; return }
			searched = { type: type.value, date: date.value, bottle_no: normalizeBottleNo(bottleNo.value) }
		}
		const version = ++queryVersion
		const snapshot = { ...searched }
		const requestCursor = append ? cursor : null
		loading.value = true; error.value = ''
		try {
			const request = snapshot.type === 'return' ? listReturnReweighRecordsV1 : listFillingReweighRecordsV1
			const response = await request({ date: snapshot.date, bottle_no: snapshot.bottle_no, cursor: requestCursor, page_size: 30 }, { shouldContinue: () => active && owner === currentOwner() && version === queryVersion })
			if (!validOwner() || version !== queryVersion) return
			if (response?.code !== 0) throw new Error(response?.msg || '复秤记录查询失败')
			if (!Array.isArray(response.data?.rows) || (response.data.has_more && !response.data.next_cursor)) throw new Error('复秤记录响应不完整，请重新查询')
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
		active = true; owner = currentOwner(); invalidate()
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
		active = false; lifecycle++; invalidate(); scannerReady.value = false
		stopping = stopping.then(() => leaveBarcodeSession({ page, reason: 'page-hidden' })).catch(() => {})
		return stopping
	}
	onBeforeUnmount(deactivate)
	return { types, type, typeLabel, date, bottleNo, rows, loading, scannerReady, error, hasMore, setFilter, search, loadMore: () => search(true), activate, deactivate }
}
