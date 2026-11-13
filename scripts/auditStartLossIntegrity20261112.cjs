#!/usr/bin/env node
'use strict'

/**
 * 2026-11-12 灌装上秤差派生流水完整性只读核验
 *
 * 只读：读取操作日志、灌装、钢瓶流转与销售原单，独立重算每条灌装应有的依据、
 * 上秤差和派生流水，并逐条分类。不调用任何写入、补算或续办接口（查询接口本身
 * 会写普通访问日志）。
 *
 * 覆盖范围（每项都报告是否读全）：
 *   - 受影响任务：窗口内 sale_web_followup_failed 全部日志（含已结束的任务）
 *   - 每个任务的瓶号：三处来源取并集并互相核对
 *       a) sale_web_start_loss_failed 全部日志（按 request_id，不再只取最近 1000 条）
 *       b) filling_start_loss_sync_v1 全部日志（按 request_id）
 *       c) 销售原单当前 back_items（crm-sale.getV2）
 *   - 每个瓶号的全部灌装、全部流转（不设 80 瓶上限）
 *
 * 分类（每条灌装一个结论，不用“灌装数≠流水数”判缺失）：
 *   ok / zero_ok（零差无需流水）/ no_basis（缺少业务依据，无流水）/ not_candidate
 *   missing（应有但缺失）/ duplicate / value_mismatch / stale_zero / stale_no_basis /
 *   stale_not_candidate / ok_basis_ref_differs / ambiguous_same_day /
 *   basis_outside_movements / confirmed_ok / confirmed_value_mismatch / date_unparsed
 *
 * 用法（在有 HBuilderX 支付宝密钥的本机）：
 *   node scripts/auditStartLossIntegrity20261112.cjs
 *   可选：--since=2026-11-01 --until=YYYY-MM-DD --bottles=25,26（追加瓶号）--concurrency=4
 */

const fs = require('fs')
const path = require('path')
const { connect, text } = require('./lib/crmCloudClient.cjs')
const { auditBottle, PROBLEM } = require('./lib/startLossAudit.cjs')
const { CALL_ACTION, summarizeStartLossTiming } = require('./lib/startLossTiming.cjs')

const OUT_DIR = path.resolve(__dirname, '..', 'outputs', 'trust-audit', '2026-11-12-dcloud-cost')
const bottleKey = (v) => text(v).toUpperCase().replace(/\s+/g, '')
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function parseArgs(argv) {
	const out = { since: '2026-11-01', until: ymd(new Date()), extra: [], concurrency: 4, username: '', password: '' }
	for (const arg of argv.slice(2)) {
		const m = String(arg).match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		if (m[1] === 'since') out.since = m[2]
		if (m[1] === 'until') out.until = m[2]
		if (m[1] === 'bottles') out.extra = m[2].split(',').map(bottleKey).filter(Boolean)
		if (m[1] === 'concurrency') out.concurrency = Math.max(1, Math.min(8, Number(m[2]) || 4))
		if (m[1] === 'username') out.username = m[2]
		if (m[1] === 'password') out.password = m[2]
	}
	return out
}

async function pool(items, limit, worker) {
	const out = new Array(items.length)
	let next = 0
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) { const i = next++; out[i] = await worker(items[i], i) }
	}))
	return out
}

async function main() {
	const args = parseArgs(process.argv)
	const crm = await connect({ username: args.username, password: args.password })
	const started = new Date().toISOString()
	const log = (...a) => console.log('[audit]', ...a)

	// ---- 1. affected operations and their bottles ----
	const followup = await crm.logs('sale_web_followup_failed', args.since, args.until)
	const startFail = await crm.logs('sale_web_start_loss_failed', args.since, args.until)
	const syncLogs = await crm.logs('filling_start_loss_sync_v1', args.since, args.until)
	log(`followup ${followup.rows.length}/${followup.total} start_loss_failed ${startFail.rows.length}/${startFail.total} sync ${syncLogs.rows.length}/${syncLogs.total}`)

	const ops = new Map()
	for (const row of followup.rows) {
		const d = row.detail || {}
		if (text(d.step) !== 'start_loss') continue
		const key = text(d.operation_id) || `req:${row.request_id}`
		const op = ops.get(key) || { operation_id: text(d.operation_id), sale_id: text(d.sale_id), request_id: text(row.request_id), failures: 0 }
		op.failures += 1
		ops.set(key, op)
	}
	const byRequest = (rows) => {
		const map = new Map()
		for (const row of rows) {
			const set = map.get(row.request_id) || new Set()
			for (const b of (row.detail && row.detail.bottle_nos) || []) set.add(bottleKey(b))
			map.set(row.request_id, set)
		}
		return map
	}
	const failBottles = byRequest(startFail.rows)
	const syncBottles = byRequest(syncLogs.rows)

	const opRows = await pool([...ops.values()], args.concurrency, async (op) => {
		const res = op.sale_id ? await crm.call('crm-sale', 'getV2', { _id: op.sale_id }, { allowFail: true }) : null
		const sale = res && res.code === 0 ? res.data : null
		const fromSale = new Set((sale?.back_items || []).map((r) => bottleKey(r.bottle_no)).filter(Boolean))
		const a = failBottles.get(op.request_id) || new Set()
		const b = syncBottles.get(op.request_id) || new Set()
		const union = new Set([...a, ...b, ...fromSale])
		return { ...op, sale_found: Boolean(sale), sale_date: text(sale?.date), web_save_status: text(sale?.web_save_review?.status),
			web_save_pending: sale?.web_save_review?.pending ?? null,
			bottles_failed_log: [...a].sort(), bottles_sync_log: [...b].sort(), bottles_current_sale: [...fromSale].sort(),
			bottles: [...union].sort(), sources_agree: [...union].every((x) => a.has(x) && b.has(x) && fromSale.has(x)) }
	})
	const bottles = [...new Set([...opRows.flatMap((o) => o.bottles), ...args.extra])].sort()
	log(`operations ${opRows.length}, bottles ${bottles.length}, ops without any bottle ${opRows.filter((o) => !o.bottles.length).length}`)

	// ---- 2. per bottle: fillings, movements, sales; independent recomputation ----
	const salesCache = new Map()
	const getSale = async (id) => {
		if (!salesCache.has(id)) {
			salesCache.set(id, crm.call('crm-sale', 'getV2', { _id: id }, { allowFail: true })
				.then((r) => (r && r.code === 0 ? r.data : null)))
		}
		return salesCache.get(id)
	}
	const nonCanonical = { fillings: 0, examples: [] }
	const results = await pool(bottles, args.concurrency, async (no, index) => {
		try {
			const fills = await crm.all('crm-filling', 'listV1', { bottle_no: no, include_summary: false }, 60)
			const moves = await crm.all('crm-bottle-movement', 'listV1', { bottle_no: no }, 100)
			const fillings = fills.rows.filter((r) => bottleKey(r.bottle_no) === no)
			for (const f of fillings) {
				if (!(typeof f.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date))) {
					nonCanonical.fillings += 1
					if (nonCanonical.examples.length < 20) nonCanonical.examples.push({ filling_id: f._id, date: f.date ?? null })
				}
			}
			const saleIds = [...new Set(moves.rows.filter((m) => m.type === 'back' && m.source_type === 'sale').map((m) => text(m.source_id)).filter(Boolean))]
			const salesById = new Map()
			for (const id of saleIds) { const s = await getSale(id); if (s) salesById.set(id, s) }
			const r = auditBottle({ bottleNo: no, fillings, movements: moves.rows, salesById })
			if ((index + 1) % 10 === 0) log(`bottles ${index + 1}/${bottles.length}`)
			return { ...r, fillings_complete: fills.complete, movements_complete: moves.complete, sales_missing: saleIds.length - salesById.size }
		} catch (error) {
			return { bottle_no: no, error: String(error.message || error).slice(0, 300) }
		}
	})

	// ---- 3. scope under the date-bounded rule, and post-deploy job timings ----
	const rowsByBottle = new Map(results.map((r) => [r.bottle_no, r.rows || []]))
	for (const op of opRows) {
		const bound = /^\d{4}-\d{2}-\d{2}$/.test(op.sale_date) ? op.sale_date : ''
		const all = op.bottles.flatMap((b) => rowsByBottle.get(b) || []).filter((r) => r.class !== 'not_candidate' && r.class !== 'stale_not_candidate')
		op.scope_rows_full_history = all.length
		// Lower bound only from the current sale version; an edit's older version can only widen it.
		op.scope_rows_from_sale_date = bound ? all.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date >= bound).length : null
	}
	const jobLogs = await crm.logs('filling_start_loss_job_v1', args.since, args.until)
	const callLogs = await crm.logs(CALL_ACTION, args.since, args.until)
	const jobTiming = summarizeStartLossTiming({ callLogs, jobLogs })

	// ---- 4. summary ----
	const totals = {}
	const problems = []
	for (const r of results) {
		for (const [k, v] of Object.entries(r.counts || {})) totals[k] = (totals[k] || 0) + v
		for (const row of r.rows || []) if (PROBLEM.has(row.class)) problems.push({ bottle_no: r.bottle_no, ...row })
		for (const o of r.orphans || []) problems.push({ bottle_no: r.bottle_no, class: 'orphan', ...o })
	}
	const incomplete = results.filter((r) => r.error || r.fillings_complete === false || r.movements_complete === false || r.sales_missing > 0)
	const report = {
		kind: 'start_loss_integrity_audit', read_only: true, space_id: crm.spaceId, range: { since: args.since, until: args.until },
		started_at: started, finished_at: new Date().toISOString(),
		coverage: {
			logs: {
				followup: { rows: followup.rows.length, total: followup.total, complete: followup.complete },
				start_loss_failed: { rows: startFail.rows.length, total: startFail.total, complete: startFail.complete },
				sync: { rows: syncLogs.rows.length, total: syncLogs.total, complete: syncLogs.complete },
				job_timing: { rows: jobLogs.rows.length, total: jobLogs.total, complete: jobLogs.complete },
				call_timing: { rows: callLogs.rows.length, total: callLogs.total, complete: callLogs.complete }
			},
			operations: opRows.length,
			operations_without_bottles: opRows.filter((o) => !o.bottles.length).map((o) => o.operation_id),
			operations_sources_disagree: opRows.filter((o) => !o.sources_agree).map((o) => ({ operation_id: o.operation_id,
				failed_log: o.bottles_failed_log, sync_log: o.bottles_sync_log, current_sale: o.bottles_current_sale })),
			bottles: bottles.length,
			bottles_incomplete: incomplete.map((r) => ({ bottle_no: r.bottle_no, error: r.error || '', fillings_complete: r.fillings_complete,
				movements_complete: r.movements_complete, sales_missing: r.sales_missing })),
			non_canonical_filling_dates: nonCanonical
		},
		operations: opRows,
		job_timing_after_deploy: jobTiming,
		totals,
		problem_total: problems.length,
		problems,
		per_bottle: results.map(({ rows, ...rest }) => rest),
		limits: [
			'总调用耗时仅来自销售端调用返回后的独立日志，包含云函数内部收尾日志及传输等待，不含该条观测日志自身写入；超时只统计调用方已等待时长，不代表灌装函数实际运行完毕。旧日志或观测写入失败无法补出总耗时，无有效返回样本时超过9秒次数为null。',
			'依据按回瓶流转指向的销售原单重算；没有流转记录的回瓶销售不在候选内，相关结果归为 no_basis / basis_outside_movements，需要人工看原单。',
			'流转列表与销售详情接口会过滤隐藏客户；隐藏客户的回瓶不可见时，相关灌装归为 basis_outside_movements，并在 sales_missing 中计数。',
			'人工确认依据（confirmed_previous_fill_end）只核对数值，不重新验证确认审批本身。',
			'灌装日期缺失时按 UTC+8 取 created_at 日；生产函数按运行环境本地时区，如有此类记录需人工复核。'
		]
	}
	fs.mkdirSync(OUT_DIR, { recursive: true })
	const file = path.join(OUT_DIR, `audit-start-loss-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
	fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)

	console.log('\n== 覆盖 ==')
	console.log(`任务 ${opRows.length}；无瓶号 ${report.coverage.operations_without_bottles.length}；瓶号来源不一致 ${report.coverage.operations_sources_disagree.length}`)
	console.log(`瓶号 ${bottles.length}；读取不完整 ${incomplete.length}；灌装日期非规范 ${nonCanonical.fillings}`)
	console.log('\n== 分类合计 ==')
	console.log(totals)
	console.log(`\n需处理/需人工看 ${problems.length} 条`)
	console.log('\n== 新补算任务调用（部署后才有） ==')
	console.log(jobTiming)
	console.log(`报告：${file}`)
}

main().catch((error) => {
	console.error('[audit] 失败：', error.message || error)
	process.exit(1)
})
