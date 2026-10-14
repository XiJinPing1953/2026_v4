'use strict'

// This module is deliberately read-only. It compares accounting projections;
// neither a match nor a suggested mapping is evidence of an original receipt.
const normalizeName = value => String(value || '').trim().replace(/\s+/g, '')
const money = value => {
  if (value == null || value === '') return 0
  const raw = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').replace(/[￥¥]/g, ''))
  if (!Number.isFinite(raw) || !Number.isSafeInteger(Math.round(raw * 1000)) || Math.abs(raw * 1000 - Math.round(raw * 1000)) > 0.00001) throw Error(`无效金额或超过三位小数: ${value}`)
  return Math.round(raw * 1000)
}
const yuan = milli => Number((milli / 1000).toFixed(3))
const sum = (list, key) => list.reduce((total, row) => total + (row[key] || 0), 0)
const CONTROL_KEYS = ['opening_milli', 'debit_milli', 'credit_milli', 'closing_milli']
const independent = customer => !customer.settlement_customer_id || customer.settlement_customer_id === customer._id
const ledgerComplete = ledger => Boolean(ledger && !ledger.error && ledger.period_summary?.complete === true)
const ledgerControlsPresent = ledger => [ledger?.opening_balance, ledger?.closing_balance, ledger?.totals?.debit, ledger?.totals?.credit]
  .every(value => value != null && value !== '')
const validDate = value => /^20\d\d-\d\d-\d\d$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
function validatePeriod(dateFrom, cutoff, accountingMonth) {
  if (!validDate(cutoff) || dateFrom !== `${cutoff.slice(0, 4)}-01-01`) throw Error('第一版仅支持同一自然年的01-01至会计确认截止日')
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
  return customers.filter(independent)
}

function compare({ accounting, customers, expectedCustomerCount, ledgers, mapping = [] }) {
  const settlementCustomers = validateCustomerInventory(customers, expectedCustomerCount)
  const subjects = new Map(accounting.rows.map(row => [row.code, row]))
  const customerById = new Map(customers.map(c => [c._id, c]))
  const approved = new Map(), usedCodes = new Set()
  for (const item of mapping) {
    if (!item?.crm_customer_id || !Array.isArray(item.accountant_codes) || !item.accountant_codes.length) throw Error('已确认科目映射格式不完整')
    const customer = customerById.get(item.crm_customer_id)
    if (!customer || !independent(customer) || approved.has(item.crm_customer_id)) throw Error(`映射客户不是独立结算户或重复: ${item.crm_customer_id}`)
    for (const code of item.accountant_codes) {
      if (usedCodes.has(code)) throw Error(`会计科目重复分配: ${code}`)
      usedCodes.add(code)
    }
    approved.set(item.crm_customer_id, item.accountant_codes)
  }
  const result = settlementCustomers.map(customer => {
    const codes = approved.get(customer._id) || []
    const ledger = ledgers[customer._id]
    const usableControls = ledgerComplete(ledger) && ledgerControlsPresent(ledger)
    const related = codes.map(code => subjects.get(code)).filter(Boolean)
    const issues = []
    if (!codes.length) issues.push('会计科目尚未确认')
    if (related.length !== codes.length) issues.push('已确认会计科目不在本次导出')
    if (!ledger || ledger.error) issues.push(`CRM会计导出读取失败${ledger?.error ? ': ' + ledger.error : ''}`)
    if (ledger && !ledger.error && ledger.period_summary?.complete !== true) issues.push('CRM期间汇总待核或取数不完整')
    if (ledgerComplete(ledger) && !ledgerControlsPresent(ledger)) issues.push('CRM控制数缺失；未知金额不能按零比较')
    if (usableControls && (money(ledger.opening_balance) + money(ledger.totals?.debit) - money(ledger.totals?.credit) !== money(ledger.closing_balance))) issues.push('CRM账簿借贷与余额不平')
    const accountTotals = related.length === codes.length && codes.length ? {
      opening_milli: sum(related, 'opening_milli'), debit_milli: sum(related, 'debit_milli'), credit_milli: sum(related, 'credit_milli'), closing_milli: sum(related, 'closing_milli')
    } : null
    const crmTotals = usableControls ? {
      opening_milli: money(ledger.opening_balance), debit_milli: money(ledger.totals?.debit), credit_milli: money(ledger.totals?.credit), closing_milli: money(ledger.closing_balance)
    } : null
    const difference = accountTotals && crmTotals ? Object.fromEntries(['opening_milli', 'debit_milli', 'credit_milli', 'closing_milli'].map(key => [key, crmTotals[key] - accountTotals[key]])) : null
    if (difference && Object.values(difference).some(Boolean)) issues.push('借贷或余额存在差异')
    const status = !codes.length ? '科目待确认' : issues.length ? '异常待核' : '数字对平·待人工核准'
    const aliases = customers.filter(c => c._id !== customer._id && c.settlement_customer_id === customer._id).map(c => c.name)
    const candidates = !codes.length ? accounting.rows.filter(row => [customer.name, ...aliases].some(name => normalizeName(name) === normalizeName(row.name))) : []
    return { customer_id: customer._id, customer_name: customer.name, is_active: customer.is_active !== false, is_hidden: customer.is_hidden === true,
      aliases, accountant_codes: codes, suggested_codes: candidates.map(row => row.code), status, issues, accounting: accountTotals, crm: crmTotals, difference,
      evidence_complete: usableControls }
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
  const accountMatch = accountText.match(/科目[：:]\s*(?:(\d+)\s+)?(.+?)\s+期间[：:]\s*(\d{6})至(\d{6})/)
  if (!accountMatch) throw Error('明细账科目或期间无法识别')
  const companyText = String(matrix[1]?.find(value => /^(账套名称|编制单位)[：:]/.test(String(value || '').trim())) || '').trim()
  const company = companyText.replace(/^(账套名称|编制单位)[：:]\s*/, '').trim()
  const accountName = accountMatch[2].trim().replace(/^应收账款_站上_/, '')
  const monthFrom = accountMatch[3], monthTo = accountMatch[4]
  if (!/^20\d\d(0[1-9]|1[0-2])$/.test(monthFrom) || !/^20\d\d(0[1-9]|1[0-2])$/.test(monthTo) || monthFrom > monthTo) throw Error('明细账期间无效')
  const openingRow = matrix.slice(4).find(row => row?.[3] === '期初余额')
  const annualRows = matrix.slice(4).filter(row => row?.[3] === '本年累计')
  if (!openingRow || !annualRows.length) throw Error('明细账缺少期初或本年累计')
  if (matrix.slice(4).filter(row => row?.[3] === '期初余额').length !== 1) throw Error('明细账期初重复')
  for (const row of [openingRow, ...annualRows]) if (money(row[7]) !== 0 && !['借', '贷'].includes(row[6])) throw Error('明细账非零余额方向无法确认')
  const opening = money(openingRow[7]) * (openingRow[6] === '贷' ? -1 : 1)
  const rows = []
  for (let index = 4; index < matrix.length; index++) {
    const row = matrix[index] || []
    if (!row.some(value => value != null && value !== '') || ['期初余额', '本月合计', '本年累计'].includes(String(row[3] || ''))) continue
    const date = String(row[1] || '')
    if (!validDate(date) || date.slice(0, 7).replace('-', '') < monthFrom || date.slice(0, 7).replace('-', '') > monthTo) throw Error(`明细账第${index + 1}行日期无效或超出期间`)
    rows.push({ date, voucher: String(row[2] || ''), summary: String(row[3] || ''), debit_milli: money(row[4]), credit_milli: money(row[5]), source_row: index + 1 })
  }
  const lastAnnual = annualRows.at(-1), debit = money(lastAnnual[4]), credit = money(lastAnnual[5])
  const closing = money(lastAnnual[7]) * (lastAnnual[6] === '贷' ? -1 : 1)
  if (opening + sum(rows, 'debit_milli') - sum(rows, 'credit_milli') !== closing || debit !== sum(rows, 'debit_milli') || credit !== sum(rows, 'credit_milli')) {
    throw Error(`会计明细账${accountName}逐笔与本年累计不一致`)
  }
  return { company, account_code: accountMatch[1] || '', account_name: accountName, period_month_from: monthFrom, period_month_to: monthTo, opening_milli: opening,
    debit_milli: debit, credit_milli: credit, closing_milli: closing, rows }
}

function compareDetail(accountingDetails, crmLedger) {
  if (!Array.isArray(accountingDetails) || !accountingDetails.length || !crmLedger || !Array.isArray(crmLedger.rows)) throw Error('缺少同客户双方明细')
  const accountant = accountingDetails.flatMap(detail => detail.rows.map(row => ({ ...row, account_name: detail.account_name, account_code: detail.account_code || detail.code })))
  const crm = crmLedger.rows.filter(row => row.row_type === 'movement').map(row => ({ date: row.biz_date,
    debit_milli: money(row.debit), credit_milli: money(row.credit), source_type: row.source_type, source_id: row.source_id,
    business_kind: row.business_kind, summary: row.summary, adjustment_source: row.adjustment_source }))
  const key = row => `${row.date}|${row.debit_milli}|${row.credit_milli}`
  const remaining = new Map()
  for (const row of accountant) { const k = key(row); if (!remaining.has(k)) remaining.set(k, []); remaining.get(k).push(row) }
  const unmatchedCrm = [], matchedPairs = []
  for (const row of crm) {
    const list = remaining.get(key(row))
    if (list?.length) matchedPairs.push({ crm: row, accountant: list.shift() })
    else unmatchedCrm.push(row)
  }
  const unmatchedAccounting = [...remaining.values()].flat()
  const amountKey = row => `${row.debit_milli}|${row.credit_milli}`
  const dateCandidates = unmatchedCrm.map(c => ({ crm: c, accountant: unmatchedAccounting.filter(a => amountKey(a) === amountKey(c) && a.date !== c.date) }))
    .filter(pair => pair.accountant.length)
  return { crm_row_count: crm.length, accounting_row_count: accountant.length, exact_match_count: crm.length - unmatchedCrm.length,
    unmatched_crm: unmatchedCrm, unmatched_accounting: unmatchedAccounting, possible_date_differences: dateCandidates,
    matched_pairs: matchedPairs, classification_verified: false,
    fully_matched: unmatchedCrm.length === 0 && unmatchedAccounting.length === 0 }
}

// Binding is deliberately separate from parsing: old CLI callers can still parse
// a standalone file, but the center must prove its book, period and subject scope.
function validateAccountingDetails({ accounting, details, codes, dateFrom, cutoff }) {
  validatePeriod(dateFrom, cutoff, accounting?.month)
  if (!accounting?.company || !Array.isArray(accounting.rows)) throw Error('缺少已校验统计表')
  if (!Array.isArray(codes) || !codes.length || new Set(codes).size !== codes.length || !Array.isArray(details) || details.length !== codes.length) throw Error('逐笔明细文件与已确认科目范围不一致')
  const seen = new Set()
  for (const detail of details) {
    // Caller code is permitted only when the original export has no code.
    const code = detail.account_code || detail.code || ''
    if (detail.account_code && detail.code && detail.account_code !== detail.code) throw Error('明细账原始科目编码与指定编码冲突')
    if (!code || !codes.includes(code) || seen.has(code)) throw Error('明细账科目编码缺失、重复或不在已确认范围')
    seen.add(code)
    if (!detail.company || normalizeName(detail.company) !== normalizeName(accounting.company)) throw Error(`科目${code}明细账与统计表账套不一致或账套缺失`)
    if (detail.period_month_from !== dateFrom.slice(0, 7).replace('-', '') || detail.period_month_to !== cutoff.slice(0, 7).replace('-', '')) throw Error(`科目${code}明细账与统计表期间不一致`)
    const subject = accounting.rows.find(row => row.code === code)
    if (!subject || normalizeName(detail.account_name) !== normalizeName(subject.name) || CONTROL_KEYS.some(key => !Number.isSafeInteger(detail[key]) || detail[key] !== subject[key])) throw Error(`科目${code}逐笔明细与本批汇总不一致；请核对名称和四项控制数`)
    if (!Array.isArray(detail.rows) || detail.rows.some(row => !validDate(row.date) || row.date < dateFrom || row.date > cutoff || !Number.isSafeInteger(row.debit_milli) || !Number.isSafeInteger(row.credit_milli))) throw Error(`科目${code}明细行不完整或超出已确认截止日`)
    if (sum(detail.rows, 'debit_milli') !== detail.debit_milli || sum(detail.rows, 'credit_milli') !== detail.credit_milli || detail.opening_milli + detail.debit_milli - detail.credit_milli !== detail.closing_milli) throw Error(`科目${code}明细行与控制数不一致`)
  }
  return true
}

const issue = (type, code, message, fields = {}) => ({ type, code, message, ...fields })
const dateOfLedger = ledger => ({ dateFrom: ledger?.period?.date_from || ledger?.period_summary?.date_from,
  cutoff: ledger?.period?.date_to || ledger?.period_summary?.date_to })
const businessKind = row => {
  if (row?.business_kind) return row.business_kind // Structured evidence only; never parse a note.
  const type = row?.source_type || ''
  if (['sale', 'flow_settlement'].includes(type)) return 'goods_revenue'
  if (type === 'prepay_writeoff') return 'settlement_writeoff_income'
  if (type === 'rounding_reversal') return 'rounding_reversal'
  if (type === 'receipt_rounding' || type.endsWith('_rounding_fallback')) return 'rounding'
  if (['receipt', 'refund', 'opening_prepay', 'deposit_transfer', 'settlement_fee', 'other_fee'].includes(type)) return type
  return ''
}

function classifyDetails(detailComparison) {
  const issues = [], coveredCrm = new Set(), coveredAccounting = new Set()
  for (const pair of detailComparison.matched_pairs) {
    const crmKind = businessKind(pair.crm), accountingKind = businessKind(pair.accountant)
    if (crmKind && accountingKind && crmKind !== accountingKind) issues.push(issue('classification', 'BUSINESS_KIND_DIFFERENCE', '金额和日期一致，但有结构化依据的业务分类不同', {
      crm: pair.crm, accounting: pair.accountant, suggested_action: 'verify_classification_evidence'
    }))
  }
  for (const pair of detailComparison.possible_date_differences) {
    coveredCrm.add(pair.crm)
    pair.accountant.forEach(row => coveredAccounting.add(row))
    issues.push(issue('date', 'POSSIBLE_DATE_DIFFERENCE', '同额不同日，仅为对应候选；确认同一笔原始依据后再修正日期', {
      crm: pair.crm, accounting: pair.accountant, suggested_action: 'verify_receipt_identity'
    }))
  }
  // Repeated values are suspicious only when an unmatched occurrence exists;
  // repeated legitimate equal payments alone must not create false duplicates.
  const signature = row => `${row.date}|${row.debit_milli}|${row.credit_milli}`
  for (const [side, rows, matchedKey] of [['crm', detailComparison.unmatched_crm, 'crm'], ['accounting', detailComparison.unmatched_accounting, 'accountant']]) {
    for (const row of rows) {
      if (detailComparison.matched_pairs.some(pair => signature(pair[matchedKey]) === signature(row))) {
        issues.push(issue('duplicate', 'POSSIBLE_DUPLICATE', '一方存在额外同日同额记录，需核对凭证或原单；不能据此直接删除', { [side]: row, suggested_action: 'verify_original_record' }))
        ;(side === 'crm' ? coveredCrm : coveredAccounting).add(row)
      }
    }
  }
  for (const c of detailComparison.unmatched_crm) {
    if (coveredCrm.has(c)) continue
    const candidates = detailComparison.unmatched_accounting.filter(a => !coveredAccounting.has(a) && a.date === c.date &&
      ((a.debit_milli !== 0 && c.debit_milli !== 0) || (a.credit_milli !== 0 && c.credit_milli !== 0)))
    if (candidates.length) {
      coveredCrm.add(c); candidates.forEach(a => coveredAccounting.add(a))
      const kind = businessKind(c)
      const classification = ['other_fee', 'settlement_writeoff_income', 'rounding', 'rounding_reversal', 'opening_prepay', 'deposit_transfer', 'settlement_fee'].includes(kind)
      issues.push(issue(classification ? 'classification' : 'amount', classification ? 'NONCASH_CLASSIFICATION_CANDIDATE' : 'POSSIBLE_AMOUNT_DIFFERENCE',
        classification ? '同日非现金或费用记录不一致，需核对分类及原始依据；不将借贷金额当作新增到账' : '同日记录金额不同，仅为对应候选',
        { crm: c, accounting: candidates, suggested_action: classification ? 'verify_classification_evidence' : 'verify_amount_evidence' }))
    }
  }
  for (const [side, rows, covered] of [['crm', detailComparison.unmatched_crm, coveredCrm], ['accounting', detailComparison.unmatched_accounting, coveredAccounting]]) {
    for (const row of rows) if (!covered.has(row)) issues.push(issue('unposted', side === 'crm' ? 'ACCOUNTING_ENTRY_NOT_MATCHED' : 'CRM_ENTRY_NOT_MATCHED',
      side === 'crm' ? 'CRM记录尚未在好会计找到对应项；可能未入账或拆并入账，需核对' : '好会计记录尚未在CRM找到对应项；需核对原单依据',
      { [side]: row, suggested_action: side === 'crm' ? 'verify_accounting_entry' : 'verify_crm_entry' }))
  }
  return issues
}

function compareCustomer({ accounting, customer, customers = [], ledger, mapping = [], details, internal }) {
  const issues = []
  // A failed source reread invalidates even a previously returned ledger.
  const sourceReadable = internal?.read_complete !== false
  const ledgerReady = sourceReadable && ledgerComplete(ledger)
  const list = customers.length ? customers : [customer]
  if (!customer?._id || !list.some(row => row?._id === customer._id)) throw Error('缺少CRM结算客户')
  const allMappings = Array.isArray(mapping) ? mapping : [mapping]
  const mapped = allMappings.find(row => row?.crm_customer_id === customer._id)
  let comparison
  try {
    comparison = compare({ accounting, customers: list, expectedCustomerCount: list.length,
      ledgers: { [customer._id]: sourceReadable ? ledger : undefined }, mapping: allMappings.filter(row => list.some(c => c._id === row.crm_customer_id)) }).customers.find(row => row.customer_id === customer._id)
  } catch (error) {
    issues.push(issue('mapping', 'MAPPING_INVALID', error.message))
  }
  if (!comparison) return { summary_match: false, detail_match: null, evidence_level: 'incomplete', issues, comparison: null, detail_comparison: null, classification_verified: false }
  if (!mapped?.accountant_codes?.length) issues.push(issue('mapping', 'MAPPING_REQUIRED', '请确认CRM结算客户与好会计科目的对应关系；同名仅为候选'))
  else if (!comparison.accounting) issues.push(issue('mapping', 'MAPPED_SUBJECT_MISSING', '已确认会计科目不在本次导出中'))
  let complete = ledgerReady
  if (ledgerReady && !ledgerControlsPresent(ledger)) {
    complete = false
    issues.push(issue('evidence', 'CRM_CONTROLS_MISSING', 'CRM控制数缺失；未知金额不能按零比较'))
  }
  if (!complete) issues.push(issue('evidence', 'CRM_READ_INCOMPLETE', ledger?.error ? `CRM账簿读取失败：${ledger.error}`
    : !sourceReadable ? 'CRM来源读取未完整完成，已有账簿暂不可用于比较' : 'CRM期间汇总待核或读取不完整', { source: ledger?.period_summary?.unresolved_sources || [] }))
  if (comparison.crm && comparison.crm.opening_milli + comparison.crm.debit_milli - comparison.crm.credit_milli !== comparison.crm.closing_milli) {
    complete = false
    issues.push(issue('evidence', 'CRM_CONTROLS_UNBALANCED', 'CRM账簿借贷与余额不平'))
  }
  if (internal) {
    if (internal.complete !== true) { complete = false; issues.push(issue('evidence', 'INTERNAL_CHECK_INCOMPLETE', 'CRM内部核查未完整完成')) }
    for (const row of internal.issues || []) issues.push(typeof row === 'string' ? issue('evidence', 'INTERNAL_CHECK_ISSUE', row) : row)
    if ((internal.issues || []).some(row => row?.blocking !== false && row?.severity !== 'info' && row?.severity !== 'warning')) complete = false
  }
  const period = dateOfLedger(ledger)
  let periodValid = false
  if (ledgerReady) {
    try { validatePeriod(period.dateFrom, period.cutoff, accounting.month); periodValid = true } catch (error) {
      complete = false; issues.push(issue('evidence', 'PERIOD_INVALID', error.message))
    }
  }
  if (comparison.difference && Object.values(comparison.difference).some(Boolean)) issues.push(issue('amount', 'CONTROL_TOTAL_DIFFERENCE', '期初、发生、收回或期末存在差异；余额相同不能代替四项核对', {
    crm: comparison.crm, accounting: comparison.accounting, difference: comparison.difference, suggested_action: 'import_accounting_details'
  }))
  const summaryMatch = Boolean(complete && comparison.accounting && comparison.difference && !Object.values(comparison.difference).some(Boolean))
  let detailMatch = null, detailComparison = null, detailValidated = false, detailInvalid = false
  if (ledgerReady && ledgerControlsPresent(ledger) && periodValid && Array.isArray(details) && details.length) {
    try {
      validateAccountingDetails({ accounting, details, codes: mapped?.accountant_codes, ...period })
      if (!Array.isArray(ledger?.rows)) throw Error('CRM逐笔明细缺失')
      const movements = ledger.rows.filter(row => row.row_type === 'movement')
      if (movements.some(row => !validDate(row.biz_date) || row.biz_date < period.dateFrom || row.biz_date > period.cutoff)) throw Error('CRM逐笔日期无效或超出期间')
      if (sum(movements.map(row => ({ debit: money(row.debit), credit: money(row.credit) })), 'debit') !== comparison.crm?.debit_milli ||
        sum(movements.map(row => ({ debit: money(row.debit), credit: money(row.credit) })), 'credit') !== comparison.crm?.credit_milli) throw Error('CRM逐笔明细与汇总控制数不一致')
      detailComparison = compareDetail(details, ledger)
      const detailIssues = classifyDetails(detailComparison)
      issues.push(...detailIssues)
      detailValidated = true
      detailMatch = summaryMatch && detailComparison.fully_matched && !detailIssues.length
    } catch (error) { issues.push(issue('evidence', 'DETAIL_SCOPE_INVALID', error.message)); detailMatch = false; detailInvalid = true }
  }
  return { summary_match: summaryMatch, detail_match: detailMatch,
    evidence_level: complete && comparison.accounting && !detailInvalid ? (detailValidated ? 'detail' : 'summary') : 'incomplete',
    issues, comparison, detail_comparison: detailComparison, classification_verified: false,
    // This is an existing backend projection, not a new cash calculation.
    period_summary: sourceReadable && !ledger?.error ? ledger?.period_summary || null : null,
    interpretation: '逐笔一致仅表示日期和借贷金额对应；摘要文字不能证明现金、退款、抹零或结清性质。' }
}

module.exports = { parseAccountingSummary, validateCustomerInventory, validatePeriod, compare, parseAccountingDetail, compareDetail,
  validateAccountingDetails, compareCustomer, money, yuan }
