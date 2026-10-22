import { issueFillingLabel } from '@/services/pda/fillingLabel'
import { ref, onBeforeUnmount } from 'vue'
import { getFillingV1 } from '@/services/filling'
import { getUser } from '@/services/auth'
import { ensurePdaBleRuntimePermission } from '@/services/pda/bleScale'
import { createLabelPrinterSession, getPairedPrinters } from '@/services/pda/labelPrinter'
import { createFillingPrintController, savedLabel, isSuperseded, verifyCurrentLabel } from '@/services/pda/fillingPrint'
export function usePdaFillingPrinter({ enabled, active, entries }) {
	const ownerId = String(getUser()?._id || ''), currentOwner = () => String(getUser()?._id || '')
	const valid = () => enabled && active() && currentOwner() === ownerId
	const status = ref('打印机未连接'), connected = ref(false), connecting = ref(false), messages = ref({}), busy = ref(false)
	let session = null, generation = 0, ownerTimer = null
	const storage = { getStorageSync: key => uni.getStorageSync(key), setStorageSync: (key, value) => uni.setStorageSync(key, value) }
	const control = createFillingPrintController({ ownerId, currentOwner, storage, valid, entries, printer: () => session,
		verify: async entry => {
   const ticket = generation, options = { shouldContinue: () => valid() && ticket === generation }
   verifyCurrentLabel(entry, await getFillingV1({ _id: entry.receipt.fillingId }, options))
   if (!options.shouldContinue()) throw new Error('打印已取消')
   const result = await issueFillingLabel({ filling_id:entry.receipt.fillingId, operation_id:entry.operationId }, options)
   if (result?.code !== 0 || !result.data?.qr_url) throw new Error(result?.msg || '标签网址暂不可用，请稍后补打')
   return result.data
  },
		report: (id, text) => { messages.value = { ...messages.value, [id]: text } } })
	async function connect() {
		if (!valid() || connecting.value || session?.busy) return
		clearInterval(ownerTimer); ownerTimer = null; session?.close(); session = null; connected.value = false
		const version = ++generation
		connecting.value = true; status.value = '正在连接打印机'
		try {
			const result = await ensurePdaBleRuntimePermission()
			if (version !== generation || !valid()) return
			if (result.code !== 0) throw new Error(result.msg || '请允许蓝牙权限')
			const devices = getPairedPrinters(plus.android)
			const bound = uni.getStorageSync('pda_label_printer_bound_v1')
			const device = devices.find(row => row.address === bound?.address) || (devices.length === 1 ? devices[0] : null)
			if (!device) throw new Error('请先在系统蓝牙中配对 HL30-AA21')
			session = createLabelPrinterSession(uni.requireNativePlugin('TH-PlatformBLE'), state => {
				if (version !== generation) return
				if (!valid()) { close(); return }
				connected.value = state.connected; connecting.value = Boolean(state.connecting); status.value = state.message
				if (state.connected) { try { uni.setStorageSync('pda_label_printer_bound_v1', device) } catch (_) {} }
			})
			ownerTimer = setInterval(() => { if (!valid()) close() }, 1000)
			session.connect(device.address)
		} catch (error) { if (version === generation) { clearInterval(ownerTimer); ownerTimer = null; session?.close(); session = null; status.value = error.message || '连接失败，请重连' } }
		finally { if (version === generation && !session) connecting.value = false }
	}
	function close() { clearInterval(ownerTimer); ownerTimer = null; generation++; control.close(); session?.close(); session = null; connected.value = false; connecting.value = false; busy.value = false; status.value = '打印机未连接' }
	function reason(entry) {
		try { if (isSuperseded(entry, entries())) return '这笔已更正，请补打更正后的记录'; savedLabel(entry); return '' }
		catch (error) { return error.message }
	}
	async function reprint(entry) {
		if (!valid() || busy.value || control.busy) return
		busy.value = true
		try { return await control.reprint(entry) } finally { busy.value = false }
	}
	onBeforeUnmount(close)
	return { status, connected, connecting, messages, busy, connect, close, reason, reprint,
		arm: entry => control.arm(entry), confirmed: (entry, matched) => control.confirmed(entry, matched) }
}
