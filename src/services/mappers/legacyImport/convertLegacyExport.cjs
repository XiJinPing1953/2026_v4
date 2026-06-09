#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_INPUT_FILES = {
	customers: 'about_crm_customers.json',
	vehicles: 'about_crm_vehicles.json',
	deliveries: 'about_crm_delivery_men.json',
	bottles: 'about_crm_bottles.json',
	fillings: 'about_crm_filling_records.json',
	sales: 'about_crm_sale_records.json',
	anomalies: 'about_crm_bottle_anomalies.json'
}

const DEFAULT_INPUT_DIR = '..'
const DEFAULT_OUTPUT_DIR = 'state/import/legacy_v2_to_v4'
const DEFAULT_FILLING_RECORD_TYPE = 'normal_fill'
const FILLING_RECORD_TYPES = new Set(['normal_fill', 'truck_out_agent_sale', 'truck_out_no_sale'])

function parseArgs(argv) {
	const args = {
		inputDir: DEFAULT_INPUT_DIR,
		outputDir: DEFAULT_OUTPUT_DIR
	}
	for (let i = 0; i < argv.length; i++) {
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
	return args
}

function resolveInputPath(args, name) {
	if (args[name]) return path.resolve(process.cwd(), args[name])
	return path.resolve(process.cwd(), args.inputDir, DEFAULT_INPUT_FILES[name])
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true })
}

function readText(filePath) {
	return fs.readFileSync(filePath, 'utf8')
}

function readTextIfExists(filePath, fallback = '') {
	if (!fs.existsSync(filePath)) return fallback
	return fs.readFileSync(filePath, 'utf8')
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
					contentPreview: current.slice(0, 120),
					error: err && err.message ? err.message : 'JSON parse error'
				})
			}
		})
		return { rows, parseMode: 'ndjson', badLines }
	}
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

function toText(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
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

function normalizeBool(value, fallback = true) {
	if (typeof value === 'boolean') return value
	const text = toText(value).toLowerCase()
	if (!text) return fallback
	if (['true', '1', 'yes', 'y', '在用', '启用', 'active'].includes(text)) return true
	if (['false', '0', 'no', 'n', '停用', '禁用', 'inactive'].includes(text)) return false
	return fallback
}

function normalizeBottleNo(value) {
	return toText(value).toUpperCase().replace(/\s+/g, '')
}

function normalizePlateNo(value) {
	return toText(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeFillingRecordType(value, fallback = DEFAULT_FILLING_RECORD_TYPE) {
	const text = toText(value).toLowerCase()
	if (!text) return fallback
	if (FILLING_RECORD_TYPES.has(text)) return text
	if (text.includes('agent')) return 'truck_out_agent_sale'
	if (text.includes('no_sale') || text.includes('nosale')) return 'truck_out_no_sale'
	if (text.includes('normal')) return 'normal_fill'
	return fallback
}

function isInventoryLinkedFillingRecordType(value) {
	const recordType = normalizeFillingRecordType(value, DEFAULT_FILLING_RECORD_TYPE)
	return recordType === 'normal_fill' || recordType === 'truck_out_agent_sale'
}

function normalizeDeliveryName(value) {
	return toText(value).replace(/\s+/g, ' ')
}

function normalizeDeliveryPhone(value) {
	return toText(value).replace(/\s+/g, '')
}

function buildDeliveryUniqKey(name, phone) {
	const normalizedName = normalizeDeliveryName(name)
	const normalizedPhone = normalizeDeliveryPhone(phone)
	if (!normalizedName) return ''
	return normalizedPhone ? `${normalizedName}|${normalizedPhone}` : `${normalizedName}|-`
}

function splitDeliveryNames(value) {
	const text = toText(value)
	if (!text) return []
	return text
		.replace(/[、，,;；|]+/g, '/')
		.split('/')
		.map((part) => normalizeDeliveryName(part))
		.filter(Boolean)
}

function normalizeDateString(value, fallbackTs) {
	const text = toText(value)
	if (text) {
		const compactYmd = text.match(/^(\d{4})(\d{2})(\d{2})$/)
		if (compactYmd) {
			return `${compactYmd[1]}-${compactYmd[2]}-${compactYmd[3]}`
		}
		const ymd = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
		if (ymd) {
			const y = Number(ymd[1])
			const m = Number(ymd[2])
			const day = Number(ymd[3])
			if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(day) && m >= 1 && m <= 12) {
				const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
				if (day >= 1 && day <= maxDay) {
					return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
				}
			}
		}
		const parsed = Date.parse(text)
		if (Number.isFinite(parsed) && parsed > 0) {
			const d = new Date(parsed)
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
		}
	}
	const ts = toTimestamp(fallbackTs, Date.now())
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

function normalizeEventDay(dateText, fallbackTs) {
	const text = toText(dateText)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	if (m) return m[1]
	return normalizeDateString('', fallbackTs)
}

function parseEventAt(dateText, fallbackTs) {
	const text = toText(dateText)
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
	if (m) {
		const y = m[1]
		const mon = m[2]
		const d = m[3]
		const hh = String(m[4] || '00').padStart(2, '0')
		const mm = String(m[5] || '00').padStart(2, '0')
		const ss = String(m[6] || '00').padStart(2, '0')
		const ts = Date.parse(`${y}-${mon}-${d}T${hh}:${mm}:${ss}+08:00`)
		if (Number.isFinite(ts) && ts > 0) return ts
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return toTimestamp(fallbackTs, Date.now())
}

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function normalizePriceUnit(value) {
	const text = toText(value).toLowerCase()
	if (!text) return 'kg'
	if (['kg', '公斤'].includes(text)) return 'kg'
	if (['bottle', '瓶', '瓶装'].includes(text)) return 'bottle'
	if (['m3', 'm³', '方', '立方', '立方米'].includes(text)) return 'm3'
	return 'kg'
}

function normalizeBizMode(value) {
	const text = toText(value).toLowerCase()
	if (text === 'agent_sale' || text === 'agent') return 'agent_sale'
	if (text === 'truck') return 'truck'
	return 'bottle'
}

function normalizeBottleStatus(value) {
	const text = toText(value).toLowerCase()
	if (['unknown', 'in_station', 'at_customer', 'scrapped', 'lost'].includes(text)) return text
	if (['在站', '库内', '在库'].includes(text)) return 'in_station'
	if (['在客户', '客户'].includes(text)) return 'at_customer'
	if (['报废'].includes(text)) return 'scrapped'
	if (['丢失'].includes(text)) return 'lost'
	return 'unknown'
}

function normalizePaymentStatus(value, amountReceived, amountShould) {
	const text = toText(value).toLowerCase()
	if (!text) {
		if (Number(amountShould) <= 0) return 'paid'
		return Number(amountReceived) > 0 ? 'partial' : 'unpaid'
	}
	if (['paid', '已付', '已收清', '已结清'].includes(text)) return 'paid'
	if (['partial', '部分付', '部分收款', '部分结清'].includes(text)) return 'partial'
	if (['unpaid', '未付', '未付款', '挂账', '待收'].includes(text)) return 'unpaid'
	if (text === '冲减') return 'paid'
	if (Number(amountShould) <= 0) return 'paid'
	return Number(amountReceived) > 0 ? 'partial' : 'unpaid'
}

function normalizePaymentMethod(value, paymentStatus) {
	const text = toText(value).toLowerCase()
	if (!text) return paymentStatus === 'unpaid' ? 'on_account' : ''
	if (['on_account', '挂账'].includes(text)) return 'on_account'
	if (['cash', '现金'].includes(text)) return 'cash'
	if (['bank', '银行', '银行转账', '转账'].includes(text)) return 'bank'
	if (['wechat', '微信'].includes(text)) return 'wechat'
	if (['alipay', '支付宝'].includes(text)) return 'alipay'
	if (['check', 'cheque', '支票'].includes(text)) return 'check'
	return paymentStatus === 'unpaid' ? 'on_account' : ''
}

function uniqBy(rows, keyGetter, preferUpdatedAt = true) {
	const map = new Map()
	for (const row of rows) {
		const key = keyGetter(row)
		if (!key) continue
		if (!map.has(key)) {
			map.set(key, row)
			continue
		}
		if (!preferUpdatedAt) continue
		const prev = map.get(key)
		const prevUpdated = toTimestamp(prev.updated_at, 0)
		const currUpdated = toTimestamp(row.updated_at, 0)
		if (currUpdated >= prevUpdated) map.set(key, row)
	}
	return Array.from(map.values())
}

function normalizeSaleBottleItems(items) {
	const source = Array.isArray(items) ? items : []
	const out = []
	const seen = new Set()
	for (const row of source) {
		const bottleNo = normalizeBottleNo(row && (row.bottle_no || row.bottleNo))
		if (!bottleNo || seen.has(bottleNo)) continue
		seen.add(bottleNo)
		out.push({
			bottle_no: bottleNo,
			bottle_id: unwrapId(row && (row.bottle_id || row.bottleId)) || null,
			gross: toNumber(row && row.gross, null),
			tare: toNumber(row && row.tare, null),
			net: toNumber(row && row.net, null)
		})
	}
	return out
}

function parseDepositRows(row) {
	const fromRows = Array.isArray(row.deposit_rows) ? row.deposit_rows : []
	const fromItems = Array.isArray(row.deposit_items) ? row.deposit_items : []
	const raw = toText(row.deposit_bottles_raw)
	const parsedRaw = raw
		? raw
			.split(/[\/,，、\s]+/)
			.map((s) => normalizeBottleNo(s))
			.filter(Boolean)
		: []

	const out = []
	const seen = new Set()
	const feed = (item) => {
		const bottleNo = normalizeBottleNo(item && (item.bottle_no || item.bottleNo || item))
		if (!bottleNo || seen.has(bottleNo)) return
		seen.add(bottleNo)
		out.push({
			bottle_no: bottleNo,
			bottle_id: unwrapId(item && (item.bottle_id || item.bottleId)) || null
		})
	}
	fromRows.forEach(feed)
	fromItems.forEach(feed)
	parsedRaw.forEach(feed)
	return out
}

function normalizeAgentSaleItems(items) {
	const source = Array.isArray(items) ? items : []
	const out = []
	const seen = new Set()
	for (const row of source) {
		const bottleNo = normalizeBottleNo(row && (row.bottle_no || row.bottleNo))
		if (!bottleNo || seen.has(bottleNo)) continue
		const fillWeight = toNumber(row && (row.fill_weight != null ? row.fill_weight : row.fillWeight), null)
		if (!(fillWeight > 0)) continue
		seen.add(bottleNo)
		out.push({
			bottle_no: bottleNo,
			bottle_id: unwrapId(row && (row.bottle_id || row.bottleId)) || null,
			fill_weight: fillWeight,
			address: toText(row && row.address),
			filling_record_id: unwrapId(row && (row.filling_record_id || row.fillingRecordId)) || null
		})
	}
	return out
}

function writeNdjson(filePath, rows) {
	const content = rows.map((row) => JSON.stringify(row)).join('\n')
	fs.writeFileSync(filePath, content ? `${content}\n` : '', 'utf8')
}

function writeJsonArray(filePath, rows) {
	fs.writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function transformCustomers(sourceRows) {
	const dropped = []
	const transformed = []
	for (const row of sourceRows) {
		const name = toText(row.name)
		if (!name) {
			dropped.push({ reason: 'missing_name', sourceId: unwrapId(row._id) })
			continue
		}
		const phone = toText(row.phone)
		const unit = normalizePriceUnit(row.default_price_unit)
		const createdAt = toTimestamp(row.created_at, toTimestamp(row.updated_at, Date.now()))
		const updatedAt = toTimestamp(row.updated_at, createdAt)
		transformed.push({
			_id: unwrapId(row._id) || undefined,
			uniq_key: `${name}|${phone}`,
			name,
			short_name: toText(row.short_name),
			contact: toText(row.contact),
			phone,
			address: toText(row.address),
			remark: toText(row.remark),
			is_active: normalizeBool(row.is_active, true),
			is_hidden: false,
			hidden_at: null,
			hidden_by: null,
			hidden_by_name: '',
			default_unit_price: toNumber(row.default_unit_price, null),
			default_price_unit: unit,
			created_at: createdAt,
			updated_at: updatedAt
		})
	}

	const deduped = uniqBy(transformed, (row) => row.uniq_key, true)
	const cleaned = deduped.map((row) => {
		const out = { ...row }
		if (!out._id) delete out._id
		return out
	})

	const customerIdByName = new Map()
	const customerIdByKey = new Map()
	cleaned.forEach((row) => {
		const id = row._id || ''
		if (id) {
			customerIdByKey.set(row.uniq_key, id)
			if (!customerIdByName.has(row.name)) customerIdByName.set(row.name, id)
		}
	})

	return {
		rows: cleaned,
		dropped,
		stats: {
			source: sourceRows.length,
			transformed: transformed.length,
			deduped: deduped.length
		},
		customerIdByName
	}
}

function transformVehicles(sourceRows) {
	const dropped = []
	const transformed = []
	for (const row of sourceRows) {
		const plateNo = normalizePlateNo(row.plate_no)
		if (!plateNo) {
			dropped.push({ reason: 'missing_plate_no', sourceId: unwrapId(row._id) })
			continue
		}
		const createdAt = toTimestamp(row.created_at, toTimestamp(row.updated_at, Date.now()))
		const updatedAt = toTimestamp(row.updated_at, createdAt)
		transformed.push({
			_id: unwrapId(row._id) || undefined,
			uniq_key: plateNo,
			plate_no: plateNo,
			remark: toText(row.remark),
			is_active: normalizeBool(row.is_active != null ? row.is_active : row.status, true),
			created_at: createdAt,
			updated_at: updatedAt
		})
	}
	const deduped = uniqBy(transformed, (row) => row.uniq_key, true)
	const cleaned = deduped.map((row) => {
		const out = { ...row }
		if (!out._id) delete out._id
		return out
	})
	return {
		rows: cleaned,
		dropped,
		stats: {
			source: sourceRows.length,
			transformed: transformed.length,
			deduped: deduped.length
		}
	}
}

function rankDeliveryRow(row) {
	let score = 0
	if (normalizeDeliveryPhone(row.phone)) score += 4
	if (normalizeBool(row.is_active, true)) score += 2
	if (toText(row.remark)) score += 1
	return score
}

function pickBetterDeliveryRow(prev, curr) {
	const prevScore = rankDeliveryRow(prev)
	const currScore = rankDeliveryRow(curr)
	if (currScore > prevScore) return curr
	if (currScore < prevScore) return prev
	const prevUpdated = toTimestamp(prev.updated_at, 0)
	const currUpdated = toTimestamp(curr.updated_at, 0)
	return currUpdated >= prevUpdated ? curr : prev
}

function dedupeDeliveriesByName(rows) {
	const map = new Map()
	for (const row of rows) {
		const key = normalizeDeliveryName(row.name).toLowerCase()
		if (!key) continue
		if (!map.has(key)) {
			map.set(key, row)
			continue
		}
		map.set(key, pickBetterDeliveryRow(map.get(key), row))
	}
	return Array.from(map.values())
}

function transformDeliveries(sourceRows, saleRows, fillingRows) {
	const dropped = []
	const transformed = []
	const hasSourceRows = Array.isArray(sourceRows) && sourceRows.length > 0

	for (const row of sourceRows) {
		const name = normalizeDeliveryName(row.name || row.delivery_name)
		if (!name) {
			dropped.push({ reason: 'missing_name', sourceId: unwrapId(row._id) })
			continue
		}
		const phone = normalizeDeliveryPhone(row.phone || row.mobile)
		const createdAt = toTimestamp(row.created_at, toTimestamp(row.updated_at, Date.now()))
		const updatedAt = toTimestamp(row.updated_at, createdAt)
		transformed.push({
			_id: unwrapId(row._id) || undefined,
			name,
			phone,
			remark: toText(row.remark),
			is_active: normalizeBool(row.is_active != null ? row.is_active : row.status, true),
			created_at: createdAt,
			updated_at: updatedAt,
			_derived_from: 'delivery_file'
		})
	}

	const derivedFromSales = []
	const derivedFromFillings = []
	// 有正式配送员导出时，以其为准；仅在缺失时才走文本派生补齐。
	if (!hasSourceRows) {
		for (const row of saleRows) {
			const names = splitDeliveryNames(row.delivery_man)
			if (!names.length) continue
			const createdAt = toTimestamp(row.created_at, Date.now())
			const updatedAt = toTimestamp(row.updated_at, createdAt)
			for (const name of names) {
				derivedFromSales.push({
					name,
					phone: '',
					remark: '来源: 销售记录配送员',
					is_active: true,
					created_at: createdAt,
					updated_at: updatedAt,
					_derived_from: 'sale_records'
				})
			}
		}

		for (const row of fillingRows) {
			const names = splitDeliveryNames(row.operator || row.created_by_name)
			if (!names.length) continue
			const createdAt = toTimestamp(row.created_at, toTimestamp(row.timestamp, Date.now()))
			const updatedAt = toTimestamp(row.updated_at, createdAt)
			for (const name of names) {
				derivedFromFillings.push({
					name,
					phone: '',
					remark: '来源: 灌装记录操作人',
					is_active: true,
					created_at: createdAt,
					updated_at: updatedAt,
					_derived_from: 'filling_records'
				})
			}
		}
	}

	const merged = dedupeDeliveriesByName([
		...transformed,
		...derivedFromSales,
		...derivedFromFillings
	]).map((row) => {
		const out = {
			...row,
			uniq_key: buildDeliveryUniqKey(row.name, row.phone)
		}
		if (!out._id) delete out._id
		delete out._derived_from
		return out
	})

	const cleaned = merged.filter((row) => {
		if (row.uniq_key) return true
		dropped.push({ reason: 'invalid_uniq_key', sourceId: row._id || '' })
		return false
	})

	return {
		rows: cleaned,
		dropped,
		stats: {
			source: sourceRows.length,
			transformed: transformed.length,
			derived_from_sales: derivedFromSales.length,
			derived_from_fillings: derivedFromFillings.length,
			deduped: cleaned.length
		}
	}
}

function transformBottles(sourceRows, customerIdByName) {
	const dropped = []
	const transformed = []
	for (const row of sourceRows) {
		const bottleNo = normalizeBottleNo(row.bottle_no || row.number)
		if (!bottleNo) {
			dropped.push({ reason: 'missing_bottle_no', sourceId: unwrapId(row._id) })
			continue
		}
		const status = normalizeBottleStatus(row.status)
		const currentNameRaw = toText(row.current_customer_name || row.last_customer_name)
		let currentId = unwrapId(row.current_customer_id || row.last_customer_id) || null
		if (!currentId && currentNameRaw && customerIdByName.has(currentNameRaw)) {
			currentId = customerIdByName.get(currentNameRaw)
		}
		const createdAt = toTimestamp(row.created_at, toTimestamp(row.updated_at, Date.now()))
		const updatedAt = toTimestamp(row.updated_at, createdAt)
		const atCustomer = status === 'at_customer'

		transformed.push({
			_id: unwrapId(row._id) || undefined,
			bottle_no: bottleNo,
			tare_weight: toNumber(row.tare_weight, null),
			status,
			current_customer_id: atCustomer ? (currentId || null) : null,
			current_customer_name: atCustomer ? currentNameRaw : '',
			remark: toText(row.remark),
			is_active: normalizeBool(row.is_active, true),
			created_at: createdAt,
			updated_at: updatedAt
		})
	}

	const deduped = uniqBy(transformed, (row) => row.bottle_no, true)
	const cleaned = deduped.map((row) => {
		const out = { ...row }
		if (!out._id) delete out._id
		return out
	})
	return {
		rows: cleaned,
		dropped,
		stats: {
			source: sourceRows.length,
			transformed: transformed.length,
			deduped: deduped.length
		}
	}
}

function transformFillings(sourceRows) {
	const dropped = []
	const transformed = []
	let noSaleBottleFilledFromVehicle = 0
	for (const row of sourceRows) {
		const recordType = normalizeFillingRecordType(row.record_type, DEFAULT_FILLING_RECORD_TYPE)
		let bottleNo = normalizeBottleNo(row.bottle_no)
		if (recordType === 'truck_out_no_sale' && !bottleNo) {
			const plateNo = normalizePlateNo(row.vehicle_no || row.car_no || row.truck_no)
			if (plateNo) {
				bottleNo = plateNo
				noSaleBottleFilledFromVehicle += 1
			}
		}
		const fillWeight = toNumber(
			row.fill_weight != null ? row.fill_weight : (row.net_fill != null ? row.net_fill : row.out_net),
			null
		)
		if (isInventoryLinkedFillingRecordType(recordType) && !bottleNo) {
			dropped.push({
				reason: 'missing_bottle_no_inventory_linked',
				sourceId: unwrapId(row._id),
				record_type: recordType
			})
			continue
		}
		if (!(fillWeight > 0)) {
			dropped.push({ reason: 'invalid_fill_weight', sourceId: unwrapId(row._id), bottle_no: bottleNo })
			continue
		}
		const createdAt = toTimestamp(row.created_at, toTimestamp(row.timestamp, Date.now()))
		const updatedAt = toTimestamp(row.updated_at, createdAt)
		transformed.push({
			_id: unwrapId(row._id) || undefined,
			date: normalizeDateString(row.date, createdAt),
			bottle_no: bottleNo,
			fill_weight: fillWeight,
			record_type: recordType,
			remark: toText(row.remark),
			operator: toText(row.operator || row.created_by_name),
			operator_id: unwrapId(row.operator_id || row.created_by) || null,
			created_at: createdAt,
			updated_at: updatedAt,
			created_by: unwrapId(row.created_by || row.operator_id) || null,
			created_by_name: toText(row.operator || row.created_by_name)
		})
	}
	const deduped = uniqBy(
		transformed,
		(row) => row._id || `${row.record_type}|${row.bottle_no}|${row.date}|${row.fill_weight}|${row.created_at}`,
		true
	)
	const cleaned = deduped.map((row) => {
		const out = { ...row }
		if (!out._id) delete out._id
		return out
	})
	return {
		rows: cleaned,
		dropped,
		stats: {
			source: sourceRows.length,
			transformed: transformed.length,
			deduped: deduped.length,
			no_sale_bottle_no_filled_from_vehicle_total: noSaleBottleFilledFromVehicle
		}
	}
}

function transformSales(sourceRows, customerIdByName) {
	const dropped = []
	const transformed = []
	for (const row of sourceRows) {
		const customerName = toText(row.customer_name)
		let customerId = unwrapId(row.customer_id)
		if (!customerId && customerName && customerIdByName.has(customerName)) {
			customerId = customerIdByName.get(customerName)
		}
		if (!customerId || !customerName) {
			dropped.push({
				reason: !customerId ? 'missing_customer_id' : 'missing_customer_name',
				sourceId: unwrapId(row._id),
				customer_name: customerName
			})
			continue
		}

		const createdAt = toTimestamp(row.created_at, Date.now())
		const updatedAt = toTimestamp(row.updated_at, createdAt)
		const amountReceived = toNumber(row.amount_received, 0)
		const amountShould = toNumber(row.amount, toNumber(row.should_receive, 0))
		const paymentStatus = normalizePaymentStatus(row.payment_status, amountReceived, amountShould)
		const priceUnit = normalizePriceUnit(row.price_unit)
		const bizMode = normalizeBizMode(row.biz_mode)

		let flowIndexPrev = toNumber(row.flow_index_prev, null)
		let flowIndexCurr = toNumber(row.flow_index_curr, null)
		let flowVolumeM3 = toNumber(row.flow_volume_m3, null)
		let flowTheoryRatio = toNumber(row.flow_theory_ratio, null)
		if (priceUnit === 'm3' && flowVolumeM3 == null && flowIndexPrev != null && flowIndexCurr != null) {
			const diff = flowIndexCurr - flowIndexPrev
			flowVolumeM3 = diff >= 0 ? diff : null
		}
		if (priceUnit !== 'm3') {
			flowIndexPrev = null
			flowIndexCurr = null
			flowVolumeM3 = null
			flowTheoryRatio = null
		}

		let outItems = normalizeSaleBottleItems(row.out_items)
		let backItems = normalizeSaleBottleItems(row.back_items)
		let depositRows = parseDepositRows(row)
		let agentSaleItems = normalizeAgentSaleItems(row.agent_sale_items)

		let truckNo = toText(row.truck_no) || null
		let truckOutGross = toNumber(row.truck_out_gross, null)
		let truckBackGross = toNumber(row.truck_back_gross, null)
		let truckSaleNet = toNumber(row.truck_gross_diff, toNumber(row.truck_sale_net, null))
		if (truckOutGross != null && truckBackGross != null) {
			const grossDiff = truckOutGross - truckBackGross
			truckSaleNet = grossDiff > 0 ? grossDiff : null
		}

		if (bizMode === 'agent_sale') {
			outItems = []
			backItems = []
			depositRows = []
			truckNo = null
			truckOutGross = null
			truckBackGross = null
			truckSaleNet = null
		}
		if (bizMode === 'bottle') {
			agentSaleItems = []
			truckNo = null
			truckOutGross = null
			truckBackGross = null
			truckSaleNet = null
		}
		if (bizMode === 'truck') {
			outItems = []
			backItems = []
			depositRows = []
			agentSaleItems = []
		}

		const doc = {
			_id: unwrapId(row._id) || undefined,
			date: normalizeDateString(row.date, createdAt),
			customer_id: customerId,
			customer_name: customerName,
			delivery_man: toText(row.delivery_man),
			vehicle_id: unwrapId(row.vehicle_id) || '',
			car_no: toText(row.car_no),
			biz_mode: bizMode,
			price_unit: priceUnit,
			unit_price: toNumber(row.unit_price, null),
			remark: toText(row.remark),
			payment_status: paymentStatus,
			amount_received: amountReceived,
			rounding_amount: toNumber(row.rounding_amount, 0),
			payment_note: toText(row.payment_note),
			payment_method: normalizePaymentMethod(row.payment_method, paymentStatus),
			out_items: outItems,
			back_items: backItems,
			deposit_rows: depositRows,
			agent_sale_items: agentSaleItems,
			truck_no: truckNo,
			truck_out_gross: truckOutGross,
			truck_back_gross: truckBackGross,
			truck_gross_diff: truckSaleNet,
			truck_sale_net: null,
			flow_index_prev: flowIndexPrev,
			flow_index_curr: flowIndexCurr,
			flow_volume_m3: flowVolumeM3,
			flow_theory_ratio: flowTheoryRatio,
			created_at: createdAt,
			created_by: unwrapId(row.created_by) || null,
			updated_at: updatedAt,
			source: toText(row.source) || 'legacy-v2-import'
		}
		transformed.push(doc)
	}

	const deduped = uniqBy(transformed, (row) => row._id || `${row.date}|${row.customer_id}|${row.created_at}`, true)
	const cleaned = deduped.map((row) => {
		const out = { ...row }
		if (!out._id) delete out._id
		return out
	})
	return {
		rows: cleaned,
		dropped,
		stats: {
			source: sourceRows.length,
			transformed: transformed.length,
			deduped: deduped.length
		}
	}
}

function movementSort(a, b) {
	if (a.event_at !== b.event_at) return a.event_at - b.event_at
	if (a.type_order !== b.type_order) return a.type_order - b.type_order
	if (a.created_at !== b.created_at) return a.created_at - b.created_at
	if (a.bottle_no !== b.bottle_no) return a.bottle_no < b.bottle_no ? -1 : 1
	if (a.type !== b.type) return a.type < b.type ? -1 : 1
	return 0
}

function transformMovements(saleRows, fillingRows) {
	const dropped = []
	const transformed = []

	for (const row of saleRows) {
		const sourceId = unwrapId(row._id) || null
		const date = normalizeDateString(row.date, row.created_at)
		const createdAt = toTimestamp(row.created_at, Date.now())
		const eventDay = normalizeEventDay(date, createdAt)
		const eventAt = parseEventAt(date, createdAt)
		const createdBy = unwrapId(row.created_by) || null
		const createdByName = toText(row.created_by_name)
		const customerId = unwrapId(row.customer_id) || null
		const customerName = toText(row.customer_name)
		const outItems = Array.isArray(row.out_items) ? row.out_items : []
		const backItems = Array.isArray(row.back_items) ? row.back_items : []

		for (const item of outItems) {
			const bottleNo = normalizeBottleNo(item && item.bottle_no)
			if (!bottleNo) {
				dropped.push({ reason: 'sale_out_missing_bottle_no', sourceId, saleId: sourceId })
				continue
			}
			transformed.push({
				bottle_no: bottleNo,
				type: 'out',
				date,
				event_day: eventDay,
				event_at: eventAt,
				type_order: movementTypeOrder('out'),
				source_type: 'sale',
				source_id: sourceId,
				customer_id: customerId,
				customer_name: customerName,
				net_weight: toNumber(item && item.net, null),
				loss_weight: null,
				note: '',
				created_at: createdAt,
				created_by: createdBy,
				created_by_name: createdByName
			})
		}

		for (const item of backItems) {
			const bottleNo = normalizeBottleNo(item && item.bottle_no)
			if (!bottleNo) {
				dropped.push({ reason: 'sale_back_missing_bottle_no', sourceId, saleId: sourceId })
				continue
			}
			transformed.push({
				bottle_no: bottleNo,
				type: 'back',
				date,
				event_day: eventDay,
				event_at: eventAt,
				type_order: movementTypeOrder('back'),
				source_type: 'sale',
				source_id: sourceId,
				customer_id: customerId,
				customer_name: customerName,
				net_weight: toNumber(item && item.net, null),
				loss_weight: null,
				note: '',
				created_at: createdAt,
				created_by: createdBy,
				created_by_name: createdByName
			})
		}
	}

	for (const row of fillingRows) {
		const recordType = normalizeFillingRecordType(row && row.record_type, DEFAULT_FILLING_RECORD_TYPE)
		if (!isInventoryLinkedFillingRecordType(recordType)) {
			continue
		}
		const bottleNo = normalizeBottleNo(row.bottle_no)
		if (!bottleNo) {
			dropped.push({ reason: 'filling_missing_bottle_no', sourceId: unwrapId(row._id) })
			continue
		}
		const createdAt = toTimestamp(row.created_at, Date.now())
		const sourceId = unwrapId(row._id) || null
		const date = normalizeDateString(row.date, createdAt)
		transformed.push({
			bottle_no: bottleNo,
			type: 'fill',
			date,
			event_day: normalizeEventDay(date, createdAt),
			event_at: parseEventAt(date, createdAt),
			type_order: movementTypeOrder('fill'),
			source_type: 'filling',
			source_id: sourceId,
			customer_id: null,
			customer_name: '',
			net_weight: toNumber(row.fill_weight, null),
			loss_weight: null,
			note: toText(row.remark),
			created_at: createdAt,
			created_by: unwrapId(row.created_by) || null,
			created_by_name: toText(row.created_by_name)
		})
	}

	const deduped = uniqBy(
		transformed,
		(row) =>
			`${row.source_type}|${row.source_id || ''}|${row.type}|${row.bottle_no}|${row.event_day}|${row.event_at}|${row.created_at}`,
		false
	).sort(movementSort)

	return {
		rows: deduped,
		dropped,
		stats: {
			source_sales: saleRows.length,
			source_fillings: fillingRows.length,
			transformed: transformed.length,
			deduped: deduped.length
		}
	}
}

function normalizeAnomalyType(value) {
	const text = toText(value).toLowerCase()
	if (!text) return 'legacy_unknown'
	return text.replace(/\s+/g, '_')
}

function normalizeAnomalyStatus(row) {
	const status = toText(row && row.status).toLowerCase()
	if (status === 'open' || status === 'resolved') return status
	if (row && row.resolved === true) return 'resolved'
	return 'open'
}

function normalizeRelatedRecords(rows) {
	if (!Array.isArray(rows)) return []
	return rows
		.map((item) => ({
			type: toText(item && item.type),
			id: unwrapId(item && item.id) || null,
			role: toText(item && item.role)
		}))
		.filter((item) => item.type || item.id || item.role)
}

function buildAnomalyFingerprint(input) {
	const bottleNo = normalizeBottleNo(input && input.bottle_no)
	const anomalyType = toText(input && (input.anomaly_type || input.type)).toLowerCase()
	const context = input && typeof input.context === 'object' && !Array.isArray(input.context) ? input.context : {}
	const lastBack = context && typeof context.last_back === 'object' ? context.last_back : {}
	const nextOut = context && typeof context.next_out === 'object' ? context.next_out : {}
	const detail = toText(input && (input.note || input.detail))
	const date = toText(input && (input.date || (context && context.legacy_date)))
	return [
		bottleNo,
		anomalyType,
		date,
		toText(lastBack.date),
		toText(lastBack.customer),
		toText(nextOut.date),
		toText(nextOut.customer),
		detail
	]
		.join('|')
		.toLowerCase()
}

function transformAnomalies(sourceRows) {
	const dropped = []
	const transformed = []

	for (const row of sourceRows) {
		const bottleNo = normalizeBottleNo(row.bottle_no)
		if (!bottleNo) {
			dropped.push({ reason: 'missing_bottle_no', sourceId: unwrapId(row._id) })
			continue
		}

		const createdAt = toTimestamp(row.created_at, Date.now())
		const updatedAt = toTimestamp(row.updated_at, toTimestamp(row.resolved_at, createdAt))
		const context = row && typeof row.context === 'object' && !Array.isArray(row.context) ? { ...row.context } : {}
		const relatedRecords = normalizeRelatedRecords(row.related_records)
		if (row.date) context.legacy_date = toText(row.date)
		if (relatedRecords.length) context.related_records = relatedRecords
		if (row.ignored != null) context.legacy_ignored = Boolean(row.ignored)

		transformed.push({
			_id: unwrapId(row._id) || undefined,
			bottle_no: bottleNo,
			anomaly_type: normalizeAnomalyType(row.type || row.anomaly_type),
			fingerprint: buildAnomalyFingerprint({
				bottle_no: bottleNo,
				anomaly_type: normalizeAnomalyType(row.type || row.anomaly_type),
				date: toText(row.date),
				note: toText(row.note || row.detail),
				context
			}),
			status: normalizeAnomalyStatus(row),
			note: toText(row.note || row.detail),
			context,
			resolved_by: unwrapId(row.resolved_by) || null,
			resolved_by_name: toText(row.resolved_by_name),
			created_at: createdAt,
			updated_at: updatedAt
		})
	}

	const deduped = uniqBy(transformed, (row) => row._id || `${row.bottle_no}|${row.anomaly_type}|${row.created_at}`, true)
	const cleaned = deduped.map((row) => {
		const out = { ...row }
		if (!out._id) delete out._id
		return out
	})

	return {
		rows: cleaned,
		dropped,
		stats: {
			source: sourceRows.length,
			transformed: transformed.length,
			deduped: cleaned.length
		}
	}
}

function summarizeDrops(items) {
	const map = new Map()
	for (const item of items) {
		const reason = item.reason || 'unknown'
		map.set(reason, (map.get(reason) || 0) + 1)
	}
	return Object.fromEntries(Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])))
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	const outputDir = path.resolve(process.cwd(), args.outputDir || DEFAULT_OUTPUT_DIR)
	ensureDir(outputDir)

	const inputPaths = {
		customers: resolveInputPath(args, 'customers'),
		vehicles: resolveInputPath(args, 'vehicles'),
		deliveries: resolveInputPath(args, 'deliveries'),
		bottles: resolveInputPath(args, 'bottles'),
		fillings: resolveInputPath(args, 'fillings'),
		sales: resolveInputPath(args, 'sales'),
		anomalies: resolveInputPath(args, 'anomalies')
	}

	const parsed = {}
	const parseWarnings = []
	for (const [name, filePath] of Object.entries(inputPaths)) {
		const required = name !== 'deliveries' && name !== 'anomalies'
		const text = required ? readText(filePath) : readTextIfExists(filePath, '')
		const result = parseLegacyRows(text, filePath)
		parsed[name] = result
		result.badLines.forEach((item) => parseWarnings.push(item))
	}

	const customerResult = transformCustomers(parsed.customers.rows)
	const vehicleResult = transformVehicles(parsed.vehicles.rows)
	const deliveryResult = transformDeliveries(parsed.deliveries.rows, parsed.sales.rows, parsed.fillings.rows)
	const bottleResult = transformBottles(parsed.bottles.rows, customerResult.customerIdByName)
	const fillingResult = transformFillings(parsed.fillings.rows)
	const saleResult = transformSales(parsed.sales.rows, customerResult.customerIdByName)
	const movementResult = transformMovements(saleResult.rows, fillingResult.rows)
	const anomalyResult = transformAnomalies(parsed.anomalies.rows)

	const outputs = {
		crm_customers: customerResult.rows,
		crm_vehicles: vehicleResult.rows,
		crm_delivery_men: deliveryResult.rows,
		crm_bottles: bottleResult.rows,
		crm_fillings: fillingResult.rows,
		crm_sale_records: saleResult.rows,
		crm_bottle_movements: movementResult.rows,
		crm_bottle_anomalies: anomalyResult.rows
	}

	const outputFiles = {}
	for (const [name, rows] of Object.entries(outputs)) {
		const jsonImportPath = path.join(outputDir, `${name}.json`)
		const ndjsonPath = path.join(outputDir, `${name}.ndjson`)
		const jsonArrayPath = path.join(outputDir, `${name}.array.json`)
		// uniCloud 文档导入示例要求：json 文件每行一条记录（jsonl 形态）
		writeNdjson(jsonImportPath, rows)
		writeNdjson(ndjsonPath, rows)
		writeJsonArray(jsonArrayPath, rows)
		outputFiles[name] = {
			json_import: jsonImportPath,
			ndjson: ndjsonPath,
			json_array: jsonArrayPath
		}
	}

	const report = {
		generated_at: new Date().toISOString(),
		input_paths: inputPaths,
		output_dir: outputDir,
		parse_mode: {
			customers: parsed.customers.parseMode,
			vehicles: parsed.vehicles.parseMode,
			deliveries: parsed.deliveries.parseMode,
			bottles: parsed.bottles.parseMode,
			fillings: parsed.fillings.parseMode,
			sales: parsed.sales.parseMode,
			anomalies: parsed.anomalies.parseMode
		},
		parse_warning_count: parseWarnings.length,
		parse_warnings_preview: parseWarnings.slice(0, 20),
		stats: {
			customers: customerResult.stats,
			vehicles: vehicleResult.stats,
			deliveries: deliveryResult.stats,
			bottles: bottleResult.stats,
			fillings: fillingResult.stats,
			sales: saleResult.stats,
			movements: movementResult.stats,
			anomalies: anomalyResult.stats
		},
		drop_summary: {
			customers: summarizeDrops(customerResult.dropped),
			vehicles: summarizeDrops(vehicleResult.dropped),
			deliveries: summarizeDrops(deliveryResult.dropped),
			bottles: summarizeDrops(bottleResult.dropped),
			fillings: summarizeDrops(fillingResult.dropped),
			sales: summarizeDrops(saleResult.dropped),
			movements: summarizeDrops(movementResult.dropped),
			anomalies: summarizeDrops(anomalyResult.dropped)
		},
		dropped_preview: {
			customers: customerResult.dropped.slice(0, 20),
			vehicles: vehicleResult.dropped.slice(0, 20),
			deliveries: deliveryResult.dropped.slice(0, 20),
			bottles: bottleResult.dropped.slice(0, 20),
			fillings: fillingResult.dropped.slice(0, 20),
			sales: saleResult.dropped.slice(0, 20),
			movements: movementResult.dropped.slice(0, 20),
			anomalies: anomalyResult.dropped.slice(0, 20)
		},
		output_files: outputFiles
	}

	const reportPath = path.join(outputDir, 'report.json')
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

	console.log('[legacy-import] done')
	console.log(JSON.stringify({
		output_dir: outputDir,
		output_files: outputFiles,
		report: reportPath,
		stats: report.stats,
		drop_summary: report.drop_summary
	}, null, 2))
}

main()
