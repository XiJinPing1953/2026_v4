'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const source = fs.readFileSync('src/components/domain/customer/statement/CustomerStatementModule.vue', 'utf8')
function workspace() {
 const code = fs.readFileSync('src/composables/useStatementWorkspace.js', 'utf8').replace(/^import .*$/m, '').replaceAll('export function', 'function')
 const context = vm.createContext({ ...vue })
 vm.runInContext(code, context)
 return context
}
test('display pagination retains all source rows, clamps after deletion and resets explicitly', () => {
 const { useStatementPage } = workspace()
 const rows = vue.ref(Array.from({ length: 23 }, (_, i) => ({ id: i })))
 const pager = useStatementPage(rows)
 assert.equal(pager.visible.value.length, 10)
 pager.page.value = 3
 assert.deepEqual(pager.visible.value.map(x => x.id), [20,21,22])
 assert.equal(rows.value.length, 23)
 rows.value = rows.value.slice(0, 11)
 assert.equal(pager.page.value, 2)
 assert.equal(pager.visible.value.length, 1)
 rows.value = []
 assert.equal(pager.page.value, 1)
 assert.equal(pager.pages.value, 1)
 pager.reset()
 assert.equal(pager.page.value, 1)
})
test('checkbox events replace only the visible page, retaining selections on other pages', () => {
 const { mergeVisibleSelection } = workspace()
 assert.deepEqual(Array.from(mergeVisibleSelection(['sale:1','sale:11'],['sale:1','sale:2'],['sale:2'])),['sale:11','sale:2'])
 assert.deepEqual(Array.from(mergeVisibleSelection(['sale:2','sale:11'],['sale:11','sale:12'],[])),['sale:2'])
 assert.deepEqual(Array.from(mergeVisibleSelection([],['sale:1'],['sale:1','sale:1','unknown'])),['sale:1'])
})
function receiptHarness(preview) {
 const context = vm.createContext({ ...vue, recordId: vue.ref('a'), receiptForm: vue.reactive({amount:'10',roundingAmount:'',bizDate:'2026-09-20',allocationMode:'period',allocationStartDate:'2026-09-01',allocationEndDate:'2026-09-20',paymentMethod:'cash',note:''}),checkedAllocationTargetKeys:vue.ref([]),previewPlan:vue.ref(null),editableAllocations:vue.ref([]),allocationPreviewPage:vue.ref(1),previewing:vue.ref(false),confirming:vue.ref(false),loading:vue.ref(false),refreshingAfterSave:vue.ref(false),previewAllocationV1:preview,buildReceiptAllocationPayload:()=>({allocationMode:'period',allocationStartDate:'2026-09-01',allocationEndDate:'2026-09-20'}),syncReceiptPeriodSummaryFromPlan:()=>{},normalizeString:x=>String(x||''),normalizeDate:x=>x,toNumber:(x,d)=>Number(x)||d,formatMoney:x=>Number(x).toFixed(2),uni:{showToast(){}},showCloudRequestError(){}})
 const start=source.indexOf('const receiptPreviewStale = ref(false)')
 vm.runInContext(source.slice(start,source.indexOf('watch(salesDetailMode',start)),context)
 const a=source.indexOf('async function onPreview()')
 vm.runInContext(source.slice(a,source.indexOf('\nfunction buildManualAllocations()',a)),context)
 vm.runInContext('result = {receiptPreviewStale, receiptPreviewKey, receiptInputKey, receiptPreviewReady, invalidateReceiptPreview}',context)
 return context
}
const plan = {code:0,data:{allocations:[{target_type:'sale',target_id:'s1',target_date:'2026-09-20',outstanding_before:10,allocate_amount:10}]}}
test('preview becomes invalid immediately after amount, date, mode, selection or customer changes', async () => {
 const c=receiptHarness(async()=>plan)
 for(const change of [()=>{c.receiptForm.amount='11'},()=>{c.receiptForm.allocationStartDate='2026-09-02'},()=>{c.receiptForm.allocationMode='checked'},()=>{c.checkedAllocationTargetKeys.value=['sale:s1']},()=>{c.recordId.value='b'}]) {
  await c.onPreview()
  assert.equal(c.result.receiptPreviewReady.value,true)
  change()
  assert.equal(c.result.receiptPreviewReady.value,false)
  assert.equal(c.previewPlan.value,null)
  assert.equal(c.editableAllocations.value.length,0)
  assert.equal(c.result.receiptPreviewStale.value,true)
 }
})
test('late async preview cannot replace inputs changed while request was pending', async () => {
 let resolve
 const c=receiptHarness(()=>new Promise(r=>{resolve=r}))
 const pending=c.onPreview()
 c.receiptForm.amount='99'
 resolve(plan)
 await pending
 assert.equal(c.previewPlan.value,null)
 assert.equal(c.result.receiptPreviewReady.value,false)
 assert.equal(c.previewing.value,false)
})
test('refresh invalidation rejects an in-flight preview for the same form', async () => {
 let resolve
 const c=receiptHarness(()=>new Promise(r=>{resolve=r}))
 const pending=c.onPreview()
 c.result.invalidateReceiptPreview()
 resolve(plan)
 await pending
 assert.equal(c.previewPlan.value,null)
})
test('small rounding candidates come only from visible sales, not all loaded records', () => {
 const start=source.indexOf('const quickRoundingSmallCandidates = computed(')
 const end=source.indexOf('const quickRoundingSmallCandidateCount',start)
 const c=vm.createContext({...vue,salesPageRows:vue.ref([{_id:'visible',outstanding:.5}]),salesDetailRows:vue.ref([{_id:'visible',outstanding:.5},{_id:'hidden',outstanding:.2}]),canQuickRoundSalesDetailRow:()=>true,resolveSalesDetailOutstanding:r=>r.outstanding,QUICK_ROUNDING_SMALL_LIMIT:1})
 vm.runInContext(source.slice(start,end)+'result = quickRoundingSmallCandidates.value',c)
 assert.deepEqual(Array.from(c.result,x=>x._id),['visible'])
})
test('confirm handler refuses an invalid preview before any API call', async () => {
 const c=receiptHarness(async()=>plan)
 let writes=0
 c.confirmAllocationV1=async()=>{writes++;return {code:0}}
 const start=source.indexOf('async function onConfirmAllocation()')
 vm.runInContext(source.slice(start,source.indexOf('\nasync function onCreatePrepayEntry()',start)),c)
 await c.onConfirmAllocation()
 assert.equal(writes,0)
})

test('allocation edits survive both directions of display pagination', () => {
 const { useStatementPage } = workspace()
 const rows = vue.ref(Array.from({length:23},(_,i)=>({key:`sale:${i}`,allocateAmount:'10'})))
 const pager=useStatementPage(rows)
 const c=vm.createContext({editableAllocations:rows})
 const start=source.indexOf('function onAllocationInput(')
 vm.runInContext(source.slice(start,source.indexOf('\nfunction statementRowTitle',start)),c)
 c.onAllocationInput('sale:0','7.50')
 pager.page.value=3
 c.onAllocationInput('sale:22','8.00')
 pager.page.value=1
 assert.equal(pager.visible.value[0].allocateAmount,'7.50')
 pager.page.value=3
 assert.equal(pager.visible.value[2].allocateAmount,'8.00')
 assert.equal(rows.value.length,23)
})
