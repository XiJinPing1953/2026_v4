'use strict'

const { FinancialReadError } = require('./financialReadLocal')
const text = value => String(value ?? '').trim()
function invalid(reason, row, field) {
  const error = new FinancialReadError(reason, { source: 'crm_sale_records', source_id: text(row?._id), ...(field ? { field } : {}) })
  error.message = '销售单计价或重量来源待核，未返回确定合计'
  throw error
}
function numeric(value, row, field) {
  if (!['string', 'number'].includes(typeof value) || text(value) === '' || !Number.isFinite(Number(value)) || Number(value) < 0)
    invalid('invalid_source_amount', row, field)
}
function saleMode(row) {
  const mode = text(row.biz_mode) || 'bottle'
  if (!['bottle', 'truck', 'agent_sale'].includes(mode)) invalid('sale_quantity_type', row)
  return mode
}
function truckQuantity(row) {
  const fields = ['truck_sale_net', 'truck_gross_diff', 'truck_out_gross', 'truck_back_gross', 'truck_settle_gross', 'truck_settle_tare']
  for (const field of fields) if (row[field] != null) numeric(row[field], row, field)
  if (!['truck_sale_net', 'truck_gross_diff'].some(field => row[field] != null) &&
      !['truck_out_gross', 'truck_back_gross'].every(field => row[field] != null) &&
      !['truck_settle_gross', 'truck_settle_tare'].every(field => row[field] != null)) invalid('sale_quantity_missing', row)
}
function agentQuantity(row) {
  if (!Array.isArray(row.agent_sale_items)) invalid('sale_quantity_missing', row)
  for (const item of row.agent_sale_items) numeric(item?.fill_weight, row, 'agent_sale_items.fill_weight')
}
function bottleQuantity(row, requireWeight) {
  if (!Array.isArray(row.out_items) && !Array.isArray(row.back_items)) invalid('sale_quantity_missing', row)
  for (const field of ['out_items', 'back_items']) {
    if (row[field] == null) continue
    if (!Array.isArray(row[field])) invalid('sale_quantity_missing', row, field)
    if (requireWeight) for (const item of row[field]) numeric(item?.net, row, `${field}.net`)
  }
}

// Money classification runs first in the caller. A customer_flow delivery has
// no sale principal, while ordinary sale pricing still needs its original basis.
function validateSale(row) {
  if (row.settlement_mode === 'customer_flow') return
  numeric(row.unit_price, row, 'unit_price')
  const mode = saleMode(row), unit = text(row.price_unit) || 'kg'
  if (!['kg', 'bottle', 'm3'].includes(unit)) invalid('sale_quantity_type', row)
  if (mode === 'truck') truckQuantity(row)
  else if (mode === 'agent_sale') agentQuantity(row)
  else if (unit === 'm3') {
    if (row.flow_volume_m3 != null) numeric(row.flow_volume_m3, row, 'flow_volume_m3')
    else for (const field of ['flow_index_curr', 'flow_index_prev']) numeric(row[field], row, field)
  } else bottleQuantity(row, unit === 'kg')
}

// Daily physical operations are independent of pricing and settlement mode.
// Even a metered/customer_flow bottle delivery needs known out/back weights.
function validateSaleOperations(row) {
  const mode = saleMode(row)
  if (mode === 'truck') truckQuantity(row)
  else if (mode === 'agent_sale') agentQuantity(row)
  else bottleQuantity(row, true)
}

module.exports = { validateSale, validateSaleOperations }
