'use strict'
// User-approved scope, 2026-09-08. Receipt dates follow accounting vouchers.
const CUSTOMER_ID = '695db77e8b0da45f294afbee'
const VERSION = 'haonuo-reconciliation/2026-09-08.1'
const SPEC = {
  customer_id: CUSTOMER_ID, opening_date: '2025-12-16', opening_reading: 556993.1,
  opening_prepay: 46071.68, unit_price: 5,
  periods: [
    ['2026-01-12',569469,12475.9,62379.5], ['2026-01-23',579018.3,9549.3,47746.5],
    ['2026-02-20',583743.6,4725.3,23626.5], ['2026-02-27',592650.6,8907,44535],
    ['2026-03-14',592650.6,0,0], ['2026-03-19',600040.9,7390.3,36951.5],
    ['2026-07-31',602908.6,2867.7,14338.5], ['2026-08-07',607224.2,4315.6,21578],
    ['2026-08-16',613882.9,6658.7,33293.5], ['2026-09-05',613882.9,0,0],
    ['2026-09-07',614935.1,1052.2,5261]
  ],
  receipts: [
    ['2026-01-14',100000,'unknown','记-050','会计未明确渠道，保留待核'],
    ['2026-01-27',50000,'check','记-103','表格备注1月23日收到支票，按会计1月27日记收款，仅一笔'],
    ['2026-03-19',70000,'check','记-067','会计与用气表日期一致'],
    ['2026-08-06',60000,'check','记-017','表格备注8月7日收到支票，按会计8月6日记收款，仅一笔']
  ],
  expected: { sales:24, old_flows:9, old_receipts:2, old_allocations:10,
    actual_receipts:280000, gas_charges:289710, remaining_prepay:36361.68,
    old_flow_charges:284449, duplicate_sale_charges:10490.5, embedded_sale_received:21640.5 },
  checkpoints: [['2026-01-23',35945.68],['2026-01-27',85945.68],['2026-08-07',74916.18],['2026-09-07',36361.68]]
}
module.exports = { CUSTOMER_ID, VERSION, SPEC }
