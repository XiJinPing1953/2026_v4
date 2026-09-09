'use strict'

const crypto = require('crypto')
const stableValue = (value) => Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stableValue(value[key])])) : value

// Preserve the established operation digest exactly; acknowledgement flags do not change business facts.
function fingerprint(data = {}) {
	const { operation_id, preview, ignore_bottle_flow_warning, ignoreBottleFlowWarning, ...input } = data
	return crypto.createHash('sha256').update(JSON.stringify(stableValue(input))).digest('hex')
}

module.exports = { fingerprint }
