'use strict'

// This module is deliberately read-only. It compares accounting projections;
// neither a match nor a suggested mapping is evidence of an original receipt.
const normalizeName = value => String(value || '').trim().replace(/\s+/g, '')
const money = value => {
  if (value == null || value === '') return 0
  const raw = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').replace(/[￥¥]/g, ''))
  if (!Number.isFinite(raw) || Math.abs(raw * 1000 - Math.round(raw * 1000)) > 0.00001) throw Error(`无效金额或超过三位小数: ${value}`)
  return Math.round(raw * 1000)
}
const yuan = milli => Number((milli / 1000).toFixed(3))
const sum = (list, key) => list.reduce((total, row) => total + (row[key] || 0), 0)
function validatePeriod(dateFrom, cutoff, accountingMonth) {
  const valid = value => /^20\d\d-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!valid(cutoff) || dateFrom !== `${cutoff.slice(0, 4)}-01-01`) throw Error('第一版仅支持同一自然年的01-01至会计确认截止日')
  if (accountingMonth && accountingMonth !== cutoff.slice(0, 7)) throw Error(`会计报表月份${accountingMonth}与截止日${cutoff}不符`)
}

function parseAccountingSummary(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 6) throw Error('好会计报表为空或缺少表头')
  const row2 = matrix[1] || [], h1 = matrix[2] || [], h2 = matrix[3] || []
  const company = String(row2[0] || '').replace(/^编制单位[：:]\s*/, '').trim()
  const monthText = String(row2[3] || '')
  const monthMatch = monthText.match(/(20\d{2})年\s*(\d{1,2})月/)
  if (!company || !monthMatch || h1[0] !== '客户编码' || h1[1] !== '客户' || h1[2] !== '期初余额' || h1[4] !== '本期发生' || h1[6] !== '本期收回' || h1[8] !== '余额' || h2[9] !== '发生' || h2[10] !== '收回') {
    throw Error('好会计应收统计表的账套、月份或列结构无法确认')
  }
  const month = `${monthMatch[1]}-${monthMatch[2].padStart(2, '0')}`
  const footerIndex = matrix.findIndex((row, index) => index >= 4 && String(row?.[1] || '').trim() === '合计')
  if (footerIndex < 5 || matrix.slice(footerIndex + 1).some(row => row?.some(v => v != null && v !== ''))) throw Error('好会计合计行缺失或合计行后仍有数据')
  const fields = [2, 4, 6, 8, 9, 10]
  const seen = new Set(), rows = []
  for (let index = 4; index < footerIndex; index++) {
    const row = matrix[index] || [], code = String(row[0] || '').trim(), name = String(row[1] || '').trim()
    if (!code || !name || seen.has(code)) throw Error(`好会计第${index + 1}行客户编码/名称缺失或重复`)
    seen.add(code)
    const [monthOpening, monthDebit, monthCredit, closing, yearDebit, yearCredit] = fields.map(column => money(row[column]))
    if (monthOpening + monthDebit - monthCredit !== closing) throw Error(`好会计客户${code}本月借贷与余额不平`)
    rows.push({ code, name, month_opening_milli: monthOpening, month_debit_milli: monthDebit, month_credit_milli: monthCredit,
      opening_milli: closing - yearDebit + yearCredit, debit_milli: yearDebit, credit_milli: yearCredit, closing_milli: closing,
      source_row: index + 1 })
  }
  const footer = matrix[footerIndex]
  for (const [key, column] of [['month_opening_milli', 2], ['month_debit_milli', 4], ['month_credit_milli', 6], ['closing_milli', 8], ['debit_milli', 9], ['credit_milli', 10]]) {
    if (sum(rows, key) !== money(footer[column])) throw Error(`好会计合计行${key}与逐户之和不一致`)
  }
  return { company, month, count: rows.length, rows, controls: { opening_milli: sum(rows, 'opening_milli'), debit_milli: sum(rows, 'debit_milli'), credit_milli: sum(rows, 'credit_milli'), closing_milli: sum(rows, 'closing_milli') } }
}

function validateCustomerInventory(customers, expectedTotal) {
  if (!Array.isArray(customers) || customers.length !== expectedTotal) throw Error(`CRM客户列表不完整: ${customers?.length || 0}/${expectedTotal}`)
  const ids = new Set()
  for (const c of customers) {
    if (!c?._id || ids.has(c._id)) throw Error('CRM客户列表存在空ID或重复ID')
    ids.add(c._id)
  }
  for (const c of customers) if (c.settlement_customer_id && !ids.has(c.settlement_customer_id)) throw Error(`结算主户缺失: ${c._id}`)
  return customers.filter(c => !c.settlement_customer_id)
}

function compare({ accounting, customers, expectedCustomerCount, ledgers, mapping = [] }) {
  const settlementCustomers = validateCustomerInventory(customers, expectedCustomerCount)
  const subjects = new Map(accounting.rows.map(row => [row.code, row]))
  const customerById = new Map(customers.map(c => [c._id, c]))
  const approved = new Map(), usedCodes = new Set()
  for (const item of mapping) {
    if (!item?.crm_customer_id || !Array.isArray(item.accountant_codes) || !item.accountant_codes.length) throw Error('已确认科目映射格式不完整')
    const customer = customerById.get(item.crm_customer_id)
    if (!customer || customer.settlement_customer_id || approved.has(item.crm_customer_id)) throw Error(`映射客户不是独立结算户或重复: ${item.crm_customer_id}`)
    for (const code of item.accountant_codes) {
      if (usedCodes.has(code)) throw Error(`会计科目重复分配: ${code}`)
      usedCodes.add(code)
    }
    approved.set(item.crm_customer_id, item.accountant_codes)
  }
  const result = settlementCustomers.map(customer => {
    const codes = approved.get(customer._id) || []
    const ledger = ledgers[customer._id]
    const related = codes.map(code => subjects.get(code)).filter(Boolean)
    const issues = []
    if (!codes.length) issues.push('会计科目尚未确认')
    if (related.length !== codes.length) issues.push('已确认会计科目不在本次导出')
    if (!ledger || ledger.error) issues.push(`CRM会计导出读取失败${ledger?.error ? ': ' + ledger.error : ''}`)
    if (ledger && !ledger.error && ledger.period_summary?.complete !== true) issues.push('CRM期间汇总待核或取数不完整')
    if (ledger && !ledger.error && (money(ledger.opening_balance) + money(ledger.totals?.debit) - money(ledger.totals?.credit) !== money(ledger.closing_balance))) issues.push('CRM账簿借贷与余额不平')
    const accountTotals = related.length === codes.length && codes.length ? {
      opening_milli: sum(related, 'opening_milli'), debit_milli: sum(related, 'debit_milli'), credit_milli: sum(related, 'credit_milli'), closing_milli: sum(related, 'closing_milli')
    } : null
    const crmTotals = ledger && !ledger.error ? {
      opening_milli: money(ledger.opening_balance), debit_milli: money(ledger.totals?.debit), credit_milli: money(ledger.totals?.credit), closing_milli: money(ledger.closing_balance)
    } : null
    const difference = accountTotals && crmTotals ? Object.fromEntries(['opening_milli', 'debit_milli', 'credit_milli', 'closing_milli'].map(key => [key, crmTotals[key] - accountTotals[key]])) : null
    if (difference && Object.values(difference).some(Boolean)) issues.push('借贷或余额存在差异')
    const status = !codes.length ? '科目待确认' : issues.length ? '异常待核' : '数字对平·待人工核准'
    const aliases = customers.filter(c => c.settlement_customer_id === customer._id).map(c => c.name)
    const candidates = !codes.length ? accounting.rows.filter(row => [customer.name, ...aliases].some(name => normalizeName(name) === normalizeName(row.name))) : []
    return { customer_id: customer._id, customer_name: customer.name, is_active: customer.is_active !== false, is_hidden: customer.is_hidden === true,
      aliases, accountant_codes: codes, suggested_codes: candidates.map(row => row.code), status, issues, accounting: accountTotals, crm: crmTotals, difference,
      evidence_complete: Boolean(ledger && !ledger.error && ledger.period_summary?.complete === true) }
  })
  const unmatchedSubjects = accounting.rows.filter(row => !usedCodes.has(row.code)).map(row => ({ code: row.code, name: row.name,
    suggested_customer_ids: result.filter(c => c.suggested_codes.includes(row.code)).map(c => c.customer_id),
    opening_milli: row.opening_milli, debit_milli: row.debit_milli, credit_milli: row.credit_milli, closing_milli: row.closing_milli }))
  return { customers: result, unmatched_subjects: unmatchedSubjects, customer_count: customers.length, settlement_customer_count: settlementCustomers.length,
    matched_count: result.filter(c => c.status === '数字对平·待人工核准').length, exception_count: result.filter(c => c.status === '异常待核').length,
    unmapped_count: result.filter(c => c.status === '科目待确认').length, accounting_subject_count: accounting.count, accounting_controls: accounting.controls }
}

function parseAccountingDetail(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 6 || matrix[3]?.[0] !== '序号' || matrix[3]?.[1] !== '日期' || matrix[3]?.[4] !== '借方' || matrix[3]?.[5] !== '贷方') throw Error('不是好会计明细账格式')
  const accountText = String(matrix[2]?.[0] || '')
  const accountMatch = accountText.match(/科目:(?:\d+\s+)?([^\s]+)\s+期间:(\d{6})至(\d{6})/)
  if (!accountMatch) throw Error('明细账科目或期间无法识别')
  const accountName = accountMatch[1].replace(/^应收账款_站上_/, '')
  const openingRow = matrix.slice(4).find(row => row?.[3] === '期初余额')
  const annualRows = matrix.slice(4).filter(row => row?.[3] === '本年累计')
  if (!openingRow || !annualRows.length) throw Error('明细账缺少期初或本年累计')
  const opening = money(openingRow[7]) * (openingRow[6] === '贷' ? -1 : 1)
  const rows = matrix.slice(4).filter(row => /^20\d\d-\d\d-\d\d$/.test(String(row?.[1] || '')) &&
    !['期初余额','本月合计','本年累计'].includes(String(row?.[3] || ''))).map(row => ({
    date: String(row[1]), voucher: String(row[2] || ''), summary: String(row[3] || ''), debit_milli: money(row[4]), credit_milli: money(row[5])
  }))
  const lastAnnual = annualRows.at(-1), debit = money(lastAnnual[4]), credit = money(lastAnnual[5])
  const closing = money(lastAnnual[7]) * (lastAnnual[6] === '贷' ? -1 : 1)
  if (opening + sum(rows, 'debit_milli') - sum(rows, 'credit_milli') !== closing || debit !== sum(rows, 'debit_milli') || credit !== sum(rows, 'credit_milli')) {
    throw Error(`会计明细账${accountName}逐笔与本年累计不一致`)
  }
  return { account_name: accountName, period_month_from: accountMatch[2], period_month_to: accountMatch[3], opening_milli: opening,
    debit_milli: debit, credit_milli: credit, closing_milli: closing, rows }
}

function compareDetail(accountingDetails, crmLedger) {
  if (!Array.isArray(accountingDetails) || !accountingDetails.length || !crmLedger || !Array.isArray(crmLedger.rows)) throw Error('缺少同客户双方明细')
  const accountant = accountingDetails.flatMap(detail => detail.rows.map(row => ({ ...row, account_name: detail.account_name })))
  const crm = crmLedger.rows.filter(row => row.row_type === 'movement').map(row => ({ date: row.biz_date,
    debit_milli: money(row.debit), credit_milli: money(row.credit), source_type: row.source_type, source_id: row.source_id }))
  const key = row => `${row.date}|${row.debit_milli}|${row.credit_milli}`
  const remaining = new Map()
  for (const row of accountant) { const k = key(row); if (!remaining.has(k)) remaining.set(k, []); remaining.get(k).push(row) }
  const unmatchedCrm = []
  for (const row of crm) { const list = remaining.get(key(row)); if (list?.length) list.pop(); else unmatchedCrm.push(row) }
  const unmatchedAccounting = [...remaining.values()].flat()
  const amountKey = row => `${row.debit_milli}|${row.credit_milli}`
  const dateCandidates = unmatchedCrm.map(c => ({ crm: c, accountant: unmatchedAccounting.filter(a => amountKey(a) === amountKey(c) && a.date !== c.date) }))
    .filter(pair => pair.accountant.length)
  return { crm_row_count: crm.length, accounting_row_count: accountant.length, exact_match_count: crm.length - unmatchedCrm.length,
    unmatched_crm: unmatchedCrm, unmatched_accounting: unmatchedAccounting, possible_date_differences: dateCandidates,
    fully_matched: unmatchedCrm.length === 0 && unmatchedAccounting.length === 0 }
}

module.exports = { parseAccountingSummary, validateCustomerInventory, validatePeriod, compare, parseAccountingDetail, compareDetail, money, yuan }
