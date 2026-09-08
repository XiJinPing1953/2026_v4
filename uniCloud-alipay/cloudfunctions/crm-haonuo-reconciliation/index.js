'use strict'
const crypto = require('crypto')
const db = uniCloud.database()
const { readComplete } = require('./financialReadLocal')
const CUSTOMER_ID = '695db77e8b0da45f294afbee'
const VERSION = 'haonuo-reconciliation/2026-09-08.1'
const TABLES = ['crm_sale_records', 'crm_customer_receipts', 'crm_customer_allocations',
  'crm_customer_flow_settlements', 'crm_customer_opening_debts', 'crm_customer_receipt_adjustments',
  'crm_collection_tasks', 'crm_collection_followups']
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }
async function snapshot() {
  const started = Date.now()
  const customer = (await db.collection('crm_customers').doc(CUSTOMER_ID).get()).data?.[0]
  if (!customer || customer.name !== '浩诺') throw Error('客户范围不匹配')
  const tables = { crm_customers: [customer] }
  const absentCollections = []
  for (const name of TABLES) {
    try { tables[name] = await readComplete(db.collection(name), { customer_id: CUSTOMER_ID }, {
      command: db.command, source: name, maxRows: 10000
    }) } catch (e) {
      if (String(e.message).trim() !== 'not found collection') throw e
      tables[name] = []; absentCollections.push(name)
    }
  }
  const saleIds = tables.crm_sale_records.map(row => `sale:${row._id}`)
  tables.crm_vouchers = []
  try {
    tables.crm_vouchers = await readComplete(db.collection('crm_vouchers'), { source: db.command.in(saleIds) }, {
      command: db.command, source: 'crm_vouchers', maxRows: 10000
    })
  } catch (e) { if (String(e.message).trim() !== 'not found collection') throw e; absentCollections.push('crm_vouchers') }
  return { customer_id: CUSTOMER_ID, tables, snapshot_hash: digest(tables), read_started_at: started,
    read_completed_at: Date.now(), complete: true, absent_collections: absentCollections,
    atomic_snapshot: false, rule_version: VERSION }
}
exports.main = async (event = {}) => {
  const user = (await db.collection('crm_users').where({ token: event.token || '__missing__' }).limit(1).get()).data?.[0]
  if (!user || user.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可核查指定客户' }
  if (event.data?.customer_id !== CUSTOMER_ID) return { code: 400, msg: '客户范围不匹配' }
  try {
    if (event.action === 'inspectV1') return { code: 0, data: await snapshot() }
    return { code: 400, msg: '不支持的操作' }
  } catch (e) { return { code: 409, msg: e.message, error_code: e.code || 'RECONCILIATION_READ_FAILED' } }
}
