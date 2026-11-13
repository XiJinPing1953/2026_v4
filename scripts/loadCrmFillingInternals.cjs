'use strict'

// Load the real crm-filling cloud function against a fake database and expose
// selected internals for tests (same vm technique as bottleAnomalyRefreshScan.test.cjs).
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const FILE = path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions/crm-filling/index.js')
const EXPOSE = ['replaceFillingStartLossAdjustmentForDoc', 'isStartLossSyncCandidate', 'normalizeBottleNo',
	'normalizeFillingDate', 'startLossAdjustId', 'buildFillingStartLossAdjustDoc', 'syncStartLossAdjustmentsV1', 'recordLog']

function loadCrmFilling(db, { callFunction = async () => ({ result: { code: 0 } }) } = {}) {
	const sandbox = {
		require: createRequire(FILE), exports: {}, module: { exports: {} }, console, process, Buffer,
		setTimeout, clearTimeout, setImmediate, structuredClone, Date, Math, JSON, Promise,
		uniCloud: { database: () => db, callFunction }
	}
	sandbox.exports = sandbox.module.exports
	const code = `${fs.readFileSync(FILE, 'utf8')}\nmodule.exports.__test = { ${EXPOSE.join(', ')} };`
	vm.runInNewContext(code, sandbox, { filename: FILE })
	const main = sandbox.module.exports.main || sandbox.exports.main
	return { main, ...sandbox.module.exports.__test }
}

module.exports = { loadCrmFilling }
