#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const DEFAULT_INPUT = 'uniCloud-alipay/database/crm_bottles.init_data.json'
const DEFAULT_REPORT = 'docs/test0314.upsert.report.json'

// Only update archive/static fields; keep runtime state untouched.
const UPDATE_FIELDS = [
	'bottle_no',
	'filling_company',
	'registration_mark',
	'equipment_type',
	'product_no',
	'qr_code',
	'manufacturer',
	'volume_l',
	'manufacture_date',
	'bottle_check_date',
	'bottle_next_check_date',
	'bottle_check_cycle_months',
	'scrap_due_date',
	'pressure_gauge_no',
	'pressure_gauge_manufacturer',
	'pressure_gauge_range_min',
	'pressure_gauge_range_max',
	'pressure_gauge_check_date',
	'pressure_gauge_next_check_date',
	'pressure_gauge_cycle_months',
	'safety_valve_count',
	'safety_valve_check_date',
	'safety_valve_next_check_date',
	'safety_valve_cycle_months',
	'tare_weight'
]

function parseArgs(argv) {
	const args = {
		input: DEFAULT_INPUT,
		report: DEFAULT_REPORT,
		backup: '',
		execute: false,
		spaceId: process.env.UNI_SPACE_ID || '',
		clientSecret: process.env.UNI_CLIENT_SECRET || '',
		endpoint: process.env.UNI_ENDPOINT || '',
		crmToken: process.env.CRM_TOKEN || '',
		crmUsername: process.env.CRM_USERNAME || 'superadmin',
		crmPassword: process.env.CRM_PASSWORD || 'y7ez5CGAbivZkeP'
	}

	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--input' && next) {
			args.input = next
			i += 1
		} else if (cur === '--report' && next) {
			args.report = next
			i += 1
		} else if (cur === '--backup' && next) {
			args.backup = next
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
		} else if (cur === '--execute') {
			args.execute = true
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
  node scripts/upsertBottlesByBottleNo.cjs [options]

Options:
  --input <path>          Source JSON (default: ${DEFAULT_INPUT})
  --report <path>         Report output JSON (default: ${DEFAULT_REPORT})
  --backup <path>         Backup output JSON (auto path when --execute)
  --space-id <id>         uniCloud space id (or env UNI_SPACE_ID)
  --client-secret <sec>   uniCloud client secret (or env UNI_CLIENT_SECRET)
  --endpoint <url>        uniCloud endpoint (optional)
  --crm-token <token>     CRM token (or env CRM_TOKEN)
  --crm-username <name>   CRM username (default: superadmin)
  --crm-password <pass>   CRM password (default in cloudfunction env fallback)
  --execute               Actually update database (default dry-run)

Examples:
  node scripts/upsertBottlesByBottleNo.cjs
  node scripts/upsertBottlesByBottleNo.cjs --execute --space-id env-xxx --client-secret xxx
`)
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function normalizeText(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

function guessSpaceIdFromRecords(records) {
	if (!records.length) return ''
	const remark = normalizeText(records[0].remark)
	if (!remark) return ''
	const match = remark.match(/(env-[a-z0-9]+)/i)
	return match ? match[1] : ''
}

function loadInputRecords(inputPath) {
	const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
	if (!Array.isArray(source) || source.length === 0) throw new Error('输入 JSON 为空或非数组')
	return source
}

function pickPatchPayload(row) {
	const patch = {}
	UPDATE_FIELDS.forEach((key) => {
		if (Object.prototype.hasOwnProperty.call(row, key)) patch[key] = row[key]
	})
	return patch
}

function listProjectSettingFiles() {
	const base = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(base)) return []
	const dirs = fs.readdirSync(base)
	return dirs
		.map((dir) => path.join(base, dir, 'setting.json'))
		.filter((p) => fs.existsSync(p))
}

function deepFindSpace(node, spaceId) {
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i += 1) {
			const found = deepFindSpace(node[i], spaceId)
			if (found) return found
		}
		return null
	}
	if (!node || typeof node !== 'object') return null
	if (node.spaceid === spaceId && node.clientSecret) return node
	const values = Object.values(node)
	for (let i = 0; i < values.length; i += 1) {
		const found = deepFindSpace(values[i], spaceId)
		if (found) return found
	}
	return null
}

function tryLoadSpaceConfig(spaceId) {
	if (!spaceId) return null
	const files = listProjectSettingFiles()
	for (let i = 0; i < files.length; i += 1) {
		try {
			const raw = JSON.parse(fs.readFileSync(files[i], 'utf8'))
			const found = deepFindSpace(raw, spaceId)
			if (found) {
				return {
					clientSecret: normalizeText(found.clientSecret),
					endpoint: normalizeText(found.apiEndpoint),
					from: files[i]
				}
			}
		} catch (err) {
			// ignore bad setting files and continue
		}
	}
	return null
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

async function findExactByBottleNo(client, crmToken, bottleNo) {
	const listRes = await client.callFunction('crm-bottle', {
		action: 'listV1',
		token: crmToken,
		data: {
			keyword: bottleNo,
			page: 1,
			pageSize: 50
		},
		request_id: generateRequestId()
	})
	if (!listRes || listRes.code !== 0) {
		throw new Error(`listV1 失败: ${JSON.stringify(listRes)}`)
	}
	const list = Array.isArray(listRes.data) ? listRes.data : []
	const normalized = normalizeBottleNo(bottleNo)
	return list.filter((item) => normalizeBottleNo(item.bottle_no) === normalized)
}

function formatTs(ts = Date.now()) {
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	const hh = String(d.getHours()).padStart(2, '0')
	const mm = String(d.getMinutes()).padStart(2, '0')
	const ss = String(d.getSeconds()).padStart(2, '0')
	return `${y}${m}${day}-${hh}${mm}${ss}`
}

async function run() {
	const options = parseArgs(process.argv)
	const inputPath = path.resolve(process.cwd(), options.input)
	if (!fs.existsSync(inputPath)) throw new Error(`输入文件不存在: ${inputPath}`)

	const source = loadInputRecords(inputPath)
	if (!options.spaceId) {
		options.spaceId = guessSpaceIdFromRecords(source)
	}

	const loadedSpace = tryLoadSpaceConfig(options.spaceId)
	if (!options.clientSecret && loadedSpace) options.clientSecret = loadedSpace.clientSecret
	if (!options.endpoint && loadedSpace) options.endpoint = loadedSpace.endpoint
	if (!options.spaceId) throw new Error('缺少 spaceId，请用 --space-id 提供')
	if (!options.clientSecret) throw new Error('缺少 clientSecret，请用 --client-secret 提供')

	const mode = options.execute ? 'EXECUTE（写入）' : 'DRY-RUN（不写入）'
	console.log(`待处理记录: ${source.length}`)
	console.log(`模式: ${mode}`)
	console.log(`空间: ${options.spaceId}`)
	if (loadedSpace && loadedSpace.from) {
		console.log(`已自动加载空间配置: ${loadedSpace.from}`)
	}

	const client = new UniCloudHttpClient({
		spaceId: options.spaceId,
		clientSecret: options.clientSecret,
		endpoint: options.endpoint
	})

	const crmToken = await ensureCrmToken(client, options)
	const report = {
		started_at: new Date().toISOString(),
		finished_at: '',
		mode: options.execute ? 'execute' : 'dry-run',
		total: source.length,
		matched: 0,
		updated: 0,
		missing: [],
		duplicated: [],
		conflicts: [],
		failed: []
	}
	const backup = []

	for (let i = 0; i < source.length; i += 1) {
		const row = source[i]
		const bottleNo = normalizeText(row.bottle_no)
		if (!bottleNo) {
			report.failed.push({ index: i + 1, error: '缺少 bottle_no' })
			continue
		}

		let exactMatches
		try {
			exactMatches = await findExactByBottleNo(client, crmToken, bottleNo)
		} catch (err) {
			report.failed.push({
				index: i + 1,
				bottle_no: bottleNo,
				error: err.message
			})
			continue
		}

		if (exactMatches.length === 0) {
			report.missing.push(bottleNo)
			continue
		}
		if (exactMatches.length > 1) {
			report.duplicated.push({
				bottle_no: bottleNo,
				ids: exactMatches.map((it) => it._id).slice(0, 10)
			})
			continue
		}

		const existing = exactMatches[0]
		report.matched += 1
		if (!options.execute) continue

		const patch = pickPatchPayload(row)
		backup.push(existing)

		try {
			const updateRes = await client.callFunction('crm-bottle', {
				action: 'updateV1',
				token: crmToken,
				data: {
					_id: existing._id,
					...patch
				},
				request_id: generateRequestId()
			})

			if (updateRes && updateRes.code === 0) {
				report.updated += 1
			} else if (updateRes && updateRes.code === 409) {
				report.conflicts.push({
					bottle_no: bottleNo,
					_id: existing._id,
					msg: updateRes.msg || '冲突'
				})
			} else {
				report.failed.push({
					bottle_no: bottleNo,
					_id: existing._id,
					msg: updateRes && updateRes.msg ? updateRes.msg : '未知错误',
					raw: updateRes || null
				})
			}
		} catch (err) {
			report.failed.push({
				bottle_no: bottleNo,
				_id: existing._id,
				error: err.message
			})
		}

		if ((i + 1) % 20 === 0 || i + 1 === source.length) {
			console.log(
				`Progress ${i + 1}/${source.length} | matched=${report.matched} updated=${report.updated} missing=${report.missing.length} dup=${report.duplicated.length} conflict=${report.conflicts.length} failed=${report.failed.length}`
			)
		}
	}

	report.finished_at = new Date().toISOString()
	report.missing = report.missing.slice(0, 50)
	report.duplicated = report.duplicated.slice(0, 50)
	report.conflicts = report.conflicts.slice(0, 50)
	report.failed = report.failed.slice(0, 50)

	const reportPath = path.resolve(process.cwd(), options.report)
	ensureDir(reportPath)
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

	let backupPath = ''
	if (options.execute) {
		backupPath = options.backup
			? path.resolve(process.cwd(), options.backup)
			: path.resolve(process.cwd(), `docs/test0314.upsert.backup.${formatTs()}.json`)
		ensureDir(backupPath)
		fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
	}

	console.log('执行完成：')
	console.log(`- matched:   ${report.matched}`)
	console.log(`- updated:   ${report.updated}`)
	console.log(`- missing:   ${report.missing.length}`)
	console.log(`- duplicated:${report.duplicated.length}`)
	console.log(`- conflict:  ${report.conflicts.length}`)
	console.log(`- failed:    ${report.failed.length}`)
	console.log(`- report:    ${reportPath}`)
	if (backupPath) console.log(`- backup:    ${backupPath}`)
}

run().catch((err) => {
	console.error(`执行失败: ${err.message}`)
	process.exit(1)
})
