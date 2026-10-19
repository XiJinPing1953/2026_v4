import { computed, onBeforeUnmount, ref } from 'vue'
import { getUser } from '@/services/auth'
import { canPageAction } from '@/services/pageAcl'
import { previewReweighV1, createReweighV1, correctReweighV1, getReweighOperationV1, retryReweighOperationV1 } from '@/services/api/reweigh'
import { createPdaBleScaleSession, createEmptyPdaBleScaleSnapshot, ensurePdaBleRuntimePermission, getPdaBleScaleCapabilities, quantizeBleScaleWeightKg } from '@/services/pda/bleScale'
import { resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { enterBarcodeSession, leaveBarcodeSession } from '@/services/pda/capture'
import { normalizeBottleNo } from '@/services/pda/shared'
import { cloneReweigh, createReweighId, createReweighDraftStore, reweighReceipt } from '@/services/pda/reweighDraft'

export function usableReweighSample(snapshot, sessionId, now = Date.now()) {
	const sampledAt = Number(snapshot.sampled_at)
	return Boolean(sessionId && snapshot.session_id === sessionId && snapshot.is_connected && snapshot.is_online && snapshot.is_stable
		&& Number(snapshot.weight_kg) > 0 && Number(snapshot.stable_seq) > 0 && sampledAt > 0 && sampledAt <= now
		&& now - sampledAt <= 3000 && sampledAt >= Number(snapshot.measurement_started_at || 0))
}

const weightText = (value) => value == null ? '—' : `${Number(value).toFixed(1)} kg`
export function reweighChangeText(preview) {
	const old = preview.filling || {}
	const oldGross = old.reweigh?.gross_weight ?? old.gross_weight ?? old.weight_end
	const oldNet = old.reweigh?.net_weight ?? old.net_weight ?? old.label_net_weight
	const delta = (next, previous) => previous == null || next == null ? '—' : `${Number(next) - Number(previous) >= 0 ? '+' : ''}${(Number(next) - Number(previous)).toFixed(1)} kg`
	return `毛重：${weightText(oldGross)} → ${weightText(preview.gross_weight)}（${delta(preview.gross_weight, oldGross)}）\n标签净重：${weightText(oldNet)} → ${weightText(preview.net_weight)}（${delta(preview.net_weight, oldNet)}）\n本次灌装量：${weightText(old.fill_weight)} → ${weightText(preview.fill_weight)}（${delta(preview.fill_weight, old.fill_weight)}）`
}

function emptyDraft() {
	return { operationId: createReweighId(), bottleNo: '', date: '', preview: null, previousBasis: null, grossWeight: null, capture: null, frozen: null, receipt: null, reason: '现场复秤', remark: '' }
}

export function usePdaReweigh() {
	const ownerId = String(getUser()?._id || '')
	const ownerMatches = () => ownerId && String(getUser()?._id || '') === ownerId
	const capabilities = getPdaBleScaleCapabilities()
	const nativeSupported = capabilities.transport === 'native' && capabilities.supported
	const current = ref(emptyDraft())
	const history = ref([])
	const message = ref('请连接 NVK 吊秤，再按 PDA 扫码键选择钢瓶。')
	const error = ref('')
	const storageError = ref('')
	const busy = ref(false)
	const active = ref(false)
	const scannerReady = ref(false)
	const pendingSession = ref('')
	const snapshot = ref(createEmptyPdaBleScaleSnapshot())
	let epoch = 0
	let lifecycleVersion = 0
	let stopping = Promise.resolve()
	let unreadable = false
	let boundDevice = null
	try { boundDevice = uni.getStorageSync('pda_ble_scale_bound_device_v1') || null; if (typeof boundDevice === 'string') boundDevice = JSON.parse(boundDevice) } catch (_) {}
	const scale = createPdaBleScaleSession({ deviceId: boundDevice?.deviceId || '', deviceNamePrefix: 'NVK', divisionStepKg: 0.5, displayDecimals: 1 })
	// Explicit wrappers also work with uni-app's statically injected storage APIs.
	const store = createReweighDraftStore(ownerId, {
		getStorageSync: key => uni.getStorageSync(key),
		setStorageSync: (key, value) => uni.setStorageSync(key, value)
	}, () => String(getUser()?._id || ''))
	try {
		const saved = store.load()
		if (saved) { current.value = saved.current; history.value = saved.history; message.value = '已恢复本账号复秤草稿。已采集重量保留，未完成称重需重新连接吊秤。' }
	} catch (cause) { unreadable = true; storageError.value = cause.message }
	const locked = computed(() => unreadable || !ownerMatches() || Boolean(current.value.frozen))
	const canCreate = computed(() => canPageAction('/pages/pda/reweigh', 'create'))
	const canNext = computed(() => !busy.value && current.value.receipt?.saved === true)
	function fail(text) { error.value = text; return false }
	function persist() {
		if (unreadable) return false
		try { store.save(current.value, history.value); storageError.value = ''; return true }
		catch (cause) { storageError.value = cause.message; return false }
	}
	function editable() { return nativeSupported && active.value && canCreate.value && !locked.value && !busy.value }
	function sameWork(version) { return active.value && ownerMatches() && epoch === version }
	function confirm(title, content) {
		return new Promise(resolve => uni.showModal({ title, content, confirmText: '确认', cancelText: '取消', success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false) }))
	}
	function setText(key, value) {
		if (!editable() || !['remark', 'reason'].includes(key)) return
		current.value = { ...current.value, [key]: String(value || '') }; persist()
	}
	function previewArgs(grossWeight = current.value.grossWeight) {
		const draft = current.value
		return { bottle_no: draft.bottleNo, ...(draft.date ? { date: draft.date } : {}), ...(draft.preview?.filling?._id ? { filling_id: draft.preview.filling._id } : {}), ...(grossWeight != null ? { gross_weight: grossWeight } : {}) }
	}
	async function selectBottle(bottleNo, fillingId = '') {
		if (!editable()) return false
		const normalized = normalizeBottleNo(bottleNo)
		if (!normalized) return fail('请扫描或输入瓶号')
		if (current.value.bottleNo) return fail(current.value.bottleNo === normalized ? '本瓶已选定，重复扫码不会覆盖重量；需要时请点重新称重' : '请先保存或放弃当前瓶草稿，再选择下一瓶')
		if (!snapshot.value.is_connected) return fail('请先连接吊秤')
		busy.value = true; error.value = ''
		const version = ++epoch
		try {
			const result = await previewReweighV1({ bottle_no: normalized, ...(fillingId ? { filling_id: fillingId } : {}) })
			if (!sameWork(version)) return false
			if (result?.code !== 0) return fail(result?.msg || '无法核算此瓶，请核对回瓶记录')
			current.value = { ...current.value, bottleNo: result.data.bottle.bottle_no, date: result.data.date, preview: result.data }
			if (!persist()) return false
		} catch (cause) { if (sameWork(version)) fail(cause.message || '瓶档读取失败'); return false }
		finally { busy.value = false }
		return startMeasurement()
	}
	async function scan(payload = {}) {
		if (!editable()) return
		if (current.value.bottleNo) return fail('本瓶已选定，重复扫码不会覆盖；请完成本瓶或放弃草稿')
		if (!snapshot.value.is_connected) return fail('请先连接吊秤')
		busy.value = true
		const version = ++epoch
		let result
		try { result = await resolvePdaBottleByQrCode(payload.rawText) }
		catch (cause) { if (sameWork(version)) fail(cause.message || '扫码查瓶失败') }
		finally { busy.value = false }
		if (!sameWork(version)) return
		if (result?.code !== 0) return fail(result?.msg || '钢瓶二维码未匹配')
		return selectBottle(result.data.bottle_no)
	}
	async function startMeasurement() {
		if (!editable() || !current.value.bottleNo) return false
		if (!snapshot.value.is_connected) return fail('请先连接吊秤，再点击本瓶称重')
		const version = epoch
		if (current.value.capture && !await confirm('重新称重', '将清空本瓶尚未提交的重量，等待新的稳定秤值。')) return false
		if (!sameWork(version) || locked.value || busy.value) return false
		current.value = { ...current.value, grossWeight: null, capture: null, preview: { ...current.value.preview, gross_weight: null, net_weight: null, fill_weight: null, label: null } }
		if (!persist()) return false
		error.value = ''
		pendingSession.value = scale.beginMeasurement()
		message.value = '本瓶正在称重，请保持稳定。允许先挂瓶，再扫码选瓶。'
		return true
	}
	async function acceptSample(next) {
		if (!editable() || !usableReweighSample(next, pendingSession.value)) return
		const capture = { sampled_at: next.sampled_at, device_id: next.device_id, stable_seq: next.stable_seq, measurement_id: next.session_id, stable: true, raw: next.frame_raw || next.last_frame_raw || '' }
		pendingSession.value = ''
		current.value = { ...current.value, grossWeight: quantizeBleScaleWeightKg(next.weight_kg), capture }
		if (!persist()) return
		busy.value = true
		const version = ++epoch
		try {
			const result = await previewReweighV1(previewArgs())
			if (!sameWork(version)) return
			if (result?.code !== 0) return fail(result?.msg || '重量已采集，核算失败，请重新核算')
			const previousBasis = current.value.previousBasis || (result.data.context_hash !== current.value.preview?.context_hash ? current.value.preview : null)
			current.value = { ...current.value, preview: result.data, previousBasis }; persist()
			message.value = '稳定重量已采集，请核对标签净重与本次灌装量后保存。'
		} catch (cause) { if (sameWork(version)) fail(cause.message || '重量已采集，核算失败，保存时将重新核算') }
		finally { busy.value = false }
	}
	const unsubscribe = scale.onSnapshot(next => {
		snapshot.value = next
		if (pendingSession.value && (next.session_id !== pendingSession.value || !next.is_connected)) { pendingSession.value = ''; message.value = '称重会话已中断，请重新连接后点击本瓶称重。' }
		void acceptSample(next)
	})
	async function connect(forcePick = false) {
		if (!nativeSupported || !active.value || busy.value) return false
		pendingSession.value = ''; busy.value = true; error.value = ''
		const version = ++epoch
		try {
			const permission = await ensurePdaBleRuntimePermission()
			if (!sameWork(version)) return false
			if (permission?.code !== 0) return fail(permission?.msg || '请允许蓝牙权限')
			if (forcePick || !boundDevice?.deviceId) {
				const found = await scale.discoverDevices()
				if (!sameWork(version)) return false
				if (found?.code !== 0 || !found.data?.length) return fail(found?.msg || '未发现 NVK 吊秤')
				const index = await new Promise(resolve => uni.showActionSheet({ itemList: found.data.map(item => `${item.name || item.localName || 'NVK'} (${item.deviceId.slice(-6)})`), success: result => resolve(result.tapIndex), fail: () => resolve(-1) }))
				if (!sameWork(version) || index < 0) return false
				boundDevice = found.data[index]
				scale.updateProfile({ deviceId: boundDevice.deviceId })
			}
			const result = await scale.connect({ preferredDeviceId: boundDevice.deviceId })
			if (!sameWork(version)) { await scale.stop(); return false }
			if (result?.code !== 0) return fail(`${result?.msg || '连接失败'}；可点击更换吊秤重新选择`)
			try { uni.setStorageSync('pda_ble_scale_bound_device_v1', boundDevice) } catch (_) {}
			message.value = current.value.capture ? '吊秤已连接，本瓶已采集的重量保持不变。' : '吊秤已连接。扫码选瓶，或点击本瓶称重。'
			return true
		} catch (cause) { return fail(cause.message || '吊秤连接失败') }
		finally { busy.value = false }
	}
	async function disconnect() { pendingSession.value = ''; await scale.disconnect(); message.value = '吊秤已断开，已采集重量保留。' }
	function cancelMeasurement() { pendingSession.value = ''; message.value = '本瓶待称重已取消，点击本瓶称重可重新开始。' }
	function applyReceipt(response, operationId, target = current.value, directResponse = false) {
		const receipt = reweighReceipt(response, operationId, target?.receipt)
		// A direct pre-write rejection may omit its ID. Queries must explicitly identify the original operation.
		const matched = response?.data?.operation_id === operationId || (directResponse && !response?.data?.operation_id)
		if (response?.data?.rejected === true && matched && !receipt.saved) {
			receipt.rejected = true
			receipt.status = 'rejected'
			receipt.message = response.msg || response.data.last_error || '本次提交未保存，请重新核对后保存'
		}
		if (current.value.operationId === operationId && current.value.frozen?.payload.operation_id === operationId && receipt.rejected && !current.value.receipt?.saved) {
			current.value = { ...current.value, operationId: createReweighId(), frozen: null, receipt: null }
			fail(receipt.message)
		} else if (current.value.operationId === operationId) current.value = { ...current.value, receipt }
		else history.value = history.value.map(item => item.operationId === operationId ? { ...item, receipt } : item)
		persist()
		return receipt
	}
	async function sendFrozen() {
		const frozen = current.value.frozen
		if (!frozen || !ownerMatches() || !active.value || !canCreate.value) return false
		if (!persist()) return false
		try {
			const response = await (frozen.mode === 'correct' ? correctReweighV1 : createReweighV1)(cloneReweigh(frozen.payload))
			const receipt = applyReceipt(response, frozen.payload.operation_id, current.value, true)
			if (receipt.rejected) return false
			if (response?.code !== 0) fail(response.msg || '结果待确认，请查询原操作')
			return response?.code === 0
		} catch (cause) { applyReceipt({ msg: cause.message || '网络中断，保存结果待确认' }, frozen.payload.operation_id); return false }
	}
	async function submit() {
		if (!editable() || !current.value.capture) return fail('请先完成本瓶稳定称重')
		busy.value = true; error.value = ''
		const version = epoch
		try {
			const response = await previewReweighV1(previewArgs())
			if (!sameWork(version)) return false
			if (response?.code !== 0) return fail(response?.msg || '提交前核算失败')
			const preview = response.data
			const old = current.value.previousBasis || current.value.preview
			if (preview.context_hash !== old?.context_hash) {
				const text = `档案或回瓶依据已有变化，请核对后确认。\n皮重：${weightText(old?.bottle?.tare_weight)} → ${weightText(preview.bottle.tare_weight)}\n回瓶毛重：${weightText(old?.basis?.gross_weight)} → ${weightText(preview.basis.gross_weight)}\n标签净重：${weightText(old?.net_weight)} → ${weightText(preview.net_weight)}\n本次灌装量：${weightText(old?.fill_weight)} → ${weightText(preview.fill_weight)}`
				if (!await confirm('核算依据变化', text) || !sameWork(version)) return false
			}
			if (preview.mode === 'correct') {
				if (!String(current.value.reason || '').trim()) return fail('请填写更正原因')
				if (!await confirm('确认更正原灌装记录', `${reweighChangeText(preview)}\n原因：${current.value.reason}\n确认后更新原记录，不新增灌装。`) || !sameWork(version)) return false
			}
			const payload = { operation_id: current.value.operationId, bottle_no: current.value.bottleNo, date: preview.date, gross_weight: current.value.grossWeight, context_hash: preview.context_hash,
				capture_method: 'ble', capture: cloneReweigh(current.value.capture), remark: current.value.remark,
				...(preview.mode === 'correct' ? { filling_id: preview.filling._id, expected_source_version: preview.filling.source_version, reason: current.value.reason } : {}) }
			current.value = { ...current.value, preview, previousBasis: null, frozen: { mode: preview.mode, payload } }
			return await sendFrozen()
		} catch (cause) { return fail(cause.message || '提交前核算失败') }
		finally { busy.value = false }
	}
	async function query(operationId = current.value.operationId, retry = false) {
		if (busy.value || !nativeSupported || !active.value || !ownerMatches() || unreadable || !canCreate.value) return false
		const target = current.value.operationId === operationId ? current.value : history.value.find(item => item.operationId === operationId)
		if (!target?.frozen) return false
		busy.value = true; error.value = ''
		try {
			if (!persist()) return false
			const response = await getReweighOperationV1(operationId)
			const receipt = applyReceipt(response, operationId, target)
			if (receipt.rejected) return false
			if (retry && response?.code === 404 && current.value.operationId === operationId && !target.receipt?.saved) return await sendFrozen()
			if (retry && response?.code === 0 && response.data?.operation_id === operationId && !response.data?.complete && active.value && ownerMatches()) {
				const retried = await retryReweighOperationV1(operationId)
				const retryReceipt = applyReceipt(retried, operationId, current.value.operationId === operationId ? current.value : history.value.find(item => item.operationId === operationId))
				if (retryReceipt.rejected) return false
			}
			return response?.code === 0
		} catch (cause) { applyReceipt({ msg: cause.message || '查询失败，原操作已保留' }, operationId, target); return false }
		finally { busy.value = false }
	}
	async function nextBottle() {
		if (busy.value || unreadable || !ownerMatches() || !active.value) return false
		if (current.value.frozen && !current.value.receipt?.saved) return fail('保存结果尚未确认，必须先查询或重试原操作')
		const version = epoch
		if (!current.value.frozen && (current.value.bottleNo || current.value.capture) && !await confirm('放弃本瓶草稿', '当前瓶尚未提交，确认放弃已选瓶号和称重结果？')) return false
		if (!sameWork(version)) return false
		const old = current.value
		const previousHistory = history.value
		if (old.frozen) history.value = [...history.value.filter(item => item.operationId !== old.operationId), cloneReweigh(old)]
		// Never evict unfinished receipts. Retain the last ten completed bottles for field recovery.
		const complete = history.value.filter(item => item.receipt?.complete).slice(-10)
		history.value = history.value.filter(item => !item.receipt?.complete).concat(complete)
		current.value = emptyDraft()
		if (!persist()) { current.value = old; history.value = previousHistory; return false }
		epoch += 1; pendingSession.value = ''; error.value = ''; message.value = '请扫描下一瓶；同一瓶再次扫描时将核查是否允许更正。'
		return true
	}
	async function activate() {
		const version = ++lifecycleVersion
		await stopping
		if (version !== lifecycleVersion) return false
		active.value = true
		if (!nativeSupported) return fail('复秤仅支持原生 PDA，请使用安装了扫描头插件的 PDA 应用')
		try {
			const result = await enterBarcodeSession({ page: 'pda-reweigh', onResult: scan, activeTarget: { page: 'pda-reweigh', target: 'reweigh.bottleNo', label: '复秤瓶号', scope: 'reweigh', field: 'bottleNo' } })
			if (!active.value || version !== lifecycleVersion || !ownerMatches()) { await leaveBarcodeSession({ page: 'pda-reweigh' }); return false }
			scannerReady.value = result?.code === 0
			if (!scannerReady.value) fail(result?.msg || '扫描头初始化失败，可输入瓶号选择')
		} catch (cause) { fail(cause.message || '扫描头初始化失败') }
	}
	async function deactivate() {
		active.value = false; epoch += 1; lifecycleVersion += 1; pendingSession.value = ''; scannerReady.value = false
		persist()
		stopping = Promise.allSettled([stopping, scale.stop(), leaveBarcodeSession({ page: 'pda-reweigh', reason: 'page-hidden' })])
		await stopping
	}
	onBeforeUnmount(() => { unsubscribe(); void deactivate() })
	return { current, history, message, error, storageError, busy, active, scannerReady, pendingSession, snapshot, nativeSupported, locked, canCreate, canNext,
		selectBottle, startMeasurement, cancelMeasurement, connect, disconnect, submit, query, nextBottle, activate, deactivate, setText }
}
