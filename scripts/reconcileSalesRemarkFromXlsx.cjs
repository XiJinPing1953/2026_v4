#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const DEFAULT_XLSX = 'docs/副本销售出库表2026年3月.xlsx'
const DEFAULT_REPORT = 'docs/sale.remark.reconcile.report.json'

function parseArgs(argv) {
	const args = {
		xlsx: DEFAULT_XLSX,
		report: DEFAULT_REPORT,
		dateStart: '2026-03-01',
		dateEnd: '2026-03-31',
		spaceId: process.env.UNI_SPACE_ID || '',
		accessKey: process.env.UNI_ACCESS_KEY || '',
		secretKey: process.env.UNI_SECRET_KEY || '',
		spaceAppId: process.env.UNI_SPACE_APP_ID || '',
		endpoint: process.env.UNI_ENDPOINT || '',
		crmToken: process.env.CRM_TOKEN || '',
		crmUsername: process.env.CRM_USERNAME || 'superadmin',
		crmPassword: process.env.CRM_PASSWORD || 'y7ez5CGAbivZkeP'
	}

	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if ((cur === '--xlsx' || cur === '--input') && next) {
			args.xlsx = next
			i += 1
		} else if (cur === '--report' && next) {
			args.report = next
			i += 1
		} else if (cur === '--date-start' && next) {
			args.dateStart = next
			i += 1
		} else if (cur === '--date-end' && next) {
			args.dateEnd = next
			i += 1
		} else if (cur === '--space-id' && next) {
			args.spaceId = next
			i += 1
		} else if (cur === '--access-key' && next) {
			args.accessKey = next
			i += 1
		} else if (cur === '--secret-key' && next) {
			args.secretKey = next
			i += 1
		} else if (cur === '--space-app-id' && next) {
			args.spaceAppId = next
			i += 1
		} else if (cur === '--endpoint' && next) {
			args.endpoint = next
			i += 1
		} else if (cur === '--crm-token' && next) {
			args.crmToken = next
			i += 1
		} else if (cur === '--crm-username' && next) {
			args.crmUsername = next
			i += 1
		} else if (cur === '--crm-password' && next) {
			args.crmPassword = next
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
  node scripts/reconcileSalesRemarkFromXlsx.cjs [options]

Options:
  --xlsx <path>          xlsx 文件路径（默认 ${DEFAULT_XLSX}）
  --report <path>        报告输出路径（默认 ${DEFAULT_REPORT}）
  --date-start <yyyy-mm-dd>
  --date-end <yyyy-mm-dd>
  --space-id <id>
  --access-key <key>
  --secret-key <key>
  --space-app-id <id>
  --endpoint <url>
  --crm-token <token>
  --crm-username <name>
  --crm-password <pass>
`)
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeCustomerKey(value) {
	return normalizeString(value)
		.toUpperCase()
		.replace(/[\s\u3000\-_—()（）【】\[\]<>《》,，.。·•/]/g, '')
}

function normalizeRemarkComparable(value) {
	return normalizeString(value).replace(/[\s\r\n\t\u3000]+/g, '')
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(String(value).replace(/[￥¥,，\s]/g, ''))
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Number(num.toFixed(2))
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function splitPathQuery(urlPath) {
	const idx = String(urlPath).indexOf('?')
	if (idx < 0) return [String(urlPath), '']
	return [urlPath.slice(0, idx), urlPath.slice(idx + 1)]
}

function sha256Hex(text) {
	return crypto.createHash('sha256').update(String(text)).digest('hex')
}

function hmacSha256Hex(text, key) {
	return crypto.createHmac('sha256', key).update(String(text)).digest('hex')
}

function uuidV4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

class AlipayFunctionClient {
	constructor({ spaceId, accessKey, secretKey, spaceAppId, endpoint }) {
		if (!spaceId) throw new Error('缺少 spaceId')
		if (!accessKey || !secretKey || !spaceAppId) throw new Error('缺少支付宝签名参数')
		if (typeof fetch !== 'function') throw new Error('当前 Node 不支持 fetch（需 Node 18+）')
		this.spaceId = spaceId
		this.accessKey = accessKey
		this.secretKey = secretKey
		this.spaceAppId = spaceAppId
		this.endpoint = normalizeString(endpoint) || `https://${spaceId}.api-hz.cloudbasefunction.cn`
	}

	signRequest(pathWithQuery, { data, functionName }) {
		const timestamp = String(Date.now())
		const requestId = uuidV4()
		const headers = {
			'x-from-app-id': this.spaceAppId,
			'x-from-env-id': this.spaceId,
			'x-to-env-id': this.spaceId,
			'x-from-instance-id': timestamp,
			'x-from-function-name': functionName,
			'x-client-timestamp': timestamp,
			'x-alipay-source': 'client',
			'x-request-id': requestId,
			'x-alipay-callid': requestId,
			'x-trace-id': requestId,
			'x-to-function-name': functionName
		}
		const signedHeaders = [
			'x-client-timestamp',
			'x-from-app-id',
			'x-from-env-id',
			'x-from-function-name',
			'x-from-instance-id',
			'x-to-function-name',
			'x-to-env-id'
		].sort()
		const [pathname, query] = splitPathQuery(pathWithQuery)
		const canonicalHeaderLines = signedHeaders.map((k) => `${k}:${headers[k] || ''}\n`).join('')
		const bodyText = JSON.stringify(data || {})
		const bodyHash = sha256Hex(bodyText)
		const canonicalRequest = `POST\n${pathname}\n${query}\n${canonicalHeaderLines}\n${signedHeaders.join(';')}\n${bodyHash}\n`
		const canonicalHash = sha256Hex(canonicalRequest)
		const stringToSign = `HMAC-SHA256\n${timestamp}\n${canonicalHash}\n`
		const signature = hmacSha256Hex(stringToSign, this.secretKey)
		const authorization = `HMAC-SHA256 Credential=${this.accessKey}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
		return {
			url: `${this.endpoint.replace(/\/+$/, '')}${pathname}${query ? `?${query}` : ''}`,
			headers: {
				...headers,
				Authorization: authorization,
				'content-type': 'application/json'
			},
			bodyText
		}
	}

	async callFunction(name, functionArgs) {
		const signed = this.signRequest('/functions/invokeFunction', {
			data: functionArgs,
			functionName: name
		})
		const res = await fetch(signed.url, {
			method: 'POST',
			headers: signed.headers,
			body: signed.bodyText
		})
		const text = await res.text()
		let json = {}
		try {
			json = text ? JSON.parse(text) : {}
		} catch (_) {
			throw new Error(`云函数响应非 JSON status=${res.status}: ${text.slice(0, 200)}`)
		}
		if (!res.ok) throw new Error(`云函数 HTTP ${res.status}: ${JSON.stringify(json)}`)
		return json
	}
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	return fs.readdirSync(base)
		.map((dir) => path.join(base, dir, 'setting.json'))
		.filter((p) => fs.existsSync(p))
}

function deepFindSpace(node, spaceId) {
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = deepFindSpace(item, spaceId)
			if (found) return found
		}
		return null
	}
	if (!node || typeof node !== 'object') return null
	if (node.spaceid === spaceId) {
		if (node.accessKey && node.secretKey && node.spaceAppId) return node
	}
	for (const value of Object.values(node)) {
		const found = deepFindSpace(value, spaceId)
		if (found) return found
	}
	return null
}

function tryLoadSpaceConfig(spaceId) {
	if (!spaceId) return null
	const files = listProjectSettingFiles()
	for (const file of files) {
		try {
			const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
			const found = deepFindSpace(raw, spaceId)
			if (!found) continue
			const config = {
				accessKey: normalizeString(found.accessKey),
				secretKey: normalizeString(found.secretKey),
				spaceAppId: normalizeString(found.spaceAppId),
				endpoint: normalizeString(found.apiEndpoint)
			}
			if (config.accessKey && config.secretKey && config.spaceAppId) return config
		} catch (_) {
			// ignore
		}
	}
	return null
}

function resolveClientOptions(options) {
	let accessKey = normalizeString(options.accessKey)
	let secretKey = normalizeString(options.secretKey)
	let spaceAppId = normalizeString(options.spaceAppId)
	let endpoint = normalizeString(options.endpoint)

	if (!(accessKey && secretKey && spaceAppId)) {
		const loaded = tryLoadSpaceConfig(options.spaceId)
		if (loaded) {
			if (!accessKey) accessKey = loaded.accessKey
			if (!secretKey) secretKey = loaded.secretKey
			if (!spaceAppId) spaceAppId = loaded.spaceAppId
			if (!endpoint) endpoint = loaded.endpoint
		}
	}

	if (!options.spaceId) throw new Error('缺少 space-id')
	if (!accessKey || !secretKey || !spaceAppId) {
		throw new Error('缺少签名参数，请传 --access-key/--secret-key/--space-app-id 或先在 HBuilderX 绑定空间')
	}
	return {
		spaceId: options.spaceId,
		accessKey,
		secretKey,
		spaceAppId,
		endpoint
	}
}

async function ensureCrmToken(client, options) {
	if (options.crmToken) return options.crmToken
	const loginRes = await client.callFunction('crm-auth', {
		action: 'login',
		data: {
			username: options.crmUsername,
			password: options.crmPassword
		},
		request_id: generateRequestId()
	})
	if (!loginRes || loginRes.code !== 0) throw new Error(`CRM 登录失败: ${JSON.stringify(loginRes)}`)
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error('CRM 登录成功但未返回 token')
	return token
}

async function fetchSystemSalesRows(client, crmToken, { dateStart, dateEnd }) {
	const rows = []
	let page = 1
	const pageSize = 50
	let guard = 0
	while (guard < 2000) {
		const res = await client.callFunction('crm-sale', {
			action: 'listV2',
			token: crmToken,
			data: {
				page,
				pageSize,
				dateStart,
				dateEnd
			},
			request_id: generateRequestId()
		})
		if (!res || res.code !== 0) throw new Error(`拉取系统销售失败(page=${page}): ${JSON.stringify(res)}`)
		const list = Array.isArray(res.data) ? res.data : []
		rows.push(...list)
		if (!(res.paging && res.paging.hasMore)) break
		page += 1
		guard += 1
	}
	return rows
}

function readXlsxRowsViaPython(xlsxPath) {
	const python = String.raw`import sys, json, zipfile, re, datetime
import xml.etree.ElementTree as ET

xlsx_path = sys.argv[1]
ns = {
  'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'pr': 'http://schemas.openxmlformats.org/package/2006/relationships'
}

def col_to_index(col):
  v = 0
  for ch in col:
    if 'A' <= ch <= 'Z':
      v = v * 26 + (ord(ch) - 64)
  return max(v - 1, 0)

def as_text(v):
  if v is None:
    return ''
  return str(v).strip()

def parse_amount(v):
  text = as_text(v)
  if not text:
    return None
  text = text.replace(',', '').replace('，', '').replace('￥', '').replace('¥', '').replace(' ', '')
  try:
    return float(text)
  except Exception:
    return None

def parse_date(v):
  text = as_text(v)
  if not text:
    return ''
  if re.match(r'^\d{4}-\d{1,2}-\d{1,2}$', text):
    parts = text.split('-')
    return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
  if re.match(r'^\d{4}/\d{1,2}/\d{1,2}$', text):
    parts = text.split('/')
    return f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
  num = parse_amount(text)
  if num is not None and num > 20000:
    base = datetime.datetime(1899, 12, 30)
    day = base + datetime.timedelta(days=float(num))
    return day.strftime('%Y-%m-%d')
  return text

with zipfile.ZipFile(xlsx_path, 'r') as zf:
  shared = []
  if 'xl/sharedStrings.xml' in zf.namelist():
    ss_root = ET.fromstring(zf.read('xl/sharedStrings.xml'))
    for si in ss_root.findall('a:si', ns):
      chunks = []
      for t in si.findall('.//a:t', ns):
        chunks.append(t.text or '')
      shared.append(''.join(chunks))

  wb = ET.fromstring(zf.read('xl/workbook.xml'))
  sheets = wb.find('a:sheets', ns)
  first_sheet = sheets.findall('a:sheet', ns)[0]
  rid = first_sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id', '')

  rels = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
  target = ''
  for rel in rels.findall('pr:Relationship', ns):
    if rel.attrib.get('Id') == rid:
      target = rel.attrib.get('Target', '')
      break

  if target.startswith('/'):
    target = target[1:]
  elif not target.startswith('xl/'):
    target = 'xl/' + target

  sheet_root = ET.fromstring(zf.read(target))
  raw_rows = []
  for row in sheet_root.findall('.//a:sheetData/a:row', ns):
    row_no = int(row.attrib.get('r', '0') or 0)
    cells = {}
    max_idx = -1
    for c in row.findall('a:c', ns):
      ref = c.attrib.get('r', '')
      m = re.match(r'^([A-Z]+)', ref)
      if not m:
        continue
      idx = col_to_index(m.group(1))
      max_idx = max(max_idx, idx)
      typ = c.attrib.get('t', '')
      val = ''
      if typ == 'inlineStr':
        t_node = c.find('a:is/a:t', ns)
        val = t_node.text if t_node is not None else ''
      else:
        v_node = c.find('a:v', ns)
        val = v_node.text if v_node is not None else ''
      if typ == 's':
        try:
          i = int(val)
          val = shared[i] if 0 <= i < len(shared) else ''
        except Exception:
          val = ''
      cells[idx] = val

    if max_idx < 0:
      continue
    line = []
    for i in range(max_idx + 1):
      line.append(cells.get(i, ''))
    raw_rows.append({'row_no': row_no, 'cells': line})

aliases = {
  'date': ['日期', '销售日期', '出库日期', '时间'],
  'customer': ['客户', '客户名称', '客户单位', '单位'],
  'amount': ['应收', '应收金额', '金额', '货款', '应付'],
  'remark': ['备注', '备注说明', '附注', '说明']
}

header_idx = -1
header_map = {}
for i, row in enumerate(raw_rows[:25]):
  values = [as_text(v) for v in row['cells']]
  found = {}
  for key, keys in aliases.items():
    for col, text in enumerate(values):
      if not text:
        continue
      if any(k in text for k in keys):
        found[key] = col
        break
  if 'customer' in found and 'amount' in found:
    header_idx = i
    header_map = found
    break

if header_idx < 0:
  print(json.dumps({'rows': [], 'error': '未识别到表头（至少需包含客户和金额列）'}, ensure_ascii=False))
  sys.exit(0)

parsed = []
for row in raw_rows[header_idx + 1:]:
  cells = row['cells']
  def pick(k):
    idx = header_map.get(k)
    if idx is None:
      return ''
    if idx < 0 or idx >= len(cells):
      return ''
    return cells[idx]

  customer = as_text(pick('customer'))
  amount = parse_amount(pick('amount'))
  remark = as_text(pick('remark'))
  date = parse_date(pick('date'))

  if not customer and amount is None and not remark and not date:
    continue

  parsed.append({
    'line_no': row['row_no'],
    'date': date,
    'customer_name': customer,
    'amount': amount,
    'remark': remark
  })

print(json.dumps({'rows': parsed, 'error': ''}, ensure_ascii=False))`

	const output = execFileSync('/usr/bin/python3', ['-c', python, xlsxPath], {
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024
	})
	const parsed = JSON.parse(output || '{}')
	if (parsed.error) throw new Error(parsed.error)
	return Array.isArray(parsed.rows) ? parsed.rows : []
}

function toCompareEntry(row, sourceType) {
	const customerName = normalizeString(row && row.customer_name)
	const amount = fix2(toNumber(row && (row.amount != null ? row.amount : row.should_receive), 0) || 0)
	const remark = normalizeString(row && row.remark)
	return {
		source: sourceType,
		line_no: row && row.line_no != null ? Number(row.line_no) : null,
		date: normalizeString(row && row.date),
		customer_name: customerName,
		customer_key: normalizeCustomerKey(customerName),
		amount,
		remark,
		remark_normalized: normalizeRemarkComparable(remark)
	}
}

function buildCompareKey(entry) {
	return `${entry.customer_key}|${entry.amount.toFixed(2)}|${entry.remark_normalized}`
}

function summarizeRemarks(entries) {
	const withRemark = entries.filter((row) => Boolean(row.remark_normalized)).length
	const unique = new Set(entries.filter((row) => row.remark_normalized).map((row) => row.remark_normalized)).size
	const amountTotal = fix2(entries.reduce((sum, row) => sum + (Number(row.amount) || 0), 0))
	return {
		total: entries.length,
		amount_total: amountTotal,
		with_remark: withRemark,
		remark_distinct: unique
	}
}

function buildDiffReport(excelEntries, systemEntries) {
	const excelMap = new Map()
	const systemMap = new Map()

	for (const entry of excelEntries) {
		const key = buildCompareKey(entry)
		if (!excelMap.has(key)) excelMap.set(key, { count: 0, samples: [] })
		const bucket = excelMap.get(key)
		bucket.count += 1
		if (bucket.samples.length < 3) bucket.samples.push(entry)
	}

	for (const entry of systemEntries) {
		const key = buildCompareKey(entry)
		if (!systemMap.has(key)) systemMap.set(key, { count: 0, samples: [] })
		const bucket = systemMap.get(key)
		bucket.count += 1
		if (bucket.samples.length < 3) bucket.samples.push(entry)
	}

	const allKeys = new Set([...excelMap.keys(), ...systemMap.keys()])
	const onlyExcel = []
	const onlySystem = []
	const countMismatch = []

	for (const key of allKeys) {
		const e = excelMap.get(key)
		const s = systemMap.get(key)
		if (e && !s) {
			onlyExcel.push({ key, count: e.count, samples: e.samples })
			continue
		}
		if (!e && s) {
			onlySystem.push({ key, count: s.count, samples: s.samples })
			continue
		}
		if (e.count !== s.count) {
			countMismatch.push({ key, excel_count: e.count, system_count: s.count, excel_samples: e.samples, system_samples: s.samples })
		}
	}

	onlyExcel.sort((a, b) => b.count - a.count)
	onlySystem.sort((a, b) => b.count - a.count)
	countMismatch.sort((a, b) => Math.abs(b.excel_count - b.system_count) - Math.abs(a.excel_count - a.system_count))

	return {
		only_excel_count: onlyExcel.length,
		only_system_count: onlySystem.length,
		count_mismatch_count: countMismatch.length,
		only_excel: onlyExcel,
		only_system: onlySystem,
		count_mismatch: countMismatch
	}
}

async function main() {
	const options = parseArgs(process.argv)
	const xlsxPath = path.resolve(options.xlsx)
	const reportPath = path.resolve(options.report)

	if (!fs.existsSync(xlsxPath)) throw new Error(`xlsx 不存在: ${xlsxPath}`)

	const excelRawRows = readXlsxRowsViaPython(xlsxPath)
	const excelEntries = excelRawRows
		.map((row) => toCompareEntry(row, 'excel'))
		.filter((row) => row.customer_name || row.amount || row.remark_normalized)

	const client = new AlipayFunctionClient(resolveClientOptions(options))
	const crmToken = await ensureCrmToken(client, options)
	const systemRawRows = await fetchSystemSalesRows(client, crmToken, {
		dateStart: options.dateStart,
		dateEnd: options.dateEnd
	})
	const systemEntries = systemRawRows.map((row) => toCompareEntry(row, 'system'))

	const diff = buildDiffReport(excelEntries, systemEntries)
	const report = {
		generated_at: new Date().toISOString(),
		input: {
			xlsx: path.relative(process.cwd(), xlsxPath),
			date_start: options.dateStart,
			date_end: options.dateEnd,
			space_id: options.spaceId
		},
		excel: summarizeRemarks(excelEntries),
		system: summarizeRemarks(systemEntries),
		diff
	}

	ensureDir(reportPath)
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

	console.log(`[done] report => ${path.relative(process.cwd(), reportPath)}`)
	console.log(`[summary] excel=${report.excel.total} system=${report.system.total} only_excel=${diff.only_excel_count} only_system=${diff.only_system_count} mismatch=${diff.count_mismatch_count}`)
}

main().catch((err) => {
	console.error('[error]', err && err.stack ? err.stack : err)
	process.exit(1)
})
