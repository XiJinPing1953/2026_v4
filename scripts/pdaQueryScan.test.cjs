const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/composables/pda/usePdaQueryScan.js', 'utf8').replace(/^import .*\n/gm, '').replace('export function', 'function')
function setup() {
	let scanner, leaves = 0, starts = 0
	const pending = [], bottles = []
	const { usePdaQueryScan } = vm.runInNewContext(source + '\n;({ usePdaQueryScan })', {
		ref: value => ({ value }), onBeforeUnmount: () => {},
		isPdaAppMode: () => true,
		enterBarcodeSession: async options => { scanner = options.onResult; return { code: 0 } },
		leaveBarcodeSession: async () => { leaves++ },
		resolvePdaBottleByQrCode: raw => new Promise(resolve => pending.push({ raw, resolve })),
		uni: { showToast() {} }
	})
	const model = usePdaQueryScan({ onStart: () => starts++, onBottle: no => bottles.push(no) })
	return { model, pending, bottles, scan: rawText => scanner({ rawText }), leaves: () => leaves, starts: () => starts }
}
test('新扫描优先，旧二维码解析不能覆盖新钢瓶', async () => {
	const h = setup(); await h.model.activate()
	const first = h.scan('A'), second = h.scan('B')
	h.pending[1].resolve({ code: 0, data: { bottle_no: '2' } }); await second
	h.pending[0].resolve({ code: 0, data: { bottle_no: '1' } }); await first
	assert.deepEqual(h.bottles, ['2']); assert.equal(h.starts(), 2)
})
test('页面隐藏释放扫描头并丢弃迟到的解析结果', async () => {
	const h = setup(); await h.model.activate(); const scan = h.scan('A')
	await h.model.deactivate(); h.pending[0].resolve({ code: 0, data: { bottle_no: '1' } }); await scan
	assert.deepEqual(h.bottles, []); assert.equal(h.leaves(), 1); assert.equal(h.model.scannerReady.value, false)
})
test('手动查询或切换页签取消等待中的扫码结果', async () => {
	const h = setup(); await h.model.activate(); const scan = h.scan('A')
	h.model.invalidate(); h.pending[0].resolve({ code: 0, data: { bottle_no: '1' } }); await scan
	assert.deepEqual(h.bottles, [])
})
