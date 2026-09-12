'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')

function fixture() {
	const base = { customer_id: 'customer-1', status: 'posted', created_at: 1, updated_at: 1 }
	const tables = tablesFor(saleDoc({ settlement_mode: 'customer_flow', amount_received: 0 }))
	Object.assign(tables.crm_customers[0], { should_receive_total:86708.803, amount_received_total:86708.803, net_balance:0 })
	tables.crm_customer_flow_settlements = [2561.886, 5586.299, 64518.318, 14042.28].map((amount, i) => ({
		...base, _id: `flow-${i}`, biz_date: ['2026-01-04','2026-01-05','2026-02-02','2026-03-13'][i],
		should_receive: amount, amount_received: amount, receipt_rounding_amount: 0, payment_status: 'paid', sale_ids: []
	}))
	tables.crm_customer_opening_debts = [
		{ ...base, _id: 'opening', biz_date: '2025-12-31', source_type: 'opening', amount: 77823.297, amount_received: 77823.297, money_scale: 3 },
		{ ...base, _id: 'tail', biz_date: '2026-01-06', source_type: 'reconciliation_other_fee', amount: .02, amount_received: .02, money_scale: 3 }
	]
	tables.crm_customer_receipts = [85971.5, 64517.95, 14042.65].map((amount, i) => ({ ...base,
		_id: `receipt-${i}`, biz_date: ['2026-01-06','2026-02-03','2026-04-01'][i], amount, allocated_amount: amount, unallocated_amount: 0
	}))
	tables.crm_customer_allocations = [[0,'opening_debt','opening',77823.297],[0,'flow_settlement','flow-0',2561.886],
		[0,'flow_settlement','flow-1',5586.299],[0,'other_fee','tail',.018],[1,'flow_settlement','flow-2',64518.318],
		[2,'flow_settlement','flow-3',14042.28],[2,'other_fee','tail',.002]]
		.map(([r, target_type, target_id, allocate_amount], i) => ({ ...base, _id: `allocation-${i}`, receipt_id: `receipt-${r}`,
			target_type, target_id, allocate_amount, allocate_kind: 'receipt', biz_date: '2026-09-08' }))
	// The second receipt leaves .368 unpaid until April; allocation dates need not equal receipt dates.
	tables.crm_customer_allocations[4].allocate_amount = 64517.95
	tables.crm_customer_allocations.push({ ...base, _id: 'allocation-7', receipt_id: 'receipt-2', target_type: 'flow_settlement', target_id: 'flow-2', allocate_amount: .368, allocate_kind: 'receipt', biz_date: '2026-09-08' })
	return tables
}

const query = (handler, from, to = '2026-09-08', action = 'getCustomerStatementV1') => invoke(handler, action, { customer_id: 'customer-1', date_from: from, date_to: to, summary_only: true })
const stripTime = value => { const { read_started_at, read_completed_at, ...rest } = value; return JSON.parse(JSON.stringify(rest)) }

test('year, cross-year and December: all three interfaces agree without changing legacy totals or records', async () => {
	const tables = fixture(), before = structuredClone(tables), db = makeDb(tables), handler = loadHandler('crm-customer-settlement', db)
	for (const [from, to, business, historical, cash, recovered] of [
		['2026-01-01','2026-09-08',86708.803,0,164532.1,77823.297],
		['2025-12-01','2026-09-08',86708.803,77823.297,164532.1,77823.297],
		['2025-12-01','2025-12-31',0,77823.297,0,0]
	]) {
		let first
		for (const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']) {
			const result = await query(handler, from, to, action)
			assert.equal(result.code, 0, result.msg)
			const p = result.data.period_summary
			assert.equal(p.complete, true, JSON.stringify(p.unresolved_sources))
			assert.equal(p.business_revenue, business); assert.equal(p.historical_receivable, historical)
			assert.equal(p.receivable_total, Number((business + historical).toFixed(3)))
			assert.equal(p.cash_received, cash); assert.equal(p.historical_debt_collected, recovered)
			assert.equal(p.refund_total, 0); assert.equal(p.net_cash_received, cash)
			if (first) assert.deepEqual(stripTime(p), first); else first = stripTime(p)
			if (action === 'getCustomerStatementV1') { assert.equal(result.data.summary.should_receive_total,86708.803); assert.equal(result.data.summary.amount_received_total,86708.803); assert.equal(result.data.summary.net_balance,0) }
		}
	}
	const full = await invoke(handler, 'getCustomerStatementV1', {customer_id:'customer-1',summary_only:false,date_from:'2026-01-01',date_to:'2026-09-08'})
	assert.equal(full.data.period_summary.cash_received,164532.1)
	assert.deepEqual(tables, before); assert.equal(db.writes.length, 0)
})

test('cash includes prepayments, excludes void rows/offsets/rounding, and separately reports dated refunds', async () => {
	const tables = fixture(), base = { customer_id:'customer-1', status:'posted', biz_date:'2026-01-10' }
	tables.crm_customer_receipts.push(
		{...base,_id:'prepay',entry_kind:'prepay',amount:100,unallocated_amount:100},
		{...base,_id:'offset',entry_kind:'offset_credit',amount:80,unallocated_amount:80},
		{...base,_id:'void',status:'void',amount:200},
		{...base,_id:'refund',amount:-20},
		{...base,_id:'rounding',amount:0,rounding_allocated_amount:12}
	)
	tables.crm_customer_allocations.push({...base,_id:'void-allocation',status:'void',receipt_id:'receipt-0',target_type:'opening_debt',target_id:'opening',allocate_amount:999})
	tables.crm_customer_flow_settlements[0].receipt_rounding_amount = 12
	tables.crm_customer_allocations.push({...base,_id:'rounding-allocation',receipt_id:'rounding',target_type:'flow_settlement',target_id:'flow-0',allocate_kind:'rounding',allocate_amount:12})
	const p = (await query(loadHandler('crm-customer-settlement',makeDb(tables)), '2026-01-01','2026-01-31')).data.period_summary
	assert.equal(p.complete,true); assert.equal(p.cash_received,86071.5); assert.equal(p.historical_debt_collected,77823.297)
	assert.equal(p.refund_total,20); assert.equal(p.net_cash_received,86051.5)
	assert.equal(p.rounding_total,12)
})

test('undated embedded cash or refunds remain pending even when the source is outside the query period', async () => {
	for (const amount of [30,-30]) {
		const tables = fixture()
		tables.crm_sale_records.push(saleDoc({_id:'old-sale',date:'2025-01-01',price_unit:'kg',settlement_mode:'sale',amount_received:amount,should_receive:30}))
		const p = (await query(loadHandler('crm-customer-settlement',makeDb(tables)), '2026-01-01')).data.period_summary
		assert.equal(p.complete,false); assert.equal(p.cash_received,null); assert.equal(p.net_cash_received,null)
		assert.equal(p.known_cash.cash_received,164532.1); assert.ok(p.unresolved_sources.some(row=>row.source_id==='old-sale'))
	}
})

test('missing/void receipt links and over-allocation cannot produce a complete cash summary', async () => {
	for (const mutate of [t=>{t.crm_customer_receipts[0].status='void'},t=>{t.crm_customer_allocations[0].allocate_amount+=1}]) {
		const t=fixture(); mutate(t)
		const p=(await query(loadHandler('crm-customer-settlement',makeDb(t)),'2026-01-01')).data.period_summary
		assert.equal(p.complete,false); assert.equal(p.cash_received,null)
	}
})

test('more than 5000 allocations are fully read; incomplete reads reject totals', async () => {
	const t=fixture()
	t.crm_customer_allocations=t.crm_customer_allocations.filter(row=>row.target_id!=='opening')
	t.crm_customer_opening_debts[0].amount=t.crm_customer_opening_debts[0].amount_received=5.189
	t.crm_customer_receipts[0].amount=8153.392
	for(let i=0;i<5189;i++) t.crm_customer_allocations.push({_id:`many-${String(i).padStart(5,'0')}`,customer_id:'customer-1',receipt_id:'receipt-0',target_type:'opening_debt',target_id:'opening',allocate_kind:'receipt',allocate_amount:.001})
	const p=(await query(loadHandler('crm-customer-settlement',makeDb(t)),'2026-01-01')).data.period_summary
	assert.equal(p.historical_debt_collected,5.189); assert.equal(p.complete,true)
	const handler=loadHandler('crm-customer-settlement',makeDb(fixture(),{count:(name,total)=>({total:name==='crm_customer_receipts'?100001:total})}))
	const failed=await query(handler,'2026-01-01')
	assert.equal(failed.code,409); assert.equal(failed.data.period_summary,undefined)
})

test('page mapper and both workbooks preserve three decimals and never turn missing metrics into zero', () => {
	const context={}; vm.createContext(context)
	const mapper=fs.readFileSync(path.resolve(__dirname,'../src/services/mappers/customerPeriodSummary.js'),'utf8').replace(/export /g,'')
	vm.runInContext(mapper+'\nglobalThis.normalize=normalizeCustomerPeriodSummary',context)
	const p={rule_version:'customer-period-summary/2026-09-08.1',read_complete:true,complete:true,date_from:'2026-01-01',date_to:'2026-09-08',money_scale:3,business_revenue:86708.803,historical_receivable:0,receivable_total:86708.803,cash_received:164532.1,historical_debt_collected:77823.297,refund_total:0,net_cash_received:164532.1,unresolved_sources:[]}
	assert.equal(context.normalize(p,{dateFrom:'2025-12-01'}),null)
	assert.equal(context.normalize({...p,cash_received:undefined}),null)
	assert.equal(context.normalize({...p,read_complete:false}),null)
	const source=fs.readFileSync(path.resolve(__dirname,'../src/components/domain/customer/statement/exportWorkbook.js'),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')
	vm.runInContext(source+'\nglobalThis.builders=[buildCustomerStatementWorkbookXml,buildCustomerAccountingLedgerWorkbookXml]',context)
	for(const build of context.builders){ const xml=build({period_summary:p}); assert.match(xml,/汇总说明/); assert.match(xml,/77823.297/); assert.match(xml,/164532.1/); assert.match(xml,/ss:ID="sMoney3"/); assert.match(build({}),/未完成/) }
})

test('a slower date query cannot overwrite the newest summary or its loading state', async () => {
	const pending=[]
	const ref=value=>({value})
	const context={recordId:ref('customer'),loading:ref(false),rowSummaryLoading:ref(false),periodSummary:ref(null),
		statementSummaryRequestSeq:0,financialIssue:ref(''),financialSourceIds:ref([]),customer:ref({}),
		buildStatementSummaryScopeParams:()=>({summaryDateFrom:'2026-01-01',summaryDateTo:'2026-09-08'}),
		getCustomerStatementV1:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),
		isLatestRowsSearchRequest:()=>true,applyStatementSummary:data=>{context.periodSummary.value=data.marker},
		uni:{showToast(){}},showCloudRequestError:()=>{throw Error('stale error reached UI')}
	}
	vm.createContext(context)
	const source=fs.readFileSync(path.resolve(__dirname,'../src/components/domain/customer/statement/CustomerStatementModule.vue'),'utf8')
	const start=source.indexOf('async function loadStatement('),end=source.indexOf('\nasync function loadAnalysis(',start)
	vm.runInContext(source.slice(start,end),context)
	const older=context.loadStatement({summaryOnly:true}), newer=context.loadStatement({summaryOnly:true})
	pending[1].resolve({code:0,data:{marker:'new'}}); await newer
	pending[0].resolve({code:0,data:{marker:'old'}}); await older
	assert.equal(context.periodSummary.value,'new')
	const failing=context.loadStatement({summaryOnly:true}), latest=context.loadStatement({summaryOnly:true})
	pending[2].reject(Error('old failed')); await failing
	assert.equal(context.rowSummaryLoading.value,true)
	pending[3].resolve({code:0,data:{marker:'latest'}}); await latest
	assert.equal(context.periodSummary.value,'latest'); assert.equal(context.rowSummaryLoading.value,false)
})
