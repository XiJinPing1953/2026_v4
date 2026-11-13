'use strict'

// Independent recomputation of the filling start-loss ("上秤差") derived
// adjustments for one bottle, from raw fillings, back movements and the sale
// documents they point to. It re-implements the documented rule rather than
// calling crm-filling code:
//   basis   = latest return of the same bottle dated <= filling date
//             (ordered like the production movement lookup: date, updated_at,
//             created_at descending), value = back gross, else tare + net
//   loss    = round3(basis - weight_start); 0 => no adjustment expected
//   only inventory-linked fillings (normal_fill / truck_out_agent_sale / blank)
//   with weight_start > 0 can carry an adjustment
// Each filling gets exactly one class; "fillings != adjustments" is never used
// as evidence of a missing row.

const REASON = 'filling_start_weight_loss'
const LINKED = new Set(['normal_fill', 'truck_out_agent_sale'])
const text = (v) => (v == null ? '' : String(v).trim())
const num = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const round3 = (v) => Math.round(Number(v) * 1000) / 1000
const bottleKey = (v) => text(v).toUpperCase().replace(/\s+/g, '')
const pad = (n) => String(n).padStart(2, '0')

function parseDay(value, fallbackTs) {
	const t = text(value)
	const ok = (y, m, d) => {
		y = Number(y); m = Number(m); d = Number(d)
		if (!(y >= 1970 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate())) return ''
		return `${y}-${pad(m)}-${pad(d)}`
	}
	const tsDay = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10)
	if (!t) return fallbackTs ? tsDay(Number(fallbackTs)) : ''
	let m = t.match(/^(\d{4})(\d{2})(\d{2})$/)
	if (m) return ok(m[1], m[2], m[3])
	m = t.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
	if (m) return ok(m[1], m[2], m[3])
	if (/^\d{10,13}$/.test(t)) return tsDay(t.length === 10 ? Number(t) * 1000 : Number(t))
	return ''
}

function backBasis(item) {
	const gross = num(item && item.gross)
	if (gross != null && gross > 0) return { value: round3(gross), source: 'back_gross' }
	const tare = num(item && item.tare)
	const net = num(item && item.net)
	if (tare != null && tare >= 0 && net != null && net >= 0 && round3(tare + net) > 0) return { value: round3(tare + net), source: 'back_tare_plus_net' }
	return null
}

const cmpDesc = (a, b) => (a < b ? 1 : a > b ? -1 : 0)

function auditBottle({ bottleNo, fillings = [], movements = [], salesById = new Map() }) {
	const no = bottleKey(bottleNo)
	const adjustments = movements.filter((m) => text(m.adjust_reason) === REASON && text(m.source_type) === 'manual_fix')
	const bySource = new Map()
	for (const a of adjustments) {
		const key = text(a.source_id)
		if (!bySource.has(key)) bySource.set(key, [])
		bySource.get(key).push(a)
	}
	const backs = movements
		.filter((m) => text(m.type) === 'back' && text(m.source_type) === 'sale' && bottleKey(m.bottle_no) === no)
		.sort((a, b) => cmpDesc(text(a.date), text(b.date)) || cmpDesc(Number(a.updated_at) || 0, Number(b.updated_at) || 0) ||
			cmpDesc(Number(a.created_at) || 0, Number(b.created_at) || 0))
	const fillingById = new Map(fillings.map((f) => [text(f._id), f]))
	const issues = { movement_sale_missing: [], movement_date_differs: [] }

	// candidate returns: { saleId, date, basis }
	const returns = []
	const seenSale = new Set()
	for (const m of backs) {
		const saleId = text(m.source_id)
		if (!saleId || seenSale.has(saleId)) continue
		seenSale.add(saleId)
		const sale = salesById.get(saleId)
		if (!sale) { issues.movement_sale_missing.push(saleId); continue }
		if (text(sale.date) !== text(m.date)) issues.movement_date_differs.push({ sale_id: saleId, sale_date: text(sale.date), movement_date: text(m.date) })
		const item = (sale.back_items || []).find((row) => bottleKey(row.bottle_no) === no && backBasis(row))
		returns.push({ saleId, movementDate: text(m.date), saleDate: parseDay(sale.date), basis: item ? backBasis(item) : null })
	}

	const rows = []
	for (const f of fillings) {
		const id = text(f._id)
		const docs = bySource.get(id) || []
		const recordType = text(f.record_type).toLowerCase() || 'normal_fill'
		const weightStart = num(f.weight_start)
		const day = parseDay(f.date, f.created_at)
		const base = { filling_id: id, date: text(f.date), docs: docs.length, doc_ids: docs.map((d) => d._id) }
		const candidate = LINKED.has(recordType) && weightStart != null && weightStart > 0
		if (!candidate) { rows.push({ ...base, class: docs.length ? 'stale_not_candidate' : 'not_candidate' }); continue }
		if (!day) { rows.push({ ...base, class: 'date_unparsed' }); continue }

		const confirmed = docs.find((d) => text(d.context && d.context.basis_source) === 'confirmed_previous_fill_end')
		if (confirmed) {
			const prev = fillingById.get(text(confirmed.context.basis_ref))
			const expected = prev && num(prev.weight_end) != null ? round3(num(prev.weight_end) - weightStart) : null
			const cls = docs.length > 1 ? 'duplicate' : expected == null ? 'confirmed_unverifiable'
				: round3(confirmed.loss_weight) === expected ? 'confirmed_ok' : 'confirmed_value_mismatch'
			rows.push({ ...base, class: cls, expected_loss: expected, stored_loss: num(confirmed.loss_weight) })
			continue
		}

		// Both the movement and its current source sale must precede the filling.
		// A sale date edit may have invalidated a not-yet-updated movement.
		const eligible = returns.filter((r) => r.movementDate && r.movementDate <= day && r.saleDate && r.saleDate <= day)
		const hit = eligible.find((r) => r.basis)
		if (!hit) {
			const outside = docs.find((d) => d.context && d.context.basis_ref && !seenSale.has(text(d.context.basis_ref)))
			rows.push({ ...base, class: docs.length ? (outside ? 'basis_outside_movements' : 'stale_no_basis') : 'no_basis' })
			continue
		}
		const sameDay = eligible.filter((r) => r.basis && r.movementDate === hit.movementDate)
		const ambiguous = new Set(sameDay.map((r) => r.basis.value)).size > 1
		const loss = round3(hit.basis.value - weightStart)
		const detail = { basis_ref: hit.saleId, basis_value: hit.basis.value, expected_loss: loss }
		if (loss === 0) {
			rows.push({ ...base, ...detail, class: docs.length ? 'stale_zero' : 'zero_ok', ambiguous })
			continue
		}
		if (!docs.length) { rows.push({ ...base, ...detail, class: 'missing', ambiguous }); continue }
		if (docs.length > 1) { rows.push({ ...base, ...detail, class: 'duplicate', ambiguous, stored_losses: docs.map((d) => num(d.loss_weight)) }); continue }
		const doc = docs[0]
		const stored = num(doc.loss_weight)
		if (round3(stored) !== loss) {
			const storedRef = text(doc.context && doc.context.basis_ref)
			// A basis the audit cannot see (e.g. a hidden-customer return filtered by the read APIs) is not proof of an error.
			const cls = ambiguous ? 'ambiguous_same_day' : storedRef && !seenSale.has(storedRef) ? 'basis_outside_movements' : 'value_mismatch'
			rows.push({ ...base, ...detail, class: cls, stored_loss: stored,
				stored_basis_ref: text(doc.context && doc.context.basis_ref), ambiguous })
			continue
		}
		const refDiffers = text(doc.context && doc.context.basis_ref) !== hit.saleId
		rows.push({ ...base, ...detail, class: refDiffers ? 'ok_basis_ref_differs' : 'ok', ambiguous })
	}

	const fillingIds = new Set(fillings.map((f) => text(f._id)))
	const orphans = adjustments.filter((a) => !fillingIds.has(text(a.source_id))).map((a) => ({ _id: a._id, source_id: text(a.source_id) }))
	const counts = {}
	for (const r of rows) counts[r.class] = (counts[r.class] || 0) + 1
	return { bottle_no: no, fillings: fillings.length, adjustments: adjustments.length, returns: returns.length, counts, orphans, issues, rows }
}

const PROBLEM = new Set(['missing', 'duplicate', 'value_mismatch', 'stale_zero', 'stale_no_basis', 'stale_not_candidate',
	'confirmed_value_mismatch', 'ambiguous_same_day', 'basis_outside_movements', 'date_unparsed', 'confirmed_unverifiable'])

module.exports = { auditBottle, parseDay, backBasis, PROBLEM, REASON }
