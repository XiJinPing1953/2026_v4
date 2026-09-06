'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { parseStandardArgs, prepareClientOptions } = require('./lib/qrImportCommon.cjs')

const READS = new Set(['crm-sale.listV2', 'crm-sale.getV2', 'crm-customer-settlement.listCustomerStatementRowsV1', 'crm-customer-settlement.getLegacyM3EvidenceV1'])
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function collect({ client, token, spaceId, dateFrom, dateTo, legacyProjection = false, progress = () => {} }) {
	const started = new Date().toISOString()
	const call = async (name, action, data) => {
		if (!READS.has(`${name}.${action}`)) throw new Error('审计工具只允许指定读取接口')
		const result = await client.callFunction(name, { action, data, token, request_id: `audit_m3_${crypto.randomUUID()}` })
		if (result?.code !== 0) throw new Error(`${name}.${action} 读取失败，code=${result?.code ?? 'missing'}`)
		return result
	}
	async function pages(name, action, data, pageSize) {
		const rows = []; const ids = new Set(); let expectedTotal = null
		for (let page = 1; page <= 2000; page++) {
			const result = await call(name, action, { ...data, page, pageSize })
			if (!Array.isArray(result.data)) throw new Error(`${action} 返回结构无法核实`)
			const total = Number(result.paging?.total ?? result.total)
			if (!Number.isFinite(total)) throw new Error(`${action} 缺少总数，不能证明完整读取`)
			if (expectedTotal !== null && total !== expectedTotal) throw new Error(`${action} 读取期间总数发生变化，请重试`)
			expectedTotal = total
			for (const row of result.data) {
				const key = row._id || `${row.row_type}:${row.row_id}`
				if (!key || ids.has(key)) throw new Error(`${action} 分页重复或缺少标识`)
				ids.add(key); rows.push(row)
			}
			if (rows.length === total) return rows
			if (!result.data.length || rows.length > total) throw new Error(`${action} 返回条数与总数不一致`)
		}
		throw new Error(`${action} 未读完`)
	}
	const filters = { priceUnit: 'm3', dateStart: dateFrom, dateEnd: dateTo }
	const firstList = await pages('crm-sale', 'listV2', filters, 50)
	if (!legacyProjection) {
		const sales = []; const flowSettlements = []; const reads = []
		let changed = false
		const customerIds = [...new Set(firstList.map((row) => row.customer_id).filter(Boolean))]
		if (firstList.some((row) => !row.customer_id)) throw new Error('源单缺少客户，不能完成按客户取证')
		for (const customerId of customerIds) {
			const data = { customer_id: customerId, date_from: dateFrom, date_to: dateTo }
			const read = async () => {
				const result = await call('crm-customer-settlement', 'getLegacyM3EvidenceV1', data)
				if (result.data?.source_projection !== 'raw_documents' || !Array.isArray(result.data.sales)
					|| !Array.isArray(result.data.flow_settlements) || result.financial_evidence?.read_complete !== true) {
					throw new Error('原始资料缺少完整读取证据')
				}
				reads.push(result.financial_evidence)
				return result.data
			}
			const first = await read(); const second = await read()
			if (digest(first) !== digest(second)) changed = true
			sales.push(...first.sales); flowSettlements.push(...first.flow_settlements)
		}
		const lastList = await pages('crm-sale', 'listV2', filters, 50)
		if (digest(firstList) !== digest(lastList)) changed = true
		const listedIds = firstList.map((row) => row._id).sort()
		if (digest(listedIds) !== digest(sales.map((row) => row._id).sort())) changed = true
		progress(`已读取 ${sales.length} 张原始 m³ 单据、${flowSettlements.length} 张原始流量结算`)
		return { sales, flow_settlements: flowSettlements, evidence: {
			provider: 'alipay', space_id: spaceId, date_from: dateFrom, date_to: dateTo,
			read_started_at: started, read_completed_at: new Date().toISOString(), complete: false,
			sales_paging_complete: true, flow_paging_complete: true, raw_documents: true,
			sales_changed_during_read: changed, source_changed_between_reads: changed, atomic_snapshot: false,
			source: ['crm-sale.listV2', 'crm-customer-settlement.getLegacyM3EvidenceV1'], reads,
			limitations: ['客户范围来自销售列表的可见范围。', '每客户原始销售及全部期间流量单双读；仍非跨客户原子快照。',
				'保留原始金额及关联字段不等于已经核实应收覆盖；complete 保持 false，须逐笔确认。'], business_writes: 0
		} }
	}
	const sales = []
	for (const item of firstList) {
		const result = await call('crm-sale', 'getV2', { id: item._id })
		const doc = { ...result.data }
		if (!doc._id || doc.price_unit !== 'm3') throw new Error('源单在读取期间变化')
		// getV2 replaces these fields with computed values; do not label them stored evidence.
		delete doc.should_receive; delete doc.effective_should_receive; delete doc.out_amount; delete doc.back_amount
		sales.push(doc)
	}
	progress(`已读取 ${sales.length} 张 m³ 销售详情`)
	const customerIds = [...new Set(sales.map((row) => row.customer_id).filter(Boolean))]
	const flowSettlements = []; const statementEvidence = []
	for (const customerId of customerIds) {
		const rows = await pages('crm-customer-settlement', 'listCustomerStatementRowsV1', { customer_id: customerId, date_from: dateFrom, date_to: dateTo }, 200)
		statementEvidence.push({ customer_id: customerId, rows: rows.length, digest: digest(rows) })
		for (const row of rows.filter((row) => row.row_type === 'flow_settlement')) {
			flowSettlements.push({ _id: row.row_id, customer_id: customerId, biz_date: row.biz_date, status: 'posted',
				should_receive: row.amount, amount_received: row.amount_received, created_at: row.created_at,
				source_projection: 'listCustomerStatementRowsV1; no sale_ids or period boundaries' })
		}
	}
	const lastList = await pages('crm-sale', 'listV2', filters, 50)
	let changed = digest(firstList) !== digest(lastList)
	for (const doc of sales) {
		const current = { ...(await call('crm-sale', 'getV2', { id: doc._id })).data }
		delete current.should_receive; delete current.effective_should_receive; delete current.out_amount; delete current.back_amount
		if (digest(doc) !== digest(current)) changed = true
	}
	return { sales, flow_settlements: flowSettlements, evidence: {
		provider: 'alipay', space_id: spaceId, date_from: dateFrom, date_to: dateTo,
		read_started_at: started, read_completed_at: new Date().toISOString(),
		complete: false, sales_paging_complete: true, flow_paging_complete: true,
		sales_changed_during_read: changed, atomic_snapshot: false,
		source: [...READS], statement_reads: statementEvidence,
		limitations: ['可见客户范围；隐藏客户由现有权限过滤。', '销售详情金额为接口重算，已排除，不能当作数据库原金额。',
			'流量接口不提供 sale_ids、结算期间及 updated_at，不能证明覆盖；仅为待核清单。', '销售经过二次回读核查；流量单跨请求变化仍无法排除。'],
		business_writes: 0
	} }
}

async function main() {
	const get = (key, fallback) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback
	const output = get('output', '')
	if (!output) throw new Error('需要 --output=绝对路径；不会覆盖已有证据')
	if (fs.existsSync(output)) throw new Error('证据文件已存在，不覆盖')
	const spaceId = get('space-id', 'env-00jxuffegf2n')
	if (spaceId !== 'env-00jxuffegf2n') throw new Error('本次核查目标固定为 env-00jxuffegf2n（alipay）')
	const options = parseStandardArgs(['node', 'audit', '--space-id', spaceId])
	const { client } = await prepareClientOptions(options)
	let token = options.crmToken
	if (!token) {
		const login = await client.callFunction('crm-auth', { action: 'login', data: { username: options.crmUsername, password: options.crmPassword } })
		if (login?.code !== 0) throw new Error(`无法建立审计会话，code=${login?.code ?? 'missing'}`)
		token = login.token || login.user?.token || login.data?.token
		if (!token) throw new Error('审计会话缺少登录凭据')
	}
	console.log(`只读核查：provider=alipay space-id=${spaceId}`)
	const result = await collect({ client, token, spaceId, dateFrom: get('from', '2026-01-01'), dateTo: get('to', new Date().toISOString().slice(0, 10)), legacyProjection: process.argv.includes('--legacy-projection'), progress: console.log })
	fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
	fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
	console.log(JSON.stringify({ sales: result.sales.length, flow_settlements: result.flow_settlements.length, evidence_complete: result.evidence.complete, sales_changed: result.evidence.sales_changed_during_read, output }))
}
if (require.main === module) main().catch((error) => { console.error(error.message === 'fetch failed' ? '云端网络读取失败' : error.message); process.exitCode = 1 })
module.exports = { collect }
