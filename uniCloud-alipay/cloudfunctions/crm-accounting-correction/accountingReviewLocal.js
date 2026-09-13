'use strict'
const crypto = require('crypto')
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const VERSION = 'accounting-manual-review/2026-09-13.1'
const ACTION = 'accounting_manual_review'
const sorted = rows => [...rows].sort((a,b) => String(a._id).localeCompare(String(b._id)))
// Bind an acknowledgement to the whole financial source range; any later change requires review again.
function fingerprint(input) {
 return digest(Object.fromEntries(['sales','flows','debts','receipts','allocations'].map(k => [k, sorted(input[k] || [])])))
}
function fromTables(t) { return {sales:t.crm_sale_records,flows:t.crm_customer_flow_settlements,debts:t.crm_customer_opening_debts,receipts:t.crm_customer_receipts,allocations:t.crm_customer_allocations} }
function applyReview(summary, input, reviews, customerId) {
 const current = fingerprint(input), pending = summary.unresolved_sources || []
 const matching = (reviews || []).filter(r => r.action === ACTION && r.status === 'posted' && r.customer_id === customerId && r.detail?.version === VERSION && r.detail?.fingerprint === current)
 const confirmed = new Map()
 for (const r of matching) for (const item of r.detail.items || []) {
  if (item.reason === 'receipt_date_missing' && item.source_type === 'sale' && Number.isFinite(item.amount) && item.amount > 0) confirmed.set(item.source_id, item)
 }
 const reviewed = pending.filter(p => {const c=confirmed.get(p.source_id);return p.source_type==='sale' && p.reason==='receipt_date_missing' && c?.amount===p.amount})
 const outstanding = pending.filter(p => !reviewed.includes(p))
 if (!reviewed.length) return summary
 return {...summary, manual_review:{version:VERSION,status:outstanding.length ? 'partial' : 'approved',reviewed_count:reviewed.length,
  outstanding_count:outstanding.length, reviewed_sources:reviewed.map(p=>({...p,confirmed_date:confirmed.get(p.source_id).biz_date})),
  outstanding_sources:outstanding, note:'已按会计依据人工核准，未补正式收款凭据；原账务数据保持。'}}
}
module.exports={VERSION,ACTION,digest,fingerprint,fromTables,applyReview}
