'use strict'

const DEFAULT_SCALE_CODE = 'filling_scale_main'
const C606_TARGET_QUANT1_ADDRESS = 0x00ca

function toWord(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Math.max(0, Math.min(0xffff, Math.trunc(num)))
}

function toSignedInt32HighFirst(highWord, lowWord) {
	const high = toWord(highWord)
	const low = toWord(lowWord)
	const unsigned = high * 0x10000 + low
	return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned
}

function toNullableNumber(value) {
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function roundNumber(value, digits = 6) {
	const num = Number(value)
	if (!Number.isFinite(num)) return null
	return Number(num.toFixed(digits))
}

function registersToHex(registers = []) {
	return (Array.isArray(registers) ? registers : [])
		.map((item) => toWord(item).toString(16).toUpperCase().padStart(4, '0'))
		.join('')
}

function decodeFloat32HighFirst(registers = []) {
	const source = Array.isArray(registers) ? registers : []
	if (source.length < 2) throw new Error('C606+ 浮点寄存器数量不足，至少需要 2 个')
	const buffer = Buffer.alloc(4)
	buffer.writeUInt16BE(toWord(source[0]), 0)
	buffer.writeUInt16BE(toWord(source[1]), 2)
	const value = buffer.readFloatBE(0)
	if (!Number.isFinite(value)) throw new Error('C606+ 浮点毛重无效')
	return value
}

function encodeFloat32HighFirstRegisters(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) throw new Error('C606+ 目标重量不是有效数字')
	const buffer = Buffer.alloc(4)
	buffer.writeFloatBE(num, 0)
	return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)]
}

function convertUnitToKg(scaledValue, unitCode) {
	const value = Number(scaledValue)
	if (!Number.isFinite(value)) return null
	const unit = Number(unitCode)
	if (unit === 0) return value / 1000000
	if (unit === 1) return value / 1000
	if (unit === 2) return value
	if (unit === 3) return value * 1000
	return null
}

function decodeC606ConfigRegisters(configRegisters = []) {
	const config = Array.isArray(configRegisters) ? configRegisters : []
	if (config.length < 11) throw new Error('C606+ 配置寄存器数量不足，至少需要 11 个')
	return {
		divisionValue: toNullableNumber(config[0]),
		decimalPlaces: Math.max(0, Math.trunc(toNullableNumber(config[1]) || 0)),
		unitCode: toNullableNumber(config[10])
	}
}

function buildC606ScaleDecoded({ rawWeight, weightKg, dynamicInputs = [], config = {}, readMode = 'gross_int', rawScalePayload = {} }) {
	const dynamicFlag = Array.isArray(dynamicInputs) ? Boolean(dynamicInputs[0]) : Boolean(dynamicInputs)
	const stableMetric = dynamicFlag ? 1 : 0
	const stableThreshold = 0
	const unitCode = toNullableNumber(config.unitCode)
	const divisionValue = toNullableNumber(config.divisionValue)
	const decimalPlaces = Math.max(0, Math.trunc(toNullableNumber(config.decimalPlaces) || 0))
	return {
		weight_raw: toNullableNumber(rawWeight),
		weight_kg: roundNumber(weightKg, 6),
		scale_read_mode: readMode,
		raw_scale_payload: rawScalePayload,
		unit_code: unitCode,
		decimal_places: decimalPlaces,
		stable_metric: stableMetric,
		stable_threshold: stableThreshold,
		is_stable: dynamicFlag !== true,
		overload_supported: false,
		overload: null,
		protocol_meta: {
			instrument: 'C606+',
			weight_register: readMode,
			division_value: divisionValue,
			dynamic_flag: dynamicFlag
		}
	}
}

function decodeC606GrossIntRegisters(weightRegisters = [], dynamicInputs = [], config = {}) {
	const weight = Array.isArray(weightRegisters) ? weightRegisters : []
	if (weight.length < 2) throw new Error('C606+ 毛重寄存器数量不足，至少需要 2 个')
	const rawWeight = toSignedInt32HighFirst(weight[0], weight[1])
	const unitCode = toNullableNumber(config.unitCode)
	const decimalPlaces = Math.max(0, Math.trunc(toNullableNumber(config.decimalPlaces) || 0))
	const scaledValue = rawWeight / 10 ** decimalPlaces
	const weightKg = convertUnitToKg(scaledValue, unitCode)
	return buildC606ScaleDecoded({
		rawWeight,
		weightKg,
		dynamicInputs,
		config,
		readMode: 'gross_int',
		rawScalePayload: {
			gross_int_registers: weight.slice(0, 2),
			gross_int_hex: registersToHex(weight.slice(0, 2))
		}
	})
}

function decodeC606GrossFloatRegisters(weightRegisters = [], dynamicInputs = [], config = {}) {
	const weight = Array.isArray(weightRegisters) ? weightRegisters : []
	const grossValue = decodeFloat32HighFirst(weight)
	const unitCode = toNullableNumber(config.unitCode)
	const weightKg = convertUnitToKg(grossValue, unitCode)
	if (!Number.isFinite(weightKg)) throw new Error('C606+ 浮点毛重单位换算失败')
	return buildC606ScaleDecoded({
		rawWeight: grossValue,
		weightKg,
		dynamicInputs,
		config,
		readMode: 'gross_float',
		rawScalePayload: {
			gross_float_registers: weight.slice(0, 2),
			gross_float_hex: registersToHex(weight.slice(0, 2))
		}
	})
}

function decodeC606ScaleRegisters(weightRegisters = [], dynamicInputs = [], config = {}) {
	return decodeC606GrossIntRegisters(weightRegisters, dynamicInputs, config)
}

const MOCK_FRAMES = [
	{
		name: 'stable_kg',
		weight: [0, 1234],
		dynamicInputs: [false],
		config: { unitCode: 2, divisionValue: 1, decimalPlaces: 1 }
	},
	{
		name: 'moving_kg',
		weight: [0, 1248],
		dynamicInputs: [true],
		config: { unitCode: 2, divisionValue: 1, decimalPlaces: 1 }
	},
	{
		name: 'stable_g',
		weight: [0, 25340],
		dynamicInputs: [false],
		config: { unitCode: 1, divisionValue: 1, decimalPlaces: 0 }
	}
]

function getMockFrame(index = 0) {
	const frame = MOCK_FRAMES[Math.abs(Number(index) || 0) % MOCK_FRAMES.length]
	return {
		name: frame.name,
		decoded: decodeC606ScaleRegisters(frame.weight, frame.dynamicInputs, frame.config)
	}
}

module.exports = {
	DEFAULT_SCALE_CODE,
	C606_TARGET_QUANT1_ADDRESS,
	toSignedInt32HighFirst,
	decodeFloat32HighFirst,
	encodeFloat32HighFirstRegisters,
	convertUnitToKg,
	decodeC606ConfigRegisters,
	decodeC606GrossIntRegisters,
	decodeC606GrossFloatRegisters,
	decodeC606ScaleRegisters,
	getMockFrame
}
