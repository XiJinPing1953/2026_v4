#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

const CHECK_SCRIPTS = [
	'scripts/checkProjectContext.cjs',
	'scripts/syncDomainContracts.cjs',
	'scripts/checkReleaseIntegrity.cjs'
]

const TEST_FILES = [
	'scripts/checkProjectContext.test.cjs',
	'scripts/financeTrust.test.cjs',
	'scripts/mainlineAccounting.test.cjs',
	'scripts/accountingLedgerPrecision.test.cjs',
	'scripts/accountingReconciliationIntegration.test.cjs',
	'scripts/periodSummary.test.cjs',
	'scripts/periodSummaryCustomerScope.test.cjs',
	'scripts/haonuoReconciliation.test.cjs',
	'scripts/reconciledSaleStatus.test.cjs',
	'scripts/frontendTrust.test.cjs',
	'scripts/fillingConsistency.test.cjs',
	'scripts/releaseEvidence.test.cjs',
	'scripts/syncDomainContracts.test.cjs',
	'scripts/collectLegacyM3Evidence.test.cjs',
	'scripts/bottleAnomalyArchiveCutoff.test.cjs',
	'scripts/bottleAnomalyMissingFillPermission.test.cjs',
	'scripts/crmFillingMaintenance.test.cjs',
	'scripts/gasBusinessTime.test.cjs',
	'scripts/gasInventoryCurrent.test.cjs'
]

const SYNTAX_FILES = [
	'scripts/verifyTrust.cjs',
	'scripts/syncDomainContracts.cjs',
	'scripts/checkReleaseIntegrity.cjs',
	'scripts/createReleaseManifest.cjs',
	'scripts/writeH5Version.cjs',
	'scripts/buildWebWithCloudSpace.cjs',
	'scripts/releaseWeb.cjs',
	'uniCloud-alipay/cloudfunctions/common/saleAccounting.js',
	'uniCloud-alipay/cloudfunctions/common/financialRead.js',
	'uniCloud-alipay/cloudfunctions/common/bottleFlowRules.js',
	'uniCloud-alipay/cloudfunctions/crm-sale/index.js',
	'uniCloud-alipay/cloudfunctions/crm-dashboard/index.js',
	'uniCloud-alipay/cloudfunctions/crm-collection/index.js',
	'uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js',
	'uniCloud-alipay/cloudfunctions/crm-filling/index.js',
	'uniCloud-alipay/cloudfunctions/crm-filling/fillingOperations.js',
	'uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js',
	'uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js'
]

function runNode(args, label) {
	const resolvedArgs = args.map((item) => item.startsWith('-') ? item : path.resolve(ROOT, item))
	const result = spawnSync(process.execPath, resolvedArgs, {
		cwd: ROOT,
		stdio: 'inherit'
	})
	if (result.error) throw result.error
	if (result.status !== 0) throw new Error(`${label}失败，退出码 ${result.status}`)
}

function verifyJson() {
	const roots = [path.join(ROOT, 'config'), path.join(ROOT, 'uniCloud-alipay/database')]
	const files = [path.join(ROOT, 'package.json')]
	for (const directory of roots) {
		for (const name of fs.readdirSync(directory)) {
			if (name.endsWith('.json')) files.push(path.join(directory, name))
		}
	}
	for (const file of files) JSON.parse(fs.readFileSync(file, 'utf8'))
	console.log(`[trust] JSON 结构检查通过：${files.length} 个文件`)
}

function main() {
	for (const script of CHECK_SCRIPTS) runNode([script], path.basename(script))
	for (const file of SYNTAX_FILES) runNode(['--check', file], `${file} 语法检查`)
	verifyJson()
	runNode(['--test', ...TEST_FILES], '可信度反例测试')
	console.log(`[trust] 全部通过：${CHECK_SCRIPTS.length} 个检查器、${SYNTAX_FILES.length} 个语法入口、${TEST_FILES.length} 组测试`)
}

try {
	main()
} catch (error) {
	console.error(error && error.message ? error.message : String(error))
	process.exitCode = 1
}
