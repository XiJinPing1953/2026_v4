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
  const businessAmount = brief.locator('.brief__hero .brief__amount')
  const currentBalances = brief.locator('.brief__balances > *')
  const waitBusiness = async amount => {
    await businessAmount.filter({ hasText: new RegExp(`^¥${amount}(?:\\.00)?$`) }).waitFor()
  }
  const openReport = async key => {
    const toggle = brief.locator('.brief__report-toggle')
    if (key) await toggle.press(key)
    else await toggle.click()
  }
  const go = async fixture => {
    await page.goto(`${origin}/${fixture ? `?fixture=${fixture}` : ''}#/pages/index/index`)
    await brief.waitFor()
  }
  try {
    await go('')
    await waitBusiness('24,600')
    await brief.getByRole('button', { name: /^出罐合计.*估算损耗.*明细/ }).waitFor()
    await brief.locator('.brief__gas-summary').getByText('3,590.972 kg', { exact: true }).waitFor()
    check((await brief.locator('.brief__ledger').first().innerText()).includes('业务概况'), 'Business is not above finance')
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
    await waitBusiness('12,300')
    await periods.getByRole('button', { name: '本月', exact: true }).press('Space')
    await waitBusiness('467,400')
    check((await currentBalances.first().innerText()).includes('¥203,600.123'), 'Period changed current funds')
    await periods.getByRole('button', { name: '昨天', exact: true }).click()
    await waitBusiness('24,600')
    await brief.locator('.brief__gas-summary').press('Enter')
    await brief.locator('.brief__loss-detail').getByText('3,590.972 kg', { exact: true }).waitFor()
    const finance = brief.locator('.brief__ledger').filter({ has: page.locator('.brief__hero') })
    await finance.getByRole('button', { name: '明细 →', exact: true }).press('Space')
    await finance.getByText('货款明细', { exact: true }).waitFor()
    for (const label of ['已抵货款', '抹零', '还欠']) await finance.locator('.brief__settlement-grid').getByText(label, { exact: true }).waitFor()
    await brief.getByRole('button', { name: /^待匹配账单 2 笔/ }).waitFor()
    await brief.getByRole('button', { name: '业务明细与导出 展开 +', exact: true }).waitFor()
    await openReport('Space')
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
    await openReport()
    check(await brief.getByRole('button', { name: '导出完整日报', exact: true }).getAttribute('aria-disabled') === 'true', 'Incomplete export enabled')
    await brief.screenshot({ path: 'output/playwright/operating-brief-incomplete.png' })
    await go('cash-destinations-unavailable')
    await brief.locator('.brief__cash-grid').getByText('¥19,800.00', { exact: true }).waitFor()
    await brief.getByRole('button', { name: '收款去向 +', exact: true }).click()
    await brief.getByText(/收款去向待核/).first().waitFor()
    await waitBusiness('24,600')
    await go('current-debt-unavailable')
    await currentBalances.nth(1).getByText('¥12,000.018', { exact: true }).waitFor()
    check((await currentBalances.first().innerText()).includes('待核'), 'Unavailable debt showed a number')
    check(await brief.locator('.brief__rank-row').count() === 0, 'Partial debt displayed a ranking')
    await go('current-funds-unavailable')
    await brief.locator('.brief__rank-row').nth(2).waitFor()
    check((await currentBalances.nth(1).innerText()).includes('待核'), 'Unavailable funds showed a number')
    await go('top3-one')
    await brief.locator('.brief__rank-row').first().waitFor()
    check(await brief.locator('.brief__rank-row').count() === 1, 'One debtor was padded to TOP3')
    await go('empty')
    await waitBusiness('0')
    await brief.locator('.brief__gas-summary .brief__subamount').nth(1).filter({ hasText: /^0 kg$/ }).waitFor()
    await brief.locator('.brief__ranking .brief__empty').filter({ hasText: /暂无.*欠款/ }).waitFor()
    check(await brief.locator('.brief__pending').count() === 0, 'Empty pending work still displays a reminder')
    check((await brief.locator('.brief__amount').allTextContents()).every(value => /^¥0(?:\.00)?$/.test(value)), 'Empty totals are not zero')
    check(errors.length === 0, errors.join('\n'))
    await go('')
    await waitBusiness('24,600')
    return { widths, keyboard: ['Enter', 'Space'], businessFirst: true, periodSwitch: true, currentFundsIndependent: true,
      previousMonthDays: lastMonthDays, exportDownloaded: true, incompleteDisabled: true, independentFinancialDomains: true,
      completeDebtRankingOnly: true, shortRankingUnpadded: true, emptyZero: true, pageErrors: errors }
  } finally {
    page.off('pageerror', onError)
  }
}
