import { onBeforeUnmount, ref } from 'vue'
import { enterBarcodeSession, leaveBarcodeSession } from '@/services/pda/capture'
import { resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { isPdaAppMode } from '@/services/pda/entry'

export function usePdaQueryScan({ onStart, onBottle }) {
	const scannerReady = ref(false)
	const page = 'pda-bottle-query'
	let active = false
	let version = 0
	let lifecycle = 0
	let stopping = Promise.resolve()
	async function scan(payload) {
		if (!active) return
		const current = ++version
		onStart()
		try {
			const result = await resolvePdaBottleByQrCode(payload.rawText)
			if (!active || current !== version) return
			if (result?.code !== 0 || !result.data?.bottle_no) throw new Error(result?.msg || '未找到钢瓶')
			onBottle(result.data.bottle_no, result.data._id)
		} catch (error) {
			if (active && current === version) uni.showToast({ title: error.message || '扫码查询失败', icon: 'none' })
		}
	}
	function invalidate() { version += 1 }
	function activate() {
		const current = ++lifecycle
		stopping = stopping.then(async () => {
			if (current !== lifecycle) return
			active = true
			if (!isPdaAppMode()) return
			try {
				const result = await enterBarcodeSession({ page, onResult: scan, activeTarget: { page, target: 'query.bottleNo', label: '钢瓶查询', scope: 'query', field: 'bottleNo' } })
				if (active && current === lifecycle) scannerReady.value = result?.code === 0
			} catch (error) {
				if (active && current === lifecycle) uni.showToast({ title: error.message || '扫描头初始化失败', icon: 'none' })
			}
		})
		return stopping
	}
	function deactivate() {
		active = false
		lifecycle += 1
		invalidate()
		scannerReady.value = false
		// 等待旧初始化完成后释放，再允许下一次初始化占用同一 page 会话。
		stopping = stopping.then(() => leaveBarcodeSession({ page, reason: 'page-hidden' })).catch(() => {})
		return stopping
	}

	onBeforeUnmount(deactivate)
	return { scannerReady, activate, deactivate, invalidate }
}
