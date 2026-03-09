#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REQUIRED_EXPORTS = [
	{ key: 'users', collection: 'crm_users', file: 'about_crm_users.json', required: true },
	{ key: 'operation_logs', collection: 'crm_operation_logs', file: 'about_crm_operation_logs.json', required: true },
	{ key: 'customers', collection: 'crm_customers', file: 'about_crm_customers.json', required: true },
	{ key: 'vehicles', collection: 'crm_vehicles', file: 'about_crm_vehicles.json', required: true },
	{ key: 'deliveries', collection: 'crm_delivery_men', file: 'about_crm_delivery_men.json', required: true },
	{ key: 'bottles', collection: 'crm_bottles', file: 'about_crm_bottles.json', required: true },
	{ key: 'fillings', collection: 'crm_filling_records', file: 'about_crm_filling_records.json', required: true },
	{ key: 'sales', collection: 'crm_sale_records', file: 'about_crm_sale_records.json', required: true },
	{ key: 'bottle_anomalies', collection: 'crm_bottle_anomalies', file: 'about_crm_bottle_anomalies.json', required: true },
	{ key: 'gas_in', collection: 'crm_gas_in', file: 'about_crm_gas_in.json', required: true }
]

const CONVERTER_REQUIRED_KEYS = ['customers', 'vehicles', 'bottles', 'fillings', 'sales']
const BASELINE_DATE = '2026-01-14'
const TARGET_SALE_DATE = '2026-02-04'
const TARGET_CUSTOMER = '新乐新天下塑业'

function parseArgs(argv) {
	const args = {
		inputDir: '/Users/wangbo/Downloads/legacy_full_export_20260206',
		outputDir: path.resolve(process.cwd(), 'state/import/legacy_v2_to_v4'),
		skipConvert: false,
		allowPartial: false
	}
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i]
		if (!token.startsWith('--')) continue
		const key = token.slice(2)
		const value = argv[i + 1]
		if (!value || value.startsWith('--')) {
			args[key] = true
			continue
		}
		args[key] = value
		i += 1
	}
	if (args.inputDir) args.inputDir = path.resolve(process.cwd(), args.inputDir)
	if (args.outputDir) args.outputDir = path.resolve(process.cwd(), args.outputDir)
	if (args.manifestOut) args.manifestOut = path.resolve(process.cwd(), args.manifestOut)
	if (args.allowPartial === 'true') args.allowPartial = true
	if (args.skipConvert === 'true') args.skipConvert = true
	return args
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true })
}

function toText(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number') return String(value)
	if (typeof value === 'object' && typeof value.$oid === 'string') return value.$oid
	return ''
}

function parseDateYYYYMMDD(value) {
	const text = toText(value)
	if (!text) return ''
	return text.slice(0, 10)
}

function parseLegacyRows(text, filePath) {
	const body = String(text || '').trim()
	if (!body) return { rows: [], parseMode: 'empty', badLines: [] }

	try {
		const parsed = JSON.parse(body)
		if (Array.isArray(parsed)) return { rows: parsed, parseMode: 'json-array', badLines: [] }
		if (parsed && Array.isArray(parsed.data)) return { rows: parsed.data, parseMode: 'json-object-data', badLines: [] }
		if (parsed && Array.isArray(parsed.list)) return { rows: parsed.list, parseMode: 'json-object-list', badLines: [] }
		return { rows: [parsed], parseMode: 'json-object', badLines: [] }
	} catch (_) {
		const rows = []
		const badLines = []
		const lines = body.split(/\r?\n/)
		lines.forEach((line, index) => {
			const current = line.trim()
			if (!current) return
			try {
				rows.push(JSON.parse(current))
			} catch (err) {
				badLines.push({
					file: filePath,
					line: index + 1,
					error: err && err.message ? err.message : 'JSON parse error',
					content_preview: current.slice(0, 120)
				})
			}
		})
		return { rows, parseMode: 'ndjson', badLines }
	}
}

function sha256File(filePath) {
	const content = fs.readFileSync(filePath)
	return crypto.createHash('sha256').update(content).digest('hex')
}

function sample200Parse(filePath) {
	const text = fs.readFileSync(filePath, 'utf8')
	const lines = text.split(/\r?\n/).filter(Boolean)
	const sample = lines.slice(0, 200)
	for (const line of sample) {
		JSON.parse(line)
	}
	return { sampled: sample.length, ok: true }
}

function calcDateRange(rows) {
	let min = '9999-99-99'
	let max = '0000-00-00'
	let count = 0
	for (const row of rows) {
		const date = parseDateYYYYMMDD(row && row.date)
		if (!date) continue
		count += 1
		if (date < min) min = date
		if (date > max) max = date
	}
	return {
		date_count: count,
		date_min: count > 0 ? min : null,
		date_max: count > 0 ? max : null
	}
}

function deriveTruckCodeFromPlate(plateNo) {
	const plate = toText(plateNo).toUpperCase()
	if (!plate || plate.length <= 2) return ''
	const suffix = plate.slice(2).replace(/\s+/g, '')
	if (!suffix) return ''
	return `TRUCK-${suffix}`
}

function collectSaleTruckMarkers(row) {
	const hits = []
	const pushHit = (field, value) => {
		const text = toText(value)
		if (!text) return
		if (!/TRUCK/i.test(text)) return
		hits.push({ field, value: text })
	}

	pushHit('truck_no', row && row.truck_no)
	pushHit('bottle_no', row && row.bottle_no)
	pushHit('return_bottle_no', row && row.return_bottle_no)

	const scanArray = (arr, field) => {
		const list = Array.isArray(arr) ? arr : []
		for (const item of list) {
			pushHit(field, item && item.bottle_no)
		}
	}
	scanArray(row && row.out_items, 'out_items.bottle_no')
	scanArray(row && row.back_items, 'back_items.bottle_no')
	scanArray(row && row.deposit_rows, 'deposit_rows.bottle_no')
	return hits
}

function classifyTruckLiteral(text) {
	const upper = toText(text).toUpperCase()
	if (upper === 'TRUCK-NO') return 'placeholder'
	if (/^TRUCK-[A-Z0-9]+$/.test(upper)) return 'truck_code'
	return 'other_truck_text'
}

function buildTruckOutNoSaleEvents(fillingsRows, bottleSet) {
	const events = fillingsRows
		.filter((row) => toText(row && row.record_type) === 'truck_out_no_sale')
		.map((row) => {
			const derivedCode = deriveTruckCodeFromPlate(row && row.vehicle_no)
			return {
				_id: normalizeId(row && row._id),
				date: toText(row && row.date),
				timestamp: row && row.timestamp != null ? Number(row.timestamp) : null,
				vehicle_no: toText(row && row.vehicle_no),
				vehicle_id: normalizeId(row && row.vehicle_id),
				out_net: row && row.out_net != null ? Number(row.out_net) : null,
				operator: toText(row && row.operator),
				operator_id: normalizeId(row && row.operator_id),
				remark: toText(row && row.remark),
				derived_truck_code: derivedCode || null,
				derived_truck_code_exists_in_bottles: derivedCode ? bottleSet.has(derivedCode) : false
			}
		})
	events.sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.timestamp || 0) - Number(b.timestamp || 0))
	return {
		summary: {
			total: events.length,
			date_min: events.length ? events[0].date : null,
			date_max: events.length ? events[events.length - 1].date : null,
			out_net_sum: events.reduce((sum, row) => sum + Number(row.out_net || 0), 0)
		},
		events
	}
}

function buildTruckLiteralAudit(salesRows, bottleSet) {
	const entries = []
	for (const row of salesRows) {
		const hits = collectSaleTruckMarkers(row)
		if (!hits.length) continue
		for (const hit of hits) {
			const cls = classifyTruckLiteral(hit.value)
			const code = cls === 'truck_code' ? toText(hit.value).toUpperCase() : ''
			const derivedFromCar = deriveTruckCodeFromPlate(row && row.car_no)
			const traceable = cls === 'truck_code' ? (bottleSet.has(code) || (derivedFromCar && derivedFromCar === code)) : false
			entries.push({
				_id: normalizeId(row && row._id),
				date: toText(row && row.date),
				customer_name: toText(row && row.customer_name),
				biz_mode: toText(row && row.biz_mode),
				car_no: toText(row && row.car_no),
				field: hit.field,
				value: hit.value,
				classification: cls,
				traceable,
				bottle_exists: cls === 'truck_code' ? bottleSet.has(code) : false,
				derived_from_car_no: derivedFromCar || null
			})
		}
	}

	const summary = {
		total_hits: entries.length,
		affected_records: new Set(entries.map((item) => item._id).filter(Boolean)).size,
		placeholder_hits: entries.filter((item) => item.classification === 'placeholder').length,
		truck_code_hits: entries.filter((item) => item.classification === 'truck_code').length,
		other_truck_text_hits: entries.filter((item) => item.classification === 'other_truck_text').length,
		traceable_hits: entries.filter((item) => item.traceable).length,
		untraceable_hits: entries.filter((item) => !item.traceable).length
	}
	return { summary, entries }
}

function runConverter(args, inputDir, outputDir) {
	if (args.skipConvert) {
		return { ran: false, ok: true, reason: 'skip_convert' }
	}
	const converterPath = path.resolve(__dirname, 'convertLegacyExport.cjs')
	const res = spawnSync('node', [converterPath, '--inputDir', inputDir, '--outputDir', outputDir], {
		encoding: 'utf8'
	})
	if (res.status !== 0) {
		return {
			ran: true,
			ok: false,
			status: res.status,
			stdout: res.stdout || '',
			stderr: res.stderr || ''
		}
	}
	return {
		ran: true,
		ok: true,
		status: 0,
		stdout: res.stdout || ''
	}
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	ensureDir(args.outputDir)

	const parsedByKey = {}
	const fileEntries = []
	const parseWarnings = []
	const missingRequired = []

	for (const item of REQUIRED_EXPORTS) {
		const filePath = path.join(args.inputDir, item.file)
		const exists = fs.existsSync(filePath)
		if (!exists) {
			const entry = {
				collection: item.collection,
				file: item.file,
				path: filePath,
				required: item.required,
				exists: false,
				rows: 0,
				parse_mode: 'missing',
				date_min: null,
				date_max: null,
				sha256: null,
				size_bytes: 0,
				sample_200_ok: false
			}
			fileEntries.push(entry)
			if (item.required) missingRequired.push(item.file)
			continue
		}

		const text = fs.readFileSync(filePath, 'utf8')
		const parsed = parseLegacyRows(text, filePath)
		parsedByKey[item.key] = parsed
		parseWarnings.push(...parsed.badLines)

		let sample = { sampled: 0, ok: true }
		try {
			sample = sample200Parse(filePath)
		} catch (err) {
			sample = { sampled: 0, ok: false, error: err && err.message ? err.message : 'sample parse failed' }
		}

		const dateRange = calcDateRange(parsed.rows)
		fileEntries.push({
			collection: item.collection,
			file: item.file,
			path: filePath,
			required: item.required,
			exists: true,
			rows: parsed.rows.length,
			parse_mode: parsed.parseMode,
			date_min: dateRange.date_min,
			date_max: dateRange.date_max,
			date_count: dateRange.date_count,
			sha256: sha256File(filePath),
			size_bytes: fs.statSync(filePath).size,
			sample_200_ok: sample.ok,
			sample_200_size: sample.sampled,
			sample_200_error: sample.error || null
		})
	}

	const salesRows = (parsedByKey.sales && parsedByKey.sales.rows) || []
	const fillingsRows = (parsedByKey.fillings && parsedByKey.fillings.rows) || []
	const bottlesRows = (parsedByKey.bottles && parsedByKey.bottles.rows) || []
	const bottleSet = new Set(
		bottlesRows
			.map((row) => toText(row && (row.number || row.bottle_no)).toUpperCase())
			.filter(Boolean)
	)

	const salesEntry = fileEntries.find((item) => item.collection === 'crm_sale_records')
	const fillingsEntry = fileEntries.find((item) => item.collection === 'crm_filling_records')
	const hasSalesAfterBaseline = Boolean(salesEntry && salesEntry.date_max && salesEntry.date_max > BASELINE_DATE)
	const hasFillingsAfterBaseline = Boolean(fillingsEntry && fillingsEntry.date_max && fillingsEntry.date_max > BASELINE_DATE)
	const hasSalesOnTargetDate = salesRows.some((row) => parseDateYYYYMMDD(row && row.date) === TARGET_SALE_DATE)
	const hasTargetCustomerTruckSale = salesRows.some((row) => {
		if (!toText(row && row.customer_name).includes(TARGET_CUSTOMER)) return false
		return collectSaleTruckMarkers(row).length > 0
	})

	const validations = {
		sales_date_max_gt_2026_01_14: hasSalesAfterBaseline,
		fillings_date_max_gt_2026_01_14: hasFillingsAfterBaseline,
		sales_contains_2026_02_04: hasSalesOnTargetDate,
		sales_contains_target_customer_truck_record: hasTargetCustomerTruckSale
	}

	const truckOutNoSale = buildTruckOutNoSaleEvents(fillingsRows, bottleSet)
	const truckLiteralAudit = buildTruckLiteralAudit(salesRows, bottleSet)
	const truckOutNoSalePath = path.join(args.outputDir, 'truck_out_no_sale_events.json')
	const truckLiteralAuditPath = path.join(args.outputDir, 'truck_literal_audit.json')
	fs.writeFileSync(truckOutNoSalePath, `${JSON.stringify(truckOutNoSale, null, 2)}\n`, 'utf8')
	fs.writeFileSync(truckLiteralAuditPath, `${JSON.stringify(truckLiteralAudit, null, 2)}\n`, 'utf8')

	let converter = { ran: false, ok: true, reason: 'not_started' }
	const converterMissing = CONVERTER_REQUIRED_KEYS
		.filter((key) => !parsedByKey[key] || !Array.isArray(parsedByKey[key].rows))
		.map((key) => REQUIRED_EXPORTS.find((item) => item.key === key)?.file || key)

	if (!converterMissing.length) {
		converter = runConverter(args, args.inputDir, args.outputDir)
	} else {
		converter = { ran: false, ok: false, reason: 'missing_converter_inputs', missing: converterMissing }
	}

	const manifest = {
		generated_at: new Date().toISOString(),
		input_dir: args.inputDir,
		output_dir: args.outputDir,
		files: fileEntries,
		parse_warning_count: parseWarnings.length,
		parse_warnings_preview: parseWarnings.slice(0, 50),
		missing_required_files: missingRequired,
		validations,
		truck_outputs: {
			truck_out_no_sale_events: truckOutNoSalePath,
			truck_literal_audit: truckLiteralAuditPath
		},
		converter
	}

	const manifestOutPath = args.manifestOut || path.join(args.inputDir, 'manifest.json')
	ensureDir(path.dirname(manifestOutPath))
	fs.writeFileSync(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

	const shouldFail =
		(!args.allowPartial && missingRequired.length > 0)
		|| (!args.allowPartial && Object.values(validations).some((ok) => !ok))
		|| (!args.allowPartial && !converter.ok)

	console.log(JSON.stringify({
		manifest: manifestOutPath,
		missing_required_files: missingRequired,
		validations,
		truck_out_no_sale_events: truckOutNoSalePath,
		truck_literal_audit: truckLiteralAuditPath,
		converter
	}, null, 2))

	if (shouldFail) {
		process.exit(2)
	}
}

main()
