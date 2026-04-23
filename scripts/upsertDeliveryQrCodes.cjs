#!/usr/bin/env node
'use strict'

const {
	buildDeliveryUniqKey,
	generateRequestId,
	normalizeCode,
	normalizeName,
	normalizePhone,
	normalizeString,
	parseDeliveryUniqKey,
	runQrImport
} = require('./lib/qrImportCommon.cjs')

function printHelp() {
	console.log(`
Usage:
  node scripts/upsertDeliveryQrCodes.cjs [options]

Input fields:
  uniq_key,name,phone,qr_code
  其中 uniq_key 与 name/phone 至少提供一组；qr_code 必填。

Options:
  --input <path>          CSV/JSON input path (default: docs/delivery_qr_codes.csv)
  --report <path>         Report output JSON (default: docs/delivery_qr_codes.report.json)
  --backup <path>         Backup output JSON (default auto timestamp when --execute)
  --space-id <id>         uniCloud space id (or env UNI_SPACE_ID)
  --client-secret <sec>   uniCloud client secret (or env UNI_CLIENT_SECRET)
  --endpoint <url>        uniCloud endpoint (optional)
  --crm-token <token>     CRM token (or env CRM_TOKEN)
  --crm-username <name>   CRM username (default: superadmin)
  --crm-password <pass>   CRM password
  --execute               Actually update qr_code
`)
}

runQrImport({
	entity: 'delivery',
	functionName: 'crm-delivery',
	defaultInput: 'docs/delivery_qr_codes.csv',
	defaultReport: 'docs/delivery_qr_codes.report.json',
	backupPrefix: 'delivery_qr_codes',
	printHelp,
	normalizeInput(row, lineNo) {
		const rawUniqKey = normalizeString(row.uniq_key || row['唯一键'])
		const parsedUniq = parseDeliveryUniqKey(rawUniqKey)
		const name = normalizeName(row.name || row['配送员姓名'] || parsedUniq.name)
		const phone = normalizePhone(row.phone || row['电话'] || row['手机号'] || parsedUniq.phone)
		const uniqKey = rawUniqKey || buildDeliveryUniqKey(name, phone)
		const nextCode = normalizeCode(row.qr_code || row['二维码'] || row['二维码号'])
		const errors = []
		if (!uniqKey && !name) errors.push('缺少 uniq_key 或配送员姓名')
		if (!name) errors.push('配送员至少要有姓名用于命中')
		if (!nextCode) errors.push('缺少 qr_code')
		return {
			lineNo,
			lookupKey: uniqKey || `${name}|${phone || '-'}`,
			nextCode,
			uniqKey,
			name,
			phone,
			errors
		}
	},
	describeInput(row) {
		return {
			uniq_key: normalizeString(row?.uniqKey),
			name: normalizeString(row?.name),
			phone: normalizeString(row?.phone)
		}
	},
	async findMatches({ client, crmToken, row }) {
		const keyword = normalizeString(row.phone || row.name)
		const listRes = await client.callFunction('crm-delivery', {
			action: 'listV1',
			token: crmToken,
			data: {
				keyword,
				page: 1,
				pageSize: 50
			},
			request_id: generateRequestId()
		})
		if (!listRes || listRes.code !== 0) throw new Error(`crm-delivery.listV1 失败: ${JSON.stringify(listRes)}`)
		const list = Array.isArray(listRes.data) ? listRes.data : []
		return list.filter((item) => {
			const itemUniq = buildDeliveryUniqKey(item?.name, item?.phone)
			if (row.uniqKey) return itemUniq === row.uniqKey
			if (row.name && normalizeName(item?.name) !== row.name) return false
			if (row.phone && normalizePhone(item?.phone) !== row.phone) return false
			return true
		})
	},
	readExistingCode(existing) {
		return existing?.qr_code
	},
	buildPatch(existing, row) {
		return {
			_id: existing._id,
			qr_code: row.nextCode
		}
	}
}).catch((err) => {
	console.error('[upsertDeliveryQrCodes] FAIL', err && err.stack ? err.stack : err)
	process.exitCode = 1
})
