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
import { createFloorScaleZero, floorScaleAssistEnabled, setFloorScaleAssist } from '@/services/pda/floorScaleZero'
import { floorScaleDivisionKg } from '@/services/pda/floorScaleDisplay'

const acl = () => canPageAction('/pages/pda/reweigh', 'update')
const store = { getStorageSync: k => uni.getStorageSync(k), setStorageSync: (k,v) => uni.setStorageSync(k,v) }
const confirm = (title, content) => new Promise(resolve => uni.showModal({ title, content, confirmText:'确认', success: r => resolve(r.confirm), fail: () => resolve(false) }))
export function useFloorCalibrationBench() {
	const raw = shallowRef(null), point = shallowRef(null), state = shallowRef(null), error = ref(''), note = ref('')
	const mass = ref(''), expected = ref(''), busy = ref(false), records = ref([]), authorized = ref(false)
	let owner = '', epoch = 0, active = false, diagnostic = null, controller = null, timer = null
	let closing = Promise.resolve()
	const window = createCalibrationWindow()
	const zero = createFloorScaleZero()
	let zeroKey = ''
	const assist = ref(false)
	const display = computed(() => point.value?.workingReady ? floorScaleDivisionKg(point.value.kg - point.value.offset).toFixed(1) : '—')
	const activeOwner = () => active && authorized.value && owner === String(getUser()?._id || '') && acl()
	const key = () => 'pda_floor_bench_points_v1:' + owner
	function refresh() {
		raw.value = diagnostic?.getSnapshot() || null
		const reading = raw.value?.fresh ? window.read(Date.now(), raw.value.sessionKey) : null
		point.value = reading ? { ...reading, stable: zero.ready && reading.stable, workingReady: zero.ready, offset: assist.value ? zero.offset : 0 } : null
		state.value = controller?.getState() || null
	}
	function connection() {
		const s = diagnostic?.getSnapshot(), live = s?.fresh && window.read(Date.now(), s.sessionKey)
		return { is_connected:s?.status === 'connected', is_online:Boolean(live), error_code:live?'reading':'stale',
			sampled_at:live?.at, device_id:s?.deviceId, connection_key:s?.sessionKey, can_calibrate:s?.canWriteCalibration,
			error_message:'请连接原秤，等待有效重量' }
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
				const {sessionKey:key, deviceId} = d.getSnapshot()
				if (key !== zeroKey) { zero.reset(); zeroKey = key; assist.value = floorScaleAssistEnabled(deviceId, store) }
				const reading = window.observe(frame, at, key)
				if (reading) zero.observe(reading.kg, at)
				else zero.interrupt()
			}, onInterrupted() { window.clear(); zero.interrupt() } })
		diagnostic = d
		controller = createFloorScaleCalibrationController({ ownerId:owner, ownerMatches:activeOwner, storage:store,
			connection, canStart:() => activeOwner() && floorCalibrationWorkIdle(owner, store),
			stableReading:k => zero.ready ? window.read(Date.now(), k) : null, send:(command,id) => {
				zero.reset(); window.clear()
				return d.writeCalibrationCommand(command,id)
			} })
		try { const list = store.getStorageSync(key()); if(list) {
			const saved = typeof list === 'string' ? JSON.parse(list) : list
			if (!Array.isArray(saved)) throw new Error()
			records.value = saved
		} } catch (_) { error.value = '本机复核记录读取失败，原记录已保留' }
		refresh(); timer = setInterval(refresh, 250)
	}
	function deactivate() {
		active = false; authorized.value = false; epoch++; busy.value = false
		if (timer) clearInterval(timer)
		timer = null; zeroKey = ''; assist.value = false; zero.reset(); window.clear(); point.value = null; raw.value = null
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
	const toggleAssist = () => act(async () => {
		const s = diagnostic.getSnapshot()
		if (s.status !== 'connected' || !s.deviceId || state.value?.pending || !floorCalibrationWorkIdle(owner,store)) throw new Error('请连接秤台并完成当前操作')
		setFloorScaleAssist(s.deviceId, !assist.value, store)
		assist.value = floorScaleAssistEnabled(s.deviceId, store)
		zero.reset(); window.clear()
	})
	const issue = kind => act(async valid => {
		if (!floorCalibrationWorkIdle(owner, store)) throw new Error('请先完成或放弃复秤页的当前钢瓶')
		const s = diagnostic.getSnapshot(), before = window.read(Date.now(),s.sessionKey)
		if (!zero.ready || !before?.stable) throw new Error('请等读数稳定后再操作')
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
		if (action === 'fail' && (!await confirm('记录校准异常','保留待检查状态，复秤须重新完成标定。') || !valid())) return
		if (action === 'loaded') controller.confirmLoad()
		else controller.resolvePending(action !== 'fail')
		note.value = action === 'loaded' ? '已记录加载值，请移走全部砝码。' : action === 'fail' ? '已记录异常。' : '已记录空台实测值。'
	})
	const record = label => act(async () => {
		const s = diagnostic.getSnapshot(), p = window.read(Date.now(),s.sessionKey)
		if (!zero.ready || !p?.stable) throw new Error('请等待稳定后记录')
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
	return { assist, toggleAssist, raw, point, state, display, error, note, records, mass, expected, busy, authorized, activate, deactivate, connect, disconnect, issue, review, record }
}
