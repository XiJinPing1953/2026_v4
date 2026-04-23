#!/usr/bin/env node
'use strict'

const {
	buildVehicleUniqKey,
	generateRequestId,
	normalizeCode,
	normalizePlateNo,
	normalizeString,
	runQrImport
} = require('./lib/qrImportCommon.cjs')

function printHelp() {
	console.log(`
Usage:
  node scripts/upsertVehicleQrCodes.cjs [options]

Input fields:
  uniq_key,plate_no,qr_code
  其中 uniq_key 与 plate_no 至少提供一组；qr_code 必填。

Options:
  --input <path>          CSV/JSON input path (default: docs/vehicle_qr_codes.csv)
  --report <path>         Report output JSON (default: docs/vehicle_qr_codes.report.json)
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
	entity: 'vehicle',
	functionName: 'crm-vehicle',
	defaultInput: 'docs/vehicle_qr_codes.csv',
	defaultReport: 'docs/vehicle_qr_codes.report.json',
	backupPrefix: 'vehicle_qr_codes',
	printHelp,
	normalizeInput(row, lineNo) {
		const uniqKey = normalizeString(row.uniq_key || row['唯一键'])
		const plateNo = normalizePlateNo(row.plate_no || row['车牌号'] || uniqKey)
		const nextCode = normalizeCode(row.qr_code || row['二维码'] || row['二维码号'])
		const errors = []
		if (!plateNo && !uniqKey) errors.push('缺少 plate_no 或 uniq_key')
		if (!nextCode) errors.push('缺少 qr_code')
		return {
			lineNo,
			lookupKey: uniqKey || plateNo,
			nextCode,
			uniqKey: uniqKey || buildVehicleUniqKey(plateNo),
			plateNo,
			errors
		}
	},
	describeInput(row) {
		return {
			uniq_key: normalizeString(row?.uniqKey),
			plate_no: normalizeString(row?.plateNo)
		}
	},
	async findMatches({ client, crmToken, row }) {
		const listRes = await client.callFunction('crm-vehicle', {
			action: 'listV1',
			token: crmToken,
			data: {
				keyword: row.plateNo || row.uniqKey,
				page: 1,
				pageSize: 50
			},
			request_id: generateRequestId()
		})
		if (!listRes || listRes.code !== 0) throw new Error(`crm-vehicle.listV1 失败: ${JSON.stringify(listRes)}`)
		const list = Array.isArray(listRes.data) ? listRes.data : []
		return list.filter((item) => buildVehicleUniqKey(item?.plate_no) === row.uniqKey)
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
	console.error('[upsertVehicleQrCodes] FAIL', err && err.stack ? err.stack : err)
	process.exitCode = 1
})
