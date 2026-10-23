// Playwright CLI run-code --filename=preview/mobile/operating-brief-smoke.cjs
// Uses only the isolated MOBILE_PREVIEW fixtures; does not verify live amounts.
async (page) => {
  const origin = new URL(page.url()).origin
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) ||
      !await page.evaluate(() => window.__crmMobilePreview === true)) throw Error('Local MOBILE_PREVIEW only')
  const errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const check = (value, message) => { if (!value) throw Error(message) }
  const brief = page.locator('.brief')
  const go = async fixture => {
    await page.goto(`${origin}/${fixture ? `?fixture=${fixture}` : ''}#/pages/index/index`)
    await brief.waitFor()
  }
  try {
    await go('')
    await brief.getByRole('button', { name: '3,470.972 kg', exact: true }).waitFor()
    const widths = []
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      const bounds = await brief.boundingBox()
      check(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `Brief overflow at ${width}`)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
      check(!overflow, `Page overflow at ${width}`)
      widths.push(width)
      if (width === 1440 || width === 390) await brief.screenshot({ path: `output/playwright/operating-brief-${width}.png` })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const periods = brief.locator('.brief__periods')
    await periods.getByRole('button', { name: '今天', exact: true }).press('Enter')
    await brief.getByRole('button', { name: /已确认业务额 ¥12,300/ }).waitFor()
    await periods.getByRole('button', { name: '本月', exact: true }).press('Space')
    await brief.getByRole('button', { name: /已确认业务额 ¥467,400/ }).waitFor()
    check(await brief.getByRole('button', { name: /客户欠款合计 ¥203,600.123/ }).count() === 1, 'Period changed current funds')
    await periods.getByRole('button', { name: '昨天', exact: true }).click()
    await brief.getByRole('button', { name: '3,470.972 kg', exact: true }).press('Enter')
    await brief.getByText('已登记出罐量构成', { exact: true }).waitFor()
    await brief.getByRole('button', { name: '业务日报明细与导出 展开 +', exact: true }).press('Space')
    await brief.getByText(/5 天完整数据/).waitFor()
    await brief.locator('.brief__report-periods').getByRole('button', { name: '上月', exact: true }).click()
    const today = new Date(Date.now() + 8 * 3600000)
    const lastMonthDays = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate()
    await brief.getByText(new RegExp(`${lastMonthDays} 天完整数据`)).waitFor()
    check(await brief.locator('.brief__table-row').count() === lastMonthDays + 1, 'Incomplete previous-month rows')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      brief.getByRole('button', { name: '导出完整日报', exact: true }).click()
    ])
    await download.saveAs('output/playwright/operating-brief-report.xls')
    await go('brief-incomplete')
    await brief.getByText(/本地示例：账务来源待核/).first().waitFor()
    check(await brief.locator('.brief__amount').allTextContents().then(values => values.every(value => value === '—')), 'Incomplete data displayed as zero')
    await brief.getByRole('button', { name: '业务日报明细与导出 展开 +', exact: true }).click()
    check(await brief.getByRole('button', { name: '导出完整日报', exact: true }).getAttribute('aria-disabled') === 'true', 'Incomplete export enabled')
    await brief.screenshot({ path: 'output/playwright/operating-brief-incomplete.png' })
    await go('empty')
    await brief.getByRole('button', { name: '0 kg', exact: true }).waitFor()
    await brief.getByText('暂无结账收款待分配；正常预收款不计入提醒。', { exact: true }).waitFor()
    check((await brief.locator('.brief__amount').allTextContents()).every(value => value === '¥0'), 'Empty totals are not zero')
    check(errors.length === 0, errors.join('\n'))
    await go('')
    await brief.getByRole('button', { name: '3,470.972 kg', exact: true }).waitFor()
    return { widths, keyboard: ['Enter', 'Space'], periodSwitch: true, currentFundsIndependent: true,
      previousMonthDays: lastMonthDays, exportDownloaded: true, incompleteDisabled: true, emptyZero: true, pageErrors: errors }
  } finally {
    page.off('pageerror', onError)
  }
}
