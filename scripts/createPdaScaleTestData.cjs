#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const QRCode = require('qrcode-terminal/vendor/QRCode')
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel')
const { PNG } = require('pngjs')
const {
	ensureCrmToken,
	generateRequestId,
	normalizeBottleNo,
	normalizeCode,
	normalizeString,
	parseStandardArgs,
	prepareClientOptions
} = require('./lib/qrImportCommon.cjs')

const DEFAULT_SPACE_ID = 'env-00jxuffegf2n'
const OUTPUT_DIR = path.resolve(process.cwd(), 'docs/pda-qr-300x300/2026-04-24-scale-test')

const TEST_CUSTOMER = {
	name: 'PDA测试客户-吊秤',
	short_name: 'PDA吊秤测试',
	contact: 'PDA测试',
	phone: '19900005001',
	address: 'PDA吊秤测试',
	remark: 'PDA吊秤销售闭环测试数据',
	default_price_unit: 'kg',
	default_unit_price: 5,
	qr_code: 'PDA-SCALE-CUST-001',
	is_active: true
}

const TEST_BOTTLES = [
	{ bottle_no: 'PDA-SCALE-B001', pda_qr_code: 'PDA-SCALE-BOTTLE-001' },
	{ bottle_no: 'PDA-SCALE-B002', pda_qr_code: 'PDA-SCALE-BOTTLE-002' },
	{ bottle_no: 'PDA-SCALE-B003', pda_qr_code: 'PDA-SCALE-BOTTLE-003' }
].map((item, index) => ({
	...item,
	qr_code: item.pda_qr_code,
	filling_company: 'PDA吊秤测试',
	registration_mark: `PDA-SCALE-TEST-${String(index + 1).padStart(3, '0')}`,
	equipment_type: '测试气瓶',
	product_no: item.bottle_no,
	manufacturer: 'PDA测试',
	tare_weight: 1,
	status: 'in_station',
	is_active: true,
	remark: 'PDA吊秤销售闭环测试瓶'
}))

function writeJson(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function sanitizeFilePart(value) {
	return normalizeString(value).replace(/[\\/:*?"<>|\s]+/g, '_')
}

function createQrMatrix(data) {
	const qrcode = new QRCode(-1, QRErrorCorrectLevel.M)
	qrcode.addData(data)
	qrcode.make()
	return qrcode.modules
}

function writeQrPng(filePath, data, size = 300) {
	const modules = createQrMatrix(data)
	const moduleCount = modules.length
	const quiet = 4
	const cells = moduleCount + quiet * 2
	const scale = Math.max(1, Math.floor(size / cells))
	const qrSize = scale * cells
	const offset = Math.floor((size - qrSize) / 2)
	const png = new PNG({ width: size, height: size })

	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const idx = (size * y + x) << 2
			png.data[idx] = 255
			png.data[idx + 1] = 255
			png.data[idx + 2] = 255
			png.data[idx + 3] = 255
		}
	}

	for (let row = 0; row < moduleCount; row += 1) {
		for (let col = 0; col < moduleCount; col += 1) {
			if (!modules[row][col]) continue
			const startX = offset + (col + quiet) * scale
			const startY = offset + (row + quiet) * scale
			for (let y = startY; y < startY + scale; y += 1) {
				for (let x = startX; x < startX + scale; x += 1) {
					if (x < 0 || x >= size || y < 0 || y >= size) continue
					const idx = (size * y + x) << 2
					png.data[idx] = 0
					png.data[idx + 1] = 0
					png.data[idx + 2] = 0
					png.data[idx + 3] = 255
				}
			}
		}
	}

	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, PNG.sync.write(png))
}

async function callCrm(client, crmToken, functionName, action, data = {}) {
	return client.callFunction(functionName, {
		action,
		token: crmToken,
		data,
		request_id: generateRequestId()
	})
}

function unwrapCustomer(res) {
	return res?.data?.customer || res?.data || null
}

function unwrapBottle(res) {
	return res?.data?.bottle || res?.data || null
}

async function findCustomer(client, crmToken) {
	const qrRes = await callCrm(client, crmToken, 'crm-customer', 'resolveQrCodeV1', { qr_code: TEST_CUSTOMER.qr_code })
	if (qrRes?.code === 0) return unwrapCustomer(qrRes)
	const listRes = await callCrm(client, crmToken, 'crm-customer', 'listV1', {
		keyword: TEST_CUSTOMER.phone,
		page: 1,
		pageSize: 20,
		isActive: true
	})
	const rows = Array.isArray(listRes?.data) ? listRes.data : []
	return rows.find((row) => normalizeString(row.phone) === TEST_CUSTOMER.phone || normalizeString(row.name) === TEST_CUSTOMER.name) || null
}

async function upsertCustomer(client, crmToken, execute) {
	const existing = await findCustomer(client, crmToken)
	if (!execute) {
		return {
			action: existing?._id ? 'update' : 'create',
			existing_id: existing?._id || '',
			doc: TEST_CUSTOMER
		}
	}
	if (existing?._id) {
		const res = await callCrm(client, crmToken, 'crm-customer', 'updateV1', {
			_id: existing._id,
			...TEST_CUSTOMER
		})
		if (res?.code !== 0) throw new Error(`客户更新失败: ${JSON.stringify(res)}`)
		return { action: 'update', _id: existing._id, doc: TEST_CUSTOMER }
	}
	const res = await callCrm(client, crmToken, 'crm-customer', 'createV1', TEST_CUSTOMER)
	if (res?.code !== 0) throw new Error(`客户创建失败: ${JSON.stringify(res)}`)
	return { action: 'create', _id: res?.data?._id || res?.id || '', doc: TEST_CUSTOMER }
}

async function findBottle(client, crmToken, bottle) {
	const qrRes = await callCrm(client, crmToken, 'crm-bottle', 'resolveQrCodeV1', { pda_qr_code: bottle.pda_qr_code })
	if (qrRes?.code === 0) return unwrapBottle(qrRes)
	const noRes = await callCrm(client, crmToken, 'crm-bottle', 'resolveBottleNoV1', { bottle_no: bottle.bottle_no })
	if (noRes?.code === 0) return unwrapBottle(noRes)
	return null
}

async function upsertBottle(client, crmToken, bottle, execute) {
	const existing = await findBottle(client, crmToken, bottle)
	if (!execute) {
		return {
			action: existing?._id ? 'update' : 'create',
			existing_id: existing?._id || '',
			doc: bottle
		}
	}
	if (existing?._id) {
		const res = await callCrm(client, crmToken, 'crm-bottle', 'updateV1', {
			_id: existing._id,
			...bottle
		})
		if (res?.code !== 0) throw new Error(`钢瓶更新失败 ${bottle.bottle_no}: ${JSON.stringify(res)}`)
		return { action: 'update', _id: existing._id, doc: bottle }
	}
	const res = await callCrm(client, crmToken, 'crm-bottle', 'createV1', bottle)
	if (res?.code !== 0) throw new Error(`钢瓶创建失败 ${bottle.bottle_no}: ${JSON.stringify(res)}`)
	return { action: 'create', _id: res?.data?._id || res?.id || '', doc: bottle }
}

function writeQrOutputs(customerResult, bottleResults) {
	const rows = [
		{
			type: 'customer',
			label: TEST_CUSTOMER.name,
			code: normalizeCode(TEST_CUSTOMER.qr_code),
			_id: customerResult?._id || customerResult?.existing_id || ''
		},
		...bottleResults.map((item) => ({
			type: 'bottle',
			label: normalizeBottleNo(item.doc.bottle_no),
			code: normalizeCode(item.doc.pda_qr_code),
			_id: item?._id || item?.existing_id || '',
			tare_weight: item.doc.tare_weight
		}))
	]
	const manifest = {
		generated_at: new Date().toISOString(),
		output_dir: OUTPUT_DIR,
		size: '300x300',
		customer: {
			_id: rows[0]._id,
			name: TEST_CUSTOMER.name,
			phone: TEST_CUSTOMER.phone,
			default_price_unit: TEST_CUSTOMER.default_price_unit,
			default_unit_price: TEST_CUSTOMER.default_unit_price,
			qr_code: TEST_CUSTOMER.qr_code
		},
		bottles: rows.slice(1).map((row) => ({
			_id: row._id,
			bottle_no: row.label,
			pda_qr_code: row.code,
			tare_weight: row.tare_weight
		})),
		files: []
	}
	fs.mkdirSync(OUTPUT_DIR, { recursive: true })
	rows.forEach((row, index) => {
		const fileName = `${String(index + 1).padStart(2, '0')}_${row.type}_${sanitizeFilePart(row.label)}.png`
		const filePath = path.join(OUTPUT_DIR, fileName)
		writeQrPng(filePath, row.code, 300)
		manifest.files.push({
			type: row.type,
			label: row.label,
			code: row.code,
			file: fileName
		})
	})
	writeJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest)
	fs.writeFileSync(
		path.join(OUTPUT_DIR, 'README.txt'),
		[
			'PDA 吊秤销售闭环测试二维码',
			'',
			`客户二维码: ${TEST_CUSTOMER.qr_code}`,
			...TEST_BOTTLES.map((item) => `钢瓶二维码: ${item.bottle_no} -> ${item.pda_qr_code}，皮重 ${item.tare_weight}kg`),
			'',
			'说明: 二维码内容必须与云端 qr_code / pda_qr_code 字段一致。'
		].join('\n'),
		'utf8'
	)
	return manifest
}

async function main() {
	const options = parseStandardArgs(process.argv, {})
	if (!options.spaceId) options.spaceId = DEFAULT_SPACE_ID
	const { client } = await prepareClientOptions(options)
	const crmToken = await ensureCrmToken(client, options)
	const customerResult = await upsertCustomer(client, crmToken, options.execute)
	const bottleResults = []
	for (const bottle of TEST_BOTTLES) {
		bottleResults.push(await upsertBottle(client, crmToken, bottle, options.execute))
	}
	const manifest = writeQrOutputs(customerResult, bottleResults)
	console.log(JSON.stringify({
		execute: options.execute,
		space_id: options.spaceId,
		customer: customerResult,
		bottles: bottleResults,
		qr_output_dir: manifest.output_dir
	}, null, 2))
}

main().catch((error) => {
	console.error(error && error.stack ? error.stack : error)
	process.exit(1)
})
