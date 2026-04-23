#!/usr/bin/env node
'use strict'

const {
	callListAll,
	collectDuplicateSamples,
	ensureCrmToken,
	parseStandardArgs,
	prepareClientOptions,
	writeJsonFile
} = require('./lib/qrImportCommon.cjs')

function printHelp() {
	console.log(`
Usage:
  node scripts/auditPdaQrMasters.cjs [options]

Options:
  --report <path>         Report output JSON (default: docs/pda_qr_audit.report.json)
  --sample-limit <n>      Duplicate sample limit (default: 20)
  --space-id <id>         uniCloud space id (or env UNI_SPACE_ID)
  --client-secret <sec>   uniCloud client secret (or env UNI_CLIENT_SECRET)
  --endpoint <url>        uniCloud endpoint (optional)
  --crm-token <token>     CRM token (or env CRM_TOKEN)
  --crm-username <name>   CRM username (default: superadmin)
  --crm-password <pass>   CRM password
`)
}

function buildEntitySummary(rows, { valueField = 'qr_code', idField = '_id', labelField = '' } = {}, sampleLimit = 20) {
	const list = Array.isArray(rows) ? rows : []
	let empty = 0
	list.forEach((row) => {
		if (!row?.[valueField]) empty += 1
	})
	return {
		total: list.length,
		empty: {
			[valueField]: empty
		},
		duplicates: {
			[valueField]: collectDuplicateSamples(list, {
				valueSelector: valueField,
				idSelector: idField,
				labelSelector: labelField ? (row) => row?.[labelField] : null,
				sampleLimit
			})
		}
	}
}

async function run() {
	const options = parseStandardArgs(process.argv, {
		report: 'docs/pda_qr_audit.report.json',
		sampleLimit: 20
	})
	if (options.help) {
		printHelp()
		return
	}

	const { loadedSpace, client } = await prepareClientOptions(options)
	const crmToken = await ensureCrmToken(client, options)
	console.log(`空间: ${options.spaceId}`)
	if (loadedSpace?.from) console.log(`已自动加载空间配置: ${loadedSpace.from}`)

	const [bottleAudit, customerRows, deliveryRows, vehicleRows] = await Promise.all([
		client.callFunction('crm-bottle', {
			action: 'auditUniqueFieldsV1',
			token: crmToken,
			data: {
				sampleLimit: options.sampleLimit
			}
		}),
		callListAll(client, crmToken, 'crm-customer', { summaryIgnoreActive: true }, { pageSize: 50 }),
		callListAll(client, crmToken, 'crm-delivery', {}, { pageSize: 50 }),
		callListAll(client, crmToken, 'crm-vehicle', {}, { pageSize: 50 })
	])

	if (!bottleAudit || bottleAudit.code !== 0) {
		throw new Error(`crm-bottle.auditUniqueFieldsV1 失败: ${JSON.stringify(bottleAudit)}`)
	}

	const report = {
		started_at: new Date().toISOString(),
		finished_at: new Date().toISOString(),
		bottle: bottleAudit.data || {},
		customer: buildEntitySummary(customerRows, { valueField: 'qr_code', idField: '_id', labelField: 'name' }, options.sampleLimit),
		delivery: buildEntitySummary(deliveryRows, { valueField: 'qr_code', idField: '_id', labelField: 'name' }, options.sampleLimit),
		vehicle: buildEntitySummary(vehicleRows, { valueField: 'qr_code', idField: '_id', labelField: 'plate_no' }, options.sampleLimit)
	}

	const reportPath = writeJsonFile(options.report, report)
	console.log('审计完成：')
	console.log(`- bottle.total:   ${report.bottle?.total || 0}`)
	console.log(`- customer.total: ${report.customer.total}`)
	console.log(`- delivery.total: ${report.delivery.total}`)
	console.log(`- vehicle.total:  ${report.vehicle.total}`)
	console.log(`- report:         ${reportPath}`)
}

run().catch((err) => {
	console.error('[auditPdaQrMasters] FAIL', err && err.stack ? err.stack : err)
	process.exitCode = 1
})
