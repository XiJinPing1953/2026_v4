'use strict'

// Synthetic evidence runner: invokes the deployed reader with its actual index
// helpers, while fixing the business calendar. It never connects to uniCloud.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { makeDb } = require('../lib/accountingTestHarness.cjs')
const { readBriefFinance } = require('../../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBriefFinanceRead')
const { VERSION, resolveRange, summarizeOperations } = require('../../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBrief')
const fixture = require('./operatingBriefAnalysis.sources.json')

function indexHelpers(db) {
  const filename = path.resolve(__dirname, '../../uniCloud-alipay/cloudfunctions/crm-dashboard/index.js')
  const context = { exports: {}, require: createRequire(filename), uniCloud: { database: () => db },
    console: { log() {}, warn() {}, error() {} }, Date, Math, Set, Map, Buffer, process }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nexports.analysisTestHelpers = { computeSaleAmount, computeSaleWeight, computeSaleBottleCount, detectGasFlowMode, buildCustomerKey };', context, { filename })
  return context.exports.analysisTestHelpers
}

async function readAt(collections, { period = fixture.period, now = Date.parse(fixture.now), section = 'brief', ...data } = {}, hooks = {}) {
  const db = makeDb(structuredClone(collections), hooks)
  const range = resolveRange({ period }, now)
  const result = await readBriefFinance(db, { period, section, ...data }, indexHelpers(db), range, { version: VERSION, summarizeOperations })
  return { result, db, range }
}

async function evidencePackage() {
  const collections = structuredClone(fixture.collections)
  const { result, db, range } = await readAt(collections)
  if (result.code !== 0 || db.writes.length) throw new Error('Synthetic evidence must be a successful read-only aggregation')
  const { business, cash, operations, analysis, read_started_at, read_completed_at } = result.data
  return { schema: 'operating-brief-evidence/1', rule_version: 'sale-accounting/2026-09-08.1',
    description: fixture.description, period: fixture.period, range, read_started_at, read_completed_at,
    collection_metadata: Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, { read_complete: true, expected_count: rows.length }])),
    collections, expected: { business, cash, operations, analysis } }
}

if (require.main === module) evidencePackage().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { fixture, indexHelpers, readAt, evidencePackage }
