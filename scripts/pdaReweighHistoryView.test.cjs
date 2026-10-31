const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
const vue = require('vue'), compiler = require('@vue/compiler-sfc'), esbuild = require('esbuild')
const filename = 'src/components/domain/pda/PdaReweighHistorySection.vue'
const { descriptor } = compiler.parse(fs.readFileSync(filename, 'utf8'))
const script = compiler.compileScript(descriptor, { id: 'history-test', inlineTemplate: true })
const code = esbuild.transformSync(script.content, { format: 'cjs' }).code
const Button = { props: ['disabled'], emits: ['click'], setup: (props, { slots, emit }) => () => vue.h('button', { disabled: props.disabled, onClick: () => { if (!props.disabled) emit('click') } }, slots.default?.()) }
const Section = { props: ['title'], setup: (props, { slots }) => () => vue.h('section', [vue.h('header', props.title), ...(slots.actions?.() || []), ...(slots.default?.() || [])]) }
const context = { module: { exports: {} }, require: id => id === 'vue' ? vue : id.includes('performanceTrace') ? { startRenderSpan: () => () => {} } : id.includes('useRecordPageScroll') ? { useRecordPageScroll: () => () => {} } : id.includes('AppButton') ? Button : id.includes('AppSection') ? Section : { reweighHistoryTime: () => '2026-10-31' } }
vm.runInNewContext(code, context)
function mount(isReturn = false) {
 const create = (type, text = '') => ({ type, text, children: [], props: {} })
 const host = create('root')
 const renderer = vue.createRenderer({ createElement: create, createText: text => create('text', text), createComment: text => create('comment', text),
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
  patchProp: (node, key, _, value) => { node.props[key] = value }, parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
  insert(node, parent, anchor) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(at < 0 ? parent.children.length : at, 0, node) },
  remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null }
 })
 const items = Object.freeze(Array.from({ length: 323 }, (_, i) => Object.freeze({ operationId: `op-${i}`, bottleNo: String(i), grossWeight: 150, preview: { fill_weight: 45 }, receipt: { saved: i !== 0, complete: i !== 0 } })))
 const queries = [], printed = [], messages = vue.ref({}); let reasonCalls = 0
 const props = vue.shallowReactive({ title: '称重记录', items, isReturn, busy: false, printer: { messages, busy: vue.ref(false), reason: () => { reasonCalls++; return '' }, reprint: item => printed.push(item) }, onQuery: (...args) => queries.push(args) })
 const app = renderer.createApp({ setup: () => () => vue.h(context.module.exports.default, props) }); app.mount(host)
 const text = node => node.type === 'comment' ? '' : node.text + node.children.map(text).join('')
 const all = (node = host) => [node, ...node.children.flatMap(child => all(child))]
 const rows = () => all().filter(node => node.props.class === 'history-row')
 const click = async (label, bottom = false) => { const buttons = all().filter(node => node.type === 'button' && text(node) === label); const button = bottom ? buttons[buttons.length - 1] : buttons[0]; if (bottom) { assert.equal(buttons.length, 1); assert.ok(all().indexOf(button) > all().indexOf(rows().at(-1)), 'pager must follow all displayed records') }; assert.ok(button, label); button.props.onClick(); await vue.nextTick() }
 return { app, props, items, rows, text, click, queries, printed, reasonCalls: () => reasonCalls }
}
test('323 records render at most 10 at once, with only a bottom pager, complete order and no rows when collapsed', async () => {
 const h = mount(); assert.equal(h.rows().length, 0)
 await h.click('展开 ⌄'); assert.equal(h.rows().length, 10)
 await h.click('补打标签'); assert.equal(h.printed[0], h.items[322])
 const seen = []
 for (let page = 1; page <= 33; page++) {
  assert.ok(h.rows().length <= 10)
  seen.push(...h.rows().map(node => Number(h.text(node).match(/^(\d+) 号瓶/)[1])))
  if (page < 33) await h.click('下一页', true)
 }
 assert.deepEqual(seen, Array.from({ length: 323 }, (_, i) => 322 - i))
 await h.click('查询状态'); await h.click('重试处理')
 assert.deepEqual(h.queries, [['op-0'], ['op-0', true]])
 await h.click('收起 ⌃'); assert.equal(h.rows().length, 0)
 await h.click('展开 ⌄'); assert.match(h.text(h.rows()[0]), /^322 号瓶/)
 assert.equal(h.items.length, 323); h.app.unmount()
})
test('printer busy/messages update without revalidating every visible saved label', async () => {
 const h = mount(); await h.click('展开 ⌄')
 assert.equal(h.reasonCalls(), 10)
 h.props.printer.busy.value = true
 h.props.printer.messages.value = { 'op-322': '已发送' }; await vue.nextTick()
 assert.equal(h.reasonCalls(), 10); assert.match(h.text(h.rows()[0]), /已发送/)
 h.props.printer.busy.value = false; await h.click('下一页', true)
 assert.equal(h.reasonCalls(), 20); h.app.unmount()
})
test('return history never displays a print action; shrinking records clamps the page and busy preserves retry guards', async () => {
 const h = mount(true); await h.click('展开 ⌄'); await h.click('下一页')
 assert.ok(h.rows().every(node => !h.text(node).includes('补打标签')))
 h.props.items = h.items.slice(0, 2); h.props.busy = true; await vue.nextTick()
 assert.equal(h.rows().length, 2)
 await h.click('查询状态'); assert.equal(h.queries.length, 0)
 h.props.busy = false; await vue.nextTick(); await h.click('查询状态')
 assert.deepEqual(h.queries, [['op-0']]); h.app.unmount()
})
