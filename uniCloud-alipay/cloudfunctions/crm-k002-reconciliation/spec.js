'use strict'
const CUSTOMER_ID = '694045c0adf6dbd796e26219'
const CUSTOMER_NAME = '保定灰鲸酒店'
const VERSION = 'k002-accountant-reconciliation/2026-09-12.1'
const SPEC = Object.freeze({
  customer_id: CUSTOMER_ID, customer_name: CUSTOMER_NAME,
  correction_key: 'k002-accountant-reconciliation-v1',
  sales: Object.freeze([
    ['695dadb2149854772ff049e4', '2026-01-04', 5540],
    ['6971bdb21c90b6e946ef9dda', '2026-01-22', 4130],
    ['697da41e816a3f9dd2c7f309', '2026-01-31', -1260]
  ]),
  receipts: Object.freeze([['2026-01-04', 5540], ['2026-01-22', 5030]]),
  fees: Object.freeze([['2026-01-22', 900, '12月22日至1月22日瓶租'], ['2026-02-02', 270, '1月23日至1月31日瓶租']]),
  refund: Object.freeze({ date: '2026-02-02', amount: 990, source_type: 'offset_credit_cash_refund' }),
  expected: Object.freeze({ business_revenue: 9580, cash_received: 10570, refund_total: 990,
    net_cash_received: 9580, receivable_balance: 0, prepay_balance: 0 })
})
module.exports = { CUSTOMER_ID, CUSTOMER_NAME, VERSION, SPEC }
