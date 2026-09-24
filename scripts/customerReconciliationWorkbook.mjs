#!/usr/bin/env node
// The runner copies this file beside the bundled @oai/artifact-tool runtime.
import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3)
const mode = arg('mode')
const input = arg('input')
const output = arg('output')
if (!input || !output || !['parse', 'report'].includes(mode)) throw Error('用法: --mode=parse|report --input=文件 --output=文件')

if (mode === 'parse') {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input))
  if (workbook.worksheets.items.length !== 1) throw Error('应收统计表应只有一个工作表')
  const matrix = workbook.worksheets.getItemAt(0).getUsedRange().values
  await fs.writeFile(output, JSON.stringify(matrix), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ action: 'parse', rows: matrix.length, columns: Math.max(...matrix.map(row => row.length)) }))
  process.exit(0)
}

const report = JSON.parse(await fs.readFile(input, 'utf8'))
const detailPath = arg('details')
const details = detailPath ? JSON.parse(await fs.readFile(detailPath, 'utf8')) : null
if (details && (!report.comparison.customers.some(row => row.customer_id === details.customer_id && row.status === '异常待核') ||
  details.date_from !== report.date_from || details.cutoff !== report.cutoff)) throw Error('逐笔分析与当前异常批次不一致')
const workbook = Workbook.create()
const yuan = milli => Number((milli / 1000).toFixed(3))
const safe = value => value == null ? '' : String(value)
const money = value => value == null ? '' : yuan(value)
const controlMoney = value => `${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(money(value))} 元`
const accountRows = report.accounting.rows
const subjects = new Map(accountRows.map(row => [row.code, row]))
const summary = workbook.worksheets.add('客户对账')
const headers = ['状态','CRM客户','CRM客户ID','启用','隐藏','会计科目编码','会计客户名','CRM期初','会计期初','期初差额','CRM借方','会计借方','借方差额','CRM贷方','会计贷方','贷方差额','CRM期末','会计期末','期末差额','CRM取数完整','可能对应科目','待办原因']
summary.getRange('A1:V1').values = [headers]
const compareRows = report.comparison.customers.map(row => [row.status,row.customer_name,row.customer_id,row.is_active?'是':'否',row.is_hidden?'是':'否',row.accountant_codes.join(', '),
  row.accountant_codes.map(code => subjects.get(code)?.name || '缺失').join('、'),money(row.crm?.opening_milli),money(row.accounting?.opening_milli),money(row.difference?.opening_milli),
  money(row.crm?.debit_milli),money(row.accounting?.debit_milli),money(row.difference?.debit_milli),money(row.crm?.credit_milli),money(row.accounting?.credit_milli),money(row.difference?.credit_milli),
  money(row.crm?.closing_milli),money(row.accounting?.closing_milli),money(row.difference?.closing_milli),row.evidence_complete?'是':'否',row.suggested_codes.join(', '),row.issues.join('；')])
if (compareRows.length) summary.getRange(`A2:V${compareRows.length + 1}`).values = compareRows
summary.getRange(`A1:V${compareRows.length + 1}`).format.font = { name: 'Arial', size: 10 }
summary.getRange('A1:V1').format = { fill: '#DCEAF7', font: { name: 'Arial', bold: true, color: '#183C60' }, rowHeight: 30 }
summary.getRange('A:A').format.columnWidth = 24
summary.getRange('B:B').format.columnWidth = 27
summary.getRange('C:C').format.columnWidth = 27
summary.getRange('F:G').format.columnWidth = 29
summary.getRange('U:V').format.columnWidth = 38
summary.getRange(`C2:C${compareRows.length + 1}`).setNumberFormat('@')
summary.getRange(`F2:F${compareRows.length + 1}`).setNumberFormat('@')
summary.getRange(`H2:S${compareRows.length + 1}`).setNumberFormat('#,##0.000;[Red]-#,##0.000;0.000')
summary.freezePanes.freezeRows(1)
if (compareRows.length) summary.tables.add(`A1:V${compareRows.length + 1}`, true, 'CustomerReconciliation')

const exceptions = workbook.worksheets.add('异常与待办')
exceptions.getRange('A1:H1').values = [['类型','客户或科目','标识','原因','期初差额','借方差额','贷方差额','期末差额']]
const exceptionRows = report.comparison.customers.filter(row => row.status !== '数字对平·待人工核准').map(row =>
  [row.status,row.customer_name,row.customer_id,row.issues.join('；'),money(row.difference?.opening_milli),money(row.difference?.debit_milli),money(row.difference?.credit_milli),money(row.difference?.closing_milli)])
for (const row of report.comparison.unmatched_subjects) exceptionRows.push(['会计科目未映射',row.name,row.code,
  row.suggested_customer_ids.length ? `同名候选CRM ID：${row.suggested_customer_ids.join(', ')}` : '请确认是否属于CRM核账范围', '', '', '', ''])
if (exceptionRows.length) exceptions.getRange(`A2:H${exceptionRows.length + 1}`).values = exceptionRows
exceptions.getRange('A1:H1').format = { fill: '#FCE8DC', font: { name: 'Arial', bold: true, color: '#753E23' }, rowHeight: 30 }
exceptions.getRange('A:A').format.columnWidth = 26
exceptions.getRange('B:B').format.columnWidth = 30
exceptions.getRange('C:C').format.columnWidth = 28
exceptions.getRange('D:D').format.columnWidth = 70
exceptions.getRange('E:H').format.columnWidth = 18
exceptions.getRange(`C2:C${exceptionRows.length + 1}`).setNumberFormat('@')
exceptions.getRange(`E2:H${exceptionRows.length + 1}`).setNumberFormat('#,##0.000;[Red]-#,##0.000;0.000')
exceptions.freezePanes.freezeRows(1)
if (exceptionRows.length) exceptions.tables.add(`A1:H${exceptionRows.length + 1}`, true, 'ReconciliationExceptions')

const accounts = workbook.worksheets.add('会计科目')
accounts.getRange('A1:H1').values = [['科目编码','会计客户名','年初余额(推回)','本年借方','本年贷方','期末余额','本月期初','来源行号']]
const accountData = accountRows.map(row => [row.code,row.name,money(row.opening_milli),money(row.debit_milli),money(row.credit_milli),money(row.closing_milli),money(row.month_opening_milli),row.source_row])
accounts.getRange(`A2:H${accountData.length + 1}`).values = accountData
accounts.getRange('A1:H1').format = { fill: '#E3EFEA', font: { name: 'Arial', bold: true, color: '#1E533D' }, rowHeight: 30 }
accounts.getRange('A:B').format.columnWidth = 31
accounts.getRange('C:G').format.columnWidth = 20
accounts.getRange(`A2:A${accountData.length + 1}`).setNumberFormat('@')
accounts.getRange(`C2:G${accountData.length + 1}`).setNumberFormat('#,##0.000;[Red]-#,##0.000;0.000')
accounts.freezePanes.freezeRows(1)
accounts.tables.add(`A1:H${accountData.length + 1}`, true, 'AccountingSubjects')

if (Array.isArray(report.customer_inventory)) {
  const inventory = workbook.worksheets.add('CRM客户范围')
  inventory.getRange('A1:G1').values = [['CRM客户','客户ID','结算主户ID','是否独立结算','启用','隐藏','主户核对状态']]
  const statuses = new Map(report.comparison.customers.map(row => [row.customer_id, row.status]))
  const inventoryRows = report.customer_inventory.map(row => [row.name,row.id,row.settlement_customer_id,
    row.settlement_customer_id ? '否（归入主户）' : '是',row.is_active ? '是' : '否',row.is_hidden ? '是' : '否',
    statuses.get(row.settlement_customer_id || row.id) || '主户缺失'])
  if (inventoryRows.length !== report.comparison.customer_count) throw Error('CRM客户范围与已验证总数不一致')
  inventory.getRange(`A2:G${inventoryRows.length + 1}`).values = inventoryRows
  inventory.getRange('A1:G1').format = { fill: '#E6EAF5', font: { name: 'Arial', bold: true, color: '#303E68' }, rowHeight: 30 }
  inventory.getRange('A:A').format.columnWidth = 32
  inventory.getRange('B:C').format.columnWidth = 30
  inventory.getRange('D:G').format.columnWidth = 25
  inventory.getRange(`B2:C${inventoryRows.length + 1}`).setNumberFormat('@')
  inventory.freezePanes.freezeRows(1)
  inventory.tables.add(`A1:G${inventoryRows.length + 1}`, true, 'CrmCustomerScope')
}

if (details) {
  const detailSheet = workbook.worksheets.add('逐笔异常')
  detailSheet.getRange('A1:H1').values = [['来源','日期','借方','贷方','凭证或源单','摘要或类型','可能对应日期','说明']]
  const matchedDates = new Map(details.comparison.possible_date_differences.map(pair =>
    [`${pair.crm.date}|${pair.crm.source_id}`, pair.accountant.map(row => row.date).join('、')]))
  const detailRows = [
    ...details.comparison.unmatched_crm.map(row => ['CRM',row.date,money(row.debit_milli),money(row.credit_milli),row.source_id,row.source_type,
      matchedDates.get(`${row.date}|${row.source_id}`) || '', '金额或日期待查；同额候选不代表同笔']),
    ...details.comparison.unmatched_accounting.map(row => ['好会计',row.date,money(row.debit_milli),money(row.credit_milli),row.voucher,row.summary,'','需核原始凭证与经济性质'])
  ]
  if (detailRows.length) detailSheet.getRange(`A2:H${detailRows.length + 1}`).values = detailRows
  detailSheet.getRange('A1:H1').format = { fill: '#FCE8DC', font: { name: 'Arial', bold: true, color: '#753E23' }, rowHeight: 30 }
  detailSheet.getRange('A:B').format.columnWidth = 18
  detailSheet.getRange('C:D').format.columnWidth = 17
  detailSheet.getRange('E:E').format.columnWidth = 34
  detailSheet.getRange('F:F').format.columnWidth = 55
  detailSheet.getRange('G:H').format.columnWidth = 35
  detailSheet.getRange(`E2:E${detailRows.length + 1}`).setNumberFormat('@')
  detailSheet.getRange(`C2:D${detailRows.length + 1}`).setNumberFormat('#,##0.000;[Red]-#,##0.000;0.000')
  detailSheet.freezePanes.freezeRows(1)
  if (detailRows.length) detailSheet.tables.add(`A1:H${detailRows.length + 1}`, true, 'DetailExceptions')
}

const sources = workbook.worksheets.add('来源与口径')
const scope = [
  ['核对期间', `${report.date_from} 至 ${report.cutoff}`],
  ['好会计账套', report.accounting.company],
  ['好会计选择月份', report.accounting.month],
  ['会计已记账截止', `${report.cutoff}（用户确认；报表本身只标月份）`],
  ['源文件SHA-256', report.source.sha256],
  ['会计科目数', report.accounting.count],
  ['好会计年初总额', controlMoney(report.accounting.controls.opening_milli)],
  ['好会计本年借方合计', controlMoney(report.accounting.controls.debit_milli)],
  ['好会计本年贷方合计', controlMoney(report.accounting.controls.credit_milli)],
  ['好会计期末总额', controlMoney(report.accounting.controls.closing_milli)],
  ['CRM全部客户数', report.comparison.customer_count],
  ['CRM独立结算户数', report.comparison.settlement_customer_count],
  ['CRM期间投影完整户数', report.comparison.customers.filter(row => row.evidence_complete).length],
  ['CRM期间待核或不完整户数', report.comparison.customers.filter(row => !row.evidence_complete).length],
  ['数字对平待人工核准', report.comparison.matched_count],
  ['异常待核', report.comparison.exception_count],
  ['CRM科目待确认', report.comparison.unmapped_count],
  ['会计未映射科目', report.comparison.unmatched_subjects.length],
  ['完成结论', report.comparison.unmapped_count || report.comparison.unmatched_subjects.length || report.comparison.exception_count ? '未完成全客户核准' : '数字全部对平，仍待人工核准'],
  ['期初计算', '好会计本表期初是本月月初；年初余额=期末余额−本年累计借方+本年累计贷方'],
  ['对比口径', '比较会计账簿期初/借方/贷方/期末，不将本年贷方直接称为CRM实际收款'],
  ['全表合计边界', '好会计合计已与182科目逐行核对；未确认映射前，不把会计全表与CRM全表直接相减'],
  ['证据边界', '本表与CRM会计导出均为投影；逐笔凭证与修账须另查原始依据'],
  ['资金与页面', '本流程不修改账务数据、核准清单或CRM页面'],
  ...(details ? [['异常逐笔证据', `客户ID ${details.customer_id}；明细源文件SHA-256 ${details.sources.map(source => source.sha256).join('、')}；同额候选仅供人工定位`]] : [])
]
sources.getRange(`A1:B${scope.length}`).values = scope
sources.getRange('A:A').format.columnWidth = 30
sources.getRange('B:B').format.columnWidth = 95
sources.getRange(`A1:A${scope.length}`).format.font = { name: 'Arial', bold: true, color: '#183C60' }
sources.getRange(`B1:B${scope.length}`).format.wrapText = true
sources.getRange('A1:B1').format.fill = '#DCEAF7'
sources.getRange(`A1:B${scope.length}`).format.rowHeight = 30

await workbook.recalculate()
const errorScan = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 100 }, summary: 'formula error scan' })
if (errorScan.ndjson && /"cell"|"address"/.test(errorScan.ndjson)) throw Error('Excel报告存在公式错误')
const blob = await SpreadsheetFile.exportXlsx(workbook)
await blob.save(output)
console.log(JSON.stringify({ action: 'report', output, customers: compareRows.length, exceptions: exceptionRows.length, detail_rows: details?.comparison ? details.comparison.unmatched_crm.length + details.comparison.unmatched_accounting.length : 0 }))
