// Playwright CLI: run-code --filename preview/mobile/sale-smoke.cjs
// Open the isolated MOBILE_PREVIEW server on localhost first. Hardware/API are simulated.
async (page) => {
  const origin = new URL(page.url()).origin
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error('Local preview only')
  if (!await page.evaluate(() => window.__crmMobilePreview === true)) throw Error('Enable MOBILE_PREVIEW before running this test')
  const runId = String(Date.now())
  await page.addInitScript(({ runId }) => {
    if (sessionStorage.getItem('phone-sale-smoke') !== runId) {
      localStorage.clear()
      sessionStorage.setItem('phone-sale-smoke', runId)
    }
    // Synthetic QR encodes MOBILE-SALE-TEST-101; no real customer identifier.
    const matrix = ['1111111001000001101111111','1000001011011000001000001','1011101001110010101011101','1011101011010000101011101','1011101000101111001011101','1000001010100111101000001','1111111010101010101111111','0000000000001101000000000','1111101111101011010101010','0110110001000001111011001','0000101111011000010001101','0101110001110010100100101','1110001001010000000111111','1111010101101111001110100','1001111010000111011110111','1011000111101100001000110','1010111001101011111110110','0000000010100001100011110','1111111011111001101011101','1000001000010011100011100','1011101010110001111111000','1011101011101111010101101','1011101011100111010100001','1000001010101101101110100','1111111011001010010100001']
    delete window.BarcodeDetector
    const device = new EventTarget(), characteristic = new EventTarget()
    characteristic.startNotifications = async () => characteristic
    const server = { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }
    Object.assign(device, { id: 'local-simulated-nvk', name: 'NVK-local-simulation', gatt: {
      connected: false,
      async connect() { this.connected = true; return server },
      disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')) }
    } })
    window.__phoneSaleSmoke = { camera: 'denied', selections: 0, emit(kg) {
      const bytes = new TextEncoder().encode(`ST,NT,+${kg.toFixed(1)}kg\r\n`)
      characteristic.value = new DataView(bytes.buffer)
      characteristic.dispatchEvent(new Event('characteristicvaluechanged'))
    } }
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice() {
      window.__phoneSaleSmoke.selections++; return Promise.resolve(device)
    } } })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      if (window.__phoneSaleSmoke.camera === 'denied') throw new DOMException('simulated denied', 'NotAllowedError')
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 600
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 600); ctx.fillStyle = 'black'
      matrix.forEach((row, y) => [...row].forEach((dark, x) => { if (dark === '1') ctx.fillRect(150 + x * 12, 150 + y * 12, 12, 12) }))
      const stream = canvas.captureStream(10)
      const timer = setInterval(() => {
        const track = stream.getVideoTracks()[0]
        if (!track || track.readyState === 'ended') { clearInterval(timer); return }
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1, 1); track.requestFrame?.()
      }, 100)
      return stream
    } })
  }, { runId })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/?fixture=phone-sale&smoke=${runId}#/pages/pda/sale-create`)
  const errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const button = text => page.locator('uni-button').filter({ hasText: text })
  await button('扫码地点码').click()
  await page.getByText(/摄像头无法启动|摄像头权限未开放/).waitFor()
  await button('关闭').click()
  await page.evaluate(() => { window.__phoneSaleSmoke.camera = 'qr' })
  await button('扫码地点码').click()
  await page.getByText('手机称重模拟客户', { exact: true }).waitFor()
  if (await page.getByRole('dialog').count()) throw Error('Camera did not close after decoding')
  await button('下一步：录出回瓶').click()
  await button('连接吊秤').click()
  await page.locator('input:not([disabled])').first().fill('101')
  await button('查瓶').click()
  for (let n = 0; n < 7; n++) { await page.evaluate(() => window.__phoneSaleSmoke.emit(120)); await page.waitForTimeout(300) }
  const verifyWeights = async () => {
    const values = await page.locator('input').evaluateAll(inputs => inputs.map(input => input.value))
    for (const expected of ['101', '120.0', '100.0', '20.0']) if (!values.includes(expected)) throw Error(`Missing ${expected}: ${values}`)
  }
  await verifyWeights()
  await page.reload()
  await button('恢复草稿').click()
  await verifyWeights()
  if (await page.evaluate(() => window.__phoneSaleSmoke.selections !== 0)) throw Error('Draft silently reconnected Bluetooth')
  await button('下一步：预览提交').click()
  await button('提交销售单').click()
  await page.getByText('销售单：LOCAL-DEMO-SALE', { exact: true }).waitFor()
  if (!await page.locator('.sale-form').evaluate(node => node.inert)) throw Error('Submitted content is editable')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`Overflow at ${width}`)
    await page.screenshot({ path: `output/playwright/mobile-sale-saved-${width}.png`, fullPage: true })
  }
  page.off('pageerror', onError)
  if (errors.length) throw Error(errors.join('\n'))
  return { softwareQr: true, simulatedBle: true, draftReload: true, savedReceipt: true, widths: [390, 320], realHardware: false }
}
