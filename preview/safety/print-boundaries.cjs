// Run only against the isolated local mock after smoke.cjs.
async (page) => {
 const origin=new URL(page.url()).origin
 if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)||!await page.evaluate(()=>window.__crmSafetyPreview===true))throw Error('Safety isolated preview required')
 await page.reload()
 await page.goto(`${origin}/#/pages/safety-management/print?kind=daily&date=2026-10-15`)
 await page.locator('.sm-print h1').waitFor()
 await page.evaluate(()=>{window.__safetyMissingMedia=true;window.__previewPrints=0;window.print=()=>window.__previewPrints++})
 await page.getByText('刷新已保存材料',{exact:true}).click()
 await page.getByText('2 份证据未取得可用链接，暂不能打印。请刷新材料后重试。',{exact:true}).waitFor()
 await page.locator('uni-button').filter({hasText:'打印 / 保存 PDF'}).click()
 if(await page.evaluate(()=>window.__previewPrints)!==0)throw Error('Printing was permitted with missing evidence')
 await page.locator('.uni-modal').getByText('确定',{exact:true}).click()
 await page.evaluate(async()=>{
  window.__safetyMissingMedia=false
  const callCloud=window.__safetyPreviewCall
  await callCloud('crm-safety-management',{action:'registerIssueV1',data:{date:'2026-10-15',client_submission_id:'print_stress_only',source_type:'supplement',source_item_code:'S02',category_code:'2',issue_note:'LONG-CONTENT-START\n'+Array.from({length:65},(_,i)=>`第${i+1}段：本地版式测试，记录异常部位、处置事实与复查说明，所有文字须跨页完整显示。`).join('\n')+'\nLONG-CONTENT-END',responsible_name:'模拟责任人',planned_measure:'现场隔离后检修（仅示例）',planned_complete_date:'2026-10-16',hazard_level:'general',inspection_photo_file_ids:['cloud://preview/evidence-one.jpg','cloud://preview/evidence-two.jpg']}})
 })
 await page.getByText('刷新已保存材料',{exact:true}).click()
 await page.locator('.sm-print').getByText(/LONG-CONTENT-END/).first().waitFor()
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.sm-print img')).length===2&&Array.from(document.querySelectorAll('.sm-print img')).every(img=>img.complete&&img.naturalWidth))
 await page.emulateMedia({media:'print'})
 await page.pdf({path:'output/playwright/safety-long-content.pdf',format:'A4',printBackground:true})
 await page.emulateMedia({media:'screen'})
 return {missing_evidence_blocks_print:true,long_content_pdf:'output/playwright/safety-long-content.pdf'}
}
