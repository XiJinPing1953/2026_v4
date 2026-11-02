// Track physical loads independently from the asynchronous bottle lookup.
// An unload followed by a new load creates a new claim, even at the same weight.
export function createFloorLoadTracker() {
	let phase, cycle, owner, offset, emptySince, emptyKind, previous, generation = 0
	let samples = [], offer = null, lastRaw = null
	function clearWindow() {
		if (samples.length) generation++
		samples = []; offer = null
	}
	function interrupt() { clearWindow(); emptySince = null; emptyKind = null }
	function reset() {
		phase = 'unknown'; cycle = (cycle || 0) + 1; owner = ''; offset = 0; previous = 0
		lastRaw = null; interrupt(); generation++
	}
	reset()
	function updateWindow(kg, time) {
		if (offset || Math.abs(kg) < 0.25 || Math.abs(kg) > 0.5) { clearWindow(); return }
		while (samples.length > 1 && samples[1].time <= time - 1500) samples.shift()
		if (samples.length >= 160 || (samples.length && Math.sign(samples[0].kg) !== Math.sign(kg))) clearWindow()
		samples.push({ kg, time })
		let low = kg, high = kg, sum = 0
		for (const s of samples) { low = Math.min(low, s.kg); high = Math.max(high, s.kg); sum += s.kg }
		if (high - low > 0.100000001) { clearWindow(); samples.push({kg, time}); return }
		if (time - samples[0].time >= 1500) offer = { kg: Math.round(sum / samples.length * 1000000) / 1000000, generation }
	}
	function observe(kg, time) {
		if (previous && time - previous > 3000) reset()
		else if (previous && (time < previous || time - previous > 300)) interrupt()
		previous = time; lastRaw = kg
		updateWindow(kg, time)
		const rawZero = Math.abs(kg) < 0.25
		const nearOffset = offset !== 0 && Math.abs(kg - offset) < 0.25
		const kind = rawZero ? 'zero' : nearOffset ? 'offset' : Math.abs(kg) <= 0.5 ? 'drift' : null
		if (kind) {
			if (emptySince === null || emptyKind !== kind) { emptySince = time; emptyKind = kind }
			// Ignore the momentary half-step crossed while putting a bottle down.
			// Only sustained residual weight invalidates an earlier empty platform.
			if (time - emptySince >= 300) {
				if (phase === 'loaded' || kind !== 'offset') offset = 0
				phase = rawZero || offset ? 'empty' : 'unknown'
				owner = ''
			}
			return
		}
		emptySince = null; emptyKind = null
		if (kg < -0.5) { phase = 'unknown'; offset = 0; return }
		if (phase === 'empty' && kg > 0.5) { phase = 'loaded'; cycle++; owner = '' }
	}
	function acceptOffer(expected, now) {
		if (!expected || !offer || expected.generation !== offer.generation || now < previous || now - previous > 300 ||
			Math.abs(expected.kg - offer.kg) > 0.001) return false
		offset = expected.kg; phase = 'empty'; owner = ''; emptySince = null
		clearWindow(); return true
	}
	function claim(key) {
		if (!key || phase !== 'loaded' || lastRaw <= 0.5 || (owner && owner !== key)) return null
		owner = key; return cycle
	}
	function end() {
		if (offset && phase === 'empty') phase = 'unknown'
		offset = 0; clearWindow()
	}
	return { observe, claim, acceptOffer, reset, interrupt, end, get phase() { return phase },
		get owner() { return owner }, get offset() { return offset }, get offer() { return offer }, get cycle() { return cycle } }
}
