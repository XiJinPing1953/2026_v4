const copy = value => JSON.parse(JSON.stringify(value))
export const TEST_LABEL = Object.freeze({ company: '新拓能源', bottle_no: 'TEST001', tare_weight: 110, gross_weight: 185.5, net_weight: 75.5 })
export function normalizePrintLabel(label) {
	if (!label || label.company !== '新拓能源' || !/^[A-Za-z0-9_-]{1,48}$/.test(label.bottle_no || '')) throw new Error('标签瓶号资料不完整，暂不能打印')
	const result = { company: label.company, bottle_no: label.bottle_no }
	for (const key of ['tare_weight', 'gross_weight', 'net_weight']) {
		const n = label[key]
		if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 999999.9 || Math.abs(n * 10 - Math.round(n * 10)) > 0.00001) throw new Error('标签重量资料不完整，暂不能打印')
		result[key] = n
	}
	if (Math.abs(result.gross_weight - result.tare_weight - result.net_weight) > 0.00001) throw new Error('标签重量不一致，暂不能打印')
	return result
}
export function labelQrText(value) {
	const l = normalizePrintLabel(value)
	return `新拓能源、瓶号：${l.bottle_no}、皮重：${l.tare_weight.toFixed(1)} kg、毛重：${l.gross_weight.toFixed(1)} kg、净重：${l.net_weight.toFixed(1)} kg`
}
export function labelLayout(value, test = false) {
	const l = normalizePrintLabel(value), qr = labelQrText(l)
	const lines = []
	const no = `瓶号: ${l.bottle_no}`
	// TSS24.BF2: Chinese 24 dots, ASCII 12 dots. 400-dot wide stock.
	const width = text => [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 24 : 12), 0)
	let line = ''
	for (const ch of no) { if (width(line + ch) > 336) { lines.push(line); line = '' } line += ch }
	lines.push(line, `皮重: ${l.tare_weight.toFixed(1)} kg`, `毛重: ${l.gross_weight.toFixed(1)} kg`, `净重: ${l.net_weight.toFixed(1)} kg`)
	const left = Math.floor((400 - Math.max(...lines.map(width))) / 2)
	// The validated native command uses GB Chinese bytes and automatic QR encoding.
	const bytes = [...qr].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)
	const version = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213].findIndex(capacity => bytes <= capacity) + 1
	if (!version) throw new Error('标签内容过长，暂不能打印')
	const moduleSize = version >= 9 ? 4 : 5
	const qrWidth = (17 + version * 4) * moduleSize
	return { label: l, qr, qrX: Math.floor((400 - qrWidth) / 2), qrY: 352, moduleSize, lines: lines.map((text, i) => ({ text, x: left, y: 112 + i * 36 })), test }
}
export function writeLabel(plugin, label, test = false) {
	const layout = labelLayout(label, test)
	plugin.clear(); plugin.setSize(50, 80); plugin.setCls(); plugin.setDirection(0); plugin.setReference(0, 0)
	plugin.setText(104, 24, 'TSS24.BF2', 2, 2, '新拓能源')
	if (test) plugin.setText(92, 80, 'TSS24.BF2', 1, 1, '测试标签 勿贴实瓶')
	for (const row of layout.lines) plugin.setText(row.x, row.y, 'TSS24.BF2', 1, 1, row.text)
	plugin.setQR(layout.qrX, layout.qrY, 'M', layout.moduleSize, 'A', layout.qr)
	plugin.setPagePrint()
	return plugin.startPrint()
}
export function getPairedPrinters(android) {
	const Adapter = android.importClass('android.bluetooth.BluetoothAdapter'), adapter = Adapter.getDefaultAdapter()
	if (!adapter || !android.invoke(adapter, 'isEnabled')) throw new Error('请先打开系统蓝牙')
	const iterator = android.invoke(android.invoke(adapter, 'getBondedDevices'), 'iterator'), devices = []
	while (android.invoke(iterator, 'hasNext')) {
		const device = android.invoke(iterator, 'next'), name = String(android.invoke(device, 'getName') || '')
		if (name !== 'HL30-AA21') continue
		const address = String(android.invoke(device, 'getAddress') || '')
		if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address)) devices.push({ name, address })
	}
	return devices
}
let activeSession = null
export function createLabelPrinterSession(plugin, update = () => {}) {
	const required = ['connState', 'bluetoothConn', 'bluetoothDisConn', 'clear', 'setSize', 'setCls', 'setDirection', 'setReference', 'setText', 'setQR', 'setPagePrint', 'startPrint']
	if (!plugin || required.some(key => typeof plugin[key] !== 'function')) throw new Error('当前安装包缺少打印接口')
	if (activeSession) throw new Error('其他页面正在使用打印机，请先退出那个页面')
	let closed = false, connected = false, attempted = false, sending = false, timer = null, sendTimer = null
	const session = {
		get connected() { return !closed && connected },
		get busy() { return sending },
		connect(address) {
			if (closed || attempted) throw new Error('请重新连接打印机')
			if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address)) throw new Error('打印机地址无效')
			attempted = true
			timer = setTimeout(() => { if (!closed && !connected) { session.close(); update({ connected: false, connecting: false, message: '打印机连接超时，请重连' }) } }, 15000)
			plugin.bluetoothConn(address)
		},
		async print(label, test = false) {
			if (closed || !connected) throw new Error('打印机未连接')
			if (sending) throw new Error('上一张正在发送，请稍后补打')
			sending = true
			try { writeLabel(plugin, copy(label), test) }
			finally {
				// SDK provides no completion callback. Serialize sends and absorb double taps.
				await new Promise(resolve => { sendTimer = setTimeout(resolve, 1500) })
				sending = false
			}
		},
		close() {
			if (closed) return
			closed = true; connected = false; clearTimeout(timer)
			if (activeSession === session) activeSession = null
			if (attempted) { try { plugin.bluetoothDisConn() } catch (_) {} }
		}
	}
	activeSession = session
	try {
		plugin.connState(value => {
			if (closed || !attempted || !/^[0-3]$/.test(String(value))) return
			const code = Number(value)
			connected = code === 0
			if (code !== 1) clearTimeout(timer)
			update({ connected, connecting: code === 1, message: ['打印机已连接', '正在连接打印机', '打印机已断开，请重连', '打印机连接失败，请重连'][code] })
		})
	} catch (error) { session.close(); throw error }
	return session
}
