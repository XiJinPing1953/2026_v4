const text = v => String(v ?? '').replace(/[\r\n\t]/g, ' ').trim()
const finite = v => v !== null && v !== '' && Number.isFinite(Number(v))
export function salePrintPages(sale) {
  if (!sale?._id || sale.biz_mode !== 'bottle' || sale.price_unit !== 'kg' || sale.settlement_mode === 'customer_flow' || !finite(sale.unit_price) || !finite(sale.should_receive)) throw new Error('这张历史单的公斤计价资料不完整，暂不能打印')
  const outs = sale.out_items || [], backs = sale.back_items || []
  if (![...outs,...backs].every(r => text(r.bottle_no || r.bottleNo) && finite(r.net))) throw new Error('瓶号或重量资料不完整，暂不能打印')
  const width = s => [...s].reduce((n,c) => n + (c.charCodeAt(0)>127?24:12),0)
  const wrap = s => {
    const result=[]; let line=''
    // Keep ordinary bottle numbers and decimal weights together across line breaks.
    for (const token of s.match(/[A-Za-z0-9_.-]+|[^A-Za-z0-9_.-]/gu) || []) {
      const parts = width(token) > 592 ? [...token] : [token]
      for (const part of parts) { if (line && width(line+part)>592) { result.push(line); line='' } line+=part }
    }
    if(line)result.push(line); return result
  }
  const lines=[]
  const add=s=>lines.push(...wrap(s))
  add(`客户: ${text(sale.delivery_customer_name || sale.customer_name)}`)
  add(`日期: ${text(sale.date)}  单价: ${Number(sale.unit_price)} 元/kg`)
  add(`车辆: ${text(sale.car_no)||'未记录'} 配送员: ${text(sale.delivery_man)||'未记录'}`)
  for (const [title,rows] of [['出瓶',outs],['回瓶',backs]]) {
    add(`${title} (${rows.length}瓶): ${rows.map(r=>`${text(r.bottle_no||r.bottleNo)}号 ${Number(r.net)}kg`).join('、') || '无'}`)
  }
  const sum=rows=>rows.reduce((n,r)=>n+Number(r.net),0)
  const net=Math.round((sum(outs)-sum(backs))*100)/100
  if (finite(sale.total_net_weight) && Math.abs(net-Number(sale.total_net_weight))>0.011) throw new Error('原单重量口径不一致，请核查后打印')
  if (Math.abs(Math.round(net * Number(sale.unit_price) * 100) / 100 - Number(sale.should_receive)) > 0.011) throw new Error('原单金额口径不一致，请核查后打印')
  add(`(${outs.map(r=>Number(r.net)).join('+')||'0'}-(${backs.map(r=>Number(r.net)).join('+')||'0'})) × ${Number(sale.unit_price)} = ${Number(sale.should_receive).toFixed(2)} 元`)
  add(`总公斤数: ${net} kg  总金额: ${Number(sale.should_receive).toFixed(2)} 元`)
  if(Number(sale.rounding_amount)) add(`抹零: ${Number(sale.rounding_amount).toFixed(2)} 元；实应收: ${Number(sale.effective_should_receive).toFixed(2)} 元`)
  const deposit=Array.isArray(sale.deposit_rows)?`存瓶: ${sale.deposit_rows.map(r=>text(r.bottle_no||r.bottleNo)).filter(Boolean).join('、')||'无'}`:'存瓶: 原单未记录'
  const deposits=wrap(deposit)
  const contentCount=lines.length
  const pages=[]
  // Ten 28-dot rows plus header and footer within logical 640×400 dots.
  while(lines.length) pages.push(lines.splice(0,10))
  if(!pages.length)pages.push([])
  for(const line of deposits){ if(pages[pages.length - 1].length>=10)pages.push([]);pages[pages.length - 1].push(line) }
  return pages.map((rows,index)=>({ rows, page:index+1, total:pages.length, id:sale._id, depositStart:Math.max(0,contentCount-index*10) }))
}
export function writeSalePage(plugin,page) {
  if(typeof plugin.setTextRotation!=='function')throw new Error('安装包缺少横向打印接口')
  plugin.clear();plugin.setSize(50,80);plugin.setCls();plugin.setDirection(0);plugin.setReference(0,0)
  // Rotate logical landscape coordinates clockwise into physical portrait stock.
  const put=(x,y,s)=>plugin.setTextRotation(400-y,x,'TSS24.BF2',90,1,1,s)
  put(24,16,'新拓能源 销售单')
  page.rows.forEach((s,i)=>{
    const row = page.page === page.total && i >= page.depositStart ? 10 - page.rows.length + i : i
    put(24,56+row*28,s)
  })
  put(24,360,`第 ${page.page}/${page.total} 页`)
  plugin.setPagePrint();return plugin.startPrint()
}
