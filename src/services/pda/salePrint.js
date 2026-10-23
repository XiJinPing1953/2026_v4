const text = v => String(v ?? '').replace(/[\r\n\t]/g, ' ').trim()
const finite = v => v !== null && v !== '' && Number.isFinite(Number(v))
const width = s => [...s].reduce((n,c) => n + (c.charCodeAt(0)>127?24:12),0)
function wrap(s, limit = 456) {
  const result=[]; let line=''
  for (const token of s.match(/[A-Za-z0-9_.-]+|[^A-Za-z0-9_.-]/gu) || []) {
    const parts=width(token)>limit?[...token]:[token]
    for(const part of parts){if(line && width(line+part)>limit){result.push(line);line=''}line+=part}
  }
  if(line)result.push(line)
  return result
}
export function salePrintPages(sale) {
  if (!sale?._id || sale.biz_mode !== 'bottle' || sale.price_unit !== 'kg' || sale.settlement_mode === 'customer_flow' || !finite(sale.unit_price) || !finite(sale.should_receive)) throw new Error('这张历史单的公斤计价资料不完整，暂不能打印')
  const outs=sale.out_items||[],backs=sale.back_items||[]
  if (![...outs,...backs].every(r=>text(r.bottle_no||r.bottleNo)&&finite(r.net))) throw new Error('瓶号或重量资料不完整，暂不能打印')
  const sum=rows=>rows.reduce((n,r)=>n+Number(r.net),0),net=Math.round((sum(outs)-sum(backs))*100)/100
  if(finite(sale.total_net_weight)&&Math.abs(net-Number(sale.total_net_weight))>0.011)throw new Error('原单重量口径不一致，请核查后打印')
  if(Math.abs(Math.round(net*Number(sale.unit_price)*100)/100-Number(sale.should_receive))>0.011)throw new Error('原单金额口径不一致，请核查后打印')
  const pages=[]
  const customer=wrap(`客户: ${text(sale.delivery_customer_name||sale.customer_name)}`)
  function page(section){const p={section,commands:[],rows:[],id:sale._id};pages.push(p);return p}
  function put(p,x,y,s){p.commands.push({x,y,text:s});p.rows.push(s)}
  // Each detail sheet repeats customer and column names. Long customer names
  // occupy additional lines and reduce capacity rather than being truncated.
  function detail(section){
    const p=page(section);let y=40
    for(const s of customer){if(y>152)throw new Error('客户名称过长，暂不能按当前标签打印');put(p,12,y,s);y+=28}
    put(p,12,y,`${section.slice(0,2)}瓶号`);put(p,180,y,'皮重');put(p,276,y,'毛重');put(p,384,y,'净重');return {p,y:y+32}
  }
  let sheet=null
  for(const [section,items] of [['出瓶',outs],['回瓶',backs]]){
    if(!items.length)continue
    if(!sheet || sheet.y+60>276) sheet=detail(`${section} ${items.length}瓶`)
    else {
      sheet.p.section='称重明细'
      put(sheet.p,12,sheet.y,`${section}瓶号`);put(sheet.p,180,sheet.y,'皮重');put(sheet.p,276,sheet.y,'毛重');put(sheet.p,384,sheet.y,'净重');sheet.y+=32
    }
    for(const item of items){
      const numberLines=wrap(text(item.bottle_no||item.bottleNo),144)
      // Missing historical tare/gross remains visibly unknown; never use today's archive.
      const values=['tare','gross','net'].map(k=>finite(item[k])?Number(item[k]).toFixed(1):'未记录')
      const columns=values.map(v=>wrap(v,96)),height=Math.max(numberLines.length,...columns.map(c=>c.length))*28
      if(sheet.y+height>276)sheet=detail(`${section} ${items.length}瓶`)
      if(sheet.y+height>276)throw new Error('单个瓶号或重量过长，暂不能按当前标签打印')
      numberLines.forEach((s,i)=>put(sheet.p,12,sheet.y+i*28,s))
      columns.forEach((lines,j)=>lines.forEach((s,i)=>put(sheet.p,[168,264,372][j]+96-width(s),sheet.y+i*28,s)))
      sheet.y+=height
    }
  }
  const summary=[...customer,`日期: ${text(sale.date)}`,`车辆: ${text(sale.car_no)||'未记录'}`,`配送员: ${text(sale.delivery_man)||'未记录'}`,`出瓶 ${outs.length}瓶  回瓶 ${backs.length}瓶`,`单价: ${Number(sale.unit_price)} 元/kg`,
    `出瓶合计 ${sum(outs)} kg`,`回瓶合计 ${sum(backs)} kg`,`总公斤数: ${net} kg`,
    `(${outs.map(r=>Number(r.net)).join('+')||'0'}-(${backs.map(r=>Number(r.net)).join('+')||'0'})) × ${Number(sale.unit_price)} = ${Number(sale.should_receive).toFixed(2)} 元`,
    `总金额: ${Number(sale.should_receive).toFixed(2)} 元`]
  if(Number(sale.rounding_amount))summary.push(`抹零: ${Number(sale.rounding_amount).toFixed(2)} 元`,`实应收: ${Number(sale.effective_should_receive).toFixed(2)} 元`)
  let p=page('结算汇总'),y=40
  for(const line of summary.flatMap(s=>wrap(s))){if(y+24>276){p=page('结算汇总');y=40}put(p,12,y,line);y+=28}
  const deposits=wrap(Array.isArray(sale.deposit_rows)?`存瓶: ${sale.deposit_rows.map(r=>text(r.bottle_no||r.bottleNo)).filter(Boolean).join('、')||'无'}`:'存瓶: 原单未记录')
  // Deposit block remains at the bottom left of its final sheet.
  for(let i=0;i<deposits.length;){const available=Math.floor((276-y)/28);if(!available){p=page('存瓶');y=40;continue}const count=Math.min(available,deposits.length-i),start=276-count*28;for(let n=0;n<count;n++)put(p,12,start+n*28,deposits[i++]);y=276}
  return pages.map((p,i)=>({...p,page:i+1,total:pages.length}))
}
export function writeSalePage(plugin,page) {
  plugin.clear();plugin.setSize(60,40);plugin.setCls();plugin.setDirection(0);plugin.setReference(0,0)
  plugin.setText(12,8,'TSS24.BF2',1,1,`新拓能源 ${page.section}`)
  for(const row of page.commands)plugin.setText(row.x,row.y,'TSS24.BF2',1,1,row.text)
  plugin.setText(12,288,'TSS24.BF2',1,1,`重量单位: kg`)
  const footer=`${page.page}/${page.total}`
  plugin.setText(468-width(footer),288,'TSS24.BF2',1,1,footer)
  plugin.setPagePrint();return plugin.startPrint()
}
