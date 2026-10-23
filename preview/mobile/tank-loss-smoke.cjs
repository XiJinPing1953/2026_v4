// Run with Playwright CLI against isolated MOBILE_PREVIEW only.
async (page) => {
  const origin = new URL(page.url()).origin
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) ||
      !await page.evaluate(() => window.__crmMobilePreview === true)) throw Error('Local MOBILE_PREVIEW only')
  const errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const check = (value, message) => { if (!value) throw Error(message) }
  const loss = page.locator('.brief__loss')
  const go = async fixture => {
    await page.goto(`${origin}/${fixture ? `?fixture=${fixture}` : ''}#/pages/index/index`)
    await loss.waitFor()
  }
  const waitLoss = async text => page.waitForFunction(expected =>
    document.querySelector('.brief__loss')?.textContent.includes(expected), text)
  try {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await go('')
    await waitLoss('29.028 kg')
    await page.locator('.brief__outflow').screenshot({ path: 'output/playwright/tank-loss-desktop.png' })
    await loss.press('Enter')
    await page.locator('.brief__loss-detail').waitFor()
    check((await page.locator('.brief__loss-detail').innerText()).includes('12,000 kg'), 'Opening evidence missing')
    check((await page.locator('.brief__loss-detail').innerText()).includes('8,500 kg'), 'Closing evidence missing')
    const widths = [1440, 768, 390, 320]
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1100 })
      const b = await page.locator('.brief__outflow').boundingBox()
      check(b.x >= -1 && b.x + b.width <= width + 1, `Outflow overflow ${width}`)
      check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `Page overflow ${width}`)
      if (width === 390) await page.locator('.brief__outflow').screenshot({ path: 'output/playwright/tank-loss-mobile-evidence.png' })
    }
    const periods = page.locator('.brief__periods')
    await periods.getByRole('button', { name: '今天', exact: true }).click()
    await waitLoss('14.514 kg')
    await periods.getByRole('button', { name: '本月', exact: true }).press('Space')
    await waitLoss('551.532 kg')
    await page.setViewportSize({ width: 390, height: 1000 })
    await go('tank-gain')
    await waitLoss('估算盈余')
    check((await loss.innerText()).includes('15.125 kg') && !(await loss.innerText()).includes('-15'), 'Surplus presentation wrong')
    await go('tank-missing')
    await waitLoss('待补数据')
    await page.getByText('缺少期初附近的储罐液位日志', { exact: true }).waitFor()
    check((await page.locator('.brief__amount').first().innerText()) === '¥24,600', 'Missing tank evidence hid business')
    await page.locator('.brief__outflow').screenshot({ path: 'output/playwright/tank-loss-missing.png' })
    await go('tank-error')
    await page.getByText(/本地示例：储罐边界日志读取失败/).waitFor()
    check((await page.locator('.brief__amount').first().innerText()) === '¥24,600', 'Tank read failure hid business')
    await go('empty')
    await waitLoss('0 kg')
    check((await loss.innerText()).includes('估算损耗'), 'True zero treated as missing')
    check(errors.length === 0, errors.join('\n'))
    await go('')
    await waitLoss('29.028 kg')
    return { widths, signedLossAndSurplus: true, exactZero: true, missingDataNotZero: true,
      evidenceExpanded: true, independentFailure: true, periodSwitch: true, pageErrors: errors }
  } finally { page.off('pageerror', onError) }
}
