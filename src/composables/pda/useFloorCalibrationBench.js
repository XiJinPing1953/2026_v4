import { computed, ref, shallowRef } from 'vue'
import { getUser } from '@/services/auth'
import { canPageAction } from '@/services/pageAcl'
import { ensurePdaBleRuntimePermission } from '@/services/pda/bleScale'
import { createFloorScaleDiagnostic } from '@/services/pda/floorScaleDiagnostic'
import { createFloorScaleNativeRuntime } from '@/services/pda/floorScaleNativeRuntime'
import { createFloorScaleCalibrationController } from '@/services/pda/floorScaleCalibrationController'
import { floorScaleKilogramsToGrams } from '@/services/pda/floorScaleCalibration'
import { createCalibrationWindow } from '@/services/pda/floorCalibrationReading'
import { floorCalibrationWorkIdle } from '@/services/pda/reweighWorkStore'
import { floorScaleDivisionKg } from '@/services/pda/floorScaleDisplay'
import { floorScaleBootStatus } from '@/services/pda/floorScaleProtocol'

const acl = () => canPageAction('/pages/pda/reweigh', 'update')
const store = { getStorageSync: k => uni.getStorageSync(k), setStorageSync: (k,v) => uni.setStorageSync(k,v) }
const confirm = (title, content) => new Promise(resolve => uni.showModal({ title, content, confirmText:'确认', success: r => resolve(r.confirm), fail: () => resolve(false) }))
export function useFloorCalibrationBench() {
	const raw = shallowRef(null), point = shallowRef(null), state = shallowRef(null), error = ref(''), note = ref('')
	const bootStatus = shallowRef(null)
	const mass = ref(''), expected = ref(''), busy = ref(false), records = ref([]), authorized = ref(false)
	let owner = '', epoch = 0, active = false, diagnostic = null, controller = null, timer = null
	let closing = Promise.resolve(), offDiagnostic, offController
	const window = createCalibrationWindow({ allowUnzeroed: true })
	const display = computed(() => point.value && !bootStatus.value ? floorScaleDivisionKg(point.value.kg).toFixed(1) : '—')
	const activeOwner = () => active && authorized.value && owner === String(getUser()?._id || '') && acl()
	const key = () => 'pda_floor_bench_points_v1:' + owner
	function refresh() {
		const snap = diagnostic?.getSnapshot()
		if (!snap) return
		const boot = snap.fresh ? floorScaleBootStatus(snap.frame) : null
		controller?.observeConnection({ is_connected:snap.status === 'connected', device_id:snap.deviceId,
			connection_key:snap.sessionKey, error_code:boot?.code || '' })
		if (bootStatus.value?.code !== boot?.code) bootStatus.value = boot
		// This view only renders connection fields. Counters and raw packets are not UI state here.
		if (!raw.value || ['status','deviceId','canWriteCalibration','sessionKey'].some(k => raw.value[k] !== snap[k])) raw.value = snap
		const reading = snap.fresh ? window.read(Date.now(), snap.sessionKey) : null
		const next = reading ? {kg:reading.kg, ad:reading.ad, stable:reading.stable} : null
		if ((!next && point.value) || (next && (!point.value || Object.keys(next).some(k => next[k] !== point.value[k])))) point.value = next
		if (activeOwner() && !busy.value && state.value?.pending && !state.value?.error) {
			try {
				const result = controller?.reviewWhenReady()
				if (result) {
					error.value = ''
					note.value = result === 'zero' ? '空台归零完成。需要标定时，放上砝码并填写实际公斤数。' : result === 'loaded' ? '加载示值已核对。请取下砝码，回零后自动完成。' : '标定完成，加载和卸空示值均已核对。'
				}
			} catch (cause) { error.value = cause.message || '核对状态保存失败' }
		}
	}
	function connection() {
		const s = diagnostic?.getSnapshot(), live = s?.fresh && window.read(Date.now(), s.sessionKey)
		const boot = s?.fresh ? floorScaleBootStatus(s.frame) : null
		return { is_connected:s?.status === 'connected', is_online:Boolean(live), error_code:boot?.code || (live?'reading':'stale'),
			sampled_at:live?.at, device_id:s?.deviceId, connection_key:s?.sessionKey, can_calibrate:s?.canWriteCalibration,
			error_message:boot?.message || '请连接原秤，等待有效重量' }
	}
	async function activate() {
		const ticket = ++epoch
		await closing
		if (ticket !== epoch || active) return
		owner = String(getUser()?._id || ''); authorized.value = Boolean(owner && acl()); active = true
		state.value = null; records.value = []; error.value = ''; note.value = ''; mass.value = ''; expected.value = ''
		if (!authorized.value) { error.value = '当前账号没有秤台校准权限'; return }
		const d = createFloorScaleDiagnostic(createFloorScaleNativeRuntime(uni), {
			onFrame(frame, at) {
				window.observe(frame, at, d.getSnapshot().sessionKey)
				// Observe boot frames at reception; a UI refresh can miss a brief restart.
				const s = d.getSnapshot()
				controller?.observeConnection({ is_connected:true, device_id:s.deviceId,
					connection_key:s.sessionKey, error_code:floorScaleBootStatus(frame)?.code || '' })
			}, onInterrupted() { window.clear() } })
		diagnostic = d
		controller = createFloorScaleCalibrationController({ ownerId:owner, ownerMatches:activeOwner, storage:store,
			connection, canStart:() => activeOwner() && floorCalibrationWorkIdle(owner, store),
			stableReading:k => window.read(Date.now(), k), send:(command,id) => {
				window.clear()
				return d.writeCalibrationCommand(command,id)
			} })
		try { const list = store.getStorageSync(key()); if(list) {
			const saved = typeof list === 'string' ? JSON.parse(list) : list
			if (!Array.isArray(saved)) throw new Error()
			records.value = saved
		} } catch (_) { error.value = '本机复核记录读取失败，原记录已保留' }
		offController = controller.subscribe(value => { state.value = value })
		offDiagnostic = d.subscribe(s => {
			if (s.status === 'connected' && timer === null) { timer = setInterval(refresh, 250); refresh() }
			else if (s.status !== 'connected') {
				if (timer !== null) clearInterval(timer)
				timer = null; refresh()
			}
		})
	}
	function deactivate() {
		active = false; authorized.value = false; epoch++; busy.value = false
		offDiagnostic?.(); offController?.(); offDiagnostic = offController = null
		if (timer !== null) clearInterval(timer)
		timer = null; window.clear(); point.value = null; raw.value = null; bootStatus.value = null
		const d = diagnostic; diagnostic = null; controller = null
		closing = Promise.allSettled([closing, d?.disconnect()])
		return closing
	}
	async function act(fn) {
		if (!activeOwner() || busy.value) return
		const ticket = epoch; busy.value = true; error.value = ''; note.value = ''
		try { await fn(() => ticket === epoch && activeOwner()) }
		catch (e) { if (ticket === epoch) error.value = e.message || '操作未完成' }
		finally { if (ticket === epoch) { busy.value = false; refresh() } }
	}
	const connect = () => act(async valid => {
		const d = diagnostic
		const permission = await ensurePdaBleRuntimePermission()
		if (!valid()) return
		if (permission?.code !== 0) throw new Error(permission?.msg || '请允许蓝牙权限')
		const list = await d.discover()
		if (!valid()) return
		if (list.code !== 0 || !list.data?.length) throw new Error(list.msg || '未找到附近的地秤')
		const selected = await new Promise(res => uni.showActionSheet({ itemList:list.data.map(i => (i.name || '地秤') + ' · ' + i.deviceId.slice(-6)), success:r=>res(r.tapIndex), fail:()=>res(-1) }))
		if (!valid() || selected < 0) return
		const result = await d.connect(list.data[selected].deviceId)
		if (valid() && result.code !== 0) throw new Error(result.msg || '连接失败')
	})
	const disconnect = () => act(async () => { window.clear(); await diagnostic.disconnect() })
	const beginCheck = () => act(async () => {
		controller.beginCheck(expected.value)
		note.value = '请放上填写重量的砝码，稳定后核对；此次复核不改标定。'
	})
	const cancelCheck = () => act(async () => { controller.cancelCheck(); note.value = '已退出只读复核，主板参数未改变。需要调整时使用上方标定。' })
	const issue = kind => act(async valid => {
		if (!floorCalibrationWorkIdle(owner, store)) throw new Error('请先完成或放弃复秤页的当前钢瓶')
		const s = diagnostic.getSnapshot(), before = window.read(Date.now(),s.sessionKey)
		if (!before?.stable) throw new Error('请等读数稳定后再操作')
		const grams = kind === 'mass' ? floorScaleKilogramsToGrams(mass.value) : null
		if (grams > 1000000) throw new Error('最大称量 1000 kg，放 200 kg 请填 200')
		const message = kind === 'zero' ? '请确认秤台确实已清空。当前原始 ' + before.kg.toFixed(3) + ' kg，将写入仪表零点。' : '确认台上实际放了 ' + grams/1000 + ' kg 砝码，将写入仪表标定值。'
		if (!await confirm(kind === 'zero' ? '确认空台归零' : '确认砝码标定', message) || !valid()) return
		const now = diagnostic.getSnapshot(), check = window.read(Date.now(),now.sessionKey)
		if (now.sessionKey !== s.sessionKey || !check?.stable || Math.abs(check.kg-before.kg)>0.1) throw new Error('连接或载荷已变，请重新核对')
		const result = kind === 'zero' ? await controller.issueZero() : await controller.issueMass(String(grams / 1000))
		if (valid()) note.value = result.msg
	})
	const review = action => act(async valid => {
		if (action === 'fail' && (!await confirm('记录校准异常','记录本次未通过，检查后可重新做砝码复核。') || !valid())) return
		if (action === 'loaded') controller.confirmLoad()
		else controller.resolvePending(action !== 'fail')
		note.value = action === 'loaded' ? '已记录加载值，请移走全部砝码。' : action === 'fail' ? '已记录异常。' : '已记录空台实测值。'
	})
	const record = label => act(async () => {
		const s = diagnostic.getSnapshot(), p = window.read(Date.now(),s.sessionKey)
		if (!p?.stable) throw new Error('请等待稳定后记录')
		const old = store.getStorageSync(key())
		const rows = old ? (typeof old === 'string' ? JSON.parse(old) : old) : []
		if (!Array.isArray(rows)) throw new Error('复核记录无法读取，原记录已保留')
		const nominal = label === '空台' ? 0 : floorScaleKilogramsToGrams(expected.value) / 1000
		if (nominal > 1000) throw new Error('复核载荷超过本秤 1000 kg')
		const next = [{ label, device:s.deviceId, kg:p.kg, nominal, ad:p.ad, at:p.at }, ...rows].slice(0,24)
		const text = JSON.stringify(next); store.setStorageSync(key(),text)
		if (store.getStorageSync(key()) !== text) throw new Error('记录保存未确认，请重新进入核对')
		records.value = next; note.value = '已在本机记录' + label
	})
	return { beginCheck, cancelCheck, raw, point, state, bootStatus, display, error, note, records, mass, expected, busy, authorized, activate, deactivate, connect, disconnect, issue, review, record }
}
