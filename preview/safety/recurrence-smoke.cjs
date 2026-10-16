async (page) => {
 const origin=new URL(page.url()).origin
 if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)||!await page.evaluate(()=>window.__crmSafetyPreview===true))throw Error('Safety isolated preview required')
 await page.reload()
 await page.goto(`${origin}/#/pages/safety-management/daily?date=2026-10-15`)
 const card=page.locator('.sm-card').filter({has:page.getByText('S02 · 设备运行及支撑',{exact:true})})
 await card.getByText('登记问题 / 关联未关闭隐患',{exact:true}).click()
 await card.getByText('关闭后再次发生',{exact:true}).click()
 await card.getByText('查询已关闭隐患',{exact:true}).click()
 await card.getByText('LOCAL-CLOSED-001',{exact:true}).click()
 await card.getByText(/复发来源：LOCAL-CLOSED-001/).waitFor()
 if(!await card.locator('.sm-closed-result--selected').count())throw Error('Closed issue selection not retained')
 await page.setViewportSize({width:390,height:844})
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw Error('Issue editor horizontal overflow')
 await page.screenshot({path:'output/playwright/safety-recurrence-390.png',fullPage:true})
 return {closed_issue_search_and_explicit_selection:true,production_writes:0}
}
