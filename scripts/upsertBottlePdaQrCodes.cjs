#!/usr/bin/env node
'use strict'

const {
	generateRequestId,
	normalizeBottleNo,
	normalizeCode,
	normalizeString,
	runQrImport
} = require('./lib/qrImportCommon.cjs')

function printHelp() {
	console.log(`
Usage:
  node scripts/upsertBottlePdaQrCodes.cjs [options]

Input fields:
  bottle_no,pda_qr_code

Options:
  --input <path>          CSV/JSON input path (default: docs/pda_qr_bottles.csv)
  --report <path>         Report output JSON (default: docs/pda_qr_bottles.report.json)
  --backup <path>         Backup output JSON (default auto timestamp when --execute)
  --space-id <id>         uniCloud space id (or env UNI_SPACE_ID)
  --client-secret <sec>   uniCloud client secret (or env UNI_CLIENT_SECRET)
  --endpoint <url>        uniCloud endpoint (optional)
  --crm-token <token>     CRM token (or env CRM_TOKEN)
  --crm-username <name>   CRM username (default: superadmin)
  --crm-password <pass>   CRM password
  --execute               Actually update pda_qr_code

Examples:
  node scripts/upsertBottlePdaQrCodes.cjs
  node scripts/upsertBottlePdaQrCodes.cjs --execute --space-id env-xxx
`)
}

runQrImport({
	entity: 'bottle',
	functionName: 'crm-bottle',
	defaultInput: 'docs/pda_qr_bottles.csv',
	defaultReport: 'docs/pda_qr_bottles.report.json',
	backupPrefix: 'pda_qr_bottles',
	printHelp,
	normalizeInput(row, lineNo) {
		const bottleNo = normalizeBottleNo(row.bottle_no || row['瓶号'] || row['钢瓶号'])
		const nextCode = normalizeCode(row.pda_qr_code || row['PDA二维码'] || row['pda二维码'])
		const errors = []
		if (!bottleNo) errors.push('缺少 bottle_no')
		if (!nextCode) errors.push('缺少 pda_qr_code')
		return {
			lineNo,
			lookupKey: bottleNo,
			nextCode,
			bottleNo,
			errors
		}
	},
	describeInput(row) {
		return {
			bottle_no: normalizeString(row?.bottleNo)
		}
	},
	async findMatches({ client, crmToken, row }) {
		const listRes = await client.callFunction('crm-bottle', {
			action: 'listV1',
			token: crmToken,
			data: {
				keyword: row.bottleNo,
				page: 1,
				pageSize: 50
			},
			request_id: generateRequestId()
		})
		if (!listRes || listRes.code !== 0) throw new Error(`crm-bottle.listV1 失败: ${JSON.stringify(listRes)}`)
		const list = Array.isArray(listRes.data) ? listRes.data : []
		return list.filter((item) => normalizeBottleNo(item?.bottle_no) === row.bottleNo)
	},
	readExistingCode(existing) {
		return existing?.pda_qr_code
	},
	buildPatch(existing, row) {
		return {
			_id: existing._id,
			pda_qr_code: row.nextCode
		}
	}
}).catch((err) => {
	console.error('[upsertBottlePdaQrCodes] FAIL', err && err.stack ? err.stack : err)
	process.exitCode = 1
})
