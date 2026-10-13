'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const XLSX = require('../uniCloud-alipay/cloudfunctions/crm-reconciliation/vendor/xlsx')
const { decodeSource, MAX_BYTES } = require('../uniCloud-alipay/cloudfunctions/crm-reconciliation/source')

const summary = () => [['应收统计表'], ['编制单位：演示账套', null, null, '2026年09月'],
  ['客户编码', '客户', '期初余额', null, '本期发生', null, '本期收回', null, '余额', '本年累计'],
  [null, null, null, null, null, null, null, null, null, '发生', '收回'],
  ['112201', '测试客户', 0, null, 100, null, 100, null, 0, 100, 100],
  [null, '合计', 0, null, 100, null, 100, null, 0, 100, 100]]
const detail = () => [['明细账'], ['账套名称:演示账套'], ['科目:112201 应收账款_站上_测试客户   期间:202601至202609   单位:元'],
  ['序号', '日期', '凭证号', '摘要', '借方', '贷方', '方向', '余额'],
  ['1', '2026-01', '', '期初余额', 0, 0, '平', 0],
  ['2', '2026-09-18', '记-1', '销售', 100, 0, '借', 100],
  ['3', '2026-09-18', '记-2', '收款', 0, 100, '平', 0],
  ['4', '2026-09', '', '本年累计', 100, 100, '平', 0]]
function file(matrix, type = 'xlsx', extraSheets = []) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), '报表')
  extraSheets.forEach((rows, i) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '其他' + i))
  return { name: '来源.' + type, base64: Buffer.from(XLSX.write(book, { type: 'buffer', bookType: type })).toString('base64') }
}

test('真实xls与xlsx报表均按原始字节保留哈希及控制数', () => {
  for (const type of ['xls', 'xlsx']) {
    const source = file(summary(), type), result = decodeSource(source, 'summary')
    assert.equal(result.parsed.company, '演示账套')
    assert.equal(result.parsed.controls.debit_milli, 100000)
    assert.equal(result.base64, source.base64)
    assert.equal(result.sha256, crypto.createHash('sha256').update(Buffer.from(source.base64, 'base64')).digest('hex'))
    const parsed = decodeSource(file(detail(), type), 'detail').parsed
    assert.equal(parsed.account_code, '112201')
    assert.equal(parsed.company, '演示账套')
    assert.equal(parsed.rows.length, 2)
  }
})

test('空坏文件、非规范base64、伪造扩展名及超限文件拒绝', () => {
  for (const source of [
    { name: 'x.xlsx', base64: '' }, { name: 'x.xlsx', base64: '!' },
    { name: 'x.txt', base64: file(summary()).base64 },
    { name: 'x.xlsx', base64: Buffer.from('this is not an accounting workbook').toString('base64') },
    { name: 'x.xlsx', base64: Buffer.alloc(MAX_BYTES + 1).toString('base64') },
    { name: 'x.xlsx', base64: 'AA==' }
  ]) assert.throws(() => decodeSource(source, 'summary'))
})

test('多个有效报表不能任意取第一张；无关说明页不改变唯一报表', () => {
  assert.throws(() => decodeSource(file(summary(), 'xlsx', [summary()]), 'summary'), /唯一/)
  assert.equal(decodeSource(file(summary(), 'xlsx', [[['说明', '测试']]]), 'summary').parsed.count, 1)
})

test('合计不一致和明细缺行不能被解析器当作完整数据', () => {
  const badSummary = summary(); badSummary[5][9] = 99
  assert.throws(() => decodeSource(file(badSummary), 'summary'), /合计/)
  const badDetail = detail(); badDetail.splice(5, 1)
  assert.throws(() => decodeSource(file(badDetail), 'detail'), /不一致/)
})

test('工作簿声明解压容量过大或目录不完整时解析前停止', () => {
  const source = file(summary()), bytes = Buffer.from(source.base64, 'base64')
  let offset = -1
  for (let at = 0; at + 46 <= bytes.length; at++) if (bytes.readUInt32LE(at) === 0x02014b50) { offset = at; break }
  assert.ok(offset > 0)
  bytes.writeUInt32LE(25 * 1024 * 1024, offset + 24)
  assert.throws(() => decodeSource({ name: source.name, base64: bytes.toString('base64') }, 'summary'), /解压后过大/)
  assert.throws(() => decodeSource({ name: source.name, base64: Buffer.from('PKnot-a-valid-zip').toString('base64') }, 'summary'), /目录不完整/)
})

test('公式缺失缓存不能补零后冒充明确金额', () => {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(summary())
  sheet.J5 = { t: 'n', f: 'SUM(100)' }; sheet.J6 = { t: 'n', f: 'SUM(J5)' }
  XLSX.utils.book_append_sheet(book, sheet, '报表')
  const source = { name: 'formula.xlsx', base64: Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })).toString('base64') }
  assert.throws(() => decodeSource(source, 'summary'))
})
