#!/usr/bin/env node
'use strict'

const {
	decodeXtEpc,
	encodeXtEpc,
	normalizeHex
} = require('./protocol.cjs')

const PILOT_TAGS = [
	{
		label: 'vehicle-test-001',
		entity_type: 'vehicle',
		serial: '1',
		note: 'first gate inventory vehicle tag'
	},
	{
		label: 'bottle-test-135',
		entity_type: 'bottle',
		serial: '135',
		note: 'first pilot bottle tag'
	},
	{
		label: 'bottle-test-5000',
		entity_type: 'bottle',
		serial: '5000',
		note: 'second pilot bottle tag'
	}
]

function printHelp() {
	console.log(`
用法:
  node scripts/rfid-gateway/issue-tags.cjs
  node scripts/rfid-gateway/issue-tags.cjs --type vehicle --serial 1
  node scripts/rfid-gateway/issue-tags.cjs --type bottle --serial 135
  node scripts/rfid-gateway/issue-tags.cjs --validate 585401020000000000011FA3

说明:
  默认输出本轮写标验收用的 1 个车辆 EPC 和 2 个瓶子 EPC。
  --type/--serial 可生成指定 XT EPC。
  --validate 可校验一个或多个 EPC 是否符合 XT 规则。
`.trim())
}

function parseArgs(argv) {
	const args = {
		help: false,
		type: '',
		serial: '',
		validate: []
	}
	for (let index = 2; index < argv.length; index += 1) {
		const current = argv[index]
		if (current === '--help' || current === '-h') args.help = true
		else if (current === '--type') {
			args.type = String(argv[index + 1] || '').trim()
			index += 1
		} else if (current.startsWith('--type=')) {
			args.type = String(current.slice('--type='.length)).trim()
		} else if (current === '--serial') {
			args.serial = String(argv[index + 1] || '').trim()
			index += 1
		} else if (current.startsWith('--serial=')) {
			args.serial = String(current.slice('--serial='.length)).trim()
		} else if (current === '--validate') {
			for (let next = index + 1; next < argv.length; next += 1) {
				const value = argv[next]
				if (String(value).startsWith('--')) break
				args.validate.push(value)
				index = next
			}
		}
	}
	return args
}

function assertSerial(serial) {
	const text = String(serial || '').trim()
	if (!/^\d+$/.test(text)) throw new Error('serial must be a non-negative integer')
	const value = BigInt(text)
	if (value > 0xffffffffffffn) throw new Error('serial must be <= 281474976710655')
	return text
}

function makeRow(tag) {
	const serial = assertSerial(tag.serial)
	const epc = encodeXtEpc(tag.entity_type, serial)
	const decoded = decodeXtEpc(epc)
	return {
		label: tag.label || `${tag.entity_type}-${serial}`,
		entity_type: decoded.entity_type,
		serial: decoded.serial,
		epc,
		crc_ok: decoded.crc_ok,
		note: tag.note || ''
	}
}

function printRows(rows) {
	console.log(['label', 'entity_type', 'serial', 'epc', 'crc_ok', 'note'].join(','))
	rows.forEach((row) => {
		console.log([
			row.label,
			row.entity_type,
			row.serial,
			row.epc,
			row.crc_ok ? 'true' : 'false',
			row.note
		].join(','))
	})
}

function printValidation(epcs) {
	if (!epcs.length) throw new Error('--validate requires at least one EPC')
	epcs.forEach((value) => {
		const epc = normalizeHex(value)
		const decoded = decodeXtEpc(epc)
		console.log(JSON.stringify({
			epc,
			is_xt: decoded.is_xt,
			epc_kind: decoded.epc_kind,
			entity_type: decoded.entity_type,
			serial: decoded.serial || '',
			crc_ok: decoded.crc_ok === true,
			expected_crc: decoded.expected_crc || '',
			actual_crc: decoded.actual_crc || ''
		}))
	})
}

function main() {
	const args = parseArgs(process.argv)
	if (args.help) {
		printHelp()
		return
	}
	if (args.validate.length) {
		printValidation(args.validate)
		return
	}
	if (args.type || args.serial) {
		if (!args.type || !args.serial) throw new Error('--type and --serial must be used together')
		printRows([makeRow({
			entity_type: args.type,
			serial: args.serial
		})])
		return
	}
	printRows(PILOT_TAGS.map(makeRow))
}

try {
	main()
} catch (error) {
	console.error(`error: ${error.message}`)
	process.exit(1)
}
