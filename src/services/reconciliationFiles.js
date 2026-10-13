export const RECONCILIATION_FILE_LIMIT = 2 * 1024 * 1024

export function validateReconciliationFile(file) {
	if (!file || !/\.(xls|xlsx)$/i.test(file.name || '')) throw new Error('请选择好会计导出的 .xls 或 .xlsx 文件。')
	if (!Number.isFinite(file.size) || file.size <= 0 || file.size > RECONCILIATION_FILE_LIMIT) throw new Error('请选择不超过 2 MB 的完整报表文件。')
}

// The browser reads the original bytes only; the server parses and validates the workbook.
export function pickReconciliationWorkbook() {
	if (typeof document === 'undefined' || typeof FileReader === 'undefined') return Promise.reject(new Error('请在网页版对账中心导入好会计文件。'))
	return new Promise((resolve, reject) => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = '.xls,.xlsx'
		input.style.display = 'none'
		const cleanup = () => input.remove()
		input.addEventListener('cancel', () => { cleanup(); resolve(null) }, { once: true })
		input.addEventListener('change', () => {
			const file = input.files?.[0]
			cleanup()
			if (!file) { resolve(null); return }
			try { validateReconciliationFile(file) } catch (error) { reject(error); return }
			const reader = new FileReader()
			reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'))
			reader.onload = () => {
				const data = String(reader.result || '')
				const separator = data.indexOf(',')
				if (separator < 0 || !data.slice(separator + 1)) { reject(new Error('文件内容为空，请重新导出。')); return }
				resolve({ name: file.name, size: file.size, base64: data.slice(separator + 1) })
			}
			reader.readAsDataURL(file)
		}, { once: true })
		document.body.appendChild(input)
		input.click()
	})
}

export function downloadReconciliationSource({ name, base64 }) {
	if (typeof document === 'undefined') throw new Error('请在网页版下载原始文件。')
	if (!name || !base64) throw new Error('原始文件未完整返回，请重试。')
	const binary = atob(base64)
	const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
	const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = name
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
