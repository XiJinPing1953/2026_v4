#!/usr/bin/env node
'use strict'

// Read-only batch comparison. It never calls a CRM write action or updates the
// customer approval roster. Source workbooks and responses stay in --out.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { parseStandardArgs, prepareClientOptions, generateRequestId } = require('./lib/qrImportCommon.cjs')
const { parseAccountingSummary, compare, validateCustomerInventory, validatePeriod } = require('./customerReconciliationCore.cjs')

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const required = name => { const value = option(name); if (!value) throw Error(`缺少 --${name}=...`); return value }
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const writePrivate = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })

async function run() {
  const input = path.resolve(required('accounting'))
  const dateFrom = required('date-from'), cutoff = required('cutoff')
  const outDir = path.resolve(required('out'))
  validatePeriod(dateFrom, cutoff)
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw Error('输出目录已存在文件，请另选新目录以保留证据')
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })
  fs.chmodSync(outDir, 0o700)
  const sourceBytes = fs.readFileSync(input)
  const sourceHash = hash(sourceBytes)
  const sourceName = `accounting-source${path.extname(input).toLowerCase()}`
  fs.writeFileSync(path.join(outDir, sourceName), sourceBytes, { flag: 'wx', mode: 0o600 })
  const xlsx = path.join(outDir, 'accounting-source.xlsx')
  if (path.extname(input).toLowerCase() === '.xls') {
    const profile = `file://${path.join(outDir, '.libreoffice-profile')}`
    execFileSync('soffice', [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'xlsx', '--outdir', outDir, path.join(outDir, sourceName)], { stdio: 'pipe', timeout: 60000 })
  } else if (path.extname(input).toLowerCase() !== '.xlsx') throw Error('仅接受好会计 xls 或 xlsx 导出')
  if (!fs.existsSync(xlsx)) throw Error('好会计文件未成功转换为xlsx')

  const bundled = process.env.CODEX_BUNDLED_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
  if (!fs.existsSync(path.join(bundled, '@oai/artifact-tool'))) throw Error('缺少工作区表格运行库，请先加载工作区依赖')
  const runtime = path.join(outDir, '.report-runtime')
  fs.mkdirSync(runtime, { mode: 0o700 })
  fs.symlinkSync(bundled, path.join(runtime, 'node_modules'))
  const builder = path.join(runtime, 'customerReconciliationWorkbook.mjs')
  fs.copyFileSync(path.join(__dirname, 'customerReconciliationWorkbook.mjs'), builder)
  const parsed = path.join(outDir, 'accounting-matrix.json')
  execFileSync(process.execPath, [builder, '--mode=parse', `--input=${xlsx}`, `--output=${parsed}`], { stdio: 'pipe', timeout: 60000 })
  const accounting = parseAccountingSummary(JSON.parse(fs.readFileSync(parsed, 'utf8')))
  validatePeriod(dateFrom, cutoff, accounting.month)
  console.log(JSON.stringify({ stage: 'accounting_parsed', subjects: accounting.count, month: accounting.month, source_sha256: sourceHash }))

  const mappingPath = option('mapping')
  const mapping = mappingPath ? JSON.parse(fs.readFileSync(path.resolve(mappingPath), 'utf8')).mappings : []
  if (!Array.isArray(mapping)) throw Error('映射文件必须包含 mappings 数组')
  let customers, expectedTotal, ledgers, crmSource = 'live'
  if (option('crm-fixture')) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(option('crm-fixture')), 'utf8'))
    ;({ customers, expectedTotal, ledgers } = fixture)
    crmSource = 'fixture'
  } else {
    const tokenFile = path.resolve(required('token-file'))
    const token = fs.readFileSync(tokenFile, 'utf8').trim()
    const spaceId = required('space-id')
    const options = parseStandardArgs(process.argv)
    options.spaceId = spaceId
    const { client } = await prepareClientOptions(options)
    const listAll = async () => {
      const found = [], pageSize = 50
      let total = null
      for (let page = 1; page <= 100; page++) {
        const response = await client.callFunction('crm-customer', { action: 'listV1', token,
          data: { visibility: 'all', page, pageSize, include_summary: false, include_deposit: false }, request_id: generateRequestId() })
        if (response?.code !== 0 || !Array.isArray(response.data) || !Number.isInteger(Number(response.total))) throw Error(`CRM客户第${page}页读取失败`)
        if (total == null) total = Number(response.total)
        if (Number(response.total) !== total || response.data.length > pageSize) throw Error('CRM客户总数在分页期间变化')
        found.push(...response.data)
        if (found.length === total && response.paging?.hasMore !== true) return { rows: found, total }
        if (response.data.length === 0 || found.length > total) throw Error('CRM客户分页缺失、重复或中途变化')
      }
      throw Error('CRM客户分页超过安全上限')
    }
    const initial = await listAll()
    customers = initial.rows
    expectedTotal = initial.total
    const independent = validateCustomerInventory(customers, expectedTotal)
    console.log(JSON.stringify({ stage: 'crm_inventory', total: expectedTotal, settlement_customers: independent.length }))
    ledgers = {}
    let next = 0, completed = 0
    async function worker() {
      while (next < independent.length) {
        const customer = independent[next++]
        try {
          const response = await client.callFunction('crm-customer-settlement', { action: 'exportCustomerAccountingLedgerV1', token,
            data: { customer_id: customer._id, date_from: dateFrom, date_to: cutoff }, request_id: generateRequestId() })
          if (response?.code !== 0 || !response.data || response.data.period?.date_from !== dateFrom || response.data.period?.date_to !== cutoff) throw Error('接口返回失败或期间不一致')
          ledgers[customer._id] = response.data
        } catch (error) { ledgers[customer._id] = { error: String(error.message || error).slice(0, 160) } }
        completed++
        if (completed % 20 === 0 || completed === independent.length) console.log(JSON.stringify({ stage: 'crm_ledgers', completed, total: independent.length }))
      }
    }
    await Promise.all([worker(), worker(), worker()])
    const final = await listAll()
    const fingerprint = rows => hash(JSON.stringify(rows.map(c => [c._id, c.updated_at, c.settlement_customer_id, c.is_hidden, c.is_active]).sort((a,b) => String(a[0]).localeCompare(String(b[0])))))
    if (initial.total !== final.total || fingerprint(initial.rows) !== fingerprint(final.rows)) throw Error('CRM客户范围在读取期间发生变化，请重新运行')
  }
  validateCustomerInventory(customers, expectedTotal)
  writePrivate(path.join(outDir, 'crm-ledgers.json'), { date_from: dateFrom, cutoff, customer_count: expectedTotal, customers, ledgers })
  const comparison = compare({ accounting, customers, expectedCustomerCount: expectedTotal, ledgers, mapping })
  const report = { schema_version: 1, generated_at: new Date().toISOString(), date_from: dateFrom, cutoff,
    source: { sha256: sourceHash, original_name: path.basename(input), bytes: sourceBytes.length, crm_source: crmSource },
    customer_inventory: customers.map(customer => ({ id: customer._id, name: customer.name,
      settlement_customer_id: customer.settlement_customer_id || '', is_active: customer.is_active !== false,
      is_hidden: customer.is_hidden === true })), accounting, comparison }
  const jsonPath = path.join(outDir, 'reconciliation.json')
  writePrivate(jsonPath, report)
  const workbookPath = path.join(outDir, '客户对账差异报告.xlsx')
  execFileSync(process.execPath, [builder, '--mode=report', `--input=${jsonPath}`, `--output=${workbookPath}`], { stdio: 'pipe', timeout: 120000 })
  fs.chmodSync(workbookPath, 0o600)
  console.log(JSON.stringify({ stage: 'complete', workbook: workbookPath, customers: comparison.customer_count,
    subjects: accounting.count, matched: comparison.matched_count, exceptions: comparison.exception_count,
    unmapped_crm: comparison.unmapped_count, unmatched_accounting: comparison.unmatched_subjects.length }))
}
run().catch(error => { console.error(`对账未完成: ${error.message}`); process.exitCode = 1 })
