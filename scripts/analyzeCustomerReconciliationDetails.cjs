#!/usr/bin/env node
'use strict'
// Follow-up only for a mapped exception. This never writes cloud or approval data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { parseAccountingDetail, compareDetail, money } = require('./customerReconciliationCore.cjs')
const option = key => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3)
const required = key => { const value = option(key); if (!value) throw Error(`缺少 --${key}=...`); return value }
const norm = value => String(value || '').replace(/\s+/g, '').trim()
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function run() {
  const parent = path.resolve(required('run'))
  const manifest = JSON.parse(fs.readFileSync(path.resolve(required('manifest')), 'utf8'))
  const output = path.resolve(required('out'))
  if (fs.existsSync(output)) throw Error('逐笔结果已存在，请保留原证据并更换输出文件名')
  const report = JSON.parse(fs.readFileSync(path.join(parent, 'reconciliation.json'), 'utf8'))
  const crm = JSON.parse(fs.readFileSync(path.join(parent, 'crm-ledgers.json'), 'utf8'))
  const customer = report.comparison.customers.find(row => row.customer_id === manifest.crm_customer_id)
  if (!customer || !customer.accountant_codes.length) throw Error('客户不存在或会计科目尚未确认')
  const inputs = manifest.accounting_files
  if (!Array.isArray(inputs) || inputs.length !== customer.accountant_codes.length || new Set(inputs.map(row => row.code)).size !== inputs.length ||
    inputs.some(row => !customer.accountant_codes.includes(row.code))) throw Error('逐笔明细文件与已确认科目范围不一致')
  const runtime = path.join(parent, '.report-runtime', 'customerReconciliationWorkbook.mjs')
  if (!fs.existsSync(runtime)) throw Error('原批次缺少表格解析运行环境')
  const detailSources = [], details = []
  for (const input of inputs) {
    const source = path.resolve(input.path), digest = sha(source)
    let xlsx = source
    if (path.extname(source).toLowerCase() === '.xls') {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-detail-'))
      execFileSync('soffice', [`-env:UserInstallation=file://${path.join(tempDir, 'profile')}`, '--headless', '--convert-to', 'xlsx', '--outdir', tempDir, source], { stdio: 'pipe', timeout: 60000 })
      xlsx = path.join(tempDir, path.basename(source, '.xls') + '.xlsx')
    }
    const matrixPath = path.join(parent, `.detail-${input.code}-${Date.now()}.json`)
    execFileSync(process.execPath, [runtime, '--mode=parse', `--input=${xlsx}`, `--output=${matrixPath}`], { stdio: 'pipe', timeout: 60000 })
    const detail = parseAccountingDetail(JSON.parse(fs.readFileSync(matrixPath, 'utf8')))
    const summaryRow = report.accounting.rows.find(row => row.code === input.code)
    if (!summaryRow || norm(detail.account_name) !== norm(summaryRow.name) || detail.period_month_to !== report.accounting.month.replace('-', '') ||
      ['opening_milli','debit_milli','credit_milli','closing_milli'].some(key => detail[key] !== summaryRow[key])) {
      throw Error(`科目${input.code}逐笔明细与本批汇总不一致；可能是旧下载或范围变化，请重新导出`)
    }
    details.push(detail)
    detailSources.push({ code: input.code, sha256: digest, bytes: fs.statSync(source).size })
  }
  const ledger = crm.ledgers[manifest.crm_customer_id]
  if (!ledger || ledger.error) throw Error('CRM该客户会计导出缺失')
  if (ledger.period?.date_from !== report.date_from || ledger.period?.date_to !== report.cutoff) throw Error('CRM明细与汇总期间不一致')
  const comparison = compareDetail(details, ledger)
  const result = { schema_version: 1, customer_id: customer.customer_id, account_codes: customer.accountant_codes,
    date_from: report.date_from, cutoff: report.cutoff, sources: detailSources, controls: {
      accounting_opening: details.reduce((n,r)=>n+r.opening_milli,0), accounting_debit: details.reduce((n,r)=>n+r.debit_milli,0),
      accounting_credit: details.reduce((n,r)=>n+r.credit_milli,0), accounting_closing: details.reduce((n,r)=>n+r.closing_milli,0),
      crm_opening: money(ledger.opening_balance), crm_debit: money(ledger.totals.debit), crm_credit: money(ledger.totals.credit), crm_closing: money(ledger.closing_balance)
    }, comparison, interpretation: '逐笔金额与日期候选仅用于定位；摘要文字不能证明现金、退款或冲抵性质。' }
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ output, customer_id: customer.customer_id, exact: comparison.exact_match_count,
    crm_unmatched: comparison.unmatched_crm.length, accounting_unmatched: comparison.unmatched_accounting.length,
    possible_date_differences: comparison.possible_date_differences.length }))
}
try { run() } catch (error) { console.error(`逐笔分析未完成: ${error.message}`); process.exitCode = 1 }
