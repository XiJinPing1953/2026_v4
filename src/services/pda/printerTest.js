// First hardware trial only: no sales/filling writes and no automatic retries.
export const TEST_LABEL = Object.freeze({ bottle: 'TEST001', tare: '110.0', gross: '185.5', net: '75.5' })
export const TEST_QR = '新拓能源、瓶号：TEST001、皮重：110.0 kg、毛重：185.5 kg、净重：75.5 kg'

export function writeTestLabel(plugin) {
	// 203 dpi candidate layout; verify physical size and Chinese QR decoding on HL300.
	plugin.clear()
	plugin.setSize(50, 80)
	plugin.setCls()
	plugin.setDirection(0)
	plugin.setReference(0, 0)
	// Preserve printer's configured media gap; do not calibrate/reset the device.
	plugin.setText(24, 24, 'TSS24.BF2', 2, 2, '新拓能源')
	plugin.setText(24, 88, 'TSS24.BF2', 1, 1, '测试标签 勿贴实瓶')
	plugin.setText(24, 140, 'TSS24.BF2', 1, 1, `瓶号: ${TEST_LABEL.bottle}`)
	plugin.setText(24, 184, 'TSS24.BF2', 1, 1, `皮重: ${TEST_LABEL.tare} kg`)
	plugin.setText(24, 228, 'TSS24.BF2', 1, 1, `毛重: ${TEST_LABEL.gross} kg`)
	plugin.setText(24, 272, 'TSS24.BF2', 1, 1, `净重: ${TEST_LABEL.net} kg`)
	plugin.setQR(48, 330, 'M', 5, 'A', TEST_QR)
	plugin.setPagePrint()
	return plugin.startPrint()
}

export function getPairedTestPrinters(android) {
	const Adapter = android.importClass('android.bluetooth.BluetoothAdapter')
	const adapter = Adapter.getDefaultAdapter()
	if (!adapter || !android.invoke(adapter, 'isEnabled')) throw new Error('请先打开系统蓝牙')
	const iterator = android.invoke(android.invoke(adapter, 'getBondedDevices'), 'iterator')
	const devices = []
	while (android.invoke(iterator, 'hasNext')) {
		const device = android.invoke(iterator, 'next')
		const name = String(android.invoke(device, 'getName') || '')
		if (name !== 'HL30-AA21') continue
		const address = String(android.invoke(device, 'getAddress') || '')
		if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address)) devices.push({ name, address })
	}
	return devices
}

export function createPrinterTestSession(plugin, update) {
	let closed = false, connected = false, attempted = false, sent = false, timer = null
	const required = ['connState', 'bluetoothConn', 'bluetoothDisConn', 'clear', 'setSize', 'setCls', 'setDirection', 'setReference', 'setText', 'setQR', 'setPagePrint', 'startPrint']
	if (!plugin || required.some(key => typeof plugin[key] !== 'function')) throw new Error('当前安装包缺少打印接口，需要核对安装包')
	function stopTimer() { clearTimeout(timer); timer = null }
	plugin.connState(value => {
		if (closed || !attempted) return
		const code = Number(value)
		if (![0, 1, 2, 3].includes(code)) return
		connected = code === 0
		if (code !== 1) stopTimer()
		update({ connected, message: ['打印机已连接', '正在连接打印机', '打印机已断开，请收起后重新连接', '连接失败，请收起后重新连接'][code] })
	})
	return {
		connect(address) {
			if (closed || attempted) throw new Error('请收起测试后重新连接')
			if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address)) throw new Error('打印机地址无效')
			attempted = true
			timer = setTimeout(() => {
				if (closed || connected) return
				this.close()
				update({ connected: false, message: '连接超时，请收起后重试' })
			}, 15000)
			plugin.bluetoothConn(address)
		},
		print() {
			if (closed || !connected) throw new Error('请先连接打印机')
			if (sent) throw new Error('本次已发送，请先查看是否出纸')
			// Lock before native call: an exception may occur after bytes reached the printer.
			sent = true
			writeTestLabel(plugin)
			update({ connected: true, message: '已发送一张，请查看出纸并扫码核对；未出纸也不会自动重打' })
		},
		close() {
			if (closed) return
			closed = true; connected = false; stopTimer()
			if (attempted) { try { plugin.bluetoothDisConn() } catch (_) { /* Never touch the scale adapter. */ } }
		}
	}
}
