// Playwright CLI: run-code --filename preview/mobile/account-defaults-smoke.cjs
// Requires the isolated MOBILE_PREVIEW localhost server. All accounts/data are simulated.
async (page) => {
  const origin = new URL(page.url()).origin
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error('Local preview only')
  if (!await page.evaluate(() => window.__crmMobilePreview === true)) throw Error('Enable MOBILE_PREVIEW before running this test')
  const defaults = { delivery1: '张侨冰', delivery2: '王红权', vehicle_no: '冀A38U7G' }
  const authPattern = '**/src/services/auth.js*'
  const injectDefaults = async route => {
    const response = await route.fetch()
    const source = await response.text()
    if (!source.includes("_id:'preview-user'")) throw Error('Refusing to modify non-preview auth module')
    await route.fulfill({ response, body: source.replace(/const user\s*=\s*\{/, `const user={mobile_sale_defaults:${JSON.stringify(defaults)},`) })
  }
  await page.route(authPattern, injectDefaults)
  const runId = String(Date.now())
  await page.evaluate(() => localStorage.clear())
  const errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const button = text => page.locator('uni-button').filter({ hasText: text })
  const customerInput = () => page.locator('.customer-search-field input')
  const deliveryInput = index => page.locator('.capture-field').filter({ has: page.getByText(`配送员 ${index + 1}`, { exact: true }) }).locator('input')
  const vehicleInput = () => page.locator('.capture-field').filter({ has: page.getByText('车牌号', { exact: true }) }).locator('input')
  const readDraft = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.includes('crm_mobile_sale_draft_v1:preview-user'))
    let value = key ? localStorage.getItem(key) : null
    for (let i = 0; i < 4 && value; i++) {
      if (typeof value === 'string') value = JSON.parse(value)
      else if (value.form) return value
      else value = value.data
    }
    if (value?.form) return value
    throw Error('No saved preview draft found')
  })
  const assertCustomer = async (id, name, price) => {
    const { form } = await readDraft()
    if (form.customerId !== id || form.customerName !== name || form.unitPrice !== price) {
      throw Error(`Customer selection mismatch: ${JSON.stringify({ id: form.customerId, name: form.customerName, price: form.unitPrice })}`)
    }
  }
  const assertDefaults = async (delivery1, delivery2, vehicle) => {
    await page.waitForFunction(expected => {
      const fields = [...document.querySelectorAll('.capture-field')]
      const values = ['配送员 1', '配送员 2', '车牌号'].map(label => fields.find(field => field.textContent.includes(label))?.querySelector('input')?.value)
      return JSON.stringify(values) === JSON.stringify(expected)
    }, [delivery1, delivery2, vehicle])
    const values = await Promise.all([deliveryInput(0).inputValue(), deliveryInput(1).inputValue(), vehicleInput().inputValue()])
    if (JSON.stringify(values) !== JSON.stringify([delivery1, delivery2, vehicle])) throw Error(`Defaults mismatch: ${values}`)
  }
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${origin}/?fixture=phone-sale&defaultsSmoke=${runId}#/pages/pda/sale-create`)
    await customerInput().waitFor()
    await assertDefaults(defaults.delivery1, defaults.delivery2, defaults.vehicle_no)
    await customerInput().fill('手机')
    await page.getByText('手机称重模拟客户二', { exact: true }).waitFor()
    if (await page.locator('.suggest-item').count() !== 2) throw Error('Expected two customer choices')
    await page.screenshot({ path: 'output/playwright/mobile-account-customer-options.png', fullPage: true })
    await page.getByText('手机称重模拟客户二', { exact: true }).click()
    await page.getByText('默认单价 9.5 / kg', { exact: true }).waitFor()
    await assertCustomer('phone-demo-customer-2', '手机称重模拟客户二', '9.5')
    await page.screenshot({ path: 'output/playwright/mobile-account-defaults-selected.png', fullPage: true })
    await customerInput().fill('未登记')
    await assertCustomer('', '', '')
    if (await page.locator('.selected-customer').count()) throw Error('Changed keyword retained selected customer')
    await customerInput().fill('手机')
    await page.getByText('手机称重模拟客户', { exact: true }).click()
    await assertCustomer('phone-demo-customer', '手机称重模拟客户', '8')
    await button('清空').click()
    await assertCustomer('', '', '')
    await page.waitForFunction(() => document.querySelector('.customer-search-field input')?.value === '')
    await customerInput().fill('手机')
    await page.getByText('手机称重模拟客户二', { exact: true }).click()
    await deliveryInput(0).fill('临时配送员')
    await deliveryInput(1).fill('')
    await vehicleInput().fill('测B67890')
    await customerInput().click()
    await page.reload()
    await button('恢复草稿').click()
    await assertDefaults('临时配送员', '', '测B67890')
    await assertCustomer('phone-demo-customer-2', '手机称重模拟客户二', '9.5')
    await page.screenshot({ path: 'output/playwright/mobile-account-draft-restored.png', fullPage: true })
    if (errors.length) throw Error(errors.join('\n'))
    return { customerChoices: 2, clickedIdAndPrice: true, changedKeywordClearsId: true, explicitClear: true, defaultsEditable: true, editedDraftRestored: true, realAccount: false, cloudWrites: false }
  } finally {
    page.off('pageerror', onError)
    await page.unroute(authPattern, injectDefaults)
  }
}
