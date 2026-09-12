#!/usr/bin/env node
'use strict'
const fs = require('fs'), path = require('path'), crypto = require('crypto'), child = require('child_process')
const { parseStandardArgs, prepareClientOptions, ensureCrmToken, generateRequestId, writeJsonFile } = require('./lib/qrImportCommon.cjs')
const CUSTOMER_ID = '694045c0adf6dbd796e26219', FUNCTION = 'crm-k002-reconciliation'
const allowed = new Set(['inspect','status','prepare','rehearse','execute'])
const mode = process.argv.find((arg, index) => index > 1 && !arg.startsWith('-')) || 'inspect'
if (!allowed.has(mode)) throw Error('用法: node scripts/runK002Reconciliation.cjs inspect|status|prepare|rehearse|execute --space-id <id> [--input evidence.json] [--report result.json]')
const options = parseStandardArgs(process.argv, { report: `outputs/k002-reconciliation/${mode}.json` })
const readJson = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
const sha256 = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
async function main() {
  const { client } = await prepareClientOptions(options), token = await ensureCrmToken(client, options)
  const call = async (action, data) => client.callFunction(FUNCTION, { action, token, data, request_id: generateRequestId() })
  let action = `${mode}V1`, data = { customer_id: CUSTOMER_ID }
  if (mode === 'prepare') {
    const inspect = await call('inspectV1', data)
    if (inspect.code !== 0) throw Error(`取证失败: ${inspect.msg}`)
    const approval = options.input ? readJson(options.input) : { customer_id: CUSTOMER_ID,
      confirmed_controls: { sales: [5540,4130,-1260], receipts: [5540,5030], fees: [900,270], refund: 990 } }
    data = { ...data, expected_snapshot_hash: inspect.data.snapshot_hash, evidence: {
      confirmed_by_user: true, customer_id: CUSTOMER_ID, source_snapshot_hash: inspect.data.snapshot_hash,
      approval_sha256: sha256(approval), source_commit: child.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
    } }
  } else if (mode === 'rehearse' || mode === 'execute') {
    if (!options.input) throw Error(`${mode}必须用 --input 提供prepare结果JSON`)
    const saved = readJson(options.input), prepared = saved.response?.data || saved.data || saved
    data = { ...data, run_id: prepared.run_id, plan_hash: prepared.plan_hash }
    if (mode === 'rehearse') data.fail_after_writes = process.argv.includes('--interrupt') ? 5 : 0
  }
  const response = await call(action, data)
  const report = { generated_at: new Date().toISOString(), mode, function_name: FUNCTION, customer_id: CUSTOMER_ID,
    execute_requested: mode === 'execute', response }
  const output = writeJsonFile(options.report, report)
  console.log(JSON.stringify({ output, code: response.code, status: response.data?.status, run_id: response.data?.run_id,
    plan_hash: response.data?.plan_hash, summary: response.data?.summary, msg: response.msg }, null, 2))
  if (response.code !== 0) process.exitCode = 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
