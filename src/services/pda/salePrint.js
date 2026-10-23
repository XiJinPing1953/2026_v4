const text = value => String(value ?? '').replace(/[\r\n\t]/g, ' ').trim()
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value))
const width = value => [...value].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 24 : 12), 0)
const LEFT = 16, RIGHT = 464, TOP = 44, LAST_Y = 280, LINE = 28
function wrap(value, limit = RIGHT - LEFT) {
  const result = []; let line = ''
  for (const token of value.match(/[A-Za-z0-9_.-]+|[^A-Za-z0-9_.-]/gu) || []) {
    const parts = width(token) > limit ? [...token] : [token]
    for (const part of parts) {
      if (line && width(line + part) > limit) { result.push(line); line = '' }
      line += part
    }
  }
  if (line) result.push(line)
  return result
}
export function salePrintPages(sale) {
  if (!sale?._id || sale.biz_mode !== 'bottle' || sale.price_unit !== 'kg' || sale.settlement_mode === 'customer_flow' || !finite(sale.unit_price) || !finite(sale.should_receive)) throw new Error('这张历史单的公斤计价资料不完整，暂不能打印')
  const outs = sale.out_items || [], backs = sale.back_items || []
  if (![...outs, ...backs].every(row => text(row.bottle_no || row.bottleNo) && finite(row.net))) throw new Error('瓶号或重量资料不完整，暂不能打印')
  const sum = rows => rows.reduce((n, row) => n + Number(row.net), 0)
  const net = Math.round((sum(outs) - sum(backs)) * 100) / 100
  if (finite(sale.total_net_weight) && Math.abs(net - Number(sale.total_net_weight)) > 0.011) throw new Error('原单重量口径不一致，请核查后打印')
  if (Math.abs(Math.round(net * Number(sale.unit_price) * 100) / 100 - Number(sale.should_receive)) > 0.011) throw new Error('原单金额口径不一致，请核查后打印')
  const pages = [], customer = wrap(`客户: ${text(sale.delivery_customer_name || sale.customer_name)}`)
  if (customer.length > 4) throw new Error('客户名称过长，暂不能按当前标签打印')
  let current, y
  function put(x, value, at = y) { current.commands.push({ x, y: at, text: value }); current.rows.push(value) }
  function page(section) {
    current = { section, commands: [], rows: [], id: sale._id }; pages.push(current); y = TOP
    for (const line of customer) { put(LEFT, line); y += LINE }
  }
  // Continuations repeat the customer. Metadata and settlement flow into the
  // remaining space rather than unconditionally allocating summary sheets.
  function lines(value, section = current.section) {
    for (const line of wrap(value)) {
      if (y > LAST_Y) page(section)
      put(LEFT, line); y += LINE
    }
  }
  function header() {
    put(LEFT, '瓶号'); put(176, '皮重'); put(272, '毛重'); put(368, '净重'); y += LINE
  }
  for (const [direction, items] of [['出瓶', outs], ['回瓶', backs]]) {
    if (!items.length) continue
    const section = `${direction}${items.length}瓶 kg`
    const first = pages.length === 0
    page(section)
    if (first) {
      lines(`日期:${text(sale.date)} 车:${text(sale.car_no) || '未记录'}`)
      lines(`配送员: ${text(sale.delivery_man) || '未记录'}`)
    }
    let needsHeader = true
    for (const item of items) {
      const number = wrap(text(item.bottle_no || item.bottleNo), 144)
      // Only the saved sale supplies weights. Historical missing values remain explicit.
      const columns = ['tare', 'gross', 'net'].map(key => wrap(finite(item[key]) ? Number(item[key]).toFixed(1) : '未记录', 96))
      const height = Math.max(number.length, ...columns.map(column => column.length)) * LINE
      if (y + (needsHeader ? LINE : 0) + height - LINE > LAST_Y) { page(section); needsHeader = true }
      if (y + (needsHeader ? LINE : 0) + height - LINE > LAST_Y) throw new Error('单个瓶号或重量过长，暂不能按当前标签打印')
      if (needsHeader) { header(); needsHeader = false }
      number.forEach((line, i) => put(LEFT, line, y + i * LINE))
      columns.forEach((column, j) => column.forEach((line, i) => put([256, 352, 464][j] - width(line), line, y + i * LINE)))
      y += height
    }
    if (direction === '出瓶' && backs.length) lines(`出瓶 ${outs.length}瓶  合计 ${Number(sum(outs).toFixed(2))} kg`)
  }
  if (!current) page('结算 kg')
  const amount = Number(sale.should_receive).toFixed(2)
  lines(`计费 ${net}kg 单价 ${Number(sale.unit_price)}元/kg`, '结算 kg')
  lines(`(${Number(sum(outs).toFixed(2))}-${Number(sum(backs).toFixed(2))})×${Number(sale.unit_price)}=${amount}元`, '结算 kg')
  if (Number(sale.rounding_amount)) {
    lines(`抹零: ${Number(sale.rounding_amount).toFixed(2)} 元`, '结算 kg')
    lines(`实应收: ${Number(sale.effective_should_receive).toFixed(2)} 元`, '结算 kg')
  }
  const deposits = wrap(Array.isArray(sale.deposit_rows) ? `存瓶: ${sale.deposit_rows.map(row => text(row.bottle_no || row.bottleNo)).filter(Boolean).join('、') || '无'}` : '存瓶: 原单未记录')
  // Keep the final deposit block bottom-left, including wrapped continuations.
  for (let i = 0; i < deposits.length;) {
    if (y > LAST_Y) page('存瓶 kg')
    const count = Math.min(Math.floor((LAST_Y - y) / LINE) + 1, deposits.length - i)
    const start = TOP + Math.floor((LAST_Y - TOP) / LINE) * LINE - (count - 1) * LINE
    for (let n = 0; n < count; n++) put(LEFT, deposits[i++], start + n * LINE)
    y = LAST_Y + LINE
  }
  return pages.map((p, i) => ({ ...p, page: i + 1, total: pages.length }))
}
export function writeSalePage(plugin, page) {
  plugin.clear(); plugin.setSize(60, 40); plugin.setCls(); plugin.setDirection(0); plugin.setReference(0, 0)
  plugin.setText(LEFT, 16, 'TSS24.BF2', 1, 1, `新拓能源 ${page.section}`)
  const footer = `${page.page}/${page.total}`
  plugin.setText(RIGHT - width(footer), 16, 'TSS24.BF2', 1, 1, footer)
  for (const row of page.commands) plugin.setText(row.x, row.y, 'TSS24.BF2', 1, 1, row.text)
  plugin.setPagePrint(); return plugin.startPrint()
}
