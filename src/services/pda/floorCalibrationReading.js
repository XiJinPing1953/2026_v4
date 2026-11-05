import { floorScaleCandidateKg } from './floorScaleProtocol'

// The board stamp proves a new sample even if the measured load stays constant.
export function createCalibrationWindow({ allowUnzeroed = false } = {}) {
	let rows = [], previous = null, session = ''
	function clear() { rows = []; previous = null; session = '' }
	function observe(frame, at, connectionKey) {
		const kg = floorScaleCandidateKg(frame)
		if (frame?.format !== 'milligrams' || frame.moduleId !== 0 || (frame.status !== 0 && !(allowUnzeroed && frame.status === 0xe2)) ||
			kg == null || Math.abs(kg) > 1000 || !Number.isFinite(at) || !connectionKey || !/^[0-9A-F]{8}$/.test(frame.adcHex)) { clear(); return }
		if (session !== connectionKey) clear()
		if (previous && previous.status !== frame.status) clear()
		if (previous?.stamp === frame.timestampHex) return
		if (previous && (at < previous.at || at - previous.at > 500)) clear()
		const ad = parseInt(frame.adcHex, 16) | 0
		session = connectionKey
		previous = { at, kg, ad, status: frame.status, stamp: frame.timestampHex }
		rows.push(previous)
		while (rows.length > 1 && rows[1].at <= at - 1500) rows.shift()
		if (rows.length > 256) rows.shift()
		return previous
	}
	function read(now, key) {
		if (!previous || session !== key || now < previous.at || now - previous.at > 500) return null
		const from = rows[0].at
		const weights = rows.map(s => s.kg)
		return { ...previous, from, connectionKey: key, stable: rows.length >= 3 && previous.at - from >= 1500 &&
			Math.max(...weights) - Math.min(...weights) <= 0.100001 }
	}
	return { observe, read, clear }
}
