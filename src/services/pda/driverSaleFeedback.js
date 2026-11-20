// Translate service diagnostics at the display boundary, including receipts saved by older versions.
export function driverSaleFeedback(value, fallback = '请稍后再试，如仍有问题请联系办公室。') {
	const message = typeof value === 'string' ? value.trim() : ''
	if (!message || !/[\u3400-\u9fff]/.test(message) ||
		/crm-[\w-]+|enqueueEvent|\w+V\d+\b|timed?\s*out|timeout|err_msg|request:fail|\b(?:Error|Exception)\b|https?:\/\//i.test(message)) return fallback
	return message
}

export function driverSaleWarning(warning, fallback) {
	const text = typeof warning === 'string' ? warning : warning?.message || warning?.msg || warning?.warning_text || warning?.reason
	const message = driverSaleFeedback(text, fallback)
	const bottle = warning?.bottle_no || warning?.bottleNo
	return bottle && message ? `${bottle} 号瓶 · ${message}` : message
}

export function driverReceiptWarnings(receipt) {
	if (receipt.sourceSaved === true) return []
	return (receipt.warnings || []).map(warning => driverSaleWarning(warning, '')).filter(Boolean)
}

export function driverReceiptSummary(receipt) {
	if (receipt.sourceSaved === true) {
		return '可以继续开下一单。'
	}
	if (receipt.sourceSaved == null) return '暂时无法确认是否保存，请先查询原单。'
	return driverSaleFeedback(receipt.message, '本单未保存，请核对后再提交。')
}

export function driverBottleCheck(items) {
	return items.map(item => {
		const number = item?.bottle_no || item?.bottleNo
		if (number && ['out', 'back'].includes(item.direction)) return (item.direction === 'out' ? '出瓶 ' : '回瓶 ') + number + ' 号'
		return driverSaleWarning(item, '请核对本次瓶号。')
	}).join('、') + '。请核对现场瓶号和方向，一致即可保存。'
}
