#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_CSV = 'docs/test0314.cleaned_for_upload.csv'
const DEFAULT_OUTPUT = 'uniCloud-alipay/database/crm_bottles.init_data.json'
const DEFAULT_META = 'docs/test0314.init.meta.json'
const DEFAULT_IDS = 'docs/test0314.rollback_ids.json'
const CYCLE_MONTHS = [6, 12, 24, 36]

function parseArgs(argv) {
	const now = new Date()
	const y = now.getUTCFullYear()
	const m = String(now.getUTCMonth() + 1).padStart(2, '0')
	const d = String(now.getUTCDate()).padStart(2, '0')
	const hh = String(now.getUTCHours()).padStart(2, '0')
	const mm = String(now.getUTCMinutes()).padStart(2, '0')

	const args = {
		csv: DEFAULT_CSV,
		output: DEFAULT_OUTPUT,
		meta: DEFAULT_META,
		ids: DEFAULT_IDS,
		idPrefix: 'imp0314',
		batchId: `import:test0314:env-00jxuffegf2n:${y}${m}${d}${hh}${mm}`,
		scrapYears: 20
	}

	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--csv' && next) {
			args.csv = next
			i += 1
		} else if (cur === '--output' && next) {
			args.output = next
			i += 1
		} else if (cur === '--meta' && next) {
			args.meta = next
			i += 1
		} else if (cur === '--ids' && next) {
			args.ids = next
			i += 1
		} else if (cur === '--id-prefix' && next) {
			args.idPrefix = next
			i += 1
		} else if (cur === '--batch-id' && next) {
			args.batchId = next
			i += 1
		} else if (cur === '--scrap-years' && next) {
			args.scrapYears = Number(next) || 20
			i += 1
		} else if (cur === '--help' || cur === '-h') {
			printHelp()
			process.exit(0)
		}
	}

	return args
}

function printHelp() {
	console.log(`
Usage:
  node scripts/exportBottlesInitData.cjs [options]

Options:
  --csv <path>           CSV input path (default: ${DEFAULT_CSV})
  --output <path>        JSON output path (default: ${DEFAULT_OUTPUT})
  --meta <path>          Meta report path (default: ${DEFAULT_META})
  --ids <path>           Rollback ids path (default: ${DEFAULT_IDS})
  --id-prefix <text>     _id prefix (default: imp0314)
  --batch-id <text>      Batch id written to remark
  --scrap-years <num>    Scrap date = manufacture date + years (default: 20)
`)
}

function parseCsvLine(line) {
	const out = []
	let cur = ''
	let inQuote = false
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i]
		if (ch === '"') {
			if (inQuote && line[i + 1] === '"') {
				cur += '"'
				i += 1
			} else {
				inQuote = !inQuote
			}
		} else if (ch === ',' && !inQuote) {
			out.push(cur)
			cur = ''
		} else {
			cur += ch
		}
	}
	out.push(cur)
	return out
}

function parseCsv(content) {
	const lines = content
		.split(/\r?\n/)
		.filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
	if (lines.length < 2) throw new Error('CSV 至少需要表头和 1 行数据')
	const headers = parseCsvLine(lines[0]).map((item) => item.trim())
	const rows = []
	for (let i = 1; i < lines.length; i += 1) {
		const cols = parseCsvLine(lines[i])
		const row = {}
		for (let j = 0; j < headers.length; j += 1) row[headers[j]] = (cols[j] || '').trim()
		rows.push({ row, lineNo: i + 1 })
	}
	return rows
}

function normalizeText(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeCode(value) {
	return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

function toNullableNumber(value) {
	const text = normalizeText(value)
	if (!text) return null
	const num = Number(text)
	return Number.isFinite(num) ? num : NaN
}

function parseDateString(value) {
	const text = normalizeText(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
	const [y, m, d] = text.split('-').map((x) => Number(x))
	if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
	if (m < 1 || m > 12) return null
	const max = new Date(Date.UTC(y, m, 0)).getUTCDate()
	if (d < 1 || d > max) return null
	return new Date(Date.UTC(y, m - 1, d))
}

function formatDate(date) {
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function addMonths(base, months) {
	const y = base.getUTCFullYear()
	const m = base.getUTCMonth()
	const d = base.getUTCDate()
	const nextMonthIndex = m + months
	const nextYear = y + Math.floor(nextMonthIndex / 12)
	const nextMonth = ((nextMonthIndex % 12) + 12) % 12
	const maxDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate()
	return new Date(Date.UTC(nextYear, nextMonth, Math.min(d, maxDay)))
}

function diffDays(a, b) {
	const dayMs = 24 * 60 * 60 * 1000
	return Math.round((b.getTime() - a.getTime()) / dayMs)
}

function inferCycleMonths(checkDateText, nextDateText, fallback) {
	const check = parseDateString(checkDateText)
	const next = parseDateString(nextDateText)
	if (!check || !next) return fallback
	let best = fallback
	let bestDiff = Number.POSITIVE_INFINITY
	CYCLE_MONTHS.forEach((months) => {
		const expected = addMonths(check, months)
		const delta = Math.abs(diffDays(expected, next))
		if (delta < bestDiff) {
			best = months
			bestDiff = delta
		}
	})
	return best
}

function mapStatus(raw) {
	const text = normalizeText(raw)
	if (!text) return 'unknown'
	if (['在用', '在站', '站内', '库内'].includes(text)) return 'in_station'
	if (['在客户', '客户处'].includes(text)) return 'at_customer'
	if (['报废'].includes(text)) return 'scrapped'
	if (['丢失', '遗失'].includes(text)) return 'lost'
	return 'unknown'
}

function ensureField(row, field, lineNo, errors) {
	if (!normalizeText(row[field])) errors.push(`第 ${lineNo} 行缺少字段：${field}`)
}

function makeId(prefix, serial) {
	return `${prefix}_${String(serial).padStart(5, '0')}`
}

function buildDoc(row, lineNo, serial, options) {
	ensureField(row, '充装单位', lineNo, options.errors)
	ensureField(row, '登记证编号', lineNo, options.errors)
	ensureField(row, '设备品种', lineNo, options.errors)
	ensureField(row, '单位内编号', lineNo, options.errors)
	ensureField(row, '产品编号', lineNo, options.errors)
	ensureField(row, '二维码号', lineNo, options.errors)
	ensureField(row, '制造日期', lineNo, options.errors)
	ensureField(row, '钢瓶检验日期', lineNo, options.errors)
	ensureField(row, '钢瓶下次检验日期', lineNo, options.errors)
	ensureField(row, '压力表表号', lineNo, options.errors)
	ensureField(row, '压力值最小', lineNo, options.errors)
	ensureField(row, '压力值最大', lineNo, options.errors)
	ensureField(row, '压力表检验日期', lineNo, options.errors)
	ensureField(row, '压力表下次检验日期', lineNo, options.errors)
	ensureField(row, '安全阀检测日期', lineNo, options.errors)
	ensureField(row, '安全阀下次检验日期', lineNo, options.errors)
	ensureField(row, '容积(L)', lineNo, options.errors)

	const manufactureDate = normalizeText(row['制造日期'])
	const bottleCheckDate = normalizeText(row['钢瓶检验日期'])
	const bottleNextCheckDate = normalizeText(row['钢瓶下次检验日期'])
	const gaugeCheckDate = normalizeText(row['压力表检验日期'])
	const gaugeNextCheckDate = normalizeText(row['压力表下次检验日期'])
	const valveCheckDate = normalizeText(row['安全阀检测日期'])
	const valveNextCheckDate = normalizeText(row['安全阀下次检验日期'])

	const volumeL = toNullableNumber(row['容积(L)'])
	const pressureMin = toNullableNumber(row['压力值最小'])
	const pressureMax = toNullableNumber(row['压力值最大'])
	const tareWeight = toNullableNumber(row['皮重'])

	if (!parseDateString(manufactureDate)) options.errors.push(`第 ${lineNo} 行制造日期格式无效`)
	if (!parseDateString(bottleCheckDate)) options.errors.push(`第 ${lineNo} 行钢瓶检验日期格式无效`)
	if (!parseDateString(bottleNextCheckDate)) options.errors.push(`第 ${lineNo} 行钢瓶下次检验日期格式无效`)
	if (!parseDateString(gaugeCheckDate)) options.errors.push(`第 ${lineNo} 行压力表检验日期格式无效`)
	if (!parseDateString(gaugeNextCheckDate)) options.errors.push(`第 ${lineNo} 行压力表下次检验日期格式无效`)
	if (!parseDateString(valveCheckDate)) options.errors.push(`第 ${lineNo} 行安全阀检测日期格式无效`)
	if (!parseDateString(valveNextCheckDate)) options.errors.push(`第 ${lineNo} 行安全阀下次检验日期格式无效`)

	if (!(typeof volumeL === 'number' && Number.isFinite(volumeL) && volumeL > 0)) {
		options.errors.push(`第 ${lineNo} 行容积必须为大于0数字`)
	}
	if (!(typeof pressureMin === 'number' && Number.isFinite(pressureMin) && pressureMin >= 0)) {
		options.errors.push(`第 ${lineNo} 行压力值最小必须为非负数字`)
	}
	if (!(typeof pressureMax === 'number' && Number.isFinite(pressureMax) && pressureMax >= 0)) {
		options.errors.push(`第 ${lineNo} 行压力值最大必须为非负数字`)
	}
	if (
		typeof pressureMin === 'number' &&
		typeof pressureMax === 'number' &&
		Number.isFinite(pressureMin) &&
		Number.isFinite(pressureMax) &&
		pressureMin > pressureMax
	) {
		options.errors.push(`第 ${lineNo} 行压力值最小大于最大`)
	}
	if (tareWeight != null && !(typeof tareWeight === 'number' && Number.isFinite(tareWeight) && tareWeight >= 0)) {
		options.errors.push(`第 ${lineNo} 行皮重必须为非负数字`)
	}

	const mfgDate = parseDateString(manufactureDate)
	const scrapDueDate = mfgDate ? formatDate(addMonths(mfgDate, options.scrapYears * 12)) : bottleNextCheckDate

	return {
		_id: makeId(options.idPrefix, serial),
		bottle_no: normalizeCode(row['单位内编号']),
		filling_company: normalizeText(row['充装单位']),
		registration_mark: normalizeText(row['登记证编号']),
		equipment_type: normalizeText(row['设备品种']),
		product_no: normalizeCode(row['产品编号']),
		qr_code: normalizeCode(row['二维码号']),
		manufacturer: normalizeText(row['制造单位']),
		volume_l: volumeL,
		manufacture_date: manufactureDate,
		bottle_check_date: bottleCheckDate,
		bottle_next_check_date: bottleNextCheckDate,
		bottle_check_cycle_months: inferCycleMonths(bottleCheckDate, bottleNextCheckDate, 36),
		scrap_due_date: scrapDueDate,
		pressure_gauge_no: normalizeCode(row['压力表表号']),
		pressure_gauge_manufacturer: normalizeText(row['厂家']),
		pressure_gauge_range_min: pressureMin,
		pressure_gauge_range_max: pressureMax,
		pressure_gauge_check_date: gaugeCheckDate,
		pressure_gauge_next_check_date: gaugeNextCheckDate,
		pressure_gauge_cycle_months: inferCycleMonths(gaugeCheckDate, gaugeNextCheckDate, 6),
		safety_valve_count: 2,
		safety_valve_check_date: valveCheckDate,
		safety_valve_next_check_date: valveNextCheckDate,
		safety_valve_cycle_months: inferCycleMonths(valveCheckDate, valveNextCheckDate, 12),
		tare_weight: tareWeight,
		status: mapStatus(row['状态']),
		current_customer_id: null,
		current_customer_name: '',
		remark: options.batchId,
		is_active: true,
		created_at: options.nowTs,
		updated_at: options.nowTs
	}
}

function findDuplicateValues(rows, field) {
	const map = new Map()
	rows.forEach((row) => {
		const value = normalizeCode(row[field])
		if (!value) return
		const item = map.get(value) || { value, count: 0, ids: [] }
		item.count += 1
		if (item.ids.length < 3) item.ids.push(row._id)
		map.set(value, item)
	})
	return Array.from(map.values())
		.filter((item) => item.count > 1)
		.slice(0, 10)
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function run() {
	const args = parseArgs(process.argv)
	const csvPath = path.resolve(process.cwd(), args.csv)
	if (!fs.existsSync(csvPath)) throw new Error(`CSV 文件不存在: ${csvPath}`)

	const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'))
	const errors = []
	const nowTs = Date.now()
	const docs = rows.map(({ row, lineNo }, idx) =>
		buildDoc(row, lineNo, idx + 1, {
			errors,
			idPrefix: args.idPrefix,
			batchId: args.batchId,
			nowTs,
			scrapYears: Math.max(Number(args.scrapYears) || 20, 1)
		})
	)

	if (errors.length) {
		console.error(`发现 ${errors.length} 条数据问题：`)
		errors.slice(0, 20).forEach((msg) => console.error(`- ${msg}`))
		if (errors.length > 20) console.error(`... 省略 ${errors.length - 20} 条`)
		process.exit(1)
	}

	const dupBottle = findDuplicateValues(docs, 'bottle_no')
	const dupQr = findDuplicateValues(docs, 'qr_code')
	const dupGauge = findDuplicateValues(docs, 'pressure_gauge_no')
	if (dupBottle.length || dupQr.length || dupGauge.length) {
		console.error('检测到去重字段重复，已停止：')
		if (dupBottle.length) console.error(`- bottle_no 重复: ${JSON.stringify(dupBottle)}`)
		if (dupQr.length) console.error(`- qr_code 重复: ${JSON.stringify(dupQr)}`)
		if (dupGauge.length) console.error(`- pressure_gauge_no 重复: ${JSON.stringify(dupGauge)}`)
		process.exit(1)
	}

	const outputPath = path.resolve(process.cwd(), args.output)
	const metaPath = path.resolve(process.cwd(), args.meta)
	const idsPath = path.resolve(process.cwd(), args.ids)

	ensureDir(outputPath)
	ensureDir(metaPath)
	ensureDir(idsPath)

	fs.writeFileSync(outputPath, `${JSON.stringify(docs, null, 2)}\n`, 'utf8')
	fs.writeFileSync(idsPath, `${JSON.stringify(docs.map((item) => item._id), null, 2)}\n`, 'utf8')
	fs.writeFileSync(
		metaPath,
		`${JSON.stringify(
			{
				batch_id: args.batchId,
				total: docs.length,
				csv: csvPath,
				output: outputPath,
				ids_file: idsPath,
				generated_at: new Date().toISOString()
			},
			null,
			2
		)}\n`,
		'utf8'
	)

	console.log(`导出完成: ${docs.length} 条`)
	console.log(`- output: ${outputPath}`)
	console.log(`- ids:    ${idsPath}`)
	console.log(`- meta:   ${metaPath}`)
	console.log(`- batch:  ${args.batchId}`)
}

try {
	run()
} catch (err) {
	console.error(`执行失败: ${err.message}`)
	process.exit(1)
}
