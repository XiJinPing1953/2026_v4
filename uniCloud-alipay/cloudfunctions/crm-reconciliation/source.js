'use strict'
const crypto = require('crypto')
const XLSX = require('./vendor/xlsx')
const { parseAccountingSummary, parseAccountingDetail } = require('./customerReconciliationLocal')
const MAX_BYTES = 2 * 1024 * 1024
function decodeSource(source, kind) {
  if (!source || !/\.(xls|xlsx)$/i.test(source.name || '') || typeof source.base64 !== 'string' || source.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.base64)) throw Error('请选择不超过 2 MiB 的原始 xls/xlsx 文件')
  const bytes = Buffer.from(source.base64, 'base64')
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== source.base64) throw Error('文件内容不完整')
  // Bound OOXML expansion before the parser allocates cells; classic XLS is
  // already bounded by input size and the worksheet row limit below.
  if (bytes.readUInt16LE(0) === 0x4b50) {
    let expanded = 0, entries = 0
    for (let at = 0; at + 46 <= bytes.length; at++) if (bytes.readUInt32LE(at) === 0x02014b50) {
      expanded += bytes.readUInt32LE(at + 24); entries++
      if (expanded > 24 * 1024 * 1024 || entries > 1000) throw Error('工作簿解压后过大，请分科目导出')
    }
    if (!entries) throw Error('工作簿压缩目录不完整')
  }
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: false, cellHTML: false, cellStyles: false, cellFormula: true, sheetStubs: true, bookVBA: false, sheetRows: 30002 })
  const candidates = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith('!') && (cell.f || cell.F || cell.t === 'e')) throw Error('报表含公式或错误单元格，请重新导出好会计原始值表')
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1')
    if (range.e.r > 30000 || range.e.c > 100) throw Error('工作表超出核查范围，请分科目导出')
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true })
    try { candidates.push((kind === 'summary' ? parseAccountingSummary : parseAccountingDetail)(matrix)) } catch (error) {
      if (workbook.SheetNames.length === 1) throw error
    }
  }
  if (candidates.length !== 1) throw Error('无法唯一识别好会计报表工作表')
  return { name: source.name.split(/[\\/]/).pop().slice(0, 180), bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), base64: source.base64, parsed: candidates[0] }
}
module.exports = { decodeSource, MAX_BYTES }
