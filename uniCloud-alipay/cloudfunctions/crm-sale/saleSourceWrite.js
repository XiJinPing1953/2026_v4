'use strict'

const { touchBottleSources } = require('./bottleSourceGuardLocal')
const numbers = doc => ['out_items', 'back_items', 'agent_sale_items'].flatMap(field => (doc?.[field] || []).map(row => row.bottle_no))

async function guardSaleSource(database, command, before, after) {
	await touchBottleSources(database, command, [...numbers(before), ...numbers(after)])
}

// Only the source write belongs here; existing accounting/flow follow-up keeps
// its existing recovery semantics. Mobile creation supplies its own transaction.
async function writeSaleSource(db, before, after, write) {
	const tx = await db.startTransaction()
	try {
		if (before) {
			const result = await tx.collection('crm_sale_records').doc(before._id).get()
			const current = Array.isArray(result.data) ? result.data[0] : result.data
			// guardMutation can close an expired mobile receipt in this same request.
			// Accept only its terminal metadata transition; compare every business field.
			const closed = before.mobile_create_operation_key && before.mobile_create_state === 'processing'
				&& ['pending_review', 'completed'].includes(current?.mobile_create_state)
			const comparable = closed ? { ...current, mobile_create_state: before.mobile_create_state, updated_at: before.updated_at } : current
			if (JSON.stringify(comparable) !== JSON.stringify(before)) throw new Error('销售单已变化，请刷新后重试')
		}
		await guardSaleSource(tx, db.command, before, after)
		const result = await write(tx)
		await tx.commit()
		return result
	} catch (error) {
		await tx.rollback().catch(() => {})
		throw error
	}
}

module.exports = { guardSaleSource, writeSaleSource }
