'use strict'

const normalize = value => String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, '')

// Call inside the source transaction, before committing either a sale or a
// reweigh. A real shared write also protects against newly inserted departures
// that a snapshot query cannot see. No new collection or schema is needed.
async function touchBottleSources(database, command, numbers, now = Date.now()) {
	for (const no of [...new Set(numbers.map(normalize).filter(Boolean))].sort()) {
		const values = /^\d+$/.test(no) ? [no, Number(no)] : [no]
		const result = await database.collection('crm_bottles').where({ bottle_no: command.in(values) }).limit(2).get()
		const rows = result.data
		if (!Array.isArray(rows) || rows.length > 1) throw new Error(`钢瓶 ${no} 档案未唯一匹配，请先核查`)
		// Historical sale rows may reference an unregistered bottle. Such a bottle
		// cannot pass the reweigh service's existing unique-archive validation.
		if (!rows.length) continue
		await database.collection('crm_bottles').doc(rows[0]._id).update({ updated_at: Math.max(now, Number(rows[0].updated_at || 0) + 1) })
	}
}

module.exports = { touchBottleSources }
