import { buildDepositPreviewRows } from './shared'

const text = value => String(value ?? '').replace(/[\r\n\t]/g, ' ').trim()
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value))
const width = value => [...value].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 24 : 12), 0)
// 80 mm continuous stock; keep commands inside a 576-dot (72 mm) print head.
// Long receipts use bounded buffers; 50 mm is the roll diameter, not a page height.
const LEFT = 16, RIGHT = 560, TOP = 52, LINE = 28, FONT_HEIGHT = 24
const MAX_HEIGHT_MM = 200, LAST_Y = MAX_HEIGHT_MM * 8 - 16 - FONT_HEIGHT
const COLUMN_ENDS = [160, 292, 424, 560]

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
  const outNet = Number(sum(outs).toFixed(2)), backNet = Number(sum(backs).toFixed(2))
  const net = Math.round((sum(outs) - sum(backs)) * 100) / 100
  if (finite(sale.total_net_weight) && Math.abs(net - Number(sale.total_net_weight)) > 0.011) throw new Error('原单重量口径不一致，请核查后打印')
  if (Math.abs(Math.round(net * Number(sale.unit_price) * 100) / 100 - Number(sale.should_receive)) > 0.011) throw new Error('原单金额口径不一致，请核查后打印')
  if (Number(sale.rounding_amount) && (!finite(sale.rounding_amount) || !finite(sale.effective_should_receive))) throw new Error('原单抹零资料不完整，请核查后打印')

  const pages = [], customer = wrap('客户: ' + text(sale.delivery_customer_name || sale.customer_name))
  if (customer.length > 4) throw new Error('客户名称过长，暂不能打印')
  let current, y
  function put(x, value, at = y) { current.commands.push({ x, y: at, text: value }); current.rows.push(value) }
  function page(section) {
    current = { section, commands: [], bars: [], rows: [], id: sale._id }; pages.push(current); y = TOP
    for (const line of customer) { put(LEFT, line); y += LINE }
  }
  function lines(value, section = current.section) {
    for (const line of wrap(value)) {
      if (y > LAST_Y) page(section)
      put(LEFT, line); y += LINE
    }
  }
  function separator() {
    current.bars.push({ x: LEFT, y: y + 2, width: RIGHT - LEFT, height: 1 })
    y += 16
  }
  function header(section) {
    put(LEFT, section); y += LINE
    put(LEFT, '瓶号')
    ;['皮重', '毛重', '净重'].forEach((label, i) => put(COLUMN_ENDS[i + 1] - width(label), label))
    y += LINE
  }

  page('销售单')
  lines('日期:' + text(sale.date) + '  车:' + (text(sale.car_no) || '未记录'))
  lines('配送员: ' + (text(sale.delivery_man) || '未记录'))
  for (const [direction, items, total] of [['出瓶', outs, outNet], ['回瓶', backs, backNet]]) {
    if (!items.length) continue
    const section = direction + ' ' + items.length + '瓶  单位:kg'
    let needsHeader = true
    for (const item of items) {
      const number = wrap(text(item.bottle_no || item.bottleNo), 144)
      // Original saved weights only. Never substitute today's bottle profile.
      const columns = ['tare', 'gross', 'net'].map(key => wrap(finite(item[key]) ? Number(item[key]).toFixed(1) : '未记录', 120))
      const height = Math.max(number.length, ...columns.map(column => column.length)) * LINE
      if (y + (needsHeader ? 16 + 2 * LINE : 0) + height - LINE > LAST_Y) {
        page(section); needsHeader = true
      }
      if (y + (needsHeader ? 16 + 2 * LINE : 0) + height - LINE > LAST_Y) throw new Error('单个瓶号或重量过长，暂不能打印')
      if (needsHeader) { separator(); header(section); needsHeader = false }
      number.forEach((line, i) => put(LEFT, line, y + i * LINE))
      columns.forEach((column, j) => column.forEach((line, i) => put(COLUMN_ENDS[j + 1] - width(line), line, y + i * LINE)))
      y += height
    }
    lines((direction === '出瓶' ? '出瓶净重' : '回瓶余气') + '合计: ' + total + ' kg', section)
  }

  if (y + 16 > LAST_Y) page('结算 kg')
  separator()
  const amount = Number(sale.should_receive).toFixed(2)
  lines('计费: ' + net + 'kg  单价: ' + Number(sale.unit_price) + '元/kg', '结算 kg')
  lines('(' + outNet + '-' + backNet + ')×' + Number(sale.unit_price) + '=' + amount + '元', '结算 kg')
  if (Number(sale.rounding_amount)) {
    lines('抹零: ' + Number(sale.rounding_amount).toFixed(2) + ' 元', '结算 kg')
    lines('实应收: ' + Number(sale.effective_should_receive).toFixed(2) + ' 元', '结算 kg')
  } else {
    lines('应收: ' + amount + ' 元', '结算 kg')
  }

  // The PDA normally saves the post-sale set. Set union/difference is idempotent,
  // so the same rule also repairs a saved pre-sale list without counting outs twice.
  // No current-stock lookup: a reprint must stay tied to the original sale snapshot.
  const deposits = Array.isArray(sale.deposit_rows) ? buildDepositPreviewRows({
    baseBottleNos: sale.deposit_rows, outItems: outs, backItems: backs
  }) : null
  y += 12
  lines(deposits ? '存瓶(' + deposits.length + '瓶): ' + (deposits.map(row => row.bottle_no).join('、') || '无') : '存瓶: 原单未记录，待核对', '存瓶 kg')

  return pages.map((p, i) => ({ ...p, page: i + 1, total: pages.length,
    heightMm: Math.ceil((Math.max(40, ...p.commands.map(row => row.y + FONT_HEIGHT), ...p.bars.map(bar => bar.y + bar.height)) + 16) / 8)
  }))
}

export function writeSalePage(plugin, page) {
  // Validate before buffering anything: silently omitting GAP would seek label gaps.
  for (const method of ['setGap', 'setBackFeed', 'setBar']) {
    if (typeof plugin?.[method] !== 'function') throw new Error('当前安装包缺少连续小票打印接口，请更新安装包')
  }
  plugin.clear(); plugin.setSize(80, page.heightMm); plugin.setGap(0); plugin.setCls()
  plugin.setBackFeed(0); plugin.setDirection(0); plugin.setReference(0, 0)
  const title = '新拓能源 销售单'
  plugin.setText(Math.floor((LEFT + RIGHT - width(title)) / 2), 16, 'TSS24.BF2', 1, 1, title)
  if (page.total > 1) {
    const footer = page.page + '/' + page.total
    plugin.setText(RIGHT - width(footer), 16, 'TSS24.BF2', 1, 1, footer)
  }
  for (const row of page.commands) plugin.setText(row.x, row.y, 'TSS24.BF2', 1, 1, row.text)
  for (const bar of page.bars) plugin.setBar(bar.x, bar.y, bar.width, bar.height)
  plugin.setPagePrint(); return plugin.startPrint()
}
