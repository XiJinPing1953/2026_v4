import { TEST_LABEL, labelQrText, writeLabel, getPairedPrinters, createLabelPrinterSession } from './labelPrinter'
export { TEST_LABEL }
export const TEST_QR = labelQrText(TEST_LABEL)
export const writeTestLabel = plugin => writeLabel(plugin, TEST_LABEL, true)
export const getPairedTestPrinters = getPairedPrinters
export function createPrinterTestSession(plugin, update) {
	const session = createLabelPrinterSession(plugin, update)
	let sent = false
	return {
		connect: address => session.connect(address),
		close: () => session.close(),
		async print() {
			if (sent) throw new Error('本次已发送，请先查看是否出纸')
			sent = true
			await session.print(TEST_LABEL, true)
			update({ connected: session.connected, message: '已发送一张，请查看出纸并扫码核对；未出纸也不会自动重打' })
		}
	}
}
