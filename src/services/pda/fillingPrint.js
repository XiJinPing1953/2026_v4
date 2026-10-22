import { normalizePrintLabel } from './labelPrinter'
export function savedLabel(entry) {
	const p = entry?.frozen?.payload
	if (!entry?.receipt?.saved || !p || p.operation_id !== entry.operationId || p.bottle_no !== entry.bottleNo) throw new Error('记录尚未确认保存，不能打印')
	const label = normalizePrintLabel(entry.frozen.label || entry.preview?.label)
	// Legacy entries retain the authoritative pre-submit preview alongside their frozen payload.
	if (label.bottle_no !== p.bottle_no || label.gross_weight !== p.gross_weight || (!entry.frozen.label && entry.preview?.context_hash !== p.context_hash)) throw new Error('缺少本次保存的标签资料，暂不能补打')
	return label
}
export function isSuperseded(entry, entries) {
	const id = entry?.receipt?.fillingId || entry?.frozen?.payload?.filling_id
	if (!id) return false
	const index = entries.findIndex(row => row.operationId === entry.operationId)
	return entries.slice(index + 1).some(row => row.operationId !== entry.operationId && row.receipt?.saved && row.frozen?.mode === 'correct' && row.frozen.payload.filling_id === id)
}
export function verifyCurrentLabel(entry, response) {
	const label = savedLabel(entry), row = response?.data
	if (response?.code !== 0 || !row || row._id !== entry.receipt.fillingId) throw new Error('暂时无法核对最新记录，请稍后补打')
	if (row.operation_id !== entry.operationId || row.bottle_no !== label.bottle_no || row.entry_source !== 'pda_reweigh') throw new Error('这笔记录已有变更，不能打印旧标签')
	const actual = normalizePrintLabel(row.reweigh?.label)
	if (JSON.stringify(actual) !== JSON.stringify(label)) throw new Error('这笔重量已有变更，不能打印旧标签')
	return true
}
export function createFillingPrintController({ ownerId, currentOwner, storage, valid, entries, printer, report, verify }) {
	const key = `crm_pda_filling_print_v1:${ownerId}`
	const eligible = new Set(), consumed = new Set()
	let sending = false, generation = 0
	const allowed = () => Boolean(ownerId && currentOwner() === ownerId && valid())
	function read() {
		const raw = storage.getStorageSync(key)
		if (!raw) return { version: 1, operations: {} }
		const data = typeof raw === 'string' ? JSON.parse(raw) : raw
		if (data.version !== 1 || !data.operations || typeof data.operations !== 'object' || Array.isArray(data.operations)) throw new Error('打印记录无法读取')
		return data
	}
	function record(id, status, label) {
		if (!allowed()) throw new Error('页面或账号已变化')
		const data = read()
		data.operations[id] = { status, label, updatedAt: Date.now() }
		const raw = JSON.stringify(data)
		storage.setStorageSync(key, raw)
		if (storage.getStorageSync(key) !== raw) throw new Error('打印记录未能保存')
	}
	async function send(entry, auto) {
		if (!allowed()) return false
		const version = generation, id = entry.operationId
		const notify = text => { if (version === generation && allowed()) report(id, text) }
		let label, acquired = false
		try {
			if (isSuperseded(entry, entries())) throw new Error('这笔已更正，请补打更正后的记录')
			label = savedLabel(entry)
			if (auto && read().operations[id]) return false
			const connection = printer()
			if (!connection?.connected || sending || connection.busy) {
				if (auto) record(id, 'not_sent', label)
				notify('记录已保存，标签未打印；连接空闲后可补打')
				return false
			}
			sending = true; acquired = true
			const verified = await verify(entry, label)
			if (!allowed() || version !== generation) return false
			if (!connection.connected || connection !== printer()) throw new Error('打印机连接已变化，标签未打印')
			// Durable lock precedes every native write. Never infer paper delivery from SDK return.
			record(id, 'attempted', label)
			if (!allowed() || version !== generation) return false
			await connection.print({ ...label, ...(verified?.qr_url ? { qr_url: verified.qr_url } : {}) })
			notify('标签已发送，请查看出纸')
			return true
		} catch (error) { notify(`记录已保存，${error.message || '标签发送结果不明'}；请查看出纸后再补打`); return false }
		finally { if (acquired) sending = false }
	}
	return {
		arm(entry) { if (allowed() && !entry.receipt?.saved) eligible.add(entry.operationId) },
		confirmed(entry, matched) {
			const id = entry?.operationId
			if (!matched || !entry?.receipt?.saved || !allowed() || !eligible.has(id) || consumed.has(id)) return
			consumed.add(id); eligible.delete(id)
			void send(entry, true)
		},
		reprint: entry => send(entry, false),
		close() { generation++; eligible.clear(); consumed.clear() },
		get busy() { return sending }
	}
}
