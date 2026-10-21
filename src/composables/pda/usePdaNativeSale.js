import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { usePdaSaleForm } from '@/composables/pda/usePdaSaleForm'
import { getUser } from '@/services/auth'
import { canPageAction } from '@/services/pageAcl'
import { findPdaBottleByNo, resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { resolvePdaCustomerByQrCode, resolvePdaCustomerPricing } from '@/services/pda/customer'
import { createAutoReweighWeight } from '@/services/pda/autoReturnWeight'
import { createPdaBleScaleSession, createEmptyPdaBleScaleSnapshot, ensurePdaBleRuntimePermission } from '@/services/pda/bleScale'
import { enterBarcodeSession, leaveBarcodeSession } from '@/services/pda/capture'
import { getPdaBottleScanLocation } from '@/services/pda/location'
import { validatePdaBottleSaleForm } from '@/services/pda/sale'
import { normalizeBottleNo } from '@/services/pda/shared'

export function isNativeSaleRowWeighed(row, type) {
	return Boolean(row?.bottleId && row?.bottleNo && row?.weightSource && Number(row.gross) > 0
		&& row.tare !== '' && row.tare != null && Number(row.tare) >= 0
		&& row.net !== '' && row.net != null && Number.isFinite(Number(row.net))
		&& (type === 'back' || Number(row.net) > 0)
		&& Math.abs(Number(row.gross) - Number(row.tare) - Number(row.net)) < 0.001)
}

export function usePdaNativeSale() {
	const sale = usePdaSaleForm()
	const { form, selectedCustomer, submissionLocked } = sale
	const ownerId = String(getUser()?._id || getUser()?.id || '')
	const ownerMatches = () => ownerId && String(getUser()?._id || getUser()?.id || '') === ownerId
	const canCreate = computed(() => canPageAction('/pages/pda/sale-create', 'create'))
	const active = ref(false)
	const busy = ref(false)
	const error = ref('')
	const message = ref('请先选择客户')
	const currentId = ref('')
	const changes = ref([])
	const snapshot = ref(createEmptyPdaBleScaleSnapshot())
	const step = computed(() => sale.pdaStep.value || (sale.draftStep.value === 3 ? 4 : sale.draftStep.value))
	const direction = computed(() => step.value === 3 ? 'back' : 'out')
	const rowsFor = type => type === 'back' ? form.value.backItems : form.value.outItems
	const populated = type => rowsFor(type).filter(row => normalizeBottleNo(row.bottleNo))
	const outRows = computed(() => populated('out'))
	const backRows = computed(() => populated('back'))
	const rows = computed(() => populated(direction.value))
	const current = computed(() => rows.value.find(row => row.rowId === currentId.value) || null)
	const weighed = row => isNativeSaleRowWeighed(row, direction.value)
	const locked = computed(() => submissionLocked.value || !ownerMatches() || !canCreate.value)
	let epoch = 0
	let lifecycle = 0
	let stopping = Promise.resolve()
	let measurement = null
	let boundDevice = null
	const autoWeight = createAutoReweighWeight()
	try {
		boundDevice = uni.getStorageSync('pda_ble_scale_bound_device_v1') || null
		if (typeof boundDevice === 'string') boundDevice = JSON.parse(boundDevice)
	} catch (_) {}
	const scale = createPdaBleScaleSession({ deviceId: boundDevice?.deviceId || '', deviceNamePrefix: 'NVK', divisionStepKg: 0.5, displayDecimals: 1, onWeightFrame: acceptFrame })
	const editable = () => active.value && !locked.value && !busy.value
	const fail = text => { error.value = text; return false }
	const context = () => ({ epoch, customerId: form.value.customerId, step: step.value })
	const same = ticket => active.value && ownerMatches() && ticket.epoch === epoch && ticket.customerId === form.value.customerId && ticket.step === step.value
	const confirm = (title, content) => new Promise(resolve => uni.showModal({ title, content, success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false) }))
	function freeze() { measurement = null; autoWeight.reset() }
	function invalidate() { epoch++; freeze(); sale.invalidateAsyncWork() }
	function selectStep(next) {
		invalidate()
		sale.pdaStep.value = next
		sale.draftStep.value = next === 4 ? 3 : next === 1 ? 1 : 2
		currentId.value = populated(next === 3 ? 'back' : 'out').find(row => !isNativeSaleRowWeighed(row, next === 3 ? 'back' : 'out'))?.rowId || ''
		error.value = ''
		message.value = next === 2 ? '扫描出瓶，称好后再扫下一瓶' : next === 3 ? '扫描回瓶，称好后再扫下一瓶' : ''
	}
	function beginRow(row) {
		freeze()
		currentId.value = row.rowId
		const sessionId = scale.beginMeasurement()
		measurement = { ...context(), rowId: row.rowId, bottleNo: row.bottleNo, type: direction.value, sessionId, startedAt: Date.now(), sequence: 0 }
		message.value = `${row.bottleNo} 号瓶：等待称重`
	}
	function acceptFrame(frame) {
		const target = measurement
		if (!target || !same(target) || locked.value || busy.value || frame.session_id !== target.sessionId
			|| frame.sampled_at < target.startedAt || !snapshot.value.is_connected) return
		const index = rowsFor(target.type).findIndex(row => row.rowId === target.rowId && row.bottleNo === target.bottleNo)
		if (index < 0 || currentId.value !== target.rowId) return freeze()
		const weight = autoWeight.feed(frame, rowsFor(target.type)[index].tare)
		if (weight === null) return
		const result = sale.applyScaleWeightToRow(target.type, index, {
			...snapshot.value, session_id: target.sessionId, weight_kg: weight, sampled_at: frame.sampled_at,
			is_online: true, is_stable: true, stable_seq: ++target.sequence, measurement_started_at: target.startedAt
		}, { sessionId: target.sessionId, force: true })
		if (result.code !== 0) return fail(result.msg)
		error.value = ''
		message.value = `${target.bottleNo} 号瓶：这瓶称好了，可以扫下一瓶`
	}
	const unsubscribe = scale.onSnapshot(next => {
		snapshot.value = next
		if (measurement && (!next.is_connected || next.session_id !== measurement.sessionId)) {
			freeze()
			message.value = '称重连接已中断，已称重量保留；未称好请连接后重新称重'
		}
	})
	watch(() => form.value.customerId, () => { invalidate(); currentId.value = '' }, { flush: 'sync' })
	watch(submissionLocked, value => { if (value) freeze() }, { flush: 'sync' })

	async function chooseBottle(value, scanned = false) {
		if (!editable() || ![2, 3].includes(step.value)) return false
		const unfinished = rows.value.find(row => !weighed(row))
		if (unfinished) { currentId.value = unfinished.rowId; return fail(`请先称好 ${unfinished.bottleNo} 号瓶；不需要这瓶时可删除`) }
		if (!snapshot.value.is_connected) return fail('请先连接吊秤')
		autoWeight.interrupt()
		const ticket = context()
		busy.value = true; error.value = ''
		try {
			const result = await (scanned ? resolvePdaBottleByQrCode(value) : findPdaBottleByNo(value))
			if (!same(ticket)) return false
			if (result?.code !== 0 || !result.data) return fail(result?.msg || '没有找到这个瓶号')
			const bottle = result.data
			if (bottle.is_active === false) return fail('这只瓶已停用，请核查瓶号')
			if (bottle.tare_weight == null || !Number.isFinite(Number(bottle.tare_weight)) || Number(bottle.tare_weight) < 0) return fail('这只瓶没有有效皮重，请先维护钢瓶档案')
			const existing = rows.value.find(row => normalizeBottleNo(row.bottleNo) === normalizeBottleNo(bottle.bottle_no))
			if (existing) {
				if (existing.rowId !== currentId.value) freeze()
				currentId.value = existing.rowId
				message.value = `${existing.bottleNo} 号：这瓶已称过，需要修改请点重新称重`
				return true
			}
			freeze()
			const type = direction.value
			let index = rowsFor(type).findIndex(row => !row.bottleNo)
			if (index < 0) { type === 'back' ? sale.addBackItem() : sale.addOutItem(); index = rowsFor(type).length - 1 }
			const row = sale.applyBottleSelection(type, index, bottle)
			if (!row) return false
			if (!snapshot.value.is_connected) { currentId.value = row.rowId; return fail('吊秤已断开，请连接后重新称重') }
			beginRow(row)
			if (scanned) void recordLocation(ticket, type, row.rowId, row.bottleNo)
			return true
		} catch (cause) { if (same(ticket)) fail(cause.message || '查瓶失败，请重试'); return false }
		finally { busy.value = false }
	}
	async function recordLocation(ticket, type, rowId, bottleNo) {
		try {
			const location = await getPdaBottleScanLocation()
			if (!same(ticket) || locked.value) return
			const index = rowsFor(type).findIndex(row => row.rowId === rowId && row.bottleNo === bottleNo)
			if (index >= 0) sale.attachBottleScanLocation(type, index, location)
		} catch (_) {}
	}
	function selectCustomer(customer) {
		if (!editable() || step.value !== 1) return false
		if (!customer || customer.is_active === false) return fail('客户已停用或不可用')
		sale.applySelectedCustomer(customer)
		error.value = ''; message.value = `已选择 ${customer.name}`
		return true
	}
	async function scan(payload) {
		if (!editable()) return
		if ([2, 3].includes(step.value)) return chooseBottle(payload.rawText, true)
		if (step.value !== 1) return
		const ticket = context()
		busy.value = true; error.value = ''
		try {
			const result = await resolvePdaCustomerByQrCode(payload.rawText)
			if (!same(ticket)) return
			if (result?.code !== 0 || !result.data || result.data.is_active === false) return fail(result?.msg || '没有找到客户，请输入名称搜索')
			sale.applySelectedCustomer(result.data)
			message.value = `已选择 ${result.data.name}`
		} catch (cause) { if (same(ticket)) fail(cause.message || '扫码查客户失败') }
		finally { busy.value = false }
	}
	async function reweigh(row) {
		if (!editable() || !rows.value.some(item => item.rowId === row.rowId)) return false
		const unfinished = measurement && rows.value.find(item => item.rowId === measurement.rowId && !weighed(item) && item.rowId !== row.rowId)
		if (unfinished) return fail(`请先称好 ${unfinished.bottleNo} 号瓶`)
		if (!snapshot.value.is_connected) return fail('请先连接吊秤')
		const index = rowsFor(direction.value).findIndex(item => item.rowId === row.rowId)
		if (sale.clearScaleWeightFromRow(direction.value, index).code !== 0) return false
		error.value = ''; beginRow(rowsFor(direction.value)[index])
		return true
	}
	async function remove(row) {
		if (!editable()) return false
		const ticket = context()
		busy.value = true
		try {
			if (!await confirm('删除这只瓶？', `删除 ${row.bottleNo} 号瓶的本单记录，其他瓶保留。`) || !same(ticket) || locked.value) return false
			const index = rowsFor(direction.value).findIndex(item => item.rowId === row.rowId)
			if (index < 0) return false
			if (currentId.value === row.rowId) { freeze(); currentId.value = '' }
			direction.value === 'back' ? sale.removeBackItem(index) : sale.removeOutItem(index)
			error.value = ''; message.value = '已删除，可继续扫码'
			return true
		} finally { busy.value = false }
	}
	async function go(next) {
		if (!editable() || next < 1 || next > 4) return false
		if (next < step.value) { selectStep(next); return true }
		if (next !== step.value + 1) return false
		if (step.value === 1) {
			if (!form.value.customerId) return fail('请先选择客户')
			const pricing = resolvePdaCustomerPricing(selectedCustomer.value)
			if (!pricing.ok) return fail(pricing.msg)
		} else {
			const unfinished = rows.value.find(row => !weighed(row))
			if (unfinished) { currentId.value = unfinished.rowId; return fail(`${unfinished.bottleNo} 号瓶还没称好，请称好或删除这瓶`) }
		}
		if (next === 4) {
			const validation = validatePdaBottleSaleForm(form.value, selectedCustomer.value)
			if (!validation.ok) return fail(validation.msg)
			freeze()
			const ticket = context()
			busy.value = true
			try {
				const result = await sale.refreshDepositRows()
				if (!same(ticket)) return false
				if (result?.code !== 0) return fail(result?.msg || '存瓶核对失败，请重试')
			} catch (cause) { if (same(ticket)) fail(cause.message || '存瓶核对失败'); return false }
			finally { busy.value = false }
		}
		selectStep(next)
		return true
	}
	async function connect(forcePick = false) {
		if (!editable()) return false
		freeze(); busy.value = true; error.value = ''
		const ticket = context()
		try {
			await stopping
			if (!same(ticket)) return false
			const permission = await ensurePdaBleRuntimePermission()
			if (!same(ticket)) return false
			if (permission?.code !== 0) return fail(permission?.msg || '请允许蓝牙权限')
			if (forcePick || !boundDevice?.deviceId) {
				const found = await scale.discoverDevices()
				if (!same(ticket)) return false
				if (found?.code !== 0 || !found.data?.length) return fail(found?.msg || '没有找到吊秤，请检查电源')
				const index = await new Promise(resolve => uni.showActionSheet({ itemList: found.data.map(item => item.name || item.localName || 'NVK 吊秤'), success: result => resolve(result.tapIndex), fail: () => resolve(-1) }))
				if (!same(ticket) || index < 0) return false
				boundDevice = found.data[index]; scale.updateProfile({ deviceId: boundDevice.deviceId })
			}
			const result = await scale.connect({ preferredDeviceId: boundDevice.deviceId })
			if (!same(ticket)) { await scale.stop(); return false }
			if (result?.code !== 0) return fail(`${result?.msg || '连接失败'}；可点更换吊秤重新选择`)
			try { uni.setStorageSync('pda_ble_scale_bound_device_v1', boundDevice) } catch (_) {}
			message.value = '吊秤已连接，请扫码；未称好的瓶可点重新称重'
			return true
		} catch (cause) { if (same(ticket)) fail(cause.message || '连接失败'); return false }
		finally { busy.value = false }
	}
	async function disconnect() {
		if (!editable()) return
		freeze(); busy.value = true
		stopping = Promise.allSettled([stopping, scale.stop()])
		try { await stopping; message.value = '吊秤已断开，已称重量保留' }
		finally { busy.value = false }
	}
	async function save(retry = false) {
		if (!active.value || !ownerMatches() || !canCreate.value || busy.value || sale.submitting.value) return false
		if (!retry && (step.value !== 4 || locked.value)) return false
		freeze(); error.value = ''
		const ticket = context()
		let result = await sale.submit()
		if (!active.value || !ownerMatches()) return false
		if (result?.error_code === 'MOBILE_SALE_REVALIDATION_CHANGED') changes.value = result.data?.changes || []
		const warnings = result?.data?.warning_items || result?.data?.warnings || []
		if (result?.code === 409 && result?.data?.confirmable === true && warnings.length) {
			busy.value = true
			try {
				const text = warnings.map(item => typeof item === 'string' ? item : `${item.bottle_no || item.bottleNo || ''} ${item.message || item.msg || item.warning_text || item.reason || '请核对流转'}`).join('\n')
				if (await confirm('流转提醒', text) && same(ticket)) result = await sale.submit({ confirmedWarnings: true })
			} finally { busy.value = false }
		}
		if (result?.code !== 0) fail(result?.msg || '保存结果待确认，请查询结果')
		return result?.code === 0
	}
	function applyChanges() {
		if (!editable() || !sale.applyRevalidationChanges()) return
		changes.value = []; selectStep(2)
	}
	async function query() {
		if (!active.value || !ownerMatches() || !canCreate.value || busy.value) return
		error.value = ''
		const result = await sale.querySubmission()
		if (active.value && result?.code !== 0) fail(result?.msg || '暂时查不到结果，请稍后重试')
	}
	function restore() {
		if (!active.value || busy.value || !sale.restoreDraft()) return false
		selectStep(step.value)
		message.value = '已恢复记录；未称好的瓶请连接后重新称重'
		return true
	}
	async function discard() {
		if (!active.value || busy.value) return
		const ticket = context()
		busy.value = true
		try {
			if (await confirm('放弃未提交的草稿？', '草稿中的客户和称重记录将清空。') && same(ticket)) {
				if (sale.discardDraft()) selectStep(1)
				else fail('这单已有提交记录，请继续这单并查询保存结果')
			}
		} finally { busy.value = false }
	}
	function nextSale() {
		if (!active.value || busy.value || !sale.startNewSale()) return false
		changes.value = []; selectStep(1)
		return true
	}
	async function activate() {
		const version = ++lifecycle
		await stopping
		if (version !== lifecycle) return false
		active.value = true
		try {
			const result = await enterBarcodeSession({ page: 'pda-native-sale', onResult: scan, activeTarget: { page: 'pda-native-sale', target: 'sale.scan', label: '客户或钢瓶', scope: 'sale' } })
			if (!active.value || version !== lifecycle) { await leaveBarcodeSession({ page: 'pda-native-sale' }); return false }
			if (result?.code !== 0) fail(result?.msg || '扫描头未就绪，可输入名称或瓶号')
		} catch (cause) { if (active.value) fail(cause.message || '扫描头初始化失败') }
	}
	async function deactivate() {
		active.value = false; lifecycle++; invalidate(); sale.persistDraft()
		stopping = Promise.allSettled([stopping, scale.stop(), leaveBarcodeSession({ page: 'pda-native-sale', reason: 'page-hidden' })])
		await stopping
	}
	onBeforeUnmount(() => { unsubscribe(); void deactivate() })
	return { sale, step, direction, outRows, backRows, rows, current, currentId, snapshot, busy, locked, error, message, changes, weighed,
		chooseBottle, selectCustomer, go, connect, disconnect, reweigh, remove, save, query, restore, discard, nextSale, applyChanges, activate, deactivate }
}
