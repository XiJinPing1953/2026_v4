#!/usr/bin/env node
'use strict'
const fs = require('fs'), path = require('path')
const { parseStandardArgs, prepareClientOptions, ensureCrmToken, generateRequestId } = require('./lib/qrImportCommon.cjs')
const allowed = new Set(['inspect', 'prepare', 'status', 'rehearse', 'execute'])
const get = key => process.argv.find(a => a.startsWith('--' + key + '='))?.slice(key.length + 3)
async function main() {
  const mode = process.argv[2]
  if (!allowed.has(mode) || !get('request') || !get('report')) throw Error('用法：inspect|prepare|status|rehearse|execute --request=已确认请求.json --report=结果.json --space-id <空间> [--token-file=本地凭据] [--prepared=预览回执.json]')
  const report = path.resolve(get('report'))
  if (fs.existsSync(report)) throw Error('证据文件已存在，请用新文件名保留原记录')
  const request = JSON.parse(fs.readFileSync(path.resolve(get('request')), 'utf8'))
  const options = parseStandardArgs(process.argv), { client } = await prepareClientOptions(options)
  const token = get('token-file') ? fs.readFileSync(path.resolve(get('token-file')), 'utf8').trim() : await ensureCrmToken(client, options)
  let data = mode === 'prepare' ? request : { customer_id: request.customer_id, operation_id: request.operation_id }
  if (['rehearse', 'execute'].includes(mode)) {
    if (!get('prepared')) throw Error('必须引用已保存的预览回执')
    const saved = JSON.parse(fs.readFileSync(path.resolve(get('prepared')), 'utf8')), prepared = saved.response?.data
    if (saved.request?.customer_id !== request.customer_id || saved.request?.operation_id !== request.operation_id || !prepared?.plan_hash) throw Error('预览回执不属于当前客户批次')
    data.plan_hash = prepared.plan_hash
    if (mode === 'rehearse') data.fail_after_writes = Number(get('interrupt-after') || 0)
  }
  const started = new Date().toISOString()
  const response = await client.callFunction('crm-accounting-correction', { action: mode + 'V1', token, data, request_id: generateRequestId() })
  fs.mkdirSync(path.dirname(report), { recursive: true })
  fs.writeFileSync(report, JSON.stringify({ started_at: started, completed_at: new Date().toISOString(), provider: 'alipay', space_id: options.spaceId,
    action: mode + 'V1', request: data, response }, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ report, code: response.code, message: response.msg, status: response.data?.status,
    rule_version: response.rule_version, hash: response.data?.snapshot_hash, plan_hash: response.data?.plan_hash, summary: response.data?.summary, counts: response.data?.counts }))
  if (response.code !== 0) process.exitCode = 1
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
