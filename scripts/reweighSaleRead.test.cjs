'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDatabase } = require('./lib/fillingHarness.cjs')
const { createReweighService } = require('../uniCloud-alipay/cloudfunctions/crm-filling/reweighService')
const { bottleKey, canRecordReturn, resolveMeasuredReweighContext, returnBasis } = require('../uniCloud-alipay/cloudfunctions/crm-filling/returnReweighRules')
const at = Date.parse('2026-10-23T11:05:41+08:00')
function inputs() {
 const record = { _id: 'return263', bottle_no: '263', date: '2026-10-23 11:05:41', created_at: at, gross_weight: 119.5, outgoing_facts: [], manual_facts: [], baseline_filling_ids: [] }
 const filling = { _id: 'fill263', bottle_no: '263', date: '2026-10-23', entry_source: 'pda_reweigh', consistency_status: 'complete', reweigh: { basis: returnBasis(record) } }
 return { bottle: { _id: 'b263', bottle_no: '263', tare_weight: 117, is_active: true }, returnRecord: record, returnHead: { consumed_filling_id: 'fill263', record_id: record._id }, sales: [], manual: [], fillings: [filling] }
}
function sale(id, date, created, direction = 'out_items') { return { _id: id, date, created_at: created, updated_at: created, biz_mode: 'bottle', [direction]: [{ bottle_no: '263', gross: 185, tare: 117, net: 68 }] } }

test('sales read spans pages and matches all directions without nested array query', async () => {
 const db = makeDatabase(); const i = inputs(); db.data('crm_bottles').set(i.bottle._id, i.bottle)
 for (let n=0;n<405;n++) db.data('crm_sale_records').set(`s${String(n).padStart(3,'0')}`, sale(`s${String(n).padStart(3,'0')}`, '2026-10-20', at-1000))
 for (const row of db.data('crm_sale_records').values()) row.out_items[0].bottle_no='999'
 db.data('crm_sale_records').get('s004').out_items[0].bottle_no=263
 db.data('crm_sale_records').set('s200', sale('s200','2026-10-26',at+1000,'back_items'))
 db.data('crm_sale_records').set('s404', sale('s404','2026-10-26',at+1000,'agent_sale_items'))
 const r=await createReweighService({db}).readInputs('263');assert.deepEqual(r.sales.map(x=>x._id),['s004','s200','s404'])
 const tx=await db.startTransaction();try { assert.deepEqual((await createReweighService({db}).readInputs('263',tx)).sales,r.sales) } finally {await tx.rollback()}
})
test('263 legacy empty snapshot recognizes new departure but never reuses old filling basis', () => {
 const i=inputs();i.sales=[sale('old','2026-10-20',at-1000),sale('out24','2026-10-24',at+86400000),sale('back26','2026-10-26',at+3*86400000,'back_items')]
 assert.equal(canRecordReturn(i).ok,true);assert.match(resolveMeasuredReweighContext(i).msg,/出瓶记录已变化/)
})
test('newly visible unchanged historical facts do not reopen a consumed cycle or block its correction', () => {
 const i=inputs();i.sales=[sale('old','2026-10-23',at-1000)]
 assert.equal(canRecordReturn(i).ok,false);assert.equal(resolveMeasuredReweighContext(i).ok,true)
 i.sales[0].updated_at=at+1000;i.sales[0].out_items[0].net=67
 assert.equal(canRecordReturn(i).ok,false);assert.match(resolveMeasuredReweighContext(i).msg,/出瓶记录已变化/)
})
test('recovered sales still preserve duplicate filling and true loss guards', () => {
 const i=inputs();i.sales=[sale('old','2026-10-20',at-1000)]
 i.fillings.push({_id:'second',date:'2026-10-23'});assert.match(resolveMeasuredReweighContext(i).msg,/多次灌装/)
 i.fillings.pop();i.manual.push({_id:'loss',date:'2026-10-23',type:'adjust',loss_weight:1});assert.match(resolveMeasuredReweighContext(i).msg,/损耗变更/)
 i.manual=[];i.fillings[0].confirmed_fill_loss={loss_weight:1};assert.match(resolveMeasuredReweighContext(i).msg,/人工损耗确认/)
})

// Complete snapshots can prove an item was absent even if its sale already existed.
test('complete snapshots allow a newly appended departure but not edits of a captured bottle', () => {
 const i=inputs();i.returnRecord.sales_snapshot_version=2
 i.sales=[sale('earlier-sale','2026-10-23',at-1000)];i.sales[0].updated_at=at+1000
 assert.equal(canRecordReturn(i).ok,true)
 i.returnRecord.outgoing_facts=require('../uniCloud-alipay/cloudfunctions/crm-filling/returnReweighRules').outgoingFacts(i)
 i.sales[0].out_items[0].net=67;assert.equal(canRecordReturn(i).ok,false)
 assert.match(resolveMeasuredReweighContext(i).msg,/出瓶记录已变化/)
})
test('legacy missing timestamps cannot prove unchanged history or a new departure', () => {
 const i=inputs();i.sales=[sale('old','2026-10-23',at-1000)];delete i.sales[0].updated_at
 assert.equal(canRecordReturn(i).ok,false);assert.match(resolveMeasuredReweighContext(i).msg,/出瓶记录已变化/)
 delete i.sales[0].created_at;assert.equal(canRecordReturn(i).ok,false)
})

test('unrelated sales beyond 20000 rows do not impose a per-bottle history limit', async () => {
 const db=makeDatabase();const i=inputs();db.data('crm_bottles').set(i.bottle._id,i.bottle)
 for(let n=0;n<20001;n++) db.data('crm_sale_records').set(`s${String(n).padStart(6,'0')}`,{_id:`s${String(n).padStart(6,'0')}`,out_items:[{bottle_no:'999'}]})
 db.data('crm_sale_records').set('z-last',sale('z-last','2026-10-24',at+86400000))
 const r=await createReweighService({db}).readInputs('263');assert.deepEqual(r.sales.map(x=>x._id),['z-last'])
})
