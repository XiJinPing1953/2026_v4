async (page) => {
 const routes=["pages/index/index", "pages/login/login", "pages/safety-inspection/home", "pages/station-safety-inspection/home", "pages/station-safety-inspection/form", "pages/station-safety-inspection/history", "pages/station-safety-inspection/detail", "pages/station-safety-inspection/hazards", "pages/station-safety-inspection/export", "pages/home-safety-inspection/home", "pages/home-safety-inspection/form", "pages/home-safety-inspection/history", "pages/home-safety-inspection/detail", "pages/home-safety-inspection/export", "pages/pda/home", "pages/pda/bottle-query", "pages/pda/movement-query", "pages/pda/customer-query", "pages/pda/filling-board", "pages/pda/filling-station", "pages/pda/filling-create", "pages/pda/filling-complete", "pages/pda/sale-create", "pages/sale/list", "pages/sale/edit", "pages/sale/detail", "pages/customer/list", "pages/customer/edit", "pages/customer/statement", "pages/cashier/receipt-intake", "pages/bottle/anomaly", "pages/bottle/list", "pages/bottle/inspection", "pages/bottle/edit", "pages/bottle/movement", "pages/bottle/timeline", "pages/bottle/loss", "pages/vehicle/list", "pages/vehicle/edit", "pages/rfid/sessions", "pages/delivery/list", "pages/delivery/edit", "pages/filling/list", "pages/filling/edit", "pages/gas-in/list", "pages/gas-in/edit", "pages/accounting/account-list", "pages/accounting/account-edit", "pages/accounting/voucher-list", "pages/accounting/voucher-edit", "pages/accounting/ledger-general", "pages/accounting/ledger-sub", "pages/accounting/trial-balance", "pages/accounting/report-summary", "pages/accounting/period-list", "pages/accounting/receivable-detail", "pages/collection/task-list", "pages/collection/task-detail", "pages/log/list", "pages/user/list"];
 const results=[]; const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.unroute('**/*');
 await page.route('**/*', route => { return /^(http:\/\/(127\.0\.0\.1|localhost)(:|\/)|data:|blob:)/.test(route.request().url())?route.continue():route.abort(); });
 await page.setViewportSize({width:390,height:844});
 for(const route of routes) {
  errors.length=0;
  const query=['pages/home-safety-inspection/history','pages/home-safety-inspection/form'].includes(route)?'?customer_id=demo-kg':route==='pages/pda/filling-complete'?'?task_id=mobile-demo':['pages/pda/filling-station','pages/pda/filling-create'].includes(route)?'?station_code=DEMO-01':route==='pages/customer/list'?'?scene=statement':(route.endsWith('/detail')||route.endsWith('/task-detail')?'?_id=mobile-demo&id=mobile-demo':'');
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:5191/?audit='+encodeURIComponent(route)+'#/'+route+query);
  await page.waitForTimeout(900);
  await page.waitForFunction(() => document.querySelector('uni-page-body')?.innerText.length > 30, null, {timeout:5000}).catch(()=>{});
  for (const width of [390,320,360,430,768,1440]) {
  await page.setViewportSize({width,height:844});
  await page.waitForTimeout(80);
  const result=await page.evaluate(()=>{
   const body=document.querySelector('uni-page-body');
   const elements=[...(body?.querySelectorAll('*')||[])];
   const clipped=elements.filter(el=>{
    const r=el.getBoundingClientRect(); if(!r.width||!r.height||r.right<=innerWidth+1&&r.left>=-1) return false;
    let p=el.parentElement; while(p&&p!==body) {if(['auto','scroll'].includes(getComputedStyle(p).overflowX)) return false;p=p.parentElement;}
    return true;
   }).slice(0,8).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent?.slice(0,45),right:Math.round(el.getBoundingClientRect().right)}));
   return {title:document.title,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:body?.scrollWidth,textLength:body?.innerText.length||0,uncontainedPickers:document.querySelectorAll('.uni-picker-custom:not(.uni-picker-container .uni-picker-custom)').length,overflow:clipped,calls:[...new Set((window.__mobilePreviewCalls||[]).map(c=>c.name+'/'+c.action))]};
  });
  results.push({route,...result,errors:[...errors]});
  if (width===390) await page.screenshot({path:'output/playwright/mobile/'+route.replaceAll('/','-')+'-390.png',fullPage:true});
  }
 }
 return results;
}