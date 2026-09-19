'use strict'
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const registry = require('../config/domain-contracts.json')
for (const entry of registry.copies) {
	for (const target of entry.targets.filter((file) => file.startsWith('uniCloud-alipay/cloudfunctions/crm-gas-in/'))) {
		fs.copyFileSync(path.join(root, entry.source), path.join(root, target))
	}
}
