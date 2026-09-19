'use strict'

const { AsyncLocalStorage } = require('async_hooks')
const storage = new AsyncLocalStorage()

// Only report actions opt in after ACL validation. Never shared across requests or writes.
const withStatementReads = handler => (event, context) => storage.run({}, () => handler(event, context))
const current = customerId => {
	const value = storage.getStore()?.context
	return value && value.customer._id === customerId ? value : null
}
async function prepare({ customer, collections, saleWhere, command, readComplete }) {
	const scope = storage.getStore()
	if (!scope || !customer) return
	const context = { customer, started: Date.now(), saleWhere, inputs: {} }
	const entries = Object.entries(collections)
	// Bound concurrency to avoid overwhelming the database on large customer histories.
	for (let i = 0; i < entries.length; i += 3) {
		await Promise.all(entries.slice(i, i + 3).map(async ([name, collection]) => {
			context.inputs[name] = await readComplete(collection,
				name === 'sales' ? saleWhere : { customer_id: customer._id },
				{ command, source: `statement.${name}` })
		}))
	}
	scope.context = context
}
function rows(customerId, name, predicate = () => true, sort = ['created_at']) {
	const context = current(customerId)
	if (!context) return null
	return context.inputs[name].filter(predicate).sort((a, b) => {
		for (const key of [...sort, '_id']) {
			const left = a[key] == null ? '' : a[key], right = b[key] == null ? '' : b[key]
			if (left < right) return -1
			if (left > right) return 1
		}
		return 0
	})
}
module.exports = { withStatementReads, current, prepare, rows }
