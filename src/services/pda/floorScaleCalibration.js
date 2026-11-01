// Commands documented for DSX_Weight_01 TTL. These functions only prepare
// bytes; they never send a command or claim that a calibration succeeded.
const MAX_GRAMS = 0xffffffff

function makeFrame(method, payload) {
	const frame = Uint8Array.from([0xaa, 0x01, 0x03, 7 + payload.length, 0, payload.length, method, ...payload])
	let check = 0
	for (const value of frame) check ^= value
	frame[4] = check
	return frame
}

export function floorScaleZeroCommand() {
	// ID 0 is documented for the single-channel example; device must be verified.
	return makeFrame(0x07, [0])
}

export function floorScaleKilogramsToGrams(input) {
	// Decimal input is converted as text; never silently round a standard mass.
	const value = String(input ?? '').trim()
	if (!/^\d+(?:\.\d{1,3})?$/.test(value) || value.length > 20) throw new Error('请输入大于零的砝码重量，最多三位小数')
	const [whole, fraction = ''] = value.split('.')
	const kg = Number(whole), grams = kg * 1000 + Number(fraction.padEnd(3, '0'))
	if (!Number.isSafeInteger(grams) || grams <= 0 || grams > MAX_GRAMS) throw new Error('砝码重量超出协议范围')
	return grams
}

export function floorScaleMassCommand(inputKg) {
	const grams = floorScaleKilogramsToGrams(inputKg)
	return makeFrame(0x09, [0, Math.floor(grams / 0x1000000) & 0xff, Math.floor(grams / 0x10000) & 0xff, Math.floor(grams / 0x100) & 0xff, grams & 0xff])
}
