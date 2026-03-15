#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CYCLE_MONTHS = [6, 12, 24, 36]
const DEFAULT_CSV = 'docs/test0314.cleaned_for_upload.csv'
const DEFAULT_REPORT = 'docs/test0314.upload.report.json'

function parseArgs(argv) {
	const args = {
		csv: DEFAULT_CSV,
		report: DEFAULT_REPORT,
		execute: false,
		scrapYears: 20,
		dryRunSample: 5,
		remark: 'import:test0314',
		spaceId: process.env.UNI_SPACE_ID || '',
		clientSecret: process.env.UNI_CLIENT_SECRET || '',
		endpoint: process.env.UNI_ENDPOINT || '',
		crmToken: process.env.CRM_TOKEN || '',
		crmUsername: process.env.CRM_USERNAME || '',
		crmPassword: process.env.CRM_PASSWORD || ''
	}

	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--csv' && next) {
			args.csv = next
			i += 1
		} else if (cur === '--report' && next) {
			args.report = next
			i += 1
		} else if (cur === '--execute') {
			args.execute = true
		} else if (cur === '--scrap-years' && next) {
			args.scrapYears = Number(next) || 20
			i += 1
		} else if (cur === '--remark' && next) {
			args.remark = next
			i += 1
		} else if (cur === '--space-id' && next) {
			args.spaceId = next
			i += 1
		} else if (cur === '--client-secret' && next) {
			args.clientSecret = next
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
		} else if (cur === '--dry-run-sample' && next) {
			args.dryRunSample = Math.max(Number(next) || 5, 1)
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
  node scripts/uploadBottlesFromCsv.cjs [options]

Options:
  --csv <path>             CSV input path (default: ${DEFAULT_CSV})
  --report <path>          Upload report path (default: ${DEFAULT_REPORT})
  --execute                Actually upload (default is dry-run)
  --scrap-years <num>      Scrap date = manufacture date + years (default: 20)
  --remark <text>          Remark written into bottle records
  --space-id <id>          uniCloud space id (or env UNI_SPACE_ID)
  --client-secret <sec>    uniCloud client secret (or env UNI_CLIENT_SECRET)
  --endpoint <url>         uniCloud endpoint override
  --crm-token <token>      CRM auth token (or env CRM_TOKEN)
  --crm-username <name>    CRM username (or env CRM_USERNAME)
  --crm-password <pass>    CRM password (or env CRM_PASSWORD)
  --dry-run-sample <n>     Dry-run sample lines to print (default: 5)

Examples:
  node scripts/uploadBottlesFromCsv.cjs
  UNI_SPACE_ID=xxx UNI_CLIENT_SECRET=xxx CRM_USERNAME=admin CRM_PASSWORD=pass \\
    node scripts/uploadBottlesFromCsv.cjs --execute
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
		for (let j = 0; j < headers.length; j += 1) {
			row[headers[j]] = (cols[j] || '').trim()
		}
		rows.push({ row, lineNo: i + 1 })
	}
	return { headers, rows }
}

function normalizeText(value) {
	if (value == null) return ''
	return String(value).trim()
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

function requireField(obj, field, lineNo, errors) {
	if (!normalizeText(obj[field])) errors.push(`第 ${lineNo} 行缺少字段：${field}`)
}

function buildPayload(row, lineNo, options) {
	requireField(row, '充装单位', lineNo, options.errors)
	requireField(row, '登记证编号', lineNo, options.errors)
	requireField(row, '设备品种', lineNo, options.errors)
	requireField(row, '单位内编号', lineNo, options.errors)
	requireField(row, '产品编号', lineNo, options.errors)
	requireField(row, '二维码号', lineNo, options.errors)
	requireField(row, '制造日期', lineNo, options.errors)
	requireField(row, '钢瓶检验日期', lineNo, options.errors)
	requireField(row, '钢瓶下次检验日期', lineNo, options.errors)
	requireField(row, '压力表表号', lineNo, options.errors)
	requireField(row, '压力值最小', lineNo, options.errors)
	requireField(row, '压力值最大', lineNo, options.errors)
	requireField(row, '压力表检验日期', lineNo, options.errors)
	requireField(row, '压力表下次检验日期', lineNo, options.errors)
	requireField(row, '安全阀检测日期', lineNo, options.errors)
	requireField(row, '安全阀下次检验日期', lineNo, options.errors)
	requireField(row, '容积(L)', lineNo, options.errors)

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
		bottle_no: normalizeText(row['单位内编号']),
		filling_company: normalizeText(row['充装单位']),
		registration_mark: normalizeText(row['登记证编号']),
		equipment_type: normalizeText(row['设备品种']),
		product_no: normalizeText(row['产品编号']),
		qr_code: normalizeText(row['二维码号']),
		manufacturer: normalizeText(row['制造单位']),
		volume_l: volumeL,
		manufacture_date: manufactureDate,
		bottle_check_date: bottleCheckDate,
		bottle_next_check_date: bottleNextCheckDate,
		bottle_check_cycle_months: inferCycleMonths(bottleCheckDate, bottleNextCheckDate, 36),
		scrap_due_date: scrapDueDate,
		pressure_gauge_no: normalizeText(row['压力表表号']),
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
		status: mapStatus(row['状态']),
		tare_weight: tareWeight,
		is_active: true,
		remark: normalizeText(options.remark)
	}
}

function hmacMd5(text, key) {
	return crypto.createHmac('md5', key).update(text).digest('hex')
}

function buildSignInput(payload) {
	return Object.keys(payload)
		.sort()
		.filter((key) => payload[key])
		.map((key) => `${key}=${payload[key]}`)
		.join('&')
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

class UniCloudHttpClient {
	constructor({ spaceId, clientSecret, endpoint }) {
		if (!spaceId) throw new Error('缺少 spaceId')
		if (!clientSecret) throw new Error('缺少 clientSecret')
		if (typeof fetch !== 'function') throw new Error('当前 Node 版本不支持 fetch，请升级到 Node 18+')
		this.spaceId = spaceId
		this.clientSecret = clientSecret
		this.endpoint = endpoint || (spaceId.startsWith('mp-') ? 'https://api.next.bspapp.com' : 'https://api.bspapp.com')
		this.requestUrl = `${this.endpoint.replace(/\/+$/, '')}/client`
		this.accessToken = ''
	}

	async postServerless(payload, withAuthToken) {
		const body = {
			...payload,
			spaceId: this.spaceId,
			timestamp: Date.now()
		}
		if (withAuthToken) body.token = this.accessToken

		const headers = {
			'content-type': 'application/json'
		}
		if (withAuthToken) headers['x-basement-token'] = this.accessToken
		headers['x-serverless-sign'] = hmacMd5(buildSignInput(body), this.clientSecret)

		const res = await fetch(this.requestUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		})
		const text = await res.text()
		let json = {}
		try {
			json = text ? JSON.parse(text) : {}
		} catch (err) {
			throw new Error(`uniCloud 响应不是 JSON: ${text.slice(0, 200)}`)
		}

		if (!res.ok) {
			throw new Error(`uniCloud HTTP ${res.status}: ${JSON.stringify(json)}`)
		}
		if (json && json.error) {
			throw new Error(`uniCloud error: ${json.error.code || ''} ${json.error.message || ''}`.trim())
		}
		return json
	}

	unwrapResult(response) {
		if (response && response.data != null) return response.data
		if (response && response.result != null) return response.result
		return response
	}

	async ensureAnonymousToken() {
		if (this.accessToken) return this.accessToken
		const authRes = await this.postServerless(
			{
				method: 'serverless.auth.user.anonymousAuthorize',
				params: '{}'
			},
			false
		)
		const data = this.unwrapResult(authRes) || {}
		const token = data.accessToken || data.access_token || data.token || ''
		if (!token) throw new Error(`未拿到 uniCloud accessToken: ${JSON.stringify(authRes)}`)
		this.accessToken = token
		return token
	}

	async callFunction(name, functionArgs) {
		await this.ensureAnonymousToken()
		const invokeRes = await this.postServerless(
			{
				method: 'serverless.function.runtime.invoke',
				params: JSON.stringify({
					functionTarget: name,
					functionArgs
				})
			},
			true
		)

		const data = this.unwrapResult(invokeRes)
		let result = data
		if (data && data.result != null) result = data.result
		if (typeof result === 'string') {
			try {
				return JSON.parse(result)
			} catch (err) {
				return { raw: result }
			}
		}
		return result
	}
}

async function ensureCrmToken(client, options) {
	if (options.crmToken) return options.crmToken
	if (!options.crmUsername || !options.crmPassword) {
		throw new Error('缺少 CRM 登录信息：请提供 --crm-token 或 --crm-username/--crm-password')
	}
	const loginRes = await client.callFunction('crm-auth', {
		action: 'login',
		data: {
			username: options.crmUsername,
			password: options.crmPassword
		},
		request_id: generateRequestId()
	})
	if (!loginRes || loginRes.code !== 0) {
		throw new Error(`CRM 登录失败: ${JSON.stringify(loginRes)}`)
	}
	const token = loginRes.token || (loginRes.user && loginRes.user.token) || ''
	if (!token) throw new Error(`CRM 登录成功但没有 token: ${JSON.stringify(loginRes)}`)
	return token
}

async function run() {
	const options = parseArgs(process.argv)
	const csvAbsPath = path.resolve(process.cwd(), options.csv)
	if (!fs.existsSync(csvAbsPath)) throw new Error(`CSV 文件不存在: ${csvAbsPath}`)

	const content = fs.readFileSync(csvAbsPath, 'utf8')
	const parsed = parseCsv(content)
	const errors = []

	const payloadRows = parsed.rows.map(({ row, lineNo }) => ({
		lineNo,
		payload: buildPayload(row, lineNo, {
			errors,
			scrapYears: Math.max(options.scrapYears, 1),
			remark: options.remark
		})
	}))

	if (errors.length > 0) {
		console.error(`发现 ${errors.length} 条数据问题，已停止：`)
		errors.slice(0, 20).forEach((msg) => console.error(`- ${msg}`))
		if (errors.length > 20) console.error(`... 省略 ${errors.length - 20} 条`)
		process.exit(1)
	}

	console.log(`CSV 解析完成：${payloadRows.length} 条`)
	console.log(`模式：${options.execute ? 'EXECUTE（写入）' : 'DRY-RUN（不写入）'}`)

	if (!options.execute) {
		const sample = payloadRows.slice(0, options.dryRunSample)
		console.log(`Dry-run 样例（前 ${sample.length} 条）：`)
		sample.forEach((item) => {
			console.log(
				JSON.stringify(
					{
						lineNo: item.lineNo,
						bottle_no: item.payload.bottle_no,
						qr_code: item.payload.qr_code,
						pressure_gauge_no: item.payload.pressure_gauge_no,
						bottle_cycle: item.payload.bottle_check_cycle_months,
						gauge_cycle: item.payload.pressure_gauge_cycle_months,
						valve_cycle: item.payload.safety_valve_cycle_months
					},
					null,
					2
				)
			)
		})
		return
	}

	const client = new UniCloudHttpClient({
		spaceId: options.spaceId,
		clientSecret: options.clientSecret,
		endpoint: options.endpoint
	})

	const crmToken = await ensureCrmToken(client, options)
	const report = {
		created: [],
		conflicts: [],
		failed: [],
		started_at: new Date().toISOString(),
		finished_at: '',
		total: payloadRows.length
	}

	for (let i = 0; i < payloadRows.length; i += 1) {
		const item = payloadRows[i]
		const event = {
			action: 'createV1',
			data: item.payload,
			token: crmToken,
			request_id: generateRequestId()
		}
		let res
		try {
			res = await client.callFunction('crm-bottle', event)
		} catch (err) {
			report.failed.push({
				lineNo: item.lineNo,
				bottle_no: item.payload.bottle_no,
				error: err.message
			})
			continue
		}

		if (res && res.code === 0) {
			report.created.push({
				lineNo: item.lineNo,
				bottle_no: item.payload.bottle_no,
				_id: res.data && res.data._id ? res.data._id : ''
			})
		} else if (res && res.code === 409) {
			report.conflicts.push({
				lineNo: item.lineNo,
				bottle_no: item.payload.bottle_no,
				msg: res.msg || '冲突'
			})
		} else {
			report.failed.push({
				lineNo: item.lineNo,
				bottle_no: item.payload.bottle_no,
				msg: res && res.msg ? res.msg : '未知错误',
				raw: res || null
			})
		}

		if ((i + 1) % 20 === 0 || i + 1 === payloadRows.length) {
			console.log(
				`Progress ${i + 1}/${payloadRows.length} | created=${report.created.length} conflict=${report.conflicts.length} failed=${report.failed.length}`
			)
		}
	}

	report.finished_at = new Date().toISOString()
	const reportPath = path.resolve(process.cwd(), options.report)
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

	console.log('上传完成：')
	console.log(`- created:  ${report.created.length}`)
	console.log(`- conflicts:${report.conflicts.length}`)
	console.log(`- failed:   ${report.failed.length}`)
	console.log(`- report:   ${reportPath}`)
}

run().catch((err) => {
	console.error(`执行失败: ${err.message}`)
	process.exit(1)
})
