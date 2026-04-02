#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ALLOWED_RECORD_TYPES = new Set(['normal_fill', 'truck_out_agent_sale', 'truck_out_no_sale'])

function parseArgs(argv) {
	const args = {
		input: '',
		output: '',
		outputArray: '',
		report: '',
		dedupPolicy: 'oldest',
		dropBottleZero: false
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
	if (typeof args.dropBottleZero === 'string') {
		args.dropBottleZero = args.dropBottleZero !== 'false'
	}
	return args
}

function toText(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
}

function unwrapId(value) {
	if (value == null) return ''
	if (typeof value === 'string') return value.trim()
	if (typeof value === 'number') return String(value)
	if (typeof value === 'object') {
		if (typeof value.$oid === 'string') return value.$oid.trim()
		if (typeof value._id === 'string') return value._id.trim()
	}
	return ''
}

function normalizeBottleNo(value) {
	return toText(value).toUpperCase().replace(/\s+/g, '')
}

function normalizePlateNo(value) {
	return toText(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeRecordType(value) {
	const text = toText(value).toLowerCase()
	if (!text) return 'normal_fill'
	if (ALLOWED_RECORD_TYPES.has(text)) return text
	if (text.includes('agent')) return 'truck_out_agent_sale'
	if (text.includes('no_sale') || text.includes('nosale')) return 'truck_out_no_sale'
	if (text.includes('normal')) return 'normal_fill'
	return 'normal_fill'
}

function toTimestamp(value, fallback = Date.now()) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
	if (typeof value === 'string' && value.trim()) {
		const asNum = Number(value)
		if (Number.isFinite(asNum) && asNum > 0) return asNum
		const asDate = Date.parse(value)
		if (Number.isFinite(asDate) && asDate > 0) return asDate
	}
	return fallback
}

function formatCNDateTime(ts) {
	const date = new Date(Number(ts || Date.now()))
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	const hh = String(date.getUTCHours()).padStart(2, '0')
	const mm = String(date.getUTCMinutes()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}`
}

function normalizeDateText(value, fallbackTs) {
	const text = toText(value)
	if (text) return text.replace(/\//g, '-')
	return formatCNDateTime(toTimestamp(fallbackTs, Date.now()))
}

function parseRows(text, filePath) {
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
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i].trim()
			if (!line) continue
			try {
				rows.push(JSON.parse(line))
			} catch (err) {
				badLines.push({
					file: filePath,
					line: i + 1,
					content_preview: line.slice(0, 140),
					error: err && err.message ? err.message : 'JSON parse error'
				})
			}
		}
		return { rows, parseMode: 'ndjson', badLines }
	}
}

function pickRow(a, b, policy) {
	const leftUpdated = Number(a.updated_at || 0)
	const rightUpdated = Number(b.updated_at || 0)
	if (leftUpdated !== rightUpdated) return policy === 'newest' ? (leftUpdated > rightUpdated ? a : b) : (leftUpdated < rightUpdated ? a : b)
	const leftCreated = Number(a.created_at || 0)
	const rightCreated = Number(b.created_at || 0)
	if (leftCreated !== rightCreated) return policy === 'newest' ? (leftCreated > rightCreated ? a : b) : (leftCreated < rightCreated ? a : b)
	const leftOrder = Number(a.__source_order || 0)
	const rightOrder = Number(b.__source_order || 0)
	return policy === 'newest' ? (leftOrder > rightOrder ? a : b) : (leftOrder < rightOrder ? a : b)
}

function writeNdjson(filePath, rows) {
	const content = rows.map((row) => JSON.stringify(row)).join('\n')
	fs.writeFileSync(filePath, content ? `${content}\n` : '', 'utf8')
}

function summarizeReasons(items) {
	const map = new Map()
	for (const item of items) {
		const reason = toText(item.reason) || 'unknown'
		map.set(reason, (map.get(reason) || 0) + 1)
	}
	return Object.fromEntries(Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])))
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.input) {
		throw new Error('缺少 --input 参数')
	}
	const inputPath = path.resolve(process.cwd(), args.input)
	const baseName = path.basename(inputPath).replace(/\.json$/i, '')
	const outputPath = path.resolve(process.cwd(), args.output || `docs/${baseName}.cleaned.ndjson`)
	const outputArrayPath = path.resolve(process.cwd(), args.outputArray || `docs/${baseName}.cleaned.array.json`)
	const reportPath = path.resolve(process.cwd(), args.report || `docs/${baseName}.cleaned.report.json`)
	const dedupPolicy = toText(args.dedupPolicy).toLowerCase() === 'newest' ? 'newest' : 'oldest'
	const dropBottleZero = Boolean(args.dropBottleZero)

	const sourceText = fs.readFileSync(inputPath, 'utf8')
	const parsed = parseRows(sourceText, inputPath)

	const dropped = []
	const transformed = []
	const recordTypeSource = { normal_fill: 0, truck_out_agent_sale: 0, truck_out_no_sale: 0 }
	let filledBottleNoFromVehicleTotal = 0
	for (let i = 0; i < parsed.rows.length; i += 1) {
		const row = parsed.rows[i] || {}
		const recordType = normalizeRecordType(row.record_type)
		recordTypeSource[recordType] += 1
		let bottleNoRaw = normalizeBottleNo(row.bottle_no)
		if (recordType === 'truck_out_no_sale' && !bottleNoRaw) {
			const plate = normalizePlateNo(row.vehicle_no || row.car_no || row.truck_no)
			if (plate) {
				bottleNoRaw = plate
				filledBottleNoFromVehicleTotal += 1
			}
		}
		const bottleNo = bottleNoRaw === '0' ? '0' : bottleNoRaw
		const fillWeight = toNumber(
			row.fill_weight != null ? row.fill_weight : (row.net_fill != null ? row.net_fill : row.out_net),
			null
		)
		const createdAt = toTimestamp(row.created_at, toTimestamp(row.timestamp, Date.now()))
		const updatedAt = toTimestamp(row.updated_at, createdAt)
		const sourceId = unwrapId(row._id)
		const inventoryLinked = recordType === 'normal_fill' || recordType === 'truck_out_agent_sale'

		if (dropBottleZero && bottleNo === '0') {
			dropped.push({ reason: 'bottle_no_zero', sourceId, date: toText(row.date), record_type: recordType })
			continue
		}
		if (inventoryLinked && !bottleNo) {
			dropped.push({ reason: 'missing_bottle_no_inventory_linked', sourceId, date: toText(row.date), record_type: recordType })
			continue
		}
		if (!(fillWeight > 0)) {
			dropped.push({ reason: 'invalid_fill_weight', sourceId, bottle_no: bottleNo, date: toText(row.date), record_type: recordType })
			continue
		}

		const operator = toText(row.operator || row.created_by_name)
		transformed.push({
			_id: sourceId || undefined,
			date: normalizeDateText(row.date, createdAt),
			bottle_no: bottleNo,
			fill_weight: fillWeight,
			record_type: recordType,
			remark: toText(row.remark),
			operator,
			operator_id: unwrapId(row.operator_id) || null,
			created_at: createdAt,
			updated_at: updatedAt,
			created_by: unwrapId(row.created_by || row.operator_id) || null,
			created_by_name: toText(row.created_by_name || operator),
			__source_order: i + 1
		})
	}

	const byId = new Map()
	const dedupByIdDropped = []
	for (const row of transformed) {
		const key = toText(row._id)
		if (!key) continue
		const prev = byId.get(key)
		if (!prev) {
			byId.set(key, row)
			continue
		}
		const keep = pickRow(prev, row, dedupPolicy)
		const drop = keep === prev ? row : prev
		byId.set(key, keep)
		dedupByIdDropped.push({
			reason: 'duplicate_id',
			_id: key,
			drop_date: drop.date,
			drop_bottle_no: drop.bottle_no
		})
	}

	const afterIdDedup = transformed.filter((row) => {
		const key = toText(row._id)
		if (!key) return true
		return byId.get(key) === row
	})

	const keyGroups = new Map()
	for (const row of afterIdDedup) {
		if (!row.bottle_no) continue
		const key = `${row.date}|${row.bottle_no}`
		if (!keyGroups.has(key)) keyGroups.set(key, [])
		keyGroups.get(key).push(row)
	}

	const dedupByBusinessDropped = []
	const keepSet = new Set()
	const duplicateGroups = []
	for (const [key, arr] of keyGroups.entries()) {
		if (arr.length <= 1) {
			keepSet.add(arr[0])
			continue
		}
		let keep = arr[0]
		for (let i = 1; i < arr.length; i += 1) keep = pickRow(keep, arr[i], dedupPolicy)
		keepSet.add(keep)
		const [date, bottleNo] = key.split('|')
		duplicateGroups.push({ date, bottle_no: bottleNo, count: arr.length })
		for (const row of arr) {
			if (row === keep) continue
			dedupByBusinessDropped.push({
				reason: 'duplicate_exact_datetime_bottle',
				date: row.date,
				bottle_no: row.bottle_no,
				_id: row._id || ''
			})
		}
	}

	const noBottleRows = afterIdDedup.filter((row) => !row.bottle_no)
	for (const row of noBottleRows) keepSet.add(row)

	const cleaned = afterIdDedup
		.filter((row) => keepSet.has(row))
		.map((row) => {
			const out = { ...row }
			delete out.__source_order
			if (!out._id) delete out._id
			return out
		})

	cleaned.sort((a, b) => {
		if (a.date !== b.date) return String(a.date).localeCompare(String(b.date))
		if (a.bottle_no !== b.bottle_no) return String(a.bottle_no).localeCompare(String(b.bottle_no), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
		return Number(a.created_at || 0) - Number(b.created_at || 0)
	})

	const typeDistCleaned = { normal_fill: 0, truck_out_agent_sale: 0, truck_out_no_sale: 0 }
	for (const row of cleaned) typeDistCleaned[row.record_type] += 1

	const report = {
		generated_at: new Date().toISOString(),
		input: inputPath,
		parse_mode: parsed.parseMode,
		parse_bad_line_count: parsed.badLines.length,
		parse_bad_lines_preview: parsed.badLines.slice(0, 20),
		config: {
			dedup_policy: dedupPolicy,
			drop_bottle_zero: dropBottleZero
		},
		stats: {
			source_rows: parsed.rows.length,
			transformed_rows: transformed.length,
			cleaned_rows: cleaned.length,
			dropped_rows: dropped.length + dedupByIdDropped.length + dedupByBusinessDropped.length,
			record_type_source: recordTypeSource,
			record_type_cleaned: typeDistCleaned,
			no_sale_bottle_no_filled_from_vehicle_total: filledBottleNoFromVehicleTotal,
			duplicate_group_count: duplicateGroups.length,
			duplicate_extra_row_count: dedupByBusinessDropped.length,
			dedup_by_id_removed: dedupByIdDropped.length
		},
		drop_summary: {
			precheck_drop: summarizeReasons(dropped),
			dedup_drop: summarizeReasons([...dedupByIdDropped, ...dedupByBusinessDropped])
		},
		dropped_preview: {
			precheck: dropped.slice(0, 30),
			dedup: [...dedupByIdDropped, ...dedupByBusinessDropped].slice(0, 30)
		},
		duplicate_groups_preview: duplicateGroups.slice(0, 30),
		output: {
			ndjson: outputPath,
			json_array: outputArrayPath
		}
	}

	fs.mkdirSync(path.dirname(outputPath), { recursive: true })
	fs.mkdirSync(path.dirname(outputArrayPath), { recursive: true })
	fs.mkdirSync(path.dirname(reportPath), { recursive: true })
	writeNdjson(outputPath, cleaned)
	fs.writeFileSync(outputArrayPath, JSON.stringify(cleaned, null, 2), 'utf8')
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

	console.log(JSON.stringify({
		ok: true,
		input: inputPath,
		output: {
			ndjson: outputPath,
			json_array: outputArrayPath,
			report: reportPath
		},
		stats: report.stats
	}, null, 2))
}

main()
