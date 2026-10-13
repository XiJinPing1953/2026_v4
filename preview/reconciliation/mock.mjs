// Development-only UI fixtures; no real customer, account, token, or network call.
const customers = [
 { _id: 'reconciliation-demo-wood', name: '示例甲木业', is_active: true },
 { _id: 'reconciliation-demo-leather', name: '示例乙皮厂', is_active: true },
 { _id: 'reconciliation-demo-hidden', name: '示例隐藏客户', is_hidden: true, is_active: false },
 { _id: 'reconciliation-demo-alias', name: '示例甲送货点', settlement_customer_id: 'reconciliation-demo-wood' }
]
const accounts = [
 { code: '112201', name: '示例甲木业', opening_milli: 0, debit_milli: 472000, credit_milli: 470000, closing_milli: 2000 },
 { code: '112202', name: '示例乙皮厂', opening_milli: 0, debit_milli: 22942500, credit_milli: 23900000, closing_milli: -957500 },
 { code: '112203', name: '示例隐藏客户', opening_milli: 0, debit_milli: 0, credit_milli: 0, closing_milli: 0 }
]
let mappings = { version: 1, items: [
 { crm_customer_id: customers[0]._id, accountant_codes: ['112201'], basis: '本地示例对应' },
 { crm_customer_id: customers[1]._id, accountant_codes: ['112202'], basis: '本地示例对应' }
] }
const batch = { _id: 'reconciliation-demo-batch', company: '本地交互示例账套（模拟数据）', cutoff: '2026-09-30', created_at: Date.now(), source: { source_id: 'demo-summary-source', name: '模拟应收统计表.xlsx', sha256: 'demo-source-only' }, status: 'imported' }
const results = new Map(), details = []
const ok = data => ({ code: 0, data: structuredClone(data) })
function check(id) {
 const customer = customers.find(row => row._id === id)
 const mapping = mappings.items.find(row => row.crm_customer_id === id)
 const base = accounts.find(row => row.code === mapping?.accountant_codes[0])
 const before = results.get(id)
 const issues = !mapping ? [{ type: 'mapping', code: 'mapping_missing', message: '尚未确认好会计科目，请确认客户对应。' }] : id === customers[0]._id ? [{ type: 'unposted', code: 'accounting_discount_missing', message: '示例：CRM 的 2 元优惠已确认，好会计尚未计入，请会计补记后重新导入验证。', suggestion: '核对原始优惠依据，CRM 无须冲回。' }] : id === customers[1]._id ? [{ type: 'classification', code: 'cash_vs_settlement', message: '示例：核实 23,900 元实际到账、2.50 元优惠及 960 元多收结清的分类。', suggestion: '确认到账凭据与双方约定后，使用通用财务处理。' }] : []
 const totals = base ? Object.fromEntries(['opening_milli', 'debit_milli', 'credit_milli', 'closing_milli'].map(key => [key, base[key]])) : null
 const crm = totals && { ...totals, credit_milli: totals.credit_milli + (id === customers[0]._id ? 2000 : 0), closing_milli: totals.closing_milli - (id === customers[0]._id ? 2000 : 0) }
 const data = { customer_id: id, customer_name: customer.name, source_hash: 'demo-source-' + id, result_hash: 'demo-result-' + id + '-' + mappings.version,
  checked_at: Date.now(), summary_match: !!mapping && id !== customers[0]._id, detail_match: null, evidence_level: 'summary', issues,
  comparison: { accounting: totals, crm, difference: totals && Object.fromEntries(Object.keys(totals).map(key => [key, crm[key] - totals[key]])) }, internal: { complete: true }, cache_refresh: null, review: before?.review || null, stale: false }
 results.set(id, data); return data
}
export async function reconciliationPreview(action, data) {
 if (action === 'contextV1') return ok({ customers, mappings, batches: [batch], max_file_bytes: 2 * 1024 * 1024 })
 if (action === 'getBatchV1') return ok({ batch, customers, accounts, mappings, results: [...results.values()].map(row => ({ ...row, stale: true })), detail_sources: details })
 if (action === 'importBatchV1') { Object.assign(batch, { company: data.company, cutoff: data.cutoff, source: { ...batch.source, name: data.source.name } }); return ok({ batch }) }
 if (action === 'checkCustomerV1') { await new Promise(resolve => setTimeout(resolve, 350)); return ok(check(data.customer_id)) }
 if (action === 'saveMappingV1') {
  if (data.expected_version !== mappings.version) return { code: 409, msg: '客户对应已变化，请刷新。' }
  mappings = { version: mappings.version + 1, items: [...mappings.items.filter(row => row.crm_customer_id !== data.customer_id), ...(data.accountant_codes.length ? [{ crm_customer_id: data.customer_id, accountant_codes: data.accountant_codes, basis: data.basis }] : [])] }
  return ok(mappings)
 }
 if (action === 'reviewCustomerV1') {
  const row = results.get(data.customer_id)
  if (!row || row.result_hash !== data.expected_result_hash) return { code: 409, msg: '结果已变化，请重查。' }
  row.review = { kind: data.kind, basis: data.basis, at: Date.now(), valid: data.kind === 'manual_approval' }
  return ok(row.review)
 }
 if (action === 'importDetailV1') { const source = { source_id: 'demo-detail-' + data.accountant_code, accountant_code: data.accountant_code, name: data.source.name }; details.push(source); return ok(source) }
 if (action === 'repairSourcesV1') return ok({ snapshot_hash: 'demo-snapshot', receipts: [{ _id: 'demo-receipt', biz_date: '2026-08-18', amount: 23900 }], sales: [{ _id: 'demo-sale', date: '2026-08-18', amount_received: 22940, rounding_amount: 2.5 }] })
 return { code: 400, msg: '此本地预览未支持该操作；没有请求生产数据。' }
}
