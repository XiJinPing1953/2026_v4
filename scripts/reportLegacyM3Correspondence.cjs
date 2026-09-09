'use strict'

// Offline only: reads a supplied snapshot; never opens a cloud connection or updates data.
const fs = require('node:fs')
const crypto = require('node:crypto')
const { computeSaleAmountsForDoc, RULE_VERSION } = require('../uniCloud-alipay/cloudfunctions/common/saleAccounting')
const str = (value) => String(value == null ? '' : value).trim()

function buildReport(input, { inputSha256 = '' } = {}) {
	if (!Array.isArray(input.sales) || !Array.isArray(input.flow_settlements)) {
		throw new Error('输入必须包含 sales 与 flow_settlements 数组；不能把缺失的数据集当成空数组')
	}
	const flowDocs = input.flow_settlements.filter((doc) => doc.status === 'posted')
	const rows = input.sales.filter((doc) => doc.price_unit === 'm3').map((sale) => {
		const sourceId = str(sale._id)
		const customerId = str(sale.customer_id)
		const result = computeSaleAmountsForDoc(sale, { allowUnresolved: true })
		const sameCustomer = flowDocs.filter((flow) => str(flow.customer_id) === customerId)
		const direct = sameCustomer.filter((flow) => Array.isArray(flow.sale_ids) && flow.sale_ids.map(str).includes(sourceId))
		const rangeCandidates = sameCustomer.filter((flow) => str(flow.period_start_date) && str(flow.period_end_date)
			&& str(sale.date).slice(0, 10) >= str(flow.period_start_date).slice(0, 10)
			&& str(sale.date).slice(0, 10) <= str(flow.period_end_date).slice(0, 10))
		return {
			sale_id: sourceId, customer_id: customerId, customer_name: str(sale.customer_name), date: str(sale.date),
			settlement_mode: str(sale.settlement_mode) || null, classification: result.accounting.status,
			sale_amount: result.amounts.should_receive,
			candidate_sale_amount: result.accounting.candidate_sale_amount ?? result.amounts.should_receive,
			stored_should_receive: sale.should_receive ?? null, stored_amount_received: sale.amount_received ?? null,
			source_updated_at: sale.updated_at ?? null,
			direct_flow_links: direct.map((doc) => ({ flow_settlement_id: str(doc._id), should_receive: doc.should_receive ?? null,
				period_start_date: doc.period_start_date, period_end_date: doc.period_end_date, source_updated_at: doc.updated_at ?? null })),
			period_candidate_ids: rangeCandidates.map((doc) => str(doc._id)),
			review_status: direct.length > 1 ? 'multiple_linked_settlements_review_required'
				: result.accounting.status === 'unresolved' ? 'classification_review_required'
				: direct.length && sale.settlement_mode === 'sale' ? 'sale_and_flow_link_review_required' : 'explicit_mode_recorded',
			coverage_verified: false
		}
	})
	return {
		report_type: 'legacy_m3_correspondence', rule_version: RULE_VERSION, generated_at: new Date().toISOString(),
		input_sha256: inputSha256, live_verified: false, cloud_writes: 0,
		source_evidence: input.evidence || { complete: false, reason: 'source_evidence_not_provided' },
		limitations: ['sale_ids 证明关联，不证明已经覆盖应收；日期区间仅为候选。', '不据此自动归零、改分类或调整历史账。',
			'输入的完整性与读取时间由来源记录，本工具不能复核线上数据或构造原子快照。'],
		summary: { source_sales: input.sales.length, source_flow_settlements: input.flow_settlements.length,
			m3_sales: rows.length, unresolved: rows.filter((row) => row.classification === 'unresolved').length,
			linked_to_flow: rows.filter((row) => row.direct_flow_links.length).length,
			requires_review: rows.filter((row) => row.review_status !== 'explicit_mode_recorded').length }, rows
	}
}

if (require.main === module) {
	const [inputPath, outputPath] = process.argv.slice(2)
	if (!inputPath || !outputPath) {
		console.error('用法：node scripts/reportLegacyM3Correspondence.cjs input.json output.json')
		process.exitCode = 1
	} else {
		const raw = fs.readFileSync(inputPath)
		const report = buildReport(JSON.parse(raw), { inputSha256: crypto.createHash('sha256').update(raw).digest('hex') })
		// Fail rather than overwrite a prior evidence artifact.
		fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
		console.log(JSON.stringify({ output: outputPath, ...report.summary, live_verified: false }))
	}
}

module.exports = { buildReport }
