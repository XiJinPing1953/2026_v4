import { getPairedPrinters } from './labelPrinter'

const BOUND_KEY = 'pda_label_printer_bound_v1'

export async function selectPairedPrinter({ android, ui, valid = () => true }) {
  if (!valid()) return null
  const devices = getPairedPrinters(android)
  if (!devices.length) throw new Error('请先在系统蓝牙中配对打印机，再返回选择')
  let lastAddress = ''
  try { lastAddress = String(ui.getStorageSync(BOUND_KEY)?.address || '').toUpperCase() } catch (_) {}
  devices.sort((a, b) => Number(b.address === lastAddress) - Number(a.address === lastAddress))
  // Always let the operator select, including one device: a paired scale is not
  // automatically a printer, and a stale remembered printer must remain replaceable.
  const index = await new Promise(resolve => ui.showActionSheet({
    title: '选择打印机（系统已配对）',
    itemList: devices.map(device => `${device.address === lastAddress ? '上次 · ' : ''}${device.name} (${device.address})`),
    success: result => resolve(result.tapIndex),
    fail: () => resolve(-1)
  }))
  if (!valid() || !Number.isInteger(index) || !devices[index]) return null
  return devices[index]
}

export function rememberPrinter(ui, device) {
  // Called only after the selected device connects, not when the picker is opened.
  try { ui.setStorageSync(BOUND_KEY, { name: device.name, address: device.address }) } catch (_) {}
}
