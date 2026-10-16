// Use with Playwright CLI run-code --filename, only on SAFETY_PREVIEW.
async (page) => {
  const origin=new URL(page.url()).origin
  if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)||!await page.evaluate(()=>window.__crmSafetyPreview===true))throw Error('Safety isolated preview required')
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const results=[]
  const inspect=async(name,width=390)=>{await page.setViewportSize({width,height:844});await page.screenshot({path:`output/playwright/safety-${name}-${width}.png`,fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);if(overflow)throw Error(`${name} ${width}px horizontal overflow`);results.push({page:name,width,overflow})}
  await page.locator('.sm-calendar').waitFor();if(await page.locator('.sm-card').first().evaluate(el=>getComputedStyle(el).padding==='0px'))throw Error('Shared safety styles not applied');await inspect('home');await inspect('home',1280)
  await page.goto(`${origin}/#/pages/safety-management/daily?date=2026-10-15`)
  await page.getByText('S01 · 特殊作业',{exact:true}).waitFor()
  await inspect('daily-empty')
  const codes=['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12','S14']
  for(const code of codes){const card=page.locator('.sm-card').filter({has:page.locator('.sm-h2').filter({hasText:new RegExp(`^${code} ·`)})});const skip=['S01','S04','S06','S09','S13a','S13b','S13c'].includes(code),na=['S12','S14'].includes(code);await card.locator('.sm-option').filter({hasText:skip?'当日未开展':na?'不适用':'已检查正常'}).click();if(skip||na)await card.locator('textarea').first().fill('本地示例：当日无相关作业或适用设施。')}
  const unloading=page.locator('.sm-card').filter({has:page.getByText('S13 · 当日卸车、装卸作业',{exact:true})});await unloading.getByText('当日未开展',{exact:true}).click();await unloading.locator('textarea').fill('本地示例：当日未开展装卸。')
  await page.locator('uni-button').filter({hasText:'暂存补充检查'}).click()
  await page.getByText('补充已暂存',{exact:true}).waitFor()
  await page.getByText('核对日表',{exact:true}).click()
  await page.getByText('当前检查与补充内容齐全，可核对形成日表。',{exact:true}).waitFor()
  await page.getByText('实际未发现问题，确认零报告',{exact:true}).click()
  await page.locator('uni-button').filter({hasText:'核对日表内容'}).click()
  await page.getByText(/已有核对版本 1/).waitFor();await inspect('daily-checked')
  await page.locator('uni-button').filter({hasText:'打印预览 / 保存 PDF'}).click()
  await page.locator('.sm-print h1').waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.sm-print img')).length===2&&Array.from(document.querySelectorAll('.sm-print img')).every(img=>img.complete&&img.naturalWidth));await inspect('print',1280)
  await page.emulateMedia({media:'print'});await page.pdf({path:'output/playwright/safety-daily.pdf',format:'A4',printBackground:true});await page.emulateMedia({media:'screen'})
  for(const route of ['weekly','monthly','settings']){await page.goto(`${origin}/#/pages/safety-management/${route}?date=2026-10-15&month=2026-10`);await page.locator('.sm-card').first().waitFor();await page.locator('.sm-state').waitFor({state:'hidden'});await inspect(route);await inspect(route,1280)}
  if(errors.length)throw Error(JSON.stringify(errors))
  console.log(JSON.stringify({results,errors,notice:'Mock API in memory only; cloud service and XLSX validated separately.'}))
}
