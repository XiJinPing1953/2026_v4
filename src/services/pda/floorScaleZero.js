// Local, volatile reference. Input is the DSX gross output, in kg.
export function createFloorScaleZero() {
	let ready, offset, anchor, first, last, since, low, high, count
	function interrupt() { since = null; count = 0 }
	function reset() { ready = false; offset = anchor = 0; first = last = null; interrupt() }
	reset()
	function observe(kg, time, allowTracking = true) {
		if (last !== null && (time < last || time - last > 3000)) reset()
		const dt = last === null ? 0 : time - last
		if (last !== null && dt <= 0) return
		if (dt > 500) interrupt()
		last = time
		if (first === null) first = time
		if (!allowTracking) { ready = true; interrupt(); return }
		const mg = Math.round(kg * 1e6)
		if (ready && (Math.abs(mg) >= 250000 ||
			(Math.abs(mg) > 25000 && (Math.abs(mg - anchor) >= 250000 || Math.abs(mg - offset) >= 250000)))) {
			interrupt(); return
		}
		if (since === null || Math.max(high, mg) - Math.min(low, mg) > 50000) {
			since = time; low = high = mg; count = 1
		} else { low = Math.min(low, mg); high = Math.max(high, mg); count++ }
		const stable = count >= 5 && time - since >= 2000
		if (!ready) {
			if (stable || (Math.abs(mg) >= 250000 && time - first >= 2000) || time - first >= 5000) {
				// Automatic capture only inside the zero display division.
				if (stable && low > -250000 && high < 250000) offset = anchor = Math.round((low + high) / 2)
				ready = true; interrupt()
			}
		} else if (stable) {
			// When the board finds zero itself, retire the handheld correction.
			if (Math.max(Math.abs(low), Math.abs(high)) <= 25000) { offset = anchor = 0 }
			else {
				const step = Math.min(dt, 500) * 10 // max 0.010 kg per second
				offset += Math.max(-step, Math.min(step, Math.round((low + high) / 2) - offset))
			}
			// Refresh the stable window periodically so slow drift cannot retain old extrema.
			if (time - since >= 4000) interrupt()
		}
	}
	return { observe, interrupt, reset, get ready() { return ready }, get offset() { return offset / 1e6 } }
}

const assistKey = id => 'pda_floor_zero_assist_v1:' + id
export function floorScaleAssistEnabled(id, store = typeof uni === 'undefined' ? null : uni) {
	try { return Boolean(id) && store?.getStorageSync(assistKey(id)) === 'on' } catch (_) { return false }
}
export function setFloorScaleAssist(id, enabled, store) {
	if (!id) throw new Error('请先连接秤台')
	const key = assistKey(id), value = enabled ? 'on' : 'off'
	store.setStorageSync(key, value)
	if (store.getStorageSync(key) !== value) throw new Error('设置保存失败，请重新核对')
}
