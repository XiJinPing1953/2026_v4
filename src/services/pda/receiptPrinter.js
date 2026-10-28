// The installed BLE SDK contains EscCommand as well as its label-only JS API.
// Reuse that SDK's connected transport; never open a second socket or touch the scale.
const COMMAND = 'com.smart.command.EscCommand'
const MANAGER = 'com.uni.blePrintSDK.print.DeviceConnFactoryManager'
const missing = () => new Error('当前安装包缺少小票打印接口，请更新安装包')
// 16 mm cleared the tear edge onsite; the requested signature area gets a
// slightly longer 20 mm trailing allowance on continuous receipt stock.
export const RECEIPT_TAIL_DOTS = 160

export function writeReceiptText(android, rows, address) {
  if (!android?.newObject || !android?.invoke) throw missing()
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address || '')) throw new Error('打印机地址无效')
  const sorted = rows.map(row => ({ ...row, text: String(row.text).replace(/[\x00-\x1f\x7f]/g, ' ') }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  if (!sorted.length || sorted.some(row => !Number.isInteger(row.x) || row.x < 0 || row.x > 560 || !Number.isInteger(row.y) || row.y < 0 || row.y > 1600)) throw new Error('小票排版资料无效')
  const manager = android.invoke(MANAGER, 'getDeviceConnFactoryManager')
  function checkConnection() {
    if (!manager || android.invoke(manager, 'getConnState') !== true || String(android.invoke(manager, 'getMacAddress') || '').toUpperCase() !== address.toUpperCase()) throw new Error('打印机连接已变化，请重连后补打')
  }
  checkConnection()
  const command = android.newObject(COMMAND)
  if (!command) throw missing()
  const bytes = android.invoke(command, 'getCommand')
  if (!bytes || android.invoke(bytes, 'size') !== 0) throw missing()
  let size = 0
  function append(method, length, ...args) {
    android.invoke(command, method, ...args)
    // Native.js can silently return undefined for an unavailable/mismatched method.
    // Check the actual buffer before sending, rather than claiming an empty send worked.
    const next = android.invoke(bytes, 'size')
    if (!Number.isInteger(next) || (length === null ? next <= size : next !== size + length)) throw missing()
    size = next
  }
  function feed(dots) {
    // Keep Java byte arguments in the signed range. ESC J prints the current line
    // and advances by the requested distance; there is no label/form-feed command.
    while (dots > 0) { const n = Math.min(dots, 127); append('addPrintAndFeedPaper', 3, n); dots -= n }
  }
  append('addInitializePrinter', 2)
  append('addSelectKanjiMode', 2)
  append('addSetHorAndVerMotionUnits', 4, -53, -53) // unsigned 203: 1/203 inch per dot
  append('addSetLeftMargin', 4, 0)
  append('addSetPrintingAreaWidth', 4, 576)
  let y = 0
  for (const row of sorted) {
    feed(row.y - y); y = row.y
    append('addSetAbsolutePrintPosition', 4, row.x)
    if (row.text) append('addText', null, row.text) // SDK encodes GB2312, same as existing labels
  }
  feed(24 + RECEIPT_TAIL_DOTS)
  checkConnection()
  android.invoke(manager, 'sendDataImmediately', bytes)
  // The SDK has no physical completion acknowledgement; caller reports "sent" only.
}
