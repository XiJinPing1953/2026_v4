#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
	RfidSessionTracker
} = require('./index.cjs')
const {
	RfidStreamParser,
	decodeXtEpc,
	encodeXtEpc,
	parseRfidTagFrame
} = require('./protocol.cjs')

function toBuffer(hex) {
	return Buffer.from(String(hex).replace(/\s+/g, ''), 'hex')
}

function buildFrame(epcHex, readerDeviceCode = '0001') {
	const payload = Buffer.concat([toBuffer(readerDeviceCode), toBuffer(epcHex)])
	const head = Buffer.from([0x01, 0x10, 0x03, 0xe8, 0x00, 0x07, payload.length])
	const body = Buffer.concat([head, payload])
	let crc = 0xffff
	for (const byte of body) {
		crc ^= byte
		for (let index = 0; index < 8; index += 1) {
			if (crc & 1) crc = (crc >> 1) ^ 0xa001
			else crc >>= 1
		}
	}
	const out = Buffer.concat([body, Buffer.from([crc & 0xff, (crc >> 8) & 0xff])])
	return out.toString('hex').toUpperCase()
}

function run(name, fn) {
	try {
		fn()
		process.stdout.write(`ok - ${name}\n`)
	} catch (error) {
		process.stderr.write(`not ok - ${name}\n`)
		throw error
	}
}

run('parses real RFID Modbus frame', () => {
	const frameHex = '011003E800070E0001E28068940000501BE78504D875C2'
	const parsed = parseRfidTagFrame(toBuffer(frameHex))
	assert.strictEqual(parsed.crc_ok, true)
	assert.strictEqual(parsed.reader_device_code, '0001')
	assert.strictEqual(parsed.epc, 'E28068940000501BE78504D8')
	assert.strictEqual(parsed.xt.epc_kind, 'unknown_epc')
})

run('stream parser handles heartbeat, sticky frames, and split frames', () => {
	const real = toBuffer('011003E800070E0001E28068940000501BE78504D875C2')
	const parser = new RfidStreamParser()
	const first = Buffer.concat([toBuffer('00'), real, toBuffer('55015000000000A6')])
	const firstEvents = parser.push(first)
	assert.deepStrictEqual(firstEvents.map((item) => item.type), ['heartbeat', 'tag', 'ignored'])
	const splitLeft = real.subarray(0, 9)
	const splitRight = real.subarray(9)
	assert.deepStrictEqual(parser.push(splitLeft), [])
	const splitEvents = parser.push(splitRight)
	assert.strictEqual(splitEvents.length, 1)
	assert.strictEqual(splitEvents[0].type, 'tag')
	assert.strictEqual(splitEvents[0].epc, 'E28068940000501BE78504D8')
})

run('encodes and decodes XT vehicle and bottle EPCs', () => {
	const vehicle = encodeXtEpc('vehicle', 1)
	const bottle = encodeXtEpc('bottle', 135)
	const secondBottle = encodeXtEpc('bottle', 5000)
	const vehicleDecoded = decodeXtEpc(vehicle)
	const bottleDecoded = decodeXtEpc(bottle)
	const secondBottleDecoded = decodeXtEpc(secondBottle)
	assert.strictEqual(vehicle, '585401020000000000011FA3')
	assert.strictEqual(bottle, '58540101000000000087AD01')
	assert.strictEqual(secondBottle, '58540101000000001388E035')
	assert.strictEqual(vehicleDecoded.entity_type, 'vehicle')
	assert.strictEqual(vehicleDecoded.epc_kind, 'vehicle')
	assert.strictEqual(vehicleDecoded.serial, '1')
	assert.strictEqual(vehicleDecoded.crc_ok, true)
	assert.strictEqual(bottleDecoded.entity_type, 'bottle')
	assert.strictEqual(bottleDecoded.epc_kind, 'bottle')
	assert.strictEqual(bottleDecoded.serial, '135')
	assert.strictEqual(bottleDecoded.crc_ok, true)
	assert.strictEqual(secondBottleDecoded.entity_type, 'bottle')
	assert.strictEqual(secondBottleDecoded.epc_kind, 'bottle')
	assert.strictEqual(secondBottleDecoded.serial, '5000')
	assert.strictEqual(secondBottleDecoded.crc_ok, true)
})

run('vehicle EPC opens session and bottle EPC is attached', () => {
	const logs = []
	const tracker = new RfidSessionTracker({
		sessionWindowMs: 15000,
		dedupMs: 1000,
		log(event, payload) {
			logs.push({ event, payload })
		}
	})
	const vehicleEpc = encodeXtEpc('vehicle', 1)
	const bottleEpc = encodeXtEpc('bottle', 135)
	const vehicleFrame = parseRfidTagFrame(toBuffer(buildFrame(vehicleEpc)))
	const bottleFrame = parseRfidTagFrame(toBuffer(buildFrame(bottleEpc)))
	const now = 100000
	const vehicleRes = tracker.processTag(vehicleFrame, now)
	assert.strictEqual(vehicleRes.entity_type, 'vehicle')
	assert.strictEqual(vehicleRes.in_session, true)
	const bottleRes = tracker.processTag(bottleFrame, now + 500)
	assert.strictEqual(bottleRes.entity_type, 'bottle')
	assert.strictEqual(bottleRes.in_session, true)
	const duplicateRes = tracker.processTag(bottleFrame, now + 800)
	assert.strictEqual(duplicateRes.deduped, true)
	const summaries = tracker.finalizeAll('test')
	assert.strictEqual(summaries.length, 1)
	assert.strictEqual(summaries[0].vehicle_epc, vehicleEpc)
	assert.strictEqual(summaries[0].bottle_total, 1)
	assert.strictEqual(summaries[0].bottles[0].epc, bottleEpc)
	assert.strictEqual(summaries[0].bottles[0].read_count, 2)
	assert.strictEqual(logs[0].event, 'rfid_session_summary')
})

process.stdout.write('all rfid-gateway tests passed\n')
